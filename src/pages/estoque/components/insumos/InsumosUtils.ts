import type { Insumo } from '@/contexts/EstoqueContext';

export const statusEstoque = (i: Insumo) => {
  if (i.estoqueAtual <= 0 || i.esgotado) return { label: 'Esgotado', cls: 'text-red-600 bg-red-50' };
  const ratio = i.estoqueAtual / Math.max(i.estoqueMinimo, 0.001);
  if (ratio <= 0.5) return { label: 'Crítico', cls: 'text-red-600 bg-red-50' };
  if (ratio <= 1) return { label: 'Baixo', cls: 'text-amber-600 bg-amber-50' };
  return { label: 'Ok', cls: 'text-emerald-600 bg-emerald-50' };
};

export const barColor = (i: Insumo) => {
  if (i.esgotado || i.estoqueAtual <= 0) return 'bg-red-500';
  const ratio = i.estoqueAtual / Math.max(i.estoqueMinimo, 0.001);
  if (ratio <= 0.5) return 'bg-red-500';
  if (ratio <= 1) return 'bg-amber-400';
  return 'bg-emerald-500';
};

export const barWidth = (i: Insumo) => {
  if (i.estoqueMinimo <= 0) return 50;
  return Math.min((i.estoqueAtual / (i.estoqueMinimo * 2)) * 100, 100);
};

export const diasParaRuptura = (i: Insumo): number | null => {
  if (i.estoqueAtual <= 0 || i.esgotado) return 0;
  if (i.estoqueMinimo <= 0) return null;
  const consumoDiario = i.estoqueMinimo / 7;
  if (consumoDiario <= 0) return null;
  return Math.floor(i.estoqueAtual / consumoDiario);
};

export const exportarInsumosCSV = (insumos: Insumo[]) => {
  const headers = ['Nome', 'Categoria', 'Fornecedor', 'Unidade', 'Preço Unit. (R$)', 'Estoque Atual', 'Estoque Mínimo', 'Status', 'Última Atualização'];
  const rows = insumos.map((i) => {
    const ratio = i.estoqueMinimo > 0 ? i.estoqueAtual / i.estoqueMinimo : 2;
    const status = i.esgotado ? 'Esgotado' : ratio <= 0.5 ? 'Crítico' : ratio <= 1 ? 'Baixo' : 'Ok';
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
