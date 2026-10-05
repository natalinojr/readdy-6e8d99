/**
 * Regras puras do grupo WhatsApp do Delivery (abas Conversas e Assistente):
 * src/pages/config-delivery/abas/whatsapp/util.ts
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  agruparConversas, assistenteMudou, camposAssistente, erroDe24h, novoCodigo, pausado, quandoConversa, textoInicialFinal,
} from '../../pages/config-delivery/abas/whatsapp/util';
import type { Bot, Conversa } from '../../pages/config-delivery/abas/whatsapp/tipos';

const conversa = (p: Partial<Conversa> = {}): Conversa => ({
  id: 'c1', contact_phone: '5541999990000', contact_name: null, via: 'erpos', status: 'aberta', is_test: false,
  needs_human: false, bot_paused_until: null, link_sent_at: null, cost_usd: 0, last_message_at: '2026-10-05T23:00:00.000Z', ...p,
});
const bot = (p: Partial<Bot> = {}): Bot => ({
  tenant_id: 't1', is_active: true, code: 'PD-7KQ2', phone_id: null, waba_id: null, numero_origem: null, start_text: null,
  welcome: null, extra_info: null, forbidden: null, voucher_code: null, upsell: false, notify_owner: false, ...p,
});

describe('agruparConversas', () => {
  it('separa quem pede a equipe, quem o assistente atende e as encerradas, mantendo a ordem', () => {
    const lista = [
      conversa({ id: 'a', needs_human: true }),
      conversa({ id: 'b' }),
      conversa({ id: 'c', status: 'encerrada' }),
      conversa({ id: 'd', needs_human: true }),
      conversa({ id: 'e', bot_paused_until: '2099-01-01T00:00:00.000Z' }),
    ];
    const g = agruparConversas(lista);
    expect(g.pedemVoce.map((c) => c.id)).toEqual(['a', 'd']);
    expect(g.cuidando.map((c) => c.id)).toEqual(['b', 'e']);
    expect(g.encerradas.map((c) => c.id)).toEqual(['c']);
  });

  it('conversa encerrada que ainda estava marcada como "pede a equipe" não conta em "Pedem você"', () => {
    const g = agruparConversas([conversa({ status: 'encerrada', needs_human: true })]);
    expect(g.pedemVoce).toHaveLength(0);
    expect(g.encerradas).toHaveLength(1);
  });

  it('lista vazia', () => {
    expect(agruparConversas([])).toEqual({ pedemVoce: [], cuidando: [], encerradas: [] });
  });
});

describe('pausado', () => {
  const agora = new Date('2026-10-05T12:00:00.000Z').getTime();
  it('só vale enquanto a pausa não passou', () => {
    expect(pausado({ bot_paused_until: null }, agora)).toBe(false);
    expect(pausado({ bot_paused_until: '2026-10-05T13:00:00.000Z' }, agora)).toBe(true);
    expect(pausado({ bot_paused_until: '2026-10-05T11:59:59.000Z' }, agora)).toBe(false);
  });
});

describe('quandoConversa (Brasília)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T23:30:00.000Z')); }); // 20:30 em Brasília
  afterEach(() => { vi.useRealTimers(); });

  it('hoje mostra só a hora', () => {
    expect(quandoConversa('2026-10-05T23:12:00.000Z')).toBe('20:12');
  });
  it('depois das 21h de Brasília ainda é o mesmo dia (UTC já virou)', () => {
    vi.setSystemTime(new Date('2026-10-06T01:00:00.000Z')); // 22:00 de 05/10 em Brasília
    expect(quandoConversa('2026-10-06T00:30:00.000Z')).toBe('21:30');
  });
  it('outro dia mostra dia/mês e hora', () => {
    expect(quandoConversa('2026-10-04T23:12:00.000Z')).toBe('04/10 20:12');
  });
  it('data inválida não quebra', () => {
    expect(quandoConversa('lixo')).toBe('');
  });
});

describe('assistente: texto pronto e o que mudou', () => {
  it('o código sempre entra no texto pronto (é ele que liga a conversa à loja)', () => {
    expect(textoInicialFinal(bot())).toBe('Oi! Quero ver o cardápio (PD-7KQ2)');
    expect(textoInicialFinal(bot({ start_text: '  Oi, quero pedir  ' }))).toBe('Oi, quero pedir (PD-7KQ2)');
    expect(textoInicialFinal(bot({ start_text: 'Oi (PD-7KQ2)' }))).toBe('Oi (PD-7KQ2)');
  });

  it('campos como vão para o banco: texto limpo, cupom em maiúsculas, vazio vira null', () => {
    const c = camposAssistente(bot({ welcome: '  ', extra_info: ' Retirada: Rua X ', forbidden: '', voucher_code: ' volta10 ' }));
    expect(c.welcome).toBeNull();
    expect(c.extra_info).toBe('Retirada: Rua X');
    expect(c.forbidden).toBeNull();
    expect(c.voucher_code).toBe('VOLTA10');
  });

  it('espaço sobrando ou texto padrão não contam como mudança', () => {
    const salvo = bot({ start_text: 'Oi (PD-7KQ2)', forbidden: 'vagas' });
    expect(assistenteMudou(bot({ start_text: 'Oi (PD-7KQ2)', forbidden: ' vagas ' }), salvo)).toBe(false);
    expect(assistenteMudou(bot({ start_text: null, forbidden: 'vagas' }), bot({ start_text: null, forbidden: 'vagas' }))).toBe(false);
  });

  it('cada campo editável que muda liga o botão Salvar', () => {
    const salvo = bot();
    expect(assistenteMudou(bot({ is_active: false }), salvo)).toBe(true);
    expect(assistenteMudou(bot({ upsell: true }), salvo)).toBe(true);
    expect(assistenteMudou(bot({ notify_owner: true }), salvo)).toBe(true);
    expect(assistenteMudou(bot({ welcome: 'Oi!' }), salvo)).toBe(true);
    expect(assistenteMudou(bot({ voucher_code: 'X' }), salvo)).toBe(true);
  });

  it('sem assistente carregado não há o que salvar', () => {
    expect(assistenteMudou(null, bot())).toBe(false);
    expect(assistenteMudou(bot(), null)).toBe(false);
  });
});

describe('erroDe24h', () => {
  it('reconhece a janela de 24 h do WhatsApp', () => {
    expect(erroDe24h('(#131047) Re-engagement message')).toBe(true);
    expect(erroDe24h('message sent more than 24 hours ago')).toBe(true);
    expect(erroDe24h('mais de 24 h sem resposta')).toBe(true);
  });
  it('não confunde com outro erro que só tem o número 24', () => {
    expect(erroDe24h('Erro 502')).toBe(false);
    expect(erroDe24h('request 1241 failed')).toBe(false);
  });
});

describe('novoCodigo', () => {
  it('PD- + 4 caracteres sem letras confundíveis', () => {
    for (let i = 0; i < 50; i++) expect(novoCodigo()).toMatch(/^PD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  });
});
