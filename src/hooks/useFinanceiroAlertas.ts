import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { todayBrasilia, somarDias } from '@/lib/dateUtils';
import { aPagar, type ContaEmAberto } from '@/lib/contasAbertas';

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
  reload: () => void;
}


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
    // Datas calculadas a cada carga: no escopo do módulo ficavam presas no dia em que a tela abriu
    // Dia de Brasília: toISOString é UTC e virava "amanhã" às 21h (conta de hoje contava como vencida)
    const today = todayBrasilia();
    const sevenDaysLater = somarDias(today, 7);
    const currentMonth = today.slice(0, 7);

    const [billsRes, payrollRes, budgetsRes, comprasRecebidasRes] = await Promise.all([
      // Contas a pagar vencidas ou vencendo em 7 dias
      // Regra única de "em aberto" (fn_contas_em_aberto, 2026-10-07): a mesma do Painel, da Hoje e de Pagamentos
      supabase.rpc('fn_contas_em_aberto', { p_tenants: [user.tenantId] }),

      // Folha pendente do mês atual
      supabase
        .from('hr_payroll')
        .select('id, net_salary, status, reference_month, rubricas')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'pending')
        .eq('reference_month', currentMonth),

      // Orçamentos expirando em 3 dias
      supabase
        .from('fin_budgets')
        // As colunas de `fin_budgets` sao em PORTUGUES (`titulo`, `validade`).
        // Pedir `title`/`valid_until` dava 400 e o alerta de orcamento
        // expirando nunca disparava.
        .select('id, titulo, validade, status')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'approved')
        .lte('validade', new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0])
        .gte('validade', today),

      // Compras com mercadoria recebida mas pagamento pendente
      supabase
        .from('fin_purchases')
        .select('id, supplier, total_amount, delivery_confirmed_at, payment_status, notes')
        .eq('tenant_id', user.tenantId)
        .not('delivery_confirmed_at', 'is', null)
        .in('payment_status', ['pending', 'partial']),
    ]);

    // Saldo que falta de cada compra = o que sobra nas contas a pagar dela (regra única fn_contas_em_aberto:
    // valor = amount − pago). Antes somava o total_amount da compra inteira, mesmo paga em parte.
    const saldoAbertoPorCompra = new Map<string, number>();
    ((billsRes.data ?? []) as ContaEmAberto[]).forEach((c) => {
      if (c.origem === 'purchase' && c.reference_id) {
        saldoAbertoPorCompra.set(String(c.reference_id), (saldoAbertoPorCompra.get(String(c.reference_id)) ?? 0) + Number(c.valor));
      }
    });
    // compra "já paga por … na entrega" não está aguardando pagamento (o Receber deixa pendente até o extrato).
    // Sem conta a pagar em aberto: 'partial' já foi quitada (sai); 'pending' sem conta ligada segue pelo total.
    const comprasRecebidasPendentes = ((comprasRecebidasRes.data ?? []) as Array<{ id: string; total_amount: number; payment_status: string; notes: string | null }>)
      .filter((c) => !/já paga /i.test(c.notes ?? ''))
      .map((c) => ({ ...c, saldo: saldoAbertoPorCompra.get(String(c.id)) ?? (c.payment_status === 'partial' ? 0 : Number(c.total_amount)) }))
      .filter((c) => c.saldo > 0.005);

    // Saldo devedor (valor − pago), sem cancelada e sem compra já paga na entrega; vencidas + até 7 dias
    const abertas7 = aPagar((billsRes.data ?? []) as ContaEmAberto[]).filter((c) => c.vencimento <= sevenDaysLater);
    // vencida = vencimento antes de hoje (Brasília), não o status gravado — igual às outras telas
    const bills = abertas7.map((c) => ({ id: c.id, description: c.nome, amount: Number(c.valor), due_date: c.vencimento, status: c.vencimento < today ? 'overdue' : 'vencendo' }));

    const vencidas = bills.filter(b => b.status === 'overdue');
    const vencendo = bills.filter(b => b.status !== 'overdue');
    // Folha pendente: tira só a folha cuja conta a pagar JÁ entrou acima (vence em até 7 dias) — antes contava 2×;
    // a folha cuja conta vence mais longe (5º dia útil do mês seguinte) continua avisando aqui.
    const folhaNaSoma = new Set(abertas7.filter((c) => c.origem === 'hr_payroll' && c.reference_id).map((c) => String(c.reference_id)));
    // "Só INSS" (sócio sem retirada: todas as rubricas são inss_socio) não é salário a pagar — sai no DARF (RHTab › isSoInss).
    const soInss = (p: { rubricas?: unknown }) => Array.isArray(p.rubricas) && p.rubricas.length > 0
      && (p.rubricas as Array<{ categoria?: string }>).every((r) => r?.categoria === 'inss_socio');
    const payrollPending = (payrollRes.data ?? []).filter((p) => !folhaNaSoma.has(String(p.id)) && !soInss(p));
    const budgets = budgetsRes.data ?? [];

    const totalVencidas = vencidas.reduce((s, b) => s + Number(b.amount), 0);
    const totalVencendo = vencendo.reduce((s, b) => s + Number(b.amount), 0);
    const totalFolha = payrollPending.reduce((s, p) => s + Number(p.net_salary), 0);

    // Nome do mês a partir de 'AAAA-MM' direto: new Date('2026-10-01') é meia-noite UTC e no fuso de Brasília
    // vira 30/09 — o aviso saía com o mês anterior ("setembro").
    const [anoFolha, mesFolha] = currentMonth.split('-').map(Number);
    const nomeMesFolha = new Date(anoFolha, mesFolha - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });

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
        titulo: `Folha de ${nomeMesFolha} pendente`,
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
      const totalPendente = comprasRecebidasPendentes.reduce((s, c) => s + c.saldo, 0);
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
    reload: load,
  };
}
