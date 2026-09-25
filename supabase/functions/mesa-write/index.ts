
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { deductStockForSkipKdsItems, runStockInBackground } from "../_shared/stock.ts";
import { activeLocales, normalizeLocale, loadTranslations, decorate, decorateHighlights, translationsPayload } from "../_shared/menu-i18n.ts";

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

    if (action === "lookup_mesa") {
      const { qr_token } = body;
      if (!qr_token) return new Response(JSON.stringify({ error: "qr_token is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: tableData } = await admin.from("tables").select("id, number, capacity, area, tenant_id, qr_token").eq("qr_token", qr_token).maybeSingle();
      if (!tableData) return new Response(JSON.stringify({ error: "mesa_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: tenantRow } = await admin.from("tenants").select("name").eq("id", tableData.tenant_id).maybeSingle();

      // Mesa 0 = QR universal: fila por SENHA. Não abre nem procura table_session —
      // o cliente é identificado pelo participante (senha), ancorado na sessão de caixa.
      if (tableData.number === 0) {
        const { data: caixaSession } = await admin.from("sessions").select("id").eq("status", "open").eq("tenant_id", tableData.tenant_id).order("opened_at", { ascending: false }).limit(1).maybeSingle();
        if (!caixaSession) return new Response(JSON.stringify({ error: "mesa_encerrada", message: "Estabelecimento fechado." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ table: tableData, mode: "queue", queue: { session_id: caixaSession.id }, tenant_name: tenantRow?.name || null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Várias sessões abertas na mesma mesa (legado/corrida) faziam o maybeSingle() errar e
      // cada leitura abria MAIS uma sessão (cascata). Pega sempre a mais antiga.
      const { data: sessionData } = await admin.from("table_sessions").select("id, status, customer_name, opened_at, session_id, tenant_id, session_token").eq("table_id", tableData.id).eq("tenant_id", tableData.tenant_id).eq("status", "open").order("opened_at", { ascending: true }).limit(1).maybeSingle();
      if (!sessionData) {
        const { data: caixaSession } = await admin.from("sessions").select("id").eq("status", "open").eq("tenant_id", tableData.tenant_id).order("opened_at", { ascending: false }).limit(1).maybeSingle();
        if (!caixaSession) return new Response(JSON.stringify({ error: "mesa_encerrada", message: "Estabelecimento fechado." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const sessionCols = "id, status, customer_name, opened_at, session_id, tenant_id, session_token";
        let { data: newSession, error: newSessionErr } = await admin.from("table_sessions").insert({ table_id: tableData.id, tenant_id: tableData.tenant_id, session_id: caixaSession.id, status: "open", opened_at: new Date().toISOString() }).select(sessionCols).maybeSingle();
        if (newSessionErr || !newSession) {
          // Conflito (índice único de sessão aberta por mesa): outra leitura abriu antes — relê.
          const { data: reread } = await admin.from("table_sessions").select(sessionCols).eq("table_id", tableData.id).eq("tenant_id", tableData.tenant_id).eq("status", "open").order("opened_at", { ascending: true }).limit(1).maybeSingle();
          if (!reread) throw newSessionErr ?? new Error("table_session_create_failed");
          newSession = reread;
        }
        // Mesa 0 = QR universal (fila por senha, balcão): não é mesa do salão, não ocupa nada.
        if (tableData.number !== 0) await admin.from("tables").update({ status: "occupied" }).eq("id", tableData.id);
        const { data: tenantData } = await admin.from("tenants").select("name").eq("id", tableData.tenant_id).maybeSingle();
        return new Response(JSON.stringify({ table: tableData, session: newSession, tenant_name: tenantData?.name || null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: tenantData } = await admin.from("tenants").select("name").eq("id", tableData.tenant_id).maybeSingle();
      return new Response(JSON.stringify({ table: tableData, session: sessionData, tenant_name: tenantData?.name || null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "create_participant") {
      const { table_session_id, name, tenant_id, session_id } = body;

      // Fila por senha (QR universal): sem mesa, ancorado na sessão de caixa
      if (!table_session_id) {
        if (!session_id || !name || !tenant_id) return new Response(JSON.stringify({ error: "session_id, name e tenant_id sao obrigatorios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const { data: queueResult, error: queueErr } = await admin.rpc("fn_create_queue_ticket", { p_tenant_id: tenant_id, p_session_id: session_id, p_name: name, p_phone: body.phone ?? null });
        if (queueErr) throw queueErr;
        return new Response(JSON.stringify(queueResult), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!name || !tenant_id) return new Response(JSON.stringify({ error: "table_session_id, name e tenant_id sao obrigatorios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: result, error: rpcErr } = await admin.rpc("fn_create_mesa_participant_auto", { p_table_session_id: table_session_id, p_name: name, p_tenant_id: tenant_id });
      if (rpcErr) throw rpcErr;
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "create_mesa_order") {
      const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { tenant_id, table_session_id, session_id, participant_id, items, access_token, client_request_id } = body;
      if (!tenant_id || !session_id || !participant_id || !Array.isArray(items) || items.length === 0) return json({ error: "Dados incompletos" }, 400);
      if (items.length > 100) return json({ error: "Pedido com itens demais" }, 400);
      // Senha do participante é obrigatória (endpoint público).
      if (!access_token || !String(access_token).trim()) return json({ error: "Identificação inválida", code: "invalid_participant" }, 403);

      // QR universal: pedido de FILA (destino senha), sem mesa nenhuma.
      const isFila = !table_session_id;
      const { data: participantRow } = await admin.from("table_session_participants").select("id, name, access_token, table_session_id, session_id, tenant_id, deleted_at").eq("id", participant_id).maybeSingle();
      if (!participantRow || participantRow.deleted_at) return json({ error: "Identificação inválida", code: "invalid_participant" }, 403);
      if (String(participantRow.access_token) !== String(access_token)) return json({ error: "Identificação inválida", code: "invalid_participant" }, 403);
      if (String(participantRow.tenant_id) !== String(tenant_id)) return json({ error: "Identificação inválida", code: "invalid_participant" }, 403);

      // Sessão de caixa: existe, é da loja e está aberta.
      const { data: caixaSessionCheck } = await admin.from("sessions").select("id, status, tenant_id").eq("id", session_id).maybeSingle();
      if (!caixaSessionCheck || String(caixaSessionCheck.tenant_id) !== String(tenant_id)) return json({ error: "Sessão inválida", code: "invalid_session" }, 403);
      if (caixaSessionCheck.status !== "open") return json({ error: "Estabelecimento fechado.", code: "session_closed" }, 403);

      let mesaNumber: number | null = null;
      if (isFila) {
        if (participantRow.table_session_id) return json({ error: "Identificação inválida", code: "invalid_participant" }, 403);
        if (participantRow.session_id && String(participantRow.session_id) !== String(session_id)) return json({ error: "Identificação inválida", code: "invalid_participant" }, 403);
      } else {
        if (String(participantRow.table_session_id) !== String(table_session_id)) return json({ error: "Identificação inválida", code: "invalid_participant" }, 403);
        const { data: tsRow } = await admin.from("table_sessions").select("id, tenant_id, table_id, session_id, status").eq("id", table_session_id).maybeSingle();
        if (!tsRow || String(tsRow.tenant_id) !== String(tenant_id) || String(tsRow.session_id) !== String(session_id)) return json({ error: "Mesa inválida", code: "invalid_table_session" }, 403);
        if (tsRow.status !== "open") return json({ error: "Esta mesa foi encerrada.", code: "table_session_closed" }, 403);
        const { data: tableRow } = await admin.from("tables").select("id, number, tenant_id").eq("id", tsRow.table_id).maybeSingle();
        if (!tableRow || String(tableRow.tenant_id) !== String(tenant_id)) return json({ error: "Mesa inválida", code: "invalid_table_session" }, 403);
        mesaNumber = tableRow.number ?? null;
      }

      // Idempotência: mesmo client_request_id (retry do aparelho) devolve o pedido já criado.
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const clientRequestId: string | null = typeof client_request_id === "string" && uuidRe.test(client_request_id.trim()) ? client_request_id.trim() : null;
      const replyExisting = async (existingId: string) => {
        const { data: ex } = await admin.from("orders").select("id, number, status, tenant_id, participant_id").eq("id", existingId).maybeSingle();
        if (!ex || String(ex.tenant_id) !== String(tenant_id) || String(ex.participant_id) !== String(participant_id)) return json({ error: "Requisição inválida", code: "request_conflict" }, 409);
        if (ex.status === "cancelled") return json({ error: "Este pedido foi cancelado. Revise o carrinho e envie novamente.", code: "order_cancelled" }, 409);
        return json({ data: { id: ex.id, number: ex.number }, idempotent: true });
      };
      if (clientRequestId) {
        const { data: existing } = await admin.from("orders").select("id").eq("client_request_id", clientRequestId).maybeSingle();
        if (existing?.id) return await replyExisting(existing.id);
      }

      // ── Preço calculado no servidor (nunca confiar no body) ──
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
      const itemIds = new Set<string>();
      const comboIds = new Set<string>();
      const optionIds = new Set<string>();
      for (const it of items as Array<Record<string, unknown>>) {
        const cid = str(it?.combo_id); const iid = str(it?.item_id);
        if (cid) comboIds.add(cid); else if (iid) itemIds.add(iid);
        for (const o of (Array.isArray(it?.options) ? it.options : []) as Array<Record<string, unknown>>) {
          const oid = str(o?.option_id);
          if (oid) optionIds.add(oid);
        }
      }
      const empty = Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null });
      const [menuRes, comboRes, optRes, promoRes, hlRes] = await Promise.all([
        itemIds.size ? admin.from("menu_items").select("id, name, price, is_active, skip_kds, category_id, deleted_at").eq("tenant_id", tenant_id).in("id", [...itemIds]) : empty,
        comboIds.size ? admin.from("combos").select("id, name, price, is_active").eq("tenant_id", tenant_id).in("id", [...comboIds]) : empty,
        optionIds.size ? admin.from("options").select("id, name, additional_price, is_active, group_id").eq("tenant_id", tenant_id).in("id", [...optionIds]) : empty,
        itemIds.size ? admin.from("item_promotions").select("item_id, promotional_price, days_of_week, is_recurring, specific_date, is_active").eq("tenant_id", tenant_id).eq("is_active", true).is("deleted_at", null).in("item_id", [...itemIds]) : empty,
        itemIds.size ? admin.from("menu_highlights").select("item_id, custom_price").eq("tenant_id", tenant_id).eq("is_active", true).neq("channel", "delivery").in("item_id", [...itemIds]) : empty,
      ]);
      if (menuRes.error) throw menuRes.error;
      if (comboRes.error) throw comboRes.error;
      if (optRes.error) throw optRes.error;
      if (promoRes.error) throw promoRes.error;
      if (hlRes.error) throw hlRes.error;

      const menuMap = new Map<string, Record<string, unknown>>();
      for (const m of menuRes.data ?? []) if (m.is_active && m.deleted_at == null) menuMap.set(String(m.id), m);
      const comboMap = new Map<string, Record<string, unknown>>();
      for (const c of comboRes.data ?? []) if (c.is_active) comboMap.set(String(c.id), c);

      const categoryIds = [...new Set([...menuMap.values()].map((m) => m.category_id).filter(Boolean).map(String))];
      const groupIds = [...new Set((optRes.data ?? []).map((o: Record<string, unknown>) => o.group_id).filter(Boolean).map(String))];
      const [catRes, grpRes] = await Promise.all([
        categoryIds.length ? admin.from("menu_categories").select("id, station_id, deleted_at").eq("tenant_id", tenant_id).in("id", categoryIds) : empty,
        groupIds.length ? admin.from("option_groups").select("id, name, item_id").eq("tenant_id", tenant_id).is("deleted_at", null).in("id", groupIds) : empty,
      ]);
      if (catRes.error) throw catRes.error;
      if (grpRes.error) throw grpRes.error;
      const catStation = new Map<string, string | null>();
      for (const c of catRes.data ?? []) catStation.set(String(c.id), (c.station_id as string) ?? null);
      // Item de categoria apagada (soft delete) = indisponivel (regra do fn_get_full_menu).
      const deletedCatIds = new Set((catRes.data ?? []).filter((c: Record<string, unknown>) => c.deleted_at != null).map((c: Record<string, unknown>) => String(c.id)));
      for (const [mid, m] of [...menuMap]) if (m.category_id != null && deletedCatIds.has(String(m.category_id))) menuMap.delete(mid);
      const groupMap = new Map<string, Record<string, unknown>>();
      for (const g of grpRes.data ?? []) groupMap.set(String(g.id), g);
      const optMap = new Map<string, Record<string, unknown>>();
      for (const o of optRes.data ?? []) if (o.is_active) optMap.set(String(o.id), o);

      // Promoção válida HOJE em Brasília (mesma regra de rawPromoAtivaHoje do front; menor preço vence).
      const brParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date());
      const bp = (t: string) => brParts.find((p) => p.type === t)?.value ?? "";
      const hojeBR = `${bp("year")}-${bp("month")}-${bp("day")}`;
      const diaSemanaBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(bp("weekday"));
      const promoMap = new Map<string, number>();
      for (const p of promoRes.data ?? []) {
        let valida: boolean;
        if (p.specific_date && !p.is_recurring) valida = String(p.specific_date).slice(0, 10) === hojeBR;
        else valida = !Array.isArray(p.days_of_week) || p.days_of_week.length === 0 || (p.days_of_week as number[]).includes(diaSemanaBR);
        if (!valida) continue;
        const k = String(p.item_id); const v = Number(p.promotional_price ?? 0);
        if (!promoMap.has(k) || v < (promoMap.get(k) as number)) promoMap.set(k, v);
      }
      const highlightPrices = new Map<string, number[]>();
      for (const h of hlRes.data ?? []) {
        if (h.custom_price == null) continue;
        const k = String(h.item_id);
        highlightPrices.set(k, [...(highlightPrices.get(k) ?? []), Number(h.custom_price)]);
      }

      const cents = (n: number) => Math.round(n * 100) / 100;
      let serverSubtotal = 0;
      const resolvedItems: Array<Record<string, unknown>> = [];
      for (const raw of items as Array<Record<string, unknown>>) {
        const clientName = typeof raw?.item_name === "string" ? raw.item_name.trim().slice(0, 200) : "";
        const qty = Math.floor(Number(raw?.quantity ?? 1));
        if (!Number.isFinite(qty) || qty < 1 || qty > 99) return json({ error: "Quantidade inválida: " + (clientName || "item") }, 400);

        // Opções: precisam existir, estar ativas e (no item) pertencer a um grupo do próprio item.
        const rawOpts = (Array.isArray(raw?.options) ? raw.options : []) as Array<Record<string, unknown>>;
        const cid = str(raw?.combo_id); const iid = str(raw?.item_id);
        let optionsTotal = 0; let clientOptionsTotal = 0;
        const serverOpts: Array<Record<string, unknown>> = [];
        for (const o of rawOpts) {
          const oid = str(o?.option_id);
          const op = oid ? optMap.get(oid) : undefined;
          const grp = op ? groupMap.get(String(op.group_id)) : undefined;
          if (!op || !grp || (!cid && String(grp.item_id) !== String(iid))) {
            return json({ error: "Opção indisponível: " + (String(o?.option_name ?? "") || clientName || "item") + ". Remova o item do carrinho e adicione de novo.", code: "option_unavailable" }, 400);
          }
          const price = Number(op.additional_price ?? 0);
          optionsTotal += price;
          clientOptionsTotal += Number(o?.additional_price ?? 0) || 0;
          serverOpts.push({ option_id: op.id, option_name: op.name ?? "", group_name: grp.name ?? "", additional_price: price });
        }

        let basePrice: number; let serverName: string; let stationId: string | null = null; let skipKds = false;
        if (cid) {
          const combo = comboMap.get(cid);
          if (!combo) return json({ error: "Combo indisponível: " + (clientName || cid), code: "item_unavailable" }, 400);
          basePrice = Number(combo.price ?? 0); serverName = String(combo.name ?? clientName);
          stationId = str(raw?.station_id); skipKds = raw?.skip_kds === true;
        } else if (iid) {
          const mi = menuMap.get(iid);
          if (!mi) return json({ error: "Item indisponível: " + (clientName || iid) + ". Remova do carrinho.", code: "item_unavailable" }, 400);
          serverName = String(mi.name ?? clientName);
          stationId = mi.category_id ? (catStation.get(String(mi.category_id)) ?? null) : null;
          skipKds = mi.skip_kds === true;
          // Preço base: promoção de hoje > preço de destaque da casa (se o cliente escolheu pelo destaque) > preço do item.
          const promo = promoMap.get(iid);
          if (promo !== undefined) basePrice = promo;
          else {
            const clientBase = Number(raw?.item_price ?? NaN) - clientOptionsTotal;
            const hl = (highlightPrices.get(iid) ?? []).find((p) => Number.isFinite(clientBase) && Math.abs(p - clientBase) < 0.011);
            basePrice = hl !== undefined ? hl : Number(mi.price ?? 0);
          }
        } else {
          return json({ error: "Item inválido (sem identificação)", code: "item_unavailable" }, 400);
        }

        // Convenção da mesa/garçom: item_price = unitário já com opções.
        const unit = cents(basePrice + optionsTotal);
        serverSubtotal = cents(serverSubtotal + unit * qty);
        const obsRaw = (Array.isArray(raw?.observations) ? raw.observations : []) as Array<Record<string, unknown>>;
        resolvedItems.push({
          item_id: cid ? (iid ?? null) : iid,
          combo_id: cid,
          // Mantém o sufixo "(Un. 2)" que o app põe, desde que seja o mesmo item.
          item_name: clientName && clientName.startsWith(serverName) ? clientName : serverName,
          item_price: unit,
          quantity: qty,
          station_id: stationId,
          skip_kds: skipKds,
          notes: typeof raw?.notes === "string" ? raw.notes.slice(0, 500) : null,
          options: serverOpts,
          observations: obsRaw.map((o) => ({ text: String(o?.text ?? "").slice(0, 200), is_checked: o?.is_checked === true })),
        });
      }

      const { data: numData, error: numErr } = await admin.rpc("fn_next_tenant_order_number", { p_tenant_id: tenant_id });
      if (numErr) throw numErr;
      const orderNumber = numData?.[0]?.number ?? "P" + Date.now();

      // Destino: na fila é a SENHA pura (o KDS lê destination_name como senha quando
      // destination_type = 'password'; nome e senha também chegam pelo participant_id).
      const participantName = typeof participantRow.name === "string" ? participantRow.name.trim() : "";
      const senhaFila = String(participantRow.access_token ?? "").trim();
      const tableDestName = isFila
        ? (senhaFila || participantName || null)
        : (mesaNumber != null
          ? (participantName ? `Mesa ${mesaNumber} - ${participantName}` : `Mesa ${mesaNumber}`)
          : null);
      const { data: order, error: orderErr } = await admin.rpc("fn_create_order_bypass", { order_data: { tenant_id, session_id, table_session_id: isFila ? null : table_session_id, participant_id, number: orderNumber, status: "new", origin_type: isFila ? "self_service" : "table", destination_type: isFila ? "password" : "table", destination_name: tableDestName, discount_amount: 0, service_fee_amount: 0, subtotal: serverSubtotal, total_amount: serverSubtotal, is_training: false, is_draft: false, table_number: isFila ? null : mesaNumber, client_request_id: clientRequestId } });
      if (orderErr) throw orderErr;
      const orderRow = Array.isArray(order) ? order[0] : order;
      const orderId = orderRow?.id;
      if (!orderId) return json({ error: "Falha ao criar pedido" }, 500);
      // Corrida: outra requisição com o mesmo client_request_id criou primeiro.
      if (orderRow?.duplicate === true) return await replyExisting(orderId);

      const { error: itemsErr } = await admin.rpc("fn_create_order_items_bypass", { p_order_id: orderId, p_tenant_id: tenant_id, p_items: resolvedItems });
      if (itemsErr) {
        // A RPC só lança se NENHUM item entrou; confere antes de cancelar (erro de rede pós-commit).
        const { count } = await admin.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", orderId).eq("tenant_id", tenant_id);
        if ((count ?? 0) === 0) {
          await admin.from("orders").update({ status: "cancelled", cancel_reason: "Auto-cancelado: falha ao inserir itens (mesa-qr)", cancelled_at: new Date().toISOString() }).eq("id", orderId).eq("tenant_id", tenant_id);
          console.error("[mesa-write] create_mesa_order: itens falharam, pedido cancelado", orderId);
          return json({ error: "Não foi possível enviar o pedido. Tente novamente.", code: "items_failed", cancelled: true }, 422);
        }
      }
      // Itens sem preparo (skip_kds, ex.: refrigerante) não passam pelo KDS: baixa o estoque agora.
      runStockInBackground(deductStockForSkipKdsItems(admin, String(tenant_id), String(orderId)).catch((e) => console.warn("[mesa-write] baixa de estoque falhou", orderId, String(e))));
      return json({ data: { id: orderId, number: orderNumber, subtotal: serverSubtotal, total_amount: serverSubtotal } });
    }

    // Troca de idioma sem recarregar o cardapio (ver delivery-write).
    if (action === "get_menu_translations") {
      const t = String(body.tenant_id ?? "").trim();
      if (!t) return new Response(JSON.stringify({ error: "tenant_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const payload = await translationsPayload(admin, t, body.locale);
      return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_cardapio") {
      const { tenant_id } = body;
      if (!tenant_id) return new Response(JSON.stringify({ error: "tenant_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const [catResult, itemResult, ogResult, optResult, obsResult, estoqueResult, opcoesEstoqueResult, partesResult, highlightsResult, promotionsResult, deletedCatsResult] = await Promise.all([
        admin.from("menu_categories").select("id, name, station_id").eq("tenant_id", tenant_id).eq("is_active", true).is("deleted_at", null).order("sort_order", { ascending: true }),
        admin.from("menu_items").select("id, name, description, price, photo_url, category_id, sla_minutes, is_active, skip_kds").eq("tenant_id", tenant_id).eq("is_active", true).is("deleted_at", null),
        admin.from("option_groups").select("id, name, item_id, is_required, min_selections, max_selections").eq("tenant_id", tenant_id).is("deleted_at", null),
        // deleted_at: opcao apagada NAO pode aparecer pro cliente (mesma correcao
        // feita em delivery-write). A busca por id la em cima fica sem o filtro
        // de proposito: pedido antigo precisa resolver o nome da opcao apagada.
        admin.from("options").select("id, group_id, name, additional_price, is_active").eq("tenant_id", tenant_id).eq("is_active", true).is("deleted_at", null).order("sort_order", { ascending: true }),
        admin.from("item_preset_observations").select("id, item_id, text").eq("tenant_id", tenant_id).is("deleted_at", null),
        admin.rpc("fn_get_items_sem_estoque", { p_tenant_id: tenant_id }),
        admin.rpc("fn_get_opcoes_sem_estoque", { p_tenant_id: tenant_id }),
        admin.from("item_production_parts").select("item_id, name, station_id").eq("tenant_id", tenant_id).is("deleted_at", null).order("sort_order"),
        // Destaques da CASA (mesa-qr): canal 'ambos' ou 'casa' (exclui os 'só delivery').
        admin.from("menu_highlights").select("id, item_id, custom_price, custom_description, sort_order").eq("tenant_id", tenant_id).eq("is_active", true).neq("channel", "delivery").order("sort_order", { ascending: true }),
        admin.from("item_promotions").select("id, item_id, promotional_price, days_of_week, is_recurring, specific_date, is_active").eq("tenant_id", tenant_id).eq("is_active", true).is("deleted_at", null),
        // Categorias APAGADAS (soft delete): seus itens somem do cardapio (mesma regra do fn_get_full_menu).
        admin.from("menu_categories").select("id").eq("tenant_id", tenant_id).not("deleted_at", "is", null),
      ]);
      if (deletedCatsResult.error) throw deletedCatsResult.error;
      const deletedCatIds = new Set(((deletedCatsResult.data ?? []) as Array<{ id: string }>).map((c) => c.id));
      if (itemResult.data) itemResult.data = (itemResult.data as Array<Record<string, unknown>>).filter((it) => !(it.category_id && deletedCatIds.has(it.category_id as string)));

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

      // A estação de produção fica na CATEGORIA (menu_categories.station_id), não no item.
      // Propagamos para cada item para que o roteamento de impressão do mesa-qr
      // (queueOrderForPrint -> print-queue-agent.mapaEstacoes) resolva a impressora certa.
      // Sem isso, os itens chegam com station_id nulo e caem nos fallbacks genéricos
      // "cozinha-padrao"/"bar", que só imprimem por acaso em lojas com 1 impressora.
      const categoryStationMap = new Map<string, string | null>();
      for (const c of (catResult.data ?? []) as Array<{ id: string; station_id: string | null }>) {
        categoryStationMap.set(c.id, c.station_id ?? null);
      }
      const itemsWithStation = ((itemResult.data ?? []) as Array<Record<string, unknown>>).map((it) => ({
        ...it,
        station_id: categoryStationMap.get(it.category_id as string) ?? null,
      }));

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
              item_station_id: categoryStationMap.get(item.category_id as string) ?? null,
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

      // Idioma do cliente: acrescenta `*_i18n` sem tocar no texto em portugues.
      // O pedido segue saindo em PT (ver comentario em _shared/menu-i18n.ts).
      const mesaLocales = await activeLocales(admin, tenant_id);
      const mesaLocale = normalizeLocale(body.locale, mesaLocales);
      const mesaTrans = mesaLocale ? await loadTranslations(admin, tenant_id, mesaLocale) : new Map();

      return new Response(JSON.stringify({
        categories: decorate(catResult.data ?? [], "category", mesaTrans),
        items: decorate(itemsWithStation, "item", mesaTrans),
        option_groups: decorate(ogResult.data ?? [], "option_group", mesaTrans),
        options: decorate(options, "option", mesaTrans),
        observations: decorate(obsResult.data ?? [], "preset_obs", mesaTrans, "text", "text_desc"),
        out_of_stock_ids: outOfStockIds,
        opcoes_indisponiveis_ids: opcoesIndisponiveisIds,
        production_parts: Object.fromEntries(productionPartsMap),
        highlights: decorateHighlights(highlights, mesaTrans),
        promotions,
        locales: mesaLocales,
        locale: mesaLocale ?? "pt-BR",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_meus_pedidos") {
      const { participant_id, access_token } = body;
      if (!participant_id || !access_token) return new Response(JSON.stringify({ error: "participant_id and access_token are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: participantRow } = await admin.from("table_session_participants").select("id, access_token, deleted_at").eq("id", participant_id).maybeSingle();
      if (!participantRow || participantRow.deleted_at || String(participantRow.access_token) !== String(access_token)) {
        return new Response(JSON.stringify({ error: "Identificação inválida", code: "invalid_participant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: orders } = await admin.from("orders").select("id, number, status, total_amount, subtotal, created_at, order_items(id, item_name, item_price, quantity, status, skip_kds, notes)").eq("participant_id", participant_id).order("created_at", { ascending: false });
      return new Response(JSON.stringify({ data: orders ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action: " + action }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[mesa-write] unexpected error");
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
