// Clube de fidelidade — lado do CLIENTE, sem login no ERPOS (página /clube/<loja>,
// e o delivery/mesa quando o cliente quer usar prêmio).
//
// Ações (loja por `slug` ou `tenant_id`; sessão por `token` do "cartão do clube"):
//   programa     {slug|tenant_id}                → regras públicas (níveis, prêmios, como ganhar)
//   entrar / entrar_link / cadastrar → DESLIGADOS (2026-10-09): a página, o checkout e os jogos
//                entram pelo clube-app (CPF + celular completo, aviso de "aparelho novo"). Ficam
//                respondendo "atualize a página" para quem estiver com a versão antiga aberta.
//   eu           {token}                          → resumo + extrato + regras
//   reservar     {token, recompensa_id | beneficio_id} → reserva (2 h) para usar num pedido
//   girar        {token}                          → sorteio da roleta (no banco)
//   liberar      {token, hold_ids}
//   sair         {token}
// O celular completo é pedido para ENTRAR (5 erros = 15 min bloqueado). Com o cartão
// (token) no aparelho, usar prêmio não pede de novo — a não ser que o cliente tenha
// ligado a digital no app: aí a reserva é pelo clube-app, com a digital (passkey).
// verify_jwt = false no deploy (página pública).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { dadosDoClienteDoClube, programaPublicoDaLoja } from "../_shared/clube-dados.ts";
import {
  idsValidos, sessaoDoClube,
} from "../_shared/clube-servidor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function resp(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ _v: "v1", ...payload }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const erro = (msg: string, status = 400) => resp({ error: msg, message: msg }, status);
const erroRpc = (e: any) => String(e?.message ?? e ?? "Erro").replace(/^.*?ERROR:\s*/i, "").slice(0, 200);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    async function lojaDoBody(): Promise<{ id: string; nome: string; slug: string | null } | null> {
      if (body.tenant_id && /^[0-9a-f-]{36}$/i.test(String(body.tenant_id))) {
        const { data } = await admin.from("tenants").select("id, name, slug, is_active").eq("id", String(body.tenant_id)).maybeSingle();
        return data && data.is_active !== false ? { id: data.id, nome: data.name, slug: data.slug } : null;
      }
      const slug = String(body.slug ?? "").trim();
      if (!slug) return null;
      const { data } = await admin.from("tenants").select("id, name, slug, is_active").eq("slug", slug).limit(1).maybeSingle();
      return data && data.is_active !== false ? { id: data.id, nome: data.name, slug: data.slug } : null;
    }

    // Regras públicas, extrato e dados do cliente: _shared/clube-dados.ts (o app do clube usa os mesmos).
    const programaPublico = (tenantId: string) => programaPublicoDaLoja(admin, tenantId);
    const dadosDoCliente = (tenantId: string, customerId: string) => dadosDoClienteDoClube(admin, tenantId, customerId);

    if (action === "programa") {
      const loja = await lojaDoBody();
      if (!loja) return erro("Loja não encontrada.", 404);
      const prog = await programaPublico(loja.id);
      return resp({ ativo: !!prog, loja: { nome: loja.nome, slug: loja.slug, tenant_id: loja.id }, programa: prog });
    }

    // Entrar/cadastrar agora é só pelo clube-app (avisa os outros aparelhos do cliente).
    if (action === "entrar" || action === "cadastrar" || action === "entrar_link") {
      return erro("Atualize a página: o clube mudou e agora entra pelo app novo.", 410);
    }

    // Daqui para baixo: precisa do cartão do clube.
    const sessao = await sessaoDoClube(admin, body.token);
    if (!sessao) return erro("Sua sessão do clube acabou. Entre de novo.", 401);
    // Digital para abrir ligada no app: dados e roleta só depois de confirmar a digital
    // (a confirmação é feita pelo clube-app e vale 30 min).
    let travado = false;
    if (sessao.digital_abrir && !(sessao.desbloqueado_ate && new Date(sessao.desbloqueado_ate).getTime() > Date.now())) {
      const { count } = await admin.from("loyalty_passkeys").select("id", { count: "exact", head: true }).eq("session_id", sessao.id);
      travado = !!count;
    }
    if (travado && !["sair", "liberar"].includes(action)) return resp({ error: "bloqueado", message: "Confirme com a sua digital para abrir." }, 423);
    if (!(await programaPublico(sessao.tenant_id)) && action !== "sair") return erro("O clube desta loja não está ativo.");

    if (action === "eu") {
      return resp(await dadosDoCliente(sessao.tenant_id, sessao.customer_id));
    }

    if (action === "reservar") {
      // Digital ligada para usar prêmio: só pelo clube-app, que confere a digital.
      if (sessao.digital_premio) return resp({ error: "precisa_digital", message: "Confirme com a sua digital para usar o prêmio." }, 403);
      const { data, error } = body.beneficio_id
        ? await admin.rpc("fn_fidelidade_reservar_beneficio", { p_customer: sessao.customer_id, p_beneficio: String(body.beneficio_id) })
        : await admin.rpc("fn_fidelidade_reservar", { p_customer: sessao.customer_id, p_recompensa: String(body.recompensa_id ?? "") });
      if (error) return erro(erroRpc(error));
      const { data: res } = await admin.rpc("fn_fidelidade_resumo", { p_customer: sessao.customer_id });
      return resp({ reserva: data, resumo: res });
    }

    // Roleta pelo celular: mesmo sorteio do tablet (no banco, com limite por dia da loja).
    if (action === "girar") {
      const { data, error } = await admin.rpc("fn_fidelidade_girar", { p_customer: sessao.customer_id });
      if (error) return erro(erroRpc(error));
      return resp({ giro: data });
    }

    if (action === "liberar") {
      const ids = idsValidos(body.hold_ids);
      if (ids.length > 0) {
        const { error } = await admin.rpc("fn_fidelidade_liberar", { p_customer: sessao.customer_id, p_ids: ids });
        if (error) throw error;
      }
      if (travado) return resp({ liberado: ids.length });
      const { data: res } = await admin.rpc("fn_fidelidade_resumo", { p_customer: sessao.customer_id });
      return resp({ liberado: ids.length, resumo: res });
    }

    if (action === "sair") {
      await admin.from("loyalty_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", sessao.id);
      // Saiu deste aparelho: as notificações e a digital dele vão junto.
      await admin.from("loyalty_push_subscriptions").delete().eq("session_id", sessao.id);
      await admin.from("loyalty_passkeys").delete().eq("session_id", sessao.id);
      return resp({ saiu: true });
    }

    return erro(`action desconhecida: ${action}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String((e as any)?.message ?? e);
    console.error("[clube-publico]", msg);
    return erro("Não consegui falar com o clube agora. Tente de novo.", 500);
  }
});
