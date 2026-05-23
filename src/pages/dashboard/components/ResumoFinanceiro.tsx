import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface ContaEmAberto {
  origin: string;
  count: number;
  valor: number;
}

interface FinancialSummary {
  receitaHoje: number;
  receitaPaga: number;
  receitaPendente: number;
  contasEmAberto: ContaEmAberto[];
  contasVencendoHoje: number;
  qtdContasHoje: number;
  contasVencer7dias: number;
  qtdContas7dias: number;
}

const ORIGEM_LABEL: Record<string, string> = {
  table: 'Mesa',
  cashier: 'Balcão',
  delivery: 'Delivery',
  waiter: 'Garçom',
  self_service: 'Autoatend.',
};

const ORIGEM_ICON: Record<string, string> = {
  table: 'ri-restaurant-line',
  cashier: 'ri-store-2-line',
  delivery: 'ri-motorbike-line',
  waiter: 'ri-walk-line',
  self_service: 'ri-tv-line',
};

export default function ResumoFinanceiro() {
  const { user } = useAuth();
  const [data, setData] = useState<FinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const in7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

      // Receita do dia — pagamentos registrados hoje (apenas de pedidos entregues)
      const { data: pagamentos } = await supabase
        .from('payments')
        .select('amount, orders!inner(tenant_id, is_paid, status)')
        .eq('orders.tenant_id', user.tenantId)
        .eq('orders.status', 'delivered')
        .eq('is_refunded', false)
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`);

      const receitaPaga = (pagamentos ?? []).reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0);

      // Pedidos não pagos de hoje (apenas entregues)
      const { data: pedidosPendentes } = await supabase
        .from('orders')
        .select('id, total_amount, origin_type')
        .eq('tenant_id', user.tenantId)
        .eq('is_paid', false)
        .eq('status', 'delivered')
        .eq('is_training', false)
        .eq('is_draft', false)
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`);

      const receitaPendente = (pedidosPendentes ?? []).reduce((s: number, p: { total_amount: number }) => s + Number(p.total_amount), 0);

      // Contas em aberto agrupadas por origem
      const contasMap: Record<string, ContaEmAberto> = {};
      (pedidosPendentes ?? []).forEach((p: any) => {
        const orig = p.origin_type ?? 'cashier';
        if (!contasMap[orig]) contasMap[orig] = { origin: orig, count: 0, valor: 0 };
        contasMap[orig].count += 1;
        contasMap[orig].valor += Number(p.total_amount ?? 0);
      });
      const contasEmAberto = Object.values(contasMap).sort((a, b) => b.valor - a.valor);

      // Contas a pagar vencendo hoje
      const { data: contasHoje } = await supabase
        .from('fin_accounts_payable')
        .select('amount')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'pending')
        .eq('due_date', today);

      const contasVencendoHoje = (contasHoje ?? []).reduce((s: number, c: { amount: number }) => s + Number(c.amount), 0);

      // Contas a pagar nos próximos 7 dias
      const { data: contas7dias } = await supabase
        .from('fin_accounts_payable')
        .select('amount')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'pending')
        .gt('due_date', today)
        .lte('due_date', in7);

      const contasVencer7dias = (contas7dias ?? []).reduce((s: number, c: { amount: number }) => s + Number(c.amount), 0);

      setData({
        receitaHoje: receitaPaga + receitaPendente,
        receitaPaga,
        receitaPendente,
        contasEmAberto,
        contasVencendoHoje,
        qtdContasHoje: (contasHoje ?? []).length,
        contasVencer7dias,
        qtdContas7dias: (contas7dias ?? []).length,
      });
    } catch (e) {
      console.error('[ResumoFinanceiro]', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="bg-white border border-zinc-100 rounded-xl p-4 flex items-center justify-center h-28">
        <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  const pctPago = data.receitaHoje > 0 ? Math.round((data.receitaPaga / data.receitaHoje) * 100) : 0;
  const totalContasEmAberto = data.contasEmAberto.reduce((s, c) => s + c.count, 0);

  return (
    <div className="bg-white border border-zinc-100 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 flex items-center justify-center bg-amber-50 rounded-lg">
            <i className="ri-money-dollar-circle-line text-amber-600 text-sm" />
          </div>
          <h3 className="text-xs font-bold text-zinc-700 uppercase tracking-wide">Financeiro Hoje</h3>
        </div>
        <button
          onClick={load}
          className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400"
          title="Atualizar"
        >
          <i className="ri-refresh-line text-xs" />
        </button>
      </div>

      {/* Total */}
      <div className="text-center py-1">
        <span className="text-[10px] text-zinc-400 font-medium">Receita do dia</span>
        <div className="text-lg font-black text-zinc-900 mt-0.5">{fmt(data.receitaHoje)}</div>
      </div>

      {/* Barra de progresso */}
      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-emerald-500 rounded-l-full transition-all"
          style={{ width: `${pctPago}%` }}
        />
        <div
          className="h-full bg-amber-400 transition-all"
          style={{ width: `${100 - pctPago}%` }}
        />
      </div>

      {/* Cards: Recebido vs A Receber */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 space-y-1">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 flex items-center justify-center rounded-md bg-emerald-100">
              <i className="ri-arrow-down-circle-line text-emerald-600 text-xs" />
            </div>
            <span className="text-[10px] font-semibold text-emerald-700">Recebido</span>
          </div>
          <div className="text-sm font-black text-emerald-800">{fmt(data.receitaPaga)}</div>
          <p className="text-[10px] text-emerald-500">Dinheiro no caixa</p>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-1">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 flex items-center justify-center rounded-md bg-amber-100">
              <i className="ri-time-line text-amber-600 text-xs" />
            </div>
            <span className="text-[10px] font-semibold text-amber-700">A Receber</span>
          </div>
          <div className="text-sm font-black text-amber-800">{fmt(data.receitaPendente)}</div>
          <p className="text-[10px] text-amber-500">Pedidos entregues, não pagos</p>
        </div>
      </div>

      {/* Contas em Aberto por Origem */}
      {totalContasEmAberto > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Contas em Aberto</span>
            <span className="text-[10px] font-semibold text-zinc-400">
              {totalContasEmAberto} pedido{totalContasEmAberto !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {data.contasEmAberto.map((conta) => (
              <div
                key={conta.origin}
                className="flex items-center justify-between px-3 py-2 bg-zinc-50 border border-zinc-100 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 flex items-center justify-center rounded-md bg-white border border-zinc-100">
                    <i className={`${ORIGEM_ICON[conta.origin] ?? 'ri-receipt-line'} text-zinc-500 text-xs`} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-zinc-700">
                      {ORIGEM_LABEL[conta.origin] ?? conta.origin}
                    </span>
                    <span className="text-[10px] text-zinc-400 ml-1.5">
                      {conta.count} pedido{conta.count !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-bold text-zinc-800">{fmt(conta.valor)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alertas de contas */}
      <div className="space-y-1.5 pt-1 border-t border-zinc-50">
        {data.contasVencendoHoje > 0 ? (
          <div className="flex items-center justify-between px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
            <div className="flex items-center gap-2">
              <i className="ri-alarm-warning-line text-red-500 text-sm" />
              <span className="text-xs font-semibold text-red-700">
                {data.qtdContasHoje} conta{data.qtdContasHoje !== 1 ? 's' : ''} vencendo hoje
              </span>
            </div>
            <span className="text-xs font-black text-red-700">{fmt(data.contasVencendoHoje)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg">
            <i className="ri-checkbox-circle-line text-emerald-500 text-sm" />
            <span className="text-xs font-semibold text-emerald-700">Nenhuma conta vence hoje</span>
          </div>
        )}
        {data.qtdContas7dias > 0 && (
          <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
            <div className="flex items-center gap-2">
              <i className="ri-calendar-close-line text-amber-500 text-sm" />
              <span className="text-xs font-medium text-amber-700">
                {data.qtdContas7dias} conta{data.qtdContas7dias !== 1 ? 's' : ''} nos próximos 7 dias
              </span>
            </div>
            <span className="text-xs font-bold text-amber-700">{fmt(data.contasVencer7dias)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
