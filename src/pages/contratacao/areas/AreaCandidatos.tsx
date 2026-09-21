import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Distance, type Candidate, type Company, type Interview, type Job, type Stage, DECISIONS, stageOf, stageByKind, companyName } from '../shared';
import type { Aderencia } from '../aderencia';
import type { ModoCandidatos } from '../navegacao';
import CandidatosLista from '../components/CandidatosLista';
import Kanban from '../components/Kanban';
import FiltrosCandidatos, { type FiltrosNovosValor, FILTROS_NOVOS_INICIAL, aplicarFiltrosNovos, ordenarPorAderencia } from '../components/FiltrosCandidatos';
import AcoesEmLote from '../components/AcoesEmLote';
import { confirmar } from '../dialog';

interface Props {
  busca: string; onBuscaChange: (v: string) => void;
  decisaoFiltro: string; onDecisaoFiltroChange: (v: string) => void;
  view: ModoCandidatos; onViewChange: (v: ModoCandidatos) => void;
  items: Candidate[]; buscados: Candidate[]; filtrados: Candidate[]; daEmpresa: Candidate[];
  stages: Stage[]; companies: Company[]; mostrarEmpresa: boolean;
  faseFiltro: string; onFaseFiltroChange: (v: string) => void;
  counts: Record<string, number>;
  proximaEntrevista: Map<string, Interview>; ultimaAvaliacao: Map<string, Interview>;
  distanciaLista: (c: Candidate) => Distance | null;
  vagasDe: (c: Candidate) => string[];
  vagaIdsDe: (c: Candidate) => string[];
  jobs: Job[];
  aderenciaDe: (c: Candidate) => Aderencia | null;
  faltasDe: (c: Candidate) => number;
  agendamentoIADe: (c: Candidate) => string | null;
  onOpen: (id: string) => void;
  onMove: (candidateId: string, stageId: string) => void;
  onMoverLote: (ids: string[], stageId: string) => Promise<void>;
}

export default function AreaCandidatos(props: Props) {
  const [filtrosNovos, setFiltrosNovos] = useState<FiltrosNovosValor>(FILTROS_NOVOS_INICIAL);

  // Etiquetas de vaga: job_id distintos vindos de `buscados` (Decisão 7 — mesma amplitude dos chips
  // de fase), não título — duas vagas de empresas diferentes podem ter o mesmo título, e filtrar por
  // string misturaria os candidatos das duas. O rótulo mostrado continua o título, desambiguado com
  // a empresa quando `mostrarEmpresa` (mesmo padrão de Kanban/Vagas: `${título} · ${empresa}`).
  const jobsPorId = useMemo(() => new Map(props.jobs.map((j) => [j.id, j])), [props.jobs]);
  const vagasDisponiveis = useMemo(() => {
    const ids = [...new Set(props.buscados.flatMap(props.vagaIdsDe))];
    return ids
      .map((id) => {
        const job = jobsPorId.get(id);
        const titulo = job?.title ?? 'Vaga removida';
        const label = props.mostrarEmpresa ? [titulo, companyName(props.companies, job?.company_id ?? null)].join(' · ') : titulo;
        return { id, label };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [props.buscados, props.vagaIdsDe, jobsPorId, props.mostrarEmpresa, props.companies]);

  const buscadosComFiltrosNovos = useMemo(
    () => aplicarFiltrosNovos(props.buscados, filtrosNovos, props.vagaIdsDe, props.faltasDe),
    [props.buscados, filtrosNovos, props.vagaIdsDe, props.faltasDe],
  );
  const buscadosParaKanban = filtrosNovos.ordenarPorAderencia
    ? ordenarPorAderencia(buscadosComFiltrosNovos, props.aderenciaDe) : buscadosComFiltrosNovos;

  const filtradosComFiltrosNovos = useMemo(
    () => aplicarFiltrosNovos(props.filtrados, filtrosNovos, props.vagaIdsDe, props.faltasDe),
    [props.filtrados, filtrosNovos, props.vagaIdsDe, props.faltasDe],
  );
  const filtradosParaLista = filtrosNovos.ordenarPorAderencia
    ? ordenarPorAderencia(filtradosComFiltrosNovos, props.aderenciaDe) : filtradosComFiltrosNovos;

  // Contagem dos chips de fase considerando os filtros novos (Decisão 6) — sem filtro novo ativo é
  // idêntico a props.counts (mesmo algoritmo de page.tsx do As Is).
  const countsAjustados = useMemo(() => {
    const m: Record<string, number> = { todas: buscadosComFiltrosNovos.length };
    for (const c of buscadosComFiltrosNovos) { const s = stageOf(props.stages, c.stage_id)?.id ?? ''; m[s] = (m[s] ?? 0) + 1; }
    return m;
  }, [buscadosComFiltrosNovos, props.stages]);

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const toggleSelecao = useCallback((id: string) => setSelecionados((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  }), []);

  // Decisão 6 (T17): a seleção é podada (não zerada) para a interseção com o que está visível agora,
  // seja porque um filtro mudou, seja porque o modo (Cards/Tabela/Kanban) mudou.
  const visiveis = props.view === 'kanban' ? buscadosParaKanban : filtradosParaLista;
  useEffect(() => {
    setSelecionados((prev) => {
      const idsVisiveis = new Set(visiveis.map((c) => c.id));
      const podado = new Set([...prev].filter((id) => idsVisiveis.has(id)));
      return podado.size === prev.size ? prev : podado;
    });
  }, [visiveis]);

  const agendarStageId = stageByKind(props.stages, 'agendar')?.id ?? null;
  const descartadoStageId = stageByKind(props.stages, 'descartado')?.id ?? null;

  // Descartar em lote apaga o candidato do ranking; pergunta sempre, mesmo com ficha completa
  // (a trava de ficha incompleta não cobre este destino — moveLote não pergunta nada sozinho).
  const onDescartar = useCallback(async () => {
    if (!descartadoStageId) return;
    const ids = [...selecionados];
    const n = ids.length;
    const ok = await confirmar({
      titulo: 'Descartar candidatos?',
      mensagem: `${n} candidato${n > 1 ? 's vão' : ' vai'} para "Descartado" e sai${n > 1 ? 'em' : ''} do ranking.`,
      confirmarLabel: 'Descartar',
      perigo: true,
    });
    if (!ok) return;
    await props.onMoverLote(ids, descartadoStageId);
  }, [descartadoStageId, selecionados, props.onMoverLote]);

  return (
    <>
      {/* Busca (+ fases e modo de visualização na aba Candidatos) */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[200px]">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input value={props.busca} onChange={(e) => props.onBuscaChange(e.target.value)}
            placeholder="Buscar por nome, cargo, cidade, empresa, palavra do currículo…"
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-rose-300" />
        </div>
        <select value={props.decisaoFiltro} onChange={(e) => props.onDecisaoFiltroChange(e.target.value)} title="Tomada de decisão"
          className="flex-1 sm:flex-none min-w-0 h-10 px-3 rounded-xl border border-zinc-200 text-sm text-zinc-700 cursor-pointer">
          <option value="todas">Toda decisão</option>
          {DECISIONS.map((d) => <option key={d.id} value={d.id}>{d.sigla} — {d.label.replace(' à {empresa}', '')}</option>)}
          <option value="sem">Sem decisão</option>
        </select>
        <div className="flex rounded-xl border border-zinc-200 overflow-hidden">
          {([['cards', 'ri-layout-grid-line', 'Cards'], ['tabela', 'ri-table-line', 'Tabela'], ['kanban', 'ri-layout-column-line', 'Kanban']] as const).map(([v, icon, label]) => (
            <button key={v} onClick={() => props.onViewChange(v)} title={label}
              className={`px-3 h-10 text-sm cursor-pointer ${props.view === v ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 hover:text-zinc-800'}`}>
              <i className={icon} />
            </button>
          ))}
        </div>
      </div>

      <AcoesEmLote
        selecionados={selecionados.size}
        visiveis={visiveis.length}
        todosSelecionados={selecionados.size > 0 && selecionados.size === visiveis.length}
        stages={props.stages}
        onSelecionarTodos={() => setSelecionados(new Set(visiveis.map((c) => c.id)))}
        onLimpar={() => setSelecionados(new Set())}
        onEnviarParaAgendar={agendarStageId ? () => props.onMoverLote([...selecionados], agendarStageId) : undefined}
        onMoverFase={(stageId) => props.onMoverLote([...selecionados], stageId)}
        onDescartar={descartadoStageId ? onDescartar : undefined}
      />
      <FiltrosCandidatos vagas={vagasDisponiveis} valor={filtrosNovos} onChange={setFiltrosNovos} />

      {props.view === 'kanban' ? (
        <Kanban items={buscadosParaKanban} stages={props.stages} companies={props.companies} mostrarEmpresa={props.mostrarEmpresa}
          proximaEntrevista={props.proximaEntrevista} onOpen={props.onOpen} onMove={props.onMove}
          aderenciaDe={props.aderenciaDe} faltasDe={props.faltasDe} agendamentoIADe={props.agendamentoIADe}
          selecionados={selecionados} onToggleSelecao={toggleSelecao} />
      ) : (
        <>
          <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
            {[{ id: 'todas', name: 'Todas' }, ...props.stages].map((s) => (
              <button key={s.id} onClick={() => props.onFaseFiltroChange(s.id)}
                className={`px-3 h-8 rounded-full text-xs font-bold whitespace-nowrap border cursor-pointer transition-colors ${
                  props.faseFiltro === s.id ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'}`}>
                {s.name} <span className="opacity-60">{countsAjustados[s.id] ?? 0}</span>
              </button>
            ))}
          </div>
          {filtradosParaLista.length === 0 ? (
            <div className="py-16 text-center text-zinc-400">
              <i className="ri-inbox-line text-4xl" />
              <p className="text-sm font-semibold mt-2">{props.daEmpresa.length ? 'Nenhum candidato com esses filtros' : 'Nenhum currículo ainda'}</p>
            </div>
          ) : (
            <CandidatosLista view={props.view} items={filtradosParaLista} companies={props.companies} stages={props.stages} mostrarEmpresa={props.mostrarEmpresa}
              distancia={props.distanciaLista} vagasDe={props.vagasDe} proximaEntrevista={props.proximaEntrevista} ultimaAvaliacao={props.ultimaAvaliacao}
              onOpen={props.onOpen} aderenciaDe={props.aderenciaDe} faltasDe={props.faltasDe}
              selecionados={selecionados} onToggleSelecao={toggleSelecao} />
          )}
        </>
      )}
    </>
  );
}
