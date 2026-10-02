// Lista de Tarefas: menus das células abrem direto no clique, comentário pela
// coluna, menu do título (ordenar/editar campo/ocultar) e largura ajustável da coluna.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

import ViewLista from '@/pages/tarefas/components/ViewLista';
import type { TaskList, TaskRow } from '@/pages/tarefas/hooks/useTarefas';

const lista = {
  id: 'L1', name: 'Pasta', color: '#000',
  statuses: [{ id: 'S1', name: 'A fazer', color: '#94a3b8', category: 'todo', sort_order: 0 }],
} as unknown as TaskList;

function tarefa(id: string, title: string, extra: Partial<TaskRow> = {}): TaskRow {
  return {
    id, list_id: 'L1', list_name: 'Pasta', list_color: '#000', parent_task_id: null, title,
    status_id: 'S1', status_category: 'todo', priority: 0, assignee_id: null, assignee_name: null,
    start_date: null, due_date: null, due_has_time: false, sort_order: 0, recurrence: null,
    completed_at: null, created_at: '2026-09-01T12:00:00Z', created_by: null, tags: [],
    checklist_total: 0, checklist_done: 0, subtask_total: 0, comment_count: 0, field_values: {},
    ...extra,
  } as TaskRow;
}

const tasks = [
  tarefa('a', 'Tarefa Alta', { priority: 3 }),
  tarefa('b', 'Tarefa Sem'),
  tarefa('c', 'Tarefa Urgente', { priority: 4 }),
];

function montar(write = vi.fn().mockResolvedValue({ success: true })) {
  render(
    <ViewLista
      list={lista} tasks={tasks} campos={[]} tags={[]}
      usuarios={[{ id: 'u1', nome: 'Maria Silva' }]}
      groupBy="status" write={write} onOpenTask={vi.fn()}
    />,
  );
  return write;
}

const titulos = () => screen.getAllByText(/^Tarefa /).map((el) => el.textContent);

/** Clique no título abre o menu da coluna; escolhe a opção. */
function ordenarPeloMenu(coluna: string, opcao: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: coluna }));
  fireEvent.click(screen.getByRole('button', { name: opcao }));
}

// jsdom não tem PointerEvent — sem isto o clientX do arraste chega undefined.
// Idem DragEvent: sem isto o clientY (antes/depois da linha) chega undefined.
if (!('DragEvent' in window)) (window as unknown as { DragEvent: typeof MouseEvent }).DragEvent = MouseEvent;
if (!('PointerEvent' in window)) (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;

describe('ViewLista (tarefas)', () => {
  beforeEach(() => localStorage.clear());

  it('ordena pela coluna pelo menu do título: crescente → decrescente → tirar ordenação', () => {
    montar();
    expect(titulos()).toEqual(['Tarefa Alta', 'Tarefa Sem', 'Tarefa Urgente']);
    ordenarPeloMenu('Prioridade', /Ordenar crescente/);
    expect(titulos()).toEqual(['Tarefa Alta', 'Tarefa Urgente', 'Tarefa Sem']);
    ordenarPeloMenu('Prioridade', /Ordenar decrescente/);
    expect(titulos()).toEqual(['Tarefa Urgente', 'Tarefa Alta', 'Tarefa Sem']);
    ordenarPeloMenu('Prioridade', /Tirar ordenação/);
    expect(titulos()).toEqual(['Tarefa Alta', 'Tarefa Sem', 'Tarefa Urgente']);
  });

  it('menu do título: ocultar coluna tira ela da tela e salva', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Prioridade' }));
    expect(screen.queryByRole('button', { name: /Editar campo/ })).toBeNull(); // coluna nativa não é campo
    fireEvent.click(screen.getByRole('button', { name: /Ocultar coluna/ }));
    expect(screen.queryByRole('button', { name: 'Prioridade' })).toBeNull();
    expect(JSON.parse(localStorage.getItem('erpos_tarefas_colunas_L1') ?? '[]')).not.toContain('prioridade');
  });

  it('clique no responsável abre a lista direto e grava ao escolher', () => {
    const write = montar();
    const linha = (screen.getByText('Tarefa Sem').closest('.group') as HTMLElement);
    const celulas = within(linha).getAllByRole('button').filter((b) => b.textContent === '—');
    fireEvent.click(celulas[0]); // Responsável é a primeira coluna padrão
    fireEvent.click(screen.getByText('Maria Silva'));
    expect(write).toHaveBeenCalledWith('update_task', { task_id: 'b', assignee_ids: ['u1'] });
  });

  it('data: calendário do mês aberto, um clique no dia grava', () => {
    localStorage.setItem('erpos_tarefas_colunas_L1', JSON.stringify(['vencimento']));
    const write = montar();
    const linha = (screen.getByText('Tarefa Sem').closest('.group') as HTMLElement);
    fireEvent.click(within(linha).getAllByText('—')[0]); // [0] = célula do desktop (o resumo do celular vem depois)
    const d = new Date();
    const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    fireEvent.click(screen.getByRole('button', { name: `15 de ${meses[d.getMonth()]}` }));
    const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
    expect(write).toHaveBeenCalledWith('update_task', { task_id: 'b', due_date: `${dia}T12:00:00Z`, due_has_time: false });
  });

  it('arrastar muda a ordem: soltar antes da primeira linha', () => {
    const write = vi.fn().mockResolvedValue({ success: true });
    render(
      <ViewLista
        list={lista} campos={[]} tags={[]} usuarios={[]} groupBy="status" write={write} onOpenTask={vi.fn()}
        tasks={[tarefa('a', 'Tarefa A', { sort_order: 1 }), tarefa('b', 'Tarefa B', { sort_order: 2 }), tarefa('c', 'Tarefa C', { sort_order: 3 })]}
      />,
    );
    const linha = (t: string) => screen.getByText(t).closest('.group') as HTMLElement;
    fireEvent.dragStart(linha('Tarefa C'), { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.dragOver(linha('Tarefa A'), { clientY: -1 }); // metade de cima = antes
    fireEvent.drop(linha('Tarefa A'), { clientY: -1 });
    expect(write).toHaveBeenCalledWith('update_task', { task_id: 'c', sort_order: -999 });
  });

  it('arrastar com a lista ordenada por coluna: a ordem da tela vira a manual e a ordenação sai', async () => {
    const write = montar();
    ordenarPeloMenu('Prioridade', /Ordenar decrescente/); // Urgente, Alta, Sem
    const linha = (t: string) => screen.getByText(t).closest('.group') as HTMLElement;
    expect(linha('Tarefa Alta').getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(linha('Tarefa Sem'), { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.dragOver(linha('Tarefa Urgente'), { clientY: -1 }); // antes da primeira
    fireEvent.drop(linha('Tarefa Urgente'), { clientY: -1 });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3));
    expect(write).toHaveBeenCalledWith('update_task', { task_id: 'b', sort_order: 0 });
    expect(write).toHaveBeenCalledWith('update_task', { task_id: 'c', sort_order: 1000 });
    expect(write).toHaveBeenCalledWith('update_task', { task_id: 'a', sort_order: 2000 });
    expect(screen.queryByTitle(/ordenação por coluna sai/)).toBeNull();
  });

  it('coluna de comentários aceita digitar direto', async () => {
    localStorage.setItem('erpos_tarefas_colunas_L1', JSON.stringify(['comentarios']));
    const write = montar();
    const linha = (screen.getByText('Tarefa Sem').closest('.group') as HTMLElement);
    fireEvent.click(within(linha).getByText('Comentar'));
    const input = screen.getByPlaceholderText(/coment/i);
    fireEvent.change(input, { target: { value: 'Olá' } });
    expect(document.activeElement).toBe(input);
    fireEvent.submit(input.closest('form')!);
    await vi.waitFor(() =>
      expect(write).toHaveBeenCalledWith('add_comment', { task_id: 'b', body: 'Olá', mentions: [] }));
  });

  it('arrastar a borda do título muda a largura e salva', () => {
    montar();
    const alca = screen.getAllByTitle(/Arraste para ajustar/)[0];
    fireEvent.pointerDown(alca, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 440 });
    fireEvent.pointerUp(window);
    const salvo = JSON.parse(localStorage.getItem('erpos_tarefas_larguras_L1') ?? '{}');
    expect(salvo.responsavel).toBe(200); // 140 + 60
  });
});

import { agruparTarefas } from '@/pages/tarefas/lib/agrupamento';
import ViewCalendario from '@/pages/tarefas/components/ViewCalendario';

describe('Agrupar por responsável', () => {
  it('não some com tarefa de responsável fora da lista de usuários da loja', () => {
    const ts = [
      tarefa('1', 'Tarefa A', { assignee_id: 'u1', assignee_name: 'Maria Silva' }),
      tarefa('2', 'Tarefa B', { assignee_id: 'u9', assignee_name: 'João de Outra Loja' }),
      tarefa('3', 'Tarefa C'),
    ];
    const grupos = agruparTarefas(ts, 'assignee', lista, [{ id: 'u1', nome: 'Maria Silva' }], []);
    expect(grupos.map((g) => [g.label, g.tasks.length])).toEqual([
      ['Maria Silva', 1], ['João de Outra Loja', 1], ['Sem responsável', 1],
    ]);
  });
});

describe('Calendário', () => {
  // jsdom não tem matchMedia; tela larga = modo Mês.
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;

  it('"+N mais" abre as tarefas escondidas do dia', () => {
    const hoje = new Date();
    const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}T12:00:00Z`;
    const ts = [1, 2, 3, 4, 5].map((n) => tarefa(`d${n}`, `Tarefa Dia ${n}`, { due_date: dia }));
    render(
      <ViewCalendario list={lista} tasks={ts} campos={[]} usuarios={[]}
        write={vi.fn().mockResolvedValue({ success: true })} onOpenTask={vi.fn()} />,
    );
    expect(screen.queryByText('Tarefa Dia 5')).toBeNull();
    fireEvent.click(screen.getByText('+2 mais'));
    expect(screen.getByText('Tarefa Dia 5')).toBeTruthy();
    fireEvent.click(screen.getByText('mostrar menos'));
    expect(screen.queryByText('Tarefa Dia 5')).toBeNull();
  });
});

describe('Ordem das colunas', () => {
  beforeEach(() => localStorage.clear());

  it('arrastar o título muda a ordem e salva', () => {
    render(
      <ViewLista list={lista} tasks={[tarefa('a', 'Tarefa A')]} campos={[]} tags={[]} usuarios={[]}
        groupBy="status" write={vi.fn()} onOpenTask={vi.fn()} />,
    );
    const cab = (n: string) => screen.getByRole('button', { name: n }).parentElement!;
    fireEvent.dragStart(cab('Etiquetas'), { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.dragOver(cab('Responsável'), { clientX: -1 }); // metade esquerda = antes
    fireEvent.drop(cab('Responsável'), { clientX: -1 });
    const salvo = JSON.parse(localStorage.getItem('erpos_tarefas_ordem_L1') ?? '[]');
    expect(salvo.slice(0, 4)).toEqual(['etiquetas', 'responsavel', 'vencimento', 'prioridade']);
    const ordemTela = screen.getAllByRole('button', { name: /^(Responsável|Vencimento|Prioridade|Etiquetas)$/ }).map((b) => b.textContent);
    expect(ordemTela).toEqual(['Etiquetas', 'Responsável', 'Vencimento', 'Prioridade']);
  });
});

describe('Menu de colunas: campos personalizados', () => {
  beforeEach(() => localStorage.clear());
  const campo = {
    id: 'f1', list_id: 'L1', name: 'Disciplina', field_type: 'dropdown', options: [], show_on_card: false, sort_order: 1,
  } as unknown as import('@/pages/tarefas/hooks/useTarefas').CampoCustom;

  it('campo da pasta aparece primeiro no menu, e também na visão Todas (com o nome da pasta)', () => {
    const { unmount } = render(
      <ViewLista list={lista} tasks={[tarefa('a', 'Tarefa A')]} campos={[campo]} tags={[]} usuarios={[]}
        groupBy="status" write={vi.fn()} onOpenTask={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Colunas/ }));
    const itens = screen.getAllByRole('button').map((b) => b.textContent).filter((t) => t === 'Disciplina' || t === 'Responsável');
    expect(itens.slice(0, 2)).toEqual(['Disciplina', 'Responsável']); // o menu vem antes do cabeçalho da lista
    unmount();

    render(
      <ViewLista list={null} chaveColunas="todas" tasks={[tarefa('a', 'Tarefa A')]} campos={[campo]} tags={[]} usuarios={[]}
        groupBy="status" write={vi.fn()} onOpenTask={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Colunas/ }));
    expect(screen.getByText('Disciplina · Pasta')).toBeTruthy();
  });

  const comOpcoes = {
    ...campo,
    options: [{ id: 'o1', label: 'Matemática', color: '#6366f1' }, { id: 'o2', label: 'História', color: '#0ea5e9' }],
  } as typeof campo;

  it('título do campo: "Editar campo" muda nome e opções mantendo o id das opções', async () => {
    localStorage.setItem('erpos_tarefas_colunas_L1', JSON.stringify(['campo:f1']));
    const write = vi.fn().mockResolvedValue({ success: true });
    render(
      <ViewLista list={lista} tasks={[tarefa('a', 'Tarefa A')]} campos={[comOpcoes]} tags={[]} usuarios={[]}
        groupBy="status" write={write} onOpenTask={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disciplina' }));
    fireEvent.click(screen.getByRole('button', { name: /Editar campo/ }));
    fireEvent.change(screen.getByDisplayValue('Disciplina'), { target: { value: 'Matéria' } });
    fireEvent.change(screen.getByDisplayValue('História'), { target: { value: 'Geografia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('update_field', {
      field_id: 'f1',
      name: 'Matéria',
      options: [{ id: 'o1', label: 'Matemática', color: '#6366f1' }, { id: 'o2', label: 'Geografia', color: '#0ea5e9' }],
    }));
    await vi.waitFor(() => expect(screen.queryByDisplayValue('Matéria')).toBeNull()); // fechou ao salvar
  });

  it('tirar uma opção que já existia avisa que as tarefas com ela ficam sem valor', () => {
    localStorage.setItem('erpos_tarefas_colunas_L1', JSON.stringify(['campo:f1']));
    render(
      <ViewLista list={lista} tasks={[tarefa('a', 'Tarefa A')]} campos={[comOpcoes]} tags={[]} usuarios={[]}
        groupBy="status" write={vi.fn()} onOpenTask={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disciplina' }));
    fireEvent.click(screen.getByRole('button', { name: /Editar campo/ }));
    expect(screen.queryByText(/ficam sem valor/)).toBeNull();
    fireEvent.click(screen.getAllByTitle('Tirar opção')[1]);
    expect(screen.getByText(/"História" ficam sem valor/)).toBeTruthy();
  });

  it('agrupado pelo campo: tarefa com opção que foi tirada cai em "Sem valor" (não some)', () => {
    const grupos = agruparTarefas(
      [tarefa('a', 'Tarefa A', { field_values: { f1: 'o1' } }), tarefa('b', 'Tarefa B', { field_values: { f1: 'apagada' } })],
      'field:f1', lista, [], [comOpcoes],
    );
    expect(grupos.find((g) => g.key === null)?.tasks.map((t) => t.id)).toEqual(['b']);
    expect(grupos.find((g) => g.key === 'o1')?.tasks.map((t) => t.id)).toEqual(['a']);
  });
});
