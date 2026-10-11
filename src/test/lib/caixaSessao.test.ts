import { describe, it, expect } from 'vitest';
import { caixasDaSessao, resumoCaixasDaSessao } from '@/lib/caixaSessao';
import type { CashRegisterInfo } from '@/hooks/useCaixaReport';

const caixa = (p: Partial<CashRegisterInfo>): CashRegisterInfo => ({
  id: 'c', opening_value: 0, closing_value_expected: null, closing_value_actual: null, closing_difference: null,
  closing_notes: null, opened_at: '2026-08-28T20:00:00Z', closed_at: null, status: 'closed', ...p,
});

describe('resumoCaixasDaSessao', () => {
  it('soma a diferença de TODOS os caixas (dois caixas: −39,80 e +39,25 = −0,55)', () => {
    const r = resumoCaixasDaSessao({
      opening_amount: 100,
      cash_register: caixa({ id: 'b', closing_difference: 39.25 }),
      cash_registers: [caixa({ id: 'a', closing_difference: -39.8 }), caixa({ id: 'b', closing_difference: 39.25 })],
    });
    expect(r.diferenca).toBe(-0.55);
  });

  it('1º caixa com sobra e o último conferido: a sessão não é "Conferido"', () => {
    const r = resumoCaixasDaSessao({
      opening_amount: 0,
      cash_register: caixa({ id: 'b', closing_difference: 0 }),
      cash_registers: [caixa({ id: 'a', closing_difference: 65.8 }), caixa({ id: 'b', closing_difference: 0 })],
    });
    expect(r.diferenca).toBe(65.8);
  });

  it('soma fundo, esperado e contado de todos os caixas e pega o último fechamento', () => {
    const r = resumoCaixasDaSessao({
      opening_amount: 0,
      cash_register: null,
      cash_registers: [
        caixa({ id: 'a', opening_value: 100, closing_value_expected: 350.1, closing_value_actual: 350, closed_at: '2026-08-29T01:00:00Z' }),
        caixa({ id: 'b', opening_value: 150, closing_value_expected: 420.2, closing_value_actual: 420, closed_at: '2026-08-29T05:30:00Z' }),
      ],
    });
    expect(r.fundoInicial).toBe(250);
    expect(r.valorEsperado).toBe(770.3);
    expect(r.valorContado).toBe(770);
    expect(r.ultimoFechamento).toBe('2026-08-29T05:30:00Z');
  });

  it('caixa aberto (sem fechamento) não entra na diferença: null, não zero', () => {
    const r = resumoCaixasDaSessao({
      opening_amount: 0,
      cash_register: caixa({ status: 'open', opening_value: 80 }),
      cash_registers: [caixa({ status: 'open', opening_value: 80 })],
    });
    expect(r.diferenca).toBeNull();
    expect(r.valorEsperado).toBeNull();
    expect(r.ultimoFechamento).toBeNull();
    expect(r.fundoInicial).toBe(80);
  });

  it('sem o array da RPC cai no cash_register único; sem caixa nenhum usa a abertura da sessão', () => {
    const unico = caixa({ id: 'u', opening_value: 50, closing_difference: -2 });
    expect(caixasDaSessao({ cash_registers: [], cash_register: unico })).toEqual([unico]);
    expect(resumoCaixasDaSessao({ cash_registers: [], cash_register: unico, opening_amount: 0 }).diferenca).toBe(-2);

    const vazio = resumoCaixasDaSessao({ cash_registers: [], cash_register: null, opening_amount: 120 });
    expect(vazio.caixas).toEqual([]);
    expect(vazio.fundoInicial).toBe(120);
    expect(vazio.diferenca).toBeNull();
  });

  it('junta as justificativas preenchidas', () => {
    const r = resumoCaixasDaSessao({
      opening_amount: 0,
      cash_register: null,
      cash_registers: [caixa({ closing_notes: ' troco errado ' }), caixa({ closing_notes: null }), caixa({ closing_notes: '' })],
    });
    expect(r.notas).toEqual(['troco errado']);
  });
});
