// Clube de fidelidade — peças de servidor usadas por várias Edge Functions
// (fidelidade = tablet/loja, clube-publico = página do cliente, delivery-write e
// mesa-write = resgate no pedido). Regras de saldo/nível/reserva ficam no banco
// (fn_fidelidade_*); aqui só o que precisa de Deno (hash, sessão, cálculo do
// desconto com os preços que o PRÓPRIO servidor calculou).
// deno-lint-ignore-file no-explicit-any
import { cpfValido, descontoDasReservas, soDigitos, type ClubeReserva } from "./fidelidade.ts";

export async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function novoToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Programa ligado nesta loja? */
export async function programaLigado(admin: any, tenantId: string): Promise<boolean> {
  const { data } = await admin.from("loyalty_programs").select("enabled").eq("tenant_id", tenantId).maybeSingle();
  return data?.enabled === true;
}

/** Sessão do "cartão do clube" (token guardado no celular do cliente). */
export async function sessaoDoClube(admin: any, token: unknown): Promise<{ id: string; customer_id: string; tenant_id: string } | null> {
  const t = String(token ?? "");
  if (!/^[0-9a-f]{64}$/.test(t)) return null;
  const { data } = await admin.from("loyalty_sessions").select("id, customer_id, tenant_id, last_seen_at")
    .eq("token_hash", await sha256Hex(t)).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.last_seen_at).getTime() > 3_600_000) {
    await admin.from("loyalty_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  }
  return { id: data.id, customer_id: data.customer_id, tenant_id: data.tenant_id };
}

export async function criarSessao(admin: any, tenantId: string, customerId: string, via: string): Promise<string> {
  const token = novoToken();
  const { error } = await admin.from("loyalty_sessions").insert({ tenant_id: tenantId, customer_id: customerId, token_hash: await sha256Hex(token), criado_via: via });
  if (error) throw error;
  return token;
}

/** Confere os 4 últimos dígitos do celular. A conta das tentativas é feita no BANCO
 *  (fn_fidelidade_pin_tentar, cliente travado): tentativas em paralelo não furam a
 *  trava de 5 erros / 15 min. Canal 'web' (página pública) tem contador próprio —
 *  errar de propósito na internet não bloqueia o cliente no tablet/caixa.
 *  Devolve a mensagem de erro, ou null se conferiu. */
export async function conferirCelularFinal(admin: any, customerId: string, digitos: unknown, canal: "web" | "loja" = "loja"): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_fidelidade_pin_tentar", { p_customer: customerId, p_canal: canal, p_digitos: soDigitos(digitos) });
  if (error) throw error;
  if (data?.ok) return null;
  if (data?.motivo === "sem_celular") return "Seu cadastro está sem celular. Fale com o caixa da loja.";
  if (data?.motivo === "bloqueado") {
    const min = Math.max(1, Math.ceil((new Date(data.ate).getTime() - Date.now()) / 60000));
    return `Muitas tentativas. Tente de novo em ${min} min ou fale com o caixa.`;
  }
  return canal === "web" ? "CPF ou números do celular não conferem." : "Os 4 últimos números do celular não conferem.";
}

/** Limite de tentativas por chave (ex.: IP) na janela. true = pode seguir. */
export async function dentroDoLimite(admin: any, chave: string, max: number, janelaMin: number): Promise<boolean> {
  const { data, error } = await admin.rpc("fn_fidelidade_limite", { p_chave: chave.slice(0, 200), p_max: max, p_janela_min: janelaMin });
  if (error) { console.error("[clube] limite", error.message); return true; }
  return data === true;
}

/** Cliente do clube (já com aceite) pelo CPF, nesta loja. */
export async function membroPorCpf(admin: any, tenantId: string, cpf: unknown): Promise<string | null> {
  const d = soDigitos(cpf);
  if (!cpfValido(d)) return null;
  const { data } = await admin.from("customers").select("id, loyalty_joined_at")
    .eq("tenant_id", tenantId).eq("cpf", d).is("deleted_at", null).maybeSingle();
  return data?.loyalty_joined_at ? data.id : null;
}

/** Cadastro no clube (tablet ou internet). Nunca junta pelo celular de OUTRO
 *  cadastro (bastaria saber o celular de alguém para ficar com os pontos dele). */
export async function cadastrarNoClube(admin: any, tenantId: string, body: any, opts: { web?: boolean } = {}): Promise<{ customerId?: string; erro?: string }> {
  const cpf = soDigitos(body.cpf);
  const nome = String(body.nome ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  const celular = soDigitos(body.celular);
  if (!cpfValido(cpf)) return { erro: "CPF inválido. Confira os números." };
  if (nome.length < 2) return { erro: "Digite seu nome." };
  if (celular.length < 10 || celular.length > 11) return { erro: "Celular inválido. Use DDD + número." };
  if (body.aceita_termos !== true) return { erro: "Para entrar no clube é preciso aceitar os termos." };
  let nascimento: string | null = null;
  if (body.nascimento) {
    const m = String(body.nascimento).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m && Number(m[1]) > 1900 && Number(m[1]) <= new Date().getFullYear()) nascimento = `${m[1]}-${m[2]}-${m[3]}`;
  }
  const agora = new Date().toISOString();

  const { data: porCpf } = await admin.from("customers").select("id, phone, loyalty_joined_at, birth_date")
    .eq("tenant_id", tenantId).eq("cpf", cpf).is("deleted_at", null).maybeSingle();
  if (porCpf?.loyalty_joined_at) return { customerId: porCpf.id };
  // Pela internet, só CPF que a loja ainda não conhece: CPF que já existe (do caixa, da
  // nota) passa pelo balcão — senão alguém "tomaria" o cadastro e o histórico de outra pessoa.
  if (opts.web && porCpf) return { erro: "Este CPF já tem cadastro na loja. Se já é do clube, use Entrar; se não, peça ao caixa para ativar." };

  const { data: porCel } = await admin.from("customers").select("id")
    .eq("tenant_id", tenantId).eq("phone", celular).is("deleted_at", null).maybeSingle();
  if (porCel && porCel.id !== porCpf?.id) {
    return { erro: "Este celular já tem cadastro na loja. Peça ao caixa para incluir seu CPF nele." };
  }

  // CPF já conhecido (caixa/nota) com celular gravado: só entra no clube informando o
  // MESMO celular — senão quem soubesse o CPF de alguém ficaria com o histórico dele.
  if (porCpf && soDigitos(porCpf.phone).length >= 10 && soDigitos(porCpf.phone) !== celular) {
    return { erro: "Os dados não conferem com o cadastro da loja. Fale com o caixa." };
  }

  if (porCpf) {
    const { error } = await admin.from("customers").update({
      ...(soDigitos(porCpf.phone).length >= 10 ? {} : { phone: celular }),
      birth_date: porCpf.birth_date ?? nascimento,
      loyalty_joined_at: agora, gdpr_consent_at: agora, accepts_marketing: body.aceita_ofertas === true, updated_at: agora,
    }).eq("id", porCpf.id);
    if (error) throw error;
    return { customerId: porCpf.id };
  }
  const { data: novo, error } = await admin.from("customers").insert({
    tenant_id: tenantId, name: nome, phone: celular, cpf, birth_date: nascimento,
    first_visit_at: agora, visit_count: 0, total_spent: 0, loyalty_points: 0,
    accepts_marketing: body.aceita_ofertas === true, gdpr_consent_at: agora, loyalty_joined_at: agora,
  }).select("id").single();
  if (error) throw error;
  return { customerId: novo.id };
}

/** Resumo do cliente (recalcula antes: aniversário, reservas vencidas etc.). */
export async function resumoDoCliente(admin: any, customerId: string) {
  const { error: sErr } = await admin.rpc("fn_fidelidade_sync", { p_customer: customerId });
  if (sErr) console.error("[clube] sync", sErr.message);
  const { data, error } = await admin.rpc("fn_fidelidade_resumo", { p_customer: customerId });
  if (error) throw error;
  return data;
}

/** Reservas VÁLIDAS do cliente entre os ids pedidos, já no formato ClubeReserva. */
export async function reservasValidas(admin: any, customerId: string, ids: string[]): Promise<ClubeReserva[]> {
  if (ids.length === 0) return [];
  const agora = new Date().toISOString();
  const [tx, bn] = await Promise.all([
    admin.from("loyalty_transactions").select("id, meta").eq("customer_id", customerId).in("id", ids)
      .eq("transaction_type", "redeemed").is("order_id", null).is("deleted_at", null).gt("hold_until", agora),
    admin.from("loyalty_benefits").select("id, reward, expires_at").eq("customer_id", customerId).in("id", ids)
      .is("used_at", null).is("order_id", null).gt("hold_until", agora),
  ]);
  const out: ClubeReserva[] = [];
  for (const t of tx.data ?? []) out.push({ hold_id: t.id, fonte: "pontos", reward: t.meta?.reward ?? { tipo: "desconto_valor", nome: "Resgate", valor: 0 } });
  for (const b of bn.data ?? []) {
    if (b.expires_at && new Date(b.expires_at).getTime() <= Date.now()) continue;
    out.push({ hold_id: b.id, fonte: "beneficio", reward: b.reward });
  }
  // Mantém a ordem pedida (o desconto depende da ordem quando há teto).
  return ids.map((id) => out.find((r) => r.hold_id === id)).filter(Boolean) as ClubeReserva[];
}

/** Desconto do clube calculado com os preços do SERVIDOR. `invalidas` > 0 = alguma
 *  reserva venceu/já foi usada (quem chama decide recusar o pedido). */
export async function descontoClubeServidor(
  admin: any, customerId: string, holdIds: string[],
  itens: { id: string; preco: number; qtd: number }[], subtotal: number,
): Promise<{ desconto: number; usados: string[]; invalidas: number; nomes: string[] }> {
  const reservas = await reservasValidas(admin, customerId, holdIds);
  const d = descontoDasReservas(reservas, itens, subtotal);
  const usados = reservas.filter((r) => (d.porReserva[r.hold_id] ?? 0) > 0);
  return { desconto: d.total, usados: usados.map((r) => r.hold_id), invalidas: holdIds.length - reservas.length, nomes: usados.map((r) => r.reward.nome) };
}

export async function vincularClube(admin: any, customerId: string, orderId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await admin.rpc("fn_fidelidade_vincular", { p_customer: customerId, p_order: orderId, p_ids: ids });
  if (error) throw error;
  return Number(data ?? 0);
}

export function idsValidos(v: unknown, max = 20): string[] {
  return (Array.isArray(v) ? v : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, max);
}
