// Funil de CRM do delivery.
//
// O que faz: diz em que estagio cada cliente esta, qual oferta a loja definiu
// pra esse estagio e quem esta elegivel a ser abordado AGORA (respeitando
// espera, cooldown, teto de frequencia e opt-out).
//
// O que NAO faz: enviar mensagem. O envio e um clique humano na tela (o voucher
// sai pela voucher-write, como no resto do CRM) e volta aqui so como log
// (`log_send`). Disparo automatico depende de template aprovado na Meta e fica
// para quando `crm_rules.auto_send` puder ser ligado de verdade.
//
// Auth: verify_jwt = false no deploy; cada action valida o token na mao
// (mesmo padrao da delivery-write), porque o cron chama com a service key.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

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
    if (!isCron) {
      if (!token) return jsonErr("Não autenticado", 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonErr("Sessão inválida", 401);
      userId = userData.user.id;
      const { data: membership } = await admin
        .from("user_tenants").select("role")
        .eq("user_id", userId).eq("tenant_id", tenantId).limit(1).maybeSingle();
      if (!membership) return jsonErr("Sem acesso a esta loja.", 403);
      // Escrita de configuração é só de admin.
      if ((action === "save_rules") && membership.role !== "admin") {
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

    // ── Lista de um estágio, já dizendo quem pode ser abordado ────────────────
    if (action === "list_stage") {
      const stage = String(body.stage ?? "") as Stage;
      if (!STAGE_ORDER.includes(stage)) return jsonErr("estagio invalido", 400);

      const regras = await carregarRegras();
      const regra = regras.find((r) => String(r!.stage) === stage)!;
      const settings = await carregarSettings();

      const { data: linhas, error: stErr } = await admin
        .from("crm_customer_stage")
        .select("customer_id, stage, entered_at, orders_count, total_spent, last_order_at, days_since_last, avg_cycle_days")
        .eq("tenant_id", tenantId)
        .eq("stage", stage)
        .order("total_spent", { ascending: false })
        .limit(500);
      if (stErr) throw stErr;

      const ids = (linhas ?? []).map((l) => String(l.customer_id));
      if (ids.length === 0) return ok({ clientes: [], rule: regra, settings });

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
          pode_abordar: bloqueio === null,
          bloqueio,
        };
      });

      return ok({ clientes, rule: regra, settings });
    }

    // ── Salvar regras / limites / criterios ───────────────────────────────────
    if (action === "save_rules") {
      const { rules, settings, criteria } = body as {
        rules?: Array<Record<string, unknown>>;
        settings?: Record<string, unknown>;
        criteria?: Record<string, unknown>;
      };
      await carregarRegras(); // garante que as linhas existem

      const tetoDesconto = Number(settings?.desconto_max_percent ?? 25) || 25;

      for (const r of rules ?? []) {
        const stage = String(r.stage ?? "");
        if (!STAGE_ORDER.includes(stage as Stage)) continue;
        const tipo = ["percentual", "valor", "nenhum"].includes(String(r.voucher_type)) ? String(r.voucher_type) : "nenhum";
        let valor = Math.max(0, Number(r.voucher_value ?? 0) || 0);
        // Trava de margem: desconto em % nunca passa do teto da loja.
        if (tipo === "percentual") valor = Math.min(valor, tetoDesconto);
        const { error: updErr } = await admin.from("crm_rules").update({
          enabled: r.enabled === true,
          // auto_send fica fora de propósito: não existe envio automático ainda.
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
