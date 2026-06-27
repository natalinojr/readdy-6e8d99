
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonErr(msg: string, code = 400) {
  return new Response(JSON.stringify({ _v: "v14", error: msg }), { status: code, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function fmtPrice(v: number): string { return "R$ " + v.toFixed(2).replace(".", ","); }

// Formata um telefone (so digitos) p/ exibicao: (DD) 9XXXX-XXXX ou (DD) XXXX-XXXX.
function fmtPhone(digits: string): string {
  const d = (digits || "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

// ── Entrega por distancia (pin + faixas) ───────────────────────────────────────

type FaixaEntrega = { ate_km: number; taxa: number; tempo_max_min: number };

// Fator de via para o fallback haversine (reta subestima a distancia de rua).
const ROAD_FACTOR = 1.3;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Mapeia uma distancia (km) para a faixa configurada. dentroArea=false se alem da ultima faixa. */
function quoteFromTiers(km: number, tiers: FaixaEntrega[]): { taxa: number; tempoMax: number; dentroArea: boolean } | null {
  if (!tiers || tiers.length === 0) return null;
  const sorted = tiers.slice().sort((a, b) => a.ate_km - b.ate_km);
  for (const t of sorted) {
    if (km <= t.ate_km) return { taxa: t.taxa, tempoMax: t.tempo_max_min, dentroArea: true };
  }
  const last = sorted[sorted.length - 1];
  return { taxa: last.taxa, tempoMax: last.tempo_max_min, dentroArea: false };
}

// Velocidade media urbana de moto p/ estimar o tempo de rota quando o ORS nao
// retorna duracao (fallback). 25 km/h e conservador p/ cidade pequena.
const MOTO_KMH = 25;

// ── Estado de abertura do delivery (sessao + pausa + agendamento + manual) ─────
// Fonte da verdade do "delivery aberto agora". Combina:
//  - sessao de caixa aberta  -> master gate (sem sessao, delivery SEMPRE fechado)
//  - delivery_paused_until    -> pausa temporaria (fecha mesmo dentro do horario)
//  - delivery_schedule        -> agendamento por dia da semana (fuso America/Sao_Paulo)
//  - delivery_manual_open     -> override pra abrir FORA do horario / quando nao ha agenda
// Regra: dentro do horario + sessao aberta abre sozinho ("forca abertura"); fechar
// dentro do horario vira pausa ate o fim da janela (ver set_delivery_state op 'close').
type DeliveryDaySchedule = { enabled?: boolean; open?: string; close?: string };
type DeliverySchedule = { enabled?: boolean; days?: Record<string, DeliveryDaySchedule> };

function parseHHMM(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// Dia-da-semana (0=Dom..6=Sab) e minutos desde a meia-noite no fuso da loja (SP).
function spNowParts(now: Date): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = wdMap[get("weekday")] ?? 0;
  let hour = Number(get("hour")); if (hour === 24) hour = 0; // hour12:false pode devolver "24"
  const minute = Number(get("minute"));
  return { dow, minutes: hour * 60 + minute };
}

// A janela do dia contem o instante? Suporta janela que cruza a meia-noite (close < open):
// nesse caso o dia cobre [open, 24:00); a parte [00:00, close) entra pelo dia anterior.
function dayWindowContains(day: DeliveryDaySchedule | undefined, minutes: number): boolean {
  if (!day || !day.enabled) return false;
  const o = parseHHMM(day.open); const c = parseHHMM(day.close);
  if (o == null || c == null || o === c) return false;
  if (c > o) return minutes >= o && minutes < c;
  return minutes >= o; // cruza meia-noite
}

function isWithinSchedule(schedule: DeliverySchedule | null | undefined, now: Date): boolean {
  if (!schedule || !schedule.enabled || !schedule.days) return false;
  const { dow, minutes } = spNowParts(now);
  if (dayWindowContains(schedule.days[String(dow)], minutes)) return true;
  // Janela do dia anterior que invade a madrugada de hoje.
  const prev = schedule.days[String((dow + 6) % 7)];
  if (prev && prev.enabled) {
    const o = parseHHMM(prev.open); const c = parseHHMM(prev.close);
    if (o != null && c != null && c < o && minutes < c) return true;
  }
  return false;
}

// Minutos restantes ate o fim da janela ativa agora (null se nao ha janela ativa).
function minutesUntilWindowClose(schedule: DeliverySchedule | null | undefined, now: Date): number | null {
  if (!schedule || !schedule.days) return null;
  const { dow, minutes } = spNowParts(now);
  const today = schedule.days[String(dow)];
  if (today && today.enabled) {
    const o = parseHHMM(today.open); const c = parseHHMM(today.close);
    if (o != null && c != null) {
      if (c > o && minutes >= o && minutes < c) return c - minutes;
      if (c < o && minutes >= o) return (1440 - minutes) + c; // fecha so na madrugada seguinte
    }
  }
  const prev = schedule.days[String((dow + 6) % 7)];
  if (prev && prev.enabled) {
    const o = parseHHMM(prev.open); const c = parseHHMM(prev.close);
    if (o != null && c != null && c < o && minutes < c) return c - minutes;
  }
  return null;
}

function computeDeliveryOpen(dc: Record<string, any> | null | undefined, hasSession: boolean, now: Date): { open: boolean; reason: string } {
  if (!hasSession) return { open: false, reason: "sem_sessao" };
  const pausedUntil = dc?.delivery_paused_until;
  if (typeof pausedUntil === "string" && pausedUntil) {
    const t = Date.parse(pausedUntil);
    if (!Number.isNaN(t) && now.getTime() < t) return { open: false, reason: "pausado" };
  }
  const schedule = dc?.delivery_schedule as DeliverySchedule | undefined;
  const scheduleEnabled = !!(schedule && schedule.enabled);
  const manualOpen = dc?.delivery_manual_open === true;
  if (scheduleEnabled) {
    if (isWithinSchedule(schedule, now)) return { open: true, reason: "horario" };
    return manualOpen ? { open: true, reason: "manual" } : { open: false, reason: "fora_horario" };
  }
  return manualOpen ? { open: true, reason: "manual" } : { open: false, reason: "fechado_manual" };
}

/**
 * Rota loja->cliente via OpenRouteService (driving-car): retorna distancia (km)
 * E duracao estimada (min). Retorna null em qualquer falha (timeout/quota/sem
 * chave) — o chamador faz fallback haversine + estimativa de tempo por velocidade.
 * ORS usa ordem [lng, lat].
 */
async function orsRoute(storeLat: number, storeLng: number, destLat: number, destLng: number): Promise<{ km: number; durationMin: number } | null> {
  const apiKey = Deno.env.get("ORS_API_KEY");
  if (!apiKey) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
      method: "POST",
      headers: { "Authorization": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: [[storeLng, storeLat], [destLng, destLat]] }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const summary = data?.routes?.[0]?.summary;
    const meters = summary?.distance;
    if (typeof meters === "number" && meters >= 0) {
      const km = meters / 1000;
      const seconds = summary?.duration;
      const durationMin = (typeof seconds === "number" && seconds >= 0) ? seconds / 60 : (km / MOTO_KMH) * 60;
      return { km, durationMin };
    }
    return null;
  } catch (_e) {
    return null;
  }
}

/** Valor aplicável de um voucher sobre um valor de pedido (espelha voucher-write). */
function voucherApplicable(v: Record<string, any>, orderAmt: number): number {
  let a = 0;
  if (v.voucher_type === "gift_card" || v.voucher_type === "cashback") {
    a = orderAmt > 0 ? Math.min(Number(v.current_balance ?? 0), orderAmt) : Number(v.current_balance ?? 0);
  } else if (v.voucher_type === "discount") {
    if (v.discount_type === "fixed") {
      a = orderAmt > 0 ? Math.min(Number(v.discount_value ?? 0), orderAmt) : Number(v.discount_value ?? 0);
    } else if (v.discount_type === "percent") {
      a = orderAmt > 0 ? orderAmt * (Number(v.discount_value ?? 0) / 100) : 0;
    }
  }
  return Math.round(a * 100) / 100;
}

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
        admin.from("options").select("id, group_id, name, additional_price, is_active").eq("tenant_id", tenantId).eq("is_active", true).order("sort_order", { ascending: true }),
        admin.from("item_preset_observations").select("id, item_id, text").eq("tenant_id", tenantId).is("deleted_at", null),
        admin.rpc("fn_get_items_sem_estoque", { p_tenant_id: tenantId }),
        admin.rpc("fn_get_opcoes_sem_estoque", { p_tenant_id: tenantId }),
        admin.from("item_production_parts").select("item_id, name, station_id").eq("tenant_id", tenantId).is("deleted_at", null).order("sort_order"),
        // Destaques do DELIVERY: canal 'ambos' ou 'delivery' (exclui os 'só casa').
        admin.from("menu_highlights").select("id, item_id, custom_price, custom_description, sort_order").eq("tenant_id", tenantId).eq("is_active", true).neq("channel", "casa").order("sort_order", { ascending: true }),
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
        // Preço de delivery sobrescreve o preço de balcão quando configurado (> 0).
        const dc = item.delivery_config as Record<string, unknown> | null;
        const precoDelivery = dc && typeof dc === "object" ? Number(dc.preco ?? 0) : 0;
        const price = precoDelivery > 0 ? precoDelivery : Number(item.price ?? 0);
        const mapped = { ...item, price, station_id: catStationMap.get(item.category_id as string) ?? null };
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

      // Estado de abertura do delivery (sessao + pausa + agenda + manual) p/ o cliente.
      const { data: openSessForCfg } = await admin.from("sessions").select("id").eq("tenant_id", tenantId).eq("status", "open").limit(1).maybeSingle();
      const deliveryStateCfg = computeDeliveryOpen(settingsData.delivery_config as Record<string, any> | null, !!openSessForCfg, new Date());

      return new Response(JSON.stringify({ _v: "v14", tenant: tenantResult.data, city: settingsData.delivery_city, delivery_config: settingsData.delivery_config ?? {}, delivery_open_now: deliveryStateCfg.open, delivery_closed_reason: deliveryStateCfg.open ? null : deliveryStateCfg.reason, neighborhoods, categories: catResult.data ?? [], items, option_groups: ogResult.data ?? [], options, observations: obsResult.data ?? [], out_of_stock_ids: outOfStockIds, opcoes_indisponiveis_ids: opcoesIndisponiveisIds, production_parts: Object.fromEntries(productionPartsMap), highlights, promotions }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "lookup_customer") {
      const { phone, tenant_id } = body;
      if (!phone || !tenant_id) return jsonErr("phone and tenant_id are required", 400);
      const cleanPhone = String(phone).replace(/\D/g, "");
      const { data: rows, error } = await admin.rpc("fn_delivery_lookup_customer", { p_tenant_id: tenant_id, p_phone: cleanPhone });
      if (error) throw error;
      const row = (rows && rows.length > 0) ? rows[0] : null;
      const customer = row ? { id: row.id, phone: row.phone, name: row.name, neighborhood_id: row.neighborhood_id, street: row.street, number: row.number, complement: row.complement, reference_point: row.reference_point, last_used_at: row.last_used_at, birth_date: null as string | null, gender: null as string | null, delivery_neighborhoods: row.neighborhood_id ? { id: row.neighborhood_id, name: row.neighborhood_name, delivery_fee: row.neighborhood_delivery_fee } : null } : null;
      // Anexa nascimento/gênero salvos no cadastro de clientes (aba Clientes) p/ pré-preencher.
      if (customer) {
        const { data: custRow } = await admin.from("customers").select("birth_date, gender").eq("tenant_id", tenant_id).eq("phone", cleanPhone).limit(1).maybeSingle();
        if (custRow) { customer.birth_date = custRow.birth_date ?? null; customer.gender = custRow.gender ?? null; }
      }
      let addresses: Array<Record<string, unknown>> = [];
      if (customer) { const { data: addrRows } = await admin.from("delivery_customer_addresses").select("id, label, neighborhood_id, street, number, complement, reference_point, is_default, lat, lng, bairro").eq("customer_id", customer.id).eq("tenant_id", tenant_id).order("is_default", { ascending: false }); if (addrRows) addresses = addrRows.map((a: Record<string, unknown>) => ({ id: a.id, label: a.label, neighborhood_id: a.neighborhood_id, street: a.street, number: a.number, complement: a.complement, reference_point: a.reference_point, is_default: a.is_default, lat: a.lat, lng: a.lng, bairro: a.bairro, neighborhood_name: null, neighborhood_delivery_fee: 0, neighborhood_is_active: true })); }
      return new Response(JSON.stringify({ _v: "v14", customer, addresses }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "save_customer") {
      const { tenant_id, phone, name, neighborhood_id, street, number, complement, reference_point, bairro, address_lat, address_lng, birth_date, gender } = body;
      if (!tenant_id || !phone || !name) return jsonErr("tenant_id, phone e name sao obrigatorios", 400);
      const cleanPhone = String(phone).replace(/\D/g, "");
      const { data: rows, error } = await admin.rpc("fn_delivery_save_customer", { p_tenant_id: tenant_id, p_phone: cleanPhone, p_name: name.trim(), p_neighborhood_id: neighborhood_id || null, p_street: street || null, p_number: number || null, p_complement: complement || null, p_reference_point: reference_point || null });
      if (error) throw error;

      // Persiste nascimento/gênero no cadastro de clientes (aba Clientes), quando informados.
      const scGender = (typeof gender === "string" && ["masculino", "feminino", "outro"].includes(gender.trim().toLowerCase())) ? gender.trim().toLowerCase() : null;
      const scBirth = (typeof birth_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(birth_date.trim())) ? birth_date.trim() : null;
      if (scGender || scBirth) {
        const scUpd: Record<string, unknown> = {};
        if (scBirth) scUpd.birth_date = scBirth;
        if (scGender) scUpd.gender = scGender;
        const { data: existingCust } = await admin.from("customers").select("id").eq("tenant_id", tenant_id).eq("phone", cleanPhone).limit(1);
        if (existingCust && existingCust.length > 0) {
          await admin.from("customers").update(scUpd).eq("id", existingCust[0].id);
        } else {
          await admin.from("customers").insert({ tenant_id, name: name.trim(), phone: cleanPhone, first_visit_at: new Date().toISOString(), visit_count: 0, total_spent: 0, loyalty_points: 0, loyalty_tier: "bronze", accepts_marketing: false, ...scUpd });
        }
      }
      const row = (rows && rows.length > 0) ? rows[0] : null;
      const customer = row ? { id: row.id, phone: row.phone, name: row.name, neighborhood_id: row.neighborhood_id, street: row.street, number: row.number, complement: row.complement, reference_point: row.reference_point, last_used_at: row.last_used_at, delivery_neighborhoods: row.neighborhood_id ? { id: row.neighborhood_id, name: row.neighborhood_name, delivery_fee: row.neighborhood_delivery_fee } : null } : null;
      const sLat = (address_lat != null && address_lat !== "") ? Number(address_lat) : null;
      const sLng = (address_lng != null && address_lng !== "") ? Number(address_lng) : null;
      const sHasPin = sLat != null && !Number.isNaN(sLat) && sLng != null && !Number.isNaN(sLng);
      if (customer && (street || neighborhood_id || sHasPin)) {
        const { data: existingAddr } = await admin.from("delivery_customer_addresses").select("id").eq("customer_id", customer.id).eq("tenant_id", tenant_id).eq("street", street || "").eq("number", number || "").maybeSingle();
        if (existingAddr) {
          await admin.from("delivery_customer_addresses").update({ lat: sHasPin ? sLat : null, lng: sHasPin ? sLng : null, bairro: bairro || null }).eq("id", existingAddr.id);
        } else {
          const { count: addrCount } = await admin.from("delivery_customer_addresses").select("id", { count: "exact", head: true }).eq("customer_id", customer.id);
          await admin.from("delivery_customer_addresses").insert({ customer_id: customer.id, tenant_id, label: (addrCount ?? 0) === 0 ? "Principal" : "Endereco " + ((addrCount ?? 0) + 1), neighborhood_id: neighborhood_id || null, street: street || null, number: number || null, complement: complement || null, reference_point: reference_point || null, bairro: bairro || null, is_default: (addrCount ?? 0) === 0, lat: sHasPin ? sLat : null, lng: sHasPin ? sLng : null });
        }
      }
      let addresses: Array<Record<string, unknown>> = [];
      if (customer) { const { data: addrRows } = await admin.from("delivery_customer_addresses").select("id, label, neighborhood_id, street, number, complement, reference_point, is_default, lat, lng, bairro").eq("customer_id", customer.id).eq("tenant_id", tenant_id).order("is_default", { ascending: false }); if (addrRows) addresses = addrRows.map((a: Record<string, unknown>) => ({ id: a.id, label: a.label, neighborhood_id: a.neighborhood_id, street: a.street, number: a.number, complement: a.complement, reference_point: a.reference_point, is_default: a.is_default, lat: a.lat, lng: a.lng, bairro: a.bairro, neighborhood_name: null, neighborhood_delivery_fee: 0, neighborhood_is_active: true })); }
      return new Response(JSON.stringify({ _v: "v14", customer, addresses }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "save_delivery_settings") {
      // Salva a config de delivery (system_settings) com service role, validando que o
      // usuario autenticado e admin DESTA loja. Necessario porque o RLS direto usa
      // auth_tenant_id() (ultima membership criada) e quebra para donos multi-loja.
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) return jsonErr("Nao autenticado", 401);

      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessao invalida", 401);
      const userId = userData.user.id;

      const { tenant_id, delivery_city, delivery_config } = body;
      if (!tenant_id) return jsonErr("tenant_id obrigatorio", 400);

      const { data: membership, error: memErr } = await admin
        .from("user_tenants")
        .select("role")
        .eq("user_id", userId)
        .eq("tenant_id", tenant_id)
        .limit(1)
        .maybeSingle();
      if (memErr) throw memErr;
      if (!membership || membership.role !== "admin") {
        return jsonErr("Sem permissao de admin para esta loja.", 403);
      }

      // Merge: preserva chaves de runtime que esta tela nao conhece (delivery_manual_open,
      // delivery_paused_until — gravadas pelo botao do PDV via set_delivery_state).
      const { data: existingSettings } = await admin
        .from("system_settings")
        .select("delivery_config")
        .eq("tenant_id", tenant_id)
        .maybeSingle();
      const existingDc = (existingSettings?.delivery_config as Record<string, unknown> | null) ?? {};
      const mergedDc = { ...existingDc, ...((delivery_config as Record<string, unknown> | null) ?? {}) };

      const updatePayload: Record<string, unknown> = { delivery_config: mergedDc };
      if (typeof delivery_city === "string") updatePayload.delivery_city = delivery_city;

      const { error: updErr } = await admin
        .from("system_settings")
        .update(updatePayload)
        .eq("tenant_id", tenant_id);
      if (updErr) throw updErr;

      return new Response(JSON.stringify({ _v: "v14", ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Config do delivery PRA TELA DE GESTAO (leve): so city + delivery_config.
    // Evita o get_delivery_config (payload do cliente: cardapio inteiro, ~13 queries)
    // que deixava a aba Delivery lenta. Autenticado (membro da loja).
    if (action === "get_delivery_settings") {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) return jsonErr("Nao autenticado", 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessao invalida", 401);
      const { tenant_id } = body;
      if (!tenant_id) return jsonErr("tenant_id obrigatorio", 400);
      const { data: membership } = await admin.from("user_tenants").select("role").eq("user_id", userData.user.id).eq("tenant_id", tenant_id).limit(1).maybeSingle();
      if (!membership) return jsonErr("Sem acesso a esta loja.", 403);

      const { data: ss } = await admin.from("system_settings").select("delivery_city, delivery_config").eq("tenant_id", tenant_id).maybeSingle();
      const { data: tnt } = await admin.from("tenants").select("slug, name").eq("id", tenant_id).maybeSingle();
      return new Response(JSON.stringify({
        _v: "v14",
        city: ss?.delivery_city ?? "",
        delivery_config: ss?.delivery_config ?? {},
        slug: tnt?.slug ?? null,
        tenant_name: tnt?.name ?? null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Gestao de motoboys (entregadores) — admin da loja ──────────────────────
    if (action === "list_drivers" || action === "set_driver_active" || action === "delete_driver") {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) return jsonErr("Nao autenticado", 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessao invalida", 401);

      const { tenant_id } = body;
      if (!tenant_id) return jsonErr("tenant_id obrigatorio", 400);
      const { data: membership } = await admin.from("user_tenants").select("role").eq("user_id", userData.user.id).eq("tenant_id", tenant_id).limit(1).maybeSingle();
      if (!membership || membership.role !== "admin") return jsonErr("Sem permissao de admin para esta loja.", 403);

      if (action === "list_drivers") {
        const { data: drivers } = await admin.from("delivery_drivers")
          .select("id, name, phone, is_active, created_at, last_login_at")
          .eq("tenant_id", tenant_id).order("created_at", { ascending: false });
        return new Response(JSON.stringify({ _v: "v14", ok: true, drivers: drivers ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const driverId = String(body.driver_id || "").trim();
      if (!driverId) return jsonErr("driver_id obrigatorio", 400);

      if (action === "delete_driver") {
        const { error } = await admin.from("delivery_drivers").delete().eq("id", driverId).eq("tenant_id", tenant_id);
        if (error) throw error;
        return new Response(JSON.stringify({ _v: "v14", ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // set_driver_active
      const isActive = body.is_active === true;
      const { error } = await admin.from("delivery_drivers").update({ is_active: isActive }).eq("id", driverId).eq("tenant_id", tenant_id);
      if (error) throw error;
      return new Response(JSON.stringify({ _v: "v14", ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Loja gere o status da entrega (fallback quando o motoboy nao consegue) ──
    if (action === "list_delivery_orders" || action === "set_motoboy_status" || action === "clear_motoboy_driver") {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) return jsonErr("Nao autenticado", 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessao invalida", 401);
      const { tenant_id } = body;
      if (!tenant_id) return jsonErr("tenant_id obrigatorio", 400);
      const { data: membership } = await admin.from("user_tenants").select("role").eq("user_id", userData.user.id).eq("tenant_id", tenant_id).limit(1).maybeSingle();
      if (!membership) return jsonErr("Sem acesso a esta loja.", 403);

      if (action === "list_delivery_orders") {
        const { data: orders } = await admin.from("orders")
          .select("id, number, destination_name, destination_phone, delivery_address, delivery_platform, total_amount, delivery_fee, status, motoboy_status, motoboy_note, motoboy_problems, motoboy_driver_id, motoboy_updated_at, created_at")
          .eq("tenant_id", tenant_id).eq("origin_type", "delivery").in("status", ["new", "preparing", "ready"])
          .order("created_at", { ascending: true });
        // Retirada na loja NAO e entrega: fica de fora do gestor de entregas (marcada com delivery_platform='retirada').
        const lista = ((orders ?? []) as Record<string, unknown>[]).filter((o) => o.delivery_platform !== "retirada");
        const driverNome: Record<string, string> = {};
        const dids = Array.from(new Set(lista.map((o) => o.motoboy_driver_id as string | null).filter(Boolean))) as string[];
        if (dids.length) {
          const { data: drvs } = await admin.from("delivery_drivers").select("id, name").in("id", dids);
          (drvs ?? []).forEach((d: { id: string; name: string }) => { driverNome[d.id] = d.name; });
        }
        return new Response(JSON.stringify({ _v: "v14", ok: true, orders: lista.map((o) => ({
          id: o.id, number: o.number,
          cliente: ((o.destination_name as string | null) ?? "Cliente").split(/\s+[-–—]\s+/)[0].trim() || "Cliente",
          telefone: ((o.destination_phone as string | null) ?? "").replace(/\D/g, ""),
          endereco: o.delivery_address ?? "", total: Number(o.total_amount ?? 0), taxa: Number(o.delivery_fee ?? 0),
          status: o.status, motoboy_status: o.motoboy_status ?? null, motoboy_note: o.motoboy_note ?? null,
          problemas: Array.isArray(o.motoboy_problems) ? o.motoboy_problems : [],
          driver_id: o.motoboy_driver_id ?? null, driver_nome: o.motoboy_driver_id ? (driverNome[o.motoboy_driver_id as string] ?? null) : null,
          created_at: o.created_at,
        })) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const orderId = String(body.order_id || "").trim();
      if (!orderId) return jsonErr("order_id obrigatorio", 400);
      // Confere que o pedido e desta loja.
      const { data: ord } = await admin.from("orders").select("id, motoboy_timeline, motoboy_status, motoboy_problems").eq("id", orderId).eq("tenant_id", tenant_id).maybeSingle();
      if (!ord) return jsonErr("Pedido nao encontrado nesta loja.", 404);

      if (action === "clear_motoboy_driver") {
        // Libera o pedido do entregador atual E volta UMA fase de entrega, para o
        // próximo motoboy assumir do ponto certo (sem herdar a fase do anterior).
        // Ex.: "a caminho da loja" → volta a ficar disponível (sem fase);
        //      "coletou" → volta para "a caminho da loja"; "problema" → "a caminho".
        const SEQ = ["a_caminho_loja", "coletou", "entregou"];
        const atual = (ord.motoboy_status as string | null) ?? null;
        let novo: string | null;
        if (atual === "problema") {
          novo = "a_caminho_loja";
        } else {
          const i = SEQ.indexOf(atual ?? "");
          novo = i <= 0 ? null : SEQ[i - 1]; // a_caminho_loja→null, coletou→a_caminho_loja
        }
        // Recalcula a timeline mantendo só as fases até a nova (descarta as desfeitas).
        const oldTl = (ord.motoboy_timeline as Record<string, string> | null) ?? {};
        const novoIdx = novo ? SEQ.indexOf(novo) : -1;
        const novaTl: Record<string, string> = {};
        SEQ.forEach((ph, i) => { if (i <= novoIdx && oldTl[ph]) novaTl[ph] = oldTl[ph]; });

        const nowIso = new Date().toISOString();
        const updates: Record<string, unknown> = {
          motoboy_driver_id: null,
          motoboy_status: novo,
          motoboy_note: null,
          motoboy_timeline: novaTl,
          motoboy_updated_at: nowIso,
          updated_at: nowIso,
        };
        // Se voltou pra antes de "coletou", limpa a marcação de saída pra entrega.
        if (novo !== "coletou" && novo !== "entregou") updates.out_for_delivery_at = null;

        const { error } = await admin.from("orders").update(updates).eq("id", orderId);
        if (error) throw error;
        return new Response(JSON.stringify({ _v: "v14", ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // set_motoboy_status: a loja define o status (override, ignora a trava de dono).
      const signal = String(body.signal || "");
      if (!["a_caminho_loja", "coletou", "entregou", "problema"].includes(signal)) return jsonErr("signal invalido", 400);
      const nowIso = new Date().toISOString();
      const tl = (ord.motoboy_timeline as Record<string, string> | null) ?? {};
      if (!tl[signal]) tl[signal] = nowIso;
      const motivoTxt = signal === "problema" ? String(body.motivo ?? "").slice(0, 500) : null;
      const updates: Record<string, unknown> = {
        motoboy_status: signal,
        motoboy_note: motivoTxt,
        motoboy_updated_at: nowIso,
        motoboy_timeline: tl,
        updated_at: nowIso,
      };
      // Acumula o problema no historico (nao sobrescreve): cada relato fica com sua hora.
      if (signal === "problema") {
        const probs = Array.isArray(ord.motoboy_problems) ? (ord.motoboy_problems as unknown[]) : [];
        updates.motoboy_problems = [...probs, { at: nowIso, text: motivoTxt ?? "", by: "loja" }];
      }
      if (signal === "coletou") updates.out_for_delivery_at = nowIso;
      if (signal === "entregou") { updates.status = "delivered"; updates.out_for_delivery_at = nowIso; }
      const { error: upErr } = await admin.from("orders").update(updates).eq("id", orderId);
      if (upErr) throw upErr;
      if (signal === "entregou") await admin.from("order_items").update({ status: "delivered" }).eq("order_id", orderId);
      return new Response(JSON.stringify({ _v: "v14", ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_delivery_state" || action === "set_delivery_state") {
      // Estado de abertura do delivery controlado pelo PDV (botao abrir/fechar/pausar).
      // Autoriza qualquer MEMBRO da loja (operador de caixa nao precisa ser admin).
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) return jsonErr("Nao autenticado", 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessao invalida", 401);

      const { tenant_id } = body;
      if (!tenant_id) return jsonErr("tenant_id obrigatorio", 400);
      const { data: membership } = await admin.from("user_tenants").select("role").eq("user_id", userData.user.id).eq("tenant_id", tenant_id).limit(1).maybeSingle();
      if (!membership) return jsonErr("Sem acesso a esta loja.", 403);

      const { data: settingsRow } = await admin.from("system_settings").select("delivery_config").eq("tenant_id", tenant_id).maybeSingle();
      const dc = (settingsRow?.delivery_config as Record<string, any> | null) ?? {};
      const schedule = dc.delivery_schedule as DeliverySchedule | undefined;
      const { data: openSess } = await admin.from("sessions").select("id").eq("tenant_id", tenant_id).eq("status", "open").limit(1).maybeSingle();
      const hasSession = !!openSess;
      const now = new Date();

      if (action === "set_delivery_state") {
        const op = String(body.op || "");
        let manualOpen = dc.delivery_manual_open === true;
        let pausedUntil: string | null = (typeof dc.delivery_paused_until === "string" && dc.delivery_paused_until) ? dc.delivery_paused_until : null;
        const within = isWithinSchedule(schedule, now);

        if (op === "open") {
          if (!hasSession) return jsonErr("Abra uma sessao de caixa antes de abrir o delivery.", 409);
          pausedUntil = null;
          manualOpen = !within; // dentro do horario a agenda ja cobre; fora, liga o override
        } else if (op === "close") {
          if (within) {
            const mtc = minutesUntilWindowClose(schedule, now);
            // Fechar dentro do horario = pausa ate o fim da janela de hoje (reabre na proxima).
            pausedUntil = mtc != null ? new Date(now.getTime() + mtc * 60000).toISOString() : null;
            manualOpen = false;
          } else {
            manualOpen = false; pausedUntil = null;
          }
        } else if (op === "pause") {
          const minutes = Number(body.minutes);
          if (!Number.isFinite(minutes) || minutes <= 0) return jsonErr("minutes invalido", 400);
          pausedUntil = new Date(now.getTime() + Math.round(minutes) * 60000).toISOString();
        } else if (op === "resume") {
          pausedUntil = null;
        } else if (op === "force_off") {
          // Chamado ao FECHAR a sessao: desliga o delivery e limpa overrides.
          manualOpen = false; pausedUntil = null;
        } else {
          return jsonErr("op invalido (open|close|pause|resume|force_off)", 400);
        }

        const mergedDc = { ...dc, delivery_manual_open: manualOpen, delivery_paused_until: pausedUntil };
        const { error: updErr } = await admin.from("system_settings").update({ delivery_config: mergedDc }).eq("tenant_id", tenant_id);
        if (updErr) throw updErr;
        const st = computeDeliveryOpen(mergedDc, hasSession, now);
        return new Response(JSON.stringify({ _v: "v14", ok: true, open_now: st.open, reason: st.reason, manual_open: manualOpen, paused_until: pausedUntil, schedule_enabled: !!(schedule && schedule.enabled), has_session: hasSession }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // get_delivery_state
      const st = computeDeliveryOpen(dc, hasSession, now);
      return new Response(JSON.stringify({ _v: "v14", open_now: st.open, reason: st.reason, manual_open: dc.delivery_manual_open === true, paused_until: (typeof dc.delivery_paused_until === "string" ? dc.delivery_paused_until : null), schedule: schedule ?? null, schedule_enabled: !!(schedule && schedule.enabled), within_schedule: isWithinSchedule(schedule, now), has_session: hasSession }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_customer_orders") {
      const { tenant_id, phone } = body;
      if (!tenant_id || !phone) return jsonErr("tenant_id e phone obrigatorios", 400);
      const cleanPhone = String(phone).replace(/\D/g, "");
      const { data: rows, error } = await admin
        .from("orders")
        .select("id, number, status, created_at, total_amount, delivery_fee")
        .eq("tenant_id", tenant_id)
        .eq("destination_phone", cleanPhone)
        .eq("origin_type", "delivery")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      const orders = (rows ?? []).map((o: Record<string, unknown>) => ({
        id: o.id, number: o.number, status: o.status, created_at: o.created_at,
        total_amount: Number(o.total_amount ?? 0), delivery_fee: Number(o.delivery_fee ?? 0),
      }));
      return new Response(JSON.stringify({ _v: "v14", orders }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_order_status") {
      const { tenant_id, order_number } = body;
      if (!tenant_id || !order_number) return jsonErr("tenant_id e order_number obrigatorios", 400);
      const { data: o, error } = await admin
        .from("orders")
        .select("id, number, status, created_at, updated_at, total_amount, delivery_fee, subtotal, out_for_delivery_at, delivery_sla_min")
        .eq("tenant_id", tenant_id)
        .eq("number", order_number)
        .maybeSingle();
      if (error) throw error;
      if (!o) return new Response(JSON.stringify({ _v: "v14", order: null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: itemRows } = await admin
        .from("order_items")
        .select("id, item_name, item_price, quantity, notes")
        .eq("order_id", o.id)
        .eq("tenant_id", tenant_id);
      const order = {
        id: o.id, number: o.number, status: o.status,
        created_at: o.created_at, updated_at: o.updated_at,
        out_for_delivery_at: o.out_for_delivery_at ?? null,
        delivery_sla_min: o.delivery_sla_min ?? null,
        total_amount: Number(o.total_amount ?? 0),
        delivery_fee: Number(o.delivery_fee ?? 0),
        subtotal: Number(o.subtotal ?? 0),
        items: (itemRows ?? []).map((it: Record<string, unknown>) => ({
          id: it.id, item_name: it.item_name, item_price: Number(it.item_price ?? 0),
          quantity: Number(it.quantity ?? 0), notes: it.notes ?? null,
        })),
      };
      return new Response(JSON.stringify({ _v: "v14", order }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_customer_addresses") {
      const { tenant_id, customer_id } = body;
      if (!tenant_id || !customer_id) return jsonErr("tenant_id e customer_id obrigatorios", 400);
      const { data: addrRows } = await admin.from("delivery_customer_addresses").select("id, label, neighborhood_id, street, number, complement, reference_point, is_default, lat, lng, bairro").eq("customer_id", customer_id).eq("tenant_id", tenant_id).order("is_default", { ascending: false });
      const addresses = (addrRows ?? []).map((a: Record<string, unknown>) => ({ id: a.id, label: a.label, neighborhood_id: a.neighborhood_id, street: a.street, number: a.number, complement: a.complement, reference_point: a.reference_point, is_default: a.is_default, lat: a.lat, lng: a.lng, bairro: a.bairro, neighborhood_name: null, neighborhood_delivery_fee: 0, neighborhood_is_active: true }));
      return new Response(JSON.stringify({ _v: "v14", addresses }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "save_customer_address") {
      const { tenant_id, customer_id, address_id, label, neighborhood_id, street, number, complement, reference_point, bairro, address_lat, address_lng } = body;
      if (!tenant_id || !customer_id) return jsonErr("tenant_id e customer_id obrigatorios", 400);
      const pinLat = (address_lat != null && address_lat !== "") ? Number(address_lat) : null;
      const pinLng = (address_lng != null && address_lng !== "") ? Number(address_lng) : null;
      const fields: Record<string, unknown> = {
        label: (label || "Endereco").toString().trim() || "Endereco",
        neighborhood_id: neighborhood_id || null,
        street: street || null, number: number || null,
        complement: complement || null, reference_point: reference_point || null,
        bairro: bairro || null,
        lat: (pinLat != null && !Number.isNaN(pinLat)) ? pinLat : null,
        lng: (pinLng != null && !Number.isNaN(pinLng)) ? pinLng : null,
      };
      if (address_id) {
        const { error: updErr } = await admin.from("delivery_customer_addresses").update(fields).eq("id", address_id).eq("customer_id", customer_id).eq("tenant_id", tenant_id);
        if (updErr) throw updErr;
      } else {
        const { count: addrCount } = await admin.from("delivery_customer_addresses").select("id", { count: "exact", head: true }).eq("customer_id", customer_id);
        const { error: insErr } = await admin.from("delivery_customer_addresses").insert({ customer_id, tenant_id, is_default: (addrCount ?? 0) === 0, ...fields });
        if (insErr) throw insErr;
      }
      const { data: addrRows } = await admin.from("delivery_customer_addresses").select("id, label, neighborhood_id, street, number, complement, reference_point, is_default, lat, lng, bairro").eq("customer_id", customer_id).eq("tenant_id", tenant_id).order("is_default", { ascending: false });
      const addresses = (addrRows ?? []).map((a: Record<string, unknown>) => ({ id: a.id, label: a.label, neighborhood_id: a.neighborhood_id, street: a.street, number: a.number, complement: a.complement, reference_point: a.reference_point, is_default: a.is_default, lat: a.lat, lng: a.lng, bairro: a.bairro, neighborhood_name: null, neighborhood_delivery_fee: 0, neighborhood_is_active: true }));
      return new Response(JSON.stringify({ _v: "v14", addresses }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "set_default_address") {
      const { tenant_id, customer_id, address_id } = body;
      if (!tenant_id || !customer_id || !address_id) return jsonErr("tenant_id, customer_id e address_id obrigatorios", 400);
      await admin.from("delivery_customer_addresses").update({ is_default: false }).eq("customer_id", customer_id).eq("tenant_id", tenant_id);
      const { error: updErr } = await admin.from("delivery_customer_addresses").update({ is_default: true }).eq("id", address_id).eq("customer_id", customer_id).eq("tenant_id", tenant_id);
      if (updErr) throw updErr;
      const { data: addrRows } = await admin.from("delivery_customer_addresses").select("id, label, neighborhood_id, street, number, complement, reference_point, is_default, lat, lng, bairro").eq("customer_id", customer_id).eq("tenant_id", tenant_id).order("is_default", { ascending: false });
      const addresses = (addrRows ?? []).map((a: Record<string, unknown>) => ({ id: a.id, label: a.label, neighborhood_id: a.neighborhood_id, street: a.street, number: a.number, complement: a.complement, reference_point: a.reference_point, is_default: a.is_default, lat: a.lat, lng: a.lng, bairro: a.bairro, neighborhood_name: null, neighborhood_delivery_fee: 0, neighborhood_is_active: true }));
      return new Response(JSON.stringify({ _v: "v14", addresses }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete_customer_address") {
      const { tenant_id, customer_id, address_id } = body;
      if (!tenant_id || !customer_id || !address_id) return jsonErr("tenant_id, customer_id e address_id obrigatorios", 400);
      const { data: delAddr } = await admin.from("delivery_customer_addresses").select("is_default").eq("id", address_id).eq("customer_id", customer_id).maybeSingle();
      await admin.from("delivery_customer_addresses").delete().eq("id", address_id).eq("customer_id", customer_id).eq("tenant_id", tenant_id);
      if (delAddr?.is_default) {
        const { data: firstAddr } = await admin.from("delivery_customer_addresses").select("id").eq("customer_id", customer_id).eq("tenant_id", tenant_id).limit(1).maybeSingle();
        if (firstAddr) { await admin.from("delivery_customer_addresses").update({ is_default: true }).eq("id", firstAddr.id); }
      }
      const { data: addrRows } = await admin.from("delivery_customer_addresses").select("id, label, neighborhood_id, street, number, complement, reference_point, is_default, lat, lng, bairro").eq("customer_id", customer_id).eq("tenant_id", tenant_id).order("is_default", { ascending: false });
      const addresses = (addrRows ?? []).map((a: Record<string, unknown>) => ({ id: a.id, label: a.label, neighborhood_id: a.neighborhood_id, street: a.street, number: a.number, complement: a.complement, reference_point: a.reference_point, is_default: a.is_default, lat: a.lat, lng: a.lng, bairro: a.bairro, neighborhood_name: null, neighborhood_delivery_fee: 0, neighborhood_is_active: true }));
      return new Response(JSON.stringify({ _v: "v14", addresses }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "validate_voucher") {
      const { tenant_id, code, order_amount } = body;
      if (!tenant_id || !code) return jsonErr("tenant_id e code obrigatorios", 400);
      const okResp = (obj: Record<string, unknown>) => new Response(JSON.stringify({ _v: "v14", ...obj }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: voucher } = await admin.from("vouchers").select("*").eq("tenant_id", tenant_id).eq("code", String(code).trim().toUpperCase()).maybeSingle();
      if (!voucher) return okResp({ valid: false, applicable_amount: 0, reason: "not_found" });
      if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) return okResp({ valid: false, applicable_amount: 0, reason: "expired" });
      if (voucher.status !== "active") return okResp({ valid: false, applicable_amount: 0, reason: voucher.status });
      if (voucher.voucher_type === "free_item") return okResp({ valid: false, applicable_amount: 0, reason: "free_item_indisponivel" });
      const applicable = voucherApplicable(voucher, Number(order_amount ?? 0));
      if (applicable <= 0) return okResp({ valid: false, applicable_amount: 0, reason: "sem_desconto" });
      return okResp({ valid: true, applicable_amount: applicable, code: voucher.code, voucher_type: voucher.voucher_type });
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
        address_lat, address_lng,
        birth_date, gender,
        voucher_code,
        client_request_id,
        order_source,
      } = body;

      // Origem do pedido (utm_source do link, ex.: "instagram"). So letras/numeros/._-, minusculo, ate 40 chars.
      const deliverySource = (typeof order_source === "string" && order_source.trim())
        ? order_source.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40) || null
        : null;

      // Normaliza gênero p/ os valores aceitos no banco (ou null).
      const normGender = (typeof gender === "string" && ["masculino", "feminino", "outro"].includes(gender.trim().toLowerCase()))
        ? gender.trim().toLowerCase()
        : null;
      const normBirth = (typeof birth_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(birth_date.trim()))
        ? birth_date.trim()
        : null;

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
        return jsonErr("Requisicao invalida - client_request_id ausente", 400);
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

      const [menuItemsRes, combosRes, optionsRes, neighRes, settingsRes] = await Promise.all([
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
        admin.from("system_settings").select("delivery_config").eq("tenant_id", tenant_id).maybeSingle(),
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
          // Usa o preço de delivery (delivery_config.preco) quando configurado (> 0).
          const precoDelivery = dc && typeof dc === "object" ? Number(dc.preco ?? 0) : 0;
          itemPriceMap.set(mi.id as string, precoDelivery > 0 ? precoDelivery : Number(mi.price ?? 0));
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

      // Config de entrega por distancia (Fase 1): localizacao da loja + faixas
      const deliveryConfig = (settingsRes.data?.delivery_config ?? {}) as Record<string, any>;
      const storeLoc = deliveryConfig.store_location;
      const tiersRaw = Array.isArray(deliveryConfig.delivery_fee_tiers) ? deliveryConfig.delivery_fee_tiers : [];
      const tiers: FaixaEntrega[] = tiersRaw
        .map((t: any) => ({ ate_km: Number(t.ate_km) || 0, taxa: Number(t.taxa) || 0, tempo_max_min: Number(t.tempo_max_min) || 0 }))
        .filter((t: FaixaEntrega) => t.ate_km > 0);
      const hasDistanceConfig = storeLoc && typeof storeLoc.lat === "number" && typeof storeLoc.lng === "number" && tiers.length > 0;

      const pinLat = (address_lat != null && address_lat !== "") ? Number(address_lat) : null;
      const pinLng = (address_lng != null && address_lng !== "") ? Number(address_lng) : null;
      const hasPin = pinLat != null && !Number.isNaN(pinLat) && pinLng != null && !Number.isNaN(pinLng);

      let serverDeliveryFee = 0;
      let routeKm: number | null = null;
      let routeTempoMax: number | null = null;
      // Tempo de rota (min) loja->cliente — a base do horario limite de preparo no Gestor.
      let routeDurationMin: number | null = null;

      if (isRetirada) {
        serverDeliveryFee = 0;
      } else if (hasDistanceConfig && hasPin) {
        // Entrega por distancia: rota real via ORS (fallback haversine x fator de via)
        const ors = await orsRoute(storeLoc.lat, storeLoc.lng, pinLat as number, pinLng as number);
        const km = ors != null ? ors.km : haversineKm(storeLoc.lat, storeLoc.lng, pinLat as number, pinLng as number) * ROAD_FACTOR;
        routeKm = Math.round(km * 100) / 100;
        // Tempo de rota da API (min); sem ORS, estima pela distancia e velocidade media.
        routeDurationMin = Math.round(ors != null ? ors.durationMin : (km / MOTO_KMH) * 60);
        const quote = quoteFromTiers(km, tiers);
        if (!quote || !quote.dentroArea) {
          return new Response(JSON.stringify({
            _v: "v14",
            error: "fora_area",
            message: "Endereco fora da area de entrega desta loja.",
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        serverDeliveryFee = quote.taxa;
        routeTempoMax = quote.tempoMax;
      } else if (neighborhood_id && neighRes.data) {
        // Fluxo legado por bairro (loja sem config de distancia, ou pedido sem pin)
        const nb = neighRes.data as Record<string, unknown>;
        if (nb.is_active !== false) {
          serverDeliveryFee = Number(nb.delivery_fee ?? 0);
        }
      }

      // Voucher (opcional): valida server-side e calcula o desconto sobre o subtotal.
      // O resgate efetivo (baixa de saldo + transação) só acontece após criar o pedido.
      let voucherDiscount = 0;
      let voucherRow: Record<string, any> | null = null;
      const vCode = (typeof voucher_code === "string" && voucher_code.trim()) ? voucher_code.trim().toUpperCase() : null;
      if (vCode) {
        const { data: v } = await admin.from("vouchers").select("*").eq("tenant_id", tenant_id).eq("code", vCode).maybeSingle();
        const expirado = v?.expires_at && new Date(v.expires_at) < new Date();
        if (v && v.status === "active" && !expirado && v.voucher_type !== "free_item") {
          let d = voucherApplicable(v, serverSubtotal);
          if (d > serverSubtotal) d = serverSubtotal;
          if (d > 0) { voucherDiscount = d; voucherRow = v; }
        }
      }

      const serverTotal = Math.max(0, serverSubtotal + serverDeliveryFee - voucherDiscount);

      let realCustomerId: string | null = null;
      if (cleanPhone) {
        const { data: existingCustomers } = await admin.from("customers").select("id, name").eq("tenant_id", tenant_id).eq("phone", cleanPhone).limit(1);
        if (existingCustomers && existingCustomers.length > 0) {
          realCustomerId = existingCustomers[0].id;
          const upd: Record<string, unknown> = {};
          if (customer_name && customer_name.trim() && customer_name.trim() !== existingCustomers[0].name) upd.name = customer_name.trim();
          if (normBirth) upd.birth_date = normBirth;
          if (normGender) upd.gender = normGender;
          if (Object.keys(upd).length > 0) await admin.from("customers").update(upd).eq("id", realCustomerId);
        } else {
          // O nome vem do cliente — o sistema NUNCA inventa um nome. Sem nome, recusa
          // (o app já exige o nome antes de chegar aqui).
          if (!customer_name || !String(customer_name).trim()) {
            return jsonErr("Nome do cliente e obrigatorio.", 400);
          }
          const { data: newCustomer } = await admin.from("customers").insert({
            tenant_id, name: String(customer_name).trim(), phone: cleanPhone,
            birth_date: normBirth, gender: normGender,
            first_visit_at: new Date().toISOString(),
            visit_count: 0, total_spent: 0,
            loyalty_points: 0, loyalty_tier: "bronze", accepts_marketing: false,
          }).select("id").single();
          if (newCustomer) realCustomerId = newCustomer.id;
        }
      }

      const { data: caixaSession } = await admin.from("sessions").select("id").eq("tenant_id", tenant_id).eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle();
      // Gate completo: sessao aberta + nao pausado + dentro do horario (ou aberto manual).
      const { data: dcRowForGate } = await admin.from("system_settings").select("delivery_config").eq("tenant_id", tenant_id).maybeSingle();
      const gateState = computeDeliveryOpen(dcRowForGate?.delivery_config as Record<string, any> | null, !!caixaSession, new Date());
      if (!gateState.open) {
        const gateMsg = gateState.reason === "sem_sessao" ? "Estabelecimento fechado."
          : gateState.reason === "pausado" ? "O delivery esta pausado no momento. Tente novamente mais tarde."
          : gateState.reason === "fora_horario" ? "O delivery esta fora do horario de funcionamento."
          : "O delivery esta fechado no momento.";
        return new Response(JSON.stringify({ _v: "v14", error: gateMsg }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const sessionId = caixaSession!.id;

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
          destination_name: customer_name + " - " + (isRetirada ? "Retirada" : customer_address),
          // Normaliza para dígitos: todas as buscas (get_customer_orders, rate-limit, motoboy)
          // comparam por telefone sem máscara. Gravar formatado some do histórico do cliente.
          destination_phone: cleanPhone || null,
          customer_id: realCustomerId, discount_amount: voucherDiscount, service_fee_amount: 0,
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

      // Grava a origem do pedido (utm_source do link, ex.: campanha do Instagram) p/ relatorio.
      if (deliverySource) {
        try { await admin.from("orders").update({ delivery_source: deliverySource }).eq("id", orderId); } catch { /* nao bloqueia o pedido */ }
      }

      // Grava o pin do cliente + distancia da rota (delivery por distancia / link do motoboy na Fase 4)
      if (!isRetirada && hasPin) {
        try {
          await admin.from("orders").update({
            delivery_lat: pinLat,
            delivery_lng: pinLng,
            delivery_distance_km: routeKm,
            delivery_route_min: routeDurationMin,
            delivery_sla_min: routeTempoMax,
          }).eq("id", orderId);
        } catch { /* nao bloqueia o pedido */ }
      }

      const { error: itemsErr } = await admin.rpc("fn_create_order_items_bypass", {
        p_order_id: orderId, p_tenant_id: tenant_id, p_items: serverItems,
      });
      if (itemsErr) throw itemsErr;

      // Resgate do voucher (baixa de saldo + transação) — só após o pedido existir.
      if (voucherRow && voucherDiscount > 0) {
        try {
          const isSaldo = voucherRow.voucher_type === "gift_card" || voucherRow.voucher_type === "cashback";
          const newBalance = isSaldo ? Math.max(0, Number(voucherRow.current_balance ?? 0) - voucherDiscount) : 0;
          const newStatus = newBalance <= 0 ? "depleted" : "active";
          await admin.from("vouchers").update({ current_balance: newBalance, status: newStatus }).eq("id", voucherRow.id);
          await admin.from("voucher_transactions").insert({
            tenant_id, voucher_id: voucherRow.id, order_id: orderId,
            transaction_type: "redeemed", amount: voucherDiscount, balance_after: newBalance, processed_by: null,
          });
        } catch (_e) { /* nao bloqueia o pedido se o resgate falhar */ }
      }

      const dataHora = new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
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
              numero: ticketNum, destino: customer_name + " - " + (isRetirada ? "Retirada" : customer_address),
              origem: isRetirada ? "retirada" : "delivery",
              impressora_id: stationKey,
              itens: buildTicketItems(stationItems),
              data_hora: dataHora,
            },
            p_paper_style: "80mm",
          });
        } catch { /* non-blocking */ }
      }

      // Itens "sem preparo" (skip_kds: bebidas, sobremesas prontas) -> ticket de BAR,
      // agrupado pela station_id real (fallback "bar"). Espelha o printOrderQueue das
      // outras origens; antes o delivery NAO imprimia esses itens (so no comprovante).
      const itensBar = serverItems.filter((it: Record<string, unknown>) => it.skip_kds);
      const barGroups = new Map<string, Array<Record<string, unknown>>>();
      for (const item of itensBar) {
        const key = (item.station_id as string) || "bar";
        if (!barGroups.has(key)) barGroups.set(key, []);
        barGroups.get(key)!.push(item);
      }
      for (const [stationKey, stationItems] of barGroups.entries()) {
        try {
          await admin.rpc("enqueue_print_ticket", {
            p_tenant_id: tenant_id, p_order_id: orderId, p_order_number: orderNumber,
            p_station_key: stationKey, p_station_label: "Bar",
            p_content_type: "ticket_json",
            p_payload: {
              numero: ticketNum, destino: customer_name + " - " + (isRetirada ? "Retirada" : customer_address),
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
            nome: item.item_name + " - " + fmtPrice(itemBasePrice * itemQty),
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
          cleanPhone ? "Telefone: " + fmtPhone(cleanPhone) : "",
          isRetirada ? "RETIRADA NA LOJA" : "",
          (!isRetirada && routeKm != null) ? "Distancia: ~" + routeKm.toFixed(1) + " km" + (routeTempoMax ? " (ate " + routeTempoMax + " min)" : "") : "",
          serverDeliveryFee > 0 ? "Taxa de entrega: " + fmtPrice(serverDeliveryFee) : "",
          "Subtotal: " + fmtPrice(serverSubtotal),
          voucherDiscount > 0 ? "Desconto voucher" + (vCode ? " (" + vCode + ")" : "") + ": -" + fmtPrice(voucherDiscount) : "",
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
            destino: (customer_name || "Cliente") + " - " + (isRetirada ? "Retirada" : "Entrega"),
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
          voucher_discount: voucherDiscount,
          distance_km: routeKm,
          route_min: routeDurationMin,
          sla_min: routeTempoMax,
          customer_id: realCustomerId,
          payment_method,
          order_type: order_type || "entrega",
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return jsonErr("Unknown action: " + action, 400);
  } catch (err) {
    // Extrai a mensagem real mesmo quando o erro e um objeto do Postgrest (sem ser Error)
    const e = err as Record<string, unknown> | null;
    const errMsg = (e && typeof e === "object")
      ? String(e.message || e.details || e.hint || e.code || JSON.stringify(e))
      : String(err);
    console.error("[delivery-write v14] error:", errMsg, "| raw:", JSON.stringify(err));
    return new Response(JSON.stringify({ _v: "v14", error: errMsg, message: errMsg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
