import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {}, invokeWithAuth: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useDreGroups', () => ({ useDreGroups: () => ({ groupMeta: () => null }), isGrupoDespesa: () => true }));

import { fatorSugerido, unidadeAoLigar, fatorDaLinha } from '@/pages/financeiro/components/conciliacao/LancarDoExtrato';

const ins = (unit: string, purchase_unit: string | null = null, purchase_factor: number | null = null) =>
  ({ id: 'i1', name: 'Alface', unit, purchase_unit, purchase_factor });

describe('conversão compra → estoque no Lançar do extrato', () => {
  it('mesma unidade = 1; kg→g = 1000; g→kg = 0,001', () => {
    expect(fatorSugerido('g', ins('g'))).toBe('1');
    expect(fatorSugerido('kg', ins('g'))).toBe('1000');
    expect(fatorSugerido('g', ins('kg'))).toBe('0,001');
    expect(fatorSugerido('Litro', ins('ml'))).toBe('1000');
  });
  it('embalagem memorizada no insumo vale quando a unidade bate', () => {
    expect(fatorSugerido('cx', ins('kg', 'cx', 12))).toBe('12');
  });
  it('un → g sem informação: não chuta 1:1', () => {
    expect(fatorSugerido('un', ins('g'))).toBe('');
    expect(fatorDaLinha({ unidade: 'un', insumoId: 'i1', fator: null }, [ins('g')])).toBeNaN();
    expect(fatorDaLinha({ unidade: 'un', insumoId: 'i1', fator: '250' }, [ins('g')])).toBe(250);
  });
  it('ligar o insumo mantém a unidade comprada (não troca "un" por "g")', () => {
    expect(unidadeAoLigar('un', ins('g'))).toBe('un');
    expect(unidadeAoLigar('kg', ins('g'))).toBe('kg');
    expect(unidadeAoLigar('un', ins('kg', 'cx', 12))).toBe('cx');
  });
});
