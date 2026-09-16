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
//   monthly_candidates     { document_id }       pagamentos do extrato do fornecedor perto da emissão + combinação sugerida
//   link_monthly           { document_id, ids, cost_center_id?, links?, dre_category_id?, category?, saldo_vencimento? }
//                          admin/gerente — NOTA DO MÊS: 1 nota cobre vários pagamentos já feitos; lança na data de
//                          emissão com 1 parcela por pagamento, cada uma baixada; saldo que faltar fica a pagar
//   unlink_monthly         { document_id }       desfaz tudo (estorna as baixas, apaga a compra, nota volta a conferir)
//   save_counterpart_rule  { counterpart_doc, counterpart_label?, category, cost_center_id?, transaction_type }
//   create_from_statement  { ids, kind: 'despesa'|'compra', dre_category_id?, merchandise_category_id?, description?,
//                            supplier?, cost_center_id?, allow_payroll? }   admin/gerente — pagamento SEM NOTA:
//                          despesa = conta a pagar (reference_type 'conciliacao_extrato') já baixada; compra = compra
//                          (purchase-write) com 1 item, parcela baixada. Mesma data e conta do extrato. Pix para CPF de
//                          funcionário é recusado (code 'folha') sem allow_payroll: a folha já entra na DRE. O undo apaga
//                          o que foi criado e devolve a linha para pendente.
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

// ── Lançar a partir do extrato (pagamento sem nota) ─────────────────────────
// Linhas que já têm destino: vínculo com nota/conta, transferência própria, repasse de cartão/iFood.
const JA_TEM_DESTINO = ['payable', 'inbound_doc', 'internal_transfer', 'stone_deposit', 'stone_detail', 'ifood_deposit', 'card_deposit'];
const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

interface CreateOpts {
  kind: 'despesa' | 'compra';
  dreCategoryId: string | null;
  mercCategoryId: string | null;
  description: string | null;
  supplier: string | null;
  costCenterId: string | null;
  allowPayroll: boolean;
}

async function createOne(ctx: Ctx, rowId: string, o: CreateOpts): Promise<Result> {
  const { admin, tenantId } = ctx;
  const fail = (msg: string, code?: string): Result => ({ id: rowId, ok: false, msg, ...(code ? { code } : {}) });
  const { data: row } = await admin.from('fin_bank_statement_imports').select('*').eq('id', rowId).eq('tenant_id', tenantId).maybeSingle();
  if (!row) return fail('Lançamento não encontrado');
  if (row.transaction_type !== 'debit') return fail('Só pagamentos (saídas) viram despesa ou compra');
  if (row.reconciled || row.status !== 'pending') return fail('Este pagamento já está conciliado');
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

  if (o.kind === 'despesa') {
    if (!o.dreCategoryId) return fail('Escolha a categoria da despesa');
    const { data: cat } = await admin.from('fin_dre_categories').select('id, name, group_type').eq('id', o.dreCategoryId).eq('tenant_id', tenantId).maybeSingle();
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

  const pay = await callEdge(ctx, 'financial-write', {
    action: 'pay_bill', tenant_id: tenantId,
    payload: { id: billId, paid_date: paidDate, paid_amount: valor, payment_method: metodo, bank_account_id: row.bank_account_id },
  });
  if (!pay.ok) {
    if (purchaseId) await callEdge(ctx, 'purchase-write', { action: 'delete_purchase', tenant_id: tenantId, payload: { id: purchaseId } });
    else await admin.from('fin_accounts_payable').delete().eq('id', billId).eq('tenant_id', tenantId);
    return fail('Dar baixa: ' + (pay.error ?? 'falhou'));
  }

  const now = new Date().toISOString();
  const confirmed = { bill_id: billId, juros_bill_id: null, pay_amount: valor, juros: 0, desconto: 0, auto_imported: false, created: o.kind, purchase_id: purchaseId, at: now, by: ctx.userId };
  const { error: upErr } = await admin.from('fin_bank_statement_imports').update({
    status: 'matched', reconciled: true, reconciled_at: now, reconciled_by: ctx.userId, matched_at: now, matched_by: ctx.userId,
    match_kind: 'payable', match_ref_id: billId, match_confidence: 'manual', category: categoria,
    match_detail: {
      label: (o.kind === 'compra' ? 'Compra sem nota: ' : 'Despesa sem nota: ') + descricao, valor, created: o.kind,
      prev_category: row.category ?? null, prev_match_kind: row.match_kind ?? null, confirmed,
    },
  }).eq('id', row.id);
  if (upErr) log('ERROR', 'create', 'marcar extrato falhou', { tenantId, rowId, error: upErr.message });
  return { id: row.id, ok: true, msg: (o.kind === 'compra' ? 'Compra' : 'Despesa') + ' de R$ ' + brl(valor) + ' lançada: "' + descricao + '"' };
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
  const imp = await callEdge(ctx, 'fiscal-inbound', servico
    ? { action: 'import_bill', tenant_id: tenantId, document_id: doc.id, parcelas, notes: nota,
        category: body.category ?? 'Serviços de terceiros', dre_category_id: body.dre_category_id ?? null, cost_center_id: body.cost_center_id ?? null }
    : { action: 'import_purchase', tenant_id: tenantId, document_id: doc.id, parcelas, notes: nota,
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
  return { ok: true, msg: (servico ? 'Despesa' : 'Compra') + ' lançada em ' + br(String(doc.emitted_at).slice(0, 10)) + ' e quitada por ' + rows.length + ' pagamento(s)' + (saldo >= 0.02 ? ' · saldo de R$ ' + brl(saldo) + ' em Contas a Pagar' : '') };
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
  if (!c?.bill_id) return { id: rowId, ok: false, msg: 'Não há baixa feita pela conciliação neste lançamento' };
  if (c.monthly_doc_id) return { id: rowId, ok: false, msg: 'Este pagamento faz parte de uma nota do mês: desfaça pela nota em Notas de Entrada (desfaz todos os pagamentos juntos)' };
  const date = String(row.transaction_date);

  if (c.juros_bill_id && Number(c.juros) > 0) {
    await reversePayment(ctx, c.juros_bill_id, round2(Number(c.juros)), row.bank_account_id, date);
    await admin.from('fin_accounts_payable').delete().eq('id', c.juros_bill_id).eq('tenant_id', tenantId);
  }
  const b = await reversePayment(ctx, c.bill_id, round2(Number(c.pay_amount)), row.bank_account_id, date);

  // Lançado a partir do extrato: apaga o que foi criado e a linha volta a ser um pagamento sem destino
  const criado = c.created === 'despesa' || c.created === 'compra' ? String(c.created) : null;
  if (criado) {
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
    return { id: row.id, ok: true, msg: (criado === 'compra' ? 'Compra' : 'Despesa') + ' lançada pelo extrato foi desfeita: o pagamento voltou a pendente.' };
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
      const kind = body.kind === 'compra' ? 'compra' : body.kind === 'despesa' ? 'despesa' : null;
      if (!kind) return errResp('Escolha despesa ou compra');
      const opts: CreateOpts = {
        kind,
        dreCategoryId: body.dre_category_id ? String(body.dre_category_id) : null,
        mercCategoryId: body.merchandise_category_id ? String(body.merchandise_category_id) : null,
        description: body.description ? String(body.description) : null,
        supplier: body.supplier ? String(body.supplier) : null,
        costCenterId: body.cost_center_id ? String(body.cost_center_id) : null,
        allowPayroll: body.allow_payroll === true,
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
