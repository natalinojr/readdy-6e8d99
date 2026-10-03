// Avisar antes de virar problema (2026-10-03): regras puras dos três avisos do assistente-cron
// (vendas abaixo do ritmo, caixa da semana, insumo antes do pico). Números tirados da Paranaguá de 03/10.
import { describe, it, expect } from 'vitest';
import {
  avaliarRitmo, canalQueMaisCaiu, textoRitmo, caixaDaSemana, textoCaixa, quandoFalta, previsaoPico, acabamAntesDoPico,
  textoPico, fmtQtd, janelaAtual, podeAvisarNoCelular, horaTexto, horaOperacao, diaOperacao, type PicoCelula,
} from '../../../supabase/functions/_shared/previsao';
import { pendenciaVisivelPara } from '../../../supabase/functions/_shared/pendencia-visivel';
import { organizarHoje, type PendHoje } from '@/pages/hoje/organizar';

const HOJE = '2026-10-03'; // sábado

describe('janelaAtual', () => {
  it('dispara entre o início e 2 h depois', () => {
    expect(janelaAtual(['15:00', '19:00'], '14:59')).toBeNull();
    expect(janelaAtual(['15:00', '19:00'], '15:00')).toBe('15:00');
    expect(janelaAtual(['15:00', '19:00'], '16:55')).toBe('15:00');
    expect(janelaAtual(['15:00', '19:00'], '17:00')).toBeNull();
    expect(janelaAtual(['15:00', '19:00'], '19:30')).toBe('19:00');
  });
  it('hora no texto', () => {
    expect(horaTexto('15:00')).toBe('15h');
    expect(horaTexto('19:40')).toBe('19h40');
  });
  it('celular só de dia', () => {
    expect(podeAvisarNoCelular('07:59')).toBe(false);
    expect(podeAvisarNoCelular('15:00')).toBe(true);
    expect(podeAvisarNoCelular('23:00')).toBe(false);
  });
});

describe('avaliarRitmo (mesma régua do Dashboard)', () => {
  it('mais de 15 pontos abaixo = abaixo do ritmo', () => {
    // meta 2.333, costuma entrar 60% até as 15h → esperado 1.400; vendeu 820 (35%) → −25 pts
    const r = avaliarRitmo(820, 2333, 0.6, 4)!;
    expect(Math.round(r.esperado)).toBe(1400);
    expect(r.pts).toBeCloseTo(-24.85, 1);
    expect(r.abaixo).toBe(true);
    expect(r.noRitmo).toBe(false);
  });
  it('entre 5 e 15 pontos abaixo: "um pouco abaixo" — nem abre nem fecha', () => {
    const r = avaliarRitmo(1150, 2333, 0.6, 4)!; // ~49% → −11 pts
    expect(r.abaixo).toBe(false);
    expect(r.noRitmo).toBe(false);
  });
  it('até 5 pontos abaixo ou meta batida = no ritmo', () => {
    expect(avaliarRitmo(1300, 2333, 0.6, 4)!.noRitmo).toBe(true);
    expect(avaliarRitmo(2400, 2333, 0.6, 4)!.noRitmo).toBe(true);
    expect(avaliarRitmo(2400, 2333, 0.6, 4)!.abaixo).toBe(false);
  });
  it('sem régua: sem meta, histórico curto ou movimento que nem começou', () => {
    expect(avaliarRitmo(0, 0, 0.6, 4)).toBeNull();
    expect(avaliarRitmo(0, 2333, 0.6, 1)).toBeNull();
    expect(avaliarRitmo(0, 2333, null, 4)).toBeNull();
    expect(avaliarRitmo(0, 2333, 0.02, 4)).toBeNull();
  });
});

describe('canalQueMaisCaiu', () => {
  it('pega a maior queda em reais × semana passada', () => {
    expect(canalQueMaisCaiu({ cashier: 500, ifood: 0 }, { cashier: 600, ifood: 380 })).toEqual({ canal: 'ifood', nome: 'iFood', hoje: 0, antes: 380 });
  });
  it('queda pequena (menos de 30% ou de R$ 50) não conta', () => {
    expect(canalQueMaisCaiu({ cashier: 560 }, { cashier: 600 })).toBeNull();
    expect(canalQueMaisCaiu({ delivery: 0 }, { delivery: 40 })).toBeNull();
  });
});

describe('textoRitmo', () => {
  it('diz quanto vendeu, o esperado, a meta e o canal que caiu', () => {
    const r = avaliarRitmo(820, 2333, 0.6, 4)!;
    const t = textoRitmo({ loja: 'El Patron Paranaguá', hora: '15h', valor: 820, meta: 2333, hoje: HOJE, r, canal: canalQueMaisCaiu({ ifood: 0 }, { ifood: 380 }) });
    expect(t.titulo).toBe('Vendas abaixo do ritmo: R$ 820 até as 15h (esperado R$ 1.400)');
    expect(t.detalhe).toBe('Meta de sábado: R$ 2.333. Até esta hora costuma entrar 60% do dia. O que mais caiu: iFood, R$ 0 (sábado passado R$ 380 até esta hora).');
    expect(t.push).toContain('Mais queda no iFood');
    expect(t.chat).toMatch(/^📉 \*El Patron Paranaguá\*/);
  });
  it('segunda passada (feminino) e sem canal', () => {
    const r = avaliarRitmo(100, 1000, 0.5, 4)!;
    const t = textoRitmo({ loja: 'X', hora: '19h', valor: 100, meta: 1000, hoje: '2026-10-05', r, canal: canalQueMaisCaiu({ cashier: 0 }, { cashier: 200 }) });
    expect(t.detalhe).toContain('segunda passada');
    const s = textoRitmo({ loja: 'X', hora: '19h', valor: 100, meta: 1000, hoje: '2026-10-05', r, canal: null });
    expect(s.detalhe).toBe('Meta de segunda: R$ 1.000. Até esta hora costuma entrar 50% do dia.');
  });
});

describe('caixaDaSemana (regra do Financeiro › Painel)', () => {
  const contas = [
    { nome: 'OESA', valor: 2450.34, vencimento: '2026-09-30' },
    { nome: 'Ambev', valor: 3000, vencimento: '2026-10-06' },
    { nome: 'Aluguel', valor: 3444.62, vencimento: '2026-10-10' },
    { nome: 'Fora da semana', valor: 9999, vencimento: '2026-10-11' },
  ];
  it('Paranaguá 03/10: R$ 7.297,94 no banco × R$ 8.894,96 → faltam R$ 1.597,02 a partir de sáb 10/10', () => {
    const c = caixaDaSemana(7297.94, contas, HOJE);
    expect(c.vencidas).toBeCloseTo(2450.34, 2);
    expect(c.semana).toBeCloseTo(6444.62, 2);
    expect(c.falta).toBe(1597.02);
    expect(c.cobre).toBe(false);
    expect(c.faltaEm).toBe('2026-10-10');
    expect(c.primeiras.map((x) => x.nome)).toEqual(['OESA', 'Ambev', 'Aluguel']);
  });
  it('cobre (centavos não contam)', () => {
    expect(caixaDaSemana(8894.5, contas, HOJE).cobre).toBe(true);
    expect(caixaDaSemana(20000, contas, HOJE).faltaEm).toBeNull();
  });
  it('vencidas maiores que o saldo: falta desde hoje', () => {
    const c = caixaDaSemana(1000, contas, HOJE);
    expect(c.faltaEm).toBe(HOJE);
    expect(textoCaixa({ loja: 'P', c, hoje: HOJE }).titulo).toMatch(/^O banco não cobre nem as contas vencidas — R\$/);
  });
  it('texto: quanto falta, quando e o que vence primeiro', () => {
    const t = textoCaixa({ loja: 'El Patron Paranaguá', c: caixaDaSemana(7297.94, contas, HOJE), hoje: HOJE });
    expect(t.titulo).toBe('O banco não cobre as contas da semana — R$ 1.597,02');
    expect(t.detalhe).toContain('Faltam R$ 1.597,02, a partir de sábado (10/10).');
    expect(t.detalhe).toContain('Vence primeiro: OESA R$ 2.450,34 (venceu 30/09)');
  });
  it('quandoFalta', () => {
    expect(quandoFalta(HOJE, HOJE)).toBe('hoje');
    expect(quandoFalta('2026-10-04', HOJE)).toBe('amanhã');
    expect(quandoFalta('2026-10-06', HOJE)).toBe('terça (06/10)');
  });
});

describe('previsaoPico', () => {
  // sábado (6): almoço 12–14h, pico 20h; 0,5 pedido à 1h da madrugada de domingo = ainda sábado
  const pico: PicoCelula[] = [
    { d: 6, h: 12, p: 1 }, { d: 6, h: 13, p: 1 }, { d: 6, h: 19, p: 1.5 }, { d: 6, h: 20, p: 2 }, { d: 6, h: 21, p: 1 }, { d: 6, h: 1, p: 0.5 },
    { d: 1, h: 20, p: 1 }, { d: 1, h: 12, p: 1 },
  ];
  it('pico = hora com mais pedidos; conta de agora até o fim do pico', () => {
    const p = previsaoPico(pico, 6, 10)!;
    expect(p.horaPico).toBe(20);
    expect(p.pedidosAtePico).toBe(5.5);
    expect(p.pedidosPorDia).toBeCloseTo(9 / 7, 5);
  });
  it('depois do pico não há o que prever; dia sem movimento = null', () => {
    expect(previsaoPico(pico, 6, 21)!.pedidosAtePico).toBe(0);
    expect(previsaoPico(pico, 3, 10)).toBeNull();
  });
  it('empate fica com o mais tarde', () => {
    expect(previsaoPico([{ d: 5, h: 19, p: 2 }, { d: 5, h: 20, p: 2 }], 5, 10)!.horaPico).toBe(20);
  });
  it('dia de operação começa às 6h', () => {
    expect(horaOperacao(6)).toBe(0);
    expect(horaOperacao(1)).toBe(19);
    expect(diaOperacao(new Date('2026-10-04T04:00:00Z'))).toBe(6); // domingo 1h de Brasília = noite de sábado
    expect(diaOperacao(new Date('2026-10-04T13:00:00Z'))).toBe(0);
  });
});

describe('acabamAntesDoPico (uso real × pico de hoje)', () => {
  const p = { horaPico: 20, pedidosAtePico: 5.5, pedidosPorDia: 9 / 7 }; // sábado pede 4,28 dias "médios" até as 20h
  const ins = (o: Partial<{ nome: string; estoque: number; consumoDia: number | null; acompanha: boolean; unidade: string }>) =>
    ({ id: o.nome ?? 'x', nome: 'x', unidade: 'kg', estoque: 1, consumoDia: 0.3, acompanha: true, ...o });
  it('falta quem não chega ao fim do pico; o mais apertado primeiro', () => {
    const f = acabamAntesDoPico([
      ins({ nome: 'Guacamole', estoque: 0.4, consumoDia: 0.3 }), // precisa 1,28
      ins({ nome: 'Cheddar', estoque: 1, consumoDia: 0.3 }),
      ins({ nome: 'Sobra', estoque: 5, consumoDia: 0.3 }),
    ], p);
    expect(f.map((x) => x.nome)).toEqual(['Guacamole', 'Cheddar']);
    expect(f[0].precisa).toBeCloseTo(1.283, 2);
  });
  it('fora: sem aviso, sem uso, zerado/negativo (é "esgotado/conferir") e pico que já passou', () => {
    expect(acabamAntesDoPico([ins({ acompanha: false, estoque: 0.1 })], p)).toEqual([]);
    expect(acabamAntesDoPico([ins({ consumoDia: null, estoque: 0.1 })], p)).toEqual([]);
    expect(acabamAntesDoPico([ins({ estoque: 0 }), ins({ estoque: -21.7 })], p)).toEqual([]);
    expect(acabamAntesDoPico([ins({ estoque: 0.1 })], { ...p, pedidosAtePico: 0 })).toEqual([]);
  });
  it('texto do aviso', () => {
    const f = acabamAntesDoPico([ins({ nome: 'Guacamole', estoque: 0.4 }), ins({ nome: 'Arroz', unidade: 'g', estoque: 900, consumoDia: 430 })], p);
    const t = textoPico({ loja: 'El Patron Paranaguá', faltando: f, horaPico: 20 });
    expect(t.titulo).toBe('2 insumos acabam antes do pico das 20h');
    expect(t.detalhe).toBe('Guacamole: tem 0,4 kg, precisa de ~1,28 kg; Arroz: tem 900 g, precisa de ~1,8 kg. Pelo uso dos últimos 14 dias. Compre ou produza antes do movimento.');
    expect(textoPico({ loja: 'P', faltando: f.slice(0, 1), horaPico: 20 }).titulo).toBe('Guacamole acaba antes do pico das 20h');
  });
  it('fmtQtd', () => {
    expect(fmtQtd(1250, 'g')).toBe('1,3 kg');
    expect(fmtQtd(350, 'ml')).toBe('350 ml');
    expect(fmtQtd(3, 'unit')).toBe('3 un');
    expect(fmtQtd(0.4, 'kg')).toBe('0,4 kg');
  });
});

describe('quem vê e onde cai na Hoje', () => {
  it('vendas: só quem vê o Dashboard (admin e gerente)', () => {
    expect(pendenciaVisivelPara('vendas_abaixo_ritmo', 'admin')).toBe(true);
    expect(pendenciaVisivelPara('vendas_abaixo_ritmo', 'gerente')).toBe(true);
    expect(pendenciaVisivelPara('vendas_abaixo_ritmo', 'supervisao')).toBe(false);
    expect(pendenciaVisivelPara('vendas_abaixo_ritmo', 'financeiro')).toBe(false);
  });
  it('caixa: dinheiro (admin, gerente, financeiro)', () => {
    expect(pendenciaVisivelPara('caixa_nao_cobre', 'financeiro')).toBe(true);
    expect(pendenciaVisivelPara('caixa_nao_cobre', 'supervisao')).toBe(false);
  });
  it('insumo: operacional (supervisão vê)', () => {
    expect(pendenciaVisivelPara('insumo_antes_do_pico', 'supervisao')).toBe(true);
    expect(pendenciaVisivelPara('insumo_antes_do_pico', 'caixa')).toBe(true);
  });
  it('os três caem em "Agora"; vendas e insumo valem para hoje, o caixa pelo dia em que falta', () => {
    const base = { tenantId: 'par', loja: 'P', ref: HOJE, detalhe: null, rota: null, urgencia: 'normal' as const, acaoRequerida: true, status: 'aberta', criadaEm: '2026-10-03T18:00:00Z' };
    const itens = organizarHoje([
      { ...base, id: 'c', kind: 'caixa_nao_cobre', titulo: 'O banco não cobre as contas da semana — R$ 1.597,02', payload: { valor: 1597.02, vencimento: '10/10', vencida: false } },
      { ...base, id: 'v', kind: 'vendas_abaixo_ritmo', titulo: 'Vendas abaixo do ritmo', payload: null },
      { ...base, id: 'i', kind: 'insumo_antes_do_pico', titulo: 'Guacamole acaba antes do pico das 20h', payload: null },
      { ...base, id: 'z', kind: 'conta_sem_dre', titulo: 'x', payload: null },
    ] as PendHoje[], HOJE);
    const agora = itens.filter((i) => i.bloco === 'agora');
    expect(agora.map((i) => i.chave)).toEqual(['v', 'i', 'c']);
    expect(agora.find((i) => i.chave === 'c')!.prazo).toBe('2026-10-10');
  });
});
