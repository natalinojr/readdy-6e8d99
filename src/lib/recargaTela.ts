/**
 * Tela que não carregou (arquivo da rota) ou que carregou misturada com versão velha.
 *
 * O arquivo de cada tela é baixado na hora (code-split). Se o download falha —
 * rede ruim no celular, ou deploy novo com a aba aberta desde antes — o import
 * da rota rejeita e cai no ErrorBoundary do App. O `vite:preloadError` do
 * main.tsx só cobre as dependências da tela, não o arquivo dela; por isso a
 * recarga automática também é feita no ErrorBoundary. No máximo 1x por minuto,
 * para não ficar em laço quando não há internet.
 *
 * 2026-10-05: "Cannot read properties of undefined (reading 'default')" em /estoque e /dashboard
 * (dev_error_events, só no app Android/WebView, logo depois de publicação) é o mesmo problema com
 * outra cara: o arquivo da tela é novo, mas o arquivo compartilhado (react/jsx-runtime) que ele
 * importa é o antigo, cujos nomes exportados mudaram → o import vem `undefined` e o primeiro
 * `.default` estoura. O topo da pilha fica num /assets/<vendor>-<hash>.js. Recarregar resolve.
 */
export const ERRO_CARREGAR_TELA =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed/i;

/** Arquivo compartilhado de outra versão: `undefined.default` com a pilha dentro de /assets/. */
const ERRO_VERSAO_MISTURADA = /Cannot read propert(?:y|ies) of undefined \(reading 'default'\)/i;

const CHAVE = 'erpos_chunk_reload_ts';
const INTERVALO_MS = 60_000;

export function ehErroCarregarTela(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (ERRO_CARREGAR_TELA.test(error.message ?? '')) return true;
  // Só conta quando veio de arquivo publicado (/assets/): no `npm run dev` é bug de verdade e aparece.
  return ERRO_VERSAO_MISTURADA.test(error.message ?? '') && /\/assets\/[^\s)]+\.js/.test(error.stack ?? '');
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
