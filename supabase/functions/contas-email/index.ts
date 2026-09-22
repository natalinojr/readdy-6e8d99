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
import { findBoletos } from '../_shared/boleto.ts';

type Admin = SupabaseClient;

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
      fromEmail: soEmail(body?.envelope?.from ?? h.from),
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
    // O codigo do Gmail costuma ter 9 digitos, mas nem sempre vem no texto puro (o e-mail
    // real de 2026-09-22 so trouxe o link). Aceita 6 a 12 digitos isolados; os limites
    // (?<!\d) e (?!\d) evitam pegar digitos de DENTRO de um numero maior.
    const codigo = corpo.match(/(?<!\d)(\d{6,12})(?!\d)/)?.[1] ?? null;
    const link = corpo.match(/https:\/\/mail-settings\.google\.com[^\s"'<>]*/i)?.[0] ?? null;
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

  // O fornecedor já é conhecido? É isso que decide entre lançar direto e virar pendência.
  const { data: forn } = await admin.from('fin_suppliers')
    .select('id, name, cnpj, email').eq('tenant_id', tenantId).is('deleted_at', null)
    .ilike('email', email.fromEmail).limit(1).maybeSingle();

  // Boleto no CORPO do e-mail: só entra o que passa nos dígitos verificadores. O anexo em PDF
  // é lido na etapa seguinte (a IA lê, e a conferência dos dígitos é quem aprova).
  const doTexto = findBoletos(`${email.subject}\n${email.texto}`);
  const boleto = doTexto[0] ?? null;

  const row = {
    tenant_id: tenantId,
    message_id: email.messageId,
    from_email: email.fromEmail || null,
    from_name: email.fromName,
    subject: email.subject.slice(0, 500) || null,
    received_at: email.receivedAt ? new Date(email.receivedAt).toISOString() : new Date().toISOString(),
    status: 'pending',
    supplier_id: forn?.id ?? null,
    boleto_digitavel: boleto?.digitavel ?? boleto?.barcode ?? null,
    amount: boleto?.valor ?? null,
    due_date: boleto?.vencimento ?? null,
    attachments: email.anexos.length,
    reason: forn ? null : 'Remetente ainda não é fornecedor cadastrado',
    raw: {
      formato: email.formato,
      anexos: email.anexos.map((a) => ({ nome: a.nome, tipo: a.tipo, bytes: Math.floor(a.base64.length * 0.75) })),
      boletos_no_texto: doTexto.length,
    },
  };

  // Mesmo e-mail entregue duas vezes (o serviço reenvia quando não recebe 200) não vira duas
  // linhas: a chave é o message_id.
  const { error } = await admin.from('fin_mail_messages')
    .upsert(row, { onConflict: 'tenant_id,message_id', ignoreDuplicates: true });
  if (error) {
    log('ERROR', 'webhook', 'gravar mensagem falhou', { tenantId, error: error.message });
    // 500 de propósito: o serviço reenvia, e aí a mensagem não se perde.
    return json({ success: false }, 500);
  }

  await admin.from('fin_mail_config').update({
    last_received_at: new Date().toISOString(), last_error: null,
  }).eq('tenant_id', tenantId);

  log('INFO', 'webhook', 'recebido', {
    tenantId, de: email.fromEmail, anexos: email.anexos.length,
    fornecedor: forn?.name ?? null, boleto: Boolean(boleto),
  });
  return json({ success: true, boleto: Boolean(boleto), fornecedor_conhecido: Boolean(forn) });
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
