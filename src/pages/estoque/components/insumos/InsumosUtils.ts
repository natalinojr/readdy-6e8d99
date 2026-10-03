import type { Insumo } from '@/contexts/EstoqueContext';
import { fmtPrecoUnit } from '@/lib/estoqueRegras';

// Rótulos pela regra única do estoque (src/lib/estoqueRegras.ts, 2026-10-03): estoque negativo é
// "Conferir" (o número está errado, não é esgotado de verdade); sem a antiga faixa "Crítico ≤ 50%".
export const statusEstoque = (i: Insumo) => {
  if (i.estoqueAtual < 0) return { label: 'Conferir', cls: 'text-red-700 bg-red-50' };
  if (i.estoqueAtual <= 0 || i.esgotado) return { label: 'Esgotado', cls: 'text-red-600 bg-red-50' };
  if (i.estoqueMinimo > 0 && i.estoqueAtual <= i.estoqueMinimo) return { label: 'Abaixo do mínimo', cls: 'text-amber-700 bg-amber-50' };
  return { label: 'Ok', cls: 'text-emerald-600 bg-emerald-50' };
};

export const barColor = (i: Insumo) => {
  const st = statusEstoque(i).label;
  if (st === 'Conferir' || st === 'Esgotado') return 'bg-red-500';
  if (st === 'Abaixo do mínimo') return 'bg-amber-400';
  return 'bg-emerald-500';
};

/** Preço por unidade do estoque legível: insumo em grama sai por kg (antes "R$ 0,00/g"). */
export const precoLegivel = (i: Insumo) => fmtPrecoUnit(i.precoUnitario, UNIDADE_DB[i.unidade] ?? i.unidade);
const UNIDADE_DB: Record<string, string> = { g: 'g', kg: 'kg', ml: 'ml', l: 'L', un: 'unit' };

export const barWidth = (i: Insumo) => {
  if (i.estoqueMinimo <= 0) return 50;
  return Math.min((i.estoqueAtual / (i.estoqueMinimo * 2)) * 100, 100);
};

export const exportarInsumosCSV = (insumos: Insumo[]) => {
  const headers = ['Nome', 'Categoria', 'Fornecedor', 'Unidade', 'Preço Unit. (R$)', 'Estoque Atual', 'Estoque Mínimo', 'Status', 'Última Atualização'];
  const rows = insumos.map((i) => {
    const status = statusEstoque(i).label;
    return [
      i.nome,
      i.categoria || 'Sem categoria',
      i.fornecedor || '',
      i.unidade,
      i.precoUnitario.toFixed(2).replace('.', ','),
      String(i.estoqueAtual),
      String(i.estoqueMinimo),
      status,
      i.ultimaEntrada,
    ];
  });
  const csv = [headers, ...rows].map((r) => r.join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `insumos_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
