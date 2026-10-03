// Jogos enquanto espera — ranking semanal (top 3 ganha o prêmio da loja).
//
// Ações públicas (cliente na mesa QR / delivery, sem login):
//   config   → a loja tem ranking ligado? prêmios, jogos que valem, fim da semana.
//   direito  → ainda pode jogar? (só com pedido em andamento; entregue = para)
//   start    → começa uma partida valendo: só MEMBRO DO CLUBE (clube_token) com pedido de verdade
//              em andamento (não entregue) nas últimas 12h e devolve a SEMENTE sorteada pelo servidor.
//   submit   → recebe os quadros em que houve toque, REFAZ a partida com o mesmo
//              motor do celular (_shared/jogos) e grava a pontuação calculada aqui.
//              O número que o celular diz ter feito não é usado.
//   ranking  → top 10 da semana (nome curto + 2 últimos dígitos do celular).
// Ações da loja (login, admin/gerente ou gestao_promocoes):
//   admin_get / admin_save / admin_award / admin_unaward
//
// Semana = segunda 00:00 até domingo 23:59 (horário de Brasília).
// Auth: verify_jwt = false no deploy; JWT validado aqui nas ações admin_*.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authenticate, isManagerRole, tenantRole } from "../_shared/tenant-auth.ts";
import { ajusteDaPessoaNaLoja } from "../_shared/ajuste-pessoa.ts";
import { refazerVoa } from "../_shared/jogos/voa.ts";
import { programaLigado, sessaoDoClube } from "../_shared/clube-servidor.ts";
import { refazerCorre } from "../_shared/jogos/corre.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const V = "v1";
const JOGOS = ["voa", "corre"] as const;
const JANELA_PEDIDO_H = 12;
const MAX_PARTIDAS_POR_PEDIDO = 60;
const MAX_PARTIDAS_POR_DIA = 150;
const MAX_ENTRADAS = 20000;

function jsonErr(msg: string, code = 400, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ _v: V, error: msg, message: msg, ...extra }), {
    status: code,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function ok(payload: Record<string, unknown>) {
  return new Response(JSON.stringify({ _v: V, ok: true, ...payload }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Segunda-feira da semana (Brasília, UTC-3) como 'AAAA-MM-DD' */
export function semanaDe(ms: number): string {
  const d = new Date(ms - 3 * 3600_000);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
}
function somarDias(semana: string, dias: number): string {
  const d = new Date(semana + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
/** Fim da semana: próxima segunda 00:00 de Brasília, em ISO UTC */
function fimDaSemana(semana: string): string {
  return new Date(somarDias(semana, 7) + "T03:00:00Z").toISOString();
}

/** Celular só com dígitos, sem o 55 do Brasil. '' se não parecer celular. */
function normalizarFone(v: unknown): string {
  let d = String(v ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : "";
}
function nomeCurto(nome: string): string {
  const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "Jogador";
  return partes.length > 1 ? partes[0] + " " + partes[partes.length - 1][0].toUpperCase() + "." : partes[0];
}

function normalizarConfig(row: any) {
  const jogos = Array.isArray(row?.games) ? row.games.filter((g: string) => (JOGOS as readonly string[]).includes(g)) : [...JOGOS];
  const premios = (Array.isArray(row?.prizes) ? row.prizes : [])
    .map((p: any) => ({ posicao: Math.round(Number(p?.posicao)), descricao: String(p?.descricao ?? "").trim().slice(0, 80) }))
    .filter((p: any) => p.posicao >= 1 && p.posicao <= 3 && p.descricao)
    .sort((a: any, b: any) => a.posicao - b.posicao);
  return {
    ranking_ativo: row?.ranking_enabled === true,
    jogos: jogos.length ? jogos : [...JOGOS],
    premios,
    regras: row?.rules ? String(row.rules).slice(0, 500) : "",
  };
}

async function lerConfig(admin: any, tenantId: string) {
  const { data } = await admin.from("game_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  return normalizarConfig(data);
}

interface Linha { customer_id: string | null; player_phone: string; player_name: string; score: number; created_at: string }
const chaveJogador = (r: { customer_id?: string | null; player_phone: string }) => r.customer_id ? "c:" + r.customer_id : "f:" + r.player_phone;

/** Melhor pontuação de cada pessoa na semana; empate = quem fez primeiro fica na frente. */
async function rankingSemana(admin: any, tenantId: string, semana: string, jogo: string): Promise<Linha[]> {
  const { data, error } = await admin.from("game_scores")
    .select("customer_id, player_phone, player_name, score, created_at")
    .eq("tenant_id", tenantId).eq("week_start", semana).eq("game", jogo)
    .order("score", { ascending: false }).order("created_at", { ascending: true })
    .limit(5000);
  if (error) throw error;
  const vistos = new Set<string>();
  const lista: Linha[] = [];
  for (const r of data ?? []) {
    const k = chaveJogador(r);
    if (vistos.has(k)) continue;
    vistos.add(k);
    lista.push(r);
  }
  return lista;
}

function publico(lista: Linha[], eu: string | null, n = 10) {
  return lista.slice(0, n).map((r, i) => ({
    posicao: i + 1,
    nome: nomeCurto(r.player_name),
    final: r.player_phone.slice(-2),
    pontos: r.score,
    eu: !!eu && chaveJogador(r) === eu,
  }));
}

/** Jogar é só para membro do clube (regra do dono, 2026-09-27): o cartão do clube
 *  (token do aparelho, `clube-publico`) identifica quem joga — nome e celular vêm do cadastro. */
async function membroDoClube(admin: any, tenantId: string, token: unknown): Promise<{ customerId: string; nome: string; fone: string } | null> {
  const sessao = await sessaoDoClube(admin, token);
  if (!sessao || sessao.tenant_id !== tenantId) return null;
  if (!(await programaLigado(admin, tenantId))) return null;
  const { data: c } = await admin.from("customers").select("id, name, phone").eq("id", sessao.customer_id).maybeSingle();
  if (!c) return null;
  return { customerId: c.id, nome: String(c.name || "Cliente").trim().slice(0, 40), fone: normalizarFone(c.phone) };
}

/** Pedido em andamento que dá direito a jogar (regra do dono, 2026-09-27: só joga depois
 *  de pedir e o jogo para quando o pedido é entregue). Mesa: participante + senha, pedido
 *  mais recente não entregue. Delivery: nº do pedido (+ celular do pedido quando `fone`). */
type Direito = { orderId: string } | { erro: string; code: "sem_pedido" | "entregue" };
async function pedidoEmAndamento(admin: any, tenantId: string, cred: any, fone: string | null): Promise<Direito> {
  const desde = new Date(Date.now() - JANELA_PEDIDO_H * 3600_000).toISOString();
  let pedidos: any[] = [];
  if (cred?.tipo === "mesa") {
    const { data: p } = await admin.from("table_session_participants")
      .select("id, tenant_id, access_token, deleted_at").eq("id", String(cred.participant_id ?? "")).maybeSingle();
    if (!p || p.tenant_id !== tenantId || p.deleted_at || String(p.access_token) !== String(cred.access_token ?? "")) {
      return { erro: "Não achamos o seu pedido.", code: "sem_pedido" };
    }
    const { data } = await admin.from("orders").select("id, status, destination_phone")
      .eq("tenant_id", tenantId).eq("participant_id", p.id).neq("status", "cancelled").not("is_draft", "is", true)
      .gte("created_at", desde).order("created_at", { ascending: false }).limit(20);
    pedidos = data ?? [];
  } else if (cred?.tipo === "delivery") {
    const { data } = await admin.from("orders").select("id, status, destination_phone")
      .eq("tenant_id", tenantId).eq("number", String(cred.order_number ?? "")).eq("origin_type", "delivery")
      .neq("status", "cancelled").not("is_draft", "is", true).gte("created_at", desde)
      .order("created_at", { ascending: false }).limit(1);
    pedidos = data ?? [];
    if (pedidos.length && fone && normalizarFone(pedidos[0].destination_phone) !== fone) {
      return { erro: "Use o mesmo celular do pedido.", code: "sem_pedido" };
    }
  } else {
    return { erro: "Faça um pedido para jogar.", code: "sem_pedido" };
  }
  if (!pedidos.length) return { erro: "Faça um pedido para jogar.", code: "sem_pedido" };
  const ativo = pedidos.find((o) => o.status !== "delivered");
  if (!ativo) return { erro: "Seu pedido foi entregue. Faça um novo pedido para continuar jogando.", code: "entregue" };
  return { orderId: ativo.id };
}

async function podeEditar(admin: any, tenantId: string, role: string, userId?: string | null): Promise<boolean> {
  if (isManagerRole(role)) return true;
  // Ajuste da pessoa (Usuários › O que faz, 2026-10-03) vale por cima da matriz do cargo.
  const daPessoa = await ajusteDaPessoaNaLoja(admin, tenantId, userId, ["gestao_promocoes"]);
  if (daPessoa.has("gestao_promocoes")) return daPessoa.get("gestao_promocoes") === true;
  const { data } = await admin.from("permissions").select("allowed")
    .eq("tenant_id", tenantId).eq("role", role).eq("permission_key", "gestao_promocoes")
    .limit(1).maybeSingle();
  return data?.allowed === true;
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
    const tenantId = String(body.tenant_id ?? "");
    if (!action) return jsonErr("action obrigatoria");
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return jsonErr("tenant_id obrigatorio");
    const agora = Date.now();
    const semana = semanaDe(agora);

    // ───────────── público ─────────────
    if (action === "config") {
      const cfg = await lerConfig(admin, tenantId);
      const clube_ativo = await programaLigado(admin, tenantId);
      const { data: t } = await admin.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
      return ok({ ...cfg, clube_ativo, slug: t?.slug ?? null, semana, termina_em: fimDaSemana(semana) });
    }

    // O cliente pode jogar agora? (o jogo para quando o pedido é entregue)
    if (action === "direito") {
      const m = await membroDoClube(admin, tenantId, body.clube_token);
      if (!m) return ok({ pode_jogar: false, motivo: "sem_clube", mensagem: "Os jogos são do clube. Entre no clube para jogar." });
      const d = await pedidoEmAndamento(admin, tenantId, body.credencial, null);
      return ok("erro" in d ? { pode_jogar: false, motivo: d.code, mensagem: d.erro } : { pode_jogar: true });
    }

    if (action === "ranking") {
      const jogo = String(body.jogo ?? "");
      if (!(JOGOS as readonly string[]).includes(jogo)) return jsonErr("jogo inválido");
      const cfg = await lerConfig(admin, tenantId);
      if (!cfg.ranking_ativo) return ok({ ranking_ativo: false, top: [] });
      const m = body.clube_token ? await membroDoClube(admin, tenantId, body.clube_token) : null;
      const eu = m ? "c:" + m.customerId : null;
      const lista = await rankingSemana(admin, tenantId, semana, jogo);
      const idx = eu ? lista.findIndex((r) => chaveJogador(r) === eu) : -1;
      return ok({
        ranking_ativo: true, semana, termina_em: fimDaSemana(semana),
        top: publico(lista, eu),
        eu: idx >= 0 ? { posicao: idx + 1, pontos: lista[idx].score } : null,
        jogadores: lista.length,
      });
    }

    if (action === "start") {
      const jogo = String(body.jogo ?? "");
      if (!(JOGOS as readonly string[]).includes(jogo)) return jsonErr("jogo inválido");
      const cfg = await lerConfig(admin, tenantId);
      if (!cfg.ranking_ativo || !cfg.jogos.includes(jogo)) return jsonErr("Ranking desligado nesta loja.", 409, { code: "ranking_off" });
      const membro = await membroDoClube(admin, tenantId, body.clube_token);
      if (!membro) return jsonErr("Os jogos são do clube. Entre no clube para jogar.", 403, { code: "sem_clube" });
      const direito = await pedidoEmAndamento(admin, tenantId, body.credencial, null);
      if ("erro" in direito) return jsonErr(direito.erro, 403, { code: direito.code });

      const { count: porPedido } = await admin.from("game_sessions").select("id", { count: "exact", head: true })
        .eq("order_id", direito.orderId);
      if ((porPedido ?? 0) >= MAX_PARTIDAS_POR_PEDIDO) return jsonErr("Você já jogou bastante com este pedido! Faça um novo pedido para continuar valendo.", 429, { code: "limite" });
      const { count: porDia } = await admin.from("game_sessions").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("customer_id", membro.customerId).gte("started_at", new Date(agora - 86400_000).toISOString());
      if ((porDia ?? 0) >= MAX_PARTIDAS_POR_DIA) return jsonErr("Limite de partidas do dia atingido.", 429, { code: "limite" });

      const seed = crypto.getRandomValues(new Uint32Array(1))[0] | 0;
      const { data: s, error } = await admin.from("game_sessions").insert({
        tenant_id: tenantId, game: jogo, seed, order_id: direito.orderId, customer_id: membro.customerId,
        player_phone: membro.fone, player_name: membro.nome,
      }).select("id, seed").single();
      if (error) throw error;
      return ok({ sessao: s.id, semente: Number(s.seed) });
    }

    if (action === "submit") {
      const sessaoId = String(body.sessao ?? "");
      const entradas = body.entradas;
      if (!/^[0-9a-f-]{36}$/i.test(sessaoId)) return jsonErr("sessão inválida");
      if (!Array.isArray(entradas) || entradas.length > MAX_ENTRADAS) return jsonErr("partida inválida");
      const quadros: number[] = [];
      for (const q of entradas) {
        const n = Number(q);
        if (!Number.isInteger(n) || n < 1 || (quadros.length && n <= quadros[quadros.length - 1])) return jsonErr("partida inválida");
        quadros.push(n);
      }
      const { data: s } = await admin.from("game_sessions").select("*").eq("id", sessaoId).eq("tenant_id", tenantId).maybeSingle();
      if (!s) return jsonErr("Partida não encontrada.", 404);
      if (s.finished_at) return jsonErr("Esta partida já foi registrada.", 409);
      const inicio = new Date(s.started_at).getTime();
      const decorridoS = (agora - inicio) / 1000;
      if (decorridoS > 3 * 3600) return jsonErr("Partida expirada.", 409);
      // não dá para ter jogado mais quadros do que o tempo que passou (+10 s de folga)
      const limite = Math.ceil(decorridoS * 60) + 600;
      const e = s.game === "voa" ? refazerVoa(Number(s.seed), quadros, limite) : refazerCorre(Number(s.seed), quadros, limite);
      if (e.fase !== "fim") return jsonErr("Partida não confere.", 422, { code: "nao_confere" });
      const pontos = e.pontos;

      const { error: eu } = await admin.from("game_sessions").update({ finished_at: new Date(agora).toISOString() })
        .eq("id", s.id).is("finished_at", null);
      if (eu) throw eu;
      const semanaPartida = semanaDe(inicio);
      const { error: ei } = await admin.from("game_scores").insert({
        tenant_id: tenantId, game: s.game, session_id: s.id, customer_id: s.customer_id, player_phone: s.player_phone, player_name: s.player_name,
        score: pontos, frames: e.quadro, inputs: quadros, week_start: semanaPartida,
      });
      if (ei) {
        if (String(ei.code) === "23505") return jsonErr("Esta partida já foi registrada.", 409);
        throw ei;
      }
      const lista = await rankingSemana(admin, tenantId, semanaPartida, s.game);
      const euChave = chaveJogador(s);
      const idx = lista.findIndex((r) => chaveJogador(r) === euChave);
      return ok({
        pontos,
        melhor: idx >= 0 ? lista[idx].score : pontos,
        posicao: idx >= 0 ? idx + 1 : null,
        jogadores: lista.length,
        top: publico(lista, euChave),
      });
    }

    // ───────────── loja ─────────────
    if (!action.startsWith("admin_")) return jsonErr("ação desconhecida");
    const caller = await authenticate(req, admin);
    if (!caller) return jsonErr("Não autenticado", 401);
    if (!caller.isServiceRole) {
      const role = await tenantRole(admin, caller.userId!, tenantId);
      if (!role) return jsonErr("Sem acesso a esta loja.", 403);
      if (!(await podeEditar(admin, tenantId, role, caller.userId))) return jsonErr("Sem permissão (Promoções).", 403);
    }

    if (action === "admin_get") {
      const cfg = await lerConfig(admin, tenantId);
      const semanas = [0, 1, 2, 3, 4].map((i) => somarDias(semana, -7 * i));
      const { data: premiados } = await admin.from("game_awards").select("*")
        .eq("tenant_id", tenantId).gte("week_start", semanas[semanas.length - 1]);
      const jogos: Record<string, unknown> = {};
      for (const jogo of JOGOS) {
        const atual = await rankingSemana(admin, tenantId, semana, jogo);
        const anteriores = [];
        for (const w of semanas.slice(1)) {
          const l = await rankingSemana(admin, tenantId, w, jogo);
          if (!l.length) continue;
          anteriores.push({
            semana: w,
            jogadores: l.length,
            top: l.slice(0, 3).map((r, i) => {
              const p = (premiados ?? []).find((a: any) => a.week_start === w && a.game === jogo && a.position === i + 1);
              return { posicao: i + 1, nome: r.player_name, telefone: r.player_phone, pontos: r.score, entregue_em: p?.delivered_at ?? null, premio: p?.prize ?? null };
            }),
          });
        }
        jogos[jogo] = {
          semana_atual: { semana, termina_em: fimDaSemana(semana), jogadores: atual.length, top: atual.slice(0, 10).map((r, i) => ({ posicao: i + 1, nome: r.player_name, telefone: r.player_phone, pontos: r.score })) },
          anteriores,
        };
      }
      const { count: partidas } = await admin.from("game_scores").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("week_start", semana);
      return ok({ config: cfg, semana, jogos, partidas_semana: partidas ?? 0 });
    }

    if (action === "admin_save") {
      const c = body.config ?? {};
      const cfg = normalizarConfig({ ranking_enabled: c.ranking_ativo === true, games: c.jogos, prizes: c.premios, rules: c.regras });
      const { error } = await admin.from("game_settings").upsert({
        tenant_id: tenantId, ranking_enabled: cfg.ranking_ativo, games: cfg.jogos, prizes: cfg.premios,
        rules: cfg.regras || null, updated_at: new Date().toISOString(), updated_by: caller.userId ?? null,
      }, { onConflict: "tenant_id" });
      if (error) throw error;
      return ok({ config: cfg });
    }

    if (action === "admin_award" || action === "admin_unaward") {
      const w = String(body.semana ?? "");
      const jogo = String(body.jogo ?? "");
      const posicao = Math.round(Number(body.posicao));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(w) || !(JOGOS as readonly string[]).includes(jogo) || !(posicao >= 1 && posicao <= 3)) return jsonErr("dados inválidos");
      if (action === "admin_unaward") {
        const { error } = await admin.from("game_awards").delete().eq("tenant_id", tenantId).eq("week_start", w).eq("game", jogo).eq("position", posicao);
        if (error) throw error;
        return ok({});
      }
      if (w >= semana) return jsonErr("A semana ainda não terminou.", 409);
      const lista = await rankingSemana(admin, tenantId, w, jogo);
      const r = lista[posicao - 1];
      if (!r) return jsonErr("Ninguém nessa posição.", 404);
      const cfg = await lerConfig(admin, tenantId);
      const premio = cfg.premios.find((p: any) => p.posicao === posicao)?.descricao ?? null;
      const { error } = await admin.from("game_awards").upsert({
        tenant_id: tenantId, week_start: w, game: jogo, position: posicao, player_phone: r.player_phone,
        player_name: r.player_name, score: r.score, prize: premio, delivered_at: new Date().toISOString(),
        delivered_by: caller.userId ?? null,
      }, { onConflict: "tenant_id,week_start,game,position" });
      if (error) throw error;
      return ok({});
    }

    return jsonErr("ação desconhecida");
  } catch (err) {
    console.error("[jogos]", err);
    return jsonErr("Erro interno", 500);
  }
});
