// Receber mercadoria pelo celular da loja (2026-09-22).
//
// Um passo a passo só para tudo que chega na porta: NF-e que já está em Notas de entrada,
// compra já lançada esperando entrega, cupom/notinha (NFC-e) e entrega sem nota. Esta Edge
// NÃO tem regra de compra própria — ela orquestra as que já existem:
//   • nota ainda não lançada → fiscal-inbound import_purchase (compra sai do XML, nunca da foto)
//   • cupom / sem nota       → purchase-write create_purchase
//   • estoque                → purchase-confirm-delivery (única porta de entrada no estoque)
//   • pago em dinheiro       → fn_sangria_da_compra (sangria prevista para o caixa confirmar)
//
// Quem pode: admin/gerente/financeiro, ou o papel com 'estoque_receber' ou 'estoque_movimentar' marcado na matriz de
// permissões da loja. purchase-write e fiscal-inbound são chamados pela chave interna porque
// exigem papel de financeiro; o recebimento vai com o JWT do usuário (grava quem recebeu).
//
// Ações (body: { action, tenant_id, ... }):
//   pendentes                      notas e compras esperando chegar
//   recebidas    { mes: 'AAAA-MM' } compras já recebidas no mês ("Já chegaram")
//   buscar       { codigo }        chave de 44 dígitos (código de barras da DANFE) ou número da nota
//   abrir        { tipo, id }      itens para conferir (tipo 'nota' | 'compra')
//   insumos / fornecedores         listas para "sem nota"
//   confirmar    { tipo, id, itens, pagamento?, forma?, recebido_em, obs? }
//   lancar       { origem: 'cupom'|'sem_nota', fornecedor, itens, pagamento, ... }
//   aguardando_nota { fornecedor, descricao, obs? }   pendência para o financeiro (não lança nada)
//
// "Paguei do meu bolso" (2026-09-24): lancar com pagamento 'reembolso' + reembolso { nome, pix_chave, comprovante? }
// lança a compra (CMV + estoque, como sempre) SEM conta a pagar e abre um pedido de reembolso ligado a ela
// (fin_payment_requests, ver Edge pedidos-pagamento). A conta só nasce quando o dono aprova. Exige 'pag_reembolso'.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authenticate, bearerToken, isFinanceiroRole, tenantRole } from '../_shared/tenant-auth.ts';
import { PT_PARA_EN, nomeDoUsuario, pendenciaDoPedido, permissoesPedido, salvarComprovante } from '../_shared/pedidos-pagamento.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const erro = (msg: string, status = 400, extra: Record<string, unknown> = {}) => json({ error: msg, ...extra }, status);

type Admin = any;

const TPAG: Record<string, string> = { '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de crédito', '04': 'Cartão de débito', '05': 'Crédito loja', '15': 'Boleto', '16': 'Depósito', '17': 'PIX', '18': 'Transferência', '90': 'Sem pagamento', '99': 'Outros' };
const FORMAS_PAGAS = ['PIX', 'Cartão Débito', 'Transferência']; // crédito: o extrato só traz a fatura, a conta nunca baixaria
const DIAS_NOTAS = 45;
const DIAS_COMPRAS = 60;

const round2 = (n: number) => Math.round(n * 100) / 100;
const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const hojeBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const diasAtras = (d: number) => new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
const normKey = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function podeReceber(admin: Admin, tenantId: string, role: string): Promise<boolean> {
  if (isFinanceiroRole(role)) return true;
  // permissions.role é enum (só EN): 'caixa' no filtro derrubava a consulta e o Caixa nunca recebia
  const { data, error } = await admin.from('permissions').select('allowed')
    // estoque_receber (só esta tela, liberável para o Caixa) ou estoque_movimentar (legado)
    .eq('tenant_id', tenantId).eq('role', PT_PARA_EN[role] ?? role).in('permission_key', ['estoque_receber', 'estoque_movimentar']);
  if (error) throw new Error(`Falha ao ler permissões: ${error.message}`);
  return (data ?? []).some((r: any) => r.allowed === true);
}

// ── Chamadas às Edges que já têm a regra ────────────────────────────────────
interface Ctx { admin: Admin; url: string; tenantId: string; userToken: string; email: string | null; financeiro: boolean; userId: string; role: string }

async function chamarEdge(ctx: Ctx, funcao: string, corpo: Record<string, unknown>, comoUsuario: boolean) {
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: anon };
  if (comoUsuario) headers.Authorization = `Bearer ${ctx.userToken}`;
  else {
    headers.Authorization = `Bearer ${anon}`;
    headers['x-internal-key'] = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
  }
  const r = await fetch(`${ctx.url}/functions/v1/${funcao}`, { method: 'POST', headers, body: JSON.stringify(corpo) });
  const txt = await r.text();
  let out: any = null;
  try { out = JSON.parse(txt); } catch { out = null; }
  const msg = out?.error ? (typeof out.error === 'string' ? out.error : String(out.error?.message ?? 'erro')) : null;
  if (!r.ok || msg) return { ok: false as const, status: r.status, erro: msg ?? txt.slice(0, 300) ?? `HTTP ${r.status}` };
  return { ok: true as const, data: out };
}

// ── Listas ──────────────────────────────────────────────────────────────────
async function pendentes(ctx: Ctx) {
  const { admin, tenantId } = ctx;
  const [notasRes, comprasRes] = await Promise.all([
    admin.from('fiscal_inbound_documents')
      .select('id, chave, numero, emitente_nome, valor_total, emitted_at, status, import_type, purchase_id, itens, parcelas, pagamento, xml_status')
      .eq('tenant_id', tenantId).eq('modelo', 55).in('status', ['new', 'imported'])
      .or('sefaz_status.is.null,sefaz_status.neq.2')
      .gte('emitted_at', diasAtras(DIAS_NOTAS))
      .order('emitted_at', { ascending: false }).limit(150),
    admin.from('fin_purchases')
      .select('id, supplier, invoice_number, purchase_date, total_amount, payment_method, payment_status, is_bonus, created_at, items:fin_purchase_items(id, description)')
      .eq('tenant_id', tenantId).is('delivery_confirmed_at', null)
      .gte('purchase_date', diasAtras(DIAS_COMPRAS))
      .order('purchase_date', { ascending: false }).limit(150),
  ]);
  if (notasRes.error) throw new Error(notasRes.error.message);
  if (comprasRes.error) throw new Error(comprasRes.error.message);
  const compras = (comprasRes.data ?? []) as any[];
  const compraAberta = new Map(compras.map((c) => [String(c.id), c]));

  const lista: any[] = [];
  const comprasDeNota = new Set<string>();
  for (const d of (notasRes.data ?? []) as any[]) {
    if (d.status === 'imported') {
      // Lançada como despesa (import_bill) não é mercadoria; lançada como compra só aparece se falta receber
      if (d.import_type === 'bill' || !d.purchase_id) continue;
      comprasDeNota.add(String(d.purchase_id));
      if (!compraAberta.has(String(d.purchase_id))) continue;
    }
    const parcelas = (d.parcelas ?? []) as any[];
    const formas = ((d.pagamento ?? []) as any[]).map((p) => TPAG[String(p.forma)] ?? 'Outros');
    lista.push({
      tipo: 'nota', id: d.id, fornecedor: d.emitente_nome ?? 'Fornecedor', numero: d.numero ? String(d.numero) : null,
      valor: Number(d.valor_total ?? 0), data: String(d.emitted_at ?? '').slice(0, 10),
      lancada: d.status === 'imported', itens_qtd: ((d.itens ?? []) as any[]).length,
      pagamento: parcelas.length ? `Boleto${parcelas.length > 1 ? ` ${parcelas.length}x` : ''}` : formas[0] ?? null,
    });
  }
  for (const c of compras) {
    if (comprasDeNota.has(String(c.id))) continue;
    lista.push({
      tipo: 'compra', id: c.id, fornecedor: c.supplier ?? 'Fornecedor', numero: c.invoice_number ?? null,
      valor: Number(c.total_amount ?? 0), data: String(c.purchase_date ?? '').slice(0, 10), lancada: true,
      itens_qtd: (c.items ?? []).filter((it: any) => !ehAcrescimo(it)).length,
      pagamento: c.is_bonus ? 'Bonificação' : `${c.payment_method ?? ''}${c.payment_status === 'paid' ? ' (pago)' : ''}`.trim() || null,
    });
  }
  lista.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  return lista;
}

async function insumos(admin: Admin, tenantId: string) {
  const { data, error } = await admin.from('ingredients')
    .select('id, name, unit, category').eq('tenant_id', tenantId).is('deleted_at', null).order('name').limit(3000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((i: any) => ({ id: i.id, nome: i.name, unidade: i.unit ?? 'unit', categoria: i.category ?? '' }));
}

// Linha que o fiscal-inbound cria com a diferença entre o total da nota e os itens
// "Já chegaram" (2026-09-24): compras com entrega confirmada no mês (horário de Brasília), mais recente primeiro.
async function recebidas(ctx: Ctx, mes: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error('Mês inválido');
  const [a, m] = mes.split('-').map(Number);
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  const { data, error } = await ctx.admin.from('fin_purchases')
    .select('id, supplier, invoice_number, purchase_date, total_amount, payment_method, payment_status, is_bonus, notes, delivery_notes, delivery_confirmed_at, items:fin_purchase_items(id, description, quantity, received_quantity, unit_label)')
    .eq('tenant_id', ctx.tenantId)
    .gte('delivery_confirmed_at', `${mes}-01T00:00:00-03:00`).lt('delivery_confirmed_at', `${prox}-01T00:00:00-03:00`)
    .order('delivery_confirmed_at', { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((c) => {
    const notas = String(c.notes ?? '');
    const itens = ((c.items ?? []) as any[]).filter((it) => !ehAcrescimo(it));
    return {
      id: c.id, fornecedor: c.supplier ?? 'Fornecedor', numero: c.invoice_number ?? null,
      valor: Number(c.total_amount ?? 0), data: String(c.purchase_date ?? '').slice(0, 10),
      // delivery_confirmed_at é UTC: dia de Brasília
      recebido_em: new Date(new Date(c.delivery_confirmed_at).getTime() - 3 * 3600_000).toISOString().slice(0, 10),
      origem: /foto da nota no grupo/i.test(notas) ? 'Grupo do WhatsApp' : /chave \d{44}/.test(notas) ? 'Nota fiscal' : c.invoice_number ? 'Compra lançada' : 'Sem nota / cupom',
      pagamento: c.is_bonus ? 'Bonificação' : `${c.payment_method ?? ''}${c.payment_status === 'paid' ? ' (pago)' : ''}`.trim() || null,
      obs: c.delivery_notes ?? null,
      itens: itens.map((it) => ({ descricao: String(it.description ?? '').replace(/\s*\(\d{6,}\)$/, ''), quantidade: Number(it.received_quantity ?? it.quantity ?? 0), pedido: Number(it.quantity ?? 0), unidade: it.unit_label ?? '' })),
    };
  });
}

const ehAcrescimo = (it: any) => String(it?.description ?? '').startsWith('Acréscimos da nota');

// ── Abrir: itens para conferir ──────────────────────────────────────────────
async function abrirCompra(ctx: Ctx, purchaseId: string, extra: Record<string, unknown> = {}) {
  const { admin, tenantId } = ctx;
  const { data: p } = await admin.from('fin_purchases')
    .select('id, supplier, invoice_number, purchase_date, total_amount, payment_method, payment_status, is_bonus, delivery_confirmed_at, items:fin_purchase_items(id, description, quantity, unit_label, total_price, ingredient_id, units_per_package)')
    .eq('id', purchaseId).eq('tenant_id', tenantId).maybeSingle();
  if (!p) return { erro: 'Compra não encontrada' };
  if (p.delivery_confirmed_at) return { erro: `Essa compra já foi recebida em ${String(p.delivery_confirmed_at).slice(0, 10).split('-').reverse().join('/')}.` };
  const rc = await chamarEdge(ctx, 'purchase-confirm-delivery', { action: 'receipt_context', tenant_id: tenantId, payload: { purchase_id: purchaseId } }, true);
  if (!rc.ok) return { erro: `Não consegui abrir a compra: ${rc.erro}` };
  const sug = (rc.data?.suggestions ?? {}) as Record<string, { ingredient_id: string; units_per_package: number; source?: string }>;
  const { data: contas } = await admin.from('fin_accounts_payable').select('due_date, amount, status')
    .eq('tenant_id', tenantId).eq('reference_id', purchaseId).order('due_date');
  // A linha "Acréscimos da nota" (ICMS-ST, IPI...) é valor, não produto: não vai para a conferência
  const itens = ((p.items ?? []) as any[]).filter((it) => !ehAcrescimo(it)).map((it) => {
    const s = sug[it.id];
    return {
      key: String(it.id), descricao: it.description ?? '—', unidade: it.unit_label ?? 'un',
      quantidade: Number(it.quantity ?? 0), valor_total: Number(it.total_price ?? 0),
      ingredient_id: s?.ingredient_id ?? null, units_per_package: Number(s?.units_per_package ?? it.units_per_package ?? 1) || 1,
      fonte: s?.source ?? null,
    };
  });
  return {
    tipo: 'compra', id: p.id, fornecedor: p.supplier, numero: p.invoice_number, data: p.purchase_date,
    valor: Number(p.total_amount ?? 0), lancada: true, itens,
    pagamento: {
      ja_definido: true, bonificacao: !!p.is_bonus, forma: p.payment_method, pago: p.payment_status === 'paid',
      vencimentos: (contas ?? []).map((c: any) => ({ vencimento: c.due_date, valor: Number(c.amount ?? 0), status: c.status })),
    },
    estoque_ja_aplicado: Boolean(rc.data?.stock_already_applied),
    ...extra,
  };
}

// Mesmos filtros do lançamento automático do fiscal-inbound (autoLaunchTenant)
const CFOP_NAO_VENDA = /^[56](9(0[1-9]|1[0-9]|2[0-4]|49)|55[0-9])$/;
const CFOP_BONIFICACAO = /^[56]910$/;
const cfopsDe = (d: any) => String(d.cfops ?? '').split(',').map((c) => c.trim()).filter(Boolean);
const isBonificacao = (d: any) => { const c = cfopsDe(d); return c.length > 0 && c.every((x) => CFOP_BONIFICACAO.test(x)); };
function pareceNaoVenda(d: any): boolean {
  const cfops = cfopsDe(d);
  const pag = (d.pagamento ?? []) as any[];
  const semPagamento = pag.length > 0 && pag.every((p) => String(p.forma) === '90' || Number(p.valor) === 0);
  return semPagamento || (cfops.length > 0 && cfops.every((c) => CFOP_NAO_VENDA.test(c)));
}

async function pendencia(ctx: Ctx, kind: string, ref: string, titulo: string, detalhe: string, rota: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await ctx.admin.rpc('fn_pendencia_upsert', {
    p_tenant: ctx.tenantId, p_kind: kind, p_ref: ref, p_titulo: titulo, p_detalhe: detalhe,
    p_payload: { ...payload, email: ctx.email }, p_rota: rota, p_urgencia: 'normal', p_acao_requerida: true, p_origem: 'app', p_reabrir: false,
  });
  if (error) console.error('[receber-mercadoria] pendência', kind, error.message);
  return error ? null : (data as any)?.id ?? null;
}

/** Nota que o celular não pode lançar sozinho (o financeiro decide). null = pode. */
async function bloqueioDaNota(ctx: Ctx, doc: any): Promise<string | null> {
  if (Number(doc.sefaz_status) === 2) return 'Essa nota foi CANCELADA pelo fornecedor na SEFAZ. Não receba sem falar com o financeiro.';
  if (doc.status === 'ignored') return 'O financeiro marcou essa nota para ignorar. Fale com ele antes de receber.';
  if (doc.status === 'imported') return null;
  let motivo: string | null = null;
  if (!isBonificacao(doc) && pareceNaoVenda(doc)) motivo = 'é remessa/devolução (não é venda)';
  else if (doc.emitente_cnpj) {
    // Nota do mês: a última desse fornecedor foi quitada pelos pagamentos do extrato — lançar
    // como compra com boleto criaria conta a pagar em dobro (mesma regra do lançamento automático)
    const { data: ult } = await ctx.admin.from('fiscal_inbound_documents').select('settlement')
      .eq('tenant_id', ctx.tenantId).eq('emitente_cnpj', doc.emitente_cnpj).eq('status', 'imported')
      .order('imported_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    if (ult?.settlement === 'monthly') motivo = 'é "nota do mês" (paga pelos pagamentos do extrato)';
  }
  if (!motivo) return null;
  await pendencia(ctx, 'recebimento_parado', String(doc.id),
    // Texto dizendo ONDE e COMO (dono, 2026-09-25: "lançada onde?").
    `NF ${doc.numero ?? ''} de ${doc.emitente_nome ?? 'fornecedor'} chegou e espera o lançamento no Financeiro`,
    `A loja quer receber essa mercadoria (NF ${doc.numero ?? ''}, ${Number(doc.valor_total ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}), mas a nota ${motivo} — por isso o celular não lança sozinho. `
      + `O que fazer: em Financeiro › Notas de entrada, abra essa nota e lance como compra (o botão "Conferir e lançar a nota" abre ela direto). `
      + `Se não for mercadoria comprada, toque em "Não é compra". Depois do lançamento, a loja confirma o recebimento pelo celular.`,
    '/financeiro?tab=notas-entrada', { document_id: doc.id });
  return `Essa nota ${motivo} e precisa ser lançada pelo financeiro. Já avisei — quando ele lançar, ela aparece aqui para você receber.`;
}

async function abrirNota(ctx: Ctx, docId: string) {
  const { admin, tenantId } = ctx;
  let { data: doc } = await admin.from('fiscal_inbound_documents').select('*').eq('id', docId).eq('tenant_id', tenantId).maybeSingle();
  if (!doc) return { erro: 'Nota não encontrada' };
  const bloqueio = await bloqueioDaNota(ctx, doc);
  if (bloqueio) return { erro: bloqueio };
  if (doc.status === 'imported') {
    if (doc.import_type === 'bill' || !doc.purchase_id) return { erro: 'Essa nota foi lançada como despesa (não é mercadoria de estoque).' };
    return abrirCompra(ctx, doc.purchase_id, { nota_id: doc.id });
  }
  // Nota ainda sem XML completo: tenta baixar agora (a tela de Notas de entrada faz o mesmo)
  if (doc.xml_status !== 'full' || !((doc.itens ?? []) as any[]).length) {
    await chamarEdge(ctx, 'fiscal-inbound', { action: 'refetch_xml', tenant_id: tenantId, document_id: docId }, false).catch(() => null);
    const again = await admin.from('fiscal_inbound_documents').select('*').eq('id', docId).eq('tenant_id', tenantId).maybeSingle();
    if (again.data) doc = again.data;
  }
  const lk = await chamarEdge(ctx, 'fiscal-inbound', { action: 'item_links', tenant_id: tenantId, document_id: docId }, false);
  const links = (lk.ok ? lk.data?.links ?? [] : []) as Array<{ ingredient_id: string; units_per_package: number } | null>;
  const itens = ((doc.itens ?? []) as any[]).map((it, i) => ({
    key: String(i), descricao: String(it.descricao ?? '—'), codigo: it.codigo ?? null, unidade: it.unidade ?? 'un',
    quantidade: Number(it.quantidade ?? 0), valor_total: round2(Number(it.valor_total ?? 0) - Number(it.desconto ?? 0)),
    ingredient_id: links[i]?.ingredient_id ?? null, units_per_package: Number(links[i]?.units_per_package ?? 1) || 1,
    fonte: links[i]?.ingredient_id ? 'memorizado' : null,
  }));
  const parcelas = ((doc.parcelas ?? []) as any[]).map((p) => ({ vencimento: p.vencimento, valor: Number(p.valor ?? 0) }));
  const formas = ((doc.pagamento ?? []) as any[]).map((p) => ({ forma: TPAG[String(p.forma)] ?? 'Outros', valor: Number(p.valor ?? 0) }));
  return {
    tipo: 'nota', id: doc.id, fornecedor: doc.emitente_nome, numero: doc.numero ? String(doc.numero) : null,
    data: String(doc.emitted_at ?? '').slice(0, 10), valor: Number(doc.valor_total ?? 0), lancada: false, itens,
    sem_itens: itens.length === 0,
    // Quem não é do financeiro não troca o boleto da nota por "pago"/bonificação
    pagamento: {
      ja_definido: false, parcelas, formas,
      so_boleto: !ctx.financeiro && parcelas.length > 0,
      bonificacao_ok: ctx.financeiro || isBonificacao(doc),
    },
  };
}

// ── Confirmar recebimento ───────────────────────────────────────────────────
interface ItemConf { key: string; recebido: number; ingredient_id: string | null; units_per_package: number }

function lerItens(raw: unknown): ItemConf[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ItemConf[] = [];
  for (const r of raw as any[]) {
    const recebido = Number(r?.recebido);
    if (!r || r.key == null || !Number.isFinite(recebido) || recebido < 0) return null;
    const upp = Number(r.units_per_package);
    out.push({ key: String(r.key), recebido, ingredient_id: r.ingredient_id ? String(r.ingredient_id) : null, units_per_package: upp > 0 ? upp : 1 });
  }
  return out;
}

// Mesma descrição que o fiscal-inbound monta ao lançar a nota: "<descrição> (<código>)"
const descDaNota = (it: any) => [it.descricao, it.codigo ? `(${it.codigo})` : null].filter(Boolean).join(' ').slice(0, 250);

async function receber(ctx: Ctx, purchaseId: string, porItemId: Map<string, ItemConf>, recebidoEm: string, obs: string) {
  const { admin, tenantId } = ctx;
  const { data: its } = await admin.from('fin_purchase_items')
    .select('id, description, quantity, total_price, unit_label, ingredient_id, units_per_package').eq('purchase_id', purchaseId).eq('tenant_id', tenantId);
  const faltas: string[] = [];
  const received_items = ((its ?? []) as any[]).map((it) => {
    const c = porItemId.get(String(it.id));
    const pedido = Number(it.quantity ?? 0);
    const rq = c ? c.recebido : pedido;
    if (c && Math.abs(rq - pedido) > 1e-9) faltas.push(`${it.description}: ${rq} de ${pedido} ${it.unit_label ?? ''}`.trim());
    const total = Number(it.total_price ?? 0);
    const base: Record<string, unknown> = {
      item_id: it.id, received_quantity: rq,
      received_total_price: pedido > 0 ? round2(total * (rq / pedido)) : total,
    };
    if (c) { base.ingredient_id = c.ingredient_id; base.units_per_package = c.units_per_package; }
    return base;
  });
  const notas = [
    `Recebido pelo celular${ctx.email ? ` (${ctx.email})` : ''}`,
    faltas.length ? `Chegou diferente — ${faltas.join('; ')}` : null,
    obs || null,
  ].filter(Boolean).join(' · ');
  const r = await chamarEdge(ctx, 'purchase-confirm-delivery', {
    tenant_id: tenantId, payload: { purchase_id: purchaseId, delivery_notes: notas, received_at: recebidoEm, received_items },
  }, true);
  if (!r.ok) return { ok: false as const, erro: r.erro };
  const semEstoque = ((its ?? []) as any[]).filter((it) => {
    const c = porItemId.get(String(it.id));
    const link = c ? c.ingredient_id : it.ingredient_id;
    return !link && !ehAcrescimo(it);
  }).length;
  return { ok: true as const, aviso: r.data?.data?.aviso ?? null, faltas, sem_estoque: semEstoque };
}

// Sangria prevista da compra paga em dinheiro. Roda LOGO DEPOIS de lançar e ANTES do recebimento:
// o "chegou diferente" reduz o total_amount, e a retirada do caixa foi do valor cheio. A RPC é
// idempotente (ja_prevista / ja_ligada), então repetir numa nova tentativa não duplica.
const MARCA_DINHEIRO = 'paga em dinheiro do caixa';
async function sangria(ctx: Ctx, purchaseId: string) {
  const { data, error } = await ctx.admin.rpc('fn_sangria_da_compra', { p_purchase: purchaseId });
  if (error) return { ok: false, motivo: error.message };
  return data;
}

function validarData(d: unknown): string | null {
  const s = String(d ?? '').slice(0, 10) || hojeBR();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s > hojeBR()) return null;
  return s;
}

async function confirmar(ctx: Ctx, body: Record<string, any>) {
  const { admin, tenantId } = ctx;
  const itens = lerItens(body.itens ?? []);
  if (!itens) return erro('Itens inválidos');
  const recebidoEm = validarData(body.recebido_em);
  if (!recebidoEm) return erro('Data do recebimento inválida (não pode ser no futuro)');
  const obs = String(body.obs ?? '').trim().slice(0, 500);
  const pagamento = String(body.pagamento ?? 'nota');

  if (body.tipo === 'nota') {
    const { data: doc } = await admin.from('fiscal_inbound_documents').select('*').eq('id', String(body.id ?? '')).eq('tenant_id', tenantId).maybeSingle();
    if (!doc) return erro('Nota não encontrada', 404);
    const bloqueio = await bloqueioDaNota(ctx, doc);
    if (bloqueio) return erro(bloqueio);
    let purchaseId: string;
    let lancouAgora = false;
    let sg: unknown = null;
    if (doc.status === 'imported') {
      // Lançada entre abrir e confirmar (lançamento automático, outra pessoa): segue na compra existente
      if (doc.import_type === 'bill' || !doc.purchase_id) return erro('Essa nota foi lançada como despesa');
      purchaseId = String(doc.purchase_id);
    } else {
      if (!['nota', 'dinheiro', 'pago', 'bonificacao'].includes(pagamento)) return erro('Forma de pagamento inválida');
      const temBoleto = ((doc.parcelas ?? []) as any[]).length > 0;
      if (!ctx.financeiro && temBoleto && pagamento !== 'nota') return erro('Essa nota tem boleto. Só o financeiro muda a forma de pagamento — confirme como "Boleto".');
      if (!ctx.financeiro && pagamento === 'bonificacao' && !isBonificacao(doc)) return erro('A nota não é de bonificação. Só o financeiro pode lançar como bonificação.');
      const forma = FORMAS_PAGAS.includes(String(body.forma)) ? String(body.forma) : 'PIX';
      const imp: Record<string, unknown> = {
        action: 'import_purchase', tenant_id: tenantId, document_id: doc.id,
        links: itens.map((c) => ({ index: Number(c.key), ingredient_id: c.ingredient_id, units_per_package: c.units_per_package })),
        notes: [`Recebida pelo celular${ctx.email ? ` (${ctx.email})` : ''}`,
          pagamento === 'dinheiro' ? MARCA_DINHEIRO : null,
          // Pix/cartão NÃO entra como paga: o extrato baixa a conta (senão sairia duas vezes)
          pagamento === 'pago' ? `já paga por ${forma} na entrega — a conciliação baixa pelo extrato` : null,
        ].filter(Boolean).join(' · '),
      };
      if (pagamento === 'dinheiro') { imp.pago = true; imp.payment_method = 'Dinheiro'; }
      if (pagamento === 'bonificacao') imp.bonus = true;
      const r = await chamarEdge(ctx, 'fiscal-inbound', imp, false);
      if (!r.ok) return erro(`Não consegui lançar a nota: ${r.erro}`, r.status >= 400 ? r.status : 500);
      purchaseId = String(r.data?.purchase_id ?? '');
      if (!purchaseId) return erro('A nota foi lançada, mas não voltou o número da compra. Abra de novo a lista.', 500);
      lancouAgora = true;
      if (pagamento === 'dinheiro') sg = await sangria(ctx, purchaseId);
    }
    // key (índice da nota) → item da compra: mesma descrição; entre iguais, a mesma quantidade
    const { data: its } = await admin.from('fin_purchase_items').select('id, description, quantity').eq('purchase_id', purchaseId).eq('tenant_id', tenantId).order('id');
    const livres = ((its ?? []) as any[]).map((it) => ({ id: String(it.id), desc: String(it.description ?? ''), qtd: Number(it.quantity ?? 0) }));
    const porItemId = new Map<string, ItemConf>();
    const docItens = (doc.itens ?? []) as any[];
    for (const c of itens) {
      const it = docItens[Number(c.key)];
      if (!it) continue;
      const desc = descDaNota(it);
      const q = Number(it.quantidade ?? 0) || 1;
      let i = livres.findIndex((l) => l.desc === desc && Math.abs(l.qtd - q) < 1e-9);
      if (i < 0) i = livres.findIndex((l) => l.desc === desc);
      if (i < 0) continue;
      porItemId.set(livres[i].id, c);
      livres.splice(i, 1);
    }
    const rec = await receber(ctx, purchaseId, porItemId, recebidoEm, obs);
    if (!rec.ok) {
      return erro(lancouAgora
        ? `A nota foi lançada, mas o recebimento não confirmou: ${rec.erro}. Ela continua em "Esperando chegar" — tente de novo por lá.`
        : `Não confirmou: ${rec.erro}`, 500, { purchase_id: purchaseId });
    }
    return json({ ...rec, purchase_id: purchaseId, lancada_agora: lancouAgora, sangria: sg });
  }

  if (body.tipo === 'compra') {
    const purchaseId = String(body.id ?? '');
    const { data: p } = await admin.from('fin_purchases').select('id, notes, payment_status').eq('id', purchaseId).eq('tenant_id', tenantId).maybeSingle();
    if (!p) return erro('Compra não encontrada', 404);
    // Compra lançada por esta tela em dinheiro cujo recebimento falhou antes: garante a sangria
    const sg = String(p.notes ?? '').includes(MARCA_DINHEIRO) && p.payment_status === 'paid' ? await sangria(ctx, purchaseId) : null;
    const porItemId = new Map(itens.map((c) => [c.key, c]));
    const rec = await receber(ctx, purchaseId, porItemId, recebidoEm, obs);
    if (!rec.ok) return erro(`Não confirmou: ${rec.erro}`, 500);
    return json({ ...rec, purchase_id: purchaseId, lancada_agora: false, sangria: sg });
  }
  return erro('tipo deve ser nota ou compra');
}

// ── Lançar cupom / entrega sem nota ─────────────────────────────────────────
const REF_OK = /^[a-zA-Z0-9-]{8,64}$/;
const MARCA_REEMBOLSO = 'paga do bolso por';

async function lancar(ctx: Ctx, body: Record<string, any>) {
  const { admin, tenantId } = ctx;
  const origem = body.origem === 'cupom' ? 'cupom' : body.origem === 'sem_nota' ? 'sem_nota' : null;
  if (!origem) return erro('origem deve ser cupom ou sem_nota');
  // Identificador do rascunho na tela: repetir o envio (sem internet, timeout) não lança de novo
  const ref = String(body.ref ?? '');
  if (!REF_OK.test(ref)) return erro('Atualize o app (falta a referência do lançamento)');
  const marcaRef = `[ref:${ref}]`;
  const fornecedor = String(body.fornecedor ?? '').trim().slice(0, 200);
  if (!fornecedor) return erro('Informe o fornecedor');
  const pagamento = String(body.pagamento ?? '');
  if (!['dinheiro', 'pago', 'a_pagar', 'bonificacao', 'reembolso'].includes(pagamento)) return erro('Forma de pagamento inválida');
  // Reembolso: quem pagou do bolso, chave Pix e comprovante (o cupom lido na SEFAZ já é o comprovante)
  const reemb = pagamento === 'reembolso' ? {
    nome: String(body.reembolso?.nome ?? '').trim().slice(0, 120),
    pix: String(body.reembolso?.pix_chave ?? '').trim().slice(0, 140),
    comprovante: body.reembolso?.comprovante ?? null,
  } : null;
  if (reemb) {
    if (!(await permissoesPedido(admin, tenantId, ctx.role)).pag_reembolso) {
      return erro('Seu perfil não pode pedir reembolso. Peça ao administrador para liberar "Pedir reembolso" em Configurações › Permissões.', 403);
    }
    if (!reemb.nome) return erro('Informe quem pagou (quem recebe o reembolso)');
    if (!reemb.pix) return erro('Informe a chave Pix de quem recebe o reembolso');
    if (!reemb.comprovante?.base64 && onlyDigits(body.chave).length !== 44) return erro('Tire a foto do comprovante do que foi pago');
  }
  const forma = FORMAS_PAGAS.includes(String(body.forma)) ? String(body.forma) : 'PIX';
  const recebidoEm = validarData(body.recebido_em);
  if (!recebidoEm) return erro('Data do recebimento inválida (não pode ser no futuro)');
  const dataCompra = /^\d{4}-\d{2}-\d{2}$/.test(String(body.data_compra ?? '')) ? String(body.data_compra) : recebidoEm;
  const vencimento = String(body.vencimento ?? '');
  if (pagamento === 'a_pagar' && !/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return erro('Informe quando vai ser pago');
  const bonus = pagamento === 'bonificacao';
  const chave = onlyDigits(body.chave);
  const numero = String(body.numero ?? '').trim().slice(0, 40) || null;

  // Já lançado por este mesmo rascunho (nova tentativa): só termina o recebimento
  {
    const { data: ja } = await admin.from('fin_purchases').select('id, delivery_confirmed_at, notes')
      .eq('tenant_id', tenantId).ilike('notes', `%${marcaRef}%`).limit(1).maybeSingle();
    if (ja) {
      // Mesma ref com outro pagamento (ex.: 1ª tentativa em dinheiro deu timeout e a pessoa trocou para
      // reembolso): nunca misturar — seria saída do caixa + Pix para a mesma compra
      const eraReembolso = String((ja as any).notes ?? '').includes(MARCA_REEMBOLSO);
      if (eraReembolso !== !!reemb) {
        return erro('Essa compra já foi lançada com outra forma de pagamento. Veja em "Esperando chegar" ou fale com o financeiro.', 409);
      }
      const sg = pagamento === 'dinheiro' ? await sangria(ctx, String(ja.id)) : null;
      const pr = reemb ? await pedidoDeReembolso(ctx, String(ja.id), ref, fornecedor, dataCompra, reemb) : null;
      if (ja.delivery_confirmed_at) return json({ ok: true, purchase_id: ja.id, lancada_agora: true, aviso: null, faltas: [], sem_estoque: 0, sangria: sg, reembolso: pr });
      const rec = await receber(ctx, String(ja.id), new Map(), recebidoEm, '');
      if (!rec.ok) return erro(`A compra está lançada, mas o recebimento não confirmou: ${rec.erro}`, 500, { purchase_id: ja.id });
      return json({ ...rec, purchase_id: ja.id, lancada_agora: true, sangria: sg, reembolso: pr });
    }
  }

  const rawItens = Array.isArray(body.itens) ? body.itens as any[] : [];
  if (!rawItens.length) return erro('Nenhum item');
  const [mcats, dcats] = await Promise.all([
    admin.from('fin_merchandise_categories').select('id').eq('tenant_id', tenantId),
    admin.from('fin_dre_categories').select('id').eq('tenant_id', tenantId),
  ]);
  const mcOk = new Set(((mcats.data ?? []) as any[]).map((c) => String(c.id)));
  const dcOk = new Set(((dcats.data ?? []) as any[]).map((c) => String(c.id)));
  const items: Record<string, unknown>[] = [];
  const ingIds = new Set<string>();
  let total = 0;
  for (const r of rawItens) {
    const qtd = Number(r?.quantidade);
    const valor = Number(r?.valor_total ?? 0);
    if (!Number.isFinite(qtd) || qtd <= 0) return erro(`Quantidade inválida em "${r?.descricao ?? 'item'}"`);
    if (!bonus && (!Number.isFinite(valor) || valor <= 0)) return erro(`Informe o valor de "${r?.descricao ?? 'item'}"`);
    total += bonus ? 0 : valor;
    const ing = r?.ingredient_id ? String(r.ingredient_id) : null;
    if (ing) ingIds.add(ing);
    const pc = Number(r?.pack_count), ps = Number(r?.pack_size), upp = Number(r?.units_per_package);
    // Sem embalagem nem fator informado, o purchase-write converte sozinho (kg↔g, L↔ml, fator do insumo)
    const conv = pc > 0 && ps > 0 ? { pack_count: pc, pack_size: ps } : upp > 0 ? { units_per_package: upp } : {};
    const mc = r?.merchandise_category_id ? String(r.merchandise_category_id) : null;
    const dc = r?.dre_category_id ? String(r.dre_category_id) : null;
    items.push({
      description: String(r?.descricao ?? '').trim().slice(0, 250) || 'Item',
      quantity: qtd,
      unit_price: bonus ? 0 : Math.round((valor / qtd) * 10000) / 10000,
      discount_per_unit: 0,
      unit_label: r?.unidade ? String(r.unidade).slice(0, 20) : null,
      ingredient_id: ing,
      ...conv,
      merchandise_category_id: mc && mcOk.has(mc) ? mc : null,
      dre_category_id: !ing && dc && dcOk.has(dc) ? dc : null,
    });
  }
  total = round2(total);
  if (ingIds.size) {
    const { data: ok } = await admin.from('ingredients').select('id').eq('tenant_id', tenantId).is('deleted_at', null).in('id', [...ingIds]);
    if ((ok ?? []).length !== ingIds.size) return erro('Insumo inválido para esta loja');
  }

  // Não lançar duas vezes o mesmo cupom (o grupo do WhatsApp e a Nova Compra também lançam cupom)
  if (chave.length === 44) {
    const { data: dup } = await admin.from('fin_purchases').select('id, supplier, total_amount, purchase_date, delivery_confirmed_at')
      .eq('tenant_id', tenantId).ilike('notes', `%${chave}%`).limit(1).maybeSingle();
    if (dup) return erro('Esse cupom já foi lançado', 409, { duplicada: dup });
  }
  if (numero) {
    const { data: mesmos } = await admin.from('fin_purchases').select('id, supplier, total_amount, purchase_date, delivery_confirmed_at')
      .eq('tenant_id', tenantId).eq('invoice_number', numero).limit(20);
    const dup = (mesmos ?? []).find((p: any) => normKey(p.supplier) === normKey(fornecedor));
    if (dup) return erro('Essa nota já foi lançada', 409, { duplicada: dup });
  }
  // Mesmo valor numa compra de ±3 dias (nome do fornecedor pode estar diferente): a tela pergunta
  if (!bonus && body.forcar !== true) {
    const t = new Date(`${dataCompra}T12:00:00Z`).getTime();
    const d0 = new Date(t - 3 * 86400_000).toISOString().slice(0, 10);
    const d1 = new Date(t + 3 * 86400_000).toISOString().slice(0, 10);
    const { data: perto } = await admin.from('fin_purchases').select('id, supplier, total_amount, purchase_date, delivery_confirmed_at')
      .eq('tenant_id', tenantId).gte('purchase_date', d0).lte('purchase_date', d1)
      .gte('total_amount', round2(total - 0.05)).lte('total_amount', round2(total + 0.05)).limit(5);
    if ((perto ?? []).length) return erro('Parece que essa compra já foi lançada', 409, { parecidas: perto });
  }

  const notes = [
    `Recebida pelo celular${ctx.email ? ` (${ctx.email})` : ''} — ${origem === 'cupom' ? 'cupom/notinha' : 'entrega sem nota'}`,
    pagamento === 'dinheiro' ? MARCA_DINHEIRO : null,
    reemb ? `${MARCA_REEMBOLSO} ${reemb.nome} — reembolso por Pix depois que o financeiro aprovar` : null,
    pagamento === 'pago' ? `já paga por ${forma} na entrega — a conciliação baixa pelo extrato` : null,
    chave.length === 44 ? `NFC-e chave ${chave}` : null,
    String(body.obs ?? '').trim().slice(0, 300) || null,
    marcaRef,
  ].filter(Boolean).join(' · ');
  // Pix/cartão já pagos entram PENDENTES com vencimento hoje: quem baixa é a conciliação com o
  // extrato (mesma regra do assistente — 'paid' aqui e o extrato de novo = saída em dobro).
  const payload: Record<string, unknown> = {
    supplier: fornecedor, invoice_number: numero, purchase_date: dataCompra,
    payment_method: bonus ? 'Bonificação' : pagamento === 'dinheiro' ? 'Dinheiro' : pagamento === 'pago' ? forma : reemb ? 'PIX' : body.forma === 'Boleto' ? 'Boleto' : 'PIX',
    payment_status: bonus || pagamento === 'dinheiro' ? 'paid' : 'pending',
    due_date: pagamento === 'a_pagar' ? vencimento : pagamento === 'pago' || reemb ? hojeBR() : null,
    is_bonus: bonus, notes, items,
  };
  const cr = await chamarEdge(ctx, 'purchase-write', { action: 'create_purchase', tenant_id: tenantId, payload }, false);
  const compra = cr.ok ? (cr.data?.data ?? cr.data?.result?.data ?? null) : null;
  if (!cr.ok || !compra?.id) return erro(`Não consegui lançar a compra: ${cr.ok ? 'sem retorno' : cr.erro}`, 500);
  const purchaseId = String(compra.id);
  const sg = pagamento === 'dinheiro' ? await sangria(ctx, purchaseId) : null;
  // Reembolso: a compra entra SEM conta a pagar — a conta só nasce quando o dono aprova o pedido
  // (fn_pedido_pagamento_aprovar). O pedido (com pendência no 📥) faz o papel da "compra pelo celular".
  let pr: { ok: boolean; erro?: string } | null = null;
  if (reemb) {
    const { error: delErr } = await admin.from('fin_accounts_payable').delete()
      .eq('tenant_id', tenantId).eq('reference_type', 'purchase').eq('reference_id', purchaseId).eq('status', 'pending');
    if (delErr) console.error('[receber-mercadoria] tirar conta do reembolso', delErr.message);
    pr = await pedidoDeReembolso(ctx, purchaseId, ref, fornecedor, dataCompra, reemb);
  }

  // Conta a pagar criada por quem não é do financeiro: o dono confere antes de pagar
  if (!ctx.financeiro && (pagamento === 'a_pagar' || pagamento === 'pago')) {
    await pendencia(ctx, 'compra_pelo_celular', purchaseId,
      `Compra lançada pelo celular: ${fornecedor} · R$ ${total.toFixed(2)}`,
      `${origem === 'cupom' ? 'Cupom' : 'Entrega sem nota'} lançado por ${ctx.email ?? 'alguém da loja'} como ${pagamento === 'pago' ? `já pago (${forma})` : `a pagar em ${vencimento.split('-').reverse().join('/')}`}. Confira antes de pagar.`,
      '/financeiro?tab=compras', { purchase_id: purchaseId });
  }

  const rec = await receber(ctx, purchaseId, new Map(), recebidoEm, '');
  if (!rec.ok) {
    return erro(`A compra foi lançada, mas o recebimento não confirmou: ${rec.erro}. Ela aparece em "Esperando chegar" — confirme por lá.`, 500, { purchase_id: purchaseId });
  }
  return json({ ...rec, purchase_id: purchaseId, lancada_agora: true, sangria: sg, reembolso: pr });
}

/** Pedido de reembolso ligado à compra (idempotente pela ref do rascunho). Falha aqui não desfaz a compra. */
async function pedidoDeReembolso(ctx: Ctx, purchaseId: string, ref: string, fornecedor: string, dataCompra: string,
  reemb: { nome: string; pix: string; comprovante: any }): Promise<{ ok: boolean; erro?: string }> {
  const { admin, tenantId } = ctx;
  const refPedido = `rec-${ref}`;
  const { data: ja } = await admin.from('fin_payment_requests').select('id').eq('tenant_id', tenantId).eq('ref', refPedido).maybeSingle();
  if (ja) return { ok: true };
  const falhou = (erro: string) => {
    console.error('[receber-mercadoria] pedido de reembolso', purchaseId, erro);
    return { ok: false, erro: `A compra foi lançada, mas o pedido de reembolso não foi criado (${erro}). Avise o financeiro.` };
  };
  const { data: compra } = await admin.from('fin_purchases').select('total_amount').eq('id', purchaseId).maybeSingle();
  const valor = round2(Number(compra?.total_amount ?? 0));
  if (!(valor > 0)) return falhou('compra sem valor');
  let comprovante: string | null = null;
  try { comprovante = await salvarComprovante(admin, tenantId, refPedido, reemb.comprovante); } catch (e) { return falhou((e as Error).message); }
  const quem = await nomeDoUsuario(admin, ctx.userId, ctx.email);
  const linha = {
    tenant_id: tenantId, tipo: 'reembolso', ref: refPedido, descricao: `Compra em ${fornecedor} (entrou no estoque)`, valor,
    data_gasto: dataCompra, favorecido_nome: reemb.nome, pix_chave: reemb.pix, comprovante_path: comprovante,
    purchase_id: purchaseId, bill_id: null, solicitado_por: ctx.userId, solicitado_por_nome: quem,
  };
  const { data: novo, error } = await admin.from('fin_payment_requests').insert(linha).select('id').single();
  if (error) return error.code === '23505' ? { ok: true } : falhou(error.message);
  await pendenciaDoPedido(admin, { id: novo.id, tenant_id: tenantId, tipo: 'reembolso', valor, favorecido_nome: reemb.nome, descricao: linha.descricao, solicitado_por_nome: quem });
  return { ok: true };
}

// ── Buscar pela chave (código de barras da DANFE) ou pelo número ────────────
async function buscar(ctx: Ctx, codigo: string) {
  const { admin, tenantId } = ctx;
  const dig = onlyDigits(codigo);
  if (dig.length === 44) {
    const modelo = dig.slice(20, 22);
    if (modelo === '65') return json({ tipo: 'nfce', chave: dig });
    const acha = () => admin.from('fiscal_inbound_documents').select('id').eq('tenant_id', tenantId).eq('chave', dig).maybeSingle();
    let { data } = await acha();
    if (!data) {
      // Nota recém-emitida: traz as da SEFAZ agora (mesmo que o botão "Buscar notas")
      await chamarEdge(ctx, 'fiscal-inbound', { action: 'sync', tenant_id: tenantId, days: 10 }, false).catch(() => null);
      ({ data } = await acha());
    }
    if (!data) return json({ tipo: 'nao_achou', chave: dig });
    return json({ tipo: 'nota', id: data.id });
  }
  if (!dig) return erro('Digite o número da nota ou leia o código de barras');
  const num = String(Number(dig));
  const [notas, compras] = await Promise.all([
    admin.from('fiscal_inbound_documents').select('id, numero, emitente_nome, valor_total, emitted_at, status')
      .eq('tenant_id', tenantId).eq('numero', num).neq('status', 'ignored').order('emitted_at', { ascending: false }).limit(10),
    admin.from('fin_purchases').select('id, invoice_number, supplier, total_amount, purchase_date, delivery_confirmed_at')
      .eq('tenant_id', tenantId).in('invoice_number', [num, dig]).order('purchase_date', { ascending: false }).limit(10),
  ]);
  return json({ tipo: 'lista', notas: notas.data ?? [], compras: compras.data ?? [] });
}

// ── Chegou, mas a nota ainda não está no sistema ────────────────────────────
async function aguardandoNota(ctx: Ctx, body: Record<string, any>) {
  const fornecedor = String(body.fornecedor ?? '').trim().slice(0, 200);
  const descricao = String(body.descricao ?? '').trim().slice(0, 1000);
  if (!fornecedor || !descricao) return erro('Informe o fornecedor e o que chegou');
  const obs = String(body.obs ?? '').trim().slice(0, 500);
  const quando = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
  const { data, error } = await ctx.admin.rpc('fn_pendencia_upsert', {
    p_tenant: ctx.tenantId, p_kind: 'recebimento_sem_nota', p_ref: REF_OK.test(String(body.ref ?? '')) ? String(body.ref) : crypto.randomUUID(),
    p_titulo: `Chegou mercadoria de ${fornecedor} sem nota no sistema`,
    p_detalhe: [`O que chegou: ${descricao}`, obs ? `Obs.: ${obs}` : null, `Recebido em ${quando}${ctx.email ? ` por ${ctx.email}` : ''}`,
      'Estoque ainda NÃO entrou: quando a nota aparecer em Notas de entrada, confirme o recebimento pelo celular (Receber mercadoria).'].filter(Boolean).join('\n'),
    p_payload: { fornecedor, descricao, obs, email: ctx.email }, p_rota: '/financeiro?tab=notas-entrada',
    p_urgencia: 'normal', p_acao_requerida: true, p_origem: 'app', p_reabrir: false,
  });
  if (error) return erro(`Não consegui avisar o financeiro: ${error.message}`, 500);
  return json({ ok: true, pendencia_id: (data as any)?.id ?? null });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !service) return erro('Server misconfiguration', 500);
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return erro('JSON inválido'); }
  const action = String(body.action ?? '');

  try {
    const caller = await authenticate(req, admin);
    if (!caller || caller.isServiceRole || !caller.userId) return erro('Sessão expirada. Entre de novo no ERPOS.', 401);
    const tenantId = String(body.tenant_id ?? '');
    if (!tenantId) return erro('tenant_id obrigatório');
    const role = await tenantRole(admin, caller.userId, tenantId);
    if (!role) return erro('Sem acesso a esta loja', 403);
    // Quem só pode pedir reembolso lança a mercadoria que pagou do bolso (cupom/sem nota) e nada mais
    const soReembolso = ['insumos', 'fornecedores'].includes(action) || (action === 'lancar' && body.pagamento === 'reembolso');
    if (!(await podeReceber(admin, tenantId, role)) && !(soReembolso && (await permissoesPedido(admin, tenantId, role)).pag_reembolso)) {
      return erro('Seu perfil não pode receber mercadoria. Peça ao administrador para liberar "Receber mercadoria" em Configurações › Permissões.', 403);
    }
    const ctx: Ctx = { admin, url, tenantId, userToken: bearerToken(req), email: caller.email, financeiro: isFinanceiroRole(role), userId: caller.userId, role };

    switch (action) {
      case 'pendentes': return json({ itens: await pendentes(ctx) });
      case 'recebidas': return json({ itens: await recebidas(ctx, String(body.mes ?? '')) });
      case 'insumos': return json({ insumos: await insumos(admin, tenantId) });
      case 'fornecedores': {
        const { data } = await admin.from('fin_suppliers').select('id, name').eq('tenant_id', tenantId).eq('is_active', true).order('name').limit(1000);
        return json({ fornecedores: (data ?? []).map((f: any) => ({ id: f.id, nome: f.name })) });
      }
      case 'abrir': {
        const r = body.tipo === 'nota' ? await abrirNota(ctx, String(body.id ?? ''))
          : body.tipo === 'compra' ? await abrirCompra(ctx, String(body.id ?? '')) : { erro: 'tipo inválido' };
        if ('erro' in r && r.erro) return erro(String(r.erro), 400);
        return json({ ...r, insumos: await insumos(admin, tenantId) });
      }
      case 'buscar': return await buscar(ctx, String(body.codigo ?? ''));
      case 'confirmar': return await confirmar(ctx, body);
      case 'lancar': return await lancar(ctx, body);
      case 'aguardando_nota': return await aguardandoNota(ctx, body);
      default: return erro(`Ação inválida: ${action}`);
    }
  } catch (e) {
    console.error('[receber-mercadoria]', action, e);
    return erro((e as Error)?.message ?? 'Erro interno', 500);
  }
});
