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
//   rematch                {}                    refaz as sugestões (fn_match_payments, últimos 120 dias)
//   alerts                 {}                    fn_conciliacao_alertas
//   confirm                { ids: string[] }     admin/gerente: importa a nota (se preciso), baixa a parcela, lança juros
//   undo                   { id }                admin/gerente: estorna a baixa feita pela confirmação
//   save_counterpart_rule  { counterpart_doc, counterpart_label?, category, cost_center_id?, transaction_type }
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
type Result = { id: string; ok: boolean; msg: string; auto_imported?: boolean };

async function confirmOne(ctx: Ctx, rowId: string): Promise<Result> {
  const { admin, tenantId } = ctx;
  const fail = (msg: string): Result => ({ id: rowId, ok: false, msg });
  const { data: row } = await admin.from('fin_bank_statement_imports').select('*').eq('id', rowId).eq('tenant_id', tenantId).maybeSingle();
  if (!row) return fail('Lançamento não encontrado');
  if (row.reconciled || row.status !== 'pending') return fail('Este pagamento já está conciliado');
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
  if (!c?.bill_id) return { id: rowId, ok: false, msg: 'Não há baixa feita pela conciliação neste lançamento' };
  const date = String(row.transaction_date);

  if (c.juros_bill_id && Number(c.juros) > 0) {
    await reversePayment(ctx, c.juros_bill_id, round2(Number(c.juros)), row.bank_account_id, date);
    await admin.from('fin_accounts_payable').delete().eq('id', c.juros_bill_id).eq('tenant_id', tenantId);
  }
  const b = await reversePayment(ctx, c.bill_id, round2(Number(c.pay_amount)), row.bank_account_id, date);
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
      return json({ success: true, ...(data as Row ?? {}) });
    }

    if (action === 'alerts') {
      const { data, error } = await admin.rpc('fn_conciliacao_alertas', { p_tenant: tenantId });
      if (error) return errResp('Alertas: ' + error.message, 500);
      return json({ success: true, alerts: data });
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
      const { data: existing } = await admin.from('fin_reconciliation_rules').select('id').eq('tenant_id', tenantId).eq('counterpart_doc', doc).maybeSingle();
      const { error } = existing
        ? await admin.from('fin_reconciliation_rules').update(fields).eq('id', existing.id)
        : await admin.from('fin_reconciliation_rules').insert({ ...fields, match_count: 0 });
      if (error) return errResp('Salvar regra: ' + error.message, 500);
      // Aplica já nos lançamentos pendentes dessa pessoa
      const to = todayBR();
      await admin.rpc('fn_match_payments', { p_tenant: tenantId, p_from: addDays(to, -120), p_to: to });
      return json({ success: true, message: 'Regra salva: os próximos lançamentos de ' + label + ' entram como "' + category + '".' });
    }

    return errResp('Ação desconhecida: ' + action);
  } catch (e) {
    log('ERROR', action, 'unhandled', { error: String((e as Error)?.stack ?? e) });
    return errResp(String((e as Error)?.message ?? e), 500);
  }
});
