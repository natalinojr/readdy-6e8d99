import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { KeyboardMode } from '@/components/feature/VirtualKeyboard';

interface VKState {
  open: boolean;
  value: string;
  label?: string;
  mode: KeyboardMode;
  maxLength?: number;
  onEnter?: () => void;
  targetEl: HTMLInputElement | HTMLTextAreaElement | null;
}

interface VirtualKeyboardContextValue {
  state: VKState;
  openKeyboard: (
    el: HTMLInputElement | HTMLTextAreaElement,
    opts?: { mode?: KeyboardMode; label?: string; maxLength?: number; onEnter?: () => void }
  ) => void;
  closeKeyboard: () => void;
  setValue: (v: string) => void;
}

const VirtualKeyboardContext = createContext<VirtualKeyboardContextValue | null>(null);

const DEFAULT_STATE: VKState = {
  open: false,
  value: '',
  label: undefined,
  mode: 'text',
  maxLength: undefined,
  onEnter: undefined,
  targetEl: null,
};

/**
 * Detecta se é um dispositivo touch (tablet/mobile).
 * O teclado virtual só é ativado em touch devices para não atrapalhar desktop.
 */
function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * Telas do CLIENTE (delivery / mesa-qr / mesa / pedido) usam o teclado NATIVO do
 * celular — é mais familiar e o nativo já cuida da visibilidade do campo (com a meta
 * `interactive-widget` + a barra-espelho do MobileKeyboardAssist). O teclado virtual
 * QWERTY é só pra totem/autoatendimento e telas de gestão em tablet.
 */
function rotaUsaTecladoNativo(): boolean {
  const p = window.location.pathname;
  return (
    p === '/delivery' || p.startsWith('/delivery/') || p.endsWith('-delivery') ||
    p === '/mesa-qr' || p.startsWith('/mesa-qr/') ||
    p.startsWith('/mesa/') ||
    p.startsWith('/pedido/')
  );
}

export function VirtualKeyboardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VKState>(DEFAULT_STATE);
  const syncRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sincroniza o valor do input real com o teclado virtual
  const syncToTarget = useCallback((el: HTMLInputElement | HTMLTextAreaElement, val: string) => {
    // Usa o setter nativo para disparar eventos React corretamente
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, val);
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, []);

  const openKeyboard = useCallback((
    el: HTMLInputElement | HTMLTextAreaElement,
    opts?: { mode?: KeyboardMode; label?: string; maxLength?: number; onEnter?: () => void }
  ) => {
    if (!isTouchDevice()) return;
    if (rotaUsaTecladoNativo()) return; // telas do cliente usam o teclado nativo

    // Impede teclado nativo: marca como readOnly enquanto teclado virtual está ativo
    el.readOnly = true;
    el.setAttribute('inputmode', 'none');

    setState({
      open: true,
      value: el.value,
      label: opts?.label,
      mode: opts?.mode ?? 'text',
      maxLength: opts?.maxLength,
      onEnter: opts?.onEnter,
      targetEl: el,
    });
  }, []);

  const closeKeyboard = useCallback(() => {
    setState((prev) => {
      if (prev.targetEl) {
        prev.targetEl.blur();
        prev.targetEl.readOnly = false;
        prev.targetEl.removeAttribute('inputmode');
      }
      return DEFAULT_STATE;
    });
  }, []);

  const setValue = useCallback((val: string) => {
    setState((prev) => {
      if (prev.targetEl) {
        if (syncRef.current) clearTimeout(syncRef.current);
        syncRef.current = setTimeout(() => {
          if (prev.targetEl) syncToTarget(prev.targetEl, val);
        }, 0);
      }
      return { ...prev, value: val };
    });
  }, [syncToTarget]);

  // Listener global para interceptar toque em inputs e abrir teclado virtual
  useEffect(() => {
    if (!isTouchDevice()) return;

    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (!isInput) return;

      const el = target as HTMLInputElement | HTMLTextAreaElement;

      // Nas telas do cliente (delivery/mesa-qr) usa o teclado NATIVO do celular.
      if (rotaUsaTecladoNativo()) return;

      // Verifica se o campo optou por NÃO usar o teclado virtual
      if (el.dataset.nativeKeyboard === 'true') return;

      // Ignora campos hidden, submit, button, file, checkbox, radio
      if (['hidden', 'submit', 'button', 'file', 'checkbox', 'radio'].includes(el.type)) return;

      // Impede teclado nativo de abrir
      e.preventDefault();
      e.stopPropagation();

      // Marca como readOnly e inputmode none para garantir que teclado nativo não abra
      el.readOnly = true;
      el.setAttribute('inputmode', 'none');

      // Mantém foco visual no input para o usuário saber qual campo está ativo
      el.focus();

      // Rola a página para o input ficar visível acima do teclado virtual
      setTimeout(() => {
        const keyboardHeight = 320; // altura aproximada do teclado virtual
        const rect = el.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        if (rect.bottom > viewportHeight - keyboardHeight - 24) {
          const scrollBy = rect.bottom - (viewportHeight - keyboardHeight - 24) + 12;
          window.scrollBy({ top: scrollBy, behavior: 'smooth' });
        }
      }, 100);

      const inputType = el.type;
      // data-keyboard="numeric" ou "decimal" tem prioridade para definir o layout
      const dataKeyboard = el.dataset.keyboard;
      const isNumeric = inputType === 'number' || dataKeyboard === 'numeric' || el.getAttribute('data-keyboard') === 'numeric';
      const isDecimal = dataKeyboard === 'decimal' || el.getAttribute('data-keyboard') === 'decimal';

      const mode: KeyboardMode = isDecimal ? 'decimal' : isNumeric ? 'numeric' : 'text';
      const label = el.placeholder || el.getAttribute('aria-label') || el.closest('label')?.textContent?.trim() || undefined;
      const maxLen = el.maxLength > 0 ? el.maxLength : undefined;

      openKeyboard(el, { mode, label, maxLength: maxLen });
    };

    // Usa capture: true para interceptar ANTES do browser processar o touch
    document.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
    return () => document.removeEventListener('touchstart', handleTouchStart, true);
  }, [openKeyboard]);

  return (
    <VirtualKeyboardContext.Provider value={{ state, openKeyboard, closeKeyboard, setValue }}>
      {children}
    </VirtualKeyboardContext.Provider>
  );
}

export function useVirtualKeyboard() {
  const ctx = useContext(VirtualKeyboardContext);
  if (!ctx) throw new Error('useVirtualKeyboard must be used within VirtualKeyboardProvider');
  return ctx;
}