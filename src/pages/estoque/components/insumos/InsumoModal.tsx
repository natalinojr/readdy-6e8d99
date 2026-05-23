// ... existing code ...
import { useState, useRef, useEffect } from 'react';
import { X, Building2 } from 'lucide-react';
import type { Insumo, UnidadeEstoque } from '@/contexts/EstoqueContext';
import { useSuppliers } from '@/hooks/useSuppliers';


const unidades: UnidadeEstoque[] = ['kg', 'g', 'l', 'ml', 'un'];
const UNIDADES_COMPRA_SUGERIDAS = ['kg', 'g', 'l', 'ml', 'un', 'caixa', 'fardo', 'pacote', 'saco', 'lata', 'garrafa', 'pct', 'dz'];

interface SupplierOption {
  id: string;
  name: string;
}

interface InsumoModalProps {
  insumo?: Insumo | null;
  categoriasDisponiveis: string[];
  fornecedoresDisponiveis: string[];
  fornecedoresComId: SupplierOption[];
  dreCategories?: never[];
  onClose: () => void;
  onSave: (data: Omit<Insumo, 'estoqueAtual' | 'ultimaEntrada' | 'fichaTecnica' | 'esgotado'> & { id?: string }) => void;
  onOpenFornecedores: () => void;
}

export default function InsumoModal({ insumo, categoriasDisponiveis, onClose, onSave, onOpenFornecedores }: InsumoModalProps) {
  // Busca fornecedores diretamente — garante dados frescos independente do estado do pai
  const { suppliers: loadedSuppliers } = useSuppliers();
  const fornecedoresComId: SupplierOption[] = loadedSuppliers.map((s) => ({ id: s.id, name: s.name }));
  const fornecedoresDisponiveis = loadedSuppliers.map((s) => s.name);
  const isEdit = !!insumo;
  const [nome, setNome] = useState(insumo?.nome ?? '');
  const [unidade, setUnidade] = useState<UnidadeEstoque>(insumo?.unidade ?? 'kg');
  const [categoria, setCategoria] = useState(insumo?.categoria ?? '');
  const [usageType, setUsageType] = useState<'final' | 'production'>(insumo?.usageType ?? 'final');
  const [estoqueMinimo, setEstoqueMinimo] = useState(insumo?.estoqueMinimo?.toString() ?? '');
  const [fornecedor, setFornecedor] = useState(insumo?.fornecedor ?? '');
  const [supplierId, setSupplierId] = useState<string | null>(insumo?.supplierId ?? null);
  const [purchaseUnit, setPurchaseUnit] = useState(insumo?.purchaseUnit ?? '');
  const [purchaseFactor, setPurchaseFactor] = useState(insumo?.purchaseFactor?.toString() ?? '1');
  const [purchaseUnitOpen, setPurchaseUnitOpen] = useState(false);
  const purchaseUnitRef = useRef<HTMLDivElement>(null);

  // Fornecedor dropdown state
  const [supOpen, setSupOpen] = useState(false);
  const [supSearch, setSupSearch] = useState(insumo?.fornecedor ?? '');
  const supRef = useRef<HTMLDivElement>(null);
  const supInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (purchaseUnitRef.current && !purchaseUnitRef.current.contains(e.target as Node)) {
        setPurchaseUnitOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fecha dropdown de fornecedor ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (supRef.current && !supRef.current.contains(e.target as Node)) {
        setSupOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const usePurchaseUnit = purchaseUnit.trim() !== '' && purchaseUnit.trim() !== unidade;
  const podeSubmeter = nome.trim().length > 0;

  const handleFornecedorSelect = (name: string) => {
    setFornecedor(name);
    setSupSearch(name);
    const found = fornecedoresComId.find((f) => f.name === name);
    setSupplierId(found?.id ?? null);
    setSupOpen(false);
  };

  const handleFornecedorInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSupSearch(val);
    setFornecedor(val);
    const found = fornecedoresComId.find((f) => f.name === val);
    setSupplierId(found?.id ?? null);
    setSupOpen(true);
  };

  const handleSalvar = () => {
    if (!podeSubmeter) return;
    onSave({
      id: insumo?.id,
      nome: nome.trim(),
      unidade,
      categoria: categoria || 'Sem categoria',
      usageType,
      precoUnitario: insumo?.precoUnitario ?? 0,
      estoqueMinimo: parseFloat(estoqueMinimo.replace(',', '.')) || 0,
      fornecedor: fornecedor.trim(),
      supplierId,
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

  const filteredSuppliers = fornecedoresComId.filter((s) =>
    s.name.toLowerCase().includes(supSearch.toLowerCase())
  );

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

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-zinc-600">Fornecedor</label>
              <button
                type="button"
                onClick={() => { onClose(); onOpenFornecedores(); }}
                className="flex items-center gap-1 text-[10px] text-amber-600 hover:text-amber-700 cursor-pointer font-semibold"
              >
                <Building2 size={10} />
                Gerenciar
              </button>
            </div>
            <div ref={supRef} className="relative">
              <div className="relative">
                <input
                  ref={supInputRef}
                  value={supSearch}
                  onChange={handleFornecedorInputChange}
                  onFocus={() => setSupOpen(true)}
                  placeholder="Selecionar ou digitar fornecedor..."
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 pr-8 text-zinc-800 focus:outline-none focus:border-amber-400 bg-white"
                />
                <button
                  type="button"
                  onClick={() => { setSupOpen((o) => !o); supInputRef.current?.focus(); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer"
                >
                  {supOpen ? <i className="ri-arrow-up-s-line text-sm" /> : <i className="ri-arrow-down-s-line text-sm" />}
                </button>
              </div>
              {supOpen && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                  {filteredSuppliers.length === 0 && fornecedoresDisponiveis.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-zinc-400 text-center">
                      Nenhum fornecedor cadastrado
                    </div>
                  ) : (
                    <>
                      {filteredSuppliers.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleFornecedorSelect(s.name)}
                          className={`w-full text-left px-3 py-2.5 text-sm hover:bg-amber-50 cursor-pointer transition-colors flex items-center gap-2 ${
                            fornecedor === s.name ? 'bg-amber-50 text-amber-700 font-semibold' : 'text-zinc-700'
                          }`}
                        >
                          <i className="ri-store-2-line text-zinc-400 text-xs flex-shrink-0" />
                          {s.name}
                        </button>
                      ))}
                      {supSearch && !fornecedoresComId.find((s) => s.name.toLowerCase() === supSearch.toLowerCase()) && (
                        <button
                          type="button"
                          onClick={() => handleFornecedorSelect(supSearch)}
                          className="w-full text-left px-3 py-2.5 text-xs text-amber-600 hover:bg-amber-50 cursor-pointer border-t border-zinc-100 flex items-center gap-2"
                        >
                          <i className="ri-add-line" /> Usar &quot;{supSearch}&quot; como novo fornecedor
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            {supplierId && (
              <p className="text-[10px] text-emerald-600 flex items-center gap-1 mt-1">
                <i className="ri-link text-[10px]" /> Vinculado ao cadastro de fornecedor
              </p>
            )}
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
