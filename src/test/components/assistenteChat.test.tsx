// Chat do assistente no ERPOS (AssistenteChat) — testado contra um servidor FALSO em memória que
// imita a Edge assistente-app (history/send/payments/pay) e o send-push. Nada vai para produção.
// Cobre: histórico, envio com contexto de tela, botões de enquete, abas por assunto, pagamento
// com PIN, digital (NativeBiometric) e "Compartilhar" do Android (SendIntent + Filesystem).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

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

// ── Servidor falso ──────────────────────────────────────────────────────────
type Msg = { id: number; role: 'user' | 'assistant'; content: string; channel: string; created_at: string; topic: string };
type Pay = { id: string; kind: 'pix' | 'boleto'; amount: number; beneficiary_name: string | null; pix_key: string | null; due_date: string | null; description: string | null; status: string; status_label: string; error: string | null; created_at: string };
const srv = {
  msgs: [] as Msg[],
  pays: [] as Pay[],
  pin: '1234',
  nextActions: [] as unknown[],
  seq: 100,
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
      return Promise.resolve(ok({ reply: 'ok', actions, tool_calls: [], transcricao: null }));
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
const setCapacitor = (plugins: Record<string, unknown>) => { (window as unknown as { Capacitor?: unknown }).Capacitor = { Plugins: plugins }; };

beforeEach(() => {
  srv.msgs = []; srv.pays = []; srv.nextActions = []; srv.seq = 100;
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
    expect(await screen.findByText('Oi, Natalino')).toBeInTheDocument();
  });

  it('carrega o histórico compartilhado com o Telegram e esconde o prefixo de contexto', async () => {
    add('user', '[Pelo ERPOS · tela: Contas — /financeiro]\nquanto vendi hoje?');
    add('assistant', 'Hoje: *R$ 3.210,00* em 84 pedidos.', 'geral', 'telegram');
    renderChat();
    expect(await screen.findByText('quanto vendi hoje?')).toBeInTheDocument();
    expect(screen.queryByText(/Pelo ERPOS/)).not.toBeInTheDocument();
    // *negrito* do modelo vira <b>, e o canal de origem aparece
    expect(screen.getByText('R$ 3.210,00').tagName).toBe('B');
    expect(screen.getByText(/· Telegram/)).toBeInTheDocument(); // "Mesma conversa do Telegram" do cabeçalho não conta
  });

  it('envia a mensagem com a tela e a loja abertas e mostra a resposta', async () => {
    const user = userEvent.setup();
    renderChat();
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
    await screen.findByText(/Pode falar/);
    await user.type(screen.getByPlaceholderText('Mensagem'), 'vendas');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await user.click(await screen.findByRole('button', { name: 'Vila Leste' }));
    await waitFor(() => expect(calls('send').at(-1)?.text).toBe('[Botão "Qual loja?"] Resposta: Vila Leste'));
  });
});

describe('AssistenteChat — assuntos', () => {
  it('a aba filtra o histórico e a mensagem escrita nela nasce com o assunto', async () => {
    const user = userEvent.setup();
    add('assistant', 'Aviso de estoque', 'avisos');
    add('assistant', 'Pix preparado', 'pagamentos');
    renderChat();
    expect(await screen.findByText('Aviso de estoque')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pagamentos' }));
    expect(await screen.findByText('Pix preparado')).toBeInTheDocument();
    expect(screen.queryByText('Aviso de estoque')).not.toBeInTheDocument();
    expect(calls('history').at(-1)?.topic).toBe('pagamentos');
    await user.type(screen.getByPlaceholderText('Mensagem'), 'status do pix');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await screen.findByText('Resposta para: status do pix');
    expect(calls('send').at(-1)?.topic).toBe('pagamentos');
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
    await screen.findByText(/Pode falar/);
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
