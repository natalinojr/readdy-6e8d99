import { describe, it, expect } from 'vitest';
import type { PedidoOrder } from '@/lib/ifoodArea';
import { ifoodParaRecente, ifoodSoAcompanhando, janelaIfoodPedidos, statusDoIfood } from '@/pages/pedidos/lib/ifoodExterno';

const AGORA = new Date('2026-10-05T20:00:00-03:00').getTime();
const base = (over: Partial<PedidoOrder> = {}): PedidoOrder => ({
  id: 'abc-123', rowId: 'r1', numero: '4821', loja: 'm1', at: new Date('2026-10-05T19:30:00-03:00'), status: 'preparing', tipo: 'DELIVERY',
  entregaPor: 'IFOOD', cliente: 'Maria', pedidosAntes: 0, subTotal: 64.5, entregaCliente: 5, taxaServico: 0, desconto: 8, promoLoja: 5, promoLojaEntrega: 0, promoIfood: 3,
  clientePagou: 61.5, pagamento: 'Pix', itens: [
    { nome: 'Taco', qtd: 2, total: 40, obs: 'sem cebola', complementos: [{ nome: 'Bacon', grupo: 'Extras', qtd: 2, preco: 2 }] },
    { nome: 'Coca', qtd: 1, total: 24.5, obs: null, complementos: [] },
  ],
  timeline: {}, motivoCancelamento: null, pedidoErpos: null, teste: false, ...over,
});

describe('ifoodParaRecente', () => {
  it('vira delivery iFood pago, com o total dos itens e o número do iFood', () => {
    const p = ifoodParaRecente(base(), AGORA);
    expect(p).toMatchObject({
      id: 'ifood:abc-123', origem: 'delivery', destino: 'delivery', deliveryPlatform: 'ifood', numeroCodigo: 'iFood #4821',
      nomeCliente: 'Maria', pago: true, total: 64.5, status: 'preparing', dataPedido: '2026-10-05', criadoEm: '19:30', minutosAtras: 30,
    });
    expect(p.ifoodExterno).toMatchObject({ id: 'abc-123', numero: '4821', promoLoja: 5, promoIfood: 3, pedidosAntes: 0, situacao: 'preparing' });
    expect(p.itensDetalhes[0]).toMatchObject({ nome: 'Taco', quantidade: 2, preco: 20, opcoes: ['2× Bacon'], observacao: 'sem cebola' });
  });
  it('retirada ganha o sufixo que o Delivery do ERPOS usa', () => {
    expect(ifoodParaRecente(base({ tipo: 'TAKEOUT', cliente: 'João' }), AGORA).nomeCliente).toBe('João - Retirada');
  });
  it('a data é a de Brasília (23h40 não vira o dia seguinte)', () => {
    const p = ifoodParaRecente(base({ at: new Date('2026-10-05T23:40:00-03:00') }), AGORA + 5 * 3_600_000);
    expect(p.dataPedido).toBe('2026-10-05');
  });
});

describe('statusDoIfood', () => {
  it('mapeia e não deixa pedido na cozinha para sempre', () => {
    const c = AGORA - 30 * 60000;
    expect(statusDoIfood('placed', c, AGORA)).toBe('new');
    expect(statusDoIfood('confirmed', c, AGORA)).toBe('preparing');
    expect(statusDoIfood('preparing', c, AGORA)).toBe('preparing');
    expect(statusDoIfood('ready', c, AGORA)).toBe('ready');
    expect(statusDoIfood('dispatched', c, AGORA)).toBe('delivered');
    expect(statusDoIfood('concluded', c, AGORA)).toBe('delivered');
    expect(statusDoIfood('cancelled', c, AGORA)).toBe('cancelled');
    expect(statusDoIfood('preparing', AGORA - 13 * 3_600_000, AGORA)).toBe('delivered');
    expect(statusDoIfood('cancelled', AGORA - 13 * 3_600_000, AGORA)).toBe('cancelled');
  });
});

describe('ifoodSoAcompanhando', () => {
  it('tira quem já virou pedido do ERPOS e os de teste', () => {
    const lista = [base({ id: 'a' }), base({ id: 'b', pedidoErpos: 'order-1' }), base({ id: 'c', teste: true })];
    expect(ifoodSoAcompanhando(lista).map((o) => o.id)).toEqual(['a']);
  });
});

describe('janelaIfoodPedidos', () => {
  it('dias escolhidos: do começo do primeiro ao fim do último, em Brasília', () => {
    expect(janelaIfoodPedidos({ dateFrom: '2026-10-01', dateTo: '2026-10-05', hoje: '2026-10-05' }))
      .toEqual({ from: '2026-10-01T00:00:00-03:00', to: '2026-10-05T23:59:59.999-03:00' });
  });
  it('sem data final vai até hoje; sem data nenhuma não busca', () => {
    expect(janelaIfoodPedidos({ dateFrom: '2000-01-01', hoje: '2026-10-05' })?.to).toBe('2026-10-05T23:59:59.999-03:00');
    expect(janelaIfoodPedidos({ hoje: '2026-10-05' })).toBeNull();
  });
  it('turno: abertura até o fechamento, ou abertura + 36 h se aberto (janela fixa); sem sessão cai no dia de hoje', () => {
    expect(janelaIfoodPedidos({ hoje: '2026-10-05', modoSessao: true, sessao: { opened_at: '2026-10-04T21:00:00Z', closed_at: '2026-10-05T03:00:00Z' } }))
      .toEqual({ from: '2026-10-04T21:00:00Z', to: '2026-10-05T03:00:00Z' });
    expect(janelaIfoodPedidos({ hoje: '2026-10-05', modoSessao: true, sessao: { opened_at: '2026-10-05T20:00:00Z', closed_at: null }, agoraMs: AGORA })?.to).toBe('2026-10-07T08:00:00.000Z');
    expect(janelaIfoodPedidos({ hoje: '2026-10-05', modoSessao: true, sessao: null })).toEqual({ from: '2026-10-05T00:00:00-03:00', to: '2026-10-05T23:59:59.999-03:00' });
  });
});

describe('loja de testes', () => {
  it('mostra os pedidos de teste quando a loja só tem pedido de teste', () => {
    const lista = [base({ id: 'a', teste: true }), base({ id: 'b', teste: true, pedidoErpos: 'o1' })];
    expect(ifoodSoAcompanhando(lista).map((o) => o.id)).toEqual(['a']);
  });
});
