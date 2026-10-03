import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import HorarioExibicaoEditor from '@/components/feature/HorarioExibicaoEditor';
import type { HorarioExibicao } from '@/lib/horarioExibicao';

function Controlado({ inicial = null as HorarioExibicao, onChange = (_h: HorarioExibicao) => {} }) {
  const [h, setH] = useState<HorarioExibicao>(inicial);
  return <HorarioExibicaoEditor value={h} onChange={(v) => { setH(v); onChange(v); }} labelSempre="Segue o horário do item" />;
}

describe('HorarioExibicaoEditor', () => {
  it('começa em "sempre" e liga uma faixa de todos os dias', () => {
    const spy = vi.fn();
    render(<Controlado onChange={spy} />);
    expect(screen.getByText('Segue o horário do item')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Só em horários definidos'));
    expect(spy).toHaveBeenLastCalledWith([{ days: [0, 1, 2, 3, 4, 5, 6], start: '11:00', end: '15:00' }]);
    expect(screen.getByText(/Todos os dias 11:00–15:00/)).toBeInTheDocument();
  });

  it('tira um dia, mostra "passa da meia-noite" e volta para sempre', () => {
    const spy = vi.fn();
    render(<Controlado inicial={[{ days: [5, 6], start: '18:00', end: '02:00' }]} onChange={spy} />);
    expect(screen.getByText('passa da meia-noite')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sáb'));
    expect(spy).toHaveBeenLastCalledWith([{ days: [5], start: '18:00', end: '02:00' }]);
    fireEvent.click(screen.getByText('Sex'));
    expect(screen.getByText(/Escolha pelo menos um dia/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Segue o horário do item'));
    expect(spy).toHaveBeenLastCalledWith(null);
  });

  it('escolhe o canal da faixa e some o seletor quando só há um canal', () => {
    const spy = vi.fn();
    const { unmount } = render(<Controlado inicial={[{ days: [1], start: '08:00', end: '10:00' }]} onChange={spy} />);
    fireEvent.click(screen.getByText('Só delivery'));
    expect(spy).toHaveBeenLastCalledWith([{ days: [1], start: '08:00', end: '10:00', channel: 'delivery' }]);
    expect(screen.getByText(/Delivery: Seg 08:00–10:00/)).toBeInTheDocument();
    expect(screen.getByText(/Casa: sempre/)).toBeInTheDocument();
    unmount();
    render(<HorarioExibicaoEditor value={[{ days: [1], start: '08:00', end: '10:00' }]} onChange={() => {}} canais={['casa']} />);
    expect(screen.queryByText('Só delivery')).toBeNull();
  });

  it('remover a última faixa volta para sempre', () => {
    const spy = vi.fn();
    render(<Controlado inicial={[{ days: [1], start: '08:00', end: '10:00' }]} onChange={spy} />);
    fireEvent.click(screen.getByTitle('Remover este horário'));
    expect(spy).toHaveBeenLastCalledWith(null);
  });
});
