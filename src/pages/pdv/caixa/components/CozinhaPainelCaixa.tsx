import { useMemo } from 'react';
import { useKDS } from '../../../../contexts/KDSContext';
import {
  useKDSTick,
  getElapsedSeconds,
  formatElapsed,
  getSLALevel,
  SLA_COLORS,
  SLA_BG,
} from '../../../../hooks/useKDSTick';
import type { KDSPedido, KDSItem } from '@/types/kds';

const UNIT_STATUS_DOT: Record<string, string> = {
  novo: 'bg-zinc-400',
  preparo: 'bg-amber-500 animate-pulse',
  pronto: 'bg-green-500',
  entregue: 'bg-zinc-300',
};

const UNIT_STATUS_LABEL: Record<string, string> = {
  novo: 'Fila',
  preparo: 'Preparo',
  pronto: 'Pronto',
  entregue: 'Entregue',
};

/** Verifica se um pedido tem pelo menos 1 unidade/item entregue */
function temAlgumaUnidadeEntregue(pedido: KDSPedido): boolean {
  return pedido.itens.some((item) => {
    if (item.unidades && item.unidades.length > 0) {
      return item.unidades.some((u) => u.status === 'entregue');
    }
    return item.status === 'entregue';
  });
}

/** Verifica se TODOS os itens/unidades do pedido estão entregues */
function todosEntregues(pedido: KDSPedido): boolean {
  if (pedido.itens.length === 0) return false;
  return pedido.itens.every((item) => {
    if (item.unidades && item.unidades.length > 0) {
      return item.unidades.every((u) => u.status === 'entregue');
    }
    return item.status === 'entregue';
  });
}

function CozinhaItemRow({ item }: { item: KDSItem }) {
  useKDSTick();
  const isEntregue = item.status === 'entregue';
  const hasUnidades = item.unidades && item.unidades.length > 0;

  // Verifica se todas as unidades estão entregues (para itens com unidades)
  const todasUnidadesEntregues = hasUnidades
    ? item.unidades!.every((u) => u.status === 'entregue')
    : isEntregue;

  return (
    <div className={`py-1.5 border-b border-zinc-50 last:border-0 ${todasUnidadesEntregues ? 'opacity-40' : ''}`}>
      {/* Item header */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${UNIT_STATUS_DOT[item.status] ?? 'bg-zinc-400'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            {item.quantidade > 1 && !hasUnidades && (
              <span className="text-[9px] font-black text-amber-600">{item.quantidade}x</span>
            )}
            <span className={`text-[10px] font-semibold truncate ${todasUnidadesEntregues ? 'text-zinc-400 line-through' : 'text-zinc-700'}`}>
              {item.nome}
            </span>
          </div>
        </div>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-zinc-50 text-zinc-500 border-zinc-200 flex-shrink-0">
          {item.estacao}
        </span>
      </div>

      {/* Individual units with status */}
      {hasUnidades && item.unidades && (
        <div className="ml-4 mt-1 space-y-0.5">
          {item.unidades.map((u) => {
            const uEntregue = u.status === 'entregue';
            const uRef = u.iniciouPreparoEm ?? item.entroKdsEm;
            const uElapsed = getElapsedSeconds(uRef);
            const uSla = getSLALevel(uElapsed, item.slaMinutos);
            return (
              <div key={u.id} className={`flex items-center gap-2 flex-wrap ${uEntregue ? 'opacity-50' : ''}`}>
                <div className={`w-1 h-1 rounded-full flex-shrink-0 ${UNIT_STATUS_DOT[u.status] ?? 'bg-zinc-400'}`} />
                <span className="text-[9px] font-bold text-zinc-500 w-14 flex-shrink-0">
                  Unid. {u.numero}
                </span>
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${
                  u.status === 'novo' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                  u.status === 'preparo' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                  u.status === 'pronto' ? 'bg-green-50 text-green-700 border-green-200' :
                  'bg-zinc-50 text-zinc-400 border-zinc-200'
                }`}>
                  {UNIT_STATUS_LABEL[u.status] ?? u.status}
                </span>
                {u.operadorPreparo && (
                  <span className="text-[9px] text-teal-600 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
                    <i className="ri-user-line text-[8px] mr-0.5" />{u.operadorPreparo}
                  </span>
                )}
                {!uEntregue && (
                  <span className={`text-[9px] font-bold tabular-nums flex-shrink-0 ${SLA_COLORS[uSla]}`}>
                    {formatElapsed(uElapsed)}
                  </span>
                )}
                {uEntregue && u.quemEntregou && (
                  <span className="text-[9px] text-zinc-400 flex-shrink-0">
                    <i className="ri-user-follow-line text-[8px] mr-0.5" />{u.quemEntregou}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Simple item timer (no units) */}
      {!hasUnidades && !isEntregue && (
        <div className="ml-4 mt-0.5">
          <span className={`text-[9px] font-bold tabular-nums ${SLA_COLORS[getSLALevel(getElapsedSeconds(item.iniciouPreparoEm ?? item.entroKdsEm), item.slaMinutos)]}`}>
            {formatElapsed(getElapsedSeconds(item.iniciouPreparoEm ?? item.entroKdsEm))}
          </span>
        </div>
      )}
    </div>
  );
}

function CozinhaPedidoCard({ pedido }: { pedido: KDSPedido }) {
  useKDSTick();
  const elapsed = getElapsedSeconds(pedido.criadoEm);
  const maxSla = Math.max(...pedido.itens.map((i) => i.slaMinutos));
  const slaLevel = getSLALevel(elapsed, maxSla);
  const slaWidth = Math.min(100, (elapsed / (maxSla * 60)) * 100);

  const isPronto = pedido.status === 'pronto';
  // Considera entregue se o status do pedido é entregue OU se todos os itens/unidades estão entregues
  const isEntregue = pedido.status === 'entregue' || todosEntregues(pedido);
  // Parcialmente entregue: tem pelo menos 1 unidade entregue mas não todas
  const isParcialmenteEntregue = !isEntregue && temAlgumaUnidadeEntregue(pedido);

  const destinoLabel = () => {
    if (pedido.destino === 'mesa') return `Mesa ${pedido.mesaNumero}`;
    if (pedido.destino === 'nome') return pedido.nomeCliente ?? '—';
    if (pedido.destino === 'senha') return `Senha ${pedido.senha}`;
    if (pedido.destino === 'delivery') return `Delivery · ${pedido.nomeCliente ?? '—'}`;
    return 'Balcão';
  };

  const statusLabel = isEntregue ? 'Entregue' : isParcialmenteEntregue ? 'Parcial' : isPronto ? 'Pronto!' : pedido.status === 'preparo' ? 'Preparo' : 'Na fila';
  const statusBg = isEntregue ? 'bg-zinc-50' : isParcialmenteEntregue ? 'bg-sky-100' : isPronto ? 'bg-green-100' : pedido.status === 'preparo' ? 'bg-amber-100' : 'bg-zinc-100';
  const statusText = isEntregue ? 'text-zinc-400' : isParcialmenteEntregue ? 'text-sky-700' : isPronto ? 'text-green-700' : pedido.status === 'preparo' ? 'text-amber-700' : 'text-zinc-600';

  return (
    <div className={`rounded-xl border-2 overflow-hidden mb-2.5 transition-all ${
      isPronto ? 'border-green-400' :
      isEntregue ? 'border-zinc-200 opacity-50' :
      isParcialmenteEntregue ? 'border-sky-300' :
      'border-zinc-200'
    }`}>
      <div className={`flex items-center gap-2 px-3 py-2 border-b border-zinc-100 flex-wrap ${
        isPronto ? 'bg-green-500' :
        isEntregue ? 'bg-zinc-100' :
        isParcialmenteEntregue ? 'bg-sky-50' :
        'bg-zinc-50'
      }`}>
        <span className={`font-black text-sm ${isPronto ? 'text-white' : 'text-zinc-800'}`}>#{pedido.numero}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isPronto ? 'bg-white/20 text-white' : `${statusBg} ${statusText}`}`}>
          {statusLabel}
        </span>
        <span className={`text-[10px] font-semibold ${isPronto ? 'text-white/80' : 'text-zinc-500'}`}>
          {destinoLabel()}
        </span>
        {isParcialmenteEntregue && (
          <span className="text-[9px] font-bold text-sky-600 bg-sky-100 border border-sky-200 px-1.5 py-0.5 rounded-full">
            parcialmente entregue
          </span>
        )}
        <div className="flex-1" />
        <span className={`text-xs font-black tabular-nums ${isPronto ? 'text-white' : SLA_COLORS[slaLevel]}`}>
          {formatElapsed(elapsed)}
        </span>
      </div>
      {!isEntregue && (
        <div className="h-1 bg-zinc-100">
          <div
            className={`h-full rounded-full transition-all ${isPronto ? 'bg-green-400' : SLA_BG[slaLevel]}`}
            style={{ width: `${slaWidth}%` }}
          />
        </div>
      )}
      <div className="px-3 py-1">
        {pedido.itens.map((item) => (
          <CozinhaItemRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

export default function CozinhaPainelCaixa() {
  useKDSTick();
  const { pedidos } = useKDS();

  // Pedidos ativos: não estão completamente entregues
  const ativos = useMemo(
    () => pedidos.filter((p) => !p.isCancelled && p.status !== 'entregue' && !todosEntregues(p)),
    [pedidos]
  );

  // Pedidos entregues: status entregue OU todos os itens/unidades entregues
  const entregues = useMemo(
    () => pedidos.filter((p) => !p.isCancelled && (p.status === 'entregue' || todosEntregues(p))),
    [pedidos]
  );

  const prontos = ativos.filter((p) => p.status === 'pronto').length;
  const emPreparo = ativos.filter((p) => p.status === 'preparo').length;
  const naFila = ativos.filter((p) => p.status === 'novo').length;
  // Pedidos com pelo menos 1 unidade entregue mas não todos
  const parcialmenteEntregues = ativos.filter((p) => temAlgumaUnidadeEntregue(p)).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary */}
      <div className="flex gap-2 px-3 py-2.5 bg-zinc-50 border-b border-zinc-100 flex-shrink-0 overflow-x-auto">
        {naFila > 0 && (
          <div className="flex items-center gap-1.5 bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 flex-shrink-0">
            <i className="ri-time-line text-zinc-500 text-xs" />
            <span className="text-xs font-bold text-zinc-700">{naFila}</span>
            <span className="text-[10px] text-zinc-400">fila</span>
          </div>
        )}
        {emPreparo > 0 && (
          <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex-shrink-0">
            <i className="ri-fire-line text-amber-500 text-xs animate-pulse" />
            <span className="text-xs font-bold text-amber-700">{emPreparo}</span>
            <span className="text-[10px] text-amber-600">preparo</span>
          </div>
        )}
        {prontos > 0 && (
          <div className="flex items-center gap-1.5 bg-green-50 border border-green-300 rounded-lg px-2.5 py-1.5 flex-shrink-0">
            <i className="ri-check-double-line text-green-600 text-xs" />
            <span className="text-xs font-black text-green-700">{prontos}</span>
            <span className="text-[10px] text-green-600 font-semibold">prontos!</span>
          </div>
        )}
        {parcialmenteEntregues > 0 && (
          <div className="flex items-center gap-1.5 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1.5 flex-shrink-0">
            <i className="ri-checkbox-circle-line text-sky-500 text-xs" />
            <span className="text-xs font-bold text-sky-700">{parcialmenteEntregues}</span>
            <span className="text-[10px] text-sky-600">parcial</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 flex-shrink-0">
          <i className="ri-checkbox-circle-line text-zinc-400 text-xs" />
          <span className="text-xs font-bold text-zinc-500">{entregues.length}</span>
          <span className="text-[10px] text-zinc-400">entregues</span>
        </div>
      </div>

      {prontos > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-500 flex-shrink-0">
          <i className="ri-restaurant-2-line text-white text-sm animate-bounce" />
          <p className="text-xs font-bold text-white">
            {prontos === 1 ? '1 pedido pronto para entregar!' : `${prontos} pedidos prontos!`}
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        {ativos.map((p) => <CozinhaPedidoCard key={p.id} pedido={p} />)}
        {entregues.length > 0 && (
          <>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2 mt-1">Entregues</p>
            {entregues.map((p) => <CozinhaPedidoCard key={p.id} pedido={p} />)}
          </>
        )}
        {pedidos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <i className="ri-restaurant-line text-3xl text-zinc-200 mb-2" />
            <p className="text-sm text-zinc-400">Nenhum pedido na cozinha</p>
          </div>
        )}
      </div>
    </div>
  );
}
