import { useState, useMemo, useCallback, useEffect } from 'react';
import { useBillsPayable, useCostCenters, useBankAccounts } from '@/hooks/useFinanceiro';
import { useSuppliers } from '@/hooks/useSuppliers';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { BillPayable, BillStatus } from '@/types/financeiro';
import { formatCurrency } from '@/lib/formatters';
import AgingContasPagar from '@/pages/financeiro/components/AgingContasPagar';
import ContasPagarDREModal from '@/pages/financeiro/components/ContasPagarDREModal';
import ContasPagarDetalheModal from '@/pages/financeiro/components/ContasPagarDetalheModal';

interface Props {
  onNavigateToCompras?: (purchaseId?: string) => void;
}

// ... existing code ...

const STATUS_BADGE: Record<BillStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  partial: 'bg-sky-100 text-sky-700',
};
const STATUS_LABEL: Record<BillStatus, string> = {
  pending: 'Pendente', paid: 'Pago', overdue: 'Vencido', partial: 'Parcial',
};

const MESES_NOMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const PAGE_SIZE = 10;
type SortField = 'description' | 'due_date' | 'amount' | 'status';
type SortDir = 'asc' | 'desc';

interface DRECat { id: string; name: string; group_type: string; parent_id: string | null; }

function exportCSV(bills: BillPayable[]) {
  const headers = ['Descrição', 'Fornecedor', 'Categoria', 'Vencimento', 'Valor', 'Status', 'Despesa Fixa', 'Observações'];
  const rows = bills.map(b => [
    b.description,
    b.supplier ?? '',
    b.category ?? '',
    b.due_date ? new Date(b.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : '',
    b.amount.toFixed(2).replace('.', ','),
    STATUS_LABEL[b.status],
    b.is_recurring ? 'Sim' : 'Não',
    (b.notes ?? '').replace(/\n/g, ' '),
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `contas_pagar_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const emptyForm = {
  description: '', supplier: '', category: 'Outros', amount: '', due_date: '',
  is_recurring: false, notes: '', cost_center_id: '', dre_category_id: '',
  bank_account_id: '',
  recurrence_type: 'fixed_value' as 'fixed_value' | 'variable_value',
  recurrence_day: '1',
  recurrence_end_date: '',
};

export default function ContasPagarTab({ onNavigateToCompras }: Props) {
  const { user } = useAuth();
  const { bills, loading, upsert, pay, remove } = useBillsPayable();
  const { centers } = useCostCenters();
  const { accounts: bankAccounts } = useBankAccounts();
  const { names: supplierNames } = useSuppliers();
  const [dreCats, setDreCats] = useState<DRECat[]>([]);

  // ── Navegação por mês ──────────────────────────────────────────────────────
  const nowDate = new Date();
  const [mesSelecionado, setMesSelecionado] = useState(nowDate.getMonth());
  const [anoSelecionado, setAnoSelecionado] = useState(nowDate.getFullYear());

  const mesAtual = nowDate.getMonth();
  const anoAtual = nowDate.getFullYear();
  const isMesAtual = mesSelecionado === mesAtual && anoSelecionado === anoAtual;

  const irParaMesAnterior = () => {
    if (mesSelecionado === 0) { setMesSelecionado(11); setAnoSelecionado(a => a - 1); }
    else setMesSelecionado(m => m - 1);
    setPage(1);
  };
  const irParaProximoMes = () => {
    if (mesSelecionado === 11) { setMesSelecionado(0); setAnoSelecionado(a => a + 1); }
    else setMesSelecionado(m => m + 1);
    setPage(1);
  };
  const voltarMesAtual = () => {
    setMesSelecionado(mesAtual);
    setAnoSelecionado(anoAtual);
    setPage(1);
  };

  // Prefixo do mês para filtrar por due_date (YYYY-MM)
  const mesPrefix = `${anoSelecionado}-${String(mesSelecionado + 1).padStart(2, '0')}`;

  // Filtrar contas pelo mês selecionado (due_date começa com mesPrefix)
  const billsDoMes = useMemo(
    () => bills.filter(b => b.due_date?.startsWith(mesPrefix)),
    [bills, mesPrefix]
  );

  // ... existing code ...

  const loadDreCats = useCallback(async () => {
    if (!user?.tenantId) return;
    const { data } = await supabase
      .from('fin_dre_categories')
      .select('id, name, group_type, parent_id')
      .eq('tenant_id', user.tenantId)
      .eq('is_active', true)
      .order('group_type').order('sort_order');
    setDreCats(data ?? []);
  }, [user?.tenantId]);

  useEffect(() => { loadDreCats(); }, [loadDreCats]);

  const [agingBucket, setAgingBucket] = useState<string | null>(null);
  const [showAging, setShowAging] = useState(false);
  const [showDREModal, setShowDREModal] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [payModal, setPayModal] = useState<BillPayable | null>(null);
  const [detalheModal, setDetalheModal] = useState<BillPayable | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPaying, setBulkPaying] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllPending = () => {
    const pendingIds = paginated.filter((b) => b.status !== 'paid').map((b) => b.id);
    setSelectedIds(new Set(pendingIds));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkPay = async () => {
    if (selectedIds.size === 0) return;
    setBulkPaying(true);
    const today = new Date().toISOString().split('T')[0];
    for (const id of Array.from(selectedIds)) {
      const bill = billsDoMes.find((b) => b.id === id);
      if (bill && bill.status !== 'paid') {
        await pay(id, today, bill.amount, 'Dinheiro');
      }
    }
    setSelectedIds(new Set());
    setBulkPaying(false);
  };

  const selectedTotal = Array.from(selectedIds).reduce((sum, id) => {
    const b = billsDoMes.find((x) => x.id === id);
    return sum + (b?.amount ?? 0);
  }, 0);
  const [payForm, setPayForm] = useState({ paid_date: new Date().toISOString().split('T')[0], paid_amount: '', payment_method: 'Dinheiro' });

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterRecurring, setFilterRecurring] = useState('all');

  const [sortField, setSortField] = useState<SortField>('due_date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
    setPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <i className="ri-arrow-up-down-line text-zinc-300 ml-1 text-xs" />;
    return <i className={`${sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} text-amber-500 ml-1 text-xs`} />;
  };

  const filtered = useMemo(() => {
    // Quando há filtro de aging, aplica sobre TODAS as contas (não só do mês)
    let result = agingBucket ? [...bills.filter(b => b.status !== 'paid')] : [...billsDoMes];

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(b =>
        b.description.toLowerCase().includes(q) ||
        (b.supplier || '').toLowerCase().includes(q) ||
        (b.category || '').toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all') result = result.filter(b => b.status === filterStatus);
    if (filterCategory !== 'all') result = result.filter(b => b.category === filterCategory);
    if (filterDateFrom) result = result.filter(b => b.due_date >= filterDateFrom);
    if (filterDateTo) result = result.filter(b => b.due_date <= filterDateTo);
    if (filterRecurring === 'recurring') result = result.filter(b => b.is_recurring);
    if (filterRecurring === 'fixed') result = result.filter(b => !b.is_recurring);

    // Filtro por bucket de aging
    if (agingBucket) {
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      const BUCKET_RANGES: Record<string, [number, number]> = {
        'A vencer': [-9999, -1],
        'Vence hoje': [0, 0],
        '1–7 dias': [1, 7],
        '8–30 dias': [8, 30],
        '31–60 dias': [31, 60],
        '61–90 dias': [61, 90],
        '+90 dias': [91, 9999],
      };
      const range = BUCKET_RANGES[agingBucket];
      if (range) {
        result = result.filter((b) => {
          if (!b.due_date) return false;
          const due = new Date(b.due_date + 'T00:00:00');
          const days = Math.floor((todayDate.getTime() - due.getTime()) / 86400000);
          return days >= range[0] && days <= range[1];
        });
      }
    }

    result.sort((a, b) => {
      let va: string | number = a[sortField] ?? '';
      let vb: string | number = b[sortField] ?? '';
      if (sortField === 'amount') { va = Number(va); vb = Number(vb); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [billsDoMes, bills, agingBucket, search, filterStatus, filterCategory, filterDateFrom, filterDateTo, filterRecurring, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeFiltersCount = [
    filterStatus !== 'all', filterCategory !== 'all', !!filterDateFrom, !!filterDateTo, filterRecurring !== 'all',
  ].filter(Boolean).length;

  const clearFilters = () => {
    setFilterStatus('all'); setFilterCategory('all');
    setFilterDateFrom(''); setFilterDateTo('');
    setSearch(''); setFilterRecurring('all'); setPage(1);
  };

  // KPIs do mês selecionado
  const totalPendente = billsDoMes.filter(b => b.status !== 'paid').reduce((s, b) => s + b.amount, 0);
  const totalVencido = billsDoMes.filter(b => b.status === 'overdue').reduce((s, b) => s + b.amount, 0);
  const totalPago = billsDoMes.filter(b => b.status === 'paid').reduce((s, b) => s + b.amount, 0);
  const totalRecorrentes = billsDoMes.filter(b => b.is_recurring).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Partial<BillPayable> & Record<string, unknown> = {
      description: form.description,
      supplier: form.supplier,
      category: form.category,
      amount: Number(form.amount),
      due_date: form.due_date,
      is_recurring: form.is_recurring,
      notes: form.notes,
      cost_center_id: form.cost_center_id || undefined,
      dre_category_id: form.dre_category_id || undefined,
      status: 'pending',
    };
    if (form.is_recurring) {
      payload.recurrence_day = Number(form.recurrence_day);
      payload.recurrence_end_date = form.recurrence_end_date || undefined;
    }
    await upsert(payload as Partial<BillPayable>);
    setShowModal(false);
    setForm(emptyForm);
    setPage(1);
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModal) return;
    await pay(payModal.id, payForm.paid_date, Number(payForm.paid_amount), payForm.payment_method);
    setPayModal(null);
  };

  // Lista unificada de fornecedores: cadastrados + os que aparecem nas contas (retrocompatibilidade)
  const allSupplierNames = useMemo(() => {
    const set = new Set<string>(supplierNames);
    bills.forEach((b) => { if (b.supplier) set.add(b.supplier); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [supplierNames, bills]);

  const uniqueCategories = [...new Set(billsDoMes.map(b => b.category).filter(Boolean))];
  const expenseDreCats = dreCats.filter(c => c.group_type === 'expense' || c.group_type === 'cost');

  const today = new Date().toISOString().split('T')[0];
  const in7Days = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
  const vencendoEmBreve = billsDoMes.filter(b =>
    b.status !== 'paid' && b.due_date >= today && b.due_date <= in7Days
  );
  const vencendoHoje = billsDoMes.filter(b => b.status !== 'paid' && b.due_date === today);
  const [showAlertBanner, setShowAlertBanner] = useState(true);
  const [showProvAlertBanner, setShowProvAlertBanner] = useState(true);

  // Compras sem data de vencimento real:
  // Só mostra o banner quando a conta foi gerada com D+1 automático,
  // ou seja, quando a compra original não tinha due_date definido.
  // Identificamos isso verificando se a compra vinculada (reference_id) não tem due_date na fin_purchases.
  // Como não temos acesso direto à fin_purchases aqui, usamos uma heurística mais segura:
  // só mostra se a conta tem reference_type='purchase' E não tem due_date definido (null/undefined)
  // OU se o due_date é exatamente D+1 da data de criação da conta (created_at + 1 dia).
  const contasVencimentoProvisorio = bills.filter(b => {
    if (b.reference_type !== 'purchase' || b.status === 'paid') return false;
    if (!b.due_date) return true;
    // Verifica se o due_date é exatamente D+1 do created_at (indica que foi gerado automaticamente)
    if (b.created_at) {
      const createdDate = new Date(b.created_at);
      createdDate.setHours(0, 0, 0, 0);
      const dueDate = new Date(b.due_date + 'T00:00:00');
      const diffDays = Math.round((dueDate.getTime() - createdDate.getTime()) / 86400000);
      // Se o vencimento é exatamente 1 dia após a criação, é provisório
      return diffDays === 1;
    }
    return false;
  });

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">

      {/* ── Navegação por mês ── */}
      <div className="flex items-center justify-between bg-white border border-zinc-200 rounded-xl px-5 py-3">
        <button
          onClick={irParaMesAnterior}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 hover:bg-zinc-50 cursor-pointer transition-colors text-zinc-500"
        >
          <i className="ri-arrow-left-s-line text-base" />
        </button>

        <div className="flex items-center gap-3">
          <div className="text-center">
            <p className="text-sm font-bold text-zinc-900 capitalize">
              {MESES_NOMES[mesSelecionado]} {anoSelecionado}
            </p>
            <p className="text-xs text-zinc-400">
              {billsDoMes.length} conta{billsDoMes.length !== 1 ? 's' : ''} neste mês
            </p>
          </div>
          {!isMesAtual && (
            <button
              onClick={voltarMesAtual}
              className="text-xs font-semibold px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 cursor-pointer transition-colors whitespace-nowrap"
            >
              Mês atual
            </button>
          )}
        </div>

        <button
          onClick={irParaProximoMes}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 hover:bg-zinc-50 cursor-pointer transition-colors text-zinc-500"
        >
          <i className="ri-arrow-right-s-line text-base" />
        </button>
      </div>

      {/* Banner de alertas de vencimento */}
      {showAlertBanner && (vencendoEmBreve.length > 0 || totalVencido > 0) && (
        <div className={`rounded-xl border p-4 flex items-start gap-3 ${totalVencido > 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className={`w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 ${totalVencido > 0 ? 'bg-red-100' : 'bg-amber-100'}`}>
            <i className={`${totalVencido > 0 ? 'ri-alarm-warning-line text-red-600' : 'ri-time-line text-amber-600'} text-base`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-bold ${totalVencido > 0 ? 'text-red-800' : 'text-amber-800'}`}>
              {totalVencido > 0
                ? `${billsDoMes.filter(b => b.status === 'overdue').length} conta${billsDoMes.filter(b => b.status === 'overdue').length > 1 ? 's' : ''} vencida${billsDoMes.filter(b => b.status === 'overdue').length > 1 ? 's' : ''} — ${formatCurrency(totalVencido)} em aberto`
                : `${vencendoEmBreve.length} conta${vencendoEmBreve.length > 1 ? 's' : ''} vencendo nos próximos 7 dias`}
            </p>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {vencendoHoje.length > 0 && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                  <i className="ri-calendar-close-line mr-1" />
                  {vencendoHoje.length} vence hoje
                </span>
              )}
              {vencendoEmBreve.filter(b => b.due_date !== today).map(b => (
                <span key={b.id} className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                  {b.description} — {new Date(b.due_date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                </span>
              )).slice(0, 4)}
              {vencendoEmBreve.filter(b => b.due_date !== today).length > 4 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500">
                  +{vencendoEmBreve.filter(b => b.due_date !== today).length - 4} mais
                </span>
              )}
            </div>
          </div>
          <button onClick={() => setShowAlertBanner(false)} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-black/10 cursor-pointer flex-shrink-0">
            <i className="ri-close-line text-sm text-zinc-500" />
          </button>
        </div>
      )}

      {/* Banner: compras com vencimento provisório */}
      {showProvAlertBanner && contasVencimentoProvisorio.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg flex-shrink-0">
            <i className="ri-calendar-todo-line text-amber-600 text-base" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-800">
              {contasVencimentoProvisorio.length} compra{contasVencimentoProvisorio.length > 1 ? 's' : ''} com vencimento provisório (D+1)
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Estas contas foram geradas automaticamente sem data de vencimento definida. Defina a data correta para cada uma.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {contasVencimentoProvisorio.slice(0, 3).map(b => (
                <button
                  key={b.id}
                  onClick={() => onNavigateToCompras?.(b.reference_id)}
                  className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 cursor-pointer font-semibold flex items-center gap-1 whitespace-nowrap transition-colors"
                >
                  <i className="ri-shopping-cart-2-line" />
                  {b.supplier || b.description}
                  {onNavigateToCompras && <i className="ri-arrow-right-s-line" />}
                </button>
              ))}
              {contasVencimentoProvisorio.length > 3 && (
                <span className="text-xs px-2 py-1 rounded-full bg-zinc-100 text-zinc-500">
                  +{contasVencimentoProvisorio.length - 3} mais
                </span>
              )}
            </div>
          </div>
          <button onClick={() => setShowProvAlertBanner(false)} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-amber-200 cursor-pointer flex-shrink-0">
            <i className="ri-close-line text-sm text-amber-600" />
          </button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: 'Total Pendente', value: formatCurrency(totalPendente), color: 'text-amber-600', bg: 'bg-amber-50', icon: 'ri-time-line' },
          { label: 'Total Vencido', value: formatCurrency(totalVencido), color: 'text-red-600', bg: 'bg-red-50', icon: 'ri-alarm-warning-line' },
          { label: 'Total Pago', value: formatCurrency(totalPago), color: 'text-green-600', bg: 'bg-green-50', icon: 'ri-checkbox-circle-line' },
          { label: 'Despesas Fixas', value: `${totalRecorrentes} contas`, color: 'text-zinc-700', bg: 'bg-zinc-50', icon: 'ri-repeat-line' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-lg ${k.bg}`}>
              <i className={`${k.icon} ${k.color} text-lg`} />
            </div>
            <div>
              <p className="text-xs text-zinc-500">{k.label}</p>
              <p className={`text-base font-bold ${k.color}`}>{k.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 flex-wrap">
        <div className="relative flex-1 min-w-0">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar por descrição, fornecedor..."
            className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer">
              <i className="ri-close-line text-zinc-400 text-sm" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
            {[['all', 'Todas'], ['pending', 'Pend.'], ['overdue', 'Venc.'], ['paid', 'Pago']].map(([v, l]) => (
              <button key={v} onClick={() => { setFilterStatus(v); setPage(1); }}
                className={`px-2.5 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${filterStatus === v ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
                {l}
              </button>
            ))}
          </div>

          <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
            {[['all', 'Todas'], ['recurring', 'Fixas'], ['fixed', 'Avulsas']].map(([v, l]) => (
              <button key={v} onClick={() => { setFilterRecurring(v); setPage(1); }}
                className={`px-2.5 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${filterRecurring === v ? 'bg-zinc-800 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
                {l}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowFilters(f => !f)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-colors whitespace-nowrap ${showFilters || activeFiltersCount > 0 ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
          >
            <i className="ri-filter-3-line" />
            Filtros {activeFiltersCount > 0 && <span className="bg-amber-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs">{activeFiltersCount}</span>}
          </button>

          <button
            onClick={() => setShowAging(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-colors whitespace-nowrap ${showAging ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
          >
            <i className="ri-bar-chart-grouped-line" /> Aging
          </button>

          {agingBucket && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
              <i className="ri-filter-line text-red-500 text-xs" />
              <span className="text-xs font-semibold text-red-700">{agingBucket}</span>
              <button
                onClick={() => { setAgingBucket(null); setPage(1); }}
                className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-red-200 cursor-pointer"
              >
                <i className="ri-close-line text-red-500 text-xs" />
              </button>
            </div>
          )}

          {activeFiltersCount > 0 && (
            <button onClick={clearFilters} className="text-xs text-zinc-400 hover:text-red-500 cursor-pointer whitespace-nowrap">
              Limpar
            </button>
          )}

          <button onClick={() => exportCSV(filtered)}
            className="hidden sm:flex items-center gap-2 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
            <i className="ri-download-2-line" /> CSV
          </button>

          <button
            onClick={() => setShowDREModal(true)}
            className="flex items-center gap-2 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
            title="Vincular categorias DRE em massa"
          >
            <i className="ri-folder-chart-line text-amber-500" /> DRE
          </button>

          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-3 md:px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
            <i className="ri-add-line" /> <span className="hidden sm:inline">Nova Conta</span><span className="sm:hidden">Nova</span>
          </button>
        </div>
      </div>

      {/* Aging de Contas a Pagar */}
      {showAging && (
        <AgingContasPagar
          bills={bills}
          activeBucket={agingBucket}
          onBucketClick={(label) => {
            setAgingBucket(label);
            setPage(1);
            if (label) setFilterStatus('all');
          }}
        />
      )}

      {/* Advanced filters */}
      {showFilters && (
        <div className="bg-white border border-zinc-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-semibold text-zinc-600 block mb-1">Categoria</label>
            <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setPage(1); }}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
              <option value="all">Todas as categorias</option>
              {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-zinc-600 block mb-1">Vencimento de</label>
            <input type="date" value={filterDateFrom} onChange={e => { setFilterDateFrom(e.target.value); setPage(1); }}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="text-xs font-semibold text-zinc-600 block mb-1">Vencimento até</label>
            <input type="date" value={filterDateTo} onChange={e => { setFilterDateTo(e.target.value); setPage(1); }}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
        </div>
      )}

      {(search || activeFiltersCount > 0) && (
        <p className="text-xs text-zinc-500">
          {filtered.length} resultado{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
          {billsDoMes.length !== filtered.length && ` de ${billsDoMes.length} contas`}
        </p>
      )}

      {/* Barra de seleção múltipla */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-amber-800">
              {selectedIds.size} conta{selectedIds.size > 1 ? 's' : ''} selecionada{selectedIds.size > 1 ? 's' : ''}
            </span>
            <span className="text-sm font-black text-amber-700">{formatCurrency(selectedTotal)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearSelection}
              className="px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
            >
              Cancelar
            </button>
            <button
              onClick={handleBulkPay}
              disabled={bulkPaying}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 cursor-pointer transition-colors whitespace-nowrap"
            >
              {bulkPaying ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <i className="ri-check-double-line" />
              )}
              Marcar {selectedIds.size} como Pago{selectedIds.size > 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* Tabela (desktop) / Cards (mobile) */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="px-4 py-3 w-10">
                  <button
                    onClick={selectAllPending}
                    className="w-5 h-5 flex items-center justify-center rounded border border-zinc-300 hover:border-amber-400 cursor-pointer transition-colors"
                    title="Selecionar todas pendentes"
                  >
                    <i className="ri-checkbox-indeterminate-line text-zinc-400 text-xs" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">
                  <button onClick={() => handleSort('description')} className="flex items-center cursor-pointer hover:text-zinc-800 whitespace-nowrap">
                    Descrição <SortIcon field="description" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 whitespace-nowrap">Fornecedor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 whitespace-nowrap">Categoria</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 whitespace-nowrap">DRE</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">
                  <button onClick={() => handleSort('due_date')} className="flex items-center cursor-pointer hover:text-zinc-800 whitespace-nowrap">
                    Vencimento <SortIcon field="due_date" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">
                  <button onClick={() => handleSort('amount')} className="flex items-center cursor-pointer hover:text-zinc-800 whitespace-nowrap">
                    Valor <SortIcon field="amount" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">
                  <button onClick={() => handleSort('status')} className="flex items-center cursor-pointer hover:text-zinc-800 whitespace-nowrap">
                    Status <SortIcon field="status" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 whitespace-nowrap">Pago em</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 whitespace-nowrap">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10 text-zinc-400 text-sm">Carregando...</td></tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12">
                    <i className="ri-file-search-line text-3xl text-zinc-300 block mb-2" />
                    <p className="text-zinc-400 text-sm">Nenhuma conta em {MESES_NOMES[mesSelecionado]} {anoSelecionado}</p>
                    {(search || activeFiltersCount > 0) && (
                      <button onClick={clearFilters} className="text-xs text-amber-600 mt-1 cursor-pointer hover:underline">Limpar filtros</button>
                    )}
                  </td>
                </tr>
              ) : paginated.map(b => {
                const isOverdue = b.status === 'overdue';
                const daysUntil = b.due_date ? Math.ceil((new Date(b.due_date).getTime() - new Date(today).getTime()) / 86400000) : null;
                return (
                  <tr key={b.id} className={`hover:bg-zinc-50 transition-colors ${isOverdue ? 'bg-red-50/30' : ''} ${selectedIds.has(b.id) ? 'bg-amber-50/60' : ''}`}>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {b.status !== 'paid' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleSelect(b.id); }}
                          className={`w-5 h-5 flex items-center justify-center rounded border cursor-pointer transition-colors ${selectedIds.has(b.id) ? 'bg-amber-500 border-amber-500' : 'border-zinc-300 hover:border-amber-400'}`}
                        >
                          {selectedIds.has(b.id) && <i className="ri-check-line text-white text-xs" />}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-800">{b.description}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {b.is_recurring && (
                          <span className="text-xs text-amber-600 flex items-center gap-1">
                            <i className="ri-repeat-line" /> Despesa Fixa
                          </span>
                        )}
                        {b.reference_type === 'purchase' && (
                          <span className="inline-flex items-center gap-1 flex-wrap">
                            <span className="relative group inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 cursor-default">
                              <i className="ri-shopping-cart-2-line text-xs" />
                              Compra
                              <span className="absolute bottom-full left-0 mb-1.5 hidden group-hover:block z-20 w-60 bg-zinc-900 text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-lg">
                                <i className="ri-information-line mr-1 text-indigo-300" />
                                Gerado automaticamente da compra
                                {b.supplier ? ` de ${b.supplier}` : ''}
                                {b.due_date ? ` com vencimento em ${new Date(b.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}
                              </span>
                            </span>
                            {onNavigateToCompras && b.reference_id && (
                              <button
                                onClick={() => onNavigateToCompras(b.reference_id)}
                                className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-300 hover:bg-indigo-200 cursor-pointer transition-colors whitespace-nowrap"
                              >
                                <i className="ri-external-link-line text-xs" />
                                Ver Compra
                              </button>
                            )}
                            {b.delivery_confirmed && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                                <i className="ri-truck-line text-xs" />
                                Mercadoria Recebida
                              </span>
                            )}
                          </span>
                        )}
                        {b.reference_type === 'hr_payroll' && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                            <i className="ri-team-line text-xs" />
                            Folha
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">{b.supplier || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">{b.category}</span>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const dreId = (b as BillPayable & { dre_category_id?: string }).dre_category_id;
                        const dreCat = dreId ? dreCats.find(c => c.id === dreId) : null;
                        return dreCat ? (
                          <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit whitespace-nowrap">
                            <i className="ri-folder-chart-line text-xs" />
                            {dreCat.name}
                          </span>
                        ) : (
                          <button
                            onClick={() => setShowDREModal(true)}
                            className="text-xs text-zinc-400 hover:text-amber-600 cursor-pointer flex items-center gap-1 whitespace-nowrap transition-colors"
                            title="Vincular ao DRE"
                          >
                            <i className="ri-add-circle-line" /> Vincular
                          </button>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-700 text-sm">{b.due_date ? new Date(b.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</p>
                      {daysUntil !== null && b.status !== 'paid' && (
                        <p className={`text-xs mt-0.5 ${daysUntil < 0 ? 'text-red-500' : daysUntil <= 3 ? 'text-amber-500' : 'text-zinc-400'}`}>
                          {daysUntil < 0 ? `${Math.abs(daysUntil)}d em atraso` : daysUntil === 0 ? 'Vence hoje' : `em ${daysUntil}d`}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-zinc-800">
                      {formatCurrency(b.amount)}
                      {b.is_recurring && <p className="text-xs text-zinc-400 font-normal">valor variável</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_BADGE[b.status]}`}>
                        {STATUS_LABEL[b.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {b.paid_date ? (
                        <div className="flex items-center gap-1">
                          <i className="ri-calendar-check-line text-green-500 text-xs" />
                          <span className="text-xs text-zinc-600">
                            {new Date(b.paid_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        {b.status !== 'paid' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setPayModal(b); setPayForm(f => ({ ...f, paid_amount: String(b.amount) })); }}
                            className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-1 rounded-lg cursor-pointer hover:bg-green-200 whitespace-nowrap"
                          >
                            <i className="ri-check-line" /> Pagar
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); remove(b.id); }}
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer"
                        >
                          <i className="ri-delete-bin-line text-xs" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden">
          {loading ? (
            <div className="p-4 text-center text-zinc-400 text-sm">Carregando...</div>
          ) : paginated.length === 0 ? (
            <div className="p-8 text-center">
              <i className="ri-file-search-line text-3xl text-zinc-300 block mb-2" />
              <p className="text-zinc-400 text-sm">Nenhuma conta em {MESES_NOMES[mesSelecionado]} {anoSelecionado}</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {paginated.map(b => {
                const isOverdue = b.status === 'overdue';
                const daysUntil = b.due_date ? Math.ceil((new Date(b.due_date).getTime() - new Date(today).getTime()) / 86400000) : null;
                return (
                  <div
                    key={b.id}
                    onClick={() => setDetalheModal(b)}
                    className={`p-4 cursor-pointer ${isOverdue ? 'bg-red-50/30' : ''} ${selectedIds.has(b.id) ? 'bg-amber-50/60' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        {b.status !== 'paid' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleSelect(b.id); }}
                            className={`w-5 h-5 flex items-center justify-center rounded border cursor-pointer transition-colors flex-shrink-0 mt-0.5 ${selectedIds.has(b.id) ? 'bg-amber-500 border-amber-500' : 'border-zinc-300'}`}
                          >
                            {selectedIds.has(b.id) && <i className="ri-check-line text-white text-xs" />}
                          </button>
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-zinc-800 text-sm leading-tight">{b.description}</p>
                          {b.supplier && <p className="text-xs text-zinc-400 mt-0.5">{b.supplier}</p>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-zinc-900 text-sm">{formatCurrency(b.amount)}</p>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[b.status]}`}>
                          {STATUS_LABEL[b.status]}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full">{b.category}</span>
                        {b.status === 'paid' && b.paid_date ? (
                          <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                            <i className="ri-calendar-check-line" />
                            Pago em {new Date(b.paid_date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                          </span>
                        ) : b.due_date ? (
                          <span className={`text-xs ${daysUntil !== null && daysUntil < 0 ? 'text-red-500 font-semibold' : daysUntil !== null && daysUntil <= 3 ? 'text-amber-500' : 'text-zinc-400'}`}>
                            <i className="ri-calendar-line mr-0.5" />
                            {new Date(b.due_date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                            {daysUntil !== null && b.status !== 'paid' && (
                              <span className="ml-1">
                                {daysUntil < 0 ? `(${Math.abs(daysUntil)}d atraso)` : daysUntil === 0 ? '(hoje)' : ''}
                              </span>
                            )}
                          </span>
                        ) : null}
                        {b.is_recurring && <span className="text-xs text-amber-600"><i className="ri-repeat-line" /></span>}
                      </div>
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {b.status !== 'paid' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setPayModal(b); setPayForm(f => ({ ...f, paid_amount: String(b.amount) })); }}
                            className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2.5 py-1.5 rounded-lg cursor-pointer hover:bg-green-200 whitespace-nowrap font-semibold"
                          >
                            <i className="ri-check-line" /> Pagar
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); remove(b.id); }}
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer"
                        >
                          <i className="ri-delete-bin-line text-xs" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-100 bg-zinc-50">
            <p className="text-xs text-zinc-500">
              Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-white disabled:opacity-40 cursor-pointer">
                <i className="ri-arrow-left-s-line text-sm" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = totalPages <= 5 ? i + 1 : page <= 3 ? i + 1 : page >= totalPages - 2 ? totalPages - 4 + i : page - 2 + i;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-semibold cursor-pointer ${page === p ? 'bg-amber-500 text-white' : 'border border-zinc-200 text-zinc-600 hover:bg-white'}`}>
                    {p}
                  </button>
                );
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-white disabled:opacity-40 cursor-pointer">
                <i className="ri-arrow-right-s-line text-sm" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal DRE em massa */}
      {showDREModal && (
        <ContasPagarDREModal
          bills={bills}
          onClose={() => setShowDREModal(false)}
          onSaved={() => { setShowDREModal(false); }}
        />
      )}

      {/* Modal Nova Conta */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
              <h3 className="font-semibold text-zinc-900">Nova Conta a Pagar</h3>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
                <i className="ri-close-line text-zinc-500" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Descrição *</label>
                <input required value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Ex: Conta de energia, Aluguel, Folha..."
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Fornecedor</label>
                  <input
                    value={form.supplier}
                    onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))}
                    list="cp-suppliers-list"
                    placeholder="Selecionar ou digitar..."
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <datalist id="cp-suppliers-list">
                    {allSupplierNames.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Categoria</label>
                  <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    list="cat-list"
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  <datalist id="cat-list">
                    {uniqueCategories.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>

              {expenseDreCats.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">
                    Categoria DRE
                    <span className="text-zinc-400 font-normal ml-1">(vincula ao DRE automaticamente)</span>
                  </label>
                  <select value={form.dre_category_id} onChange={e => setForm(f => ({ ...f, dre_category_id: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                    <option value="">Não vincular ao DRE</option>
                    {expenseDreCats.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.parent_id ? '  └ ' : ''}{c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Valor *</label>
                  <input required type="number" step="0.01" min="0" value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Vencimento *</label>
                  <input required type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Centro de Custo</label>
                  <select value={form.cost_center_id} onChange={e => setForm(f => ({ ...f, cost_center_id: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                    <option value="">Nenhum</option>
                    {centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Débitar da Conta</label>
                  <select value={form.bank_account_id} onChange={e => setForm(f => ({ ...f, bank_account_id: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                    <option value="">Não especificado</option>
                    {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="border border-zinc-200 rounded-xl p-4 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_recurring}
                    onChange={e => setForm(f => ({ ...f, is_recurring: e.target.checked }))}
                    className="rounded accent-amber-500" />
                  <div>
                    <span className="text-sm font-semibold text-zinc-800">Despesa Fixa (Recorrente)</span>
                    <p className="text-xs text-zinc-400">Acontece todo mês — ex: aluguel, energia, folha</p>
                  </div>
                </label>

                {form.is_recurring && (
                  <div className="space-y-3 pt-2 border-t border-zinc-100">
                    <div>
                      <label className="text-xs font-semibold text-zinc-600 block mb-2">Tipo de valor</label>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setForm(f => ({ ...f, recurrence_type: 'fixed_value' }))}
                          className={`flex-1 py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${form.recurrence_type === 'fixed_value' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}>
                          <i className="ri-lock-line mr-1" /> Valor Fixo
                        </button>
                        <button type="button" onClick={() => setForm(f => ({ ...f, recurrence_type: 'variable_value' }))}
                          className={`flex-1 py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${form.recurrence_type === 'variable_value' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}>
                          <i className="ri-scales-line mr-1" /> Valor Variável
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-zinc-600 block mb-1">Dia de vencimento</label>
                        <input type="number" min="1" max="31" value={form.recurrence_day}
                          onChange={e => setForm(f => ({ ...f, recurrence_day: e.target.value }))}
                          className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-zinc-600 block mb-1">Encerrar em (opcional)</label>
                        <input type="date" value={form.recurrence_end_date}
                          onChange={e => setForm(f => ({ ...f, recurrence_end_date: e.target.value }))}
                          className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Observações</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} maxLength={500}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">Cancelar</button>
                <button type="submit"
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap">Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Detalhes */}
      {detalheModal && (
        <ContasPagarDetalheModal
          bill={detalheModal}
          onClose={() => setDetalheModal(null)}
          onPay={() => { setPayModal(detalheModal); setPayForm(f => ({ ...f, paid_amount: String(detalheModal.amount) })); }}
          onNavigateToCompras={onNavigateToCompras}
        />
      )}

      {/* Modal Pagar */}
      {payModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
              <h3 className="font-semibold text-zinc-900">Confirmar Pagamento</h3>
              <button onClick={() => setPayModal(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
                <i className="ri-close-line text-zinc-500" />
              </button>
            </div>
            <form onSubmit={handlePay} className="p-6 space-y-4">
              <div className="bg-zinc-50 rounded-xl p-3">
                <p className="text-sm font-medium text-zinc-800">{payModal.description}</p>
                <p className="text-xs text-zinc-500 mt-1">Valor original: {formatCurrency(payModal.amount)}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Valor Pago</label>
                <input type="number" step="0.01" value={payForm.paid_amount}
                  onChange={e => setPayForm(f => ({ ...f, paid_amount: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Data do Pagamento</label>
                <input type="date" value={payForm.paid_date} onChange={e => setPayForm(f => ({ ...f, paid_date: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Forma de Pagamento</label>
                <select value={payForm.payment_method} onChange={e => setPayForm(f => ({ ...f, payment_method: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                  {['Dinheiro', 'PIX', 'Cartão Débito', 'Cartão Crédito', 'Transferência', 'Boleto'].map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setPayModal(null)}
                  className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">Cancelar</button>
                <button type="submit"
                  className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap">Confirmar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
