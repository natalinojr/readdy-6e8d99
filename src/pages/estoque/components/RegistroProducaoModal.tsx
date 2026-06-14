import { useState, useMemo, useCallback, useEffect } from 'react';
import { useProducao } from '@/contexts/ProducaoContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { supabase } from '@/lib/supabase';
import { convertUnit, getRelatedUnits, convertUnitCost, sameUnitGroup } from '@/lib/unitConversion';
import type { NovaBateladaComEstoque } from '@/contexts/ProducaoContext';

interface Props {
  recipeId: string;
  onClose: () => void;
  operador: string;
}

const fmt = formatCurrency;

/** Draft minimal — nunca persiste quantitiesUsed para evitar valores errados */
interface DraftData {
  producedQty: string;
  producedUnit: string;
  notes: string;
  stepsCompleted: string[];
  savedAt: string;
}

const getDraftKey = (recipeId: string) => `producao_draft_${recipeId}`;

function loadDraft(recipeId: string): DraftData | null {
  try {
    const raw = localStorage.getItem(getDraftKey(recipeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftData;
    if (parsed.savedAt) {
      const saved = new Date(parsed.savedAt).getTime();
      const now = Date.now();
      if (now - saved > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(getDraftKey(recipeId));
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(recipeId: string, data: DraftData) {
  try {
    localStorage.setItem(getDraftKey(recipeId), JSON.stringify(data));
  } catch {
    /* ignore quota exceeded */
  }
}

function clearDraft(recipeId: string) {
  localStorage.removeItem(getDraftKey(recipeId));
}

export default function RegistroProducaoModal({ recipeId, onClose, operador }: Props) {
  const { getRecipeById, addBatchWithStock } = useProducao();
  const { insumos, upsertInsumo, reloadInsumos, reloadMovimentacoes } = useEstoque();
  const { user } = useAuth();
  const recipe = getRecipeById(recipeId);

  const draft = recipe ? loadDraft(recipe.id) : null;

  const [producedQty, setProducedQty] = useState(draft?.producedQty ?? '');
  const [producedUnit, setProducedUnit] = useState(draft?.producedUnit ?? recipe?.unit ?? 'kg');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);

  const [manualOverrides, setManualOverrides] = useState<Set<string>>(new Set());

  const fatorEscala = useMemo(() => {
    const prod = Number(producedQty);
    if (prod <= 0 || isNaN(prod)) return 1;
    return prod;
  }, [producedQty]);

  /** quantitiesUsed sempre recalculado da ficha — nunca do draft */
  const [quantitiesUsed, setQuantitiesUsed] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    if (recipe) {
      recipe.items.forEach((it) => {
        map[it.ingredientId] = Number((it.quantity).toFixed(4));
      });
    }
    return map;
  });

  /** unitsUsed sempre da ficha — nunca do draft */
  const [unitsUsed, setUnitsUsed] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (recipe) {
      recipe.items.forEach((it) => {
        map[it.ingredientId] = it.unit;
      });
    }
    return map;
  });

  const [stepsCompleted, setStepsCompleted] = useState<Set<string>>(() => {
    if (draft?.stepsCompleted) return new Set(draft.stepsCompleted);
    return new Set();
  });

  // Auto-calculate ingredient quantities based on produced amount
  useEffect(() => {
    if (!recipe) return;
    const prod = Number(producedQty);
    if (prod <= 0 || isNaN(prod)) return;

    setQuantitiesUsed((prev) => {
      const next: Record<string, number> = { ...prev };
      recipe.items.forEach((it) => {
        if (manualOverrides.has(it.ingredientId)) return;
        const totalQty = it.quantity * prod;
        next[it.ingredientId] = Number(totalQty.toFixed(4));
      });
      return next;
    });
  }, [producedQty, recipe, manualOverrides]);

  // Auto-salva rascunho a cada mudanca (apenas dados de producao, NAO quantitiesUsed)
  useEffect(() => {
    if (!recipe) return;
    saveDraft(recipe.id, {
      producedQty,
      producedUnit,
      notes,
      stepsCompleted: Array.from(stepsCompleted),
      savedAt: new Date().toISOString(),
    });
  }, [recipe, producedQty, producedUnit, notes, stepsCompleted]);

  // Resto do componente continua igual...
  // ... existing code ...

  const toggleStep = useCallback((stepId: string) => {
    setStepsCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  const updateQtyUsed = useCallback((ingredientId: string, val: number) => {
    setManualOverrides((prev) => {
      const next = new Set(prev);
      next.add(ingredientId);
      return next;
    });
    setQuantitiesUsed((prev) => ({ ...prev, [ingredientId]: val }));
  }, []);

  const updateUnitUsed = useCallback((ingredientId: string, newUnit: string) => {
    setUnitsUsed((prev) => {
      const oldUnit = prev[ingredientId];
      if (oldUnit === newUnit) return prev;
      const oldQty = quantitiesUsed[ingredientId] ?? 0;
      const converted = convertUnit(oldQty, oldUnit, newUnit);
      if (converted !== null && converted > 0) {
        setQuantitiesUsed((qPrev) => ({ ...qPrev, [ingredientId]: Number(converted.toFixed(4)) }));
      }
      return { ...prev, [ingredientId]: newUnit };
    });
  }, [quantitiesUsed]);

  const updateProducedUnit = useCallback((newUnit: string) => {
    if (producedUnit === newUnit) return;
    const oldQty = Number(producedQty);
    if (oldQty > 0) {
      const converted = convertUnit(oldQty, producedUnit, newUnit);
      if (converted !== null) {
        setProducedQty(String(Number(converted.toFixed(4))));
      }
    }
    setProducedUnit(newUnit);
  }, [producedQty, producedUnit]);

  // Total bruto de insumos usados (em kg)
  const totalBrutoKg = useMemo(() => {
    if (!recipe) return 0;
    return recipe.items.reduce((sum, it) => {
      const qty = quantitiesUsed[it.ingredientId] ?? 0;
      const unit = unitsUsed[it.ingredientId] ?? it.unit;
      const conv = convertUnit(qty, unit, 'kg');
      return sum + (conv ?? qty);
    }, 0);
  }, [recipe, quantitiesUsed, unitsUsed]);

  // Total bruto de insumos ESPERADOS pela ficha (em kg) para a quantidade produzida
  const totalEsperadoKg = useMemo(() => {
    if (!recipe) return 0;
    return recipe.items.reduce((sum, it) => {
      const expectedQty = it.quantity * fatorEscala;
      const conv = convertUnit(expectedQty, it.unit, 'kg');
      return sum + (conv ?? expectedQty);
    }, 0);
  }, [recipe, fatorEscala]);

  // Produto gerado em kg (quando unidade permite conversao)
  const produtoGeradoKg = useMemo(() => {
    if (!recipe || !producedQty || Number(producedQty) <= 0) return null;
    const prod = Number(producedQty);
    if (producedUnit === 'kg') return prod;
    if (producedUnit === 'g') return prod * 0.001;
    if (producedUnit === 'l') return prod;
    if (producedUnit === 'ml') return prod * 0.001;
    if (producedUnit === 'un') return null;
    return null;
  }, [recipe, producedQty, producedUnit]);

  // Rendimento real (%)
  const yieldActual = useMemo(() => {
    if (totalBrutoKg <= 0 || produtoGeradoKg === null || produtoGeradoKg <= 0) return null;
    return (produtoGeradoKg / totalBrutoKg) * 100;
  }, [totalBrutoKg, produtoGeradoKg]);

  // Perda em kg
  const perdaKg = useMemo(() => {
    if (totalBrutoKg <= 0) return null;

    // Caso 1: produto tem peso conhecido (kg, g, l, ml)
    if (produtoGeradoKg !== null && produtoGeradoKg > 0) {
      const diff = totalBrutoKg - produtoGeradoKg;
      return diff > 0.0001 ? diff : 0;
    }

    // Caso 2: produto em unidades — perda = excesso de insumo vs esperado pela ficha
    if (totalEsperadoKg > 0) {
      const diff = totalBrutoKg - totalEsperadoKg;
      return diff > 0.0001 ? diff : 0;
    }

    return null;
  }, [totalBrutoKg, produtoGeradoKg, totalEsperadoKg]);

  const perdaPercent = useMemo(() => {
    if (totalBrutoKg <= 0 || perdaKg === null) return null;
    return (perdaKg / totalBrutoKg) * 100;
  }, [perdaKg, totalBrutoKg]);

  // Rendimento esperado da ficha
  const yieldExpected = useMemo(() => {
    if (!recipe || recipe.items.length === 0) return null;
    const totalInsumosKg = recipe.items.reduce((sum, it) => {
      const conv = convertUnit(it.quantity, it.unit, 'kg');
      return sum + (conv ?? it.quantity);
    }, 0);
    if (totalInsumosKg <= 0) return null;

    let produtoEsperadoKg = 0;
    if (recipe.unit === 'kg') produtoEsperadoKg = 1;
    else if (recipe.unit === 'g') produtoEsperadoKg = 0.001;
    else if (recipe.unit === 'l') produtoEsperadoKg = 1;
    else if (recipe.unit === 'ml') produtoEsperadoKg = 0.001;
    else return null;

    return ((produtoEsperadoKg / totalInsumosKg) * 100);
  }, [recipe]);

  // Validacao de estoque
  const stockErrors = useMemo(() => {
    const errors: Record<string, { needed: number; available: number; unit: string }> = {};
    if (!recipe) return errors;

    for (const it of recipe.items) {
      const insumo = insumos.find((i) => i.id === it.ingredientId);
      if (!insumo) continue;

      const qty = quantitiesUsed[it.ingredientId] ?? 0;
      const unit = unitsUsed[it.ingredientId] ?? it.unit;

      const neededInStockUnit = convertUnit(qty, unit, insumo.unidade) ?? qty;
      const available = insumo.estoqueAtual;

      if (neededInStockUnit > available + 0.0001) {
        errors[it.ingredientId] = {
          needed: neededInStockUnit,
          available,
          unit: insumo.unidade,
        };
      }
    }
    return errors;
  }, [recipe, quantitiesUsed, unitsUsed, insumos]);

  const hasStockErrors = Object.keys(stockErrors).length > 0;

  // Custo total corrigido
  const totalCost = useMemo(() => {
    if (!recipe) return 0;
    return recipe.items.reduce((s, it) => {
      const qty = quantitiesUsed[it.ingredientId] ?? 0;
      const unit = unitsUsed[it.ingredientId] ?? it.unit;
      const insumo = insumos.find((i) => i.id === it.ingredientId);
      const stockUnit = insumo?.unidade ?? it.unit;
      const stockCost = insumo?.precoUnitario ?? it.unitCost ?? 0;

      const costPerUsedUnit = sameUnitGroup(stockUnit, unit)
        ? (convertUnitCost(stockCost, stockUnit, unit) ?? stockCost)
        : stockCost;

      return s + qty * costPerUsedUnit;
    }, 0);
  }, [recipe, quantitiesUsed, unitsUsed, insumos]);

  const perdaValue = useMemo(() => {
    if (perdaKg === null || perdaKg <= 0 || totalBrutoKg <= 0) return 0;
    return totalCost * (perdaKg / totalBrutoKg);
  }, [perdaKg, totalBrutoKg, totalCost]);

  const unitCost = Number(producedQty) > 0 ? totalCost / Number(producedQty) : 0;

  const handleSave = async () => {
    if (!producedQty || Number(producedQty) <= 0) return;
    if (totalSteps > 0 && !allStepsDone) return;
    if (hasStockErrors) return;

    setSaving(true);
    setSaveErrors([]);

    try {
      const tenantId = user?.tenantId;
      if (!tenantId) throw new Error('Tenant nao identificado');
      if (!recipe) throw new Error('Ficha nao encontrada');

      // 1. Usar outputIngredientId da recipe, ou buscar/criar insumo
      let outputInsumoId = recipe.outputIngredientId;
      console.log('[RegistroProducaoModal] handleSave start. outputIngredientId from recipe:', outputInsumoId);

      if (!outputInsumoId) {
        // Fallback: buscar por nome no estado local
        outputInsumoId = insumos.find((i) => i.nome === recipe.name)?.id;
        console.log('[RegistroProducaoModal] outputInsumoId from local insumos by name:', outputInsumoId);

        if (!outputInsumoId) {
          console.log('[RegistroProducaoModal] Criando insumo para produto acabado:', recipe.name);
          const novoId = await upsertInsumo({
            nome: recipe.name,
            unidade: recipe.unit,
            estoqueAtual: 0,
            estoqueMinimo: recipe.minStock ?? 0,
            precoUnitario: unitCost,
            categoria: recipe.category ?? 'Produtos Produzidos',
            fornecedor: 'Producao interna',
            usageType: 'production',
          });
          console.log('[RegistroProducaoModal] upsertInsumo returned ID:', novoId);

          if (!novoId) {
            throw new Error(`Nao foi possivel criar o insumo "${recipe.name}" no estoque`);
          }

          // Recarrega e busca pelo nome DIRETO no banco
          await reloadInsumos();
          const { data: freshRows, error: freshErr } = await supabase
            .rpc('fn_get_ingredients', { p_tenant_id: tenantId });
          if (freshErr) console.warn('[RegistroProducaoModal] fn_get_ingredients after upsert error:', freshErr);
          const freshInsumos = (freshRows as Array<Record<string, unknown>>) ?? [];
          const match = freshInsumos.find((r) => r.name === recipe.name);
          outputInsumoId = match ? String(match.id ?? '') : novoId;
          console.log('[RegistroProducaoModal] outputInsumoId after DB fetch:', outputInsumoId);
        }
      }

      if (!outputInsumoId) {
        throw new Error('Nao foi possivel determinar o ID do insumo do produto acabado');
      }

      // 2. Preparar itens com custo total — converte quantidade para UNIDADE DO ESTOQUE do insumo
      const batchItems = recipe.items.map((it) => {
        const insumo = insumos.find((i) => i.id === it.ingredientId);
        const qtyInput = quantitiesUsed[it.ingredientId] ?? 0;
        const inputUnit = unitsUsed[it.ingredientId] ?? it.unit;
        const stockUnit = insumo?.unidade ?? it.unit;

        // Converter quantidade para a unidade de estoque do insumo
        let qtyInStockUnit = qtyInput;
        if (inputUnit !== stockUnit) {
          const converted = convertUnit(qtyInput, inputUnit, stockUnit);
          if (converted !== null && converted > 0) {
            qtyInStockUnit = converted;
          }
        }

        // Custo unitário sempre na unidade do estoque (preçoUnitario é por stockUnit)
        const stockCost = insumo?.precoUnitario ?? it.unitCost ?? 0;
        // Custo total = quantidade na unidade do estoque × preço por unidade de estoque
        const itemTotalCost = qtyInStockUnit * stockCost;

        return {
          ingredientId: it.ingredientId,
          ingredientName: it.ingredientName,
          // Envia na unidade DO ESTOQUE — a RPC também faz convert_unit internamente,
          // então precisamos garantir que unit === stockUnit para evitar dupla conversão
          quantityUsed: Number(qtyInStockUnit.toFixed(6)),
          unit: stockUnit,
          unitCost: stockCost,
          totalCost: Number(itemTotalCost.toFixed(2)),
        };
      });

      console.log('[RegistroProducaoModal] batchItems prepared (em unidade de estoque):', batchItems.map(b => ({ id: b.ingredientId, nome: b.ingredientName, qty: b.quantityUsed, unit: b.unit, custo: b.totalCost })));

      // Recalcula custo total com base nos batchItems já convertidos para stockUnit
      // (evita divergência entre o totalCost do useMemo e os itens enviados à RPC)
      const totalCostFinal = batchItems.reduce((s, it) => s + it.totalCost, 0);
      const unitCostFinal = Number(producedQty) > 0 ? totalCostFinal / Number(producedQty) : 0;

      // 3. Chamar a operacao atomica (producao + estoque em uma chamada so)
      const nova: NovaBateladaComEstoque = {
        recipeId: recipe.id,
        recipeName: recipe.name,
        producedQuantity: Number(producedQty),
        unit: producedUnit,
        yieldPercentActual: yieldActual ? Number(yieldActual.toFixed(2)) : null,
        yieldPercentExpected: yieldExpected ? Number(yieldExpected.toFixed(2)) : null,
        lossQuantityKg: perdaKg,
        lossValue: perdaValue > 0 ? Number(perdaValue.toFixed(2)) : null,
        notes: notes.trim(),
        stepsCompleted: Array.from(stepsCompleted),
        totalCost: Number(totalCostFinal.toFixed(2)),
        unitCost: Number(unitCostFinal.toFixed(4)),
        producedBy: operador,
        items: batchItems,
        outputIngredientId: outputInsumoId,
      };

      console.log('[RegistroProducaoModal] Enviando addBatchWithStock:', nova);
      const batchId = await addBatchWithStock(nova);
      console.log('[RegistroProducaoModal] Producao registrada com sucesso, batchId:', batchId);

      // Recarrega estoque e movimentacoes imediatamente
      await reloadInsumos();
      await reloadMovimentacoes();

      clearDraft(recipe.id);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[RegistroProducaoModal] handleSave error:', msg);
      setSaveErrors([msg]);
    } finally {
      setSaving(false);
    }
  };

  const formatDate = () => {
    const d = new Date();
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  };

  if (!recipe) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white rounded-xl p-6 shadow-xl text-center">
          <i className="ri-error-warning-line text-3xl text-red-400 block mb-2" />
          <p className="text-sm text-zinc-600">Ficha de producao nao encontrada</p>
        </div>
      </div>
    );
  }

  const completedCount = stepsCompleted.size;
  const totalSteps = recipe.steps?.length ?? 0;
  const allStepsDone = totalSteps > 0 && completedCount === totalSteps;
  const canRegister = Number(producedQty) > 0 && (totalSteps === 0 || allStepsDone) && !hasStockErrors;

  const relatedUnits = getRelatedUnits(recipe.unit);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-zinc-100 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-bold text-zinc-800">
              Registrar Producao — {recipe.name}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {formatDate()} · Operador: {operador}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Info da ficha */}
          <div className="bg-zinc-50 border border-zinc-100 rounded-lg p-3">
            <p className="text-[10px] text-zinc-400">
              Ficha define os insumos para produzir{' '}
              <strong className="text-zinc-600">1 {recipe.unit}</strong>{' '}
              do produto. O sistema recalcula automaticamente ao digitar a quantidade produzida.
            </p>
          </div>

          {/* Quantidade produzida */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
              Quantidade produzida <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={producedQty}
                onChange={(e) => setProducedQty(e.target.value)}
                placeholder="Ex: 10"
                className="flex-1 text-xs border border-zinc-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
              />
              <select
                value={producedUnit}
                onChange={(e) => updateProducedUnit(e.target.value)}
                className="text-xs border border-zinc-200 rounded-lg px-2 py-2.5 focus:outline-none focus:border-amber-400 bg-white"
              >
                {relatedUnits.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Rendimento e perda */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3">
              <label className="block text-xs font-semibold text-zinc-600 mb-1">
                Rendimento real
              </label>
              <p className="text-lg font-bold text-zinc-800">
                {yieldActual !== null ? `${yieldActual.toFixed(1)}%` : '—'}
              </p>
              {yieldExpected !== null && yieldActual !== null && (
                <p className={`text-[10px] mt-0.5 ${
                  yieldActual < yieldExpected * 0.8 ? 'text-red-500' : 'text-zinc-400'
                }`}>
                  Esperado: {yieldExpected.toFixed(1)}%
                  {yieldActual < yieldExpected * 0.8 && ' · Abaixo do esperado!'}
                </p>
              )}
            </div>
            {perdaKg !== null && perdaKg > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-red-700 flex items-center gap-1">
                    <i className="ri-alert-line" />
                    Perda
                  </p>
                  <span className="text-sm font-bold text-red-700">
                    {perdaPercent?.toFixed(1)}%
                  </span>
                </div>
                <p className="text-[10px] text-red-600">
                  {perdaKg.toFixed(3)} kg · Custo: {fmt(perdaValue)}
                </p>
              </div>
            )}
          </div>

          {/* Checklist de passos */}
          {totalSteps > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-zinc-600">
                  Checklist de preparo
                </label>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                  allStepsDone
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-zinc-100 text-zinc-500'
                }`}>
                  {completedCount}/{totalSteps} concluido{totalSteps > 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-1.5">
                {recipe.steps!.map((step) => {
                  const done = stepsCompleted.has(step.id);
                  return (
                    <button
                      key={step.id}
                      onClick={() => toggleStep(step.id)}
                      className={`w-full flex items-start gap-2.5 text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                        done
                          ? 'bg-emerald-50 border-emerald-200'
                          : 'bg-white border-zinc-200 hover:border-amber-300'
                      }`}
                    >
                      <span className={`w-4 h-4 mt-0.5 flex items-center justify-center rounded border flex-shrink-0 transition-colors ${
                        done
                          ? 'bg-emerald-500 border-emerald-500'
                          : 'bg-white border-zinc-300'
                      }`}>
                        {done && <i className="ri-check-line text-white text-[10px]" />}
                      </span>
                      <span className={`text-xs leading-relaxed ${
                        done ? 'text-emerald-700 line-through' : 'text-zinc-700'
                      }`}>
                        {step.text}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!allStepsDone && (
                <p className="text-[10px] text-amber-600 mt-2 flex items-center gap-1">
                  <i className="ri-alert-line" />
                  Complete todos os {totalSteps} passos antes de registrar a producao
                </p>
              )}
            </div>
          )}

          {/* Alerta global de estoque insuficiente */}
          {hasStockErrors && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                <i className="ri-error-warning-line" />
                Estoque insuficiente
              </p>
              <p className="text-[10px] text-red-600 mt-1">
                Ajuste as quantidades ou repoe o estoque antes de registrar a producao.
              </p>
            </div>
          )}

          {/* Erros de salvamento */}
          {saveErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1.5">
              <p className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                <i className="ri-error-warning-line" />
                Erros ao atualizar o estoque
              </p>
              <p className="text-[10px] text-red-600">
                A producao foi registrada, mas houve falhas nas movimentacoes de estoque. Verifique o console para detalhes.
              </p>
              <ul className="space-y-0.5">
                {saveErrors.map((err, idx) => (
                  <li key={idx} className="text-[10px] text-red-600 flex items-start gap-1">
                    <span className="flex-shrink-0 mt-0.5">•</span>
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Insumos usados */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-zinc-600">
                Insumos brutos — total da batelada
              </label>
              <span className="text-[10px] text-zinc-400">
                Calculado automaticamente. Edite para ajustar manualmente.
              </span>
            </div>
            <div className="space-y-2">
              {recipe.items.map((it) => {
                const insumo = insumos.find((i) => i.id === it.ingredientId);
                const qty = quantitiesUsed[it.ingredientId] ?? 0;
                const unit = unitsUsed[it.ingredientId] ?? it.unit;
                const stockUnit = insumo?.unidade ?? it.unit;
                const stockCost = insumo?.precoUnitario ?? it.unitCost ?? 0;

                const costPerUsedUnit = sameUnitGroup(stockUnit, unit)
                  ? (convertUnitCost(stockCost, stockUnit, unit) ?? stockCost)
                  : stockCost;
                const cost = qty * costPerUsedUnit;

                const availableUnits = getRelatedUnits(it.unit);
                const stockError = stockErrors[it.ingredientId];
                const isManual = manualOverrides.has(it.ingredientId);

                return (
                  <div
                    key={it.id}
                    className={`flex items-start gap-3 rounded-lg px-3 py-2.5 border ${
                      stockError
                        ? 'bg-red-50 border-red-200'
                        : 'bg-zinc-50 border-zinc-100'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-zinc-700 truncate">
                        {it.ingredientName}
                        {isManual && (
                          <span className="ml-1.5 text-[10px] text-amber-600 font-normal">
                            (ajustado)
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-zinc-400">
                        Custo: {fmt(cost)}
                        {insumo && (
                          <span className="ml-2">
                            · Estoque: {insumo.estoqueAtual.toFixed(3)} {insumo.unidade}
                          </span>
                        )}
                      </p>
                      {stockError && (
                        <p className="text-[10px] text-red-600 mt-0.5 flex items-center gap-1">
                          <i className="ri-error-warning-line" />
                          Precisa {stockError.needed.toFixed(3)} {stockError.unit} ·
                          Disponivel {stockError.available.toFixed(3)} {stockError.unit}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={qty || ''}
                        onChange={(e) =>
                          updateQtyUsed(it.ingredientId, Number(e.target.value))
                        }
                        className={`w-20 text-xs border rounded-md px-2 py-1.5 focus:outline-none text-center ${
                          stockError
                            ? 'border-red-300 focus:border-red-400'
                            : isManual
                              ? 'border-amber-300 focus:border-amber-400 bg-amber-50'
                              : 'border-zinc-200 focus:border-amber-400'
                        }`}
                      />
                      <select
                        value={unit}
                        onChange={(e) => updateUnitUsed(it.ingredientId, e.target.value)}
                        className="text-xs border border-zinc-200 rounded-md px-1 py-1.5 focus:outline-none focus:border-amber-400 bg-white w-14"
                      >
                        {availableUnits.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Observacoes */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
              Observacoes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Rendimento bom, pouca perda na casca..."
              rows={2}
              className="w-full text-xs border border-zinc-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400 resize-none"
            />
          </div>

          {/* Resumo de custo */}
          <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-emerald-800">
                Custo total dos insumos
              </span>
              <span className="text-sm font-bold text-emerald-700">
                {fmt(totalCost)}
              </span>
            </div>
            {Number(producedQty) > 0 && (
              <div className="flex items-center justify-between pt-2 border-t border-emerald-200/50">
                <span className="text-xs text-emerald-700">
                  Custo unitario do produto gerado
                </span>
                <span className="text-base font-black text-emerald-700">
                  {fmt(unitCost)}/{producedUnit}
                </span>
              </div>
            )}
            {perdaValue > 0 && (
              <div className="flex items-center justify-between pt-1 mt-1">
                <span className="text-[10px] text-red-600">
                  Inclui {fmt(perdaValue)} de perda
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-zinc-100 px-5 py-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !canRegister}
            className="px-4 py-2 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
          >
            {saving ? (
              <i className="ri-loader-4-line animate-spin" />
            ) : (
              <>
                <i className="ri-check-line mr-1" />
                Registrar producao
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}