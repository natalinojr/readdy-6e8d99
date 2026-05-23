import { useState, useCallback } from 'react';
import type { KDSPedido, KDSItem, KDSItemStatus } from '@/types/kds';
import { useKDSTick, getElapsedSeconds, getSLALevel, SLA_COLORS, SLA_BG } from '@/hooks/useKDSTick';
import { useMesaEdicao } from '@/contexts/MesaEdicaoContext';
import ObsGateModal, { type ObsGateTipo } from '@/components/feature/ObsGateModal';
import EntregaGateModal from '@/components/feature/EntregaGateModal';
import KDSItemDetalhe from './KDSItemDetalhe';
import KDSCardHeader from './KDSCardHeader';
import KDSCardItemList from './KDSCardItemList';
import KDSCardActions from './KDSCardActions';

// ── Helpers (exported for sub-components) ─────────────────────────────────────

export function deriveItemStatus(item: KDSItem): KDSItemStatus {
  if (item.partes && item.partes.length > 0) {
    const statuses = item.partes.map((p) => p.status);
    if (statuses.every((s) => s === 'entregue')) return 'entregue';
    if (statuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
    if (statuses.some((s) => s === 'preparo' || s === 'pronto')) return 'preparo';
    return 'novo';
  }
  if (item.unidades && item.unidades.length > 0) {
    const statuses = item.unidades.map((u) => u.status);
    if (statuses.every((s) => s === 'entregue')) return 'entregue';
    if (statuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
    if (statuses.some((s) => s === 'preparo' || s === 'pronto')) return 'preparo';
    return 'novo';
  }
  return item.status;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PEDIDO_BORDER: Record<string, string> = {
  novo:     'border-l-4 border-l-amber-500',
  preparo:  'border-l-4 border-l-yellow-400',
  pronto:   'border-l-4 border-l-green-500',
  em_rota:  'border-l-4 border-l-orange-500',
  entregue: 'border-l-4 border-l-zinc-300 opacity-60',
};

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  pedido: KDSPedido;
  faseColuna?: KDSItemStatus;
  estacaoFiltro: string;
  onAvancar: (pedidoId: string, itemId: string, novoStatus: KDSItemStatus) => void;
  onAvancarParte: (pedidoId: string, itemId: string, parteId: string, novoStatus: KDSItemStatus) => void;
  onAvancarPedido: (pedidoId: string) => void;
  onMarcarEmRota?: (pedidoId: string) => void;
  onToggleObsChecada: (pedidoId: string, itemId: string, obs: string) => void;
  onAvancarUnidade: (pedidoId: string, itemId: string, unidadeId: string, novoStatus: KDSItemStatus) => void;
  onSelecionarOperadorUnidade: (pedidoId: string, itemId: string, unidadeId: string, operador: string) => void;
  operadoresDisponiveis: string[];
  onSelecionarOperador: (pedidoId: string, itemId: string, operador: string) => void;
  onAtribuirOperadorTodos: (pedidoId: string, operador: string) => void;
  onSetObsLivre: (pedidoId: string, itemId: string, obs: string) => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function KDSCard({
  pedido, faseColuna, estacaoFiltro,
  onAvancar, onAvancarParte, onAvancarPedido, onMarcarEmRota,
  onToggleObsChecada, onAvancarUnidade, onSelecionarOperadorUnidade,
  operadoresDisponiveis, onSelecionarOperador, onAtribuirOperadorTodos, onSetObsLivre,
}: Props) {
  useKDSTick();

  const [level, setLevel] = useState<'collapsed' | 'expanded'>('expanded');
  const [itemDetalhe, setItemDetalhe] = useState<KDSItem | null>(null);
  const [showAtribuirDropdown, setShowAtribuirDropdown] = useState(false);
  const { estaEmEdicao } = useMesaEdicao();

  type PendingObs = { tipo: ObsGateTipo; itens: KDSItem[]; onConfirm: () => void };
  const [pendingObs, setPendingObs] = useState<PendingObs | null>(null);
  const [pendingEntrega, setPendingEntrega] = useState<(() => void) | null>(null);

  // ── Derived state ────────────────────────────────────────────────────────────

  const clienteEditando =
    pedido.origem === 'mesa' &&
    pedido.mesaNumero !== undefined &&
    pedido.status === 'novo' &&
    estaEmEdicao(pedido.mesaNumero);

  const itensVisiveis = pedido.itens.filter((item) => {
    // Itens skip_kds (sem produção): só aparecem na coluna Prontos (ou sem filtro de coluna)
    if (item.semPreparo || item.skip_kds) {
      // Só mostra se estiver na coluna Prontos ou sem filtro de coluna
      if (faseColuna && faseColuna !== 'pronto') return false;
      // Só mostra se ainda não foi entregue
      const st = deriveItemStatus(item);
      return st !== 'entregue';
    }
    if (estacaoFiltro !== 'Todas') {
      if (item.partes && item.partes.length > 0) {
        if (!item.partes.some((p) => p.estacao === estacaoFiltro)) return false;
      } else if (item.estacao !== estacaoFiltro) return false;
    }
    if (faseColuna) {
      const st = deriveItemStatus(item);
      if (item.unidades && item.unidades.length > 0) return item.unidades.some((u) => u.status === faseColuna);
      return st === faseColuna;
    }
    return true;
  });

  const itensProntos = itensVisiveis.filter((i) => { const s = deriveItemStatus(i); return s === 'pronto' || s === 'entregue'; }).length;
  const todosProntos = itensVisiveis.every((i) => { const s = deriveItemStatus(i); return s === 'pronto' || s === 'entregue'; });
  const todosComOperador = itensVisiveis.every((i) => {
    if (i.unidades && i.unidades.length > 0) return i.unidades.every((u) => !!u.operadorPreparo);
    return !!i.operadorPreparo;
  });
  const pedidoPodePronto = todosProntos && todosComOperador;
  const totalObs = itensVisiveis.filter((i) => i.observacoes.length > 0 || i.observacaoLivre).length;
  const elapsedTotal = getElapsedSeconds(pedido.criadoEm);
  const slaTotal = itensVisiveis.reduce((s, i) => s + i.slaMinutos, 0);
  const slaLevel = getSLALevel(elapsedTotal, slaTotal);

  const itensSemOperadorNovo = itensVisiveis.filter((i) => {
    const status = deriveItemStatus(i);
    if (status !== 'novo') return false;
    if (i.unidades && i.unidades.length > 0) return i.unidades.some((u) => !u.operadorPreparo);
    return !i.operadorPreparo;
  });
  const mostrarAtribuirTodos = itensSemOperadorNovo.length > 0 && operadoresDisponiveis.length > 0;

  const operadoresNoCard = Array.from(new Set(
    itensVisiveis.flatMap((i) => {
      const ops: string[] = [];
      if (i.operadorPreparo) ops.push(i.operadorPreparo);
      i.unidades?.forEach((u) => { if (u.operadorPreparo) ops.push(u.operadorPreparo); });
      return ops;
    })
  ));

  // ── Stable header callbacks ──────────────────────────────────────────────────

  const handleToggleLevel = useCallback(() => setLevel((l) => (l === 'collapsed' ? 'expanded' : 'collapsed')), []);
  const handleToggleAtribuirDropdown = useCallback(() => setShowAtribuirDropdown((v) => !v), []);
  const handleCloseAtribuirDropdown = useCallback(() => setShowAtribuirDropdown(false), []);

  // ── Gate handlers ────────────────────────────────────────────────────────────

  const handleRequestAvancar = useCallback((pidId: string, itemId: string, novoStatus: KDSItemStatus, item: KDSItem) => {
    const hasObs = item.observacoes && item.observacoes.length > 0;
    const hasOpcoes = item.opcoes && item.opcoes.length > 0;
    // Abre gate se tem obs OU tem opções (para confirmar que preparou conforme escolhido)
    if ((hasObs || hasOpcoes) && (novoStatus === 'preparo' || novoStatus === 'pronto')) {
      const tipo: ObsGateTipo = novoStatus === 'preparo' ? 'iniciar' : 'pronto';
      setPendingObs({ tipo, itens: [item], onConfirm: () => { onAvancar(pidId, itemId, novoStatus); setPendingObs(null); } });
    } else {
      onAvancar(pidId, itemId, novoStatus);
    }
  }, [onAvancar]);

  const handleAvancarPedidoGate = useCallback((tipo: 'iniciar' | 'entregar') => {
    if (tipo === 'entregar') {
      setPendingEntrega(() => () => { onAvancarPedido(pedido.id); setPendingEntrega(null); });
      return;
    }
    // Itens com obs OU com opções precisam de gate
    const itensComGate = pedido.itens.filter((i) =>
      (i.observacoes && i.observacoes.length > 0) || (i.opcoes && i.opcoes.length > 0)
    );
    if (itensComGate.length > 0) {
      setPendingObs({ tipo: 'iniciar', itens: itensComGate, onConfirm: () => { onAvancarPedido(pedido.id); setPendingObs(null); } });
    } else {
      onAvancarPedido(pedido.id);
    }
  }, [onAvancarPedido, pedido.id, pedido.itens]);

  const handleMarcarProntoPedidoGate = useCallback(() => {
    // "Marcar Entregue" não precisa do ObsGate — as obs já foram checadas
    // ao apertar "Pronto" em cada item individualmente.
    // Vai direto para a entrega (sem gate de obs).
    onAvancarPedido(pedido.id);
  }, [onAvancarPedido, pedido.id]);

  // ── Early return (after all hooks) ───────────────────────────────────────────

  if (itensVisiveis.length === 0) return null;

  // ── Visual ───────────────────────────────────────────────────────────────────

  const slaGlow = pedido.status !== 'entregue'
    ? slaLevel === 'critical' ? 'ring-2 ring-red-400/60 shadow-sm shadow-red-500/10'
    : slaLevel === 'warning'  ? 'ring-1 ring-amber-400/40' : '' : '';
  const editandoGlow = clienteEditando ? 'ring-2 ring-orange-400 shadow-sm shadow-orange-400/20' : '';
  const borderClass = PEDIDO_BORDER[faseColuna ?? pedido.status] ?? PEDIDO_BORDER[pedido.status];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {itemDetalhe && <KDSItemDetalhe item={itemDetalhe} pedido={pedido} onClose={() => setItemDetalhe(null)} />}
      {pendingObs && <ObsGateModal tipo={pendingObs.tipo} itensComObs={pendingObs.itens} onConfirm={pendingObs.onConfirm} onCancel={() => setPendingObs(null)} />}
      {pendingEntrega && <EntregaGateModal pedido={pedido} onConfirm={pendingEntrega} onCancel={() => setPendingEntrega(null)} />}

      <div className={`bg-white rounded-xl mb-3 overflow-hidden ${borderClass} ${editandoGlow || slaGlow} transition-shadow`}>
        {/* Editing banner */}
        {clienteEditando && (
          <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border-b border-orange-200">
            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
              <i className="ri-edit-2-line text-orange-500 text-sm animate-pulse" />
            </div>
            <p className="text-xs font-bold text-orange-700 flex-1">
              Cliente editando — aguardando confirmação da Mesa {pedido.mesaNumero}
            </p>
            <span className="text-[10px] font-bold text-orange-500 bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-full whitespace-nowrap">
              BLOQUEADO
            </span>
          </div>
        )}

        {/* Header (number, destination, origin, timer, atribuir) */}
        <KDSCardHeader
          pedido={pedido}
          itensVisiveis={itensVisiveis}
          faseColuna={faseColuna}
          elapsedTotal={elapsedTotal}
          slaTotal={slaTotal}
          slaLevel={slaLevel}
          itensProntos={itensProntos}
          totalObs={totalObs}
          level={level}
          operadoresNoCard={operadoresNoCard}
          mostrarAtribuirTodos={mostrarAtribuirTodos}
          operadoresDisponiveis={operadoresDisponiveis}
          showAtribuirDropdown={showAtribuirDropdown}
          onToggleLevel={handleToggleLevel}
          onAtribuirOperadorTodos={onAtribuirOperadorTodos}
          onToggleAtribuirDropdown={handleToggleAtribuirDropdown}
          onCloseAtribuirDropdown={handleCloseAtribuirDropdown}
        />

        {/* SLA progress bar */}
        <div className="h-1 bg-zinc-100 mx-3">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${SLA_BG[slaLevel]}`}
            style={{ width: `${Math.min(100, (elapsedTotal / (slaTotal * 60)) * 100)}%` }}
          />
        </div>

        {/* Item list */}
        {level === 'expanded' && (
          <>
            <KDSCardItemList
              pedido={pedido}
              itensVisiveis={itensVisiveis}
              estacaoFiltro={estacaoFiltro}
              faseColuna={faseColuna}
              clienteEditando={clienteEditando}
              isCancelled={!!pedido.isCancelled}
              isKioskNaoPago={pedido.origem === 'autoatendimento' && !pedido.isPaid}
              operadoresDisponiveis={operadoresDisponiveis}
              onAvancar={onAvancar}
              onAvancarParte={onAvancarParte}
              onToggleObsChecada={onToggleObsChecada}
              onAvancarUnidade={onAvancarUnidade}
              onSelecionarOperadorUnidade={onSelecionarOperadorUnidade}
              onSelecionarOperador={onSelecionarOperador}
              onSetObsLivre={onSetObsLivre}
              onOpenDetalhe={setItemDetalhe}
              onRequestAvancar={handleRequestAvancar}
            />

            {/* Order-level action buttons */}
            {!faseColuna && !pedido.isCancelled && (
              <div className="px-3">
                <KDSCardActions
                  pedido={pedido}
                  itensVisiveis={itensVisiveis}
                  clienteEditando={clienteEditando}
                  pedidoPodePronto={pedidoPodePronto}
                  onAvancarPedido={onAvancarPedido}
                  onMarcarEmRota={onMarcarEmRota}
                  onAvancarPedidoGate={handleAvancarPedidoGate}
                  onMarcarProntoPedidoGate={handleMarcarProntoPedidoGate}
                />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
