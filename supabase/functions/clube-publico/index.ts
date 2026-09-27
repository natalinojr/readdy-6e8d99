// Clube de fidelidade — lado do CLIENTE, sem login no ERPOS (página /clube/<loja>,
// e o delivery/mesa quando o cliente quer usar prêmio).
//
// Ações (loja por `slug` ou `tenant_id`; sessão por `token` do "cartão do clube"):
//   programa     {slug|tenant_id}                → regras públicas (níveis, prêmios, como ganhar)
//   entrar       {slug|tenant_id, cpf, celular_final} → token (90 dias) + dados do cliente
//   entrar_link  {token_link}                     → token (link de uso único do QR do tablet)
//   cadastrar    {slug|tenant_id, cpf, nome, celular, nascimento?, aceita_termos, aceita_ofertas}
//   eu           {token}                          → resumo + extrato + regras
//   reservar     {token, recompensa_id | beneficio_id} → reserva (2 h) para usar num pedido
//   girar        {token}                          → sorteio da roleta (no banco)
//   liberar      {token, hold_ids}
//   sair         {token}
// Os 4 dígitos do celular são pedidos para ENTRAR (5 erros = 15 min bloqueado);
// com o cartão (token) no aparelho, usar prêmio não pede de novo.
// verify_jwt = false no deploy (página pública).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { normalizarConfig } from "../_shared/fidelidade.ts";
import {
  cadastrarNoClube, conferirCelularFinal, criarSessao, dentroDoLimite, idsValidos, membroPorCpf, resumoDoCliente, sessaoDoClube, sha256Hex,
} from "../_shared/clube-servidor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function resp(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ _v: "v1", ...payload }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const erro = (msg: string, status = 400) => resp({ error: msg, message: msg }, status);
const erroRpc = (e: any) => String(e?.message ?? e ?? "Erro").replace(/^.*?ERROR:\s*/i, "").slice(0, 200);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    // Limite por IP nas portas que aceitam CPF/QR (força bruta dos 4 dígitos e varredura de CPF).
    const ip = (req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "?").split(",")[0].trim();
    if (["entrar", "cadastrar", "entrar_link"].includes(action) && !(await dentroDoLimite(admin, `clube:${action}:${ip}`, 20, 15))) {
      return erro("Muitas tentativas deste aparelho. Espere 15 minutos.", 429);
    }

    async function lojaDoBody(): Promise<{ id: string; nome: string; slug: string | null } | null> {
      if (body.tenant_id && /^[0-9a-f-]{36}$/i.test(String(body.tenant_id))) {
        const { data } = await admin.from("tenants").select("id, name, slug, is_active").eq("id", String(body.tenant_id)).maybeSingle();
        return data && data.is_active !== false ? { id: data.id, nome: data.name, slug: data.slug } : null;
      }
      const slug = String(body.slug ?? "").trim();
      if (!slug) return null;
      const { data } = await admin.from("tenants").select("id, name, slug, is_active").eq("slug", slug).limit(1).maybeSingle();
      return data && data.is_active !== false ? { id: data.id, nome: data.name, slug: data.slug } : null;
    }

    // Regras que o cliente pode ver (nada do custo da loja).
    async function programaPublico(tenantId: string) {
      const { data: prog } = await admin.from("loyalty_programs").select("enabled, config").eq("tenant_id", tenantId).maybeSingle();
      if (!prog?.enabled) return null;
      const c = normalizarConfig(prog.config);
      const { data: produtos } = await admin.from("menu_items").select("id, photo_url, price")
        .in("id", c.recompensas.map((r) => r.produto_id).filter(Boolean) as string[]);
      return {
        nome: c.nome_programa,
        pontos: c.pontos.ativo ? {
          pontos_por_real: c.pontos.pontos_por_real, pedido_minimo: c.pontos.pedido_minimo, validade_meses: c.pontos.validade_meses,
          bonus_cadastro: c.pontos.bonus_cadastro, bonus_aniversario: c.pontos.bonus_aniversario, canais: c.pontos.canais,
        } : null,
        niveis: c.trilha.ativo ? c.trilha.niveis.map((n) => ({ id: n.id, nome: n.nome, emoji: n.emoji, cor: n.cor, min_compras: n.min_compras, multiplicador: n.multiplicador, beneficios: n.beneficios })) : [],
        janela_dias: c.trilha.janela_dias,
        recompensas: c.recompensas.filter((r) => r.ativo && r.tipo !== "frete_gratis").map((r) => {
          const p = (produtos ?? []).find((x: any) => x.id === r.produto_id);
          return { id: r.id, nome: r.nome, tipo: r.tipo, valor: r.valor, custo_pontos: r.custo_pontos, foto: p?.photo_url ?? null, preco: p ? Number(p.price) : null,
                   nivel_minimo: c.trilha.niveis.find((n) => n.id === r.nivel_minimo)?.nome ?? null };
        }),
        roleta: c.roleta.ativo ? {
          a_cada_compras: c.roleta.a_cada_compras, pedido_acima_de: c.roleta.pedido_acima_de, ao_subir_nivel: c.roleta.ao_subir_nivel, aniversario: c.roleta.aniversario,
          premios: c.roleta.premios.filter((p) => p.tipo !== "nada").map((p) => p.nome),
          // Desenho da roleta (o tamanho da fatia é a chance — o mesmo que o tablet mostra).
          fatias: c.roleta.premios.map((p) => ({ id: p.id, nome: p.nome, cor: p.cor, peso: p.peso })),
        } : null,
      };
    }

    async function extrato(customerId: string) {
      const { data } = await admin.from("loyalty_transactions").select("transaction_type, points, notes, created_at, expires_at, order_id, hold_until")
        .eq("customer_id", customerId).is("deleted_at", null).order("created_at", { ascending: false }).limit(40);
      return (data ?? [])
        .filter((t: any) => !(t.transaction_type === "redeemed" && !t.order_id && (!t.hold_until || new Date(t.hold_until).getTime() <= Date.now())))
        .map((t: any) => ({
          tipo: t.transaction_type, pontos: Number(t.points), texto: t.notes, data: t.created_at, vence: t.expires_at,
          reservado: t.transaction_type === "redeemed" && !t.order_id,
        }));
    }

    async function dadosDoCliente(tenantId: string, customerId: string) {
      const [resumo, ext, prog, loja] = await Promise.all([
        resumoDoCliente(admin, customerId),
        extrato(customerId),
        programaPublico(tenantId),
        admin.from("tenants").select("name, slug").eq("id", tenantId).maybeSingle(),
      ]);
      return { resumo, extrato: ext, programa: prog, loja: { nome: loja.data?.name, slug: loja.data?.slug, tenant_id: tenantId } };
    }

    if (action === "programa") {
      const loja = await lojaDoBody();
      if (!loja) return erro("Loja não encontrada.", 404);
      const prog = await programaPublico(loja.id);
      return resp({ ativo: !!prog, loja: { nome: loja.nome, slug: loja.slug, tenant_id: loja.id }, programa: prog });
    }

    if (action === "entrar" || action === "cadastrar") {
      const loja = await lojaDoBody();
      if (!loja) return erro("Loja não encontrada.", 404);
      if (!(await programaPublico(loja.id))) return erro("O clube desta loja não está ativo.");
      let customerId: string | null;
      if (action === "cadastrar") {
        // CPF que JÁ é do clube não "se cadastra de novo": entra pelo login (com os 4
        // dígitos). Senão bastaria o CPF de alguém para abrir o cartão dele.
        const r = await cadastrarNoClube(admin, loja.id, body, { web: true });
        if (r.erro) return erro(r.erro);
        customerId = r.customerId!;
      } else {
        // Mesma resposta para "CPF não é do clube" e "números errados": a página não serve
        // para descobrir quem é membro.
        customerId = await membroPorCpf(admin, loja.id, body.cpf);
        if (!customerId) return erro("CPF ou números do celular não conferem.");
        const e = await conferirCelularFinal(admin, customerId, body.celular_final, "web");
        if (e) return erro(e);
      }
      const token = await criarSessao(admin, loja.id, customerId, "web");
      return resp({ encontrado: true, token, ...(await dadosDoCliente(loja.id, customerId)) });
    }

    if (action === "entrar_link") {
      const t = String(body.token_link ?? "");
      if (!/^[0-9a-f]{64}$/.test(t)) return erro("Link inválido.");
      const agora = new Date().toISOString();
      // Uso único: marca usado na mesma operação (outro celular lendo o mesmo QR não entra).
      const { data: link } = await admin.from("loyalty_login_links").update({ used_at: agora })
        .eq("token_hash", await sha256Hex(t)).is("used_at", null).gt("expires_at", agora)
        .select("tenant_id, customer_id").maybeSingle();
      if (!link) return erro("Este QR já foi usado ou venceu. Gere outro no tablet.");
      const token = await criarSessao(admin, link.tenant_id, link.customer_id, "qr_tablet");
      return resp({ encontrado: true, token, ...(await dadosDoCliente(link.tenant_id, link.customer_id)) });
    }

    // Daqui para baixo: precisa do cartão do clube.
    const sessao = await sessaoDoClube(admin, body.token);
    if (!sessao) return erro("Sua sessão do clube acabou. Entre de novo.", 401);
    if (!(await programaPublico(sessao.tenant_id)) && action !== "sair") return erro("O clube desta loja não está ativo.");

    if (action === "eu") {
      return resp(await dadosDoCliente(sessao.tenant_id, sessao.customer_id));
    }

    if (action === "reservar") {
      const { data, error } = body.beneficio_id
        ? await admin.rpc("fn_fidelidade_reservar_beneficio", { p_customer: sessao.customer_id, p_beneficio: String(body.beneficio_id) })
        : await admin.rpc("fn_fidelidade_reservar", { p_customer: sessao.customer_id, p_recompensa: String(body.recompensa_id ?? "") });
      if (error) return erro(erroRpc(error));
      const { data: res } = await admin.rpc("fn_fidelidade_resumo", { p_customer: sessao.customer_id });
      return resp({ reserva: data, resumo: res });
    }

    // Roleta pelo celular: mesmo sorteio do tablet (no banco, com limite por dia da loja).
    if (action === "girar") {
      const { data, error } = await admin.rpc("fn_fidelidade_girar", { p_customer: sessao.customer_id });
      if (error) return erro(erroRpc(error));
      return resp({ giro: data });
    }

    if (action === "liberar") {
      const ids = idsValidos(body.hold_ids);
      if (ids.length > 0) {
        const { error } = await admin.rpc("fn_fidelidade_liberar", { p_customer: sessao.customer_id, p_ids: ids });
        if (error) throw error;
      }
      const { data: res } = await admin.rpc("fn_fidelidade_resumo", { p_customer: sessao.customer_id });
      return resp({ liberado: ids.length, resumo: res });
    }

    if (action === "sair") {
      await admin.from("loyalty_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", sessao.id);
      return resp({ saiu: true });
    }

    return erro(`action desconhecida: ${action}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String((e as any)?.message ?? e);
    console.error("[clube-publico]", msg);
    return erro("Não consegui falar com o clube agora. Tente de novo.", 500);
  }
});
