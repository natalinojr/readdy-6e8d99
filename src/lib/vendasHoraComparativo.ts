import { somarDias } from '@/lib/dateUtils';

// Gráfico "Vendas por Hora" do Dashboard: linhas de comparação com o dia anterior,
// o mesmo dia da semana passada e o mesmo dia da semana 4 semanas atrás (≈ mês passado, sem trocar o dia da semana).

export type Comparacao = 'ontem' | 'semana' | 'mes';

/** Dias comparados a partir de hoje ('YYYY-MM-DD', Brasília). 'mes' = 28 dias atrás, mesmo dia da semana. */
export function diasComparacao(hoje: string): Record<Comparacao, string> {
  return { ontem: somarDias(hoje, -1), semana: somarDias(hoje, -7), mes: somarDias(hoje, -28) };
}

/** Hora cheia ('HH') em Brasília de um timestamp. */
export function horaBrasilia(ts: string): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).slice(0, 2);
}

export interface PontoVendasHora {
  hora: string;
  /** total da hora (PDV + iFood); ausente nas horas que ainda não chegaram */
  valor?: number;
  ifood?: number;
  ontem?: number;
  semana?: number;
  mes?: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Junta hoje (PDV + iFood, por 'HH') com as séries de comparação (por 'HH').
 * Eixo = da primeira à última hora com venda em qualquer série; hora sem venda = 0.
 * Hoje para na hora atual (`horaAgora`), para a linha não cair a zero no futuro.
 */
export function montarVendasHora(
  hojePdv: Record<string, number>,
  hojeIfood: Record<string, number>,
  comparacoes: Partial<Record<Comparacao, Record<string, number>>>,
  horaAgora: number,
): PontoVendasHora[] {
  const horas = new Set<number>();
  const marcar = (s?: Record<string, number>) => {
    for (const [h, v] of Object.entries(s ?? {})) if (v) horas.add(Number(h));
  };
  marcar(hojePdv); marcar(hojeIfood);
  for (const s of Object.values(comparacoes)) marcar(s);
  if (horas.size === 0) return [];

  const ini = Math.min(...horas);
  const fim = Math.max(...horas);
  const out: PontoVendasHora[] = [];
  for (let h = ini; h <= fim; h++) {
    const hh = String(h).padStart(2, '0');
    // Dashboard: hora desde a 0h do dia da loja — a madrugada da sessão que passou da meia-noite vem como 24, 25…
    const p: PontoVendasHora = { hora: `${String(h % 24).padStart(2, '0')}:00` };
    if (h <= horaAgora) {
      const ifood = hojeIfood[hh] ?? 0;
      p.valor = r2((hojePdv[hh] ?? 0) + ifood);
      p.ifood = r2(ifood);
    }
    for (const k of ['ontem', 'semana', 'mes'] as const) {
      const s = comparacoes[k];
      if (s) p[k] = r2(s[hh] ?? 0);
    }
    out.push(p);
  }
  return out;
}
