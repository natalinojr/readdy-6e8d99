
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve({ verify_jwt: false }, async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(supabaseUrl, serviceRoleKey.length > 40 ? serviceRoleKey : anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const body = await req.json();
    const { action } = body;
    if (!action) return new Response(JSON.stringify({ error: "action is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (action === "lookup_mesa_by_number") {
      const { table_number, tenant_id } = body;
      if (!table_number || !tenant_id) return new Response(JSON.stringify({ error: "table_number and tenant_id are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: tableData } = await admin.from("tables").select("id, number, capacity, area, tenant_id, qr_token").eq("tenant_id", tenant_id).eq("number", table_number).maybeSingle();
      if (!tableData) return new Response(JSON.stringify({ error: "mesa_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: sessionData } = await admin.from("table_sessions").select("id, status, customer_name, opened_at, session_id, tenant_id").eq("table_id", tableData.id).eq("status", "open").maybeSingle();
      if (!sessionData) return new Response(JSON.stringify({ error: "mesa_encerrada", message: "Mesa encerrada", table: { number: tableData.number } }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ table: tableData, session: sessionData }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "lookup_mesa") {
      const { qr_token } = body;
      if (!qr_token) return new Response(JSON.stringify({ error: "qr_token is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: tableData } = await admin.from("tables").select("id, number, capacity, area, tenant_id, qr_token").eq("qr_token", qr_token).maybeSingle();
      if (!tableData) return new Response(JSON.stringify({ error: "mesa_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: sessionData } = await admin.from("table_sessions").select("id, status, customer_name, opened_at, session_id, tenant_id, session_token").eq("table_id", tableData.id).eq("status", "open").maybeSingle();
      if (!sessionData) {
        const { data: caixaSession } = await admin.from("sessions").select("id").eq("status", "open").eq("tenant_id", tableData.tenant_id).order("opened_at", { ascending: false }).limit(1).maybeSingle();
        if (!caixaSession) return new Response(JSON.stringify({ error: "mesa_encerrada", message: "Estabelecimento fechado." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const { data: newSession } = await admin.from("table_sessions").insert({ table_id: tableData.id, tenant_id: tableData.tenant_id, session_id: caixaSession.id, status: "open", opened_at: new Date().toISOString() }).select("id, status, customer_name, opened_at, session_id, tenant_id, session_token").maybeSingle();
        await admin.from("tables").update({ status: "occupied" }).eq("id", tableData.id);
        const { data: tenantData } = await admin.from("tenants").select("name").eq("id", tableData.tenant_id).maybeSingle();
        return new Response(JSON.stringify({ table: tableData, session: newSession, tenant_name: tenantData?.name || null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: tenantData } = await admin.from("tenants").select("name").eq("id", tableData.tenant_id).maybeSingle();
      return new Response(JSON.stringify({ table: tableData, session: sessionData, tenant_name: tenantData?.name || null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "create_participant") {
      const { table_session_id, name, tenant_id } = body;
      if (!table_session_id || !name || !tenant_id) return new Response(JSON.stringify({ error: "table_session_id, name e tenant_id sao obrigatorios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: result, error: rpcErr } = await admin.rpc("fn_create_mesa_participant_auto", { p_table_session_id: table_session_id, p_name: name, p_tenant_id: tenant_id });
      if (rpcErr) throw rpcErr;
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "create_mesa_order") {
      const { tenant_id, table_session_id, session_id, participant_id, items, subtotal, total_amount, mesa_number, participant_name } = body;
      if (!tenant_id || !table_session_id || !session_id || !participant_id || !Array.isArray(items) || items.length === 0) return new Response(JSON.stringify({ error: "Dados incompletos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { data: caixaSessionCheck } = await admin.from("sessions").select("id, status").eq("id", session_id).maybeSingle();
      if (!caixaSessionCheck || caixaSessionCheck.status !== "open") return new Response(JSON.stringify({ error: "Estabelecimento fechado.", code: "session_closed" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { data: numData, error: numErr } = await admin.rpc("fn_next_tenant_order_number", { p_tenant_id: tenant_id });
      if (numErr) throw numErr;
      const orderNumber = numData?.[0]?.number ?? "P" + Date.now();

      const tableDestName = mesa_number != null
        ? (typeof participant_name === 'string' && participant_name.trim()
          ? `Mesa ${mesa_number} - ${participant_name.trim()}`
          : `Mesa ${mesa_number}`)
        : null;
      const { data: order, error: orderErr } = await admin.rpc("fn_create_order_bypass", { order_data: { tenant_id, session_id, table_session_id, participant_id, number: orderNumber, status: "new", origin_type: "table", destination_type: "table", destination_name: tableDestName, discount_amount: 0, service_fee_amount: 0, subtotal: subtotal ?? 0, total_amount: total_amount ?? (subtotal ?? 0), is_training: false, is_draft: false, table_number: mesa_number ?? null } });
      if (orderErr) throw orderErr;
      const orderId = Array.isArray(order) ? order[0]?.id : order?.id;
      if (!orderId) return new Response(JSON.stringify({ error: "Falha ao criar pedido" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const resolvedItems = items.map((item: Record<string, unknown>) => ({ item_id: item.item_id ?? null, combo_id: item.combo_id ?? null, item_name: item.item_name, item_price: item.item_price ?? 0, quantity: item.quantity ?? 1, station_id: item.station_id ?? null, skip_kds: item.skip_kds ?? false, notes: item.notes ?? null, options: (item.options ?? []).map((o: Record<string, unknown>) => ({ option_id: o.option_id ?? null, option_name: o.option_name ?? "", group_name: o.group_name ?? "", additional_price: o.additional_price ?? 0 })), observations: (item.observations ?? []).map((o: Record<string, unknown>) => ({ text: o.text ?? "", is_checked: o.is_checked ?? false })) }));

      const { error: itemsErr } = await admin.rpc("fn_create_order_items_bypass", { p_order_id: orderId, p_tenant_id: tenant_id, p_items: resolvedItems });
      if (itemsErr) throw itemsErr;
      return new Response(JSON.stringify({ data: { id: orderId, number: orderNumber } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_cardapio") {
      const { tenant_id } = body;
      if (!tenant_id) return new Response(JSON.stringify({ error: "tenant_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const [catResult, itemResult, ogResult, optResult, obsResult, estoqueResult, opcoesEstoqueResult, partesResult, highlightsResult, promotionsResult] = await Promise.all([
        admin.from("menu_categories").select("id, name, station_id").eq("tenant_id", tenant_id).eq("is_active", true).order("sort_order", { ascending: true }),
        admin.from("menu_items").select("id, name, description, price, photo_url, category_id, sla_minutes, is_active, skip_kds").eq("tenant_id", tenant_id).eq("is_active", true),
        admin.from("option_groups").select("id, name, item_id, is_required, min_selections, max_selections").eq("tenant_id", tenant_id).is("deleted_at", null),
        admin.from("options").select("id, group_id, name, additional_price, is_active").eq("tenant_id", tenant_id).eq("is_active", true),
        admin.from("item_preset_observations").select("id, item_id, text").eq("tenant_id", tenant_id).is("deleted_at", null),
        admin.rpc("fn_get_items_sem_estoque", { p_tenant_id: tenant_id }),
        admin.rpc("fn_get_opcoes_sem_estoque", { p_tenant_id: tenant_id }),
        admin.from("item_production_parts").select("item_id, name, station_id").eq("tenant_id", tenant_id).is("deleted_at", null).order("sort_order"),
        // Destaques da CASA (mesa-qr): canal 'ambos' ou 'casa' (exclui os 'só delivery').
        admin.from("menu_highlights").select("id, item_id, custom_price, custom_description, sort_order").eq("tenant_id", tenant_id).eq("is_active", true).neq("channel", "delivery").order("sort_order", { ascending: true }),
        admin.from("item_promotions").select("id, item_id, promotional_price, days_of_week, is_recurring, specific_date, is_active").eq("tenant_id", tenant_id).eq("is_active", true).is("deleted_at", null),
      ]);

      const options = (optResult.data ?? []).map((o: Record<string, unknown>) => ({ ...o, option_group_id: o.group_id }));

      const outOfStockIds: string[] = [];
      if (!estoqueResult.error && estoqueResult.data) {
        for (const row of estoqueResult.data as Array<{ item_id: string }>) {
          outOfStockIds.push(row.item_id);
        }
      }

      const opcoesIndisponiveisIds: string[] = [];
      if (!opcoesEstoqueResult.error && opcoesEstoqueResult.data) {
        for (const id of opcoesEstoqueResult.data as string[]) {
          opcoesIndisponiveisIds.push(id);
        }
      }

      const productionPartsMap = new Map<string, Array<{ name: string; station_id: string }>>();
      if (partesResult?.data) {
        for (const p of partesResult.data as Array<{ item_id: string; name: string; station_id: string }>) {
          if (!productionPartsMap.has(p.item_id)) productionPartsMap.set(p.item_id, []);
          productionPartsMap.get(p.item_id)!.push({ name: p.name, station_id: p.station_id });
        }
      }

      const highlights: Array<Record<string, unknown>> = [];
      if (!highlightsResult.error && highlightsResult.data) {
        for (const h of highlightsResult.data as Array<Record<string, unknown>>) {
          const item = (itemResult.data ?? []).find((i: Record<string, unknown>) => i.id === h.item_id);
          if (item) {
            highlights.push({
              id: h.id,
              item_id: h.item_id,
              custom_price: h.custom_price,
              custom_description: h.custom_description,
              sort_order: h.sort_order,
              item_name: item.name,
              item_price: item.price,
              item_photo_url: item.photo_url,
              item_description: item.description,
              item_category_id: item.category_id,
              item_station_id: item.station_id,
              item_skip_kds: item.skip_kds,
              item_sla_minutes: item.sla_minutes,
            });
          }
        }
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

      return new Response(JSON.stringify({
        categories: catResult.data ?? [],
        items: itemResult.data ?? [],
        option_groups: ogResult.data ?? [],
        options,
        observations: obsResult.data ?? [],
        out_of_stock_ids: outOfStockIds,
        opcoes_indisponiveis_ids: opcoesIndisponiveisIds,
        production_parts: Object.fromEntries(productionPartsMap),
        highlights,
        promotions,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_meus_pedidos") {
      const { participant_id } = body;
      if (!participant_id) return new Response(JSON.stringify({ error: "participant_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: orders } = await admin.from("orders").select("id, number, status, total_amount, subtotal, created_at, order_items(id, item_name, item_price, quantity, status, skip_kds, notes)").eq("participant_id", participant_id).order("created_at", { ascending: false });
      return new Response(JSON.stringify({ data: orders ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action: " + action }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[mesa-write] unexpected error");
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
