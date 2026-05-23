import { useState, useEffect } from 'react';
import type { Mesa } from '@/types/pdv';
import { useKDS } from '../../../../contexts/KDSContext';
import { useMesas } from '../../../../contexts/MesasContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import FecharMesaCaixaModal from './FecharMesaCaixaModal';

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function hhmmToTs(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function elapsedMin(hhmm?: string): number {
  if (!hhmm) return 0;
  return Math.floor((Date.now() - hhmmToTs(hhmm)) / 60000);
}

function formatElapsed(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}m` : `${min}min`;
}

function timerColor(min: number) {
  if (min < 45) return 'text-green-600 bg-green-50 border-green-200';
  if (min < 90) return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-red-600 bg-red-50 border-red-200';
}

function kdsMesaStatus(mesaNumero: number, pedidos: ReturnType<typeof import('../../../../mocks/kds')['mockKDSPedidos']['filter']>) {
  const mPedidos = pedidos.filter(
    (p) => p.destino === 'mesa' && p.mesaNumero === mesaNumero
  );
  if (!mPedidos.length) return null;
  let novos = 0, emPreparo = 0, prontos = 0, entregues = 0;
  for (const p of mPedidos) {
    for (const item of p.itens) {
      if (item.status === 'novo') novos++;
      else if (item.status === 'preparo') emPreparo++;
      else if (item.status === 'pronto') prontos++;
      else entregues++;
    }
  }
  return { novos, emPreparo, aguardando: novos + emPreparo, prontos, entregues };
}

interface Props {
  onAddItemsMesa?: (mesa: Mesa) => void;
}

export default function MesasPainelCaixa({ onAddItemsMesa }: Props) {
  const { pedidos: kdsPedidos } = useKDS();
  const { mesas: todasMesas } = useMesas();
  const { settings } = useSystemSettings();
  const taxaAtiva = settings.service_fee_enabled;
  const taxaPct = settings.service_fee_percentage ?? 10;

  const calcTotal = (subtotal: number) => {
    const taxa = taxaAtiva ? subtotal * taxaPct / 100 : 0;
    return subtotal + taxa;
  };
  const [tick, setTick]                   = useState(0);
  const [mesaSelecionada, setMesaSelecionada] = useState<string | null>(null);
  const [mesaFechando, setMesaFechando]   = useState<Mesa | null>(null);
  const [mesasFechadas, setMesasFechadas] = useState<Set<string>>(new Set());
  const [mesasPagas, setMesasPagas]       = useState<Map<string, { resumo: string }>>(new Map());
  const [itensEntreguesLocal, setItensEntreguesLocal] = useState<Set<string>>(new Set());

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const mesasVisiveis = todasMesas.filter((m) => !mesasFechadas.has(m.id));
  const ocupadas = mesasVisiveis.filter((m) => m.status === 'ocupada');
  const livres   = mesasVisiveis.filter((m) => m.status === 'livre');

  const handleFechada = (mesaId: string) => {
    setMesasFechadas((prev) => new Set(prev).add(mesaId));
    setMesasPagas((prev) => { const m = new Map(prev); m.delete(mesaId); return m; });
    setMesaFechando(null);
    setMesaSelecionada(null);
  };

  const handlePagamentoConfirmado = (mesaId: string, resumo: string) => {
    setMesasPagas((prev) => new Map(prev).set(mesaId, { resumo }));
    setMesaFechando(null);
  };

  const handleEntregarItem = (itemId: string) => {
    setItensEntreguesLocal((prev) => new Set(prev).add(itemId));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Resumo */}
      <div className="flex gap-3 px-3 py-2.5 bg-zinc-50 border-b border-zinc-100 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
          <span className="text-xs text-zinc-600"><span className="font-bold">{livres.length}</span> livres</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span className="text-xs text-zinc-600"><span className="font-bold">{ocupadas.length}</span> ocupadas</span>
        </div>
        {ocupadas.some((m) => {
          const kds = kdsMesaStatus(m.numero, kdsPedidos);
          return kds && kds.prontos > 0;
        }) && (
          <div className="ml-auto flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
            <i className="ri-restaurant-2-line text-xs animate-bounce" />
            Itens prontos!
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-zinc-100" key={tick}>
        {mesasVisiveis.map((mesa) => {
          const isOcupada = mesa.status === 'ocupada';
          const min = isOcupada ? elapsedMin(mesa.abertaEm) : 0;
          const kds = isOcupada ? kdsMesaStatus(mesa.numero, kdsPedidos) : null;
          const isSelected = mesaSelecionada === mesa.id;
          const temProntos = kds && kds.prontos > 0;
          const isPago = mesasPagas.has(mesa.id);
          const pagaInfo = mesasPagas.get(mesa.id);
          const pedidosMesa: never[] = [];

          return (
            <div key={mesa.id}>
              <button
                onClick={() => setMesaSelecionada(isSelected ? null : mesa.id)}
                disabled={!isOcupada}
                className={`w-full flex items-center gap-3 px-3 py-3 transition-colors text-left cursor-pointer ${
                  isOcupada
                    ? isSelected
                      ? 'bg-amber-50'
                      : 'hover:bg-zinc-50'
                    : 'opacity-40 cursor-not-allowed'
                }`}
              >
                {/* Número da mesa */}
                <div className={`w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-base border-2 ${
                  isOcupada
                    ? temProntos
                      ? 'border-green-400 bg-green-50 text-green-700'
                      : 'border-amber-300 bg-amber-50 text-amber-800'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-400'
                }`}>
                  {mesa.numero}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-bold ${isOcupada ? 'text-zinc-900' : 'text-zinc-400'}`}>
                      {isOcupada ? (mesa.clienteNome || 'Sem nome') : 'Livre'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isPago && (
                        <span className="flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-green-500 text-white flex-shrink-0">
                          <i className="ri-check-line text-[9px]" />
                          PAGA
                        </span>
                      )}
                      {isOcupada && min > 0 && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${timerColor(min)}`}>
                          ⏱ {formatElapsed(min)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-zinc-400">{mesa.capacidade} lug.</span>
                    {mesa.garcomNome && (
                      <span className="text-[10px] text-zinc-400">
                        <i className="ri-walk-line mr-0.5" />{mesa.garcomNome.split(' ')[0]}
                      </span>
                    )}
                    {isOcupada && kds && (
                      <div className="flex items-center gap-1.5">
                        {kds.novos > 0 && (
                          <span className="flex items-center gap-0.5 text-[9px] font-bold text-zinc-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse inline-block" />
                            {kds.novos} na fila
                          </span>
                        )}
                        {kds.emPreparo > 0 && (
                          <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
                            {kds.emPreparo} prep.
                          </span>
                        )}
                        {kds.prontos > 0 && (
                          <span className="flex items-center gap-0.5 text-[9px] font-bold text-green-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                            {kds.prontos} pronto{kds.prontos > 1 ? 's' : ''}!
                          </span>
                        )}
                        {kds.aguardando === 0 && kds.prontos === 0 && kds.entregues > 0 && (
                          <span className="text-[9px] text-zinc-400 flex items-center gap-0.5">
                            <i className="ri-check-double-line text-green-500" /> tudo entregue
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Consumo */}
                {isOcupada && mesa.totalConsumo != null && (
                  <div className="flex-shrink-0 text-right">
                    <span className="text-xs font-bold text-zinc-800">{formatPrice(mesa.totalConsumo)}</span>
                    {mesa.numeroPessoas && (
                      <p className="text-[9px] text-zinc-400">{mesa.numeroPessoas} pess.</p>
                    )}
                  </div>
                )}

                {isOcupada && (
                  <i className={`${isSelected ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-zinc-400 text-sm flex-shrink-0`} />
                )}
              </button>

              {/* Detalhe expandido */}
              {isSelected && isOcupada && (
                <div className="px-3 pb-3 bg-amber-50/60 border-t border-amber-100">

                  {/* Botão adicionar pedido */}
                  {onAddItemsMesa && (
                    <div className="pt-2.5 pb-1">
                      <button
                        onClick={() => onAddItemsMesa(mesa)}
                        className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs py-2 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <i className="ri-add-circle-line text-sm" />
                        Adicionar itens a esta mesa
                      </button>
                    </div>
                  )}

                  {/* Botões: Pago ou Pagamento+Fechamento */}
                  <div className="pt-1.5 pb-2 flex flex-col gap-2">
                    {isPago ? (
                      <>
                        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                          <div className="w-5 h-5 flex items-center justify-center bg-green-500 rounded-full flex-shrink-0">
                            <i className="ri-check-line text-white text-[10px]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-green-700">Pagamento Confirmado</p>
                            {pagaInfo?.resumo && (
                              <p className="text-[10px] text-green-600 truncate">{pagaInfo.resumo} · {formatPrice(calcTotal(mesa.totalConsumo ?? 0))}</p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => setMesaFechando(mesa)}
                          className="w-full flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-sm py-2.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-door-lock-line text-base text-amber-400" />
                          Confirmar Fechamento da Mesa
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 text-[9px] text-zinc-400 font-semibold px-1">
                          <span className="w-4 h-4 rounded-full bg-amber-500 text-white flex items-center justify-center font-black text-[8px] flex-shrink-0">1</span>
                          <span className="whitespace-nowrap">Confirmar pagamento</span>
                          <div className="flex-1 h-px bg-zinc-200 self-center min-w-2" />
                          <span className="w-4 h-4 rounded-full bg-zinc-300 text-zinc-500 flex items-center justify-center font-black text-[8px] flex-shrink-0">2</span>
                          <span className="whitespace-nowrap">Fechar mesa</span>
                        </div>
                        <button
                          onClick={() => setMesaFechando(mesa)}
                          className="w-full flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-sm py-2.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-money-dollar-circle-line text-base text-amber-400" />
                          Pagamento e Fechamento
                          {mesa.totalConsumo != null && (
                            <span className="text-amber-300 font-black">
                              · {formatPrice(calcTotal(mesa.totalConsumo))}
                            </span>
                          )}
                        </button>
                      </>
                    )}
                  </div>

                  {/* Pedidos na cozinha */}
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                    Pedidos na cozinha
                  </p>
                  {kdsPedidos
                    .filter((p) => p.destino === 'mesa' && p.mesaNumero === mesa.numero && p.status !== 'entregue')
                    .map((p) => (
                      <div key={p.id} className="mb-2 last:mb-0 bg-white rounded-lg border border-zinc-200 px-3 py-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-zinc-800">Pedido #{p.numero}</span>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                            p.status === 'pronto'   ? 'bg-green-100 text-green-700'
                            : p.status === 'preparo' ? 'bg-amber-100 text-amber-700'
                            : 'bg-zinc-100 text-zinc-500'
                          }`}>
                            {p.status === 'pronto' ? 'Pronto!' : p.status === 'preparo' ? 'Em preparo' : 'Na fila'}
                          </span>
                        </div>
                        {p.itens.map((item) => {
                          const entregue = itensEntreguesLocal.has(item.id) || item.status === 'entregue';
                          return (
                            <div key={item.id} className="flex items-center justify-between text-[10px] text-zinc-600 py-0.5 gap-2">
                              <span className="flex-1 truncate">{item.quantidade > 1 ? `${item.quantidade}x ` : ''}{item.nome}</span>
                              {entregue ? (
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <span className="font-semibold text-zinc-400 flex items-center gap-0.5">
                                    <i className="ri-check-double-line text-green-500" /> Entregue
                                  </span>
                                  {item.quemEntregou && (
                                    <span className="flex items-center gap-0.5 text-[9px] font-bold text-zinc-500 bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                      <i className="ri-user-follow-line text-[9px]" />
                                      {item.quemEntregou}
                                    </span>
                                  )}
                                  {item.entregueEm && (
                                    <span className="text-[9px] text-zinc-400 whitespace-nowrap">
                                      {new Date(item.entregueEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <span className={`font-semibold ${item.status === 'pronto' ? 'text-green-600' : item.status === 'preparo' ? 'text-amber-600' : 'text-zinc-400'}`}>
                                    {item.status === 'pronto' ? 'Pronto' : item.status === 'preparo' ? 'Preparo' : 'Fila'}
                                  </span>
                                  {item.status === 'pronto' && (
                                    <button
                                      onClick={() => handleEntregarItem(item.id)}
                                      className="text-[9px] font-bold bg-green-500 hover:bg-green-600 text-white px-1.5 py-0.5 rounded cursor-pointer whitespace-nowrap transition-colors"
                                    >
                                      Entregar
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  {kdsPedidos.filter(
                    (p) => p.destino === 'mesa' && p.mesaNumero === mesa.numero && p.status !== 'entregue'
                  ).length === 0 && (
                    <p className="text-xs text-zinc-400 py-1">Nenhum pedido ativo na cozinha.</p>
                  )}

                  {/* Pedidos do caixa */}
                  {pedidosMesa.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-amber-100">
                      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
                        Pedidos registrados
                      </p>
                      {pedidosMesa.map((p) => {
                        let statusLabel = '';
                        let statusColor = 'text-zinc-400';
                        if (p.status === 'cancelado') { statusLabel = 'Cancelado'; statusColor = 'text-red-400'; }
                        else if (p.status === 'entregue') { statusLabel = 'Entregue'; statusColor = 'text-zinc-400'; }
                        else if (p.itensProntos >= p.itensTotal) { statusLabel = 'Pronto'; statusColor = 'text-green-600'; }
                        else if (p.itensProntos > 0) { statusLabel = `${p.itensProntos}/${p.itensTotal} prontos`; statusColor = 'text-amber-600'; }
                        else { statusLabel = 'Aguardando'; statusColor = 'text-zinc-500'; }
                        return (
                          <div key={p.id} className="flex items-center justify-between text-[10px] text-zinc-600 py-1 border-b border-amber-50 last:border-0">
                            <span className="font-semibold text-zinc-700">#{p.numero}</span>
                            <span>{p.itensTotal} item{p.itensTotal > 1 ? 'ns' : ''}</span>
                            <span className={`font-bold ${statusColor}`}>{statusLabel}</span>
                            <span className="font-bold text-zinc-800">{formatPrice(p.total)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {mesasVisiveis.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-zinc-300">
            <div className="w-10 h-10 flex items-center justify-center mb-2">
              <i className="ri-layout-grid-line text-3xl" />
            </div>
            <p className="text-sm">Nenhuma mesa aberta</p>
          </div>
        )}
      </div>

      {/* Modal de fechar mesa */}
      {mesaFechando && (
        <FecharMesaCaixaModal
          mesa={mesaFechando}
          pedidos={[]}
          onFechada={handleFechada}
          onClose={() => setMesaFechando(null)}
          initialStep={mesasPagas.has(mesaFechando.id) ? 'fechamento' : undefined}
          pagamentoPreConfirmado={mesasPagas.get(mesaFechando.id)?.resumo}
          onPagamentoConfirmado={(resumo) => handlePagamentoConfirmado(mesaFechando.id, resumo)}
        />
      )}
    </div>
  );
}
