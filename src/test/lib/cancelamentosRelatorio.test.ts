import { describe, it, expect } from 'vitest';
import { cancelamentosPorHora, estornosSemCancelamento, horaCheia } from '@/lib/cancelamentosRelatorio';

describe('cancelamentosPorHora', () => {
  it('agrupa por hora cheia (Brasília), em ordem e sem cortar em 12', () => {
    // 15 horas diferentes (08h..22h), mais um segundo cancelamento às 10h
    const lista = Array.from({ length: 15 }, (_, i) => ({ id: `o${i}`, hora: `${String(8 + i).padStart(2, '0')}:15`, valor: 10 }));
    lista.push({ id: 'extra', hora: '10:50', valor: 5 });
    const r = cancelamentosPorHora(lista);
    expect(r).toHaveLength(15);
    expect(r.map((x) => x.hora)).toEqual(Array.from({ length: 15 }, (_, i) => 8 + i));
    expect(r.find((x) => x.hora === 10)).toMatchObject({ dia: '10h', count: 2, total: 15 });
  });

  it('sem "hora" usa a data (UTC → Brasília): 02:30Z de 21/09 é 23h30 de 20/09', () => {
    expect(horaCheia({ data: '2026-09-21T02:30:00Z' })).toBe(23);
    expect(cancelamentosPorHora([{ data: '2026-09-21T02:30:00Z', valor: 7 }])).toEqual([{ hora: 23, dia: '23h', count: 1, total: 7 }]);
  });

  it('item sem hora nem data fica de fora', () => {
    expect(cancelamentosPorHora([{ valor: 3 }])).toEqual([]);
  });
});

describe('estornosSemCancelamento', () => {
  const cancel = [{ id: 'ord-1', pedido: '#0021', data: '2026-09-21T23:10:00Z', valor: 21 }];

  it('pedido cancelado e estornado não conta de novo (casa pelo order_id quando a RPC manda)', () => {
    const estornos = [
      { id: 'pg-1', order_id: 'ord-1', pedido: '#0021', data: '2026-09-21T23:11:00Z', valor: 21 },
      { id: 'pg-2', order_id: 'ord-9', pedido: '#0030', data: '2026-09-21T23:30:00Z', valor: 40 },
    ];
    expect(estornosSemCancelamento(cancel, estornos).map((e) => e.id)).toEqual(['pg-2']);
  });

  it('sem order_id casa pelo número do pedido no mesmo dia de Brasília', () => {
    const estornos = [
      { id: 'pg-1', pedido: '#0021', data: '2026-09-21T23:11:00Z', valor: 21 },
      // mesmo número em outro dia: é outro pedido (a numeração recomeça por sessão)
      { id: 'pg-3', pedido: '#0021', data: '2026-09-25T20:00:00Z', valor: 15 },
    ];
    expect(estornosSemCancelamento(cancel, estornos).map((e) => e.id)).toEqual(['pg-3']);
  });

  it('sem cancelamentos todos os estornos contam', () => {
    const estornos = [{ id: 'a', pedido: '#1', valor: 5 }, { id: 'b', pedido: '#2', valor: 6 }];
    expect(estornosSemCancelamento([], estornos)).toHaveLength(2);
  });
});
