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

// Pedidos com entrega iFood (ifood_shipping_orders) em andamento — entregador do iFood a caminho.
// deno-lint-ignore no-explicit-any
async function pedidosComIfoodAtivo(admin: any, orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const { data } = await admin.from("ifood_shipping_orders").select("order_id").in("order_id", orderIds)
    .not("status", "in", "(concluded,cancelled,failed)");
  return new Set(((data ?? []) as { order_id: string }[]).map((r) => r.order_id));
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
        .select("id, number, destination_name, delivery_address, delivery_lat, delivery_lng, total_amount, delivery_fee, status, motoboy_status, motoboy_driver_id, motoboy_updated_at, delivery_sla_min, delivery_platform, created_at, updated_at")
        .eq("tenant_id", tenantId).eq("origin_type", "delivery").in("status", [...STATUS_ABERTOS, "delivered"])
        .order("created_at", { ascending: true });

      // Retirada na loja nao tem entrega -> nao aparece pro motoboy (delivery_platform='retirada').
      // Entregues: mostra so os recentes (ultimas 3h) pro motoboy saber o que ja foi feito.
      const RECENTE_MS = 3 * 60 * 60 * 1000;
      const agoraTs = Date.now();
      const lista = ((orders ?? []) as Record<string, unknown>[]).filter((o) => {
        if (o.delivery_platform === "retirada") return false;
        if (o.status === "delivered") {
          const ref = (o.motoboy_updated_at as string | null) ?? (o.updated_at as string | null);
          const t = ref ? new Date(ref).getTime() : 0;
          return !!t && (agoraTs - t) <= RECENTE_MS;
        }
        return true;
      });
      // Pedido com entregador do iFood (iFood Entrega) em andamento some da lista do motoboy da loja.
      const comIfood = await pedidosComIfoodAtivo(admin, lista.map((o) => o.id as string));
      for (let i = lista.length - 1; i >= 0; i--) if (comIfood.has(lista[i].id as string) && lista[i].status !== "delivered") lista.splice(i, 1);
      const alertasMap = await alertasPorPedido(admin, tenantId, lista.map((o) => o.id as string));

      // Nomes dos entregadores que assumiram pedidos (pra mostrar "com Fulano").
      const driverNome = new Map<string, string>();
      const driverIds = Array.from(new Set(lista.map((o) => o.motoboy_driver_id as string | null).filter((x): x is string => !!x)));
      if (driverIds.length > 0) {
        const { data: drvs } = await admin.from("delivery_drivers").select("id, name").in("id", driverIds);
        (drvs ?? []).forEach((d: { id: string; name: string }) => driverNome.set(d.id, d.name));
      }

      // Fase 3: a saída montada pelo gestor para este motoboy (últimas 6 h) — ordem das paradas ainda pendentes.
      const { data: saida } = await admin.from("delivery_saidas").select("id, pedidos, created_at")
        .eq("tenant_id", tenantId).eq("driver_id", driverId).gte("created_at", new Date(agoraTs - 6 * 3600000).toISOString())
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const pendentes = new Set(lista.filter((o) => o.motoboy_driver_id === driverId && o.status !== "delivered").map((o) => o.id as string));
      const paradas = saida ? ((saida.pedidos as string[]) ?? []).filter((id) => pendentes.has(id)) : [];

      return json({
        ok: true,
        rota: paradas.length ? { saida_id: saida!.id, paradas, criada_em: saida!.created_at } : null,
        orders: lista.map((o: Record<string, unknown>) => ({
          id: o.id,
          number: o.number,
          cliente: nomeLimpo(o.destination_name as string | null),
          endereco: o.delivery_address ?? "",
          lat: o.delivery_lat != null ? Number(o.delivery_lat) : null,
          lng: o.delivery_lng != null ? Number(o.delivery_lng) : null,
          total: Number(o.total_amount ?? 0),
          taxa: Number(o.delivery_fee ?? 0),
          status: o.status,
          motoboy_status: o.motoboy_status ?? null,
          meu: o.motoboy_driver_id === driverId,
          assumido: o.motoboy_driver_id != null,
          assumido_por: o.motoboy_driver_id ? (driverNome.get(o.motoboy_driver_id as string) ?? null) : null,
          alertas: alertasMap[o.id as string] ?? [],
          sla_min: o.delivery_sla_min != null ? Number(o.delivery_sla_min) : null,
          created_at: o.created_at,
          motoboy_updated_at: o.motoboy_updated_at ?? null,
        })),
      });
    }

    // ── GPS: posição do motoboy (só enquanto tem pedido em rota / turno ligado) ──
    // O front já filtra (≥15 s e ≥30 m); o banco ainda limita a 1 gravação a cada 10 s por motoboy.
    if (body.action === "ping_position") {
      const tenantId = String(body.tenant_id ?? "").trim();
      const driverId = String(body.driver_id ?? "").trim();
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!tenantId || !driverId || !Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: "params" }, 200);
      const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
      const accuracy = num(body.accuracy);
      // Leitura muito imprecisa (antena de celular, > 2 km) não vira posição no mapa.
      if (accuracy != null && accuracy > 2000) return json({ ok: false, error: "imprecisa" }, 200);
      const { data: r, error: pErr } = await admin.rpc("fn_driver_ping", {
        p_tenant_id: tenantId, p_driver_id: driverId, p_lat: lat, p_lng: lng,
        p_accuracy: accuracy, p_heading: num(body.heading), p_speed: num(body.speed),
      });
      if (pErr) return json({ error: pErr.message }, 500);
      if (r === "driver_invalido") return json({ ok: false, blocked: true, error: "driver_invalido" }, 200);
      return json({ ok: r === "ok" || r === "throttled", result: r });
    }

    // ── Rastreio do cliente (tela "Acompanhar pedido"): mesma chave do get_order_status
    // (tenant_id + número do pedido). Devolve a posição do motoboy SÓ deste pedido e SÓ
    // enquanto ele está em rota (coletou, não entregue/cancelado); posição > 15 min não sai.
    // Previsão recalculada sem API externa: linha reta × 1,3 (fator de ruas) na velocidade
    // da rota calculada na criação do pedido (ORS), limitada a 12–45 km/h.
    if (body.action === "track_order") {
      const tenantId = String(body.tenant_id ?? "").trim();
      const number = String(body.order_number ?? "").trim();
      if (!tenantId || !number) return json({ error: "params" }, 200);
      const { data: o } = await admin.from("orders")
        .select("status, out_for_delivery_at, motoboy_status, motoboy_driver_id, delivery_platform, delivery_lat, delivery_lng, delivery_distance_km, delivery_route_min")
        .eq("tenant_id", tenantId).eq("number", number).maybeSingle();
      const emRota = !!o && !!o.out_for_delivery_at && o.motoboy_status === "coletou" && !!o.motoboy_driver_id
        && o.status !== "delivered" && o.status !== "cancelled" && o.delivery_platform !== "retirada";
      if (!emRota) return json({ ok: true, rastreio: null });
      const { data: pos } = await admin.from("delivery_driver_positions")
        .select("lat, lng, recorded_at").eq("driver_id", o.motoboy_driver_id).eq("tenant_id", tenantId).maybeSingle();
      const destLat = o.delivery_lat != null ? Number(o.delivery_lat) : null;
      const destLng = o.delivery_lng != null ? Number(o.delivery_lng) : null;
      const fresca = !!pos && (Date.now() - new Date(pos.recorded_at as string).getTime()) <= 15 * 60000;
      let etaMin: number | null = null;
      let distKm: number | null = null;
      if (fresca && destLat != null && destLng != null) {
        const rad = Math.PI / 180;
        const pLat = Number(pos.lat), pLng = Number(pos.lng);
        const dLat = (destLat - pLat) * rad, dLng = (destLng - pLng) * rad;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(pLat * rad) * Math.cos(destLat * rad) * Math.sin(dLng / 2) ** 2;
        distKm = 2 * 6371 * Math.asin(Math.sqrt(a)) * 1.3;
        const rk = Number(o.delivery_distance_km ?? 0), rm = Number(o.delivery_route_min ?? 0);
        const kmh = rk > 0 && rm > 0 ? Math.min(45, Math.max(12, rk / (rm / 60))) : 25;
        etaMin = distKm < 0.15 ? 1 : Math.ceil((distKm / kmh) * 60) + 1;
      }
      return json({
        ok: true,
        rastreio: {
          motoboy: fresca ? { lat: Number(pos.lat), lng: Number(pos.lng), atualizado_em: pos.recorded_at } : null,
          destino: destLat != null && destLng != null ? { lat: destLat, lng: destLng } : null,
          distancia_km: distKm != null ? Math.round(distKm * 10) / 10 : null,
          eta_min: etaMin,
        },
      });
    }

    const orderId = String(body.order_id ?? "");
    if (!orderId) return json({ error: "order_id obrigatorio" }, 400);

    if (body.action === "get_order") {
      const bodyTenantId = String(body.tenant_id ?? "").trim();
      let getOrderQuery = admin.from("orders")
        .select("id, tenant_id, number, destination_name, delivery_address, delivery_lat, delivery_lng, total_amount, delivery_fee, notes, is_paid, status, motoboy_status, motoboy_note, motoboy_problems, delivery_notes, motoboy_driver_id, motoboy_timeline, out_for_delivery_at, created_at, origin_type")
        .eq("id", orderId);
      if (bodyTenantId) getOrderQuery = getOrderQuery.eq("tenant_id", bodyTenantId);
      const { data: order, error } = await getOrderQuery.maybeSingle();
      if (error || !order) return json({ error: "not_found" }, 200);
      if (order.origin_type !== "delivery") return json({ error: "not_delivery" }, 200);
      const { data: items } = await admin.from("order_items")
        .select("item_name, quantity, skip_kds, started_preparing_at, ready_at").eq("order_id", orderId);
      const alertasMap = await alertasPorPedido(admin, order.tenant_id as string, [orderId]);

      // Horarios das fases da COZINHA (agregado dos itens que vao pra cozinha).
      const cozinhaItens = (items ?? []).filter((i: Record<string, unknown>) => !i.skip_kds);
      const minTs = (campo: string): string | null => {
        const ts = cozinhaItens.map((i: Record<string, unknown>) => i[campo] as string | null).filter(Boolean) as string[];
        return ts.length ? ts.sort()[0] : null;
      };
      const maxTs = (campo: string): string | null => {
        const ts = cozinhaItens.map((i: Record<string, unknown>) => i[campo] as string | null).filter(Boolean) as string[];
        return ts.length ? ts.sort()[ts.length - 1] : null;
      };
      const todosProntos = cozinhaItens.length > 0 && cozinhaItens.every((i: Record<string, unknown>) => !!i.ready_at);
      const cozinha = {
        status: order.status,
        novo_at: order.created_at ?? null,
        preparo_at: minTs("started_preparing_at"),
        pronto_at: todosProntos ? maxTs("ready_at") : null,
      };
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
          // Pago pelo app (Pix): o motoboy NAO cobra na entrega
          pago: !!order.is_paid,
          status: order.status,
          motoboy_status: order.motoboy_status ?? null,
          motoboy_note: order.motoboy_note ?? null,
          motoboy_problems: Array.isArray(order.motoboy_problems) ? order.motoboy_problems : [],
          delivery_notes: Array.isArray(order.delivery_notes) ? order.delivery_notes : [],
          motoboy_timeline: (order.motoboy_timeline as Record<string, string> | null) ?? {},
          cozinha,
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
      if (!driverId) return json({ error: "driver_id obrigatorio" }, 400);
      // Trava de propriedade: a partir do 1o sinal, o pedido fica preso a um entregador.
      // So pode atualizar quem nao tem dono ainda OU o proprio dono.
      const { data: cur } = await admin.from("orders").select("tenant_id, motoboy_driver_id, motoboy_timeline, motoboy_problems").eq("id", orderId).maybeSingle();
      if (!cur) return json({ error: "not_found" }, 200);
      // Entregador do iFood já está com o pedido: o motoboy da loja não assume (dois iriam ao cliente).
      if ((await pedidosComIfoodAtivo(admin, [orderId])).has(orderId)) return json({ ok: false, error: "com_ifood" }, 200);
      const { data: drv } = await admin.from("delivery_drivers").select("id, is_active").eq("id", driverId).eq("tenant_id", cur.tenant_id).maybeSingle();
      if (!drv || drv.is_active === false) return json({ error: "driver_invalido" }, 403);
      const dono = cur.motoboy_driver_id as string | null;
      if (dono && (!driverId || dono !== driverId)) {
        return json({ ok: false, error: "assumido_por_outro" }, 200);
      }
      // Registra o horario da 1a vez que o pedido entrou nesta fase do motoboy.
      const tl = (cur.motoboy_timeline as Record<string, string> | null) ?? {};
      if (!tl[signal]) tl[signal] = nowIso;
      updates.motoboy_timeline = tl;
      // Acumula o problema no historico (nao sobrescreve): cada relato fica com sua hora.
      if (signal === "problema") {
        const probs = Array.isArray(cur.motoboy_problems) ? (cur.motoboy_problems as unknown[]) : [];
        updates.motoboy_problems = [...probs, { at: nowIso, text: motivo ?? "", by: "motoboy" }];
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
        // Entregue ao cliente = TUDO entregue: item, unidades e partes (como o KDS/caixa fazem).
        // Antes só o item mudava — as unidades ficavam "prontas" e a tela de Pedidos (que lê as
        // unidades) mostrava o pedido 0001 da Vila (18/09) como "Pronto" depois de entregue.
        await admin.from("order_items").update({ status: "delivered" }).eq("order_id", orderId).neq("status", "cancelled");
        await admin.from("order_items").update({ delivered_at: nowIso }).eq("order_id", orderId).neq("status", "cancelled").is("delivered_at", null);
        const { data: its } = await admin.from("order_items").select("id").eq("order_id", orderId).neq("status", "cancelled");
        const itemIds = (its ?? []).map((i: { id: string }) => i.id);
        if (itemIds.length) {
          // (item_unit_status não tem 'cancelled': unidade cancelada some com o item, filtrado acima)
          await admin.from("order_item_units").update({ status: "delivered", delivered_at: nowIso })
            .in("order_item_id", itemIds).is("delivered_at", null);
          await admin.from("order_item_parts").update({ status: "delivered", delivered_at: nowIso })
            .in("order_item_id", itemIds).is("delivered_at", null).neq("status", "cancelled");
        }
      }
      return json({ ok: true, motoboy_status: signal });
    }

    return json({ error: "acao_invalida" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "erro" }, 500);
  }
});
