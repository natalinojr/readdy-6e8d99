import type { Resumo } from '@/lib/ifoodDashboard';

// Contas da aba Dinheiro da área iFood (protótipo docs/prototipos/ifood-proposta.html). Funções puras:
// a tela só desenha o que sai daqui.

// ── "De cada R$ 100 vendidos" ────────────────────────────────────────────────

export interface ParteCem {
  id: 'comissao' | 'transacao' | 'promoLoja' | 'entregaSobDemanda' | 'outrosServicos' | 'ajustes';
  nome: string;
  cor: string;
  /** R$ para cada R$ 100 vendidos. */
  v100: number;
  /** Largura na barra (% de 100). Já descontado o que o iFood devolveu, para a barra fechar em 100. */
  barra: number;
}

export interface Por100 {
  partes: ParteCem[];
  /** R$ que chegam na loja para cada R$ 100 vendidos. */
  chega100: number;
  chegaBarra: number;
  /** R$ que o iFood devolveu (ressarcimentos e ajustes a favor) para cada R$ 100. */
  devolveu100: number;
  /** Promoções pagas pelo iFood no período (R$, não por 100): não saem do bolso da loja. */
  promoIfood: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Identidade: liquido = vendas − comissão − taxa de pagamento − promoção da loja − entrega sob demanda
 * − outros serviços + ajustes. Ajuste a favor (ressarcimento) vira "o iFood devolveu"; ajuste contra vira
 * mais uma parte do que fica no caminho. A barra tem sempre chega + partes = 100.
 */
export function dividirPor100(r: Resumo): Por100 | null {
  if (r.vendas <= 0.005) return null;
  const k = 100 / r.vendas;
  const base: Omit<ParteCem, 'barra'>[] = [
    { id: 'comissao', nome: 'Comissão do iFood', cor: '#EA1D2C', v100: r.comissao * k },
    { id: 'transacao', nome: 'Taxa de pagamento', cor: '#F97316', v100: r.transacao * k },
    { id: 'promoLoja', nome: 'Promoções que a loja pagou', cor: '#A855F7', v100: r.promoLoja * k },
    { id: 'entregaSobDemanda', nome: 'Entrega sob demanda', cor: '#0EA5E9', v100: r.entregaSobDemanda * k },
    { id: 'outrosServicos', nome: 'Outros serviços do iFood', cor: '#9A9086', v100: r.outrosServicos * k },
    { id: 'ajustes', nome: 'Ajustes descontados', cor: '#B45309', v100: Math.max(0, -r.ajustes) * k },
  ];
  const partes = base.filter((p) => Math.abs(p.v100) >= 0.005);
  const chega100 = r.liquido * k;
  const devolveu100 = Math.max(0, r.ajustes) * k;
  const chegaBarra = Math.min(100, Math.max(0, chega100));
  const soma = partes.reduce((s, p) => s + Math.max(0, p.v100), 0);
  const fator = soma > 0 ? (100 - chegaBarra) / soma : 0;
  return {
    partes: partes.map((p) => ({ ...p, barra: Math.max(0, p.v100) * fator })),
    chega100, chegaBarra, devolveu100, promoIfood: r.promoIfood,
  };
}

// ── Repasses × banco ─────────────────────────────────────────────────────────

export interface RepasseRow {
  data_repasse: string;
  esperado: number;
  depositos?: number;
  recebido_inter: number;
  linhas_inter: number;
  detalhe: {
    ifood?: { valor: number; metodo: string | null }[];
    inter?: { data: string; valor: number; descricao: string | null }[];
    bruto?: number;
    antecipacao?: number;
    sem_conta?: boolean;
  } | null;
}

export type SituacaoRepasse = 'bateu' | 'faltou' | 'sobrou' | 'nao_achou' | 'previsto' | 'sem_conta';

/** Bateu quando o que o iFood informou e o que caiu no Inter diferem menos de R$ 1. */
export const TOLERANCIA_REPASSE = 1;

export function situacaoRepasse(r: RepasseRow, hoje: string): { situacao: SituacaoRepasse; diff: number } {
  const esperado = Number(r.esperado) || 0;
  const recebido = Number(r.recebido_inter) || 0;
  const diff = r2(recebido - esperado);
  if (r.detalhe?.sem_conta) return { situacao: 'sem_conta', diff };
  if (r.data_repasse > hoje || (r.data_repasse === hoje && r.linhas_inter === 0)) return { situacao: 'previsto', diff };
  if (r.linhas_inter === 0 && recebido < 0.005) return { situacao: 'nao_achou', diff };
  if (Math.abs(esperado - recebido) < TOLERANCIA_REPASSE) return { situacao: 'bateu', diff };
  return { situacao: recebido < esperado ? 'faltou' : 'sobrou', diff };
}

export interface ResumoRepasses {
  bateram: number;
  /** Não bateram: faltou, sobrou ou não achado no banco. */
  problemas: number;
  previstos: number;
  semConta: number;
  /** Primeiro repasse previsto (o próximo a cair). */
  proximo: RepasseRow | null;
}

export function resumoRepasses(rs: RepasseRow[], hoje: string): ResumoRepasses {
  const z: ResumoRepasses = { bateram: 0, problemas: 0, previstos: 0, semConta: 0, proximo: null };
  const ordem = [...rs].sort((a, b) => a.data_repasse.localeCompare(b.data_repasse));
  for (const r of ordem) {
    const { situacao } = situacaoRepasse(r, hoje);
    if (situacao === 'bateu') z.bateram += 1;
    else if (situacao === 'previsto') { z.previstos += 1; z.proximo ??= r; }
    else if (situacao === 'sem_conta') z.semConta += 1;
    else z.problemas += 1;
  }
  return z;
}

/** Frase curta da situação dos repasses; null quando não há o que dizer. */
export function fraseRepasses(z: ResumoRepasses): string | null {
  if (z.problemas > 0) return z.problemas === 1 ? '1 repasse não bateu com o banco.' : `${z.problemas} repasses não bateram com o banco.`;
  if (z.bateram > 0) return z.bateram === 1 ? 'O repasse caiu no banco certinho.' : 'Todos os repasses caíram no banco certinho.';
  if (z.semConta > 0 && z.previstos === 0) return 'Sem extrato do banco para conferir os repasses.';
  return null;
}

// ── Descontos dados aos clientes ─────────────────────────────────────────────

export function dividirDescontos(r: Pick<Resumo, 'vendas' | 'promoLoja' | 'promoIfood'>) {
  const total = r2(r.promoLoja + r.promoIfood);
  const pct = (v: number) => (r.vendas > 0 ? (v / r.vendas) * 100 : 0);
  return { loja: r.promoLoja, ifood: r.promoIfood, total, pctLoja: pct(r.promoLoja), pctIfood: pct(r.promoIfood), pctTotal: pct(total) };
}
