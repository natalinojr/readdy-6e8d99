// Chat do assistente no ERPOS (AssistenteChat) — testado contra um servidor FALSO em memória que
// imita a Edge assistente-app (history/send/payments/pay) e o send-push. Nada vai para produção.
// Cobre: histórico, envio com contexto de tela, botões de enquete, abas por assunto, pagamento
// com PIN, digital (NativeBiometric) e "Compartilhar" do Android (SendIntent + Filesystem).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  auth: { user: null as null | Record<string, unknown> },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: h.invoke } },
  invokeWithAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
  SUPABASE_URL: 'http://localhost',
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import AssistenteChat from '@/components/feature/AssistenteChat';
import { getFoco, perguntarAoAssistente, setFocoTela } from '@/lib/assistenteFoco';

// ── Servidor falso ──────────────────────────────────────────────────────────
type Msg = { id: number; role: 'user' | 'assistant'; content: string; channel: string; created_at: string; topic: string };
type Pay = { id: string; kind: 'pix' | 'boleto'; amount: number; beneficiary_name: string | null; pix_key: string | null; due_date: string | null; description: string | null; status: string; status_label: string; error: string | null; created_at: string };
const srv = {
  msgs: [] as Msg[],
  pays: [] as Pay[],
  pin: '1234',
  nextActions: [] as unknown[],
  seq: 100,
  visto: 0, // asst_settings.app_last_seen: até onde o dono já leu (badge do botão fechado)
};
const add = (role: Msg['role'], content: string, topic = 'geral', channel = 'app') => {
  srv.msgs.push({ id: ++srv.seq, role, content, channel, created_at: new Date().toISOString(), topic });
};
const erro = (msg: string) => ({ data: null, error: Object.assign(new Error('edge'), { context: { json: async () => ({ error: msg }) } }) });
const ok = (data: unknown) => ({ data: { success: true, data }, error: null });
type Body = Record<string, unknown> & { action?: string };
const calls = (action: string) => h.invoke.mock.calls.map((c) => c[1]?.body as Body).filter((b) => b?.action === action);

function fakeServer(fn: string, opts: { body: Body }) {
  const b = opts.body;
  if (fn === 'send-push') return Promise.resolve({ data: { success: true, configured: false }, error: null });
  switch (b.action) {
    case 'history': {
      let rows = srv.msgs.filter((m) => !b.topic || m.topic === b.topic);
      if (b.after_id) rows = rows.filter((m) => m.id > Number(b.after_id));
      else if (b.before_id) rows = rows.filter((m) => m.id < Number(b.before_id));
      return Promise.resolve(ok({ messages: rows.map((m) => ({ ...m })), has_more: false }));
    }
    case 'send': {
      const topic = (b.topic as string) ?? 'geral';
      add('user', `[Pelo ERPOS · tela: Teste — /x]\n${b.text}`, topic);
      add('assistant', `Resposta para: ${b.text}`, topic);
      const actions = srv.nextActions; srv.nextActions = [];
      // Mesmo texto que vai para o histórico: a barra pequena mostra `reply`, a conversa mostra a
      // mensagem gravada — os dois têm de bater.
      return Promise.resolve(ok({ reply: `Resposta para: ${b.text}`, actions, tool_calls: [], transcricao: null }));
    }
    case 'unread': {
      const novas = srv.msgs.filter((m) => m.role === 'assistant' && m.id > srv.visto);
      const topics = [...new Set(novas.map((m) => m.topic))];
      return Promise.resolve(ok({
        count: novas.length,
        last_id: novas.length ? novas[novas.length - 1].id : srv.visto,
        topic: topics.length === 1 ? topics[0] : null,
        previa: novas.length ? novas[novas.length - 1].content.slice(0, 140) : null,
      }));
    }
    case 'topics': {
      const TOP = ['geral', 'pagamentos', 'curriculos', 'compras', 'avisos'];
      return Promise.resolve(ok({
        topics: TOP.map((t) => {
          const doTopico = srv.msgs.filter((m) => m.topic === t);
          const last = doTopico[doTopico.length - 1] ?? null;
          return {
            topic: t,
            unread: doTopico.filter((m) => m.role === 'assistant' && m.id > srv.visto).length,
            last: last ? { role: last.role, content: last.content.replace(/^\[[^\]]*\]\s*/, '').slice(0, 120), created_at: last.created_at } : null,
          };
        }),
      }));
    }
    case 'seen': {
      srv.visto = Math.max(srv.visto, Number(b.id));
      return Promise.resolve(ok({ last_seen_id: srv.visto }));
    }
    case 'payments': return Promise.resolve(ok({ payments: srv.pays.map((p) => ({ ...p })) }));
    case 'pay': {
      const p = srv.pays.find((x) => x.id === b.id);
      if (!p) return Promise.resolve(erro('Pagamento não encontrado.'));
      if (b.op === 'ok') {
        if (b.pin !== srv.pin) return Promise.resolve(erro('PIN errado (1/3).'));
        Object.assign(p, { status: 'pending_approval', status_label: 'aguardando sua aprovação no app do Inter' });
      }
      if (b.op === 'no') Object.assign(p, { status: 'cancelled', status_label: 'cancelado' });
      return Promise.resolve(ok({ payment: { ...p } }));
    }
  }
  return Promise.resolve(erro('Ação desconhecida.'));
}

const OWNER = { id: 'u1', email: 'natalinojr.engel@gmail.com', tenantId: 't1', loja: 'El Patrón Paranaguá' };
const pixEduardo = (): Pay => ({
  id: 'p1', kind: 'pix', amount: 115.96, beneficiary_name: 'Eduardo Oriente', pix_key: 'edua…1234', due_date: null,
  description: 'Reembolso', status: 'draft', status_label: 'aguardando você tocar em Pagar', error: null, created_at: new Date().toISOString(),
});
const renderChat = (variant: 'embedded' | 'floating' = 'embedded') =>
  render(<MemoryRouter initialEntries={['/financeiro?tab=contas']}><AssistenteChat variant={variant} /></MemoryRouter>);
// Desde 2026-09-16 o painel abre na LISTA de conversas (estilo WhatsApp). Quem quer testar a
// conversa entra por uma linha da lista — "Todas as mensagens" é a conversa inteira, sem filtro.
const entrarNaConversa = async (user: ReturnType<typeof userEvent.setup>, assunto = 'Todas as mensagens') => {
  await user.click(await screen.findByRole('button', { name: new RegExp(assunto) }));
};
const setCapacitor = (plugins: Record<string, unknown>) => { (window as unknown as { Capacitor?: unknown }).Capacitor = { Plugins: plugins }; };

beforeEach(() => {
  setFocoTela(null);
  srv.msgs = []; srv.pays = []; srv.nextActions = []; srv.seq = 100; srv.visto = 0;
  h.auth.user = OWNER;
  h.invoke.mockReset();
  h.invoke.mockImplementation(fakeServer);
});
afterEach(() => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; });

// ── Testes ──────────────────────────────────────────────────────────────────
describe('AssistenteChat — conversa', () => {
  it('não aparece para quem não é o dono', () => {
    h.auth.user = { ...OWNER, email: 'gerente@loja.com' };
    const { container } = renderChat();
    expect(container).toBeEmptyDOMElement();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('login que chega depois do 1º render ainda carrega a conversa', async () => {
    add('assistant', 'Oi, Natalino');
    h.auth.user = null;
    const { rerender } = renderChat();
    expect(h.invoke).not.toHaveBeenCalled();
    h.auth.user = OWNER;
    rerender(<MemoryRouter initialEntries={['/financeiro?tab=contas']}><AssistenteChat variant="embedded" /></MemoryRouter>);
    await entrarNaConversa(userEvent.setup());
    expect(await screen.findByText('Oi, Natalino')).toBeInTheDocument();
  });

  it('carrega o histórico compartilhado com o Telegram e esconde o prefixo de contexto', async () => {
    add('user', '[Pelo ERPOS · tela: Contas — /financeiro]\nquanto vendi hoje?');
    add('assistant', 'Hoje: *R$ 3.210,00* em 84 pedidos.', 'geral', 'telegram');
    renderChat();
    await entrarNaConversa(userEvent.setup());
    expect(await screen.findByText('quanto vendi hoje?')).toBeInTheDocument();
    expect(screen.queryByText(/Pelo ERPOS/)).not.toBeInTheDocument();
    // *negrito* do modelo vira <b>, e o canal de origem aparece
    expect(screen.getByText('R$ 3.210,00').tagName).toBe('B');
    expect(screen.getByText(/· Telegram/)).toBeInTheDocument(); // "Mesma conversa do Telegram" do cabeçalho não conta
  });

  it('envia a mensagem com a tela e a loja abertas e mostra a resposta', async () => {
    const user = userEvent.setup();
    renderChat();
    await entrarNaConversa(user);
    await screen.findByText(/Pode falar/);
    await user.type(screen.getByPlaceholderText('Mensagem'), 'paga essa conta');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Resposta para: paga essa conta')).toBeInTheDocument();
    const [send] = calls('send');
    expect(send.text).toBe('paga essa conta');
    expect(send.contexto).toMatchObject({ rota: '/financeiro?tab=contas', loja: 'El Patrón Paranaguá' });
    expect(send.topic).toBeUndefined();
  });

  it('mostra o erro do servidor e devolve o texto para a caixa', async () => {
    const user = userEvent.setup();
    h.invoke.mockImplementation((fn: string, o: { body: Body }) =>
      o.body.action === 'send' ? Promise.resolve(erro('Os créditos da API da Anthropic acabaram.')) : fakeServer(fn, o));
    renderChat();
    await entrarNaConversa(user);
    await screen.findByText(/Pode falar/);
    await user.type(screen.getByPlaceholderText('Mensagem'), 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText(/créditos da API/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Mensagem')).toHaveValue('oi');
  });

  it('enquete do assistente vira botões e o toque responde', async () => {
    const user = userEvent.setup();
    srv.nextActions = [{ type: 'poll', question: 'Qual loja?', options: ['Paranaguá', 'Vila Leste'] }];
    renderChat();
    await entrarNaConversa(user);
    await screen.findByText(/Pode falar/);
    await user.type(screen.getByPlaceholderText('Mensagem'), 'vendas');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await user.click(await screen.findByRole('button', { name: 'Vila Leste' }));
    await waitFor(() => expect(calls('send').at(-1)?.text).toBe('[Botão "Qual loja?"] Resposta: Vila Leste'));
  });
});

describe('AssistenteChat — três estágios no flutuante', () => {
  // Pedido do dono (2026-09-16): o botão abre só uma barra para digitar; a conversa inteira
  // aparece ao arrastar para cima. Antes o botão abria a tela toda.
  const ehConversaInteira = () => screen.queryByText('Mesma conversa do Telegram') !== null;

  it('o botão abre a barra pequena (com campo), não a conversa inteira', async () => {
    const user = userEvent.setup();
    renderChat('floating');
    await user.click(screen.getByRole('button', { name: 'Falar com o assistente' }));
    expect(await screen.findByPlaceholderText('Mensagem')).toBeInTheDocument();
    expect(ehConversaInteira()).toBe(false);
  });

  it('arrastar a barra para cima abre a conversa inteira', async () => {
    const user = userEvent.setup();
    add('assistant', 'Tudo certo por aqui');
    renderChat('floating');
    await user.click(screen.getByRole('button', { name: 'Falar com o assistente' }));
    const barra = (await screen.findByPlaceholderText('Mensagem')).closest('div.fixed') as HTMLElement;
    fireEvent.touchStart(barra, { touches: [{ clientY: 600 }] });
    fireEvent.touchMove(barra, { touches: [{ clientY: 500 }] });
    await waitFor(() => expect(ehConversaInteira()).toBe(true));
    expect(await screen.findByText('Tudo certo por aqui')).toBeInTheDocument();
  });

  it('tocar na alça também abre, e recolher volta para a barra', async () => {
    const user = userEvent.setup();
    renderChat('floating');
    await user.click(screen.getByRole('button', { name: 'Falar com o assistente' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir a conversa' }));
    await waitFor(() => expect(ehConversaInteira()).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Recolher a conversa' }));
    await waitFor(() => expect(ehConversaInteira()).toBe(false));
    expect(screen.getByPlaceholderText('Mensagem')).toBeInTheDocument(); // continua dando para digitar
  });

  it('na barra pequena, depois de enviar aparecem a pergunta e a resposta', async () => {
    const user = userEvent.setup();
    renderChat('floating');
    await user.click(screen.getByRole('button', { name: 'Falar com o assistente' }));
    await user.type(await screen.findByPlaceholderText('Mensagem'), 'quanto vendi hoje?');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Você: quanto vendi hoje?')).toBeInTheDocument();
    expect(await screen.findByText('Resposta para: quanto vendi hoje?')).toBeInTheDocument();
    expect(ehConversaInteira()).toBe(false); // continua na barra, sem cobrir a tela
  });

  it('a barra avisa quando há pagamento esperando', async () => {
    const user = userEvent.setup();
    srv.pays = [pixEduardo()];
    renderChat('floating');
    await user.click(screen.getByRole('button', { name: 'Falar com o assistente' }));
    expect(await screen.findByText('1 pagamento esperando você')).toBeInTheDocument();
  });
});

describe('AssistenteChat — lista de conversas', () => {
  // 2026-09-16: as abas viraram lista estilo WhatsApp. A conversa continua UMA no banco; cada
  // linha filtra por `asst_messages.topic`.
  it('a lista mostra a última mensagem e as não lidas de cada assunto', async () => {
    add('assistant', 'Aviso de estoque', 'avisos');
    add('assistant', 'Pix preparado', 'pagamentos');
    renderChat();
    const financeiro = await screen.findByRole('button', { name: /Financeiro/ });
    expect(within(financeiro).getByText('Pix preparado')).toBeInTheDocument();
    expect(within(financeiro).getByText('1')).toBeInTheDocument(); // não lida
    expect(within(await screen.findByRole('button', { name: /Avisos/ })).getByText('Aviso de estoque')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Geral/ })).toHaveTextContent('Nada por aqui ainda');
    expect(calls('history')).toHaveLength(0); // a lista não carrega conversa nenhuma
  });

  it('entrar num assunto filtra o histórico, e a mensagem escrita ali nasce com o assunto', async () => {
    const user = userEvent.setup();
    add('assistant', 'Aviso de estoque', 'avisos');
    add('assistant', 'Pix preparado', 'pagamentos');
    renderChat();
    await entrarNaConversa(user, 'Financeiro');
    expect(await screen.findByText('Pix preparado')).toBeInTheDocument();
    expect(screen.queryByText('Aviso de estoque')).not.toBeInTheDocument();
    expect(calls('history').at(-1)?.topic).toBe('pagamentos');
    await user.type(screen.getByPlaceholderText('Mensagem'), 'status do pix');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await screen.findByText('Resposta para: status do pix');
    expect(calls('send').at(-1)?.topic).toBe('pagamentos');
    // Ler o Financeiro marca SÓ o Financeiro como visto (o aviso de estoque continua novo).
    await waitFor(() => expect(calls('seen').at(-1)?.topic).toBe('pagamentos'));
  });

  it('o voltar do Android fecha a conversa e depois o painel, sem sair do app', async () => {
    // O painel é overlay: sem empurrar histórico, o voltar nativo saía do app (2026-09-16).
    const user = userEvent.setup();
    add('assistant', 'Pix preparado', 'pagamentos');
    add('assistant', 'Currículo novo', 'curriculos'); // assuntos diferentes: o badge abre a LISTA
    renderChat('floating');
    await user.click(await screen.findByRole('button', { name: /mensagens novas/ }));
    await user.click(await screen.findByRole('button', { name: /Financeiro/ }));
    expect(await screen.findByText('Pix preparado')).toBeInTheDocument();

    window.history.back(); // 1º voltar: sai da conversa, fica na lista
    expect(await screen.findByRole('button', { name: /Todas as mensagens/ })).toBeInTheDocument();
    window.history.back(); // 2º voltar: fecha o painel
    expect(await screen.findByRole('button', { name: /Falar com o assistente/ })).toBeInTheDocument();
  });

  it('a seta volta da conversa para a lista', async () => {
    const user = userEvent.setup();
    add('assistant', 'Pix preparado', 'pagamentos');
    renderChat();
    await entrarNaConversa(user, 'Financeiro');
    expect(await screen.findByText('Pix preparado')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(await screen.findByRole('button', { name: /Todas as mensagens/ })).toBeInTheDocument();
  });
});

describe('AssistenteChat — pagamento', () => {
  it('Pagar pede o PIN; PIN errado mostra o erro, PIN certo envia', async () => {
    const user = userEvent.setup();
    srv.pays = [pixEduardo()];
    renderChat();
    expect(await screen.findByText(/115,96/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Pagar/ }));
    const pin = await screen.findByPlaceholderText('PIN');
    const form = pin.closest('form') as HTMLElement;
    expect(within(form).queryByText(/digital/)).not.toBeInTheDocument(); // sem biometria no navegador
    await user.type(pin, '9999');
    await user.click(within(form).getByRole('button', { name: 'Pagar' }));
    expect(await within(form).findByText('PIN errado (1/3).')).toBeInTheDocument();
    await user.type(pin, '1234');
    await user.click(within(form).getByRole('button', { name: 'Pagar' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('PIN')).not.toBeInTheDocument());
    expect(await screen.findByText(/aprovação no app do Inter/)).toBeInTheDocument();
    expect(calls('pay').map((c) => c.pin)).toEqual(['9999', '1234']);
  });

  it('pagamento concluído não fica fixo no rodapé (só na conversa)', async () => {
    // Antes o rodapé mantinha os pagos por 24 h e tomava a tela do chat (2026-09-16).
    srv.pays = [
      { ...pixEduardo(), id: 'pago1', status: 'paid', status_label: 'pago' },
      { ...pixEduardo(), id: 'aberto1', amount: 77.5, status: 'pending_approval', status_label: 'aguardando sua aprovação no app do Inter' },
    ];
    renderChat();
    expect(await screen.findByText(/77,50/)).toBeInTheDocument();
    expect(screen.queryByText(/115,96/)).not.toBeInTheDocument();
  });

  it('Cancelar cancela sem pedir PIN', async () => {
    const user = userEvent.setup();
    srv.pays = [pixEduardo()];
    renderChat();
    await screen.findByText(/115,96/);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(calls('pay').at(-1)).toMatchObject({ op: 'no', id: 'p1' }));
    expect(screen.queryByPlaceholderText('PIN')).not.toBeInTheDocument();
  });
});

describe('AssistenteChat — app Android', () => {
  const bioPlugin = (saved: boolean, stored = '1234') => ({
    isAvailable: vi.fn().mockResolvedValue({ isAvailable: true }),
    isCredentialsSaved: vi.fn().mockResolvedValue({ isSaved: saved }),
    getSecureCredentials: vi.fn().mockResolvedValue({ username: 'pin', password: stored }),
    setCredentials: vi.fn().mockResolvedValue(undefined),
    deleteCredentials: vi.fn().mockResolvedValue(undefined),
  });

  it('1º pagamento: PIN digitado fica guardado para a digital', async () => {
    const user = userEvent.setup();
    const bio = bioPlugin(false);
    setCapacitor({ NativeBiometric: bio });
    srv.pays = [pixEduardo()];
    renderChat();
    await screen.findByText(/115,96/);
    await user.click(screen.getByRole('button', { name: /Pagar/ }));
    const pin = await screen.findByPlaceholderText('PIN');
    const form = pin.closest('form') as HTMLElement;
    expect(await within(form).findByText('Usar a digital nas próximas vezes')).toBeInTheDocument();
    await user.type(pin, '1234');
    await user.click(within(form).getByRole('button', { name: 'Pagar' }));
    await waitFor(() => expect(bio.setCredentials).toHaveBeenCalledWith(expect.objectContaining({ password: '1234', server: 'erpos-pay-pin' })));
  });

  it('com PIN guardado, a digital paga sem digitar', async () => {
    const user = userEvent.setup();
    const bio = bioPlugin(true);
    setCapacitor({ NativeBiometric: bio });
    srv.pays = [pixEduardo()];
    renderChat();
    await screen.findByText(/115,96/);
    await user.click(screen.getByRole('button', { name: /Pagar/ }));
    await waitFor(() => expect(calls('pay').at(-1)).toMatchObject({ op: 'ok', pin: '1234' }));
    expect(bio.getSecureCredentials).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByPlaceholderText('PIN')).not.toBeInTheDocument());
    expect(bio.setCredentials).not.toHaveBeenCalled();
  });

  it('PIN guardado desatualizado: apaga da digital e pede o PIN novo', async () => {
    const user = userEvent.setup();
    const bio = bioPlugin(true, '0000');
    setCapacitor({ NativeBiometric: bio });
    srv.pays = [pixEduardo()];
    renderChat();
    await screen.findByText(/115,96/);
    await user.click(screen.getByRole('button', { name: /Pagar/ }));
    expect(await screen.findByText('O PIN guardado mudou. Digite o PIN novo.')).toBeInTheDocument();
    expect(bio.deleteCredentials).toHaveBeenCalledWith({ server: 'erpos-pay-pin' });
    expect(screen.getByPlaceholderText('PIN')).toBeInTheDocument();
  });

  // Quem recebe o "Compartilhar" do Android é o src/lib/shareIntake (no início do app, ver
  // src/test/lib/shareIntake.test.ts). Aqui testamos o outro lado: o chat consumindo o que ficou
  // guardado. Antes o tratamento era dentro do chat e o conteúdo se perdia quando o app abria
  // numa tela sem chat (2026-09-15).
  const compartilhar = (p: Record<string, unknown>) => sessionStorage.setItem('erpos_share_intent', JSON.stringify(p));

  it('PDF compartilhado abre o chat com o anexo pronto e é consumido uma vez só', async () => {
    compartilhar({ kind: 'arquivo', nome: 'boleto-sacolao.pdf', media_type: 'application/pdf', base64: btoa('%PDF-1.4 teste') });
    renderChat('floating');
    expect(await screen.findByText('boleto-sacolao.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument();
    expect(sessionStorage.getItem('erpos_share_intent')).toBeNull();
  });

  it('funciona também com o chat da tela Assistente (embutido)', async () => {
    compartilhar({ kind: 'arquivo', nome: 'cupom.pdf', media_type: 'application/pdf', base64: btoa('%PDF-1.4 cupom') });
    renderChat('embedded');
    expect(await screen.findByText('cupom.pdf')).toBeInTheDocument();
  });

  it('texto compartilhado cai na caixa de mensagem', async () => {
    compartilhar({ kind: 'texto', texto: 'Pague o boleto 34191.79001' });
    renderChat('floating');
    await waitFor(() => expect(screen.getByPlaceholderText('Mensagem')).toHaveValue('Pague o boleto 34191.79001'));
  });

  it('chat já aberto: o aviso do shareIntake traz o conteúdo na hora', async () => {
    renderChat('embedded');
    await screen.findByRole('button', { name: /Todas as mensagens/ });
    compartilhar({ kind: 'texto', texto: 'segue o cupom' });
    window.dispatchEvent(new Event('erpos-share'));
    await waitFor(() => expect(screen.getByPlaceholderText('Mensagem')).toHaveValue('segue o cupom'));
  });

  it('sem nada compartilhado, o chat flutuante fica fechado', async () => {
    sessionStorage.clear();
    renderChat('floating');
    expect(await screen.findByRole('button', { name: 'Falar com o assistente' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Mensagem')).not.toBeInTheDocument();
  });
});

describe('AssistenteChat — contexto da tela e do registro apontado', () => {
  it('manda junto o que a tela mostra e o registro que o dono apontou', async () => {
    const user = userEvent.setup();
    setFocoTela({ tipo: 'tela_contas_a_pagar', titulo: 'Contas a pagar — Setembro/2026', dados: { pendente: 4320, apos_filtros: 3 } });
    renderChat();
    await entrarNaConversa(user);
    await screen.findByText(/Pode falar/);
    // O botão de uma linha da tabela: o item vai junto e o texto sugerido cai na caixa.
    perguntarAoAssistente(
      { tipo: 'conta_a_pagar', id: 'b-1', titulo: 'Conta a pagar: Ambev — R$ 2.800,00, vence 17/09', dados: { fornecedor: 'Ambev' } },
      'Sobre essa conta: ',
    );
    await waitFor(() => expect(screen.getByPlaceholderText('Mensagem')).toHaveValue('Sobre essa conta: '));
    await user.type(screen.getByPlaceholderText('Mensagem'), 'dá para adiar?');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    const ctx = calls('send')[0].contexto as { tela: { titulo: string; dados: string }; item: { id: string; titulo: string } };
    expect(ctx.tela).toMatchObject({ titulo: 'Contas a pagar — Setembro/2026' });
    expect(ctx.tela.dados).toContain('4320');
    expect(ctx.item).toMatchObject({ id: 'b-1', titulo: expect.stringContaining('Ambev') });
  });

  it('o registro apontado vale para UMA mensagem, não gruda na seguinte', async () => {
    const user = userEvent.setup();
    renderChat();
    await entrarNaConversa(user);
    await screen.findByText(/Pode falar/);
    perguntarAoAssistente({ tipo: 'conta_a_pagar', id: 'b-1', titulo: 'Conta da Ambev' });
    await user.type(screen.getByPlaceholderText('Mensagem'), 'quanto é?');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(calls('send').length).toBe(1));

    await user.type(screen.getByPlaceholderText('Mensagem'), 'e o faturamento de ontem?');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(calls('send').length).toBe(2));
    expect((calls('send')[0].contexto as { item: unknown }).item).toMatchObject({ id: 'b-1' });
    expect((calls('send')[1].contexto as { item: unknown }).item).toBeNull();
  });

  it('a tela some do contexto quando o chat é desmontado junto com ela', async () => {
    setFocoTela({ tipo: 'tela_x', titulo: 'Tela X' });
    expect(getFoco().tela).not.toBeNull();
    setFocoTela(null);
    expect(getFoco().tela).toBeNull();
  });
});

describe('AssistenteChat — botão que leva à tela', () => {
  it('a resposta traz o botão e o toque navega no app', async () => {
    const user = userEvent.setup();
    srv.nextActions = [{ type: 'abrir', rota: '/financeiro?tab=compras', label: 'Abrir a compra da Ambev' }];
    render(
      <MemoryRouter initialEntries={['/financeiro?tab=contas']}>
        <AssistenteChat variant="embedded" />
        <Routes><Route path="/financeiro" element={<p>TELA FINANCEIRO</p>} /></Routes>
      </MemoryRouter>,
    );
    await entrarNaConversa(user);
    await screen.findByText(/Pode falar/);
    await user.type(screen.getByPlaceholderText('Mensagem'), 'lança essa nota');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir a compra da Ambev' }));
    expect(await screen.findByText('TELA FINANCEIRO')).toBeInTheDocument();
  });

  it('o marcador do histórico não aparece no balão (só o botão)', async () => {
    // O brain grava '[Botão enviado: "…" → /rota]' na mensagem para saber o que já mandou.
    // Isso é anotação interna: apareceu na tela do dono em 2026-09-16.
    add('assistant', 'Toca aí no botão que já cai direto na aba certa.\n[Botão enviado: "Abrir DRE" → /financeiro?tab=dre]');
    renderChat();
    await entrarNaConversa(userEvent.setup());
    expect(await screen.findByText(/Toca aí no botão/)).toBeInTheDocument();
    expect(screen.queryByText(/Botão enviado/)).not.toBeInTheDocument();
  });
});

describe('AssistenteChat — responder e copiar', () => {
  it('botão direito abre as ações; Responder cita a mensagem e manda o trecho junto', async () => {
    const user = userEvent.setup();
    add('assistant', 'Setembro até agora: R$ 3.410,94.');
    renderChat();
    await entrarNaConversa(user);
    const balao = await screen.findByText(/Setembro até agora/);
    fireEvent.contextMenu(balao);
    await user.click(await screen.findByRole('button', { name: /Responder/ }));

    // A citação aparece acima da caixa e vai no texto enviado (o assistente lê igual no Telegram).
    await user.type(screen.getByPlaceholderText('Mensagem'), 'esse valor é do mês inteiro?');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(calls('send')).toHaveLength(1));
    expect(calls('send')[0].text).toBe([
      '[Respondendo a: "Setembro até agora: R$ 3.410,94."]',
      'esse valor é do mês inteiro?',
    ].join('\n'));
  });

  it('Copiar manda o texto para a área de transferência', async () => {
    const user = userEvent.setup();
    const escrito: string[] = [];
    // navigator.clipboard é só-leitura no jsdom: define a propriedade em vez de atribuir.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t: string) => { escrito.push(t); return Promise.resolve(); } },
    });
    add('assistant', 'Chave Pix: 12345');
    renderChat();
    await entrarNaConversa(user);
    fireEvent.contextMenu(await screen.findByText('Chave Pix: 12345'));
    await user.click(await screen.findByRole('button', { name: /Copiar/ }));
    await waitFor(() => expect(escrito).toEqual(['Chave Pix: 12345']));
    expect(await screen.findByText('Copiado')).toBeInTheDocument();
  });
});

describe('AssistenteChat — badge do botão fechado', () => {
  it('conta o que ele falou sozinho e abre a conversa no assunto', async () => {
    const user = userEvent.setup();
    add('assistant', 'Stone e Inter com R$ 340 de diferença ontem', 'pagamentos', 'cron');
    add('assistant', 'A conta da Ambev vence amanhã', 'pagamentos', 'cron');
    renderChat('floating');
    // Fechado o chat NÃO carrega histórico: só o contador.
    expect(await screen.findByRole('button', { name: 'Assistente: 2 mensagens novas' })).toBeInTheDocument();
    expect(calls('history')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Assistente: 2 mensagens novas' }));
    expect(await screen.findByText('Mesma conversa do Telegram')).toBeInTheDocument(); // conversa inteira, para ler
    await waitFor(() => expect(calls('history')[0]?.topic).toBe('pagamentos')); // já na aba do assunto
    await waitFor(() => expect(calls('seen').length).toBeGreaterThan(0)); // visto: some o badge
  });

  it('sem novidade o botão só abre a barra pequena', async () => {
    const user = userEvent.setup();
    renderChat('floating');
    await waitFor(() => expect(calls('unread').length).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Falar com o assistente' }));
    expect(await screen.findByPlaceholderText('Mensagem')).toBeInTheDocument();
    expect(screen.queryByText('Mesma conversa do Telegram')).toBeNull();
  });
});
