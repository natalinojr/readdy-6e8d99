// Situação da loja para o topo das telas do cliente: "Aberto · até 23h",
// "Fecha em 20 min", "Fechado · abre às 18h". Usa o horário de Brasília.
//
// O horário (Config › Delivery) é opcional: loja que abre pela sessão de caixa
// (horário desligado) mostra só "Aberto"/"Fechado".
import type { TFunction } from 'i18next';

export type TipoSituacao = 'aberto' | 'fechando' | 'fechado';

interface Dia { open?: string; close?: string; enabled?: boolean }
interface Horario { enabled?: boolean; days?: Record<string, Dia> }

function agoraBrasilia(agora: Date): { dia: number; minutos: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(agora);
  const get = function (t: string) { return (partes.find(function (p) { return p.type === t; }) || { value: '' }).value; };
  const dias = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const h = Number(get('hour')) % 24;
  return { dia: Math.max(0, dias.indexOf(get('weekday'))), minutos: h * 60 + Number(get('minute')) };
}

function minutosDe(hhmm?: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** "18:00" → "18h", "18:30" → "18h30" */
export function horaCurta(hhmm?: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  if (!m) return hhmm || '';
  return Number(m[1]) + 'h' + (m[2] === '00' ? '' : m[2]);
}

export function situacaoLoja(
  aberto: boolean,
  motivo: string | null | undefined,
  horario: Horario | null | undefined,
  t: TFunction,
  agora: Date = new Date(),
): { tipo: TipoSituacao; texto: string; abreAs: string | null } {
  const { dia, minutos } = agoraBrasilia(agora);
  const hoje = horario && horario.enabled && horario.days ? horario.days[String(dia)] : null;
  const temHoje = !!(hoje && hoje.enabled);
  const abre = temHoje ? minutosDe(hoje!.open) : null;
  let fecha = temHoje ? minutosDe(hoje!.close) : null;
  if (abre != null && fecha != null && fecha <= abre) fecha += 24 * 60; // fecha depois da meia-noite

  // Janela de ontem que atravessa a meia-noite (ex.: 18h–01h e agora são 00h40)
  if (aberto && (fecha == null || minutos < (abre ?? 0))) {
    const ontem = horario && horario.enabled && horario.days ? horario.days[String((dia + 6) % 7)] : null;
    const abreOntem = ontem && ontem.enabled ? minutosDe(ontem.open) : null;
    const fechaOntem = ontem && ontem.enabled ? minutosDe(ontem.close) : null;
    if (abreOntem != null && fechaOntem != null && fechaOntem <= abreOntem && minutos < fechaOntem) {
      const falta = fechaOntem - minutos;
      if (falta <= 30) return { tipo: 'fechando', texto: t('cliente.fechaEm', { n: falta }), abreAs: null };
      return { tipo: 'aberto', texto: t('cliente.abertoAte', { h: horaCurta(ontem!.close) }), abreAs: null };
    }
  }

  if (aberto) {
    if (fecha != null) {
      const falta = fecha - minutos;
      if (falta > 0 && falta <= 30) return { tipo: 'fechando', texto: t('cliente.fechaEm', { n: falta }), abreAs: null };
      if (falta > 0) return { tipo: 'aberto', texto: t('cliente.abertoAte', { h: horaCurta(hoje!.close) }), abreAs: null };
    }
    return { tipo: 'aberto', texto: t('cliente.aberto'), abreAs: null };
  }
  if (motivo === 'pausado') return { tipo: 'fechado', texto: t('cliente.pausado'), abreAs: null };
  if (abre != null && minutos < abre) {
    const h = horaCurta(hoje!.open);
    return { tipo: 'fechado', texto: t('cliente.fechadoAbreAs', { h: h }), abreAs: h };
  }
  return { tipo: 'fechado', texto: t('cliente.fechado'), abreAs: null };
}
