// Ficha do insumo (Estoque, 2026-10-04): texto e quantidade de cada movimentação, e datas curtas.
// Lógica pura para a FichaInsumoFolha e para os testes.
import { dateKeyBrasilia, formatOrderTime, somarDias, todayBrasilia } from './dateUtils';
import { fmtQtd } from './estoqueRegras';

/** Uma linha de fn_estoque_ficha_insumo › movimentos */
export interface MovFicha {
  id: string;
  /** Tipo do banco: in | theoretical_out | manual_out | loss | inventory_adjustment | transfer_in | transfer_out */
  tipo: string;
  quantidade: number;
  /** signed_quantity: com sinal. null em registro antigo. */
  sinal: number | null;
  motivo: string | null;
  created_at: string;
  operador: string | null;
  pedido: string | null;
  prato: string | null;
}

/** 'AAAA-MM-DD' ou timestamp → dd/mm (dia de Brasília). null se não der para ler. */
export function diaMes(v: string | null | undefined): string | null {
  if (!v) return null;
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : Number.isNaN(Date.parse(v)) ? null : dateKeyBrasilia(v);
  if (!ymd) return null;
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

/** "hoje 13:22", "ontem 20:05" ou "28/09 18:40" */
export function quandoCurto(iso: string): string {
  if (Number.isNaN(Date.parse(iso))) return '';
  const dia = dateKeyBrasilia(iso);
  const hoje = todayBrasilia();
  const hora = formatOrderTime(iso);
  if (dia === hoje) return `hoje ${hora}`;
  if (dia === somarDias(hoje, -1)) return `ontem ${hora}`;
  return `${diaMes(dia)} ${hora}`;
}

export type TomMov = 'blue' | 'green' | 'red' | 'amber' | 'zinc';

/** Texto simples e ícone de cada movimentação (o tipo vem do banco; o motivo refina). */
export function descreverMov(m: Pick<MovFicha, 'tipo' | 'motivo' | 'prato'>): { icone: string; tom: TomMov; texto: string } {
  const motivo = (m.motivo ?? '').trim();
  const ehProducao = /produ[cç][aã]o/i.test(motivo);
  if (/^estorno/i.test(motivo)) return { icone: 'ri-arrow-go-back-line', tom: 'zinc', texto: 'Estorno' };
  switch (m.tipo) {
    case 'theoretical_out':
      return { icone: 'ri-restaurant-line', tom: 'blue', texto: m.prato ? `Venda · ${m.prato}` : 'Venda' };
    case 'in': {
      if (ehProducao) return { icone: 'ri-knife-line', tom: 'amber', texto: 'Produção' };
      if (/^compra/i.test(motivo)) {
        const fornecedor = motivo.replace(/^compra:?\s*/i, '').split(/\s+-\s+NF/i)[0].trim();
        return { icone: 'ri-shopping-cart-2-line', tom: 'green', texto: fornecedor ? `Compra · ${fornecedor}` : 'Compra' };
      }
      return { icone: 'ri-add-circle-line', tom: 'green', texto: motivo ? `Entrada · ${motivo}` : 'Entrada' };
    }
    case 'transfer_in': return { icone: 'ri-store-2-line', tom: 'green', texto: 'Transferência recebida' };
    case 'transfer_out': return { icone: 'ri-store-2-line', tom: 'zinc', texto: 'Transferência enviada' };
    case 'loss': return { icone: 'ri-delete-bin-6-line', tom: 'red', texto: motivo ? `Perda · ${motivo}` : 'Perda' };
    case 'manual_out':
      if (ehProducao) return { icone: 'ri-knife-line', tom: 'amber', texto: 'Usado na produção' };
      return { icone: 'ri-subtract-line', tom: 'zinc', texto: motivo ? `Saída · ${motivo}` : 'Saída' };
    case 'inventory_adjustment':
      return { icone: 'ri-scales-3-line', tom: 'zinc', texto: /inicial/i.test(motivo) ? 'Contagem inicial' : 'Contagem' };
    default:
      return { icone: 'ri-arrow-left-right-line', tom: 'zinc', texto: motivo || 'Movimento' };
  }
}

/** Quantidade com sinal na unidade do insumo. Sem sinal gravado (registro antigo), deduz pelo tipo;
 *  ajuste de contagem antigo fica sem sinal (não dá para saber se somou ou tirou). */
export function qtdComSinal(m: Pick<MovFicha, 'tipo' | 'quantidade' | 'sinal'>, unidade: string): { texto: string; positivo: boolean } {
  let s = m.sinal;
  if (s == null) {
    if (m.tipo === 'in' || m.tipo === 'transfer_in') s = Math.abs(m.quantidade);
    else if (m.tipo === 'inventory_adjustment') return { texto: fmtQtd(Math.abs(m.quantidade), unidade), positivo: false };
    else s = -Math.abs(m.quantidade);
  }
  if (s === 0) return { texto: fmtQtd(0, unidade), positivo: false };
  return { texto: `${s > 0 ? '+' : '−'}${fmtQtd(Math.abs(s), unidade)}`, positivo: s > 0 };
}
