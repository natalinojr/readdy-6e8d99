// contas-email — a caixa de e-mail que vira Contas a Pagar.
//
// Por que existe: nota fiscal já entra sozinha pela SEFAZ, extrato pelo Inter, venda pela
// maquininha. O boleto que chega por e-mail era o único documento que só existia na caixa de
// alguém — em 2026-09-22 um condomínio de R$ 2.181,55 venceu sem estar no sistema, descoberto
// por acaso no app do banco. Esta função fecha esse buraco.
//
// COMO O E-MAIL CHEGA (decisão do dono, 2026-09-22): por ENCAMINHAMENTO, não pela API do
// Gmail. O Gmail da loja é o endereço bonito que se dá aos fornecedores e encaminha sozinho
// para um serviço de recebimento, que entrega aqui por webhook. O caminho pela API do Google
// foi descartado porque app OAuth em "Testing" tem o refresh_token expirado em 7 DIAS, e
// publicar exige verificação (gmail.readonly é escopo restrito) — só não morde com Google
// Workspace, que a loja não tem. Uma integração que morre calada em uma semana é o oposto do
// que este módulo existe para resolver.
//
// Ações com JWT (POST JSON { action, tenant_id, ... }):
//   get_config     {}                          estado + a URL do webhook para colar no serviço
//   save_config    { inbound_address? }        gera o segredo na primeira vez
//   rotate_token   {}                          troca o segredo (invalida a config no serviço)
//   list_messages  { limit? }                  o que chegou e o que virou conta
//   disconnect     {}
//
// Webhook SEM JWT:  POST /contas-email?inbound=<segredo>
//   Aceita o formato JSON dos serviços de recebimento mais comuns (Postmark e CloudMailin) e
//   um formato simples. O segredo na URL é o que impede alguém de empurrar "boleto" para
//   dentro do financeiro — é o mesmo desenho do webhook da maquininha.
// deno-lint-ignore-file no-explicit-any

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { isFinanceiroRole } from '../_shared/tenant-auth.ts';
import {
  lerBoletos, lancarBoleto, motivoPendencia, resumoBoleto, onlyDigits,
  type Anexo as AnexoLido, type BoletoLido, type Fornecedor,
} from './leitura.ts';

type Admin = SupabaseClient;
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const BUCKET = 'fin-mail-anexos';
const MAX_ANEXO_BYTES = 15 * 1024 * 1024;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
};
const MAX_BODY_CHARS = 200_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const errResp = (msg: string, status = 400) => json({ success: false, error: msg }, status);
function log(level: 'INFO' | 'WARN' | 'ERROR', action: string, msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'contas-email', level, action, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}

function newToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const webhookUrl = (token: string) =>
  `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/contas-email?inbound=${token}`;

// ── Normalização do e-mail recebido ─────────────────────────────────────────
// Cada serviço entrega num formato. Em vez de amarrar a loja a um fornecedor, aceitamos os
// formatos comuns e reduzimos todos à mesma forma. Attachment vem em base64 no JSON.
interface Anexo { nome: string; tipo: string; base64: string }
interface EmailRecebido {
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  receivedAt: string | null;
  texto: string;
  anexos: Anexo[];
  formato: string;
}

const str = (v: unknown) => (v == null ? '' : String(v));
/** "Fulano <a@b.com>" → a@b.com */
function soEmail(v: unknown): string {
  const s = str(v);
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}
function soNome(v: unknown): string | null {
  const s = str(v).trim();
  const m = s.match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : null;
}

function normalizar(body: any): EmailRecebido | null {
  // Postmark: campos capitalizados, anexos em Attachments[].Content (base64)
  if (body?.MessageID || body?.FromFull || Array.isArray(body?.Attachments)) {
    return {
      messageId: str(body.MessageID) || `pm-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      fromEmail: soEmail(body?.FromFull?.Email ?? body?.From),
      fromName: str(body?.FromFull?.Name) || soNome(body?.From),
      subject: str(body.Subject),
      receivedAt: str(body.Date) || null,
      texto: `${str(body.TextBody)}\n${str(body.StrippedTextReply ?? '')}`.slice(0, MAX_BODY_CHARS),
      anexos: (body.Attachments ?? []).map((a: any) => ({
        nome: str(a?.Name), tipo: str(a?.ContentType), base64: str(a?.Content),
      })),
      formato: 'postmark',
    };
  }
  // CloudMailin (JSON normalizado): headers em headers{}, anexos em attachments[]
  if (body?.headers || body?.envelope) {
    const h = body.headers ?? {};
    return {
      messageId: str(h.message_id ?? h['Message-ID']) || `cm-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      // O From do CABEÇALHO, não o do envelope: no encaminhamento automático do Gmail o envelope
      // é "loja+caf_=...@gmail.com" e todo e-mail parecia vir da própria loja (2026-09-25).
      fromEmail: soEmail(h.from || body?.envelope?.from),
      fromName: soNome(h.from),
      subject: str(h.subject),
      receivedAt: str(h.date) || null,
      // e-mail só em HTML (o do Gmail é assim): sem tirar as tags o corpo vem vazio e
      // nem o código nem o boleto são encontrados
      texto: (str(body.plain ?? body.text) || str(body.html).replace(/<[^>]*>/g, ' '))
        .slice(0, MAX_BODY_CHARS),
      anexos: (body.attachments ?? []).map((a: any) => ({
        nome: str(a?.file_name ?? a?.name), tipo: str(a?.content_type), base64: str(a?.content),
      })),
      formato: 'cloudmailin',
    };
  }
  // Formato simples (teste manual, ou serviço que a gente configure à mão)
  if (body?.from || body?.subject) {
    return {
      messageId: str(body.message_id) || `sm-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      fromEmail: soEmail(body.from),
      fromName: soNome(body.from),
      subject: str(body.subject),
      receivedAt: str(body.date) || null,
      texto: str(body.text ?? body.body ?? '').slice(0, MAX_BODY_CHARS),
      anexos: (body.attachments ?? []).map((a: any) => ({
        nome: str(a?.name), tipo: str(a?.content_type ?? a?.type), base64: str(a?.content ?? a?.base64),
      })),
      formato: 'simples',
    };
  }
  return null;
}

// ── Webhook: e-mail chegou ──────────────────────────────────────────────────
async function receber(admin: Admin, token: string, body: any) {
  const { data: cfg } = await admin.from('fin_mail_config')
    .select('tenant_id, is_active').eq('inbound_token', token).maybeSingle();
  // Resposta igual para segredo errado e caixa desligada: não confirma para quem tentar
  // adivinhar que o endereço existe.
  if (!cfg?.tenant_id || cfg.is_active !== true) {
    log('WARN', 'webhook', 'segredo inválido ou caixa desligada');
    return json({ success: false }, 404);
  }
  const tenantId = String(cfg.tenant_id);

  const email = normalizar(body);
  if (!email) {
    log('WARN', 'webhook', 'formato não reconhecido', { tenantId, chaves: Object.keys(body ?? {}).slice(0, 12) });
    return json({ success: false, error: 'formato não reconhecido' }, 422);
  }

  // ── Confirmação de encaminhamento do Gmail ────────────────────────────────
  // Ao cadastrar um endereço de encaminhamento, o Gmail manda um código para ELE — e esse
  // e-mail cai aqui, não numa caixa que o dono consiga abrir. Sem isto, a pessoa trava no
  // meio da configuração sem entender por quê. Então reconhecemos e mostramos o código.
  if (/forwarding-noreply@google\.com/i.test(email.fromEmail)) {
    const corpo = `${email.subject}
${email.texto}`;
    // O codigo SO vale quando vem rotulado. Sem isso, um numero qualquer do corpo vira
    // "codigo": em 2026-09-22 o id de um link de ajuda do Google (answer=184973) foi
    // apresentado como codigo de confirmacao. Numero solto no texto nao e codigo.
    const codigo = corpo.match(/c[o\u00f3]digo[^\n]{0,40}?(?<!\d)(\d{6,12})(?!\d)/i)?.[1] ?? null;
    const link = corpo.match(/https:\/\/mail(-settings)?\.google\.com[^\s"'<>]*/i)?.[0] ?? null;
    await admin.from('fin_mail_messages').upsert({
      tenant_id: tenantId, message_id: email.messageId,
      from_email: email.fromEmail, from_name: 'Gmail', subject: email.subject.slice(0, 500) || null,
      received_at: new Date().toISOString(), status: 'ignored',
      reason: codigo
        ? `Código de confirmação do Gmail: ${codigo} — digite no Gmail para liberar o encaminhamento.`
        : link
          ? `Confirmação de encaminhamento do Gmail: abra este link para autorizar — ${link}`
          : 'Confirmação de encaminhamento do Gmail, mas não achei nem o código nem o link.',
      attachments: 0, raw: { kind: 'gmail_forwarding_confirmation', codigo, link, trecho: corpo.slice(0, 1500) },
    }, { onConflict: 'tenant_id,message_id', ignoreDuplicates: true });
    await admin.from('fin_mail_config').update({ last_received_at: new Date().toISOString() }).eq('tenant_id', tenantId);
    log('INFO', 'webhook', 'confirmação de encaminhamento do Gmail', { tenantId, temCodigo: Boolean(codigo) });
    return json({ success: true, gmail_confirmation: true, codigo });
  }

  // Encaminhado À MÃO ("Fwd:") por alguém da equipe: o remetente de verdade está no texto
  // ("De: Fulano <x@y>"). Só vale quando quem encaminhou é usuário da loja — senão qualquer um
  // escreveria um "De: fornecedor" falso no corpo para se passar por fornecedor cadastrado.
  let remetenteEmail = email.fromEmail;
  let remetenteNome = email.fromName;
  let encaminhadoPor: string | null = null;
  const fwd = email.texto.match(/(?:forwarded message|mensagem encaminhada)[\s\S]{0,200}?(?:^|\n)\s*\*?(?:de|from):\*?\s*([^\n<]*?)\s*<([^\s<>@]+@[^\s<>]+)>/i);
  if (fwd && email.fromEmail) {
    const { data: equipe } = await admin.from('users').select('id, user_tenants!inner(tenant_id)')
      .ilike('email', email.fromEmail).eq('user_tenants.tenant_id', tenantId).limit(1);
    if (equipe?.length) {
      encaminhadoPor = email.fromEmail;
      remetenteEmail = fwd[2].trim().toLowerCase();
      remetenteNome = fwd[1].replace(/["*]/g, '').trim() || null;
    }
  }

  // Anexo vai para o bucket: quem decide a pendência precisa VER o boleto, e o reprocessar lê de novo.
  const guardados: Array<{ nome: string; tipo: string; bytes: number; path: string | null }> = [];
  const pasta = `${tenantId}/${crypto.randomUUID()}`;
  for (const [i, a] of email.anexos.entries()) {
    const bytes = Math.floor(a.base64.length * 0.75);
    let path: string | null = null;
    if ((/pdf|image\//i.test(a.tipo) || /\.(pdf|png|jpe?g)$/i.test(a.nome)) && bytes <= MAX_ANEXO_BYTES) {
      try {
        const bin = Uint8Array.from(atob(a.base64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
        path = `${pasta}/${i}-${(a.nome || 'anexo').replace(/[^\w.-]+/g, '_').slice(-80)}`;
        const { error } = await admin.storage.from(BUCKET).upload(path, bin, { contentType: a.tipo || 'application/octet-stream', upsert: true });
        if (error) { log('WARN', 'webhook', 'anexo não guardado', { error: error.message }); path = null; }
      } catch { path = null; }
    }
    guardados.push({ nome: a.nome, tipo: a.tipo, bytes, path });
  }

  const row = {
    tenant_id: tenantId,
    message_id: email.messageId,
    from_email: remetenteEmail || null,
    from_name: remetenteNome,
    subject: email.subject.slice(0, 500) || null,
    received_at: email.receivedAt && !isNaN(Date.parse(email.receivedAt)) ? new Date(email.receivedAt).toISOString() : new Date().toISOString(),
    status: 'pending',
    attachments: email.anexos.length,
    reason: 'Lendo…',
    raw: { formato: email.formato, anexos: guardados, texto: email.texto.slice(0, 20000), encaminhado_por: encaminhadoPor },
  };

  // Mesmo e-mail entregue duas vezes (o serviço reenvia quando não recebe 200) não vira duas
  // linhas: a chave é o message_id.
  const { data: ins, error } = await admin.from('fin_mail_messages')
    .upsert(row, { onConflict: 'tenant_id,message_id', ignoreDuplicates: true }).select('id');
  if (error) {
    log('ERROR', 'webhook', 'gravar mensagem falhou', { tenantId, error: error.message });
    // 500 de propósito: o serviço reenvia, e aí a mensagem não se perde.
    return json({ success: false }, 500);
  }

  await admin.from('fin_mail_config').update({
    last_received_at: new Date().toISOString(), last_error: null,
  }).eq('tenant_id', tenantId);

  const mailId = ins?.[0]?.id as string | undefined;
  log('INFO', 'webhook', 'recebido', { tenantId, de: remetenteEmail, encaminhadoPor, anexos: email.anexos.length, duplicado: !mailId });
  if (!mailId) return json({ success: true, duplicado: true });

  // A leitura (PDF, IA) pode levar vários segundos: responde já e processa em segundo plano,
  // para o serviço não achar que falhou e reenviar.
  const p = processarSeguro(admin, tenantId, mailId, { subject: email.subject, texto: email.texto, anexos: email.anexos, remetenteEmail });
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p); else await p;
  return json({ success: true, id: mailId });
}

// ── Leitura + decisão: lança direto ou abre pendência ───────────────────────
async function fornecedores(admin: Admin, tenantId: string, email: string, cnpjs: string[]) {
  const { data: porEmail } = email
    ? await admin.from('fin_suppliers').select('id, name, cnpj, email').eq('tenant_id', tenantId).is('deleted_at', null).ilike('email', email).limit(1)
    : { data: [] as Fornecedor[] };
  const raizes = [...new Set(cnpjs.map((c) => c.slice(0, 8)))];
  const porCnpj: Record<string, Fornecedor> = {};
  if (raizes.length) {
    const { data } = await admin.from('fin_suppliers').select('id, name, cnpj, email').eq('tenant_id', tenantId).is('deleted_at', null).not('cnpj', 'is', null);
    for (const f of (data ?? []) as Fornecedor[]) {
      const r = onlyDigits(f.cnpj).slice(0, 8);
      if (raizes.includes(r) && !porCnpj[r]) porCnpj[r] = f;
    }
  }
  return { remetente: ((porEmail ?? [])[0] ?? null) as Fornecedor | null, porCnpj };
}

type BoletoRaw = BoletoLido & { motivo?: string | null; alerta?: boolean; conta_id?: string | null; acao?: string | null };
type EmailParaLer = { subject: string; texto: string; anexos: AnexoLido[]; remetenteEmail: string };

async function processarSeguro(admin: Admin, tenantId: string, mailId: string, email: EmailParaLer) {
  try { await processar(admin, tenantId, mailId, email); }
  catch (e) {
    const m = String((e as Error)?.message ?? e);
    log('ERROR', 'processar', 'falhou', { mailId, error: m });
    await admin.from('fin_mail_messages').update({ status: 'error', reason: `Falha ao ler: ${m.slice(0, 200)}` }).eq('id', mailId);
  }
}

async function processar(admin: Admin, tenantId: string, mailId: string, email: EmailParaLer) {
  const { data: t } = await admin.from('tenants').select('cnpj').eq('id', tenantId).maybeSingle();
  const cnpjLoja = onlyDigits(t?.cnpj) || null;
  const { boletos, avisos, pareceBoleto } = await lerBoletos(email, cnpjLoja);
  const { remetente, porCnpj } = await fornecedores(admin, tenantId, email.remetenteEmail, boletos.map((b) => b.cnpj).filter(Boolean) as string[]);
  const { data: atual } = await admin.from('fin_mail_messages').select('raw, subject, from_email, from_name').eq('id', mailId).single();
  const base = { ...(atual?.raw ?? {}), avisos, leitura_em: new Date().toISOString() };
  const agora = new Date().toISOString();

  if (!boletos.length) {
    // Parece boleto e não fechou no DV: alguém precisa olhar. Sem cara de boleto: só registra.
    if (avisos.length) {
      await admin.from('fin_mail_messages').update({
        status: 'pendencia', reason: avisos.join(' '), supplier_id: remetente?.id ?? null, raw: { ...base, boletos: [] }, processed_at: agora,
      }).eq('id', mailId);
      await abrirPendencia(admin, tenantId, mailId, atual, [], avisos.join(' '), false, remetente);
      return;
    }
    await admin.from('fin_mail_messages').update({
      status: 'ignored', supplier_id: remetente?.id ?? null, raw: { ...base, boletos: [] }, processed_at: agora,
      reason: pareceBoleto ? 'Nenhuma linha digitável válida no e-mail nem nos anexos.' : 'Sem boleto.',
    }).eq('id', mailId);
    return;
  }

  const lista: BoletoRaw[] = boletos.map((b) => {
    const m = b.valor ? motivoPendencia(b, remetente, b.cnpj ? porCnpj[b.cnpj.slice(0, 8)] ?? null : null)
      : { motivo: 'O boleto não traz valor.', alerta: false };
    return { ...b, beneficiario: b.beneficiario ?? (m ? null : remetente?.name ?? null), motivo: m?.motivo ?? null, alerta: m?.alerta ?? false };
  });

  if (!lista.some((b) => b.motivo)) {
    // Fornecedor conhecido e beneficiário batendo: lança direto.
    for (const b of lista) {
      const r = await lancarBoleto(admin, tenantId, b, { fornecedor: remetente!.name, remetente: email.remetenteEmail, assunto: email.subject });
      if (r.ok) { b.conta_id = r.conta_id; b.acao = r.acao; }
      else b.motivo = `Há ${r.ambiguo.length} contas em aberto de ${remetente!.name} com esse valor: escolha qual é.`;
    }
    if (lista.every((b) => b.conta_id)) {
      await admin.from('fin_mail_messages').update({
        status: 'bill', bill_id: lista[0].conta_id, supplier_id: remetente!.id, boleto_digitavel: lista[0].digitavel,
        amount: lista[0].valor, due_date: lista[0].vencimento, reason: lista.map((b) => `${resumoBoleto(b)}: ${b.acao}`).join(' · '),
        raw: { ...base, boletos: lista }, processed_at: agora,
      }).eq('id', mailId);
      log('INFO', 'processar', 'lançado direto', { mailId, fornecedor: remetente!.name, boletos: lista.length });
      return;
    }
  }

  const motivo = [...new Set(lista.filter((b) => b.motivo && !b.conta_id).map((b) => b.motivo))].join(' ');
  const alerta = lista.some((b) => b.alerta);
  const primeiro = lista.find((b) => !b.conta_id) ?? lista[0];
  await admin.from('fin_mail_messages').update({
    status: 'pendencia', reason: motivo, supplier_id: remetente?.id ?? null,
    boleto_digitavel: primeiro.digitavel, amount: primeiro.valor, due_date: primeiro.vencimento,
    raw: { ...base, boletos: lista }, processed_at: agora,
  }).eq('id', mailId);
  await abrirPendencia(admin, tenantId, mailId, atual, lista, motivo, alerta, remetente);
}

async function abrirPendencia(admin: Admin, tenantId: string, mailId: string, msg: any, lista: BoletoRaw[], motivo: string, alerta: boolean, remetente: Fornecedor | null) {
  const abertos = lista.filter((b) => !b.conta_id);
  const quem = remetente?.name ?? msg?.from_name ?? msg?.from_email ?? 'remetente';
  const titulo = abertos.length === 1
    ? `Boleto por e-mail: ${resumoBoleto(abertos[0])}`
    : abertos.length ? `${abertos.length} boletos por e-mail de ${quem}` : `E-mail de ${quem}: boleto não lido`;
  const limite = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const vencePerto = abertos.some((b) => b.vencimento && b.vencimento <= limite);
  const { error } = await admin.rpc('fn_pendencia_upsert', {
    p_tenant: tenantId, p_kind: 'boleto_email', p_ref: mailId, p_titulo: titulo.slice(0, 200),
    p_detalhe: motivo.slice(0, 1000),
    p_payload: { mail_id: mailId, remetente: msg?.from_email ?? null, remetente_nome: msg?.from_name ?? null, assunto: msg?.subject ?? null, alerta },
    p_rota: '/financeiro?tab=contas-pagar', p_urgencia: alerta || vencePerto ? 'alta' : 'normal',
    p_acao_requerida: true, p_origem: 'contas-email', p_reabrir: true,
  });
  if (error) log('ERROR', 'pendencia', 'não abriu', { mailId, error: error.message });
}

function safeConfig(cfg: any) {
  if (!cfg) return null;
  return {
    configured: Boolean(cfg.inbound_token),
    is_active: cfg.is_active === true,
    inbound_address: cfg.inbound_address ?? null,
    webhook_url: cfg.inbound_token ? webhookUrl(cfg.inbound_token) : null,
    last_received_at: cfg.last_received_at ?? null,
    last_error: cfg.last_error ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || serviceRoleKey.length < 40) return errResp('Server misconfiguration', 500);
  const admin: Admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // ── Webhook: vem do serviço de recebimento, sem JWT ──
  const inbound = new URL(req.url).searchParams.get('inbound');
  if (inbound) {
    if (req.method !== 'POST') return json({ success: false }, 405);
    let body: any;
    try { body = await req.json(); } catch { return json({ success: false, error: 'corpo inválido' }, 400); }
    try { return await receber(admin, inbound, body); }
    catch (e) {
      log('ERROR', 'webhook', 'falha inesperada', { error: String((e as Error)?.message ?? e) });
      return json({ success: false }, 500);
    }
  }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return errResp('Invalid JSON body'); }
  const action = String(body.action ?? '');

  try {
    const requested: string | null = body.tenant_id ?? body.active_tenant_id ?? null;
    if (!token) return errResp('Unauthorized', 401);
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user) return errResp('Unauthorized', 401);
    const { data: rows } = await admin.from('user_tenants').select('tenant_id, role').eq('user_id', u.user.id);
    const match = requested ? (rows ?? []).find((r) => r.tenant_id === requested) : ((rows ?? []).length === 1 ? rows![0] : null);
    if (!match) return errResp('Sem acesso a esta loja', 403);
    const tenantId = match.tenant_id as string;
    const canWrite = isFinanceiroRole(String(match.role ?? ''));

    const { data: cfg } = await admin.from('fin_mail_config').select('*').eq('tenant_id', tenantId).maybeSingle();

    if (action === 'get_config') return json({ success: true, config: safeConfig(cfg) });

    if (action === 'save_config') {
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode configurar', 403);
      const endereco = String(body.inbound_address ?? '').trim().toLowerCase();
      if (endereco && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(endereco)) return errResp('Endereço de recebimento inválido.');
      const { error } = await admin.from('fin_mail_config').upsert({
        tenant_id: tenantId, provider: 'inbound',
        inbound_token: cfg?.inbound_token ?? newToken(),
        inbound_address: endereco || null,
        is_active: true, last_error: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' });
      if (error) return errResp(`Salvar: ${error.message}`);
      const { data: fresh } = await admin.from('fin_mail_config').select('*').eq('tenant_id', tenantId).maybeSingle();
      log('INFO', 'save_config', 'ok', { tenantId, by: u.user.id });
      return json({ success: true, config: safeConfig(fresh) });
    }

    if (action === 'rotate_token') {
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode trocar o segredo', 403);
      const { error } = await admin.from('fin_mail_config')
        .update({ inbound_token: newToken(), updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId);
      if (error) return errResp(error.message);
      const { data: fresh } = await admin.from('fin_mail_config').select('*').eq('tenant_id', tenantId).maybeSingle();
      return json({ success: true, config: safeConfig(fresh) });
    }

    if (action === 'list_messages') {
      const limit = Math.min(Math.max(Number(body.limit ?? 30), 1), 100);
      const { data } = await admin.from('fin_mail_messages')
        .select('id, from_email, from_name, subject, received_at, status, reason, amount, due_date, attachments, boleto_digitavel, bill_id')
        .eq('tenant_id', tenantId).order('received_at', { ascending: false }).limit(limit);
      return json({ success: true, messages: data ?? [] });
    }

    // ── Um e-mail: o que foi lido, os links dos anexos e as contas candidatas ──
    const carregar = async () => {
      const { data: m } = await admin.from('fin_mail_messages')
        .select('id, from_email, from_name, subject, received_at, status, reason, bill_id, supplier_id, raw')
        .eq('id', String(body.mail_id ?? '')).eq('tenant_id', tenantId).maybeSingle();
      return m as any;
    };
    const resolverPendencia = async (motivo: string) => {
      await admin.rpc('fn_pendencia_resolver_ref', { p_tenant: tenantId, p_kind: 'boleto_email', p_ref: String(body.mail_id), p_motivo: motivo });
      await admin.from('pendencias').update({ resolvida_por: u.user.id }).eq('tenant_id', tenantId).eq('kind', 'boleto_email').eq('ref', String(body.mail_id)).eq('status', 'resolvida');
    };

    if (action === 'detalhe') {
      const m = await carregar();
      if (!m) return errResp('E-mail não encontrado.', 404);
      const anexos = [];
      for (const a of (m.raw?.anexos ?? []) as Array<{ nome: string; tipo: string; path: string | null }>) {
        const { data: s } = a.path ? await admin.storage.from(BUCKET).createSignedUrl(a.path, 600) : { data: null };
        anexos.push({ nome: a.nome, tipo: a.tipo, url: s?.signedUrl ?? null });
      }
      const { raw, ...resto } = m;
      return json({
        success: true,
        mail: { ...resto, encaminhado_por: raw?.encaminhado_por ?? null, avisos: raw?.avisos ?? [], boletos: raw?.boletos ?? [], anexos, texto: String(raw?.texto ?? '').slice(0, 3000) },
      });
    }

    if (action === 'lancar') {
      // Decisão de uma pessoa (pendência): lança mesmo com remetente novo/CNPJ diferente. O
      // cartão mostrou o motivo e o boleto antes; o pagamento continua exigindo aprovação.
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode lançar', 403);
      const m = await carregar();
      if (!m) return errResp('E-mail não encontrado.', 404);
      const boletos = (m.raw?.boletos ?? []) as BoletoRaw[];
      if (!boletos.length) return errResp('Esse e-mail não tem boleto lido. Reprocesse ou lance pela tela de Contas a Pagar.');
      let fornecedor: string | null = null;
      if (m.supplier_id) {
        const { data: f } = await admin.from('fin_suppliers').select('name').eq('id', m.supplier_id).maybeSingle();
        fornecedor = f?.name ?? null;
      }
      const indice = body.indice == null ? null : Number(body.indice);
      for (const [i, b] of boletos.entries()) {
        if (b.conta_id || (indice != null && i !== indice)) continue;
        if (!(Number(b.valor) > 0)) return errResp('O boleto não traz valor: lance pela tela de Contas a Pagar.');
        const r = await lancarBoleto(admin, tenantId, b, {
          fornecedor: fornecedor ?? b.beneficiario, remetente: m.from_email ?? '', assunto: m.subject ?? '',
          contaId: indice === i ? (body.conta_id ? String(body.conta_id) : null) : null,
        });
        if (!r.ok) {
          await admin.from('fin_mail_messages').update({ raw: { ...m.raw, boletos } }).eq('id', m.id);
          return json({ success: true, ambiguo: r.ambiguo, indice: i, boleto: resumoBoleto(b) });
        }
        b.conta_id = r.conta_id; b.acao = `${r.acao} (lançado por pessoa)`;
      }
      const todos = boletos.every((b) => b.conta_id);
      await admin.from('fin_mail_messages').update({
        status: todos ? 'bill' : 'pendencia', bill_id: boletos.find((b) => b.conta_id)?.conta_id ?? null,
        reason: boletos.map((b) => `${resumoBoleto(b)}: ${b.conta_id ? b.acao : 'falta lançar'}`).join(' · '),
        raw: { ...m.raw, boletos, lancado_por: u.user.id }, processed_at: new Date().toISOString(),
      }).eq('id', m.id);
      if (todos) await resolverPendencia('conta lançada');
      log('INFO', 'lancar', 'ok', { mailId: m.id, by: u.user.id, boletos: boletos.length });
      return json({ success: true, lancado: todos, contas: boletos.map((b) => ({ conta_id: b.conta_id, acao: b.acao })) });
    }

    if (action === 'ignorar') {
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode descartar', 403);
      const m = await carregar();
      if (!m) return errResp('E-mail não encontrado.', 404);
      if (m.status === 'bill') return errResp('Esse boleto já virou conta a pagar. Cancele a conta pela tela, se for o caso.');
      const motivo = String(body.motivo ?? '').trim().slice(0, 300) || 'não é conta a pagar';
      await admin.from('fin_mail_messages').update({ status: 'ignored', reason: `Descartado: ${motivo}`, processed_at: new Date().toISOString() }).eq('id', m.id);
      await resolverPendencia(`descartado: ${motivo}`);
      return json({ success: true });
    }

    if (action === 'reprocessar') {
      // Lê de novo com o que ficou guardado (texto + anexos no bucket). Útil quando a leitura
      // falhou ou quando o fornecedor foi cadastrado depois.
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode reprocessar', 403);
      const m = await carregar();
      if (!m) return errResp('E-mail não encontrado.', 404);
      if (m.status === 'bill') return errResp('Esse e-mail já virou conta a pagar.');
      const anexos: AnexoLido[] = [];
      for (const a of (m.raw?.anexos ?? []) as Array<{ nome: string; tipo: string; path: string | null }>) {
        if (!a.path) continue;
        const { data: blob } = await admin.storage.from(BUCKET).download(a.path);
        if (!blob) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        anexos.push({ nome: a.nome, tipo: a.tipo, base64: btoa(bin) });
      }
      // E-mail antigo (antes de 2026-09-25) não guardava o texto: usa o que foi lido dele.
      const texto = String(m.raw?.texto ?? '') || String((await admin.from('fin_mail_messages').select('boleto_digitavel').eq('id', m.id).single()).data?.boleto_digitavel ?? '');
      await admin.from('fin_mail_messages').update({ status: 'pending', reason: 'Lendo…' }).eq('id', m.id);
      await processarSeguro(admin, tenantId, m.id, { subject: m.subject ?? '', texto, anexos, remetenteEmail: String(m.from_email ?? '') });
      const { data: depois } = await admin.from('fin_mail_messages').select('status, reason, bill_id').eq('id', m.id).single();
      return json({ success: true, ...depois });
    }

    if (action === 'disconnect') {
      if (!canWrite) return errResp('Só administrador, gerente ou financeiro pode desligar', 403);
      // Desliga a entrada sem apagar o histórico do que já chegou.
      const { error } = await admin.from('fin_mail_config')
        .update({ is_active: false, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId);
      if (error) return errResp(error.message);
      return json({ success: true });
    }

    return errResp(`Ação desconhecida: ${action}`);
  } catch (e) {
    log('ERROR', action, 'falha inesperada', { error: String((e as Error)?.message ?? e) });
    return errResp(String((e as Error)?.message ?? e), 500);
  }
});
