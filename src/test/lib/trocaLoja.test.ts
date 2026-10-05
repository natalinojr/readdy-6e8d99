// Folha "Em qual loja você vai trabalhar agora?" (casca nova, 2026-10-05): montagem e ordem dos cartões.
import { describe, it, expect } from 'vitest';
import { ehLojaDeTeste, linhaVendas, montarCartoesLoja, ordenarCartoes, type LeituraLoja, type LojaDaPessoa } from '@/lib/trocaLoja';

const loja = (tenantId: string, nome: string, role = 'admin', extra: Partial<LojaDaPessoa> = {}): LojaDaPessoa =>
  ({ tenantId, nome, role, trainingMode: false, kind: 'loja', ...extra });
const leitura = (extra: Partial<LeituraLoja> = {}): LeituraLoja =>
  ({ aberta: false, desde: null, faturamento: 0, pedidos: 0, oculta: false, ...extra });
const rotulo = (r: string) => ({ admin: 'Administrador', gerente: 'Supervisor', supervisao: 'Líder', caixa: 'Operador de Caixa' }[r] ?? r);

describe('trocar de loja — cartões', () => {
  const lojas = [
    loja('a', 'Vila Leste & El Patron'),
    loja('b', 'El Patron Paranaguá', 'gerente'),
    loja('c', 'Testes PDV', 'caixa'),
    loja('d', 'TBA Ipanema'),
  ];

  it('quem mais precisa de você vem primeiro; empate → aberta; depois vendas e nome', () => {
    const { visiveis } = montarCartoesLoja({
      lojas,
      leituras: new Map([
        ['a', leitura({ aberta: false })],
        ['b', leitura({ aberta: true, desde: '11:02', faturamento: 1340, pedidos: 32 })],
        ['d', leitura({ aberta: true, faturamento: 50, pedidos: 2 })],
      ]),
      precisam: new Map([['a', 4], ['b', 4], ['c', 1]]),
      atualId: 'b',
      rotuloCargo: rotulo,
    });
    expect(visiveis.map((c) => c.tenantId)).toEqual(['b', 'a', 'c', 'd']);
    const b = visiveis[0];
    expect(b).toMatchObject({ aqui: true, aberta: true, desde: '11:02', cargo: 'Supervisor', precisam: 4 });
    expect(visiveis[1].aqui).toBe(false);
  });

  it('sem leitura da loja (não vê o Dashboard): sem aberta/R$, mas com cargo; a atual usa a sessão', () => {
    const { visiveis } = montarCartoesLoja({
      lojas: [loja('c', 'Testes PDV', 'caixa'), loja('x', 'Outra', 'caixa')],
      leituras: new Map(),
      precisam: new Map(),
      atualId: 'c',
      rotuloCargo: rotulo,
      estadoAtual: { aberta: true, desde: '18:30' },
    });
    const c = visiveis.find((v) => v.tenantId === 'c')!;
    const x = visiveis.find((v) => v.tenantId === 'x')!;
    expect(c).toMatchObject({ aberta: true, desde: '18:30', faturamento: null, cargo: 'Operador de Caixa', teste: true });
    expect(x).toMatchObject({ aberta: null, faturamento: null, pedidos: null, teste: false });
    expect(visiveis[0].tenantId).toBe('c'); // aberta vem antes
  });

  it('escondidas pela pessoa ficam recolhidas, menos a loja em que ela está', () => {
    const { visiveis, escondidas } = montarCartoesLoja({
      lojas,
      leituras: new Map([
        ['a', leitura({ oculta: true })],
        ['b', leitura({ oculta: true })],
        ['d', leitura({ oculta: true, aberta: true })],
      ]),
      precisam: new Map(),
      atualId: 'b',
      rotuloCargo: rotulo,
    });
    expect(visiveis.map((c) => c.tenantId)).toEqual(['b', 'c']);
    expect(escondidas.map((c) => c.tenantId)).toEqual(['d', 'a']);
  });

  it('loja repetida na lista aparece uma vez; precisam negativo vira 0', () => {
    const { visiveis } = montarCartoesLoja({
      lojas: [loja('a', 'A'), loja('a', 'A')],
      leituras: new Map(),
      precisam: new Map([['a', -2]]),
      atualId: null,
      rotuloCargo: rotulo,
    });
    expect(visiveis).toHaveLength(1);
    expect(visiveis[0].precisam).toBe(0);
  });

  it('empresa sem PDV e modo treino viram etiquetas', () => {
    const { visiveis } = montarCartoesLoja({
      lojas: [loja('f', 'Financeiro A', 'admin', { kind: 'financeiro' }), loja('t', 'Loja Real', 'caixa', { trainingMode: true })],
      leituras: new Map(), precisam: new Map(), atualId: null, rotuloCargo: rotulo,
    });
    expect(visiveis.find((c) => c.tenantId === 'f')).toMatchObject({ semPdv: true, teste: false });
    expect(visiveis.find((c) => c.tenantId === 't')).toMatchObject({ teste: true, treino: true });
  });

  it('ordenarCartoes não mexe na lista recebida', () => {
    const lista = [{ precisam: 0, aberta: null, faturamento: null, nome: 'B' }, { precisam: 0, aberta: null, faturamento: null, nome: 'A' }];
    const ord = ordenarCartoes(lista);
    expect(ord.map((c) => c.nome)).toEqual(['A', 'B']);
    expect(lista.map((c) => c.nome)).toEqual(['B', 'A']);
  });
});

describe('trocar de loja — textos', () => {
  it('loja de teste pelo nome ou pelo modo treino', () => {
    expect(ehLojaDeTeste('Testes PDV', false)).toBe(true);
    expect(ehLojaDeTeste('Loja Demo', false)).toBe(true);
    expect(ehLojaDeTeste('Homologação', false)).toBe(true);
    expect(ehLojaDeTeste('El Patron Paranaguá', false)).toBe(false);
    expect(ehLojaDeTeste('Contestado Burger', false)).toBe(false);
    expect(ehLojaDeTeste('El Patron Paranaguá', true)).toBe(true);
  });

  it('R$ e pedidos só com a loja aberta ou com venda no dia', () => {
    expect(linhaVendas({ aberta: true, faturamento: 1340, pedidos: 32 })).toMatch(/1\.340 hoje · 32 pedidos$/);
    expect(linhaVendas({ aberta: true, faturamento: 0, pedidos: 0 })).toMatch(/0 hoje · 0 pedidos$/);
    expect(linhaVendas({ aberta: false, faturamento: 80, pedidos: 1 })).toMatch(/80 hoje · 1 pedido$/);
    expect(linhaVendas({ aberta: false, faturamento: 0, pedidos: 0 })).toBeNull();
    expect(linhaVendas({ aberta: null, faturamento: null, pedidos: null })).toBeNull();
  });
});
