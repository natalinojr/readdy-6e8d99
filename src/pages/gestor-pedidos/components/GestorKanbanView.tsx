import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { KDSPedido, KDSItem, KDSItemStatus, KDSUnidade } from '@/types/kds';
import FichaTecnicaKDSModal from '@/pages/kds/components/FichaTecnicaKDSModal';
import { sendToPrinter } from '@/lib/printUtils';
import { supabase } from '@/lib/supabase';
import { useImpressoras, PRINTER_KEY_GESTOR_PEDIDOS } from '@/contexts/ImpressorasContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useMotoboyStatus } from '@/hooks/useMotoboyStatus';

const MOTOBOY_SINAL_LABEL: Record<string, string> = {
  a_caminho_loja: 'Motoboy a caminho da loja',
  coletou: 'Pedido coletado pelo motoboy',
  entregou: 'Entregue pelo motoboy',
  problema: 'Problema na entrega',
};

interface Props {
  pedidos: KDSPedido[];
  onAvancar: (pedidoId: string) => void;
  onEmRota: (pedidoId: string) => void;
  onEntregar: (pedidoId: string) => void;
  onMudarOperador: (pedidoId: string, operador: string) => void;
  onCancelar: (pedidoId: string) => void;
  onOpenDetail: (pedidoId: string) => void;
  onAvancarUnidade?: (pedidoId: string, itemId: string, unidadeId: string, novoStatus: KDSItemStatus) => void;
  onEntregarUnidade?: (pedidoId: string, itemId: string, unidadeId: string) => void;
  onEntregarItem?: (pedidoId: string, itemId: string) => void;
  operadorAtual?: string;
  elapsed: number;
  filtroEstacao?: string;
  filtroStatus?: string;
}

const STATUS_COLS = [
  {
    key: 'novo' as const,
    label: 'Aguardando',
    icon: 'ri-time-line',
    cor: 'text-zinc-600',
    bg: 'bg-zinc-100',
    border: 'border-zinc-200',
    badge: 'bg-zinc-700 text-white',
    emptyText: 'Nenhum pedido aguardando',
  },
  {
    key: 'preparo' as const,
    label: 'Em Preparo',
    icon: 'ri-fire-line',
    cor: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    badge: 'bg-amber-500 text-white',
    emptyText: 'Nada em preparo',
  },
  {
    key: 'pronto' as const,
    label: 'Prontos',
    icon: 'ri-checkbox-circle-line',
    cor: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    badge: 'bg-emerald-500 text-white',
    emptyText: 'Nenhum pronto ainda',
  },
  {
    key: 'em_rota' as const,
    label: 'Em Rota',
    icon: 'ri-bike-line',
    cor: 'text-sky-700',
    bg: 'bg-sky-50',
    border: 'border-sky-200',
    badge: 'bg-sky-500 text-white',
    emptyText: 'Nenhum pedido em rota',
  },
  {
    key: 'entregue' as const,
    label: 'Entregues',
    icon: 'ri-check-double-line',
    cor: 'text-zinc-400',
    bg: 'bg-zinc-50',
    border: 'border-zinc-100',
    badge: 'bg-zinc-300 text-zinc-700',
    emptyText: 'Nenhuma entrega ainda',
  },
] as const;

const ORIGEM_LABELS: Record<string, { label: string; cor: string }> = {
  caixa:           { label: 'Caixa',    cor: 'bg-violet-100 text-violet-700 border border-violet-200' },
  garcom:          { label: 'Garçom',   cor: 'bg-sky-100 text-sky-700 border border-sky-200' },
  autoatendimento: { label: 'Autoatendimento',    cor: 'bg-pink-100 text-pink-700 border border-pink-200' },
  mesa_qr:         { label: 'QR Code',  cor: 'bg-teal-100 text-teal-700 border border-teal-200' },
  mesa:            { label: 'QR CODE',  cor: 'bg-teal-100 text-teal-700 border border-teal-200' },
  delivery:        { label: 'Delivery', cor: 'bg-orange-100 text-orange-700 border border-orange-200' },
};

const PLATFORM_LABELS: Record<string, { label: string; cor: string }> = {
  propria: { label: 'Própria', cor: 'bg-orange-100 text-orange-700 border border-orange-200' },
  ifood: { label: 'iFood', cor: 'bg-red-100 text-red-700 border border-red-200' },
  uber: { label: 'Uber Eats', cor: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  rappi: { label: 'Rappi', cor: 'bg-purple-100 text-purple-700 border border-purple-200' },
};

function elapsedStr(criadoEm: number): string {
  const s = Math.floor((Date.now() - criadoEm) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${String(m % 60).padStart(2, '0')}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function elapsedMinutes(criadoEm: number): number {
  return (Date.now() - criadoEm) / 60000;
}

function timerColor(criadoEm: number, status: string): string {
  if (status === 'entregue') return 'text-zinc-400';
  if (status === 'em_rota') return 'text-sky-600 font-semibold';
  const m = elapsedMinutes(criadoEm);
  if (m > 20) return 'text-red-500 font-black animate-pulse';
  if (m > 10) return 'text-amber-500 font-bold';
  return 'text-emerald-600 font-semibold';
}

function urgencyBorder(criadoEm: number, status: string): string {
  if (status === 'entregue' || status === 'pronto' || status === 'em_rota') return '';
  const m = elapsedMinutes(criadoEm);
  if (m > 20) return 'border-red-400 ring-1 ring-red-200';
  if (m > 10) return 'border-amber-300';
  return 'border-zinc-100';
}

// Nome do cliente de delivery SEM o endereço. O backend grava destination_name
// como "Nome - Endereço" (ou "Nome - Retirada"); como o endereço já aparece em
// bloco próprio no card, removemos o sufixo para não duplicar a informação.
function nomeClienteDelivery(p: KDSPedido): string {
  const nome = (p.nomeCliente ?? '').trim();
  if (!nome) return 'Delivery';
  const addr = (p.deliveryAddress ?? '').trim();
  if (addr && nome.endsWith(addr)) {
    return nome.slice(0, -addr.length).replace(/\s*[-–—]\s*$/, '').trim() || 'Delivery';
  }
  // Sem endereço casado (ex.: retirada): corta no primeiro separador " - ".
  return nome.split(/\s+[-–—]\s+/)[0].trim() || 'Delivery';
}

function destinoLabel(p: KDSPedido): string {
  if (p.destino === 'mesa') {
    const base = `Mesa ${p.mesaNumero}`;
    const label = p.nomeCliente ? `${base} · ${p.nomeCliente}` : base;
    return p.participantName ? `${label} · ${p.participantName}` : label;
  }
  if (p.destino === 'nome' && p.nomeCliente) return p.nomeCliente;
  if (p.destino === 'senha' && p.senha) return `Senha ${p.senha}`;
  if (p.destino === 'delivery' && p.nomeCliente) return nomeClienteDelivery(p);
  if (p.destino === 'delivery') return 'Delivery';
  return 'Balcão';
}

// SLA de delivery por distância: tempos resolvidos do pedido (ver orders.delivery_*).
interface SlaInfo { routeMin: number | null; slaMin: number | null }

function fmtHora(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Item status pill inside card ───
const ITEM_STATUS_CFG: Record<KDSItemStatus, { icon: string; pill: string }> = {
  novo:     { icon: 'ri-time-line',            pill: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  preparo:  { icon: 'ri-fire-line',            pill: 'bg-amber-50 text-amber-600 border-amber-200' },
  pronto:   { icon: 'ri-check-double-line',    pill: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  entregue: { icon: 'ri-checkbox-circle-fill', pill: 'bg-zinc-50 text-zinc-400 border-zinc-200' },
};

// ─── Unit row ───
function ItemUnidadesRow({
  item,
  isCancelled,
  isKioskNaoPago,
  onAvancarUnidade,
  onEntregarUnidade,
}: {
  item: KDSItem;
  isCancelled?: boolean;
  isKioskNaoPago?: boolean;
  onAvancarUnidade?: (itemId: string, unidadeId: string, novoStatus: KDSItemStatus) => void;
  onEntregarUnidade?: (itemId: string, unidadeId: string) => void;
}) {
  if (!item.unidades || item.unidades.length <= 1) return null;
  return (
    <div className="ml-5 mt-1 flex flex-wrap gap-1">
      {item.unidades.map((u: KDSUnidade, idx: number) => {
        const cfg = ITEM_STATUS_CFG[u.status];
        const proximoStatus: KDSItemStatus | null =
          isCancelled ? null : (u.status === 'novo' ? 'preparo' : u.status === 'preparo' ? 'pronto' : null);
        // Bloquear entrega de unidade individual se kiosk não pago
        const bloqueioEntregaUnidade = isKioskNaoPago && u.status === 'pronto';
        return (
          <div
            key={u.id}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9px] font-bold ${cfg.pill}`}
          >
            <span className="font-black">{idx + 1}</span>
            <i className={`${cfg.icon} text-[9px]`} />
            {proximoStatus && onAvancarUnidade && (
              <button
                onClick={(e) => { e.stopPropagation(); onAvancarUnidade(item.id, u.id, proximoStatus); }}
                className="ml-0.5 w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-white/60 cursor-pointer transition-colors"
                title={proximoStatus === 'preparo' ? 'Iniciar unidade' : 'Marcar pronto'}
              >
                <i className={`text-[8px] ${proximoStatus === 'preparo' ? 'ri-play-fill' : 'ri-check-line'}`} />
              </button>
            )}
            {u.status === 'pronto' && !isCancelled && (
              bloqueioEntregaUnidade ? (
                <span
                  className="ml-0.5 px-1 py-0.5 rounded-full bg-amber-100 text-amber-600 text-[8px] font-bold whitespace-nowrap"
                  title="Pagamento necessário no caixa"
                >
                  <i className="ri-store-2-line text-[8px]" />
                </span>
              ) : onEntregarUnidade && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEntregarUnidade(item.id, u.id); }}
                  className="ml-0.5 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-emerald-100 hover:bg-emerald-200 cursor-pointer transition-colors"
                  title="Entregar unidade"
                >
                  <i className="ri-walk-line text-[8px] text-emerald-700" />
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Card ───
interface CardProps {
  pedido: KDSPedido;
  onAvancar: () => void;
  onEmRota: () => void;
  onEntregar: () => void;
  onMudarOperador: (operador: string) => void;
  onCancelar: () => void;
  onOpenDetail: () => void;
  onAvancarUnidade?: (itemId: string, unidadeId: string, novoStatus: KDSItemStatus) => void;
  onEntregarUnidade?: (itemId: string, unidadeId: string) => void;
  onEntregarItem?: (itemId: string) => void;
  operadorAtual?: string;
  tick: number;
  filtroEstacao?: string;
  isNew?: boolean;
  slaInfo?: SlaInfo;
  motoboySinal?: { status: string; note?: string | null };
}

function GestorCard({
  pedido,
  onAvancar,
  onEmRota,
  onEntregar,
  onCancelar,
  onOpenDetail,
  onAvancarUnidade,
  onEntregarUnidade,
  onEntregarItem,
  tick,
  filtroEstacao,
  isNew,
  slaInfo,
  motoboySinal,
}: CardProps) {
  void tick;
  const [showFicha, setShowFicha] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const origemInfo = ORIGEM_LABELS[pedido.origem] ?? { label: pedido.origem, cor: 'bg-zinc-100 text-zinc-700 border border-zinc-200' };
  const platformInfo = pedido.deliveryPlatform
    ? (PLATFORM_LABELS[pedido.deliveryPlatform] ?? { label: pedido.deliveryPlatform, cor: 'bg-zinc-100 text-zinc-700 border border-zinc-200' })
    : null;
  const temObs = pedido.itens.some((i) => i.observacoes && i.observacoes.length > 0);
  const isCancelled = pedido.isCancelled;
  const isPaid = pedido.isPaid ?? false;
  const isDelivery = pedido.origem === 'delivery' || pedido.destino === 'delivery';
  // QR code universal: tem senha de participante mas sem mesa física (mesaNumero 0)
  const isQRUniversal = !!pedido.participantToken && !pedido.mesaNumero;
  // Nome do cliente exibido junto da senha (participantName ou nomeCliente sem o prefixo "Mesa N")
  const participanteNome = pedido.participantName
    || pedido.nomeCliente?.replace(/^Mesa\s*\d*\s*[-–.·]?\s*/i, '').trim()
    || '';
  const itensComPreparo = pedido.itens.filter((i) => !i.semPreparo && !i.skip_kds);
  const temItemComPreparo = itensComPreparo.length > 0;
  const elapsedMin = elapsedMinutes(pedido.criadoEm);
  const isAtrasado = pedido.status !== 'entregue' && pedido.status !== 'pronto' && pedido.status !== 'em_rota' && elapsedMin > 20;
  const isAviso = !isAtrasado && pedido.status !== 'entregue' && pedido.status !== 'pronto' && pedido.status !== 'em_rota' && elapsedMin > 10;

  // SLA de delivery por distância (pedidos do link): tempo total configurado p/ a
  // faixa (slaMin) e tempo de rota da moto (routeMin). Tempo de deslocamento da
  // entrega = rota + 5 min; preparo = total − deslocamento.
  // → horário limite de preparo e horário limite final de entrega.
  const isLinkDelivery = isDelivery && pedido.deliveryPlatform === 'propria';
  const slaMin = slaInfo?.slaMin ?? null;
  let prazoPreparoMs: number | null = null;
  let prazoEntregaMs: number | null = null;
  if (isLinkDelivery && slaMin != null && slaMin > 0) {
    const deslocamentoMin = (slaInfo?.routeMin ?? 0) + 5;
    const preparoMin = Math.max(0, slaMin - deslocamentoMin);
    prazoPreparoMs = pedido.criadoEm + preparoMin * 60000;
    prazoEntregaMs = pedido.criadoEm + slaMin * 60000;
  }
  const now = Date.now();
  const preparoAtrasado = prazoPreparoMs != null && now > prazoPreparoMs
    && pedido.status !== 'pronto' && pedido.status !== 'em_rota' && pedido.status !== 'entregue';
  const entregaAtrasada = prazoEntregaMs != null && now > prazoEntregaMs && pedido.status !== 'entregue';

  // Resolve o link do Google Maps: usa o pin (lat/lng do pedido) quando existir;
  // senão cai na busca pelo endereço em texto.
  const resolverMapsUrl = async (): Promise<string> => {
    try {
      const { data } = await supabase.from('orders').select('delivery_lat, delivery_lng').eq('id', pedido.id).maybeSingle();
      if (data && data.delivery_lat != null && data.delivery_lng != null) {
        return `https://www.google.com/maps/dir/?api=1&destination=${data.delivery_lat},${data.delivery_lng}`;
      }
    } catch (_e) { /* ignora — usa fallback */ }
    const addr = pedido.deliveryAddress ?? '';
    return addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : 'https://www.google.com/maps';
  };

  const handleWhatsAppMotoboy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const w = window.open('', '_blank');
    const address = pedido.deliveryAddress ?? '';
    const name = nomeClienteDelivery(pedido);
    const notes = pedido.notes ? `\nObs: ${pedido.notes}` : '';
    const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
    const fee = pedido.deliveryFee ?? 0;
    const total = pedido.totalAmount ?? 0;
    const valoresLinha = `\n💰 Cobrar do cliente: *${fmtBRL(total)}*${fee > 0 ? `\n🛵 Taxa de entrega: ${fmtBRL(fee)}` : ''}`;
    // Alerta configurável (Config. do Delivery → "Avisar o motoboy"): categorias
    // (casadas por nome) e/ou itens (casados por id) que o lojista marcou.
    const alertas = settings.motoboy_alertas;
    const catNomes = new Set(alertas.categorias.map((c) => c.nome.toLowerCase()));
    const itemIds = new Set(alertas.itens.map((i) => i.id));
    const marcados = new Set<string>();
    pedido.itens.forEach((i) => {
      if (i.categoriaNome && catNomes.has(i.categoriaNome.toLowerCase())) marcados.add(i.categoriaNome);
      if (i.menuItemId && itemIds.has(i.menuItemId)) marcados.add(i.nome);
    });
    const bebidaLinha = marcados.size > 0
      ? `\n⚠️ *ATENÇÃO: este pedido tem ${Array.from(marcados).join(', ')} — não esquecer!*`
      : '';
    // Link do portal do motoboy (sinalizar a caminho / coletei / entreguei / problema).
    const portalUrl = `${window.location.origin}/motoboy/${pedido.id}`;
    resolverMapsUrl().then((mapsUrl) => {
      const msg = `🚀 *Entrega para ${name}*\n📍 ${address}${valoresLinha}${bebidaLinha}${notes}\n🗺️ Rota: ${mapsUrl}\n📲 Atualizar status: ${portalUrl}`;
      const wa = `https://wa.me/?text=${encodeURIComponent(msg)}`;
      if (w) w.location.href = wa;
      else window.open(wa, '_blank', 'noopener');
    });
  };

  const fmtBRLmsg = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const resolveMsgCliente = (tpl: string) => tpl
    .replace(/\{nome\}/g, nomeClienteDelivery(pedido))
    .replace(/\{numero\}/g, String(pedido.numero).padStart(4, '0'))
    .replace(/\{total\}/g, fmtBRLmsg(pedido.totalAmount ?? 0))
    .replace(/\{taxa\}/g, fmtBRLmsg(pedido.deliveryFee ?? 0));
  const abrirWhatsCliente = (msg: string) => {
    const phone = (pedido.customerPhone ?? '').replace(/\D/g, '');
    if (!phone) return;
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };
  const handleWhatsAppCliente = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!(pedido.customerPhone ?? '').replace(/\D/g, '')) return;
    // Mensagens configuradas pra fase (Config. do Delivery). Se 0 usa padrão, se 1 abre, se >1 deixa escolher.
    const faseMsgs = ((settings.whatsapp_msgs?.[pedido.status] as string[] | undefined) ?? []).map(resolveMsgCliente);
    if (faseMsgs.length === 0) {
      abrirWhatsCliente(`Olá ${nomeClienteDelivery(pedido)}! Seu pedido #${String(pedido.numero).padStart(4, '0')} está ${pedido.status === 'em_rota' ? 'a caminho' : pedido.status === 'pronto' ? 'pronto e saindo para entrega' : pedido.status === 'preparo' ? 'em preparo' : pedido.status === 'entregue' ? 'entregue' : 'recebido'}! 🏍️`);
    } else if (faseMsgs.length === 1) {
      abrirWhatsCliente(faseMsgs[0]);
    } else {
      setMsgMenu(faseMsgs);
    }
  };

  const { getImpressoraParaEstacao } = useImpressoras();
  const { settings } = useSystemSettings();
  const [msgMenu, setMsgMenu] = useState<string[] | null>(null);

  const handlePrint = () => {
    const paymentLine = pedido.origem === 'autoatendimento' && pedido.paymentMethodName
      ? `<p style="font-weight:bold;border:1px solid #000;padding:4px;margin:4px 0;">&#128179; Pagar na entrega: ${pedido.paymentMethodName}</p>`
      : '';
    const numStr = String(pedido.numero).padStart(4, '0');
    const destLabel = destinoLabel(pedido);
    const garcomLine = pedido.garcomNome ? `<p>Gar&ccedil;om: ${pedido.garcomNome}</p>` : '';
    const addressLine = pedido.deliveryAddress ? `<p>📍 ${pedido.deliveryAddress}</p>` : '';
    const itensHtml = pedido.itens.map((i) => {
      const opts = i.opcoes?.length ? `<div style="padding-left:10px;font-size:11px">${i.opcoes.map((o) => `${o.obrigatorio ? '' : '+ '}${o.opcaoNome}`).join(', ')}</div>` : '';
      const obs = i.observacoes?.length ? `<div style="color:red;font-weight:bold;font-size:11px">${i.observacoes.map((o) => '&#9888; ' + o).join('<br/>')}</div>` : '';
      return `<div style="margin:4px 0"><strong>${i.quantidade}x ${i.nome}</strong>${i.categoriaNome ? ` <small>(${i.categoriaNome})</small>` : ''}${opts}${obs}</div>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Pedido #${numStr}</title><style>body{font-family:monospace;font-size:12px;padding:16px}h2{margin:0 0 4px}hr{border:1px dashed #000}p{margin:2px 0;font-size:11px}</style></head><body><h2>Pedido #${numStr}</h2><p>${destLabel} &mdash; ${origemInfo.label}</p>${garcomLine}${addressLine}${paymentLine}<hr/>${itensHtml}<hr/><small>${new Date().toLocaleString('pt-BR')}</small></body></html>`;
    const impressora = getImpressoraParaEstacao(PRINTER_KEY_GESTOR_PEDIDOS);
    sendToPrinter(html, impressora);
  };

  return (
    <>
      {msgMenu && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50" onClick={(e) => { e.stopPropagation(); setMsgMenu(null); }}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-4 space-y-2 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-bold text-zinc-800 mb-1">Escolha a mensagem</h4>
            {msgMenu.map((m, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { abrirWhatsCliente(m); setMsgMenu(null); }}
                className="w-full text-left px-3 py-2.5 rounded-xl border border-zinc-200 hover:border-green-400 hover:bg-green-50 text-sm text-zinc-700 cursor-pointer whitespace-pre-wrap"
              >
                {m}
              </button>
            ))}
            <button type="button" onClick={() => setMsgMenu(null)} className="w-full py-2 text-xs text-zinc-400 cursor-pointer">Cancelar</button>
          </div>
        </div>
      )}
      {showFicha && (
        <FichaTecnicaKDSModal
          itens={itensComPreparo.map((i) => ({ nome: i.nome, quantidade: i.quantidade, menuItemId: i.menuItemId }))}
          onClose={() => setShowFicha(false)}
        />
      )}

      <div
        className={`bg-white rounded-xl border-2 overflow-hidden transition-all duration-300 ${
          isCancelled
            ? 'opacity-40 border-red-200'
            : urgencyBorder(pedido.criadoEm, pedido.status)
        } ${pedido.status === 'entregue' ? 'opacity-55' : ''} ${isNew ? 'animate-[slideIn_0.3s_ease-out]' : ''}`}
      >
        {/* Urgency top bar */}
        {isAtrasado && (
          <div className="bg-red-500 px-3 py-1 flex items-center gap-1.5">
            <i className="ri-alarm-warning-line text-white text-xs animate-pulse" />
            <span className="text-white text-[10px] font-black uppercase tracking-wide">
              Atrasado {Math.floor(elapsedMin)}min
            </span>
          </div>
        )}
        {isAviso && !isAtrasado && (
          <div className="bg-amber-400 px-3 py-1 flex items-center gap-1.5">
            <i className="ri-timer-line text-amber-900 text-xs" />
            <span className="text-amber-900 text-[10px] font-bold">
              {Math.floor(elapsedMin)}min aguardando
            </span>
          </div>
        )}
        {isCancelled && (
          <div className="bg-red-100 px-3 py-1 flex items-center gap-1.5 border-b border-red-200">
            <i className="ri-close-circle-line text-red-600 text-xs" />
            <span className="text-red-700 text-[10px] font-black uppercase tracking-wide">Cancelado</span>
          </div>
        )}

        {/* PDV Saving banner */}
        {pedido.isSaving && !isCancelled && (
          <div className="bg-sky-50 px-3 py-1.5 flex items-center gap-1.5 border-b border-sky-200">
            <div className="w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sky-700 text-[10px] font-bold flex-1">
              Atualizando pedido...
            </span>
          </div>
        )}

        {/* PDV Editing lock banner */}
        {pedido.isEditing && !isCancelled && (
          <div className="bg-orange-50 px-3 py-1.5 flex items-center gap-1.5 border-b border-orange-200">
            <i className="ri-edit-2-line text-orange-500 text-xs animate-pulse" />
            <span className="text-orange-700 text-[10px] font-bold flex-1">
              {pedido.editingByName
                ? `${pedido.editingByName} está editando`
                : 'Pedido em edição no PDV'} — aguardando confirmação
            </span>
            <span className="text-[10px] font-bold text-orange-500 bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-full whitespace-nowrap">
              BLOQUEADO
            </span>
          </div>
        )}

        <div className="p-3.5 space-y-2.5">
          {/* Header: número + origem + obs + timer */}
          <div className="flex items-start justify-between gap-2">
            <div
              className="flex items-center gap-1.5 flex-wrap min-w-0 cursor-pointer"
              onClick={onOpenDetail}
              title="Ver detalhes completos"
            >
              <span className="text-sm font-black text-zinc-900 whitespace-nowrap tracking-tight hover:underline">
                #{String(pedido.numero).padStart(4, '0')}
              </span>
              {isDelivery ? (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-orange-100 text-orange-700 border border-orange-200">
                  <i className="ri-motorbike-line text-[8px] mr-0.5" />Delivery
                </span>
              ) : (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${origemInfo.cor}`}>
                  {origemInfo.label}
                </span>
              )}
              {platformInfo && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${platformInfo.cor}`}>
                  <i className="ri-bike-line text-[8px] mr-0.5" />{platformInfo.label}
                </span>
              )}
              {temObs && (
                <span className="flex items-center gap-0.5 text-[10px] font-black text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full border border-amber-300 flex-shrink-0">
                  <i className="ri-alert-fill text-[9px]" />OBS
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={handlePrint}
                title="Imprimir comanda"
                className="w-6 h-6 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-500 cursor-pointer transition-colors"
              >
                <i className="ri-printer-line text-xs" />
              </button>
              {temItemComPreparo && (
                <button
                  onClick={() => setShowFicha(true)}
                  title="Ficha técnica"
                  className="w-6 h-6 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-500 cursor-pointer transition-colors"
                >
                  <i className="ri-clipboard-line text-xs" />
                </button>
              )}

              <span className={`text-xs tabular-nums ml-0.5 ${timerColor(pedido.criadoEm, pedido.status)}`}>
                {elapsedStr(pedido.criadoEm)}
              </span>
            </div>
          </div>

          {/* Destino + garçom — escondido em QR universal (identidade fica na seção da senha) */}
          {!isQRUniversal && (
            <div className="flex items-center gap-1.5 min-w-0">
              <i className={`text-xs text-zinc-400 flex-shrink-0 ${
                pedido.destino === 'mesa' ? 'ri-table-line' :
                pedido.destino === 'delivery' ? 'ri-motorbike-line' : 'ri-user-line'
              }`} />
              <span className="text-xs text-zinc-800 font-semibold truncate flex-1 min-w-0">
                {destinoLabel(pedido)}
              </span>
              {pedido.garcomNome && (
                <span className="text-[10px] text-zinc-400 flex-shrink-0 whitespace-nowrap">
                  <i className="ri-walk-line text-[9px]" /> {pedido.garcomNome.split(' ')[0]}
                </span>
              )}
            </div>
          )}

          {/* Sinal do motoboy (a caminho / coletou / problema) */}
          {isDelivery && motoboySinal && (
            <div className={'flex items-start gap-1.5 rounded-lg px-2 py-1.5 border ' + (motoboySinal.status === 'problema' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200')}>
              <i className={'text-sm mt-0.5 flex-shrink-0 ' + (motoboySinal.status === 'problema' ? 'ri-alert-fill text-red-500' : 'ri-e-bike-2-line text-blue-500')} />
              <div className="flex-1 min-w-0">
                <p className={'text-[11px] font-bold ' + (motoboySinal.status === 'problema' ? 'text-red-700' : 'text-blue-700')}>
                  {MOTOBOY_SINAL_LABEL[motoboySinal.status] ?? motoboySinal.status}
                </p>
                {motoboySinal.status === 'problema' && motoboySinal.note ? (
                  <p className="text-[10px] text-red-600">{motoboySinal.note}</p>
                ) : null}
              </div>
            </div>
          )}

          {/* Delivery address + WhatsApp */}
          {isDelivery && pedido.deliveryAddress && (
            <div className="border-t border-zinc-50 pt-2">
              <div className="flex items-start gap-1.5">
                <i className="ri-map-pin-line text-zinc-400 text-xs mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className={`text-[11px] text-zinc-600 leading-snug ${!expanded && pedido.deliveryAddress.length > 60 ? 'line-clamp-1' : ''}`}>
                    {pedido.deliveryAddress}
                  </p>
                  {pedido.deliveryAddress.length > 60 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                      className="text-[9px] text-orange-500 font-bold hover:underline cursor-pointer mt-0.5"
                    >
                      {expanded ? 'Mostrar menos' : 'Ver endereço completo'}
                    </button>
                  )}
                </div>
              </div>
              {pedido.notes && (
                <div className="flex items-start gap-1.5 mt-1">
                  <i className="ri-sticky-note-line text-zinc-300 text-xs mt-0.5 flex-shrink-0" />
                  <p className="text-[10px] text-zinc-500 italic">{pedido.notes}</p>
                </div>
              )}
              {/* SLA por distância: horário limite de preparo e de entrega */}
              {(prazoPreparoMs != null || prazoEntregaMs != null) && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {prazoPreparoMs != null && (
                    <span
                      className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border whitespace-nowrap ${
                        preparoAtrasado
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                      title="Horário limite para o pedido ficar pronto (sair para entrega)"
                    >
                      <i className="ri-fire-line text-[10px]" />
                      Preparo até {fmtHora(prazoPreparoMs)}
                    </span>
                  )}
                  {prazoEntregaMs != null && (
                    <span
                      className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border whitespace-nowrap ${
                        entregaAtrasada
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-sky-50 text-sky-700 border-sky-200'
                      }`}
                      title="Horário limite final para a entrega chegar ao cliente"
                    >
                      <i className="ri-motorbike-line text-[10px]" />
                      Entrega até {fmtHora(prazoEntregaMs)}
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <button
                  onClick={handleWhatsAppMotoboy}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap flex-shrink-0"
                  title="Compartilhar endereço + rota no WhatsApp"
                >
                  <i className="ri-whatsapp-line text-xs" />
                  Motoboy
                </button>
                {pedido.customerPhone && (
                  <button
                    onClick={handleWhatsAppCliente}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-sky-500 hover:bg-sky-600 text-white text-[10px] font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap flex-shrink-0"
                    title="Enviar mensagem ao cliente"
                  >
                    <i className="ri-whatsapp-line text-xs" />
                    Cliente
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Participante do QR Code */}
          {pedido.participantToken && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {pedido.mesaNumero != null && pedido.mesaNumero > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 border border-violet-300 text-[10px] font-black text-violet-800">
                  <i className="ri-table-line text-[9px]" />
                  Mesa {pedido.mesaNumero}
                </span>
              )}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-[10px] font-black text-violet-700">
                <i className="ri-qr-code-line text-[9px]" />
                Senha {pedido.participantToken}
              </span>
              {participanteNome && (
                <span className="text-[10px] font-semibold text-zinc-600 truncate">
                  {participanteNome}
                </span>
              )}
            </div>
          )}

          {/* Pagamento + delivery fee */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
              isPaid
                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                : 'bg-zinc-100 text-zinc-500 border border-zinc-200'
            }`}>
              {isPaid ? <><i className="ri-check-line text-[8px] mr-0.5" />Pago</> : 'Em aberto'}
            </span>
            {pedido.origem === 'autoatendimento' && pedido.paymentMethodName && (
              <span className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                <i className="ri-wallet-3-line text-[8px]" />{pedido.paymentMethodName}
              </span>
            )}
            {(pedido.deliveryFee ?? 0) > 0 && (
              <span className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                <i className="ri-bike-line text-[8px]" />
                Taxa R$ {(pedido.deliveryFee ?? 0).toFixed(2)}
              </span>
            )}
            {pedido.totalAmount > 0 && (
              <span className="flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                <i className="ri-money-dollar-circle-line text-[8px]" />
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pedido.totalAmount)}
              </span>
            )}
          </div>

          {/* Divisor */}
          <div className="border-t border-zinc-50" />

          {/* Itens */}
          <div className="space-y-2">
            {pedido.itens.map((item) => {
              const isDimmed = filtroEstacao && filtroEstacao !== 'todas' && item.estacao !== filtroEstacao;
              const isSkip = item.semPreparo || item.skip_kds;
              const itemCfg = ITEM_STATUS_CFG[item.status];

              return (
                <div key={item.id} className={`transition-opacity ${isDimmed ? 'opacity-25' : ''}`}>
                  <div className="flex items-start gap-1.5">
                    {/* Status bullet */}
                    {!isSkip && (
                      <span className={`mt-0.5 w-3.5 h-3.5 flex items-center justify-center rounded-full border flex-shrink-0 ${itemCfg.pill}`}>
                        <i className={`${itemCfg.icon} text-[8px]`} />
                      </span>
                    )}
                    {isSkip && (
                      <span className="mt-0.5 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-zinc-100 border border-zinc-200 flex-shrink-0">
                        <i className="ri-subtract-line text-[8px] text-zinc-400" />
                      </span>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] font-black text-zinc-500 flex-shrink-0">{item.quantidade}x</span>
                        <span className={`text-xs font-semibold flex-1 min-w-0 break-words ${isSkip ? 'text-zinc-400' : 'text-zinc-800'}`}>
                          {item.nome}
                        </span>
                        {item.status === 'entregue' && (
                          <span className="flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 whitespace-nowrap flex-shrink-0">
                            <i className="ri-check-double-line text-[8px]" />Entregue
                          </span>
                        )}
                        {isSkip && item.status !== 'entregue' && (
                          <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-zinc-100 text-zinc-400 border border-zinc-200 whitespace-nowrap flex-shrink-0">
                            direto
                          </span>
                        )}
                        {!isSkip && item.categoriaNome && item.status !== 'entregue' && (
                          <span className="text-[8px] font-semibold px-1 py-0.5 rounded bg-zinc-100 text-zinc-500 border border-zinc-200 whitespace-nowrap flex-shrink-0">
                            {item.categoriaNome}
                          </span>
                        )}
                        {/* Botão entregar item individual */}
                        {!isCancelled && !isDelivery && onEntregarItem && (
                          (item.status === 'pronto' || (isSkip && item.status !== 'entregue')) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onEntregarItem(item.id); }}
                              title="Entregar este item"
                              className="ml-auto flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-[9px] font-bold border border-emerald-300 cursor-pointer transition-colors whitespace-nowrap flex-shrink-0"
                            >
                              <i className="ri-check-line text-[9px]" />
                              Entregar
                            </button>
                          )
                        )}
                      </div>

                      {/* Opções */}
                      {item.opcoes && item.opcoes.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {item.opcoes.map((o, i) => (
                            <span key={i} className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 whitespace-nowrap">
                              {!o.obrigatorio && <i className="ri-add-line text-[8px]" />}
                              {o.opcaoNome}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Unidades individuais */}
                      <ItemUnidadesRow
                        item={item}
                        isCancelled={isCancelled}
                        isKioskNaoPago={pedido.origem === 'autoatendimento' && !isPaid}
                        onAvancarUnidade={onAvancarUnidade}
                        onEntregarUnidade={onEntregarUnidade}
                      />

                      {/* Observações */}
                      {item.observacoes && item.observacoes.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {item.observacoes.map((obs, i) => (
                            <div key={i} className="flex items-start gap-1 text-[9px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-1 rounded-lg">
                              <i className="ri-alert-fill text-amber-500 text-[9px] flex-shrink-0 mt-0.5" />
                              <span>{obs}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Ação principal */}
          {!isCancelled && (
            <div className="pt-1">
              {/* Block actions when order is being edited or saved in PDV */}
              {pedido.isEditing || pedido.isSaving ? (
                <div className="w-full py-2 px-3 rounded-xl border border-orange-200 bg-orange-50 flex items-center gap-2 justify-center">
                  <i className={`${pedido.isSaving ? 'ri-loader-4-line animate-spin' : 'ri-edit-2-line animate-pulse'} text-orange-500 text-sm flex-shrink-0`} />
                  <span className="text-xs font-bold text-orange-600 leading-tight whitespace-nowrap">
                    {pedido.isSaving ? 'Atualizando pedido...' : 'Editando no PDV — ações bloqueadas'}
                  </span>
                </div>
              ) : pedido.status === 'entregue' ? (
                <div className="flex items-center justify-center gap-1.5 py-2 text-zinc-400 text-xs font-semibold">
                  <i className="ri-check-double-line" />Entregue
                </div>
              ) : pedido.status === 'pronto' ? (
                // Kiosk não pago: bloquear entrega
                pedido.origem === 'autoatendimento' && !isPaid ? (
                  <div className="w-full py-2 px-3 rounded-xl border border-amber-200 bg-amber-50 flex items-center gap-2">
                    <i className="ri-store-2-line text-amber-600 text-sm flex-shrink-0" />
                    <span className="text-xs font-bold text-amber-700 leading-tight">
                      Aguardando pagamento — entrega pelo caixa
                    </span>
                  </div>
                ) : isDelivery ? (
                  <div className="flex items-center gap-2">
                    {pedido.deliveryPlatform === 'retirada' ? (
                      <button
                        onClick={onEntregar}
                        className="flex-1 py-2.5 bg-zinc-900 hover:bg-black text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-1.5"
                      >
                        <i className="ri-check-double-line" />Entregar
                      </button>
                    ) : (
                      <button
                        onClick={onEmRota}
                        className="flex-1 py-2.5 bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-1.5"
                      >
                        <i className="ri-bike-line" />Em Rota
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={onEntregar}
                    className="w-full py-2.5 bg-zinc-900 hover:bg-black text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-1.5"
                  >
                    <i className="ri-check-double-line" />Marcar Entregue
                  </button>
                )
              ) : pedido.status === 'em_rota' ? (
                <button
                  onClick={onEntregar}
                  className="w-full py-2.5 bg-zinc-900 hover:bg-black text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-1.5"
                >
                  <i className="ri-check-double-line" />Marcar Entregue
                </button>
              ) : pedido.status === 'preparo' ? (
                <button
                  onClick={onAvancar}
                  className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-1.5"
                >
                  <i className="ri-checkbox-circle-line" />Marcar Pronto
                </button>
              ) : (
                <button
                  onClick={onAvancar}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-1.5"
                >
                  <i className="ri-play-fill" />Iniciar Preparo
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── NewPedidosFlash: set de IDs que entraram nos últimos 5s ───
function useNewPedidoIds(pedidos: KDSPedido[]): Set<string> {
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const prevIdsRef = useRef<Set<string>>(new Set(pedidos.map((p) => p.id)));

  useEffect(() => {
    const currentIds = new Set(pedidos.map((p) => p.id));
    const added: string[] = [];
    currentIds.forEach((id) => {
      if (!prevIdsRef.current.has(id)) added.push(id);
    });
    if (added.length > 0) {
      setNewIds((prev) => {
        const s = new Set(prev);
        added.forEach((id) => s.add(id));
        return s;
      });
      // Remove after 4s
      setTimeout(() => {
        setNewIds((prev) => {
          const s = new Set(prev);
          added.forEach((id) => s.delete(id));
          return s;
        });
      }, 4000);
    }
    prevIdsRef.current = currentIds;
  }, [pedidos]);

  return newIds;
}

// ─── Kanban View ───
export default function GestorKanbanView({
  pedidos,
  onAvancar,
  onEmRota,
  onEntregar,
  onMudarOperador,
  onCancelar,
  onOpenDetail,
  onAvancarUnidade,
  onEntregarUnidade,
  onEntregarItem,
  operadorAtual,
  elapsed: tick,
  filtroEstacao,
  filtroStatus,
}: Props) {
  const newPedidoIds = useNewPedidoIds(pedidos);

  // ─── SLA de delivery por distância ───
  // Busca uma vez (em lote) os tempos gravados no pedido (orders.delivery_route_min /
  // delivery_sla_min) para os deliveries do link, sem mexer na RPC fn_get_kds_orders.
  const [slaMap, setSlaMap] = useState<Record<string, SlaInfo>>({});
  const deliveryIdsKey = useMemo(
    () =>
      pedidos
        .filter((p) => (p.origem === 'delivery' || p.destino === 'delivery') && p.deliveryPlatform === 'propria' && !p.isCancelled)
        .map((p) => p.id)
        .sort()
        .join(','),
    [pedidos],
  );
  useEffect(() => {
    const ids = deliveryIdsKey ? deliveryIdsKey.split(',') : [];
    const missing = ids.filter((id) => !(id in slaMap));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('orders')
        .select('id, delivery_route_min, delivery_sla_min')
        .in('id', missing);
      if (cancelled) return;
      setSlaMap((prev) => {
        const next = { ...prev };
        for (const row of (data ?? []) as Array<{ id: string; delivery_route_min: number | null; delivery_sla_min: number | null }>) {
          next[row.id] = { routeMin: row.delivery_route_min ?? null, slaMin: row.delivery_sla_min ?? null };
        }
        // Marca como conhecido (null) o que não voltou, p/ evitar refetch em loop.
        for (const id of missing) if (!(id in next)) next[id] = { routeMin: null, slaMin: null };
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryIdsKey]);

  const handleAvancarUnidade = useCallback(
    (pedidoId: string, itemId: string, unidadeId: string, novoStatus: KDSItemStatus) => {
      if (onAvancarUnidade) onAvancarUnidade(pedidoId, itemId, unidadeId, novoStatus);
    },
    [onAvancarUnidade],
  );

  const handleEntregarUnidade = useCallback(
    (pedidoId: string, itemId: string, unidadeId: string) => {
      if (onEntregarUnidade) onEntregarUnidade(pedidoId, itemId, unidadeId);
    },
    [onEntregarUnidade],
  );

  const motoboyMap = useMotoboyStatus();

  // Sort: atrasados > aviso > normal, dentro do mesmo status
  const sortedPedidos = [...pedidos].sort((a, b) => {
    const urgA = elapsedMinutes(a.criadoEm);
    const urgB = elapsedMinutes(b.criadoEm);
    return urgB - urgA; // mais antigo primeiro
  });

  const renderCard = (p: KDSPedido) => (
    <GestorCard
      key={p.id}
      pedido={p}
      onAvancar={() => onAvancar(p.id)}
      onEmRota={() => onEmRota(p.id)}
      onEntregar={() => onEntregar(p.id)}
      onMudarOperador={(op) => onMudarOperador(p.id, op)}
      onCancelar={() => onCancelar(p.id)}
      onOpenDetail={() => onOpenDetail(p.id)}
      onAvancarUnidade={(iId, uId, st) => handleAvancarUnidade(p.id, iId, uId, st)}
      onEntregarUnidade={(iId, uId) => handleEntregarUnidade(p.id, iId, uId)}
      onEntregarItem={(iId) => onEntregarItem?.(p.id, iId)}
      operadorAtual={operadorAtual}
      tick={tick}
      filtroEstacao={filtroEstacao}
      isNew={newPedidoIds.has(p.id)}
      slaInfo={slaMap[p.id]}
      motoboySinal={motoboyMap.get(p.id)}
    />
  );

  // ─── Filtro de status ativo: exibe só aquela coluna em grid ───
  if (filtroStatus && filtroStatus !== 'todos') {
    if (filtroStatus === 'cancelado') {
      const items = sortedPedidos.filter((p) => p.isCancelled);
      return (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3 w-fit border bg-red-50 border-red-200">
            <i className="ri-close-circle-line text-red-600 text-sm" />
            <span className="text-sm font-bold text-red-700">Cancelados</span>
            <span className="text-xs font-black px-2 py-0.5 rounded-full bg-red-500 text-white">{items.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-zinc-100">
                  <i className="ri-inbox-2-line text-2xl text-zinc-300" />
                </div>
                <p className="text-sm text-zinc-400 font-medium">Nenhum cancelamento nesta sessão</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3 content-start">
                {items.map(renderCard)}
              </div>
            )}
          </div>
        </div>
      );
    }

    const col = STATUS_COLS.find((c) => c.key === filtroStatus);
    const items = sortedPedidos.filter((p) => p.status === filtroStatus && !p.isCancelled);

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {col && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl mb-3 w-fit border ${col.bg} ${col.border}`}>
            <i className={`${col.icon} ${col.cor} text-sm`} />
            <span className={`text-sm font-bold ${col.cor}`}>{col.label}</span>
            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${col.badge}`}>{items.length}</span>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-zinc-100">
                <i className="ri-inbox-2-line text-2xl text-zinc-300" />
              </div>
              <p className="text-sm text-zinc-400 font-medium">{col?.emptyText ?? 'Nenhum pedido'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3 content-start">
              {items.map(renderCard)}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Kanban: mobile = cards em grid, desktop = 4 colunas ───
  return (
    <>
      {/* Mobile: cards em grid */}
      <div className="flex flex-col h-full overflow-hidden lg:hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 content-start">
            {sortedPedidos.filter((p) => !p.isCancelled).map(renderCard)}
          </div>
          {sortedPedidos.filter((p) => !p.isCancelled).length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-zinc-100">
                <i className="ri-inbox-2-line text-2xl text-zinc-300" />
              </div>
              <p className="text-sm text-zinc-400 font-medium">Nenhum pedido ativo</p>
            </div>
          )}
        </div>
      </div>

      {/* Desktop: 4 colunas kanban */}
      <div className="hidden lg:flex gap-3 h-full overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 min-w-max lg:min-w-0 lg:w-full h-full">
          {STATUS_COLS.map((col) => {
            const items = sortedPedidos.filter((p) => p.status === col.key && !p.isCancelled);
            const atrasados = items.filter((p) => elapsedMinutes(p.criadoEm) > 20 && p.status !== 'entregue' && p.status !== 'pronto').length;

            return (
              <div
                key={col.key}
                className="flex flex-col w-[300px] lg:flex-1 lg:w-auto min-w-0 overflow-hidden flex-shrink-0"
              >
                <div className={`flex items-center justify-between px-3 py-2.5 rounded-xl mb-3 border ${col.bg} ${col.border}`}>
                  <div className="flex items-center gap-2">
                    <i className={`${col.icon} ${col.cor} text-sm`} />
                    <span className={`text-sm font-bold ${col.cor}`}>{col.label}</span>
                    {atrasados > 0 && (
                      <span className="flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-red-500 text-white animate-pulse">
                        <i className="ri-alarm-warning-line text-[8px]" />{atrasados}
                      </span>
                    )}
                  </div>
                  <span className={`text-xs font-black px-2 py-0.5 rounded-full ${col.badge}`}>
                    {items.length}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5">
                  {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-2">
                      <i className="ri-inbox-2-line text-2xl text-zinc-200" />
                      <p className="text-xs text-zinc-300 text-center">{col.emptyText}</p>
                    </div>
                  ) : (
                    items.map(renderCard)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
