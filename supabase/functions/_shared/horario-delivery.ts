// Horário do delivery (delivery_config.delivery_schedule) — regra ÚNICA, usada pelo servidor
// (delivery-write: abre/fecha sozinho, "Fechar agora" vira pausa até o fim do horário), pelo
// assistente do WhatsApp (atendimento-loja), pelo topo do app do cliente (src/lib/situacaoLoja.ts)
// e pela tela Delivery › Pedido › Horário. Sem import nenhum: roda no Deno e no Vite.
//
// Formato (2026-10-04, vários horários no mesmo dia + datas especiais):
//   { enabled, days: { "0".."6": { enabled, intervals: [{ open, close }], open, close } },
//     exceptions: [{ date: "AAAA-MM-DD", closed?: true, intervals?: [...], label?: "Natal" }] }
// 0 = domingo. `open`/`close` do dia continuam gravados (= começo do 1º e fim do último horário)
// para quem ainda lê o formato antigo; quem tem `intervals` usa só eles.
// Horário com fim menor que o começo passa da meia-noite e conta para o dia em que começou
// (sexta 18:00–00:30 vale até 00:29 de sábado). Data especial troca o dia da semana inteiro.
// O relógio é sempre o de Brasília (America/Sao_Paulo).

export interface IntervaloHorario { open: string; close: string }
export interface DiaHorario { enabled?: boolean; open?: string; close?: string; intervals?: IntervaloHorario[] }
export interface DataEspecial { date: string; closed?: boolean; intervals?: IntervaloHorario[]; label?: string }
export interface HorarioDelivery { enabled?: boolean; days?: Record<string, DiaHorario>; exceptions?: DataEspecial[] }

/** Janela em minutos do dia: o = começo, c = fim (c < o = passa da meia-noite). */
export interface Janela { o: number; c: number }

const HHMM = /^(\d{1,2}):(\d{2})$/;
export function parseHHMM(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = HHMM.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
export function hhmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/** Dia (AAAA-MM-DD), dia da semana (0=Dom) e minutos desde a meia-noite em Brasília. */
export function agoraBrasilia(now: Date): { ymd: string; dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(get('hour')) % 24; // hour12:false pode devolver "24"
  return { ymd: `${get('year')}-${get('month')}-${get('day')}`, dow: wd[get('weekday')] ?? 0, minutes: hour * 60 + Number(get('minute')) };
}

/** AAAA-MM-DD somado de n dias (conta no calendário, sem fuso). */
export function somarDias(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1) + n * 86400000);
  return dt.toISOString().slice(0, 10);
}

/** Horários válidos de uma lista: descarta os quebrados e os de duração zero; junta os que se encostam. */
function janelasDe(ints: IntervaloHorario[] | undefined): Janela[] {
  const js: Janela[] = [];
  for (const i of ints ?? []) {
    const o = parseHHMM(i?.open); const c = parseHHMM(i?.close);
    if (o == null || c == null || o === c) continue;
    js.push({ o, c });
  }
  js.sort((a, b) => a.o - b.o);
  // Junta só os que não passam da meia-noite (11:00–14:00 + 14:00–18:00 = 11:00–18:00).
  const out: Janela[] = [];
  for (const j of js) {
    const ult = out[out.length - 1];
    if (ult && ult.c > ult.o && j.c > j.o && j.o <= ult.c) { ult.c = Math.max(ult.c, j.c); continue; }
    out.push({ ...j });
  }
  return out;
}

/** Horários de um dia da semana (formato novo ou antigo). Dia desligado = nenhum. */
export function janelasDoDia(dia: DiaHorario | undefined): Janela[] {
  if (!dia || !dia.enabled) return [];
  if (Array.isArray(dia.intervals) && dia.intervals.length) return janelasDe(dia.intervals);
  return janelasDe([{ open: String(dia.open ?? ''), close: String(dia.close ?? '') }]);
}

/** Data especial daquele dia (se houver). */
export function dataEspecial(h: HorarioDelivery | null | undefined, ymd: string): DataEspecial | null {
  const ex = Array.isArray(h?.exceptions) ? h!.exceptions! : [];
  return ex.find((e) => e && e.date === ymd) ?? null;
}

/** Horários que valem numa data (data especial ganha do dia da semana). */
export function janelasDaData(h: HorarioDelivery | null | undefined, ymd: string, dow: number): Janela[] {
  if (!h) return [];
  const esp = dataEspecial(h, ymd);
  if (esp) return esp.closed ? [] : janelasDe(esp.intervals);
  return janelasDoDia(h.days?.[String(dow)]);
}

/**
 * Horários de ontem, hoje e amanhã em minutos corridos a partir da meia-noite de HOJE (ontem fica negativo,
 * amanhã passa de 1440). Horário que passa da meia-noite termina no dia seguinte (fim > 1440).
 */
function janelasCorridas(h: HorarioDelivery, ymd: string, dow: number): { ini: number; fim: number; deOntem: boolean }[] {
  const out: { ini: number; fim: number; deOntem: boolean }[] = [];
  for (const [k, desloc] of [[-1, -1440], [0, 0], [1, 1440]] as const) {
    for (const j of janelasDaData(h, somarDias(ymd, k), (dow + 7 + k) % 7)) {
      out.push({ ini: j.o + desloc, fim: (j.c > j.o ? j.c : j.c + 1440) + desloc, deOntem: k === -1 });
    }
  }
  return out.sort((a, b) => a.ini - b.ini);
}

/**
 * A janela aberta agora (de hoje ou a de ontem que passou da meia-noite), com quantos minutos faltam para
 * fechar. Horários encostados ou sobrepostos contam como um só (11:00–18:00 + 18:00–01:00 fecha à 01:00) —
 * senão o topo diria "fecha em 10 min" às 17:50 e o "Fechar agora" pausaria só até 18:00.
 */
export function janelaAgora(h: HorarioDelivery | null | undefined, now: Date): { janela: Janela; faltam: number; deOntem: boolean } | null {
  if (!h || !h.enabled) return null;
  const { ymd, dow, minutes } = agoraBrasilia(now);
  const js = janelasCorridas(h, ymd, dow);
  const atual = js.find((j) => minutes >= j.ini && minutes < j.fim);
  if (!atual) return null;
  let fim = atual.fim;
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const j of js) if (j.ini <= fim && j.fim > fim) { fim = j.fim; mudou = true; }
  }
  return { janela: { o: ((atual.ini % 1440) + 1440) % 1440, c: ((fim % 1440) + 1440) % 1440 }, faltam: fim - minutes, deOntem: atual.deOntem };
}

export function dentroDoHorario(h: HorarioDelivery | null | undefined, now: Date): boolean {
  return janelaAgora(h, now) != null;
}

/** Minutos até o fim do horário em curso (null se fora do horário). */
export function minutosAteFechar(h: HorarioDelivery | null | undefined, now: Date): number | null {
  return janelaAgora(h, now)?.faltam ?? null;
}

/** Próxima abertura a partir de agora (até 8 dias à frente): em quantos dias e a que horas. */
export function proximaAbertura(h: HorarioDelivery | null | undefined, now: Date): { emDias: number; dow: number; ymd: string; hora: string } | null {
  if (!h || !h.enabled) return null;
  const { ymd, dow, minutes } = agoraBrasilia(now);
  for (let k = 0; k <= 8; k++) {
    const d = somarDias(ymd, k); const w = (dow + k) % 7;
    const js = janelasDaData(h, d, w).filter((j) => k > 0 || j.o > minutes);
    if (js.length) return { emDias: k, dow: w, ymd: d, hora: hhmm(js[0].o) };
  }
  return null;
}

const DIAS_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const fmtJanelas = (js: Janela[]) => js.length ? js.map((j) => `${hhmm(j.o)}–${hhmm(j.c)}`).join(' e ') : 'fechado';

/** Texto do horário para o assistente: a semana + as datas especiais dos próximos 30 dias. */
export function resumoHorario(h: HorarioDelivery | null | undefined, now: Date): string | null {
  if (!h || !h.enabled || !h.days) return null;
  const linhas = DIAS_PT.map((nome, d) => `${nome}: ${fmtJanelas(janelasDoDia(h.days?.[String(d)]))}`);
  const { ymd } = agoraBrasilia(now);
  const limite = somarDias(ymd, 30);
  const esp = (Array.isArray(h.exceptions) ? h.exceptions : [])
    .filter((e) => e && typeof e.date === 'string' && e.date >= ymd && e.date <= limite)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => `${e.date.slice(8, 10)}/${e.date.slice(5, 7)}${e.label ? ` (${e.label})` : ''}: ${e.closed ? 'fechado' : fmtJanelas(janelasDe(e.intervals))}`);
  return linhas.join('; ') + (esp.length ? `. Datas especiais: ${esp.join('; ')}` : '');
}

/** Limpa o que a tela manda antes de gravar: horários válidos, `open`/`close` espelhados, datas no formato certo. */
export function normalizarHorarioDelivery(raw: unknown): HorarioDelivery {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const daysIn = (r.days && typeof r.days === 'object' ? r.days : {}) as Record<string, DiaHorario>;
  const limpa = (ints: unknown): IntervaloHorario[] => (Array.isArray(ints) ? ints : [])
    .map((i) => ({ open: String((i as IntervaloHorario)?.open ?? '').trim(), close: String((i as IntervaloHorario)?.close ?? '').trim() }))
    .filter((i) => { const o = parseHHMM(i.open); const c = parseHHMM(i.close); return o != null && c != null && o !== c; })
    .slice(0, 6);
  const days: Record<string, DiaHorario> = {};
  for (let d = 0; d < 7; d++) {
    const dia = daysIn[String(d)] ?? {};
    let ints = limpa(dia.intervals);
    if (!ints.length && dia.open && dia.close) ints = limpa([{ open: dia.open, close: dia.close }]);
    days[String(d)] = {
      enabled: dia.enabled === true && ints.length > 0,
      intervals: ints,
      open: ints[0]?.open ?? (typeof dia.open === 'string' ? dia.open : '18:00'),
      close: ints[ints.length - 1]?.close ?? (typeof dia.close === 'string' ? dia.close : '23:00'),
    };
  }
  const exceptions: DataEspecial[] = (Array.isArray(r.exceptions) ? r.exceptions : [])
    .map((e) => e as DataEspecial)
    .filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date ?? '')))
    .map((e) => {
      const ints = limpa(e.intervals);
      const out: DataEspecial = { date: e.date, closed: e.closed === true || ints.length === 0 };
      if (!out.closed) out.intervals = ints;
      const label = String(e.label ?? '').trim().slice(0, 40);
      if (label) out.label = label;
      return out;
    })
    .filter((e, i, arr) => arr.findIndex((x) => x.date === e.date) === i)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-60); // passando de 60, saem as mais antigas (as futuras ficam)
  return { enabled: r.enabled === true, days, exceptions };
}
