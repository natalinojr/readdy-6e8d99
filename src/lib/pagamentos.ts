// Financeiro › Pagamentos — "em que pé está" cada pagamento, por tipo (2026-10-06, pedido do dono).
// Os dados vêm de duas funções do banco (a regra mora lá, a mesma da Hoje e do aviso antes de pagar):
//   fn_contas_fixas  → contas fixas (categoria do DRE marcada "todo mês")
//   fn_pagamentos    → mercadoria a prazo, compra à vista, pessoas, avulsos, saldo × o que vence
// Aqui só a montagem para a tela (o que é "não pague ainda", o pacote da semana…), pura e testada.

export type { AvisoPagar } from '../../supabase/functions/_shared/pacote-semana';
import type { AvisoPagar } from '../../supabase/functions/_shared/pacote-semana';

// ── Contas fixas ──────────────────────────────────────────────────────────────────────────────
export type EstadoFixa = 'paga' | 'vencida' | 'vence_hoje' | 'a_pagar' | 'nao_vem' | 'nao_chegou' | 'atrasada_chegar' | 'esperando';
export interface ContaDaFixa { id: string; valor: number; pago: number; status: string; vence: string; tem_boleto: boolean; origem: string | null; auto: boolean }
export interface ContaFixa {
  tenant_id: string; loja: string; conta_fixa_id: string | null; categoria_id: string; categoria: string;
  chave: string; nome: string; situacao: string; confirmar: boolean; sem_documento: boolean;
  valor_fixo: number | null; criar_dias_antes: number; dia_vence: number | null; dia_chega: number | null;
  meses_hist: number; media: number | null; ultimo_valor: number | null; so_extrato: boolean;
  estado: EstadoFixa; valor_mes: number | null; saldo: number | null; vence_em: string | null; pago_em: string | null;
  chegou_em: string | null; fora_pct: number | null; contas: ContaDaFixa[];
  historico: Array<{ mes: string; valor: number; pago: boolean; vence: string; pago_em: string | null }>; mes: string;
}

export const ESTADO_FIXA: Record<EstadoFixa, { rotulo: string; tom: 'red' | 'amber' | 'blue' | 'green' | 'zinc' }> = {
  vencida: { rotulo: 'Vencida', tom: 'red' },
  vence_hoje: { rotulo: 'Vence hoje', tom: 'red' },
  atrasada_chegar: { rotulo: 'Atrasada para chegar', tom: 'amber' },
  a_pagar: { rotulo: 'A pagar', tom: 'blue' },
  esperando: { rotulo: 'Esperando chegar', tom: 'zinc' },
  nao_chegou: { rotulo: 'Não chegou', tom: 'red' },
  nao_vem: { rotulo: 'Não vem este mês', tom: 'zinc' },
  paga: { rotulo: 'Paga', tom: 'green' },
};

/** Ordem na lista: o que pede ação primeiro. */
const ORDEM_FIXA: EstadoFixa[] = ['vencida', 'vence_hoje', 'nao_chegou', 'atrasada_chegar', 'a_pagar', 'esperando', 'nao_vem', 'paga'];
export const ordemFixa = (e: EstadoFixa) => ORDEM_FIXA.indexOf(e);

export interface ResumoFixas { total: number; pagas: number; urgentes: number; aPagar: number; naoChegaram: number; esperando: number; confirmar: number }
export function resumoFixas(itens: ContaFixa[]): ResumoFixas {
  const ok = itens.filter((f) => !f.confirmar);
  const n = (es: EstadoFixa[]) => ok.filter((f) => es.includes(f.estado)).length;
  return {
    total: ok.filter((f) => f.estado !== 'nao_vem').length,
    pagas: n(['paga']), urgentes: n(['vencida', 'vence_hoje']), aPagar: n(['a_pagar']),
    naoChegaram: n(['atrasada_chegar', 'nao_chegou']), esperando: n(['esperando']),
    confirmar: itens.filter((f) => f.confirmar).length,
  };
}

/** "Sistemas › Goomer" → grupo "Sistemas". */
export const grupoDaCategoria = (cat: string) => cat.split(' › ')[0];

/** Texto do que esperar de uma conta fixa que ainda não chegou. */
export function textoEsperando(f: ContaFixa): string {
  if (f.sem_documento) return `Sem documento: o sistema lança sozinho ${f.criar_dias_antes} dias antes do dia ${f.dia_vence}.`;
  if (f.so_extrato) return `Costuma ser paga por volta do dia ${f.dia_vence ?? '?'}, sem conta lançada antes.`;
  if (f.dia_chega && f.dia_vence) return `Costuma chegar até o dia ${f.dia_chega} e vencer dia ${f.dia_vence}.`;
  if (f.dia_vence) return `Costuma vencer dia ${f.dia_vence}.`;
  return 'Ainda sem histórico para saber quando chega.';
}

// ── Mercadoria a prazo ────────────────────────────────────────────────────────────────────────
export interface ContaCompra { id: string; valor: number; saldo: number; vence: string; status: string; pago_em: string | null; tem_boleto: boolean; boleto: boolean }
export interface Mercadoria {
  tipo: 'compra'; id: string; tenant_id: string; loja: string; fornecedor: string; numero: string | null; emitida: string;
  valor: number; bonus: boolean; chegou_em: string | null; diferente: boolean; itens: number; itens_ligados: number; contas: ContaCompra[];
}
export interface NotaSemCompra {
  tipo: 'nota'; id: string; tenant_id: string; loja: string; fornecedor: string; numero: string | null; emitida: string; valor: number;
  parcelas: Array<{ numero?: string; vencimento?: string; valor?: number }>;
}
export type GrupoMerc = 'nao_pague' | 'falta_lancar' | 'sem_boleto' | 'pronta' | 'paga';
export const GRUPO_MERC: Record<GrupoMerc, { titulo: string; tom: 'red' | 'amber' | 'green' | 'zinc' }> = {
  nao_pague: { titulo: 'Não pague ainda', tom: 'red' },
  falta_lancar: { titulo: 'Falta virar compra', tom: 'amber' },
  sem_boleto: { titulo: 'Sem boleto ainda', tom: 'amber' },
  pronta: { titulo: 'Pronta para pagar', tom: 'green' },
  paga: { titulo: 'Pagas este mês', tom: 'zinc' },
};

/** Em que pé está a compra: a mercadoria (chegou? certo?) e o dinheiro (conta, boleto, pago). */
export function grupoMercadoria(m: Mercadoria, avisos: Record<string, AvisoPagar[]>): GrupoMerc {
  const abertas = m.contas.filter((c) => c.status !== 'paid');
  if (!abertas.length) return 'paga';
  if (!m.bonus && (!m.chegou_em || m.diferente || abertas.some((c) => (avisos[c.id] ?? []).length > 0))) return 'nao_pague';
  if (abertas.some((c) => c.boleto && !c.tem_boleto)) return 'sem_boleto';
  return 'pronta';
}

/** Os dois trilhos do cartão: mercadoria (loja) e dinheiro (financeiro). */
export type Passo = 'ok' | 'agora' | 'espera' | 'problema';
export function trilhos(m: Mercadoria): { mercadoria: Passo[]; dinheiro: Passo[] } {
  const abertas = m.contas.filter((c) => c.status !== 'paid');
  const chegou: Passo = m.chegou_em ? 'ok' : 'agora';
  const conferida: Passo = !m.chegou_em ? 'espera' : m.diferente ? 'problema' : 'ok';
  const conta: Passo = m.contas.length ? (abertas.some((c) => c.boleto && !c.tem_boleto) ? 'agora' : 'ok') : 'agora';
  const pago: Passo = !abertas.length ? 'ok' : m.chegou_em && !m.diferente ? 'agora' : 'espera';
  return { mercadoria: ['ok', chegou, conferida], dinheiro: ['ok', conta, pago] };
}

// ── Pessoas e avulsos ─────────────────────────────────────────────────────────────────────────
export interface Pessoa {
  tipo: 'freela' | 'aprovar' | 'pedido_pagar' | 'folha'; tenant_id: string; loja: string; nome: string; valor: number;
  id?: string; pedido?: string; descricao?: string | null; vence?: string | null; dias?: number; mes?: string; bill_ids?: string[]; pedido_por?: string | null;
}
export interface Avulso { id: string; tenant_id: string; loja: string; data: string; valor: number; para: string; descricao: string | null; sugestao: string | null }
export interface CompraOnline { id: string; tenant_id: string; loja: string; descricao: string | null; valor: number; comprado_em: string }
export const PEDIDO_NOME: Record<string, string> = {
  reembolso: 'Reembolso', freelancer: 'Freelancer', fornecedor: 'Fornecedor', prestador: 'Prestador', beneficio: 'Benefício',
};

// ── Dinheiro × o que vence, e o pacote da semana: regra em _shared (o cron usa a mesma) ──────────
export { caixaDaLoja, proximoDiaDePagar, pacoteDaSemana } from '../../supabase/functions/_shared/pacote-semana';
export type { ContaAbertaCaixa, CaixaLoja, Pacote } from '../../supabase/functions/_shared/pacote-semana';

export const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
