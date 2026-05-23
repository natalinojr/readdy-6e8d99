import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { PedidoRecente, PedidoItemDetalhe, UnidadeItem } from '@/types/pdv';
import ImprimirPedidoModal from './ImprimirPedidoModal';
import EstornoModal from './EstornoModal';
import CancelamentoModal from './CancelamentoModal';
import { useKDS } from '../../../../contexts/KDSContext';
import type { KDSPedido, KDSItem, KDSItemStatus, KDSPedidoStatus } from '@/types/kds';
import { kdsStatusToPdvStatus, pdvStatusLabel, pdvStatusBadgeCls, formatOrderNumber } from '@/lib/statusMappers';
import { formatOrderTime } from '@/lib/dateUtils';
import PagamentoRapidoModal from '@/components/feature/PagamentoRapidoModal';
import EditarItemCaixaModal from './EditarItemCaixaModal';

// ── Hook: cronômetro live ────────────────────────────────────────────────────

function useCronometro(minutosAtras: number, ativo: boolean) {
  const [segundos, setSegundos] = useState(() => minutosAtras * 60);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    setSegundos(minutosAtras * 60);
    if (!ativo) return;
    ref.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [minutosAtras, ativo]);
  return segundos;
}

function formatCronometro(totalSegundos: number) {
  const h = Math.floor(totalSegundos / 3600);
  const m = Math.floor((totalSegundos % 3600) / 60);
  const s = totalSegundos % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function cronometroColor(totalSegundos: number) {
  const min = totalSegundos / 60;
  if (min < 15) return 'bg-green-100 text-green-700 border-green-200';
  if (min < 30) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

function cronometroIcon(totalSegundos: number) {
  const min = totalSegundos / 60;
  if (min < 15) return 'ri-time-line';
  if (min < 30) return 'ri-alarm-warning-line';
  return 'ri-alarm-warning-fill';
}

function CronometroBadge({ pedido }: { pedido: PedidoRecente }) {
  const isAtivo = pedido.status === 'aberto' || pedido.status === 'pronto';
  const segundos = useCronometro(pedido.minutosAtras, isAtivo);
  if (!isAtivo) {
    const minFinal = pedido.tempoAberto ?? pedido.minutosAtras;
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-zinc-100 text-zinc-500 border-zinc-200 whitespace-nowrap">
        <i className="ri-time-line text-[10px]" />{minFinal}m
      </span>
    );
  }
  return (
    <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${cronometroColor(segundos)}`}>
      <i className={`${cronometroIcon(segundos)} text-[10px]`} />
      {formatCronometro(segundos)}
    </span>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Status/badge label functions are now centralized in src/lib/statusMappers.ts
// No local re-derivation — use KDS status directly as source of truth.

const STATUS_LEFT_BORDER: Record<string, string> = {
  aberto:    'border-l-[3px] border-l-amber-400',
  pronto:    'border-l-[3px] border-l-green-500',
  entregue:  'border-l-[3px] border-l-zinc-300',
  cancelado: 'border-l-[3px] border-l-red-300',
};

const STATUS_CARD_BG: Record<string, string> = {
  aberto:    'bg-white',
  pronto:    'bg-green-50/50',
  entregue:  'bg-zinc-50/80',
  cancelado: 'bg-zinc-50/80',
};

const ORIGEM_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  caixa:           { label: 'Caixa',          icon: 'ri-safe-2-line',       color: 'bg-amber-50  text-amber-700  border-amber-200'  },
  garcom:          { label: 'Garçom',          icon: 'ri-walk-line',         color: 'bg-sky-50    text-sky-700    border-sky-200'    },
  mesa:            { label: 'Mesa',            icon: 'ri-restaurant-2-line', color: 'bg-violet-50 text-violet-700 border-violet-200' },
  autoatendimento: { label: 'Autoatendimento', icon: 'ri-tablet-line',       color: 'bg-teal-50   text-teal-700   border-teal-200'   },
};

const UNIDADE_STATUS_CFG: Record<string, { icon: string; color: string; label: string }> = {
  aguardando: { icon: 'ri-time-line',            color: 'text-zinc-400',  label: 'Aguardando' },
  preparo:    { icon: 'ri-fire-line',            color: 'text-amber-500', label: 'Em preparo' },
  pronto:     { icon: 'ri-check-double-line',    color: 'text-green-500', label: 'Pronto'     },
  entregue:   { icon: 'ri-checkbox-circle-fill', color: 'text-green-600', label: 'Entregue'   },
};

function destinoLabel(p: PedidoRecente) {
  if (p.destino === 'mesa')     return `Mesa ${p.mesaNumero}${p.nomeCliente ? ` · ${p.nomeCliente}` : ''}`;
  if (p.destino === 'nome')     return p.nomeCliente ?? '—';
  if (p.destino === 'senha')    return `Senha ${p.senha}`;
  if (p.destino === 'hora')     return 'Balcão';
  if (p.destino === 'delivery') return `Delivery · ${p.nomeCliente}`;
  return '—';
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function unitKey(itemId: string, unidade: number) {
  return `${itemId}-${unidade}`;
}

/** Retorna label e ícone do canal onde o pagamento foi registrado */
function canalRegistro(pg: { origin_type?: string | null; cash_register_id?: string | null; cash_register_name?: string | null }) {
  if (pg.cash_register_id || pg.cash_register_name) {
    return { icon: 'ri-safe-2-line', label: 'Caixa', color: 'text-amber-600 bg-amber-50 border-amber-200' };
  }
  const tipo = (pg.origin_type ?? '').toLowerCase();
  if (tipo === 'waiter' || tipo === 'garcom') return { icon: 'ri-walk-line', label: 'Garçom', color: 'text-sky-600 bg-sky-50 border-sky-200' };
  if (tipo === 'table' || tipo === 'mesa') return { icon: 'ri-restaurant-2-line', label: 'Mesa', color: 'text-violet-600 bg-violet-50 border-violet-200' };
  if (tipo === 'delivery') return { icon: 'ri-e-bike-line', label: 'Delivery', color: 'text-rose-600 bg-rose-50 border-rose-200' };
  if (tipo === 'kiosk' || tipo === 'autoatendimento' || tipo === 'self_service') return { icon: 'ri-tablet-line', label: 'Autoatendimento', color: 'text-teal-600 bg-teal-50 border-teal-200' };
  if (tipo === 'cashier' || tipo === 'caixa') return { icon: 'ri-safe-2-line', label: 'Caixa', color: 'text-amber-600 bg-amber-50 border-amber-200' };
  return null;
}

// ── Contagem de unidades totais e prontas ────────────────────────────────────

function contarUnidades(pedido: PedidoRecente) {
  let total = 0;
  let emPreparo = 0;
  let prontas = 0;
  pedido.itensDetalhes.forEach((item) => {
    item.unidades.forEach((u) => {
      total++;
      if (u.status === 'preparo') emPreparo++;
      if (u.status === 'pronto' || u.status === 'entregue') prontas++;
    });
  });
  return { total, prontas, emPreparo };
}

function labelUnidades(total: number, prontas: number, emPreparo: number): string {
  if (prontas === total) return `${total} ${total === 1 ? 'unidade' : 'unidades'} prontas`;
  if (emPreparo > 0 && prontas === 0) return `${emPreparo}/${total} em preparo`;
  if (emPreparo > 0) return `${prontas + emPreparo}/${total} em andamento`;
  return `${prontas}/${total} ${total === 1 ? 'unidade' : 'unidades'}`;
}

// ── Status efetivo do item ───────────────────────────────────────────────────

function itemEfetivoStatus(item: PedidoItemDetalhe, entreguesLocal: Set<string>): 'aguardando' | 'preparo' | 'pronto' | 'entregue' {
  const unidades = item.unidades;
  const totalUnits = unidades.length;
  const entregues = unidades.filter(
    (u) => u.status === 'entregue' || entreguesLocal.has(unitKey(item.id, u.unidade))
  ).length;
  if (entregues === totalUnits) return 'entregue';
  const emPreparo = unidades.filter((u) => u.status === 'preparo').length;
  const prontos = unidades.filter(
    (u) => u.status === 'pronto' && !entreguesLocal.has(unitKey(item.id, u.unidade))
  ).length;
  const aguardando = unidades.filter((u) => u.status === 'aguardando').length;
  if (emPreparo > 0) return 'preparo';
  if (prontos > 0) return 'pronto';
  if (aguardando === totalUnits) return 'aguardando';
  return 'preparo';
}

const ITEM_STATUS_CFG: Record<string, { label: string; icon: string; badgeCls: string; borderCls: string; bgCls: string }> = {
  aguardando: { label: 'Aguardando', icon: 'ri-time-line',         badgeCls: 'bg-zinc-100 text-zinc-500 border-zinc-200',   borderCls: 'border-l-[3px] border-l-zinc-300',   bgCls: 'bg-white'         },
  preparo:    { label: 'Em preparo', icon: 'ri-fire-line',         badgeCls: 'bg-amber-100 text-amber-700 border-amber-300', borderCls: 'border-l-[3px] border-l-amber-400',  bgCls: 'bg-amber-50/30'   },
  pronto:     { label: 'Pronto',     icon: 'ri-check-double-line', badgeCls: 'bg-green-100 text-green-700 border-green-300', borderCls: 'border-l-[3px] border-l-green-500',  bgCls: 'bg-green-50/50'   },
  entregue:   { label: 'Entregue',   icon: 'ri-checkbox-circle-fill', badgeCls: 'bg-zinc-100 text-zinc-400 border-zinc-200', borderCls: 'border-l-[3px] border-l-zinc-200',  bgCls: 'bg-zinc-50/60'    },
};

// ── Unidade detalhe ──────────────────────────────────────────────────────────

interface UnidadeRowProps {
  u: UnidadeItem;
  numero: number;
  itemId: string;
  isEntregueLocal: boolean;
  onEntregar: () => void;
}

function UnidadeRow({ u, numero, isEntregueLocal, onEntregar }: UnidadeRowProps) {
  const efetivamenteEntregue = isEntregueLocal || u.status === 'entregue';
  const cfg = efetivamenteEntregue ? UNIDADE_STATUS_CFG['entregue'] : UNIDADE_STATUS_CFG[u.status];
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-zinc-50 last:border-0">
      {/* Número da unidade */}
      <div className={`w-5 h-5 flex items-center justify-center rounded-full text-[9px] font-black flex-shrink-0 ${
        efetivamenteEntregue ? 'bg-green-500 text-white' :
        u.status === 'pronto' ? 'bg-green-100 text-green-700' :
        u.status === 'preparo' ? 'bg-amber-100 text-amber-700' :
        'bg-zinc-100 text-zinc-500'
      }`}>{numero}</div>
      <div className={`w-4 h-4 flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
        <i className={`${cfg.icon} text-xs`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className={`text-[10px] font-bold ${cfg.color}`}>{cfg.label}</span>
          <div className="flex items-center gap-2 flex-wrap">
            {u.operadorCozinha && (
              <span className="text-[9px] text-zinc-400 flex items-center gap-0.5">
                <i className="ri-user-line text-[9px]" /> {u.operadorCozinha}
              </span>
            )}
            {u.ficouProntoEm && (
              <span className="text-[9px] text-zinc-400 flex items-center gap-0.5">
                <i className="ri-checkbox-circle-line text-[9px]" /> pronto {u.ficouProntoEm}
              </span>
            )}
            {(u.entregueEm && u.entregoPor) && (
              <span className="text-[9px] text-green-600 flex items-center gap-0.5 font-semibold">
                <i className="ri-walk-line text-[9px]" /> {u.entregoPor} · {u.entregueEm}
              </span>
            )}
          </div>
        </div>
      </div>
      {!efetivamenteEntregue && u.status === 'pronto' && (
        <button
          onClick={(e) => { e.stopPropagation(); onEntregar(); }}
          className="flex-shrink-0 text-[9px] font-black bg-green-500 hover:bg-green-600 text-white px-2 py-0.5 rounded-full cursor-pointer whitespace-nowrap transition-colors"
        >
          Entregar
        </button>
      )}
      {efetivamenteEntregue && isEntregueLocal && (
        <span className="flex-shrink-0 text-[9px] font-bold text-green-600 flex items-center gap-0.5 whitespace-nowrap">
          <i className="ri-check-double-line text-xs" /> Entregue
        </span>
      )}
    </div>
  );
}

// ── Item detalhe ─────────────────────────────────────────────────────────────

interface ItemDetalheRowProps {
  item: PedidoItemDetalhe;
  entreguesLocal: Set<string>;
  onEntregar: (itemId: string, unidade: number) => void;
  onEditar?: (item: PedidoItemDetalhe) => void;
}

function ItemDetalheRow({ item, entreguesLocal, onEntregar, onEditar }: ItemDetalheRowProps) {
  const [expanded, setExpanded] = useState(false);

  const isUnitEntregue = (u: UnidadeItem) =>
    u.status === 'entregue' || entreguesLocal.has(unitKey(item.id, u.unidade));

  const totalEntregues = item.unidades.filter(isUnitEntregue).length;
  const allEntregues = totalEntregues === item.quantidade;
  const unidadesAguardandoEntrega = item.unidades.filter(
    (u) => u.status === 'pronto' && !isUnitEntregue(u)
  ).length;
  const isSinglePronto = item.quantidade === 1 && item.unidades[0]?.status === 'pronto' && !isUnitEntregue(item.unidades[0]);
  const isSingleEntregueLocal = item.quantidade === 1 && isUnitEntregue(item.unidades[0]);
  const efetivoStatus = itemEfetivoStatus(item, entreguesLocal);
  const cfg = ITEM_STATUS_CFG[efetivoStatus];
  const podeEditar = efetivoStatus === 'aguardando' && onEditar;

  return (
    <div className={`rounded-lg border border-zinc-200 overflow-hidden transition-all ${cfg.borderCls} ${cfg.bgCls} ${allEntregues ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        {/* Status badge */}
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold flex-shrink-0 whitespace-nowrap ${cfg.badgeCls}`}>
          <i className={`${cfg.icon} text-[9px]`} />
          {cfg.label}
          {item.quantidade > 1 && efetivoStatus !== 'entregue' && (
            <span className="ml-0.5 opacity-70">
              {efetivoStatus === 'pronto'
                ? `${unidadesAguardandoEntrega}/${item.quantidade}`
                : `${totalEntregues}/${item.quantidade}`}
            </span>
          )}
        </div>

        {/* Nome */}
        {item.quantidade > 1 ? (
          <button onClick={() => setExpanded((v) => !v)} className="flex-1 min-w-0 text-left cursor-pointer">
            <ItemNomeSimples item={item} allEntregues={allEntregues} expanded={expanded} />
          </button>
        ) : (
          <div className="flex-1 min-w-0">
            <ItemNomeSimples item={item} allEntregues={allEntregues} expanded={false} showArrow={false} />
          </div>
        )}

        {/* Ações inline */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {item.preco > 0 && (
            <span className="text-xs font-bold text-zinc-700 whitespace-nowrap">
              {formatPrice(item.preco * item.quantidade)}
            </span>
          )}
          {podeEditar && (
            <button
              onClick={(e) => { e.stopPropagation(); onEditar?.(item); }}
              className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-amber-100 text-amber-500 cursor-pointer transition-colors"
              title="Editar item"
            >
              <i className="ri-pencil-line text-xs" />
            </button>
          )}
          {isSinglePronto && (
            <button
              onClick={() => onEntregar(item.id, item.unidades[0].unidade)}
              className="flex items-center gap-1 text-[9px] font-black bg-green-500 hover:bg-green-600 text-white px-2 py-0.5 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
            >
              <i className="ri-check-line text-[9px]" />Entregar
            </button>
          )}
          {isSingleEntregueLocal && item.unidades[0]?.status !== 'entregue' && (
            <span className="text-[9px] font-bold text-green-600 flex items-center gap-0.5 whitespace-nowrap">
              <i className="ri-check-double-line text-xs" />
            </span>
          )}
        </div>
      </div>

      {/* Barra de progresso por unidade */}
      {item.quantidade > 1 && (
        <div className="flex gap-0.5 px-2.5 pb-1.5">
          {item.unidades.map((u, i) => {
            const entregue = isUnitEntregue(u);
            return (
              <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${
                entregue ? 'bg-green-500' : u.status === 'pronto' ? 'bg-green-300' : u.status === 'preparo' ? 'bg-amber-400 animate-pulse' : 'bg-zinc-200'
              }`} title={`Unid. ${u.unidade}: ${entregue ? 'Entregue' : u.status}`} />
            );
          })}
        </div>
      )}

      {/* Expandido: unidades numeradas */}
      {expanded && item.quantidade > 1 && (
        <div className="border-t border-zinc-100 px-3 py-1 bg-white/60">
          {item.unidades.map((u, idx) => (
            <UnidadeRow
              key={u.unidade}
              u={u}
              numero={idx + 1}
              itemId={item.id}
              isEntregueLocal={entreguesLocal.has(unitKey(item.id, u.unidade))}
              onEntregar={() => onEntregar(item.id, u.unidade)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ItemNomeSimplesProps {
  item: PedidoItemDetalhe;
  allEntregues: boolean;
  expanded: boolean;
  showArrow?: boolean;
}

function ItemNomeSimples({ item, allEntregues, expanded, showArrow = true }: ItemNomeSimplesProps) {
  const categoriaNome = item.categoriaNome;
  return (
    <div className="flex items-center gap-1 min-w-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 flex-wrap">
          {item.quantidade > 1 && (
            <span className="text-[10px] font-black text-amber-600 flex-shrink-0">{item.quantidade}x</span>
          )}
          <span className={`text-xs font-semibold ${allEntregues ? 'text-zinc-400 line-through' : 'text-zinc-800'}`} title={item.nome}>
            {item.nome}
          </span>
          {categoriaNome && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 border border-zinc-200 whitespace-nowrap flex-shrink-0">
              {categoriaNome}
            </span>
          )}
        </div>
        {item.opcoes.length > 0 && (
          <p className="text-[9px] text-zinc-400 truncate" title={item.opcoes.join(' · ')}>{item.opcoes.join(' · ')}</p>
        )}
        {item.observacao && (
          <p className="text-[9px] text-amber-600 truncate" title={item.observacao}>
            <i className="ri-chat-1-line mr-0.5" />{item.observacao}
          </p>
        )}
      </div>
      {showArrow && (
        <i className={`text-zinc-400 text-xs flex-shrink-0 ${expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
      )}
    </div>
  );
}

// ── Mapper: KDSPedido → PedidoRecente ────────────────────────────────────────

function kdsItemStatusToUnidade(s: KDSItemStatus): UnidadeItem['status'] {
  if (s === 'preparo') return 'preparo';
  if (s === 'pronto') return 'pronto';
  if (s === 'entregue') return 'entregue';
  return 'aguardando';
}

function kdsStatusToRecente(s: KDSPedidoStatus, isCancelled?: boolean): PedidoRecente['status'] {
  return kdsStatusToPdvStatus(s, isCancelled ?? false);
}

function kdsToRecente(p: KDSPedido): PedidoRecente {
  const now = Date.now();
  const minutosAtras = Math.max(0, Math.floor((now - p.criadoEm) / 60000));
  // BUG 2.1 FIX: sempre usa America/Sao_Paulo via helper centralizado
  const hora = formatOrderTime(p.criadoEm);

  const itensDetalhes: PedidoItemDetalhe[] = p.itens.map((item) => {
    const unidades: UnidadeItem[] = item.unidades && item.unidades.length > 0
      ? item.unidades.map((u) => ({
          unidade: u.numero,
          status: kdsItemStatusToUnidade(u.status),
          operadorCozinha: u.operadorPreparo,
          // BUG 2.1 FIX: formatOrderTime para timestamps de unidades
          ficouProntoEm: u.ficouProntoEm ? formatOrderTime(u.ficouProntoEm) : undefined,
          entregueEm: u.entregueEm ? formatOrderTime(u.entregueEm) : undefined,
          entregoPor: u.quemEntregou,
        }))
      : [{
          unidade: 1,
          status: kdsItemStatusToUnidade(item.status),
          operadorCozinha: item.operadorPreparo,
          ficouProntoEm: item.ficouProntoEm ? formatOrderTime(item.ficouProntoEm) : undefined,
          entregueEm: item.entregueEm ? formatOrderTime(item.entregueEm) : undefined,
          entregoPor: item.quemEntregou,
        }];

    return {
      id: item.id,
      menuItemId: item.menuItemId,
      nome: item.nome,
      categoriaNome: item.categoriaNome,
      quantidade: item.quantidade,
      preco: (item.item_price ?? 0) > 0
        ? (item.item_price ?? 0)
        : (p.totalAmount > 0 ? p.totalAmount / p.itens.reduce((acc, i) => acc + i.quantidade, 0) : 0),
      estacao: item.estacao,
      // BUG 3.2 FIX: exibir preço adicional das opções quando > 0
      opcoes: item.opcoes
        .filter((o) => !!o.opcaoNome)
        .map((o) => {
          const addPrice = o.additional_price ?? 0;
          const label = `${o.grupoNome}: ${o.opcaoNome}`;
          return addPrice > 0
            ? `${label} (+${addPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`
            : label;
        }),
      observacao: item.observacoes.filter(Boolean).join(' · ') || undefined,
      unidades,
    };
  });

  const itensProntos = p.itens.filter((i) => i.status === 'pronto' || i.status === 'entregue').length;
  const itensTotal = p.itens.filter((i) => !i.semPreparo && !i.skip_kds).length || p.itens.length;

  return {
    id: p.id,
    numero: p.numero,
    numeroStr: p.numeroStr,
    destino: p.destino,
    mesaNumero: p.mesaNumero,
    nomeCliente: p.nomeCliente,
    senha: p.senha,
    status: kdsStatusToRecente(p.status, p.isCancelled),
    pago: p.isPaid ?? false,
    kdsStatus: p.status,
    total: p.totalAmount ?? 0,
    criadoEm: hora,
    minutosAtras,
    itensProntos,
    itensTotal,
    origem: p.origem,
    // BUG 3.7 FIX: garcomNome preservado — exibido no card header
    garcomNome: p.garcomNome,
    // BUG 2.3: badge TREINO
    isTraining: p.isTraining,
    // BUG 3.4: pagamentos para split payment
    pagamentos: p.pagamentos?.map((pg) => ({
      id: pg.id,
      amount: pg.amount,
      change_amount: pg.change_amount,
      is_refunded: pg.is_refunded,
      payment_method_name: pg.payment_method_name,
      operator_name: pg.operator_name,
      cash_register_id: pg.cash_register_id,
      cash_register_name: pg.cash_register_name,
      origin_type: pg.origin_type,
    })),
    itensDetalhes,
  };
}

// ── Card de pedido ────────────────────────────────────────────────────────────

interface PedidoCardProps {
  pedido: PedidoRecente;
  onEntregarRemote?: (itemId: string, orderId: string, unidadeNumero?: number) => Promise<void>;
  onEditarItem?: (item: PedidoItemDetalhe, orderId: string) => void;
  onRecarregar?: () => void;
}

function PedidoCard({ pedido, onEntregarRemote, onEditarItem, onRecarregar }: PedidoCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  const [showEstorno, setShowEstorno] = useState(false);
  const [showCancelamento, setShowCancelamento] = useState(false);
  const [showPagamento, setShowPagamento] = useState(false);
  const [cancelado, setCancelado] = useState(false);
  const [estornado, setEstornado] = useState(false);
  const [pagoLocal, setPagoLocal] = useState(false);
  const [entregandoKiosk, setEntregandoKiosk] = useState(false);
  const [entreguesLocal, setEntreguesLocal] = useState<Set<string>>(new Set());
  const [itemEditando, setItemEditando] = useState<PedidoItemDetalhe | null>(null);
  // isCancelado: vem do KDS (status sincronizado) OU cancelamento local
  const isCancelado = cancelado || pedido.status === 'cancelado';
  // isPago: usa apenas pedido.pago (vem de KDSContext → orders.is_paid no banco)
  // pagoLocal é otimista — set imediatamente após PagamentoRapidoModal.onSuccess
  const isPago = (pedido.pago === true || pagoLocal) && !estornado;
  const statusEfetivo = isCancelado ? 'cancelado' : pedido.status;
  const origemCfg = ORIGEM_CONFIG[pedido.origem] ?? ORIGEM_CONFIG.caixa;


  // Use centralized mappers — source of truth is KDS status, no re-derivation
  const kdsStatusRaw = (pedido as PedidoRecente & { kdsStatus?: KDSPedidoStatus }).kdsStatus;
  const statusLabel = isCancelado ? 'Cancelado' : pdvStatusLabel(statusEfetivo as PedidoRecente['status'], kdsStatusRaw);
  const statusBadgeCls = pdvStatusBadgeCls(statusEfetivo as PedidoRecente['status'], kdsStatusRaw);

  const handleEditar = (item: PedidoItemDetalhe) => {
    setItemEditando(item);
  };

  const handleEntregar = (itemId: string, unidade: number) => {
    setEntreguesLocal((prev) => new Set(prev).add(unitKey(itemId, unidade)));
    if (onEntregarRemote) {
      // Passa o número da unidade para usar update_unit_status no backend
      onEntregarRemote(itemId, pedido.id, unidade).catch((e) =>
        console.error('[PedidoCard] entregar remoto error:', e),
      );
    }
  };

  const handleEntregarTodos = () => {
    const novas = new Set(entreguesLocal);
    pedido.itensDetalhes.forEach((item) => {
      item.unidades.forEach((u) => {
        if (u.status === 'pronto') novas.add(unitKey(item.id, u.unidade));
      });
    });
    setEntreguesLocal(novas);
  };

  // Entregar todos os itens do pedido kiosk de uma vez (após pagamento)
  const handleEntregarPedidoKiosk = async () => {
    if (!onEntregarRemote) return;
    setEntregandoKiosk(true);
    try {
      for (const item of pedido.itensDetalhes) {
        for (const u of item.unidades) {
          if (u.status !== 'entregue') {
            await onEntregarRemote(item.id, pedido.id, u.unidade);
          }
        }
      }
      // Marca todos localmente
      const novas = new Set(entreguesLocal);
      pedido.itensDetalhes.forEach((item) => {
        item.unidades.forEach((u) => novas.add(unitKey(item.id, u.unidade)));
      });
      setEntreguesLocal(novas);
    } finally {
      setEntregandoKiosk(false);
    }
  };

  // Conta unidades prontas aguardando entrega
  const unidadesAguardando = pedido.itensDetalhes.reduce((acc, item) => {
    return acc + item.unidades.filter(
      (u) => u.status === 'pronto' && !entreguesLocal.has(unitKey(item.id, u.unidade))
    ).length;
  }, 0);

  const todosEntreguesLocal = pedido.itensDetalhes.every((item) =>
    item.unidades.every((u) =>
      u.status === 'entregue' || entreguesLocal.has(unitKey(item.id, u.unidade))
    )
  );

  const { total: totalUnidades, prontas: unidadesProntas, emPreparo: unidadesEmPreparo } = contarUnidades(pedido);

  return (
    <>
    {itemEditando && (
      <EditarItemCaixaModal
        item={itemEditando}
        orderId={pedido.id}
        onSalvar={() => {
          setItemEditando(null);
          onRecarregar?.();
        }}
        onClose={() => setItemEditando(null)}
      />
    )}
    {showPagamento && !isCancelado && pedido.total > 0 && (
      <PagamentoRapidoModal
        orderId={pedido.id}
        numeroDisplay={pedido.numero}
        total={pedido.total}
        destinoDisplay={destinoLabel(pedido)}
        onClose={() => setShowPagamento(false)}
        onSuccess={(_orderId, _paymentMethodId) => {
          setPagoLocal(true);
          setShowPagamento(false);
          // Para pedidos de autoatendimento: entregar automaticamente após pagamento
          // se o pedido já estiver pronto
          if (pedido.origem === 'autoatendimento' && pedido.status === 'pronto') {
            setTimeout(() => handleEntregarPedidoKiosk(), 300);
          }
        }}
      />
    )}
    <div className={`mx-2 mb-2 rounded-xl border border-zinc-200 overflow-hidden transition-all ${STATUS_LEFT_BORDER[statusEfetivo]} ${STATUS_CARD_BG[statusEfetivo]} ${statusEfetivo === 'cancelado' ? 'opacity-50' : ''}`}>
      {/* Header clicável */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
        className="px-3 pt-3 pb-2.5 cursor-pointer hover:brightness-95 transition-all"
      >
        {/* Linha 1: número + destino + origem */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
            <span className="font-black text-zinc-900 text-sm whitespace-nowrap">
              #{String(pedido.numero).padStart(4, '0')}
            </span>
            <span className="text-xs font-semibold text-zinc-600 truncate" title={destinoLabel(pedido)}>
              {destinoLabel(pedido)}
            </span>
            <span className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${origemCfg.color}`}>
              <i className={`${origemCfg.icon} text-[9px]`} />
              {origemCfg.label}
              {pedido.origem === 'garcom' && pedido.garcomNome && (
                <span className="ml-0.5">· {pedido.garcomNome.split(' ')[0]}</span>
              )}
            </span>
            {/* BUG 3.7 FIX: garcom em pedidos de mesa */}
            {pedido.origem !== 'garcom' && pedido.garcomNome && (
              <span className="flex items-center gap-0.5 text-[9px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-full">
                <i className="ri-walk-line text-[9px]" />{pedido.garcomNome.split(' ')[0]}
              </span>
            )}
            {/* BUG 2.3 FIX: badge TREINO */}
            {pedido.isTraining && (
              <span className="flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-yellow-300 text-yellow-900 border border-yellow-400">
                <i className="ri-graduation-cap-fill text-[9px]" />TREINO
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs font-black text-zinc-900">{formatPrice(pedido.total)}</span>
            <i className={`text-zinc-400 text-sm flex-shrink-0 ${expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
          </div>
        </div>

        {/* Linha 2: tempo + pago + status + unidades + hora */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <CronometroBadge pedido={pedido} />
            {isPago && (
              <span className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-300 whitespace-nowrap">
                <i className="ri-shield-check-fill text-[10px]" />Pago
              </span>
            )}
            {estornado && (
              <span className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full border bg-red-100 text-red-600 border-red-300 whitespace-nowrap">
                <i className="ri-refund-2-line text-[10px]" />Estornado
              </span>
            )}
            {isCancelado && (
              <span className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full border bg-red-100 text-red-600 border-red-300 whitespace-nowrap">
                <i className="ri-close-circle-line text-[10px]" />Cancelado
              </span>
            )}
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${statusBadgeCls}`}>
              {statusLabel}
            </span>
            <span className="text-[10px] text-zinc-400">{pedido.criadoEm}</span>
            {pedido.status !== 'entregue' && pedido.status !== 'cancelado' && totalUnidades > 0 && (
              <span className="text-[10px] text-zinc-500">
                {labelUnidades(totalUnidades, unidadesProntas, unidadesEmPreparo)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setImprimindo(true); }}
              title="Imprimir pedido"
              className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-amber-600 hover:bg-amber-50 border border-zinc-200 hover:border-amber-300 rounded-lg cursor-pointer transition-colors"
            >
              <i className="ri-printer-line text-xs" />
            </button>
          </div>
        </div>

        {/* Indicador rápido de prontos */}
        {unidadesAguardando > 0 && !expanded && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
            <span className="text-[10px] font-bold text-green-700">
              {unidadesAguardando} {unidadesAguardando === 1 ? 'unidade pronta' : 'unidades prontas'} — clique para entregar
            </span>
          </div>
        )}
        {/* Pedido não pago: botão de cobrar visível no header sem precisar expandir */}
        {!isPago && !isCancelado && pedido.total > 0 && (
          <div className="mt-2 flex items-center justify-end">
            <button
              onClick={(e) => { e.stopPropagation(); setShowPagamento(true); }}
              className="flex-shrink-0 flex items-center gap-1 text-[10px] font-black bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
            >
              <i className="ri-bank-card-line text-[10px]" />
              {formatPrice(pedido.total)}
            </button>
          </div>
        )}

        {/* Barra de progresso */}
        {statusEfetivo === 'aberto' && totalUnidades > 0 && (
          <div className="mt-2 h-1 bg-zinc-200 rounded-full overflow-hidden">
            <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${(unidadesProntas / totalUnidades) * 100}%` }} />
          </div>
        )}
        {statusEfetivo === 'pronto' && (
          <div className="mt-2 h-1 bg-green-200 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full w-full" />
          </div>
        )}
      </div>

      {/* Itens expandidos */}
      {expanded && (
        <div className="border-t border-zinc-200 pt-2.5 pb-3 bg-white/70">
          {/* Lista de itens */}
          <div className="px-3 space-y-2">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Itens do pedido</p>
            {pedido.itensDetalhes.map((item) => (
              <ItemDetalheRow
                key={item.id}
                item={item}
                entreguesLocal={entreguesLocal}
                onEntregar={handleEntregar}
                onEditar={handleEditar}
              />
            ))}
          </div>

          {/* Split Payment — seção de pagamentos detalhada */}
          {pedido.pagamentos && pedido.pagamentos.filter((pg) => !pg.is_refunded).length > 0 && (
            <div className="px-3 mt-2 pt-2 border-t border-zinc-100">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Pagamentos</p>
              <div className="space-y-2">
                {pedido.pagamentos.filter((pg) => !pg.is_refunded).map((pg) => {
                  const isDinheiro = (pg.payment_method_name ?? '').toLowerCase().includes('dinheiro');
                  const valorRecebido = isDinheiro && pg.change_amount > 0 ? pg.amount + pg.change_amount : null;
                  const canal = canalRegistro(pg);
                  return (
                    <div key={pg.id} className="bg-zinc-50 rounded-lg px-2.5 py-2 space-y-1.5">
                      {/* Linha principal: método + valor */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-zinc-700 flex items-center gap-1.5">
                          <i className={`text-zinc-400 text-xs ${isDinheiro ? 'ri-money-dollar-circle-line' : 'ri-bank-card-line'}`} />
                          {pg.payment_method_name ?? 'Pagamento'}
                        </span>
                        <span className="text-[11px] font-black text-zinc-800">{formatPrice(pg.amount)}</span>
                      </div>
                      {/* Dinheiro: valor recebido + troco */}
                      {isDinheiro && valorRecebido && (
                        <div className="flex items-center gap-3 pl-4">
                          <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                            <i className="ri-arrow-right-down-line text-zinc-400" />
                            Recebido: <span className="font-semibold text-zinc-600">{formatPrice(valorRecebido)}</span>
                          </span>
                          <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                            <i className="ri-refund-line" />
                            Troco: {formatPrice(pg.change_amount)}
                          </span>
                        </div>
                      )}
                      {/* Canal de registro + operador */}
                      <div className="flex items-center gap-1.5 flex-wrap pl-1">
                        {canal && (
                          <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${canal.color}`}>
                            <i className={`${canal.icon} text-[9px]`} />
                            {canal.label}
                          </span>
                        )}
                        {pg.operator_name && (
                          <span className="inline-flex items-center gap-1 text-[9px] text-zinc-500">
                            <i className="ri-user-line text-[9px] text-zinc-400" />
                            {pg.operator_name}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {pedido.pagamentos.filter((pg) => !pg.is_refunded).length > 1 && (
                  <div className="flex items-center justify-between text-[10px] border-t border-zinc-100 pt-1.5">
                    <span className="text-zinc-500 font-semibold">Total pago</span>
                    <span className="font-black text-emerald-700">
                      {formatPrice(pedido.pagamentos.filter((pg) => !pg.is_refunded).reduce((s, pg) => s + pg.amount, 0))}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="px-3 mt-2.5 pt-2.5 border-t border-zinc-200 space-y-2">
            {/* Botão de pagamento — todos os pedidos não pagos */}
            {!isCancelado && !isPago && !estornado && pedido.total > 0 && (
              <button
                onClick={() => setShowPagamento(true)}
                className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
              >
                <i className="ri-bank-card-line" />
                {formatPrice(pedido.total)}
              </button>
            )}

            {/* Autoatendimento pago: botão de entregar */}
            {pedido.origem === 'autoatendimento' && isPago && !isCancelado && !estornado && (
              <>
                <div className="flex items-center gap-2 py-1 px-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <i className="ri-checkbox-circle-fill text-emerald-500 text-sm" />
                  <span className="text-xs font-bold text-emerald-600 flex-1">Pagamento registrado</span>
                </div>
                {pedido.status !== 'entregue' && !todosEntreguesLocal && (
                  <button
                    onClick={handleEntregarPedidoKiosk}
                    disabled={entregandoKiosk}
                    className="w-full py-2.5 bg-zinc-900 hover:bg-black disabled:opacity-60 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
                  >
                    {entregandoKiosk ? (
                      <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Entregando...</>
                    ) : (
                      <><i className="ri-check-double-line" />Marcar Pedido Entregue</>
                    )}
                  </button>
                )}
                {(pedido.status === 'entregue' || todosEntreguesLocal) && (
                  <div className="flex items-center gap-2 py-1 px-2 bg-zinc-50 border border-zinc-200 rounded-lg">
                    <i className="ri-check-double-line text-zinc-400 text-sm" />
                    <span className="text-xs font-semibold text-zinc-500">Pedido entregue</span>
                  </div>
                )}
              </>
            )}
            <div className="flex items-center">
              <div className="flex items-center gap-1.5">
                <button onClick={() => setImprimindo(true)} title="Imprimir"
                  className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-amber-700 border border-zinc-200 hover:border-amber-300 hover:bg-amber-50 rounded-lg cursor-pointer transition-colors">
                  <i className="ri-printer-line text-sm" />
                </button>
                {!isCancelado && isPago && !estornado && (
                  <button onClick={() => setShowEstorno(true)} title="Estornar"
                    className="w-7 h-7 flex items-center justify-center text-red-400 hover:text-red-700 border border-red-200 hover:border-red-400 hover:bg-red-50 rounded-lg cursor-pointer transition-colors">
                    <i className="ri-refund-2-line text-sm" />
                  </button>
                )}
                {!isCancelado && !estornado && (statusEfetivo === 'aberto' || statusEfetivo === 'pronto') && (
                  <button onClick={() => setShowCancelamento(true)} title="Cancelar"
                    className="w-7 h-7 flex items-center justify-center text-red-400 hover:text-red-700 border border-red-200 hover:border-red-400 hover:bg-red-50 rounded-lg cursor-pointer transition-colors">
                    <i className="ri-close-circle-line text-sm" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {imprimindo && <ImprimirPedidoModal pedido={pedido} onClose={() => setImprimindo(false)} />}
      {showEstorno && <EstornoModal pedido={pedido} onClose={() => setShowEstorno(false)} onConfirmar={() => { setEstornado(true); setShowEstorno(false); }} />}
      {showCancelamento && <CancelamentoModal pedido={pedido} onClose={() => setShowCancelamento(false)} onConfirmar={() => { setCancelado(true); setShowCancelamento(false); }} />}
    </div>
    </>
  );
}

// ── Painel principal ─────────────────────────────────────────────────────────

// Filtros: Todos / Em Aberto / Novo (aguardando) / Preparo / Prontos / Entregues / Cancelados
type Filtro = 'todos' | 'aberto' | 'novo' | 'preparo' | 'pronto' | 'entregue' | 'cancelado';

// Um pedido pode aparecer em múltiplas abas quando tem itens em fases diferentes
// Ex: pedido com 1 item pronto e 1 em preparo → aparece em "Preparo" E "Prontos"
function pedidoMatchFiltro(p: PedidoRecente, filtro: Filtro): boolean {
  if (filtro === 'todos') return true;
  // Em Aberto (PDV Caixa) = pedidos que ainda precisam de cobrança do caixa.
  // Um pedido sai de "Em Aberto" quando:
  //   - Foi cancelado (não há cobrança), OU
  //   - Já foi pago (caixa não precisa mais atuar).
  // Qualquer pedido não-pago e não-cancelado está "em aberto" para o caixa,
  // independente do status na cozinha (novo/preparo/pronto/entregue).
  if (filtro === 'aberto') {
    if (p.status === 'cancelado') return false;
    if (p.pago) return false; // já pago — caixa não precisa mais cobrar
    return true; // ainda precisa de cobrança
  }
  if (filtro === 'entregue') return p.status === 'entregue';
  if (filtro === 'cancelado') return p.status === 'cancelado';
  if (filtro === 'pronto') {
    if (p.status === 'pronto') return true;
    // Pedidos ainda em andamento mas com algum item pronto
    if (p.status === 'aberto') {
      return p.itensDetalhes.some((item) => item.unidades.some((u) => u.status === 'pronto'));
    }
    return false;
  }
  if (filtro === 'preparo') {
    if (p.status !== 'aberto') return false;
    return p.itensDetalhes.some((item) => item.unidades.some((u) => u.status === 'preparo'));
  }
  if (filtro === 'novo') {
    if (p.status !== 'aberto') return false;
    return p.itensDetalhes.every((item) => item.unidades.every((u) => u.status === 'aguardando'));
  }
  return true;
}

export default function PedidosRecentesPanel() {
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const { pedidos: kdsPedidos, updateItemStatusRemote, updateUnitStatusRemote, setPedidos, reloadOrders } = useKDS();

  const allPedidos = useMemo(
    () => [...kdsPedidos]
      // Cancelados vão pro final
      .sort((a, b) => {
        const aCancelled = a.isCancelled ? 1 : 0;
        const bCancelled = b.isCancelled ? 1 : 0;
        if (aCancelled !== bCancelled) return aCancelled - bCancelled;
        // Prontos primeiro entre os não-cancelados
        if (!a.isCancelled && !b.isCancelled) {
          if (a.status === 'pronto' && b.status !== 'pronto') return -1;
          if (b.status === 'pronto' && a.status !== 'pronto') return 1;
        }
        return a.criadoEm - b.criadoEm;
      })
      .map(kdsToRecente),
    [kdsPedidos],
  );

  const handleEntregarRemote = useCallback(
    async (itemId: string, orderId: string, unidadeNumero?: number) => {
      const now = Date.now();
      // Optimistic update local
      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== orderId) return p;
          const itens = p.itens.map((item) => {
            if (item.id !== itemId) return item;
            // Se tem unidade específica, atualiza só ela
            if (unidadeNumero != null && item.unidades && item.unidades.length > 0) {
              const novasUnidades = item.unidades.map((u) =>
                u.numero === unidadeNumero
                  ? { ...u, status: 'entregue' as KDSItemStatus, entregueEm: now }
                  : u
              );
              const todasEntregues = novasUnidades.every((u) => u.status === 'entregue');
              return {
                ...item,
                unidades: novasUnidades,
                status: todasEntregues ? ('entregue' as KDSItemStatus) : item.status,
                entregueEm: todasEntregues ? now : item.entregueEm,
              };
            }
            return {
              ...item,
              status: 'entregue' as KDSItemStatus,
              entregueEm: now,
              unidades: item.unidades?.map((u) => ({
                ...u,
                status: 'entregue' as KDSItemStatus,
                entregueEm: now,
              })),
            };
          });
          const kitchenItens = itens.filter((i) => !i.semPreparo && !i.skip_kds);
          let novoStatus: KDSPedido['status'] = 'novo';
          if (itens.every((i) => i.status === 'entregue' || i.skip_kds)) novoStatus = 'entregue';
          else if (kitchenItens.every((i) => i.status === 'pronto' || i.status === 'entregue')) novoStatus = 'pronto';
          else if (kitchenItens.some((i) => i.status === 'preparo' || i.status === 'pronto')) novoStatus = 'preparo';
          return { ...p, itens, status: novoStatus };
        }),
      );
      // Persistir no banco — usa update_unit_status se tem unidade específica
      if (unidadeNumero != null) {
        await updateUnitStatusRemote(itemId, orderId, unidadeNumero, 'entregue');
      } else {
        await updateItemStatusRemote(itemId, orderId, 'entregue');
      }
    },
    [updateItemStatusRemote, updateUnitStatusRemote, setPedidos],
  );

  const pedidos = useMemo(() => {
    let filtered = allPedidos.filter((p) => pedidoMatchFiltro(p, filtro));
    // Busca por nome do cliente ou senha
    const q = busca.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((p) => {
        const nomeMatch = p.nomeCliente?.toLowerCase().includes(q);
        const senhaMatch = p.senha?.toLowerCase().includes(q);
        const mesaMatch = p.destino === 'mesa' && String(p.mesaNumero).includes(q);
        return nomeMatch || senhaMatch || mesaMatch;
      });
    }
    // Se não está no filtro cancelado especificamente, cancelados vão pro final
    if (filtro !== 'cancelado') {
      return [
        ...filtered.filter((p) => p.status !== 'cancelado'),
        ...filtered.filter((p) => p.status === 'cancelado'),
      ];
    }
    return filtered;
  }, [allPedidos, filtro, busca]);

  // Contadores por fase — usam pedidoMatchFiltro para consistência total
  const countAberto    = allPedidos.filter((p) => pedidoMatchFiltro(p, 'aberto')).length;
  const countNovo      = allPedidos.filter((p) => pedidoMatchFiltro(p, 'novo')).length;
  const countPreparo   = allPedidos.filter((p) => pedidoMatchFiltro(p, 'preparo')).length;
  const countProntos   = allPedidos.filter((p) => pedidoMatchFiltro(p, 'pronto')).length;
  const countEntregues = allPedidos.filter((p) => pedidoMatchFiltro(p, 'entregue')).length;
  const countCancelados= allPedidos.filter((p) => pedidoMatchFiltro(p, 'cancelado')).length;

  const filtros: { key: Filtro; label: string; badge?: number; activeCls?: string }[] = [
    { key: 'todos',     label: 'Todos' },
    { key: 'aberto',    label: 'Em Aberto', badge: countAberto,    activeCls: 'bg-orange-500 text-white' },
    { key: 'novo',      label: 'Novo',      badge: countNovo,      activeCls: 'bg-zinc-700 text-white' },
    { key: 'preparo',   label: 'Preparo',   badge: countPreparo,   activeCls: 'bg-amber-500 text-white' },
    { key: 'pronto',    label: 'Prontos',   badge: countProntos,   activeCls: 'bg-green-500 text-white' },
    { key: 'entregue',  label: 'Entregues', badge: countEntregues },
    { key: 'cancelado', label: 'Cancelados', badge: countCancelados },
  ];

  return (
    <div className="flex flex-col h-full bg-zinc-100">
      {countProntos > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-500 flex-shrink-0">
          <i className="ri-restaurant-2-line text-white text-sm animate-bounce" />
          <p className="text-xs font-bold text-white flex-1">
            {countProntos === 1 ? '1 pedido pronto para entregar!' : `${countProntos} pedidos prontos para entregar!`}
          </p>
        </div>
      )}

      <div className="flex gap-1 px-2 py-2.5 border-b border-zinc-200 bg-zinc-50 overflow-x-auto flex-shrink-0">
        {filtros.map(({ key, label, badge, activeCls }) => (
          <button
            key={key}
            onClick={() => setFiltro(key)}
            className={`flex-shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              filtro === key
                ? (activeCls ?? 'bg-amber-500 text-white')
                : 'bg-white text-zinc-500 hover:bg-zinc-100 border border-zinc-200'
            }`}
          >
            {label}
            {badge != null && badge > 0 && (
              <span className={`w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-black ${
                filtro === key ? 'bg-white/30 text-white' : 'bg-amber-500 text-white'
              }`}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Barra de busca */}
      <div className="px-2 py-2 border-b border-zinc-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl">
          <div className="w-4 h-4 flex items-center justify-center text-zinc-400">
            <i className="ri-search-line text-sm" />
          </div>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por cliente, senha ou mesa..."
            className="flex-1 min-w-0 bg-transparent text-xs font-medium text-zinc-700 placeholder-zinc-400 outline-none"
          />
          {busca && (
            <button
              onClick={() => setBusca('')}
              className="w-4 h-4 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer"
            >
              <i className="ri-close-line text-sm" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pt-2">
        {pedidos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-zinc-300">
            <div className="w-10 h-10 flex items-center justify-center mb-2">
              <i className="ri-file-list-3-line text-3xl" />
            </div>
            <p className="text-sm">Sem pedidos</p>
          </div>
        )}
        {pedidos.map((p) => (
          <PedidoCard
            key={p.id}
            pedido={p}
            onEntregarRemote={handleEntregarRemote}
            onEditarItem={(item, _orderId) => {
              // O próprio PedidoCard já gerencia o modal internamente
            }}
            onRecarregar={reloadOrders}
          />
        ))}
        {pedidos.length > 0 && <div className="h-2" />}
      </div>
    </div>
  );
}
