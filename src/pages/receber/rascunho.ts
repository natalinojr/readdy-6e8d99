// O recebimento em andamento na tela (um só formato para nota, compra, cupom e sem nota).
import type { Aberto, Insumo, Origem, Pagamento, ScanItem, ScanResult } from './api';
import { hojeISO } from './api';

export interface ItemR {
  key: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  valor_total: number;
  recebido: number;
  ingredient_id: string | null;
  units_per_package: number;
  fonte: string | null;
  /** Usuário tocou em "Chegou diferente" (mantém o campo aberto mesmo com a quantidade igual). */
  marcadoDiferente?: boolean;
  /** Usuário conferiu o item (tocou em "Chegou tudo" ou "Chegou diferente"); nada vem marcado. */
  conferido?: boolean;
  /** Usuário escolheu o insumo/fator na tela (senão o purchase-write converte sozinho). */
  fatorManual?: boolean;
  /** Linha lida do cupom (para lançar e memorizar o vínculo). */
  scan?: ScanItem;
}

export interface Rascunho {
  origem: Origem;
  id?: string;
  fornecedor: string;
  numero: string | null;
  data: string;
  valor: number;
  itens: ItemR[];
  insumos: Insumo[];
  /** Como a nota/compra já diz que será paga (null = cupom e sem nota). */
  pagInfo: Aberto['pagamento'] | null;
  semItens?: boolean;
  estoqueJaAplicado?: boolean;
  pagamento: Pagamento | null;
  forma: string;
  vencimento: string;
  chave?: string;
  supplierKey?: string;
  recebidoEm: string;
  obs: string;
  /** Identifica este lançamento: reenviar (sem internet, timeout) não lança de novo. */
  ref: string;
}

const novaRef = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

export const precisaPagamento = (r: Rascunho) => !(r.pagInfo?.ja_definido);
export const podeMudarQuantidade = (r: Rascunho) => r.origem === 'nota' || r.origem === 'compra';

export function deAberto(a: Aberto): Rascunho {
  return {
    origem: a.tipo, id: a.id, fornecedor: a.fornecedor, numero: a.numero, data: a.data, valor: a.valor,
    itens: a.itens.map((it) => ({ ...it, recebido: it.quantidade })),
    insumos: a.insumos, pagInfo: a.pagamento, semItens: a.sem_itens, estoqueJaAplicado: a.estoque_ja_aplicado,
    pagamento: null, forma: 'PIX', vencimento: '', recebidoEm: hojeISO(), obs: '', ref: novaRef(),
  };
}

export function deCupom(s: ScanResult, insumos: Insumo[]): Rascunho {
  const itens: ItemR[] = s.items.map((it, i) => {
    const pc = Number(it.pack_count ?? 0), ps = Number(it.pack_size ?? 0);
    return {
      key: String(i), descricao: it.raw_description, unidade: it.unit_label || 'un', quantidade: Number(it.quantity ?? 0),
      valor_total: Math.round((Number(it.line_total ?? 0) - Number(it.line_discount ?? 0)) * 100) / 100,
      recebido: Number(it.quantity ?? 0), ingredient_id: it.ingredient_id,
      units_per_package: pc > 0 && ps > 0 ? pc * ps : 1,
      fonte: it.match_source === 'memoria' ? 'memorizado' : it.ingredient_id ? 'sugerido' : null,
      scan: it,
    };
  });
  // Desconto no total do cupom que não veio nos itens: rateia, senão a compra (e a sangria)
  // sairia maior que o dinheiro que saiu do caixa
  const soma = Math.round(itens.reduce((t, i) => t + i.valor_total, 0) * 100) / 100;
  const total = s.document_total != null && s.document_total > 0 ? Math.round(s.document_total * 100) / 100 : soma;
  if (soma > 0 && Math.abs(soma - total) >= 0.01 && total < soma) {
    let resto = total;
    itens.forEach((it, i) => {
      if (i === itens.length - 1) { it.valor_total = Math.round(resto * 100) / 100; return; }
      it.valor_total = Math.round((it.valor_total * total / soma) * 100) / 100;
      resto -= it.valor_total;
    });
  }
  return {
    origem: 'cupom', fornecedor: s.supplier_name ?? '', numero: s.invoice_number, data: s.purchase_date ?? hojeISO(),
    valor: total, itens, insumos, pagInfo: null, pagamento: 'dinheiro', forma: 'PIX', vencimento: '',
    chave: s.access_key, supplierKey: s.supplier_key, recebidoEm: hojeISO(), obs: '', ref: novaRef(),
  };
}

export function novoSemNota(insumos: Insumo[]): Rascunho {
  return {
    origem: 'sem_nota', fornecedor: '', numero: null, data: hojeISO(), valor: 0, itens: [], insumos,
    pagInfo: null, pagamento: 'dinheiro', forma: 'PIX', vencimento: '', recebidoEm: hojeISO(), obs: '', ref: novaRef(),
  };
}
