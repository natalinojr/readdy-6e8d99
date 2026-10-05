// Painel de senhas na TV — leitura pública por token (página /senhas/<token>, sem login de pessoa).
//
// POST { token, logo? } → { status: 'ok' | 'desligado' | 'invalido', tenant_id?, agora?, loja?, preparando?, prontas? }
//
// O que um anônimo com o link consegue ler (e só isso): nome/cor/logo da loja e a lista de NÚMEROS de
// senha "preparando" e "pode retirar" (+ hora em que ficou pronta). Nunca nome de cliente, itens, valores,
// telefone ou ids de pedido. Toda a regra está na RPC fn_tv_senhas_painel (só service_role).
// O token é próprio desta tela (tv_senhas_tokens); o do totem (kiosk_tokens) não serve aqui e vice-versa.
// verify_jwt = false no deploy (página pública, a autorização é o token).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function resp(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return resp({ status: "invalido", error: "Use POST." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(token)) return resp({ status: "invalido" });

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("fn_tv_senhas_painel", { p_token: token, p_com_logo: body?.logo === true });
    if (error) {
      console.error("[senhas-tv] rpc:", error.message);
      return resp({ status: "erro", error: "Não consegui ler as senhas agora." }, 500);
    }
    return resp((data ?? { status: "invalido" }) as Record<string, unknown>);
  } catch (e: any) {
    console.error("[senhas-tv] erro:", e?.message ?? e);
    return resp({ status: "erro", error: "Não consegui ler as senhas agora." }, 500);
  }
});
