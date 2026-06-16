import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { scrollFocusedFieldIntoView } from '@/lib/scrollFocusIntoView';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { rawPromoAtivaHoje } from '@/lib/promoUtils';

interface CartItem {
  cartId: string;
  itemId: string;
  name: string;
  precoBase: number;
  precoTotal: number;
  quantidade: number;
  opcoes: { grupoNome: string; opcaoNome: string; precoAdicional: number; opcaoId?: string }[];
  observacoes: string[];
  observacaoLivre: string;
  skipKds: boolean;
  stationId: string | null;
  subproducao?: Array<{ nome: string; estacaoId: string }>;
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
  promotions?: Array<{ id: string; item_id: string; promotional_price: number; is_active: boolean; days_of_week: number[] | null; is_recurring: boolean; specific_date: string | null }>;
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
  min_selections: number | null;
  max_selections: number | null;
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

interface UnidadeConfig {
  opcoesSelecionadas: Record<string, string[]>;
  obsSelecionadas: string[];
  obsLivre: string;
}

interface Props {
  categoriaAtiva: string | null;
  categories: CardapioCategory[];
  items: CardapioItem[];
  optionGroups: OptionGroup[];
  options: OptionItem[];
  observations: PresetObservation[];
  outOfStockIds: string[];
  opcoesIndisponiveisIds: string[];
  onAdicionar: (item: CartItem) => void;
  onVerCarrinho: () => void;
  cart: CartItem[];
  onCategoriaAtivaChange?: (id: string) => void;
}

export default function CardapioMesaQR(props: Props) {
  const categoriaAtiva = props.categoriaAtiva;
  const categories = props.categories;
  const items = props.items;
  const optionGroups = props.optionGroups;
  const options = props.options;
  const observations = props.observations;
  const outOfStockIds = props.outOfStockIds;
  const opcoesIndisponiveisIds = props.opcoesIndisponiveisIds;
  const onAdicionar = props.onAdicionar;
  const cart = props.cart;
  const onCategoriaAtivaChange = props.onCategoriaAtivaChange;

  const [busca, setBusca] = useState('');
  const [itemSelecionado, setItemSelecionado] = useState<CardapioItem | null>(null);
  const [qtd, setQtd] = useState(1);
  const [unidadeAtiva, setUnidadeAtiva] = useState(0);
  const [unidades, setUnidades] = useState<UnidadeConfig[]>([{ opcoesSelecionadas: {}, obsSelecionadas: [], obsLivre: '' }]);
  const [imgErros, setImgErros] = useState<Set<string>>(new Set());
  const [modalVisible, setModalVisible] = useState(false);
  const kbInset = useKeyboardInset();

  // ── Mapa de quantidades no carrinho por itemId ──────────────────────────────

  const cartQtyMap = useMemo(function () {
    const map: Record<string, number> = {};
    cart.forEach(function (ci) {
      map[ci.itemId] = (map[ci.itemId] || 0) + ci.quantidade;
    });
    return map;
  }, [cart]);

  // Categorias ordenadas
  const categoriasOrdenadas = useMemo(function () {
    return categories.slice().sort(function (a, b) { return (a.order_index ?? 999) - (b.order_index ?? 999); });
  }, [categories]);

  // Todos os itens disponíveis (sem filtro de categoria)
  const todosItensDisponiveis = useMemo(function () {
    const outOfStockSet = new Set(outOfStockIds);
    return items.filter(function (i) { return !outOfStockSet.has(i.id); });
  }, [items, outOfStockIds]);

  // ── Busca ────────────────────────────────────────────────────────────────────
  // Resultados ignoram as categorias virtuais (Destaques/Promoção, id "__...")
  // para não duplicar o mesmo item.
  const buscaNorm = busca.trim().toLowerCase();
  const resultadosBusca = useMemo(function () {
    if (!buscaNorm) return [];
    return todosItensDisponiveis.filter(function (i) {
      if ((i.category_id || '').startsWith('__')) return false;
      const nome = i.name.toLowerCase();
      const desc = (i.description || '').toLowerCase();
      return nome.includes(buscaNorm) || desc.includes(buscaNorm);
    });
  }, [buscaNorm, todosItensDisponiveis]);

  // ── Scroll Spy ───────────────────────────────────────────────────────────────

  const scrollSpyEnabledRef = useRef(true);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const handleScrollSpy = useCallback(function (catId: string) {
    if (!scrollSpyEnabledRef.current) return;
    if (onCategoriaAtivaChange) {
      onCategoriaAtivaChange(catId);
    }
  }, [onCategoriaAtivaChange]);

  useEffect(function () {
    if (typeof IntersectionObserver === 'undefined') return;

    // Limpa observer anterior
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      function (entries) {
        const intersecting = entries.filter(function (e) { return e.isIntersecting; });
        if (intersecting.length === 0) return;

        // Pega a seção cujo topo está mais próximo do topo do viewport
        intersecting.sort(function (a, b) {
          return Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top);
        });
        const catId = intersecting[0].target.id.replace('scroll-cat-', '');
        handleScrollSpy(catId);
      },
      {
        // Considera a seção visível quando seu topo cruza a linha ~80px do topo
        // e ainda está nos primeiros 40% da tela
        rootMargin: '-80px 0px -60% 0px',
        threshold: 0,
      }
    );

    // Observa cada seção de categoria
    categoriasOrdenadas.forEach(function (cat) {
      const el = document.getElementById('scroll-cat-' + cat.id);
      if (el && observerRef.current) {
        observerRef.current.observe(el);
      }
    });

    // Retry para elementos que podem não estar no DOM ainda
    const retryTimer = setTimeout(function () {
      categoriasOrdenadas.forEach(function (cat) {
        const el = document.getElementById('scroll-cat-' + cat.id);
        if (el && observerRef.current) {
          try { observerRef.current.observe(el); } catch (_e) { /* já observado */ }
        }
      });
    }, 200);

    return function () {
      clearTimeout(retryTimer);
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [categoriasOrdenadas, handleScrollSpy]);

  function gruposDoItem(itemId: string) {
    return optionGroups.filter(function (g) { return g.item_id === itemId; });
  }
  function opcoesDoGrupo(grupoId: string) {
    return options.filter(function (o) { return o.option_group_id === grupoId; });
  }
  function obsDoItem(itemId: string) {
    return observations.filter(function (o) { return o.item_id === itemId; });
  }

  function getPrecoEfetivo(item: CardapioItem) {
    const promoAtiva = rawPromoAtivaHoje(item.promotions);
    return promoAtiva ? promoAtiva.promotional_price : item.price;
  }

  function calcularPreco(item: CardapioItem, cfg: UnidadeConfig) {
    let extra = 0;
    const grupos = gruposDoItem(item.id);
    for (let gi = 0; gi < grupos.length; gi++) {
      const g = grupos[gi];
      const sel = cfg.opcoesSelecionadas[g.id] || [];
      for (let si = 0; si < sel.length; si++) {
        const opId = sel[si];
        const op = options.find(function (o) { return o.id === opId; });
        if (op) extra += op.additional_price;
      }
    }
    return getPrecoEfetivo(item) + extra;
  }

  function calcularPrecoTotal() {
    if (!itemSelecionado) return 0;
    let total = 0;
    for (let i = 0; i < unidades.length; i++) {
      total += calcularPreco(itemSelecionado, unidades[i]);
    }
    return total;
  }

  function abrirModal(item: CardapioItem) {
    const groups = gruposDoItem(item.id);
    const hasObs = obsDoItem(item.id).length > 0;

    // Se não tem opções nem observações pré-configuradas, adiciona direto
    if (groups.length === 0 && !hasObs) {
      const now = Date.now();
      const precoEfetivo = getPrecoEfetivo(item);
      onAdicionar({
        cartId: 'cart-' + item.id + '-' + now + '-0',
        itemId: item.id,
        name: item.name,
        precoBase: precoEfetivo,
        precoTotal: precoEfetivo,
        quantidade: 1,
        opcoes: [],
        observacoes: [],
        observacaoLivre: '',
        skipKds: item.skip_kds !== null ? item.skip_kds : false,
        stationId: item.station_id,
      });
      return;
    }

    setItemSelecionado(item);
    setQtd(1);
    setUnidadeAtiva(0);
    setUnidades([{ opcoesSelecionadas: {}, obsSelecionadas: [], obsLivre: '' }]);
    setModalVisible(true);
  }

  function fecharModal() {
    setModalVisible(false);
    setTimeout(function () {
      setItemSelecionado(null);
      setUnidades([{ opcoesSelecionadas: {}, obsSelecionadas: [], obsLivre: '' }]);
      setUnidadeAtiva(0);
      setQtd(1);
    }, 300);
  }

  function ajustarQtd(novaQtd: number) {
    const q = Math.max(1, novaQtd);
    setQtd(q);
    setUnidades(function (prev) {
      const arr = prev.slice();
      if (arr.length < q) {
        while (arr.length < q) {
          arr.push({ opcoesSelecionadas: {}, obsSelecionadas: [], obsLivre: '' });
        }
      } else if (arr.length > q) {
        arr.splice(q);
      }
      return arr;
    });
    if (unidadeAtiva >= q) {
      setUnidadeAtiva(0);
    }
  }

  function toggleOpcao(unidadeIdx: number, grupoId: string, opId: string, maxSel: number | null) {
    setUnidades(function (prev) {
      const arr = prev.slice();
      const cfg = arr[unidadeIdx];
      const atual = cfg.opcoesSelecionadas[grupoId] || [];
      if (atual.includes(opId)) {
        const novoCfg = Object.assign({}, cfg, {
          opcoesSelecionadas: Object.assign({}, cfg.opcoesSelecionadas, {
            [grupoId]: atual.filter(function (id) { return id !== opId; }),
          }),
        });
        arr[unidadeIdx] = novoCfg;
        return arr;
      }
      const max = maxSel !== null ? maxSel : 1;
      if (atual.length >= max) {
        const novoCfg = Object.assign({}, cfg, {
          opcoesSelecionadas: Object.assign({}, cfg.opcoesSelecionadas, {
            [grupoId]: atual.slice(1).concat([opId]),
          }),
        });
        arr[unidadeIdx] = novoCfg;
        return arr;
      }
      const novoCfg = Object.assign({}, cfg, {
        opcoesSelecionadas: Object.assign({}, cfg.opcoesSelecionadas, {
          [grupoId]: atual.concat([opId]),
        }),
      });
      arr[unidadeIdx] = novoCfg;
      return arr;
    });
  }

  function toggleObs(unidadeIdx: number, text: string) {
    setUnidades(function (prev) {
      const arr = prev.slice();
      const cfg = arr[unidadeIdx];
      if (cfg.obsSelecionadas.includes(text)) {
        arr[unidadeIdx] = Object.assign({}, cfg, {
          obsSelecionadas: cfg.obsSelecionadas.filter(function (t) { return t !== text; }),
        });
      } else {
        arr[unidadeIdx] = Object.assign({}, cfg, {
          obsSelecionadas: cfg.obsSelecionadas.concat([text]),
        });
      }
      return arr;
    });
  }

  function setObsLivre(unidadeIdx: number, val: string) {
    setUnidades(function (prev) {
      const arr = prev.slice();
      arr[unidadeIdx] = Object.assign({}, arr[unidadeIdx], { obsLivre: val });
      return arr;
    });
  }

  function handleAdicionar() {
    if (!itemSelecionado) return;
    const now = Date.now();
    const precoEfetivo = getPrecoEfetivo(itemSelecionado);
    for (let i = 0; i < unidades.length; i++) {
      const cfg = unidades[i];
      const preco = calcularPreco(itemSelecionado, cfg);
      const opcoesArr: CartItem['opcoes'] = [];
      const grupos = gruposDoItem(itemSelecionado.id);
      for (let gi = 0; gi < grupos.length; gi++) {
        const g = grupos[gi];
        const sel = cfg.opcoesSelecionadas[g.id] || [];
        for (let si = 0; si < sel.length; si++) {
          const opId = sel[si];
          const op = options.find(function (o) { return o.id === opId; });
          if (op) {
            opcoesArr.push({ opcaoId: op.id, grupoNome: g.name, opcaoNome: op.name, precoAdicional: op.additional_price, obrigatorio: g.is_required });
          }
        }
      }
      const obsLivre = cfg.obsLivre.trim();
      const obsTotais = cfg.obsSelecionadas.slice();
      if (obsLivre) obsTotais.push(obsLivre);
      onAdicionar({
        cartId: 'cart-' + itemSelecionado.id + '-' + now + '-' + i,
        itemId: itemSelecionado.id,
        name: itemSelecionado.name + (qtd > 1 ? ' (Un. ' + (i + 1) + ')' : ''),
        precoBase: precoEfetivo,
        precoTotal: preco,
        quantidade: 1,
        opcoes: opcoesArr,
        observacoes: cfg.obsSelecionadas,
        observacaoLivre: obsLivre,
        skipKds: itemSelecionado.skip_kds !== null ? itemSelecionado.skip_kds : false,
        stationId: itemSelecionado.station_id,
      });
    }
    fecharModal();
  }

  function handleImgError(itemId: string) {
    setImgErros(function (prev) {
      const novo = new Set(prev);
      novo.add(itemId);
      return novo;
    });
  }

  useEffect(function () {
    if (modalVisible) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return function () {
      document.body.style.overflow = '';
    };
  }, [modalVisible]);

  function renderItemCard(item: CardapioItem) {
    const qtyInCart = cartQtyMap[item.id] || 0;
    const promoAtiva = rawPromoAtivaHoje(item.promotions);
    const precoFinal = promoAtiva ? promoAtiva.promotional_price : item.price;

    return (
      <button
        key={item.id}
        type="button"
        onClick={function () { abrirModal(item); }}
        className="text-left bg-white rounded-2xl border border-zinc-100 p-3 flex gap-3 hover:border-zinc-200 transition-all duration-200 cursor-pointer group relative"
      >
        {/* Badge de quantidade no carrinho */}
        {qtyInCart > 0 ? (
          <div className="absolute top-2 right-2 z-10 w-5 h-5 flex items-center justify-center bg-amber-500 text-white text-[10px] font-black rounded-full">
            {qtyInCart}
          </div>
        ) : promoAtiva ? (
          <div className="absolute top-2 right-2 z-10 bg-red-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full tracking-wide">
            PROMO
          </div>
        ) : null}

        <div className="shrink-0 w-[72px] h-[72px] rounded-xl overflow-hidden bg-zinc-100 flex items-center justify-center">
          {(item.photo_url && !imgErros.has(item.id)) ? (
            <img
              src={item.photo_url}
              alt={item.name}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
              onError={function () { handleImgError(item.id); }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-100">
              <i className="ri-restaurant-2-line text-zinc-300 text-xl" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-zinc-800 truncate">{item.name}</h3>
            {item.description ? (
              <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2 leading-relaxed">
                {item.description}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <div className="flex items-baseline gap-1.5">
              {promoAtiva ? (
                <>
                  <span className="text-[11px] text-zinc-300 line-through">R$ {item.price.toFixed(2)}</span>
                  <span className="text-sm font-bold text-red-500">R$ {precoFinal.toFixed(2)}</span>
                </>
              ) : (
                <span className="text-sm font-bold text-amber-600">R$ {item.price.toFixed(2)}</span>
              )}
            </div>
          </div>
        </div>
      </button>
    );
  }

  const cfgAtual = itemSelecionado ? unidades[unidadeAtiva] : null;
  const hasOptions = itemSelecionado ? gruposDoItem(itemSelecionado.id).length > 0 : false;
  const hasObservations = itemSelecionado ? obsDoItem(itemSelecionado.id).length > 0 : false;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 py-4">
      {/* Busca */}
      <div className="relative mb-5">
        <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm pointer-events-none" />
        <input
          type="text"
          value={busca}
          onChange={function (e) { setBusca(e.target.value); }}
          placeholder="Buscar no cardápio..."
          className="w-full pl-10 pr-9 py-2.5 text-sm border border-zinc-200 rounded-xl bg-white text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400"
        />
        {busca ? (
          <button
            type="button"
            onClick={function () { setBusca(''); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 cursor-pointer"
          >
            <i className="ri-close-line text-sm" />
          </button>
        ) : null}
      </div>

      {/* Resultados da busca (lista plana) */}
      {buscaNorm ? (
        resultadosBusca.length > 0 ? (
          <div>
            <p className="text-xs font-bold text-zinc-500 mb-3">
              {resultadosBusca.length} resultado{resultadosBusca.length > 1 ? 's' : ''} para “{busca.trim()}”
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {resultadosBusca.map(function (item) { return renderItemCard(item); })}
            </div>
          </div>
        ) : (
          <div className="text-center py-16 flex flex-col items-center">
            <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
              <i className="ri-search-line text-2xl text-zinc-300" />
            </div>
            <p className="text-sm font-bold text-zinc-700">Nada encontrado</p>
            <p className="text-xs text-zinc-500 mt-1">Tente outro termo</p>
          </div>
        )
      ) : (
      /* Rolagem contínua - todas as categorias em sequência */
      <div className="space-y-8">
        {categoriasOrdenadas.map(function (cat) {
          const catItems = todosItensDisponiveis.filter(function (i) { return i.category_id === cat.id; });
          if (catItems.length === 0) return null;
          return (
            <section key={cat.id} id={'scroll-cat-' + cat.id} className="scroll-mt-14">
              {/* Cabeçalho da categoria */}
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-base font-black text-zinc-800">{cat.name}</h3>
                <div className="h-px flex-1 bg-zinc-100" />
                <span className="text-[10px] font-bold text-zinc-400">{catItems.length} ite{catItems.length > 1 ? 'ns' : 'm'}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {catItems.map(function (item) { return renderItemCard(item); })}
              </div>
            </section>
          );
        })}
      </div>
      )}

      {!buscaNorm && todosItensDisponiveis.length === 0 ? (
        <div className="text-center py-16 flex flex-col items-center">
          <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
            <i className="ri-inbox-line text-2xl text-zinc-300" />
          </div>
          <p className="text-sm font-bold text-zinc-700">Nenhum item disponível</p>
          <p className="text-xs text-zinc-500 mt-1">Tente novamente mais tarde</p>
        </div>
      ) : null}

      {/* Modal de montagem do item */}
      {itemSelecionado && cfgAtual ? (
        <div
          className={'fixed inset-0 z-50 flex items-end justify-center transition-opacity duration-300 ' +
            (modalVisible ? 'opacity-100' : 'opacity-0 pointer-events-none')}
          style={{ paddingBottom: kbInset }}
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={fecharModal}
          />

          <div
            className={'relative w-full max-w-lg bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto transition-transform duration-300 ' +
              (modalVisible ? 'translate-y-0' : 'translate-y-full')}
            style={{ scrollbarWidth: 'thin' }}
            onFocus={scrollFocusedFieldIntoView}
          >
            <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-zinc-100 px-5 py-3 flex items-center justify-between z-10">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-zinc-800 truncate">{itemSelecionado.name}</h3>
                {getPrecoEfetivo(itemSelecionado) < itemSelecionado.price ? (
                  <p className="text-xs text-zinc-500 mt-0.5">
                    <span className="line-through text-zinc-300">R$ {itemSelecionado.price.toFixed(2)}</span>
                    {' '}
                    <span className="text-red-500 font-bold">R$ {getPrecoEfetivo(itemSelecionado).toFixed(2)}</span>
                  </p>
                ) : (
                  <p className="text-xs text-zinc-500 mt-0.5">R$ {itemSelecionado.price.toFixed(2)}</p>
                )}
              </div>
              <button
                type="button"
                onClick={fecharModal}
                className="w-9 h-9 flex items-center justify-center bg-zinc-100 rounded-full text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200 transition-colors cursor-pointer shrink-0 ml-3"
              >
                <i className="ri-close-line text-lg" />
              </button>
            </div>

            {(itemSelecionado.photo_url && !imgErros.has(itemSelecionado.id)) ? (
              <div className="px-5 pt-4">
                <div className="w-full h-40 rounded-xl overflow-hidden bg-zinc-100">
                  <img
                    src={itemSelecionado.photo_url}
                    alt={itemSelecionado.name}
                    className="w-full h-full object-cover object-top"
                    onError={function () { handleImgError(itemSelecionado.id); }}
                  />
                </div>
              </div>
            ) : null}

            <div className="px-5 py-4 space-y-5">
              {itemSelecionado.description ? (
                <p className="text-sm text-zinc-600 leading-relaxed">{itemSelecionado.description}</p>
              ) : null}

              {/* Quantidade */}
              <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3">
                <span className="text-sm font-bold text-zinc-800">Quantidade</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={function () { ajustarQtd(qtd - 1); }}
                    className="w-9 h-9 flex items-center justify-center bg-white rounded-full text-zinc-600 cursor-pointer hover:bg-zinc-200 transition-colors border border-zinc-100"
                  >
                    <i className="ri-subtract-line" />
                  </button>
                  <span className="text-sm font-bold text-zinc-800 w-5 text-center">{qtd}</span>
                  <button
                    type="button"
                    onClick={function () { ajustarQtd(qtd + 1); }}
                    className="w-9 h-9 flex items-center justify-center bg-zinc-900 rounded-full text-white cursor-pointer hover:bg-zinc-800 transition-colors"
                  >
                    <i className="ri-add-line" />
                  </button>
                </div>
              </div>

              {/* Seletor de unidade (quando qtd > 1) */}
              {qtd > 1 ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-zinc-800">Personalizar por unidade</span>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                    {unidades.map(function (_, idx) {
                      const hasCustom = Object.keys(unidades[idx].opcoesSelecionadas).length > 0 ||
                        unidades[idx].obsSelecionadas.length > 0 ||
                        unidades[idx].obsLivre.trim().length > 0;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={function () { setUnidadeAtiva(idx); }}
                          className={'shrink-0 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer whitespace-nowrap transition-colors border ' +
                            (unidadeAtiva === idx
                              ? 'bg-amber-500 text-white border-amber-500'
                              : 'bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200')
                          }
                        >
                          Un. {idx + 1}
                          {hasCustom ? (
                            <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-300 align-middle" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {unidadeAtiva >= 0 ? (
                    <p className="text-[10px] text-amber-600 mt-1.5 font-medium">
                      Editando unidade {unidadeAtiva + 1} de {qtd}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* Opções */}
              {hasOptions ? (
                <div className="space-y-4">
                  {gruposDoItem(itemSelecionado.id).map(function (grupo) {
                    return (
                      <div key={grupo.id}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-sm font-bold text-zinc-800">{grupo.name}</span>
                          {grupo.is_required ? (
                            <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md border border-red-100">
                              Obrigatório
                            </span>
                          ) : null}
                          {(grupo.max_selections && grupo.max_selections > 1) ? (
                            <span className="text-[10px] text-zinc-400">Máx {grupo.max_selections}</span>
                          ) : null}
                        </div>
                        <div className="space-y-1.5">
                          {opcoesDoGrupo(grupo.id).map(function (op) {
                            const sel = cfgAtual.opcoesSelecionadas[grupo.id] || [];
                            const checked = sel.includes(op.id);
                            const esgotada = opcoesIndisponiveisIds.includes(op.id);
                            return (
                              <label
                                key={op.id}
                                className={'flex items-center gap-3 px-3.5 py-3 rounded-xl transition-colors border ' +
                                  (esgotada
                                    ? 'opacity-50 cursor-not-allowed bg-zinc-50 border-zinc-100'
                                    : checked
                                      ? 'bg-amber-50 border-amber-200 cursor-pointer'
                                      : 'bg-zinc-50 border-transparent hover:bg-zinc-100 cursor-pointer')
                                }
                              >
                                <div className="relative flex items-center justify-center">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={esgotada}
                                    onChange={esgotada ? undefined : function () { toggleOpcao(unidadeAtiva, grupo.id, op.id, grupo.max_selections); }}
                                    className="w-5 h-5 accent-amber-500 rounded disabled:cursor-not-allowed"
                                  />
                                </div>
                                <span className={'flex-1 text-sm ' + (esgotada ? 'text-zinc-400 line-through' : 'text-zinc-700')}>{op.name}</span>
                                {esgotada ? (
                                  <span className="text-[10px] font-bold text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                    Esgotado
                                  </span>
                                ) : op.additional_price > 0 ? (
                                  <span className="text-xs font-bold text-amber-600">
                                    + R$ {op.additional_price.toFixed(2)}
                                  </span>
                                ) : null}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {/* Observações predefinidas */}
              {hasObservations ? (
                <div>
                  <span className="text-sm font-bold text-zinc-800 block mb-3">Observações</span>
                  <div className="flex flex-wrap gap-2">
                    {obsDoItem(itemSelecionado.id).map(function (obs) {
                      const checked = cfgAtual.obsSelecionadas.includes(obs.text);
                      return (
                        <button
                          key={obs.id}
                          type="button"
                          onClick={function () { toggleObs(unidadeAtiva, obs.text); }}
                          className={'px-3.5 py-2 rounded-full text-xs font-bold cursor-pointer transition-colors border ' +
                            (checked
                              ? 'bg-zinc-900 text-white border-zinc-900'
                              : 'bg-zinc-100 text-zinc-600 border-zinc-100 hover:bg-zinc-200')
                          }
                        >
                          {obs.text}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Observação livre */}
              <div>
                <span className="text-sm font-bold text-zinc-800 block mb-2">
                  {qtd > 1 ? 'Outra observação (Un. ' + (unidadeAtiva + 1) + ')' : 'Outra observação'}
                </span>
                <textarea
                  value={cfgAtual.obsLivre}
                  onChange={function (e) { setObsLivre(unidadeAtiva, e.target.value.slice(0, 150)); }}
                  placeholder="Ex: sem cebola, bem passado..."
                  className="w-full px-3.5 py-3 border border-zinc-100 rounded-xl text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 resize-none bg-zinc-50"
                  rows={2}
                  maxLength={150}
                />
                <p className="text-[10px] text-zinc-400 text-right mt-1">{cfgAtual.obsLivre.length}/150</p>
              </div>
            </div>

            {/* Sticky footer */}
            <div className="sticky bottom-0 bg-white/95 backdrop-blur-sm border-t border-zinc-100 px-5 py-3">
              <button
                type="button"
                onClick={handleAdicionar}
                className="w-full flex items-center justify-between bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white px-5 py-3.5 rounded-xl cursor-pointer transition-all"
              >
                <div className="flex items-center gap-2">
                  <i className="ri-add-line text-sm" />
                  <span className="text-sm font-bold">{qtd > 1 ? 'Adicionar ' + qtd + ' unidades' : 'Adicionar ao pedido'}</span>
                </div>
                <span className="text-sm font-bold">
                  R$ {calcularPrecoTotal().toFixed(2)}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}