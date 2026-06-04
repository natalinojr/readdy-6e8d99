import { memo, useState } from 'react';
import type { DashboardPedido, DashboardPagamento } from '../../../hooks/useDashboardMetrics';

interface Props { pedidos: DashboardPedido[]; }

const STATUS_LABEL: Record<string, string> = { new: 'Novo', preparing: 'Preparo', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado' };
const STATUS_CLS: Record<string, string> = { new: 'bg-zinc-100 text-zinc-600', preparing: 'bg-amber-50 text-amber-600', ready: 'bg-emerald-50 text-emerald-600', delivered: 'bg-zinc-50 text-zinc-400', cancelled: 'bg-red-50 text-red-500' };
const ORIGIN_LABEL: Record<string, string> = { cashier: 'Caixa', waiter: 'Garçom', table: 'Mesa', self_service: 'Auto', delivery: 'Delivery' };
const ORIGIN_ICON: Record<string, string> = { cashier: 'ri-store-2-line', waiter: 'ri-walk-line', table: 'ri-restaurant-line', self_service: 'ri-tv-line', delivery: 'ri-bike-line' };
const DEST_LABEL: Record<string, string> = { immediate: 'Na hora', table: 'Mesa', delivery: 'Delivery', name: '', password: 'Senha' };

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function getDestino(p: DashboardPedido): string {
  if (p.destination === 'name' || p.destination === 'delivery') return p.destination_name ?? DEST_LABEL[p.destination] ?? '—';
  if (p.destination === 'password') return p.destination_name ? `Senha ${p.destination_name}` : 'Senha';
  return DEST_LABEL[p.destination] ?? p.destination;
}

/** Retorna label, ícone e cor do canal onde o pagamento foi registrado */
function canalRegistro(pg: DashboardPagamento, orderOrigin?: string): { label: string; icon: string; color: string } | null {
  if (pg.cash_register_id) {
    return { label: 'Caixa', icon: 'ri-safe-2-line', color: 'bg-amber-50 text-amber-700 border-amber-200' };
  }
  const origin = orderOrigin ?? '';
  if (origin === 'waiter') return { label: 'Garçom', icon: 'ri-walk-line', color: 'bg-sky-50 text-sky-700 border-sky-200' };
  if (origin === 'table') return { label: 'Mesa', icon: 'ri-restaurant-2-line', color: 'bg-violet-50 text-violet-700 border-violet-200' };
  if (origin === 'delivery') return { label: 'Delivery', icon: 'ri-e-bike-line', color: 'bg-orange-50 text-orange-700 border-orange-200' };
  if (origin === 'self_service') return { label: 'Autoatendimento', icon: 'ri-tablet-line', color: 'bg-teal-50 text-teal-700 border-teal-200' };
  return null;
}

/** Ícone baseado no tipo da forma de pagamento */
function paymentIcon(type: string | null): string {
  const map: Record<string, string> = {
    dinheiro: 'ri-money-dollar-circle-line',
    credito: 'ri-bank-card-line',
    debito: 'ri-bank-card-2-line',
    pix: 'ri-qr-code-line',
    vale: 'ri-coupon-line',
  };
  return map[type ?? ''] ?? 'ri-wallet-line';
}

// ── Modal de Detalhe ─────────────────────────────────────────────────────────

const DetalheModal = memo(function DetalheModal({ pedido, onClose }: { pedido: DashboardPedido; onClose: () => void }) {
  const st = STATUS_CLS[pedido.status] ?? STATUS_CLS.new;
  const stLabel = STATUS_LABEL[pedido.status] ?? pedido.status;
  const orig = ORIGIN_ICON[pedido.origin] ?? 'ri-receipt-line';
  const hora = new Date(pedido.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const pagamentos = pedido.pagamentos ?? [];
  const pagamentosAtivos = pagamentos.filter((pg) => !pg.is_refunded);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-[420px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 flex items-center justify-center bg-zinc-100 rounded-xl">
              <i className={`${orig} text-base text-zinc-600`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-zinc-900">#{String(pedido.numero).padStart(4, '0')}</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${st}`}>{stLabel}</span>
              </div>
              <p className="text-[11px] text-zinc-400">{getDestino(pedido)} · {ORIGIN_LABEL[pedido.origin] ?? pedido.origin} · {hora}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 cursor-pointer flex-shrink-0">
            <i className="ri-close-line text-sm text-zinc-500" />
          </button>
        </div>

        {/* Operador */}
        {pedido.operador && (
          <div className="flex items-center gap-2 bg-zinc-50 rounded-xl px-3 py-2 mb-3 flex-shrink-0">
            <i className="ri-user-line text-zinc-400 text-sm" />
            <span className="text-xs text-zinc-500">Operador:</span>
            <span className="text-xs font-semibold text-zinc-700">{pedido.operador}</span>
          </div>
        )}

        {/* Itens */}
        <div className="flex-1 overflow-y-auto mb-3 min-h-0">
          {pedido.itens.length > 0 ? pedido.itens.map((it, idx) => (
            <div key={idx} className="flex items-center justify-between py-2 border-b border-zinc-50 last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-zinc-400 w-5 text-right">{it.qtd}x</span>
                <span className="text-xs text-zinc-700">{it.nome}</span>
              </div>
              <span className="text-xs font-semibold text-zinc-700">{fmt(Number(it.valor) || 0)}</span>
            </div>
          )) : <p className="text-xs text-zinc-400 py-4 text-center">Sem itens registrados</p>}
        </div>

        {/* Total */}
        <div className="border-t border-zinc-100 pt-3 mb-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-zinc-800">Total</span>
            <span className="text-base font-black text-zinc-900">{fmt(Number(pedido.total) || 0)}</span>
          </div>
        </div>

        {/* Pagamentos */}
        {pagamentosAtivos.length > 0 && (
          <div className="flex-shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <i className="ri-secure-payment-line text-zinc-400 text-sm" />
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Pagamento</span>
              {pedido.is_paid && (
                <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full ml-auto">
                  <i className="ri-checkbox-circle-line text-[9px]" /> Pago
                </span>
              )}
            </div>

            <div className="space-y-2">
              {pagamentosAtivos.map((pg) => {
                const isDinheiro = (pg.payment_method_type ?? '').toLowerCase() === 'dinheiro' ||
                  (pg.payment_method_name ?? '').toLowerCase().includes('dinheiro');
                const canal = canalRegistro(pg, pedido.origin);
                const troco = pg.change_amount != null && pg.change_amount > 0 ? pg.change_amount : null;
                const valorPago = isDinheiro && pg.amount > 0
                  ? pedido.total + (troco ?? 0)
                  : null;

                return (
                  <div key={pg.id} className="bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2.5">
                    {/* Linha 1: ícone + forma + valor */}
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 flex items-center justify-center bg-white border border-zinc-200 rounded-lg flex-shrink-0">
                        <i className={`${paymentIcon(pg.payment_method_type)} text-sm text-zinc-600`} />
                      </div>
                      <span className="text-sm font-bold text-zinc-800 flex-1">
                        {pg.payment_method_name ?? 'Pagamento'}
                      </span>
                      <span className="text-sm font-black text-zinc-900">{fmt(pg.amount)}</span>
                    </div>

                    {/* Linha 2: canal + operador */}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {canal && (
                        <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${canal.color}`}>
                          <i className={`${canal.icon} text-[9px]`} />
                          {canal.label}
                        </span>
                      )}
                      {pg.operator_name && (
                        <span className="inline-flex items-center gap-1 text-[9px] text-zinc-500">
                          <i className="ri-user-line text-[9px]" />
                          {pg.operator_name}
                        </span>
                      )}
                    </div>

                    {/* Linha 3: dinheiro — valor entregue + troco */}
                    {isDinheiro && (valorPago != null || troco != null) && (
                      <div className="mt-2 pt-2 border-t border-zinc-200 flex items-center gap-4">
                        {valorPago != null && (
                          <div className="flex items-center gap-1.5">
                            <i className="ri-money-dollar-circle-line text-zinc-400 text-xs" />
                            <span className="text-[10px] text-zinc-500">Valor entregue:</span>
                            <span className="text-[10px] font-bold text-zinc-700">{fmt(valorPago)}</span>
                          </div>
                        )}
                        {troco != null && (
                          <div className="flex items-center gap-1.5">
                            <i className="ri-arrow-left-right-line text-emerald-500 text-xs" />
                            <span className="text-[10px] text-zinc-500">Troco:</span>
                            <span className="text-[10px] font-bold text-emerald-600">{fmt(troco)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Total pago quando split */}
              {pagamentosAtivos.length > 1 && (
                <div className="flex items-center justify-between px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-xl">
                  <span className="text-xs font-semibold text-emerald-700">Total pago</span>
                  <span className="text-sm font-black text-emerald-800">
                    {fmt(pagamentosAtivos.reduce((s, pg) => s + pg.amount, 0))}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sem pagamento registrado */}
        {pagamentosAtivos.length === 0 && !pedido.is_paid && (
          <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 border border-zinc-100 rounded-xl flex-shrink-0">
            <i className="ri-time-line text-zinc-400 text-sm" />
            <span className="text-xs text-zinc-500">Pagamento não registrado</span>
          </div>
        )}
      </div>
    </div>
  );
});

// ── Componente principal ──────────────────────────────────────────────────────

const UltimosPedidos = memo(function UltimosPedidos({ pedidos }: Props) {
  const [sel, setSel] = useState<DashboardPedido | null>(null);

  return (
    <>
      <div className="bg-white border border-zinc-100 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-800">Últimos Pedidos</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Clique em um pedido para ver detalhes</p>
          </div>
          {pedidos.length > 0 && <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full">ao vivo</span>}
        </div>
        {pedidos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-zinc-400">
            <i className="ri-receipt-line text-3xl mb-2" />
            <p className="text-sm font-medium">Nenhum pedido ainda hoje</p>
            <p className="text-xs mt-0.5">Os pedidos aparecerão aqui em tempo real</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100">
                  <th className="text-left pb-2 font-semibold text-zinc-400 pr-4">Pedido</th>
                  <th className="text-left pb-2 font-semibold text-zinc-400 pr-4">Destino</th>
                  <th className="text-left pb-2 font-semibold text-zinc-400 pr-4">Origem</th>
                  <th className="text-right pb-2 font-semibold text-zinc-400 pr-4">Valor</th>
                  <th className="text-left pb-2 font-semibold text-zinc-400 pr-4">Horário</th>
                  <th className="text-left pb-2 font-semibold text-zinc-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => {
                  const st = STATUS_CLS[p.status] ?? STATUS_CLS.new;
                  const stLabel = STATUS_LABEL[p.status] ?? p.status;
                  const hora = new Date(p.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                  const pagamentos = p.pagamentos ?? [];
                  const pgAtivos = pagamentos.filter((pg) => !pg.is_refunded);
                  const formaPag = pgAtivos[0]?.payment_method_name;
                  return (
                    <tr key={p.id} onClick={() => setSel(p)} className="border-b border-zinc-50 hover:bg-zinc-50 transition-colors cursor-pointer group">
                      <td className="py-2.5 pr-4 font-bold text-zinc-700 group-hover:text-amber-600 transition-colors">
                        #{String(p.numero).padStart(4, '0')}
                      </td>
                      <td className="py-2.5 pr-4 text-zinc-600 whitespace-nowrap">{getDestino(p)}</td>
                      <td className="py-2.5 pr-4 text-zinc-500">{ORIGIN_LABEL[p.origin] ?? p.origin}</td>
                      <td className="py-2.5 pr-4 font-semibold text-zinc-800 text-right whitespace-nowrap">{fmt(Number(p.total) || 0)}</td>
                      <td className="py-2.5 pr-4 text-zinc-400 whitespace-nowrap">{hora}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${st}`}>{stLabel}</span>
                          {formaPag && (
                            <span className="hidden lg:inline text-[9px] text-zinc-400 whitespace-nowrap truncate max-w-[80px]">
                              {formaPag}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {sel && <DetalheModal pedido={sel} onClose={() => setSel(null)} />}
    </>
  );
});

export default UltimosPedidos;