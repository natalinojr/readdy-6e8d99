import { useCallback, useRef } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import {
  saveOfflineOrder,
  generateLocalOrderId,
  generateLocalOrderNumber,
  type OfflineOrder,
} from '@/lib/offlineDB';
import { queueOrderForPrint, type OrderItemForPrint, type OrderPrintDestino } from '@/lib/printOrderQueue';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface OrderItemPayload {
  item_id: string | null;
  combo_id?: string | null;
  item_name: string;
  item_price: number;
  quantity: number;
  station_id: string | null;
  skip_kds: boolean;
  notes: string | null;
  options: Array<{
    option_id: string | null;
    option_name: string;
    group_name: string;
    additional_price: number;
  }>;
  observations: Array<{ text: string }>;
}

export interface CreateOrderPayload {
  session_id: string;
  tenant_id: string;
  origin: 'cashier' | 'waiter' | 'self_service' | 'delivery';
  destination: string;
  destination_name: string | null;
  destination_phone: string | null;
  delivery_address: string | null;
  delivery_fee: number;
  customer_name?: string | null;
  table_number?: number | null;
  waiter_name?: string | null;
  cash_register_id?: string | null;
  items: OrderItemPayload[];
  discount_amount: number;
  service_fee_amount: number;
  subtotal: number;
  total_amount: number;
  is_training: boolean;
  customer_cpf?: string | null;
  customer_email?: string | null;
  /** Plataforma de delivery (ifood, rappi, etc.) para relatórios */
  delivery_platform?: string | null;
  /** ID da sessão de mesa (table_session_id) para vincular pedido ao consumo da mesa */
  table_session_id?: string | null;
}

export interface OrderSubmitResult {
  id: string;
  number: string;
  /** true quando o pedido foi salvo offline (sem conexão) */
  isOffline?: boolean;
  /** true quando o ticket de cozinha foi enfileirado para impressão */
  printEnqueued?: boolean;
}

export interface OrderSubmitError {
  message: string;
  partial?: boolean;
  orderId?: string;
  orderNumber?: string;
}

/**
 * Erro lançado quando o pedido foi criado no banco mas a inserção de itens
 * foi parcial (HTTP 207). O pedido existe mas pode estar incompleto.
 * Exibir alerta diferenciado ao operador para verificar o KDS.
 */
export class PartialOrderError extends Error {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly partial = true as const;

  constructor(orderId: string, orderNumber: string) {
    super(`Pedido ${orderNumber} criado mas itens falharam parcialmente — verifique o KDS`);
    this.name = 'PartialOrderError';
    this.orderId = orderId;
    this.orderNumber = orderNumber;
  }
}

/** Pagamentos a registrar junto com o pedido (para modo offline) */
export interface OfflinePaymentPayload {
  payment_method_id: string;
  amount: number;
  change_amount: number;
}

// ── Logger frontend ───────────────────────────────────────────────────────────
function logOrder(
  level: 'info' | 'warn' | 'error',
  action: string,
  message: string,
  ctx?: Record<string, unknown>,
) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    hook: 'useOrderSubmit',
    action,
    msg: message,
    ...(ctx ?? {}),
  };
  if (level === 'error') console.error('[useOrderSubmit]', JSON.stringify(entry));
  else if (level === 'warn') console.warn('[useOrderSubmit]', JSON.stringify(entry));
  else console.log('[useOrderSubmit]', JSON.stringify(entry));
}

// ── Retry helper frontend ─────────────────────────────────────────────────────
async function retryAsync<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  actionName: string,
  ctx?: Record<string, unknown>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        logOrder('info', actionName, `Retry bem-sucedido na tentativa ${attempt}`, { ...ctx, attempt });
      }
      return result;
    } catch (err) {
      lastErr = err;
      const errMsg = err instanceof Error ? err.message : String(err);

      // PartialOrderError: pedido criado mas itens falharam — faz retry pois pode ser transitório
      // Após esgotar tentativas, propaga para o chamador exibir alerta diferenciado
      const isPartialError = err instanceof PartialOrderError;

      const isValidationError = !isPartialError && (
        errMsg.includes('400') || errMsg.includes('401') || errMsg.includes('403')
        || errMsg.toLowerCase().includes('required')
        || errMsg.toLowerCase().includes('invalid')
        || errMsg.toLowerCase().includes('unauthorized')
        || errMsg.toLowerCase().includes('bloqueado')
      );

      if (isValidationError) {
        logOrder('error', actionName, `Erro de validação — sem retry`, { ...ctx, attempt, error: errMsg });
        throw err;
      }

      logOrder('warn', actionName, `Tentativa ${attempt}/${maxAttempts} falhou`, { ...ctx, attempt, error: errMsg });

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastErr;
}

// ── Detector de erro de rede ──────────────────────────────────────────────────
function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('networkerror') ||
    !navigator.onLine
  );
}

// ── Contador local de pedidos offline (para numeração) ────────────────────────
let offlineOrderSeq = Date.now() % 10000;

// ── Hook principal ────────────────────────────────────────────────────────────

// ── Retry de itens parciais ───────────────────────────────────────────────────
/**
 * Tenta reinserir os itens de um pedido já criado (HTTP 207).
 * Chama a ação `retry_order_items` na edge function, que usa
 * fn_create_order_items_bypass novamente para o orderId existente.
 * Retorna true se os itens foram inseridos com sucesso.
 */
async function retryOrderItems(
  orderId: string,
  orderNumber: string,
  payload: CreateOrderPayload,
  options?: { externalToken?: string },
): Promise<boolean> {
  logOrder('info', 'retryOrderItems', 'Tentando reinserir itens do pedido parcial', {
    order_id: orderId,
    order_number: orderNumber,
    item_count: payload.items.length,
    tenant_id: payload.tenant_id,
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data, error } = await invokeWithAuth<{
        ok?: boolean;
        inserted?: number;
        error?: string;
      }>('order-write', {
        body: {
          action: 'retry_order_items',
          order_id: orderId,
          tenant_id: payload.tenant_id,
          items: payload.items,
        },
        externalToken: options?.externalToken,
      });

      if (error) {
        logOrder('warn', 'retryOrderItems', `Tentativa ${attempt}/2 falhou`, {
          order_id: orderId,
          error: error instanceof Error ? error.message : String(error),
        });
        if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      const inserted = data?.inserted ?? 0;
      if (inserted > 0) {
        logOrder('info', 'retryOrderItems', `Retry bem-sucedido: ${inserted} itens reinseridos`, {
          order_id: orderId,
          order_number: orderNumber,
          inserted,
        });
        return true;
      }

      logOrder('warn', 'retryOrderItems', `Tentativa ${attempt}/2: 0 itens inseridos`, {
        order_id: orderId,
      });
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      logOrder('warn', 'retryOrderItems', `Tentativa ${attempt}/2 lançou exceção`, {
        order_id: orderId,
        error: e instanceof Error ? e.message : String(e),
      });
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
    }
  }

  logOrder('error', 'retryOrderItems', 'Retry de itens esgotado — pedido permanece parcial', {
    order_id: orderId,
    order_number: orderNumber,
  });
  return false;
}

/**
 * Hook centralizado para criação de pedidos com:
 * - Retry automático (3 tentativas com backoff exponencial)
 * - Retry automático de itens quando HTTP 207 (inserção parcial)
 * - Modo offline: salva no IndexedDB quando sem conexão
 * - Logs estruturados de debug
 * - Validação forte antes de enviar
 * - Proteção contra submissão duplicada
 * - Impressão automática via fila centralizada (print_queue)
 */
export function useOrderSubmit() {
  const submittingRef = useRef(false);

  const submitOrder = useCallback(async (
    payload: CreateOrderPayload,
    options?: {
      externalToken?: string;
      maxRetries?: number;
      /** Pagamentos para registrar (necessário para modo offline) */
      offlinePayments?: OfflinePaymentPayload[];
      /** Se false, não enfileira ticket de impressão (ex: re-impressão manual). Padrão true. */
      enqueuePrint?: boolean;
      /** Mapeamento stationKey → impressoraId para fila de impressão */
      stationToImpressoraId?: Record<string, string>;
    },
  ): Promise<OrderSubmitResult> => {
    // ── Proteção contra submissão duplicada ───────────────────────────────
    if (submittingRef.current) {
      logOrder('warn', 'submitOrder', 'Submissão duplicada bloqueada — já existe uma em andamento');
      throw new Error('Pedido já está sendo enviado. Aguarde.');
    }

    // ── Validação forte no frontend ───────────────────────────────────────
    if (!payload.tenant_id) {
      logOrder('error', 'submitOrder', 'BLOQUEADO: tenant_id ausente', { origin: payload.origin });
      throw new Error('tenant_id é obrigatório — usuário não autenticado');
    }

    if (!payload.session_id) {
      logOrder('error', 'submitOrder', 'BLOQUEADO: session_id ausente', {
        tenant_id: payload.tenant_id,
        origin: payload.origin,
      });
      throw new Error('session_id é obrigatório — nenhuma sessão ativa');
    }

    if (!payload.items || payload.items.length === 0) {
      logOrder('error', 'submitOrder', 'BLOQUEADO: carrinho vazio', {
        tenant_id: payload.tenant_id,
        session_id: payload.session_id,
        origin: payload.origin,
      });
      throw new Error('O carrinho está vazio — adicione itens antes de finalizar');
    }

    logOrder('info', 'submitOrder', 'Iniciando envio de pedido', {
      tenant_id: payload.tenant_id,
      session_id: payload.session_id,
      origin: payload.origin,
      destination: payload.destination,
      item_count: payload.items.length,
      subtotal: payload.subtotal,
      total_amount: payload.total_amount,
      is_training: payload.is_training,
      is_online: navigator.onLine,
    });

    submittingRef.current = true;

    try {
      // ── Modo offline: sem conexão → enfileira direto ──────────────────
      if (!navigator.onLine) {
        return await saveOrderOffline(payload, options?.offlinePayments ?? []);
      }

      const maxRetries = options?.maxRetries ?? 3;

      try {
        const result = await retryAsync(
          async () => {
            const { data, error } = await invokeWithAuth<{
              data?: { id?: string; number?: string };
              partial?: boolean;
              error?: string;
            }>('order-write', {
              body: {
                action: 'create_order',
                ...payload,
              },
              externalToken: options?.externalToken,
            });

            if (error) {
              throw error;
            }

            const isPartial = data?.error && (
              data.error.includes('falha ao inserir itens') ||
              data.error.includes('cancelled') ||
              data.error.includes('parcial')
            );
            if (isPartial) {
              const partialId = data?.data?.id ?? 'unknown';
              const partialNumber = data?.data?.number ?? '?';
              logOrder('error', 'submitOrder', 'Resposta parcial: pedido criado com itens faltando', {
                order_id: partialId,
                order_number: partialNumber,
                tenant_id: payload.tenant_id,
                session_id: payload.session_id,
                error: data.error,
              });
              throw new PartialOrderError(partialId, partialNumber);
            }

            if (data?.error) {
              throw new Error(data.error);
            }

            const orderId = data?.data?.id;
            const orderNumber = data?.data?.number;

            if (!orderId) {
              throw new Error('Pedido criado mas sem ID retornado — resposta inválida do servidor');
            }

            return { id: orderId, number: orderNumber ?? `P${Date.now()}` };
          },
          maxRetries,
          'submitOrder:create_order',
          {
            tenant_id: payload.tenant_id,
            session_id: payload.session_id,
            origin: payload.origin,
            item_count: payload.items.length,
          },
        );

        logOrder('info', 'submitOrder', 'Pedido criado com sucesso', {
          order_id: result.id,
          order_number: result.number,
          tenant_id: payload.tenant_id,
          session_id: payload.session_id,
          origin: payload.origin,
          item_count: payload.items.length,
          total_amount: payload.total_amount,
        });

        // ── Impressão automática via fila centralizada ───────────────────────
        // Usa o número REAL do backend — nunca o número pré-gerado localmente.
        // Funciona de qualquer dispositivo (caixa, garçom, totem, mesa).
        // O agente local no PC da cozinha faz polling e imprime automaticamente.
        let printEnqueued = false;
        const shouldPrint = options?.enqueuePrint !== false && !payload.is_training;
        if (shouldPrint) {
          const printDestino: OrderPrintDestino = {
            tipo: payload.destination,
            destination_name: payload.destination_name,
            table_number: payload.table_number ?? null,
          };
          const printItems: OrderItemForPrint[] = payload.items.map((item) => ({
            item_name: item.item_name,
            quantity: item.quantity,
            skip_kds: item.skip_kds,
            station_id: item.station_id,
            options: item.options?.map((o) => ({ option_name: o.option_name })),
            observations: item.observations,
            notes: item.notes,
          }));
          try {
            await queueOrderForPrint(
              payload.tenant_id,
              result.id,
              result.number,
              payload.origin,
              printItems,
              printDestino,
              options?.stationToImpressoraId,
            );
            printEnqueued = true;
            logOrder('info', 'submitOrder', 'Ticket enfileirado para impressão', {
              order_id: result.id,
              order_number: result.number,
            });
          } catch (e) {
            logOrder('warn', 'submitOrder', 'Falha ao enfileirar ticket de impressão (non-blocking)', {
              order_id: result.id,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        return { ...result, printEnqueued };
      } catch (err) {
        if (err instanceof PartialOrderError) {
          logOrder('warn', 'submitOrder', 'HTTP 207 detectado — tentando retry automático de itens', {
            order_id: err.orderId,
            order_number: err.orderNumber,
            tenant_id: payload.tenant_id,
          });

          const retrySuccess = await retryOrderItems(
            err.orderId,
            err.orderNumber,
            payload,
            { externalToken: options?.externalToken },
          );

          if (retrySuccess) {
            logOrder('info', 'submitOrder', 'Retry de itens bem-sucedido — pedido recuperado', {
              order_id: err.orderId,
              order_number: err.orderNumber,
            });

            // Tenta enfileirar impressão mesmo no retry parcial
            let printEnqueued = false;
            const shouldPrint = options?.enqueuePrint !== false && !payload.is_training;
            if (shouldPrint) {
              const printDestino: OrderPrintDestino = {
                tipo: payload.destination,
                destination_name: payload.destination_name,
                table_number: payload.table_number ?? null,
              };
              const printItems: OrderItemForPrint[] = payload.items.map((item) => ({
                item_name: item.item_name,
                quantity: item.quantity,
                skip_kds: item.skip_kds,
                station_id: item.station_id,
                options: item.options?.map((o) => ({ option_name: o.option_name })),
                observations: item.observations,
                notes: item.notes,
              }));
              try {
                await queueOrderForPrint(
                  payload.tenant_id,
                  err.orderId,
                  err.orderNumber,
                  payload.origin,
                  printItems,
                  printDestino,
                );
                printEnqueued = true;
              } catch {
                /* non-blocking */
              }
            }

            return { id: err.orderId, number: err.orderNumber, printEnqueued };
          }

          logOrder('error', 'submitOrder', 'Retry de itens falhou — propagando PartialOrderError', {
            order_id: err.orderId,
            order_number: err.orderNumber,
          });
          throw err;
        }
        if (isNetworkError(err)) {
          logOrder('warn', 'submitOrder', 'Erro de rede após retries — salvando offline', {
            tenant_id: payload.tenant_id,
            error: err instanceof Error ? err.message : String(err),
          });
          return await saveOrderOffline(payload, options?.offlinePayments ?? []);
        }
        throw err;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logOrder('error', 'submitOrder', 'FALHA ao criar pedido após todas as tentativas', {
        tenant_id: payload.tenant_id,
        session_id: payload.session_id,
        origin: payload.origin,
        item_count: payload.items.length,
        total_amount: payload.total_amount,
        error: errMsg,
      });
      throw err;
    } finally {
      submittingRef.current = false;
    }
  }, []);

  return { submitOrder };
}

// ── Helper: salvar pedido offline ─────────────────────────────────────────────

async function saveOrderOffline(
  payload: CreateOrderPayload,
  payments: OfflinePaymentPayload[],
): Promise<OrderSubmitResult> {
  offlineOrderSeq += 1;
  const localId = generateLocalOrderId();
  const localNumber = generateLocalOrderNumber(offlineOrderSeq);

  const offlineOrder: OfflineOrder = {
    localId,
    serverId: null,
    localNumber,
    serverNumber: null,
    status: 'pending',
    retryCount: 0,
    lastError: null,
    createdAt: Date.now(),
    syncedAt: null,

    session_id: payload.session_id,
    tenant_id: payload.tenant_id,
    origin: payload.origin,
    destination: payload.destination,
    destination_name: payload.destination_name,
    destination_phone: payload.destination_phone,
    delivery_address: payload.delivery_address,
    delivery_fee: payload.delivery_fee,
    items: payload.items,
    discount_amount: payload.discount_amount,
    service_fee_amount: payload.service_fee_amount,
    subtotal: payload.subtotal,
    total_amount: payload.total_amount,
    cash_register_id: payload.cash_register_id ?? null,
    is_training: payload.is_training,

    payments,
  };

  await saveOfflineOrder(offlineOrder);

  logOrder('info', 'submitOrder', 'Pedido salvo offline', {
    localId,
    localNumber,
    tenant_id: payload.tenant_id,
    item_count: payload.items.length,
    total_amount: payload.total_amount,
  });

  return {
    id: localId,
    number: localNumber,
    isOffline: true,
  };
}
