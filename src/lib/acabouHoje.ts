// "Acabou hoje" além da lista do Cardápio (2026-10-06): o aviso ao finalizar (item que entrou no pedido antes de
// ser pausado) e o combo que fica indisponível quando um item dele acabou ou foi desligado.
// Regras puras (testadas em src/test/lib/acabouHoje.test.ts). A mesma regra do combo roda no servidor em
// supabase/functions/_shared/cardapio-pausa.ts (combosIndisponiveis) para os pedidos públicos.
import type { Combo, Item } from '@/types/cardapio';
import { estaPausado } from './cardapioLista';

// ── Combo ────────────────────────────────────────────────────────────────────

/**
 * Ids dos itens que travam um combo: pausados agora ("Acabou hoje") ou desligados no Cardápio.
 * `pausados` = os ids que o CardapioContext já calcula (itemPausado).
 */
export function idsQueTravamCombo(itens: Array<Pick<Item, 'id' | 'status'>>, pausados: Set<string>): Set<string> {
  const s = new Set(pausados);
  for (const i of itens) if (i.status !== 'ativo') s.add(i.id);
  return s;
}

/**
 * O combo está indisponível agora? Sim quando algum item dele está em `travam` ou não existe mais
 * (apagado: não veio no cardápio carregado). Linha do combo sem item ligado (só nome) não trava.
 * Lista de itens vazia (cardápio ainda carregando) não trava nada.
 */
export function comboIndisponivel(
  combo: Pick<Combo, 'itens'>,
  travam: Set<string>,
  idsExistentes?: Set<string>,
): boolean {
  return combo.itens.some((ci) => {
    if (!ci.itemId) return false;
    if (travam.has(ci.itemId)) return true;
    return !!idsExistentes && idsExistentes.size > 0 && !idsExistentes.has(ci.itemId);
  });
}

// ── Aviso ao finalizar ───────────────────────────────────────────────────────

export interface SituacaoPausa {
  pausadoAte: string | null;
  /** Quando foi marcado (menu_items.updated_at no momento da leitura; null = não sabe). */
  marcadoEm?: string | null;
  nome?: string;
}

export interface ItemAcabou {
  itemId: string;
  nome: string;
  marcadoEm: string | null;
}

/** Itens do carrinho que estão pausados agora, um por item (várias linhas do mesmo item = uma entrada). */
export function itensAcabaramNoCarrinho(
  linhas: Array<{ itemId?: string | null; nome: string }>,
  situacao: Map<string, SituacaoPausa>,
  agora: Date = new Date(),
): ItemAcabou[] {
  const vistos = new Set<string>();
  const out: ItemAcabou[] = [];
  for (const l of linhas) {
    const id = l.itemId ?? '';
    if (!id || vistos.has(id)) continue;
    const s = situacao.get(id);
    if (!s || !estaPausado(s.pausadoAte, agora)) continue;
    vistos.add(id);
    out.push({ itemId: id, nome: s.nome || l.nome, marcadoEm: s.marcadoEm ?? null });
  }
  return out;
}

/** "19:40" no relógio de Brasília ('' se não der para ler). */
export function horaBrasilia(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}

const comHora = (i: ItemAcabou) => {
  const h = horaBrasilia(i.marcadoEm);
  return h ? `${i.nome} acabou hoje (marcado às ${h})` : `${i.nome} acabou hoje`;
};

/** Texto do aviso: um item = a frase inteira no título; vários = um aviso só com a lista. */
export function textoAvisoAcabou(lista: ItemAcabou[]): { titulo: string; mensagem: string } {
  const dica = 'Tirar do pedido remove e recalcula o total, sem cobrar ainda: confira e finalize de novo.';
  if (lista.length === 1) return { titulo: `${comHora(lista[0])}. Tirar do pedido?`, mensagem: dica };
  return {
    titulo: `${lista.length} itens acabaram hoje. Tirar do pedido?`,
    mensagem: `${lista.map((i) => `• ${comHora(i)}`).join('\n')}\n\n${dica}`,
  };
}
