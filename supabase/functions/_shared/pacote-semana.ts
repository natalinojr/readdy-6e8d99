// Pacote da semana e dinheiro × o que vence (2026-10-06, Financeiro › Pagamentos).
// Regra pura usada pela tela (src/lib/pagamentos.ts) e pelo assistente-cron (cartão "Pacote da semana" na
// Hoje, no dia de pagar). Sem import de runtime: roda no Vite e no Deno.
import { caixaDaSemana, type Caixa } from './previsao.ts';

export interface AvisoPagar { tipo: string; texto: string }

export interface ContaAbertaCaixa {
  id: string; nome: string; descricao: string | null; valor: number; vencimento: string; tem_boleto: boolean; origem: string | null;
  parcial?: boolean;
  /** tipo da aba Pagamentos (fixa, mercadoria, pessoas, outras) */
  tipo?: string;
  /** fora do pacote: freela/salário/pedido têm caminho próprio (fn_pagamentos) */
  fora_pacote?: boolean;
  /** já tem pagamento enviado ao Inter esperando aprovação */
  no_inter?: boolean;
  boleto_pedido_em?: string | null;
  tenant_id?: string; loja?: string;
}
export interface CaixaLoja { tenant_id: string; loja: string; no_banco: number; n_bancos: number; contas: ContaAbertaCaixa[] }

/** Mesma régua do aviso "Caixa da semana" (previsao.ts): vencidas + próximos 7 dias contra o saldo. */
export function caixaDaLoja(c: CaixaLoja, hoje: string): Caixa | null {
  if (!c.n_bancos) return null;
  return caixaDaSemana(Number(c.no_banco), c.contas.map((x) => ({ nome: x.nome, valor: Number(x.valor), vencimento: x.vencimento })), hoje);
}

/** 0 = domingo … 6 = sábado. Próximo dia de pagar a partir de hoje (hoje conta). */
export function proximoDiaDePagar(hoje: string, dia: number): string {
  const d = new Date(`${hoje}T12:00:00Z`);
  const falta = (dia - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + falta);
  return d.toISOString().slice(0, 10);
}

export interface Pacote {
  /** pode ir no pacote: tem boleto/Pix guardado e nenhum aviso */
  prontas: Array<ContaAbertaCaixa & { tenant_id: string; loja: string }>;
  /** tem aviso (não chegou, valor fora…): olhar uma por uma */
  comAviso: Array<ContaAbertaCaixa & { tenant_id: string; loja: string; avisos: AvisoPagar[] }>;
  /** sem o jeito de pagar (boleto/Pix) ainda */
  semJeito: Array<ContaAbertaCaixa & { tenant_id: string; loja: string }>;
  total: number;
  ate: string;
}

/**
 * Pacote da semana: o que se paga no próximo dia de pagar (hoje, se hoje é o dia) — tudo que já venceu e
 * o que vence até a véspera do dia de pagar seguinte (dia + 6). Folha e freela ficam de fora (caminho próprio).
 */
export function pacoteDaSemana(caixas: CaixaLoja[], avisos: Record<string, AvisoPagar[]>, hoje: string, diaDePagar: number): Pacote {
  const d = new Date(`${proximoDiaDePagar(hoje, diaDePagar)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  const ate = d.toISOString().slice(0, 10);
  const p: Pacote = { prontas: [], comAviso: [], semJeito: [], total: 0, ate };
  for (const c of caixas) {
    for (const x of c.contas) {
      if (x.vencimento > ate || !(Number(x.valor) > 0.005)) continue;
      // freela, salário e pedido têm caminho próprio; já enviado ao Inter não vai de novo. Sem o campo (dado antigo):
      // a regra de antes por origem.
      if (x.fora_pacote ?? ['freelancer', 'hr_payroll', 'hr_beneficio'].includes(String(x.origem))) continue;
      if (x.no_inter) continue;
      const base = { ...x, valor: Number(x.valor), tenant_id: c.tenant_id, loja: c.loja };
      const av = avisos[x.id] ?? [];
      if (av.length) p.comAviso.push({ ...base, avisos: av });
      // sem linha digitável/Pix, ou já paga em parte (o boleto pagaria o valor cheio): uma por uma
      else if (!x.tem_boleto || x.parcial) p.semJeito.push(base);
      else { p.prontas.push(base); p.total += base.valor; }
    }
  }
  p.total = Math.round(p.total * 100) / 100;
  return p;
}

