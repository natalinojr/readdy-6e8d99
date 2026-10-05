/**
 * src/lib/porQueMudou.ts — "Por que mudou?": frases por regra, só com causa registrada; sem causa, diz que não achou.
 */
import { describe, it, expect } from 'vitest';
import { explicarVariacao, tituloVariacao, type EntradaPorQue, type FatosPorQue } from '@/lib/porQueMudou';

/** O real do pt-BR vem com espaço sem quebra; nos testes lemos como espaço comum. */
const n = (x: string) => x.replace(/ /g, ' ');

const fatosVazios = (): FatosPorQue => ({ canais: { atual: {}, anterior: {} }, aberturas: { atual: [], anterior: [] }, pausas: [] });
const base = (o: Partial<EntradaPorQue> = {}): EntradaPorQue => ({
  rotulo: 'sex passada', umDia: true, dia: '2026-10-02', diaComparado: '2026-09-25',
  atual: { faturamento: 1000, pedidos: 30 }, anterior: { faturamento: 1410, pedidos: 39 },
  serieAtual: null, serieAnterior: null, horaCorte: null, ifood: null, fatos: fatosVazios(), agora: new Date('2026-10-03T12:00:00Z'),
  ...o,
});

describe('tituloVariacao', () => {
  it('diz o valor, a porcentagem e os pedidos', () => {
    expect(n(tituloVariacao(base()))).toBe('−R$ 410 (−29%) contra sex passada: 9 pedidos a menos');
    expect(n(tituloVariacao(base({ atual: { faturamento: 1500, pedidos: 40 }, anterior: { faturamento: 1400, pedidos: 39 } })))).toBe('+R$ 100 (+7%) contra sex passada: 1 pedido a mais');
  });
  it('quase igual não vira número', () => {
    expect(tituloVariacao(base({ atual: { faturamento: 1000.3, pedidos: 30 }, anterior: { faturamento: 1000, pedidos: 30 } }))).toBe('Praticamente igual a sex passada');
  });
});

describe('canal', () => {
  it('um canal que concentra a diferença é dito com a parte dele', () => {
    const fatos = fatosVazios();
    fatos.canais.atual = { cashier: { valor: 38, pedidos: 1 }, self_service: { valor: 900, pedidos: 28 } };
    fatos.canais.anterior = { cashier: { valor: 299, pedidos: 7 }, self_service: { valor: 1000, pedidos: 31 } };
    const r = explicarVariacao(base({ fatos, atual: { faturamento: 938, pedidos: 29 }, anterior: { faturamento: 1299, pedidos: 38 } }));
    const f = r.frases.find((x) => x.tipo === 'canal')!;
    expect(n(f.texto)).toContain('Balcão');
    expect(n(f.texto)).toContain('−R$ 261');
    expect(n(f.texto)).toContain('72%');
    expect(n(f.texto)).toContain('Autoatendimento −R$ 100');
  });

  it('iFood só entra quando os dois lados são conhecidos', () => {
    const fatos = fatosVazios();
    fatos.canais.atual = { cashier: { valor: 500, pedidos: 10 } };
    fatos.canais.anterior = { cashier: { valor: 500, pedidos: 10 } };
    const sem = explicarVariacao(base({ fatos, ifood: { atual: 300, anterior: null } }));
    expect(sem.frases.find((x) => x.tipo === 'canal')).toBeUndefined();
    expect(sem.lacunas).toContain('iFood do período comparado');
    const com = explicarVariacao(base({ fatos, ifood: { atual: 300, anterior: 700 } }));
    expect(n(com.frases.find((x) => x.tipo === 'canal')!.texto)).toBe('Só mudou o iFood: −R$ 400.');
  });
});

describe('hora', () => {
  it('acha a faixa que concentra a diferença e escreve com os dois valores', () => {
    // 18h-19h iguais; 20h e 21h perderam R$ 290 de R$ 410
    const serieAtual = { '18': 200, '19': 300, '20': 100, '21': 20, '22': 380 };
    const serieAnterior = { '18': 200, '19': 320, '20': 300, '21': 130, '22': 460 };
    const r = explicarVariacao(base({ serieAtual, serieAnterior, atual: { faturamento: 1000, pedidos: 30 }, anterior: { faturamento: 1410, pedidos: 39 } }));
    const f = r.frases.find((x) => x.tipo === 'hora')!;
    expect(n(f.texto)).toContain('Entre 20h e 22h');
    expect(n(f.texto)).toContain('R$ 120 contra R$ 430');
  });

  it('a hora parcial (agora) fica fora da comparação', () => {
    const serieAtual = { '18': 100, '19': 50 };
    const serieAnterior = { '18': 100, '19': 600 };
    const r = explicarVariacao(base({ serieAtual, serieAnterior, horaCorte: 19, atual: { faturamento: 150, pedidos: 5 }, anterior: { faturamento: 700, pedidos: 20 } }));
    expect(r.frases.find((x) => x.tipo === 'hora')).toBeUndefined(); // 18h igual: nada a explicar sem a hora parcial
  });

  it('diferença espalhada diz que está espalhada (não inventa hora)', () => {
    const serieAtual = { '18': 90, '19': 90, '20': 90, '21': 90, '22': 90, '23': 90 };
    const serieAnterior = { '18': 130, '19': 130, '20': 130, '21': 130, '22': 130, '23': 130 };
    const r = explicarVariacao(base({ serieAtual, serieAnterior, atual: { faturamento: 540, pedidos: 20 }, anterior: { faturamento: 780, pedidos: 30 } }));
    expect(r.frases.find((x) => x.tipo === 'hora')!.texto).toContain('espalhada');
  });

  it('vários dias: cita o dia que mais pesou, pareando por posição', () => {
    const r = explicarVariacao(base({
      umDia: false, rotulo: '7 dias anteriores', dia: '2026-09-28', diaComparado: '2026-09-21',
      serieAtual: { '2026-09-28': 1000, '2026-09-29': 400, '2026-09-30': 1000 },
      serieAnterior: { '2026-09-21': 1000, '2026-09-22': 1100, '2026-09-23': 1000 },
      atual: { faturamento: 2400, pedidos: 60 }, anterior: { faturamento: 3100, pedidos: 80 },
    }));
    const f = r.frases.find((x) => x.tipo === 'hora')!;
    expect(n(f.texto)).toContain('ter 29/09');
    expect(n(f.texto)).toContain('R$ 400 contra R$ 1.100');
  });
});

describe('abertura do caixa', () => {
  const ab = (hAtual: string, hAnt: string): FatosPorQue => ({
    ...fatosVazios(),
    aberturas: { atual: [{ dia: '2026-10-02', ini: `2026-10-02T${hAtual}:00Z` }], anterior: [{ dia: '2026-09-25', ini: `2026-09-25T${hAnt}:00Z` }] },
  });
  it('abriu mais tarde: diz os dois horários e a diferença', () => {
    const r = explicarVariacao(base({ fatos: ab('21:40', '20:50') })); // 18h40 e 17h50 em Brasília
    const f = r.frases.find((x) => x.tipo === 'abertura')!;
    expect(n(f.texto)).toContain('18h40');
    expect(n(f.texto)).toContain('17h50');
    expect(n(f.texto)).toContain('50 min mais tarde');
    expect(r.acheiCausa).toBe(true);
    expect(r.semCausa).toBeNull();
  });
  it('diferença pequena (menos de 30 min) não é causa', () => {
    const r = explicarVariacao(base({ fatos: ab('21:20', '21:00') }));
    expect(r.frases.find((x) => x.tipo === 'abertura')).toBeUndefined();
  });
  it('abrir mais cedo não explica queda', () => {
    const r = explicarVariacao(base({ fatos: ab('20:00', '21:40') }));
    expect(r.frases.find((x) => x.tipo === 'abertura')).toBeUndefined();
  });
  it('caixa ainda não aberto hoje, com o horário do comparado', () => {
    const fatos: FatosPorQue = { ...fatosVazios(), aberturas: { atual: [], anterior: [{ dia: '2026-09-25', ini: '2026-09-25T20:50:00Z' }] } };
    const r = explicarVariacao(base({ dia: '2026-10-03', fatos, agora: new Date('2026-10-03T12:00:00Z') }));
    expect(r.frases.find((x) => x.tipo === 'abertura')!.texto).toBe('O caixa ainda não foi aberto hoje; sex passada abriu às 17h50.');
  });
  it('vários dias: conta os dias com abertura mais tarde e os sem caixa', () => {
    const fatos: FatosPorQue = {
      ...fatosVazios(),
      aberturas: {
        atual: [{ dia: '2026-09-28', ini: '2026-09-28T17:30:00Z' }, { dia: '2026-09-30', ini: '2026-09-30T15:00:00Z' }],
        anterior: [{ dia: '2026-09-21', ini: '2026-09-21T15:00:00Z' }, { dia: '2026-09-22', ini: '2026-09-22T15:00:00Z' }, { dia: '2026-09-23', ini: '2026-09-23T15:00:00Z' }],
      },
    };
    const r = explicarVariacao(base({ umDia: false, rotulo: '7 dias anteriores', dia: '2026-09-28', diaComparado: '2026-09-21', fatos, agora: new Date('2026-10-05T12:00:00Z') }));
    const t = r.frases.find((x) => x.tipo === 'abertura')!.texto;
    expect(t).toContain('Sem caixa aberto em 29/09');
    expect(t).toContain('em 1 de 2 dias o caixa abriu mais tarde');
    expect(t).toContain('seg 28/09, 2h30');
  });
});

describe('pausa de item', () => {
  const pausa = (o: Partial<FatosPorQue['pausas'][number]> = {}) => ({
    item: '1 chope Vinho 500 ml', de: '2026-10-02T23:00:00Z', ate: '2026-10-03T01:40:00Z',
    pausou_em: '2026-10-02T23:00:00Z', retomou_em: '2026-10-03T01:40:00Z', minutos: 160, sem_retomada: false, vendeu_no_comparado: 3, ...o,
  });
  it('item pausado que vendeu no comparado vira frase com a faixa de horas', () => {
    const r = explicarVariacao(base({ fatos: { ...fatosVazios(), pausas: [pausa()] } }));
    const f = r.frases.find((x) => x.tipo === 'pausa')!;
    expect(n(f.texto)).toContain('1 chope Vinho 500 ml (de 20h00 a 22h40; vendeu 3 no mesmo trecho de sex passada)');
    expect(r.acheiCausa).toBe(true);
  });
  it('sem retomada registrada não inventa hora de volta', () => {
    const r = explicarVariacao(base({ fatos: { ...fatosVazios(), pausas: [pausa({ sem_retomada: true, retomou_em: null })] } }));
    expect(r.frases.find((x) => x.tipo === 'pausa')!.texto).toContain('desde 20h00, sem retomada registrada');
  });
  it('pausa curta ou de item que não vendeu não é causa', () => {
    const r = explicarVariacao(base({ fatos: { ...fatosVazios(), pausas: [pausa({ minutos: 10 }), pausa({ item: 'Teste', vendeu_no_comparado: 0 })] } }));
    expect(r.frases.find((x) => x.tipo === 'pausa')).toBeUndefined();
  });
});

describe('sem causa registrada', () => {
  it('diz que não achou a causa, em vez de inventar', () => {
    const fatos = fatosVazios();
    fatos.canais.atual = { cashier: { valor: 1000, pedidos: 30 } };
    fatos.canais.anterior = { cashier: { valor: 1410, pedidos: 39 } };
    const r = explicarVariacao(base({ fatos }));
    expect(r.acheiCausa).toBe(false);
    expect(r.semCausa).toContain('Não achei a causa nos registros');
    expect(r.frases.length).toBeLessThanOrEqual(4);
  });
  it('se a consulta dos fatos falhou, avisa a lacuna e não afirma que "não há causa"', () => {
    const r = explicarVariacao(base({ fatos: null }));
    expect(r.semCausa).toBeNull();
    expect(r.lacunas[0]).toContain('itens pausados');
  });
  it('nunca passa de 4 frases', () => {
    const fatos: FatosPorQue = {
      canais: { atual: { cashier: { valor: 100, pedidos: 1 }, self_service: { valor: 900, pedidos: 20 } }, anterior: { cashier: { valor: 400, pedidos: 9 }, self_service: { valor: 1010, pedidos: 30 } } },
      aberturas: { atual: [{ dia: '2026-10-02', ini: '2026-10-02T21:40:00Z' }], anterior: [{ dia: '2026-09-25', ini: '2026-09-25T20:50:00Z' }] },
      pausas: [{ item: 'X', de: '2026-10-02T23:00:00Z', ate: '2026-10-03T01:00:00Z', pausou_em: '2026-10-02T23:00:00Z', retomou_em: null, minutos: 120, sem_retomada: true, vendeu_no_comparado: 2 }],
    };
    const r = explicarVariacao(base({ fatos, serieAtual: { '20': 10, '21': 10 }, serieAnterior: { '20': 200, '21': 200 } }));
    expect(r.frases.length).toBeLessThanOrEqual(4);
    expect(r.frases.map((f) => f.tipo)).toEqual(['canal', 'hora', 'abertura', 'pausa']);
  });
});
