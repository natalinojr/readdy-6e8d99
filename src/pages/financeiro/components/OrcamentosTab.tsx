import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { useCostCenters, useBankAccounts } from '@/hooks/useFinanceiro';
import { useSuppliers } from '@/hooks/useSuppliers';
import { SUPABASE_URL } from '@/lib/supabase';

interface BudgetItem {
  id?: string;
  descricao: string;
  quantidade: number;
  unidade: string;
  valor_unitario: number;
  valor_total?: number;
}

interface Budget {
  id: string;
  titulo: string;
  descricao?: string;
  fornecedor?: string;
  status: 'rascunho' | 'aprovado' | 'rejeitado' | 'convertido';
  valor_total: number;
  validade?: string;
  observacoes?: string;
  created_at: string;
  converted_to_purchase_id?: string;
  converted_at?: string;
  items?: BudgetItem[];
}

interface Purchase {
  id: string;
  supplier: string;
  total_amount: number;
  payment_status: string;
  purchase_date: string;
}

const STATUS_CONFIG: Record<Budget['status'], { label: string; color: string; icon: string }> = {
  rascunho:   { label: 'Rascunho',   color: 'bg-zinc-100 text-zinc-600',    icon: 'ri-draft-line' },
  aprovado:   { label: 'Aprovado',   color: 'bg-green-100 text-green-700',  icon: 'ri-checkbox-circle-line' },
  rejeitado:  { label: 'Rejeitado',  color: 'bg-red-100 text-red-700',      icon: 'ri-close-circle-line' },
  convertido: { label: 'Convertido', color: 'bg-amber-100 text-amber-700',  icon: 'ri-exchange-line' },
};

const PAYMENT_METHODS = [
  { value: 'pix', label: 'PIX' },
  { value: 'transferencia', label: 'Transferência Bancária' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'cartao_debito', label: 'Cartão de Débito' },
  { value: 'cartao_credito', label: 'Cartão de Crédito' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'outros', label: 'Outros' },
];

const EMPTY_ITEM: BudgetItem = { descricao: '', quantidade: 1, unidade: 'un', valor_unitario: 0 };

function isExpired(validade?: string) {
  if (!validade) return false;
  return new Date(validade + 'T23:59:59') < new Date();
}

function daysUntil(validade?: string) {
  if (!validade) return null;
  const diff = new Date(validade + 'T23:59:59').getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

// ── Comparativo Orçado vs Realizado ──────────────────────────────────────────
interface ComparativoItem {
  budget: Budget;
  purchase: Purchase | null;
  diff: number;
  diffPct: number;
}

function ComparativoOrcadoRealizado({ budgets }: { budgets: Budget[] }) {
  const { user } = useAuth();
  const [comparativos, setComparativos] = useState<ComparativoItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const converted = budgets.filter(b => b.status === 'convertido' && b.converted_to_purchase_id);
    if (!converted.length || !user?.tenantId) {
      setComparativos([]);
      return;
    }

    const load = async () => {
      setLoading(true);
      const purchaseIds = converted.map(b => b.converted_to_purchase_id!);
      const { data: purchases } = await supabase
        .from('fin_purchases')
        .select('id, supplier, total_amount, payment_status, purchase_date')
        .in('id', purchaseIds)
        .eq('tenant_id', user.tenantId);

      const purchaseMap = new Map((purchases ?? []).map(p => [p.id, p]));

      const items: ComparativoItem[] = converted.map(b => {
        const purchase = purchaseMap.get(b.converted_to_purchase_id!) ?? null;
        const realAmount = purchase ? Number(purchase.total_amount) : 0;
        const budgetAmount = Number(b.valor_total);
        const diff = realAmount - budgetAmount;
        const diffPct = budgetAmount > 0 ? (diff / budgetAmount) * 100 : 0;
        return { budget: b, purchase, diff, diffPct };
      });

      setComparativos(items);
      setLoading(false);
    };

    load();
  }, [budgets, user?.tenantId]);

  if (comparativos.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100 bg-zinc-50">
        <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-100">
          <i className="ri-scales-line text-amber-600 text-sm" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-zinc-800">Orçado vs Realizado</h3>
          <p className="text-xs text-zinc-400">Comparativo de orçamentos convertidos em compras</p>
        </div>
      </div>

      {loading ? (
        <div className="p-5 space-y-3">
          {[1, 2].map(i => <div key={i} className="h-14 bg-zinc-50 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="divide-y divide-zinc-50">
          {comparativos.map(({ budget, purchase, diff, diffPct }) => {
            const isOver = diff > 0;
            const isUnder = diff < 0;
            const isExact = diff === 0;
            const absDiff = Math.abs(diff);
            const absPct = Math.abs(diffPct);

            return (
              <div key={budget.id} className="px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-zinc-800 truncate">{budget.titulo}</p>
                    {budget.fornecedor && (
                      <span className="text-xs text-zinc-400 truncate">· {budget.fornecedor}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-zinc-500">
                    <span>
                      Convertido em {budget.converted_at
                        ? new Date(budget.converted_at).toLocaleDateString('pt-BR')
                        : '—'}
                    </span>
                    {purchase && (
                      <span className={`font-medium ${
                        purchase.payment_status === 'paid' ? 'text-green-600' :
                        purchase.payment_status === 'partial' ? 'text-amber-600' : 'text-zinc-500'
                      }`}>
                        {purchase.payment_status === 'paid' ? 'Pago' :
                         purchase.payment_status === 'partial' ? 'Parcialmente pago' : 'Pendente'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Valores */}
                <div className="flex items-center gap-6 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-xs text-zinc-400 mb-0.5">Orçado</p>
                    <p className="text-sm font-bold text-zinc-700">{formatCurrency(budget.valor_total)}</p>
                  </div>
                  <div className="text-zinc-300">
                    <i className="ri-arrow-right-line" />
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-zinc-400 mb-0.5">Realizado</p>
                    <p className="text-sm font-bold text-zinc-800">
                      {purchase ? formatCurrency(purchase.total_amount) : '—'}
                    </p>
                  </div>
                  <div className={`min-w-[90px] text-right px-3 py-1.5 rounded-lg ${
                    isExact ? 'bg-green-50' :
                    isOver ? (absPct > 10 ? 'bg-red-50' : 'bg-amber-50') :
                    'bg-green-50'
                  }`}>
                    {purchase ? (
                      <>
                        <p className={`text-xs font-bold ${
                          isExact ? 'text-green-600' :
                          isOver ? (absPct > 10 ? 'text-red-600' : 'text-amber-600') :
                          'text-green-600'
                        }`}>
                          {isExact ? '=' : isOver ? '+' : '-'}{formatCurrency(absDiff)}
                        </p>
                        <p className={`text-xs ${
                          isExact ? 'text-green-500' :
                          isOver ? (absPct > 10 ? 'text-red-500' : 'text-amber-500') :
                          'text-green-500'
                        }`}>
                          {isExact ? 'Exato' : `${isOver ? '+' : '-'}${absPct.toFixed(1)}%`}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-zinc-400">Sem compra</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Resumo */}
      {comparativos.length > 0 && (
        <div className="px-5 py-3 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between">
          <span className="text-xs text-zinc-500">{comparativos.length} orçamento{comparativos.length !== 1 ? 's' : ''} convertido{comparativos.length !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-zinc-500">
              Total orçado: <span className="font-bold text-zinc-700">{formatCurrency(comparativos.reduce((s, c) => s + Number(c.budget.valor_total), 0))}</span>
            </span>
            <span className="text-zinc-500">
              Total realizado: <span className="font-bold text-zinc-700">{formatCurrency(comparativos.filter(c => c.purchase).reduce((s, c) => s + Number(c.purchase!.total_amount), 0))}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Modal Converter em Compra ─────────────────────────────────────────────────
interface ConvertModalProps {
  budget: Budget;
  bankAccounts: ReturnType<typeof useBankAccounts>['accounts'];
  centers: ReturnType<typeof useCostCenters>['centers'];
  onClose: () => void;
  onSuccess: (purchaseId: string) => void;
}

function ConvertToPurchaseModal({ budget, bankAccounts, centers, onClose, onSuccess }: ConvertModalProps) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    payment_method: 'pix',
    payment_status: 'pending' as 'pending' | 'paid',
    due_date: budget.validade || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    bank_account_id: '',
    cost_center_id: '',
  });
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConvert = async () => {
    if (!user?.tenantId) return;
    setConverting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/financial-write`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          action: 'convert_budget_to_purchase',
          tenant_id: user.tenantId,
          payload: {
            budget_id: budget.id,
            payment_method: form.payment_method,
            payment_status: form.payment_status,
            due_date: form.due_date,
            bank_account_id: form.bank_account_id || null,
            cost_center_id: form.cost_center_id || null,
          },
        }),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error || 'Erro ao converter orçamento');
        setConverting(false);
        return;
      }

      onSuccess(json.data?.purchase_id);
    } catch (e) {
      setError('Erro de conexão. Tente novamente.');
      setConverting(false);
    }
  };

  const items = budget.items ?? [];
  const totalItems = items.reduce((s, i) => s + i.quantidade * i.valor_unitario, 0);
  const displayTotal = totalItems > 0 ? totalItems : Number(budget.valor_total);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-bold text-zinc-900">Converter em Compra</h3>
            <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-[300px]">{budget.titulo}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Resumo do orçamento */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg">
                  <i className="ri-file-list-3-line text-amber-600 text-sm" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-amber-800">Orçamento aprovado</p>
                  {budget.fornecedor && <p className="text-xs text-amber-600">{budget.fornecedor}</p>}
                </div>
              </div>
              <p className="text-xl font-bold text-amber-800">{formatCurrency(displayTotal)}</p>
            </div>

            {/* Itens do orçamento */}
            {items.length > 0 && (
              <div className="space-y-1.5 mt-3 pt-3 border-t border-amber-200">
                <p className="text-xs font-semibold text-amber-700 mb-2">{items.length} item{items.length !== 1 ? 's' : ''} incluído{items.length !== 1 ? 's' : ''}:</p>
                {items.slice(0, 4).map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className="text-amber-700 truncate max-w-[220px]">{item.descricao}</span>
                    <span className="text-amber-800 font-medium whitespace-nowrap ml-2">
                      {item.quantidade} {item.unidade} × {formatCurrency(item.valor_unitario)}
                    </span>
                  </div>
                ))}
                {items.length > 4 && (
                  <p className="text-xs text-amber-500">+{items.length - 4} item{items.length - 4 !== 1 ? 's' : ''} adicional{items.length - 4 !== 1 ? 'is' : ''}</p>
                )}
              </div>
            )}
          </div>

          {/* Forma de pagamento */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Forma de Pagamento *</label>
            <select
              value={form.payment_method}
              onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              {PAYMENT_METHODS.map(pm => (
                <option key={pm.value} value={pm.value}>{pm.label}</option>
              ))}
            </select>
          </div>

          {/* Status de pagamento */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Status do Pagamento</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'pending', label: 'A prazo', desc: 'Gera conta a pagar', icon: 'ri-time-line', color: 'border-zinc-200 text-zinc-700' },
                { value: 'paid', label: 'À vista', desc: 'Pago imediatamente', icon: 'ri-checkbox-circle-line', color: 'border-green-200 text-green-700' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setForm(f => ({ ...f, payment_status: opt.value as 'pending' | 'paid' }))}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all text-left ${
                    form.payment_status === opt.value
                      ? opt.value === 'paid' ? 'border-green-400 bg-green-50' : 'border-amber-400 bg-amber-50'
                      : 'border-zinc-200 hover:border-zinc-300'
                  }`}
                >
                  <div className={`w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 ${
                    form.payment_status === opt.value
                      ? opt.value === 'paid' ? 'bg-green-100' : 'bg-amber-100'
                      : 'bg-zinc-100'
                  }`}>
                    <i className={`${opt.icon} text-sm ${
                      form.payment_status === opt.value
                        ? opt.value === 'paid' ? 'text-green-600' : 'text-amber-600'
                        : 'text-zinc-400'
                    }`} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-zinc-800">{opt.label}</p>
                    <p className="text-xs text-zinc-400">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Data de vencimento (só se a prazo) */}
          {form.payment_status === 'pending' && (
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Data de Vencimento *</label>
              <input
                type="date"
                value={form.due_date}
                onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          )}

          {/* Conta bancária */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
              {form.payment_status === 'paid' ? 'Débitar da Conta Bancária' : 'Conta Bancária (opcional)'}
            </label>
            <select
              value={form.bank_account_id}
              onChange={e => setForm(f => ({ ...f, bank_account_id: e.target.value }))}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="">Não especificado</option>
              {bankAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.name} — {formatCurrency(a.current_balance)}</option>
              ))}
            </select>
          </div>

          {/* Centro de custo */}
          {centers.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Centro de Custo</label>
              <select
                value={form.cost_center_id}
                onChange={e => setForm(f => ({ ...f, cost_center_id: e.target.value }))}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="">Nenhum</option>
                {centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {/* Info */}
          <div className="bg-zinc-50 rounded-xl p-3 flex items-start gap-2">
            <i className="ri-information-line text-zinc-400 text-sm mt-0.5 flex-shrink-0" />
            <p className="text-xs text-zinc-500">
              {form.payment_status === 'pending'
                ? 'Uma compra e uma conta a pagar serão criadas automaticamente. O orçamento ficará marcado como "Convertido".'
                : 'Uma compra será criada e o valor debitado imediatamente no fluxo de caixa. O orçamento ficará marcado como "Convertido".'}
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <i className="ri-error-warning-line text-red-500 flex-shrink-0" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-zinc-100">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
          >
            Cancelar
          </button>
          <button
            onClick={handleConvert}
            disabled={converting || (form.payment_status === 'pending' && !form.due_date)}
            className="flex-1 py-2.5 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
          >
            {converting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Convertendo...
              </>
            ) : (
              <>
                <i className="ri-shopping-cart-line" />
                Converter em Compra
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function OrcamentosTab() {
  const { user } = useAuth();
  const { centers } = useCostCenters();
  const { accounts: bankAccounts } = useBankAccounts();
  const { names: supplierNames } = useSuppliers();

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<Budget | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [budgetToConvert, setBudgetToConvert] = useState<Budget | null>(null);
  const [showComparativo, setShowComparativo] = useState(false);

  const [form, setForm] = useState({
    titulo: '', descricao: '', fornecedor: '', validade: '', observacoes: '',
    items: [{ ...EMPTY_ITEM }] as BudgetItem[],
  });

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchBudgets = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const { data } = await supabase
      .from('fin_budgets')
      .select('*')
      .eq('tenant_id', user.tenantId)
      .order('created_at', { ascending: false });
    setBudgets(data || []);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchBudgets(); }, [fetchBudgets]);

  const totalItems = (items: BudgetItem[]) =>
    items.reduce((s, i) => s + i.quantidade * i.valor_unitario, 0);

  const handleAddItem = () => setForm(f => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }));
  const handleRemoveItem = (idx: number) =>
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  const handleItemChange = (idx: number, field: keyof BudgetItem, value: string | number) =>
    setForm(f => ({
      ...f,
      items: f.items.map((item, i) => i === idx ? { ...item, [field]: value } : item),
    }));

  const resetForm = () => {
    setForm({ titulo: '', descricao: '', fornecedor: '', validade: '', observacoes: '', items: [{ ...EMPTY_ITEM }] });
    setShowModal(false);
  };

  const handleSave = async () => {
    if (!form.titulo.trim() || !user?.tenantId) return;
    setSaving(true);
    const valor_total = totalItems(form.items);
    const { data: budget, error } = await supabase
      .from('fin_budgets')
      .insert({
        tenant_id: user.tenantId,
        titulo: form.titulo,
        descricao: form.descricao || null,
        fornecedor: form.fornecedor || null,
        validade: form.validade || null,
        observacoes: form.observacoes || null,
        valor_total,
        created_by: user.id,
      })
      .select()
      .maybeSingle();

    if (!error && budget) {
      const itemsToInsert = form.items
        .filter(i => i.descricao.trim())
        .map(i => ({
          budget_id: budget.id,
          descricao: i.descricao,
          quantidade: i.quantidade,
          unidade: i.unidade,
          valor_unitario: i.valor_unitario,
          valor_total: i.quantidade * i.valor_unitario,
        }));
      if (itemsToInsert.length > 0) {
        await supabase.from('fin_budget_items').insert(itemsToInsert);
      }
      showToast('Orçamento criado com sucesso!');
      resetForm();
      fetchBudgets();
    } else {
      showToast('Erro ao salvar orçamento', 'error');
    }
    setSaving(false);
  };

  const handleUpdateStatus = async (id: string, status: Budget['status']) => {
    const { error } = await supabase
      .from('fin_budgets')
      .update({ status, aprovado_por: user?.id, aprovado_em: new Date().toISOString() })
      .eq('id', id);
    if (!error) {
      const labels: Record<string, string> = { aprovado: 'Orçamento aprovado!', rejeitado: 'Orçamento rejeitado.' };
      showToast(labels[status] ?? 'Status atualizado.');
      fetchBudgets();
      setSelectedBudget(prev => prev?.id === id ? { ...prev, status } : prev);
    }
  };

  const openConvertModal = async (budget: Budget) => {
    // Buscar itens antes de abrir o modal
    const { data: items } = await supabase
      .from('fin_budget_items')
      .select('*')
      .eq('budget_id', budget.id)
      .order('created_at');
    setBudgetToConvert({ ...budget, items: items || [] });
    setShowConvertModal(true);
  };

  const handleConvertSuccess = (purchaseId: string) => {
    setShowConvertModal(false);
    setBudgetToConvert(null);
    showToast('Orçamento convertido em compra com sucesso!');
    fetchBudgets();
    setSelectedBudget(null);
    // Mostrar comparativo automaticamente
    setShowComparativo(true);
  };

  const openDetail = async (budget: Budget) => {
    const { data: items } = await supabase
      .from('fin_budget_items')
      .select('*')
      .eq('budget_id', budget.id)
      .order('created_at');
    setSelectedBudget({ ...budget, items: items || [] });
  };

  const handleDuplicate = async (budget: Budget) => {
    if (!user?.tenantId) return;
    const { data: items } = await supabase
      .from('fin_budget_items')
      .select('*')
      .eq('budget_id', budget.id)
      .order('created_at');

    const { data: newBudget, error } = await supabase
      .from('fin_budgets')
      .insert({
        tenant_id: user.tenantId,
        titulo: `${budget.titulo} (cópia)`,
        descricao: budget.descricao || null,
        fornecedor: budget.fornecedor || null,
        validade: null,
        observacoes: budget.observacoes || null,
        valor_total: budget.valor_total,
        status: 'rascunho',
        created_by: user.id,
      })
      .select()
      .maybeSingle();

    if (!error && newBudget && items && items.length > 0) {
      await supabase.from('fin_budget_items').insert(
        items.map((i: BudgetItem & { id?: string; budget_id?: string }) => ({
          budget_id: newBudget.id,
          descricao: i.descricao,
          quantidade: i.quantidade,
          unidade: i.unidade,
          valor_unitario: i.valor_unitario,
          valor_total: i.valor_total,
        }))
      );
    }
    showToast('Orçamento duplicado com sucesso!');
    fetchBudgets();
  };

  const handlePrint = (budget: Budget) => {
    const items = budget.items ?? [];
    const total = items.reduce((s, i) => s + i.quantidade * i.valor_unitario, 0) || budget.valor_total;
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>Orçamento — ${budget.titulo}</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 13px; color: #111; margin: 0; padding: 32px; }
          h1 { font-size: 20px; margin: 0 0 4px; }
          .sub { color: #666; font-size: 12px; margin-bottom: 24px; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 24px; }
          .info-item label { font-size: 10px; text-transform: uppercase; color: #888; display: block; }
          .info-item span { font-weight: 600; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
          th { background: #f4f4f5; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; color: #666; }
          td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }
          .total-row td { font-weight: 700; font-size: 14px; border-top: 2px solid #e4e4e7; border-bottom: none; }
          .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
          .badge-rascunho { background: #f4f4f5; color: #555; }
          .badge-aprovado { background: #dcfce7; color: #166534; }
          .badge-rejeitado { background: #fee2e2; color: #991b1b; }
          .badge-convertido { background: #fef3c7; color: #92400e; }
          .obs { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; margin-top: 16px; font-size: 12px; }
          .footer { margin-top: 32px; font-size: 11px; color: #aaa; text-align: center; }
          @media print { body { padding: 16px; } }
        </style>
      </head>
      <body>
        <h1>${budget.titulo}</h1>
        <div class="sub">Orçamento gerado em ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
        <div class="info-grid">
          <div class="info-item"><label>Status</label><span class="badge badge-${budget.status}">${STATUS_CONFIG[budget.status].label}</span></div>
          ${budget.fornecedor ? `<div class="info-item"><label>Fornecedor</label><span>${budget.fornecedor}</span></div>` : ''}
          ${budget.validade ? `<div class="info-item"><label>Validade</label><span>${new Date(budget.validade + 'T00:00:00').toLocaleDateString('pt-BR')}</span></div>` : ''}
          <div class="info-item"><label>Criado em</label><span>${new Date(budget.created_at).toLocaleDateString('pt-BR')}</span></div>
        </div>
        ${budget.descricao ? `<p style="margin-bottom:16px;color:#555;">${budget.descricao}</p>` : ''}
        <table>
          <thead><tr><th>Descrição</th><th>Qtd</th><th>Un</th><th>Valor Unit.</th><th>Total</th></tr></thead>
          <tbody>
            ${items.length > 0 ? items.map(i => `
              <tr>
                <td>${i.descricao}</td>
                <td>${i.quantidade}</td>
                <td>${i.unidade}</td>
                <td>R$ ${i.valor_unitario.toFixed(2).replace('.', ',')}</td>
                <td>R$ ${(i.quantidade * i.valor_unitario).toFixed(2).replace('.', ',')}</td>
              </tr>
            `).join('') : `<tr><td colspan="5" style="color:#aaa;text-align:center;">Sem itens detalhados</td></tr>`}
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td colspan="4">Total do Orçamento</td>
              <td>R$ ${total.toFixed(2).replace('.', ',')}</td>
            </tr>
          </tfoot>
        </table>
        ${budget.observacoes ? `<div class="obs"><strong>Observações:</strong> ${budget.observacoes}</div>` : ''}
        <div class="footer">Documento gerado pelo sistema de gestão</div>
      </body>
      </html>
    `;
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 400);
    }
  };

  const filtered = useMemo(() => {
    let result = [...budgets];
    if (filterStatus !== 'all') result = result.filter(b => b.status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(b =>
        b.titulo.toLowerCase().includes(q) ||
        (b.fornecedor || '').toLowerCase().includes(q) ||
        (b.descricao || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [budgets, filterStatus, search]);

  const totalAprovado = budgets.filter(b => b.status === 'aprovado').reduce((s, b) => s + b.valor_total, 0);
  const totalRascunho = budgets.filter(b => b.status === 'rascunho').reduce((s, b) => s + b.valor_total, 0);
  const vencendoEm7 = budgets.filter(b => {
    const d = daysUntil(b.validade);
    return d !== null && d >= 0 && d <= 7 && b.status === 'rascunho';
  }).length;
  const convertidos = budgets.filter(b => b.status === 'convertido').length;

  return (
    <div className="p-6 space-y-5">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          <i className={toast.type === 'success' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} />
          {toast.msg}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total de Orçamentos', value: budgets.length, icon: 'ri-file-list-3-line', color: 'text-zinc-700', bg: 'bg-zinc-100' },
          { label: 'Aprovados', value: budgets.filter(b => b.status === 'aprovado').length, icon: 'ri-checkbox-circle-line', color: 'text-green-700', bg: 'bg-green-100' },
          { label: 'Valor Aprovado', value: formatCurrency(totalAprovado), icon: 'ri-money-dollar-circle-line', color: 'text-amber-700', bg: 'bg-amber-100' },
          { label: 'Convertidos em Compra', value: convertidos, icon: 'ri-shopping-cart-line', color: 'text-orange-700', bg: 'bg-orange-100' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-lg ${kpi.bg} flex-shrink-0`}>
              <i className={`${kpi.icon} ${kpi.color} text-lg`} />
            </div>
            <div>
              <p className="text-xs text-zinc-500">{kpi.label}</p>
              <p className="text-lg font-bold text-zinc-900">{kpi.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Alertas */}
      {vencendoEm7 > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <i className="ri-alarm-warning-line text-amber-500 text-lg flex-shrink-0" />
          <p className="text-sm text-amber-700 font-medium">
            {vencendoEm7} orçamento{vencendoEm7 > 1 ? 's' : ''} vencendo nos próximos 7 dias — aprove ou rejeite antes de expirar.
          </p>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por título, fornecedor..."
            className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          />
        </div>
        <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
          {(['all', 'rascunho', 'aprovado', 'rejeitado', 'convertido'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1 ${filterStatus === s ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
            >
              {s !== 'all' && <i className={STATUS_CONFIG[s].icon} />}
              {s === 'all' ? 'Todos' : STATUS_CONFIG[s].label}
              <span className={`ml-0.5 text-xs rounded-full px-1.5 py-0.5 font-bold ${filterStatus === s ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                {s === 'all' ? budgets.length : budgets.filter(b => b.status === s).length}
              </span>
            </button>
          ))}
        </div>
        {convertidos > 0 && (
          <button
            onClick={() => setShowComparativo(v => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap border ${showComparativo ? 'bg-amber-500 text-white border-amber-500' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
          >
            <i className="ri-scales-line" /> Orçado vs Realizado
          </button>
        )}
        <button
          onClick={() => setShowModal(true)}
          className="ml-auto flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 transition-colors cursor-pointer whitespace-nowrap"
        >
          <i className="ri-add-line" /> Novo Orçamento
        </button>
      </div>

      {/* Comparativo Orçado vs Realizado */}
      {showComparativo && <ComparativoOrcadoRealizado budgets={budgets} />}

      {/* Layout: lista + detalhe */}
      <div className="flex gap-4 items-start">
        {/* Lista */}
        <div className="flex-1 bg-white rounded-xl border border-zinc-200 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-400 text-sm">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
              <i className="ri-file-list-3-line text-4xl mb-2" />
              <p className="text-sm font-medium">Nenhum orçamento encontrado</p>
              <p className="text-xs mt-1">Crie um novo orçamento para começar</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Orçamento</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Fornecedor</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Validade</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500">Valor</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Status</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {filtered.map(b => {
                  const days = daysUntil(b.validade);
                  const expired = isExpired(b.validade);
                  const isSelected = selectedBudget?.id === b.id;
                  return (
                    <tr
                      key={b.id}
                      onClick={() => openDetail(b)}
                      className={`cursor-pointer transition-colors ${isSelected ? 'bg-amber-50' : 'hover:bg-zinc-50'}`}
                    >
                      <td className="px-4 py-3">
                        <p className={`font-medium ${isSelected ? 'text-amber-700' : 'text-zinc-900'}`}>{b.titulo}</p>
                        {b.descricao && <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-[200px]">{b.descricao}</p>}
                        {b.status === 'convertido' && b.converted_at && (
                          <p className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
                            <i className="ri-shopping-cart-line" />
                            Convertido em {new Date(b.converted_at).toLocaleDateString('pt-BR')}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">{b.fornecedor || '—'}</td>
                      <td className="px-4 py-3">
                        {b.validade ? (
                          <div>
                            <p className={`text-xs font-medium ${expired ? 'text-red-600' : days !== null && days <= 7 ? 'text-amber-600' : 'text-zinc-600'}`}>
                              {new Date(b.validade + 'T00:00:00').toLocaleDateString('pt-BR')}
                            </p>
                            {!expired && days !== null && days <= 7 && (
                              <p className="text-xs text-amber-500">Vence em {days}d</p>
                            )}
                            {expired && b.status === 'rascunho' && (
                              <p className="text-xs text-red-500">Expirado</p>
                            )}
                          </div>
                        ) : <span className="text-zinc-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-zinc-900">{formatCurrency(b.valor_total)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${STATUS_CONFIG[b.status].color}`}>
                          <i className={STATUS_CONFIG[b.status].icon} />
                          {STATUS_CONFIG[b.status].label}
                        </span>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          {b.status === 'rascunho' && (
                            <>
                              <button
                                onClick={() => handleUpdateStatus(b.id, 'aprovado')}
                                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-green-50 cursor-pointer"
                                title="Aprovar"
                              >
                                <i className="ri-checkbox-circle-line text-green-600 text-sm" />
                              </button>
                              <button
                                onClick={() => handleUpdateStatus(b.id, 'rejeitado')}
                                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 cursor-pointer"
                                title="Rejeitar"
                              >
                                <i className="ri-close-circle-line text-red-500 text-sm" />
                              </button>
                            </>
                          )}
                          {b.status === 'aprovado' && (
                            <button
                              onClick={() => openConvertModal(b)}
                              className="flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-semibold hover:bg-amber-200 cursor-pointer whitespace-nowrap transition-colors"
                              title="Converter em Compra"
                            >
                              <i className="ri-shopping-cart-line text-xs" /> Converter
                            </button>
                          )}
                          {b.status === 'convertido' && b.converted_to_purchase_id && (
                            <span className="flex items-center gap-1 px-2 py-1 bg-zinc-100 text-zinc-500 rounded-lg text-xs font-medium whitespace-nowrap">
                              <i className="ri-check-line text-xs" /> Compra criada
                            </span>
                          )}
                          <button
                            onClick={() => handleDuplicate(b)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer"
                            title="Duplicar orçamento"
                          >
                            <i className="ri-file-copy-line text-zinc-400 text-sm" />
                          </button>
                          <button
                            onClick={() => openDetail(b).then(() => handlePrint({ ...b }))}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer"
                            title="Imprimir orçamento"
                          >
                            <i className="ri-printer-line text-zinc-400 text-sm" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Painel de detalhe lateral */}
        {selectedBudget && (
          <div className="w-80 flex-shrink-0 bg-white rounded-xl border border-zinc-200 overflow-hidden sticky top-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 bg-zinc-50">
              <h4 className="text-sm font-bold text-zinc-800 truncate">{selectedBudget.titulo}</h4>
              <button
                onClick={() => setSelectedBudget(null)}
                className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-zinc-200 cursor-pointer flex-shrink-0"
              >
                <i className="ri-close-line text-zinc-500 text-sm" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Status + valor */}
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${STATUS_CONFIG[selectedBudget.status].color}`}>
                  <i className={STATUS_CONFIG[selectedBudget.status].icon} />
                  {STATUS_CONFIG[selectedBudget.status].label}
                </span>
                <span className="text-base font-bold text-zinc-900">{formatCurrency(selectedBudget.valor_total)}</span>
              </div>

              {/* Convertido info */}
              {selectedBudget.status === 'convertido' && selectedBudget.converted_at && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                  <i className="ri-shopping-cart-line text-amber-500 text-sm mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-amber-800">Convertido em compra</p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      {new Date(selectedBudget.converted_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                </div>
              )}

              {/* Info */}
              <div className="space-y-2">
                {selectedBudget.fornecedor && (
                  <div className="flex items-center gap-2 text-xs">
                    <i className="ri-store-2-line text-zinc-400 w-4" />
                    <span className="text-zinc-600">{selectedBudget.fornecedor}</span>
                  </div>
                )}
                {selectedBudget.validade && (
                  <div className="flex items-center gap-2 text-xs">
                    <i className="ri-calendar-line text-zinc-400 w-4" />
                    <span className={isExpired(selectedBudget.validade) ? 'text-red-600 font-medium' : 'text-zinc-600'}>
                      Válido até {new Date(selectedBudget.validade + 'T00:00:00').toLocaleDateString('pt-BR')}
                      {isExpired(selectedBudget.validade) && ' (expirado)'}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs">
                  <i className="ri-time-line text-zinc-400 w-4" />
                  <span className="text-zinc-500">Criado em {new Date(selectedBudget.created_at).toLocaleDateString('pt-BR')}</span>
                </div>
              </div>

              {selectedBudget.descricao && (
                <div className="bg-zinc-50 rounded-lg p-3">
                  <p className="text-xs text-zinc-500 font-semibold mb-1">Descrição</p>
                  <p className="text-xs text-zinc-700">{selectedBudget.descricao}</p>
                </div>
              )}

              {/* Itens */}
              {selectedBudget.items && selectedBudget.items.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Itens</p>
                  <div className="space-y-1.5">
                    {selectedBudget.items.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-zinc-50 rounded-lg px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-zinc-800 truncate">{item.descricao}</p>
                          <p className="text-xs text-zinc-400">{item.quantidade} {item.unidade} × {formatCurrency(item.valor_unitario)}</p>
                        </div>
                        <span className="text-xs font-bold text-zinc-900 ml-2 whitespace-nowrap">
                          {formatCurrency(item.quantidade * item.valor_unitario)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-zinc-100">
                    <span className="text-xs text-zinc-500 font-semibold">Total</span>
                    <span className="text-sm font-bold text-zinc-900">{formatCurrency(selectedBudget.valor_total)}</span>
                  </div>
                </div>
              )}

              {selectedBudget.observacoes && (
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-700 mb-1">Observações</p>
                  <p className="text-xs text-amber-800">{selectedBudget.observacoes}</p>
                </div>
              )}

              {/* Ações */}
              <div className="space-y-2 pt-1">
                {selectedBudget.status === 'rascunho' && (
                  <>
                    <button
                      onClick={() => handleUpdateStatus(selectedBudget.id, 'aprovado')}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 cursor-pointer whitespace-nowrap transition-colors"
                    >
                      <i className="ri-checkbox-circle-line" /> Aprovar Orçamento
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(selectedBudget.id, 'rejeitado')}
                      className="w-full flex items-center justify-center gap-2 py-2 border border-red-200 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-50 cursor-pointer whitespace-nowrap transition-colors"
                    >
                      <i className="ri-close-circle-line" /> Rejeitar
                    </button>
                  </>
                )}
                {selectedBudget.status === 'aprovado' && (
                  <button
                    onClick={() => openConvertModal(selectedBudget)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 text-white rounded-lg text-xs font-semibold hover:bg-amber-600 cursor-pointer whitespace-nowrap transition-colors"
                  >
                    <i className="ri-shopping-cart-line" /> Converter em Compra
                  </button>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => handlePrint(selectedBudget)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-zinc-200 text-zinc-600 rounded-lg text-xs font-semibold hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors"
                  >
                    <i className="ri-printer-line" /> Imprimir
                  </button>
                  <button
                    onClick={() => handleDuplicate(selectedBudget)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-zinc-200 text-zinc-600 rounded-lg text-xs font-semibold hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors"
                  >
                    <i className="ri-file-copy-line" /> Duplicar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal Novo Orçamento ──────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
              <h3 className="font-bold text-zinc-900">Novo Orçamento</h3>
              <button onClick={resetForm} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
                <i className="ri-close-line text-zinc-500" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Título *</label>
                <input
                  value={form.titulo}
                  onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="Ex: Reforma da cozinha, Equipamentos novos..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Fornecedor</label>
                  <input
                    value={form.fornecedor}
                    onChange={e => setForm(f => ({ ...f, fornecedor: e.target.value }))}
                    list="orc-suppliers-list"
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="Selecionar ou digitar..."
                  />
                  <datalist id="orc-suppliers-list">
                    {supplierNames.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Validade do Orçamento</label>
                  <input
                    type="date"
                    value={form.validade}
                    onChange={e => setForm(f => ({ ...f, validade: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Descrição</label>
                <textarea
                  value={form.descricao}
                  onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  rows={2}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                  placeholder="Descreva o objetivo deste orçamento..."
                />
              </div>

              {/* Itens */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-zinc-600">Itens do Orçamento</label>
                  <button onClick={handleAddItem} className="flex items-center gap-1 text-xs text-amber-600 font-semibold hover:text-amber-700 cursor-pointer">
                    <i className="ri-add-line" /> Adicionar item
                  </button>
                </div>

                <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-zinc-400 px-1 mb-1">
                  <span className="col-span-5">Descrição</span>
                  <span className="col-span-2">Qtd</span>
                  <span className="col-span-1">Un</span>
                  <span className="col-span-3">Valor Unit.</span>
                  <span className="col-span-1" />
                </div>

                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {form.items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <input
                        value={item.descricao}
                        onChange={e => handleItemChange(idx, 'descricao', e.target.value)}
                        className="col-span-5 border border-zinc-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        placeholder="Descrição"
                      />
                      <input
                        type="number"
                        value={item.quantidade}
                        onChange={e => handleItemChange(idx, 'quantidade', parseFloat(e.target.value) || 0)}
                        className="col-span-2 border border-zinc-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        min="0"
                      />
                      <input
                        value={item.unidade}
                        onChange={e => handleItemChange(idx, 'unidade', e.target.value)}
                        className="col-span-1 border border-zinc-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        placeholder="un"
                      />
                      <div className="col-span-3 relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400">R$</span>
                        <input
                          type="number"
                          value={item.valor_unitario}
                          onChange={e => handleItemChange(idx, 'valor_unitario', parseFloat(e.target.value) || 0)}
                          className="w-full border border-zinc-200 rounded-lg pl-7 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                          min="0" step="0.01"
                        />
                      </div>
                      <button onClick={() => handleRemoveItem(idx)} disabled={form.items.length === 1} className="col-span-1 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 cursor-pointer disabled:opacity-30">
                        <i className="ri-delete-bin-line text-red-400 text-sm" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex justify-between items-center mt-3 pt-3 border-t border-zinc-100">
                  <span className="text-xs text-zinc-400">{form.items.length} item{form.items.length !== 1 ? 's' : ''}</span>
                  <span className="text-sm font-bold text-zinc-900">Total: {formatCurrency(totalItems(form.items))}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Observações</label>
                <textarea
                  value={form.observacoes}
                  onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
                  rows={2}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                  placeholder="Condições, prazo de entrega, garantias..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-100">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg cursor-pointer whitespace-nowrap">
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.titulo.trim()}
                className="px-5 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
              >
                {saving ? 'Salvando...' : 'Salvar Orçamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Converter em Compra ─────────────────────────────────────────── */}
      {showConvertModal && budgetToConvert && (
        <ConvertToPurchaseModal
          budget={budgetToConvert}
          bankAccounts={bankAccounts}
          centers={centers}
          onClose={() => { setShowConvertModal(false); setBudgetToConvert(null); }}
          onSuccess={handleConvertSuccess}
        />
      )}
    </div>
  );
}
