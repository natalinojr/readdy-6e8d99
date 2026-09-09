// fiscal-write — emissão de NFC-e (modelo 65) via Brasil NFe.
//
// Ações (POST JSON { action, ...}):
//   save_settings   { tenant_id, settings }          admin/manager — grava fiscal_settings (token só se enviado)
//   test_connection { tenant_id }                    consulta status da SEFAZ com o token da loja
//   emit            { tenant_id, source_type, source_id, force? }  cria/emite a NFC-e de um pedido ou sessão de mesa
//   retry           { tenant_id, document_id }       reemite um documento rejeitado/com erro
//   run_pending     { tenant_id }                    reprocessa pendentes/erros (até 20)
//   cancel          { tenant_id, document_id, justificativa }   admin/manager — cancela na SEFAZ
//   get_pdf         { tenant_id, document_id }       DANFE em PDF (base64) via provedor
//   print_danfe     { tenant_id, document_id }       reenfileira o DANFE térmico na print_queue
//   get_xml         { tenant_id, document_id }       XML autorizado
//
// Autenticação: JWT do usuário (membership em user_tenants) OU chamada interna de outra
// Edge Function com `Authorization: Bearer <service_role_key>` (order-write / table-write).
//
// Regra da nota: balcão/delivery = uma NFC-e por pedido pago; mesa = uma NFC-e por
// sessão fechada (todos os pedidos e pagamentos da sessão dentro da mesma nota).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BRASILNFE_BASE = 'https://api.brasilnfe.com.br/services/fiscal';
const PROVIDER_TIMEOUT_MS = 70_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function errResp(msg: string, status = 400, extra?: Record<string, unknown>) {
  return json({ success: false, error: msg, ...(extra ?? {}) }, status);
}
function log(level: 'INFO' | 'WARN' | 'ERROR', action: string, msg: string, ctx?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), fn: 'fiscal-write', level, action, msg, ...(ctx ?? {}) };
  if (level === 'ERROR') console.error(JSON.stringify(entry));
  else if (level === 'WARN') console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}
function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cnpj[i]) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function xmlTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return null;
  return m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

// Código fiscal da forma de pagamento (tPag) a partir do type da payment_methods.
const TPAG_BY_TYPE: Record<string, string> = {
  cash: '01', dinheiro: '01',
  credit_card: '03', credito: '03',
  debit_card: '04', debito: '04',
  pix: '17',
  meal_voucher: '11', vale: '11',
  other: '99',
};
const TPAG_LABEL: Record<string, string> = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de Crédito', '04': 'Cartão de Débito', '05': 'Crédito Loja',
  '10': 'Vale Alimentação', '11': 'Vale Refeição', '12': 'Vale Presente', '13': 'Vale Combustível',
  '15': 'Boleto', '16': 'Depósito', '17': 'PIX', '18': 'Transferência', '19': 'Cashback', '90': 'Sem pagamento', '99': 'Outros',
};

// ─── Tipos ───────────────────────────────────────────────────────────────────
interface FiscalSettings {
  tenant_id: string;
  enabled: boolean;
  provider: string;
  provider_token: string | null;
  environment: number;
  razao_social: string | null;
  inscricao_estadual: string | null;
  crt: number;
  endereco_logradouro: string | null;
  endereco_numero: string | null;
  endereco_bairro: string | null;
  endereco_municipio: string | null;
  endereco_uf: string | null;
  endereco_cep: string | null;
  natureza_operacao: string;
  ncm_padrao: string;
  cfop_padrao: number;
  csosn_padrao: string;
  cst_icms_padrao: string | null;
  icms_aliquota_padrao: number | null;
  origem_padrao: number;
  pis_cst_padrao: string;
  cofins_cst_padrao: string;
  cod_tributacao_padrao: string | null;
  serie: number | null;
  print_danfe: boolean;
  danfe_printer_id: string | null;
  emit_on_delivery: boolean;
  emit_on_counter: boolean;
  emit_on_table_close: boolean;
}

interface OrderRow {
  id: string; number: string | null; origin_type: string; status: string;
  table_session_id: string | null; table_number: number | null;
  destination_name: string | null; customer_cpf: string | null; customer_id: string | null;
  discount_amount: number | null; service_fee_amount: number | null; tip_amount: number | null;
  delivery_fee: number | null; subtotal: number | null; total_amount: number | null;
  is_training: boolean | null; is_draft: boolean | null; is_cortesia: boolean | null; is_paid: boolean | null;
  created_at: string;
}

type Admin = SupabaseClient;

// ─── Provedor (Brasil NFe) ───────────────────────────────────────────────────
async function providerPost(token: string, path: string, body: unknown): Promise<{ ok: boolean; status: number; data: any; raw: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(`${BRASILNFE_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Token': token },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data, raw };
  } finally {
    clearTimeout(timer);
  }
}

// Mensagem de erro do provedor: pode vir em `Error` (string) ou em `erros[]` ({codigo, descricao}).
function providerErrorMessage(data: any): string {
  if (!data || typeof data !== 'object') return '';
  const parts: string[] = [];
  if (data.Error && String(data.Error).trim()) parts.push(String(data.Error).trim());
  if (Array.isArray(data.erros)) for (const e of data.erros) parts.push([e?.codigo, e?.descricao, e?.correcao].filter(Boolean).join(' - '));
  if (Array.isArray(data.Erros)) for (const e of data.Erros) parts.push([e?.codigo ?? e?.Codigo, e?.descricao ?? e?.Descricao].filter(Boolean).join(' - '));
  return parts.join(' | ');
}
function providerHasError(data: any): boolean {
  return Boolean(providerErrorMessage(data)) || (data && typeof data === 'object' && data.status === 2);
}

// ─── Montagem da NFC-e ───────────────────────────────────────────────────────
interface BuiltNote {
  payload: Record<string, unknown>;
  total: number;
  customer_cpf: string | null;
  customer_name: string | null;
  order_ids: string[];
  order_number: string;
  danfe: Record<string, unknown>; // dados para o DANFE térmico
}

async function loadSettings(admin: Admin, tenantId: string): Promise<FiscalSettings | null> {
  const { data, error } = await admin.from('fiscal_settings').select('*').eq('tenant_id', tenantId).maybeSingle();
  if (error) throw new Error(`fiscal_settings: ${error.message}`);
  return (data as FiscalSettings | null) ?? null;
}

async function buildNote(admin: Admin, settings: FiscalSettings, tenantId: string, sourceType: string, sourceId: string): Promise<{ note: BuiltNote | null; skipReason?: string }> {
  // 1. Pedidos da origem
  let q = admin.from('orders')
    .select('id, number, origin_type, status, table_session_id, table_number, destination_name, customer_cpf, customer_id, discount_amount, service_fee_amount, tip_amount, delivery_fee, subtotal, total_amount, is_training, is_draft, is_cortesia, is_paid, created_at')
    .eq('tenant_id', tenantId);
  q = sourceType === 'order' ? q.eq('id', sourceId) : q.eq('table_session_id', sourceId);
  const { data: ordersRaw, error: ordErr } = await q;
  if (ordErr) throw new Error(`orders: ${ordErr.message}`);
  const orders = ((ordersRaw ?? []) as OrderRow[]).filter((o) => o.status !== 'cancelled' && !o.is_draft && !o.is_training);
  if (orders.length === 0) return { note: null, skipReason: 'Nenhum pedido válido (cancelado, rascunho ou treino)' };

  const orderIds = orders.map((o) => o.id);
  const expectedTotal = round2(orders.reduce((s, o) => s + Number(o.total_amount ?? 0), 0));
  if (expectedTotal <= 0) return { note: null, skipReason: 'Total da venda é zero (cortesia) — NFC-e não emitida' };

  // 2. Itens + classificação fiscal (item -> categoria -> padrão da loja)
  const { data: itemsRaw, error: itErr } = await admin.from('order_items')
    .select('id, order_id, item_id, item_name, item_price, quantity, status')
    .in('order_id', orderIds).neq('status', 'cancelled');
  if (itErr) throw new Error(`order_items: ${itErr.message}`);
  const items = (itemsRaw ?? []) as Array<{ id: string; order_id: string; item_id: string | null; item_name: string; item_price: number; quantity: number }>;
  if (items.length === 0) return { note: null, skipReason: 'Venda sem itens' };

  const menuIds = [...new Set(items.map((i) => i.item_id).filter(Boolean))] as string[];
  const menuById = new Map<string, any>();
  const catById = new Map<string, any>();
  if (menuIds.length > 0) {
    const { data: mi } = await admin.from('menu_items').select('id, category_id, ncm, cest, cfop, csosn, origem, cod_tributacao, gtin').in('id', menuIds);
    for (const m of mi ?? []) menuById.set(m.id, m);
    const catIds = [...new Set((mi ?? []).map((m: any) => m.category_id).filter(Boolean))] as string[];
    if (catIds.length > 0) {
      const { data: mc } = await admin.from('menu_categories').select('id, ncm, cest, cfop, csosn, cod_tributacao').in('id', catIds);
      for (const c of mc ?? []) catById.set(c.id, c);
    }
  }

  // Descrições com opções escolhidas (ajuda o cliente a reconhecer o item)
  const { data: optsRaw } = await admin.from('order_item_options').select('order_item_id, option_name').in('order_item_id', items.map((i) => i.id));
  const optsByItem = new Map<string, string[]>();
  for (const o of optsRaw ?? []) {
    const arr = optsByItem.get(o.order_item_id) ?? [];
    if (o.option_name) arr.push(String(o.option_name));
    optsByItem.set(o.order_item_id, arr);
  }

  // 3. Totais e conciliação com o valor cobrado
  const gross = items.map((i) => round2(Number(i.item_price ?? 0) * Number(i.quantity ?? 1)));
  const grossTotal = round2(gross.reduce((s, v) => s + v, 0));
  let discount = round2(orders.reduce((s, o) => s + Number(o.discount_amount ?? 0), 0));
  let extras = round2(orders.reduce((s, o) => s + Number(o.service_fee_amount ?? 0) + Number(o.tip_amount ?? 0) + Number(o.delivery_fee ?? 0), 0));
  // A nota tem que fechar exatamente no valor pago: qualquer diferença de arredondamento
  // ou de regra (cupom, cortesia parcial) entra como desconto (ou "outras despesas").
  const diff = round2(grossTotal - discount + extras - expectedTotal);
  if (Math.abs(diff) >= 0.01) {
    if (diff > 0) discount = round2(discount + diff);
    else extras = round2(extras - diff);
  }
  if (discount >= grossTotal) return { note: null, skipReason: 'Desconto igual ou maior que os itens — venda sem valor fiscal' };

  // Desconto rateado proporcionalmente; o último item absorve o arredondamento.
  const discPerItem: number[] = [];
  let distributed = 0;
  for (let i = 0; i < items.length; i++) {
    let d = i === items.length - 1 ? round2(discount - distributed) : round2(discount * (gross[i] / grossTotal));
    if (d > gross[i]) d = gross[i];
    if (d < 0) d = 0;
    discPerItem.push(d);
    distributed = round2(distributed + d);
  }
  // Se o último não coube inteiro, redistribui o resto nos anteriores.
  let rest = round2(discount - distributed);
  for (let i = 0; rest > 0 && i < items.length; i++) {
    const room = round2(gross[i] - discPerItem[i]);
    const add = Math.min(room, rest);
    discPerItem[i] = round2(discPerItem[i] + add);
    rest = round2(rest - add);
  }

  const useCodTrib = (m: any, c: any) => m?.cod_tributacao || c?.cod_tributacao || settings.cod_tributacao_padrao || null;
  const isSimples = settings.crt === 1 || settings.crt === 4;

  const produtos = items.map((it, idx) => {
    const m = it.item_id ? menuById.get(it.item_id) : null;
    const c = m?.category_id ? catById.get(m.category_id) : null;
    const opts = optsByItem.get(it.id) ?? [];
    let nome = String(it.item_name ?? 'ITEM').trim();
    if (opts.length > 0) nome = `${nome} (${opts.join(', ')})`;
    nome = nome.replace(/\s+/g, ' ').slice(0, 120);
    const qty = Number(it.quantity ?? 1);
    const unit = round2(Number(it.item_price ?? 0));
    const ncm = onlyDigits(m?.ncm || c?.ncm || settings.ncm_padrao).padStart(8, '0').slice(0, 8);
    const cest = onlyDigits(m?.cest || c?.cest || '');
    const cfop = Number(m?.cfop || c?.cfop || settings.cfop_padrao || 5102);
    const origem = Number(m?.origem ?? settings.origem_padrao ?? 0);
    const codTrib = useCodTrib(m, c);
    const prod: Record<string, unknown> = {
      NmProduto: nome,
      CodProdutoServico: (it.item_id ?? it.id).replace(/-/g, '').slice(0, 20),
      NCM: ncm,
      UnidadeComercial: 'UN',
      Quantidade: qty,
      ValorUnitario: unit,
      ValorTotal: gross[idx],
      ValorDesconto: discPerItem[idx] > 0 ? discPerItem[idx] : 0,
      ValorOutrasDespesas: idx === 0 && extras > 0 ? extras : 0,
      CFOP: cfop,
      OrigemProduto: origem,
    };
    if (m?.gtin) prod.EAN = onlyDigits(m.gtin);
    if (cest) prod.CEST = cest;
    if (codTrib) {
      prod.CodTributacao = String(codTrib);
    } else {
      const icms: Record<string, unknown> = {
        CodSituacaoTributaria: isSimples ? String(m?.csosn || c?.csosn || settings.csosn_padrao || '102') : String(m?.csosn || c?.csosn || settings.cst_icms_padrao || '00'),
      };
      if (!isSimples && settings.icms_aliquota_padrao != null) icms.AliquotaICMS = Number(settings.icms_aliquota_padrao);
      prod.Imposto = {
        ICMS: icms,
        PIS: { CodSituacaoTributaria: settings.pis_cst_padrao || '49' },
        COFINS: { CodSituacaoTributaria: settings.cofins_cst_padrao || '49' },
      };
    }
    return prod;
  });

  // 4. Pagamentos (por pedido e, na mesa, também por sessão)
  const payQ = admin.from('payments')
    .select('id, order_id, table_session_id, amount, change_amount, is_refunded, payment_method_id')
    .eq('tenant_id', tenantId).eq('is_refunded', false);
  const { data: paysByOrder } = await payQ.in('order_id', orderIds);
  let pays = (paysByOrder ?? []) as any[];
  if (sourceType === 'table_session') {
    const { data: paysBySession } = await admin.from('payments')
      .select('id, order_id, table_session_id, amount, change_amount, is_refunded, payment_method_id')
      .eq('tenant_id', tenantId).eq('is_refunded', false).eq('table_session_id', sourceId);
    const seen = new Set(pays.map((p) => p.id));
    for (const p of paysBySession ?? []) if (!seen.has(p.id)) pays.push(p);
  }
  const pmIds = [...new Set(pays.map((p) => p.payment_method_id).filter(Boolean))] as string[];
  const pmById = new Map<string, any>();
  if (pmIds.length > 0) {
    const { data: pms } = await admin.from('payment_methods').select('id, name, type, fiscal_code').in('id', pmIds);
    for (const pm of pms ?? []) pmById.set(pm.id, pm);
  }
  // Consolida por código fiscal.
  const byCode = new Map<string, { code: string; label: string; paid: number; troco: number }>();
  for (const p of pays) {
    const pm = p.payment_method_id ? pmById.get(p.payment_method_id) : null;
    const code = onlyDigits(pm?.fiscal_code).padStart(2, '0').slice(0, 2) || TPAG_BY_TYPE[String(pm?.type ?? '')] || '99';
    const label = pm?.name ?? TPAG_LABEL[code] ?? 'Pagamento';
    const troco = round2(Number(p.change_amount ?? 0));
    const paid = round2(Number(p.amount ?? 0) + troco);
    const cur = byCode.get(code) ?? { code, label, paid: 0, troco: 0 };
    cur.paid = round2(cur.paid + paid);
    cur.troco = round2(cur.troco + troco);
    byCode.set(code, cur);
  }
  let pagamentos = [...byCode.values()];
  if (pagamentos.length === 0) pagamentos = [{ code: '99', label: 'Outros', paid: expectedTotal, troco: 0 }];
  // Σ(pago − troco) tem que bater com o total da nota; ajusta a maior linha.
  const netPaid = round2(pagamentos.reduce((s, p) => s + p.paid - p.troco, 0));
  const payDiff = round2(expectedTotal - netPaid);
  if (Math.abs(payDiff) >= 0.01) {
    const biggest = pagamentos.reduce((a, b) => (b.paid > a.paid ? b : a));
    biggest.paid = round2(biggest.paid + payDiff);
    if (biggest.paid < 0) biggest.paid = 0;
  }
  const trocoTotal = round2(pagamentos.reduce((s, p) => s + p.troco, 0));

  // 5. Consumidor (CPF na nota)
  let customerCpf: string | null = null;
  let customerName: string | null = null;
  for (const o of orders) {
    const d = onlyDigits(o.customer_cpf);
    if ((d.length === 11 && isValidCpf(d)) || (d.length === 14 && isValidCnpj(d))) { customerCpf = d; break; }
  }
  if (customerCpf) {
    const withCpf = orders.find((o) => onlyDigits(o.customer_cpf) === customerCpf);
    if (withCpf?.customer_id) {
      const { data: cust } = await admin.from('customers').select('name').eq('id', withCpf.customer_id).maybeSingle();
      customerName = cust?.name ?? null;
    }
    if (!customerName && withCpf?.destination_name) customerName = String(withCpf.destination_name).split(/\s+[-–—]\s+/)[0].trim() || null;
  }

  const first = orders[0];
  const isTable = sourceType === 'table_session';
  const orderNumber = isTable
    ? `Mesa ${first.table_number ?? ''}`.trim() + (orders.length > 1 ? ` (${orders.length} pedidos)` : ` #${first.number ?? ''}`)
    : `#${first.number ?? first.id.slice(0, 8)}`;
  const obs = isTable
    ? `Mesa ${first.table_number ?? ''} - pedidos ${orders.map((o) => o.number).filter(Boolean).join(', ')}`
    : `Pedido ${first.number ?? ''}${first.origin_type === 'delivery' ? ' - delivery' : ''}`;

  const payload: Record<string, unknown> = {
    ModeloDocumento: 65,
    TipoAmbiente: String(settings.environment ?? 2),
    Finalidade: 1,
    NaturezaOperacao: settings.natureza_operacao || 'VENDA DE MERCADORIA',
    ConsumidorFinal: true,
    // Presencial em todos os canais: indPres=4 (entrega a domicílio) exige endereço
    // estruturado do destinatário, que o delivery guarda como texto livre.
    IndicadorPresenca: 1,
    IdentificadorInterno: sourceId,
    Observacao: obs.slice(0, 500),
    Produtos: produtos,
    Pagamentos: pagamentos.map((p) => ({
      IndicadorPagamento: 0,
      FormaPagamento: p.code,
      VlPago: p.paid,
      VlTroco: p.troco > 0 ? p.troco : 0,
      Descricao: p.label,
    })),
  };
  if (settings.serie) payload.Serie = Number(settings.serie);
  if (customerCpf) payload.Cliente = { CpfCnpj: customerCpf, NmCliente: customerName ?? undefined, IndicadorIe: 9 };

  const danfe = {
    tipo: 'danfe_nfce',
    pedido: orderNumber,
    itens: items.map((it, idx) => ({
      nome: String(produtos[idx].NmProduto), quantidade: Number(it.quantity ?? 1), unitario: round2(Number(it.item_price ?? 0)), total: gross[idx],
    })),
    subtotal: grossTotal,
    desconto: discount,
    outras: extras,
    total: expectedTotal,
    pagamentos: pagamentos.map((p) => ({ nome: p.label, valor: p.paid })),
    troco: trocoTotal,
    consumidor_cpf: customerCpf,
    consumidor_nome: customerName,
  };

  return {
    note: { payload, total: expectedTotal, customer_cpf: customerCpf, customer_name: customerName, order_ids: orderIds, order_number: orderNumber, danfe },
  };
}

// ─── Emissão ─────────────────────────────────────────────────────────────────
interface EmitResult { success: boolean; status: string; document_id?: string; message?: string; chave?: string; skipped?: boolean }

async function emitForSource(admin: Admin, tenantId: string, sourceType: string, sourceId: string, opts: { force?: boolean; userId?: string | null; trigger?: string }): Promise<EmitResult> {
  const settings = await loadSettings(admin, tenantId);
  if (!settings) return { success: false, status: 'skipped', skipped: true, message: 'Módulo fiscal não configurado' };
  if (!settings.enabled && !opts.force) return { success: false, status: 'skipped', skipped: true, message: 'Emissão automática desligada' };
  if (!settings.provider_token) return { success: false, status: 'error', message: 'Token do provedor não configurado' };

  // Já existe documento vivo?
  const { data: existing } = await admin.from('fiscal_documents').select('id, status, chave, updated_at')
    .eq('tenant_id', tenantId).eq('source_type', sourceType).eq('source_id', sourceId)
    .in('status', ['pending', 'processing', 'authorized']).maybeSingle();
  if (existing?.status === 'authorized') return { success: true, status: 'authorized', document_id: existing.id, chave: existing.chave ?? undefined, message: 'Nota já autorizada' };
  if (existing?.status === 'processing' && !opts.force) {
    const age = Date.now() - new Date(existing.updated_at).getTime();
    if (age < 2 * 60_000) return { success: false, status: 'processing', document_id: existing.id, message: 'Emissão já em andamento' };
  }

  let built: { note: BuiltNote | null; skipReason?: string };
  try {
    built = await buildNote(admin, settings, tenantId, sourceType, sourceId);
  } catch (e) {
    log('ERROR', 'emit', 'buildNote falhou', { tenantId, sourceType, sourceId, error: String(e) });
    return { success: false, status: 'error', message: `Falha ao montar a nota: ${(e as Error).message}` };
  }
  if (!built.note) {
    if (existing) await admin.from('fiscal_documents').update({ status: 'skipped', error_message: built.skipReason, updated_at: new Date().toISOString() }).eq('id', existing.id);
    return { success: false, status: 'skipped', skipped: true, message: built.skipReason };
  }
  const note = built.note;

  // Cria/atualiza a linha em processing (índice único parcial evita duplicidade)
  let docId = existing?.id ?? null;
  const base = {
    tenant_id: tenantId, model: 65, status: 'processing', source_type: sourceType, source_id: sourceId,
    order_ids: note.order_ids, order_number: note.order_number, environment: settings.environment ?? 2,
    total_amount: note.total, customer_cpf: note.customer_cpf, customer_name: note.customer_name,
    request_payload: note.payload, error_message: null, updated_at: new Date().toISOString(),
  };
  if (docId) {
    const { error } = await admin.from('fiscal_documents').update(base).eq('id', docId);
    if (error) return { success: false, status: 'error', message: `fiscal_documents update: ${error.message}` };
  } else {
    const { data: ins, error } = await admin.from('fiscal_documents').insert({ ...base, created_by: opts.userId ?? null, attempts: 0 }).select('id').single();
    if (error) {
      if (String(error.code) === '23505') {
        const { data: again } = await admin.from('fiscal_documents').select('id, status').eq('tenant_id', tenantId).eq('source_type', sourceType).eq('source_id', sourceId).in('status', ['pending', 'processing', 'authorized']).maybeSingle();
        return { success: again?.status === 'authorized', status: again?.status ?? 'processing', document_id: again?.id, message: 'Documento já existente para esta venda' };
      }
      return { success: false, status: 'error', message: `fiscal_documents insert: ${error.message}` };
    }
    docId = ins.id;
  }

  return await transmit(admin, settings, tenantId, docId!, note);
}

async function transmit(admin: Admin, settings: FiscalSettings, tenantId: string, docId: string, note: BuiltNote): Promise<EmitResult> {
  const nowIso = () => new Date().toISOString();
  const { data: attemptsRow } = await admin.from('fiscal_documents').select('attempts').eq('id', docId).maybeSingle();
  const attempts = Number(attemptsRow?.attempts ?? 0) + 1;

  let res: Awaited<ReturnType<typeof providerPost>>;
  try {
    res = await providerPost(settings.provider_token!, 'EnviarNotaFiscal', note.payload);
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? 'Tempo esgotado ao falar com o provedor' : `Falha de rede: ${(e as Error).message}`;
    await admin.from('fiscal_documents').update({ status: 'error', error_message: msg, attempts, updated_at: nowIso() }).eq('id', docId);
    log('ERROR', 'transmit', msg, { docId });
    return { success: false, status: 'error', document_id: docId, message: msg };
  }

  const data = res.data ?? {};
  const ret = data.ReturnNF ?? {};
  const code = Number(ret.CodStatusRespostaSefaz ?? data.CodStatusRespostaSefaz ?? 0);
  const authorized = res.ok && (ret.Ok === true || code === 100 || code === 150);
  const responseSafe = { ...data };
  delete responseSafe.Base64Xml;
  delete responseSafe.Base64File;

  if (!authorized) {
    const sefazMsg = ret.DsStatusRespostaSefaz || data.DsStatusRespostaSefaz || '';
    const errMsg = providerErrorMessage(data) || sefazMsg || (res.raw ? res.raw.slice(0, 300) : `HTTP ${res.status}`);
    const avisos = Array.isArray(data.Avisos) && data.Avisos.length ? ` | ${data.Avisos.map((a: unknown) => String(a)).join('; ')}` : '';
    // Rejeição da SEFAZ (tem código de retorno) vs. erro do provedor/validação/transporte.
    const status = code > 0 && code !== 100 && code !== 150 ? 'rejected' : 'error';
    await admin.from('fiscal_documents').update({
      status, sefaz_status_code: code || null, sefaz_message: sefazMsg || null,
      error_message: (errMsg + avisos).slice(0, 1000), response_payload: responseSafe, attempts, updated_at: nowIso(),
    }).eq('id', docId);
    log('WARN', 'transmit', 'NFC-e não autorizada', { docId, code, errMsg, http: res.status });
    return { success: false, status, document_id: docId, message: errMsg + avisos };
  }

  let xml: string | null = null;
  let qr: string | null = null;
  let urlChave: string | null = null;
  try {
    if (data.Base64Xml) {
      xml = base64ToUtf8(String(data.Base64Xml));
      qr = xmlTag(xml, 'qrCode');
      urlChave = xmlTag(xml, 'urlChave');
    }
  } catch (e) {
    log('WARN', 'transmit', 'XML não decodificado', { docId, error: String(e) });
  }
  const chave = String(ret.ChaveNF ?? '').replace(/\D/g, '') || null;
  const emittedAt = nowIso();
  const upd = {
    status: 'authorized', chave, protocolo: ret.NumeroProtocolo ? String(ret.NumeroProtocolo) : null,
    numero: ret.Numero != null ? Number(ret.Numero) : null, serie: ret.Serie != null ? Number(ret.Serie) : null,
    sefaz_status_code: code || 100, sefaz_message: ret.DsStatusRespostaSefaz ?? null,
    qr_code: qr, url_chave: urlChave, xml, response_payload: responseSafe, error_message: null,
    attempts, emitted_at: emittedAt, updated_at: emittedAt,
  };
  const { error: updErr } = await admin.from('fiscal_documents').update(upd).eq('id', docId);
  if (updErr) log('ERROR', 'transmit', 'Nota autorizada mas não gravada!', { docId, chave, error: updErr.message });
  log('INFO', 'transmit', 'NFC-e autorizada', { docId, chave, numero: upd.numero });

  if (settings.print_danfe) {
    try { await enqueueDanfe(admin, settings, tenantId, docId, { ...note.danfe, chave, protocolo: upd.protocolo, numero: upd.numero, serie: upd.serie, emitted_at: emittedAt, qr_code: qr, url_chave: urlChave, ambiente: settings.environment }); }
    catch (e) { log('WARN', 'transmit', 'DANFE não enfileirado', { docId, error: String(e) }); }
  }
  return { success: true, status: 'authorized', document_id: docId, chave: chave ?? undefined };
}

async function enqueueDanfe(admin: Admin, settings: FiscalSettings, tenantId: string, docId: string, danfe: Record<string, unknown>) {
  const { data: tenant } = await admin.from('tenants').select('name, cnpj, address, city, state, zip_code, phone').eq('id', tenantId).maybeSingle();
  const emitente = {
    nome: settings.razao_social || tenant?.name || '',
    fantasia: tenant?.name || '',
    cnpj: onlyDigits(tenant?.cnpj),
    ie: settings.inscricao_estadual || '',
    endereco: [settings.endereco_logradouro || tenant?.address, settings.endereco_numero].filter(Boolean).join(', '),
    bairro: settings.endereco_bairro || '',
    municipio: settings.endereco_municipio || tenant?.city || '',
    uf: settings.endereco_uf || tenant?.state || '',
    cep: settings.endereco_cep || tenant?.zip_code || '',
  };
  const payload = { ...danfe, emitente, document_id: docId, impressora_id: settings.danfe_printer_id ?? null, itens: danfe.itens };
  const { error } = await admin.from('print_queue').insert({
    tenant_id: tenantId, order_id: null, order_number: String(danfe.pedido ?? ''),
    station_key: 'danfe', station_label: 'DANFE NFC-e', impressora_id: settings.danfe_printer_id ?? null,
    content_type: 'danfe_nfce', payload, paper_style: '80mm', status: 'pending', retry_count: 0, max_retries: 5,
  });
  if (error) throw new Error(error.message);
  await admin.from('fiscal_documents').update({ printed_at: new Date().toISOString() }).eq('id', docId);
}

// ─── Handler ─────────────────────────────────────────────────────────────────
Deno.serve({ verify_jwt: false } as any, async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || serviceRoleKey.length < 40) return errResp('Server misconfiguration', 500);
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  // Chamada interna (order-write / table-write): segredo compartilhado em header próprio.
  // Não depende do formato da service key nem das regras do gateway para `apikey`.
  const internalKey = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
  const internalHeader = req.headers.get('x-internal-key') ?? '';
  const internal = internalKey.length >= 20 && internalHeader === internalKey;
  if (!token && !internal) return errResp('Unauthorized', 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return errResp('Invalid JSON body', 400); }
  const action = String(body.action ?? '');
  const requestedTenant: string | null = body.tenant_id ?? body.active_tenant_id ?? null;
  let userId: string | null = null;
  let role: string | null = null;
  let tenantId: string;
  if (internal) {
    if (!requestedTenant) return errResp('tenant_id required', 400);
    tenantId = requestedTenant;
    role = 'admin';
  } else {
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return errResp('Unauthorized', 401);
    userId = userData.user.id;
    const { data: rows, error: tErr } = await admin.from('user_tenants').select('tenant_id, role').eq('user_id', userId);
    if (tErr) return errResp(`Tenant lookup failed: ${tErr.message}`, 500);
    if (!rows || rows.length === 0) return errResp('User does not belong to any tenant', 403);
    let match = requestedTenant ? rows.find((r) => r.tenant_id === requestedTenant) : (rows.length === 1 ? rows[0] : null);
    if (!match) return errResp(requestedTenant ? 'User does not belong to the requested tenant' : 'active_tenant_id required', 403);
    tenantId = match.tenant_id;
    role = String(match.role ?? '');
  }
  const isManager = internal || role === 'admin' || role === 'manager';

  try {
    // ── get_settings ── (o front lê a tabela direto; aqui só para saber se há token)
    if (action === 'get_settings') {
      const s = await loadSettings(admin, tenantId);
      if (!s) return json({ success: true, data: null });
      const { provider_token, ...rest } = s as any;
      return json({ success: true, data: { ...rest, has_token: Boolean(provider_token) } });
    }

    // ── save_settings ──
    if (action === 'save_settings') {
      if (!isManager) return errResp('Apenas administradores e gerentes podem alterar a configuração fiscal', 403);
      const s = (body.settings ?? {}) as Record<string, unknown>;
      const allowed = ['enabled', 'environment', 'razao_social', 'inscricao_estadual', 'crt', 'endereco_logradouro', 'endereco_numero', 'endereco_bairro', 'endereco_municipio', 'endereco_uf', 'endereco_cep', 'codigo_municipio_ibge', 'natureza_operacao', 'ncm_padrao', 'cfop_padrao', 'csosn_padrao', 'cst_icms_padrao', 'icms_aliquota_padrao', 'origem_padrao', 'pis_cst_padrao', 'cofins_cst_padrao', 'cod_tributacao_padrao', 'serie', 'print_danfe', 'danfe_printer_id', 'emit_on_delivery', 'emit_on_counter', 'emit_on_table_close'];
      const row: Record<string, unknown> = { tenant_id: tenantId, updated_at: new Date().toISOString() };
      for (const k of allowed) if (s[k] !== undefined) row[k] = s[k] === '' ? null : s[k];
      if (typeof s.provider_token === 'string' && s.provider_token.trim()) row.provider_token = s.provider_token.trim();
      if (row.ncm_padrao == null) row.ncm_padrao = '21069090';
      if (row.cfop_padrao == null) row.cfop_padrao = 5102;
      if (row.csosn_padrao == null) row.csosn_padrao = '102';
      if (row.natureza_operacao == null) row.natureza_operacao = 'VENDA DE MERCADORIA';
      if (row.pis_cst_padrao == null) row.pis_cst_padrao = '49';
      if (row.cofins_cst_padrao == null) row.cofins_cst_padrao = '49';
      const { error } = await admin.from('fiscal_settings').upsert(row, { onConflict: 'tenant_id' });
      if (error) return errResp(error.message, 500);
      const { data: saved } = await admin.from('fiscal_settings').select('*').eq('tenant_id', tenantId).maybeSingle();
      if (saved) { (saved as any).has_token = Boolean((saved as any).provider_token); delete (saved as any).provider_token; }
      return json({ success: true, data: saved });
    }

    // ── test_connection ──
    if (action === 'test_connection') {
      const settings = await loadSettings(admin, tenantId);
      if (!settings?.provider_token) return errResp('Token do provedor não configurado');
      const res = await providerPost(settings.provider_token, 'ConsultarStatusSefaz', { ModeloDocumento: 65, TipoAmbiente: String(settings.environment ?? 2) });
      const d = res.data ?? {};
      const ok = res.ok && !providerHasError(d);
      return json({ success: ok, http: res.status, data: d, error: ok ? undefined : (providerErrorMessage(d) || res.raw?.slice(0, 300) || `HTTP ${res.status}`) });
    }

    // ── emit ──
    if (action === 'emit') {
      const sourceType = String(body.source_type ?? '');
      const sourceId = String(body.source_id ?? '');
      if (!['order', 'table_session'].includes(sourceType) || !sourceId) return errResp('source_type e source_id são obrigatórios');
      const settings = await loadSettings(admin, tenantId);
      // Gatilhos automáticos respeitam as chaves por canal; emissão manual (force) ignora.
      if (!body.force && settings) {
        if (sourceType === 'table_session' && !settings.emit_on_table_close) return json({ success: false, status: 'skipped', skipped: true, message: 'Emissão no fechamento de mesa desligada' });
        if (sourceType === 'order') {
          const { data: o } = await admin.from('orders').select('origin_type, table_session_id').eq('id', sourceId).maybeSingle();
          if (o?.table_session_id) return json({ success: false, status: 'skipped', skipped: true, message: 'Pedido de mesa: a nota sai no fechamento da sessão' });
          if (o?.origin_type === 'delivery' && !settings.emit_on_delivery) return json({ success: false, status: 'skipped', skipped: true, message: 'Emissão no delivery desligada' });
          if (o?.origin_type !== 'delivery' && !settings.emit_on_counter) return json({ success: false, status: 'skipped', skipped: true, message: 'Emissão no balcão desligada' });
        }
      }
      const r = await emitForSource(admin, tenantId, sourceType, sourceId, { force: Boolean(body.force), userId, trigger: body.trigger });
      return json(r, r.success || r.skipped ? 200 : 200);
    }

    // ── retry ──
    if (action === 'retry') {
      const { data: doc } = await admin.from('fiscal_documents').select('id, status, source_type, source_id').eq('id', body.document_id).eq('tenant_id', tenantId).maybeSingle();
      if (!doc) return errResp('Documento não encontrado', 404);
      if (doc.status === 'authorized') return json({ success: true, status: 'authorized', document_id: doc.id, message: 'Nota já autorizada' });
      if (doc.status === 'cancelled') return errResp('Nota cancelada não pode ser reemitida por aqui; emita uma nova pela venda');
      // Reabre como pending para o índice único aceitar a reemissão
      await admin.from('fiscal_documents').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', doc.id);
      const r = await emitForSource(admin, tenantId, doc.source_type, doc.source_id, { force: true, userId });
      return json(r);
    }

    // ── run_pending ──
    if (action === 'run_pending') {
      const { data: docs } = await admin.from('fiscal_documents').select('id, source_type, source_id, status')
        .eq('tenant_id', tenantId).in('status', ['pending', 'error']).order('created_at', { ascending: true }).limit(20);
      const results: unknown[] = [];
      for (const d of docs ?? []) {
        const r = await emitForSource(admin, tenantId, d.source_type, d.source_id, { force: true, userId });
        results.push({ document_id: d.id, ...r });
      }
      return json({ success: true, processed: results.length, results });
    }

    // ── cancel ──
    if (action === 'cancel') {
      if (!isManager) return errResp('Apenas administradores e gerentes podem cancelar notas', 403);
      const justificativa = String(body.justificativa ?? '').trim();
      if (justificativa.length < 15) return errResp('A justificativa precisa ter pelo menos 15 caracteres');
      const { data: doc } = await admin.from('fiscal_documents').select('*').eq('id', body.document_id).eq('tenant_id', tenantId).maybeSingle();
      if (!doc) return errResp('Documento não encontrado', 404);
      if (doc.status !== 'authorized') return errResp('Só notas autorizadas podem ser canceladas');
      const settings = await loadSettings(admin, tenantId);
      if (!settings?.provider_token) return errResp('Token do provedor não configurado');
      const res = await providerPost(settings.provider_token, 'CancelarNotaFiscal', {
        ChaveNF: doc.chave, Justificativa: justificativa, NumeroProtocolo: doc.protocolo, NumeroSequencial: 1,
        DataEvento: new Date().toISOString(),
      });
      const d = res.data ?? {};
      const code = Number(d.CodStatusRespostaSefaz ?? 0);
      const ok = res.ok && (code === 135 || code === 155 || code === 100 || d.Status === 1) && !(providerHasError(d) && code === 0);
      if (!ok) {
        const msg = providerErrorMessage(d) || d.DsMotivo || res.raw?.slice(0, 300) || `HTTP ${res.status}`;
        return json({ success: false, error: msg, data: d });
      }
      await admin.from('fiscal_documents').update({
        status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: justificativa,
        cancel_protocolo: d.NuProtocolo ? String(d.NuProtocolo) : null, updated_at: new Date().toISOString(),
      }).eq('id', doc.id);
      return json({ success: true, data: { protocolo: d.NuProtocolo, motivo: d.DsMotivo } });
    }

    // ── get_pdf ──
    if (action === 'get_pdf') {
      const { data: doc } = await admin.from('fiscal_documents').select('id, chave, status').eq('id', body.document_id).eq('tenant_id', tenantId).maybeSingle();
      if (!doc?.chave) return errResp('Documento sem chave de acesso', 404);
      const settings = await loadSettings(admin, tenantId);
      if (!settings?.provider_token) return errResp('Token do provedor não configurado');
      const res = await providerPost(settings.provider_token, 'ObterArquivoNotaFiscal', { ChaveNF: doc.chave, FileType: 2, TipoDocumentoFiscal: 1 });
      let b64: string | null = null;
      if (typeof res.data === 'string') b64 = res.data;
      else if (res.data?.Base64File) b64 = String(res.data.Base64File);
      else if (res.raw && !res.raw.trim().startsWith('{')) b64 = res.raw.replace(/^"|"$/g, '');
      if (!res.ok || !b64 || providerHasError(res.data)) return json({ success: false, error: providerErrorMessage(res.data) || `Não foi possível obter o PDF (HTTP ${res.status})` });
      return json({ success: true, pdf_base64: b64 });
    }

    // ── get_xml ──
    if (action === 'get_xml') {
      const { data: doc } = await admin.from('fiscal_documents').select('id, chave, xml').eq('id', body.document_id).eq('tenant_id', tenantId).maybeSingle();
      if (!doc) return errResp('Documento não encontrado', 404);
      return json({ success: true, xml: doc.xml, chave: doc.chave });
    }

    // ── print_danfe ──
    if (action === 'print_danfe') {
      const { data: doc } = await admin.from('fiscal_documents').select('*').eq('id', body.document_id).eq('tenant_id', tenantId).maybeSingle();
      if (!doc) return errResp('Documento não encontrado', 404);
      if (doc.status !== 'authorized' && doc.status !== 'cancelled') return errResp('Só notas autorizadas têm DANFE');
      const settings = await loadSettings(admin, tenantId);
      if (!settings) return errResp('Módulo fiscal não configurado');
      // Reconstrói o DANFE a partir do request salvo (itens/pagamentos) + dados autorizados.
      const rp = (doc.request_payload ?? {}) as any;
      const produtos = (rp.Produtos ?? []) as any[];
      const pagamentos = (rp.Pagamentos ?? []) as any[];
      const subtotal = round2(produtos.reduce((s, p) => s + Number(p.ValorTotal ?? 0), 0));
      const desconto = round2(produtos.reduce((s, p) => s + Number(p.ValorDesconto ?? 0), 0));
      const outras = round2(produtos.reduce((s, p) => s + Number(p.ValorOutrasDespesas ?? 0), 0));
      const danfe = {
        tipo: 'danfe_nfce', pedido: doc.order_number,
        itens: produtos.map((p) => ({ nome: p.NmProduto, quantidade: Number(p.Quantidade ?? 1), unitario: Number(p.ValorUnitario ?? 0), total: Number(p.ValorTotal ?? 0) })),
        subtotal, desconto, outras, total: Number(doc.total_amount ?? 0),
        pagamentos: pagamentos.map((p) => ({ nome: p.Descricao || TPAG_LABEL[String(p.FormaPagamento)] || 'Pagamento', valor: Number(p.VlPago ?? 0) })),
        troco: round2(pagamentos.reduce((s, p) => s + Number(p.VlTroco ?? 0), 0)),
        consumidor_cpf: doc.customer_cpf, consumidor_nome: doc.customer_name,
        chave: doc.chave, protocolo: doc.protocolo, numero: doc.numero, serie: doc.serie, emitted_at: doc.emitted_at,
        qr_code: doc.qr_code, url_chave: doc.url_chave, ambiente: doc.environment, cancelada: doc.status === 'cancelled',
      };
      await enqueueDanfe(admin, settings, tenantId, doc.id, danfe);
      return json({ success: true });
    }

    return errResp(`Ação inválida: ${action}`, 400);
  } catch (e) {
    log('ERROR', action, 'unhandled', { error: String(e) });
    return errResp((e as Error).message ?? 'Erro interno', 500);
  }
});
