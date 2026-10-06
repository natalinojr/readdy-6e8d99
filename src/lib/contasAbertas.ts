// Contas em aberto — os totais que TODAS as telas mostram (2026-10-07, o dono: "unifica tudo").
// As linhas vêm de fn_contas_em_aberto (regra única no banco: saldo > 0, sem cancelada, sem compra "já paga na
// entrega"); aqui só a soma por faixa e o "dinheiro × o que vence" (mesma régua do aviso "Caixa da semana" e da
// aba Pagamentos: _shared/previsao.ts › caixaDaSemana). Usado por Hoje, Painel, Visão Geral, Contas a Pagar,
// Contas Vencidas, Dashboard e o número vermelho do Financeiro.
import { caixaDaSemana, type Caixa } from '../../supabase/functions/_shared/previsao';

export interface ContaEmAberto {
  id: string; tenant_id: string; nome: string; descricao: string | null; valor: number; total: number; vencimento: string;
  status: string; origem: string | null; reference_id: string | null; dre_category_id: string | null; forma: string | null;
  tem_boleto: boolean; ja_paga: boolean; hoje: string;
}
export interface Faixa { n: number; v: number }
export interface ResumoContas {
  vencidas: Faixa; hoje: Faixa; semana: Faixa; depois: Faixa; total: Faixa;
  /** as próximas a vencer (de hoje em diante), na ordem */
  proximas: ContaEmAberto[];
}

const somarDias = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const faixa = (l: ContaEmAberto[]): Faixa => ({ n: l.length, v: Math.round(l.reduce((s, c) => s + Number(c.valor), 0) * 100) / 100 });

/** Só o que é a pagar de verdade (tira a compra já paga na entrega). */
export const aPagar = (contas: ContaEmAberto[]) => contas.filter((c) => !c.ja_paga && Number(c.valor) > 0.005);

/** vencidas (antes de hoje) · hoje · próximos 7 dias (amanhã até hoje+7) · depois. */
export function resumoContas(contas: ContaEmAberto[], hoje: string): ResumoContas {
  const l = aPagar(contas);
  const em7 = somarDias(hoje, 7);
  return {
    vencidas: faixa(l.filter((c) => c.vencimento < hoje)),
    hoje: faixa(l.filter((c) => c.vencimento === hoje)),
    semana: faixa(l.filter((c) => c.vencimento > hoje && c.vencimento <= em7)),
    depois: faixa(l.filter((c) => c.vencimento > em7)),
    total: faixa(l),
    proximas: l.filter((c) => c.vencimento >= hoje).sort((a, b) => a.vencimento.localeCompare(b.vencimento)).slice(0, 5),
  };
}

/** Dinheiro no banco × vencidas + próximos 7 dias — a régua do aviso "Caixa da semana". */
export function dinheiroXVence(noBanco: number, contas: ContaEmAberto[], hoje: string): Caixa {
  return caixaDaSemana(noBanco, aPagar(contas).map((c) => ({ nome: c.nome, valor: Number(c.valor), vencimento: c.vencimento })), hoje);
}

/** Saldo de uma conta bancária: o do banco quando sincronizado, senão o do sistema (a regra do Painel). */
export const saldoDaConta = (a: { synced_balance?: number | null; current_balance?: number | null }) => Number(a.synced_balance ?? a.current_balance ?? 0);
