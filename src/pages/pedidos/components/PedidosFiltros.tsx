import { useState, useRef, useEffect } from 'react';
import type { FiltroStatus, FiltroOrigem, ModoPeriodo } from './utils';
import { MESES, STATUS_LABEL, HOJE, somarDias, formatarDataExibicao } from './utils';
import type { SessionInfo } from '@/hooks/useSessions';
import { PLATAFORMAS_DELIVERY } from '@/constants/delivery';

interface PedidosFiltrosProps {
  busca: string;
  setBusca: (v: string) => void;
  filtroStatus: FiltroStatus;
  setFiltroStatus: (v: FiltroStatus) => void;
  filtroOrigem: FiltroOrigem;
  setFiltroOrigem: (v: FiltroOrigem) => void;
  filtroPlataforma: string;
  setFiltroPlataforma: (v: string) => void;
  modo: 'sessao' | 'data';
  modoPeriodo: ModoPeriodo;
  setModoPeriodo: (v: ModoPeriodo) => void;
  presetAtivo: string;
  setPresetAtivo: (v: string) => void;
  diaEspecifico: string;
  setDiaEspecifico: (v: string) => void;
  periodoInicio: string;
  setPeriodoInicio: (v: string) => void;
  periodoFim: string;
  setPeriodoFim: (v: string) => void;
  mesSelecionado: number;
  setMesSelecionado: (v: number) => void;
  anoSelecionado: number;
  setAnoSelecionado: (v: number) => void;
  anoApenas: number;
  setAnoApenas: (v: number) => void;
  labelDataAtiva: string;
  sessions: SessionInfo[];
  loadingSessions: boolean;
  sessaoSelecionadaId: string | null;
  setSessaoSelecionadaId: (v: string | null) => void;
}

export default function PedidosFiltros({
  busca, setBusca, filtroStatus, setFiltroStatus, filtroOrigem, setFiltroOrigem,
  filtroPlataforma, setFiltroPlataforma,
  modo, modoPeriodo, setModoPeriodo, presetAtivo, setPresetAtivo,
  diaEspecifico, setDiaEspecifico, periodoInicio, setPeriodoInicio,
  periodoFim, setPeriodoFim, mesSelecionado, setMesSelecionado,
  anoSelecionado, setAnoSelecionado, anoApenas, setAnoApenas,
  labelDataAtiva, sessions, loadingSessions, sessaoSelecionadaId,
  setSessaoSelecionadaId,
}: PedidosFiltrosProps) {
  const refFiltroData = useRef<HTMLDivElement>(null);
  const refSeletorSessao = useRef<HTMLDivElement>(null);
  const [filtroDataOpen, setFiltroDataOpen] = useState(false);
  const [sessaoOpen, setSessaoOpen] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (refFiltroData.current && !refFiltroData.current.contains(e.target as Node)) setFiltroDataOpen(false);
      if (refSeletorSessao.current && !refSeletorSessao.current.contains(e.target as Node)) setSessaoOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const anoAtual = new Date().getFullYear();
  const anosDisponiveis = [anoAtual - 2, anoAtual - 1, anoAtual];

  return (
    <div className="bg-white rounded-xl border border-zinc-100 p-3 md:p-4 space-y-3">
      <div className="flex flex-col gap-2 md:gap-3">
        <div className="relative flex-1">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por número, cliente, item..."
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-amber-400 bg-zinc-50 text-zinc-800"
          />
          {busca && (
            <button onClick={() => setBusca('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 cursor-pointer">
              <i className="ri-close-line text-sm" />
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          {/* Seletor de sessão */}
          {modo === 'sessao' && (
            <div className="relative flex-1" ref={refSeletorSessao}>
              <button
                onClick={() => setSessaoOpen((v) => !v)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm border border-zinc-200 rounded-lg bg-zinc-50 text-zinc-700 hover:border-amber-400 cursor-pointer transition-colors"
              >
                <i className="ri-history-line text-sm" />
                <span className="font-medium flex-1 text-left truncate">{labelDataAtiva}</span>
                {loadingSessions && <i className="ri-loader-4-line animate-spin text-xs text-zinc-400" />}
                <i className={`ri-arrow-down-s-line text-xs transition-transform flex-shrink-0 ${sessaoOpen ? 'rotate-180' : ''}`} />
              </button>
              {sessaoOpen && (
                <div className="absolute left-0 top-full mt-2 w-96 bg-white border border-zinc-100 rounded-xl z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50">
                    <p className="text-xs font-bold text-zinc-700">Selecionar sessão</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-zinc-50">
                    <button
                      onClick={() => { setSessaoSelecionadaId(null); setSessaoOpen(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 cursor-pointer ${!sessaoSelecionadaId ? 'bg-amber-50' : ''}`}
                    >
                      <div className={`w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 ${!sessaoSelecionadaId ? 'bg-amber-100' : 'bg-zinc-100'}`}>
                        <i className={`ri-radio-button-line text-sm ${!sessaoSelecionadaId ? 'text-amber-600' : 'text-zinc-400'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-bold ${!sessaoSelecionadaId ? 'text-amber-700' : 'text-zinc-700'}`}>Sessão atual</p>
                        <p className="text-[10px] text-zinc-400 mt-0.5">Pedidos da sessão em andamento</p>
                      </div>
                      {!sessaoSelecionadaId && <i className="ri-check-line text-amber-600 text-sm flex-shrink-0" />}
                    </button>
                    {loadingSessions ? (
                      <div className="flex items-center justify-center py-6 text-zinc-400">
                        <i className="ri-loader-4-line animate-spin mr-2" /><span className="text-xs">Carregando...</span>
                      </div>
                    ) : sessions.filter((s) => s.status === 'closed').map((s) => {
                      const dtAberta = new Date(s.opened_at);
                      const dtFechada = s.closed_at ? new Date(s.closed_at) : null;
                      const isSelected = sessaoSelecionadaId === s.id;
                      return (
                        <button key={s.id} onClick={() => { setSessaoSelecionadaId(s.id); setSessaoOpen(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 cursor-pointer ${isSelected ? 'bg-amber-50' : ''}`}
                        >
                          <div className={`w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 ${isSelected ? 'bg-amber-100' : 'bg-zinc-100'}`}>
                            <i className={`ri-archive-line text-sm ${isSelected ? 'text-amber-600' : 'text-zinc-400'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-bold ${isSelected ? 'text-amber-700' : 'text-zinc-700'}`}>
                              {dtAberta.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' })}{' '}
                              <span className="font-normal text-zinc-500">
                                {dtAberta.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
                                {dtFechada && ` → ${dtFechada.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`}
                              </span>
                            </p>
                            <div className="flex gap-3 mt-0.5">
                              <span className="text-[10px] text-zinc-400">{s.num_pedidos} pedidos</span>
                              <span className="text-[10px] text-emerald-600 font-semibold">R$ {s.faturamento.toFixed(2)}</span>
                            </div>
                          </div>
                          {isSelected && <i className="ri-check-line text-amber-600 text-sm flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Filtro de data */}
          <div className={`relative flex-1 ${modo === 'sessao' ? 'hidden' : ''}`} ref={refFiltroData}>
            <button
              onClick={() => setFiltroDataOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm border border-zinc-200 rounded-lg bg-zinc-50 text-zinc-700 hover:border-amber-400 cursor-pointer transition-colors"
            >
              <i className="ri-calendar-line text-sm" />
              <span className="font-medium flex-1 text-left truncate">{labelDataAtiva}</span>
              <i className={`ri-arrow-down-s-line text-xs transition-transform flex-shrink-0 ${filtroDataOpen ? 'rotate-180' : ''}`} />
            </button>
            {filtroDataOpen && (
              <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-2 w-80 bg-white border border-zinc-100 rounded-xl z-50 overflow-hidden">
                <div className="flex border-b border-zinc-100">
                  {[
                    { key: 'preset', label: 'Rápido', icon: 'ri-flashlight-line' },
                    { key: 'dia', label: 'Dia', icon: 'ri-calendar-event-line' },
                    { key: 'periodo', label: 'Período', icon: 'ri-calendar-2-line' },
                    { key: 'mes', label: 'Mês', icon: 'ri-calendar-line' },
                    { key: 'ano', label: 'Ano', icon: 'ri-calendar-todo-line' },
                  ].map((tab) => (
                    <button key={tab.key} onClick={() => setModoPeriodo(tab.key as ModoPeriodo)}
                      className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold cursor-pointer transition-colors ${modoPeriodo === tab.key ? 'bg-amber-50 text-amber-700' : 'text-zinc-700 hover:bg-zinc-50'}`}
                    >
                      <i className={`${tab.icon} text-sm`} />{tab.label}
                    </button>
                  ))}
                </div>
                <div className="p-4">
                  {modoPeriodo === 'preset' && (
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: 'hoje', label: 'Hoje', sub: formatarDataExibicao(HOJE) },
                        { key: 'ontem', label: 'Ontem', sub: formatarDataExibicao(somarDias(HOJE, -1)) },
                        { key: '7dias', label: 'Últimos 7 dias', sub: '' },
                        { key: '30dias', label: 'Últimos 30 dias', sub: '' },
                        { key: 'mes', label: 'Este mês', sub: '' },
                        { key: 'ano', label: 'Este ano', sub: HOJE.slice(0, 4) },
                        { key: 'todos', label: 'Todos os dias', sub: 'Sem filtro de data' },
                      ].map((p) => (
                        <button key={p.key} onClick={() => { setPresetAtivo(p.key); setFiltroDataOpen(false); }}
                          className={`text-left p-3 rounded-lg border cursor-pointer transition-all ${presetAtivo === p.key ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-zinc-100 hover:border-zinc-200 text-zinc-700 hover:bg-zinc-50'} ${p.key === 'todos' ? 'col-span-2' : ''}`}
                        >
                          <p className="text-xs font-semibold">{p.label}</p>
                          {p.sub && <p className="text-[10px] text-zinc-400 mt-0.5">{p.sub}</p>}
                        </button>
                      ))}
                    </div>
                  )}
                  {modoPeriodo === 'dia' && (
                    <div className="space-y-3">
                      <input type="date" value={diaEspecifico} max={HOJE} onChange={(e) => setDiaEspecifico(e.target.value)}
                        className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-700" />
                      <button onClick={() => setFiltroDataOpen(false)} className="w-full py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg cursor-pointer whitespace-nowrap">Aplicar</button>
                    </div>
                  )}
                  {modoPeriodo === 'periodo' && (
                    <div className="space-y-3">
                      <input type="date" value={periodoInicio} max={periodoFim} onChange={(e) => setPeriodoInicio(e.target.value)}
                        className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" />
                      <input type="date" value={periodoFim} min={periodoInicio} max={HOJE} onChange={(e) => setPeriodoFim(e.target.value)}
                        className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" />
                      <button onClick={() => setFiltroDataOpen(false)} className="w-full py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg cursor-pointer whitespace-nowrap">Aplicar período</button>
                    </div>
                  )}
                  {modoPeriodo === 'mes' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-zinc-600">Selecione o mês</p>
                        <select value={anoSelecionado} onChange={(e) => setAnoSelecionado(Number(e.target.value))}
                          className="text-xs border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none text-zinc-700 cursor-pointer">
                          {anosDisponiveis.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {MESES.map((nome, idx) => (
                          <button key={idx} onClick={() => { setMesSelecionado(idx); setFiltroDataOpen(false); }}
                            className={`py-2 text-xs font-semibold rounded-lg cursor-pointer ${mesSelecionado === idx ? 'bg-amber-500 text-white' : 'bg-zinc-50 text-zinc-600 hover:bg-zinc-100'}`}
                          >{nome.slice(0, 3)}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {modoPeriodo === 'ano' && (
                    <div className="grid grid-cols-3 gap-2">
                      {anosDisponiveis.map((a) => (
                        <button key={a} onClick={() => { setAnoApenas(a); setFiltroDataOpen(false); }}
                          className={`py-3 text-sm font-bold rounded-lg cursor-pointer ${anoApenas === a ? 'bg-amber-500 text-white' : 'bg-zinc-50 text-zinc-600 hover:bg-zinc-100'}`}
                        >{a}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <select value={filtroOrigem} onChange={(e) => { setFiltroOrigem(e.target.value as FiltroOrigem); if (e.target.value !== 'delivery') setFiltroPlataforma('todos'); }}
            className="text-sm border border-zinc-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400 bg-zinc-50 text-zinc-700 cursor-pointer whitespace-nowrap"
          >
            <option value="todos">Todas as origens</option>
            <option value="caixa">PDV Caixa</option>
            <option value="garcom">PDV Garçom</option>
            <option value="mesa">Mesa (QR Code)</option>
            <option value="autoatendimento">Autoatendimento</option>
            <option value="delivery">Delivery</option>
          </select>

          {/* Filtro de plataforma — só aparece quando origem = delivery */}
          {filtroOrigem === 'delivery' && (
            <select
              value={filtroPlataforma}
              onChange={(e) => setFiltroPlataforma(e.target.value)}
              className="text-sm border border-amber-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400 bg-amber-50 text-amber-700 cursor-pointer whitespace-nowrap"
            >
              <option value="todos">Todas as plataformas</option>
              {PLATAFORMAS_DELIVERY.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
              <option value="unknown">Sem plataforma</option>
            </select>
          )}
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-zinc-100 rounded-xl overflow-x-auto">
        {([
          { key: 'todos', label: 'Todos' },
          { key: 'aberto', label: 'Em aberto' },
          { key: 'pronto', label: 'Pronto' },
          { key: 'entregue', label: 'Entregue' },
          { key: 'cancelado', label: 'Cancelado' },
        ] as { key: FiltroStatus; label: string }[]).map((s) => (
          <button key={s.key} onClick={() => setFiltroStatus(s.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-all whitespace-nowrap flex-shrink-0 ${
              filtroStatus === s.key ? 'bg-white text-zinc-800 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
