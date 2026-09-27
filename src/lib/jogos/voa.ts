// "Voa Voa": o passarinho cai sozinho, cada toque dá um impulso para cima e ele tem que
// passar pelo vão das colunas. Simulação em passos fixos (60 por segundo), sem
// Math.random nem relógio: semente + quadros em que houve toque ⇒ sempre a mesma partida.
import { entre } from './rng.ts';

export const VOA = {
  VW: 360,
  VH: 640,
  CHAO: 560,
  X: 110,
  R: 13,
  GRAVIDADE: 0.42,
  IMPULSO: -7.2,
  VMAX: 10,
  COLUNA_L: 62,
  VAO: 158,
  INTERVALO: 92,
  VEL_INICIAL: 2.6,
} as const;

export type FaseJogo = 'pronto' | 'jogando' | 'fim';

export interface Coluna { x: number; vaoY: number; passou: boolean }

export interface EstadoVoa {
  rng: number;
  quadro: number;
  fase: FaseJogo;
  y: number;
  vy: number;
  colunas: Coluna[];
  proxColuna: number;
  pontos: number;
  /** Deslocamento acumulado do cenário (só para o desenho) */
  rolagem: number;
}

export function criarVoa(semente: number): EstadoVoa {
  return {
    rng: semente | 0,
    quadro: 0,
    fase: 'pronto',
    y: VOA.VH * 0.42,
    vy: 0,
    colunas: [],
    proxColuna: 40,
    pontos: 0,
    rolagem: 0,
  };
}

export function velocidadeVoa(pontos: number): number {
  return VOA.VEL_INICIAL + Math.min(pontos * 0.03, 1.4);
}

function circuloBateRet(cx: number, cy: number, r: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const px = Math.max(x0, Math.min(cx, x1));
  const py = Math.max(y0, Math.min(cy, y1));
  const dx = cx - px;
  const dy = cy - py;
  return dx * dx + dy * dy < r * r;
}

/** Avança um quadro. `toque` = houve toque neste quadro. */
export function passoVoa(e: EstadoVoa, toque: boolean): void {
  if (e.fase === 'fim') return;
  e.quadro++;

  if (e.fase === 'pronto') {
    // flutua parado esperando o primeiro toque
    e.y = VOA.VH * 0.42 + Math.sin(e.quadro / 10) * 6;
    e.rolagem += VOA.VEL_INICIAL;
    if (!toque) return;
    e.fase = 'jogando';
  }

  if (toque) e.vy = VOA.IMPULSO;
  e.vy = Math.min(e.vy + VOA.GRAVIDADE, VOA.VMAX);
  e.y = Math.max(e.y + e.vy, -60);

  const vel = velocidadeVoa(e.pontos);
  e.rolagem += vel;

  e.proxColuna--;
  if (e.proxColuna <= 0) {
    const margem = 70;
    e.colunas.push({
      x: VOA.VW + 10,
      vaoY: entre(e, margem + VOA.VAO / 2, VOA.CHAO - margem - VOA.VAO / 2),
      passou: false,
    });
    e.proxColuna = VOA.INTERVALO;
  }

  for (const c of e.colunas) {
    c.x -= vel;
    if (!c.passou && c.x + VOA.COLUNA_L < VOA.X - VOA.R) {
      c.passou = true;
      e.pontos++;
    }
  }
  e.colunas = e.colunas.filter(function (c) { return c.x + VOA.COLUNA_L > -20; });

  if (e.y + VOA.R >= VOA.CHAO) {
    e.y = VOA.CHAO - VOA.R;
    e.fase = 'fim';
    return;
  }
  for (const c of e.colunas) {
    const topo = c.vaoY - VOA.VAO / 2;
    const base = c.vaoY + VOA.VAO / 2;
    if (
      circuloBateRet(VOA.X, e.y, VOA.R, c.x, -1000, c.x + VOA.COLUNA_L, topo)
      || circuloBateRet(VOA.X, e.y, VOA.R, c.x, base, c.x + VOA.COLUNA_L, VOA.CHAO)
    ) {
      e.fase = 'fim';
      return;
    }
  }
}

/** Refaz a partida a partir da semente e dos quadros com toque (conferência da pontuação). */
export function refazerVoa(semente: number, toques: number[], limiteQuadros = 60 * 60 * 30): EstadoVoa {
  const e = criarVoa(semente);
  const conjunto = new Set(toques);
  while (e.fase !== 'fim' && e.quadro < limiteQuadros) {
    passoVoa(e, conjunto.has(e.quadro + 1));
  }
  return e;
}
