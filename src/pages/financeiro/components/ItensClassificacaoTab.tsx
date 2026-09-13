import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useDreGroups, isGrupoDespesa } from '@/hooks/useDreGroups';

// ── Classificação de itens (base de correlações) ──
// Cada item comprado (fornecedor + código do produto; sem código, descrição) tem UMA
// classificação: CMV ou despesa com categoria DRE. É isso que separa, na mesma nota, a bebida
// (CMV) do produto de limpeza (despesa) — o pagamento/CNPJ não classifica nada.
// Alimentada sozinha pelo banco (fin_item_classifications): toda nota de entrada e todo item
// de compra entram aqui; item novo fica pendente. Classificar reaplica nas compras já lançadas.

interface Row {
  id: string;
  supplier_key: string;
  supplier_name: string | null;
  supplier_code: string | null;
  ean: string | null;
  ncm: string | null;
  description: string;
  unit_label: string | null;
  classe: 'cmv' | 'despesa' | null;
  dre_category_id: string | null;
  ingredient_id: string | null;
  suggested_classe: 'cmv' | 'despesa' | null;
  suggested_dre_category_id: string | null;
  suggestion_reason: string | null;
  auto_classified: boolean;
  last_unit_price: number | null;
  last_seen_at: string | null;
  last_source: string | null;
  ingredients: { name: string } | null;
}
interface Cat { id: string; name: string; group_type: string }
type Filtro = 'pendentes' | 'conferir' | 'cmv' | 'despesa' | 'todos';

const brl = (n: number | null | undefined) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n ?? 0));
const dataBR = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—');
const docFmt = (k: string) => {
  if (k.startsWith('n:')) return 'sem CNPJ';
  return k.length === 14 ? `${k.slice(0, 2)}.${k.slice(2, 5)}.${k.slice(5, 8)}/${k.slice(8, 12)}-${k.slice(12)}` : k;
};

export default function ItensClassificacaoTab() {
  const { user } = useAuth();
  const { success: toastOk, error: toastErr } = useToast();
  const tenantId = user?.tenantId;
  const podeClassificar = user?.perfil === 'admin';
  const { groupMeta } = useDreGroups();

  const [rows, setRows] = useState<Row[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('pendentes');
  const [busca, setBusca] = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [catLote, setCatLote] = useState('');
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    const [{ data, error }, { data: c }] = await Promise.all([
      supabase.from('fin_item_classifications').select('*, ingredients(name)').eq('tenant_id', tenantId)
        .order('last_seen_at', { ascending: false, nullsFirst: false }).range(0, 4999),
      supabase.from('fin_dre_categories').select('id, name, group_type').eq('tenant_id', tenantId)
        .is('deleted_at', null).eq('is_active', true).order('name'),
    ]);
    if (error) toastErr('Não foi possível carregar os itens', error.message);
    setRows((data ?? []) as unknown as Row[]);
    setCats(((c ?? []) as Cat[]).filter((x) => isGrupoDespesa(x.group_type)));
    setLoading(false);
  }, [tenantId, toastErr]);

  useEffect(() => { carregar(); }, [carregar]);

  const catNome = useCallback((id: string | null) => {
    const c = cats.find((x) => x.id === id);
    if (!c) return null;
    const g = groupMeta(c.group_type)?.label;
    return g ? `${c.name} · ${g}` : c.name;
  }, [cats, groupMeta]);

  const resumo = useMemo(() => ({
    pendentes: rows.filter((r) => !r.classe).length,
    conferir: rows.filter((r) => r.auto_classified).length,
    cmv: rows.filter((r) => r.classe === 'cmv').length,
    despesa: rows.filter((r) => r.classe === 'despesa').length,
  }), [rows]);

  const fornecedores = useMemo(() => [...new Set(rows.map((r) => r.supplier_name ?? '').filter(Boolean))].sort(), [rows]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro === 'pendentes' && r.classe) return false;
      if (filtro === 'conferir' && !r.auto_classified) return false;
      if (filtro === 'cmv' && r.classe !== 'cmv') return false;
      if (filtro === 'despesa' && r.classe !== 'despesa') return false;
      if (fornecedor && r.supplier_name !== fornecedor) return false;
      if (!q) return true;
      return [r.description, r.supplier_name, r.supplier_code, r.ncm, r.ingredients?.name].some((v) => (v ?? '').toLowerCase().includes(q));
    });
  }, [rows, filtro, fornecedor, busca]);

  const classificar = async (ids: string[], classe: 'cmv' | 'despesa' | null, cat: string | null = null) => {
    if (!tenantId || ids.length === 0) return false;
    if (classe === 'despesa' && !cat) { toastErr('Escolha a categoria da despesa', ''); return false; }
    setBusy(true);
    const { data, error } = await supabase.rpc('fn_item_classify', { p_tenant: tenantId, p_ids: ids, p_classe: classe, p_dre_category_id: cat });
    setBusy(false);
    if (error) { toastErr('Não foi possível classificar', error.message); return false; }
    const r = (data ?? {}) as { itens?: number; lancamentos_atualizados?: number };
    toastOk(`${r.itens ?? ids.length} item(ns) ${classe ? 'classificado(s)' : 'voltaram a pendente'}`,
      r.lancamentos_atualizados ? `${r.lancamentos_atualizados} lançamento(s) de compra corrigido(s) na DRE` : '');
    return true;
  };

  const aplicar = async (ids: string[], classe: 'cmv' | 'despesa' | null, cat: string | null = null) => {
    if (await classificar(ids, classe, cat)) { setSel(new Set()); await carregar(); }
  };

  // Aceita as sugestões dos selecionados, agrupando por (classe, categoria).
  const aceitarSugestoes = async (alvo: Row[]) => {
    const grupos = new Map<string, { classe: 'cmv' | 'despesa'; cat: string | null; ids: string[] }>();
    for (const r of alvo) {
      if (!r.suggested_classe) continue;
      if (r.suggested_classe === 'despesa' && !r.suggested_dre_category_id) continue;
      const k = `${r.suggested_classe}|${r.suggested_dre_category_id ?? ''}`;
      const g = grupos.get(k) ?? { classe: r.suggested_classe, cat: r.suggested_dre_category_id, ids: [] };
      g.ids.push(r.id);
      grupos.set(k, g);
    }
    if (grupos.size === 0) { toastErr('Nenhuma sugestão aplicável', 'Os selecionados não têm sugestão com categoria.'); return; }
    for (const g of grupos.values()) await classificar(g.ids, g.classe, g.cat);
    setSel(new Set());
    await carregar();
  };

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todosMarcados = filtrados.length > 0 && filtrados.every((r) => sel.has(r.id));
  const selecionados = rows.filter((r) => sel.has(r.id));

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-zinc-800">Classificação de itens</h2>
        <p className="text-xs text-zinc-500 mt-0.5 max-w-3xl">
          Cada produto de cada fornecedor tem uma classificação: <b>CMV</b> (comida, bebida, embalagem de delivery) ou <b>despesa</b> com categoria da DRE (limpeza, papelaria, manutenção…).
          É ela que separa, numa mesma nota, a bebida do produto de limpeza. Toda nota de entrada e toda compra lançada entram aqui sozinhas; item novo fica pendente.
          Item ligado a insumo do estoque é sempre CMV. Ao classificar, as compras já lançadas desse item são corrigidas na DRE.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          ['pendentes', 'Pendentes', resumo.pendentes, 'text-amber-600', 'sem classificação (contam como CMV)'],
          ['conferir', 'Automáticos', resumo.conferir, 'text-sky-600', 'CMV pelo NCM/insumo — confira'],
          ['cmv', 'CMV', resumo.cmv, 'text-zinc-700', 'custo da mercadoria'],
          ['despesa', 'Despesa', resumo.despesa, 'text-violet-600', 'sai do CMV na DRE'],
        ] as const).map(([id, label, n, cor, sub]) => (
          <button key={id} onClick={() => setFiltro(id)}
            className={`text-left bg-white rounded-xl border p-4 cursor-pointer ${filtro === id ? 'border-amber-400' : 'border-zinc-100 hover:border-zinc-200'}`}>
            <p className="text-[11px] font-semibold text-zinc-400 uppercase">{label}</p>
            <p className={`text-xl font-bold mt-1 ${cor}`}>{n}</p>
            <p className="text-xs text-zinc-500">{sub}</p>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-zinc-100 p-3 flex flex-wrap items-center gap-2">
        {([['pendentes', 'Pendentes'], ['conferir', 'Automáticos'], ['cmv', 'CMV'], ['despesa', 'Despesa'], ['todos', 'Todos']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFiltro(id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${filtro === id ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
            {label}
          </button>
        ))}
        <select value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}
          className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 max-w-[220px] focus:outline-none focus:border-amber-400">
          <option value="">Todos os fornecedores</option>
          {fornecedores.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto, código, NCM ou insumo"
          className="flex-1 min-w-[180px] text-sm border border-zinc-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-400" />
      </div>

      {podeClassificar && sel.size > 0 && (
        <div className="sticky top-0 z-10 bg-zinc-900 text-white rounded-xl p-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">{sel.size} selecionado(s)</span>
          <button disabled={busy} onClick={() => aplicar([...sel], 'cmv')}
            className="px-3 py-1.5 rounded-lg bg-white text-zinc-900 font-semibold hover:bg-zinc-100 disabled:opacity-50 cursor-pointer">Marcar como CMV</button>
          <span className="w-px h-5 bg-zinc-700" />
          <select value={catLote} onChange={(e) => setCatLote(e.target.value)} className="text-zinc-900 rounded-lg px-2 py-1.5">
            <option value="">Categoria da despesa…</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{catNome(c.id)}</option>)}
          </select>
          <button disabled={busy || !catLote} onClick={() => aplicar([...sel], 'despesa', catLote)}
            className="px-3 py-1.5 rounded-lg bg-violet-500 font-semibold hover:bg-violet-600 disabled:opacity-50 cursor-pointer">Marcar como despesa</button>
          <span className="w-px h-5 bg-zinc-700" />
          <button disabled={busy} onClick={() => aceitarSugestoes(selecionados)}
            className="px-3 py-1.5 rounded-lg bg-amber-500 font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer">Aceitar sugestões</button>
          <button disabled={busy} onClick={() => aplicar([...sel], null)}
            className="px-3 py-1.5 rounded-lg bg-zinc-700 font-semibold hover:bg-zinc-600 disabled:opacity-50 cursor-pointer">Voltar a pendente</button>
          <button onClick={() => setSel(new Set())} className="ml-auto text-zinc-400 hover:text-white cursor-pointer">Limpar seleção</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-400">Carregando…</div>
        ) : filtrados.length === 0 ? (
          <div className="p-10 text-center">
            <i className="ri-price-tag-3-line text-3xl text-zinc-300" />
            <p className="text-sm text-zinc-500 mt-2">{rows.length === 0 ? 'Nenhum item ainda: eles aparecem quando chegam notas de entrada ou compras.' : filtro === 'pendentes' ? 'Nenhum item pendente. Tudo classificado.' : 'Nada neste filtro.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase text-zinc-400 border-b border-zinc-100">
                  {podeClassificar && (
                    <th className="px-3 py-2.5 w-8">
                      <input type="checkbox" checked={todosMarcados}
                        onChange={() => setSel(todosMarcados ? new Set() : new Set(filtrados.map((r) => r.id)))} />
                    </th>
                  )}
                  <th className="text-left px-3 py-2.5 font-semibold">Fornecedor</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Produto</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Insumo</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Última compra</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Classificação</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((r) => {
                  const sugCat = r.suggested_dre_category_id ? catNome(r.suggested_dre_category_id) : null;
                  return (
                    <tr key={r.id} className={`border-b border-zinc-50 hover:bg-zinc-50/60 ${sel.has(r.id) ? 'bg-amber-50/50' : ''}`}>
                      {podeClassificar && (
                        <td className="px-3 py-2.5"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                      )}
                      <td className="px-3 py-2.5 min-w-[160px]">
                        <p className="font-medium text-zinc-800 truncate max-w-[200px]" title={r.supplier_name ?? ''}>{r.supplier_name ?? '—'}</p>
                        <p className="text-[10px] text-zinc-400 font-mono">{docFmt(r.supplier_key)}</p>
                      </td>
                      <td className="px-3 py-2.5 min-w-[240px]">
                        <p className="text-zinc-800 truncate max-w-[340px]" title={r.description}>{r.description || '—'}</p>
                        <p className="text-[10px] text-zinc-400">
                          {r.supplier_code ? `cód. ${r.supplier_code}` : 'sem código'}{r.ncm ? ` · NCM ${r.ncm}` : ''}{r.unit_label ? ` · ${r.unit_label}` : ''}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-zinc-600 whitespace-nowrap">
                        {r.ingredients?.name ? <span className="inline-flex items-center gap-1"><i className="ri-links-line text-emerald-600" />{r.ingredients.name}</span> : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-zinc-600 whitespace-nowrap">
                        <p>{dataBR(r.last_seen_at)}</p>
                        <p className="text-zinc-400">{r.last_unit_price != null ? brl(r.last_unit_price) : ''}</p>
                      </td>
                      <td className="px-3 py-2.5 min-w-[260px]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {r.ingredient_id ? (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700" title="Item de estoque é sempre CMV">CMV · estoque</span>
                          ) : podeClassificar ? (
                            <>
                              <button disabled={busy} onClick={() => aplicar([r.id], 'cmv')}
                                className={`text-[11px] font-bold px-2 py-1 rounded-lg cursor-pointer disabled:opacity-50 ${r.classe === 'cmv' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>CMV</button>
                              <select value={r.classe === 'despesa' ? r.dre_category_id ?? '' : ''} disabled={busy}
                                onChange={(e) => { if (e.target.value) aplicar([r.id], 'despesa', e.target.value); }}
                                className={`text-[11px] font-semibold rounded-lg px-1.5 py-1 max-w-[190px] cursor-pointer ${r.classe === 'despesa' ? 'bg-violet-500 text-white' : 'bg-zinc-100 text-zinc-600'}`}>
                                <option value="">Despesa…</option>
                                {cats.map((c) => <option key={c.id} value={c.id}>{catNome(c.id)}</option>)}
                              </select>
                            </>
                          ) : (
                            <span className="text-xs text-zinc-600">{r.classe === 'cmv' ? 'CMV' : r.classe === 'despesa' ? catNome(r.dre_category_id) ?? 'Despesa' : 'Pendente'}</span>
                          )}
                          {r.auto_classified && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700" title={r.suggestion_reason ?? ''}>automático</span>}
                        </div>
                        {!r.classe && r.suggested_classe && (
                          <p className="text-[10px] text-amber-700 mt-1">
                            Sugestão: {r.suggested_classe === 'cmv' ? 'CMV' : `despesa${sugCat ? ` · ${sugCat}` : ''}`}
                            {r.suggestion_reason ? ` (${r.suggestion_reason})` : ''}
                            {podeClassificar && (r.suggested_classe === 'cmv' || r.suggested_dre_category_id) && (
                              <button disabled={busy} onClick={() => aceitarSugestoes([r])} className="ml-1.5 font-bold underline cursor-pointer disabled:opacity-50">aceitar</button>
                            )}
                          </p>
                        )}
                        {r.auto_classified && r.suggestion_reason && (
                          <p className="text-[10px] text-sky-600 mt-1">{r.suggestion_reason}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {filtrados.length > 0 && <p className="text-[11px] text-zinc-400">{filtrados.length} de {rows.length} itens</p>}
    </div>
  );
}
