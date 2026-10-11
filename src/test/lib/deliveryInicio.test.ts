/**
 * Delivery › Início (2026-10-05): frase da situação, linha de cada entrega, "Falta arrumar" e resumo dos 30 dias.
 * Contas em src/pages/config-delivery/abas/inicio/calculos.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  descreverEntrega, descreverSituacao, duracaoCurta, horaBrasilia, itensFaltaArrumar, mensagemEsperandoPix, nomeDoCliente,
  numeroCurto, resumir30d, type EntregaAberta, type PedidoMes,
} from '../../pages/config-delivery/abas/inicio/calculos';
import { CONFIG_VAZIA, type ConfigDelivery } from '../../pages/config-delivery/config';
import type { DeliveryState } from '../../hooks/useDeliveryState';

const brt = (iso: string) => new Date(`${iso}-03:00`).getTime();

const estado = (p: Partial<DeliveryState>): DeliveryState => ({
  open_now: false, reason: 'fechado_manual', manual_open: false, paused_until: null,
  schedule_enabled: false, within_schedule: false, has_session: true, ...p,
});

describe('descreverSituacao', () => {
  const agora = brt('2026-10-06T21:00:00');

  it('aberto pelo horário diz a hora de fechar (em Brasília)', () => {
    const s = descreverSituacao(estado({ open_now: true, reason: 'horario', schedule_enabled: true, minutos_ate_fechar: 120 }), agora);
    expect(s.tom).toBe('aberto');
    expect(s.titulo).toBe('Aberto agora');
    expect(s.frase).toBe('Aberto pelo horário programado. Fecha às 23:00.');
  });

  it('aberto pelo botão sem horário programado avisa que só fecha pelo botão', () => {
    const s = descreverSituacao(estado({ open_now: true, reason: 'manual', schedule_enabled: false }), agora);
    expect(s.frase).toBe('Aberto pelo botão do caixa. Sem horário programado, só fecha pelo botão.');
  });

  it('pausado mostra até que horas', () => {
    const s = descreverSituacao(estado({ reason: 'pausado', paused_until: '2026-10-06T18:30:00.000Z' }), agora);
    expect(s.tom).toBe('pausado');
    expect(s.titulo).toBe('Pausado');
    expect(s.frase).toBe('Pausado até 15:30.');
  });

  it('fechado: cada motivo tem a sua frase', () => {
    expect(descreverSituacao(estado({ reason: 'sem_sessao', has_session: false }), agora).frase).toBe('Fechado: o caixa ainda não foi aberto.');
    expect(descreverSituacao(estado({ reason: 'fora_horario', schedule_enabled: true }), agora).frase).toBe('Fora do horário programado.');
    expect(descreverSituacao(estado({ reason: 'fechado_manual' }), agora).frase).toBe('Fechado pelo botão.');
    expect(descreverSituacao(estado({ reason: 'fechado_manual' }), agora).tom).toBe('fechado');
  });
});

describe('formatos', () => {
  it('numeroCurto, nomeDoCliente, duracaoCurta, horaBrasilia', () => {
    expect(numeroCurto('DEL-0042')).toBe('#0042');
    expect(numeroCurto('17')).toBe('#0017');
    expect(numeroCurto('20261005000123')).toBe('#0123');
    expect(nomeDoCliente('Rafael Lima - Rua das Gaivotas, 120')).toBe('Rafael Lima');
    expect(nomeDoCliente(null)).toBe('Cliente');
    expect(duracaoCurta(9)).toBe('9 min');
    expect(duracaoCurta(60)).toBe('1 h');
    expect(duracaoCurta(65)).toBe('1 h 05 min');
    expect(duracaoCurta(1500)).toBe('1 dia');
    expect(duracaoCurta(189 * 60)).toBe('7 dias');
    expect(horaBrasilia('2026-10-06T02:05:00.000Z')).toBe('23:05');
  });

  it('mensagem do Pix usa o primeiro nome, o número, o valor e o link', () => {
    const m = mensagemEsperandoPix({ nome: 'Rafael Lima', numero: '#0042', valor: 'R$ 86,40', link: 'https://erpos.vercel.app/vila-delivery' });
    expect(m).toBe('Oi Rafael! Seu pedido #0042 de R$ 86,40 está esperando o pagamento pelo app para ir para a cozinha. '
      + 'Se a tela do pagamento sumiu, é só abrir o link de novo neste celular: https://erpos.vercel.app/vila-delivery');
    expect(mensagemEsperandoPix({ nome: 'Cliente', numero: '#1', valor: 'R$ 1,00', link: 'x' }).startsWith('Oi! Seu pedido')).toBe(true);
  });
});

describe('descreverEntrega', () => {
  const agora = brt('2026-10-06T20:30:00');
  const base: EntregaAberta = {
    id: 'a', number: '42', cliente: 'Rafael', endereco: 'Rua A', total: 80, taxa: 8, status: 'ready',
    motoboy_status: null, motoboy_note: null, driver_id: null, driver_nome: null,
  };

  it('pronto sem entregador: vermelho e com os minutos', () => {
    const d = descreverEntrega(base, '2026-10-06T20:21:00-03:00', agora);
    expect(d.tom).toBe('r');
    expect(d.semEntregador).toBe(true);
    expect(d.frase).toBe('Pronto há 9 min, sem entregador');
  });

  it('pronto sem saber quando ficou pronto: não inventa minutos', () => {
    expect(descreverEntrega(base, null, agora).frase).toBe('Pronto, sem entregador');
  });

  it('em rota, a caminho da loja, preparo e fila', () => {
    expect(descreverEntrega({ ...base, motoboy_status: 'coletou', driver_id: 'd', driver_nome: 'Diego' }, null, agora).frase).toBe('Em rota com Diego');
    expect(descreverEntrega({ ...base, motoboy_status: 'a_caminho_loja', driver_id: 'd', driver_nome: 'Diego' }, null, agora).frase).toBe('Diego a caminho da loja');
    expect(descreverEntrega({ ...base, status: 'preparing' }, null, agora).frase).toBe('Em preparo');
    expect(descreverEntrega({ ...base, status: 'new' }, null, agora).frase).toBe('Na fila da cozinha');
  });

  it('problema: vermelho com o último relato', () => {
    const d = descreverEntrega({ ...base, motoboy_status: 'problema', problemas: [{ text: 'portão fechado' }, { text: 'cliente ausente' }] }, null, agora);
    expect(d.tom).toBe('r');
    expect(d.frase).toBe('Problema: cliente ausente');
  });
});

describe('itensFaltaArrumar', () => {
  const completo: ConfigDelivery = {
    ...CONFIG_VAZIA,
    lojaLat: -25.5, lojaLng: -48.5,
    faixas: [{ ate_km: 3, taxa: 6, tempo_max_min: 45 }],
    formasPagamento: { dinheiro: true, pix_online: false, cartao_online: false },
    acerto: { ...CONFIG_VAZIA.acerto, ativo: true },
    horario: { ...CONFIG_VAZIA.horario, enabled: true },
    whatsappLoja: '41999999999',
  };

  it('configuração completa: nada falta', () => {
    expect(itensFaltaArrumar({ salvo: completo, nMotoboys: 3, mp: { pix: true, cartao: true }, ehDono: true, assistenteLigado: true })).toEqual([]);
  });

  it('loja nova: o vermelho vem primeiro, depois o âmbar, depois o neutro', () => {
    const itens = itensFaltaArrumar({ salvo: CONFIG_VAZIA, nMotoboys: 2, mp: { pix: false, cartao: false }, ehDono: true, assistenteLigado: false });
    expect(itens.map((i) => i.id)).toEqual(['pino', 'faixa', 'pagamento', 'acerto', 'horario', 'mp', 'assistente', 'whatsapp']);
    expect(itens.map((i) => i.tom)).toEqual(['alerta', 'alerta', 'alerta', 'prop', 'prop', 'neutro', 'neutro', 'neutro']);
    expect(itens[3].titulo).toBe('2 entregadores e nenhuma regra de pagamento');
    expect(itens[1].aba).toBe('area');
    expect(itens[2].aba).toBe('pagamento');
  });

  it('Pix e cartão pelo app sem Mercado Pago não contam como forma; sem conferir o Mercado Pago, não alerta', () => {
    const soApp: ConfigDelivery = { ...completo, formasPagamento: {} }; // chave ausente = pelo app ligado
    expect(itensFaltaArrumar({ salvo: soApp, nMotoboys: 0, mp: { pix: false, cartao: false }, ehDono: false, assistenteLigado: null }).map((i) => i.id))
      .toEqual(['pagamento', 'mp']);
    expect(itensFaltaArrumar({ salvo: soApp, nMotoboys: 0, mp: null, ehDono: false, assistenteLigado: null })).toEqual([]);
  });

  it('só Pix aparece: o aviso fala do cartão', () => {
    const itens = itensFaltaArrumar({ salvo: { ...completo, formasPagamento: {} }, nMotoboys: 0, mp: { pix: true, cartao: false }, ehDono: false, assistenteLigado: null });
    expect(itens).toHaveLength(1);
    expect(itens[0].titulo).toBe('Cartão pelo app ligado, mas o cliente não vê');
  });

  it('assistente só é cobrado do dono e só quando se sabe que está desligado', () => {
    const e = { salvo: completo, nMotoboys: 0, mp: { pix: true, cartao: true } };
    expect(itensFaltaArrumar({ ...e, ehDono: false, assistenteLigado: false }).map((i) => i.id)).toEqual([]);
    expect(itensFaltaArrumar({ ...e, ehDono: true, assistenteLigado: null }).map((i) => i.id)).toEqual([]);
    expect(itensFaltaArrumar({ ...e, ehDono: true, assistenteLigado: false }).map((i) => i.id)).toEqual(['assistente']);
  });
});

describe('resumir30d', () => {
  const ped = (p: Partial<PedidoMes>): PedidoMes => ({
    status: 'delivered', total_amount: 100, delivery_fee: 8, cancel_reason: null, motoboy_status: 'entregou',
    motoboy_timeline: null, out_for_delivery_at: null, delivery_source: null, delivery_platform: 'propria',
    created_at: '2026-10-01T20:00:00Z', ...p,
  });
  const tl = (coletou: string, entregou: string) => ({ coletou: `2026-10-01T${coletou}:00Z`, entregou: `2026-10-01T${entregou}:00Z` });

  const lista: PedidoMes[] = [
    ped({ motoboy_timeline: tl('20:00', '20:20') }),
    ped({ motoboy_timeline: tl('20:00', '20:30'), total_amount: 60, delivery_fee: 6 }),
    ped({ motoboy_timeline: tl('20:00', '20:40'), delivery_source: 'ig' }),
    // "Entregue" regravou a saída com a hora da entrega: não vira 0 min
    ped({ motoboy_status: null, out_for_delivery_at: '2026-10-01T21:00:00Z', motoboy_timeline: { entregou: '2026-10-01T21:00:00Z' } }),
    ped({ status: 'new', motoboy_status: null, delivery_source: 'Instagram' }),
    ped({ status: 'cancelled', cancel_reason: 'Pix pelo app não pago até o fechamento do caixa', total_amount: 50 }),
    ped({ status: 'cancelled', cancel_reason: 'Pix pelo app não pago até o fechamento do caixa', total_amount: 50 }),
    ped({ status: 'cancelled', cancel_reason: 'Cliente desistiu', total_amount: 50 }),
    ped({ status: 'draft', total_amount: 999 }),
    ped({ delivery_platform: 'ifood', total_amount: 999 }),
    ped({ delivery_platform: 'retirada', total_amount: 999 }),
    ped({ delivery_platform: null }),
  ];

  it('conta só entrega própria, sem rascunho de Pix e sem iFood/retirada', () => {
    const r = resumir30d(lista);
    expect(r.total).toBe(9);
    expect(r.cancelados).toBe(3);
    expect(r.naoCancelados).toBe(6);
    expect(r.entregues).toBe(5);
    expect(r.vendido).toBe(100 + 60 + 100 + 100 + 100 + 100);
    expect(r.ticket).toBeCloseTo(560 / 6, 5);
    expect(r.taxaMedia).toBeCloseTo((8 + 6 + 8 + 8 + 8 + 8) / 6, 5);
  });

  it('motivo mais comum, entregas sem marca do motoboy e Instagram', () => {
    const r = resumir30d(lista);
    expect(r.motivoTop).toEqual({ motivo: 'Pix pelo app não pago até o fechamento do caixa', n: 2 });
    expect(r.entreguesSemMarca).toBe(1);
    expect(r.doInstagram).toBe(2);
  });

  it('tempo médio saiu → entregou: usa o "Coletou" e ignora quem não tem os dois horários', () => {
    const r = resumir30d(lista);
    expect(r.tempoAmostra).toBe(3);
    expect(r.tempoMedioMin).toBe(30);
  });

  it('com menos de 3 entregas medidas, não mostra tempo médio', () => {
    expect(resumir30d(lista.slice(0, 2)).tempoMedioMin).toBeNull();
  });

  it('pedido do iFood entregue pelo motoboy da loja conta como entrega, mas não como venda/ticket/taxa', () => {
    const comIfood = [
      ...lista,
      ped({ ifood_order_id: 'abc', total_amount: 200, delivery_fee: 10, motoboy_timeline: tl('20:00', '20:20') }),
      ped({ ifood_order_id: 'def', total_amount: 300, delivery_fee: 12, delivery_source: 'ig' }),
      ped({ ifood_order_id: 'ghi', status: 'cancelled', total_amount: 80 }),
    ];
    const r = resumir30d(comIfood);
    expect(r.entregues).toBe(7); // as 5 de antes + 2 do iFood que o motoboy da loja entregou
    expect(r.vendido).toBe(560);
    expect(r.ticket).toBeCloseTo(560 / 6, 5);
    expect(r.taxaMedia).toBeCloseTo(46 / 6, 5);
    expect(r.cancelados).toBe(3); // cancelado do iFood é do canal iFood
    expect(r.naoCancelados).toBe(6);
    expect(r.doInstagram).toBe(2);
    expect(r.tempoAmostra).toBe(4); // o tempo de entrega do motoboy continua contando
  });

  it('sem pedidos: tudo zerado', () => {
    const r = resumir30d([]);
    expect(r).toMatchObject({ total: 0, entregues: 0, vendido: 0, ticket: 0, taxaMedia: 0, cancelados: 0, motivoTop: null, tempoMedioMin: null });
  });
});
