/**
 * src/lib/vazamentos.ts — o que entra (e o que NÃO entra) na soma dos Vazamentos do mês.
 * Números inspirados na El Patron Paranaguá (set/2026) e na Vila Leste (sem ficha, Pix não pago).
 */
import { describe, it, expect } from 'vitest';
import { janelaDoMes, lerLoja, linhaDe, manchete, resumirVazamentos, type VazLojaDados } from '@/lib/vazamentos';

const vazio = { total: 0, n: 0, itens: [] };
const loja = (o: Partial<VazLojaDados> = {}): VazLojaDados => ({
  tenant_id: 't1', nome: 'Paranaguá', de: '2026-10-01', ate: '2026-10-05', mes_anterior: { de: '2026-09-01', ate: '2026-09-30' },
  juros: vazio, insumos: vazio, perdas: vazio, pix: vazio,
  pratos: { total: 0, n: 0, itens: [], meta: 35, ficha_suspeita: [], pratos_com_ficha: 10, pratos_sem_ficha: 5 },
  caixa: { fechamentos: 0, com_diferenca: 0, itens: [] }, vencidas: { n: 0, valor: 0 },
  ...o,
});

describe('janelaDoMes', () => {
  it('mês atual vai do dia 1 até hoje', () => {
    expect(janelaDoMes('2026-10-05', 'atual')).toEqual({ de: '2026-10-01', ate: '2026-10-05', mes: '2026-10' });
  });
  it('mês passado é inteiro, inclusive na virada de ano', () => {
    expect(janelaDoMes('2026-10-05', 'anterior')).toEqual({ de: '2026-09-01', ate: '2026-09-30', mes: '2026-09' });
    expect(janelaDoMes('2027-01-03', 'anterior')).toEqual({ de: '2026-12-01', ate: '2026-12-31', mes: '2026-12' });
    expect(janelaDoMes('2026-03-10', 'anterior').ate).toBe('2026-02-28');
  });
});

describe('resumirVazamentos', () => {
  it('soma juros, insumos e perdas, da maior para a menor; pratos e Pix têm linha mas ficam fora da soma', () => {
    const l = loja({
      juros: { total: 282.29, n: 13, itens: [] },
      insumos: { total: 100, n: 4, itens: [] },
      pratos: { total: 52.46, n: 1, itens: [{ nome: 'Coca-cola zero 600 ml', qtd: 16, receita: 192, custo: 119.66, cmv_pct: 62.3, a_mais: 52.46 }], meta: 35, ficha_suspeita: [], pratos_com_ficha: 41, pratos_sem_ficha: 43 },
      perdas: { total: 63, n: 4, itens: [] },
      pix: { total: 155.8, n: 3, itens: [] },
    });
    const r = resumirVazamentos([l]);
    expect(r.linhas.map((x) => x.tipo)).toEqual(['juros', 'insumos', 'perdas']);
    expect(r.total).toBeCloseTo(282.29 + 100 + 63, 2);
    expect(r.pratos.map((x) => x.valor)).toEqual([52.46]);
    expect(r.pixConferir.map((x) => x.valor)).toEqual([155.8]);
  });

  it('Pix do delivery não pago é "a conferir": nunca entra na soma', () => {
    const r = resumirVazamentos([loja({ pix: { total: 155.8, n: 3, itens: [] } })]);
    expect(r.total).toBe(0);
    expect(r.linhas).toEqual([]);
    expect(r.pixConferir[0].titulo).toBe('Pix do delivery: 3 pedidos não pagos (o cliente pode ter pedido de novo)');
    expect(manchete(r.total, 'atual', '2026-10', false).valor).toBeNull();
  });

  it('sem sobreposição: a alta do insumo não é contada de novo no prato acima da meta', () => {
    // Tomate subiu R$ 301 no mês e o prato com tomate passou da meta em R$ 120 — boa parte desses R$ 120 É a alta do
    // tomate (o custo da ficha usa o preço atual). A manchete fica só com os R$ 301.
    const r = resumirVazamentos([loja({
      insumos: { total: 301.17, n: 1, itens: [] },
      pratos: { total: 120, n: 1, itens: [{ nome: 'Bruschetta', qtd: 40, receita: 600, custo: 330, cmv_pct: 55, a_mais: 120 }], meta: 35, ficha_suspeita: [], pratos_com_ficha: 1, pratos_sem_ficha: 0 },
    })]);
    expect(r.total).toBe(301.17);
    expect(r.linhas.map((x) => x.tipo)).toEqual(['insumos']);
    expect(r.pratos).toHaveLength(1);
    expect(r.pratos[0].fonte).toContain('não soma');
  });

  it('diferença de caixa, conta vencida e ficha suspeita ficam FORA da soma', () => {
    const l = loja({
      juros: { total: 10, n: 1, itens: [] },
      caixa: { fechamentos: 18, com_diferenca: 14, itens: [] },
      vencidas: { n: 4, valor: 2450.34 },
      pratos: { total: 0, n: 0, itens: [], meta: 35, ficha_suspeita: [{ nome: 'Nachos 4 Quesos', qtd: 3, receita: 114, custo: 365.94, cmv_pct: 321 }], pratos_com_ficha: 41, pratos_sem_ficha: 3 },
    });
    const r = resumirVazamentos([l]);
    expect(r.total).toBe(10);
    expect(r.conferir).toEqual([{ tenantId: 't1', loja: 'Paranaguá', fechamentos: 18, comDiferenca: 14 }]);
    expect(r.risco).toEqual([{ tenantId: 't1', loja: 'Paranaguá', n: 4, valor: 2450.34 }]);
    expect(r.fichaSuspeita).toHaveLength(1);
  });

  it('linha sem dado não aparece; sem nada medido o total é zero', () => {
    const r = resumirVazamentos([loja()]);
    expect(r.linhas).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.conferir).toEqual([]);
  });

  it('loja sem nenhum prato com ficha avisa que não dá para medir custo do prato (regra, não nome de loja)', () => {
    const vila = loja({
      tenant_id: 't2', nome: 'Vila Leste',
      pix: { total: 155.8, n: 3, itens: [] }, vencidas: { n: 6, valor: 1597.1 },
      pratos: { total: 0, n: 0, itens: [], meta: 35, ficha_suspeita: [], pratos_com_ficha: 0, pratos_sem_ficha: 33 },
    });
    const r = resumirVazamentos([vila]);
    expect(r.semFicha).toEqual([{ tenantId: 't2', loja: 'Vila Leste' }]);
    expect(r.linhas).toEqual([]);
    expect(r.pixConferir.map((x) => x.loja)).toEqual(['Vila Leste']);
    expect(r.risco[0].valor).toBe(1597.1);
  });

  it('somando as lojas, cada linha continua dizendo de qual loja vem', () => {
    const a = loja({ juros: { total: 100, n: 2, itens: [] } });
    const b = loja({ tenant_id: 't2', nome: 'Vila Leste', perdas: { total: 50, n: 1, itens: [] } });
    const r = resumirVazamentos([a, b]);
    expect(r.linhas.map((x) => `${x.loja}:${x.tipo}`)).toEqual(['Paranaguá:juros', 'Vila Leste:perdas']);
    expect(r.total).toBe(150);
  });
});

describe('textos das linhas', () => {
  it('um prato só vira frase com o nome e o CMV; vários, contagem', () => {
    const um = loja({ pratos: { total: 52.46, n: 1, itens: [{ nome: 'Coca-cola zero 600 ml', qtd: 16, receita: 192, custo: 119.66, cmv_pct: 62.3, a_mais: 52.46 }], meta: 35, ficha_suspeita: [], pratos_com_ficha: 5, pratos_sem_ficha: 0 } });
    expect(linhaDe('pratos', um, 'setembro')?.titulo).toBe('Coca-cola zero 600 ml vende com CMV 62% (meta 35%)');
    const varios = loja({ pratos: { total: 80, n: 7, itens: [], meta: 35, ficha_suspeita: [], pratos_com_ficha: 9, pratos_sem_ficha: 0 } });
    expect(linhaDe('pratos', varios, 'setembro')?.titulo).toBe('7 pratos vendidos com CMV acima de 35%');
  });
  it('plural de contas e insumos, com o mês anterior no texto', () => {
    expect(linhaDe('juros', loja({ juros: { total: 5, n: 1, itens: [] } }), 'setembro')?.titulo).toBe('Juros e multa em 1 conta paga atrasada');
    expect(linhaDe('insumos', loja({ insumos: { total: 5, n: 12, itens: [] } }), 'setembro')?.titulo).toBe('12 insumos mais caros que em setembro');
  });
  it('valor zero não vira linha, mesmo com itens', () => {
    expect(linhaDe('perdas', loja({ perdas: { total: 0, n: 2, itens: [] } }), 'setembro')).toBeNull();
  });
});

describe('manchete', () => {
  it('com valor: mês até agora; sem valor: diz que nada foi medido (nunca "R$ 0 que dava para evitar")', () => {
    expect(manchete(735, 'atual', '2026-10', false)).toEqual({ antes: 'Outubro até agora: ', valor: expect.stringContaining('735'), depois: ' que dava para evitar' });
    expect(manchete(0, 'atual', '2026-10', false)).toEqual({ antes: 'Outubro até agora: nenhum vazamento medido', valor: null, depois: '' });
    expect(manchete(10, 'anterior', '2026-09', true).antes).toBe('Somando as lojas, setembro: ');
  });
});

describe('lerLoja', () => {
  it('resposta fora do formato é erro, nunca "sem vazamento"', () => {
    expect(() => lerLoja(null)).toThrow();
    expect(() => lerLoja({ tenant_id: 'x' })).toThrow();
  });
  it('converte números que chegam como texto e completa o que faltar', () => {
    const r = lerLoja({
      tenant_id: 'x', nome: 'Loja', de: '2026-10-01', ate: '2026-10-05',
      juros: { total: '12.5', n: '2', itens: [] }, insumos: vazio, perdas: vazio, pix: vazio,
      pratos: { total: 0, n: 0, itens: [] }, caixa: { fechamentos: 3, com_diferenca: 1 },
    });
    expect(r.juros.total).toBe(12.5);
    expect(r.pratos.meta).toBe(35);
    expect(r.caixa.itens).toEqual([]);
    expect(r.vencidas).toEqual({ n: 0, valor: 0 });
  });
});
