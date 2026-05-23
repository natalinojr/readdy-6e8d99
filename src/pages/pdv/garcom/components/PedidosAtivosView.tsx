import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useKDS } from '../../../../contexts/KDSContext';
import { useAuth } from '../../../../contexts/AuthContext';
import type { KDSPedido, KDSItem, KDSItemStatus, KDSUnidade } from '@/types/kds';
import type { Rodada, PedidoAvulso } from '../types';
import PagamentoRapidoModal from '@/components/feature/PagamentoRapidoModal';
import EditarItemPedidoAtivoModal from './EditarItemPedidoAtivoModal';

interface Props {
  pedidosMesa: Record<string, Rodada[]>;
  pedidosAvulsos: PedidoAvulso[];
  onIrParaMesa: (mesaId: string) => void;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ── Cronômetro live ──────────────────────────────────────────────────────────

function useCronometro(criadoEm: number, ativo: boolean) {
  const [segundos, setSegundos] = useState(() => Math.floor((Date.now() - criadoEm) / 1000));
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    setSegundos(Math.floor((Date.now() - criadoEm) / 1000));
    if (!ativo) return;
    ref.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [criadoEm, ativo]);
  return segundos;
}

function formatCronometro(totalSegundos: number) {
  const h = Math.floor(totalSegundos / 3600);
  const m = Math.floor((totalSegundos % 3600) / 60);
  const s = totalSegundos % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function cronometroColor(totalSegundos: number) {
  const min = totalSegundos / 60;
  if (min < 15) return 'bg-green-100 text-green-700 border-green-200';
  if (min < 30) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

function CronometroBadge({ criadoEm, ativo }: { criadoEm: number; ativo: boolean }) {
  const segundos = useCronometro(criadoEm, ativo);
  return (
    <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${cronometroColor(segundos)}`}>
      <i className="ri-time-line text-[10px]" />
      {formatCronometro(segundos)}
    </span>
  );
}

// ── Configs ──────────────────────────────────────────────────────────────────

const STATUS_LEFT_BORDER: Record<string, string> = {
  novo:     'border-l-[3px] border-l-zinc-300',
  preparo:  'border-l-[3px] border-l-amber-400',
  pronto:   'border-l-[3px] border-l-green-500',
  entregue: 'border-l-[3px] border-l-zinc-200',
};

const STATUS_CARD_BG: Record<string, string> = {
  novo:     'bg-white',
  preparo:  'bg-white',
  pronto:   'bg-green-50/40',
  entregue: 'bg-zinc-50/80',
};

const ITEM_STATUS_CFG: Record<string, { label: string; icon: string; badgeCls: string; borderCls: string; bgCls: string }> = {
  novo:     { label: 'Aguardando', icon: 'ri-time-line',            badgeCls: 'bg-zinc-100 text-zinc-500 border-zinc-200',   borderCls: 'border-l-[3px] border-l-zinc-300',  bgCls: 'bg-white'       },
  preparo:  { label: 'Em preparo', icon: 'ri-fire-line',            badgeCls: 'bg-amber-100 text-amber-700 border-amber-300', borderCls: 'border-l-[3px] border-l-amber-400', bgCls: 'bg-amber-50/30' },
  pronto:   { label: 'Pronto',     icon: 'ri-check-double-line',    badgeCls: 'bg-green-100 text-green-700 border-green-300', borderCls: 'border-l-[3px] border-l-green-500', bgCls: 'bg-green-50/50' },
  entregue: { label: 'Entregue',   icon: 'ri-checkbox-circle-fill', badgeCls: 'bg-zinc-100 text-zinc-400 border-zinc-200',   borderCls: 'border-l-[3px] border-l-zinc-200',  bgCls: 'bg-zinc-50/60'  },
};

const UNIDADE_STATUS_CFG: Record<string, { icon: string; color: string }> = {
  novo:     { icon: 'ri-time-line',            color: 'text-zinc-400'  },
  preparo:  { icon: 'ri-fire-line',            color: 'text-amber-500' },
  pronto:   { icon: 'ri-check-double-line',    color: 'text-green-500' },
  entregue: { icon: 'ri-checkbox-circle-fill', color: 'text-green-600' },
};

const ORIGEM_CFG: Record<string, { label: string; icon: string; color: string }> = {
  caixa:           { label: 'Caixa',          icon: 'ri-safe-2-line',       color: 'bg-amber-50  text-amber-700  border-amber-200'  },
  garcom:          { label: 'Garçom',          icon: 'ri-walk-line',         color: 'bg-sky-50    text-sky-700    border-sky-200'    },
  mesa:            { label: 'Mesa',            icon: 'ri-restaurant-2-line', color: 'bg-violet-50 text-violet-700 border-violet-200' },
  autoatendimento: { label: 'Autoatendimento', icon: 'ri-tablet-line',       color: 'bg-teal-50   text-teal-700   border-teal-200'   },
};

type FiltroOrigem = 'todos' | 'caixa' | 'garcom' | 'mesa' | 'autoatendimento';
type FiltroStatus = 'todos' | 'aberto' | 'novo' | 'preparo' | 'pronto';

// ── Informações de pagamento ─────────────────────────────────────────────────

const CANAL_CFG: Record<string, { label: string; icon: string; color: string }> = {
  caixa:           { label: 'Caixa',          icon: 'ri-safe-2-line',       color: 'bg-amber-50 text-amber-700 border-amber-200'  },
  garcom:          { label: 'Garçom',          icon: 'ri-walk-line',         color: 'bg-sky-50 text-sky-700 border-sky-200'        },
  mesa:            { label: 'Mesa',            icon: 'ri-restaurant-2-line', color: 'bg-violet-50 text-violet-700 border-violet-200' },
  delivery:        { label: 'Delivery',        icon: 'ri-e-bike-2-line',     color: 'bg-orange-50 text-orange-700 border-orange-200' },
  autoatendimento: { label: 'Autoatendimento', icon: 'ri-tablet-line',       color: 'bg-teal-50 text-teal-700 border-teal-200'     },
};

const METHOD_ICON: Record<string, string> = {
  dinheiro: 'ri-money-dollar-circle-line',
  credito:  'ri-bank-card-line',
  debito:   'ri-bank-card-2-line',
  pix:      'ri-qr-code-line',
  vale:     'ri-coupon-3-line',
};

function getMethodIcon(name: string | null): string {
  if (!name) return 'ri-money-dollar-circle-line';
  const n = name.toLowerCase();
  if (n.includes('dinheiro') || n.includes('espécie') || n.includes('especie')) return METHOD_ICON.dinheiro;
  if (n.includes('crédito') || n.includes('credito')) return METHOD_ICON.credito;
  if (n.includes('débito') || n.includes('debito')) return METHOD_ICON.debito;
  if (n.includes('pix')) return METHOD_ICON.pix;
  if (n.includes('vale') || n.includes('voucher')) return METHOD_ICON.vale;
  return 'ri-bank-card-line';
}

function isCash(name: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes('dinheiro') || n.includes('espécie') || n.includes('especie') || n.includes('cash');
}

function getCanalLabel(pag: import('@/types/kds').KDSPagamento, origemPedido: string): { label: string; icon: string; color: string } {
  if (pag.cash_register_id) return CANAL_CFG.caixa;
  const origem = (pag.origin_type ?? origemPedido ?? '').toLowerCase();
  return CANAL_CFG[origem] ?? CANAL_CFG.caixa;
}

interface PagamentoInfoProps {
  pagamentos?: import('@/types/kds').KDSPagamento[];
  origem: string;
}

function PagamentoInfo({ pagamentos, origem }: PagamentoInfoProps) {
  const ativos = (pagamentos ?? []).filter((p) => !p.is_refunded);
  if (ativos.length === 0) {
    return (
      <div className="px-3 pt-2 mt-1 border-t border-zinc-100 flex items-center gap-2">
        <i className="ri-checkbox-circle-fill text-emerald-500 text-sm" />
        <span className="text-xs font-bold text-emerald-600">Pagamento registrado</span>
      </div>
    );
  }

  const totalPago = ativos.reduce((s, p) => s + p.amount, 0);
  const isSplit = ativos.length > 1;

  return (
    <div className="px-3 pt-2 mt-1 border-t border-zinc-100 space-y-1.5">
      {ativos.map((pag, idx) => {
        const canalCfg = getCanalLabel(pag, origem);
        const cash = isCash(pag.payment_method_name);
        return (
          <div key={pag.id ?? idx} className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-2.5 py-2 space-y-1.5">
            {/* Linha topo: ícone método + nome + canal */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="w-5 h-5 flex items-center justify-center">
                <i className={`${getMethodIcon(pag.payment_method_name)} text-emerald-600 text-sm`} />
              </div>
              <span className="text-xs font-bold text-emerald-700">
                {pag.payment_method_name ?? 'Pagamento'}
              </span>
              <span className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${canalCfg.color}`}>
                <i className={`${canalCfg.icon} text-[9px]`} />
                {canalCfg.label}
              </span>
              {pag.operator_name && (
                <span className="text-[9px] text-zinc-400 whitespace-nowrap">
                  <i className="ri-user-line mr-0.5" />{pag.operator_name}
                </span>
              )}
              {isSplit && (
                <span className="ml-auto text-xs font-bold text-emerald-700">{fmt(pag.amount)}</span>
              )}
            </div>

            {/* Dinheiro: valor entregue + troco */}
            {cash && pag.change_amount > 0 && (
              <div className="flex gap-3 pt-0.5 border-t border-emerald-100">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-zinc-500">Entregue</span>
                  <span className="text-[10px] font-bold text-zinc-700">{fmt(pag.amount + pag.change_amount)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-zinc-500">Troco</span>
                  <span className="text-[10px] font-black text-emerald-600">{fmt(pag.change_amount)}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Total quando split */}
      {isSplit && (
        <div className="flex items-center justify-between px-1 pt-0.5">
          <span className="text-[10px] text-zinc-500 font-semibold">Total pago</span>
          <span className="text-xs font-black text-emerald-700">{fmt(totalPago)}</span>
        </div>
      )}
    </div>
  );
}

function destinoLabel(p: KDSPedido): string {
  if (p.destino === 'mesa') {
    const base = `Mesa ${p.mesaNumero ?? '?'}`;
    return p.nomeCliente ? `${base} · ${p.nomeCliente}` : base;
  }
  if (p.destino === 'nome') return p.nomeCliente ?? 'Balcão';
  if (p.destino === 'senha') return `Senha ${p.senha}`;
  if (p.destino === 'delivery') return `Delivery · ${p.nomeCliente}`;
  return 'Balcão';
}

function unitKey(itemId: string, unidadeId: string) {
  return `${itemId}::${unidadeId}`;
}

// ── Linha de unidade ─────────────────────────────────────────────────────────

interface UnidadeRowProps {
  u: KDSUnidade;
  numero: number;
  itemId: string;
  isEntregueLocal: boolean;
  onEntregar: () => void;
}

function UnidadeRow({ u, numero, isEntregueLocal, onEntregar }: UnidadeRowProps) {
  const efetivamenteEntregue = isEntregueLocal || u.status === 'entregue';
  const cfg = efetivamenteEntregue ? UNIDADE_STATUS_CFG['entregue'] : UNIDADE_STATUS_CFG[u.status] ?? UNIDADE_STATUS_CFG['novo'];
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-zinc-50 last:border-0">
      <div className={`w-5 h-5 flex items-center justify-center rounded-full text-[9px] font-black flex-shrink-0 ${
        efetivamenteEntregue ? 'bg-green-500 text-white' :
        u.status === 'pronto' ? 'bg-green-100 text-green-700' :
        u.status === 'preparo' ? 'bg-amber-100 text-amber-700' :
        'bg-zinc-100 text-zinc-500'
      }`}>{numero}</div>
      <div className={`w-4 h-4 flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
        <i className={`${cfg.icon} text-xs`} />
      </div>
      <span className={`text-[10px] font-bold flex-1 ${cfg.color}`}>
        {efetivamenteEntregue ? 'Entregue' : u.status === 'pronto' ? 'Pronto' : u.status === 'preparo' ? 'Em preparo' : 'Aguardando'}
      </span>
      {!efetivamenteEntregue && u.status === 'pronto' && (
        <button
          onClick={(e) => { e.stopPropagation(); onEntregar(); }}
          className="flex-shrink-0 text-[9px] font-black bg-green-500 hover:bg-green-600 text-white px-2 py-0.5 rounded-full cursor-pointer whitespace-nowrap transition-colors"
        >
          Entregar
        </button>
      )}
    </div>
  );
}

// ── Item detalhe ─────────────────────────────────────────────────────────────

interface ItemDetalheRowProps {
  item: KDSItem;
  entreguesLocal: Set<string>;
  onEntregar: (itemId: string, unidadeId: string) => void;
  onEditar?: (item: KDSItem) => void;
}

function ItemDetalheRow({ item, entreguesLocal, onEntregar, onEditar }: ItemDetalheRowProps) {
  const [expanded, setExpanded] = useState(false);

  const isUnitEntregue = (u: KDSUnidade) =>
    u.status === 'entregue' || entreguesLocal.has(unitKey(item.id, u.id));

  const totalEntregues = (item.unidades ?? []).filter(isUnitEntregue).length;
  const allEntregues = totalEntregues === item.quantidade;
  const unidadesAguardandoEntrega = (item.unidades ?? []).filter(
    (u) => u.status === 'pronto' && !isUnitEntregue(u)
  ).length;

  // Status efetivo do item
  let efetivoStatus: KDSItemStatus = item.status;
  if (item.unidades && item.unidades.length > 0) {
    if (item.unidades.every(isUnitEntregue)) efetivoStatus = 'entregue';
    else if (item.unidades.some((u) => u.status === 'preparo')) efetivoStatus = 'preparo';
    else if (item.unidades.some((u) => u.status === 'pronto' && !isUnitEntregue(u))) efetivoStatus = 'pronto';
    else if (item.unidades.every((u) => u.status === 'novo')) efetivoStatus = 'novo';
  }

  const cfg = ITEM_STATUS_CFG[efetivoStatus] ?? ITEM_STATUS_CFG['novo'];
  const isSinglePronto = item.quantidade === 1 && item.status === 'pronto' && !entreguesLocal.has(unitKey(item.id, item.unidades?.[0]?.id ?? ''));
  const hasMultiUnidades = item.unidades && item.unidades.length > 1;

  return (
    <div className={`rounded-lg border border-zinc-200 overflow-hidden transition-all ${cfg.borderCls} ${cfg.bgCls} ${allEntregues ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        {/* Status badge */}
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold flex-shrink-0 whitespace-nowrap ${cfg.badgeCls}`}>
          <i className={`${cfg.icon} text-[9px]`} />
          {cfg.label}
          {item.quantidade > 1 && efetivoStatus !== 'entregue' && (
            <span className="ml-0.5 opacity-70">{totalEntregues}/{item.quantidade}</span>
          )}
        </div>

        {/* Nome + categoria */}
        {hasMultiUnidades ? (
          <button onClick={() => setExpanded((v) => !v)} className="flex-1 min-w-0 text-left cursor-pointer">
            <ItemNome item={item} allEntregues={allEntregues} expanded={expanded} />
          </button>
        ) : (
          <div className="flex-1 min-w-0">
            <ItemNome item={item} allEntregues={allEntregues} expanded={false} showArrow={false} />
          </div>
        )}

        {/* Ações */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Botão editar — só para itens aguardando (novo) */}
          {efetivoStatus === 'novo' && !allEntregues && onEditar && (
            <button
              onClick={(e) => { e.stopPropagation(); onEditar(item); }}
              className="flex items-center gap-1 text-[9px] font-bold bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-700 px-2 py-0.5 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
              title="Editar item (aguardando preparo)"
            >
              <i className="ri-pencil-line text-[9px]" />Editar
            </button>
          )}
          {isSinglePronto && (
            <button
              onClick={() => onEntregar(item.id, item.unidades?.[0]?.id ?? item.id)}
              className="flex items-center gap-1 text-[9px] font-black bg-green-500 hover:bg-green-600 text-white px-2 py-0.5 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
            >
              <i className="ri-check-line text-[9px]" />Entregar
            </button>
          )}
        </div>
      </div>

      {/* Barra de progresso */}
      {item.quantidade > 1 && item.unidades && (
        <div className="flex gap-0.5 px-2.5 pb-1.5">
          {item.unidades.map((u, i) => {
            const entregue = isUnitEntregue(u);
            return (
              <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${
                entregue ? 'bg-green-500' : u.status === 'pronto' ? 'bg-green-300' : u.status === 'preparo' ? 'bg-amber-400 animate-pulse' : 'bg-zinc-200'
              }`} />
            );
          })}
        </div>
      )}

      {/* Unidades expandidas */}
      {expanded && hasMultiUnidades && (
        <div className="border-t border-zinc-100 px-3 py-1 bg-white/60">
          {(item.unidades ?? []).map((u, idx) => (
            <UnidadeRow
              key={u.id}
              u={u}
              numero={idx + 1}
              itemId={item.id}
              isEntregueLocal={entreguesLocal.has(unitKey(item.id, u.id))}
              onEntregar={() => onEntregar(item.id, u.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemNome({ item, allEntregues, expanded, showArrow = true }: { item: KDSItem; allEntregues: boolean; expanded: boolean; showArrow?: boolean }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 flex-wrap">
          {item.quantidade > 1 && (
            <span className="text-[10px] font-black text-amber-600 flex-shrink-0">{item.quantidade}x</span>
          )}
          <span className={`text-xs font-semibold truncate ${allEntregues ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>
            {item.nome}
          </span>
          {item.categoriaNome && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 border border-zinc-200 whitespace-nowrap flex-shrink-0">
              {item.categoriaNome}
            </span>
          )}
        </div>
        {item.opcoes.length > 0 && (
          <p className="text-[9px] text-zinc-400 truncate">{item.opcoes.map((o) => `${o.grupoNome}: ${o.opcaoNome}`).join(' · ')}</p>
        )}
        {item.observacoes.length > 0 && (
          <p className="text-[9px] text-amber-600 truncate">
            <i className="ri-chat-1-line mr-0.5" />{item.observacoes.join(' · ')}
          </p>
        )}
      </div>
      {showArrow && (
        <i className={`text-zinc-400 text-xs flex-shrink-0 ${expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
      )}
    </div>
  );
}

// ── Card de pedido expandível (igual ao PDV Caixa) ───────────────────────────

interface PedidoCardProps {
  pedido: KDSPedido;
  onEntregarItem: (itemId: string, orderId: string, unidadeId?: string) => Promise<void>;
  onReloadPedidos: () => void;
}

function PedidoCard({ pedido, onEntregarItem, onReloadPedidos }: PedidoCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [entreguesLocal, setEntreguesLocal] = useState<Set<string>>(new Set());
  const [showPagamento, setShowPagamento] = useState(false);
  const [pagoLocal, setPagoLocal] = useState(false);
  const [entregandoKiosk, setEntregandoKiosk] = useState(false);
  const [itemEditando, setItemEditando] = useState<KDSItem | null>(null);
  const totalAmount = pedido.totalAmount;
  const origemCfg = ORIGEM_CFG[pedido.origem] ?? ORIGEM_CFG.caixa;
  const isAtivo = pedido.status !== 'entregue';
  const isPago = (pedido.isPaid ?? false) || pagoLocal;
  const isCancelado = pedido.isCancelled ?? false;
  const isKioskNaoPago = pedido.origem === 'autoatendimento' && !isPago;

  const handleEntregar = useCallback((itemId: string, unidadeId: string) => {
    const key = unitKey(itemId, unidadeId);
    setEntreguesLocal((prev) => new Set(prev).add(key));
    onEntregarItem(itemId, pedido.id, unidadeId).catch(console.error);
  }, [onEntregarItem, pedido.id]);

  // Entregar todos os itens do pedido kiosk de uma vez (após pagamento)
  const handleEntregarPedidoKiosk = useCallback(async () => {
    setEntregandoKiosk(true);
    try {
      for (const item of pedido.itens) {
        for (const u of (item.unidades ?? [])) {
          if (u.status !== 'entregue') {
            await onEntregarItem(item.id, pedido.id, u.id);
          }
        }
        if (!item.unidades || item.unidades.length === 0) {
          if (item.status !== 'entregue') {
            await onEntregarItem(item.id, pedido.id);
          }
        }
      }
      const novas = new Set(entreguesLocal);
      pedido.itens.forEach((item) => {
        (item.unidades ?? []).forEach((u) => novas.add(unitKey(item.id, u.id)));
      });
      setEntreguesLocal(novas);
    } finally {
      setEntregandoKiosk(false);
    }
  }, [pedido, onEntregarItem, entreguesLocal]);

  const unidadesAguardando = pedido.itens.reduce((acc, item) => {
    return acc + (item.unidades ?? []).filter(
      (u) => u.status === 'pronto' && !entreguesLocal.has(unitKey(item.id, u.id))
    ).length + (item.quantidade === 1 && item.status === 'pronto' && !entreguesLocal.has(unitKey(item.id, item.unidades?.[0]?.id ?? '')) ? 1 : 0);
  }, 0);

  // Contagem de unidades totais, em preparo e prontas
  let totalUnidades = 0;
  let unidadesProntas = 0;
  let unidadesEmPreparo = 0;
  pedido.itens.forEach((item) => {
    if (item.unidades && item.unidades.length > 0) {
      item.unidades.forEach((u) => {
        totalUnidades++;
        if (u.status === 'pronto' || u.status === 'entregue' || entreguesLocal.has(unitKey(item.id, u.id))) unidadesProntas++;
        else if (u.status === 'preparo') unidadesEmPreparo++;
      });
    } else {
      totalUnidades++;
      if (item.status === 'pronto' || item.status === 'entregue') unidadesProntas++;
      else if (item.status === 'preparo') unidadesEmPreparo++;
    }
  });

  const statusLabel =
    pedido.status === 'entregue' ? 'Entregue' :
    pedido.status === 'pronto' ? 'Pronto' :
    pedido.itens.some((i) => i.status === 'preparo') ? 'Em preparo' :
    pedido.itens.some((i) => i.status === 'pronto') ? 'Parcial pronto' :
    'Aguardando';

  const statusBadgeCls =
    pedido.status === 'entregue' ? 'bg-zinc-100 text-zinc-500 border-zinc-200' :
    pedido.status === 'pronto' ? 'bg-green-100 text-green-700 border-green-200' :
    pedido.itens.some((i) => i.status === 'preparo' || i.status === 'pronto') ? 'bg-amber-100 text-amber-700 border-amber-200' :
    'bg-zinc-100 text-zinc-500 border-zinc-200';

  return (
    <>
    {itemEditando && (
      <EditarItemPedidoAtivoModal
        item={itemEditando}
        orderId={pedido.id}
        onSalvo={() => { setItemEditando(null); onReloadPedidos(); }}
        onClose={() => setItemEditando(null)}
      />
    )}
    {showPagamento && totalAmount != null && totalAmount > 0 && (
      <PagamentoRapidoModal
        orderId={pedido.id}
        numeroDisplay={pedido.numero}
        total={totalAmount}
        destinoDisplay={destinoLabel(pedido)}
        onClose={() => setShowPagamento(false)}
        onSuccess={(_orderId, _paymentMethodId) => {
          setPagoLocal(true);
          setShowPagamento(false);
          if (pedido.origem === 'autoatendimento' && pedido.status === 'pronto') {
            setTimeout(() => handleEntregarPedidoKiosk(), 300);
          }
        }}
      />
    )}
    <div className={`mx-2 mb-2 rounded-xl border border-zinc-200 overflow-hidden transition-all ${isCancelado ? 'border-l-[3px] border-l-red-300 opacity-50' : STATUS_LEFT_BORDER[pedido.status] ?? STATUS_LEFT_BORDER.novo} ${isCancelado ? 'bg-zinc-50' : STATUS_CARD_BG[pedido.status] ?? 'bg-white'}`}>
      {/* Header clicável */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
        className="px-3 pt-3 pb-2.5 cursor-pointer hover:brightness-95 transition-all"
      >
        {/* Linha 1: número + destino + badges */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-black text-zinc-900 text-sm whitespace-nowrap">
              #{String(pedido.numero).padStart(4, '0')}
            </span>
            <span className="text-xs font-semibold text-zinc-600 truncate max-w-[120px]" title={destinoLabel(pedido)}>
              {destinoLabel(pedido)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
            <CronometroBadge criadoEm={pedido.criadoEm} ativo={isAtivo && !isCancelado} />
            {isCancelado ? (
              <span className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full border bg-red-100 text-red-600 border-red-300 whitespace-nowrap">
                <i className="ri-close-circle-line text-[10px]" />Cancelado
              </span>
            ) : (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${statusBadgeCls}`}>
                {statusLabel}
              </span>
            )}
            <i className={`text-zinc-400 text-sm flex-shrink-0 ${expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
          </div>
        </div>

        {/* Linha 2: origem + hora + unidades + total */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${origemCfg.color}`}>
              <i className={`${origemCfg.icon} text-[9px]`} />
              {origemCfg.label}
              {pedido.origem === 'garcom' && pedido.garcomNome && (
                <span className="ml-0.5">· {pedido.garcomNome.split(' ')[0]}</span>
              )}
            </span>
            <span className="text-[10px] text-zinc-400">
              {new Date(pedido.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
            {/* Badge de pagamento */}
            {isPago ? (
              <span className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 whitespace-nowrap">
                <i className="ri-checkbox-circle-fill text-[9px]" /> Pago
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 border border-zinc-200 whitespace-nowrap">
                <i className="ri-time-line text-[9px]" /> Em aberto
              </span>
            )}
            {totalUnidades > 0 && pedido.status !== 'entregue' && (
              <span className="text-[10px] text-zinc-500">
                {unidadesProntas === totalUnidades
                  ? `${totalUnidades} ${totalUnidades === 1 ? 'unidade' : 'unidades'} prontas`
                  : unidadesEmPreparo > 0 && unidadesProntas === 0
                  ? `${unidadesEmPreparo}/${totalUnidades} em preparo`
                  : unidadesEmPreparo > 0
                  ? `${unidadesProntas + unidadesEmPreparo}/${totalUnidades} em andamento`
                  : `${unidadesProntas}/${totalUnidades} ${totalUnidades === 1 ? 'unidade' : 'unidades'}`}
              </span>
            )}
          </div>
          {totalAmount != null && totalAmount > 0 && (
            <span className="text-xs font-black text-zinc-900">{fmt(totalAmount)}</span>
          )}
        </div>

        {/* Indicador rápido de prontos */}
        {unidadesAguardando > 0 && !expanded && !isKioskNaoPago && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
            <span className="text-[10px] font-bold text-green-700">
              {unidadesAguardando} {unidadesAguardando === 1 ? 'unidade pronta' : 'unidades prontas'} — toque para entregar
            </span>
          </div>
        )}
        {/* Kiosk não pago: botão de cobrar visível no header sem precisar expandir */}
        {isKioskNaoPago && !isCancelado && totalAmount != null && totalAmount > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
              <span className="text-[10px] font-bold text-amber-700 truncate">
                {pedido.status === 'pronto' ? 'Pronto — aguardando cobrança' : 'Autoatendimento — cobrar ao retirar'}
              </span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setShowPagamento(true); }}
              className="flex-shrink-0 flex items-center gap-1 text-[10px] font-black bg-emerald-500 hover:bg-emerald-600 text-white px-2.5 py-1 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
            >
              <i className="ri-bank-card-line text-[10px]" />
              Cobrar {fmt(totalAmount)}
            </button>
          </div>
        )}

        {/* Barra de progresso */}
        {pedido.status !== 'entregue' && totalUnidades > 0 && (
          <div className="mt-2 h-1 bg-zinc-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pedido.status === 'pronto' ? 'bg-green-500' : 'bg-amber-400'}`}
              style={{ width: `${(unidadesProntas / totalUnidades) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Itens expandidos */}
      {expanded && (
        <div className="border-t border-zinc-200 pt-2.5 pb-3 bg-white/70">
          {/* Lista de itens */}
          <div className="px-3 space-y-2">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Itens do pedido</p>
            {pedido.itens.map((item) => (
              <ItemDetalheRow
                key={item.id}
                item={item}
                entreguesLocal={entreguesLocal}
                onEntregar={handleEntregar}
                onEditar={!pedido.isCancelled ? (it) => setItemEditando(it) : undefined}
              />
            ))}
          </div>
          {/* Footer com botão de pagamento */}
          {pedido.origem === 'autoatendimento' && !isCancelado && (
            <div className="px-3 pt-3 mt-2 border-t border-zinc-100 space-y-2">
              {!isPago && totalAmount != null && totalAmount > 0 ? (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowPagamento(true); }}
                  className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
                >
                  <i className="ri-bank-card-line" />
                  Cobrar e Entregar · {fmt(totalAmount)}
                </button>
              ) : isPago ? (
                <>
                  <PagamentoInfo pagamentos={pedido.pagamentos} origem={pedido.origem} />
                  {pedido.status !== 'entregue' && (
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
                </>
              ) : null}
            </div>
          )}
          {pedido.origem !== 'autoatendimento' && !isCancelado && !isPago && totalAmount != null && totalAmount > 0 && (
            <div className="px-3 pt-3 mt-2 border-t border-zinc-100">
              <button
                onClick={(e) => { e.stopPropagation(); setShowPagamento(true); }}
                className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
              >
                <i className="ri-bank-card-line" />
                Registrar Pagamento · {fmt(totalAmount)}
              </button>
            </div>
          )}
          {pedido.origem !== 'autoatendimento' && !isCancelado && isPago && (
            <PagamentoInfo pagamentos={pedido.pagamentos} origem={pedido.origem} />
          )}
          {isCancelado && (
            <div className="px-3 pt-2 mt-1 border-t border-zinc-100 flex items-center gap-2">
              <i className="ri-close-circle-line text-red-400 text-sm" />
              <span className="text-xs font-semibold text-red-500">
                Pedido cancelado{pedido.cancelReason ? ` · ${pedido.cancelReason}` : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}

// ── View principal ────────────────────────────────────────────────────────────

export default function PedidosAtivosView({ onIrParaMesa: _onIrParaMesa }: Props) {
  const { pedidos: kdsPedidos, updateItemStatusRemote, updateUnitStatusRemote, setPedidos, reloadOrders } = useKDS();
  const { user } = useAuth();
  const [filtroOrigem, setFiltroOrigem] = useState<FiltroOrigem>('todos');
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos');

  const pedidosAtivos = useMemo(
    () => kdsPedidos
      .filter((p) => !p.isCancelled && p.status !== 'entregue')
      .filter((p) => filtroOrigem === 'todos' || p.origem === filtroOrigem)
      .filter((p) => {
        if (filtroStatus === 'todos') return true;
        if (filtroStatus === 'aberto') return !(p.isPaid);
        return p.status === filtroStatus;
      })
      .sort((a, b) => {
        if (a.status === 'pronto' && b.status !== 'pronto') return -1;
        if (b.status === 'pronto' && a.status !== 'pronto') return 1;
        return a.criadoEm - b.criadoEm;
      }),
    [kdsPedidos, filtroOrigem, filtroStatus],
  );

  const pedidosEntregues = useMemo(
    () => kdsPedidos
      .filter((p) => !p.isCancelled && p.status === 'entregue')
      .filter((p) => filtroOrigem === 'todos' || p.origem === filtroOrigem)
      .sort((a, b) => b.criadoEm - a.criadoEm)
      .slice(0, 5),
    [kdsPedidos, filtroOrigem],
  );

  // Cancelados: sempre no final, sem ação de pagamento
  const pedidosCancelados = useMemo(
    () => kdsPedidos
      .filter((p) => p.isCancelled)
      .filter((p) => filtroOrigem === 'todos' || p.origem === filtroOrigem)
      .sort((a, b) => b.criadoEm - a.criadoEm),
    [kdsPedidos, filtroOrigem],
  );

  const totalAtivos = pedidosAtivos.length;
  const totalProntos = pedidosAtivos.filter((p) => p.status === 'pronto').length;

  const countPorOrigem = useMemo(() => {
    const counts: Record<string, number> = {};
    kdsPedidos.filter((p) => p.status !== 'entregue').forEach((p) => {
      counts[p.origem] = (counts[p.origem] ?? 0) + 1;
    });
    return counts;
  }, [kdsPedidos]);

  // Entregar item (com suporte a unidade individual)
  const handleEntregarItem = useCallback(async (itemId: string, orderId: string, unidadeId?: string) => {
    const operador = user?.nome ?? 'Operador';
    const now = Date.now();

    // Optimistic update
    setPedidos((prev) =>
      prev.map((p) => {
        if (p.id !== orderId) return p;
        const itens = p.itens.map((item) => {
          if (item.id !== itemId) return item;
          // Se tem unidade específica, atualiza só ela
          if (unidadeId && item.unidades && item.unidades.length > 0) {
            const novasUnidades = item.unidades.map((u) =>
              u.id === unidadeId
                ? { ...u, status: 'entregue' as KDSItemStatus, entregueEm: now, quemEntregou: operador }
                : u
            );
            const todasEntregues = novasUnidades.every((u) => u.status === 'entregue');
            return {
              ...item,
              unidades: novasUnidades,
              status: todasEntregues ? ('entregue' as KDSItemStatus) : item.status,
              entregueEm: todasEntregues ? now : item.entregueEm,
              quemEntregou: todasEntregues ? operador : item.quemEntregou,
            };
          }
          return { ...item, status: 'entregue' as KDSItemStatus, entregueEm: now, quemEntregou: operador };
        });
        const kitchenItens = itens.filter((i) => !i.semPreparo && !i.skip_kds);
        let novoStatus: KDSPedido['status'] = 'novo';
        if (itens.every((i) => i.status === 'entregue')) novoStatus = 'entregue';
        else if (kitchenItens.every((i) => i.status === 'pronto' || i.status === 'entregue')) novoStatus = 'pronto';
        else if (kitchenItens.some((i) => i.status === 'preparo' || i.status === 'pronto')) novoStatus = 'preparo';
        return { ...p, itens, status: novoStatus };
      }),
    );

    // Persiste no banco:
    // - Se tem unidade específica → update_unit_status (registra delivered_by_user_id por unidade)
    // - Senão → update_order_item_status (item inteiro)
    if (unidadeId) {
      // Extrair número da unidade do id (formato: "itemId-uN")
      const unitMatch = unidadeId.match(/-u(\d+)$/);
      const unitNumber = unitMatch ? parseInt(unitMatch[1], 10) : 1;
      await updateUnitStatusRemote(itemId, orderId, unitNumber, 'entregue');
    } else {
      await updateItemStatusRemote(itemId, orderId, 'entregue');
    }
  }, [updateItemStatusRemote, updateUnitStatusRemote, setPedidos, user]);

  const origens: { key: FiltroOrigem; label: string; icon: string }[] = [
    { key: 'todos',           label: 'Todos',   icon: 'ri-apps-line'         },
    { key: 'caixa',           label: 'Caixa',   icon: 'ri-safe-2-line'       },
    { key: 'garcom',          label: 'Garçom',  icon: 'ri-walk-line'         },
    { key: 'mesa',            label: 'Mesa QR', icon: 'ri-restaurant-2-line' },
    { key: 'autoatendimento', label: 'Kiosk',   icon: 'ri-tablet-line'       },
  ];

  const countEmAberto = kdsPedidos.filter((p) => !p.isCancelled && p.status !== 'entregue' && !p.isPaid).length;

  const statusFiltros: { key: FiltroStatus; label: string; count?: number; activeCls?: string }[] = [
    { key: 'todos',   label: 'Todos',     count: kdsPedidos.filter((p) => !p.isCancelled && p.status !== 'entregue').length },
    { key: 'aberto',  label: 'Em Aberto', count: countEmAberto, activeCls: 'bg-orange-500 text-white' },
    { key: 'novo',    label: 'Novo',      count: kdsPedidos.filter((p) => !p.isCancelled && p.status === 'novo').length },
    { key: 'preparo', label: 'Preparo',   count: kdsPedidos.filter((p) => !p.isCancelled && p.status === 'preparo').length },
    { key: 'pronto',  label: 'Prontos',   count: kdsPedidos.filter((p) => !p.isCancelled && p.status === 'pronto').length },
  ];

  if (kdsPedidos.filter((p) => p.status !== 'entregue').length === 0 && pedidosEntregues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6">
        <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
          <i className="ri-receipt-line text-3xl text-zinc-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-500 mb-1">Nenhum pedido ativo</p>
        <p className="text-xs text-zinc-400">Todos os pedidos do turno aparecerão aqui</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-100">
      {/* Banner prontos */}
      {totalProntos > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-500 flex-shrink-0">
          <i className="ri-restaurant-2-line text-white text-sm animate-bounce" />
          <p className="text-xs font-bold text-white flex-1">
            {totalProntos === 1 ? '1 pedido pronto para entregar!' : `${totalProntos} pedidos prontos para entregar!`}
          </p>
        </div>
      )}

      {/* Filtros unificados — 1 linha compacta */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-zinc-200 bg-white overflow-x-auto flex-shrink-0 scrollbar-hide">
        {/* Status */}
        {statusFiltros.map(({ key, label, count, activeCls }) => {
          const defaultActiveCls = key === 'pronto' ? 'bg-green-500 text-white' : key === 'preparo' ? 'bg-amber-500 text-white' : 'bg-zinc-700 text-white';
          const isActive = filtroStatus === key;
          return (
            <button
              key={key}
              onClick={() => setFiltroStatus(key)}
              className={`relative flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                isActive ? (activeCls ?? defaultActiveCls) : 'text-zinc-500 hover:bg-zinc-100'
              }`}
            >
              {label}
              {count != null && count > 0 && (
                <span className={`text-[9px] font-black px-1 rounded-full ${
                  isActive ? 'bg-white/30 text-white' : 'bg-amber-500 text-white'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}

        {/* Divisor */}
        <div className="w-px h-4 bg-zinc-200 flex-shrink-0 mx-0.5" />

        {/* Origem */}
        {origens.map(({ key, label, icon }) => {
          const count = key === 'todos'
            ? kdsPedidos.filter((p) => p.status !== 'entregue').length
            : (countPorOrigem[key] ?? 0);
          if (key !== 'todos' && count === 0) return null;
          const isActive = filtroOrigem === key;
          return (
            <button
              key={key}
              onClick={() => setFiltroOrigem(key)}
              className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                isActive ? 'bg-amber-500 text-white' : 'text-zinc-500 hover:bg-zinc-100'
              }`}
            >
              <i className={`${icon} text-[10px]`} />
              <span>{label}</span>
              {count > 0 && (
                <span className={`text-[9px] font-black px-1 rounded-full ${
                  isActive ? 'bg-white/30 text-white' : 'bg-zinc-200 text-zinc-500'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}

        {/* Resumo inline */}
        <div className="ml-auto flex items-center gap-1 flex-shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-[10px] font-bold text-zinc-500">{totalAtivos}</span>
        </div>
      </div>

      {/* Lista de cards */}
      <div className="flex-1 overflow-y-auto pt-2">
        {pedidosAtivos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-zinc-300">
            <i className="ri-filter-line text-3xl mb-2" />
            <p className="text-sm">Nenhum pedido com este filtro</p>
          </div>
        )}
        {pedidosAtivos.map((p) => (
          <PedidoCard key={p.id} pedido={p} onEntregarItem={handleEntregarItem} onReloadPedidos={reloadOrders} />
        ))}

        {/* Entregues recentes */}
        {pedidosEntregues.length > 0 && filtroStatus === 'todos' && (
          <div className="px-2 mt-2">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2 px-1">
              Entregues recentemente
            </p>
            {pedidosEntregues.map((p) => (
              <div key={p.id} className="opacity-50">
                <PedidoCard pedido={p} onEntregarItem={handleEntregarItem} onReloadPedidos={reloadOrders} />
              </div>
            ))}
          </div>
        )}

        {/* Cancelados — sempre no final */}
        {pedidosCancelados.length > 0 && filtroStatus === 'todos' && (
          <div className="px-2 mt-2">
            <p className="text-[10px] font-bold text-red-300 uppercase tracking-wider mb-2 px-1 flex items-center gap-1">
              <i className="ri-close-circle-line text-[10px]" />
              Cancelados ({pedidosCancelados.length})
            </p>
            {pedidosCancelados.map((p) => (
              <PedidoCard key={p.id} pedido={p} onEntregarItem={handleEntregarItem} onReloadPedidos={reloadOrders} />
            ))}
          </div>
        )}
        <div className="h-2" />
      </div>
    </div>
  );
}
