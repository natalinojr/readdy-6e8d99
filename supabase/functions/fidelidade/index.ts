// Programa de fidelidade — configuração por loja (Fase 1: configurar e simular).
//
// Ações:
//   get   → config da loja (padrão se nunca salvou) + dados para a simulação:
//           histograma de compras por cliente (na janela da trilha e nos
//           últimos 90 dias) e itens do cardápio para escolher recompensas.
//   save  → valida/normaliza e grava. Admin/gerente, ou papel com
//           gestao_promocoes marcado na matriz de permissões da loja.
//
// Nada aqui credita ponto nem aplica desconto: isso é a Fase 2.
// Auth: verify_jwt = false no deploy; JWT validado aqui + vínculo com a loja.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authenticate, isManagerRole, tenantRole } from "../_shared/tenant-auth.ts";
import { configPadrao, normalizarConfig } from "../_shared/fidelidade.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const V = "v1";

function jsonErr(msg: string, code = 400) {
  return new Response(JSON.stringify({ _v: V, error: msg, message: msg }), {
    status: code,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ok(payload: Record<string, unknown>) {
  return new Response(JSON.stringify({ _v: V, ...payload }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function podeEditar(admin: any, tenantId: string, role: string): Promise<boolean> {
  if (isManagerRole(role)) return true;
  const { data } = await admin.from("permissions").select("allowed")
    .eq("tenant_id", tenantId).eq("role", role).eq("permission_key", "gestao_promocoes")
    .limit(1).maybeSingle();
  return data?.allowed === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const tenantId = String(body.tenant_id ?? body.active_tenant_id ?? "");
    if (!action) return jsonErr("action obrigatoria");
    if (!tenantId) return jsonErr("tenant_id obrigatorio");

    const caller = await authenticate(req, admin);
    if (!caller) return jsonErr("Não autenticado", 401);
    let role = "admin";
    if (!caller.isServiceRole) {
      const r = await tenantRole(admin, caller.userId!, tenantId);
      if (!r) return jsonErr("Sem acesso a esta loja.", 403);
      role = r;
    }
    const editavel = caller.isServiceRole || await podeEditar(admin, tenantId, role);

    if (action === "get") {
      const { data: row, error } = await admin
        .from("loyalty_programs").select("enabled, config, updated_at, updated_by")
        .eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      const config = row ? normalizarConfig(row.config) : configPadrao();

      // Janela da trilha pedida pela tela (a pessoa pode estar mexendo sem ter salvo).
      const janela = Math.max(0, Math.min(3650, Math.round(Number(body.janela_dias ?? config.trilha.janela_dias) || 0)));
      const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

      const [histTrilha, hist90, produtos] = await Promise.all([
        admin.rpc("fn_fidelidade_histograma", { p_tenant_id: tenantId, p_desde: janela > 0 ? dias(janela) : null }),
        admin.rpc("fn_fidelidade_histograma", { p_tenant_id: tenantId, p_desde: dias(90) }),
        admin.from("menu_items").select("id, name, price")
          .eq("tenant_id", tenantId).is("deleted_at", null).eq("is_active", true).order("name").limit(2000),
      ]);
      if (histTrilha.error) throw histTrilha.error;
      if (hist90.error) throw hist90.error;

      const conv = (rows: any[] | null) => (rows ?? []).map((r) => ({
        compras: Number(r.compras), clientes: Number(r.clientes), gasto: Number(r.gasto ?? 0),
      }));

      return ok({
        enabled: row?.enabled ?? false,
        salvo: !!row,
        updated_at: row?.updated_at ?? null,
        config,
        editavel,
        janela_dias: janela,
        histograma: conv(histTrilha.data),
        histograma_90d: conv(hist90.data),
        produtos: (produtos.data ?? []).map((p: any) => ({ id: p.id, nome: p.name, preco: Number(p.price ?? 0) })),
      });
    }

    if (action === "save") {
      if (!editavel) return jsonErr("Seu perfil não pode alterar o programa de fidelidade.", 403);
      const config = normalizarConfig(body.config);
      const enabled = body.enabled === true;
      const { error } = await admin.from("loyalty_programs").upsert({
        tenant_id: tenantId,
        enabled,
        config,
        updated_at: new Date().toISOString(),
        updated_by: caller.userId,
      }, { onConflict: "tenant_id" });
      if (error) throw error;
      return ok({ enabled, config });
    }

    return jsonErr(`action desconhecida: ${action}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String((e as any)?.message ?? e);
    console.error("[fidelidade]", msg);
    return jsonErr(msg, 500);
  }
});
