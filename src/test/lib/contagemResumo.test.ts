/**
 * src/lib/contagemResumo.ts — resumo de uma contagem (cartão do histórico) e Estoque teórico "contagem × hoje".
 */
import { describe, it, expect } from 'vitest';
import {
  itensQueExplicam, resumirContagem, porImpacto, dataBRparaYmd, diasEntre, diaCurto, textoDiasSemContar,
  montarLinhasTeorico, maisMexeram, fmtQtdTela, fmtQtdSinal, reaisComSinal,
} from '@/lib/contagemResumo';

const item = (diferenca: number, precoUnitario: number, nome = 'x') => ({ nome, diferenca, precoUnitario });

describe('quais itens explicam as diferenças', () => {
  it('2 itens somam 80% quando concentram (−R$ 60, −R$ 30, −R$ 5, −R$ 5)', () => {
    const itens = [item(-6, 10), item(-3, 10), item(-0.5, 10), item(-0.5, 10), item(0, 10)];
    expect(itensQueExplicam(itens)).toEqual({ n: 2, de: 4 });
  });

  it('sem diferença ou sem preço não explica nada', () => {
    expect(itensQueExplicam([item(0, 10)])).toEqual({ n: 0, de: 0 });
    expect(itensQueExplicam([item(-2, 0)])).toEqual({ n: 0, de: 0 });
    expect(itensQueExplicam([])).toEqual({ n: 0, de: 0 });
  });

  it('sobra e falta contam pelo módulo', () => {
    // +R$ 50 e −R$ 50: 1 sozinho tem 50% (< 80%), precisa dos 2
    expect(itensQueExplicam([item(5, 10), item(-5, 10)])).toEqual({ n: 2, de: 2 });
  });
});

describe('resumo da contagem', () => {
  it('conta, soma o impacto com sinal e ordena por R$', () => {
    const r = resumirContagem([item(-1, 5, 'a'), item(0, 5, 'b'), item(10, 1, 'c'), item(-0.00001, 9, 'd'), item(-4, 20, 'e'), item(1, 1, 'f')]);
    expect(r.contados).toBe(6);
    expect(r.comDiferenca).toBe(4); // -0.00001 é arredondamento, não diferença
    expect(r.semDiferenca).toBe(2);
    expect(r.impactoLiquido).toBeCloseTo(-5 + 10 - 80 + 1, 6);
    expect(r.topo.map((i) => i.nome)).toEqual(['e', 'c', 'a', 'f']);
  });

  it('só diz "explicam" quando poucos concentram a diferença', () => {
    const concentrado = resumirContagem([item(-10, 10), item(-1, 1), item(-1, 1), item(-1, 1)]);
    expect(concentrado.explicam).toEqual({ n: 1, de: 4, fracao: 0.8 });
    // todos pesam igual: 4 de 5 somam 80%, mas isso não é concentrar
    const espalhado = resumirContagem([item(-1, 10), item(-1, 10), item(-1, 10), item(-1, 10), item(-1, 10)]);
    expect(espalhado.explicam).toBeNull();
    // um só item com diferença: nada a "explicar"
    expect(resumirContagem([item(-3, 10)]).explicam).toBeNull();
  });

  it('empate em R$ desempata pela maior diferença em quantidade', () => {
    const ordenado = porImpacto([item(-2, 5, 'p'), item(-5, 2, 'q')]);
    expect(ordenado.map((i) => i.nome)).toEqual(['q', 'p']);
  });
});

describe('formatação', () => {
  const semEspaco = (t: string) => t.replace(/ /g, ' ');
  it('quantidade legível na unidade da tela ou do banco', () => {
    expect(fmtQtdTela(2500, 'g')).toBe('2,5 kg');
    expect(fmtQtdTela(12, 'un')).toBe('12 un');
    expect(fmtQtdTela(12, 'unit')).toBe('12 un');
    expect(fmtQtdTela(1.5, 'l')).toBe('1,5 L');
    expect(fmtQtdTela(-2.56, 'kg')).toBe('-2,56 kg');
  });
  it('com sinal', () => {
    expect(fmtQtdSinal(3, 'kg')).toBe('+3 kg');
    expect(fmtQtdSinal(-3, 'kg')).toBe('-3 kg');
    expect(semEspaco(reaisComSinal(12.5))).toBe('+R$ 12,50');
    expect(semEspaco(reaisComSinal(-84))).toBe('-R$ 84,00');
    expect(semEspaco(reaisComSinal(0))).toBe('R$ 0,00');
  });
});

describe('datas da contagem', () => {
  it('dd/mm/aaaa vira aaaa-mm-dd', () => {
    expect(dataBRparaYmd('22/09/2026')).toBe('2026-09-22');
    expect(dataBRparaYmd('2026-09-22')).toBeNull();
  });

  it('dias entre duas datas, sem depender de fuso', () => {
    expect(diasEntre('2026-09-22', '2026-10-04')).toBe(12);
    expect(diasEntre('2026-10-31', '2026-11-01')).toBe(1);
    expect(diasEntre('2026-10-04', '2026-10-04')).toBe(0);
  });

  it('dia curto: "seg 22/09", com o ano só quando não é o de hoje', () => {
    expect(diaCurto('2026-09-22', '2026-10-04')).toBe('ter 22/09'); // 22/09/2026 é terça
    expect(diaCurto('2025-12-31', '2026-10-04')).toBe('qua 31/12/25');
  });

  it('texto de dias sem contar', () => {
    expect(textoDiasSemContar(null)).toBe('Ainda não houve contagem.');
    expect(textoDiasSemContar(0)).toBe('A última contagem foi hoje.');
    expect(textoDiasSemContar(1)).toBe('A última contagem foi ontem.');
    expect(textoDiasSemContar(12)).toBe('12 dias sem contar.');
  });
});

describe('estoque teórico: contagem × hoje', () => {
  const insumos = [
    { id: 'chilli', nome: 'Chilli com Carne', unidade: 'kg', precoUnitario: 28, estoqueAtual: 58, acompanha: true, contaInventario: true },
    { id: 'sour', nome: 'Sour Cream', unidade: 'kg', precoUnitario: 42, estoqueAtual: -2.56, acompanha: true, contaInventario: true },
    { id: 'sal', nome: 'Sal', unidade: 'kg', precoUnitario: 3, estoqueAtual: -1, acompanha: false, contaInventario: true },
    { id: 'garfo', nome: 'Garfo', unidade: 'unit', precoUnitario: 0.5, estoqueAtual: 40, acompanha: true, contaInventario: true },
  ];
  const contado = new Map([['chilli', 69], ['sour', 4]]);
  const mov = new Map([['chilli', { entrou: 64, saiu: 75 }], ['sour', { entrou: 0, saiu: 6.56 }], ['sal', { entrou: 0, saiu: 1 }]]);
  const linhas = montarLinhasTeorico(insumos, contado, mov);

  it('contado, entrou, saiu e hoje por insumo; fora da contagem fica sem contado', () => {
    const chilli = linhas.find((l) => l.id === 'chilli')!;
    expect(chilli.contado).toBe(69);
    expect(chilli.entrou).toBe(64);
    expect(chilli.saiu).toBe(75);
    expect(chilli.hoje).toBe(58);
    // o contado, mais o que entrou, menos o que saiu, é o de hoje
    expect(chilli.contado! + chilli.entrou - chilli.saiu).toBe(chilli.hoje);
    const garfo = linhas.find((l) => l.id === 'garfo')!;
    expect(garfo.contado).toBeNull();
    expect(garfo.entrou).toBe(0);
    expect(garfo.saiu).toBe(0);
  });

  it('conferir só no negativo de insumo que o sistema acompanha e conta', () => {
    expect(linhas.find((l) => l.id === 'sour')!.conferir).toBe(true);
    expect(linhas.find((l) => l.id === 'sal')!.conferir).toBe(false); // aviso desligado
    expect(linhas.find((l) => l.id === 'chilli')!.conferir).toBe(false);
  });

  it('"os que mais mexeram": só quem mexeu, do maior valor movimentado para o menor', () => {
    expect(maisMexeram(linhas).map((l) => l.id)).toEqual(['chilli', 'sour', 'sal']);
  });
});
