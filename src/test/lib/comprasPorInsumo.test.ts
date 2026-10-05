import { describe, expect, it } from 'vitest';
import { csvCompras, lerCompras, ordenarCompras, totaisCompras } from '@/lib/comprasPorInsumo';

const raw = {
  insumos: [
    { id: 'a', nome: 'Tortilha', unidade: 'unit', categoria: 'Tortilha', qtd: 768, gasto: 2280, n_compras: 2, ultima: '2026-09-22',
      compras: [
        { dia: '2026-09-22', fornecedor: 'Sequoia', nota: '10', qtd: 288, total: 770 },
        { dia: '2026-09-10', fornecedor: 'Costa', nota: null, qtd: 480, total: 1510 },
      ] },
    { id: 'b', nome: 'Açúcar', unidade: 'kg', categoria: null, qtd: 10, gasto: 50, n_compras: 1, ultima: '2026-09-30',
      compras: [{ dia: '2026-09-30', fornecedor: 'Copal', nota: '7', qtd: 10, total: 50 }] },
  ],
  sem_insumo: { itens: 3, valor: 120.5 },
};

describe('comprasPorInsumo', () => {
  it('lê a resposta, calcula preço médio e ordena fornecedores por gasto', () => {
    const r = lerCompras(raw);
    expect(r.insumos[0].precoMedio).toBeCloseTo(2280 / 768, 6);
    expect(r.insumos[0].fornecedores).toEqual(['Costa', 'Sequoia']);
    expect(r.semInsumo).toEqual({ itens: 3, valor: 120.5 });
  });
  it('formato errado é erro, não "nada comprado"', () => {
    expect(() => lerCompras(null)).toThrow();
    expect(() => lerCompras({})).toThrow();
  });
  it('ordena e soma', () => {
    const l = lerCompras(raw).insumos;
    expect(ordenarCompras(l, 'nome').map((i) => i.nome)).toEqual(['Açúcar', 'Tortilha']);
    expect(ordenarCompras(l, 'recente')[0].nome).toBe('Açúcar');
    expect(totaisCompras(l)).toEqual({ insumos: 2, gasto: 2330, compras: 3 });
  });
  it('CSV com uma linha por compra, vírgula decimal e data BR', () => {
    const csv = csvCompras(lerCompras(raw).insumos);
    const linhas = csv.split('\r\n');
    expect(linhas).toHaveLength(4);
    expect(linhas[1]).toContain('"22/09/2026"');
    expect(linhas[1]).toContain('770');
  });
});
