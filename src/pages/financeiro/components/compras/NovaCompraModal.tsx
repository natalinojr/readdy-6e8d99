import { useState, useEffect, useRef } from 'react';
import { formatCurrency } from '@/lib/formatters';
import type { PurchaseItem } from '@/types/financeiro';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface IngredientOption { id: string; name: string; unit: string; }
interface CustomInstallment { tempId: string; due_date: string; amount: number; }
interface CostCenter { id: string; name: string; }
interface BankAccount { id: string; name: string; }

// Item unificado: pode ser insumo (ingredient_id) ou item do catálogo (catalog_id)
interface UnifiedItem {
  id: string;
  name: string;
  unit: string;
  type: 'ingredient' | 'catalog';
  dre_category_id?: string | null;
  dre_category_name?: string | null;
  default_supplier?: string | null;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

const PAYMENT_METHODS = ['Dinheiro', 'PIX', 'Cartão Débito', 'Cartão Crédito', 'Boleto', 'Transferência'];

const UNIT_OPTIONS = [
  'un', 'kg', 'g', 'L', 'mL', 'cx', 'fardo', 'pacote', 'saco', 'lata', 'garrafa', 'bandeja', 'dúzia',
];

function getLocalDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const emptyForm = {
  supplier: '', invoice_number: '',
  purchase_date: getLocalDateString(),
  payment_method: 'Dinheiro', payment_status: 'paid',
  due_date: '', cost_center_id: '', notes: '', bank_account_id: '',
};

type CostCenterMode = 'total' | 'per_item';

function InstallmentSummary({
  installments, totalAmount,
}: { installments: CustomInstallment[]; totalAmount: number }) {
  const totalParcelas = installments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const diff = totalAmount - totalParcelas;
  const allFilled = installments.every((p) => p.due_date && Number(p.amount) > 0);

  if (installments.length === 0) return null;

  return (
    <div className={`rounded-xl p-3 border text-xs flex items-center justify-between gap-4 ${
      Math.abs(diff) < 0.01 && allFilled
        ? 'bg-green-50 border-green-200 text-green-700'
        : 'bg-amber-50 border-amber-200 text-amber-700'
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
        <span className="font-bold">
          {diff > 0 ? `Faltam ${formatCurrency(diff)}` : `Excede ${formatCurrency(Math.abs(diff))}`}
        </span>
      )}
    </div>
  );
}

interface Props {
  suppliers: string[];
  ingredients: IngredientOption[];
  centers: CostCenter[];
  bankAccounts: BankAccount[];
  onLoadIngredients: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

export default function NovaCompraModal({
  suppliers, ingredients, centers, bankAccounts, onLoadIngredients, onSubmit, onClose,
}: Props) {
  const { user } = useAuth();
  const [catalogItems, setCatalogItems] = useState<UnifiedItem[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load catálogo de itens de compra
  useEffect(() => {
    if (!user?.tenantId) return;
    supabase
      .from('fin_purchase_catalog')
      .select('id, name, default_unit, dre_category_id, default_supplier, dre_category:fin_dre_categories(id, name)')
      .eq('tenant_id', user.tenantId)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        const cats = (data ?? []).map((c: Record<string, unknown>) => ({
          id: c.id as string,
          name: c.name as string,
          unit: (c.default_unit as string) || 'un',
          type: 'catalog' as const,
          dre_category_id: c.dre_category_id as string | null,
          dre_category_name: (c.dre_category as { name?: string } | null)?.name ?? null,
          default_supplier: c.default_supplier as string | null,
        }));
        setCatalogItems(cats);
      });
  }, [user?.tenantId]);

  // Itens unificados: catálogo primeiro, depois insumos
  const allItems: UnifiedItem[] = [
    ...catalogItems,
    ...ingredients.map((ig) => ({
      id: ig.id,
      name: ig.name,
      unit: ig.unit,
      type: 'ingredient' as const,
      dre_category_id: null,
      dre_category_name: 'CMV',
      default_supplier: null,
    })),
  ];

  const [form, setForm] = useState(emptyForm);
  const [items, setItems] = useState<Partial<PurchaseItem>[]>([
    { description: '', quantity: 1, unit_price: 0, total_price: 0, unit_label: 'un', units_per_package: undefined, cost_center_id: '' },
  ]);
  const [paymentMode, setPaymentMode] = useState<'avista' | 'aprazo' | 'parcelado'>('avista');
  const [firstDueDate, setFirstDueDate] = useState('');
  const [customInstallments, setCustomInstallments] = useState<CustomInstallment[]>([
    { tempId: genId(), due_date: '', amount: 0 },
    { tempId: genId(), due_date: '', amount: 0 },
  ]);
  const [costCenterMode, setCostCenterMode] = useState<CostCenterMode>('total');
  const [submitting, setSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // ─── Frete ───────────────────────────────────────────────────────────────
  const [freightAmount, setFreightAmount] = useState<number>(0);
  const [freightMode, setFreightMode] = useState<'auto' | 'manual'>('auto');
  const [freightPerItem, setFreightPerItem] = useState<Record<number, number>>({});

  const subtotalAmount = items.reduce((s, i) => s + Number(i.total_price ?? 0), 0);
  const totalAmount = subtotalAmount + (freightAmount || 0);

  // Divisão automática do frete proporcional ao valor de cada item
  const autoFreightPerItem = (idx: number): number => {
    if (!freightAmount || subtotalAmount === 0) return 0;
    const itemTotal = Number(items[idx]?.total_price ?? 0);
    return Math.round((freightAmount * itemTotal / subtotalAmount) * 100) / 100;
  };

  const getFreightForItem = (idx: number): number => {
    if (!freightAmount) return 0;
    return freightMode === 'auto' ? autoFreightPerItem(idx) : (freightPerItem[idx] ?? 0);
  };

  // Custo unitário real = (total_price + frete_item) / (qty * units_per_package ou qty)
  const realUnitCost = (item: Partial<PurchaseItem>, idx: number): number => {
    const itemTotal = Number(item.total_price ?? 0);
    const freight = getFreightForItem(idx);
    const totalWithFreight = itemTotal + freight;
    const qty = Number(item.quantity ?? 1);
    const unitsPerPkg = Number(item.units_per_package ?? 1);
    const totalUnits = qty * (unitsPerPkg > 1 ? unitsPerPkg : 1);
    if (totalUnits === 0) return 0;
    return totalWithFreight / totalUnits;
  };

  // Ao mudar para manual, inicializa com os valores automáticos
  useEffect(() => {
    if (freightMode === 'manual' && freightAmount > 0) {
      const init: Record<number, number> = {};
      items.forEach((_, idx) => { init[idx] = autoFreightPerItem(idx); });
      setFreightPerItem(init);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freightMode]);

  const freightManualTotal = Object.values(freightPerItem).reduce((s, v) => s + (v || 0), 0);
  const freightManualDiff = Math.abs(freightAmount - freightManualTotal);

  // Dropdown de item unificado
  const [itemDropdownOpen, setItemDropdownOpen] = useState<Record<number, boolean>>({});
  const [itemSearch, setItemSearch] = useState<Record<number, string>>({});
  const itemDropdownRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      Object.entries(itemDropdownRefs.current).forEach(([idx, ref]) => {
        if (ref && !ref.contains(e.target as Node)) {
          setItemDropdownOpen((prev) => ({ ...prev, [Number(idx)]: false }));
        }
      });
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const updateItem = (idx: number, field: string, value: string | number | undefined) => {
    setItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      if (field === 'quantity' || field === 'unit_price') {
        updated.total_price = Number(updated.quantity ?? 0) * Number(updated.unit_price ?? 0);
      }
      if (field === 'ingredient_id') {
        const ing = ingredients.find((ig) => ig.id === value);
        if (ing) {
          updated.description = ing.name;
          updated.unit_label = ing.unit || 'un';
        }
      }
      return updated;
    }));
    // Recalcular frete manual ao mudar item
    if (freightMode === 'manual' && freightAmount > 0 && (field === 'quantity' || field === 'unit_price')) {
      setTimeout(() => {
        setFreightPerItem((prev) => {
          const newMap = { ...prev };
          items.forEach((_, i) => { if (!(i in newMap)) newMap[i] = 0; });
          return newMap;
        });
      }, 0);
    }
  };

  const selectUnifiedItem = (idx: number, unified: UnifiedItem) => {
    setItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item };
      if (unified.type === 'ingredient') {
        updated.ingredient_id = unified.id;
        (updated as Record<string, unknown>).catalog_id = undefined;
      } else {
        (updated as Record<string, unknown>).catalog_id = unified.id;
        updated.ingredient_id = undefined;
      }
      updated.description = unified.name;
      updated.unit_label = unified.unit || 'un';
      (updated as Record<string, unknown>).dre_category_id = unified.dre_category_id ?? null;
      return updated;
    }));
    setItemSearch((prev) => ({ ...prev, [idx]: unified.name }));
    setItemDropdownOpen((prev) => ({ ...prev, [idx]: false }));
  };

  const addItem = () => {
    setItems((prev) => [...prev, {
      description: '', quantity: 1, unit_price: 0, total_price: 0,
      unit_label: 'un', units_per_package: undefined, cost_center_id: '',
    }]);
    onLoadIngredients();
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const addInstallment = () => {
    setCustomInstallments((prev) => [...prev, { tempId: genId(), due_date: '', amount: 0 }]);
  };

  const removeInstallment = (tempId: string) => {
    setCustomInstallments((prev) => prev.filter((p) => p.tempId !== tempId));
  };

  const updateInstallment = (tempId: string, field: 'due_date' | 'amount', value: string | number) => {
    setCustomInstallments((prev) => prev.map((p) => p.tempId === tempId ? { ...p, [field]: value } : p));
  };

  const distribuirIgual = () => {
    if (customInstallments.length === 0 || totalAmount === 0) return;
    const base = Math.round((totalAmount / customInstallments.length) * 100) / 100;
    setCustomInstallments((prev) => prev.map((p, i) => ({
      ...p,
      amount: i === prev.length - 1
        ? Math.round((totalAmount - base * (prev.length - 1)) * 100) / 100
        : base,
    })));
  };

  const aplicarIntervalo = (intervalDays: number) => {
    if (customInstallments.length === 0) return;
    const firstDate = customInstallments[0].due_date;
    if (!firstDate) return;
    setCustomInstallments((prev) => prev.map((p, i) => {
      const d = new Date(firstDate + 'T00:00:00');
      d.setDate(d.getDate() + intervalDays * i);
      return { ...p, due_date: d.toISOString().split('T')[0] };
    }));
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

  const totalParcelas = customInstallments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const parcelasDiff = Math.abs(totalAmount - totalParcelas);
  const parcelasValidas = paymentMode !== 'parcelado' || (
    customInstallments.length >= 2 &&
    customInstallments.every((p) => p.due_date && Number(p.amount) > 0)
  );

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!form.supplier.trim()) {
      errors.supplier = 'Informe o fornecedor';
    }
    if (!form.purchase_date) {
      errors.purchase_date = 'Informe a data da compra';
    }
    if (items.length === 0) {
      errors.items = 'Adicione pelo menos um item';
    } else {
      items.forEach((item, idx) => {
        if (!item.description?.trim()) {
          errors[`item_${idx}_description`] = `Item ${idx + 1}: informe a descrição`;
        }
        if (!item.quantity || Number(item.quantity) <= 0) {
          errors[`item_${idx}_quantity`] = `Item ${idx + 1}: quantidade deve ser maior que 0`;
        }
        if (!item.unit_price || Number(item.unit_price) <= 0) {
          errors[`item_${idx}_unit_price`] = `Item ${idx + 1}: preço unitário deve ser maior que 0`;
        }
      });
    }
    if (paymentMode === 'aprazo' && !firstDueDate) {
      errors.due_date = 'Informe a data de vencimento para pagamento a prazo';
    }
    if (paymentMode === 'parcelado') {
      if (customInstallments.length < 2) {
        errors.parcelas = 'Adicione pelo menos 2 parcelas';
      }
      customInstallments.forEach((inst, idx) => {
        if (!inst.due_date) {
          errors[`parcela_${idx}_date`] = `Parcela ${idx + 1}: informe a data de vencimento`;
        }
        if (!inst.amount || Number(inst.amount) <= 0) {
          errors[`parcela_${idx}_amount`] = `Parcela ${idx + 1}: informe o valor`;
        }
      });
      if (totalAmount > 0 && parcelasDiff > 0.01) {
        errors.parcelas_total = `Total das parcelas (${formatCurrency(totalParcelas)}) difere do total da compra (${formatCurrency(totalAmount)})`;
      }
    }
    if (costCenterMode === 'total' && !form.cost_center_id) {
      errors.cost_center = 'Selecione um centro de custo para a compra';
    }
    if (costCenterMode === 'per_item') {
      items.forEach((item, idx) => {
        if (!item.cost_center_id) {
          errors[`item_${idx}_cost_center`] = `Item ${idx + 1}: selecione o centro de custo`;
        }
      });
    }
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const errors = validateForm();
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        total_amount: totalAmount,
        freight_amount: freightAmount || 0,
        items: items.map((it, idx) => ({
          ...it,
          cost_center_id: costCenterMode === 'per_item' ? (it.cost_center_id || null) : null,
          freight_allocated: getFreightForItem(idx),
          dre_category_id: (it as Record<string, unknown>).dre_category_id || null,
          catalog_id: (it as Record<string, unknown>).catalog_id || null,
        })),
        cost_center_id: costCenterMode === 'total' ? (form.cost_center_id || null) : null,
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

      await onSubmit(payload);
    } catch (err: any) {
      setSubmitError(err?.message || 'Erro ao salvar compra. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-2">
      <div className="bg-white rounded-2xl w-full max-w-3xl flex flex-col" style={{ maxHeight: 'calc(100vh - 16px)' }}>
        <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-zinc-900">Nova Compra</h3>
            {Object.keys(validationErrors).length > 0 && (
              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <i className="ri-error-warning-line" />
                {Object.keys(validationErrors).length} erro{Object.keys(validationErrors).length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-3">
          {/* Erro de envio */}
          {submitError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
              <i className="ri-error-warning-line text-red-500 mt-0.5" />
              <p className="text-xs text-red-700">{submitError}</p>
            </div>
          )}
          {/* Resumo de erros */}
          {Object.keys(validationErrors).length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-1.5">
              <p className="text-xs font-bold text-red-800 flex items-center gap-1.5">
                <i className="ri-error-warning-line" />
                Corrija os campos abaixo antes de salvar:
              </p>
              <ul className="text-xs text-red-700 space-y-0.5">
                {Object.entries(validationErrors).map(([key, msg]) => (
                  <li key={key} className="flex items-center gap-1">
                    <i className="ri-arrow-right-s-line text-red-500" />
                    {msg}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Linha 1: Fornecedor + NF + Data + Pagamento */}
          <div className="grid grid-cols-4 gap-2">
            <div className="col-span-2">
              <label className="text-xs font-semibold text-zinc-600 block mb-1">Fornecedor *</label>
              <input
                required value={form.supplier}
                onChange={(e) => { setForm((f) => ({ ...f, supplier: e.target.value })); setValidationErrors(prev => { const n = {...prev}; delete n.supplier; return n; }); }}
                list="suppliers-list"
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${validationErrors.supplier ? 'border-red-400 bg-red-50/30' : 'border-zinc-200'}`}
                placeholder="Nome do fornecedor"
              />
              {validationErrors.supplier && <p className="text-xs text-red-600 mt-0.5 flex items-center gap-1"><i className="ri-error-warning-line" />{validationErrors.supplier}</p>}
              <datalist id="suppliers-list">
                {suppliers.map((s) => <option key={s} value={s} />)}
              </datalist>
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
              <input required type="date" value={form.purchase_date}
                onChange={(e) => { setForm((f) => ({ ...f, purchase_date: e.target.value })); setValidationErrors(prev => { const n = {...prev}; delete n.purchase_date; return n; }); }}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${validationErrors.purchase_date ? 'border-red-400 bg-red-50/30' : 'border-zinc-200'}`} />
              {validationErrors.purchase_date && <p className="text-xs text-red-600 mt-0.5 flex items-center gap-1"><i className="ri-error-warning-line" />{validationErrors.purchase_date}</p>}
            </div>
          </div>

          {/* Linha 2: Forma de Pagamento + Condição */}
          <div className="grid grid-cols-4 gap-2 items-end">
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">Forma de Pagamento</label>
              <select value={form.payment_method} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="col-span-3">
              <label className="text-xs font-semibold text-zinc-600 block mb-1">Condição de Pagamento</label>
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
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 cursor-pointer transition-all ${
                    paymentMode === opt.key ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 bg-white hover:border-zinc-300'
                  }`}
                >
                  <i className={`${opt.icon} text-base ${paymentMode === opt.key ? 'text-amber-500' : 'text-zinc-400'}`} />
                  <div className="text-left">
                    <p className={`text-xs font-bold leading-tight ${paymentMode === opt.key ? 'text-amber-700' : 'text-zinc-600'}`}>{opt.label}</p>
                    <p className="text-[10px] text-zinc-400 leading-tight">{opt.desc}</p>
                  </div>
                </button>
              ))}
              </div>
            </div>
          </div>

          {/* A Prazo */}
          {paymentMode === 'aprazo' && (
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">
                Data de Vencimento
                <span className="text-zinc-400 font-normal ml-1">(obrigatório)</span>
              </label>
              <input type="date" value={firstDueDate}
                onChange={(e) => { setFirstDueDate(e.target.value); setValidationErrors(prev => { const n = {...prev}; delete n.due_date; return n; }); }}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${validationErrors.due_date ? 'border-red-400 bg-red-50/30' : 'border-zinc-200'}`} />
              {validationErrors.due_date && <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><i className="ri-error-warning-line" />{validationErrors.due_date}</p>}
            </div>
          )}

          {/* Parcelado */}
          {paymentMode === 'parcelado' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-semibold text-zinc-700 flex items-center gap-1.5">
                  <i className="ri-calendar-schedule-line text-amber-500" />
                  {customInstallments.length} parcela{customInstallments.length !== 1 ? 's' : ''}
                  {totalAmount > 0 && (
                    <span className="text-zinc-400 font-normal">· total: {formatCurrency(totalAmount)}</span>
                  )}
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
                      customInstallments.length === n
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'border-zinc-200 text-zinc-600 hover:border-amber-300 hover:text-amber-600'
                    }`}>
                    {n}x
                  </button>
                ))}
              </div>

              {customInstallments[0]?.due_date && customInstallments.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-zinc-400">Replicar intervalo:</span>
                  {[{ label: 'Semanal (7d)', days: 7 }, { label: 'Quinzenal (15d)', days: 15 }, { label: 'Mensal (30d)', days: 30 }].map((s) => (
                    <button key={s.days} type="button" onClick={() => aplicarIntervalo(s.days)}
                      className="text-xs px-2.5 py-1 rounded-full border border-zinc-200 text-zinc-600 hover:border-amber-300 hover:text-amber-600 cursor-pointer whitespace-nowrap">
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                <div className="grid grid-cols-12 gap-2 px-1">
                  <span className="col-span-1 text-xs text-zinc-400 font-semibold text-center">#</span>
                  <span className="col-span-5 text-xs text-zinc-400 font-semibold">Data de Vencimento</span>
                  <span className="col-span-5 text-xs text-zinc-400 font-semibold">Valor (R$)</span>
                  <span className="col-span-1" />
                </div>
                {customInstallments.map((inst, idx) => (
                  <div key={inst.tempId} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-1 flex justify-center">
                      <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {idx + 1}
                      </span>
                    </div>
                    <div className="col-span-5">
                      <input type="date" required value={inst.due_date}
                        onChange={(e) => updateInstallment(inst.tempId, 'due_date', e.target.value)}
                        className={`w-full border rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${inst.due_date ? 'border-zinc-200' : 'border-amber-300 bg-amber-50/50'}`} />
                    </div>
                    <div className="col-span-5">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400 font-semibold">R$</span>
                        <input type="number" step="0.01" min="0.01" required value={inst.amount || ''}
                          onChange={(e) => updateInstallment(inst.tempId, 'amount', Number(e.target.value))}
                          placeholder="0,00"
                          className={`w-full border rounded-lg pl-8 pr-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${Number(inst.amount) > 0 ? 'border-zinc-200' : 'border-amber-300 bg-amber-50/50'}`} />
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

          {/* ─── Frete ─── */}
          <div className="border border-zinc-100 rounded-xl p-4 space-y-3 bg-zinc-50/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 flex items-center justify-center">
                  <i className="ri-truck-line text-amber-500 text-base" />
                </div>
                <span className="text-xs font-semibold text-zinc-700">Frete</span>
                {freightAmount > 0 && (
                  <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                    {formatCurrency(freightAmount)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {freightAmount > 0 && (
                  <div className="flex bg-zinc-100 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => setFreightMode('auto')}
                      className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer transition-all whitespace-nowrap ${
                        freightMode === 'auto' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                      }`}
                    >
                      <i className="ri-magic-line mr-1" />Automático
                    </button>
                    <button
                      type="button"
                      onClick={() => setFreightMode('manual')}
                      className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer transition-all whitespace-nowrap ${
                        freightMode === 'manual' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                      }`}
                    >
                      <i className="ri-edit-line mr-1" />Manual
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-[200px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 font-semibold">R$</span>
                <input
                  type="number" step="0.01" min="0" placeholder="0,00"
                  value={freightAmount || ''}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 0;
                    setFreightAmount(val);
                    if (freightMode === 'manual') setFreightPerItem({});
                  }}
                  className="w-full border border-zinc-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>
              {freightAmount === 0 && (
                <p className="text-xs text-zinc-400">Sem frete — deixe em branco ou zero</p>
              )}
              {freightAmount > 0 && freightMode === 'auto' && (
                <p className="text-xs text-zinc-500 flex items-center gap-1">
                  <i className="ri-information-line text-amber-500" />
                  Dividido proporcionalmente ao valor de cada item
                </p>
              )}
            </div>

            {/* Tabela de rateio manual */}
            {freightAmount > 0 && freightMode === 'manual' && items.length > 0 && (
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 px-1">
                  <span className="col-span-5 text-[10px] text-zinc-400 font-semibold">Item</span>
                  <span className="col-span-4 text-[10px] text-zinc-400 font-semibold">Frete (R$)</span>
                  <span className="col-span-3 text-[10px] text-zinc-400 font-semibold text-right">% do total</span>
                </div>
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <p className="text-xs text-zinc-700 truncate">
                        {item.description || `Item ${idx + 1}`}
                      </p>
                      <p className="text-[10px] text-zinc-400">{formatCurrency(Number(item.total_price ?? 0))}</p>
                    </div>
                    <div className="col-span-4">
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400">R$</span>
                        <input
                          type="number" step="0.01" min="0"
                          value={freightPerItem[idx] ?? ''}
                          onChange={(e) => setFreightPerItem((prev) => ({ ...prev, [idx]: Number(e.target.value) || 0 }))}
                          placeholder="0,00"
                          className="w-full border border-zinc-200 rounded-lg pl-6 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        />
                      </div>
                    </div>
                    <div className="col-span-3 text-right">
                      <span className="text-xs text-zinc-500">
                        {freightAmount > 0 ? `${(((freightPerItem[idx] ?? 0) / freightAmount) * 100).toFixed(1)}%` : '—'}
                      </span>
                    </div>
                  </div>
                ))}
                <div className={`rounded-lg p-2 border text-xs flex items-center justify-between ${
                  freightManualDiff < 0.01
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-amber-50 border-amber-200 text-amber-700'
                }`}>
                  <span className="flex items-center gap-1">
                    <i className={freightManualDiff < 0.01 ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} />
                    Total rateado: {formatCurrency(freightManualTotal)}
                  </span>
                  {freightManualDiff >= 0.01 && (
                    <span className="font-bold">
                      {freightManualTotal < freightAmount
                        ? `Faltam ${formatCurrency(freightManualDiff)}`
                        : `Excede ${formatCurrency(freightManualDiff)}`}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Centro de Custo + Conta bancária + Obs em linha */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-600">Centro de Custo</label>
              <div className="flex bg-zinc-100 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setCostCenterMode('total')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer transition-all whitespace-nowrap ${costCenterMode === 'total' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                >
                  Pela compra
                </button>
                <button
                  type="button"
                  onClick={() => setCostCenterMode('per_item')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer transition-all whitespace-nowrap ${costCenterMode === 'per_item' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                >
                  Por item
                </button>
              </div>
            </div>

            {costCenterMode === 'total' && (
              <select value={form.cost_center_id} onChange={(e) => setForm((f) => ({ ...f, cost_center_id: e.target.value }))}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="">Nenhum</option>
                {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {costCenterMode === 'per_item' && (
              <p className="text-[10px] text-zinc-400 flex items-center gap-1 mt-1">
                <i className="ri-information-line" />
                Defina por item abaixo
              </p>
            )}
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">
                {paymentMode === 'avista' ? 'Débitar da Conta' : 'Conta de Pagamento'}
              </label>
              <select value={form.bank_account_id} onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="">Não especificado</option>
                {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">Observações</label>
              <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="Obs. internas" />
            </div>
          </div>

          {/* ─── Itens da compra ─── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-semibold text-zinc-600">Itens da Compra</label>
              <button type="button" onClick={addItem}
                className="text-xs text-amber-600 hover:text-amber-700 cursor-pointer font-semibold flex items-center gap-1">
                <i className="ri-add-line" /> Adicionar item
              </button>
            </div>

            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {items.map((item, idx) => {
                const selectedUnified = allItems.find(
                  (u) => u.id === item.ingredient_id || u.id === (item as Record<string, unknown>).catalog_id
                );
                const filteredUnified = allItems.filter((u) =>
                  u.name.toLowerCase().includes((itemSearch[idx] ?? '').toLowerCase())
                );
                const catalogFiltered = filteredUnified.filter((u) => u.type === 'catalog');
                const ingredientFiltered = filteredUnified.filter((u) => u.type === 'ingredient');

                return (
                <div key={idx} className="border border-zinc-100 rounded-xl p-3 space-y-2.5 bg-zinc-50/50">
                  {/* Linha 1: Item (unificado) + Descrição */}
                  <div className="grid grid-cols-2 gap-2">
                    <div ref={(el) => { itemDropdownRefs.current[idx] = el; }} className="relative">
                      <label className="text-[10px] font-semibold text-zinc-500 block mb-1">
                        Item
                        {selectedUnified && (
                          <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                            selectedUnified.type === 'catalog'
                              ? 'bg-violet-100 text-violet-700'
                              : 'bg-orange-100 text-orange-700'
                          }`}>
                            {selectedUnified.type === 'catalog'
                              ? (selectedUnified.dre_category_name ?? 'CMV')
                              : 'CMV'}
                          </span>
                        )}
                      </label>
                      <input
                        value={itemSearch[idx] ?? (item.description ?? '')}
                        onChange={(e) => {
                          setItemSearch((prev) => ({ ...prev, [idx]: e.target.value }));
                          updateItem(idx, 'description', e.target.value);
                          setItemDropdownOpen((prev) => ({ ...prev, [idx]: true }));
                        }}
                        onFocus={() => {
                          setItemSearch((prev) => ({ ...prev, [idx]: item.description ?? '' }));
                          setItemDropdownOpen((prev) => ({ ...prev, [idx]: true }));
                          onLoadIngredients();
                        }}
                        placeholder="Buscar ou digitar item..."
                        className="w-full border border-zinc-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                      />
                      {itemDropdownOpen[idx] && (catalogFiltered.length > 0 || ingredientFiltered.length > 0) && (
                        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                          {catalogFiltered.length > 0 && (
                            <>
                              <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wide bg-zinc-50 border-b border-zinc-100">
                                <i className="ri-archive-line mr-1" />Catálogo de Compras
                              </div>
                              {catalogFiltered.map((u) => (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => selectUnifiedItem(idx, u)}
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-amber-50 cursor-pointer flex items-center justify-between gap-2"
                                >
                                  <div>
                                    <p className="font-semibold text-zinc-800">{u.name}</p>
                                    {u.default_supplier && (
                                      <p className="text-[10px] text-zinc-400">{u.default_supplier}</p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <span className="text-[9px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">{u.unit}</span>
                                    <span className="text-[9px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full font-semibold">
                                      {u.dre_category_name ?? 'CMV'}
                                    </span>
                                  </div>
                                </button>
                              ))}
                            </>
                          )}
                          {ingredientFiltered.length > 0 && (
                            <>
                              <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wide bg-zinc-50 border-b border-zinc-100">
                                <i className="ri-leaf-line mr-1" />Insumos (CMV)
                              </div>
                              {ingredientFiltered.map((u) => (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => selectUnifiedItem(idx, u)}
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-amber-50 cursor-pointer flex items-center justify-between gap-2"
                                >
                                  <p className="font-semibold text-zinc-800">{u.name}</p>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <span className="text-[9px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">{u.unit}</span>
                                    <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-semibold">CMV</span>
                                  </div>
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-500 block mb-1">Descrição / Detalhe</label>
                      <input placeholder="Ex: Coca-Cola 2L fardo" value={item.description ?? ''}
                        onChange={(e) => updateItem(idx, 'description', e.target.value)}
                        className="w-full border border-zinc-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                    </div>
                  </div>

                  {/* Linha 2: Qtd + Unidade + Unid/embalagem + Preço unit */}
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-500 block mb-1">Quantidade</label>
                      <input type="number" min="0.001" step="0.001" placeholder="1"
                        value={item.quantity ?? ''}
                        onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                        className="w-full border border-zinc-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-500 block mb-1">Unidade</label>
                      <select value={item.unit_label ?? 'un'}
                        onChange={(e) => updateItem(idx, 'unit_label', e.target.value)}
                        className="w-full border border-zinc-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
                        {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-500 block mb-1 whitespace-nowrap">
                        Unid./embalagem
                      </label>
                      <input type="number" min="1" step="1" placeholder="—"
                        value={item.units_per_package ?? ''}
                        onChange={(e) => updateItem(idx, 'units_per_package', e.target.value ? Number(e.target.value) : undefined)}
                        className="w-full border border-zinc-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-500 block mb-1">Preço unit.</label>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400 font-semibold">R$</span>
                        <input type="number" step="0.01" min="0" placeholder="0,00"
                          value={item.unit_price ?? ''}
                          onChange={(e) => updateItem(idx, 'unit_price', Number(e.target.value))}
                          className="w-full border border-zinc-200 rounded-lg pl-6 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                      </div>
                    </div>
                  </div>
                  {costCenterMode === 'per_item' && (
                    <div>
                      <label className="text-[10px] font-semibold text-zinc-500 block mb-1">Centro de Custo</label>
                      <select value={item.cost_center_id ?? ''} onChange={(e) => updateItem(idx, 'cost_center_id', e.target.value)}
                        className="w-full border border-zinc-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
                        <option value="">Nenhum</option>
                        {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  )}
                  {/* Linha 3: Info + total + delete */}
                  <div className="flex items-center gap-2">
                    <div className={`${costCenterMode === 'per_item' ? '' : 'ml-auto'} flex items-center gap-3`}>
                      {/* Info embalagem + custo real */}
                      <div className="flex flex-col gap-0.5">
                        {item.units_per_package && Number(item.units_per_package) > 1 && (
                          <div className="text-[10px] text-zinc-400 whitespace-nowrap">
                            {Number(item.quantity ?? 1)} {item.unit_label ?? 'un'} × {item.units_per_package} unid.
                            <span className="font-semibold text-zinc-600 ml-1">
                              = {Number(item.quantity ?? 1) * Number(item.units_per_package)} unid. total
                            </span>
                          </div>
                        )}
                        {Number(item.unit_price ?? 0) > 0 && (
                          <div className="text-[10px] whitespace-nowrap">
                            {freightAmount > 0 ? (
                              <>
                                <span className="text-zinc-400">Custo unit. s/ frete: </span>
                                <span className="text-zinc-600 font-semibold">
                                  {formatCurrency(Number(item.unit_price ?? 0) / Math.max(1, Number(item.units_per_package ?? 1)))}
                                </span>
                                <span className="mx-1 text-zinc-300">|</span>
                                <span className="text-amber-600">c/ frete: </span>
                                <span className="text-amber-700 font-bold">
                                  {formatCurrency(realUnitCost(item, idx))}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="text-zinc-400">Custo unit.: </span>
                                <span className="text-zinc-700 font-semibold">
                                  {formatCurrency(Number(item.unit_price ?? 0) / Math.max(1, Number(item.units_per_package ?? 1)))}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <span className="text-sm font-bold text-zinc-800 whitespace-nowrap block">
                            {formatCurrency(Number(item.total_price ?? 0))}
                          </span>
                          {freightAmount > 0 && (
                            <span className="text-[10px] text-amber-600 whitespace-nowrap block">
                              + frete {formatCurrency(getFreightForItem(idx))}
                            </span>
                          )}
                        </div>
                        <button type="button" onClick={() => removeItem(idx)}
                          disabled={items.length === 1}
                          className="w-6 h-6 flex items-center justify-center text-zinc-300 hover:text-red-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
                          <i className="ri-delete-bin-line text-sm" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center mt-3 pt-3 border-t border-zinc-100">
              <span className="text-xs text-zinc-400">{items.length} item{items.length !== 1 ? 's' : ''}</span>
              <div className="text-right">
                {freightAmount > 0 && (
                  <p className="text-xs text-zinc-400">
                    Subtotal: {formatCurrency(subtotalAmount)}
                    <span className="ml-2 text-amber-600">+ Frete: {formatCurrency(freightAmount)}</span>
                  </p>
                )}
                <span className="text-sm font-bold text-zinc-900">Total: {formatCurrency(totalAmount)}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-1 flex-shrink-0">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
              Cancelar
            </button>
            <button type="submit"
              disabled={submitting || !parcelasValidas || (paymentMode === 'parcelado' && totalAmount > 0 && parcelasDiff > 0.01)}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2">
              {submitting ? (
                <>
                  <i className="ri-loader-4-line animate-spin" />
                  Salvando...
                </>
              ) : 'Salvar Compra'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
