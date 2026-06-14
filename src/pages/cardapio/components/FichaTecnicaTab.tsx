import { useState, useEffect, useCallback } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useProducao } from '@/contexts/ProducaoContext';
import type { Insumo } from '@/contexts/EstoqueContext';
import type { ProductionRecipe } from '@/types/estoque';

// ── Unidades suportadas ───────────────────────────────────────────────────────
const ALL_UNITS = ['g', 'kg', 'ml', 'l', 'un'];

// Converte do formato do banco → frontend
const DB_UNIT_MAP: Record<string, string> = {
  g: 'g', kg: 'kg', ml: 'ml', L: 'l', unit: 'un',
};

// Converte do frontend → banco
const FRONT_TO_DB_UNIT: Record<string, string> = {
  g: 'g', kg: 'kg', ml: 'ml', l: 'L', un: 'unit',
};

/**
 * Converte `qty` em `fromUnit` para a `toUnit` da base do insumo.
 * Ex: 100 g → 0.1 kg
 * Retorna null se a conversão não for possível (incompatível).
 */
function convertToBase(qty: number, fromUnit: string, toUnit: string): number | null {
  if (fromUnit === toUnit) return qty;

  // Peso
  if (fromUnit === 'g' && toUnit === 'kg') return qty / 1000;
  if (fromUnit === 'kg' && toUnit === 'g') return qty * 1000;

  // Volume
  if (fromUnit === 'ml' && toUnit === 'l') return qty / 1000;
  if (fromUnit === 'l' && toUnit === 'ml') return qty * 1000;

  // Sem conversão possível
  return null;
}

/** Retorna as unidades compatíveis com a unidade base do insumo */
function compatibleUnits(baseUnit: string): string[] {
  if (baseUnit === 'kg' || baseUnit === 'g') return ['g', 'kg'];
  if (baseUnit === 'l' || baseUnit === 'ml') return ['ml', 'l'];
  return ['un'];
}

interface FichaRow {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  ingredient_unit: string;
}

interface FichaLocal {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  /** Unidade escolhida pelo usuário para esse item da ficha (pode ser diferente da base) */
  unit: string;
  /** Unidade base do insumo no estoque */
  baseUnit: string;
  unit_price: number;
  /** 'ingredient' = insumo do estoque; 'production' = produto produzido */
  source: 'ingredient' | 'production';
}

interface Props {
  itemId?: string;
  precoVenda: number;
  onCountChange?: (count: number) => void;
}

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Formata valor monetário */
function fmtMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Calcula o custo real de uma linha, convertendo para a unidade base do insumo */
function calcCustoLinha(ficha: FichaLocal): number {
  const qtyBase = convertToBase(ficha.quantity, ficha.unit, ficha.baseUnit) ?? ficha.quantity;
  return qtyBase * ficha.unit_price;
}

export default function FichaTecnicaTab({ itemId, precoVenda, onCountChange }: Props) {
  const { user } = useAuth();
  const { insumos } = useEstoque();
  const { recipes, getBatchesByRecipeId } = useProducao();
  const [fichas, setFichas] = useState<FichaLocal[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busca, setBusca] = useState('');
  const [showSelect, setShowSelect] = useState(false);
  const [activeTab, setActiveTab] = useState<'ingredient' | 'production'>('ingredient');

  const isRealItem = itemId && isUuid(itemId);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getRecipeUnitCost = (recipeId: string): number => {
    const batches = getBatchesByRecipeId(recipeId);
    if (batches.length === 0) return 0;
    // Usa a média do custo unitário de todas as produções
    return batches.reduce((s, b) => s + b.unitCost, 0) / batches.length;
  };

  // ── Carregar ficha do banco ───────────────────────────────────────────────
  const loadFicha = useCallback(async () => {
    if (!isRealItem || !user?.tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('fn_get_item_ingredients', {
        p_tenant_id: user.tenantId,
        p_item_id: itemId,
      });
      if (error) throw error;
      const rows = (data as FichaRow[]) ?? [];
      const mapped: FichaLocal[] = rows.map((r) => {
        const baseUnit = DB_UNIT_MAP[r.ingredient_unit] ?? 'un';
        const rowUnit = DB_UNIT_MAP[r.unit] ?? 'un';
        // Detecta se é produto produzido pelo outputIngredientId
        const recipeMatch = recipes.find((rec) => rec.outputIngredientId === r.ingredient_id);
        return {
          id: r.id,
          ingredient_id: r.ingredient_id,
          ingredient_name: r.ingredient_name,
          quantity: Number(r.quantity),
          unit: rowUnit,
          baseUnit,
          unit_price: Number(r.unit_price),
          source: recipeMatch ? 'production' : 'ingredient',
        };
      });
      setFichas(mapped);
      onCountChange?.(mapped.length);
    } catch (e) {
      console.error('[FichaTecnicaTab] loadFicha error:', e);
    } finally {
      setLoading(false);
    }
  }, [isRealItem, user?.tenantId, itemId, onCountChange, recipes]);

  useEffect(() => { loadFicha(); }, [loadFicha]);

  // ── Salvar ficha no banco ─────────────────────────────────────────────────
  const handleSave = async () => {
    if (!isRealItem || !user?.tenantId) return;
    setSaving(true);
    try {
      const { error } = await invokeWithAuth('menu-write', {
        body: {
          action: 'upsert_item_ingredients',
          active_tenant_id: user.tenantId,
          payload: {
            item_id: itemId,
            ingredients: fichas.map((f) => ({
              ingredient_id: f.ingredient_id,
              quantity: f.quantity,
              unit: FRONT_TO_DB_UNIT[f.unit] ?? 'unit',
            })),
          },
        },
      });
      if (error) throw error;
      setSaved(true);
      onCountChange?.(fichas.length);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      console.error('[FichaTecnicaTab] save error:', e);
    } finally {
      setSaving(false);
    }
  };

  // ── Adicionar insumo ──────────────────────────────────────────────────────
  const addInsumo = (insumo: Insumo) => {
    if (fichas.find((f) => f.ingredient_id === insumo.id)) return;
    const nova: FichaLocal = {
      id: `ft-${Date.now()}`,
      ingredient_id: insumo.id,
      ingredient_name: insumo.nome,
      quantity: 1,
      unit: insumo.unidade,
      baseUnit: insumo.unidade,
      unit_price: insumo.precoUnitario,
      source: 'ingredient',
    };
    const updated = [...fichas, nova];
    setFichas(updated);
    onCountChange?.(updated.length);
    setBusca('');
    setShowSelect(false);
    setSaved(false);
  };

  // ── Adicionar produto de produção ────────────────────────────────────────
  const addProdutoProducao = (recipe: ProductionRecipe) => {
    if (!recipe.outputIngredientId) return;
    if (fichas.find((f) => f.ingredient_id === recipe.outputIngredientId)) return;
    const unitCost = getRecipeUnitCost(recipe.id);
    const nova: FichaLocal = {
      id: `ft-prod-${Date.now()}`,
      ingredient_id: recipe.outputIngredientId,
      ingredient_name: recipe.name,
      quantity: 1,
      unit: recipe.unit,
      baseUnit: recipe.unit,
      unit_price: unitCost,
      source: 'production',
    };
    const updated = [...fichas, nova];
    setFichas(updated);
    onCountChange?.(updated.length);
    setBusca('');
    setShowSelect(false);
    setSaved(false);
  };

  const updateQuantity = (id: string, quantity: number) => {
    setFichas((prev) => prev.map((f) => (f.id === id ? { ...f, quantity } : f)));
    setSaved(false);
  };

  const updateUnit = (id: string, unit: string) => {
    setFichas((prev) => prev.map((f) => (f.id === id ? { ...f, unit } : f)));
    setSaved(false);
  };

  const remove = (id: string) => {
    const updated = fichas.filter((f) => f.id !== id);
    setFichas(updated);
    onCountChange?.(updated.length);
    setSaved(false);
  };

  // ── Cálculos financeiros ──────────────────────────────────────────────────
  const custoTotal = fichas.reduce((acc, f) => acc + calcCustoLinha(f), 0);
  const margemBruta = precoVenda > 0 ? ((precoVenda - custoTotal) / precoVenda) * 100 : 0;
  const corMargem = margemBruta >= 60 ? 'text-green-600' : margemBruta >= 40 ? 'text-yellow-600' : 'text-red-500';

  // Insumos de uso final (excluindo os já adicionados)
  const insumosFinaisFiltrados = insumos.filter(
    (ins) =>
      ins.nome.toLowerCase().includes(busca.toLowerCase()) &&
      !fichas.find((f) => f.ingredient_id === ins.id),
  );

  // Produtos de produção (excluindo os já adicionados, apenas os com outputIngredientId)
  const produtosProducaoFiltrados = recipes.filter(
    (recipe) =>
      recipe.outputIngredientId &&
      recipe.name.toLowerCase().includes(busca.toLowerCase()) &&
      !fichas.find((f) => f.ingredient_id === recipe.outputIngredientId),
  );

  // ── Estados de guarda ─────────────────────────────────────────────────────
  if (!isRealItem) {
    return (
      <div className="text-center py-10 text-zinc-400">
        <div className="w-12 h-12 flex items-center justify-center mx-auto mb-2">
          <i className="ri-test-tube-line text-3xl" />
        </div>
        <p className="text-sm font-medium text-zinc-500">Salve o item primeiro</p>
        <p className="text-xs mt-1">Após criar o item, abra-o novamente para gerenciar a ficha técnica.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-zinc-400">
        <i className="ri-loader-4-line animate-spin text-xl" />
        <span className="text-sm">Carregando ficha técnica...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Vincule insumos de uso final ou produtos produzidos. O sistema converte automaticamente ao dar baixa no estoque.
      </p>

      {/* Banner: baixa automática */}
      {fichas.length > 0 ? (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
            <i className="ri-arrow-down-circle-line text-emerald-600 text-base" />
          </div>
          <div>
            <p className="text-xs font-bold text-emerald-700">Baixa automática de estoque ativa</p>
            <p className="text-xs text-emerald-600 mt-0.5">
              A cada venda deste item, o sistema deduzirá automaticamente{' '}
              <strong>{fichas.length} insumo{fichas.length > 1 ? 's' : ''}</strong> do estoque, com conversão de unidades.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl">
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
            <i className="ri-information-line text-zinc-400 text-base" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-600">Sem baixa automática</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              Adicione insumos ou produtos de produção abaixo para ativar a dedução automática de estoque a cada venda.
            </p>
          </div>
        </div>
      )}

      {/* Resumo financeiro */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-50 rounded-xl p-3 text-center">
          <p className="text-xs text-zinc-500 mb-1">Custo por unidade</p>
          <p className="text-base font-bold text-zinc-800">{fmtMoeda(custoTotal)}</p>
        </div>
        <div className="bg-zinc-50 rounded-xl p-3 text-center">
          <p className="text-xs text-zinc-500 mb-1">Preço de venda</p>
          <p className="text-base font-bold text-zinc-800">{fmtMoeda(precoVenda)}</p>
        </div>
        <div className="bg-zinc-50 rounded-xl p-3 text-center">
          <p className="text-xs text-zinc-500 mb-1">Margem bruta</p>
          <p className={`text-base font-bold ${corMargem}`}>
            {precoVenda > 0 ? `${margemBruta.toFixed(1)}%` : '—'}
          </p>
          {precoVenda > 0 && (
            <p className={`text-xs font-semibold mt-0.5 ${corMargem}`}>
              {fmtMoeda(precoVenda - custoTotal)}
            </p>
          )}
        </div>
      </div>

      {/* Tabela de ingredientes */}
      {fichas.length > 0 && (
        <div className="border border-zinc-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-xs text-zinc-500 uppercase">
                <th className="text-left px-4 py-2.5 font-medium">Insumo</th>
                <th className="text-center px-3 py-2.5 font-medium w-44">Quantidade</th>
                <th className="text-center px-2 py-2.5 font-medium w-20">Unidade</th>
                <th className="text-right px-4 py-2.5 font-medium w-28">Custo</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {fichas.map((f, idx) => {
                const custo = calcCustoLinha(f);
                const units = compatibleUnits(f.baseUnit);
                const needsConversion = f.unit !== f.baseUnit;
                const qtyBase = needsConversion
                  ? convertToBase(f.quantity, f.unit, f.baseUnit)
                  : null;

                return (
                  <tr key={f.id} className={`border-t border-zinc-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/40'}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {f.source === 'production' && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-bold rounded">
                            PRODUZIDO
                          </span>
                        )}
                        <p className="text-xs font-medium text-zinc-700 leading-tight">{f.ingredient_name}</p>
                      </div>
                      <p className="text-xs text-zinc-400">
                        {fmtMoeda(f.unit_price)}/{f.baseUnit}
                        {needsConversion && qtyBase !== null && (
                          <span className="ml-1.5 text-amber-500 font-medium">
                            → {qtyBase % 1 === 0 ? qtyBase : qtyBase.toFixed(3)} {f.baseUnit} no estoque
                          </span>
                        )}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        className="w-full border border-zinc-200 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:border-amber-400"
                        value={f.quantity}
                        onChange={(e) => updateQuantity(f.id, parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      {units.length > 1 ? (
                        <select
                          value={f.unit}
                          onChange={(e) => updateUnit(f.id, e.target.value)}
                          className="w-full border border-zinc-200 rounded-lg px-1.5 py-1.5 text-xs focus:outline-none focus:border-amber-400 bg-white cursor-pointer"
                        >
                          {units.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-zinc-400 text-center block">{f.unit}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-xs font-semibold text-zinc-700">{fmtMoeda(custo)}</span>
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <button
                        onClick={() => remove(f.id)}
                        className="w-6 h-6 flex items-center justify-center text-zinc-300 hover:text-red-500 cursor-pointer rounded transition-colors mx-auto"
                      >
                        <i className="ri-close-line text-sm" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 bg-amber-50">
                <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-amber-700">Total de insumos</td>
                <td className="px-4 py-2.5 text-right text-sm font-bold text-amber-700">{fmtMoeda(custoTotal)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {fichas.length === 0 && !showSelect && (
        <div className="text-center py-8 text-zinc-400">
          <div className="w-12 h-12 flex items-center justify-center mx-auto mb-2">
            <i className="ri-test-tube-line text-3xl" />
          </div>
          <p className="text-sm font-medium text-zinc-500">Nenhum insumo vinculado</p>
          <p className="text-xs mt-1">Adicione insumos ou produtos de produção para calcular o custo real deste item</p>
          {insumos.length === 0 && (
            <p className="text-xs mt-2 text-amber-600 font-medium">
              Cadastre insumos na aba Estoque primeiro.
            </p>
          )}
        </div>
      )}

      {/* Adicionar insumo / produto de produção */}
      {showSelect ? (
        <div className="border border-amber-200 rounded-xl p-3 bg-amber-50/40">
          <div className="flex items-center gap-2 mb-2">
            <div className="relative flex-1">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input
                autoFocus
                className="w-full pl-8 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-amber-400 bg-white"
                placeholder="Buscar..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <button
              onClick={() => { setShowSelect(false); setBusca(''); }}
              className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer rounded-lg transition-colors"
            >
              <i className="ri-close-line" />
            </button>
          </div>

          {/* Tabs do seletor */}
          <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 mb-2">
            <button
              onClick={() => setActiveTab('ingredient')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'ingredient'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Insumos de uso final
            </button>
            <button
              onClick={() => setActiveTab('production')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'production'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Produtos de produção
            </button>
          </div>

          <div className="max-h-44 overflow-y-auto space-y-1">
            {activeTab === 'ingredient' ? (
              insumosFinaisFiltrados.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-3">
                  {insumos.length === 0 ? 'Nenhum insumo cadastrado no estoque' : 'Nenhum insumo encontrado'}
                </p>
              ) : (
                insumosFinaisFiltrados.map((ins) => (
                  <button
                    key={ins.id}
                    onClick={() => addInsumo(ins)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg hover:bg-white cursor-pointer transition-colors text-left"
                  >
                    <span className="text-zinc-700 font-medium">{ins.nome}</span>
                    <span className="text-xs text-zinc-400">
                      {ins.precoUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/{ins.unidade}
                      {ins.purchaseUnit && ins.purchaseUnit !== ins.unidade && (
                        <span className="ml-1.5 text-amber-500">· compra em {ins.purchaseUnit}</span>
                      )}
                    </span>
                  </button>
                ))
              )
            ) : (
              produtosProducaoFiltrados.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-3">
                  {recipes.length === 0 ? 'Nenhuma ficha de produção cadastrada' : 'Nenhum produto encontrado'}
                </p>
              ) : (
                produtosProducaoFiltrados.map((recipe) => {
                  const unitCost = getRecipeUnitCost(recipe.id);
                  return (
                    <button
                      key={recipe.id}
                      onClick={() => addProdutoProducao(recipe)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg hover:bg-white cursor-pointer transition-colors text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-bold rounded">PRODUZIDO</span>
                        <span className="text-zinc-700 font-medium">{recipe.name}</span>
                      </div>
                      <span className="text-xs text-zinc-400">
                        {unitCost > 0
                          ? `${unitCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/${recipe.unit}`
                          : `Sem produção registrada · ${recipe.unit}`}
                      </span>
                    </button>
                  );
                })
              )
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowSelect(true)}
          className="w-full border-2 border-dashed border-zinc-200 hover:border-amber-300 hover:bg-amber-50 text-zinc-500 hover:text-amber-600 text-sm font-medium py-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
        >
          <i className="ri-add-line" /> Adicionar Insumo ou Produto de Produção
        </button>
      )}

      {/* Nota de conversão */}
      {fichas.some((f) => f.unit !== f.baseUnit) && (
        <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5">
            <i className="ri-scales-3-line text-amber-500 text-sm" />
          </div>
          <p className="text-xs text-amber-700">
            <strong>Conversão automática:</strong> as quantidades em unidades diferentes da base (ex: g vs kg) são convertidas automaticamente ao deduzir do estoque.
          </p>
        </div>
      )}

      {/* Botão salvar */}
      {isRealItem && (
        <div className="flex items-center gap-3 pt-2 border-t border-zinc-100">
          {saved && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
              <i className="ri-check-line" /> Ficha salva com sucesso!
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            {saving ? (
              <><i className="ri-loader-4-line animate-spin" /> Salvando...</>
            ) : (
              <><i className="ri-save-line" /> Salvar Ficha Técnica</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
