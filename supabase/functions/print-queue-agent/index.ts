import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface PollPayload {
  action: "poll";
  tenant_id: string;
  limit?: number;
}

interface ConfirmPayload {
  action: "confirm";
  queue_id: string;
  status: "printed" | "failed";
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as PollPayload | ConfirmPayload;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[print-queue-agent] CRITICO: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao configurados");
      return new Response(
        JSON.stringify({ success: false, error: "Configuracao do servidor incompleta" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // FORCA o uso da service_role key nos headers globais — impede que o client
    // herde o Authorization da requisicao original (anon key do agente local)
    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
          },
        },
      }
    );

    // -- POLL: busca tickets pendentes do tenant
    if (body.action === "poll") {
      const { tenant_id, limit = 10 } = body as PollPayload;

      if (!tenant_id) {
        return new Response(
          JSON.stringify({ success: false, error: "tenant_id obrigatorio" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      console.log(`[print-queue-agent] POLL tenant=${tenant_id} limit=${limit}`);

      const { data, error } = await supabaseAdmin
        .from("print_queue")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("status", "pending")
        .lt("retry_count", 5)
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) {
        console.error("[print-queue-agent] poll error:", error);
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      console.log(`[print-queue-agent] POLL encontrou ${data?.length ?? 0} ticket(s)`);

      // Atualiza status para 'printing' para evitar concorrencia entre multiplos agentes
      if (data && data.length > 0) {
        const ids = data.map((d) => d.id);
        const { error: updateError } = await supabaseAdmin
          .from("print_queue")
          .update({ status: "printing", updated_at: new Date().toISOString() })
          .in("id", ids);

        if (updateError) {
          console.error("[print-queue-agent] erro ao marcar printing:", updateError);
        }
      }

      return new Response(
        JSON.stringify({ success: true, tickets: data ?? [] }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // -- CONFIRM: atualiza status apos impressao
    if (body.action === "confirm") {
      const { queue_id, status, error: errMsg } = body as ConfirmPayload;

      if (!queue_id || !status) {
        return new Response(
          JSON.stringify({ success: false, error: "queue_id e status obrigatorios" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      console.log(`[print-queue-agent] CONFIRM queue_id=${queue_id} status=${status}`);

      const updates: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
      };

      if (status === "printed") {
        updates.printed_at = new Date().toISOString();
      }

      // Para failed, incrementa retry_count
      if (status === "failed") {
        const { data: current } = await supabaseAdmin
          .from("print_queue")
          .select("retry_count")
          .eq("id", queue_id)
          .single();

        updates.retry_count = (current?.retry_count ?? 0) + 1;
        if (errMsg) updates.last_error = errMsg;

        // Se excedeu max_retries, marca failed definitivo, senao volta para pending
        if ((current?.retry_count ?? 0) + 1 >= 5) {
          updates.status = "failed";
        } else {
          updates.status = "pending";
        }
      }

      const { error } = await supabaseAdmin
        .from("print_queue")
        .update(updates)
        .eq("id", queue_id);

      if (error) {
        console.error("[print-queue-agent] confirm error:", error);
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      console.log(`[print-queue-agent] CONFIRM ok queue_id=${queue_id}`);

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Acao invalida. Use 'poll' ou 'confirm'." }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[print-queue-agent] exception:", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
