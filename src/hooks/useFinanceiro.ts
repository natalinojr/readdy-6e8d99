import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, SUPABASE_URL, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { translateSupabaseError } from '@/hooks/useQueryError';
import type {
  CostCenter, BillPayable, CashFlowEntry, Purchase,
  Supplier, FinanceiroDashboard, Anticipation, ReceivableInstallment,
} from '@/types/financeiro';

// ─── Bank Accounts ────────────────────────────────────────────────────────────
export interface BankAccount {
  id: string;
  tenant_id: string;
  name: string;
  bank_name?: string;
  account_type: 'checking' | 'savings' | 'cash' | 'digital';
  agency?: string;
  account_number?: string;
  pix_key?: string;
  initial_balance: number;
  current_balance: number;
  color: string;
  icon: string;
  is_active: boolean;
  is_default: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface IncomeRouting {
  id: string;
  tenant_id: string;
  source_type: string;
  source_id?: string;
  source_label: string;
  bank_account_id?: string;
  is_active: boolean;
  bank_account?: BankAccount;
}
export function useBankAccounts() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    setError(null);
    const result = await invokeFinancial('list_bank_accounts', user.tenantId, {});
    if (result?.error) {
      const t = translateSupabaseError({ message: result.error, code: '' } as any);
      console.error('[useBankAccounts] Erro:', result.error);
      setError(t.message);
      setAccounts([]);
    } else {
      setAccounts((result?.data as BankAccount[]) ?? []);
    }
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const upsert = async (payload: Partial<BankAccount>) => {
    if (!user?.tenantId) return;
    const result = await invokeFinancial('upsert_bank_account', user.tenantId, payload);
    if (result?.error) {
      console.error('[useBankAccounts] Erro ao salvar:', result.error);
      return { error: result.error };
    }
    fetchAccounts();
  };

  const setDefault = async (id: string) => {
    if (!user?.tenantId) return;
    await invokeFinancial('set_default_bank_account', user.tenantId, { id });
    fetchAccounts();
  };

  const remove = async (id: string) => {
    if (!user?.tenantId) return;
    await invokeFinancial('delete_bank_account', user.tenantId, { id });
    fetchAccounts();
  };

  const totalBalance = accounts.reduce((s, a) => s + Number(a.current_balance), 0);

  return { accounts, loading, error, upsert, remove, setDefault, refresh: fetchAccounts, totalBalance };
}

export function useIncomeRouting() {
  const { user } = useAuth();
  const [routings, setRoutings] = useState<IncomeRouting[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRoutings = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const result = await invokeFinancial('list_income_routing', user.tenantId, {});
    if (result?.error) {
      console.error('[useIncomeRouting] Erro:', result.error);
      setRoutings([]);
    } else {
      setRoutings((result?.data as IncomeRouting[]) ?? []);
    }
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchRoutings(); }, [fetchRoutings]);

  const upsert = async (payload: Partial<IncomeRouting>) => {
    if (!user?.tenantId) return;
    await invokeFinancial('upsert_income_routing', user.tenantId, payload);
    fetchRoutings();
  };

  const remove = async (id: string) => {
    if (!user?.tenantId) return;
    await invokeFinancial('delete_income_routing', user.tenantId, { id });
    fetchRoutings();
  };

  return { routings, loading, upsert, remove, refresh: fetchRoutings };
}

export interface BankTransaction {
  id: string;
  tenant_id: string;
  bank_account_id: string;
  type: 'credit' | 'debit';
  amount: number;
  balance_after: number;
  description: string;
  reference_type?: string;
  reference_id?: string;
  transaction_date: string;
  created_at: string;
}

export function useBankTransactions(bankAccountId?: string, startDate?: string, endDate?: string) {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTransactions = useCallback(async () => {
    if (!user?.tenantId || !bankAccountId) {
      setTransactions([]);
      return;
    }
    setLoading(true);
    const result = await invokeFinancial('list_bank_transactions', user.tenantId, {
      bank_account_id: bankAccountId,
      limit: 200,
      start_date: startDate,
      end_date: endDate,
    });
    if (result?.error) {
      console.error('[useBankTransactions] Erro:', result.error);
      setTransactions([]);
    } else {
      setTransactions((result?.data as BankTransaction[]) ?? []);
    }
    setLoading(false);
  }, [user?.tenantId, bankAccountId, startDate, endDate]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const manualTransaction = async (payload: {
    bank_account_id: string;
    type: 'credit' | 'debit';
    amount: number;
    description: string;
    transaction_date?: string;
  }) => {
    if (!user?.tenantId) return;
    await invokeFinancial('bank_manual_transaction', user.tenantId, payload);
    fetchTransactions();
  };

  return { transactions, loading, refresh: fetchTransactions, manualTransaction };
}

async function invokeFinancial(action: string, tenantId: string, payload: Record<string, unknown>) {
  const { data, error } = await invokeWithAuth<{ data: unknown; error?: string }>(
    'financial-write',
    { body: { action, tenant_id: tenantId, payload } },
  );
  if (error) {
    // Não logar como erro crítico quando é duplicata de negócio (409)
    const isBusinessError = error.message.includes('Já existe um centro de custo') || error.message.includes('unique constraint');
    if (!isBusinessError) {
      console.error('[invokeFinancial] Erro:', error.message);
    }
    return { error: error.message };
  }
  // A edge function retorna { data: ... } ou { error: ... } no body
  const body = data as Record<string, unknown> | null;
  if (body?.error) {
    console.error('[invokeFinancial] Erro da edge function:', body.error);
    return { error: body.error };
  }
  return { data: body?.data ?? null };
}

// ─── Cost Centers ─────────────────────────────────────────────────────────────
export function useCostCenters() {
  const { user } = useAuth();
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    // Usa edge function (service role) para garantir leitura correta
    // independente de qual tenant a RLS retorna para usuários com múltiplos tenants
    const result = await invokeFinancial('list_cost_centers', user.tenantId, {});
    if (result?.error) {
      console.error('[useCostCenters] Erro ao buscar centros de custo:', result.error);
      setCenters([]);
    } else {
      setCenters((result?.data as CostCenter[]) ?? []);
    }
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetch(); }, [fetch]);

  const upsert = async (payload: Partial<CostCenter>): Promise<{ error?: string } | void> => {
    const result = await invokeFinancial('upsert_cost_center', user!.tenantId, payload as Record<string, unknown>);
    if (result?.error) return { error: String(result.error) };
    fetch();
  };

  const remove = async (id: string) => {
    await invokeFinancial('delete_cost_center', user!.tenantId, { id });
    fetch();
  };

  return { centers, loading, upsert, remove, refresh: fetch };
}

// ─── Cash Flow ────────────────────────────────────────────────────────────────
export function useCashFlow(startDate?: string, endDate?: string) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<CashFlowEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const result = await invokeFinancial('list_cash_flow', user.tenantId, { startDate, endDate });
    if (result?.error) {
      console.error('[useFinanceiro] Erro ao buscar fluxo de caixa:', result.error);
      setEntries([]);
    } else {
      setEntries((result?.data as CashFlowEntry[]) ?? []);
    }
    setLoading(false);
  }, [user?.tenantId, startDate, endDate]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const insert = async (payload: Partial<CashFlowEntry>) => {
    // Limpar campos UUID vazios para evitar "invalid input syntax for type uuid"
    const cleanPayload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value === '') {
        cleanPayload[key] = null;
      } else {
        cleanPayload[key] = value;
      }
    }
    await invokeFinancial('insert_cash_flow', user!.tenantId, cleanPayload);
    fetchEntries();
  };

  const remove = async (id: string) => {
    await invokeFinancial('delete_cash_flow', user!.tenantId, { id });
    fetchEntries();
  };

  const totalEntradas = entries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const totalSaidas = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const saldo = totalEntradas - totalSaidas;

  return { entries, loading, insert, remove, refresh: fetchEntries, totalEntradas, totalSaidas, saldo };
}

// ─── Bills Payable ────────────────────────────────────────────────────────────
export function useBillsPayable() {
  const { user } = useAuth();
  const [bills, setBills] = useState<BillPayable[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBills = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const result = await invokeFinancial('list_bills_payable', user.tenantId, {});
    if (result?.error) {
      console.error('[useFinanceiro] Erro ao buscar contas a pagar:', result.error);
      setBills([]);
    } else {
      setBills((result?.data as BillPayable[]) ?? []);
    }
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  const upsert = async (payload: Partial<BillPayable>) => {
    await invokeFinancial('upsert_bill', user!.tenantId, payload);
    fetchBills();
  };

  const pay = async (id: string, paid_date: string, paid_amount: number, payment_method: string) => {
    await invokeFinancial('pay_bill', user!.tenantId, { id, paid_date, paid_amount, payment_method });
    fetchBills();
  };

  const remove = async (id: string) => {
    await invokeFinancial('delete_bill', user!.tenantId, { id });
    fetchBills();
  };

  return { bills, loading, upsert, pay, remove, refresh: fetchBills };
}

// ─── Purchases ────────────────────────────────────────────────────────────────
export function usePurchases() {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const auditRef = useRef<((p: import('@/contexts/AuditoriaContext').RegistrarEventoParams) => void) | null>(null);

  // Lazy import auditoria to avoid circular deps
  useEffect(() => {
    import('@/contexts/AuditoriaContext').then(() => {}).catch(() => {});
  }, []);

  const fetchPurchases = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('fin_purchases')
      .select('*, items:fin_purchase_items(*), cost_center:fin_cost_centers(id,name,color,icon)')
      .eq('tenant_id', user.tenantId)
      .order('purchase_date', { ascending: false });
    if (error) {
      console.error('[useFinanceiro] Erro ao buscar compras:', error.message);
    }
    setPurchases(data ?? []);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchPurchases(); }, [fetchPurchases]);

  const create = async (payload: Record<string, unknown>, auditFn?: (p: import('@/contexts/AuditoriaContext').RegistrarEventoParams) => void) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/purchase-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ action: 'create_purchase', tenant_id: user!.tenantId, payload }),
    });
    const result = await res.json();
    if (!res.ok) {
      const errMsg = typeof result.error === 'string' ? result.error : JSON.stringify(result.error || result);
      console.error('[purchase-write] Erro:', errMsg);
      throw new Error(errMsg);
    } else if (auditFn && user) {
      const totalAmount = Number(payload.total_amount ?? 0);
      const supplier = String(payload.supplier ?? '');
      const paymentStatus = String(payload.payment_status ?? 'paid');
      auditFn({
        tipo: 'compra_registrada',
        severidade: 'info',
        usuario: user.nome,
        perfil: user.perfil,
        descricao: `Nova compra registrada: ${supplier} — R$ ${totalAmount.toFixed(2)} (${paymentStatus === 'paid' ? 'à vista' : paymentStatus === 'partial' ? 'parcelado' : 'a prazo'})`,
        entidade: 'Financeiro / Compras',
        entidadeId: supplier,
        depois: { total: totalAmount, fornecedor: supplier, status: paymentStatus },
      });
    }
    fetchPurchases();
    return result;
  };

  const remove = async (id: string, auditFn?: (p: import('@/contexts/AuditoriaContext').RegistrarEventoParams) => void) => {
    const purchase = purchases.find((p) => p.id === id);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/purchase-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ action: 'delete_purchase', tenant_id: user!.tenantId, payload: { id } }),
    });
    if (!res.ok) {
      const json = await res.json();
      console.error('[invokeFinancial] Erro:', json.error);
    } else if (auditFn && user && purchase) {
      auditFn({
        tipo: 'estoque_ajustado',
        severidade: 'aviso',
        usuario: user.nome,
        perfil: user.perfil,
        descricao: `Compra excluída: ${purchase.supplier} — R$ ${purchase.total_amount.toFixed(2)}`,
        entidade: 'Financeiro / Compras',
        entidadeId: purchase.supplier,
        antes: { total: purchase.total_amount, fornecedor: purchase.supplier },
      });
    }
    fetchPurchases();
  };

  return { purchases, loading, create, remove, refresh: fetchPurchases, _auditRef: auditRef };
}

// ─── Suppliers ────────────────────────────────────────────────────────────────
export function useSuppliers() {
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSuppliers = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const result = await invokeFinancial('list_suppliers', user.tenantId, {});
    if (result?.error) {
      console.error('[useFinanceiro] Erro ao buscar fornecedores:', result.error);
      setSuppliers([]);
    } else {
      setSuppliers((result?.data as Supplier[]) ?? []);
    }
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);

  const upsert = async (payload: Partial<Supplier>) => {
    await invokeFinancial('upsert_supplier', user!.tenantId, payload);
    fetchSuppliers();
  };

  return { suppliers, loading, upsert, refresh: fetchSuppliers };
}

// ─── Anticipations ────────────────────────────────────────────────────────────
export function useAntecipacoes() {
  const { user } = useAuth();
  const [anticipations, setAnticipations] = useState<Anticipation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAntecipacoes = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const result = await invokeFinancial('list_anticipations', user.tenantId, {});
    if (result?.error) {
      console.error('[useFinanceiro] Erro ao buscar antecipações:', result.error);
      setAnticipations([]);
    } else {
      setAnticipations((result?.data as Anticipation[]) ?? []);
    }
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchAntecipacoes(); }, [fetchAntecipacoes]);

  const insert = async (payload: {
    gross_amount: number;
    fee_percent: number;
    net_amount: number;
    notes?: string;
    installment_ids?: string[];
  }) => {
    await invokeFinancial('insert_anticipation', user!.tenantId, payload);
    fetchAntecipacoes();
  };

  return { anticipations, loading, insert, refresh: fetchAntecipacoes };
}

// ─── Receivable Installments ──────────────────────────────────────────────────
export function useReceivableInstallments() {
  const { user } = useAuth();
  const [installments, setInstallments] = useState<ReceivableInstallment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInstallments = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const result = await invokeFinancial('list_receivable_installments', user.tenantId, {});
    if (result?.error) {
      console.error('[useFinanceiro] Erro ao buscar parcelas a receber:', result.error);
      setInstallments([]);
    } else {
      setInstallments((result?.data as ReceivableInstallment[]) ?? []);
    }
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchInstallments(); }, [fetchInstallments]);

  const receive = async (id: string) => {
    await invokeFinancial('receive_installment', user!.tenantId, { id });
    fetchInstallments();
  };

  return { installments, loading, receive, refresh: fetchInstallments };
}

// ─── Top Despesas ─────────────────────────────────────────────────────────────
export interface TopDespesa {
  category: string;
  total: number;
  count: number;
  pct: number;
}

// INVARIANTE: Para verificar double-count, some os valores de useTopDespesas
// e compare com o total de saídas de fin_cash_flow do mesmo período.
// Os valores devem ser iguais.
//
// ESTRATÉGIA ANTI-DOUBLE-COUNT:
// Usamos fin_cash_flow como ÚNICA fonte de verdade para despesas.
// Excluímos origens automáticas que seriam duplicadas se somadas com outras tabelas:
//   - 'auto_purchase'      → gerado automaticamente ao pagar uma compra (fin_purchases)
//   - 'auto_bill_payment'  → gerado automaticamente ao pagar uma conta (fin_accounts_payable)
// Essas origens JÁ ESTÃO em fin_cash_flow, então não precisamos somar fin_purchases
// nem fin_accounts_payable separadamente.
// A folha de pagamento (hr_payroll) AGORA também passa por fin_cash_flow (origin='auto_payroll'),
// então não precisamos mais buscar hr_payroll separadamente para despesas pagas.
// Mantemos a busca separada apenas para hr_payroll.status='pending' (despesas comprometidas).

export function useTopDespesas(monthsBack = 1) {
  const { user } = useAuth();
  const [despesas, setDespesas] = useState<TopDespesa[]>([]);
  const [totalGeral, setTotalGeral] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchDespesas = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsBack);
    startDate.setDate(1);
    const startStr = startDate.toISOString().split('T')[0];

    // Fonte única de verdade: fin_cash_flow (saídas manuais + automáticas)
    // A folha de pagamento paga agora já está em fin_cash_flow com origin='auto_payroll',
    // então não precisamos buscar hr_payroll separadamente.
    const { data, error } = await supabase
      .from('fin_cash_flow')
      .select('category, amount, origin, description')
      .eq('tenant_id', user.tenantId)
      .eq('type', 'expense')
      .gte('date', startStr);

    if (error) console.error('[useTopDespesas] Erro ao buscar cash_flow:', error.message);

    const map: Record<string, { total: number; count: number }> = {};

    const addToMap = (cat: string, amount: number) => {
      const key = cat?.trim() || 'Outros';
      if (!map[key]) map[key] = { total: 0, count: 0 };
      map[key].total += Number(amount);
      map[key].count += 1;
    };

    // Todas as saídas do fluxo de caixa (inclui auto_payroll, auto_purchase, auto_bill_payment, antecipações, manuais)
    (data ?? []).forEach(c => addToMap(c.category || 'Outros', c.amount));

    const total = Object.values(map).reduce((s, v) => s + v.total, 0);

    const sorted = Object.entries(map)
      .map(([category, { total: t, count }]) => ({
        category,
        total: t,
        count,
        pct: total > 0 ? (t / total) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    setDespesas(sorted);
    setTotalGeral(total);
    setLoading(false);
  }, [user?.tenantId, monthsBack]);

  useEffect(() => { fetchDespesas(); }, [fetchDespesas]);

  return { despesas, totalGeral, loading };
}

// ─── Dashboard Financeiro ─────────────────────────────────────────────────────
export function useFinanceiroDashboard(): { dashboard: FinanceiroDashboard | null; loading: boolean; error: string | null } {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<FinanceiroDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.tenantId) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      // Usar timezone de Brasília para calcular "hoje" corretamente (igual ao fn_get_dashboard_metrics)
      const brStr = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
      const nowBR = new Date(brStr);
      const y = nowBR.getFullYear();
      const m = String(nowBR.getMonth() + 1).padStart(2, '0');
      const d = String(nowBR.getDate()).padStart(2, '0');
      const todayStr = `${y}-${m}-${d}`;

      const startOfMonthStr = `${y}-${m}-01T00:00:00-03:00`;
      const prevMonthDate = new Date(nowBR.getFullYear(), nowBR.getMonth() - 1, 1);
      const pY = prevMonthDate.getFullYear();
      const pM = String(prevMonthDate.getMonth() + 1).padStart(2, '0');
      const prevMonthStartStr = `${pY}-${pM}-01T00:00:00-03:00`;
      const thirtyDaysAgoBR = new Date(nowBR.getTime() - 30 * 86400000);
      const tdaY = thirtyDaysAgoBR.getFullYear();
      const tdaM = String(thirtyDaysAgoBR.getMonth() + 1).padStart(2, '0');
      const tdaD = String(thirtyDaysAgoBR.getDate()).padStart(2, '0');
      const thirtyDaysAgoStr = `${tdaY}-${tdaM}-${tdaD}T00:00:00-03:00`;

      const sevenDaysLaterBR = new Date(nowBR.getTime() + 7 * 86400000);
      const sdlY = sevenDaysLaterBR.getFullYear();
      const sdlM = String(sevenDaysLaterBR.getMonth() + 1).padStart(2, '0');
      const sdlD = String(sevenDaysLaterBR.getDate()).padStart(2, '0');
      const sevenDaysLaterStr = `${sdlY}-${sdlM}-${sdlD}`;

      const currentMonthStr = `${y}-${m}`;
      const monthStartDate = startOfMonthStr.split('T')[0];
      const monthEndDate = `${y}-${m}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
      const prevMonthStartDate = prevMonthStartStr.split('T')[0];
      const prevMonthEndDate = `${pY}-${pM}-${String(new Date(pY, pM, 0).getDate()).padStart(2, '0')}`;
      const thirtyDaysAgoDate = thirtyDaysAgoStr.split('T')[0];

      // ═══ LIVRO-RAZÃO ÚNICO: fin_cash_flow é a fonte de verdade para receita e despesa ═══
      // Receita = auto_sale (vendas recebidas à vista) + manual (entradas manuais)
      // Despesa = todas as saídas de fin_cash_flow (já inclui auto_purchase, auto_bill_payment, auto_payroll, etc.)
      // orders e payments são usados APENAS para contagem (ticket médio) e detalhamento.
      const [cashFlow, billsVencendo,          
             autoSaleHoje, autoSaleMes, autoSalePrevMes, autoSale30d, ordersMesCount, payrollPendingMes,
             manualIncomeHoje, manualIncomeMes, manualIncome30d, installmentsPendentes] = await Promise.all([
        supabase.from('fin_cash_flow').select('type,amount,origin')
          .eq('tenant_id', user.tenantId)
          .gte('date', monthStartDate),
        supabase.from('fin_accounts_payable').select('*')
          .eq('tenant_id', user.tenantId)
          .in('status', ['pending', 'overdue'])
          .lte('due_date', sevenDaysLaterStr)
          .order('due_date'),
        // Receita auto_sale (vendas recebidas à vista) — hoje
        supabase.from('fin_cash_flow').select('amount, payment_method_id, payment_methods(name)')
          .eq('tenant_id', user.tenantId).eq('type', 'income')
          .eq('origin', 'auto_sale').eq('date', todayStr),
        // Receita auto_sale — mês atual
        supabase.from('fin_cash_flow').select('amount, payment_method_id, payment_methods(name)')
          .eq('tenant_id', user.tenantId).eq('type', 'income')
          .eq('origin', 'auto_sale')
          .gte('date', monthStartDate).lte('date', monthEndDate),
        // Receita auto_sale — mês anterior
        supabase.from('fin_cash_flow').select('amount')
          .eq('tenant_id', user.tenantId).eq('type', 'income')
          .eq('origin', 'auto_sale')
          .gte('date', prevMonthStartDate).lte('date', prevMonthEndDate),
        // Receita auto_sale — últimos 30 dias (com date e payment_method pra gráficos)
        supabase.from('fin_cash_flow').select('amount, payment_method_id, payment_methods(name), date')
          .eq('tenant_id', user.tenantId).eq('type', 'income')
          .eq('origin', 'auto_sale').gte('date', thirtyDaysAgoDate),
        // Apenas contagem de pedidos do mês para ticket médio
        supabase.from('orders').select('id', { count: 'exact', head: true })
          .eq('tenant_id', user.tenantId).gte('created_at', startOfMonthStr)
          .eq('is_paid', true).not('status', 'in', '(cancelled,draft)')
          .eq('is_training', false).eq('is_draft', false),
        // Folha de pagamento pendente do mês atual
        supabase.from('hr_payroll').select('net_salary')
          .eq('tenant_id', user.tenantId)
          .eq('reference_month', currentMonthStr)
          .eq('status', 'pending'),
        // Entradas manuais do fluxo de caixa — hoje
        supabase.from('fin_cash_flow').select('amount, payment_method_id, payment_methods(name)')
          .eq('tenant_id', user.tenantId).eq('type', 'income')
          .eq('origin', 'manual').eq('date', todayStr),
        // Entradas manuais do fluxo de caixa — mês atual
        supabase.from('fin_cash_flow').select('amount, payment_method_id, payment_methods(name)')
          .eq('tenant_id', user.tenantId).eq('type', 'income')
          .eq('origin', 'manual').gte('date', monthStartDate),
        // Entradas manuais do fluxo de caixa — últimos 30 dias
        supabase.from('fin_cash_flow').select('amount, payment_method_id, payment_methods(name), date')
          .eq('tenant_id', user.tenantId).eq('type', 'income')
          .eq('origin', 'manual').gte('date', thirtyDaysAgoDate),
        // Parcelas a receber pendentes nos próximos 7 dias
        supabase.from('fin_receivable_installments').select('amount')
          .eq('tenant_id', user.tenantId).eq('status', 'pending')
          .lte('due_date', sevenDaysLaterStr),
      ]);

      // Verificar erros críticos e expor mensagem amigável
      const criticalErrors = [cashFlow, billsVencendo, payrollPendingMes]
        .filter(r => r.error);
      if (criticalErrors.length > 0) {
        const firstErr = criticalErrors[0].error!;
        const translated = translateSupabaseError(firstErr);
        console.error('[useFinanceiro] Erro no dashboard:', firstErr.message, firstErr.code);
        setError(translated.message);
      }
      if (cashFlow.error) console.error('[useFinanceiro] fluxo de caixa:', cashFlow.error.message);
      if (billsVencendo.error) console.error('[useFinanceiro] contas vencendo:', billsVencendo.error.message);
      if (payrollPendingMes.error) console.error('[useFinanceiro] folha pendente:', payrollPendingMes.error.message);

      // Fonte única de verdade: auto_sale + entradas manuais do fluxo de caixa
      const manualHojeTotal = (manualIncomeHoje.data ?? []).reduce((s, m) => s + Number(m.amount), 0);
      const manualMesTotal = (manualIncomeMes.data ?? []).reduce((s, m) => s + Number(m.amount), 0);
      const receitaHoje = (autoSaleHoje.data ?? []).reduce((s, o) => s + Number(o.amount), 0) + manualHojeTotal;
      const receitaMes = (autoSaleMes.data ?? []).reduce((s, o) => s + Number(o.amount), 0) + manualMesTotal;
      const receitaPrevMes = (autoSalePrevMes.data ?? []).reduce((s, o) => s + Number(o.amount), 0);
      const crescimentoMes = receitaPrevMes > 0 ? ((receitaMes - receitaPrevMes) / receitaPrevMes) * 100 : 0;
      const totalOrdersMes = (ordersMesCount as any).count;
      const ticketMedio = totalOrdersMes > 0 ? (receitaMes - manualMesTotal) / totalOrdersMes : 0;

      // entradas: exclui auto_sale e manual income (já contados em receitaMes)
      // mantém outras origens de receita (ex: antecipações, estornos, etc.)
      const entradas = (cashFlow.data ?? [])
        .filter(e => e.type === 'income' && !['auto_sale', 'manual'].includes((e as any).origin ?? ''))
        .reduce((s, e) => s + Number(e.amount), 0);
      // saidas: TODAS as despesas — incluindo manual, auto_card_fee, auto_purchase, auto_bill_payment, auto_payroll
      const saidas = (cashFlow.data ?? []).filter(e => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0);
      const saldoCaixa = receitaMes + entradas - saidas;

      // Lucro REAL = Receita - Despesas Totais (apenas saídas de fin_cash_flow)
      // A folha de pagamento paga já está em fin_cash_flow com origin='auto_payroll',
      // então não precisamos somar hr_payroll separadamente.
      const despesasTotais = saidas;
      const lucroEstimado = Math.max(0, receitaMes - despesasTotais);

      const totalAPagar = (billsVencendo.data ?? []).reduce((s, b) => s + Number(b.amount), 0);
      const folhaPendente = (payrollPendingMes.data ?? []).reduce((s, p) => s + Number(p.net_salary), 0);
      // Despesas comprometidas = contas a pagar + folha pendente
      const totalComprometido = totalAPagar + folhaPendente;
      // Parcelas a receber pendentes nos próximos 7 dias
      const totalAReceber = (installmentsPendentes.data ?? []).reduce((s, i) => s + Number(i.amount), 0);

      // Receita por forma de pagamento (últimos 30 dias) — auto_sale + entradas manuais
      const paymentMap: Record<string, number> = {};
      const colors = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4'];
      (autoSale30d.data ?? []).forEach((e: Record<string, unknown>) => {
        const name = (e.payment_methods as Record<string, string> | null)?.name ?? 'Venda Direta';
        paymentMap[name] = (paymentMap[name] ?? 0) + Number(e.amount);
      });
      (manualIncome30d.data ?? []).forEach((m: Record<string, unknown>) => {
        const name = (m.payment_methods as Record<string, string> | null)?.name ?? 'Entrada Manual';
        paymentMap[name] = (paymentMap[name] ?? 0) + Number(m.amount);
      });
      const receitaPorPagamento = Object.entries(paymentMap).map(([name, value], i) => ({
        name, value, color: colors[i % colors.length],
      }));

      // Receita diária últimos 30 dias — auto_sale + entradas manuais agrupados por data
      const dailyMap: Record<string, number> = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(nowBR.getTime() - i * 86400000).toISOString().split('T')[0];
        dailyMap[d] = 0;
      }
      (autoSale30d.data ?? []).forEach((e: { amount: number; date: string }) => {
        if (e.date in dailyMap) dailyMap[e.date] += Number(e.amount);
      });
      (manualIncome30d.data ?? []).forEach((m: { amount: number; date: string }) => {
        if (m.date in dailyMap) dailyMap[m.date] += Number(m.amount);
      });

      setDashboard({
        receitaHoje,
        receitaMes,
        ticketMedio,
        lucroEstimado,
        saldoCaixa,
        crescimentoMes,
        totalAPagar,
        totalAReceber,
        totalComprometido,
        contasVencendo: (billsVencendo.data ?? []) as BillPayable[],
        receitaDiaria: Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value })),
        receitaPorPagamento,
      });
      setLoading(false);
    };

    load();
  }, [user?.tenantId]);

  return { dashboard, loading, error };
}
