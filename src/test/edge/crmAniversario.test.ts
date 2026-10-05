// @vitest-environment node
// crm-funnel/aniversario.ts — janela de aniversariantes (hoje até +6 dias, calendário de Brasília).
// Os casos de borda são os que quebram em silêncio: virada de ano, 29/02 e o fuso (o servidor roda em UTC).
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import por caminho montado em tempo de execução: o tsc do app não passa a checar código Deno.
const ANIV_PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/crm-funnel/aniversario.ts')).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let A: Any;
beforeAll(async () => { A = await import(/* @vite-ignore */ ANIV_PATH); });

const hoje = (y: number, m: number, d: number) => ({ y, m, d });

describe('proximoAniversario', () => {
  it('hoje = 0 dias', () => {
    const p = A.proximoAniversario('1990-10-05', hoje(2026, 10, 5));
    expect(p.dias).toBe(0);
    expect(p.data).toBe('2026-10-05');
    expect(p.dd_mm).toBe('05/10');
  });

  it('daqui a 6 dias entra, daqui a 7 não', () => {
    expect(A.naJanela(A.proximoAniversario('1990-10-11', hoje(2026, 10, 5)))).toBe(true);
    expect(A.proximoAniversario('1990-10-11', hoje(2026, 10, 5)).dias).toBe(6);
    expect(A.naJanela(A.proximoAniversario('1990-10-12', hoje(2026, 10, 5)))).toBe(false);
  });

  it('ontem não entra (o próximo é só no ano que vem)', () => {
    const p = A.proximoAniversario('1990-10-04', hoje(2026, 10, 5));
    expect(A.naJanela(p)).toBe(false);
    expect(p.ano).toBe(2027);
  });

  it('vira o ano: em 30/12 quem faz aniversário em 02/01 entra, com ano seguinte', () => {
    const p = A.proximoAniversario('1985-01-02', hoje(2026, 12, 30));
    expect(p.dias).toBe(3);
    expect(p.ano).toBe(2027);
    expect(p.data).toBe('2027-01-02');
    expect(A.naJanela(p)).toBe(true);
  });

  it('31/12 em 31/12 é hoje; 05/01 em 31/12 é 5 dias', () => {
    expect(A.proximoAniversario('2000-12-31', hoje(2026, 12, 31)).dias).toBe(0);
    expect(A.proximoAniversario('2000-01-05', hoje(2026, 12, 31)).dias).toBe(5);
  });

  it('29/02: comemora em 28/02 nos anos não bissextos e em 29/02 nos bissextos', () => {
    // 2026 não é bissexto
    const nao = A.proximoAniversario('2000-02-29', hoje(2026, 2, 25));
    expect(nao.data).toBe('2026-02-28');
    expect(nao.dd_mm).toBe('28/02');
    expect(nao.dias).toBe(3);
    // 2028 é bissexto
    const sim = A.proximoAniversario('2000-02-29', hoje(2028, 2, 25));
    expect(sim.data).toBe('2028-02-29');
    expect(sim.dias).toBe(4);
  });

  it('29/02 depois de 28/02 num ano não bissexto: o próximo é só no ano seguinte', () => {
    const p = A.proximoAniversario('2000-02-29', hoje(2027, 3, 1));
    expect(A.naJanela(p)).toBe(false);
    expect(p.ano).toBe(2028);
    expect(p.data).toBe('2028-02-29');
  });

  it('29/02 numa virada de ano: 28/12 para um aniversário em 28/02 não entra', () => {
    expect(A.naJanela(A.proximoAniversario('2000-02-29', hoje(2026, 12, 28)))).toBe(false);
  });

  it('data ausente ou inválida devolve null', () => {
    expect(A.proximoAniversario(null, hoje(2026, 10, 5))).toBeNull();
    expect(A.proximoAniversario('', hoje(2026, 10, 5))).toBeNull();
    expect(A.proximoAniversario('1990-13-01', hoje(2026, 10, 5))).toBeNull();
    expect(A.proximoAniversario('abc', hoje(2026, 10, 5))).toBeNull();
  });

  it('aceita timestamp com hora (só a data conta)', () => {
    expect(A.proximoAniversario('1990-10-06T00:00:00+00:00', hoje(2026, 10, 5)).dias).toBe(1);
  });
});

describe('hojeBrasilia', () => {
  it('21h30 de Brasília (já é o dia seguinte em UTC) ainda é o dia local', () => {
    // 2026-10-06T00:30Z = 2026-10-05 21:30 em Brasília
    expect(A.hojeBrasilia(new Date('2026-10-06T00:30:00Z'))).toEqual({ y: 2026, m: 10, d: 5 });
  });

  it('virada do ano em Brasília', () => {
    // 2027-01-01T02:00Z = 2026-12-31 23:00 em Brasília
    expect(A.hojeBrasilia(new Date('2027-01-01T02:00:00Z'))).toEqual({ y: 2026, m: 12, d: 31 });
    expect(A.hojeBrasilia(new Date('2027-01-01T03:00:00Z'))).toEqual({ y: 2027, m: 1, d: 1 });
  });
});

describe('notaVoucherAniversario', () => {
  it('é o mesmo texto que o gerador grava em vouchers.notes', () => {
    expect(A.notaVoucherAniversario(2026)).toBe('Aniversário 2026');
  });
});
