// Programa de fidelidade — configuração da loja + clube no tablet.
//
// Ações da loja (tela Clientes & Marketing › Fidelidade):
//   get     → config (padrão se nunca salvou) + histogramas para a simulação
//             + itens do cardápio para escolher recompensas.
//   save    → valida/normaliza e grava. Ligar o programa pela 1ª vez marca
//             started_at (pontos valem a partir daí) e recalcula a loja.
//             Admin/gerente, ou papel com gestao_promocoes na matriz.
//   membros → quem está no clube, saldo, nível, giros e prêmios pendentes.
//
// Ações do tablet (qualquer membro da loja; o tablet usa o usuário kiosk):
//   clube_buscar    {cpf}                          → resumo do cliente ou {encontrado:false}
//   clube_cadastrar {cpf, nome, celular, nascimento?, aceita_ofertas}
//   clube_reservar  {customer_id, recompensa_id | beneficio_id, celular_final}
//   clube_liberar   {customer_id, hold_ids}
//   clube_girar     {customer_id}
// Toda regra de dinheiro (saldo, nível, sorteio) está no banco
// (fn_fidelidade_*, migration 20260927150000_fidelidade_motor.sql).
//
// Auth: verify_jwt = false no deploy; JWT validado aqui + vínculo com a loja.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authenticate, isManagerRole, tenantRole } from "../_shared/tenant-auth.ts";
import { configPadrao, cpfValido, normalizarConfig, soDigitos } from "../_shared/fidelidade.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const V = "v2";

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

async function podeEditar(admin: any, tenantId: string, role: string): Promise<boolean> {
  if (isManagerRole(role)) return true;
  const { data } = await admin.from("permissions").select("allowed")
    .eq("tenant_id", tenantId).eq("role", role).eq("permission_key", "gestao_promocoes")
    .limit(1).maybeSingle();
  return data?.allowed === true;
}

// Mensagem de erro do Postgres (raise exception) vira texto para o cliente.
function erroRpc(e: any): string {
  const m = String(e?.message ?? e ?? "Erro");
  return m.replace(/^.*?ERROR:\s*/i, "").slice(0, 200);
}

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
    const tenantId = String(body.tenant_id ?? body.active_tenant_id ?? "");
    if (!action) return jsonErr("action obrigatoria");
    if (!tenantId) return jsonErr("tenant_id obrigatorio");

    const caller = await authenticate(req, admin);
    if (!caller) return jsonErr("Não autenticado", 401);
    let role = "admin";
    if (!caller.isServiceRole) {
      const r = await tenantRole(admin, caller.userId!, tenantId);
      if (!r) return jsonErr("Sem acesso a esta loja.", 403);
      role = r;
    }
    const editavel = caller.isServiceRole || await podeEditar(admin, tenantId, role);

    // Cliente tem que ser desta loja (o tablet manda o id que recebeu no buscar).
    async function clienteDaLoja(id: unknown): Promise<string | null> {
      const cid = String(id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(cid)) return null;
      const { data } = await admin.from("customers").select("id").eq("id", cid).eq("tenant_id", tenantId).is("deleted_at", null).maybeSingle();
      return data?.id ?? null;
    }

    async function programa() {
      const { data } = await admin.from("loyalty_programs").select("enabled, config, started_at").eq("tenant_id", tenantId).maybeSingle();
      return data;
    }

    async function resumo(customerId: string) {
      const { error: sErr } = await admin.rpc("fn_fidelidade_sync", { p_customer: customerId });
      if (sErr) console.error("[fidelidade] sync", sErr.message);
      const { data, error } = await admin.rpc("fn_fidelidade_resumo", { p_customer: customerId });
      if (error) throw error;
      return data;
    }

    // ── Loja ──────────────────────────────────────────────────────────────────
    if (action === "get") {
      const { data: row, error } = await admin
        .from("loyalty_programs").select("enabled, config, updated_at, started_at")
        .eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      const config = row ? normalizarConfig(row.config) : configPadrao();

      const janela = Math.max(0, Math.min(3650, Math.round(Number(body.janela_dias ?? config.trilha.janela_dias) || 0)));
      const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

      const [histTrilha, hist90, produtos] = await Promise.all([
        admin.rpc("fn_fidelidade_histograma", { p_tenant_id: tenantId, p_desde: janela > 0 ? dias(janela) : null }),
        admin.rpc("fn_fidelidade_histograma", { p_tenant_id: tenantId, p_desde: dias(90) }),
        admin.from("menu_items").select("id, name, price")
          .eq("tenant_id", tenantId).is("deleted_at", null).eq("is_active", true).order("name").limit(2000),
      ]);
      if (histTrilha.error) throw histTrilha.error;
      if (hist90.error) throw hist90.error;

      const conv = (rows: any[] | null) => (rows ?? []).map((r) => ({
        compras: Number(r.compras), clientes: Number(r.clientes), gasto: Number(r.gasto ?? 0),
      }));

      return ok({
        enabled: row?.enabled ?? false,
        started_at: row?.started_at ?? null,
        salvo: !!row,
        updated_at: row?.updated_at ?? null,
        config,
        editavel,
        janela_dias: janela,
        histograma: conv(histTrilha.data),
        histograma_90d: conv(hist90.data),
        produtos: (produtos.data ?? []).map((p: any) => ({ id: p.id, nome: p.name, preco: Number(p.price ?? 0) })),
      });
    }

    if (action === "save") {
      if (!editavel) return jsonErr("Seu perfil não pode alterar o programa de fidelidade.", 403);
      const config = normalizarConfig(body.config);
      const enabled = body.enabled === true;
      const atual = await programa();
      // started_at: o dia em que o programa foi ligado pela 1ª vez. Pontos só de pedidos
      // pagos a partir daí (não é retroativo). Desligar e religar mantém a data.
      const startedAt = atual?.started_at ?? (enabled ? new Date().toISOString() : null);
      const { error } = await admin.from("loyalty_programs").upsert({
        tenant_id: tenantId,
        enabled,
        config,
        started_at: startedAt,
        updated_at: new Date().toISOString(),
        updated_by: caller.userId,
      }, { onConflict: "tenant_id" });
      if (error) throw error;
      // Regra mudou (ou programa ligou/desligou): recalcula a loja. Poucos clientes por loja.
      let recalculados = 0;
      if (enabled || atual?.enabled) {
        const { data: n, error: sErr } = await admin.rpc("fn_fidelidade_sync_loja", { p_tenant: tenantId });
        if (sErr) console.error("[fidelidade] sync_loja", sErr.message);
        recalculados = Number(n ?? 0);
      }
      return ok({ enabled, config, started_at: startedAt, recalculados });
    }

    if (action === "membros") {
      // Lista com nome e saldo de clientes: só quem pode mexer no programa (não o tablet).
      if (!editavel) return jsonErr("Seu perfil não pode ver os membros do clube.", 403);
      const { data, error } = await admin.rpc("fn_fidelidade_membros", { p_tenant: tenantId, p_limite: 300 });
      if (error) throw error;
      return ok({ membros: data ?? [] });
    }

    // ── Tablet ────────────────────────────────────────────────────────────────
    if (action.startsWith("clube_")) {
      const prog = await programa();
      if (!prog?.enabled) return ok({ ativo: false });

      // O tablet pergunta ao voltar para a tela inicial: mostra ou não o passo do clube.
      if (action === "clube_status") {
        const cfg = normalizarConfig(prog.config);
        return ok({
          ativo: true,
          programa: cfg.nome_programa,
          bonus_cadastro: cfg.pontos.ativo ? cfg.pontos.bonus_cadastro : 0,
          pontos_por_real: cfg.pontos.ativo ? cfg.pontos.pontos_por_real : 0,
          niveis: cfg.trilha.ativo ? cfg.trilha.niveis.map((n) => ({ id: n.id, nome: n.nome, emoji: n.emoji, cor: n.cor, min_compras: n.min_compras })) : [],
          // Só o desenho da roleta (nome/cor/peso); o sorteio é no banco.
          roleta: cfg.roleta.ativo ? cfg.roleta.premios.map((p) => ({ id: p.id, nome: p.nome, cor: p.cor, peso: p.peso })) : [],
        });
      }

      if (action === "clube_buscar") {
        const cpf = soDigitos(body.cpf);
        if (!cpfValido(cpf)) return jsonErr("CPF inválido. Confira os números.");
        const { data: cli } = await admin.from("customers").select("id, loyalty_joined_at")
          .eq("tenant_id", tenantId).eq("cpf", cpf).is("deleted_at", null).maybeSingle();
        // CPF gravado mas sem entrar no clube (ex.: digitado no caixa): passa pelo cadastro,
        // que pede o aceite. Digitar o CPF sozinho nunca inscreve ninguém (LGPD).
        if (!cli || !cli.loyalty_joined_at) return ok({ ativo: true, encontrado: false });
        return ok({ ativo: true, encontrado: true, resumo: await resumo(cli.id) });
      }

      if (action === "clube_cadastrar") {
        const cpf = soDigitos(body.cpf);
        const nome = String(body.nome ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
        const celular = soDigitos(body.celular);
        if (!cpfValido(cpf)) return jsonErr("CPF inválido. Confira os números.");
        if (nome.length < 2) return jsonErr("Digite seu nome.");
        if (celular.length < 10 || celular.length > 11) return jsonErr("Celular inválido. Use DDD + número.");
        if (body.aceita_termos !== true) return jsonErr("Para entrar no clube é preciso aceitar os termos.");
        let nascimento: string | null = null;
        if (body.nascimento) {
          const m = String(body.nascimento).match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (m && Number(m[1]) > 1900 && Number(m[1]) <= new Date().getFullYear()) nascimento = `${m[1]}-${m[2]}-${m[3]}`;
        }
        const agora = new Date().toISOString();

        const { data: porCpf } = await admin.from("customers").select("id, phone, loyalty_joined_at, birth_date")
          .eq("tenant_id", tenantId).eq("cpf", cpf).is("deleted_at", null).maybeSingle();
        if (porCpf?.loyalty_joined_at) return ok({ ativo: true, encontrado: true, resumo: await resumo(porCpf.id) });

        // Celular de OUTRO cadastro: não junta pelo tablet — bastaria saber o celular de
        // alguém para ficar com os pontos e o histórico dele. O caixa resolve.
        const { data: porCel } = await admin.from("customers").select("id")
          .eq("tenant_id", tenantId).eq("phone", celular).is("deleted_at", null).maybeSingle();
        if (porCel && porCel.id !== porCpf?.id) {
          return jsonErr("Este celular já tem cadastro na loja. Peça ao caixa para incluir seu CPF nele.");
        }

        let customerId: string;
        if (porCpf) {
          // CPF já conhecido (caixa/nota), agora com aceite: entra no clube.
          const { error } = await admin.from("customers").update({
            ...(soDigitos(porCpf.phone).length >= 10 ? {} : { phone: celular }),
            birth_date: porCpf.birth_date ?? nascimento,
            loyalty_joined_at: agora, gdpr_consent_at: agora, accepts_marketing: body.aceita_ofertas === true, updated_at: agora,
          }).eq("id", porCpf.id);
          if (error) throw error;
          customerId = porCpf.id;
        } else {
          const { data: novo, error } = await admin.from("customers").insert({
            tenant_id: tenantId, name: nome, phone: celular, cpf, birth_date: nascimento,
            first_visit_at: agora, visit_count: 0, total_spent: 0, loyalty_points: 0,
            accepts_marketing: body.aceita_ofertas === true, gdpr_consent_at: agora, loyalty_joined_at: agora,
          }).select("id").single();
          if (error) throw error;
          customerId = novo.id;
        }
        return ok({ ativo: true, encontrado: true, novo: true, resumo: await resumo(customerId) });
      }

      const customerId = await clienteDaLoja(body.customer_id);
      if (!customerId) return jsonErr("Cliente não encontrado nesta loja.", 404);

      if (action === "clube_reservar") {
        // Gastar pontos/prêmio pede os 4 últimos dígitos do celular (só o CPF não basta).
        // 5 erros seguidos travam o resgate desse cliente por 15 min.
        const { data: cli } = await admin.from("customers").select("phone, loyalty_pin_fails, loyalty_pin_locked_until").eq("id", customerId).maybeSingle();
        const cel = soDigitos(cli?.phone);
        if (cel.length < 10) return jsonErr("Seu cadastro está sem celular. Peça ao caixa para usar seus pontos.");
        if (cli?.loyalty_pin_locked_until && new Date(cli.loyalty_pin_locked_until).getTime() > Date.now()) {
          const min = Math.ceil((new Date(cli.loyalty_pin_locked_until).getTime() - Date.now()) / 60000);
          return jsonErr(`Muitas tentativas. Tente de novo em ${min} min ou fale com o caixa.`);
        }
        if (soDigitos(body.celular_final) !== cel.slice(-4)) {
          const falhas = Number(cli?.loyalty_pin_fails ?? 0) + 1;
          await admin.from("customers").update(falhas >= 5
            ? { loyalty_pin_fails: 0, loyalty_pin_locked_until: new Date(Date.now() + 15 * 60_000).toISOString() }
            : { loyalty_pin_fails: falhas }).eq("id", customerId);
          return jsonErr(falhas >= 5 ? "Muitas tentativas. Tente de novo em 15 min ou fale com o caixa." : "Os 4 últimos números do celular não conferem.");
        }
        if (Number(cli?.loyalty_pin_fails ?? 0) > 0) await admin.from("customers").update({ loyalty_pin_fails: 0 }).eq("id", customerId);
        try {
          const { data, error } = body.beneficio_id
            ? await admin.rpc("fn_fidelidade_reservar_beneficio", { p_customer: customerId, p_beneficio: String(body.beneficio_id) })
            : await admin.rpc("fn_fidelidade_reservar", { p_customer: customerId, p_recompensa: String(body.recompensa_id ?? "") });
          if (error) return jsonErr(erroRpc(error));
          const { data: res } = await admin.rpc("fn_fidelidade_resumo", { p_customer: customerId });
          return ok({ reserva: data, resumo: res });
        } catch (e) {
          return jsonErr(erroRpc(e));
        }
      }

      if (action === "clube_liberar") {
        const ids = (Array.isArray(body.hold_ids) ? body.hold_ids : []).map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20);
        if (ids.length > 0) {
          const { error } = await admin.rpc("fn_fidelidade_liberar", { p_customer: customerId, p_ids: ids });
          if (error) throw error;
        }
        return ok({ liberado: ids.length });
      }

      if (action === "clube_girar") {
        const { data, error } = await admin.rpc("fn_fidelidade_girar", { p_customer: customerId });
        if (error) return jsonErr(erroRpc(error));
        return ok({ giro: data });
      }

      if (action === "clube_resumo") {
        return ok({ ativo: true, resumo: await resumo(customerId) });
      }
    }

    return jsonErr(`action desconhecida: ${action}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String((e as any)?.message ?? e);
    console.error("[fidelidade]", msg);
    return jsonErr(msg, 500);
  }
});
