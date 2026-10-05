// Situação da loja para o topo das telas do cliente: "Aberto · até 23h",
// "Fecha em 20 min", "Fechado · abre às 18h". Usa o horário de Brasília.
//
// O horário (Delivery › Pedido › Horário) é opcional: loja que abre pela sessão de caixa
// (horário desligado) mostra só "Aberto"/"Fechado". A conta do horário (vários horários no
// mesmo dia, datas especiais, passar da meia-noite) é a regra única de
// supabase/functions/_shared/horario-delivery.ts — a mesma que abre e fecha o delivery no servidor.
import type { TFunction } from 'i18next';
import { janelaAgora, proximaAbertura, hhmm, type HorarioDelivery } from '../../supabase/functions/_shared/horario-delivery';

export type TipoSituacao = 'aberto' | 'fechando' | 'fechado';

/** "18:00" → "18h", "18:30" → "18h30" */
export function horaCurta(hhmmTxt?: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmmTxt || '');
  if (!m) return hhmmTxt || '';
  return Number(m[1]) + 'h' + (m[2] === '00' ? '' : m[2]);
}

export function situacaoLoja(
  aberto: boolean,
  motivo: string | null | undefined,
  horario: HorarioDelivery | null | undefined,
  t: TFunction,
  agora: Date = new Date(),
): { tipo: TipoSituacao; texto: string; abreAs: string | null } {
  if (aberto) {
    // Aberto pelo horário: diz até quando vai o horário em curso (o almoço fecha às 14h30, não às 23h).
    const atual = janelaAgora(horario, agora);
    if (atual) {
      if (atual.faltam <= 30) return { tipo: 'fechando', texto: t('cliente.fechaEm', { n: atual.faltam }), abreAs: null };
      return { tipo: 'aberto', texto: t('cliente.abertoAte', { h: horaCurta(hhmm(atual.janela.c)) }), abreAs: null };
    }
    return { tipo: 'aberto', texto: t('cliente.aberto'), abreAs: null };
  }
  if (motivo === 'pausado') return { tipo: 'fechado', texto: t('cliente.pausado'), abreAs: null };
  // Fechado entre o almoço e a janta, ou antes de abrir: "abre às 18h" (só quando reabre hoje).
  const prox = proximaAbertura(horario, agora);
  if (prox && prox.emDias === 0) {
    const h = horaCurta(prox.hora);
    return { tipo: 'fechado', texto: t('cliente.fechadoAbreAs', { h }), abreAs: h };
  }
  return { tipo: 'fechado', texto: t('cliente.fechado'), abreAs: null };
}
