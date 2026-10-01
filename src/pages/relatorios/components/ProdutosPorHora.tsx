import { useState, useMemo, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { getPeriodDates } from '@/lib/dateUtils';
import { normalizarNomeItem } from './nomeItem';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

// Relatórios › Produtos › Por Hora: quais produtos saem em cada hora do dia (Brasília).
// Dados da RPC fn_get_items_by_hour — mesmos filtros/receita do Ranking (top_items),
// então a soma de todas as horas bate com o total da aba Ranking.

const fmt = formatCurrency;
const fmt0 = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);
// Célula da matriz em R$: sem o símbolo (vai no subtítulo) e com "k" acima de mil, para caber
const compacto = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')}k` : String(Math.round(v)));
const faixa =(h: number) => `${String(h).padStart(2, '0')}h–${String((h + 1) % 24).padStart(2, '0')}h`;
const LIMITE_MATRIZ = 15;

interface LinhaHora {
  hora: number;
  item_name: string;
  category_name: string;
  total_qty: number;
  total_revenue: number;
}

function useItensPorHora(periodo: string, sessionId: string | null, isSessao: boolean) {
  const { user } = useAuth();
  const [data, setData] = useState<LinhaHora[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    if (isSessao && !sessionId) { setData([]); return; }
    setLoading(true);
    try {
      const { from, to } = isSessao
        ? { from: '1970-01-01', to: '2099-12-31' }
        : getPeriodDates(periodo);
      const { data: result, error } = await supabase.rpc('fn_get_items_by_hour', {
        p_tenant_id: user.tenantId,
        p_date_from: from,
        p_date_to: to,
        p_session_id: isSessao ? sessionId : null,
      });
      if (error) throw error;
      // Une as unidades do mesmo item ("X (Un. 1)" + "X (Un. 2)" → "X") dentro de cada hora
      const map = new Map<string, LinhaHora>();
      for (const r of (result ?? []) as LinhaHora[]) {
        const nome = normalizarNomeItem(String(r.item_name ?? ''));
        const key = `${r.hora}::${nome}`;
        const prev = map.get(key);
        if (prev) {
          prev.total_qty += Number(r.total_qty) || 0;
          prev.total_revenue += Number(r.total_revenue) || 0;
        } else {
          map.set(key, {
            hora: Number(r.hora),
            item_name: nome,
            category_name: r.category_name ?? 'Sem categoria',
            total_qty: Number(r.total_qty) || 0,
            total_revenue: Number(r.total_revenue) || 0,
          });
        }
      }
      setData(Array.from(map.values()));
    } catch (e) {
      console.error('[useItensPorHora]', e);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, periodo, sessionId, isSessao]);

  useEffect(() => { load(); }, [load]);
  return { data, loading };
}

interface Props {
  periodo: string;
  sessionId: string | null;
  isSessao: boolean;
  categorias: string[];
}

export default function ProdutosPorHora({ periodo, sessionId, isSessao, categorias }: Props) {
  const { data, loading } = useItensPorHora(periodo, sessionId, isSessao);
  const [metrica, setMetrica] = useState<'qtd' | 'receita'>('qtd');
  const [categoria, setCategoria] = useState('todas');
  const [produto, setProduto] = useState('todos');
  const [horaSel, setHoraSel] = useState<number | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  useEffect(() => { setHoraSel(null); setProduto('todos'); }, [periodo, sessionId]);

  const valor = useCallback(
    (r: { total_qty: number; total_revenue: number }) => (metrica === 'qtd' ? r.total_qty : r.total_revenue),
    [metrica],
  );
  const fmtValor = (v: number) => (metrica === 'qtd' ? `${v} un.` : fmt(v));

  const linhas = useMemo(
    () => data.filter((r) => categoria === 'todas' || r.category_name === categoria),
    [data, categoria],
  );

  // Produtos do filtro atual, do que mais sai para o que menos sai
  const produtos = useMemo(() => {
    const m = new Map<string, { nome: string; total: number; porHora: Map<number, LinhaHora> }>();
    for (const r of linhas) {
      const p = m.get(r.item_name) ?? { nome: r.item_name, total: 0, porHora: new Map() };
      p.total += valor(r);
      p.porHora.set(r.hora, r);
      m.set(r.item_name, p);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [linhas, valor]);

  // Se o produto escolhido sumiu (troca de categoria), volta para "todos"
  useEffect(() => {
    if (produto !== 'todos' && !produtos.some((p) => p.nome === produto)) setProduto('todos');
  }, [produtos, produto]);

  // Faixa de horas: da primeira à última hora com venda (horas vazias no meio aparecem)
  const horas = useMemo(() => {
    const hs = data.map((r) => r.hora);
    if (!hs.length) return [] as number[];
    const a = Math.min(...hs), b = Math.max(...hs);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }, [data]);

  const linhasGrafico = useMemo(
    () => (produto === 'todos' ? linhas : linhas.filter((r) => r.item_name === produto)),
    [linhas, produto],
  );

  const porHora = useMemo(() => horas.map((h) => {
    const rs = linhasGrafico.filter((r) => r.hora === h);
    return {
      hora: h,
      label: `${h}h`,
      qtd: rs.reduce((s, r) => s + r.total_qty, 0),
      receita: rs.reduce((s, r) => s + r.total_revenue, 0),
    };
  }), [horas, linhasGrafico]);

  const totalGrafico = porHora.reduce((s, p) => s + p[metrica], 0);
  const pico = porHora.reduce<(typeof porHora)[number] | null>((best, p) => (p[metrica] > (best?.[metrica] ?? 0) ? p : best), null);

  // Hora do detalhe: a clicada, ou o pico por padrão
  const horaDetalhe = horaSel ?? pico?.hora ?? null;
  const detalhe = useMemo(() => {
    if (horaDetalhe === null) return [];
    return linhas
      .filter((r) => r.hora === horaDetalhe)
      .sort((a, b) => valor(b) - valor(a));
  }, [linhas, horaDetalhe, valor]);
  const totalDetalhe = detalhe.reduce((s, r) => s + valor(r), 0);

  const matriz = verTodos ? produtos : produtos.slice(0, LIMITE_MATRIZ);
  const maxCelula = Math.max(1, ...matriz.flatMap((p) => Array.from(p.porHora.values()).map(valor)));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mr-3" />
        <span className="text-sm">Carregando vendas por hora...</span>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 bg-white border border-zinc-100 rounded-xl text-zinc-400">
        <i className="ri-time-line text-3xl text-zinc-200 mb-2" />
        <p className="text-sm">Nenhuma venda por hora no período</p>
      </div>
    );
  }

  const btn = (ativo: boolean) =>
    `px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${ativo ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`;

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        {categorias.length > 1 && (
          <select
            value={categoria}
            onChange={(e) => { setCategoria(e.target.value); setHoraSel(null); }}
            className="text-xs border border-zinc-200 rounded-lg px-3 py-2 bg-white text-zinc-700 cursor-pointer focus:outline-none w-full sm:w-auto"
          >
            <option value="todas">Todas as categorias</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select
          value={produto}
          onChange={(e) => setProduto(e.target.value)}
          className="text-xs border border-zinc-200 rounded-lg px-3 py-2 bg-white text-zinc-700 cursor-pointer focus:outline-none w-full sm:w-auto sm:max-w-[240px]"
        >
          <option value="todos">Todos os produtos</option>
          {produtos.map((p) => <option key={p.nome} value={p.nome}>{p.nome}</option>)}
        </select>
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 self-start sm:ml-auto">
          <button onClick={() => setMetrica('qtd')} className={btn(metrica === 'qtd')}>Quantidade</button>
          <button onClick={() => setMetrica('receita')} className={btn(metrica === 'receita')}>Receita</button>
        </div>
      </div>

      {/* Gráfico por hora */}
      <div className="bg-white border border-zinc-100 rounded-xl p-4 md:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-800 truncate">
              {produto === 'todos' ? 'Vendas por hora do dia' : produto}
            </h3>
            <p className="text-xs text-zinc-400">
              {metrica === 'qtd' ? 'Unidades vendidas' : 'Receita'} por hora (horário de Brasília) · clique numa barra para ver os produtos
            </p>
          </div>
          {pico && totalGrafico > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 self-start whitespace-nowrap">
              <i className="ri-fire-line" />
              Pico {faixa(pico.hora)} · {((pico[metrica] / totalGrafico) * 100).toFixed(0)}%
            </div>
          )}
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={porHora}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 9, fill: '#a1a1aa' }}
                axisLine={false}
                tickLine={false}
                width={metrica === 'receita' ? 48 : 28}
                allowDecimals={false}
                tickFormatter={(v) => (metrica === 'receita' ? (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)) : String(v))}
              />
              <Tooltip
                cursor={{ fill: '#fef3c7', opacity: 0.5 }}
                labelFormatter={(_, p) => (p?.[0] ? faixa((p[0].payload as { hora: number }).hora) : '')}
                formatter={(val: number) => [fmtValor(val), metrica === 'qtd' ? 'Quantidade' : 'Receita']}
                contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
              />
              <Bar dataKey={metrica} radius={[4, 4, 0, 0]} maxBarSize={36} className="cursor-pointer"
                onClick={(d: { payload?: { hora?: number } }) => {
                  const h = d?.payload?.hora;
                  if (typeof h === 'number') setHoraSel(h);
                }}
              >
                {porHora.map((p) => (
                  <Cell key={p.hora} fill={p.hora === horaDetalhe ? '#f59e0b' : '#fcd34d'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Matriz produto × hora */}
        <div className="xl:col-span-3 bg-white border border-zinc-100 rounded-xl p-4 md:p-5 min-w-0">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-zinc-800">Produto × hora</h3>
            <p className="text-xs text-zinc-400">
              {metrica === 'qtd' ? 'Unidades' : 'Receita em R$'} · quanto mais forte a cor, mais vendeu naquela hora
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="text-[10px] border-separate" style={{ borderSpacing: 3 }}>
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white" />
                  {horas.map((h) => (
                    <th key={h} className="px-0 font-medium">
                      <button
                        onClick={() => setHoraSel(h)}
                        className={`w-full min-w-[34px] cursor-pointer rounded ${h === horaDetalhe ? 'text-amber-700 font-bold' : 'text-zinc-400 hover:text-zinc-600'}`}
                      >
                        {h}h
                      </button>
                    </th>
                  ))}
                  <th className="text-zinc-400 font-medium text-right pl-1">Total</th>
                </tr>
              </thead>
              <tbody>
                {matriz.map((p) => (
                  <tr key={p.nome}>
                    <td className="sticky left-0 z-10 bg-white pr-2 shadow-[3px_0_0_#fff]">
                      <button
                        onClick={() => setProduto(p.nome === produto ? 'todos' : p.nome)}
                        title={p.nome}
                        className={`block text-left text-[11px] font-medium truncate max-w-[120px] sm:max-w-[170px] cursor-pointer ${p.nome === produto ? 'text-amber-700' : 'text-zinc-700 hover:text-zinc-900'}`}
                      >
                        {p.nome}
                      </button>
                    </td>
                    {horas.map((h) => {
                      const c = p.porHora.get(h);
                      const v = c ? valor(c) : 0;
                      const a = v / maxCelula;
                      return (
                        <td
                          key={h}
                          title={c ? `${p.nome} · ${faixa(h)}\n${c.total_qty} un. · ${fmt(c.total_revenue)}` : undefined}
                          className={`h-7 min-w-[34px] rounded-md text-center font-bold tabular-nums ${h === horaDetalhe ? 'ring-1 ring-amber-400' : ''}`}
                          style={{ background: v ? `rgba(245,158,11,${0.12 + a * 0.83})` : '#fafafa', color: a > 0.55 ? '#fff' : '#92400e' }}
                        >
                          {v ? (metrica === 'qtd' ? v : compacto(v)) : ''}
                        </td>
                      );
                    })}
                    <td className="text-right pl-1 text-[11px] font-semibold text-zinc-700 tabular-nums whitespace-nowrap">
                      {metrica === 'qtd' ? p.total : fmt0(p.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {produtos.length > LIMITE_MATRIZ && (
            <button
              onClick={() => setVerTodos((v) => !v)}
              className="mt-3 text-[11px] font-semibold text-zinc-500 hover:text-zinc-700 cursor-pointer"
            >
              {verTodos ? `Mostrar só os ${LIMITE_MATRIZ} que mais saem` : `Ver todos os ${produtos.length} produtos`}
            </button>
          )}
        </div>

        {/* Produtos da hora selecionada */}
        <div className="xl:col-span-2 bg-white border border-zinc-100 rounded-xl p-4 md:p-5 min-w-0">
          {horaDetalhe === null ? (
            <p className="text-sm text-zinc-400 text-center py-10">Selecione uma hora</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-zinc-800">O que saiu das {faixa(horaDetalhe)}</h3>
                  <p className="text-xs text-zinc-400">
                    {horaSel === null ? 'Hora de pico · ' : ''}
                    {detalhe.length} {detalhe.length === 1 ? 'produto' : 'produtos'} · {fmtValor(totalDetalhe)}
                  </p>
                </div>
                {horaSel !== null && (
                  <button onClick={() => setHoraSel(null)} className="text-[10px] font-semibold text-zinc-400 hover:text-zinc-600 cursor-pointer whitespace-nowrap">
                    Voltar ao pico
                  </button>
                )}
              </div>
              {detalhe.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-8">Nada vendido nessa hora.</p>
              ) : (
                <ul className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {detalhe.map((r, i) => {
                    const pct = totalDetalhe > 0 ? (valor(r) / totalDetalhe) * 100 : 0;
                    return (
                      <li key={r.item_name}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="w-5 text-[10px] font-bold text-zinc-400 flex-shrink-0">{i + 1}</span>
                            <span title={r.item_name} className="font-medium text-zinc-800 truncate">{r.item_name}</span>
                          </span>
                          <span className="flex-shrink-0 tabular-nums text-zinc-500">
                            <strong className="text-zinc-900">{r.total_qty} un.</strong> · {fmt(r.total_revenue)}
                          </span>
                        </div>
                        <div className="ml-7 mt-1 flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] text-zinc-400 w-8 text-right tabular-nums">{pct.toFixed(0)}%</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
