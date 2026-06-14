import { useState, useMemo } from 'react';
import type { PedidoRecente } from '@/types/pdv';
import { formatOrderNumber } from '@/lib/statusMappers';
import { TempoCell } from './SlaCell';
import { isQRUniversal, clienteNome, origemLabelFor } from './utils';

const DB_STATUS_LABEL: Record<string, string> = {
  new: 'Na Fila', preparing: 'Em preparo', ready: 'Pronto',
  delivered: 'Entregue', cancelled: 'Cancelado',
};
const STATUS_LABEL: Record<string, string> = {
  aberto: 'Em aberto', pronto: 'Pronto', entregue: 'Entregue', cancelado: 'Cancelado',
};
const STATUS_STYLE: Record<string, string> = {
  aberto: 'bg-amber-100 text-amber-700 border-amber-200',
  pronto: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  entregue: 'bg-sky-100 text-sky-700 border-sky-200',
  cancelado: 'bg-red-100 text-red-700 border-red-200',
  new: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  preparing: 'bg-amber-100 text-amber-700 border-amber-200',
  ready: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  delivered: 'bg-sky-100 text-sky-700 border-sky-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
};
const STATUS_DOT: Record<string, string> = {
  aberto: 'bg-amber-400', pronto: 'bg-emerald-400', entregue: 'bg-sky-400', cancelado: 'bg-red-400',
  new: 'bg-zinc-400', preparing: 'bg-amber-400', ready: 'bg-emerald-400',
  delivered: 'bg-sky-400', cancelled: 'bg-red-400',
};
const ORIGEM_LABEL: Record<string, string> = {
  caixa: 'PDV Caixa', garcom: 'PDV Garçom', mesa: 'Mesa (QR)', autoatendimento: 'Autoatendimento',
  delivery: 'Delivery',
};
const ORIGEM_ICON: Record<string, string> = {
  caixa: 'ri-store-line', garcom: 'ri-user-star-line',
  mesa: 'ri-qr-code-line', autoatendimento: 'ri-tablet-line',
  delivery: 'ri-e-bike-2-line',
};

const UNIDADE_STATUS_LABEL: Record<string, string> = {
  aguardando: 'Na Fila',
  preparo: 'Em preparo',
  pronto: 'Pronto',
  entregue: 'Entregue',
};
const UNIDADE_STATUS_STYLE: Record<string, string> = {
  aguardando: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  preparo: 'bg-amber-100 text-amber-700 border-amber-200',
  pronto: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  entregue: 'bg-sky-100 text-sky-700 border-sky-200',
};
const UNIDADE_STATUS_DOT: Record<string, string> = {
  aguardando: 'bg-zinc-400',
  preparo: 'bg-amber-400',
  pronto: 'bg-emerald-400',
  entregue: 'bg-sky-400',
};

function contarUnidadesPorStatus(pedido: PedidoRecente): { status: string; count: number }[] {
  if (pedido.status === 'cancelado' || pedido.status === 'cancelled') return [];

  const contagem: Record<string, number> = {};
  let totalUnidades = 0;

  pedido.itensDetalhes.forEach((item) => {
    const unidades = item.unidades ?? [];
    if (unidades.length === 0) {
      // Fallback: usa o status do item como uma unidade
      const s =
        item.status === 'pronto' ? 'pronto'
        : item.status === 'entregue' || item.status === 'delivered' ? 'entregue'
        : item.status === 'preparo' || item.status === 'preparing' ? 'preparo'
        : 'aguardando';
      contagem[s] = (contagem[s] ?? 0) + item.quantidade;
      totalUnidades += item.quantidade;
      return;
    }
    unidades.forEach((u) => {
      // Unidades sem cozinha que estão aguardando já estão "prontas" (não precisam de preparo)
      const s = (u.semCozinha && u.status === 'aguardando') ? 'pronto' : u.status;
      contagem[s] = (contagem[s] ?? 0) + 1;
      totalUnidades += 1;
    });
  });

  const ordem = ['aguardando', 'preparo', 'pronto', 'entregue'];
  return ordem
    .filter((s) => (contagem[s] ?? 0) > 0)
    .map((s) => ({ status: s, count: contagem[s] }));
}

function StatusBadges({ pedido }: { pedido: PedidoRecente }) {
  if (pedido.status === 'cancelado' || pedido.status === 'cancelled') {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-red-100 text-red-700 border-red-200 whitespace-nowrap">
          Cancelado
        </span>
      </div>
    );
  }

  const badges = contarUnidadesPorStatus(pedido);
  if (badges.length === 0) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-zinc-400" />
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-zinc-100 text-zinc-600 border-zinc-200 whitespace-nowrap">
          {DB_STATUS_LABEL[pedido.status] ?? STATUS_LABEL[pedido.status] ?? pedido.status}
        </span>
      </div>
    );
  }

  // Se só tem um status, mostra compacto
  if (badges.length === 1) {
    const b = badges[0];
    return (
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${UNIDADE_STATUS_DOT[b.status] ?? 'bg-zinc-400'}`} />
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${UNIDADE_STATUS_STYLE[b.status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200'}`}>
          {UNIDADE_STATUS_LABEL[b.status] ?? b.status}
          {b.count > 1 && ` (${b.count})`}
        </span>
      </div>
    );
  }

  // Múltiplos status: mostra todos lado a lado
  return (
    <div className="flex flex-wrap items-center gap-1">
      {badges.map((b) => (
        <span
          key={b.status}
          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${UNIDADE_STATUS_STYLE[b.status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200'}`}
          title={`${b.count} unidade${b.count > 1 ? 's' : ''} ${UNIDADE_STATUS_LABEL[b.status] ?? b.status}`}
        >
          <div className={`w-1 h-1 rounded-full flex-shrink-0 ${UNIDADE_STATUS_DOT[b.status] ?? 'bg-zinc-400'}`} />
          {b.count} {UNIDADE_STATUS_LABEL[b.status] ?? b.status}
        </span>
      ))}
    </div>
  );
}

const HOJE = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

function formatarDataExibicao(data: string): string {
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

function destinoLabel(pedido: PedidoRecente): string {
  if (isQRUniversal(pedido)) return `Senha ${pedido.participantToken}`;
  if (pedido.destino === 'mesa') return `Mesa ${pedido.mesaNumero ?? ''}`;
  if (pedido.destino === 'nome') return pedido.nomeCliente ?? '—';
  if (pedido.destino === 'delivery') return pedido.nomeCliente ?? 'Delivery';
  if (pedido.destino === 'senha') return `Senha ${pedido.senha ?? ''}`;
  return 'Na hora';
}

function clientesMesaLabel(pedido: PedidoRecente): string | null {
  // QR universal: nome do cliente vai como linha secundária (a senha é o destino principal)
  if (isQRUniversal(pedido)) {
    const nome = clienteNome(pedido);
    return nome || null;
  }
  if (pedido.destino !== 'mesa') return null;
  if (pedido.nomeCliente && !/^Mesa\s*\d*$/i.test(pedido.nomeCliente.trim())) {
    return pedido.nomeCliente;
  }
  return null;
}

interface PedidosListaProps {
  pedidos: PedidoRecente[];
  loading: boolean;
  onSelectPedido: (id: string) => void;
}

type SortKey = 'numero' | 'sessao' | 'status' | 'pagamento' | 'destino' | 'origem' | 'itens' | 'tempo' | 'hora' | 'total';

const COLUNAS: { label: string; key: SortKey }[] = [
  { label: '#', key: 'numero' },
  { label: 'Sessão', key: 'sessao' },
  { label: 'Status', key: 'status' },
  { label: 'Pagamento', key: 'pagamento' },
  { label: 'Destino', key: 'destino' },
  { label: 'Origem', key: 'origem' },
  { label: 'Itens', key: 'itens' },
  { label: 'Tempo', key: 'tempo' },
  { label: 'Hora', key: 'hora' },
  { label: 'Total', key: 'total' },
];

export default function PedidosLista({ pedidos, loading, onSelectPedido }: PedidosListaProps) {
  const [sortBy, setSortBy] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const pedidosOrdenados = useMemo(() => {
    if (!sortBy) return pedidos;
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (p: PedidoRecente): string | number => {
      switch (sortBy) {
        case 'numero': return p.numero;
        case 'sessao': return p.session_number ?? '';
        case 'status': return p.status;
        case 'pagamento': return p.pago ? 1 : 0;
        case 'destino': return destinoLabel(p).toLowerCase();
        case 'origem': return origemLabelFor(p).toLowerCase();
        case 'itens': return p.itensDetalhes.reduce((a, i) => a + i.quantidade, 0);
        case 'tempo': return p.minutosAtras;
        case 'hora': return p._criadoTs ? new Date(p._criadoTs).getTime() : 0;
        case 'total': return p.total;
        default: return 0;
      }
    };
    return [...pedidos].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), 'pt-BR') * dir;
    });
  }, [pedidos, sortBy, sortDir]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
        <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
          <i className="ri-loader-4-line animate-spin text-3xl mb-3 text-amber-400" />
          <p className="text-sm font-semibold">Carregando pedidos da sessão...</p>
        </div>
      </div>
    );
  }

  if (pedidos.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
        <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
          <i className="ri-file-list-3-line text-4xl mb-3" />
          <p className="text-sm font-semibold">Nenhum pedido encontrado</p>
          <p className="text-xs mt-1">Tente ajustar os filtros de busca</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
      {/* Desktop table header */}
      <div
        className="hidden lg:grid gap-x-2 px-4 py-3 border-b border-zinc-100 bg-zinc-50"
        style={{ gridTemplateColumns: '2fr 1.2fr 1.5fr 1.4fr 1.8fr 1.2fr 0.8fr 1.4fr 1.1fr 1.2fr' }}
      >
        {COLUNAS.map(({ label, key }) => (
          <button
            key={key}
            type="button"
            onClick={() => toggleSort(key)}
            className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide cursor-pointer hover:text-zinc-600 transition-colors ${label === 'Total' ? 'justify-end' : ''} ${sortBy === key ? 'text-amber-600' : 'text-zinc-400'}`}
            title={`Ordenar por ${label}`}
          >
            {label}
            <i className={`text-[10px] ${sortBy === key ? (sortDir === 'asc' ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line') : 'ri-arrow-up-down-line opacity-30'}`} />
          </button>
        ))}
      </div>

      <div className="divide-y divide-zinc-50">
        {pedidosOrdenados.map((pedido) => {
          const isGrupo = (pedido.pedidoIds ?? []).length > 1;
          const qtdPedidosGrupo = pedido.pedidoIds?.length ?? 1;
          const itensProntosReal = pedido.itensDetalhes.reduce((acc, item) => {
            const prontas = item.unidades?.filter((u) => u.status === 'pronto' || u.status === 'entregue').length ?? 0;
            return acc + prontas;
          }, 0);
          const itensTotalReal = pedido.itensDetalhes.reduce((acc, item) => acc + item.quantidade, 0);
          const prontosPctReal = itensTotalReal > 0 ? Math.round((itensProntosReal / itensTotalReal) * 100) : 0;

          const isAtrasado = pedido.atrasado === true;

          return (
            <div
              key={pedido.id}
              className={`cursor-pointer transition-colors ${isAtrasado ? 'hover:bg-red-50 border-l-2 border-red-400' : 'hover:bg-zinc-50'} ${pedido.status === 'cancelado' || pedido.status === 'cancelled' ? 'opacity-60 bg-red-50/30' : ''}`}
              onClick={() => onSelectPedido(pedido.id)}
            >
              {/* Desktop row */}
              <div
                className="hidden lg:grid gap-x-2 px-4 py-3.5 items-center"
                style={{ gridTemplateColumns: '2fr 1.2fr 1.5fr 1.4fr 1.8fr 1.2fr 0.8fr 1.4fr 1.1fr 1.2fr' }}
              >
                {/* # */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-zinc-800 whitespace-nowrap">
                      {isGrupo
                        ? `${qtdPedidosGrupo} pedidos`
                        : formatOrderNumber(pedido.numeroStr ?? pedido.numeroCodigo, pedido.numero)}
                    </span>
                    {isGrupo && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">
                        <i className="ri-stack-line text-[9px]" />
                        Unificado
                      </span>
                    )}
                  </div>
                  {isGrupo && (
                    <p className="text-[10px] text-zinc-400 mt-0.5 truncate" title={pedido.numeroCodigo}>
                      {pedido.numeroCodigo}
                    </p>
                  )}
                </div>

                {/* Sessão */}
                <div>
                  {pedido.session_number ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 border border-zinc-200 whitespace-nowrap" title={pedido.session_number}>
                      <i className="ri-archive-line text-[9px]" />
                      {pedido.session_number}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-300">—</span>
                  )}
                </div>

                {/* Status */}
                <div>
                  <StatusBadges pedido={pedido} />
                </div>

                {/* Pagamento */}
                <div>
                  {pedido.status === 'cancelado' || pedido.status === 'cancelled' ? (
                    <span className="text-xs text-zinc-300">—</span>
                  ) : pedido.pago ? (
                    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap w-fit">
                      <i className="ri-check-line" />Pago
                    </span>
                  ) : (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 whitespace-nowrap w-fit">Pendente</span>
                  )}
                </div>

                {/* Destino */}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-800 truncate">{destinoLabel(pedido)}</p>
                  {clientesMesaLabel(pedido) && (
                    <p className="text-[10px] text-zinc-400 truncate flex items-center gap-0.5">
                      <i className="ri-user-line text-[9px]" />
                      {clientesMesaLabel(pedido)}
                    </p>
                  )}
                  {pedido.garcomNome && <p className="text-[10px] text-zinc-400 truncate">{pedido.garcomNome}</p>}
                </div>

                {/* Origem */}
                <div>
                  <div className="flex items-center gap-1">
                    <i className={`${ORIGEM_ICON[pedido.origem]} text-zinc-400 text-sm flex-shrink-0`} />
                    <span className="text-[10px] text-zinc-500 font-medium hidden xl:block truncate">{origemLabelFor(pedido)}</span>
                  </div>
                </div>

                {/* Itens */}
                <div>
                  <span className="text-xs text-zinc-600 font-semibold">{itensProntosReal}/{itensTotalReal}</span>
                  {pedido.status !== 'cancelado' && pedido.status !== 'cancelled' && (
                    <div className="h-1 bg-zinc-100 rounded-full overflow-hidden w-full mt-0.5">
                      <div
                        className={`h-full rounded-full ${pedido.status === 'entregue' || pedido.status === 'delivered' ? 'bg-sky-400' : 'bg-emerald-400'}`}
                        style={{ width: `${prontosPctReal}%` }}
                      />
                    </div>
                  )}
                </div>

                {/* Tempo total — tempo real */}
                <div>
                  <TempoCell pedido={pedido} />
                </div>

                {/* Hora */}
                <div>
                  {pedido.dataPedido && pedido.dataPedido !== HOJE && (
                    <p className="text-[10px] text-zinc-400">{formatarDataExibicao(pedido.dataPedido)}</p>
                  )}
                  <p className="text-xs font-semibold text-zinc-700">{pedido.criadoEm}</p>
                </div>

                {/* Total */}
                <div className="text-right">
                  {pedido.status === 'cancelado' || pedido.status === 'cancelled' ? (
                    <span className="text-xs font-semibold text-red-400 whitespace-nowrap">Cancelado</span>
                  ) : (
                    <p className="text-sm font-black text-zinc-900 whitespace-nowrap">R$ {pedido.total.toFixed(2)}</p>
                  )}
                </div>
              </div>

              {/* Mobile card */}
              <div className="lg:hidden px-4 py-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-zinc-800">
                      {isGrupo
                        ? `${qtdPedidosGrupo} pedidos`
                        : formatOrderNumber(pedido.numeroStr ?? pedido.numeroCodigo, pedido.numero)}
                    </span>
                    {isGrupo && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                        <i className="ri-stack-line text-[9px]" />
                        Unificado
                      </span>
                    )}
                    <StatusBadges pedido={pedido} />
                    {pedido.pago && (
                      <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                        <i className="ri-check-line text-[9px]" />Pago
                      </span>
                    )}
                  </div>
                  {pedido.status === 'cancelado' || pedido.status === 'cancelled' ? (
                    <span className="text-xs font-semibold text-red-400 whitespace-nowrap">Cancelado</span>
                  ) : (
                    <p className="text-sm font-black text-zinc-900 whitespace-nowrap">R$ {pedido.total.toFixed(2)}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
                  <span className="flex items-center gap-1">
                    <i className={`${ORIGEM_ICON[pedido.origem]} text-zinc-400`} />
                    {origemLabelFor(pedido)}
                  </span>
                  <span>{destinoLabel(pedido)}</span>
                  {pedido.session_number && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 border border-zinc-200">
                      <i className="ri-archive-line text-[9px]" />
                      {pedido.session_number}
                    </span>
                  )}
                  {pedido.garcomNome && <span className="text-zinc-400">{pedido.garcomNome}</span>}
                  <span className="text-zinc-400">{pedido.criadoEm}</span>
                  <span>{itensProntosReal}/{itensTotalReal} itens</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}