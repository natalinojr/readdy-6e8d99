// Regras puras das ações da Trilha versão D (Financeiro › Trilha, fase 2 — 2026-09-29).
//
// Sem banco e sem Deno: é o que decide se uma ação que mexe com dinheiro pode andar
// (parcelas que fecham com a compra, janela de datas para ligar o extrato a uma conta já paga,
// valor do boleto × saldo da conta, pedido de boleto ao fornecedor). Fica aqui para ter teste
// (src/test/edge/trilhaAcoes.test.ts) e para as edges não duplicarem a regra.
//
// Usado por: assistente-app (conta_guardar_boleto, conta_pedir_boleto), assistente-cron
// (pendência boleto_faltando), purchase-write (create_missing_bills) e conciliacao-pagamentos
// (paid_link_search / link_paid).

export const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Data AAAA-MM-DD que existe no calendário (2026-02-30 não passa). */
export function dataValida(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function addDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Dias de `de` até `ate` (positivo se `ate` é depois). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

/** "Hoje" em Brasília (nunca toISOString, que vira o dia às 21h). */
export const hojeBrasilia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** R$ 1.234,56 — montado à mão para não depender do ICU do runtime. */
export function brl(n: number): string {
  const v = round2(Math.abs(Number(n) || 0));
  const [int, dec] = v.toFixed(2).split('.');
  return `${Number(n) < 0 ? '-' : ''}R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

/** dd/mm de uma data ISO; aceita também o 'DD/MM' que o assistente-cron grava no payload. */
export function ddmm(v: unknown): string {
  const s = String(v ?? '');
  if (/^\d{2}\/\d{2}$/.test(s)) return s;
  if (ISO.test(s.slice(0, 10))) return `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  return s;
}

/** Nome sem acento, sem caixa e sem pontuação — para casar fornecedor por nome. */
export function normNome(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// ── Contas que faltam numa compra (purchase-write › create_missing_bills) ──────────────────
export type Parcela = { due_date: string; amount: number };
export const MAX_PARCELAS = 60;

/** Confere as parcelas: datas reais, valores > 0 e soma = total da compra (±R$ 0,01). */
export function validarParcelas(parcelas: unknown, total: number): { ok: true; parcelas: Parcela[] } | { ok: false; erro: string } {
  if (!Array.isArray(parcelas) || parcelas.length === 0) return { ok: false, erro: 'Informe ao menos uma parcela (vencimento e valor).' };
  if (parcelas.length > MAX_PARCELAS) return { ok: false, erro: `No máximo ${MAX_PARCELAS} parcelas.` };
  const lista: Parcela[] = [];
  for (let i = 0; i < parcelas.length; i++) {
    const p = (parcelas[i] ?? {}) as Record<string, unknown>;
    if (!dataValida(p.due_date)) return { ok: false, erro: `Parcela ${i + 1}: vencimento inválido (use AAAA-MM-DD).` };
    const v = Number(p.amount);
    if (!Number.isFinite(v) || v <= 0) return { ok: false, erro: `Parcela ${i + 1}: valor inválido.` };
    lista.push({ due_date: p.due_date as string, amount: round2(v) });
  }
  const soma = round2(lista.reduce((s, p) => s + p.amount, 0));
  const t = round2(Number(total));
  if (!(t > 0)) return { ok: false, erro: 'A compra está sem valor total.' };
  if (Math.abs(soma - t) > 0.01) return { ok: false, erro: `As parcelas somam ${brl(soma)} e a compra é ${brl(t)}: ajuste até fechar.` };
  return { ok: true, parcelas: lista };
}

/** Conta nasce 'overdue' quando o vencimento já passou (hoje de Brasília), senão 'pending'. */
export const statusPorVencimento = (due: string, hoje: string): 'pending' | 'overdue' => (due < hoje ? 'overdue' : 'pending');

// ── Extrato × conta já paga (conciliacao-pagamentos › paid_link_search / link_paid) ─────────
/** Janela de busca: paid_date −3 a +5 dias; sem paid_date, vencimento ±7. Sem nenhum dos dois: null. */
export function janelaPagoExtrato(paidDate: unknown, dueDate: unknown): { base: string; de: string; ate: string } | null {
  const pago = String(paidDate ?? '').slice(0, 10);
  if (dataValida(pago)) return { base: pago, de: addDias(pago, -3), ate: addDias(pago, 5) };
  const venc = String(dueDate ?? '').slice(0, 10);
  if (dataValida(venc)) return { base: venc, de: addDias(venc, -7), ate: addDias(venc, 7) };
  return null;
}

/** Quanto saiu por essa conta: o que foi baixado (paid_amount); conta 'paid' sem paid_amount = o valor. */
export function valorPago(conta: { amount: unknown; paid_amount: unknown; status?: unknown }): number {
  const pago = round2(Number(conta.paid_amount ?? 0));
  if (pago > 0) return pago;
  return conta.status === 'paid' ? round2(Number(conta.amount ?? 0)) : 0;
}

export const valorIgual = (a: unknown, b: unknown, tol = 0.01) => Math.abs(round2(Number(a)) - round2(Number(b))) <= tol + 1e-9;

/** Mais perto da data base primeiro (empate: a mais antiga); no máximo `max`. */
export function ordenarPorDias<T extends { transaction_date: string }>(linhas: T[], base: string, max = 10): Array<T & { dias_diferenca: number }> {
  return linhas
    .map((l) => ({ ...l, dias_diferenca: diasEntre(base, String(l.transaction_date).slice(0, 10)) }))
    .sort((a, b) => Math.abs(a.dias_diferenca) - Math.abs(b.dias_diferenca) || a.transaction_date.localeCompare(b.transaction_date))
    .slice(0, max);
}

// ── "Já paguei" numa conta EM ABERTO: achar a saída no extrato (conciliacao-pagamentos › bill_extrato_search) ──
// Regra do dono (2026-10-08): pago por boleto/Pix/transferência → a baixa vem da linha do banco (o mesmo
// link_manual da Conciliação, que já trata juros/desconto e a conta do banco); dinheiro → só a data.
/** Janela: 20 dias antes do vencimento (ou de hoje, se vence depois) até hoje. */
export function janelaContaAberta(dueDate: unknown, hoje: string): { base: string; de: string; ate: string } {
  const venc = String(dueDate ?? '').slice(0, 10);
  const base = dataValida(venc) ? venc : hoje;
  const ref = base < hoje ? base : hoje;
  return { base, de: addDias(ref, -20), ate: hoje };
}

/** Diferença aceita entre a saída e o que falta pagar: até 10% a mais (juros/multa) e 5% a menos (desconto). */
export function valorPerto(saida: number, falta: number): boolean {
  const d = round2(saida - falta);
  return d <= Math.max(0.05, round2(falta * 0.10)) && d >= -Math.max(0.05, round2(falta * 0.05));
}

export interface LinhaExtratoBusca {
  id: string; transaction_date: string; amount: number; transaction_type?: string | null; status?: string | null;
  reconciled?: boolean | null; match_kind?: string | null; match_ref_id?: string | null;
  // deno-lint-ignore no-explicit-any
  match_detail?: Record<string, any> | null; description?: string | null; counterpart_name?: string | null; bank_account_id?: string | null;
}

/**
 * Saídas do extrato que podem ser o pagamento desta conta: débito pendente, sem baixa confirmada, sem
 * outro destino (transferência, repasse…) — sugestão de vínculo a conta/nota pode ser trocada. Ordem:
 * a que o motor já sugeriu para ESTA conta, as livres antes das sugeridas para outra conta, depois valor
 * mais perto, depois data mais perto do vencimento.
 */
export function candidatosDaConta(linhas: LinhaExtratoBusca[], billId: string, falta: number, base: string, max = 6) {
  return linhas
    .filter((r) => r.transaction_type === 'debit' && r.status === 'pending' && !r.reconciled && !r.match_detail?.confirmed
      && (!r.match_kind || r.match_kind === 'payable' || r.match_kind === 'inbound_doc')
      && valorPerto(Math.abs(Number(r.amount)), falta))
    .map((r) => {
      const valor = round2(Math.abs(Number(r.amount)));
      return {
        id: r.id, transaction_date: String(r.transaction_date).slice(0, 10), valor, diferenca: round2(valor - falta),
        description: r.description ?? null, counterpart_name: r.counterpart_name ?? null, bank_account_id: r.bank_account_id ?? null,
        sugerida: r.match_kind === 'payable' && r.match_ref_id === billId,
        outra: !!r.match_kind && !(r.match_kind === 'payable' && r.match_ref_id === billId),
        dias: diasEntre(base, String(r.transaction_date).slice(0, 10)),
      };
    })
    .sort((a, b) => Number(b.sugerida) - Number(a.sugerida) || Number(a.outra) - Number(b.outra) || Math.abs(a.diferenca) - Math.abs(b.diferenca)
      || Math.abs(a.dias) - Math.abs(b.dias) || a.transaction_date.localeCompare(b.transaction_date))
    .slice(0, max);
}

// ── Boleto guardado pela tela (assistente-app › conta_guardar_boleto) ────────────────────────
/** Valor do documento difere do saldo da conta em mais de R$ 0,05 → a tela pergunta antes de gravar. */
export function precisaConfirmarValor(valorDoc: number | null | undefined, saldo: number): boolean {
  if (valorDoc == null || !(Number(valorDoc) > 0)) return false;
  return Math.abs(round2(Number(valorDoc)) - round2(saldo)) > 0.05;
}

// ── Pedido de boleto ao fornecedor (assistente-app › conta_pedir_boleto, assistente-cron) ────
export const DIAS_PARA_COBRAR = 2;
// deno-lint-ignore no-explicit-any
type Payload = Record<string, any>;

/** Registra mais um pedido no payload da pendência boleto_faltando. */
export function registrarPedido(antigo: Payload | null | undefined, hoje: string): Payload {
  const a = antigo ?? {};
  return {
    ...a,
    pedido_em: hoje,
    pedidos: Math.max(0, Math.trunc(Number(a.pedidos ?? 0)) || 0) + 1,
    pedido_anterior: a.pedido_em ?? null,
    cobrar: false,
  };
}

/** Pedido feito há ≥ 2 dias e o boleto não chegou → a tela mostra "Cobrar de novo". */
export function deveCobrar(payload: Payload | null | undefined, hoje: string): boolean {
  const em = String(payload?.pedido_em ?? '');
  return dataValida(em) && diasEntre(em, hoje) >= DIAS_PARA_COBRAR;
}

/**
 * O cron regrava o payload da pendência a cada tick (fn_pendencia_upsert troca o payload inteiro).
 * Sem isto o registro do pedido (pedido_em, pedidos) sumia no minuto seguinte.
 */
export function mesclarPedidoBoleto(novo: Payload, antigo: Payload | null | undefined, hoje: string): Payload {
  if (!antigo?.pedido_em) return novo;
  const junto = { ...novo, pedido_em: antigo.pedido_em, pedidos: antigo.pedidos ?? 1, pedido_anterior: antigo.pedido_anterior ?? null };
  return { ...junto, cobrar: deveCobrar(junto, hoje) };
}

/** Texto pronto para o dono mandar pelo WhatsApp dele (nada é enviado pelo sistema). */
export function mensagemPedidoBoleto(o: { loja: string; descricao: string; valor: number; vencimento: string | null; hoje: string; pedidoAnterior?: string | null }): string {
  const venc = o.vencimento ? String(o.vencimento).slice(0, 10) : null;
  const quando = venc && dataValida(venc)
    ? (venc < o.hoje ? `, que venceu em ${ddmm(venc)}` : `, que vence em ${ddmm(venc)}`)
    : '';
  const corpo = `Aqui é do ${o.loja}. Precisamos do boleto (ou da chave Pix) da ${o.descricao}, no valor de ${brl(o.valor)}${quando}. Pode nos enviar? Obrigado!`;
  return o.pedidoAnterior && dataValida(String(o.pedidoAnterior))
    ? `Olá! Reforçando o pedido de ${ddmm(o.pedidoAnterior)}: ${corpo.charAt(0).toLowerCase()}${corpo.slice(1)}`
    : `Olá! ${corpo}`;
}
