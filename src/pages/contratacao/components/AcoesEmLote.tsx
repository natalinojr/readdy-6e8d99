// Seleção múltipla + ações em lote (briefing §3.3): enviar p/ IA agendar, mover de fase, descartar.
// A regra de quem está travado pela ficha incompleta é lógica pura (Constraint 3) — mesma regra de
// updateCandidate (page.tsx), replicada aqui para N candidatos de uma vez, reaproveitando o
// `faltasDe` que T02 já calcula em page.tsx (não recalcula faltasFicha/settings aqui).
import { type Candidate, type Stage, stageOf } from '../shared';

/** Candidatos do lote que cairiam na trava de dados mínimos se movidos para `stageDestinoId`. */
export function candidatosTravadosNoLote(
  candidatos: Candidate[],
  stageDestinoId: string,
  stages: Stage[],
  faltasDe: (c: Candidate) => number,
): Candidate[] {
  const destino = stages.find((s) => s.id === stageDestinoId);
  if (!destino) return [];
  return candidatos.filter((c) => {
    if (c.stage_id === stageDestinoId) return false; // já está lá
    const de = stageOf(stages, c.stage_id);
    return de?.native_kind === 'novo' && destino.native_kind !== 'novo' && destino.native_kind !== 'descartado' && faltasDe(c) > 0;
  });
}

interface Props {
  selecionados: number;
  visiveis: number;
  todosSelecionados: boolean;
  stages: Stage[];
  onSelecionarTodos: () => void;
  onLimpar: () => void;
  onEnviarParaAgendar?: () => void;
  onMoverFase: (stageId: string) => void;
  onDescartar?: () => void;
}

/** Barra de ações em lote — mesmas classes do rodapé de AdicionarCandidatosModal.tsx. */
export default function AcoesEmLote({
  selecionados, visiveis, todosSelecionados, stages, onSelecionarTodos, onLimpar, onEnviarParaAgendar, onMoverFase, onDescartar,
}: Props) {
  if (visiveis === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 px-4 py-2.5 rounded-2xl border border-zinc-200 bg-white">
      <button onClick={todosSelecionados ? onLimpar : onSelecionarTodos} className="text-xs font-bold text-zinc-500 hover:text-zinc-800 cursor-pointer">
        {todosSelecionados ? 'Limpar' : `Marcar todos (${visiveis})`}
      </button>
      {selecionados > 0 && <span className="text-xs font-bold text-zinc-600">{selecionados} selecionado{selecionados > 1 ? 's' : ''}</span>}
      <div className="flex-1" />
      <select disabled={!selecionados} defaultValue=""
        onChange={(e) => { if (e.target.value) { onMoverFase(e.target.value); e.target.value = ''; } }}
        className="h-9 px-3 rounded-lg border border-zinc-200 text-sm text-zinc-700 cursor-pointer disabled:opacity-40">
        <option value="" disabled>Mover para…</option>
        {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {onEnviarParaAgendar && (
        <button onClick={onEnviarParaAgendar} disabled={!selecionados}
          className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-sm font-bold cursor-pointer">
          <i className="ri-robot-2-line" /> Enviar p/ IA agendar
        </button>
      )}
      {onDescartar && (
        <button onClick={onDescartar} disabled={!selecionados}
          className="px-4 h-9 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-600 disabled:opacity-40 cursor-pointer">
          Descartar
        </button>
      )}
    </div>
  );
}
