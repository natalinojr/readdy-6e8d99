import { useState, useMemo } from 'react';
import { X, Calendar } from 'lucide-react';
import { useProducao } from '@/contexts/ProducaoContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatCurrencyPreciso, formatPercent } from '@/lib/formatters';
import { convertUnit } from '@/lib/unitConversion';
import FichaProducaoModal from './FichaProducaoModal';
import RegistroProducaoModal from './RegistroProducaoModal';
import DetalheBatchModal from './DetalheBatchModal';
import ConfirmModal from '@/components/base/ConfirmModal';
import type { ProductionRecipe, ProductionBatch } from '@/types/estoque';
import { KpiCard, Segmented } from '../../financeiro/components/dreUi';

const fmt = formatCurrency;
const fmtPct = formatPercent;

type SubTab = 'fichas' | 'producoes';
type OrdenacaoFichas = 'nome' | 'yield_desc' | 'itens';
type OrdenacaoProducoes = 'data_desc' | 'custo_desc' | 'receita_desc';

// ── Resumo cards ─────────────────────────────────────────────────────────────
function ResumoCards({
  recipes,
  batches,
  hasFilter,
}: {
  recipes: ProductionRecipe[];
  batches: ProductionBatch[];
  hasFilter?: boolean;
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
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <KpiCard
        label="Fichas Ativas" icon="ri-file-list-3-line" semVariacao atual={activeRecipes}
        value={String(activeRecipes)} sub="cadastradas"
      />
      <KpiCard
        label="Produções Registradas" icon="ri-archive-drawer-line" semVariacao atual={totalBatches}
        value={String(totalBatches)} sub={hasFilter ? 'no período' : 'no histórico'}
      />
      <KpiCard
        label="Rendimento Médio" icon="ri-percent-line" semVariacao atual={avgYield}
        value={fmtPct(avgYield)} valueTone="text-amber-700" sub="entre todas as produções"
      />
      <KpiCard
        label="Custo Total Investido" icon="ri-money-dollar-circle-line" semVariacao atual={custoTotal}
        value={fmt(custoTotal)} sub={hasFilter ? 'no período selecionado' : 'em todo o histórico'}
      />
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

  // Custo estimado de UMA RECEITA (os insumos da ficha), usando os precos ATUAIS
  // do estoque. NAO e custo por unidade de saida — a ficha nao declara rendimento
  // (ele se pesa no registro de producao, nao se afirma aqui), entao nao ha como
  // dividir por g/kg/l/un sem um numero inventado. O custo por unidade real so
  // existe DEPOIS de uma producao pesada (RegistroProducaoModal.unitCost), e e
  // esse que alimenta a ficha tecnica.
  const custoEstimadoPorReceita = useMemo(() => {
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
    <div className="space-y-5">
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
      <div className="flex flex-wrap items-center gap-2 lg:gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar ficha de produção..."
            className="w-full h-10 rounded-xl border border-zinc-200 shadow-sm pl-9 pr-3 text-sm bg-white text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
          />
        </div>
        <div className="overflow-x-auto max-w-full">
          <Segmented<OrdenacaoFichas>
            value={ordenacao}
            onChange={setOrdenacao}
            options={[
              { id: 'nome', label: 'Nome', icon: 'ri-sort-alphabet-asc' },
              { id: 'yield_desc', label: 'Mais Insumos', icon: 'ri-sort-desc' },
              { id: 'itens', label: 'Mais Insumos', icon: 'ri-stack-line' },
            ]}
          />
        </div>
      </div>

      {/* Grid de fichas */}
      {fichasFiltradas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center bg-white border border-zinc-200 rounded-2xl">
          <i className="ri-file-list-3-line text-4xl text-zinc-200 block mb-3" />
          <p className="text-sm font-semibold text-zinc-500">
            Nenhuma ficha encontrada
          </p>
          <p className="text-xs text-zinc-400 mt-1">
            Cadastre a primeira ficha de produção para começar.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {fichasFiltradas.map((recipe) => {
            const custoReceita = custoEstimadoPorReceita.get(recipe.id) ?? 0;
            const batchCount = batchCountForRecipe(recipe.id);
            return (
              <div
                key={recipe.id}
                className="bg-white rounded-2xl border border-zinc-200 p-4 hover:border-amber-300 transition-colors group"
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
                  <div className="flex items-center gap-1 flex-shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
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
                    <span className="text-zinc-400">Custo estimado (1 receita):</span>{' '}
                    <span className="font-semibold text-zinc-700">
                      {fmt(custoReceita)}
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
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-semibold rounded-xl shadow-sm transition-colors cursor-pointer whitespace-nowrap"
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
  dateFrom,
  dateTo,
  setDateFrom,
  setDateTo,
}: {
  onVerDetalhe: (batch: ProductionBatch) => void;
  dateFrom: string;
  dateTo: string;
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
}) {
  const { batches, deleteBatch } = useProducao();
  const [busca, setBusca] = useState('');
  const [ordenacao, setOrdenacao] = useState<OrdenacaoProducoes>('data_desc');
  const [confirmBatchId, setConfirmBatchId] = useState<string | null>(null);
  const [confirmBatchName, setConfirmBatchName] = useState('');

  const hasDateFilter = dateFrom || dateTo;
  const clearDates = () => { setDateFrom(''); setDateTo(''); };

  const producoesFiltradas = useMemo(() => {
    let base = busca
      ? batches.filter((b) => b.recipeName.toLowerCase().includes(busca.toLowerCase()))
      : batches;

    if (dateFrom || dateTo) {
      base = base.filter((b) => {
        const d = new Date(b.producedAt);
        if (dateFrom && d < new Date(dateFrom + 'T00:00:00')) return false;
        if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false;
        return true;
      });
    }

    return [...base].sort((a, b) => {
      if (ordenacao === 'data_desc')
        return new Date(b.producedAt).getTime() - new Date(a.producedAt).getTime();
      if (ordenacao === 'custo_desc') return b.totalCost - a.totalCost;
      return b.producedQuantity - a.producedQuantity;
    });
  }, [batches, busca, ordenacao, dateFrom, dateTo]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-5">
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
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 lg:gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar registro de produção..."
              className="w-full h-10 rounded-xl border border-zinc-200 shadow-sm pl-9 pr-3 text-sm bg-white text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
            />
          </div>
          <div className="overflow-x-auto max-w-full">
            <Segmented<OrdenacaoProducoes>
              value={ordenacao}
              onChange={setOrdenacao}
              options={[
                { id: 'data_desc', label: 'Mais recente', icon: 'ri-time-line' },
                { id: 'custo_desc', label: 'Maior Custo', icon: 'ri-money-dollar-circle-line' },
                { id: 'receita_desc', label: 'Maior Produção', icon: 'ri-sort-desc' },
              ]}
            />
          </div>
        </div>

        {/* Filtro de período */}
        <div className="flex items-center gap-3 flex-wrap bg-white border border-zinc-200 rounded-2xl px-5 py-3">
          <div className="w-4 h-4 flex items-center justify-center text-zinc-400 flex-shrink-0">
            <Calendar size={14} />
          </div>
          <span className="text-xs font-semibold text-zinc-500 whitespace-nowrap">Período:</span>
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-zinc-400 whitespace-nowrap">De</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-10 text-xs border border-zinc-200 shadow-sm rounded-xl px-3 text-zinc-700 focus:outline-none focus:border-amber-400 cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-zinc-400 whitespace-nowrap">Até</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-10 text-xs border border-zinc-200 shadow-sm rounded-xl px-3 text-zinc-700 focus:outline-none focus:border-amber-400 cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-1">
              {[
                { label: 'Hoje', days: 0 },
                { label: '7d', days: 7 },
                { label: '30d', days: 30 },
                { label: 'Mês', days: -1 },
              ].map(({ label, days }) => (
                <button
                  key={label}
                  onClick={() => {
                    const today = new Date();
                    const todayStr = today.toISOString().split('T')[0];
                    if (days === 0) {
                      setDateFrom(todayStr); setDateTo(todayStr);
                    } else if (days === -1) {
                      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
                      setDateFrom(firstDay.toISOString().split('T')[0]);
                      setDateTo(todayStr);
                    } else {
                      const from = new Date(today);
                      from.setDate(from.getDate() - days);
                      setDateFrom(from.toISOString().split('T')[0]);
                      setDateTo(todayStr);
                    }
                  }}
                  className="px-3 py-2 text-xs font-semibold rounded-xl bg-zinc-100 text-zinc-500 hover:bg-amber-50 hover:text-amber-700 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {label}
                </button>
              ))}
            </div>
            {hasDateFilter && (
              <button
                onClick={clearDates}
                className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-zinc-500 hover:text-red-500 bg-zinc-100 hover:bg-red-50 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                <X size={11} /> Limpar
              </button>
            )}
          </div>
          {hasDateFilter && (
            <span className="text-xs font-semibold text-amber-600 whitespace-nowrap">
              {producoesFiltradas.length} resultado{producoesFiltradas.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

      </div>

      {/* Tabela */}
      {producoesFiltradas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center bg-white border border-zinc-200 rounded-2xl">
          <i className="ri-archive-drawer-line text-4xl text-zinc-200 block mb-3" />
          <p className="text-sm font-semibold text-zinc-500">
            Nenhum registro de produção
          </p>
          <p className="text-xs text-zinc-400 mt-1">
            {hasDateFilter ? 'Tente outro período ou limpe o filtro.' : 'Registre produções a partir das fichas de produção.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-zinc-200">
                <tr>
                  <th className="pl-5 pr-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Produto
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Data
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Produzido
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Rendimento
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Perda
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Custo Total
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Custo/{' '}
                    <span className="text-[9px]">un</span>
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Operador
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100/80">
                {producoesFiltradas.map((batch) => {
                  return (
                    <tr
                      key={batch.id}
                      className="hover:bg-zinc-50 transition-colors"
                    >
                      <td className="pl-5 pr-4 py-3">
                        <p className="font-medium text-zinc-800 truncate max-w-[240px]" title={batch.recipeName}>
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
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                        <span className="font-semibold text-zinc-800">
                          {batch.producedQuantity.toFixed(2)} {batch.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center">
                          {batch.yieldPercentActual !== null ? (
                            <span
                              className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold ${
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
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-semibold text-zinc-800">
                        {fmt(batch.totalCost)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-zinc-600">
                        {formatCurrencyPreciso(batch.unitCost)}/{batch.unit}
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
          <div className="md:hidden divide-y divide-zinc-100/80">
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
                        className={`flex-shrink-0 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
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
                      className="flex-1 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors shadow-sm"
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

  // Filtro de período elevado para o nível do tab
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Batches filtrados pelo período — usados no resumo E na lista
  const batchesFiltrados = useMemo(() => {
    if (!dateFrom && !dateTo) return batches;
    return batches.filter((b) => {
      const d = new Date(b.producedAt);
      if (dateFrom && d < new Date(dateFrom + 'T00:00:00')) return false;
      if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false;
      return true;
    });
  }, [batches, dateFrom, dateTo]);

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
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Resumo — usa batchesFiltrados para refletir o período */}
      <ResumoCards recipes={recipes} batches={batchesFiltrados} hasFilter={!!(dateFrom || dateTo)} />

      {/* Sub-tabs + ação */}
      <div className="flex flex-wrap items-center gap-2 lg:gap-3">
        <div className="flex gap-1 overflow-x-auto bg-zinc-100/80 rounded-xl p-1 w-full sm:w-fit">
          <button
            onClick={() => setSubTab('fichas')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
              subTab === 'fichas'
                ? 'bg-white text-amber-600 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <i className="ri-file-list-3-line" />
            Fichas de Produção ({recipes.length})
          </button>
          <button
            onClick={() => setSubTab('producoes')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
              subTab === 'producoes'
                ? 'bg-white text-amber-600 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <i className="ri-archive-drawer-line" />
            Registros de Produção ({batches.length})
          </button>
        </div>

        {subTab === 'fichas' && (
          <div className="ml-auto flex items-center gap-2 overflow-x-auto max-w-full">
            <button
              onClick={() => {
                setEditingRecipe(null);
                setShowFichaModal(true);
              }}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors shadow-sm"
            >
              <i className="ri-add-line" />
              Nova Ficha
            </button>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="py-14 text-center">
          <i className="ri-loader-4-line animate-spin text-4xl text-zinc-200 block mb-2" />
          <span className="text-zinc-400 text-sm">Carregando...</span>
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
        <ListaProducoes
          onVerDetalhe={handleVerDetalhe}
          dateFrom={dateFrom}
          dateTo={dateTo}
          setDateFrom={setDateFrom}
          setDateTo={setDateTo}
        />
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