// Contas a pagar recorrentes na PROJEÇÃO de caixa (2026-09-25).
// A edge financial-write só cria a ocorrência do mês seguinte quando a atual é quitada, então a
// tabela tem no máximo a próxima; aluguel de novembro não aparecia na previsão de 90 dias.
// Aqui geramos, só para exibir, as ocorrências que ainda não existem como linha.

export interface ContaRecorrenteBase {
  description?: string | null;
  amount: number | string;
  due_date: string;
  status: string;
  is_recurring?: boolean | null;
  recurrence_end_date?: string | null;
}

export interface OcorrenciaPrevista { description: string; amount: number; due_date: string }

/** 'YYYY-MM-DD' + n meses, no mesmo dia (31 → último dia do mês quando não existe). */
export function somarMeses(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** Ocorrências futuras (até `ate`, inclusive) das contas recorrentes que ainda não existem na tabela. */
export function ocorrenciasRecorrentes(contas: ContaRecorrenteBase[], ate: string): OcorrenciaPrevista[] {
  // Última ocorrência de cada recorrente (pela descrição, como a edge faz para não duplicar)
  const ultima = new Map<string, ContaRecorrenteBase>();
  for (const c of contas) {
    if (!c.is_recurring || c.status === 'cancelled') continue;
    const k = String(c.description ?? '').trim().toLowerCase();
    const atual = ultima.get(k);
    if (!atual || c.due_date > atual.due_date) ultima.set(k, c);
  }
  const out: OcorrenciaPrevista[] = [];
  for (const c of ultima.values()) {
    const fim = c.recurrence_end_date && c.recurrence_end_date < ate ? c.recurrence_end_date : ate;
    for (let n = 1; n <= 36; n++) {
      const due = somarMeses(c.due_date, n);
      if (due > fim) break;
      out.push({ description: String(c.description ?? 'Conta recorrente'), amount: Number(c.amount), due_date: due });
    }
  }
  return out;
}
