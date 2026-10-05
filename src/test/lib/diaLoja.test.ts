import { describe, it, expect } from 'vitest';
import { diaDoPedido, horaDoDia, janelaDeBusca, somarNosDias, type JanelaSessao } from '../../lib/diaLoja';

// Vila Leste em 04/10: sessão de sábado (03/10) fechou 00:16 de domingo; a de domingo abriu 17:25 e segue aberta.
const janelas: JanelaSessao[] = [
  { dia: '2026-10-03', ini: '2026-10-03T21:00:00-03:00', fim: '2026-10-04T00:16:00-03:00' },
  { dia: '2026-10-04', ini: '2026-10-04T17:25:00-03:00', fim: null },
];

describe('diaDoPedido', () => {
  it('pedido depois da meia-noite com a sessão de ontem aberta é de ontem', () => {
    expect(diaDoPedido(new Date('2026-10-04T00:10:00-03:00'), janelas)).toBe('2026-10-03');
  });
  it('pedido fora de sessão vai pela data do pedido', () => {
    expect(diaDoPedido(new Date('2026-10-04T13:00:00-03:00'), janelas)).toBe('2026-10-04');
  });
  it('sessão aberta (fim null) segura o pedido de madrugada no dia em que abriu', () => {
    expect(diaDoPedido(new Date('2026-10-05T01:30:00-03:00'), janelas)).toBe('2026-10-04');
  });
  it('fim da sessão é exclusivo', () => {
    expect(diaDoPedido(new Date('2026-10-04T00:16:00-03:00'), janelas)).toBe('2026-10-04');
  });
  it('duas sessões abertas ao mesmo tempo: vale a mais recente', () => {
    const j: JanelaSessao[] = [
      { dia: '2026-09-29', ini: '2026-09-29T11:30:00-03:00', fim: null },
      { dia: '2026-09-30', ini: '2026-09-30T11:00:00-03:00', fim: null },
    ];
    expect(diaDoPedido(new Date('2026-09-30T12:00:00-03:00'), j)).toBe('2026-09-30');
  });
});

describe('horaDoDia', () => {
  it('conta as horas desde a 0h do dia da loja (madrugada = 24, 25…)', () => {
    expect(horaDoDia(new Date('2026-10-04T19:40:00-03:00'), '2026-10-04')).toBe(19);
    expect(horaDoDia(new Date('2026-10-05T00:30:00-03:00'), '2026-10-04')).toBe(24);
  });
});

describe('janelaDeBusca', () => {
  it('vai até o fim da última sessão do dia, no mínimo a 0h seguinte', () => {
    const agora = new Date('2026-10-05T01:00:00-03:00');
    const { from, to } = janelaDeBusca('2026-10-04', '2026-10-04', janelas, null, agora);
    expect(from).toBe(new Date('2026-10-04T00:00:00-03:00').toISOString());
    expect(to).toBe(agora.toISOString());
  });
  it('sem sessão: o dia do calendário', () => {
    const { to } = janelaDeBusca('2026-10-01', '2026-10-01', [], null);
    expect(to).toBe(new Date('2026-10-02T00:00:00-03:00').toISOString());
  });
  it('corte limita o fim', () => {
    const corte = new Date('2026-09-27T23:04:00-03:00');
    const { to } = janelaDeBusca('2026-09-27', '2026-09-27', [], corte);
    expect(to).toBe(corte.toISOString());
  });
});

describe('somarNosDias', () => {
  const lista = [
    { at: '2026-10-04T00:10:00-03:00', valor: 50 },             // sessão de sábado
    { at: '2026-10-04T13:00:00-03:00', valor: 30 },             // fora de sessão, domingo
    { at: '2026-10-04T20:05:00-03:00', valor: 100, aoVivo: true }, // sessão de domingo
    { at: '2026-10-05T00:40:00-03:00', valor: 20 },             // sessão de domingo, depois da meia-noite
    { at: '2026-10-04T21:00:00-03:00', valor: 0 },              // cancelado (entrou e saiu)
  ];
  it('soma o dia da loja de domingo', () => {
    const s = somarNosDias(lista, janelas, '2026-10-04', '2026-10-04');
    expect(s.total).toBe(150);
    expect(s.pedidos).toBe(3);
    expect(s.pedidosAoVivo).toBe(1);
    expect(s.porHora).toEqual({ 13: 30, 20: 100, 21: 0, 24: 20 });
  });
  it('sábado leva o pedido de 00:10', () => {
    expect(somarNosDias(lista, janelas, '2026-10-03', '2026-10-03').total).toBe(50);
  });
  it('corte: no último dia só antes da hora', () => {
    const s = somarNosDias(lista, janelas, '2026-10-04', '2026-10-04', new Date('2026-10-04T20:00:00-03:00'));
    expect(s.total).toBe(30);
  });
});
