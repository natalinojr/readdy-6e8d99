import { useState, useEffect, useCallback } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { CostCenter } from '@/types/financeiro';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReconciliationRule {
  id: string;
  tenant_id: string;
  bank_account_id?: string;
  pattern: string;
  match_type: 'contains' | 'starts_with' | 'ends_with' | 'exact' | 'regex';
  category?: string;
  cost_center_id?: string;
  transaction_type: 'credit' | 'debit' | 'both';
  description_template?: string;
  is_active: boolean;
  match_count: number;
  created_at: string;
}

export interface StatementImport {
  id: string;
  tenant_id: string;
  bank_account_id: string;
  external_id?: string;
  transaction_date: string;
  amount: number;
  description: string;
  transaction_type: 'credit' | 'debit';
  status: 'pending' | 'matched' | 'ignored' | 'manual';
  matched_transaction_id?: string;
  category?: string;
  cost_center_id?: string;
  notes?: string;
  reconciled: boolean;
  reconciled_at?: string;
  created_at: string;
}

export interface BillMatch {
  id: string;
  description: string;
  amount: number;
  due_date: string;
  status: string;
  supplier?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ReceivableMatch {
  id: string;
  order_number?: string;
  amount: number;
  due_date?: string;
  status: string;
  confidence: 'high' | 'medium' | 'low';
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useConciliacao(bankAccountId?: string) {
  const { user } = useAuth();
  const [imports, setImports] = useState<StatementImport[]>([]);
  const [rules, setRules] = useState<ReconciliationRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);

  // Fetch imports via Edge Function (bypasses RLS)
  const fetchImports = useCallback(async () => {
    if (!user?.tenantId || !bankAccountId) return;
    setLoading(true);
    try {
      const { data, error } = await invokeWithAuth<{ data: StatementImport[] }>('financial-write', {
        body: {
          action: 'list_statement_imports',
          tenant_id: user.tenantId,
          payload: { bank_account_id: bankAccountId },
        },
      });
      if (error) console.error('[useConciliacao] Erro:', error.message);
      setImports(data?.data ?? []);
    } catch (err) {
      console.error('[useConciliacao] Erro fetchImports:', err);
    }
    setLoading(false);
  }, [user?.tenantId, bankAccountId]);

  // Fetch rules via Edge Function (bypasses RLS permission issue)
  const fetchRules = useCallback(async () => {
    if (!user?.tenantId) return;
    setRulesLoading(true);
    try {
      const { data, error } = await invokeWithAuth<{ data: ReconciliationRule[] }>('financial-write', {
        body: { action: 'list_reconciliation_rules', tenant_id: user.tenantId, payload: {} },
      });
      if (error) console.error('[useConciliacao] Erro rules:', error.message);
      setRules(data?.data ?? []);
    } catch (err) {
      console.error('[useConciliacao] Erro rules:', err);
    }
    setRulesLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchImports(); }, [fetchImports]);
  useEffect(() => { fetchRules(); }, [fetchRules]);

  // Apply rules to a description
  const applyRules = useCallback((description: string, txType: 'credit' | 'debit') => {
    for (const rule of rules) {
      if (rule.transaction_type !== 'both' && rule.transaction_type !== txType) continue;
      const desc = description.toLowerCase();
      const pattern = rule.pattern.toLowerCase();
      let matches = false;
      switch (rule.match_type) {
        case 'contains': matches = desc.includes(pattern); break;
        case 'starts_with': matches = desc.startsWith(pattern); break;
        case 'ends_with': matches = desc.endsWith(pattern); break;
        case 'exact': matches = desc === pattern; break;
        case 'regex':
          try { matches = new RegExp(pattern, 'i').test(description); } catch { matches = false; }
          break;
      }
      if (matches) return rule;
    }
    return null;
  }, [rules]);

  // Update import via Edge Function (bypasses RLS)
  const updateImport = async (id: string, updates: Partial<StatementImport>) => {
    try {
      const { data, error } = await invokeWithAuth<{ data: unknown; error?: string }>('financial-write', {
        body: {
          action: 'update_statement_import',
          tenant_id: user?.tenantId,
          payload: { id, ...updates },
        },
      });
      if (error || (data as Record<string, unknown>)?.error) {
        console.error('[useConciliacao] Erro ao atualizar:', error?.message ?? (data as Record<string, unknown>)?.error);
        return false;
      }
      setImports(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
      return true;
    } catch (err) {
      console.error('[useConciliacao] Erro updateImport:', err);
      return false;
    }
  };

  // Reconcile
  const reconcile = async (id: string) => {
    if (!user?.id) return false;
    return updateImport(id, {
      reconciled: true,
      reconciled_at: new Date().toISOString(),
      status: 'matched',
    });
  };

  // Unreconcile
  const unreconcile = async (id: string) => {
    return updateImport(id, {
      reconciled: false,
      reconciled_at: null,
      status: 'pending',
    });
  };

  // Find bill matches
  const findBillMatches = useCallback(async (amount: number, date: string, daysTolerance = 7): Promise<BillMatch[]> => {
    if (!user?.tenantId) return [];
    const fromDate = new Date(date);
    fromDate.setDate(fromDate.getDate() - daysTolerance);
    const toDate = new Date(date);
    toDate.setDate(toDate.getDate() + daysTolerance);

    const { data } = await supabase
      .from('fin_accounts_payable')
      .select('id, description, amount, due_date, status, supplier')
      .eq('tenant_id', user.tenantId)
      .in('status', ['pending', 'overdue', 'partial'])
      .gte('due_date', fromDate.toISOString().split('T')[0])
      .lte('due_date', toDate.toISOString().split('T')[0]);

    const candidates: BillMatch[] = [];
    (data ?? []).forEach(b => {
      const diff = Math.abs(Number(b.amount) - amount);
      const pctDiff = Number(b.amount) > 0 ? diff / Number(b.amount) : 1;
      if (pctDiff <= 0.02) {
        candidates.push({ ...b, confidence: 'high' as const, amount: Number(b.amount) });
      } else if (pctDiff <= 0.1) {
        candidates.push({ ...b, confidence: 'medium' as const, amount: Number(b.amount) });
      }
    });
    return candidates.sort((a, b) => (a.confidence === 'high' ? 0 : 1) - (b.confidence === 'high' ? 0 : 1));
  }, [user?.tenantId]);

  // Find receivable matches
  const findReceivableMatches = useCallback(async (amount: number, date: string, daysTolerance = 7): Promise<ReceivableMatch[]> => {
    if (!user?.tenantId) return [];
    const fromDate = new Date(date);
    fromDate.setDate(fromDate.getDate() - daysTolerance);
    const toDate = new Date(date);
    toDate.setDate(toDate.getDate() + daysTolerance);

    const { data } = await supabase
      .from('fin_receivable_installments')
      .select('id, order_number, amount, due_date, status')
      .eq('tenant_id', user.tenantId)
      .in('status', ['pending', 'partial'])
      .gte('due_date', fromDate.toISOString().split('T')[0])
      .lte('due_date', toDate.toISOString().split('T')[0]);

    const candidates: ReceivableMatch[] = [];
    (data ?? []).forEach(r => {
      const diff = Math.abs(Number(r.amount) - amount);
      const pctDiff = Number(r.amount) > 0 ? diff / Number(r.amount) : 1;
      if (pctDiff <= 0.02) {
        candidates.push({ ...r, confidence: 'high' as const, amount: Number(r.amount) });
      } else if (pctDiff <= 0.1) {
        candidates.push({ ...r, confidence: 'medium' as const, amount: Number(r.amount) });
      }
    });
    return candidates.sort((a, b) => (a.confidence === 'high' ? 0 : 1) - (b.confidence === 'high' ? 0 : 1));
  }, [user?.tenantId]);

  // Rule CRUD via Edge Function
  const createRule = async (rulePayload: Omit<ReconciliationRule, 'id' | 'tenant_id' | 'match_count' | 'created_at'>) => {
    if (!user?.tenantId) return null;
    const { data, error } = await invokeWithAuth<{ data: ReconciliationRule }>('financial-write', {
      body: { action: 'upsert_reconciliation_rule', tenant_id: user.tenantId, payload: rulePayload },
    });
    if (error) {
      console.error('[useConciliacao] Erro ao criar regra:', error.message);
      return null;
    }
    const created = data?.data;
    if (created) setRules(prev => [created, ...prev]);
    return created ?? null;
  };

  const updateRule = async (id: string, updates: Partial<ReconciliationRule>) => {
    const { error } = await invokeWithAuth('financial-write', {
      body: { action: 'upsert_reconciliation_rule', tenant_id: user?.tenantId, payload: { id, ...updates } },
    });
    if (error) return false;
    setRules(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
    return true;
  };

  const deleteRule = async (id: string) => {
    const { error } = await invokeWithAuth('financial-write', {
      body: { action: 'delete_reconciliation_rule', tenant_id: user?.tenantId, payload: { id } },
    });
    if (error) return false;
    setRules(prev => prev.filter(r => r.id !== id));
    return true;
  };

  // Increment rule match count
  const incrementRuleCount = async (ruleId: string) => {
    await invokeWithAuth('financial-write', {
      body: { action: 'increment_reconciliation_rule_count', tenant_id: user?.tenantId, payload: { rule_id: ruleId } },
    });
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, match_count: r.match_count + 1 } : r));
  };

  // KPIs
  const totalMatched = imports.filter(i => i.status === 'matched').length;
  const totalPending = imports.filter(i => i.status === 'pending').length;
  const totalReconciled = imports.filter(i => i.reconciled).length;
  const totalIgnored = imports.filter(i => i.status === 'ignored').length;
  const saldoCreditos = imports.filter(i => i.transaction_type === 'credit').reduce((s, i) => s + Number(i.amount), 0);
  const saldoDebitos = imports.filter(i => i.transaction_type === 'debit').reduce((s, i) => s + Number(i.amount), 0);
  const saldoLiquido = saldoCreditos - saldoDebitos;
  const pctConciliado = imports.length > 0 ? Math.round((totalReconciled / imports.length) * 100) : 0;

  return {
    imports,
    rules,
    loading,
    rulesLoading,
    refresh: fetchImports,
    refreshRules: fetchRules,
    updateImport,
    reconcile,
    unreconcile,
    findBillMatches,
    findReceivableMatches,
    applyRules,
    createRule,
    updateRule,
    deleteRule,
    incrementRuleCount,
    // KPIs
    totalMatched,
    totalPending,
    totalReconciled,
    totalIgnored,
    saldoCreditos,
    saldoDebitos,
    saldoLiquido,
    pctConciliado,
  };
}