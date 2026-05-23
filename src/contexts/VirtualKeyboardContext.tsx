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

  // Adiciona inputmode="none" em todos os inputs para suprimir o teclado nativo
  useEffect(() => {
    if (!isTouchDevice()) return;

    const applyInputMode = (el: HTMLInputElement | HTMLTextAreaElement) => {
      if (el.dataset.nativeKeyboard === 'true') return;
      if ((el as HTMLInputElement).type === 'password') return;
      if (['hidden', 'submit', 'button', 'file', 'checkbox', 'radio'].includes((el as HTMLInputElement).type)) return;
      el.setAttribute('inputmode', 'none');
    };

    // Aplica em todos os inputs existentes
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(applyInputMode);

    // Observa novos inputs adicionados ao DOM
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const el = node as HTMLElement;
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            applyInputMode(el as HTMLInputElement | HTMLTextAreaElement);
          }
          el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(applyInputMode);
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Listener global para interceptar toque em inputs e abrir teclado virtual
  useEffect(() => {
    if (!isTouchDevice()) return;

    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (!isInput) return;

      const el = target as HTMLInputElement | HTMLTextAreaElement;

      // Verifica se o campo optou por NÃO usar o teclado virtual
      if (el.dataset.nativeKeyboard === 'true') return;

      // Ignora campos de senha (mantém teclado nativo por segurança)
      if ((el as HTMLInputElement).type === 'password') return;

      // Ignora campos hidden, submit, button, file, checkbox, radio
      if (['hidden', 'submit', 'button', 'file', 'checkbox', 'radio'].includes((el as HTMLInputElement).type)) return;

      // Previne foco nativo que abriria o teclado do SO
      e.preventDefault();

      const inputType = (el as HTMLInputElement).type;
      const isNumeric = inputType === 'number' || el.dataset.keyboard === 'numeric';
      const isDecimal = el.dataset.keyboard === 'decimal';

      const mode: KeyboardMode = isDecimal ? 'decimal' : isNumeric ? 'numeric' : 'text';
      const label = el.placeholder || el.getAttribute('aria-label') || el.closest('label')?.textContent?.trim() || undefined;
      const maxLen = (el as HTMLInputElement).maxLength > 0 ? (el as HTMLInputElement).maxLength : undefined;

      openKeyboard(el, { mode, label, maxLength: maxLen });
    };

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