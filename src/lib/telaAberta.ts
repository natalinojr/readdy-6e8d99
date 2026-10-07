// Telemetria barata de telas (2026-10-05): lógica pura — qual rota conta e como ela é normalizada.
// A tabela public.telas_abertas guarda (pessoa, loja, rota, dia, vezes); nunca ids, tokens nem query.

/** Prefixos públicos / de terminal de cliente: nunca registram (sem login, ou aparelho que não é de uma pessoa). */
const PREFIXOS_FORA = [
  '/delivery', '/mesa-qr', '/mesa/', '/pedido/', '/totem', '/autoatendimento', '/senhas', '/r/', '/voucher', '/clube', '/p/',
  '/login', '/relatorio/', '/motoboy', '/entregas/', '/app-entregas', '/privacidade', '/invite', '/onboarding',
  '/selecionar-loja', '/supabase-debug', '/dev/',
];

const PERFIS_FORA = new Set(['totem', 'tablet']);

/** Segmento que parece id/token: uuid, número com 3+ dígitos ou texto longo misturando letras e números. */
function ehIdentificador(seg: string): boolean {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  if (/^\d{3,}$/.test(seg)) return true;
  return seg.length >= 20 && /\d/.test(seg) && /[a-z]/i.test(seg);
}

/** '/pedidos/' → '/pedidos'; '/algo/123?x=1' → '/algo/:id'. Devolve null para rota que não deve contar. */
export function rotaParaTelemetria(pathname: string): string | null {
  const limpo = (pathname || '').split('?')[0].split('#')[0];
  if (!limpo.startsWith('/') || limpo === '/') return null;
  const base = limpo.length > 1 ? limpo.replace(/\/+$/, '') : limpo;
  if (PREFIXOS_FORA.some((p) => base === p.replace(/\/$/, '') || base.startsWith(p))) return null;
  if (/^\/[^/]+-delivery$/.test(base)) return null; // /<loja>-delivery: cardápio público
  const rota = base.split('/').map((s) => (s && ehIdentificador(s) ? ':id' : s)).join('/');
  return rota.length > 80 ? rota.slice(0, 80) : rota;
}

export function perfilRegistra(perfil: string | null | undefined): boolean {
  return !!perfil && !PERFIS_FORA.has(perfil);
}

/** Debounce em memória: a mesma rota só conta de novo depois de `janelaMs` (1 min por padrão), por aba. */
export function criarDebounce(janelaMs = 60_000, agora: () => number = Date.now) {
  const ultimo = new Map<string, number>();
  return (chave: string): boolean => {
    const t = agora();
    const antes = ultimo.get(chave);
    if (antes !== undefined && t - antes < janelaMs) return false;
    ultimo.set(chave, t);
    return true;
  };
}

export const aparelhoAtual = (): 'celular' | 'computador' =>
  typeof window !== 'undefined' && window.innerWidth < 768 ? 'celular' : 'computador';
