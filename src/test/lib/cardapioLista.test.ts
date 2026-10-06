import { describe, it, expect } from 'vitest';
import {
  pausaAteDe, estaPausado, rotuloPausa, lerPreco, ordenarItens, combinaBusca, gruposDesfazer, aplicarMudanca,
  payloadLote, precisaConfirmar, fraseMudanca, disponibilidadeDe, comDisponibilidade, pendenciasCardapio, temPrecoDeliveryProprio,
} from '@/lib/cardapioLista';
import * as edge from '../../../supabase/functions/_shared/cardapio-pausa';
import type { Destaque, Item } from '@/types/cardapio';

const item = (o: Partial<Item> & { id: string }): Item => ({
  categoriaId: 'c1', nome: o.id, descricao: '', preco: 10, fotoUrl: '', slaMinutos: 10, status: 'ativo', ordem: 0,
  gruposOpcoes: [], promocoes: [], observacoesPadrao: [], fichaTecnica: [], ...o,
});

describe('Acabou hoje: pausaAteDe', () => {
  it('à noite volta às 05:00 de Brasília do dia seguinte', () => {
    // 06/10 20:00 Brasília = 23:00 UTC
    expect(pausaAteDe(new Date('2026-10-06T23:00:00Z'))).toBe('2026-10-07T08:00:00.000Z');
  });
  it('de madrugada (antes das 5h) volta às 05:00 do mesmo dia', () => {
    // 07/10 01:30 Brasília = 04:30 UTC
    expect(pausaAteDe(new Date('2026-10-07T04:30:00Z'))).toBe('2026-10-07T08:00:00.000Z');
  });
  it('às 05:00 em ponto já é o dia seguinte', () => {
    expect(pausaAteDe(new Date('2026-10-07T08:00:00Z'))).toBe('2026-10-08T08:00:00.000Z');
  });
  it('vira o mês', () => {
    expect(pausaAteDe(new Date('2026-10-31T22:00:00Z'))).toBe('2026-11-01T08:00:00.000Z');
  });
  it('front e edge dão o mesmo resultado', () => {
    for (const t of ['2026-10-06T23:00:00Z', '2026-10-07T04:30:00Z', '2026-12-31T12:00:00Z', '2026-03-01T07:59:59Z']) {
      expect(edge.pausaAteDe(new Date(t))).toBe(pausaAteDe(new Date(t)));
    }
  });
  it('estaPausado: só enquanto a hora não passou', () => {
    const agora = new Date('2026-10-06T23:00:00Z');
    expect(estaPausado('2026-10-07T08:00:00Z', agora)).toBe(true);
    expect(estaPausado('2026-10-06T22:00:00Z', agora)).toBe(false);
    expect(estaPausado(null, agora)).toBe(false);
    expect(estaPausado('lixo', agora)).toBe(false);
    expect(edge.estaPausado('2026-10-07T08:00:00Z', agora)).toBe(true);
  });
  it('rótulo: amanhã à noite, "até as 05h" de madrugada', () => {
    expect(rotuloPausa('2026-10-07T08:00:00Z', new Date('2026-10-06T23:00:00Z'))).toBe('Pausado até amanhã');
    expect(rotuloPausa('2026-10-07T08:00:00Z', new Date('2026-10-07T04:30:00Z'))).toBe('Pausado até as 05h');
    expect(rotuloPausa(null)).toBe('');
  });
});

describe('preço na linha', () => {
  it('aceita vírgula, ponto e R$', () => {
    expect(lerPreco('32,90')).toEqual({ ok: true, valor: 32.9 });
    expect(lerPreco('32.9')).toEqual({ ok: true, valor: 32.9 });
    expect(lerPreco('R$ 1.234,56')).toEqual({ ok: true, valor: 1234.56 });
    expect(lerPreco(' 15 ')).toEqual({ ok: true, valor: 15 });
  });
  it('recusa zero, vazio, negativo e texto', () => {
    expect(lerPreco('0').ok).toBe(false);
    expect(lerPreco('0,00').ok).toBe(false);
    expect(lerPreco('').ok).toBe(false);
    expect(lerPreco('-5').ok).toBe(false);
    expect(lerPreco('abc').ok).toBe(false);
    expect(lerPreco('12,345').ok).toBe(false);
  });
  it('delivery com preço próprio diferente', () => {
    expect(temPrecoDeliveryProprio(item({ id: 'a', preco: 10, delivery: { ativo: true, preco: 12 } as Item['delivery'] }))).toBe(true);
    expect(temPrecoDeliveryProprio(item({ id: 'a', preco: 10, delivery: { ativo: true, preco: 10 } as Item['delivery'] }))).toBe(false);
    expect(temPrecoDeliveryProprio(item({ id: 'a', preco: 10, delivery: { ativo: false, preco: 12 } as Item['delivery'] }))).toBe(false);
    expect(temPrecoDeliveryProprio(item({ id: 'a', preco: 10 }))).toBe(false);
  });
});

describe('ordem e busca', () => {
  const L = [item({ id: 'a', nome: 'Água', ordem: 2 }), item({ id: 'b', nome: 'Burrito', ordem: 1 }), item({ id: 'c', nome: 'Churros', ordem: 0 })];
  it('mais vendidos primeiro; empate pela ordem do cardápio', () => {
    expect(ordenarItens(L, new Map([['a', 5], ['b', 9]])).map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(ordenarItens(L, new Map([['a', 3], ['b', 3]])).map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });
  it('sem leitura de vendas = ordem do cardápio', () => {
    expect(ordenarItens(L, null).map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });
  it('busca sem acento e por pedaço', () => {
    expect(combinaBusca('agua', 'Água com gás')).toBe(true);
    expect(combinaBusca('com agu', 'Água com gás')).toBe(true);
    expect(combinaBusca('bur', 'Burrito Classic')).toBe(true);
    expect(combinaBusca('nachos', 'Burrito', 'carne', 'Burritos')).toBe(false);
    expect(combinaBusca('   ', 'qualquer')).toBe(true);
    expect(combinaBusca('bebid', 'Coca', '', 'Bebidas')).toBe(true);
  });
});

describe('lote', () => {
  const antes = [
    item({ id: 'a', status: 'ativo' }),
    item({ id: 'b', status: 'inativo' }),
    item({ id: 'c', status: 'ativo', somenteDelivery: true, delivery: { ativo: true } as Item['delivery'] }),
  ];
  it('desfazer só devolve quem mudou, agrupado pelo valor antigo', () => {
    expect(gruposDesfazer(antes, { tipo: 'ativo', valor: false })).toEqual([{ ids: ['a', 'c'], mudanca: { tipo: 'ativo', valor: true } }]);
    const g = gruposDesfazer(antes, { tipo: 'canal', valor: 'casa' });
    expect(g).toEqual([
      { ids: ['a', 'b'], mudanca: { tipo: 'canal', valor: 'ambos' } },
      { ids: ['c'], mudanca: { tipo: 'canal', valor: 'delivery' } },
    ]);
    const agora = new Date('2026-10-06T23:00:00Z');
    const comPausa = [item({ id: 'x', pausadoAte: '2026-10-07T08:00:00Z' }), item({ id: 'y' })];
    expect(gruposDesfazer(comPausa, { tipo: 'pausa', valor: true }, agora)).toEqual([{ ids: ['y'], mudanca: { tipo: 'pausa', valor: false } }]);
  });
  it('aplicarMudanca e payload', () => {
    expect(aplicarMudanca(antes[0], { tipo: 'ativo', valor: false }).status).toBe('inativo');
    expect(aplicarMudanca(antes[0], { tipo: 'categoria', valor: 'c9' }).categoriaId).toBe('c9');
    expect(aplicarMudanca(antes[0], { tipo: 'pausa', valor: true }, 'X').pausadoAte).toBe('X');
    expect(aplicarMudanca({ ...antes[0], pausadoAte: 'X' }, { tipo: 'pausa', valor: false }).pausadoAte).toBeNull();
    expect(disponibilidadeDe(aplicarMudanca(antes[0], { tipo: 'canal', valor: 'delivery' }))).toBe('delivery');
    expect(disponibilidadeDe(comDisponibilidade(antes[2], 'casa'))).toBe('casa');
    expect(payloadLote(['a'], { tipo: 'canal', valor: 'casa' })).toEqual({ item_ids: ['a'], disponibilidade: 'casa' });
    expect(payloadLote(['a'], { tipo: 'pausa', valor: true })).toEqual({ item_ids: ['a'], pausar: true });
  });
  it('pergunta antes de desativar, mudar canal ou categoria; não de ativar/pausar', () => {
    expect(precisaConfirmar({ tipo: 'ativo', valor: false })).toBe(true);
    expect(precisaConfirmar({ tipo: 'ativo', valor: true })).toBe(false);
    expect(precisaConfirmar({ tipo: 'canal', valor: 'ambos' })).toBe(true);
    expect(precisaConfirmar({ tipo: 'categoria', valor: 'c' })).toBe(true);
    expect(precisaConfirmar({ tipo: 'pausa', valor: true })).toBe(false);
  });
  it('frase da barra', () => {
    expect(fraseMudanca({ tipo: 'ativo', valor: false }, ['Burrito'])).toBe('Burrito desativado: saiu do totem, QR, delivery e PDV');
    expect(fraseMudanca({ tipo: 'ativo', valor: false }, ['a', 'b'])).toContain('2 itens desativados');
  });
});

describe('precisa de você', () => {
  const its = [item({ id: 'a', preco: 50 }), item({ id: 'b', preco: 20 }), item({ id: 'c', preco: 30, status: 'inativo' })];
  const dest = (o: Partial<Destaque>): Destaque => ({
    id: 'd', itemId: 'a', itemNome: 'a', itemDescricao: '', itemPreco: 50, itemFotoUrl: '', itemCategoriaId: 'c1',
    itemCategoriaNome: '', ordem: 0, ativo: true, canal: 'ambos', ...o,
  });
  it('mais vendido sem ficha vira cartão; inativo não conta', () => {
    const r = pendenciasCardapio(its, [], { vendas: new Map([['a', 40], ['b', 10], ['c', 99]]), comFicha: new Set(['a']) });
    expect(r).toEqual([{ tipo: 'ficha', item: its[1], vendidos: 10, posicao: 2, outros: 0 }]);
  });
  it('sem leitura de vendas não cobra ficha', () => {
    expect(pendenciasCardapio(its, [], null)).toEqual([]);
  });
  it('destaque a R$ 0,00 e destaque com preço diferente', () => {
    const r = pendenciasCardapio(its, [dest({ customPrice: 0 }), dest({ id: 'e', itemId: 'b', customPrice: 18 }), dest({ id: 'f', itemId: 'b', customPrice: 20 }), dest({ id: 'g', customPrice: null })], null);
    expect(r.map((p) => p.tipo)).toEqual(['destaque_zero', 'destaque_diferente']);
    expect(r[1].tipo === 'destaque_diferente' && r[1].destaques.map((d) => d.destaque.id)).toEqual(['e']);
  });
});
