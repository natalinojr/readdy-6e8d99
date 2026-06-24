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

// Pedidos de delivery "em aberto" pro motoboy = ainda nao entregues/cancelados.
const STATUS_ABERTOS = ["new", "preparing", "ready"];

function nomeLimpo(dn: string | null): string {
  const n = (dn ?? "").trim();
  if (!n) return "Cliente";
  return n.split(/\s+[-–—]\s+/)[0].trim() || "Cliente";
}

// Normaliza celular pra comparacao/armazenamento (so digitos).
function phoneDigits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

// deno-lint-ignore no-explicit-any
async function resolveTenantId(admin: any, body: Record<string, unknown>): Promise<string | null> {
  const tid = String(body.tenant_id ?? "").trim();
  if (tid) return tid;
  const slug = String(body.store_slug ?? "").trim();
  if (!slug) return null;
  const { data } = await admin.from("tenants").select("id").eq("slug", slug).limit(1).maybeSingle();
  return data?.id ?? null;
}

// Alertas "Avisar o motoboy" (Config. do Delivery): categorias/itens marcados que
// estao presentes nos pedidos. Casa por id (categoria.id = menu_items.category_id;
// item.id = order_items.item_id). Retorna { [order_id]: ["Bebidas", ...] }.
// deno-lint-ignore no-explicit-any
async function alertasPorPedido(admin: any, tenantId: string, orderIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (orderIds.length === 0) return out;
  const { data: ss } = await admin.from("system_settings").select("delivery_config").eq("tenant_id", tenantId).maybeSingle();
  const ma = (ss?.delivery_config as Record<string, unknown> | null)?.motoboy_alertas as
    { categorias?: { id: string; nome: string }[]; itens?: { id: string; nome: string }[] } | undefined;
  const catNome = new Map<string, string>();
  (ma?.categorias ?? []).forEach((c) => { if (c?.id) catNome.set(String(c.id), String(c.nome ?? "")); });
  const itemNome = new Map<string, string>();
  (ma?.itens ?? []).forEach((i) => { if (i?.id) itemNome.set(String(i.id), String(i.nome ?? "")); });
  if (catNome.size === 0 && itemNome.size === 0) return out;

  const { data: ois } = await admin.from("order_items")
    .select("order_id, item_id, item_name").in("order_id", orderIds);
  const linhas = (ois ?? []) as { order_id: string; item_id: string | null; item_name: string | null }[];

  // category_id de cada item_id (so quando ha categorias marcadas).
  const catDoItem = new Map<string, string | null>();
  if (catNome.size > 0) {
    const itemIds = Array.from(new Set(linhas.map((l) => l.item_id).filter((x): x is string => !!x)));
    if (itemIds.length > 0) {
      const { data: mis } = await admin.from("menu_items").select("id, category_id").in("id", itemIds);
      (mis ?? []).forEach((m: { id: string; category_id: string | null }) => catDoItem.set(m.id, m.category_id));
    }
  }

  const sets: Record<string, Set<string>> = {};
  for (const l of linhas) {
    const s = (sets[l.order_id] ??= new Set<string>());
    if (l.item_id) {
      const catId = catDoItem.get(l.item_id);
      if (catId && catNome.has(catId)) s.add(catNome.get(catId)!);
      if (itemNome.has(l.item_id)) s.add(itemNome.get(l.item_id) || (l.item_name ?? ""));
    }
  }
  for (const id of Object.keys(sets)) out[id] = Array.from(sets[id]).filter(Boolean);
  return out;
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

    // ── Login simples do motoboy (nome + celular), escopo por loja ──
    if (body.action === "driver_login") {
      const tenantId = await resolveTenantId(admin, body);
      if (!tenantId) return json({ error: "loja_invalida" }, 200);
      const nome = String(body.name ?? "").trim().slice(0, 80);
      const phone = phoneDigits(body.phone);
      if (!nome || phone.length < 8) return json({ error: "dados_invalidos" }, 200);

      const { data: tenant } = await admin.from("tenants").select("name, slug").eq("id", tenantId).maybeSingle();
      const nowIso = new Date().toISOString();

      const { data: existing } = await admin.from("delivery_drivers")
        .select("id, name, is_active").eq("tenant_id", tenantId).eq("phone", phone).maybeSingle();

      if (existing) {
        if (!existing.is_active) return json({ ok: false, blocked: true, error: "bloqueado" }, 200);
        await admin.from("delivery_drivers").update({ name: nome, last_login_at: nowIso }).eq("id", existing.id);
        return json({ ok: true, driver: { id: existing.id, name: nome }, tenant_id: tenantId, store_name: tenant?.name ?? "", store_slug: tenant?.slug ?? "" });
      }

      const { data: created, error: insErr } = await admin.from("delivery_drivers")
        .insert({ tenant_id: tenantId, name: nome, phone, is_active: true, last_login_at: nowIso })
        .select("id, name").maybeSingle();
      if (insErr || !created) return json({ error: "falha_login" }, 500);
      return json({ ok: true, driver: { id: created.id, name: created.name }, tenant_id: tenantId, store_name: tenant?.name ?? "", store_slug: tenant?.slug ?? "" });
    }

    // ── Lista de pedidos de entrega em aberto da loja (pro motoboy escolher) ──
    if (body.action === "list_orders") {
      const tenantId = await resolveTenantId(admin, body);
      const driverId = String(body.driver_id ?? "").trim();
      if (!tenantId || !driverId) return json({ error: "params" }, 200);

      const { data: driver } = await admin.from("delivery_drivers")
        .select("id, is_active").eq("id", driverId).eq("tenant_id", tenantId).maybeSingle();
      if (!driver) return json({ ok: false, error: "driver_nao_encontrado" }, 200);
      if (!driver.is_active) return json({ ok: false, blocked: true, error: "bloqueado" }, 200);

      const { data: orders } = await admin.from("orders")
        .select("id, number, destination_name, delivery_address, total_amount, delivery_fee, status, motoboy_status, motoboy_driver_id, created_at")
        .eq("tenant_id", tenantId).eq("origin_type", "delivery").in("status", STATUS_ABERTOS)
        .order("created_at", { ascending: true });

      const lista = (orders ?? []) as Record<string, unknown>[];
      const alertasMap = await alertasPorPedido(admin, tenantId, lista.map((o) => o.id as string));

      // Nomes dos entregadores que assumiram pedidos (pra mostrar "com Fulano").
      const driverNome = new Map<string, string>();
      const driverIds = Array.from(new Set(lista.map((o) => o.motoboy_driver_id as string | null).filter((x): x is string => !!x)));
      if (driverIds.length > 0) {
        const { data: drvs } = await admin.from("delivery_drivers").select("id, name").in("id", driverIds);
        (drvs ?? []).forEach((d: { id: string; name: string }) => driverNome.set(d.id, d.name));
      }

      return json({
        ok: true,
        orders: lista.map((o: Record<string, unknown>) => ({
          id: o.id,
          number: o.number,
          cliente: nomeLimpo(o.destination_name as string | null),
          endereco: o.delivery_address ?? "",
          total: Number(o.total_amount ?? 0),
          taxa: Number(o.delivery_fee ?? 0),
          status: o.status,
          motoboy_status: o.motoboy_status ?? null,
          meu: o.motoboy_driver_id === driverId,
          assumido: o.motoboy_driver_id != null,
          assumido_por: o.motoboy_driver_id ? (driverNome.get(o.motoboy_driver_id as string) ?? null) : null,
          alertas: alertasMap[o.id as string] ?? [],
          created_at: o.created_at,
        })),
      });
    }

    const orderId = String(body.order_id ?? "");
    if (!orderId) return json({ error: "order_id obrigatorio" }, 400);

    if (body.action === "get_order") {
      const { data: order, error } = await admin.from("orders")
        .select("id, tenant_id, number, destination_name, delivery_address, delivery_lat, delivery_lng, total_amount, delivery_fee, notes, status, motoboy_status, motoboy_note, motoboy_driver_id, out_for_delivery_at, origin_type")
        .eq("id", orderId).maybeSingle();
      if (error || !order) return json({ error: "not_found" }, 200);
      if (order.origin_type !== "delivery") return json({ error: "not_delivery" }, 200);
      const { data: items } = await admin.from("order_items").select("item_name, quantity").eq("order_id", orderId);
      const alertasMap = await alertasPorPedido(admin, order.tenant_id as string, [orderId]);
      const { data: tnt } = await admin.from("tenants").select("slug, name").eq("id", order.tenant_id).maybeSingle();
      let claimedByName: string | null = null;
      if (order.motoboy_driver_id) {
        const { data: drv } = await admin.from("delivery_drivers").select("name").eq("id", order.motoboy_driver_id).maybeSingle();
        claimedByName = drv?.name ?? null;
      }
      return json({
        ok: true,
        store_slug: tnt?.slug ?? "",
        store_name: tnt?.name ?? "",
        order: {
          claimed_by_id: order.motoboy_driver_id ?? null,
          claimed_by_name: claimedByName,
          number: order.number,
          cliente: nomeLimpo(order.destination_name as string | null),
          endereco: order.delivery_address ?? "",
          lat: order.delivery_lat != null ? Number(order.delivery_lat) : null,
          lng: order.delivery_lng != null ? Number(order.delivery_lng) : null,
          total: Number(order.total_amount ?? 0),
          taxa: Number(order.delivery_fee ?? 0),
          pagamento: order.notes ?? "",
          status: order.status,
          motoboy_status: order.motoboy_status ?? null,
          motoboy_note: order.motoboy_note ?? null,
          em_rota: !!order.out_for_delivery_at,
          alertas: alertasMap[orderId] ?? [],
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
      const driverId = String(body.driver_id ?? "").trim();
      // Trava de propriedade: a partir do 1o sinal, o pedido fica preso a um entregador.
      // So pode atualizar quem nao tem dono ainda OU o proprio dono.
      const { data: cur } = await admin.from("orders").select("motoboy_driver_id").eq("id", orderId).maybeSingle();
      if (!cur) return json({ error: "not_found" }, 200);
      const dono = cur.motoboy_driver_id as string | null;
      if (dono && (!driverId || dono !== driverId)) {
        return json({ ok: false, error: "assumido_por_outro" }, 200);
      }
      // Registra qual motoboy assumiu o pedido (1o sinal define o dono).
      if (driverId) updates.motoboy_driver_id = driverId;
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
