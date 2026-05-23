import { useState } from 'react';
import type { KDSPedido, KDSItem, KDSItemStatus } from '@/types/kds';
import type React from 'react';
import { getElapsedSeconds, formatElapsed, formatDuration, getSLALevel, SLA_COLORS } from '../../../hooks/useKDSTick';
import { useKDSTick } from '../../../hooks/useKDSTick';

interface Props {
  tipo: 'pronto' | 'entregue';
  pedidos: KDSPedido[];
  estacaoFiltro: string;
  onAvancarPedido: (id: string) => void;
  onAvancarItem?: (pedidoId: string, itemId: string) => void;
  onAvancarUnidade?: (pedidoId: string, itemId: string, unidadeId: string) => void;
  onAvancarTodos?: () => void;
  onClose: () => void;
}

const ORIGEM_LABEL: Record<string, { label: string; icon: string; color: string }> = {
  caixa: { label: 'Caixa', icon: 'ri-store-2-line', color: 'bg-zinc-100 text-zinc-600' },
  garcom: { label: 'Garçom', icon: 'ri-user-line', color: 'bg-amber-50 text-amber-700' },
  mesa: { label: 'Mesa', icon: 'ri-qr-code-line', color: 'bg-teal-50 text-teal-700' },
  autoatendimento: { label: 'Kiosk', icon: 'ri-tablet-line', color: 'bg-indigo-50 text-indigo-700' },
  delivery: { label: 'Delivery', icon: 'ri-bike-line', color: 'bg-orange-50 text-orange-700' },
};

const STATUS_COLORS: Record<KDSItemStatus, string> = {
  novo: 'bg-amber-100 text-amber-700',
  preparo: 'bg-yellow-100 text-yellow-700',
  pronto: 'bg-green-100 text-green-700',
  entregue: 'bg-zinc-100 text-zinc-500',
};

function DestinoStr(pedido: KDSPedido): string {
  if (pedido.destino === 'mesa') {
    if (pedido.mesaNumero != null) {
      return pedido.nomeCliente ? `Mesa ${pedido.mesaNumero} · ${pedido.nomeCliente}` : `Mesa ${pedido.mesaNumero}`;
    }
    return pedido.nomeCliente ?? 'Mesa';
  }
  if (pedido.destino === 'nome') return pedido.nomeCliente ?? '';
  if (pedido.destino === 'senha') return `Senha ${pedido.senha}`;
  if (pedido.destino === 'hora') return 'Balcão';
  if (pedido.destino === 'delivery') return `Delivery · ${pedido.nomeCliente}`;
  return '';
}

function formatTs(ts?: number) {
  if (!ts) return '--';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function deriveItemStatus(item: KDSItem): KDSItemStatus {
  // Unidades individuais têm prioridade sobre o status do item
  if (item.unidades && item.unidades.length > 0) {
    const statuses = item.unidades.map((u) => u.status);
    if (statuses.every((s) => s === 'entregue')) return 'entregue';
    if (statuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
    if (statuses.some((s) => s === 'preparo' || s === 'pronto')) return 'preparo';
    return 'novo';
  }
  if (item.partes && item.partes.length > 0) {
    const statuses = item.partes.map((p) => p.status);
    if (statuses.every((s) => s === 'entregue')) return 'entregue';
    if (statuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
    if (statuses.some((s) => s === 'preparo' || s === 'pronto')) return 'preparo';
    return 'novo';
  }
  return item.status;
}

/** Detalhe expandido de um pedido */
function PedidoDetalheExpandido({ pedido }: { pedido: KDSPedido }) {
  const now = Date.now();
  return (
    <div className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3">
      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Itens do pedido</p>
      {pedido.itens.map((item, idx) => {
        const st = deriveItemStatus(item);
        const temPartes = item.partes && item.partes.length > 0;
        const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50';
        return (
          <div key={item.id} className={`${rowBg} rounded-lg p-2.5 border border-zinc-100`}>
            <div className="flex items-start gap-2">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${
                st === 'pronto' ? 'bg-green-500' :
                st === 'preparo' ? 'bg-yellow-500' :
                st === 'entregue' ? 'bg-zinc-300' : 'bg-amber-400'
              }`} />
              <span className="text-xs font-semibold text-zinc-800 flex-1 break-words">
                {item.quantidade > 1 && <span className="text-amber-600 font-bold">{item.quantidade}x </span>}
                {item.nome}
              </span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLORS[st]}`}>
                {st === 'novo' ? 'Na fila' : st === 'preparo' ? 'Preparo' : st === 'pronto' ? 'Pronto' : 'Entregue'}
              </span>
            </div>
            {item.opcoes.length > 0 && (
              <p className="text-[10px] text-zinc-400 ml-4 mt-0.5">
                {item.opcoes.map((o) => o.opcaoNome).join(' · ')}
              </p>
            )}
            {item.observacoes.length > 0 && (
              <div className="flex flex-wrap gap-1 ml-4 mt-0.5">
                {item.observacoes.map((obs, i) => (
                  <span key={i} className="text-[9px] bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full">
                    {obs}
                  </span>
                ))}
              </div>
            )}
            {/* Timestamps do item */}
            <div className="flex flex-wrap gap-2 ml-4 mt-1.5">
              {item.entroKdsEm && (
                <span className="text-[9px] text-zinc-400">
                  <i className="ri-time-line mr-0.5 text-amber-400" />
                  KDS: {formatTs(item.entroKdsEm)}
                </span>
              )}
              {item.iniciouPreparoEm && (
                <span className="text-[9px] text-zinc-400">
                  <i className="ri-fire-line mr-0.5 text-yellow-400" />
                  Iniciou: {formatTs(item.iniciouPreparoEm)}
                  {' '}({formatDuration(Math.floor((item.iniciouPreparoEm - item.entroKdsEm) / 1000))} espera)
                </span>
              )}
              {item.ficouProntoEm && (
                <span className="text-[9px] text-zinc-400">
                  <i className="ri-check-line mr-0.5 text-green-400" />
                  Pronto: {formatTs(item.ficouProntoEm)}
                  {item.iniciouPreparoEm && ` (${formatDuration(Math.floor((item.ficouProntoEm - item.iniciouPreparoEm) / 1000))} preparo)`}
                </span>
              )}
              {item.entregueEm && (
                <span className="text-[9px] text-zinc-400">
                  <i className="ri-check-double-line mr-0.5 text-zinc-400" />
                  Entregue: {formatTs(item.entregueEm)}
                  {item.ficouProntoEm
                    ? ` (${formatDuration(Math.floor((item.entregueEm - item.ficouProntoEm) / 1000))} aguardou)`
                    : (item.semPreparo || item.skip_kds) && item.entroKdsEm
                      ? ` (${formatDuration(Math.floor((item.entregueEm - item.entroKdsEm) / 1000))} espera)`
                      : null}
                </span>
              )}
              {item.ficouProntoEm && !item.entregueEm && (
                <span className="text-[9px] font-bold text-orange-500">
                  <i className="ri-alarm-warning-line mr-0.5" />
                  Aguardando entrega há {formatDuration(Math.floor((now - item.ficouProntoEm) / 1000))}
                </span>
              )}
            </div>
            {/* Sub-partes */}
            {temPartes && item.partes && item.partes.length > 0 && (
              <div className="ml-4 mt-1.5 space-y-1">
                {item.partes.map((parte) => (
                  <div key={parte.id} className="flex items-center gap-2 text-[9px] text-zinc-500">
                    <span className={`w-1 h-1 rounded-full flex-shrink-0 ${
                      parte.status === 'pronto' ? 'bg-green-400' :
                      parte.status === 'preparo' ? 'bg-yellow-400' :
                      parte.status === 'entregue' ? 'bg-zinc-300' : 'bg-amber-300'
                    }`} />
                    <span className="font-medium">{parte.nome}</span>
                    <span className="text-zinc-400">· {parte.estacao}</span>
                    <span className={`font-bold px-1 py-0.5 rounded ${STATUS_COLORS[parte.status]}`}>
                      {parte.status === 'novo' ? 'Fila' : parte.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {item.operadorPreparo && (
              <p className="text-[9px] text-zinc-400 ml-4 mt-0.5">
                <i className="ri-user-line mr-0.5" />Operador: {item.operadorPreparo}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Chave única para seleção: pode ser itemId ou `${itemId}::u${unidadeId}`
type SelKey = string;

function makeItemKey(itemId: string) { return itemId; }
function makeUnidadeKey(itemId: string, unidadeId: string) { return `${itemId}::u${unidadeId}`; }

function PedidoRowPronto({ pedido, onAvancar, onAvancarItem, onAvancarUnidade, expanded, onToggle }: {
  pedido: KDSPedido;
  onAvancar: () => void;
  onAvancarItem: (itemId: string) => void;
  onAvancarUnidade: (itemId: string, unidadeId: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  useKDSTick();
  const now = Date.now();
  const elapsed = getElapsedSeconds(pedido.criadoEm);
  const maxSla = pedido.itens.reduce((s, i) => s + i.slaMinutos, 0);
  const slaLevel = getSLALevel(elapsed, maxSla);
  const origemCfg = ORIGEM_LABEL[pedido.origem] ?? ORIGEM_LABEL.caixa;
  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  // Apenas itens/unidades que estão PRONTOS (não entregues, não em preparo)
  // Estes são os que podem ser entregues agora
  type EntregavelItem = { key: SelKey; label: string; subLabel?: string; itemId: string; unidadeId?: string; ficouProntoEm?: number; iniciouPreparoEm?: number };
  const entregaveis: EntregavelItem[] = [];

  pedido.itens.forEach((item) => {
    const st = deriveItemStatus(item);
    if (item.unidades && item.unidades.length > 0) {
      // Mostrar unidades individuais prontas
      item.unidades.forEach((u) => {
        if (u.status === 'pronto') {
          entregaveis.push({
            key: makeUnidadeKey(item.id, u.id),
            label: item.nome,
            subLabel: `Unidade ${u.numero}${item.opcoes.length > 0 ? ' · ' + item.opcoes.map((o) => o.opcaoNome).join(' · ') : ''}`,
            itemId: item.id,
            unidadeId: u.id,
            ficouProntoEm: u.ficouProntoEm,
            iniciouPreparoEm: u.iniciouPreparoEm,
          });
        }
      });
    } else if (st === 'pronto') {
      entregaveis.push({
        key: makeItemKey(item.id),
        label: item.nome,
        subLabel: item.opcoes.length > 0 ? item.opcoes.map((o) => o.opcaoNome).join(' · ') : undefined,
        itemId: item.id,
        ficouProntoEm: item.ficouProntoEm,
        iniciouPreparoEm: item.iniciouPreparoEm,
      });
    }
  });

  // Itens não prontos (em preparo/novo) — para mostrar como "aguardando"
  const itensAguardando = pedido.itens.filter((item) => {
    const st = deriveItemStatus(item);
    if (item.unidades && item.unidades.length > 0) {
      return item.unidades.some((u) => u.status !== 'pronto' && u.status !== 'entregue');
    }
    return st !== 'pronto' && st !== 'entregue';
  });

  const [selecionados, setSelecionados] = useState<Set<SelKey>>(new Set());

  const toggleKey = (key: SelKey) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selecionarTodos = () => setSelecionados(new Set(entregaveis.map((e) => e.key)));
  const deselecionarTodos = () => setSelecionados(new Set());
  const todosSelecionados = entregaveis.length > 0 && selecionados.size === entregaveis.length;

  const handleEntregarSelecionados = (e: React.MouseEvent) => {
    e.stopPropagation();
    const selecionadosList = entregaveis.filter((ev) => selecionados.has(ev.key));
    const todosEntregaveis = selecionadosList.length === entregaveis.length && itensAguardando.length === 0;

    if (todosEntregaveis) {
      // Todos os itens prontos selecionados e não há nada aguardando → entrega pedido inteiro
      onAvancar();
    } else {
      // Entrega seletiva
      selecionadosList.forEach((ev) => {
        if (ev.unidadeId) {
          onAvancarUnidade(ev.itemId, ev.unidadeId);
        } else {
          onAvancarItem(ev.itemId);
        }
      });
      setSelecionados(new Set());
    }
  };

  // Timer desde que o primeiro item ficou pronto
  const prontoHa = entregaveis.reduce((min, ev) => {
    const t = ev.ficouProntoEm;
    return t && t < min ? t : min;
  }, now);
  const esperandoEntrega = prontoHa < now ? Math.floor((now - prontoHa) / 1000) : 0;
  const slaEspera = getSLALevel(esperandoEntrega, 3);

  // Badge de status do pedido
  const pedidoMisto = itensAguardando.length > 0 && entregaveis.length > 0;

  return (
    <div className={`bg-white rounded-xl mb-2 overflow-hidden border-l-4 ${pedidoMisto ? 'border-l-amber-400' : 'border-l-green-500'}`}>
      {/* Banner de pedido misto */}
      {pedidoMisto && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-100">
          <div className="w-3 h-3 flex items-center justify-center flex-shrink-0">
            <i className="ri-time-line text-amber-500 text-xs" />
          </div>
          <p className="text-[10px] font-bold text-amber-700 flex-1">
            Pedido parcialmente pronto — {itensAguardando.length} item{itensAguardando.length > 1 ? 'ns' : ''} ainda em preparo
          </p>
          <span className="text-[9px] font-bold text-amber-500 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
            PARCIAL
          </span>
        </div>
      )}

      {/* Header — clicável para expandir */}
      <button
        onClick={onToggle}
        className="w-full flex items-start justify-between gap-2 p-3 hover:bg-zinc-50 transition-colors cursor-pointer text-left"
      >
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <span className="font-black text-zinc-900 text-base">#{pedido.numero}</span>
          <span className="text-xs font-semibold text-zinc-600">{DestinoStr(pedido)}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${origemCfg.color}`}>
            <i className={`${origemCfg.icon} text-[10px]`} />
            {origemCfg.label}
            {pedido.origem === 'garcom' && pedido.garcomNome && ` · ${pedido.garcomNome}`}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          <span className={`text-xs font-bold tabular-nums ${SLA_COLORS[slaLevel]}`} title="Tempo total do pedido">
            <i className="ri-time-line mr-0.5 text-[9px]" />
            {formatElapsed(elapsed)}
          </span>
          {esperandoEntrega > 0 && (
            <span className={`text-[10px] font-bold tabular-nums ${SLA_COLORS[slaEspera]}`} title="Aguardando entrega">
              <i className="ri-restaurant-2-line mr-0.5 text-[9px]" />
              Pronto há {formatDuration(esperandoEntrega)}
            </span>
          )}
        </div>
        <div className={`w-4 h-4 flex items-center justify-center text-zinc-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}>
          <i className="ri-arrow-down-s-line text-base" />
        </div>
      </button>

      {/* Lista de itens/unidades prontos com checkboxes */}
      <div className="px-3 pb-2">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
            {entregaveis.length} pronto{entregaveis.length !== 1 ? 's' : ''} para entregar
          </span>
          {entregaveis.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); todosSelecionados ? deselecionarTodos() : selecionarTodos(); }}
              className="text-[10px] font-semibold text-green-600 hover:text-green-700 cursor-pointer whitespace-nowrap"
            >
              {todosSelecionados ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
          )}
        </div>

        <div className="space-y-1">
          {entregaveis.map((ev) => {
            const sel = selecionados.has(ev.key);
            const isUnidade = !!ev.unidadeId;
            const prontoHaSegundos = ev.ficouProntoEm
              ? Math.max(0, Math.floor((now - ev.ficouProntoEm) / 1000))
              : 0;
            return (
              <button
                key={ev.key}
                onClick={(e) => { e.stopPropagation(); toggleKey(ev.key); }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border transition-all text-left cursor-pointer ${
                  sel ? 'border-green-400 bg-green-50' : 'border-zinc-200 bg-white hover:border-zinc-300'
                }`}
              >
                {/* Checkbox visual */}
                <div className={`w-4 h-4 flex items-center justify-center rounded border-2 flex-shrink-0 transition-colors ${
                  sel ? 'bg-green-500 border-green-500' : 'border-zinc-300 bg-white'
                }`}>
                  {sel && <i className="ri-check-line text-white text-[9px]" />}
                </div>

                {/* Nome e sub-label */}
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-zinc-800">{ev.label}</span>
                  {ev.subLabel && (
                    <p className="text-[10px] text-zinc-400 truncate">{ev.subLabel}</p>
                  )}
                </div>

                {/* Badge + timer */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {prontoHaSegundos > 0 && (
                    <span className="text-[9px] font-bold tabular-nums whitespace-nowrap text-cyan-600">
                      Pronto há {formatDuration(prontoHaSegundos)}
                    </span>
                  )}
                  {isUnidade && (
                    <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                      unidade
                    </span>
                  )}
                  <span className="text-[9px] font-bold text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                    Pronto
                  </span>
                </div>
              </button>
            );
          })}

          {/* Itens ainda em preparo — exibidos como informativos */}
          {itensAguardando.map((item) => {
            const st = deriveItemStatus(item);
            const hasUnidades = item.unidades && item.unidades.length > 0;
            const unidadesAguardando = hasUnidades
              ? item.unidades!.filter((u) => u.status !== 'pronto' && u.status !== 'entregue')
              : [];
            return (
              <div
                key={item.id}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-zinc-100 bg-zinc-50 opacity-60"
              >
                <div className="w-4 h-4 flex items-center justify-center rounded border-2 border-zinc-200 bg-zinc-100 flex-shrink-0">
                  <i className="ri-time-line text-zinc-400 text-[9px]" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-zinc-500">{item.nome}</span>
                  {hasUnidades && unidadesAguardando.length > 0 && (
                    <p className="text-[10px] text-zinc-400">
                      {unidadesAguardando.length} unidade{unidadesAguardando.length > 1 ? 's' : ''} em preparo
                    </p>
                  )}
                </div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${
                  st === 'preparo' ? 'text-yellow-700 bg-yellow-100' : 'text-amber-700 bg-amber-100'
                }`}>
                  {st === 'preparo' ? 'Preparo' : 'Na fila'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detalhes expandidos */}
      {expanded && (
        <div className="px-3 pb-3">
          <PedidoDetalheExpandido pedido={pedido} />
        </div>
      )}

      {/* Botão entregar selecionados */}
      <div className="px-3 pb-3">
        <button
          onClick={handleEntregarSelecionados}
          disabled={selecionados.size === 0}
          className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-1.5"
        >
          <i className="ri-check-double-line" />
          {selecionados.size === 0
            ? 'Selecione itens para entregar'
            : selecionados.size === entregaveis.length && itensAguardando.length === 0
              ? 'Entregar Pedido Completo'
              : `Entregar ${selecionados.size} item${selecionados.size > 1 ? 'ns' : ''}`}
        </button>
      </div>
    </div>
  );
}

function PedidoRowEntregue({ pedido, expanded, onToggle }: {
  pedido: KDSPedido;
  expanded: boolean;
  onToggle: () => void;
}) {
  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);
  const origemCfg = ORIGEM_LABEL[pedido.origem] ?? ORIGEM_LABEL.caixa;
  const entregueEm = pedido.itens.reduce((latest, i) => Math.max(latest, i.entregueEm ?? 0), 0);

  // Tempo total cozinha
  const inicioKds = pedido.itens.reduce((min, i) => Math.min(min, i.entroKdsEm), Date.now());
  const tempoCozinhaTotal = entregueEm > 0 ? Math.floor((entregueEm - inicioKds) / 1000) : null;

  // Tempo espera entrega (pronto → entregue)
  const prontoTs = pedido.itens.reduce((min, i) => {
    const t = i.ficouProntoEm;
    return t && t < min ? t : min;
  }, entregueEm || Date.now());
  const tempoEspera = prontoTs < (entregueEm || Date.now()) ? Math.floor(((entregueEm || Date.now()) - prontoTs) / 1000) : null;

  return (
    <div className="bg-white rounded-xl border-l-4 border-l-zinc-300 opacity-80 mb-2 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-start justify-between gap-2 p-3 hover:bg-zinc-50 cursor-pointer transition-colors text-left"
      >
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <span className="font-black text-zinc-700 text-base">#{pedido.numero}</span>
          <span className="text-xs font-semibold text-zinc-500">{DestinoStr(pedido)}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${origemCfg.color}`}>
            <i className={`${origemCfg.icon} text-[10px]`} />
            {origemCfg.label}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          <span className="text-[10px] text-zinc-400">{totalItens} itens</span>
          {entregueEm > 0 && (
            <span className="text-[10px] text-zinc-400">
              <i className="ri-check-double-line mr-0.5 text-green-500" />
              {formatTs(entregueEm)}
            </span>
          )}
          {tempoCozinhaTotal !== null && (
            <span className="text-[9px] text-zinc-400" title="Tempo total na cozinha">
              <i className="ri-timer-line mr-0.5" />{formatDuration(tempoCozinhaTotal)}
            </span>
          )}
          {tempoEspera !== null && tempoEspera > 0 && (
            <span className="text-[9px] text-zinc-400" title="Tempo que esperou para ser entregue após ficar pronto">
              <i className="ri-restaurant-2-line mr-0.5" />Espera: {formatDuration(tempoEspera)}
            </span>
          )}
        </div>
        <div className={`w-4 h-4 flex items-center justify-center text-zinc-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}>
          <i className="ri-arrow-down-s-line text-base" />
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          <PedidoDetalheExpandido pedido={pedido} />
          {pedido.itens[0]?.quemEntregou && (
            <p className="text-[10px] text-zinc-400 mt-2">
              <i className="ri-user-line mr-0.5" />Entregue por: {pedido.itens[0].quemEntregou}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function KDSListPanel({ tipo, pedidos, estacaoFiltro, onAvancarPedido, onAvancarItem, onAvancarUnidade, onAvancarTodos, onClose }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const pedidosFiltrados = pedidos.filter((p) => {
    if (estacaoFiltro === 'Todas') return true;
    return p.itens.some((i) =>
      i.partes ? i.partes.some((pt) => pt.estacao === estacaoFiltro) : i.estacao === estacaoFiltro,
    );
  });

  const isPronto = tipo === 'pronto';
  const headerColor = isPronto ? 'bg-green-500' : 'bg-zinc-500';
  const icon = isPronto ? 'ri-check-line' : 'ri-check-double-line';
  const title = isPronto ? 'Pedidos Prontos' : 'Pedidos Entregues';

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop — não fecha ao clicar (só fecha pelo botão X) */}
      <div className="flex-1 bg-black/60" />
      {/* Panel */}
      <div className="w-[420px] flex flex-col bg-zinc-100 shadow-xl">
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 ${headerColor}`}>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 flex items-center justify-center">
              <i className={`${icon} text-white text-base`} />
            </div>
            <span className="text-white font-bold text-sm">{title}</span>
            <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {pedidosFiltrados.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isPronto && pedidosFiltrados.length > 1 && onAvancarTodos && (
              <button
                onClick={onAvancarTodos}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-green-700 text-xs font-bold rounded-lg cursor-pointer whitespace-nowrap transition-all hover:bg-green-50 hover:scale-105 active:scale-95"
                title="Marcar todos os pedidos prontos como entregues"
              >
                <i className="ri-check-double-line text-sm" />
                Entregar Todos
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center text-white/80 hover:text-white hover:bg-white/20 rounded-lg cursor-pointer transition-colors"
            >
              <i className="ri-close-line text-base" />
            </button>
          </div>
        </div>

        {/* Legenda dos timers */}
        {isPronto && pedidosFiltrados.length > 0 && (
          <div className="px-4 py-2 bg-white border-b border-zinc-200 flex items-center gap-4 text-[10px] text-zinc-500">
            <span className="flex items-center gap-1">
              <i className="ri-time-line text-zinc-400" />
              Tempo total do pedido
            </span>
            <span className="flex items-center gap-1">
              <i className="ri-restaurant-2-line text-orange-400" />
              Aguardando entrega
            </span>
            <span className="text-zinc-400">· Clique para ver detalhes</span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3">
          {pedidosFiltrados.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
              <div className="w-10 h-10 flex items-center justify-center mb-2">
                <i className={`${icon} text-3xl`} />
              </div>
              <p className="text-xs">Nenhum pedido aqui</p>
            </div>
          ) : isPronto ? (
            pedidosFiltrados.map((p) => (
              <PedidoRowPronto
                key={p.id}
                pedido={p}
                onAvancar={() => onAvancarPedido(p.id)}
                onAvancarItem={(itemId) => onAvancarItem?.(p.id, itemId)}
                onAvancarUnidade={(itemId, unidadeId) => onAvancarUnidade?.(p.id, itemId, unidadeId)}
                expanded={expandedId === p.id}
                onToggle={() => toggleExpand(p.id)}
              />
            ))
          ) : (
            pedidosFiltrados.map((p) => (
              <PedidoRowEntregue
                key={p.id}
                pedido={p}
                expanded={expandedId === p.id}
                onToggle={() => toggleExpand(p.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
