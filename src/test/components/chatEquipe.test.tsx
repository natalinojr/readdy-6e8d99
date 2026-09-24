// Conversa com as pessoas da loja (equipe/, 2026-09-23) — contra um servidor falso da Edge chat-equipe.
// 2026-09-24: vistos como no WhatsApp, responder uma mensagem e conversas separadas por loja.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

type Msg = { id: number; sender_id: string; body: string; created_at: string; reply_to_id?: number | null; resposta?: unknown };
const h = vi.hoisted(() => ({
  chamadas: [] as Array<{ action: string; body: Record<string, unknown> }>,
  conversas: [] as unknown[],
  mensagens: [] as Msg[],
  vistos: { lido: 0, entregue: 0 },
  resultados: [] as Msg[],
  janela: [] as Msg[],
  lojas: [{ tenantId: 'loja-1', tenantName: 'Vila Leste', role: 'gerente' }] as Array<{ tenantId: string; tenantName: string; role: string }>,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c; },
    removeChannel: () => undefined,
  },
  invokeWithAuth: vi.fn(async (_fn: string, { body }: { body: Record<string, unknown> }) => {
    const action = String(body.action);
    h.chamadas.push({ action, body });
    const ok = (data: unknown) => ({ data: { success: true, data }, error: null });
    switch (action) {
      case 'conversas': return ok({ conversas: h.conversas });
      case 'colegas': return ok({ colegas: [
        { id: 'u-ana', nome: 'Ana Souza', foto: null, papel: 'cashier' },
        { id: 'u-bia', nome: 'Beatriz', foto: null, papel: 'kitchen' },
      ] });
      case 'abrir': return ok({ thread_id: 't-ana', pessoa: { id: 'u-ana', nome: 'Ana Souza', foto: null } });
      case 'mensagens':
        if (body.around_id) return ok({ mensagens: h.janela, has_more: true, has_newer: true, lido_pelo_outro: 0 });
        return ok({ mensagens: h.mensagens, has_more: false, lido_pelo_outro: h.vistos.lido, entregue_ao_outro: h.vistos.entregue });
      case 'buscar': return ok({ resultados: h.resultados });
      case 'enviar': {
        const orig = h.mensagens.find((m) => m.id === body.reply_to);
        return ok({ mensagem: {
          id: 99, sender_id: 'u-eu', body: body.text, created_at: new Date().toISOString(),
          reply_to_id: body.reply_to ?? null, resposta: orig ? { id: orig.id, sender_id: orig.sender_id, body: orig.body } : null,
        } });
      }
      case 'lido': return ok({ last_read_id: body.id });
      default: return { data: { success: false, error: 'ação?' }, error: null };
    }
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-eu', nome: 'Eu', tenantId: 'loja-1' }, availableTenants: h.lojas }),
}));

import { useEquipeNoChat } from '@/components/feature/equipe/useEquipeNoChat';
import { EVENTO_MSG_EQUIPE, EVENTO_VISTO_EQUIPE } from '@/components/feature/equipe/api';

function Painel() {
  const equipe = useEquipeNoChat({ abrirPainel: () => undefined });
  return (
    <div className="relative">
      <span data-testid="badge">{equipe.naoLidas}</span>
      {equipe.secao}
      {equipe.camada}
    </div>
  );
}
const renderPainel = (rota = '/modulos') => render(<MemoryRouter initialEntries={[rota]}><Painel /></MemoryRouter>);
const agora = () => new Date().toISOString();
const conversa = (o: Record<string, unknown> = {}) => ({
  thread_id: 't-ana', tenant_id: 'loja-1', loja: 'Vila Leste', pessoa: { id: 'u-ana', nome: 'Ana Souza', foto: null },
  lido_pelo_outro: 0, entregue_ao_outro: 0, nao_lidas: 0, quando: agora(), ultima: null, ...o,
});

beforeEach(() => {
  h.chamadas.length = 0;
  h.conversas = [];
  h.mensagens = [];
  h.vistos = { lido: 0, entregue: 0 };
  h.lojas = [{ tenantId: 'loja-1', tenantName: 'Vila Leste', role: 'gerente' }];
});

describe('Conversas com a equipe', () => {
  it('lista a conversa com a última mensagem e as não lidas (badge soma)', async () => {
    h.conversas = [conversa({ nao_lidas: 2, ultima: { id: 5, minha: false, texto: 'Acabou o troco', created_at: agora() } })];
    renderPainel();
    expect(await screen.findByText('Acabou o troco')).toBeInTheDocument();
    expect(screen.getByLabelText('2 não lida(s)')).toBeInTheDocument();
    expect(screen.getByTestId('badge').textContent).toBe('2');
  });

  it('Nova conversa mostra as pessoas da loja; escolher abre a conversa e enviar grava', async () => {
    const user = userEvent.setup();
    renderPainel();
    await user.click((await screen.findAllByRole('button', { name: /Nova conversa/ }))[0]);
    expect(await screen.findByText('Beatriz')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Procurar pessoa'), 'ana');
    expect(screen.queryByText('Beatriz')).not.toBeInTheDocument();
    await user.click(screen.getByText('Ana Souza'));
    expect(h.chamadas.find((c) => c.action === 'abrir')?.body).toMatchObject({ tenant_id: 'loja-1', user_id: 'u-ana' });
    expect(await screen.findByText(/Diga um oi/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Mensagem'), 'Pode trazer o gelo?{Enter}');
    expect(await screen.findByText('Pode trazer o gelo?')).toBeInTheDocument();
    const envio = h.chamadas.find((c) => c.action === 'enviar')!;
    expect(envio.body).toMatchObject({ thread_id: 't-ana', text: 'Pode trazer o gelo?' });
    expect(String(envio.body.client_id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('mensagem que chega pelo Realtime aparece na conversa aberta e é marcada como lida', async () => {
    h.conversas = [conversa()];
    const user = userEvent.setup();
    renderPainel();
    await user.click(await screen.findByText('Ana Souza'));
    await screen.findByText(/Diga um oi/);
    act(() => {
      window.dispatchEvent(new CustomEvent(EVENTO_MSG_EQUIPE, {
        detail: { id: 7, thread_id: 't-ana', sender_id: 'u-ana', body: 'Chegou o fornecedor', created_at: agora() },
      }));
    });
    expect(await screen.findByText('Chegou o fornecedor')).toBeInTheDocument();
    await vi.waitFor(() => expect(h.chamadas.some((c) => c.action === 'lido' && c.body.id === 7)).toBe(true));
    act(() => {
      window.dispatchEvent(new CustomEvent(EVENTO_MSG_EQUIPE, {
        detail: { id: 8, thread_id: 't-outra', sender_id: 'u-bia', body: 'Outra conversa', created_at: agora() },
      }));
    });
    expect(screen.queryByText('Outra conversa')).not.toBeInTheDocument();
  });

  it('o link do aviso no celular (?conversa=) abre direto a conversa', async () => {
    h.conversas = [conversa({ nao_lidas: 1 })];
    h.mensagens = [{ id: 3, sender_id: 'u-ana', body: 'Oi, tudo certo?', created_at: agora() }];
    renderPainel('/modulos?conversa=t-ana');
    expect(await screen.findByText('Oi, tudo certo?')).toBeInTheDocument();
    const cabecalho = screen.getByRole('button', { name: 'Voltar para as conversas' }).parentElement!;
    expect(await within(cabecalho).findByText('Ana Souza')).toBeInTheDocument();
  });
});

describe('Vistos como no WhatsApp', () => {
  it('✓ enviada, ✓✓ cinza entregue e ✓✓ azul lida — e muda na hora quando a pessoa lê', async () => {
    h.conversas = [conversa()];
    h.mensagens = [
      { id: 1, sender_id: 'u-eu', body: 'primeira', created_at: agora() },
      { id: 2, sender_id: 'u-eu', body: 'segunda', created_at: agora() },
      { id: 3, sender_id: 'u-eu', body: 'terceira', created_at: agora() },
    ];
    h.vistos = { lido: 1, entregue: 2 };
    const user = userEvent.setup();
    renderPainel();
    await user.click(await screen.findByText('Ana Souza'));
    const balao = async (t: string) => (await screen.findByText(t)).closest('div')!;
    expect(within(await balao('primeira')).getByLabelText('Lida')).toHaveClass('text-sky-500');
    expect(within(await balao('segunda')).getByLabelText('Entregue')).toHaveClass('text-zinc-400');
    expect(within(await balao('terceira')).getByLabelText('Enviada')).toBeInTheDocument();
    // A Ana abriu a conversa: chega a linha dela pelo Realtime.
    act(() => {
      window.dispatchEvent(new CustomEvent(EVENTO_VISTO_EQUIPE, { detail: { thread_id: 't-ana', user_id: 'u-ana', last_read_id: 3, last_delivered_id: 3 } }));
    });
    expect(within(await balao('terceira')).getByLabelText('Lida')).toHaveClass('text-sky-500');
  });

  it('na lista, a sua última mensagem vem com o visto na frente', async () => {
    h.conversas = [conversa({ entregue_ao_outro: 4, lido_pelo_outro: 0, ultima: { id: 4, minha: true, texto: 'Já saiu?', created_at: agora() } })];
    renderPainel();
    const linha = (await screen.findByText('Já saiu?')).closest('button')!;
    expect(within(linha).getByLabelText('Entregue')).toBeInTheDocument();
  });
});

describe('Responder uma mensagem', () => {
  it('segurar/botão direito › Responder cita a mensagem, envia reply_to e o balão mostra a citação', async () => {
    h.conversas = [conversa()];
    h.mensagens = [{ id: 10, sender_id: 'u-ana', body: 'Quantos pães faltam?', created_at: agora() }];
    const user = userEvent.setup();
    renderPainel();
    await user.click(await screen.findByText('Ana Souza'));
    fireEvent.contextMenu(await screen.findByText('Quantos pães faltam?'));
    await user.click(screen.getByRole('menuitem', { name: /Responder/ }));
    expect(screen.getByText('Respondendo a Ana Souza')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Mensagem'), 'Uns 20{Enter}');
    const envio = h.chamadas.find((c) => c.action === 'enviar')!;
    expect(envio.body).toMatchObject({ text: 'Uns 20', reply_to: 10 });
    expect(screen.queryByText('Respondendo a Ana Souza')).not.toBeInTheDocument();
    const minha = (await screen.findByText('Uns 20')).closest('div')!;
    expect(within(minha).getByText('Quantos pães faltam?')).toBeInTheDocument();
  });

  it('arrastar o balão para a direita também responde; o X cancela', async () => {
    h.conversas = [conversa()];
    h.mensagens = [{ id: 11, sender_id: 'u-ana', body: 'Fecha o caixa 2', created_at: agora() }];
    const user = userEvent.setup();
    renderPainel();
    await user.click(await screen.findByText('Ana Souza'));
    const b = (await screen.findByText('Fecha o caixa 2')).closest('div')!;
    fireEvent.touchStart(b, { touches: [{ clientX: 10, clientY: 100 }] });
    fireEvent.touchMove(b, { touches: [{ clientX: 90, clientY: 102 }] });
    fireEvent.touchEnd(b);
    expect(await screen.findByText('Respondendo a Ana Souza')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar resposta' }));
    expect(screen.queryByText('Respondendo a Ana Souza')).not.toBeInTheDocument();
  });
});

describe('Conversas separadas por loja', () => {
  beforeEach(() => {
    h.lojas = [
      { tenantId: 'loja-1', tenantName: 'Vila Leste', role: 'admin' },
      { tenantId: 'loja-2', tenantName: 'Paranaguá', role: 'admin' },
    ];
    h.conversas = [
      conversa({ thread_id: 't-vila', tenant_id: 'loja-1', loja: 'Vila Leste', ultima: { id: 1, minha: false, texto: 'Assunto da Vila', created_at: agora() } }),
      conversa({ thread_id: 't-pgua', tenant_id: 'loja-2', loja: 'Paranaguá', nao_lidas: 3, ultima: { id: 2, minha: false, texto: 'Assunto de Paranaguá', created_at: agora() } }),
    ];
  });

  it('mostra só a loja aberta; a aba da outra loja avisa que tem mensagem nova', async () => {
    const user = userEvent.setup();
    renderPainel();
    expect(await screen.findByText('Assunto da Vila')).toBeInTheDocument();
    expect(screen.queryByText('Assunto de Paranaguá')).not.toBeInTheDocument();
    expect(screen.getByLabelText('3 não lida(s) em Paranaguá')).toBeInTheDocument();
    expect(screen.getByTestId('badge').textContent).toBe('3');
    await user.click(screen.getByRole('tab', { name: /Paranaguá/ }));
    expect(await screen.findByText('Assunto de Paranaguá')).toBeInTheDocument();
    expect(screen.queryByText('Assunto da Vila')).not.toBeInTheDocument();
  });

  it('Nova conversa na aba de Paranaguá começa a conversa em Paranaguá', async () => {
    const user = userEvent.setup();
    renderPainel();
    await user.click(await screen.findByRole('tab', { name: /Paranaguá/ }));
    await user.click(screen.getAllByRole('button', { name: /Nova conversa/ })[0]);
    expect(h.chamadas.filter((c) => c.action === 'colegas').at(-1)?.body.tenant_id).toBe('loja-2');
    await user.click(await screen.findByText('Beatriz'));
    expect(h.chamadas.find((c) => c.action === 'abrir')?.body).toMatchObject({ tenant_id: 'loja-2', user_id: 'u-bia' });
  });

  it('o link do aviso de outra loja abre a conversa e já troca a aba para essa loja', async () => {
    h.mensagens = [{ id: 2, sender_id: 'u-ana', body: 'Assunto de Paranaguá', created_at: agora() }];
    const user = userEvent.setup();
    renderPainel('/modulos?conversa=t-pgua');
    await screen.findByRole('button', { name: 'Voltar para as conversas' });
    await user.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(await screen.findByRole('tab', { name: /Paranaguá/, selected: true })).toBeInTheDocument();
  });
});

describe('Pesquisar na conversa', () => {
  it('a lupa pesquisa no servidor, destaca o termo e o toque leva até a mensagem antiga', async () => {
    h.conversas = [conversa()];
    h.mensagens = [{ id: 90, sender_id: 'u-ana', body: 'Mensagem de hoje', created_at: agora() }];
    h.resultados = [{ id: 12, sender_id: 'u-ana', body: 'O boleto do gás vence sexta', created_at: agora() }];
    h.janela = [
      { id: 11, sender_id: 'u-eu', body: 'Tem conta pra pagar?', created_at: agora() },
      { id: 12, sender_id: 'u-ana', body: 'O boleto do gás vence sexta', created_at: agora() },
    ];
    const user = userEvent.setup();
    renderPainel();
    await user.click(await screen.findByText('Ana Souza'));
    await screen.findByText('Mensagem de hoje');
    await user.click(screen.getByRole('button', { name: 'Pesquisar na conversa' }));
    await user.type(screen.getByLabelText('Pesquisar na conversa'), 'gas');
    // Sem acento também acha, e o termo vem marcado.
    expect(await screen.findByText('gás', { selector: 'mark' })).toBeInTheDocument();
    expect(h.chamadas.find((c) => c.action === 'buscar')?.body).toMatchObject({ thread_id: 't-ana', q: 'gas' });
    await user.click(screen.getByText('gás', { selector: 'mark' }).closest('button')!);
    expect(h.chamadas.find((c) => c.action === 'mensagens' && c.body.around_id === 12)).toBeTruthy();
    expect(await screen.findByText('Tem conta pra pagar?')).toBeInTheDocument();
    expect(screen.queryByText('Mensagem de hoje')).not.toBeInTheDocument();
    // Voltar ao fim da conversa.
    await user.click(screen.getByRole('button', { name: /Mais recentes/ }));
    expect(await screen.findByText('Mensagem de hoje')).toBeInTheDocument();
  });

  it('nada encontrado avisa; a seta fecha a pesquisa', async () => {
    h.conversas = [conversa()];
    h.resultados = [];
    const user = userEvent.setup();
    renderPainel();
    await user.click(await screen.findByText('Ana Souza'));
    await user.click(await screen.findByRole('button', { name: 'Pesquisar na conversa' }));
    await user.type(screen.getByLabelText('Pesquisar na conversa'), 'xyz');
    expect(await screen.findByText('Nenhuma mensagem com esse texto')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar pesquisa' }));
    expect(screen.queryByLabelText('Pesquisar na conversa', { selector: 'input' })).not.toBeInTheDocument();
  });
});
