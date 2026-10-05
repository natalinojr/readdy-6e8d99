// Contas da aba Delivery › Pedido › Horário (sem tela, para poder testar).
// A regra de "está aberto agora / quando abre" é a do servidor (supabase/functions/_shared/horario-delivery.ts):
// aqui só se monta o rascunho (dia, modelo, data especial) e os textos que a tela mostra.
import {
  agoraBrasilia, dataEspecial, hhmm, janelaAgora, janelasDaData, janelasDoDia, normalizarHorarioDelivery, parseHHMM, proximaAbertura,
  type DataEspecial, type DiaHorario, type HorarioDelivery, type IntervaloHorario, type Janela,
} from '../../../../../supabase/functions/_shared/horario-delivery';

export type { DataEspecial, DiaHorario, HorarioDelivery, IntervaloHorario, Janela };
export { agoraBrasilia, janelasDoDia };

export const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DIAS_LONGO = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const DIAS_FOLHA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
export const DIAS_MINUSCULO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6];

// ── Horários de um dia ──────────────────────────────────────────────────────

/** Horários gravados no dia, do jeito que estão (para editar). Aceita o formato antigo (um open/close só). */
export function intervalosDoDia(dia: DiaHorario | undefined): IntervaloHorario[] {
  if (!dia) return [];
  if (Array.isArray(dia.intervals) && dia.intervals.length) {
    return dia.intervals.map((i) => ({ open: String(i?.open ?? ''), close: String(i?.close ?? '') }));
  }
  if (dia.enabled && dia.open && dia.close) return [{ open: dia.open, close: dia.close }];
  return [];
}

/** Horários válidos, em ordem, escritos como HH:MM. Descarta os incompletos e os de começo = fim. */
export function limparIntervalos(ints: IntervaloHorario[]): IntervaloHorario[] {
  const ok: { o: number; c: number }[] = [];
  for (const i of ints) {
    const o = parseHHMM(i?.open); const c = parseHHMM(i?.close);
    if (o == null || c == null || o === c) continue;
    ok.push({ o, c });
  }
  ok.sort((a, b) => a.o - b.o);
  return ok.map((j) => ({ open: hhmm(j.o), close: hhmm(j.c) }));
}

/** "11:00–14:30 e 18:00–23:00" ou "Fechado". */
export function txtJanelas(js: Janela[]): string {
  return js.length ? js.map((j) => `${hhmm(j.o)}–${hhmm(j.c)}`).join(' e ') : 'Fechado';
}

/** "18:00 às 21:00" / "11:00 às 14:30 e 18:00 às 23:00". */
export function txtAs(js: Janela[]): string {
  return js.map((j) => `${hhmm(j.o)} às ${hhmm(j.c)}`).join(' e ');
}

/** "Fechado das 14:30 às 18:00" entre dois horários seguidos (só quando o 1º não passa da meia-noite e há vão). */
export function lacunaEntre(a: IntervaloHorario, b: IntervaloHorario): string | null {
  const ao = parseHHMM(a?.open); const ac = parseHHMM(a?.close); const bo = parseHHMM(b?.open);
  if (ao == null || ac == null || bo == null) return null;
  if (ac <= ao) return null;
  if (bo <= ac) return null;
  return `Fechado das ${hhmm(ac)} às ${hhmm(bo)}`;
}

export interface ProblemasIntervalos {
  /** Impede o "Pronto": horário incompleto ou com começo = fim. */
  erro: string | null;
  /** Só avisa: dois horários se sobrepõem (vale a soma deles). */
  aviso: string | null;
}

export function problemasIntervalos(ints: IntervaloHorario[]): ProblemasIntervalos {
  let erro: string | null = null;
  for (const i of ints) {
    const o = parseHHMM(i?.open); const c = parseHHMM(i?.close);
    if (o == null || c == null) { erro = 'Preencha o começo e o fim de todos os horários.'; break; }
    if (o === c) { erro = `Um horário tem começo e fim iguais (${hhmm(o)}). Mude um dos dois.`; break; }
  }
  // Sobreposição: horário que passa da meia-noite termina no "dia seguinte" (fim + 24h).
  const ws: { o: number; e: number }[] = [];
  for (const i of ints) {
    const o = parseHHMM(i?.open); const c = parseHHMM(i?.close);
    if (o == null || c == null || o === c) continue;
    ws.push({ o, e: c > o ? c : c + 1440 });
  }
  ws.sort((a, b) => a.o - b.o);
  let aviso: string | null = null;
  let maior: { o: number; e: number } | null = null;
  for (const w of ws) {
    if (maior && w.o < maior.e) {
      aviso = `Os horários ${hhmm(maior.o)}–${hhmm(maior.e)} e ${hhmm(w.o)}–${hhmm(w.e)} se sobrepõem. Vale a soma dos dois.`;
      break;
    }
    if (!maior || w.e > maior.e) maior = w;
  }
  return { erro, aviso };
}

/** Horário sugerido para "+ Outro horário": depois do último (18:00–23:00 se o último acaba antes das 17:00). */
export function sugerirOutro(ints: IntervaloHorario[]): IntervaloHorario {
  const PADRAO = { open: '18:00', close: '23:00' };
  let ultimo = -1;
  for (const i of ints) {
    const o = parseHHMM(i?.open); const c = parseHHMM(i?.close);
    if (o == null || c == null || o === c) continue;
    if (c < o) return PADRAO; // passa da meia-noite: não sobra o que sugerir depois
    ultimo = Math.max(ultimo, c);
  }
  if (ultimo < 0 || ultimo <= 17 * 60) return PADRAO;
  const inicio = Math.ceil((ultimo + 60) / 30) * 30; // uma hora depois, em hora cheia ou meia
  if (inicio + 30 > 1439) return PADRAO;
  return { open: hhmm(inicio), close: hhmm(Math.min(inicio + 180, 1439)) };
}

/** Põe o horário (ligado + lista) nos dias pedidos. Dia ligado sem nenhum horário válido vira fechado. */
export function aplicarDia(h: HorarioDelivery, dias: number[], ligado: boolean, ints: IntervaloHorario[]): HorarioDelivery {
  const limpos = limparIntervalos(ints);
  const days: Record<string, DiaHorario> = { ...(h.days ?? {}) };
  for (const d of dias) {
    days[String(d)] = {
      enabled: ligado && limpos.length > 0,
      intervals: limpos.map((i) => ({ ...i })),
      open: limpos[0]?.open ?? '18:00',
      close: limpos[limpos.length - 1]?.close ?? '23:00',
    };
  }
  return normalizarHorarioDelivery({ ...h, days });
}

// ── Barra do dia (6h às 6h do dia seguinte) ─────────────────────────────────

/** Posição (0–100) de um minuto do dia na barra que vai das 6h às 6h. */
export function posDia(min: number): number {
  return ((((min - 360) % 1440) + 1440) % 1440) / 1440 * 100;
}

/** Faixas abertas da barra, em %. O que passa das 6h volta para o começo da barra. */
export function segmentosTrilho(js: Janela[]): { left: number; width: number }[] {
  const out: { left: number; width: number }[] = [];
  for (const j of js) {
    const x = posDia(j.o);
    const dur = j.c > j.o ? j.c - j.o : j.c + 1440 - j.o;
    const w = (dur / 1440) * 100;
    if (x + w <= 100.0001) out.push({ left: x, width: w });
    else { out.push({ left: x, width: 100 - x }); out.push({ left: 0, width: x + w - 100 }); }
  }
  return out;
}

// ── Modelos de semana ───────────────────────────────────────────────────────

export type ModeloId = 'jantar' | 'almoco_jantar' | 'dia_todo';
export const MODELOS: { id: ModeloId; rotulo: string; intervals: IntervaloHorario[] }[] = [
  { id: 'jantar', rotulo: 'Só jantar', intervals: [{ open: '18:00', close: '23:00' }] },
  { id: 'almoco_jantar', rotulo: 'Almoço e jantar', intervals: [{ open: '11:00', close: '14:30' }, { open: '18:00', close: '23:00' }] },
  { id: 'dia_todo', rotulo: 'O dia todo', intervals: [{ open: '11:00', close: '23:00' }] },
];

/** Troca a semana inteira pelo modelo (as datas especiais ficam como estão). */
export function aplicarModelo(h: HorarioDelivery, id: ModeloId): HorarioDelivery {
  const m = MODELOS.find((x) => x.id === id);
  if (!m) return h;
  return aplicarDia(h, TODOS_OS_DIAS, true, m.intervals);
}

/** O modelo que a semana atual já é (todos os dias iguais a ele), ou null. */
export function modeloAtual(h: HorarioDelivery): ModeloId | null {
  for (const m of MODELOS) {
    const alvo = txtJanelas(janelasDoDia({ enabled: true, intervals: m.intervals }));
    if (TODOS_OS_DIAS.every((d) => txtJanelas(janelasDoDia(h.days?.[String(d)])) === alvo)) return m.id;
  }
  return null;
}

/** Nenhum dia da semana tem horário. */
export function semanaVazia(h: HorarioDelivery): boolean {
  return TODOS_OS_DIAS.every((d) => janelasDoDia(h.days?.[String(d)]).length === 0);
}

// ── Datas especiais ─────────────────────────────────────────────────────────

export interface NovaData { date: string; label: string; fechado: boolean; ints: IntervaloHorario[] }

/** Cria ou troca uma data especial. `anterior` = a data que estava sendo editada (pode ter mudado de dia). */
export function salvarDataEspecial(h: HorarioDelivery, anterior: string | null, nova: NovaData): HorarioDelivery {
  const limpos = limparIntervalos(nova.ints);
  const fechado = nova.fechado || limpos.length === 0;
  const item: DataEspecial = { date: nova.date, closed: fechado };
  if (!fechado) item.intervals = limpos;
  const label = nova.label.trim().slice(0, 40);
  if (label) item.label = label;
  const resto = (h.exceptions ?? []).filter((e) => e.date !== anterior && e.date !== nova.date);
  return normalizarHorarioDelivery({ ...h, exceptions: [...resto, item] });
}

export function apagarDataEspecial(h: HorarioDelivery, date: string): HorarioDelivery {
  return normalizarHorarioDelivery({ ...h, exceptions: (h.exceptions ?? []).filter((e) => e.date !== date) });
}

export function apagarDatasPassadas(h: HorarioDelivery, hoje: string): HorarioDelivery {
  return normalizarHorarioDelivery({ ...h, exceptions: (h.exceptions ?? []).filter((e) => e.date >= hoje) });
}

/** Próximas (de hoje em diante, mais perto primeiro) e passadas (a mais recente primeiro). */
export function separarDatas(h: HorarioDelivery, hoje: string): { proximas: DataEspecial[]; passadas: DataEspecial[] } {
  const todas = (h.exceptions ?? []).filter((e) => e && typeof e.date === 'string');
  const proximas = todas.filter((e) => e.date >= hoje).sort((a, b) => a.date.localeCompare(b.date));
  const passadas = todas.filter((e) => e.date < hoje).sort((a, b) => b.date.localeCompare(a.date));
  return { proximas, passadas };
}

/** 0 = domingo, de uma data AAAA-MM-DD (conta no calendário, sem fuso). */
export function diaDaSemana(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

/** "25/12" (com o ano quando não é o ano de `ymdHoje`: "25/12/2027"). */
export function fmtData(ymd: string, ymdHoje: string): string {
  const [y, m, d] = ymd.split('-');
  const base = `${d}/${m}`;
  return y && y !== ymdHoje.slice(0, 4) ? `${base}/${y}` : base;
}

/** "25/12 · Natal" (sem nome: "25/12 · sexta"). */
export function tituloData(e: DataEspecial, ymdHoje: string): string {
  return `${fmtData(e.date, ymdHoje)} · ${e.label?.trim() || DIAS_MINUSCULO[diaDaSemana(e.date)]}`;
}

/** "Fechado o dia todo" / "Só 18:00 às 21:00". */
export function descData(e: DataEspecial): string {
  if (e.closed) return 'Fechado o dia todo';
  const js = janelasDaData({ enabled: true, exceptions: [{ ...e, closed: false }] }, e.date, diaDaSemana(e.date));
  return js.length ? `Só ${txtAs(js)}` : 'Fechado o dia todo';
}

// ── Hoje ────────────────────────────────────────────────────────────────────

/** "3h15", "1h", "45 min". */
export function fmtDuracao(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); const r = m % 60;
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
}

export interface ResumoHoje { tom: 'ok' | 'neutro'; titulo: string; linhas: string[] }

export const FRASE_CAIXA = 'Se no horário o caixa ainda estiver fechado, o delivery espera e abre quando o caixa abrir.';

/** O cartão "Hoje": o que o rascunho diz para hoje e para agora. */
export function resumoHoje(h: HorarioDelivery, now: Date): ResumoHoje {
  const { ymd, dow, minutes } = agoraBrasilia(now);
  const js = janelasDaData(h, ymd, dow);
  const esp = dataEspecial(h, ymd);
  let titulo = `${DIAS_LONGO[dow]}: ${js.length ? txtAs(js) : 'fechado'}`;
  if (esp) titulo += ` (${esp.label?.trim() || 'data especial'})`;
  if (!h.enabled) {
    return { tom: 'neutro', titulo, linhas: ['O horário está desligado: o delivery abre e fecha só pelo botão do caixa.'] };
  }
  const agora = hhmm(minutes);
  const aberto = janelaAgora(h, now);
  if (aberto) {
    const fecha = fmtDuracao(aberto.faltam);
    return {
      tom: 'ok', titulo,
      linhas: [
        aberto.deOntem
          ? `Agora (${agora}) está aberto, pelo horário de ontem, e fecha em ${fecha}.`
          : `Agora (${agora}) está aberto e fecha em ${fecha}.`,
        FRASE_CAIXA,
      ],
    };
  }
  const prox = proximaAbertura(h, now);
  let linha: string;
  if (!prox) {
    linha = `Agora (${agora}) está fechado e nenhum dia dos próximos 8 tem horário.`;
  } else if (prox.emDias === 0) {
    linha = `Agora (${agora}) está fechado; abre às ${prox.hora}.`;
  } else {
    const quando = `${DIAS_MINUSCULO[prox.dow]}${prox.emDias >= 7 ? ` (${fmtData(prox.ymd, ymd)})` : ''}`;
    linha = js.length
      ? `Agora (${agora}) está fechado; hoje já acabou. Próxima abertura ${quando} às ${prox.hora}.`
      : `Hoje não abre; próxima abertura ${quando} às ${prox.hora}.`;
  }
  return { tom: 'neutro', titulo, linhas: [linha, FRASE_CAIXA] };
}
