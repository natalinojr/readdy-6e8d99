import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export interface IngredienteUsado {
  id: string;
  nome: string;
  quantidade: number;
  unidade: string;
  custo: number;
}

export interface ConsumoPorPrato {
  itemId: string;
  itemNome: string;
  qtdVendida: number;
  numPedidos: number;
  custoTotal: number;
  ingredientes: IngredienteUsado[];
}

// Divide array em chunks de tamanho máximo
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

export function useConsumoPorLanche(dateFrom: string, dateTo: string) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const [dados, setDados] = useState<ConsumoPorPrato[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // 1) Buscar order_items com join em orders para evitar lista grande de IDs
        //    Usando paginação de 1000 registros
        let allOiData: Array<{ item_id: string; item_name: string; quantity: number; order_id: string }> = [];
        let page = 0;
        const PAGE_SIZE = 1000;

        while (true) {
          const { data: pageData, error: pageErr } = await supabase
            .from('order_items')
            .select(`
              item_id,
              item_name,
              quantity,
              order_id,
              orders!inner(id, status, created_at)
            `)
            .eq('tenant_id', tenantId!)
            .filter('orders.status', 'neq', 'cancelled')
            .filter('orders.created_at', 'gte', `${dateFrom}T00:00:00`)
            .filter('orders.created_at', 'lte', `${dateTo}T23:59:59`)
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

          if (pageErr) throw pageErr;
          const rows = (pageData ?? []) as Array<{ item_id: string; item_name: string; quantity: number; order_id: string }>;
          allOiData = [...allOiData, ...rows];
          if (rows.length < PAGE_SIZE) break;
          page++;
        }

        if (allOiData.length === 0) {
          if (!cancelled) { setDados([]); setLoading(false); }
          return;
        }

        // 2) Agregar por item_id
        const itemAgg = new Map<string, { nome: string; qtd: number; pedidos: Set<string> }>();
        for (const oi of allOiData) {
          if (!oi.item_id) continue;
          const prev = itemAgg.get(oi.item_id) ?? { nome: oi.item_name, qtd: 0, pedidos: new Set() };
          prev.qtd += Number(oi.quantity);
          prev.pedidos.add(oi.order_id);
          itemAgg.set(oi.item_id, prev);
        }

        const itemIds = Array.from(itemAgg.keys());
        if (itemIds.length === 0) {
          if (!cancelled) { setDados([]); setLoading(false); }
          return;
        }

        // 3) Ingredientes por item — em chunks de 50 para evitar URL longa
        let iiData: Array<{ item_id: string; ingredient_id: string; quantity: number; unit: string }> = [];
        for (const chunkIds of chunk(itemIds, 50)) {
          const { data: chunkData } = await supabase
            .from('item_ingredients')
            .select('item_id, ingredient_id, quantity, unit')
            .in('item_id', chunkIds)
            .eq('tenant_id', tenantId!);
          iiData = [...iiData, ...(chunkData ?? []) as typeof iiData];
        }

        // 4) Dados dos ingredientes (nome + preço) — em chunks de 50
        const ingIds = Array.from(new Set(iiData.map((ii) => ii.ingredient_id)));
        const ingsMap = new Map<string, { name: string; unit: string; unit_price: number }>();
        if (ingIds.length > 0) {
          for (const chunkIds of chunk(ingIds, 50)) {
            const { data: ingsData } = await supabase
              .from('ingredients')
              .select('id, name, unit, unit_price')
              .in('id', chunkIds)
              .eq('tenant_id', tenantId!);
            for (const ing of (ingsData ?? []) as Array<{ id: string; name: string; unit: string; unit_price: number }>) {
              ingsMap.set(ing.id, { name: ing.name, unit: ing.unit, unit_price: Number(ing.unit_price ?? 0) });
            }
          }
        }

        // 5) Montar resultado
        const result: ConsumoPorPrato[] = [];
        for (const [itemId, agg] of itemAgg.entries()) {
          const ings = iiData.filter((ii) => ii.item_id === itemId);

          let custoTotal = 0;
          const ingredientes: IngredienteUsado[] = ings.map((ii) => {
            const ing = ingsMap.get(ii.ingredient_id);
            const qtdTotal = Number(ii.quantity) * agg.qtd;
            const custo = qtdTotal * (ing?.unit_price ?? 0);
            custoTotal += custo;
            return {
              id: ii.ingredient_id,
              nome: ing?.name ?? 'Desconhecido',
              quantidade: qtdTotal,
              unidade: ing?.unit ?? ii.unit,
              custo,
            };
          }).sort((a, b) => b.custo - a.custo);

          result.push({
            itemId,
            itemNome: agg.nome,
            qtdVendida: agg.qtd,
            numPedidos: agg.pedidos.size,
            custoTotal,
            ingredientes,
          });
        }

        result.sort((a, b) => b.custoTotal - a.custoTotal);

        if (!cancelled) {
          setDados(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          const msg =
            e instanceof Error
              ? e.message
              : (e as { message?: string })?.message ?? 'Erro ao carregar';
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [tenantId, dateFrom, dateTo]);

  return { dados, loading, error };
}