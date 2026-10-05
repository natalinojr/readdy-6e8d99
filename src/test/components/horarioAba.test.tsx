import { useState, type ReactNode } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import HorarioAba from '../../pages/config-delivery/abas/HorarioAba';
import { DeliveryTelaContext, type DeliveryTelaApi } from '../../pages/config-delivery/DeliveryTela';
import { CONFIG_VAZIA, type ConfigDelivery } from '../../pages/config-delivery/config';
import { normalizarHorarioDelivery, janelasDoDia } from '../../../supabase/functions/_shared/horario-delivery';

// Aba Delivery › Pedido › Horário: monta a tela com um rascunho de verdade e mexe como a pessoa mexeria.
let rascunhoAtual: ConfigDelivery = CONFIG_VAZIA;

function Tela({ inicial, children }: { inicial: ConfigDelivery; children: ReactNode }) {
  const [cfg, setCfg] = useState(inicial);
  rascunhoAtual = cfg;
  const api = {
    cfg, salvo: inicial,
    mudar: (p) => setCfg((c) => ({ ...c, ...(typeof p === 'function' ? p(c) : p) })),
  } as DeliveryTelaApi;
  return <DeliveryTelaContext.Provider value={api}>{children}</DeliveryTelaContext.Provider>;
}

const comHorario = (h: unknown): ConfigDelivery => ({ ...CONFIG_VAZIA, horario: normalizarHorarioDelivery(h) });
const dia = (ints: [string, string][], enabled = true) => ({ enabled, intervals: ints.map(([open, close]) => ({ open, close })) });
const ALMOCO_JANTAR = dia([['11:00', '14:30'], ['18:00', '23:00']]);
const SEMANA = {
  enabled: true,
  days: { 0: dia([['18:00', '23:30']]), 1: dia([], false), 2: ALMOCO_JANTAR, 3: ALMOCO_JANTAR, 4: ALMOCO_JANTAR, 5: ALMOCO_JANTAR, 6: dia([['18:00', '00:30']]) },
  exceptions: [{ date: '2099-12-25', closed: true, label: 'Natal' }, { date: '2020-01-01', closed: true, label: 'Antiga' }],
};

afterEach(() => { vi.restoreAllMocks(); });

describe('HorarioAba', () => {
  it('mostra a semana, o cartão Hoje e as datas especiais', () => {
    render(<Tela inicial={comHorario(SEMANA)}><HorarioAba /></Tela>);
    expect(screen.getByText('Quando o delivery abre')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar Terça' })).toHaveTextContent('11:00–14:30 e 18:00–23:00');
    expect(screen.getByRole('button', { name: 'Editar Segunda' })).toHaveTextContent('Fechado');
    expect(screen.getByRole('button', { name: 'Editar Sábado' })).toHaveTextContent('18:00–00:30');
    expect(screen.getByText('25/12/2099 · Natal')).toBeInTheDocument();
    expect(screen.getByText('Fechado o dia todo')).toBeInTheDocument();
    expect(screen.getByText('1 data que já passou')).toBeInTheDocument();
    expect(screen.getByText(/o delivery espera e abre quando o caixa abrir/)).toBeInTheDocument();
  });

  it('desligado: explica que só vale o botão do caixa', () => {
    render(<Tela inicial={comHorario({ ...SEMANA, enabled: false })}><HorarioAba /></Tela>);
    expect(screen.getAllByText(/só abre e fecha pelo botão do caixa|abre e fecha só pelo botão do caixa/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Editar Terça' })).toBeInTheDocument();
  });

  it('editar um dia: outro horário, copiar para outro dia e Pronto', () => {
    render(<Tela inicial={comHorario(SEMANA)}><HorarioAba /></Tela>);
    fireEvent.click(screen.getByRole('button', { name: 'Editar Segunda' }));
    const folha = screen.getByText('Segunda-feira').closest('div')!.parentElement!.parentElement as HTMLElement;
    // dia fechado: liga e já vem um horário sugerido (18:00–23:00)
    fireEvent.click(within(folha).getByRole('switch', { name: 'Abre neste dia' }));
    expect(within(folha).getAllByLabelText(/^Começa/)).toHaveLength(1);
    fireEvent.click(within(folha).getByRole('button', { name: /Outro horário neste dia/ }));
    expect(within(folha).getAllByLabelText(/^Começa/)).toHaveLength(2);
    const comecos = within(folha).getAllByLabelText(/^Começa/);
    const fins = within(folha).getAllByLabelText(/^Termina/);
    fireEvent.change(comecos[0], { target: { value: '11:00' } });
    fireEvent.change(fins[0], { target: { value: '14:30' } });
    expect(within(folha).getByText('Fechado das 14:30 às 18:00')).toBeInTheDocument();
    fireEvent.click(within(folha).getByRole('button', { name: 'Qua' }));
    fireEvent.click(within(folha).getByRole('button', { name: 'Pronto' }));

    expect(screen.queryByText('Segunda-feira')).not.toBeInTheDocument();
    const h = rascunhoAtual.horario;
    expect(h.days?.['1']).toMatchObject({ enabled: true, open: '11:00', close: '23:00' });
    expect(janelasDoDia(h.days?.['1'])).toEqual([{ o: 660, c: 870 }, { o: 1080, c: 1380 }]);
    expect(h.days?.['3']).toEqual(h.days?.['1']); // Quarta recebeu a cópia
    expect(h.days?.['4']).toEqual(normalizarHorarioDelivery(SEMANA).days?.['4']); // Quinta ficou como estava
  });

  it('começo = fim bloqueia o Pronto', () => {
    render(<Tela inicial={comHorario(SEMANA)}><HorarioAba /></Tela>);
    fireEvent.click(screen.getByRole('button', { name: 'Editar Domingo' }));
    const folha = screen.getByText('Domingo', { selector: 'h3' }).parentElement!.parentElement as HTMLElement;
    fireEvent.change(within(folha).getByLabelText(/^Termina/), { target: { value: '18:00' } });
    expect(within(folha).getByText(/começo e fim iguais/)).toBeInTheDocument();
    expect(within(folha).getByRole('button', { name: 'Pronto' })).toBeDisabled();
  });

  it('modelo troca a semana inteira depois de confirmar', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Tela inicial={comHorario(SEMANA)}><HorarioAba /></Tela>);
    fireEvent.click(screen.getByRole('button', { name: 'Só jantar' }));
    await screen.findByRole('button', { name: 'Editar Segunda' });
    await vi.waitFor(() => expect(rascunhoAtual.horario.days?.['1'].enabled).toBe(true));
    expect(janelasDoDia(rascunhoAtual.horario.days?.['2'])).toEqual([{ o: 1080, c: 1380 }]);
    expect(rascunhoAtual.horario.exceptions).toHaveLength(2);
  });

  it('modelo não troca nada se a pessoa não confirmar', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Tela inicial={comHorario(SEMANA)}><HorarioAba /></Tela>);
    fireEvent.click(screen.getByRole('button', { name: 'Só jantar' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(janelasDoDia(rascunhoAtual.horario.days?.['2'])).toHaveLength(2);
  });

  it('data especial: cria com horário diferente e apaga uma que já passou', () => {
    render(<Tela inicial={comHorario(SEMANA)}><HorarioAba /></Tela>);
    fireEvent.click(screen.getByRole('button', { name: /Data$/ }));
    const folha = screen.getByText('Nova data especial').parentElement!.parentElement as HTMLElement;
    expect(within(folha).getByRole('button', { name: 'Pronto' })).toBeDisabled(); // sem dia escolhido
    fireEvent.change(within(folha).getByLabelText('Data'), { target: { value: '2099-12-31' } });
    fireEvent.change(within(folha).getByLabelText('Nome (opcional)'), { target: { value: 'Réveillon' } });
    fireEvent.click(within(folha).getByRole('button', { name: 'Horário diferente' }));
    fireEvent.change(within(folha).getByLabelText(/^Termina/), { target: { value: '21:00' } });
    fireEvent.click(within(folha).getByRole('button', { name: 'Pronto' }));
    expect(rascunhoAtual.horario.exceptions?.map((e) => e.date)).toEqual(['2020-01-01', '2099-12-25', '2099-12-31']);
    expect(screen.getByText('31/12/2099 · Réveillon')).toBeInTheDocument();
    expect(screen.getByText('Só 18:00 às 21:00')).toBeInTheDocument();

    fireEvent.click(screen.getByText('1 data que já passou'));
    fireEvent.click(screen.getByRole('button', { name: /^Apagar 01\/01\/2020/ }));
    expect(rascunhoAtual.horario.exceptions?.map((e) => e.date)).toEqual(['2099-12-25', '2099-12-31']);
  });

  it('liga o horário sem nenhum dia aberto: avisa', () => {
    render(<Tela inicial={comHorario({ enabled: true })}><HorarioAba /></Tela>);
    expect(screen.getByText(/Nenhum dia tem horário/)).toBeInTheDocument();
  });
});
