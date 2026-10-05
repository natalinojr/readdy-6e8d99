import { describe, it, expect } from 'vitest';
import type { PedidoRecente } from '@/types/pdv';
import {
  numeroCurto, situacaoPedido, tempoFases, ondeQuem, canalPedido, buscaPedido, valorDaBusca,
  resumoPedidos, pendenciasPedidos, passaNoChip, filtrarComGrupos, ehSemNota, entregaDoPedido,
} from '@/lib/pedidosRegras';

const HOJE = '2026-10-04';
const AGORA = new Date('2026-10-04T19:43:00-03:00').getTime();
const ts = (hhmm: string, dia = HOJE) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();

function ped(over: Partial<PedidoRecente> = {}): PedidoRecente {
  return {
    id: over.id ?? 'p1', numero: 48, numeroCodigo: 'P0410260048', destino: 'senha', senha: 'P-14',
    status: 'delivered', pago: true, total: 50, criadoEm: '19:11', dataPedido: HOJE, minutosAtras: 30,
    itensProntos: 1, itensTotal: 1, origem: 'autoatendimento', itensDetalhes: [], _criadoTs: ts('19:11'),
    ...over,
  } as PedidoRecente;
}
const un = (o: Partial<PedidoRecente['itensDetalhes'][0]['unidades'][0]>) => ({ unidade: 1, status: 'aguardando' as const, ...o });

describe('numeroCurto', () => {
  it('tira prefixo e data', () => {
    expect(numeroCurto(ped())).toBe('048');
    expect(numeroCurto(ped({ numeroCodigo: 'P031026003' }))).toBe('003');
    expect(numeroCurto(ped({ numeroCodigo: 'P0410261234' }))).toBe('1234');
  });
  it('fora do padrão devolve o código', () => {
    expect(numeroCurto(ped({ numeroCodigo: 'ABC' }))).toBe('ABC');
    expect(numeroCurto(ped({ numeroCodigo: undefined, numero: 7 }))).toBe('007');
  });
});

describe('situacaoPedido', () => {
  it('na cozinha conta desde a criação e marca atraso depois da meta', () => {
    const s = situacaoPedido(ped({ status: 'preparing' }), AGORA, HOJE);
    expect(s).toMatchObject({ tipo: 'cozinha', minutos: 32, atrasado: true });
    expect(s.rotulo).toBe('Na cozinha · 32 min');
  });
  it('pronto mostra há quanto espera', () => {
    const s = situacaoPedido(ped({ status: 'ready', _ficouProntoTs: ts('19:37') }), AGORA, HOJE);
    expect(s).toMatchObject({ tipo: 'pronto', minutos: 6 });
  });
  it('delivery que saiu', () => {
    const s = situacaoPedido(ped({ status: 'ready', origem: 'delivery', saiuEntregaTs: ts('19:31') }), AGORA, HOJE);
    expect(s).toMatchObject({ tipo: 'saiu', minutos: 12 });
  });
  it('andando de outro dia é parado, não atraso de 2000 min', () => {
    const s = situacaoPedido(ped({ status: 'new', _criadoTs: ts('22:10', '2026-10-02') }), AGORA, HOJE);
    expect(s.tipo).toBe('parado');
    expect(s.rotulo).toBe('Parado desde 02/10');
  });
  it('entregue usa o tempo gravado', () => {
    expect(situacaoPedido(ped({ tempoAberto: 27 }), AGORA, HOJE)).toMatchObject({ tipo: 'entregue', minutos: 27, atrasado: true });
    expect(situacaoPedido(ped({ tempoAberto: undefined }), AGORA, HOJE)).toMatchObject({ tipo: 'entregue', minutos: null, atrasado: false });
  });
  it('cancelado nunca é atrasado', () => {
    expect(situacaoPedido(ped({ status: 'cancelled', tempoAberto: 99 }), AGORA, HOJE)).toMatchObject({ tipo: 'cancelado', atrasado: false });
  });
});

describe('tempoFases', () => {
  const itens = (unidades: PedidoRecente['itensDetalhes'][0]['unidades'], extra: Partial<PedidoRecente['itensDetalhes'][0]> = {}) =>
    [{ id: 'i', nome: 'Taco', quantidade: unidades.length, preco: 10, estacao: 'Cozinha', opcoes: [], unidades, ...extra }];
  it('pedido entregue: fila, cozinha, entrega e total', () => {
    const p = ped({
      _criadoTs: ts('18:15'), _entregueTs: ts('18:24'),
      itensDetalhes: itens([un({ status: 'entregue', _iniciadoPreparoTs: ts('18:16'), _prontoTs: ts('18:22'), _entregueTs: ts('18:24') })]),
    });
    expect(tempoFases(p, AGORA)).toMatchObject({ fila: 1, cozinha: 6, entrega: 2, total: 9, correndo: null });
  });
  it('em preparo: fase correndo é a cozinha', () => {
    const p = ped({
      status: 'preparing',
      itensDetalhes: itens([un({ status: 'preparo', _iniciadoPreparoTs: ts('19:13') }), un({ unidade: 2, status: 'pronto', _iniciadoPreparoTs: ts('19:14'), _prontoTs: ts('19:20') })]),
    });
    expect(tempoFases(p, AGORA)).toMatchObject({ fila: 2, cozinha: null, correndo: 'cozinha', correndoMin: 30 });
  });
  it('bebida sem cozinha não inventa fila/cozinha', () => {
    const p = ped({ status: 'ready', itensDetalhes: itens([un({ status: 'aguardando', semCozinha: true })]) });
    expect(tempoFases(p, AGORA)).toMatchObject({ fila: null, cozinha: null, correndo: 'entrega' });
  });
  it('item cancelado não segura o "pronto"', () => {
    const p = ped({
      _criadoTs: ts('18:00'),
      itensDetalhes: [
        ...itens([un({ status: 'entregue', _iniciadoPreparoTs: ts('18:01'), _prontoTs: ts('18:05'), _entregueTs: ts('18:06') })]),
        { id: 'x', nome: 'Churros', quantidade: 1, preco: 14, estacao: '', opcoes: [], cancelado: true, unidades: [un({})] },
      ],
    });
    expect(tempoFases(p, AGORA)).toMatchObject({ cozinha: 4, entrega: 1, total: 6 });
  });
});

describe('onde/quem e canal', () => {
  it('tablet, totem, mesa, balcão, delivery e QR', () => {
    expect(ondeQuem(ped())).toBe('Tablet P-14');
    expect(canalPedido(ped({ senha: '301' }))).toBe('totem');
    expect(ondeQuem(ped({ origem: 'garcom', destino: 'mesa', mesaNumero: 12 }))).toBe('Mesa 12');
    expect(ondeQuem(ped({ origem: 'caixa', destino: 'nome', nomeCliente: 'Ana' }))).toBe('Balcão · Ana');
    expect(ondeQuem(ped({ origem: 'caixa', destino: 'hora' }))).toBe('Balcão');
    expect(ondeQuem(ped({ origem: 'delivery', destino: 'nome', nomeCliente: 'João Silva' }))).toBe('João Silva');
    expect(ondeQuem(ped({ origem: 'autoatendimento', senha: undefined, participantToken: '12', participantName: 'Angélica' }))).toBe('Senha 12 · Angélica');
  });
});

describe('busca', () => {
  const p = ped({
    total: 42, nomeCliente: 'José Antônio', telefone: '41999887766', origem: 'delivery', destino: 'nome',
    itensDetalhes: [{ id: 'i', nome: 'Açaí', quantidade: 1, preco: 42, estacao: '', opcoes: [], unidades: [] }],
  });
  it('valor', () => {
    expect(valorDaBusca('R$ 42,00')).toBe(42);
    expect(buscaPedido(p, '42')).toBe(true);
    expect(buscaPedido(p, '42,00')).toBe(true);
    expect(buscaPedido(p, '41')).toBe(false);
  });
  it('final do número, telefone e sem acento', () => {
    expect(buscaPedido(p, '48')).toBe(true);
    expect(buscaPedido(p, '#048')).toBe(true);
    expect(buscaPedido(p, '9988')).toBe(true);
    expect(buscaPedido(p, 'jose antonio')).toBe(true);
    expect(buscaPedido(p, 'acai')).toBe(true);
  });
});

describe('resumo e pendências', () => {
  const lista = [
    ped({ id: 'a', total: 100 }),
    ped({ id: 'b', total: 42, pago: false, status: 'delivered', _criadoTs: ts('18:15'), _entregueTs: ts('18:24') }),
    ped({ id: 'c', total: 0, cortesia: true }),
    ped({ id: 'd', total: 16, status: 'cancelled' }),
    ped({ id: 'e', total: 30, status: 'preparing', pago: true }),
  ];
  it('vendido inclui não pago; recebido só pago; ticket sem cortesia; cancelado à parte', () => {
    const r = resumoPedidos(lista);
    expect(r).toMatchObject({ pedidos: 4, vendido: 172, recebido: 130, naoPagos: 1, naoPagoValor: 42, cancelados: 1, canceladoValor: 16 });
    expect(r.ticket).toBeCloseTo(172 / 3);
  });
  it('pendências: não pago entregue há 30+ min, sem nota e atrasado', () => {
    const notas: Record<string, string> = { a: 'authorized', e: 'processing' };
    const ctx = { agoraMs: AGORA, hoje: HOJE, fiscalAtivo: true, statusNota: (id: string) => notas[id] };
    const pend = pendenciasPedidos(lista, ctx);
    expect(pend.naoPagos.map((p) => p.id)).toEqual(['b']);
    expect(pend.semNota.map((p) => p.id)).toEqual([]);
    expect(pend.atrasados.map((p) => p.id)).toEqual(['e']);
    const semFiscal = pendenciasPedidos(lista, { ...ctx, fiscalAtivo: false });
    expect(semFiscal.semNota).toEqual([]);
    expect(ehSemNota(ped({ id: 'z' }), true, () => 'rejected')).toBe(true);
  });
  it('não pago recém-entregue ainda não é pendência', () => {
    const p = ped({ id: 'n', pago: false, _entregueTs: ts('19:30') });
    expect(pendenciasPedidos([p], { agoraMs: AGORA, hoje: HOJE, fiscalAtivo: false, statusNota: () => undefined }).naoPagos).toEqual([]);
  });
  it('chips e grupo inteiro', () => {
    const ctx = { agoraMs: AGORA, hoje: HOJE, fiscalAtivo: false, statusNota: () => undefined };
    expect(lista.filter((p) => passaNoChip(p, 'cozinha', ctx)).map((p) => p.id)).toEqual(['e']);
    expect(lista.filter((p) => passaNoChip(p, 'naopago', ctx)).map((p) => p.id)).toEqual(['b']);
    const grupo = ped({ id: 'group-x', pedidoIds: ['g1', 'g2'], pedidosOriginais: [ped({ id: 'g1', itensDetalhes: [] }), ped({ id: 'g2', nomeCliente: 'Pedro', destino: 'nome' })] });
    expect(filtrarComGrupos([grupo, ped({ id: 's' })], (p) => buscaPedido(p, 'pedro')).map((p) => p.id)).toEqual(['group-x']);
  });
});

describe('entregaDoPedido', () => {
  it('separa nome, endereço e retirada do destination_name', () => {
    expect(entregaDoPedido({ nomeCliente: 'Davi - Rua Tibagi 617 (Casa) - Praia de Leste', endereco: 'Rua Tibagi 617 (Casa) - Praia de Leste' }))
      .toEqual({ nome: 'Davi', retirada: false, endereco: 'Rua Tibagi 617 (Casa) - Praia de Leste' });
    expect(entregaDoPedido({ nomeCliente: 'eduardo - Retirada', endereco: 'gfdfg 123' }))
      .toEqual({ nome: 'eduardo', retirada: true, endereco: null });
    expect(entregaDoPedido({ nomeCliente: 'Ana', endereco: null })).toEqual({ nome: 'Ana', retirada: false, endereco: null });
    expect(ondeQuem(ped({ origem: 'delivery', destino: 'nome', nomeCliente: 'Davi - Rua X 1' }))).toBe('Davi');
  });
});

describe('revisão 2026-10-05', () => {
  it('busca por valor com milhar', () => {
    expect(valorDaBusca('1.234,50')).toBe(1234.5);
    expect(valorDaBusca('R$ 12.000')).toBe(12000);
  });
  it('canal desligado na loja não conta como sem nota', () => {
    const delivery = ped({ id: 'd1', origem: 'delivery', destino: 'nome' });
    expect(ehSemNota(delivery, true, () => undefined, () => false)).toBe(false);
    expect(ehSemNota(delivery, true, () => undefined, () => true)).toBe(true);
  });
});
