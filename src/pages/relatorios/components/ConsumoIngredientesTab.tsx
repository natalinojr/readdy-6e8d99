import { useState, useMemo, useCallback } from 'react';
import { Package, ArrowDown, ArrowUp, Minus, Download, ChevronDown, ChevronUp, Calendar, Search, AlertCircle } from 'lucide-react';
import { useConsumoIngredientes } from '../../../hooks/useConsumoIngredientes';
import { useAuth } from '../../../contexts/AuthContext';
import ConsumoDetalheDia from './ConsumoDetalheDia';

interface Props {
  periodo: string;
}

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtNum = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

const LEAD_TIME: Record<string, number> = { 'Carnes': 2, 'Peixes': 2, 'Laticínios': 1, 'Hortifruti': 1, 'Bebidas': 3, 'Secos': 5 };

function calcSugestao(estoque: number, media: number, cat: string) {
  if (media <= 0) return { sugerido: 0, cobertura: 999 };
  const lt = LEAD_TIME[cat] ?? 3;
  const sugerido = Math.max(0, media * (lt + 7) - estoque);
  return { sugerido, cobertura: estoque / media };
}

function TipoBadge({ tipo, qtd, unidade }: { tipo: string; qtd: number; unidade: string }) {
  if (qtd <= 0) return null;
  const map: Record<string, { label: string; color: string }> = {
    vendas: { label: 'Vendas', color: 'text-amber-600 bg-amber-50' },
    producao: { label: 'Produção', color: 'text-sky-600 bg-sky-50' },
    perda: { label: 'Perda', color: 'text-red-600 bg-red-50' },
    ajuste: { label: 'Ajuste/Saída Manual', color: 'text-zinc-500 bg-zinc-50' },
    transferencia: { label: 'Transferência', color: 'text-violet-500 bg-violet-50' },
  };
  const c = map[tipo] ?? { label: tipo, color: 'text-zinc-500 bg-zinc-50' };
  return <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${c.color}`}>{c.label}: {fmtNum(qtd)} {unidade}</span>;
}

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

  const { dados, resumo, loading, error, debugInfo, reload } = useConsumoIngredientes(undefined, from, toDate);

  const cats = useMemo(() => ['', ...Array.from(new Set(dados.filter(d => !d.semCadastro).map(d => d.categoria).filter(Boolean)))], [dados]);
  const forns = useMemo(() => ['', ...Array.from(new Set(dados.filter(d => !d.semCadastro).map(d => d.fornecedor).filter(f => f && f !== '—'))).sort()], [dados]);

  const filtrados = useMemo(() => {
    let r = dados.map(d => ({ ...d, ...calcSugestao(d.estoqueAtual, d.mediaDiaria, d.categoria) }));
    if (cat) r = r.filter(d => !d.semCadastro && d.categoria === cat);
    if (forn) r = r.filter(d => !d.semCadastro && d.fornecedor === forn);
    if (filtro) {
      const q = filtro.toLowerCase();
      r = r.filter(d => d.nome.toLowerCase().includes(q) || d.fornecedor.toLowerCase().includes(q));
    }
    return r.sort((a, b) => {
      if (a.semCadastro !== b.semCadastro) return a.semCadastro ? 1 : -1;
      if (sort === 'custo') return (b.custoTotal ?? 0) - (a.custoTotal ?? 0);
      if (sort === 'consumo') return (b.totalConsumido ?? 0) - (a.totalConsumido ?? 0);
      return (a.diasAteZerar ?? 999) - (b.diasAteZerar ?? 999);
    });
  }, [dados, cat, forn, filtro, sort]);

  const orfas = useMemo(() => dados.filter(d => d.semCadastro), [dados]);

  const toggle = useCallback((id: string) => setExpand(p => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  }), []);

  if (error && !loading && dados.length === 0) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-red-800">{error}</p>
        <p className="text-xs text-zinc-500">User: {user?.id ?? '—'} | Tenant: {user?.tenantId ?? '—'}</p>
        <button onClick={() => window.location.reload()} className="mt-2 px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg cursor-pointer">Recarregar</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Período */}
      <div className="flex items-center gap-2 flex-wrap">
        <Calendar size={13} className="text-zinc-400" />
        <span className="text-xs text-zinc-500">De</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-1.5 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20" />
        <span className="text-xs text-zinc-500">até</span>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="px-2 py-1.5 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20" />
        <button onClick={() => { setFrom(trinta); setToDate(hoje); }} className="text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer">Últimos 30 dias</button>
      </div>

      {/* Loading */}
      {loading && <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /><span className="ml-2 text-sm text-zinc-400">Carregando...</span></div>}

      {/* Vazio */}
      {!loading && dados.length === 0 && (
        <div className="bg-white border border-zinc-100 rounded-xl p-8 text-center">
          <Package size={20} className="text-zinc-300 mx-auto mb-2" />
          <p className="text-sm font-semibold text-zinc-600">Nenhum dado de consumo</p>
          <p className="text-xs text-zinc-400">Não há movimentações no período selecionado.</p>
          <button onClick={reload} className="mt-3 px-4 py-2 bg-amber-500 text-white text-xs font-semibold rounded-lg cursor-pointer">Recarregar</button>
        </div>
      )}

      {/* Resumo */}
      {resumo && dados.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white border border-zinc-100 rounded-xl p-3">
            <p className="text-xs text-zinc-500">Ingredientes</p>
            <p className="text-lg font-bold text-zinc-800">{resumo.totalIngredientes}</p>
          </div>
          <div className="bg-white border border-zinc-100 rounded-xl p-3">
            <p className="text-xs text-zinc-500">Custo Total</p>
            <p className="text-lg font-bold text-zinc-800">{fmt(resumo.totalConsumidoValor)}</p>
          </div>
          <div className="bg-white border border-zinc-100 rounded-xl p-3">
            <p className="text-xs text-zinc-500">Faturamento</p>
            <p className="text-lg font-bold text-zinc-800">{fmt(resumo.totalVendasValor)}</p>
          </div>
          <div className="bg-white border border-zinc-100 rounded-xl p-3">
            <p className="text-xs text-zinc-500">Críticos</p>
            <p className="text-lg font-bold text-zinc-800">{resumo.ingredientesCriticos}</p>
          </div>
        </div>
      )}

      {/* Breakdown */}
      {resumo && dados.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-2"><p className="text-[10px] text-amber-600">Custo Vendas</p><p className="text-sm font-bold text-amber-700">{fmt(resumo.custoVendas)}</p></div>
          <div className="bg-sky-50 border border-sky-100 rounded-xl p-2"><p className="text-[10px] text-sky-600">Custo Produção</p><p className="text-sm font-bold text-sky-700">{fmt(resumo.custoProducao)}</p></div>
          <div className="bg-red-50 border border-red-100 rounded-xl p-2"><p className="text-[10px] text-red-600">Custo Perdas</p><p className="text-sm font-bold text-red-700">{fmt(resumo.custoPerda)}</p></div>
        </div>
      )}

      {/* Alerta de ingredientes orfãos */}
      {orfas.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={14} className="text-orange-600" />
            <p className="text-xs font-semibold text-orange-700">
              {orfas.length} ingrediente{orfas.length > 1 ? 's' : ''} com consumo mas sem cadastro ativo
            </p>
          </div>
          <p className="text-[10px] text-orange-600">
            Existem movimentações de estoque apontando para ingredientes que foram removidos ou não existem no cadastro. Revise o cadastro de ingredientes.
          </p>
        </div>
      )}

      {/* Filtros */}
      {dados.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input type="text" placeholder="Buscar..." value={filtro} onChange={e => setFiltro(e.target.value)} className="w-full pl-7 pr-2 py-1.5 text-xs border border-zinc-200 rounded-lg" />
          </div>
          <select value={cat} onChange={e => setCat(e.target.value)} className="px-2 py-1.5 text-xs border border-zinc-200 rounded-lg bg-white">{cats.map(c => <option key={c} value={c}>{c || 'Todas categorias'}</option>)}</select>
          <select value={forn} onChange={e => setForn(e.target.value)} className="px-2 py-1.5 text-xs border border-zinc-200 rounded-lg bg-white max-w-[140px]">{forns.map(f => <option key={f} value={f}>{f || 'Todos fornecedores'}</option>)}</select>
          <select value={sort} onChange={e => setSort(e.target.value as 'custo' | 'consumo' | 'dias')} className="px-2 py-1.5 text-xs border border-zinc-200 rounded-lg bg-white">
            <option value="custo">Por custo</option><option value="consumo">Por consumo</option><option value="dias">Por dias</option>
          </select>
          <button className="flex items-center gap-1 px-2 py-1.5 bg-zinc-800 text-white text-xs rounded-lg cursor-pointer"><Download size={12} />CSV</button>
        </div>
      )}

      {/* Tabela */}
      {dados.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-zinc-50 border-b border-zinc-100">
                <th className="px-3 py-2 text-left font-semibold text-zinc-600 w-6"></th>
                <th className="px-3 py-2 text-left font-semibold text-zinc-600">Ingrediente</th>
                <th className="px-3 py-2 text-right font-semibold text-zinc-600">Consumo</th>
                <th className="px-3 py-2 text-right font-semibold text-zinc-600">Custo</th>
                <th className="px-3 py-2 text-right font-semibold text-zinc-600">Estoque</th>
                <th className="px-3 py-2 text-right font-semibold text-zinc-600">Dias</th>
                <th className="px-3 py-2 text-center font-semibold text-zinc-600">Tend.</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-50">
                {filtrados.map(item => {
                  const exp = expand.has(String(item.id));
                  const crit = !item.semCadastro && Number(item.diasAteZerar) <= 3;
                  const baixo = !item.semCadastro && Number(item.diasAteZerar) <= 7;
                  return (
                    <>
                    <tr key={String(item.id)} className={`hover:bg-zinc-50/50 cursor-pointer ${exp ? 'bg-amber-50/30' : crit ? 'bg-red-50/30' : item.semCadastro ? 'bg-orange-50/20' : ''}`} onClick={() => toggle(String(item.id))}>
                      <td className="px-3 py-2 text-zinc-400">{exp ? <ChevronUp size={12} className="text-amber-500" /> : <ChevronDown size={12} />}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <span className={`font-medium ${item.semCadastro ? 'text-orange-700' : 'text-zinc-800'}`}>{item.nome}</span>
                          {item.semCadastro && <span className="px-1 bg-orange-100 text-orange-700 rounded text-[9px] font-bold">SEM CADASTRO</span>}
                          {crit && <span className="px-1 bg-red-100 text-red-700 rounded text-[9px] font-bold">CRÍTICO</span>}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          <TipoBadge tipo="vendas" qtd={Number(item.porTipo.vendas ?? 0)} unidade={item.unidade} />
                          <TipoBadge tipo="producao" qtd={Number(item.porTipo.producao ?? 0)} unidade={item.unidade} />
                          <TipoBadge tipo="perda" qtd={Number(item.porTipo.perda ?? 0)} unidade={item.unidade} />
                          <TipoBadge tipo="ajuste" qtd={Number(item.porTipo.ajuste ?? 0)} unidade={item.unidade} />
                          <TipoBadge tipo="transferencia" qtd={Number(item.porTipo.transferencia ?? 0)} unidade={item.unidade} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-700">{fmtNum(Number(item.totalConsumido))} {item.unidade}</td>
                      <td className="px-3 py-2 text-right font-medium text-zinc-800">{fmt(Number(item.custoTotal))}</td>
                      <td className="px-3 py-2 text-right">
                        {item.semCadastro ? (
                          <span className="text-orange-500 text-[10px]">N/A</span>
                        ) : (
                          <span className={baixo ? 'text-red-600 font-semibold' : 'text-zinc-600'}>{fmtNum(Number(item.estoqueAtual))} {item.unidade}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {item.semCadastro || item.diasAteZerar === null ? (
                          <span className="text-zinc-400">—</span>
                        ) : (
                          <span className={`font-semibold ${crit ? 'text-red-600' : baixo ? 'text-amber-600' : 'text-emerald-600'}`}>{Number(item.diasAteZerar)}d</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.tendencia === 'subindo' ? <ArrowUp size={12} className="text-red-500 mx-auto" /> :
                         item.tendencia === 'caindo' ? <ArrowDown size={12} className="text-emerald-500 mx-auto" /> :
                         <Minus size={12} className="text-zinc-400 mx-auto" />}
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
      )}
    </div>
  );
}