import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDates } from '@/lib/dateUtils';

export interface CmvItemVendido {
  item_id: string;
  item_name: string;
  categoria: string;
  qtd_vendida: number;
  receita_total: number;
  preco_unitario: number;
  /** Custo unitário com base na ficha técnica (pode ser 0 se sem ficha) */
  custo_unitario: number;
  custo_total: number;
  cmv_pct: number;
  margem_bruta: number;
  margem_pct: number;
  tem_ficha: boolean;
}

export interface CmvReportData {
  periodo_de: string;
  periodo_ate: string;
  receita_total: number;
  custo_total: number;
  cmv_pct_geral: number;
  margem_bruta_total: number;
  itens: CmvItemVendido[];
}

export function useCmvReport() {
  const { user } = useAuth();
  const [data, setData] = useState<CmvReportData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (periodo: string) => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const { from, to } = getPeriodDates(periodo);
      const pl = getPeriodDates(periodo);
      const emptyResult = { periodo_de: pl.from.slice(0, 10), periodo_ate: pl.to.slice(0, 10), receita_total: 0, custo_total: 0, cmv_pct_geral: 0, margem_bruta_total: 0, itens: [] };

      type SalesRow = { item_id: string | null; item_name: string; item_price: number; quantity: number };
      let salesRows: SalesRow[] = [];
      let itemIdsForFicha: string[] = [];

      // 1. Tenta via edge function (service_role, bypassa RLS)
      try {
        console.log('[useCmvReport] chamando get_cmv_orders', { from, to, tenant_id: user.tenantId });
        const { data: ordersResult, error: efErr0 } = await supabase.functions.invoke<{
          success: boolean;
          data?: { order_ids: string[]; sales_rows: SalesRow[] };
        }>('stock-write', {
          body: { action: 'get_cmv_orders', tenant_id: user.tenantId, from, to },
        });
        console.log('[useCmvReport] get_cmv_orders resultado:', JSON.stringify(ordersResult), 'erro:', efErr0);

        if (ordersResult?.success && ordersResult.data) {
          console.log('[useCmvReport] order_ids:', ordersResult.data.order_ids.length, 'sales_rows:', ordersResult.data.sales_rows.length);
          if (!ordersResult.data.order_ids.length) { setData(emptyResult); return; }
          salesRows = ordersResult.data.sales_rows;
        } else {
          throw new Error(`edge function returned no data: ${JSON.stringify(ordersResult)} err: ${JSON.stringify(efErr0)}`);
        }
      } catch (efErr) {
        // Fallback: query direta via anon key + RLS
        console.warn('[useCmvReport] edge fn falhou, fallback direto:', efErr);
        const { data: ordersData, error: oErr } = await supabase
          .from('orders')
          .select('id')
          .eq('tenant_id', user.tenantId)
          .gte('created_at', from)
          .lte('created_at', to)
          .eq('status', 'delivered')
          .eq('is_training', false);
        if (oErr) throw oErr;
        const orderIds = (ordersData ?? []).map((o: { id: string }) => o.id);
        if (!orderIds.length) { setData(emptyResult); return; }

        const { data: itemsData, error: iErr } = await supabase
          .from('order_items')
          .select('item_id, item_name, item_price, quantity')
          .eq('tenant_id', user.tenantId)
          .in('order_id', orderIds);
        if (iErr) throw iErr;
        salesRows = (itemsData ?? []) as SalesRow[];
      }

      if (!salesRows.length) { setData(emptyResult); return; }

      // Agrega por item_id
      const salesMap = new Map<string, { item_name: string; qtd: number; receita: number; preco: number }>();
      for (const row of salesRows) {
        const key = row.item_id ?? `name:${row.item_name}`;
        const existing = salesMap.get(key);
        const qty = Number(row.quantity ?? 1);
        const price = Number(row.item_price ?? 0);
        if (existing) {
          existing.qtd += qty;
          existing.receita += price * qty;
        } else {
          salesMap.set(key, {
            item_name: row.item_name ?? 'Item',
            qtd: qty,
            receita: price * qty,
            preco: price,
          });
        }
      }

      // 2. Busca fichas técnicas
      itemIdsForFicha = [...salesMap.keys()]
        .filter((k) => !k.startsWith('name:'))
        .filter((k) => /^[0-9a-f-]{36}$/i.test(k));

      let categoriaMap = new Map<string, string>();
      let fichaMap = new Map<string, number>();

      if (itemIdsForFicha.length > 0) {
        let fichaOk = false;
        try {
          console.log('[useCmvReport] chamando get_cmv_ficha_tecnica', { item_ids: itemIdsForFicha.length });
          const { data: fichaResult, error: fichaEfErr } = await supabase.functions.invoke<{
            success: boolean;
            data?: { ficha_map: Record<string, number>; categoria_map: Record<string, string> };
          }>('stock-write', {
            body: { action: 'get_cmv_ficha_tecnica', tenant_id: user.tenantId, item_ids: itemIdsForFicha },
          });
          console.log('[useCmvReport] ficha resultado:', JSON.stringify(fichaResult), 'erro:', fichaEfErr);
          if (fichaResult?.success && fichaResult.data) {
            fichaMap = new Map(Object.entries(fichaResult.data.ficha_map ?? {}));
            categoriaMap = new Map(Object.entries(fichaResult.data.categoria_map ?? {}));
            console.log('[useCmvReport] fichaMap items:', fichaMap.size, 'categoriaMap:', categoriaMap.size);
            fichaOk = true;
          }
        } catch (efFichaErr) {
          console.warn('[useCmvReport] ficha edge fn falhou:', efFichaErr);
        }

        if (!fichaOk) {
          // Fallback: query direta
          const { data: menuItems } = await supabase
            .from('menu_items')
            .select('id, menu_categories(nome)')
            .in('id', itemIdsForFicha)
            .eq('tenant_id', user.tenantId);
          for (const mi of (menuItems ?? []) as Array<{ id: string; menu_categories: { nome: string } | null }>) {
            categoriaMap.set(mi.id, mi.menu_categories?.nome ?? '');
          }
          const { data: fichaRows } = await supabase
            .from('item_ingredients')
            .select('item_id, quantity, ingredients!inner(unit_price)')
            .in('item_id', itemIdsForFicha)
            .eq('tenant_id', user.tenantId);
          for (const row of (fichaRows ?? []) as Array<{ item_id: string; quantity: number; ingredients: { unit_price: number } }>) {
            const custo = Number(row.quantity ?? 0) * Number(row.ingredients?.unit_price ?? 0);
            fichaMap.set(row.item_id, (fichaMap.get(row.item_id) ?? 0) + custo);
          }
        }
      }

      // 3. Monta resultado final
      const itens: CmvItemVendido[] = [];
      for (const [key, sale] of salesMap.entries()) {
        const item_id = key.startsWith('name:') ? '' : key;
        const custoUnit = fichaMap.get(item_id) ?? 0;
        const temFicha = fichaMap.has(item_id);
        const custoTotal = custoUnit * sale.qtd;
        const cmvPct = sale.receita > 0 && temFicha ? (custoTotal / sale.receita) * 100 : 0;
        const margemBruta = sale.receita - custoTotal;
        const margemPct = sale.receita > 0 ? (margemBruta / sale.receita) * 100 : 0;

        itens.push({
          item_id,
          item_name: sale.item_name,
          categoria: categoriaMap.get(item_id) ?? '',
          qtd_vendida: sale.qtd,
          receita_total: sale.receita,
          preco_unitario: sale.preco,
          custo_unitario: custoUnit,
          custo_total: custoTotal,
          cmv_pct: cmvPct,
          margem_bruta: margemBruta,
          margem_pct: margemPct,
          tem_ficha: temFicha,
        });
      }

      // Totais gerais (apenas itens com ficha para o CMV%)
      const receitaTotal = itens.reduce((s, i) => s + i.receita_total, 0);
      const custoTotalGeral = itens.reduce((s, i) => s + i.custo_total, 0);
      const cmvPctGeral = receitaTotal > 0 ? (custoTotalGeral / receitaTotal) * 100 : 0;
      const margemBrutaTotal = receitaTotal - custoTotalGeral;

      const periodoLabel = getPeriodDates(periodo);
      setData({
        periodo_de: periodoLabel.from.slice(0, 10),
        periodo_ate: periodoLabel.to.slice(0, 10),
        receita_total: receitaTotal,
        custo_total: custoTotalGeral,
        cmv_pct_geral: cmvPctGeral,
        margem_bruta_total: margemBrutaTotal,
        itens: itens.sort((a, b) => b.receita_total - a.receita_total),
      });
    } catch (e) {
      console.error('[useCmvReport] error:', e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  return { data, loading, load };
}
