import { useState, useEffect, useCallback } from 'react';
import { X, ShoppingBag, CreditCard, Package } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const TYPE_LABELS: Record<string, string> = {
  cash: 'Dinheiro',
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit_card: 'Cartão de Débito',
  meal_voucher: 'Vale Refeição',
  other: 'Outro',
};

const TYPE_COLORS: Record<string, string> = {
  cash: '#10b981',
  dinheiro: '#10b981',
  pix: '#06b6d4',
  credit_card: '#f59e0b',
  debit_card: '#f97316',
  meal_voucher: '#8b5cf6',
  other: '#94a3b8',
};

interface PaymentSummary {
  methodName: string;
  type: string;
  total: number;
  count: number;
  changeTotal: number;
}

interface ItemSummary {
  item_name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

interface DiaDetalheModalProps {
  date: string; // YYYY-MM-DD
  onClose: () => void;
}

export default function DiaDetalheModal({ date, onClose }: DiaDetalheModalProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<PaymentSummary[]>([]);
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalOrders, setTotalOrders] = useState(0);
  const [activeTab, setActiveTab] = useState<'pagamentos' | 'itens'>('pagamentos');

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      // Usar fuso de Brasília para delimitar o dia corretamente
      const from = new Date(date + 'T00:00:00-03:00').toISOString();
      const to = new Date(date + 'T23:59:59-03:00').toISOString();

      // Buscar todos os pedidos do dia (exceto cancelados e drafts)
      const { data: orders, error: ordersErr } = await supabase
        .from('orders')
        .select('id, total_amount, status, table_session_id')
        .eq('tenant_id', user.tenantId)
        .not('status', 'in', '(cancelled,draft)')
        .eq('is_training', false)
        .eq('is_draft', false)
        .gte('created_at', from)
        .lte('created_at', to);

      if (ordersErr) throw ordersErr;

      const orderIds = (orders ?? []).map((o) => o.id);
      const revenue = (orders ?? []).reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
      setTotalRevenue(revenue);
      setTotalOrders(orderIds.length);

      if (orderIds.length === 0) {
        setPayments([]);
        setItems([]);
        return;
      }

      // Buscar pagamentos vinculados aos pedidos do dia
      const { data: paymentsData, error: paymentsErr } = await supabase
        .from('payments')
        .select('amount, change_amount, payment_method_id, payment_methods(name, type)')
        .in('order_id', orderIds)
        .eq('tenant_id', user.tenantId)
        .eq('is_refunded', false);

      if (paymentsErr) throw paymentsErr;

      // Agrupar pagamentos por método
      const payMap: Record<string, PaymentSummary> = {};
      (paymentsData ?? []).forEach((p: any) => {
        const pm = p.payment_methods as { name: string; type: string } | null;
        const key = p.payment_method_id ?? 'unknown';
        if (!payMap[key]) {
          payMap[key] = {
            methodName: pm?.name ?? 'Desconhecido',
            type: pm?.type ?? 'other',
            total: 0,
            count: 0,
            changeTotal: 0,
          };
        }
        payMap[key].total += Number(p.amount ?? 0);
        payMap[key].changeTotal += Number(p.change_amount ?? 0);
        payMap[key].count += 1;
      });
      setPayments(Object.values(payMap).sort((a, b) => b.total - a.total));

      // Buscar itens vendidos
      const { data: orderItems, error: itemsErr } = await supabase
        .from('order_items')
        .select('item_name, item_price, quantity')
        .in('order_id', orderIds)
        .eq('tenant_id', user.tenantId);

      if (itemsErr) throw itemsErr;

      // Agrupar itens por nome
      const itemMap: Record<string, ItemSummary> = {};
      (orderItems ?? []).forEach((oi: any) => {
        const key = oi.item_name;
        if (!itemMap[key]) {
          itemMap[key] = {
            item_name: oi.item_name,
            quantity: 0,
            unit_price: Number(oi.item_price ?? 0),
            total: 0,
          };
        }
        itemMap[key].quantity += oi.quantity ?? 1;
        itemMap[key].total += Number(oi.item_price ?? 0) * (oi.quantity ?? 1);
      });
      setItems(Object.values(itemMap).sort((a, b) => b.total - a.total));
    } catch (e) {
      console.error('[DiaDetalheModal]', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, date]);

  useEffect(() => { load(); }, [load]);

  const payTotal = payments.reduce((s, p) => s + p.total, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-zinc-100">
          <div>
            <h2 className="text-sm font-bold text-zinc-900 capitalize">{dateLabel}</h2>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-zinc-500">
                <span className="font-semibold text-zinc-700">{totalOrders}</span> pedidos
              </span>
              <span className="text-xs font-bold text-emerald-600">{fmt(totalRevenue)}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 transition-colors cursor-pointer text-zinc-400"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-100 px-5">
          <button
            onClick={() => setActiveTab('pagamentos')}
            className={`flex items-center gap-1.5 px-3 py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'pagamentos'
                ? 'border-violet-500 text-violet-700'
                : 'border-transparent text-zinc-400 hover:text-zinc-600'
            }`}
          >
            <div className="w-3.5 h-3.5 flex items-center justify-center">
              <CreditCard size={12} />
            </div>
            Formas de Pagamento
          </button>
          <button
            onClick={() => setActiveTab('itens')}
            className={`flex items-center gap-1.5 px-3 py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'itens'
                ? 'border-violet-500 text-violet-700'
                : 'border-transparent text-zinc-400 hover:text-zinc-600'
            }`}
          >
            <div className="w-3.5 h-3.5 flex items-center justify-center">
              <Package size={12} />
            </div>
            Itens Vendidos
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-400">
              <div className="w-5 h-5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin mr-3" />
              <span className="text-sm">Carregando...</span>
            </div>
          ) : totalOrders === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-300">
              <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-xl mb-3">
                <ShoppingBag size={20} className="text-zinc-300" />
              </div>
              <p className="text-sm font-medium text-zinc-400">Nenhum pedido neste dia</p>
            </div>
          ) : activeTab === 'pagamentos' ? (
            <div className="space-y-3">
              {payments.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-8">Sem registros de pagamento</p>
              ) : (
                <>
                  {payments.map((p) => {
                    const pct = payTotal > 0 ? Math.round((p.total / payTotal) * 100) : 0;
                    const color = TYPE_COLORS[p.type] ?? '#94a3b8';
                    const ehDinheiro = p.type === 'cash' || p.type === 'dinheiro';
                    const valorEntregue = ehDinheiro ? p.total + p.changeTotal : null;
                    return (
                      <div key={p.methodName} className="flex items-start gap-3">
                        <div
                          className="w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 mt-0.5"
                          style={{ backgroundColor: color + '20' }}
                        >
                          <i
                            className={`text-sm ${
                              p.type === 'cash' || p.type === 'dinheiro' ? 'ri-money-dollar-circle-line' :
                              p.type === 'pix' ? 'ri-qr-code-line' :
                              p.type === 'credit_card' ? 'ri-bank-card-line' :
                              p.type === 'debit_card' ? 'ri-bank-card-2-line' :
                              p.type === 'meal_voucher' ? 'ri-coupon-line' :
                              'ri-wallet-line'
                            }`}
                            style={{ color }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-zinc-700">{p.methodName}</span>
                            <span className="text-xs font-bold text-zinc-900">{fmt(p.total)}</span>
                          </div>
                          <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, backgroundColor: color }}
                            />
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[10px] text-zinc-400">{TYPE_LABELS[p.type] ?? p.type}</span>
                            <span className="text-[10px] text-zinc-400">{p.count} transação(ões) · {pct}%</span>
                          </div>
                          {ehDinheiro && p.changeTotal > 0 && (
                            <div className="mt-1.5 pt-1.5 border-t border-emerald-100 space-y-1">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-zinc-500">Valor entregue pelo cliente</span>
                                <span className="font-semibold text-zinc-700">{fmt(valorEntregue ?? 0)}</span>
                              </div>
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-emerald-600 font-medium">Troco devolvido</span>
                                <span className="font-bold text-emerald-700">{fmt(p.changeTotal)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div className="mt-4 pt-4 border-t border-zinc-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-500">Total recebido</span>
                    <span className="text-sm font-bold text-zinc-900">{fmt(payTotal)}</span>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {items.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-8">Sem itens registrados</p>
              ) : (
                <>
                  {/* Header da tabela */}
                  <div className="grid grid-cols-12 gap-2 px-2 pb-2 border-b border-zinc-100">
                    <span className="col-span-5 text-[10px] font-bold text-zinc-400 uppercase tracking-wide">Item</span>
                    <span className="col-span-2 text-[10px] font-bold text-zinc-400 uppercase tracking-wide text-center">Qtd</span>
                    <span className="col-span-2 text-[10px] font-bold text-zinc-400 uppercase tracking-wide text-right">Unit.</span>
                    <span className="col-span-3 text-[10px] font-bold text-zinc-400 uppercase tracking-wide text-right">Total</span>
                  </div>
                  {items.map((item, idx) => (
                    <div
                      key={item.item_name}
                      className={`grid grid-cols-12 gap-2 px-2 py-2 rounded-lg ${idx % 2 === 0 ? 'bg-zinc-50/60' : ''}`}
                    >
                      <span className="col-span-5 text-xs font-medium text-zinc-700 truncate">{item.item_name}</span>
                      <span className="col-span-2 text-xs font-bold text-violet-600 text-center">{item.quantity}x</span>
                      <span className="col-span-2 text-xs text-zinc-500 text-right whitespace-nowrap">{fmt(item.unit_price)}</span>
                      <span className="col-span-3 text-xs font-bold text-zinc-800 text-right whitespace-nowrap">{fmt(item.total)}</span>
                    </div>
                  ))}
                  <div className="mt-3 pt-3 border-t border-zinc-100 grid grid-cols-12 gap-2 px-2">
                    <span className="col-span-5 text-xs font-bold text-zinc-600">Total</span>
                    <span className="col-span-2 text-xs font-bold text-violet-600 text-center">
                      {items.reduce((s, i) => s + i.quantity, 0)}x
                    </span>
                    <span className="col-span-2" />
                    <span className="col-span-3 text-xs font-bold text-zinc-900 text-right">
                      {fmt(items.reduce((s, i) => s + i.total, 0))}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
