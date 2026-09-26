import type { MouseEvent } from 'react';

/**
 * Várias telas do ERPOS ao mesmo tempo no computador (2026-09-26).
 *
 * No navegador: abre numa janela separada (dá para pôr o PDV de um lado e o
 * Financeiro do outro). No app instalado (PWA), window.open de um endereço do
 * próprio app abre outra janela do app. Cada janela fica na sua tela e na sua
 * loja (ver lojaAtiva.ts).
 */
export function abrirNovaJanela(caminho: string): void {
  const url = new URL(caminho, window.location.origin).href;
  const instalado = window.matchMedia?.('(display-mode: standalone)').matches;
  const w = window.open(url, '_blank', instalado ? undefined : 'popup,width=1280,height=800');
  if (!w) window.open(url, '_blank'); // bloqueador de pop-up: ao menos uma aba nova
}

/**
 * Clique que o navegador deve tratar sozinho (Ctrl/⌘/Shift + clique = nova aba/janela).
 * A rodinha do mouse nem dispara onClick — o <a href> já abre a aba nova.
 */
export function cliqueParaNovaAba(e: MouseEvent): boolean {
  return e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;
}
