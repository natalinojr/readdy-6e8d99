// Regras puras da lista de itens do Cardápio (layout novo, 2026-10-06): "Acabou hoje", ordem por mais vendidos,
// busca sem acento, preço na linha e ações em lote (o que muda, o que dizer e como desfazer).
// Sem custo nem margem por decisão do dono: a lista só mostra preço, situação e onde o item aparece.
import { extraMinimoGruposItem } from './precoAPartirDe';
import type { Destaque, Item } from '@/types/cardapio';

// ── "Acabou hoje" ────────────────────────────────────────────────────────────
// Mesma regra de supabase/functions/_shared/cardapio-pausa.ts (o servidor grava; aqui só mostra e filtra).
export const PAUSA_HORA_VOLTA = 5;
const OFFSET_BRASILIA_MS = 3 * 3_600_000;

/** ISO (UTC) da próxima 05:00 de Brasília estritamente depois de `agora` (volta antes de a loja abrir). */
export function pausaAteDe(agora: Date = new Date()): string {
  const local = new Date(agora.getTime() - OFFSET_BRASILIA_MS);
  const alvo = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), PAUSA_HORA_VOLTA, 0, 0);
  const alvoLocal = alvo <= local.getTime() ? alvo + 86_400_000 : alvo;
  return new Date(alvoLocal + OFFSET_BRASILIA_MS).toISOString();
}

/** O item está pausado agora? (null/vazio/data passada = não) */
export function estaPausado(pausadoAte: string | null | undefined, agora: Date = new Date()): boolean {
  if (!pausadoAte) return false;
  const t = new Date(pausadoAte).getTime();
  return Number.isFinite(t) && t > agora.getTime();
}

const diaBrasilia = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** "Pausado até amanhã" (volta em outro dia) ou "Pausado até as 5h" (madrugada: volta hoje). */
export function rotuloPausa(pausadoAte: string | null | undefined, agora: Date = new Date()): string {
  if (!estaPausado(pausadoAte, agora)) return '';
  const fim = new Date(pausadoAte as string);
  if (diaBrasilia(fim) === diaBrasilia(agora)) {
    const h = fim.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return `Pausado até as ${h.replace(':00', 'h')}`;
  }
  return 'Pausado até amanhã';
}

// ── Onde aparece ─────────────────────────────────────────────────────────────
export type Disponibilidade = 'ambos' | 'casa' | 'delivery';

/** Mesma leitura do seletor antigo: só delivery / só casa (delivery desligado) / os dois. */
export function disponibilidadeDe(item: Pick<Item, 'somenteDelivery' | 'delivery'>): Disponibilidade {
  if (item.somenteDelivery) return 'delivery';
  if (item.delivery?.ativo === false) return 'casa';
  return 'ambos';
}

export const NOME_DISPONIBILIDADE: Record<Disponibilidade, string> = { casa: 'Balcão', ambos: 'Os dois', delivery: 'Delivery' };
/** "Balcão" = caixa, totem, mesa e garçom. */
export const DICA_DISPONIBILIDADE: Record<Disponibilidade, string> = {
  casa: 'Só no balcão: caixa, totem, mesa e garçom',
  ambos: 'No balcão (caixa, totem, mesa e garçom) e no delivery',
  delivery: 'Só no delivery',
};

/** O que a mudança de canal faz com o item (igual ao salvarItem / set_category_channel). */
export function comDisponibilidade(item: Item, val: Disponibilidade): Item {
  const base = item.delivery ?? { ativo: true };
  const canaisTodos = { cashier: true, waiter: true, delivery: true, table_qr: true, self_service: true };
  const soDelivery = { cashier: false, waiter: false, delivery: true, table_qr: false, self_service: false };
  if (val === 'delivery') return { ...item, somenteDelivery: true, canais: soDelivery, delivery: { ...base, ativo: true } };
  if (val === 'casa') return { ...item, somenteDelivery: false, canais: canaisTodos, delivery: { ...base, ativo: false } };
  return { ...item, somenteDelivery: false, canais: canaisTodos, delivery: { ...base, ativo: true } };
}

// ── Busca ────────────────────────────────────────────────────────────────────
export const semAcento = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Sem acento e por pedaço: cada palavra digitada precisa aparecer no nome, na descrição ou na categoria. */
export function combinaBusca(termo: string, ...textos: Array<string | null | undefined>): boolean {
  const partes = semAcento(termo).split(/\s+/).filter(Boolean);
  if (!partes.length) return true;
  const alvo = semAcento(textos.filter(Boolean).join(' '));
  return partes.every((p) => alvo.includes(p));
}

// ── Ordem ────────────────────────────────────────────────────────────────────
/** Mais vendidos primeiro (empate = ordem do cardápio, depois nome). Sem leitura de vendas = ordem do cardápio. */
export function ordenarItens<T extends Pick<Item, 'id' | 'ordem' | 'nome'>>(itens: T[], vendas: Map<string, number> | null): T[] {
  return [...itens].sort((a, b) => {
    if (vendas) {
      const d = (vendas.get(b.id) ?? 0) - (vendas.get(a.id) ?? 0);
      if (d !== 0) return d;
    }
    return (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

// ── Preço na linha ───────────────────────────────────────────────────────────
export type PrecoLido = { ok: true; valor: number } | { ok: false; erro: string };

/** Lê "12,50", "12.5", "R$ 1.234,56". Precisa ser maior que zero. */
export function lerPreco(texto: string): PrecoLido {
  let t = String(texto ?? '').replace(/r\$/i, '').replace(/\s/g, '');
  if (!t) return { ok: false, erro: 'Digite o preço.' };
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return { ok: false, erro: 'Use só números, ex.: 32,90.' };
  const valor = Math.round(Number(t) * 100) / 100;
  if (!(valor > 0)) return { ok: false, erro: 'O preço precisa ser maior que zero.' };
  if (valor > 99_999) return { ok: false, erro: 'Preço alto demais. Confira o valor.' };
  return { ok: true, valor };
}

/** O item tem preço próprio de delivery diferente do da casa? (a linha mostra só o da casa) */
export function temPrecoDeliveryProprio(item: Pick<Item, 'preco' | 'delivery'>): boolean {
  const p = item.delivery?.preco;
  return item.delivery?.ativo !== false && p != null && Number(p) > 0 && Number(p) !== item.preco;
}

// ── Lote ─────────────────────────────────────────────────────────────────────
/** O que uma ação em lote muda. Um campo por vez (é o que a barra oferece). */
export type MudancaLote =
  | { tipo: 'ativo'; valor: boolean }
  | { tipo: 'canal'; valor: Disponibilidade }
  | { tipo: 'categoria'; valor: string }
  | { tipo: 'pausa'; valor: boolean };

/** Aplica a mudança no item (atualização otimista; o servidor grava o mesmo). */
export function aplicarMudanca(item: Item, m: MudancaLote, pausaAte: string = pausaAteDe()): Item {
  if (m.tipo === 'ativo') return { ...item, status: m.valor ? 'ativo' : 'inativo' };
  if (m.tipo === 'canal') return comDisponibilidade(item, m.valor);
  if (m.tipo === 'categoria') return { ...item, categoriaId: m.valor };
  return m.valor ? { ...item, pausadoAte: pausaAte } : { ...item, pausadoAte: null, pausadoMotivo: null };
}

/** Payload do menu-write › bulk_update_items para a mudança. */
export function payloadLote(ids: string[], m: MudancaLote): Record<string, unknown> {
  const base = { item_ids: ids };
  if (m.tipo === 'ativo') return { ...base, is_active: m.valor };
  if (m.tipo === 'canal') return { ...base, disponibilidade: m.valor };
  if (m.tipo === 'categoria') return { ...base, category_id: m.valor };
  return { ...base, pausar: m.valor };
}

/**
 * Como voltar ao que era: agrupa os itens pelo valor de ANTES e devolve uma mudança por grupo
 * (ex.: desativar 5 itens em que 1 já estava inativo → só os 4 voltam a ativo). Item que já estava
 * no valor novo não entra.
 */
export function gruposDesfazer(antes: Item[], m: MudancaLote, agora: Date = new Date()): Array<{ ids: string[]; mudanca: MudancaLote }> {
  const grupos = new Map<string, { ids: string[]; mudanca: MudancaLote }>();
  const por = (chave: string, mudanca: MudancaLote, id: string) => {
    const g = grupos.get(chave) ?? { ids: [], mudanca };
    g.ids.push(id);
    grupos.set(chave, g);
  };
  for (const it of antes) {
    if (m.tipo === 'ativo') {
      const era = it.status === 'ativo';
      if (era !== m.valor) por(String(era), { tipo: 'ativo', valor: era }, it.id);
    } else if (m.tipo === 'canal') {
      const era = disponibilidadeDe(it);
      if (era !== m.valor) por(era, { tipo: 'canal', valor: era }, it.id);
    } else if (m.tipo === 'categoria') {
      if (it.categoriaId !== m.valor) por(it.categoriaId, { tipo: 'categoria', valor: it.categoriaId }, it.id);
    } else {
      const era = estaPausado(it.pausadoAte, agora);
      if (era !== m.valor) por(String(era), { tipo: 'pausa', valor: era }, it.id);
    }
  }
  return [...grupos.values()];
}

/** Frase da barra depois da mudança: "Burrito desativado: saiu do totem, QR, delivery e PDV". */
export function fraseMudanca(m: MudancaLote, nomes: string[], nomeCategoria?: string): string {
  const quem = nomes.length === 1 ? nomes[0] : `${nomes.length} itens`;
  const plural = nomes.length > 1;
  if (m.tipo === 'ativo') {
    return m.valor
      ? `${quem} ${plural ? 'ativados' : 'ativado'}: ${plural ? 'voltaram' : 'voltou'} para o totem, QR, delivery e PDV`
      : `${quem} ${plural ? 'desativados' : 'desativado'}: ${plural ? 'saíram' : 'saiu'} do totem, QR, delivery e PDV`;
  }
  if (m.tipo === 'canal') {
    return m.valor === 'casa' ? `${quem}: só no balcão (caixa, totem, mesa e garçom)`
      : m.valor === 'delivery' ? `${quem}: só no delivery`
      : `${quem}: no balcão e no delivery`;
  }
  if (m.tipo === 'categoria') return `${quem} ${plural ? 'foram' : 'foi'} para ${nomeCategoria ?? 'a outra categoria'}`;
  return m.valor
    ? `${quem}: acabou hoje. ${plural ? 'Voltam' : 'Volta'} sozinho${plural ? 's' : ''} quando a loja abrir amanhã`
    : `${quem} ${plural ? 'voltaram' : 'voltou'} para a venda`;
}

/** Ação em lote que pergunta antes (tira item de venda ou muda onde/como aparece). */
export function precisaConfirmar(m: MudancaLote): boolean {
  return (m.tipo === 'ativo' && !m.valor) || m.tipo === 'canal' || m.tipo === 'categoria';
}

// ── "Precisa de você" ────────────────────────────────────────────────────────
/** Leitura agregada da lista (fn_cardapio_resumo_itens): vendas dos últimos 14 dias e quem tem ficha técnica. */
export interface ResumoItens { vendas: Map<string, number>; comFicha: Set<string> }

export type Pendencia =
  | { tipo: 'ficha'; item: Item; vendidos: number; posicao: number; outros: number }
  | { tipo: 'destaque_zero'; destaque: Destaque; precoItem: number }
  | { tipo: 'destaque_diferente'; destaques: Array<{ destaque: Destaque; precoItem: number }> };

/** Quantos dos mais vendidos olhar para cobrar a ficha. */
export const TOP_VENDIDOS = 10;

/**
 * Só o que dá para resolver ali e é barato de calcular: item entre os mais vendidos sem ficha (o primeiro vira o
 * cartão; os outros entram no "outros") e destaque com preço R$ 0,00 ou diferente do preço do item.
 */
export function pendenciasCardapio(itens: Item[], destaques: Destaque[], resumo: ResumoItens | null): Pendencia[] {
  const out: Pendencia[] = [];
  if (resumo) {
    const ativos = itens.filter((i) => i.status === 'ativo' && (resumo.vendas.get(i.id) ?? 0) > 0);
    const top = ordenarItens(ativos, resumo.vendas).slice(0, TOP_VENDIDOS);
    const semFicha = top.filter((i) => !resumo.comFicha.has(i.id));
    if (semFicha.length) {
      const item = semFicha[0];
      out.push({ tipo: 'ficha', item, vendidos: resumo.vendas.get(item.id) ?? 0, posicao: top.indexOf(item) + 1, outros: semFicha.length - 1 });
    }
  }
  const porId = new Map(itens.map((i) => [i.id, i]));
  const diferentes: Array<{ destaque: Destaque; precoItem: number }> = [];
  for (const d of destaques) {
    if (!d.ativo || d.customPrice == null) continue;
    const item = porId.get(d.itemId);
    if (!item) continue;
    const precoItem = item.preco;
    // Item cujo preço vem das opções obrigatórias ("a partir de" > 0): destaque R$ 0,00 não é erro.
    if (Number(d.customPrice) === 0 && extraMinimoGruposItem(item.gruposOpcoes) > 0) continue;
    if (Number(d.customPrice) === 0) out.push({ tipo: 'destaque_zero', destaque: d, precoItem });
    else if (Math.abs(Number(d.customPrice) - precoItem) >= 0.005) diferentes.push({ destaque: d, precoItem });
  }
  if (diferentes.length) out.push({ tipo: 'destaque_diferente', destaques: diferentes });
  return out;
}
