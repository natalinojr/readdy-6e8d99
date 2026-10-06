import { describe, it, expect } from 'vitest';
import { acumulado, distM, orientar, projetar, textoDistancia, type LatLng, type PernaRota } from '@/lib/navegacaoRota';

// Rota em "L": 3 pontos para o norte (~111 m cada) e vira à direita (leste) por 2 trechos.
const L: LatLng[] = [
  [-25.5000, -48.5000],
  [-25.4990, -48.5000],
  [-25.4980, -48.5000],
  [-25.4970, -48.5000],
  [-25.4970, -48.4990],
  [-25.4970, -48.4980],
];
const perna: PernaRota = {
  parada_id: 'p1', distancia_m: 0, duracao_s: 120,
  passos: [
    { texto: 'Siga para o norte', tipo: 11, distancia_m: 333, duracao_s: 60, ini: 0, fim: 3 },
    { texto: 'Vire à direita na Rua B', tipo: 1, distancia_m: 200, duracao_s: 60, ini: 3, fim: 5 },
    { texto: 'Chegou ao destino', tipo: 10, distancia_m: 0, duracao_s: 0, ini: 5, fim: 5 },
  ],
};
const cum = acumulado(L);
perna.distancia_m = cum[cum.length - 1];

describe('navegacaoRota', () => {
  it('projeta o GPS no trecho certo e mede o quanto saiu da linha', () => {
    const p = projetar(L, cum, [-25.4985, -48.49995], 0)!;
    expect(p.idx).toBe(1);
    expect(p.fora).toBeLessThan(10);
    expect(p.percorrido).toBeGreaterThan(cum[1]);
    expect(p.percorrido).toBeLessThan(cum[2]);
  });

  it('fora da rota: distância grande até a linha', () => {
    const p = projetar(L, cum, [-25.4985, -48.4960], 0)!;
    expect(p.fora).toBeGreaterThan(200);
  });

  it('próxima manobra = a virada à direita, com a distância até ela', () => {
    const p = projetar(L, cum, [-25.4990, -48.5000], 0)!;
    const o = orientar(perna, cum, p)!;
    expect(o.texto).toBe('Vire à direita na Rua B');
    expect(o.emM).toBeGreaterThan(200);
    expect(o.emM).toBeLessThan(240);
    expect(Math.round(o.faltaM)).toBe(Math.round(cum[5] - cum[1]));
    expect(o.faltaS).toBeGreaterThan(0);
  });

  it('depois da virada a próxima é a chegada, e a distância é o que falta', () => {
    const p = projetar(L, cum, [-25.4970, -48.4985], 2)!;
    const o = orientar(perna, cum, p)!;
    expect(o.tipo).toBe(10);
    expect(Math.round(o.emM)).toBe(Math.round(o.faltaM));
  });

  it('não volta para um trecho anterior quando já passou dele', () => {
    // Rota que vai e volta pela mesma rua: no trecho da volta, deve ficar na volta.
    const ida: LatLng[] = [[-25.5, -48.5], [-25.499, -48.5], [-25.5, -48.5]];
    const c = acumulado(ida);
    const p = projetar(ida, c, [-25.4995, -48.5], 1)!;
    expect(p.idx).toBe(1);
  });

  it('textos de distância', () => {
    expect(textoDistancia(347)).toBe('350 m');
    expect(textoDistancia(1234)).toBe('1,2 km');
    expect(Math.round(distM([-25.5, -48.5], [-25.499, -48.5]))).toBe(111);
  });
});
