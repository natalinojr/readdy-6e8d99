// Ações rápidas do chat do assistente para o módulo Tarefas — caminho principal de cada uma até
// a gravação (task-write via invokeUmaVez → fetch global), no mesmo padrão de acaoClima.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { todayBrasilia } from '@/lib/dateUtils';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: { user: { id: 'u-eu', tenantId: 't1' } },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: h.rpc },
  invokeWithAuth: vi.fn(),
  ensureFreshSession: vi.fn(async () => ({ access_token: 'tk' })),
  SUPABASE_URL: 'http://x',
  SUPABASE_ANON_KEY: 'k',
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import Cronometro from '@/components/feature/assistente/acoes/tarefas/Cronometro';
import AdiarTarefa from '@/components/feature/assistente/acoes/tarefas/AdiarTarefa';
import PassarTarefa from '@/components/feature/assistente/acoes/tarefas/PassarTarefa';
import TarefasQuePassei from '@/components/feature/assistente/acoes/tarefas/TarefasQuePassei';
import AtrasadasEquipe from '@/components/feature/assistente/acoes/tarefas/AtrasadasEquipe';
import ApontarHoras from '@/components/feature/assistente/acoes/tarefas/ApontarHoras';
import ComentarTarefa from '@/components/feature/assistente/acoes/tarefas/ComentarTarefa';
import ChecklistTarefa from '@/components/feature/assistente/acoes/tarefas/ChecklistTarefa';
import CargaEquipe from '@/components/feature/assistente/acoes/tarefas/CargaEquipe';
import NovaTarefa from '@/components/feature/assistente/acoes/pessoal/NovaTarefa';
import TarefasHoje from '@/components/feature/assistente/acoes/pessoal/TarefasHoje';

// ── Datas relativas a hoje em Brasília ──────────────────────────────────────
const hoje = todayBrasilia();
const somaDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
const ontem = somaDias(hoje, -1);
const amanha = somaDias(hoje, 1);

// ── Fábrica de TaskRow ───────────────────────────────────────────────────────
function tarefa(overrides: Partial<TaskRow>): TaskRow {
  return {
    id: 't1', list_id: 'L1', list_name: 'Pasta', list_color: '#000', parent_task_id: null,
    title: 'Tarefa', status_id: 'S1', status_category: 'todo', priority: 0,
    assignee_id: 'u-eu', assignee_name: 'Eu', start_date: null, due_date: null, due_has_time: false,
    sort_order: 0, recurrence: null, completed_at: null, created_at: '2026-01-01T12:00:00Z',
    created_by: 'u-eu', tags: [], checklist_total: 0, checklist_done: 0, subtask_total: 0,
    comment_count: 0, field_values: {}, time_estimate_minutes: null, time_tracked_seconds: 0,
    timer_started_at: null,
    ...overrides,
  };
}

/** rpc mock por nome: handlers[nome](params) → { data, error } (ou undefined → vazio). */
function mockRpc(handlers: Record<string, (params: unknown) => { data: unknown; error: unknown }>) {
  h.rpc.mockImplementation((nome: string, params: unknown) => {
    const fn = handlers[nome];
    return Promise.resolve(fn ? fn(params) : { data: null, error: null });
  });
}

function ultimoCorpo(): Record<string, unknown> {
  const chamadas = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const [, opts] = chamadas[chamadas.length - 1] as [string, { body: string }];
  return JSON.parse(opts.body);
}

const onFechar = () => {};
const irPara = () => {};

beforeEach(() => {
  h.rpc.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, id: 'nova-id', seconds: 1800, stopped_task_id: null }),
  })) as unknown as typeof fetch;
});

describe('Cronômetro', () => {
  it('inicia e para o cronômetro da tarefa', async () => {
    mockRpc({
      fn_get_tasks: () => ({ data: [tarefa({ id: 't1', title: 'Fazer relatório' })], error: null }),
    });
    render(<Cronometro onFechar={onFechar} irPara={irPara} />);

    fireEvent.click(await screen.findByText('Fazer relatório'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(ultimoCorpo()).toMatchObject({ action: 'start_timer', active_tenant_id: 't1', task_id: 't1' });

    fireEvent.click(await screen.findByText(/Parar cronômetro/));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(ultimoCorpo()).toMatchObject({ action: 'stop_timer', active_tenant_id: 't1' });
  });
});

describe('Minhas tarefas de hoje', () => {
  it('adia uma tarefa atrasada para amanhã', async () => {
    mockRpc({
      fn_get_tasks: () => ({
        data: [tarefa({ id: 't1', title: 'Pagar boleto', due_date: `${ontem}T12:00:00Z` })],
        error: null,
      }),
    });
    render(<TarefasHoje onFechar={onFechar} irPara={irPara} />);

    fireEvent.click(await screen.findByText('Pagar boleto'));
    fireEvent.click(await screen.findByText(/Adiar para amanhã/));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(ultimoCorpo()).toMatchObject({
      action: 'update_task', active_tenant_id: 't1', task_id: 't1',
      due_date: `${amanha}T12:00:00Z`, due_has_time: false,
    });
  });

  it('conclui uma tarefa', async () => {
    mockRpc({
      fn_get_tasks: () => ({
        data: [tarefa({ id: 't2', title: 'Ligar para cliente', due_date: `${hoje}T12:00:00Z` })],
        error: null,
      }),
    });
    render(<TarefasHoje onFechar={onFechar} irPara={irPara} />);

    fireEvent.click(await screen.findByText('Ligar para cliente'));
    fireEvent.click(await screen.findByText('Concluir'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(ultimoCorpo()).toMatchObject({ action: 'update_task', active_tenant_id: 't1', task_id: 't2', status_category: 'done' });
  });
});

describe('Nova tarefa', () => {
  it('recorrente: cria com repetição diária e eu como responsável', async () => {
    mockRpc({
      fn_get_task_lists: () => ({ data: [{ id: 'L1', name: 'Financeiro', color: '#000', icon: null, sort_order: 0, parent_list_id: null, statuses: [], open_count: 0 }], error: null }),
      fn_get_tasks: () => ({ data: [], error: null }),
    });
    render(<NovaTarefa onFechar={onFechar} irPara={irPara} recorrente />);

    const campo = await screen.findByPlaceholderText(/Conferir validade/);
    fireEvent.change(campo, { target: { value: 'Trocar filtro da câmara fria' } });
    fireEvent.click(screen.getByLabelText('Enviar'));

    fireEvent.click(await screen.findByText('Todo dia'));
    fireEvent.click(await screen.findByText('Hoje'));
    fireEvent.click(await screen.findByText('Sem horário'));

    fireEvent.click(await screen.findByText('Criar tarefa'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(ultimoCorpo()).toMatchObject({
      action: 'create_task', active_tenant_id: 't1',
      list_id: 'L1', title: 'Trocar filtro da câmara fria', assignee_id: 'u-eu',
      due_date: `${hoje}T12:00:00Z`, due_has_time: false,
      recurrence: { freq: 'daily', interval: 1 },
    });
  });

  it('normal: no resumo, escolhe tempo estimado de 30 min', async () => {
    mockRpc({
      fn_get_task_lists: () => ({ data: [{ id: 'L1', name: 'Financeiro', color: '#000', icon: null, sort_order: 0, parent_list_id: null, statuses: [], open_count: 0 }], error: null }),
      fn_get_tasks: () => ({ data: [], error: null }),
    });
    render(<NovaTarefa onFechar={onFechar} irPara={irPara} />);

    const campo = await screen.findByPlaceholderText(/Ligar para o contador/);
    fireEvent.change(campo, { target: { value: 'Fazer backup' } });
    fireEvent.click(screen.getByLabelText('Enviar'));

    fireEvent.click(await screen.findByText('Sem data'));
    fireEvent.click(await screen.findByRole('button', { name: /Tempo/ }));
    fireEvent.click(await screen.findByText('30 min'));

    fireEvent.click(await screen.findByText('Criar tarefa'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(ultimoCorpo()).toMatchObject({ action: 'create_task', active_tenant_id: 't1', title: 'Fazer backup', time_estimate_minutes: 30 });
  });
});

describe('Adiar tarefa', () => {
  it('adia para a data escolhida', async () => {
    mockRpc({
      fn_get_tasks: () => ({
        data: [tarefa({ id: 't1', title: 'Emitir nota', due_date: `${ontem}T12:00:00Z` })],
        error: null,
      }),
    });
    render(<AdiarTarefa onFechar={onFechar} irPara={irPara} />);

    fireEvent.click(await screen.findByText('Emitir nota'));
    fireEvent.click(await screen.findByText('Amanhã'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(ultimoCorpo()).toMatchObject({
      action: 'update_task', active_tenant_id: 't1', task_id: 't1',
      due_date: `${amanha}T12:00:00Z`, due_has_time: false,
    });
  });
});

describe('Passar tarefa', () => {
  it('confirma e troca o responsável', async () => {
    mockRpc({
      fn_get_tasks: () => ({ data: [tarefa({ id: 't1', title: 'Emitir nota' })], error: null }),
      fn_get_users_list: () => ({
        data: [
          { id: 'u-ana', nome: 'Ana Souza', ativo: true },
          { id: 'u-bob', nome: 'Bob Lima', ativo: true },
        ],
        error: null,
      }),
    });
    render(<PassarTarefa onFechar={onFechar} irPara={irPara} />);

    fireEvent.click(await screen.findByText('Emitir nota'));
    fireEvent.click(await screen.findByText('Ana Souza'));
    fireEvent.click(await screen.findByText('Confirmar'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(ultimoCorpo()).toMatchObject({ action: 'update_task', active_tenant_id: 't1', task_id: 't1', assignee_id: 'u-ana' });
  });
});

describe('Tarefas que passei', () => {
  it('cobra o responsável', async () => {
    mockRpc({
      fn_get_tasks: () => ({
        data: [tarefa({ id: 't1', title: 'Fechar contrato', created_by: 'u-eu', assignee_id: 'u-carlos', assignee_name: 'Carlos Dias' })],
        error: null,
      }),
    });
    render(<TarefasQuePassei onFechar={onFechar} irPara={irPara} />);

    fireEvent.click(await screen.findByText('Fechar contrato'));
    fireEvent.click(await screen.findByText('Cobrar'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const corpo = ultimoCorpo();
    expect(corpo).toMatchObject({ action: 'add_comment', active_tenant_id: 't1', task_id: 't1' });
    expect(String(corpo.body)).toContain('Carlos');
  });
});

describe('Atrasadas da equipe', () => {
  it('cobra o responsável de uma tarefa atrasada', async () => {
    mockRpc({
      fn_get_tasks: () => ({
        data: [tarefa({ id: 't1', title: 'Entregar orçamento', due_date: `${ontem}T12:00:00Z`, assignee_id: 'u-carlos', assignee_name: 'Carlos Dias' })],
        error: null,
      }),
    });
    render(<AtrasadasEquipe onFechar={onFechar} irPara={irPara} />);

    fireEvent.click(await screen.findByText('Entregar orçamento'));
    fireEvent.click(await screen.findByText('Cobrar'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const corpo = ultimoCorpo();
    expect(corpo).toMatchObject({ action: 'add_comment', active_tenant_id: 't1', task_id: 't1' });
    expect(String(corpo.body)).toContain('Carlos');
  });
});

describe('Apontar horas', () => {
  it('registra 30 minutos pelo atalho', async () => {
    mockRpc({
      fn_get_tasks: () => ({ data: [tarefa({ id: 't1', title: 'Organizar estoque' })], error: null }),
    });
    render(<ApontarHoras onFechar={onFechar} irPara={irPara} />);

    fireEvent.click(await screen.findByText('Organizar estoque'));
    fireEvent.click(await screen.findByText('30m'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(ultimoCorpo()).toMatchObject({ action: 'add_time_entry', active_tenant_id: 't1', task_id: 't1', minutes: 30 });
  });
});

describe('Comentar em tarefa', () => {
  it('escreve e envia o comentário', async () => {
    mockRpc({
      fn_get_tasks: () => ({ data: [tarefa({ id: 't1', title: 'Revisar contrato' })], error: null }),
      fn_get_task_detail: () => ({
        data: {
          id: 't1', list_id: 'L1', parent_task_id: null, title: 'Revisar contrato', description: null,
          status_id: 'S1', priority: 0, assignee_id: 'u-eu', assignee_name: 'Eu', start_date: null,
          due_date: null, due_has_time: false, recurrence: null, completed_at: null, created_at: '2026-01-01T12:00:00Z',
          created_by: 'u-eu', created_by_name: 'Eu', tags: [], checklist: [], comments: [], activity: [], subtasks: [], field_values: {},
        },
        error: null,
      }),
    });
    render(<ComentarTarefa onFechar={onFechar} irPara={irPara} />);

    fireEvent.click(await screen.findByText('Revisar contrato'));
    const campo = await screen.findByPlaceholderText('Escreva o comentário');
    fireEvent.change(campo, { target: { value: 'Já revisei, ok.' } });
    fireEvent.click(screen.getByLabelText('Enviar'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(ultimoCorpo()).toMatchObject({ action: 'add_comment', active_tenant_id: 't1', task_id: 't1', body: 'Já revisei, ok.' });
  });
});

describe('Marcar checklist', () => {
  it('marca item feito e oferece concluir a tarefa', async () => {
    mockRpc({
      fn_get_tasks: () => ({ data: [tarefa({ id: 't1', title: 'Fechar caixa', checklist_total: 1, checklist_done: 0 })], error: null }),
      fn_get_task_detail: () => ({
        data: {
          id: 't1', list_id: 'L1', parent_task_id: null, title: 'Fechar caixa', description: null,
          status_id: 'S1', priority: 0, assignee_id: 'u-eu', assignee_name: 'Eu', start_date: null,
          due_date: null, due_has_time: false, recurrence: null, completed_at: null, created_at: '2026-01-01T12:00:00Z',
          created_by: 'u-eu', created_by_name: 'Eu', tags: [],
          checklist: [{ id: 'c1', title: 'Conferir sangria', is_done: false, sort_order: 0 }],
          comments: [], activity: [], subtasks: [], field_values: {},
        },
        error: null,
      }),
    });
    render(<ChecklistTarefa onFechar={onFechar} irPara={irPara} />);

    fireEvent.click(await screen.findByText('Fechar caixa'));
    fireEvent.click(await screen.findByText('Conferir sangria'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(ultimoCorpo()).toMatchObject({ action: 'update_checklist_item', active_tenant_id: 't1', item_id: 'c1', is_done: true });
    expect(await screen.findByText(/Concluir a tarefa também/)).toBeInTheDocument();
  });
});

describe('Carga da equipe', () => {
  it('mostra a pessoa e as horas de hoje, só leitura', async () => {
    mockRpc({
      fn_get_task_capacities: () => ({ data: {}, error: null }),
      fn_get_users_list: () => ({ data: [{ id: 'u-ana', nome: 'Ana Souza', ativo: true }], error: null }),
      fn_get_tasks: () => ({
        data: [tarefa({
          id: 't1', title: 'Fazer inventário', assignee_id: 'u-ana', assignee_name: 'Ana Souza',
          due_date: `${hoje}T12:00:00Z`, time_estimate_minutes: 120, time_tracked_seconds: 0,
        })],
        error: null,
      }),
    });
    render(<CargaEquipe onFechar={onFechar} irPara={irPara} />);

    expect((await screen.findAllByText('Ana Souza')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/2h/)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('Escolher tarefa pela pasta', () => {
  const duasPastas = () => mockRpc({
    fn_get_tasks: () => ({
      data: [
        tarefa({ id: 'a1', title: 'Trocar filtro', list_id: 'LA', list_name: 'Manutenção', due_date: `${ontem}T12:00:00Z` }),
        tarefa({ id: 'b1', title: 'Pedir carne', list_id: 'LB', list_name: 'Compras' }),
        tarefa({ id: 'b2', title: 'Pedir pão', list_id: 'LB', list_name: 'Compras' }),
      ],
      error: null,
    }),
  });

  it('com mais de uma pasta, pede a pasta primeiro e depois a tarefa', async () => {
    duasPastas();
    render(<Cronometro onFechar={onFechar} irPara={irPara} />);

    expect(await screen.findByText('Escolha a pasta')).toBeTruthy();
    expect(screen.queryByText('Pedir carne')).toBeNull();
    expect(screen.getByText(/1 tarefa · 1 atrasada/)).toBeTruthy(); // Manutenção

    fireEvent.click(screen.getByText('Compras'));
    expect(screen.getByText('Pedir carne')).toBeTruthy();
    expect(screen.queryByText('Trocar filtro')).toBeNull();

    fireEvent.click(screen.getByText('← Outra pasta'));
    fireEvent.click(screen.getByText('Manutenção'));
    fireEvent.click(screen.getByText('Trocar filtro'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(ultimoCorpo()).toMatchObject({ action: 'start_timer', task_id: 'a1' });
  });
  it('mostra só as pastas-mãe, na ordem da tela, e desce pelas subpastas', async () => {
    const lista = (id: string, name: string, sort_order: number, parent_list_id: string | null = null) =>
      ({ id, name, color: '#888', icon: null, sort_order, parent_list_id, statuses: [], open_count: 0 });
    mockRpc({
      fn_get_task_lists: () => ({
        data: [
          lista('LZ', 'Zeladoria', 1), lista('LA', 'Administrativo', 2),
          lista('LC', 'Cozinha', 1, 'LZ'), lista('LF', 'Freezer', 1, 'LC'),
        ],
        error: null,
      }),
      fn_get_tasks: () => ({
        data: [
          tarefa({ id: 'f1', title: 'Degelar freezer', list_id: 'LF', list_name: 'Freezer', due_date: `${ontem}T12:00:00Z` }),
          tarefa({ id: 'c1', title: 'Limpar coifa', list_id: 'LC', list_name: 'Cozinha' }),
          tarefa({ id: 'a1', title: 'Pagar aluguel', list_id: 'LA', list_name: 'Administrativo' }),
        ],
        error: null,
      }),
    });
    render(<Cronometro onFechar={onFechar} irPara={irPara} />);

    expect(await screen.findByText('Escolha a pasta')).toBeTruthy();
    const nomes = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(nomes.findIndex((t) => t.includes('Zeladoria'))).toBeLessThan(nomes.findIndex((t) => t.includes('Administrativo')));
    expect(screen.queryByText('Cozinha')).toBeNull(); // subpasta não aparece na raiz
    expect(screen.getByText(/2 tarefas · 1 atrasada/)).toBeTruthy(); // Zeladoria conta a subárvore

    fireEvent.click(screen.getByText('Zeladoria'));
    // Zeladoria não tem tarefa solta e só uma subpasta: mostra Cozinha
    fireEvent.click(screen.getByText('Cozinha'));
    expect(screen.getByText('Limpar coifa')).toBeTruthy();
    expect(screen.getByText('Tarefas desta pasta')).toBeTruthy();
    expect(screen.getByText(/Zeladoria › Cozinha/)).toBeTruthy();
    fireEvent.click(screen.getByText('Freezer'));
    expect(screen.getByText('Degelar freezer')).toBeTruthy();
    fireEvent.click(screen.getByText('← Cozinha'));
    fireEvent.click(screen.getByText('← Zeladoria'));
    fireEvent.click(screen.getByText('← Outra pasta'));
    expect(screen.getByText('Escolha a pasta')).toBeTruthy();
  });
});

describe('Eu mesmo como responsável', () => {
  it('a lista de pessoas inclui quem está usando, mesmo fora do fn_get_users_list (dono da plataforma)', async () => {
    mockRpc({
      fn_get_tasks: () => ({ data: [tarefa({ id: 't1', title: 'Emitir nota', assignee_id: null, assignee_name: null })], error: null }),
      fn_get_users_list: () => ({ data: [{ id: 'u-ana', nome: 'Ana Souza', ativo: true }], error: null }),
    });
    render(<PassarTarefa onFechar={onFechar} irPara={irPara} />);
    fireEvent.click(await screen.findByText('Emitir nota'));
    fireEvent.click(await screen.findByText('Eu'));
    fireEvent.click(await screen.findByText('Confirmar'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(ultimoCorpo()).toMatchObject({ action: 'update_task', task_id: 't1', assignee_id: 'u-eu' });
  });
});
