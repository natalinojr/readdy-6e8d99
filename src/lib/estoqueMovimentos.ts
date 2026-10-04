// Estoque › Movimentações: regras de classificação e leitura, sem tela (testadas em src/test/lib).
// Uma só regra para o filtro da lista, o texto do motivo e o sinal da quantidade.
import type { Movimentacao } from '@/types/estoque';

export type TipoLista = 'menos_vendas' | 'entradas' | 'perdas' | 'saidas' | 'producao' | 'contagem' | 'vendas';

/** Tipo da tela → tipos do banco que precisam vir (o filtro fino é refeito na lista por `passaNoTipo`). */
export const TIPOS_DB: Record<TipoLista, string[]> = {
  menos_vendas: ['in', 'transfer_in', 'manual_out', 'transfer_out', 'loss', 'inventory_adjustment'],
  entradas: ['in', 'transfer_in'],
  perdas: ['loss', 'manual_out'],
  saidas: ['manual_out', 'transfer_out'],
  producao: ['in', 'manual_out', 'loss'],
  contagem: ['inventory_adjustment'],
  vendas: ['theoretical_out'],
};

/** Estorno (produção excluída, pedido cancelado) devolve insumo: não é entrada nem saída de verdade. */
export const ehEstorno = (m: Pick<Movimentacao, 'motivo'>) => /^estorno/i.test(m.motivo ?? '');

/** Perda que mexeu no estoque. Perda em produção é só informativa (sinal 0) e conta como produção. */
export const ehPerdaReal = (m: Pick<Movimentacao, 'tipo' | 'sinal'>) => m.tipo === 'perda' && m.sinal !== 0;

export function passaNoTipo(m: Movimentacao, t: TipoLista): boolean {
  switch (t) {
    case 'menos_vendas': return m.tipo !== 'saida_venda';
    case 'vendas': return m.tipo === 'saida_venda';
    case 'entradas': return m.tipo === 'entrada' && !ehEstorno(m);
    case 'saidas': return m.tipo === 'saida_manual' && !ehEstorno(m);
    case 'perdas': return ehPerdaReal(m);
    case 'contagem': return m.tipo === 'ajuste_inventario';
    case 'producao':
      return m.tipo === 'entrada_producao' || m.tipo === 'saida_producao'
        || (m.tipo === 'perda' && m.sinal === 0)
        || (ehEstorno(m) && /produ[cç]/i.test(m.motivo ?? ''));
  }
}

/** Sinal para mostrar na quantidade. Com o dado do banco é exato (ajuste de contagem soma OU tira);
 *  sem ele, deduz pelo tipo e, no ajuste de contagem, não chuta: "±". */
export function sinalDaQuantidade(m: Pick<Movimentacao, 'tipo' | 'sinal'>): '+' | '−' | '' | '±' {
  if (m.sinal !== undefined && m.sinal !== null) return m.sinal > 0 ? '+' : m.sinal < 0 ? '−' : '';
  if (m.tipo === 'ajuste_inventario') return '±';
  return m.tipo === 'entrada' || m.tipo === 'entrada_producao' ? '+' : '−';
}

/** Motivo legível: troca os códigos internos (item_sale:uuid, id do item no estorno) por texto de gente. */
export function getMotivoDisplay(mv: Pick<Movimentacao, 'tipo' | 'motivo' | 'itemVendidoNome'>): { label: string; sub: string | null; cls: string } {
  const motivo = (mv.motivo ?? '').trim();
  if (mv.tipo === 'saida_venda') {
    if (mv.itemVendidoNome) return { label: mv.itemVendidoNome, sub: 'Baixa por venda', cls: 'text-sky-700 font-semibold' };
    if (!motivo || /^(item|combo)_sale:/.test(motivo)) return { label: 'Baixa automática por venda', sub: null, cls: 'text-zinc-500' };
  }
  if (motivo.startsWith('Producao:') || motivo.startsWith('Produção:')) {
    const label = motivo.replace('Producao:', '').replace('Produção:', '').trim();
    if (mv.tipo === 'saida_producao') return { label, sub: 'Saída (produção)', cls: 'text-amber-700 font-semibold' };
    if (mv.tipo === 'entrada_producao') return { label, sub: 'Entrada (produção)', cls: 'text-amber-600 font-semibold' };
    return { label, sub: 'Baixa por produção', cls: 'text-amber-700 font-semibold' };
  }
  if (motivo.startsWith('Perda em produção:')) {
    return { label: motivo.replace('Perda em produção:', '').trim(), sub: 'Perda em produção', cls: 'text-red-600 font-semibold' };
  }
  if (/^estorno/i.test(motivo)) {
    // "Estorno pedido #1a2b3c4d:<id do item>" → tira o id interno do fim
    return { label: motivo.replace(/:[0-9a-f-]{20,}$/i, ''), sub: null, cls: 'text-zinc-500' };
  }
  return { label: motivo || '—', sub: null, cls: 'text-zinc-500' };
}

/** Quantos dias tem o período, contando os dois extremos ('2026-10-01' a '2026-10-04' = 4). */
export function diasEntre(de: string, ate: string): number {
  const ms = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
  return Math.round((ms(ate) - ms(de)) / 86400000) + 1;
}

/** "Hoje · sábado 04/10", "Ontem · sexta 03/10", "quinta 02/10" (a data já é o dia de Brasília). */
export function tituloDoDia(ymd: string, hoje: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const semana = d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' });
  const dm = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  const ontem = new Date(`${hoje}T12:00:00Z`);
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  const prefixo = ymd === hoje ? 'Hoje · ' : ymd === ontem.toISOString().slice(0, 10) ? 'Ontem · ' : '';
  return `${prefixo}${semana} ${dm}`;
}
