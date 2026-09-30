// Compra no cartão de crédito: em que fatura cai e quando cada parcela vence.
// A compra feita ANTES do dia de fechamento entra na fatura que fecha neste mês; no dia do
// fechamento ou depois, na do mês seguinte. A fatura vence no primeiro dia de vencimento
// depois do fechamento. Parcela N vence N−1 meses depois da 1ª.

export interface ParcelaCartao { numero: string; vencimento: string; valor: number }

const pad = (n: number) => String(n).padStart(2, '0');
const diasNoMes = (ano: number, mes0: number) => new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();
/** Data (ano, mês 0-based que pode passar de 11) com o dia limitado ao fim do mês. */
function data(ano: number, mes0: number, dia: number): string {
  const a = ano + Math.floor(mes0 / 12);
  const m = ((mes0 % 12) + 12) % 12;
  return `${a}-${pad(m + 1)}-${pad(Math.min(dia, diasNoMes(a, m)))}`;
}

export function parcelasCartao(dataCompra: string, total: number, nParcelas: number, diaFechamento: number, diaVencimento: number): ParcelaCartao[] {
  const [ano, mes, dia] = dataCompra.slice(0, 10).split('-').map(Number);
  const n = Math.max(1, Math.min(24, Math.floor(nParcelas) || 1));
  const fecha = Math.max(1, Math.min(31, Math.floor(diaFechamento) || 1));
  const vence = Math.max(1, Math.min(31, Math.floor(diaVencimento) || 1));
  // mês (0-based) em que fecha a fatura da compra
  let mesFecha = mes - 1;
  if (dia >= Math.min(fecha, diasNoMes(ano, mes - 1))) mesFecha += 1;
  // vence no mesmo mês do fechamento se o dia de vencimento vem depois; senão no seguinte
  const mesVence1 = vence > fecha ? mesFecha : mesFecha + 1;
  const centavos = Math.round(total * 100);
  const base = Math.floor(centavos / n);
  return Array.from({ length: n }, (_, i) => ({
    numero: String(i + 1),
    vencimento: data(ano, mesVence1 + i, vence),
    // sobra de centavos vai na 1ª parcela
    valor: (base + (i === 0 ? centavos - base * n : 0)) / 100,
  }));
}
