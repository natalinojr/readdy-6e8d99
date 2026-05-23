import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface ComparativoIngrediente {
  id: string;
  nome: string;
  unidade: string;
  categoria: string;
  fornecedor: string;
  estoqueAtual: number;
  minimo: number;
  // Período atual
  consumoAtual: number;
  custoAtual: number;
  mediaDiariaAtual: number;
  consumoVendasAtual: number;
  consumoProducaoAtual: number;
  consumoPerdaAtual: number;
  // Período anterior
  consumoAnterior: number;
  custoAnterior: number;
  mediaDiariaAnterior: number;
  consumoVendasAnt: number;
  consumoProducaoAnt: number;
  consumoPerdaAnt: number;
  // Variações
  varConsumo: number;
  varCusto: number;
  varMediaDiaria: number;
}

export interface ComparativoResumo {
  totalConsumoAtual: number;
  totalConsumoAnterior: number;
  varConsumoTotal: number;
  totalCustoAtual: number;
  totalCustoAnterior: number;
  varCustoTotal: number;
  ingredientesCresceram: number;
  ingredientesDiminuiram: number;
}

function classifyMovement(reason: string | null, type: string): 'vendas' | 'producao' | 'perda' | 'outro' {
  if (!reason) {
    if (type === 'manual_out') return 'outro';
    return 'vendas';
  }
  const r = reason.toLowerCase();
  if (r.includes('item_sale') || r.includes('venda') || r.includes('sale')) return 'vendas';
  if (r.includes('producao') || r.includes('produção') || r.includes('produ')) return 'producao';
  if (r.includes('perda') || r.includes('quebra') || r.includes('waste')) return 'perda';
  if (type === 'theoretical_out') return 'vendas';
  return 'outro';
}

export function useConsumoComparativo(dateFrom?: string, dateTo?: string) {
  const { user } = useAuth();
  const [dados, setDados] = useState<ComparativoIngrediente[]>([]);
  const [resumo, setResumo] = useState<ComparativoResumo | null>(null);
  const [loading, setLoading] = useState(false);

  const tenantIdFromStorage = typeof window !== 'undefined'
    ? localStorage.getItem('erpos_selected_tenant_id')
    : null;

  // PRIORIDADE: localStorage (fonte mais confiável) > user.tenantId
  const rawTenantId =
    tenantIdFromStorage ||
    user?.tenantId ||
    '';

  const tenantIdFinal = rawTenantId && String(rawTenantId).trim().length > 0
    ? String(rawTenantId).trim()
    : null;

  const load = useCallback(async () => {
    const tId = tenantIdFinal;
    if (!tId) return;
    setLoading(true);

    const to = dateTo ?? new Date().toISOString().split('T')[0];
    const from = dateFrom ?? new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    const diasPeriodo = Math.max(1, Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000));

    // Período anterior: mesma duração, imediatamente antes
    const fromDate = new Date(from + 'T00:00:00');
    const toDate = new Date(to + 'T23:59:59');
    const fromAnterior = new Date(fromDate.getTime() - diasPeriodo * 86400000).toISOString().split('T')[0];
    const toAnterior = new Date(toDate.getTime() - diasPeriodo * 86400000).toISOString().split('T')[0];

    const fromTs = `${from}T00:00:00`;
    const toTs = `${to}T23:59:59`;
    const fromAntTs = `${fromAnterior}T00:00:00`;
    const toAntTs = `${toAnterior}T23:59:59`;

    try {
      // Busca ingredientes
      const { data: ings, error: ingsErr } = await supabase
        .from('ingredients')
        .select('id, name, unit, category, supplier, current_stock, min_stock, unit_price')
        .eq('tenant_id', tId)
        .is('deleted_at', null);

      if (ingsErr) throw ingsErr;

      // Movimentações período atual
      const { data: movsAtual } = await supabase
        .from('stock_movements')
        .select('ingredient_id, quantity, type, reason, created_at')
        .eq('tenant_id', tId)
        .in('type', ['theoretical_out', 'manual_out'])
        .gte('created_at', fromTs)
        .lte('created_at', toTs);

      // Movimentações período anterior
      const { data: movsAnterior } = await supabase
        .from('stock_movements')
        .select('ingredient_id, quantity, type, reason, created_at')
        .eq('tenant_id', tId)
        .in('type', ['theoretical_out', 'manual_out'])
        .gte('created_at', fromAntTs)
        .lte('created_at', toAntTs);

      // Agrupa consumo atual
      const consumoAtualMap = new Map<string, { total: number; dias: Set<string>; vendas: number; producao: number; perda: number }>();
      for (const mov of (movsAtual ?? [])) {
        const prev = consumoAtualMap.get(mov.ingredient_id) ?? { total: 0, dias: new Set<string>(), vendas: 0, producao: 0, perda: 0 };
        const qtd = Math.abs(Number(mov.quantity));
        prev.total += qtd;
        const tipo = classifyMovement(mov.reason, mov.type);
        if (tipo === 'vendas') prev.vendas += qtd;
        else if (tipo === 'producao') prev.producao += qtd;
        else if (tipo === 'perda') prev.perda += qtd;
        if (mov.created_at) prev.dias.add(mov.created_at.split('T')[0]);
        consumoAtualMap.set(mov.ingredient_id, prev);
      }

      // Agrupa consumo anterior
      const consumoAnteriorMap = new Map<string, { total: number; dias: Set<string>; vendas: number; producao: number; perda: number }>();
      for (const mov of (movsAnterior ?? [])) {
        const prev = consumoAnteriorMap.get(mov.ingredient_id) ?? { total: 0, dias: new Set<string>(), vendas: 0, producao: 0, perda: 0 };
        const qtd = Math.abs(Number(mov.quantity));
        prev.total += qtd;
        const tipo = classifyMovement(mov.reason, mov.type);
        if (tipo === 'vendas') prev.vendas += qtd;
        else if (tipo === 'producao') prev.producao += qtd;
        else if (tipo === 'perda') prev.perda += qtd;
        if (mov.created_at) prev.dias.add(mov.created_at.split('T')[0]);
        consumoAnteriorMap.set(mov.ingredient_id, prev);
      }

      const result: ComparativoIngrediente[] = ((ings ?? []) as Array<{
        id: string; name: string; unit: string; category: string | null;
        supplier: string | null; current_stock: number; min_stock: number; unit_price: number;
      }>).map((ing) => {
        const atual = consumoAtualMap.get(ing.id) ?? { total: 0, dias: new Set<string>(), vendas: 0, producao: 0, perda: 0 };
        const anterior = consumoAnteriorMap.get(ing.id) ?? { total: 0, dias: new Set<string>(), vendas: 0, producao: 0, perda: 0 };

        const unitPrice = Number(ing.unit_price ?? 0);
        const consumoAtual = atual.total;
        const consumoAnterior = anterior.total;
        const custoAtual = consumoAtual * unitPrice;
        const custoAnterior = consumoAnterior * unitPrice;
        const mediaAtual = atual.dias.size > 0 ? consumoAtual / atual.dias.size : 0;
        const mediaAnterior = anterior.dias.size > 0 ? consumoAnterior / anterior.dias.size : 0;

        const varConsumo = consumoAnterior > 0 ? ((consumoAtual - consumoAnterior) / consumoAnterior) * 100 : 0;
        const varCusto = custoAnterior > 0 ? ((custoAtual - custoAnterior) / custoAnterior) * 100 : 0;
        const varMediaDiaria = mediaAnterior > 0 ? ((mediaAtual - mediaAnterior) / mediaAnterior) * 100 : 0;

        return {
          id: ing.id,
          nome: ing.name,
          unidade: ing.unit,
          categoria: ing.category ?? '—',
          fornecedor: ing.supplier ?? '—',
          estoqueAtual: Number(ing.current_stock ?? 0),
          minimo: Number(ing.min_stock ?? 0),
          consumoAtual,
          custoAtual,
          mediaDiariaAtual: mediaAtual,
          consumoVendasAtual: atual.vendas,
          consumoProducaoAtual: atual.producao,
          consumoPerdaAtual: atual.perda,
          consumoAnterior,
          custoAnterior,
          mediaDiariaAnterior: mediaAnterior,
          consumoVendasAnt: anterior.vendas,
          consumoProducaoAnt: anterior.producao,
          consumoPerdaAnt: anterior.perda,
          varConsumo,
          varCusto,
          varMediaDiaria,
        };
      });

      result.sort((a, b) => b.varConsumo - a.varConsumo);

      const cresceram = result.filter((r) => r.varConsumo > 10).length;
      const diminuiram = result.filter((r) => r.varConsumo < -10).length;

      setDados(result);
      setResumo({
        totalConsumoAtual: result.reduce((s, r) => s + r.consumoAtual, 0),
        totalConsumoAnterior: result.reduce((s, r) => s + r.consumoAnterior, 0),
        varConsumoTotal: result.reduce((s, r) => s + r.consumoAnterior, 0) > 0
          ? ((result.reduce((s, r) => s + r.consumoAtual, 0) - result.reduce((s, r) => s + r.consumoAnterior, 0)) / result.reduce((s, r) => s + r.consumoAnterior, 0)) * 100
          : 0,
        totalCustoAtual: result.reduce((s, r) => s + r.custoAtual, 0),
        totalCustoAnterior: result.reduce((s, r) => s + r.custoAnterior, 0),
        varCustoTotal: result.reduce((s, r) => s + r.custoAnterior, 0) > 0
          ? ((result.reduce((s, r) => s + r.custoAtual, 0) - result.reduce((s, r) => s + r.custoAnterior, 0)) / result.reduce((s, r) => s + r.custoAnterior, 0)) * 100
          : 0,
        ingredientesCresceram: cresceram,
        ingredientesDiminuiram: diminuiram,
      });
    } catch (e) {
      console.error('[useConsumoComparativo]', e);
    } finally {
      setLoading(false);
    }
  }, [tenantIdFinal, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  return { dados, resumo, loading, reload: load };
}