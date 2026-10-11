// Fechamento de caixa de uma sessão. Uma sessão pode ter VÁRIOS caixas (troca de operador, caixa reaberto): o
// relatório de Caixa lia só o último (`cash_register`) e escondia a diferença dos outros — ex.: sessão com +R$ 65,80
// no 1º caixa aparecia "Conferido", e −R$ 39,80 no último quando a soma dos dois era −R$ 0,55. Aqui a conta é
// sempre sobre TODOS os caixas (`cash_registers`, que a RPC fn_get_cash_sessions_v2 devolve em ordem de abertura);
// sem o array (RPC antiga / sem caixa), cai no `cash_register` único.
import type { CashRegisterInfo, CashSession } from '@/hooks/useCaixaReport';

export interface ResumoCaixasSessao {
  caixas: CashRegisterInfo[];
  /** soma do fundo inicial de todos os caixas (sem caixa: abertura da sessão) */
  fundoInicial: number;
  /** soma do valor esperado dos caixas já fechados; null = nenhum fechou */
  valorEsperado: number | null;
  /** soma do valor contado dos caixas já fechados; null = nenhum fechou */
  valorContado: number | null;
  /** soma das diferenças de todos os caixas conferidos; null = nenhum conferido */
  diferenca: number | null;
  /** fechamento mais tardio entre os caixas */
  ultimoFechamento: string | null;
  /** justificativas de fechamento preenchidas */
  notas: string[];
}

const arredonda = (n: number) => Math.round(n * 100) / 100;

/** Soma só os valores que existem; null quando nenhum existe. */
function somar(valores: Array<number | string | null | undefined>): number | null {
  let achou = false;
  let total = 0;
  for (const v of valores) {
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    achou = true;
    total += n;
  }
  return achou ? arredonda(total) : null;
}

/** Caixas da sessão: o array completo, ou o único `cash_register` quando o array não veio. */
export function caixasDaSessao(s: Pick<CashSession, 'cash_registers' | 'cash_register'>): CashRegisterInfo[] {
  if (s.cash_registers && s.cash_registers.length > 0) return s.cash_registers;
  return s.cash_register ? [s.cash_register] : [];
}

export function resumoCaixasDaSessao(
  s: Pick<CashSession, 'cash_registers' | 'cash_register' | 'opening_amount'>,
): ResumoCaixasSessao {
  const caixas = caixasDaSessao(s);
  const fechamentos = caixas.map((c) => c.closed_at).filter((d): d is string => !!d);
  return {
    caixas,
    fundoInicial: caixas.length > 0
      ? arredonda(caixas.reduce((acc, c) => acc + (Number(c.opening_value) || 0), 0))
      : Number(s.opening_amount ?? 0) || 0,
    valorEsperado: somar(caixas.map((c) => c.closing_value_expected)),
    valorContado: somar(caixas.map((c) => c.closing_value_actual)),
    diferenca: somar(caixas.map((c) => c.closing_difference)),
    ultimoFechamento: fechamentos.length > 0
      ? fechamentos.reduce((a, b) => (new Date(b).getTime() > new Date(a).getTime() ? b : a))
      : null,
    notas: caixas.map((c) => (c.closing_notes ?? '').trim()).filter(Boolean),
  };
}
