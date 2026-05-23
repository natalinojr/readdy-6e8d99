/**
 * dateUtils.ts
 * Utilitários centralizados de datas para relatórios e filtros.
 * Elimina a duplicação de getPeriodDates/getDateRange em múltiplos hooks.
 *
 * BUG 2.1 FIX: Todas as formatações de hora/data de pedidos usam SEMPRE
 * America/Sao_Paulo, eliminando divergência entre telas.
 */

const TIMEZONE = 'America/Sao_Paulo';

/**
 * Formata a hora de um pedido (timestamp ms ou ISO string) sempre em Brasília.
 * Use este helper em TODAS as telas que exibem hora de criação de pedido.
 * Ex: "14:35" ou "14:35:22"
 */
export function formatOrderTime(dateOrTs: number | string | Date, withSeconds = false): string {
  const d = dateOrTs instanceof Date ? dateOrTs : new Date(dateOrTs);
  return d.toLocaleTimeString('pt-BR', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  });
}

/**
 * Formata a data de um pedido (timestamp ms ou ISO string) sempre em Brasília.
 * Ex: "21/04/2026"
 */
export function formatOrderDate(dateOrTs: number | string | Date): string {
  const d = dateOrTs instanceof Date ? dateOrTs : new Date(dateOrTs);
  return d.toLocaleDateString('pt-BR', { timeZone: TIMEZONE });
}

/**
 * Retorna a data de hoje em Brasília no formato YYYY-MM-DD.
 * Usado para comparações de "é hoje".
 */
export function todayBrasilia(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

/**
 * Retorna timestamps início/fim do dia em Brasília para queries no banco.
 * O banco armazena em UTC; usamos offset fixo -03:00 para garantir que
 * o filtro bata exatamente com o dia local de Brasília.
 */
export function getTodayBrasiliaRange(): { fromTs: string; toTs: string } {
  const today = todayBrasilia();
  return {
    fromTs: `${today}T00:00:00-03:00`,
    toTs:   `${today}T23:59:59-03:00`,
  };
}

export type PeriodoString =
  | 'Hoje'
  | 'Ontem'
  | '7 dias'
  | '30 dias'
  | `custom:${string}:${string}`;

/** Retorna { from, to } como strings ISO para qualquer período */
export function getPeriodDates(periodo: string): { from: string; to: string } {
  if (periodo.startsWith('custom:')) {
    const [, s, e] = periodo.split(':');
    // Datas custom usam fuso Brasília explícito (-03:00)
    return {
      from: `${s}T00:00:00-03:00`,
      to:   `${e}T23:59:59-03:00`,
    };
  }
  // Usa helper que já garante o fuso de Brasília
  const todayBR = todayBrasilia(); // YYYY-MM-DD em Brasília
  const [y, m, d] = todayBR.split('-').map(Number);

  // Calcula datas relativas subtraindo dias no calendário de Brasília
  const brasiliaDate = (offsetDays: number): string => {
    const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
    return dt.toISOString().split('T')[0];
  };

  switch (periodo) {
    case 'Hoje':
      return {
        from: `${brasiliaDate(0)}T00:00:00-03:00`,
        to:   `${brasiliaDate(0)}T23:59:59-03:00`,
      };
    case 'Ontem':
      return {
        from: `${brasiliaDate(-1)}T00:00:00-03:00`,
        to:   `${brasiliaDate(-1)}T23:59:59-03:00`,
      };
    case '7d':
    case '7 dias':
      return {
        from: `${brasiliaDate(-6)}T00:00:00-03:00`,
        to:   `${brasiliaDate(0)}T23:59:59-03:00`,
      };
    case '30d':
    case '30 dias':
      return {
        from: `${brasiliaDate(-29)}T00:00:00-03:00`,
        to:   `${brasiliaDate(0)}T23:59:59-03:00`,
      };
    case 'Mês':
    case 'Este mês': {
      const firstDayOfMonth = `${y}-${String(m).padStart(2, '0')}-01`;
      return {
        from: `${firstDayOfMonth}T00:00:00-03:00`,
        to:   `${brasiliaDate(0)}T23:59:59-03:00`,
      };
    }
    case '3m':
    case '3 meses':
      return {
        from: `${brasiliaDate(-89)}T00:00:00-03:00`,
        to:   `${brasiliaDate(0)}T23:59:59-03:00`,
      };
    default:
      return {
        from: `${brasiliaDate(0)}T00:00:00-03:00`,
        to:   `${brasiliaDate(0)}T23:59:59-03:00`,
      };
  }
}

/** Retorna { from, to } como objetos Date */
export function getPeriodDateObjects(periodo: string): { from: Date; to: Date } {
  const { from, to } = getPeriodDates(periodo);
  return { from: new Date(from), to: new Date(to) };
}

/**
 * Calcula o período anterior proporcional.
 * Ex: "7 dias" → os 7 dias anteriores ao período selecionado.
 * Retorna string no formato "custom:YYYY-MM-DD:YYYY-MM-DD"
 */
export function getPeriodoAnterior(periodo: string): string {
  const { from, to } = getPeriodDateObjects(periodo);
  const diffMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - diffMs + 1);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return `custom:${fmt(prevFrom)}:${fmt(prevTo)}`;
}

/** Label legível do período anterior (ex: "7 dias anteriores", "ontem") */
export function labelPeriodoAnterior(periodo: string): string {
  const { from, to } = getPeriodDateObjects(periodo);
  const diffDias = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (diffDias === 1) return 'ontem';
  return `${diffDias}d anteriores`;
}

/** Formata um período para exibição legível */
export function labelPeriodo(periodo: string): string {
  if (periodo.startsWith('custom:')) {
    const [, s, e] = periodo.split(':');
    const fmt = (d: string) => {
      const [y, m, dia] = d.split('-');
      return `${dia}/${m}/${y}`;
    };
    return s === e ? fmt(s) : `${fmt(s)} → ${fmt(e)}`;
  }
  return periodo;
}

/** Número de dias do período */
export function periodoDias(periodo: string): number {
  const { from, to } = getPeriodDateObjects(periodo);
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
}
