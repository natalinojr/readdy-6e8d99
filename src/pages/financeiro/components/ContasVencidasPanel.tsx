import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';

interface ContaVencida {
  id: string;
  description: string;
  supplier: string | null;
  category: string | null;
  amount: number;
  paid_amount: number | null;
  due_date: string;
  status: 'overdue' | 'pending';
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

function ageColor(days: number) {
  if (days <= 7) return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' };
  if (days <= 30) return { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-700' };
  if (days <= 60) return { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-100 text-red-700' };
  return { bg: 'bg-red-100', border: 'border-red-300', text: 'text-red-800', badge: 'bg-red-200 text-red-800' };
}

export default function ContasVencidasPanel() {
  const { user } = useAuth();
  const today = new Date().toISOString().split('T')[0];

  const [contas, setContas] = useState<ContaVencida[]>([]);
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
  const [receitaBruta, setReceitaBruta] = useState(0);

  const loadData = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);

    const [billsRes, catsRes, receitaRes] = await Promise.all([
      supabase
        .from('fin_accounts_payable')
        .select('id, description, supplier, category, amount, paid_amount, due_date, status, dre_category_id')
        .eq('tenant_id', user.tenantId)
        .in('status', ['overdue', 'pending'])
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
        .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0])
        .lte('created_at', today + 'T23:59:59'),
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
    const totalVencido = contas.filter(c => c.status === 'overdue').reduce((s, c) => s + c.amount, 0);
    const totalPendente = contas.filter(c => c.status === 'pending').reduce((s, c) => s + c.amount, 0);

    const catMap: Record<string, { name: string; total: number; count: number }> = {};
    let semCategoria = 0;

    contas.forEach(c => {
      if (c.dre_category_id && c.dre_category_name) {
        if (!catMap[c.dre_category_id]) {
          catMap[c.dre_category_id] = { name: c.dre_category_name, total: 0, count: 0 };
        }
        catMap[c.dre_category_id].total += c.amount;
        catMap[c.dre_category_id].count += 1;
      } else {
        semCategoria += c.amount;
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

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModal) return;
    setPayingId(payModal.id);
    const { error } = await supabase
      .from('fin_accounts_payable')
      .update({
        status: 'paid',
        paid_date: payForm.paid_date,
        paid_amount: Number(payForm.paid_amount),
        payment_method: payForm.payment_method,
      })
      .eq('id', payModal.id);
    if (!error) {
      setContas(prev => prev.filter(c => c.id !== payModal.id));
    }
    setPayingId(null);
    setPayModal(null);
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
      <div className="p-8 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-400 text-sm">Carregando contas vencidas...</p>
        </div>
      </div>
    );
  }

  const totalGeral = impacto.totalVencido + impacto.totalPendente;

  return (
    <div className="p-6 space-y-5">

      {/* Header de alerta */}
      {contas.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-green-100 rounded-full mx-auto mb-4">
            <i className="ri-checkbox-circle-line text-green-600 text-3xl" />
          </div>
          <h3 className="text-lg font-bold text-green-800">Nenhuma conta vencida!</h3>
          <p className="text-sm text-green-600 mt-1">Todas as contas estão em dia. Continue assim!</p>
        </div>
      ) : (
        <>
          {/* Banner de impacto */}
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-10 h-10 flex items-center justify-center bg-red-100 rounded-xl flex-shrink-0">
                <i className="ri-alarm-warning-line text-red-600 text-xl" />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-bold text-red-900">
                  {contas.length} conta{contas.length > 1 ? 's' : ''} vencida{contas.length > 1 ? 's' : ''} em aberto
                </h2>
                <p className="text-sm text-red-700 mt-0.5">
                  Essas contas estão impactando o <strong>DRE de Competência</strong> e representam passivos não quitados.
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-2xl font-black text-red-700">{formatCurrency(totalGeral)}</p>
                <p className="text-xs text-red-500 mt-0.5">total em aberto</p>
              </div>
            </div>

            {/* KPIs de impacto */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white border border-red-100 rounded-xl p-3">
                <p className="text-xs text-red-500 font-semibold">Vencidas (overdue)</p>
                <p className="text-lg font-black text-red-700 mt-0.5">{formatCurrency(impacto.totalVencido)}</p>
                <p className="text-xs text-red-400">{contas.filter(c => c.status === 'overdue').length} contas</p>
              </div>
              <div className="bg-white border border-amber-100 rounded-xl p-3">
                <p className="text-xs text-amber-600 font-semibold">Pendentes vencidas</p>
                <p className="text-lg font-black text-amber-700 mt-0.5">{formatCurrency(impacto.totalPendente)}</p>
                <p className="text-xs text-amber-400">{contas.filter(c => c.status === 'pending').length} contas</p>
              </div>
              <div className="bg-white border border-orange-100 rounded-xl p-3">
                <p className="text-xs text-orange-600 font-semibold">Impacto na Margem</p>
                <p className="text-lg font-black text-orange-700 mt-0.5">{impacto.impactoMargem.toFixed(1)}%</p>
                <p className="text-xs text-orange-400">da receita bruta do mês</p>
              </div>
              <div className="bg-white border border-zinc-100 rounded-xl p-3">
                <p className="text-xs text-zinc-500 font-semibold">Mais antiga</p>
                <p className="text-lg font-black text-zinc-700 mt-0.5">
                  {contas.length > 0 ? `${Math.max(...contas.map(c => c.days_overdue))}d` : '—'}
                </p>
                <p className="text-xs text-zinc-400">dias em atraso</p>
              </div>
            </div>
          </div>

          {/* Impacto por categoria DRE */}
          {impacto.porCategoria.length > 0 && (
            <div className="bg-white border border-zinc-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-zinc-800">Impacto por Categoria DRE</h3>
                <span className="text-xs text-zinc-400 bg-zinc-50 border border-zinc-200 px-2 py-1 rounded-lg">
                  Competência
                </span>
              </div>
              <div className="space-y-3">
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
                        <span className="text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">Vincular</span>
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
              </div>
            </div>
          )}

          {/* Filtros */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar conta..."
                className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
              />
            </div>

            {/* Filtro por idade */}
            <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
              {(Object.keys(AGE_LABELS) as AgeFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setAgeFilter(f)}
                  className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${ageFilter === f ? 'bg-red-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
                >
                  {AGE_LABELS[f]}
                </button>
              ))}
            </div>

            {/* Filtro por categoria DRE */}
            {uniqueDreCats.length > 0 && (
              <select
                value={catFilter}
                onChange={e => setCatFilter(e.target.value)}
                className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
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
          </div>

          {/* Tabela */}
          <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-950 text-white">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide">
                    <button onClick={() => handleSort('description')} className="flex items-center cursor-pointer hover:text-zinc-300">
                      Descrição <SortIcon field="description" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Categoria DRE</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                    <button onClick={() => handleSort('due_date')} className="flex items-center cursor-pointer hover:text-zinc-300">
                      Vencimento <SortIcon field="due_date" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                    <button onClick={() => handleSort('days_overdue')} className="flex items-center cursor-pointer hover:text-zinc-300">
                      Atraso <SortIcon field="days_overdue" />
                    </button>
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                    <button onClick={() => handleSort('amount')} className="flex items-center ml-auto cursor-pointer hover:text-zinc-300">
                      Valor <SortIcon field="amount" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Status</th>
                  <th className="px-4 py-3 w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-zinc-400 text-sm">
                      Nenhuma conta encontrada com os filtros selecionados
                    </td>
                  </tr>
                ) : filtered.map(c => {
                  const colors = ageColor(c.days_overdue);
                  return (
                    <tr key={c.id} className={`hover:bg-zinc-50 transition-colors ${c.days_overdue > 30 ? 'bg-red-50/20' : ''}`}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-zinc-800">{c.description}</p>
                        {c.supplier && <p className="text-xs text-zinc-400 mt-0.5">{c.supplier}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {c.dre_category_name ? (
                          <span className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">{c.dre_category_name}</span>
                        ) : (
                          <span className="text-xs bg-amber-50 text-amber-500 px-2 py-0.5 rounded-full border border-amber-200">Sem categoria</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-600 text-sm">
                        {new Date(c.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${colors.badge}`}>
                          {c.days_overdue === 0 ? 'Hoje' : `${c.days_overdue}d`}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-red-600">
                        {formatCurrency(c.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${c.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {c.status === 'overdue' ? 'Vencido' : 'Pendente'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => {
                            setPayModal(c);
                            setPayForm(f => ({ ...f, paid_amount: String(c.amount), paid_date: today }));
                          }}
                          disabled={payingId === c.id}
                          className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2.5 py-1.5 rounded-lg cursor-pointer hover:bg-green-200 whitespace-nowrap font-semibold transition-colors disabled:opacity-50"
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
                    <td colSpan={4} className="px-5 py-3 text-xs font-bold text-zinc-600 uppercase tracking-wide">
                      Total filtrado ({filtered.length} contas)
                    </td>
                    <td className="px-4 py-3 text-right text-base font-black text-red-600">
                      {formatCurrency(filtered.reduce((s, c) => s + c.amount, 0))}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Dica de ação */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 flex items-start gap-3">
            <div className="w-7 h-7 flex items-center justify-center bg-zinc-100 rounded-lg flex-shrink-0">
              <i className="ri-lightbulb-line text-zinc-500 text-sm" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-700">Como essas contas afetam o DRE de Competência?</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                No regime de competência, <strong>todas as contas com vencimento no período são contabilizadas</strong> como despesa, independente de terem sido pagas. Isso significa que contas vencidas e não pagas já reduziram o resultado do DRE no mês em que venceram. Quitar essas contas não altera o DRE de competência retroativamente — mas melhora o fluxo de caixa e o DRE de caixa do mês atual.
              </p>
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
