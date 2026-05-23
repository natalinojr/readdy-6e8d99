import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface FinanceiroAlerta {
  tipo: 'conta_vencida' | 'conta_vencendo' | 'folha_pendente' | 'orcamento_expirando' | 'compra_recebida_pendente';
  titulo: string;
  descricao: string;
  valor?: number;
  quantidade?: number;
  urgencia: 'alta' | 'media' | 'baixa';
}

export interface FinanceiroAlertasSummary {
  alertas: FinanceiroAlerta[];
  totalUrgente: number;
  contasVencidas: number;
  contasVencendo: number;
  folhaPendente: number;
  totalBadge: number; // número para o badge da sidebar
  loading: boolean;
}

const today = new Date().toISOString().split('T')[0];
const sevenDaysLater = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
const currentMonth = today.slice(0, 7);

export function useFinanceiroAlertas(): FinanceiroAlertasSummary {
  const { user } = useAuth();
  const [alertas, setAlertas] = useState<FinanceiroAlerta[]>([]);
  const [totals, setTotals] = useState({
    contasVencidas: 0,
    contasVencendo: 0,
    folhaPendente: 0,
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.tenantId || !['admin', 'gerente'].includes(user.perfil)) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const [billsRes, payrollRes, budgetsRes, comprasRecebidasRes] = await Promise.all([
      // Contas a pagar vencidas ou vencendo em 7 dias
      supabase
        .from('fin_accounts_payable')
        .select('id, description, amount, due_date, status')
        .eq('tenant_id', user.tenantId)
        .in('status', ['pending', 'overdue'])
        .lte('due_date', sevenDaysLater)
        .order('due_date'),

      // Folha pendente do mês atual
      supabase
        .from('hr_payroll')
        .select('id, net_salary, status, reference_month')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'pending')
        .eq('reference_month', currentMonth),

      // Orçamentos expirando em 3 dias
      supabase
        .from('fin_budgets')
        .select('id, title, valid_until, status')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'approved')
        .lte('valid_until', new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0])
        .gte('valid_until', today),

      // Compras com mercadoria recebida mas pagamento pendente
      supabase
        .from('fin_purchases')
        .select('id, supplier, total_amount, delivery_confirmed_at, payment_status')
        .eq('tenant_id', user.tenantId)
        .not('delivery_confirmed_at', 'is', null)
        .in('payment_status', ['pending', 'partial']),
    ]);

    const comprasRecebidasPendentes = comprasRecebidasRes.data ?? [];

    const bills = (billsRes.data ?? []).map(b => ({
      ...b,
      status: b.status === 'pending' && b.due_date < today ? 'overdue' : b.status,
    }));

    const vencidas = bills.filter(b => b.status === 'overdue');
    const vencendo = bills.filter(b => b.status === 'pending');
    const payrollPending = payrollRes.data ?? [];
    const budgets = budgetsRes.data ?? [];

    const totalVencidas = vencidas.reduce((s, b) => s + Number(b.amount), 0);
    const totalVencendo = vencendo.reduce((s, b) => s + Number(b.amount), 0);
    const totalFolha = payrollPending.reduce((s, p) => s + Number(p.net_salary), 0);

    const novasAlertas: FinanceiroAlerta[] = [];

    if (vencidas.length > 0) {
      novasAlertas.push({
        tipo: 'conta_vencida',
        titulo: `${vencidas.length} conta${vencidas.length > 1 ? 's' : ''} vencida${vencidas.length > 1 ? 's' : ''}`,
        descricao: `Total em atraso: R$ ${totalVencidas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        valor: totalVencidas,
        quantidade: vencidas.length,
        urgencia: 'alta',
      });
    }

    if (vencendo.length > 0) {
      novasAlertas.push({
        tipo: 'conta_vencendo',
        titulo: `${vencendo.length} conta${vencendo.length > 1 ? 's' : ''} vence${vencendo.length > 1 ? 'm' : ''} em breve`,
        descricao: `Total a pagar em 7 dias: R$ ${totalVencendo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        valor: totalVencendo,
        quantidade: vencendo.length,
        urgencia: 'media',
      });
    }

    if (payrollPending.length > 0) {
      novasAlertas.push({
        tipo: 'folha_pendente',
        titulo: `Folha de ${new Date(currentMonth + '-01').toLocaleDateString('pt-BR', { month: 'long' })} pendente`,
        descricao: `${payrollPending.length} funcionário(s) aguardando pagamento — R$ ${totalFolha.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        valor: totalFolha,
        quantidade: payrollPending.length,
        urgencia: 'media',
      });
    }

    if (budgets.length > 0) {
      novasAlertas.push({
        tipo: 'orcamento_expirando',
        titulo: `${budgets.length} orçamento${budgets.length > 1 ? 's' : ''} expira${budgets.length > 1 ? 'm' : ''} em 3 dias`,
        descricao: 'Orçamentos aprovados próximos do vencimento',
        quantidade: budgets.length,
        urgencia: 'baixa',
      });
    }

    if (comprasRecebidasPendentes.length > 0) {
      const totalPendente = comprasRecebidasPendentes.reduce((s: number, c: { total_amount: number }) => s + Number(c.total_amount), 0);
      novasAlertas.push({
        tipo: 'compra_recebida_pendente',
        titulo: `${comprasRecebidasPendentes.length} compra${comprasRecebidasPendentes.length > 1 ? 's' : ''} recebida${comprasRecebidasPendentes.length > 1 ? 's' : ''} aguardando pagamento`,
        descricao: `Mercadoria já entregue — libere o pagamento. Total: R$ ${totalPendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        valor: totalPendente,
        quantidade: comprasRecebidasPendentes.length,
        urgencia: 'media',
      });
    }

    setAlertas(novasAlertas);
    setTotals({
      contasVencidas: vencidas.length,
      contasVencendo: vencendo.length,
      folhaPendente: payrollPending.length,
    });
    setLoading(false);
  }, [user?.tenantId, user?.perfil]);

  useEffect(() => { load(); }, [load]);

  const totalBadge = totals.contasVencidas + totals.contasVencendo + totals.folhaPendente;
  const totalUrgente = alertas.filter(a => a.urgencia === 'alta').reduce((s, a) => s + (a.quantidade ?? 0), 0);

  return {
    alertas,
    totalUrgente,
    contasVencidas: totals.contasVencidas,
    contasVencendo: totals.contasVencendo,
    folhaPendente: totals.folhaPendente,
    totalBadge,
    loading,
  };
}
