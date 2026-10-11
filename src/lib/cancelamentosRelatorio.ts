// Contas da aba Relatórios › Cancelamentos (itens vindos de fn_get_cancelamentos_report). Ficam aqui, fora do
// componente, para poderem ser testadas.
import { dateKeyBrasilia } from './dateUtils';

type Item = Record<string, unknown>;

const FORMATO_HORA = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' });

const dataValida = (v: unknown): Date | null => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Hora cheia (0–23, Brasília) de um item: a `hora` 'HH:MM' que a RPC já devolve em Brasília, ou a `data`. */
export function horaCheia(c: Item): number | null {
  const m = /^(\d{1,2}):\d{2}/.exec(String(c.hora ?? ''));
  if (m) return Number(m[1]) % 24;
  const d = dataValida(c.data);
  return d ? Number(FORMATO_HORA.format(d)) % 24 : null;
}

/** Chave do pedido no dia (Brasília): o número do pedido recomeça a cada sessão, então só ele não basta. */
export function chavePedidoDia(c: Item): string {
  const d = dataValida(c.data);
  return `${String(c.pedido ?? '')}|${d ? dateKeyBrasilia(d) : ''}`;
}

/**
 * Estornos de pedidos que NÃO foram cancelados. Pedido cancelado que também teve o pagamento estornado é uma perda
 * só: o estorno dele já está no valor do cancelamento. Casa pelo id do pedido (`order_id` do estorno, quando a RPC
 * mandar) ou, sem ele, pelo número do pedido no mesmo dia.
 */
export function estornosSemCancelamento(cancelamentos: Item[], estornos: Item[]): Item[] {
  const ids = new Set(cancelamentos.map((c) => String(c.id ?? '')));
  const chaves = new Set(cancelamentos.map(chavePedidoDia));
  return estornos.filter((e) => (e.order_id ? !ids.has(String(e.order_id)) : !chaves.has(chavePedidoDia(e))));
}

export interface CancelamentoHora { hora: number; dia: string; count: number; total: number }

/** Cancelamentos agrupados por hora do dia (Brasília), em ordem de hora e sem cortar nenhuma. */
export function cancelamentosPorHora(cancelamentos: Item[]): CancelamentoHora[] {
  const mapa = new Map<number, { count: number; total: number }>();
  for (const c of cancelamentos) {
    const h = horaCheia(c);
    if (h === null) continue;
    const atual = mapa.get(h) ?? { count: 0, total: 0 };
    atual.count += 1;
    atual.total += Number(c.valor ?? 0);
    mapa.set(h, atual);
  }
  return [...mapa.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hora, d]) => ({ hora, dia: `${String(hora).padStart(2, '0')}h`, count: d.count, total: d.total }));
}
