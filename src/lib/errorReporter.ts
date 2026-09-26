/**
 * errorReporter.ts — manda erros do front para a fila dev_error_events (Edge `client-errors`).
 * Fase 0.2 de ORQUESTRACAO-AGENTES.md (2026-09-16).
 *
 * Captura: window.onerror, unhandledrejection, crash de render (ErrorBoundary chama
 * reportError) e resposta 4xx/5xx de Edge Function (invokeWithAuth chama reportEdgeFailure).
 * Regras: dedup em memória por (mensagem + stack), lote a cada 4 s (máx. 20), keepalive no
 * unload, nunca lança, e em `npm run dev` só loga (sem mandar), salvo VITE_REPORT_ERRORS=1.
 */
import { getLojaAtiva } from './lojaAtiva';
const ENDPOINT = `${import.meta.env.VITE_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/client-errors`;
const ANON = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY ?? '';
const ENABLED = !!ENDPOINT && (import.meta.env.PROD || import.meta.env.VITE_REPORT_ERRORS === '1');

type Source = 'front' | 'edge' | 'sw' | 'other';
export interface ErrorEvent {
  source: Source;
  message: string;
  stack?: string | null;
  route?: string;
  fn?: string;
  tenant_id?: string | null;
  app_build?: string | null;
  severity?: 'error' | 'warning';
  context?: Record<string, unknown>;
}

const queue: ErrorEvent[] = [];
const seen = new Map<string, number>(); // chave → última vez (ms); repete no máx. 1×/min
let timer: ReturnType<typeof setTimeout> | null = null;
let build: string | null = null;

// Ruído que não é bug do ERPOS
const IGNORE = [
  /ResizeObserver loop/i,
  /Invalid Refresh Token|Refresh Token Not Found|Refresh Token Already Used|JWT expired/i, // tratado em main.tsx
  /Failed to fetch dynamically imported module|Importing a module script failed/i,        // vite:preloadError recarrega
  /Loading chunk .* failed/i,
  /Script error\.?$/i,                                                                    // cross-origin sem detalhe
  /AbortError|The user aborted a request/i,
  /Load failed$/i,                                                                         // Safari offline
];

function appBuild(): string | null {
  if (build) return build;
  const s = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]');
  const m = s?.src.match(/index-([A-Za-z0-9_-]+)\.js/);
  build = m ? m[1] : null;
  return build;
}

function tenantId(): string | null {
  return getLojaAtiva();
}

async function accessToken(): Promise<string | null> {
  try {
    // import dinâmico para não criar ciclo com supabase.ts (que importa este arquivo)
    const { supabase } = await import('./supabase');
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch { return null; }
}

async function flush(useBeacon = false) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (queue.length === 0) return;
  const events = queue.splice(0, 20);
  const body = JSON.stringify({ events });
  try {
    if (useBeacon && 'sendBeacon' in navigator) {
      // sendBeacon não manda headers: o Edge aceita sem Authorization (user_id fica nulo)
      navigator.sendBeacon(`${ENDPOINT}?apikey=${encodeURIComponent(ANON)}`, new Blob([body], { type: 'application/json' }));
      return;
    }
    const token = await accessToken();
    await fetch(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token ?? ANON}` },
      body,
    });
  } catch { /* nunca derruba o app por causa do relator */ }
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => void flush(), 4000);
}

export function reportError(err: unknown, extra: Partial<ErrorEvent> = {}): void {
  try {
    const e = err instanceof Error ? err : null;
    const message = (extra.message ?? e?.message ?? (typeof err === 'string' ? err : JSON.stringify(err))) || 'erro sem mensagem';
    if (IGNORE.some((re) => re.test(message))) return;
    const stack = extra.stack ?? e?.stack ?? null;
    const key = `${extra.fn ?? ''}|${message}|${(stack ?? '').split('\n')[1] ?? ''}`;
    const now = Date.now();
    if ((seen.get(key) ?? 0) > now - 60_000) return;
    seen.set(key, now);
    if (seen.size > 200) seen.delete(seen.keys().next().value as string);

    const ev: ErrorEvent = {
      source: extra.source ?? 'front',
      message: message.slice(0, 2000),
      stack: stack?.slice(0, 8000) ?? null,
      route: extra.route ?? `${location.pathname}${location.search}`.slice(0, 300),
      fn: extra.fn,
      tenant_id: extra.tenant_id ?? tenantId(),
      app_build: appBuild(),
      severity: extra.severity ?? 'error',
      context: { ...(extra.context ?? {}), online: navigator.onLine, lang: navigator.language },
    };
    if (!ENABLED) { console.warn('[errorReporter] (dev, não enviado)', ev); return; }
    queue.push(ev);
    if (queue.length >= 20) void flush(); else schedule();
  } catch { /* ignora */ }
}

/** Edge Function respondeu 4xx/5xx (chamado por invokeWithAuth). 401/403 não são bug: ficam de fora. */
export function reportEdgeFailure(functionName: string, status: number, bodyText: string, action?: string): void {
  if (status === 401 || status === 403 || status === 0) return;
  reportError(new Error(`${functionName} → HTTP ${status}: ${bodyText.slice(0, 300)}`), {
    source: 'edge',
    fn: functionName,
    severity: status >= 500 ? 'error' : 'warning',
    context: { status, action },
  });
}

export function installErrorReporter(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (event) => {
    if (event.error || event.message) reportError(event.error ?? event.message, { context: { file: event.filename, line: event.lineno } });
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { context: { kind: 'unhandledrejection' } });
  });
  window.addEventListener('pagehide', () => void flush(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush(true); });
}
