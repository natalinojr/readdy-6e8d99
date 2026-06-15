import { useState, useEffect } from 'react';
import type { PedidoRecente, PedidoItemDetalhe, PagamentoPedido } from '@/types/pdv';
import { isQRUniversal, clienteNome } from './utils';
import { supabase } from '@/lib/supabase';
import { PLATAFORMAS_DELIVERY } from '@/constants/delivery';
import { useImpressoras } from '@/contexts/ImpressorasContext';
import { sendToPrinter } from '@/lib/printUtils';
import { useToast } from '@/contexts/ToastContext';

interface Props {
  pedido: PedidoRecente;
  onClose: () => void;
}

interface FinancialDetails {
  subtotal: number;
  discount_amount: number;
  service_fee_amount: number;
  tip_amount: number;
  total_amount: number;
}

function useOrderFinancials(orderId: string) {
  const [details, setDetails] = useState<FinancialDetails | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('orders')
      .select('subtotal, discount_amount, service_fee_amount, tip_amount, total_amount')
      .eq('id', orderId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) {
          setDetails({
            subtotal: Number(data.subtotal) || 0,
            discount_amount: Number(data.discount_amount) || 0,
            service_fee_amount: Number(data.service_fee_amount) || 0,
            tip_amount: Number(data.tip_amount) || 0,
            total_amount: Number(data.total_amount) || 0,
          });
        }
      });
    return () => { cancelled = true; };
  }, [orderId]);
  return details;
}

const STATUS_LABEL: Record<string, string> = {
  aberto: 'Em aberto', pronto: 'Pronto', entregue: 'Entregue', cancelado: 'Cancelado',
  new: 'Na Fila', preparing: 'Em preparo', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado',
};
const STATUS_COLOR: Record<string, string> = {
  aberto: 'bg-amber-100 text-amber-700 border-amber-200', pronto: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  entregue: 'bg-sky-100 text-sky-700 border-sky-200', cancelado: 'bg-red-100 text-red-700 border-red-200',
  new: 'bg-zinc-100 text-zinc-600 border-zinc-200', preparing: 'bg-amber-100 text-amber-700 border-amber-200',
  ready: 'bg-emerald-100 text-emerald-700 border-emerald-200', delivered: 'bg-sky-100 text-sky-700 border-sky-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
};
const STATUS_ICON: Record<string, string> = {
  aberto: 'ri-fire-line', pronto: 'ri-checkbox-circle-line', entregue: 'ri-truck-line', cancelado: 'ri-close-circle-line',
  new: 'ri-time-line', preparing: 'ri-fire-line', ready: 'ri-checkbox-circle-line', delivered: 'ri-truck-line', cancelled: 'ri-close-circle-line',
};
const UNIDADE_COLOR: Record<string, string> = {
  aguardando: 'bg-zinc-100 text-zinc-500', preparo: 'bg-amber-100 text-amber-700',
  pronto: 'bg-emerald-100 text-emerald-700', entregue: 'bg-sky-100 text-sky-700',
};
const UNIDADE_ICON: Record<string, string> = {
  aguardando: 'ri-time-line', preparo: 'ri-fire-line', pronto: 'ri-checkbox-circle-line', entregue: 'ri-truck-line',
};
const ORIGEM_LABEL: Record<string, string> = {
  caixa: 'PDV Caixa', garcom: 'PDV Garçom', mesa: 'Mesa (QR Code)', autoatendimento: 'Autoatendimento', delivery: 'Delivery',
};
const ORIGEM_ICON: Record<string, string> = {
  caixa: 'ri-store-line', garcom: 'ri-user-star-line', mesa: 'ri-qr-code-line', autoatendimento: 'ri-tablet-line', delivery: 'ri-e-bike-2-line',
};

const PLATAFORMA_MAP: Record<string, { label: string; icon: string; cor: string }> = {};
PLATAFORMAS_DELIVERY.forEach((p) => { PLATAFORMA_MAP[p.key] = { label: p.label, icon: p.icon, cor: p.cor }; });

function DeliveryPlatformBadge({ platform, fee }: { platform?: string | null; fee?: number | null }) {
  if (!platform) return null;
  const info = PLATAFORMA_MAP[platform];
  if (!info) return null;
  return (
    <div className="flex items-center gap-2 p-3 bg-zinc-50 rounded-xl border border-zinc-100">
      <div className={`w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 text-xs ${info.cor}`}><i className={info.icon} /></div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Plataforma</p>
        <p className="text-sm font-bold text-zinc-800">{info.label}</p>
      </div>
      {fee != null && fee > 0 && (
        <div className="text-right">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Taxa entrega</p>
          <p className="text-sm font-bold text-red-600">R$ {fee.toFixed(2)}</p>
        </div>
      )}
    </div>
  );
}

function getDestinoLabel(pedido: PedidoRecente): string {
  if (isQRUniversal(pedido)) {
    const nome = clienteNome(pedido);
    if (pedido.participantToken) return `Senha ${pedido.participantToken}${nome ? ` - ${nome}` : ''}`;
    return nome || 'QR Code';
  }
  if (pedido.destino === 'mesa') return `Mesa ${pedido.mesaNumero ?? ''}`;
  if (pedido.destino === 'nome') return pedido.nomeCliente ?? '—';
  if (pedido.destino === 'senha') return `Senha ${pedido.senha ?? ''}`;
  if (pedido.destino === 'hora' || pedido.destino === 'na_hora') return 'Na hora';
  if (pedido.destino === 'delivery') return pedido.nomeCliente ?? 'Delivery';
  return '—';
}

function getStatusFase(status: string): 'novo' | 'preparo' | 'pronto' | 'entregue' | 'cancelado' {
  if (status === 'cancelled' || status === 'cancelado') return 'cancelado';
  if (status === 'delivered' || status === 'entregue') return 'entregue';
  if (status === 'ready' || status === 'pronto') return 'pronto';
  if (status === 'preparing' || status === 'aberto') return 'preparo';
  return 'novo';
}

function isActiveStatus(status: string): boolean {
  return status === 'new' || status === 'preparing' || status === 'ready';
}

function diffMin(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const diff = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  return diff >= 0 ? diff : null;
}

function fmtDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
  if (m > 0) return `${m}min ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function parseTs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const d = new Date(ts).getTime();
  return isNaN(d) ? null : d;
}

function minMaxTs(timestamps: (string | null | undefined)[]): { min: number | null; max: number | null } {
  const nums = timestamps.map(parseTs).filter((n): n is number => n !== null);
  if (nums.length === 0) return { min: null, max: null };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function useImpressoraPedidos() {
  const { getImpressoraParaEstacao } = useImpressoras();
  return getImpressoraParaEstacao('pedidos');
}

function buildPedidoHTML(pedido: PedidoRecente & { total: number }): string {
  const items = pedido.itensDetalhes.map((i) =>
    `<tr><td>${i.quantidade}x ${i.nome}</td><td style="text-align:right">R$ ${(i.preco * i.quantidade).toFixed(2)}</td></tr>`,
  ).join('');
  const numDisplay = pedido.numeroCodigo ?? String(pedido.numero).padStart(4, '0');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Pedido #${numDisplay}</title>
<style>* { margin:0; padding:0; box-sizing:border-box; } body { font-family: Arial, sans-serif; padding: 12px; width: 320px; }
h2 { text-align:center; margin-bottom:4px; font-size:18px; } p { margin:2px 0; }
table { width:100%; border-collapse:collapse; } td { padding:3px 0; font-size:13px; }
.total { border-top:2px solid #000; font-weight:bold; font-size:15px; } .center { text-align:center; }
.divider { border-top:1px dashed #999; margin:8px 0; } .small { font-size:11px; color:#666; }</style></head>
<body><h2>PEDIDO #${numDisplay}</h2><p class="center small">${new Date().toLocaleString('pt-BR')}</p>
<div class="divider"></div><table>${items}</table><div class="divider"></div>
<table><tr class="total"><td>TOTAL</td><td style="text-align:right">R$ ${pedido.total.toFixed(2)}</td></tr></table>
<div class="divider"></div><p class="center">${pedido.pago ? 'PAGO' : 'PENDENTE'}</p></body></html>`;
}

async function printPedidoResumo(
  pedido: PedidoRecente & { total: number },
  impressora: ReturnType<typeof useImpressoraPedidos>,
  toastError: (title: string, msg: string) => void,
) {
  const html = buildPedidoHTML(pedido);
  const result = await sendToPrinter(html, impressora, undefined, { paperWidthPx: 320 });
  if (!result.success && !result.fallbackToBrowser) {
    toastError('Erro na impressão', result.error || 'Não foi possível imprimir');
  }
}

function LiveTimer({ fromTs, label, colorClass }: { fromTs: string; label: string; colorClass: string }) {
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.floor((nowMs - new Date(fromTs).getTime()) / 1000));
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${colorClass}`}>
      <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse flex-shrink-0" />
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
        <p className="text-sm font-black tabular-nums">{fmtDuration(elapsed)}</p>
      </div>
    </div>
  );
}

interface SlaCardProps {
  fromTs: string | null | undefined;
  toTs?: string | null | undefined;
  staticMins?: number;
  icon: string;
  label: string;
  alertMins?: number;
  warnMins?: number;
  isAtrasado?: boolean;
  isNoPrazo?: boolean;
  isFinalized?: boolean;
}

function SlaCardLive({ fromTs, toTs, staticMins, icon, label, alertMins, warnMins, isAtrasado, isNoPrazo, isFinalized }: SlaCardProps) {
  const isRunning = !!fromTs && !toTs && !isFinalized;
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  let secs: number;
  if (fromTs) {
    const from = new Date(fromTs).getTime();
    const to = toTs ? new Date(toTs).getTime() : nowMs;
    secs = Math.max(0, Math.floor((to - from) / 1000));
  } else {
    secs = (staticMins ?? 0) * 60;
  }
  if (isFinalized && !toTs && staticMins !== undefined) secs = staticMins * 60;

  const mins = Math.floor(secs / 60);
  const secsRem = secs % 60;
  const isCritico = isRunning && warnMins !== undefined && mins >= warnMins;
  const isAlerta = isRunning && alertMins !== undefined && mins >= alertMins && !isCritico;

  const bgClass = isCritico || isAtrasado ? 'bg-red-50 border-red-100' : isNoPrazo ? 'bg-emerald-50 border-emerald-100' : isAlerta ? 'bg-amber-50 border-amber-100' : 'bg-zinc-50 border-zinc-100';
  const iconBgClass = isCritico || isAtrasado ? 'bg-red-100' : isNoPrazo ? 'bg-emerald-100' : isAlerta ? 'bg-amber-100' : 'bg-zinc-200';
  const iconColorClass = isCritico || isAtrasado ? 'text-red-500' : isNoPrazo ? 'text-emerald-500' : isAlerta ? 'text-amber-500' : 'text-zinc-500';
  const textColorClass = isCritico || isAtrasado ? 'text-red-700' : isNoPrazo ? 'text-emerald-700' : 'text-zinc-800';
  const display = fromTs ? (mins > 0 ? `${mins}min${secsRem > 0 ? ` ${secsRem}s` : ''}` : `${secsRem}s`) : staticMins !== undefined ? `${staticMins}min` : '—';

  return (
    <div className={`p-2.5 rounded-xl border text-center ${bgClass}`}>
      <div className={`w-6 h-6 flex items-center justify-center mx-auto mb-1 rounded-lg ${iconBgClass}`}>
        <i className={`${icon} text-xs ${iconColorClass} ${isRunning ? 'animate-pulse' : ''}`} />
      </div>
      <div className="flex items-center justify-center gap-1">
        <p className={`text-base font-black ${textColorClass} tabular-nums`}>{display}</p>
        {isRunning && <span className="w-1.5 h-1.5 rounded-full opacity-60 animate-ping" style={{ backgroundColor: isCritico ? '#dc2626' : isAlerta ? '#d97706' : '#71717a' }} />}
      </div>
      <p className="text-[9px] text-zinc-400 font-semibold uppercase tracking-wide mt-0.5">{label}</p>
      {isAlerta && !isCritico && <span className="text-[9px] text-orange-600 font-bold block">Acima do ideal</span>}
    </div>
  );
}

interface TimelineStep {
  label: string; icon: string; done: boolean; active: boolean; time?: string; duracao?: string | null;
}

function PedidoTimeline({ pedido }: { pedido: PedidoRecente }) {
  const fase = getStatusFase(pedido.status);
  const isCancelled = fase === 'cancelado';
  const todasUnidades = pedido.itensDetalhes.flatMap((i) => i.unidades);
  const totalUnid = todasUnidades.length;
  const unidadesComCozinha = todasUnidades.filter((u) => !u.semCozinha);
  const totalComCozinha = unidadesComCozinha.length;
  const qtdAguardando = unidadesComCozinha.filter((u) => u.status === 'aguardando').length;
  const qtdPreparo = unidadesComCozinha.filter((u) => u.status === 'preparo').length;
  const qtdPronto = unidadesComCozinha.filter((u) => u.status === 'pronto' || u.status === 'entregue').length + todasUnidades.filter((u) => u.semCozinha && u.status !== 'entregue').length;
  const qtdEntregue = todasUnidades.filter((u) => u.status === 'entregue').length;
  const inicioPreparoTs = todasUnidades.map((u) => u._iniciadoPreparoTs).filter(Boolean).sort()[0] ?? null;
  const prontoTs = todasUnidades.map((u) => u._prontoTs).filter(Boolean).sort().at(-1) ?? null;
  const entregueTs = (() => {
    if (totalUnid === 0) return null;
    const todasEntregues = todasUnidades.every((u) => !!u._entregueTs);
    if (!todasEntregues) return null;
    const { max } = minMaxTs(todasUnidades.map((u) => u._entregueTs));
    return max ? new Date(max).toISOString() : null;
  })();
  const criadoTs = pedido.itensDetalhes[0]?.unidades[0]?._criadoTs ?? null;
  const fmtH = (ts: string | null) => ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : undefined;
  const duracaoEspera = (() => { const m = diffMin(criadoTs, inicioPreparoTs); return m !== null ? (m < 1 ? '<1min' : `${m}min`) : null; })();
  const duracaoPreparo = (() => { const m = diffMin(inicioPreparoTs, prontoTs); return m !== null ? (m < 1 ? '<1min' : `${m}min`) : null; })();
  const duracaoEntrega = (() => { const m = diffMin(prontoTs, entregueTs); return m !== null ? (m < 1 ? '<1min' : `${m}min`) : null; })();
  const showBadges = totalUnid > 1;
  type StepWithBadge = TimelineStep & { badge?: string | null; badgeColor?: string; };
  const steps: StepWithBadge[] = [
    { label: 'Criado', icon: 'ri-file-add-line', done: true, active: fase === 'novo', time: pedido.criadoEm, duracao: null, badge: showBadges && totalComCozinha > 0 && qtdAguardando > 0 ? `${qtdAguardando}/${totalComCozinha} na fila` : null, badgeColor: 'bg-zinc-100 text-zinc-500' },
    { label: 'Em preparo', icon: 'ri-fire-line', done: fase === 'pronto' || fase === 'entregue', active: fase === 'preparo' || qtdPreparo > 0, time: fmtH(inicioPreparoTs), duracao: duracaoEspera, badge: showBadges && totalComCozinha > 0 && (qtdPreparo > 0 || fase === 'preparo') ? `${qtdPreparo}/${totalComCozinha}` : null, badgeColor: 'bg-amber-100 text-amber-700' },
    { label: 'Pronto', icon: 'ri-checkbox-circle-line', done: fase === 'entregue', active: fase === 'pronto' || qtdPronto > 0, time: fmtH(prontoTs), duracao: duracaoPreparo, badge: showBadges && qtdPronto > 0 ? `${qtdPronto}/${totalUnid}` : null, badgeColor: 'bg-emerald-100 text-emerald-700' },
    { label: 'Entregue', icon: 'ri-truck-line', done: fase === 'entregue', active: false, time: fmtH(entregueTs), duracao: duracaoEntrega, badge: showBadges && qtdEntregue > 0 ? `${qtdEntregue}/${totalUnid}` : null, badgeColor: 'bg-sky-100 text-sky-700' },
  ];

  if (isCancelled) {
    return (
      <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl">
        <div className="w-7 h-7 flex items-center justify-center bg-red-100 rounded-full flex-shrink-0"><i className="ri-close-circle-line text-red-600 text-sm" /></div>
        <div>
          <p className="text-xs font-bold text-red-700">Pedido Cancelado</p>
          {pedido.cancelReason && <p className="text-[10px] text-red-500 mt-0.5">Motivo: {pedido.cancelReason}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide">Linha do Tempo</p>
        {showBadges && <span className="text-[10px] text-zinc-400 font-medium">{totalUnid} unidade{totalUnid > 1 ? 's' : ''}{totalComCozinha > 0 && totalComCozinha !== totalUnid && ` (${totalComCozinha} com cozinha)`}</span>}
      </div>
      <div className="flex items-center gap-0">
        {steps.map((step, idx) => (
          <div key={step.label} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`w-8 h-8 flex items-center justify-center rounded-full border-2 transition-all ${step.done ? 'bg-emerald-500 border-emerald-500' : step.label === 'Pronto' && step.active ? 'bg-emerald-400 border-emerald-400' : step.label === 'Em preparo' && step.active ? 'bg-emerald-400 border-emerald-400 animate-pulse' : step.active ? 'bg-amber-500 border-amber-500 animate-pulse' : 'bg-white border-zinc-200'}`}>
                <i className={`${step.icon} text-sm ${step.done || step.active ? 'text-white' : 'text-zinc-300'}`} />
              </div>
              <p className={`text-[9px] font-semibold mt-1 text-center leading-tight max-w-[56px] ${step.done ? 'text-emerald-600' : step.label === 'Pronto' && step.active ? 'text-emerald-500' : step.label === 'Em preparo' && step.active ? 'text-emerald-500' : step.active ? 'text-amber-600' : 'text-zinc-400'}`}>{step.label}</p>
              {step.time && <p className="text-[8px] text-zinc-500 font-medium mt-0.5">{step.time}</p>}
              {step.duracao && (step.done || step.active) && <p className="text-[8px] text-zinc-400 mt-0.5 text-center leading-tight max-w-[60px]">{step.duracao}</p>}
              {step.badge && <span className={`mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${step.badgeColor}`}>{step.badge}</span>}
            </div>
            {idx < steps.length - 1 && <div className={`flex-1 h-0.5 mx-1 mb-5 rounded-full ${steps[idx + 1].done ? 'bg-emerald-400' : steps[idx + 1].active ? 'bg-emerald-200' : 'bg-zinc-200'}`} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function getPaymentIcon(name: string | null, type?: string | null, changeAmount?: number | null): string {
  if (changeAmount != null && changeAmount > 0) return 'ri-money-dollar-circle-line';
  const t = (type ?? '').toLowerCase();
  if (t === 'dinheiro') return 'ri-money-dollar-circle-line';
  if (t === 'credito' || t === 'crédito') return 'ri-bank-card-line';
  if (t === 'debito' || t === 'débito') return 'ri-bank-card-2-line';
  if (t === 'pix') return 'ri-qr-code-line';
  if (t === 'vale') return 'ri-coupon-line';
  if (!name) return 'ri-wallet-3-line';
  const n = name.toLowerCase();
  if (n.includes('pix')) return 'ri-qr-code-line';
  if (n.includes('dinheiro') || n.includes('espécie') || n.includes('especie') || n.includes('cash')) return 'ri-money-dollar-circle-line';
  if (n.includes('crédito') || n.includes('credito')) return 'ri-bank-card-line';
  if (n.includes('débito') || n.includes('debito')) return 'ri-bank-card-2-line';
  if (n.includes('vale') || n.includes('vr') || n.includes('va')) return 'ri-coupon-line';
  return 'ri-wallet-3-line';
}

function isDinheiro(name: string | null, type?: string | null, changeAmount?: number | null): boolean {
  if (changeAmount != null && changeAmount > 0) return true;
  const t = (type ?? '').toLowerCase();
  if (t === 'dinheiro') return true;
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes('dinheiro') || n.includes('espécie') || n.includes('especie') || n.includes('cash');
}

function paymentMethodLabel(name: string | null, type?: string | null, changeAmount?: number | null): string {
  if (name) return name;
  const t = (type ?? '').toLowerCase();
  if (t === 'dinheiro' || (changeAmount != null && changeAmount > 0)) return 'Dinheiro';
  if (t === 'credito' || t === 'crédito') return 'Cartão de Crédito';
  if (t === 'debito' || t === 'débito') return 'Cartão de Débito';
  if (t === 'pix') return 'PIX';
  if (t === 'vale') return 'Vale/Refeição';
  return 'Forma de pagamento não identificada';
}

function canalRegistro(cashRegisterId: string | null | undefined, orderOrigin: string): { label: string; icon: string; color: string } | null {
  if (cashRegisterId) return { label: 'Caixa', icon: 'ri-safe-2-line', color: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (orderOrigin === 'waiter' || orderOrigin === 'garcom') return { label: 'Garçom', icon: 'ri-walk-line', color: 'bg-sky-50 text-sky-700 border-sky-200' };
  if (orderOrigin === 'table' || orderOrigin === 'mesa') return { label: 'Mesa', icon: 'ri-restaurant-2-line', color: 'bg-violet-50 text-violet-700 border-violet-200' };
  if (orderOrigin === 'delivery') return { label: 'Delivery', icon: 'ri-e-bike-line', color: 'bg-orange-50 text-orange-700 border-orange-200' };
  if (orderOrigin === 'self_service' || orderOrigin === 'autoatendimento') return { label: 'Autoatendimento', icon: 'ri-tablet-line', color: 'bg-teal-50 text-teal-700 border-teal-200' };
  if (orderOrigin === 'caixa' || orderOrigin === 'cashier') return { label: 'Caixa', icon: 'ri-safe-2-line', color: 'bg-amber-50 text-amber-700 border-amber-200' };
  return null;
}

// ─── Seção de pagamento detalhada ─────────────────────────────────────────────
// isConsolidated=true: pg.amount já é o valor cobrado (processado em consolidatePayments)
// isConsolidated=false: pg.amount é o valor bruto do banco (pode incluir troco p/ dinheiro)
function PagamentoDetalhado({ pedido, isConsolidated }: { pedido: PedidoRecente; isConsolidated?: boolean }) {
  const fase = getStatusFase(pedido.status);
  const hasPagamentos = pedido.pagamentos && pedido.pagamentos.length > 0;

  if (!hasPagamentos) {
    return (
      <div className="flex items-center justify-between py-2">
        <span className="text-xs text-zinc-500">Status do pagamento</span>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${pedido.pago ? 'bg-emerald-100 text-emerald-700' : fase === 'cancelado' ? 'bg-zinc-100 text-zinc-500' : 'bg-amber-100 text-amber-700'}`}>
          {pedido.pago ? <><i className="ri-check-line mr-0.5" />Pago</> : fase === 'cancelado' ? 'Cancelado' : 'Pendente'}
        </span>
      </div>
    );
  }

  // amount já é o valor cobrado (convenção do banco), tanto no consolidado quanto no individual
  const totalPago = pedido.pagamentos.reduce((acc, p) => acc + p.amount, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide">Pagamento</p>
        <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
          <i className="ri-checkbox-circle-line" />Pago
        </span>
      </div>

      <div className="space-y-2">
        {pedido.pagamentos.map((pg) => {
          const pgExtended = pg as PagamentoPedido;
          const ehDinheiro = isDinheiro(pg.payment_method_name, pgExtended.payment_method_type ?? null, pgExtended.change_amount ?? null);
          const operador = pgExtended.operator_name;
          const cashRegisterId = pgExtended.cash_register_id ?? null;
          const canal = canalRegistro(cashRegisterId, pedido.origem);
          const trocoRaw = pgExtended.change_amount != null ? pgExtended.change_amount : null;
          const troco = trocoRaw != null && trocoRaw > 0 ? trocoRaw : null;
          // amount já é o valor cobrado (convenção do banco); valor entregue = cobrado + troco
          const valorCobrado = pg.amount;
          const valorEntregue = ehDinheiro ? valorCobrado + (trocoRaw ?? 0) : null;
          const nomePg = paymentMethodLabel(pg.payment_method_name, pgExtended.payment_method_type ?? null, pgExtended.change_amount ?? null);

          return (
            <div key={pg.id} className={`rounded-xl border p-3.5 ${ehDinheiro ? 'bg-emerald-50/60 border-emerald-100' : 'bg-zinc-50 border-zinc-100'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0 ${ehDinheiro ? 'bg-emerald-100' : 'bg-white border border-zinc-200'}`}>
                  <i className={`${getPaymentIcon(pg.payment_method_name, pgExtended.payment_method_type ?? null, pgExtended.change_amount ?? null)} text-base ${ehDinheiro ? 'text-emerald-600' : 'text-zinc-500'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-zinc-800 leading-tight">{nomePg}</p>
                  {canal && (
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold mt-1 px-1.5 py-0.5 rounded-full border ${canal.color}`}>
                      <i className={`${canal.icon} text-[9px]`} />{canal.label}
                    </span>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-base font-black text-zinc-900">R$ {valorCobrado.toFixed(2)}</p>
                  <p className="text-[10px] text-zinc-400">valor cobrado</p>
                </div>
              </div>

              {ehDinheiro && (
                <div className="mt-3 pt-3 border-t border-emerald-200/60 space-y-2">
                  {valorEntregue != null && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500 flex items-center gap-1.5"><i className="ri-hand-coin-line text-zinc-400" />Valor entregue pelo cliente</span>
                      <span className="font-bold text-zinc-700">R$ {valorEntregue.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500 flex items-center gap-1.5"><i className="ri-subtract-line text-zinc-400" />Total cobrado</span>
                    <span className="font-bold text-zinc-700">R$ {valorCobrado.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-emerald-200/60">
                    <span className="text-sm font-bold text-emerald-700 flex items-center gap-1.5"><i className="ri-coins-line" />Troco</span>
                    <span className={`text-base font-black ${troco != null && troco > 0 ? 'text-emerald-700' : 'text-zinc-400'}`}>R$ {(trocoRaw ?? 0).toFixed(2)}</span>
                  </div>
                </div>
              )}

              {operador && (
                <div className="mt-3 pt-2 border-t border-zinc-100 flex items-center gap-1.5">
                  <i className="ri-user-follow-line text-zinc-400 text-xs" />
                  <span className="text-[11px] text-zinc-500">Registrado por:</span>
                  <span className="text-[11px] font-bold text-zinc-700">{operador}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pedido.pagamentos.length > 1 && (
        <div className="flex items-center justify-between p-3 bg-zinc-100 rounded-xl">
          <span className="text-xs font-semibold text-zinc-600">Total pago</span>
          <span className="text-sm font-black text-zinc-900">R$ {totalPago.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

interface PedidoConteudoProps {
  pedido: PedidoRecente; isGrupo?: boolean; index?: number; showResumo?: boolean;
}

function PedidoConteudo({ pedido, isGrupo, index, showResumo = true }: PedidoConteudoProps) {
  const fase = getStatusFase(pedido.status);
  const isActive = isActiveStatus(pedido.status);
  const financials = useOrderFinancials(pedido.id);
  const totalReal = financials?.total_amount ?? pedido.total;
  const subtotalReal = financials?.subtotal ?? pedido.subtotal ?? pedido.total;
  const descontoReal = financials?.discount_amount ?? pedido.desconto ?? 0;
  const serviceFeeReal = financials?.service_fee_amount ?? pedido.serviceFee ?? 0;
  const tipReal = financials?.tip_amount ?? pedido.tipAmount ?? 0;
  const criadoTs = pedido._criadoTs ?? pedido.itensDetalhes[0]?.unidades[0]?._criadoTs ?? null;
  const todasUnidades = pedido.itensDetalhes.flatMap((i) => i.unidades);
  const totalUnidades = todasUnidades.length;
  const primeiroInicioPreparoTs = todasUnidades.map((u) => u._iniciadoPreparoTs).filter(Boolean).sort()[0] ?? null;
  const unidadesAguardando = todasUnidades.filter((u) => u.status === 'aguardando').length;
  const allStartedPreparing = totalUnidades > 0 && unidadesAguardando === 0;
  const ultimoInicioPreparoTs = allStartedPreparing ? (todasUnidades.map((u) => u._iniciadoPreparoTs).filter(Boolean).sort().at(-1) ?? null) : null;
  const unidadesNaoProntas = todasUnidades.filter((u) => u.status !== 'pronto' && u.status !== 'entregue').length;
  const allDoneCooking = totalUnidades > 0 && unidadesNaoProntas === 0;
  const ultimoProntoTs = allDoneCooking ? (todasUnidades.map((u) => u._prontoTs).filter(Boolean).sort().at(-1) ?? null) : null;
  const entregueTs = (() => {
    if (totalUnidades === 0) return null;
    const todasEntregues = todasUnidades.every((u) => !!u._entregueTs);
    if (!todasEntregues) return null;
    const { max } = minMaxTs(todasUnidades.map((u) => u._entregueTs));
    return max ? new Date(max).toISOString() : null;
  })();
  const inicioPreparoTs = primeiroInicioPreparoTs;
  const prontoTs = minMaxTs(todasUnidades.map((u) => u._prontoTs)).max ? new Date(minMaxTs(todasUnidades.map((u) => u._prontoTs)).max!).toISOString() : null;
  const itensProntosReal = pedido.itensDetalhes.reduce((acc, item) => acc + item.unidades.filter((u) => u.status === 'pronto' || u.status === 'entregue').length, 0);
  const itensTotalReal = pedido.itensDetalhes.reduce((acc, item) => acc + item.quantidade, 0);
  const prontosPct = itensTotalReal > 0 ? Math.round((itensProntosReal / itensTotalReal) * 100) : 0;
  const hasSla = pedido.slaEspera !== undefined || pedido.slaCozinha !== undefined;
  const isAtrasado = pedido.atrasado === true;
  const isNoPrazo = pedido.atrasado === false && fase === 'entregue';

  return (
    <div className="space-y-5">
      {isGrupo && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
          <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg flex-shrink-0"><i className="ri-file-list-3-line text-amber-600 text-sm" /></div>
          <div>
            <p className="text-xs font-bold text-amber-800">
              Pedido #{pedido.numeroCodigo ?? String(pedido.numero).padStart(4, '0')}
              {index != null && <span className="text-zinc-400 font-normal ml-1">({index + 1})</span>}
            </p>
            <p className="text-[10px] text-amber-600 mt-0.5">{pedido.itensDetalhes.length} item{pedido.itensDetalhes.length !== 1 ? 's' : ''} · R$ {pedido.total.toFixed(2)}</p>
          </div>
        </div>
      )}

      {isActive && criadoTs && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <LiveTimer fromTs={criadoTs} label="Tempo total" colorClass="bg-amber-500 text-white border-amber-400" />
          {fase === 'preparo' && inicioPreparoTs && <LiveTimer fromTs={inicioPreparoTs} label="Em preparo há" colorClass="bg-amber-50 text-amber-700 border-amber-200" />}
          {fase === 'pronto' && prontoTs && <LiveTimer fromTs={prontoTs} label="Pronto há" colorClass="bg-emerald-50 text-emerald-700 border-emerald-200" />}
          {fase === 'novo' && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-zinc-50 border-zinc-200 text-zinc-500">
              <i className="ri-time-line text-sm" />
              <div><p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Status</p><p className="text-sm font-bold">Na Fila</p></div>
            </div>
          )}
        </div>
      )}

      <PedidoTimeline pedido={pedido} />

      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100"><p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">Destino</p><p className="text-sm font-bold text-zinc-800">{getDestinoLabel(pedido)}</p></div>
        <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100"><p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">Origem</p><div className="flex items-center gap-1.5"><i className={`${ORIGEM_ICON[pedido.origem] ?? 'ri-store-line'} text-zinc-500 text-sm`} /><p className="text-sm font-bold text-zinc-800">{isQRUniversal(pedido) ? 'QR CODE' : (ORIGEM_LABEL[pedido.origem] ?? pedido.origem)}</p></div></div>
        <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100"><p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">Total</p>
          {fase === 'cancelado' ? (
            <p className="text-sm font-bold text-red-400">Cancelado</p>
          ) : (
            <p className="text-sm font-bold text-zinc-800">R$ {totalReal.toFixed(2)}</p>
          )}
        </div>
      </div>

      {pedido.origem === 'delivery' && pedido.deliveryPlatform && <DeliveryPlatformBadge platform={pedido.deliveryPlatform} fee={pedido.deliveryFee} />}

      {(pedido.garcomNome || pedido.tempoAberto !== undefined) && (
        <div className="grid grid-cols-2 gap-3">
          {pedido.garcomNome && (
            <div className="flex items-center gap-2.5 p-3 bg-amber-50 border border-amber-100 rounded-xl">
              <i className="ri-user-star-line text-amber-600" />
              <div><p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Operador</p><p className="text-sm font-semibold text-zinc-800">{pedido.garcomNome}</p></div>
            </div>
          )}
          {pedido.tempoAberto !== undefined && !isActive && (
            <div className="flex items-center gap-2.5 p-3 bg-sky-50 border border-sky-100 rounded-xl">
              <i className="ri-timer-line text-sky-600" />
              <div><p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Tempo total</p><p className="text-sm font-semibold text-zinc-800">{pedido.tempoAberto} min</p></div>
            </div>
          )}
        </div>
      )}

      {fase !== 'cancelado' && (
        <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-zinc-600">Progresso da cozinha</p>
            <span className="text-xs font-bold text-zinc-800">{itensProntosReal}/{itensTotalReal} prontos</span>
          </div>
          <div className="h-2 bg-zinc-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${fase === 'entregue' ? 'bg-sky-500' : 'bg-emerald-500'}`} style={{ width: `${prontosPct}%` }} />
          </div>
        </div>
      )}

      {hasSla && fase !== 'cancelado' && (
        <div className="rounded-xl border overflow-hidden">
          <div className={`flex items-center justify-between px-4 py-3 border-b ${isAtrasado ? 'bg-red-50 border-red-100' : isNoPrazo ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
            <div className="flex items-center gap-2">
              <i className={`ri-timer-flash-line text-sm ${isAtrasado ? 'text-red-500' : isNoPrazo ? 'text-emerald-600' : 'text-amber-500'}`} />
              <p className="text-xs font-bold text-zinc-700">SLA &amp; Tempos</p>
            </div>
            {isAtrasado && <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700 border border-red-200"><i className="ri-error-warning-line" />Entregue com atraso</span>}
            {isNoPrazo && <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200"><i className="ri-checkbox-circle-line" />Entregue no prazo</span>}
            {!isAtrasado && !isNoPrazo && pedido.slaAlvo && <span className="text-xs text-zinc-500 font-medium">Meta: {pedido.slaAlvo} min</span>}
          </div>
          <div className="p-4 space-y-3">
            {pedido.slaAlvo !== undefined && pedido.tempoAberto !== undefined && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-zinc-500 font-medium">
                  <span>0 min</span>
                  <span className="text-zinc-400">meta: {pedido.slaAlvo}min</span>
                  {pedido.tempoAberto > pedido.slaAlvo ? <span className="text-red-500 font-bold">real: {pedido.tempoAberto}min (+{pedido.tempoAberto - pedido.slaAlvo}min)</span> : <span className="text-emerald-600 font-bold">real: {pedido.tempoAberto}min</span>}
                </div>
                <div className="relative h-3 bg-zinc-100 rounded-full overflow-hidden">
                  <div className="absolute inset-0 bg-zinc-200 rounded-full" />
                  {(() => {
                    const espera = pedido.slaEspera ?? 0;
                    const cozinha = pedido.slaCozinha ?? 0;
                    const entrega = pedido.slaEntrega ?? 0;
                    const total = espera + cozinha + entrega;
                    if (total === 0) return null;
                    const esperaPct = (espera / total) * 100;
                    const cozinhaPct = (cozinha / total) * 100;
                    const entregaPct = (entrega / total) * 100;
                    return (
                      <>
                        {espera > 0 && <div className="absolute left-0 top-0 h-full bg-zinc-400 rounded-l-full" style={{ width: `${esperaPct}%` }} />}
                        {cozinha > 0 && <div className={`absolute top-0 h-full ${isAtrasado ? 'bg-red-400' : 'bg-amber-400'}`} style={{ left: `${esperaPct}%`, width: `${cozinhaPct}%` }} />}
                        {entrega > 0 && <div className="absolute top-0 h-full bg-sky-400" style={{ left: `${esperaPct + cozinhaPct}%`, width: `${entregaPct}%`, borderTopRightRadius: entregaPct >= 99 ? '9999px' : undefined, borderBottomRightRadius: entregaPct >= 99 ? '9999px' : undefined }} />}
                      </>
                    );
                  })()}
                </div>
                <div className="flex gap-3 flex-wrap">
                  {pedido.slaEspera !== undefined && <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-zinc-400 flex-shrink-0" /><span className="text-[10px] text-zinc-500">Espera fila</span></div>}
                  {pedido.slaCozinha !== undefined && <div className="flex items-center gap-1"><div className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${isAtrasado ? 'bg-red-400' : 'bg-amber-400'}`} /><span className="text-[10px] text-zinc-500">Produção cozinha</span></div>}
                  {pedido.slaEntrega !== undefined && <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-sky-400 flex-shrink-0" /><span className="text-[10px] text-zinc-500">Entrega</span></div>}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-3 text-[10px] text-zinc-400 font-medium">
              <span className="flex items-center gap-1"><i className="ri-time-line" />Espera = criado → todas em preparo</span>
              <span className="flex items-center gap-1"><i className="ri-fire-line" />Cozinha = 1ª iniciou → última pronta</span>
              <span className="flex items-center gap-1"><i className="ri-truck-line" />Entrega = última pronta → todas entregues</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
              <SlaCardLive fromTs={criadoTs} toTs={ultimoInicioPreparoTs} staticMins={pedido.slaEspera} icon="ri-time-line" label="Espera p/ cozinha" alertMins={7} warnMins={10} isAtrasado={isAtrasado} isNoPrazo={isNoPrazo} isFinalized={fase === 'entregue'} />
              <SlaCardLive fromTs={primeiroInicioPreparoTs} toTs={ultimoProntoTs} staticMins={pedido.slaCozinha} icon="ri-fire-line" label="Tempo de cozinha" alertMins={10} warnMins={15} isAtrasado={isAtrasado} isNoPrazo={isNoPrazo} isFinalized={fase === 'entregue'} />
              <SlaCardLive fromTs={prontoTs} toTs={entregueTs} staticMins={pedido.slaEntrega} icon="ri-truck-line" label="Tempo de entrega" alertMins={3} warnMins={5} isAtrasado={isAtrasado} isNoPrazo={isNoPrazo} isFinalized={fase === 'entregue'} />
              <SlaCardLive fromTs={criadoTs} toTs={entregueTs} staticMins={pedido.tempoAberto} icon="ri-focus-3-line" label="Total real" alertMins={15} warnMins={20} isAtrasado={isAtrasado} isNoPrazo={isNoPrazo} isFinalized={fase === 'entregue'} />
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-3">Itens do pedido ({itensTotalReal} {itensTotalReal === 1 ? 'item' : 'itens'})</p>
        <div className="space-y-4">
          {pedido.itensDetalhes.map((item: PedidoItemDetalhe) => (
            <div key={item.id} className="border border-zinc-100 rounded-xl overflow-hidden">
              <div className="flex items-start justify-between p-3.5 bg-zinc-50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 flex items-center justify-center bg-zinc-200 rounded-full text-[10px] font-bold text-zinc-600 flex-shrink-0">{item.quantidade}</span>
                    <span className="text-sm font-bold text-zinc-900">{item.nome}</span>
                  </div>
                  {item.opcoes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5 ml-7">
                      {item.opcoes.map((opc, i) => <span key={i} className="text-[10px] bg-white border border-zinc-200 text-zinc-600 px-2 py-0.5 rounded-full font-medium">{opc}</span>)}
                    </div>
                  )}
                  {item.observacao && (
                    <div className="flex items-center gap-1.5 mt-1.5 ml-7">
                      <i className="ri-chat-3-line text-amber-500 text-xs" />
                      <span className="text-xs text-amber-700 font-medium italic">{item.observacao}</span>
                    </div>
                  )}
                </div>
                <div className="text-right ml-3 flex-shrink-0">
                  <p className="text-sm font-bold text-zinc-800">R$ {(item.preco * item.quantidade).toFixed(2)}</p>
                  <p className="text-[10px] text-zinc-400">R$ {item.preco.toFixed(2)} /un.</p>
                  {item.estacao && <div className="flex items-center gap-1 justify-end mt-1"><i className="ri-map-pin-2-line text-zinc-400 text-xs" /><span className="text-[10px] text-zinc-400">{item.estacao}</span></div>}
                </div>
              </div>
              <div className="divide-y divide-zinc-50">
                {item.unidades.map((un) => {
                  const tPreparo = diffMin(un._iniciadoPreparoTs, un._prontoTs);
                  const tEspera = diffMin(un._criadoTs, un._iniciadoPreparoTs);
                  const tEntrega = diffMin(un._prontoTs, un._entregueTs);
                  const isUnitActive = un.status === 'aguardando' || un.status === 'preparo';
                  return (
                    <div key={un.unidade} className="flex items-center gap-2 px-3.5 py-2.5 flex-wrap">
                      <div className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${UNIDADE_COLOR[un.status] ?? 'bg-zinc-100 text-zinc-500'}`}>
                        <i className={`${UNIDADE_ICON[un.status] ?? 'ri-time-line'} text-sm ${isUnitActive && un.status === 'preparo' ? 'animate-pulse' : ''}`} />
                        Un. {un.unidade}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                        {un.operadorCozinha && <div className="flex items-center gap-1"><i className="ri-user-line text-zinc-400 text-xs" /><span className="text-xs text-zinc-500">{un.operadorCozinha}</span></div>}
                        {un._iniciadoPreparoTs && <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium"><i className="ri-fire-line text-amber-500" />Preparo: <strong>{new Date(un._iniciadoPreparoTs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong></span>}
                        {un.ficouProntoEm && <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium"><i className="ri-checkbox-circle-line text-emerald-500" />Pronto: <strong>{un.ficouProntoEm}</strong></span>}
                        {un.entregueEm && <span className="inline-flex items-center gap-1 text-[10px] bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full font-medium"><i className="ri-truck-line text-sky-500" />Entregue: <strong>{un.entregueEm}</strong></span>}
                        {tPreparo !== null && <span className="inline-flex items-center gap-1 text-[10px] bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full font-medium"><i className="ri-timer-line text-zinc-400" /><strong>{tPreparo < 1 ? '<1' : tPreparo}min</strong> preparo</span>}
                        {tEspera !== null && <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium"><i className="ri-time-line text-amber-500" /><strong>{tEspera < 1 ? '<1' : tEspera}min</strong> espera</span>}
                        {tEntrega !== null && <span className="inline-flex items-center gap-1 text-[10px] bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full font-medium"><i className="ri-truck-line text-sky-500" /><strong>{tEntrega < 1 ? '<1' : tEntrega}min</strong> entrega</span>}
                        {un.entregoPor && <div className="flex items-center gap-1"><i className="ri-user-star-line text-zinc-400 text-xs" /><span className="text-xs text-zinc-500">Por: <strong>{un.entregoPor}</strong></span></div>}
                        {un.status === 'aguardando' && un.semCozinha && <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium"><i className="ri-check-line" />Pronto direto (sem preparo)</span>}
                        {un.status === 'aguardando' && !un.semCozinha && !un.operadorCozinha && <span className="text-xs text-zinc-400 italic">Na fila da cozinha</span>}
                        {un.status === 'preparo' && <span className="text-xs text-amber-600 font-medium flex items-center gap-1"><i className="ri-fire-line animate-pulse" />Em produção...</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showResumo && fase !== 'cancelado' && (
        <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 space-y-4">
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-3">Resumo financeiro</p>
            <div className="space-y-2">
              {pedido.itensDetalhes.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-600">{item.quantidade}x {item.nome}</span>
                  <span className="text-zinc-800 font-semibold">R$ {(item.preco * item.quantidade).toFixed(2)}</span>
                </div>
              ))}
              {descontoReal > 0 && <div className="flex items-center justify-between text-xs text-red-600"><span className="flex items-center gap-1"><i className="ri-price-tag-3-line" />Desconto</span><span className="font-semibold">- R$ {descontoReal.toFixed(2)}</span></div>}
              {(descontoReal > 0 || serviceFeeReal > 0 || tipReal > 0) && <div className="flex items-center justify-between text-xs text-zinc-500 border-t border-zinc-200 pt-2"><span>Subtotal</span><span className="font-semibold">R$ {subtotalReal.toFixed(2)}</span></div>}
              {serviceFeeReal > 0 && <div className="flex items-center justify-between text-xs text-zinc-600"><span className="flex items-center gap-1"><i className="ri-service-line" />Taxa de serviço</span><span className="font-semibold">+ R$ {serviceFeeReal.toFixed(2)}</span></div>}
              {tipReal > 0 && <div className="flex items-center justify-between text-xs text-zinc-600"><span className="flex items-center gap-1"><i className="ri-hand-coin-line" />Gorjeta</span><span className="font-semibold">+ R$ {tipReal.toFixed(2)}</span></div>}
              <div className="pt-2 border-t border-zinc-200 flex items-center justify-between">
                <span className="text-sm font-bold text-zinc-700">Total do pedido</span>
                <span className="text-base font-black text-zinc-900">R$ {totalReal.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div className="border-t border-zinc-200" />
          <PagamentoDetalhado pedido={{ ...pedido, total: totalReal }} />
        </div>
      )}
    </div>
  );
}

export default function PedidoDetalheModal({ pedido, onClose }: Props) {
  const impressoraPedidos = useImpressoraPedidos();
  const { error: toastError } = useToast();
  const isGrupo = (pedido.pedidoIds ?? []).length > 1;
  const pedidosDoGrupo = pedido.pedidosOriginais ?? [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between p-5 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-xl"><i className="ri-file-list-3-line text-zinc-600 text-lg" /></div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                {isGrupo ? (
                  <>
                    <h3 className="text-base font-bold text-zinc-900">Card Unificado</h3>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                      <i className="ri-stack-line text-xs" />{pedidosDoGrupo.length} pedidos
                    </span>
                  </>
                ) : (
                  <h3 className="text-base font-bold text-zinc-900">
                    {pedido.numeroCodigo ? `Pedido #${pedido.numeroCodigo}` : `Pedido #${String(pedido.numero).padStart(4, '0')}`}
                  </h3>
                )}
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLOR[pedido.status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200'}`}>
                  <i className={`${isActiveStatus(pedido.status) ? 'ri-time-line' : STATUS_ICON[pedido.status] ?? 'ri-time-line'} mr-0.5`} />
                  {STATUS_LABEL[pedido.status] ?? pedido.status}
                </span>
                {pedido.origem === 'delivery' && pedido.deliveryPlatform && PLATAFORMA_MAP[pedido.deliveryPlatform] && (() => {
                  const info = PLATAFORMA_MAP[pedido.deliveryPlatform!];
                  return <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${info.cor}`}><i className={`${info.icon} text-xs`} />{info.label}</span>;
                })()}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                {isGrupo ? (
                  <span className="text-zinc-500">
                    Pedidos: {pedido.numeroCodigo}
                    {getStatusFase(pedido.status) !== 'cancelado' && ` · Total: R$ ${pedido.total.toFixed(2)}`}
                  </span>
                ) : (
                  <>Criado às {pedido.criadoEm}{pedido.dataPedido && ` · ${pedido.dataPedido.split('-').reverse().join('/')}`}</>
                )}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg cursor-pointer transition-colors">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isGrupo ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100"><p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">Pedidos</p><p className="text-sm font-bold text-zinc-800">{pedidosDoGrupo.length} unificados</p></div>
                <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100"><p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">Destino</p><p className="text-sm font-bold text-zinc-800">{getDestinoLabel(pedido)}</p></div>
                <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100"><p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">Total</p>
                  {getStatusFase(pedido.status) === 'cancelado' ? (
                    <p className="text-sm font-bold text-red-400">Cancelado</p>
                  ) : (
                    <p className="text-sm font-bold text-zinc-800">R$ {pedido.total.toFixed(2)}</p>
                  )}
                </div>
              </div>

              {pedidosDoGrupo.map((p, idx) => (
                <div key={p.id} className="space-y-5">
                  {idx > 0 && <div className="border-t border-zinc-100 pt-5" />}
                  <PedidoConteudo pedido={p} isGrupo index={idx} showResumo={false} />
                </div>
              ))}

              {getStatusFase(pedido.status) !== 'cancelado' && (
                <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 space-y-4">
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide">Resumo financeiro consolidado</p>
                  <div className="space-y-2">
                    {pedidosDoGrupo.map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-600">Pedido #{p.numeroCodigo ?? String(p.numero).padStart(4, '0')}</span>
                        <span className="text-zinc-800 font-semibold">R$ {p.total.toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-zinc-200 flex items-center justify-between">
                      <span className="text-sm font-bold text-zinc-700">Total geral</span>
                      <span className="text-base font-black text-zinc-900">R$ {pedido.total.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="border-t border-zinc-200" />
                  <PagamentoDetalhado pedido={consolidatePayments(pedidosDoGrupo)} isConsolidated />
                </div>
              )}
            </>
          ) : (
            <PedidoConteudo pedido={pedido} />
          )}
        </div>

        <div className="p-5 border-t border-zinc-100 flex-shrink-0 flex gap-3">
          <button onClick={() => printPedidoResumo({ ...pedido, total: pedido.total }, impressoraPedidos, toastError)} className="flex items-center gap-2 px-4 py-2.5 border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap">
            <i className="ri-printer-line" /> Imprimir Resumo
          </button>
          <button onClick={onClose} className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-semibold py-2.5 rounded-xl cursor-pointer transition-colors text-sm whitespace-nowrap">Fechar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Consolida pagamentos de múltiplos pedidos ─────────────────────────────────
function consolidatePayments(pedidos: PedidoRecente[]): PedidoRecente {
  const base = pedidos[0];
  const todosPagamentos = pedidos.flatMap((p) => p.pagamentos ?? []);
  const totalPedidos = pedidos.reduce((acc, p) => acc + p.total, 0);

  const agrupado = new Map<string, {
    id: string; amount: number; payment_method_name: string | null;
    payment_method_type: string | null; change_amount: number;
    operator_name: string | null; cash_register_id: string | null; count: number;
  }>();

  todosPagamentos.forEach((pg) => {
    const pgExt = pg as PagamentoPedido;
    const key = `${pg.payment_method_name || ''}::${pgExt.payment_method_type || ''}`;
    // Convenção do banco: amount JÁ é o valor cobrado (a venda); change_amount é o troco
    // à parte. Valor entregue pelo cliente = amount + change_amount.
    const valorCobrado = pg.amount;
    const existente = agrupado.get(key);
    if (existente) {
      existente.amount += valorCobrado;
      existente.change_amount += pgExt.change_amount ?? 0;
      existente.count += 1;
    } else {
      agrupado.set(key, {
        id: pg.id, amount: valorCobrado,
        payment_method_name: pg.payment_method_name,
        payment_method_type: pgExt.payment_method_type ?? null,
        change_amount: pgExt.change_amount ?? 0,
        operator_name: pgExt.operator_name ?? null,
        cash_register_id: pgExt.cash_register_id ?? null,
        count: 1,
      });
    }
  });

  // CORREÇÃO: em pedidos pagos juntos, o pedido principal grava o amount do GRUPO
  // inteiro e os vinculados gravam o deles → a soma dos amounts excede o total real.
  // Limita o valor COBRADO ao total dos pedidos (a venda real). O troco NÃO é escalado:
  // é o troco real entregue uma única vez no pagamento conjunto.
  const totalPagamentos = Array.from(agrupado.values()).reduce((acc, g) => acc + g.amount, 0);
  if (totalPagamentos > totalPedidos && totalPagamentos > 0) {
    const fator = totalPedidos / totalPagamentos;
    agrupado.forEach((g) => {
      g.amount = g.amount * fator;
    });
  }

  const pagamentosConsolidados = Array.from(agrupado.values()).map((g) => {
    const p: PagamentoPedido = {
      id: g.id, amount: g.amount, payment_method_name: g.payment_method_name,
      payment_method_type: g.payment_method_type, change_amount: g.change_amount,
      operator_name: g.operator_name, cash_register_id: g.cash_register_id,
    };
    return p;
  });

  return { ...base, pagamentos: pagamentosConsolidados, total: totalPedidos };
}