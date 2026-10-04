import { describe, it, expect } from 'vitest';
import {
  intervaloDoPreset, validarPeriodo, diasEntre, dividirPeriodo, tendenciaDe, duraInfo, celulaCsv, montarCsv,
} from '../../lib/consumoInsumos';

const ms = (d: string) => Date.parse(`${d}T00:00:00-03:00`);

describe('intervaloDoPreset', () => {
  it('7 e 30 dias contam hoje; este mês começa no dia 1', () => {
    expect(intervaloDoPreset('7d', '2026-10-04')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(intervaloDoPreset('30d', '2026-10-04')).toEqual({ from: '2026-09-05', to: '2026-10-04' });
    expect(intervaloDoPreset('mes', '2026-10-04')).toEqual({ from: '2026-10-01', to: '2026-10-04' });
  });
});

describe('validarPeriodo', () => {
  const hoje = '2026-10-04';
  it('aceita um período normal e um dia só', () => {
    expect(validarPeriodo('2026-09-01', '2026-10-04', hoje)).toBe(null);
    expect(validarPeriodo('2026-10-04', '2026-10-04', hoje)).toBe(null);
  });
  it('recusa início depois do fim, fim depois de hoje e data vazia', () => {
    expect(validarPeriodo('2026-09-10', '2026-09-01', hoje)).toMatch(/inicial/);
    expect(validarPeriodo('2026-09-01', '2026-10-05', hoje)).toMatch(/hoje/);
    expect(validarPeriodo('', '2026-10-04', hoje)).toMatch(/Escolha/);
  });
});

describe('diasEntre', () => {
  it('conta os dois lados e atravessa virada de mês', () => {
    expect(diasEntre('2026-10-04', '2026-10-04')).toBe(1);
    expect(diasEntre('2026-09-28', '2026-10-04')).toBe(7);
    expect(diasEntre('2026-09-05', '2026-10-04')).toBe(30);
  });
});

describe('dividirPeriodo', () => {
  it('período passado: duas metades iguais, coladas', () => {
    const d = dividirPeriodo('2026-09-01', '2026-09-10', '2026-10-04')!;
    expect(d.fimPrimeiraMs).toBe(ms('2026-09-06')); // 1ª metade = dias 1..5
    expect(d.inicioSegundaMs).toBe(ms('2026-09-06')); // 2ª metade = dias 6..10
    expect(d.fimSegundaMs).toBe(ms('2026-09-11'));
  });

  it('número ímpar de dias: o dia do meio fica de fora', () => {
    const d = dividirPeriodo('2026-09-01', '2026-09-07', '2026-10-04')!;
    expect(d.fimPrimeiraMs).toBe(ms('2026-09-04')); // dias 1..3
    expect(d.inicioSegundaMs).toBe(ms('2026-09-05')); // dias 5..7 (o 4 fica de fora)
  });

  it('período que termina hoje não usa o dia de hoje (ainda incompleto)', () => {
    const d = dividirPeriodo('2026-09-28', '2026-10-04', '2026-10-04')!; // 7 dias: compara 28..30 com 01..03
    expect(d.fimPrimeiraMs).toBe(ms('2026-10-01'));
    expect(d.inicioSegundaMs).toBe(ms('2026-10-01'));
    expect(d.fimSegundaMs).toBe(ms('2026-10-04'));
  });

  it('poucos dias: não compara', () => {
    expect(dividirPeriodo('2026-09-01', '2026-09-03', '2026-10-04')).toBe(null);
    expect(dividirPeriodo('2026-10-04', '2026-10-04', '2026-10-04')).toBe(null);
    expect(dividirPeriodo('2026-10-02', '2026-10-04', '2026-10-04')).toBe(null);
  });
});

describe('tendenciaDe', () => {
  it('mais de 20% para cima ou para baixo', () => {
    expect(tendenciaDe(100, 121)).toBe('subindo');
    expect(tendenciaDe(100, 79)).toBe('caindo');
    expect(tendenciaDe(100, 110)).toBe('estavel');
    expect(tendenciaDe(100, 100)).toBe('estavel');
  });
  it('sem saída na 1ª metade não há com o que comparar', () => {
    expect(tendenciaDe(0, 50)).toBe(null);
    expect(tendenciaDe(0, 0)).toBe(null);
  });
});

describe('duraInfo', () => {
  const base = { acompanha: true, esgotado: false, abaixoMinimo: false, vaiFaltar: false };
  it('mostra os dias inteiros e a cor pelo risco', () => {
    expect(duraInfo({ ...base, diasRestantes: 58.4 })).toEqual({ curto: '58 dias', longo: 'dura 58 dias', tom: 'green' });
    expect(duraInfo({ ...base, diasRestantes: 1.9 })).toEqual({ curto: '1 dia', longo: 'dura 1 dia', tom: 'red' });
    expect(duraInfo({ ...base, diasRestantes: 5, vaiFaltar: true })?.tom).toBe('amber');
    expect(duraInfo({ ...base, diasRestantes: 20, abaixoMinimo: true })?.tom).toBe('amber');
    expect(duraInfo({ ...base, diasRestantes: 0.3 })?.longo).toBe('dura menos de 1 dia');
    expect(duraInfo({ ...base, diasRestantes: 900 })?.longo).toBe('dura mais de 1 ano');
  });
  it('zerado, sem previsão e sem controle de estoque', () => {
    expect(duraInfo({ ...base, esgotado: true, diasRestantes: 0 })).toEqual({ curto: 'zerado', longo: 'zerado', tom: 'red' });
    expect(duraInfo({ ...base, diasRestantes: null })?.longo).toBe('sem previsão de duração');
    expect(duraInfo({ ...base, acompanha: false, diasRestantes: 10 })).toBe(null);
  });
});

describe('CSV', () => {
  it('texto entre aspas (aspas dobradas) e número com vírgula decimal', () => {
    expect(celulaCsv('Molho "da casa"')).toBe('"Molho ""da casa"""');
    expect(celulaCsv(12.5)).toBe('12,5');
    expect(celulaCsv(0.12345678)).toBe('0,1235');
    expect(celulaCsv(-3)).toBe('-3');
    expect(celulaCsv(null)).toBe('');
    expect(celulaCsv(NaN)).toBe('');
  });
  it('neutraliza começo de fórmula', () => {
    expect(celulaCsv('=SOMA(A1)')).toBe(`"'=SOMA(A1)"`);
    expect(celulaCsv('-Café')).toBe(`"'-Café"`);
  });
  it('monta com ponto e vírgula e quebra de linha do Windows', () => {
    expect(montarCsv(['Insumo', 'Custo'], [['Mussarela; fatiada', 361.5], ['Bacon', 296]]))
      .toBe('"Insumo";"Custo"\r\n"Mussarela; fatiada";361,5\r\n"Bacon";296');
  });
});
