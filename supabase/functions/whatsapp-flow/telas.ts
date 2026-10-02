// Telas do formulário "Escolher horário" (WhatsApp Flow do agendamento de entrevista) e a montagem das
// listas de dia/horário. Puro (sem banco e sem rede): testado em src/test/edge/whatsappFlow.test.ts.
//
// Caminho: DIA (escolhe o dia) → HORARIO (escolhe a hora e confirma). Toda troca de tela passa pelo
// endpoint (data_exchange), que lê a agenda da vaga ao vivo no hiring-scheduler.
// Limites da Meta que valem aqui: RadioButtonsGroup ≤ 20 itens, Dropdown ≤ 200, título ≤ 30 caracteres,
// rótulo do Footer ≤ 35; campo que não está declarado no `data` da tela é descartado.

const TZ = 'America/Sao_Paulo';
export const NENHUM = 'nenhum';
const MAX_DIAS = 7;
const ANTECEDENCIA_MS = 30 * 60_000;

const exemploDias = [{ id: '2026-10-02', title: 'Amanhã · sexta 02/10', description: '5 horários' }];
const exemploHorarios = [{ id: '2026-10-02T17:00:00.000Z', title: '14:00' }, { id: NENHUM, title: 'Nenhum horário serve' }];
const lista = (exemplo: unknown) => ({
  type: 'array',
  items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } } },
  __example__: exemplo,
});

export const FLOW_JSON = {
  version: '7.3',
  data_api_version: '3.0',
  routing_model: { DIA: ['HORARIO'], HORARIO: [] },
  screens: [
    {
      id: 'DIA',
      title: 'Entrevista',
      data: {
        vaga: { type: 'string', __example__: 'Atendente' },
        local: { type: 'string', __example__: 'Presencial — Rua das Flores, 100' },
        dias: lista(exemploDias),
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: '${data.vaga}' },
          { type: 'TextBody', text: '${data.local}' },
          { type: 'RadioButtonsGroup', name: 'dia', label: 'Escolha o dia', required: true, 'data-source': '${data.dias}' },
          { type: 'TextCaption', text: 'Se nenhum dia servir, feche e responda na conversa.' },
          { type: 'Footer', label: 'Ver horários', 'on-click-action': { name: 'data_exchange', payload: { dia: '${form.dia}' } } },
        ],
      },
    },
    {
      id: 'HORARIO',
      title: 'Horário',
      terminal: true,
      data: {
        dia: { type: 'string', __example__: '2026-10-02' },
        dia_label: { type: 'string', __example__: 'Amanhã · sexta 02/10' },
        aviso: { type: 'string', __example__: 'Esse horário acabou de ser preenchido' },
        tem_aviso: { type: 'boolean', __example__: false },
        horarios: lista(exemploHorarios),
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextSubheading', text: '${data.dia_label}' },
          { type: 'TextCaption', text: '${data.aviso}', visible: '${data.tem_aviso}' },
          { type: 'Dropdown', name: 'horario', label: 'Horário', required: true, 'data-source': '${data.horarios}' },
          { type: 'Footer', label: 'Confirmar entrevista', 'on-click-action': { name: 'data_exchange', payload: { dia: '${data.dia}', horario: '${form.horario}' } } },
        ],
      },
    },
  ],
} as const;

export interface Item { id: string; title: string; description?: string }

const diaLocal = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const horaLocal = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "Hoje · quinta 01/10", "Amanhã · sexta 02/10", "Sábado 03/10" (sem o "-feira"). */
export function nomeDoDia(dia: string, agora: Date): string {
  const dt = new Date(`${dia}T12:00:00-03:00`);
  const wd = dt.toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long' }).replace('-feira', '');
  const dm = `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  const hoje = diaLocal(agora.toISOString());
  const amanha = diaLocal(new Date(agora.getTime() + 86_400_000).toISOString());
  if (dia === hoje) return `Hoje · ${wd} ${dm}`;
  if (dia === amanha) return `Amanhã · ${wd} ${dm}`;
  return `${wd[0].toUpperCase()}${wd.slice(1)} ${dm}`;
}

// Horários que ainda dá para marcar (pelo menos 30 min antes), sem repetidos, em ordem.
function validos(slots: string[], agora: Date): string[] {
  const limite = agora.getTime() + ANTECEDENCIA_MS;
  return [...new Set(slots.filter((s) => Date.parse(s) >= limite).map((s) => new Date(s).toISOString()))].sort();
}

/** Dias com horário livre (data de São Paulo), no máximo 7, com "N horários" na descrição. */
export function diasDisponiveis(slots: string[], agora: Date = new Date()): Item[] {
  const porDia = new Map<string, number>();
  for (const s of validos(slots, agora)) { const d = diaLocal(s); porDia.set(d, (porDia.get(d) ?? 0) + 1); }
  return [...porDia].slice(0, MAX_DIAS).map(([d, n]) => ({ id: d, title: nomeDoDia(d, agora), description: n === 1 ? '1 horário' : `${n} horários` }));
}

/** Horários do dia ({ id: ISO, title: 'HH:MM' }) + o item "Nenhum serve" no fim. */
export function horariosDoDia(slots: string[], dia: string, agora: Date = new Date()): Item[] {
  const doDia = validos(slots, agora).filter((s) => diaLocal(s) === dia).slice(0, 199);
  return [...doDia.map((s) => ({ id: s, title: horaLocal(s) })), { id: NENHUM, title: 'Nenhum horário serve' }];
}

/** Dados da tela HORARIO (dia escolhido + aviso opcional). */
export function telaHorario(slots: string[], dia: string, agora: Date = new Date(), aviso = '') {
  return {
    screen: 'HORARIO',
    data: { dia, dia_label: nomeDoDia(dia, agora), aviso, tem_aviso: !!aviso, horarios: horariosDoDia(slots, dia, agora) },
  };
}
