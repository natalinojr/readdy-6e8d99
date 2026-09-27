// Envio automático do funil de CRM pelo WhatsApp do assistente (API oficial da Meta).
// Usado pelo crm-funnel (auto_tick) e pelo whatsapp-cloud (resposta do cliente).
// deno-lint-ignore-file no-explicit-any
import { waSendText, type WaConfig } from './wa.ts';

const APP_URL_DEFAULT = 'https://erpos.vercel.app';
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** {{3}} dos modelos: frase fixa por estágio. Texto livre da loja não vai em modelo de marketing. */
export const FRASE_AUTO: Record<string, string> = {
  carrinho_abandonado: 'Vimos que você montou um pedido e não finalizou.',
  nunca_comprou: 'Você se cadastrou no nosso delivery e ainda não experimentou a gente.',
  primeira_compra: 'Obrigado pelo seu primeiro pedido!',
  recorrente: 'Obrigado por pedir sempre com a gente!',
  fiel: 'Você é de casa e a gente agradece a preferência!',
  vip: 'Você é um dos nossos clientes mais especiais!',
  em_risco: 'Faz um tempinho que você não pede com a gente.',
  perdido: 'Sentimos sua falta por aqui!',
};

/** Celular brasileiro só com DDD (11 dígitos, com o 9). Fixo e número estranho: null. */
export function celularBR(phone: unknown): string | null {
  let d = digits(phone);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + '9' + d.slice(2);
  if (d.length !== 11 || d[2] !== '9') return null;
  return d;
}

export interface LojaInfo { nome: string; appUrl: string; deliveryUrl: string | null; whatsappLoja: string | null }

export async function lojaInfo(admin: any, tenantId: string): Promise<LojaInfo> {
  const [{ data: t }, { data: ss }] = await Promise.all([
    admin.from('tenants').select('name, slug').eq('id', tenantId).maybeSingle(),
    admin.from('system_settings').select('delivery_config, app_public_url').eq('tenant_id', tenantId).maybeSingle(),
  ]);
  const appUrl = String(ss?.app_public_url || Deno.env.get('APP_PUBLIC_URL') || APP_URL_DEFAULT).replace(/\/$/, '');
  const wa = digits((ss?.delivery_config as any)?.whatsapp_loja);
  return {
    nome: String(t?.name ?? 'nossa loja'),
    appUrl,
    deliveryUrl: t?.slug ? `${appUrl}/${t.slug}-delivery` : null,
    whatsappLoja: wa.length >= 10 ? (wa.startsWith('55') ? wa : '55' + wa) : null,
  };
}

const SAIR_RE = /^\s*(sair|parar|pare|stop|cancelar|descadastrar|nao quero|não quero)\b/i;

/**
 * Mensagem que chegou no número do assistente de alguém que recebeu envio automático do funil
 * nos últimos 15 dias. SAIR → opt-out em todas as lojas que mandaram. Outra coisa → uma resposta
 * curta com o link do delivery e o WhatsApp da loja (no máx. 1 a cada 6 h, para não virar conversa).
 * Devolve true quando tratou (o whatsapp-cloud não passa adiante).
 */
export async function crmInbound(admin: any, cfg: WaConfig, waId: string, text: string): Promise<boolean> {
  const cel = celularBR(waId);
  if (!cel) return false;
  const variantes = [cel, cel.slice(0, 2) + cel.slice(3)]; // com e sem o 9
  const desde = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();

  const { data: clientes } = await admin.from('customers').select('id, tenant_id').in('phone', variantes);
  const ids = (clientes ?? []).map((c: any) => String(c.id));
  if (ids.length === 0) return false;
  const { data: envios } = await admin.from('crm_sends')
    .select('id, tenant_id, customer_id, sent_at, replied_at')
    .eq('auto', true).eq('status', 'sent').in('customer_id', ids).gte('sent_at', desde)
    .order('sent_at', { ascending: false }).limit(20);
  if (!envios || envios.length === 0) return false;

  const agora = new Date().toISOString();
  const ultimo = envios[0];

  if (SAIR_RE.test(text)) {
    const tenants = Array.from(new Set(envios.map((e: any) => String(e.tenant_id))));
    const alvo = (clientes ?? []).filter((c: any) => tenants.includes(String(c.tenant_id))).map((c: any) => String(c.id));
    await admin.from('customers').update({ crm_opt_out_at: agora }).in('id', alvo).is('crm_opt_out_at', null);
    await admin.from('crm_sends').update({ replied_at: agora }).in('id', envios.map((e: any) => e.id)).is('replied_at', null);
    const nomes = await Promise.all(tenants.map(async (t) => (await lojaInfo(admin, t)).nome));
    await waSendText(cfg, waId, `Pronto! Você não vai mais receber ofertas da ${nomes.join(' e ')} por aqui. Se mudar de ideia, é só avisar na loja.`, { origin: 'crm' });
    return true;
  }

  const recente = envios.find((e: any) => e.replied_at && Date.now() - new Date(e.replied_at).getTime() < 6 * 60 * 60 * 1000);
  await admin.from('crm_sends').update({ replied_at: agora }).eq('id', ultimo.id);
  if (recente) return true; // já respondeu há pouco: fica só no registro

  const loja = await lojaInfo(admin, String(ultimo.tenant_id));
  const partes = [`Oi! Este número só envia as ofertas da ${loja.nome} 😊`];
  if (loja.deliveryUrl) partes.push(`Para pedir: ${loja.deliveryUrl}`);
  if (loja.whatsappLoja) partes.push(`Para falar com a loja: https://wa.me/${loja.whatsappLoja}`);
  partes.push('Se não quiser mais receber, responda SAIR.');
  await waSendText(cfg, waId, partes.join('\n'), { origin: 'crm' });
  return true;
}
