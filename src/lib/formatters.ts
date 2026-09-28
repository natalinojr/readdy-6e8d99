/**
 * Formata valor monetário em BRL.
 * Alias: `fmt` para uso inline em componentes.
 */
export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Alias curto para formatCurrency — use em componentes de relatório */
export const fmt = formatCurrency;

/**
 * Formata moeda usando o minimo de casas decimais necessario pro valor NAO
 * sumir como "R$0,00". Custo por grama/mililitro costuma ser fracao de
 * centavo (ex: um insumo a R$27/kg custa R$0,027/g) — 2 casas fixas escondem
 * esse valor atras de zero. So escalona alem de 2 casas quando 2 casas
 * arredondariam pra zero; um valor que já aparece em 2 casas (ex: R$0,03)
 * fica como está.
 */
export function formatCurrencyPreciso(value: number, maxDecimals = 6): string {
  if (!Number.isFinite(value) || value === 0) return formatCurrency(0);

  for (let decimals = 2; decimals < maxDecimals; decimals++) {
    if (Number(value.toFixed(decimals)) !== 0) {
      return value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }
  }
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: maxDecimals,
    maximumFractionDigits: maxDecimals,
  });
}

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

/**
 * Valor digitado em reais → número. Aceita "1.500,50", "1500,50", "1500.50" e "1.500" (ponto seguido de
 * exatamente 3 dígitos = milhar — antes "1.500" virava R$ 1,50). Inválido → NaN.
 */
export function lerValorBR(texto: string): number {
  const t = String(texto ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!t) return NaN;
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  return Number(t);
}
