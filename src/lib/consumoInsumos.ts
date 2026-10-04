// Estoque › Custo › Consumo: contas puras da tela (período, tendência, "dura N dias", CSV).
// Ficam aqui, sem React nem banco, para dar para testar. Datas sempre em Brasília ('AAAA-MM-DD').
import { somarDias } from './dateUtils';

// ── Período ───────────────────────────────────────────────────────────────────
export type PresetPeriodo = '7d' | '30d' | 'mes' | 'custom';

/** 7 dias e 30 dias contam hoje (mesma conta do resto dos relatórios); "este mês" vai do dia 1 até hoje. */
export function intervaloDoPreset(preset: Exclude<PresetPeriodo, 'custom'>, hoje: string): { from: string; to: string } {
  if (preset === '7d') return { from: somarDias(hoje, -6), to: hoje };
  if (preset === '30d') return { from: somarDias(hoje, -29), to: hoje };
  return { from: hoje.slice(0, 8) + '01', to: hoje };
}

const DATA_OK = /^\d{4}-\d{2}-\d{2}$/;

/** null = período válido; senão, o aviso para mostrar ao usuário. */
export function validarPeriodo(de: string, ate: string, hoje: string): string | null {
  if (!DATA_OK.test(de) || !DATA_OK.test(ate)) return 'Escolha a data inicial e a final.';
  if (de > ate) return 'A data inicial não pode ser depois da final.';
  if (ate > hoje) return 'A data final não pode ser depois de hoje.';
  // Teto: a leitura pagina todos os movimentos do período (carga no banco). 3 meses cobre o uso normal.
  if (diasEntre(de, ate) > 93) return 'Escolha no máximo 3 meses (93 dias).';
  return null;
}

/** Quantos dias tem o período, contando os dois pontas. */
export function diasEntre(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

// ── Tendência: 2ª metade do período × 1ª metade ───────────────────────────────
export interface DivisaoTendencia {
  /** Primeira metade: do começo até aqui (exclusivo), em ms. */
  fimPrimeiraMs: number;
  /** Segunda metade: daqui (inclusivo) até fimSegundaMs (exclusivo), em ms. */
  inicioSegundaMs: number;
  fimSegundaMs: number;
}

/**
 * Divide o período em duas metades do mesmo tamanho (se o número de dias for ímpar, o dia do meio fica de fora).
 * O dia de hoje, ainda incompleto, não entra: senão a 2ª metade sempre pareceria menor e tudo viraria "caindo".
 * null = poucos dias para comparar (menos de 4).
 */
export function dividirPeriodo(from: string, to: string, hoje: string): DivisaoTendencia | null {
  const fim = to >= hoje ? somarDias(hoje, -1) : to;
  if (fim < from) return null;
  const metade = Math.floor(diasEntre(from, fim) / 2);
  if (metade < 2) return null;
  const meiaNoite = (d: string) => Date.parse(`${d}T00:00:00-03:00`);
  return {
    fimPrimeiraMs: meiaNoite(somarDias(from, metade)),
    inicioSegundaMs: meiaNoite(somarDias(fim, -(metade - 1))),
    fimSegundaMs: meiaNoite(somarDias(fim, 1)),
  };
}

export type Tendencia = 'subindo' | 'estavel' | 'caindo';

/** Variação de mais de 20% para cima/baixo. null = a 1ª metade não teve saída: não há com o que comparar. */
export function tendenciaDe(primeira: number, segunda: number): Tendencia | null {
  if (!(primeira > 0)) return null;
  const v = (segunda - primeira) / primeira;
  if (v > 0.2) return 'subindo';
  if (v < -0.2) return 'caindo';
  return 'estavel';
}

// ── "Dura N dias" (vem da regra única de estoque, não de conta própria) ───────
export interface DuraInfo {
  /** Para a tabela: "58 dias", "zerado" */
  curto: string;
  /** Para a linha do celular: "dura 58 dias", "zerado" */
  longo: string;
  tom: 'red' | 'amber' | 'green' | 'zinc';
}

export interface EntradaDura {
  acompanha: boolean;
  esgotado: boolean;
  diasRestantes: number | null;
  abaixoMinimo: boolean;
  vaiFaltar: boolean;
}

export function duraInfo(i: EntradaDura): DuraInfo | null {
  if (!i.acompanha) return null;
  if (i.esgotado) return { curto: 'zerado', longo: 'zerado', tom: 'red' };
  if (i.diasRestantes == null) return { curto: '—', longo: 'sem previsão de duração', tom: 'zinc' };
  const d = Math.floor(i.diasRestantes);
  const tom: DuraInfo['tom'] = d <= 3 ? 'red' : i.abaixoMinimo || i.vaiFaltar ? 'amber' : 'green';
  if (d < 1) return { curto: '< 1 dia', longo: 'dura menos de 1 dia', tom };
  if (d >= 365) return { curto: '+ de 1 ano', longo: 'dura mais de 1 ano', tom };
  const dias = d === 1 ? '1 dia' : `${d} dias`;
  return { curto: dias, longo: `dura ${dias}`, tom };
}

// ── CSV (Excel brasileiro: ponto e vírgula, vírgula decimal) ───────────────────
export type CelulaCsv = string | number | null | undefined;

/** Texto entre aspas; número com vírgula decimal e sem aspas; começo de fórmula (=, +, -, @) é neutralizado. */
export function celulaCsv(v: CelulaCsv): string {
  if (v == null) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return String(Math.round(v * 10000) / 10000).replace('.', ',');
  }
  const t = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${t.replace(/"/g, '""')}"`;
}

export function montarCsv(cabecalho: string[], linhas: CelulaCsv[][]): string {
  return [cabecalho, ...linhas].map((l) => l.map(celulaCsv).join(';')).join('\r\n');
}
