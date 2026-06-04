import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function log(level: "INFO" | "WARN" | "ERROR", action: string, message: string, ctx?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, fn: "order-edit-lock", action, msg: message, ...(ctx ?? {}) };
  if (level === "ERROR") console.error(JSON.stringify(entry));
  else if (level === "WARN") console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

Deno.serve({ verify_jwt: false }, async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const db = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } });
  void db;

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let jwtUserId: string;
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    jwtUserId = user.id;
  } catch (authErr) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json();
    const { action, order_id, tenant_id } = body;
    if (!action || !order_id || !tenant_id) {
      return new Response(JSON.stringify({ error: "action, order_id and tenant_id are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verificar acesso ao tenant
    const { data: tenantMembership } = await admin.from("user_tenants")
      .select("tenant_id")
      .eq("user_id", jwtUserId)
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    if (!tenantMembership) {
      // Fallback: verifica se o tenant existe (KDS/Gestor pode usar sem user_tenants)
      const { data: tenantExists } = await admin.from("tenants").select("id").eq("id", tenant_id).maybeSingle();
      if (!tenantExists) {
        return new Response(JSON.stringify({ error: "Invalid tenant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const now = new Date().toISOString();

    if (action === "start") {
      const { data: order } = await admin.from("orders")
        .select("id, is_editing, editing_by_user_id, status")
        .eq("id", order_id)
        .eq("tenant_id", tenant_id)
        .maybeSingle();

      if (!order) {
        return new Response(JSON.stringify({ error: "Pedido nao encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Se ja esta sendo editado por OUTRO usuario, retorna lock
      if (order.is_editing && order.editing_by_user_id && order.editing_by_user_id !== jwtUserId) {
        const { data: otherUser } = await admin.from("users").select("name").eq("id", order.editing_by_user_id).maybeSingle();
        return new Response(
          JSON.stringify({
            ok: false,
            locked_by: otherUser?.name ?? "Outro usuario",
            locked_by_id: order.editing_by_user_id,
            message: `Pedido ja esta sendo editado por ${otherUser?.name ?? "outro usuario"}`,
          }),
          { status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Locka o pedido
      await admin.from("orders").update({
        is_editing: true,
        editing_by_user_id: jwtUserId,
        editing_started_at: now,
        updated_at: now,
      }).eq("id", order_id);

      // Audit log
      try {
        await admin.from("audit_log").insert({
          tenant_id: tenant_id,
          user_id: jwtUserId,
          action_type: "order_edit_started",
          entity_type: "order",
          entity_id: order_id,
          details: { started_at: now },
        });
      } catch (auditErr) {
        log("WARN", "start", "audit_log insert falhou", { error: String(auditErr) });
      }

      return new Response(JSON.stringify({ ok: true, editing_by: jwtUserId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "finish") {
      const { was_modified, modifications_summary } = body;

      const { data: order } = await admin.from("orders")
        .select("id, is_editing, editing_by_user_id")
        .eq("id", order_id)
        .eq("tenant_id", tenant_id)
        .maybeSingle();

      if (!order) {
        return new Response(JSON.stringify({ error: "Pedido nao encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Sempre libera o lock, mesmo se outro usuário tinha dado lock (emergência)
      await admin.from("orders").update({
        is_editing: false,
        editing_by_user_id: null,
        editing_started_at: null,
        updated_at: now,
      }).eq("id", order_id);

      if (was_modified) {
        try {
          await admin.from("audit_log").insert({
            tenant_id: tenant_id,
            user_id: jwtUserId,
            action_type: "order_edit_finished",
            entity_type: "order",
            entity_id: order_id,
            details: {
              was_modified: true,
              modifications_summary: modifications_summary ?? null,
              finished_at: now,
            },
          });
        } catch (auditErr) {
          log("WARN", "finish", "audit_log insert falhou", { error: String(auditErr) });
        }
      }

      return new Response(JSON.stringify({ ok: true, was_modified: !!was_modified }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "force_unlock") {
      // Só admin/master pode usar — verificado pelo caller
      await admin.from("orders").update({
        is_editing: false,
        editing_by_user_id: null,
        editing_started_at: null,
        updated_at: now,
      }).eq("id", order_id).eq("tenant_id", tenant_id);

      try {
        await admin.from("audit_log").insert({
          tenant_id: tenant_id,
          user_id: jwtUserId,
          action_type: "order_edit_force_unlocked",
          entity_type: "order",
          entity_id: order_id,
          details: { unlocked_at: now },
        });
      } catch (auditErr) {
        log("WARN", "force_unlock", "audit_log insert falhou", { error: String(auditErr) });
      }

      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log("ERROR", "unhandled", "Excecao nao tratada", { error: errMsg });
    return new Response(JSON.stringify({ error: errMsg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
