import { useState, useMemo, useEffect, useCallback } from 'react';
import { Search, Plus, Edit2, Trash2, Building2, History } from 'lucide-react';
import type { Insumo } from '@/contexts/EstoqueContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useProducao } from '@/contexts/ProducaoContext';
import { useIngredientCategories } from '@/hooks/useIngredientCategories';
import { useSuppliers } from '@/hooks/useSuppliers';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import NovaCompraModal from '@/pages/financeiro/components/NovaCompraModal';
import AlertasReposicao from './AlertasReposicao';
import GerenciarFornecedoresModal from './GerenciarFornecedoresModal';
import HistoricoComprasModal from './HistoricoComprasModal';
import CategoriasModal from './insumos/CategoriasModal';
import InsumoModal from './insumos/InsumoModal';
import EntradaRapidaModal from './insumos/EntradaRapidaModal';
import MiniPriceHistory from './insumos/MiniPriceHistory';
import { statusEstoque, barColor, barWidth, diasParaRuptura, exportarInsumosCSV } from './insumos/InsumosUtils';
import ImportExportTemplatesModal from '@/components/ImportExportTemplatesModal';
import { formatCurrency } from '@/lib/formatters';
import ItensIndisponiveisPanel from './ItensIndisponiveisPanel';

export default function InsumosTab() {
  const { insumos, insumosEsgotados, marcarInsumoEsgotado, upsertInsumo, reloadInsumos, addMovimentacao } = useEstoque();
  const { recipes, batches } = useProducao();
  const { categories, names: categoriasDB, loading: loadingCategorias, addCategory, removeCategory } = useIngredientCategories();
  const { suppliers, names: fornecedoresDB } = useSuppliers();
  const { user } = useAuth();
  const [busca, setBusca] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('Todas');
  const [filtroStatus, setFiltroStatus] = useState('Todos');
  const [modal, setModal] = useState<'new' | Insumo | null>(null);
  const [confirmEsgotado, setConfirmEsgotado] = useState<Insumo | null>(null);
  const [categoriasModal, setCategoriasModal] = useState(false);
  const [fornecedoresModal, setFornecedoresModal] = useState(false);
  const [entradaRapida, setEntradaRapida] = useState<Insumo | null>(null);
  const [confirmExcluir, setConfirmExcluir] = useState<Insumo | null>(null);
  const [showRuptura, setShowRuptura] = useState(false);
  const [compraModal, setCompraModal] = useState<{ id: string; nome: string; unidade: string } | null>(null);
  const [historicoModal, setHistoricoModal] = useState<Insumo | null>(null);
  const [expandedPriceId, setExpandedPriceId] = useState<string | null>(null);
  const [dreCategories, setDreCategories] = useState<Array<{ id: string; name: string; group_type: string; parent_id?: string | null }>>([]);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);

  // Load DRE categories
  useEffect(() => {
    if (!user?.tenantId) return;
    supabase
      .from('fin_dre_categories')
      .select('id, name, group_type, parent_id')
      .eq('tenant_id', user.tenantId)
      .eq('is_active', true)
      .order('group_type')
      .order('sort_order')
      .then(({ data }) => setDreCategories(data ?? []));
  }, [user?.tenantId]);

  // Set de nomes de fichas para identificar produtos semi-acabados
  const recipeNames = useMemo(() => new Set(recipes.map((r) => r.name).filter(Boolean) as string[]), [recipes]);

  // Última produção de cada produto (indexado pelo nome)
  const ultimaProducaoPorProduto = useMemo(() => {
    const map = new Map<string, { data: string; qty: number; unit: string }>();
    for (const recipe of recipes) {
      const batchesRecipe = batches
        .filter((b) => b.recipeId === recipe.id)
        .sort((a, b) => new Date(b.producedAt).getTime() - new Date(a.producedAt).getTime());
      if (batchesRecipe.length > 0) {
        const last = batchesRecipe[0];
        map.set(recipe.name, {
          data: new Date(last.producedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
          qty: last.producedQuantity,
          unit: last.unit,
        });
      }
    }
    return map;
  }, [recipes, batches]);

  // Mapa: nome do produto acabado → categoria da ficha de produção
  const categoriaProducaoPorNome = useMemo(() => {
    const map = new Map<string, string>();
    for (const recipe of recipes) {
      if (recipe.name && recipe.category) {
        map.set(recipe.name, recipe.category);
      }
    }
    return map;
  }, [recipes]);

  // Helper: resolve a categoria efetiva (insumo.categoria ou categoria da ficha de produção)
  const resolveCategoria = useCallback((insumo: Insumo): string | null => {
    if (insumo.categoria && insumo.categoria !== 'Sem categoria') return insumo.categoria;
    const catProd = categoriaProducaoPorNome.get(insumo.nome);
    return catProd || null;
  }, [categoriaProducaoPorNome]);

  const handleOpenCompraFromEntrada = (insumo: Insumo) => {
    setEntradaRapida(null);
    setCompraModal({ id: insumo.id, nome: insumo.nome, unidade: insumo.unidade });
  };

  // Incluir categorias das fichas de producao na lista de filtros
  const todasCategorias = useMemo(() => {
    const set = new Set<string>(categoriasDB);
    insumos.forEach((i) => { if (i.categoria && i.categoria !== 'Sem categoria') set.add(i.categoria); });
    recipes.forEach((r) => { if (r.category) set.add(r.category); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [categoriasDB, insumos, recipes]);

  const todosFornecedores = useMemo(() => {
    const set = new Set<string>(fornecedoresDB);
    insumos.forEach((i) => { if (i.fornecedor) set.add(i.fornecedor); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [fornecedoresDB, insumos]);

  const insumosVisiveis = useMemo(() => insumos.filter((i) => {
    const matchBusca = i.nome.toLowerCase().includes(busca.toLowerCase()) || (i.fornecedor && i.fornecedor.toLowerCase().includes(busca.toLowerCase()));
    const matchCat = categoriaFiltro === 'Todas' || i.categoria === categoriaFiltro;
    const st = statusEstoque(i).label;
    const esgotado = insumosEsgotados.includes(i.id);
    const matchStatus = filtroStatus === 'Todos' || st === filtroStatus || (filtroStatus === 'Esgotado' && esgotado);
    return matchBusca && matchCat && matchStatus;
  }), [insumos, busca, categoriaFiltro, filtroStatus, insumosEsgotados]);

  const alertas = insumos.filter((i) => i.estoqueAtual <= i.estoqueMinimo && i.estoqueMinimo > 0).length;
  const qtdEsgotados = insumosEsgotados.length;

  const insumosRuptura = useMemo(() => insumos
    .map((i) => ({ insumo: i, dias: diasParaRuptura(i) }))
    .filter((x) => x.dias !== null && x.dias <= 7)
    .sort((a, b) => (a.dias ?? 99) - (b.dias ?? 99))
  , [insumos]);

  const handleSaveInsumo = async (data: Omit<Insumo, 'estoqueAtual' | 'ultimaEntrada' | 'fichaTecnica' | 'esgotado'> & { id?: string }) => {
    if (data.categoria && data.categoria !== 'Sem categoria' && !categoriasDB.includes(data.categoria)) {
      await addCategory(data.categoria);
    }
    await upsertInsumo({
      id: data.id,
      nome: data.nome,
      unidade: data.unidade,
      categoria: data.categoria,
      precoUnitario: data.precoUnitario,
      estoqueMinimo: data.estoqueMinimo,
      fornecedor: data.fornecedor,
      supplierId: data.supplierId ?? null,
      purchaseUnit: data.purchaseUnit,
      purchaseFactor: data.purchaseFactor ?? 1,
      dreCategoryId: data.dreCategoryId,
    });
    await reloadInsumos();
  };

  const handleEntradaRapida = async (insumo: Insumo, quantidade: number, motivo: string) => {
    await addMovimentacao({
      insumoId: insumo.id,
      tipo: 'entrada',
      quantidade,
      unidade: insumo.unidade,
      motivo,
    });
    await reloadInsumos();
  };

  const handleExcluir = async (insumo: Insumo) => {
    if (!user?.tenantId) return;
    setDeleteError(null);
    setDeleteLoading(true);
    console.log('[InsumosTab] Tentando excluir insumo:', insumo.id, insumo.nome, 'tenant:', user.tenantId);
    try {
      const result = await invokeWithAuth('stock-write', {
        body: {
          action: 'delete_ingredient',
          tenant_id: user.tenantId,
          ingredient_id: insumo.id,
        },
      });
      console.log('[InsumosTab] Resultado da edge function:', result);
      if (result.error) {
        console.error('[InsumosTab] Erro ao excluir insumo:', result.error.message);
        setDeleteError(result.error.message);
        return;
      }
      console.log('[InsumosTab] Soft delete feito. Recarregando insumos...');
      await reloadInsumos();
      console.log('[InsumosTab] Insumos recarregados. Fechando modal.');
      setConfirmExcluir(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[InsumosTab] Erro ao excluir insumo (catch):', msg);
      setDeleteError(msg);
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <AlertasReposicao onEntradaRapida={(ins) => setEntradaRapida(ins)} />

      {/* Painel de itens do cardápio indisponíveis por falta de insumo */}
      <ItensIndisponiveisPanel
        onEntradaRapida={(insumoId, insumoNome) => {
          const insumo = insumos.find((i) => i.id === insumoId);
          if (insumo) setEntradaRapida(insumo);
        }}
      />

      {qtdEsgotados > 0 && alertas === 0 && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
          <i className="ri-forbid-2-fill text-red-500 text-base flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs font-bold text-red-700">
              {qtdEsgotados} insumo{qtdEsgotados > 1 ? 's' : ''} esgotado{qtdEsgotados > 1 ? 's' : ''}
            </p>
            <p className="text-[10px] text-red-500 mt-0.5">
              Insumos marcados como esgotados — itens do cardápio podem ser afetados.
            </p>
          </div>
        </div>
      )}

      {insumosRuptura.length > 0 && (
        <div className="border border-orange-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowRuptura((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-orange-50 hover:bg-orange-100 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <i className="ri-time-line text-orange-500 text-base flex-shrink-0" />
              <div className="text-left">
                <p className="text-xs font-bold text-orange-700">
                  {insumosRuptura.length} insumo{insumosRuptura.length > 1 ? 's' : ''} com previsão de ruptura em até 7 dias
                </p>
                <p className="text-[10px] text-orange-500 hidden sm:block">
                  Baseado no consumo estimado por estoque mínimo — clique para ver detalhes
                </p>
              </div>
            </div>
            <i className={showRuptura ? 'ri-arrow-up-s-line text-orange-400 flex-shrink-0' : 'ri-arrow-down-s-line text-orange-400 flex-shrink-0'} />
          </button>
          {showRuptura && (
            <div className="bg-white divide-y divide-zinc-50">
              {insumosRuptura.map(({ insumo, dias }) => (
                <div key={insumo.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dias === 0 ? 'bg-red-500' : dias! <= 3 ? 'bg-orange-500' : 'bg-amber-400'}`} />
                    <span className="text-xs font-medium text-zinc-800 truncate">{insumo.nome}</span>
                    <span className="text-[10px] text-zinc-400 hidden sm:inline">{insumo.estoqueAtual} {insumo.unidade}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${dias === 0 ? 'bg-red-100 text-red-700' : dias! <= 3 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>
                      {dias === 0 ? 'Esgotado' : `${dias}d`}
                    </span>
                    <button
                      onClick={() => setEntradaRapida(insumo)}
                      className="flex items-center gap-1 text-[10px] font-semibold text-green-600 hover:text-green-700 cursor-pointer whitespace-nowrap"
                    >
                      <i className="ri-add-circle-line text-sm" /> Repor
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-col gap-3">
        {/* Linha 1: busca + botões de ação */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2 flex-1 min-w-[160px]">
            <div className="w-4 h-4 flex items-center justify-center text-zinc-400"><Search size={14} /></div>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo..." className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none" />
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={() => exportarInsumosCSV(insumosVisiveis)}
              disabled={insumosVisiveis.length === 0}
              title="Exportar CSV"
              className="w-8 h-8 flex items-center justify-center bg-zinc-100 text-zinc-600 rounded-lg hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-40"
            >
              <i className="ri-download-line text-sm" />
            </button>
            <button
              onClick={() => setShowTemplatesModal(true)}
              title="Importar/Exportar Templates"
              className="w-8 h-8 flex items-center justify-center bg-zinc-100 text-zinc-600 rounded-lg hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              <i className="ri-file-transfer-line text-sm" />
            </button>
            <button
              onClick={() => setFornecedoresModal(true)}
              title="Fornecedores"
              className="w-8 h-8 flex items-center justify-center bg-zinc-100 text-zinc-600 rounded-lg hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              <div className="w-4 h-4 flex items-center justify-center"><Building2 size={13} /></div>
            </button>
            <button
              onClick={() => setCategoriasModal(true)}
              title="Categorias"
              className="w-8 h-8 flex items-center justify-center bg-zinc-100 text-zinc-600 rounded-lg hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              <i className="ri-price-tag-3-line text-sm" />
            </button>
            <button onClick={() => setModal('new')}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition-colors whitespace-nowrap cursor-pointer">
              <div className="w-4 h-4 flex items-center justify-center"><Plus size={13} /></div>
              <span className="hidden sm:inline">Novo Insumo</span>
              <span className="sm:hidden">Novo</span>
            </button>
          </div>
        </div>

        {/* Linha 2: categorias */}
        {todasCategorias.length > 0 && (
          <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto">
            <button onClick={() => setCategoriaFiltro('Todas')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${categoriaFiltro === 'Todas' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
              Todas
            </button>
            {todasCategorias.map((c) => (
              <button key={c} onClick={() => setCategoriaFiltro(c)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${categoriaFiltro === c ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Linha 3: status */}
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto">
          {['Todos', 'Ok', 'Baixo', 'Crítico', 'Esgotado'].map((s) => (
            <button key={s} onClick={() => setFiltroStatus(s)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${filtroStatus === s ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela — desktop */}
      {insumos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-zinc-100 rounded-xl">
          <i className="ri-flask-line text-4xl text-zinc-300 block mb-3" />
          <p className="text-sm font-semibold text-zinc-500 mb-1">Nenhum insumo cadastrado</p>
          <p className="text-xs text-zinc-400">Clique em "Novo Insumo" para começar.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white border border-zinc-100 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 border-b border-zinc-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-500">Insumo</th>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-500">Categoria</th>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-500">Fornecedor</th>
                    <th className="px-4 py-3 text-right font-semibold text-zinc-500">Preço Unit.</th>
                    <th className="px-4 py-3 text-center font-semibold text-zinc-500">Estoque Atual</th>
                    <th className="px-4 py-3 text-center font-semibold text-zinc-500">Status</th>
                    <th className="px-4 py-3 text-right font-semibold text-zinc-500">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {insumosVisiveis.map((insumo) => {
                    const st = statusEstoque(insumo);
                    const esgotado = insumosEsgotados.includes(insumo.id);
                    const isProdutoAcabado = recipeNames.has(insumo.nome);
                    const ultimaProd = isProdutoAcabado ? ultimaProducaoPorProduto.get(insumo.nome) : null;
                    return (<>
                      <tr key={insumo.id} className={`transition-colors ${esgotado ? 'bg-red-50/50 hover:bg-red-50' : expandedPriceId === insumo.id ? 'bg-amber-50/20' : 'hover:bg-zinc-50'}`}>
                        <td className="px-4 py-3">
                          <div
                            className="flex items-center gap-2 cursor-pointer group"
                            onClick={() => setExpandedPriceId(expandedPriceId === insumo.id ? null : insumo.id)}
                            title="Clique para ver histórico de preço"
                          >
                            {esgotado && (
                              <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center bg-red-500 rounded-full">
                                <i className="ri-forbid-2-line text-white text-[10px]" />
                              </span>
                            )}
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className={`font-medium group-hover:text-amber-600 transition-colors ${esgotado ? 'text-red-700' : 'text-zinc-800'}`}>{insumo.nome}</p>
                                {isProdutoAcabado && (
                                  <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded-full text-[9px] font-bold border border-amber-200 whitespace-nowrap">
                                    PRODUÇÃO
                                  </span>
                                )}
                              </div>
                              {ultimaProd && (
                                <p className="text-[10px] text-amber-500 mt-0.5">
                                  Última produção: {ultimaProd.data} · {ultimaProd.qty} {ultimaProd.unit}
                                </p>
                              )}
                              {insumo.ultimaEntrada && insumo.ultimaEntrada !== '—' && (
                                <p className="text-[10px] text-zinc-400">Atualizado: {insumo.ultimaEntrada}</p>
                              )}
                            </div>
                            <i className={`text-zinc-300 text-xs transition-transform flex-shrink-0 ${expandedPriceId === insumo.id ? 'ri-arrow-up-s-line text-amber-400' : 'ri-arrow-down-s-line group-hover:text-amber-400'}`} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {resolveCategoria(insumo) ? (
                            <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-full text-[10px] font-medium whitespace-nowrap">{resolveCategoria(insumo)}</span>
                          ) : (
                            <span className="text-zinc-300 text-[10px]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-500 max-w-[140px] truncate">
                          {insumo.fornecedor || <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-semibold text-zinc-800">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(insumo.precoUnitario)}/{insumo.unidade}</p>
                          {insumo.priceSource === 'average' && (
                            <span className="text-[10px] text-sky-600 font-medium flex items-center justify-end gap-0.5 mt-0.5">
                              <i className="ri-bar-chart-line" /> Média 3 meses
                            </span>
                          )}
                          {insumo.priceSource === 'purchase' && (
                            <span className="text-[10px] text-green-600 font-medium flex items-center justify-end gap-0.5 mt-0.5">
                              <i className="ri-shopping-cart-line" /> Última compra
                            </span>
                          )}
                          {insumo.priceSource === 'manual' && (
                            <span className="text-[10px] text-zinc-400 flex items-center justify-end gap-0.5 mt-0.5">
                              <i className="ri-edit-line" /> Manual
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`font-semibold ${esgotado ? 'text-red-600' : 'text-zinc-800'}`}>{insumo.estoqueAtual} {insumo.unidade}</span>
                            <div className="w-20 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${esgotado ? 'bg-red-500' : barColor(insumo)}`} style={{ width: esgotado ? '100%' : `${barWidth(insumo)}%` }} />
                            </div>
                            {insumo.estoqueMinimo > 0 && (
                              <span className="text-[10px] text-zinc-400">mín: {insumo.estoqueMinimo} {insumo.unidade}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {esgotado ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 animate-pulse">ESGOTADO</span>
                          ) : (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setHistoricoModal(insumo)} title="Histórico de compras" className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors"><History size={12} /></button>
                            <button onClick={() => setEntradaRapida(insumo)} title="Entrada rápida" className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-green-50 text-zinc-400 hover:text-green-600 cursor-pointer transition-colors"><i className="ri-add-circle-line text-sm" /></button>
                            {!esgotado ? (
                              <button onClick={() => setConfirmEsgotado(insumo)} title="Marcar como esgotado" className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-600 cursor-pointer transition-colors"><i className="ri-forbid-2-line text-sm" /></button>
                            ) : (
                              <span className="text-[9px] font-bold text-red-500 px-1.5">ESGOTADO</span>
                            )}
                            <button onClick={() => setModal(insumo)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors"><Edit2 size={12} /></button>
                            <button onClick={() => setConfirmExcluir(insumo)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer transition-colors" title="Excluir"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </tr>
                      {expandedPriceId === insumo.id && (
                        <MiniPriceHistory insumo={insumo} />
                      )}
                    </>);
                  })}
                </tbody>
              </table>
            </div>
            {insumosVisiveis.length === 0 && (
              <div className="text-center py-8">
                <i className="ri-search-line text-2xl text-zinc-300 block mb-2" />
                <p className="text-xs text-zinc-400">Nenhum insumo encontrado com esses filtros.</p>
              </div>
            )}
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {insumosVisiveis.length === 0 ? (
              <div className="text-center py-8 bg-white border border-zinc-100 rounded-xl">
                <i className="ri-search-line text-2xl text-zinc-300 block mb-2" />
                <p className="text-xs text-zinc-400">Nenhum insumo encontrado.</p>
              </div>
            ) : insumosVisiveis.map((insumo) => {
              const st = statusEstoque(insumo);
              const esgotado = insumosEsgotados.includes(insumo.id);
              const isProdutoAcabado = recipeNames.has(insumo.nome);
              const ultimaProd = isProdutoAcabado ? ultimaProducaoPorProduto.get(insumo.nome) : null;
              return (
                <div key={insumo.id} className={`bg-white border rounded-xl p-3 ${esgotado ? 'border-red-200 bg-red-50/30' : 'border-zinc-100'}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {esgotado && <i className="ri-forbid-2-fill text-red-500 text-xs" />}
                        <p className={`text-sm font-bold truncate ${esgotado ? 'text-red-700' : 'text-zinc-800'}`}>{insumo.nome}</p>
                        {isProdutoAcabado && (
                          <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded-full text-[9px] font-bold border border-amber-200 whitespace-nowrap">
                            PRODUTO
                          </span>
                        )}
                      </div>
                      {ultimaProd && (
                        <p className="text-[10px] text-amber-500 mt-0.5">
                          Última produção: {ultimaProd.data} · {ultimaProd.qty} {ultimaProd.unit}
                        </p>
                      )}
                      {resolveCategoria(insumo) && (
                        <span className="text-[10px] text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded-full mt-0.5 inline-block">{resolveCategoria(insumo)}</span>
                      )}
                    </div>
                    <div className="flex-shrink-0">
                      {esgotado ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-red-700 bg-red-100 border border-red-200">ESGOTADO</span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex-1">
                      <p className="text-[10px] text-zinc-400">Estoque</p>
                      <p className={`text-sm font-bold ${esgotado ? 'text-red-600' : 'text-zinc-800'}`}>{insumo.estoqueAtual} {insumo.unidade}</p>
                      <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden mt-1">
                        <div className={`h-full rounded-full ${esgotado ? 'bg-red-500' : barColor(insumo)}`} style={{ width: esgotado ? '100%' : `${barWidth(insumo)}%` }} />
                      </div>
                      {insumo.estoqueMinimo > 0 && <p className="text-[10px] text-zinc-400 mt-0.5">mín: {insumo.estoqueMinimo} {insumo.unidade}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-zinc-400">Preço</p>
                      <p className="text-sm font-bold text-zinc-800">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(insumo.precoUnitario)}</p>
                      <p className="text-[10px] text-zinc-400">/{insumo.unidade}</p>
                    </div>
                  </div>

                  {insumo.fornecedor && (
                    <p className="text-[10px] text-zinc-400 mb-2 truncate"><i className="ri-building-line mr-1" />{insumo.fornecedor}</p>
                  )}

                  <div className="flex items-center gap-1.5 pt-2 border-t border-zinc-50">
                    <button onClick={() => setEntradaRapida(insumo)} className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-green-50 text-green-700 text-xs font-semibold rounded-lg cursor-pointer">
                      <i className="ri-add-circle-line text-sm" /> Entrada
                    </button>
                    <button onClick={() => setModal(insumo)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 cursor-pointer">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => setHistoricoModal(insumo)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 cursor-pointer">
                      <History size={13} />
                    </button>
                    {!esgotado && (
                      <button onClick={() => setConfirmEsgotado(insumo)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 text-red-500 cursor-pointer">
                        <i className="ri-forbid-2-line text-sm" />
                      </button>
                    )}
                    <button onClick={() => setConfirmExcluir(insumo)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 text-red-500 cursor-pointer">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Modal confirmar esgotado */}
      {confirmEsgotado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 flex items-center justify-center bg-red-100 rounded-xl flex-shrink-0">
                <i className="ri-forbid-2-line text-red-600 text-lg" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-900">Marcar como Esgotado?</p>
                <p className="text-xs text-zinc-500 mt-0.5">{confirmEsgotado.nome}</p>
              </div>
            </div>
            <p className="text-xs text-zinc-500 mb-4">O estoque será zerado e uma notificação será enviada para garçons e caixa.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmEsgotado(null)} className="flex-1 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 transition-colors cursor-pointer whitespace-nowrap">Cancelar</button>
              <button
                onClick={() => { marcarInsumoEsgotado(confirmEsgotado.id, 'Estoque'); setConfirmEsgotado(null); }}
                className="flex-1 py-2 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors cursor-pointer whitespace-nowrap"
              >
                Confirmar Esgotado
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmar Exclusão Modal */}
      {confirmExcluir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 flex items-center justify-center bg-red-100 rounded-xl flex-shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-900">Excluir Insumo?</p>
                <p className="text-xs text-zinc-500 mt-0.5">{confirmExcluir.nome}</p>
              </div>
            </div>
            {deleteError && (
              <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs text-red-600 font-medium">{deleteError}</p>
              </div>
            )}
            <p className="text-xs text-zinc-500 mb-4">
              Esta ação não pode ser desfeita. O insumo será removido do sistema e das fichas técnicas vinculadas.
            </p>
            <div className="flex gap-2">
              <button onClick={() => { setConfirmExcluir(null); setDeleteError(null); }} className="flex-1 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 transition-colors cursor-pointer whitespace-nowrap">Cancelar</button>
              <button
                onClick={() => handleExcluir(confirmExcluir)}
                disabled={deleteLoading}
                className="flex-1 py-2 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {deleteLoading ? (
                  <>
                    <i className="ri-loader-4-line animate-spin" /> Excluindo...
                  </>
                ) : (
                  'Excluir'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {categoriasModal && (
        <CategoriasModal
          categories={categories}
          loading={loadingCategorias}
          onClose={() => setCategoriasModal(false)}
          onAdd={addCategory}
          onRemove={removeCategory}
        />
      )}

      {modal && (
        <InsumoModal
          insumo={modal === 'new' ? null : modal}
          categoriasDisponiveis={todasCategorias}
          fornecedoresDisponiveis={todosFornecedores}
          fornecedoresComId={suppliers.map((s) => ({ id: s.id, name: s.name }))}
          dreCategories={dreCategories}
          onClose={() => setModal(null)}
          onSave={handleSaveInsumo}
          onOpenFornecedores={() => setFornecedoresModal(true)}
        />
      )}

      {entradaRapida && (
        <EntradaRapidaModal
          insumo={entradaRapida}
          onClose={() => setEntradaRapida(null)}
          onConfirm={(qty, motivo) => handleEntradaRapida(entradaRapida, qty, motivo)}
          onOpenCompra={handleOpenCompraFromEntrada}
        />
      )}

      {compraModal && (
        <NovaCompraModal
          insumoPreSelecionado={compraModal}
          onClose={() => setCompraModal(null)}
          onSaved={() => { setCompraModal(null); reloadInsumos(); }}
        />
      )}

      {fornecedoresModal && (
        <GerenciarFornecedoresModal
          onClose={() => setFornecedoresModal(false)}
        />
      )}

      {historicoModal && (
        <HistoricoComprasModal
          insumo={historicoModal}
          onClose={() => setHistoricoModal(null)}
        />
      )}

      {showTemplatesModal && (
        <ImportExportTemplatesModal
          open={showTemplatesModal}
          defaultTab="insumos"
          insumosData={insumosVisiveis.map(i => ({
            nome: i.nome,
            unidade: i.unidade,
            categoria: i.categoria,
            estoqueMinimo: i.estoqueMinimo,
            fornecedor: i.fornecedor,
            purchaseUnit: i.purchaseUnit,
            purchaseFactor: i.purchaseFactor,
          }))}
          onClose={() => setShowTemplatesModal(false)}
          onSuccess={() => reloadInsumos()}
        />
      )}
    </div>
  );
}