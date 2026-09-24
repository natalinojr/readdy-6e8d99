// Compartilhar pasta: tela de compartilhar e o que cada permissão mostra na árvore.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

import CompartilharPasta from '@/pages/tarefas/components/CompartilharPasta';
import ArvorePastas from '@/pages/tarefas/components/ArvorePastas';
import type { TaskList } from '@/pages/tarefas/hooks/useTarefas';
import { montarArvorePastas } from '@/pages/tarefas/lib/pastas';

const pasta = (extra: Partial<TaskList> = {}): TaskList => ({
  id: 'P1', name: 'Obras', color: '#000', icon: null, sort_order: 0, parent_list_id: null, statuses: [], open_count: 0,
  access: 'owner', owner_id: 'eu', owner_name: 'Natalino', share_count: 0, ...extra,
});

describe('CompartilharPasta', () => {
  beforeEach(() => rpc.mockReset());

  it('dono compartilha por e-mail com a permissão escolhida e vê o erro do servidor', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const write = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'Ninguém com esse e-mail ou matrícula nas suas lojas' })
      .mockResolvedValueOnce({ success: true });
    render(<CompartilharPasta list={pasta()} meuId="eu" write={write} onClose={vi.fn()} />);

    expect(await screen.findByText('Ainda não está compartilhada com ninguém.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/maria@loja.com/), { target: { value: 'x@y.com' } });
    fireEvent.change(screen.getByDisplayValue('Pode ver'), { target: { value: 'edit' } });
    fireEvent.click(screen.getByRole('button', { name: /Compartilhar$/ }));
    expect(await screen.findByText(/Ninguém com esse e-mail/)).toBeTruthy();
    expect(write).toHaveBeenCalledWith('share_list', { list_id: 'P1', identificador: 'x@y.com', permission: 'edit' });

    fireEvent.click(screen.getByRole('button', { name: /Compartilhar$/ }));
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2)); // recarrega a lista depois de compartilhar
  });

  it('dono muda permissão e remove; acesso herdado não é editável aqui', async () => {
    rpc.mockResolvedValue({ data: [
      { id: 's1', user_id: 'u1', name: 'Maria', email: 'maria@x.com', badge_number: null, permission: 'view', inherited_from: null },
      { id: 's2', user_id: 'u2', name: 'João', email: 'joao@x.com', badge_number: null, permission: 'edit', inherited_from: 'Loja' },
    ], error: null });
    const write = vi.fn().mockResolvedValue({ success: true });
    render(<CompartilharPasta list={pasta()} meuId="eu" write={write} onClose={vi.fn()} />);

    const maria = (await screen.findByText('Maria')).closest('div.group') as HTMLElement;
    fireEvent.change(within(maria).getByDisplayValue('Pode ver'), { target: { value: 'edit' } });
    expect(write).toHaveBeenCalledWith('update_share', { share_id: 's1', permission: 'edit' });
    fireEvent.click(within(maria).getByTitle('Remover acesso'));
    expect(write).toHaveBeenCalledWith('remove_share', { share_id: 's1' });

    const joao = screen.getByText('João').closest('div.group') as HTMLElement;
    expect(within(joao).getByText('pela pasta "Loja"')).toBeTruthy();
    expect(within(joao).queryByRole('combobox')).toBeNull();
  });

  it('quem recebeu não vê o formulário, só a lista, e pode sair', async () => {
    rpc.mockResolvedValue({ data: [
      { id: 's1', user_id: 'eu', name: 'Eu', email: 'eu@x.com', badge_number: null, permission: 'view', inherited_from: null },
    ], error: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const write = vi.fn().mockResolvedValue({ success: true });
    const onClose = vi.fn();
    render(<CompartilharPasta list={pasta({ access: 'view' })} meuId="eu" write={write} onClose={onClose} />);
    expect(screen.queryByPlaceholderText(/maria@loja.com/)).toBeNull();
    fireEvent.click(await screen.findByTitle('Sair da pasta'));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(write).toHaveBeenCalledWith('remove_share', { share_id: 's1' });
  });
});

describe('ArvorePastas por permissão', () => {
  const montar = (access: TaskList['access']) => render(
    <ArvorePastas
      nos={montarArvorePastas([pasta({ access, share_count: 2 })])}
      selectedId={null} onSelecionar={vi.fn()} onNovaSubpasta={vi.fn()} onExcluir={vi.fn()} onCompartilhar={vi.fn()}
    />,
  );

  it('dono: compartilhar, nova subpasta e excluir', () => {
    montar('owner');
    expect(screen.getByTitle('Compartilhar')).toBeTruthy();
    expect(screen.getByTitle('Nova subpasta')).toBeTruthy();
    expect(screen.getByTitle('Excluir pasta')).toBeTruthy();
  });

  it('pode editar: cria subpasta, não exclui', () => {
    montar('edit');
    expect(screen.getByTitle('Nova subpasta')).toBeTruthy();
    expect(screen.queryByTitle('Excluir pasta')).toBeNull();
    expect(screen.getByTitle('Quem tem acesso')).toBeTruthy();
  });

  it('só ver: nem subpasta nem excluir', () => {
    montar('view');
    expect(screen.queryByTitle('Nova subpasta')).toBeNull();
    expect(screen.queryByTitle('Excluir pasta')).toBeNull();
  });
});

describe('Compartilhar pelo celular (menu de pastas)', () => {
  it('o menu de pastas tem o botão de compartilhar e fecha o menu antes de abrir', async () => {
    const { ListasSheet } = await import('@/pages/tarefas/components/MobileNav');
    const onCompartilhar = vi.fn();
    const onClose = vi.fn();
    render(
      <ListasSheet
        arvorePastas={montarArvorePastas([pasta({ access: 'owner' })])} temPastas selectedId={null}
        onSelecionar={vi.fn()} onNovaLista={vi.fn()} onNovaSubpasta={vi.fn()} onExcluir={vi.fn()}
        onCompartilhadas={vi.fn()} onTodas={vi.fn()} onStatus={vi.fn()} onCampos={vi.fn()} onTemplates={vi.fn()}
        onCompartilhar={onCompartilhar} onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTitle('Compartilhar'));
    expect(onClose).toHaveBeenCalled();
    expect(onCompartilhar).toHaveBeenCalledWith(expect.objectContaining({ id: 'P1' }));
  });
});
