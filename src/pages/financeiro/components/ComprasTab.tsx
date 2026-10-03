import { Fragment, useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePurchases, useCostCenters, useBankAccounts } from '@/hooks/useFinanceiro';
import { useSuppliers } from '@/hooks/useSuppliers';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { formatCurrency } from '@/lib/formatters';
import type { Purchase } from '@/types/financeiro';
import ComprasRelatorioPanel from './ComprasRelatorioPanel';
import ComprasCentroCustoPanel from './compras/ComprasCentroCustoPanel';
import ComprasRelatoriosPanel from './compras/ComprasRelatoriosPanel';
import DetalhePurchaseModal from './compras/DetalhePurchaseModal';
import NovaCompraModal from './compras/NovaCompraModal';
import CatalogoComprasModal from './compras/CatalogoComprasModal';
import GerenciarFornecedoresModal from '@/components/GerenciarFornecedoresModal';
import CategoriasMercadoriaModal from './compras/CategoriasMercadoriaModal';
import { KpiCard, MonthNav, Segmented, addMeses, mesExtenso } from './dreUi';

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
  paid: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  partial: 'bg-sky-50 text-sky-700',
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
  const { purchases, loading, create, update, setPaymentMethod, refresh: refreshPurchases } = usePurchases();
  const { registrarEvento } = useAuditoria();
  const { centers } = useCostCenters();
  const { accounts: bankAccounts } = useBankAccounts();
  const { names: supplierNames, load: recarregarFornecedores } = useSuppliers();
  // O EstoqueContext é global e se atualiza por Realtime — mas para admin
  // multi-loja o Realtime é filtrado pela RLS (get_user_tenant_id() = última
  // membership) e fica MUDO na loja errada. Compra mexe em estoque, então
  // recarregamos o contexto explicitamente após cada operação.
  const { reloadInsumos, reloadMovimentacoes } = useEstoque();

  const [activeView, setActiveView] = useState<'lista' | 'relatorios' | 'relatorio' | 'centrocusto'>('lista');
  const [showModal, setShowModal] = useState(false);
  // Botão "Lançar" do Financeiro (2026-09-30): ?abrir=nova abre a Nova compra (como o botão da aba).
  const [paramsUrl, setParamsUrl] = useSearchParams();
  const pedidoAbrir = paramsUrl.get('abrir');
  const [showCatalogo, setShowCatalogo] = useState(false);
  const [showFornecedores, setShowFornecedores] = useState(false);
  const [showCategorias, setShowCategorias] = useState(false);
  const [detailPurchase, setDetailPurchase] = useState<Purchase | null>(null);
  const [detailInstallments, setDetailInstallments] = useState<BillInstallment[]>([]);
  const [loadingInstallments, setLoadingInstallments] = useState(false);

  // Edição de compra: só é liberada quando nada da compra ainda se moveu
  // (sem recebimento confirmado, sem pagamento registrado) — checado antes de
  // abrir o modal, e reforçado pelo backend (update_purchase devolve 409 se
  // as condições mudaram entre o clique e o envio).
  const [editPurchase, setEditPurchase] = useState<Purchase | null>(null);
  const [editInstallments, setEditInstallments] = useState<{ due_date: string; amount: number }[]>([]);
  const [checkingEdit, setCheckingEdit] = useState<string | null>(null);
  const [editBlockedMessage, setEditBlockedMessage] = useState<string | null>(null);
  // Compra recebida/paga: a edição completa é travada, mas a forma de pagamento sempre pode mudar.
  const [metodoEdit, setMetodoEdit] = useState<{ purchase: Purchase; motivo: string; metodo: string } | null>(null);
  const [metodoSalvando, setMetodoSalvando] = useState(false);
  const [metodoErro, setMetodoErro] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<{ id: string; name: string; unit: string; purchase_unit?: string | null; purchase_factor?: number | null }[]>([]);
  const [flashId, setFlashId] = useState<string | undefined>(highlightId);
  // HTMLElement (não HTMLTableRowElement): o mesmo ref serve pro <tr> do
  // desktop e pro <li> do cartão mobile.
  const highlightRowRef = useRef<HTMLElement | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Quando recebe um highlightId, ativa o flash e rola até a linha
  // Depois de consumir, avisa o pai para limpar (evita re-highlight ao voltar para a aba)
  useEffect(() => {
    if (!highlightId || loading) return;
    setFlashId(highlightId);
    // "Ver Compra" (Contas a Pagar): a compra costuma ser de outro mês que o da
    // lista — vai para o mês dela e já abre o detalhe, senão só trocava de aba.
    const alvo = purchases.find((p) => p.id === highlightId);
    if (alvo) {
      if (alvo.purchase_date) {
        const [a, m] = alvo.purchase_date.split('-').map(Number);
        setAnoSelecionado(a); setMesSelecionado(m - 1); setPage(1);
      }
      openDetail(alvo);
    }
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

  // ── Navegação por mês (mesmo padrão da aba Contas a Pagar) ──
  // A lista e os KPIs mostram o mês escolhido. "Data de/até" nos filtros tem
  // prioridade: com intervalo preenchido, vale o intervalo em vez do mês.
  const hoje = new Date();
  const [mesSelecionado, setMesSelecionado] = useState(hoje.getMonth());
  const [anoSelecionado, setAnoSelecionado] = useState(hoje.getFullYear());
  const isMesAtual = mesSelecionado === hoje.getMonth() && anoSelecionado === hoje.getFullYear();
  const voltarMesAtual = () => { setMesSelecionado(hoje.getMonth()); setAnoSelecionado(hoje.getFullYear()); setPage(1); };
  const mesPrefix = `${anoSelecionado}-${String(mesSelecionado + 1).padStart(2, '0')}`;
  const usandoIntervalo = !!filterDateFrom || !!filterDateTo;
  const comprasDoMes = useMemo(
    () => purchases.filter((p) => p.purchase_date?.startsWith(mesPrefix)),
    [purchases, mesPrefix],
  );
  // Base da lista e dos KPIs: o mês, ou todas as compras quando há intervalo de datas
  const comprasBase = usandoIntervalo ? purchases : comprasDoMes;

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
    // purchase_unit/purchase_factor = última embalagem usada na compra deste
    // insumo (ex.: 'cx' de 16) — pré-preenche o modal na próxima compra.
    const { data } = await supabase
      .from('ingredients')
      .select('id,name,unit,purchase_unit,purchase_factor')
      .eq('tenant_id', user.tenantId)
      .order('name');
    setIngredients(data ?? []);
  };
  useEffect(() => {
    if (pedidoAbrir !== 'nova') return;
    setShowModal(true);
    loadIngredients();
    setParamsUrl((p) => { p.delete('abrir'); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoAbrir]);

  const openDetail = async (p: Purchase) => {
    setDetailPurchase(p);
    setDetailInstallments([]);
    if (p.payment_status === 'partial' || p.payment_status === 'pending') {
      setLoadingInstallments(true);
      // Busca pelo VÍNCULO, não pelo texto da descrição: o ilike antigo
      // (`%fornecedor%NF%`) trazia as parcelas de TODAS as compras do mesmo
      // fornecedor, inflando a lista de parcelas exibida no detalhe.
      const { data } = await supabase
        .from('fin_accounts_payable')
        .select('id,installment_number,installments,amount,due_date,status,paid_date,paid_amount')
        .eq('tenant_id', user!.tenantId)
        .eq('reference_id', p.id)
        .eq('reference_type', 'purchase')
        .order('installment_number');
      setDetailInstallments((data ?? []) as BillInstallment[]);
      setLoadingInstallments(false);
    }
  };

  // Compra mexe em estoque — sincroniza o EstoqueContext sem depender do Realtime
  const refreshEstoque = () => {
    reloadInsumos();
    reloadMovimentacoes();
  };

  const handleDeliveryConfirmed = () => {
    setDetailPurchase(null);
    refreshPurchases();
    refreshEstoque();
  };

  const handleDeleted = () => {
    setDetailPurchase(null);
    refreshPurchases();
    refreshEstoque();
  };

  const handleSubmit = async (payload: Record<string, unknown>) => {
    await create(payload, registrarEvento);
    setShowModal(false);
    setPage(1);
    refreshEstoque();
  };

  const abrirSoMetodo = (p: Purchase, motivo: string) => {
    setMetodoErro(null);
    setMetodoEdit({ purchase: p, motivo, metodo: p.payment_method || PAYMENT_METHODS[0] });
  };

  const salvarMetodo = async () => {
    if (!metodoEdit) return;
    setMetodoSalvando(true);
    setMetodoErro(null);
    try {
      await setPaymentMethod(metodoEdit.purchase.id, metodoEdit.metodo);
      setMetodoEdit(null);
    } catch (e) {
      setMetodoErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setMetodoSalvando(false);
    }
  };

  // Verifica se a compra pode ser editada e, se puder, busca as parcelas
  // (nenhuma delas paga — já checado aqui) para pré-preencher o modal.
  const openEdit = async (p: Purchase) => {
    setEditBlockedMessage(null);
    if (p.delivery_confirmed_at) {
      abrirSoMetodo(p, 'O recebimento já foi confirmado');
      return;
    }
    if (p.payment_status === 'paid') {
      abrirSoMetodo(p, 'A compra já está paga');
      return;
    }
    setCheckingEdit(p.id);
    try {
      const { data } = await supabase
        .from('fin_accounts_payable')
        .select('id,installment_number,installments,amount,due_date,status,paid_date,paid_amount')
        .eq('tenant_id', user!.tenantId)
        .eq('reference_id', p.id)
        .eq('reference_type', 'purchase')
        .order('installment_number');
      const bills = (data ?? []) as BillInstallment[];
      const hasPayment = bills.some((b) => b.status === 'paid' || Number(b.paid_amount ?? 0) > 0);
      if (hasPayment) {
        abrirSoMetodo(p, 'Já existe pagamento registrado nesta compra');
        return;
      }
      setEditInstallments(bills.map((b) => ({ due_date: b.due_date, amount: Number(b.amount) })));
      setEditPurchase(p);
      loadIngredients();
    } finally {
      setCheckingEdit(null);
    }
  };

  const handleEditSubmit = async (payload: Record<string, unknown>) => {
    if (!editPurchase) return;
    await update(editPurchase.id, payload, registrarEvento);
    setEditPurchase(null);
    setPage(1);
    refreshEstoque();
  };

  // Filtered & sorted
  const filtered = useMemo(() => {
    let result = [...comprasBase];
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
  }, [comprasBase, search, filterStatus, filterPayment, filterDateFrom, filterDateTo, filterDelivery, sortField, sortDir]);

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
  // KPIs do período em tela (mês selecionado, ou o intervalo "Data de/até")
  const totalCompras = comprasBase.reduce((s, p) => s + Number(p.total_amount), 0);
  const totalPago = comprasBase.filter((p) => p.payment_status === 'paid').reduce((s, p) => s + Number(p.total_amount), 0);
  const totalAPagar = comprasBase.filter((p) => p.payment_status !== 'paid').reduce((s, p) => s + Number(p.total_amount), 0);
  const totalParcelado = comprasBase.filter((p) => p.payment_status === 'partial').reduce((s, p) => s + Number(p.total_amount), 0);
  const aguardandoRecebimento = comprasBase.filter((p) => !p.delivery_confirmed_at).length;
  // Comparação do cartão "Total de compras" com o mês anterior (só na navegação por mês)
  const mesAnterior = addMeses(mesPrefix, -1);
  const totalMesAnterior = useMemo(
    () => purchases.filter((p) => p.purchase_date?.startsWith(mesAnterior)).reduce((s, p) => s + Number(p.total_amount), 0),
    [purchases, mesAnterior],
  );

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

  const VIEWS = [
    { id: 'lista', label: 'Compras', icon: 'ri-shopping-cart-2-line', desc: 'Lançamentos do mês' },
    { id: 'relatorios', label: 'Relatórios', icon: 'ri-file-chart-line', desc: 'Por categoria e item' },
    { id: 'relatorio', label: 'Por fornecedor', icon: 'ri-truck-line', desc: 'Ranking e pagamentos' },
    { id: 'centrocusto', label: 'Por centro de custo', icon: 'ri-price-tag-3-line', desc: 'Onde o dinheiro foi' },
  ] as const;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto w-full">
      {/* ── Subabas (mesmo padrão da aba iFood) + cadastros e Nova compra ── */}
      <div className="flex flex-wrap items-center gap-2 lg:gap-3">
        <div className="flex gap-1 overflow-x-auto bg-zinc-100/80 rounded-xl p-1 w-full sm:w-fit">
          {VIEWS.map(v => (
            <button
              key={v.id}
              onClick={() => setActiveView(v.id)}
              title={v.desc}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                activeView === v.id ? 'bg-white text-amber-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <i className={v.icon} /> {v.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap max-w-full">
          {[
            { label: 'Catálogo de itens', icon: 'ri-archive-line', onClick: () => setShowCatalogo(true) },
            { label: 'Categorias', icon: 'ri-price-tag-3-line', onClick: () => setShowCategorias(true) },
            { label: 'Fornecedores', icon: 'ri-truck-line', onClick: () => setShowFornecedores(true) },
          ].map(b => (
            <button
              key={b.label}
              onClick={b.onClick}
              className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm"
            >
              <i className={`${b.icon} text-sm`} /> {b.label}
            </button>
          ))}
          <button
            onClick={() => { setShowModal(true); loadIngredients(); }}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors shadow-sm"
          >
            <i className="ri-add-line text-sm" /> Nova compra
          </button>
        </div>
      </div>

      {activeView === 'relatorios' && <ComprasRelatoriosPanel purchases={purchases} onOpenPurchase={openDetail} />}
      {activeView === 'relatorio' && <ComprasRelatorioPanel purchases={purchases} />}
      {activeView === 'centrocusto' && <ComprasCentroCustoPanel purchases={purchases} centers={centers} />}

      {activeView === 'lista' && (
        <>
          {editBlockedMessage && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <i className="ri-lock-line text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-800 flex-1">{editBlockedMessage}</p>
              <button onClick={() => setEditBlockedMessage(null)} className="text-amber-500 hover:text-amber-700 cursor-pointer flex-shrink-0">
                <i className="ri-close-line text-sm" />
              </button>
            </div>
          )}

          {/* ── Barra de controles: mês (ou intervalo "Data de/até") ── */}
          <div className="flex items-center gap-3 flex-wrap">
            {usandoIntervalo ? (
              <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-xl px-4 h-10 shadow-sm">
                <i className="ri-calendar-2-line text-zinc-400" />
                <p className="text-sm font-bold text-zinc-900 whitespace-nowrap">
                  {filterDateFrom ? new Date(filterDateFrom + 'T00:00:00').toLocaleDateString('pt-BR') : 'Início'}
                  {' – '}
                  {filterDateTo ? new Date(filterDateTo + 'T00:00:00').toLocaleDateString('pt-BR') : 'hoje'}
                </p>
              </div>
            ) : (
              <MonthNav
                mes={mesPrefix}
                canGoNext
                onChange={(m) => {
                  const [y, mm] = m.split('-').map(Number);
                  setAnoSelecionado(y); setMesSelecionado(mm - 1); setPage(1);
                }}
              />
            )}
            {usandoIntervalo ? (
              <button
                onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); setPage(1); }}
                className="text-xs font-semibold px-3 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl hover:bg-amber-100 cursor-pointer transition-colors whitespace-nowrap"
              >
                Voltar ao mês
              </button>
            ) : !isMesAtual && (
              <button
                onClick={voltarMesAtual}
                className="text-xs font-semibold px-3 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl hover:bg-amber-100 cursor-pointer transition-colors whitespace-nowrap"
              >
                Mês atual
              </button>
            )}
            <span className="text-xs text-zinc-400">
              {comprasBase.length} compra{comprasBase.length !== 1 ? 's' : ''} {usandoIntervalo ? 'no período' : 'neste mês'}
            </span>
          </div>

          {/* ── Cards de resumo ── */}
          <div className="grid grid-cols-2 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <KpiCard
              label="Total de compras"
              icon="ri-shopping-cart-2-line"
              value={formatCurrency(totalCompras)}
              sub={usandoIntervalo
                ? `${comprasBase.length} compra${comprasBase.length !== 1 ? 's' : ''} no período`
                : `${mesExtenso(mesAnterior)}: ${formatCurrency(totalMesAnterior)}`}
              atual={totalCompras}
              anterior={usandoIntervalo ? undefined : totalMesAnterior}
              inverse
              semVariacao={usandoIntervalo}
            />
            <KpiCard
              label="Pago"
              icon="ri-checkbox-circle-line"
              value={formatCurrency(totalPago)}
              valueTone="text-emerald-700"
              sub={totalCompras > 0 ? `${((totalPago / totalCompras) * 100).toFixed(0)}% do total` : 'Sem compras'}
              atual={totalPago}
              semVariacao
            />
            <KpiCard
              label="A pagar"
              icon="ri-time-line"
              value={formatCurrency(totalAPagar)}
              valueTone={totalAPagar > 0 ? 'text-amber-700' : undefined}
              sub="Inclui as compras parceladas"
              atual={totalAPagar}
              semVariacao
            />
            <KpiCard
              label="Parcelado"
              icon="ri-calendar-schedule-line"
              value={formatCurrency(totalParcelado)}
              sub={aguardandoRecebimento > 0
                ? `${aguardandoRecebimento} compra${aguardandoRecebimento !== 1 ? 's' : ''} aguardando recebimento`
                : 'Nenhuma compra aguardando recebimento'}
              subTone={aguardandoRecebimento > 0 ? 'text-amber-600 font-semibold' : undefined}
              atual={totalParcelado}
              semVariacao
            />
          </div>

          {/* ── Busca e filtros ── */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2 lg:gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Buscar por fornecedor, NF..."
                className="w-full pl-9 pr-8 h-10 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white shadow-sm" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer">
                  <i className="ri-close-line text-zinc-400 text-sm" />
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <Segmented
                value={filterStatus}
                onChange={(v) => { setFilterStatus(v); setPage(1); }}
                options={[
                  { id: 'all', label: 'Todas', icon: 'ri-list-check' },
                  { id: 'paid', label: 'Pago', icon: 'ri-checkbox-circle-line' },
                  { id: 'pending', label: 'A pagar', icon: 'ri-time-line' },
                  { id: 'partial', label: 'Parcelado', icon: 'ri-calendar-schedule-line' },
                ]}
              />
            </div>

            <div className="overflow-x-auto">
              <Segmented
                value={filterDelivery}
                onChange={(v) => { setFilterDelivery(v); setPage(1); }}
                options={[
                  { id: 'all', label: 'Todos', icon: 'ri-inbox-line' },
                  { id: 'pending', label: 'Aguard. receb.', icon: 'ri-hourglass-line' },
                  { id: 'confirmed', label: 'Recebido', icon: 'ri-truck-line' },
                ]}
              />
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => setShowFilters((f) => !f)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer border transition-colors whitespace-nowrap shadow-sm ${showFilters || activeFiltersCount > 0 ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
                <i className="ri-filter-3-line text-sm" />
                Filtros {activeFiltersCount > 0 && (
                  <span className="bg-amber-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">{activeFiltersCount}</span>
                )}
              </button>

              {activeFiltersCount > 0 && (
                <button onClick={clearFilters} className="text-xs text-zinc-400 hover:text-red-500 cursor-pointer whitespace-nowrap">Limpar</button>
              )}

              <button onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm">
                <i className="ri-download-line text-sm" /> CSV
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="bg-white border border-zinc-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
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

          {/* ── Tabela ── */}
          <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-zinc-800">
                {usandoIntervalo ? 'Compras do período' : `Compras de ${mesExtenso(mesPrefix).toLowerCase()}`}
              </h3>
              {(search || activeFiltersCount > 0) && (
                <p className="text-xs text-zinc-400">
                  {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
                  {comprasBase.length !== filtered.length && ` de ${comprasBase.length} compras ${usandoIntervalo ? 'no período' : 'no mês'}`}
                </p>
              )}
            </div>
            <span className="text-[11px] text-zinc-400 hidden md:flex items-center gap-1">
              <i className="ri-cursor-line" /> Clique numa compra para ver o detalhe
            </span>
          </div>

          {/* Celular: cartão por compra (a tabela não cabe em 375px) */}
          <ul className="md:hidden p-2 space-y-2 bg-zinc-50/60">
            {loading ? (
              <li className="text-center py-10 text-zinc-400 text-sm">Carregando...</li>
            ) : paginated.length === 0 ? (
              <li className="py-14 text-center">
                <i className="ri-shopping-cart-2-line text-4xl text-zinc-200 block mb-2" />
                <p className="text-zinc-400 text-sm">Nenhuma compra encontrada</p>
                {(search || activeFiltersCount > 0) && (
                  <button onClick={clearFilters} className="text-xs text-amber-600 mt-1 cursor-pointer hover:underline">Limpar filtros</button>
                )}
              </li>
            ) : paginated.map((p) => (
              <li key={p.id} ref={flashId === p.id ? (el) => { highlightRowRef.current = el; } : undefined}>
                <div
                  onClick={() => openDetail(p)}
                  className={`rounded-2xl border bg-white px-3 py-3 active:bg-zinc-50 cursor-pointer ${flashId === p.id ? 'animate-pulse bg-amber-50 ring-2 ring-inset ring-amber-400' : 'border-zinc-200'}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-zinc-400 whitespace-nowrap">
                      {new Date(p.purchase_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </span>
                    <span className="text-base font-bold text-zinc-900 tabular-nums whitespace-nowrap">{formatCurrency(p.total_amount)}</span>
                  </div>
                  <p className="text-sm font-medium text-zinc-800 break-words line-clamp-2">{p.supplier}</p>
                  {p.notes && <p className="text-xs text-zinc-400 break-words line-clamp-1">{p.notes}</p>}
                  <p className="text-xs text-zinc-400 mt-0.5">NF {p.invoice_number || '—'} · {p.payment_method}</p>

                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${STATUS_BADGE[p.payment_status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                      {STATUS_LABEL[p.payment_status] ?? p.payment_status}
                    </span>
                    {p.delivery_confirmed_at ? (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 flex items-center gap-1">
                        <i className="ri-truck-line text-xs" /> Recebido
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400 flex items-center gap-1">
                        <i className="ri-time-line text-xs" /> Aguard. recebimento
                      </span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); toggleExpandRow(p.id); }}
                      className="text-xs bg-zinc-100 hover:bg-amber-50 text-zinc-600 hover:text-amber-700 px-2 py-0.5 rounded-full cursor-pointer transition-colors flex items-center gap-1"
                    >
                      {p.items?.length ?? 0} item{(p.items?.length ?? 0) !== 1 ? 's' : ''}
                      <i className={expandedRows.has(p.id) ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                    </button>
                    <span className="flex-1" />
                    <span onClick={e => e.stopPropagation()} className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(p)}
                        disabled={checkingEdit === p.id}
                        className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-amber-50 text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait"
                        title="Editar compra"
                      >
                        {checkingEdit === p.id
                          ? <i className="ri-loader-4-line animate-spin text-sm" />
                          : <i className="ri-pencil-line text-sm" />}
                      </button>
                      <button
                        onClick={() => { setDetailPurchase(p); setDetailInstallments([]); }}
                        className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
                        title="Excluir compra"
                      >
                        <i className="ri-delete-bin-line text-sm" />
                      </button>
                    </span>
                  </div>

                  {expandedRows.has(p.id) && p.items && p.items.length > 0 && (
                    <div onClick={e => e.stopPropagation()} className="mt-2 pt-2 border-t border-zinc-100 space-y-1">
                      {p.items.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-zinc-600 truncate">{item.description || '—'} <span className="text-zinc-400">({item.quantity} {item.unit_label})</span></span>
                          <span className="font-semibold text-zinc-700 whitespace-nowrap">{formatCurrency(item.total_price ?? 0)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="border-b border-zinc-200">
                <tr>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    <button onClick={() => handleSort('purchase_date')} className="flex items-center cursor-pointer hover:text-zinc-800 whitespace-nowrap uppercase">
                      Data <SortIcon field="purchase_date" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    <button onClick={() => handleSort('supplier')} className="flex items-center cursor-pointer hover:text-zinc-800 whitespace-nowrap uppercase">
                      Fornecedor <SortIcon field="supplier" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 whitespace-nowrap">NF</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 whitespace-nowrap">Itens</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    <button onClick={() => handleSort('total_amount')} className="flex items-center justify-end ml-auto cursor-pointer hover:text-zinc-800 whitespace-nowrap uppercase">
                      Total <SortIcon field="total_amount" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 whitespace-nowrap">Pagamento</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    <button onClick={() => handleSort('payment_status')} className="flex items-center cursor-pointer hover:text-zinc-800 whitespace-nowrap uppercase">
                      Status <SortIcon field="payment_status" />
                    </button>
                  </th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100/80">
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
                  <Fragment key={p.id}>
                  <tr
                    ref={flashId === p.id ? (el) => { highlightRowRef.current = el; } : undefined}
                    onClick={() => openDetail(p)}
                    className={`hover:bg-amber-50/40 cursor-pointer transition-colors ${flashId === p.id ? 'animate-pulse bg-amber-50 ring-2 ring-inset ring-amber-400' : ''}`}
                  >
                    <td className="px-4 py-3 text-zinc-600 text-sm tabular-nums whitespace-nowrap">
                      {new Date(p.purchase_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-800">{p.supplier}</p>
                      {p.notes && <p className="text-xs text-zinc-400 truncate max-w-[240px] mt-0.5" title={p.notes}>{p.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-xs font-mono">{p.invoice_number || '—'}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleExpandRow(p.id); }}
                        className="text-xs bg-zinc-100 hover:bg-amber-50 text-zinc-600 hover:text-amber-700 px-2 py-0.5 rounded-full cursor-pointer transition-colors flex items-center gap-1 whitespace-nowrap"
                      >
                        {p.items?.length ?? 0} item{(p.items?.length ?? 0) !== 1 ? 's' : ''}
                        <i className={expandedRows.has(p.id) ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-900 tabular-nums whitespace-nowrap">{formatCurrency(p.total_amount)}</td>
                    <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">{p.payment_method}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md w-fit ${STATUS_BADGE[p.payment_status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                          {STATUS_LABEL[p.payment_status] ?? p.payment_status}
                        </span>
                        {p.delivery_confirmed_at ? (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 w-fit flex items-center gap-1">
                            <i className="ri-truck-line text-xs" /> Recebido {new Date(p.delivery_confirmed_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' })}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-400 flex items-center gap-1">
                            <i className="ri-time-line text-xs" /> Aguard. recebimento
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(p)}
                          disabled={checkingEdit === p.id}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-amber-50 text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait"
                          title="Editar compra"
                        >
                          {checkingEdit === p.id
                            ? <i className="ri-loader-4-line animate-spin text-sm" />
                            : <i className="ri-pencil-line text-sm" />}
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
                    <tr>
                      <td colSpan={8} className="px-4 py-3 bg-zinc-50/50">
                        <div className="rounded-xl border border-zinc-200 overflow-hidden overflow-x-auto">
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
                  </Fragment>
                ))}
              </tbody>
            </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-100">
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
          onItemsChanged={handleDeliveryConfirmed}
        />
      )}

      {/* Fornecedores — mesma tabela (fin_suppliers) e mesma tela do estoque. */}
      {showFornecedores && (
        <GerenciarFornecedoresModal
          onClose={() => { setShowFornecedores(false); recarregarFornecedores(); }}
        />
      )}

      {/* Catálogo de itens */}
      {showCatalogo && (
        <CatalogoComprasModal onClose={() => setShowCatalogo(false)} />
      )}

      {/* Categorias de mercadoria */}
      {showCategorias && (
        <CategoriasMercadoriaModal onClose={() => setShowCategorias(false)} />
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

      {/* Compra travada: só a forma de pagamento */}
      {metodoEdit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !metodoSalvando && setMetodoEdit(null)}>
          <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-sm font-bold text-zinc-800">Forma de pagamento</h3>
              <p className="text-xs text-zinc-500 mt-0.5">{metodoEdit.purchase.supplier}</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <i className="ri-lock-line text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-800">
                {metodoEdit.motivo} — por isso só a forma de pagamento pode ser trocada aqui. Para mudar itens, valores ou parcelas, exclua e lance novamente.
              </p>
            </div>
            <select
              value={metodoEdit.metodo}
              onChange={(e) => setMetodoEdit((m) => (m ? { ...m, metodo: e.target.value } : m))}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              {!PAYMENT_METHODS.includes(metodoEdit.purchase.payment_method) && metodoEdit.purchase.payment_method && (
                <option>{metodoEdit.purchase.payment_method}</option>
              )}
              {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
            {metodoErro && <p className="text-xs text-red-600">{metodoErro}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setMetodoEdit(null)} disabled={metodoSalvando}
                className="px-3 py-2 text-sm rounded-lg text-zinc-600 hover:bg-zinc-100 cursor-pointer disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={salvarMetodo} disabled={metodoSalvando || metodoEdit.metodo === metodoEdit.purchase.payment_method}
                className="px-3 py-2 text-sm rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                {metodoSalvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Editar compra modal */}
      {editPurchase && (
        <NovaCompraModal
          suppliers={suppliers}
          ingredients={ingredients}
          centers={centers}
          bankAccounts={bankAccounts}
          onLoadIngredients={loadIngredients}
          onSubmit={handleEditSubmit}
          onClose={() => setEditPurchase(null)}
          editingPurchase={editPurchase}
          editingInstallments={editInstallments}
        />
      )}
    </div>
  );
}
