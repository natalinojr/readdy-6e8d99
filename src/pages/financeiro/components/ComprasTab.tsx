import { useState, useMemo, useEffect, useRef } from 'react';
import { usePurchases, useCostCenters, useBankAccounts } from '@/hooks/useFinanceiro';
import { useSuppliers } from '@/hooks/useSuppliers';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import { formatCurrency } from '@/lib/formatters';
import type { Purchase } from '@/types/financeiro';
import ComprasRelatorioPanel from './ComprasRelatorioPanel';
import ComprasCentroCustoPanel from './compras/ComprasCentroCustoPanel';
import DetalhePurchaseModal from './compras/DetalhePurchaseModal';
import NovaCompraModal from './compras/NovaCompraModal';
import CatalogoComprasModal from './compras/CatalogoComprasModal';

interface BillInstallment {
  id: string;
  installment_number: number;
  installments: number;
  amount: number;
  due_date: string;
  status: string;
  paid_date?: string;
  paid_amount?: number;
}

const STATUS_BADGE: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  partial: 'bg-sky-100 text-sky-700',
};
const STATUS_LABEL: Record<string, string> = {
  paid: 'Pago', pending: 'A Pagar', partial: 'Parcelado',
};
const PAYMENT_METHODS = ['Dinheiro', 'PIX', 'Cartão Débito', 'Cartão Crédito', 'Boleto', 'Transferência'];
const PAGE_SIZE = 10;

type SortField = 'purchase_date' | 'supplier' | 'total_amount' | 'payment_status';
type SortDir = 'asc' | 'desc';

interface ComprasTabProps {
  highlightId?: string;
  onHighlightConsumed?: () => void;
}

export default function ComprasTab({ highlightId, onHighlightConsumed }: ComprasTabProps) {
  const { user } = useAuth();
  const { purchases, loading, create, refresh: refreshPurchases } = usePurchases();
  const { registrarEvento } = useAuditoria();
  const { centers } = useCostCenters();
  const { accounts: bankAccounts } = useBankAccounts();
  const { names: supplierNames } = useSuppliers();

  const [activeView, setActiveView] = useState<'lista' | 'relatorio' | 'centrocusto'>('lista');
  const [showModal, setShowModal] = useState(false);
  const [showCatalogo, setShowCatalogo] = useState(false);
  const [detailPurchase, setDetailPurchase] = useState<Purchase | null>(null);
  const [detailInstallments, setDetailInstallments] = useState<BillInstallment[]>([]);
  const [loadingInstallments, setLoadingInstallments] = useState(false);
  const [ingredients, setIngredients] = useState<{ id: string; name: string; unit: string }[]>([]);
  const [flashId, setFlashId] = useState<string | undefined>(highlightId);
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Quando recebe um highlightId, ativa o flash e rola até a linha
  // Depois de consumir, avisa o pai para limpar (evita re-highlight ao voltar para a aba)
  useEffect(() => {
    if (!highlightId || loading) return;
    setFlashId(highlightId);
    const timer = setTimeout(() => {
      setFlashId(undefined);
      onHighlightConsumed?.();
    }, 3000);
    return () => clearTimeout(timer);
  }, [highlightId, loading, onHighlightConsumed]);

  useEffect(() => {
    if (flashId && highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [flashId]);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPayment, setFilterPayment] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterDelivery, setFilterDelivery] = useState('all'); // 'all' | 'pending' | 'confirmed'
  const [showFilters, setShowFilters] = useState(false);

  // Sort & pagination
  const [sortField, setSortField] = useState<SortField>('purchase_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
    setPage(1);
  };

  const toggleExpandRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <i className="ri-arrow-up-down-line text-zinc-300 ml-1 text-xs" />;
    return <i className={`${sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} text-amber-500 ml-1 text-xs`} />;
  };

  const loadIngredients = async () => {
    if (!user?.tenantId || ingredients.length > 0) return;
    const { data } = await supabase
      .from('ingredients')
      .select('id,name,unit')
      .eq('tenant_id', user.tenantId)
      .order('name');
    setIngredients(data ?? []);
  };

  const openDetail = async (p: Purchase) => {
    setDetailPurchase(p);
    setDetailInstallments([]);
    if (p.payment_status === 'partial' || p.payment_status === 'pending') {
      setLoadingInstallments(true);
      const { data } = await supabase
        .from('fin_accounts_payable')
        .select('id,installment_number,installments,amount,due_date,status,paid_date,paid_amount')
        .eq('tenant_id', user!.tenantId)
        .ilike('description', `%${p.supplier}%${p.invoice_number ? p.invoice_number : ''}%`)
        .order('installment_number');
      setDetailInstallments((data ?? []) as BillInstallment[]);
      setLoadingInstallments(false);
    }
  };

  const handleDeliveryConfirmed = () => {
    setDetailPurchase(null);
    refreshPurchases();
  };

  const handleDeleted = () => {
    setDetailPurchase(null);
    refreshPurchases();
  };

  const handleSubmit = async (payload: Record<string, unknown>) => {
    await create(payload, registrarEvento);
    setShowModal(false);
    setPage(1);
  };

  // Filtered & sorted
  const filtered = useMemo(() => {
    let result = [...purchases];
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((p) =>
        (p.supplier || '').toLowerCase().includes(q) ||
        (p.invoice_number || '').toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q),
      );
    }
    if (filterStatus !== 'all') result = result.filter((p) => p.payment_status === filterStatus);
    if (filterPayment !== 'all') result = result.filter((p) => p.payment_method === filterPayment);
    if (filterDateFrom) result = result.filter((p) => p.purchase_date >= filterDateFrom);
    if (filterDateTo) result = result.filter((p) => p.purchase_date <= filterDateTo);
    if (filterDelivery === 'pending') result = result.filter((p) => !p.delivery_confirmed_at);
    if (filterDelivery === 'confirmed') result = result.filter((p) => !!p.delivery_confirmed_at);

    result.sort((a, b) => {
      let va: string | number = a[sortField] ?? '';
      let vb: string | number = b[sortField] ?? '';
      if (sortField === 'total_amount') { va = Number(va); vb = Number(vb); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [purchases, search, filterStatus, filterPayment, filterDateFrom, filterDateTo, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeFiltersCount = [
    filterStatus !== 'all', filterPayment !== 'all', !!filterDateFrom, !!filterDateTo, filterDelivery !== 'all',
  ].filter(Boolean).length;

  const clearFilters = () => {
    setFilterStatus('all'); setFilterPayment('all');
    setFilterDateFrom(''); setFilterDateTo('');
    setFilterDelivery('all');
    setSearch(''); setPage(1);
  };

  // KPIs
  const totalCompras = purchases.reduce((s, p) => s + p.total_amount, 0);
  const totalPago = purchases.filter((p) => p.payment_status === 'paid').reduce((s, p) => s + p.total_amount, 0);
  const totalAPagar = purchases.filter((p) => p.payment_status !== 'paid').reduce((s, p) => s + p.total_amount, 0);
  const totalParcelado = purchases.filter((p) => p.payment_status === 'partial').reduce((s, p) => s + p.total_amount, 0);

  // Combina fornecedores cadastrados + os que aparecem nas compras (retrocompatibilidade)
  const suppliers = useMemo(() => {
    const set = new Set<string>(supplierNames);
    purchases.forEach((p) => { if (p.supplier) set.add(p.supplier); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [supplierNames, purchases]);

  const handleExport = () => {
    const rows = [
      ['Data', 'Fornecedor', 'NF', 'Itens', 'Total', 'Forma Pagamento', 'Status'],
      ...filtered.map((p) => [
        p.purchase_date, p.supplier, p.invoice_number || '',
        p.items?.length ?? 0, p.total_amount, p.payment_method,
        STATUS_LABEL[p.payment_status] ?? p.payment_status,
      ]),
    ];
    const csv = rows.map((r) => r.join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'Compras.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">
      {/* View toggle */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 flex-wrap">
        <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <button onClick={() => setActiveView('lista')}
            className={`px-4 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeView === 'lista' ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
            <i className="ri-list-check" /> Lista
          </button>
          <button onClick={() => setActiveView('relatorio')}
            className={`px-4 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeView === 'relatorio' ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
            <i className="ri-bar-chart-line" /> Por Fornecedor
          </button>
          <button onClick={() => setActiveView('centrocusto')}
            className={`px-4 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeView === 'centrocusto' ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
            <i className="ri-price-tag-3-line" /> Por Centro de Custo
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowCatalogo(true)}
            className="flex items-center gap-2 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-archive-line" /> Catálogo de Itens
          </button>
          <button
            onClick={() => { setShowModal(true); loadIngredients(); }}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-add-line" /> Nova Compra
          </button>
        </div>
      </div>

      {activeView === 'relatorio' && <ComprasRelatorioPanel purchases={purchases} />}
      {activeView === 'centrocusto' && <ComprasCentroCustoPanel purchases={purchases} centers={centers} />}

      {activeView === 'lista' && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            {[
              { label: 'Total de Compras', value: formatCurrency(totalCompras), icon: 'ri-shopping-cart-2-line', color: 'text-zinc-700', bg: 'bg-zinc-50' },
              { label: 'Total Pago', value: formatCurrency(totalPago), icon: 'ri-checkbox-circle-line', color: 'text-green-700', bg: 'bg-green-50' },
              { label: 'A Pagar / Parcelado', value: formatCurrency(totalAPagar), icon: 'ri-time-line', color: 'text-amber-700', bg: 'bg-amber-50' },
              { label: 'Parcelado', value: formatCurrency(totalParcelado), icon: 'ri-calendar-schedule-line', color: 'text-sky-700', bg: 'bg-sky-50' },
            ].map((k) => (
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
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Buscar por fornecedor, NF..."
                className="w-full pl-9 pr-8 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer">
                  <i className="ri-close-line text-zinc-400 text-sm" />
                </button>
              )}
            </div>

            <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
              {[['all','Todas'],['paid','Pago'],['pending','A Pagar'],['partial','Parcelado']].map(([v,l]) => (
                <button key={v} onClick={() => { setFilterStatus(v); setPage(1); }}
                  className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${filterStatus === v ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
                  {l}
                </button>
              ))}
            </div>

            {/* Filtro de recebimento */}
            <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
              {([['all', 'Todos'], ['pending', 'Aguard. Receb.'], ['confirmed', 'Recebido']] as [string, string][]).map(([v, l]) => (
                <button key={v} onClick={() => { setFilterDelivery(v); setPage(1); }}
                  className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1 ${
                    filterDelivery === v
                      ? v === 'pending' ? 'bg-amber-500 text-white' : v === 'confirmed' ? 'bg-green-500 text-white' : 'bg-amber-500 text-white'
                      : 'text-zinc-600 hover:bg-zinc-50'
                  }`}>
                  {v === 'pending' && <i className="ri-time-line text-xs" />}
                  {v === 'confirmed' && <i className="ri-truck-line text-xs" />}
                  {l}
                </button>
              ))}
            </div>

            <button onClick={() => setShowFilters((f) => !f)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-colors whitespace-nowrap ${showFilters || activeFiltersCount > 0 ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
              <i className="ri-filter-3-line" />
              Filtros {activeFiltersCount > 0 && (
                <span className="bg-amber-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs">{activeFiltersCount}</span>
              )}
            </button>

            {activeFiltersCount > 0 && (
              <button onClick={clearFilters} className="text-xs text-zinc-400 hover:text-red-500 cursor-pointer whitespace-nowrap">Limpar</button>
            )}

            <button onClick={handleExport}
              className="flex items-center gap-2 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
              <i className="ri-download-line" /> CSV
            </button>
          </div>

          {showFilters && (
            <div className="bg-white border border-zinc-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Forma de Pagamento</label>
                <select value={filterPayment} onChange={(e) => { setFilterPayment(e.target.value); setPage(1); }}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                  <option value="all">Todas</option>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Fornecedor</label>
                <select value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                  <option value="">Todos</option>
                  {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Data de</label>
                <input type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Data até</label>
                <input type="date" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
            </div>
          )}

          {(search || activeFiltersCount > 0) && (
            <p className="text-xs text-zinc-500">
              {filtered.length} resultado{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
              {purchases.length !== filtered.length && ` de ${purchases.length} compras`}
            </p>
          )}

          {/* Tabela */}
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">
                    <button onClick={() => handleSort('purchase_date')} className="flex items-center cursor-pointer hover:text-zinc-800 whitespace-nowrap">
                      Data <SortIcon field="purchase_date" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">
                    <button onClick={() => handleSort('supplier')} className="flex items-center cursor-pointer hover:text-zinc-800 whitespace-nowrap">
                      Fornecedor <SortIcon field="supplier" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 whitespace-nowrap">NF</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 whitespace-nowrap">Itens</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">
                    <button onClick={() => handleSort('total_amount')} className="flex items-center cursor-pointer hover:text-zinc-800 whitespace-nowrap">
                      Total <SortIcon field="total_amount" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 whitespace-nowrap">Pagamento</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">
                    <button onClick={() => handleSort('payment_status')} className="flex items-center cursor-pointer hover:text-zinc-800 whitespace-nowrap">
                      Status <SortIcon field="payment_status" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-10 text-zinc-400 text-sm">Carregando...</td></tr>
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-14 text-center">
                      <i className="ri-shopping-cart-2-line text-4xl text-zinc-200 block mb-2" />
                      <p className="text-zinc-400 text-sm">Nenhuma compra encontrada</p>
                      {(search || activeFiltersCount > 0) && (
                        <button onClick={clearFilters} className="text-xs text-amber-600 mt-1 cursor-pointer hover:underline">Limpar filtros</button>
                      )}
                    </td>
                  </tr>
                ) : paginated.map((p) => (
                  <>
                  <tr
                    key={p.id}
                    ref={flashId === p.id ? highlightRowRef : null}
                    className={`hover:bg-zinc-50 transition-colors ${flashId === p.id ? 'animate-pulse bg-amber-50 ring-2 ring-inset ring-amber-400' : ''}`}
                  >
                    <td className="px-4 py-3 text-zinc-600 text-sm">
                      {new Date(p.purchase_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-800">{p.supplier}</p>
                      {p.notes && <p className="text-xs text-zinc-400 truncate max-w-xs mt-0.5">{p.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-xs font-mono">{p.invoice_number || '—'}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleExpandRow(p.id)}
                        className="text-xs bg-zinc-100 hover:bg-amber-50 text-zinc-600 hover:text-amber-700 px-2 py-0.5 rounded-full cursor-pointer transition-colors flex items-center gap-1"
                      >
                        {p.items?.length ?? 0} item{(p.items?.length ?? 0) !== 1 ? 's' : ''}
                        <i className={expandedRows.has(p.id) ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                      </button>
                    </td>
                    <td className="px-4 py-3 font-semibold text-zinc-900">{formatCurrency(p.total_amount)}</td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">{p.payment_method}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full w-fit ${STATUS_BADGE[p.payment_status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                          {STATUS_LABEL[p.payment_status] ?? p.payment_status}
                        </span>
                        {p.delivery_confirmed_at ? (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 w-fit flex items-center gap-1">
                            <i className="ri-truck-line text-xs" /> Recebido
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-400 flex items-center gap-1">
                            <i className="ri-time-line text-xs" /> Aguard. recebimento
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openDetail(p)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 cursor-pointer" title="Ver detalhes">
                          <i className="ri-eye-line text-sm" />
                        </button>
                        <button
                          onClick={() => { setDetailPurchase(p); setDetailInstallments([]); }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
                          title="Excluir compra"
                        >
                          <i className="ri-delete-bin-line text-sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedRows.has(p.id) && p.items && p.items.length > 0 && (
                    <tr key={`${p.id}-items`}>
                      <td colSpan={8} className="px-4 py-3 bg-zinc-50/50">
                        <div className="rounded-xl border border-zinc-200 overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-zinc-100">
                              <tr>
                                <th className="text-left px-3 py-2 text-[10px] font-semibold text-zinc-500">Item</th>
                                <th className="text-center px-3 py-2 text-[10px] font-semibold text-zinc-500">Qtd</th>
                                <th className="text-right px-3 py-2 text-[10px] font-semibold text-zinc-500">Preço Unit.</th>
                                <th className="text-right px-3 py-2 text-[10px] font-semibold text-zinc-500">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                              {p.items.map((item, idx) => (
                                <tr key={idx}>
                                  <td className="px-3 py-2 text-zinc-700 font-medium">{item.description || '—'}</td>
                                  <td className="px-3 py-2 text-center text-zinc-500">{item.quantity} {item.unit_label}</td>
                                  <td className="px-3 py-2 text-right text-zinc-500">{formatCurrency(item.unit_price ?? 0)}</td>
                                  <td className="px-3 py-2 text-right font-semibold text-zinc-700">{formatCurrency(item.total_price ?? 0)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="border-t border-zinc-200">
                              <tr>
                                <td colSpan={3} className="px-3 py-2 text-right text-[10px] font-bold text-zinc-500">
                                  {p.freight_amount ? `Subtotal + Frete ${formatCurrency(p.freight_amount)}` : 'Total'}
                                </td>
                                <td className="px-3 py-2 text-right text-xs font-bold text-zinc-900">{formatCurrency(p.total_amount)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                  </>
                ))}
              </tbody>
            </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-100 bg-zinc-50">
                <p className="text-xs text-zinc-500">
                  Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length}
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                    className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-white disabled:opacity-40 cursor-pointer">
                    <i className="ri-arrow-left-s-line text-sm" />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const pg = totalPages <= 5 ? i + 1 : page <= 3 ? i + 1 : page >= totalPages - 2 ? totalPages - 4 + i : page - 2 + i;
                    return (
                      <button key={pg} onClick={() => setPage(pg)}
                        className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-semibold cursor-pointer ${page === pg ? 'bg-amber-500 text-white' : 'border border-zinc-200 text-zinc-600 hover:bg-white'}`}>
                        {pg}
                      </button>
                    );
                  })}
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-white disabled:opacity-40 cursor-pointer">
                    <i className="ri-arrow-right-s-line text-sm" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Detalhe modal */}
      {detailPurchase && (
        <DetalhePurchaseModal
          purchase={detailPurchase}
          installments={detailInstallments}
          loadingInstallments={loadingInstallments}
          onClose={() => setDetailPurchase(null)}
          onDeliveryConfirmed={handleDeliveryConfirmed}
          onDeleted={handleDeleted}
        />
      )}

      {/* Catálogo de itens */}
      {showCatalogo && (
        <CatalogoComprasModal onClose={() => setShowCatalogo(false)} />
      )}

      {/* Nova compra modal */}
      {showModal && (
        <NovaCompraModal
          suppliers={suppliers}
          ingredients={ingredients}
          centers={centers}
          bankAccounts={bankAccounts}
          onLoadIngredients={loadIngredients}
          onSubmit={handleSubmit}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
