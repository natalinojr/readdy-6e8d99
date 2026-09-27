// Funil de CRM do delivery.
//
// O que faz: diz em que estagio cada cliente esta, qual oferta a loja definiu
// pra esse estagio e quem esta elegivel a ser abordado AGORA (respeitando
// espera, cooldown, teto de frequencia e opt-out).
//
// Envio: pela tela e um clique humano (o voucher sai pela voucher-write e volta
// aqui como log, `log_send`). Automatico (2026-09-27): estagio com
// `crm_rules.auto_send` ligado (o dono confirma na tela) recebe o modelo aprovado
// na Meta pelo WhatsApp do assistente: `auto_tick`, chamado de hora em hora pelo
// cron fn_crm_auto_tick_all. Resposta do cliente (SAIR etc.): _shared/crm-auto.ts.
//
// Auth: verify_jwt = false no deploy; cada action valida o token na mao
// (mesmo padrao da delivery-write), porque o cron chama com a service key.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { CRM_TEMPLATES, graph, renderTemplate, waConfig, WaError, waSendTemplate } from "../_shared/wa.ts";
import { celularBR, FRASE_AUTO, lojaInfo } from "../_shared/crm-auto.ts";

const OWNER_EMAIL = "natalinojr.engel@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key",
};

const V = "v1";

function jsonErr(msg: string, code = 400) {
  return new Response(JSON.stringify({ _v: V, error: msg, message: msg }), {
    status: code,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ok(payload: Record<string, unknown>) {
  return new Response(JSON.stringify({ _v: V, ...payload }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fmtPhone(digits: string): string {
  const d = (digits || "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

type Stage =
  | "carrinho_abandonado"
  | "nunca_comprou"
  | "primeira_compra"
  | "recorrente"
  | "fiel"
  | "vip"
  | "em_risco"
  | "perdido";

// Ordem do funil na tela: do topo (quem acabou de chegar) ao fundo (quem sumiu).
const STAGE_ORDER: Stage[] = [
  "carrinho_abandonado",
  "nunca_comprou",
  "primeira_compra",
  "recorrente",
  "fiel",
  "vip",
  "em_risco",
  "perdido",
];

// Regras padrao de uma loja nova. Pensadas para NAO queimar margem:
// cupom so onde ele muda a decisao (quem ainda nao comprou, quem travou no
// carrinho, quem sumiu). Cliente fiel nao precisa de desconto pra continuar —
// ali o que segura e reconhecimento, entao a regra nasce sem cupom.
const REGRAS_PADRAO: Record<Stage, {
  delay_hours: number;
  voucher_type: "percentual" | "valor" | "nenhum";
  voucher_value: number;
  validade_dias: number;
  cooldown_days: number;
  mensagem: string;
}> = {
  carrinho_abandonado: {
    delay_hours: 2,
    voucher_type: "percentual",
    voucher_value: 10,
    validade_dias: 3,
    cooldown_days: 15,
    mensagem: "Oi, {nome}! Vi que você montou um pedido e não finalizou 😅 Se ficou faltando um empurrãozinho, usa esse cupom: {cupom} — {link}",
  },
  nunca_comprou: {
    delay_hours: 48,
    voucher_type: "percentual",
    voucher_value: 15,
    validade_dias: 7,
    cooldown_days: 30,
    mensagem: "Oi, {nome}! Você se cadastrou no nosso delivery mas ainda não experimentou a gente. Separei {cupom} pra sua estreia: {link}",
  },
  primeira_compra: {
    delay_hours: 72,
    voucher_type: "percentual",
    voucher_value: 10,
    validade_dias: 10,
    cooldown_days: 60,
    mensagem: "Oi, {nome}! Que bom ter você com a gente 🙌 Pra sua próxima: {cupom} — {link}",
  },
  recorrente: {
    delay_hours: 0,
    voucher_type: "nenhum",
    voucher_value: 0,
    validade_dias: 7,
    cooldown_days: 30,
    mensagem: "Oi, {nome}! Você já é de casa 😄 Chegou novidade no cardápio da {loja}, dá uma olhada!",
  },
  fiel: {
    delay_hours: 0,
    voucher_type: "nenhum",
    voucher_value: 0,
    validade_dias: 7,
    cooldown_days: 60,
    mensagem: "Oi, {nome}! Obrigado por pedir sempre com a gente 🧡 Qualquer coisa que precisar, é só chamar aqui.",
  },
  vip: {
    delay_hours: 0,
    voucher_type: "nenhum",
    voucher_value: 0,
    validade_dias: 7,
    cooldown_days: 90,
    mensagem: "Oi, {nome}! Você é um dos nossos clientes mais especiais 🧡 Guardei uma novidade pra você provar antes de todo mundo.",
  },
  em_risco: {
    delay_hours: 0,
    voucher_type: "percentual",
    voucher_value: 15,
    validade_dias: 7,
    cooldown_days: 45,
    mensagem: "Oi, {nome}! Faz um tempinho que você não pede com a gente e a gente sentiu falta 😊 Toma {cupom}: {link}",
  },
  perdido: {
    delay_hours: 0,
    voucher_type: "percentual",
    voucher_value: 20,
    validade_dias: 10,
    cooldown_days: 90,
    mensagem: "Oi, {nome}! Já faz um bom tempo... Mudou muita coisa por aqui e queria muito te ver de volta: {cupom} — {link}",
  },
};

const ROTULOS: Record<Stage, { label: string; desc: string }> = {
  carrinho_abandonado: { label: "Carrinho abandonado", desc: "Montou o pedido e não finalizou" },
  nunca_comprou: { label: "Cadastrou, nunca pediu", desc: "Deixou o celular e não comprou" },
  primeira_compra: { label: "Comprou 1 vez", desc: "A 2ª compra é onde mais se perde gente" },
  recorrente: { label: "Recorrente", desc: "2 a 5 pedidos, dentro do ritmo" },
  fiel: { label: "Fiel", desc: "6 ou mais pedidos, ativo" },
  vip: { label: "VIP", desc: "Fiel e no topo de gasto da loja" },
  em_risco: { label: "Em risco", desc: "Sumiu além do ritmo dele" },
  perdido: { label: "Perdido", desc: "Sem pedir há mais de 90 dias" },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const tenantId = body.tenant_id ? String(body.tenant_id) : "";
    if (!action) return jsonErr("action obrigatoria", 400);
    if (!tenantId) return jsonErr("tenant_id obrigatorio", 400);

    // ── Quem pode chamar ──────────────────────────────────────────────────────
    // Usuario logado: precisa ser membro DESTA loja (RLS por auth_tenant_id()
    // não serve: dono multi-loja tem várias memberships).
    // Cron/chamada interna: header x-internal-key (mesmo padrão do assistente) ou
    // o bearer igual à service key. Comparar com a service key sozinho não basta:
    // o projeto tem chave legada (JWT) e chave nova (sb_secret) e nem sempre é a
    // mesma que chega aqui.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const internalKey = Deno.env.get("CRM_INTERNAL_KEY") ?? "";
    const xKey = req.headers.get("x-internal-key") ?? "";
    const isCron = (internalKey.length >= 20 && xKey === internalKey) || (!!serviceKey && token === serviceKey);

    let userId: string | null = null;
    let userEmail = "";
    if (!isCron) {
      if (!token) return jsonErr("Não autenticado", 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessão inválida", 401);
      userId = userData.user.id;
      userEmail = String(userData.user.email ?? "").toLowerCase();
      const { data: membership } = await admin
        .from("user_tenants").select("role")
        .eq("user_id", userId).eq("tenant_id", tenantId).limit(1).maybeSingle();
      if (!membership) return jsonErr("Sem acesso a esta loja.", 403);
      // Escrita de configuração é só de admin.
      if ((action === "save_rules" || action === "auto_tick") && membership.role !== "admin") {
        return jsonErr("Só o admin da loja altera as regras do funil.", 403);
      }
    }

    // ── Regras da loja (cria as padrão na primeira vez) ────────────────────────
    async function carregarRegras() {
      const { data: existentes, error } = await admin
        .from("crm_rules").select("*").eq("tenant_id", tenantId);
      if (error) throw error;
      const porEstagio = new Map<string, Record<string, unknown>>();
      for (const r of existentes ?? []) porEstagio.set(String(r.stage), r);

      const faltando = STAGE_ORDER.filter((s) => !porEstagio.has(s));
      if (faltando.length > 0) {
        const novas = faltando.map((s) => ({ tenant_id: tenantId, stage: s, enabled: false, auto_send: false, ...REGRAS_PADRAO[s] }));
        // upsert, nao insert: duas chamadas simultaneas (a tela abre e recalcula
        // em paralelo) tentavam criar as mesmas regras e a segunda estourava
        // crm_rules_stage_uk.
        const { error: insErr } = await admin
          .from("crm_rules")
          .upsert(novas, { onConflict: "tenant_id,stage", ignoreDuplicates: true });
        if (insErr) throw insErr;
        const { data: todas, error: reErr } = await admin
          .from("crm_rules").select("*").eq("tenant_id", tenantId);
        if (reErr) throw reErr;
        for (const r of todas ?? []) porEstagio.set(String(r.stage), r);
      }
      return STAGE_ORDER.map((s) => porEstagio.get(s)!);
    }

    // Cortes do funil. Espelham os defaults das colunas de crm_stage_criteria:
    // a loja que nunca configurou continua com o comportamento de sempre.
    const CRITERIOS_PADRAO = {
      carrinho_horas: 72,
      perdido_dias: 90,
      risco_multiplicador: 1.5,
      risco_min_dias: 21,
      ciclo_padrao_dias: 30,
      fiel_min_pedidos: 6,
      vip_min_pedidos: 6,
      vip_percentil: 0.9,
      vip_min_gasto: 0,
    };

    async function carregarCriterios() {
      const { data: row } = await admin
        .from("crm_stage_criteria").select("*").eq("tenant_id", tenantId).maybeSingle();
      // Sem linha: devolve os padroes (nao cria nada — loja que nunca mexeu
      // continua acompanhando qualquer mudanca futura de default).
      return row ?? { tenant_id: tenantId, ...CRITERIOS_PADRAO };
    }

    async function carregarSettings() {
      const { data: row } = await admin.from("crm_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (row) return row;
      const { error } = await admin
        .from("crm_settings")
        .upsert({ tenant_id: tenantId }, { onConflict: "tenant_id", ignoreDuplicates: true });
      if (error) throw error;
      const { data: criada } = await admin
        .from("crm_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
      return criada;
    }

    // ── Visão geral do funil ──────────────────────────────────────────────────
    if (action === "overview") {
      // Recalcula na abertura: o funil sempre reflete os pedidos de hoje.
      const { error: recErr } = await admin.rpc("fn_crm_recompute_stages", { p_tenant_id: tenantId });
      if (recErr) throw recErr;

      const regras = await carregarRegras();
      const settings = await carregarSettings();

      const { data: linhas, error: stErr } = await admin
        .from("crm_customer_stage")
        .select("stage, total_spent, orders_count")
        .eq("tenant_id", tenantId);
      if (stErr) throw stErr;

      const resumo = new Map<string, { clientes: number; gasto: number }>();
      for (const s of STAGE_ORDER) resumo.set(s, { clientes: 0, gasto: 0 });
      for (const l of linhas ?? []) {
        const atual = resumo.get(String(l.stage));
        if (!atual) continue;
        atual.clientes += 1;
        atual.gasto += Number(l.total_spent ?? 0);
      }

      // Retorno das mensagens: quem recebeu e pediu depois. Fecha os sends
      // pendentes de uma vez (poucos registros; roda junto com a tela).
      const desde = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const { data: sends } = await admin
        .from("crm_sends")
        .select("id, customer_id, stage, sent_at, converted_at")
        .eq("tenant_id", tenantId)
        .eq("status", "sent")
        .gte("sent_at", desde);

      const pendentes = (sends ?? []).filter((s) => !s.converted_at);
      if (pendentes.length > 0) {
        const ids = Array.from(new Set(pendentes.map((s) => String(s.customer_id))));
        const { data: pedidos } = await admin
          .from("orders")
          .select("id, customer_id, created_at")
          .eq("tenant_id", tenantId)
          .in("customer_id", ids)
          .neq("status", "cancelled")
          .eq("is_training", false)
          .gte("created_at", desde);
        for (const p of pendentes) {
          const doCliente = (pedidos ?? []).filter((o) =>
            String(o.customer_id) === String(p.customer_id) && String(o.created_at) > String(p.sent_at)
          );
          if (doCliente.length === 0) continue;
          doCliente.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
          const primeiro = doCliente[0];
          await admin.from("crm_sends")
            .update({ converted_at: primeiro.created_at, order_id: primeiro.id })
            .eq("id", p.id);
          p.converted_at = String(primeiro.created_at);
        }
      }

      const desempenho = new Map<string, { enviados: number; converteu: number }>();
      for (const s of STAGE_ORDER) desempenho.set(s, { enviados: 0, converteu: 0 });
      for (const s of sends ?? []) {
        const d = desempenho.get(String(s.stage));
        if (!d) continue;
        d.enviados += 1;
        if (s.converted_at) d.converteu += 1;
      }

      return ok({
        stages: STAGE_ORDER.map((s) => ({
          stage: s,
          label: ROTULOS[s].label,
          desc: ROTULOS[s].desc,
          clientes: resumo.get(s)?.clientes ?? 0,
          gasto: Number((resumo.get(s)?.gasto ?? 0).toFixed(2)),
          enviados: desempenho.get(s)?.enviados ?? 0,
          converteu: desempenho.get(s)?.converteu ?? 0,
        })),
        rules: regras,
        settings,
        criteria: await carregarCriterios(),
        criteria_padrao: CRITERIOS_PADRAO,
      });
    }

    // ── Quem de um estágio pode ser abordado agora (tela e envio automático) ──
    // Mesma regra nos dois caminhos: espera da regra, cooldown, teto semanal e
    // opt-out. Só envio que SAIU conta (falha do automático não trava ninguém).
    async function avaliarEstagio(
      stage: Stage,
      regras: Array<Record<string, unknown>>,
      settings: Record<string, unknown>,
    ) {
      const regra = regras.find((r) => String(r!.stage) === stage)!;

      const { data: linhas, error: stErr } = await admin
        .from("crm_customer_stage")
        .select("customer_id, stage, entered_at, orders_count, total_spent, last_order_at, days_since_last, avg_cycle_days")
        .eq("tenant_id", tenantId)
        .eq("stage", stage)
        .order("total_spent", { ascending: false })
        .limit(500);
      if (stErr) throw stErr;

      const ids = (linhas ?? []).map((l) => String(l.customer_id));
      if (ids.length === 0) return { clientes: [], regra };

      const { data: cadastros } = await admin
        .from("customers")
        .select("id, name, phone, accepts_marketing, last_contacted_at, crm_opt_out_at")
        .eq("tenant_id", tenantId)
        .in("id", ids);
      const porId = new Map<string, Record<string, unknown>>();
      for (const c of cadastros ?? []) porId.set(String(c.id), c);

      // Histórico de abordagens: cooldown da regra + teto de frequência.
      const janelaSemana = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: sends } = await admin
        .from("crm_sends")
        .select("customer_id, stage, sent_at")
        .eq("tenant_id", tenantId)
        .eq("status", "sent")
        .in("customer_id", ids)
        .order("sent_at", { ascending: false })
        .limit(2000);

      const ultimoPorEstagio = new Map<string, string>();
      const naSemana = new Map<string, number>();
      for (const s of sends ?? []) {
        const chave = String(s.customer_id) + "|" + String(s.stage);
        if (!ultimoPorEstagio.has(chave)) ultimoPorEstagio.set(chave, String(s.sent_at));
        if (String(s.sent_at) >= janelaSemana) {
          naSemana.set(String(s.customer_id), (naSemana.get(String(s.customer_id)) ?? 0) + 1);
        }
      }

      const delayMs = Number(regra!.delay_hours ?? 0) * 60 * 60 * 1000;
      const cooldownMs = Number(regra!.cooldown_days ?? 0) * 24 * 60 * 60 * 1000;
      const tetoSemana = Number(settings!.max_msgs_por_semana ?? 1);
      const agora = Date.now();

      const clientes = (linhas ?? []).map((l) => {
        const cad = porId.get(String(l.customer_id));
        const phone = String(cad?.phone ?? "");
        const entrou = new Date(String(l.entered_at)).getTime();
        const ultimoMesmoEstagio = ultimoPorEstagio.get(String(l.customer_id) + "|" + stage);

        // Por que NÃO pode ser abordado agora (a tela mostra o motivo).
        let bloqueio: string | null = null;
        if (!phone) bloqueio = "sem telefone";
        // Só recusa EXPLÍCITA bloqueia. `accepts_marketing` nasce false no cadastro
        // do delivery e não significa "não quero" — usar isso travaria a loja toda.
        // (O envio AUTOMÁTICO tem a trava própria crm_settings.auto_so_optin.)
        else if (cad?.crm_opt_out_at) bloqueio = "pediu para não receber";
        else if (agora - entrou < delayMs) bloqueio = "ainda na espera da regra";
        else if (ultimoMesmoEstagio && (agora - new Date(ultimoMesmoEstagio).getTime()) < cooldownMs) bloqueio = "já abordado (cooldown)";
        else if ((naSemana.get(String(l.customer_id)) ?? 0) >= tetoSemana) bloqueio = "teto de mensagens da semana";

        return {
          customer_id: String(l.customer_id),
          nome: String(cad?.name ?? "Cliente"),
          phone,
          phone_fmt: phone ? fmtPhone(phone) : "",
          orders_count: Number(l.orders_count ?? 0),
          total_spent: Number(l.total_spent ?? 0),
          last_order_at: l.last_order_at,
          days_since_last: l.days_since_last,
          avg_cycle_days: l.avg_cycle_days,
          entered_at: l.entered_at,
          ultimo_contato: cad?.last_contacted_at ?? null,
          aceita_marketing: cad?.accepts_marketing === true,
          pode_abordar: bloqueio === null,
          bloqueio,
        };
      });

      return { clientes, regra };
    }

    // ── Lista de um estágio, já dizendo quem pode ser abordado ────────────────
    if (action === "list_stage") {
      const stage = String(body.stage ?? "") as Stage;
      if (!STAGE_ORDER.includes(stage)) return jsonErr("estagio invalido", 400);
      const regras = await carregarRegras();
      const settings = await carregarSettings();
      const { clientes, regra } = await avaliarEstagio(stage, regras, settings!);
      return ok({ clientes, rule: regra, settings });
    }

    // ── Salvar regras / limites / criterios ───────────────────────────────────
    if (action === "save_rules") {
      const { rules, settings, criteria } = body as {
        rules?: Array<Record<string, unknown>>;
        settings?: Record<string, unknown>;
        criteria?: Record<string, unknown>;
      };
      const antes = await carregarRegras(); // garante que as linhas existem
      const autoAntes = new Map(antes.map((r) => [String(r!.stage), r!.auto_send === true]));

      const tetoDesconto = Number(settings?.desconto_max_percent ?? 25) || 25;

      for (const r of rules ?? []) {
        const stage = String(r.stage ?? "");
        if (!STAGE_ORDER.includes(stage as Stage)) continue;
        const tipo = ["percentual", "valor", "nenhum"].includes(String(r.voucher_type)) ? String(r.voucher_type) : "nenhum";
        let valor = Math.max(0, Number(r.voucher_value ?? 0) || 0);
        // Trava de margem: desconto em % nunca passa do teto da loja.
        if (tipo === "percentual") valor = Math.min(valor, tetoDesconto);
        // Envio automático só com a oferta ligada. Ligar grava quem e quando (a tela
        // pede confirmação antes); desligar é imediato.
        // Tela antiga (carregou auto_send diferente do que está no banco agora): mantém o banco.
        const desatualizada = typeof r.auto_send_antes === "boolean" && r.auto_send_antes !== autoAntes.get(stage);
        const autoNovo = r.enabled === true && (desatualizada ? autoAntes.get(stage) === true : r.auto_send === true);
        const ligouAgora = autoNovo && !autoAntes.get(stage);
        const { error: updErr } = await admin.from("crm_rules").update({
          enabled: r.enabled === true,
          auto_send: autoNovo,
          ...(ligouAgora ? { auto_ligado_em: new Date().toISOString(), auto_ligado_por: userId } : {}),
          delay_hours: Math.max(0, Number(r.delay_hours ?? 24) || 0),
          voucher_type: tipo,
          voucher_value: valor,
          validade_dias: Math.min(90, Math.max(1, Number(r.validade_dias ?? 7) || 7)),
          mensagem: typeof r.mensagem === "string" ? r.mensagem.slice(0, 1000) : null,
          cooldown_days: Math.min(365, Math.max(0, Number(r.cooldown_days ?? 30) || 0)),
          updated_at: new Date().toISOString(),
        }).eq("tenant_id", tenantId).eq("stage", stage);
        if (updErr) throw updErr;
      }

      if (settings) {
        const { error: setErr } = await admin.from("crm_settings").update({
          max_msgs_por_semana: Math.min(7, Math.max(1, Number(settings.max_msgs_por_semana ?? 1) || 1)),
          hora_inicio: Math.min(23, Math.max(0, Number(settings.hora_inicio ?? 10) || 0)),
          hora_fim: Math.min(23, Math.max(0, Number(settings.hora_fim ?? 21) || 0)),
          desconto_max_percent: Math.min(90, Math.max(0, tetoDesconto)),
          ...(settings.max_auto_por_dia !== undefined
            // 25 por rodada × ~10 rodadas no horário: acima de 250 não se alcança.
            ? { max_auto_por_dia: Math.min(250, Math.max(0, Math.round(Number(settings.max_auto_por_dia) || 0))) }
            : {}),
          ...(settings.auto_so_optin !== undefined ? { auto_so_optin: settings.auto_so_optin !== false } : {}),
          updated_at: new Date().toISOString(),
        }).eq("tenant_id", tenantId);
        if (setErr) throw setErr;
      }

      // Cortes do funil. Os limites repetem os CHECKs da tabela de proposito:
      // valor fora da faixa vira o mais proximo valido em vez de estourar 500.
      if (criteria) {
        const num = (v: unknown, def: number) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : def;
        };
        const faixa = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

        const perdidoDias = faixa(Math.round(num(criteria.perdido_dias, 90)), 30, 365);
        let riscoMinDias = faixa(Math.round(num(criteria.risco_min_dias, 21)), 3, 180);
        // "Perdido" tem que vir depois de "em risco" (constraint crm_criteria_ordem):
        // se o dono apertar os dois, o piso do risco cede.
        if (riscoMinDias >= perdidoDias) riscoMinDias = perdidoDias - 1;

        const linha = {
          tenant_id: tenantId,
          carrinho_horas: faixa(Math.round(num(criteria.carrinho_horas, 72)), 1, 720),
          perdido_dias: perdidoDias,
          risco_multiplicador: Number(faixa(num(criteria.risco_multiplicador, 1.5), 1, 5).toFixed(2)),
          risco_min_dias: riscoMinDias,
          ciclo_padrao_dias: faixa(Math.round(num(criteria.ciclo_padrao_dias, 30)), 1, 120),
          fiel_min_pedidos: faixa(Math.round(num(criteria.fiel_min_pedidos, 6)), 2, 50),
          vip_min_pedidos: faixa(Math.round(num(criteria.vip_min_pedidos, 6)), 1, 50),
          vip_percentil: Number(faixa(num(criteria.vip_percentil, 0.9), 0.5, 0.999).toFixed(3)),
          vip_min_gasto: Math.max(0, num(criteria.vip_min_gasto, 0)),
          updated_at: new Date().toISOString(),
        };
        const { error: critErr } = await admin
          .from("crm_stage_criteria").upsert(linha, { onConflict: "tenant_id" });
        if (critErr) throw critErr;

        // Mudou o corte, muda quem esta em cada estagio: recalcula na hora para
        // a tela ja mostrar o efeito.
        const { error: recErr } = await admin.rpc("fn_crm_recompute_stages", { p_tenant_id: tenantId });
        if (recErr) throw recErr;
      }

      return ok({
        rules: await carregarRegras(),
        settings: await carregarSettings(),
        criteria: await carregarCriterios(),
      });
    }

    // ── Envio automático pelo WhatsApp do assistente ─────────────────────────
    // Cron (fn_crm_auto_tick_all, de hora em hora) chama com a chave interna e
    // envia de verdade. O admin da loja chama com dry_run para ver a fila
    // ("quem receberia agora") antes de ligar — da tela nunca sai mensagem.
    if (action === "auto_tick") {
      const dry = !isCron || body.dry_run === true;
      const settings = (await carregarSettings())!;
      const regras = await carregarRegras();
      // Prévia de um estágio que ainda vai ser ligado: a tela manda `estagios`.
      const pedidos = Array.isArray(body.estagios) ? (body.estagios as unknown[]).map(String) : null;
      const ligadas = new Set(
        regras.filter((r) => r!.enabled === true && (dry && pedidos ? pedidos.includes(String(r!.stage)) : r!.auto_send === true))
          .map((r) => String(r!.stage)),
      );

      // Hora e dia de Brasília (o servidor roda em UTC).
      const agoraBR = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const hora = agoraBR.getUTCHours();
      const hojeBR = agoraBR.toISOString().slice(0, 10);
      const ini = Number(settings.hora_inicio ?? 10);
      const fim = Number(settings.hora_fim ?? 21);
      // Início = fim fecha o automático (na tela manual é "sem restrição"; marketing às 3 h, não).
      const dentroDoHorario = ini !== fim && (ini < fim ? hora >= ini && hora < fim : hora >= ini || hora < fim);

      const { count: jaHoje } = await admin
        .from("crm_sends").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("auto", true).eq("status", "sent")
        .gte("sent_at", `${hojeBR}T00:00:00-03:00`);
      const restante = Math.max(0, Number(settings.max_auto_por_dia ?? 30) - (jaHoje ?? 0));

      if (ligadas.size === 0) return ok({ enviados: 0, motivo: "nenhum estágio com envio automático", fila: [], total: 0 });
      if (!dry && !dentroDoHorario) return ok({ enviados: 0, motivo: "fora do horário da loja" });
      if (!dry && restante === 0) return ok({ enviados: 0, motivo: "teto diário atingido" });

      const { error: recErr } = await admin.rpc("fn_crm_recompute_stages", { p_tenant_id: tenantId });
      if (recErr) throw recErr;

      // No máximo LOTE envios por rodada (o cron roda de hora em hora): a função não passa do
      // tempo limite e o teto do dia se espalha pelo horário da loja.
      const LOTE = 25;
      // Quem precisa mais primeiro: carrinho e 2ª compra esfriam rápido.
      const PRIORIDADE: Stage[] = ["carrinho_abandonado", "primeira_compra", "em_risco", "nunca_comprou", "perdido", "recorrente", "fiel", "vip"];
      const soOptin = settings.auto_so_optin !== false;
      const loja = await lojaInfo(admin, tenantId);
      const semana = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      // Falhou no automático nos últimos 7 dias (número sem WhatsApp etc.): fica fora, senão
      // volta toda hora no topo da fila, trava o lote e cria/cancela voucher a cada rodada.
      const { data: falhas7 } = await admin.from("crm_sends").select("customer_id")
        .eq("tenant_id", tenantId).eq("auto", true).eq("status", "failed").gte("sent_at", semana);
      const falhouRecente = new Set((falhas7 ?? []).map((x) => String(x.customer_id)));

      // O número que envia é um só para todas as lojas: o mesmo celular não recebe duas
      // mensagens automáticas na semana, venham de que loja vierem.
      const { data: autoSemana } = await admin.from("crm_sends").select("customer_id")
        .eq("auto", true).eq("status", "sent").gte("sent_at", semana).limit(5000);
      const celularesSemana = new Set<string>();
      const idsSemana = Array.from(new Set((autoSemana ?? []).map((x) => String(x.customer_id))));
      for (let i = 0; i < idsSemana.length; i += 200) {
        const { data: tel } = await admin.from("customers").select("phone").in("id", idsSemana.slice(i, i + 200));
        for (const t of tel ?? []) { const cc = celularBR(t.phone); if (cc) celularesSemana.add(cc); }
      }

      const fila: Array<{ stage: Stage; regra: Record<string, unknown>; c: Record<string, unknown>; cel: string }> = [];
      const jaNaFila = new Set<string>();
      let semOptin = 0;
      let semCelular = 0;
      let semLink = 0;
      let outraLoja = 0;
      for (const stage of PRIORIDADE) {
        if (!ligadas.has(stage)) continue;
        const { clientes, regra } = await avaliarEstagio(stage, regras, settings);
        const semCupom = !(regra!.voucher_type !== "nenhum" && Number(regra!.voucher_value) > 0);
        for (const c of clientes) {
          if (!c.pode_abordar || jaNaFila.has(c.customer_id) || falhouRecente.has(c.customer_id)) continue;
          const cel = celularBR(c.phone);
          if (!cel) { semCelular++; continue; }
          if (soOptin && !c.aceita_marketing) { semOptin++; continue; }
          if (semCupom && !loja.deliveryUrl) { semLink++; continue; }
          if (celularesSemana.has(cel)) { outraLoja++; continue; }
          jaNaFila.add(c.customer_id);
          celularesSemana.add(cel);
          fila.push({ stage, regra: regra!, c, cel });
        }
      }
      if (dry) {
        return ok({
          dry_run: true,
          fila: fila.slice(0, 200).map((f) => ({ stage: f.stage, customer_id: f.c.customer_id, nome: f.c.nome, phone_fmt: f.c.phone_fmt })),
          total: fila.length, restante_hoje: restante, ja_hoje: jaHoje ?? 0, dentro_do_horario: dentroDoHorario,
          sem_optin: semOptin, sem_celular: semCelular, so_optin: soOptin, sem_link_delivery: !loja.deliveryUrl,
          sem_link: semLink, ja_abordados_por_outra_loja: outraLoja, lote_por_rodada: LOTE,
        });
      }

      const cfg = await waConfig(admin);
      if (cfg.transport !== "cloud") return jsonErr("WhatsApp do assistente não está na API oficial", 500);

      const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
      const primeiroNome = (n: unknown) => String(n ?? "").trim().split(/\s+/)[0] || "tudo bem";
      const ALFA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const bloco = (b: Uint8Array) => Array.from(b, (x) => ALFA[x % ALFA.length]).join("");
      let enviados = 0;
      let falhas = 0;
      let parouPor: string | null = null;

      for (const f of fila.slice(0, Math.min(restante, LOTE))) {
        const temCupom = f.regra.voucher_type !== "nenhum" && Number(f.regra.voucher_value) > 0;
        let voucherId: string | null = null;
        let registroId: string | null = null;
        let nomeModelo = "";
        let params: string[] = [];
        try {
          if (temCupom) {
            const dias = Math.min(90, Math.max(1, Number(f.regra.validade_dias ?? 7) || 7));
            const fimIso = new Date(agoraBR.getTime() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            const valor = Number(f.regra.voucher_value);
            const percent = f.regra.voucher_type === "percentual";
            const token = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
            let code = "";
            for (let i = 0; i < 5 && !code; i++) {
              const r = crypto.getRandomValues(new Uint8Array(8));
              const cand = `DC-${bloco(r.slice(0, 4))}-${bloco(r.slice(4))}`;
              const { data: existe } = await admin.from("vouchers").select("id").eq("tenant_id", tenantId).eq("code", cand).maybeSingle();
              if (!existe) code = cand;
            }
            if (!code) throw new Error("não gerou código de voucher");
            const { data: v, error: vErr } = await admin.from("vouchers").insert({
              tenant_id: tenantId, code, voucher_type: "discount",
              original_amount: valor, current_balance: valor,
              discount_type: percent ? "percent" : "fixed", discount_value: valor,
              expires_at: `${fimIso}T23:59:59-03:00`, max_uses: 1, claim_token: token, status: "active",
              customer_id: f.c.customer_id, customer_name: f.c.nome,
              notes: `Funil automático: ${ROTULOS[f.stage].label}`,
            }).select("id").single();
            if (vErr) throw vErr;
            voucherId = String(v.id);
            await admin.from("voucher_transactions").insert({
              tenant_id: tenantId, voucher_id: voucherId, transaction_type: "issued", amount: valor, balance_after: valor,
            });
            nomeModelo = CRM_TEMPLATES.oferta.name;
            const oferta = percent ? `${valor}% de desconto` : `R$ ${valor.toFixed(2).replace(".", ",")} de desconto`;
            params = [primeiroNome(f.c.nome), loja.nome, FRASE_AUTO[f.stage], oferta, ddmm(fimIso), `${loja.appUrl}/voucher/${token}`];
          } else {
            if (!loja.deliveryUrl) throw new Error("loja sem link do delivery (slug)");
            nomeModelo = CRM_TEMPLATES.contato.name;
            params = [primeiroNome(f.c.nome), loja.nome, FRASE_AUTO[f.stage], loja.deliveryUrl];
          }

          // Registra ANTES de mandar: se a função morrer entre a Meta aceitar e o registro, o
          // cliente não recebe de novo na hora seguinte (prefere-se perder um envio a duplicar).
          const { data: reg, error: regErr } = await admin.from("crm_sends").insert({
            tenant_id: tenantId, customer_id: f.c.customer_id, rule_id: f.regra.id ?? null, stage: f.stage,
            channel: "whatsapp", voucher_id: voucherId, message: renderTemplate(nomeModelo, params).slice(0, 1000),
            auto: true, status: "sent",
          }).select("id").single();
          if (regErr || !reg) {
            if (voucherId) await admin.from("vouchers").update({ status: "cancelled" }).eq("id", voucherId);
            parouPor = "não consegui registrar o envio: " + (regErr?.message ?? "sem id");
            break;
          }
          registroId = String(reg.id);
          const msgId = await waSendTemplate(cfg, "55" + f.cel, nomeModelo, params, "pt_BR", "crm");
          await admin.from("crm_sends").update({ wa_msg_id: msgId }).eq("id", registroId);
          await admin.from("customers").update({ last_contacted_at: new Date().toISOString() })
            .eq("tenant_id", tenantId).eq("id", f.c.customer_id);
          enviados++;
        } catch (e) {
          falhas++;
          const erro = e instanceof Error ? e.message : String(e);
          if (voucherId) await admin.from("vouchers").update({ status: "cancelled" }).eq("id", voucherId);
          if (registroId) {
            await admin.from("crm_sends").update({ status: "failed", error: erro.slice(0, 500) }).eq("id", registroId);
          } else {
            await admin.from("crm_sends").insert({
              tenant_id: tenantId, customer_id: f.c.customer_id, rule_id: f.regra.id ?? null, stage: f.stage,
              channel: "whatsapp", auto: true, status: "failed", error: erro.slice(0, 500),
            });
          }
          const code = e instanceof WaError ? e.code : null;
          // 131050: a pessoa parou de receber marketing de empresas no próprio WhatsApp — vale como SAIR.
          if (code === 131050) {
            await admin.from("customers").update({ crm_opt_out_at: new Date().toISOString() })
              .eq("tenant_id", tenantId).eq("id", f.c.customer_id).is("crm_opt_out_at", null);
          }
          // Modelo não aprovado/pausado, token ou número bloqueado: não adianta tentar os próximos.
          if ((code && ((code >= 132000 && code <= 132016) || code === 190 || code === 131031 || code === 368)) || /não configurado|API oficial/.test(erro)) {
            // Falha geral, não do cliente: tira o registro para ele não ficar 7 dias fora da fila
            // (o erro fica em crm_settings.auto_ultimo_erro, que a tela mostra).
            if (registroId) await admin.from("crm_sends").delete().eq("id", registroId);
            else await admin.from("crm_sends").delete().eq("tenant_id", tenantId).eq("customer_id", f.c.customer_id)
              .eq("auto", true).eq("status", "failed").gte("sent_at", new Date(Date.now() - 60_000).toISOString());
            parouPor = erro;
            break;
          }
        }
      }

      await admin.from("crm_settings").update(
        parouPor || falhas > 0
          ? { auto_ultimo_erro: (parouPor ?? `${falhas} envio(s) falharam`).slice(0, 500), auto_ultimo_erro_em: new Date().toISOString() }
          : { auto_ultimo_erro: null, auto_ultimo_erro_em: null },
      ).eq("tenant_id", tenantId);

      return ok({ enviados, falhas, parou_por: parouPor, na_fila: fila.length });
    }

    // ── Modelos da Meta usados pelo envio automático ─────────────────────────
    if (action === "templates_status") {
      const cfg = await waConfig(admin);
      const nomes = Object.values(CRM_TEMPLATES).map((t) => t.name as string);
      if (!cfg.waba_id) return ok({ modelos: [], erro: "WhatsApp do assistente sem waba_id", pode_enviar: false });
      try {
        const out = await graph(`${cfg.waba_id}/message_templates?fields=name,status,category,rejected_reason&limit=200`);
        const achados = ((out?.data ?? []) as Array<Record<string, unknown>>).filter((t) => nomes.includes(String(t.name)));
        return ok({
          modelos: nomes.map((n) => {
            const t = achados.find((x) => String(x.name) === n);
            return { name: n, status: t ? String(t.status) : "NAO_ENVIADO", category: t?.category ?? null, rejected_reason: t?.rejected_reason ?? null };
          }),
          pode_enviar: userEmail === OWNER_EMAIL,
        });
      } catch (e) {
        return ok({ modelos: [], erro: e instanceof Error ? e.message : String(e), pode_enviar: userEmail === OWNER_EMAIL });
      }
    }

    // Submeter os modelos à Meta: o número é um só para todas as lojas, então só o dono.
    if (action === "submit_templates") {
      if (userEmail !== OWNER_EMAIL) return jsonErr("Só o dono do sistema envia modelos para a Meta.", 403);
      const cfg = await waConfig(admin);
      if (!cfg.waba_id) return jsonErr("WhatsApp do assistente sem waba_id", 400);
      const res: Record<string, unknown> = {};
      for (const t of Object.values(CRM_TEMPLATES)) {
        res[t.name] = await graph(`${cfg.waba_id}/message_templates`, {
          body: {
            name: t.name, language: "pt_BR", category: "MARKETING",
            components: [{ type: "BODY", text: t.text, example: { body_text: [[...t.example]] } }],
          },
        }).catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
      }
      return ok({ resultado: res });
    }

    // ── Registrar que abordou alguém (o envio em si é o clique na tela) ───────
    if (action === "log_send") {
      const { customer_id, stage, voucher_id, message } = body;
      if (!customer_id || !stage) return jsonErr("customer_id e stage sao obrigatorios", 400);
      if (!STAGE_ORDER.includes(String(stage) as Stage)) return jsonErr("estagio invalido", 400);

      const { data: regra } = await admin
        .from("crm_rules").select("id").eq("tenant_id", tenantId).eq("stage", stage).maybeSingle();

      const { error: insErr } = await admin.from("crm_sends").insert({
        tenant_id: tenantId,
        customer_id,
        rule_id: regra?.id ?? null,
        stage,
        channel: "whatsapp",
        voucher_id: voucher_id ?? null,
        message: typeof message === "string" ? message.slice(0, 1000) : null,
        sent_by: userId,
      });
      if (insErr) throw insErr;

      // Espelha no cadastro: a aba Clientes mostra "último contato".
      await admin.from("customers")
        .update({ last_contacted_at: new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("id", customer_id);

      return ok({ logged: true });
    }

    // ── "Não me manda mais" / desfazer ───────────────────────────────────────
    if (action === "set_opt_out") {
      const { customer_id, opt_out } = body;
      if (!customer_id) return jsonErr("customer_id obrigatorio", 400);
      const { error: updErr } = await admin.from("customers")
        .update({ crm_opt_out_at: opt_out === false ? null : new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("id", customer_id);
      if (updErr) throw updErr;
      return ok({ opt_out: opt_out !== false });
    }

    // ── Recalcular (cron diário) ──────────────────────────────────────────────
    if (action === "recompute") {
      const { error: recErr } = await admin.rpc("fn_crm_recompute_stages", { p_tenant_id: tenantId });
      if (recErr) throw recErr;
      return ok({ recomputed: true });
    }

    return jsonErr("action desconhecida: " + action, 400);
  } catch (err) {
    const msg = (err && typeof err === "object" && "message" in err)
      ? String((err as { message: unknown }).message)
      : String(err);
    console.error("[crm-funnel]", msg);
    return jsonErr(msg, 500);
  }
});
