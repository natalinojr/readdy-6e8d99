// Recorrência de tarefas: cálculo da próxima data (mesma lógica da Edge task-write).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EditorRecorrencia from '@/pages/tarefas/components/EditorRecorrencia';
import { descreverRecorrencia, proximaOcorrencia, proximasOcorrencias, validarRecorrencia } from '../../../supabase/functions/_shared/recorrencia';

// "agora" fixo: quarta, 23/09/2026 10:00 em Brasília (13:00Z)
const AGORA = new Date('2026-09-23T13:00:00Z');
const dia = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(0, 16) : null);

describe('proximaOcorrencia', () => {
  it('diária e a cada N dias (compatível com o formato antigo)', () => {
    expect(dia(proximaOcorrencia('2026-09-23T12:00:00Z', { freq: 'daily', interval: 1 }, AGORA))).toBe('2026-09-24T09:00');
    expect(dia(proximaOcorrencia('2026-09-23T12:00:00Z', { freq: 'daily', interval: 3 }, AGORA))).toBe('2026-09-26T09:00');
  });

  it('pula ocorrências que ficaram no passado (concluída com atraso)', () => {
    // vencia 18/09, diária: a próxima é hoje (23), não 19
    expect(dia(proximaOcorrencia('2026-09-18T12:00:00Z', { freq: 'daily' }, AGORA))).toBe('2026-09-23T09:00');
  });

  it('semanal em dias escolhidos (seg, qua, sex)', () => {
    const rec = { freq: 'weekly', dias_semana: [1, 3, 5] };
    // qua 23 → sex 25 → seg 28 → qua 30
    expect(proximasOcorrencias('2026-09-23T12:00:00Z', rec, 3, AGORA).map(dia)).toEqual([
      '2026-09-25T09:00', '2026-09-28T09:00', '2026-09-30T09:00',
    ]);
  });

  it('a cada 2 semanas, na terça', () => {
    const rec = { freq: 'weekly', interval: 2, dias_semana: [2] };
    // ter 22 → ter 06/10 (pula a semana do dia 29)
    expect(dia(proximaOcorrencia('2026-09-22T12:00:00Z', rec, new Date('2026-09-22T13:00:00Z')))).toBe('2026-10-06T09:00');
  });

  it('dias úteis mantém o horário e não vira o dia por causa do UTC (22h de sexta → 22h de segunda)', () => {
    const sexta22h = '2026-09-26T01:00:00Z'; // sex 25/09 22:00 em Brasília
    expect(dia(proximaOcorrencia(sexta22h, { freq: 'weekly', dias_semana: [1, 2, 3, 4, 5] }, AGORA))).toBe('2026-09-28T22:00');
  });

  it('mensal no dia 31 cai no último dia dos meses curtos', () => {
    const rec = { freq: 'monthly', mensal: { tipo: 'dia' as const, dia: 31 } };
    expect(proximasOcorrencias('2026-10-31T12:00:00Z', rec, 3, AGORA).map((d) => dia(d)!.slice(0, 10))).toEqual([
      '2026-11-30', '2026-12-31', '2027-01-31',
    ]);
  });

  it('mensal no último dia e na última sexta do mês', () => {
    expect(dia(proximaOcorrencia('2026-09-23T12:00:00Z', { freq: 'monthly', mensal: { tipo: 'dia', dia: -1 } }, AGORA))!.slice(0, 10)).toBe('2026-09-30');
    // última sexta de outubro/2026 = 30/10
    expect(dia(proximaOcorrencia('2026-09-25T12:00:00Z', { freq: 'monthly', mensal: { tipo: 'semana', ordem: -1, dia_semana: 5 } }, AGORA))!.slice(0, 10)).toBe('2026-10-30');
    // 1ª segunda de outubro/2026 = 05/10
    expect(dia(proximaOcorrencia('2026-09-23T12:00:00Z', { freq: 'monthly', mensal: { tipo: 'semana', ordem: 1, dia_semana: 1 } }, AGORA))!.slice(0, 10)).toBe('2026-10-05');
  });

  it('anual e data para terminar', () => {
    expect(dia(proximaOcorrencia('2028-02-29T12:00:00Z', { freq: 'yearly' }, AGORA))!.slice(0, 10)).toBe('2029-02-28');
    expect(proximaOcorrencia('2026-09-23T12:00:00Z', { freq: 'daily', ate: '2026-09-23' }, AGORA)).toBeNull();
    expect(proximasOcorrencias('2026-09-23T12:00:00Z', { freq: 'daily', ate: '2026-09-25' }, 5, AGORA)).toHaveLength(2);
  });
});

describe('descrever e validar', () => {
  it('descreve em português', () => {
    expect(descreverRecorrencia({ freq: 'weekly', dias_semana: [1, 2, 3, 4, 5] })).toBe('Dias úteis (seg a sex)');
    expect(descreverRecorrencia({ freq: 'weekly', dias_semana: [5, 1, 3] })).toBe('Toda semana: seg, qua e sex');
    expect(descreverRecorrencia({ freq: 'monthly', mensal: { tipo: 'semana', ordem: -1, dia_semana: 5 } })).toBe('Todo mês na última sexta');
    expect(descreverRecorrencia({ freq: 'monthly', interval: 2, mensal: { tipo: 'dia', dia: 10 } })).toBe('A cada 2 meses no dia 10');
    expect(descreverRecorrencia({ freq: 'daily', ate: '2026-12-31' })).toBe('Todo dia até 31/12/2026');
    expect(descreverRecorrencia(null)).toBeNull();
  });

  it('valida o que chega no servidor', () => {
    expect(validarRecorrencia(null)).toBeNull();
    expect(validarRecorrencia({ freq: 'weekly', dias_semana: [1, 3] })).toBeNull();
    expect(validarRecorrencia({ freq: 'hourly' })).not.toBeNull();
    expect(validarRecorrencia({ freq: 'weekly', dias_semana: [9] })).not.toBeNull();
    expect(validarRecorrencia({ freq: 'monthly', mensal: { tipo: 'semana', ordem: 5, dia_semana: 1 } })).not.toBeNull();
  });
});


describe('EditorRecorrencia', () => {
  const rect = { top: 100, bottom: 120, left: 10, right: 200, width: 190, height: 20 } as DOMRect;

  it('atalho grava direto e fecha', () => {
    const onSalvar = vi.fn(); const onClose = vi.fn();
    render(<EditorRecorrencia atual={null} vencimento="2026-09-23T12:00:00Z" anchorRect={rect} onSalvar={onSalvar} onClose={onClose} />);
    fireEvent.click(screen.getByText('Dias úteis (seg a sex)'));
    expect(onSalvar).toHaveBeenCalledWith({ freq: 'weekly', interval: 1, dias_semana: [1, 2, 3, 4, 5] });
    expect(onClose).toHaveBeenCalled();
  });

  it('personalizar: a cada 2 semanas, seg e qua (vencimento numa quarta)', () => {
    const onSalvar = vi.fn();
    render(<EditorRecorrencia atual={null} vencimento="2026-09-23T12:00:00Z" anchorRect={rect} onSalvar={onSalvar} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(/Personalizar/));
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } });
    fireEvent.click(screen.getByTitle('segunda'));
    expect(screen.getByText('A cada 2 semanas: seg e qua')).toBeTruthy();
    fireEvent.click(screen.getByText('Salvar'));
    expect(onSalvar).toHaveBeenCalledWith({ freq: 'weekly', interval: 2, dias_semana: [3, 1] });
  });
});
