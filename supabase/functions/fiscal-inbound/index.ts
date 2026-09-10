// fiscal-inbound — notas de ENTRADA contra o CNPJ da loja via Brasil NFe:
// NF-e (modelo 55, mercadoria) e NFS-e do padrão nacional (modelo 10, serviço tomado).
//
// Ações (POST JSON { action, tenant_id, ... }):
//   sync           { days? }                 busca as notas de entrada dos últimos N dias (padrão 30, máx 90)
//                                            e baixa/parseia o XML das que ainda não têm
//   fetch_xml      {}                        baixa os XMLs pendentes (continuação do sync)
//   sync_all       {}                        (interno/cron) roda o sync em todas as lojas com token
//   refetch_xml    { document_id }           tenta baixar o XML de novo (ex.: depois da ciência)
//   manifest       { document_id, tipo }     manifestação do destinatário (2 = ciência, 1 = confirmação)
//   import_purchase{ document_id, parcelas?, cost_center_id?, bank_account_id?, notes? }
//                                            lança como COMPRA (CMV) pelo purchase-write — as parcelas
//                                            do boleto viram contas a pagar reference_type='purchase'
//   import_bill    { document_id, parcelas?, dre_category_id?, cost_center_id?, category? }
//                                            lança como DESPESA (contas a pagar reference_type='nfe_entrada')
//   ignore         { document_id, reason? }  /  unignore { document_id }
//   get_xml        { document_id }           XML completo
//   get_pdf        { document_id }           DANFE (provedor)
//
// Autenticação: JWT do usuário (membership em user_tenants) OU chamada interna
// (cron / outra função) com header x-internal-key = FISCAL_INTERNAL_KEY.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

type Admin = SupabaseClient;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
};
const BRASILNFE_BASE = 'https://api.brasilnfe.com.br/services/fiscal';
const PROVIDER_TIMEOUT_MS = 60_000;
const XML_CONCURRENCY = 5;      // downloads de XML em paralelo
const XML_TIMEOUT_MS = 25_000;  // por XML
const XML_BUDGET_MS = 75_000;   // prazo da execução (a Edge corta em ~150s); o que sobrar a tela pede de novo (fetch_xml)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const errResp = (msg: string, status = 400) => json({ success: false, error: msg }, status);
function log(level: 'INFO' | 'WARN' | 'ERROR', action: string, msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'fiscal-inbound', level, action, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const num = (s: string | null) => (s == null || s === '' ? 0 : Number(String(s).replace(',', '.')) || 0);

// ── Provedor ─────────────────────────────────────────────────────────────────
async function providerPost(token: string, path: string, body: unknown, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<{ ok: boolean; status: number; data: any; raw: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BRASILNFE_BASE}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Token: token },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    const raw = await res.text();
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data, raw };
  } finally { clearTimeout(timer); }
}
function providerError(data: any, raw?: string): string {
  if (data && typeof data === 'object') {
    const parts: string[] = [];
    if (data.Error && String(data.Error).trim()) parts.push(String(data.Error).trim());
    if (Array.isArray(data.erros)) for (const e of data.erros) parts.push([e?.codigo, e?.descricao].filter(Boolean).join(' - '));
    if (parts.length) return parts.join(' | ');
  }
  return raw ? raw.slice(0, 300) : '';
}
function base64ToUtf8(b64: string): string {
  const bin = atob(b64.trim().replace(/^"|"$/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

// ── XML da NF-e (estrutura fixa do layout 4.00; sem namespaces com prefixo) ──
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
}
function blocks(xml: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
const unesc = (s: string | null) => (s == null ? null : s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));

interface Parsed {
  full: boolean;
  numero: number | null; serie: string | null; natureza: string | null; emittedAt: string | null;
  emitCnpj: string | null; emitNome: string | null; emitFantasia: string | null; emitIe: string | null;
  emitEndereco: string | null; emitCidade: string | null; emitUf: string | null; emitFone: string | null;
  valorTotal: number; valorIcms: number; frete: number; desconto: number;
  cfops: string | null;
  itens: Array<Record<string, unknown>>;
  parcelas: Array<{ numero: string; vencimento: string; valor: number }>;
  pagamento: Array<{ forma: string; valor: number }>;
}

function parseNFe(xml: string): Parsed {
  const inf = tag(xml, 'infNFe');
  const empty: Parsed = {
    full: false, numero: null, serie: null, natureza: null, emittedAt: null, emitCnpj: null, emitNome: null, emitFantasia: null,
    emitIe: null, emitEndereco: null, emitCidade: null, emitUf: null, emitFone: null, valorTotal: 0, valorIcms: 0, frete: 0,
    desconto: 0, cfops: null, itens: [], parcelas: [], pagamento: [],
  };
  if (!inf) {
    // Resumo (resNFe): vem antes da ciência da operação — sem itens nem cobrança.
    return { ...empty, emitCnpj: onlyDigits(tag(xml, 'CNPJ')) || null, emitNome: unesc(tag(xml, 'xNome')), valorTotal: num(tag(xml, 'vNF')), emittedAt: tag(xml, 'dhEmi') };
  }
  const ide = tag(inf, 'ide') ?? '';
  const emit = tag(inf, 'emit') ?? '';
  const ender = tag(emit, 'enderEmit') ?? '';
  const tot = tag(inf, 'ICMSTot') ?? '';
  const cobr = tag(inf, 'cobr') ?? '';
  const pag = tag(inf, 'pag') ?? '';

  const itens = blocks(inf, 'det').map((d) => {
    const prod = tag(d, 'prod') ?? '';
    return {
      codigo: unesc(tag(prod, 'cProd')),
      descricao: unesc(tag(prod, 'xProd')),
      ean: tag(prod, 'cEAN'),
      ncm: tag(prod, 'NCM'),
      cfop: tag(prod, 'CFOP'),
      unidade: tag(prod, 'uCom'),
      quantidade: num(tag(prod, 'qCom')),
      valor_unitario: num(tag(prod, 'vUnCom')),
      valor_total: num(tag(prod, 'vProd')),
      desconto: num(tag(prod, 'vDesc')),
      frete: num(tag(prod, 'vFrete')),
    };
  });
  const cfops = [...new Set(itens.map((i) => String(i.cfop ?? '')).filter(Boolean))].join(',') || null;

  const parcelas = blocks(cobr, 'dup').map((d, i) => ({
    numero: tag(d, 'nDup') ?? String(i + 1).padStart(3, '0'),
    vencimento: (tag(d, 'dVenc') ?? '').slice(0, 10),
    valor: round2(num(tag(d, 'vDup'))),
  })).filter((p) => p.vencimento && p.valor > 0);

  const pagamento = blocks(pag, 'detPag').map((d) => ({ forma: tag(d, 'tPag') ?? '99', valor: round2(num(tag(d, 'vPag'))) }));

  return {
    full: true,
    numero: Number(tag(ide, 'nNF')) || null,
    serie: tag(ide, 'serie'),
    natureza: unesc(tag(ide, 'natOp')),
    emittedAt: tag(ide, 'dhEmi') ?? tag(ide, 'dEmi'),
    emitCnpj: onlyDigits(tag(emit, 'CNPJ') ?? tag(emit, 'CPF')) || null,
    emitNome: unesc(tag(emit, 'xNome')),
    emitFantasia: unesc(tag(emit, 'xFant')),
    emitIe: tag(emit, 'IE'),
    emitEndereco: [unesc(tag(ender, 'xLgr')), tag(ender, 'nro'), unesc(tag(ender, 'xBairro'))].filter(Boolean).join(', ') || null,
    emitCidade: unesc(tag(ender, 'xMun')),
    emitUf: tag(ender, 'UF'),
    emitFone: tag(ender, 'fone'),
    valorTotal: round2(num(tag(tot, 'vNF'))),
    valorIcms: round2(num(tag(tot, 'vICMS'))),
    frete: round2(num(tag(tot, 'vFrete'))),
    desconto: round2(num(tag(tot, 'vDesc'))),
    cfops, itens, parcelas, pagamento,
  };
}

// ── NFS-e do padrão nacional (Sefin/ADN): NFSe > infNFSe (+ DPS > infDPS) ──
interface ParsedNFSe {
  numero: number | null; emitCnpj: string | null; emitNome: string | null; emitFone: string | null;
  emitEndereco: string | null; emitCidade: string | null; emitUf: string | null;
  servico: string | null; descricao: string | null; codigo: string | null; competencia: string | null;
  emittedAt: string | null; vServ: number; vLiq: number; vIss: number; vTotalRet: number; issRetido: boolean;
}
function parseNFSe(xml: string): ParsedNFSe {
  const inf = tag(xml, 'infNFSe') ?? '';
  const emit = tag(inf, 'emit') ?? '';
  const ender = tag(emit, 'enderNac') ?? '';
  const val = tag(inf, 'valores') ?? '';          // 1º <valores> = totais da NFS-e (vBC, vISSQN, vTotalRet, vLiq)
  const dps = tag(inf, 'infDPS') ?? '';
  const serv = tag(dps, 'serv') ?? '';
  const vServ = num(tag(tag(dps, 'vServPrest') ?? '', 'vServ'));
  const tpRet = tag(tag(dps, 'tribMun') ?? '', 'tpRetISSQN'); // 1 não retido · 2 retido pelo tomador · 3 pelo intermediário
  return {
    numero: Number(tag(inf, 'nNFSe')) || null,
    emitCnpj: onlyDigits(tag(emit, 'CNPJ') ?? tag(emit, 'CPF')) || null,
    emitNome: unesc(tag(emit, 'xNome')),
    emitFone: tag(emit, 'fone'),
    emitEndereco: [unesc(tag(ender, 'xLgr')), tag(ender, 'nro'), unesc(tag(ender, 'xBairro'))].filter(Boolean).join(', ') || null,
    emitCidade: unesc(tag(inf, 'xLocEmi')),
    emitUf: tag(ender, 'UF'),
    servico: unesc(tag(inf, 'xTribNac')),
    descricao: unesc(tag(serv, 'xDescServ')),
    codigo: tag(serv, 'cTribNac'),
    competencia: (tag(dps, 'dCompet') ?? '').slice(0, 10) || null,
    emittedAt: tag(dps, 'dhEmi') ?? tag(inf, 'dhProc'),
    vServ: round2(vServ),
    vLiq: round2(num(tag(val, 'vLiq')) || vServ),
    vIss: round2(num(tag(val, 'vISSQN'))),
    vTotalRet: round2(num(tag(val, 'vTotalRet'))),
    issRetido: tpRet === '2' || tpRet === '3',
  };
}
const isNFSeXml = (xml: string | null | undefined) => Boolean(xml && /<infNFSe[\s>]/.test(xml));

// ── Sincronização ────────────────────────────────────────────────────────────
async function loadToken(admin: Admin, tenantId: string): Promise<string | null> {
  const { data } = await admin.from('fiscal_settings').select('provider_token').eq('tenant_id', tenantId).maybeSingle();
  return (data?.provider_token as string) ?? null;
}

async function fetchXmlFor(admin: Admin, token: string, doc: { id: string; chave: string }): Promise<'full' | 'summary' | 'error'> {
  const res = await providerPost(token, 'ObterArquivoNotaFiscal', { ChaveNF: doc.chave, FileType: 1, TipoDocumentoFiscal: 0 }, XML_TIMEOUT_MS);
  let b64: string | null = null;
  if (typeof res.data === 'string') b64 = res.data;
  else if (res.data?.Base64File) b64 = String(res.data.Base64File);
  else if (res.raw && !res.raw.trim().startsWith('{')) b64 = res.raw;
  const now = new Date().toISOString();
  if (!res.ok || !b64) {
    const msg = providerError(res.data, res.raw) || `HTTP ${res.status}`;
    await admin.from('fiscal_inbound_documents').update({ xml_status: 'error', error_message: `XML: ${msg}`.slice(0, 500), updated_at: now }).eq('id', doc.id);
    return 'error';
  }
  let xml: string;
  try { xml = base64ToUtf8(b64); } catch (e) {
    await admin.from('fiscal_inbound_documents').update({ xml_status: 'error', error_message: `XML inválido: ${String(e)}`.slice(0, 500), updated_at: now }).eq('id', doc.id);
    return 'error';
  }
  if (isNFSeXml(xml)) {
    const q = parseNFSe(xml);
    await admin.from('fiscal_inbound_documents').update({
      xml, xml_status: 'full', error_message: null, updated_at: now, modelo: 10,
      numero: q.numero, emitente_cnpj: q.emitCnpj, emitente_nome: q.emitNome,
      natureza: q.servico, valor_total: q.vLiq, emitted_at: q.emittedAt,
      // Serviço vira 1 "item" com os valores da nota (bruto, ISS, retenções, líquido)
      itens: [{
        codigo: q.codigo, descricao: q.descricao ?? q.servico, quantidade: 1, unidade: 'SV',
        valor_unitario: q.vServ, valor_total: q.vServ, desconto: 0,
        competencia: q.competencia, v_iss: q.vIss, iss_retido: q.issRetido, v_retencoes: q.vTotalRet, v_liquido: q.vLiq,
      }],
      parcelas: [], pagamento: [],
    }).eq('id', doc.id);
    return 'full';
  }
  const p = parseNFe(xml);
  const upd: Record<string, unknown> = { xml, xml_status: p.full ? 'full' : 'summary', error_message: null, updated_at: now };
  if (p.full) {
    Object.assign(upd, {
      numero: p.numero, serie: p.serie, natureza: p.natureza, cfops: p.cfops,
      emitente_cnpj: p.emitCnpj, emitente_nome: p.emitNome, emitente_ie: p.emitIe,
      valor_total: p.valorTotal, valor_icms: p.valorIcms, frete: p.frete, desconto: p.desconto,
      emitted_at: p.emittedAt, itens: p.itens, parcelas: p.parcelas, pagamento: p.pagamento,
    });
  }
  await admin.from('fiscal_inbound_documents').update(upd).eq('id', doc.id);
  return p.full ? 'full' : 'summary';
}

// Baixa XML das que ainda não têm (novas, resumos que podem ter virado completos, erros), em paralelo e com prazo.
async function fetchPendingXml(admin: Admin, token: string, tenantId: string, deadline: number) {
  const stats = { full: 0, summary: 0, error: 0 };
  const { data: fila } = await admin.from('fiscal_inbound_documents').select('id, chave')
    .eq('tenant_id', tenantId).in('xml_status', ['pending', 'summary', 'error']).neq('status', 'ignored')
    .order('xml_status', { ascending: true }).order('emitted_at', { ascending: false }).limit(300);
  const queue = [...(fila ?? [])] as { id: string; chave: string }[];
  const worker = async () => {
    while (queue.length && Date.now() < deadline) {
      const d = queue.shift()!;
      try { stats[await fetchXmlFor(admin, token, d)]++; }
      catch (e) { stats.error++; log('WARN', 'xml', 'download falhou', { chave: d.chave, error: String(e) }); }
    }
  };
  await Promise.all(Array.from({ length: XML_CONCURRENCY }, () => worker()));
  const { count } = await admin.from('fiscal_inbound_documents').select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('xml_status', 'pending').neq('status', 'ignored');
  return { stats, pendentes: count ?? 0 };
}

async function syncTenant(admin: Admin, tenantId: string, days: number, budgetMs = XML_BUDGET_MS) {
  const deadline = Date.now() + budgetMs;
  const token = await loadToken(admin, tenantId);
  if (!token) return { tenant_id: tenantId, skipped: 'sem token do provedor' };
  const fim = new Date();
  const ini = new Date(fim.getTime() - Math.min(90, Math.max(1, days)) * 86_400_000);
  const res = await providerPost(token, 'ObterNotasFiscais', {
    TipoAmbiente: 1, TipoDocumentoFiscal: 0, TipoParticipacao: 0, DtInicio: ymd(ini), DtFim: ymd(fim),
  });
  const now = new Date().toISOString();
  if (!res.ok || !Array.isArray(res.data?.Notas)) {
    const msg = providerError(res.data, res.raw) || `HTTP ${res.status}`;
    await admin.from('fiscal_settings').update({ inbound_last_sync_at: now, inbound_last_error: msg.slice(0, 500) }).eq('tenant_id', tenantId);
    log('WARN', 'sync', 'ObterNotasFiscais falhou', { tenantId, msg });
    return { tenant_id: tenantId, error: msg };
  }
  // Resumo por modelo (55 NF-e, 10 NFS-e, 57 CT-e...) antes de filtrar — diagnóstico.
  const todos = res.data.Notas as any[];
  const modelos: Record<string, number> = {};
  for (const n of todos) { const k = String(n.ModeloDocumento ?? '?'); modelos[k] = (modelos[k] ?? 0) + 1; }
  const outrosModelos = todos.filter((n) => Number(n.ModeloDocumento) !== 55).slice(0, 10).map((n) => ({
    modelo: n.ModeloDocumento, emissor: n.NomeEmissor, cnpj: n.CnpjEmissor, valor: n.Valor, emissao: n.DtEmissao, numero: n.Numero,
  }));
  // NF-e (55, chave 44) = mercadoria · NFS-e (10, chave 50) = serviço tomado. CT-e e demais ficam de fora.
  const notas = todos.filter((n) => {
    const m = Number(n.ModeloDocumento); const len = onlyDigits(n.Chave).length;
    return (m === 55 && len === 44) || (m === 10 && len === 50);
  });
  // Grava em lote: 1ª carga de uma loja pode trazer centenas de notas (1 a 1 estourava o tempo da Edge).
  const existentes = new Map<string, { id: string; sefaz_status: number | null }>();
  const chaves = [...new Set(notas.map((n) => onlyDigits(n.Chave)))];
  for (let i = 0; i < chaves.length; i += 200) {
    const { data } = await admin.from('fiscal_inbound_documents').select('id, chave, sefaz_status')
      .eq('tenant_id', tenantId).in('chave', chaves.slice(i, i + 200));
    for (const r of data ?? []) existentes.set(String(r.chave), { id: String(r.id), sefaz_status: (r.sefaz_status as number) ?? null });
  }
  const novasRows: Record<string, unknown>[] = [];
  const mudaram: { id: string; st: number | null }[] = [];
  const vistas = new Set<string>();
  for (const n of notas) {
    const chave = onlyDigits(n.Chave);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const st = Number(n.Status) || null;
    const ex = existentes.get(chave);
    // Existente: atualiza só a situação (ex.: fornecedor cancelou a nota depois)
    if (ex) { if (ex.sefaz_status !== st) mudaram.push({ id: ex.id, st }); continue; }
    novasRows.push({
      tenant_id: tenantId, chave, modelo: Number(n.ModeloDocumento) || 55,
      numero: Number(n.Numero) || null, serie: n.Serie != null && n.Serie !== 'SEM' ? String(n.Serie) : null,
      emitente_cnpj: onlyDigits(n.CnpjEmissor) || null, emitente_nome: n.NomeEmissor ?? null, emitente_ie: n.IeEmissor ?? null,
      cfops: n.Cfops ?? null, valor_total: round2(Number(n.Valor ?? 0)), valor_icms: round2(Number(n.ValorIcms ?? 0)),
      emitted_at: n.DtEmissao ?? null, received_at: n.DtRecebimento ?? null, sefaz_status: st,
      updated_at: now,
    });
  }
  let novas = 0;
  for (let i = 0; i < novasRows.length; i += 100) {
    const lote = novasRows.slice(i, i + 100);
    const { error } = await admin.from('fiscal_inbound_documents').insert(lote);
    if (!error) { novas += lote.length; continue; }
    // Lote recusado (ex.: corrida com outra execução): cai para 1 a 1 e ignora duplicadas
    for (const row of lote) {
      const { error: e1 } = await admin.from('fiscal_inbound_documents').insert(row);
      if (!e1) novas++;
      else if (e1.code !== '23505') log('WARN', 'sync', 'insert falhou', { chave: row.chave, error: e1.message });
    }
  }
  for (const m of mudaram) {
    await admin.from('fiscal_inbound_documents').update({ sefaz_status: m.st, updated_at: now }).eq('id', m.id);
  }
  const { stats: xmlStats, pendentes } = await fetchPendingXml(admin, token, tenantId, deadline);

  await admin.from('fiscal_settings').update({ inbound_last_sync_at: now, inbound_last_error: null }).eq('tenant_id', tenantId);
  log('INFO', 'sync', 'ok', { tenantId, encontradas: notas.length, novas, modelos, pendentes, ...xmlStats });
  return { tenant_id: tenantId, encontradas: notas.length, novas, xml: xmlStats, pendentes, modelos, outros_modelos: outrosModelos };
}

// ── Importação ───────────────────────────────────────────────────────────────
interface Parcela { numero?: string; vencimento: string; valor: number }

function normalizeParcelas(doc: any, override: unknown): Parcela[] {
  const src = Array.isArray(override) && override.length > 0 ? override : (doc.parcelas ?? []);
  const out = (src as any[]).map((p, i) => ({
    numero: String(p.numero ?? i + 1),
    vencimento: String(p.vencimento ?? '').slice(0, 10),
    valor: round2(Number(p.valor ?? 0)),
  })).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.vencimento) && p.valor > 0);
  if (out.length > 0) return out;
  // Nota sem duplicata (à vista, cartão, ou fornecedor não informou): 1 parcela no dia da emissão.
  const venc = String(doc.emitted_at ?? new Date().toISOString()).slice(0, 10);
  return [{ numero: '1', vencimento: venc, valor: round2(Number(doc.valor_total ?? 0)) }];
}

/** Acha o fornecedor pelo CNPJ (ou nome) e completa CNPJ/razão social; cria se não existir. */
async function upsertSupplier(admin: Admin, tenantId: string, doc: any): Promise<{ id: string; name: string } | null> {
  const cnpj = onlyDigits(doc.emitente_cnpj);
  const razao = String(doc.emitente_nome ?? '').trim();
  let parsed: Pick<Parsed, 'emitFantasia' | 'emitFone' | 'emitEndereco' | 'emitCidade' | 'emitUf'> | null = null;
  if (doc.xml) {
    try {
      if (isNFSeXml(doc.xml)) { const q = parseNFSe(doc.xml); parsed = { emitFantasia: null, emitFone: q.emitFone, emitEndereco: q.emitEndereco, emitCidade: q.emitCidade, emitUf: q.emitUf }; }
      else parsed = parseNFe(doc.xml);
    } catch { parsed = null; }
  }
  const fantasia = parsed?.emitFantasia?.trim() || '';
  const nomeExibicao = (fantasia || razao || `Fornecedor ${cnpj}`).slice(0, 120);

  if (cnpj) {
    const { data: all } = await admin.from('fin_suppliers').select('id, name, cnpj, legal_name').eq('tenant_id', tenantId).is('deleted_at', null);
    const byCnpj = (all ?? []).find((s: any) => onlyDigits(s.cnpj) === cnpj);
    if (byCnpj) {
      if (!byCnpj.legal_name && razao) await admin.from('fin_suppliers').update({ legal_name: razao, updated_at: new Date().toISOString() }).eq('id', byCnpj.id);
      return { id: byCnpj.id, name: byCnpj.name };
    }
    // Mesmo nome já cadastrado sem CNPJ (lançado à mão antes): completa em vez de duplicar
    const byName = (all ?? []).find((s: any) => !s.cnpj && [nomeExibicao, razao].some((n) => n && String(s.name).trim().toLowerCase() === n.toLowerCase()));
    if (byName) {
      await admin.from('fin_suppliers').update({ cnpj, legal_name: razao || null, updated_at: new Date().toISOString() }).eq('id', byName.id);
      return { id: byName.id, name: byName.name };
    }
  }
  const { data: created, error } = await admin.from('fin_suppliers').insert({
    tenant_id: tenantId, name: nomeExibicao, legal_name: razao || null, cnpj: cnpj || null, is_active: true,
    phone: parsed?.emitFone ?? null,
    address: [parsed?.emitEndereco, parsed?.emitCidade && parsed?.emitUf ? `${parsed.emitCidade}/${parsed.emitUf}` : null].filter(Boolean).join(' - ') || null,
  }).select('id, name').single();
  if (error) { log('ERROR', 'supplier', 'criar fornecedor falhou', { error: error.message }); return null; }
  return created;
}

// ── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || serviceRoleKey.length < 40) return errResp('Server misconfiguration', 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const internalKey = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
  const internal = internalKey.length >= 20 && (req.headers.get('x-internal-key') ?? '') === internalKey;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return errResp('Invalid JSON body'); }
  const action = String(body.action ?? '');

  try {
    // ── Instala os segredos do cron no Vault (a chave nunca passa por SQL/transcrição) ──
    if (action === 'setup_cron') {
      if (!internal) return errResp('Unauthorized', 401);
      const { error } = await admin.rpc('fn_set_fiscal_cron_secrets', { p_internal_key: internalKey, p_anon_key: Deno.env.get('SUPABASE_ANON_KEY') ?? '' });
      if (error) return errResp(`setup_cron: ${error.message}`, 500);
      return json({ success: true });
    }


    // ── Cron: todas as lojas com token e sync automático ligado ──
    if (action === 'sync_all') {
      if (!internal) return errResp('Unauthorized', 401);
      const { data: lojas } = await admin.from('fiscal_settings').select('tenant_id').not('provider_token', 'is', null).eq('inbound_auto_sync', true);
      const results = [];
      for (const l of lojas ?? []) results.push(await syncTenant(admin, l.tenant_id, Number(body.days ?? 7), 40_000));
      return json({ success: true, results });
    }

    // ── Demais ações: usuário da loja (ou interno com tenant_id) ──
    const requested: string | null = body.tenant_id ?? body.active_tenant_id ?? null;
    let tenantId: string;
    let userId: string | null = null;
    let role = 'admin';
    if (internal) {
      if (!requested) return errResp('tenant_id required');
      tenantId = requested;
    } else {
      if (!token) return errResp('Unauthorized', 401);
      const { data: u, error: uErr } = await admin.auth.getUser(token);
      if (uErr || !u?.user) return errResp('Unauthorized', 401);
      userId = u.user.id;
      const { data: rows } = await admin.from('user_tenants').select('tenant_id, role').eq('user_id', userId);
      const match = requested ? (rows ?? []).find((r) => r.tenant_id === requested) : ((rows ?? []).length === 1 ? rows![0] : null);
      if (!match) return errResp('Sem acesso a esta loja', 403);
      tenantId = match.tenant_id;
      role = String(match.role ?? '');
    }
    const isManager = internal || role === 'admin' || role === 'manager';

    if (action === 'sync') {
      const r = await syncTenant(admin, tenantId, Number(body.days ?? 30));
      return json({ success: !('error' in r), ...r });
    }

    // Continua baixando os XMLs que ficaram para trás (a tela chama em sequência até zerar)
    if (action === 'fetch_xml') {
      const tok = await loadToken(admin, tenantId);
      if (!tok) return errResp('Loja sem token do provedor');
      const r = await fetchPendingXml(admin, tok, tenantId, Date.now() + XML_BUDGET_MS);
      return json({ success: true, xml: r.stats, pendentes: r.pendentes });
    }

    // A partir daqui, sempre sobre um documento da loja
    const docId = String(body.document_id ?? '');
    const { data: doc } = docId
      ? await admin.from('fiscal_inbound_documents').select('*').eq('id', docId).eq('tenant_id', tenantId).maybeSingle()
      : { data: null };
    if (!doc) return errResp('Nota não encontrada', 404);

    if (action === 'get_xml') return json({ success: true, xml: doc.xml, chave: doc.chave });

    if (action === 'get_pdf') {
      const t = await loadToken(admin, tenantId);
      if (!t) return errResp('Token do provedor não configurado');
      const res = await providerPost(t, 'ObterArquivoNotaFiscal', { ChaveNF: doc.chave, FileType: 2, TipoDocumentoFiscal: 0 });
      let b64: string | null = null;
      if (typeof res.data === 'string') b64 = res.data;
      else if (res.data?.Base64File) b64 = String(res.data.Base64File);
      else if (res.raw && !res.raw.trim().startsWith('{')) b64 = res.raw.replace(/^"|"$/g, '');
      if (!res.ok || !b64) return json({ success: false, error: providerError(res.data, res.raw) || `HTTP ${res.status}` });
      let contentType = 'application/pdf';
      try { if (!atob(b64.slice(0, 16)).startsWith('%PDF')) contentType = 'text/html'; } catch { /* mantém */ }
      return json({ success: true, pdf_base64: b64, content_type: contentType });
    }

    if (action === 'refetch_xml') {
      const t = await loadToken(admin, tenantId);
      if (!t) return errResp('Token do provedor não configurado');
      const st = await fetchXmlFor(admin, t, doc);
      return json({ success: st === 'full', xml_status: st });
    }

    if (action === 'manifest') {
      if (!isManager) return errResp('Apenas administradores e gerentes', 403);
      const tipo = Number(body.tipo ?? 2); // 2 = ciência (libera o XML completo)
      if (![1, 2, 3, 4].includes(tipo)) return errResp('Tipo de manifestação inválido');
      const t = await loadToken(admin, tenantId);
      if (!t) return errResp('Token do provedor não configurado');
      const payload: Record<string, unknown> = { TipoAmbiente: 1, Chave: doc.chave, TipoManifestacao: tipo };
      if (tipo === 4) {
        const j = String(body.justificativa ?? '').trim();
        if (j.length < 15) return errResp('Justificativa com pelo menos 15 caracteres');
        payload.Justificativa = j;
      }
      const res = await providerPost(t, 'ManifestarNotaFiscal', payload);
      const d = res.data ?? {};
      const code = Number(d.CodStatusRespostaSefaz ?? 0);
      // 135 = evento registrado; 573 = duplicidade (já manifestada) também serve
      const ok = res.ok && (code === 135 || code === 136 || code === 573 || Number(d.Status) === 1);
      const labels: Record<number, string> = { 1: 'confirmacao', 2: 'ciencia', 3: 'desconhecimento', 4: 'nao_realizada' };
      await admin.from('fiscal_inbound_documents').update({
        manifest_status: ok ? labels[tipo] : 'error', manifest_at: new Date().toISOString(),
        error_message: ok ? null : `Manifestação: ${providerError(d, res.raw) || d.DsMotivo || res.status}`.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', doc.id);
      // Depois da ciência a SEFAZ libera o XML completo (pode levar alguns minutos)
      if (ok && tipo === 2) await fetchXmlFor(admin, t, doc).catch(() => 'error');
      return json({ success: ok, code, motivo: d.DsMotivo ?? providerError(d, res.raw) });
    }

    if (action === 'ignore') {
      await admin.from('fiscal_inbound_documents').update({ status: 'ignored', ignore_reason: String(body.reason ?? '').slice(0, 200) || null, updated_at: new Date().toISOString() }).eq('id', doc.id);
      return json({ success: true });
    }
    if (action === 'unignore') {
      if (doc.status !== 'ignored') return errResp('A nota não está ignorada');
      await admin.from('fiscal_inbound_documents').update({ status: 'new', ignore_reason: null, updated_at: new Date().toISOString() }).eq('id', doc.id);
      return json({ success: true });
    }

    // ── Importar ──
    if (action === 'import_purchase' || action === 'import_bill') {
      if (!isManager) return errResp('Apenas administradores e gerentes podem lançar', 403);
      if (doc.status === 'imported') return errResp('Esta nota já foi lançada');
      if (Number(doc.sefaz_status) === 2) return errResp('A nota foi CANCELADA pelo fornecedor na SEFAZ — não lance');
      if (action === 'import_purchase' && Number(doc.modelo) === 10) return errResp('NFS-e é serviço, não mercadoria: lance como despesa');
      const parcelas = normalizeParcelas(doc, body.parcelas);
      const soma = round2(parcelas.reduce((s, p) => s + p.valor, 0));
      const supplier = await upsertSupplier(admin, tenantId, doc);
      if (!supplier) return errResp('Não foi possível cadastrar o fornecedor', 500);
      const numeroNf = doc.numero ? String(doc.numero) : null;
      const notes = [String(body.notes ?? '').trim(), `NF-e de entrada — chave ${doc.chave}`].filter(Boolean).join(' · ');
      const now = new Date().toISOString();

      if (action === 'import_purchase') {
        // Pelo purchase-write (fonte única da regra de compra: fornecedor, parcelas com
        // reference_type='purchase' → CMV). Itens sem insumo vinculado NÃO mexem no estoque.
        const itens = ((doc.itens ?? []) as any[]).map((it) => ({
          description: [it.descricao, it.codigo ? `(${it.codigo})` : null].filter(Boolean).join(' ').slice(0, 250),
          quantity: Number(it.quantidade ?? 0) || 1,
          unit_price: Number(it.valor_unitario ?? 0),
          discount_per_unit: Number(it.quantidade) > 0 ? round2(Number(it.desconto ?? 0) / Number(it.quantidade)) : 0,
          unit_label: it.unidade ?? null,
          units_per_package: 1,
          cost_center_id: body.cost_center_id ?? null,
        }));
        // O purchase-write recalcula o total como Σ itens líquidos + frete. O vNF da nota também
        // soma ICMS-ST, IPI, seguro e outras despesas — sem isso a compra (e a conta a pagar de
        // 1 parcela) sairia menor que o boleto. A diferença entra como uma linha própria.
        const frete = Number(doc.frete ?? 0) || 0;
        const itensLiquido = itens.reduce((s, it) => s + Math.round(it.quantity * Math.max(0, it.unit_price - it.discount_per_unit) * 100) / 100, 0);
        const acrescimos = round2(Number(doc.valor_total ?? 0) - itensLiquido - frete);
        if (itens.length > 0 && acrescimos >= 0.01) {
          itens.push({
            description: 'Acréscimos da nota (ICMS-ST, IPI, seguro, outras despesas)',
            quantity: 1, unit_price: acrescimos, discount_per_unit: 0, unit_label: null, units_per_package: 1,
            cost_center_id: body.cost_center_id ?? null,
          });
        } else if (itens.length > 0 && acrescimos <= -0.01) {
          // Desconto no total da nota que não veio rateado nos itens: aplica no maior item
          const maior = itens.reduce((a, b) => (b.quantity * b.unit_price > a.quantity * a.unit_price ? b : a));
          maior.discount_per_unit = round2(maior.discount_per_unit + (-acrescimos) / (maior.quantity || 1));
        }

        // Nota já paga (dinheiro/cartão/PIX na entrega): entra como compra paga — o purchase-write
        // registra a saída no fluxo de caixa. Sem boleto em aberto, sem conta a pagar.
        const jaPaga = body.pago === true;
        const purchasePayload: Record<string, unknown> = {
          supplier: supplier.name,
          invoice_number: numeroNf,
          purchase_date: String(doc.emitted_at ?? now).slice(0, 10),
          payment_method: jaPaga ? String(body.payment_method ?? 'Dinheiro') : 'Boleto',
          payment_status: jaPaga ? 'paid' : 'pending',
          cost_center_id: body.cost_center_id ?? null,
          bank_account_id: body.bank_account_id ?? null,
          freight_amount: frete,
          notes,
          items: itens,
        };
        if (!jaPaga) {
          if (parcelas.length >= 2) purchasePayload.custom_installments = parcelas.map((p) => ({ due_date: p.vencimento, amount: p.valor }));
          else purchasePayload.due_date = parcelas[0].vencimento;
        }
        // Nota sem itens legíveis: total vem da nota
        if (itens.length === 0) purchasePayload.total_amount = Number(doc.valor_total ?? soma);

        // Chama o purchase-write com o JWT do próprio usuário (ele valida a loja e grava created_by)
        if (!token || internal) return errResp('Lançamento de compra precisa de um usuário logado');
        const r = await fetch(`${supabaseUrl}/functions/v1/purchase-write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' },
          body: JSON.stringify({ action: 'create_purchase', tenant_id: tenantId, payload: purchasePayload }),
        });
        const txt = await r.text();
        let out: any = null; try { out = JSON.parse(txt); } catch { out = null; }
        const purchase = out?.data ?? out?.result?.data ?? null;
        if (!r.ok || !purchase?.id) {
          const msg = typeof out?.error === 'string' ? out.error : txt.slice(0, 300);
          log('ERROR', 'import_purchase', 'purchase-write falhou', { http: r.status, msg });
          return errResp(`Não foi possível lançar a compra: ${msg}`, 500);
        }
        const { data: bills } = await admin.from('fin_accounts_payable').select('id').eq('tenant_id', tenantId).eq('reference_id', purchase.id);
        await admin.from('fiscal_inbound_documents').update({
          status: 'imported', import_type: 'purchase', purchase_id: purchase.id, supplier_id: supplier.id,
          payable_ids: (bills ?? []).map((b: any) => b.id), imported_at: now, imported_by: userId, error_message: null, updated_at: now,
        }).eq('id', doc.id);
        return json({ success: true, purchase_id: purchase.id, parcelas: (bills ?? []).length, supplier: supplier.name });
      }

      // import_bill: despesa que não é mercadoria (equipamento, uso e consumo...) — entra na DRE pela categoria
      const categoria = String(body.category ?? 'Outros');
      const n = parcelas.length;
      const ids: string[] = [];
      let parentId: string | null = null;
      for (let i = 0; i < n; i++) {
        const p = parcelas[i];
        const { data: bill, error } = await admin.from('fin_accounts_payable').insert({
          tenant_id: tenantId, supplier: supplier.name,
          description: `${supplier.name}${numeroNf ? ` NF ${numeroNf}` : ''}${n > 1 ? ` (${i + 1}/${n})` : ''}`,
          category: categoria, dre_category_id: body.dre_category_id ?? null, cost_center_id: body.cost_center_id ?? null,
          amount: p.valor, due_date: p.vencimento, status: 'pending', is_recurring: false,
          installments: n, installment_number: i + 1, parent_id: parentId, notes,
          reference_id: doc.id, reference_type: 'nfe_entrada',
        }).select('id').single();
        if (error) {
          // desfaz o que já entrou para não deixar metade das parcelas
          if (ids.length) await admin.from('fin_accounts_payable').delete().in('id', ids);
          return errResp(`Falha ao lançar a parcela ${i + 1}: ${error.message}`, 500);
        }
        ids.push(bill.id);
        if (i === 0) parentId = bill.id;
      }
      await admin.from('fiscal_inbound_documents').update({
        status: 'imported', import_type: 'bill', supplier_id: supplier.id, payable_ids: ids,
        imported_at: now, imported_by: userId, error_message: null, updated_at: now,
      }).eq('id', doc.id);
      return json({ success: true, parcelas: ids.length, supplier: supplier.name });
    }

    return errResp(`Ação inválida: ${action}`);
  } catch (e) {
    log('ERROR', action, 'unhandled', { error: String(e) });
    return errResp((e as Error).message ?? 'Erro interno', 500);
  }
});
