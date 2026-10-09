// App do clube — a página /clube/<loja> instalada no celular do cliente (PWA com o
// nome, o ícone e a cor da LOJA). Lado do cliente + a "cara do app" da loja.
//
// Público:
//   GET ?manifest=<slug>   → manifest do app da loja (404 se a loja não ativou o app).
//                            Servido pelo próprio site via rewrite (vercel.json).
//   loja        {slug}                          → nome, logo, cores, app ativo + regras públicas
//   app_resumo  {slug|tenant_id}                → o app desta loja está ligado? (convite no tablet/delivery/mesa)
//   push_chave  {}                              → chave VAPID pública
//   entrar      {slug|tenant_id, cpf, celular, aparelho, nome?, nascimento?, aceita_termos?, aceita_ofertas?}
//               → {token} | {precisa_cadastro:true}. Membro: CPF + celular COMPLETO.
//                 CPF novo: com nome + aceite, cadastra (mesma regra da página).
//   entrar_link {token_link, aparelho}          → {token} (QR do tablet, uso único)
// Com o cartão do clube (token do aparelho):
//   estado      {endpoint?}                     → aparelho (digital, bloqueado?), preferências, avisos novos
//   eu                                          → resumo + extrato + regras
//   passkey_opcoes    {tipo: registro|abrir|premio} → opções WebAuthn (desafio na sessão, 5 min, uso único)
//   passkey_registrar {resposta}                → liga a digital NESTE aparelho (abrir + prêmio)
//   passkey_confirmar {resposta}                → desbloqueia por 30 min
//   seguranca   {digital_abrir?, digital_premio?} → muda as travas (pede digital recente)
//   aparelhos                                   → aparelhos conectados
//   aparelho_sair {session_id | todos_outros}   → desconecta (pede digital recente se tem digital)
//   push_inscrever {subscription, pontos, promocoes} · push_sair {endpoint} · prefs {...}
//   avisos      {lidos?}                        → caixa de avisos
//   reservar    {recompensa_id|beneficio_id, resposta?} → reserva p/ pedido (digital se ligada p/ prêmio)
//   girar · liberar {hold_ids} · sair
//   indicacao                                   → código/link "Indique e ganhe" + quantas deram prêmio
//   (entrar com {indicacao: código} num CPF NOVO registra quem indicou; o prêmio sai no banco,
//    na 1ª compra paga do indicado — fn_clube_indicacao_conferir.)
// Loja (JWT do ERPOS; admin/gerente ou gestao_promocoes):
//   admin_get    {tenant_id}
//   admin_salvar {tenant_id, ativo, nome_curto, cor, cor_destaque, icones?: {192|512|mask512|apple180: dataURL png}}
//
// Segurança: o CPF + celular abre o cartão (mesma trava da página: 5 erros = 15 min,
// limite por IP). A digital (passkey) nunca sai do celular: guardamos só a chave
// pública e conferimos a assinatura de cada uso. "Digital para abrir" trava a leitura
// dos dados e "digital para prêmio" trava o uso de pontos, AQUI no servidor (não só na tela).
// Aparelho novo entrando → aviso nos outros aparelhos do cliente (sempre ligado).
// verify_jwt = false no deploy.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13.2.3";
import { isoBase64URL } from "npm:@simplewebauthn/server@13.2.3/helpers";
import { authenticate, isManagerRole, tenantRole } from "../_shared/tenant-auth.ts";
import { cpfValido, normalizarConfig, soDigitos } from "../_shared/fidelidade.ts";
import {
  cadastrarNoClube, conferirCelularCompleto, criarSessao, dentroDoLimite, idsValidos, membroPorCpf, sessaoDoClube, sha256Hex,
  type SessaoClube,
} from "../_shared/clube-servidor.ts";
import { dadosDoClienteDoClube, programaPublicoDaLoja } from "../_shared/clube-dados.ts";
import { enviarPush } from "../send-push/webpush.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const V = "v1";
const DESBLOQUEIO_MIN = 30;
const BUCKET = "menu-images";

function resp(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ _v: V, ...payload }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const erro = (msg: string, status = 400, codigo?: string) => resp({ error: codigo ?? msg, message: msg }, status);
const erroRpc = (e: any) => String(e?.message ?? e ?? "Erro").replace(/^.*?ERROR:\s*/i, "").slice(0, 200);
const HEX = /^#[0-9a-f]{6}$/i;

// Origens que podem usar a digital: o site, os previews deste projeto na Vercel e o
// dev local. A chave da digital fica presa ao domínio (rpID) — a de um não serve no outro.
function origemPermitida(origem: string): boolean {
  if (origem === "https://erpos.vercel.app") return true;
  if (/^https:\/\/erpos-[a-z0-9-]+-natalinojrs-projects\.vercel\.app$/.test(origem)) return true;
  if (/^http:\/\/localhost:\d{2,5}$/.test(origem)) return true;
  const extras = (Deno.env.get("CLUBE_APP_ORIGENS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return extras.includes(origem);
}

function horaBR(d = new Date()): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function podeEditar(admin: any, tenantId: string, role: string): Promise<boolean> {
  if (isManagerRole(role)) return true;
  const { data } = await admin.from("permissions").select("allowed")
    .eq("tenant_id", tenantId).eq("role", role).eq("permission_key", "gestao_promocoes").limit(1).maybeSingle();
  return data?.allowed === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const vapid = {
    publicKey: Deno.env.get("VAPID_PUBLIC_KEY") ?? "",
    privateKey: Deno.env.get("VAPID_PRIVATE_KEY") ?? "",
    subject: Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  };

  async function lojaPorSlug(slug: unknown) {
    const s = String(slug ?? "").trim();
    if (!s || s.length > 120) return null;
    const { data } = await admin.from("tenants").select("id, name, slug, is_active, logo_url, brand_color").eq("slug", s).limit(1).maybeSingle();
    return data && data.is_active !== false ? data : null;
  }
  async function lojaPorId(id: unknown) {
    const t = String(id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(t)) return null;
    const { data } = await admin.from("tenants").select("id, name, slug, is_active, logo_url, brand_color").eq("id", t).maybeSingle();
    return data && data.is_active !== false ? data : null;
  }
  async function appDaLoja(tenantId: string) {
    const { data } = await admin.from("loyalty_app_config").select("*").eq("tenant_id", tenantId).maybeSingle();
    return data;
  }
  const iconesProntos = (app: any) => !!(app?.icones?.["192"] && app?.icones?.["512"]);
  /** Indique e ganhe, como o cliente vê (null = desligado). */
  async function indicacaoPublica(tenantId: string) {
    const { data: prog } = await admin.from("loyalty_programs").select("enabled, config").eq("tenant_id", tenantId).maybeSingle();
    if (!prog?.enabled) return null;
    const c = normalizarConfig(prog.config);
    const i = c.indicacao;
    if (!i.ativo) return null;
    const rw = i.premio_tipo === "recompensa" ? c.recompensas.find((r) => r.id === i.recompensa_id && r.ativo) : null;
    if (i.premio_tipo === "recompensa" && !rw) return null;
    if (i.premio_tipo === "pontos" && i.pontos <= 0) return null;
    return {
      premio: i.premio_tipo === "pontos" ? `${i.pontos} pontos` : rw!.nome,
      bonus_indicado: i.bonus_indicado, limite_mes: i.limite_mes,
    };
  }

  try {
    // ── Manifest do app da loja (GET) ────────────────────────────────────────
    if (req.method === "GET") {
      const slug = new URL(req.url).searchParams.get("manifest");
      const loja = await lojaPorSlug(slug);
      const app = loja ? await appDaLoja(loja.id) : null;
      const prog = loja ? await programaPublicoDaLoja(admin, loja.id) : null;
      if (!loja || !prog || !app?.ativo || !iconesProntos(app)) {
        return new Response(JSON.stringify({ error: "App não disponível" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const cor = HEX.test(app.cor ?? "") ? app.cor : (HEX.test(loja.brand_color ?? "") ? loja.brand_color : "#C2410C");
      const caminho = `/clube/${loja.slug}`;
      const manifest = {
        id: caminho,
        name: loja.name,
        short_name: (app.nome_curto || loja.name).slice(0, 12),
        description: `${prog.nome} — ${loja.name}`,
        start_url: `${caminho}?origem=app`,
        scope: caminho,
        display: "standalone",
        orientation: "portrait",
        background_color: cor,
        theme_color: cor,
        lang: "pt-BR",
        dir: "ltr",
        icons: [
          { src: app.icones["192"], sizes: "192x192", type: "image/png", purpose: "any" },
          { src: app.icones["512"], sizes: "512x512", type: "image/png", purpose: "any" },
          ...(app.icones.mask512 ? [{ src: app.icones.mask512, sizes: "512x512", type: "image/png", purpose: "maskable" }] : []),
        ],
      };
      return new Response(JSON.stringify(manifest), {
        headers: { ...corsHeaders, "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=300" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    // IP para o limite de tentativas: cf-connecting-ip (posto pelo Cloudflare) antes do
    // X-Forwarded-For, que o próprio cliente consegue inventar.
    const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? (req.headers.get("x-forwarded-for") ?? "?").split(",").pop() ?? "?").trim();

    // ── Parte da loja (ERPOS logado) ─────────────────────────────────────────
    if (action === "admin_get" || action === "admin_salvar") {
      const tenantId = String(body.tenant_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return erro("tenant_id obrigatório");
      const caller = await authenticate(req, admin);
      if (!caller) return erro("Não autenticado", 401);
      let role = "admin";
      if (!caller.isServiceRole) {
        const r = await tenantRole(admin, caller.userId!, tenantId);
        if (!r) return erro("Sem acesso a esta loja.", 403);
        role = r;
      }
      const editavel = caller.isServiceRole || await podeEditar(admin, tenantId, role);
      const loja = await lojaPorId(tenantId);
      if (!loja) return erro("Loja não encontrada.", 404);
      const app = await appDaLoja(tenantId);

      if (action === "admin_get") {
        return resp({ editavel, app: app ?? null, loja: { nome: loja.name, slug: loja.slug, logo: loja.logo_url, cor: loja.brand_color } });
      }

      if (!editavel) return erro("Seu perfil não pode alterar o app do clube.", 403);
      const nomeCurto = String(body.nome_curto ?? "").trim().replace(/\s+/g, " ");
      if (nomeCurto.length < 1 || nomeCurto.length > 12) return erro("O nome embaixo do ícone precisa ter de 1 a 12 letras.");
      const cor = String(body.cor ?? "");
      const corDestaque = String(body.cor_destaque ?? "");
      if (!HEX.test(cor)) return erro("Cor inválida.");
      if (corDestaque && !HEX.test(corDestaque)) return erro("Cor de destaque inválida.");

      let icones = app?.icones ?? {};
      let versao = Number(app?.versao ?? 0);
      if (body.icones && typeof body.icones === "object") {
        versao += 1;
        const novos: Record<string, string> = {};
        for (const k of ["192", "512", "mask512", "apple180"]) {
          const v = String(body.icones[k] ?? "");
          const m = v.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
          if (!m) return erro(`Ícone ${k} inválido.`);
          const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
          if (bytes.length > 600_000) return erro(`Ícone ${k} grande demais.`);
          // Assinatura PNG: \x89PNG
          if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return erro(`Ícone ${k} não é PNG.`);
          const caminho = `${tenantId}/clube-app/v${versao}/icone-${k}.png`;
          const { error: upErr } = await admin.storage.from(BUCKET).upload(caminho, bytes, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
          if (upErr) throw upErr;
          novos[k] = admin.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl;
        }
        icones = novos;
      }
      const ativo = body.ativo === true;
      if (ativo && !iconesProntos({ icones })) return erro("Gere os ícones antes de ligar o app.");
      const linha = {
        tenant_id: tenantId, ativo, nome_curto: nomeCurto, cor, cor_destaque: corDestaque || null, icones, versao,
        updated_at: new Date().toISOString(), updated_by: caller.userId,
      };
      const { data: salvo, error } = await admin.from("loyalty_app_config").upsert(linha, { onConflict: "tenant_id" }).select("*").single();
      if (error) throw error;
      return resp({ app: salvo });
    }

    // ── Público ─────────────────────────────────────────────────────────────
    if (action === "push_chave") {
      if (!vapid.publicKey) return erro("Notificações não configuradas.", 500);
      return resp({ chave: vapid.publicKey });
    }

    // Convite "Baixe o app" no tablet, no delivery e na mesa: só o essencial (sem logo pesada).
    if (action === "app_resumo") {
      const loja = body.slug ? await lojaPorSlug(body.slug) : await lojaPorId(body.tenant_id);
      if (!loja) return resp({ ativo: false });
      const [app, programa] = await Promise.all([appDaLoja(loja.id), programaPublicoDaLoja(admin, loja.id)]);
      if (!programa || !app?.ativo || !iconesProntos(app)) return resp({ ativo: false });
      return resp({
        ativo: true, slug: loja.slug, nome: loja.name, nome_curto: app.nome_curto || loja.name,
        icone: app.icones["192"], programa: programa.nome,
      });
    }

    if (action === "loja") {
      const loja = await lojaPorSlug(body.slug);
      if (!loja) return erro("Loja não encontrada.", 404);
      const [app, programa, indicacao] = await Promise.all([appDaLoja(loja.id), programaPublicoDaLoja(admin, loja.id), indicacaoPublica(loja.id)]);
      const appAtivo = !!(app?.ativo && iconesProntos(app));
      return resp({
        loja: {
          tenant_id: loja.id, nome: loja.name, slug: loja.slug, logo: loja.logo_url ?? null,
          cor: (HEX.test(app?.cor ?? "") ? app.cor : null) ?? (HEX.test(loja.brand_color ?? "") ? loja.brand_color : null),
          cor_destaque: HEX.test(app?.cor_destaque ?? "") ? app.cor_destaque : null,
          nome_curto: app?.nome_curto ?? null,
        },
        app: appAtivo ? { ativo: true, icone: app.icones["192"], apple: app.icones.apple180 ?? app.icones["192"] } : { ativo: false },
        clube_ativo: !!programa,
        programa,
        indicacao,
      });
    }

    // Aparelho novo entrou: avisa os OUTROS aparelhos do cliente (sempre — é segurança).
    // Primeiro acesso (sem outro aparelho ativo) não gera aviso.
    async function avisarAparelhoNovo(tenantId: string, customerId: string, tokenNovo: string, aparelho: string) {
      const agora = new Date().toISOString();
      const { data: novo } = await admin.from("loyalty_sessions").select("id").eq("token_hash", await sha256Hex(tokenNovo)).maybeSingle();
      const { count } = await admin.from("loyalty_sessions").select("id", { count: "exact", head: true })
        .eq("customer_id", customerId).is("revoked_at", null).gt("expires_at", agora).neq("id", novo?.id ?? "00000000-0000-0000-0000-000000000000");
      if (!count) return;
      const { data: loja } = await admin.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
      const app = await appDaLoja(tenantId);
      const titulo = "Um aparelho novo entrou no seu clube";
      const corpo = `${aparelho || "Aparelho novo"} entrou às ${horaBR().slice(-5)}. Não foi você? Toque para desconectar.`;
      const url = `/clube/${loja?.slug ?? ""}?aba=eu&aparelhos=1`;
      await admin.from("loyalty_avisos").insert({ tenant_id: tenantId, customer_id: customerId, tipo: "aparelho_novo", titulo, corpo, url });
      await enviarParaCliente(customerId, { titulo, corpo, url, tag: "clube-seguranca", icone: app?.icones?.["192"] ?? null }, novo?.id ?? null);
    }

    async function enviarParaCliente(customerId: string, aviso: Record<string, unknown>, excetoSessao: string | null) {
      if (!vapid.publicKey || !vapid.privateKey) return;
      // Só aparelhos com o cartão ainda válido (saiu/venceu = não recebe mais).
      const { data: ativas } = await admin.from("loyalty_sessions").select("id")
        .eq("customer_id", customerId).is("revoked_at", null).gt("expires_at", new Date().toISOString());
      const sessoes = (ativas ?? []).map((x: any) => x.id).filter((id: string) => id !== excetoSessao);
      if (!sessoes.length) return;
      const { data: subs } = await admin.from("loyalty_push_subscriptions").select("id, endpoint, p256dh, auth, failure_count")
        .eq("customer_id", customerId).in("session_id", sessoes);
      for (const s of subs ?? []) {
        const r = await enviarPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, JSON.stringify(aviso), vapid);
        if (r.ok) await admin.from("loyalty_push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", s.id);
        else if (r.expirada || (s.failure_count ?? 0) >= 5) await admin.from("loyalty_push_subscriptions").delete().eq("id", s.id);
        else await admin.from("loyalty_push_subscriptions").update({ failure_count: (s.failure_count ?? 0) + 1 }).eq("id", s.id);
      }
    }
    function emSegundoPlano(p: Promise<unknown>) {
      const seguro = p.catch((e) => console.error("[clube-app] segundo plano", e?.message ?? e));
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(seguro); else return seguro;
    }
    const nomeAparelho = (v: unknown) => String(v ?? "").replace(/[^\p{L}\p{N} ·()./-]/gu, "").trim().slice(0, 60) || null;

    if (action === "entrar") {
      if (!(await dentroDoLimite(admin, `clubeapp:entrar:${ip}`, 20, 15))) return erro("Muitas tentativas deste aparelho. Espere 15 minutos.", 429);
      const loja = body.slug ? await lojaPorSlug(body.slug) : await lojaPorId(body.tenant_id);
      if (!loja) return erro("Loja não encontrada.", 404);
      if (!(await programaPublicoDaLoja(admin, loja.id))) return erro("O clube desta loja não está ativo.");
      const cpf = soDigitos(body.cpf);
      if (!cpfValido(cpf)) return erro("CPF inválido. Confira os números.");
      const celular = soDigitos(body.celular);
      if (celular.length < 10 || celular.length > 13) return erro("Digite o celular com DDD.");
      let customerId = await membroPorCpf(admin, loja.id, cpf);
      if (customerId) {
        const e = await conferirCelularCompleto(admin, customerId, celular);
        if (e) return erro(e);
      } else {
        // CPF que não é do clube: pede o nome e o aceite (é o cadastro). Mesma regra da
        // página: CPF já conhecido da loja (caixa/nota) não vira membro pela internet.
        if (!String(body.nome ?? "").trim()) return resp({ precisa_cadastro: true });
        const r = await cadastrarNoClube(admin, loja.id, { ...body, cpf, celular }, { web: true });
        if (r.erro) {
          return erro(r.erro.startsWith("Este CPF já tem cadastro")
            ? "Este CPF já tem cadastro na loja. Peça ao caixa para ativar o clube nele."
            : r.erro);
        }
        customerId = r.customerId!;
        // Veio pelo link de alguém: registra quem indicou (o prêmio sai na 1ª compra paga).
        const codigo = String(body.indicacao ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
        if (codigo && await indicacaoPublica(loja.id)) {
          const { data: cod } = await admin.from("loyalty_indicacao_codigos").select("customer_id").eq("codigo", codigo).eq("tenant_id", loja.id).maybeSingle();
          if (cod && cod.customer_id !== customerId) {
            await admin.from("loyalty_indicacoes").upsert(
              { tenant_id: loja.id, indicador_id: cod.customer_id, indicado_id: customerId },
              { onConflict: "indicado_id", ignoreDuplicates: true },
            );
          }
        }
      }
      const aparelho = nomeAparelho(body.aparelho);
      const token = await criarSessao(admin, loja.id, customerId, "app", aparelho);
      await emSegundoPlano(avisarAparelhoNovo(loja.id, customerId, token, aparelho ?? ""));
      return resp({ token });
    }

    if (action === "entrar_link") {
      if (!(await dentroDoLimite(admin, `clubeapp:entrar_link:${ip}`, 20, 15))) return erro("Muitas tentativas deste aparelho. Espere 15 minutos.", 429);
      const t = String(body.token_link ?? "");
      if (!/^[0-9a-f]{64}$/.test(t)) return erro("Link inválido.");
      const agora = new Date().toISOString();
      const { data: link } = await admin.from("loyalty_login_links").update({ used_at: agora })
        .eq("token_hash", await sha256Hex(t)).is("used_at", null).gt("expires_at", agora)
        .select("tenant_id, customer_id").maybeSingle();
      if (!link) return erro("Este QR já foi usado ou venceu. Gere outro no tablet.");
      const aparelho = nomeAparelho(body.aparelho);
      const token = await criarSessao(admin, link.tenant_id, link.customer_id, "qr_tablet", aparelho);
      await emSegundoPlano(avisarAparelhoNovo(link.tenant_id, link.customer_id, token, aparelho ?? ""));
      return resp({ token });
    }

    // ── Daqui para baixo: precisa do cartão do clube ─────────────────────────
    const sessao = await sessaoDoClube(admin, body.token);
    if (!sessao) return erro("Sua sessão do clube acabou. Entre de novo.", 401, "sessao");

    const agoraMs = Date.now();
    const desbloqueado = (s: SessaoClube) => !!s.desbloqueado_ate && new Date(s.desbloqueado_ate).getTime() > agoraMs;
    const { data: chaves } = await admin.from("loyalty_passkeys").select("id, credential_id, public_key, counter, transports")
      .eq("session_id", sessao.id);
    const temDigital = (chaves ?? []).length > 0;
    const bloqueado = sessao.digital_abrir && temDigital && !desbloqueado(sessao);

    // Ações que mostram dados ou gastam pontos respeitam a trava "digital para abrir".
    const LIVRES = new Set(["estado", "sair", "passkey_opcoes", "passkey_confirmar", "passkey_registrar", "liberar", "push_sair"]);
    if (bloqueado && !LIVRES.has(action)) return erro("Confirme com a sua digital para abrir.", 423, "bloqueado");
    // Uso dentro da janela desbloqueada estica a janela (o app pede de novo ao voltar depois de 5 min).
    if (temDigital && desbloqueado(sessao) && !LIVRES.has(action)) {
      const restante = new Date(sessao.desbloqueado_ate!).getTime() - agoraMs;
      if (restante < (DESBLOQUEIO_MIN - 5) * 60_000) {
        await admin.from("loyalty_sessions").update({ desbloqueado_ate: new Date(agoraMs + DESBLOQUEIO_MIN * 60_000).toISOString() }).eq("id", sessao.id);
      }
    }

    // Digital (WebAuthn): o domínio do site é o "dono" da chave.
    function origemRp(): { origem: string; rpID: string } | null {
      const origem = req.headers.get("origin") ?? "";
      if (!origemPermitida(origem)) return null;
      return { origem, rpID: new URL(origem).hostname };
    }
    async function pegarDesafio(): Promise<{ desafio: string | null; tipo: string | null; vencido: boolean }> {
      // Uso único e atômico: lê e apaga na mesma operação (dois pedidos juntos não usam o mesmo).
      const { data: linhas, error } = await admin.rpc("fn_clube_pegar_desafio", { p_session: sessao!.id });
      if (error) throw error;
      const data = (linhas ?? [])[0];
      return {
        desafio: data?.desafio ?? null, tipo: data?.tipo ?? null,
        vencido: !data?.ate || new Date(data.ate).getTime() < Date.now(),
      };
    }
    /** Confere uma assinatura da digital deste aparelho. null = ok; senão a mensagem. */
    async function conferirDigital(resposta: any, tipo: "abrir" | "premio"): Promise<string | null> {
      const o = origemRp();
      if (!o) return "Origem não permitida.";
      const d = await pegarDesafio();
      if (!d.desafio || d.vencido || d.tipo !== tipo) return "A confirmação venceu. Tente de novo.";
      const credId = String(resposta?.id ?? "");
      const ch = (chaves ?? []).find((c: any) => c.credential_id === credId);
      if (!ch) return "Esta digital não é deste aparelho.";
      try {
        const v = await verifyAuthenticationResponse({
          response: resposta, expectedChallenge: d.desafio, expectedOrigin: o.origem, expectedRPID: o.rpID,
          credential: { id: ch.credential_id, publicKey: isoBase64URL.toBuffer(ch.public_key), counter: Number(ch.counter ?? 0), transports: ch.transports ?? undefined },
          requireUserVerification: true,
        });
        if (!v.verified) return "Não deu para confirmar a digital.";
        await admin.from("loyalty_passkeys").update({ counter: v.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }).eq("id", ch.id);
        return null;
      } catch (e) {
        console.error("[clube-app] digital", (e as Error)?.message);
        return "Não deu para confirmar a digital.";
      }
    }
    const marcarDesbloqueado = () => admin.from("loyalty_sessions")
      .update({ desbloqueado_ate: new Date(Date.now() + DESBLOQUEIO_MIN * 60_000).toISOString() }).eq("id", sessao!.id);
    // Mudar trava ou desconectar aparelho: com digital no aparelho, pede a digital NO PRÓPRIO
    // pedido (não basta a janela de 30 min — quem pega o celular aberto não desliga a trava).
    async function digitalFresca(): Promise<Response | null> {
      if (!temDigital) return null;
      if (!body.resposta) return erro("Confirme com a sua digital.", 403, "precisa_digital");
      const e = await conferirDigital(body.resposta, "abrir");
      return e ? erro(e, 400, "digital") : null;
    }

    if (action === "estado") {
      const [{ data: prefs }, { count: novos }, sub] = await Promise.all([
        admin.from("loyalty_member_prefs").select("avisos_pontos, avisos_promocoes").eq("customer_id", sessao.customer_id).maybeSingle(),
        admin.from("loyalty_avisos").select("id", { count: "exact", head: true }).eq("customer_id", sessao.customer_id).is("lido_em", null),
        body.endpoint
          ? admin.from("loyalty_push_subscriptions").select("id").eq("endpoint", String(body.endpoint)).eq("session_id", sessao.id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return resp({
        aparelho: {
          id: sessao.id, nome: sessao.aparelho, tem_digital: temDigital,
          digital_abrir: sessao.digital_abrir && temDigital, digital_premio: sessao.digital_premio && temDigital, bloqueado,
        },
        prefs: { avisos_pontos: prefs?.avisos_pontos ?? true, avisos_promocoes: prefs?.avisos_promocoes ?? false },
        push_inscrito: !!(sub as any)?.data,
        avisos_novos: novos ?? 0,
      });
    }

    if (action === "eu") {
      return resp(await dadosDoClienteDoClube(admin, sessao.tenant_id, sessao.customer_id));
    }

    if (action === "passkey_opcoes") {
      const o = origemRp();
      if (!o) return erro("Este endereço não pode usar a digital.");
      const tipo = String(body.tipo ?? "");
      let opcoes: any;
      if (tipo === "registro") {
        // Registrar outra digital num aparelho que já tem: só desbloqueado.
        if (temDigital && !desbloqueado(sessao)) return erro("Confirme com a digital atual primeiro.", 423, "bloqueado");
        const [{ data: cli }, { data: loja }] = await Promise.all([
          admin.from("customers").select("name").eq("id", sessao.customer_id).maybeSingle(),
          admin.from("tenants").select("name").eq("id", sessao.tenant_id).maybeSingle(),
        ]);
        const primeiro = String(cli?.name ?? "Cliente").trim().split(/\s+/)[0].slice(0, 30) || "Cliente";
        opcoes = await generateRegistrationOptions({
          rpName: String(loja?.name ?? "Clube").slice(0, 60), rpID: o.rpID,
          userName: `${primeiro} · ${String(loja?.name ?? "").slice(0, 40)}`, userDisplayName: primeiro,
          attestationType: "none",
          excludeCredentials: (chaves ?? []).map((c: any) => ({ id: c.credential_id, transports: c.transports ?? undefined })),
          authenticatorSelection: { residentKey: "discouraged", userVerification: "required", authenticatorAttachment: "platform" },
          timeout: 60_000,
        });
      } else if (tipo === "abrir" || tipo === "premio") {
        if (!temDigital) return erro("Este aparelho não tem digital ligada.", 400, "sem_digital");
        opcoes = await generateAuthenticationOptions({
          rpID: o.rpID, userVerification: "required", timeout: 60_000,
          allowCredentials: (chaves ?? []).map((c: any) => ({ id: c.credential_id, transports: c.transports ?? undefined })),
        });
      } else return erro("tipo inválido");
      await admin.from("loyalty_sessions").update({
        webauthn_desafio: opcoes.challenge, webauthn_desafio_tipo: tipo,
        webauthn_desafio_ate: new Date(Date.now() + 5 * 60_000).toISOString(),
      }).eq("id", sessao.id);
      return resp({ opcoes });
    }

    if (action === "passkey_registrar") {
      const o = origemRp();
      if (!o) return erro("Este endereço não pode usar a digital.");
      if (temDigital && !desbloqueado(sessao)) return erro("Confirme com a digital atual primeiro.", 423, "bloqueado");
      const d = await pegarDesafio();
      if (!d.desafio || d.vencido || d.tipo !== "registro") return erro("A confirmação venceu. Tente de novo.");
      let v: any;
      try {
        v = await verifyRegistrationResponse({
          response: body.resposta, expectedChallenge: d.desafio, expectedOrigin: o.origem, expectedRPID: o.rpID, requireUserVerification: true,
        });
      } catch (e) {
        console.error("[clube-app] registro digital", (e as Error)?.message);
        return erro("Não deu para ligar a digital.");
      }
      if (!v?.verified || !v.registrationInfo) return erro("Não deu para ligar a digital.");
      const c = v.registrationInfo.credential;
      const { error } = await admin.from("loyalty_passkeys").insert({
        tenant_id: sessao.tenant_id, customer_id: sessao.customer_id, session_id: sessao.id,
        credential_id: c.id, public_key: isoBase64URL.fromBuffer(c.publicKey), counter: c.counter ?? 0, transports: c.transports ?? null,
      });
      if (error) throw error;
      await admin.from("loyalty_sessions").update({
        digital_abrir: true, digital_premio: true, desbloqueado_ate: new Date(Date.now() + DESBLOQUEIO_MIN * 60_000).toISOString(),
      }).eq("id", sessao.id);
      return resp({ ok: true });
    }

    if (action === "passkey_confirmar") {
      const e = await conferirDigital(body.resposta, "abrir");
      if (e) return erro(e, 400, "digital");
      await marcarDesbloqueado();
      return resp({ ok: true });
    }

    if (action === "seguranca") {
      if (!temDigital) return erro("Ligue a digital primeiro.", 400, "sem_digital");
      const semDigital = await digitalFresca();
      if (semDigital) return semDigital;
      const mud: Record<string, boolean> = {};
      if (typeof body.digital_abrir === "boolean") mud.digital_abrir = body.digital_abrir;
      if (typeof body.digital_premio === "boolean") mud.digital_premio = body.digital_premio;
      if (Object.keys(mud).length) await admin.from("loyalty_sessions").update(mud).eq("id", sessao.id);
      return resp({ ok: true, ...mud });
    }

    if (action === "aparelhos") {
      const { data } = await admin.from("loyalty_sessions").select("id, aparelho, criado_via, created_at, last_seen_at")
        .eq("customer_id", sessao.customer_id).is("revoked_at", null).gt("expires_at", new Date().toISOString())
        .order("last_seen_at", { ascending: false }).limit(30);
      const ids = (data ?? []).map((s: any) => s.id);
      const { data: comDigital } = ids.length
        ? await admin.from("loyalty_passkeys").select("session_id").in("session_id", ids)
        : { data: [] };
      const digitais = new Set((comDigital ?? []).map((p: any) => p.session_id));
      return resp({
        aparelhos: (data ?? []).map((s: any) => ({
          id: s.id, nome: s.aparelho, via: s.criado_via, desde: s.created_at, visto: s.last_seen_at,
          atual: s.id === sessao.id, digital: digitais.has(s.id),
        })),
      });
    }

    /** Desconecta só sessões DESTE cliente (o que não for dele é ignorado). */
    async function desconectar(ids: string[]): Promise<number> {
      if (!ids.length) return 0;
      const { data: feitas } = await admin.from("loyalty_sessions").update({ revoked_at: new Date().toISOString() })
        .in("id", ids).eq("customer_id", sessao!.customer_id).is("revoked_at", null).select("id");
      const minhas = (feitas ?? []).map((x: any) => x.id);
      if (!minhas.length) return 0;
      await admin.from("loyalty_push_subscriptions").delete().in("session_id", minhas).eq("customer_id", sessao!.customer_id);
      await admin.from("loyalty_passkeys").delete().in("session_id", minhas).eq("customer_id", sessao!.customer_id);
      return minhas.length;
    }

    if (action === "aparelho_sair") {
      const semDigital = await digitalFresca();
      if (semDigital) return semDigital;
      let ids: string[] = [];
      if (body.todos_outros === true) {
        const { data } = await admin.from("loyalty_sessions").select("id").eq("customer_id", sessao.customer_id).is("revoked_at", null).neq("id", sessao.id);
        ids = (data ?? []).map((s: any) => s.id);
      } else {
        const id = idsValidos([body.session_id], 1)[0];
        if (!id || id === sessao.id) return erro("Aparelho inválido.");
        ids = [id];
      }
      // Aparelho que acabou de entrar SEM digital não derruba aparelho COM digital nas
      // primeiras 24 h (quem descobriu CPF + celular não tira o dono da conta na hora).
      if (!temDigital && ids.length) {
        const { data: s } = await admin.from("loyalty_sessions").select("created_at").eq("id", sessao.id).maybeSingle();
        const novo = s && Date.now() - new Date(s.created_at).getTime() < 24 * 3_600_000;
        if (novo) {
          const { count } = await admin.from("loyalty_passkeys").select("id", { count: "exact", head: true })
            .in("session_id", ids).eq("customer_id", sessao.customer_id);
          if (count) return erro("Por segurança, um aparelho que acabou de entrar não desconecta um aparelho com digital. Use o outro aparelho ou fale com a loja.", 403, "aparelho_novo");
        }
      }
      return resp({ desconectados: await desconectar(ids) });
    }

    if (action === "sair") {
      await desconectar([sessao.id]);
      return resp({ saiu: true });
    }

    async function salvarPrefs(pontos?: unknown, promocoes?: unknown) {
      const { data: atual } = await admin.from("loyalty_member_prefs").select("*").eq("customer_id", sessao!.customer_id).maybeSingle();
      const p = typeof pontos === "boolean" ? pontos : (atual?.avisos_pontos ?? true);
      const pr = typeof promocoes === "boolean" ? promocoes : (atual?.avisos_promocoes ?? false);
      const linha = {
        customer_id: sessao!.customer_id, tenant_id: sessao!.tenant_id, avisos_pontos: p, avisos_promocoes: pr,
        promocoes_aceite_em: pr ? (atual?.avisos_promocoes ? atual.promocoes_aceite_em : new Date().toISOString()) : null,
        updated_at: new Date().toISOString(),
      };
      await admin.from("loyalty_member_prefs").upsert(linha, { onConflict: "customer_id" });
      return { avisos_pontos: p, avisos_promocoes: pr };
    }

    if (action === "push_inscrever") {
      const sub = body.subscription ?? {};
      const endpoint = String(sub.endpoint ?? "");
      const p256dh = String(sub.keys?.p256dh ?? "");
      const auth = String(sub.keys?.auth ?? "");
      let host = "";
      try { host = new URL(endpoint).hostname; } catch { /* inválido */ }
      // Só os serviços de notificação dos navegadores (o servidor faz POST nesse endereço a cada aviso).
      const servicoOk = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/.test(host);
      if (!endpoint.startsWith("https://") || endpoint.length > 900 || !servicoOk || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) return erro("Inscrição inválida.");
      // Mesmo aparelho, outra pessoa (celular emprestado): a inscrição passa para esta sessão.
      await admin.from("loyalty_push_subscriptions").delete().eq("endpoint", endpoint);
      const { error } = await admin.from("loyalty_push_subscriptions").insert({
        tenant_id: sessao.tenant_id, customer_id: sessao.customer_id, session_id: sessao.id, endpoint, p256dh, auth,
        user_agent: String(req.headers.get("user-agent") ?? "").slice(0, 200),
      });
      if (error) throw error;
      const prefs = await salvarPrefs(body.pontos, body.promocoes);
      return resp({ ok: true, prefs });
    }

    if (action === "push_sair") {
      await admin.from("loyalty_push_subscriptions").delete().eq("endpoint", String(body.endpoint ?? "")).eq("session_id", sessao.id);
      return resp({ ok: true });
    }

    if (action === "prefs") {
      return resp({ prefs: await salvarPrefs(body.avisos_pontos, body.avisos_promocoes) });
    }

    if (action === "avisos") {
      const { data } = await admin.from("loyalty_avisos").select("id, tipo, titulo, corpo, url, created_at, lido_em")
        .eq("customer_id", sessao.customer_id).order("created_at", { ascending: false }).limit(50);
      if (body.lidos === true) {
        await admin.from("loyalty_avisos").update({ lido_em: new Date().toISOString() }).eq("customer_id", sessao.customer_id).is("lido_em", null);
      }
      return resp({ avisos: data ?? [] });
    }

    if (action === "reservar") {
      if (sessao.digital_premio && temDigital) {
        if (!body.resposta) return erro("Confirme com a sua digital para usar o prêmio.", 403, "precisa_digital");
        const e = await conferirDigital(body.resposta, "premio");
        if (e) return erro(e, 400, "digital");
      }
      const { data, error } = body.beneficio_id
        ? await admin.rpc("fn_fidelidade_reservar_beneficio", { p_customer: sessao.customer_id, p_beneficio: String(body.beneficio_id) })
        : await admin.rpc("fn_fidelidade_reservar", { p_customer: sessao.customer_id, p_recompensa: String(body.recompensa_id ?? "") });
      if (error) return erro(erroRpc(error));
      const { data: res } = await admin.rpc("fn_fidelidade_resumo", { p_customer: sessao.customer_id });
      return resp({ reserva: data, resumo: res });
    }

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
      if (bloqueado) return resp({ liberado: ids.length });
      const { data: res } = await admin.rpc("fn_fidelidade_resumo", { p_customer: sessao.customer_id });
      return resp({ liberado: ids.length, resumo: res });
    }

    if (action === "indicacao") {
      const regra = await indicacaoPublica(sessao.tenant_id);
      if (!regra) return resp({ ativo: false });
      let { data: cod } = await admin.from("loyalty_indicacao_codigos").select("codigo").eq("customer_id", sessao.customer_id).maybeSingle();
      // Código curto, sem letras que confundem (0/O, 1/I/L).
      const ALFA = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
      for (let tentativa = 0; !cod && tentativa < 5; tentativa++) {
        const b = new Uint8Array(6); crypto.getRandomValues(b);
        const codigo = [...b].map((x) => ALFA[x % ALFA.length]).join("");
        const { data, error } = await admin.from("loyalty_indicacao_codigos")
          .insert({ customer_id: sessao.customer_id, tenant_id: sessao.tenant_id, codigo }).select("codigo").maybeSingle();
        if (!error) cod = data;
        else if (error.code !== "23505") throw error;
        else ({ data: cod } = await admin.from("loyalty_indicacao_codigos").select("codigo").eq("customer_id", sessao.customer_id).maybeSingle());
      }
      if (!cod) return erro("Não consegui gerar seu código agora.");
      const { data: ind } = await admin.from("loyalty_indicacoes").select("premiado_em, premio").eq("indicador_id", sessao.customer_id);
      const premiadas = (ind ?? []).filter((x: any) => x.premiado_em && !x.premio?.limite).length;
      return resp({
        ativo: true, codigo: cod.codigo, ...regra,
        indicados: (ind ?? []).length, premiadas, aguardando: (ind ?? []).filter((x: any) => !x.premiado_em).length,
      });
    }

    return erro(`action desconhecida: ${action}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String((e as any)?.message ?? e);
    console.error("[clube-app]", msg);
    return erro("Não consegui falar com o clube agora. Tente de novo.", 500);
  }
});
