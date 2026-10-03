// Planos de contagem do estoque (2026-10-03): quando é dia de contar e quem ainda falta.
// Lógica pura, usada pela tela (src/lib/estoqueRegras.ts reexporta) e pelo assistente-cron (aviso no dia
// da contagem) — mudou aqui, muda nos dois. Sem import nenhum: roda no Deno e no Vite.
// Datas sempre 'YYYY-MM-DD' no calendário de Brasília (o "hoje" vem do banco ou de localDate()).

export type FrequenciaContagem = 'diaria' | 'semanal' | 'mensal';

export interface PlanoContagem {
  id: string;
  nome: string;
  frequencia: FrequenciaContagem;
  /** 0 = domingo (semanal) */
  diaSemana: number | null;
  /** 1..28; 0 = último dia do mês (mensal) */
  diaMes: number | null;
  /** true = todos os insumos que entram na contagem */
  todos: boolean;
  itens: string[];
  criadoEm: string;
}

/** O mínimo que um insumo precisa ter para entrar num plano de contagem. */
export interface ItemContavel {
  id: string;
  /** count_inventory: false = fora da contagem */
  contaInventario: boolean;
  /** Última contagem confirmada (timestamp) */
  ultimaContagem: string | null;
}

// Datas sempre 'YYYY-MM-DD' no calendário de Brasília (o "hoje" vem do banco).
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const comoData = (s: string) => new Date(s.slice(0, 10) + 'T12:00:00Z');
const somar = (s: string, n: number) => { const d = comoData(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const ultimoDiaDoMes = (ano: number, mes0: number) => new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();
const diaDoMesEm = (ano: number, mes0: number, diaMes: number) =>
  ymd(new Date(Date.UTC(ano, mes0, diaMes === 0 ? ultimoDiaDoMes(ano, mes0) : Math.min(diaMes, ultimoDiaDoMes(ano, mes0)), 12)));

/** Data agendada mais recente (<= hoje) do plano, sem considerar quando ele foi criado. */
function agendadaAte(p: PlanoContagem, hoje: string): string {
  if (p.frequencia === 'diaria') return hoje;
  if (p.frequencia === 'semanal') {
    const dow = comoData(hoje).getUTCDay();
    return somar(hoje, -(((dow - (p.diaSemana ?? 1)) + 7) % 7));
  }
  const d = comoData(hoje);
  const ano = d.getUTCFullYear(), mes = d.getUTCMonth();
  const desteMes = diaDoMesEm(ano, mes, p.diaMes ?? 1);
  if (desteMes <= hoje) return desteMes;
  return mes === 0 ? diaDoMesEm(ano - 1, 11, p.diaMes ?? 1) : diaDoMesEm(ano, mes - 1, p.diaMes ?? 1);
}

/** Próxima data agendada depois de `depoisDe`. */
export function proximaOcorrencia(p: PlanoContagem, depoisDe: string): string {
  if (p.frequencia === 'diaria') return somar(depoisDe, 1);
  if (p.frequencia === 'semanal') return somar(agendadaAte(p, depoisDe), 7);
  const d = comoData(depoisDe);
  const ano = d.getUTCFullYear(), mes = d.getUTCMonth();
  const desteMes = diaDoMesEm(ano, mes, p.diaMes ?? 1);
  if (desteMes > depoisDe) return desteMes;
  return mes === 11 ? diaDoMesEm(ano + 1, 0, p.diaMes ?? 1) : diaDoMesEm(ano, mes + 1, p.diaMes ?? 1);
}

/** Ocorrência que vale agora: a agendada mais recente, desde que depois da criação do plano. */
export function ocorrenciaAtual(p: PlanoContagem, hoje: string): string | null {
  const ag = agendadaAte(p, hoje);
  const criado = p.criadoEm ? dataBrasilia(p.criadoEm) : '0000-00-00';
  return ag >= criado ? ag : null;
}

/** Insumo tirado da contagem (count_inventory = false) sai do plano: o inventário não grava ele. */
export function itensDoPlano<T extends ItemContavel>(p: PlanoContagem, insumos: T[]): T[] {
  if (p.todos) return insumos.filter((i) => i.contaInventario);
  const ids = new Set(p.itens);
  return insumos.filter((i) => i.contaInventario && ids.has(i.id));
}

export interface SituacaoPlano<T extends ItemContavel = ItemContavel> {
  plano: PlanoContagem;
  /** null = ainda não chegou o primeiro dia */
  ocorrencia: string | null;
  /** Dias de atraso (0 = é hoje) */
  atraso: number;
  pendentes: T[];
  contados: T[];
  proxima: string;
}

/** Quem do plano ainda não foi contado desde a ocorrência atual. */
export function situacaoPlano<T extends ItemContavel>(p: PlanoContagem, insumos: T[], hoje: string): SituacaoPlano<T> {
  const itens = itensDoPlano(p, insumos);
  const oc = ocorrenciaAtual(p, hoje);
  const contadoDesde = (i: T) => !!oc && !!i.ultimaContagem && dataBrasilia(i.ultimaContagem) >= oc;
  const pendentes = oc ? itens.filter((i) => !contadoDesde(i)) : [];
  const contados = oc ? itens.filter(contadoDesde) : [];
  const atraso = oc ? Math.round((comoData(hoje).getTime() - comoData(oc).getTime()) / 86400000) : 0;
  return { plano: p, ocorrencia: oc, atraso, pendentes, contados, proxima: proximaOcorrencia(p, oc && pendentes.length ? oc : hoje) };
}

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const nomeDiaSemana = (d: number) => DIAS_SEMANA[d] ?? '';

export function descreverFrequencia(p: Pick<PlanoContagem, 'frequencia' | 'diaSemana' | 'diaMes'>): string {
  if (p.frequencia === 'diaria') return 'Todo dia';
  if (p.frequencia === 'semanal') return `Toda ${nomeDiaSemana(p.diaSemana ?? 1)}`.replace('Toda sábado', 'Todo sábado').replace('Toda domingo', 'Todo domingo');
  return p.diaMes === 0 ? 'Último dia do mês' : `Todo dia ${p.diaMes} do mês`;
}

/** "hoje", "amanhã", "segunda, 06/10" */
export function quandoFica(data: string, hoje: string): string {
  if (data === hoje) return 'hoje';
  if (data === somar(hoje, 1)) return 'amanhã';
  if (data === somar(hoje, -1)) return 'ontem';
  const d = comoData(data);
  return `${nomeDiaSemana(d.getUTCDay())}, ${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

export const dataBrasilia = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
