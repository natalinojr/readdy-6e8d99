import type { FocusEvent } from 'react';

/**
 * Handler de `onFocus` para formulários mobile: quando um input/textarea/select
 * recebe foco, rola o campo para o centro da área visível — assim ele não fica
 * escondido atrás do teclado virtual. O delay dá tempo do teclado abrir antes de rolar.
 *
 * Como o onFocus do React borbulha (via focusin), basta colocar este handler no
 * container do formulário que ele pega o foco de todos os campos filhos.
 */
export function scrollFocusedFieldIntoView(e: FocusEvent<HTMLElement>): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  const tag = target.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
  // Espera o teclado virtual abrir (a viewport encolhe) antes de centralizar o campo.
  window.setTimeout(function () {
    try {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (_e) {
      /* navegadores antigos: ignora */
    }
  }, 300);
}
