import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const QA_TENANT = "aa000000-0000-4000-8000-000000000099";
const STATIONS = { cozinha: "bb000001-0000-4000-8000-000000000099", chapa: "bb000002-0000-4000-8000-000000000099", bar: "bb000003-0000-4000-8000-000000000099" };
const ITEMS = {
  fritas: { id: "dd000001-0000-4000-8000-000000000099", name: "QA-Porcao Fritas", price: 18.90, station: STATIONS.cozinha },
  bolinho: { id: "dd000002-0000-4000-8000-000000000099", name: "QA-Bolinho Bacalhau", price: 24.90, station: STATIONS.cozinha },
  picanha: { id: "dd000003-0000-4000-8000-000000000099", name: "QA-Picanha 300g", price: 89.90, station: STATIONS.chapa },
  frango: { id: "dd000004-0000-4000-8000-000000000099", name: "QA-Frango Grelhado", price: 42.90, station: STATIONS.chapa },
  salmao: { id: "dd000005-0000-4000-8000-000000000099", name: "QA-Salmao Grelhado", price: 74.90, station: STATIONS.chapa },
  hamburguer: { id: "dd000006-0000-4000-8000-000000000099", name: "QA-Hamburguer Artesanal", price: 38.90, station: STATIONS.chapa },
  coca: { id: "dd000007-0000-4000-8000-000000000099", name: "QA-Coca-Cola Lata", price: 7.90, station: null, skip_kds: true },
  suco: { id: "dd000008-0000-4000-8000-000000000099", name: "QA-Suco Natural", price: 12.90, station: STATIONS.bar },
  cerveja: { id: "dd000009-0000-4000-8000-000000000099", name: "QA-Cerveja Artesanal", price: 19.90, station: null, skip_kds: true },
  gateau: { id: "dd000010-0000-4000-8000-000000000099", name: "QA-Petit Gateau", price: 28.90, station: STATIONS.cozinha },
  pudim: { id: "dd000011-0000-4000-8000-000000000099", name: "QA-Pudim", price: 16.90, station: STATIONS.cozinha },
  combo: { id: "dd000012-0000-4000-8000-000000000099", name: "QA-Combo Executivo", price: 59.90, station: STATIONS.cozinha },
};
const OPTIONS = {
  malPassadoCarne: { id: "ff000001-0000-4000-8000-000000000099", name: "Mal Passado", group: "Ponto da Carne", price: 0 },
  aoPontoCarne: { id: "ff000002-0000-4000-8000-000000000099", name: "Ao Ponto", group: "Ponto da Carne", price: 0 },
  bemPassadoCarne: { id: "ff000003-0000-4000-8000-000000000099", name: "Bem Passado", group: "Ponto da Carne", price: 0 },
  farofa: { id: "ff000004-0000-4000-8000-000000000099", name: "Farofa Extra", group: "Acompanhamento Extra", price: 5.00 },
  vinagrete: { id: "ff000005-0000-4000-8000-000000000099", name: "Vinagrete", group: "Acompanhamento Extra", price: 4.00 },
  malPassadoBurger: { id: "ff000006-0000-4000-8000-000000000099", name: "Mal Passado", group: "Ponto do Hamburguer", price: 0 },
  aoPontoBurger: { id: "ff000007-0000-4000-8000-000000000099", name: "Ao Ponto", group: "Ponto do Hamburguer", price: 0 },
  laranja: { id: "ff000009-0000-4000-8000-000000000099", name: "Laranja", group: "Sabor do Suco", price: 0 },
  acerola: { id: "ff000010-0000-4000-8000-000000000099", name: "Acerola", group: "Sabor do Suco", price: 0 },
};
function log(level: string, msg: string, ctx?: Record<string, unknown>) { console.log(JSON.stringify({ ts: new Date().toISOString(), level, fn: "qa-full-simulation", msg, ...ctx })); }
function daysAgo(n: number, hour = 12, minute = 0): string { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hour, minute, 0, 0); return d.toISOString(); }
function buildItem(item: typeof ITEMS.picanha, qty: number, opts: typeof OPTIONS.aoPontoCarne[], notes?: string) {
  const optPrice = opts.reduce((s, o) => s + o.price, 0);
  return { item_id: item.id, item_name: item.name, item_price: item.price + optPrice, quantity: qty, station_id: item.station ?? null, skip_kds: (item as Record<string,unknown>).skip_kds ?? false, notes: notes ?? null, options: opts.map(o => ({ option_id: o.id, option_name: o.name, group_name: o.group, additional_price: o.price })), observations: notes ? [{ text: notes }] : [] };
}
async function createSession(admin: ReturnType<typeof createClient>, userId: string, openedAt: string): Promise<string> {
  const { data, error } = await admin.rpc("fn_create_session_bypass", { session_data: { tenant_id: QA_TENANT, opened_by: userId, opened_at: openedAt, status: "open", is_training: false, opening_amount: 200, last_order_number: 0 } });
  if (error) throw new Error(`createSession: ${error.message}`);
  const id = (data as Record<string,string>)?.id;
  if (!id) throw new Error("createSession: no id returned");
  return id;
}
async function createCashRegister(admin: ReturnType<typeof createClient>, sessionId: string, userId: string, openedAt: string): Promise<string> {
  const { data, error } = await admin.rpc("fn_create_cash_register_bypass", { register_data: { session_id: sessionId, tenant_id: QA_TENANT, operator_id: userId, opening_value: 200, opening_method: "total", status: "open", opened_at: openedAt } });
  if (error) throw new Error(`createCashRegister: ${error.message}`);
  const id = (data as Record<string,string>)?.id;
  if (!id) throw new Error("createCashRegister: no id returned");
  return id;
}
async function closeSession(admin: ReturnType<typeof createClient>, sessionId: string, cashRegisterId: string, userId: string, closedAt: string) {
  const { error } = await admin.rpc("fn_close_session_bypass", { p_session_id: sessionId, p_cash_register_id: cashRegisterId, p_user_id: userId, p_closed_at: closedAt, p_closing_value: 350 });
  if (error) throw new Error(`closeSession: ${error.message}`);
}
async function createOrder(admin: ReturnType<typeof createClient>, sessionId: string, userId: string, params: Record<string,unknown>): Promise<{ id: string; number: string }> {
  const items = params.items as Record<string,unknown>[];
  const subtotal = items.reduce((s: number, i) => s + (i.item_price as number) * (i.quantity as number), 0);
  const discount = (params.discount as number) ?? 0;
  const serviceFee = (params.service_fee as number) ?? 0;
  const total = subtotal - discount + serviceFee;
  const { data: numData } = await admin.rpc("fn_next_order_number", { p_session_id: sessionId, p_tenant_id: QA_TENANT });
  const orderNumber = (numData as Record<string,string>[])?.[0]?.number ?? `QA-${Date.now()}`;
  const orderPayload: Record<string, unknown> = { tenant_id: QA_TENANT, session_id: sessionId, number: orderNumber, status: "new", origin_type: params.origin, destination_type: params.destination, destination_name: params.destination_name ?? null, table_number: params.table_number ?? null, discount_amount: discount, service_fee_amount: serviceFee, subtotal, total_amount: total, is_training: params.is_training ?? false, is_draft: false, origin_user_id: userId };
  if (params.created_at) { orderPayload.created_at = params.created_at; orderPayload.updated_at = params.created_at; }
  const { data: orderData, error: orderErr } = await admin.rpc("fn_create_order_bypass", { order_data: orderPayload });
  if (orderErr) throw new Error(`createOrder: ${orderErr.message}`);
  const orderId = (orderData as Record<string,string>)?.id;
  if (!orderId) throw new Error("createOrder: no id returned");
  if (params.created_at) { await admin.from("orders").update({ created_at: params.created_at, updated_at: params.created_at }).eq("id", orderId); }
  const { error: itemsErr } = await admin.rpc("fn_create_order_items_bypass", { p_order_id: orderId, p_tenant_id: QA_TENANT, p_items: items });
  if (itemsErr) throw new Error(`createOrder items: ${itemsErr.message}`);
  if (params.correlation_id) { await admin.from("orders").update({ cancel_reason: `QA_CORRELATION:${params.correlation_id}` }).eq("id", orderId); }
  return { id: orderId, number: orderNumber };
}
async function recordPayment(admin: ReturnType<typeof createClient>, orderId: string, cashRegisterId: string, paymentMethodId: string, amount: number, change = 0) {
  const { error } = await admin.rpc("fn_record_payment_bypass", { p_order_id: orderId, p_tenant_id: QA_TENANT, p_cash_register_id: cashRegisterId, p_payment_method_id: paymentMethodId, p_amount: amount, p_change_amount: change });
  if (error) throw new Error(`recordPayment: ${error.message}`);
  const today = new Date().toISOString().split("T")[0];
  await admin.from("fin_cash_flow").insert({ tenant_id: QA_TENANT, type: "income", amount, description: `QA Venda pedido ${orderId.slice(0, 8)}`, category: "Vendas", origin: "auto_sale", reference_id: orderId, date: today }).catch(() => undefined);
}
async function cancelOrder(admin: ReturnType<typeof createClient>, orderId: string, userId: string, reason: string) {
  const { error } = await admin.rpc("fn_cancel_order_bypass", { p_order_id: orderId, p_user_id: userId, p_reason: reason });
  if (error) throw new Error(`cancelOrder: ${error.message}`);
}
async function advanceOrderStatus(admin: ReturnType<typeof createClient>, orderId: string, targetStatus: string) {
  const { data, error } = await admin.rpc("fn_advance_order_status_safe", { p_order_id: orderId, p_status: targetStatus });
  if (error) throw new Error(`advanceOrderStatus: ${error.message}`);
  const d = data as Record<string,unknown>;
  if (d && d.error) throw new Error(`advanceOrderStatus: ${d.message ?? String(data)}`);
}
function extractUserIdFromJWT(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.sub ?? null;
  } catch { return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  const userId = extractUserIdFromJWT(token);
  if (!userId) return new Response(JSON.stringify({ error: "Unauthorized: valid session required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    let body: Record<string,unknown> = {};
    try { body = await req.json(); } catch { body = {}; }
    const action = body.action ?? "run_full_simulation";

    if (action === "status") {
      const [orders, sessions, payments, cashFlow] = await Promise.all([
        admin.from("orders").select("id, number, status, origin_type, destination_type, total_amount, created_at, cancel_reason").eq("tenant_id", QA_TENANT).order("created_at", { ascending: false }),
        admin.from("sessions").select("id, status, opened_at, closed_at").eq("tenant_id", QA_TENANT).order("opened_at", { ascending: false }),
        admin.from("payments").select("id, order_id, amount, payment_method_id").eq("tenant_id", QA_TENANT),
        admin.from("fin_cash_flow").select("id, type, amount, description, date").eq("tenant_id", QA_TENANT).order("date", { ascending: false }),
      ]);
      return new Response(JSON.stringify({ tenant_id: QA_TENANT, orders: orders.data ?? [], sessions: sessions.data ?? [], payments: payments.data ?? [], cash_flow: cashFlow.data ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (action !== "run_full_simulation") return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: pms } = await admin.from("payment_methods").select("id, name").eq("tenant_id", QA_TENANT).is("deleted_at", null);
    const pmMap: Record<string, string> = {};
    for (const pm of (pms ?? []) as Record<string,string>[]) pmMap[pm.name] = pm.id;

    const PM_DINHEIRO = pmMap["QA-Dinheiro"];
    const PM_PIX = pmMap["QA-PIX"];
    const PM_CREDITO = pmMap["QA-Credito"];
    const PM_DEBITO = pmMap["QA-Debito"];
    const PM_VALE = pmMap["QA-Vale Refeicao"];

    const results: Record<string, unknown>[] = [];
    const errors: Record<string, unknown>[] = [];

    log("INFO", "Criando Sessao 1 - 7 dias atras");
    const s1OpenedAt = daysAgo(7, 10, 0);
    const s1ClosedAt = daysAgo(7, 16, 0);
    const s1Id = await createSession(admin, userId, s1OpenedAt);
    const cr1Id = await createCashRegister(admin, s1Id, userId, s1OpenedAt);

    try { const its = [buildItem(ITEMS.frango, 1, []), buildItem(ITEMS.coca, 2, [])]; const sub = 42.90 + 7.90 * 2; const o = await createOrder(admin, s1Id, userId, { origin: "cashier", destination: "immediate", items: its, created_at: daysAgo(7, 11, 15), correlation_id: "S1-P01" }); await recordPayment(admin, o.id, cr1Id, PM_DINHEIRO, sub, 0.30); await advanceOrderStatus(admin, o.id, "delivered"); results.push({ scenario: "S1-P01", order: o.number, status: "OK", total: sub }); } catch (e) { errors.push({ scenario: "S1-P01", error: String(e) }); }
    try { const its = [buildItem(ITEMS.picanha, 1, [OPTIONS.aoPontoCarne, OPTIONS.farofa]), buildItem(ITEMS.suco, 1, [OPTIONS.laranja])]; const sub = (89.90+5.00)+12.90; const o = await createOrder(admin, s1Id, userId, { origin: "waiter", destination: "table", table_number: 3, items: its, created_at: daysAgo(7, 12, 0), correlation_id: "S1-P02" }); await recordPayment(admin, o.id, cr1Id, PM_PIX, sub); await advanceOrderStatus(admin, o.id, "delivered"); results.push({ scenario: "S1-P02", order: o.number, status: "OK", total: sub }); } catch (e) { errors.push({ scenario: "S1-P02", error: String(e) }); }
    try { const its = [buildItem(ITEMS.hamburguer, 1, [OPTIONS.aoPontoBurger])]; const o = await createOrder(admin, s1Id, userId, { origin: "cashier", destination: "immediate", items: its, created_at: daysAgo(7, 12, 30), correlation_id: "S1-P03-CANCELADO" }); await cancelOrder(admin, o.id, userId, "QA_CORRELATION:S1-P03-CANCELADO"); results.push({ scenario: "S1-P03-CANCELADO", order: o.number, status: "OK-CANCELLED", total: 38.90 }); } catch (e) { errors.push({ scenario: "S1-P03-CANCELADO", error: String(e) }); }
    try { const its = [buildItem(ITEMS.picanha, 2, [OPTIONS.malPassadoCarne]), buildItem(ITEMS.fritas, 2, []), buildItem(ITEMS.suco, 2, [OPTIONS.acerola]), buildItem(ITEMS.gateau, 2, [])]; const sub = 89.90*2+18.90*2+12.90*2+28.90*2; const o = await createOrder(admin, s1Id, userId, { origin: "cashier", destination: "table", table_number: 7, items: its, created_at: daysAgo(7, 13, 0), correlation_id: "S1-P04-PICO" }); await recordPayment(admin, o.id, cr1Id, PM_CREDITO, sub); await advanceOrderStatus(admin, o.id, "delivered"); results.push({ scenario: "S1-P04-PICO", order: o.number, status: "OK", total: sub }); } catch (e) { errors.push({ scenario: "S1-P04-PICO", error: String(e) }); }
    try { const its = [buildItem(ITEMS.salmao, 1, []), buildItem(ITEMS.cerveja, 1, [])]; const sub = 74.90+19.90; const disc = 10; const tot = sub-disc; const o = await createOrder(admin, s1Id, userId, { origin: "cashier", destination: "name", destination_name: "QA-Cliente Ana", items: its, discount: disc, created_at: daysAgo(7, 14, 0), correlation_id: "S1-P05-DESCONTO" }); await recordPayment(admin, o.id, cr1Id, PM_DEBITO, tot); await advanceOrderStatus(admin, o.id, "delivered"); results.push({ scenario: "S1-P05-DESCONTO", order: o.number, status: "OK", total: tot }); } catch (e) { errors.push({ scenario: "S1-P05-DESCONTO", error: String(e) }); }
    try { const its = [buildItem(ITEMS.combo, 2, []), buildItem(ITEMS.coca, 2, [])]; const sub = 59.90*2+7.90*2; const sf = Math.round(sub*0.10*100)/100; const tot = sub+sf; const o = await createOrder(admin, s1Id, userId, { origin: "waiter", destination: "table", table_number: 5, items: its, service_fee: sf, created_at: daysAgo(7, 15, 0), correlation_id: "S1-P06-TAXA" }); await recordPayment(admin, o.id, cr1Id, PM_PIX, tot); await advanceOrderStatus(admin, o.id, "delivered"); results.push({ scenario: "S1-P06-TAXA", order: o.number, status: "OK", total: tot }); } catch (e) { errors.push({ scenario: "S1-P06-TAXA", error: String(e) }); }
    await closeSession(admin, s1Id, cr1Id, userId, s1ClosedAt);

    log("INFO", "Criando Sessao 2 - ontem jantar");
    const s2OpenedAt = daysAgo(1, 18, 0);
    const s2ClosedAt = daysAgo(1, 23, 30);
    const s2Id = await createSession(admin, userId, s2OpenedAt);
    const cr2Id = await createCashRegister(admin, s2Id, userId, s2OpenedAt);

    try { const its = [buildItem(ITEMS.hamburguer, 1, [OPTIONS.malPassadoBurger]), buildItem(ITEMS.fritas, 1, [])]; const sub = 38.90+18.90; const o = await createOrder(admin, s2Id, userId, { origin: "self_service", destination: "password", destination_name: "QA-Senha-42", items: its, created_at: daysAgo(1, 19, 0), correlation_id: "S2-P01-AUTOATEND" }); await recordPayment(admin, o.id, cr2Id, PM_PIX, sub); await advanceOrderStatus(admin, o.id, "delivered"); results.push({ scenario: "S2-P01-AUTOATEND", order: o.number, status: "OK", total: sub }); } catch (e) { errors.push({ scenario: "S2-P01-AUTOATEND", error: String(e) }); }
    try { const its = [buildItem(ITEMS.picanha, 1, [OPTIONS.bemPassadoCarne, OPTIONS.vinagrete]), buildItem(ITEMS.cerveja, 2, [])]; const sub = (89.90+4.00)+19.90*2; const o = await createOrder(admin, s2Id, userId, { origin: "cashier", destination: "immediate", items: its, created_at: daysAgo(1, 19, 30), correlation_id: "S2-P02-MULTIPAG" }); await recordPayment(admin, o.id, cr2Id, PM_DINHEIRO, 50, 0); await recordPayment(admin, o.id, cr2Id, PM_PIX, sub-50); await advanceOrderStatus(admin, o.id, "delivered"); results.push({ scenario: "S2-P02-MULTIPAG", order: o.number, status: "OK", total: sub }); } catch (e) { errors.push({ scenario: "S2-P02-MULTIPAG", error: String(e) }); }
    try { const its = [buildItem(ITEMS.frango, 1, [], "QA-OBS: Sem sal"), buildItem(ITEMS.suco, 1, [OPTIONS.laranja], "QA-OBS: Sem acucar")]; const sub = 42.90+12.90; const o = await createOrder(admin, s2Id, userId, { origin: "cashier", destination: "name", destination_name: "QA-Cliente Joao", items: its, created_at: daysAgo(1, 20, 0), correlation_id: "S2-P03-OBS" }); await recordPayment(admin, o.id, cr2Id, PM_VALE, sub); await advanceOrderStatus(admin, o.id, "delivered"); results.push({ scenario: "S2-P03-OBS", order: o.number, status: "OK", total: sub }); } catch (e) { errors.push({ scenario: "S2-P03-OBS", error: String(e) }); }
    const picoPromises = [];
    for (let i = 1; i <= 5; i++) { picoPromises.push((async (idx: number) => { try { const its = [buildItem(ITEMS.picanha, 1, [OPTIONS.aoPontoCarne]), buildItem(ITEMS.coca, 1, [])]; const sub = 89.90+7.90; const o = await createOrder(admin, s2Id, userId, { origin: idx%2===0?"waiter":"cashier", destination: "table", table_number: idx, items: its, created_at: daysAgo(1, 20, 30+idx), correlation_id: `S2-PICO-${idx}` }); await recordPayment(admin, o.id, cr2Id, idx%2===0?PM_PIX:PM_DEBITO, sub); await advanceOrderStatus(admin, o.id, "delivered"); results.push({ scenario: `S2-PICO-${idx}`, order: o.number, status: "OK", total: sub }); } catch (e) { errors.push({ scenario: `S2-PICO-${idx}`, error: String(e) }); } })(i)); }
    await Promise.all(picoPromises);
    try { const its = [buildItem(ITEMS.gateau, 1, []), buildItem(ITEMS.pudim, 1, [])]; const o = await createOrder(admin, s2Id, userId, { origin: "cashier", destination: "immediate", items: its, created_at: daysAgo(1, 21, 0), correlation_id: "S2-P05-ITEM-CANCEL" }); await recordPayment(admin, o.id, cr2Id, PM_DINHEIRO, 16.90, 0.10); await advanceOrderStatus(admin, o.id, "delivered"); results.push({ scenario: "S2-P05-ITEM-CANCEL", order: o.number, status: "OK", total: 16.90 }); } catch (e) { errors.push({ scenario: "S2-P05-ITEM-CANCEL", error: String(e) }); }
    try { await admin.rpc("fn_create_cash_movement_bypass", { movement_data: { cash_register_id: cr2Id, tenant_id: QA_TENANT, type: "out", amount: 100, reason: "QA-Sangria: Retirada para cofre", operator_id: userId } }); results.push({ scenario: "S2-SANGRIA", status: "OK", amount: 100 }); } catch (e) { errors.push({ scenario: "S2-SANGRIA", error: String(e) }); }
    await closeSession(admin, s2Id, cr2Id, userId, s2ClosedAt);

    log("INFO", "Criando Sessao 3 - hoje (ativa)");
    const s3OpenedAt = daysAgo(0, 9, 0);
    const s3Id = await createSession(admin, userId, s3OpenedAt);
    const cr3Id = await createCashRegister(admin, s3Id, userId, s3OpenedAt);

    try { const its = [buildItem(ITEMS.picanha, 1, [OPTIONS.aoPontoCarne]), buildItem(ITEMS.suco, 1, [OPTIONS.laranja])]; const sub = 89.90+12.90; const o = await createOrder(admin, s3Id, userId, { origin: "table", destination: "table", table_number: 2, items: its, created_at: daysAgo(0, 11, 0), correlation_id: "S3-P01-MESA-QR" }); await advanceOrderStatus(admin, o.id, "preparing"); results.push({ scenario: "S3-P01-MESA-QR", order: o.number, status: "OK-PREPARING", total: sub }); } catch (e) { errors.push({ scenario: "S3-P01-MESA-QR", error: String(e) }); }
    try { const its = [buildItem(ITEMS.frango, 1, []), buildItem(ITEMS.fritas, 1, [])]; const sub = 42.90+18.90; const o = await createOrder(admin, s3Id, userId, { origin: "cashier", destination: "immediate", items: its, created_at: daysAgo(0, 11, 30), correlation_id: "S3-P02-PRONTO" }); await advanceOrderStatus(admin, o.id, "ready"); results.push({ scenario: "S3-P02-PRONTO", order: o.number, status: "OK-READY", total: sub }); } catch (e) { errors.push({ scenario: "S3-P02-PRONTO", error: String(e) }); }
    try { const its = [buildItem(ITEMS.combo, 1, []), buildItem(ITEMS.coca, 1, [])]; const sub = 59.90+7.90; const o = await createOrder(admin, s3Id, userId, { origin: "cashier", destination: "name", destination_name: "QA-Cliente Maria", items: its, created_at: daysAgo(0, 12, 0), correlation_id: "S3-P03-HOJE" }); await recordPayment(admin, o.id, cr3Id, PM_PIX, sub); await advanceOrderStatus(admin, o.id, "delivered"); results.push({ scenario: "S3-P03-HOJE", order: o.number, status: "OK", total: sub }); } catch (e) { errors.push({ scenario: "S3-P03-HOJE", error: String(e) }); }
    try { const its = [buildItem(ITEMS.salmao, 1, [])]; const o = await createOrder(admin, s3Id, userId, { origin: "cashier", destination: "immediate", items: its, created_at: daysAgo(0, 12, 30), correlation_id: "S3-P04-CANCEL-HOJE" }); await cancelOrder(admin, o.id, userId, "Cliente desistiu"); results.push({ scenario: "S3-P04-CANCEL-HOJE", order: o.number, status: "OK-CANCELLED", total: 74.90 }); } catch (e) { errors.push({ scenario: "S3-P04-CANCEL-HOJE", error: String(e) }); }
    try { const its = [buildItem(ITEMS.picanha, 2, [OPTIONS.malPassadoCarne, OPTIONS.farofa]), buildItem(ITEMS.bolinho, 1, []), buildItem(ITEMS.cerveja, 2, []), buildItem(ITEMS.gateau, 2, [])]; const sub = (89.90+5.00)*2+24.90+19.90*2+28.90*2; const disc = 20; const sf = Math.round((sub-disc)*0.10*100)/100; const tot = sub-disc+sf; const o = await createOrder(admin, s3Id, userId, { origin: "waiter", destination: "table", table_number: 7, items: its, discount: disc, service_fee: sf, created_at: daysAgo(0, 13, 0), correlation_id: "S3-P05-COMPLEXO" }); await recordPayment(admin, o.id, cr3Id, PM_CREDITO, Math.round(tot*0.6*100)/100); await recordPayment(admin, o.id, cr3Id, PM_PIX, Math.round(tot*0.4*100)/100); await advanceOrderStatus(admin, o.id, "delivered"); results.push({ scenario: "S3-P05-COMPLEXO", order: o.number, status: "OK", total: tot }); } catch (e) { errors.push({ scenario: "S3-P05-COMPLEXO", error: String(e) }); }
    try { await admin.rpc("fn_create_cash_movement_bypass", { movement_data: { cash_register_id: cr3Id, tenant_id: QA_TENANT, type: "in", amount: 50, reason: "QA-Suprimento: Troco adicional", operator_id: userId } }); results.push({ scenario: "S3-SUPRIMENTO", status: "OK", amount: 50 }); } catch (e) { errors.push({ scenario: "S3-SUPRIMENTO", error: String(e) }); }

    log("INFO", "Criando Sessao 4 - mes anterior");
    const s4OpenedAt = daysAgo(30, 11, 0);
    const s4ClosedAt = daysAgo(30, 22, 0);
    const s4Id = await createSession(admin, userId, s4OpenedAt);
    const cr4Id = await createCashRegister(admin, s4Id, userId, s4OpenedAt);
    const mesAnt = [
      { item: ITEMS.picanha, opt: OPTIONS.aoPontoCarne, pm: PM_PIX, origin: "cashier", dest: "immediate", day: 30, hour: 12 },
      { item: ITEMS.salmao, opt: OPTIONS.aoPontoCarne, pm: PM_CREDITO, origin: "waiter", dest: "table", table: 4, day: 30, hour: 13 },
      { item: ITEMS.combo, opt: OPTIONS.aoPontoCarne, pm: PM_DEBITO, origin: "self_service", dest: "password", name: "QA-Senha-99", day: 30, hour: 14 },
      { item: ITEMS.frango, opt: OPTIONS.aoPontoCarne, pm: PM_DINHEIRO, origin: "cashier", dest: "immediate", day: 30, hour: 19 },
      { item: ITEMS.hamburguer, opt: OPTIONS.malPassadoBurger, pm: PM_PIX, origin: "cashier", dest: "immediate", day: 30, hour: 20 },
    ];
    for (let i = 0; i < mesAnt.length; i++) {
      const c = mesAnt[i];
      try {
        const its = [buildItem(c.item, 1, [c.opt]), buildItem(ITEMS.coca, 1, [])];
        const sub = c.item.price + 7.90;
        const o = await createOrder(admin, s4Id, userId, { origin: c.origin, destination: c.dest, destination_name: (c as Record<string,unknown>).name as string|undefined, table_number: (c as Record<string,unknown>).table as number|undefined, items: its, created_at: daysAgo(c.day, c.hour, 0), correlation_id: `S4-MES-ANT-${i+1}` });
        await recordPayment(admin, o.id, cr4Id, c.pm, sub);
        await advanceOrderStatus(admin, o.id, "delivered");
        results.push({ scenario: `S4-MES-ANT-${i+1}`, order: o.number, status: "OK", total: sub });
      } catch (e) { errors.push({ scenario: `S4-MES-ANT-${i+1}`, error: String(e) }); }
    }
    await closeSession(admin, s4Id, cr4Id, userId, s4ClosedAt);

    const { data: ordersTotal } = await admin.from("orders").select("total_amount, status").eq("tenant_id", QA_TENANT).neq("status", "cancelled").neq("is_training", true);
    const { data: paymentsTotal } = await admin.from("payments").select("amount").eq("tenant_id", QA_TENANT);
    const { data: cashFlowTotal } = await admin.from("fin_cash_flow").select("amount, type").eq("tenant_id", QA_TENANT).eq("origin", "auto_sale");
    const sumOrders = ((ordersTotal ?? []) as Record<string,string>[]).reduce((s, o) => s + parseFloat(o.total_amount), 0);
    const sumPayments = ((paymentsTotal ?? []) as Record<string,string>[]).reduce((s, p) => s + parseFloat(p.amount), 0);
    const sumCashFlow = ((cashFlowTotal ?? []) as Record<string,string>[]).reduce((s, f) => s + parseFloat(f.amount), 0);
    const validation = { sum_orders_non_cancelled: Math.round(sumOrders*100)/100, sum_payments: Math.round(sumPayments*100)/100, sum_cash_flow_sales: Math.round(sumCashFlow*100)/100 };
    log("INFO", "Simulacao concluida", { results_count: results.length, errors_count: errors.length });
    return new Response(JSON.stringify({ ok: true, tenant_id: QA_TENANT, sessions: { s1: s1Id, s2: s2Id, s3: s3Id, s4: s4Id }, results, errors, validation, summary: { total_scenarios: results.length+errors.length, passed: results.length, failed: errors.length, active_session: s3Id, active_cash_register: cr3Id } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    log("ERROR", "Unhandled exception", { error: String(err) });
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
