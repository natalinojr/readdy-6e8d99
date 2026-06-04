import { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Insumo, UnidadeEstoque } from '@/contexts/EstoqueContext';
import { useIngredientPriceHistory } from '@/hooks/useIngredientPriceHistory';

const unidades: UnidadeEstoque[] = ['kg', 'g', 'l', 'ml', 'un'];
const UNIDADES_COMPRA_SUGERIDAS = ['kg', 'g', 'l', 'ml', 'un', 'caixa', 'fardo', 'pacote', 'saco', 'lata', 'garrafa', 'pct', 'dz'];

interface InsumoModalProps {
  insumo?: Insumo | null;
  categoriasDisponiveis: string[];
  dreCategories?: never[];
  onClose: () => void;
  onSave: (data: Omit<Insumo, 'estoqueAtual' | 'ultimaEntrada' | 'fichaTecnica' | 'esgotado'> & { id?: string }) => void;
}

export default function InsumoModal({ insumo, categoriasDisponiveis, onClose, onSave }: InsumoModalProps) {
  // Busca fornecedores diretamente — garante dados frescos independente do estado do pai
  const isEdit = !!insumo;
  const [nome, setNome] = useState(insumo?.nome ?? '');
  const [unidade, setUnidade] = useState<UnidadeEstoque>(insumo?.unidade ?? 'kg');
  const [categoria, setCategoria] = useState(insumo?.categoria ?? '');
  const [usageType, setUsageType] = useState<'final' | 'production'>(insumo?.usageType ?? 'final');
  const [estoqueMinimo, setEstoqueMinimo] = useState(insumo?.estoqueMinimo?.toString() ?? '');
  const [purchaseUnit, setPurchaseUnit] = useState(insumo?.purchaseUnit ?? '');
  const [purchaseFactor, setPurchaseFactor] = useState(insumo?.purchaseFactor?.toString() ?? '1');
  const [purchaseUnitOpen, setPurchaseUnitOpen] = useState(false);
  const purchaseUnitRef = useRef<HTMLDivElement>(null);

  // === Preço Unitário com fonte ===
  const [priceSource, setPriceSource] = useState<'manual' | 'auto'>(
    insumo?.priceSource === 'manual' ? 'manual' : 'auto'
  );
  const [precoUnitario, setPrecoUnitario] = useState(
    insumo?.precoUnitario?.toString() ?? '0'
  );

  // Busca preço automático (média 3m / última compra)
  const { stats: priceStats } = useIngredientPriceHistory(insumo?.id ?? null);

  // Valor automático a exibir
  const autoPrice = priceStats?.avg3m ?? priceStats?.lastPrice ?? insumo?.precoUnitario ?? 0;
  const autoSourceLabel = priceStats?.avg3m ? 'Média 3 meses' : 'Última compra';
  const autoSourceIcon = priceStats?.avg3m ? 'ri-bar-chart-line' : 'ri-shopping-cart-line';
  const autoSourceColor = priceStats?.avg3m ? 'text-sky-600' : 'text-green-600';
  const autoSourceBg = priceStats?.avg3m ? 'bg-sky-50' : 'bg-green-50';

  // Fornecedor dropdown state
  // (removido — campo de fornecedor não é mais exibido na UI de estoque)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (purchaseUnitRef.current && !purchaseUnitRef.current.contains(e.target as Node)) {
        setPurchaseUnitOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const usePurchaseUnit = purchaseUnit.trim() !== '' && purchaseUnit.trim() !== unidade;
  const podeSubmeter = nome.trim().length > 0;

  const handleSalvar = () => {
    if (!podeSubmeter) return;
    onSave({
      id: insumo?.id,
      nome: nome.trim(),
      unidade,
      categoria: categoria || 'Sem categoria',
      usageType,
      precoUnitario: priceSource === 'manual'
        ? parseFloat(precoUnitario.replace(',', '.')) || 0
        : (insumo?.precoUnitario ?? 0),
      priceSource: priceSource === 'manual' ? 'manual' : 'auto',
      estoqueMinimo: parseFloat(estoqueMinimo.replace(',', '.')) || 0,
      purchaseUnit: usePurchaseUnit ? purchaseUnit.trim() : null,
      purchaseFactor: usePurchaseUnit ? (parseFloat(purchaseFactor) || 1) : 1,
      dreCategoryId: null,
    });
    onClose();
  };

  const exemploConversao = usePurchaseUnit && purchaseFactor
    ? `1 ${purchaseUnit} = ${purchaseFactor} ${unidade} no estoque`
    : null;

  // suppress unused warning for purchaseUnitOpen/purchaseUnitRef (kept for future use)
  void purchaseUnitOpen;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-bold text-zinc-900">{isEdit ? 'Editar Insumo' : 'Novo Insumo'}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Nome do Insumo</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 focus:outline-none focus:border-amber-400"
              placeholder="Ex: Carne Bovina, Refrigerante Lata"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1.5">Tipo de uso</label>
            <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setUsageType('final')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  usageType === 'final'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                Uso final no cardápio
              </button>
              <button
                type="button"
                onClick={() => setUsageType('production')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  usageType === 'production'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                Usado em produção
              </button>
            </div>
            <p className="text-[10px] text-zinc-400 mt-1">
              {usageType === 'final'
                ? 'Este insumo é usado diretamente na ficha técnica dos itens do cardápio.'
                : 'Este insumo é matéria-prima para fichas de produção (ex: carne crua, abacate).'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Unidade do Estoque</label>
              <div className="relative">
                <select
                  value={unidade}
                  onChange={(e) => setUnidade(e.target.value as UnidadeEstoque)}
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 pr-8 text-zinc-800 focus:outline-none focus:border-amber-400 appearance-none cursor-pointer bg-white"
                >
                  {unidades.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 text-sm" />
              </div>
              <p className="text-[10px] text-zinc-400 mt-1">Base interna do estoque</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Categoria</label>
              <div className="relative">
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 pr-8 text-zinc-800 focus:outline-none focus:border-amber-400 appearance-none cursor-pointer bg-white"
                >
                  <option value="">Sem categoria</option>
                  {categoriasDisponiveis.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 text-sm" />
              </div>
              <input
                type="text"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                placeholder="Ou digite uma categoria nova..."
                className="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 mt-1.5 text-zinc-800 focus:outline-none focus:border-amber-400 bg-white"
              />
            </div>
          </div>

          <div className="border border-zinc-100 rounded-xl p-3 bg-zinc-50 space-y-2">
            <p className="text-xs font-semibold text-zinc-700 flex items-center gap-1.5">
              <i className="ri-shopping-cart-line text-amber-500" />
              Unidade de Compra <span className="text-zinc-400 font-normal">(opcional)</span>
            </p>
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              Compra em embalagem diferente do estoque?
              Ex: compra por <strong>caixa/6 un</strong>, estoque em <strong>un</strong>.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {UNIDADES_COMPRA_SUGERIDAS.filter((u) => u !== unidade).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setPurchaseUnit(purchaseUnit === u ? '' : u)}
                  className={`px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-all cursor-pointer ${
                    purchaseUnit === u
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-white text-zinc-600 border-zinc-200 hover:border-amber-300 hover:text-amber-600'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-1">
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Unidade de compra</label>
                <input
                  value={purchaseUnit}
                  onChange={(e) => setPurchaseUnit(e.target.value)}
                  placeholder="Ou digite livremente..."
                  className="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 text-zinc-800 focus:outline-none focus:border-amber-400 bg-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">
                  Qtd de <strong>{unidade}</strong> por {purchaseUnit || 'unidade comprada'}
                </label>
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={purchaseFactor}
                  onChange={(e) => setPurchaseFactor(e.target.value)}
                  disabled={!usePurchaseUnit}
                  className="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 text-zinc-800 focus:outline-none focus:border-amber-400 bg-white disabled:opacity-40"
                  placeholder="Ex: 6"
                />
              </div>
            </div>
            {exemploConversao && (
              <div className="flex items-center gap-1.5 px-2.5 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                <i className="ri-exchange-line text-amber-500 text-xs" />
                <p className="text-[10px] text-amber-700 font-semibold">{exemploConversao}</p>
              </div>
            )}
          </div>

          {/* === Preço Unitário com fonte === */}
          <div className="border border-zinc-100 rounded-xl p-3 bg-zinc-50 space-y-2">
            <p className="text-xs font-semibold text-zinc-700 flex items-center gap-1.5">
              <i className="ri-coins-line text-amber-500" />
              Preço Unitário
            </p>
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              Escolha se o preço é definido manualmente ou calculado automaticamente com base nas compras.
            </p>

            {/* Toggle Manual / Automático */}
            <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setPriceSource('manual')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  priceSource === 'manual'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                <i className="ri-edit-line mr-1" /> Manual
              </button>
              <button
                type="button"
                onClick={() => setPriceSource('auto')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  priceSource === 'auto'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                <i className="ri-refresh-line mr-1" /> Automático
              </button>
            </div>

            {/* Campo de preço */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-500 mb-1">
                Valor ({unidade})
              </label>
              {priceSource === 'manual' ? (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">R$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={precoUnitario}
                    onChange={(e) => setPrecoUnitario(e.target.value)}
                    className="w-full text-sm border border-zinc-200 rounded-lg px-3 pl-8 py-2 text-zinc-800 focus:outline-none focus:border-amber-400 bg-white"
                    placeholder="0,00"
                  />
                </div>
              ) : (
                <div className="w-full flex items-center justify-between px-3 py-2 bg-zinc-100 border border-zinc-200 rounded-lg text-sm text-zinc-600">
                  <span className="font-semibold text-zinc-800">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(autoPrice)}
                  </span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${autoSourceBg} ${autoSourceColor}`}>
                    <i className={autoSourceIcon} /> {autoSourceLabel}
                  </span>
                </div>
              )}
              <p className="text-[10px] text-zinc-400 mt-1">
                {priceSource === 'manual'
                  ? 'Você define o preço. Ele não muda até ser editado novamente.'
                  : 'O preço é atualizado automaticamente a cada compra registrada no sistema.'}
              </p>
            </div>
          </div>
          {/* === /Preço Unitário === */}

          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Estoque Mínimo ({unidade})</label>
            <input
              type="number"
              step="0.1"
              value={estoqueMinimo}
              onChange={(e) => setEstoqueMinimo(e.target.value)}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 focus:outline-none focus:border-amber-400"
              placeholder="0"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 transition-colors cursor-pointer whitespace-nowrap">Cancelar</button>
          <button
            onClick={handleSalvar}
            disabled={!podeSubmeter}
            className="flex-1 py-2 text-sm font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap"
          >
            {isEdit ? 'Salvar' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  );
}