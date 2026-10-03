// Escolher qual parte da foto de capa aparece no topo do cardápio online.
// A pessoa arrasta a foto dentro do quadro (ou usa as setas do teclado). O quadro
// tem a proporção da capa no celular do cliente (375 × 144), então o que se vê aqui
// é o que o cliente vê. Grava como CSS object-position ("X% Y%").
import { useRef, useState } from 'react';

interface Props {
  url: string;
  /** "X% Y%" (vazio = centro) */
  posicao: string;
  onChange: (posicao: string) => void;
}

function lerPosicao(p: string): { x: number; y: number } {
  const m = /^([\d.]+)% ([\d.]+)%$/.exec((p || '').trim());
  return m ? { x: Math.min(100, Number(m[1])), y: Math.min(100, Number(m[2])) } : { x: 50, y: 50 };
}

function limitar(v: number) { return Math.max(0, Math.min(100, v)); }

export default function EditorPosicaoCapa(props: Props) {
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const inicioRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const { x, y } = lerPosicao(props.posicao);

  function aplicar(nx: number, ny: number) {
    props.onChange(Math.round(limitar(nx)) + '% ' + Math.round(limitar(ny)) + '%');
  }

  // Quanto da foto sobra fora do quadro em cada eixo (em px) — é isso que o arrasto percorre
  function sobra() {
    const caixa = caixaRef.current;
    if (!caixa || !natural) return { x: 0, y: 0 };
    const cw = caixa.clientWidth;
    const ch = caixa.clientHeight;
    const escala = Math.max(cw / natural.w, ch / natural.h);
    return { x: natural.w * escala - cw, y: natural.h * escala - ch };
  }

  function aoDescer(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    inicioRef.current = { px: e.clientX, py: e.clientY, x: x, y: y };
    setArrastando(true);
  }

  function aoMover(e: React.PointerEvent<HTMLDivElement>) {
    const ini = inicioRef.current;
    if (!ini) return;
    const s = sobra();
    // Arrastar a foto para baixo mostra a parte de cima (a posição diminui)
    const nx = s.x > 1 ? ini.x - ((e.clientX - ini.px) / s.x) * 100 : ini.x;
    const ny = s.y > 1 ? ini.y - ((e.clientY - ini.py) / s.y) * 100 : ini.y;
    aplicar(nx, ny);
  }

  function aoSoltar() {
    inicioRef.current = null;
    setArrastando(false);
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLDivElement>) {
    const passo = e.shiftKey ? 15 : 5;
    if (e.key === 'ArrowUp') { e.preventDefault(); aplicar(x, y - passo); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); aplicar(x, y + passo); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); aplicar(x - passo, y); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); aplicar(x + passo, y); }
  }

  const s = sobra();
  const daParaMover = s.x > 1 || s.y > 1;

  return (
    <div>
      <div
        ref={caixaRef}
        role="group"
        tabIndex={0}
        aria-label="Parte da foto que aparece na capa. Arraste a foto ou use as setas do teclado."
        onPointerDown={aoDescer}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        onKeyDown={aoTeclar}
        className={'relative w-full rounded-xl overflow-hidden border border-zinc-200 bg-zinc-100 select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 ' +
          (arrastando ? 'cursor-grabbing' : 'cursor-grab')}
        style={{ aspectRatio: '375 / 144' }}
      >
        <img
          src={props.url}
          alt="Capa"
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ objectPosition: x + '% ' + y + '%' }}
        />
        {/* Onde a logo fica por cima da capa (canto de baixo, à esquerda) */}
        <div
          aria-hidden="true"
          className="absolute rounded-full border-2 border-white/90 bg-white/40 pointer-events-none"
          style={{ width: '21.3%', aspectRatio: '1 / 1', left: '5.3%', top: '72%' }}
        />
        {!arrastando && daParaMover ? (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/60 text-white text-[11px] font-semibold pointer-events-none flex items-center gap-1">
            <i className="ri-drag-move-2-line text-xs" />
            Arraste para ajustar
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <p className="text-[10px] text-zinc-400">Assim fica no celular do cliente. O círculo mostra onde vai a logo.</p>
        {props.posicao && props.posicao !== '50% 50%' ? (
          <button type="button" onClick={() => props.onChange('')} className="shrink-0 text-[11px] font-semibold text-zinc-500 hover:text-zinc-800 cursor-pointer">
            Centralizar
          </button>
        ) : null}
      </div>
    </div>
  );
}
