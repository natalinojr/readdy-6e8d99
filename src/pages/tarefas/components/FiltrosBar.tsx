import { useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile, useVoltarFecha } from '../lib/mobile';
import { Search, SlidersHorizontal, X, Check } from 'lucide-react';
import type { CampoCustom, TaskList, TaskTag } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';
import type { Filtros, GroupBy, UsuarioOption } from '../lib/agrupamento';
import { FILTROS_VAZIOS, camposAgrupaveis, filtrosAtivos, rotuloAgrupamento } from '../lib/agrupamento';

interface FiltrosBarProps {
  filtros: Filtros;
  onFiltros: (f: Filtros) => void;
  groupBy: GroupBy;
  onGroupBy: (g: GroupBy) => void;
  /** Kanban e Lista agrupam; o calendário não. */
  mostrarAgrupamento: boolean;
  tags: TaskTag[];
  usuarios: UsuarioOption[];
  campos: CampoCustom[];
  list: TaskList | null;
}

export default function FiltrosBar({
  filtros, onFiltros, groupBy, onGroupBy, mostrarAgrupamento, tags, usuarios, campos, list,
}: FiltrosBarProps) {
  const [aberto, setAberto] = useState(false);
  useVoltarFecha(aberto, () => setAberto(false), 'tarefas-filtros');
  // No celular a folha de filtros vai direto pro <body>: o cabeçalho tem
  // backdrop-blur, que prende o `fixed` dentro dele (a folha abria fora da tela).
  const celular = useIsMobile();
  const portalSeCelular = (n: ReactNode) => (celular ? createPortal(n, document.body) : n);
  const ativos = filtrosAtivos(filtros);
  const agrupaveis = camposAgrupaveis(campos, list?.id ?? null);

  const alternar = <T,>(lista: T[], valor: T): T[] =>
    lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];

  return (
    <div className="flex items-center gap-2">
      {/* Busca — no celular ela vive dentro do painel de filtros, para o
          cabeçalho caber numa linha só */}
      <div className="relative hidden md:block">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={filtros.busca}
          onChange={(e) => onFiltros({ ...filtros, busca: e.target.value })}
          placeholder="Buscar tarefa…"
          className="pl-7 pr-2 py-1.5 w-44 text-xs rounded-lg border border-slate-200 bg-white outline-none focus:border-indigo-300"
        />
      </div>

      {/* Agrupamento */}
      {mostrarAgrupamento && (
        <select
          value={groupBy}
          onChange={(e) => onGroupBy(e.target.value as GroupBy)}
          className="hidden md:block text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white outline-none focus:border-indigo-300 text-slate-600"
          title={`Agrupar por ${rotuloAgrupamento(groupBy, campos)}`}
        >
          <option value="status">Agrupar: Status</option>
          <option value="priority">Agrupar: Prioridade</option>
          <option value="assignee">Agrupar: Responsável</option>
          {agrupaveis.map((c) => (
            <option key={c.id} value={`field:${c.id}`}>Agrupar: {c.name}</option>
          ))}
        </select>
      )}

      {/* Filtros */}
      <div className="relative">
        <button
          onClick={() => setAberto((v) => !v)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition ${
            ativos > 0
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-medium'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
          }`}
        >
          <SlidersHorizontal size={13} />
          Filtros
          {ativos > 0 && (
            <span className="bg-indigo-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
              {ativos}
            </span>
          )}
        </button>

        {aberto && portalSeCelular(
          <>
            <div className="fixed inset-0 z-20 max-md:z-[70] max-md:bg-slate-900/30" onClick={() => setAberto(false)} />
            {/* Celular: folha que sobe de baixo, com toques maiores. */}
            <div className="absolute right-0 top-full mt-1 z-30 w-64 bg-white rounded-xl border border-slate-200 shadow-lg p-3 space-y-3 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:mt-0 max-md:w-auto max-md:z-[71] max-md:rounded-b-none max-md:rounded-t-2xl max-md:max-h-[80vh] max-md:overflow-y-auto max-md:px-4 max-md:pb-[max(env(safe-area-inset-bottom),16px)] max-md:space-y-4">
              <div className="md:hidden mx-auto -mt-1 h-1 w-10 rounded-full bg-slate-200" />
              <div className="flex items-center justify-between">
                <span className="text-xs max-md:text-base font-semibold text-slate-700">Filtrar tarefas</span>
                {ativos > 0 && (
                  <button
                    onClick={() => onFiltros({ ...FILTROS_VAZIOS })}
                    className="text-[11px] max-md:text-sm text-indigo-600 hover:text-indigo-700"
                  >
                    Limpar
                  </button>
                )}
              </div>

              {/* Busca e agrupamento no celular (no desktop ficam na barra) */}
              <div className="relative md:hidden">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={filtros.busca}
                  onChange={(e) => onFiltros({ ...filtros, busca: e.target.value })}
                  placeholder="Buscar tarefa…"
                  className="w-full pl-7 pr-2 py-2 max-md:py-2.5 text-xs max-md:text-base rounded-lg border border-slate-200 outline-none focus:border-indigo-300"
                />
              </div>
              {mostrarAgrupamento && (
                <select
                  value={groupBy}
                  onChange={(e) => onGroupBy(e.target.value as GroupBy)}
                  className="md:hidden w-full text-base px-2 py-2.5 rounded-lg border border-slate-200 bg-white outline-none focus:border-indigo-300 text-slate-600"
                >
                  <option value="status">Agrupar: Status</option>
                  <option value="priority">Agrupar: Prioridade</option>
                  <option value="assignee">Agrupar: Responsável</option>
                  {agrupaveis.map((c) => (
                    <option key={c.id} value={`field:${c.id}`}>Agrupar: {c.name}</option>
                  ))}
                </select>
              )}

              <label className="flex items-center gap-2 text-xs max-md:text-[15px] max-md:py-1 text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filtros.ocultarConcluidas}
                  onChange={(e) => onFiltros({ ...filtros, ocultarConcluidas: e.target.checked })}
                  className="rounded border-slate-300"
                />
                Ocultar concluídas
              </label>

              {/* Prioridade */}
              <div>
                <span className="text-[11px] max-md:text-xs max-md:font-semibold max-md:uppercase max-md:tracking-wide text-slate-400 block mb-1 max-md:mb-2">Prioridade</span>
                <div className="flex flex-wrap gap-1 max-md:gap-2">
                  {PRIORIDADES.map((p) => {
                    const on = filtros.prioridades.includes(p.value);
                    return (
                      <button
                        key={p.value}
                        onClick={() => onFiltros({ ...filtros, prioridades: alternar(filtros.prioridades, p.value) })}
                        className={`px-1.5 py-0.5 max-md:px-3 max-md:py-1.5 rounded max-md:rounded-lg text-[10px] max-md:text-sm font-medium border transition ${
                          on ? 'text-white' : 'text-slate-500 bg-white border-slate-200'
                        }`}
                        style={on ? { backgroundColor: p.color, borderColor: p.color } : undefined}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Responsável */}
              {usuarios.length > 0 && (
                <div>
                  <span className="text-[11px] max-md:text-xs max-md:font-semibold max-md:uppercase max-md:tracking-wide text-slate-400 block mb-1 max-md:mb-2">Responsável</span>
                  <div className="max-h-28 max-md:max-h-56 overflow-y-auto space-y-0.5">
                    {usuarios.map((u) => {
                      const on = filtros.assigneeIds.includes(u.id);
                      return (
                        <button
                          key={u.id}
                          onClick={() => onFiltros({ ...filtros, assigneeIds: alternar(filtros.assigneeIds, u.id) })}
                          className="w-full flex items-center gap-1.5 max-md:gap-3 px-1.5 py-1 max-md:px-2 max-md:py-2.5 rounded text-xs max-md:text-[15px] text-left hover:bg-slate-50"
                        >
                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${on ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                            {on && <Check size={10} className="text-white" />}
                          </span>
                          <span className="truncate text-slate-600">{u.nome}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Etiquetas */}
              {tags.length > 0 && (
                <div>
                  <span className="text-[11px] max-md:text-xs max-md:font-semibold max-md:uppercase max-md:tracking-wide text-slate-400 block mb-1 max-md:mb-2">Etiquetas</span>
                  <div className="flex flex-wrap gap-1 max-md:gap-2">
                    {tags.map((t) => {
                      const on = filtros.tagIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => onFiltros({ ...filtros, tagIds: alternar(filtros.tagIds, t.id) })}
                          className={`px-1.5 py-0.5 max-md:px-3 max-md:py-1.5 rounded-full text-[10px] max-md:text-sm font-medium border transition ${
                            on ? 'text-white' : 'text-slate-500 bg-white border-slate-200'
                          }`}
                          style={on ? { backgroundColor: t.color, borderColor: t.color } : undefined}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <button
                onClick={() => setAberto(false)}
                className="md:hidden w-full rounded-xl bg-indigo-600 text-white text-[15px] font-medium py-3 active:bg-indigo-700"
              >
                Pronto
              </button>
            </div>
          </>
        )}
      </div>

      {/* Chip de limpeza rápida */}
      {ativos > 0 && (
        <button
          onClick={() => onFiltros({ ...FILTROS_VAZIOS })}
          className="text-slate-400 hover:text-slate-600 p-1"
          title="Limpar filtros"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
