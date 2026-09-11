// Correção global dos campos numéricos (<input type="number">).
//
// Problema: campo controlado com valor 0 — ao digitar "14" o navegador mostra "014".
// O React não reescreve o DOM porque Number("014") === 14 já é o estado, e o zero
// fica grudado na frente. Acontecia em praticamente todas as telas.
//
// Solução, uma vez só para o app inteiro:
//  1. Ao focar um campo numérico, o conteúdo fica selecionado — digitar substitui.
//  2. Zeros à esquerda são removidos ANTES do onChange do React ("014" → "14",
//     "00" → "0"; "0,5"/"0.5" ficam como estão). O listener fica em captura no
//     document, que roda antes do listener que o React registra no #root.

const LEADING_ZEROS = /^(-?)0+(?=\d)/;
const nativeValueSetter = typeof HTMLInputElement !== 'undefined'
  ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  : undefined;

function isNumberInput(el: EventTarget | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'number' && !el.readOnly && !el.disabled;
}

export function installNumberInputFix() {
  if (typeof document === 'undefined') return;

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!isNumberInput(el)) return;
    // setTimeout: o mouseup do clique desfaria a seleção feita no focus
    setTimeout(() => { if (document.activeElement === el) el.select(); }, 0);
  }, true);

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!isNumberInput(el)) return;
    const v = el.value;
    // Pelo setter nativo do protótipo: `el.value = ...` passa pelo rastreador de valor
    // do React, que passaria a achar que nada mudou e não chamaria o onChange.
    if (LEADING_ZEROS.test(v)) nativeValueSetter?.call(el, v.replace(LEADING_ZEROS, '$1'));
  }, true);
}
