/**
 * Horário de exibição no cardápio do cliente (item, categoria e destaque).
 *
 * Gravado como jsonb (`availability_schedule`) em menu_items, menu_categories e
 * menu_highlights. `null` ou lista vazia = aparece sempre.
 *
 * Cada faixa: dias da semana (0=Dom..6=Sáb, lista vazia = todos) + início/fim "HH:MM".
 * Fim menor que o início = passa da meia-noite (ex.: 18:00–02:00): a madrugada conta
 * para o dia em que a faixa começou (sexta 18:00–02:00 vale até sábado 01:59).
 * Início igual ao fim = o dia inteiro.
 *
 * Canal (2026-10-03): a faixa pode valer só para a CASA (mesa/QR, totem, caixa, garçom)
 * ou só para o DELIVERY (link, atendente do WhatsApp, PDV delivery); sem `channel` vale
 * para os dois. Num canal sem nenhuma faixa o item aparece sempre — por isso quem decide
 * se aparece SEMPRE filtra antes com `horarioDoCanal`.
 *
 * O relógio é SEMPRE o de Brasília (America/Sao_Paulo), não o do aparelho: o celular
 * de um turista pode estar em outro fuso.
 */

export type CanalHorario = 'casa' | 'delivery';
export const CANAIS_HORARIO: CanalHorario[] = ['casa', 'delivery'];
export const NOME_CANAL: Record<CanalHorario, string> = { casa: 'Casa', delivery: 'Delivery' };

export interface FaixaHorario {
  days: number[];
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
  /** Só um canal; ausente = casa e delivery. */
  channel?: CanalHorario;
}

export type HorarioExibicao = FaixaHorario[] | null;

export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutos(hhmm: string): number | null {
  const m = HHMM.exec(String(hhmm ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Lê o jsonb do banco tolerando lixo: faixa inválida é descartada; nada válido = null (sempre). */
export function normalizarHorario(raw: unknown): HorarioExibicao {
  if (!Array.isArray(raw)) return null;
  const faixas: FaixaHorario[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const { days, start, end, channel } = f as Record<string, unknown>;
    if (minutos(String(start)) == null || minutos(String(end)) == null) continue;
    const dias = Array.isArray(days)
      ? [...new Set(days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
      : [];
    const faixa: FaixaHorario = { days: dias, start: String(start), end: String(end) };
    if (channel === 'casa' || channel === 'delivery') faixa.channel = channel;
    faixas.push(faixa);
  }
  return faixas.length ? faixas : null;
}

export function temHorario(h: HorarioExibicao | undefined): boolean {
  return !!h && h.length > 0;
}

/** Faixas que valem no canal (as sem canal valem nos dois). Nenhuma = aparece sempre nesse canal. */
export function horarioDoCanal(h: HorarioExibicao | undefined, canal: CanalHorario): HorarioExibicao {
  if (!temHorario(h)) return null;
  const faixas = h!.filter((f) => !f.channel || f.channel === canal);
  return faixas.length ? faixas : null;
}

/** Tem faixa só de um canal? (aí o resumo mostra casa e delivery separados) */
export function temHorarioPorCanal(h: HorarioExibicao | undefined): boolean {
  return !!h && h.some((f) => !!f.channel);
}

let fmtBrasilia: Intl.DateTimeFormat | null = null;

/** Dia da semana (0=Dom) e minuto do dia no horário de Brasília. */
export function agoraBrasilia(agora: Date = new Date()): { dia: number; minuto: number } {
  fmtBrasilia ??= new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const partes = fmtBrasilia.formatToParts(agora);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { dia: dia < 0 ? agora.getDay() : dia, minuto: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

const valeNoDia = (f: FaixaHorario, dia: number) => f.days.length === 0 || f.days.includes(dia);

/** Regra pura: alguma faixa cobre (dia, minuto)? Não olha canal — filtre antes com horarioDoCanal. */
export function visivelEm(h: HorarioExibicao | undefined, dia: number, minuto: number): boolean {
  if (!temHorario(h)) return true;
  return h!.some((f) => {
    const ini = minutos(f.start);
    const fim = minutos(f.end);
    if (ini == null || fim == null) return false;
    if (ini === fim) return valeNoDia(f, dia);
    if (ini < fim) return valeNoDia(f, dia) && minuto >= ini && minuto < fim;
    // Passa da meia-noite: parte da noite no próprio dia + madrugada do dia seguinte.
    return (valeNoDia(f, dia) && minuto >= ini) || (valeNoDia(f, (dia + 6) % 7) && minuto < fim);
  });
}

/** Aparece agora no canal? Todos os horários passados precisam bater (ex.: item E categoria). */
export function visivelAgora(horarios: Array<HorarioExibicao | undefined>, canal: CanalHorario, agora: Date = new Date()): boolean {
  const doCanal = horarios.map((h) => horarioDoCanal(h, canal));
  if (!doCanal.some(temHorario)) return true;
  const { dia, minuto } = agoraBrasilia(agora);
  return doCanal.every((h) => visivelEm(h, dia, minuto));
}

interface LinhaComHorario { id: string; availability_schedule?: unknown }

/**
 * Cardápio cru do cliente (mesa-qr = casa, delivery = delivery): ids fora do horário agora
 * no canal — categoria, item (o dele E o da categoria) e destaque (prefixo "h:"; o do item
 * é checado à parte). Ordenado, para virar chave estável: a tela só remonta quando algo
 * entra ou sai.
 */
export function idsForaDoHorario(
  base: { categories: LinhaComHorario[]; items: Array<LinhaComHorario & { category_id: string | null }>; highlights: LinhaComHorario[] },
  canal: CanalHorario,
  agora: Date = new Date(),
): string[] {
  const { dia, minuto } = agoraBrasilia(agora);
  const ve = (h: HorarioExibicao | undefined) => visivelEm(horarioDoCanal(h, canal), dia, minuto);
  const horarioCat = new Map(base.categories.map((c) => [c.id, normalizarHorario(c.availability_schedule)] as const));
  const fora: string[] = [];
  for (const c of base.categories) if (!ve(horarioCat.get(c.id))) fora.push(c.id);
  for (const it of base.items) {
    if (!ve(normalizarHorario(it.availability_schedule)) || !ve(horarioCat.get(it.category_id ?? ''))) fora.push(it.id);
  }
  for (const h of base.highlights) if (!ve(normalizarHorario(h.availability_schedule))) fora.push('h:' + h.id);
  return fora.sort();
}

/**
 * Existe algum momento da semana em que todos os horários batem juntos?
 * Se a interseção existe, ela começa no início de alguma faixa (ou na meia-noite, nas que
 * viram o dia) — basta testar esses minutos.
 */
export function cruzamNaSemana(horarios: Array<HorarioExibicao | undefined>): boolean {
  const candidatos = new Set<number>([0]);
  for (const h of horarios) for (const f of h ?? []) { const m = minutos(f.start); if (m != null) candidatos.add(m); }
  for (let dia = 0; dia < 7; dia++) {
    for (const minuto of candidatos) {
      if (horarios.every((h) => visivelEm(h, dia, minuto))) return true;
    }
  }
  return false;
}

/** "Seg a Sex" / "Sáb, Dom" / "Todos os dias". */
export function resumoDias(days: number[]): string {
  const ds = [...new Set(days)].sort();
  if (ds.length === 0 || ds.length === 7) return 'Todos os dias';
  // Sequência contínua (considerando Dom no fim, como no uso comum Seg..Dom)
  const ordem = ds.map((d) => (d === 0 ? 7 : d)).sort((a, b) => a - b);
  const continua = ordem.length >= 3 && ordem.every((d, i) => i === 0 || d === ordem[i - 1] + 1);
  const nome = (d: number) => DIAS_CURTOS[d % 7];
  if (continua) return `${nome(ordem[0])} a ${nome(ordem[ordem.length - 1])}`;
  return ordem.map(nome).join(', ');
}

function resumoFaixas(faixas: FaixaHorario[]): string {
  return faixas
    .map((f) => {
      const horas = f.start === f.end ? 'dia todo' : `${f.start}–${f.end}`;
      return `${resumoDias(f.days)} ${horas}`;
    })
    .join(' · ');
}

/**
 * Texto curto para badge/lista: "Seg a Sex 11:00–15:00 · Sáb 18:00–02:00".
 * Com faixa só de um canal: "Casa: Seg a Sex 11:00–15:00 | Delivery: sempre".
 * `canais` = onde o item é vendido (item "só delivery" não mostra a casa).
 */
export function resumoHorario(h: HorarioExibicao | undefined, canais: CanalHorario[] = CANAIS_HORARIO): string {
  if (!temHorario(h)) return 'Sempre';
  if (!temHorarioPorCanal(h)) return resumoFaixas(h!);
  return canais
    .map((c) => {
      const doCanal = horarioDoCanal(h, c);
      return `${NOME_CANAL[c]}: ${doCanal ? resumoFaixas(doCanal) : 'sempre'}`;
    })
    .join(' | ');
}

/** Problema de preenchimento para mostrar no formulário (null = ok). */
export function erroHorario(h: HorarioExibicao | undefined): string | null {
  if (!temHorario(h)) return null;
  for (const f of h!) {
    if (minutos(f.start) == null || minutos(f.end) == null) return 'Preencha o início e o fim de cada horário (HH:MM).';
    if (f.days.length === 0) return 'Escolha pelo menos um dia em cada horário.';
  }
  return null;
}
