import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({}));

import ItemRelatorio from '@/pages/tarefas/relatorios/ItemRelatorio';
import type { ItemRel } from '@/pages/tarefas/relatorios/api';

const item: ItemRel = {
  id: 'i1', position: 1, title: 'Pia vazando', body: 'Resolver até sexta?', images: [], status: 'answered',
  created_by_guest_name: null, created_at: '2026-09-24T10:00:00Z', updated_at: '2026-09-24T10:00:00Z',
  responses: [
    { id: 'r1', kind: 'reply', body: 'Vou mandar o encanador', images: [], new_status: null, author_name: 'Carlos', author_type: 'guest', author_guest_id: 'g1', created_at: '2026-09-24T11:00:00Z' },
    { id: 'r2', kind: 'reply', body: 'Trocado', images: [], new_status: 'resolved', author_name: 'Maria', author_type: 'guest', author_guest_id: 'g2', created_at: '2026-09-24T12:00:00Z' },
    { id: 'r3', kind: 'edit', body: 'Título anterior: Pia', images: [], new_status: null, author_name: 'Dono', author_type: 'owner', author_guest_id: null, created_at: '2026-09-24T13:00:00Z' },
  ],
};

describe('ItemRelatorio', () => {
  it('mostra a sequência de respostas com autor, marca a da pessoa atual e o evento de edição', () => {
    render(<ItemRelatorio item={item} numero={1} podeResponder meuGuestId="g2" onResponder={vi.fn()} onEnviarImagem={vi.fn()} />);
    expect(screen.getByText('Vou mandar o encanador')).toBeTruthy();
    expect(screen.getByText('Carlos')).toBeTruthy();
    expect(screen.getByText('Maria (você)')).toBeTruthy();
    expect(screen.getByText('resolvido')).toBeTruthy();
    expect(screen.getByText(/editou o item/)).toBeTruthy();
  });

  it('envia a resposta com o texto digitado e sem status', async () => {
    const onResponder = vi.fn().mockResolvedValue(true);
    render(<ItemRelatorio item={{ ...item, responses: [] }} numero={1} podeResponder onResponder={onResponder} onEnviarImagem={vi.fn()} />);
    fireEvent.click(screen.getByText('Responder'));
    fireEvent.change(screen.getByPlaceholderText('Escreva sua resposta…'), { target: { value: 'Feito ontem' } });
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(onResponder).toHaveBeenCalledWith('Feito ontem', [], null));
  });

  it('sem permissão de responder (relatório encerrado) não mostra a caixa', () => {
    render(<ItemRelatorio item={item} numero={1} podeResponder={false} onResponder={vi.fn()} onEnviarImagem={vi.fn()} />);
    expect(screen.queryByText('Responder')).toBeNull();
  });
});
