import { describe, it, expect } from 'vitest';
import { empresaTemPdv, fontesPadrao } from '../../lib/tipoEmpresa';

describe('tipo da empresa', () => {
  it('só a empresa financeira não tem PDV', () => {
    expect(empresaTemPdv('financeiro')).toBe(false);
    expect(empresaTemPdv('loja')).toBe(true);
  });

  it('na dúvida, assume que tem PDV (nenhuma loja perde tela por dado faltando)', () => {
    expect(empresaTemPdv(undefined)).toBe(true);
    expect(empresaTemPdv(null)).toBe(true);
    expect(empresaTemPdv('')).toBe(true);
    expect(empresaTemPdv('coisa_nova')).toBe(true);
  });

  it('empresa financeira não nasce contando pedidos', () => {
    expect(fontesPadrao('financeiro')).toEqual(['manual']);
    expect(fontesPadrao('loja')).toEqual(['orders', 'manual']);
    expect(fontesPadrao(undefined)).toEqual(['orders', 'manual']);
  });
});
