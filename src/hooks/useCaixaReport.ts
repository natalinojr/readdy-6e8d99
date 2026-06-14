import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface CashTransaction {
  id: string;
  hora: string;
  valor_venda: number;
  valor_pago: number;
  troco: number;
  operador: string | null;
  numero_pedido: string | null;
  origem: string | null;
  is_refunded: boolean;
  cash_register_id?: string | null;
  // Agrupamento de pagamentos vinculados
  payment_group_id?: string | null;
  table_session_id?: string | null;
  is_agrupado?: boolean;
  pedidos_vinculados?: string[];
  total_transacoes?: number;
}

export interface CashMovimento {
  tipo: 'out' | 'in';
  valor: number;
  motivo: string | null;
  hora: string;
}

export interface CashMovimentos {
  retiradas: number;
  adicoes: number;
  total_retiradas: number;
  total_adicoes: number;
  lista: CashMovimento[];
}

export interface CashRegisterInfo {
  id: string;
  opening_value: number;
  closing_value_expected: number | null;
  closing_value_actual: number | null;
  closing_difference: number | null;
  closing_notes: string | null;
  opened_at: string;
  closed_at: string | null;
  status: string;
  operador?: string | null;
  total_retiradas?: number;
  total_adicoes?: number;
}

export interface PorFormaPagamento {
  forma: string;
  tipo: string;
  total: number;
  count: number;
}

export interface PorOrigem {
  origem: string;
  pedidos: number;
  total: number;
}

export interface CashSession {
  id: string;
  numero: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  closing_amount_declared: number | null;
  operador: string | null;
  faturamento: number;
  num_pedidos: number;
  num_cancelados: number;
  num_cortesias: number;
  total_descontos: number;
  total_troco: number;
  cash_register: CashRegisterInfo | null;
  cash_registers: CashRegisterInfo[];
  movimentos: CashMovimentos;
  por_forma_pagamento: PorFormaPagamento[];
  por_origem: PorOrigem[];
  cash_transactions: CashTransaction[];
  cash_transactions_grouped: CashTransaction[];
}

export interface CaixaFiltros {
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;   // YYYY-MM-DD
}

export function useCaixaReport(filtros?: CaixaFiltros) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      // Tentar RPC primeiro
      const { data, error } = await supabase.rpc('fn_get_cash_sessions_v2', {
        p_tenant_id: user.tenantId,
        p_limit: 60,
        p_start_date: filtros?.startDate ?? null,
        p_end_date: filtros?.endDate ?? null,
      });

      if (error) {
        console.error('[useCaixaReport] RPC error:', error);
      }

      let rawSessions: CashSession[] = [];
      if (Array.isArray(data) && data.length > 0) {
        // RPC retorna SETOF jsonb: cada row pode ser o objeto direto ou wrapper
        rawSessions = data.map((row: any) => {
          // Se a row for um objeto com chave 'fn_get_cash_sessions_v2', desembrulha
          if (row && typeof row === 'object' && 'fn_get_cash_sessions_v2' in row) {
            return row.fn_get_cash_sessions_v2;
          }
          // Row já é o objeto direto
          return row;
        }).filter((r: any) => r && r.id);
      }

      // Fallback: se RPC nao retornou nada ou falhou, buscar direto das tabelas
      if (rawSessions.length === 0) {
        console.log('[useCaixaReport] RPC vazio, usando fallback direto...');
        // Não usa .eq('tenant_id') — o RLS já filtra via JWT, evitar conflito
        let sessQuery = supabase
          .from('sessions')
          .select('id, number, status, opened_at, closed_at, opening_amount, closing_amount_declared, opened_by')
          .eq('tenant_id', user.tenantId)
          .eq('is_training', false)
          .order('opened_at', { ascending: false })
          .limit(60);

        if (filtros?.startDate) {
          sessQuery = sessQuery.gte('opened_at', `${filtros.startDate}T00:00:00`);
        }
        if (filtros?.endDate) {
          sessQuery = sessQuery.lte('opened_at', `${filtros.endDate}T23:59:59`);
        }

        const { data: sessData, error: sessError } = await sessQuery;

        if (sessError) {
          console.error('[useCaixaReport] Fallback error:', sessError);
        } else if (sessData && sessData.length > 0) {
          const sessionIds = sessData.map((s) => s.id).filter(Boolean);

          let registersMap: Record<string, any[]> = {};
          let ordersMap: Record<string, { total: number; count: number; cancelados: number; cortesias: number }> = {};
          let ordersResultData: any[] = [];
          let ordersById = new Map<string, any>();
          let pmMap = new Map<string, { name: string; type: string }>();
          let paymentsBySession = new Map<string, any[]>();
          let discountsBySession = new Map<string, number>();
          let movementsByRegister = new Map<string, any[]>();

          if (sessionIds.length > 0) {
            const [regResult, ordersResult] = await Promise.all([
              supabase
                .from('cash_registers')
                .select('id, session_id, opening_value, closing_value_expected, closing_value_actual, closing_difference, closing_notes, opened_at, closed_at, status, total_retiradas, total_adicoes')
                .eq('tenant_id', user.tenantId)
                .in('session_id', sessionIds),
              supabase
                .from('orders')
                .select('id, session_id, number, total_amount, status, is_cortesia, created_at, origin_type, origin_user_id')
                .eq('tenant_id', user.tenantId)
                .in('session_id', sessionIds)
                .eq('is_training', false)
                .eq('is_draft', false),
            ]);

            if (!regResult.error && regResult.data) {
              registersMap = regResult.data.reduce((acc, r) => {
                const key = r.session_id;
                if (!acc[key]) acc[key] = [];
                acc[key].push(r);
                return acc;
              }, {} as Record<string, any[]>);
            }

            if (!ordersResult.error && ordersResult.data) {
              ordersResultData = ordersResult.data;
              for (const o of ordersResult.data) {
                const sid = o.session_id;
                if (!ordersMap[sid]) ordersMap[sid] = { total: 0, count: 0, cancelados: 0, cortesias: 0 };
                if (o.status === 'cancelled') {
                  ordersMap[sid].cancelados += 1;
                } else if (o.is_cortesia) {
                  ordersMap[sid].cortesias += 1;
                  ordersMap[sid].count += 1;
                } else {
                  ordersMap[sid].total += Number(o.total_amount ?? 0);
                  ordersMap[sid].count += 1;
                }
              }
            }

            // ── Queries adicionais para o fallback completo ──
            const orderIds = (ordersResult.data ?? []).map((o: any) => o.id).filter(Boolean);
            const registerIds = Object.values(registersMap).flat().map((r: any) => r.id).filter(Boolean);

            let paymentsData: any[] = [];
            let paymentMethodsData: any[] = [];
            let discountsData: any[] = [];
            let cashMovementsData: any[] = [];

            if (orderIds.length > 0 || registerIds.length > 0) {
              const queries: Promise<any>[] = [];

              if (orderIds.length > 0) {
                queries.push(
                  supabase.from('payments')
                    .select('id, order_id, cash_register_id, payment_method_id, amount, change_amount, is_refunded, created_at, operator_name, origin_type')
                    .eq('tenant_id', user.tenantId)
                    .in('order_id', orderIds)
                );
                queries.push(
                  supabase.from('order_discounts')
                    .select('order_id, discount_value')
                    .eq('tenant_id', user.tenantId)
                    .in('order_id', orderIds)
                );
              }

              queries.push(
                supabase.from('payment_methods')
                  .select('id, name, type')
                  .eq('tenant_id', user.tenantId)
              );

              if (registerIds.length > 0) {
                queries.push(
                  supabase.from('cash_movements')
                    .select('cash_register_id, type, amount, reason, created_at')
                    .eq('tenant_id', user.tenantId)
                    .in('cash_register_id', registerIds)
                );
              }

              const results = await Promise.all(queries);
              let idx = 0;

              if (orderIds.length > 0) {
                const payResult = results[idx++];
                if (!payResult.error && payResult.data) paymentsData = payResult.data;

                const discResult = results[idx++];
                if (!discResult.error && discResult.data) discountsData = discResult.data;
              }

              const pmResult = results[idx++];
              if (!pmResult.error && pmResult.data) paymentMethodsData = pmResult.data;

              if (registerIds.length > 0) {
                const cmResult = results[idx++];
                if (!cmResult.error && cmResult.data) cashMovementsData = cmResult.data;
              }
            }

            // Mapas auxiliares
            for (const o of ordersResultData ?? []) {
              ordersById.set(o.id, o);
            }

            for (const pm of paymentMethodsData) {
              pmMap.set(pm.id, { name: pm.name, type: pm.type ?? 'other' });
            }

            // pagamentos por session_id (via order)
            for (const p of paymentsData) {
              const order = ordersById.get(p.order_id);
              if (!order) continue;
              const sid = order.session_id;
              const arr = paymentsBySession.get(sid) ?? [];
              arr.push(p);
              paymentsBySession.set(sid, arr);
            }

            // descontos por session_id (via order)
            for (const d of discountsData) {
              const order = ordersById.get(d.order_id);
              if (!order) continue;
              const sid = order.session_id;
              discountsBySession.set(sid, (discountsBySession.get(sid) ?? 0) + Number(d.discount_value ?? 0));
            }

            // cash_movements por cash_register_id
            for (const cm of cashMovementsData) {
              const arr = movementsByRegister.get(cm.cash_register_id) ?? [];
              arr.push(cm);
              movementsByRegister.set(cm.cash_register_id, arr);
            }
          }

          rawSessions = sessData.map((sess: any) => {
            const regs = registersMap[sess.id] ?? [];
            const cr = regs[0] ?? null;
            const ords = ordersMap[sess.id] ?? { total: 0, count: 0, cancelados: 0, cortesias: 0 };
            const sessPayments = paymentsBySession.get(sess.id) ?? [];
            const sessDiscountsTotal = discountsBySession.get(sess.id) ?? 0;

            // ── por_forma_pagamento ──
            const porFormaMap = new Map<string, { total: number; count: number; tipo: string }>();
            for (const p of sessPayments) {
              if (p.is_refunded) continue;
              const order = ordersById.get(p.order_id);
              if (!order || order.status === 'cancelled' || order.status === 'draft') continue;
              const pmInfo = pmMap.get(p.payment_method_id);
              const key = pmInfo?.name ?? 'Outros';
              const existing = porFormaMap.get(key);
              if (existing) {
                existing.total += Number(p.amount ?? 0);
                existing.count += 1;
              } else {
                porFormaMap.set(key, { total: Number(p.amount ?? 0), count: 1, tipo: pmInfo?.type ?? 'other' });
              }
            }
            const por_forma_pagamento: PorFormaPagamento[] = Array.from(porFormaMap.entries())
              .map(([forma, data]) => ({ forma, tipo: data.tipo, total: data.total, count: data.count }))
              .sort((a, b) => b.total - a.total);

            // ── total_troco ──
            let total_troco = 0;
            for (const p of sessPayments) {
              if (p.is_refunded) continue;
              const order = ordersById.get(p.order_id);
              if (!order || order.status === 'cancelled' || order.status === 'draft') continue;
              total_troco += Number(p.change_amount ?? 0);
            }

            // ── por_origem ──
            const porOrigemMap = new Map<string, { pedidos: number; total: number }>();
            for (const o of ordersResultData ?? []) {
              if (o.session_id !== sess.id) continue;
              if (o.status === 'cancelled' || o.status === 'draft') continue;
              if (o.is_training) continue;
              const key = o.origin_type ?? 'outros';
              const existing = porOrigemMap.get(key);
              if (existing) {
                existing.pedidos += 1;
                existing.total += Number(o.total_amount ?? 0);
              } else {
                porOrigemMap.set(key, { pedidos: 1, total: Number(o.total_amount ?? 0) });
              }
            }
            const por_origem: PorOrigem[] = Array.from(porOrigemMap.entries())
              .map(([origem, data]) => ({ origem, pedidos: data.pedidos, total: data.total }));

            // ── cash_transactions (apenas pagamentos em dinheiro/espécie) ──
            const cash_transactions: CashTransaction[] = sessPayments
              .filter((p) => {
                const order = ordersById.get(p.order_id);
                if (!order || order.status === 'cancelled' || order.status === 'draft' || order.is_training) return false;
                const pmInfo = pmMap.get(p.payment_method_id);
                const isCash = !pmInfo || pmInfo.type === 'cash' ||
                  (pmInfo.name ?? '').toLowerCase().includes('dinheiro') ||
                  (pmInfo.name ?? '').toLowerCase().includes('espécie');
                return isCash;
              })
              .map((p) => {
                const order = ordersById.get(p.order_id);
                return {
                  id: p.id,
                  hora: p.created_at,
                  valor_venda: Number(order?.total_amount ?? 0),
                  valor_pago: Number(p.amount ?? 0) + Number(p.change_amount ?? 0),
                  troco: Number(p.change_amount ?? 0),
                  operador: p.operator_name ?? null,
                  numero_pedido: order?.number ?? null,
                  origem: p.origin_type ?? order?.origin_type ?? null,
                  is_refunded: p.is_refunded ?? false,
                  cash_register_id: p.cash_register_id ?? null,
                } as CashTransaction;
              })
              .sort((a, b) => new Date(b.hora).getTime() - new Date(a.hora).getTime());

            // ── movimentos ──
            const allMovs: CashMovimento[] = [];
            let totalRetiradas = 0;
            let totalAdicoes = 0;
            for (const reg of regs) {
              const regMovs = movementsByRegister.get(reg.id) ?? [];
              for (const cm of regMovs) {
                const val = Number(cm.amount ?? 0);
                allMovs.push({
                  tipo: cm.type as 'out' | 'in',
                  valor: val,
                  motivo: cm.reason ?? null,
                  hora: cm.created_at,
                });
                if (cm.type === 'out') totalRetiradas += val;
                else totalAdicoes += val;
              }
            }
            allMovs.sort((a, b) => new Date(b.hora).getTime() - new Date(a.hora).getTime());

            const movimentos: CashMovimentos = {
              retiradas: allMovs.filter((m) => m.tipo === 'out').length,
              adicoes: allMovs.filter((m) => m.tipo === 'in').length,
              total_retiradas: totalRetiradas,
              total_adicoes: totalAdicoes,
              lista: allMovs,
            };

            return {
              id: sess.id,
              numero: sess.number ?? '-',
              status: sess.status,
              opened_at: sess.opened_at,
              closed_at: sess.closed_at,
              opening_amount: sess.opening_amount ?? 0,
              closing_amount_declared: sess.closing_amount_declared,
              operador: sess.opened_by ?? null,
              faturamento: ords.total,
              num_pedidos: ords.count,
              num_cancelados: ords.cancelados,
              num_cortesias: ords.cortesias,
              total_descontos: sessDiscountsTotal,
              total_troco,
              cash_register: cr,
              cash_registers: regs,
              movimentos,
              por_forma_pagamento,
              por_origem,
              cash_transactions,
              cash_transactions_grouped: [],
            };
          });
        }
      }

      // ── Enriquecer transações com payment_group_id e table_session_id ──
      const sessionIds = rawSessions.map((s) => s.id).filter(Boolean);
      if (sessionIds.length > 0) {
        // Buscar orders das sessões para mapear table_session_id
        const { data: ordersData } = await supabase
          .from('orders')
          .select('id, session_id, number, table_session_id')
          .eq('tenant_id', user.tenantId)
          .in('session_id', sessionIds)
          .eq('is_training', false)
          .eq('is_draft', false);

        // Buscar payments EXATAMENTE pelos ids das transações de caixa (= payment ids).
        // Robusto: não depende de filtrar por order_id/sessão (que poderia truncar em
        // 1000 linhas e perder pagamentos → payment_group_id viria null → não agruparia).
        const txIds = rawSessions
          .flatMap((s) => (s.cash_transactions ?? []).map((t: CashTransaction) => t.id))
          .filter(Boolean);
        let paymentsData: any[] = [];
        if (txIds.length > 0) {
          const { data: payData } = await supabase
            .from('payments')
            .select('id, order_id, payment_group_id')
            .in('id', txIds);
          paymentsData = payData ?? [];
        }

        // Mapear order_id -> table_session_id, number
        const orderMap = new Map<string, { table_session_id: string | null; number: string | null }>();
        for (const o of ordersData ?? []) {
          orderMap.set(o.id, { table_session_id: o.table_session_id, number: o.number });
        }

        // Mapear payment_id -> payment_group_id, order_id
        const paymentMap = new Map<string, { payment_group_id: string | null; order_id: string }>();
        for (const p of paymentsData) {
          paymentMap.set(p.id, { payment_group_id: p.payment_group_id, order_id: p.order_id });
        }

        // Enriquecer transações e agrupar
        for (const sess of rawSessions) {
          const trans = (sess.cash_transactions ?? []).map((t: CashTransaction) => {
            const payInfo = paymentMap.get(t.id);
            const ordId = payInfo?.order_id;
            const ordInfo = ordId ? orderMap.get(ordId) : null;
            return {
              ...t,
              payment_group_id: payInfo?.payment_group_id ?? null,
              table_session_id: ordInfo?.table_session_id ?? null,
            };
          });

          // Agrupar por payment_group_id
          const porGrupo = new Map<string, CashTransaction[]>();
          const semGrupo: CashTransaction[] = [];

          for (const t of trans) {
            if (t.payment_group_id) {
              const lista = porGrupo.get(t.payment_group_id) ?? [];
              lista.push(t);
              porGrupo.set(t.payment_group_id, lista);
            } else {
              semGrupo.push(t);
            }
          }

          // Construir transações agrupadas
          const agrupadas: CashTransaction[] = [];

          for (const [, lista] of porGrupo) {
            if (lista.length === 1) {
              agrupadas.push(lista[0]);
              continue;
            }
            const primeiro = lista[0];
            const pedidosNums = lista
              .map((t) => t.numero_pedido)
              .filter((n): n is string => !!n);
            const pedidosUnicos = [...new Set(pedidosNums)];
            const totalVenda = lista.reduce((s, t) => s + t.valor_venda, 0);
            const totalTroco = lista.reduce((s, t) => s + t.troco, 0);
            // Pagamento conjunto: o pedido principal grava o amount do GRUPO inteiro e os
            // vinculados gravam o deles, então somar valor_pago (amount+troco) conta em dobro.
            // O recebido real do grupo = venda total + troco entregue uma única vez.
            const totalPago = totalVenda + totalTroco;

            agrupadas.push({
              ...primeiro,
              valor_venda: totalVenda,
              valor_pago: totalPago,
              troco: totalTroco,
              is_agrupado: true,
              pedidos_vinculados: pedidosUnicos,
              total_transacoes: lista.length,
              numero_pedido: pedidosUnicos.length > 0 ? pedidosUnicos.join(', ') : primeiro.numero_pedido,
              is_refunded: lista.some((t) => t.is_refunded),
            });
          }

          // Adicionar transações sem grupo
          agrupadas.push(...semGrupo);

          // Ordenar por hora (mais recente primeiro)
          agrupadas.sort((a, b) => new Date(b.hora).getTime() - new Date(a.hora).getTime());

          sess.cash_transactions = trans;
          sess.cash_transactions_grouped = agrupadas;
        }
      }

      const normalized = rawSessions.map((s) => ({
        ...s,
        num_cancelados: s.num_cancelados ?? 0,
        num_cortesias: s.num_cortesias ?? 0,
        total_descontos: s.total_descontos ?? 0,
        total_troco: s.total_troco ?? 0,
        por_forma_pagamento: s.por_forma_pagamento ?? [],
        por_origem: s.por_origem ?? [],
        cash_registers: s.cash_registers ?? [],
        cash_transactions: s.cash_transactions ?? [],
        cash_transactions_grouped: s.cash_transactions_grouped ?? s.cash_transactions ?? [],
        movimentos: {
          ...s.movimentos,
          lista: s.movimentos?.lista ?? [],
        },
      }));
      setSessions(normalized);
    } catch (e) {
      console.error('[useCaixaReport]', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, filtros?.startDate, filtros?.endDate]);

  useEffect(() => { load(); }, [load]);

  return { sessions, loading, reload: load };
}