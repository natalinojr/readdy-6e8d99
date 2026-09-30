// @vitest-environment node
// ifood-shipping/analytics.ts: indicadores do iFood (módulo Analytics). Casos dos "motivos comuns de rejeição" da doc
// de homologação e da fórmula do ticket médio (gmv.sum ÷ pedidos concluídos).
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/ifood-shipping/analytics.ts')).href;

/* eslint-disable @typescript-eslint/no-explicit-any */
let m: any;
beforeAll(async () => { m = await import(/* @vite-ignore */ PATH); });

const periodo = { referenceDate: { gte: '2026-06-01 00:00:00', lte: '2026-06-07 23:59:59' } };

describe('validarCorpoKpis', () => {
  it('aceita o exemplo da doc de homologação e as consultas da tela', () => {
    expect(m.validarCorpoKpis(m.corpoHomologacao('2026-06-01 00:00:00', '2026-06-07 23:59:59'))).toBeNull();
    expect(m.validarCorpoKpis(m.consultaKpis('2026-06-01 00:00:00', '2026-06-07 23:59:59', 3))).toBeNull();
  });
  it('recusa sem agregação', () => { expect(m.validarCorpoKpis({ filter: periodo, agg: {} })).toMatch(/agregação/); });
  it('recusa sem referenceDate', () => { expect(m.validarCorpoKpis({ agg: { metrics: { gmv: ['sum'] } } })).toMatch(/período/); });
  it('recusa gte > lte e gte+gt juntos', () => {
    expect(m.validarCorpoKpis({ agg: { metrics: { gmv: ['sum'] } }, filter: { referenceDate: { gte: '2026-06-08', lte: '2026-06-07' } } })).toMatch(/depois/);
    expect(m.validarCorpoKpis({ agg: { metrics: { gmv: ['sum'] } }, filter: { referenceDate: { gte: '2026-06-01', gt: '2026-06-01' } } })).toMatch(/só um início/);
  });
  it('recusa campo de groupBy fora do enum, função inválida e duplicados', () => {
    expect(m.validarCorpoKpis({ agg: { groupBy: { fields: ['cidade'] } }, filter: periodo })).toMatch(/cidade/);
    expect(m.validarCorpoKpis({ agg: { metrics: { gmv: ['median'] } }, filter: periodo })).toMatch(/median/);
    expect(m.validarCorpoKpis({ agg: { metrics: { gmv: ['sum', 'sum'] } }, filter: periodo })).toMatch(/repetida/);
    expect(m.validarCorpoKpis({ agg: { terms: { orderStatus: ['sum'] } }, filter: periodo })).toMatch(/count, cardinality/);
  });
  it('limita page 1–1000 e size 1–10000', () => {
    const base = { agg: { metrics: { gmv: ['sum'] } }, filter: periodo };
    expect(m.validarCorpoKpis({ ...base, page: 0 })).toMatch(/Página/);
    expect(m.validarCorpoKpis({ ...base, page: 1001 })).toMatch(/Página/);
    expect(m.validarCorpoKpis({ ...base, size: 10001 })).toMatch(/Tamanho/);
    expect(m.validarCorpoKpis({ ...base, page: 1000, size: 10000 })).toBeNull();
  });
});

describe('periodoKpis (D-1)', () => {
  it('padrão = 7 dias até ontem', () => {
    const p = m.periodoKpis(undefined, undefined, '2026-09-30');
    expect(p).toMatchObject({ de: '2026-09-23', ate: '2026-09-29', dias: 7, gte: '2026-09-23 00:00:00', lte: '2026-09-29 23:59:59' });
  });
  it('fim hoje/futuro vira ontem', () => {
    expect(m.periodoKpis('2026-09-01', '2026-09-30', '2026-09-30')).toMatchObject({ ate: '2026-09-29', ajustado: true });
  });
  it('início hoje não tem dado', () => { expect(m.periodoKpis('2026-09-30', '2026-09-30', '2026-09-30').erro).toMatch(/D-1/); });
  it('início depois do fim e período grande demais', () => {
    expect(m.periodoKpis('2026-09-10', '2026-09-01', '2026-09-30').erro).toMatch(/depois/);
    expect(m.periodoKpis('2025-01-01', '2026-09-01', '2026-09-30').erro).toMatch(/grande/);
  });
});

describe('resumirLinhas', () => {
  // Formato real do ambiente de teste (2026-09-30): dayOfWeek em nome, sem terms.
  const L = (dia: string, status: string, ent: string, pag: string, canal: string, count: number, gmv: number, sem: number) =>
    ({ groupByKey: { value: { dayOfWeek: dia, orderStatus: status, deliveredBy: ent, paymentMethod: pag, salesChannel: canal }, count }, gmv: { sum: gmv }, gmvWithoutDelivery: { sum: sem } });
  const linhas = [
    L('WEDNESDAY', 'CONCLUDED', 'MERCHANT_DELIVERY', 'PIX', 'IFOOD', 10, 600, 550),
    L('THURSDAY', 'CONCLUDED', 'IFOOD_DELIVERY', 'CREDIT', 'IFOOD', 10, 400, 400),
    L('THURSDAY', 'CANCELLED', 'IFOOD_DELIVERY', 'CREDIT', 'DIGITAL_CATALOG', 5, 250, 250),
  ];
  it('GMV e ticket só dos concluídos; cancelamento = canc ÷ (concl + canc)', () => {
    const r = m.resumirLinhas(linhas);
    expect(r.gmv).toBe(1000);
    expect(r.gmvSemEntrega).toBe(950);
    expect(r.taxaEntrega).toBe(50);
    expect(r.ticket).toBe(50);
    expect(r.pedidosConcluidos).toBe(20);
    expect(r.pedidosCancelados).toBe(5);
    expect(r.taxaCancelamento).toBeCloseTo(0.2);
  });
  it('distribuições contam todos os pedidos; dia da semana vira 1..7', () => {
    const r = m.resumirLinhas(linhas);
    expect(r.porCanal).toEqual({ IFOOD: 20, DIGITAL_CATALOG: 5 });
    expect(r.porLogistica).toEqual({ MERCHANT_DELIVERY: 10, IFOOD_DELIVERY: 15 });
    expect(r.porPagamento).toEqual({ PIX: 10, CREDIT: 15 });
    expect(r.porDiaSemana).toEqual({ 3: 10, 4: 15 });
    expect(m.diaSemana(2)).toBe('2');
  });
  it('tabela canal × entrega só com concluídos, ticket por linha', () => {
    const r = m.resumirLinhas(linhas);
    expect(r.porCanalEntrega).toEqual([
      { canal: 'IFOOD', logistica: 'MERCHANT_DELIVERY', pedidos: 10, gmv: 600, ticket: 60 },
      { canal: 'IFOOD', logistica: 'IFOOD_DELIVERY', pedidos: 10, gmv: 400, ticket: 40 },
    ]);
  });
  it('resposta vazia não quebra', () => {
    const r = m.resumirLinhas([]);
    expect(r.gmv).toBeNull();
    expect(r.ticket).toBeNull();
    expect(r.taxaCancelamento).toBeNull();
  });
});

describe('mensagemErroKpis', () => {
  it('tem mensagem para cada status exigido', () => {
    for (const s of [400, 401, 403, 404, 429, 500, 503, 0]) expect(m.mensagemErroKpis(s)).toBeTruthy();
    expect(m.mensagemErroKpis(403)).toMatch(/Analytics/);
    expect(m.mensagemErroKpis(429)).toMatch(/1 minuto/);
  });
});
