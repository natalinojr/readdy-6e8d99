import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

// Portal do motoboy (acesso por link com o order_id como token). Publico (sem login):
// o link e compartilhado pela loja apenas com o motoboy daquele pedido.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const VALID_SIGNALS = ["a_caminho_loja", "coletou", "entregou", "problema"];

function nomeLimpo(dn: string | null): string {
  const n = (dn ?? "").trim();
  if (!n) return "Cliente";
  return n.split(/\s+[-–—]\s+/)[0].trim() || "Cliente";
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const body = await req.json();
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !key) return json({ error: "config" }, 500);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const orderId = String(body.order_id ?? "");
    if (!orderId) return json({ error: "order_id obrigatorio" }, 400);

    if (body.action === "get_order") {
      const { data: order, error } = await admin.from("orders")
        .select("id, number, destination_name, delivery_address, total_amount, delivery_fee, notes, status, motoboy_status, motoboy_note, out_for_delivery_at, origin_type")
        .eq("id", orderId).maybeSingle();
      if (error || !order) return json({ error: "not_found" }, 200);
      if (order.origin_type !== "delivery") return json({ error: "not_delivery" }, 200);
      const { data: items } = await admin.from("order_items").select("item_name, quantity").eq("order_id", orderId);
      return json({
        ok: true,
        order: {
          number: order.number,
          cliente: nomeLimpo(order.destination_name as string | null),
          endereco: order.delivery_address ?? "",
          total: Number(order.total_amount ?? 0),
          taxa: Number(order.delivery_fee ?? 0),
          pagamento: order.notes ?? "",
          status: order.status,
          motoboy_status: order.motoboy_status ?? null,
          motoboy_note: order.motoboy_note ?? null,
          em_rota: !!order.out_for_delivery_at,
          itens: (items ?? []).map((i: Record<string, unknown>) => ({ nome: i.item_name, qtd: i.quantity ?? 1 })),
        },
      });
    }

    if (body.action === "signal") {
      const signal = String(body.signal ?? "");
      if (!VALID_SIGNALS.includes(signal)) return json({ error: "signal_invalido" }, 400);
      const motivo = signal === "problema" ? String(body.motivo ?? "").slice(0, 500) : null;
      const nowIso = new Date().toISOString();
      const updates: Record<string, unknown> = {
        motoboy_status: signal,
        motoboy_note: motivo,
        motoboy_updated_at: nowIso,
        updated_at: nowIso,
      };
      if (signal === "coletou") updates.out_for_delivery_at = nowIso;
      if (signal === "entregou") {
        updates.status = "delivered";
        updates.out_for_delivery_at = nowIso;
      }
      const { error: upErr } = await admin.from("orders").update(updates).eq("id", orderId);
      if (upErr) return json({ error: upErr.message }, 500);
      if (signal === "entregou") {
        await admin.from("order_items").update({ status: "delivered" }).eq("order_id", orderId);
      }
      return json({ ok: true, motoboy_status: signal });
    }

    return json({ error: "acao_invalida" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "erro" }, 500);
  }
});
