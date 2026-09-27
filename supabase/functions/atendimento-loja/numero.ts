// Número PRÓPRIO da loja no WhatsApp (API oficial), sem ninguém entrar na Meta. Criado em 2026-09-27.
//
// Dois jeitos (a tela Delivery › Atendimento WhatsApp chama as ações da edge atendimento-loja):
//   1) CHIP NOVO NA CONTA DO ERPOS — a loja digita o número e o nome; o ERPOS cria o número na conta
//      (WABA) do número compartilhado (asst_settings.wa_public), a Meta manda o código por SMS/ligação,
//      a loja digita o código e o ERPOS registra. Token = WHATSAPP_CLOUD_TOKEN (o do sistema).
//   2) CONECTAR O WHATSAPP DA LOJA (Embedded Signup da Meta) — a loja entra com o Facebook dela numa janela
//      da Meta; a conta, a cobrança e o nome ficam com ela. Exige o ERPOS aprovado como Tech Provider
//      (segredos META_ES_APP_ID, META_ES_APP_SECRET, META_ES_CONFIG_ID). O token do cliente fica em
//      wa_loja_credenciais (só service_role lê) e é usado para enviar por aquele número.
//      TEM que ser o MESMO app do webhook whatsapp-cloud (WHATSAPP_APP_SECRET): a conta do cliente assina o
//      webhook do app dono do token, e o whatsapp-cloud confere a assinatura com esse segredo.
//
// PIN do registro (verificação em duas etapas da Meta): derivado do phone_id com HMAC do segredo interno —
// ninguém precisa anotar, e dá para registrar de novo se a Meta pedir.
// deno-lint-ignore-file no-explicit-any
import { graph } from '../_shared/wa.ts';

const GRAPH = 'https://graph.facebook.com/v25.0';
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

export async function pinDoNumero(phoneId: string): Promise<string> {
  const segredo = Deno.env.get('ASSISTENTE_INTERNAL_KEY') ?? '';
  if (segredo.length < 20) throw new Error('segredo interno ausente');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`wa-pin:${phoneId}`)));
  const n = ((sig[0] << 24) | (sig[1] << 16) | (sig[2] << 8) | sig[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}

/** Número brasileiro em cc + número (a Meta pede separados). Aceita com ou sem 55, com máscara. */
export function separarNumero(raw: string): { cc: string; numero: string } | null {
  let d = digits(raw);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (d.length === 11 && d[2] !== '9') return null;
  return { cc: '55', numero: d };
}

/** Nome que aparece no WhatsApp: regras básicas da Meta (3–100 caracteres, sem link/telefone/e-mail). */
export function nomeValido(nome: string): string | null {
  const n = nome.trim().replace(/\s+/g, ' ');
  if (n.length < 3 || n.length > 100) return 'O nome precisa ter de 3 a 100 caracteres.';
  if (/https?:|www\.|\.com|@|\d{6,}/i.test(n)) return 'O nome não pode ter link, e-mail ou telefone.';
  return null;
}

// ── Jeito 1: chip novo na conta do ERPOS ──
export async function criarNumero(waba: string, cc: string, numero: string, nome: string): Promise<string> {
  const out = await graph(`${waba}/phone_numbers`, { body: { cc, phone_number: numero, verified_name: nome.trim() } });
  const id = String(out?.id ?? '');
  if (!id) throw new Error('a Meta não devolveu o id do número');
  return id;
}
export const pedirCodigo = (phoneId: string, metodo: 'SMS' | 'VOICE', token?: string | null) =>
  graph(`${phoneId}/request_code`, { body: { code_method: metodo, language: 'pt_BR' } }, token);
export const confirmarCodigo = (phoneId: string, codigo: string, token?: string | null) =>
  graph(`${phoneId}/verify_code`, { body: { code: digits(codigo) } }, token);
// pin: o PIN de 2 etapas que o cliente já tinha (número vindo de outro provedor); sem ele, o derivado.
export async function registrar(phoneId: string, token?: string | null, pin?: string | null) {
  const p = String(pin ?? '').replace(/\D/g, '');
  return graph(`${phoneId}/register`, { body: { messaging_product: 'whatsapp', pin: p.length === 6 ? p : await pinDoNumero(phoneId) } }, token);
}
/** Tira o número da API (desligar chip da conta do ERPOS): ele para de receber até registrar de novo. */
export const desregistrar = (phoneId: string, token?: string | null) => graph(`${phoneId}/deregister`, { method: 'POST', body: {} }, token);

/** Números da conta, seguindo a paginação da Meta (até 5 páginas de 100). */
export async function numerosDaConta(waba: string, token?: string | null): Promise<Array<{ id: string; display_phone_number?: string }>> {
  const out: Array<{ id: string; display_phone_number?: string }> = [];
  let path: string | null = `${waba}/phone_numbers?fields=id,display_phone_number&limit=100`;
  for (let i = 0; path && i < 5; i++) {
    const r: any = await graph(path, {}, token);
    out.push(...(r?.data ?? []));
    const next = String(r?.paging?.next ?? '');
    path = next ? next.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, '') : null;
  }
  return out;
}

export async function situacao(phoneId: string, token?: string | null): Promise<Record<string, unknown>> {
  const o = await graph(`${phoneId}?fields=display_phone_number,verified_name,name_status,code_verification_status,status,quality_rating,platform_type`, {}, token);
  return {
    numero: digits(o?.display_phone_number) || null,
    nome: o?.verified_name ?? null,
    nome_status: o?.name_status ?? null,                 // APPROVED | PENDING_REVIEW | DECLINED | …
    verificado: o?.code_verification_status === 'VERIFIED',
    conectado: o?.status === 'CONNECTED',               // registrado e recebendo mensagens
    qualidade: o?.quality_rating ?? null,
    plataforma: o?.platform_type ?? null,               // CLOUD_API quando registrado aqui
  };
}

// ── Jeito 2: Conectar o WhatsApp da loja (Embedded Signup) ──
export const esConfig = () => {
  const appId = Deno.env.get('META_ES_APP_ID') ?? '', segredo = Deno.env.get('META_ES_APP_SECRET') ?? '', configId = Deno.env.get('META_ES_CONFIG_ID') ?? '';
  if (!appId || !segredo || !configId) return null;
  // App diferente do webhook = mensagens do cliente chegariam com outra assinatura (recusadas): nem mostra o botão.
  const doWebhook = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';
  if (doWebhook && doWebhook !== segredo) {
    console.warn(JSON.stringify({ fn: 'atendimento-loja', level: 'WARN', msg: 'META_ES_APP_SECRET ≠ WHATSAPP_APP_SECRET: Conectar WhatsApp desligado (tem que ser o mesmo app do webhook)' }));
    return null;
  }
  return { app_id: appId, config_id: configId, segredo };
};

/** Troca o código da janela da Meta pelo token da empresa do cliente (vale para a conta dele). */
export async function trocarCodigo(code: string): Promise<string> {
  const es = esConfig();
  if (!es) throw new Error('Conectar WhatsApp ainda não está liberado (ERPOS aguardando aprovação na Meta)');
  // Segredo no corpo (não na URL): erro de rede do fetch traz a URL inteira e iria para log/tela.
  let r: Response;
  try {
    r = await fetch(`${GRAPH}/oauth/access_token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: es.app_id, client_secret: es.segredo, code }),
    });
  } catch { throw new Error('Falha ao falar com a Meta. Tente conectar de novo.'); }
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out?.access_token) throw new Error(`Meta recusou a conexão: ${out?.error?.message ?? r.status}`);
  return String(out.access_token);
}

/** Liga a conta do cliente ao webhook do ERPOS (sem isso as mensagens não chegam). */
export const assinarWebhook = (waba: string, token: string) => graph(`${waba}/subscribed_apps`, { method: 'POST', body: {} }, token);
