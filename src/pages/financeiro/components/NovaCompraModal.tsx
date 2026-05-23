import { useState, useEffect, useRef, useCallback } from 'react';
import { usePurchases, useCostCenters, useBankAccounts } from '@/hooks/useFinanceiro';
import { useSuppliers } from '@/hooks/useSuppliers';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import type { PurchaseItem } from '@/types/financeiro';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface IngredientOption {
  id: string;
  name: string;
  unit: string;
  purchase_unit: string | null;
  purchase_factor: number;
}

interface CustomInstallment {
  tempId: string;
  due_date: string;
  amount: number;
}

interface PurchaseItemLocal extends Partial<PurchaseItem> {
  qty_purchase: number;
  purchase_unit: string;
  purchase_factor: number;
}

const PAYMENT_METHODS = ['Dinheiro', 'PIX', 'Cartão Débito', 'Cartão Crédito', 'Boleto', 'Transferência'];

function genId() { return Math.random().toString(36).slice(2, 10); }

// ── Componente: Input numérico com select-all ao focar ────────────────────────
function NumInput({
  value,
  onChange,
  step = '0.01',
  min = '0',
  placeholder = '0',
  className = '',
  required = false,
}: {
  value: number | string;
  onChange: (v: number) => void;
  step?: string;
  min?: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  return (
    <input
      type="number"
      step={step}
      min={min}
      required={required}
      value={value}
      placeholder={placeholder}
      onFocus={(e) => e.target.select()}
      onChange={(e) => onChange(Number(e.target.value))}
      className={className}
    />
  );
}

// ── Componente: Dropdown de fornecedores ──────────────────────────────────────
function SupplierDropdown({
  value,
  onChange,
  suppliers,
}: {
  value: string;
  onChange: (v: string) => void;
  suppliers: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fecha ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        // Se o texto não bate com nenhum fornecedor, mantém como texto livre
        setSearch(value);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [value]);

  // Sincroniza search com value externo
  useEffect(() => { setSearch(value); }, [value]);

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (name: string) => {
    onChange(name);
    setSearch(name);
    setOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    onChange(e.target.value);
    setOpen(true);
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          required
          value={search}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          placeholder="Selecionar ou digitar..."
          className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 pr-8"
        />
        <button
          type="button"
          onClick={() => { setOpen(o => !o); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer"
        >
          {open ? <i className="ri-arrow-up-s-line text-sm" /> : <i className="ri-arrow-down-s-line text-sm" />}
        </button>
      </div>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-zinc-400 text-center">
              {search ? `Usar "${search}" como novo fornecedor` : 'Nenhum fornecedor cadastrado'}
            </div>
          ) : (
            filtered.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelect(s.name)}
                className={`w-full text-left px-3 py-2.5 text-sm hover:bg-amber-50 cursor-pointer transition-colors flex items-center gap-2 ${
                  value === s.name ? 'bg-amber-50 text-amber-700 font-semibold' : 'text-zinc-700'
                }`}
              >
                <i className="ri-store-2-line text-zinc-400 text-xs flex-shrink-0" />
                {s.name}
              </button>
            ))
          )}
          {search && !suppliers.find(s => s.name.toLowerCase() === search.toLowerCase()) && (
            <button
              type="button"
              onClick={() => handleSelect(search)}
              className="w-full text-left px-3 py-2.5 text-xs text-amber-600 hover:bg-amber-50 cursor-pointer border-t border-zinc-100 flex items-center gap-2"
            >
              <i className="ri-add-line" /> Usar &quot;{search}&quot; como novo fornecedor
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── InstallmentSummary ────────────────────────────────────────────────────────

function InstallmentSummary({ installments, totalAmount }: { installments: CustomInstallment[]; totalAmount: number }) {
  const totalParcelas = installments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const diff = totalAmount - totalParcelas;
  const allFilled = installments.every((p) => p.due_date && Number(p.amount) > 0);
  if (installments.length === 0) return null;
  return (
    <div className={`rounded-xl p-3 border text-xs flex items-center justify-between gap-4 ${
      Math.abs(diff) < 0.01 && allFilled ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700'
    }`}>
      <div className="flex items-center gap-2">
        <i className={`text-base ${Math.abs(diff) < 0.01 && allFilled ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'}`} />
        <span>
          {Math.abs(diff) < 0.01 && allFilled
            ? `${installments.length} parcela${installments.length > 1 ? 's' : ''} — total confere`
            : `Total das parcelas: ${formatCurrency(totalParcelas)}`}
        </span>
      </div>
      {Math.abs(diff) >= 0.01 && (
        <span className="font-bold">{diff > 0 ? `Faltam ${formatCurrency(diff)}` : `Excede ${formatCurrency(Math.abs(diff))}`}</span>
      )}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface NovaCompraModalProps {
  onClose: () => void;
  insumoPreSelecionado?: { id: string; nome: string; unidade: string } | null;
  onSaved?: () => void;
}

const emptyForm = {
  supplier: '',
  invoice_number: '',
  purchase_date: new Date().toISOString().split('T')[0],
  payment_method: 'Dinheiro',
  payment_status: 'paid' as const,
  due_date: '',
  cost_center_id: '',
  notes: '',
  bank_account_id: '',
};

function makeEmptyItem(ing?: IngredientOption): PurchaseItemLocal {
  return {
    description: ing?.name ?? '',
    ingredient_id: ing?.id ?? '',
    qty_purchase: 1,
    purchase_unit: ing?.purchase_unit ?? ing?.unit ?? '',
    purchase_factor: ing?.purchase_factor ?? 1,
    quantity: ing ? (ing.purchase_factor ?? 1) : 1,
    unit_price: 0,
    total_price: 0,
  };
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function NovaCompraModal({ onClose, insumoPreSelecionado, onSaved }: NovaCompraModalProps) {
  const { user } = useAuth();
  const { create } = usePurchases();
  const { centers } = useCostCenters();
  const { accounts: bankAccounts } = useBankAccounts();
  const { suppliers } = useSuppliers();

  const [form, setForm] = useState(emptyForm);
  const [items, setItems] = useState<PurchaseItemLocal[]>([makeEmptyItem()]);
  const [ingredients, setIngredients] = useState<IngredientOption[]>([]);
  const [ingredientsLoading, setIngredientsLoading] = useState(false);
  const [paymentMode, setPaymentMode] = useState<'avista' | 'aprazo' | 'parcelado'>('avista');
  const [firstDueDate, setFirstDueDate] = useState('');
  const [customInstallments, setCustomInstallments] = useState<CustomInstallment[]>([
    { tempId: genId(), due_date: '', amount: 0 },
    { tempId: genId(), due_date: '', amount: 0 },
  ]);
  const [saving, setSaving] = useState(false);

  // ── Carregar insumos — versão robusta com retry ───────────────────────────
  const loadIngredients = useCallback(async () => {
    if (!user?.tenantId) {
      console.warn('[NovaCompraModal] tenantId não disponível, abortando carregamento de insumos');
      return;
    }
    setIngredientsLoading(true);
    try {
      const { data, error } = await supabase
        .rpc('fn_get_ingredients', { p_tenant_id: user.tenantId });
      if (error) throw error;
      const rows = (data as Array<Record<string, unknown>>) ?? [];
      const loaded: IngredientOption[] = rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        unit: (r.unit as string) ?? 'unit',
        purchase_unit: (r.purchase_unit as string | null) ?? null,
        purchase_factor: Number(r.purchase_factor ?? 1) || 1,
      }));
      console.log('[NovaCompraModal] Insumos carregados via RPC:', loaded.length);
      setIngredients(loaded);
    } catch (e) {
      console.error('[NovaCompraModal] Erro ao carregar insumos via RPC:', e);
    } finally {
      setIngredientsLoading(false);
    }
  }, [user?.tenantId]);

  // Dispara quando tenantId ficar disponível
  useEffect(() => {
    if (user?.tenantId) {
      loadIngredients();
    }
  }, [user?.tenantId, loadIngredients]);

  // Pre-seleciona o insumo quando ingredients carregam
  useEffect(() => {
    if (!insumoPreSelecionado || ingredients.length === 0) return;
    const ing = ingredients.find((i) => i.id === insumoPreSelecionado.id);
    if (!ing) {
      console.warn('[NovaCompraModal] Insumo pré-selecionado não encontrado na lista:', insumoPreSelecionado.id);
      return;
    }
    setItems([makeEmptyItem(ing)]);
  }, [ingredients, insumoPreSelecionado]);

  // ── Helpers de item ────────────────────────────────────────────────────────

  const updateItem = (idx: number, field: string, value: string | number) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const updated: PurchaseItemLocal = { ...item, [field]: value };

        if (field === 'ingredient_id') {
          const ing = ingredients.find((ig) => ig.id === value);
          if (ing) {
            updated.description = ing.name;
            updated.purchase_unit = ing.purchase_unit ?? ing.unit;
            updated.purchase_factor = ing.purchase_factor ?? 1;
            updated.quantity = updated.qty_purchase * updated.purchase_factor;
          }
        }

        if (field === 'qty_purchase') {
          updated.quantity = Number(value) * (updated.purchase_factor ?? 1);
          updated.total_price = updated.qty_purchase * Number(updated.unit_price ?? 0);
        }

        if (field === 'unit_price') {
          updated.total_price = updated.qty_purchase * Number(value);
        }

        return updated;
      }),
    );
  };

  function getPricePerStockUnit(item: PurchaseItemLocal): number {
    if (!item.purchase_factor || item.purchase_factor <= 0) return Number(item.unit_price ?? 0);
    return Number(item.unit_price ?? 0) / item.purchase_factor;
  }

  const totalAmount = items.reduce((s, i) => s + Number(i.total_price ?? 0), 0);

  // ── Helpers de parcelamento ────────────────────────────────────────────────

  const addInstallment = () =>
    setCustomInstallments((prev) => [...prev, { tempId: genId(), due_date: '', amount: 0 }]);

  const removeInstallment = (tempId: string) =>
    setCustomInstallments((prev) => prev.filter((p) => p.tempId !== tempId));

  const updateInstallment = (tempId: string, field: 'due_date' | 'amount', value: string | number) => {
    setCustomInstallments((prev) =>
      prev.map((p) => (p.tempId === tempId ? { ...p, [field]: value } : p)),
    );
  };

  const distribuirIgual = () => {
    if (customInstallments.length === 0 || totalAmount === 0) return;
    const base = Math.round((totalAmount / customInstallments.length) * 100) / 100;
    setCustomInstallments((prev) =>
      prev.map((p, i) => ({
        ...p,
        amount: i === prev.length - 1
          ? Math.round((totalAmount - base * (prev.length - 1)) * 100) / 100
          : base,
      })),
    );
  };

  const aplicarIntervalo = (intervalDays: number) => {
    const firstDate = customInstallments[0]?.due_date;
    if (!firstDate) return;
    setCustomInstallments((prev) =>
      prev.map((p, i) => {
        const d = new Date(firstDate + 'T00:00:00');
        d.setDate(d.getDate() + intervalDays * i);
        return { ...p, due_date: d.toISOString().split('T')[0] };
      }),
    );
  };

  const definirQuantidade = (count: number) => {
    const base = customInstallments.length > 0 ? customInstallments[0].due_date : '';
    const baseAmount = totalAmount > 0 ? Math.round((totalAmount / count) * 100) / 100 : 0;
    setCustomInstallments(
      Array.from({ length: count }, (_, i) => ({
        tempId: genId(),
        due_date: base,
        amount: i === count - 1 && totalAmount > 0
          ? Math.round((totalAmount - baseAmount * (count - 1)) * 100) / 100
          : baseAmount,
      })),
    );
  };

  const parcelasValidas =
    paymentMode !== 'parcelado' ||
    (customInstallments.length >= 2 &&
      customInstallments.every((p) => p.due_date && Number(p.amount) > 0));

  const totalParcelas = customInstallments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const parcelasDiff = Math.abs(totalAmount - totalParcelas);

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const itemsForBackend = items.map((item) => ({
      description: item.description ?? '',
      ingredient_id: item.ingredient_id || null,
      quantity: Number(item.qty_purchase ?? 1) * (item.purchase_factor ?? 1),
      unit_price: getPricePerStockUnit(item),
      total_price: item.total_price ?? 0,
      purchase_unit: item.purchase_unit ?? null,
      purchase_qty: item.qty_purchase ?? 1,
      purchase_factor: item.purchase_factor ?? 1,
    }));

    const payload: Record<string, unknown> = {
      ...form,
      total_amount: totalAmount,
      items: itemsForBackend,
    };

    if (paymentMode === 'avista') {
      payload.payment_status = 'paid';
      payload.due_date = '';
    } else if (paymentMode === 'aprazo') {
      payload.payment_status = 'pending';
      payload.due_date = firstDueDate;
    } else {
      payload.payment_status = 'partial';
      payload.due_date = customInstallments[0]?.due_date || '';
      payload.custom_installments = customInstallments.map((p, i) => ({
        installment_number: i + 1,
        due_date: p.due_date,
        amount: Number(p.amount),
      }));
    }

    await create(payload);
    setSaving(false);
    onSaved?.();
    onClose();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-semibold text-zinc-900">Nova Compra</h3>
            {insumoPreSelecionado && (
              <p className="text-xs text-zinc-400 mt-0.5">
                <i className="ri-flask-line mr-1" />
                Insumo: <strong className="text-zinc-600">{insumoPreSelecionado.nome}</strong>
              </p>
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Fornecedor + NF + Data */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="text-xs font-semibold text-zinc-600 block mb-1">Fornecedor *</label>
              <SupplierDropdown
                value={form.supplier}
                onChange={(v) => setForm((f) => ({ ...f, supplier: v }))}
                suppliers={suppliers}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">Nota Fiscal</label>
              <input
                value={form.invoice_number}
                onChange={(e) => setForm((f) => ({ ...f, invoice_number: e.target.value }))}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="Nº da NF"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">Data da Compra *</label>
              <input
                required
                type="date"
                value={form.purchase_date}
                onChange={(e) => setForm((f) => ({ ...f, purchase_date: e.target.value }))}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          {/* Forma de pagamento */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">Forma de Pagamento</label>
              <select
                value={form.payment_method}
                onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">Conta de Pagamento</label>
              <select
                value={form.bank_account_id}
                onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="">Não especificado</option>
                {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>

          {/* Condição de Pagamento */}
          <div>
            <label className="text-xs font-semibold text-zinc-600 block mb-2">Condição de Pagamento</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'avista', icon: 'ri-money-dollar-circle-line', label: 'À Vista', desc: 'Pago na hora' },
                { key: 'aprazo', icon: 'ri-calendar-check-line', label: 'A Prazo', desc: 'Único vencimento' },
                { key: 'parcelado', icon: 'ri-calendar-schedule-line', label: 'Parcelado', desc: 'Datas individuais' },
              ] as const).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setPaymentMode(opt.key)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                    paymentMode === opt.key ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 bg-white hover:border-zinc-300'
                  }`}
                >
                  <i className={`${opt.icon} text-xl ${paymentMode === opt.key ? 'text-amber-500' : 'text-zinc-400'}`} />
                  <span className={`text-xs font-bold ${paymentMode === opt.key ? 'text-amber-700' : 'text-zinc-600'}`}>{opt.label}</span>
                  <span className="text-xs text-zinc-400">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {paymentMode === 'aprazo' && (
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">
                Data de Vencimento <span className="text-zinc-400 font-normal">(opcional — padrão: D+1)</span>
              </label>
              <input
                type="date"
                value={firstDueDate}
                onChange={(e) => setFirstDueDate(e.target.value)}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          )}

          {paymentMode === 'parcelado' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-semibold text-zinc-700 flex items-center gap-1.5">
                  <i className="ri-calendar-schedule-line text-amber-500" />
                  {customInstallments.length} parcela{customInstallments.length !== 1 ? 's' : ''}
                  {totalAmount > 0 && <span className="text-zinc-400 font-normal">· total: {formatCurrency(totalAmount)}</span>}
                </p>
                <div className="flex items-center gap-2">
                  {totalAmount > 0 && (
                    <button type="button" onClick={distribuirIgual}
                      className="text-xs px-2.5 py-1 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 cursor-pointer whitespace-nowrap font-semibold">
                      <i className="ri-scales-line mr-1" />Distribuir igual
                    </button>
                  )}
                  <button type="button" onClick={addInstallment}
                    className="text-xs px-2.5 py-1 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap font-semibold flex items-center gap-1">
                    <i className="ri-add-line" /> Parcela
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-zinc-400">Quantidade:</span>
                {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                  <button key={n} type="button" onClick={() => definirQuantidade(n)}
                    className={`text-xs w-8 h-7 rounded-lg border cursor-pointer font-semibold ${
                      customInstallments.length === n ? 'bg-amber-500 text-white border-amber-500' : 'border-zinc-200 text-zinc-600 hover:border-amber-300 hover:text-amber-600'
                    }`}>
                    {n}x
                  </button>
                ))}
              </div>
              {customInstallments[0]?.due_date && customInstallments.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-zinc-400">Intervalo:</span>
                  {[{ label: 'Semanal', days: 7 }, { label: 'Quinzenal', days: 15 }, { label: 'Mensal', days: 30 }].map((s) => (
                    <button key={s.days} type="button" onClick={() => aplicarIntervalo(s.days)}
                      className="text-xs px-2.5 py-1 rounded-full border border-zinc-200 text-zinc-600 hover:border-amber-300 hover:text-amber-600 cursor-pointer whitespace-nowrap">
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                <div className="grid grid-cols-12 gap-2 px-1">
                  <span className="col-span-1 text-xs text-zinc-400 font-semibold text-center">#</span>
                  <span className="col-span-5 text-xs text-zinc-400 font-semibold">Vencimento</span>
                  <span className="col-span-5 text-xs text-zinc-400 font-semibold">Valor (R$)</span>
                  <span className="col-span-1" />
                </div>
                {customInstallments.map((inst, idx) => (
                  <div key={inst.tempId} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-1 flex justify-center">
                      <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold">{idx + 1}</span>
                    </div>
                    <div className="col-span-5">
                      <input type="date" required value={inst.due_date}
                        onChange={(e) => updateInstallment(inst.tempId, 'due_date', e.target.value)}
                        className={`w-full border rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${inst.due_date ? 'border-zinc-200' : 'border-amber-300 bg-amber-50/50'}`} />
                    </div>
                    <div className="col-span-5">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400 font-semibold">R$</span>
                        <NumInput
                          value={inst.amount || 0}
                          onChange={(v) => updateInstallment(inst.tempId, 'amount', v)}
                          step="0.01"
                          min="0.01"
                          placeholder="0,00"
                          className={`w-full border rounded-lg pl-8 pr-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${Number(inst.amount) > 0 ? 'border-zinc-200' : 'border-amber-300 bg-amber-50/50'}`}
                        />
                      </div>
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button type="button" onClick={() => removeInstallment(inst.tempId)}
                        disabled={customInstallments.length <= 2}
                        className="w-6 h-6 flex items-center justify-center text-zinc-300 hover:text-red-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
                        <i className="ri-delete-bin-line text-sm" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <InstallmentSummary installments={customInstallments} totalAmount={totalAmount} />
              {totalAmount > 0 && parcelasDiff > 0.01 && (
                <p className="text-xs text-amber-600 flex items-center gap-1.5">
                  <i className="ri-information-line" />
                  Ajuste os valores para somarem {formatCurrency(totalAmount)}
                </p>
              )}
            </div>
          )}

          {/* Centro de custo + Observações */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">Centro de Custo</label>
              <select
                value={form.cost_center_id}
                onChange={(e) => setForm((f) => ({ ...f, cost_center_id: e.target.value }))}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="">Nenhum</option>
                {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">Observações</label>
              <input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="Obs. internas"
              />
            </div>
          </div>

          {/* ── Itens da compra ────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-zinc-600">Itens da Compra</label>
              <button
                type="button"
                onClick={() => setItems((prev) => [...prev, makeEmptyItem()])}
                className="text-xs text-amber-600 hover:text-amber-700 cursor-pointer font-semibold flex items-center gap-1"
              >
                <i className="ri-add-line" /> Adicionar item
              </button>
            </div>

            <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
              {items.map((item, idx) => {
                const ing = ingredients.find((ig) => ig.id === item.ingredient_id);
                const hasPurchaseUnit = !!item.purchase_unit && item.purchase_unit !== ing?.unit;
                const stockQty = Number(item.qty_purchase ?? 1) * (item.purchase_factor ?? 1);
                const pricePerStock = getPricePerStockUnit(item);
                // Unidade base do insumo no estoque
                const stockUnit = ing?.unit ?? '';
                // Unidade de compra (embalagem)
                const buyUnit = item.purchase_unit || stockUnit || 'un';

                return (
                  <div key={idx} className="border border-zinc-200 rounded-xl p-4 bg-white space-y-3">
                    {/* Linha 1: Insumo + Descrição */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-zinc-500 mb-1 block">Insumo</label>
                        <select
                          value={item.ingredient_id ?? ''}
                          onClick={loadIngredients}
                          onChange={(e) => updateItem(idx, 'ingredient_id', e.target.value)}
                          className="w-full border border-zinc-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white cursor-pointer"
                        >
                          <option value="">
                            {ingredientsLoading ? 'Carregando insumos...' : 'Selecionar insumo'}
                          </option>
                          {ingredients.length === 0 && !ingredientsLoading && (
                            <option value="" disabled>Nenhum insumo cadastrado</option>
                          )}
                          {ingredients.map((ig) => <option key={ig.id} value={ig.id}>{ig.name}</option>)}
                        </select>
                        {ingredients.length === 0 && !ingredientsLoading && user?.tenantId && (
                          <p className="text-[10px] text-red-500 mt-1 flex items-center gap-1">
                            <i className="ri-error-warning-line" />
                            Nenhum insumo encontrado. Clique no campo para recarregar.
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-zinc-500 mb-1 block">Descrição livre</label>
                        <input
                          placeholder="Ex: Carne traseira extra"
                          value={item.description ?? ''}
                          onChange={(e) => updateItem(idx, 'description', e.target.value)}
                          className="w-full border border-zinc-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                    </div>

                    {/* Linha 2: Qtd + Unidade + Preço unit. + Unid./embalagem + Total */}
                    <div className="grid grid-cols-5 gap-2 items-end">
                      {/* Quantidade */}
                      <div>
                        <label className="text-xs font-semibold text-zinc-500 mb-1 block">Quantidade</label>
                        <NumInput
                          value={item.qty_purchase ?? 1}
                          onChange={(v) => updateItem(idx, 'qty_purchase', v)}
                          step="0.001"
                          min="0.001"
                          placeholder="1"
                          className="w-full border border-zinc-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>

                      {/* Unidade */}
                      <div>
                        <label className="text-xs font-semibold text-zinc-500 mb-1 block">Unidade</label>
                        <div className="w-full border border-zinc-200 rounded-lg px-2.5 py-2 text-sm bg-zinc-50 text-zinc-600 font-medium min-h-[38px] flex items-center">
                          {buyUnit || <span className="text-zinc-300">—</span>}
                        </div>
                      </div>

                      {/* Preço unitário — ANTES de Unid./embalagem */}
                      <div>
                        <label className="text-xs font-semibold text-zinc-500 mb-1 block">
                          Preço unit. <span className="text-zinc-400 font-normal">({buyUnit})</span>
                        </label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400 font-semibold pointer-events-none">R$</span>
                          <NumInput
                            value={item.unit_price ?? 0}
                            onChange={(v) => updateItem(idx, 'unit_price', v)}
                            step="0.01"
                            min="0"
                            placeholder="0,00"
                            className="w-full border border-zinc-200 rounded-lg pl-7 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                          />
                        </div>
                      </div>

                      {/* Unid./embalagem — com hint da unidade do estoque */}
                      <div>
                        <label className="text-xs font-semibold text-zinc-500 mb-1 block">
                          Unid./embalagem
                          {stockUnit && (
                            <span className="ml-1 text-zinc-400 font-normal">
                              (em {stockUnit})
                            </span>
                          )}
                        </label>
                        <NumInput
                          value={item.purchase_factor ?? 1}
                          onChange={(v) => {
                            updateItem(idx, 'purchase_factor', v);
                            // Recalcula quantity e total
                            setItems(prev => prev.map((it, i) => {
                              if (i !== idx) return it;
                              const newFactor = v;
                              const newQty = it.qty_purchase * newFactor;
                              return {
                                ...it,
                                purchase_factor: newFactor,
                                quantity: newQty,
                                total_price: it.qty_purchase * Number(it.unit_price ?? 0),
                              };
                            }));
                          }}
                          step="1"
                          min="1"
                          placeholder="1"
                          className="w-full border border-zinc-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>

                      {/* Total */}
                      <div className="text-right">
                        <p className="text-xs font-semibold text-zinc-500 mb-1">Total</p>
                        <p className="text-sm font-bold text-zinc-800 py-2">{formatCurrency(Number(item.total_price ?? 0))}</p>
                      </div>
                    </div>

                    {/* Preview de conversão */}
                    {item.qty_purchase > 0 && Number(item.unit_price) > 0 && (
                      <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
                        <i className="ri-information-line text-amber-500 text-sm mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-amber-700 leading-relaxed">
                          {hasPurchaseUnit || (item.purchase_factor ?? 1) > 1 ? (
                            <>
                              <strong>{item.qty_purchase} {buyUnit}</strong>
                              {(item.purchase_factor ?? 1) > 1 && (
                                <> × {item.purchase_factor} {stockUnit} = <strong>{stockQty.toFixed(stockQty % 1 === 0 ? 0 : 3)} {stockUnit}</strong> no estoque</>
                              )}
                              {' · '}
                              custo/{stockUnit || 'un'}: <strong>{formatCurrency(pricePerStock)}</strong>
                            </>
                          ) : (
                            <>
                              {item.qty_purchase} {buyUnit} × {formatCurrency(Number(item.unit_price))} = <strong>{formatCurrency(Number(item.total_price ?? 0))}</strong>
                            </>
                          )}
                        </p>
                      </div>
                    )}

                    {/* Botão remover */}
                    {items.length > 1 && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-xs text-zinc-400 hover:text-red-500 cursor-pointer flex items-center gap-1 transition-colors"
                        >
                          <i className="ri-delete-bin-line" /> Remover item
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center mt-3 pt-3 border-t border-zinc-100">
              <span className="text-xs text-zinc-400">{items.length} item{items.length !== 1 ? 's' : ''}</span>
              <span className="text-sm font-bold text-zinc-900">Total: {formatCurrency(totalAmount)}</span>
            </div>
          </div>

          {/* Rodapé */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !parcelasValidas || (paymentMode === 'parcelado' && totalAmount > 0 && parcelasDiff > 0.01)}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap"
            >
              {saving ? <><i className="ri-loader-4-line animate-spin mr-1" />Salvando...</> : 'Salvar Compra'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}