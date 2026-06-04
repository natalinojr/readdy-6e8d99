import { memo } from 'react';
import type { KDSPedido, KDSItem, KDSItemStatus } from '@/types/kds';
import { useKDSTick, formatElapsed, formatDuration, SLA_COLORS } from '@/hooks/useKDSTick';
import { deriveItemStatus } from './KDSCard';

// ── Constants ──────────────────────────────────────────────────────────────────

const ORIGEM_BADGE: Record<string, { label: string; icon: string; color: string }> = {
  caixa:          { label: 'Caixa',   icon: 'ri-store-2-line',  color: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  garcom:         { label: 'Garçom',  icon: 'ri-user-line',     color: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  mesa:           { label: 'Mesa',    icon: 'ri-qr-code-line',  color: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  autoatendimento:{ label: 'Kiosk',   icon: 'ri-tablet-line',   color: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  delivery:       { label: 'Delivery',icon: 'ri-bike-line',     color: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const DestinoLabel = memo(function DestinoLabel({ pedido }: { pedido: KDSPedido }) {
  if (pedido.destino === 'mesa') {
    const mesaLabel = pedido.mesaNumero != null ? `Mesa ${pedido.mesaNumero}` : (pedido.nomeCliente ?? 'Mesa');
    const showCliente = pedido.mesaNumero != null && pedido.nomeCliente;
    return (
      <span>
        {mesaLabel}
        {showCliente && (
          <span className="text-zinc-400 font-normal"> · {pedido.nomeCliente}</span>
        )}
        {pedido.participantToken && (
          <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-black px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
            <i className="ri-key-2-line text-[9px]" />Senha {pedido.participantToken}
          </span>
        )}
      </span>
    );
  }
  if (pedido.destino === 'nome')     return <span>{pedido.nomeCliente}</span>;
  if (pedido.destino === 'senha')    return <span>Senha {pedido.senha}</span>;
  if (pedido.destino === 'hora')     return <span>Balcão</span>;
  if (pedido.destino === 'delivery') return <span>Delivery · {pedido.nomeCliente}</span>;
  return null;
});

const PedidoFaseResumo = memo(function PedidoFaseResumo({ pedido, itensVisiveis }: { pedido: KDSPedido; itensVisiveis: KDSItem[] }) {
  useKDSTick();
  const now = Date.now();
  const statuses = itensVisiveis.map((i) => deriveItemStatus(i));
  const todosEntregues = statuses.every((s) => s === 'entregue');
  const todosProntos   = statuses.every((s) => s === 'pronto' || s === 'entregue');
  const algumPreparo   = statuses.some((s) => s === 'preparo');
  const algumNovo      = statuses.some((s) => s === 'novo');

  if (todosEntregues) return <span className="text-[10px] text-zinc-400 font-medium">Entregue</span>;

  if (todosProntos) {
    return (
      <span className="text-[10px] font-bold text-green-600 flex items-center gap-0.5">
        <i className="ri-check-line text-[10px]" />Aguardando entrega
      </span>
    );
  }
  if (algumPreparo) {
    const emPreparo  = itensVisiveis.filter((i) => deriveItemStatus(i) === 'preparo');
    const maisAntigo = emPreparo.reduce((oldest, i) => Math.min(oldest, i.iniciouPreparoEm ?? i.entroKdsEm), now);
    return (
      <span className="text-[10px] font-bold text-yellow-600 flex items-center gap-0.5">
        <i className="ri-fire-line text-[10px]" />Aguardou {formatDuration(Math.floor((now - maisAntigo) / 1000))}min
      </span>
    );
  }
  if (algumNovo) {
    const maisAntigo = itensVisiveis.reduce((oldest, i) => Math.min(oldest, i.entroKdsEm), now);
    return (
      <span className="text-[10px] font-bold text-amber-500 flex items-center gap-0.5">
        <i className="ri-time-line text-[10px]" />Aguardando {formatDuration(Math.floor((now - maisAntigo) / 1000))}
      </span>
    );
  }
  return null;
});

// ── Props ──────────────────────────────────────────────────────────────────────

export interface KDSCardHeaderProps {
  pedido: KDSPedido;
  itensVisiveis: KDSItem[];
  faseColuna?: KDSItemStatus;
  elapsedTotal: number;
  slaTotal: number;
  slaLevel: 'ok' | 'warning' | 'critical';
  itensProntos: number;
  totalObs: number;
  level: 'collapsed' | 'expanded';
  operadoresNoCard: string[];
  mostrarAtribuirTodos: boolean;
  operadoresDisponiveis: string[];
  showAtribuirDropdown: boolean;
  onToggleLevel: () => void;
  onAtribuirOperadorTodos: (pedidoId: string, operador: string) => void;
  onToggleAtribuirDropdown: () => void;
  onCloseAtribuirDropdown: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

const KDSCardHeader = memo(function KDSCardHeader({
  pedido, itensVisiveis, faseColuna, elapsedTotal, slaTotal, slaLevel,
  itensProntos, totalObs, level, operadoresNoCard, mostrarAtribuirTodos,
  operadoresDisponiveis, showAtribuirDropdown,
  onToggleLevel, onAtribuirOperadorTodos, onToggleAtribuirDropdown, onCloseAtribuirDropdown,
}: KDSCardHeaderProps) {
  useKDSTick();
  const now = Date.now();

  const origemCfg = ORIGEM_BADGE[pedido.origem] ?? ORIGEM_BADGE.caixa;
  const numeroBase = `#${String(pedido.numero).padStart(4, '0')}`;
  // KDS display: "#0047 — Senha 03" quando o pedido tem participantToken
  const numeroDisplay = pedido.participantToken
    ? `${numeroBase} — Senha ${pedido.participantToken}`
    : numeroBase;
  const faseColunaLabel: Record<KDSItemStatus, string> = {
    novo: 'Aguardando', preparo: 'Em Preparo', pronto: 'Pronto', entregue: 'Entregue',
  };

  // ── Timer display (varies by column phase) ─────────────────────────────────
  let timerValue: string;
  let timerLabel: string;
  let timerColor: string;

  if (faseColuna === 'preparo') {
    const emPreparo = itensVisiveis.filter((i) => deriveItemStatus(i) === 'preparo');
    if (emPreparo.length > 0) {
      const maiorEspera = Math.max(...emPreparo.map((i) => {
        const inicio = i.iniciouPreparoEm ?? now;
        return Math.floor((inicio - i.entroKdsEm) / 1000);
      }));
      timerValue = formatDuration(maiorEspera);
      timerLabel = 'aguardou';
      timerColor = SLA_COLORS[slaLevel];
    } else {
      timerValue = formatElapsed(elapsedTotal);
      timerLabel = `${slaTotal}min SLA`;
      timerColor = pedido.status !== 'entregue' ? SLA_COLORS[slaLevel] : 'text-zinc-400';
    }
  } else {
    timerValue = formatElapsed(elapsedTotal);
    timerLabel = `${slaTotal}min SLA`;
    timerColor = pedido.status !== 'entregue' ? SLA_COLORS[slaLevel] : 'text-zinc-400';
  }

  return (
    <>
      {/* Fase coluna banner */}
      {faseColuna && (
        <div className={`flex items-center gap-1.5 px-3 py-1.5 border-b ${
          faseColuna === 'novo'   ? 'bg-amber-50 border-amber-100' :
          faseColuna === 'preparo'? 'bg-yellow-50 border-yellow-100' :
                                    'bg-green-50 border-green-100'
        }`}>
          <i className={`text-[10px] ${
            faseColuna === 'novo'    ? 'ri-time-line text-amber-500' :
            faseColuna === 'preparo' ? 'ri-fire-line text-yellow-600' :
                                       'ri-check-line text-green-600'
          }`} />
          <span className={`text-[10px] font-bold ${
            faseColuna === 'novo'    ? 'text-amber-600' :
            faseColuna === 'preparo' ? 'text-yellow-700' :
                                       'text-green-700'
          }`}>
            {faseColunaLabel[faseColuna]} · {itensVisiveis.length}{' '}
            {itensVisiveis.length === 1 ? 'item' : 'itens'}
          </span>
          {pedido.itens.filter((i) => !i.semPreparo && !i.skip_kds).length > itensVisiveis.length && (
            <span className="text-[9px] font-bold text-orange-500 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full ml-auto whitespace-nowrap">
              ⚡ Pedido parcial
            </span>
          )}
        </div>
      )}

      {/* Resumo dos outros itens do pedido em fases diferentes — só visível quando expandido */}
      {faseColuna && level === 'expanded' && (() => {
        const itensOutrasFases = pedido.itens.filter((item) => {
          if (item.semPreparo || item.skip_kds) return false;
          const st = deriveItemStatus(item);
          if (item.unidades && item.unidades.length > 0) {
            return !item.unidades.some((u) => u.status === faseColuna);
          }
          return st !== faseColuna;
        });
        if (itensOutrasFases.length === 0) return null;

        // Agrupar por fase
        const grupos: Record<string, { label: string; icon: string; color: string; bg: string; border: string; itens: KDSItem[] }> = {
          novo:     { label: 'Aguardando', icon: 'ri-time-line',  color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-200', itens: [] },
          preparo:  { label: 'Em Preparo', icon: 'ri-fire-line',  color: 'text-yellow-700', bg: 'bg-yellow-50', border: 'border-yellow-200', itens: [] },
          pronto:   { label: 'Pronto',     icon: 'ri-check-line', color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-200',  itens: [] },
          entregue: { label: 'Entregue',   icon: 'ri-check-double-line', color: 'text-zinc-500', bg: 'bg-zinc-50', border: 'border-zinc-200', itens: [] },
        };

        itensOutrasFases.forEach((item) => {
          const st = deriveItemStatus(item);
          if (grupos[st]) grupos[st].itens.push(item);
        });

        const fasesComItens = Object.entries(grupos).filter(([, g]) => g.itens.length > 0);
        if (fasesComItens.length === 0) return null;

        return (
          <div className="mx-3 mt-2.5 mb-2 rounded-lg border border-zinc-100 bg-zinc-50/70 overflow-hidden">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-zinc-100">
              <i className="ri-list-check text-[10px] text-zinc-400" />
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Outros itens deste pedido</span>
            </div>
            <div className="px-2.5 py-1.5 flex flex-col gap-1">
              {fasesComItens.map(([fase, grupo]) => (
                <div key={fase} className="flex items-start gap-1.5">
                  <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[9px] font-bold flex-shrink-0 mt-0.5 ${grupo.bg} ${grupo.border} ${grupo.color}`}>
                    <i className={`${grupo.icon} text-[9px]`} />
                    {grupo.label}
                  </div>
                  <div className="flex flex-wrap gap-1 flex-1">
                    {grupo.itens.map((item) => (
                      <span key={item.id} className="text-[10px] text-zinc-600 font-medium bg-white border border-zinc-200 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                        {item.quantidade > 1 && <span className="font-bold text-zinc-800">{item.quantidade}x </span>}
                        {item.nome}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Main header row */}
      <div className="w-full flex items-start gap-2 px-3 py-2.5">
        {/* Collapsible info */}
        <button
          onClick={onToggleLevel}
          className="flex-1 flex items-start justify-between hover:bg-zinc-50 transition-colors cursor-pointer rounded-lg min-w-0"
        >
          <div className="flex flex-col gap-0.5 min-w-0">
            {/* Row 1: number + destination + origin */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-black text-zinc-900 text-base">{numeroDisplay}</span>
              <span className="text-zinc-300 text-xs">·</span>
              <span className="text-xs font-semibold text-zinc-600">
                <DestinoLabel pedido={pedido} />
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex items-center gap-0.5 ${origemCfg.color}`}>
                <i className={`${origemCfg.icon} text-[10px]`} />{origemCfg.label}
                {pedido.origem === 'garcom' && pedido.garcomNome && (
                  <span className="font-normal"> · {pedido.garcomNome}</span>
                )}
              </span>
              {pedido.itens.some((i) => i.partes && i.partes.length > 0) && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200 flex items-center gap-0.5">
                  <i className="ri-git-branch-line text-[10px]" />Multi
                </span>
              )}
              {pedido.destino === 'delivery' && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-800 text-white flex items-center gap-0.5">
                  <i className="ri-bike-line text-[10px]" />DELIVERY
                </span>
              )}
              {pedido.status === 'em_rota' && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500 text-white flex items-center gap-0.5 animate-pulse">
                  <i className="ri-bike-line text-[10px]" />EM ROTA
                </span>
              )}
              {pedido.destino === 'senha' && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-700 text-white flex items-center gap-0.5">
                  <i className="ri-tablet-line text-[10px]" />RETIRAR
                </span>
              )}
            </div>

            {/* Row 2: counts + fase resumo + forma de pagamento */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-zinc-400 font-medium">
                {itensVisiveis.reduce((s, i) => s + i.quantidade, 0)} itens · {itensProntos}/{itensVisiveis.length} prontos
              </span>
              {pedido.origem === 'autoatendimento' && pedido.paymentMethodName && (
                <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  <i className="ri-wallet-3-line text-[9px]" />{pedido.paymentMethodName}
                </span>
              )}
              {pedido.origem === 'autoatendimento' && pedido.totalAmount > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  <i className="ri-money-dollar-circle-line text-[9px]" />
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pedido.totalAmount)}
                </span>
              )}
              {totalObs > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-600">
                  <i className="ri-alert-fill text-[10px]" />{totalObs} obs
                </span>
              )}
              {!faseColuna && pedido.status !== 'entregue' && (
                <PedidoFaseResumo pedido={pedido} itensVisiveis={itensVisiveis} />
              )}
              {level === 'collapsed' && operadoresNoCard.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {operadoresNoCard.map((op) => (
                    <span key={op} className="flex items-center gap-0.5 text-[9px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                      <i className="ri-user-line text-[8px]" />{op}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Timer + chevron */}
          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
            <div className="text-right">
              <span className={`text-sm font-black tabular-nums block ${timerColor}`}>
                {timerValue}
              </span>
              <span className="text-[9px] text-zinc-400">{timerLabel}</span>
            </div>
            <div className={`w-4 h-4 flex items-center justify-center text-zinc-400 transition-transform ${level === 'expanded' ? 'rotate-180' : ''}`}>
              <i className="ri-arrow-down-s-line text-base" />
            </div>
          </div>
        </button>

        {/* Atribuir a todos */}
        {mostrarAtribuirTodos && (
          <div className="relative flex-shrink-0 self-center">
            {operadoresDisponiveis.length === 1 ? (
              <button
                onClick={(e) => { e.stopPropagation(); onAtribuirOperadorTodos(pedido.id, operadoresDisponiveis[0]); }}
                title={`Atribuir ${operadoresDisponiveis[0]} a todos os itens`}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-teal-500 hover:bg-teal-600 text-white text-[10px] font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
              >
                <i className="ri-user-follow-line text-[11px]" />Atribuir a todos
              </button>
            ) : (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleAtribuirDropdown(); }}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-teal-500 hover:bg-teal-600 text-white text-[10px] font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                >
                  <i className="ri-user-follow-line text-[11px]" />Atribuir a todos
                  <i className="ri-arrow-down-s-line text-[11px]" />
                </button>
                {showAtribuirDropdown && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={onCloseAtribuirDropdown} />
                    <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden min-w-[140px]">
                      <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide px-3 pt-2 pb-1">
                        Selecionar operador
                      </p>
                      {operadoresDisponiveis.map((op) => (
                        <button
                          key={op}
                          onClick={(e) => { e.stopPropagation(); onAtribuirOperadorTodos(pedido.id, op); onCloseAtribuirDropdown(); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-teal-50 hover:text-teal-700 cursor-pointer transition-colors whitespace-nowrap text-left"
                        >
                          <i className="ri-user-line text-[11px] text-teal-500" />{op}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
});

export default KDSCardHeader;
