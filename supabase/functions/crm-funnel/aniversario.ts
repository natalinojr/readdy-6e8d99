// Aniversariantes do funil de CRM (cartão "Aniversariantes" da aba Quem chamar).
// Código puro, sem imports: roda na Edge (Deno) e nos testes (src/test/edge/crmAniversario.test.ts).
//
// Janela: de hoje até hoje + 6 dias (7 dias no total), no calendário de Brasília.
// Vira o ano (dezembro → janeiro) e quem nasceu em 29/02 comemora em 28/02 nos anos
// não bissextos.

/** Dias à frente que entram na lista: hoje (0) até hoje + 6. */
export const JANELA_ANIVERSARIO_DIAS = 7;

export interface DataBR { y: number; m: number; d: number }

/** Data de hoje no calendário de Brasília (o servidor roda em UTC). */
export function hojeBrasilia(agora: Date = new Date()): DataBR {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(agora); // "2026-10-05"
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function anoBissexto(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const diaN = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400000);
const dois = (n: number) => String(n).padStart(2, "0");

export interface ProximoAniversario {
  /** 0 = hoje. */
  dias: number;
  /** Data em que a pessoa comemora, 'YYYY-MM-DD' (29/02 vira 28/02 em ano não bissexto). */
  data: string;
  /** Ano em que cai o aniversário (pode ser o ano seguinte na virada de dezembro). */
  ano: number;
  /** 'dd/mm' da data em que comemora. */
  dd_mm: string;
}

/** Próximo aniversário a partir de hoje. `nascimento` é 'YYYY-MM-DD' (customers.birth_date).
 *  null = data ausente ou inválida. */
export function proximoAniversario(nascimento: unknown, hoje: DataBR): ProximoAniversario | null {
  const mt = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(nascimento ?? ""));
  if (!mt) return null;
  const m = Number(mt[2]);
  const d = Number(mt[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const hojeN = diaN(hoje.y, hoje.m, hoje.d);
  for (const y of [hoje.y, hoje.y + 1]) {
    const dia = m === 2 && d === 29 && !anoBissexto(y) ? 28 : d;
    const n = diaN(y, m, dia);
    if (n >= hojeN) {
      return { dias: n - hojeN, data: `${y}-${dois(m)}-${dois(dia)}`, ano: y, dd_mm: `${dois(dia)}/${dois(m)}` };
    }
  }
  return null; // inalcançável: o ano seguinte sempre está à frente
}

/** Está dentro da janela de aniversariantes (hoje até hoje + 6)? */
export function naJanela(p: ProximoAniversario | null): p is ProximoAniversario {
  return !!p && p.dias >= 0 && p.dias < JANELA_ANIVERSARIO_DIAS;
}

/** Texto gravado em vouchers.notes pelo gerador de aniversário (fn_generate_birthday_vouchers). */
export function notaVoucherAniversario(ano: number): string {
  return `Aniversário ${ano}`;
}
