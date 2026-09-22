import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useDreGroups, isGrupoDespesa } from '@/hooks/useDreGroups';
import { useEstoque, type Insumo as InsumoEstoque } from '@/contexts/EstoqueContext';
import { useIngredientCategories } from '@/hooks/useIngredientCategories';
import InsumoModal from '@/pages/estoque/components/insumos/InsumoModal';
import CategoriaCombobox from './CategoriaCombobox';

// ── Classificação de itens (base de correlações) ──
// Cada item comprado (fornecedor + código do produto; sem código, descrição) tem UMA
// classificação: CMV ou despesa com categoria DRE. É isso que separa, na mesma nota, a bebida
// (CMV) do produto de limpeza (despesa) — o pagamento/CNPJ não classifica nada.
// Alimentada sozinha pelo banco (fin_item_classifications): toda nota de entrada e todo item
// de compra entram aqui; item novo fica pendente. Classificar reaplica nas compras já lançadas.
// CMV também tem categoria: a categoria de mercadoria (fin_merchandise_categories — a mesma
// lista dos insumos). Item ligado a insumo usa a do insumo. Classificar grava a categoria nos
// itens de compra já lançados, e é dela que a DRE abre o CMV por categoria.
// Vínculo com insumo do estoque (fn_item_link_ingredient): o item vira CMV na categoria do insumo
// e, com CNPJ + código do produto, fica memorizado para as próximas notas e recebimentos
// (fiscal_inbound_item_links). O estoque só entra no recebimento — compras antigas não mudam.
// Notas de serviço (NFS-e) também entram aqui desde 2026-09-18 (is_service), sem insumo. Despesa
// grava a categoria nas contas a pagar das notas desse serviço e nota nova já vira conta com ela.
// CMV = fornecedor de produto que emite nota de serviço: as próximas notas entram como COMPRA.

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
  merchandise_category_id: string | null;
  ingredient_id: string | null;
  units_per_package: number | null;
  suggested_classe: 'cmv' | 'despesa' | null;
  suggested_dre_category_id: string | null;
  suggestion_reason: string | null;
  auto_classified: boolean;
  last_unit_price: number | null;
  last_seen_at: string | null;
  last_source: string | null;
  is_service: boolean;
}
interface Cat { id: string; name: string; group_type: string }
interface Merc { id: string; name: string }
interface Insumo { id: string; name: string; unit: string; merchandise_category_id: string | null; category: string | null }
type Filtro = 'pendentes' | 'estoque' | 'cmv' | 'cmv_sem' | 'despesa' | 'servicos' | 'todos';

const brl = (n: number | null | undefined) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n ?? 0));
const dataBR = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—');
const docFmt = (k: string) => {
  if (k.startsWith('n:')) return 'sem CNPJ';
  return k.length === 14 ? `${k.slice(0, 2)}.${k.slice(2, 5)}.${k.slice(5, 8)}/${k.slice(8, 12)}-${k.slice(12)}` : k;
};
const un = (u: string | null | undefined) => (!u || u === 'unit' ? 'un' : u);
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export default function ItensClassificacaoTab() {
  const { user } = useAuth();
  const { success: toastOk, error: toastErr } = useToast();
  const tenantId = user?.tenantId;
  const podeClassificar = user?.perfil === 'admin';
  const { groupMeta } = useDreGroups();

  const [rows, setRows] = useState<Row[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [mercs, setMercs] = useState<Merc[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('pendentes');
  const [busca, setBusca] = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [catLote, setCatLote] = useState('');
  const [mercLote, setMercLote] = useState('');
  const [busy, setBusy] = useState(false);
  // Vínculo em edição: escolhido o insumo, pergunta quantas unidades dele vêm em 1 unidade do item
  const [vinc, setVinc] = useState<{ rowId: string; ingId: string; upp: string } | null>(null);
  // Criar insumo a partir do vínculo (mesma janela do Estoque); ao salvar, já fica escolhido
  const [novoInsumo, setNovoInsumo] = useState<{ rowId: string; nome: string } | null>(null);
  const { upsertInsumo, reloadInsumos } = useEstoque();
  const { names: categoriasInsumo, addCategory } = useIngredientCategories();

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    const [{ data, error }, { data: c }, { data: m }, { data: ins, error: insErr }] = await Promise.all([
      supabase.from('fin_item_classifications').select('*').eq('tenant_id', tenantId)
        .order('last_seen_at', { ascending: false, nullsFirst: false }).range(0, 4999),
      supabase.from('fin_dre_categories').select('id, name, group_type').eq('tenant_id', tenantId)
        .is('deleted_at', null).eq('is_active', true).order('name'),
      supabase.from('fin_merchandise_categories').select('id, name').eq('tenant_id', tenantId)
        .eq('is_active', true).order('sort_order').order('name'),
      // Por RPC: a leitura direta de ingredients segue a última loja do login (admin multi-loja)
      supabase.rpc('fn_item_link_options', { p_tenant: tenantId }),
    ]);
    if (error) toastErr('Não foi possível carregar os itens', error.message);
    if (insErr) toastErr('Não foi possível carregar os insumos', insErr.message);
    setRows((data ?? []) as unknown as Row[]);
    setCats(((c ?? []) as Cat[]).filter((x) => isGrupoDespesa(x.group_type)));
    setMercs((m ?? []) as Merc[]);
    setInsumos((ins ?? []) as Insumo[]);
    setLoading(false);
  }, [tenantId, toastErr]);

  useEffect(() => { carregar(); }, [carregar]);

  // Classificado pelo chat do assistente (caixa de pendências): recarrega sem precisar de F5
  useEffect(() => {
    const onClassificados = (e: Event) => {
      const t = (e as CustomEvent<{ tenantId?: string }>).detail?.tenantId;
      if (!t || t === tenantId) carregar();
    };
    window.addEventListener('itens-classificados', onClassificados);
    return () => window.removeEventListener('itens-classificados', onClassificados);
  }, [carregar, tenantId]);

  const catNome = useCallback((id: string | null) => {
    const c = cats.find((x) => x.id === id);
    if (!c) return null;
    const g = groupMeta(c.group_type)?.label;
    return g ? `${c.name} · ${g}` : c.name;
  }, [cats, groupMeta]);

  const mercNome = useCallback((id: string | null | undefined) => (id ? mercs.find((x) => x.id === id)?.name ?? null : null), [mercs]);
  const insMap = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos]);
  // Categoria do CMV que vale para o item: a do insumo (item de estoque) ou a escolhida aqui
  const cmvCat = useCallback((r: Row) => {
    if (r.ingredient_id) {
      const ing = insMap.get(r.ingredient_id);
      return mercNome(ing?.merchandise_category_id) ?? ing?.category ?? null;
    }
    return mercNome(r.merchandise_category_id);
  }, [mercNome, insMap]);

  // Opções dos seletores com busca: despesa = categoria + grupo da DRE; CMV = categorias de mercadoria
  const catOptions = useMemo(
    () => cats.map((c) => ({ id: c.id, label: c.name, sub: groupMeta(c.group_type)?.label ?? null })),
    [cats, groupMeta],
  );
  const mercOptions = useMemo(() => mercs.map((m) => ({ id: m.id, label: m.name, sub: 'CMV' })), [mercs]);
  const insOptions = useMemo(
    () => insumos.map((i) => ({ id: i.id, label: i.name, sub: [un(i.unit), mercNome(i.merchandise_category_id) ?? i.category].filter(Boolean).join(' · ') })),
    [insumos, mercNome],
  );

  const resumo = useMemo(() => ({
    pendentes: rows.filter((r) => !r.classe).length,
    estoque: rows.filter((r) => r.ingredient_id).length,
    cmv: rows.filter((r) => r.classe === 'cmv').length,
    cmvSem: rows.filter((r) => r.classe === 'cmv' && !cmvCat(r)).length,
    despesa: rows.filter((r) => r.classe === 'despesa').length,
    servicos: rows.filter((r) => r.is_service).length,
  }), [rows, cmvCat]);

  const fornecedores = useMemo(() => [...new Set(rows.map((r) => r.supplier_name ?? '').filter(Boolean))].sort(), [rows]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro === 'pendentes' && r.classe) return false;
      if (filtro === 'estoque' && !r.ingredient_id) return false;
      if (filtro === 'cmv' && r.classe !== 'cmv') return false;
      if (filtro === 'cmv_sem' && (r.classe !== 'cmv' || cmvCat(r))) return false;
      if (filtro === 'despesa' && r.classe !== 'despesa') return false;
      if (filtro === 'servicos' && !r.is_service) return false;
      if (fornecedor && r.supplier_name !== fornecedor) return false;
      if (!q) return true;
      const ingNome = r.ingredient_id ? insMap.get(r.ingredient_id)?.name : null;
      return [r.description, r.supplier_name, r.supplier_code, r.ncm, ingNome, cmvCat(r)].some((v) => (v ?? '').toLowerCase().includes(q));
    });
  }, [rows, filtro, fornecedor, busca, cmvCat, insMap]);

  // merc = categoria de mercadoria do CMV; sem ela, o item mantém a que já tinha.
  const classificar = async (ids: string[], classe: 'cmv' | 'despesa' | null, cat: string | null = null, merc: string | null = null) => {
    if (!tenantId || ids.length === 0) return false;
    if (classe === 'despesa' && !cat) { toastErr('Escolha a categoria da despesa', ''); return false; }
    setBusy(true);
    const { data, error } = await supabase.rpc('fn_item_classify', {
      p_tenant: tenantId, p_ids: ids, p_classe: classe, p_dre_category_id: cat, p_merchandise_category_id: merc,
    });
    setBusy(false);
    if (error) { toastErr('Não foi possível classificar', error.message); return false; }
    const r = (data ?? {}) as { itens?: number; lancamentos_atualizados?: number; contas_atualizadas?: number; notas_como_despesa?: number };
    const contas = r.contas_atualizadas ?? 0;
    const compras = (r.lancamentos_atualizados ?? 0) - contas;
    toastOk(`${r.itens ?? ids.length} item(ns) ${classe ? 'classificado(s)' : 'voltaram a pendente'}`, [
      compras > 0 ? `${compras} lançamento(s) de compra corrigido(s) na DRE.` : '',
      contas > 0 ? `${contas} conta(s) a pagar receberam a categoria.` : '',
      r.notas_como_despesa ? `As próximas notas entram como compra. ${r.notas_como_despesa} nota(s) já lançada(s) como despesa continuam como estão.` : '',
    ].filter(Boolean).join(' '));
    return true;
  };

  const aplicar = async (ids: string[], classe: 'cmv' | 'despesa' | null, cat: string | null = null, merc: string | null = null) => {
    if (await classificar(ids, classe, cat, merc)) { setSel(new Set()); await carregar(); }
  };

  // Vincula (ou desvincula, ingId nulo) o item a um insumo do estoque.
  const vincular = async (r: Row, ingId: string | null, upp = 1) => {
    if (!tenantId) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('fn_item_link_ingredient', {
      p_tenant: tenantId, p_id: r.id, p_ingredient_id: ingId, p_units_per_package: upp,
    });
    setBusy(false);
    if (error) { toastErr('Não foi possível salvar o vínculo', error.message); return; }
    const d = (data ?? {}) as { memorizado?: boolean; lancamentos_atualizados?: number };
    if (ingId) {
      const nome = insMap.get(ingId)?.name ?? 'insumo';
      toastOk(`Vinculado a ${nome}`, [
        d.memorizado ? 'As próximas notas e recebimentos deste produto já vêm com o insumo.' : 'Produto sem CNPJ/código do fornecedor: no recebimento o insumo ainda é escolhido à mão.',
        d.lancamentos_atualizados ? `${d.lancamentos_atualizados} compra(s) já lançada(s) corrigida(s) na DRE.` : '',
      ].filter(Boolean).join(' '));
    } else {
      toastOk('Vínculo removido', d.memorizado ? 'As próximas notas deixam de sugerir este insumo.' : '');
    }
    setVinc(null);
    await carregar();
  };

  // Cria o insumo (mesmo caminho da tela de Estoque) e abre o vínculo com ele já escolhido
  const criarInsumo = async (rowId: string, data: Omit<InsumoEstoque, 'estoqueAtual' | 'ultimaEntrada' | 'fichaTecnica' | 'esgotado'> & { id?: string }) => {
    setBusy(true);
    if (data.categoria && data.categoria !== 'Sem categoria' && !categoriasInsumo.includes(data.categoria)) {
      await addCategory(data.categoria);
    }
    const id = await upsertInsumo({
      nome: data.nome, unidade: data.unidade, categoria: data.categoria, usageType: data.usageType,
      precoUnitario: data.precoUnitario, priceSource: data.priceSource, estoqueMinimo: data.estoqueMinimo,
      purchaseUnit: data.purchaseUnit, purchaseFactor: data.purchaseFactor ?? 1, dreCategoryId: data.dreCategoryId,
      rastrearEstoque: data.rastrearEstoque, contaInventario: data.contaInventario,
      unidadeContagem: data.unidadeContagem ?? null, fatorContagem: data.fatorContagem ?? null,
    });
    setBusy(false);
    if (!id) { toastErr('Não foi possível criar o insumo', 'Confira se já não existe um insumo com este nome.'); return; }
    toastOk(`Insumo "${data.nome}" criado`, 'Agora confirme quanto dele vem em cada unidade do produto.');
    await Promise.all([carregar(), reloadInsumos()]);
    setVinc({ rowId, ingId: id, upp: '1' });
  };

  const salvarVinculo = (r: Row) => {
    if (!vinc) return;
    const upp = Number(vinc.upp.replace(',', '.'));
    if (!(upp > 0)) { toastErr('Quantidade inválida', 'Informe quantas unidades do insumo vêm em 1 unidade do item.'); return; }
    vincular(r, vinc.ingId, upp);
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

  const celulaInsumo = (r: Row) => {
    if (r.is_service) return <span className="text-[11px] text-zinc-400">nota de serviço: sem vínculo com o estoque</span>;
    const ing = r.ingredient_id ? insMap.get(r.ingredient_id) : undefined;
    if (!podeClassificar) {
      return ing ? <span className="inline-flex items-center gap-1"><i className="ri-links-line text-emerald-600" />{ing.name}</span> : <span className="text-zinc-300">—</span>;
    }
    if (vinc?.rowId === r.id) {
      const alvo = insMap.get(vinc.ingId);
      return (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1.5 w-[250px]">
          <p className="text-[11px] font-semibold text-zinc-700 truncate"><i className="ri-links-line text-emerald-600" /> {alvo?.name}</p>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-600 whitespace-nowrap">
            1 {r.unit_label || 'un'} =
            <input autoFocus value={vinc.upp} inputMode="decimal"
              onChange={(e) => setVinc({ ...vinc, upp: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') salvarVinculo(r); if (e.key === 'Escape') setVinc(null); }}
              className="w-16 border border-zinc-200 rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:border-amber-400" />
            {un(alvo?.unit)}
          </label>
          <p className="text-[10px] text-zinc-400 whitespace-normal">Quanto do insumo entra no estoque a cada {r.unit_label || 'unidade'} comprada.</p>
          <div className="flex gap-1.5">
            <button disabled={busy} onClick={() => salvarVinculo(r)} className="px-2 py-1 rounded bg-amber-500 text-white text-[11px] font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer">Salvar</button>
            <button disabled={busy} onClick={() => setVinc(null)} className="px-2 py-1 rounded text-[11px] text-zinc-500 hover:bg-zinc-100 cursor-pointer">Cancelar</button>
          </div>
        </div>
      );
    }
    if (ing) {
      const upp = Number(r.units_per_package ?? 1) || 1;
      return (
        <div className="flex items-center gap-1 group">
          <span className="inline-flex items-center gap-1 min-w-0"><i className="ri-links-line text-emerald-600" /><span className="truncate max-w-[150px]" title={ing.name}>{ing.name}</span></span>
          <span className="text-[10px] text-zinc-400">1 {r.unit_label || 'un'} = {num(upp)} {un(ing.unit)}</span>
          <button disabled={busy} onClick={() => setVinc({ rowId: r.id, ingId: ing.id, upp: String(upp).replace('.', ',') })}
            className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-amber-600 hover:bg-amber-50 cursor-pointer" title="Editar vínculo">
            <i className="ri-pencil-line" />
          </button>
          <button disabled={busy}
            onClick={() => { if (window.confirm(`Tirar o vínculo de "${r.description}" com ${ing.name}?`)) vincular(r, null); }}
            className="w-6 h-6 flex items-center justify-center rounded text-zinc-300 hover:text-red-500 hover:bg-red-50 cursor-pointer" title="Tirar vínculo">
            <i className="ri-link-unlink" />
          </button>
        </div>
      );
    }
    return (
      <CategoriaCombobox value="" options={insOptions} disabled={busy} placeholder="Vincular insumo…"
        onChange={(id) => { if (id) setVinc({ rowId: r.id, ingId: id, upp: '1' }); }}
        onCreate={(texto) => setNovoInsumo({ rowId: r.id, nome: texto || r.description })}
        createLabel={(texto) => (texto ? `Criar insumo “${texto}”` : 'Criar novo insumo')}
        buttonClassName="text-[11px] font-semibold rounded-lg px-1.5 py-1 w-[170px] cursor-pointer bg-zinc-50 text-zinc-500 border border-dashed border-zinc-200 hover:border-emerald-300" />
    );
  };

  // A coluna "Classificação" é a mesma na tabela (computador) e no cartão (celular).
  const classificacaoDoItem = (r: Row) => {
    const sugCat = r.suggested_dre_category_id ? catNome(r.suggested_dre_category_id) : null;
    const catCmv = cmvCat(r);
    return (
      <>
        <div className="flex flex-wrap items-center gap-1.5">
          {r.ingredient_id ? (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700" title="Produto ligado a insumo do estoque: sempre CMV, na categoria do insumo (Estoque › Insumos)">
              CMV · {catCmv ?? 'insumo sem categoria'}
            </span>
          ) : podeClassificar ? (
            <>
              {r.is_service && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700" title="Veio de nota de serviço (NFS-e). Despesa: serviço de verdade. CMV: fornecedor de produto que emite nota de serviço — as notas dele entram como compra.">NFS-e</span>
              )}
              <CategoriaCombobox value={r.classe === 'cmv' ? r.merchandise_category_id ?? '' : ''} disabled={busy}
                options={mercOptions} placeholder={r.classe === 'cmv' ? 'CMV · sem categoria' : 'CMV…'}
                onChange={(id) => { if (id) aplicar([r.id], 'cmv', null, id); }}
                buttonClassName={`text-[11px] font-semibold rounded-lg px-1.5 py-1 w-[170px] cursor-pointer ${r.classe === 'cmv' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'}`} />
              <CategoriaCombobox value={r.classe === 'despesa' ? r.dre_category_id ?? '' : ''} disabled={busy}
                options={catOptions} placeholder="Despesa…"
                onChange={(id) => { if (id) aplicar([r.id], 'despesa', id); }}
                buttonClassName={`text-[11px] font-semibold rounded-lg px-1.5 py-1 w-[190px] cursor-pointer ${r.classe === 'despesa' ? 'bg-violet-500 text-white' : 'bg-zinc-100 text-zinc-600'}`} />
            </>
          ) : (
            <span className="text-xs text-zinc-600">{r.is_service ? 'NFS-e · ' : ''}{r.classe === 'cmv' ? `CMV${catCmv ? ` · ${catCmv}` : ''}` : r.classe === 'despesa' ? catNome(r.dre_category_id) ?? 'Despesa' : 'Pendente'}</span>
          )}
          {r.auto_classified && !r.ingredient_id && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700" title={r.suggestion_reason ?? ''}>automático</span>
          )}
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
        {r.auto_classified && !r.ingredient_id && r.suggestion_reason && (
          <p className="text-[10px] text-sky-600 mt-1">{r.suggestion_reason}</p>
        )}
      </>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-zinc-800">Classificação de itens</h2>
        <p className="text-xs text-zinc-500 mt-0.5 max-w-3xl">
          Cada produto de cada fornecedor tem uma classificação: <b>CMV</b> com a categoria de mercadoria (a mesma dos insumos: Proteínas, Bebidas, Embalagens…) ou <b>despesa</b> com categoria da DRE (limpeza, papelaria, manutenção…).
          É ela que separa, numa mesma nota, a bebida do produto de limpeza. Toda nota de entrada (produto e serviço) e toda compra lançada entram aqui sozinhas; item novo fica pendente.
          <b> Nota de serviço</b> (NFS-e): despesa para serviço de verdade (sistema, contador, marketing, locação), e a categoria vai para as contas a pagar das notas dele. Se o fornecedor entrega <b>produto</b> mas emite nota de serviço, marque <b>CMV</b>: as próximas notas dele entram como compra.
          <b> Ligado a insumo</b> = o produto dá entrada no estoque daquele insumo; é sempre CMV, na categoria do insumo. Ao classificar ou vincular, as compras já lançadas desse item são corrigidas na DRE.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          ['pendentes', 'Pendentes', resumo.pendentes, 'text-amber-600', 'sem classificação (contam como CMV)'],
          ['cmv', 'CMV', resumo.cmv, 'text-zinc-700', resumo.cmvSem > 0 ? `${resumo.cmvSem} sem categoria` : 'custo da mercadoria'],
          ['estoque', 'Ligados ao estoque', resumo.estoque, 'text-emerald-600', 'CMV que dá entrada num insumo'],
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
        {([['pendentes', 'Pendentes'], ['cmv', 'CMV'], ['cmv_sem', 'CMV sem categoria'], ['estoque', 'Ligados ao estoque'], ['despesa', 'Despesa'], ['servicos', 'Serviços'], ['todos', 'Todos']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFiltro(id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${filtro === id ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
            {label}{id === 'cmv_sem' && resumo.cmvSem > 0 ? ` (${resumo.cmvSem})` : ''}{id === 'servicos' && resumo.servicos > 0 ? ` (${resumo.servicos})` : ''}
          </button>
        ))}
        <select value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}
          className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 max-w-[220px] focus:outline-none focus:border-amber-400">
          <option value="">Todos os fornecedores</option>
          {fornecedores.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto, código, NCM, insumo ou categoria"
          className="flex-1 min-w-[180px] text-sm border border-zinc-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-400" />
      </div>

      {podeClassificar && sel.size > 0 && (
        <div className="sticky top-0 z-10 bg-zinc-900 text-white rounded-xl p-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">{sel.size} selecionado(s)</span>
          <CategoriaCombobox value={mercLote} options={mercOptions} onChange={setMercLote}
            placeholder="Categoria do CMV…"
            buttonClassName="bg-white text-zinc-900 rounded-lg px-2 py-1.5 w-[190px] cursor-pointer" />
          <button disabled={busy} onClick={() => aplicar([...sel], 'cmv', null, mercLote || null)}
            title={mercLote ? '' : 'Sem categoria escolhida, cada item mantém a categoria que já tem'}
            className="px-3 py-1.5 rounded-lg bg-white text-zinc-900 font-semibold hover:bg-zinc-100 disabled:opacity-50 cursor-pointer">Marcar como CMV</button>
          <span className="w-px h-5 bg-zinc-700" />
          <CategoriaCombobox value={catLote} options={catOptions} onChange={setCatLote}
            placeholder="Categoria da despesa…"
            buttonClassName="bg-white text-zinc-900 rounded-lg px-2 py-1.5 w-[220px] cursor-pointer" />
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
            <p className="text-sm text-zinc-500 mt-2">{rows.length === 0 ? 'Nenhum item ainda: eles aparecem quando chegam notas de entrada ou compras.' : filtro === 'pendentes' ? 'Nenhum item pendente. Tudo classificado.' : filtro === 'cmv_sem' ? 'Todo item de CMV já tem categoria.' : 'Nada neste filtro.'}</p>
          </div>
        ) : (
          <>
          {/* Celular: um cartão por item — a tabela de 6 colunas não cabe em 375px. */}
          <ul className="md:hidden p-2 space-y-2 bg-zinc-50/60">
            {filtrados.map((r) => (
              <li key={r.id} className={`rounded-xl border px-3 py-3 ${sel.has(r.id) ? 'border-amber-300 bg-amber-50/60' : 'border-zinc-200 bg-white'}`}>
                <div className="flex items-start gap-2">
                  {podeClassificar && (
                    <input type="checkbox" className="mt-1" checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-800 break-words">{r.description || '—'}</p>
                    <p className="text-[11px] text-zinc-500 break-words">{r.supplier_name ?? '—'}</p>
                    <p className="text-[10px] text-zinc-400">
                      {r.supplier_code ? `cód. ${r.supplier_code}` : 'sem código'}{r.unit_label ? ` · ${r.unit_label}` : ''} · {dataBR(r.last_seen_at)}
                      {r.last_unit_price != null ? ` · ${brl(r.last_unit_price)}` : ''}
                    </p>
                  </div>
                </div>
                <div className="text-xs text-zinc-600 mt-1.5">{celulaInsumo(r)}</div>
                <div className="mt-1.5">{classificacaoDoItem(r)}</div>
              </li>
            ))}
          </ul>

          <div className="hidden md:block overflow-x-auto">
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
                  <th className="text-left px-3 py-2.5 font-semibold">Insumo do estoque</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Última compra</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Classificação</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((r) => {
                  const sugCat = r.suggested_dre_category_id ? catNome(r.suggested_dre_category_id) : null;
                  const catCmv = cmvCat(r);
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
                      <td className="px-3 py-2.5 text-xs text-zinc-600 whitespace-nowrap min-w-[200px]">
                        {celulaInsumo(r)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-zinc-600 whitespace-nowrap">
                        <p>{dataBR(r.last_seen_at)}</p>
                        <p className="text-zinc-400">{r.last_unit_price != null ? brl(r.last_unit_price) : ''}</p>
                      </td>
                      <td className="px-3 py-2.5 min-w-[380px]">
                        {classificacaoDoItem(r)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
      {filtrados.length > 0 && <p className="text-[11px] text-zinc-400">{filtrados.length} de {rows.length} itens</p>}

      {novoInsumo && (() => {
        const alvo = novoInsumo;
        return (
          <InsumoModal
            insumo={null}
            nomeInicial={alvo.nome}
            categoriasDisponiveis={categoriasInsumo}
            onClose={() => setNovoInsumo(null)}
            onSave={(data) => { criarInsumo(alvo.rowId, data); }}
          />
        );
      })()}
    </div>
  );
}
