import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Busca um usuário do auth pelo email PAGINANDO listUsers.
 * Último recurso: listUsers() sem paginação só enxerga a 1ª página (50),
 * o que quebrava a autenticação dos totens quando o projeto passava de
 * 50 usuários. Usar apenas quando a tabela espelho `users` não tem a linha.
 */
async function findAuthUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

/**
 * kiosk-auth: Autentica um totem de autoatendimento via token único.
 *
 * O totem apresenta seu token (gerado pelo operador nas configurações).
 * A edge function valida o token, cria/recupera um usuário de serviço para o totem,
 * e retorna um JWT válido que o totem usa para chamar order-write.
 *
 * POST body: { token: string }
 * Response: { access_token, tenant_id, kiosk_label, session_id? }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Server misconfiguration" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Suppress unused variable warning
  void anonKey;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json();
    const { token } = body;

    if (!token || typeof token !== "string" || token.length < 10) {
      return new Response(
        JSON.stringify({ error: "Token inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Validar token e obter tenant_id
    const { data: tokenRows, error: tokenErr } = await admin.rpc("fn_validate_kiosk_token", {
      p_token: token,
    });

    if (tokenErr || !tokenRows || tokenRows.length === 0) {
      console.error("[kiosk-auth] Token inválido ou revogado:", tokenErr?.message);
      return new Response(
        JSON.stringify({ error: "Token inválido ou revogado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { tenant_id, token_id, label } = tokenRows[0];

    // 2. Criar/recuperar usuário de serviço para este totem
    // Email único baseado no token_id para identificar o totem
    const kioskEmail = `kiosk-${token_id}@kiosk.erpos.internal`;
    // ATENÇÃO: bcrypt (GoTrue) rejeita senha > 72 bytes — a fórmula antiga
    // `kiosk_${token}_secure` tinha 77 chars e derrubava o createUser com 500.
    // 40 hex chars do token = 160 bits de entropia, suficiente.
    const kioskPassword = `kiosk_${token.slice(0, 40)}_secure`;

    let kioskUserId: string | null = null;

    // Tenta buscar usuário existente pelo email na tabela espelho `users`
    // (este endpoint faz upsert nela a cada autenticação, então todo totem
    // que já autenticou uma vez tem a linha — busca indexada, sem limite de 50)
    const { data: mirrorUser } = await admin
      .from("users")
      .select("id")
      .eq("email", kioskEmail)
      .maybeSingle();

    if (mirrorUser?.id) {
      kioskUserId = mirrorUser.id;
    } else {
      // Cria novo usuário de serviço para o totem
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email: kioskEmail,
        password: kioskPassword,
        email_confirm: true,
        user_metadata: {
          name: `Totem: ${label}`,
          role: "tablet",
          tenant_id,
          kiosk_token_id: token_id,
        },
      });

      if (newUser?.user) {
        kioskUserId = newUser.user.id;
      } else {
        // Pode existir no auth sem espelho em `users` (auth anterior que falhou
        // no meio) — createUser devolve "already registered". Procura paginando.
        console.warn("[kiosk-auth] createUser falhou, procurando no auth:", createErr?.message);
        kioskUserId = await findAuthUserByEmail(admin, kioskEmail);

        if (!kioskUserId) {
          console.error("[kiosk-auth] Erro ao criar usuário do totem:", createErr?.message);
          return new Response(
            JSON.stringify({ error: "Erro ao configurar totem", detail: createErr?.message ?? null }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    // Garante que o usuário existe na tabela users
    await admin.from("users").upsert(
      {
        id: kioskUserId,
        name: `Totem: ${label}`,
        email: kioskEmail,
        is_active: true,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );

    // Vincula ao tenant com role 'tablet' (único role válido para totem no enum user_role)
    await admin.from("user_tenants").upsert(
      {
        user_id: kioskUserId,
        tenant_id,
        role: "tablet",
      },
      { onConflict: "user_id,tenant_id", ignoreDuplicates: false },
    );

    // 3. Gerar JWT para o totem via sign-in
    const { data: signInData, error: signInErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: kioskEmail,
    });

    if (signInErr || !signInData) {
      // Fallback: usa signInWithPassword
      const { data: pwData, error: pwErr } = await admin.auth.signInWithPassword({
        email: kioskEmail,
        password: kioskPassword,
      });

      if (pwErr || !pwData?.session) {
        console.error("[kiosk-auth] Erro ao gerar sessão:", pwErr?.message);
        return new Response(
          JSON.stringify({ error: "Erro ao autenticar totem" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Busca sessão ativa do tenant para o totem
      const { data: activeSessions } = await admin.rpc("fn_get_active_session", {
        p_tenant_id: tenant_id,
      });
      const activeSession = activeSessions?.[0];

      return new Response(
        JSON.stringify({
          access_token: pwData.session.access_token,
          refresh_token: pwData.session.refresh_token,
          tenant_id,
          kiosk_label: label,
          kiosk_user_id: kioskUserId,
          session_id: activeSession?.id ?? null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Usa o token do magic link para fazer sign-in
    const { data: verifyData, error: verifyErr } = await admin.auth.verifyOtp({
      token_hash: signInData.properties?.hashed_token ?? "",
      type: "magiclink",
    });

    if (verifyErr || !verifyData?.session) {
      // Fallback para password
      const { data: pwData, error: pwErr } = await admin.auth.signInWithPassword({
        email: kioskEmail,
        password: kioskPassword,
      });

      if (pwErr || !pwData?.session) {
        return new Response(
          JSON.stringify({ error: "Erro ao autenticar totem" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: activeSessions } = await admin.rpc("fn_get_active_session", {
        p_tenant_id: tenant_id,
      });

      return new Response(
        JSON.stringify({
          access_token: pwData.session.access_token,
          refresh_token: pwData.session.refresh_token,
          tenant_id,
          kiosk_label: label,
          kiosk_user_id: kioskUserId,
          session_id: activeSessions?.[0]?.id ?? null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: activeSessions } = await admin.rpc("fn_get_active_session", {
      p_tenant_id: tenant_id,
    });

    return new Response(
      JSON.stringify({
        access_token: verifyData.session.access_token,
        refresh_token: verifyData.session.refresh_token,
        tenant_id,
        kiosk_label: label,
        kiosk_user_id: kioskUserId,
        session_id: activeSessions?.[0]?.id ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[kiosk-auth] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
