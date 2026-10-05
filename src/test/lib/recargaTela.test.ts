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

  it("reconhece 'reading default' de arquivo publicado (versão misturada depois do deploy)", () => {
    const erro = new TypeError("Cannot read properties of undefined (reading 'default')");
    erro.stack = "TypeError: Cannot read properties of undefined (reading 'default')\n    at F (https://erpos.vercel.app/assets/react-Bi8cP4Js.js:1:3674)";
    expect(ehErroCarregarTela(erro)).toBe(true);
    const recarregar = vi.fn();
    expect(tentarRecarregarTela(erro, recarregar)).toBe(true);
    expect(tentarRecarregarTela(erro, recarregar)).toBe(false); // trava de 1 min: sem laço
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("'reading default' fora de /assets/ (dev) é bug de verdade: não recarrega", () => {
    const erro = new TypeError("Cannot read properties of undefined (reading 'default')");
    erro.stack = "TypeError: x\n    at F (http://localhost:5173/src/foo.tsx:1:1)";
    expect(ehErroCarregarTela(erro)).toBe(false);
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
