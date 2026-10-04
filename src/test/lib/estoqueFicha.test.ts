/**
 * src/lib/estoqueFicha.ts — texto das movimentações e datas curtas da Ficha do insumo (2026-10-04).
 */
import { describe, it, expect } from 'vitest';
import { descreverMov, diaMes, qtdComSinal } from '@/lib/estoqueFicha';

describe('diaMes', () => {
  it('data pura vira dd/mm sem mexer em fuso', () => {
    expect(diaMes('2026-09-22')).toBe('22/09');
  });
  it('timestamp usa o dia de Brasília (23h de Brasília ainda é o mesmo dia)', () => {
    expect(diaMes('2026-09-29T01:30:00Z')).toBe('28/09'); // 22:30 do dia 28 em Brasília
  });
  it('vazio ou ilegível dá null', () => {
    expect(diaMes(null)).toBeNull();
    expect(diaMes('')).toBeNull();
    expect(diaMes('ontem')).toBeNull();
  });
});

describe('descreverMov', () => {
  it('venda mostra o prato', () => {
    expect(descreverMov({ tipo: 'theoretical_out', motivo: 'item_sale:abc', prato: 'Burrito Classic' }).texto).toBe('Venda · Burrito Classic');
    expect(descreverMov({ tipo: 'theoretical_out', motivo: 'combo_sale:abc', prato: null }).texto).toBe('Venda');
  });
  it('compra mostra o fornecedor sem o número da nota', () => {
    expect(descreverMov({ tipo: 'in', motivo: 'Compra: COPAL Alimentos - NF 1234', prato: null }).texto).toBe('Compra · COPAL Alimentos');
    expect(descreverMov({ tipo: 'in', motivo: 'Compra: ', prato: null }).texto).toBe('Compra');
  });
  it('entrada manual, saída, perda e contagem', () => {
    expect(descreverMov({ tipo: 'in', motivo: 'Chegou do vizinho', prato: null }).texto).toBe('Entrada · Chegou do vizinho');
    expect(descreverMov({ tipo: 'manual_out', motivo: 'Equipe', prato: null }).texto).toBe('Saída · Equipe');
    expect(descreverMov({ tipo: 'loss', motivo: 'Venceu', prato: null })).toMatchObject({ texto: 'Perda · Venceu', tom: 'red' });
    expect(descreverMov({ tipo: 'inventory_adjustment', motivo: 'Inventário #3', prato: null }).texto).toBe('Contagem');
    expect(descreverMov({ tipo: 'inventory_adjustment', motivo: 'Contagem inicial', prato: null }).texto).toBe('Contagem inicial');
  });
  it('produção e estorno vêm do motivo, antes do tipo', () => {
    expect(descreverMov({ tipo: 'in', motivo: 'Produção: Guacamole', prato: null }).texto).toBe('Produção');
    expect(descreverMov({ tipo: 'manual_out', motivo: 'Produção: Guacamole', prato: null }).texto).toBe('Usado na produção');
    expect(descreverMov({ tipo: 'in', motivo: 'Estorno (produção excluída): Guacamole', prato: null }).texto).toBe('Estorno');
  });
  it('tipo desconhecido não quebra', () => {
    expect(descreverMov({ tipo: 'novo', motivo: null, prato: null }).texto).toBe('Movimento');
  });
});

describe('qtdComSinal', () => {
  it('usa o sinal gravado e a unidade legível', () => {
    expect(qtdComSinal({ tipo: 'theoretical_out', quantidade: 30, sinal: -30 }, 'g')).toEqual({ texto: '−30 g', positivo: false });
    expect(qtdComSinal({ tipo: 'inventory_adjustment', quantidade: 4000, sinal: 4000 }, 'g')).toEqual({ texto: '+4 kg', positivo: true });
  });
  it('ajuste de contagem que tirou aparece com menos (antes aparecia sempre com −)', () => {
    expect(qtdComSinal({ tipo: 'inventory_adjustment', quantidade: 500, sinal: -500 }, 'g').texto).toBe('−500 g');
  });
  it('registro antigo sem sinal: entrada soma, saída tira, ajuste fica sem sinal', () => {
    expect(qtdComSinal({ tipo: 'in', quantidade: 2, sinal: null }, 'kg')).toEqual({ texto: '+2 kg', positivo: true });
    expect(qtdComSinal({ tipo: 'loss', quantidade: 1, sinal: null }, 'unit')).toEqual({ texto: '−1 un', positivo: false });
    expect(qtdComSinal({ tipo: 'inventory_adjustment', quantidade: 3, sinal: null }, 'kg')).toEqual({ texto: '3 kg', positivo: false });
  });
});
