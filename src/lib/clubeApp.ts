// App do clube (PWA por loja): conversa com a Edge Function `clube-app` e reúne o que
// o celular precisa — digital (WebAuthn/passkey), notificações (service worker próprio
// do clube), botão de instalar e as cores da marca da loja.
//
// O "cartão do clube" continua sendo o token por loja guardado no aparelho
// (clubeTokenSalvo/clubeSalvarToken de clubePublico.ts) — o delivery e a mesa usam o mesmo.
import type { ClubeDados, ClubeProgramaPublico } from './clubePublico';
import { COR_LOJA_PADRAO } from './corLoja';

export type RespostaClube<T> = T & { error?: string; message?: string; _status?: number };

export async function clubeApp<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<RespostaClube<T>> {
  const base = ((import.meta.env.VITE_PUBLIC_SUPABASE_URL as string) || '').replace(/\/$/, '');
  const anon = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string;
  try {
    const res = await fetch(`${base}/functions/v1/clube-app`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as RespostaClube<T>;
    return { ...json, _status: res.status };
  } catch {
    return { error: 'sem_conexao', message: 'Sem conexão. Tente de novo.', _status: 0 } as RespostaClube<T>;
  }
}

// ── Tipos das respostas ──────────────────────────────────────────────────────
export interface LojaDoClube {
  tenant_id: string; nome: string; slug: string; logo: string | null;
  cor: string | null; cor_destaque: string | null; nome_curto: string | null;
}
export interface IndicacaoPublica { premio: string; bonus_indicado: number; limite_mes: number }
export interface RespostaLoja {
  loja: LojaDoClube;
  app: { ativo: boolean; icone?: string; apple?: string };
  clube_ativo: boolean;
  programa: ClubeProgramaPublico | null;
  indicacao: IndicacaoPublica | null;
}
export interface EstadoAparelho {
  aparelho: { id: string; nome: string | null; tem_digital: boolean; digital_abrir: boolean; digital_premio: boolean; bloqueado: boolean };
  prefs: { avisos_pontos: boolean; avisos_promocoes: boolean };
  push_inscrito: boolean;
  avisos_novos: number;
}
export interface AvisoClube { id: string; tipo: string; titulo: string; corpo: string | null; url: string | null; created_at: string; lido_em: string | null }
export interface AparelhoClube { id: string; nome: string | null; via: string; desde: string; visto: string; atual: boolean; digital: boolean }
export interface IndicacaoMinha extends IndicacaoPublica { ativo: boolean; codigo: string; indicados: number; premiadas: number; aguardando: number }
export type { ClubeDados };

// ── Nome do aparelho (para a lista "Aparelhos conectados") ──────────────────
export function nomeDoAparelho(): string {
  const ua = navigator.userAgent;
  const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : 'Aparelho';
  const nav = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /EdgA?\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  const app = appInstalado() ? 'app' : nav;
  return app ? `${so} · ${app}` : so;
}

export function appInstalado(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}
export const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const ehAndroid = () => /android/i.test(navigator.userAgent);
/** Navegador de dentro de outro app (Instagram, Facebook, WhatsApp…): lá não instala. */
export const navegadorDeApp = () => /Instagram|FBAN|FBAV|FB_IAB|Line\/|WhatsApp|TikTok|musical_ly/i.test(navigator.userAgent);

// ── Instalar (Android/Chrome) ───────────────────────────────────────────────
// O Chrome avisa uma vez que dá para instalar; guardamos o aviso para o botão usar depois.
interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let pedidoInstalar: BeforeInstallPromptEvent | null = null;
const ouvintesInstalar = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pedidoInstalar = e as BeforeInstallPromptEvent;
    ouvintesInstalar.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => { pedidoInstalar = null; ouvintesInstalar.forEach((f) => f()); });
}
export const podeInstalarComUmToque = () => !!pedidoInstalar;
export function aoMudarInstalar(f: () => void): () => void { ouvintesInstalar.add(f); return () => { ouvintesInstalar.delete(f); }; }
export async function instalarApp(): Promise<boolean> {
  if (!pedidoInstalar) return false;
  const p = pedidoInstalar;
  await p.prompt();
  const { outcome } = await p.userChoice;
  pedidoInstalar = null;
  ouvintesInstalar.forEach((f) => f());
  return outcome === 'accepted';
}

// ── Cara do app (manifest, ícone, cor da barra) ─────────────────────────────
/** Troca título, cor da barra e ícone do iPhone para os da loja. O manifest já foi
 *  apontado pelo index.html (antes do React) para /clube-app/manifest/<loja>. */
export function aplicarCaraDaLoja(loja: LojaDoClube, iconeApple?: string) {
  document.title = loja.nome;
  const cor = corDaLoja(loja);
  const meta = (nome: string) => document.querySelector(`meta[name="${nome}"]`);
  meta('theme-color')?.setAttribute('content', cor);
  meta('apple-mobile-web-app-title')?.setAttribute('content', (loja.nome_curto || loja.nome).slice(0, 12));
  if (iconeApple) {
    // O index.html tira o ícone do ERPOS nas páginas do clube; aqui entra o da loja.
    let link = document.querySelector('link[rel="apple-touch-icon"]');
    if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'apple-touch-icon'); document.head.appendChild(link); }
    link.setAttribute('href', iconeApple);
  }
}

// ── Cores da marca ──────────────────────────────────────────────────────────
const hexOk = (c: string | null | undefined) => !!c && /^#[0-9a-f]{6}$/i.test(c);
export function corDaLoja(loja: Pick<LojaDoClube, 'cor'>): string {
  return hexOk(loja.cor) ? loja.cor! : COR_LOJA_PADRAO;
}
function misturar(hex: string, alvo: number, peso: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * (1 - peso) + alvo * peso);
  return '#' + [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
/** Variáveis CSS do app: --brand (cor da loja), --brand2 (mais escura), --brand3 (mais clara),
 *  --acc (destaque: o 2º tom da logo, ou um tom claro da própria cor). */
export function varsDaMarca(loja: Pick<LojaDoClube, 'cor' | 'cor_destaque'>): Record<string, string> {
  const base = corDaLoja(loja);
  return {
    '--brand': base,
    '--brand2': misturar(base, 0, 0.42),
    '--brand3': misturar(base, 255, 0.14),
    '--brand-suave': misturar(base, 255, 0.92),
    '--acc': hexOk(loja.cor_destaque) ? loja.cor_destaque! : misturar(base, 255, 0.78),
  };
}

// ── Digital (WebAuthn / passkey) ────────────────────────────────────────────
// O servidor manda as opções em JSON (base64url); o navegador quer ArrayBuffer.
const b64uParaBuf = (s: string): ArrayBuffer => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};
const bufParaB64u = (b: ArrayBuffer | null | undefined): string => {
  if (!b) return '';
  let bin = '';
  for (const x of new Uint8Array(b)) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function digitalDisponivel(): Promise<boolean> {
  try {
    return !!window.PublicKeyCredential
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

type OpcoesJson = Record<string, any>;

async function criarCredencial(o: OpcoesJson) {
  const cred = await navigator.credentials.create({
    publicKey: {
      ...o,
      challenge: b64uParaBuf(o.challenge),
      user: { ...o.user, id: b64uParaBuf(o.user.id) },
      excludeCredentials: (o.excludeCredentials ?? []).map((c: any) => ({ ...c, id: b64uParaBuf(c.id) })),
    } as PublicKeyCredentialCreationOptions,
  }) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelado');
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id, rawId: bufParaB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    authenticatorAttachment: (cred as any).authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: bufParaB64u(r.clientDataJSON),
      attestationObject: bufParaB64u(r.attestationObject),
      transports: typeof r.getTransports === 'function' ? r.getTransports() : undefined,
    },
  };
}

async function usarCredencial(o: OpcoesJson) {
  const cred = await navigator.credentials.get({
    publicKey: {
      ...o,
      challenge: b64uParaBuf(o.challenge),
      allowCredentials: (o.allowCredentials ?? []).map((c: any) => ({ ...c, id: b64uParaBuf(c.id) })),
    } as PublicKeyCredentialRequestOptions,
  }) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelado');
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id, rawId: bufParaB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    authenticatorAttachment: (cred as any).authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: bufParaB64u(r.clientDataJSON),
      authenticatorData: bufParaB64u(r.authenticatorData),
      signature: bufParaB64u(r.signature),
      userHandle: r.userHandle ? bufParaB64u(r.userHandle) : undefined,
    },
  };
}

const erroDigital = (e: unknown) => {
  const nome = (e as Error)?.name;
  if (nome === 'NotAllowedError' || (e as Error)?.message === 'cancelado') return 'Cancelado.';
  if (nome === 'InvalidStateError') return 'A digital deste celular já está ligada.';
  return 'Não deu para usar a digital agora.';
};

/** Liga a digital neste aparelho. */
export async function ligarDigital(token: string): Promise<{ ok: boolean; erro?: string }> {
  const o = await clubeApp<{ opcoes?: OpcoesJson }>({ action: 'passkey_opcoes', tipo: 'registro', token });
  if (!o.opcoes) return { ok: false, erro: o.message };
  let resposta;
  try { resposta = await criarCredencial(o.opcoes); } catch (e) { return { ok: false, erro: erroDigital(e) }; }
  const r = await clubeApp({ action: 'passkey_registrar', token, resposta });
  return r.error ? { ok: false, erro: r.message } : { ok: true };
}

/** Pede a digital e devolve a assinatura (para abrir o app ou usar prêmio). */
export async function assinarComDigital(token: string, tipo: 'abrir' | 'premio'): Promise<{ resposta?: unknown; erro?: string }> {
  const o = await clubeApp<{ opcoes?: OpcoesJson }>({ action: 'passkey_opcoes', tipo, token });
  if (!o.opcoes) return { erro: o.message };
  try { return { resposta: await usarCredencial(o.opcoes) }; } catch (e) { return { erro: erroDigital(e) }; }
}

/** Desbloqueia o app com a digital (vale 30 min no servidor). */
export async function desbloquearComDigital(token: string): Promise<{ ok: boolean; erro?: string }> {
  const a = await assinarComDigital(token, 'abrir');
  if (!a.resposta) return { ok: false, erro: a.erro };
  const r = await clubeApp({ action: 'passkey_confirmar', token, resposta: a.resposta });
  return r.error ? { ok: false, erro: r.message } : { ok: true };
}

// ── Notificações (service worker do clube, um por loja) ──────────────────────
// Escopo próprio (/clube/<loja>): a notificação sai com o ícone e o nome do APP DA
// LOJA, não do ERPOS — e não mistura com as notificações de funcionário.
export const pushSuportado = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';

export async function registrarSwDoClube(slug: string): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/clube-sw.js', { scope: `/clube/${slug}` });
  } catch (e) {
    console.warn('[clube] service worker', e);
    return null;
  }
}

export async function inscricaoAtual(slug: string): Promise<PushSubscription | null> {
  if (!pushSuportado()) return null;
  const reg = await navigator.serviceWorker.getRegistration(`/clube/${slug}`);
  if (!reg || !new URL(reg.scope).pathname.endsWith(`/clube/${slug}`)) return null;
  return (await reg.pushManager.getSubscription()) ?? null;
}

export async function ativarAvisos(slug: string, token: string, prefs: { pontos: boolean; promocoes: boolean }): Promise<{ ok: boolean; erro?: string }> {
  if (!pushSuportado()) {
    return { ok: false, erro: ehIOS() && !appInstalado() ? 'No iPhone, instale o app na tela de início primeiro.' : 'Este celular não aceita notificações por aqui.' };
  }
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, erro: 'Notificações bloqueadas. Dá para liberar nos ajustes do celular.' };
  const reg = (await registrarSwDoClube(slug)) ?? null;
  if (!reg) return { ok: false, erro: 'Não deu para ligar as notificações.' };
  await navigator.serviceWorker.ready;
  const chave = await clubeApp<{ chave?: string }>({ action: 'push_chave' });
  if (!chave.chave) return { ok: false, erro: chave.message };
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: b64uParaBuf(chave.chave),
  });
  const r = await clubeApp({ action: 'push_inscrever', token, subscription: sub.toJSON(), pontos: prefs.pontos, promocoes: prefs.promocoes });
  return r.error ? { ok: false, erro: r.message } : { ok: true };
}

// ── Prêmio: por quanto o item sai ───────────────────────────────────────────
/** Preço final do produto do prêmio (null = não é produto ou sem preço). */
export function precoNoClube(rw: { tipo: string; valor: number }, preco: number | null): number | null {
  if (preco == null) return null;
  if (rw.tipo === 'produto_valor') return Math.max(0, preco - (Number(rw.valor) || 0));
  if (rw.tipo === 'produto') {
    const pct = Number(rw.valor) > 0 && Number(rw.valor) < 100 ? Number(rw.valor) : 100;
    return Math.max(0, Math.round(preco * (1 - pct / 100) * 100) / 100);
  }
  return null;
}

/** Lembra o código de quem indicou (o link pode ser aberto antes de entrar no clube). */
const chaveIndicacao = (slug: string) => `clube_indicou:${slug}`;
export function guardarIndicacao(slug: string, codigo: string | null) {
  try {
    if (codigo) localStorage.setItem(chaveIndicacao(slug), codigo.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12));
    else localStorage.removeItem(chaveIndicacao(slug));
  } catch { /* sem storage */ }
}
export function indicacaoGuardada(slug: string): string | null {
  try { return localStorage.getItem(chaveIndicacao(slug)); } catch { return null; }
}
