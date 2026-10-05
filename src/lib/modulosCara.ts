// Página de Módulos nova (protótipo docs/prototipos/sistema-proposta.html › telas/modulos.js, aprovado
// pelo dono em 2026-10-05). Regras puras: qual das três caras a pessoa vê, quais terminais o aparelho da
// loja mostra, o "abrir sempre este neste aparelho" e o produto único / último usado de quem não tem loja.
// Quem vê cada terminal segue as regras de hoje: o catálogo (src/constants/telas.ts, as regras do menu) E
// a regra do cartão antigo de /modulos (papéis do PDV Caixa/Garçom/Delivery) — nunca mais que hoje.
import { TELAS, telaVisivel, type ContextoTelas, type Produto, type Tela } from '@/constants/telas';
import { loginCompartilhado } from '@/pages/hoje/rotina/loginCompartilhado';
import { META_PEDIDO_MIN } from '@/lib/pedidosRegras';

export type CaraModulos = 'aparelho' | 'produto' | 'todas';

/** Papéis de operação: o login fica num aparelho da loja (computador do caixa, tablet da cozinha, celular do garçom). */
export const PAPEIS_APARELHO: readonly string[] = ['caixa', 'cozinha', 'garcom'];

/**
 * Sem loja → "só outro produto"; login compartilhado da loja ou papel de operação → "aparelho da loja";
 * os demais com loja (dono, supervisor, líder, financeiro…) → "Todas as telas".
 */
export function escolherCara(p: { semLoja: boolean; email?: string | null; perfil?: string | null }): CaraModulos {
  if (p.semLoja) return 'produto';
  if (loginCompartilhado(p.email) || (!!p.perfil && PAPEIS_APARELHO.includes(p.perfil))) return 'aparelho';
  return 'todas';
}

// ── Terminais do aparelho ─────────────────────────────────────────────────────

const PAPEIS_CAIXA = ['admin', 'gerente', 'supervisao', 'caixa'] as const;

interface DefTerminal {
  /** id da tela no catálogo */
  id: string;
  rotulo: string;
  sub: string;
  /** Papéis do cartão antigo de /modulos (quando existia). */
  perfis?: readonly string[];
}

/** Ordem dos botões no aparelho. */
export const TERMINAIS_APARELHO: DefTerminal[] = [
  { id: 'pdv-caixa', rotulo: 'Caixa', sub: 'vender e cobrar no balcão', perfis: PAPEIS_CAIXA },
  { id: 'pdv-garcom', rotulo: 'Garçom', sub: 'pedidos no salão, direto da mesa', perfis: ['admin', 'gerente', 'supervisao', 'garcom'] },
  { id: 'pdv-delivery', rotulo: 'Delivery por telefone', sub: 'entrega e retirada por telefone', perfis: PAPEIS_CAIXA },
  { id: 'gestor-pedidos', rotulo: 'Gestor de Pedidos', sub: 'a fila da cozinha' },
  { id: 'gestor-entregas', rotulo: 'Gestor de Entregas', sub: 'as entregas saindo' },
  { id: 'kds', rotulo: 'KDS', sub: 'a tela da cozinha, por estação' },
  // Não havia cartão em /modulos; no menu antigo aparecia para todos. Aqui fica com os papéis do Caixa.
  { id: 'autoatendimento', rotulo: 'Autoatendimento', sub: 'o tablet em que o cliente pede sozinho', perfis: PAPEIS_CAIXA },
];

export interface TerminalAparelho {
  id: string;
  rota: string;
  rotulo: string;
  sub: string;
  tela: Tela;
  /** A pessoa pode abrir, mas a loja desligou (Visão da cozinha): aparece apagado. */
  desligado: boolean;
}

/** Os terminais que este login abre (e os de cozinha que a loja desligou, apagados). */
export function terminaisDoAparelho(ctx: ContextoTelas, catalogo: Tela[] = TELAS): TerminalAparelho[] {
  const saida: TerminalAparelho[] = [];
  if (ctx.temPdv === false) return saida; // empresa sem PDV: nenhum terminal (regra do /modulos de hoje)
  for (const d of TERMINAIS_APARELHO) {
    const tela = catalogo.find((t) => t.id === d.id);
    if (!tela) continue;
    if (d.perfis && (!ctx.perfil || !d.perfis.includes(ctx.perfil))) continue;
    const base = { id: d.id, rota: tela.rota, rotulo: d.rotulo, sub: d.sub, tela };
    if (telaVisivel(tela, ctx)) { saida.push({ ...base, desligado: false }); continue; }
    // KDS / Gestor de Pedidos: a pessoa tem o acesso, só a Visão da cozinha da loja está no outro.
    const cozinha = tela.rota === '/kds' || tela.rota === '/gestor-pedidos';
    if (cozinha && telaVisivel(tela, { ...ctx, kitchenView: 'ambos' })) saida.push({ ...base, desligado: true });
  }
  return saida;
}

// ── Abrir sempre este neste aparelho ──────────────────────────────────────────

export const CHAVE_APARELHO_FIXO = 'erpos-aparelho-fixo';

export interface AparelhoFixo {
  tenantId: string;
  rota: string;
}

function armazem(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function lerAparelhoFixo(storage?: Storage | null): AparelhoFixo | null {
  const s = armazem(storage);
  if (!s) return null;
  try {
    const v = JSON.parse(s.getItem(CHAVE_APARELHO_FIXO) ?? 'null');
    if (v && typeof v.tenantId === 'string' && typeof v.rota === 'string' && v.rota.startsWith('/')) {
      return { tenantId: v.tenantId, rota: v.rota };
    }
  } catch { /* valor estragado = sem fixo */ }
  return null;
}

export function gravarAparelhoFixo(f: AparelhoFixo, storage?: Storage | null): void {
  try { armazem(storage)?.setItem(CHAVE_APARELHO_FIXO, JSON.stringify(f)); } catch { /* sem storage */ }
}

export function soltarAparelhoFixo(storage?: Storage | null): void {
  try { armazem(storage)?.removeItem(CHAVE_APARELHO_FIXO); } catch { /* sem storage */ }
}

/** Para onde o aparelho vai ao ENTRAR: a rota fixada, se for desta loja e a pessoa ainda puder abrir. */
export function destinoAparelhoFixo(
  fixo: AparelhoFixo | null,
  tenantId: string | null | undefined,
  terminais: Pick<TerminalAparelho, 'rota' | 'desligado'>[],
): string | null {
  if (!fixo || !tenantId || fixo.tenantId !== tenantId) return null;
  return terminais.some((t) => t.rota === fixo.rota && !t.desligado) ? fixo.rota : null;
}

// ── Só outro produto (sem loja) ───────────────────────────────────────────────

export const CHAVE_ULTIMO_PRODUTO = 'erpos-ultimo-produto';

export function lerUltimoProduto(userId: string | null | undefined, storage?: Storage | null): string | null {
  if (!userId) return null;
  try { return armazem(storage)?.getItem(`${CHAVE_ULTIMO_PRODUTO}:${userId}`) ?? null; } catch { return null; }
}

export function gravarUltimoProduto(userId: string | null | undefined, produtoId: string, storage?: Storage | null): void {
  if (!userId) return;
  try { armazem(storage)?.setItem(`${CHAVE_ULTIMO_PRODUTO}:${userId}`, produtoId); } catch { /* sem storage */ }
}

/**
 * Para onde vai quem não tem loja: com UM produto, sempre direto nele (não há o que escolher);
 * com 2+, só ao entrar, e só no último usado que ainda está liberado. null = mostra a escolha.
 */
export function destinoProduto(produtos: Pick<Produto, 'id' | 'rota'>[], ultimo: string | null, entrada: boolean): string | null {
  const livres = produtos.filter((p) => p.id !== 'loja');
  if (livres.length === 1) return livres[0].rota;
  if (livres.length < 2 || !entrada || !ultimo) return null;
  return livres.find((p) => p.id === ultimo)?.rota ?? null;
}

// ── Estado dos terminais (leituras que já estão na memória do app) ─────────────

export interface PedidoFila {
  status: string;
  criadoEm: number;
  destino?: string;
  isCancelled?: boolean;
}

export interface ResumoFila {
  /** Na fila da cozinha: novo, em preparo ou pronto esperando sair. */
  fila: number;
  /** Passou da meta do pedido (pedidosRegras: META_PEDIDO_MIN), contado desde a criação. */
  atrasados: number;
  /** Entregas na rua agora. */
  saindo: number;
  /** Entregas prontas esperando o entregador. */
  prontasParaSair: number;
  /** Entregas andando (fila + na rua). */
  entregasAndando: number;
}

const NA_FILA = new Set(['novo', 'preparo', 'pronto']);

export function resumoFila(pedidos: PedidoFila[], agoraMs: number): ResumoFila {
  const r: ResumoFila = { fila: 0, atrasados: 0, saindo: 0, prontasParaSair: 0, entregasAndando: 0 };
  for (const p of pedidos) {
    if (p.isCancelled) continue;
    const entrega = p.destino === 'delivery';
    if (NA_FILA.has(p.status)) {
      r.fila += 1;
      if ((agoraMs - p.criadoEm) / 60000 > META_PEDIDO_MIN) r.atrasados += 1;
      if (entrega) {
        r.entregasAndando += 1;
        if (p.status === 'pronto') r.prontasParaSair += 1;
      }
    } else if (p.status === 'em_rota' && entrega) {
      r.saindo += 1;
      r.entregasAndando += 1;
    }
  }
  return r;
}
