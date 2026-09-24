// Recorrência de tarefas — lógica pura (sem Deno nem browser), usada pela Edge
// task-write (cria a próxima ocorrência ao concluir) e pela tela (editor e
// pré-visualização "próximas datas"). Testada no Vitest
// (src/test/components/tarefasRecorrencia.test.tsx). Mudar aqui exige
// redeploy do task-write.
//
// Formato (compatível com o antigo {freq, interval}):
//   freq: 'daily' | 'weekly' | 'monthly' | 'yearly'
//   interval: a cada N (dias/semanas/meses/anos), padrão 1
//   dias_semana: [0..6] (0 = domingo) — só semanal; vazio = o dia do vencimento
//   mensal: { tipo: 'dia', dia: 1..31 | -1 (último dia) }
//         | { tipo: 'semana', ordem: 1..4 | -1 (última), dia_semana: 0..6 }
//   ate: 'YYYY-MM-DD' — não cria ocorrência depois dessa data
//
// As contas são feitas no horário de Brasília (UTC-3 fixo, sem horário de
// verão desde 2019): uma tarefa às 22h de segunda não pode "virar" terça por
// causa do UTC.

export type Frequencia = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type Mensal =
  | { tipo: 'dia'; dia: number }
  | { tipo: 'semana'; ordem: number; dia_semana: number };

export interface Recorrencia {
  freq?: string;
  interval?: number;
  dias_semana?: number[];
  mensal?: Mensal;
  ate?: string | null;
}

const OFFSET_MS = 3 * 3600 * 1000; // Brasília = UTC-3
const DIA_MS = 86400 * 1000;
const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const CURTO_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const ORDINAL: Record<number, string> = { 1: '1ª', 2: '2ª', 3: '3ª', 4: '4ª', [-1]: 'última' };

/** Data em "hora de parede" de Brasília (campos UTC = campos locais BRT). */
const paraParede = (d: Date) => new Date(d.getTime() - OFFSET_MS);
const deParede = (d: Date) => new Date(d.getTime() + OFFSET_MS);

function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
}

function comData(base: Date, ano: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes, dia, base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds()));
}

/** Dia do mês da N-ésima (ou última) ocorrência do dia da semana. */
function diaDaOrdem(ano: number, mes: number, ordem: number, diaSemana: number): number {
  const ultimo = ultimoDiaDoMes(ano, mes);
  if (ordem === -1) {
    const dow = new Date(Date.UTC(ano, mes, ultimo)).getUTCDay();
    return ultimo - ((dow - diaSemana + 7) % 7);
  }
  const dowPrimeiro = new Date(Date.UTC(ano, mes, 1)).getUTCDay();
  const dia = 1 + ((diaSemana - dowPrimeiro + 7) % 7) + (ordem - 1) * 7;
  return dia <= ultimo ? dia : -1; // ex.: não existe 5ª segunda — aqui ordem vai só até 4, então sempre existe
}

/** Próxima data (parede) estritamente depois de `base` (parede). */
function proximaParede(base: Date, rec: Recorrencia): Date | null {
  const n = Math.max(1, Math.floor(Number(rec.interval) || 1));
  switch (rec.freq) {
    case 'daily':
      return new Date(base.getTime() + n * DIA_MS);

    case 'weekly': {
      const dias = (rec.dias_semana ?? []).filter((d) => d >= 0 && d <= 6);
      if (!dias.length) return new Date(base.getTime() + 7 * n * DIA_MS);
      // Semana começa no domingo. Só valem as semanas de índice múltiplo de n.
      const inicioSemanaBase = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()) - base.getUTCDay() * DIA_MS;
      for (let i = 1; i <= 7 * n * 2 + 7; i++) {
        const d = new Date(base.getTime() + i * DIA_MS);
        const inicioSemana = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - d.getUTCDay() * DIA_MS;
        const semana = Math.round((inicioSemana - inicioSemanaBase) / (7 * DIA_MS));
        if (semana % n === 0 && dias.includes(d.getUTCDay())) return d;
      }
      return null;
    }

    case 'monthly': {
      const m = rec.mensal ?? { tipo: 'dia', dia: base.getUTCDate() };
      for (let k = 0; k <= 24 * n; k += n) {
        const alvo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + k, 1));
        const ano = alvo.getUTCFullYear();
        const mes = alvo.getUTCMonth();
        let dia: number;
        if (m.tipo === 'semana') {
          dia = diaDaOrdem(ano, mes, m.ordem, m.dia_semana);
          if (dia < 1) continue;
        } else {
          const ultimo = ultimoDiaDoMes(ano, mes);
          dia = m.dia === -1 ? ultimo : Math.min(Math.max(1, m.dia), ultimo);
        }
        const d = comData(base, ano, mes, dia);
        if (d.getTime() > base.getTime()) return d;
      }
      return null;
    }

    case 'yearly': {
      const ano = base.getUTCFullYear() + n;
      const mes = base.getUTCMonth();
      return comData(base, ano, mes, Math.min(base.getUTCDate(), ultimoDiaDoMes(ano, mes)));
    }

    default:
      return null;
  }
}

/**
 * Próximo vencimento depois de concluir. Parte do vencimento atual (ou de agora,
 * sem vencimento) e pula as ocorrências que já ficaram no passado — tarefa
 * diária concluída com 5 dias de atraso vence de novo a partir de hoje, não
 * 5 dias atrás. Respeita `ate`. Devolve ISO ou null (acabou / inválida).
 */
export function proximaOcorrencia(vencimentoIso: string | null, rec: Recorrencia | null | undefined, agora: Date = new Date()): string | null {
  if (!rec?.freq) return null;
  let base = paraParede(vencimentoIso ? new Date(vencimentoIso) : agora);
  const hojeParede = paraParede(agora);
  const inicioHoje = Date.UTC(hojeParede.getUTCFullYear(), hojeParede.getUTCMonth(), hojeParede.getUTCDate());
  for (let tentativas = 0; tentativas < 1000; tentativas++) {
    const prox = proximaParede(base, rec);
    if (!prox) return null;
    if (rec.ate) {
      const dia = prox.toISOString().slice(0, 10);
      if (dia > rec.ate) return null;
    }
    if (prox.getTime() >= inicioHoje) return deParede(prox).toISOString();
    base = prox;
  }
  return null;
}

/** As próximas `quantas` datas a partir do vencimento (pré-visualização no editor). */
export function proximasOcorrencias(vencimentoIso: string | null, rec: Recorrencia | null | undefined, quantas = 4, agora: Date = new Date()): string[] {
  const datas: string[] = [];
  let atual = vencimentoIso;
  for (let i = 0; i < quantas; i++) {
    const prox = proximaOcorrencia(atual, rec, agora);
    if (!prox) break;
    datas.push(prox);
    atual = prox;
  }
  return datas;
}

function listaDias(dias: number[]): string {
  const ord = [...dias].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // segunda primeiro
  if (ord.length === 5 && [1, 2, 3, 4, 5].every((d) => ord.includes(d))) return 'dias úteis (seg a sex)';
  if (ord.length === 7) return 'todos os dias';
  const nomes = ord.map((d) => CURTO_DIA[d]);
  return nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/** Texto em português: "Toda seg, qua e sex", "Todo mês no dia 5", "A cada 2 semanas"… */
export function descreverRecorrencia(rec: Recorrencia | null | undefined): string | null {
  if (!rec?.freq) return null;
  const n = Math.max(1, Math.floor(Number(rec.interval) || 1));
  let texto: string;
  switch (rec.freq) {
    case 'daily':
      texto = n === 1 ? 'Todo dia' : `A cada ${n} dias`;
      break;
    case 'weekly': {
      const dias = rec.dias_semana ?? [];
      if (dias.length === 5 && [1, 2, 3, 4, 5].every((d) => dias.includes(d)) && n === 1) { texto = 'Dias úteis (seg a sex)'; break; }
      const base = n === 1 ? 'Toda semana' : `A cada ${n} semanas`;
      texto = dias.length ? `${base}: ${listaDias(dias)}` : base;
      break;
    }
    case 'monthly': {
      const base = n === 1 ? 'Todo mês' : `A cada ${n} meses`;
      const m = rec.mensal;
      if (!m) texto = base;
      else if (m.tipo === 'semana') texto = `${base} na ${ORDINAL[m.ordem] ?? `${m.ordem}ª`} ${NOMES_DIA[m.dia_semana]}`;
      else texto = m.dia === -1 ? `${base} no último dia` : `${base} no dia ${m.dia}`;
      break;
    }
    case 'yearly':
      texto = n === 1 ? 'Todo ano' : `A cada ${n} anos`;
      break;
    default:
      return 'Tarefa recorrente';
  }
  if (rec.ate) texto += ` até ${rec.ate.slice(8, 10)}/${rec.ate.slice(5, 7)}/${rec.ate.slice(0, 4)}`;
  return texto;
}

/** Validação do servidor. null = ok. */
export function validarRecorrencia(rec: unknown): string | null {
  if (rec === null || rec === undefined) return null;
  if (typeof rec !== 'object' || Array.isArray(rec)) return 'recurrence inválida';
  const r = rec as Recorrencia;
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(String(r.freq))) return 'recurrence.freq inválida';
  if (r.interval !== undefined && (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 365)) return 'recurrence.interval deve ser de 1 a 365';
  if (r.dias_semana !== undefined && (!Array.isArray(r.dias_semana) || r.dias_semana.length > 7 || !r.dias_semana.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))) {
    return 'recurrence.dias_semana deve ter dias de 0 a 6';
  }
  if (r.mensal !== undefined) {
    const m = r.mensal as Mensal;
    if (m.tipo === 'dia') {
      if (!Number.isInteger(m.dia) || !(m.dia === -1 || (m.dia >= 1 && m.dia <= 31))) return 'recurrence.mensal.dia inválido';
    } else if (m.tipo === 'semana') {
      if (![1, 2, 3, 4, -1].includes(m.ordem) || !Number.isInteger(m.dia_semana) || m.dia_semana < 0 || m.dia_semana > 6) return 'recurrence.mensal inválido';
    } else return 'recurrence.mensal.tipo inválido';
  }
  if (r.ate !== undefined && r.ate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(r.ate))) return 'recurrence.ate deve ser AAAA-MM-DD';
  return null;
}
