// "Dia da loja" (regra do dono, 2026-10-04): o número do dia é a SOMA DAS SESSÕES DE CAIXA ABERTAS NAQUELE DIA.
// A sessão que passa da meia-noite conta inteira no dia em que abriu. No banco: fn_loja_dia_atual /
// fn_loja_pedidos_dias / fn_loja_janelas (migração 20261004120000). O PDV já vem somado do banco; aqui fica a
// parte do iFood, que não passa pelo PDV: o pedido entra no dia da sessão aberta na hora dele e, fora de
// sessão, na data do pedido.

const TZ = 'America/Sao_Paulo';

/** Sessão de caixa (de fn_loja_janelas): `dia` = dia em que abriu; `fim` null = ainda aberta. */
export interface JanelaSessao { dia: string; ini: string; fim: string | null }

/** 'YYYY-MM-DD' em Brasília. */
export const dataBrasilia = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });

/** 0h de um dia ('YYYY-MM-DD') em Brasília (sem horário de verão desde 2019). */
export const inicioDoDia = (dia: string) => new Date(`${dia}T00:00:00-03:00`);

const somarUmDia = (dia: string) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Horas desde a 0h do dia da loja (depois da meia-noite: 24, 25…). */
export const horaDoDia = (at: Date, dia: string) => Math.floor((at.getTime() - inicioDoDia(dia).getTime()) / 3_600_000);

/** Dia da loja de um pedido de fora do PDV: o da sessão aberta na hora (a mais recente, se houver duas). */
export function diaDoPedido(at: Date, janelas: JanelaSessao[]): string {
  const t = at.getTime();
  let melhor: JanelaSessao | null = null;
  for (const j of janelas) {
    const ini = new Date(j.ini).getTime();
    if (t < ini || (j.fim && t >= new Date(j.fim).getTime())) continue;
    if (!melhor || ini > new Date(melhor.ini).getTime()) melhor = j;
  }
  return melhor ? melhor.dia : dataBrasilia(at);
}

/**
 * Janela de busca para os dias [d1, d2]: da 0h de d1 até o fim da última sessão desses dias (aberta = agora),
 * no mínimo a 0h do dia seguinte a d2. `corte` limita o fim (comparação "até a mesma hora").
 */
export function janelaDeBusca(d1: string, d2: string, janelas: JanelaSessao[], corte?: Date | null, agora = new Date()) {
  let fim = inicioDoDia(somarUmDia(d2)).getTime();
  for (const j of janelas) {
    if (j.dia < d1 || j.dia > d2) continue;
    fim = Math.max(fim, j.fim ? new Date(j.fim).getTime() : agora.getTime());
  }
  if (corte) fim = Math.min(fim, Math.max(corte.getTime(), inicioDoDia(d2).getTime()));
  return { from: inicioDoDia(d1).toISOString(), to: new Date(fim).toISOString() };
}

export interface PedidoValor { at: string; valor: number; aoVivo?: boolean }

export interface SomaDiasLoja {
  total: number;
  pedidos: number;
  pedidosAoVivo: number;
  /** dia da loja → valor */
  porDia: Record<string, number>;
  /** horas desde a 0h do dia da loja → valor (para período de um dia) */
  porHora: Record<number, number>;
}

/**
 * Soma os pedidos que caem nos dias da loja [d1, d2]. Com `corte`, no último dia (d2) só entra o que veio antes
 * dele (mesmo dia da semana passada até esta hora). Pedido só conta na quantidade com valor positivo (cancelado
 * que entra e sai fica zero), como em fetchIfoodVendas.
 */
export function somarNosDias(
  lista: PedidoValor[], janelas: JanelaSessao[], d1: string, d2: string, corte?: Date | null,
): SomaDiasLoja {
  const out: SomaDiasLoja = { total: 0, pedidos: 0, pedidosAoVivo: 0, porDia: {}, porHora: {} };
  for (const p of lista) {
    const at = new Date(p.at);
    const dia = diaDoPedido(at, janelas);
    if (dia < d1 || dia > d2) continue;
    if (corte && dia === d2 && at.getTime() >= corte.getTime()) continue;
    out.total += p.valor;
    if (p.valor > 0.005) { out.pedidos += 1; if (p.aoVivo) out.pedidosAoVivo += 1; }
    out.porDia[dia] = (out.porDia[dia] ?? 0) + p.valor;
    const h = horaDoDia(at, dia);
    out.porHora[h] = (out.porHora[h] ?? 0) + p.valor;
  }
  out.total = Math.round(out.total * 100) / 100;
  return out;
}
