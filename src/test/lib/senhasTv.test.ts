import { describe, it, expect } from 'vitest';
import {
  numeroPorExtenso, senhaPorExtenso, fraseChamada, novasProntas, lerRespostaPainel, corTextoSobre, layoutPreparando, caminhoTvSenhas,
} from '@/lib/senhasTv';

describe('numeroPorExtenso', () => {
  it.each([
    [0, 'zero'], [7, 'sete'], [13, 'treze'], [20, 'vinte'], [21, 'vinte e um'], [100, 'cem'], [101, 'cento e um'],
    [313, 'trezentos e treze'], [300, 'trezentos'], [999, 'novecentos e noventa e nove'], [1000, 'mil'],
    [1001, 'mil e um'], [1100, 'mil e cem'], [1234, 'mil duzentos e trinta e quatro'], [2000, 'dois mil'],
    [12000, 'doze mil'],
  ])('%i → %s', (n, esperado) => {
    expect(numeroPorExtenso(n)).toBe(esperado);
  });
  it('fora do alcance devolve os dígitos', () => {
    expect(numeroPorExtenso(1000000)).toBe('1000000');
    expect(numeroPorExtenso(-1)).toBe('-1');
  });
});

describe('senhaPorExtenso / fraseChamada', () => {
  it('senha numérica', () => {
    expect(fraseChamada('313')).toBe('Senha trezentos e treze');
    expect(fraseChamada('007')).toBe('Senha sete');
  });
  it('senha de tablet com letra', () => {
    expect(senhaPorExtenso('P-14')).toBe('P catorze');
    expect(senhaPorExtenso('p-14')).toBe('P catorze');
  });
  it('texto fora do formato é lido como está', () => {
    expect(senhaPorExtenso('abc')).toBe('abc');
  });
});

describe('novasProntas', () => {
  it('só as que não estavam na leitura anterior, na ordem atual', () => {
    expect(novasProntas(new Set(['309']), ['313', '309', '311'])).toEqual(['313', '311']);
    expect(novasProntas(new Set(), [])).toEqual([]);
    expect(novasProntas(new Set(['1']), ['1'])).toEqual([]);
  });
});

describe('lerRespostaPainel', () => {
  const base = { status: 'ok', tenant_id: 't1', loja: { nome: 'El Patron', cor: '#C2410C', logo: '' } };
  it('lê números e tira senha repetida ou fora do formato (nunca nome)', () => {
    const r = lerRespostaPainel({
      ...base,
      preparando: [{ senha: '310' }, { senha: '312' }, { senha: 'Maria Silva' }, { senha: '313' }],
      prontas: [{ senha: '313', desde: '2026-10-05T19:40:00Z' }, { senha: '313' }, { senha: 'P-14' }, { senha: 'João' }],
    });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.painel.prontas.map((p) => p.senha)).toEqual(['313', 'P-14']);
    // 313 está pronta: sai de "preparando"
    expect(r.painel.preparando).toEqual(['310', '312']);
    expect(r.painel.loja.logo).toBeNull();
  });
  it('desligado, inválido e lixo', () => {
    expect(lerRespostaPainel({ status: 'desligado', loja: { nome: 'X' } })).toEqual({ status: 'desligado', lojaNome: 'X' });
    expect(lerRespostaPainel({ status: 'invalido' })).toEqual({ status: 'invalido' });
    expect(lerRespostaPainel(null)).toEqual({ status: 'erro' });
    expect(lerRespostaPainel({ status: 'ok' })).toEqual({ status: 'erro' });
  });
});

describe('corTextoSobre', () => {
  it('escuro sobre cor clara, branco sobre cor escura, branco se inválida', () => {
    expect(corTextoSobre('#FFD400')).toBe('#1F1A14');
    expect(corTextoSobre('#C2410C')).toBe('#FFFFFF');
    expect(corTextoSobre(null)).toBe('#FFFFFF');
    expect(corTextoSobre('vermelho')).toBe('#FFFFFF');
  });
});

describe('layout e link', () => {
  it('muda para 3 colunas acima de 8 senhas', () => {
    expect(layoutPreparando(8).colunas).toBe(2);
    expect(layoutPreparando(9)).toMatchObject({ colunas: 3, max: 15 });
  });
  it('caminho público', () => {
    expect(caminhoTvSenhas('abc')).toBe('/senhas/abc');
  });
});
