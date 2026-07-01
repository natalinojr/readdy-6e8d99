import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGestorEntregas, type EntregaPedido } from './hooks/useGestorEntregas';
import { COLUNAS, colunaDe, prazoInfo, temProblema, type ColunaId } from './utils';
import EntregaCard from './components/EntregaCard';
import EntregaDetalheModal from './components/EntregaDetalheModal';
import ProblemaModal from './components/ProblemaModal';
import LiberarModal from './components/LiberarModal';
import MapaEntregasGestor, { type PontoGestor } from './components/MapaEntregasGestor';

const FASE_CURTA: Record<ColunaId, string> = {
  preparo: 'Em preparo', pronto: 'Pronto', a_caminho: 'A caminho', coletado: 'Coletado', entregue: 'Entregue',
};

export default function GestorEntregasPage() {
  const navigate = useNavigate();
  const { orders, loading, erro, busy, now, autor, recarregar, setStatus, liberar, fetchDetalhe, addNote } = useGestorEntregas();
  const [modalProblema, setModalProblema] = useState<string | null>(null);
  const [modalLiberar, setModalLiberar] = useState<string | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [showMapa, setShowMapa] = useState(false);

  // Filtros
  const [fEntregador, setFEntregador] = useState<string>('todos'); // 'todos' | 'sem' | driver_id
  const [fFase, setFFase] = useState<ColunaId | 'todas'>('todas');
  const [fAtraso, setFAtraso] = useState(false);
  const [fProblema, setFProblema] = useState(false);

  const estaAtrasado = (o: EntregaPedido) => !!prazoInfo(o, now)?.atrasado;

  // Entregadores presentes nos pedidos atuais (p/ o select).
  const entregadores = useMemo(() => {
    const m = new Map<string, string>();
    orders.forEach((o) => { if (o.driver_id) m.set(o.driver_id, o.driver_nome || 'Entregador'); });
    return [...m.entries()].map(([id, nome]) => ({ id, nome }));
  }, [orders]);
  const temSemEntregador = orders.some((o) => !o.driver_id);

  // Aplica entregador + atraso (a fase é aplicada nas colunas exibidas).
  const baseFiltrada = useMemo(() => orders.filter((o) => {
    if (fEntregador === 'sem') { if (o.driver_id) return false; }
    else if (fEntregador !== 'todos') { if (o.driver_id !== fEntregador) return false; }
    if (fAtraso && !estaAtrasado(o)) return false;
    if (fProblema && !temProblema(o)) return false;
    return true;
  }), [orders, fEntregador, fAtraso, fProblema, now]);

  const porColuna = useMemo(() => {
    const g: Record<ColunaId, EntregaPedido[]> = { preparo: [], pronto: [], a_caminho: [], coletado: [], entregue: [] };
    baseFiltrada.forEach((o) => g[colunaDe(o)].push(o));
    return g;
  }, [baseFiltrada]);

  // Fase selecionada → mostra só aquela coluna (ocupa a tela).
  const umaFase = fFase !== 'todas';
  const colunasVisiveis = umaFase ? COLUNAS.filter((c) => c.id === fFase) : COLUNAS;

  // Contadores do cabeçalho (sobre todos os pedidos, sem os filtros).
  const emAndamento = orders.filter((o) => o.status !== 'delivered' && o.motoboy_status !== 'entregou');
  const atrasadosCount = emAndamento.filter(estaAtrasado).length;
  const comProblema = orders.filter(temProblema).length;

  const pontosMapa: PontoGestor[] = baseFiltrada.map((o) => ({
    id: o.id, number: o.number, cliente: o.cliente, endereco: o.endereco,
    lat: o.lat, lng: o.lng, atrasado: estaAtrasado(o), motoboy_status: o.motoboy_status, driver_nome: o.driver_nome,
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Cabeçalho */}
      <div className="px-4 md:px-6 py-3 flex-shrink-0 bg-white border-b border-zinc-100 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <button onClick={() => navigate('/modulos')} title="Voltar aos Módulos"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors cursor-pointer flex-shrink-0">
              <i className="ri-arrow-left-line text-base" />
            </button>
            <div className="w-px h-5 bg-zinc-200 flex-shrink-0" />
            <div className="w-8 h-8 flex items-center justify-center bg-orange-100 rounded-lg flex-shrink-0">
              <i className="ri-e-bike-2-line text-orange-600 text-sm" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-zinc-900 truncate">Gestor de Entregas</h1>
              <p className="text-xs text-zinc-400">{loading ? 'Carregando...' : `${emAndamento.length} em andamento`}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {atrasadosCount > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
                <i className="ri-time-line text-red-500 text-sm" />
                <span className="text-xs font-semibold text-red-600">{atrasadosCount} em atraso</span>
              </div>
            )}
            {comProblema > 0 && (
              <div className="hidden md:flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                <i className="ri-alert-line text-amber-600 text-sm" />
                <span className="text-xs font-semibold text-amber-700">{comProblema} c/ problema</span>
              </div>
            )}
            <button onClick={() => setShowMapa(true)}
              className="inline-flex items-center gap-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer">
              <i className="ri-map-2-line text-sky-600" /> Mapa
            </button>
            <button onClick={recarregar} disabled={loading} title="Atualizar"
              className="inline-flex items-center gap-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50">
              <i className={'ri-refresh-line' + (loading ? ' animate-spin' : '')} />
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Entregador */}
          <div className="relative">
            <i className="ri-e-bike-2-line absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs pointer-events-none" />
            <select value={fEntregador} onChange={(e) => setFEntregador(e.target.value)}
              className="appearance-none pl-7 pr-7 py-1.5 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-600 focus:outline-none focus:border-amber-400 cursor-pointer bg-white">
              <option value="todos">Todos entregadores</option>
              {entregadores.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
              {temSemEntregador && <option value="sem">Sem entregador</option>}
            </select>
            <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 text-xs pointer-events-none" />
          </div>

          {/* Fase */}
          <div className="flex items-center gap-1 overflow-x-auto">
            <button onClick={() => setFFase('todas')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${fFase === 'todas' ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}>
              Todas
            </button>
            {COLUNAS.map((c) => (
              <button key={c.id} onClick={() => setFFase(c.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 ${fFase === c.id ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}>
                {FASE_CURTA[c.id]}
                <span className={`text-[10px] px-1 rounded-full ${fFase === c.id ? 'bg-white/25' : 'bg-zinc-200'}`}>{porColuna[c.id].length}</span>
              </button>
            ))}
          </div>

          {/* Em atraso */}
          <button onClick={() => setFAtraso((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors flex items-center gap-1 border ${fAtraso ? 'bg-red-500 text-white border-red-500' : 'bg-white text-red-600 border-red-200 hover:bg-red-50'}`}>
            <i className="ri-time-line" /> Em atraso
            <span className={`text-[10px] px-1 rounded-full ${fAtraso ? 'bg-white/25' : 'bg-red-100'}`}>{atrasadosCount}</span>
          </button>

          {/* Com problema */}
          <button onClick={() => setFProblema((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors flex items-center gap-1 border ${fProblema ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'}`}>
            <i className="ri-alert-line" /> Com problema
            <span className={`text-[10px] px-1 rounded-full ${fProblema ? 'bg-white/25' : 'bg-amber-100'}`}>{comProblema}</span>
          </button>

          {(fEntregador !== 'todos' || fFase !== 'todas' || fAtraso || fProblema) && (
            <button onClick={() => { setFEntregador('todos'); setFFase('todas'); setFAtraso(false); setFProblema(false); }}
              className="text-xs text-amber-600 hover:text-amber-700 font-semibold ml-1">Limpar</button>
          )}
        </div>

        {erro && <p className="text-xs text-red-600">{erro}</p>}
      </div>

      {/* Kanban */}
      <div className={'flex-1 overflow-x-auto overflow-y-hidden p-4 md:p-6' + (umaFase ? '' : ' snap-x snap-mandatory')}>
        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center py-20 w-full">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-100 p-10 text-center max-w-md mx-auto mt-10">
            <i className="ri-e-bike-2-line text-4xl text-zinc-300" />
            <p className="text-sm font-semibold text-zinc-500 mt-3">Nenhuma entrega em andamento.</p>
            <p className="text-xs text-zinc-400 mt-1">Pedidos de entrega própria aparecem aqui automaticamente.</p>
          </div>
        ) : (
          <div className={umaFase ? 'h-full max-w-lg mx-auto flex flex-col' : 'flex gap-3 h-full min-w-max'}>
            {colunasVisiveis.map((col) => {
              const lista = porColuna[col.id];
              return (
                <div key={col.id} className={`flex flex-col h-full ${umaFase ? 'w-full' : 'w-[86vw] max-w-[320px] sm:w-[280px] flex-shrink-0 snap-start'}`}>
                  <div className={`flex items-center justify-between px-3 py-2 rounded-xl border mb-2 ${col.head}`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                      <span className="text-xs font-bold">{col.label}</span>
                    </div>
                    <span className="text-[11px] font-black bg-white/70 px-1.5 py-0.5 rounded-full">{lista.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
                    {lista.length === 0 ? (
                      <div className="text-center text-[11px] text-zinc-300 py-8 border border-dashed border-zinc-200 rounded-xl">vazio</div>
                    ) : (
                      lista.map((o) => (
                        <EntregaCard key={o.id} pedido={o} now={now} busy={busy}
                          onAbrir={(id) => setDetalheId(id)}
                          onAvancar={setStatus}
                          onProblema={(id) => setModalProblema(id)}
                          onLiberar={(id) => setModalLiberar(id)} />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {detalheId && (
        <EntregaDetalheModal
          orderId={detalheId}
          autor={autor}
          busy={busy}
          fetchDetalhe={fetchDetalhe}
          onAddNote={addNote}
          onClose={() => setDetalheId(null)}
        />
      )}

      {showMapa && <MapaEntregasGestor pontos={pontosMapa} onClose={() => setShowMapa(false)} />}

      {modalProblema && (
        <ProblemaModal busy={!!busy} onCancelar={() => setModalProblema(null)}
          onConfirmar={(motivo) => { const id = modalProblema; setModalProblema(null); setStatus(id, 'problema', motivo); }} />
      )}
      {modalLiberar && (
        <LiberarModal busy={!!busy} onCancelar={() => setModalLiberar(null)}
          onConfirmar={() => { const id = modalLiberar; setModalLiberar(null); liberar(id); }} />
      )}
    </div>
  );
}
