import { useMemo, useState } from 'react';
import type { KDSPedido } from '@/types/kds';

interface Props {
  pedidos: KDSPedido[];
  busca: string;
  onOpenDetail: (pedidoId: string) => void;
}

interface GrupoMesa {
  tableSessionId: string;
  mesaNumero: number;
  participantes: {
    participantToken: string | null;
    participantName: string | null;
    pedidos: KDSPedido[];
  }[];
  totalPedidos: number;
  totalAmount: number;
  todosEntregues: boolean;
  algumNaoPago: boolean;
}

function statusColor(pedido: KDSPedido) {
  if (pedido.isCancelled) return 'bg-red-100 text-red-600 border-red-200';
  if (pedido.status === 'entregue') return 'bg-zinc-100 text-zinc-500 border-zinc-200';
  if (pedido.status === 'pronto') return 'bg-green-100 text-green-700 border-green-200';
  if (pedido.status === 'preparo') return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  return 'bg-amber-100 text-amber-700 border-amber-200';
}

function statusLabel(pedido: KDSPedido) {
  if (pedido.isCancelled) return 'Cancelado';
  if (pedido.status === 'entregue') return 'Entregue';
  if (pedido.status === 'pronto') return 'Pronto';
  if (pedido.status === 'preparo') return 'Em Preparo';
  return 'Aguardando';
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function GestorMesasView({ pedidos, busca, onOpenDetail }: Props) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const grupos = useMemo<GrupoMesa[]>(() => {
    // Filtra apenas pedidos de mesa com table_session_id
    const pedidosMesa = pedidos.filter(
      (p) => p.destino === 'mesa' && p.table_session_id && p.mesaNumero != null,
    );

    // Aplica busca
    const q = busca.trim().toLowerCase().replace(/^#/, '');
    const filtrados = q
      ? pedidosMesa.filter((p) => {
          if (String(p.mesaNumero).includes(q)) return true;
          if (p.participantToken?.toLowerCase().includes(q)) return true;
          if (p.participantName?.toLowerCase().includes(q)) return true;
          if (String(p.numero).includes(q)) return true;
          if (p.nomeCliente?.toLowerCase().includes(q)) return true;
          return false;
        })
      : pedidosMesa;

    // Agrupa por table_session_id
    const sessionMap = new Map<string, KDSPedido[]>();
    filtrados.forEach((p) => {
      const key = p.table_session_id!;
      if (!sessionMap.has(key)) sessionMap.set(key, []);
      sessionMap.get(key)!.push(p);
    });

    return Array.from(sessionMap.entries())
      .map(([sessionId, sessionPedidos]) => {
        // Agrupa por participante (participantToken)
        const partMap = new Map<string, { token: string | null; name: string | null; peds: KDSPedido[] }>();
        sessionPedidos.forEach((p) => {
          const key = p.participantToken ?? '__sem_participante__';
          if (!partMap.has(key)) {
            partMap.set(key, { token: p.participantToken ?? null, name: p.participantName ?? null, peds: [] });
          }
          partMap.get(key)!.peds.push(p);
        });

        const participantes = Array.from(partMap.values())
          .sort((a, b) => {
            // Sem senha por último
            if (!a.token && b.token) return 1;
            if (a.token && !b.token) return -1;
            return (a.token ?? '').localeCompare(b.token ?? '');
          })
          .map((p) => ({
            participantToken: p.token,
            participantName: p.name,
            pedidos: p.peds.sort((a, b) => a.criadoEm - b.criadoEm),
          }));

        const mesaNumero = sessionPedidos[0].mesaNumero!;
        const totalAmount = sessionPedidos.reduce((s, p) => s + p.totalAmount, 0);
        const todosEntregues = sessionPedidos.every((p) => p.status === 'entregue' || p.isCancelled);
        const algumNaoPago = sessionPedidos.some((p) => !p.isPaid && !p.isCancelled);

        return {
          tableSessionId: sessionId,
          mesaNumero,
          participantes,
          totalPedidos: sessionPedidos.length,
          totalAmount,
          todosEntregues,
          algumNaoPago,
        };
      })
      .sort((a, b) => a.mesaNumero - b.mesaNumero);
  }, [pedidos, busca]);

  const toggleGroup = (sessionId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  if (grupos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-300">
        <div className="w-12 h-12 flex items-center justify-center mb-3">
          <i className="ri-table-2 text-4xl" />
        </div>
        <p className="text-sm font-semibold text-zinc-400">
          {busca.trim() ? 'Nenhuma mesa encontrada para esta busca' : 'Nenhuma mesa com pedidos ativos'}
        </p>
        {busca.trim() && (
          <p className="text-xs text-zinc-300 mt-1">
            Busque por número da mesa, senha ou nome do participante
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-1">
      {grupos.map((grupo) => {
        const expanded = expandedGroups.has(grupo.tableSessionId);
        return (
          <div
            key={grupo.tableSessionId}
            className={`bg-white rounded-xl border overflow-hidden transition-all ${
              grupo.todosEntregues
                ? 'border-zinc-200 opacity-70'
                : grupo.algumNaoPago
                  ? 'border-amber-300'
                  : 'border-zinc-200'
            }`}
          >
            {/* Header da mesa */}
            <button
              onClick={() => toggleGroup(grupo.tableSessionId)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 flex items-center justify-center rounded-xl font-black text-lg ${
                  grupo.todosEntregues
                    ? 'bg-zinc-100 text-zinc-400'
                    : 'bg-amber-500 text-white'
                }`}>
                  {grupo.mesaNumero}
                </div>
                <div>
                  <p className="text-sm font-black text-zinc-900">Mesa {grupo.mesaNumero}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-zinc-400 font-medium">
                      {grupo.totalPedidos} pedido{grupo.totalPedidos !== 1 ? 's' : ''}
                    </span>
                    <span className="text-[10px] text-zinc-300">·</span>
                    <span className="text-[10px] font-bold text-zinc-600">
                      {formatPrice(grupo.totalAmount)}
                    </span>
                    {grupo.algumNaoPago && (
                      <span className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
                        <i className="ri-time-line text-[9px]" />Não pago
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {grupo.participantes.filter((p) => p.participantToken).length > 0 && (
                  <div className="flex items-center gap-1">
                    <i className="ri-group-line text-[10px] text-zinc-400" />
                    <span className="text-[10px] font-bold text-zinc-500">
                      {grupo.participantes.filter((p) => p.participantToken).length} senha{grupo.participantes.filter((p) => p.participantToken).length !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
                <i className={`text-zinc-400 text-sm transition-transform ${expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
              </div>
            </button>

            {/* Participantes e pedidos */}
            {expanded && (
              <div className="border-t border-zinc-100 divide-y divide-zinc-50">
                {grupo.participantes.map((part, pIdx) => (
                  <div key={pIdx} className="px-4 py-3">
                    {/* Header do participante */}
                    {part.participantToken ? (
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-violet-50 border border-violet-200 rounded-full">
                          <i className="ri-key-2-line text-violet-500 text-[10px]" />
                          <span className="text-[10px] font-black text-violet-700">
                            Senha {part.participantToken}
                          </span>
                        </div>
                        {part.participantName && (
                          <span className="text-[10px] font-semibold text-zinc-500 truncate">
                            {part.participantName}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 mb-2">
                        <i className="ri-user-line text-[10px] text-zinc-400" />
                        <span className="text-[10px] font-semibold text-zinc-400 italic">
                          Sem identificação
                        </span>
                      </div>
                    )}

                    {/* Lista de pedidos do participante */}
                    <div className="space-y-1.5">
                      {part.pedidos.map((pedido) => (
                        <button
                          key={pedido.id}
                          onClick={() => onOpenDetail(pedido.id)}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-zinc-50 hover:bg-zinc-100 rounded-lg border border-zinc-200 cursor-pointer transition-colors text-left"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-black text-zinc-800 whitespace-nowrap">
                              #{String(pedido.numero).padStart(4, '0')}
                            </span>
                            <span className="text-[10px] text-zinc-400 truncate">
                              {pedido.itens.length} item{pedido.itens.length !== 1 ? 'ns' : ''}
                            </span>
                            {pedido.isPaid && (
                              <span className="flex items-center gap-0.5 text-[9px] font-bold text-emerald-600">
                                <i className="ri-shield-check-fill text-[9px]" />Pago
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-[10px] font-bold text-zinc-600">
                              {formatPrice(pedido.totalAmount)}
                            </span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${statusColor(pedido)}`}>
                              {statusLabel(pedido)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Summary quando colapsado */}
            {!expanded && grupo.participantes.length > 0 && (
              <div className="px-4 pb-3">
                <div className="flex flex-wrap gap-1">
                  {grupo.participantes
                    .filter((p) => p.participantToken)
                    .map((part, idx) => {
                      const naoPagos = part.pedidos.filter((p) => !p.isPaid && !p.isCancelled).length;
                      const totalPart = part.pedidos.reduce((s, p) => s + p.totalAmount, 0);
                      return (
                        <div
                          key={idx}
                          className="flex items-center gap-1.5 px-2 py-1 bg-violet-50 border border-violet-200 rounded-lg"
                        >
                          <i className="ri-key-2-line text-violet-500 text-[10px]" />
                          <span className="text-[10px] font-black text-violet-700">
                            {part.participantToken}
                          </span>
                          <span className="text-[10px] text-violet-500">
                            {formatPrice(totalPart)}
                          </span>
                          {naoPagos > 0 && (
                            <span className="w-3.5 h-3.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[8px] font-black">
                              {naoPagos}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  {grupo.participantes.filter((p) => !p.participantToken).length > 0 && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-zinc-100 border border-zinc-200 rounded-lg">
                      <span className="text-[10px] text-zinc-400 italic">
                        {grupo.participantes.filter((p) => !p.participantToken).reduce((s, p) => s + p.pedidos.length, 0)} sem senha
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}