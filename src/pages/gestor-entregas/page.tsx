import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGestorEntregas } from './hooks/useGestorEntregas';
import { COLUNAS, colunaDe, prazoInfo, type ColunaId } from './utils';
import EntregaCard from './components/EntregaCard';
import ProblemaModal from './components/ProblemaModal';
import LiberarModal from './components/LiberarModal';

export default function GestorEntregasPage() {
  const navigate = useNavigate();
  const { orders, loading, erro, busy, now, recarregar, setStatus, liberar } = useGestorEntregas();
  const [modalProblema, setModalProblema] = useState<string | null>(null);
  const [modalLiberar, setModalLiberar] = useState<string | null>(null);

  // Agrupa por coluna mantendo a ordem (created_at asc vinda da Edge).
  const porColuna = useMemo(() => {
    const grupos: Record<ColunaId, typeof orders> = { preparo: [], pronto: [], a_caminho: [], coletado: [], entregue: [] };
    orders.forEach((o) => { grupos[colunaDe(o)].push(o); });
    return grupos;
  }, [orders]);

  const emAndamento = orders.filter((o) => o.status !== 'delivered' && o.motoboy_status !== 'entregou');
  const atrasados = emAndamento.filter((o) => prazoInfo(o, now)?.atrasado).length;
  const comProblema = orders.filter((o) => o.motoboy_status === 'problema').length;

  return (
    <div className="flex flex-col h-full">
      {/* Cabeçalho */}
      <div className="px-4 md:px-6 py-4 flex-shrink-0 bg-white border-b border-zinc-100">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 md:gap-3">
            <button
              onClick={() => navigate('/modulos')}
              title="Voltar aos Módulos"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors cursor-pointer flex-shrink-0"
            >
              <i className="ri-arrow-left-line text-base" />
            </button>
            <div className="w-px h-5 bg-zinc-200 flex-shrink-0" />
            <div className="w-8 h-8 flex items-center justify-center bg-orange-100 rounded-lg">
              <i className="ri-e-bike-2-line text-orange-600 text-sm" />
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-900">Gestor de Entregas</h1>
              <p className="text-xs text-zinc-400">
                {loading ? 'Carregando...' : `${emAndamento.length} em andamento`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {atrasados > 0 && (
              <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                <i className="ri-time-line text-red-500 text-sm" />
                <span className="text-xs font-semibold text-red-600">{atrasados} em atraso</span>
              </div>
            )}
            {comProblema > 0 && (
              <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                <i className="ri-alert-line text-amber-600 text-sm" />
                <span className="text-xs font-semibold text-amber-700">{comProblema} com problema</span>
              </div>
            )}
            <button onClick={recarregar} disabled={loading}
              className="inline-flex items-center gap-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50">
              <i className={'ri-refresh-line' + (loading ? ' animate-spin' : '')} /> Atualizar
            </button>
          </div>
        </div>
        {erro && <p className="text-xs text-red-600 mt-2">{erro}</p>}
      </div>

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 md:p-6">
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
          <div className="flex gap-3 h-full min-w-max">
            {COLUNAS.map((col) => {
              const lista = porColuna[col.id];
              return (
                <div key={col.id} className="w-[280px] flex-shrink-0 flex flex-col h-full">
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
                        <EntregaCard
                          key={o.id}
                          pedido={o}
                          now={now}
                          busy={busy}
                          onAvancar={setStatus}
                          onProblema={(id) => setModalProblema(id)}
                          onLiberar={(id) => setModalLiberar(id)}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalProblema && (
        <ProblemaModal
          busy={!!busy}
          onCancelar={() => setModalProblema(null)}
          onConfirmar={(motivo) => { const id = modalProblema; setModalProblema(null); setStatus(id, 'problema', motivo); }}
        />
      )}
      {modalLiberar && (
        <LiberarModal
          busy={!!busy}
          onCancelar={() => setModalLiberar(null)}
          onConfirmar={() => { const id = modalLiberar; setModalLiberar(null); liberar(id); }}
        />
      )}
    </div>
  );
}
