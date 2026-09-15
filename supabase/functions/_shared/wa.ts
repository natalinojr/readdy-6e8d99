// Envio de WhatsApp do atendimento PÚBLICO (link de candidatura + agendamento de entrevistas).
// Dois transportes, escolhidos em asst_settings.wa_public = { transport, phone_id, waba_id }:
//   • 'cloud'     → API oficial da Meta (Cloud API), token no segredo WHATSAPP_CLOUD_TOKEN.
//   • 'evolution' → conexão não oficial (Baileys). O número do assistente foi BANIDO nela em 2026-09-14.
// Trocar o transporte (ou o número) é mudar a linha no banco — sem deploy.
// O assistente pessoal do dono continua no assistente-webhook (Evolution) e não usa este módulo.
// deno-lint-ignore-file no-explicit-any

export type WaTransport = 'evolution' | 'cloud';
export interface WaConfig { transport: WaTransport; phone_id: string | null; waba_id: string | null }
export type WaKey = { remoteJid: string; fromMe: boolean; id: string };

/** Erro de envio. `code` é o código da Meta (ex.: 131047 = fora da janela de 24 h → só modelo). */
export class WaError extends Error {
  constructor(message: string, public status: number, public code: number | null) { super(message); }
}
/** A empresa está fora da janela de 24 h: só pode mandar modelo aprovado. */
export const isOutsideWindow = (e: unknown) => e instanceof WaError && (e.code === 131047 || e.code === 470);

const GRAPH = 'https://graph.facebook.com/v25.0';
const cloudToken = () => Deno.env.get('WHATSAPP_CLOUD_TOKEN') ?? '';
const evoUrl = (Deno.env.get('EVOLUTION_URL') ?? '').replace(/\/$/, '');
const evoKey = Deno.env.get('EVOLUTION_API_KEY') ?? '';
const evoInstance = Deno.env.get('EVOLUTION_INSTANCE') || 'assistente';
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

// ── Modelos (a empresa falando primeiro, fora das 24 h). Criados na Meta pela ação setup_templates
// do whatsapp-cloud; os nomes são usados pelo hiring-scheduler. Regra da Meta: o texto não pode
// começar nem terminar com variável, e variável não aceita quebra de linha.
export const TEMPLATES = {
  convite: {
    name: 'convite_entrevista',
    text: 'Olá, {{1}}! Aqui é da {{2}}. Recebemos seu currículo para a vaga de {{3}} e queremos marcar uma entrevista com você. Posso te mandar os horários disponíveis? Responda esta mensagem para continuar.',
    example: ['Maria', 'TBA Ipanema', 'Atendente'],
  },
  lembrete: {
    name: 'lembrete_entrevista',
    text: 'Olá, {{1}}! Lembrete da sua entrevista na {{2}}: {{3}}. Local: {{4}}. Você confirma presença? Responda sim ou não.',
    example: ['Maria', 'TBA Ipanema', 'terça-feira, 15/09 às 14:00', 'Rod PR 412, 4911 - Ipanema'],
  },
  aviso_equipe: {
    name: 'aviso_equipe_entrevista',
    text: 'Atualização do agendamento de entrevistas da vaga {{1}}: {{2}}. Responda por aqui se precisar.',
    example: ['Atendente', 'Maria marcou entrevista para terça-feira, 15/09 às 14:00'],
  },
} as const;

let cache: { at: number; cfg: WaConfig } | null = null;
export async function waConfig(admin: any): Promise<WaConfig> {
  if (cache && Date.now() - cache.at < 60_000) return cache.cfg;
  const { data } = await admin.from('asst_settings').select('value').eq('key', 'wa_public').maybeSingle();
  const v = (data?.value ?? {}) as Record<string, unknown>;
  const cfg: WaConfig = {
    transport: v.transport === 'cloud' ? 'cloud' : 'evolution',
    phone_id: v.phone_id ? String(v.phone_id) : null,
    waba_id: v.waba_id ? String(v.waba_id) : null,
  };
  cache = { at: Date.now(), cfg };
  return cfg;
}

// Na API oficial o destino é o telefone (só dígitos). @lid é coisa da Evolution: não serve lá.
// Celular brasileiro sempre COM o 9: a Meta entrega o wa_id de números antigos sem ele (554199441497),
// e a lista de destinatários do número de teste (e o cadastro de muita gente) está com ele — sem o 9 a
// Meta recusa com 131030 (teste de 2026-09-14). Fixo (DDD + 2 a 5) fica como veio.
function cloudTo(to: string): string {
  const t = String(to ?? '');
  if (t.endsWith('@lid')) throw new WaError('destino @lid não existe na API oficial', 400, null);
  const d = digits(t.replace(/@.*$/, ''));
  if (d.length === 12 && d.startsWith('55') && /[6-9]/.test(d[4])) return `${d.slice(0, 4)}9${d.slice(4)}`;
  return d;
}

export async function graph(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const token = cloudToken();
  if (!token) throw new WaError('WHATSAPP_CLOUD_TOKEN não configurado', 500, null);
  const r = await fetch(`${GRAPH}/${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = out?.error ?? {};
    throw new WaError(`Meta ${r.status}: ${err.message ?? ''}${err.error_data?.details ? ` (${err.error_data.details})` : ''}`.slice(0, 400), r.status, Number(err.code ?? 0) || null);
  }
  return out;
}
async function cloudSend(cfg: WaConfig, body: Record<string, unknown>) {
  if (!cfg.phone_id) throw new WaError('wa_public.phone_id não configurado', 500, null);
  return graph(`${cfg.phone_id}/messages`, { body: { messaging_product: 'whatsapp', ...body } });
}
async function evo(path: string, body: unknown) {
  const r = await fetch(`${evoUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: evoKey }, body: JSON.stringify(body) });
  if (!r.ok) throw new WaError(`Evolution ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`, r.status, null);
  return r.json().catch(() => ({}));
}

/** Texto livre. Devolve o id da mensagem (recibos entregue/lida). */
export async function waSendText(cfg: WaConfig, to: string, text: string, opts: { delayMs?: number } = {}): Promise<string | null> {
  if (cfg.transport === 'cloud') {
    const out = await cloudSend(cfg, { recipient_type: 'individual', to: cloudTo(to), type: 'text', text: { body: text.slice(0, 4096), preview_url: true } });
    return out?.messages?.[0]?.id ?? null;
  }
  const out = await evo(`/message/sendText/${evoInstance}`, { number: to, text, ...(opts.delayMs ? { delay: opts.delayMs } : {}) });
  return out?.key?.id ?? null;
}

// Variável de modelo: sem quebra de linha/tab e sem 4+ espaços seguidos (regra da Meta).
const tplParam = (s: unknown) => String(s ?? '').replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, ' ').trim().slice(0, 1000) || '-';

/** Modelo aprovado (só API oficial). */
export async function waSendTemplate(cfg: WaConfig, to: string, name: string, params: string[], lang = 'pt_BR'): Promise<string | null> {
  if (cfg.transport !== 'cloud') throw new WaError('modelo só existe na API oficial', 400, null);
  const out = await cloudSend(cfg, {
    recipient_type: 'individual', to: cloudTo(to), type: 'template',
    template: { name, language: { code: lang }, ...(params.length ? { components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: tplParam(t) })) }] } : {}) },
  });
  return out?.messages?.[0]?.id ?? null;
}

/** Reação (👀, ✅…). emoji '' tira a reação. */
export async function waReact(cfg: WaConfig, key: WaKey | null, emoji: string): Promise<void> {
  if (!key?.id) return;
  if (cfg.transport === 'cloud') {
    await cloudSend(cfg, { recipient_type: 'individual', to: cloudTo(key.remoteJid), type: 'reaction', reaction: { message_id: key.id, emoji } });
    return;
  }
  await evo(`/message/sendReaction/${evoInstance}`, { key, reaction: emoji });
}

/** "digitando…". Na API oficial precisa do id da mensagem recebida (e já marca como lida). */
export async function waTyping(cfg: WaConfig, to: string, ms: number, messageId?: string | null): Promise<void> {
  if (cfg.transport === 'cloud') {
    if (!messageId) return;
    await cloudSend(cfg, { status: 'read', message_id: messageId, typing_indicator: { type: 'text' } });
    return;
  }
  await evo(`/chat/sendPresence/${evoInstance}`, { number: to, presence: 'composing', delay: ms });
}

/** Número do WhatsApp do atendimento (para montar os links wa.me). */
export async function waOwnNumber(cfg: WaConfig): Promise<string | null> {
  if (cfg.transport === 'cloud') {
    if (!cfg.phone_id) return null;
    const out = await graph(`${cfg.phone_id}?fields=display_phone_number`);
    const d = digits(out?.display_phone_number);
    return d.length >= 10 ? d : null;
  }
  const r = await fetch(`${evoUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(evoInstance)}`, { headers: { apikey: evoKey } });
  if (!r.ok) throw new WaError(`Evolution fetchInstances → ${r.status}`, r.status, null);
  const out = await r.json();
  const it = Array.isArray(out) ? out[0] : out;
  const raw = String(it?.ownerJid ?? it?.instance?.owner ?? it?.instance?.ownerJid ?? it?.number ?? it?.owner ?? '');
  const d = digits(raw.replace(/@.*$/, ''));
  return d.length >= 10 ? d : null;
}
