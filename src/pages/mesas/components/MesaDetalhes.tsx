import { useState, useEffect, useCallback, useMemo } from 'react';
import QRCodeImport from 'react-qr-code';
const QRCode = ((QRCodeImport as unknown as { default: typeof QRCodeImport }).default || QRCodeImport) as typeof QRCodeImport;
import type { Mesa } from '../../../contexts/MesasContext';
import { useKDS } from '@/contexts/KDSContext';
import type { KDSPedido, KDSItem } from '@/types/kds';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getAppBaseUrl } from '@/lib/appUrl';

// ── Validação de pedidos antes de fechar mesa ──────────────────────────────────

interface PedidoPendente {
  numero: string;
  status: string;
  pago: boolean;
}

async function verificarPedidosPendentes(tableSessionId: string): Promise<PedidoPendente[]> {
  // Busca todos os pedidos não cancelados da sessão de mesa
  const { data: pedidos } = await supabase
    .from('orders')
    .select('id, number, status')
    .eq('table_session_id', tableSessionId)
    .neq('status', 'cancelled')
    .eq('is_draft', false);

  if (!pedidos || pedidos.length === 0) return [];

  // Busca pagamentos existentes para esses pedidos
  const orderIds = pedidos.map((p) => p.id);
  const { data: pagamentos } = await supabase
    .from('payments')
    .select('order_id')
    .in('order_id', orderIds)
    .eq('is_refunded', false);

  const paidSet = new Set((pagamentos ?? []).map((p) => p.order_id));

  // Retorna pedidos que NÃO estão entregues OU não estão pagos
  return pedidos
    .filter((p) => p.status !== 'delivered' || !paidSet.has(p.id))
    .map((p) => ({
      numero: p.number,
      status: p.status,
      pago: paidSet.has(p.id),
    }));
}

interface Props {
  mesa: Mesa;
  todasMesas: Mesa[];
  onClose: () => void;
  onUpdate: (id: string, changes: Partial<Mesa>) => void;
  onTransferir: (fromId: string, toId: string) => void;
  onFecharMesa: () => void;
  onEditarMesa: () => void;
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatTime(ts: number | string) {
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number) {
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m > 0 ? `${m}m` : ''}`;
}

type StatusOpt = Mesa['status'];
const STATUS_OPTS: { value: StatusOpt; label: string }[] = [
  { value: 'livre', label: 'Livre' },
  { value: 'ocupada', label: 'Ocupada' },
  { value: 'reservada', label: 'Reservada' },
  { value: 'bloqueada', label: 'Bloqueada' },
];
const STATUS_BG: Record<string, string> = {
  livre: 'bg-green-100 text-green-700',
  ocupada: 'bg-amber-100 text-amber-700',
  reservada: 'bg-zinc-100 text-zinc-600',
  bloqueada: 'bg-red-100 text-red-500',
};

// ── KDS Status helpers ─────────────────────────────────────────────────────────

const KDS_STATUS_CFG: Record<string, { label: string; color: string; dot: string }> = {
  novo:     { label: 'Na fila',   color: 'bg-zinc-100 text-zinc-600',   dot: 'bg-zinc-400' },
  preparo:  { label: 'Preparo',   color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  pronto:   { label: 'Pronto',    color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  entregue: { label: 'Entregue',  color: 'bg-zinc-50 text-zinc-400',    dot: 'bg-zinc-300' },
};

const ORIGEM_CFG: Record<string, { label: string; icon: string; color: string }> = {
  caixa:          { label: 'Caixa',    icon: 'ri-store-2-line',  color: 'bg-zinc-100 text-zinc-600' },
  garcom:         { label: 'Garçom',   icon: 'ri-user-line',     color: 'bg-amber-50 text-amber-700' },
  mesa:           { label: 'Mesa',     icon: 'ri-qr-code-line',  color: 'bg-teal-50 text-teal-700' },
  autoatendimento:{ label: 'Kiosk',    icon: 'ri-tablet-line',   color: 'bg-indigo-50 text-indigo-700' },
  delivery:       { label: 'Delivery', icon: 'ri-bike-line',     color: 'bg-orange-50 text-orange-700' },
};

// ── Clientes da sessão (Supabase) ──────────────────────────────────────────────

interface ClienteMesa {
  id: string;
  nome: string;
  telefone?: string;
  isResponsavel: boolean;
  joinedAt: string;
  visitCount?: number;
  totalGasto?: number;
}

function useClientesMesa(mesa: Mesa) {
  const { user } = useAuth();
  const [clientes, setClientes] = useState<ClienteMesa[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!mesa.tableSessionId || !user?.tenantId) { setClientes([]); return; }
    setLoading(true);
    try {
      const { data: sessionData } = await supabase
        .from('table_sessions')
        .select('responsible_customer_id')
        .eq('id', mesa.tableSessionId)
        .maybeSingle();

      const { data: sessionCustomers } = await supabase
        .from('table_session_customers')
        .select('customer_id, joined_at')
        .eq('table_session_id', mesa.tableSessionId);

      const customerIds = (sessionCustomers ?? []).map((sc) => sc.customer_id).filter(Boolean);
      let customersMap: Record<string, { name: string; phone?: string; visit_count?: number; total_spent?: number }> = {};

      if (customerIds.length > 0) {
        const { data: customersData } = await supabase
          .from('customers')
          .select('id, name, phone, visit_count, total_spent')
          .in('id', customerIds);
        (customersData ?? []).forEach((c) => {
          customersMap[c.id] = { name: c.name, phone: c.phone, visit_count: c.visit_count, total_spent: c.total_spent };
        });
      }

      const responsavelId = sessionData?.responsible_customer_id;
      const list: ClienteMesa[] = (sessionCustomers ?? []).map((sc) => {
        const info = customersMap[sc.customer_id] ?? {};
        return {
          id: sc.customer_id,
          nome: info.name ?? 'Cliente',
          telefone: info.phone,
          isResponsavel: sc.customer_id === responsavelId,
          joinedAt: sc.joined_at,
          visitCount: info.visit_count,
          totalGasto: info.total_spent ? Number(info.total_spent) : undefined,
        };
      }).sort((a, b) => (b.isResponsavel ? 1 : 0) - (a.isResponsavel ? 1 : 0));

      setClientes(list);
    } catch (e) {
      console.error('[MesaDetalhes] useClientesMesa error:', e);
    } finally {
      setLoading(false);
    }
  }, [mesa.tableSessionId, user?.tenantId]);

  useEffect(() => { load(); }, [load]);

  return { clientes, loading };
}

// ── Item ranking helper ────────────────────────────────────────────────────────

function buildItemRanking(pedidos: KDSPedido[]) {
  const map: Record<string, { quantidade: number; total: number }> = {};
  pedidos.forEach((p) => {
    if (p.isCancelled) return;
    p.itens.forEach((item) => {
      if (!map[item.nome]) map[item.nome] = { quantidade: 0, total: 0 };
      map[item.nome].quantidade += item.quantidade;
      map[item.nome].total += (item.item_price ?? 0) * item.quantidade;
    });
  });
  return Object.entries(map)
    .map(([nome, v]) => ({ nome, ...v }))
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 5);
}

// ── KDS Item Status Badge ──────────────────────────────────────────────────────

function ItemStatusBadge({ item }: { item: KDSItem }) {
  const cfg = KDS_STATUS_CFG[item.status] ?? KDS_STATUS_CFG.novo;
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${item.status === 'preparo' ? 'animate-pulse' : ''}`} />
      {cfg.label}
    </span>
  );
}

// ── Pedido KDS Card (expandível) ───────────────────────────────────────────────

function PedidoKDSCard({ pedido }: { pedido: KDSPedido }) {
  const [expanded, setExpanded] = useState(false);
  const origemCfg = ORIGEM_CFG[pedido.origem] ?? ORIGEM_CFG.caixa;
  const isCancelled = pedido.isCancelled;

  const statusPedido = pedido.status;
  const pedidoCfg = KDS_STATUS_CFG[statusPedido === 'em_rota' ? 'pronto' : statusPedido] ?? KDS_STATUS_CFG.novo;

  const itensAtivos = pedido.itens.filter((i) => i.status !== 'entregue');
  const itensEntregues = pedido.itens.filter((i) => i.status === 'entregue');

  return (
    <div className={`rounded-xl border transition-all ${isCancelled ? 'bg-red-50 border-red-100 opacity-60' : 'bg-white border-zinc-100'}`}>
      {/* Header do pedido */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 p-2.5 text-left cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-zinc-800">{pedido.numeroStr || `#${pedido.numero}`}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${origemCfg.color}`}>
              <i className={`${origemCfg.icon} text-[9px]`} />
              {origemCfg.label}
            </span>
            {!isCancelled && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1 ${pedidoCfg.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${pedidoCfg.dot} ${statusPedido === 'preparo' ? 'animate-pulse' : ''}`} />
                {pedidoCfg.label}
              </span>
            )}
            {isCancelled && (
              <span className="text-[9px] font-bold text-red-500 bg-red-100 px-1.5 py-0.5 rounded-full">Cancelado</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-[10px] text-zinc-400">
              <i className="ri-time-line mr-0.5" />{formatTime(pedido.criadoEm)}
            </p>
            {pedido.nomeCliente && (
              <p className="text-[10px] text-zinc-400 truncate">
                <i className="ri-user-line mr-0.5" />{pedido.nomeCliente}
              </p>
            )}
            {pedido.garcomNome && (
              <p className="text-[10px] text-zinc-400 truncate">
                <i className="ri-service-line mr-0.5" />{pedido.garcomNome}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <p className={`text-sm font-bold ${isCancelled ? 'text-red-400 line-through' : 'text-zinc-800'}`}>
            {formatPrice(pedido.totalAmount ?? 0)}
          </p>
          {expanded ? <i className="ri-arrow-up-s-line text-zinc-400 text-sm" /> : <i className="ri-arrow-down-s-line text-zinc-400 text-sm" />}
        </div>
      </button>

      {/* Itens expandidos */}
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-1 border-t border-zinc-50 pt-2">
          {/* Itens ativos */}
          {itensAtivos.map((item) => (
            <div key={item.id} className="flex items-start gap-2 py-1">
              <span className="text-[10px] font-bold text-zinc-500 w-5 flex-shrink-0">{item.quantidade}x</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-zinc-700 truncate">{item.nome}</p>
                {item.opcoes.length > 0 && (
                  <p className="text-[9px] text-zinc-400 truncate">
                    {item.opcoes.map((o) => o.opcaoNome).join(', ')}
                  </p>
                )}
                {item.observacoes.length > 0 && (
                  <p className="text-[9px] text-amber-600 truncate">
                    <i className="ri-chat-1-line mr-0.5" />{item.observacoes.join(', ')}
                  </p>
                )}
              </div>
              <ItemStatusBadge item={item} />
            </div>
          ))}
          {/* Itens entregues (colapsados) */}
          {itensEntregues.length > 0 && (
            <div className="flex items-center gap-1 pt-1 border-t border-zinc-50">
              <i className="ri-check-double-line text-zinc-300 text-xs" />
              <p className="text-[9px] text-zinc-300">{itensEntregues.length} item(ns) entregue(s)</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function MesaDetalhes({ mesa, todasMesas, onClose, onUpdate, onTransferir, onFecharMesa, onEditarMesa }: Props) {
  const [aba, setAba] = useState<'sessao' | 'info' | 'transferir' | 'qr'>('sessao');
  const [nomeCliente, setNomeCliente] = useState(mesa.clienteNome ?? '');
  const [garcom, setGarcom] = useState(mesa.garcomNome ?? '');
  const [status, setStatus] = useState<StatusOpt>(mesa.status);
  const [mesaDestino, setMesaDestino] = useState('');
  const [showQRSucesso, setShowQRSucesso] = useState(false);
  const [showFecharConfirm, setShowFecharConfirm] = useState(false);
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [nomeSalvoOk, setNomeSalvoOk] = useState(false);
  const [verificandoFechamento, setVerificandoFechamento] = useState(false);
  const [pedidosPendentes, setPedidosPendentes] = useState<PedidoPendente[] | null>(null);

  // ── Dados em tempo real do KDS ──
  const { pedidos: todosPedidos } = useKDS();

  // Filtrar pedidos desta mesa em tempo real
  const pedidosMesa = useMemo(() => {
    return todosPedidos.filter((p) => p.mesaNumero === mesa.numero && !p.isCancelled);
  }, [todosPedidos, mesa.numero]);

  const pedidosCancelados = useMemo(() => {
    return todosPedidos.filter((p) => p.mesaNumero === mesa.numero && p.isCancelled);
  }, [todosPedidos, mesa.numero]);

  // Métricas em tempo real
  const metricas = useMemo(() => {
    const ativos = pedidosMesa;
    const totalGeral = ativos.reduce((s, p) => s + (p.totalAmount ?? 0), 0);
    const ticketMedio = ativos.length > 0 ? totalGeral / ativos.length : 0;
    const duracaoMs = mesa.abertaEmTimestamp ? Date.now() - mesa.abertaEmTimestamp : 0;

    // Contagem por status KDS
    const novos = ativos.filter((p) => p.status === 'novo').length;
    const emPreparo = ativos.filter((p) => p.status === 'preparo').length;
    const prontos = ativos.filter((p) => p.status === 'pronto').length;
    const entregues = ativos.filter((p) => p.status === 'entregue').length;

    // Itens com atenção (prontos para entregar)
    const itensProntos = ativos.flatMap((p) => p.itens.filter((i) => i.status === 'pronto'));
    const itensEmPreparo = ativos.flatMap((p) => p.itens.filter((i) => i.status === 'preparo'));

    return { totalGeral, ticketMedio, duracaoMs, novos, emPreparo, prontos, entregues, itensProntos, itensEmPreparo };
  }, [pedidosMesa, mesa.abertaEmTimestamp]);

  // Ranking de itens
  const itemRanking = useMemo(() => buildItemRanking(pedidosMesa), [pedidosMesa]);

  // Clientes da sessão (Supabase)
  const { clientes, loading: loadingClientes } = useClientesMesa(mesa);

  const handleSalvar = async () => {
    setSalvandoNome(true);
    // Se mesa está ocupada e tem sessão aberta, salva o customer_name no banco
    if (mesa.tableSessionId) {
      await supabase
        .from('table_sessions')
        .update({ customer_name: nomeCliente.trim() || null })
        .eq('id', mesa.tableSessionId);
    }
    onUpdate(mesa.id, { status, clienteNome: nomeCliente.trim() || undefined, garcomNome: garcom || undefined });
    setSalvandoNome(false);
    setNomeSalvoOk(true);
    setTimeout(() => setNomeSalvoOk(false), 2500);
  };

  const handleTransferir = () => {
    if (!mesaDestino) return;
    onTransferir(mesa.id, mesaDestino);
    onClose();
  };

  const mesasLivres = todasMesas.filter((m) => m.id !== mesa.id && m.status === 'livre');

  // QR URL construído diretamente do qrToken vindo do contexto (via fn_get_tables)
  const qrUrl = mesa.qrToken
    ? `${getAppBaseUrl()}/mesa-qr/${mesa.qrToken}`
    : '';

  const tabs = [
    { id: 'sessao',     label: 'Sessão',    icon: 'ri-live-line' },
    { id: 'info',       label: 'Editar',    icon: 'ri-settings-3-line' },
    { id: 'transferir', label: 'Mover',     icon: 'ri-arrow-left-right-line' },
    { id: 'qr',         label: 'QR',        icon: 'ri-qr-code-line' },
  ];

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 bg-zinc-50 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="font-bold text-zinc-900 text-base">Mesa {mesa.numero}</h2>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BG[mesa.status] ?? STATUS_BG.livre}`}>
              {STATUS_OPTS.find((s) => s.value === mesa.status)?.label ?? mesa.status}
            </span>
            {/* Indicador ao vivo */}
            {mesa.status === 'ocupada' && (
              <span className="flex items-center gap-1 text-[9px] text-green-600 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                ao vivo
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500">{mesa.capacidade} lug. · {mesa.area ?? 'Salão'}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onEditarMesa} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-amber-100 cursor-pointer text-amber-500 transition-colors" title="Editar mesa">
            <i className="ri-pencil-line text-sm" />
          </button>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400 transition-colors">
            <i className="ri-close-line text-base" />
          </button>
        </div>
      </div>

      {/* Banner de consumo (se ocupada) */}
      {mesa.status === 'ocupada' && (
        <div className="mx-3 mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-[10px] text-amber-600 font-semibold uppercase tracking-wide">Consumo em aberto</p>
              <p className="text-xl font-black text-amber-700">{formatPrice(metricas.totalGeral || mesa.totalConsumo || 0)}</p>
            </div>
            <div className="text-right">
              {metricas.duracaoMs > 0 && (
                <p className="text-xs text-amber-600 font-semibold">
                  <i className="ri-time-line mr-0.5" />{formatDuration(metricas.duracaoMs)}
                </p>
              )}
              <p className="text-[10px] text-amber-500">{pedidosMesa.length} pedido{pedidosMesa.length !== 1 ? 's' : ''}</p>
            </div>
          </div>

          {/* Mini métricas de status KDS */}
          <div className="grid grid-cols-4 gap-1">
            {[
              { label: 'Na fila', count: metricas.novos, color: 'text-zinc-500', bg: 'bg-zinc-100' },
              { label: 'Preparo', count: metricas.emPreparo, color: 'text-amber-700', bg: 'bg-amber-100' },
              { label: 'Prontos', count: metricas.prontos, color: 'text-green-700', bg: 'bg-green-100' },
              { label: 'Entregues', count: metricas.entregues, color: 'text-zinc-400', bg: 'bg-zinc-50' },
            ].map((m) => (
              <div key={m.label} className={`${m.bg} rounded-lg p-1.5 text-center`}>
                <p className={`text-sm font-black ${m.color}`}>{m.count}</p>
                <p className={`text-[8px] font-semibold ${m.color}`}>{m.label}</p>
              </div>
            ))}
          </div>

          {/* Alertas de atenção */}
          {metricas.itensProntos.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 bg-green-100 border border-green-200 rounded-lg px-2 py-1.5">
              <i className="ri-alarm-warning-line text-green-600 text-sm" />
              <p className="text-[10px] font-bold text-green-700">
                {metricas.itensProntos.length} item(ns) pronto(s) para entregar!
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 px-1 flex-shrink-0 mt-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setAba(tab.id as typeof aba)}
            className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[10px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              aba === tab.id ? 'text-amber-600 border-b-2 border-amber-500' : 'text-zinc-400 hover:text-zinc-700'
            }`}
          >
            <i className={`${tab.icon} text-xs`} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── ABA SESSÃO ── */}
        {aba === 'sessao' && (
          <div className="p-3 space-y-4">
            {mesa.status !== 'ocupada' ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-2xl mb-3">
                  <i className="ri-table-2 text-2xl text-zinc-300" />
                </div>
                <p className="text-sm font-semibold text-zinc-500">Mesa livre</p>
                <p className="text-xs text-zinc-400 mt-1">Nenhuma sessão ativa no momento</p>
              </div>
            ) : (
              <>
                {/* Clientes na mesa */}
                {loadingClientes ? (
                  <div className="flex items-center gap-2 py-2">
                    <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs text-zinc-400">Carregando clientes...</p>
                  </div>
                ) : clientes.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                      <i className="ri-group-line mr-1" />Pessoas na Mesa ({clientes.length})
                    </p>
                    <div className="space-y-1.5">
                      {clientes.map((c) => (
                        <div key={c.id} className={`flex items-center gap-2.5 p-2.5 rounded-xl border ${c.isResponsavel ? 'bg-amber-50 border-amber-200' : 'bg-zinc-50 border-zinc-100'}`}>
                          <div className={`w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0 text-sm font-black ${c.isResponsavel ? 'bg-amber-500 text-white' : 'bg-zinc-200 text-zinc-600'}`}>
                            {c.nome.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-bold text-zinc-800 truncate">{c.nome}</p>
                              {c.isResponsavel && (
                                <span className="text-[8px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
                                  Responsável
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {c.telefone && <p className="text-[10px] text-zinc-400">{c.telefone}</p>}
                              {c.visitCount != null && (
                                <p className="text-[10px] text-zinc-400">
                                  <i className="ri-repeat-line mr-0.5" />{c.visitCount}ª visita
                                </p>
                              )}
                            </div>
                          </div>
                          {c.totalGasto != null && c.totalGasto > 0 && (
                            <div className="text-right flex-shrink-0">
                              <p className="text-[10px] text-zinc-400">Histórico</p>
                              <p className="text-xs font-bold text-zinc-700">{formatPrice(c.totalGasto)}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pedidos em tempo real do KDS */}
                {pedidosMesa.length > 0 ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                        <i className="ri-receipt-line mr-1" />Pedidos em Tempo Real
                      </p>
                      <span className="flex items-center gap-1 text-[9px] text-green-600 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        live
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {pedidosMesa.map((p) => (
                        <PedidoKDSCard key={p.id} pedido={p} />
                      ))}
                    </div>

                    {/* Total */}
                    <div className="mt-2 p-2.5 bg-zinc-900 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-zinc-300">Total da Sessão</span>
                        {metricas.ticketMedio > 0 && (
                          <p className="text-[9px] text-zinc-500">Ticket médio: {formatPrice(metricas.ticketMedio)}</p>
                        )}
                      </div>
                      <span className="text-sm font-black text-white">{formatPrice(metricas.totalGeral)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-xl mb-2">
                      <i className="ri-inbox-line text-xl text-zinc-300" />
                    </div>
                    <p className="text-xs text-zinc-400">Nenhum pedido ainda</p>
                    <p className="text-[10px] text-zinc-300 mt-0.5">Os pedidos aparecerão aqui em tempo real</p>
                  </div>
                )}

                {/* Pedidos cancelados (colapsados) */}
                {pedidosCancelados.length > 0 && (
                  <div className="border border-red-100 rounded-xl p-2.5">
                    <p className="text-[10px] font-bold text-red-400 mb-1.5">
                      <i className="ri-close-circle-line mr-1" />{pedidosCancelados.length} pedido(s) cancelado(s)
                    </p>
                    <div className="space-y-1">
                      {pedidosCancelados.map((p) => (
                        <div key={p.id} className="flex items-center justify-between text-[10px] text-red-400 opacity-70">
                          <span className="line-through">{p.numeroStr || `#${p.numero}`}</span>
                          <span className="line-through">{formatPrice(p.totalAmount ?? 0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Itens mais pedidos */}
                {itemRanking.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                      <i className="ri-fire-line mr-1 text-amber-500" />Mais Pedidos nesta Mesa
                    </p>
                    <div className="space-y-1">
                      {itemRanking.map((item, idx) => (
                        <div key={item.nome} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-zinc-50">
                          <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[9px] font-black flex-shrink-0 ${idx === 0 ? 'bg-amber-500 text-white' : idx === 1 ? 'bg-zinc-300 text-zinc-700' : 'bg-zinc-100 text-zinc-500'}`}>
                            {idx + 1}
                          </span>
                          <span className="text-xs text-zinc-700 flex-1 truncate">{item.nome}</span>
                          <span className="text-[10px] font-bold text-zinc-500 flex-shrink-0">{item.quantidade}x</span>
                          <span className="text-[10px] font-bold text-zinc-700 flex-shrink-0">{formatPrice(item.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Botão fechar mesa */}
                <div className="pt-2">
                  {/* Alerta de pedidos pendentes */}
                  {pedidosPendentes && pedidosPendentes.length > 0 && (
                    <div className="mb-3 bg-red-50 border border-red-200 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 flex items-center justify-center bg-red-100 rounded-full flex-shrink-0">
                          <i className="ri-error-warning-line text-red-600 text-sm" />
                        </div>
                        <p className="text-xs font-bold text-red-700">
                          Não é possível fechar a mesa
                        </p>
                      </div>
                      <p className="text-[11px] text-red-600 mb-2">
                        {pedidosPendentes.length} pedido{pedidosPendentes.length !== 1 ? 's' : ''} ainda {pedidosPendentes.length !== 1 ? 'precisam' : 'precisa'} ser {pedidosPendentes.length !== 1 ? 'pagos e entregues' : 'pago e entregue'}:
                      </p>
                      <div className="space-y-1">
                        {pedidosPendentes.map((p) => (
                          <div key={p.numero} className="flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 border border-red-100">
                            <span className="text-xs font-bold text-zinc-800">{p.numero}</span>
                            <div className="flex items-center gap-1.5">
                              {!p.pago && (
                                <span className="text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                  <i className="ri-money-dollar-circle-line mr-0.5" />Não pago
                                </span>
                              )}
                              {p.status !== 'delivered' && (
                                <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                  <i className="ri-time-line mr-0.5" />
                                  {p.status === 'new' ? 'Na fila' : p.status === 'preparing' ? 'Em preparo' : p.status === 'ready' ? 'Pronto' : p.status}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => setPedidosPendentes(null)}
                        className="mt-2 w-full text-[10px] text-red-500 hover:text-red-700 cursor-pointer transition-colors"
                      >
                        Fechar aviso
                      </button>
                    </div>
                  )}

                  {!showFecharConfirm ? (
                    <button
                      onClick={async () => {
                        if (!mesa.tableSessionId) { onFecharMesa(); return; }
                        setVerificandoFechamento(true);
                        setPedidosPendentes(null);
                        try {
                          const pendentes = await verificarPedidosPendentes(mesa.tableSessionId);
                          if (pendentes.length > 0) {
                            setPedidosPendentes(pendentes);
                          } else {
                            setShowFecharConfirm(true);
                          }
                        } finally {
                          setVerificandoFechamento(false);
                        }
                      }}
                      disabled={verificandoFechamento}
                      className="w-full py-2.5 border-2 border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-60 font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors text-sm flex items-center justify-center gap-2"
                    >
                      {verificandoFechamento ? (
                        <><i className="ri-loader-4-line animate-spin" />Verificando pedidos...</>
                      ) : (
                        <><i className="ri-door-open-line" />Fechar Mesa</>
                      )}
                    </button>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-5 h-5 flex items-center justify-center bg-green-100 rounded-full flex-shrink-0">
                          <i className="ri-checkbox-circle-line text-green-600 text-xs" />
                        </div>
                        <p className="text-xs font-bold text-green-700">Todos os pedidos pagos e entregues</p>
                      </div>
                      <p className="text-xs font-bold text-red-700 mb-2 text-center">Confirmar fechamento da Mesa {mesa.numero}?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setShowFecharConfirm(false); setPedidosPendentes(null); }}
                          className="flex-1 py-2 border border-zinc-200 text-zinc-600 text-xs font-semibold rounded-lg cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => { setShowFecharConfirm(false); setPedidosPendentes(null); onFecharMesa(); }}
                          className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                        >
                          Fechar Mesa
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── ABA EDITAR ── */}
        {aba === 'info' && (
          <div className="p-3 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Status da Mesa</label>
              <div className="grid grid-cols-2 gap-2">
                {STATUS_OPTS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setStatus(opt.value)}
                    className={`py-2 rounded-lg border-2 text-sm font-semibold transition-colors cursor-pointer ${
                      status === opt.value ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Nome do cliente — editável mesmo com mesa aberta */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                <i className="ri-user-line mr-1 text-amber-500" />
                Nome do Cliente / Grupo
                {mesa.status === 'ocupada' && (
                  <span className="ml-1.5 text-[9px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full font-normal">
                    salvo na sessão
                  </span>
                )}
              </label>
              <input
                type="text"
                value={nomeCliente}
                onChange={(e) => { setNomeCliente(e.target.value); setNomeSalvoOk(false); }}
                placeholder="Ex: João, Família Silva..."
                className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Garçom Responsável</label>
              <input
                type="text"
                value={garcom}
                onChange={(e) => setGarcom(e.target.value)}
                placeholder="Nome do garçom..."
                className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            {nomeSalvoOk && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <i className="ri-checkbox-circle-line text-green-500" />
                <span className="text-xs text-green-700 font-semibold">Alterações salvas com sucesso!</span>
              </div>
            )}
            <button
              onClick={handleSalvar}
              disabled={salvandoNome}
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-semibold rounded-lg cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
            >
              {salvandoNome ? (
                <><i className="ri-loader-4-line animate-spin" />Salvando...</>
              ) : (
                <><i className="ri-save-line" />Salvar Alterações</>
              )}
            </button>
            {mesa.status === 'ocupada' && (
              <button
                onClick={async () => {
                  if (!mesa.tableSessionId) { onFecharMesa(); return; }
                  setVerificandoFechamento(true);
                  setPedidosPendentes(null);
                  try {
                    const pendentes = await verificarPedidosPendentes(mesa.tableSessionId);
                    if (pendentes.length > 0) {
                      setPedidosPendentes(pendentes);
                      setAba('sessao'); // volta para aba sessão para mostrar o alerta
                    } else {
                      setShowFecharConfirm(true);
                      setAba('sessao');
                    }
                  } finally {
                    setVerificandoFechamento(false);
                  }
                }}
                disabled={verificandoFechamento}
                className="w-full py-2.5 border-2 border-red-300 text-red-500 hover:bg-red-50 disabled:opacity-60 font-semibold rounded-lg cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
              >
                {verificandoFechamento ? (
                  <><i className="ri-loader-4-line animate-spin" />Verificando...</>
                ) : (
                  <><i className="ri-door-open-line mr-1.5" />Fechar Mesa</>
                )}
              </button>
            )}
          </div>
        )}

        {/* ── ABA TRANSFERIR ── */}
        {aba === 'transferir' && (
          <div className="p-3 space-y-4">
            <div className="bg-zinc-50 rounded-xl p-3 text-sm text-zinc-600">
              <i className="ri-information-line mr-1.5 text-amber-500" />
              Move todos os pedidos e consumo da Mesa {mesa.numero} para outra mesa livre.
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-2">Mesa de Destino</label>
              {mesasLivres.length === 0 ? (
                <p className="text-sm text-zinc-400 text-center py-4">Nenhuma mesa livre disponível</p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {mesasLivres.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMesaDestino(m.id)}
                      className={`py-3 rounded-lg border-2 font-bold text-sm transition-colors cursor-pointer ${
                        mesaDestino === m.id ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-zinc-200 text-zinc-700 hover:border-amber-300'
                      }`}
                    >
                      {m.numero}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {mesaDestino && (
              <button
                onClick={handleTransferir}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg cursor-pointer whitespace-nowrap transition-colors"
              >
                <i className="ri-arrow-left-right-line mr-1.5" />
                Transferir para Mesa {todasMesas.find((m) => m.id === mesaDestino)?.numero}
              </button>
            )}
          </div>
        )}

        {/* ── ABA QR CODE ── */}
        {aba === 'qr' && (
          <div className="p-3 flex flex-col items-center text-center space-y-4">
            {qrUrl ? (
              <>
                <div className="bg-white border-4 border-zinc-900 rounded-2xl p-4">
                  <QRCode value={qrUrl} size={150} level="M" style={{ display: 'block' }} />
                </div>
                <div>
                  <p className="font-bold text-zinc-900">Mesa {mesa.numero}</p>
                  <p className="text-[10px] text-zinc-400 font-mono break-all mt-0.5 max-w-[200px]">{qrUrl}</p>
                </div>
                <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs text-amber-700 font-semibold">
                    <i className="ri-information-line mr-1" />
                    QR Code da Mesa — cliente aponta o celular e acessa o cardápio digital
                  </p>
                </div>
                <div className="flex gap-2 w-full">
                  <button
                    onClick={() => { setShowQRSucesso(true); setTimeout(() => setShowQRSucesso(false), 2000); }}
                    className="flex-1 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-semibold rounded-lg cursor-pointer whitespace-nowrap transition-colors"
                  >
                    <i className="ri-printer-line mr-1.5" />Imprimir
                  </button>
                  <button
                    onClick={() => { navigator.clipboard.writeText(qrUrl).catch(() => {}); setShowQRSucesso(true); setTimeout(() => setShowQRSucesso(false), 2000); }}
                    className="flex-1 py-2.5 border border-zinc-200 text-zinc-700 text-sm font-semibold rounded-lg cursor-pointer whitespace-nowrap hover:bg-zinc-50 transition-colors"
                  >
                    <i className="ri-links-line mr-1.5" />Copiar Link
                  </button>
                </div>
                {showQRSucesso && (
                  <div className="w-full bg-green-50 border border-green-200 rounded-lg py-2 text-green-700 text-sm font-semibold">
                    <i className="ri-check-line mr-1" />Ação concluída!
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-2xl mb-3">
                  <i className="ri-qr-code-line text-2xl text-zinc-300" />
                </div>
                <p className="text-sm font-semibold text-zinc-500">QR Code não disponível</p>
                <p className="text-xs text-zinc-400 mt-1">Regenere o QR Code nas configurações de mesas.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
