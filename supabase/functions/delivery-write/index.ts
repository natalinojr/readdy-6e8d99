
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { deductStockForSkipKdsItems, runStockInBackground } from "../_shared/stock.ts";
import { descontoClubeServidor, idsValidos, sessaoDoClube, vincularClube } from "../_shared/clube-servidor.ts";
import { activeLocales, normalizeLocale, loadTranslations, decorate, decorateHighlights, translationsPayload } from "../_shared/menu-i18n.ts";
import { promoPrecosDeHoje } from "../_shared/promo-item.ts";
import { combosIndisponiveis, idsPausados } from "../_shared/cardapio-pausa.ts";
import { dentroDoHorario, minutosAteFechar, normalizarHorarioDelivery, type HorarioDelivery } from "../_shared/horario-delivery.ts";
import { temPermissao } from "../_shared/permissao-servidor.ts";

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
// Apps de fora (mesma lista de `externo` em src/constants/delivery.ts): a entrega e do app.
const PLATAFORMAS_EXTERNAS = new Set(["ifood", "rappi", "uber_eats", "99food"]);

// ── Estado de abertura do delivery (sessao + pausa + agendamento + manual) ─────
// Fonte da verdade do "delivery aberto agora". Combina:
//  - sessao de caixa aberta  -> master gate (sem sessao, delivery SEMPRE fechado)
//  - delivery_paused_until    -> pausa temporaria (fecha mesmo dentro do horario)
//  - delivery_schedule        -> agendamento por dia da semana (fuso America/Sao_Paulo)
//  - delivery_manual_open     -> override pra abrir FORA do horario / quando nao ha agenda
// Regra: dentro do horario + sessao aberta abre sozinho ("forca abertura"); fechar
// dentro do horario vira pausa ate o fim da janela (ver set_delivery_state op 'close').
// Horario (varios horarios no dia + datas especiais, 2026-10-04): regra unica em _shared/horario-delivery.ts.
type DeliverySchedule = HorarioDelivery;
const isWithinSchedule = (schedule: DeliverySchedule | null | undefined, now: Date) => dentroDoHorario(schedule, now);
const minutesUntilWindowClose = (schedule: DeliverySchedule | null | undefined, now: Date) => minutosAteFechar(schedule, now);

// "Dia corrido" (2026-10-04): minutos a mais no prazo prometido, so enquanto a mesma sessao de caixa
// estiver aberta (fechou o caixa = volta ao normal sozinho). delivery_config.prazo_extra = { min, session_id }.
function prazoExtraMin(dc: Record<string, any> | null | undefined, openSessionId: string | null | undefined): number {
  const pe = dc?.prazo_extra;
  if (!pe || typeof pe !== "object" || !openSessionId || pe.session_id !== openSessionId) return 0;
  const m = Math.round(Number(pe.min) || 0);
  return m > 0 && m <= 120 ? m : 0;
}

// Entrega gratis acima de um valor (2026-10-04, comeca desligada). Base = soma dos itens (sem a taxa,
// antes de cupom), a mesma do pedido minimo. ate_km opcional (0/null = qualquer distancia da area).
// `km` aqui e a ESTIMATIVA do app (linha reta x ROAD_FACTOR), nao a rota do ORS: o cliente viu "Gratis" por
// essa conta, entao o limite de km precisa usar a mesma (senao a tela diz gratis e o servidor cobra).
function freteGratis(dc: Record<string, any> | null | undefined, subtotal: number, km: number | null): boolean {
  const fg = dc?.frete_gratis;
  if (!fg || typeof fg !== "object" || fg.ativo !== true) return false;
  const acima = Number(fg.acima_de) || 0;
  if (acima <= 0 || subtotal + 0.005 < acima) return false;
  const ateKm = Number(fg.ate_km) || 0;
  if (ateKm > 0 && (km == null || km > ateKm)) return false;
  return true;
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
const MAX_ORDERS_PER_PHONE = 5;
// Sem limite por IP: o antigo era um Map em memória, por isolate — com várias instâncias da
// Edge ele não segurava nada (e dava falsa sensação de proteção). Removido no go-live (09-17).
// A trava real é a do telefone (MAX_ORDERS_PER_PHONE), contada em `orders` no banco.

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

// ── Saídas do pedido de delivery: tickets (cozinha/bar), comprovante e WhatsApp ──
// Extraído do create_delivery_order para ser reutilizado por `release_held_order`:
// pedido pago por "PIX pelo app" nasce como RASCUNHO (não vai pra cozinha) e só
// dispara tudo isso quando o online-payments confirma o Pix.
type DeliveryOutputCtx = {
  tenant_id: string; orderId: string; orderNumber: string;
  serverItems: Array<Record<string, unknown>>;
  customer_name: string | null; customer_address: string | null; customer_phone: string;
  cleanPhone: string; isRetirada: boolean;
  routeKm: number | null; routeTempoMax: number | null;
  serverDeliveryFee: number; serverSubtotal: number; voucherDiscount: number; vCode: string | null;
  serverTotal: number; payment_method: string | null; isDinheiro: boolean; cash_amount: number | null;
  // Pedido do iFood: a loja escolhe se imprime (ifood_pdv_config.order_print_*). Sem o campo = imprime.
  printKitchen?: boolean; printReceipt?: boolean;
};
// deno-lint-ignore no-explicit-any
async function emitDeliveryOutputs(admin: any, ctx: DeliveryOutputCtx) {
  const { tenant_id, orderId, orderNumber, serverItems, customer_name, customer_address, customer_phone, cleanPhone, isRetirada, routeKm, routeTempoMax, serverDeliveryFee, serverSubtotal, voucherDiscount, vCode, serverTotal, payment_method, isDinheiro, cash_amount } = ctx;
  const printKitchen = ctx.printKitchen !== false;
  const printReceipt = ctx.printReceipt !== false;
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

      // Itens de preparo agrupam pela station_id (fallback "cozinha-padrao"); itens "sem
      // preparo" (skip_kds: bebidas, sobremesas prontas) pela station_id real (fallback "bar").
      // Cozinha + bar da MESMA estação viram UM ticket só — igual src/lib/printOrderQueue.ts.
      // Antes eram 2 enqueue_print_ticket com a mesma (order_id, station_key) e a dedup da RPC
      // descartava o 2º: a bebida sumia do ticket (simulação de pico, 2026-09-17).
      const stationGroups = new Map<string, Array<Record<string, unknown>>>();
      const barGroups = new Map<string, Array<Record<string, unknown>>>();
      for (const item of serverItems) {
        if (item.skip_kds) {
          const key = (item.station_id as string) || "bar";
          if (!barGroups.has(key)) barGroups.set(key, []);
          barGroups.get(key)!.push(item);
        } else {
          const key = (item.station_id as string) || "cozinha-padrao";
          if (!stationGroups.has(key)) stationGroups.set(key, []);
          stationGroups.get(key)!.push(item);
        }
      }
      const allStationKeys = new Set<string>([...stationGroups.keys(), ...barGroups.keys()]);

      // Nome da estação (kitchen_stations.name) para o rótulo/cabeçalho do ticket — como
      // o printOrderQueue das outras origens faz; antes ia o UUID da estação.
      const stationNames = new Map<string, string>();
      const stationIds = [...allStationKeys].filter((k) => k !== "cozinha-padrao" && k !== "bar");
      if (stationIds.length > 0) {
        try {
          const { data: ksRows } = await admin
            .from("kitchen_stations")
            .select("id, name")
            .eq("tenant_id", tenant_id)
            .in("id", stationIds);
          for (const ks of (ksRows || []) as Array<{ id: string; name: string | null }>) {
            if (ks.id && ks.name) stationNames.set(ks.id, ks.name);
          }
        } catch { /* sem nome: cai no rótulo genérico */ }
      }

      if (printKitchen) for (const stationKey of allStationKeys) {
        const kitchenItems = stationGroups.get(stationKey) ?? [];
        const barItems = barGroups.get(stationKey) ?? [];
        const hasBar = barItems.length > 0;
        const hasKitchen = kitchenItems.length > 0;
        const estacaoNome = stationNames.get(stationKey) || "";
        // Rótulo: nome da estação quando existe; senão "Bar" (só bar) ou "Cozinha".
        const label = estacaoNome || (hasBar && !hasKitchen ? "Bar" : "Cozinha");
        try {
          await admin.rpc("enqueue_print_ticket", {
            p_tenant_id: tenant_id, p_order_id: orderId, p_order_number: orderNumber,
            p_station_key: stationKey, p_station_label: label,
            p_content_type: "ticket_json",
            p_payload: {
              numero: ticketNum, destino: customer_name + " - " + (isRetirada ? "Retirada" : customer_address),
              origem: isRetirada ? "retirada" : "delivery",
              ...(estacaoNome ? { estacao: estacaoNome } : {}),
              impressora_id: stationKey,
              itens: buildTicketItems([...kitchenItems, ...barItems]),
              data_hora: dataHora,
            },
            p_paper_style: "80mm",
          });
        } catch { /* non-blocking */ }
      }

      if (printReceipt) try {
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

      // Sem telefone (ex.: pedido do iFood, cliente mascarado) não há para quem mandar.
      if (cleanPhone || customer_phone) await notifyDeliveryOrderCreated({
        tenant_id,
        order_id: orderId,
        order_number: orderNumber,
        customer_name: customer_name || "Cliente",
        customer_phone: cleanPhone || String(customer_phone || ""),
        total_amount: serverTotal,
      });
}

// ── Libera um pedido "segurado" (Pix pelo app) ───────────────────────────────
// Vira status 'new' (aparece no KDS/gestor), opcionalmente grava as notas novas
// (troca de forma de pagamento) e dispara as saídas presas: tickets, comprovante,
// WhatsApp. Idempotente: pedido que já saiu do rascunho volta `already`.
// deno-lint-ignore no-explicit-any
async function releaseHeldOrder(admin: any, tenant_id: string, order_id: string, paymentLabel: string, newNotes: string | null, cashAmount: number | null = null): Promise<{ error?: string; code?: number; already?: boolean }> {
  const { data: o } = await admin.from("orders")
    .select("id, number, status, is_draft, origin_type, destination_name, destination_phone, delivery_address, delivery_platform, delivery_fee, subtotal, discount_amount, total_amount, notes, delivery_distance_km, delivery_sla_min, ifood_order_id")
    .eq("id", order_id).eq("tenant_id", tenant_id).maybeSingle();
  if (!o) return { error: "Pedido não encontrado", code: 404 };
  if (o.origin_type !== "delivery") return { error: "Não é pedido de delivery", code: 400 };
  if (o.status !== "draft" && !o.is_draft) return { already: true };

  const upd: Record<string, unknown> = { status: "new", is_draft: false, updated_at: new Date().toISOString() };
  if (newNotes != null) upd.notes = newNotes;
  // Só quem tirou do rascunho segue (dois chamados ao mesmo tempo não imprimem nem baixam em dobro).
  const { data: liberou, error: upErr } = await admin.from("orders").update(upd).eq("id", order_id).eq("is_draft", true).select("id");
  if (upErr) throw upErr;
  if (!liberou?.length) return { already: true };
  // Saiu do rascunho = pedido real: itens sem preparo (skip_kds) baixam o estoque agora.
  runStockInBackground(deductStockForSkipKdsItems(admin, tenant_id, order_id).catch((e) => console.warn("[delivery-write] baixa de estoque falhou", order_id, String(e))));

  const { data: items } = await admin.from("order_items").select("id, item_name, item_price, quantity, notes, skip_kds, station_id, status").eq("order_id", order_id).neq("status", "cancelled");
  const itemIds = ((items ?? []) as Record<string, unknown>[]).map((it) => it.id as string);
  const [{ data: optRows }, { data: obsRows }] = await Promise.all([
    itemIds.length ? admin.from("order_item_options").select("order_item_id, option_name, group_name, additional_price").in("order_item_id", itemIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    itemIds.length ? admin.from("order_item_observations").select("order_item_id, text").in("order_item_id", itemIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const serverItems = ((items ?? []) as Record<string, unknown>[]).map((it) => ({
    item_name: it.item_name, item_price: Number(it.item_price ?? 0), quantity: Number(it.quantity ?? 1),
    notes: it.notes ?? null, skip_kds: !!it.skip_kds, station_id: it.station_id ?? null,
    options: ((optRows ?? []) as Record<string, unknown>[]).filter((r) => r.order_item_id === it.id).map((r) => ({ option_name: r.option_name, group_name: r.group_name, additional_price: Number(r.additional_price ?? 0) })),
    observations: ((obsRows ?? []) as Record<string, unknown>[]).filter((r) => r.order_item_id === it.id).map((r) => ({ text: r.text, is_checked: false })),
  }));
  const isRetirada = o.delivery_platform === "retirada";
  const customer_name = String(o.destination_name ?? "").split(/\s+[-–—]\s+/)[0].trim() || "Cliente";
  const notesTxt = String(newNotes ?? o.notes ?? "");
  const trocoMatch = cashAmount == null ? notesTxt.match(/Troco para\s*R\$\s*([\d.,]+)/i) : null;
  // Pedido do iFood (funil): imprime cozinha/comprovante só se a loja deixou ligado na configuração do iFood.
  let printKitchen = true, printReceipt = true;
  if (o.ifood_order_id) {
    const { data: ic } = await admin.from("ifood_pdv_config").select("order_print_kitchen, order_print_receipt").eq("tenant_id", tenant_id).maybeSingle();
    printKitchen = ic?.order_print_kitchen !== false;
    printReceipt = ic?.order_print_receipt !== false;
  }
  await emitDeliveryOutputs(admin, {
    printKitchen, printReceipt,
    tenant_id, orderId: o.id as string, orderNumber: o.number as string, serverItems,
    customer_name, customer_address: (o.delivery_address as string | null) ?? null, customer_phone: String(o.destination_phone ?? ""),
    cleanPhone: String(o.destination_phone ?? "").replace(/\D/g, ""), isRetirada,
    routeKm: o.delivery_distance_km != null ? Number(o.delivery_distance_km) : null,
    routeTempoMax: o.delivery_sla_min != null ? Number(o.delivery_sla_min) : null,
    serverDeliveryFee: Number(o.delivery_fee ?? 0), serverSubtotal: Number(o.subtotal ?? 0),
    voucherDiscount: Number(o.discount_amount ?? 0), vCode: null, serverTotal: Number(o.total_amount ?? 0),
    payment_method: paymentLabel, isDinheiro: /dinheiro/i.test(paymentLabel),
    cash_amount: cashAmount ?? (trocoMatch ? Number(trocoMatch[1].replace(".", "").replace(",", ".")) : null),
  });
  return {};
}

// "Montar saída": quanto a cozinha leva no DELIVERY desta loja (mediana dos últimos 30 dias). Itens do salão
// ficam de fora: lá o "iniciar" e o "pronto" costumam ser marcados juntos (mediana ~0 min em 10/2026).
// Pouco histórico (< 5 pedidos) = tempo padrão. Guardado 10 min por loja (o quadro recarrega a cada mudança).
const PREPARO_PADRAO = { prepMin: 20, totalMin: 30 };
const preparoCache = new Map<string, { at: number; v: { prepMin: number; totalMin: number; base: "historico" | "padrao" } }>();
async function tempoPreparoDelivery(admin: any, tenantId: string) {
  const c = preparoCache.get(tenantId);
  if (c && Date.now() - c.at < 10 * 60000) return c.v;
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data } = await admin.from("order_items")
    .select("order_id, started_preparing_at, ready_at, skip_kds, orders!inner(origin_type, created_at)")
    .eq("tenant_id", tenantId).eq("orders.origin_type", "delivery").gte("created_at", desde).limit(3000);
  const porPedido = new Map<string, { criado: number; prep: number | null; pronto: number; todos: boolean }>();
  for (const i of (data ?? []) as Record<string, any>[]) {
    if (i.skip_kds) continue;
    const ped = Array.isArray(i.orders) ? i.orders[0] : i.orders;
    const p = porPedido.get(i.order_id) ?? { criado: new Date(ped?.created_at).getTime(), prep: null, pronto: 0, todos: true };
    if (i.started_preparing_at) { const t = new Date(i.started_preparing_at).getTime(); p.prep = p.prep == null ? t : Math.min(p.prep, t); }
    if (i.ready_at) p.pronto = Math.max(p.pronto, new Date(i.ready_at).getTime()); else p.todos = false;
    porPedido.set(i.order_id, p);
  }
  const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const ok = [...porPedido.values()].filter((p) => p.todos && p.pronto > p.criado);
  const totais = ok.map((p) => (p.pronto - p.criado) / 60000).filter((m) => m <= 120);
  const preps = ok.filter((p) => p.prep != null && p.pronto >= p.prep!).map((p) => (p.pronto - p.prep!) / 60000).filter((m) => m <= 120);
  const v = totais.length >= 5
    ? { prepMin: Math.max(3, Math.round(preps.length >= 5 ? mediana(preps) : mediana(totais) * 0.7)), totalMin: Math.max(5, Math.round(mediana(totais))), base: "historico" as const }
    : { ...PREPARO_PADRAO, base: "padrao" as const };
  preparoCache.set(tenantId, { at: Date.now(), v });
  return v;
}

Deno.serve({ verify_jwt: false }, async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const keyToUse = serviceRoleKey && serviceRoleKey.length >= 40 ? serviceRoleKey : anonKey;
  const admin = createClient(supabaseUrl, keyToUse, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const body = await req.json();
    const { action } = body;
    const startTime = Date.now();
    if (!action) return jsonErr("action is required", 400);

    // Troca de idioma no meio da navegacao: devolve SO as traducoes, o front
    // mescla no cardapio que ja esta na tela. Recarregar o cardapio inteiro
    // zeraria carrinho e etapa do checkout.
    if (action === "get_menu_translations") {
      const t = String(body.tenant_id ?? "").trim();
      if (!t) return jsonErr("tenant_id e obrigatorio.");
      const payload = await translationsPayload(admin, t, body.locale);
      return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
          else return new Response(JSON.stringify({ _v: "v14", error: "store_inactive", message: "Esta loja está temporariamente indisponível." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
      if (!tenantId) return new Response(JSON.stringify({ _v: "v14", error: "delivery_not_configured", message: "Delivery não configurado." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const [settingsResult, nbRows, tenantResult, catResult, itemResult, ogResult, optResult, obsResult, estoqueResult, opcoesEstoqueResult, partesResult, highlightsResult, promotionsResult, deletedCatsResult] = await Promise.all([
        admin.from("system_settings").select("delivery_city, delivery_config").eq("tenant_id", tenantId).maybeSingle(),
        admin.rpc("fn_delivery_get_config", { p_tenant_id: tenantId }),
        admin.from("tenants").select("id, name").eq("id", tenantId).maybeSingle(),
        // availability_schedule = horário de exibição; o front filtra pelo relógio de Brasília (lib/horarioExibicao).
        admin.from("menu_categories").select("id, name, station_id, availability_schedule").eq("tenant_id", tenantId).eq("is_active", true).is("deleted_at", null).order("sort_order", { ascending: true }),
        admin.from("menu_items").select("id, name, description, price, photo_url, category_id, sla_minutes, is_active, skip_kds, delivery_config, availability_schedule").eq("tenant_id", tenantId).eq("is_active", true).is("deleted_at", null),
        admin.from("option_groups").select("id, name, item_id, is_required, min_selections, max_selections").eq("tenant_id", tenantId).is("deleted_at", null),
        // deleted_at: opcao apagada NAO pode aparecer pro cliente. Faltava esse
        // filtro (itens, categorias e grupos ja tinham) e 41 opcoes apagadas
        // seguiam pedidas no cardapio da Paranagua. As buscas por id logo abaixo
        // continuam sem o filtro de proposito: pedido antigo precisa resolver o
        // nome de uma opcao que ja foi apagada.
        admin.from("options").select("id, group_id, name, additional_price, is_active").eq("tenant_id", tenantId).eq("is_active", true).is("deleted_at", null).order("sort_order", { ascending: true }),
        admin.from("item_preset_observations").select("id, item_id, text").eq("tenant_id", tenantId).is("deleted_at", null),
        admin.rpc("fn_get_items_sem_estoque", { p_tenant_id: tenantId }),
        admin.rpc("fn_get_opcoes_sem_estoque", { p_tenant_id: tenantId }),
        admin.from("item_production_parts").select("item_id, name, station_id").eq("tenant_id", tenantId).is("deleted_at", null).order("sort_order"),
        // Destaques do DELIVERY: canal 'ambos' ou 'delivery' (exclui os 'só casa').
        admin.from("menu_highlights").select("id, item_id, custom_price, custom_description, sort_order, availability_schedule").eq("tenant_id", tenantId).eq("is_active", true).neq("channel", "casa").order("sort_order", { ascending: true }),
        admin.from("item_promotions").select("id, item_id, promotional_price, days_of_week, is_recurring, specific_date, is_active").eq("tenant_id", tenantId).eq("is_active", true).is("deleted_at", null),
        // Categorias APAGADAS (soft delete): seus itens somem do cardapio (mesma regra do fn_get_full_menu).
        admin.from("menu_categories").select("id").eq("tenant_id", tenantId).not("deleted_at", "is", null),
      ]);
      if (deletedCatsResult.error) throw deletedCatsResult.error;
      const deletedCatIds = new Set(((deletedCatsResult.data ?? []) as Array<{ id: string }>).map((c) => c.id));

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
      // "Acabou hoje" (menu_items.pausado_ate > agora): some do delivery (e do atendente do WhatsApp) até a loja abrir.
      const pausados = await idsPausados(admin, tenantId);
      const filteredItems = ((itemResult.data ?? []) as Array<Record<string, unknown>>).filter((item: Record<string, unknown>) => {
        const dc = item.delivery_config as Record<string, unknown> | null;
        if (item.category_id && deletedCatIds.has(item.category_id as string)) return false;
        if (pausados.has(String(item.id))) return false;
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
        if (item) highlights.push({ id: h.id, item_id: h.item_id, custom_price: h.custom_price, custom_description: h.custom_description, sort_order: h.sort_order, availability_schedule: h.availability_schedule ?? null, item_name: item.name, item_price: item.price, item_photo_url: item.photo_url, item_description: item.description, item_category_id: item.category_id, item_station_id: item.station_id, item_skip_kids: item.skip_kds, item_sla_minutes: item.sla_minutes });
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
      const { data: openSessForCfg } = await admin.from("sessions").select("id").eq("tenant_id", tenantId).eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle();
      const deliveryStateCfg = computeDeliveryOpen(settingsData.delivery_config as Record<string, any> | null, !!openSessForCfg, new Date());
      const prazoExtraCfg = prazoExtraMin(settingsData.delivery_config as Record<string, any> | null, openSessForCfg?.id);

      // Idioma do cliente: acrescenta `*_i18n` sem tocar no texto em portugues.
      // O pedido segue saindo em PT (ver comentario em _shared/menu-i18n.ts).
      const dlvLocales = await activeLocales(admin, tenantId);
      const dlvLocale = normalizeLocale(body.locale, dlvLocales);
      const dlvTrans = dlvLocale ? await loadTranslations(admin, tenantId, dlvLocale) : new Map();

      return new Response(JSON.stringify({ _v: "v15", tenant: tenantResult.data, city: settingsData.delivery_city, delivery_config: settingsData.delivery_config ?? {}, delivery_open_now: deliveryStateCfg.open, delivery_closed_reason: deliveryStateCfg.open ? null : deliveryStateCfg.reason, prazo_extra_min: prazoExtraCfg, neighborhoods, categories: decorate(catResult.data ?? [], "category", dlvTrans), items: decorate(items, "item", dlvTrans), option_groups: decorate(ogResult.data ?? [], "option_group", dlvTrans), options: decorate(options, "option", dlvTrans), observations: decorate(obsResult.data ?? [], "preset_obs", dlvTrans, "text", "text_desc"), out_of_stock_ids: outOfStockIds, opcoes_indisponiveis_ids: opcoesIndisponiveisIds, production_parts: Object.fromEntries(productionPartsMap), highlights: decorateHighlights(highlights, dlvTrans), promotions, locales: dlvLocales, locale: dlvLocale ?? "pt-BR" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "lookup_customer") {
      const { phone, tenant_id } = body;
      if (!phone || !tenant_id) return jsonErr("phone and tenant_id are required", 400);
      const cleanPhone = String(phone).replace(/\D/g, "");
      const { data: rows, error } = await admin.rpc("fn_delivery_lookup_customer", { p_tenant_id: tenant_id, p_phone: cleanPhone });
      if (error) throw error;
      const row = (rows && rows.length > 0) ? rows[0] : null;
      const customer = row ? { id: row.id, phone: row.phone, name: row.name, neighborhood_id: row.neighborhood_id, street: row.street, number: row.number, complement: row.complement, reference_point: row.reference_point, last_used_at: row.last_used_at, birth_date: null as string | null, gender: null as string | null, aceita_ofertas: false, delivery_neighborhoods: row.neighborhood_id ? { id: row.neighborhood_id, name: row.neighborhood_name, delivery_fee: row.neighborhood_delivery_fee } : null } : null;
      // Anexa nascimento/gênero salvos no cadastro de clientes (aba Clientes) p/ pré-preencher.
      if (customer) {
        const { data: custRow } = await admin.from("customers").select("birth_date, gender, accepts_marketing, crm_opt_out_at").eq("tenant_id", tenant_id).eq("phone", cleanPhone).limit(1).maybeSingle();
        if (custRow) {
          customer.birth_date = custRow.birth_date ?? null; customer.gender = custRow.gender ?? null;
          // Já aceitou ofertas pelo WhatsApp (e não pediu para sair): o checkout não pergunta de novo.
          customer.aceita_ofertas = custRow.accepts_marketing === true && !custRow.crm_opt_out_at;
        }
      }
      // "Entrou no cardapio": marca a visita no cadastro. NAO mexe em last_used_at
      // (esse e o ultimo uso em PEDIDO e ordena a busca do caixa).
      if (customer) {
        await admin.from("delivery_customers").update({ last_seen_at: new Date().toISOString() }).eq("id", customer.id).eq("tenant_id", tenant_id);
      }
      let addresses: Array<Record<string, unknown>> = [];
      if (customer) { const { data: addrRows } = await admin.from("delivery_customer_addresses").select("id, label, neighborhood_id, street, number, complement, reference_point, is_default, lat, lng, bairro").eq("customer_id", customer.id).eq("tenant_id", tenant_id).order("is_default", { ascending: false }); if (addrRows) addresses = addrRows.map((a: Record<string, unknown>) => ({ id: a.id, label: a.label, neighborhood_id: a.neighborhood_id, street: a.street, number: a.number, complement: a.complement, reference_point: a.reference_point, is_default: a.is_default, lat: a.lat, lng: a.lng, bairro: a.bairro, neighborhood_name: null, neighborhood_delivery_fee: 0, neighborhood_is_active: true })); }
      return new Response(JSON.stringify({ _v: "v14", customer, addresses }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Visita ao cardapio (carrinho abandonado) ───────────────────────────────
    // Publica (a pessoa nao esta logada). Uma linha por sessao no aparelho
    // (`visit_key`), atualizada conforme ela avanca. Vira "abandono" quando
    // `converted_at` fica null e ninguem mexe mais.
    if (action === "track_visit") {
      // Sem customer_id de proposito: o cardapio conhece o id de `delivery_customers`,
      // que NAO e o id de `customers`. O telefone e a chave; a tela resolve o cadastro.
      const { tenant_id, visit_key, step, phone, customer_name, items_count, cart_total, cart_items } = body;
      if (!tenant_id || !visit_key) return jsonErr("tenant_id e visit_key sao obrigatorios", 400);
      const vKey = String(visit_key).slice(0, 64);
      const cleanPhone = String(phone ?? "").replace(/\D/g, "") || null;
      const nowIso = new Date().toISOString();

      // So guarda o resumo do carrinho (nome/qtd/total). Nada de payload cru do cliente.
      const resumo = Array.isArray(cart_items)
        ? cart_items.slice(0, 30).map((ci: Record<string, unknown>) => ({
          nome: String(ci?.nome ?? "").slice(0, 120),
          qtd: Number(ci?.qtd ?? 0) || 0,
          total: Number(ci?.total ?? 0) || 0,
        }))
        : null;

      const row: Record<string, unknown> = {
        tenant_id,
        visit_key: vKey,
        last_seen_at: nowIso,
        last_step: typeof step === "string" ? step.slice(0, 32) : null,
        items_count: Number(items_count ?? 0) || 0,
        cart_total: Number(cart_total ?? 0) || 0,
        cart_items: resumo,
      };
      if (cleanPhone) row.phone = cleanPhone;
      if (typeof customer_name === "string" && customer_name.trim()) row.customer_name = customer_name.trim().slice(0, 120);

      const { error: visitErr } = await admin.from("menu_visits").upsert(row, { onConflict: "tenant_id,visit_key" });
      // Tracking nunca pode quebrar o cardapio: loga e responde ok.
      if (visitErr) console.warn("[delivery-write] track_visit falhou", String(visitErr.message ?? visitErr));
      return new Response(JSON.stringify({ _v: "v14", ok: !visitErr }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Carrinhos abandonados / visitas sem pedido (tela Clientes) ─────────────
    // Autenticado: membro da loja. Le direto com service_role porque menu_visits
    // fica sem policy de leitura (telefone de visitante).
    if (action === "list_abandoned_carts") {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) return jsonErr("Não autenticado", 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessão inválida", 401);
      const { tenant_id, days } = body;
      if (!tenant_id) return jsonErr("tenant_id obrigatorio", 400);
      const { data: membership } = await admin.from("user_tenants").select("role").eq("user_id", userData.user.id).eq("tenant_id", tenant_id).limit(1).maybeSingle();
      if (!membership) return jsonErr("Sem acesso a esta loja.", 403);

      const janelaDias = Math.min(90, Math.max(1, Number(days ?? 7) || 7));
      const desde = new Date(Date.now() - janelaDias * 24 * 60 * 60 * 1000).toISOString();

      // "Ainda navegando" nao e abandono: ignora o que teve atividade nos ultimos
      // 30 min. A config da loja pode esticar essa espera (cart_recovery.delay_min).
      const { data: ssRow } = await admin.from("system_settings").select("delivery_config").eq("tenant_id", tenant_id).maybeSingle();
      const cfg = ((ssRow?.delivery_config as Record<string, unknown> | null) ?? {}).cart_recovery as Record<string, unknown> | undefined;
      const esperaMin = Math.min(1440, Math.max(5, Number(cfg?.delay_min ?? 30) || 30));
      const ate = new Date(Date.now() - esperaMin * 60 * 1000).toISOString();

      const { data: rows, error: listErr } = await admin
        .from("menu_visits")
        .select("id, visit_key, phone, customer_id, customer_name, started_at, last_seen_at, last_step, items_count, cart_total, cart_items")
        .eq("tenant_id", tenant_id)
        .is("converted_at", null)
        .gte("last_seen_at", desde)
        .lte("last_seen_at", ate)
        .order("last_seen_at", { ascending: false })
        .limit(200);
      if (listErr) throw listErr;

      const visitas = rows ?? [];
      // O telefone e a chave da visita (orders nao guarda telefone: so customer_id).
      // Resolve telefone -> cadastro em `customers` para saber o nome real e
      // poder abrir o voucher pela tela.
      const phones = Array.from(new Set(visitas.map((v) => String(v.phone ?? "")).filter(Boolean)));
      const custPorTelefone = new Map<string, { id: string; name: string | null }>();
      if (phones.length > 0) {
        const { data: custRows } = await admin
          .from("customers")
          .select("id, name, phone")
          .eq("tenant_id", tenant_id)
          .in("phone", phones);
        for (const c of custRows ?? []) {
          custPorTelefone.set(String((c as Record<string, unknown>).phone ?? ""), {
            id: String((c as Record<string, unknown>).id),
            name: ((c as Record<string, unknown>).name as string | null) ?? null,
          });
        }
      }

      // Quem voltou depois e pediu nao e abandono: derruba quem tem pedido
      // (nao cancelado, fora do treinamento) DEPOIS do inicio da visita.
      const custIds = Array.from(new Set(Array.from(custPorTelefone.values()).map((c) => c.id)));
      const pedidoDepois = new Map<string, string>();
      if (custIds.length > 0) {
        const { data: ordRows } = await admin
          .from("orders")
          .select("customer_id, created_at")
          .eq("tenant_id", tenant_id)
          .in("customer_id", custIds)
          .neq("status", "cancelled")
          .eq("is_training", false)
          .gte("created_at", desde);
        for (const o of ordRows ?? []) {
          const cid = String((o as Record<string, unknown>).customer_id ?? "");
          const at = String((o as Record<string, unknown>).created_at ?? "");
          const atual = pedidoDepois.get(cid);
          if (!atual || at > atual) pedidoDepois.set(cid, at);
        }
      }

      const abandonos = visitas.filter((v) => {
        const cad = custPorTelefone.get(String(v.phone ?? ""));
        if (!cad) return true;
        const ultimoPedido = pedidoDepois.get(cad.id);
        return !ultimoPedido || ultimoPedido < String(v.started_at ?? v.last_seen_at);
      }).map((v) => ({
        id: v.id,
        phone: v.phone ?? null,
        phone_fmt: v.phone ? fmtPhone(String(v.phone)) : null,
        customer_id: custPorTelefone.get(String(v.phone ?? ""))?.id ?? null,
        customer_name: custPorTelefone.get(String(v.phone ?? ""))?.name ?? v.customer_name ?? null,
        started_at: v.started_at,
        last_seen_at: v.last_seen_at,
        last_step: v.last_step ?? null,
        items_count: v.items_count ?? 0,
        cart_total: Number(v.cart_total ?? 0),
        cart_items: v.cart_items ?? null,
        // Com itens no carrinho = abandono de carrinho; sem itens = so espiou.
        tipo: Number(v.items_count ?? 0) > 0 ? "carrinho" : "visita",
      }));

      return new Response(JSON.stringify({
        _v: "v14",
        abandonos,
        // A tela mostra o aviso de "recuperacao desligada" com base nisso.
        cart_recovery: cfg ?? { enabled: false },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "save_customer") {
      const { tenant_id, phone, name, neighborhood_id, street, number, complement, reference_point, bairro, address_lat, address_lng, birth_date, gender } = body;
      // Rotulo opcional do 1o endereco (o caixa deixa escolher Casa/Trabalho/...).
      // O link do delivery nao manda — segue com "Principal"/"Endereco N".
      const labelPedido = (typeof body.label === "string" && body.label.trim()) ? body.label.trim().slice(0, 40) : null;
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
          await admin.from("delivery_customer_addresses").insert({ customer_id: customer.id, tenant_id, label: labelPedido ?? ((addrCount ?? 0) === 0 ? "Principal" : "Endereco " + ((addrCount ?? 0) + 1)), neighborhood_id: neighborhood_id || null, street: street || null, number: number || null, complement: complement || null, reference_point: reference_point || null, bairro: bairro || null, is_default: (addrCount ?? 0) === 0, lat: sHasPin ? sLat : null, lng: sHasPin ? sLng : null });
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
      if (!token) return jsonErr("Não autenticado", 401);

      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessão inválida", 401);
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
      // Quem tem "Delivery (configuracao)" (o Supervisor tem por padrao) salva — antes so o dono, e a tela
      // aparecia para o Supervisor mas o Salvar dava erro (2026-10-04).
      if (!membership || !(await temPermissao(admin, tenant_id, userId, membership.role, "gestao_delivery"))) {
        return jsonErr("Você não tem permissão para mudar o delivery desta loja.", 403);
      }

      // Merge: preserva chaves de runtime que esta tela nao conhece (delivery_manual_open,
      // delivery_paused_until — gravadas pelo botao do PDV via set_delivery_state).
      const { data: existingSettings } = await admin
        .from("system_settings")
        .select("delivery_config")
        .eq("tenant_id", tenant_id)
        .maybeSingle();
      const existingDc = (existingSettings?.delivery_config as Record<string, unknown> | null) ?? {};
      const mergedDc: Record<string, unknown> = { ...existingDc, ...((delivery_config as Record<string, unknown> | null) ?? {}) };
      // Estado do botao (abrir/pausar/dia corrido) nunca vem da tela de configuracao; o cupom do carrinho
      // abandonado so muda por save_cart_recovery (Clientes & Marketing, permissao de Vouchers).
      for (const k of ["delivery_manual_open", "delivery_paused_until", "prazo_extra", "cart_recovery"]) {
        if (k in existingDc) mergedDc[k] = existingDc[k]; else delete mergedDc[k];
      }
      if (mergedDc.delivery_schedule != null) {
        const novo = mergedDc.delivery_schedule as Record<string, any>;
        const antigo = (existingDc.delivery_schedule && typeof existingDc.delivery_schedule === "object") ? existingDc.delivery_schedule as Record<string, any> : null;
        // Tela antiga (um horario por dia, sem datas especiais) ainda aberta num aparelho: nao apaga o que ela
        // nao conhece. Sem `exceptions` no corpo = mantem as salvas; dia sem `intervals` com o mesmo abre/fecha
        // espelhado = mantem os varios horarios salvos daquele dia.
        if (antigo) {
          if (!("exceptions" in novo) && Array.isArray(antigo.exceptions)) novo.exceptions = antigo.exceptions;
          const diasNovos = (novo.days && typeof novo.days === "object") ? novo.days as Record<string, any> : null;
          const diasAntigos = (antigo.days && typeof antigo.days === "object") ? antigo.days as Record<string, any> : {};
          if (diasNovos) {
            for (const d of Object.keys(diasNovos)) {
              const n = diasNovos[d]; const a = diasAntigos[d];
              if (n && a && !Array.isArray(n.intervals) && Array.isArray(a.intervals) && a.intervals.length > 1
                  && n.open === a.open && n.close === a.close && n.enabled === a.enabled) {
                n.intervals = a.intervals;
              }
            }
          }
        }
        // Datas especiais que ja passaram ha mais de uma semana saem (o limite de 60 nao pode empurrar as futuras).
        const corte = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
        if (Array.isArray(novo.exceptions)) novo.exceptions = novo.exceptions.filter((e: any) => e && typeof e.date === "string" && e.date >= corte);
        mergedDc.delivery_schedule = normalizarHorarioDelivery(novo);
      }

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
      if (!token) return jsonErr("Não autenticado", 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessão inválida", 401);
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

    // ── Cupom sugerido para quem montou a sacola e nao pediu (Clientes & Marketing › Funil › Nao pediram).
    // Grava SO delivery_config.cart_recovery. Quem pode: quem emite cupom (gestao_vouchers). 2026-10-04.
    if (action === "save_cart_recovery") {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) return jsonErr("Não autenticado", 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessão inválida", 401);
      const { tenant_id } = body;
      if (!tenant_id) return jsonErr("tenant_id obrigatorio", 400);
      const { data: membership } = await admin.from("user_tenants").select("role").eq("user_id", userData.user.id).eq("tenant_id", tenant_id).limit(1).maybeSingle();
      if (!membership || !(await temPermissao(admin, tenant_id, userData.user.id, membership.role, "gestao_vouchers"))) {
        return jsonErr("Quem muda o cupom sugerido é quem pode emitir cupom (Vouchers).", 403);
      }
      const cr = (body.cart_recovery ?? {}) as Record<string, unknown>;
      const limpo = {
        enabled: cr.enabled === true,
        delay_min: Math.min(1440, Math.max(5, Math.round(Number(cr.delay_min) || 30))),
        voucher_type: cr.voucher_type === "valor" ? "valor" : "percentual",
        voucher_value: Math.max(0, Math.round((Number(String(cr.voucher_value ?? 0).replace(",", ".")) || 0) * 100) / 100),
        validade_dias: Math.min(90, Math.max(1, Math.round(Number(cr.validade_dias) || 7))),
        mensagem: String(cr.mensagem ?? "").trim().slice(0, 500),
      };
      if (limpo.voucher_type === "percentual" && limpo.voucher_value > 100) return jsonErr("Desconto acima de 100%.", 400);
      const { data: ss } = await admin.from("system_settings").select("delivery_config").eq("tenant_id", tenant_id).maybeSingle();
      const dcAtual = (ss?.delivery_config as Record<string, unknown> | null) ?? {};
      const { error: updErr } = await admin.from("system_settings").update({ delivery_config: { ...dcAtual, cart_recovery: limpo } }).eq("tenant_id", tenant_id);
      if (updErr) throw updErr;
      return new Response(JSON.stringify({ _v: "v14", ok: true, cart_recovery: limpo }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Gestao de motoboys (entregadores) — quem tem "Delivery (configuracao)" ──
    if (action === "list_drivers" || action === "set_driver_active" || action === "delete_driver" || action === "gerar_codigo_motoboy") {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) return jsonErr("Não autenticado", 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessão inválida", 401);

      const { tenant_id } = body;
      if (!tenant_id) return jsonErr("tenant_id obrigatorio", 400);
      const { data: membership } = await admin.from("user_tenants").select("role").eq("user_id", userData.user.id).eq("tenant_id", tenant_id).limit(1).maybeSingle();
      if (!membership || !(await temPermissao(admin, tenant_id, userData.user.id, membership.role, "gestao_delivery"))) {
        return jsonErr("Você não tem permissão para mexer nos entregadores desta loja.", 403);
      }

      if (action === "list_drivers") {
        const { data: drivers } = await admin.from("delivery_drivers")
          .select("id, name, phone, is_active, created_at, last_login_at")
          .eq("tenant_id", tenant_id).order("created_at", { ascending: false });
        // Entregas de cada um nos ultimos 30 dias (tela Delivery › Entregadores).
        const desde30 = new Date(Date.now() - 30 * 86400000).toISOString();
        const { data: entregues } = await admin.from("orders").select("motoboy_driver_id")
          .eq("tenant_id", tenant_id).eq("origin_type", "delivery").eq("status", "delivered")
          .not("motoboy_driver_id", "is", null).gte("created_at", desde30).limit(5000);
        const porDriver = new Map<string, number>();
        for (const o of (entregues ?? []) as Array<{ motoboy_driver_id: string }>) porDriver.set(o.motoboy_driver_id, (porDriver.get(o.motoboy_driver_id) ?? 0) + 1);
        const lista = (drivers ?? []).map((d: Record<string, unknown>) => ({ ...d, entregas_30d: porDriver.get(d.id as string) ?? 0 }));
        return new Response(JSON.stringify({ _v: "v14", ok: true, drivers: lista }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "gerar_codigo_motoboy") {
        // App "ERPOS Entregas": código de uso único (24 h) para o motoboy ligar esta loja no app.
        // 8 letras/números sem os ambíguos (0/O, 1/I/L) — chutar pelo endpoint público fica inviável.
        const ALFA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        const expira = new Date(Date.now() + 24 * 3600000).toISOString();
        for (let tentativa = 0; tentativa < 5; tentativa++) {
          const rnd = crypto.getRandomValues(new Uint32Array(8));
          const code = Array.from(rnd, (n) => ALFA[n % ALFA.length]).join("");
          const { error } = await admin.from("delivery_driver_codes").insert({ tenant_id, code, created_by: userData.user.id, expires_at: expira });
          if (!error) return new Response(JSON.stringify({ _v: "v18", ok: true, code: code.slice(0, 4) + "-" + code.slice(4), expires_at: expira }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          if (!String(error.message).includes("duplicate")) throw error;
        }
        return jsonErr("Não foi possível gerar o código. Tente de novo.", 500);
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
    if (action === "list_delivery_orders" || action === "list_delivery_board" || action === "get_delivery_order" || action === "add_delivery_note" || action === "set_motoboy_status" || action === "clear_motoboy_driver" || action === "montar_saida") {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) return jsonErr("Não autenticado", 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessão inválida", 401);
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

      if (action === "list_delivery_board") {
        // Kanban do "Gestor de Entregas": como o list_delivery_orders, mas inclui os
        // ENTREGUES recentes (coluna final) e so entrega PROPRIA (exclui iFood/retirada).
        // Campos extras: delivery_sla_min, motoboy_timeline, out_for_delivery_at.
        const { data: orders } = await admin.from("orders")
          .select("id, number, destination_name, destination_phone, delivery_address, delivery_platform, total_amount, delivery_fee, status, is_paid, notes, motoboy_status, motoboy_note, motoboy_problems, delivery_notes, motoboy_driver_id, motoboy_updated_at, out_for_delivery_at, delivery_sla_min, motoboy_timeline, delivery_lat, delivery_lng, created_at, updated_at, ifood_order_id")
          .eq("tenant_id", tenant_id).eq("origin_type", "delivery").in("status", ["new", "preparing", "ready", "delivered"])
          .order("created_at", { ascending: true });
        const RECENTE_MS = 3 * 60 * 60 * 1000; // entregues nas ultimas 3h ficam na coluna "Entregue"
        const agora = Date.now();
        const lista = ((orders ?? []) as Record<string, unknown>[]).filter((o) => {
          // So entrega propria; fora retirada e os apps de fora (quem entrega e o app).
          // WhatsApp/Instagram/Telefone/Site/Presencial do PDV Delivery SAO entrega propria.
          const plat = o.delivery_platform as string | null;
          if (plat && (plat === "retirada" || PLATAFORMAS_EXTERNAS.has(plat))) return false;
          if (o.status === "delivered") {
            const ref = (o.motoboy_updated_at as string | null) ?? (o.updated_at as string | null);
            const t = ref ? new Date(ref).getTime() : 0;
            return !!t && (agora - t) <= RECENTE_MS;
          }
          return true;
        });
        const driverNome: Record<string, string> = {};
        const dids = Array.from(new Set(lista.map((o) => o.motoboy_driver_id as string | null).filter(Boolean))) as string[];
        if (dids.length) {
          const { data: drvs } = await admin.from("delivery_drivers").select("id, name").in("id", dids);
          (drvs ?? []).forEach((d: { id: string; name: string }) => { driverNome[d.id] = d.name; });
        }
        // "Montar saída" (Fase 3): pin da loja + motoboys ativos para a sugestão
        const [{ data: ssBoard }, { data: motosAtivos }] = await Promise.all([
          admin.from("system_settings").select("delivery_config").eq("tenant_id", tenant_id).maybeSingle(),
          admin.from("delivery_drivers").select("id, name").eq("tenant_id", tenant_id).eq("is_active", true).order("name"),
        ]);
        const slBoard = (ssBoard?.delivery_config as Record<string, any> | null)?.store_location;
        const lojaBoard = slBoard && Number.isFinite(Number(slBoard.lat)) && Number.isFinite(Number(slBoard.lng)) ? { lat: Number(slBoard.lat), lng: Number(slBoard.lng) } : null;
        // "Montar saída": quando o pedido ainda na cozinha deve ficar pronto (dá para a saída esperar por ele).
        // Começou o preparo = início + tempo de preparo; status "preparing" sem início marcado = criação + tempo total;
        // "new" que ninguém começou = sem previsão.
        const naCozinha = lista.filter((o) => o.status === "new" || o.status === "preparing");
        const preparoAt: Record<string, number> = {};
        let preparo: { prepMin: number; totalMin: number; base: "historico" | "padrao" } | null = null;
        if (naCozinha.length) {
          const [{ data: itsCoz }, tp] = await Promise.all([
            admin.from("order_items").select("order_id, started_preparing_at, skip_kds").in("order_id", naCozinha.map((o) => o.id as string)),
            tempoPreparoDelivery(admin, tenant_id),
          ]);
          preparo = tp;
          for (const i of (itsCoz ?? []) as Record<string, any>[]) {
            if (i.skip_kds || !i.started_preparing_at) continue;
            const t = new Date(i.started_preparing_at).getTime();
            preparoAt[i.order_id] = preparoAt[i.order_id] == null ? t : Math.min(preparoAt[i.order_id], t);
          }
        }
        const prontoPrevisto = (o: Record<string, unknown>): string | null => {
          if (!preparo || (o.status !== "new" && o.status !== "preparing")) return null;
          const ini = preparoAt[o.id as string];
          if (ini != null) return new Date(ini + preparo.prepMin * 60000).toISOString();
          if (o.status === "preparing") return new Date(new Date(o.created_at as string).getTime() + preparo.totalMin * 60000).toISOString();
          return null;
        };
        return new Response(JSON.stringify({ _v: "v19", ok: true, loja: lojaBoard, motoboys: motosAtivos ?? [], preparo, orders: lista.map((o) => ({
          id: o.id, number: o.number,
          cliente: ((o.destination_name as string | null) ?? "Cliente").split(/\s+[-–—]\s+/)[0].trim() || "Cliente",
          telefone: ((o.destination_phone as string | null) ?? "").replace(/\D/g, ""),
          endereco: o.delivery_address ?? "", total: Number(o.total_amount ?? 0), taxa: Number(o.delivery_fee ?? 0),
          status: o.status, motoboy_status: o.motoboy_status ?? null, motoboy_note: o.motoboy_note ?? null,
          problemas: Array.isArray(o.motoboy_problems) ? o.motoboy_problems : [],
          delivery_notes: Array.isArray(o.delivery_notes) ? o.delivery_notes : [],
          driver_id: o.motoboy_driver_id ?? null, driver_nome: o.motoboy_driver_id ? (driverNome[o.motoboy_driver_id as string] ?? null) : null,
          created_at: o.created_at, motoboy_updated_at: o.motoboy_updated_at ?? null,
          out_for_delivery_at: o.out_for_delivery_at ?? null,
          delivery_sla_min: o.delivery_sla_min != null ? Number(o.delivery_sla_min) : null,
          motoboy_timeline: (o.motoboy_timeline && typeof o.motoboy_timeline === "object") ? o.motoboy_timeline : {},
          // Pix pelo app: o gestor precisa saber se o motoboy cobra ou não
          pago: !!o.is_paid, pagamento: (o.notes as string | null) ?? null,
          lat: o.delivery_lat != null ? Number(o.delivery_lat) : null,
          lng: o.delivery_lng != null ? Number(o.delivery_lng) : null,
          preparo_at: preparoAt[o.id as string] != null ? new Date(preparoAt[o.id as string]).toISOString() : null,
          pronto_previsto_at: prontoPrevisto(o),
          // Pedido do iFood com entrega nossa: botão "Copiar link do cliente" no card
          ifood_order_id: (o.ifood_order_id as string | null) ?? null,
        })) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "montar_saida") {
        // Fase 3: o gestor confirma a saída sugerida (ou a que ele ajustou). Amarra os pedidos ao motoboy e guarda
        // sugerido × feito. Só pedido de entrega própria em aberto e sem outro entregador.
        const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const ids: string[] = Array.isArray(body.pedidos) ? body.pedidos.map((x: unknown) => String(x)) : [];
        if (!ids.length || ids.length > 8 || ids.some((x) => !UUID.test(x)) || new Set(ids).size !== ids.length) return jsonErr("Pedidos inválidos.", 400);
        const driverId = String(body.driver_id || "").trim();
        if (!UUID.test(driverId)) return jsonErr("Escolha o motoboy.", 400);
        const { data: drv } = await admin.from("delivery_drivers").select("id, name, is_active").eq("id", driverId).eq("tenant_id", tenant_id).maybeSingle();
        if (!drv || drv.is_active === false) return jsonErr("Motoboy inválido ou bloqueado.", 400);
        const { data: peds } = await admin.from("orders").select("id, number, origin_type, status, delivery_platform, motoboy_driver_id")
          .eq("tenant_id", tenant_id).in("id", ids);
        const porId = new Map(((peds ?? []) as Record<string, unknown>[]).map((o) => [o.id as string, o]));
        for (const id of ids) {
          const o = porId.get(id);
          if (!o) return jsonErr("Pedido não encontrado nesta loja.", 404);
          const plat = o.delivery_platform as string | null;
          if (o.origin_type !== "delivery" || (plat && (plat === "retirada" || PLATAFORMAS_EXTERNAS.has(plat)))) return jsonErr(`Pedido ${o.number} não é entrega da loja.`, 400);
          if (o.status === "delivered" || o.status === "cancelled") return jsonErr(`Pedido ${o.number} já foi encerrado.`, 409);
          if (o.motoboy_driver_id && o.motoboy_driver_id !== driverId) return jsonErr(`Pedido ${o.number} já está com outro entregador.`, 409);
        }
        const nowIso = new Date().toISOString();
        // Condição no próprio UPDATE: se outro motoboy pegou no meio tempo, não sobrescreve
        const { data: amarrados, error: upErr } = await admin.from("orders").update({ motoboy_driver_id: driverId, motoboy_updated_at: nowIso, updated_at: nowIso })
          .eq("tenant_id", tenant_id).in("id", ids).or(`motoboy_driver_id.is.null,motoboy_driver_id.eq.${driverId}`).select("id");
        if (upErr) throw upErr;
        const ok = new Set(((amarrados ?? []) as { id: string }[]).map((r) => r.id));
        const faltou = ids.filter((id) => !ok.has(id));
        if (faltou.length) return jsonErr("Um pedido foi pego por outro entregador agora há pouco. Atualize e monte de novo.", 409);
        const sug = (body.sugerido && typeof body.sugerido === "object") ? body.sugerido as Record<string, unknown> : {};
        const sugPedidos = Array.isArray(sug.pedidos) ? (sug.pedidos as unknown[]).map(String) : [];
        const seguiu = String(sug.driver_id ?? "") === driverId && sugPedidos.join(",") === ids.join(",");
        const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
        const { data: saida, error: insErr } = await admin.from("delivery_saidas").insert({
          tenant_id, driver_id: driverId, pedidos: ids,
          maps_url: typeof body.maps_url === "string" && body.maps_url.startsWith("https://www.google.com/maps/") ? body.maps_url.slice(0, 2000) : null,
          km_estimado: num(body.km), min_estimado: num(body.min) != null ? Math.round(Number(body.min)) : null,
          sugerido: { driver_id: sug.driver_id ?? null, pedidos: sugPedidos, km: num(sug.km), min: num(sug.min) },
          seguiu_sugestao: seguiu, created_by: userData.user.id,
        }).select("id").single();
        if (insErr) throw insErr;
        return new Response(JSON.stringify({ _v: "v18", ok: true, saida_id: saida.id, motoboy: drv.name }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const orderId = String(body.order_id || "").trim();
      if (!orderId) return jsonErr("order_id obrigatorio", 400);

      if (action === "get_delivery_order") {
        // Detalhe completo p/ o modal do Gestor de Entregas: fases da cozinha + entrega,
        // itens, financeiro, historico de problemas e observacoes.
        const { data: o } = await admin.from("orders")
          .select("id, number, destination_name, destination_phone, delivery_address, delivery_platform, total_amount, delivery_fee, status, is_paid, notes, motoboy_status, motoboy_note, motoboy_problems, delivery_notes, motoboy_driver_id, motoboy_updated_at, out_for_delivery_at, delivery_sla_min, motoboy_timeline, delivery_lat, delivery_lng, created_at")
          .eq("id", orderId).eq("tenant_id", tenant_id).maybeSingle();
        if (!o) return jsonErr("Pedido não encontrado nesta loja.", 404);
        const { data: items } = await admin.from("order_items")
          .select("item_name, quantity, item_price, skip_kds, started_preparing_at, ready_at").eq("order_id", orderId);
        // Fases da COZINHA (agregado dos itens que vao pra cozinha) — mesmo criterio do motoboy-signal.
        const cozinhaItens = ((items ?? []) as Record<string, unknown>[]).filter((i) => !i.skip_kds);
        const minTs = (campo: string): string | null => {
          const ts = cozinhaItens.map((i) => i[campo] as string | null).filter(Boolean) as string[];
          return ts.length ? ts.sort()[0] : null;
        };
        const maxTs = (campo: string): string | null => {
          const ts = cozinhaItens.map((i) => i[campo] as string | null).filter(Boolean) as string[];
          return ts.length ? ts.sort()[ts.length - 1] : null;
        };
        const todosProntos = cozinhaItens.length > 0 && cozinhaItens.every((i) => !!i.ready_at);
        const cozinha = {
          novo_at: o.created_at ?? null,
          preparo_at: minTs("started_preparing_at"),
          pronto_at: todosProntos ? maxTs("ready_at") : null,
        };
        const driverNomeDet = o.motoboy_driver_id
          ? (await admin.from("delivery_drivers").select("name").eq("id", o.motoboy_driver_id as string).maybeSingle()).data?.name ?? null
          : null;
        return new Response(JSON.stringify({ _v: "v16", ok: true, order: {
          id: o.id, number: o.number,
          cliente: ((o.destination_name as string | null) ?? "Cliente").split(/\s+[-–—]\s+/)[0].trim() || "Cliente",
          telefone: ((o.destination_phone as string | null) ?? "").replace(/\D/g, ""),
          endereco: o.delivery_address ?? "", total: Number(o.total_amount ?? 0), taxa: Number(o.delivery_fee ?? 0),
          status: o.status, motoboy_status: o.motoboy_status ?? null,
          driver_nome: driverNomeDet,
          created_at: o.created_at, out_for_delivery_at: o.out_for_delivery_at ?? null,
          delivery_sla_min: o.delivery_sla_min != null ? Number(o.delivery_sla_min) : null,
          motoboy_timeline: (o.motoboy_timeline && typeof o.motoboy_timeline === "object") ? o.motoboy_timeline : {},
          cozinha,
          pago: !!o.is_paid, pagamento: (o.notes as string | null) ?? null,
          itens: ((items ?? []) as Record<string, unknown>[]).map((i) => ({
            nome: i.item_name ?? "", quantidade: Number(i.quantity ?? 1), preco: Number(i.item_price ?? 0),
          })),
          problemas: Array.isArray(o.motoboy_problems) ? o.motoboy_problems : [],
          delivery_notes: Array.isArray(o.delivery_notes) ? o.delivery_notes : [],
        } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "add_delivery_note") {
        // Registra problema OU observacao (so log — NAO mexe na fase). Grava autor.
        const kind = String(body.kind || "");
        if (kind !== "problema" && kind !== "observacao") return jsonErr("kind invalido", 400);
        const text = String(body.text ?? "").trim().slice(0, 1000);
        if (!text) return jsonErr("texto obrigatorio", 400);
        const autor = String(body.autor ?? "").slice(0, 120) || null;
        const { data: cur } = await admin.from("orders").select("delivery_notes").eq("id", orderId).eq("tenant_id", tenant_id).maybeSingle();
        if (!cur) return jsonErr("Pedido não encontrado nesta loja.", 404);
        const notes = Array.isArray(cur.delivery_notes) ? (cur.delivery_notes as unknown[]) : [];
        const nowIso = new Date().toISOString();
        const novo = [...notes, { at: nowIso, kind, text, autor }];
        const { error } = await admin.from("orders").update({ delivery_notes: novo, updated_at: nowIso }).eq("id", orderId).eq("tenant_id", tenant_id);
        if (error) throw error;
        return new Response(JSON.stringify({ _v: "v16", ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Confere que o pedido e desta loja (clear/set).
      const { data: ord } = await admin.from("orders").select("id, motoboy_timeline, motoboy_status, motoboy_problems").eq("id", orderId).eq("tenant_id", tenant_id).maybeSingle();
      if (!ord) return jsonErr("Pedido não encontrado nesta loja.", 404);

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
        const autorProb = String(body.autor ?? "").slice(0, 120) || null;
        updates.motoboy_problems = [...probs, { at: nowIso, text: motivoTxt ?? "", by: "loja", autor: autorProb }];
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
      if (!token) return jsonErr("Não autenticado", 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessão inválida", 401);

      const { tenant_id } = body;
      if (!tenant_id) return jsonErr("tenant_id obrigatorio", 400);
      const { data: membership } = await admin.from("user_tenants").select("role").eq("user_id", userData.user.id).eq("tenant_id", tenant_id).limit(1).maybeSingle();
      if (!membership) return jsonErr("Sem acesso a esta loja.", 403);

      const { data: settingsRow } = await admin.from("system_settings").select("delivery_config").eq("tenant_id", tenant_id).maybeSingle();
      const dc = (settingsRow?.delivery_config as Record<string, any> | null) ?? {};
      const schedule = dc.delivery_schedule as DeliverySchedule | undefined;
      const { data: openSess } = await admin.from("sessions").select("id").eq("tenant_id", tenant_id).eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle();
      const hasSession = !!openSess;
      const now = new Date();

      if (action === "set_delivery_state") {
        const op = String(body.op || "");
        let manualOpen = dc.delivery_manual_open === true;
        let pausedUntil: string | null = (typeof dc.delivery_paused_until === "string" && dc.delivery_paused_until) ? dc.delivery_paused_until : null;
        const within = isWithinSchedule(schedule, now);

        if (op === "open") {
          if (!hasSession) return jsonErr("Abra uma sessão de caixa antes de abrir o delivery.", 409);
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
        } else if (op === "prazo_extra") {
          // Dia corrido: +N min no prazo prometido ate o caixa fechar (0 = normal).
          const extra = Math.round(Number(body.minutes) || 0);
          if (extra < 0 || extra > 120) return jsonErr("minutes invalido (0 a 120)", 400);
          if (extra > 0 && !openSess) return jsonErr("Abra o caixa antes.", 409);
          const dcExtra = { ...dc, prazo_extra: extra > 0 ? { min: extra, session_id: openSess!.id, at: now.toISOString() } : null };
          const { error: exErr } = await admin.from("system_settings").update({ delivery_config: dcExtra }).eq("tenant_id", tenant_id);
          if (exErr) throw exErr;
          const stx = computeDeliveryOpen(dcExtra, hasSession, now);
          return new Response(JSON.stringify({ _v: "v14", ok: true, open_now: stx.open, reason: stx.reason, manual_open: manualOpen, paused_until: pausedUntil, schedule_enabled: !!(schedule && schedule.enabled), has_session: hasSession, prazo_extra_min: prazoExtraMin(dcExtra, openSess?.id) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } else {
          return jsonErr("op invalido (open|close|pause|resume|force_off|prazo_extra)", 400);
        }

        const mergedDc = { ...dc, delivery_manual_open: manualOpen, delivery_paused_until: pausedUntil };
        const { error: updErr } = await admin.from("system_settings").update({ delivery_config: mergedDc }).eq("tenant_id", tenant_id);
        if (updErr) throw updErr;
        const st = computeDeliveryOpen(mergedDc, hasSession, now);
        return new Response(JSON.stringify({ _v: "v14", ok: true, open_now: st.open, reason: st.reason, manual_open: manualOpen, paused_until: pausedUntil, schedule_enabled: !!(schedule && schedule.enabled), has_session: hasSession }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // get_delivery_state
      const st = computeDeliveryOpen(dc, hasSession, now);
      return new Response(JSON.stringify({ _v: "v14", open_now: st.open, reason: st.reason, manual_open: dc.delivery_manual_open === true, paused_until: (typeof dc.delivery_paused_until === "string" ? dc.delivery_paused_until : null), schedule: schedule ?? null, schedule_enabled: !!(schedule && schedule.enabled), within_schedule: isWithinSchedule(schedule, now), has_session: hasSession, prazo_extra_min: prazoExtraMin(dc, openSess?.id), minutos_ate_fechar: minutesUntilWindowClose(schedule, now) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
        .select("id, number, status, created_at, updated_at, total_amount, delivery_fee, subtotal, out_for_delivery_at, delivery_sla_min, is_paid, notes, delivery_platform")
        .eq("tenant_id", tenant_id)
        .eq("number", order_number)
        .maybeSingle();
      if (error) throw error;
      if (!o) return new Response(JSON.stringify({ _v: "v14", order: null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: itemRows } = await admin
        .from("order_items")
        .select("id, item_name, item_price, quantity, notes, status")
        .eq("order_id", o.id)
        .eq("tenant_id", tenant_id);
      // Adicionais/opcoes por item — o cliente ver o que compoe o valor de cada item.
      // (no delivery o item_price é o preço BASE; os adicionais vêm daqui — ver PDVContext › itemPriceDoCanal.)
      const itemIds = (itemRows ?? []).map((it: Record<string, unknown>) => it.id as string);
      const optsByItem = new Map<string, Array<Record<string, unknown>>>();
      if (itemIds.length > 0) {
        const { data: optRows } = await admin
          .from("order_item_options")
          .select("order_item_id, option_name, group_name, additional_price")
          .in("order_item_id", itemIds)
          .eq("tenant_id", tenant_id);
        for (const op of optRows ?? []) {
          const key = op.order_item_id as string;
          const arr = optsByItem.get(key) ?? [];
          arr.push({
            option_name: (op.option_name as string) ?? "",
            group_name: (op.group_name as string) ?? null,
            additional_price: Number(op.additional_price ?? 0),
          });
          optsByItem.set(key, arr);
        }
      }
      const order = {
        id: o.id, number: o.number, status: o.status,
        created_at: o.created_at, updated_at: o.updated_at,
        out_for_delivery_at: o.out_for_delivery_at ?? null,
        delivery_sla_min: o.delivery_sla_min ?? null,
        is_paid: !!o.is_paid,
        pagamento: (o.notes as string | null) ?? null,
        // Retirada na loja: sem taxa e sem etapa "em rota" no acompanhamento
        is_retirada: o.delivery_platform === "retirada",
        total_amount: Number(o.total_amount ?? 0),
        delivery_fee: Number(o.delivery_fee ?? 0),
        subtotal: Number(o.subtotal ?? 0),
        items: (itemRows ?? []).map((it: Record<string, unknown>) => ({
          id: it.id, item_name: it.item_name, item_price: Number(it.item_price ?? 0),
          quantity: Number(it.quantity ?? 0), notes: it.notes ?? null,
          // 'cancelled' = item cancelado depois do pedido: o acompanhamento do cliente não mostra nem soma.
          status: (it.status as string | null) ?? null,
          options: optsByItem.get(it.id as string) ?? [],
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
      // Id do endereco gravado — o chamador precisa dele pra selecionar exatamente
      // este endereco depois (procurar por rua+numero erra quando ha parecidos).
      let savedAddressId: string | null = null;
      if (address_id) {
        const { error: updErr } = await admin.from("delivery_customer_addresses").update(fields).eq("id", address_id).eq("customer_id", customer_id).eq("tenant_id", tenant_id);
        if (updErr) throw updErr;
        savedAddressId = String(address_id);
      } else {
        // Dedup: mesmo rua+numero+complemento E mesmo rotulo = e o mesmo endereco
        // (clique duplo em "Salvar", ou recadastro). Rotulo diferente na mesma rua
        // continua sendo um endereco novo ("Casa" e "Trabalho" no mesmo predio).
        const { data: jaExiste } = await admin.from("delivery_customer_addresses")
          .select("id")
          .eq("customer_id", customer_id).eq("tenant_id", tenant_id)
          .eq("street", fields.street ?? "").eq("number", fields.number ?? "")
          .eq("label", fields.label as string)
          .maybeSingle();
        if (jaExiste) {
          const { error: updErr2 } = await admin.from("delivery_customer_addresses").update(fields).eq("id", jaExiste.id);
          if (updErr2) throw updErr2;
          savedAddressId = String(jaExiste.id);
        } else {
          const { count: addrCount } = await admin.from("delivery_customer_addresses").select("id", { count: "exact", head: true }).eq("customer_id", customer_id);
          const { data: inserted, error: insErr } = await admin.from("delivery_customer_addresses")
            .insert({ customer_id, tenant_id, is_default: (addrCount ?? 0) === 0, ...fields })
            .select("id").maybeSingle();
          if (insErr) throw insErr;
          savedAddressId = inserted?.id ? String(inserted.id) : null;
        }
      }
      const { data: addrRows } = await admin.from("delivery_customer_addresses").select("id, label, neighborhood_id, street, number, complement, reference_point, is_default, lat, lng, bairro").eq("customer_id", customer_id).eq("tenant_id", tenant_id).order("is_default", { ascending: false });
      const addresses = (addrRows ?? []).map((a: Record<string, unknown>) => ({ id: a.id, label: a.label, neighborhood_id: a.neighborhood_id, street: a.street, number: a.number, complement: a.complement, reference_point: a.reference_point, is_default: a.is_default, lat: a.lat, lng: a.lng, bairro: a.bairro, neighborhood_name: null, neighborhood_delivery_fee: 0, neighborhood_is_active: true }));
      return new Response(JSON.stringify({ _v: "v14", addresses, saved_address_id: savedAddressId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    // ── PDV: pedido de delivery lancado no caixa ──────────────────────────────
    // Acoes autenticadas (token do operador + membership na loja), espelhando o
    // gate usado em list_delivery_orders. Servem a tela /pdv/caixa: bootstrap da
    // config de entrega, busca de clientes cadastrados e cotacao da taxa.
    if (action === "pdv_delivery_bootstrap" || action === "search_customers" || action === "quote_delivery_fee") {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) return jsonErr("Não autenticado", 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessão inválida", 401);
      const { tenant_id } = body;
      if (!tenant_id) return jsonErr("tenant_id obrigatorio", 400);
      const { data: membership } = await admin.from("user_tenants").select("role").eq("user_id", userData.user.id).eq("tenant_id", tenant_id).limit(1).maybeSingle();
      if (!membership) return jsonErr("Sem acesso a esta loja.", 403);

      if (action === "pdv_delivery_bootstrap") {
        const [neighRes, settingsRes] = await Promise.all([
          admin.from("delivery_neighborhoods").select("id, name, delivery_fee, is_active").eq("tenant_id", tenant_id).order("name"),
          admin.from("system_settings").select("delivery_config, delivery_city").eq("tenant_id", tenant_id).maybeSingle(),
        ]);
        const dc = (settingsRes.data?.delivery_config ?? {}) as Record<string, any>;
        const tiersRaw = Array.isArray(dc.delivery_fee_tiers) ? dc.delivery_fee_tiers : [];
        const tiers = tiersRaw
          .map((t: any) => ({ ate_km: Number(t.ate_km) || 0, taxa: Number(t.taxa) || 0, tempo_max_min: Number(t.tempo_max_min) || 0 }))
          .filter((t: FaixaEntrega) => t.ate_km > 0);
        const loc = dc.store_location;
        const storeLocation = (loc && typeof loc.lat === "number" && typeof loc.lng === "number") ? { lat: loc.lat, lng: loc.lng } : null;
        return new Response(JSON.stringify({
          _v: "v14", ok: true,
          neighborhoods: (neighRes.data ?? []).filter((n: Record<string, unknown>) => n.is_active !== false),
          store_location: storeLocation,
          tiers,
          city: settingsRes.data?.delivery_city ?? null,
          distance_mode: !!storeLocation && tiers.length > 0,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "search_customers") {
        // Busca por NOME, TELEFONE ou ENDERECO. Sem termo, devolve os clientes usados
        // mais recentemente (o caixa quase sempre atende um cliente recorrente).
        const raw = String(body.q ?? "").trim();
        const digits = raw.replace(/\D/g, "");
        // O filtro `or` do PostgREST usa virgula/parenteses como sintaxe — sanitiza.
        const like = raw.replace(/[%,().*]/g, " ").replace(/\s+/g, " ").trim();

        // Endereco mora em outra tabela: resolve primeiro os clientes cujo endereco casa.
        let idsPorEndereco: string[] = [];
        if (like.length >= 2) {
          const { data: addrHits } = await admin.from("delivery_customer_addresses")
            .select("customer_id")
            .eq("tenant_id", tenant_id)
            .or("street.ilike.%" + like + "%,bairro.ilike.%" + like + "%,reference_point.ilike.%" + like + "%,complement.ilike.%" + like + "%")
            .limit(300);
          idsPorEndereco = Array.from(new Set((addrHits ?? []).map((a: Record<string, unknown>) => a.customer_id as string)));
        }

        let query = admin.from("delivery_customers")
          .select("id, name, phone, last_used_at, neighborhood_id, street, number, complement, reference_point")
          .eq("tenant_id", tenant_id)
          .order("last_used_at", { ascending: false, nullsFirst: false })
          .limit(30);
        if (like.length >= 2 || digits.length >= 3) {
          const partes: string[] = [];
          if (like.length >= 2) {
            partes.push("name.ilike.%" + like + "%");
            // Cliente antigo guarda o endereco nas colunas do proprio cadastro.
            partes.push("street.ilike.%" + like + "%");
          }
          if (digits.length >= 3) partes.push("phone.ilike.%" + digits + "%");
          if (idsPorEndereco.length > 0) partes.push("id.in.(" + idsPorEndereco.join(",") + ")");
          if (partes.length > 0) query = query.or(partes.join(","));
        }
        const { data: custRows, error: custErr } = await query;
        if (custErr) throw custErr;
        const customers = custRows ?? [];
        const ids = customers.map((c: Record<string, unknown>) => c.id as string);
        const addrByCustomer: Record<string, Array<Record<string, unknown>>> = {};
        if (ids.length > 0) {
          const { data: addrRows } = await admin.from("delivery_customer_addresses")
            .select("id, customer_id, label, neighborhood_id, street, number, complement, reference_point, is_default, lat, lng, bairro")
            .eq("tenant_id", tenant_id).in("customer_id", ids)
            .order("is_default", { ascending: false });
          for (const a of (addrRows ?? [])) {
            const cid = a.customer_id as string;
            if (!addrByCustomer[cid]) addrByCustomer[cid] = [];
            addrByCustomer[cid].push(a);
          }
        }
        // Nome/taxa dos bairros p/ exibir o endereco completo direto na lista.
        const { data: neighRows } = await admin.from("delivery_neighborhoods").select("id, name, delivery_fee").eq("tenant_id", tenant_id);
        const neighMap: Record<string, { name: string; fee: number }> = {};
        for (const n of (neighRows ?? [])) neighMap[n.id as string] = { name: n.name as string, fee: Number(n.delivery_fee ?? 0) };
        return new Response(JSON.stringify({
          _v: "v14", ok: true,
          customers: customers.map((c: Record<string, unknown>) => {
            const addrs = addrByCustomer[c.id as string] ?? [];
            // Cliente antigo pode ter endereco so nas colunas do proprio cadastro
            // (antes da tabela de enderecos) — expoe como endereco sintetico.
            const legacy = (addrs.length === 0 && c.street)
              ? [{ id: null, label: "Principal", neighborhood_id: c.neighborhood_id, street: c.street, number: c.number, complement: c.complement, reference_point: c.reference_point, is_default: true, lat: null, lng: null, bairro: null }]
              : addrs;
            return {
              id: c.id, name: c.name, phone: c.phone, last_used_at: c.last_used_at,
              addresses: legacy.map((a: Record<string, unknown>) => ({
                id: a.id, label: a.label, neighborhood_id: a.neighborhood_id,
                street: a.street, number: a.number, complement: a.complement,
                reference_point: a.reference_point, is_default: a.is_default,
                lat: a.lat != null ? Number(a.lat) : null,
                lng: a.lng != null ? Number(a.lng) : null,
                bairro: a.bairro ?? (a.neighborhood_id ? (neighMap[a.neighborhood_id as string]?.name ?? null) : null),
                neighborhood_fee: a.neighborhood_id ? (neighMap[a.neighborhood_id as string]?.fee ?? 0) : 0,
              })),
            };
          }),
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // quote_delivery_fee — mesma regra do create_delivery_order (rota ORS por
      // faixa de distancia; senao, taxa do bairro). Cotacao apenas: nao grava nada.
      const { data: settingsQ } = await admin.from("system_settings").select("delivery_config").eq("tenant_id", tenant_id).maybeSingle();
      const dcQ = (settingsQ?.delivery_config ?? {}) as Record<string, any>;
      const storeLocQ = dcQ.store_location;
      const tiersQ: FaixaEntrega[] = (Array.isArray(dcQ.delivery_fee_tiers) ? dcQ.delivery_fee_tiers : [])
        .map((t: any) => ({ ate_km: Number(t.ate_km) || 0, taxa: Number(t.taxa) || 0, tempo_max_min: Number(t.tempo_max_min) || 0 }))
        .filter((t: FaixaEntrega) => t.ate_km > 0);
      const hasDistanceCfgQ = storeLocQ && typeof storeLocQ.lat === "number" && typeof storeLocQ.lng === "number" && tiersQ.length > 0;
      const qLat = (body.lat != null && body.lat !== "") ? Number(body.lat) : null;
      const qLng = (body.lng != null && body.lng !== "") ? Number(body.lng) : null;
      const hasPinQ = qLat != null && !Number.isNaN(qLat) && qLng != null && !Number.isNaN(qLng);

      if (hasDistanceCfgQ && hasPinQ) {
        const ors = await orsRoute(storeLocQ.lat, storeLocQ.lng, qLat as number, qLng as number);
        const km = ors != null ? ors.km : haversineKm(storeLocQ.lat, storeLocQ.lng, qLat as number, qLng as number) * ROAD_FACTOR;
        const routeMin = Math.round(ors != null ? ors.durationMin : (km / MOTO_KMH) * 60);
        const quote = quoteFromTiers(km, tiersQ);
        const { data: sessQ } = await admin.from("sessions").select("id").eq("tenant_id", tenant_id).eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle();
        const extraQ = prazoExtraMin(dcQ, sessQ?.id);
        const subtotalQ = Number(body.subtotal);
        const kmEstimadoQ = haversineKm(storeLocQ.lat, storeLocQ.lng, qLat as number, qLng as number) * ROAD_FACTOR;
        const gratisQ = Number.isFinite(subtotalQ) && subtotalQ > 0 && freteGratis(dcQ, subtotalQ, kmEstimadoQ);
        return new Response(JSON.stringify({
          _v: "v14", ok: true, mode: "distancia",
          fee: quote?.dentroArea && !gratisQ ? quote.taxa : 0,
          fee_faixa: quote?.dentroArea ? quote.taxa : 0,
          frete_gratis: !!gratisQ,
          km: Math.round(km * 100) / 100,
          route_min: routeMin,
          tempo_max_min: quote?.tempoMax != null ? quote.tempoMax + extraQ : null,
          prazo_extra_min: extraQ,
          dentro_area: !!quote?.dentroArea,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const qNeighId = body.neighborhood_id ? String(body.neighborhood_id) : null;
      if (qNeighId) {
        const { data: nb } = await admin.from("delivery_neighborhoods").select("id, delivery_fee, is_active").eq("tenant_id", tenant_id).eq("id", qNeighId).maybeSingle();
        if (nb && nb.is_active !== false) {
          return new Response(JSON.stringify({ _v: "v14", ok: true, mode: "bairro", fee: Number(nb.delivery_fee ?? 0), km: null, route_min: null, tempo_max_min: null, dentro_area: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
      // Sem pin e sem bairro nao ha como cotar — o caixa informa a taxa na mao.
      return new Response(JSON.stringify({ _v: "v14", ok: true, mode: "manual", fee: 0, km: null, route_min: null, tempo_max_min: null, dentro_area: true, needs_pin: !!hasDistanceCfgQ }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "validate_voucher") {
      const { tenant_id, code, order_amount } = body;
      if (!tenant_id || !code) return jsonErr("tenant_id e code obrigatorios", 400);
      const okResp = (obj: Record<string, unknown>) => new Response(JSON.stringify({ _v: "v14", ...obj }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: voucher } = await admin.from("vouchers").select("*").eq("tenant_id", tenant_id).eq("code", String(code).trim().toUpperCase()).maybeSingle();
      if (!voucher) return okResp({ valid: false, applicable_amount: 0, reason: "not_found" });
      if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) return okResp({ valid: false, applicable_amount: 0, reason: "expired" });
      if (voucher.valid_from && new Date(voucher.valid_from) > new Date()) return okResp({ valid: false, applicable_amount: 0, reason: "not_yet_valid" });
      if (voucher.status !== "active") return okResp({ valid: false, applicable_amount: 0, reason: voucher.status });
      if (voucher.voucher_type === "free_item") return okResp({ valid: false, applicable_amount: 0, reason: "free_item_indisponivel" });
      // Pedido mínimo próprio do voucher (independente do mínimo geral do delivery)
      const vMinOrder = Number(voucher.min_order_amount ?? 0);
      if (vMinOrder > 0 && Number(order_amount ?? 0) < vMinOrder) {
        return okResp({ valid: false, applicable_amount: 0, reason: "below_min_order", min_order_amount: vMinOrder });
      }
      const applicable = voucherApplicable(voucher, Number(order_amount ?? 0));
      if (applicable <= 0) return okResp({ valid: false, applicable_amount: 0, reason: "sem_desconto" });
      return okResp({ valid: true, applicable_amount: applicable, code: voucher.code, voucher_type: voucher.voucher_type });
    }

    if (action === "release_held_order") {
      // Pix confirmado: só o online-payments chama isto, com a chave interna.
      const internalKey = Deno.env.get("FISCAL_INTERNAL_KEY") ?? "";
      if (!internalKey || req.headers.get("x-internal-key") !== internalKey) return jsonErr("Unauthorized", 401);
      const { tenant_id, order_id } = body;
      if (!tenant_id || !order_id) return jsonErr("tenant_id e order_id obrigatorios", 400);
      // payment_label: o funil do iFood (ifood-shipping) libera o pedido do iFood com a forma dele.
      const label = typeof body.payment_label === "string" && body.payment_label.trim() ? body.payment_label.trim().slice(0, 80) : "PIX pelo app (PAGO)";
      // Pago pelo app: as notas passam a dizer COMO foi pago (o cliente pode ter escolhido cartão e
      // pago com Pix, ou o contrário). Só mexe em pedido "pelo app" — o iFood usa esta ação com a forma dele.
      const { data: cur } = await admin.from("orders").select("notes").eq("id", order_id).eq("tenant_id", tenant_id).maybeSingle();
      const curNotes = String(cur?.notes ?? "");
      const newNotes = /pelo app/i.test(curNotes) ? curNotes.replace(/Pagamento:\s*[^|]*?(\s*\||$)/i, `Pagamento: ${label}$1`) : null;
      const r = await releaseHeldOrder(admin, String(tenant_id), String(order_id), label, newNotes);
      if (r.error) return jsonErr(r.error, r.code ?? 400);
      return new Response(JSON.stringify({ _v: "v14", ok: true, released: !r.already, already: !!r.already }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "change_held_payment") {
      // Cliente desistiu de pagar pelo app (Pix ou cartão): escolhe outra forma (cobra na entrega/retirada)
      // e o pedido segurado vai pra cozinha agora. Prova de posse = client_request_id do aparelho.
      const { tenant_id, order_id, order_token, order_phone, payment_method, cash_amount } = body;
      if (!tenant_id || !order_id || (!order_token && !order_phone) || !payment_method) return jsonErr("Dados incompletos", 400);
      const label = String(payment_method).trim().slice(0, 40);
      if (/pelo app/i.test(label)) return jsonErr("Escolha uma forma de pagar na entrega ou na retirada", 400);
      const { data: o } = await admin.from("orders").select("id, status, is_draft, origin_type, client_request_id, destination_phone, delivery_platform, total_amount")
        .eq("id", order_id).eq("tenant_id", tenant_id).maybeSingle();
      const phoneDigits = String(order_phone ?? "").replace(/\D/g, "");
      const tokenOk = !!order_token && String(o?.client_request_id ?? "") === String(order_token);
      const phoneOk = phoneDigits.length >= 10 && String(o?.destination_phone ?? "").replace(/\D/g, "") === phoneDigits;
      if (!o || !(tokenOk || phoneOk) || o.origin_type !== "delivery") return jsonErr("Pedido não encontrado", 403);
      if (o.status !== "draft" && !o.is_draft) return jsonErr("Este pedido já foi enviado para a cozinha", 409);
      const isRetirada = o.delivery_platform === "retirada";
      const isDinheiro = /dinheiro/i.test(label);
      const troco = isDinheiro && cash_amount != null && Number(cash_amount) > 0 ? Number(cash_amount) : null;
      if (troco != null && troco < Number(o.total_amount ?? 0)) return jsonErr("O valor em dinheiro precisa cobrir o total do pedido", 400);
      const parts = ["Pagamento: " + label];
      if (isRetirada) parts.push("RETIRADA NA LOJA");
      if (troco != null) parts.push("Troco para " + fmtPrice(troco));
      const r = await releaseHeldOrder(admin, String(tenant_id), String(order_id), label, parts.join(" | "), troco);
      if (r.error) return jsonErr(r.error, r.code ?? 400);
      return new Response(JSON.stringify({ _v: "v14", ok: true, payment_method: label }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "create_delivery_order") {
      const {
        tenant_id, customer_id, customer_name, customer_phone, customer_cpf,
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
        visit_key,
      } = body;

      // CPF/CNPJ da nota: valida o digito verificador e guarda so os digitos (documento
      // invalido nao pode travar o pedido — a nota sai sem identificacao).
      const cpfNotaFiscal = (function () {
        const d = String(customer_cpf ?? "").replace(/\D/g, "");
        if (d.length !== 11 && d.length !== 14) return null;
        if (/^(\d)\1+$/.test(d)) return null;
        if (d.length === 11) {
          const calc = (len: number) => { let s2 = 0; for (let i = 0; i < len; i++) s2 += Number(d[i]) * (len + 1 - i); const r = (s2 * 10) % 11; return r === 10 ? 0 : r; };
          return (calc(9) === Number(d[9]) && calc(10) === Number(d[10])) ? d : null;
        }
        const calc = (len: number) => { const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s2 = 0; for (let i = 0; i < len; i++) s2 += Number(d[i]) * w[i]; const r = s2 % 11; return r < 2 ? 0 : 11 - r; };
        return (calc(12) === Number(d[12]) && calc(13) === Number(d[13])) ? d : null;
      })();

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
        return jsonErr("Estabelecimento não encontrado.", 404);
      }
      if (tenantCheck.is_active === false) {
        return jsonErr("Este estabelecimento não está aceitando pedidos no momento.", 403);
      }

      const cleanPhone = String(customer_phone || "").replace(/\D/g, "");
      const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60 * 1000).toISOString();

      if (cleanPhone) {
        const { count: phoneCount, error: phoneCountErr } = await admin
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant_id)
          .eq("origin_type", "delivery")
          .eq("destination_type", "delivery")
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

      const effectiveClientRequestId: string | null =
        client_request_id && typeof client_request_id === "string" && client_request_id.trim().length > 0
          ? client_request_id.trim()
          : null;

      if (!effectiveClientRequestId) {
        return jsonErr("Requisição inválida - client_request_id ausente", 400);
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

      const [menuItemsRes, combosRes, optionsRes, neighRes, settingsRes, promoRes] = await Promise.all([
        itemIds.length > 0
          ? admin.from("menu_items").select("id, name, price, is_active, delivery_config, deleted_at, category_id").eq("tenant_id", tenant_id).in("id", itemIds)
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
        // Preço promocional do Cardápio: o cardápio do cliente (CardapioMesaQR › getPrecoEfetivo)
        // mostra a promoção de hoje — o pedido cobra a mesma (mesmo filtro do get_delivery_config).
        itemIds.length > 0
          ? admin.from("item_promotions").select("item_id, promotional_price, days_of_week, is_recurring, specific_date").eq("tenant_id", tenant_id).eq("is_active", true).is("deleted_at", null).in("item_id", itemIds)
          : Promise.resolve({ data: [], error: null }) as { data: Array<Record<string, unknown>>; error: unknown },
      ]);

      if (menuItemsRes.error) throw menuItemsRes.error;
      if (combosRes.error) throw combosRes.error;
      if (optionsRes.error) throw optionsRes.error;
      if (neighRes.error) throw neighRes.error;
      if (promoRes.error) throw promoRes.error;
      // item_id → preço promocional que vale hoje em Brasília (regra única com o mesa-write).
      const promoHoje = promoPrecosDeHoje(promoRes.data as Array<Record<string, unknown>>);

      // Item apagado (deleted_at) ou de categoria apagada = indisponivel (regra do fn_get_full_menu).
      const orderCatIds = [...new Set((menuItemsRes.data as Array<Record<string, unknown>>).map((mi) => mi.category_id).filter(Boolean).map(String))];
      const { data: deletedOrderCats, error: deletedOrderCatsErr } = orderCatIds.length > 0
        ? await admin.from("menu_categories").select("id").eq("tenant_id", tenant_id).in("id", orderCatIds).not("deleted_at", "is", null)
        : { data: [], error: null };
      if (deletedOrderCatsErr) throw deletedOrderCatsErr;
      const deletedOrderCatIds = new Set(((deletedOrderCats ?? []) as Array<{ id: string }>).map((c) => String(c.id)));
      // "Acabou hoje": item pausado = indisponível (carrinho montado antes da pausa não passa).
      const pausadosPedido = await idsPausados(admin, tenant_id, itemIds);

      const itemPriceMap = new Map<string, number>();
      const itemNameMap = new Map<string, string>();
      for (const mi of menuItemsRes.data) {
        const dc = mi.delivery_config as Record<string, unknown> | null;
        const deliveryBlocked = dc && typeof dc === "object" && dc.ativo === false;
        const apagado = mi.deleted_at != null || (mi.category_id != null && deletedOrderCatIds.has(String(mi.category_id))) || pausadosPedido.has(String(mi.id));
        if (mi.is_active && !deliveryBlocked && !apagado) {
          // Usa o preço de delivery (delivery_config.preco) quando configurado (> 0).
          const precoDelivery = dc && typeof dc === "object" ? Number(dc.preco ?? 0) : 0;
          itemPriceMap.set(mi.id as string, precoDelivery > 0 ? precoDelivery : Number(mi.price ?? 0));
          itemNameMap.set(mi.id as string, mi.name as string);
        }
      }

      const comboPriceMap = new Map<string, number>();
      const comboNameMap = new Map<string, string>();
      // Combo com item que acabou hoje / desligado / apagado = indisponível, igual ao item.
      const combosTravados = await combosIndisponiveis(admin, tenant_id, comboIds);
      for (const c of combosRes.data) {
        if (c.is_active && !combosTravados.has(String(c.id))) {
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
            return jsonErr("Combo indisponível: " + (item.item_name || cid), 400);
          }
          realItemPrice = cp;
          realItemName = comboNameMap.get(cid) || realItemName;
        } else if (rawItemId && typeof rawItemId === "string" && rawItemId.trim()) {
          const iid = rawItemId.trim();
          const ip = itemPriceMap.get(iid);
          if (ip === undefined) {
            return jsonErr("Item indisponível: " + (item.item_name || iid), 400);
          }
          // Promoção de hoje SUBSTITUI o preço (inclusive o preço próprio do delivery), igual à tela.
          const promo = promoHoje.get(iid);
          realItemPrice = promo !== undefined ? promo : ip;
          realItemName = itemNameMap.get(iid) || realItemName;
        } else {
          return jsonErr("Item inválido (sem identificação)", 400);
        }

        let optionsTotal = 0;
        const serverOpts: Array<Record<string, unknown>> = [];
        const rawOpts = Array.isArray(item.options) ? item.options : [];

        for (const opt of rawOpts) {
          const oid = opt.option_id;
          // Opção sem id, de outra loja ou inativa: recusa o pedido. Antes virava preço 0
          // mantendo o nome enviado pelo cliente (adicional de graça / nome forjado).
          const op = (oid && typeof oid === "string" && oid.trim()) ? optionPriceMap.get(oid.trim()) : undefined;
          if (op === undefined) {
            return jsonErr("Opção indisponível: " + ((opt.option_name as string) || "?") + " (" + realItemName + "). Remova o item do carrinho e adicione novamente.", 400);
          }
          const realOptPrice = op;
          optionsTotal += realOptPrice;
          serverOpts.push({
            option_id: oid ?? null,
            option_name: optionNameMap.get((oid as string).trim()) || ((opt.option_name as string) ?? ""),
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
      // Pedido minimo (so entrega; retirada nao tem minimo). Antes so o app do cliente conferia (2026-10-04).
      if (!isRetirada && deliveryConfig.pedido_minimo_ativo === true) {
        const minimo = Number(deliveryConfig.pedido_minimo_valor) || 0;
        if (minimo > 0 && serverSubtotal + 0.005 < minimo) {
          return new Response(JSON.stringify({ _v: "v14", error: "O pedido mínimo para entrega é de " + fmtPrice(minimo) + ".", code: "pedido_minimo" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
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
      // Taxa da faixa antes da entrega gratis (vai para orders.delivery_fee_faixa: base do acerto "% da taxa").
      let taxaFaixa: number | null = null;
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
            message: "Endereço fora da área de entrega desta loja.",
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const kmEstimado = haversineKm(storeLoc.lat, storeLoc.lng, pinLat as number, pinLng as number) * ROAD_FACTOR;
        taxaFaixa = quote.taxa;
        serverDeliveryFee = freteGratis(deliveryConfig, serverSubtotal, kmEstimado) ? 0 : quote.taxa;
        routeTempoMax = quote.tempoMax;
      } else if (hasDistanceConfig) {
        // Loja no modo distancia (mesma decisao da tela: store_location + faixas): entrega sem pin
        // nao tem como checar area nem calcular taxa — recusa em vez de sair com taxa R$ 0.
        return jsonErr("Informe o endereço de entrega (marque o local no mapa).", 400);
      } else {
        // Modo bairro: exige bairro existente e ativo da loja (taxa dele).
        const nb = neighRes.data as Record<string, unknown> | null;
        if (!neighborhood_id || !nb || nb.is_active === false) {
          return jsonErr("Informe o endereço/bairro de entrega.", 400);
        }
        serverDeliveryFee = Number(nb.delivery_fee ?? 0);
      }

      // Voucher (opcional): valida server-side e calcula o desconto sobre o subtotal.
      // O resgate efetivo (baixa de saldo + transação) só acontece após criar o pedido.
      let voucherDiscount = 0;
      let voucherRow: Record<string, any> | null = null;
      const vCode = (typeof voucher_code === "string" && voucher_code.trim()) ? voucher_code.trim().toUpperCase() : null;
      if (vCode) {
        const { data: v } = await admin.from("vouchers").select("*").eq("tenant_id", tenant_id).eq("code", vCode).maybeSingle();
        const expirado = v?.expires_at && new Date(v.expires_at) < new Date();
        const aindaNaoVale = v?.valid_from && new Date(v.valid_from) > new Date();
        const abaixoMinimo = Number(v?.min_order_amount ?? 0) > 0 && serverSubtotal < Number(v.min_order_amount);
        if (v && v.status === "active" && !expirado && !aindaNaoVale && !abaixoMinimo && v.voucher_type !== "free_item") {
          let d = voucherApplicable(v, serverSubtotal);
          if (d > serverSubtotal) d = serverSubtotal;
          if (d > 0) { voucherDiscount = d; voucherRow = v; }
        }
      }

      // Clube de fidelidade (opcional): cartão do clube do cliente (token da página
      // /clube) + prêmios reservados. Desconto calculado AQUI com os preços do servidor;
      // prêmio vencido recusa o pedido (senão sairia com desconto sem debitar pontos).
      let clubeDiscount = 0;
      let clubeUsados: string[] = [];
      let clubeNomes: string[] = [];
      let clubeCustomerId: string | null = null;
      const holdsPedidos = idsValidos(body.loyalty_hold_ids);
      // Reenvio do MESMO pedido (resposta perdida): o prêmio já está ligado ao pedido criado —
      // não recalcula (daria "expirou"); o dedupe abaixo devolve o pedido existente.
      let pedidoJaCriado = false;
      if (holdsPedidos.length > 0 && effectiveClientRequestId) {
        const { data: ex } = await admin.from("orders").select("id").eq("client_request_id", effectiveClientRequestId).eq("tenant_id", tenant_id).maybeSingle();
        pedidoJaCriado = !!ex;
      }
      if (body.loyalty_token || holdsPedidos.length > 0) {
        const sessaoClube = body.loyalty_token ? await sessaoDoClube(admin, body.loyalty_token) : null;
        // Prêmio no carrinho com cartão vencido/de outra loja: não sai a preço cheio calado.
        if ((!sessaoClube || sessaoClube.tenant_id !== tenant_id) && holdsPedidos.length > 0 && !pedidoJaCriado) {
          return jsonErr("Sua sessão do clube acabou. Entre de novo no clube para usar o prêmio.", 409);
        }
        if (sessaoClube && sessaoClube.tenant_id === tenant_id) {
          clubeCustomerId = sessaoClube.customer_id;
          const holds = pedidoJaCriado ? [] : holdsPedidos;
          if (holds.length > 0) {
            const itensClube = serverItems.map((i) => ({ id: String(i.item_id ?? ""), preco: Number(i.item_price ?? 0), qtd: Number(i.quantity ?? 0) }));
            const dc = await descontoClubeServidor(admin, clubeCustomerId, holds, itensClube, Math.max(0, serverSubtotal - voucherDiscount));
            if (dc.invalidas > 0) return jsonErr("O prêmio do clube expirou ou já foi usado. Volte ao carrinho e escolha de novo.", 409);
            clubeDiscount = dc.desconto; clubeUsados = dc.usados; clubeNomes = dc.nomes;
          }
        }
      }

      const serverTotal = Math.max(0, serverSubtotal + serverDeliveryFee - voucherDiscount - clubeDiscount);

      let realCustomerId: string | null = null;
      // Membro do clube identificado pelo cartão: o pedido é DELE (pontos e nível), sem
      // criar/atualizar cliente pelo telefone digitado.
      if (clubeCustomerId) {
        realCustomerId = clubeCustomerId;
        // Aceite de ofertas marcado no checkout vale para o membro também (LGPD: ato explícito).
        if (body.accepts_marketing === true) {
          await admin.from("customers").update({ accepts_marketing: true, gdpr_consent_at: new Date().toISOString(), crm_opt_out_at: null }).eq("id", clubeCustomerId);
        }
      } else if (cleanPhone) {
        const { data: existingCustomers } = await admin.from("customers").select("id, name").eq("tenant_id", tenant_id).eq("phone", cleanPhone).limit(1);
        if (existingCustomers && existingCustomers.length > 0) {
          realCustomerId = existingCustomers[0].id;
          const upd: Record<string, unknown> = {};
          if (customer_name && customer_name.trim() && customer_name.trim() !== existingCustomers[0].name) upd.name = customer_name.trim();
          if (normBirth) upd.birth_date = normBirth;
          if (normGender) upd.gender = normGender;
          // Aceite de ofertas marcado no checkout (LGPD: ato explícito, com data). Desmarcado não
          // apaga aceite anterior. Marcar de novo desfaz um "SAIR" antigo — é um novo pedido dele.
          if (body.accepts_marketing === true) {
            upd.accepts_marketing = true;
            upd.gdpr_consent_at = new Date().toISOString();
            upd.crm_opt_out_at = null;
          }
          if (Object.keys(upd).length > 0) await admin.from("customers").update(upd).eq("id", realCustomerId);
        } else {
          // O nome vem do cliente — o sistema NUNCA inventa um nome. Sem nome, recusa
          // (o app já exige o nome antes de chegar aqui).
          if (!customer_name || !String(customer_name).trim()) {
            return jsonErr("Nome do cliente é obrigatório.", 400);
          }
          const { data: newCustomer } = await admin.from("customers").insert({
            tenant_id, name: String(customer_name).trim(), phone: cleanPhone,
            birth_date: normBirth, gender: normGender,
            first_visit_at: new Date().toISOString(),
            visit_count: 0, total_spent: 0,
            loyalty_points: 0, loyalty_tier: "bronze", accepts_marketing: body.accepts_marketing === true,
            gdpr_consent_at: body.accepts_marketing === true ? new Date().toISOString() : null,
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
          : gateState.reason === "pausado" ? "O delivery está pausado no momento. Tente novamente mais tarde."
          : gateState.reason === "fora_horario" ? "O delivery está fora do horário de funcionamento."
          : "O delivery está fechado no momento.";
        return new Response(JSON.stringify({ _v: "v14", error: gateMsg }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const sessionId = caixaSession!.id;
      // Dia corrido: prazo prometido maior enquanto este caixa estiver aberto.
      const extraPrazo = prazoExtraMin(dcRowForGate?.delivery_config as Record<string, any> | null, sessionId);
      if (extraPrazo > 0 && routeTempoMax != null) routeTempoMax += extraPrazo;

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

      // "PIX pelo app" / "Cartão de crédito pelo app": segura o pedido como RASCUNHO até o pagamento
      // confirmar. Só então ele entra na cozinha (release_held_order). Pagar na entrega segue direto.
      const holdUntilPaid = typeof payment_method === "string" && /pelo app/i.test(payment_method);

      const { data: order, error: orderErr } = await admin.rpc("fn_create_order_bypass", {
        order_data: {
          tenant_id, session_id: sessionId, number: orderNumber,
          status: holdUntilPaid ? "draft" : "new", origin_type: "delivery", destination_type: "delivery",
          destination_name: customer_name + " - " + (isRetirada ? "Retirada" : customer_address),
          // Normaliza para dígitos: todas as buscas (get_customer_orders, rate-limit, motoboy)
          // comparam por telefone sem máscara. Gravar formatado some do histórico do cliente.
          destination_phone: cleanPhone || null,
          customer_id: realCustomerId, discount_amount: Math.round((voucherDiscount + clubeDiscount) * 100) / 100, service_fee_amount: 0,
          // CPF/CNPJ na nota fiscal (opcional, informado pelo cliente no app).
          customer_cpf: cpfNotaFiscal,
          subtotal: serverSubtotal,
          total_amount: serverTotal,
          is_training: false, is_draft: holdUntilPaid,
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
        const { data: existingOrder } = await admin.from("orders").select("id, number, status, total_amount, delivery_fee").eq("id", orderId).eq("tenant_id", tenant_id).maybeSingle();
        // Retry do mesmo envio: só confirma se o pedido original está válido (não cancelado e com
        // itens). A 1ª requisição pode ainda estar gravando os itens — espera um pouco antes de negar.
        let existingItems = 0;
        for (let tentativa = 0; existingOrder && existingOrder.status !== "cancelled" && tentativa < 4; tentativa++) {
          const { count } = await admin.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", orderId).eq("tenant_id", tenant_id);
          existingItems = count ?? 0;
          if (existingItems > 0) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (!existingOrder || existingOrder.status === "cancelled" || existingItems === 0) {
          return jsonErr("Não foi possível registrar este pedido. Revise o carrinho e envie novamente.", 409);
        }
        return new Response(JSON.stringify({
          _v: "v14",
          data: {
            id: orderId,
            number: existingOrder?.number || orderNumber,
            total: existingOrder?.total_amount || serverTotal,
            delivery_fee: existingOrder?.delivery_fee ?? serverDeliveryFee,
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

      // Entrega gratis: guarda a taxa da faixa (o gatilho do acerto usa coalesce(delivery_fee_faixa, delivery_fee)).
      if (!isRetirada && taxaFaixa != null && taxaFaixa > 0 && serverDeliveryFee === 0) {
        const { error: ffErr } = await admin.from("orders").update({ delivery_fee_faixa: taxaFaixa }).eq("id", orderId);
        if (ffErr) console.error("[delivery-write] delivery_fee_faixa nao gravou:", orderId, ffErr.message);
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

      // Pedido que não pode seguir (itens/voucher falharam): cancela para não ficar um pedido
      // "fantasma" sem itens, e responde erro (o retry com o mesmo client_request_id também nega).
      const cancelarPedidoCriado = async (motivo: string) => {
        try {
          await admin.from("order_items").update({ status: "cancelled" }).eq("order_id", orderId).eq("tenant_id", tenant_id);
          await admin.from("orders").update({ status: "cancelled" }).eq("id", orderId).eq("tenant_id", tenant_id);
        } catch (e) {
          console.error("[delivery-write] falha ao cancelar pedido", orderId, e);
        }
        console.error("[delivery-write] pedido", orderId, "cancelado:", motivo);
      };

      const { error: itemsErr } = await admin.rpc("fn_create_order_items_bypass", {
        p_order_id: orderId, p_tenant_id: tenant_id, p_items: serverItems,
      });
      // A RPC só lança se NENHUM item entrar; falha parcial vira WARNING. Confere a contagem.
      let itensGravados = -1;
      if (!itemsErr) {
        const { count, error: cntErr } = await admin.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", orderId).eq("tenant_id", tenant_id);
        itensGravados = cntErr ? -1 : (count ?? 0);
      }
      if (itemsErr || itensGravados !== serverItems.length) {
        await cancelarPedidoCriado(itemsErr
          ? "itens: " + String((itemsErr as Record<string, unknown>).message ?? itemsErr)
          : `itens gravados ${itensGravados} de ${serverItems.length}`);
        return jsonErr("Não foi possível registrar os itens do pedido. Tente novamente.", 500);
      }

      // Resgate do voucher (baixa de saldo + transação) — só após o pedido existir.
      // Condicional (otimista): só baixa se o voucher ainda está como foi validado. Se outro
      // pedido usou antes (0 linhas), cancela este pedido — o desconto não pode sair sem baixa.
      // Clube: os prêmios reservados passam a ser deste pedido (cancelou = voltam).
      if (clubeCustomerId && clubeUsados.length > 0) {
        let ligados = 0;
        try { ligados = await vincularClube(admin, clubeCustomerId, orderId, clubeUsados); } catch (e) { console.warn("[delivery-write] clube: falha ao ligar resgate", orderId, String(e)); }
        // Não ligou todos (prêmio usado em outro pedido no meio do caminho): o pedido não
        // pode sair com o desconto sem debitar — cancela e pede de novo (igual ao voucher).
        if (ligados < clubeUsados.length) {
          await cancelarPedidoCriado("premio do clube indisponivel no resgate");
          return jsonErr("O prêmio do clube não está mais disponível. Volte ao carrinho e envie o pedido de novo.", 409);
        }
      }

      if (voucherRow && voucherDiscount > 0) {
        let resgatou = false;
        try {
          const isSaldo = voucherRow.voucher_type === "gift_card" || voucherRow.voucher_type === "cashback";
          const vMaxUses = Math.max(1, Number(voucherRow.max_uses ?? 1));
          const vNewUseCount = Number(voucherRow.use_count ?? 0) + 1;
          // Espelha o voucher-write: saldo esgota gift_card/cashback; discount consome por nº de usos.
          const newBalance = isSaldo
            ? Math.max(0, Number(voucherRow.current_balance ?? 0) - voucherDiscount)
            : (vNewUseCount >= vMaxUses ? 0 : Number(voucherRow.current_balance ?? 0));
          const newStatus = isSaldo
            ? (newBalance <= 0 ? "depleted" : "active")
            : (vNewUseCount >= vMaxUses ? "depleted" : "active");
          let upd = admin.from("vouchers").update({ current_balance: newBalance, status: newStatus, use_count: vNewUseCount })
            .eq("id", voucherRow.id).eq("tenant_id", tenant_id).eq("status", "active");
          upd = voucherRow.use_count == null ? upd.is("use_count", null) : upd.eq("use_count", voucherRow.use_count);
          upd = voucherRow.current_balance == null ? upd.is("current_balance", null) : upd.eq("current_balance", voucherRow.current_balance);
          const { data: baixados, error: vErr } = await upd.select("id");
          resgatou = !vErr && Array.isArray(baixados) && baixados.length > 0;
          if (resgatou) {
            await admin.from("voucher_transactions").insert({
              tenant_id, voucher_id: voucherRow.id, order_id: orderId,
              transaction_type: "redeemed", amount: voucherDiscount, balance_after: newBalance, processed_by: null,
            });
          }
        } catch (_e) { resgatou = false; }
        if (!resgatou) {
          await cancelarPedidoCriado("voucher " + vCode + " indisponivel no resgate");
          return jsonErr("O cupom " + vCode + " não está mais disponível. Remova o cupom e envie o pedido novamente.", 409);
        }
      }

      // Visita virou pedido: sai da fila de carrinho abandonado.
      if (visit_key) {
        const { error: convErr } = await admin.from("menu_visits")
          .update({ converted_at: new Date().toISOString(), order_id: orderId })
          .eq("tenant_id", tenant_id).eq("visit_key", String(visit_key).slice(0, 64));
        if (convErr) console.warn("[delivery-write] marcar visita convertida falhou", String(convErr.message ?? convErr));
      }

      const outputCtx: DeliveryOutputCtx = {
        tenant_id, orderId, orderNumber, serverItems,
        customer_name: customer_name ?? null, customer_address: customer_address ?? null, customer_phone: String(customer_phone || ""),
        cleanPhone, isRetirada, routeKm, routeTempoMax, serverDeliveryFee, serverSubtotal,
        voucherDiscount: Math.round((voucherDiscount + clubeDiscount) * 100) / 100,
        vCode: [vCode, clubeNomes.length ? "Clube: " + clubeNomes.join(", ") : null].filter(Boolean).join(" + ") || null,
        serverTotal, payment_method: payment_method ?? null, isDinheiro: !!isDinheiro,
        cash_amount: (cash_amount !== undefined && cash_amount !== null) ? Number(cash_amount) : null,
      };
      if (holdUntilPaid) {
        // "PIX pelo app": o pedido fica RASCUNHO (fora do KDS, do gestor e sem imprimir)
        // até o online-payments liquidar o Pix e chamar `release_held_order`.
      } else {
        await emitDeliveryOutputs(admin, outputCtx);
        // Itens sem preparo (skip_kds) não passam pelo KDS: baixa o estoque agora (Pix pelo app baixa no release).
        runStockInBackground(deductStockForSkipKdsItems(admin, tenant_id, orderId).catch((e) => console.warn("[delivery-write] baixa de estoque falhou", orderId, String(e))));
      }

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
          held: holdUntilPaid,
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
