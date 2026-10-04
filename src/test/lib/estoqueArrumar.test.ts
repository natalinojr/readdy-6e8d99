/**
 * src/lib/estoqueArrumar.ts — fila do "Arrumar a lista" do Estoque (2026-10-04).
 * Casos da El Patron Paranaguá: Sour Cream −2,56 kg sem fornecedor, Garfo zerado sem mínimo, produzido na cozinha…
 */
import { describe, it, expect } from 'vitest';
import {
  contarFornecedores, fornecedoresSugeridos, lerNumero, montarFila, precoNaUnidadeDoEstoque, umaSemanaDeUso, unidadeDoPreco,
} from '@/lib/estoqueArrumar';
import type { InsumoSituacao, SituacaoEstoque } from '@/lib/estoqueRegras';

function insumo(p: Partial<InsumoSituacao>): InsumoSituacao {
  const base: InsumoSituacao = {
    id: 'x', nome: 'Insumo', unidade: 'kg', categoria: null, fornecedorId: 'f0', fornecedor: 'Fornecedor Zero', fornecedorFone: null,
    produzido: false, estoque: 10, minimo: 5, marcadoEsgotado: false, acompanha: true, contaInventario: true,
    unidadeContagem: null, fatorContagem: null, preco: 1, unidadeCompra: null, fatorCompra: 1, consumoDia: null,
    diasRestantes: null, ultimaContagem: null, ultimaEntrada: null, abaixoMinimo: false, esgotado: false, vaiFaltar: false, naLista: false,
  };
  return { ...base, ...p };
}
const situacao = (insumos: InsumoSituacao[]): SituacaoEstoque => ({
  hoje: '2026-10-04', config: { diasCompra: 60, diasPrevisao: 7, podeConfigurar: true }, janelaDias: 30, insumos,
  planos: [], pedidos: [], totais: { abaixoMinimo: 0, esgotados: 0, zeradosAbaixo: 0, vaiFaltar: 0, naLista: 0 },
});

describe('lerNumero', () => {
  it('aceita vírgula e ponto', () => {
    expect(lerNumero('1,5')).toEqual({ vazio: false, valor: 1.5 });
    expect(lerNumero(' 42.14 ')).toEqual({ vazio: false, valor: 42.14 });
  });
  it('ponto de milhar como se escreve no Brasil', () => {
    expect(lerNumero('1.500')).toEqual({ vazio: false, valor: 1500 });
    expect(lerNumero('1.500,5')).toEqual({ vazio: false, valor: 1500.5 });
  });
  it('vazio não é erro; texto que não é número é', () => {
    expect(lerNumero('  ')).toEqual({ vazio: true, valor: null });
    expect(lerNumero('abc')).toEqual({ vazio: false, valor: null });
  });
});

describe('uma semana de uso (sugestão de mínimo)', () => {
  it('kg e L arredondam de 0,5 em 0,5, nunca abaixo de um passo', () => {
    expect(umaSemanaDeUso({ unidade: 'kg', consumoDia: 0.23 })).toBe(1.5); // 1,61 → 1,5
    expect(umaSemanaDeUso({ unidade: 'L', consumoDia: 0.01 })).toBe(0.5);
  });
  it('g e ml arredondam de 100 em 100', () => {
    expect(umaSemanaDeUso({ unidade: 'g', consumoDia: 26 })).toBe(200); // 182 → 200
    expect(umaSemanaDeUso({ unidade: 'ml', consumoDia: 3 })).toBe(100);
  });
  it('unidade inteira de 1 em 1', () => {
    expect(umaSemanaDeUso({ unidade: 'unit', consumoDia: 0.4 })).toBe(3); // 2,8 → 3
  });
  it('sem histórico de uso não sugere', () => {
    expect(umaSemanaDeUso({ unidade: 'kg', consumoDia: null })).toBeNull();
    expect(umaSemanaDeUso({ unidade: 'kg', consumoDia: 0 })).toBeNull();
  });
});

describe('preço: kg/L na tela, unidade do estoque no banco', () => {
  it('g e ml pedem por kg e L', () => {
    expect(unidadeDoPreco('g')).toEqual({ rotulo: 'kg', divisor: 1000 });
    expect(unidadeDoPreco('ml')).toEqual({ rotulo: 'L', divisor: 1000 });
    expect(unidadeDoPreco('kg')).toEqual({ rotulo: 'kg', divisor: 1 });
    expect(unidadeDoPreco('L')).toEqual({ rotulo: 'L', divisor: 1 });
    expect(unidadeDoPreco('unit')).toEqual({ rotulo: 'un', divisor: 1 });
  });
  it('R$ 42,14/kg num insumo em g grava R$ 0,04214 por g', () => {
    expect(precoNaUnidadeDoEstoque(42.14, 'g')).toBeCloseTo(0.04214, 8);
    expect(precoNaUnidadeDoEstoque(4.31, 'unit')).toBe(4.31);
    expect(precoNaUnidadeDoEstoque(8, 'ml')).toBeCloseTo(0.008, 8);
  });
});

describe('fila do Arrumar a lista', () => {
  const lista = [
    insumo({ id: 'sour', nome: 'Sour Cream', categoria: 'Industria', fornecedorId: null, fornecedor: null, estoque: -2.56, minimo: 5 }),
    insumo({ id: 'garfo', nome: 'Garfo', categoria: 'Descartável', fornecedorId: null, fornecedor: null, estoque: 0, minimo: 0, preco: 0, esgotado: true }),
    insumo({ id: 'guaca', nome: 'Guacamole', categoria: 'Industria', produzido: true, fornecedorId: null, fornecedor: 'Produção interna', minimo: 0, preco: 28 }),
    insumo({ id: 'ok', nome: 'Tortilha', categoria: 'Industria', fornecedorId: 'f1', fornecedor: 'Sequoia' }),
    insumo({ id: 'sem-aviso', nome: 'Óleo', acompanha: false, fornecedorId: null, fornecedor: null, minimo: 0, preco: 0 }),
  ];

  it('pergunta só o que falta e ignora insumo sem aviso', () => {
    const { fila } = montarFila(situacao(lista), undefined, undefined, true);
    const porId = Object.fromEntries(fila.map((f) => [f.ins.id, f.perguntas]));
    expect(porId.sour).toEqual(['fornecedor', 'negativo']);
    expect(porId.garfo).toEqual(['fornecedor', 'minimo', 'preco']);
    expect(porId.guaca).toEqual(['minimo']); // produzido na cozinha não tem "quem vende"
    expect(porId.ok).toBeUndefined();
    expect(porId['sem-aviso']).toBeUndefined();
  });

  it('número impossível vem primeiro, depois o que já está baixo', () => {
    const { fila } = montarFila(situacao(lista), undefined, undefined, true);
    expect(fila.map((f) => f.ins.id)).toEqual(['sour', 'garfo', 'guaca']);
  });

  it('filtro deixa uma pergunta só e tira quem não tem aquela falta', () => {
    const { fila } = montarFila(situacao(lista), 'fornecedor', undefined, true);
    expect(fila.map((f) => [f.ins.id, f.perguntas])).toEqual([['sour', ['fornecedor']], ['garfo', ['fornecedor']]]);
  });

  it('insumoId restringe a um insumo', () => {
    const { fila } = montarFila(situacao(lista), undefined, 'garfo', true);
    expect(fila).toHaveLength(1);
    expect(fila[0].ins.id).toBe('garfo');
  });

  it('quem não pode contar não recebe a pergunta de contagem', () => {
    const { fila } = montarFila(situacao(lista), undefined, 'sour', false);
    expect(fila[0].perguntas).toEqual(['fornecedor']);
    expect(montarFila(situacao(lista), 'negativo', undefined, false).fila).toHaveLength(0);
  });

  it('marcado esgotado com saldo também pede contagem', () => {
    const { fila } = montarFila(situacao([insumo({ id: 'm', marcadoEsgotado: true, estoque: 3 })]), 'negativo', undefined, true);
    expect(fila.map((f) => f.ins.id)).toEqual(['m']);
  });
});

describe('sugestão de fornecedor', () => {
  const lista = [
    insumo({ id: '1', categoria: 'Bebidas', fornecedorId: 'nova', fornecedor: 'Bebidas Nova Geração' }),
    insumo({ id: '2', categoria: 'Bebidas', fornecedorId: 'nova', fornecedor: 'Bebidas Nova Geração' }),
    insumo({ id: '3', categoria: 'Bebidas', fornecedorId: 'copal', fornecedor: 'COPAL' }),
    insumo({ id: '4', categoria: 'Frios', fornecedorId: 'copal', fornecedor: 'COPAL' }),
    insumo({ id: '5', categoria: 'Frios', fornecedorId: 'copal', fornecedor: 'COPAL' }),
    insumo({ id: '6', categoria: 'Frios', fornecedorId: 'condor', fornecedor: 'Condor' }),
    insumo({ id: '7', categoria: 'Industria', produzido: true, fornecedorId: 'fab', fornecedor: 'El Patron Cozinha' }),
  ];

  it('conta fornecedores do mais usado ao menos usado e ignora produzido na cozinha', () => {
    expect(contarFornecedores(lista).map((f) => [f.id, f.n])).toEqual([['copal', 3], ['nova', 2], ['condor', 1]]);
  });

  it('o primeiro chip é o mais comum da categoria, depois os mais usados da loja', () => {
    const { sug } = montarFila(situacao(lista), undefined, undefined, true);
    const r = fornecedoresSugeridos({ categoria: 'Bebidas' }, sug);
    expect(r.sugerido?.id).toBe('nova');
    expect(r.chips.map((c) => c.id)).toEqual(['nova', 'copal', 'condor']);
  });

  it('sem categoria conhecida, os 3 mais usados da loja', () => {
    const { sug } = montarFila(situacao(lista), undefined, undefined, true);
    const r = fornecedoresSugeridos({ categoria: null }, sug);
    expect(r.sugerido).toBeNull();
    expect(r.chips.map((c) => c.id)).toEqual(['copal', 'nova', 'condor']);
  });
});
