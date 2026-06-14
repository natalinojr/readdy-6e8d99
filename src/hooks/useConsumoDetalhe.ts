import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { convertUnit } from '@/lib/unitConversion';
import type { UnidadeEstoque } from '@/types/estoque';

export interface ConsumoNoDia {
  data: string;
  dataLabel: string;
  diaSemana: string;
  totalQtd: number;
  unidade: UnidadeEstoque;
  buckets: { vendas: number; producao: number; perda: number };
  linhas: Array<{
    id: string;
    hora: string;
    numeroPedido: string | null;
    itemNome: string | null;
    qty: number;
    bucket: 'vendas' | 'producao' | 'perda';
  }>;
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Quebra um array em chunks de tamanho N */
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function getBucket(type: string, reason: string | null): { bucket: 'vendas' | 'producao' | 'perda' | 'ajuste' | 'entrada'; isConsumo: boolean } {
  if (type === 'in' || type === 'transfer_in') return { bucket: 'entrada', isConsumo: false };
  const r = (reason || '').toLowerCase();
  if (type === 'theoretical_out') return { bucket: 'vendas', isConsumo: true };
  if (
    r.includes('perda') ||
    r.includes('descarte') ||
    r.includes('quebra') ||
    r.includes('dano') ||
    r.includes('estrago')
  ) {
    return { bucket: 'perda', isConsumo: true };
  }
  if (
    type === 'manual_out' &&
    (r.includes('producao') || r.includes('produção') || r.includes('saida (producao)'))
  ) {
    return { bucket: 'producao', isConsumo: true };
  }
  if (type === 'transfer_out') return { bucket: 'ajuste', isConsumo: false };
  if (type === 'inventory_adjustment') return { bucket: 'ajuste', isConsumo: false };
  if (type === 'manual_out') return { bucket: 'ajuste', isConsumo: false };
  return { bucket: 'ajuste', isConsumo: false };
}

function formatHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Extrai UUID único de reason no formato "item_sale:{uuid}" */
function parseItemSaleReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed.startsWith('item_sale:')) return null;
  const parts = trimmed.split(':').slice(1).join(':'); // tudo após "item_sale:"
  // Pode ser 1 UUID ou 2 UUIDs separados por ":"
  const uuids = parts.split(':').filter(s => UUID_RE.test(s));
  // Se tiver 2 UUIDs: primeiro é order_item_id, segundo é item_id
  // Se tiver 1 UUID: pode ser order_item_id OU item_id
  return uuids[0] ?? null;
}

export function useConsumoDetalhe(
  ingredientId: string | null,
  ingredientUnit: UnidadeEstoque,
  dateFrom: string,
  dateTo: string,
) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const [dias, setDias] = useState<ConsumoNoDia[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !ingredientId) {
      setDias([]);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const fromDate = new Date(`${dateFrom}T00:00:00`);
        const toDate = new Date(`${dateTo}T23:59:59`);

        // 1) Buscar movimentações via RPC
        const { data: rpcData, error: movsErr } = await supabase.rpc('fn_get_stock_movements', {
          p_tenant_id: tenantId,
          p_limit: 2000,
          p_date_from: fromDate.toISOString(),
          p_date_to: toDate.toISOString(),
          p_ingredient_id: ingredientId,
        });

        if (movsErr) throw movsErr;

        const rawMovs = ((rpcData ?? []) as Array<{
          id: string;
          type: string;
          quantity: number;
          ingredient_unit?: string | null;
          reason?: string | null;
          created_at?: string | null;
          order_id?: string | null;
          order_number?: string | null;
          sold_item_name?: string | null;
          production_batch_id?: string | null;
        }>)
          .map(m => ({
            id: m.id,
            type: m.type,
            quantity: Number(m.quantity),
            unit: (m.ingredient_unit ?? ingredientUnit) as UnidadeEstoque,
            reason: m.reason ?? null,
            created_at: m.created_at ?? '',
            order_id: m.order_id ?? null,
            order_number: m.order_number ?? null,
            sold_item_name: m.sold_item_name ?? null,
            production_batch_id: m.production_batch_id ?? null,
          }))
          .sort((a, b) => a.created_at.localeCompare(b.created_at));

        // 2) Filtrar só consumo (vendas, producao, perda)
        const consumoMovs = rawMovs.filter(m => {
          const { bucket } = getBucket(m.type, m.reason);
          return bucket === 'vendas' || bucket === 'producao' || bucket === 'perda';
        });

        // 3) Itens do cardápio que usam este ingrediente
        const { data: ingredientItemsData } = await supabase
          .from('item_ingredients')
          .select('item_id')
          .eq('ingredient_id', ingredientId!)
          .eq('tenant_id', tenantId!);

        const itemIds = (ingredientItemsData ?? []).map((i: { item_id: string }) => i.item_id);

        // 4) Coletar UUIDs de "item_sale:{uuid}" no reason para lookup direto
        const reasonUuidToMovId = new Map<string, string[]>(); // uuid → [movement_ids]
        const allReasonUuids: string[] = [];
        for (const m of consumoMovs) {
          if (m.reason) {
            const uuid = parseItemSaleReason(m.reason);
            if (uuid) {
              const prev = reasonUuidToMovId.get(uuid) ?? [];
              prev.push(m.id);
              reasonUuidToMovId.set(uuid, prev);
              if (!allReasonUuids.includes(uuid)) allReasonUuids.push(uuid);
            }
          }
        }

        // Mapa: movement_id → item_name (via UUID do reason)
        const movItemNameByReason = new Map<string, string>();

        if (allReasonUuids.length > 0) {
          // Tentar como order_item_id primeiro
          const chunks = chunk(allReasonUuids, 50);
          await Promise.all(chunks.map(async (c) => {
            const { data } = await supabase
              .from('order_items')
              .select('id, item_name')
              .in('id', c);
            for (const oi of (data ?? []) as Array<{ id: string; item_name: string }>) {
              const movIds = reasonUuidToMovId.get(oi.id) ?? [];
              movIds.forEach(mid => movItemNameByReason.set(mid, oi.item_name));
            }
          }));

          // Para UUIDs que não foram encontrados como order_item_id, tentar como item_id em menu_items
          const foundUuids = new Set(
            [...movItemNameByReason.keys()].flatMap(mid =>
              [...reasonUuidToMovId.entries()]
                .filter(([, mids]) => mids.includes(mid))
                .map(([uuid]) => uuid)
            )
          );
          const missingUuids = allReasonUuids.filter(u => !foundUuids.has(u));
          if (missingUuids.length > 0) {
            const miChunks = chunk(missingUuids, 50);
            await Promise.all(miChunks.map(async (c) => {
              const { data } = await supabase
                .from('menu_items')
                .select('id, name')
                .in('id', c);
              for (const mi of (data ?? []) as Array<{ id: string; name: string }>) {
                const movIds = reasonUuidToMovId.get(mi.id) ?? [];
                movIds.forEach(mid => movItemNameByReason.set(mid, mi.name));
              }
            }));
          }
        }

        // 5) Lookup por order_id → item_name via order_items (single pass, sem filtro por item_id)
        const orderIds = Array.from(
          new Set(consumoMovs.map(m => m.order_id).filter(Boolean) as string[])
        );

        // order_id → [item_names] e order_id → number
        const orderItemsMap = new Map<string, Array<{ name: string; itemId: string }>>();
        const orderNumberMap = new Map<string, string>();

        if (orderIds.length > 0) {
          const orderChunks = chunk(orderIds, 50);

          // Busca order_items e orders em paralelo
          await Promise.all([
            // Order items — sem filtro por item_id para garantir resultado
            ...orderChunks.map(async (c) => {
              const { data } = await supabase
                .from('order_items')
                .select('order_id, item_name, item_id')
                .in('order_id', c);
              for (const oi of (data ?? []) as Array<{ order_id: string; item_name: string; item_id: string }>) {
                const existing = orderItemsMap.get(oi.order_id) ?? [];
                if (!existing.some(e => e.name === oi.item_name)) {
                  existing.push({ name: oi.item_name, itemId: oi.item_id });
                }
                orderItemsMap.set(oi.order_id, existing);
              }
            }),
            // Número dos pedidos
            ...chunk(orderIds, 50).map(async (c) => {
              const { data } = await supabase
                .from('orders')
                .select('id, number')
                .in('id', c);
              for (const o of (data ?? []) as Array<{ id: string; number: string | null }>) {
                orderNumberMap.set(o.id, o.number ?? o.id.slice(0, 6));
              }
            }),
          ]);
        }

        // 6) Produções (production_batches)
        const batchIds = Array.from(
          new Set(consumoMovs.map(m => m.production_batch_id).filter(Boolean) as string[])
        );
        const batchNamesMap = new Map<string, string>();

        if (batchIds.length > 0) {
          const { data: batchData } = await supabase
            .from('production_batches')
            .select('id, recipe_name')
            .in('id', batchIds);
          for (const b of (batchData ?? []) as Array<{ id: string; recipe_name: string | null }>) {
            batchNamesMap.set(b.id, b.recipe_name ?? 'Produção');
          }
        }

        // 7) Agrupar por dia
        const byDay = new Map<string, typeof consumoMovs>();
        for (const m of consumoMovs) {
          const dateKey = m.created_at.slice(0, 10);
          const prev = byDay.get(dateKey) ?? [];
          prev.push(m);
          byDay.set(dateKey, prev);
        }

        // 8) Construir estrutura final
        const result: ConsumoNoDia[] = [];

        for (const [dateKey, movs] of byDay.entries()) {
          const d = new Date(`${dateKey}T12:00:00`);
          const dataLabel = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
          const diaSemana = DIAS_SEMANA[d.getDay()];

          const buckets = { vendas: 0, producao: 0, perda: 0 };
          let totalQtd = 0;

          const linhas = movs.map(m => {
            const { bucket } = getBucket(m.type, m.reason) as { bucket: 'vendas' | 'producao' | 'perda' };
            const qtyAbs = Math.abs(Number(m.quantity));

            const movUnit = m.unit as UnidadeEstoque;
            let finalQty = qtyAbs;
            if (movUnit !== ingredientUnit) {
              const converted = convertUnit(qtyAbs, movUnit, ingredientUnit);
              if (converted !== null) finalQty = converted;
            }

            totalQtd += finalQty;
            buckets[bucket] += finalQty;

            // Determinar nome do item — cascata de prioridades
            // P1: campo sold_item_name do RPC (se preenchido)
            let itemNome: string | null = m.sold_item_name ?? null;

            // P2: lookup via UUID do reason (item_sale:{uuid})
            if (!itemNome) {
              itemNome = movItemNameByReason.get(m.id) ?? null;
            }

            // P3: lookup pelo order_id → order_items (prioriza itens do ingrediente se soubermos)
            if (!itemNome && m.order_id) {
              const entries = orderItemsMap.get(m.order_id);
              if (entries && entries.length > 0) {
                // Se soubermos quais item_ids usam este ingrediente, filtra
                if (itemIds.length > 0) {
                  const matching = entries.filter(e => itemIds.includes(e.itemId));
                  itemNome = matching.length > 0
                    ? matching.map(e => e.name).join(', ')
                    : entries.map(e => e.name).join(', ');
                } else {
                  itemNome = entries.map(e => e.name).join(', ');
                }
              }
            }

            // P4: production batch
            if (!itemNome && m.production_batch_id) {
              itemNome = batchNamesMap.get(m.production_batch_id) ?? null;
            }

            // P5: reason legível (apenas se não for o padrão item_sale: ou "Baixa automática")
            if (!itemNome && m.reason) {
              const reasonLower = m.reason.toLowerCase();
              const isBaixaGenerica = reasonLower.includes('baixa automática') || reasonLower.includes('baixa automatica');
              const isItemSale = m.reason.trim().startsWith('item_sale:');
              if (!isBaixaGenerica && !isItemSale) {
                itemNome = m.reason;
              }
            }

            const numeroPedido = m.order_id
              ? (m.order_number ?? orderNumberMap.get(m.order_id) ?? null)
              : null;

            return {
              id: m.id,
              hora: formatHora(m.created_at),
              numeroPedido,
              itemNome,
              qty: finalQty,
              bucket,
            };
          });

          result.push({
            data: dateKey,
            dataLabel,
            diaSemana,
            totalQtd,
            unidade: ingredientUnit,
            buckets,
            linhas,
          });
        }

        result.sort((a, b) => b.data.localeCompare(a.data));

        if (!cancelled) {
          setDias(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Erro ao carregar detalhe');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => { cancelled = true; };
  }, [tenantId, ingredientId, ingredientUnit, dateFrom, dateTo]);

  return { dias, loading, error };
}