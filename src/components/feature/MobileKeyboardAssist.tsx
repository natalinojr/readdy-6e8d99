import { useEffect, useRef, useState } from 'react';

/**
 * Melhorias de teclado virtual para as telas de cliente (delivery / mesa-qr),
 * que usam o teclado NATIVO do celular:
 *
 *  1. Botão "voltar" do celular fecha o teclado em vez de sair da página.
 *     Empurra um estado-sentinela no history quando um campo de texto ganha foco;
 *     no "voltar" (popstate), se há campo focado, dá blur (fecha o teclado) e
 *     re-arma o sentinela. Não acumula histórico (a cada voltar, remove um e
 *     adiciona um).
 *
 *  2. Mostra o que está sendo digitado numa barra logo ACIMA do teclado, para
 *     quando o teclado cobre o campo. Espelha o valor do campo focado em tempo real.
 *
 * Em desktop (sem teclado virtual) o inset fica 0 e nada é renderizado.
 */

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'password'].includes(type);
}

function labelFor(el: HTMLInputElement | HTMLTextAreaElement): string {
  return el.getAttribute('aria-label') || el.getAttribute('placeholder') || 'Digitando';
}

export default function MobileKeyboardAssist() {
  const [inset, setInset] = useState(0);
  const [mirror, setMirror] = useState<{ label: string; value: string } | null>(null);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Altura do teclado (visualViewport)
  useEffect(() => {
    const vp = window.visualViewport;
    if (!vp) return;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vp.height - vp.offsetTop);
      setInset(kb > 120 ? kb : 0);
    };
    vp.addEventListener('resize', update);
    vp.addEventListener('scroll', update);
    update();
    return () => {
      vp.removeEventListener('resize', update);
      vp.removeEventListener('scroll', update);
    };
  }, []);

  // Espelho do campo focado
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Element;
      if (isTextField(t)) {
        fieldRef.current = t;
        setMirror({ label: labelFor(t), value: t.value });
      }
    };
    const onInput = (e: Event) => {
      const f = fieldRef.current;
      if (f && e.target === f) setMirror({ label: labelFor(f), value: f.value });
    };
    const onFocusOut = () => {
      window.setTimeout(() => {
        if (!isTextField(document.activeElement)) {
          fieldRef.current = null;
          setMirror(null);
        }
      }, 50);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('input', onInput, true);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  // Voltar fecha o teclado
  useEffect(() => {
    let armed = false;
    const onFocusIn = (e: FocusEvent) => {
      if (isTextField(e.target as Element) && !armed) {
        armed = true;
        window.history.pushState({ __kbGuard: true }, '');
      }
    };
    const onPopState = () => {
      if (isTextField(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
        armed = true;
        window.history.pushState({ __kbGuard: true }, '');
      } else {
        armed = false;
      }
    };
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('popstate', onPopState);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  if (!mirror || inset <= 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: inset,
        zIndex: 10000,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          margin: '0 8px 6px',
          background: '#111827',
          color: '#fff',
          borderRadius: 10,
          padding: '8px 12px',
          boxShadow: '0 -2px 12px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span style={{ fontSize: 10, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {mirror.label}
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, wordBreak: 'break-word', minHeight: 20 }}>
          {mirror.value || ' '}
        </span>
      </div>
    </div>
  );
}
