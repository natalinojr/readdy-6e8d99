// Programa de fidelidade — configuração da loja + clube no tablet.
//
// Ações da loja (tela Clientes & Marketing › Fidelidade):
//   get     → config (padrão se nunca salvou) + histogramas para a simulação
//             + itens do cardápio para escolher recompensas.
//   save    → valida/normaliza e grava. Ligar o programa pela 1ª vez marca
//             started_at (pontos valem a partir daí) e recalcula a loja.
//             Admin, ou quem tem gestao_promocoes (cargo/pessoa) — gerente não passa sozinho.
//   membros → quem está no clube, saldo, nível, giros e prêmios pendentes.
//
// Ações do tablet (qualquer membro da loja; o tablet usa o usuário kiosk):
//   clube_buscar    {cpf}                          → resumo do cliente ou {encontrado:false}
//   clube_do_pedido {order_id}                     → caixa: CPF já dado no pedido + resumo se for do clube
//   clube_cadastrar {cpf, nome, celular, nascimento?, aceita_ofertas}
//   clube_reservar  {customer_id, recompensa_id | beneficio_id, celular_final}
//   clube_liberar   {customer_id, hold_ids}
//   clube_link      {customer_id, celular_final}     → link de uso único p/ QR (/clube/<loja>)
//   clube_aplicar_pedido {customer_id, order_id, hold_ids, simular?} → caixa: cliente + prêmios num pedido lançado
//   clube_girar     {customer_id}
// Toda regra de dinheiro (saldo, nível, sorteio) está no banco
// (fn_fidelidade_*, migration 20260927150000_fidelidade_motor.sql).
//
// Auth: verify_jwt = false no deploy; JWT validado aqui + vínculo com a loja.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authenticate, tenantRole } from "../_shared/tenant-auth.ts";
import { temPermissao } from "../_shared/permissao-servidor.ts";
import { configPadrao, cpfValido, normalizarConfig, soDigitos } from "../_shared/fidelidade.ts";
import { cadastrarNoClube, conferirCelularFinal, descontoClubeServidor, idsValidos, novoToken, sha256Hex, vincularClube } from "../_shared/clube-servidor.ts";

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

// Escrita da loja (salvar o programa, ver os membros): admin sempre; os demais cargos só com
// "Promoções" (gestao_promocoes) na matriz do cargo ou no ajuste da pessoa. Antes, todo gerente
// passava mesmo sem a permissão (revisão de Clientes & Marketing, 2026-10-04).
async function podeEditar(admin: any, tenantId: string, role: string, userId?: string | null): Promise<boolean> {
  return await temPermissao(admin, tenantId, userId, role, "gestao_promocoes");
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
    // Só as ações da loja (tela de Fidelidade) conferem a permissão; o clube do tablet/delivery/mesa/caixa
    // não paga essa consulta nem falha por causa dela.
    const acaoDaLoja = action === "get" || action === "save" || action === "membros";
    const editavel = caller.isServiceRole || (acaoDaLoja && await podeEditar(admin, tenantId, role, caller.userId));

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

      const [histTrilha, hist90, produtos, loja] = await Promise.all([
        admin.rpc("fn_fidelidade_histograma", { p_tenant_id: tenantId, p_desde: janela > 0 ? dias(janela) : null }),
        admin.rpc("fn_fidelidade_histograma", { p_tenant_id: tenantId, p_desde: dias(90) }),
        admin.from("menu_items").select("id, name, price")
          .eq("tenant_id", tenantId).is("deleted_at", null).eq("is_active", true).order("name").limit(2000),
        // slug → link da página pública do clube (/clube/<slug>) na tela da loja
        admin.from("tenants").select("slug").eq("id", tenantId).maybeSingle(),
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
        slug: loja.data?.slug ?? null,
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

      // Caixa abrindo o pagamento de um pedido (ex.: do tablet): o CPF que o cliente já
      // deu (CPF na nota ou o do clube) e, se ele é do clube, o cartão — sem redigitar.
      if (action === "clube_do_pedido") {
        const orderId = String(body.order_id ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(orderId)) return ok({ ativo: true, cpf: null, encontrado: false });
        const { data: o } = await admin.from("orders").select("customer_id, customer_cpf")
          .eq("id", orderId).eq("tenant_id", tenantId).maybeSingle();
        if (!o) return ok({ ativo: true, cpf: null, encontrado: false });
        let cpf = soDigitos(o.customer_cpf);
        let membro: string | null = null;
        if (o.customer_id) {
          const { data: c } = await admin.from("customers").select("id, cpf, loyalty_joined_at")
            .eq("id", o.customer_id).eq("tenant_id", tenantId).is("deleted_at", null).maybeSingle();
          if (c?.loyalty_joined_at) { membro = c.id; if (c.cpf) cpf = soDigitos(c.cpf); }
          else if (!cpfValido(cpf) && c?.cpf) cpf = soDigitos(c.cpf);
        }
        if (!cpfValido(cpf)) return ok({ ativo: true, cpf: null, encontrado: false });
        if (!membro) {
          const { data: c } = await admin.from("customers").select("id, loyalty_joined_at")
            .eq("tenant_id", tenantId).eq("cpf", cpf).is("deleted_at", null).maybeSingle();
          if (c?.loyalty_joined_at) membro = c.id;
        }
        // na_nota: o CPF já estava no pedido como "CPF na nota" (o caixa pode repetir na nota).
        return ok({ ativo: true, cpf, na_nota: cpfValido(soDigitos(o.customer_cpf)), encontrado: !!membro, resumo: membro ? await resumo(membro) : undefined });
      }

      if (action === "clube_cadastrar") {
        const r = await cadastrarNoClube(admin, tenantId, body);
        if (r.erro) return jsonErr(r.erro);
        return ok({ ativo: true, encontrado: true, novo: true, resumo: await resumo(r.customerId!) });
      }

      const customerId = await clienteDaLoja(body.customer_id);
      if (!customerId) return jsonErr("Cliente não encontrado nesta loja.", 404);

      if (action === "clube_reservar") {
        // Gastar pontos/prêmio pede os 4 últimos dígitos do celular (só o CPF não basta).
        // 5 erros seguidos travam o resgate desse cliente por 15 min.
        const erroCel = await conferirCelularFinal(admin, customerId, body.celular_final);
        if (erroCel) return jsonErr(erroCel);
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

      // "Ver no celular": o tablet mostra um QR com link de uso único (10 min) que abre
      // /clube/<loja> já logado. Pede os 4 dígitos antes (o QR vira um cartão do clube).
      if (action === "clube_link") {
        const erroCel = await conferirCelularFinal(admin, customerId, body.celular_final);
        if (erroCel) return jsonErr(erroCel);
        const { data: loja } = await admin.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
        if (!loja?.slug) return jsonErr("Loja sem endereço público (slug) configurado.");
        const token = novoToken();
        const { error } = await admin.from("loyalty_login_links").insert({ tenant_id: tenantId, customer_id: customerId, token_hash: await sha256Hex(token) });
        if (error) throw error;
        return ok({ caminho: `/clube/${loja.slug}?entrar=${token}` });
      }

      // Caixa: liga o cliente do clube a um pedido JÁ lançado (pontos quando pagar) e
      // aplica os prêmios reservados. Desconto calculado aqui com os itens do pedido.
      // simular=true só devolve o desconto (a tela usa para o total a cobrar).
      // Reenvio após falha: reserva já ligada a ESTE pedido conta como aplicada.
      if (action === "clube_aplicar_pedido") {
        const orderId = String(body.order_id ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(orderId)) return jsonErr("order_id inválido");
        const { data: ped } = await admin.from("orders").select("id, tenant_id, status, is_paid, customer_id, total_amount, discount_amount, subtotal")
          .eq("id", orderId).eq("tenant_id", tenantId).maybeSingle();
        if (!ped) return jsonErr("Pedido não encontrado nesta loja.", 404);
        if (ped.status === "cancelled") return jsonErr("Pedido cancelado.");
        // Pedido já pago não ganha dono depois (subiria nível/giros de alguém com compra alheia).
        if (ped.is_paid && ped.customer_id !== customerId) return jsonErr("Pedido já pago: não dá para colocar no clube depois.");
        if (ped.customer_id && ped.customer_id !== customerId) return jsonErr("Este pedido já está no nome de outro cliente.");
        const holds = idsValidos(body.hold_ids);
        const [txLig, bnLig] = holds.length ? await Promise.all([
          admin.from("loyalty_transactions").select("id").in("id", holds).eq("order_id", orderId).is("deleted_at", null),
          admin.from("loyalty_benefits").select("id").in("id", holds).eq("order_id", orderId),
        ]) : [{ data: [] }, { data: [] }];
        const jaLigados = new Set([...(txLig.data ?? []), ...(bnLig.data ?? [])].map((x: any) => String(x.id)));
        const pendentes = holds.filter((h) => !jaLigados.has(h));

        let desconto = 0;
        let usados: string[] = [];
        if (pendentes.length > 0) {
          if (ped.is_paid) return jsonErr("Pedido já pago: o prêmio fica para o próximo pedido.");
          const { data: its } = await admin.from("order_items").select("item_id, item_price, quantity, status").eq("order_id", orderId).neq("status", "cancelled");
          const ids = [...new Set((its ?? []).map((i: any) => i.item_id).filter(Boolean))];
          const { data: menu } = ids.length ? await admin.from("menu_items").select("id, price").in("id", ids) : { data: [] };
          const precoMenu = new Map((menu ?? []).map((m: any) => [String(m.id), Number(m.price ?? 0)]));
          const itensDesc = (its ?? []).filter((i: any) => i.item_id).map((i: any) => ({
            id: String(i.item_id), preco: Math.min(Number(i.item_price ?? 0), precoMenu.get(String(i.item_id)) ?? Number(i.item_price ?? 0)), qtd: Number(i.quantity ?? 0),
          }));
          // Base = itens (sem taxa de serviço/entrega), igual ao delivery e à mesa.
          const baseItens = Math.min(Number(ped.total_amount ?? 0), Math.max(0, Number(ped.subtotal ?? 0) - Number(ped.discount_amount ?? 0)));
          const dc = await descontoClubeServidor(admin, customerId, pendentes, itensDesc, baseItens);
          if (dc.invalidas > 0) return jsonErr("Um prêmio do clube venceu ou já foi usado. Tire e use de novo.", 409);
          desconto = dc.desconto; usados = dc.usados;
        }
        if (body.simular === true) return ok({ desconto, ja_aplicado: jaLigados.size > 0 });

        const novoTotal = Math.max(0, Math.round((Number(ped.total_amount ?? 0) - desconto) * 100) / 100);
        const upd: Record<string, unknown> = { customer_id: customerId, updated_at: new Date().toISOString() };
        if (desconto > 0) { upd.discount_amount = Math.round((Number(ped.discount_amount ?? 0) + desconto) * 100) / 100; upd.total_amount = novoTotal; }
        // Condicional ao total lido: outro terminal mexendo no mesmo pedido não soma duas vezes.
        const { data: gravou } = await admin.from("orders").update(upd).eq("id", orderId).eq("total_amount", ped.total_amount).eq("is_paid", ped.is_paid).select("id");
        if (!gravou?.length) return jsonErr("O pedido mudou enquanto aplicava o clube. Tente de novo.", 409);
        if (usados.length > 0) {
          const n = await vincularClube(admin, customerId, orderId, usados);
          if (n < usados.length) {
            await admin.from("orders").update({ discount_amount: ped.discount_amount, total_amount: ped.total_amount }).eq("id", orderId);
            return jsonErr("Um prêmio do clube não está mais disponível. Tire e use de novo.", 409);
          }
        }
        return ok({ desconto, total: desconto > 0 ? novoTotal : Number(ped.total_amount ?? 0) });
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
