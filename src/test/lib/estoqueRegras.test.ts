/**
 * src/lib/estoqueRegras.ts — a regra única do estoque (2026-10-03).
 * Casos tirados da El Patron Paranaguá em 03/10 (Arroz −2.046 g, Coca pet zerada, Chilli com Soja…).
 */
import { describe, it, expect } from 'vitest';
import {
  abaixoDoMinimo, estaEsgotado, vaiFaltarEm, precisaConferir, ehProduzido, sugestaoCompra,
  agruparCompras, pedidoDoInsumo, situacaoPlano, ocorrenciaAtual, proximaOcorrencia, descreverFrequencia, quandoFica,
  fmtQtd, fmtPrecoUnit, fmtSugestao, CHAVE_PRODUZIR, CHAVE_SEM_FORNECEDOR,
  type InsumoSituacao, type PlanoContagem,
} from '@/lib/estoqueRegras';

function insumo(p: Partial<InsumoSituacao>): InsumoSituacao {
  const base: InsumoSituacao = {
    id: 'x', nome: 'Insumo', unidade: 'kg', categoria: null, fornecedorId: null, fornecedor: null, fornecedorFone: null,
    produzido: false, estoque: 10, minimo: 0, marcadoEsgotado: false, acompanha: true, contaInventario: true,
    unidadeContagem: null, fatorContagem: null, preco: 0, unidadeCompra: null, fatorCompra: 1, consumoDia: null,
    diasRestantes: null, ultimaContagem: null, ultimaEntrada: null, abaixoMinimo: false, esgotado: false, vaiFaltar: false, naLista: false,
  };
  return { ...base, ...p };
}

describe('regras', () => {
  it('abaixo do mínimo: só com mínimo definido e aviso ligado', () => {
    expect(abaixoDoMinimo({ acompanha: true, minimo: 5, estoque: 5 })).toBe(true);
    expect(abaixoDoMinimo({ acompanha: true, minimo: 5, estoque: 5.01 })).toBe(false);
    expect(abaixoDoMinimo({ acompanha: true, minimo: 0, estoque: -2046 })).toBe(false); // Arroz: sem mínimo
    expect(abaixoDoMinimo({ acompanha: false, minimo: 14, estoque: 14 })).toBe(false); // Óleo: aviso desligado
  });

  it('esgotado: zero, negativo ou marcado — e só com aviso ligado', () => {
    expect(estaEsgotado({ acompanha: true, minimo: 0, estoque: 0 })).toBe(true);
    expect(estaEsgotado({ acompanha: true, minimo: 0, estoque: -0.24 })).toBe(true);
    expect(estaEsgotado({ acompanha: true, minimo: 0, estoque: 3, marcadoEsgotado: true })).toBe(true);
    expect(estaEsgotado({ acompanha: false, minimo: 5, estoque: -2.065 })).toBe(false); // Sour Cream
  });

  it('vai faltar: pelo uso, só fora da lista (acima do mínimo)', () => {
    const cheddar = { acompanha: true, minimo: 500, estoque: 681, consumoDia: 98.24 };
    expect(vaiFaltarEm(cheddar, 7)).toBe(true);           // 6,9 dias
    expect(vaiFaltarEm(cheddar, 6)).toBe(false);
    expect(vaiFaltarEm({ ...cheddar, estoque: 400 }, 7)).toBe(false); // já está abaixo do mínimo → é "comprar"
    expect(vaiFaltarEm({ acompanha: true, minimo: 0, estoque: -2046, consumoDia: 448.5 }, 7)).toBe(true); // Arroz
    expect(vaiFaltarEm({ ...cheddar, consumoDia: null }, 7)).toBe(false);
  });

  it('conferir: negativo ou marcado esgotado com saldo, só quem entra na contagem', () => {
    expect(precisaConferir(insumo({ estoque: -21.7 }))).toBe(true);
    expect(precisaConferir(insumo({ estoque: 4, marcadoEsgotado: true }))).toBe(true);
    expect(precisaConferir(insumo({ estoque: -203, contaInventario: false }))).toBe(false); // Coentro fora da contagem
    expect(precisaConferir(insumo({ estoque: 0, marcadoEsgotado: true }))).toBe(false);
    // Formato do insumo da tela (regraDoInsumo): o mesmo "Para conferir" do Início no painel do Estoque
    expect(precisaConferir({ acompanha: true, contaInventario: true, estoque: -1, marcadoEsgotado: false })).toBe(true);
    expect(precisaConferir({ acompanha: false, contaInventario: true, estoque: -1, marcadoEsgotado: false })).toBe(false);
  });

  it('produzido: ficha de produção ou fornecedor "Produção interna"', () => {
    expect(ehProduzido({ produzido: true, fornecedor: null })).toBe(true);
    expect(ehProduzido({ produzido: false, fornecedor: 'Producao interna' })).toBe(true);
    expect(ehProduzido({ produzido: false, fornecedor: 'COPAL ALIMENTOS' })).toBe(false);
  });
});

describe('quanto pedir', () => {
  it('uso de 60 dias, arredondado na embalagem', () => {
    // Chilli com Carne: 0,881 kg/dia × 60 = 52,9 kg → CX de 16 kg → 4 CX (64 kg)
    const s = sugestaoCompra(insumo({ estoque: 9, minimo: 10, consumoDia: 0.881, unidadeCompra: 'CX', fatorCompra: 16 }), 60);
    expect(s).toEqual({ qtd: 64, embalagens: 4, unidadeCompra: 'CX' });
  });

  it('sem uso registrado: fica com 2× o mínimo', () => {
    // Coca pet 200 ml: zerada, mínimo 12, CX de 12 → 2 CX
    const s = sugestaoCompra(insumo({ unidade: 'unit', estoque: 0, minimo: 12, unidadeCompra: 'CX', fatorCompra: 12 }), 60);
    expect(s.embalagens).toBe(2);
    expect(fmtSugestao(s, 'unit')).toBe('2 CX (24 un)');
  });

  it('negativo conta como zero; passo amigável sem embalagem', () => {
    const s = sugestaoCompra(insumo({ unidade: 'g', estoque: -56, minimo: 340, consumoDia: null }), 60);
    expect(s).toEqual({ qtd: 680, embalagens: null, unidadeCompra: null });
  });

  it('produzido na cozinha: até 2× o mínimo, nunca 2 meses de uso', () => {
    const s = sugestaoCompra(insumo({ produzido: true, estoque: -2.9, minimo: 1, consumoDia: 0.31 }), 60);
    expect(s.qtd).toBe(2);
  });

  it('dias configuráveis mudam a quantidade', () => {
    const i = insumo({ estoque: 3, minimo: 5, consumoDia: 0.2 });
    expect(sugestaoCompra(i, 60).qtd).toBe(12);
    expect(sugestaoCompra(i, 30).qtd).toBe(7); // 6 < 2×5−3 = 7
  });
});

describe('lista por fornecedor', () => {
  it('produzir e sem fornecedor ficam por último; zerado primeiro', () => {
    const g = agruparCompras([
      insumo({ id: 'a', nome: 'Sal', estoque: 0, esgotado: true }),
      insumo({ id: 'b', nome: 'Guacamole', produzido: true }),
      insumo({ id: 'c', nome: 'Coca pet', fornecedorId: 'f1', fornecedor: 'BEBIDAS', fornecedorFone: '4130713100', esgotado: true }),
      insumo({ id: 'd', nome: 'Cebola', fornecedor: 'COMPRE HORTIFRUTI', diasRestantes: 3 }),
      insumo({ id: 'e', nome: 'Coentro', fornecedor: 'compre hortifruti ', esgotado: true }),
    ]);
    expect(g.map((x) => x.nome)).toEqual(['BEBIDAS', 'COMPRE HORTIFRUTI', 'Produzir na cozinha', 'Sem fornecedor']);
    expect(g[0].fone).toBe('4130713100');
    expect(g[1].itens.map((i) => i.nome)).toEqual(['Coentro', 'Cebola']);
    expect(g[2].chave).toBe(CHAVE_PRODUZIR);
    expect(g[3].chave).toBe(CHAVE_SEM_FORNECEDOR);
  });
});

describe('pedido mandado', () => {
  const ped = { id: 'p', fornecedor: 'f1', fornecedorNome: 'X', itens: [{ id: 'a', nome: 'A', texto: '1 CX' }], enviadoEm: '2026-10-01T13:00:00.000Z', enviadoPorNome: null };
  it('vale só para o insumo que estava no pedido e ainda não chegou', () => {
    expect(pedidoDoInsumo(insumo({ id: 'a', fornecedorId: 'f1' }), [ped])).toBe(ped);
    expect(pedidoDoInsumo(insumo({ id: 'c', fornecedorId: 'f1' }), [ped])).toBeNull(); // novo no mesmo fornecedor
    expect(pedidoDoInsumo(insumo({ id: 'a', fornecedorId: 'f1', ultimaEntrada: '2026-10-02T10:00:00.000Z' }), [ped])).toBeNull(); // chegou e baixou de novo
    expect(pedidoDoInsumo(insumo({ id: 'a', fornecedorId: 'f2' }), [ped])).toBeNull();
  });
});

describe('planos de contagem', () => {
  const semanal: PlanoContagem = { id: 'p1', nome: 'Semanal', frequencia: 'semanal', diaSemana: 1, diaMes: null, todos: false, itens: ['a', 'b'], criadoEm: '2026-09-01T12:00:00Z' };
  const mensal: PlanoContagem = { id: 'p2', nome: 'Geral', frequencia: 'mensal', diaSemana: null, diaMes: 1, todos: true, itens: [], criadoEm: '2026-09-01T12:00:00Z' };

  it('ocorrência atual e próxima (sábado 03/10/2026)', () => {
    expect(ocorrenciaAtual(semanal, '2026-10-03')).toBe('2026-09-28'); // segunda passada
    expect(proximaOcorrencia(semanal, '2026-10-03')).toBe('2026-10-05');
    expect(ocorrenciaAtual(mensal, '2026-10-03')).toBe('2026-10-01');
    expect(proximaOcorrencia(mensal, '2026-10-03')).toBe('2026-11-01');
    expect(ocorrenciaAtual({ ...mensal, diaMes: 0 }, '2026-10-03')).toBe('2026-09-30'); // último dia
    expect(ocorrenciaAtual({ ...mensal, diaMes: 15, criadoEm: '2025-01-01T12:00:00Z' }, '2026-01-10')).toBe('2025-12-15');
  });

  it('plano criado depois do último dia agendado só vale a partir do próximo', () => {
    expect(ocorrenciaAtual({ ...semanal, criadoEm: '2026-10-03T13:00:00Z' }, '2026-10-03')).toBeNull();
  });

  it('pendentes = itens sem contagem desde a ocorrência; "todos" = quem entra na contagem', () => {
    const ins = [
      insumo({ id: 'a', ultimaContagem: '2026-09-29T15:00:00Z' }),
      insumo({ id: 'b', ultimaContagem: '2026-09-22T23:22:00Z' }),
      insumo({ id: 'c', contaInventario: false }),
    ];
    const s = situacaoPlano(semanal, ins, '2026-10-03');
    expect(s.pendentes.map((i) => i.id)).toEqual(['b']);
    expect(s.atraso).toBe(5);
    const g = situacaoPlano(mensal, ins, '2026-10-03');
    expect(g.pendentes.map((i) => i.id)).toEqual(['a', 'b']); // c fora da contagem
    const lista = situacaoPlano({ ...semanal, itens: ['b', 'c'] }, ins, '2026-10-03');
    expect(lista.pendentes.map((i) => i.id)).toEqual(['b']); // c saiu da contagem: sai do plano
  });

  it('contagem às 22h de Brasília conta no dia certo', () => {
    // 01/10 01:30 UTC = 30/09 22:30 em Brasília → NÃO vale para a ocorrência de 01/10
    const s = situacaoPlano(mensal, [insumo({ id: 'a', ultimaContagem: '2026-10-01T01:30:00Z' })], '2026-10-03');
    expect(s.pendentes).toHaveLength(1);
  });

  it('textos', () => {
    expect(descreverFrequencia(semanal)).toBe('Toda segunda');
    expect(descreverFrequencia({ frequencia: 'semanal', diaSemana: 6, diaMes: null })).toBe('Todo sábado');
    expect(descreverFrequencia({ frequencia: 'mensal', diaSemana: null, diaMes: 0 })).toBe('Último dia do mês');
    expect(quandoFica('2026-10-05', '2026-10-03')).toBe('segunda, 05/10');
    expect(quandoFica('2026-10-04', '2026-10-03')).toBe('amanhã');
  });
});

describe('formatação', () => {
  it('grama vira kg e preço por grama sai por kg', () => {
    expect(fmtQtd(-2046, 'g')).toBe('-2,05 kg');
    expect(fmtQtd(24, 'unit')).toBe('24 un');
    expect(fmtPrecoUnit(0.0044, 'g')).toMatch(/4,40\/kg$/);
    expect(fmtPrecoUnit(0, 'kg')).toBe('sem preço');
  });
});
