import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ehErroCarregarTela, tentarRecarregarTela } from '@/lib/recargaTela';

describe('recarga automática quando o arquivo da tela não baixa', () => {
  beforeEach(() => sessionStorage.clear());

  it('reconhece o erro do Chrome, do Safari e do Firefox', () => {
    expect(ehErroCarregarTela(new TypeError('Failed to fetch dynamically imported module: https://erpos.vercel.app/assets/page-BxSh6AHm.js'))).toBe(true);
    expect(ehErroCarregarTela(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(ehErroCarregarTela(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(ehErroCarregarTela(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('recarrega 1x e não entra em laço dentro de 1 minuto', () => {
    const recarregar = vi.fn();
    const erro = new TypeError('Failed to fetch dynamically imported module: x.js');
    expect(tentarRecarregarTela(erro, recarregar)).toBe(true);
    expect(tentarRecarregarTela(erro, recarregar)).toBe(false);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it('erro comum de tela não recarrega', () => {
    const recarregar = vi.fn();
    expect(tentarRecarregarTela(new Error('x is undefined'), recarregar)).toBe(false);
    expect(recarregar).not.toHaveBeenCalled();
  });
});
