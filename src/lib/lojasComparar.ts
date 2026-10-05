// Comparar lojas (/lojas) e "Suas lojas agora" (/modulos) — 2026-10-04.
// O banco (fn_lojas_comparar) devolve o PDV de cada loja em que a pessoa vê o Dashboard, já no dia da loja
// (soma das sessões abertas no dia), mais as janelas das sessões. Aqui entra o iFood (src/lib/diaLoja.ts) e
// saem os números da tela: faturamento = PDV pago + iFood, a mesma conta do Dashboard de cada loja.
import { somarNosDias, type JanelaSessao, type PedidoValor, type SomaDiasLoja } from '@/lib/diaLoja';

export type PeriodoLojas = 'hoje' | 'ontem' | '7d' | 'mes';

export interface LinhaLojasRpc {
  tenant_id: string;
  nome: string;
  /** dia atual da loja (sessão aberta mais recente; sem sessão aberta, hoje) */
  dia: string;
  periodo: { d1: string; d2: string; c1: string; c2: string; corte: string | null };
  atual: { faturamento: number; pedidos: number; canais: Record<string, { valor: number; pedidos: number }>; serie: Record<string, number> };
  anterior: { faturamento: number; pedidos: number; serie: Record<string, number> };
  agora: {
    caixa: { numero: string; desde: string } | null;
    dia_inicio: string | null;
    em_aberto: { pedidos: number; valor: number };
    mesas_ocupadas: number;
    mesas_total: number;
    atrasados: number;
  };
  janelas_atual: JanelaSessao[];
  janelas_anterior: JanelaSessao[];
  metas: Array<{ dia_semana: number; faturamento: number }>;
  primeiro_dia: string | null;
  vendeu_30d: boolean;
  tem_ifood: boolean;
  sincroniza_ifood: boolean;
  oculta: boolean;
}

export interface NumerosPeriodo {
  faturamento: number;
  pedidos: number;
  /** horas desde a 0h do dia da loja (período de um dia) ou 'YYYY-MM-DD' (vários dias) → valor */
  serie: Record<string, number>;
}

export interface LojaComparada {
  tenantId: string;
  nome: string;
  dia: string;
  periodo: LinhaLojasRpc['periodo'];
  umDia: boolean;
  atual: NumerosPeriodo & {
    ticket: number;
    ifood: number;
    ifoodPedidos: number;
    ifoodAoVivo: number;
    canais: Record<string, { valor: number; pedidos: number }>;
  };
  anterior: NumerosPeriodo;
  /** % contra o período anterior; null = sem base (loja nova no sistema ou anterior zerado) */
  variacao: number | null;
  /** meta de faturamento somada nos dias do período (por dia da semana); null = loja sem meta */
  meta: number | null;
  agora: LinhaLojasRpc['agora'];
  oculta: boolean;
  /** sem venda (PDV ou iFood) nos últimos 30 dias: fica recolhida no fim */
  parada: boolean;
  temIfood: boolean;
  /** iFood ainda chegando (o número ainda é só do PDV) */
  ifoodCarregando: boolean;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Dias 'YYYY-MM-DD' de d1 a d2 (inclusive). */
export function diasEntre(d1: string, d2: string): string[] {
  const out: string[] = [];
  const d = new Date(`${d1}T12:00:00Z`);
  const fim = new Date(`${d2}T12:00:00Z`).getTime();
  while (d.getTime() <= fim && out.length < 62) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Meta de faturamento do período: a meta de cada dia (pelo dia da semana) somada. null sem meta nenhuma. */
export function metaDoPeriodo(metas: LinhaLojasRpc['metas'], d1: string, d2: string): number | null {
  if (!metas.some((m) => Number(m.faturamento) > 0)) return null;
  const porDow = new Map(metas.map((m) => [m.dia_semana, Number(m.faturamento) || 0]));
  let soma = 0;
  for (const dia of diasEntre(d1, d2)) soma += porDow.get(new Date(`${dia}T12:00:00Z`).getUTCDay()) ?? 0;
  return soma > 0 ? soma : null;
}

const VAZIO: SomaDiasLoja = { total: 0, pedidos: 0, pedidosAoVivo: 0, porDia: {}, porHora: {} };

function somarSerie(pdv: Record<string, number>, extra: Record<string | number, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(pdv)) out[k] = Number(v) || 0;
  for (const [k, v] of Object.entries(extra)) out[String(k)] = (out[String(k)] ?? 0) + v;
  for (const k of Object.keys(out)) out[k] = r2(out[k]);
  return out;
}

/**
 * Junta o PDV do banco com o iFood (lista bruta de fetchIfoodVendas, null = ainda buscando) de uma loja.
 * O iFood é encaixado no dia da loja com as janelas das sessões; o anterior para no mesmo corte do PDV.
 */
export function montarLoja(l: LinhaLojasRpc, ifAtual: PedidoValor[] | null, ifAnterior: PedidoValor[] | null): LojaComparada {
  const { d1, d2, c1, c2, corte } = l.periodo;
  const umDia = d1 === d2;
  const ia = ifAtual ? somarNosDias(ifAtual, l.janelas_atual, d1, d2) : VAZIO;
  const ib = ifAnterior ? somarNosDias(ifAnterior, l.janelas_anterior, c1, c2, corte ? new Date(corte) : null) : VAZIO;

  const faturamento = r2(Number(l.atual.faturamento) + ia.total);
  const pedidos = Number(l.atual.pedidos) + ia.pedidos;
  const fatAnterior = r2(Number(l.anterior.faturamento) + ib.total);
  const semBase = !l.primeiro_dia || l.primeiro_dia > c1 || fatAnterior <= 0;
  const canais = { ...l.atual.canais };
  if (ia.total > 0 || ia.pedidos > 0) canais.ifood = { valor: ia.total, pedidos: ia.pedidos };

  return {
    tenantId: l.tenant_id,
    nome: l.nome,
    dia: l.dia,
    periodo: l.periodo,
    umDia,
    atual: {
      faturamento,
      pedidos,
      ticket: pedidos > 0 ? r2(faturamento / pedidos) : 0,
      ifood: ia.total,
      ifoodPedidos: ia.pedidos,
      ifoodAoVivo: ia.pedidosAoVivo,
      canais,
      serie: somarSerie(l.atual.serie ?? {}, umDia ? ia.porHora : ia.porDia),
    },
    anterior: {
      faturamento: fatAnterior,
      pedidos: Number(l.anterior.pedidos) + ib.pedidos,
      serie: somarSerie(l.anterior.serie ?? {}, umDia ? ib.porHora : ib.porDia),
    },
    variacao: semBase ? null : ((faturamento - fatAnterior) / fatAnterior) * 100,
    meta: metaDoPeriodo(l.metas ?? [], d1, d2),
    agora: l.agora,
    oculta: l.oculta,
    parada: !l.vendeu_30d,
    temIfood: l.tem_ifood,
    ifoodCarregando: l.tem_ifood && (ifAtual === null || ifAnterior === null),
  };
}

export interface TotalLojas { faturamento: number; pedidos: number; ticket: number; variacao: number | null; abertas: number }

/**
 * Total das lojas mostradas. A variação só existe se todas as que venderam têm base (senão o % mistura loja nova);
 * loja zerada nos dois períodos não conta nem atrapalha.
 */
export function totalLojas(lojas: LojaComparada[]): TotalLojas {
  let fat = 0; let ped = 0; let ant = 0; let todasComBase = lojas.length > 0; let abertas = 0;
  for (const l of lojas) {
    fat += l.atual.faturamento; ped += l.atual.pedidos;
    const zerada = l.atual.faturamento <= 0 && l.anterior.faturamento <= 0;
    if (l.variacao === null) { if (!zerada) todasComBase = false; } else ant += l.anterior.faturamento;
    if (l.agora.caixa) abertas += 1;
  }
  return {
    faturamento: r2(fat),
    pedidos: ped,
    ticket: ped > 0 ? r2(fat / ped) : 0,
    variacao: todasComBase && ant > 0 ? ((fat - ant) / ant) * 100 : null,
    abertas,
  };
}

// Cor fixa por loja (pela ordem do nome, nunca pelo ranking) — paleta categórica validada (8 tons).
export const CORES_LOJAS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const corDaLoja = (indice: number) => CORES_LOJAS[indice % CORES_LOJAS.length];

export const ROTULO_PERIODO: Record<PeriodoLojas, string> = { hoje: 'Hoje', ontem: 'Ontem', '7d': '7 dias', mes: 'Mês' };

const DIA_SEMANA_PASSADO = ['dom passado', 'seg passada', 'ter passada', 'qua passada', 'qui passada', 'sex passada', 'sáb passado'];
const DIA_ANTERIOR = ['dom anterior', 'seg anterior', 'ter anterior', 'qua anterior', 'qui anterior', 'sex anterior', 'sáb anterior'];

/** "vs dom passado até 23h04" etc. — a comparação do período, para uma loja. */
export function rotuloComparacao(periodo: PeriodoLojas, l: Pick<LojaComparada, 'periodo'>, agora = new Date()): string {
  const dow = new Date(`${l.periodo.c2}T12:00:00Z`).getUTCDay();
  const hora = agora.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  if (periodo === 'hoje') return `vs ${DIA_SEMANA_PASSADO[dow]} até ${hora}`;
  if (periodo === 'ontem') return `vs ${DIA_ANTERIOR[dow]}`;
  if (periodo === '7d') return 'vs 7 dias anteriores';
  const [, m1, dd1] = l.periodo.c1.split('-');
  const [, , dd2] = l.periodo.c2.split('-');
  return `vs ${Number(dd1)} a ${Number(dd2)}/${m1}`;
}
