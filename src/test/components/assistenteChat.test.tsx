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
  supabase: {
    functions: { invoke: h.invoke },
    // Conversa com a equipe escuta o Realtime (equipe/useConversasEquipe).
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c; },
    removeChannel: () => undefined,
    // Conversa "Avisos" (AvisosConversa) lê a tabela avisos direto: aqui, sempre vazia.
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'order', 'eq', 'is', 'in', 'update']) q[m] = () => q;
      q.limit = () => Promise.resolve({ data: [], error: null });
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return q;
    },
  },
  invokeWithAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
  SUPABASE_URL: 'http://localhost',
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
// Ações rápidas filtradas pelo acesso (2026-09-23): sem provider de permissões o contexto libera
// tudo; os módulos por usuário vêm daqui.
vi.mock('@/hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({ modules: ['tarefas', 'contratacao', 'nfse'], loading: false, hasModule: () => true }),
}));

import AssistenteChat from '@/components/feature/AssistenteChat';
import { getFoco, perguntarAoAssistente, setFocoTela } from '@/lib/assistenteFoco';

// ── Servidor falso ──────────────────────────────────────────────────────────
type Msg = { id: number; role: 'user' | 'assistant'; content: string; channel: string; created_at: string; topic: string; group_jid?: string | null; kind?: string };
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
      let rows = srv.msgs.filter((m) => (b.group_jid ? m.group_jid === b.group_jid : !b.topic || m.topic === b.topic));
      if (b.kind) rows = rows.filter((m) => (m.kind ?? 'conversa') === b.kind);
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
    case 'kinds': {
      const doTopico = srv.msgs.filter((m) => !b.topic || m.topic === b.topic);
      const kinds = ['conversa', 'pagamento', 'caixa', 'grupo', 'automatico'].map((k) => {
        const rows = doTopico.filter((m) => (m.kind ?? 'conversa') === k);
        const u = rows.at(-1);
        return { kind: k, total: rows.length, unread: rows.filter((m) => m.role === 'assistant' && m.id > srv.visto).length, last: u ? { role: u.role, content: u.content, created_at: u.created_at } : null };
      });
      return Promise.resolve(ok({ kinds }));
    }
    case 'topics': {
      const TOP = ['geral', 'pagamentos', 'curriculos', 'compras', 'avisos'];
      const jids = [...new Set(srv.msgs.filter((m) => m.group_jid).map((m) => String(m.group_jid)))];
      return Promise.resolve(ok({
        groups: jids.map((jid) => {
          const doGrupo = srv.msgs.filter((m) => m.group_jid === jid);
          const last = doGrupo[doGrupo.length - 1];
          return {
            group_jid: jid, name: 'Financeiro loja - EP MALL',
            unread: doGrupo.filter((m) => m.role === 'assistant' && m.id > srv.visto).length,
            last: { role: last.role, content: last.content, created_at: last.created_at },
          };
        }),
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

const OWNER = { id: 'u1', email: 'natalinojr.engel@gmail.com', tenantId: 't1', loja: 'El Patrón Paranaguá', perfil: 'admin' };
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
  // Os testes antigos leem a conversa em ordem de chegada; "Tipo" tem os testes próprios.
  localStorage.setItem('erpos.chat.agrupar', 'chegada');
});
afterEach(() => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; });

// ── Testes ──────────────────────────────────────────────────────────────────
describe('AssistenteChat — conversa', () => {
  it('quem não é o dono vê só as ações rápidas, sem a conversa', async () => {
    h.auth.user = { ...OWNER, email: 'gerente@loja.com', perfil: 'gerente' };
    renderChat();
    // Abre nas conversas com a equipe (2026-09-23); as ações ficam na outra aba.
    expect(await screen.findByRole('tab', { name: /Conversas/ })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('tab', { name: /Ações rápidas/ }));
    expect(await screen.findByRole('button', { name: /Vendas do dia/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Todas as mensagens/ })).not.toBeInTheDocument();
    // Aprovar sugestão do tráfego é só do Admin.
    expect(screen.queryByRole('button', { name: /Sugestões do tráfego/ })).not.toBeInTheDocument();
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
    expect(screen.getByText(/· Telegram/)).toBeInTheDocument();
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
  const ehConversaInteira = () => screen.queryByRole('button', { name: 'Recolher a conversa' }) !== null;

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

  it('a seta ← da conversa volta para a lista SEM fechar o chat (flutuante)', async () => {
    // Bug visto no celular (2026-09-16): fechar a conversa pela seta limpava o histórico com
    // history.back(), e esse voltar de limpeza era tomado pelo painel como voltar do usuário.
    const user = userEvent.setup();
    add('assistant', 'Pix preparado', 'pagamentos');
    add('assistant', 'Currículo novo', 'curriculos');
    renderChat('floating');
    await user.click(await screen.findByRole('button', { name: /mensagens novas/ }));
    await user.click(await screen.findByRole('button', { name: /Financeiro/ }));
    expect(await screen.findByText('Pix preparado')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(await screen.findByRole('button', { name: /Todas as mensagens/ })).toBeInTheDocument();
    // Dá tempo do popstate de limpeza chegar: o painel tem de continuar aberto.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('button', { name: /Todas as mensagens/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Falar com o assistente/ })).toBeNull();

    // E o voltar do Android, depois disso, fecha o painel (a limpeza não "comeu" um voltar a mais).
    window.history.back();
    expect(await screen.findByRole('button', { name: /Falar com o assistente/ })).toBeInTheDocument();
  });

  it('grupo do WhatsApp aparece como conversa, com o número de não lidas, e abre só o que veio dele', async () => {
    // Pedido do dono (2026-09-17): a atividade do grupo do financeiro ia para a aba do assunto
    // ("Compras e estoque") e ele não achava. Agora o grupo é uma conversa própria.
    const user = userEvent.setup();
    const jid = '120363421353535472@g.us';
    srv.msgs.push({ id: ++srv.seq, role: 'user', content: '[Sistema] Cupom/nota de compra postado no grupo.\n<mensagem_do_grupo grupo="Financeiro loja - EP MALL" autor="El Patrón" quando="16/09">[Foto] cupom do Condor</mensagem_do_grupo>', channel: 'telegram', created_at: new Date().toISOString(), topic: 'compras', group_jid: jid });
    srv.msgs.push({ id: ++srv.seq, role: 'assistant', content: 'Cupom do Condor, R$ 66,69: compra lançada.', channel: 'telegram', created_at: new Date().toISOString(), topic: 'compras', group_jid: jid });
    add('assistant', 'Aviso que não é do grupo', 'avisos');
    renderChat();

    // Grupos têm aba própria na lista (2026-09-24).
    await user.click(await screen.findByRole('tab', { name: /Grupos/ }));
    const linha = await screen.findByRole('button', { name: /Financeiro loja - EP MALL/ });
    expect(within(linha).getByLabelText('1 não lida(s)')).toBeInTheDocument();
    expect(within(linha).getByText(/compra lançada/)).toBeInTheDocument();

    await user.click(linha);
    expect(await screen.findByText(/Cupom do Condor, R\$ 66,69/)).toBeInTheDocument();
    expect(screen.queryByText('Aviso que não é do grupo')).toBeNull();
    expect(calls('history').at(-1)).toMatchObject({ group_jid: jid });
    await waitFor(() => expect(calls('seen').at(-1)).toMatchObject({ group_jid: jid }));
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

  it('cartão destaca para quem vai e diz se a mercadoria já chegou', async () => {
    // Dono, 2026-09-18: conferir o destinatário e se o produto já foi recebido antes de pagar.
    srv.pays = [
      { ...pixEduardo(), id: 'c1', beneficiary_name: 'Sacolão Paranaguá', recebido: true, recebido_em: '2026-09-18T17:34:13Z' } as Pay,
      { ...pixEduardo(), id: 'c2', amount: 80, beneficiary_name: 'Frig. Silva', recebido: false } as Pay,
    ];
    renderChat();
    expect((await screen.findByText('Sacolão Paranaguá')).tagName).toBe('B');
    expect(screen.getByText(/Mercadoria recebida em 18\/09/)).toBeInTheDocument();
    expect(screen.getByText(/Mercadoria ainda NÃO recebida/)).toBeInTheDocument();
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

  it('aviso que chega pelo histórico (contratação) traz o botão e ele leva à entrevista', async () => {
    // Avisos do hiring-scheduler não passam pelo send: só entram no histórico. O botão tem de vir do
    // marcador, e continuar lá depois de recarregar (antes sumia).
    const user = userEvent.setup();
    add('assistant', '✅ Ana confirmou presença na entrevista (Atendente).\n[Botão enviado: "Abrir entrevista de Ana" → /contratacao?aba=entrevistas&entrevista=iv-1]', 'curriculos', 'cron');
    render(
      <MemoryRouter initialEntries={['/financeiro']}>
        <AssistenteChat variant="embedded" />
        <Routes><Route path="/contratacao" element={<p>TELA CONTRATACAO</p>} /></Routes>
      </MemoryRouter>,
    );
    await entrarNaConversa(user, 'Currículos');
    expect(await screen.findByText(/Ana confirmou presença/)).toBeInTheDocument();
    expect(screen.queryByText(/Botão enviado/)).toBeNull();
    await user.click(screen.getByRole('button', { name: /Abrir entrevista de Ana/ }));
    expect(await screen.findByText('TELA CONTRATACAO')).toBeInTheDocument();
  });

  it('gatilho do sistema vindo de grupo vira linha curta, não balão "meu" com ids', async () => {
    add('user', '[Sistema] Mensagem no grupo "Financeiro loja - EP MALL", que tem freelancer aguardando os dias trabalhados.\nAguardando os dias:\n- Marcelle: pagamento_id 972b1d27-cf4d, R$ 100.00, pedido 7\n<mensagem_do_grupo grupo="Financeiro loja - EP MALL" autor="Thati" quando="16/09/2026, 13:44:54">\nReferente ao dia 15/09\n</mensagem_do_grupo>\nSiga as regras de DIAS DE FREELANCER PELO GRUPO.');
    add('assistant', 'Registrei o dia 15/09 pra Marcelle e Joziane, R$ 100,00 cada.');
    renderChat();
    await entrarNaConversa(userEvent.setup());
    expect(await screen.findByText(/Thati no grupo Financeiro loja - EP MALL: Referente ao dia 15\/09/)).toBeInTheDocument();
    expect(screen.queryByText(/pagamento_id/)).toBeNull();
    expect(screen.queryByText(/\[Sistema\]/)).toBeNull();
  });

  it('marcador com rota de fora (//site) não vira botão', async () => {
    add('assistant', 'oi\n[Botão enviado: "Golpe" → //malicioso.com]');
    renderChat();
    await entrarNaConversa(userEvent.setup());
    expect(await screen.findByText('oi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Golpe/ })).toBeNull();
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

// jsdom não tem PointerEvent: sem isto o fireEvent.pointer* sai sem clientX/clientY.
if (typeof window !== 'undefined' && !('PointerEvent' in window)) {
  class PointerEventTeste extends MouseEvent {
    pointerId: number;
    constructor(tipo: string, init: PointerEventInit = {}) { super(tipo, init); this.pointerId = init.pointerId ?? 0; }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventTeste;
}

describe('AssistenteChat — botão redondo arrastável', () => {
  // Pedido do dono (2026-09-16): era fixo no canto e "voltava para baixo" a cada vez que abria.
  const arrastar = (el: HTMLElement, de: [number, number], para: [number, number]) => {
    fireEvent.pointerDown(el, { clientX: de[0], clientY: de[1], pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: para[0], clientY: para[1], pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: para[0], clientY: para[1], pointerId: 1 });
    fireEvent.click(el); // o navegador dispara o click depois de soltar
  };
  beforeEach(() => { try { localStorage.clear(); } catch { /* sem storage */ } });

  it('arrastar move o botão, não abre o chat e a posição fica depois de abrir e fechar', async () => {
    const user = userEvent.setup();
    renderChat('floating');
    const fab = await screen.findByRole('button', { name: 'Falar com o assistente' });
    arrastar(fab, [990, 740], [200, 300]);

    // Soltar não abriu nada e o botão foi para onde o dedo parou (centro - 28 px).
    expect(screen.queryByPlaceholderText('Mensagem')).toBeNull();
    expect(fab.style.left).toBe('172px');
    expect(fab.style.top).toBe('272px');
    expect(JSON.parse(localStorage.getItem('erpos-assistente-fab') ?? 'null')).toMatchObject({ fx: 200 / window.innerWidth });

    // Abre (toque parado) e fecha: volta no MESMO lugar, não no canto.
    await user.click(fab);
    await user.click(await screen.findByRole('button', { name: 'Fechar chat' }));
    const deNovo = await screen.findByRole('button', { name: 'Falar com o assistente' });
    expect(deNovo.style.left).toBe('172px');
    expect(deNovo.style.top).toBe('272px');
  });

  it('toque com um tremidinho (menos de 8 px) ainda abre o chat', async () => {
    renderChat('floating');
    const fab = await screen.findByRole('button', { name: 'Falar com o assistente' });
    fireEvent.pointerDown(fab, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(fab, { clientX: 503, clientY: 502, pointerId: 1 });
    fireEvent.pointerUp(fab, { clientX: 503, clientY: 502, pointerId: 1 });
    fireEvent.click(fab);
    expect(await screen.findByPlaceholderText('Mensagem')).toBeInTheDocument();
  });
});

describe('AssistenteChat — status do pagamento na conversa Financeiro', () => {
  // Dono, 2026-09-18: o "pago" era uma linha cinza pequena e passava batido.
  it('pago vira cartão verde "Pagamento realizado"; recusado mostra o motivo', async () => {
    add('assistant', '[Pagamento boleto de R$ 114,41: ✅ pago (atualizado automaticamente)] id 18614760-8cc2', 'pagamentos', 'telegram');
    add('assistant', '[Pagamento pix de R$ 40,00 para Joziane: recusado pelo Inter (saldo insuficiente) — pelo ERPOS] id abc', 'pagamentos');
    renderChat();
    await entrarNaConversa(userEvent.setup(), 'Financeiro');
    const titulo = await screen.findByText('Pagamento realizado');
    expect(titulo.closest('.border-emerald-300')).not.toBeNull();
    expect(screen.getByText('R$ 114,41').tagName).toBe('B');
    expect(screen.getByText('Recusado pelo Inter')).toBeInTheDocument();
    expect(screen.getByText('saldo insuficiente')).toBeInTheDocument();
    // o id técnico e o "(atualizado automaticamente)" não aparecem
    expect(screen.queryByText(/18614760|atualizado automaticamente/)).not.toBeInTheDocument();
  });
});

describe('AssistenteChat — abre na última mensagem', () => {
  // Pedido do dono (2026-09-17): ao entrar numa conversa a janela nunca estava na última mensagem.
  // jsdom não calcula layout: simulamos a altura do conteúdo e guardamos o scrollTop.
  const posicao = new WeakMap<Element, number>();
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return 5000; } });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get() { return posicao.get(this) ?? 0; },
      set(v: number) { posicao.set(this, v); },
    });
  });
  afterEach(() => {
    // Tira a simulação: os outros testes voltam ao comportamento do jsdom.
    for (const p of ['scrollHeight', 'clientHeight', 'scrollTop']) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[p];
  });

  it('entrar numa conversa com mensagens rola até o fim', async () => {
    for (let i = 0; i < 30; i++) add('assistant', `Mensagem ${i}`);
    renderChat();
    await entrarNaConversa(userEvent.setup());
    const ultima = await screen.findByText('Mensagem 29');
    const area = ultima.closest('.overflow-y-auto') as HTMLElement;
    await waitFor(() => expect(area.scrollTop).toBe(5000));
  });

  it('voltar para a lista e entrar em outra conversa também abre no fim', async () => {
    const user = userEvent.setup();
    for (let i = 0; i < 10; i++) add('assistant', `Aviso ${i}`, 'avisos');
    for (let i = 0; i < 10; i++) add('assistant', `Pix ${i}`, 'pagamentos');
    renderChat();
    await entrarNaConversa(user, 'Avisos');
    await screen.findByText('Aviso 9');
    await user.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    await entrarNaConversa(user, 'Financeiro');
    const ultima = await screen.findByText('Pix 9');
    const area = ultima.closest('.overflow-y-auto') as HTMLElement;
    await waitFor(() => expect(area.scrollTop).toBe(5000));
  });

  it('subiu para ler enquanto a resposta chegava: fica onde está', async () => {
    // Dono (2026-09-19): "se eu subo a conversa e fico ali lendo, do nada me leva lá pra baixo".
    const user = userEvent.setup();
    for (let i = 0; i < 30; i++) add('assistant', `Mensagem ${i}`);
    let soltar: () => void = () => {};
    const segura = new Promise<void>((r) => { soltar = r; });
    h.invoke.mockImplementation(async (fn: string, o: { body: Body }) => {
      if (o?.body?.action === 'send') await segura;
      return fakeServer(fn, o);
    });
    renderChat();
    await entrarNaConversa(user);
    const area = (await screen.findByText('Mensagem 29')).closest('.overflow-y-auto') as HTMLElement;
    await user.type(screen.getByPlaceholderText('Mensagem'), 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(area.scrollTop).toBe(5000));
    area.scrollTop = 1000; // subiu para ler
    fireEvent.scroll(area);
    soltar();
    expect(await screen.findByText('Resposta para: oi')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(area.scrollTop).toBe(1000);
  });
});

describe('AssistenteChat — cada conversa só com o que é dela', () => {
  it('o que chega em outra conversa enquanto a resposta vem não aparece na conversa aberta', async () => {
    // Dono (2026-09-19): "a conversa geral copia as msgs das outras conversas".
    const user = userEvent.setup();
    add('assistant', 'Oi, geral', 'geral');
    h.invoke.mockImplementation(async (fn: string, o: { body: Body }) => {
      if (o?.body?.action === 'send') add('assistant', 'Pix da Joziane pago', 'pagamentos'); // chegou no meio
      return fakeServer(fn, o);
    });
    renderChat();
    await entrarNaConversa(user, 'Geral');
    await screen.findByText('Oi, geral');
    await user.type(screen.getByPlaceholderText('Mensagem'), 'bom dia');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await screen.findAllByText('Resposta para: bom dia');
    await waitFor(() => expect(calls('history').some((b) => b.after_id && b.topic === 'geral')).toBe(true));
    expect(screen.queryByText('Pix da Joziane pago')).toBeNull();
  });
});

describe('AssistenteChat — resposta onde a pergunta foi feita', () => {
  it('na Geral manda topic geral; na conversa do grupo manda o group_jid', async () => {
    // Dono (2026-09-19): "perguntei no geral e a resposta foi pra outro grupo".
    const user = userEvent.setup();
    add('assistant', 'Oi, geral', 'geral');
    srv.msgs.push({ id: ++srv.seq, role: 'assistant', content: 'Pedido do grupo', channel: 'whatsapp', created_at: new Date().toISOString(), topic: 'pagamentos', group_jid: '120363@g.us' });
    h.invoke.mockImplementation((fn: string, o: { body: Body }) => {
      if (o?.body?.action === 'topics') return Promise.resolve(ok({ topics: [], groups: [{ group_jid: '120363@g.us', name: 'Financeiro Vila', unread: 0, last: null }] }));
      return fakeServer(fn, o);
    });
    renderChat();
    await entrarNaConversa(user, 'Geral');
    await user.type(screen.getByPlaceholderText('Mensagem'), 'quanto vendi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(calls('send').at(-1)).toMatchObject({ text: 'quanto vendi', topic: 'geral' }));
    expect(calls('send').at(-1)?.group_jid).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    await user.click(await screen.findByRole('tab', { name: /Grupos/ })); // grupos em aba própria (2026-09-24)
    await entrarNaConversa(user, 'Financeiro Vila');
    await screen.findByText('Pedido do grupo');
    await user.type(screen.getByPlaceholderText('Mensagem'), 'e esse?');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(calls('send').at(-1)).toMatchObject({ text: 'e esse?', group_jid: '120363@g.us' }));
    expect(calls('send').at(-1)?.topic).toBeUndefined();
  });
});

describe('AssistenteChat — separado por tipo dentro da conversa', () => {
  // Dono (2026-09-26): "as mensagens do Financeiro ficam perdidas" → "separe igual ao Tipo das pendências".
  const semear = () => {
    add('assistant', '☀️ *Turno aberto — Vila*\nSessão #1 · às 18:00', 'pagamentos', 'cron');
    srv.msgs[srv.msgs.length - 1].kind = 'caixa';
    add('assistant', 'Vencimentos de amanhã: 2 contas', 'pagamentos', 'cron');
    srv.msgs[srv.msgs.length - 1].kind = 'automatico';
    add('user', 'paga o boleto da DLR', 'pagamentos');
  };

  it('em Tipo a conversa abre nos grupos fechados; abrir um mostra só ele, tocar de novo volta', async () => {
    localStorage.setItem('erpos.chat.agrupar', 'tipo');
    const user = userEvent.setup();
    semear();
    renderChat();
    await entrarNaConversa(user, 'Financeiro');
    const caixa = await screen.findByRole('button', { name: 'Caixa e turnos' });
    expect(within(caixa).getByText(/Turno aberto/)).toBeInTheDocument(); // prévia da última
    expect(screen.getByRole('button', { name: 'Pagamentos' })).toBeDisabled(); // nada desse tipo
    expect(document.querySelector('[data-msg-id]')).toBeNull(); // nenhuma mensagem aberta
    expect(calls('history').some((b) => b.kind)).toBe(false); // nenhum grupo carregado
    expect(calls('seen')).toHaveLength(0); // ver os grupos não marca como lido
    await user.click(caixa);
    expect(await screen.findByText(/Sessão #1/)).toBeInTheDocument();
    expect(screen.queryByText('paga o boleto da DLR')).toBeNull();
    expect(calls('history').at(-1)).toMatchObject({ topic: 'pagamentos', kind: 'caixa' });
    await waitFor(() => expect(calls('seen').length).toBeGreaterThan(0));
    expect(calls('seen').every((b) => !('kind' in b))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Fechar Caixa e turnos' }));
    expect(await screen.findByRole('button', { name: 'Avisos automáticos' })).toBeInTheDocument();
  });

  it('Chegada mostra tudo em ordem e fica lembrado', async () => {
    localStorage.setItem('erpos.chat.agrupar', 'tipo');
    const user = userEvent.setup();
    semear();
    renderChat();
    await entrarNaConversa(user, 'Financeiro');
    await user.click(await screen.findByRole('button', { name: /Chegada/ }));
    expect(await screen.findByText('Vencimentos de amanhã: 2 contas')).toBeInTheDocument();
    expect(screen.getByText('paga o boleto da DLR')).toBeInTheDocument();
    expect(localStorage.getItem('erpos.chat.agrupar')).toBe('chegada');
  });

  it('escrever com os grupos na tela mostra a conversa com a resposta', async () => {
    localStorage.setItem('erpos.chat.agrupar', 'tipo');
    const user = userEvent.setup();
    semear();
    renderChat();
    await entrarNaConversa(user, 'Financeiro');
    await screen.findByRole('button', { name: 'Caixa e turnos' });
    await user.type(screen.getByPlaceholderText('Mensagem'), 'e o pix?');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Resposta para: e o pix?')).toBeInTheDocument();
    expect(localStorage.getItem('erpos.chat.agrupar')).toBe('tipo'); // preferência não muda
  });

  it('cada conversa só mostra os tipos dela', async () => {
    localStorage.setItem('erpos.chat.agrupar', 'tipo');
    const user = userEvent.setup();
    add('assistant', 'Aviso de estoque', 'avisos');
    renderChat();
    await entrarNaConversa(user, 'Currículos');
    expect(await screen.findByRole('button', { name: 'Avisos automáticos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Caixa e turnos' })).toBeNull(); // só os tipos da conversa
  });
});

describe('AssistenteChat — fechamento vira painel', () => {
  it('mensagem com dados de painel mostra o painel e esconde o marcador', async () => {
    // Dono (2026-09-20): "deixar bonito igual nos botões de ação rápida".
    const dados = {
      t: 'Fechamento do turno', s: 'VILA LESTE', r: 'Sessão #1 · 19/09 12:35 → 20/09 00:11',
      kpi: { p: { l: 'Faturamento', v: 'R$ 845,30', var: { a: 845.3, b: 594, r: 'vs sáb passada' } }, o: [{ l: 'Pedidos', v: '9' }] },
      b: [{ t: 'Por forma de pagamento', i: [{ l: 'PIX', v: 827.3 }, { l: 'Cartão de Débito', v: 18 }] }],
      rk: { t: 'Mais vendidos', i: [{ n: 'Hamburguer de Bacon', q: 10 }] },
    };
    add('assistant', `🌙 *Fechamento do turno*\nR$ 845,30 em 9 pedidos\n[painel]${JSON.stringify(dados)}[/painel]`);
    renderChat();
    await entrarNaConversa(userEvent.setup());
    expect(await screen.findByText('R$ 845,30')).toBeInTheDocument();
    expect(screen.getByText('Por forma de pagamento')).toBeInTheDocument();
    expect(screen.getByText('Hamburguer de Bacon')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument(); // variação calculada contra o sábado passado
    expect(screen.queryByText(/\[painel\]/)).toBeNull();
  });
});

describe('AssistenteChat — divisão por dias', () => {
  it('separa as mensagens por dia (Ontem, Hoje) com um separador por dia', async () => {
    // Dono (2026-09-19): "nas conversas do chat ter uma certa divisão por dias".
    const ontem = new Date(Date.now() - 86400000); ontem.setHours(12, 0, 0, 0);
    add('assistant', 'Msg de ontem 1'); srv.msgs[srv.msgs.length - 1].created_at = ontem.toISOString();
    add('assistant', 'Msg de ontem 2'); srv.msgs[srv.msgs.length - 1].created_at = new Date(ontem.getTime() + 60000).toISOString();
    add('assistant', 'Msg de hoje');
    renderChat();
    await entrarNaConversa(userEvent.setup());
    await screen.findByText('Msg de hoje');
    expect(screen.getAllByLabelText('Mensagens de Ontem')).toHaveLength(1);
    expect(screen.getAllByLabelText('Mensagens de Hoje')).toHaveLength(1);
    const ordem = [...document.querySelectorAll('[aria-label^="Mensagens de"], [data-msg-id]')].map((e) => e.getAttribute('aria-label') ?? e.textContent);
    const iOntem = ordem.indexOf('Mensagens de Ontem'); const iHoje = ordem.indexOf('Mensagens de Hoje');
    expect(iOntem).toBeLessThan(ordem.findIndex((t) => t?.includes('Msg de ontem 1')));
    expect(iHoje).toBeGreaterThan(ordem.findIndex((t) => t?.includes('Msg de ontem 2')));
    expect(iHoje).toBeLessThan(ordem.findIndex((t) => t?.includes('Msg de hoje')));
  });
});

describe('AssistenteChat — ações rápidas', () => {
  it('com o chat na tela toda, o ⚡ abre as ações ocupando o painel e o X fecha', async () => {
    const user = userEvent.setup();
    renderChat();
    await entrarNaConversa(user);
    await user.click(await screen.findByRole('button', { name: 'Ações rápidas' }));
    expect(await screen.findByRole('button', { name: 'Fechar ações rápidas' })).toBeInTheDocument();
    expect(screen.getByText('Sem custo de IA')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar ações rápidas' }));
    expect(screen.queryByRole('button', { name: 'Fechar ações rápidas' })).toBeNull();
  });

  it('o voltar do Android dentro de uma ação fecha só a ação, não o chat', async () => {
    // Bug visto no celular (2026-09-19): a ação aberta não era camada do voltar, e ele fechava o chat.
    // jsdom não tem scrollIntoView (a casca da ação rola até o fim com ele).
    Element.prototype.scrollIntoView ??= vi.fn();
    const user = userEvent.setup();
    renderChat('floating');
    await user.click(await screen.findByRole('button', { name: 'Falar com o assistente' }));
    await user.click(await screen.findByRole('button', { name: 'Ações rápidas' }));
    await user.click(await screen.findByRole('button', { name: /Ir para uma tela/ }));
    expect(await screen.findByText('Ação rápida · sem custo de IA')).toBeInTheDocument();
    // A pilha de camadas do voltar é global do módulo: desmontagens dos testes anteriores podem deixar
    // "voltar de limpeza" contados que no jsdom nunca chegam e engolem um voltar. Por isso aperta até
    // a ação fechar (no máx. 3); o que importa é o chat CONTINUAR aberto — com o bug, o primeiro voltar
    // efetivo fechava o chat inteiro.
    for (let n = 0; n < 3 && screen.queryByText('Ação rápida · sem custo de IA'); n++) {
      window.history.back();
      await new Promise((r) => setTimeout(r, 60));
    }
    expect(screen.queryByText('Ação rápida · sem custo de IA')).toBeNull();
    expect(screen.queryByRole('button', { name: /Falar com o assistente/ })).toBeNull();
    expect(screen.getByPlaceholderText('Mensagem')).toBeInTheDocument();
  });

  it('na barra pequena continua o cartão compacto (sem ocupar a tela)', async () => {
    const user = userEvent.setup();
    renderChat('floating');
    await user.click(await screen.findByRole('button', { name: 'Falar com o assistente' }));
    await user.click(await screen.findByRole('button', { name: 'Ações rápidas' }));
    expect(await screen.findByText(/Ações rápidas · sem custo de IA/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fechar ações rápidas' })).toBeNull();
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
    expect(await screen.findByRole('button', { name: 'Recolher a conversa' })).toBeInTheDocument(); // conversa inteira, para ler
    await waitFor(() => expect(calls('history')[0]?.topic).toBe('pagamentos')); // já na aba do assunto
    await waitFor(() => expect(calls('seen').length).toBeGreaterThan(0)); // visto: some o badge
  });

  it('sem novidade o botão só abre a barra pequena', async () => {
    const user = userEvent.setup();
    renderChat('floating');
    await waitFor(() => expect(calls('unread').length).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Falar com o assistente' }));
    expect(await screen.findByPlaceholderText('Mensagem')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recolher a conversa' })).toBeNull();
  });
});
