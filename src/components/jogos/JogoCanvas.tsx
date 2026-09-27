import { useEffect, useRef } from 'react';
import { novaSemente } from '@/lib/jogos/rng';
import type { MotorJogo } from './catalogo';

/** Semente + quadros com entrada: é o que o servidor vai usar para refazer a partida (ranking). */
export interface GravacaoPartida { jogo: string; semente: number; quadros: number[]; pontos: number }

interface Props {
  motor: MotorJogo;
  /** Muda para começar uma partida nova */
  partida: number;
  /** Semente sorteada pelo servidor (partida valendo ranking); sem ela, sorteia aqui */
  semente?: number | null;
  onFim: (g: GravacaoPartida) => void;
}

const PASSO_MS = 1000 / 60;

export default function JogoCanvas(props: Props) {
  const { motor, partida } = props;
  const sementeFixa = props.semente;
  const caixaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFimRef = useRef(props.onFim);
  onFimRef.current = props.onFim;

  useEffect(function () {
    const caixa = caixaRef.current;
    const canvas = canvasRef.current;
    if (!caixa || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const semente = sementeFixa != null ? sementeFixa : novaSemente();
    const estado = motor.criar(semente);
    const quadros: number[] = [];
    let toquePendente = false;
    let segurando = false;
    let valorAnterior = false;
    let acumulado = 0;
    let ultimo = performance.now();
    let fimAvisado = false;
    let escala = 1;
    let raf = 0;

    function ajustar() {
      if (!caixa || !canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const s = Math.min(caixa.clientWidth / motor.VW, caixa.clientHeight / motor.VH);
      canvas.style.width = Math.floor(motor.VW * s) + 'px';
      canvas.style.height = Math.floor(motor.VH * s) + 'px';
      canvas.width = Math.floor(motor.VW * s * dpr);
      canvas.height = Math.floor(motor.VH * s * dpr);
      escala = s * dpr;
    }
    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(caixa);

    function passo() {
      if (motor.fase(estado) === 'fim') return;
      let valor: boolean;
      if (motor.entrada === 'toque') {
        valor = toquePendente;
        if (valor) quadros.push(motor.quadro(estado) + 1);
      } else {
        // toque rápido (aperta e solta entre dois quadros) ainda conta como 1 quadro apertado
        valor = segurando || toquePendente;
        if (valor !== valorAnterior) quadros.push(motor.quadro(estado) + 1);
        valorAnterior = valor;
      }
      toquePendente = false;
      motor.passo(estado, valor);
      if (motor.fase(estado) === 'fim' && !fimAvisado) {
        fimAvisado = true;
        onFimRef.current({ jogo: motor.id, semente, quadros: quadros.slice(), pontos: motor.pontos(estado) });
      }
    }

    function loop(t: number) {
      acumulado += Math.min(t - ultimo, 100);
      ultimo = t;
      let n = 0;
      while (acumulado >= PASSO_MS && n < 6) { acumulado -= PASSO_MS; n++; passo(); }
      if (ctx) {
        ctx.setTransform(escala, 0, 0, escala, 0, 0);
        motor.desenhar(ctx, estado);
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    function apertar(ev: Event) {
      ev.preventDefault();
      toquePendente = true;
      segurando = true;
    }
    function soltar() { segurando = false; }
    function tecla(ev: KeyboardEvent) {
      if (ev.code !== 'Space' && ev.code !== 'ArrowUp' && ev.code !== 'KeyW') return;
      ev.preventDefault();
      if (ev.type === 'keydown') { if (!ev.repeat) { toquePendente = true; segurando = true; } }
      else segurando = false;
    }
    canvas.addEventListener('pointerdown', apertar);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
    window.addEventListener('keydown', tecla);
    window.addEventListener('keyup', tecla);

    return function () {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', apertar);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
      window.removeEventListener('keydown', tecla);
      window.removeEventListener('keyup', tecla);
    };
  }, [motor, partida, sementeFixa]);

  return (
    <div ref={caixaRef} className="absolute inset-0 flex items-center justify-center">
      <canvas
        ref={canvasRef}
        className="block rounded-xl shadow-2xl touch-none select-none"
        style={{ touchAction: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties}
      />
    </div>
  );
}
