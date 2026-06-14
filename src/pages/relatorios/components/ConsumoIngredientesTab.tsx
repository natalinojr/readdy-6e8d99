import { useState, useMemo, useCallback } from 'react';
import {
  Package, ArrowDown, ArrowUp, Minus, Download,
  ChevronDown, ChevronUp, Calendar, Search, AlertCircle,
  Layers, Utensils, AlertTriangle, List,
} from 'lucide-react';
import { useConsumoIngredientes } from '@/hooks/useConsumoIngredientes';
import { useAuth } from '@/contexts/AuthContext';
import ConsumoDetalheDia from './ConsumoDetalheDia';
import ConsumoCategoriasPanel from './ConsumoCategoriasPanel';
import ConsumoPorLanchePanel from './ConsumoPorLanchePanel';
import ConsumoPerdas from './ConsumoPerdas';

type SubTab = 'ingredientes' | 'categorias' | 'lanchesPratos' | 'perdas';

interface Props {
  periodo: string;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtNum = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

const LEAD_TIME: Record<string, number> = {
  Carnes: 2, Peixes: 2, 'Laticínios': 1, Hortifruti: 1, Bebidas: 3, Secos: 5,
};
function calcSugestao(estoque: number, media: number, cat: string) {
  if (media <= 0) return { sugerido: 0, cobertura: 999 };
  const lt = LEAD_TIME[cat] ?? 3;
  const sugerido = Math.max(0, media * (lt + 7) - estoque);
  return { sugerido, cobertura: estoque / media };
}

function TooltipHeader({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1 cursor-help group relative">
      {label}
      <span className="w-3.5 h-3.5 flex items-center justify-center rounded-full bg-zinc-200 text-zinc-500 text-[9px] font-bold leading-none group-hover:bg-amber-200 group-hover:text-amber-700 transition-colors">
        ?
      </span>
      {/* tooltip aparece ABAIXO para não ser clipado pelo overflow do container */}
      <span className="absolute top-full right-0 mt-1 w-56 bg-zinc-800 text-white text-[10px] leading-relaxed rounded-lg px-2.5 py-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg whitespace-normal text-left font-normal">
        {tip}
        <span className="absolute bottom-full right-3 border-4 border-transparent border-b-zinc-800" />
      </span>
    </span>
  );
}

function TipoBadge({ tipo, qtd, unidade }: { tipo: string; qtd: number; unidade: string }) {
  if (qtd <= 0) return null;
  const map: Record<string, { label: string; color: string }> = {
    vendas: { label: 'Vendas', color: 'text-amber-600 bg-amber-50' },
    producao: { label: 'Produção', color: 'text-sky-600 bg-sky-50' },
    perda: { label: 'Perda', color: 'text-red-600 bg-red-50' },
    ajuste: { label: 'Ajuste', color: 'text-zinc-500 bg-zinc-50' },
    transferencia: { label: 'Transferência', color: 'text-violet-500 bg-violet-50' },
  };
  const c = map[tipo] ?? { label: tipo, color: 'text-zinc-500 bg-zinc-50' };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${c.color}`}>
      {c.label}: {fmtNum(qtd)} {unidade}
    </span>
  );
}

const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'ingredientes', label: 'Por Ingrediente', icon: <List size={12} /> },
  { id: 'categorias', label: 'Por Categoria', icon: <Layers size={12} /> },
  { id: 'lanchesPratos', label: 'Por Prato', icon: <Utensils size={12} /> },
  { id: 'perdas', label: 'Perdas', icon: <AlertTriangle size={12} /> },
];

export default function ConsumoIngredientesTab({ periodo }: Props) {
  const { user } = useAuth();
  const hoje = new Date().toISOString().split('T')[0];
  const trinta = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const [from, setFrom] = useState(trinta);
  const [toDate, setToDate] = useState(hoje);
  const [filtro, setFiltro] = useState('');
  const [cat, setCat] = useState('');
  const [forn, setForn] = useState('');
  const [sort, setSort] = useState<'custo' | 'consumo' | 'dias'>('custo');
  const [expand, setExpand] = useState<Set<string>>(new Set());
  const [subTab, setSubTab] = useState<SubTab>('ingredientes');

  const { dados, resumo, loading, error, reload } = useConsumoIngredientes(undefined, from, toDate);

  const cats = useMemo(
    () => ['', ...Array.from(new Set(dados.filter((d) => !d.semCadastro).map((d) => d.categoria).filter(Boolean)))],
    [dados],
  );
  const forns = useMemo(
    () =>
      ['', ...Array.from(new Set(dados.filter((d) => !d.semCadastro).map((d) => d.fornecedor).filter((f) => f && f !== '—'))).sort()],
    [dados],
  );

  const filtrados = useMemo(() => {
    let r = dados.map((d) => ({ ...d, ...calcSugestao(d.estoqueAtual, d.mediaDiaria, d.categoria) }));
    if (cat) r = r.filter((d) => !d.semCadastro && d.categoria === cat);
    if (forn) r = r.filter((d) => !d.semCadastro && d.fornecedor === forn);
    if (filtro) {
      const q = filtro.toLowerCase();
      r = r.filter((d) => d.nome.toLowerCase().includes(q) || d.fornecedor.toLowerCase().includes(q));
    }
    return r.sort((a, b) => {
      if (a.semCadastro !== b.semCadastro) return a.semCadastro ? 1 : -1;
      if (sort === 'custo') return (b.custoTotal ?? 0) - (a.custoTotal ?? 0);
      if (sort === 'consumo') return (b.totalConsumido ?? 0) - (a.totalConsumido ?? 0);
      return (a.diasAteZerar ?? 999) - (b.diasAteZerar ?? 999);
    });
  }, [dados, cat, forn, filtro, sort]);

  const orfas = useMemo(() => dados.filter((d) => d.semCadastro), [dados]);
  const qtdPerdas = useMemo(() => dados.filter((d) => !d.semCadastro && d.porTipo.perda > 0).length, [dados]);

  const toggle = useCallback(
    (id: string) =>
      setExpand((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    [],
  );

  if (error && !loading && dados.length === 0) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-red-800">{error}</p>
        <p className="text-xs text-zinc-500">
          User: {user?.id ?? '—'} | Tenant: {user?.tenantId ?? '—'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg cursor-pointer"
        >
          Recarregar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Período + Resumo */}
      <div className="flex items-center gap-2 flex-wrap">
        <Calendar size={13} className="text-zinc-400" />
        <span className="text-xs text-zinc-500">De</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="px-2 py-1.5 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        />
        <span className="text-xs text-zinc-500">até</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="px-2 py-1.5 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        />
        <button
          onClick={() => { setFrom(trinta); setToDate(hoje); }}
          className="text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer"
        >
          Últimos 30 dias
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="ml-2 text-sm text-zinc-400">Carregando...</span>
        </div>
      )}

      {!loading && dados.length === 0 && (
        <div className="bg-white border border-zinc-100 rounded-xl p-8 text-center">
          <Package size={20} className="text-zinc-300 mx-auto mb-2" />
          <p className="text-sm font-semibold text-zinc-600">Nenhum dado de consumo</p>
          <p className="text-xs text-zinc-400">Não há movimentações no período selecionado.</p>
          <button
            onClick={reload}
            className="mt-3 px-4 py-2 bg-amber-500 text-white text-xs font-semibold rounded-lg cursor-pointer"
          >
            Recarregar
          </button>
        </div>
      )}

      {/* Cards de resumo */}
      {resumo && dados.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-zinc-100 rounded-xl p-3">
              <p className="text-xs text-zinc-500">Ingredientes</p>
              <p className="text-lg font-bold text-zinc-800">{resumo.totalIngredientes}</p>
            </div>
            <div className="bg-white border border-zinc-100 rounded-xl p-3">
              <p className="text-xs text-zinc-500">Custo Consumido</p>
              <p className="text-lg font-bold text-zinc-800">{fmt(resumo.totalConsumidoValor)}</p>
            </div>
            <div className="bg-white border border-zinc-100 rounded-xl p-3">
              <p className="text-xs text-zinc-500">Faturamento</p>
              <p className="text-lg font-bold text-zinc-800">{fmt(resumo.totalVendasValor)}</p>
            </div>
            <div className="bg-white border border-zinc-100 rounded-xl p-3">
              <p className="text-xs text-zinc-500">Ingredientes Críticos</p>
              <p className="text-lg font-bold text-zinc-800">{resumo.ingredientesCriticos}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-2">
              <p className="text-[10px] text-amber-600">Custo Vendas</p>
              <p className="text-sm font-bold text-amber-700">{fmt(resumo.custoVendas)}</p>
            </div>
            <div className="bg-sky-50 border border-sky-100 rounded-xl p-2">
              <p className="text-[10px] text-sky-600">Custo Produção</p>
              <p className="text-sm font-bold text-sky-700">{fmt(resumo.custoProducao)}</p>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-xl p-2">
              <p className="text-[10px] text-red-600">Custo Perdas</p>
              <p className="text-sm font-bold text-red-700">{fmt(resumo.custoPerda)}</p>
            </div>
          </div>
        </>
      )}

      {orfas.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle size={14} className="text-orange-600" />
            <p className="text-xs font-semibold text-orange-700">
              {orfas.length} ingrediente{orfas.length > 1 ? 's' : ''} com consumo mas sem cadastro ativo
            </p>
          </div>
          <p className="text-[10px] text-orange-600">
            Existem movimentações apontando para ingredientes removidos ou não cadastrados.
          </p>
        </div>
      )}

      {/* Sub-tabs */}
      {dados.length > 0 && (
        <div className="flex items-center gap-1 border-b border-zinc-100 pb-0">
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer ${
                subTab === t.id
                  ? 'border-amber-500 text-amber-600'
                  : 'border-transparent text-zinc-400 hover:text-zinc-600'
              }`}
            >
              {t.icon}
              {t.label}
              {t.id === 'perdas' && qtdPerdas > 0 && (
                <span className="bg-red-500 text-white text-[9px] font-bold px-1 py-0.5 rounded-full leading-none">
                  {qtdPerdas}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Conteúdo das sub-abas */}
      {dados.length > 0 && subTab === 'categorias' && (
        <ConsumoCategoriasPanel dados={dados} loading={loading} />
      )}

      {dados.length > 0 && subTab === 'lanchesPratos' && (
        <ConsumoPorLanchePanel dateFrom={from} dateTo={toDate} />
      )}

      {dados.length > 0 && subTab === 'perdas' && (
        <ConsumoPerdas dados={dados} loading={loading} />
      )}

      {/* Por Ingrediente (lista existente) */}
      {subTab === 'ingredientes' && dados.length > 0 && (
        <>
          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Buscar..."
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-zinc-200 rounded-lg"
              />
            </div>
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              className="px-2 py-1.5 text-xs border border-zinc-200 rounded-lg bg-white"
            >
              {cats.map((c) => <option key={c} value={c}>{c || 'Todas categorias'}</option>)}
            </select>
            <select
              value={forn}
              onChange={(e) => setForn(e.target.value)}
              className="px-2 py-1.5 text-xs border border-zinc-200 rounded-lg bg-white max-w-[140px]"
            >
              {forns.map((f) => <option key={f} value={f}>{f || 'Todos fornecedores'}</option>)}
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as 'custo' | 'consumo' | 'dias')}
              className="px-2 py-1.5 text-xs border border-zinc-200 rounded-lg bg-white"
            >
              <option value="custo">Por custo</option>
              <option value="consumo">Por consumo</option>
              <option value="dias">Por dias</option>
            </select>
            <button className="flex items-center gap-1 px-2 py-1.5 bg-zinc-800 text-white text-xs rounded-lg cursor-pointer whitespace-nowrap">
              <Download size={12} />
              CSV
            </button>
          </div>

          {/* Tabela de ingredientes */}
          <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-100">
                    <th className="px-3 py-2 text-left font-semibold text-zinc-600 w-6" />
                    <th className="px-3 py-2 text-left font-semibold text-zinc-600">Ingrediente</th>
                    <th className="px-3 py-2 text-right font-semibold text-zinc-600">Consumo</th>
                    <th className="px-3 py-2 text-right font-semibold text-zinc-600">Custo</th>
                    <th className="px-3 py-2 text-right font-semibold text-zinc-600">Estoque</th>
                    <th className="px-3 py-2 text-right font-semibold text-zinc-600">
                      <TooltipHeader
                        label="Dias"
                        tip="Estimativa de dias até o estoque zerar. Cálculo: Estoque atual ÷ Média diária de consumo de vendas no período selecionado. Quanto menor o número, mais urgente a reposição."
                      />
                    </th>
                    <th className="px-3 py-2 text-center font-semibold text-zinc-600">
                      <TooltipHeader
                        label="Tend."
                        tip="Tendência do consumo: compara a última semana com a semana anterior. Seta vermelha (↑) = consumo acelerando. Seta verde (↓) = consumo caindo. Traço (—) = consumo estável (variação menor que 20%)."
                      />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {filtrados.map((item) => {
                    const exp = expand.has(String(item.id));
                    const crit = !item.semCadastro && Number(item.diasAteZerar) <= 3;
                    const baixo = !item.semCadastro && Number(item.diasAteZerar) <= 7;
                    return (
                      <>
                        <tr
                          key={String(item.id)}
                          className={`hover:bg-zinc-50/50 cursor-pointer ${exp ? 'bg-amber-50/30' : crit ? 'bg-red-50/30' : item.semCadastro ? 'bg-orange-50/20' : ''}`}
                          onClick={() => toggle(String(item.id))}
                        >
                          <td className="px-3 py-2 text-zinc-400">
                            {exp ? <ChevronUp size={12} className="text-amber-500" /> : <ChevronDown size={12} />}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <span className={`font-medium ${item.semCadastro ? 'text-orange-700' : 'text-zinc-800'}`}>
                                {item.nome}
                              </span>
                              {item.semCadastro && (
                                <span className="px-1 bg-orange-100 text-orange-700 rounded text-[9px] font-bold">
                                  SEM CADASTRO
                                </span>
                              )}
                              {crit && (
                                <span className="px-1 bg-red-100 text-red-700 rounded text-[9px] font-bold">
                                  CRÍTICO
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              <TipoBadge tipo="vendas" qtd={Number(item.porTipo.vendas ?? 0)} unidade={item.unidade} />
                              <TipoBadge tipo="producao" qtd={Number(item.porTipo.producao ?? 0)} unidade={item.unidade} />
                              <TipoBadge tipo="perda" qtd={Number(item.porTipo.perda ?? 0)} unidade={item.unidade} />
                              <TipoBadge tipo="ajuste" qtd={Number(item.porTipo.ajuste ?? 0)} unidade={item.unidade} />
                              <TipoBadge tipo="transferencia" qtd={Number(item.porTipo.transferencia ?? 0)} unidade={item.unidade} />
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-zinc-700">
                            {fmtNum(Number(item.totalConsumido))} {item.unidade}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-zinc-800">
                            {fmt(Number(item.custoTotal))}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {item.semCadastro ? (
                              <span className="text-orange-500 text-[10px]">N/A</span>
                            ) : (
                              <span className={baixo ? 'text-red-600 font-semibold' : 'text-zinc-600'}>
                                {fmtNum(Number(item.estoqueAtual))} {item.unidade}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {item.semCadastro || item.diasAteZerar === null ? (
                              <span className="text-zinc-400">—</span>
                            ) : (
                              <span
                                className={`relative group cursor-help font-semibold ${crit ? 'text-red-600' : baixo ? 'text-amber-600' : 'text-emerald-600'}`}
                              >
                                {Number(item.diasAteZerar)}d
                                {/* tooltip abaixo, alinhado à direita */}
                                <span className="absolute top-full right-0 mt-1 w-52 bg-zinc-800 text-white text-[10px] leading-relaxed rounded-lg px-2.5 py-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg whitespace-normal text-left font-normal">
                                  <span className="font-semibold text-amber-300 block mb-1">Como foi calculado:</span>
                                  Estoque atual: {fmtNum(item.estoqueAtual)} {item.unidade}
                                  <br />Média diária: {fmtNum(item.mediaDiaria)} {item.unidade}/dia
                                  <br />= {Number(item.diasAteZerar)} dias para zerar
                                  {crit && <span className="block mt-1 text-red-300 font-semibold">⚠️ Reposição urgente!</span>}
                                  {baixo && !crit && <span className="block mt-1 text-amber-300 font-semibold">⚠️ Estoque baixo.</span>}
                                  <span className="absolute bottom-full right-4 border-4 border-transparent border-b-zinc-800" />
                                </span>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {item.tendencia === 'subindo' ? (
                              <span className="relative group cursor-help inline-flex items-center justify-center">
                                <ArrowUp size={12} className="text-red-500" />
                                {/* tooltip abaixo, alinhado à direita para não vazar */}
                                <span className="absolute top-full right-0 mt-1 w-52 bg-zinc-800 text-white text-[10px] leading-relaxed rounded-lg px-2.5 py-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg whitespace-normal text-left font-normal">
                                  Consumo <span className="text-red-300 font-semibold">acelerando</span>. Última semana teve mais de 20% de consumo a mais que a semana anterior. Fique atento ao estoque.
                                  <span className="absolute bottom-full right-3 border-4 border-transparent border-b-zinc-800" />
                                </span>
                              </span>
                            ) : item.tendencia === 'caindo' ? (
                              <span className="relative group cursor-help inline-flex items-center justify-center">
                                <ArrowDown size={12} className="text-emerald-500" />
                                <span className="absolute top-full right-0 mt-1 w-52 bg-zinc-800 text-white text-[10px] leading-relaxed rounded-lg px-2.5 py-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg whitespace-normal text-left font-normal">
                                  Consumo <span className="text-emerald-300 font-semibold">diminuindo</span>. Última semana teve mais de 20% de consumo a menos que a semana anterior.
                                  <span className="absolute bottom-full right-3 border-4 border-transparent border-b-zinc-800" />
                                </span>
                              </span>
                            ) : (
                              <span className="relative group cursor-help inline-flex items-center justify-center">
                                <Minus size={12} className="text-zinc-400" />
                                <span className="absolute top-full right-0 mt-1 w-52 bg-zinc-800 text-white text-[10px] leading-relaxed rounded-lg px-2.5 py-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg whitespace-normal text-left font-normal">
                                  Consumo <span className="text-zinc-300 font-semibold">estável</span>. A variação entre a última semana e a anterior foi menor que 20%.
                                  <span className="absolute bottom-full right-3 border-4 border-transparent border-b-zinc-800" />
                                </span>
                              </span>
                            )}
                          </td>
                        </tr>
                        {exp && (
                          <tr key={`detail-${String(item.id)}`}>
                            <td colSpan={7} className="p-0">
                              <ConsumoDetalheDia
                                ingredientId={String(item.id)}
                                ingredientUnit={item.unidade}
                                dateFrom={from}
                                dateTo={toDate}
                              />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}