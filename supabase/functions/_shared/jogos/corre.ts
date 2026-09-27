// "Corre Corre": corredor de plataforma. O boneco anda sozinho; segurar a tela = pular
// (quanto mais segura, mais alto). Buracos, canos para pular por cima, bichinhos que
// morrem se pisar em cima e moedas. Mesma regra do Voa Voa: passos fixos de 60/s e
// sorteio pela semente ⇒ semente + quadros em que o dedo mudou ⇒ sempre a mesma partida.
import { entre, proximo } from './rng.ts';
import type { FaseJogo } from './voa.ts';

export const CORRE = {
  VW: 400,
  VH: 711,
  CHAO: 560,
  P_LARG: 26,
  P_ALT: 34,
  GRAVIDADE: 0.6,
  PULO: -11.8,
  CORTE_PULO: -5,
  QUEDA_MAX: 14,
  PISAO: -9,
  COYOTE: 6,
  BUFFER: 7,
  CAMERA_X: 110,
  INIMIGO_L: 28,
  INIMIGO_A: 24,
  MOEDA_R: 9,
} as const;

export interface Solido { x0: number; x1: number; topo: number; tipo: 'chao' | 'cano' }
export interface Plataforma { x0: number; x1: number; y: number }
export interface Moeda { x: number; y: number; pega: boolean }
export interface Inimigo { x: number; y: number; vx: number; x0: number; x1: number; vivo: boolean; morreuEm: number }

export interface EstadoCorre {
  rng: number;
  quadro: number;
  fase: FaseJogo;
  x: number;
  y: number;
  vy: number;
  noChao: boolean;
  desdeChao: number;
  pedidoPulo: number;
  segurando: boolean;
  pulando: boolean;
  solidos: Solido[];
  plataformas: Plataforma[];
  moedas: Moeda[];
  inimigos: Inimigo[];
  geradoAte: number;
  qtdMoedas: number;
  pisoes: number;
  pontos: number;
}

export function velocidadeCorre(x: number): number {
  return 3.4 + Math.min(Math.max(x, 0) / 4000, 2.6);
}

export function pontosCorre(e: EstadoCorre): number {
  return Math.floor(Math.max(e.x, 0) / 20) + e.qtdMoedas * 5 + e.pisoes * 20;
}

export function criarCorre(semente: number): EstadoCorre {
  const e: EstadoCorre = {
    rng: semente | 0,
    quadro: 0,
    fase: 'pronto',
    x: 0,
    y: CORRE.CHAO,
    vy: 0,
    noChao: true,
    desdeChao: 0,
    pedidoPulo: 999,
    segurando: false,
    pulando: false,
    solidos: [{ x0: -400, x1: 900, topo: CORRE.CHAO, tipo: 'chao' }],
    plataformas: [],
    moedas: [],
    inimigos: [],
    geradoAte: 900,
    qtdMoedas: 0,
    pisoes: 0,
    pontos: 0,
  };
  for (let i = 0; i < 4; i++) e.moedas.push({ x: 380 + i * 36, y: CORRE.CHAO - 40, pega: false });
  gerar(e);
  return e;
}

function gerar(e: EstadoCorre): void {
  const C = CORRE;
  while (e.geradoAte < e.x + 1300) {
    const d = Math.min(e.geradoAte / 12000, 1);
    const vel = velocidadeCorre(e.geradoAte);
    const vaoMax = 0.6 * vel * 38;
    const vao = entre(e, 60, 60 + (vaoMax - 60) * (0.4 + 0.6 * d));
    const a = e.geradoAte + vao;
    const b = a + entre(e, 280, 660 - 220 * d);
    e.solidos.push({ x0: a, x1: b, topo: C.CHAO, tipo: 'chao' });

    // moedas em arco por cima do buraco, mostrando o caminho
    if (proximo(e) < 0.4) {
      const meio = a - vao / 2;
      for (let i = -1; i <= 1; i++) e.moedas.push({ x: meio + i * 26, y: C.CHAO - 80 - (i === 0 ? 22 : 0), pega: false });
    }

    // espaço para aterrissar antes/depois de cada obstáculo (distância de um pulo inteiro)
    const folga = vel * 38 * 0.85;
    const uteis0 = a + folga;
    const uteis1 = b - folga;
    const metade = (a + b) / 2;
    let livreDesde = uteis0;
    // cano na primeira metade
    if (metade - 44 - uteis0 > 20 && proximo(e) < 0.2 + 0.3 * d) {
      const cx = entre(e, uteis0, metade - 44);
      const altura = entre(e, 40, 72);
      e.solidos.push({ x0: cx, x1: cx + 44, topo: C.CHAO - altura, tipo: 'cano' });
      e.moedas.push({ x: cx + 22, y: C.CHAO - altura - 50, pega: false });
      livreDesde = cx + 44 + folga;
    } else if (proximo(e) < 0.6) {
      const n = 3 + Math.floor(proximo(e) * 3);
      const mx = entre(e, a + 60, Math.max(a + 60, metade - n * 30));
      for (let i = 0; i < n; i++) e.moedas.push({ x: mx + i * 30, y: C.CHAO - 40, pega: false });
    }
    // bichinho na segunda metade, longe do cano e das beiradas
    if (proximo(e) < 0.25 + 0.35 * d) {
      const x0 = Math.max(metade, livreDesde);
      const x1 = uteis1;
      if (x1 - x0 > 60) {
        e.inimigos.push({ x: entre(e, x0, x1), y: C.CHAO, vx: -(0.7 + 0.5 * d), x0, x1, vivo: true, morreuEm: 0 });
      }
    }
    // plataforma no alto com moedas
    if (b - a > 300 && proximo(e) < 0.35) {
      const pl = entre(e, 90, 160);
      const px = entre(e, a + 40, b - pl - 40);
      const py = C.CHAO - entre(e, 95, 125);
      e.plataformas.push({ x0: px, x1: px + pl, y: py });
      for (let mx = px + 18; mx < px + pl - 10; mx += 28) e.moedas.push({ x: mx, y: py - 28, pega: false });
    }
    e.geradoAte = b;
  }
  const corte = e.x - 400;
  e.solidos = e.solidos.filter(function (s) { return s.x1 > corte; });
  e.plataformas = e.plataformas.filter(function (p) { return p.x1 > corte; });
  e.moedas = e.moedas.filter(function (m) { return m.x > corte && !m.pega; });
  e.inimigos = e.inimigos.filter(function (i) { return i.x > corte && (i.vivo || e.quadro - i.morreuEm < 30); });
}

/** Avança um quadro. `segurando` = dedo na tela (ou tecla) neste quadro. */
export function passoCorre(e: EstadoCorre, segurando: boolean): void {
  if (e.fase === 'fim') return;
  const C = CORRE;
  e.quadro++;
  const apertou = segurando && !e.segurando;
  e.segurando = segurando;

  if (e.fase === 'pronto') {
    if (apertou) e.fase = 'jogando';
    return;
  }

  if (apertou) e.pedidoPulo = 0; else e.pedidoPulo++;
  if (e.noChao) e.desdeChao = 0; else e.desdeChao++;

  if (e.pedidoPulo <= C.BUFFER && e.desdeChao <= C.COYOTE && !e.pulando) {
    e.vy = C.PULO;
    e.noChao = false;
    e.pulando = true;
    e.pedidoPulo = 999;
    e.desdeChao = 999;
  }
  if (!segurando && e.pulando && e.vy < C.CORTE_PULO) e.vy = C.CORTE_PULO;

  const yAntes = e.y;
  e.x += velocidadeCorre(e.x);
  e.vy = Math.min(e.vy + C.GRAVIDADE, C.QUEDA_MAX);
  e.y += e.vy;
  e.noChao = false;

  const hw = C.P_LARG / 2 - 2;
  const px0 = e.x - hw;
  const px1 = e.x + hw;

  // pousar (sólidos e plataformas vazadas)
  if (e.vy >= 0) {
    for (const s of e.solidos) {
      if (px1 > s.x0 && px0 < s.x1 && yAntes <= s.topo + 0.01 && e.y >= s.topo) {
        e.y = s.topo; e.vy = 0; e.noChao = true;
      }
    }
    for (const p of e.plataformas) {
      if (px1 > p.x0 && px0 < p.x1 && yAntes <= p.y + 0.01 && e.y >= p.y) {
        e.y = p.y; e.vy = 0; e.noChao = true;
      }
    }
  }
  if (e.noChao) e.pulando = false;

  // bater de lado em cano/beirada = fim
  for (const s of e.solidos) {
    if (px1 > s.x0 && px0 < s.x1 && e.y > s.topo + 4) {
      e.fase = 'fim';
      e.pontos = pontosCorre(e);
      return;
    }
  }

  for (const m of e.moedas) {
    if (m.pega) continue;
    const cx = Math.max(px0, Math.min(m.x, px1));
    const cy = Math.max(e.y - C.P_ALT, Math.min(m.y, e.y));
    const dx = m.x - cx; const dy = m.y - cy;
    if (dx * dx + dy * dy < C.MOEDA_R * C.MOEDA_R) { m.pega = true; e.qtdMoedas++; }
  }

  for (const i of e.inimigos) {
    if (!i.vivo) continue;
    i.x += i.vx;
    if (i.x < i.x0 || i.x > i.x1) { i.vx = -i.vx; i.x = Math.max(i.x0, Math.min(i.x, i.x1)); }
    const ix0 = i.x - C.INIMIGO_L / 2;
    const ix1 = i.x + C.INIMIGO_L / 2;
    const itopo = i.y - C.INIMIGO_A;
    if (px1 > ix0 && px0 < ix1 && e.y > itopo && e.y - C.P_ALT < i.y) {
      if (e.vy > 0 && yAntes <= itopo + 8) {
        i.vivo = false; i.morreuEm = e.quadro;
        e.vy = C.PISAO; e.pulando = true;
        e.pisoes++;
      } else {
        e.fase = 'fim';
        e.pontos = pontosCorre(e);
        return;
      }
    }
  }

  if (e.y > C.CHAO + 300) {
    e.fase = 'fim';
    e.pontos = pontosCorre(e);
    return;
  }
  e.pontos = pontosCorre(e);
  gerar(e);
}

/** Refaz a partida: `trocas` = quadros em que o dedo mudou (apertou/soltou), começando solto. */
export function refazerCorre(semente: number, trocas: number[], limiteQuadros = 60 * 60 * 30): EstadoCorre {
  const e = criarCorre(semente);
  const conjunto = new Set(trocas);
  let segurando = false;
  while (e.fase !== 'fim' && e.quadro < limiteQuadros) {
    if (conjunto.has(e.quadro + 1)) segurando = !segurando;
    passoCorre(e, segurando);
  }
  return e;
}
