import { useEffect } from 'react';

/**
 * Hook global para melhorar a usabilidade em tablets/mobiles quando o teclado virtual abre.
 *
 * Problemas resolvidos:
 * 1. O teclado cobre o campo que está sendo editado (sem scroll automático)
 * 2. Modais `fixed` ficam enterrados atrás do teclado
 * 3. O layout não se ajusta quando o viewport encolhe (iOS/Android)
 *
 * Estratégia:
 * - Detecta quando um input/textarea recebe foco
 * - Aguarda o teclado subir (300ms) e faz scrollIntoView no elemento
 * - Usa VisualViewport API quando disponível (mais preciso no iOS/Android)
 * - Fallback para resize event em browsers mais antigos
 */
export function useVirtualKeyboard() {
  useEffect(() => {
    // Não faz nada em desktop puro (sem touch)
    // Mas mantém ativo para tablets que têm touch + teclado físico
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice) return;

    let lastFocusedElement: Element | null = null;
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;

    /** Faz scroll suave para garantir que o elemento focado fique visível */
    const scrollToFocused = (el: Element | null, delay = 300) => {
      if (!el) return;
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        // Se o elemento ainda está focado
        if (document.activeElement === el || el.contains(document.activeElement)) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, delay);
    };

    /** Ao focar qualquer input/textarea/select/contenteditable */
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      if (!isInput) return;

      lastFocusedElement = target;

      // Scroll imediato + delay para aguardar o teclado subir
      scrollToFocused(target, 50);
      scrollToFocused(target, 350);
    };

    // VisualViewport API — disponível no Chrome/Safari modernos
    // Dispara quando o teclado sobe/desce e o viewport visual muda de tamanho
    const handleViewportResize = () => {
      if (!window.visualViewport) return;

      const el = lastFocusedElement ?? document.activeElement;
      if (!el || el === document.body) return;

      const isInput =
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        (el as HTMLElement).isContentEditable;

      if (!isInput) return;

      scrollToFocused(el, 100);
    };

    // Fallback: detecta abertura do teclado via resize da window
    // No tablet, quando o teclado abre, a altura da window diminui significativamente
    let lastWindowHeight = window.innerHeight;
    const handleWindowResize = () => {
      const newHeight = window.innerHeight;
      const heightDiff = lastWindowHeight - newHeight;

      // Teclado subiu (viewport encolheu mais de 150px)
      if (heightDiff > 150) {
        const el = lastFocusedElement ?? document.activeElement;
        scrollToFocused(el, 100);
      }

      lastWindowHeight = newHeight;
    };

    document.addEventListener('focusin', handleFocusIn, true);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportResize);
    } else {
      window.addEventListener('resize', handleWindowResize);
    }

    return () => {
      document.removeEventListener('focusin', handleFocusIn, true);

      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportResize);
      } else {
        window.removeEventListener('resize', handleWindowResize);
      }

      if (scrollTimer) clearTimeout(scrollTimer);
    };
  }, []);
}