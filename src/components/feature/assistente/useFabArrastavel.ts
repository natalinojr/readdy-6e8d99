// Botão redondo que dá para arrastar (2026-09-23), para o botão de ações rápidas de quem não é o
// dono andar pela tela igual ao do assistente (AssistenteChat). Mesma regra e mesma chave do
// localStorage: posição como FRAÇÃO da tela (centro do botão), vira arrasto só depois de 8 px e o
// click que o navegador dispara ao soltar não abre nada.
import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';

const FAB_KEY = 'erpos-assistente-fab';
const FAB_R = 28; // metade dos 56 px do botão
const FAB_MARGEM = 8;
type PosFab = { fx: number; fy: number };

function lerPosFab(): PosFab | null {
  try {
    const v = JSON.parse(localStorage.getItem(FAB_KEY) ?? 'null') as PosFab | null;
    return v && Number.isFinite(v.fx) && Number.isFinite(v.fy) ? v : null;
  } catch { return null; }
}
// Centro em px, sempre inteiro dentro da tela (a tela pode ter encolhido desde que foi salvo).
function centroFab(x: number, y: number) {
  const w = window.innerWidth, h = window.innerHeight, min = FAB_R + FAB_MARGEM;
  return { x: Math.min(Math.max(x, min), w - min), y: Math.min(Math.max(y, min), h - min) };
}

export function useFabArrastavel(onClique: () => void) {
  const [posFab, setPosFab] = useState<PosFab | null>(lerPosFab);
  const [arrastando, setArrastando] = useState<{ x: number; y: number } | null>(null);
  const arrasto = useRef<{ x0: number; y0: number; moveu: boolean } | null>(null);
  const ignorarClique = useRef(false);

  const centro = arrastando
    ? centroFab(arrastando.x, arrastando.y)
    : posFab ? centroFab(posFab.fx * window.innerWidth, posFab.fy * window.innerHeight) : null;

  const style: CSSProperties = centro
    ? { left: centro.x - FAB_R, top: centro.y - FAB_R, touchAction: 'none' }
    : { touchAction: 'none' };

  return {
    arrastando: !!arrastando,
    // Sem posição salva, o canto de sempre.
    classePosicao: centro ? '' : 'bottom-5 right-5',
    props: {
      style,
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
        arrasto.current = { x0: e.clientX, y0: e.clientY, moveu: false };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sem captura: segue igual */ }
      },
      onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
        const a = arrasto.current;
        if (!a || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
        if (!a.moveu && Math.hypot(e.clientX - a.x0, e.clientY - a.y0) < 8) return;
        a.moveu = true;
        setArrastando({ x: e.clientX, y: e.clientY });
      },
      onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
        const a = arrasto.current;
        arrasto.current = null;
        if (!a?.moveu) return;
        const c = centroFab(e.clientX, e.clientY);
        const nova = { fx: c.x / window.innerWidth, fy: c.y / window.innerHeight };
        setPosFab(nova);
        setArrastando(null);
        try { localStorage.setItem(FAB_KEY, JSON.stringify(nova)); } catch { /* sem storage */ }
        ignorarClique.current = true;
      },
      onPointerCancel: () => { arrasto.current = null; setArrastando(null); },
      onClick: () => {
        if (ignorarClique.current) { ignorarClique.current = false; return; }
        onClique();
      },
    },
  };
}
