// WhatsApp Flows — o que o hiring-scheduler (quem manda o formulário) e o whatsapp-flow (o endpoint
// que a Meta chama) dividem: o token do formulário e a configuração em asst_settings.
//
// Token = "<session_id>.<hmac16>": HMAC-SHA256 do id da sessão de agendamento com o
// ASSISTENTE_INTERNAL_KEY, 16 primeiros hex. A Meta devolve o token em cada pedido do Flow; sem ele
// válido o endpoint responde 427 (fecha o formulário). Só o código, sem banco: testável no vitest.
//
// asst_settings.wa_flow_agendamento = { flow_id, ativo, numeros: string[], modo: 'draft' | 'published' }
//   ativo   = manda o formulário depois da lista de horários (offerAgain);
//   numeros = só para esses telefones (vazio = todos) — usado no teste antes de ligar para todo mundo;
//   modo    = 'draft' testa o Flow em rascunho sem publicar.

export interface FlowAgendamentoCfg { flow_id: string | null; ativo: boolean; numeros: string[]; modo: 'draft' | 'published' }

export function lerFlowCfg(value: unknown): FlowAgendamentoCfg {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    flow_id: v.flow_id ? String(v.flow_id) : null,
    ativo: v.ativo === true,
    numeros: Array.isArray(v.numeros) ? v.numeros.map((n) => String(n).replace(/\D/g, '')).filter((n) => n.length >= 10) : [],
    modo: v.modo === 'published' ? 'published' : 'draft',
  };
}

/** Telefone liberado na lista de teste (compara sem o 55 e sem o 9 do celular). Lista vazia = todos. */
export function numeroLiberado(cfg: FlowAgendamentoCfg, fone: string): boolean {
  if (!cfg.numeros.length) return true;
  const k = (s: string) => {
    let d = s.replace(/\D/g, '');
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
    return d;
  };
  return cfg.numeros.some((n) => k(n) === k(fone));
}

async function hmac16(segredo: string, texto: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`wa-flow:${texto}`)));
  return Array.from(mac.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function tokenDoFlow(segredo: string, sessionId: string): Promise<string> {
  if (segredo.length < 20) throw new Error('ASSISTENTE_INTERNAL_KEY ausente');
  return `${sessionId}.${await hmac16(segredo, sessionId)}`;
}

/** id da sessão se o token é nosso; senão null. */
export async function sessaoDoToken(segredo: string, token: unknown): Promise<string | null> {
  const m = String(token ?? '').match(/^([0-9a-f-]{36})\.([0-9a-f]{16})$/i);
  if (!m || segredo.length < 20) return null;
  const esperado = await hmac16(segredo, m[1]);
  let d = 0;
  for (let i = 0; i < esperado.length; i++) d |= esperado.charCodeAt(i) ^ m[2].toLowerCase().charCodeAt(i);
  return d === 0 ? m[1] : null;
}
