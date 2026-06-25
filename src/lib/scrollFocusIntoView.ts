import type { FocusEvent } from 'react';

/**
 * Handler de `onFocus` para formulários mobile: quando um input/textarea/select
 * recebe foco, rola o campo para DENTRO da área realmente visível (acima do teclado
 * virtual), para que o usuário veja o que está digitando.
 *
 * Em vez de `scrollIntoView({ block: 'center' })` — que centraliza no viewport de
 * layout (altura cheia) e pode deixar o campo atrás do teclado —, usamos a
 * `visualViewport` API para saber a área visível real (acima do teclado) e rolar
 * o container/janela exatamente o necessário. Roda algumas vezes para acompanhar
 * a abertura do teclado (a viewport encolhe em etapas).
 *
 * Como o onFocus do React borbulha (via focusin), basta colocar este handler no
 * container do formulário que ele pega o foco de todos os campos filhos.
 */

function acharScrollable(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el ? el.parentElement : null;
  while (node && node !== document.body && node !== document.documentElement) {
    const oy = window.getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

export function scrollFocusedFieldIntoView(e: FocusEvent<HTMLElement>): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  const tag = target.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;

  const ajustar = () => {
    if (document.activeElement !== target) return;
    const vv = window.visualViewport;
    const visTop = vv ? vv.offsetTop : 0;
    const visBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const rect = target.getBoundingClientRect();
    const margem = 28; // folga acima do teclado / do topo

    let delta = 0;
    if (rect.bottom > visBottom - margem) {
      delta = rect.bottom - (visBottom - margem); // campo atrás do teclado → sobe
    } else if (rect.top < visTop + margem) {
      delta = rect.top - (visTop + margem); // campo acima da área visível → desce
    }
    if (delta === 0) return;

    const sc = acharScrollable(target);
    try {
      if (sc) sc.scrollBy({ top: delta, behavior: 'smooth' });
      else window.scrollBy({ top: delta, behavior: 'smooth' });
    } catch (_e) {
      // Fallback p/ navegadores sem options de scroll suave
      if (sc) sc.scrollTop += delta; else window.scrollBy(0, delta);
    }
  };

  // Várias tentativas: o teclado abre com atraso e a viewport encolhe em etapas.
  window.setTimeout(ajustar, 150);
  window.setTimeout(ajustar, 400);
  window.setTimeout(ajustar, 700);
}
