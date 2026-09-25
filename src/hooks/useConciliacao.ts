import { useState, useEffect, useCallback, useRef } from 'react';
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
  /** 'label' = só etiqueta a linha do extrato; 'launch' = regra de lançamento (2026-09-18) */
  action?: 'label' | 'launch';
  counterpart_doc?: string | null;
  counterpart_label?: string | null;
  launch_kind?: 'despesa' | 'compra' | null;
  dre_category_id?: string | null;
  merchandise_category_id?: string | null;
  competence_rule?: 'same' | 'prev';
  /** 'auto' = lança sozinho quando não há dúvida (cron diário); 'suggest' = espera confirmação */
  mode?: 'suggest' | 'auto';
  supplier_name?: string | null;
  last_applied_at?: string | null;
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
  source?: string | null;
  /** stone_deposit | stone_detail | internal_transfer (fn_match_stone_inter) */
  match_kind?: string | null;
  /** ex.: stone:2026-09-08:antecipado — liga as vendas da Stone ao depósito no Inter */
  match_group?: string | null;
  /** CPF/CNPJ da contraparte (Pix/TED) — no boleto do Inter vem vazio */
  counterpart_doc?: string | null;
  counterpart_name?: string | null;
  /** Boleto: valor de face e vencimento (do código de barras / extrato) */
  face_value?: number | null;
  due_date?: string | null;
  /** Vínculo sugerido pela fn_match_payments (payable | inbound_doc) */
  match_ref_id?: string | null;
  match_confidence?: 'exato' | 'forte' | 'provavel' | null;
  match_detail?: Record<string, unknown> | null;
  /** Pagamento baixado numa conta a pagar: a classificação vem da conta (anexada por list_statement_imports) */
  classificacao?: { bill_id: string; tipo: 'compra' | 'despesa'; categoria: string | null; centro_custo: string | null } | null;
  reconciled: boolean;
  reconciled_at?: string;
  created_at: string;
  /** Registro original do provedor (Inter: dataInclusao traz a hora, em horário de Brasília) */
  raw?: Record<string, unknown> | null;
}

/**
 * Hora da transação ("18:28", Brasília). Padrão de todas as origens: raw.hora (Stone, Mercado Pago, arquivo
 * OFX/CSV); o Inter usa raw.dataInclusao. Quando a hora é de outro dia (repasse da Stone mostra a hora da
 * VENDA), vem com o dia: "18:22 · venda 09/09".
 */
export function horaTransacao(s: Pick<StatementImport, 'raw'> & { transaction_date?: string }): string | null {
  const raw = s.raw ?? {};
  const hora = /^\d{2}:\d{2}$/.test(String(raw.hora ?? '')) ? String(raw.hora) : null;
  if (hora) {
    const dia = String(raw.hora_data ?? '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(dia) && dia !== s.transaction_date) {
      return `${hora} · ${raw.hora_ref ? `${raw.hora_ref} ` : ''}${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
    }
    return hora;
  }
  const m = /[ T](\d{2}):(\d{2})/.exec(String(raw.dataInclusao ?? ''));
  return m ? `${m[1]}:${m[2]}` : null;
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

// period: filtra as linhas pela data da transação. Sem período o servidor devolve só as
// últimas 500 linhas da conta — os totais viram uma janela arbitrária.
export function useConciliacao(bankAccountId?: string, period?: { from?: string; to?: string }) {
  const periodFrom = period?.from || undefined;
  const periodTo = period?.to || undefined;
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
          payload: { bank_account_id: bankAccountId, date_from: periodFrom, date_to: periodTo },
        },
      });
      if (error) console.error('[useConciliacao] Erro:', error.message);
      setImports(data?.data ?? []);
    } catch (err) {
      console.error('[useConciliacao] Erro fetchImports:', err);
    }
    setLoading(false);
  }, [user?.tenantId, bankAccountId, periodFrom, periodTo]);

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

  const reabrindo = useRef(new Set<string>());
  // Unreconcile. Linha com baixa feita pela conciliação (conta paga, compra, freela, folha, fora do DRE):
  // só voltar o status deixava a conta paga e a linha "pendente" (convite a lançar de novo) — desfaz
  // de verdade pela edge (undo), que estorna o que foi criado e limpa o vínculo (2026-09-25).
  const unreconcile = async (id: string) => {
    const row = imports.find(i => i.id === id);
    const c = (row?.match_detail as Record<string, unknown> | null | undefined)?.confirmed as Record<string, unknown> | undefined;
    if (c && (c.bill_id || c.payroll_id || c.created === 'fora_dre')) {
      // clique duplo enquanto o undo roda: o 2º dava "Não há baixa feita pela conciliação"
      if (reabrindo.current.has(id)) return false;
      const oque = c.created === 'fora_dre' ? 'A marcação "fora do DRE" sai'
        : c.payroll_id ? 'A folha volta a pendente'
        : c.created === 'freelancer' ? 'O pagamento de freelancer (conta e diárias) é apagado'
        : c.created === 'despesa' || c.created === 'compra' ? `A ${c.created} criada a partir deste pagamento é apagada`
        : 'A baixa da conta é desfeita (a conta volta a em aberto)';
      if (!window.confirm(`Reabrir? ${oque} e o pagamento volta a pendente.`)) return false;
      reabrindo.current.add(id);
      const r = await invokeWithAuth<{ success?: boolean; error?: string; results?: Array<{ ok: boolean; msg: string }> }>('conciliacao-pagamentos', {
        body: { action: 'undo', tenant_id: user?.tenantId, id },
      }).finally(() => reabrindo.current.delete(id));
      const res = r.data?.results?.[0];
      const err = r.data?.error ?? r.error?.message ?? (res && !res.ok ? res.msg : null);
      if (err) { window.alert('Não foi possível reabrir: ' + err); return false; }
      await fetchImports();
      return true;
    }
    return updateImport(id, {
      reconciled: false,
      reconciled_at: null,
      status: 'pending',
    });
  };

  // Find bill matches
  // "Alta" só com valor exato E nome batendo (2026-09-18: a Claro de R$ 114,41 aparecia com a Toko Frios
  // de R$ 115,96 como "Alta" — só pelo valor parecido). Valor exato sem nome = Média; valor próximo
  // (até 2%) só entra se o nome bater; nome diferente e valor diferente não é sugestão.
  const findBillMatches = useCallback(async (amount: number, date: string, nome = '', daysTolerance = 7): Promise<BillMatch[]> => {
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

    const GENERICAS = new Set(['ltda', 'eireli', 'pagamento', 'compra', 'recebido', 'enviado', 'boleto', 'fatura', 'conta', 'comercio', 'servicos', 'alimentos', 'brasil', 'distribuidora']);
    const palavras = (t: string | null | undefined) => new Set(String(t ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
      .split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERICAS.has(w) && !/^\d+$/.test(w)));
    const doExtrato = palavras(nome);
    const nomeBate = (b: { description: string | null; supplier: string | null }) => {
      for (const w of palavras(`${b.supplier ?? ''} ${b.description ?? ''}`)) if (doExtrato.has(w)) return true;
      return false;
    };

    const candidates: BillMatch[] = [];
    (data ?? []).forEach(b => {
      const valor = Number(b.amount);
      const exato = Math.abs(valor - amount) < 0.01;
      const perto = valor > 0 && Math.abs(valor - amount) / valor <= 0.02;
      const bate = nomeBate(b);
      if (exato && bate) candidates.push({ ...b, confidence: 'high' as const, amount: valor });
      else if (exato || (perto && bate)) candidates.push({ ...b, confidence: 'medium' as const, amount: valor });
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