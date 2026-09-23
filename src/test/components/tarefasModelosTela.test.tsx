// Tarefas › Modelos de pastas: telas de salvar (escolher o que entra) e de aplicar (data base).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
const rpc = vi.hoisted(() => vi.fn());
const invokeWithAuth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc }, invokeWithAuth }));

import ModelosPastas from '@/pages/tarefas/components/modelos/ModelosPastas';
import type { TaskList } from '@/pages/tarefas/hooks/useTarefas';
import { montarModelo, OPCOES_PADRAO, type OrigemBruta } from '@/pages/tarefas/lib/modeloEstrutura';

const lists = [
  { id: 'P1', name: 'Inauguração', color: '#111', parent_list_id: null, statuses: [], open_count: 0, sort_order: 0, icon: null, access: 'owner' },
  { id: 'P2', name: 'Obras', color: '#222', parent_list_id: 'P1', statuses: [], open_count: 0, sort_order: 0, icon: null, access: 'owner' },
  { id: 'X', name: 'Só ver', color: '#333', parent_list_id: null, statuses: [], open_count: 0, sort_order: 1, icon: null, access: 'view' },
] as unknown as TaskList[];

const origem: OrigemBruta = {
  raiz_id: 'P1',
  pastas: [
    { id: 'P1', name: 'Inauguração', color: '#111', icon: null, parent_list_id: null, sort_order: 0 },
    { id: 'P2', name: 'Obras', color: '#222', icon: null, parent_list_id: 'P1', sort_order: 0 },
  ],
  statuses: [],
  campos: [],
  tarefas: [
    { id: 'T1', list_id: 'P1', parent_task_id: null, title: 'Contratar equipe', description: null, status_id: null, priority: 0, assignee_id: null, start_date: null, due_date: '2026-10-10T12:00:00Z', due_has_time: false, recurrence: null, time_estimate_minutes: null, sort_order: 1 },
    { id: 'T2', list_id: 'P1', parent_task_id: null, title: 'Treinar', description: null, status_id: null, priority: 0, assignee_id: null, start_date: null, due_date: '2026-10-13T12:00:00Z', due_has_time: false, recurrence: null, time_estimate_minutes: null, sort_order: 2 },
  ],
  checklist: [], etiquetas: [], valores: [], visoes: [],
};
const conteudo = montarModelo(origem);

beforeEach(() => {
  rpc.mockReset();
  invokeWithAuth.mockReset();
});

function montar(inicial: Parameters<typeof ModelosPastas>[0]['inicial'], onCriado = vi.fn()) {
  render(
    <ModelosPastas
      inicial={inicial} lists={lists} tenantId="TEN" usuarios={[]} pastaAtualId="P1"
      onCriado={onCriado} onFechar={vi.fn()}
    />,
  );
  return onCriado;
}

describe('Salvar pasta como modelo', () => {
  it('lê a pasta, deixa desmarcar uma tarefa e grava com ela em "excluidos"', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    invokeWithAuth.mockImplementation(async (_fn: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === 'preview_structure_template') return { data: { success: true, content: conteudo }, error: null };
      return { data: { success: true, id: 'NOVO' }, error: null };
    });
    montar({ tipo: 'salvar', listId: 'P1' });

    await screen.findByText('Treinar');
    expect(screen.getByText('Obras')).toBeTruthy();
    expect(screen.getByText('Dia +3')).toBeTruthy(); // datas relativas na pré-visualização
    expect((screen.getByPlaceholderText('Ex.: Inauguração de loja') as HTMLInputElement).value).toBe('Inauguração');

    const linha = screen.getByText('Treinar').parentElement as HTMLElement;
    fireEvent.click(within(linha).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Criar modelo' }));

    await waitFor(() => expect(invokeWithAuth).toHaveBeenCalledTimes(2));
    const body = invokeWithAuth.mock.calls[1][1].body;
    expect(body.action).toBe('save_structure_template');
    expect(body.list_id).toBe('P1');
    expect(body.template_id).toBeUndefined();
    expect(body.options.excluidos).toEqual(['T2']);
  });
});

describe('Aplicar modelo', () => {
  const modelo = {
    id: 'M1', name: 'Inauguração padrão', description: null, content: conteudo, options: { ...OPCOES_PADRAO },
    source_list_id: 'P1', source_list_name: 'Inauguração', version: 2,
    created_at: '2026-09-23T12:00:00Z', updated_at: '2026-09-23T12:00:00Z', versions: [],
  };

  it('lista o modelo e, ao usar, mostra as datas reais a partir do dia 0 escolhido', async () => {
    rpc.mockResolvedValue({ data: [modelo], error: null });
    invokeWithAuth.mockResolvedValue({ data: { success: true, id: 'NOVA_PASTA', exibicao: {} }, error: null });
    const onCriado = montar({ tipo: 'lista' });

    await screen.findByText('Inauguração padrão');
    expect(screen.getByText(/2 pastas · 2 tarefas · cronograma de 4 dias/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Usar' }));

    const data = await screen.findByLabelText('Data de início (dia 0)') as HTMLInputElement;
    fireEvent.change(data, { target: { value: '2026-11-01' } });
    expect(screen.getByText('01/11')).toBeTruthy();
    expect(screen.getByText('04/11')).toBeTruthy();
    // Pasta só de leitura não aparece como destino
    expect(screen.queryByText(/Só ver/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Criar pasta' }));
    await waitFor(() => expect(onCriado).toHaveBeenCalledWith('NOVA_PASTA'));
    const body = invokeWithAuth.mock.calls[0][1].body;
    expect(body).toMatchObject({ action: 'apply_structure_template', template_id: 'M1', data_base: '2026-11-01', parent_list_id: null, name: 'Inauguração' });
  });
});
