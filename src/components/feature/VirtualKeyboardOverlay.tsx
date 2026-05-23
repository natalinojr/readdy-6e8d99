import { useEffect, useRef } from 'react';
import { useVirtualKeyboard } from '@/contexts/VirtualKeyboardContext';
import VirtualKeyboard from './VirtualKeyboard';

/**
 * Overlay global do teclado virtual.
 * Fica fixo na parte inferior da tela quando ativo.
 * Deve ser renderizado uma única vez no AppProviders ou AppLayout.
 */
export default function VirtualKeyboardOverlay() {
  const { state, setValue, closeKeyboard } = useVirtualKeyboard();
  const overlayRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora do teclado E fora do input alvo
  useEffect(() => {
    if (!state.open) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (overlayRef.current?.contains(target)) return;
      if (state.targetEl && state.targetEl.contains(target)) return;
      closeKeyboard();
    };

    // Pequeno delay para evitar fechar imediatamente após abrir
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerDown, true);
    }, 200);

    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [state.open, state.targetEl, closeKeyboard]);

  if (!state.open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed bottom-0 left-0 right-0 z-[9999] shadow-2xl"
      style={{ boxShadow: '0 -4px 24px rgba(0,0,0,0.18)' }}
    >
      <VirtualKeyboard
        value={state.value}
        onChange={setValue}
        onEnter={state.onEnter ?? (() => closeKeyboard())}
        onClose={closeKeyboard}
        mode={state.mode}
        maxLength={state.maxLength}
        label={state.label}
      />
    </div>
  );
}