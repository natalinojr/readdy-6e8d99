import { describe, it, expect } from 'vitest';
import {
  FAIXAS_INICIAIS, avisosDasLinhas, cotarComFaixas, distanciaKm, faixaDoKm, faixasIguais, faixasSemPedido, faixasValidas,
  ganhariaFreteGratis, kmTxt, listaKm, pontoNaBorda, previaMinimo, proximaFaixa, raiosDoMapa, resumoDistancia,
  simularFreteGratis, usoPorLinha,
} from '../../pages/config-delivery/abas/area/calculos';

const F = (ate_km: number, taxa: number, tempo_max_min: number) => ({ ate_km, taxa, tempo_max_min });
const FAIXAS = [F(2, 7.5, 60), F(3, 8.5, 60), F(4, 9.5, 75)];

describe('faixas: mesma regra do servidor (km <= ate_km)', () => {
  it('ordena e ignora faixa com 0 km', () => {
    expect(faixasValidas([F(4, 9, 50), F(0, 1, 1), F(2, 6, 40)]).map((f) => f.ate_km)).toEqual([2, 4]);
  });
  it('cai na primeira faixa que comporta o km; exatamente no limite ainda é dentro', () => {
    expect(faixaDoKm(2, FAIXAS)).toMatchObject({ dentro: true, faixa: { ate_km: 2 } });
    expect(faixaDoKm(2.01, FAIXAS)).toMatchObject({ dentro: true, faixa: { ate_km: 3 } });
    expect(faixaDoKm(4, FAIXAS)).toMatchObject({ dentro: true, faixa: { ate_km: 4 } });
  });
  it('além da última faixa: fora da área (com a última faixa para a mensagem)', () => {
    expect(faixaDoKm(4.3, FAIXAS)).toMatchObject({ dentro: false, faixa: { ate_km: 4 } });
  });
  it('sem faixa válida não há cotação', () => {
    expect(faixaDoKm(1, [])).toBeNull();
    expect(faixaDoKm(1, [F(0, 5, 30)])).toBeNull();
  });
  it('cotar com as faixas da tela soma o prazo extra (dia corrido) ao da faixa', () => {
    expect(cotarComFaixas(2.8, FAIXAS, 15)).toEqual({ taxa: 8.5, ateKm: 3, tempoMax: 75, dentro: true });
    expect(cotarComFaixas(9, FAIXAS)).toMatchObject({ dentro: false, ateKm: 4 });
  });
  it('faixasIguais ignora a ordem e a faixa de 0 km (o que o salvar faz)', () => {
    expect(faixasIguais([F(3, 8.5, 60), F(2, 7.5, 60), F(0, 1, 1)], [F(2, 7.5, 60), F(3, 8.5, 60)])).toBe(true);
    expect(faixasIguais([F(2, 7.5, 60)], [F(2, 8, 60)])).toBe(false);
  });
});

describe('"+ Faixa" e "Criar faixas"', () => {
  it('acrescenta 1 km, R$ 1 e o mesmo prazo da última', () => {
    expect(proximaFaixa([F(4, 9.5, 75), F(2, 7.5, 60)])).toEqual(F(5, 10.5, 75));
  });
  it('sem faixa nenhuma começa em 2 km (não altera a lista inicial)', () => {
    expect(proximaFaixa([])).toEqual(FAIXAS_INICIAIS[0]);
    expect(proximaFaixa([])).not.toBe(FAIXAS_INICIAIS[0]);
    expect(FAIXAS_INICIAIS).toEqual([F(2, 6, 40), F(4, 9, 50)]);
  });
});

describe('uso das faixas pelos pedidos do mês', () => {
  const kms = [0.5, 1.6, 1.6, 2.3, 2.8, 2.8, 4.3];
  it('conta cada pedido na faixa em que cai e separa o que passou da última', () => {
    const u = usoPorLinha(FAIXAS, kms);
    expect(u.contagem).toEqual([3, 3, 0]);
    expect(u.fora).toBe(1);
    expect(u.total).toBe(7);
  });
  it('funciona com a lista fora de ordem (a ordem da tela só muda ao sair do campo)', () => {
    const u = usoPorLinha([F(4, 9.5, 75), F(2, 7.5, 60), F(3, 8.5, 60)], kms);
    expect(u.contagem).toEqual([0, 3, 3]);
  });
  it('linha repetida e linha de 0 km não recebem pedido', () => {
    const u = usoPorLinha([F(2, 7, 60), F(2, 8, 60), F(0, 1, 1)], [1, 1.5]);
    expect(u.contagem).toEqual([2, 0, 0]);
    expect(u.duplicada).toEqual([false, true, false]);
  });
  it('ignora pedido sem distância', () => {
    expect(usoPorLinha(FAIXAS, [0, NaN, -1]).total).toBe(0);
  });
  it('lista as faixas sem pedido só quando há pedido no mês', () => {
    const u = usoPorLinha(FAIXAS, kms);
    expect(faixasSemPedido(FAIXAS, u)).toEqual([4]);
    expect(faixasSemPedido(FAIXAS, usoPorLinha(FAIXAS, []))).toEqual([]);
  });
});

describe('avisos que não bloqueiam', () => {
  it('0 km será ignorada; km repetido; taxa e prazo menores que o da faixa anterior', () => {
    const a = avisosDasLinhas([F(0, 5, 30), F(2, 7, 60), F(2, 7, 60), F(4, 6, 50), F(6, 9, 90)]);
    expect(a[0]).toEqual(['Faixa com 0 km: será ignorada ao salvar.']);
    expect(a[1]).toEqual([]);
    expect(a[2]).toEqual(['Já existe outra faixa até 2 km.']);
    expect(a[3]).toEqual(['A taxa é menor que a da faixa de 2 km.', 'O prazo é menor que o da faixa de 2 km.']);
    expect(a[4]).toEqual([]);
  });
  it('faixas em ordem crescente não geram aviso', () => {
    expect(avisosDasLinhas(FAIXAS)).toEqual([[], [], []]);
  });
});

describe('legenda e enquadramento do mapa', () => {
  it('"95% dos pedidos até 3 km": a menor faixa com 90% ou mais', () => {
    const kms = [...Array(15).fill(1.5), ...Array(5).fill(2.8), 6]; // 21 pedidos, 15 até 2 km, 20 até 3 km
    expect(resumoDistancia(kms, [F(2, 7, 60), F(3, 8, 60), F(6, 9, 90)])).toEqual({ pct: 95, ateKm: 3, total: 21 });
  });
  it('se a primeira faixa já reúne 90% dos pedidos, é ela', () => {
    expect(resumoDistancia([...Array(19).fill(1.5), 2.8, 6], [F(2, 7, 60), F(3, 8, 60), F(6, 9, 90)])).toEqual({ pct: 90, ateKm: 2, total: 21 });
  });
  it('sem faixa nenhuma usa o percentil 90 dos pedidos', () => {
    expect(resumoDistancia([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [])).toMatchObject({ pct: 90, ateKm: 9 });
  });
  it('sem pedido não há legenda', () => {
    expect(resumoDistancia([], FAIXAS)).toBeNull();
  });
  it('de perto mostra no mínimo as duas primeiras faixas; "tudo" vai até a última', () => {
    const r = raiosDoMapa([F(2, 7, 60), F(3, 8, 60), F(6, 9, 90), F(10, 12, 100)], [1, 1.2, 2.5]);
    expect(r.pertoKm).toBeCloseTo(3 * 1.12, 5);
    expect(r.tudoKm).toBeCloseTo(10 * 1.08, 5);
  });
  it('rótulo na borda do círculo: ao nordeste fica ao norte e a leste do centro', () => {
    const [lat, lng] = pontoNaBorda(-25.5, -48.5, 3000, 45);
    expect(lat).toBeGreaterThan(-25.5);
    expect(lng).toBeGreaterThan(-48.5);
    expect(distanciaKm(-25.5, -48.5, lat, lng)).toBeCloseTo(3, 1);
  });
});

describe('textos', () => {
  it('km com vírgula e lista em português', () => {
    expect(kmTxt(2.8)).toBe('2,8');
    expect(kmTxt(3)).toBe('3');
    expect(listaKm([6])).toBe('6 km');
    expect(listaKm([6, 7, 10])).toBe('6, 7 e 10 km');
  });
});

describe('pedido mínimo: prévia do cliente', () => {
  it('R$ 30,00 → sacola R$ 24,90, faltam R$ 5,10', () => {
    expect(previaMinimo(30)).toEqual({ sacola: 24.9, falta: 5.1, pct: 83 });
  });
  it('mínimo 0 não quebra', () => {
    expect(previaMinimo(0)).toEqual({ sacola: 0, falta: 0, pct: 0 });
  });
});

describe('entrega grátis acima de um valor (mesma conta do servidor)', () => {
  it('a partir do valor, sem olhar a taxa; ate_km 0 = qualquer distância', () => {
    expect(ganhariaFreteGratis({ subtotal: 100, taxa: 8, km: 9 }, 100, 0)).toBe(true);
    expect(ganhariaFreteGratis({ subtotal: 99.99, taxa: 8, km: 1 }, 100, 0)).toBe(false);
  });
  it('com limite de km: passou do limite ou sem distância gravada não ganha', () => {
    expect(ganhariaFreteGratis({ subtotal: 120, taxa: 8, km: 3 }, 100, 3)).toBe(true);
    expect(ganhariaFreteGratis({ subtotal: 120, taxa: 8, km: 3.1 }, 100, 3)).toBe(false);
    expect(ganhariaFreteGratis({ subtotal: 120, taxa: 8, km: null }, 100, 3)).toBe(false);
  });
  it('valor 0 não vale (o servidor também ignora)', () => {
    expect(ganhariaFreteGratis({ subtotal: 500, taxa: 8, km: 1 }, 0, 0)).toBe(false);
  });
  it('simulação: quantos teriam ganhado e quanto de taxa deixaria de entrar', () => {
    const pedidos = [
      { subtotal: 150, taxa: 8.5, km: 2.8 },
      { subtotal: 110, taxa: 9.5, km: 4 },
      { subtotal: 60, taxa: 7.5, km: 1.5 },
      { subtotal: 130, taxa: 14.5, km: 7 },
    ];
    expect(simularFreteGratis(pedidos, 100, 3)).toEqual({ n: 1, total: 4, taxaAbrir: 8.5 });
    expect(simularFreteGratis(pedidos, 100, 0)).toEqual({ n: 3, total: 4, taxaAbrir: 32.5 });
  });
});
