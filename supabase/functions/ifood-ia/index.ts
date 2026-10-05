// ifood-ia — IA da área iFood (2026-10-05).
//
// Ações (POST JSON { action, tenant_id, ... }):
//   sugerir_resposta { nota, comentario, cliente, loja }  → { success, resposta }
//     Sugere a resposta a uma avaliação do iFood. A pessoa lê, edita e envia (review_answer na ifood-shipping);
//     nada é enviado ao iFood daqui.
//
// Autenticação: JWT do usuário com vínculo na loja. Secret: ANTHROPIC_API_KEY.
// Modelo: Haiku 4.5 — texto curto e simples (regra do dono: o mais barato que faz bem).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import Anthropic from 'npm:@anthropic-ai/sdk@0.125.0';
import { authenticate, tenantRole } from '../_shared/tenant-auth.ts';
import { registrarUsoIa } from '../_shared/ai-usage.ts';
import { promptResposta } from './prompt.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MODEL = 'claude-haiku-4-5';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const erro = (msg: string, status = 400) => json({ success: false, error: msg }, status);

const texto = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return erro('Method not allowed', 405);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return erro('Corpo inválido'); }

  const caller = await authenticate(req, admin);
  if (!caller?.userId) return erro('Entre de novo no sistema.', 401);
  const tenantId = String(body.tenant_id ?? '');
  if (!tenantId) return erro('Loja não informada.');
  const role = await tenantRole(admin, caller.userId, tenantId).catch(() => null);
  if (!role) return erro('Sem acesso a esta loja.', 403);

  if (body.action !== 'sugerir_resposta') return erro('Ação desconhecida.');
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return erro('IA não configurada no servidor.', 500);

  const nota = Math.min(5, Math.max(1, Math.round(Number(body.nota) || 0) || 3));
  const p = { nota, comentario: texto(body.comentario, 1200), cliente: texto(body.cliente, 60).split(' ')[0], loja: texto(body.loja, 80) };
  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({ model: MODEL, max_tokens: 300, messages: [{ role: 'user', content: promptResposta(p) }] });
    await registrarUsoIa(admin, { feature: 'ifood-resposta-avaliacao', model: res.model, usage: res.usage, tenantId, userId: caller.userId });
    // deno-lint-ignore no-explicit-any
    const resposta = res.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim().replace(/^"|"$/g, '');
    if (!resposta) return erro('A IA não devolveu texto. Tente de novo.');
    return json({ success: true, resposta: resposta.slice(0, 1000) });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'ifood-ia', level: 'ERROR', msg: e instanceof Error ? e.message : String(e) }));
    return erro('Não consegui sugerir agora. Tente de novo em instantes.', 502);
  }
});
