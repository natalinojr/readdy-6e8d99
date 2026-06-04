import { useState, useMemo, useEffect } from 'react';
import { ChefHat } from 'lucide-react';

interface CartItem {
  cartId: string;
  itemId: string;
  name: string;
  precoBase: number;
  precoTotal: number;
  quantidade: number;
  opcoes: { grupoNome: string; opcaoNome: string; precoAdicional: number }[];
  observacoes: string[];
  observacaoLivre: string;
  skipKds: boolean;
  stationId: string | null;
}

interface CardapioItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  photo_url: string | null;
  category_id: string | null;
  sla_minutes: number | null;
  skip_kds: boolean | null;
  station_id: string | null;
}

interface CardapioCategory {
  id: string;
  name: string;
  order_index: number | null;
  station_id: string | null;
}

interface OptionGroup {
  id: string;
  name: string;
  item_id: string;
  is_required: boolean;
  min_selection: number | null;
  max_selection: number | null;
}

interface OptionItem {
  id: string;
  name: string;
  option_group_id: string;
  additional_price: number;
  is_active: boolean;
}

interface PresetObservation {
  id: string;
  item_id: string;
  text: string;
}

interface Props {
  categoriaAtiva: string | null;
  categories: CardapioCategory[];
  items: CardapioItem[];
  optionGroups: OptionGroup[];
  options: OptionItem[];
  observations: PresetObservation[];
  onAdicionar: (item: CartItem) => void;
  onVerCarrinho: () => void;
  cart: CartItem[];
}

export default function CardapioMesaQR({
  categoriaAtiva,
  categories,
  items,
  optionGroups,
  options,
  observations,
  onAdicionar,
  cart,
}: Props) {
  const [itemSelecionado, setItemSelecionado] = useState<CardapioItem | null>(null);
  const [qtd, setQtd] = useState(1);
  const [opcoesSelecionadas, setOpcoesSelecionadas] = useState<Record<string, string[]>>();
  const [obsLivre, setObsLivre] = useState('');
  const [obsSelecionadas, setObsSelecionadas] = useState<string[]>([]);
  const [imgErros, setImgErros] = useState<Set<string>>(new Set());
  const [modalVisible, setModalVisible] = useState(false);

  const itensFiltrados = useMemo(() => {
    if (!categoriaAtiva) return items;
    return items.filter((i) => i.category_id === categoriaAtiva);
  }, [categoriaAtiva, items]);

  const gruposDoItem = (itemId: string) => optionGroups.filter((g) => g.item_id === itemId);
  const opcoesDoGrupo = (grupoId: string) => options.filter((o) => o.option_group_id === grupoId);
  const obsDoItem = (itemId: string) => observations.filter((o) => o.item_id === itemId);

  const calcularPreco = (item: CardapioItem) => {
    let extra = 0;
    const grupos = gruposDoItem(item.id);
    for (const g of grupos) {
      const sel = opcoesSelecionadas[g.id] || [];
      for (const opId of sel) {
        const op = options.find((o) => o.id === opId);
        if (op) extra += op.additional_price;
      }
    }
    return item.price + extra;
  };

  const abrirModal = (item: CardapioItem) => {
    setItemSelecionado(item);
    setQtd(1);
    setOpcoesSelecionadas({});
    setObsLivre('');
    setObsSelecionadas([]);
    setModalVisible(true);
  };

  const fecharModal = () => {
    setModalVisible(false);
    setTimeout(() => {
      setItemSelecionado(null);
      setOpcoesSelecionadas({});
      setObsSelecionadas([]);
      setObsLivre('');
      setQtd(1);
    }, 300);
  };

  const toggleOpcao = (grupoId: string, opId: string, maxSel: number | null) => {
    setOpcoesSelecionadas((prev) => {
      const atual = prev[grupoId] || [];
      if (atual.includes(opId)) {
        return { ...prev, [grupoId]: atual.filter((id) => id !== opId) };
      }
      const max = maxSel ?? 1;
      if (atual.length >= max) {
        return { ...prev, [grupoId]: [...atual.slice(1), opId] };
      }
      return { ...prev, [grupoId]: [...atual, opId] };
    });
  };

  const toggleObs = (text: string) => {
    setObsSelecionadas((prev) =>
      prev.includes(text) ? prev.filter((t) => t !== text) : [...prev, text]
    );
  };

  const handleAdicionar = () => {
    if (!itemSelecionado) return;
    const preco = calcularPreco(itemSelecionado);
    const opcoes: CartItem['opcoes'] = [];
    for (const g of gruposDoItem(itemSelecionado.id)) {
      const sel = opcoesSelecionadas[g.id] || [];
      for (const opId of sel) {
        const op = options.find((o) => o.id === opId);
        if (op) {
          opcoes.push({ grupoNome: g.name, opcaoNome: op.name, precoAdicional: op.additional_price });
        }
      }
    }
    onAdicionar({
      cartId: `cart-${itemSelecionado.id}-${Date.now()}`,
      itemId: itemSelecionado.id,
      name: itemSelecionado.name,
      precoBase: itemSelecionado.price,
      precoTotal: preco,
      quantidade: qtd,
      opcoes,
      observacoes: obsSelecionadas,
      observacaoLivre: obsLivre,
      skipKds: itemSelecionado.skip_kds ?? false,
      stationId: itemSelecionado.station_id,
    });
    fecharModal();
  };

  const handleImgError = (itemId: string) => {
    setImgErros((prev) => new Set(prev).add(itemId));
  };

  // Bloqueia scroll do body quando modal está aberto
  useEffect(() => {
    if (modalVisible) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [modalVisible]);

  const hasOptions = itemSelecionado ? gruposDoItem(itemSelecionado.id).length > 0 : false;
  const hasObservations = itemSelecionado ? obsDoItem(itemSelecionado.id).length > 0 : false;

  return (
    <div className="px-4 py-4">
      {/* Grid de itens */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {itensFiltrados.map((item) => {
          const noCarrinho = cart
            .filter((c) => c.itemId === item.id)
            .reduce((s, c) => s + c.quantidade, 0);
          return (
            <button
              key={item.id}
              onClick={() => abrirModal(item)}
              className="text-left bg-white rounded-2xl border border-zinc-100 p-3 flex gap-3 hover:border-zinc-200 transition-all duration-200 cursor-pointer group"
            >
              <div className="shrink-0 w-[72px] h-[72px] rounded-xl overflow-hidden bg-zinc-100 flex items-center justify-center">
                {item.photo_url && !imgErros.has(item.id) ? (
                  <img
                    src={item.photo_url}
                    alt={item.name}
                    className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
                    onError={() => handleImgError(item.id)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-100">
                    <ChefHat size={24} className="text-zinc-300" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-zinc-800 truncate">{item.name}</h3>
                  {item.description && (
                    <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2 leading-relaxed">
                      {item.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-sm font-bold text-amber-600">
                    R$ {item.price.toFixed(2)}
                  </span>
                </div>
                {noCarrinho > 0 && (
                  <div className="mt-1.5">
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                      {noCarrinho} no pedido
                    </span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {itensFiltrados.length === 0 && (
        <div className="text-center py-16 flex flex-col items-center">
          <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
            <i className="ri-inbox-line text-2xl text-zinc-300" />
          </div>
          <p className="text-sm font-bold text-zinc-700">Nenhum item nesta categoria</p>
          <p className="text-xs text-zinc-500 mt-1">Selecione outra categoria para continuar</p>
        </div>
      )}

      {/* Modal de montagem do item */}
      {itemSelecionado && (
        <div
          className={`fixed inset-0 z-50 flex items-end justify-center transition-opacity duration-300 ${
            modalVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={fecharModal}
          />

          {/* Painel */}
          <div
            className={`relative w-full max-w-lg bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto transition-transform duration-300 ${
              modalVisible ? 'translate-y-0' : 'translate-y-full'
            }`}
            style={{ scrollbarWidth: 'thin' }}
          >
            {/* Header sticky */}
            <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-zinc-100 px-5 py-3 flex items-center justify-between z-10">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-zinc-800 truncate">{itemSelecionado.name}</h3>
                <p className="text-xs text-zinc-500 mt-0.5">R$ {itemSelecionado.price.toFixed(2)}</p>
              </div>
              <button
                onClick={fecharModal}
                className="w-9 h-9 flex items-center justify-center bg-zinc-100 rounded-full text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200 transition-colors cursor-pointer shrink-0 ml-3"
              >
                <i className="ri-close-line text-lg" />
              </button>
            </div>

            {/* Imagem do item no modal */}
            {itemSelecionado.photo_url && !imgErros.has(itemSelecionado.id) && (
              <div className="px-5 pt-4">
                <div className="w-full h-40 rounded-xl overflow-hidden bg-zinc-100">
                  <img
                    src={itemSelecionado.photo_url}
                    alt={itemSelecionado.name}
                    className="w-full h-full object-cover object-top"
                    onError={() => handleImgError(itemSelecionado.id)}
                  />
                </div>
              </div>
            )}

            <div className="px-5 py-4 space-y-5">
              {/* Descrição */}
              {itemSelecionado.description && (
                <p className="text-sm text-zinc-600 leading-relaxed">{itemSelecionado.description}</p>
              )}

              {/* Quantidade */}
              <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3">
                <span className="text-sm font-bold text-zinc-800">Quantidade</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setQtd((p) => Math.max(1, p - 1))}
                    className="w-9 h-9 flex items-center justify-center bg-white rounded-full text-zinc-600 cursor-pointer hover:bg-zinc-200 transition-colors border border-zinc-100"
                  >
                    <i className="ri-subtract-line" />
                  </button>
                  <span className="text-sm font-bold text-zinc-800 w-5 text-center">{qtd}</span>
                  <button
                    onClick={() => setQtd((p) => p + 1)}
                    className="w-9 h-9 flex items-center justify-center bg-zinc-900 rounded-full text-white cursor-pointer hover:bg-zinc-800 transition-colors"
                  >
                    <i className="ri-add-line" />
                  </button>
                </div>
              </div>

              {/* Grupos de opções */}
              {hasOptions && (
                <div className="space-y-4">
                  {gruposDoItem(itemSelecionado.id).map((grupo) => (
                    <div key={grupo.id}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-sm font-bold text-zinc-800">{grupo.name}</span>
                        {grupo.is_required && (
                          <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md border border-red-100">
                            Obrigatório
                          </span>
                        )}
                        {grupo.max_selection && grupo.max_selection > 1 && (
                          <span className="text-[10px] text-zinc-400">Máx {grupo.max_selection}</span>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {opcoesDoGrupo(grupo.id).map((op) => {
                          const sel = opcoesSelecionadas[grupo.id] || [];
                          const checked = sel.includes(op.id);
                          return (
                            <label
                              key={op.id}
                              className={`flex items-center gap-3 px-3.5 py-3 rounded-xl cursor-pointer transition-colors border ${
                                checked
                                  ? 'bg-amber-50 border-amber-200'
                                  : 'bg-zinc-50 border-transparent hover:bg-zinc-100'
                              }`}
                            >
                              <div className="relative flex items-center justify-center">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleOpcao(grupo.id, op.id, grupo.max_selection)}
                                  className="w-5 h-5 accent-amber-500 cursor-pointer rounded"
                                />
                              </div>
                              <span className="flex-1 text-sm text-zinc-700">{op.name}</span>
                              {op.additional_price > 0 && (
                                <span className="text-xs font-bold text-amber-600">
                                  + R$ {op.additional_price.toFixed(2)}
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Observações pré-cadastradas */}
              {hasObservations && (
                <div>
                  <span className="text-sm font-bold text-zinc-800 block mb-3">Observações</span>
                  <div className="flex flex-wrap gap-2">
                    {obsDoItem(itemSelecionado.id).map((obs) => {
                      const checked = obsSelecionadas.includes(obs.text);
                      return (
                        <button
                          key={obs.id}
                          onClick={() => toggleObs(obs.text)}
                          className={`px-3.5 py-2 rounded-full text-xs font-bold cursor-pointer transition-colors border ${
                            checked
                              ? 'bg-zinc-900 text-white border-zinc-900'
                              : 'bg-zinc-100 text-zinc-600 border-zinc-100 hover:bg-zinc-200'
                          }`}
                        >
                          {obs.text}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Observação livre */}
              <div>
                <span className="text-sm font-bold text-zinc-800 block mb-2">Outra observação</span>
                <textarea
                  value={obsLivre}
                  onChange={(e) => setObsLivre(e.target.value)}
                  placeholder="Ex: sem cebola, bem passado..."
                  className="w-full px-3.5 py-3 border border-zinc-100 rounded-xl text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 resize-none bg-zinc-50"
                  rows={2}
                  maxLength={200}
                />
                <p className="text-[10px] text-zinc-400 text-right mt-1">{obsLivre.length}/200</p>
              </div>
            </div>

            {/* Footer sticky */}
            <div className="sticky bottom-0 bg-white/95 backdrop-blur-sm border-t border-zinc-100 px-5 py-3">
              <button
                onClick={handleAdicionar}
                className="w-full flex items-center justify-between bg-zinc-900 hover:bg-zinc-800 text-white px-5 py-3.5 rounded-xl cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2">
                  <i className="ri-add-line text-sm" />
                  <span className="text-sm font-bold">Adicionar ao pedido</span>
                </div>
                <span className="text-sm font-bold">
                  R$ {(calcularPreco(itemSelecionado) * qtd).toFixed(2)}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}