/**
 * Delivery (revisão 2026-10-05): número digitado ("6.50" não é 650), mudança fantasma nas formas de pagamento,
 * Salvar só com o que mudou, taxa das faixas em centavos e a janela única de "30 dias".
 * Código: src/pages/config-delivery/config.ts e ui.tsx.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CONFIG_VAZIA, MSG_SEM_CONEXAO, chavesMudadas, contarMudancas, fetchPtBr, inicioDosUltimos30Dias, mudancasParaSalvar,
  paraSalvar, type ConfigDelivery,
} from '../../pages/config-delivery/config';
import { deTexto } from '../../pages/config-delivery/ui';

const cfg = (p: Partial<ConfigDelivery> = {}): ConfigDelivery => ({ ...CONFIG_VAZIA, ...p });

describe('deTexto (campo de número)', () => {
  it('ponto em grupos de 3 dígitos é milhar', () => {
    expect(deTexto('1.250')).toBe(1250);
    expect(deTexto('1.250,00')).toBe(1250);
    expect(deTexto('12.345,6')).toBe(12345.6);
    expect(deTexto('1.234.567')).toBe(1234567);
  });

  it('fora disso o ponto é decimal ("6.50" não vira 650)', () => {
    expect(deTexto('6.50')).toBe(6.5);
    expect(deTexto('2.5')).toBe(2.5);
    expect(deTexto('0.5')).toBe(0.5);
    expect(deTexto('0.250')).toBe(0.25); // primeiro grupo com 0 não é milhar
    expect(deTexto('12.5')).toBe(12.5);
    expect(deTexto('3.')).toBe(3); // ainda digitando
  });

  it('vírgula é sempre o decimal', () => {
    expect(deTexto('1,5')).toBe(1.5);
    expect(deTexto('6,50')).toBe(6.5);
    expect(deTexto('1250,00')).toBe(1250);
    expect(deTexto(',5')).toBe(0.5);
  });

  it('vazio ou inválido vira 0', () => {
    expect(deTexto('')).toBe(0);
    expect(deTexto('1.2.3')).toBe(0);
    expect(deTexto(',')).toBe(0);
  });
});

describe('mudança fantasma nas formas de pagamento', () => {
  it('ligar e desligar uma forma que não existia não conta como mudança', () => {
    const salvo = cfg({ formasPagamento: {} });
    expect(contarMudancas(salvo, cfg({ formasPagamento: { dinheiro: false } }))).toBe(0);
    expect(contarMudancas(salvo, cfg({ formasPagamento: { dinheiro: true } }))).toBe(1);
  });

  it('forma "pelo app" sem chave vale como ligada: religar não conta, desligar conta', () => {
    const salvo = cfg({ formasPagamento: {} });
    expect(contarMudancas(salvo, cfg({ formasPagamento: { pix_online: true } }))).toBe(0);
    expect(contarMudancas(salvo, cfg({ formasPagamento: { pix_online: false } }))).toBe(1);
  });

  it('as outras chaves seguem contando uma vez cada', () => {
    const salvo = cfg();
    const novo = cfg({ cidade: 'Paranaguá', retiradaAtivo: false, pedidoMinimoAtivo: true, pedidoMinimoValor: 30 });
    expect(chavesMudadas(salvo, novo).sort()).toEqual(['delivery_city', 'pedido_minimo_ativo', 'pedido_minimo_valor', 'retirada_ativo'].sort());
    expect(contarMudancas(salvo, novo)).toBe(4);
  });
});

describe('Salvar manda só o que mudou', () => {
  it('uma chave mudada = uma chave no corpo, sem cidade', () => {
    const salvo = cfg({ cidade: 'Paranaguá' });
    const corpo = mudancasParaSalvar(salvo, cfg({ cidade: 'Paranaguá', retiradaAtivo: false }));
    expect(corpo).toEqual({ delivery_config: { retirada_ativo: false } });
    expect('delivery_city' in corpo).toBe(false);
  });

  it('a cidade só vai quando mudou (aparada)', () => {
    const corpo = mudancasParaSalvar(cfg({ cidade: 'Paranaguá' }), cfg({ cidade: '  Pontal do Paraná ' }));
    expect(corpo).toEqual({ delivery_city: 'Pontal do Paraná', delivery_config: {} });
  });

  it('as formas de pagamento vão inteiras quando mudam', () => {
    const salvo = cfg({ formasPagamento: { pix: true } });
    const corpo = mudancasParaSalvar(salvo, cfg({ formasPagamento: { pix: true, dinheiro: true } }));
    expect(corpo.delivery_config).toEqual({ formas_pagamento: { pix: true, dinheiro: true } });
  });

  it('sem mudança não manda nada', () => {
    const c = cfg({ cidade: 'X', faixas: [{ ate_km: 2, taxa: 6, tempo_max_min: 40 }] });
    expect(mudancasParaSalvar(c, { ...c })).toEqual({ delivery_config: {} });
  });
});

describe('taxa das faixas em centavos', () => {
  it('arredonda a taxa ao gravar e não conta mudança por sobra de ponto flutuante', () => {
    const base = cfg({ faixas: [{ ate_km: 2, taxa: 6.5, tempo_max_min: 40 }] });
    const sujo = cfg({ faixas: [{ ate_km: 2, taxa: 6.499999999999999, tempo_max_min: 40 }] });
    expect((paraSalvar(sujo).delivery_config.delivery_fee_tiers as { taxa: number }[])[0].taxa).toBe(6.5);
    expect(contarMudancas(base, sujo)).toBe(0);
    const tresCasas = cfg({ faixas: [{ ate_km: 2, taxa: 6.505, tempo_max_min: 40 }] });
    expect((paraSalvar(tresCasas).delivery_config.delivery_fee_tiers as { taxa: number }[])[0].taxa).toBe(6.51);
  });
});

describe('inicioDosUltimos30Dias', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('hoje em Brasília menos 29 dias, às 00:00 (-03:00)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T15:00:00Z'));
    expect(inicioDosUltimos30Dias()).toBe('2026-09-06T03:00:00.000Z');
  });

  it('perto da meia-noite usa o dia de Brasília, não o de UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T01:00:00Z')); // 22:00 do dia 4 em Brasília
    expect(inicioDosUltimos30Dias()).toBe('2026-09-05T03:00:00.000Z');
  });
});

describe('fetchPtBr', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('troca a falha de rede por uma frase em português', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchPtBr('https://x.test')).rejects.toThrow(MSG_SEM_CONEXAO);
    expect(MSG_SEM_CONEXAO).toBe('Sem conexão com o servidor. Tente de novo.');
  });

  it('resposta do servidor passa como veio', async () => {
    const resp = new Response('{}', { status: 500 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp));
    await expect(fetchPtBr('https://x.test')).resolves.toBe(resp);
  });
});
