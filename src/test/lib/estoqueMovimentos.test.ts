/**
 * src/lib/estoqueMovimentos.ts — classificação e leitura da aba Estoque › Movimentações (2026-10-04).
 * Casos do que o dono viu: venda gera ~35 linhas por dia, ajuste de contagem some com "−" mesmo quando soma,
 * estorno de produção excluída aparecia como "Entrada".
 */
import { describe, it, expect } from 'vitest';
import {
  TIPOS_DB, ehEstorno, ehPerdaReal, passaNoTipo, sinalDaQuantidade, getMotivoDisplay, diasEntre, tituloDoDia,
} from '@/lib/estoqueMovimentos';
import type { Movimentacao } from '@/types/estoque';

function mov(p: Partial<Movimentacao>): Movimentacao {
  return { id: 'm', insumoId: 'i', insumoNome: 'Insumo', tipo: 'entrada', quantidade: 1, unidade: 'kg', operador: 'Thati', data: '04/10/2026', hora: '10:00', ...p };
}

describe('estorno e perda', () => {
  it('estorno é pelo começo do motivo, sem importar maiúscula', () => {
    expect(ehEstorno(mov({ motivo: 'Estorno (produção excluída): Guacamole' }))).toBe(true);
    expect(ehEstorno(mov({ motivo: 'estorno pedido #1a2b3c4d:abc' }))).toBe(true);
    expect(ehEstorno(mov({ motivo: 'Compra: COPAL - NF 2281' }))).toBe(false);
    expect(ehEstorno(mov({}))).toBe(false);
  });
  it('perda em produção (sinal 0) não é perda de verdade; sem o dado do banco conta como perda', () => {
    expect(ehPerdaReal(mov({ tipo: 'perda', sinal: -1 }))).toBe(true);
    expect(ehPerdaReal(mov({ tipo: 'perda', sinal: 0 }))).toBe(false);
    expect(ehPerdaReal(mov({ tipo: 'perda' }))).toBe(true);
    expect(ehPerdaReal(mov({ tipo: 'saida_manual', sinal: -1 }))).toBe(false);
  });
});

describe('filtro de tipo', () => {
  const venda = mov({ tipo: 'saida_venda', sinal: -1 });
  const compra = mov({ tipo: 'entrada', sinal: 1, motivo: 'Compra: COPAL - NF 1' });
  const estornoProd = mov({ tipo: 'entrada', sinal: 1, motivo: 'Estorno (produção excluída): Guacamole' });
  const saida = mov({ tipo: 'saida_manual', sinal: -1, motivo: 'Refeição da equipe' });
  const perda = mov({ tipo: 'perda', sinal: -1 });
  const perdaProd = mov({ tipo: 'perda', sinal: 0, motivo: 'Perda em produção: Guacamole' });
  const prodEntrada = mov({ tipo: 'entrada_producao', sinal: 1 });
  const ajuste = mov({ tipo: 'ajuste_inventario', sinal: 1 });

  it('"Tudo menos vendas" tira só a venda', () => {
    const todos = [venda, compra, estornoProd, saida, perda, perdaProd, prodEntrada, ajuste];
    expect(todos.filter((m) => passaNoTipo(m, 'menos_vendas'))).toEqual([compra, estornoProd, saida, perda, perdaProd, prodEntrada, ajuste]);
    expect(todos.filter((m) => passaNoTipo(m, 'vendas'))).toEqual([venda]);
  });
  it('estorno não conta como entrada nem saída (bate com o número da faixa)', () => {
    expect(passaNoTipo(compra, 'entradas')).toBe(true);
    expect(passaNoTipo(estornoProd, 'entradas')).toBe(false);
    expect(passaNoTipo(estornoProd, 'producao')).toBe(true);
    expect(passaNoTipo(mov({ tipo: 'saida_manual', motivo: 'Estorno (produção excluída): X' }), 'saidas')).toBe(false);
    expect(passaNoTipo(saida, 'saidas')).toBe(true);
  });
  it('perda em produção vai para Produção, não para Perdas', () => {
    expect(passaNoTipo(perda, 'perdas')).toBe(true);
    expect(passaNoTipo(perdaProd, 'perdas')).toBe(false);
    expect(passaNoTipo(perdaProd, 'producao')).toBe(true);
    expect(passaNoTipo(prodEntrada, 'producao')).toBe(true);
  });
  it('contagem', () => {
    expect(passaNoTipo(ajuste, 'contagem')).toBe(true);
    expect(passaNoTipo(compra, 'contagem')).toBe(false);
  });
  it('o que vai ao banco cobre o que o filtro fino precisa e nunca pede venda fora de Vendas', () => {
    expect(TIPOS_DB.menos_vendas).not.toContain('theoretical_out');
    expect(TIPOS_DB.vendas).toEqual(['theoretical_out']);
    expect(TIPOS_DB.contagem).toEqual(['inventory_adjustment']);
    expect(TIPOS_DB.producao).toEqual(expect.arrayContaining(['in', 'manual_out', 'loss']));
  });
});

describe('sinal da quantidade', () => {
  it('com o dado do banco é exato: ajuste de contagem soma ou tira', () => {
    expect(sinalDaQuantidade(mov({ tipo: 'ajuste_inventario', sinal: 1 }))).toBe('+');
    expect(sinalDaQuantidade(mov({ tipo: 'ajuste_inventario', sinal: -1 }))).toBe('−');
    expect(sinalDaQuantidade(mov({ tipo: 'perda', sinal: 0 }))).toBe('');
  });
  it('sem o dado, deduz pelo tipo e no ajuste de contagem não chuta', () => {
    expect(sinalDaQuantidade(mov({ tipo: 'entrada' }))).toBe('+');
    expect(sinalDaQuantidade(mov({ tipo: 'entrada_producao' }))).toBe('+');
    expect(sinalDaQuantidade(mov({ tipo: 'saida_venda' }))).toBe('−');
    expect(sinalDaQuantidade(mov({ tipo: 'perda' }))).toBe('−');
    expect(sinalDaQuantidade(mov({ tipo: 'ajuste_inventario' }))).toBe('±');
  });
});

describe('motivo legível', () => {
  it('venda: nome do prato; sem ele, nunca o código item_sale:uuid', () => {
    expect(getMotivoDisplay(mov({ tipo: 'saida_venda', itemVendidoNome: 'Burrito Classic', motivo: 'item_sale:123' })).label).toBe('Burrito Classic');
    expect(getMotivoDisplay(mov({ tipo: 'saida_venda', motivo: 'item_sale:2c0f6f0c-0000-4000-8000-000000000000' })).label).toBe('Baixa automática por venda');
    expect(getMotivoDisplay(mov({ tipo: 'saida_venda', motivo: 'combo_sale:abc' })).label).toBe('Baixa automática por venda');
    expect(getMotivoDisplay(mov({ tipo: 'saida_venda', motivo: '' })).label).toBe('Baixa automática por venda');
  });
  it('estorno de pedido perde o id interno do fim; compra fica como está', () => {
    expect(getMotivoDisplay(mov({ motivo: 'Estorno pedido #1a2b3c4d:2c0f6f0c-1111-4222-8333-444455556666' })).label).toBe('Estorno pedido #1a2b3c4d');
    expect(getMotivoDisplay(mov({ motivo: 'Estorno (produção excluída): Guacamole' })).label).toBe('Estorno (produção excluída): Guacamole');
    expect(getMotivoDisplay(mov({ motivo: 'Compra: COPAL - NF 2281' })).label).toBe('Compra: COPAL - NF 2281');
    expect(getMotivoDisplay(mov({})).label).toBe('—');
  });
  it('produção', () => {
    const e = getMotivoDisplay(mov({ tipo: 'entrada_producao', motivo: 'Produção: Cheddar produzido' }));
    expect(e.label).toBe('Cheddar produzido');
    expect(e.sub).toBe('Entrada (produção)');
    expect(getMotivoDisplay(mov({ tipo: 'perda', motivo: 'Perda em produção: Guacamole' })).sub).toBe('Perda em produção');
  });
});

describe('datas', () => {
  it('diasEntre conta os dois extremos', () => {
    expect(diasEntre('2026-10-04', '2026-10-04')).toBe(1);
    expect(diasEntre('2026-09-05', '2026-10-04')).toBe(30);
    expect(diasEntre('2026-09-28', '2026-10-04')).toBe(7);
  });
  it('título do dia: Hoje, Ontem e os outros', () => {
    expect(tituloDoDia('2026-10-04', '2026-10-04')).toBe('Hoje · domingo 04/10');
    expect(tituloDoDia('2026-10-03', '2026-10-04')).toBe('Ontem · sábado 03/10');
    expect(tituloDoDia('2026-10-01', '2026-10-04')).toBe('quinta-feira 01/10');
    // virada de mês: ontem do dia 1º é o último do mês anterior
    expect(tituloDoDia('2026-09-30', '2026-10-01')).toBe('Ontem · quarta-feira 30/09');
  });
});
