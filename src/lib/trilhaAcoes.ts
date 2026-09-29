// Contas puras dos painéis da Trilha (fase 2): parcelas da conta a pagar que falta, link do
// WhatsApp para pedir o boleto e dias de atraso. Testadas em src/test/lib/trilhaAcoes.test.ts.

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Soma `n` dias a uma data 'AAAA-MM-DD' (sem fuso: conta em UTC). */
export function somarDias(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Divide o total em `n` parcelas iguais; a última leva os centavos que sobram. */
export function dividirParcelas(total: number, n: number): number[] {
  const qtd = Math.max(1, Math.floor(n));
  const base = Math.floor((total / qtd) * 100) / 100;
  const out = Array.from({ length: qtd }, () => base);
  out[qtd - 1] = round2(total - base * (qtd - 1));
  return out;
}

/** Vencimentos padrão: data da compra +30, +60, +90… dias. */
export function vencimentosPadrao(dataCompra: string, n: number): string[] {
  return Array.from({ length: Math.max(1, n) }, (_, i) => somarDias(dataCompra, 30 * (i + 1)));
}

/** A soma das parcelas fecha com o total da compra (tolerância de 1 centavo)? */
export function somaFecha(valores: number[], total: number): boolean {
  return Math.abs(round2(valores.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0)) - round2(total)) <= 0.01;
}

/** Link do WhatsApp com a mensagem pronta. Telefone que já vem com 55 não duplica. */
export function linkWhatsApp(telefone: string, mensagem: string): string | null {
  let d = String(telefone ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  if (!(d.startsWith('55') && d.length >= 12)) d = '55' + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(mensagem)}`;
}

/** Dias entre o vencimento e hoje (0 se ainda não venceu). */
export function diasAtraso(vencimento: string, hoje: string): number {
  const t = (x: string) => Date.UTC(Number(x.slice(0, 4)), Number(x.slice(5, 7)) - 1, Number(x.slice(8, 10)));
  return Math.max(0, Math.round((t(hoje) - t(vencimento)) / 86400000));
}
