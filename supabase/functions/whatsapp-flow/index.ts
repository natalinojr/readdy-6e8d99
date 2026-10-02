// whatsapp-flow — endpoint do WhatsApp Flow "Escolher horário" (agendamento de entrevista, Contratação).
// Criado em 2026-10. O formulário abre dentro da conversa (só API oficial); cada troca de tela vem para cá
// cifrada, e as respostas saem da agenda da vaga ao vivo pelo hiring-scheduler (flow_info / flow_book /
// flow_nenhum). Quem manda o botão é o hiring-scheduler › ofereceFlow, depois da lista de horários em texto.
//
//   POST (Meta)  corpo { encrypted_flow_data, encrypted_aes_key, initial_vector }, assinatura
//                X-Hub-Signature-256 com WHATSAPP_APP_SECRET. Códigos que a Meta entende:
//                421 = não deu para decifrar (ela busca a chave pública de novo), 427 = token do Flow
//                inválido ou formulário que não vale mais (fecha), 432 = assinatura errada.
//   POST (admin, header x-internal-key = ASSISTENTE_INTERNAL_KEY), corpo { action, ... }:
//        chave_publica                 → manda à Meta a pública derivada de WHATSAPP_FLOW_PRIVATE_KEY
//        criar { nome? }               → cria o Flow (rascunho) e guarda o id em asst_settings.wa_flow_agendamento
//        atualizar                     → troca o JSON do Flow (só rascunho; publicado não se edita)
//        publicar                      → publica
//        status                        → status, erros de validação, saúde e preview_url
//        testar { session_id, to }     → manda o botão para `to` com o token da sessão (modo do ligar)
//        ligar { ativo, numeros?, modo? } → liga/desliga o envio automático depois da lista de horários
//
// Secrets: WHATSAPP_FLOW_PRIVATE_KEY (scripts/whatsapp-flow/gerar-chaves.mjs), WHATSAPP_APP_SECRET,
//          ASSISTENTE_INTERNAL_KEY, WHATSAPP_CLOUD_TOKEN. Deploy: --no-verify-jwt (a Meta chama sem JWT).
// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { graph, waConfig, waSendFlow } from '../_shared/wa.ts';
import { lerFlowCfg, sessaoDoToken, tokenDoFlow } from '../_shared/wa-flow.ts';
import { assinaturaMetaOk, cifrarResposta, decifrar, FlowHttpError, importarPrivada, publicaDaPrivada, type FlowRequest } from './cripto.ts';
import { diasDisponiveis, FLOW_JSON, NENHUM, telaHorario } from './telas.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const internalKey = Deno.env.get('ASSISTENTE_INTERNAL_KEY') ?? '';
const appSecret = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';
const privadaPem = Deno.env.get('WHATSAPP_FLOW_PRIVATE_KEY') ?? '';
const SETTING = 'wa_flow_agendamento';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'whatsapp-flow', level, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

let chave: Promise<CryptoKey> | null = null;
const privada = () => {
  if (!privadaPem) throw new Error('WHATSAPP_FLOW_PRIVATE_KEY não configurada');
  // Promise rejeitada não fica guardada (PEM errado não pode virar 421 até o isolate reciclar).
  return (chave ??= importarPrivada(privadaPem).catch((e) => { chave = null; throw e; }));
};

async function scheduler(action: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${supabaseUrl}/functions/v1/hiring-scheduler`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey }, body: JSON.stringify({ action, ...body }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`hiring-scheduler ${action} → ${r.status}: ${out?.error ?? ''}`);
  return out;
}

// Formulário que não vale mais (já marcou, pedido com a equipe, encerrado): fecha com a mensagem.
const FECHA: Record<string, string> = {
  agendado: 'Sua entrevista já está marcada. Se precisar mudar, é só responder na conversa.',
  aguardando_gestor: 'Estamos confirmando seu pedido de horário com a equipe. Já te avisamos na conversa.',
  conversa: 'Recebi sua mensagem na conversa e vou te responder por lá.',
};
const fecha = (motivo: unknown) => new FlowHttpError(427, FECHA[String(motivo)] ?? 'Este formulário não vale mais. Responda na conversa, por favor.');

async function telaDia(sessionId: string) {
  const info = await scheduler('flow_info', { session_id: sessionId });
  if (!info.ok) throw fecha(info.motivo);
  const dias = diasDisponiveis(info.slots ?? []);
  if (!dias.length) throw new FlowHttpError(427, 'No momento não há horários livres. Responda na conversa com o melhor dia e horário pra você.');
  return { screen: 'DIA', data: { vaga: info.vaga, local: info.local, dias } };
}

async function telaDoDia(sessionId: string, dia: string, aviso = '', slots?: string[]) {
  let lista = slots;
  if (!lista) {
    const info = await scheduler('flow_info', { session_id: sessionId });
    if (!info.ok) throw fecha(info.motivo);
    lista = info.slots ?? [];
  }
  const tela = telaHorario(lista!, dia, new Date(), aviso);
  // Só sobrou o "Nenhum serve": o dia lotou enquanto a pessoa escolhia.
  if (tela.data.horarios.length === 1 && !aviso) return telaHorario(lista!, dia, new Date(), 'Esse dia não tem mais horário livre. Volte e escolha outro dia.');
  return tela;
}

const sucesso = (flowToken: string, escolha: string) => ({
  screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: flowToken, escolha } } },
});

async function tratar(body: any): Promise<Record<string, unknown>> {
  const action = String(body?.action ?? '');
  if (action === 'ping') return { data: { status: 'active' } };
  if (body?.data?.error) {
    log('WARN', 'erro informado pelo cliente do WhatsApp', { error: body.data.error, message: body.data.error_message });
    return { data: { acknowledged: true } };
  }
  const flowToken = String(body?.flow_token ?? '');
  const sessionId = await sessaoDoToken(internalKey, flowToken);
  if (!sessionId) throw new FlowHttpError(427, 'Este formulário expirou. Responda na conversa, por favor.');
  const data = (body?.data ?? {}) as Record<string, unknown>;
  const screen = String(body?.screen ?? '');

  if (action === 'INIT' || action === 'BACK') return await telaDia(sessionId);
  if (action === 'data_exchange' && screen === 'DIA') return await telaDoDia(sessionId, String(data.dia ?? ''));
  if (action === 'data_exchange' && screen === 'HORARIO') {
    const dia = String(data.dia ?? ''), horario = String(data.horario ?? '');
    if (horario === NENHUM) {
      const r = await scheduler('flow_nenhum', { session_id: sessionId });
      if (!r.ok) throw fecha(r.motivo);
      return sucesso(flowToken, NENHUM);
    }
    const r = await scheduler('flow_book', { session_id: sessionId, starts_at: horario });
    if (r.ok) return sucesso(flowToken, horario);
    if (r.motivo !== 'indisponivel') throw fecha(r.motivo);
    return await telaDoDia(sessionId, dia, 'Esse horário acabou de ser preenchido. Escolha outro.', r.slots ?? []);
  }
  throw new Error(`ação desconhecida: ${action}/${screen}`);
}

// ── Meta → endpoint ──
async function endpoint(req: Request, raw: string): Promise<Response> {
  // Sem o App Secret não há como conferir quem chama: recusa (diferente do webhook whatsapp-cloud).
  if (!appSecret || !(await assinaturaMetaOk(appSecret, raw, req.headers.get('x-hub-signature-256')))) {
    if (!appSecret) log('ERROR', 'WHATSAPP_APP_SECRET ausente');
    return new Response('assinatura inválida', { status: 432 });
  }

  let dec: Awaited<ReturnType<typeof decifrar>>;
  try {
    dec = await decifrar(JSON.parse(raw) as FlowRequest, await privada());
  } catch (e) {
    log('WARN', 'não deu para decifrar', { error: errMsg(e) });
    return new Response('', { status: 421 });
  }
  const version = dec.body?.version;
  let status = 200;
  let resposta: Record<string, unknown>;
  try {
    resposta = await tratar(dec.body);
  } catch (e) {
    if (!(e instanceof FlowHttpError)) {
      log('ERROR', 'falha no formulário', { action: dec.body?.action, screen: dec.body?.screen, error: errMsg(e) });
      return new Response('', { status: 500 });
    }
    status = e.status;
    resposta = { error_msg: e.message };
  }
  // A Meta exige o mesmo `version` do pedido; sem ele a falha é silenciosa.
  const corpo = version && !('error_msg' in resposta) ? { version, ...resposta } : resposta;
  return new Response(await cifrarResposta(corpo, dec.aes, dec.iv), { status, headers: { 'Content-Type': 'text/plain' } });
}

// ── admin ──
async function lerSetting() {
  const { data } = await admin.from('asst_settings').select('value').eq('key', SETTING).maybeSingle();
  return { bruto: (data?.value ?? {}) as Record<string, unknown>, cfg: lerFlowCfg(data?.value) };
}
async function gravarSetting(mudou: Record<string, unknown>) {
  const { bruto } = await lerSetting();
  const value = { ...bruto, ...mudou };
  const { error } = await admin.from('asst_settings').upsert({ key: SETTING, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(`asst_settings: ${error.message}`);
  return value;
}

async function adminAction(body: any): Promise<unknown> {
  const wcfg = await waConfig(admin);
  const { cfg } = await lerSetting();
  const precisaFlow = () => { if (!cfg.flow_id) throw new Error('Flow ainda não criado (ação criar)'); return cfg.flow_id; };
  switch (String(body?.action ?? '')) {
    case 'chave_publica': {
      if (!wcfg.phone_id) throw new Error('wa_public.phone_id não configurado');
      const pem = await publicaDaPrivada(await privada());
      const out = await graph(`${wcfg.phone_id}/whatsapp_business_encryption`, { body: { business_public_key: pem } }, wcfg.token);
      return { enviado: out, atual: await graph(`${wcfg.phone_id}/whatsapp_business_encryption`, {}, wcfg.token).catch((e) => ({ erro: errMsg(e) })) };
    }
    case 'criar': {
      if (!wcfg.waba_id) throw new Error('wa_public.waba_id não configurado');
      const out = await graph(`${wcfg.waba_id}/flows`, {
        body: {
          name: String(body.nome ?? 'Agendamento de entrevista').slice(0, 100), categories: ['APPOINTMENT_BOOKING'],
          flow_json: JSON.stringify(FLOW_JSON), endpoint_uri: `${supabaseUrl}/functions/v1/whatsapp-flow`, publish: false,
        },
      }, wcfg.token);
      if (out?.id) await gravarSetting({ flow_id: String(out.id), ativo: false, numeros: cfg.numeros, modo: 'draft' });
      return out;
    }
    case 'atualizar': {
      const form = new FormData();
      form.append('name', 'flow.json');
      form.append('asset_type', 'FLOW_JSON');
      form.append('file', new Blob([JSON.stringify(FLOW_JSON)], { type: 'application/json' }), 'flow.json');
      const r = await fetch(`https://graph.facebook.com/v25.0/${precisaFlow()}/assets`, {
        method: 'POST', headers: { Authorization: `Bearer ${wcfg.token || (Deno.env.get('WHATSAPP_CLOUD_TOKEN') ?? '')}` }, body: form,
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Meta ${r.status}: ${out?.error?.message ?? ''}`);
      return out;
    }
    case 'publicar':
      return await graph(`${precisaFlow()}/publish`, { method: 'POST' }, wcfg.token);
    case 'status':
      return { config: cfg, flow: await graph(`${precisaFlow()}?fields=id,name,status,validation_errors,health_status,preview.invalidate(false)`, {}, wcfg.token) };
    case 'testar': {
      const sessionId = String(body.session_id ?? ''), to = String(body.to ?? '').replace(/\D/g, '');
      if (!sessionId || to.length < 12) throw new Error('informe session_id e to (com 55 + DDD)');
      const id = await waSendFlow(wcfg, to, {
        flowId: precisaFlow(), token: await tokenDoFlow(internalKey, sessionId), cta: 'Escolher horário',
        body: 'Prefere escolher tocando? 👇', draft: cfg.modo === 'draft', origin: 'agendamento',
      });
      return { enviado: id, modo: cfg.modo };
    }
    case 'ligar': {
      const mudou: Record<string, unknown> = { ativo: body.ativo === true };
      if (Array.isArray(body.numeros)) mudou.numeros = body.numeros.map((n: unknown) => String(n).replace(/\D/g, '')).filter((n: string) => n.length >= 10);
      if (body.modo === 'draft' || body.modo === 'published') mudou.modo = body.modo;
      return await gravarSetting(mudou);
    }
    default:
      throw new Error('ação desconhecida');
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const raw = await req.text();
  const chaveInterna = req.headers.get('x-internal-key');
  if (chaveInterna !== null) {
    if (internalKey.length < 20 || chaveInterna !== internalKey) return json({ error: 'Unauthorized' }, 401);
    try {
      return json({ ok: true, resultado: await adminAction(JSON.parse(raw || '{}')) });
    } catch (e) {
      log('ERROR', 'ação admin', { error: errMsg(e) });
      return json({ ok: false, error: errMsg(e) }, 400);
    }
  }
  return await endpoint(req, raw);
});
