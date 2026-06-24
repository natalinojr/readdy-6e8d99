import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Ação ao puxar o suficiente. Padrão: recarrega a página (re-busca tudo). */
  onRefresh?: () => void;
  /** Distância (px) necessária para disparar o refresh. */
  threshold?: number;
  /** Desliga o gesto (ex.: telas onde não faz sentido). */
  disabled?: boolean;
}

/**
 * Pull-to-refresh próprio (puxar pra baixo no topo recarrega).
 *
 * Por que não o nativo do navegador: `src/index.css` usa `overscroll-behavior:
 * none` (necessário pro fix de teclado), o que desliga o pull-to-refresh nativo;
 * e mesmo sem isso o nativo é inconsistente entre iOS/Android/PWA. Este componente
 * escuta o gesto na janela e só dispara quando a página está no topo.
 *
 * Uso: envolva a página (ex.: no router). É um wrapper transparente — o indicador
 * é `position: fixed`, então não afeta o layout dos filhos.
 */
export default function PullToRefresh({ children, onRefresh, threshold = 70, disabled = false }: Props) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const distRef = useRef(0);
  const draggingRef = useRef(false);
  const scrollElRef = useRef<Element | null>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (disabled) return;

    // Acha o container scrollável sob o dedo (a lista interna `overflow-y-auto`,
    // se houver). Assim o pull-to-refresh só engata quando ESSE container e a
    // janela estao no topo — não rouba o scroll da lista no meio.
    const getScrollableAncestor = (el: Element | null): Element | null => {
      let node: Element | null = el;
      while (node && node !== document.body && node !== document.documentElement) {
        const oy = window.getComputedStyle(node).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
        node = node.parentElement;
      }
      return null;
    };

    const atTop = () => {
      const sc = scrollElRef.current;
      const innerTop = sc ? sc.scrollTop <= 0 : true;
      const winTop = (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
      return innerTop && winTop;
    };

    const onStart = (e: TouchEvent) => {
      if (refreshing || e.touches.length !== 1) { startY.current = null; return; }
      scrollElRef.current = getScrollableAncestor(e.target as Element);
      if (!atTop()) { startY.current = null; return; }
      startY.current = e.touches[0].clientY;
      draggingRef.current = true;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current == null || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0 && atTop()) {
        // resistência: o indicador acompanha o dedo com metade da distância
        const d = Math.min(dy * 0.5, threshold * 1.6);
        distRef.current = d;
        setPull(d);
        if (e.cancelable) e.preventDefault(); // bloqueia o scroll nativo enquanto puxa
      } else {
        distRef.current = 0;
        setPull(0);
      }
    };

    const onEnd = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (distRef.current >= threshold) {
        setRefreshing(true);
        setPull(threshold);
        const fn = onRefreshRef.current || (() => window.location.reload());
        // pequeno atraso para o spinner aparecer antes do reload
        window.setTimeout(fn, 150);
      } else {
        setPull(0);
      }
      distRef.current = 0;
      startY.current = null;
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [disabled, threshold, refreshing]);

  const progress = Math.min(pull / threshold, 1);
  const offset = (refreshing ? threshold : pull) - 44;
  const visible = pull > 0 || refreshing;

  return (
    <>
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 9999,
          transform: `translateY(${offset}px)`,
          transition: draggingRef.current ? 'none' : 'transform 0.25s ease, opacity 0.25s ease',
          opacity: visible ? 1 : 0,
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: '#ffffff',
            boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <i
            className="ri-refresh-line"
            style={{
              fontSize: 20,
              color: '#f97316',
              transform: refreshing ? undefined : `rotate(${progress * 270}deg)`,
              animation: refreshing ? 'ptr-spin 0.8s linear infinite' : 'none',
            }}
          />
        </div>
      </div>
      {children}
    </>
  );
}
