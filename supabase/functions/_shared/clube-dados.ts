// Clube de fidelidade — o que o CLIENTE vê (regras públicas, extrato, resumo).
// Usado pela página/app do clube: clube-publico (página e checkout) e clube-app (app instalado).
// deno-lint-ignore-file no-explicit-any
import { normalizarConfig, recompensasNaOrdem } from "./fidelidade.ts";
import { resumoDoCliente } from "./clube-servidor.ts";

/** Regras que o cliente pode ver (nada do custo da loja). null = programa desligado. */
export async function programaPublicoDaLoja(admin: any, tenantId: string) {
  const { data: prog } = await admin.from("loyalty_programs").select("enabled, config").eq("tenant_id", tenantId).maybeSingle();
  if (!prog?.enabled) return null;
  const c = normalizarConfig(prog.config);
  const [{ data: produtos }, { data: loja }] = await Promise.all([
    admin.from("menu_items").select("id, photo_url, price").in("id", c.recompensas.map((r) => r.produto_id).filter(Boolean) as string[]),
    admin.from("tenants").select("name, phone").eq("id", tenantId).maybeSingle(),
  ]);
  // WhatsApp que o cliente salva nos contatos: o da config do clube, senão o telefone da loja.
  let whats = c.whatsapp_loja || String(loja?.phone ?? "").replace(/\D/g, "");
  if (whats.length === 10 || whats.length === 11) whats = "55" + whats;
  return {
    nome: c.nome_programa,
    contato: whats.length >= 12 ? { nome: loja?.name ?? "", whatsapp: whats } : null,
    pontos: c.pontos.ativo ? {
      pontos_por_real: c.pontos.pontos_por_real, pedido_minimo: c.pontos.pedido_minimo, validade_meses: c.pontos.validade_meses,
      bonus_cadastro: c.pontos.bonus_cadastro, bonus_aniversario: c.pontos.bonus_aniversario, canais: c.pontos.canais,
    } : null,
    niveis: c.trilha.ativo ? c.trilha.niveis.map((n) => ({ id: n.id, nome: n.nome, emoji: n.emoji, cor: n.cor, min_compras: n.min_compras, multiplicador: n.multiplicador, beneficios: n.beneficios })) : [],
    janela_dias: c.trilha.janela_dias,
    recompensas: recompensasNaOrdem(c.recompensas.filter((r) => r.ativo && r.tipo !== "frete_gratis"), c.recompensas_ordem).map((r) => {
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

/** Últimos movimentos de pontos (reserva vencida não aparece). */
export async function extratoDoCliente(admin: any, customerId: string) {
  const { data } = await admin.from("loyalty_transactions").select("transaction_type, points, notes, created_at, expires_at, order_id, hold_until")
    .eq("customer_id", customerId).is("deleted_at", null).order("created_at", { ascending: false }).limit(40);
  return (data ?? [])
    .filter((t: any) => !(t.transaction_type === "redeemed" && !t.order_id && (!t.hold_until || new Date(t.hold_until).getTime() <= Date.now())))
    .map((t: any) => ({
      tipo: t.transaction_type, pontos: Number(t.points), texto: t.notes, data: t.created_at, vence: t.expires_at,
      reservado: t.transaction_type === "redeemed" && !t.order_id,
    }));
}

/** Tudo que a página/app do clube mostra para o cliente logado. */
export async function dadosDoClienteDoClube(admin: any, tenantId: string, customerId: string) {
  // O resumo recalcula a conta (bônus de cadastro, aniversário…): o extrato vem depois dele.
  const resumo = await resumoDoCliente(admin, customerId);
  const [ext, prog, loja] = await Promise.all([
    extratoDoCliente(admin, customerId),
    programaPublicoDaLoja(admin, tenantId),
    admin.from("tenants").select("name, slug").eq("id", tenantId).maybeSingle(),
  ]);
  return { resumo, extrato: ext, programa: prog, loja: { nome: loja.data?.name, slug: loja.data?.slug, tenant_id: tenantId } };
}
