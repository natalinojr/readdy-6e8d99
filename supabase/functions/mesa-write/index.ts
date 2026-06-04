
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve({ verify_jwt: false }, async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!serviceRoleKey || serviceRoleKey.length < 40) {
    console.error("[mesa-write] SUPABASE_SERVICE_ROLE_KEY not configured.");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json();
    const { action } = body;
    console.log("[mesa-write] action:", action);

    if (!action) {
      return new Response(JSON.stringify({ error: "action is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 1a. lookup_mesa_by_number ──
    if (action === "lookup_mesa_by_number") {
      const { table_number, tenant_id } = body;
      if (!table_number || !tenant_id) {
        return new Response(JSON.stringify({ error: "table_number and tenant_id are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: tableData, error: tableErr } = await admin
        .from("tables")
        .select("id, number, capacity, area, tenant_id, qr_token")
        .eq("tenant_id", tenant_id)
        .eq("number", table_number)
        .maybeSingle();

      if (tableErr) throw tableErr;
      if (!tableData) {
        return new Response(JSON.stringify({ error: "mesa_not_found", message: "Mesa nao encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: sessionData, error: sessionErr } = await admin
        .from("table_sessions")
        .select("id, status, customer_name, opened_at, session_id, tenant_id")
        .eq("table_id", tableData.id)
        .eq("status", "open")
        .maybeSingle();

      if (sessionErr) throw sessionErr;

      if (!sessionData) {
        return new Response(JSON.stringify({ error: "mesa_encerrada", message: "Mesa encerrada", table: { number: tableData.number } }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({
        table: tableData,
        session: sessionData,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 1b. lookup_mesa ──
    if (action === "lookup_mesa") {
      const { qr_token } = body;
      if (!qr_token) {
        return new Response(JSON.stringify({ error: "qr_token is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      console.log("[lookup_mesa] qr_token:", qr_token);

      const { data: tableData, error: tableErr } = await admin
        .from("tables")
        .select("id, number, capacity, area, tenant_id, qr_token")
        .eq("qr_token", qr_token)
        .maybeSingle();

      if (tableErr) {
        console.error("[lookup_mesa] tableErr:", JSON.stringify(tableErr));
        throw tableErr;
      }
      if (!tableData) {
        return new Response(JSON.stringify({ error: "mesa_not_found", message: "Mesa nao encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.log("[lookup_mesa] table:", tableData.id, "tenant:", tableData.tenant_id);

      const { data: sessionData, error: sessionErr } = await admin
        .from("table_sessions")
        .select("id, status, customer_name, opened_at, session_id, tenant_id")
        .eq("table_id", tableData.id)
        .eq("status", "open")
        .maybeSingle();

      if (sessionErr) {
        console.error("[lookup_mesa] sessionErr:", JSON.stringify(sessionErr));
        throw sessionErr;
      }

      if (!sessionData) {
        console.log("[lookup_mesa] no open session, finding cash session for tenant:", tableData.tenant_id);
        const { data: cashSession, error: cashSessionErr } = await admin
          .from("sessions")
          .select("id")
          .eq("tenant_id", tableData.tenant_id)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cashSessionErr) {
          console.error("[lookup_mesa] cashSessionErr:", JSON.stringify(cashSessionErr));
          throw cashSessionErr;
        }

        if (!cashSession) {
          return new Response(JSON.stringify({ error: "mesa_encerrada", message: "O estabelecimento esta fechado no momento.", table: { number: tableData.number } }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        console.log("[lookup_mesa] cashSession:", cashSession.id);

        const { data: newSession, error: newSessionErr } = await admin
          .from("table_sessions")
          .insert({
            table_id: tableData.id,
            tenant_id: tableData.tenant_id,
            session_id: cashSession.id,
            status: "open",
            opened_at: new Date().toISOString(),
          })
          .select("id, status, customer_name, opened_at, session_id, tenant_id")
          .maybeSingle();

        if (newSessionErr) {
          console.error("[lookup_mesa] newSessionErr:", JSON.stringify(newSessionErr));
          throw newSessionErr;
        }
        if (!newSession) {
          return new Response(JSON.stringify({ error: "mesa_encerrada", message: "O estabelecimento esta fechado no momento.", table: { number: tableData.number } }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        console.log("[lookup_mesa] newSession created:", newSession.id);

        // Atualiza status da mesa para occupied
        await admin.from("tables").update({ status: "occupied" }).eq("id", tableData.id);

        return new Response(JSON.stringify({
          table: tableData,
          session: newSession,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      console.log("[lookup_mesa] existing session:", sessionData.id);
      return new Response(JSON.stringify({
        table: tableData,
        session: sessionData,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 2. create_participant ──
    if (action === "create_participant") {
      const { table_session_id, name, tenant_id } = body;
      console.log("[create_participant] input:", { table_session_id, name: name?.substring(0, 20), tenant_id });

      if (!table_session_id || !name || !tenant_id) {
        return new Response(JSON.stringify({ error: "table_session_id, name e tenant_id sao obrigatorios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Valida que a sessão está aberta antes de criar participante
      const { data: sessionCheck } = await admin
        .from("table_sessions")
        .select("id, status")
        .eq("id", table_session_id)
        .maybeSingle();

      if (!sessionCheck || sessionCheck.status !== "open") {
        console.warn("[create_participant] session not open:", sessionCheck?.status);
        return new Response(JSON.stringify({ error: "session_not_found", message: "Sessao de mesa encerrada. Por favor, recarregue a pagina." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: result, error: rpcErr } = await admin.rpc("fn_create_mesa_participant_auto", {
        p_table_session_id: table_session_id,
        p_name: name,
        p_tenant_id: tenant_id,
      });

      if (rpcErr) {
        console.error("[create_participant] rpcErr:", JSON.stringify(rpcErr));
        throw rpcErr;
      }

      if (result?.error) {
        console.error("[create_participant] fn error:", result.error);
        return new Response(JSON.stringify({ error: result.error, message: result.message || "" }), { status: result.error === "session_not_found" ? 404 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      console.log("[create_participant] created via RPC:", result?.participant?.id);

      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 3. create_mesa_order ──
    if (action === "create_mesa_order") {
      const {
        tenant_id,
        table_session_id,
        session_id,
        participant_id,
        access_token,
        items,
        subtotal,
        total_amount,
      } = body;

      if (!tenant_id || !table_session_id || !session_id || !participant_id || !Array.isArray(items) || items.length === 0) {
        return new Response(JSON.stringify({ error: "Dados incompletos para criar pedido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ── Buscar número da mesa ───────
      let tableNumber: number | null = null;
      try {
        const { data: sessRow } = await admin
          .from("table_sessions")
          .select("table_id")
          .eq("id", table_session_id)
          .maybeSingle();

        if (sessRow?.table_id) {
          const { data: tableRow } = await admin
            .from("tables")
            .select("number")
            .eq("id", sessRow.table_id)
            .maybeSingle();
          tableNumber = tableRow?.number ?? null;
        }
        console.log("[create_mesa_order] tableNumber:", tableNumber);
      } catch (e) {
        console.warn("[create_mesa_order] Erro ao buscar table_number:", e);
      }

      const { data: numData, error: numErr } = await admin.rpc("fn_next_order_number", {
        p_session_id: session_id,
        p_tenant_id: tenant_id,
      });
      if (numErr) throw numErr;
      const orderNumber = numData?.[0]?.number ?? `P${Date.now()}`;

      // FIX: usa destination_type="table" com table_number preenchido
      // Isso garante que o pedido apareça vinculado à mesa no KDS e na aba Mesas
      const { data: order, error: orderErr } = await admin.rpc("fn_create_order_bypass", {
        order_data: {
          tenant_id,
          session_id,
          table_session_id,
          participant_id,
          number: orderNumber,
          status: "new",
          origin_type: "table",
          destination_type: "table",
          destination_name: access_token,
          table_number: tableNumber,
          discount_amount: 0,
          service_fee_amount: 0,
          subtotal: subtotal ?? 0,
          total_amount: total_amount ?? (subtotal ?? 0),
          is_training: false,
          is_draft: false,
        },
      });

      if (orderErr) throw orderErr;
      const orderId = order?.id;
      if (!orderId) {
        return new Response(JSON.stringify({ error: "Falha ao criar pedido" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const resolvedItems = items.map((item: Record<string, unknown>) => ({
        item_id: item.item_id ?? null,
        combo_id: item.combo_id ?? null,
        item_name: item.item_name,
        item_price: item.item_price ?? 0,
        quantity: item.quantity ?? 1,
        station_id: item.station_id ?? null,
        skip_kds: item.skip_kds ?? false,
        notes: item.notes ?? null,
        options: ((item.options ?? []) as Array<Record<string, unknown>>).map((o) => ({
          option_id: o.option_id ?? null,
          option_name: o.option_name ?? "",
          group_name: o.group_name ?? "",
          additional_price: o.additional_price ?? 0,
        })),
        observations: ((item.observations ?? []) as Array<Record<string, unknown>>).map((o) => ({
          text: o.text ?? "",
          is_checked: o.is_checked ?? false,
        })),
      }));

      const { error: itemsErr } = await admin.rpc("fn_create_order_items_bypass", {
        p_order_id: orderId,
        p_tenant_id: tenant_id,
        p_items: resolvedItems,
      });

      if (itemsErr) throw itemsErr;

      // ── Enfileirar tickets de impressão ─────────────────────────────────────
      try {
        const destinoLabel = tableNumber ? `Mesa ${tableNumber}` : "Mesa";
        const now = new Date().toLocaleString("pt-BR", {
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        });
        const numeroLimpo = orderNumber.replace(/\D/g, "");
        const numeroTicket = parseInt(numeroLimpo.slice(-4), 10) || 1;

        const itensCozinha = resolvedItems.filter((i) => !i.skip_kds);
        const itensBar = resolvedItems.filter((i) => i.skip_kds);

        const groupedByStation = new Map<string, Array<Record<string, unknown>>>();
        for (const item of itensCozinha) {
          const key = (item.station_id as string) ?? "cozinha-padrao";
          if (!groupedByStation.has(key)) groupedByStation.set(key, []);
          groupedByStation.get(key)!.push(item);
        }

        for (const [stationKey, stationItems] of groupedByStation.entries()) {
          const ticketPayload = {
            numero: numeroTicket,
            destino: destinoLabel,
            origem: "mesa",
            impressora_id: stationKey,
            mesa: tableNumber ? String(tableNumber) : "",
            itens: stationItems.map((si) => {
              const opcoes = ((si.options ?? []) as Array<Record<string, unknown>>)
                .map((o) => o.option_name)
                .filter(Boolean);
              const obs: string[] = [];
              if (si.notes && String(si.notes).trim()) obs.push(String(si.notes).trim());
              ((si.observations ?? []) as Array<Record<string, unknown>>).forEach((o) => {
                if (o.text && String(o.text).trim()) obs.push(String(o.text).trim());
              });
              return {
                quantidade: si.quantity,
                nome: si.item_name,
                ...(opcoes.length > 0 ? { opcoes } : {}),
                ...(obs.length > 0 ? { observacoes: [...new Set(obs)] } : {}),
              };
            }),
            data_hora: now,
          };

          await admin.rpc("enqueue_print_ticket", {
            p_tenant_id: tenant_id,
            p_order_id: orderId,
            p_order_number: orderNumber,
            p_station_key: stationKey,
            p_station_label: destinoLabel,
            p_content_type: "ticket_json",
            p_payload: ticketPayload,
            p_paper_style: "80mm",
          });
        }

        if (itensBar.length > 0) {
          const barPayload = {
            numero: numeroTicket,
            destino: `${destinoLabel} — BAR`,
            origem: "mesa",
            impressora_id: "bar",
            mesa: tableNumber ? String(tableNumber) : "",
            itens: itensBar.map((si) => {
              const opcoes = ((si.options ?? []) as Array<Record<string, unknown>>)
                .map((o) => o.option_name)
                .filter(Boolean);
              const obs: string[] = [];
              if (si.notes && String(si.notes).trim()) obs.push(String(si.notes).trim());
              ((si.observations ?? []) as Array<Record<string, unknown>>).forEach((o) => {
                if (o.text && String(o.text).trim()) obs.push(String(o.text).trim());
              });
              return {
                quantidade: si.quantity,
                nome: si.item_name,
                ...(opcoes.length > 0 ? { opcoes } : {}),
                ...(obs.length > 0 ? { observacoes: [...new Set(obs)] } : {}),
              };
            }),
            data_hora: now,
          };

          await admin.rpc("enqueue_print_ticket", {
            p_tenant_id: tenant_id,
            p_order_id: orderId,
            p_order_number: orderNumber,
            p_station_key: "bar",
            p_station_label: `${destinoLabel} — BAR`,
            p_content_type: "ticket_json",
            p_payload: barPayload,
            p_paper_style: "80mm",
          });
        }

        console.log("[create_mesa_order] Tickets enfileirados com sucesso");
      } catch (printErr) {
        console.error("[create_mesa_order] Erro ao enfileirar impressao (non-blocking):", printErr);
      }

      return new Response(JSON.stringify({
        data: {
          id: orderId,
          number: orderNumber,
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 4. get_cardapio ──
    if (action === "get_cardapio") {
      const { tenant_id } = body;
      if (!tenant_id) {
        return new Response(JSON.stringify({ error: "tenant_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: categories, error: catErr } = await admin
        .from("menu_categories")
        .select("id, name, station_id, kitchen_stations(name)")
        .eq("tenant_id", tenant_id)
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (catErr) throw catErr;

      const { data: items, error: itemErr } = await admin
        .from("menu_items")
        .select("id, name, description, price, photo_url, category_id, sla_minutes, is_active, skip_kds, station_id, kitchen_stations(name)")
        .eq("tenant_id", tenant_id)
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (itemErr) throw itemErr;

      const { data: optionGroups, error: ogErr } = await admin
        .from("option_groups")
        .select("id, name, item_id, is_required, min_selection, max_selection")
        .eq("tenant_id", tenant_id)
        .is("deleted_at", null)
        .order("order_index", { ascending: true });

      if (ogErr) throw ogErr;

      const { data: options, error: optErr } = await admin
        .from("options")
        .select("id, name, option_group_id, additional_price, is_active")
        .eq("tenant_id", tenant_id)
        .eq("is_active", true);

      if (optErr) throw optErr;

      const { data: observations, error: obsErr } = await admin
        .from("item_preset_observations")
        .select("id, item_id, text")
        .eq("tenant_id", tenant_id)
        .is("deleted_at", null);

      if (obsErr) throw obsErr;

      return new Response(JSON.stringify({
        categories: categories ?? [],
        items: items ?? [],
        option_groups: optionGroups ?? [],
        options: options ?? [],
        observations: observations ?? [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 5. get_meus_pedidos ──
    if (action === "get_meus_pedidos") {
      const { participant_id } = body;
      if (!participant_id) {
        return new Response(JSON.stringify({ error: "participant_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: orders, error: ordersErr } = await admin
        .from("orders")
        .select("id, number, status, total_amount, subtotal, created_at, order_items(id, item_name, item_price, quantity, status, skip_kds, notes, order_item_options(option_name, additional_price), order_item_observations(text))")
        .eq("participant_id", participant_id)
        .order("created_at", { ascending: false });

      if (ordersErr) throw ordersErr;

      return new Response(JSON.stringify({ data: orders ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : typeof err === "object" ? JSON.stringify(err) : String(err);
    console.error("[mesa-write] FINAL error:", errMsg);
    return new Response(JSON.stringify({ error: errMsg, debug: "check edge function logs" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
