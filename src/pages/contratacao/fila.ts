// "Minha fila" de Contratação (2026-09-30): tudo que depende de quem contrata, na ordem de urgência —
// responder a IA → entrevistas de hoje → registrar entrevista que já passou → decidir → olhar
// currículos novos. Lógica pura (sem query, sem JSX): a tela só desenha. Dia sempre em Brasília
// (diaKeyBR), nunca no fuso da máquina — mesma regra de hoje.ts.
import { type Candidate, type Interview, type Stage } from './shared';
import { diaKeyBR } from './hoje';

export interface EntrevistaDaFila { iv: Interview; c: Candidate }
export interface Fila {
  /** Agendadas para hoje que ainda não começaram (horário >= agora), da mais cedo para a mais tarde. */
  hoje: EntrevistaDaFila[];
  /** Ainda "agendada" com o horário já passado: ninguém registrou. Mais recente primeiro. */
  registrar: EntrevistaDaFila[];
  /** Entrevista realizada e o candidato ainda sem decisão (GPC/PC/R/NA). Fora quem já foi descartado. */
  decidir: EntrevistaDaFila[];
  /** Na fase nativa "novo" (ou sem fase válida) e sem decisão: currículos para a triagem. Mais novo primeiro. */
  triar: Candidate[];
}

/** Id da fase em que o candidato está de fato: sem fase ou fase apagada conta como "novo" (mesma regra do Kanban). */
export function faseEfetiva(c: Candidate, stages: Stage[]): string | null {
  const ids = new Set(stages.map((s) => s.id));
  if (c.stage_id && ids.has(c.stage_id)) return c.stage_id;
  return stages.find((s) => s.native_kind === 'novo')?.id ?? null;
}

export function montarFila(input: { interviews: Interview[]; candidates: Candidate[]; stages: Stage[]; agora: Date }): Fila {
  const { interviews, candidates, stages, agora } = input;
  const agoraIso = agora.toISOString();
  const hojeKey = diaKeyBR(agoraIso);
  const porId = new Map(candidates.map((c) => [c.id, c]));
  const novoId = stages.find((s) => s.native_kind === 'novo')?.id ?? null;
  const descartadoId = stages.find((s) => s.native_kind === 'descartado')?.id ?? null;
  const com = (iv: Interview) => { const c = porId.get(iv.candidate_id); return c ? { iv, c } : null; };
  const ok = <T,>(x: T | null): x is T => x != null;

  const agendadas = interviews.filter((iv) => iv.status === 'agendada' && iv.scheduled_at);
  const hoje = agendadas
    .filter((iv) => iv.scheduled_at >= agoraIso && diaKeyBR(iv.scheduled_at) === hojeKey)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .map(com).filter(ok);
  const registrar = agendadas
    .filter((iv) => iv.scheduled_at < agoraIso)
    .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))
    .map(com).filter(ok);

  // Última entrevista realizada de cada candidato.
  const ultimaRealizada = new Map<string, Interview>();
  for (const iv of interviews) {
    if (iv.status !== 'realizada') continue;
    const cur = ultimaRealizada.get(iv.candidate_id);
    if (!cur || iv.scheduled_at > cur.scheduled_at) ultimaRealizada.set(iv.candidate_id, iv);
  }
  const decidir = [...ultimaRealizada.values()]
    .map(com).filter(ok)
    .filter(({ c }) => !c.decision && faseEfetiva(c, stages) !== descartadoId)
    .sort((a, b) => b.iv.scheduled_at.localeCompare(a.iv.scheduled_at));

  const triar = candidates
    .filter((c) => !c.decision && novoId != null && faseEfetiva(c, stages) === novoId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return { hoje, registrar, decidir, triar };
}

/**
 * Agenda dos próximos `dias` dias (hoje incluído), em Brasília: entrevistas agendadas agrupadas por
 * dia (AAAA-MM-DD), só os dias que têm alguma. Hoje só entra o que ainda não passou.
 */
export function agendaDosProximosDias(interviews: Interview[], agora: Date, dias = 7): { diaKey: string; itens: Interview[] }[] {
  const agoraIso = agora.toISOString();
  const limite = diaKeyBR(new Date(agora.getTime() + (dias - 1) * 86_400_000).toISOString());
  const m = new Map<string, Interview[]>();
  for (const iv of interviews) {
    if (iv.status !== 'agendada' || !iv.scheduled_at || iv.scheduled_at < agoraIso) continue;
    const k = diaKeyBR(iv.scheduled_at);
    if (k > limite) continue;
    m.set(k, [...(m.get(k) ?? []), iv]);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([diaKey, itens]) => ({ diaKey, itens: itens.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)) }));
}
