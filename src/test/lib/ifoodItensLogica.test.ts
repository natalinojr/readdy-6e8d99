import { describe, it, expect } from 'vitest';
import {
  bloqueadoPorComplemento, buscarAlvos, classeMargem, descricaoLigacao, fatorDoPeriodo, fraseItens, listaDoChip, semFichaDe,
  type AlvoCardapio,
} from '@/pages/ifood/lib/itensLogica';
import { itensDosPedidos, type MapaCustos, type PedidoArea } from '@/lib/ifoodArea';
import type { PedidoIfood } from '@/lib/ifoodDashboard';

const mapa = (e: Array<[string, { custo: number | null; alvo: string; tipo: 'item' | 'combo' | 'option' | 'sem_estoque' | 'composicao'; precoBalcao?: number | null }]>): MapaCustos =>
  new Map(e.map(([k, v]) => [k, { custo: v.custo, alvo: v.alvo, tipo: v.tipo, precoBalcao: v.precoBalcao ?? null }]));

function pedido(id: string, itens: Array<{ nome: string; qtd: number; total: number; complementos?: Array<{ nome: string; grupo: string | null; qtd: number; preco: number }> }>, chega: number, custos: MapaCustos): PedidoArea {
  const linhas = itens.map((i) => {
    const base = custos.get(`item|${i.nome.toLowerCase()}`);
    return { nome: i.nome, qtd: i.qtd, total: i.total, comida: base?.custo == null ? null : base.custo * i.qtd, semFicha: base?.custo == null ? [i.nome] : [], balcao: null, alvo: base?.alvo ?? null };
  });
  return {
    id, numero: id, loja: 'L1', at: new Date('2026-10-05T15:00:00Z'), dia: '2026-10-05', cliente: null, cancelado: false, fin: null, venda: 0, comissaoETaxas: null,
    promoLoja: 0, promoLojaEntrega: 0, promoIfood: 0, pedidosAntes: null, chega, estimado: false, linhas, comida: null, sobra: null, sobraBalcao: null, semFicha: [],
    order: { id, rowId: id, numero: id, loja: 'L1', at: new Date('2026-10-05T15:00:00Z'), status: 'concluded', tipo: 'DELIVERY', entregaPor: null, cliente: null, pedidosAntes: null, subTotal: 0, entregaCliente: 0, taxaServico: 0, desconto: 0, promoLoja: 0, promoLojaEntrega: 0, promoIfood: 0, clientePagou: 0, pagamento: null, timeline: {}, motivoCancelamento: null, pedidoErpos: null, teste: false,
      itens: itens.map((i) => ({ nome: i.nome, qtd: i.qtd, total: i.total, obs: null, complementos: i.complementos ?? [] })) },
  };
}

describe('classeMargem', () => {
  it('verde ≥25, âmbar 0–25, vermelho <0, sem ficha, aberto', () => {
    expect(classeMargem({ custoUnit: 5, margem: 30 })).toBe('verde');
    expect(classeMargem({ custoUnit: 5, margem: 25 })).toBe('verde');
    expect(classeMargem({ custoUnit: 5, margem: 10 })).toBe('ambar');
    expect(classeMargem({ custoUnit: 5, margem: 0 })).toBe('ambar');
    expect(classeMargem({ custoUnit: 5, margem: -5 })).toBe('vermelho');
    expect(classeMargem({ custoUnit: null, margem: null })).toBe('sem');
    expect(classeMargem({ custoUnit: 5, margem: null })).toBe('aberto');
  });
});

describe('listas por chip', () => {
  const custos = mapa([
    ['item|burrito', { custo: 10, alvo: 'Burrito', tipo: 'item', precoBalcao: 40 }],
    ['item|combo ruim', { custo: 30, alvo: 'Combo', tipo: 'combo' }],
  ]);
  // Burrito: R$ 40 → chega 28 (fator 0,7) → sobra 18. Combo ruim: R$ 30 → chega 21, custo 30 → prejuízo. Taco: sem ficha.
  const ped = [
    pedido('1', [{ nome: 'Burrito', qtd: 1, total: 40 }], 28, custos),
    pedido('2', [{ nome: 'Combo ruim', qtd: 1, total: 30 }], 21, custos),
    pedido('3', [{ nome: 'Taco', qtd: 2, total: 60 }], 42, custos),
  ];
  const itens = itensDosPedidos(ped, custos);

  it('prejuízo, sem ficha e pior sobra', () => {
    expect(listaDoChip(itens, 'prejuizo', custos).map((i) => i.nome)).toEqual(['Combo ruim']);
    expect(listaDoChip(itens, 'semficha', custos).map((i) => i.nome)).toEqual(['Taco']);
    expect(listaDoChip(itens, 'pior', custos).map((i) => i.nome)).toEqual(['Combo ruim', 'Burrito']);
    expect(listaDoChip(itens, 'vendidos', custos).map((i) => i.nome)).toEqual(['Taco', 'Burrito', 'Combo ruim']);
  });

  it('complementos só com preço aparecem na lista própria', () => {
    const c2 = mapa([['item|burrito', { custo: 10, alvo: 'Burrito', tipo: 'item' }]]);
    const p = [pedido('9', [{ nome: 'Burrito', qtd: 1, total: 46, complementos: [
      { nome: 'Sem cebola', grupo: 'Retirar', qtd: 1, preco: 0 }, { nome: 'Guacamole', grupo: 'Extras', qtd: 1, preco: 6 },
    ] }], 32, c2)];
    expect(listaDoChip(itensDosPedidos(p, c2), 'complementos', c2).map((i) => i.nome)).toEqual(['Guacamole']);
  });

  it('item com ficha própria travado por complemento não entra na fila de ligar', () => {
    const c2 = mapa([['item|burrito', { custo: 10, alvo: 'Burrito', tipo: 'item' }]]);
    const p = [pedido('9', [{ nome: 'Burrito', qtd: 1, total: 46, complementos: [{ nome: 'Guacamole', grupo: 'Extras', qtd: 1, preco: 6 }] }], 32, c2)];
    // o pedido de teste não calcula a comida com complemento: força o item sem custo, como o montarUm faz
    p[0].linhas[0].comida = null;
    const its = itensDosPedidos(p, c2);
    const burrito = its.find((i) => i.nome === 'Burrito')!;
    expect(burrito.custoUnit).toBeNull();
    expect(bloqueadoPorComplemento(burrito, c2)).toBe(true);
    expect(semFichaDe(its, c2).map((i) => i.nome)).toEqual(['Guacamole']);
  });
});

describe('fatorDoPeriodo', () => {
  const f = (o: Partial<PedidoIfood>) => ({ id: 'x', loja: 'L1', vendas: 100, liquido: 70, cancelado: false, ...o }) as PedidoIfood;
  it('soma líquido ÷ vendas dos não cancelados, por loja', () => {
    expect(fatorDoPeriodo([f({}), f({ vendas: 50, liquido: 40 }), f({ cancelado: true, vendas: 999, liquido: 0 })], null)).toBeCloseTo(110 / 150);
    expect(fatorDoPeriodo([f({}), f({ loja: 'L2', liquido: 90 })], 'L2')).toBeCloseTo(0.9);
    expect(fatorDoPeriodo([], null)).toBeNull();
  });
});

describe('fraseItens', () => {
  it('frase do protótipo', () => {
    const r = fraseItens({ de100: { ifood: 35, comida: 34, sobra: 31 }, prejuizo: 2, semFicha: 9, itensVendidos: 612, dinheiro: true });
    expect(r.manchete).toBe('De cada R$ 100 em itens, ficam R$ 31 de lucro bruto');
    expect(r.sub).toBe('Depois do iFood (R$ 35) e da comida (R$ 34). 2 itens dão prejuízo e 9 não têm ficha. A conta ainda está incompleta.');
  });
  it('sem ficha nenhuma e sem acesso ao dinheiro', () => {
    expect(fraseItens({ de100: null, prejuizo: 0, semFicha: 3, itensVendidos: 10, dinheiro: true }).manchete).toBe('Ligue os itens à ficha para ver o lucro bruto');
    expect(fraseItens({ de100: { ifood: 30, comida: 30, sobra: 40 }, prejuizo: 0, semFicha: 0, itensVendidos: 10, dinheiro: false }).manchete).toBe('10 itens vendidos');
    expect(fraseItens({ de100: { ifood: 30, comida: 30, sobra: 40 }, prejuizo: 0, semFicha: 0, itensVendidos: 10, dinheiro: true }).sub).toBe('Depois do iFood (R$ 30) e da comida (R$ 30). Nenhum item dá prejuízo e todos têm ficha.');
  });
});

describe('buscarAlvos', () => {
  const alvos: AlvoCardapio[] = [
    { kind: 'combo', id: 'c1', nome: 'Combo Tex-Mex', detalhe: null },
    { kind: 'item', id: 'i1', nome: 'Taco de Frango', detalhe: null },
    { kind: 'option', id: 'o1', nome: 'Guacamole', detalhe: 'Extras · Burrito' },
    { kind: 'item', id: 'i2', nome: 'Açaí 300ml', detalhe: null },
  ];
  it('produto do iFood: só item e combo; item antes de combo', () => {
    expect(buscarAlvos(alvos, 'item', '').map((a) => a.id)).toEqual(['i2', 'i1', 'c1']);
  });
  it('complemento: opção primeiro; busca sem acento e por palavras', () => {
    expect(buscarAlvos(alvos, 'complemento', '').map((a) => a.id)).toEqual(['o1', 'i2', 'i1', 'c1']);
    expect(buscarAlvos(alvos, 'item', 'acai').map((a) => a.id)).toEqual(['i2']);
    expect(buscarAlvos(alvos, 'item', 'taco frango').map((a) => a.id)).toEqual(['i1']);
    expect(buscarAlvos(alvos, 'complemento', 'extras burrito').map((a) => a.id)).toEqual(['o1']);
  });
});

describe('descricaoLigacao', () => {
  it('diz de onde vem o custo', () => {
    expect(descricaoLigacao({ tipoLigacao: 'item', alvo: 'Burrito X' })).toBe('ficha: Burrito X');
    expect(descricaoLigacao({ tipoLigacao: 'composicao', alvo: 'Custo montado à mão' })).toBe('custo montado à mão');
    expect(descricaoLigacao({ tipoLigacao: 'sem_estoque', alvo: 'Não usa estoque' })).toBe('Não usa estoque');
    expect(descricaoLigacao({ tipoLigacao: null, alvo: null })).toBe('sem ficha');
  });
});
