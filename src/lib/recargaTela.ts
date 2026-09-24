/**
 * Tela que não carregou (arquivo da rota).
 *
 * O arquivo de cada tela é baixado na hora (code-split). Se o download falha —
 * rede ruim no celular, ou deploy novo com a aba aberta desde antes — o import
 * da rota rejeita e cai no ErrorBoundary do App. O `vite:preloadError` do
 * main.tsx só cobre as dependências da tela, não o arquivo dela; por isso a
 * recarga automática também é feita no ErrorBoundary. No máximo 1x por minuto,
 * para não ficar em laço quando não há internet.
 */
export const ERRO_CARREGAR_TELA =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed/i;

const CHAVE = 'erpos_chunk_reload_ts';
const INTERVALO_MS = 60_000;

export function ehErroCarregarTela(error: unknown): boolean {
  return error instanceof Error && ERRO_CARREGAR_TELA.test(error.message ?? '');
}

/** Recarrega a página se for erro de carregar tela e não recarregou há menos de 1 min. Devolve se recarregou. */
export function tentarRecarregarTela(error: unknown, recarregar: () => void = () => window.location.reload()): boolean {
  if (!ehErroCarregarTela(error)) return false;
  try {
    const ultima = Number(sessionStorage.getItem(CHAVE) ?? 0);
    if (Date.now() - ultima < INTERVALO_MS) return false;
    sessionStorage.setItem(CHAVE, String(Date.now()));
  } catch { /* sem sessionStorage: recarrega mesmo assim */ }
  recarregar();
  return true;
}
