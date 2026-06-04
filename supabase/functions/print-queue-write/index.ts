import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface PrintQueuePayload {
  tenant_id: string;
  order_id?: string;
  order_number: string;
  station_key: string;
  station_label: string;
  impressora_id?: string;
  impressora_nome?: string;
  impressora_ip?: string;
  impressora_port?: number;
  content_type?: string;
  payload: Record<string, unknown>;
  raw_data?: string;
  paper_style?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as PrintQueuePayload;

    if (!body.tenant_id || !body.order_number || !body.station_key || !body.payload) {
      return new Response(
        JSON.stringify({ success: false, error: "tenant_id, order_number, station_key e payload sao obrigatorios" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[print-queue-write] CRITICO: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao configurados");
      return new Response(
        JSON.stringify({ success: false, error: "Configuracao do servidor incompleta" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // FORCA o uso da service_role key nos headers globais
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

    console.log(`[print-queue-write] INSERT tenant=${body.tenant_id} order=${body.order_number} station=${body.station_key}`);

    const { data, error } = await supabaseAdmin
      .from("print_queue")
      .insert({
        tenant_id: body.tenant_id,
        order_id: body.order_id ?? null,
        order_number: body.order_number,
        station_key: body.station_key,
        station_label: body.station_label,
        impressora_id: body.impressora_id ?? null,
        impressora_nome: body.impressora_nome ?? null,
        impressora_ip: body.impressora_ip ?? null,
        impressora_port: body.impressora_port ?? 9100,
        content_type: body.content_type ?? "ticket_json",
        payload: body.payload,
        raw_data: body.raw_data ?? null,
        paper_style: body.paper_style ?? "80mm",
        status: "pending",
        retry_count: 0,
        max_retries: 5,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[print-queue-write] insert error:", error);
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`[print-queue-write] INSERT ok queue_id=${data?.id}`);

    return new Response(
      JSON.stringify({ success: true, queue_id: data?.id }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[print-queue-write] exception:", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
