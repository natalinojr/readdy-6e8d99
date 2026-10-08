// "Parece o mesmo que…" (2026-10-08): caso real do Milho Verde da Paranaguá (Condor, sem CNPJ e sem código).
import { describe, it, expect } from 'vitest';
import { itemParecido, tamanho, palavras } from '@/lib/vinculoParecido';

const it_ = (id: string, description: string, o: Partial<{ supplier_key: string; ingredient_id: string | null; last_seen_at: string }> = {}) => ({
  id, description, supplier_key: 'n:condor super center ltda', ingredient_id: 'milho', units_per_package: 170, last_seen_at: '2026-09-19', ...o,
});

describe('tamanho e palavras', () => {
  it('lê g, kg, ml e litro', () => {
    expect(tamanho('MILHO VERDE BONARE 170G SACHE')).toEqual({ v: 170, u: 'g' });
    expect(tamanho('OLEO 1,5L')).toEqual({ v: 1500, u: 'ml' });
    expect(tamanho('QUEIJO 2 KG')).toEqual({ v: 2000, u: 'g' });
    expect(tamanho('LEITE INTEGRAL')).toBeNull();
  });
  it('tira número, unidade e embalagem', () => {
    expect([...palavras('MILHO VERDE BONARE 170G SACHE')].sort()).toEqual(['BONARE', 'MILHO', 'VERDE']);
  });
});

describe('itemParecido', () => {
  const novo = it_('novo', 'MILHO VERDE PREDILECTA 170G LA', { ingredient_id: null, last_seen_at: '2026-10-08' });
  const bonare = it_('bonare', 'MILHO VERDE BONARE 170G SACHE', { last_seen_at: '2026-09-19' });
  const pred8 = it_('pred8', 'MILHO VERDE PREDILECTA 170G LA 8UN X 2,99 TI9', { last_seen_at: '2026-09-23' });
  const errado = it_('17g', 'MILHO VERDE PREADICTA 17 G LA', { last_seen_at: '2026-09-25' });

  it('acha o mais parecido do mesmo fornecedor, com o mesmo tamanho', () => {
    expect(itemParecido(novo, [novo, bonare, pred8, errado])?.id).toBe('pred8');
    expect(itemParecido(novo, [novo, bonare, errado])?.id).toBe('bonare');
  });
  it('não sugere de outro fornecedor, sem vínculo, com 1 palavra só ou tamanho diferente', () => {
    expect(itemParecido(novo, [it_('x', 'MILHO VERDE 170G', { supplier_key: 'outro' })])).toBeNull();
    expect(itemParecido(novo, [it_('y', 'MILHO VERDE 170G', { ingredient_id: null })])).toBeNull();
    expect(itemParecido(novo, [it_('z', 'MILHO PIPOCA 170G')])).toBeNull();
    expect(itemParecido(novo, [errado])).toBeNull();
  });
  it('item já ligado não recebe sugestão', () => {
    expect(itemParecido(bonare, [pred8])).toBeNull();
  });
});
