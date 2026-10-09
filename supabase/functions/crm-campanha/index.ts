// crm-campanha — campanha de marketing pelo WhatsApp oficial do ERPOS (número compartilhado do assistente):
// modelo com VÍDEO no topo, nome do cliente, botão "Pedir agora" (link do delivery) e "Não quero receber".
// Criado em 2026-10-09 para o lançamento do Clube de Vantagens da Vila Leste / El Patrón.
//
// As respostas do cliente já são tratadas pelo whatsapp-cloud › crmInbound (_shared/crm-auto.ts), porque
// cada envio fica em crm_sends (auto = true): "Não quero receber"/SAIR → customers.crm_opt_out_at; qualquer
// outra resposta → link do delivery + WhatsApp da loja (o atendimento é no número da loja).
//
//   POST (header x-campanha-key = CRM_CAMPANHA_KEY)
//     { action: 'numero' }                                  → nome, qualidade e limite do número
//     { action: 'link_upload_video', caminho }              → URL assinada para subir o MP4 em loja-videos
//     { action: 'criar_modelo', modelo }                    → cria o modelo na Meta (vídeo de exemplo + texto + botões)
//     { action: 'status_modelos', nome? }                   → situação dos modelos na Meta
//     { action: 'enviar_teste', modelo, telefone, nome? }   → manda o modelo para um telefone (sem crm_sends)
//     { action: 'publico', tenant_id, so_aceite }           → quantos e quem receberia (não envia)
//     { action: 'enviar', tenant_id, modelo, so_aceite, confirmar, limite? } → envia; confirmar = total do 'publico'
//
// `modelo` = { nome, video_url, texto, exemplo_nome, rodape, botao_texto, botao_url, botao_sair }.
// Secrets: WHATSAPP_CLOUD_TOKEN, CRM_CAMPANHA_KEY. Deploy: --no-verify-jwt.
// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { graph, waConfig, waLog, WaError } from '../_shared/wa.ts';
import { celularBR } from '../_shared/crm-auto.ts';

const GRAPH = 'https://graph.facebook.com/v25.0';
const BUCKET = 'loja-videos';
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const chave = Deno.env.get('CRM_CAMPANHA_KEY') ?? '';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const primeiroNome = (s: unknown) => {
  const n = String(s ?? '').trim().split(/\s+/)[0] ?? '';
  return n.length >= 2 && !/\d/.test(n) ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : 'tudo bem';
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function iguais(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

interface Modelo {
  nome: string; video_url: string; texto: string; exemplo_nome: string; rodape?: string;
  botao_texto: string; botao_url: string; botao_sair?: string;
}

// Vídeo de exemplo do modelo: a Meta só aceita por "upload retomável" do app dono do token.
async function handleDoVideo(videoUrl: string): Promise<string> {
  const token = Deno.env.get('WHATSAPP_CLOUD_TOKEN') ?? '';
  const app = await graph('app');
  const v = await fetch(videoUrl);
  if (!v.ok) throw new Error(`não baixei o vídeo (${v.status})`);
  const bytes = new Uint8Array(await v.arrayBuffer());
  const sessao = await fetch(`${GRAPH}/${app.id}/uploads?file_name=video.mp4&file_length=${bytes.length}&file_type=video/mp4`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  if (!sessao?.id) throw new Error(`sessão de upload: ${JSON.stringify(sessao).slice(0, 300)}`);
  const up = await fetch(`${GRAPH}/${sessao.id}`, {
    method: 'POST', headers: { Authorization: `OAuth ${token}`, file_offset: '0' }, body: bytes,
  }).then((r) => r.json());
  if (!up?.h) throw new Error(`upload do vídeo: ${JSON.stringify(up).slice(0, 300)}`);
  return String(up.h);
}

function componentesEnvio(m: Modelo, nome: string, tenantId: string | null) {
  const comps: any[] = [
    { type: 'header', parameters: [{ type: 'video', video: { link: m.video_url } }] },
    { type: 'body', parameters: [{ type: 'text', text: nome }] },
  ];
  if (m.botao_sair) comps.push({ type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: `crm_sair:${tenantId ?? ''}` }] });
  return comps;
}

async function enviarModelo(cfg: any, to: string, m: Modelo, nome: string, tenantId: string | null, origem: string) {
  if (!cfg.phone_id) throw new WaError('wa_public.phone_id não configurado', 500, null);
  const out = await graph(`${cfg.phone_id}/messages`, {
    body: {
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
      template: { name: m.nome, language: { code: 'pt_BR' }, components: componentesEnvio(m, nome, tenantId) },
    },
  }, cfg.token);
  const id = out?.messages?.[0]?.id ?? null;
  await waLog({ phone: to, direction: 'out', origin: origem, kind: 'template', text: `[vídeo] ${m.texto.replace('{{1}}', nome)}`, wa_msg_id: id });
  return id as string | null;
}

// Hora de Brasília (sem horário de verão).
const horaBR = () => (new Date().getUTCHours() + 21) % 24;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405);
  if (!chave || !iguais(req.headers.get('x-campanha-key') ?? '', chave)) return json({ error: 'não autorizado' }, 401);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const action = String(body?.action ?? '');

  try {
    const cfg = await waConfig(admin);
    if (cfg.transport !== 'cloud') return json({ error: 'o número do ERPOS não está na API oficial' }, 400);

    if (action === 'numero') {
      const numero = await graph(`${cfg.phone_id}?fields=display_phone_number,verified_name,status,quality_rating,name_status,messaging_limit_tier,throughput`);
      return json({ numero, waba_id: cfg.waba_id });
    }

    if (action === 'link_upload_video') {
      const caminho = String(body.caminho ?? '').replace(/[^a-zA-Z0-9/_.-]/g, '');
      if (!/^campanhas\/[a-z0-9/_.-]+\.mp4$/i.test(caminho)) return json({ error: 'caminho deve ser campanhas/<nome>.mp4' }, 400);
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(caminho, { upsert: true });
      if (error) throw error;
      const publico = admin.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl;
      return json({ upload_url: data.signedUrl, url_publica: publico });
    }

    if (action === 'criar_modelo') {
      const m = body.modelo as Modelo;
      if (!m?.nome || !m.video_url || !m.texto || !m.exemplo_nome || !m.botao_texto || !m.botao_url) return json({ error: 'modelo incompleto' }, 400);
      const handle = await handleDoVideo(m.video_url);
      const botoes: any[] = [{ type: 'URL', text: m.botao_texto, url: m.botao_url }];
      if (m.botao_sair) botoes.push({ type: 'QUICK_REPLY', text: m.botao_sair });
      const components: any[] = [
        { type: 'HEADER', format: 'VIDEO', example: { header_handle: [handle] } },
        { type: 'BODY', text: m.texto, example: { body_text: [[m.exemplo_nome]] } },
      ];
      if (m.rodape) components.push({ type: 'FOOTER', text: m.rodape });
      components.push({ type: 'BUTTONS', buttons: botoes });
      const out = await graph(`${cfg.waba_id}/message_templates`, { body: { name: m.nome, language: 'pt_BR', category: 'MARKETING', components } });
      return json({ criado: out });
    }

    if (action === 'status_modelos') {
      const out = await graph(`${cfg.waba_id}/message_templates?fields=name,status,category,language,rejected_reason,quality_score&limit=100`);
      const lista = (out?.data ?? []).filter((t: any) => !body.nome || t.name === body.nome);
      return json({ modelos: lista });
    }

    if (action === 'enviar_teste') {
      const m = body.modelo as Modelo;
      const cel = celularBR(body.telefone);
      if (!m?.nome || !cel) return json({ error: 'modelo e telefone (celular com DDD) obrigatórios' }, 400);
      const id = await enviarModelo(cfg, '55' + cel, m, primeiroNome(body.nome), null, 'campanha_teste');
      return json({ enviado: true, wa_msg_id: id });
    }

    // ── público: clientes da loja com celular, sem descadastro, sem mensagem do funil nos últimos 7 dias ──
    const tenantId = String(body.tenant_id ?? '');
    if (!['publico', 'enviar'].includes(action)) return json({ error: `ação desconhecida: ${action}` }, 400);
    if (!tenantId) return json({ error: 'tenant_id obrigatório' }, 400);
    const soAceite = body.so_aceite !== false;

    const { data: clientes, error: eCli } = await admin.from('customers')
      .select('id, name, phone, accepts_marketing, crm_opt_out_at').eq('tenant_id', tenantId).is('crm_opt_out_at', null);
    if (eCli) throw eCli;
    const semana = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: recentes } = await admin.from('crm_sends').select('customer_id').eq('tenant_id', tenantId).gte('sent_at', semana);
    const jaRecebeu = new Set((recentes ?? []).map((r: any) => String(r.customer_id)));
    const { data: etapas } = await admin.from('crm_customer_stage').select('customer_id, stage').eq('tenant_id', tenantId);
    const etapa = new Map((etapas ?? []).map((e: any) => [String(e.customer_id), String(e.stage)]));

    const vistos = new Set<string>();
    const fila: Array<{ id: string; nome: string; cel: string; stage: string }> = [];
    let semCelular = 0, semAceite = 0, recebeuNaSemana = 0, repetido = 0;
    for (const c of clientes ?? []) {
      const cel = celularBR(c.phone);
      if (!cel) { semCelular++; continue; }
      if (soAceite && c.accepts_marketing !== true) { semAceite++; continue; }
      if (jaRecebeu.has(String(c.id))) { recebeuNaSemana++; continue; }
      if (vistos.has(cel)) { repetido++; continue; }
      vistos.add(cel);
      fila.push({ id: String(c.id), nome: primeiroNome(c.name), cel, stage: etapa.get(String(c.id)) ?? 'recorrente' });
    }
    const resumo = { total: fila.length, sem_celular: semCelular, sem_aceite: semAceite, recebeu_na_semana: recebeuNaSemana, telefone_repetido: repetido, so_aceite: soAceite };

    if (action === 'publico') return json({ ...resumo, amostra: fila.slice(0, 10).map((f) => ({ nome: f.nome, final: f.cel.slice(-4) })) });

    // ── enviar ──
    const m = body.modelo as Modelo;
    if (!m?.nome || !m.video_url) return json({ error: 'modelo obrigatório' }, 400);
    if (Number(body.confirmar) !== fila.length) return json({ error: `confirme o total: ${fila.length}`, ...resumo }, 409);
    const h = horaBR();
    if (h < 10 || h >= 21) return json({ error: `fora do horário de envio (10h às 21h, agora ${h}h)` }, 409);
    const { data: clube } = await admin.from('loyalty_programs').select('enabled').eq('tenant_id', tenantId).maybeSingle();
    if (clube?.enabled !== true && body.clube_desligado_ok !== true) return json({ error: 'o clube desta loja está desligado' }, 409);

    const limite = Math.max(0, Math.min(Number(body.limite ?? fila.length), 250));
    let enviados = 0, falhas = 0, parouPor: string | null = null;
    for (const f of fila.slice(0, limite)) {
      try {
        const id = await enviarModelo(cfg, '55' + f.cel, m, f.nome, tenantId, 'campanha');
        await admin.from('crm_sends').insert({
          tenant_id: tenantId, customer_id: f.id, stage: f.stage, channel: 'whatsapp', auto: true, status: 'sent',
          message: `campanha:${m.nome}`, wa_msg_id: id,
        });
        enviados++;
      } catch (e) {
        falhas++;
        const code = e instanceof WaError ? e.code : null;
        await admin.from('crm_sends').insert({
          tenant_id: tenantId, customer_id: f.id, stage: f.stage, channel: 'whatsapp', auto: true, status: 'failed',
          message: `campanha:${m.nome}`, error: errMsg(e).slice(0, 500),
        });
        // Modelo não aprovado/pausado, token, conta bloqueada ou limite: para tudo.
        if (code && ((code >= 132000 && code <= 132016) || code === 190 || code === 131031 || code === 368 || code === 131048 || code === 131056)) {
          parouPor = errMsg(e); break;
        }
      }
      await sleep(400);
    }
    return json({ enviados, falhas, parou_por: parouPor, ...resumo });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'crm-campanha', level: 'ERROR', action, error: errMsg(e) }));
    return json({ error: errMsg(e) }, 500);
  }
});
