import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useBillsPayable } from '@/hooks/useFinanceiro';
import { formatCurrency } from '@/lib/formatters';
import DreClassificacaoSelect, { precisaClassificarDRE, useDreEscolha } from '@/pages/financeiro/components/DreClassificacaoSelect';
import { rotuloImpactoMargem } from '@/lib/impactoMargem';
import { KpiCard, Segmented } from './dreUi';

interface ContaVencida {
  id: string;
  description: string;
  supplier: string | null;
  category: string | null;
  amount: number;
  paid_amount: number | null;
  due_date: string;
  // 'partial' = paga em parte e ainda em aberto — também pode estar vencida
  status: 'overdue' | 'pending' | 'partial';
  dre_category_id: string | null;
  dre_category_name?: string;
  days_overdue: number;
}

interface DRECat {
  id: string;
  name: string;
  group_type: string;
}

interface ImpactoDRE {
  totalVencido: number;
  totalPendente: number;
  porCategoria: { name: string; total: number; count: number }[];
  semCategoria: number;
  impactoMargem: number;
  receitaBruta: number;
}

type AgeFilter = 'all' | '1-7' | '8-30' | '31-60' | '60+';
type SortField = 'due_date' | 'amount' | 'days_overdue' | 'description';
type SortDir = 'asc' | 'desc';

const AGE_LABELS: Record<AgeFilter, string> = {
  all: 'Todas',
  '1-7': '1–7 dias',
  '8-30': '8–30 dias',
  '31-60': '31–60 dias',
  '60+': 'Mais de 60d',
};

// Saldo ainda devido: com pagamento parcial, `amount` deixa de ser o que falta
const saldoDevedor = (c: { amount: number; paid_amount?: number | null }) =>
  Math.max(0, Number(c.amount ?? 0) - Number(c.paid_amount ?? 0));

function ageColor(days: number) {
  if (days <= 7) return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' };
  if (days <= 30) return { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-700' };
  if (days <= 60) return { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-100 text-red-700' };
  return { bg: 'bg-red-100', border: 'border-red-300', text: 'text-red-800', badge: 'bg-red-200 text-red-800' };
}

export default function ContasVencidasPanel() {
  const navigate = useNavigate();
  const [explicaDre, setExplicaDre] = useState(false);
  const { user } = useAuth();
  const { pay } = useBillsPayable();
  // Data LOCAL: toISOString() é UTC e, após as 21h no horário de Brasília,
  // já retorna o dia seguinte — o que fazia "vencidas até hoje" incluir contas
  // que vencem amanhã.
  const hojeDate = new Date();
  const today = `${hojeDate.getFullYear()}-${String(hojeDate.getMonth() + 1).padStart(2, '0')}-${String(hojeDate.getDate()).padStart(2, '0')}`;

  const [contas, setContas] = useState<ContaVencida[]>([]);
  const [payError, setPayError] = useState<string | null>(null);
  const [dreCats, setDreCats] = useState<DRECat[]>([]);
  const [loading, setLoading] = useState(true);
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('all');
  const [catFilter, setCatFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('days_overdue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payModal, setPayModal] = useState<ContaVencida | null>(null);
  const [payForm, setPayForm] = useState({ paid_date: today, paid_amount: '', payment_method: 'Dinheiro' });
  const [payDre, setPayDre] = useState('');
  const { toPayload: dreToPayload } = useDreEscolha();
  useEffect(() => { setPayDre(''); }, [payModal?.id]);
  const [receitaBruta, setReceitaBruta] = useState(0);

  const loadData = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);

    const [billsRes, catsRes, receitaRes] = await Promise.all([
      supabase
        .from('fin_accounts_payable')
        .select('id, description, supplier, category, amount, paid_amount, due_date, status, dre_category_id, reference_type')
        .eq('tenant_id', user.tenantId)
        // 'partial' incluído: conta paga pela metade e vencida é a de MAIOR
        // risco (o fornecedor já cobrou parte) e sumia inteira desta tela.
        .in('status', ['overdue', 'pending', 'partial'])
        .lt('due_date', today)
        .order('due_date', { ascending: true }),

      supabase
        .from('fin_dre_categories')
        .select('id, name, group_type')
        .eq('tenant_id', user.tenantId)
        .eq('is_active', true),

      // Receita bruta do mês atual para calcular impacto de margem
      supabase
        .from('payments')
        .select('amount, orders!inner(tenant_id, is_training, is_draft, status)')
        .eq('orders.tenant_id', user.tenantId)
        .eq('orders.is_training', false)
        .eq('orders.is_draft', false)
        .not('orders.status', 'in', '("cancelled","draft")')
        .gte('created_at', today.slice(0, 7) + '-01T00:00:00-03:00')
        .lte('created_at', today + 'T23:59:59.999-03:00'),
    ]);

    const cats = catsRes.data ?? [];
    setDreCats(cats);

    const catMap: Record<string, string> = {};
    cats.forEach(c => { catMap[c.id] = c.name; });

    const bills = (billsRes.data ?? []).map(b => {
      const dueDate = new Date(b.due_date + 'T00:00:00');
      const todayDate = new Date(today + 'T00:00:00');
      const days = Math.floor((todayDate.getTime() - dueDate.getTime()) / 86400000);
      return {
        ...b,
        status: b.status as 'overdue' | 'pending',
        days_overdue: Math.max(0, days),
        dre_category_name: b.dre_category_id ? catMap[b.dre_category_id] : undefined,
      };
    });

    setContas(bills);

    const receita = (receitaRes.data ?? []).reduce((s, p) => s + Number(p.amount), 0);
    setReceitaBruta(receita);

    setLoading(false);
  }, [user?.tenantId, today]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    let result = [...contas];

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.description.toLowerCase().includes(q) ||
        (c.supplier ?? '').toLowerCase().includes(q) ||
        (c.category ?? '').toLowerCase().includes(q)
      );
    }

    if (catFilter !== 'all') {
      result = result.filter(c => (c.dre_category_id ?? '__sem__') === catFilter);
    }

    if (ageFilter !== 'all') {
      result = result.filter(c => {
        const d = c.days_overdue;
        if (ageFilter === '1-7') return d >= 1 && d <= 7;
        if (ageFilter === '8-30') return d >= 8 && d <= 30;
        if (ageFilter === '31-60') return d >= 31 && d <= 60;
        if (ageFilter === '60+') return d > 60;
        return true;
      });
    }

    result.sort((a, b) => {
      let va: string | number = a[sortField] ?? '';
      let vb: string | number = b[sortField] ?? '';
      if (sortField === 'amount' || sortField === 'days_overdue') {
        va = Number(va); vb = Number(vb);
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [contas, search, catFilter, ageFilter, sortField, sortDir]);

  const impacto = useMemo<ImpactoDRE>(() => {
    // Todas as contas desta tela já estão VENCIDAS (a query filtra due_date <
    // hoje). O que muda entre elas é quanto ainda se deve: saldo = amount −
    // paid_amount. Somar `amount` cheio superestimava a dívida, e a separação
    // por `status` deixava as 'partial' fora dos dois totais.
    const totalVencido = contas.reduce((s, c) => s + saldoDevedor(c), 0);
    const totalPendente = 0;

    const catMap: Record<string, { name: string; total: number; count: number }> = {};
    let semCategoria = 0;

    contas.forEach(c => {
      const saldo = saldoDevedor(c);
      if (c.dre_category_id && c.dre_category_name) {
        if (!catMap[c.dre_category_id]) {
          catMap[c.dre_category_id] = { name: c.dre_category_name, total: 0, count: 0 };
        }
        catMap[c.dre_category_id].total += saldo;
        catMap[c.dre_category_id].count += 1;
      } else {
        semCategoria += saldo;
      }
    });

    const porCategoria = Object.values(catMap).sort((a, b) => b.total - a.total);
    const totalGeral = totalVencido + totalPendente;
    const impactoMargem = receitaBruta > 0 ? (totalGeral / receitaBruta) * 100 : 0;

    return { totalVencido, totalPendente, porCategoria, semCategoria, impactoMargem, receitaBruta };
  }, [contas, receitaBruta]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <i className="ri-arrow-up-down-line text-zinc-300 ml-1 text-xs" />;
    return <i className={`${sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} text-red-500 ml-1 text-xs`} />;
  };

  // Pagamento passa pelo `pay_bill` (Edge Function), NUNCA por update direto:
  // o update cru quitava a conta incondicionalmente (ressuscitando o P11), não
  // lançava a despesa em fin_cash_flow (auto_bill_payment), não debitava o banco
  // e não gerava a próxima ocorrência de conta recorrente — o dinheiro saía da
  // tela mas não do sistema.
  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModal) return;
    const valor = Number(payForm.paid_amount);
    if (!(valor > 0)) return;
    setPayingId(payModal.id);
    setPayError(null);
    try {
      await pay(payModal.id, payForm.paid_date, valor, payForm.payment_method,
        precisaClassificarDRE(payModal) ? dreToPayload(payDre) : undefined);
      const restante = Math.max(0, Number(payModal.amount ?? 0) - Number(payModal.paid_amount ?? 0) - valor);
      // Pagamento parcial mantém a conta na lista (ainda vencida e em aberto)
      if (restante < 0.005) {
        setContas(prev => prev.filter(c => c.id !== payModal.id));
      } else {
        setContas(prev => prev.map(c => c.id === payModal.id
          ? { ...c, status: 'partial', paid_amount: Number(c.paid_amount ?? 0) + valor }
          : c));
      }
      setPayModal(null);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Erro ao registrar o pagamento');
    } finally {
      setPayingId(null);
    }
  };

  const uniqueDreCats = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    contas.forEach(c => {
      if (c.dre_category_id && c.dre_category_name && !seen.has(c.dre_category_id)) {
        seen.add(c.dre_category_id);
        result.push({ id: c.dre_category_id, name: c.dre_category_name });
      }
    });
    return result;
  }, [contas]);

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
        <div className="py-14 text-center">
          <i className="ri-loader-4-line animate-spin text-4xl text-zinc-200" />
          <p className="text-zinc-400 text-sm mt-2">Carregando contas vencidas...</p>
        </div>
      </div>
    );
  }

  const totalGeral = impacto.totalVencido + impacto.totalPendente;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto w-full">

      {contas.length === 0 ? (
        <div className="bg-white rounded-2xl border border-zinc-200 py-14 text-center">
          <i className="ri-checkbox-circle-line text-4xl text-emerald-300" />
          <h3 className="text-sm font-bold text-zinc-800 mt-2">Nenhuma conta vencida!</h3>
          <p className="text-zinc-400 text-sm mt-1">Todas as contas estão em dia. Continue assim!</p>
        </div>
      ) : (
        <>
          {/* Aviso de impacto */}
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <i className="ri-alarm-warning-line text-red-500 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-red-800">
                {contas.length} conta{contas.length > 1 ? 's' : ''} vencida{contas.length > 1 ? 's' : ''} em aberto
              </p>
              <p className="text-xs text-red-700 mt-0.5">
                Essas contas estão impactando o <strong>DRE de Competência</strong> e representam passivos não quitados.
              </p>
            </div>
          </div>

          {/* KPIs de impacto */}
          <div className="grid grid-cols-2 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3">
            <KpiCard label="Total em aberto" icon="ri-money-dollar-circle-line" value={formatCurrency(totalGeral)} valueTone="text-red-600" highlight="neg" atual={totalGeral} semVariacao />
            <KpiCard label="Vencidas (overdue)" icon="ri-alarm-warning-line" value={formatCurrency(impacto.totalVencido)} valueTone="text-red-600" sub={`${contas.filter(c => c.status === 'overdue').length} contas`} atual={impacto.totalVencido} semVariacao />
            <KpiCard label="Pendentes vencidas" icon="ri-time-line" value={formatCurrency(impacto.totalPendente)} valueTone="text-amber-700" sub={`${contas.filter(c => c.status === 'pending').length} contas`} atual={impacto.totalPendente} semVariacao />
            <KpiCard
              label="Impacto na margem" icon="ri-percent-line"
              value={rotuloImpactoMargem(totalGeral, impacto.receitaBruta)}
              valueTone={impacto.receitaBruta > 0 ? 'text-amber-700' : 'text-zinc-400'}
              sub="da receita bruta do mês" atual={0} semVariacao
            />
            <KpiCard label="Mais antiga" icon="ri-hourglass-line" value={contas.length > 0 ? `${Math.max(...contas.map(c => c.days_overdue))}d` : '—'} sub="dias em atraso" atual={0} semVariacao />
          </div>

          {/* Impacto por categoria DRE */}
          {(impacto.porCategoria.length > 0 || impacto.semCategoria > 0) && (
            <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
                <div>
                  <h3 className="text-sm font-bold text-zinc-800">Impacto por categoria DRE</h3>
                  <p className="text-xs text-zinc-400">Saldo vencido por categoria</p>
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-600">Competência</span>
              </div>
              <div className="space-y-3 p-5">
                {impacto.porCategoria.map(cat => {
                  const pct = totalGeral > 0 ? (cat.total / totalGeral) * 100 : 0;
                  return (
                    <div key={cat.name}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-zinc-700">{cat.name}</span>
                          <span className="text-xs text-zinc-400">{cat.count} conta{cat.count > 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-zinc-400">{pct.toFixed(1)}%</span>
                          <span className="text-sm font-bold text-red-600">{formatCurrency(cat.total)}</span>
                        </div>
                      </div>
                      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-400 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {impacto.semCategoria > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-400">Sem categoria DRE</span>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700">Vincular</span>
                      </div>
                      <span className="text-sm font-bold text-zinc-500">{formatCurrency(impacto.semCategoria)}</span>
                    </div>
                    <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-zinc-300 rounded-full"
                        style={{ width: `${totalGeral > 0 ? (impacto.semCategoria / totalGeral) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                )}
                {/* Explicação (antes um bloco fixo no fim da tela; agora abre aqui — 2026-09-30) */}
                <div>
                  <button onClick={() => setExplicaDre((v) => !v)} className="text-xs font-semibold text-amber-600 hover:underline cursor-pointer">
                    {explicaDre ? 'Fechar' : 'Como essas contas afetam o DRE de Competência?'}
                  </button>
                  {explicaDre && (
                    <p className="text-xs text-zinc-500 mt-2 max-w-3xl">
                      No regime de competência, <strong>todas as contas com vencimento no período são contabilizadas</strong> como despesa, independente de terem sido pagas. Isso significa que contas vencidas e não pagas já reduziram o resultado do DRE no mês em que venceram. Quitar essas contas não altera o DRE de competência retroativamente — mas melhora o fluxo de caixa e o DRE de caixa do mês atual.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2 lg:gap-3">
            <div className="relative flex-1 min-w-48 max-w-sm">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar conta..."
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-zinc-200 shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              />
            </div>

            {/* Filtro por idade */}
            <div className="overflow-x-auto max-w-full">
              <Segmented
                value={ageFilter}
                onChange={setAgeFilter}
                options={(Object.keys(AGE_LABELS) as AgeFilter[]).map(f => ({
                  id: f, label: AGE_LABELS[f], icon: f === 'all' ? 'ri-list-check' : 'ri-time-line',
                }))}
              />
            </div>

            {/* Filtro por categoria DRE */}
            {uniqueDreCats.length > 0 && (
              <select
                value={catFilter}
                onChange={e => setCatFilter(e.target.value)}
                className="h-10 border border-zinc-200 rounded-xl shadow-sm px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white max-w-full"
              >
                <option value="all">Todas as categorias</option>
                {uniqueDreCats.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                <option value="__sem__">Sem categoria DRE</option>
              </select>
            )}

            <span className="text-xs text-zinc-400 ml-auto">
              {filtered.length} de {contas.length} conta{contas.length !== 1 ? 's' : ''}
            </span>
            {/* Pagar em lote fica em Contas a Pagar (mesma baixa, com a classificação DRE) — abre lá já nas vencidas. */}
            <button onClick={() => navigate('/financeiro?tab=pagar&aberto=vencidas')}
              className="h-10 flex items-center gap-1.5 px-3 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 cursor-pointer whitespace-nowrap shadow-sm">
              <i className="ri-checkbox-multiple-line" /> Pagar várias de uma vez
            </button>
          </div>

          {/* Celular: cartão por conta (a tabela com 7 colunas não cabe em 375px) */}
          <ul className="md:hidden space-y-2">
            {filtered.length === 0 ? (
              <li className="py-14 text-center"><i className="ri-search-line text-4xl text-zinc-200" /><p className="text-zinc-400 text-sm mt-2">Nenhuma conta encontrada com os filtros selecionados</p></li>
            ) : filtered.map(c => {
              const colors = ageColor(c.days_overdue);
              return (
                <li key={c.id} className={`rounded-2xl border bg-white px-4 py-3 ${colors.border}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-zinc-400 whitespace-nowrap">
                      {new Date(c.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </span>
                    <span className="text-base font-bold text-red-600 tabular-nums whitespace-nowrap">{formatCurrency(c.amount)}</span>
                  </div>
                  <p className="text-sm font-medium text-zinc-800 break-words line-clamp-2">{c.description}</p>
                  {c.supplier && <p className="text-xs text-zinc-400 break-words line-clamp-1">{c.supplier}</p>}
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${colors.badge}`}>
                      {c.days_overdue === 0 ? 'Hoje' : `${c.days_overdue}d`}
                    </span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${c.status === 'overdue' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                      {c.status === 'overdue' ? 'Vencido' : 'Pendente'}
                    </span>
                    {c.dre_category_name ? (
                      <span className="text-[11px] font-semibold bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-md break-words">{c.dre_category_name}</span>
                    ) : (
                      <span className="text-[11px] font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md">Sem categoria</span>
                    )}
                    <span className="flex-1" />
                    <button
                      onClick={() => {
                        setPayModal(c);
                        setPayError(null);
                        setPayForm(f => ({ ...f, paid_amount: String(saldoDevedor(c)), paid_date: today }));
                      }}
                      disabled={payingId === c.id}
                      className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-3 h-9 rounded-xl cursor-pointer active:bg-emerald-100 whitespace-nowrap font-semibold transition-colors disabled:opacity-50"
                    >
                      <i className="ri-check-line" /> Pagar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Tabela */}
          <div className="hidden md:block bg-white rounded-2xl border border-zinc-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-bold text-zinc-800">Contas vencidas</h3>
                <p className="text-xs text-zinc-400">Ordene pelos cabeçalhos das colunas</p>
              </div>
              <span className="text-[11px] text-zinc-400 flex items-center gap-1"><i className="ri-arrow-up-down-line" /> clique no título para ordenar</span>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200">
                <tr>
                  <th className="text-left pl-5 pr-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    <button onClick={() => handleSort('description')} className="flex items-center cursor-pointer hover:text-zinc-700 uppercase">
                      Descrição <SortIcon field="description" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Categoria DRE</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    <button onClick={() => handleSort('due_date')} className="flex items-center cursor-pointer hover:text-zinc-700 uppercase">
                      Vencimento <SortIcon field="due_date" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    <button onClick={() => handleSort('days_overdue')} className="flex items-center cursor-pointer hover:text-zinc-700 uppercase">
                      Atraso <SortIcon field="days_overdue" />
                    </button>
                  </th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    <button onClick={() => handleSort('amount')} className="flex items-center ml-auto cursor-pointer hover:text-zinc-700 uppercase">
                      Valor <SortIcon field="amount" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Status</th>
                  <th className="px-4 py-2.5 pr-5 w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100/80">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-14 text-center">
                      <i className="ri-search-line text-4xl text-zinc-200" />
                      <p className="text-zinc-400 text-sm mt-2">Nenhuma conta encontrada com os filtros selecionados</p>
                    </td>
                  </tr>
                ) : filtered.map(c => {
                  const colors = ageColor(c.days_overdue);
                  return (
                    <tr key={c.id} className={`hover:bg-zinc-50 transition-colors ${c.days_overdue > 30 ? 'bg-red-50/20' : ''}`}>
                      <td className="pl-5 pr-4 py-3">
                        <p className="font-medium text-zinc-800 truncate max-w-[280px]" title={c.description}>{c.description}</p>
                        {c.supplier && <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-[280px]" title={c.supplier}>{c.supplier}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {c.dre_category_name ? (
                          <span className="text-[11px] font-semibold bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-md">{c.dre_category_name}</span>
                        ) : (
                          <span className="text-[11px] font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md">Sem categoria</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-600 text-sm whitespace-nowrap">
                        {new Date(c.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${colors.badge}`}>
                          {c.days_overdue === 0 ? 'Hoje' : `${c.days_overdue}d`}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-red-600 tabular-nums whitespace-nowrap">
                        {formatCurrency(c.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${c.status === 'overdue' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                          {c.status === 'overdue' ? 'Vencido' : 'Pendente'}
                        </span>
                      </td>
                      <td className="px-4 py-3 pr-5">
                        <button
                          onClick={() => {
                            setPayModal(c);
                            setPayError(null);
                            // Sugere o SALDO devedor, não o valor original —
                            // senão numa conta parcial o campo já vem propondo
                            // pagar de novo o que já foi pago.
                            setPayForm(f => ({ ...f, paid_amount: String(saldoDevedor(c)), paid_date: today }));
                          }}
                          disabled={payingId === c.id}
                          className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1.5 rounded-lg cursor-pointer hover:bg-emerald-100 whitespace-nowrap font-semibold transition-colors disabled:opacity-50"
                        >
                          <i className="ri-check-line" /> Pagar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {filtered.length > 0 && (
                <tfoot className="bg-zinc-50 border-t-2 border-zinc-200">
                  <tr>
                    <td colSpan={4} className="pl-5 pr-4 py-3 text-xs font-bold text-zinc-600 uppercase tracking-wide">
                      Total filtrado ({filtered.length} contas)
                    </td>
                    <td className="px-4 py-3 text-right text-base font-bold text-zinc-900 tabular-nums whitespace-nowrap">
                      {formatCurrency(filtered.reduce((s, c) => s + c.amount, 0))}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
            </div>
          </div>

        </>
      )}

      {/* Modal de pagamento */}
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
              <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                <p className="text-sm font-medium text-zinc-800">{payModal.description}</p>
                <p className="text-xs text-red-500 mt-1">
                  Venceu em {new Date(payModal.due_date + 'T00:00:00').toLocaleDateString('pt-BR')} — {payModal.days_overdue}d em atraso
                </p>
              </div>
              {precisaClassificarDRE(payModal) && (
                <DreClassificacaoSelect value={payDre} onChange={setPayDre} categorias={dreCats} />
              )}
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Valor Pago</label>
                <input
                  type="number" step="0.01" value={payForm.paid_amount}
                  onChange={e => setPayForm(f => ({ ...f, paid_amount: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Data do Pagamento</label>
                <input
                  type="date" value={payForm.paid_date}
                  onChange={e => setPayForm(f => ({ ...f, paid_date: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Forma de Pagamento</label>
                <select
                  value={payForm.payment_method}
                  onChange={e => setPayForm(f => ({ ...f, payment_method: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                >
                  {['Dinheiro', 'PIX', 'Cartão Débito', 'Cartão Crédito', 'Transferência', 'Boleto'].map(m => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              {payError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <i className="ri-error-warning-line text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-700">{payError}</p>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button" onClick={() => setPayModal(null)}
                  className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap"
                >
                  Confirmar Pagamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
