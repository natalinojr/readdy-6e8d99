import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consultarMembroClube, cpfElegivelAoConvite, LIMITE_CONSULTA_CLUBE_MS } from '@/lib/conviteClubeKiosk';

describe('cpfElegivelAoConvite', () => {
  it('aceita CPF válido de 11 dígitos', () => {
    expect(cpfElegivelAoConvite('52998224725')).toBe(true);
  });
  it('recusa CPF inválido, incompleto e repetido', () => {
    expect(cpfElegivelAoConvite('52998224724')).toBe(false);
    expect(cpfElegivelAoConvite('529982247')).toBe(false);
    expect(cpfElegivelAoConvite('11111111111')).toBe(false);
  });
  it('recusa CNPJ (14 dígitos)', () => {
    expect(cpfElegivelAoConvite('11222333000181')).toBe(false);
  });
});

describe('consultarMembroClube', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('já é membro → "membro"', async () => {
    const r = await consultarMembroClube(async () => ({ data: { ativo: true, encontrado: true }, error: null }));
    expect(r).toBe('membro');
  });

  it('não é membro → "nao_membro"', async () => {
    const r = await consultarMembroClube(async () => ({ data: { ativo: true, encontrado: false }, error: null }));
    expect(r).toBe('nao_membro');
  });

  it('erro de rede ou do servidor → "erro" (segue sem convite)', async () => {
    expect(await consultarMembroClube(async () => ({ data: null, error: new Error('Failed to fetch') }))).toBe('erro');
    expect(await consultarMembroClube(async () => ({ data: { error: 'CPF inválido' }, error: null }))).toBe('erro');
    expect(await consultarMembroClube(async () => ({ data: null, error: null }))).toBe('erro');
  });

  it('exceção ao chamar → "erro", nunca lança', async () => {
    const r = await consultarMembroClube(async () => { throw new Error('boom'); });
    expect(r).toBe('erro');
  });

  it('programa desligado no meio do pedido → "erro" (não convida)', async () => {
    const r = await consultarMembroClube(async () => ({ data: { ativo: false }, error: null }));
    expect(r).toBe('erro');
  });

  it('sem internet → "erro" sem nem chamar o servidor', async () => {
    const buscar = vi.fn(async () => ({ data: { ativo: true, encontrado: false }, error: null }));
    const r = await consultarMembroClube(buscar, { online: false });
    expect(r).toBe('erro');
    expect(buscar).not.toHaveBeenCalled();
  });

  it('servidor lento: passou do limite → "erro" (não trava o pedido)', async () => {
    const lento = () => new Promise<{ data: { ativo: boolean; encontrado: boolean }; error: null }>((resolve) => {
      setTimeout(() => resolve({ data: { ativo: true, encontrado: false }, error: null }), 60_000);
    });
    const promessa = consultarMembroClube(lento);
    await vi.advanceTimersByTimeAsync(LIMITE_CONSULTA_CLUBE_MS);
    expect(await promessa).toBe('erro');
  });

  it('resposta antes do limite vale mesmo com limite curto configurado', async () => {
    const promessa = consultarMembroClube(
      () => new Promise((resolve) => { setTimeout(() => resolve({ data: { ativo: true, encontrado: false }, error: null }), 500); }),
      { limiteMs: 1000 },
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(await promessa).toBe('nao_membro');
  });
});
