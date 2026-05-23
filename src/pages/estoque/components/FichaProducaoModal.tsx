import { useState, useCallback, useMemo } from 'react';
import { useProducao } from '@/contexts/ProducaoContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useIngredientCategories } from '@/hooks/useIngredientCategories';
import type { ProductionRecipe, UnidadeEstoque } from '@/types/estoque';
import { convertUnit, sameUnitGroup, convertUnitCost } from '@/lib/unitConversion';

interface Props {
  recipe: ProductionRecipe | null;
  onClose: () => void;
}

const UNIDADES: UnidadeEstoque[] = ['kg', 'g', 'l', 'ml', 'un'];

interface FormItem {
  tempId: string;
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
}

interface FormStep {
  id: string;
  text: string;
}

export default function FichaProducaoModal({ recipe, onClose }: Props) {
  const { addRecipe, updateRecipe } = useProducao();
  const { insumos } = useEstoque();
  const { names: categoriasDisponiveis } = useIngredientCategories();

  const isEditing = !!recipe;
  const [nome, setNome] = useState(recipe?.name ?? '');
  const [unidade, setUnidade] = useState<UnidadeEstoque>(recipe?.unit ?? 'kg');
  const [categoria, setCategoria] = useState(recipe?.category ?? '');
  const [minStock, setMinStock] = useState<number>(recipe?.minStock ?? 0);
  const [items, setItems] = useState<FormItem[]>(
    recipe?.items.map((it) => ({
      tempId: it.id,
      ingredientId: it.ingredientId,
      ingredientName: it.ingredientName,
      quantity: it.quantity,
      unit: it.unit,
    })) ?? []
  );
  const [steps, setSteps] = useState<FormStep[]>(
    recipe?.steps?.map((s) => ({ id: s.id, text: s.text })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [buscaInsumo, setBuscaInsumo] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>('');
  const [novoPasso, setNovoPasso] = useState('');

  const insumosDisponiveis = useMemo(() => {
    return insumos.filter((i) => !items.some((it) => it.ingredientId === i.id));
  }, [insumos, items]);

  const insumosFiltrados = useMemo(() => {
    let filtrados = insumosDisponiveis;
    if (buscaInsumo.trim()) {
      filtrados = filtrados.filter((i) =>
        i.nome.toLowerCase().includes(buscaInsumo.toLowerCase())
      );
    }
    if (categoriaFiltro) {
      filtrados = filtrados.filter((i) => i.categoria === categoriaFiltro);
    }
    return filtrados;
  }, [insumosDisponiveis, buscaInsumo, categoriaFiltro]);

  const categoriasUnicas = useMemo(() => {
    const cats = new Set(insumosDisponiveis.map((i) => i.categoria).filter(Boolean));
    return Array.from(cats) as string[];
  }, [insumosDisponiveis]);

  const addInsumo = useCallback(
    (insumoId: string, insumoNome: string, unidadeInsumo: string) => {
      setItems((prev) => [
        ...prev,
        {
          tempId: `tmp-${Date.now()}`,
          ingredientId: insumoId,
          ingredientName: insumoNome,
          quantity: 0,
          unit: unidadeInsumo,
        },
      ]);
      setBuscaInsumo('');
    },
    []
  );

  const updateItem = (tempId: string, field: keyof FormItem, value: unknown) => {
    setItems((prev) =>
      prev.map((it) => (it.tempId === tempId ? { ...it, [field]: value } : it))
    );
  };

  const changeItemUnit = (tempId: string, newUnit: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.tempId !== tempId) return it;
        const insumo = insumos.find((i) => i.id === it.ingredientId);
        if (!insumo) return { ...it, unit: newUnit };
        const conv = convertUnit(it.quantity, it.unit, newUnit);
        return {
          ...it,
          quantity: conv !== null ? conv : it.quantity,
          unit: newUnit,
        };
      })
    );
  };

  const removeItem = (tempId: string) => {
    setItems((prev) => prev.filter((it) => it.tempId !== tempId));
  };

  const addStep = () => {
    const text = novoPasso.trim();
    if (!text) return;
    setSteps((prev) => [...prev, { id: `stp-${Date.now()}`, text }]);
    setNovoPasso('');
  };

  const updateStep = (id: string, text: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, text } : s)));
  };

  const removeStep = (id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  };

  const moveStep = (id: string, dir: -1 | 1) => {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const arr = [...prev];
      const [item] = arr.splice(idx, 1);
      arr.splice(newIdx, 0, item);
      return arr;
    });
  };

  const handleSave = async () => {
    if (!nome.trim()) return;
    if (items.length === 0) return;
    if (items.some((it) => it.quantity <= 0)) return;

    setSaving(true);
    try {
      if (isEditing && recipe) {
        await updateRecipe(recipe.id, {
          name: nome.trim(),
          unit: unidade,
          category: categoria.trim() || undefined,
          minStock,
          instructions: '',
          steps: steps.map((s) => ({ id: s.id, text: s.text })),
          items: items.map((it) => ({
            id: it.tempId.startsWith('tmp-')
              ? `rcti-${Date.now()}-${it.tempId}`
              : it.tempId,
            ingredientId: it.ingredientId,
            ingredientName: it.ingredientName,
            quantity: it.quantity,
            unit: it.unit,
            unitCost: 0,
          })),
        });
      } else {
        await addRecipe({
          name: nome.trim(),
          unit: unidade,
          category: categoria.trim() || undefined,
          minStock,
          instructions: '',
          steps: steps.map((s) => ({ id: s.id, text: s.text })),
          items: items.map((it) => ({
            ingredientId: it.ingredientId,
            ingredientName: it.ingredientName,
            quantity: it.quantity,
            unit: it.unit,
          })),
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // Custo total dos insumos da ficha (para 1 unidade)
  const custoTotalInsumos = items.reduce((s, it) => {
    const insumo = insumos.find((i) => i.id === it.ingredientId);
    const convertedCost = convertUnitCost(
      insumo?.precoUnitario ?? 0,
      insumo?.unidade ?? it.unit,
      it.unit
    );
    return s + it.quantity * (convertedCost ?? insumo?.precoUnitario ?? 0);
  }, 0);

  // Rendimento esperado (só quando unidade de saída é massa/volume)
  const rendimentoEsperado = useMemo(() => {
    if (items.length === 0) return null;
    const totalInsumosKg = items.reduce((sum, it) => {
      const conv = convertUnit(it.quantity, it.unit, 'kg');
      return sum + (conv ?? it.quantity);
    }, 0);
    if (totalInsumosKg <= 0) return null;

    let produtoKg = 0;
    if (unidade === 'kg') produtoKg = 1;
    else if (unidade === 'g') produtoKg = 0.001;
    else if (unidade === 'l') produtoKg = 1;
    else if (unidade === 'ml') produtoKg = 0.001;
    else return null; // 'un' — nao calcula rendimento % automaticamente

    return ((produtoKg / totalInsumosKg) * 100);
  }, [items, unidade]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-zinc-100 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-bold text-zinc-800">
              {isEditing ? 'Editar Ficha de Producao' : 'Nova Ficha de Producao'}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Cadastre insumos brutos por unidade do produto. Na producao, o sistema cria o produto acabado no estoque automaticamente.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Nome e unidade */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                Nome do produto semi-acabado
              </label>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Hamburguer 180g"
                className="w-full text-xs border border-zinc-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                Unidade de saida
              </label>
              <select
                value={unidade}
                onChange={(e) => setUnidade(e.target.value as UnidadeEstoque)}
                className="w-full text-xs border border-zinc-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400 bg-white"
              >
                {UNIDADES.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Categoria */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
              Categoria do produto acabado
            </label>
            <div className="flex items-center gap-2">
              <input
                list="cat-producao"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                placeholder="Ex: Produtos Semi-acabados"
                className="flex-1 text-xs border border-zinc-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
              />
              <datalist id="cat-producao">
                {categoriasDisponiveis.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>
            <p className="text-[10px] text-zinc-400 mt-1">
              Ao registrar a producao, o produto sera criado no estoque com essa categoria.
            </p>
          </div>

          {/* Quantidade minima de estoque */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
              Quantidade minima de estoque
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={minStock || ''}
                onChange={(e) => setMinStock(Number(e.target.value))}
                placeholder="Ex: 5"
                className="w-28 text-xs border border-zinc-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
              />
              <span className="text-xs text-zinc-500">{unidade}</span>
            </div>
            <p className="text-[10px] text-zinc-400 mt-1">
              Quando o estoque deste produto atingir este nivel, o sistema alertara para producao.
            </p>
          </div>

          <p className="text-[10px] text-zinc-400">
            Os insumos abaixo representam o consumo para produzir <strong>1 {unidade}</strong> do produto. Na producao, o sistema multiplica automaticamente pela quantidade produzida e cria o produto no estoque.
          </p>

          {/* Checklist de passos */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">
              Passos do modo de preparo
            </label>
            <div className="space-y-2 mb-3">
              {steps.length === 0 && (
                <p className="text-xs text-zinc-400 italic">
                  Nenhum passo cadastrado. Adicione os passos que o operador deve seguir.
                </p>
              )}
              {steps.map((step, idx) => (
                <div
                  key={step.id}
                  className="flex items-center gap-2 bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2"
                >
                  <span className="w-5 h-5 flex items-center justify-center bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full flex-shrink-0">
                    {idx + 1}
                  </span>
                  <input
                    value={step.text}
                    onChange={(e) => updateStep(step.id, e.target.value)}
                    className="flex-1 text-xs bg-transparent text-zinc-700 focus:outline-none"
                  />
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => moveStep(step.id, -1)}
                      disabled={idx === 0}
                      className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-zinc-600 disabled:opacity-30 cursor-pointer"
                    >
                      <i className="ri-arrow-up-line text-xs" />
                    </button>
                    <button
                      onClick={() => moveStep(step.id, 1)}
                      disabled={idx === steps.length - 1}
                      className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-zinc-600 disabled:opacity-30 cursor-pointer"
                    >
                      <i className="ri-arrow-down-line text-xs" />
                    </button>
                    <button
                      onClick={() => removeStep(step.id)}
                      className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-red-500 cursor-pointer"
                    >
                      <i className="ri-close-line text-xs" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={novoPasso}
                onChange={(e) => setNovoPasso(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addStep(); }}
                placeholder="Adicionar novo passo..."
                className="flex-1 text-xs border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
              />
              <button
                onClick={addStep}
                disabled={!novoPasso.trim()}
                className="px-3 py-2 bg-zinc-100 text-zinc-700 text-xs font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-add-line mr-1" />
                Adicionar
              </button>
            </div>
          </div>

          {/* Insumos da ficha */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">
              Insumos brutos por unidade <span className="text-red-400">*</span>
            </label>

            {/* Busca + filtros */}
            <div className="relative mb-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 flex-1">
                  <i className="ri-search-line text-zinc-400 text-sm" />
                  <input
                    value={buscaInsumo}
                    onChange={(e) => setBuscaInsumo(e.target.value)}
                    placeholder="Buscar insumo..."
                    className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none"
                  />
                  {buscaInsumo && (
                    <button
                      onClick={() => setBuscaInsumo('')}
                      className="text-zinc-400 hover:text-zinc-600 cursor-pointer"
                    >
                      <i className="ri-close-line" />
                    </button>
                  )}
                </div>
                {categoriasUnicas.length > 0 && (
                  <select
                    value={categoriaFiltro}
                    onChange={(e) => setCategoriaFiltro(e.target.value)}
                    className="text-xs border border-zinc-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:border-amber-400"
                  >
                    <option value="">Todas</option>
                    {categoriasUnicas.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Grid de insumos disponiveis */}
              {insumosFiltrados.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto border border-zinc-200 rounded-lg p-2 bg-zinc-50/50">
                  {insumosFiltrados.map((insumo) => (
                    <button
                      key={insumo.id}
                      onClick={() => addInsumo(insumo.id, insumo.nome, insumo.unidade)}
                      className="flex flex-col items-start p-2.5 bg-white border border-zinc-200 rounded-lg hover:border-amber-400 hover:bg-amber-50 transition-colors cursor-pointer text-left"
                    >
                      <span className="text-xs font-medium text-zinc-700 truncate w-full">
                        {insumo.nome}
                      </span>
                      <span className="text-[10px] text-zinc-400 mt-0.5">
                        {insumo.unidade} · R$ {insumo.precoUnitario.toFixed(2)}
                        {insumo.categoria ? ` · ${insumo.categoria}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {buscaInsumo && insumosFiltrados.length === 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg p-3 text-xs text-zinc-400 text-center">
                  Nenhum insumo encontrado
                </div>
              )}
            </div>

            {/* Lista de insumos adicionados */}
            {items.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-zinc-200 rounded-lg">
                <i className="ri-add-circle-line text-2xl text-zinc-300 block mb-2" />
                <p className="text-xs text-zinc-400">
                  Adicione insumos brutos a ficha de producao
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((it) => {
                  const insumo = insumos.find((i) => i.id === it.ingredientId);
                  const unidadesCompat = UNIDADES.filter((u) =>
                    sameUnitGroup(u, insumo?.unidade ?? it.unit)
                  );
                  const convertedCost = convertUnitCost(
                    insumo?.precoUnitario ?? 0,
                    insumo?.unidade ?? it.unit,
                    it.unit
                  );
                  return (
                    <div
                      key={it.tempId}
                      className="flex items-center gap-3 bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2.5"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-zinc-700 truncate">
                          {it.ingredientName}
                        </p>
                        <p className="text-[10px] text-zinc-400">
                          Custo: R$ {(convertedCost ?? insumo?.precoUnitario ?? 0).toFixed(2)}/{it.unit}
                          {insumo && it.unit !== insumo.unidade && (
                            <span className="text-zinc-300 ml-1">
                              (cadastrado em {insumo.unidade})
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={it.quantity || ''}
                          onChange={(e) =>
                            updateItem(it.tempId, 'quantity', Number(e.target.value))
                          }
                          placeholder="Qtd"
                          className="w-20 text-xs border border-zinc-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-amber-400 text-center"
                        />
                        <select
                          value={it.unit}
                          onChange={(e) => changeItemUnit(it.tempId, e.target.value)}
                          className="text-xs border border-zinc-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:border-amber-400"
                        >
                          {unidadesCompat.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => removeItem(it.tempId)}
                          className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
                        >
                          <i className="ri-close-line text-sm" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Resumo: custo + rendimento esperado */}
          {items.length > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-800">
                  Custo total dos insumos (por 1 {unidade})
                </span>
                <span className="text-sm font-bold text-amber-700">
                  R$ {custoTotalInsumos.toFixed(2)}
                </span>
              </div>
              {rendimentoEsperado !== null && (
                <div className="flex items-center justify-between pt-2 border-t border-amber-200/50">
                  <span className="text-xs font-semibold text-amber-800">
                    Rendimento esperado
                  </span>
                  <span className="text-sm font-bold text-amber-700">
                    {rendimentoEsperado.toFixed(1)}%
                  </span>
                </div>
              )}
              <p className="text-[10px] text-amber-600">
                Custo e rendimento por unidade de produto. Na producao, o sistema multiplica automaticamente pela quantidade produzida.
              </p>
            </div>
          )}
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
            disabled={
              saving ||
              !nome.trim() ||
              items.length === 0 ||
              items.some((it) => it.quantity <= 0)
            }
            className="px-4 py-2 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
          >
            {saving ? (
              <i className="ri-loader-4-line animate-spin" />
            ) : (
              <>
                <i className="ri-save-line mr-1" />
                {isEditing ? 'Salvar alteracoes' : 'Criar ficha'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}