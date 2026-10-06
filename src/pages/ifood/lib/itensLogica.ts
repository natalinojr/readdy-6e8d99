import { custoDoItem, resumoItens, type ItemArea, type MapaCustos } from '@/lib/ifoodArea';
import type { PedidoIfood } from '@/lib/ifoodDashboard';

// Lógica pura da aba Itens e CMV e da folha "Ligar à ficha" (área iFood, 2026-10-05).

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export type ChipItens = 'vendidos' | 'prejuizo' | 'semficha' | 'pior' | 'complementos';

/** Margem do item: verde ≥ 25%, âmbar de 0 a 25%, vermelho negativa; `sem` = sem ficha; `aberto` = tem ficha mas ainda não dá para fechar a conta. */
export type ClasseMargem = 'verde' | 'ambar' | 'vermelho' | 'sem' | 'aberto';
export function classeMargem(i: Pick<ItemArea, 'custoUnit' | 'margem'>): ClasseMargem {
  if (i.custoUnit == null) return 'sem';
  if (i.margem == null) return 'aberto';
  if (i.margem < 0) return 'vermelho';
  return i.margem >= 25 ? 'verde' : 'ambar';
}

/** O item tem ficha própria, mas falta a ficha de um complemento que cobra à parte (a conta do item fica em aberto). */
export function bloqueadoPorComplemento(i: ItemArea, custos: MapaCustos): boolean {
  if (i.nivel !== 'item' || i.custoUnit != null) return false;
  return custoDoItem(custos, i.nome)?.custo != null;
}

/** Itens e complementos (com preço) que precisam de ligação à ficha, do que mais vendeu para o que menos vendeu. */
export function semFichaDe(itens: ItemArea[], custos: MapaCustos): ItemArea[] {
  return resumoItens(itens).semFicha
    .filter((i) => !bloqueadoPorComplemento(i, custos))
    .sort((a, b) => b.faturado - a.faturado || b.qtd - a.qtd);
}

/** Complemento que cobra algum valor (os de R$ 0 — "sem cebola" — não entram na lista). */
export const complementoComPreco = (i: ItemArea) => i.nivel === 'complemento' && i.precoMedio > 0.005;

/** Lista de cada chip. `itens` vem de itensDosPedidos/itensDoCardapio (todos os níveis). */
export function listaDoChip(itens: ItemArea[], chip: ChipItens, custos: MapaCustos): ItemArea[] {
  const soItens = itens.filter((i) => i.nivel === 'item');
  switch (chip) {
    case 'prejuizo':
      return soItens.filter((i) => i.sobraUnit != null && i.sobraUnit < -0.005)
        .sort((a, b) => (a.sobraUnit ?? 0) * a.qtd - (b.sobraUnit ?? 0) * b.qtd);
    case 'semficha':
      return semFichaDe(itens, custos);
    case 'pior':
      return soItens.filter((i) => i.margem != null).sort((a, b) => (a.margem ?? 0) - (b.margem ?? 0) || b.faturado - a.faturado);
    case 'complementos':
      return itens.filter(complementoComPreco).sort((a, b) => b.faturado - a.faturado || b.qtd - a.qtd);
    default:
      return soItens.slice().sort((a, b) => b.faturado - a.faturado || b.qtd - a.qtd);
  }
}

/** Fator do período (quanto chega de cada R$ 1 vendido) = Σ liquido ÷ Σ vendas dos pedidos não cancelados. */
export function fatorDoPeriodo(fin: PedidoIfood[], merchantId?: string | null): number | null {
  let vendas = 0, liquido = 0;
  for (const p of fin) {
    if (p.cancelado || (merchantId && p.loja !== merchantId)) continue;
    vendas += p.vendas; liquido += p.liquido;
  }
  return vendas > 0.005 ? liquido / vendas : null;
}

/** Como o custo do item foi montado, em palavras. */
export function descricaoLigacao(i: Pick<ItemArea, 'tipoLigacao' | 'alvo'>): string {
  switch (i.tipoLigacao) {
    case 'item': case 'combo': return `ficha: ${i.alvo ?? 'item do cardápio'}`;
    case 'option': return `opção do cardápio: ${i.alvo ?? ''}`.trim();
    case 'composicao': return 'custo montado à mão';
    case 'sem_estoque': return 'Não usa estoque';
    case 'escolhas': return 'Combo de escolhas: a comida é o que o cliente escolhe';
    default: return 'sem ficha';
  }
}

// ── Ligar à ficha ────────────────────────────────────────────────────────────

export interface AlvoCardapio { kind: 'item' | 'combo' | 'option'; id: string; nome: string; detalhe: string | null }

const RANK_ITEM: Record<AlvoCardapio['kind'], number> = { item: 0, combo: 1, option: 9 };
const RANK_COMP: Record<AlvoCardapio['kind'], number> = { option: 0, item: 1, combo: 2 };

/**
 * Alvos que a pessoa pode escolher. Produto do iFood liga a item ou combo; complemento liga também a opção
 * (e as opções vêm primeiro). Busca sem acento, todas as palavras precisam aparecer. Não sugere par: sem
 * texto, só lista em ordem alfabética.
 */
export function buscarAlvos(alvos: AlvoCardapio[], nivel: 'item' | 'complemento', texto: string, limite = 40): AlvoCardapio[] {
  const tokens = semAcento(texto).split(/\s+/).filter(Boolean);
  const rank = nivel === 'item' ? RANK_ITEM : RANK_COMP;
  return alvos
    .filter((a) => (nivel === 'item' ? a.kind !== 'option' : true))
    .filter((a) => {
      if (!tokens.length) return true;
      const alvo = semAcento(`${a.nome} ${a.detalhe ?? ''}`);
      return tokens.every((t) => alvo.includes(t));
    })
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, limite);
}

/** Posição de uma chave na fila de "sem ficha" (-1 se não está). */
export const posicaoNaFila = (fila: Array<{ chave: string }>, chave: string | null) => (chave ? fila.findIndex((i) => i.chave === chave) : -1);

/** Texto "1 de 9 sem ficha" da folha de ligar. */
export const rotuloPasso = (indice: number, total: number) => `${Math.min(indice + 1, total)} de ${total} sem ficha`;

/** "3 itens" / "1 item". */
export const nItens = (n: number) => `${n.toLocaleString('pt-BR')} ${n === 1 ? 'item' : 'itens'}`;

// ── Frase do topo ────────────────────────────────────────────────────────────

const R = (v: number) => `R$ ${Math.round(Math.abs(v)).toLocaleString('pt-BR')}`;

/**
 * "De cada R$ 100 em itens, sobram R$ 31" + "Depois do iFood (R$ 35) e da comida (R$ 34). 2 itens dão prejuízo e 9 não têm ficha."
 * Sem nenhuma ficha (de100 nulo): "Ligue os itens à ficha para ver quanto sobra". Sem acesso ao dinheiro: só a cobertura.
 */
export function fraseItens(p: {
  de100: { ifood: number; comida: number; sobra: number } | null;
  prejuizo: number; semFicha: number; itensVendidos: number; dinheiro: boolean;
}): { manchete: string; sub: string } {
  const prej = p.prejuizo === 0 ? 'Nenhum item dá prejuízo' : p.prejuizo === 1 ? '1 item dá prejuízo' : `${p.prejuizo} itens dão prejuízo`;
  const sem = p.semFicha === 0 ? 'todos têm ficha' : p.semFicha === 1 ? '1 não tem ficha' : `${p.semFicha} não têm ficha`;
  const fecho = p.semFicha > 0 ? ' A conta ainda está incompleta.' : '';
  if (!p.dinheiro) {
    return { manchete: `${p.itensVendidos.toLocaleString('pt-BR')} itens vendidos`, sub: `${p.semFicha === 0 ? 'Todos têm ficha.' : `${sem[0].toUpperCase()}${sem.slice(1)}.`}` };
  }
  if (!p.de100) return { manchete: 'Ligue os itens à ficha para ver o lucro bruto', sub: `${p.semFicha.toLocaleString('pt-BR')} ${p.semFicha === 1 ? 'item ainda não tem' : 'itens ainda não têm'} ficha.` };
  const s = p.de100.sobra;
  return {
    manchete: s >= 0 ? `De cada R$ 100 em itens, ficam ${R(s)} de lucro bruto` : `De cada R$ 100 em itens, você perde ${R(s)}`,
    sub: `Sem promoções: depois da comissão e taxa do iFood (${R(p.de100.ifood)}) e da comida (${R(p.de100.comida)}). ${prej} e ${sem}.${fecho}`,
  };
}
