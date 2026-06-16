import { useEffect, useState } from 'react';

/**
 * Retorna a altura (px) ocupada pelo teclado virtual na parte de baixo da tela,
 * usando a API `visualViewport`. Vale 0 quando o teclado está fechado.
 *
 * Uso típico: aplicar como `paddingBottom` (em formulários roláveis) ou no
 * container de um modal ancorado no rodapé, para que o campo focado não fique
 * escondido atrás do teclado.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(function () {
    const viewport = window.visualViewport;
    if (!viewport) return;

    function update() {
      // innerHeight = altura total da janela; viewport.height = área visível (acima do teclado).
      const kb = Math.max(0, window.innerHeight - viewport!.height - viewport!.offsetTop);
      // Ignora variações minúsculas (barra de endereço etc.) — só considera teclado real.
      setInset(kb > 120 ? kb : 0);
    }

    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    update();
    return function () {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
