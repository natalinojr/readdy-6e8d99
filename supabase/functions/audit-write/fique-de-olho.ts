// "Fique de olho" no servidor (2026-10-05): depois que audit-write grava o evento, se ele bate numa regra
// (cancelamento ≥ R$ 100, desconto ≥ R$ 50, sangria ≥ R$ 500) cria/atualiza o cartão do dia da loja na tela
// Hoje (pendência kind 'fique_de_olho' → fn_fique_de_olho_add) e avisa no celular o dono e os Supervisores.
// As regras e os textos são puros em ../_shared/fique-de-olho.ts. NUNCA derruba o registro de auditoria:
// quem chama engole qualquer erro daqui.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  LIMITES_OLHO, regraDoEvento, valorDoEvento, montarItem, ritmoDaPessoa, textoPush, podeAvisarAgora,
  type EventoBruto, type RegraOlho, type LinhaHistorico,
} from '../_shared/fique-de-olho.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIAS_HISTORICO = 29;

export interface EventoOlho extends EventoBruto {
  tenantId: string;
  userId: string;
  entityId: string | null;
}

interface Pedido { id: string; total_amount: number | null; is_training: boolean | null; cancel_reason: string | null }

/**
 * O pedido do cancelamento: pelo id (tela de Pedidos) ou, no Caixa, pelo número (o mais recente das últimas
 * 24 h — o número recomeça a cada turno). Sempre da loja do evento.
 */
async function pedidoDoEvento(admin: SupabaseClient, tenantId: string, entityId: string | null, label: unknown): Promise<Pedido | null> {
  const cols = 'id, total_amount, is_training, cancel_reason';
  if (entityId && UUID_RE.test(entityId)) {
    const { data } = await admin.from('orders').select(cols).eq('tenant_id', tenantId).eq('id', entityId).maybeSingle();
    return (data as Pedido | null) ?? null;
  }
  const numero = typeof label === 'string' ? label.trim().replace(/^#/, '') : '';
  if (!numero || UUID_RE.test(numero)) return null;
  const sem0 = numero.replace(/^0+(?=\d)/, '');
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data } = await admin.from('orders').select(cols).eq('tenant_id', tenantId)
    .in('number', [...new Set([numero, sem0])]).gte('created_at', desde)
    .order('created_at', { ascending: false }).limit(1);
  return ((data ?? [])[0] as Pedido | undefined) ?? null;
}

/** Avalia o evento e, se couber na regra, põe no cartão do dia. Devolve o que fez (para o log). */
export async function fiqueDeOlho(admin: SupabaseClient, e: EventoOlho): Promise<string> {
  const regra = regraDoEvento(e);
  if (!regra) return 'fora das regras';

  // Quem está em modo treino não gera alerta (pedido de treino não entra em relatório nenhum).
  const { data: vinculo } = await admin.from('user_tenants').select('training_mode')
    .eq('tenant_id', e.tenantId).eq('user_id', e.userId).maybeSingle();
  if ((vinculo as { training_mode?: boolean } | null)?.training_mode) return 'modo treino';

  let valor = valorDoEvento(regra, e);
  let motivoDoPedido: string | null = null;
  if (regra === 'cancelamento') {
    const ped = await pedidoDoEvento(admin, e.tenantId, e.entityId, e.entity_label);
    if (ped?.is_training) return 'pedido de treino';
    if (ped) {
      motivoDoPedido = ped.cancel_reason;
      if (valor == null) valor = Number(ped.total_amount ?? 0);
    }
  }
  if (valor == null || !(valor >= LIMITES_OLHO[regra])) return 'abaixo do valor';

  // Quantas vezes hoje e a média da própria pessoa (ou do login, se for o compartilhado do Caixa).
  const agora = new Date();
  const desde = new Date(agora.getTime() - DIAS_HISTORICO * 86400_000).toISOString();
  const { data: hist } = await admin.from('audit_log').select('created_at, action_type, entity_type')
    .eq('tenant_id', e.tenantId).eq('user_id', e.userId).gte('created_at', desde).limit(5000);
  const ritmo = ritmoDaPessoa((hist ?? []) as LinhaHistorico[], regra, agora);

  const item = montarItem({ regra, valor, evento: e, userId: e.userId, agora, motivoDoPedido, ritmo });
  const { data: r, error } = await admin.rpc('fn_fique_de_olho_add', { p_tenant: e.tenantId, p_item: item, p_regra: regra });
  if (error) throw new Error(`fn_fique_de_olho_add: ${error.message}`);
  const res = (r ?? {}) as { ok?: boolean; novo?: boolean; enviar_push?: boolean; motivo?: string };
  // ok=false só para item/regra inválidos. Cartão já fechado ("ciente" ou descartado) NÃO é motivo para calar:
  // a função reabre o cartão só com o que é novo e decide o aviso de celular pelo carimbo da regra (1 por hora, 7h-23h).
  if (!res.ok) return `cartão não gravado (${res.motivo ?? '?'})`;
  if (!res.novo) return 'repetido';
  if (res.enviar_push && podeAvisarAgora(agora)) await avisarCelular(admin, e, regra, item);
  return `cartão atualizado${res.enviar_push ? ' + aviso' : ''}`;
}

/** Dono e Supervisores (papel "manager" no banco) da loja, menos quem fez a ação. Só quem está ativo. */
async function avisarCelular(admin: SupabaseClient, e: EventoOlho, _regra: RegraOlho, item: ReturnType<typeof montarItem>): Promise<void> {
  const { data: equipe } = await admin.from('user_tenants').select('user_id, role').eq('tenant_id', e.tenantId).in('role', ['admin', 'manager']);
  const ids = [...new Set(((equipe ?? []) as Array<{ user_id: string }>).map((m) => m.user_id).filter((id) => id !== e.userId))];
  if (!ids.length) return;
  const { data: ativos } = await admin.from('users').select('id').in('id', ids).or('is_active.is.null,is_active.eq.true').is('deleted_at', null);
  const destino = ((ativos ?? []) as Array<{ id: string }>).map((u) => u.id);
  if (!destino.length) return;
  const { data: loja } = await admin.from('tenants').select('name').eq('id', e.tenantId).maybeSingle();
  const { titulo, corpo } = textoPush((loja as { name?: string } | null)?.name ?? '', item);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) return;
  // Sem tenant_id no envio: o aparelho do dono pode estar inscrito por outra loja (mesmo caminho do aviso de aprovação do PDV).
  const resp = await fetch(`${url}/functions/v1/send-push`, {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'send', user_ids: destino, payload: { titulo, corpo, url: '/hoje', tag: `olho-${e.tenantId}-${item.regra}` } }),
  });
  if (!resp.ok) console.warn('[audit-write] fique-de-olho push HTTP', resp.status);
}
