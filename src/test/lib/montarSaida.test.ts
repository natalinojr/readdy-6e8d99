import { describe, expect, it } from 'vitest';
import { distKm, linkMaps, montarSaidas, ordenarParadas, type PedidoSaida } from '@/lib/montarSaida';

// Paranaguá: loja no centro; ~0,01° de latitude ≈ 1,1 km
const LOJA = { lat: -25.52, lng: -48.51 };
const AGORA = new Date('2026-09-27T20:00:00Z').getTime();
const minAtras = (m: number) => new Date(AGORA - m * 60000).toISOString();
const ped = (id: string, lat: number, lng: number, criadoHaMin = 10, sla: number | null = 50): PedidoSaida =>
  ({ id, number: id, cliente: id, lat, lng, created_at: minAtras(criadoHaMin), sla_min: sla });

describe('montarSaidas', () => {
  it('junta pedidos perto numa saída só e ordena a partir da loja', () => {
    const s = montarSaidas([ped('B', -25.54, -48.51), ped('A', -25.53, -48.51)], [], LOJA, AGORA);
    expect(s).toHaveLength(1);
    expect(s[0].paradas.map((p) => p.pedido.id)).toEqual(['A', 'B']);
    expect(s[0].km).toBeGreaterThan(2);
    expect(s[0].mapsUrl).toContain('waypoints=');
  });

  it('não junta pedido longe (além do raio)', () => {
    const s = montarSaidas([ped('A', -25.53, -48.51), ped('LONGE', -25.60, -48.51)], [], LOJA, AGORA);
    expect(s).toHaveLength(2);
  });

  it('não junta se o segundo pedido fizer o primeiro atrasar', () => {
    // A com 10 min de prazo; sozinho chega em ~9 min. B fica NO CAMINHO (entre a loja e A), então iria
    // antes e empurraria A para ~11 min — estoura. B depois de A não atrasaria A (ordem pelo vizinho mais próximo).
    const a = ped('A', -25.53, -48.51, 40, 50);
    const b = ped('B', -25.525, -48.51, 5, 60);
    const s = montarSaidas([a, b], [], LOJA, AGORA);
    expect(s.map((x) => x.paradas.map((p) => p.pedido.id))).toEqual([['A'], ['B']]);
    // e pedido depois de A (não atrasa A) é juntado normalmente
    const c = ped('C', -25.535, -48.51, 5, 60);
    expect(montarSaidas([a, c], [], LOJA, AGORA)[0].paradas.map((p) => p.pedido.id)).toEqual(['A', 'C']);
  });

  it('o mais urgente vira semente e sai na primeira sugestão', () => {
    const s = montarSaidas([ped('CALMO', -25.60, -48.51, 1, 90), ped('URGENTE', -25.53, -48.51, 40, 50)], [], LOJA, AGORA);
    expect(s[0].paradas[0].pedido.id).toBe('URGENTE');
  });

  it('limita o número de paradas', () => {
    const lista = [1, 2, 3, 4].map((i) => ped(`P${i}`, -25.52 - i * 0.004, -48.51));
    const s = montarSaidas(lista, [], LOJA, AGORA, { maxParadas: 3 });
    expect(s.map((x) => x.paradas.length)).toEqual([3, 1]);
  });

  it('sugere o motoboy livre mais perto da loja, um por saída', () => {
    const motos = [
      { driver_id: 'longe', nome: 'Longe', lat: -25.60, lng: -48.51 },
      { driver_id: 'perto', nome: 'Perto', lat: -25.521, lng: -48.51 },
    ];
    const s = montarSaidas([ped('A', -25.53, -48.51), ped('LONGE', -25.60, -48.60)], motos, LOJA, AGORA);
    expect(s[0].motoboy?.driver_id).toBe('perto');
    expect(s[1].motoboy?.driver_id).toBe('longe');
  });

  it('sem motoboy livre a sugestão vem sem motoboy', () => {
    expect(montarSaidas([ped('A', -25.53, -48.51)], [], LOJA, AGORA)[0].motoboy).toBeNull();
  });

  it('loja sem pin: a rota começa na primeira parada', () => {
    const s = montarSaidas([ped('A', -25.53, -48.51)], [], null, AGORA);
    expect(s[0].mapsUrl).not.toContain('origin=');
    expect(s[0].paradas[0].chegadaMin).toBe(5); // só o tempo de sair
  });

  it('marca parada que já vai chegar atrasada', () => {
    const s = montarSaidas([ped('ATRASADO', -25.53, -48.51, 60, 50)], [], LOJA, AGORA);
    expect(s[0].paradas[0].atrasa).toBe(true);
  });
});

describe('auxiliares', () => {
  it('distância em km', () => {
    expect(distKm({ lat: -25.52, lng: -48.51 }, { lat: -25.53, lng: -48.51 })).toBeCloseTo(1.11, 1);
  });
  it('vizinho mais próximo', () => {
    const o = ordenarParadas(LOJA, [ped('C', -25.55, -48.51), ped('A', -25.53, -48.51), ped('B', -25.54, -48.51)]);
    expect(o.map((p) => p.id)).toEqual(['A', 'B', 'C']);
  });
  it('link do Maps com origem, paradas e destino', () => {
    const url = linkMaps(LOJA, [{ lat: -25.53, lng: -48.51 }, { lat: -25.54, lng: -48.52 }]);
    expect(url).toContain('origin=-25.520000%2C-48.510000');
    expect(url).toContain('destination=-25.540000%2C-48.520000');
    expect(url).toContain('waypoints=-25.530000%2C-48.510000');
  });
});

describe('encaixar na saída de quem ainda não saiu', () => {
  const joao = (pedidos: PedidoSaida[]) => ({ driver_id: 'joao', nome: 'João', pedidos });

  it('pronto perto de qualquer parada do motoboy entra na saída dele, sem trocar o motoboy', () => {
    const s = montarSaidas([ped('NOVO', -25.535, -48.51)], [{ driver_id: 'livre', nome: 'Livre', lat: -25.52, lng: -48.51 }], LOJA, AGORA, {},
      { abertas: [joao([ped('DELE', -25.53, -48.51)])] });
    expect(s).toHaveLength(1);
    expect(s[0].encaixe).toEqual({ driver_id: 'joao', nome: 'João', fixos: ['DELE'] });
    expect(s[0].paradas.map((p) => p.pedido.id)).toEqual(['DELE', 'NOVO']);
    expect(s[0].motoboy).toBeNull();
  });

  it('nada perto: não sugere encaixe e o pronto vira saída nova', () => {
    const s = montarSaidas([ped('LONGE', -25.60, -48.51)], [], LOJA, AGORA, {}, { abertas: [joao([ped('DELE', -25.53, -48.51)])] });
    expect(s).toHaveLength(1);
    expect(s[0].encaixe).toBeUndefined();
    expect(s[0].paradas.map((p) => p.pedido.id)).toEqual(['LONGE']);
  });

  it('respeita o máximo de paradas contando os que já eram dele', () => {
    const dele = [ped('D1', -25.53, -48.51), ped('D2', -25.531, -48.51), ped('D3', -25.532, -48.51)];
    const s = montarSaidas([ped('NOVO', -25.533, -48.51)], [], LOJA, AGORA, {}, { abertas: [joao(dele)] });
    expect(s.every((x) => !x.encaixe)).toBe(true);
  });
});

describe('esperar pedido que ainda está na cozinha', () => {
  const cozinha = (id: string, lat: number, emMin: number, criadoHaMin = 5, sla: number | null = 50): PedidoSaida =>
    ({ ...ped(id, lat, -48.51, criadoHaMin, sla), prontoEm: AGORA + emMin * 60000 });

  it('sugere esperar o pedido perto que fica pronto logo e não atrasa ninguém', () => {
    const s = montarSaidas([ped('A', -25.53, -48.51)], [], LOJA, AGORA, {}, { emPreparo: [cozinha('C', -25.535, 4)] });
    expect(s[0].espera?.pedido.id).toBe('C');
    expect(s[0].espera?.esperaMin).toBe(4);
    expect(s[0].espera?.perto.id).toBe('A');
    // a sugestão em si continua só com os prontos
    expect(s[0].paradas.map((p) => p.pedido.id)).toEqual(['A']);
  });

  it('não sugere quando falta muito para ficar pronto ou é longe', () => {
    expect(montarSaidas([ped('A', -25.53, -48.51)], [], LOJA, AGORA, {}, { emPreparo: [cozinha('DEMORA', -25.535, 15)] })[0].espera).toBeFalsy();
    expect(montarSaidas([ped('A', -25.53, -48.51)], [], LOJA, AGORA, {}, { emPreparo: [cozinha('LONGE', -25.60, 3)] })[0].espera).toBeFalsy();
  });

  it('não sugere se a espera fizer o pronto atrasar', () => {
    // A tem 10 min de folga (criado há 40, prazo 50); esperar 7 min empurra a saída para 9 min e a chegada estoura
    const s = montarSaidas([ped('A', -25.53, -48.51, 40, 50)], [], LOJA, AGORA, {}, { emPreparo: [cozinha('C', -25.535, 7)] });
    expect(s[0].espera).toBeFalsy();
  });

  it('cada pedido da cozinha vai para uma saída só', () => {
    const s = montarSaidas([ped('A', -25.53, -48.51), ped('B', -25.60, -48.51)], [], LOJA, AGORA, {},
      { emPreparo: [cozinha('C', -25.535, 3)] });
    expect(s.filter((x) => x.espera).length).toBe(1);
  });

  it('com o pedido da cozinha na saída, ela só sai depois que ele fica pronto', () => {
    const [x] = montarSaidas([cozinha('C', -25.53, 6)], [], LOJA, AGORA);
    expect(x.paradas[0].chegadaMin).toBeGreaterThanOrEqual(8); // 6 de espera + 2 para pegar + o caminho
  });
});
