import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, CalendarOff, Plus } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { CampoCustom, TaskList, TaskRow } from '../hooks/useTarefas';
import type { UsuarioOption } from '../lib/agrupamento';
import { useIsMobile } from '../lib/mobile';
import TaskCard from './TaskCard';

interface ViewCalendarioProps {
  list: TaskList | null;
  tasks: TaskRow[];
  campos: CampoCustom[];
  usuarios: UsuarioOption[];
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  onOpenTask: (taskId: string) => void;
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Chave local YYYY-MM-DD (evita o deslocamento de fuso do toISOString). */
function chaveDia(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Grade de 6 semanas cobrindo o mês, começando no domingo. */
function gerarGradeMes(referencia: Date): Date[] {
  const primeiro = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
  const inicio = new Date(primeiro);
  inicio.setDate(1 - primeiro.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    return d;
  });
}

/** Semana (7 dias) contendo a data de referência. */
function gerarGradeSemana(referencia: Date): Date[] {
  const inicio = new Date(referencia);
  inicio.setDate(referencia.getDate() - referencia.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    return d;
  });
}

export default function ViewCalendario({
  list, tasks, campos, usuarios, write, onOpenTask,
}: ViewCalendarioProps) {
  const toast = useToast();
  const celular = useIsMobile();
  const [referencia, setReferencia] = useState(() => new Date());
  // No celular a grade de 7 colunas fica ilegível — começa na semana.
  const [modo, setModo] = useState<'mes' | 'semana'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'semana' : 'mes',
  );
  const [diaSelecionado, setDiaSelecionado] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [arrastandoId, setArrastandoId] = useState<string | null>(null);
  const [diaAlvo, setDiaAlvo] = useState<string | null>(null);
  const [criandoEm, setCriandoEm] = useState<string | null>(null);
  const [novoTitulo, setNovoTitulo] = useState('');

  const dias = useMemo(
    () => (modo === 'mes' ? gerarGradeMes(referencia) : gerarGradeSemana(referencia)),
    [referencia, modo],
  );

  const porDia = useMemo(() => {
    const mapa = new Map<string, TaskRow[]>();
    for (const t of tasks) {
      if (!t.due_date) continue;
      const chave = chaveDia(new Date(t.due_date));
      const atual = mapa.get(chave) ?? [];
      atual.push(t);
      mapa.set(chave, atual);
    }
    return mapa;
  }, [tasks]);

  const semData = useMemo(
    () => tasks.filter((t) => !t.due_date && t.status_category !== 'done' && t.status_category !== 'cancelled'),
    [tasks],
  );

  const hojeChave = chaveDia(new Date());
  const mesAtual = referencia.getMonth();

  const navegar = (delta: number) => {
    const d = new Date(referencia);
    if (modo === 'mes') d.setMonth(d.getMonth() + delta);
    else d.setDate(d.getDate() + 7 * delta);
    setReferencia(d);
  };

  const remarcar = async (taskId: string, chave: string) => {
    setArrastandoId(null);
    setDiaAlvo(null);
    // Meio-dia UTC mantém a data estável em qualquer fuso do Brasil
    const res = await write('update_task', { task_id: taskId, due_date: `${chave}T12:00:00Z` });
    if (!res.success) toast.error('Erro ao remarcar tarefa', res.error);
  };

  const criarNoDia = async (chave: string) => {
    const title = novoTitulo.trim();
    setCriandoEm(null);
    setNovoTitulo('');
    if (!title || !list) return;
    const res = await write('create_task', { list_id: list.id, title, due_date: `${chave}T12:00:00Z` });
    if (!res.success) toast.error('Erro ao criar tarefa', res.error);
  };

  const tituloPeriodo = modo === 'mes'
    ? referencia.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : `${dias[0].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – ${dias[6].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`;

  // ══ Celular: modo agenda (faixa de dias + tarefas do dia escolhido) ══
  if (celular) {
    const diasDaSemana = gerarGradeSemana(referencia);
    const doDiaSelecionado = (porDia.get(diaSelecionado) ?? []).slice().sort(
      (a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''),
    );
    const dataSel = new Date(`${diaSelecionado}T12:00:00`);

    return (
      <div className="space-y-3">
        {/* Faixa da semana */}
        <div className="bg-white rounded-xl border border-slate-200 p-2">
          <div className="flex items-center justify-between mb-2 px-1">
            <button onClick={() => navegar(-1)} className="p-2 -m-1 rounded-lg text-slate-500 active:bg-slate-100">
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-semibold text-slate-700 capitalize">
              {referencia.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
            </span>
            <button onClick={() => navegar(1)} className="p-2 -m-1 rounded-lg text-slate-500 active:bg-slate-100">
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {diasDaSemana.map((dia) => {
              const chave = chaveDia(dia);
              const qtd = (porDia.get(chave) ?? []).length;
              const ehHoje = chave === hojeChave;
              const selecionado = chave === diaSelecionado;
              return (
                <button
                  key={chave}
                  onClick={() => setDiaSelecionado(chave)}
                  onDragOver={(e) => {
                    if (!arrastandoId) return;
                    e.preventDefault();
                    setDiaAlvo(chave);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (arrastandoId) remarcar(arrastandoId, chave);
                  }}
                  className={`flex flex-col items-center py-2 rounded-lg transition ${
                    selecionado ? 'bg-indigo-600 text-white' : diaAlvo === chave ? 'bg-indigo-50' : 'active:bg-slate-100'
                  }`}
                >
                  <span className={`text-[10px] uppercase ${selecionado ? 'text-indigo-100' : 'text-slate-400'}`}>
                    {DIAS_SEMANA[dia.getDay()]}
                  </span>
                  <span
                    className={`text-sm font-semibold mt-0.5 ${
                      selecionado ? 'text-white' : ehHoje ? 'text-indigo-600' : 'text-slate-700'
                    }`}
                  >
                    {dia.getDate()}
                  </span>
                  <span
                    className={`w-1 h-1 rounded-full mt-1 ${
                      qtd > 0 ? (selecionado ? 'bg-white' : 'bg-indigo-400') : 'bg-transparent'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Tarefas do dia escolhido */}
        <div>
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-semibold text-slate-600 capitalize">
              {dataSel.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
            </span>
            <span className="text-xs text-slate-400">{doDiaSelecionado.length}</span>
          </div>

          <div className="space-y-2">
            {doDiaSelecionado.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                campos={campos}
                usuarios={usuarios}
                onOpen={onOpenTask}
              />
            ))}
            {doDiaSelecionado.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-6 bg-white rounded-xl border border-slate-200">
                Nada marcado para este dia.
              </p>
            )}
          </div>

          {list && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                criarNoDia(diaSelecionado);
              }}
              className="flex items-center gap-2 mt-2 bg-white rounded-xl border border-slate-200 px-3 py-2.5"
            >
              <Plus size={16} className="text-slate-300 shrink-0" />
              <input
                value={criandoEm === diaSelecionado ? novoTitulo : ''}
                onFocus={() => setCriandoEm(diaSelecionado)}
                onChange={(e) => setNovoTitulo(e.target.value)}
                placeholder="Nova tarefa neste dia…"
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400"
              />
            </form>
          )}
        </div>

        {/* Sem data */}
        {semData.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2 px-1 text-xs font-semibold text-slate-600">
              <CalendarOff size={13} className="text-slate-400" />
              Sem data
              <span className="text-slate-400 font-normal">{semData.length}</span>
            </div>
            <div className="space-y-2">
              {semData.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  campos={campos}
                  usuarios={usuarios}
                  onOpen={onOpenTask}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-4 items-start">
      {/* ── Calendário ── */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => navegar(-1)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => navegar(1)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500">
            <ChevronRight size={16} />
          </button>
          <h2 className="text-sm font-semibold text-slate-700 capitalize">{tituloPeriodo}</h2>
          <button
            onClick={() => setReferencia(new Date())}
            className="text-xs text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded hover:bg-indigo-50"
          >
            Hoje
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs">
            {(['mes', 'semana'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModo(m)}
                className={`px-2.5 py-1 rounded-lg transition ${
                  modo === m ? 'bg-white border border-slate-200 text-indigo-600 font-medium shadow-sm' : 'text-slate-500 hover:bg-slate-200'
                }`}
              >
                {m === 'mes' ? 'Mês' : 'Semana'}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* Cabeçalho dos dias da semana */}
          <div className="grid grid-cols-7 border-b border-slate-100">
            {DIAS_SEMANA.map((d) => (
              <div key={d} className="px-2 py-1.5 text-[11px] font-medium text-slate-400 text-center uppercase">
                {d}
              </div>
            ))}
          </div>

          {/* Células */}
          <div className="grid grid-cols-7">
            {dias.map((dia) => {
              const chave = chaveDia(dia);
              const doDia = porDia.get(chave) ?? [];
              const foraDoMes = modo === 'mes' && dia.getMonth() !== mesAtual;
              const ehHoje = chave === hojeChave;
              const alvo = diaAlvo === chave && arrastandoId !== null;
              return (
                <div
                  key={chave}
                  onDragOver={(e) => {
                    if (!arrastandoId) return;
                    e.preventDefault();
                    setDiaAlvo(chave);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (arrastandoId) remarcar(arrastandoId, chave);
                  }}
                  onClick={() => {
                    if (!list) return;
                    setCriandoEm(chave);
                    setNovoTitulo('');
                  }}
                  className={`border-b border-r border-slate-100 p-1.5 flex flex-col gap-1 cursor-pointer transition ${
                    modo === 'mes' ? 'min-h-[92px]' : 'min-h-[240px]'
                  } ${foraDoMes ? 'bg-slate-50/60' : 'bg-white'} ${alvo ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-300' : 'hover:bg-slate-50/80'}`}
                >
                  <span
                    className={`text-[11px] w-5 h-5 flex items-center justify-center rounded-full shrink-0 ${
                      ehHoje ? 'bg-indigo-600 text-white font-semibold' : foraDoMes ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {dia.getDate()}
                  </span>

                  <div className="space-y-0.5 flex-1">
                    {doDia.slice(0, modo === 'mes' ? 3 : 12).map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        campos={campos}
                        usuarios={usuarios}
                        onOpen={onOpenTask}
                        variante="pill"
                        arrastando={arrastandoId === task.id}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', task.id);
                          setArrastandoId(task.id);
                        }}
                        onDragEnd={() => {
                          setArrastandoId(null);
                          setDiaAlvo(null);
                        }}
                      />
                    ))}
                    {modo === 'mes' && doDia.length > 3 && (
                      <span className="text-[10px] text-slate-400 pl-1.5">+{doDia.length - 3} mais</span>
                    )}

                    {criandoEm === chave && (
                      <form
                        onClick={(e) => e.stopPropagation()}
                        onSubmit={(e) => {
                          e.preventDefault();
                          criarNoDia(chave);
                        }}
                      >
                        <input
                          autoFocus
                          value={novoTitulo}
                          onChange={(e) => setNovoTitulo(e.target.value)}
                          onBlur={() => criarNoDia(chave)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setCriandoEm(null);
                              setNovoTitulo('');
                            }
                          }}
                          placeholder="Nova tarefa…"
                          className="w-full text-[11px] px-1.5 py-0.5 rounded border border-indigo-300 outline-none"
                        />
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          Arraste uma tarefa para outro dia para remarcar. Clique num dia vazio para criar.
        </p>
      </div>

      {/* ── Painel Sem data ── */}
      <aside className="w-60 shrink-0">
        <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-slate-600">
          <CalendarOff size={13} className="text-slate-400" />
          Sem data
          <span className="text-slate-400 font-normal">{semData.length}</span>
        </div>
        <div
          className="space-y-1.5 bg-slate-100/60 rounded-xl border border-slate-200 p-2 min-h-[120px]"
          onDragOver={(e) => {
            if (!arrastandoId) return;
            e.preventDefault();
          }}
          onDrop={async (e) => {
            e.preventDefault();
            if (!arrastandoId) return;
            const id = arrastandoId;
            setArrastandoId(null);
            setDiaAlvo(null);
            const res = await write('update_task', { task_id: id, due_date: null });
            if (!res.success) toast.error('Erro ao remover data', res.error);
          }}
        >
          {semData.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              campos={campos}
              usuarios={usuarios}
              onOpen={onOpenTask}
              arrastando={arrastandoId === task.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', task.id);
                setArrastandoId(task.id);
              }}
              onDragEnd={() => {
                setArrastandoId(null);
                setDiaAlvo(null);
              }}
            />
          ))}
          {semData.length === 0 && (
            <p className="text-[11px] text-slate-400 text-center py-6 px-2">
              Tudo com data marcada.<br />Arraste uma tarefa aqui para tirar o prazo.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
