import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { custoLinhaFicha } from '@/lib/unitConversion';
import { confirmar } from '@/components/base/Dialogos';

// CMV do iFood (2026-09-25): cada produto/complemento do relatório de Cardápio (fin_ifood_menu_sales,
// identificado pelo nome) recebe uma composição de insumos (fin_ifood_cmv_items/linhas, gravada pela
// RPC fn_ifood_cmv_salvar). CMV = quantidade vendida × custo ATUAL dos insumos (custoLinhaFicha,
// com conversão g↔kg, ml↔L). Indicador gerencial — não entra na DRE (lá o CMV é o de compras).
// Nada é sugerido sozinho: o usuário escolhe cada insumo, ou copia a ficha de um item do cardápio.

interface Venda { merchant_short: string | null; period_start: string; period_end: string; kind: 'item' | 'complemento'; group_name: string | null; name: string; quantity: number | null; total_value: number | null }
interface Insumo { id: string; name: string; unit: string; unit_price: number | null }
interface CmvItem { id: string; kind: 'item' | 'complemento'; name_key: string; name: string; updated_at: string }
interface Linha { cmv_item_id: string; ingredient_id: string; quantity: number; unit: string; ordem: number }
interface LinhaEdit { ingredient_id: string; quantity: string; unit: string }
interface Produto { key: string; kind: 'item' | 'complemento'; name: string; group: string | null; qtd: number; valor: number; custoUnit: number | null; linhas: number }

interface Props { tenantId: string; lojaShort: string | null; onImportar: () => void }

const chave = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
// Busca sem acento e sem caixa ("acucar" acha "Açúcar").
const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// O relatório traz "Em 1 categorias" como grupo de vários itens — não diz nada, então some.
const grupoUtil = (g: string | null) => (g && !/^em \d+ categorias?$/i.test(g.trim()) ? g : null);
const dBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const n = (v: unknown) => Number(v ?? 0);
const UNID_LABEL: Record<string, string> = { g: 'g', kg: 'kg', ml: 'ml', L: 'L', unit: 'un' };
const unidadesDo = (u: string) => (u === 'g' || u === 'kg' ? ['g', 'kg'] : u === 'ml' || u === 'L' ? ['ml', 'L'] : ['unit']);
const unidadePadrao = (u: string) => (u === 'kg' ? 'g' : u === 'L' ? 'ml' : u);
const custoDaLinha = (l: { quantity: number; unit: string }, ins?: Insumo) => (ins ? custoLinhaFicha(l.quantity, l.unit, ins.unit, n(ins.unit_price)) : 0);

export default function IfoodCmv({ tenantId, lojaShort, onImportar }: Props) {
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [itens, setItens] = useState<CmvItem[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState('');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'sem' | 'com'>('todos');
  const [editando, setEditando] = useState<Produto | null>(null);

  const carregar = useCallback(async () => {
    const [v, i, c, l] = await Promise.all([
      supabase.from('fin_ifood_menu_sales').select('merchant_short, period_start, period_end, kind, group_name, name, quantity, total_value')
        .eq('tenant_id', tenantId).order('period_end', { ascending: false }).limit(20000),
      supabase.from('ingredients').select('id, name, unit, unit_price').eq('tenant_id', tenantId).is('deleted_at', null).order('name').limit(5000),
      supabase.from('fin_ifood_cmv_items').select('id, kind, name_key, name, updated_at').eq('tenant_id', tenantId),
      supabase.from('fin_ifood_cmv_linhas').select('cmv_item_id, ingredient_id, quantity, unit, ordem').eq('tenant_id', tenantId).order('ordem'),
    ]);
    const e = v.error ?? i.error ?? c.error ?? l.error;
    if (e) setErro(e.message);
    const vs = (v.data ?? []) as Venda[];
    setVendas(vs);
    setInsumos((i.data ?? []) as Insumo[]);
    setItens((c.data ?? []) as CmvItem[]);
    setLinhas(((l.data ?? []) as Linha[]).map((x) => ({ ...x, quantity: n(x.quantity) })));
    setPeriodo((p) => p || (vs[0] ? `${vs[0].period_start}|${vs[0].period_end}` : ''));
    setLoading(false);
  }, [tenantId]);
  useEffect(() => { carregar(); }, [carregar]);

  const insumoPorId = useMemo(() => new Map(insumos.map((x) => [x.id, x])), [insumos]);
  const periodos = useMemo(() => [...new Set(vendas.map((l) => `${l.period_start}|${l.period_end}`))], [vendas]);

  // Custo unitário atual de cada composição (null = sem composição).
  const custoPorItem = useMemo(() => {
    const m = new Map<string, { custo: number; linhas: number }>();
    for (const it of itens) {
      const ls = linhas.filter((x) => x.cmv_item_id === it.id);
      m.set(`${it.kind}|${it.name_key}`, { custo: ls.reduce((s, x) => s + custoDaLinha(x, insumoPorId.get(x.ingredient_id)), 0), linhas: ls.length });
    }
    return m;
  }, [itens, linhas, insumoPorId]);

  const produtos = useMemo(() => {
    const mapa = new Map<string, Produto>();
    for (const l of vendas) {
      if (`${l.period_start}|${l.period_end}` !== periodo || (lojaShort && l.merchant_short !== lojaShort)) continue;
      const key = `${l.kind}|${chave(l.name)}`;
      const p = mapa.get(key) ?? { key, kind: l.kind, name: l.name, group: l.group_name, qtd: 0, valor: 0, custoUnit: custoPorItem.get(key)?.custo ?? null, linhas: custoPorItem.get(key)?.linhas ?? 0 };
      p.qtd += n(l.quantity); p.valor += n(l.total_value);
      mapa.set(key, p);
    }
    return [...mapa.values()].sort((a, b) => b.valor - a.valor || b.qtd - a.qtd);
  }, [vendas, periodo, lojaShort, custoPorItem]);

  const tot = useMemo(() => {
    const vendido = produtos.reduce((s, p) => s + p.valor, 0);
    const compostos = produtos.filter((p) => p.custoUnit !== null);
    const cmv = compostos.reduce((s, p) => s + p.qtd * (p.custoUnit ?? 0), 0);
    const vendidoComposto = compostos.reduce((s, p) => s + p.valor, 0);
    return { vendido, cmv, vendidoComposto, cobertura: vendido > 0 ? (vendidoComposto / vendido) * 100 : 0, pct: vendidoComposto > 0 ? (cmv / vendidoComposto) * 100 : 0, faltam: produtos.filter((p) => p.custoUnit === null && p.qtd > 0).length };
  }, [produtos]);

  const q = semAcento(busca.trim());
  const lista = produtos.filter((p) => (!q || semAcento(p.name).includes(q)) && (filtro === 'todos' || (filtro === 'sem') === (p.custoUnit === null)));

  if (loading) return <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (erro) return <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">Falha ao carregar: {erro}</div>;
  if (vendas.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-100 p-8 text-center space-y-2">
        <i className="ri-scales-3-line text-3xl text-zinc-300" />
        <p className="text-sm font-semibold text-zinc-700">O CMV do iFood usa o relatório de Cardápio</p>
        <p className="text-xs text-zinc-500 max-w-md mx-auto">A API do iFood não traz os itens dos pedidos. No Portal do Parceiro: <strong>Relatórios › Cardápio</strong> › Exportar, e suba o arquivo aqui.</p>
        <button onClick={onImportar} className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 cursor-pointer"><i className="ri-upload-2-line" /> Importar relatório de Cardápio</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período" className="border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white font-semibold text-zinc-800">
          {periodos.map((p) => { const [a, b] = p.split('|'); return <option key={p} value={p}>{dBR(a)} a {dBR(b)}</option>; })}
        </select>
        <div className="relative">
          <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto"
            className="pl-8 pr-3 py-2 w-48 border border-zinc-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-300" />
        </div>
        <div className="flex gap-1 bg-white border border-zinc-200 rounded-lg p-0.5">
          {([['todos', 'Todos'], ['sem', 'Sem composição'], ['com', 'Compostos']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFiltro(k)} className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${filtro === k ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-zinc-100 p-4">
          <p className="text-xs font-medium text-zinc-500">CMV dos compostos</p>
          <p className="text-xl font-bold text-zinc-900 mt-1 tabular-nums">{formatCurrency(tot.cmv)}</p>
          <p className="text-[11px] text-zinc-400">custo atual dos insumos × quantidade vendida</p>
        </div>
        <div className="bg-white rounded-2xl border border-zinc-100 p-4">
          <p className="text-xs font-medium text-zinc-500">CMV %</p>
          <p className={`text-xl font-bold mt-1 tabular-nums ${tot.pct > 35 ? 'text-red-600' : tot.pct > 0 ? 'text-green-700' : 'text-zinc-300'}`}>{tot.vendidoComposto > 0 ? `${tot.pct.toFixed(1)}%` : '—'}</p>
          <p className="text-[11px] text-zinc-400">sobre {formatCurrency(tot.vendidoComposto)} vendidos desses produtos</p>
        </div>
        <div className="bg-white rounded-2xl border border-zinc-100 p-4">
          <p className="text-xs font-medium text-zinc-500">Cobertura</p>
          <p className="text-xl font-bold text-zinc-900 mt-1 tabular-nums">{tot.cobertura.toFixed(0)}%</p>
          <div className="mt-1.5 h-1.5 rounded-full bg-zinc-100 overflow-hidden"><div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(100, tot.cobertura)}%` }} /></div>
          <p className="text-[11px] text-zinc-400 mt-1">das vendas com composição</p>
        </div>
        <div className="bg-white rounded-2xl border border-zinc-100 p-4">
          <p className="text-xs font-medium text-zinc-500">Faltam compor</p>
          <p className={`text-xl font-bold mt-1 tabular-nums ${tot.faltam ? 'text-amber-600' : 'text-green-700'}`}>{tot.faltam}</p>
          <p className="text-[11px] text-zinc-400">produto(s) vendidos sem insumos</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-400 border-b border-zinc-100">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Produto</th>
                <th className="text-right font-semibold px-3 py-2.5">Vendidos</th>
                <th className="text-right font-semibold px-3 py-2.5">Faturado</th>
                <th className="text-right font-semibold px-3 py-2.5">Custo unit.</th>
                <th className="text-right font-semibold px-3 py-2.5">CMV</th>
                <th className="text-right font-semibold px-3 py-2.5">CMV %</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => {
                const cmv = p.custoUnit === null ? null : p.custoUnit * p.qtd;
                const pct = cmv !== null && p.valor > 0 ? (cmv / p.valor) * 100 : null;
                return (
                  <tr key={p.key} className="border-b border-zinc-100 hover:bg-zinc-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-zinc-800">{p.name}</p>
                      <p className="text-xs text-zinc-400">{p.kind === 'complemento' ? 'Complemento' : 'Item'}{grupoUtil(p.group) ? ` · ${grupoUtil(p.group)}` : ''}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">{p.qtd.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">{formatCurrency(p.valor)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{p.custoUnit === null ? <span className="text-zinc-300">—</span> : formatCurrency(p.custoUnit)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-zinc-900">{cmv === null ? <span className="text-zinc-300 font-normal">—</span> : formatCurrency(cmv)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${pct === null ? 'text-zinc-300' : pct > 35 ? 'text-red-600 font-semibold' : 'text-green-700'}`}>{pct === null ? (cmv !== null && p.valor === 0 ? 'sem preço' : '—') : `${pct.toFixed(1)}%`}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => setEditando(p)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap ${p.custoUnit === null ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}>
                        {p.custoUnit === null ? 'Compor' : `Editar (${p.linhas})`}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {lista.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-zinc-400">Nenhum produto com esse filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-zinc-400">
        CMV gerencial: usa o custo <strong>atual</strong> dos insumos (Estoque) e não entra na DRE — lá o CMV é o das compras. A composição vale para o produto com o mesmo nome em todas as lojas iFood desta loja.
      </p>

      {editando && (
        <EditorComposicao tenantId={tenantId} produto={editando} insumos={insumos} insumoPorId={insumoPorId}
          iniciais={(() => { const it = itens.find((x) => `${x.kind}|${x.name_key}` === editando.key); return it ? linhas.filter((l) => l.cmv_item_id === it.id).map((l) => ({ ingredient_id: l.ingredient_id, quantity: String(l.quantity).replace('.', ','), unit: l.unit })) : []; })()}
          onClose={() => setEditando(null)} onSaved={() => { setEditando(null); carregar(); }} />
      )}
    </div>
  );
}

function EditorComposicao({ tenantId, produto, insumos, insumoPorId, iniciais, onClose, onSaved }: {
  tenantId: string; produto: Produto; insumos: Insumo[]; insumoPorId: Map<string, Insumo>; iniciais: LinhaEdit[]; onClose: () => void; onSaved: () => void;
}) {
  const [ls, setLs] = useState<LinhaEdit[]>(iniciais);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiar, setCopiar] = useState(false);
  const [itensMenu, setItensMenu] = useState<{ id: string; name: string }[]>([]);
  const [buscaMenu, setBuscaMenu] = useState('');

  const qtd = (s: string) => Number(String(s).replace(',', '.')) || 0;
  const custoUnit = ls.reduce((s, l) => s + custoDaLinha({ quantity: qtd(l.quantity), unit: l.unit }, insumoPorId.get(l.ingredient_id)), 0);
  const precoMedio = produto.qtd > 0 ? produto.valor / produto.qtd : 0;
  const achados = busca.trim().length >= 2 ? insumos.filter((i) => semAcento(i.name).includes(semAcento(busca.trim())) && !ls.some((l) => l.ingredient_id === i.id)).slice(0, 8) : [];

  const addInsumo = (i: Insumo) => { setLs([...ls, { ingredient_id: i.id, quantity: '', unit: unidadePadrao(i.unit) }]); setBusca(''); };

  const abrirCopiar = async () => {
    setCopiar(true);
    if (itensMenu.length) return;
    const { data } = await supabase.from('menu_items').select('id, name').eq('tenant_id', tenantId).is('deleted_at', null).order('name').limit(2000);
    setItensMenu((data ?? []) as { id: string; name: string }[]);
  };
  const copiarFicha = async (itemId: string) => {
    const { data, error } = await supabase.rpc('fn_get_item_ingredients', { p_tenant_id: tenantId, p_item_id: itemId });
    if (error) { setErro(error.message); return; }
    const rows = (data ?? []) as { ingredient_id: string; quantity: number; unit: string }[];
    if (rows.length === 0) { setErro('Esse item do cardápio não tem ficha técnica.'); return; }
    const novas = rows.filter((r) => !ls.some((l) => l.ingredient_id === r.ingredient_id))
      .map((r) => ({ ingredient_id: r.ingredient_id, quantity: String(r.quantity).replace('.', ','), unit: r.unit }));
    setLs([...ls, ...novas]);
    setCopiar(false);
    setErro(null);
  };

  const salvar = async (remover = false) => {
    const validas = remover ? [] : ls.filter((l) => qtd(l.quantity) > 0);
    if (!remover && validas.length !== ls.length) { setErro('Informe a quantidade de todos os insumos (ou remova a linha).'); return; }
    setSalvando(true);
    setErro(null);
    const { error } = await supabase.rpc('fn_ifood_cmv_salvar', {
      p_tenant: tenantId, p_kind: produto.kind, p_name: produto.name,
      p_linhas: validas.map((l) => ({ ingredient_id: l.ingredient_id, quantity: qtd(l.quantity), unit: l.unit })),
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => !salvando && onClose()}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-100">
          <div className="min-w-0">
            <p className="text-xs text-zinc-500">{produto.kind === 'complemento' ? 'Complemento' : 'Item'} do iFood · {produto.qtd.toLocaleString('pt-BR')} vendidos</p>
            <h3 className="font-bold text-zinc-900 leading-tight">{produto.name}</h3>
          </div>
          <button onClick={onClose} disabled={salvando} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer shrink-0"><i className="ri-close-line text-zinc-500" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <i className="ri-add-line absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Adicionar insumo (digite o nome)"
                className="w-full pl-8 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
              {achados.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden">
                  {achados.map((i) => (
                    <button key={i.id} onClick={() => addInsumo(i)} className="w-full flex justify-between gap-3 px-3 py-2 text-sm text-left hover:bg-zinc-50 cursor-pointer">
                      <span className="text-zinc-800">{i.name}</span>
                      <span className="text-xs text-zinc-400 tabular-nums whitespace-nowrap">{formatCurrency(n(i.unit_price))}/{UNID_LABEL[i.unit] ?? i.unit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={abrirCopiar} className="px-3 py-2 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
              <i className="ri-file-copy-line" /> Copiar ficha do cardápio
            </button>
          </div>

          {copiar && (
            <div className="rounded-xl border border-zinc-200 p-3 space-y-2">
              <input value={buscaMenu} onChange={(e) => setBuscaMenu(e.target.value)} placeholder="Item do cardápio do ERPOS" autoFocus
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
              <div className="max-h-40 overflow-y-auto divide-y divide-zinc-100">
                {itensMenu.filter((m) => !buscaMenu.trim() || semAcento(m.name).includes(semAcento(buscaMenu.trim()))).slice(0, 30).map((m) => (
                  <button key={m.id} onClick={() => copiarFicha(m.id)} className="w-full text-left px-2 py-1.5 text-sm hover:bg-zinc-50 cursor-pointer">{m.name}</button>
                ))}
              </div>
              <p className="text-[11px] text-zinc-400">Copia os insumos da ficha técnica desse item para cá; confira e salve.</p>
            </div>
          )}

          <div className="rounded-xl border border-zinc-100 divide-y divide-zinc-100">
            {ls.length === 0 && <p className="px-3 py-6 text-center text-sm text-zinc-400">Nenhum insumo ainda. Adicione acima.</p>}
            {ls.map((l, idx) => {
              const ins = insumoPorId.get(l.ingredient_id);
              const custo = custoDaLinha({ quantity: qtd(l.quantity), unit: l.unit }, ins);
              return (
                <div key={l.ingredient_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <div className="flex-1 min-w-[160px]">
                    <p className="text-sm text-zinc-800">{ins?.name ?? 'Insumo removido'}</p>
                    <p className="text-[11px] text-zinc-400 tabular-nums">{ins ? `${formatCurrency(n(ins.unit_price))}/${UNID_LABEL[ins.unit] ?? ins.unit}` : ''}</p>
                  </div>
                  <input inputMode="decimal" value={l.quantity} placeholder="Qtd"
                    onChange={(e) => setLs(ls.map((x, i) => (i === idx ? { ...x, quantity: e.target.value.replace(/[^\d,.]/g, '') } : x)))}
                    className="w-20 px-2 py-1.5 border border-zinc-200 rounded-lg text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-red-300" />
                  <select value={l.unit} onChange={(e) => setLs(ls.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))}
                    className="px-2 py-1.5 border border-zinc-200 rounded-lg text-sm bg-white">
                    {unidadesDo(ins?.unit ?? l.unit).map((u) => <option key={u} value={u}>{UNID_LABEL[u]}</option>)}
                  </select>
                  <span className="w-20 text-right text-sm tabular-nums text-zinc-700">{formatCurrency(custo)}</span>
                  <button onClick={() => setLs(ls.filter((_, i) => i !== idx))} title="Remover" className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"><i className="ri-delete-bin-line" /></button>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-3 rounded-xl bg-zinc-50 p-3 text-center">
            <div><p className="text-[11px] text-zinc-500">Custo por unidade</p><p className="font-bold tabular-nums text-zinc-900">{formatCurrency(custoUnit)}</p></div>
            <div><p className="text-[11px] text-zinc-500">Preço médio no iFood</p><p className="font-bold tabular-nums text-zinc-900">{precoMedio > 0 ? formatCurrency(precoMedio) : '—'}</p></div>
            <div><p className="text-[11px] text-zinc-500">CMV %</p><p className={`font-bold tabular-nums ${precoMedio > 0 && (custoUnit / precoMedio) * 100 > 35 ? 'text-red-600' : 'text-green-700'}`}>{precoMedio > 0 ? `${((custoUnit / precoMedio) * 100).toFixed(1)}%` : '—'}</p></div>
          </div>

          {erro && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{erro}</div>}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-100">
          {iniciais.length > 0 && (
            <button onClick={async () => { if (await confirmar({ titulo: 'Remover a composição deste produto?', confirmarLabel: 'Remover', perigo: true })) salvar(true); }} disabled={salvando}
              className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg cursor-pointer">Remover composição</button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} disabled={salvando} className="px-4 py-2 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer">Cancelar</button>
          <button onClick={() => salvar(false)} disabled={salvando || ls.length === 0}
            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50 cursor-pointer">{salvando ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}
