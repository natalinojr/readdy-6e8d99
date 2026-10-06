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
export interface ContaCompra { id: string; valor: number; saldo: number; vence: string; status: string; pago_em: string | null; tem_boleto: boolean; boleto: boolean; cartao?: boolean; no_inter?: boolean }
export interface Mercadoria {
  tipo: 'compra'; id: string; tenant_id: string; loja: string; fornecedor: string; numero: string | null; emitida: string;
  valor: number; bonus: boolean; chegou_em: string | null; diferente: boolean; itens: number; itens_ligados: number; contas: ContaCompra[];
  forma?: string | null;
  /** precisa chegar antes de pagar (não é bonificação, compra online/reembolso nem nota de despesa) */
  espera_chegar?: boolean;
}
export interface NotaSemCompra {
  tipo: 'nota'; id: string; tenant_id: string; loja: string; fornecedor: string; numero: string | null; emitida: string; valor: number;
  parcelas: Array<{ numero?: string; vencimento?: string; valor?: number }>;
}
export type GrupoMerc = 'nao_pague' | 'falta_lancar' | 'enviado' | 'sem_boleto' | 'cartao' | 'pronta' | 'paga';
export const GRUPO_MERC: Record<GrupoMerc, { titulo: string; tom: 'red' | 'amber' | 'green' | 'zinc' }> = {
  nao_pague: { titulo: 'Não pague ainda', tom: 'red' },
  falta_lancar: { titulo: 'Falta virar compra', tom: 'amber' },
  enviado: { titulo: 'Enviado ao Inter — falta aprovar no app', tom: 'amber' },
  sem_boleto: { titulo: 'Sem boleto ainda', tom: 'amber' },
  cartao: { titulo: 'No cartão de crédito (paga na fatura)', tom: 'zinc' },
  pronta: { titulo: 'Pronta para pagar', tom: 'green' },
  paga: { titulo: 'Pagas este mês', tom: 'zinc' },
};

/** Em que pé está a compra: a mercadoria (chegou? certo?) e o dinheiro (conta, boleto, pago). */
export function grupoMercadoria(m: Mercadoria, avisos: Record<string, AvisoPagar[]>): GrupoMerc {
  const abertas = m.contas.filter((c) => c.status !== 'paid');
  if (!abertas.length) return 'paga';
  // Já enviado ao Inter: não é "não pague" (o aviso no_inter é dele mesmo) — falta só aprovar no app.
  if (abertas.every((c) => c.no_inter)) return 'enviado';
  const espera = m.espera_chegar ?? !m.bonus;
  const avisosReais = (c: ContaCompra) => (avisos[c.id] ?? []).filter((a) => a.tipo !== 'no_inter');
  if ((espera && (!m.chegou_em || m.diferente)) || abertas.some((c) => avisosReais(c).length > 0)) return 'nao_pague';
  if (abertas.every((c) => c.cartao)) return 'cartao';
  if (abertas.some((c) => c.boleto && !c.tem_boleto)) return 'sem_boleto';
  return 'pronta';
}

/** Os dois trilhos do cartão: mercadoria (loja) e dinheiro (financeiro). */
export type Passo = 'ok' | 'agora' | 'espera' | 'problema';
export function trilhos(m: Mercadoria): { mercadoria: Passo[]; dinheiro: Passo[] } {
  const abertas = m.contas.filter((c) => c.status !== 'paid');
  const espera = m.espera_chegar ?? !m.bonus;
  const chegou: Passo = m.chegou_em || !espera ? 'ok' : 'agora';
  const conferida: Passo = !espera ? 'ok' : !m.chegou_em ? 'espera' : m.diferente ? 'problema' : 'ok';
  const conta: Passo = m.contas.length ? (abertas.some((c) => c.boleto && !c.tem_boleto) ? 'agora' : 'ok') : 'agora';
  const pago: Passo = !abertas.length ? 'ok' : !espera || (m.chegou_em && !m.diferente) ? 'agora' : 'espera';
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

// ── Todas as contas em aberto (fn_pagamentos.contas): cada uma com UM tipo ──────────────────────
// (2026-10-06, revisão de completude: antes cada tipo saía de uma consulta e o que não se encaixava sumia)
export type TipoConta = 'fixa' | 'mercadoria' | 'pessoas' | 'outras' | 'ja_paga';
export interface ContaAberta {
  id: string; tenant_id: string; loja: string; nome: string; descricao: string | null; valor: number; total: number;
  vencimento: string; status: string; origem: string | null; tipo: TipoConta; purchase_id: string | null; forma: string | null;
  tem_boleto: boolean; parcial: boolean; fora_pacote: boolean; cartao: boolean; boleto_pedido_em: string | null; no_inter: boolean;
}
export interface Servico { id: string; tenant_id: string; loja: string; fornecedor: string; numero: string | null; emitida: string; valor: number }
export interface EnviadoInter { id: string; tenant_id: string; loja: string; valor: number; para: string | null; tipo: string; status: string; bill_id: string | null; enviado_em: string }

/** Para onde levar cada tipo de conta dentro da aba. */
export const VER_DO_TIPO: Record<TipoConta, 'fixas' | 'mercadoria' | 'pessoas' | 'avulsos' | 'vista'> = {
  fixa: 'fixas', mercadoria: 'mercadoria', pessoas: 'pessoas', outras: 'avulsos', ja_paga: 'vista',
};

export interface ItemAgora { chave: string; pill: string; tom: 'red' | 'amber'; titulo: string; detalhe: string; ver: string; ordem: string }

/**
 * "Precisa de você agora": tudo que pede ação, sem repetir a mesma conta duas vezes.
 *   1) toda conta vencida ou que vence hoje (qualquer tipo; menos já paga na entrega e a já enviada ao Inter)
 *   2) mercadoria com aviso (não chegou, chegou diferente…) que ainda não venceu
 *   3) conta fixa atrasada para chegar ou com valor fora do normal
 *   4) resumos de uma linha: enviados ao Inter, notas não lançadas, pedidos esperando aprovação, folha pendente
 *   5) saídas do banco sem explicação (cada uma)
 */
export function precisaAgora(o: {
  contas: ContaAberta[]; mercadoria: Mercadoria[]; fixas: ContaFixa[]; avisos: Record<string, AvisoPagar[]>;
  notas: NotaSemCompra[]; servicos: Servico[]; avulsos: Avulso[]; pessoas: Pessoa[]; inter: EnviadoInter[];
  hoje: string; mostrarLoja: boolean;
}): ItemAgora[] {
  const { hoje } = o;
  const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const loja = (l: string) => (o.mostrarLoja ? ` · ${l}` : '');
  const dias = (d: string) => Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86400000);
  const itens: ItemAgora[] = [];
  const usadas = new Set<string>();

  for (const c of o.contas) {
    if (c.tipo === 'ja_paga' || c.no_inter || c.vencimento > hoje) continue;
    usadas.add(c.id);
    const d = dias(c.vencimento);
    const av = (o.avisos[c.id] ?? []).find((a) => a.tipo !== 'no_inter')?.texto?.replace(/\.$/, '');
    const jeito = c.cartao ? ' · no cartão de crédito' : c.tem_boleto ? '' : c.boleto_pedido_em ? ` · boleto pedido em ${ddmm(c.boleto_pedido_em.slice(0, 10))}` : ' · sem boleto nem Pix guardado';
    itens.push({ chave: `c${c.id}`, pill: d > 0 ? 'Vencida' : 'Vence hoje', tom: 'red', titulo: `${c.nome} · ${brl(c.valor)}`,
      detalhe: `${d > 0 ? `Venceu ${ddmm(c.vencimento)} (${d} ${d === 1 ? 'dia' : 'dias'})` : 'Vence hoje'}${jeito}${av ? ` · ${av}` : ''}${loja(c.loja)}.`,
      ver: VER_DO_TIPO[c.tipo], ordem: c.vencimento });
  }
  for (const m of o.mercadoria) {
    if (grupoMercadoria(m, o.avisos) !== 'nao_pague') continue;
    const prox = m.contas.find((c) => c.status !== 'paid' && !usadas.has(c.id));
    if (!prox) continue;
    const naoChegou = m.espera_chegar !== false && !m.chegou_em;
    const av = (o.avisos[prox.id] ?? []).find((a) => a.tipo !== 'no_inter')?.texto;
    itens.push({ chave: `m${m.id}`, pill: naoChegou ? 'Não chegou' : m.diferente ? 'Chegou diferente' : 'Com aviso', tom: naoChegou ? 'amber' : 'red',
      titulo: `${m.fornecedor}${m.numero ? ` NF ${m.numero}` : ''} · ${brl(prox.saldo)} · vence ${ddmm(prox.vence)}`,
      detalhe: `${naoChegou ? `Nota de ${ddmm(m.emitida)}; ninguém confirmou a entrega.` : av ?? 'Chegou diferente na conferência.'}${loja(m.loja)}`,
      ver: 'mercadoria', ordem: prox.vence });
  }
  for (const f of o.fixas) {
    if (f.confirmar) continue;
    if (f.estado === 'atrasada_chegar') {
      itens.push({ chave: `f${f.tenant_id}${f.categoria_id}${f.chave}`, pill: 'Não chegou', tom: 'amber', titulo: `${f.categoria} — ${f.nome}`,
        detalhe: `Conta fixa${loja(f.loja)}. ${f.so_extrato ? `Costuma ser paga por volta do dia ${f.dia_vence}.` : `Costuma chegar até o dia ${f.dia_chega}.`}`,
        ver: 'fixas', ordem: hoje });
    } else if (f.fora_pct != null && f.estado === 'a_pagar') {
      itens.push({ chave: `f${f.tenant_id}${f.categoria_id}${f.chave}`, pill: 'Valor fora', tom: 'amber', titulo: `${f.nome} · ${brl(f.saldo ?? 0)}`,
        detalhe: `Veio ${Math.abs(f.fora_pct)}% ${f.fora_pct > 0 ? 'acima' : 'abaixo'} da média (${brl(f.media ?? 0)})${loja(f.loja)}.`,
        ver: 'fixas', ordem: f.vence_em ?? hoje });
    }
  }
  if (o.inter.length) {
    itens.push({ chave: 'inter', pill: 'Falta aprovar', tom: 'amber',
      titulo: `${o.inter.length} ${o.inter.length === 1 ? 'pagamento enviado' : 'pagamentos enviados'} ao Inter · ${brl(o.inter.reduce((s, x) => s + Number(x.valor), 0))}`,
      detalhe: 'Abra o app do Inter › Aprovações e libere. Sem isso o pagamento não sai.', ver: 'pacote', ordem: hoje });
  }
  if (o.notas.length) {
    const vencidas = o.notas.filter((n) => (n.parcelas ?? []).some((p) => p.vencimento && p.vencimento <= hoje)).length;
    itens.push({ chave: 'notas', pill: 'Falta lançar', tom: vencidas ? 'red' : 'amber',
      titulo: `${o.notas.length} ${o.notas.length === 1 ? 'nota de mercadoria ainda não virou' : 'notas de mercadoria ainda não viraram'} compra`,
      detalhe: `${vencidas ? `${vencidas} com boleto já vencido. ` : ''}Sem virar compra não nasce a conta a pagar.`, ver: 'mercadoria', ordem: hoje });
  }
  if (o.servicos.length) {
    itens.push({ chave: 'servicos', pill: 'Falta lançar', tom: 'amber',
      titulo: `${o.servicos.length} ${o.servicos.length === 1 ? 'nota de serviço ainda não foi lançada' : 'notas de serviço ainda não foram lançadas'}`,
      detalhe: `${brl(o.servicos.reduce((s, x) => s + Number(x.valor), 0))} em serviços (contadora, sistemas, prestadores…) sem conta a pagar.`, ver: 'avulsos', ordem: hoje });
  }
  const aprovar = o.pessoas.filter((p) => p.tipo === 'aprovar');
  if (aprovar.length) {
    itens.push({ chave: 'aprovar', pill: 'Aprovar', tom: 'amber',
      titulo: `${aprovar.length} ${aprovar.length === 1 ? 'pedido de pagamento esperando' : 'pedidos de pagamento esperando'} você`,
      detalhe: aprovar.slice(0, 3).map((p) => `${p.nome} ${brl(p.valor)}`).join(' · '), ver: 'pessoas', ordem: hoje });
  }
  const folha = o.pessoas.filter((p) => p.tipo === 'folha');
  if (folha.length) {
    itens.push({ chave: 'folha', pill: 'Folha', tom: 'amber', titulo: `${folha.length} ${folha.length === 1 ? 'salário pendente' : 'salários pendentes'} na folha`,
      detalhe: 'Lançados na folha e ainda não pagos.', ver: 'pessoas', ordem: hoje });
  }
  for (const a of o.avulsos) {
    itens.push({ chave: `a${a.id}`, pill: 'Sem explicação', tom: 'red', titulo: `${brl(a.valor)} → ${a.para}`,
      detalhe: `Saiu do banco em ${ddmm(a.data)} e ninguém disse o que foi${loja(a.loja)}.`, ver: 'avulsos', ordem: a.data });
  }
  return itens.sort((a, b) => (a.tom === b.tom ? 0 : a.tom === 'red' ? -1 : 1) || a.ordem.localeCompare(b.ordem));
}
