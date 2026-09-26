import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const CHAVE = 'erpos_tarefas_sidebar_largura';
export const LARGURA_PADRAO = 240;
const MIN = 200;
const MAX = 480;

const limitar = (n: number) => Math.min(MAX, Math.max(MIN, Math.round(n)));

function lerSalva(): number {
  try {
    const n = Number(localStorage.getItem(CHAVE));
    return n ? limitar(n) : LARGURA_PADRAO;
  } catch {
    return LARGURA_PADRAO;
  }
}

/**
 * Largura da barra de pastas (desktop): arrastar a borda direita alarga/estreita
 * (200–480 px), duplo clique volta ao padrão. Fica guardada neste aparelho.
 */
export function useLarguraSidebar() {
  const [largura, setLargura] = useState(lerSalva);
  const [arrastando, setArrastando] = useState(false);
  const inicio = useRef<{ x: number; largura: number } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(CHAVE, String(largura)); } catch { /* sem armazenamento: vale só nesta visita */ }
  }, [largura]);

  const aoApertar = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    inicio.current = { x: e.clientX, largura };
    setArrastando(true);
    const mover = (ev: PointerEvent) => {
      if (inicio.current) setLargura(limitar(inicio.current.largura + ev.clientX - inicio.current.x));
    };
    const soltar = () => {
      inicio.current = null;
      setArrastando(false);
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('cursor');
    };
    // Enquanto arrasta, o texto da tela não fica selecionado e o cursor não pisca.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }, [largura]);

  const alcaProps = {
    onPointerDown: aoApertar,
    onDoubleClick: () => setLargura(LARGURA_PADRAO),
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    'aria-label': 'Arrastar para mudar a largura da barra de pastas',
    title: 'Arraste para alargar · duplo clique volta ao tamanho padrão',
  };

  return { largura, arrastando, alcaProps };
}
