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

export function useBankTransactions(bankAccountId?: string) {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTransactions = useCallback(async () => {
    if (!user?.tenantId || !bankAccountId) {
      setTransactions([]);
      return;
    }
    setLoading(true);
    const result = await invokeFinancial('list_bank_transactions', user.tenantId, { bank_account_id: bankAccountId, limit: 100 });
    if (result?.error) {
      console.error('[useBankTransactions] Erro:', result.error);
      setTransactions([]);
    } else {
      setTransactions((result?.data as BankTransaction[]) ?? []);
    }
    setLoading(false);
  }, [user?.tenantId, bankAccountId]);

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
    const today = new Date().toISOString().split('T')[0];
    const result = await invokeFinancial('list_bills_payable', user.tenantId, {});
    if (result?.error) {
      console.error('[useFinanceiro] Erro ao buscar contas a pagar:', result.error);
      setBills([]);
    } else {
      const data = (result?.data as BillPayable[]) ?? [];
      // Auto-mark overdue
      const processed = data.map(b => ({
        ...b,
        status: b.status === 'pending' && b.due_date < today ? 'overdue' : b.status,
      }));
      setBills(processed);
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
        tipo: 'estoque_entrada',
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
// Os valores devem ser iguais (ou ter apenas a diferença da folha de pagamento
// que pode não estar em fin_cash_flow).
//
// ESTRATÉGIA ANTI-DOUBLE-COUNT:
// Usamos fin_cash_flow como ÚNICA fonte de verdade para despesas.
// Excluímos origens automáticas que seriam duplicadas se somadas com outras tabelas:
//   - 'auto_purchase'      → gerado automaticamente ao pagar uma compra (fin_purchases)
//   - 'auto_bill_payment'  → gerado automaticamente ao pagar uma conta (fin_accounts_payable)
// Essas origens JÁ ESTÃO em fin_cash_flow, então não precisamos somar fin_purchases
// nem fin_accounts_payable separadamente.
// A folha de pagamento (hr_payroll) é a única exceção — ainda não passa por fin_cash_flow.

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
    const startStr2 = startStr.slice(0, 7); // YYYY-MM para hr_payroll

    // Fonte única de verdade: fin_cash_flow (saídas manuais + automáticas)
    // Não somamos fin_purchases nem fin_accounts_payable separadamente para evitar
    // double-count — eles já geram entradas em fin_cash_flow via auto_purchase e auto_bill_payment.
    const [cashflowRes, payrollRes] = await Promise.all([
      supabase
        .from('fin_cash_flow')
        .select('category, amount, origin, description')
        .eq('tenant_id', user.tenantId)
        .eq('type', 'expense')
        .gte('date', startStr),
      // Folha de pagamento: única fonte que ainda não passa por fin_cash_flow
      supabase
        .from('hr_payroll')
        .select('net_salary, reference_month')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'paid')
        .gte('reference_month', startStr2),
    ]);

    if (cashflowRes.error) console.error('[useTopDespesas] Erro ao buscar cash_flow:', cashflowRes.error.message);
    if (payrollRes.error) console.error('[useTopDespesas] Erro ao buscar folha:', payrollRes.error.message);

    const map: Record<string, { total: number; count: number }> = {};

    const addToMap = (cat: string, amount: number) => {
      const key = cat?.trim() || 'Outros';
      if (!map[key]) map[key] = { total: 0, count: 0 };
      map[key].total += Number(amount);
      map[key].count += 1;
    };

    // Todas as saídas do fluxo de caixa (inclui auto_purchase, auto_bill_payment, antecipações, manuais)
    (cashflowRes.data ?? []).forEach(c => addToMap(c.category || 'Outros', c.amount));

    // Folha de pagamento (não está em fin_cash_flow ainda)
    (payrollRes.data ?? []).forEach(p => addToMap('Folha de Pagamento', p.net_salary));

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

      const todayStart = `${todayStr}T00:00:00-03:00`;
      const todayEnd = `${todayStr}T23:59:59.999-03:00`;

      const tomorrowBR = new Date(nowBR.getTime() + 24 * 60 * 60 * 1000);
      const tY = tomorrowBR.getFullYear();
      const tM = String(tomorrowBR.getMonth() + 1).padStart(2, '0');
      const tD = String(tomorrowBR.getDate()).padStart(2, '0');
      const tomorrowStart = `${tY}-${tM}-${tD}T00:00:00-03:00`;

      const startOfMonthStr = `${y}-${m}-01T00:00:00-03:00`;
      const prevMonthDate = new Date(nowBR.getFullYear(), nowBR.getMonth() - 1, 1);
      const pY = prevMonthDate.getFullYear();
      const pM = String(prevMonthDate.getMonth() + 1).padStart(2, '0');
      const prevMonthStartStr = `${pY}-${pM}-01T00:00:00-03:00`;
      const prevMonthEndDate = new Date(nowBR.getFullYear(), nowBR.getMonth(), 0, 23, 59, 59, 999);
      const pEndY = prevMonthEndDate.getFullYear();
      const pEndM = String(prevMonthEndDate.getMonth() + 1).padStart(2, '0');
      const pEndD = String(prevMonthEndDate.getDate()).padStart(2, '0');
      const prevMonthEndStr = `${pEndY}-${pEndM}-${pEndD}T23:59:59.999-03:00`;

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

      // Busca pedidos (orders.total_amount = fonte única de verdade, igual ao dashboard e relatórios)
      const [cashFlow, billsVencendo, payments30d,
             ordersHoje, ordersMes, ordersPrevMes, orders30d, payrollMes,
             manualIncomeHoje, manualIncomeMes, manualIncome30d] = await Promise.all([
        supabase.from('fin_cash_flow').select('type,amount').eq('tenant_id', user.tenantId).gte('date', startOfMonthStr.split('T')[0]),
        supabase.from('fin_accounts_payable').select('*').eq('tenant_id', user.tenantId).in('status', ['pending', 'overdue']).lte('due_date', sevenDaysLaterStr).order('due_date'),
        supabase.from('payments').select('amount, payment_method_id, payment_methods(name)').eq('tenant_id', user.tenantId).gte('created_at', thirtyDaysAgoStr).not('is_refunded', 'eq', true),
        // Pedidos de hoje (entre meia-noite e meia-noite de amanhã, horário BR)
        supabase.from('orders').select('total_amount').eq('tenant_id', user.tenantId)
          .gte('created_at', todayStart).lt('created_at', tomorrowStart)
          .not('status', 'in', '(cancelled,draft)').eq('is_training', false).eq('is_draft', false),
        supabase.from('orders').select('total_amount').eq('tenant_id', user.tenantId)
          .gte('created_at', startOfMonthStr)
          .not('status', 'in', '(cancelled,draft)').eq('is_training', false).eq('is_draft', false),
        supabase.from('orders').select('total_amount').eq('tenant_id', user.tenantId)
          .gte('created_at', prevMonthStartStr).lte('created_at', prevMonthEndStr)
          .not('status', 'in', '(cancelled,draft)').eq('is_training', false).eq('is_draft', false),
        supabase.from('orders').select('total_amount, created_at').eq('tenant_id', user.tenantId)
          .gte('created_at', thirtyDaysAgoStr)
          .not('status', 'in', '(cancelled,draft)').eq('is_training', false).eq('is_draft', false),
        // Folha de pagamento do mês atual (status paid ou pending — já é despesa comprometida)
        supabase.from('hr_payroll').select('net_salary, status')
          .eq('tenant_id', user.tenantId)
          .eq('reference_month', currentMonthStr),
        // Entradas manuais do fluxo de caixa — hoje
        supabase.from('fin_cash_flow').select('amount, payment_method_id, payment_methods(name)')
          .eq('tenant_id', user.tenantId)
          .eq('type', 'income')
          .eq('origin', 'manual')
          .eq('date', todayStr),
        // Entradas manuais do fluxo de caixa — mês atual
        supabase.from('fin_cash_flow').select('amount, payment_method_id, payment_methods(name)')
          .eq('tenant_id', user.tenantId)
          .eq('type', 'income')
          .eq('origin', 'manual')
          .gte('date', startOfMonthStr.split('T')[0]),
        // Entradas manuais do fluxo de caixa — últimos 30 dias
        supabase.from('fin_cash_flow').select('amount, payment_method_id, payment_methods(name), date')
          .eq('tenant_id', user.tenantId)
          .eq('type', 'income')
          .eq('origin', 'manual')
          .gte('date', thirtyDaysAgoStr.split('T')[0]),
      ]);

      // Verificar erros críticos e expor mensagem amigável
      const criticalErrors = [cashFlow, billsVencendo, payments30d, ordersHoje, ordersMes]
        .filter(r => r.error);
      if (criticalErrors.length > 0) {
        const firstErr = criticalErrors[0].error!;
        const translated = translateSupabaseError(firstErr);
        console.error('[useFinanceiro] Erro no dashboard:', firstErr.message, firstErr.code);
        setError(translated.message);
      }
      if (cashFlow.error) console.error('[useFinanceiro] fluxo de caixa:', cashFlow.error.message);
      if (billsVencendo.error) console.error('[useFinanceiro] contas vencendo:', billsVencendo.error.message);
      if (payments30d.error) console.error('[useFinanceiro] pagamentos 30d:', payments30d.error.message);

      // Fonte única de verdade: orders.total_amount + entradas manuais do fluxo de caixa
      const manualHojeTotal = (manualIncomeHoje.data ?? []).reduce((s, m) => s + Number(m.amount), 0);
      const manualMesTotal = (manualIncomeMes.data ?? []).reduce((s, m) => s + Number(m.amount), 0);
      const receitaHoje = (ordersHoje.data ?? []).reduce((s, o) => s + Number(o.total_amount), 0) + manualHojeTotal;
      const receitaMes = (ordersMes.data ?? []).reduce((s, o) => s + Number(o.total_amount), 0) + manualMesTotal;
      const receitaPrevMes = (ordersPrevMes.data ?? []).reduce((s, o) => s + Number(o.total_amount), 0);
      const crescimentoMes = receitaPrevMes > 0 ? ((receitaMes - receitaPrevMes) / receitaPrevMes) * 100 : 0;
      const totalOrdersMes = (ordersMes.data ?? []).length;
      const ticketMedio = totalOrdersMes > 0 ? (receitaMes - manualMesTotal) / totalOrdersMes : 0;

      const entradas = (cashFlow.data ?? []).filter(e => e.type === 'income').reduce((s, e) => s + Number(e.amount), 0);
      const saidas = (cashFlow.data ?? []).filter(e => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0);
      const saldoCaixa = entradas - saidas;

      // Lucro REAL = Receita - Despesas Totais (cash_flow saídas + folha de pagamento)
      // Não usa mais chute de 25% — calcula com dados reais do sistema
      const folhaMes = (payrollMes.data ?? []).reduce((s, p) => s + Number(p.net_salary), 0);
      const despesasTotais = saidas + folhaMes;
      const lucroEstimado = Math.max(0, receitaMes - despesasTotais);

      const totalAPagar = (billsVencendo.data ?? []).reduce((s, b) => s + Number(b.amount), 0);

      // Receita por forma de pagamento (últimos 30 dias) — payments + entradas manuais do fluxo de caixa
      const paymentMap: Record<string, number> = {};
      const colors = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4'];
      (payments30d.data ?? []).forEach((p: Record<string, unknown>) => {
        const name = (p.payment_methods as Record<string, string> | null)?.name ?? 'Outros';
        paymentMap[name] = (paymentMap[name] ?? 0) + Number(p.amount);
      });
      // Entradas manuais do fluxo de caixa por forma de pagamento
      (manualIncome30d.data ?? []).forEach((m: Record<string, unknown>) => {
        const name = (m.payment_methods as Record<string, string> | null)?.name ?? 'Entrada Manual';
        paymentMap[name] = (paymentMap[name] ?? 0) + Number(m.amount);
      });
      // Adiciona pedidos sem pagamento registrado como "Pagar na Entrega"
      const totalPago30d = (payments30d.data ?? []).reduce((s, p) => s + Number(p.amount), 0);
      const totalOrders30d = (orders30d.data ?? []).reduce((s, o) => s + Number(o.total_amount), 0);
      const semPagamento30d = Math.max(0, totalOrders30d - totalPago30d);
      if (semPagamento30d > 0) {
        paymentMap['Pagar na Entrega'] = semPagamento30d;
      }
      const receitaPorPagamento = Object.entries(paymentMap).map(([name, value], i) => ({
        name, value, color: colors[i % colors.length],
      }));

      // Receita diária últimos 30 dias — usa orders + entradas manuais do fluxo de caixa
      const dailyMap: Record<string, number> = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(nowBR.getTime() - i * 86400000).toISOString().split('T')[0];
        dailyMap[d] = 0;
      }
      (orders30d.data ?? []).forEach((o: { total_amount: number; created_at: string }) => {
        // Converter para data no fuso de Brasília
        const dBR = new Date(new Date(o.created_at).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const d = `${dBR.getFullYear()}-${String(dBR.getMonth() + 1).padStart(2, '0')}-${String(dBR.getDate()).padStart(2, '0')}`;
        if (d in dailyMap) dailyMap[d] += Number(o.total_amount);
      });
      // Adicionar entradas manuais do fluxo de caixa no dailyMap
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
        totalAReceber: 0,
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
