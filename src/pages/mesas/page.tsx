import { useState, useEffect, useMemo } from 'react';
import { useMesas, type Mesa } from '../../contexts/MesasContext';
import { useTablesConfig } from '../../hooks/useTablesConfig';
import { useKDS } from '@/contexts/KDSContext';
import { useToast } from '@/contexts/ToastContext';
import { useMesaKDSNotificacoes } from '@/hooks/useMesaKDSNotificacoes';
import MapaSalao from './components/MapaSalao';
import MesaDetalhes from './components/MesaDetalhes';
import NovaMesaModal from './components/NovaMesaModal';
import JuntarMesasModal from './components/JuntarMesasModal';
import HistoricoMesas from './components/HistoricoMesas';
import ReservasTab from './components/ReservasTab';
import NotificacoesMesaPanel from './components/NotificacoesMesaPanel';

type AbaAtiva = 'mesas' | 'historico' | 'reservas';
type FiltroStatus = 'todas' | 'livre' | 'ocupada' | 'reservada';

function useTick(ms = 1000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return tick;
}

function formatTempo(abertaEm: string | undefined): string {
  if (!abertaEm) return '';
  const agora = Date.now();
  let inicio: number;
  if (abertaEm.includes('T') || abertaEm.includes('-')) {
    inicio = new Date(abertaEm).getTime();
  } else {
    const [h, min] = abertaEm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, min, 0, 0);
    inicio = d.getTime();
  }
  const diff = Math.max(0, Math.floor((agora - inicio) / 60000));
  if (diff < 60) return `${diff}min`;
  const horas = Math.floor(diff / 60);
  const mins = diff % 60;
  return `${horas}h${mins > 0 ? `${mins}m` : ''}`;
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function MesasPage() {
  const { mesas, loading, atualizarMesa, transferirMesa, fecharMesa } = useMesas();
  const { criarMesa, editarMesa, excluirMesa: excluirMesaDB } = useTablesConfig();
  const { pedidos: todosPedidos } = useKDS();
  const { success: toastSuccess, error: toastError } = useToast();

  const mesaKDSMap = useMemo(() => {
    const map: Record<number, { prontos: number; emPreparo: number; novos: number }> = {};
    todosPedidos.forEach((p) => {
      if (!p.mesaNumero || p.isCancelled) return;
      if (!map[p.mesaNumero]) map[p.mesaNumero] = { prontos: 0, emPreparo: 0, novos: 0 };
      if (p.status === 'pronto') map[p.mesaNumero].prontos += 1;
      else if (p.status === 'preparo') map[p.mesaNumero].emPreparo += 1;
      else if (p.status === 'novo') map[p.mesaNumero].novos += 1;
    });
    return map;
  }, [todosPedidos]);

  // Mapa mesaNumero → mesaId para o hook de notificações
  const mesaNumeroParaId = useMemo(() => {
    const map: Record<number, string> = {};
    mesas.forEach((m) => { map[m.numero] = m.id; });
    return map;
  }, [mesas]);

  const {
    notificacoes,
    marcarLida,
    marcarTodasLidas,
  } = useMesaKDSNotificacoes(todosPedidos, mesaNumeroParaId);

  const [abaAtiva, setAbaAtiva] = useState<AbaAtiva>('mesas');
  const [mesaAtiva, setMesaAtiva] = useState<string | null>(null);
  const [vistaLista, setVistaLista] = useState(false);
  const [novaMesaModal, setNovaMesaModal] = useState<{ open: boolean; mesa: Mesa | null }>({ open: false, mesa: null });
  const [juntarModal, setJuntarModal] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todas');
  const tick = useTick(30000);
  void tick;

  const mesa = mesas.find((m) => m.id === mesaAtiva) ?? null;

  const handleUpdate = (id: string, changes: Partial<Mesa>) => atualizarMesa(id, changes);

  const handleTransferir = (fromId: string, toId: string) => {
    const from = mesas.find((m) => m.id === fromId);
    if (!from) return;
    transferirMesa(fromId, toId, {
      status: 'ocupada',
      clienteNome: from.clienteNome,
      totalConsumo: from.totalConsumo,
      abertaEm: from.abertaEm,
      garcomNome: from.garcomNome,
    });
    setMesaAtiva(toId);
  };

  const handleSalvarMesa = async (data: Mesa) => {
    const editando = data.id && mesas.some((m) => m.id === data.id);

    if (editando) {
      const { success, error } = await editarMesa(data.id, {
        numero: data.numero,
        capacidade: data.capacidade,
        area: data.area,
        formato: 'quadrada',
      });
      if (error) {
        toastError('Erro ao editar mesa', error);
        return;
      }
      if (success) {
        atualizarMesa(data.id, data);
        toastSuccess('Mesa atualizada!');
        setNovaMesaModal({ open: false, mesa: null });
      }
    } else {
      const { mesa: novaMesa, error } = await criarMesa({
        numero: data.numero,
        capacidade: data.capacidade,
        formato: 'quadrada',
        setor: data.area ?? 'Salão',
        x: 50,
        y: 50,
        status: 'livre',
        qrCode: `MESA-${String(data.numero).padStart(3, '0')}-QR-${Date.now()}`,
      });
      if (error) {
        toastError('Erro ao criar mesa', error);
        return;
      }
      if (novaMesa) {
        toastSuccess(`Mesa ${novaMesa.numero} criada com sucesso!`);
        setNovaMesaModal({ open: false, mesa: null });
      }
    }
  };

  const handleExcluirMesa = async (id: string) => {
    if (mesaAtiva === id) setMesaAtiva(null);
    const { success, error } = await excluirMesaDB(id);
    if (error) {
      toastError('Erro ao remover mesa', error);
      return;
    }
    if (success) {
      toastSuccess('Mesa removida');
    }
    setNovaMesaModal({ open: false, mesa: null });
  };

  const handleJuntarMesas = (principalId: string, secundariaId: string) => {
    const principal = mesas.find((m) => m.id === principalId);
    const secundaria = mesas.find((m) => m.id === secundariaId);
    if (!principal || !secundaria) return;
    atualizarMesa(principalId, { totalConsumo: (principal.totalConsumo ?? 0) + (secundaria.totalConsumo ?? 0) });
    atualizarMesa(secundariaId, { status: 'livre', clienteNome: undefined, totalConsumo: undefined, abertaEm: undefined, garcomNome: undefined });
    setJuntarModal(false);
  };

  const abrirEditarMesa = () => { if (mesa) setNovaMesaModal({ open: true, mesa }); };

  const stats = {
    livre: mesas.filter((m) => m.status === 'livre').length,
    ocupada: mesas.filter((m) => m.status === 'ocupada').length,
    reservada: mesas.filter((m) => m.status === 'reservada').length,
    faturamento: mesas.filter((m) => m.status === 'ocupada').reduce((a, m) => a + (m.totalConsumo ?? 0), 0),
  };

  const mesasFiltradas = filtroStatus === 'todas' ? mesas : mesas.filter((m) => m.status === filtroStatus);

  const totalProntos = Object.values(mesaKDSMap).reduce((s, v) => s + v.prontos, 0);
  const totalPreparo = Object.values(mesaKDSMap).reduce((s, v) => s + v.emPreparo, 0);

  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-zinc-500">Carregando mesas...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 flex-shrink-0" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex items-center gap-4">
          {/* Abas principais */}
          <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
            <button
              onClick={() => setAbaAtiva('mesas')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${abaAtiva === 'mesas' ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              <i className="ri-layout-grid-line text-xs" />
              Mesas
            </button>
            <button
              onClick={() => setAbaAtiva('historico')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${abaAtiva === 'historico' ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              <i className="ri-history-line text-xs" />
              Histórico
            </button>
            <button
              onClick={() => setAbaAtiva('reservas')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${abaAtiva === 'reservas' ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              <i className="ri-calendar-check-line text-xs" />
              Reservas
            </button>
          </div>

          {/* Stats — só na aba mesas */}
          {abaAtiva === 'mesas' && (
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                <span className="text-zinc-600">{stats.livre} livres</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-zinc-600">{stats.ocupada} ocupadas</span>
              </div>
              {stats.reservada > 0 && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-zinc-400" />
                  <span className="text-zinc-600">{stats.reservada} reservadas</span>
                </div>
              )}
              <div className="border-l border-zinc-200 pl-4">
                <span className="text-zinc-500 text-xs">Em aberto: </span>
                <span className="font-bold text-amber-600">{formatPrice(stats.faturamento)}</span>
              </div>
              {totalProntos > 0 && (
                <div className="flex items-center gap-1 text-xs font-bold text-green-700 bg-green-100 px-2 py-1 rounded-full">
                  <i className="ri-alarm-warning-line text-xs" />
                  {totalProntos} pronto{totalProntos !== 1 ? 's' : ''}
                </div>
              )}
              {totalPreparo > 0 && (
                <div className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  {totalPreparo} em preparo
                </div>
              )}
              <div className="flex items-center gap-1 text-xs text-zinc-400">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span>ao vivo</span>
              </div>
            </div>
          )}
        </div>

        {/* Ações — só na aba mesas */}
        {abaAtiva === 'mesas' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setVistaLista(false)}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${!vistaLista ? 'bg-amber-100 text-amber-600' : 'text-zinc-400 hover:bg-zinc-100'}`}
            >
              <i className="ri-layout-grid-line text-base" />
            </button>
            <button
              onClick={() => setVistaLista(true)}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${vistaLista ? 'bg-amber-100 text-amber-600' : 'text-zinc-400 hover:bg-zinc-100'}`}
            >
              <i className="ri-list-check text-base" />
            </button>
            {mesa && mesa.status === 'ocupada' && (
              <button
                onClick={() => setJuntarModal(true)}
                className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 border border-amber-300 bg-amber-50 hover:bg-amber-100 px-3 py-2 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
              >
                <i className="ri-merge-cells-horizontal" />
                Juntar
              </button>
            )}
            <button
              onClick={() => setNovaMesaModal({ open: true, mesa: null })}
              className="flex items-center gap-1.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3 py-2 rounded-lg cursor-pointer whitespace-nowrap transition-colors ml-2"
            >
              <i className="ri-add-line" />
              Nova Mesa
            </button>
          </div>
        )}
      </div>

      {/* ── ABA HISTÓRICO ── */}
      {abaAtiva === 'historico' && (
        <div className="flex-1 overflow-hidden">
          <HistoricoMesas />
        </div>
      )}

      {/* ── ABA RESERVAS ── */}
      {abaAtiva === 'reservas' && (
        <div className="flex-1 overflow-hidden">
          <ReservasTab />
        </div>
      )}

      {/* ── ABA MESAS ── */}
      {abaAtiva === 'mesas' && (
        <>
          {/* Filtro rápido por status */}
          <div className="flex items-center gap-1 px-6 py-2 border-b flex-shrink-0">
            {([
              { key: 'todas', label: 'Todas', count: mesas.length },
              { key: 'livre', label: 'Livres', count: stats.livre, dot: 'bg-green-400' },
              { key: 'ocupada', label: 'Ocupadas', count: stats.ocupada, dot: 'bg-amber-500' },
              { key: 'reservada', label: 'Reservadas', count: stats.reservada, dot: 'bg-zinc-400' },
            ] as { key: FiltroStatus; label: string; count: number; dot?: string }[]).map((f) => (
              <button
                key={f.key}
                onClick={() => setFiltroStatus(f.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                  filtroStatus === f.key ? 'bg-amber-100 text-amber-700' : 'text-zinc-500 hover:bg-zinc-100'
                }`}
              >
                {f.dot && <span className={`w-2 h-2 rounded-full ${f.dot}`} />}
                {f.label}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${filtroStatus === f.key ? 'bg-amber-200 text-amber-800' : 'bg-zinc-100 text-zinc-500'}`}>
                  {f.count}
                </span>
              </button>
            ))}
          </div>

          {/* Main content */}
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-hidden">
              {mesas.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                  <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl">
                    <i className="ri-table-2 text-3xl text-zinc-300" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-500 mb-1">Nenhuma mesa cadastrada</p>
                    <p className="text-xs text-zinc-400">Crie mesas em Configurações → Mesas &amp; QR Codes</p>
                  </div>
                </div>
              ) : !vistaLista ? (
                <MapaSalao mesas={mesasFiltradas} mesaSelecionada={mesaAtiva} onSelect={setMesaAtiva} mesaKDSMap={mesaKDSMap} />
              ) : (
                <div className="overflow-y-auto h-full p-6">
                  {mesasFiltradas.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-zinc-400">
                      <i className="ri-table-2 text-3xl mb-2 text-zinc-300" />
                      <p className="text-sm">Nenhuma mesa com status &quot;{filtroStatus}&quot;</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {mesasFiltradas.map((m) => {
                        const isBloqueada = m.status === 'bloqueada';
                        const tempo = m.status === 'ocupada' ? formatTempo(m.abertaEm) : null;
                        const isUrgente = (() => {
                          if (!m.abertaEm || m.status !== 'ocupada') return false;
                          if (m.abertaEm.includes('T') || m.abertaEm.includes('-')) {
                            return Math.floor((Date.now() - new Date(m.abertaEm).getTime()) / 60000) > 90;
                          }
                          const [h, min] = m.abertaEm.split(':').map(Number);
                          const d = new Date(); d.setHours(h, min, 0, 0);
                          return Math.floor((Date.now() - d.getTime()) / 60000) > 90;
                        })();

                        const statusStyle: Record<string, { border: string; bg: string; dot: string }> = {
                          livre:     { border: 'border-green-300',  bg: 'bg-white',   dot: 'bg-green-400' },
                          ocupada:   { border: 'border-amber-400',  bg: 'bg-white',   dot: 'bg-amber-500' },
                          reservada: { border: 'border-zinc-300',   bg: 'bg-zinc-50', dot: 'bg-zinc-400' },
                          bloqueada: { border: 'border-red-200',    bg: 'bg-red-50',  dot: 'bg-red-300' },
                        };
                        const st = statusStyle[m.status] ?? statusStyle.livre;
                        const kds = mesaKDSMap[m.numero];

                        return (
                          <button
                            key={m.id}
                            onClick={() => !isBloqueada && setMesaAtiva(m.id)}
                            className={`flex flex-col p-4 rounded-xl border-2 text-left transition-all hover:scale-[1.01] ${st.border} ${st.bg} ${mesaAtiva === m.id ? 'ring-2 ring-amber-500 ring-offset-1' : ''} ${isBloqueada ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${isUrgente ? 'ring-1 ring-red-400' : ''}`}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${st.dot} ${m.status === 'ocupada' ? 'animate-pulse' : ''}`} />
                                <span className="text-lg font-black text-zinc-800">Mesa {m.numero}</span>
                              </div>
                              <div className="flex items-center gap-1 flex-wrap justify-end">
                                {tempo && (
                                  <span className={`flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${isUrgente ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                                    <i className="ri-timer-line text-[9px]" />{tempo}
                                  </span>
                                )}
                                <span className="text-[10px] text-zinc-400 whitespace-nowrap">{m.capacidade} lug.</span>
                              </div>
                            </div>

                            {m.status === 'ocupada' && (
                              <>
                                {m.clienteNome && (
                                  <div className="flex items-center gap-1 mb-1">
                                    <i className="ri-user-line text-[10px] text-zinc-400" />
                                    <p className="text-xs font-semibold text-zinc-700 truncate">{m.clienteNome}</p>
                                  </div>
                                )}
                                {m.garcomNome && (
                                  <div className="flex items-center gap-1 mb-1">
                                    <i className="ri-service-line text-[10px] text-zinc-400" />
                                    <p className="text-xs text-zinc-500 truncate">{m.garcomNome}</p>
                                  </div>
                                )}
                                {kds && (
                                  <div className="flex items-center gap-1 flex-wrap mb-1">
                                    {kds.prontos > 0 && (
                                      <span className="text-[9px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                        <i className="ri-check-line text-[9px]" />{kds.prontos} pronto{kds.prontos !== 1 ? 's' : ''}
                                      </span>
                                    )}
                                    {kds.emPreparo > 0 && (
                                      <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                        <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />{kds.emPreparo} preparo
                                      </span>
                                    )}
                                    {kds.novos > 0 && (
                                      <span className="text-[9px] font-bold bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">
                                        {kds.novos} na fila
                                      </span>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center justify-between mt-auto pt-2 border-t border-zinc-100">
                                  <div>
                                    {m.numeroPedidos != null && (
                                      <p className="text-[10px] text-zinc-400">{m.numeroPedidos} pedido{m.numeroPedidos !== 1 ? 's' : ''}</p>
                                    )}
                                  </div>
                                  {m.totalConsumo != null && m.totalConsumo > 0 && (
                                    <p className="text-sm font-black text-amber-700">{formatPrice(m.totalConsumo)}</p>
                                  )}
                                </div>
                              </>
                            )}

                            {m.status === 'livre' && (
                              <div className="flex items-center gap-1 mt-1">
                                <i className="ri-checkbox-circle-line text-green-500 text-xs" />
                                <p className="text-xs text-green-600 font-semibold">Disponível</p>
                              </div>
                            )}
                            {m.status === 'reservada' && (
                              <div className="flex items-center gap-1 mt-1">
                                <i className="ri-bookmark-line text-zinc-400 text-xs" />
                                <p className="text-xs text-zinc-500 font-semibold">Reservada</p>
                              </div>
                            )}
                            {m.status === 'bloqueada' && (
                              <div className="flex items-center gap-1 mt-1">
                                <i className="ri-lock-line text-red-400 text-xs" />
                                <p className="text-xs text-red-500 font-semibold">Bloqueada</p>
                              </div>
                            )}
                            <p className="text-[10px] text-zinc-300 mt-1">{m.area}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Painel de detalhes */}
            {mesa && (
              <div className="w-80 flex-shrink-0 border-l border-zinc-200 overflow-hidden">
                <MesaDetalhes
                  mesa={mesa}
                  todasMesas={mesas}
                  onClose={() => setMesaAtiva(null)}
                  onUpdate={handleUpdate}
                  onTransferir={handleTransferir}
                  onFecharMesa={async () => {
                    const resultado = await fecharMesa(mesa.id);
                    if (resultado.ok) {
                      setMesaAtiva(null);
                      toastSuccess('Mesa fechada com sucesso');
                    } else {
                      toastError('Não é possível fechar a mesa', resultado.motivo);
                    }
                  }}
                  onEditarMesa={abrirEditarMesa}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* Modais */}
      {novaMesaModal.open && (
        <NovaMesaModal
          mesa={novaMesaModal.mesa}
          onClose={() => setNovaMesaModal({ open: false, mesa: null })}
          onSalvar={handleSalvarMesa}
          onExcluir={handleExcluirMesa}
        />
      )}
      {juntarModal && mesa && (
        <JuntarMesasModal
          mesaPrincipal={mesa}
          todasMesas={mesas}
          onClose={() => setJuntarModal(false)}
          onJuntar={handleJuntarMesas}
        />
      )}

      {/* Painel de notificações ao vivo do KDS */}
      <NotificacoesMesaPanel
        notificacoes={notificacoes}
        onMarcarLida={marcarLida}
        onMarcarTodasLidas={marcarTodasLidas}
        onSelecionarMesa={(mesaId) => {
          setMesaAtiva(mesaId);
          setAbaAtiva('mesas');
        }}
      />
    </div>
  );
}
