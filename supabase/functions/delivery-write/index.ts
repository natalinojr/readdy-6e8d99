
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonErr(msg: string, code = 400) {
  return new Response(JSON.stringify({ _v: "v14", error: msg }), { status: code, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function fmtPrice(v: number): string { return "R$ " + v.toFixed(2).replace(".", ","); }

const RATE_LIMIT_WINDOW_MIN = 10;
const MAX_ORDERS_PER_PHONE = 3;
const MAX_ORDERS_PER_IP = 15;

async function notifyDeliveryOrderCreated(payload: {
  tenant_id: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  total_amount: number;
}) {
  const internalToken = Deno.env.get("WHATSAPP_INTERNAL_TOKEN")?.trim();
  if (!internalToken) return;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  if (!supabaseUrl) return;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": internalToken,
      },
      body: JSON.stringify({
        action: "delivery_order_created",
        ...payload,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[delivery-write] whatsapp-send failed:", res.status, text);
    }
  } catch (err) {
    console.warn("[delivery-write] whatsapp-send unavailable:", err instanceof Error ? err.message : String(err));
  }
}

function extractClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

Deno.serve({ verify_jwt: false }, async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const keyToUse = serviceRoleKey && serviceRoleKey.length >= 40 ? serviceRoleKey : anonKey;
  const admin = createClient(supabaseUrl, keyToUse, { auth: { autoRefreshToken: false, persistSession: false } });
  const clientIp = extractClientIp(req);

  try {
    const body = await req.json();
    const { action } = body;
    const startTime = Date.now();
    if (!action) return jsonErr("action is required", 400);

    if (action === "get_delivery_config") {
      const store_slug = body.store_slug;
      const paramTenantId = body.tenant_id;
      const tenantIdFromFrontend = (paramTenantId && typeof paramTenantId === "string" && paramTenantId.trim().length > 0) ? paramTenantId.trim() : null;
      let tenantId: string | null = tenantIdFromFrontend;
      if (!tenantId && store_slug && typeof store_slug === "string" && store_slug.trim().length > 0) {
        const { data: bySlug } = await admin.from("tenants").select("id, name, slug, is_active").eq("slug", store_slug.trim()).limit(1);
        if (bySlug && bySlug.length > 0) {
          const match = bySlug[0];
          if (match.is_active !== false) { tenantId = match.id; }
          else return new Response(JSON.stringify({ _v: "v14", error: "store_inactive", message: "Esta loja esta temporariamente indisponivel." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
      if (!tenantId) return new Response(JSON.stringify({ _v: "v14", error: "delivery_not_configured", message: "Delivery nao configurado." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const [settingsResult, nbRows, tenantResult, catResult, itemResult, ogResult, optResult, obsResult, estoqueResult, opcoesEstoqueResult, partesResult, highlightsResult, promotionsResult] = await Promise.all([
        admin.from("system_settings").select("delivery_city, delivery_config").eq("tenant_id", tenantId).maybeSingle(),
        admin.rpc("fn_delivery_get_config", { p_tenant_id: tenantId }),
        admin.from("tenants").select("id, name").eq("id", tenantId).maybeSingle(),
        admin.from("menu_categories").select("id, name, station_id").eq("tenant_id", tenantId).eq("is_active", true).order("sort_order", { ascending: true }),
        admin.from("menu_items").select("id, name, description, price, photo_url, category_id, sla_minutes, is_active, skip_kds, delivery_config").eq("tenant_id", tenantId).eq("is_active", true),
        admin.from("option_groups").select("id, name, item_id, is_required, min_selections, max_selections").eq("tenant_id", tenantId).is("deleted_at", null),
        admin.from("options").select("id, group_id, name, additional_price, is_active").eq("tenant_id", tenantId).eq("is_active", true),
        admin.from("item_preset_observations").select("id, item_id, text").eq("tenant_id", tenantId).is("deleted_at", null),
        admin.rpc("fn_get_items_sem_estoque", { p_tenant_id: tenantId }),
        admin.rpc("fn_get_opcoes_sem_estoque", { p_tenant_id: tenantId }),
        admin.from("item_production_parts").select("item_id, name, station_id").eq("tenant_id", tenantId).is("deleted_at", null).order("sort_order"),
        admin.from("menu_highlights").select("id, item_id, custom_price, custom_description, sort_order").eq("tenant_id", tenantId).eq("is_active", true).order("sort_order", { ascending: true }),
        admin.from("item_promotions").select("id, item_id, promotional_price, days_of_week, is_recurring, specific_date, is_active").eq("tenant_id", tenantId).eq("is_active", true).is("deleted_at", null),
      ]);

      const settingsData = settingsResult.data;
      if (settingsResult.error) throw settingsResult.error;
      if (!settingsData || !settingsData.delivery_city) return new Response(JSON.stringify({ _v: "v14", error: "delivery_not_configured" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const neighborhoods: Array<{ id: string; name: string; delivery_fee: number; is_active: boolean }> = [];
      const seenNames = new Set<string>();
      if (!nbRows.error && nbRows.data) for (const row of nbRows.data as Array<Record<string, unknown>>) {
        if (row.neighborhood_name && !seenNames.has(row.neighborhood_name as string)) {
          seenNames.add(row.neighborhood_name as string);
          neighborhoods.push({ id: row.neighborhood_id as string, name: row.neighborhood_name as string, delivery_fee: Number(row.neighborhood_delivery_fee ?? 0), is_active: row.neighborhood_is_active as boolean ?? true });
        }
      }
      const catStationMap = new Map<string, string>();
      for (const cat of (catResult.data ?? []) as Array<{ id: string; station_id: string | null }>) { if (cat.station_id) catStationMap.set(cat.id, cat.station_id); }
      const filteredItems = ((itemResult.data ?? []) as Array<Record<string, unknown>>).filter((item: Record<string, unknown>) => {
        const dc = item.delivery_config as Record<string, unknown> | null;
        return !dc || typeof dc !== "object" || dc.ativo !== false;
      });
      const itemsMap = new Map<string, Record<string, unknown>>();
      const items = filteredItems.map((item: Record<string, unknown>) => {
        const mapped = { ...item, station_id: catStationMap.get(item.category_id as string) ?? null };
        itemsMap.set(item.id as string, mapped); return mapped;
      });
      const options = (optResult.data ?? []).map((o: Record<string, unknown>) => ({ ...o, option_group_id: o.group_id }));
      const productionPartsMap = new Map<string, Array<{ name: string; station_id: string }>>();
      for (const p of (partesResult?.data ?? [])) { if (!productionPartsMap.has(p.item_id)) productionPartsMap.set(p.item_id, []); productionPartsMap.get(p.item_id)!.push({ name: p.name, station_id: p.station_id }); }
      const outOfStockIds: string[] = []; if (!estoqueResult.error && estoqueResult.data) for (const row of estoqueResult.data as Array<{ item_id: string }>) outOfStockIds.push(row.item_id);
      const opcoesIndisponiveisIds: string[] = []; if (!opcoesEstoqueResult.error && opcoesEstoqueResult.data) for (const id of opcoesEstoqueResult.data as string[]) opcoesIndisponiveisIds.push(id);
      const highlights: Array<Record<string, unknown>> = [];
      if (!highlightsResult.error && highlightsResult.data) for (const h of highlightsResult.data as Array<Record<string, unknown>>) {
        const item = itemsMap.get(h.item_id as string);
        if (item) highlights.push({ id: h.id, item_id: h.item_id, custom_price: h.custom_price, custom_description: h.custom_description, sort_order: h.sort_order, item_name: item.name, item_price: item.price, item_photo_url: item.photo_url, item_description: item.description, item_category_id: item.category_id, item_station_id: item.station_id, item_skip_kids: item.skip_kds, item_sla_minutes: item.sla_minutes });
      }

      const promotions = (promotionsResult.data ?? []).map((p: Record<string, unknown>) => ({
        id: p.id,
        item_id: p.item_id,
        promotional_price: p.promotional_price,
        days_of_week: p.days_of_week,
        is_recurring: p.is_recurring,
        specific_date: p.specific_date,
        is_active: p.is_active,
      }));

      return new Response(JSON.stringify({ _v: "v14", tenant: tenantResult.data, city: settingsData.delivery_city, delivery_config: settingsData.delivery_config ?? {}, neighborhoods, categories: catResult.data ?? [], items, option_groups: ogResult.data ?? [], options, observations: obsResult.data ?? [], out_of_stock_ids: outOfStockIds, opcoes_indisponiveis_ids: opcoesIndisponiveisIds, production_parts: Object.fromEntries(productionPartsMap), highlights, promotions }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "lookup_customer") {
      const { phone, tenant_id } = body;
      if (!phone || !tenant_id) return jsonErr("phone and tenant_id are required", 400);
      const cleanPhone = String(phone).replace(/\D/g, "");
      const { data: rows, error } = await admin.rpc("fn_delivery_lookup_customer", { p_tenant_id: tenant_id, p_phone: cleanPhone });
      if (error) throw error;
      const row = (rows && rows.length > 0) ? rows[0] : null;
      const customer = row ? { id: row.id, phone: row.phone, name: row.name, neighborhood_id: row.neighborhood_id, street: row.street, number: row.number, complement: row.complement, reference_point: row.reference_point, last_used_at: row.last_used_at, delivery_neighborhoods: row.neighborhood_id ? { id: row.neighborhood_id, name: row.neighborhood_name, delivery_fee: row.neighborhood_delivery_fee } : null } : null;
      let addresses: Array<Record<string, unknown>> = [];
      if (customer) { const { data: addrRows } = await admin.rpc("fn_delivery_get_addresses", { p_customer_id: customer.id, p_tenant_id: tenant_id }); if (addrRows) addresses = addrRows.map((a: Record<string, unknown>) => ({ id: a.id, label: a.label, neighborhood_id: a.neighborhood_id, street: a.street, number: a.number, complement: a.complement, reference_point: a.reference_point, is_default: a.is_default, neighborhood_name: a.neighborhood_name, neighborhood_delivery_fee: Number(a.neighborhood_delivery_fee ?? 0), neighborhood_is_active: a.neighborhood_is_active })); }
      return new Response(JSON.stringify({ _v: "v14", customer, addresses }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "save_customer") {
      const { tenant_id, phone, name, neighborhood_id, street, number, complement, reference_point } = body;
      if (!tenant_id || !phone || !name) return jsonErr("tenant_id, phone e name sao obrigatorios", 400);
      const cleanPhone = String(phone).replace(/\D/g, "");
      const { data: rows, error } = await admin.rpc("fn_delivery_save_customer", { p_tenant_id: tenant_id, p_phone: cleanPhone, p_name: name.trim(), p_neighborhood_id: neighborhood_id || null, p_street: street || null, p_number: number || null, p_complement: complement || null, p_reference_point: reference_point || null });
      if (error) throw error;
      const row = (rows && rows.length > 0) ? rows[0] : null;
      const customer = row ? { id: row.id, phone: row.phone, name: row.name, neighborhood_id: row.neighborhood_id, street: row.street, number: row.number, complement: row.complement, reference_point: row.reference_point, last_used_at: row.last_used_at, delivery_neighborhoods: row.neighborhood_id ? { id: row.neighborhood_id, name: row.neighborhood_name, delivery_fee: row.neighborhood_delivery_fee } : null } : null;
      if (customer && (street || neighborhood_id)) {
        const { data: existingAddr } = await admin.from("delivery_customer_addresses").select("id").eq("customer_id", customer.id).eq("tenant_id", tenant_id).eq("street", street || "").eq("number", number || "").maybeSingle();
        if (!existingAddr) { const { count: addrCount } = await admin.from("delivery_customer_addresses").select("id", { count: "exact", head: true }).eq("customer_id", customer.id); await admin.from("delivery_customer_addresses").insert({ customer_id: customer.id, tenant_id, label: (addrCount ?? 0) === 0 ? "Principal" : "Endereco " + ((addrCount ?? 0) + 1), neighborhood_id: neighborhood_id || null, street: street || null, number: number || null, complement: complement || null, reference_point: reference_point || null, is_default: (addrCount ?? 0) === 0 }); }
      }
      let addresses: Array<Record<string, unknown>> = [];
      if (customer) { const { data: addrRows } = await admin.rpc("fn_delivery_get_addresses", { p_customer_id: customer.id, p_tenant_id: tenant_id }); if (addrRows) addresses = addrRows.map((a: Record<string, unknown>) => ({ id: a.id, label: a.label, neighborhood_id: a.neighborhood_id, street: a.street, number: a.number, complement: a.complement, reference_point: a.reference_point, is_default: a.is_default, neighborhood_name: a.neighborhood_name, neighborhood_delivery_fee: Number(a.neighborhood_delivery_fee ?? 0), neighborhood_is_active: a.neighborhood_is_active })); }
      return new Response(JSON.stringify({ _v: "v14", customer, addresses }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_customer_addresses" || action === "save_customer_address" || action === "set_default_address" || action === "delete_customer_address" || action === "save_delivery_settings" || action === "get_order_status" || action === "get_customer_orders") {
      return new Response(JSON.stringify({ _v: "v14", error: "Action " + action + " ok - v14" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "create_delivery_order") {
      const {
        tenant_id, customer_id, customer_name, customer_phone,
        customer_address, neighborhood_name, neighborhood_id,
        delivery_fee: _clientDeliveryFee,
        items: clientItems,
        subtotal: _clientSubtotal,
        total_amount: _clientTotal,
        notes, payment_method, cash_amount, order_type,
        client_request_id,
      } = body;

      if (!tenant_id || !customer_id || !Array.isArray(clientItems) || clientItems.length === 0) {
        return jsonErr("Dados incompletos", 400);
      }

      const isRetirada = order_type === "retirada";

      const { data: tenantCheck, error: tenantCheckErr } = await admin
        .from("tenants")
        .select("id, is_active, name")
        .eq("id", tenant_id)
        .maybeSingle();

      if (tenantCheckErr || !tenantCheck) {
        return jsonErr("Estabelecimento nao encontrado.", 404);
      }
      if (tenantCheck.is_active === false) {
        return jsonErr("Este estabelecimento nao esta aceitando pedidos no momento.", 403);
      }

      const cleanPhone = String(customer_phone || "").replace(/\D/g, "");
      const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60 * 1000).toISOString();

      if (cleanPhone) {
        const { count: phoneCount, error: phoneCountErr } = await admin
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant_id)
          .eq("destination_phone", cleanPhone)
          .gte("created_at", windowStart);

        if (!phoneCountErr && phoneCount !== null && phoneCount >= MAX_ORDERS_PER_PHONE) {
          return new Response(JSON.stringify({
            _v: "v14",
            error: "rate_limited",
            message: "Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente novamente.",
          }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(RATE_LIMIT_WINDOW_MIN * 60) } });
        }
      }

      if (clientIp && clientIp !== "unknown") {
        const { count: ipCount, error: ipCountErr } = await admin
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant_id)
          .gte("created_at", windowStart);

        if (!ipCountErr && ipCount !== null && ipCount >= MAX_ORDERS_PER_IP) {
          return new Response(JSON.stringify({
            _v: "v14",
            error: "rate_limited",
            message: "Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente novamente.",
          }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(RATE_LIMIT_WINDOW_MIN * 60) } });
        }
      }

      const effectiveClientRequestId: string | null =
        client_request_id && typeof client_request_id === "string" && client_request_id.trim().length > 0
          ? client_request_id.trim()
          : null;

      if (!effectiveClientRequestId) {
        return jsonErr("Requisicao invalida — client_request_id ausente", 400);
      }

      const itemIds: string[] = [];
      const comboIds: string[] = [];
      const optionIds: string[] = [];

      for (const item of clientItems) {
        const iid = item.item_id;
        const cid = item.combo_id;
        if (iid && typeof iid === "string" && iid.trim()) itemIds.push(iid.trim());
        if (cid && typeof cid === "string" && cid.trim()) comboIds.push(cid.trim());
        const opts = Array.isArray(item.options) ? item.options : [];
        for (const opt of opts) {
          const oid = opt.option_id;
          if (oid && typeof oid === "string" && oid.trim()) optionIds.push(oid.trim());
        }
      }

      const [menuItemsRes, combosRes, optionsRes, neighRes] = await Promise.all([
        itemIds.length > 0
          ? admin.from("menu_items").select("id, name, price, is_active, delivery_config").eq("tenant_id", tenant_id).in("id", itemIds)
          : Promise.resolve({ data: [], error: null }) as { data: Array<Record<string, unknown>>; error: unknown },
        comboIds.length > 0
          ? admin.from("combos").select("id, name, price, is_active").eq("tenant_id", tenant_id).in("id", comboIds)
          : Promise.resolve({ data: [], error: null }) as { data: Array<Record<string, unknown>>; error: unknown },
        optionIds.length > 0
          ? admin.from("options").select("id, name, additional_price, is_active").eq("tenant_id", tenant_id).in("id", optionIds)
          : Promise.resolve({ data: [], error: null }) as { data: Array<Record<string, unknown>>; error: unknown },
        !isRetirada && neighborhood_id
          ? admin.from("delivery_neighborhoods").select("id, delivery_fee, is_active").eq("tenant_id", tenant_id).eq("id", neighborhood_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }) as { data: Record<string, unknown> | null; error: unknown },
      ]);

      if (menuItemsRes.error) throw menuItemsRes.error;
      if (combosRes.error) throw combosRes.error;
      if (optionsRes.error) throw optionsRes.error;
      if (neighRes.error) throw neighRes.error;

      const itemPriceMap = new Map<string, number>();
      const itemNameMap = new Map<string, string>();
      for (const mi of menuItemsRes.data) {
        const dc = mi.delivery_config as Record<string, unknown> | null;
        const deliveryBlocked = dc && typeof dc === "object" && dc.ativo === false;
        if (mi.is_active && !deliveryBlocked) {
          itemPriceMap.set(mi.id as string, Number(mi.price ?? 0));
          itemNameMap.set(mi.id as string, mi.name as string);
        }
      }

      const comboPriceMap = new Map<string, number>();
      const comboNameMap = new Map<string, string>();
      for (const c of combosRes.data) {
        if (c.is_active) {
          comboPriceMap.set(c.id as string, Number(c.price ?? 0));
          comboNameMap.set(c.id as string, c.name as string);
        }
      }

      const optionPriceMap = new Map<string, number>();
      const optionNameMap = new Map<string, string>();
      for (const o of optionsRes.data) {
        if (o.is_active) {
          optionPriceMap.set(o.id as string, Number(o.additional_price ?? 0));
          optionNameMap.set(o.id as string, o.name as string);
        }
      }

      let serverSubtotal = 0;
      const serverItems: Array<Record<string, unknown>> = [];

      for (const item of clientItems) {
        const qty = Math.max(1, Math.min(99, Number(item.quantity ?? 1)));
        let realItemPrice = 0;
        let realItemName = (item.item_name as string) || "";

        const rawComboId = item.combo_id;
        const rawItemId = item.item_id;

        if (rawComboId && typeof rawComboId === "string" && rawComboId.trim()) {
          const cid = rawComboId.trim();
          const cp = comboPriceMap.get(cid);
          if (cp === undefined) {
            return jsonErr("Combo indisponivel: " + (item.item_name || cid), 400);
          }
          realItemPrice = cp;
          realItemName = comboNameMap.get(cid) || realItemName;
        } else if (rawItemId && typeof rawItemId === "string" && rawItemId.trim()) {
          const iid = rawItemId.trim();
          const ip = itemPriceMap.get(iid);
          if (ip === undefined) {
            return jsonErr("Item indisponivel: " + (item.item_name || iid), 400);
          }
          realItemPrice = ip;
          realItemName = itemNameMap.get(iid) || realItemName;
        } else {
          return jsonErr("Item invalido (sem identificacao)", 400);
        }

        let optionsTotal = 0;
        const serverOpts: Array<Record<string, unknown>> = [];
        const rawOpts = Array.isArray(item.options) ? item.options : [];

        for (const opt of rawOpts) {
          let realOptPrice = 0;
          const oid = opt.option_id;
          if (oid && typeof oid === "string" && oid.trim()) {
            const op = optionPriceMap.get(oid.trim());
            if (op !== undefined) {
              realOptPrice = op;
            }
          }
          optionsTotal += realOptPrice;
          serverOpts.push({
            option_id: oid ?? null,
            option_name: (opt.option_name as string) ?? "",
            group_name: (opt.group_name as string) ?? "",
            additional_price: realOptPrice,
          });
        }

        const lineTotal = (realItemPrice + optionsTotal) * qty;
        serverSubtotal += lineTotal;

        serverItems.push({
          item_id: rawItemId ?? null,
          combo_id: rawComboId ?? null,
          item_name: realItemName,
          item_price: realItemPrice,
          quantity: qty,
          station_id: item.station_id ?? null,
          skip_kds: item.skip_kds ?? false,
          notes: item.notes ?? null,
          options: serverOpts,
          observations: Array.isArray(item.observations)
            ? item.observations.map((o: Record<string, unknown>) => ({
                text: o.text ?? "",
                is_checked: o.is_checked ?? false,
              }))
            : [],
        });
      }

      let serverDeliveryFee = 0;
      if (isRetirada) {
        serverDeliveryFee = 0;
      } else if (neighborhood_id && neighRes.data) {
        const nb = neighRes.data as Record<string, unknown>;
        if (nb.is_active !== false) {
          serverDeliveryFee = Number(nb.delivery_fee ?? 0);
        }
      }

      const serverTotal = serverSubtotal + serverDeliveryFee;

      let realCustomerId: string | null = null;
      if (cleanPhone) {
        const { data: existingCustomers } = await admin.from("customers").select("id, name").eq("tenant_id", tenant_id).eq("phone", cleanPhone).limit(1);
        if (existingCustomers && existingCustomers.length > 0) {
          realCustomerId = existingCustomers[0].id;
          if (customer_name && customer_name.trim() && customer_name.trim() !== existingCustomers[0].name) {
            await admin.from("customers").update({ name: customer_name.trim() }).eq("id", realCustomerId);
          }
        } else {
          const { data: newCustomer } = await admin.from("customers").insert({
            tenant_id, name: customer_name || "Cliente Delivery", phone: cleanPhone,
            first_visit_at: new Date().toISOString(),
            visit_count: 0, total_spent: 0,
            loyalty_points: 0, loyalty_tier: "bronze", accepts_marketing: false,
          }).select("id").single();
          if (newCustomer) realCustomerId = newCustomer.id;
        }
      }

      const { data: caixaSession } = await admin.from("sessions").select("id").eq("tenant_id", tenant_id).eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle();
      if (!caixaSession) return new Response(JSON.stringify({ _v: "v14", error: "Estabelecimento fechado." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const sessionId = caixaSession.id;

      const { data: numData, error: numErr } = await admin.rpc("fn_next_tenant_order_number", { p_tenant_id: tenant_id });
      if (numErr) throw numErr;
      const orderNumber = numData?.[0]?.number ?? "D" + Date.now();

      const paymentParts: string[] = [];
      if (payment_method) {
        paymentParts.push("Pagamento: " + payment_method);
      }
      if (isRetirada) {
        paymentParts.push("RETIRADA NA LOJA");
      }
      const isDinheiro = payment_method && String(payment_method).toLowerCase().includes("dinheiro");
      if (isDinheiro && cash_amount !== undefined && cash_amount !== null) {
        const trocoValor = Number(cash_amount);
        if (trocoValor > 0) {
          paymentParts.push("Troco para " + fmtPrice(trocoValor));
        }
      }
      const notesCombined = paymentParts.join(" | ");

      const { data: order, error: orderErr } = await admin.rpc("fn_create_order_bypass", {
        order_data: {
          tenant_id, session_id: sessionId, number: orderNumber,
          status: "new", origin_type: "delivery", destination_type: "delivery",
          destination_name: customer_name + " — " + (isRetirada ? "Retirada" : customer_address),
          destination_phone: customer_phone,
          customer_id: realCustomerId, discount_amount: 0, service_fee_amount: 0,
          subtotal: serverSubtotal,
          total_amount: serverTotal,
          is_training: false, is_draft: false,
          delivery_fee: serverDeliveryFee,
          delivery_address: customer_address || null,
          delivery_platform: isRetirada ? "retirada" : "propria",
          notes: notesCombined,
          client_request_id: effectiveClientRequestId,
        },
      });

      if (orderErr) throw orderErr;

      const orderId = Array.isArray(order) ? order[0]?.id : order?.id;
      const isDuplicate = Array.isArray(order) ? order[0]?.duplicate : order?.duplicate;

      if (isDuplicate) {
        const { data: existingOrder } = await admin.from("orders").select("id, number, total_amount, delivery_fee").eq("id", orderId).single();
        return new Response(JSON.stringify({
          _v: "v14",
          data: {
            id: orderId,
            number: existingOrder?.number || orderNumber,
            total: existingOrder?.total_amount || serverTotal,
            delivery_fee: existingOrder?.delivery_fee || serverDeliveryFee,
            customer_id: realCustomerId,
            payment_method,
            order_type: order_type || "entrega",
          },
          idempotent: true,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!orderId) return jsonErr("Falha ao criar pedido", 500);

      const { error: itemsErr } = await admin.rpc("fn_create_order_items_bypass", {
        p_order_id: orderId, p_tenant_id: tenant_id, p_items: serverItems,
      });
      if (itemsErr) throw itemsErr;

      const dataHora = new Date().toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
      const ticketNum = parseInt(String(orderNumber).replace(/\D/g, "").slice(-4), 10) || 1;

      function buildTicketItems(stationItems: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
        return stationItems.map((it: Record<string, unknown>) => {
          const opts = (it.options as Array<Record<string, unknown>> ?? [])
            .map((o: Record<string, unknown>) => o.option_name)
            .filter(Boolean);
          const obs = (it.observations as Array<Record<string, unknown>> ?? [])
            .map((o: Record<string, unknown>) => o.text)
            .filter((t: string) => t && t.trim().length > 0);
          if (it.notes && typeof it.notes === "string" && it.notes.trim().length > 0) {
            obs.push(it.notes.trim());
          }
          const ticketItem: Record<string, unknown> = {
            quantidade: it.quantity ?? 1,
            nome: it.item_name,
          };
          if (opts.length > 0) ticketItem.opcoes = opts;
          if (obs.length > 0) ticketItem.observacoes = obs;
          return ticketItem;
        });
      }

      const itensCozinha = serverItems.filter((it: Record<string, unknown>) => !it.skip_kds);
      const stationGroups = new Map<string, Array<Record<string, unknown>>>();
      for (const item of itensCozinha) {
        const key = (item.station_id as string) || "cozinha-padrao";
        if (!stationGroups.has(key)) stationGroups.set(key, []);
        stationGroups.get(key)!.push(item);
      }

      for (const [stationKey, stationItems] of stationGroups.entries()) {
        try {
          await admin.rpc("enqueue_print_ticket", {
            p_tenant_id: tenant_id, p_order_id: orderId, p_order_number: orderNumber,
            p_station_key: stationKey, p_station_label: stationKey,
            p_content_type: "ticket_json",
            p_payload: {
              numero: ticketNum, destino: customer_name + " — " + (isRetirada ? "Retirada" : customer_address),
              origem: isRetirada ? "retirada" : "delivery",
              impressora_id: stationKey,
              itens: buildTicketItems(stationItems),
              data_hora: dataHora,
            },
            p_paper_style: "80mm",
          });
        } catch { /* non-blocking */ }
      }

      try {
        const receiptItems: Array<Record<string, unknown>> = [];
        for (const item of serverItems) {
          const itemQty = Number(item.quantity ?? 1);
          const itemBasePrice = Number(item.item_price ?? 0);
          const receiptItem: Record<string, unknown> = {
            quantidade: itemQty,
            nome: item.item_name + " — " + fmtPrice(itemBasePrice * itemQty),
          };
          const opts = (item.options as Array<Record<string, unknown>> ?? [])
            .filter((o: Record<string, unknown>) => o.option_name)
            .map((o: Record<string, unknown>) => {
              const addP = Number(o.additional_price ?? 0);
              return addP > 0
                ? o.option_name + " +" + fmtPrice(addP)
                : "+ " + o.option_name;
            });
          if (opts.length > 0) receiptItem.opcoes = opts;
          receiptItems.push(receiptItem);
        }

        const obsGeralParts = [
          "Cliente: " + (customer_name || "Nao informado"),
          isRetirada ? "RETIRADA NA LOJA" : "",
          serverDeliveryFee > 0 ? "Taxa de entrega: " + fmtPrice(serverDeliveryFee) : "",
          "Subtotal: " + fmtPrice(serverSubtotal),
          "TOTAL: " + fmtPrice(serverTotal),
          "Pagamento: " + (payment_method || "Nao informado"),
          isDinheiro && cash_amount !== undefined && cash_amount !== null && Number(cash_amount) > 0
            ? "Troco para " + fmtPrice(Number(cash_amount))
            : "",
        ].filter(Boolean);

        await admin.rpc("enqueue_print_ticket", {
          p_tenant_id: tenant_id, p_order_id: orderId, p_order_number: orderNumber,
          p_station_key: "delivery-receipt", p_station_label: "Comprovante",
          p_content_type: "ticket_json",
          p_payload: {
            numero: ticketNum,
            destino: (customer_name || "Cliente") + " — " + (isRetirada ? "Retirada" : "Entrega"),
            origem: isRetirada ? "retirada" : "delivery",
            estacao: isRetirada ? "COMPROVANTE RETIRADA" : "COMPROVANTE ENTREGA",
            itens: receiptItems,
            data_hora: dataHora,
            observacao_geral: obsGeralParts.join("\n"),
          },
          p_paper_style: "80mm",
        });
      } catch { /* non-blocking */ }

      await notifyDeliveryOrderCreated({
        tenant_id,
        order_id: orderId,
        order_number: orderNumber,
        customer_name: customer_name || "Cliente",
        customer_phone: cleanPhone || String(customer_phone || ""),
        total_amount: serverTotal,
      });

      return new Response(JSON.stringify({
        _v: "v14",
        data: {
          id: orderId, number: orderNumber,
          total: serverTotal,
          delivery_fee: serverDeliveryFee,
          customer_id: realCustomerId,
          payment_method,
          order_type: order_type || "entrega",
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return jsonErr("Unknown action: " + action, 400);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[delivery-write v14] error:", errMsg);
    return new Response(JSON.stringify({ _v: "v14", error: errMsg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
