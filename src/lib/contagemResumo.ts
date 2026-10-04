// Contagem de inventário: contas puras das telas Inventário (cartão de cada contagem, detalhe) e
// Estoque teórico (contagem × hoje). Sem React nem banco, para dar para testar.
// Datas sempre 'YYYY-MM-DD' no calendário de Brasília; 'dd/mm/aaaa' só entra como veio da sessão.

import { fmtQtd, precisaConferir } from './estoqueRegras';

const EPS = 0.00005;

/** Quantidade legível para a unidade da tela ('un', 'l') ou do banco ('unit', 'L'): 2,5 kg, não "2500 g". */
export function fmtQtdTela(q: number, unidade: string): string {
  return fmtQtd(q, unidade === 'un' ? 'unit' : unidade === 'l' ? 'L' : unidade);
}
/** Com sinal: "+2,5 kg" / "-2,5 kg" (zero sem sinal). */
export function fmtQtdSinal(q: number, unidade: string): string {
  return `${q > 0 ? '+' : ''}${fmtQtdTela(q, unidade)}`;
}
/** "+R$ 12,50" / "-R$ 84,00" (R$ 0 sem sinal). */
export function reaisComSinal(v: number): string {
  const abs = Math.abs(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (Math.abs(v) < 0.005) return abs;
  return `${v > 0 ? '+' : '-'}${abs}`;
}

export interface ItemDiferenca {
  diferenca: number;
  precoUnitario: number;
}

export const temDiferenca = (i: ItemDiferenca) => Math.abs(i.diferenca) > EPS;
/** Quanto a diferença vale em reais (negativo = faltou). */
export const impactoDe = (i: ItemDiferenca) => i.diferenca * i.precoUnitario;

/** Do que mais pesa em R$ para o que menos pesa (empate: maior diferença em quantidade). */
export function porImpacto<T extends ItemDiferenca>(itens: T[]): T[] {
  return [...itens].sort((a, b) => Math.abs(impactoDe(b)) - Math.abs(impactoDe(a)) || Math.abs(b.diferenca) - Math.abs(a.diferenca));
}

export interface ResumoContagem {
  contados: number;
  comDiferenca: number;
  semDiferenca: number;
  /** Soma com sinal (sobra − falta) em R$ */
  impactoLiquido: number;
  /** Itens com diferença, do que mais pesa em R$ para o que menos pesa */
  topo: Array<ItemDiferenca>;
  /** "N itens explicam 80%": só quando poucos itens concentram a diferença; senão null */
  explicam: { n: number; de: number; fracao: number } | null;
}

/** Quantos itens, do que mais pesa para o que menos pesa, somam `fracao` do valor das diferenças (em módulo). */
export function itensQueExplicam(itens: ItemDiferenca[], fracao = 0.8): { n: number; de: number } {
  const valores = itens.filter(temDiferenca).map((i) => Math.abs(impactoDe(i))).filter((v) => v > 0).sort((a, b) => b - a);
  const total = valores.reduce((s, v) => s + v, 0);
  if (valores.length === 0 || total <= 0) return { n: 0, de: 0 };
  let acumulado = 0;
  for (let k = 0; k < valores.length; k++) {
    acumulado += valores[k];
    if (acumulado >= total * fracao - 1e-9) return { n: k + 1, de: valores.length };
  }
  return { n: valores.length, de: valores.length };
}

export function resumirContagem<T extends ItemDiferenca>(itens: T[], fracao = 0.8): Omit<ResumoContagem, 'topo'> & { topo: T[] } {
  const comDif = itens.filter(temDiferenca);
  const e = itensQueExplicam(itens, fracao);
  return {
    contados: itens.length,
    comDiferenca: comDif.length,
    semDiferenca: itens.length - comDif.length,
    impactoLiquido: comDif.reduce((s, i) => s + impactoDe(i), 0),
    topo: porImpacto(comDif),
    // Só vale dizer "explicam" quando concentra: no máximo metade dos itens (2 de 6, não 5 de 6).
    explicam: e.de >= 2 && e.n * 2 <= e.de ? { n: e.n, de: e.de, fracao } : null,
  };
}

// ── Datas ─────────────────────────────────────────────────────────────────────
/** 'dd/mm/aaaa' (como a sessão guarda) → 'aaaa-mm-dd'; null se não for isso. */
export function dataBRparaYmd(dataBR: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataBR.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const comoData = (ymd: string) => new Date(ymd.slice(0, 10) + 'T12:00:00Z');

/** Dias de calendário entre duas datas 'aaaa-mm-dd' (ate − de). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((comoData(ate).getTime() - comoData(de).getTime()) / 86400000);
}

const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
/** 'aaaa-mm-dd' → "seg 22/09" (com o ano quando não é o do `hoje`). */
export function diaCurto(ymd: string, hoje: string): string {
  const d = comoData(ymd);
  const ano = ymd.slice(0, 4) !== hoje.slice(0, 4) ? `/${ymd.slice(2, 4)}` : '';
  return `${DIA_CURTO[d.getUTCDay()]} ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}${ano}`;
}

/** "A última foi hoje" / "ontem" / "12 dias sem contar". */
export function textoDiasSemContar(dias: number | null): string {
  if (dias === null) return 'Ainda não houve contagem.';
  if (dias <= 0) return 'A última contagem foi hoje.';
  if (dias === 1) return 'A última contagem foi ontem.';
  return `${dias} dias sem contar.`;
}

// ── Estoque teórico: contagem × hoje ──────────────────────────────────────────
export interface InsumoParaTeorico {
  id: string;
  nome: string;
  unidade: string;
  categoria?: string | null;
  precoUnitario: number;
  estoqueAtual: number;
  /** Aviso ligado e entra na contagem: só esses viram "conferir" */
  acompanha: boolean;
  contaInventario: boolean;
  /** Marcado esgotado à mão: com saldo, também é "conferir" (regra única, precisaConferir) */
  marcadoEsgotado?: boolean;
}

export interface LinhaTeorica {
  id: string;
  nome: string;
  unidade: string;
  categoria: string | null;
  /** Contado na sessão; null = o insumo não entrou naquela contagem */
  contado: number | null;
  entrou: number;
  saiu: number;
  /** Estoque de hoje (o do sistema) */
  hoje: number;
  /** Valor movimentado (entrou + saiu) em R$, para ordenar "os que mais mexeram" */
  movimentoReais: number;
  /** Número impossível: negativo em insumo que o sistema acompanha e conta */
  conferir: boolean;
}

export function montarLinhasTeorico(
  insumos: InsumoParaTeorico[],
  contadoPorId: Map<string, number>,
  movPorId: Map<string, { entrou: number; saiu: number }>,
): LinhaTeorica[] {
  return insumos.map((i) => {
    const mov = movPorId.get(i.id);
    const entrou = mov?.entrou ?? 0;
    const saiu = mov?.saiu ?? 0;
    return {
      id: i.id,
      nome: i.nome,
      unidade: i.unidade,
      categoria: i.categoria ?? null,
      contado: contadoPorId.has(i.id) ? contadoPorId.get(i.id)! : null,
      entrou,
      saiu,
      hoje: i.estoqueAtual,
      movimentoReais: (entrou + saiu) * (i.precoUnitario || 0),
      // Mesma regra do Início e da contagem do dia (estoqueRegras.precisaConferir)
      conferir: precisaConferir({ acompanha: i.acompanha, contaInventario: i.contaInventario, estoque: i.estoqueAtual, marcadoEsgotado: !!i.marcadoEsgotado }),
    };
  });
}

/** Quem mexeu mais (em R$, depois em quantidade); quem não mexeu fica de fora. */
export function maisMexeram(linhas: LinhaTeorica[]): LinhaTeorica[] {
  return linhas
    .filter((l) => l.entrou > 0 || l.saiu > 0)
    .sort((a, b) => b.movimentoReais - a.movimentoReais || (b.entrou + b.saiu) - (a.entrou + a.saiu) || a.nome.localeCompare(b.nome, 'pt-BR'));
}
