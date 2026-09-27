import { describe, it, expect } from 'vitest';
import { VOA, criarVoa, passoVoa, refazerVoa } from '@/lib/jogos/voa';
import { CORRE, criarCorre, passoCorre, refazerCorre, velocidadeCorre } from '@/lib/jogos/corre';

// Robô do Voa Voa: bate asa quando está abaixo do meio do próximo vão e caindo.
function jogarVoa(semente: number, limite: number) {
  const e = criarVoa(semente);
  const toques: number[] = [];
  while (e.fase !== 'fim' && e.quadro < limite) {
    const prox = e.colunas.find(function (c) { return c.x + VOA.COLUNA_L > VOA.X - VOA.R; });
    const alvo = prox ? prox.vaoY + 18 : VOA.VH * 0.45;
    const toque = e.fase === 'pronto' || (e.y > alvo && e.vy >= 0);
    if (toque) toques.push(e.quadro + 1);
    passoVoa(e, toque);
  }
  return { e, toques };
}

// Robô do Corre Corre: pula (segurando) quando vem buraco, cano ou bichinho logo à frente.
function jogarCorre(semente: number, limite: number) {
  const e = criarCorre(semente);
  const trocas: number[] = [];
  let seg = false;
  let segurarAte = 0;
  while (e.fase !== 'fim' && e.quadro < limite) {
    let querPular = false;
    if (e.fase === 'pronto') querPular = true;
    else if (e.noChao) {
      const olhar = e.x + velocidadeCorre(e.x) * 9;
      const temChao = e.solidos.some(function (s) { return s.tipo === 'chao' && s.x0 <= olhar + 14 && s.x1 >= olhar + 14; });
      const cano = e.solidos.some(function (s) { return s.tipo === 'cano' && s.x0 > e.x && s.x0 - e.x < velocidadeCorre(e.x) * 12; });
      const bicho = e.inimigos.some(function (i) { return i.vivo && i.x > e.x && i.x - e.x < velocidadeCorre(e.x) * 14 + 20; });
      querPular = !temChao || cano || bicho;
    }
    if (querPular && e.fase !== 'pronto') segurarAte = e.quadro + 22;
    const agora = e.fase === 'pronto' ? (e.quadro === 0) : e.quadro < segurarAte;
    if (agora !== seg) { trocas.push(e.quadro + 1); seg = agora; }
    passoCorre(e, agora);
  }
  return { e, trocas };
}

describe('Voa Voa', function () {
  it('sem tocar, fica parado esperando', function () {
    const e = criarVoa(1);
    for (let i = 0; i < 300; i++) passoVoa(e, false);
    expect(e.fase).toBe('pronto');
  });

  it('depois do 1º toque, sem mais toques, cai no chão com 0 pontos', function () {
    const e = criarVoa(1);
    passoVoa(e, true);
    for (let i = 0; i < 600 && e.fase !== 'fim'; i++) passoVoa(e, false);
    expect(e.fase).toBe('fim');
    expect(e.pontos).toBe(0);
    expect(e.y + VOA.R).toBeGreaterThanOrEqual(VOA.CHAO - 0.001);
  });

  it('é passável: o robô passa de 30 colunas em várias sementes', function () {
    for (const s of [1, 7, 42, 999, 123456]) {
      const { e } = jogarVoa(s, 60 * 60 * 3);
      expect(e.pontos).toBeGreaterThanOrEqual(30);
    }
  });

  it('refazer a partida pela semente + toques dá a mesma pontuação', function () {
    const { e, toques } = jogarVoa(2024, 60 * 40);
    const r = refazerVoa(2024, toques, 60 * 40);
    expect(r.pontos).toBe(e.pontos);
    expect(r.quadro).toBe(e.quadro);
  });

  it('pontuação inventada não fecha com a gravação', function () {
    const { e, toques } = jogarVoa(5, 60 * 20);
    const r = refazerVoa(6, toques, 60 * 20);
    expect(r.pontos === e.pontos && r.quadro === e.quadro).toBe(false);
  });
});

describe('Corre Corre', function () {
  it('parado até o primeiro toque', function () {
    const e = criarCorre(3);
    for (let i = 0; i < 200; i++) passoCorre(e, false);
    expect(e.fase).toBe('pronto');
    expect(e.x).toBe(0);
  });

  it('sem pular, cai no primeiro buraco ou bate', function () {
    const e = criarCorre(3);
    passoCorre(e, true);
    for (let i = 0; i < 60 * 60 && e.fase !== 'fim'; i++) passoCorre(e, false);
    expect(e.fase).toBe('fim');
  });

  it('é passável: o robô vai longe em várias sementes', function () {
    for (const s of [1, 7, 42, 999, 123456]) {
      const { e } = jogarCorre(s, 60 * 90);
      expect(e.x).toBeGreaterThan(8000);
    }
  });

  it('pisar no bichinho mata ele e dá pontos', function () {
    const e = criarCorre(11);
    passoCorre(e, true);
    passoCorre(e, false);
    e.inimigos = [{ x: e.x + 30, y: CORRE.CHAO, vx: 0, x0: 0, x1: 99999, vivo: true, morreuEm: 0 }];
    e.y = CORRE.CHAO - CORRE.INIMIGO_A - 20;
    e.vy = 4;
    e.noChao = false;
    for (let i = 0; i < 20 && e.pisoes === 0 && e.fase !== 'fim'; i++) passoCorre(e, false);
    expect(e.pisoes).toBe(1);
    expect(e.fase).toBe('jogando');
  });

  it('refazer a partida dá a mesma pontuação', function () {
    const { e, trocas } = jogarCorre(77, 60 * 30);
    const r = refazerCorre(77, trocas, 60 * 30);
    expect(r.pontos).toBe(e.pontos);
    expect(r.quadro).toBe(e.quadro);
  });
});
