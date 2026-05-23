import { useState, useMemo } from 'react';
import { useProducao } from '@/contexts/ProducaoContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatPercent } from '@/lib/formatters';
import { convertUnit } from '@/lib/unitConversion';
import FichaProducaoModal from './FichaProducaoModal';
import RegistroProducaoModal from './RegistroProducaoModal';
import DetalheBatchModal from './DetalheBatchModal';
import ConfirmModal from '@/components/base/ConfirmModal';
import type { ProductionRecipe, ProductionBatch } from '@/types/estoque';

const fmt = formatCurrency;
const fmtPct = formatPercent;

type SubTab = 'fichas' | 'producoes';
type OrdenacaoFichas = 'nome' | 'yield_desc' | 'itens';
type OrdenacaoProducoes = 'data_desc' | 'custo_desc' | 'receita_desc';

// ── Resumo cards ─────────────────────────────────────────────────────────────
function ResumoCards({
  recipes,
  batches,
}: {
  recipes: ProductionRecipe[];
  batches: ProductionBatch[];
}) {
  const activeRecipes = recipes.filter((r) => r.isActive).length;
  const totalBatches = batches.length;
  const avgYield =
    batches.filter((b) => b.yieldPercentActual !== null).length > 0
      ? batches
          .filter((b) => b.yieldPercentActual !== null)
          .reduce((s, b) => s + (b.yieldPercentActual ?? 0), 0) /
        batches.filter((b) => b.yieldPercentActual !== null).length
      : 0;

  const custoTotal = batches.reduce((s, b) => s + b.totalCost, 0);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="bg-white border border-zinc-100 rounded-xl p-4">
        <p className="text-xs text-zinc-500 mb-1">Fichas Ativas</p>
        <p className="text-2xl font-black text-zinc-800">{activeRecipes}</p>
        <p className="text-[10px] text-zinc-400 mt-1">cadastradas</p>
      </div>
      <div className="bg-white border border-zinc-100 rounded-xl p-4">
        <p className="text-xs text-zinc-500 mb-1">Produções Registradas</p>
        <p className="text-2xl font-black text-zinc-800">{totalBatches}</p>
        <p className="text-[10px] text-zinc-400 mt-1">no histórico</p>
      </div>
      <div className="bg-white border border-zinc-100 rounded-xl p-4">
        <p className="text-xs text-zinc-500 mb-1">Rendimento Médio</p>
        <p className="text-2xl font-black text-amber-600">{fmtPct(avgYield)}</p>
        <p className="text-[10px] text-zinc-400 mt-1">entre todas as produções</p>
      </div>
      <div className="bg-white border border-zinc-100 rounded-xl p-4">
        <p className="text-xs text-zinc-500 mb-1">Custo Total Investido</p>
        <p className="text-2xl font-black text-zinc-800">{fmt(custoTotal)}</p>
        <p className="text-[10px] text-zinc-400 mt-1">em insumos brutos</p>
      </div>
    </div>
  );
}

// ── Lista de Fichas ─────────────────────────────────────────────────────────
function ListaFichas({
  recipes,
  onEdit,
  onNovaProducao,
}: {
  recipes: ProductionRecipe[];
  onEdit: (r: ProductionRecipe) => void;
  onNovaProducao: (recipeId: string) => void;
}) {
  const { batches, deleteRecipe } = useProducao();
  const { insumos } = useEstoque();
  const [busca, setBusca] = useState('');
  const [ordenacao, setOrdenacao] = useState<OrdenacaoFichas>('nome');
  const [confirmRecipeId, setConfirmRecipeId] = useState<string | null>(null);
  const [confirmRecipeName, setConfirmRecipeName] = useState('');

  const fichasFiltradas = useMemo(() => {
    const base = busca
      ? recipes.filter((r) => r.name.toLowerCase().includes(busca.toLowerCase()))
      : recipes;
    return [...base].sort((a, b) => {
      if (ordenacao === 'nome') return a.name.localeCompare(b.name);
      if (ordenacao === 'yield_desc') return b.items.length - a.items.length;
      return b.items.length - a.items.length;
    });
  }, [recipes, busca, ordenacao]);

  const batchCountForRecipe = (recipeId: string) =>
    batches.filter((b) => b.recipeId === recipeId).length;

  // Custo estimado ao usar os preços ATUAIS dos insumos do estoque
  const custoEstimadoPorUnidade = useMemo(() => {
    const map = new Map<string, number>();
    for (const recipe of recipes) {
      let total = 0;
      for (const it of recipe.items) {
        const insumo = insumos.find((i) => i.id === it.ingredientId);
        if (insumo && insumo.precoUnitario > 0) {
          // Converte a quantidade da ficha pra unidade do insumo no estoque
          const convertedQty = convertUnit(it.quantity, it.unit, insumo.unidade);
          const qty = convertedQty !== null ? convertedQty : it.quantity;
          total += qty * insumo.precoUnitario;
        }
      }
      map.set(recipe.id, total);
    }
    return map;
  }, [recipes, insumos]);

  return (
    <div className="space-y-4">
      <ConfirmModal
        isOpen={!!confirmRecipeId}
        title="Excluir ficha de produção?"
        message={`A ficha "${confirmRecipeName}" será excluída permanentemente. Esta ação não pode ser desfeita.`}
        icon="ri-delete-bin-6-line"
        confirmLabel="Excluir"
        danger
        onConfirm={() => {
          if (confirmRecipeId) deleteRecipe(confirmRecipeId);
          setConfirmRecipeId(null);
          setConfirmRecipeName('');
        }}
        onCancel={() => {
          setConfirmRecipeId(null);
          setConfirmRecipeName('');
        }}
      />
      {/* Filtros */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2">
          <i className="ri-search-line text-zinc-400 text-sm" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar ficha de produção..."
            className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto">
          {[
            { id: 'nome' as OrdenacaoFichas, label: 'Nome' },
            { id: 'yield_desc' as OrdenacaoFichas, label: 'Mais Insumos' },
            { id: 'itens' as OrdenacaoFichas, label: 'Mais Insumos' },
          ].map((op) => (
            <button
              key={op.id}
              onClick={() => setOrdenacao(op.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${
                ordenacao === op.id
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {op.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid de fichas */}
      {fichasFiltradas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-zinc-100 rounded-xl">
          <i className="ri-file-list-3-line text-4xl text-zinc-300 block mb-3" />
          <p className="text-sm font-semibold text-zinc-500">
            Nenhuma ficha encontrada
          </p>
          <p className="text-xs text-zinc-400 mt-1">
            Cadastre a primeira ficha de produção para começar.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {fichasFiltradas.map((recipe) => {
            const custoUnit = custoEstimadoPorUnidade.get(recipe.id) ?? 0;
            const batchCount = batchCountForRecipe(recipe.id);
            return (
              <div
                key={recipe.id}
                className="bg-white border border-zinc-100 rounded-xl p-4 hover:border-amber-300 transition-colors group"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-zinc-800 truncate">
                      {recipe.name}
                    </h3>
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                      {recipe.items.length} insumo
                      {recipe.items.length > 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onEdit(recipe)}
                      className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-amber-500 cursor-pointer transition-colors"
                      title="Editar ficha"
                    >
                      <i className="ri-edit-line text-sm" />
                    </button>
                    <button
                      onClick={() => {
                        setConfirmRecipeId(recipe.id);
                        setConfirmRecipeName(recipe.name);
                      }}
                      className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
                      title="Excluir"
                    >
                      <i className="ri-delete-bin-line text-sm" />
                    </button>
                  </div>
                </div>

                {/* Insumos preview */}
                <div className="space-y-1.5 mb-3">
                  {recipe.items.slice(0, 4).map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center justify-between text-[11px]"
                    >
                      <span className="text-zinc-500 truncate max-w-[140px]">
                        {it.ingredientName}
                      </span>
                      <span className="text-zinc-700 font-medium whitespace-nowrap">
                        {it.quantity} {it.unit}
                      </span>
                    </div>
                  ))}
                  {recipe.items.length > 4 && (
                    <p className="text-[10px] text-zinc-400 italic">
                      +{recipe.items.length - 4} insumo(s)
                    </p>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-zinc-100">
                  <div className="text-[10px]">
                    <span className="text-zinc-400">Custo estimado:</span>{' '}
                    <span className="font-semibold text-zinc-700">
                      {fmt(custoUnit)}/{recipe.unit}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {batchCount > 0 && (
                      <span className="text-[10px] text-zinc-400">
                        {batchCount} produção
                        {batchCount > 1 ? 's' : ''}
                      </span>
                    )}
                    <button
                      onClick={() => onNovaProducao(recipe.id)}
                      className="px-3 py-1.5 bg-amber-500 text-white text-[11px] font-semibold rounded-lg hover:bg-amber-600 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <i className="ri-add-line mr-1" />
                      Registrar Produção
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Lista de Produções ─────────────────────────────────────────────────────
function ListaProducoes({
  onVerDetalhe,
}: {
  onVerDetalhe: (batch: ProductionBatch) => void;
}) {
  const { batches, deleteBatch } = useProducao();
  const [busca, setBusca] = useState('');
  const [ordenacao, setOrdenacao] = useState<OrdenacaoProducoes>('data_desc');
  const [confirmBatchId, setConfirmBatchId] = useState<string | null>(null);
  const [confirmBatchName, setConfirmBatchName] = useState('');

  const producoesFiltradas = useMemo(() => {
    const base = busca
      ? batches.filter((b) =>
          b.recipeName.toLowerCase().includes(busca.toLowerCase())
        )
      : batches;
    return [...base].sort((a, b) => {
      if (ordenacao === 'data_desc')
        return new Date(b.producedAt).getTime() - new Date(a.producedAt).getTime();
      if (ordenacao === 'custo_desc') return b.totalCost - a.totalCost;
      return b.producedQuantity - a.producedQuantity;
    });
  }, [batches, busca, ordenacao]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-4">
      <ConfirmModal
        isOpen={!!confirmBatchId}
        title="Excluir registro de produção?"
        message={`O registro "${confirmBatchName}" será excluído permanentemente. Esta ação não pode ser desfeita.`}
        icon="ri-delete-bin-6-line"
        confirmLabel="Excluir"
        danger
        onConfirm={() => {
          if (confirmBatchId) deleteBatch(confirmBatchId);
          setConfirmBatchId(null);
          setConfirmBatchName('');
        }}
        onCancel={() => {
          setConfirmBatchId(null);
          setConfirmBatchName('');
        }}
      />
      {/* Filtros */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2">
          <i className="ri-search-line text-zinc-400 text-sm" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar registro de produção..."
            className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto">
          {[
            { id: 'data_desc' as OrdenacaoProducoes, label: 'Mais recente' },
            { id: 'custo_desc' as OrdenacaoProducoes, label: 'Maior Custo' },
            { id: 'receita_desc' as OrdenacaoProducoes, label: 'Maior Produção' },
          ].map((op) => (
            <button
              key={op.id}
              onClick={() => setOrdenacao(op.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${
                ordenacao === op.id
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {op.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      {producoesFiltradas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-zinc-100 rounded-xl">
          <i className="ri-archive-drawer-line text-4xl text-zinc-300 block mb-3" />
          <p className="text-sm font-semibold text-zinc-500">
            Nenhum registro de produção
          </p>
          <p className="text-xs text-zinc-400 mt-1">
            Registre produções a partir das fichas de produção.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500">
                    Produto
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">
                    Data
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500">
                    Produzido
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">
                    Rendimento
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500">
                    Perda
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500">
                    Custo Total
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500">
                    Custo/{' '}
                    <span className="text-[9px]">un</span>
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">
                    Operador
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {producoesFiltradas.map((batch) => {
                  return (
                    <tr
                      key={batch.id}
                      className="hover:bg-zinc-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-zinc-800">
                          {batch.recipeName}
                        </p>
                        {batch.notes && (
                          <p className="text-[10px] text-zinc-400 truncate max-w-[180px]">
                            {batch.notes}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <p className="font-medium text-zinc-700">
                          {formatDate(batch.producedAt)}
                        </p>
                        <p className="text-[10px] text-zinc-400">
                          {formatTime(batch.producedAt)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-semibold text-zinc-800">
                          {batch.producedQuantity.toFixed(2)} {batch.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center">
                          {batch.yieldPercentActual !== null ? (
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                (batch.yieldPercentActual ?? 0) >= 70
                                  ? 'text-emerald-700 bg-emerald-50'
                                  : (batch.yieldPercentActual ?? 0) >= 40
                                  ? 'text-amber-700 bg-amber-50'
                                  : 'text-red-700 bg-red-50'
                              }`}
                            >
                              {batch.yieldPercentActual.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-[10px] text-zinc-400">—</span>
                          )}
                          {batch.yieldPercentExpected !== null && batch.yieldPercentActual !== null && (
                            <span className="text-[9px] text-zinc-400 mt-0.5">
                              esp: {batch.yieldPercentExpected.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {batch.lossQuantityKg && batch.lossQuantityKg > 0 ? (
                          <div>
                            <p className="text-[10px] font-semibold text-red-600">
                              {batch.lossQuantityKg.toFixed(3)} kg
                            </p>
                            {batch.lossValue && (
                              <p className="text-[10px] text-red-400">{fmt(batch.lossValue)}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-zinc-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-zinc-800">
                        {fmt(batch.totalCost)}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-600">
                        {fmt(batch.unitCost)}/{batch.unit}
                      </td>
                      <td className="px-4 py-3 text-center text-zinc-600">
                        {batch.producedBy}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onVerDetalhe(batch)}
                            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-amber-500 cursor-pointer transition-colors"
                            title="Ver detalhes"
                          >
                            <i className="ri-eye-line text-sm" />
                          </button>
                          <button
                            onClick={() => {
                              setConfirmBatchId(batch.id);
                              setConfirmBatchName(batch.recipeName);
                            }}
                            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
                            title="Excluir"
                          >
                            <i className="ri-delete-bin-line text-sm" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-zinc-50">
            {producoesFiltradas.map((batch) => {
              return (
                <div key={batch.id} className="p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-zinc-800">
                        {batch.recipeName}
                      </p>
                      <p className="text-[10px] text-zinc-400">
                        {formatDate(batch.producedAt)} · {batch.producedBy}
                      </p>
                    </div>
                    {batch.yieldPercentActual !== null ? (
                      <span
                        className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          (batch.yieldPercentActual ?? 0) >= 70
                            ? 'text-emerald-700 bg-emerald-50'
                            : (batch.yieldPercentActual ?? 0) >= 40
                            ? 'text-amber-700 bg-amber-50'
                            : 'text-red-700 bg-red-50'
                        }`}
                      >
                        {batch.yieldPercentActual.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-[10px] text-zinc-400">—</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <p className="text-[10px] text-zinc-400">Produzido</p>
                      <p className="text-xs font-bold text-zinc-800">
                        {batch.producedQuantity.toFixed(2)} {batch.unit}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-400">Custo total</p>
                      <p className="text-xs font-bold text-zinc-800">
                        {fmt(batch.totalCost)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onVerDetalhe(batch)}
                      className="flex-1 px-3 py-1.5 bg-zinc-100 text-zinc-600 text-[11px] font-medium rounded-lg hover:bg-zinc-200 transition-colors cursor-pointer"
                    >
                      <i className="ri-eye-line mr-1" />
                      Detalhes
                    </button>
                    <button
                      onClick={() => {
                        setConfirmBatchId(batch.id);
                        setConfirmBatchName(batch.recipeName);
                      }}
                      className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
                    >
                      <i className="ri-delete-bin-line text-sm" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab principal ─────────────────────────────────────────────────────────────
export default function ProducaoTab() {
  const { recipes, batches, loading } = useProducao();
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<SubTab>('fichas');
  const [showFichaModal, setShowFichaModal] = useState(false);
  const [showProducaoModal, setShowProducaoModal] = useState(false);
  const [showDetalheModal, setShowDetalheModal] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<ProductionRecipe | null>(null);
  const [producaoRecipeId, setProducaoRecipeId] = useState<string>('');
  const [detalheBatch, setDetalheBatch] = useState<ProductionBatch | null>(null);

  const handleEdit = (recipe: ProductionRecipe) => {
    setEditingRecipe(recipe);
    setShowFichaModal(true);
  };

  const handleNovaProducao = (recipeId: string) => {
    setProducaoRecipeId(recipeId);
    setShowProducaoModal(true);
  };

  const handleVerDetalhe = (batch: ProductionBatch) => {
    setDetalheBatch(batch);
    setShowDetalheModal(true);
  };

  return (
    <div className="space-y-5">
      {/* Resumo */}
      <ResumoCards recipes={recipes} batches={batches} />

      {/* Sub-tabs + ação */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-zinc-100 rounded-xl p-1">
          <button
            onClick={() => setSubTab('fichas')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              subTab === 'fichas'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            <i className="ri-file-list-3-line mr-1.5" />
            Fichas de Produção ({recipes.length})
          </button>
          <button
            onClick={() => setSubTab('producoes')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              subTab === 'producoes'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            <i className="ri-archive-drawer-line mr-1.5" />
            Registros de Produção ({batches.length})
          </button>
        </div>

        {subTab === 'fichas' && (
          <button
            onClick={() => {
              setEditingRecipe(null);
              setShowFichaModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-add-line" />
            Nova Ficha
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 gap-2 text-zinc-400">
          <i className="ri-loader-4-line animate-spin text-xl" />
          <span className="text-sm">Carregando...</span>
        </div>
      )}

      {/* Conteúdo */}
      {!loading && subTab === 'fichas' && (
        <ListaFichas
          recipes={recipes}
          onEdit={handleEdit}
          onNovaProducao={handleNovaProducao}
        />
      )}
      {!loading && subTab === 'producoes' && (
        <ListaProducoes onVerDetalhe={handleVerDetalhe} />
      )}

      {/* Modais */}
      {showFichaModal && (
        <FichaProducaoModal
          recipe={editingRecipe}
          onClose={() => {
            setShowFichaModal(false);
            setEditingRecipe(null);
          }}
        />
      )}
      {showProducaoModal && (
        <RegistroProducaoModal
          recipeId={producaoRecipeId}
          onClose={() => setShowProducaoModal(false)}
          operador={user?.nome ?? 'Operador'}
        />
      )}
      {showDetalheModal && detalheBatch && (
        <DetalheBatchModal
          batch={detalheBatch}
          onClose={() => {
            setShowDetalheModal(false);
            setDetalheBatch(null);
          }}
        />
      )}
    </div>
  );
}