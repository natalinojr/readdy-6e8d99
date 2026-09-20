// conciliacao-pagamentos — liga os pagamentos do extrato bancário (Inter) às notas de entrada
// e às contas a pagar, e dá a baixa quando o usuário confirma.
//
// Decisões do dono (2026-09-11):
//   • vínculo EXATO é confirmado em lote, com um clique; nunca sozinho;
//   • pagamento que bate com nota ainda não lançada → a nota é importada AUTOMATICAMENTE no
//     momento da confirmação (fica marcado em fiscal_inbound_documents.auto_imported);
//   • Pix para pessoa física: o usuário escolhe a categoria e pode "lembrar" o CPF/chave Pix.
//
// Ações (POST JSON { action, tenant_id, ... }):
//   rematch                {}                    refaz as sugestões (fn_match_payments + fn_match_payroll, últimos 120 dias)
//                          'payroll' (2026-09-18): Pix ao CPF do funcionário = líquido exato da folha pendente →
//                          confirmar marca a folha como paga (financial-write pay_payroll) na data do Pix
//   alerts                 {}                    fn_conciliacao_alertas
//   trace                  { id }                rastreio: a que conta a pagar / compra / nota / folha este pagamento levou
//   confirm                { ids: string[] }     admin/gerente: importa a nota (se preciso), baixa a parcela, lança juros
//   undo                   { id }                admin/gerente: estorna a baixa feita pela confirmação
//   monthly_candidates     { document_id }       pagamentos do extrato do fornecedor perto da emissão + combinação sugerida
//   link_monthly           { document_id, ids, tipo?, cost_center_id?, links?, dre_category_id?, category?, saldo_vencimento? }
//                          admin/gerente — NOTA DO MÊS: 1 nota cobre vários pagamentos já feitos; lança na data de
//                          emissão com 1 parcela por pagamento, cada uma baixada; saldo que faltar fica a pagar
//   unlink_monthly         { document_id }       desfaz tudo (estorna as baixas, apaga a compra, nota volta a conferir)
//   save_counterpart_rule  { counterpart_doc, counterpart_label?, category, cost_center_id?, transaction_type }
//   create_from_statement  { ids, kind: 'despesa'|'compra'|'freelancer' (dias?: 'YYYY-MM-DD'[], funcao?), dre_category_id?, merchandise_category_id?, description?,
//                            supplier?, cost_center_id?, allow_payroll?, competence_month?: 'YYYY-MM' }   admin/gerente — pagamento SEM NOTA:
//                          despesa = conta a pagar (reference_type 'conciliacao_extrato') já baixada; compra = compra
//                          (purchase-write) com 1 item, parcela baixada. Mesma data e conta do extrato. Pix para CPF de
//                          funcionário é recusado (code 'folha') sem allow_payroll: a folha já entra na DRE. O undo apaga
//                          o que foi criado e devolve a linha para pendente.
//
//   REGRA DE LANÇAMENTO (2026-09-18): por CNPJ/CPF/chave Pix, a saída vira despesa/compra (create_from_statement)
//   com a competência da regra (mês do pagamento ou o anterior). fn_match_launch_rules grava a sugestão
//   (match_kind 'rule'); confirm lança. Travas no SQL: CPF de funcionário, fornecedor que emite NF-e.
//   launch_rule_save     { counterpart_doc, counterpart_label?, kind, dre_category_id?, merchandise_category_id?,
//                          competence_rule: 'same'|'prev', supplier_name?, cost_center_id? }   admin/gerente
//   launch_rule_preview  { rule_id }            pagamentos pendentes (qualquer data) que a regra pegaria
//   launch_rule_apply    { rule_id, items: [{ id, competencia: 'YYYY-MM' }] }   admin/gerente: lança esses
//   auto_apply_rules     {}   regras com mode='auto': lança SOZINHO só o que não tem dúvida — sem
//                        conflito de competência, valor dentro do padrão e fornecedor já conhecido
//                        (3+ pagamentos). Chamada pelo cron (assistente-brain › regras_auto).
//
//   VÍNCULO MANUAL (2026-09-20): "este pagamento é desta nota/conta". O casamento automático usa
//   CNPJ + valor + data; Pix ao gerente/dono ou razão social diferente da nota nunca casava.
//   link_search  { id, q? }  contas a pagar em aberto + notas não lançadas, mais parecidas primeiro
//   link_manual  { id, alvo: { kind: 'payable'|'inbound_doc', ref_id, parcela?, valor?, vencimento? },
//                  lembrar?: boolean }   admin/gerente: liga e dá a baixa (mesmo caminho do confirm);
//                  lembrar grava o apelido "quem recebe X = fornecedor Y" (fin_counterpart_aliases)
//                  e refaz as sugestões — os próximos pagamentos a essa pessoa casam sozinhos.
//
//   INÍCIO DO FINANCEIRO (2026-09-19): a loja escolhe de que mês em diante o financeiro vale e fecha o
//   que ficou para trás. Só mexe no que está PENDENTE (extrato, conta a pagar em aberto, nota da SEFAZ
//   não lançada); baixa feita, nota lançada, classificação e vínculo continuam como estão. Reversível.
//   periodo_preview  { inicio: 'YYYY-MM' }   o que seria fechado
//   periodo_fechar   { inicio: 'YYYY-MM' }   admin/gerente
//   periodo_reabrir  {}                      admin/gerente: desfaz o corte
//
// Reaproveita a lógica que já existe chamando as outras edges COM O JWT DO USUÁRIO:
//   fiscal-inbound (import_purchase / import_bill) e financial-write (pay_bill / upsert_bill).
// O estorno (undo) é feito aqui, com service role, porque não existe "despagar" no financial-write.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

type Admin = SupabaseClient;
type Row = Record<string, any>;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
};
const MAX_BATCH = 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const errResp = (msg: string, status = 400) => json({ success: false, error: msg }, status);
function log(level: 'INFO' | 'WARN' | 'ERROR', action: string, msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'conciliacao-pagamentos', level, action, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const todayBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
function addDays(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const br = (iso: string) => String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4);
const br$ = (v: unknown) => 'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = (n: number) => round2(n).toFixed(2).replace('.', ',');

interface Ctx { admin: Admin; tenantId: string; userId: string | null; token: string; supabaseUrl: string; anonKey: string }

// Chama outra edge com o JWT do usuário (ela valida a loja e o papel dele).
async function callEdge(ctx: Ctx, fn: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: any; error?: string }> {
  const r = await fetch(ctx.supabaseUrl + '/functions/v1/' + fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ctx.token, apikey: ctx.anonKey },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let out: any = null;
  try { out = JSON.parse(txt); } catch { out = null; }
  const error = typeof out?.error === 'string' ? out.error : (!r.ok ? txt.slice(0, 300) : undefined);
  return { ok: r.ok && !error && out?.success !== false, data: out, error };
}

// ── Confirmar um vínculo ─────────────────────────────────────────────────────
type Result = { id: string; ok: boolean; msg: string; auto_imported?: boolean; code?: string };

// Trava atômica na linha do extrato (go-live 09-17): dois cliques/duas abas confirmavam
// ou lançavam a mesma linha 2× (despesa e débito duplicados). A linha é "reservada" com um
// update condicional (reconciled=false → true); quem não pegar a linha recebe code 409.
// Se o lançamento falhar, a reserva é desfeita e a linha volta a pendente.
async function withRowClaim(ctx: Ctx, rowId: string, fn: () => Promise<Result>): Promise<Result> {
  const { admin, tenantId } = ctx;
  const { data: claimed, error } = await admin.from('fin_bank_statement_imports')
    .update({ reconciled: true, reconciled_at: new Date().toISOString() })
    .eq('id', rowId).eq('tenant_id', tenantId).eq('reconciled', false).eq('status', 'pending')
    .select('id');
  if (error) return { id: rowId, ok: false, msg: 'Reservar o lançamento: ' + error.message };
  if (!claimed || claimed.length === 0) {
    return { id: rowId, ok: false, msg: 'Este pagamento já está sendo conciliado ou já foi conciliado: atualize a tela', code: '409' };
  }
  const release = () => admin.from('fin_bank_statement_imports')
    .update({ reconciled: false, reconciled_at: null })
    .eq('id', rowId).eq('tenant_id', tenantId).eq('status', 'pending');
  try {
    const r = await fn();
    if (!r.ok) await release();
    return r;
  } catch (e) {
    await release();
    throw e;
  }
}

async function confirmOne(ctx: Ctx, rowId: string): Promise<Result> {
  const { admin, tenantId } = ctx;
  const { data: row } = await admin.from('fin_bank_statement_imports').select('*').eq('id', rowId).eq('tenant_id', tenantId).maybeSingle();
  if (!row) return { id: rowId, ok: false, msg: 'Lançamento não encontrado' };
  if (row.reconciled || row.status !== 'pending') return { id: rowId, ok: false, msg: 'Este pagamento já está conciliado' };
  return withRowClaim(ctx, rowId, () => confirmOneClaimed(ctx, rowId, row));
}

async function confirmOneClaimed(ctx: Ctx, rowId: string, row: Row): Promise<Result> {
  const { admin, tenantId } = ctx;
  const fail = (msg: string): Result => ({ id: rowId, ok: false, msg });
  if (row.transaction_type === 'debit' && row.match_kind === 'payroll') return confirmPayroll(ctx, row);
  if (row.transaction_type === 'debit' && row.match_kind === 'rule') return confirmRule(ctx, row);
  if (row.transaction_type !== 'debit' || !['payable', 'inbound_doc'].includes(String(row.match_kind))) return fail('Este lançamento não tem vínculo sugerido');

  const det = (row.match_detail ?? {}) as Row;
  const paidDate = String(row.transaction_date);
  const boleto = det.boleto === true;
  const metodo = boleto ? 'Boleto' : 'Pix';
  let billId: string | null = row.match_kind === 'payable' ? row.match_ref_id : null;
  let autoImported = false;

  // Nota ainda não lançada → importa agora (decisão do dono), marcando que foi automático
  if (row.match_kind === 'inbound_doc') {
    const { data: doc } = await admin.from('fiscal_inbound_documents').select('id, status, modelo, numero, emitente_nome, payable_ids, sefaz_status').eq('id', det.doc_id).eq('tenant_id', tenantId).maybeSingle();
    if (!doc) return fail('Nota de entrada não encontrada');
    if (Number(doc.sefaz_status) === 2) return fail('A nota foi CANCELADA na SEFAZ — não lance');
    if (doc.status === 'ignored') return fail('A nota está marcada como ignorada em Notas de Entrada');
    if (doc.status === 'new') {
      const servico = Number(doc.modelo) === 10;
      const imp = await callEdge(ctx, 'fiscal-inbound', {
        action: servico ? 'import_bill' : 'import_purchase',
        tenant_id: tenantId,
        document_id: doc.id,
        category: servico ? 'Serviços de terceiros' : undefined,
        notes: 'Importada automaticamente pela conciliação bancária (pagamento de ' + br(paidDate) + ')',
      });
      if (!imp.ok) return fail('Importar a nota: ' + (imp.error ?? 'falhou'));
      autoImported = true;
      await admin.from('fiscal_inbound_documents')
        .update({ auto_imported: true, auto_imported_at: new Date().toISOString(), auto_import_ref: row.id })
        .eq('id', doc.id).eq('tenant_id', tenantId);
    }
    const { data: doc2 } = await admin.from('fiscal_inbound_documents').select('payable_ids').eq('id', doc.id).maybeSingle();
    const ids = ((doc2?.payable_ids ?? []) as string[]).filter(Boolean);
    if (ids.length === 0) return fail('A nota foi lançada sem conta a pagar (estava marcada como paga na hora?)');
    const { data: bills } = await admin.from('fin_accounts_payable').select('id, amount, paid_amount, due_date, status').eq('tenant_id', tenantId).in('id', ids);
    const rem = (b: Row) => round2(Number(b.amount) - Number(b.paid_amount ?? 0));
    const open = (bills ?? []).filter((b: Row) => b.status !== 'paid' && b.status !== 'cancelled' && rem(b) > 0.005);
    const valor = Number(det.valor ?? 0);
    const venc = det.vencimento ? String(det.vencimento) : null;
    const pick = open.find((b: Row) => Math.abs(rem(b) - valor) <= 0.05 && (!venc || b.due_date === venc))
      ?? open.find((b: Row) => Math.abs(rem(b) - valor) <= 0.05)
      ?? (open.length === 1 ? open[0] : null);
    if (!pick) return fail('Não achei a parcela desta nota em Contas a Pagar');
    billId = pick.id;
  }

  const { data: bill } = await admin.from('fin_accounts_payable').select('*').eq('id', billId).eq('tenant_id', tenantId).maybeSingle();
  if (!bill) return fail('Conta a pagar não encontrada');
  if (bill.status === 'paid') return fail('A conta a pagar já está quitada');

  const remaining = round2(Number(bill.amount) - Number(bill.paid_amount ?? 0));
  const paid = round2(Number(row.amount));
  let payAmount = Math.min(paid, remaining);
  let desconto = 0;

  // Boleto pago abaixo da parcela (desconto de pontualidade): a obrigação termina no valor pago
  if (boleto && paid < remaining - 0.005) {
    desconto = round2(remaining - paid);
    const up = await callEdge(ctx, 'financial-write', {
      action: 'upsert_bill', tenant_id: tenantId,
      payload: { id: bill.id, amount: round2(Number(bill.amount) - desconto), notes: [bill.notes, 'Desconto de R$ ' + brl(desconto) + ' no pagamento de ' + br(paidDate) + ' (conciliação bancária)'].filter(Boolean).join(' · ') },
    });
    if (!up.ok) return fail('Registrar o desconto: ' + (up.error ?? 'falhou'));
    payAmount = paid;
  }

  const pay = await callEdge(ctx, 'financial-write', {
    action: 'pay_bill', tenant_id: tenantId,
    payload: { id: bill.id, paid_date: paidDate, paid_amount: round2(payAmount), payment_method: metodo, bank_account_id: row.bank_account_id },
  });
  if (!pay.ok) {
    if (desconto > 0) await admin.from('fin_accounts_payable').update({ amount: bill.amount, notes: bill.notes }).eq('id', bill.id);
    return fail('Dar baixa na conta: ' + (pay.error ?? 'falhou'));
  }

  // Pago acima da parcela = juros/multa: vira uma despesa própria, já paga no mesmo dia
  const juros = round2(paid - payAmount);
  let jurosBillId: string | null = null;
  if (juros > 0.004) {
    const nb = await callEdge(ctx, 'financial-write', {
      action: 'upsert_bill', tenant_id: tenantId,
      payload: {
        description: 'Juros/multa — ' + String(bill.description ?? '').slice(0, 200), supplier: bill.supplier ?? null,
        amount: juros, due_date: paidDate, status: 'pending', category: 'Juros e multas', cost_center_id: bill.cost_center_id ?? null,
        is_recurring: false, reference_type: 'conciliacao_juros', reference_id: row.id,
        notes: 'Diferença entre o valor pago no banco (R$ ' + brl(paid) + ') e a parcela (R$ ' + brl(payAmount) + ')',
      },
    });
    jurosBillId = nb.data?.data?.id ?? null;
    if (jurosBillId) {
      const pj = await callEdge(ctx, 'financial-write', {
        action: 'pay_bill', tenant_id: tenantId,
        // pay_bill exige classificação DRE: juros/multa vão para "Juros e multas" (despesa)
        payload: { id: jurosBillId, paid_date: paidDate, paid_amount: juros, payment_method: metodo, bank_account_id: row.bank_account_id, dre_group: 'expense', dre_category_name: 'Juros e multas' },
      });
      if (!pj.ok) log('WARN', 'confirm', 'baixa dos juros falhou', { tenantId, rowId, error: pj.error });
    } else log('WARN', 'confirm', 'criar conta de juros falhou', { tenantId, rowId, error: nb.error });
  }

  const now = new Date().toISOString();
  const confirmed = { bill_id: bill.id, juros_bill_id: jurosBillId, pay_amount: round2(payAmount), juros, desconto, auto_imported: autoImported, at: now, by: ctx.userId };
  const { error: upErr } = await admin.from('fin_bank_statement_imports').update({
    status: 'matched', reconciled: true, reconciled_at: now, reconciled_by: ctx.userId, matched_at: now, matched_by: ctx.userId,
    match_ref_id: bill.id, match_detail: { ...det, confirmed },
  }).eq('id', row.id);
  if (upErr) log('ERROR', 'confirm', 'marcar extrato falhou', { tenantId, rowId, error: upErr.message });

  const partes = ['Baixa de R$ ' + brl(payAmount) + ' em "' + String(bill.description ?? '') + '"'];
  if (juros > 0.004) partes.push('juros R$ ' + brl(juros));
  if (desconto > 0) partes.push('desconto R$ ' + brl(desconto));
  if (autoImported) partes.push('nota importada automaticamente');
  return { id: row.id, ok: true, msg: partes.join(' · '), auto_imported: autoImported };
}

// ── Folha paga pelo Pix (2026-09-18) ───────────────────────────────────────
// A folha já entra na DRE pelo hr_payroll; aqui só se registra que ELA foi paga, na data e pelo valor
// do extrato — o mesmo pay_payroll da tela RH (grava o fluxo de caixa 'auto_payroll').
async function confirmPayroll(ctx: Ctx, row: Row): Promise<Result> {
  const { admin, tenantId } = ctx;
  const fail = (msg: string): Result => ({ id: String(row.id), ok: false, msg });
  const det = (row.match_detail ?? {}) as Row;
  const { data: p } = await admin.from('hr_payroll').select('id, employee_name, net_salary, status, reference_month')
    .eq('id', String(row.match_ref_id ?? det.payroll_id ?? '')).eq('tenant_id', tenantId).maybeSingle();
  if (!p) return fail('Folha não encontrada');
  if (p.status === 'paid') return fail('Essa folha já está paga no RH');
  if (Math.abs(Number(p.net_salary) - Number(row.amount)) > 0.005) return fail('O líquido da folha mudou: rode a conciliação de novo');
  const paidDate = String(row.transaction_date);
  const pay = await callEdge(ctx, 'financial-write', { action: 'pay_payroll', tenant_id: tenantId, payload: { id: p.id, paid_date: paidDate, payment_method: 'Pix' } });
  if (!pay.ok) return fail('Marcar a folha como paga: ' + (pay.error ?? 'falhou'));
  const now = new Date().toISOString();
  const { error } = await admin.from('fin_bank_statement_imports').update({
    status: 'matched', reconciled: true, reconciled_at: now, reconciled_by: ctx.userId, matched_at: now, matched_by: ctx.userId,
    match_detail: { ...det, confirmed: { payroll_id: p.id, at: now, by: ctx.userId } },
  }).eq('id', row.id);
  if (error) log('ERROR', 'confirm', 'marcar extrato (folha) falhou', { tenantId, rowId: row.id, error: error.message });
  return { id: String(row.id), ok: true, msg: 'Folha ' + String(p.reference_month) + ' de ' + String(p.employee_name) + ' marcada como paga em ' + br(paidDate) };
}

// ── Lançar a partir do extrato (pagamento sem nota) ─────────────────────────
// Linhas que já têm destino: vínculo com nota/conta, transferência própria, repasse de cartão/iFood.
const JA_TEM_DESTINO = ['payable', 'inbound_doc', 'internal_transfer', 'stone_deposit', 'stone_detail', 'ifood_deposit', 'card_deposit'];
const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

interface CreateOpts {
  /** 'freelancer' (2026-09-20) e uma despesa em RH que tambem registra o freela e as diarias */
  kind: 'despesa' | 'compra' | 'freelancer';
  /** freelancer: dias trabalhados ('YYYY-MM-DD'); vazio = a aba Freelancers pergunta depois */
  dias?: string[];
  funcao?: string | null;
  dreCategoryId: string | null;
  mercCategoryId: string | null;
  description: string | null;
  supplier: string | null;
  costCenterId: string | null;
  allowPayroll: boolean;
  /** 'YYYY-MM': mês a que o gasto pertence (fin_accounts_payable.competence_month) */
  competenceMonth?: string | null;
}

const competenciaOk = (v: unknown) => (typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);

// Opções de lançamento a partir de uma regra (fin_reconciliation_rules action 'launch')
function ruleOpts(rule: Row, competencia: unknown): CreateOpts {
  return {
    kind: rule.launch_kind === 'compra' ? 'compra' : 'despesa',
    dreCategoryId: rule.dre_category_id ?? null,
    mercCategoryId: rule.merchandise_category_id ?? null,
    description: rule.supplier_name ?? rule.counterpart_label ?? null,
    supplier: rule.supplier_name ?? null,
    costCenterId: rule.cost_center_id ?? null,
    allowPayroll: false,
    competenceMonth: competenciaOk(competencia),
  };
}

// Confirma a sugestão de uma regra: lança como o "Lançar" (a linha já está reservada).
// prev_match_kind vai vazio: desfeito, a próxima rodada de sugestões refaz o vínculo com a regra.
async function confirmRule(ctx: Ctx, row: Row, competencia?: unknown): Promise<Result> {
  const { admin, tenantId } = ctx;
  const { data: rule } = await admin.from('fin_reconciliation_rules').select('*')
    .eq('id', String(row.match_ref_id ?? '')).eq('tenant_id', tenantId).eq('action', 'launch').maybeSingle();
  if (!rule || !rule.is_active) return { id: String(row.id), ok: false, msg: 'A regra deste pagamento não existe mais: atualize a tela' };
  const det = (row.match_detail ?? {}) as Row;
  const r = await createOneClaimed(ctx, String(row.id), ruleOpts(rule, competencia ?? det.competencia), { ...row, match_kind: null, category: null });
  if (r.ok) {
    await admin.from('fin_reconciliation_rules').update({ match_count: Number(rule.match_count ?? 0) + 1, last_applied_at: new Date().toISOString() }).eq('id', rule.id);
  }
  return r;
}

async function createOne(ctx: Ctx, rowId: string, o: CreateOpts): Promise<Result> {
  const { admin, tenantId } = ctx;
  const { data: row } = await admin.from('fin_bank_statement_imports').select('*').eq('id', rowId).eq('tenant_id', tenantId).maybeSingle();
  if (!row) return { id: rowId, ok: false, msg: 'Lançamento não encontrado' };
  if (row.transaction_type !== 'debit') return { id: rowId, ok: false, msg: 'Só pagamentos (saídas) viram despesa ou compra' };
  if (row.reconciled || row.status !== 'pending') return { id: rowId, ok: false, msg: 'Este pagamento já está conciliado' };
  return withRowClaim(ctx, rowId, () => createOneClaimed(ctx, rowId, o, row));
}

async function createOneClaimed(ctx: Ctx, rowId: string, o: CreateOpts, row: Row): Promise<Result> {
  const { admin, tenantId } = ctx;
  const fail = (msg: string, code?: string): Result => ({ id: rowId, ok: false, msg, ...(code ? { code } : {}) });
  if (JA_TEM_DESTINO.includes(String(row.match_kind ?? ''))) {
    return fail(['payable', 'inbound_doc'].includes(String(row.match_kind))
      ? 'Este pagamento tem vínculo sugerido com nota/conta: confirme o vínculo em vez de lançar de novo'
      : 'Este pagamento já tem destino (transferência entre contas ou repasse)');
  }
  const valor = round2(Number(row.amount));
  if (!(valor > 0)) return fail('Valor inválido');
  const doc = soDigitos(row.counterpart_doc);

  // Pix para CPF de funcionário: o salário já entra na DRE pela folha (hr_payroll)
  if (doc.length === 11 && !o.allowPayroll) {
    const { data: emps } = await admin.from('hr_employees').select('name, cpf').eq('tenant_id', tenantId);
    const func = ((emps ?? []) as Row[]).find((e) => soDigitos(e.cpf) === doc);
    if (func) return fail('O CPF é de ' + func.name + ', funcionário cadastrado: salário já entra na DRE pela folha. Se não for salário, lance mesmo assim.', 'folha');
  }

  const paidDate = String(row.transaction_date);
  const tipo = String(row.raw?.tipoTransacao ?? '');
  const metodo = tipo === 'PAGAMENTO' ? 'Boleto' : tipo === 'PIX' ? 'Pix' : 'Transferência';
  const quem = String(row.counterpart_name ?? '').trim();
  const descricao = (o.description ?? '').trim().slice(0, 200) || quem || String(row.description ?? 'Pagamento');
  const nota = 'Lançado pela conciliação bancária: pagamento sem nota de ' + br(paidDate) + (quem ? ' para ' + quem : '') + (doc ? ' (' + doc + ')' : '');
  let billId: string | null = null;
  let purchaseId: string | null = null;
  let categoria = 'Compras';

  if (o.kind === 'despesa' || o.kind === 'freelancer') {
    // Freelancer entra sempre em RH, a mesma categoria do Pix pago pelo ERPOS (fn_freelancer_registrar_pagamento)
    let catId = o.dreCategoryId;
    if (o.kind === 'freelancer') {
      const { data: rh } = await admin.from('fin_dre_categories').select('id').eq('tenant_id', tenantId)
        .eq('group_type', 'expense').is('parent_id', null).is('deleted_at', null).ilike('name', 'RH').maybeSingle();
      catId = rh?.id ?? null;
      if (!catId) {
        const { data: nova } = await admin.from('fin_dre_categories').insert({ tenant_id: tenantId, name: 'RH', group_type: 'expense' }).select('id').maybeSingle();
        catId = nova?.id ?? null;
      }
      if (!catId) return fail('Nao consegui achar nem criar a categoria RH da DRE');
    }
    if (!catId) return fail('Escolha a categoria da despesa');
    const { data: cat } = await admin.from('fin_dre_categories').select('id, name, group_type').eq('id', catId).eq('tenant_id', tenantId).maybeSingle();
    if (!cat || ['revenue', 'tax', 'cost'].includes(String(cat.group_type))) return fail('Categoria da DRE inválida para despesa');
    categoria = String(cat.name);
    const nb = await callEdge(ctx, 'financial-write', {
      action: 'upsert_bill', tenant_id: tenantId,
      payload: {
        description: descricao, supplier: quem || null, amount: valor, due_date: paidDate, status: 'pending',
        category: categoria, dre_category_id: cat.id, cost_center_id: o.costCenterId, is_recurring: false,
        bank_account_id: row.bank_account_id, reference_type: 'conciliacao_extrato', reference_id: row.id, notes: nota,
      },
    });
    billId = nb.data?.data?.id ?? null;
    if (!billId) return fail('Criar a conta: ' + (nb.error ?? 'falhou'));
  } else {
    if (o.mercCategoryId) {
      const { data: m } = await admin.from('fin_merchandise_categories').select('id').eq('id', o.mercCategoryId).eq('tenant_id', tenantId).maybeSingle();
      if (!m) return fail('Categoria do CMV inválida');
    }
    // Fornecedor: o já cadastrado com este CNPJ; senão o nome informado. Não grava CNPJ em fornecedor
    // novo — fornecedor com CNPJ/chave Pix é a lista branca do Pix e só se cadastra pela tela própria.
    let fornecedor = (o.supplier ?? '').trim() || quem;
    if (doc.length === 14) {
      const { data: sups } = await admin.from('fin_suppliers').select('name, cnpj').eq('tenant_id', tenantId).is('deleted_at', null);
      const s = ((sups ?? []) as Row[]).find((x) => soDigitos(x.cnpj) === doc);
      if (s?.name) fornecedor = String(s.name);
    }
    if (!fornecedor) fornecedor = 'Fornecedor sem nota';
    const cp = await callEdge(ctx, 'purchase-write', {
      action: 'create_purchase', tenant_id: tenantId,
      payload: {
        supplier: fornecedor, purchase_date: paidDate, due_date: paidDate, payment_status: 'pending', payment_method: metodo,
        bank_account_id: row.bank_account_id, cost_center_id: o.costCenterId, notes: nota,
        items: [{ description: descricao, quantity: 1, unit_price: valor, unit_label: 'un', merchandise_category_id: o.mercCategoryId }],
      },
    });
    purchaseId = cp.data?.data?.id ?? null;
    if (!purchaseId) return fail('Criar a compra: ' + (cp.error ?? 'falhou'));
    const { data: bills } = await admin.from('fin_accounts_payable').select('id').eq('tenant_id', tenantId).eq('reference_type', 'purchase').eq('reference_id', purchaseId);
    billId = (bills ?? []).length === 1 ? bills![0].id : null;
    if (!billId) {
      await callEdge(ctx, 'purchase-write', { action: 'delete_purchase', tenant_id: tenantId, payload: { id: purchaseId } });
      return fail('A compra não gerou uma conta a pagar única; nada foi lançado');
    }
    // O item entra na Classificação de itens como CMV (não fica "pendente")
    await admin.from('fin_item_classifications')
      .update({ classe: 'cmv', merchandise_category_id: o.mercCategoryId, classified_by: ctx.userId, classified_at: new Date().toISOString(), auto_classified: false })
      .eq('tenant_id', tenantId).eq('last_ref_id', purchaseId).is('classe', null);
  }

  const competencia = competenciaOk(o.competenceMonth);
  if (competencia) {
    const { error: ce } = await admin.from('fin_accounts_payable').update({ competence_month: competencia + '-01' }).eq('id', billId).eq('tenant_id', tenantId);
    if (ce) log('WARN', 'create', 'gravar competência falhou', { tenantId, billId, error: ce.message });
  }

  const pay = await callEdge(ctx, 'financial-write', {
    action: 'pay_bill', tenant_id: tenantId,
    payload: { id: billId, paid_date: paidDate, paid_amount: valor, payment_method: metodo, bank_account_id: row.bank_account_id },
  });
  if (!pay.ok) {
    if (purchaseId) await callEdge(ctx, 'purchase-write', { action: 'delete_purchase', tenant_id: tenantId, payload: { id: purchaseId } });
    else await admin.from('fin_accounts_payable').delete().eq('id', billId).eq('tenant_id', tenantId);
    return fail('Dar baixa: ' + (pay.error ?? 'falhou'));
  }

  // Freelancer: cria/acha o cadastro e grava as diarias (sem dias, fica "aguardando dias" na aba Freelancers)
  let freelaMsg = '';
  if (o.kind === 'freelancer') {
    const dias = (o.dias ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    const { data: fr, error: fe } = await admin.rpc('fn_freelancer_do_extrato', {
      p_bill_id: billId, p_nome: quem || descricao, p_dias: dias.length ? dias : null, p_funcao: o.funcao ?? null,
    });
    if (fe) {
      // A despesa ja foi lancada e baixada: desfaz tudo para nao deixar meio caminho.
      await reversePayment(ctx, billId!, valor, row.bank_account_id, paidDate);
      await admin.from('fin_accounts_payable').delete().eq('id', billId).eq('tenant_id', tenantId);
      return fail('Registrar o freelancer: ' + fe.message);
    }
    const f = (fr ?? {}) as Row;
    freelaMsg = Number(f.dias_registrados ?? 0) > 0
      ? ' (' + f.dias_registrados + ' diaria' + (Number(f.dias_registrados) > 1 ? 's' : '') + ')'
      : ' (dias a informar em Financeiro > Freelancers)';
  }

  const now = new Date().toISOString();
  const confirmed = { bill_id: billId, juros_bill_id: null, pay_amount: valor, juros: 0, desconto: 0, auto_imported: false, created: o.kind, purchase_id: purchaseId, at: now, by: ctx.userId };
  const { error: upErr } = await admin.from('fin_bank_statement_imports').update({
    status: 'matched', reconciled: true, reconciled_at: now, reconciled_by: ctx.userId, matched_at: now, matched_by: ctx.userId,
    match_kind: 'payable', match_ref_id: billId, match_confidence: 'manual', category: categoria,
    match_detail: {
      label: (o.kind === 'compra' ? 'Compra sem nota: ' : o.kind === 'freelancer' ? 'Freelancer: ' : 'Despesa sem nota: ') + descricao + (competencia ? ' · competência ' + competencia.slice(5, 7) + '/' + competencia.slice(0, 4) : ''),
      valor, created: o.kind, competencia,
      prev_category: row.category ?? null, prev_match_kind: row.match_kind === 'rule' ? null : row.match_kind ?? null, confirmed,
    },
  }).eq('id', row.id);
  if (upErr) log('ERROR', 'create', 'marcar extrato falhou', { tenantId, rowId, error: upErr.message });
  return { id: row.id, ok: true, msg: (o.kind === 'compra' ? 'Compra' : o.kind === 'freelancer' ? 'Pagamento de freelancer' : 'Despesa') + ' de R$ ' + brl(valor) + ' lançado: "' + descricao + '"' + freelaMsg };
}

// ── Nota do mês: 1 nota ↔ vários pagamentos ─────────────────────────────────
// Fornecedor que emite UMA nota no mês cobrindo vários Pix/boletos já pagos. A nota vira compra
// (ou despesa) na data de EMISSÃO (decisão do dono 2026-09-14), com uma parcela por pagamento,
// cada uma baixada na data/conta do extrato; o saldo que faltar fica a pagar.
const NOME_GENERICO = new Set(['LTDA', 'EIRELI', 'COMERCIAL', 'COMERCIO', 'DISTRIBUIDORA', 'DISTRIBUIDOR', 'INDUSTRIA',
  'ALIMENTOS', 'EMPRESA', 'SERVICOS', 'BRASIL', 'DOS', 'DAS', 'COM', 'IND', 'CIA']);
// Mesma regra de fn_name_key (SQL): 1ª palavra significativa, sem acento
function nameKey(s: unknown): string | null {
  const t = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z0-9]+/);
  return t.find((w) => w.length >= 3 && !NOME_GENERICO.has(w)) ?? null;
}
const MONTHLY_ANTES = 45;   // dias antes da emissão
const MONTHLY_DEPOIS = 20;  // dias depois (nota emitida no começo do mês, pagamento atrasado)

async function monthlyCandidates(ctx: Ctx, doc: Row) {
  const { admin, tenantId } = ctx;
  const emissao = String(doc.emitted_at ?? '').slice(0, 10);
  const raiz = soDigitos(doc.emitente_cnpj).slice(0, 8);
  const chave = nameKey(doc.emitente_nome);
  const { data } = await admin.from('fin_bank_statement_imports')
    .select('id, transaction_date, amount, counterpart_doc, counterpart_name, description, match_kind, match_detail, raw')
    .eq('tenant_id', tenantId).eq('source', 'inter').eq('transaction_type', 'debit').eq('status', 'pending').eq('reconciled', false)
    .gte('transaction_date', addDays(emissao, -MONTHLY_ANTES)).lte('transaction_date', addDays(emissao, MONTHLY_DEPOIS))
    .order('transaction_date');
  return ((data ?? []) as Row[]).filter((r) => {
    const mk = String(r.match_kind ?? '');
    // Linha com outro destino (vínculo com outra nota/conta, transferência, repasse) fica de fora
    if (mk && !(['payable', 'inbound_doc'].includes(mk) && String(r.match_detail?.doc_id ?? '') === String(doc.id))) return false;
    const cp = soDigitos(r.counterpart_doc);
    if (cp.length === 14 && raiz) return cp.slice(0, 8) === raiz;
    // Boleto: o CNPJ no extrato é o da própria loja — casa pelo nome
    return !!chave && nameKey(r.counterpart_name ?? r.description) === chave;
  }).map((r) => ({
    id: String(r.id), data: String(r.transaction_date), valor: round2(Number(r.amount)),
    nome: String(r.counterpart_name ?? r.description ?? ''),
    tipo: String(r.raw?.tipoTransacao ?? '') === 'PAGAMENTO' ? 'Boleto' : String(r.raw?.tipoTransacao ?? '') === 'PIX' ? 'Pix' : 'Transferência',
  }));
}

// Combinação de pagamentos que soma o valor da nota (centavos; 1º os do mês da emissão)
function sugerirCombinacao(cands: { id: string; data: string; valor: number }[], total: number, emissao: string): string[] {
  const alvo = Math.round(total * 100);
  const mes = emissao.slice(0, 7);
  const doMes = cands.filter((c) => c.data.slice(0, 7) === mes);
  const somaMes = doMes.reduce((s, c) => s + Math.round(c.valor * 100), 0);
  if (doMes.length > 0 && Math.abs(somaMes - alvo) <= 1) return doMes.map((c) => c.id);
  if (alvo <= 0 || alvo > 20_000_000) return [];
  // Mais próximos da emissão primeiro; no máximo 40 pagamentos
  const dist = (d: string) => Math.abs(new Date(d).getTime() - new Date(emissao).getTime());
  const itens = cands.slice().sort((a, b) => dist(a.data) - dist(b.data)).slice(0, 40);
  const cent = itens.map((c) => Math.round(c.valor * 100));
  const lim = alvo + 1;
  const pai = new Int16Array(lim + 1);  // item (+1) que alcançou a soma pela 1ª vez
  const ok = new Uint8Array(lim + 1);
  ok[0] = 1;
  for (let i = 0; i < cent.length; i++) {
    const a = cent[i];
    for (let s = lim; s >= a; s--) if (!ok[s] && ok[s - a]) { ok[s] = 1; pai[s] = i + 1; }
  }
  const s0 = ok[alvo] ? alvo : ok[alvo - 1] ? alvo - 1 : ok[alvo + 1] ? alvo + 1 : -1;
  if (s0 <= 0) return [];
  const out: string[] = [];
  for (let s = s0; s > 0;) { const i = pai[s] - 1; out.push(itens[i].id); s -= cent[i]; }
  return out;
}

async function linkMonthly(ctx: Ctx, doc: Row, ids: string[], body: Row): Promise<{ ok: boolean; msg: string }> {
  const { admin, tenantId } = ctx;
  if (doc.status !== 'new') return { ok: false, msg: 'Esta nota já foi lançada ou está ignorada' };
  if (Number(doc.sefaz_status) === 2) return { ok: false, msg: 'A nota foi CANCELADA na SEFAZ — não lance' };
  const servico = Number(doc.modelo) === 10;
  const validos = new Map((await monthlyCandidates(ctx, doc)).map((c) => [c.id, c]));
  const rows = ids.map((id) => validos.get(id)).filter(Boolean) as { id: string; data: string; valor: number; tipo: string }[];
  if (rows.length === 0 || rows.length !== ids.length) return { ok: false, msg: 'Algum pagamento escolhido não está mais disponível (já conciliado?). Recarregue.' };
  rows.sort((a, b) => a.data.localeCompare(b.data));
  const total = round2(Number(doc.valor_total ?? 0));
  const soma = round2(rows.reduce((s, r) => s + r.valor, 0));
  if (soma > total + 0.01) return { ok: false, msg: 'Os pagamentos somam R$ ' + brl(soma) + ', mais que a nota (R$ ' + brl(total) + '): desmarque algum' };

  const parcelas = rows.map((r, i) => ({ numero: String(i + 1), vencimento: r.data, valor: r.valor }));
  const saldo = round2(total - soma);
  const vencSaldo = /^\d{4}-\d{2}-\d{2}$/.test(String(body.saldo_vencimento ?? '')) ? String(body.saldo_vencimento) : todayBR();
  if (saldo >= 0.02) parcelas.push({ numero: String(parcelas.length + 1), vencimento: vencSaldo, valor: saldo });
  else if (saldo > 0) parcelas[parcelas.length - 1].valor = round2(parcelas[parcelas.length - 1].valor + saldo); // 1 centavo de arredondamento

  const nota = 'Nota do mês: quitada por ' + rows.length + ' pagamento(s) do extrato (' + br(rows[0].data) + ' a ' + br(rows[rows.length - 1].data) + ')';
  // tipo escolhido na tela (NFS-e de fornecedor de produto pode ser compra); sem ele, NFS-e = despesa
  // e a Classificação de itens decide dentro do fiscal-inbound.
  const escolhido = body.tipo === 'purchase' || body.tipo === 'bill';
  const comoDespesa = escolhido ? body.tipo === 'bill' : servico;
  const imp = await callEdge(ctx, 'fiscal-inbound', comoDespesa
    ? { action: 'import_bill', tenant_id: tenantId, document_id: doc.id, parcelas, notes: nota, tipo_escolhido: escolhido,
        category: body.category ?? 'Serviços de terceiros', dre_category_id: body.dre_category_id ?? null, cost_center_id: body.cost_center_id ?? null }
    : { action: 'import_purchase', tenant_id: tenantId, document_id: doc.id, parcelas, notes: nota, tipo_escolhido: escolhido,
        cost_center_id: body.cost_center_id ?? null, links: body.links });
  if (!imp.ok) return { ok: false, msg: 'Lançar a nota: ' + (imp.error ?? 'falhou') };

  const { data: d2 } = await admin.from('fiscal_inbound_documents').select('payable_ids').eq('id', doc.id).maybeSingle();
  const { data: bills } = await admin.from('fin_accounts_payable').select('id, amount, due_date').eq('tenant_id', tenantId).in('id', (d2?.payable_ids ?? []) as string[]);
  const livres = ((bills ?? []) as Row[]).slice();
  const feitos: { row: typeof rows[number]; billId: string; valor: number }[] = [];
  let erro: string | null = null;
  for (const r of rows) {
    const k = livres.findIndex((b) => b.due_date === r.data && Math.abs(Number(b.amount) - r.valor) <= 0.015);
    const b = k >= 0 ? livres.splice(k, 1)[0] : null;
    if (!b) { erro = 'não achei a parcela de ' + br(r.data); break; }
    const valor = round2(Math.min(r.valor, Number(b.amount)));
    const { data: linha } = await admin.from('fin_bank_statement_imports').select('bank_account_id, match_kind, category').eq('id', r.id).maybeSingle();
    const pay = await callEdge(ctx, 'financial-write', {
      action: 'pay_bill', tenant_id: tenantId,
      payload: { id: b.id, paid_date: r.data, paid_amount: valor, payment_method: r.tipo, bank_account_id: linha?.bank_account_id ?? null },
    });
    if (!pay.ok) { erro = 'baixa de ' + br(r.data) + ': ' + (pay.error ?? 'falhou'); break; }
    feitos.push({ row: r, billId: b.id, valor });
    const now = new Date().toISOString();
    await admin.from('fin_bank_statement_imports').update({
      status: 'matched', reconciled: true, reconciled_at: now, reconciled_by: ctx.userId, matched_at: now, matched_by: ctx.userId,
      match_kind: 'payable', match_ref_id: b.id, match_confidence: 'manual',
      match_detail: {
        doc_id: doc.id, label: 'NF ' + (doc.numero ?? '?') + ' — ' + (doc.emitente_nome ?? '') + ' (nota do mês)', valor, monthly: true,
        prev_match_kind: linha?.match_kind ?? null, prev_category: linha?.category ?? null,
        confirmed: { bill_id: b.id, juros_bill_id: null, pay_amount: valor, juros: 0, desconto: 0, auto_imported: false, monthly_doc_id: doc.id, at: now, by: ctx.userId },
      },
    }).eq('id', r.id);
  }
  if (erro) {
    // Desfaz tudo: nada de nota meio vinculada
    await admin.from('fiscal_inbound_documents').update({ settlement: 'monthly', settlement_statement_ids: feitos.map((f) => f.row.id) }).eq('id', doc.id);
    const u = await unlinkMonthly(ctx, { ...doc, status: 'imported' }, true);
    return { ok: false, msg: 'Vincular: ' + erro + (u.ok ? ' (nada foi lançado)' : ' — e desfazer falhou: ' + u.msg) };
  }
  await admin.from('fiscal_inbound_documents').update({
    settlement: 'monthly', settlement_statement_ids: rows.map((r) => r.id), updated_at: new Date().toISOString(),
  }).eq('id', doc.id);
  return { ok: true, msg: (comoDespesa ? 'Despesa' : 'Compra') + ' lançada em ' + br(String(doc.emitted_at).slice(0, 10)) + ' e quitada por ' + rows.length + ' pagamento(s)' + (saldo >= 0.02 ? ' · saldo de R$ ' + brl(saldo) + ' em Contas a Pagar' : '') };
}

async function unlinkMonthly(ctx: Ctx, doc: Row, silencioso = false): Promise<{ ok: boolean; msg: string }> {
  const { admin, tenantId } = ctx;
  const { data: cur } = await admin.from('fiscal_inbound_documents').select('*').eq('id', doc.id).eq('tenant_id', tenantId).maybeSingle();
  if (!cur || cur.settlement !== 'monthly' || cur.status !== 'imported') return { ok: false, msg: 'Esta nota não foi vinculada a pagamentos do mês' };
  if (cur.purchase_id) {
    const { data: p } = await admin.from('fin_purchases').select('stock_applied_at').eq('id', cur.purchase_id).maybeSingle();
    if (p?.stock_applied_at) return { ok: false, msg: 'A mercadoria já deu entrada no estoque: desfaça o recebimento antes' };
  }
  const linhas = ((cur.settlement_statement_ids ?? []) as string[]);
  const { data: rs } = linhas.length
    ? await admin.from('fin_bank_statement_imports').select('*').eq('tenant_id', tenantId).in('id', linhas)
    : { data: [] as Row[] };
  const nossos = new Set<string>();
  for (const r of (rs ?? []) as Row[]) {
    const c = r.match_detail?.confirmed as Row | undefined;
    if (c?.monthly_doc_id === cur.id && c.bill_id) nossos.add(String(c.bill_id));
  }
  // Parcela (o saldo) paga por fora: estorne primeiro
  const payIds = ((cur.payable_ids ?? []) as string[]);
  if (payIds.length) {
    const { data: bs } = await admin.from('fin_accounts_payable').select('id, paid_amount').in('id', payIds);
    if (((bs ?? []) as Row[]).some((b) => !nossos.has(String(b.id)) && Number(b.paid_amount ?? 0) > 0)) {
      return { ok: false, msg: 'O saldo desta nota já foi pago por outro lançamento: estorne esse pagamento antes' };
    }
  }
  for (const r of (rs ?? []) as Row[]) {
    const det = (r.match_detail ?? {}) as Row;
    const c = det.confirmed as Row | undefined;
    if (!(c?.monthly_doc_id === cur.id && c.bill_id)) continue;
    await reversePayment(ctx, String(c.bill_id), round2(Number(c.pay_amount)), r.bank_account_id, String(r.transaction_date));
    await admin.from('fin_bank_statement_imports').update({
      status: 'pending', reconciled: false, reconciled_at: null, reconciled_by: null, matched_at: null, matched_by: null,
      match_kind: det.prev_match_kind ?? null, match_ref_id: null, match_confidence: null, match_detail: null, category: det.prev_category ?? null,
    }).eq('id', r.id);
  }
  if (cur.purchase_id) {
    const del = await callEdge(ctx, 'purchase-write', { action: 'delete_purchase', tenant_id: tenantId, payload: { id: cur.purchase_id } });
    if (!del.ok) return { ok: false, msg: 'Pagamentos estornados, mas excluir a compra falhou: ' + (del.error ?? '') };
  } else if (payIds.length) {
    await admin.from('fin_accounts_payable').delete().eq('tenant_id', tenantId).in('id', payIds);
  }
  await admin.from('fiscal_inbound_documents').update({
    status: 'new', import_type: null, purchase_id: null, payable_ids: [], imported_at: null, imported_by: null,
    settlement: null, settlement_statement_ids: null, auto_launch_blocked: true, error_message: null, updated_at: new Date().toISOString(),
  }).eq('id', cur.id);
  if (!silencioso) log('INFO', 'unlink_monthly', 'ok', { tenantId, doc: cur.id, linhas: linhas.length });
  return { ok: true, msg: 'Vínculo desfeito: os pagamentos voltaram a pendentes e a nota voltou para "A conferir"' };
}

// ── Desfazer (estorno) ───────────────────────────────────────────────────────
async function reversePayment(ctx: Ctx, billId: string, amount: number, bankAccountId: string | null, date: string) {
  const { admin, tenantId } = ctx;
  const { data: b } = await admin.from('fin_accounts_payable').select('*').eq('id', billId).eq('tenant_id', tenantId).maybeSingle();
  if (!b) return null;
  const newPaid = round2(Math.max(0, Number(b.paid_amount ?? 0) - amount));
  const status = newPaid <= 0.005 ? (String(b.due_date) < todayBR() ? 'overdue' : 'pending') : 'partial';
  await admin.from('fin_accounts_payable').update({ paid_amount: newPaid, status, paid_date: newPaid <= 0.005 ? null : b.paid_date }).eq('id', billId);
  const { data: cf } = await admin.from('fin_cash_flow').select('id').eq('tenant_id', tenantId).eq('origin', 'auto_bill_payment').eq('reference_id', billId).eq('amount', amount).order('created_at', { ascending: false }).limit(1);
  if (cf && cf[0]) await admin.from('fin_cash_flow').delete().eq('id', cf[0].id);
  const acc = bankAccountId ?? b.bank_account_id ?? null;
  if (acc) {
    await admin.rpc('fn_bank_credit', {
      p_bank_account_id: acc, p_amount: amount, p_description: 'Estorno da conciliação: ' + String(b.description ?? ''),
      p_reference_type: 'bill_payment_reversal', p_reference_id: billId, p_transaction_date: date,
    });
  }
  if (b.reference_type === 'purchase' && b.reference_id) {
    const { data: sibs } = await admin.from('fin_accounts_payable').select('id, status').eq('tenant_id', tenantId).eq('reference_id', b.reference_id).eq('reference_type', 'purchase');
    const all = (sibs ?? []) as Row[];
    const st = (x: Row) => (x.id === billId ? status : x.status);
    const purchaseStatus = all.every((x) => st(x) === 'paid') ? 'paid' : all.some((x) => st(x) === 'paid' || st(x) === 'partial') ? 'partial' : 'pending';
    await admin.from('fin_purchases').update({ payment_status: purchaseStatus }).eq('id', b.reference_id).eq('tenant_id', tenantId);
  }
  return b;
}

async function undoOne(ctx: Ctx, rowId: string): Promise<Result> {
  const { admin, tenantId } = ctx;
  const { data: row } = await admin.from('fin_bank_statement_imports').select('*').eq('id', rowId).eq('tenant_id', tenantId).maybeSingle();
  if (!row) return { id: rowId, ok: false, msg: 'Lançamento não encontrado' };
  const det = (row.match_detail ?? {}) as Row;
  const c = det.confirmed as Row | undefined;
  if (c?.payroll_id) {
    // Folha confirmada pelo Pix: volta a pendente e sai o fluxo de caixa que o pay_payroll gravou.
    await admin.from('hr_payroll').update({ status: 'pending', paid_date: null, payment_method: null, updated_at: new Date().toISOString() })
      .eq('id', c.payroll_id).eq('tenant_id', tenantId);
    await admin.from('fin_cash_flow').delete().eq('tenant_id', tenantId).eq('origin', 'auto_payroll').eq('reference_id', c.payroll_id);
    const { confirmed: _c, ...resto } = det;
    await admin.from('fin_bank_statement_imports').update({
      status: 'pending', reconciled: false, reconciled_at: null, reconciled_by: null, matched_at: null, matched_by: null, match_detail: resto,
    }).eq('id', row.id);
    return { id: row.id, ok: true, msg: 'Pagamento da folha desfeito: a folha voltou a pendente.' };
  }
  if (!c?.bill_id) return { id: rowId, ok: false, msg: 'Não há baixa feita pela conciliação neste lançamento' };
  if (c.monthly_doc_id) return { id: rowId, ok: false, msg: 'Este pagamento faz parte de uma nota do mês: desfaça pela nota em Notas de Entrada (desfaz todos os pagamentos juntos)' };
  const date = String(row.transaction_date);

  if (c.juros_bill_id && Number(c.juros) > 0) {
    await reversePayment(ctx, c.juros_bill_id, round2(Number(c.juros)), row.bank_account_id, date);
    await admin.from('fin_accounts_payable').delete().eq('id', c.juros_bill_id).eq('tenant_id', tenantId);
  }
  const b = await reversePayment(ctx, c.bill_id, round2(Number(c.pay_amount)), row.bank_account_id, date);

  // Lançado a partir do extrato: apaga o que foi criado e a linha volta a ser um pagamento sem destino
  const criado = ['despesa', 'compra', 'freelancer'].includes(String(c.created)) ? String(c.created) : null;
  if (criado) {
    if (criado === 'freelancer') {
      // As diarias vivem pela conta criada aqui: somem junto com ela.
      await admin.from('hr_freelancer_shifts').delete().eq('tenant_id', tenantId).eq('bill_id', c.bill_id);
    }
    if (criado === 'compra' && c.purchase_id) {
      const del = await callEdge(ctx, 'purchase-write', { action: 'delete_purchase', tenant_id: tenantId, payload: { id: c.purchase_id } });
      if (!del.ok) log('WARN', 'undo', 'apagar compra falhou', { tenantId, rowId, purchaseId: c.purchase_id, error: del.error });
    } else {
      await admin.from('fin_accounts_payable').delete().eq('id', c.bill_id).eq('tenant_id', tenantId);
    }
    await admin.from('fin_bank_statement_imports').update({
      status: 'pending', reconciled: false, reconciled_at: null, reconciled_by: null, matched_at: null, matched_by: null,
      match_kind: det.prev_match_kind ?? null, match_ref_id: null, match_confidence: null, match_detail: null, category: det.prev_category ?? null,
    }).eq('id', row.id);
    return { id: row.id, ok: true, msg: (criado === 'compra' ? 'Compra' : criado === 'freelancer' ? 'Pagamento de freelancer (e as diárias)' : 'Despesa') + ' lançado pelo extrato foi desfeito: o pagamento voltou a pendente.' };
  }

  if (b && Number(c.desconto) > 0) {
    await admin.from('fin_accounts_payable').update({ amount: round2(Number(b.amount) + Number(c.desconto)) }).eq('id', c.bill_id);
  }

  // Volta a ser sugestão; a nota importada automaticamente continua lançada (agora como conta a pagar)
  const { confirmed: _drop, ...rest } = det;
  void _drop;
  await admin.from('fin_bank_statement_imports').update({
    status: 'pending', reconciled: false, reconciled_at: null, reconciled_by: null, matched_at: null, matched_by: null,
    match_kind: 'payable', match_ref_id: c.bill_id, match_detail: { ...rest, auto_import: false },
  }).eq('id', row.id);

  const msg = 'Baixa estornada.' + (c.auto_imported ? ' A nota importada automaticamente continua lançada: se ela não era deste pagamento, exclua a compra em Compras.' : '');
  return { id: row.id, ok: true, msg };
}

// ── Rastreio de um pagamento conciliado (2026-09-20) ─────────────────────────
// "Onde foi parar este pagamento?": devolve a corrente inteira a partir da linha do extrato —
// conta a pagar baixada, compra, nota fiscal de entrada, conta de juros e folha. Só leitura.
async function traceRow(ctx: Ctx, rowId: string) {
  const { admin, tenantId } = ctx;
  const { data: row } = await admin.from('fin_bank_statement_imports').select('*').eq('id', rowId).eq('tenant_id', tenantId).maybeSingle();
  if (!row) return null;
  const det = (row.match_detail ?? {}) as Row;
  const conf = (det.confirmed ?? null) as Row | null;
  const mk = String(row.match_kind ?? '');

  const nome = async (id: unknown) => {
    if (!id) return null;
    const { data } = await admin.from('users').select('name').eq('id', String(id)).maybeSingle();
    return data?.name ?? null;
  };
  const conta = async (id: unknown) => {
    if (!id) return null;
    const { data: b } = await admin.from('fin_accounts_payable')
      .select('id, description, supplier, amount, paid_amount, paid_date, due_date, status, category, competence_month, installment_number, installments, reference_type, reference_id, payment_method, notes')
      .eq('id', String(id)).eq('tenant_id', tenantId).maybeSingle();
    return b ?? null;
  };

  let bill = await conta(conf?.bill_id ?? (mk === 'payable' ? row.match_ref_id : null));
  const jurosBill = await conta(conf?.juros_bill_id);

  // Caminho antigo (inter-bank): a linha casou com um movimento do ERP, sem vínculo de nota/conta.
  // O movimento de uma baixa aponta para a conta a pagar (reference_type 'bill_payment').
  let movimento: Row | null = null;
  if (row.matched_transaction_id) {
    const { data: bt } = await admin.from('fin_bank_transactions')
      .select('id, description, transaction_date, amount, type, reference_type, reference_id')
      .eq('id', String(row.matched_transaction_id)).eq('tenant_id', tenantId).maybeSingle();
    if (bt) {
      movimento = { origem: 'bank_transaction', descricao: bt.description, data: bt.transaction_date, valor: bt.amount, tipo: bt.reference_type };
      if (!bill && String(bt.reference_type).startsWith('bill_payment')) bill = await conta(bt.reference_id);
    } else {
      const { data: cf } = await admin.from('fin_cash_flow')
        .select('id, description, date, amount, type, origin, reference_id, category')
        .eq('id', String(row.matched_transaction_id)).eq('tenant_id', tenantId).maybeSingle();
      if (cf) {
        movimento = { origem: 'cash_flow', descricao: cf.description, data: cf.date, valor: cf.amount, tipo: cf.origin, categoria: cf.category };
        if (!bill && String(cf.origin) === 'accounts_payable') bill = await conta(cf.reference_id);
      }
    }
  }

  // Compra: pela conta (reference_type 'purchase') ou pelo id guardado no lançamento sem nota
  let compra: Row | null = null;
  const purchaseId = String(bill?.reference_type) === 'purchase' ? bill?.reference_id : (conf?.purchase_id ?? null);
  if (purchaseId) {
    const { data: p } = await admin.from('fin_purchases')
      .select('id, supplier, invoice_number, total_amount, purchase_date, payment_status, cost_center_id, notes')
      .eq('id', String(purchaseId)).eq('tenant_id', tenantId).maybeSingle();
    compra = p ?? null;
  }

  // Nota de entrada: a que gerou a conta (payable_ids), a da compra, a sugerida, ou a nota do mês
  let nota: Row | null = null;
  const selNota = 'id, numero, serie, modelo, chave, emitente_nome, emitente_cnpj, valor_total, emitted_at, status, purchase_id, auto_imported, settlement_statement_ids';
  if (bill?.id) {
    const { data: d } = await admin.from('fiscal_inbound_documents').select(selNota).eq('tenant_id', tenantId).contains('payable_ids', [bill.id]).limit(1);
    nota = (d ?? [])[0] ?? null;
  }
  if (!nota && compra?.id) {
    const { data: d } = await admin.from('fiscal_inbound_documents').select(selNota).eq('tenant_id', tenantId).eq('purchase_id', compra.id).limit(1);
    nota = (d ?? [])[0] ?? null;
  }
  if (!nota && det.doc_id) {
    const { data: d } = await admin.from('fiscal_inbound_documents').select(selNota).eq('tenant_id', tenantId).eq('id', String(det.doc_id)).maybeSingle();
    nota = d ?? null;
  }
  if (!nota) {
    // Nota do mês: uma nota cobre vários pagamentos (settlement_statement_ids)
    const { data: d } = await admin.from('fiscal_inbound_documents').select(selNota).eq('tenant_id', tenantId).contains('settlement_statement_ids', [row.id]).limit(1);
    nota = (d ?? [])[0] ?? null;
    if (nota && !compra && nota.purchase_id) {
      const { data: p } = await admin.from('fin_purchases').select('id, supplier, invoice_number, total_amount, purchase_date, payment_status, cost_center_id, notes')
        .eq('id', String(nota.purchase_id)).eq('tenant_id', tenantId).maybeSingle();
      compra = p ?? null;
    }
  }

  // Folha (salário pago por Pix)
  let folha: Row | null = null;
  if (mk === 'payroll' || conf?.payroll_id) {
    const { data: f } = await admin.from('hr_payroll').select('id, employee_name, reference_month, net_salary, status, paid_date')
      .eq('id', String(conf?.payroll_id ?? row.match_ref_id ?? '')).eq('tenant_id', tenantId).maybeSingle();
    folha = f ?? null;
  }

  return {
    pagamento: {
      id: row.id, data: row.transaction_date, valor: round2(Number(row.amount)), descricao: row.description,
      quem: row.counterpart_name, doc: row.counterpart_doc, status: row.status, categoria: row.category,
      tipo: String(row.raw?.tipoTransacao ?? '') === 'PAGAMENTO' ? 'Boleto' : String(row.raw?.tipoTransacao ?? '') === 'PIX' ? 'Pix' : null,
      confirmado_em: row.reconciled_at ?? conf?.at ?? null,
      confirmado_por: await nome(row.reconciled_by ?? conf?.by ?? null),
      origem: conf?.created ? 'lancado_do_extrato' : mk === 'payroll' ? 'folha' : nota ? 'nota' : 'conta',
    },
    conta: bill, juros: jurosBill, compra, nota, folha, movimento,
    nota_do_mes: !!(nota && Array.isArray(nota.settlement_statement_ids) && nota.settlement_statement_ids.includes(row.id)),
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || serviceRoleKey.length < 40) return errResp('Server misconfiguration', 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return errResp('Invalid JSON body'); }
  const action = String(body.action ?? '');

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return errResp('Unauthorized', 401);
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user) return errResp('Unauthorized', 401);
    const userId = u.user.id;
    const requested: string | null = body.tenant_id ?? null;
    const { data: memberships } = await admin.from('user_tenants').select('tenant_id, role').eq('user_id', userId);
    const match = requested ? (memberships ?? []).find((r) => r.tenant_id === requested) : ((memberships ?? []).length === 1 ? memberships![0] : null);
    if (!match) return errResp('Sem acesso a esta loja', 403);
    const tenantId = String(match.tenant_id);
    const role = String(match.role ?? '');
    const isManager = role === 'admin' || role === 'manager';
    const ctx: Ctx = { admin, tenantId, userId, token, supabaseUrl, anonKey };

    if (action === 'rematch') {
      const to = todayBR();
      const from = addDays(to, -120);
      const { data, error } = await admin.rpc('fn_match_payments', { p_tenant: tenantId, p_from: from, p_to: to });
      if (error) return errResp('Sugerir vínculos: ' + error.message, 500);
      const { data: folha, error: fe } = await admin.rpc('fn_match_payroll', { p_tenant: tenantId, p_from: from, p_to: to });
      if (fe) log('WARN', 'rematch', 'fn_match_payroll falhou', { tenantId, error: fe.message });
      const { data: regras, error: re } = await admin.rpc('fn_match_launch_rules', { p_tenant: tenantId, p_from: from, p_to: to });
      if (re) log('WARN', 'rematch', 'fn_match_launch_rules falhou', { tenantId, error: re.message });
      // Etiquetas por texto nas ENTRADAS já importadas (regra nova pega o histórico todo)
      const { error: le } = await admin.rpc('fn_apply_label_rules', { p_tenant: tenantId, p_from: '2000-01-01', p_to: to });
      if (le) log('WARN', 'rematch', 'fn_apply_label_rules falhou', { tenantId, error: le.message });
      return json({ success: true, ...(data as Row ?? {}), folha: folha ?? 0, regras_lancamento: regras ?? 0 });
    }

    if (action === 'alerts') {
      const { data, error } = await admin.rpc('fn_conciliacao_alertas', { p_tenant: tenantId });
      if (error) return errResp('Alertas: ' + error.message, 500);
      // Repasses da Stone que não bateram com o banco nos últimos 120 dias (fn_stone_repasses).
      // sem_deposito de ontem/hoje ainda pode chegar: só alerta a partir de anteontem.
      const alerts = (data ?? {}) as Record<string, unknown>;
      const hoje = todayBR();
      const { data: rep, error: repErr } = await admin.rpc('fn_stone_repasses', { p_tenant: tenantId, p_from: addDays(hoje, -120), p_to: hoje });
      if (!repErr) {
        const pilhaNome = (p: string) => (p === 'antecipado' ? 'crédito antecipado' : 'débito');
        const ruins = ((rep ?? []) as Array<Record<string, any>>).filter((r) =>
          r.situacao === 'faltou' || r.situacao === 'sobrou' || (r.situacao === 'sem_deposito' && String(r.dia) < addDays(hoje, -1)));
        alerts.repasses_stone = {
          count: ruins.length,
          total: Math.round(ruins.reduce((s, r) => s + Number(r.diferenca), 0) * 100) / 100,
          itens: ruins.slice(0, 10).map((r) => ({
            data: r.dia,
            label: `${pilhaNome(r.pilha)}: Stone liquidou ${br$(r.liquido_stone)}, entrou ${br$(r.depositado)}`,
            valor: Number(r.diferenca),
          })),
        };
      } else {
        log('WARN', 'alerts', 'fn_stone_repasses falhou', { tenantId, error: repErr.message });
      }
      // Taxas da maquininha acima do contrato (fn_card_fee_check), só se houver contrato cadastrado
      const { count: nContratos } = await admin.from('fin_card_fee_contracts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      if (Number(nContratos ?? 0) > 0) {
        const { data: tx, error: txErr } = await admin.rpc('fn_card_fee_check', { p_tenant: tenantId, p_from: addDays(hoje, -120), p_to: hoje });
        if (!txErr) {
          const acima = ((tx ?? []) as Array<Record<string, any>>).filter((r) => r.situacao === 'acima');
          const dif = (r: Record<string, any>) => Number(r.dif_mdr ?? 0) + Number(r.dif_antecipacao ?? 0);
          alerts.taxas_maquininha = {
            count: acima.length,
            total: Math.round(acima.reduce((a, r) => a + dif(r), 0) * 100) / 100,
            itens: acima.slice(0, 10).map((r) => ({
              data: r.dia,
              label: `${r.vendas} venda(s) a ${String(r.taxa_cobrada_pct).replace('.', ',')}% (contrato ${String(r.taxa_contratada_pct).replace('.', ',')}%)`,
              valor: Math.round(dif(r) * 100) / 100,
            })),
          };
        } else {
          log('WARN', 'alerts', 'fn_card_fee_check falhou', { tenantId, error: txErr.message });
        }
      }
      return json({ success: true, alerts });
    }

    // Taxas contratadas da maquininha (fin_card_fee_contracts)
    if (action === 'card_fees_list') {
      const { data, error } = await admin.from('fin_card_fee_contracts')
        .select('id, provider, produto, bandeira, mdr_pct, antecipacao_pct_mes, vigente_desde')
        .eq('tenant_id', tenantId).eq('provider', String(body.provider ?? 'stone'))
        .order('vigente_desde', { ascending: false }).order('produto').order('mdr_pct');
      if (error) return errResp('Taxas: ' + error.message, 500);
      return json({ success: true, fees: data ?? [] });
    }

    // Substitui a tabela inteira da maquininha (o que não vier some)
    if (action === 'card_fees_save') {
      if (!isManager) return errResp('Apenas administradores e gerentes podem alterar as taxas', 403);
      const provider = String(body.provider ?? 'stone');
      const PRODUTOS = ['debito', 'credito_vista', 'credito_2_6', 'credito_7_12'];
      const lista = Array.isArray(body.fees) ? (body.fees as Array<Record<string, unknown>>).slice(0, 200) : null;
      if (!lista) return errResp('Envie a lista de taxas');
      const pct = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(',', '.')));
      const linhas: Row[] = [];
      for (const [i, f] of lista.entries()) {
        const produto = String(f.produto ?? '');
        const mdr = pct(f.mdr_pct);
        const antec = pct(f.antecipacao_pct_mes);
        const desde = String(f.vigente_desde ?? '');
        const n = i + 1;
        if (!PRODUTOS.includes(produto)) return errResp(`Linha ${n}: produto inválido`);
        if (mdr === null || !Number.isFinite(mdr) || mdr < 0 || mdr >= 100) return errResp(`Linha ${n}: taxa inválida`);
        if (antec !== null && (!Number.isFinite(antec) || antec < 0 || antec >= 100)) return errResp(`Linha ${n}: antecipação inválida`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return errResp(`Linha ${n}: informe a data "vale a partir de"`);
        const bandeira = String(f.bandeira ?? '').trim();
        linhas.push({
          tenant_id: tenantId, provider, produto, bandeira: bandeira || null, mdr_pct: mdr,
          antecipacao_pct_mes: produto === 'debito' ? null : antec, vigente_desde: desde, created_by: userId,
        });
      }
      const { error: delErr } = await admin.from('fin_card_fee_contracts').delete().eq('tenant_id', tenantId).eq('provider', provider);
      if (delErr) return errResp('Taxas: ' + delErr.message, 500);
      if (linhas.length > 0) {
        const { error: insErr } = await admin.from('fin_card_fee_contracts').insert(linhas);
        if (insErr) return errResp('Taxas: ' + insErr.message, 500);
      }
      return json({ success: true, saved: linhas.length });
    }

    // Conferência: taxa cobrada × contratada por dia, pilha e taxa (fn_card_fee_check)
    if (action === 'card_fee_check') {
      const iso = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
      const to = iso(body.date_to) ?? todayBR();
      const from = iso(body.date_from) ?? addDays(to, -60);
      if (from > to) return errResp('A data inicial é depois da final');
      const [{ data, error }, { count }] = await Promise.all([
        admin.rpc('fn_card_fee_check', { p_tenant: tenantId, p_from: from, p_to: to }),
        admin.from('fin_card_fee_contracts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      ]);
      if (error) return errResp('Taxas: ' + error.message, 500);
      return json({ success: true, date_from: from, date_to: to, has_contract: Number(count ?? 0) > 0, rows: data ?? [] });
    }

    // Quadro "Repasses Stone": dia × pilha, Stone liquidou × entrou no banco (fn_stone_repasses)
    if (action === 'stone_repasses') {
      const iso = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
      const to = iso(body.date_to) ?? todayBR();
      const from = iso(body.date_from) ?? addDays(to, -60);
      if (from > to) return errResp('A data inicial é depois da final');
      const { data, error } = await admin.rpc('fn_stone_repasses', { p_tenant: tenantId, p_from: from, p_to: to });
      if (error) return errResp('Repasses Stone: ' + error.message, 500);
      return json({ success: true, date_from: from, date_to: to, rows: data ?? [] });
    }

    if (action === 'trace') {
      const t = await traceRow(ctx, String(body.id ?? ''));
      if (!t) return errResp('Lançamento não encontrado', 404);
      return json({ success: true, ...t });
    }

    if (action === 'confirm') {
      if (!isManager) return errResp('Apenas administradores e gerentes podem dar baixa', 403);
      const ids = Array.isArray(body.ids) ? [...new Set((body.ids as unknown[]).map(String))].slice(0, MAX_BATCH) : [];
      if (ids.length === 0) return errResp('Nenhum lançamento informado');
      const results: Result[] = [];
      for (const id of ids) {
        try { results.push(await confirmOne(ctx, id)); }
        catch (e) { log('ERROR', 'confirm', 'falhou', { tenantId, id, error: String(e) }); results.push({ id, ok: false, msg: String((e as Error)?.message ?? e) }); }
      }
      log('INFO', 'confirm', 'ok', { tenantId, userId, total: results.length, ok: results.filter((r) => r.ok).length, auto: results.filter((r) => r.auto_imported).length });
      return json({ success: true, results });
    }

    if (action === 'undo') {
      if (!isManager) return errResp('Apenas administradores e gerentes podem estornar', 403);
      const r = await undoOne(ctx, String(body.id ?? ''));
      log('INFO', 'undo', r.ok ? 'ok' : 'recusado', { tenantId, userId, id: body.id, msg: r.msg });
      return r.ok ? json({ success: true, results: [r], message: r.msg }) : errResp(r.msg);
    }

    if (action === 'create_from_statement') {
      if (!isManager) return errResp('Apenas administradores e gerentes podem lançar pelo extrato', 403);
      const ids = Array.isArray(body.ids) ? [...new Set((body.ids as unknown[]).map(String))].slice(0, MAX_BATCH) : [];
      if (ids.length === 0) return errResp('Nenhum lançamento informado');
      const kind = body.kind === 'compra' ? 'compra' : body.kind === 'despesa' ? 'despesa' : body.kind === 'freelancer' ? 'freelancer' : null;
      if (!kind) return errResp('Escolha despesa, compra ou freelancer');
      const opts: CreateOpts = {
        kind,
        dreCategoryId: body.dre_category_id ? String(body.dre_category_id) : null,
        mercCategoryId: body.merchandise_category_id ? String(body.merchandise_category_id) : null,
        description: body.description ? String(body.description) : null,
        supplier: body.supplier ? String(body.supplier) : null,
        costCenterId: body.cost_center_id ? String(body.cost_center_id) : null,
        allowPayroll: body.allow_payroll === true,
        competenceMonth: competenciaOk(body.competence_month),
        dias: Array.isArray(body.dias) ? (body.dias as unknown[]).map(String).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 31) : [],
        funcao: body.funcao ? String(body.funcao).slice(0, 60) : null,
      };
      const results: Result[] = [];
      for (const id of ids) {
        try { results.push(await createOne(ctx, id, opts)); }
        catch (e) { log('ERROR', 'create', 'falhou', { tenantId, id, error: String(e) }); results.push({ id, ok: false, msg: String((e as Error)?.message ?? e) }); }
      }
      log('INFO', 'create', 'ok', { tenantId, userId, kind, total: results.length, ok: results.filter((r) => r.ok).length });
      return json({ success: true, results });
    }

    if (action === 'monthly_candidates' || action === 'link_monthly' || action === 'unlink_monthly') {
      const { data: doc } = await admin.from('fiscal_inbound_documents').select('*').eq('id', String(body.document_id ?? '')).eq('tenant_id', tenantId).maybeSingle();
      if (!doc) return errResp('Nota não encontrada', 404);
      if (action === 'monthly_candidates') {
        const cands = await monthlyCandidates(ctx, doc);
        const sugestao = sugerirCombinacao(cands, Number(doc.valor_total ?? 0), String(doc.emitted_at ?? '').slice(0, 10));
        return json({ success: true, candidates: cands, suggestion: sugestao });
      }
      if (!isManager) return errResp('Apenas administradores e gerentes', 403);
      if (action === 'link_monthly') {
        const ids = Array.isArray(body.ids) ? [...new Set((body.ids as unknown[]).map(String))].slice(0, 60) : [];
        if (ids.length === 0) return errResp('Escolha os pagamentos que esta nota cobre');
        const r = await linkMonthly(ctx, doc, ids, body);
        log(r.ok ? 'INFO' : 'WARN', 'link_monthly', r.msg, { tenantId, userId, doc: doc.id, n: ids.length });
        return r.ok ? json({ success: true, message: r.msg }) : errResp(r.msg);
      }
      const r = await unlinkMonthly(ctx, doc);
      return r.ok ? json({ success: true, message: r.msg }) : errResp(r.msg);
    }

    if (action === 'save_counterpart_rule') {
      if (!isManager) return errResp('Apenas administradores e gerentes podem criar regras', 403);
      const raw = String(body.counterpart_doc ?? '').trim();
      const doc = /^[\d.\-/\s]+$/.test(raw) ? raw.replace(/\D/g, '') : raw.toLowerCase();
      const category = String(body.category ?? '').trim();
      if (!doc) return errResp('Informe o CPF/CNPJ ou a chave Pix');
      if (!category) return errResp('Escolha a categoria');
      const txType = ['credit', 'debit', 'both'].includes(String(body.transaction_type)) ? String(body.transaction_type) : 'both';
      const label = String(body.counterpart_label ?? '').trim().slice(0, 120) || doc;
      const fields = {
        tenant_id: tenantId, counterpart_doc: doc, counterpart_label: label, pattern: doc, match_type: 'contains',
        category, cost_center_id: body.cost_center_id || null, transaction_type: txType, is_active: true, updated_at: new Date().toISOString(),
      };
      const { data: existing } = await admin.from('fin_reconciliation_rules').select('id, action').eq('tenant_id', tenantId).eq('counterpart_doc', doc).maybeSingle();
      // Etiqueta não sobrescreve regra de LANÇAMENTO do mesmo CNPJ (uma regra por CNPJ/chave)
      if (existing?.action === 'launch') return errResp('Este CNPJ/chave já tem regra de lançamento: edite em Regras');
      const { error } = existing
        ? await admin.from('fin_reconciliation_rules').update(fields).eq('id', existing.id)
        : await admin.from('fin_reconciliation_rules').insert({ ...fields, match_count: 0 });
      if (error) return errResp('Salvar regra: ' + error.message, 500);
      // Aplica já nos lançamentos pendentes dessa pessoa
      const to = todayBR();
      await admin.rpc('fn_match_payments', { p_tenant: tenantId, p_from: addDays(to, -120), p_to: to });
      await admin.rpc('fn_match_payroll', { p_tenant: tenantId, p_from: addDays(to, -120), p_to: to });
      await admin.rpc('fn_match_launch_rules', { p_tenant: tenantId, p_from: addDays(to, -120), p_to: to });
      return json({ success: true, message: 'Regra salva: os próximos lançamentos de ' + label + ' entram como "' + category + '".' });
    }

    // ── Regra de lançamento ────────────────────────────────────────────────────
    if (action === 'launch_rule_save') {
      if (!isManager) return errResp('Apenas administradores e gerentes podem criar regras', 403);
      const raw = String(body.counterpart_doc ?? '').trim();
      const doc = /^[\d.\-/\s]+$/.test(raw) ? raw.replace(/\D/g, '') : raw.toLowerCase();
      if (!doc) return errResp('Pagamento sem CPF/CNPJ ou chave Pix: não dá para criar regra');
      const kind = body.kind === 'compra' ? 'compra' : 'despesa';
      const dreId = body.dre_category_id ? String(body.dre_category_id) : null;
      const mercId = body.merchandise_category_id ? String(body.merchandise_category_id) : null;
      if (kind === 'despesa') {
        if (!dreId) return errResp('Escolha a categoria da despesa');
        const { data: cat } = await admin.from('fin_dre_categories').select('id, group_type').eq('id', dreId).eq('tenant_id', tenantId).maybeSingle();
        if (!cat || ['revenue', 'tax', 'cost'].includes(String(cat.group_type))) return errResp('Categoria da DRE inválida para despesa');
      }
      if (doc.length === 11) {
        const { data: emps } = await admin.from('hr_employees').select('name, cpf').eq('tenant_id', tenantId);
        const func = ((emps ?? []) as Row[]).find((e) => soDigitos(e.cpf) === doc);
        if (func) return errResp('O CPF é de ' + func.name + ', funcionário: salário entra pela folha, não por regra');
      }
      const label = String(body.counterpart_label ?? '').trim().slice(0, 120) || doc;
      const fields = {
        tenant_id: tenantId, counterpart_doc: doc, counterpart_label: label, pattern: doc, match_type: 'contains',
        category: null, cost_center_id: body.cost_center_id || null, transaction_type: 'debit', is_active: true,
        action: 'launch', launch_kind: kind, dre_category_id: kind === 'despesa' ? dreId : null, merchandise_category_id: kind === 'compra' ? mercId : null,
        competence_rule: body.competence_rule === 'prev' ? 'prev' : 'same',
        mode: body.mode === 'auto' ? 'auto' : 'suggest',
        supplier_name: String(body.supplier_name ?? '').trim().slice(0, 120) || label, updated_at: new Date().toISOString(),
      };
      const { data: existing } = await admin.from('fin_reconciliation_rules').select('id').eq('tenant_id', tenantId).eq('counterpart_doc', doc).maybeSingle();
      const saved = existing
        ? await admin.from('fin_reconciliation_rules').update(fields).eq('id', existing.id).select('id').single()
        : await admin.from('fin_reconciliation_rules').insert({ ...fields, match_count: 0, created_by: userId }).select('id').single();
      if (saved.error) return errResp('Salvar regra: ' + saved.error.message, 500);
      const to = todayBR();
      await admin.rpc('fn_match_launch_rules', { p_tenant: tenantId, p_from: addDays(to, -120), p_to: to });
      const { data: cands } = await admin.rpc('fn_launch_rule_candidates', { p_tenant: tenantId, p_rule: saved.data.id, p_from: '2000-01-01', p_to: to });
      const pendentes = ((cands ?? []) as Row[]).filter((c) => !c.bloqueio).length;
      log('INFO', 'launch_rule_save', 'ok', { tenantId, userId, doc, kind, pendentes });
      return json({ success: true, rule_id: saved.data.id, pendentes, message: 'Regra salva: os próximos pagamentos para ' + label + ' viram lançamento sugerido.' });
    }

    if (action === 'launch_rule_preview') {
      const ruleId = String(body.rule_id ?? '');
      const { data: rule } = await admin.from('fin_reconciliation_rules').select('id').eq('id', ruleId).eq('tenant_id', tenantId).eq('action', 'launch').maybeSingle();
      if (!rule) return errResp('Regra não encontrada', 404);
      const { data, error } = await admin.rpc('fn_launch_rule_candidates', { p_tenant: tenantId, p_rule: ruleId, p_from: '2000-01-01', p_to: todayBR() });
      if (error) return errResp('Pagamentos da regra: ' + error.message, 500);
      return json({ success: true, candidates: data ?? [] });
    }

    if (action === 'launch_rule_apply') {
      if (!isManager) return errResp('Apenas administradores e gerentes podem lançar', 403);
      const ruleId = String(body.rule_id ?? '');
      const { data: rule } = await admin.from('fin_reconciliation_rules').select('*').eq('id', ruleId).eq('tenant_id', tenantId).eq('action', 'launch').maybeSingle();
      if (!rule || !rule.is_active) return errResp('Regra não encontrada', 404);
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, MAX_BATCH) as Array<{ id?: unknown; competencia?: unknown }>;
      if (items.length === 0) return errResp('Escolha os pagamentos');
      // Só linhas que a regra pega de fato (mesmo CNPJ, pendentes, sem trava) — nunca um id qualquer
      const { data: cands } = await admin.rpc('fn_launch_rule_candidates', { p_tenant: tenantId, p_rule: ruleId, p_from: '2000-01-01', p_to: todayBR() });
      const validos = new Map(((cands ?? []) as Row[]).filter((c) => !c.bloqueio).map((c) => [String(c.statement_id), c]));
      const results: Result[] = [];
      for (const it of items) {
        const id = String(it.id ?? '');
        const c = validos.get(id);
        if (!c) { results.push({ id, ok: false, msg: 'Este pagamento não é desta regra (ou já foi lançado)' }); continue; }
        const comp = competenciaOk(it.competencia) ?? String(c.competencia).slice(0, 7);
        try {
          const { data: row } = await admin.from('fin_bank_statement_imports').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
          if (!row || row.reconciled || row.status !== 'pending') { results.push({ id, ok: false, msg: 'Este pagamento já está conciliado' }); continue; }
          results.push(await withRowClaim(ctx, id, () => createOneClaimed(ctx, id, ruleOpts(rule, comp), { ...row, match_kind: null, category: null })));
        } catch (e) {
          results.push({ id, ok: false, msg: String((e as Error)?.message ?? e) });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      if (ok) await admin.from('fin_reconciliation_rules').update({ match_count: Number(rule.match_count ?? 0) + ok, last_applied_at: new Date().toISOString() }).eq('id', rule.id);
      log('INFO', 'launch_rule_apply', 'ok', { tenantId, userId, rule: rule.id, total: results.length, ok });
      return json({ success: true, results });
    }

    if (action === 'auto_apply_rules') {
      if (!isManager) return errResp('Apenas administradores e gerentes', 403);
      const to = todayBR();
      const { data: regras } = await admin.from('fin_reconciliation_rules').select('*')
        .eq('tenant_id', tenantId).eq('action', 'launch').eq('is_active', true).eq('mode', 'auto');
      const feitos: Array<{ rule: string; id: string; ok: boolean; msg: string }> = [];
      for (const rule of (regras ?? []) as Row[]) {
        const { data: cands } = await admin.rpc('fn_launch_rule_candidates', { p_tenant: tenantId, p_rule: rule.id, p_from: '2000-01-01', p_to: to });
        // Sozinho só o que não tem dúvida nenhuma: sem trava, sem conflito de competência, valor
        // dentro do padrão e fornecedor já conhecido (a média só existe com 3+ pagamentos).
        const limpos = ((cands ?? []) as Row[])
          .filter((c) => !c.bloqueio && !c.conflito && c.fora_padrao !== true && Number(c.media ?? 0) > 0)
          .slice(0, 20);
        for (const c of limpos) {
          const id = String(c.statement_id);
          const { data: row } = await admin.from('fin_bank_statement_imports').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
          if (!row || row.reconciled || row.status !== 'pending') continue;
          const r = await withRowClaim(ctx, id, () => createOneClaimed(ctx, id, ruleOpts(rule, String(c.competencia).slice(0, 7)), { ...row, match_kind: null, category: null }));
          feitos.push({ rule: String(rule.counterpart_label ?? rule.counterpart_doc), id, ok: r.ok, msg: r.msg });
        }
        const ok = feitos.filter((f) => f.ok).length;
        if (ok) await admin.from('fin_reconciliation_rules').update({ match_count: Number(rule.match_count ?? 0) + ok, last_applied_at: new Date().toISOString() }).eq('id', rule.id);
      }
      if (feitos.length) log('INFO', 'auto_apply_rules', 'ok', { tenantId, total: feitos.length, ok: feitos.filter((f) => f.ok).length });
      return json({ success: true, lancados: feitos.filter((f) => f.ok), falhas: feitos.filter((f) => !f.ok) });
    }

    // ── Vínculo manual: "este pagamento é de…" ────────────────────────────────
    if (action === 'link_search') {
      const { data: row } = await admin.from('fin_bank_statement_imports').select('*').eq('id', String(body.id ?? '')).eq('tenant_id', tenantId).maybeSingle();
      if (!row) return errResp('Lançamento não encontrado', 404);
      const q = String(body.q ?? '').trim().toLowerCase();
      const valor = round2(Number(row.amount));
      const dia = String(row.transaction_date);
      const bate = (txt: unknown) => !q || String(txt ?? '').toLowerCase().includes(q);

      const { data: bills } = await admin.from('fin_accounts_payable')
        .select('id, description, supplier, amount, paid_amount, due_date, status, installment_number')
        .eq('tenant_id', tenantId).in('status', ['pending', 'overdue', 'partial'])
        .gte('due_date', addDays(dia, -180)).lte('due_date', addDays(dia, 90)).limit(400);
      const opcoesContas = ((bills ?? []) as Row[])
        .map((b) => ({ ...b, falta: round2(Number(b.amount) - Number(b.paid_amount ?? 0)) }))
        .filter((b) => b.falta > 0.005 && (bate(b.description) || bate(b.supplier)))
        .map((b) => ({
          kind: 'payable' as const, ref_id: b.id, parcela: b.installment_number ? String(b.installment_number) : null,
          label: String(b.description ?? ''), fornecedor: b.supplier ?? null, valor: b.falta, vencimento: b.due_date,
          diferenca: round2(b.falta - valor),
        }));

      const { data: docs } = await admin.from('fiscal_inbound_documents')
        .select('id, numero, emitente_nome, emitente_cnpj, valor_total, emitted_at, parcelas, modelo, sefaz_status')
        .eq('tenant_id', tenantId).eq('status', 'new')
        .gte('emitted_at', addDays(dia, -180)).lte('emitted_at', addDays(dia, 30)).limit(300);
      const opcoesNotas: Row[] = [];
      for (const d of (docs ?? []) as Row[]) {
        if (Number(d.sefaz_status) === 2) continue;
        if (!bate(d.emitente_nome) && !bate('NF ' + d.numero)) continue;
        const parcelas = Array.isArray(d.parcelas) && d.parcelas.length > 0
          ? d.parcelas as Row[]
          : [{ numero: '1', vencimento: null, valor: d.valor_total }];
        for (const pc of parcelas) {
          const v = round2(Number(pc.valor ?? 0));
          if (!(v > 0)) continue;
          opcoesNotas.push({
            kind: 'inbound_doc', ref_id: d.id, parcela: String(pc.numero ?? '1'),
            label: 'NF ' + String(d.numero ?? '?') + ' — ' + String(d.emitente_nome ?? ''),
            fornecedor: d.emitente_nome ?? null, fornecedor_doc: soDigitos(d.emitente_cnpj) || null,
            valor: v, vencimento: pc.vencimento ?? null, emissao: String(d.emitted_at ?? '').slice(0, 10),
            diferenca: round2(v - valor), servico: Number(d.modelo) === 10,
          });
        }
      }
      // Mais parecidos primeiro: valor igual, depois diferença de valor e de data
      const dist = (o: Row) => Math.abs(Number(o.diferenca ?? 0)) * 1000
        + Math.abs(Date.parse(String(o.vencimento ?? o.emissao ?? dia) + 'T12:00:00Z') - Date.parse(dia + 'T12:00:00Z')) / 86400000;
      const opcoes = [...opcoesContas, ...opcoesNotas].sort((a, b) => dist(a) - dist(b)).slice(0, 40);
      return json({ success: true, pagamento: { valor, data: dia, quem: row.counterpart_name, doc: row.counterpart_doc }, opcoes });
    }

    if (action === 'link_manual') {
      if (!isManager) return errResp('Apenas administradores e gerentes podem vincular pagamentos', 403);
      const rowId = String(body.id ?? '');
      const alvo = (body.alvo ?? {}) as Row;
      const kind = alvo.kind === 'inbound_doc' ? 'inbound_doc' : alvo.kind === 'payable' ? 'payable' : null;
      if (!kind || !alvo.ref_id) return errResp('Escolha a conta ou a nota');
      const { data: row } = await admin.from('fin_bank_statement_imports').select('*').eq('id', rowId).eq('tenant_id', tenantId).maybeSingle();
      if (!row) return errResp('Lançamento não encontrado', 404);
      if (row.transaction_type !== 'debit') return errResp('Só pagamentos (saídas) são ligados a nota ou conta');
      if (row.reconciled || row.status !== 'pending') return errResp('Este pagamento já está conciliado');

      // Confere o alvo e monta o vínculo no mesmo formato da sugestão automática
      let det: Row;
      let fornecedorDoc: string | null = null;
      let fornecedorNome: string | null = null;
      if (kind === 'payable') {
        const { data: b } = await admin.from('fin_accounts_payable').select('*').eq('id', String(alvo.ref_id)).eq('tenant_id', tenantId).maybeSingle();
        if (!b) return errResp('Conta a pagar não encontrada', 404);
        if (b.status === 'paid' || b.status === 'cancelled') return errResp('Esta conta já está quitada ou cancelada');
        const falta = round2(Number(b.amount) - Number(b.paid_amount ?? 0));
        det = { parcela: b.installment_number ? String(b.installment_number) : null, vencimento: b.due_date, valor: falta,
          label: String(b.description ?? ''), nome: b.supplier ?? null, manual: true,
          boleto: String(row.raw?.tipoTransacao ?? '') === 'PAGAMENTO' };
        fornecedorNome = b.supplier ?? null;
        const { data: sup } = await admin.from('fin_suppliers').select('cnpj').eq('tenant_id', tenantId).ilike('name', String(b.supplier ?? '')).limit(1).maybeSingle();
        fornecedorDoc = soDigitos(sup?.cnpj) || null;
      } else {
        const { data: d } = await admin.from('fiscal_inbound_documents').select('*').eq('id', String(alvo.ref_id)).eq('tenant_id', tenantId).maybeSingle();
        if (!d) return errResp('Nota não encontrada', 404);
        if (Number(d.sefaz_status) === 2) return errResp('A nota foi CANCELADA na SEFAZ — não lance');
        const parcelas = Array.isArray(d.parcelas) && d.parcelas.length > 0 ? d.parcelas as Row[] : [{ numero: '1', vencimento: null, valor: d.valor_total }];
        const pc = parcelas.find((x) => String(x.numero ?? '1') === String(alvo.parcela ?? '1')) ?? parcelas[0];
        det = { doc_id: d.id, parcela: String(pc.numero ?? '1'), vencimento: pc.vencimento ?? null, valor: round2(Number(pc.valor ?? 0)),
          label: 'NF ' + String(d.numero ?? '?') + ' — ' + String(d.emitente_nome ?? ''), nome: d.emitente_nome ?? null,
          modelo: d.modelo, auto_import: d.status === 'new', manual: true,
          boleto: String(row.raw?.tipoTransacao ?? '') === 'PAGAMENTO' };
        fornecedorNome = d.emitente_nome ?? null;
        fornecedorDoc = soDigitos(d.emitente_cnpj) || null;
      }
      const face = Number(row.face_value ?? row.amount);
      det.face = face;
      det.juros = Math.max(round2(Number(row.amount) - Number(det.valor)), 0);
      det.desconto = Math.max(round2(Number(det.valor) - Number(row.amount)), 0);

      const { error: upErr } = await admin.from('fin_bank_statement_imports')
        .update({ match_kind: kind, match_ref_id: String(alvo.ref_id), match_confidence: 'manual', match_detail: det })
        .eq('id', rowId).eq('tenant_id', tenantId);
      if (upErr) return errResp('Gravar o vínculo: ' + upErr.message, 500);

      const r = await confirmOne(ctx, rowId);
      if (!r.ok) {
        // volta ao estado anterior para a linha não ficar com um vínculo que não deu baixa
        await admin.from('fin_bank_statement_imports')
          .update({ match_kind: row.match_kind, match_ref_id: row.match_ref_id, match_confidence: row.match_confidence, match_detail: row.match_detail })
          .eq('id', rowId).eq('tenant_id', tenantId);
        return json({ success: true, results: [r] });
      }

      // "Lembrar": quem recebeu passa a valer como o fornecedor da nota nas próximas vezes
      let lembrou: { n: number; nome: string | null } | null = null;
      const quemDoc = soDigitos(row.counterpart_doc) || String(row.raw?.detalhes?.chavePixRecebedor ?? '').toLowerCase();
      if (body.lembrar === true && quemDoc && (fornecedorDoc || fornecedorNome)) {
        const { error: aliasErr } = await admin.from('fin_counterpart_aliases').upsert({
          tenant_id: tenantId, counterpart_doc: quemDoc, supplier_doc: fornecedorDoc, supplier_name: fornecedorNome,
          created_by: userId, updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id,counterpart_doc' });
        if (aliasErr) log('WARN', 'link_manual', 'salvar apelido falhou', { tenantId, error: aliasErr.message });
        else {
          const to = todayBR();
          await admin.rpc('fn_aplicar_apelidos', { p_tenant: tenantId, p_from: addDays(to, -365), p_to: to });
          const { data: mp } = await admin.rpc('fn_match_payments', { p_tenant: tenantId, p_from: addDays(to, -120), p_to: to });
          const n = Number((mp as Row)?.exato ?? 0) + Number((mp as Row)?.forte ?? 0) + Number((mp as Row)?.provavel ?? 0);
          lembrou = { n, nome: fornecedorNome };
        }
      }
      log('INFO', 'link_manual', 'ok', { tenantId, userId, rowId, kind, lembrou: !!lembrou });
      return json({ success: true, results: [r], lembrou });
    }

    // ── Início do financeiro ──────────────────────────────────────────────────
    if (action === 'periodo_preview' || action === 'periodo_fechar') {
      const mes = String(body.inicio ?? '');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return errResp("Escolha o mês de início (formato 'AAAA-MM')");
      const inicio = mes + '-01';
      if (action === 'periodo_preview') {
        const { data, error } = await admin.rpc('fn_periodo_anterior_preview', { p_tenant: tenantId, p_inicio: inicio });
        if (error) return errResp('Pré-visualizar: ' + error.message, 500);
        return json({ success: true, preview: data });
      }
      if (!isManager) return errResp('Apenas administradores e gerentes podem fechar o período', 403);
      const { data, error } = await admin.rpc('fn_fechar_periodo_anterior', { p_tenant: tenantId, p_inicio: inicio, p_user: userId });
      if (error) return errResp('Fechar o período: ' + error.message, 500);
      log('INFO', 'periodo_fechar', 'ok', { tenantId, userId, inicio, ...(data as Row ?? {}) });
      return json({ success: true, ...(data as Row ?? {}) });
    }

    if (action === 'periodo_reabrir') {
      if (!isManager) return errResp('Apenas administradores e gerentes podem reabrir o período', 403);
      const { data, error } = await admin.rpc('fn_reabrir_periodo_anterior', { p_tenant: tenantId });
      if (error) return errResp('Reabrir: ' + error.message, 500);
      log('INFO', 'periodo_reabrir', 'ok', { tenantId, userId, ...(data as Row ?? {}) });
      return json({ success: true, ...(data as Row ?? {}) });
    }

    return errResp('Ação desconhecida: ' + action);
  } catch (e) {
    log('ERROR', action, 'unhandled', { error: String((e as Error)?.stack ?? e) });
    return errResp(String((e as Error)?.message ?? e), 500);
  }
});
