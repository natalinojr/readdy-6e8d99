import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { todayBrasilia, getTodayBrasiliaRange, somarDias } from '@/lib/dateUtils';
import AjudaCartao from '@/components/base/AjudaCartao';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface FinancialSummary {
  receitaPaga: number;
  receitaPendente: number;
  contasHoje: number;
  qtdContasHoje: number;
  contas7dias: number;
  qtdContas7dias: number;
}

const AJUDA_PEDIDOS =
  'Pedidos do sistema entregues hoje: os já pagos (em qualquer forma de pagamento) + os que ainda faltam pagar. ' +
  'Não inclui iFood nem pedidos em preparo, por isso fica diferente do faturamento lá em cima.\n\n' +
  'O dinheiro que já entrou de fato fica em Financeiro › Visão Geral › "Recebido hoje".';

// Financeiro de hoje, enxuto: pago × não pago dos pedidos entregues e o que vence até 7 dias.
// Contas vencidas foram para a faixa "Precisa de atenção" no topo.
export default function ResumoFinanceiro({ refreshKey = 0 }: { refreshKey?: number }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<FinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    setErro(false);
    try {
      // Datas em fuso de Brasília — evita "virar o dia" às 21h (UTC) e zerar o card
      const today = todayBrasilia();
      const { fromTs, toTs } = getTodayBrasiliaRange();
      const in7 = somarDias(today, 7);

      const [pagamentosRes, pendentesRes, contasRes] = await Promise.all([
        // Pagamentos de hoje de pedidos entregues (sem treino/rascunho — antes contava pedido de treino)
        supabase
          .from('payments')
          .select('amount, orders!inner(tenant_id, status, is_training, is_draft)')
          .eq('orders.tenant_id', user.tenantId)
          .eq('orders.status', 'delivered')
          .eq('orders.is_training', false)
          .eq('orders.is_draft', false)
          .eq('is_refunded', false)
          .gte('created_at', fromTs)
          .lte('created_at', toTs),
        supabase
          .from('orders')
          .select('total_amount')
          .eq('tenant_id', user.tenantId)
          .eq('is_paid', false)
          .eq('status', 'delivered')
          .eq('is_training', false)
          .eq('is_draft', false)
          .eq('ifood_repasse', false)
          .gte('created_at', fromTs)
          .lte('created_at', toTs),
        // A pagar até 7 dias: pendente ou pago em parte, pelo saldo devedor (mesma conta dos alertas)
        supabase
          .from('fin_accounts_payable')
          .select('amount, paid_amount, due_date')
          .eq('tenant_id', user.tenantId)
          .in('status', ['pending', 'partial'])
          .gte('due_date', today)
          .lte('due_date', in7),
      ]);
      const falha = pagamentosRes.error ?? pendentesRes.error ?? contasRes.error;
      if (falha) throw falha;

      const soma = (rows: Array<{ amount?: number; total_amount?: number }> | null, k: 'amount' | 'total_amount') =>
        (rows ?? []).reduce((s, r) => s + Number(r[k] ?? 0), 0);
      const contas = ((contasRes.data ?? []) as Array<{ amount: number; paid_amount: number | null; due_date: string }>)
        .map((c) => ({ due_date: c.due_date, amount: Number(c.amount) - Number(c.paid_amount ?? 0) }))
        .filter((c) => c.amount > 0.005);
      const deHoje = contas.filter((c) => c.due_date === today);
      const proximas = contas.filter((c) => c.due_date !== today);

      setData({
        receitaPaga: soma(pagamentosRes.data as Array<{ amount: number }> | null, 'amount'),
        receitaPendente: soma(pendentesRes.data as Array<{ total_amount: number }> | null, 'total_amount'),
        contasHoje: soma(deHoje, 'amount'),
        qtdContasHoje: deHoje.length,
        contas7dias: soma(proximas, 'amount'),
        qtdContas7dias: proximas.length,
      });
    } catch (e) {
      console.error('[ResumoFinanceiro]', e);
      setData(null);
      setErro(true);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-200 p-4 flex items-center justify-center h-28">
        <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!data) {
    return erro ? (
      <div className="bg-white rounded-2xl border border-zinc-200 p-4 text-xs text-zinc-500 flex items-center gap-2">
        <i className="ri-error-warning-line text-red-500" /> Não foi possível carregar o financeiro de hoje.
        <button onClick={load} className="ml-auto font-semibold text-amber-600 hover:text-amber-700 cursor-pointer">Tentar de novo</button>
      </div>
    ) : null;
  }

  const total = data.receitaPaga + data.receitaPendente;
  const pctPago = total > 0 ? Math.round((data.receitaPaga / total) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 h-full">
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3">
        <div>
          <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-1">Financeiro de hoje <AjudaCartao texto={AJUDA_PEDIDOS} /></h3>
          <p className="text-xs text-zinc-400">Pedidos entregues: {fmt(total)}</p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="h-2 bg-zinc-100 rounded-full overflow-hidden flex">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pctPago}%` }} />
          {total > 0 && <div className="h-full bg-amber-400 transition-all" style={{ width: `${100 - pctPago}%` }} />}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
            <p className="text-[10px] font-semibold text-emerald-700">Pago no sistema</p>
            <p className="text-sm font-black text-emerald-800 tabular-nums">{fmt(data.receitaPaga)}</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
            <p className="text-[10px] font-semibold text-amber-700">Entregue, não pago</p>
            <p className="text-sm font-black text-amber-800 tabular-nums">{fmt(data.receitaPendente)}</p>
          </div>
        </div>

        <button
          onClick={() => navigate('/financeiro', { state: { activeTab: 'pagar' } })}
          className="w-full text-left px-3 py-2 bg-zinc-50 hover:bg-zinc-100 rounded-lg text-xs space-y-1 cursor-pointer transition-colors"
        >
          <span className="flex items-center justify-between gap-2">
            <span className={data.qtdContasHoje > 0 ? 'font-semibold text-red-700' : 'text-zinc-500'}>
              <i className="ri-calendar-event-line" /> {data.qtdContasHoje > 0 ? `${data.qtdContasHoje} conta${data.qtdContasHoje !== 1 ? 's' : ''} vence${data.qtdContasHoje !== 1 ? 'm' : ''} hoje` : 'Nenhuma conta vence hoje'}
            </span>
            {data.qtdContasHoje > 0 && <b className="tabular-nums text-red-700">{fmt(data.contasHoje)}</b>}
          </span>
          {data.qtdContas7dias > 0 && (
            <span className="flex items-center justify-between gap-2 text-zinc-500">
              <span>Próximos 7 dias: {data.qtdContas7dias} conta{data.qtdContas7dias !== 1 ? 's' : ''}</span>
              <b className="tabular-nums text-zinc-700">{fmt(data.contas7dias)}</b>
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
