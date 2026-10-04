/**
 * Lista de Insumos (layout novo, 2026-10-04): situação, filtros, pendências de cadastro, valor em estoque
 * e dias sem contar — pela regra única do estoque. Casos da El Patron Paranaguá em 03/10
 * (Arroz −2.046 g, Sour Cream negativo, Óleo com aviso desligado…).
 */
import { describe, it, expect } from 'vitest';
import type { Insumo } from '@/contexts/EstoqueContext';
import {
  situacaoDe, statusEstoque, montarLinha, passaFiltroSituacao, contagensPorFiltro, pendenciasCadastro,
  valorEmEstoque, diasSemContar, textoDura, ordenarLinhas, unidadeDoBanco, semFornecedor,
  type LinhaInsumo,
} from '@/pages/estoque/components/insumos/InsumosUtils';

function insumo(p: Partial<Insumo>): Insumo {
  return {
    id: 'x', nome: 'Insumo', unidade: 'kg', precoUnitario: 10, estoqueMinimo: 0, estoqueAtual: 10, esgotado: false,
    categoria: '', fornecedor: undefined, ultimaEntrada: '—', fichaTecnica: [], purchaseFactor: 1, usageType: 'final',
    rastrearEstoque: true, contaInventario: true, ...p,
  } as Insumo;
}

const linha = (p: Partial<Insumo>, extra: { categoria?: string | null; ehFicha?: boolean } = {}): LinhaInsumo =>
  montarLinha(insumo(p), null, { categoria: extra.categoria ?? null, ehFicha: extra.ehFicha ?? false });

describe('situação de um insumo', () => {
  it('estoque negativo que entra na contagem é Conferir (Arroz −2.046 g)', () => {
    expect(situacaoDe({ acompanha: true, contaInventario: true, minimo: 0, estoque: -2046, marcadoEsgotado: false })).toBe('conferir');
  });

  it('negativo FORA da contagem não é Conferir: é Esgotado', () => {
    expect(situacaoDe({ acompanha: true, contaInventario: false, minimo: 0, estoque: -3, marcadoEsgotado: false })).toBe('esgotado');
  });

  it('sem aviso nunca aparece como Esgotado nem Abaixo do mínimo', () => {
    expect(situacaoDe({ acompanha: false, contaInventario: true, minimo: 14, estoque: 0, marcadoEsgotado: false })).toBe('sem_aviso');
    expect(statusEstoque(insumo({ rastrearEstoque: false, estoqueMinimo: 14, estoqueAtual: 0 })).label).toBe('Sem aviso');
  });

  it('abaixo do mínimo, ok e fora da contagem', () => {
    expect(situacaoDe({ acompanha: true, contaInventario: true, minimo: 5, estoque: 5, marcadoEsgotado: false })).toBe('abaixo');
    expect(situacaoDe({ acompanha: true, contaInventario: true, minimo: 5, estoque: 6, marcadoEsgotado: false })).toBe('ok');
    expect(situacaoDe({ acompanha: true, contaInventario: false, minimo: 5, estoque: 6, marcadoEsgotado: false })).toBe('fora_contagem');
  });

  it('marcado como esgotado com saldo é Conferir; sem saldo é Esgotado', () => {
    expect(situacaoDe({ acompanha: true, contaInventario: true, minimo: 0, estoque: 4, marcadoEsgotado: true })).toBe('conferir');
    expect(situacaoDe({ acompanha: true, contaInventario: true, minimo: 0, estoque: 0, marcadoEsgotado: true })).toBe('esgotado');
  });
});

describe('montarLinha', () => {
  it('usa o uso por dia da regra única para quanto dura', () => {
    const sit = { consumoDia: 0.5, fornecedor: 'COPAL', produzido: false } as never;
    const l = montarLinha(insumo({ estoqueAtual: 10 }), sit, { categoria: 'Frios', ehFicha: false });
    expect(l.dias).toBe(20);
    expect(l.fornecedor).toBe('COPAL');
    expect(textoDura(l.dias)).toBe('20 dias');
  });

  it('estoque zerado ou negativo não tem "dura"', () => {
    const sit = { consumoDia: 1, fornecedor: null, produzido: false } as never;
    expect(montarLinha(insumo({ estoqueAtual: 0 }), sit, { categoria: null, ehFicha: false }).dias).toBeNull();
    expect(montarLinha(insumo({ estoqueAtual: -2 }), sit, { categoria: null, ehFicha: false }).dias).toBeNull();
  });

  it('produto de ficha de produção é produzido mesmo sem a leitura da regra única', () => {
    expect(linha({}, { ehFicha: true }).produzido).toBe(true);
  });

  it('valor: estoque negativo vale zero e converte unidade do front para a do banco', () => {
    expect(linha({ estoqueAtual: -5, precoUnitario: 10 }).valor).toBe(0);
    expect(linha({ estoqueAtual: 3, precoUnitario: 10 }).valor).toBe(30);
    expect(linha({ unidade: 'un' }).unidade).toBe('unit');
    expect(unidadeDoBanco('l')).toBe('L');
    expect(unidadeDoBanco('g')).toBe('g');
  });
});

describe('textoDura', () => {
  it('formata dias', () => {
    expect(textoDura(null)).toBeNull();
    expect(textoDura(0.4)).toBe('menos de 1 dia');
    expect(textoDura(1.2)).toBe('1 dia');
    expect(textoDura(137.4)).toBe('137 dias');
    expect(textoDura(900)).toBe('mais de 1 ano');
  });
});

describe('filtros e contagens batem com a regra única', () => {
  const lista = [
    linha({ id: '1', estoqueAtual: -2.56, estoqueMinimo: 5, fornecedor: undefined }),                  // Sour Cream: conferir + abaixo + esgotado, sem fornecedor
    linha({ id: '2', estoqueAtual: 4, estoqueMinimo: 6, fornecedor: 'Nova Geração' }),                  // abaixo
    linha({ id: '3', estoqueAtual: 0, estoqueMinimo: 0, fornecedor: 'X', contaInventario: false }),     // esgotado, fora da contagem
    linha({ id: '4', estoqueAtual: 50, estoqueMinimo: 2, fornecedor: 'Hortifruti', contaInventario: false }), // fora da contagem (etiqueta)
    linha({ id: '5', estoqueAtual: 12, estoqueMinimo: 5, fornecedor: 'COPAL' }),                        // ok
    linha({ id: '6', estoqueAtual: 0, estoqueMinimo: 14, fornecedor: 'Y', rastrearEstoque: false }),    // sem aviso
  ];

  it('conta cada chip pela mesma regra do filtro', () => {
    const c = contagensPorFiltro(lista);
    expect(c.todos).toBe(6);
    expect(c.abaixo).toBe(2);        // 1 e 2 (o 6 está sem aviso)
    expect(c.esgotado).toBe(2);      // 1 (negativo) e 3 (zero); o 6 está sem aviso
    expect(c.conferir).toBe(1);      // só o 1
    expect(c.sem_fornecedor).toBe(1);
    expect(c.fora_contagem).toBe(2); // 3 e 4
    expect(c.ok).toBe(1);            // só o 5 (o 4 mostra "Fora da contagem")
    for (const f of ['abaixo', 'esgotado', 'conferir', 'sem_fornecedor', 'fora_contagem', 'ok'] as const) {
      expect(lista.filter((l) => passaFiltroSituacao(l, f)).length).toBe(c[f]);
    }
  });

  it('sem fornecedor: só quem acompanha e não é produzido', () => {
    expect(semFornecedor({ acompanha: true, produzido: false, fornecedor: null })).toBe(true);
    expect(semFornecedor({ acompanha: false, produzido: false, fornecedor: null })).toBe(false);
    expect(semFornecedor({ acompanha: true, produzido: true, fornecedor: null })).toBe(false);
    expect(semFornecedor({ acompanha: true, produzido: false, fornecedor: 'Produção interna' })).toBe(false);
  });
});

describe('falta arrumar no cadastro', () => {
  it('soma sem fornecedor, sem mínimo, sem preço e negativos', () => {
    const lista = [
      linha({ id: '1', estoqueAtual: -2, estoqueMinimo: 0, precoUnitario: 0 }),                       // sem fornecedor, sem mínimo, sem preço, negativo
      linha({ id: '2', estoqueAtual: 5, estoqueMinimo: 3, precoUnitario: 4, fornecedor: 'A' }),       // nada
      linha({ id: '3', estoqueAtual: 5, estoqueMinimo: 0, precoUnitario: 4, fornecedor: 'A', rastrearEstoque: false }), // sem aviso: não pede mínimo
    ];
    expect(pendenciasCadastro(lista)).toEqual({ semFornecedor: 1, semMinimo: 1, semPreco: 1, negativos: 1, total: 4 });
  });
});

describe('valor em estoque', () => {
  it('negativo não diminui o total', () => {
    expect(valorEmEstoque([
      { estoque: 10, preco: 5 },
      { estoque: -3, preco: 40 },
      { estoque: 2, preco: 0 },
    ])).toBe(50);
  });
});

describe('dias sem contar', () => {
  it('conta a partir da contagem mais recente, em dias de calendário', () => {
    const sessoes = [{ data: '22/09/2026' }, { data: '29/09/2026' }, { data: '10/09/2026' }];
    expect(diasSemContar(sessoes, '2026-10-04')).toBe(5);
    expect(diasSemContar(sessoes, '2026-09-29')).toBe(0);
  });

  it('sem contagem (ou data ilegível) devolve null; contagem "de amanhã" não fica negativa', () => {
    expect(diasSemContar([], '2026-10-04')).toBeNull();
    expect(diasSemContar([{ data: 'ontem' }], '2026-10-04')).toBeNull();
    expect(diasSemContar([{ data: '05/10/2026' }], '2026-10-04')).toBe(0);
  });
});

describe('ordenar ao clicar no cabeçalho', () => {
  const a = linha({ id: 'a', nome: 'Alho', estoqueAtual: 5, estoqueMinimo: 1 });
  const b = linha({ id: 'b', nome: 'Beterraba', estoqueAtual: -1, estoqueMinimo: 1 });
  const c = linha({ id: 'c', nome: 'Cebola', estoqueAtual: 5, estoqueMinimo: 9 });

  it('por situação: Conferir antes de Abaixo do mínimo antes de Ok', () => {
    expect(ordenarLinhas([a, b, c], 'status', 'asc').map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });

  it('dura: quem não tem uso medido fica sempre no fim', () => {
    const sit = (consumoDia: number) => ({ consumoDia, fornecedor: null, produzido: false }) as never;
    const x = montarLinha(insumo({ id: 'x', nome: 'X', estoqueAtual: 10 }), sit(1), { categoria: null, ehFicha: false });
    const y = montarLinha(insumo({ id: 'y', nome: 'Y', estoqueAtual: 10 }), sit(5), { categoria: null, ehFicha: false });
    const z = linha({ id: 'z', nome: 'Z', estoqueAtual: 10 });
    expect(ordenarLinhas([z, x, y], 'dura', 'asc').map((l) => l.id)).toEqual(['y', 'x', 'z']);
    expect(ordenarLinhas([z, x, y], 'dura', 'desc').map((l) => l.id)).toEqual(['x', 'y', 'z']);
  });

  it('sem chave, mantém a ordem', () => {
    expect(ordenarLinhas([c, a, b], null, 'asc').map((l) => l.id)).toEqual(['c', 'a', 'b']);
  });
});
