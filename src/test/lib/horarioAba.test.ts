import { describe, it, expect } from 'vitest';
import {
  aplicarDia, aplicarModelo, apagarDataEspecial, apagarDatasPassadas, descData, fmtDuracao, intervalosDoDia, lacunaEntre, limparIntervalos,
  modeloAtual, problemasIntervalos, resumoHoje, salvarDataEspecial, segmentosTrilho, semanaVazia, separarDatas, sugerirOutro, tituloData,
  txtJanelas, janelasDoDia, type HorarioDelivery,
} from '../../pages/config-delivery/abas/horario/horarioUtil';
import { normalizarHorarioDelivery } from '../../../supabase/functions/_shared/horario-delivery';

// Brasília = UTC-3. 2026-10-04 é domingo; 2026-10-06 é terça.
const sp = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00-03:00`);

const ALMOCO_JANTAR = { enabled: true, intervals: [{ open: '11:00', close: '14:30' }, { open: '18:00', close: '23:00' }] };
const H: HorarioDelivery = {
  enabled: true,
  days: {
    '0': { enabled: true, intervals: [{ open: '18:00', close: '23:30' }] },
    '1': { enabled: false },
    '2': ALMOCO_JANTAR, '3': ALMOCO_JANTAR, '4': ALMOCO_JANTAR,
    '5': { enabled: true, intervals: [{ open: '11:00', close: '14:30' }, { open: '18:00', close: '00:30' }] },
    '6': { enabled: true, intervals: [{ open: '18:00', close: '00:30' }] },
  },
  exceptions: [
    { date: '2026-12-25', closed: true, label: 'Natal' },
    { date: '2026-12-31', intervals: [{ open: '18:00', close: '21:00' }], label: 'Réveillon' },
  ],
};

describe('horários de um dia', () => {
  it('lê a lista e o formato antigo (um open/close só)', () => {
    expect(intervalosDoDia(ALMOCO_JANTAR)).toHaveLength(2);
    expect(intervalosDoDia({ enabled: true, open: '18:00', close: '23:00' })).toEqual([{ open: '18:00', close: '23:00' }]);
    expect(intervalosDoDia({ enabled: false, open: '18:00', close: '23:00' })).toEqual([]);
    expect(intervalosDoDia(undefined)).toEqual([]);
  });

  it('limpa: descarta incompleto e começo = fim, ordena e escreve HH:MM', () => {
    expect(limparIntervalos([
      { open: '18:00', close: '23:00' }, { open: '', close: '12:00' }, { open: '10:00', close: '10:00' }, { open: '9:00', close: '14:30' },
    ])).toEqual([{ open: '09:00', close: '14:30' }, { open: '18:00', close: '23:00' }]);
  });

  it('mostra o vão entre dois horários, menos quando o 1º passa da meia-noite', () => {
    expect(lacunaEntre({ open: '11:00', close: '14:30' }, { open: '18:00', close: '23:00' })).toBe('Fechado das 14:30 às 18:00');
    expect(lacunaEntre({ open: '11:00', close: '14:30' }, { open: '14:30', close: '23:00' })).toBeNull();
    expect(lacunaEntre({ open: '18:00', close: '00:30' }, { open: '20:00', close: '23:00' })).toBeNull();
    expect(lacunaEntre({ open: '', close: '14:30' }, { open: '18:00', close: '23:00' })).toBeNull();
  });

  it('avisa de começo = fim, campo vazio e horários que se sobrepõem', () => {
    expect(problemasIntervalos([{ open: '11:00', close: '14:30' }, { open: '18:00', close: '23:00' }])).toEqual({ erro: null, aviso: null });
    expect(problemasIntervalos([{ open: '18:00', close: '18:00' }]).erro).toContain('18:00');
    expect(problemasIntervalos([{ open: '', close: '18:00' }]).erro).toContain('Preencha');
    const sob = problemasIntervalos([{ open: '11:00', close: '14:30' }, { open: '14:00', close: '18:00' }]);
    expect(sob.erro).toBeNull();
    expect(sob.aviso).toContain('se sobrepõem');
    // encostar não é sobrepor; passar da meia-noite conta até o fim + 24h
    expect(problemasIntervalos([{ open: '11:00', close: '14:00' }, { open: '14:00', close: '18:00' }]).aviso).toBeNull();
    expect(problemasIntervalos([{ open: '18:00', close: '01:00' }, { open: '20:00', close: '23:00' }]).aviso).not.toBeNull();
  });

  it('sugere o próximo horário depois do último', () => {
    expect(sugerirOutro([])).toEqual({ open: '18:00', close: '23:00' });
    expect(sugerirOutro([{ open: '11:00', close: '14:30' }])).toEqual({ open: '18:00', close: '23:00' });
    expect(sugerirOutro([{ open: '11:00', close: '17:00' }])).toEqual({ open: '18:00', close: '23:00' });
    expect(sugerirOutro([{ open: '11:00', close: '18:00' }])).toEqual({ open: '19:00', close: '22:00' });
    expect(sugerirOutro([{ open: '18:00', close: '00:30' }])).toEqual({ open: '18:00', close: '23:00' });
  });

  it('aplicar no dia: espelha open/close, copia para outros dias e dia ligado sem horário vira fechado', () => {
    const r = aplicarDia(H, [1, 3], true, [{ open: '18:00', close: '23:00' }, { open: '11:00', close: '14:30' }]);
    expect(r.days?.['1']).toMatchObject({ enabled: true, open: '11:00', close: '23:00' });
    expect(r.days?.['1'].intervals).toEqual([{ open: '11:00', close: '14:30' }, { open: '18:00', close: '23:00' }]);
    expect(r.days?.['3']).toEqual(r.days?.['1']);
    expect(r.days?.['2'].intervals).toEqual(ALMOCO_JANTAR.intervals); // os outros dias não mudam
    expect(txtJanelas(janelasDoDia(r.days?.['2']))).toBe('11:00–14:30 e 18:00–23:00');

    const vazio = aplicarDia(H, [0], true, [{ open: '10:00', close: '10:00' }]);
    expect(vazio.days?.['0'].enabled).toBe(false);

    const fechado = aplicarDia(H, [2], false, [{ open: '11:00', close: '14:30' }]);
    expect(fechado.days?.['2'].enabled).toBe(false);
    expect(janelasDoDia(fechado.days?.['2'])).toEqual([]);
  });

  it('tocar em Pronto sem mudar nada não cria mudança no que vai ser gravado', () => {
    // O que vai para o banco passa de novo por normalizarHorarioDelivery (config.paraSalvar), então é nele que se compara.
    const gravado = normalizarHorarioDelivery(H);
    for (const d of [0, 1, 2, 5, 6]) {
      const dia = gravado.days?.[String(d)];
      const r = aplicarDia(gravado, [d], janelasDoDia(dia).length > 0, intervalosDoDia(dia));
      expect(normalizarHorarioDelivery(r)).toEqual(normalizarHorarioDelivery(gravado));
    }
  });

  it('não mexe nas datas especiais nem no liga/desliga geral', () => {
    const r = aplicarDia(H, [1], true, [{ open: '18:00', close: '23:00' }]);
    expect(r.enabled).toBe(true);
    expect(r.exceptions).toHaveLength(2);
  });
});

describe('modelos de semana', () => {
  it('troca a semana toda e reconhece o modelo', () => {
    for (const id of ['jantar', 'almoco_jantar', 'dia_todo'] as const) {
      const r = aplicarModelo(H, id);
      expect(modeloAtual(r)).toBe(id);
      expect(r.exceptions).toHaveLength(2);
      expect(r.enabled).toBe(true);
    }
    expect(txtJanelas(janelasDoDia(aplicarModelo(H, 'jantar').days?.['4']))).toBe('18:00–23:00');
    expect(txtJanelas(janelasDoDia(aplicarModelo(H, 'dia_todo').days?.['1']))).toBe('11:00–23:00');
    expect(modeloAtual(H)).toBeNull();
  });

  it('semana vazia', () => {
    expect(semanaVazia(H)).toBe(false);
    expect(semanaVazia({ enabled: true, days: {} })).toBe(true);
  });
});

describe('barra do dia (6h às 6h)', () => {
  it('posiciona as faixas e deixa o horário que passa da meia-noite inteiro', () => {
    const [a, b] = segmentosTrilho(janelasDoDia(ALMOCO_JANTAR));
    expect(a.left).toBeCloseTo(20.83, 1);   // 11:00
    expect(a.width).toBeCloseTo(14.58, 1);  // 3h30
    expect(b.left).toBe(50);                // 18:00
    const [c] = segmentosTrilho(janelasDoDia(H.days?.['6']));
    expect(c.left).toBe(50);
    expect(c.left + c.width).toBeCloseTo(77.08, 1); // até 00:30
  });

  it('o que passa das 6h volta para o começo da barra', () => {
    const s = segmentosTrilho([{ o: 5 * 60, c: 7 * 60 }]);
    expect(s).toHaveLength(2);
    expect(s[0].left + s[0].width).toBeCloseTo(100, 3);
    expect(s[1].left).toBe(0);
  });
});

describe('datas especiais', () => {
  it('cria, troca de dia, apaga e mantém em ordem sem repetir o dia', () => {
    let h = salvarDataEspecial(H, null, { date: '2026-11-15', label: '  Feriado  ', fechado: true, ints: [] });
    expect(h.exceptions?.map((e) => e.date)).toEqual(['2026-11-15', '2026-12-25', '2026-12-31']);
    expect(h.exceptions?.[0]).toMatchObject({ closed: true, label: 'Feriado' });
    // muda o Natal de dia: o 25 some e o 24 aparece
    h = salvarDataEspecial(h, '2026-12-25', { date: '2026-12-24', label: 'Natal', fechado: true, ints: [] });
    expect(h.exceptions?.map((e) => e.date)).toEqual(['2026-11-15', '2026-12-24', '2026-12-31']);
    // cair em cima de um dia que já tem data especial troca a antiga
    h = salvarDataEspecial(h, null, { date: '2026-12-31', label: '', fechado: false, ints: [{ open: '19:00', close: '22:00' }] });
    expect(h.exceptions?.filter((e) => e.date === '2026-12-31')).toEqual([{ date: '2026-12-31', closed: false, intervals: [{ open: '19:00', close: '22:00' }] }]);
    h = apagarDataEspecial(h, '2026-11-15');
    expect(h.exceptions?.map((e) => e.date)).toEqual(['2026-12-24', '2026-12-31']);
  });

  it('"horário diferente" sem nenhum horário válido vira fechado o dia todo', () => {
    const h = salvarDataEspecial(H, null, { date: '2026-11-20', label: '', fechado: false, ints: [{ open: '10:00', close: '10:00' }] });
    expect(h.exceptions?.find((e) => e.date === '2026-11-20')).toMatchObject({ closed: true });
  });

  it('separa as próximas das passadas e apaga as passadas', () => {
    const base = { ...H, exceptions: [...(H.exceptions ?? []), { date: '2026-01-01', closed: true, label: 'Ano Novo' }, { date: '2026-10-04', closed: true }] };
    const { proximas, passadas } = separarDatas(base, '2026-10-04');
    expect(proximas.map((e) => e.date)).toEqual(['2026-10-04', '2026-12-25', '2026-12-31']);
    expect(passadas.map((e) => e.date)).toEqual(['2026-01-01']);
    expect(apagarDatasPassadas(base, '2026-10-04').exceptions).toHaveLength(3);
  });

  it('textos da lista', () => {
    const [natal, reveillon] = H.exceptions!;
    expect(tituloData(natal, '2026-10-04')).toBe('25/12 · Natal');
    expect(descData(natal)).toBe('Fechado o dia todo');
    expect(descData(reveillon)).toBe('Só 18:00 às 21:00');
    expect(tituloData({ date: '2026-12-25', closed: true }, '2026-10-04')).toBe('25/12 · sexta');
    expect(tituloData({ date: '2027-01-01', closed: true, label: 'Ano Novo' }, '2026-10-04')).toBe('01/01/2027 · Ano Novo');
    expect(descData({ date: '2026-12-31', intervals: [{ open: '11:00', close: '14:30' }, { open: '18:00', close: '23:00' }] })).toBe('Só 11:00 às 14:30 e 18:00 às 23:00');
  });
});

describe('cartão Hoje', () => {
  it('aberto agora: diz quando fecha', () => {
    const r = resumoHoje(H, sp('2026-10-04', '20:15'));
    expect(r.tom).toBe('ok');
    expect(r.titulo).toBe('Domingo: 18:00 às 23:30');
    expect(r.linhas[0]).toBe('Agora (20:15) está aberto e fecha em 3h15.');
    expect(r.linhas[1]).toContain('o delivery espera e abre quando o caixa abrir');
  });

  it('fechado entre dois horários: diz quando abre hoje', () => {
    const r = resumoHoje(H, sp('2026-10-06', '16:00'));
    expect(r.tom).toBe('neutro');
    expect(r.titulo).toBe('Terça: 11:00 às 14:30 e 18:00 às 23:00');
    expect(r.linhas[0]).toBe('Agora (16:00) está fechado; abre às 18:00.');
  });

  it('dia que não abre: diz a próxima abertura', () => {
    const r = resumoHoje(H, sp('2026-10-05', '19:00'));
    expect(r.titulo).toBe('Segunda: fechado');
    expect(r.linhas[0]).toBe('Hoje não abre; próxima abertura terça às 11:00.');
  });

  it('já passou do último horário do dia', () => {
    const r = resumoHoje(H, sp('2026-10-06', '23:40'));
    expect(r.linhas[0]).toBe('Agora (23:40) está fechado; hoje já acabou. Próxima abertura quarta às 11:00.');
  });

  it('madrugada dentro do horário de ontem', () => {
    const r = resumoHoje(H, sp('2026-10-10', '00:10'));
    expect(r.tom).toBe('ok');
    expect(r.linhas[0]).toBe('Agora (00:10) está aberto, pelo horário de ontem, e fecha em 20 min.');
  });

  it('horário desligado: só o botão do caixa vale', () => {
    const r = resumoHoje({ ...H, enabled: false }, sp('2026-10-04', '20:15'));
    expect(r.tom).toBe('neutro');
    expect(r.titulo).toBe('Domingo: 18:00 às 23:30');
    expect(r.linhas).toEqual(['O horário está desligado: o delivery abre e fecha só pelo botão do caixa.']);
  });

  it('data especial vale no lugar da semana', () => {
    const r = resumoHoje(H, sp('2026-12-25', '12:00'));
    expect(r.titulo).toBe('Sexta: fechado (Natal)');
    expect(r.linhas[0]).toBe('Hoje não abre; próxima abertura sábado às 18:00.');
  });

  it('formata a duração', () => {
    expect(fmtDuracao(195)).toBe('3h15');
    expect(fmtDuracao(60)).toBe('1h');
    expect(fmtDuracao(65)).toBe('1h05');
    expect(fmtDuracao(45)).toBe('45 min');
  });
});
