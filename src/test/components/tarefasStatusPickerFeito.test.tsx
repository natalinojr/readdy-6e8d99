// "Feito" no computador: o menu tem que mandar o mesmo payload do celular
// (category done + status_keep_visible), nunca a chave interna 'feito' como categoria
// (o servidor não achava status e ignorava a mudança em silêncio).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StatusPicker from '@/pages/tarefas/components/StatusPicker';

const rect = { top: 100, bottom: 120, left: 50, right: 90, width: 40, height: 20, x: 50, y: 100, toJSON: () => ({}) } as DOMRect;

describe('StatusPicker (computador)', () => {
  it('Feito sem pasta única manda done + keep_visible', () => {
    const onEscolher = vi.fn();
    render(<StatusPicker list={null} anchorRect={rect} onEscolher={onEscolher} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Feito'));
    expect(onEscolher).toHaveBeenCalledWith({ status_category: 'done', status_keep_visible: true });
  });

  it('Concluído sem pasta única manda só a categoria done', () => {
    const onEscolher = vi.fn();
    render(<StatusPicker list={null} anchorRect={rect} onEscolher={onEscolher} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Concluído'));
    expect(onEscolher).toHaveBeenCalledWith({ status_category: 'done' });
  });
});
