/**
 * "Tem versão nova no ar?" — sem depender de ninguém tocar no tablet.
 *
 * Cada push no `main` publica um build novo e os arquivos em /assets ganham outro
 * hash no nome. Uma aba aberta desde antes do deploy continua rodando o JavaScript
 * antigo até alguém recarregar — foi assim que o totem da loja ficou com o botão
 * "Cancelar" velho depois de uma correção já publicada (2026-09-21).
 *
 * Como descobrimos: o index.html é servido SEMPRE pela rede (ver public/sw.js), então
 * basta buscá-lo e comparar o script de entrada com o que esta aba carregou.
 */

/** Script de entrada desta aba (ex.: "/assets/index-CYTE_fRX.js"). */
function entradaAtual(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  const src = el?.getAttribute('src') ?? null;
  return src ? src.replace(/^https?:\/\/[^/]+/, '') : null;
}

function entradaDoHtml(html: string): string | null {
  const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/);
  return m ? m[1].replace(/^https?:\/\/[^/]+/, '') : null;
}

/**
 * true quando o servidor já tem um build diferente do que esta aba está rodando.
 * Em dev, sem rede ou em qualquer dúvida devolve false (nunca recarrega no escuro).
 */
export async function haVersaoNova(): Promise<boolean> {
  if (!import.meta.env.PROD) return false;
  const atual = entradaAtual();
  if (!atual) return false;
  try {
    const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store', headers: { Accept: 'text/html' } });
    if (!res.ok) return false;
    const nova = entradaDoHtml(await res.text());
    return Boolean(nova && nova !== atual);
  } catch {
    return false;
  }
}

/** Recarrega buscando tudo de novo na rede (o cache de /assets é por hash, não atrapalha). */
export function recarregarApp(): void {
  window.location.reload();
}
