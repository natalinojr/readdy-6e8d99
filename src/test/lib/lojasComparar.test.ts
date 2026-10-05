import { describe, it, expect } from 'vitest';
import { diasEntre, metaDoPeriodo, montarLoja, ordenarPorFaturamento, totalLojas, rotuloComparacao, type LinhaLojasRpc } from '../../lib/lojasComparar';

const base = (over: Partial<LinhaLojasRpc> = {}): LinhaLojasRpc => ({
  tenant_id: 't1', nome: 'Loja', dia: '2026-10-04',
  periodo: { d1: '2026-10-04', d2: '2026-10-04', c1: '2026-09-27', c2: '2026-09-27', corte: '2026-09-27T23:04:00-03:00' },
  atual: { faturamento: 2402.3, pedidos: 49, canais: { self_service: { valor: 2402.3, pedidos: 49 } }, serie: { 12: 323, 19: 179 } },
  anterior: { faturamento: 1757.4, pedidos: 45, serie: { 12: 241.4 } },
  agora: { caixa: null, dia_inicio: null, em_aberto: { pedidos: 0, valor: 0 }, mesas_ocupadas: 0, mesas_total: 1, atrasados: 0 },
  janelas_atual: [{ dia: '2026-10-04', ini: '2026-10-04T12:08:00-03:00', fim: '2026-10-04T19:52:00-03:00' }],
  janelas_anterior: [],
  metas: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, faturamento: 2333 })),
  primeiro_dia: '2026-04-01', vendeu_30d: true, tem_ifood: true, sincroniza_ifood: true, oculta: false,
  ...over,
});

describe('montarLoja', () => {
  it('soma o iFood do dia da loja ao PDV e compara com a semana passada até a mesma hora', () => {
    const l = montarLoja(base(),
      [{ at: '2026-10-04T19:30:00-03:00', valor: 100 }, { at: '2026-10-04T20:30:00-03:00', valor: 77 }],
      [{ at: '2026-09-27T19:00:00-03:00', valor: 194 }, { at: '2026-09-27T23:30:00-03:00', valor: 50 }]);
    expect(l.atual.faturamento).toBe(2579.3);
    expect(l.atual.pedidos).toBe(51);
    expect(l.atual.canais.ifood).toEqual({ valor: 177, pedidos: 2 });
    expect(l.atual.serie['19']).toBe(279);
    expect(l.atual.serie['20']).toBe(77);
    expect(l.anterior.faturamento).toBe(1951.4); // o de 23h30 fica depois do corte
    expect(l.variacao).toBeCloseTo((2579.3 - 1951.4) / 1951.4 * 100, 5);
    expect(l.meta).toBe(2333);
    expect(l.ifoodCarregando).toBe(false);
  });

  it('enquanto o iFood não chega, mostra o PDV e marca carregando', () => {
    const l = montarLoja(base(), null, null);
    expect(l.atual.faturamento).toBe(2402.3);
    expect(l.ifoodCarregando).toBe(true);
  });

  it('sem base quando a loja começou depois do início do período anterior ou o anterior é zero', () => {
    expect(montarLoja(base({ primeiro_dia: '2026-09-30' }), [], []).variacao).toBeNull();
    expect(montarLoja(base({ anterior: { faturamento: 0, pedidos: 0, serie: {} } }), [], []).variacao).toBeNull();
    expect(montarLoja(base({ primeiro_dia: null }), [], []).variacao).toBeNull();
  });

  it('loja sem venda em 30 dias fica parada; sem meta = null', () => {
    const l = montarLoja(base({ vendeu_30d: false, metas: [] }), [], []);
    expect(l.parada).toBe(true);
    expect(l.meta).toBeNull();
  });

  it('vários dias: série por dia, com o iFood no dia da sessão', () => {
    const l = montarLoja(base({
      periodo: { d1: '2026-10-01', d2: '2026-10-04', c1: '2026-09-01', c2: '2026-09-04', corte: null },
      atual: { faturamento: 300, pedidos: 3, canais: {}, serie: { '2026-10-01': 100, '2026-10-03': 200 } },
      janelas_atual: [{ dia: '2026-10-03', ini: '2026-10-03T18:00:00-03:00', fim: '2026-10-04T00:30:00-03:00' }],
    }), [{ at: '2026-10-04T00:10:00-03:00', valor: 40 }], []);
    expect(l.umDia).toBe(false);
    expect(l.atual.serie).toEqual({ '2026-10-01': 100, '2026-10-03': 240 });
  });
});

describe('metaDoPeriodo', () => {
  it('soma a meta de cada dia pelo dia da semana', () => {
    const metas = [{ dia_semana: 0, faturamento: 1000 }, { dia_semana: 6, faturamento: 2000 }];
    expect(metaDoPeriodo(metas, '2026-10-03', '2026-10-04')).toBe(3000); // sáb + dom
    expect(metaDoPeriodo(metas, '2026-10-05', '2026-10-05')).toBeNull(); // segunda sem meta
    expect(metaDoPeriodo([], '2026-10-04', '2026-10-04')).toBeNull();
  });
});

describe('diasEntre', () => {
  it('lista os dias inclusive', () => {
    expect(diasEntre('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });
});

describe('totalLojas', () => {
  it('não mostra variação do total se alguma loja está sem base', () => {
    const a = montarLoja(base(), [], []);
    const b = montarLoja(base({ tenant_id: 't2', primeiro_dia: '2026-10-01' }), [], []);
    expect(totalLojas([a]).variacao).not.toBeNull();
    expect(totalLojas([a, b]).variacao).toBeNull();
    expect(totalLojas([a, b]).faturamento).toBe(4804.6);
  });
  it('loja zerada nos dois períodos não esconde a variação do total', () => {
    const a = montarLoja(base(), [], []);
    const z = montarLoja(base({
      tenant_id: 't3', primeiro_dia: null,
      atual: { faturamento: 0, pedidos: 0, canais: {}, serie: {} }, anterior: { faturamento: 0, pedidos: 0, serie: {} },
    }), [], []);
    expect(z.variacao).toBeNull();
    expect(totalLojas([a, z]).variacao).toBeCloseTo(totalLojas([a]).variacao!, 5);
  });
});

describe('rotuloComparacao', () => {
  it('diz contra o quê compara', () => {
    const l = montarLoja(base(), [], []);
    expect(rotuloComparacao('hoje', l, new Date('2026-10-04T23:04:00-03:00'))).toBe('vs dom passado até 23h04');
    expect(rotuloComparacao('mes', { periodo: { d1: '2026-10-01', d2: '2026-10-04', c1: '2026-09-01', c2: '2026-09-04', corte: null } })).toBe('vs 1 a 4/09');
  });
});

describe('ordenarPorFaturamento', () => {
  const zerado = { faturamento: 0, pedidos: 0, canais: {}, serie: {} };
  it('maior faturamento primeiro; empate pelos últimos 30 dias; depois o nome', () => {
    const lojas = [
      montarLoja(base({ tenant_id: 'vb', nome: 'Vila burguer', atual: zerado, fat_30d: 900 }), [], []),
      montarLoja(base({ tenant_id: 'vl', nome: 'Vila Leste', atual: zerado, fat_30d: 11000 }), [], []),
      montarLoja(base({ tenant_id: 'pg', nome: 'Paranaguá', atual: zerado, fat_30d: 17000 }), [], []),
      montarLoja(base({ tenant_id: 'aa', nome: 'Alfa', atual: zerado }), [], []),
    ];
    expect(ordenarPorFaturamento(lojas).map((l) => l.tenantId)).toEqual(['pg', 'vl', 'vb', 'aa']);
    const comVenda = [...lojas, montarLoja(base({ tenant_id: 'x', nome: 'Nova', fat_30d: 10 }), [], [])];
    expect(ordenarPorFaturamento(comVenda)[0].tenantId).toBe('x'); // vendeu hoje passa à frente
  });
});
