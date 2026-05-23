/**
 * Formata valor monetário em BRL.
 * Alias: `fmt` para uso inline em componentes.
 */
export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Alias curto para formatCurrency — use em componentes de relatório */
export const fmt = formatCurrency;

export function formatPercent(value: number, decimals = 1): string {
  return value.toFixed(decimals) + '%';
}

const TZ = 'America/Sao_Paulo';

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ });
}

/** Formata apenas o horário: HH:mm */
export function formatTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

/** Formata data + hora: dd/MM/yy HH:mm */
export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
}

/** Formata data para input[type=date]: YYYY-MM-DD */
export function formatDateInput(date: Date): string {
  return date.toISOString().split('T')[0];
}
