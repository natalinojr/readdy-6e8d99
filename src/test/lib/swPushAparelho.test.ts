// Aparelho compartilhado (2026-10-05): o service worker só mostra Aprovar/Recusar para quem está logado.
// Roda o public/sw.js de verdade num contexto isolado (vm), com self/caches/registration falsos.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const CODIGO = readFileSync(resolve(__dirname, '../../../public/sw.js'), 'utf-8');
const ACAO_URL = 'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/acao-push';

type Notif = { titulo: string; opcoes: Record<string, any>; close: () => void };

function montarSw() {
  const ouvintes: Record<string, (ev: any) => void> = {};
  const caixas = new Map<string, Map<string, string>>();
  const notificacoes: Notif[] = [];
  const fetchFalso = vi.fn(async (_url: string, _init?: unknown) => ({ json: async () => ({ ok: true, mensagem: 'Aprovado.' }) }));
  const abrirJanela = vi.fn(async () => null);

  class RespostaFalsa {
    corpo: string;
    constructor(corpo: string) { this.corpo = corpo; }
    async text() { return String(this.corpo); }
  }
  const caches = {
    open: async (nome: string) => {
      if (!caixas.has(nome)) caixas.set(nome, new Map());
      const c = caixas.get(nome)!;
      return {
        match: async (k: string) => (c.has(k) ? new RespostaFalsa(c.get(k)!) : undefined),
        put: async (k: string, r: RespostaFalsa) => { c.set(k, await r.text()); },
        delete: async (k: string) => c.delete(k),
        keys: async () => [...c.keys()],
      };
    },
    keys: async () => [...caixas.keys()],
    delete: async (n: string) => caixas.delete(n),
  };
  const self: any = {
    addEventListener: (tipo: string, fn: (ev: any) => void) => { ouvintes[tipo] = fn; },
    skipWaiting: vi.fn(),
    location: { origin: 'https://erpos.vercel.app' },
    clients: { matchAll: async () => [], openWindow: abrirJanela, claim: async () => {} },
    navigator: {},
    registration: {
      showNotification: async (titulo: string, opcoes: Record<string, any>) => {
        const n: Notif = { titulo, opcoes, close: () => { const i = notificacoes.indexOf(n); if (i >= 0) notificacoes.splice(i, 1); } };
        notificacoes.push(n);
      },
      getNotifications: async () => notificacoes.map((n) => ({ data: n.opcoes.data, tag: n.opcoes.tag, close: n.close })),
    },
  };
  vm.runInNewContext(CODIGO, {
    self, caches, Response: RespostaFalsa, URL, fetch: fetchFalso, AbortSignal, console,
    setTimeout: (fn: () => void) => { fn(); return 0; }, // a confirmação "some em 6 s" sem esperar Promise, JSON, Object, Array, String,
  });

  const disparar = async (tipo: string, ev: Record<string, unknown>) => {
    const esperas: Promise<unknown>[] = [];
    ouvintes[tipo]({ ...ev, waitUntil: (p: Promise<unknown>) => esperas.push(p) });
    await Promise.all(esperas);
  };
  return {
    notificacoes, fetchFalso, abrirJanela,
    logar: (uid: string | null) => disparar('message', { data: { tipo: 'ERPOS_USUARIO', uid } }),
    push: (payload: Record<string, unknown>) => disparar('push', { data: { json: () => payload, text: () => '' } }),
    clicar: (n: Notif, action: string) => disparar('notificationclick', {
      action, notification: { data: n.opcoes.data, tag: n.opcoes.tag, close: n.close },
    }),
  };
}

const aviso = (para: string, extra: Record<string, unknown> = {}) => ({
  titulo: 'Pedido de aprovação no caixa', corpo: 'Desconto', url: '/hoje', tag: 'aprovacao-1',
  para, acao_url: ACAO_URL,
  acoes: [{ id: 'aprovar', titulo: 'Aprovar', token: 'v1.a.b' }, { id: 'recusar', titulo: 'Recusar', token: 'v1.c.d' }],
  ...extra,
});

describe('sw.js: botões Aprovar/Recusar só para quem está logado', () => {
  it('destinatário logado vê os botões e o clique chama a acao-push', async () => {
    const sw = montarSw();
    await sw.logar('supervisor');
    await sw.push(aviso('supervisor'));
    expect(sw.notificacoes[0].opcoes.actions).toHaveLength(2);
    await sw.clicar(sw.notificacoes[0], 'aprovar');
    expect(sw.fetchFalso).toHaveBeenCalledTimes(1);
    expect(sw.fetchFalso.mock.calls[0][0]).toBe(ACAO_URL);
  });

  it('tablet compartilhado: aviso do supervisor com o caixa logado chega SEM botões', async () => {
    const sw = montarSw();
    await sw.logar('caixa');
    await sw.push(aviso('supervisor'));
    expect(sw.notificacoes).toHaveLength(1);
    expect(sw.notificacoes[0].opcoes.actions).toBeUndefined();
    expect(sw.notificacoes[0].opcoes.data.tokens).toBeUndefined();
    // Tocar abre o app, não decide.
    await sw.clicar(sw.notificacoes[0], '');
    expect(sw.fetchFalso).not.toHaveBeenCalled();
    expect(sw.abrirJanela).toHaveBeenCalledWith('/hoje');
  });

  it('ninguém logado ou aviso sem destinatário: sem botões', async () => {
    const sw = montarSw();
    await sw.push(aviso('supervisor'));
    await sw.logar('supervisor');
    await sw.push(aviso('supervisor', { para: undefined, tag: 'aprovacao-2' }));
    expect(sw.notificacoes.every((n) => n.opcoes.actions === undefined)).toBe(true);
  });

  it('quem sai fecha os avisos com botões; clique antigo de outra pessoa não decide', async () => {
    const sw = montarSw();
    await sw.logar('supervisor');
    await sw.push(aviso('supervisor'));
    const antiga = sw.notificacoes[0];
    await sw.logar(null);
    expect(sw.notificacoes).toHaveLength(0);
    // Mesmo que o sistema mantivesse a notificação na tela, o clique com o caixa logado não decide.
    await sw.logar('caixa');
    await sw.clicar(antiga, 'aprovar');
    expect(sw.fetchFalso).not.toHaveBeenCalled();
    expect(sw.abrirJanela).toHaveBeenCalled();
  });

  it('acao_url fora da Edge acao-push do Supabase: sem botões', async () => {
    const sw = montarSw();
    await sw.logar('supervisor');
    for (const url of [
      'https://evil.example.com/functions/v1/acao-push',
      'https://x.supabase.co.evil.com/functions/v1/acao-push',
      'http://x.supabase.co/functions/v1/acao-push',
      'https://x.supabase.co/functions/v1/acao-push/../outra',
      'https://x.supabase.co/x/functions/v1/acao-push',
    ]) {
      await sw.push(aviso('supervisor', { acao_url: url, tag: url }));
    }
    expect(sw.notificacoes.every((n) => n.opcoes.actions === undefined)).toBe(true);
  });
});
