import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { formatCurrency } from '@/lib/formatters';
import { scrollFocusedFieldIntoView } from '@/lib/scrollFocusIntoView';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { rawPromoAtivaHoje } from '@/lib/promoUtils';
import { tx, txBusca } from '@/lib/idiomaCardapio';
import { useTranslation } from 'react-i18next';

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
  // Traducao vinda do backend. O portugues acima NUNCA e sobrescrito: e ele que
  // vai pro carrinho e pra cozinha. Ver src/lib/idiomaCardapio.ts.
  name_i18n?: string | null;
  description_i18n?: string | null;
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
  name_i18n?: string | null;
  order_index: number | null;
  station_id: string | null;
}

interface OptionGroup {
  id: string;
  name: string;
  name_i18n?: string | null;
  item_id: string;
  is_required: boolean;
  min_selections: number | null;
  max_selections: number | null;
}

interface OptionItem {
  id: string;
  name: string;
  name_i18n?: string | null;
  option_group_id: string;
  additional_price: number;
  is_active: boolean;
}

interface PresetObservation {
  id: string;
  item_id: string;
  text: string;
  text_i18n?: string | null;
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
  /** Ajusta a quantidade de uma linha do carrinho (habilita o stepper −/+ no card do item). */
  onAlterarQtd?: (cartId: string, delta: number) => void;
  /** Remove uma linha do carrinho — necessário p/ editar (tocar num item já no carrinho). */
  onRemover?: (cartId: string) => void;
  cart: CartItem[];
  onCategoriaAtivaChange?: (id: string) => void;
  /** ID de item vindo de link de divulgação (?item=): abre o item direto ao carregar. */
  deepLinkItemId?: string | null;
  /** Chamado assim que o deep link foi processado (para o pai limpar o estado/URL). */
  onDeepLinkConsumed?: () => void;
  /** Altura (px) de uma faixa fixa acima da barra de categorias (ex.: senha do QR). */
  topoChips?: number;
}

export default function CardapioMesaQR(props: Props) {
  const { t } = useTranslation();
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
  const [tentouAdicionar, setTentouAdicionar] = useState(false);
  // Linhas do carrinho que o modal está EDITando (vazio = modo "adicionar novo").
  // Ao confirmar em modo edição, essas linhas são removidas e recriadas.
  const [editingCartIds, setEditingCartIds] = useState<string[]>([]);
  const kbInset = useKeyboardInset();
  // Busca abre pela lupa da barra de categorias (a barra vira o campo de busca)
  const [buscaAberta, setBuscaAberta] = useState(false);
  const chipsRef = useRef<HTMLDivElement | null>(null);
  // Toque numa categoria rola a lista; enquanto rola, o scroll spy não mexe na categoria ativa
  const cliqueCategoriaRef = useRef(false);
  const cliqueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // Busca nos DOIS idiomas: quem digita "chicken" e quem digita "frango"
      // acham o mesmo prato.
      const nome = txBusca(i, 'name');
      const desc = txBusca(i, 'description');
      return nome.includes(buscaNorm) || desc.includes(buscaNorm);
    });
  }, [buscaNorm, todosItensDisponiveis]);

  // ── Scroll Spy ───────────────────────────────────────────────────────────────

  const scrollSpyEnabledRef = useRef(true);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const handleScrollSpy = useCallback(function (catId: string) {
    if (!scrollSpyEnabledRef.current) return;
    if (cliqueCategoriaRef.current) return;
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
        rootMargin: '-' + (80 + (props.topoChips || 0)) + 'px 0px -60% 0px',
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
  }, [categoriasOrdenadas, handleScrollSpy, props.topoChips]);

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

  // Reconstrói as UnidadeConfig a partir das linhas do carrinho de um item,
  // expandindo `quantidade` (linha com qtd 3 → 3 unidades editáveis).
  function unidadesFromCart(itemId: string): { unidades: UnidadeConfig[]; cartIds: string[] } {
    const linhas = cart.filter(function (c) { return c.itemId === itemId; });
    const arr: UnidadeConfig[] = [];
    linhas.forEach(function (l) {
      const opcoesSelecionadas: Record<string, string[]> = {};
      l.opcoes.forEach(function (o) {
        if (!o.opcaoId) return;
        const op = options.find(function (x) { return x.id === o.opcaoId; });
        const grupoId = op ? op.option_group_id : null;
        if (!grupoId) return;
        if (!opcoesSelecionadas[grupoId]) opcoesSelecionadas[grupoId] = [];
        opcoesSelecionadas[grupoId].push(o.opcaoId);
      });
      const cfg: UnidadeConfig = {
        opcoesSelecionadas,
        obsSelecionadas: l.observacoes.slice(),
        obsLivre: l.observacaoLivre || '',
      };
      const n = Math.max(1, l.quantidade);
      for (let k = 0; k < n; k++) {
        // Cópia por unidade (não compartilhar referência de arrays/objetos)
        arr.push({
          opcoesSelecionadas: Object.keys(opcoesSelecionadas).reduce(function (acc, gid) {
            acc[gid] = opcoesSelecionadas[gid].slice();
            return acc;
          }, {} as Record<string, string[]>),
          obsSelecionadas: cfg.obsSelecionadas.slice(),
          obsLivre: cfg.obsLivre,
        });
      }
    });
    return { unidades: arr, cartIds: linhas.map(function (l) { return l.cartId; }) };
  }

  function abrirModal(item: CardapioItem) {
    // Sempre abre o modal — mesmo item sem opções/observações pré-configuradas.
    // O modal tem o campo "Outra observação" livre, então todo item aceita
    // observação (ex.: "sem cebola" num item simples).
    setItemSelecionado(item);
    setUnidadeAtiva(0);
    setTentouAdicionar(false);

    // Item JÁ no carrinho → abre em modo EDIÇÃO: carrega quantidade e
    // configuração atuais; ao confirmar, as linhas antigas são substituídas.
    // (Só se o pai fornece onRemover; senão, comportamento antigo de "adicionar".)
    const rebuilt = props.onRemover ? unidadesFromCart(item.id) : { unidades: [], cartIds: [] };
    if (rebuilt.unidades.length > 0) {
      setUnidades(rebuilt.unidades);
      setQtd(rebuilt.unidades.length);
      setEditingCartIds(rebuilt.cartIds);
    } else {
      setUnidades([{ opcoesSelecionadas: {}, obsSelecionadas: [], obsLivre: '' }]);
      setQtd(1);
      setEditingCartIds([]);
    }
    setModalVisible(true);
  }

  function fecharModal() {
    setModalVisible(false);
    setEditingCartIds([]);
    setTimeout(function () {
      setItemSelecionado(null);
      setUnidades([{ opcoesSelecionadas: {}, obsSelecionadas: [], obsLivre: '' }]);
      setUnidadeAtiva(0);
      setQtd(1);
      setTentouAdicionar(false);
    }, 300);
  }

  // ── Deep link (?item=<id>): abre o item direto ao carregar o cardápio ─────────
  // Diferente do clique normal, SEMPRE abre o modal (mesmo item sem opções), para o
  // cliente ver o produto (foto, preço, descrição) antes de adicionar. Roda uma vez.
  const deepLinkDoneRef = useRef(false);
  useEffect(function () {
    const alvo = props.deepLinkItemId;
    if (!alvo || deepLinkDoneRef.current) return;
    if (!items || items.length === 0) return; // aguarda o cardápio carregar
    deepLinkDoneRef.current = true;
    if (props.onDeepLinkConsumed) props.onDeepLinkConsumed();
    const item = items.find(function (i) { return i.id === alvo; });
    if (!item) return; // item inexistente/indisponível: ignora silenciosamente
    if (item.category_id && onCategoriaAtivaChange) onCategoriaAtivaChange(item.category_id);
    setItemSelecionado(item);
    setQtd(1);
    setUnidadeAtiva(0);
    setUnidades([{ opcoesSelecionadas: {}, obsSelecionadas: [], obsLivre: '' }]);
    setEditingCartIds([]);
    setTentouAdicionar(false);
    setModalVisible(true);
  }, [props.deepLinkItemId, items, onCategoriaAtivaChange]);

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

  // Mínimo de opções exigido por um grupo. Grupo obrigatório exige ao menos 1
  // (ou min_selections, se maior); grupo opcional respeita apenas min_selections.
  function minExigido(g: OptionGroup) {
    const base = g.min_selections != null ? g.min_selections : 0;
    return g.is_required ? Math.max(1, base) : base;
  }

  // Retorna os grupos de uma unidade que ainda não atingiram o mínimo exigido.
  function gruposFaltando(cfg: UnidadeConfig) {
    if (!itemSelecionado) return [];
    return gruposDoItem(itemSelecionado.id).filter(function (g) {
      const min = minExigido(g);
      if (min <= 0) return false;
      const sel = cfg.opcoesSelecionadas[g.id] || [];
      return sel.length < min;
    });
  }

  function handleAdicionar() {
    if (!itemSelecionado) return;

    // Bloqueia se alguma unidade não atendeu aos grupos obrigatórios.
    for (let i = 0; i < unidades.length; i++) {
      if (gruposFaltando(unidades[i]).length > 0) {
        setTentouAdicionar(true);
        setUnidadeAtiva(i);
        return;
      }
    }

    // Modo edição: remove as linhas antigas deste item antes de recriar
    // (evita duplicar — era o bug: item já no carrinho somava em vez de editar).
    if (editingCartIds.length > 0 && props.onRemover) {
      editingCartIds.forEach(function (id) { props.onRemover!(id); });
    }

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

  // Última linha do carrinho de um item (é nela que o stepper do card mexe)
  function ultimaLinhaDoItem(itemId: string): CartItem | null {
    for (let i = cart.length - 1; i >= 0; i--) {
      if (cart[i].itemId === itemId) return cart[i];
    }
    return null;
  }

  // ── Preço "a partir de" ──────────────────────────────────────────────────────
  // Item cujo preço vem das opções obrigatórias (ex.: Duo Mex custa R$ 0 e o preço
  // está nos burritos escolhidos) aparecia como "R$ 0,00". Soma o mais barato de
  // cada grupo obrigatório para mostrar o menor valor possível.
  function extraMinimo(item: CardapioItem) {
    let extra = 0;
    gruposDoItem(item.id).forEach(function (g) {
      const min = minExigido(g);
      if (min <= 0) return;
      const precos = opcoesDoGrupo(g.id)
        .filter(function (o) { return o.is_active !== false && !opcoesIndisponiveisIds.includes(o.id); })
        .map(function (o) { return o.additional_price || 0; })
        .sort(function (a, b) { return a - b; });
      for (let k = 0; k < min && k < precos.length; k++) extra += precos[k];
    });
    return extra;
  }

  function rotuloCategoria(cat: CardapioCategory) {
    if (cat.id === '__destaques__') return t('cliente.destaques');
    // Tira emoji/símbolo do começo do nome ("⭐ Destaques", "🔥 Promoção")
    const nome = tx(cat);
    return nome.replace(/^[^\p{L}\p{N}+]+/u, '') || nome;
  }

  function irParaCategoria(catId: string) {
    if (cliqueTimerRef.current) clearTimeout(cliqueTimerRef.current);
    cliqueCategoriaRef.current = true;
    cliqueTimerRef.current = setTimeout(function () { cliqueCategoriaRef.current = false; }, 900);
    if (onCategoriaAtivaChange) onCategoriaAtivaChange(catId);
    requestAnimationFrame(function () {
      const el = document.getElementById('scroll-cat-' + catId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Mantém a categoria ativa visível na barra (rola a barra na horizontal)
  useEffect(function () {
    const box = chipsRef.current;
    if (!box || !categoriaAtiva) return;
    const chip = box.querySelector('[data-cat="' + categoriaAtiva + '"]') as HTMLElement | null;
    if (!chip) return;
    const alvo = chip.offsetLeft - box.clientWidth / 2 + chip.clientWidth / 2;
    box.scrollTo({ left: Math.max(0, alvo), behavior: 'smooth' });
  }, [categoriaAtiva]);

  // Item sem nenhum grupo de opção: o "+" já põe 1 unidade na sacola (sem abrir a janela).
  // Tocar no item continua abrindo a janela (foto, descrição, observação).
  function adicionarRapido(item: CardapioItem) {
    const precoEfetivo = getPrecoEfetivo(item);
    onAdicionar({
      cartId: 'cart-' + item.id + '-' + Date.now() + '-0',
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
  }

  function tocarMais(item: CardapioItem) {
    if (gruposDoItem(item.id).length === 0) adicionarRapido(item);
    else abrirModal(item);
  }

  function renderPreco(item: CardapioItem, tamanho: 'normal' | 'pequeno') {
    const promoAtiva = rawPromoAtivaHoje(item.promotions);
    const extra = extraMinimo(item);
    const base = getPrecoEfetivo(item);
    const cls = tamanho === 'normal' ? 'text-[15px]' : 'text-sm';
    if (extra > 0) {
      return (
        <span className={cls + ' font-bold text-stone-900'}>
          <span className="font-semibold text-stone-500">{t('cliente.aPartirDe')} </span>
          {formatCurrency(base + extra)}
        </span>
      );
    }
    if (promoAtiva) {
      return (
        <span className="flex items-baseline gap-1.5">
          <span className="text-xs text-stone-400 line-through">{formatCurrency(item.price)}</span>
          <span className={cls + ' font-bold text-red-700'}>{formatCurrency(base)}</span>
        </span>
      );
    }
    return <span className={cls + ' font-bold text-stone-900'}>{formatCurrency(item.price)}</span>;
  }

  // Stepper −/+ de um item já na sacola
  function renderStepper(item: CardapioItem, qtyInCart: number) {
    const onAlterarQtd = props.onAlterarQtd;
    return (
      <div className="flex items-center bg-white border border-stone-200 rounded-full shadow-sm h-10">
        <button
          type="button"
          aria-label={'Tirar 1 ' + tx(item)}
          onClick={function (e) {
            e.stopPropagation();
            const linha = ultimaLinhaDoItem(item.id);
            if (linha && onAlterarQtd) onAlterarQtd(linha.cartId, -1);
          }}
          className="w-9 h-10 flex items-center justify-center rounded-full text-[var(--cor-loja)] cursor-pointer"
        >
          <i className={qtyInCart === 1 ? 'ri-delete-bin-line text-[15px]' : 'ri-subtract-line text-base'} />
        </button>
        <span className="min-w-[18px] text-center text-sm font-black text-stone-900">{qtyInCart}</span>
        <button
          type="button"
          aria-label={'Adicionar mais 1 ' + tx(item)}
          onClick={function (e) {
            e.stopPropagation();
            const linha = ultimaLinhaDoItem(item.id);
            if (linha && onAlterarQtd) onAlterarQtd(linha.cartId, 1); // repete a última configuração
          }}
          className="w-9 h-10 flex items-center justify-center rounded-full text-[var(--cor-loja)] cursor-pointer"
        >
          <i className="ri-add-line text-base" />
        </button>
      </div>
    );
  }

  function renderBotaoMais(item: CardapioItem) {
    return (
      <button
        type="button"
        aria-label={'Adicionar ' + tx(item)}
        onClick={function (e) { e.stopPropagation(); tocarMais(item); }}
        className="w-9 h-9 rounded-full bg-white border border-stone-200 shadow-md flex items-center justify-center text-[var(--cor-loja)] cursor-pointer hover:bg-stone-50"
      >
        <i className="ri-add-line text-xl font-bold" />
      </button>
    );
  }

  // Linha da lista: texto à esquerda, foto à direita com o "+"
  function renderItemCard(item: CardapioItem) {
    const qtyInCart = cartQtyMap[item.id] || 0;
    const promoAtiva = rawPromoAtivaHoje(item.promotions);
    const temFoto = !!item.photo_url && !imgErros.has(item.id);
    const comStepper = qtyInCart > 0 && !!props.onAlterarQtd;
    const desc = tx(item, 'description');

    // Card é <div role="button"> (não <button>) porque o "+" e o stepper −/+ são
    // botões dentro dele — botão dentro de botão é HTML inválido.
    return (
      <div
        key={item.id}
        role="button"
        tabIndex={0}
        onClick={function () { abrirModal(item); }}
        onKeyDown={function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirModal(item); } }}
        className="flex gap-3.5 py-4 border-b border-stone-200/70 cursor-pointer text-left"
      >
        <div className="flex-1 min-w-0">
          {promoAtiva ? (
            <span className="inline-block mb-1.5 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 text-xs font-bold">
              {t('cliente.promocao')}
            </span>
          ) : null}
          <h3 className="text-[15px] font-bold leading-snug text-stone-900 break-words">{tx(item)}</h3>
          {desc ? (
            <p className="mt-1 text-[13px] leading-[1.45] text-stone-600 line-clamp-2 break-words">{desc}</p>
          ) : null}
          <div className="mt-2">{renderPreco(item, 'normal')}</div>
          {!temFoto && comStepper ? <div className="mt-2 inline-flex">{renderStepper(item, qtyInCart)}</div> : null}
        </div>
        {temFoto ? (
          <div className="relative shrink-0 w-[100px] h-[100px]">
            <img
              src={item.photo_url as string}
              alt={tx(item)}
              loading="lazy"
              decoding="async"
              className="w-full h-full rounded-2xl object-cover bg-stone-100"
              onError={function () { handleImgError(item.id); }}
            />
            {comStepper ? (
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2">{renderStepper(item, qtyInCart)}</div>
            ) : (
              <div className="absolute -bottom-1.5 -right-1.5">{renderBotaoMais(item)}</div>
            )}
          </div>
        ) : !comStepper ? (
          <div className="shrink-0 self-center">{renderBotaoMais(item)}</div>
        ) : null}
      </div>
    );
  }

  // Cartão do carrossel de destaques
  function renderDestaqueCard(item: CardapioItem) {
    const qtyInCart = cartQtyMap[item.id] || 0;
    const temFoto = !!item.photo_url && !imgErros.has(item.id);
    return (
      <div
        key={'dest-' + item.id}
        role="button"
        tabIndex={0}
        onClick={function () { abrirModal(item); }}
        onKeyDown={function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirModal(item); } }}
        className="shrink-0 w-[152px] cursor-pointer text-left"
      >
        <div className="relative w-[152px] h-[116px] rounded-2xl bg-stone-100 overflow-hidden">
          {temFoto ? (
            <img
              src={item.photo_url as string}
              alt={tx(item)}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
              onError={function () { handleImgError(item.id); }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <i className="ri-restaurant-2-line text-stone-300 text-2xl" />
            </div>
          )}
          <div className="absolute right-2 bottom-2">
            {qtyInCart > 0 ? (
              <span className="min-w-[36px] h-9 px-2 rounded-full bg-[var(--cor-loja)] text-white text-sm font-black flex items-center justify-center shadow-md">
                {qtyInCart}
              </span>
            ) : renderBotaoMais(item)}
          </div>
        </div>
        <p className="mt-2 text-sm font-bold leading-snug text-stone-900 line-clamp-2 break-words">{tx(item)}</p>
        <div className="mt-0.5">{renderPreco(item, 'pequeno')}</div>
      </div>
    );
  }

  // Texto da regra do grupo ("Escolha 1", "Escolha até 3"…)
  function regraGrupo(g: OptionGroup) {
    const min = minExigido(g);
    const max = g.max_selections != null ? g.max_selections : 1;
    if (max <= 1) return t('cliente.escolha1');
    if (min > 0 && min === max) return t('cliente.escolhaN', { n: max });
    if (min > 0) return t('cliente.escolhaDeAte', { min: min, max: max });
    return t('cliente.escolhaAte', { max: max });
  }

  const cfgAtual = itemSelecionado ? unidades[unidadeAtiva] : null;
  const hasObservations = itemSelecionado ? obsDoItem(itemSelecionado.id).length > 0 : false;

  // Primeira escolha obrigatória que falta (em qualquer unidade) — o botão diz qual é
  let faltaUnidade = -1;
  let faltaGrupo: OptionGroup | null = null;
  if (itemSelecionado) {
    for (let i = 0; i < unidades.length && !faltaGrupo; i++) {
      const f = gruposFaltando(unidades[i]);
      if (f.length > 0) { faltaUnidade = i; faltaGrupo = f[0]; }
    }
  }

  function irParaFaltando() {
    if (!faltaGrupo) return;
    setTentouAdicionar(true);
    if (faltaUnidade >= 0) setUnidadeAtiva(faltaUnidade);
    const id = 'grupo-' + faltaGrupo.id;
    requestAnimationFrame(function () {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const destaquesCat = categoriasOrdenadas.find(function (c) { return c.id === '__destaques__'; }) || null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Barra de categorias (presa no topo) — a lupa troca a barra pelo campo de busca */}
      <div className="sticky top-0 z-20 bg-[#FBF8F4] border-b border-stone-200/70" style={props.topoChips ? { top: props.topoChips } : undefined}>
        {buscaAberta ? (
          <div className="flex items-center gap-2 px-4 py-2.5">
            <div className="relative flex-1">
              <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 text-base pointer-events-none" />
              <input
                type="search"
                autoFocus
                value={busca}
                onChange={function (e) { setBusca(e.target.value); }}
                placeholder={t('cliente.buscar')}
                className="w-full h-11 pl-10 pr-3 text-[15px] border border-stone-300 rounded-full bg-white text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-[color:var(--cor-loja-suave)] focus:border-[var(--cor-loja)]"
              />
            </div>
            <button
              type="button"
              onClick={function () { setBusca(''); setBuscaAberta(false); }}
              className="h-11 px-2 text-sm font-bold text-stone-700 cursor-pointer"
            >
              {t('cliente.cancelar')}
            </button>
          </div>
        ) : (
          <div ref={chipsRef} className="flex items-center gap-2 px-4 py-2.5 overflow-x-auto scrollbar-hide">
            <button
              type="button"
              aria-label={t('cliente.buscar')}
              onClick={function () { setBuscaAberta(true); }}
              className="shrink-0 w-11 h-11 rounded-full border border-stone-300 bg-white text-stone-900 flex items-center justify-center cursor-pointer"
            >
              <i className="ri-search-line text-lg" />
            </button>
            {categoriasOrdenadas.map(function (cat) {
              const ativa = categoriaAtiva === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  data-cat={cat.id}
                  aria-pressed={ativa}
                  onClick={function () { irParaCategoria(cat.id); }}
                  className={'shrink-0 h-11 px-4 rounded-full text-sm whitespace-nowrap cursor-pointer transition-colors ' +
                    (ativa
                      ? 'bg-stone-900 text-white font-bold'
                      : 'bg-white text-stone-900 font-semibold border border-stone-300 hover:bg-stone-50')}
                >
                  {rotuloCategoria(cat)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Resultados da busca (lista plana) */}
      {buscaNorm ? (
        resultadosBusca.length > 0 ? (
          <div className="px-5 pt-4">
            <p className="text-xs font-bold text-stone-500">
              {t('cliente.resultadosPara', { n: resultadosBusca.length, q: busca.trim() })}
            </p>
            {resultadosBusca.map(function (item) { return renderItemCard(item); })}
          </div>
        ) : (
          <div className="text-center py-16 flex flex-col items-center">
            <div className="w-16 h-16 flex items-center justify-center bg-stone-100 rounded-2xl mb-4">
              <i className="ri-search-line text-2xl text-stone-300" />
            </div>
            <p className="text-sm font-bold text-stone-700">{t('cliente.semResultado')}</p>
            <p className="text-xs text-stone-500 mt-1">{t('cliente.tenteOutro')}</p>
          </div>
        )
      ) : (
      /* Rolagem contínua - todas as categorias em sequência */
      <div className="pb-6">
        {categoriasOrdenadas.map(function (cat) {
          const catItems = todosItensDisponiveis.filter(function (i) { return i.category_id === cat.id; });
          if (catItems.length === 0) return null;
          if (destaquesCat && cat.id === destaquesCat.id) {
            return (
              <section key={cat.id} id={'scroll-cat-' + cat.id} className="pt-5" style={{ scrollMarginTop: 68 + (props.topoChips || 0) }}>
                <h2 className="px-5 text-lg font-extrabold tracking-tight text-stone-900">{rotuloCategoria(cat)}</h2>
                <div className="flex gap-3 overflow-x-auto scrollbar-hide px-5 pt-3 pb-1">
                  {catItems.map(function (item) { return renderDestaqueCard(item); })}
                </div>
              </section>
            );
          }
          return (
            <section key={cat.id} id={'scroll-cat-' + cat.id} className="px-5 pt-6" style={{ scrollMarginTop: 68 + (props.topoChips || 0) }}>
              <h2 className="text-lg font-extrabold tracking-tight text-stone-900">{rotuloCategoria(cat)}</h2>
              {catItems.map(function (item) { return renderItemCard(item); })}
            </section>
          );
        })}
      </div>
      )}

      {!buscaNorm && todosItensDisponiveis.length === 0 ? (
        <div className="text-center py-16 flex flex-col items-center">
          <div className="w-16 h-16 flex items-center justify-center bg-stone-100 rounded-2xl mb-4">
            <i className="ri-inbox-line text-2xl text-stone-300" />
          </div>
          <p className="text-sm font-bold text-stone-700">{t('cliente.nenhumItem')}</p>
        </div>
      ) : null}

      {/* Janela do item */}
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
            className={'relative w-full max-w-lg bg-[#FBF8F4] rounded-t-3xl max-h-[92vh] overflow-y-auto overflow-x-hidden transition-transform duration-300 ' +
              (modalVisible ? 'translate-y-0' : 'translate-y-full')}
            style={{ scrollbarWidth: 'thin' }}
            onFocus={scrollFocusedFieldIntoView}
          >
            {(itemSelecionado.photo_url && !imgErros.has(itemSelecionado.id)) ? (
              <div className="relative h-60 bg-stone-200">
                <img
                  src={itemSelecionado.photo_url}
                  alt={tx(itemSelecionado)}
                  className="w-full h-full object-cover"
                  onError={function () { handleImgError(itemSelecionado.id); }}
                />
                <button
                  type="button"
                  onClick={fecharModal}
                  aria-label={t('cliente.fechar')}
                  className="absolute top-3 left-3 w-11 h-11 rounded-full bg-white/95 text-stone-900 flex items-center justify-center shadow-sm cursor-pointer"
                >
                  <i className="ri-close-line text-xl" />
                </button>
              </div>
            ) : (
              <div className="sticky top-0 z-10 flex justify-end px-3 pt-3 bg-[#FBF8F4]">
                <button
                  type="button"
                  onClick={fecharModal}
                  aria-label={t('cliente.fechar')}
                  className="w-11 h-11 rounded-full bg-stone-200 text-stone-900 flex items-center justify-center cursor-pointer"
                >
                  <i className="ri-close-line text-xl" />
                </button>
              </div>
            )}

            <div className="px-5 pt-4 pb-1">
              {rawPromoAtivaHoje(itemSelecionado.promotions) ? (
                <span className="inline-block mb-2 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 text-xs font-bold">
                  {t('cliente.promocao')}
                </span>
              ) : null}
              <h2 className="text-[22px] leading-tight font-extrabold tracking-tight text-stone-900 break-words">{tx(itemSelecionado)}</h2>
              {tx(itemSelecionado, 'description') ? (
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{tx(itemSelecionado, 'description')}</p>
              ) : null}
              <div className="mt-2.5 text-base">{renderPreco(itemSelecionado, 'normal')}</div>
            </div>

            {/* Seletor de unidade (quando qtd > 1) */}
            {qtd > 1 ? (
              <div className="px-5 pt-4">
                <p className="text-sm font-bold text-stone-900 mb-2">{t('cliente.porUnidade')}</p>
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
                        className={'shrink-0 h-9 px-3.5 rounded-full text-xs font-bold cursor-pointer whitespace-nowrap transition-colors border ' +
                          (unidadeAtiva === idx
                            ? 'bg-stone-900 text-white border-stone-900'
                            : 'bg-white text-stone-700 border-stone-300')
                        }
                      >
                        {t('cliente.unidadeN', { n: idx + 1 })}
                        {hasCustom ? (
                          <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-[var(--cor-loja)] align-middle" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Grupos de opção */}
            {gruposDoItem(itemSelecionado.id).map(function (grupo) {
              const minGrupo = minExigido(grupo);
              const maxGrupo = grupo.max_selections != null ? grupo.max_selections : 1;
              const unica = maxGrupo <= 1;
              const selGrupo = cfgAtual.opcoesSelecionadas[grupo.id] || [];
              const completo = minGrupo > 0 && selGrupo.length >= minGrupo;
              const faltando = tentouAdicionar && minGrupo > 0 && selGrupo.length < minGrupo;
              return (
                <div key={grupo.id} id={'grupo-' + grupo.id} className="scroll-mt-2 mt-4">
                  <div className="bg-stone-100 px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-extrabold text-stone-900 break-words">{tx(grupo)}</p>
                      <p className="text-[13px] text-stone-600 mt-0.5">{regraGrupo(grupo)}</p>
                    </div>
                    {minGrupo > 0 ? (
                      <span className={'shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ' +
                        (completo ? 'bg-emerald-50 text-emerald-700' : faltando ? 'bg-red-600 text-white' : 'bg-amber-50 text-amber-800')}>
                        {completo ? t('cliente.pronto') : t('cliente.obrigatorio')}
                      </span>
                    ) : (
                      <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-bold bg-stone-200 text-stone-600">
                        {t('cliente.opcional')}
                      </span>
                    )}
                  </div>
                  <div className="px-5">
                    {opcoesDoGrupo(grupo.id).map(function (op) {
                      const checked = selGrupo.includes(op.id);
                      const esgotada = opcoesIndisponiveisIds.includes(op.id);
                      return (
                        <label
                          key={op.id}
                          className={'flex items-center gap-3 min-h-[56px] border-b border-stone-200/70 ' +
                            (esgotada ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer')}
                        >
                          <span className={'flex-1 text-[15px] font-semibold break-words ' + (esgotada ? 'text-stone-400 line-through' : 'text-stone-900')}>{tx(op)}</span>
                          {esgotada ? (
                            <span className="text-[11px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                              {t('cliente.esgotado')}
                            </span>
                          ) : op.additional_price > 0 ? (
                            <span className="text-sm font-semibold text-stone-700 whitespace-nowrap">+ {formatCurrency(op.additional_price)}</span>
                          ) : null}
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={esgotada}
                            onChange={esgotada ? undefined : function () { toggleOpcao(unidadeAtiva, grupo.id, op.id, grupo.max_selections); }}
                            className="sr-only"
                          />
                          <span
                            aria-hidden="true"
                            className={'shrink-0 w-[22px] h-[22px] flex items-center justify-center border-2 transition-colors ' +
                              (unica ? 'rounded-full ' : 'rounded-md ') +
                              (checked ? 'border-[var(--cor-loja)] ' + (unica ? 'bg-white' : 'bg-[var(--cor-loja)]') : 'border-stone-300 bg-white')}
                          >
                            {checked ? (
                              unica
                                ? <span className="w-2.5 h-2.5 rounded-full bg-[var(--cor-loja)]" />
                                : <i className="ri-check-line text-white text-sm" />
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Observações predefinidas */}
            {hasObservations ? (
              <div className="px-5 pt-5">
                <p className="text-base font-extrabold text-stone-900 mb-3">{t('cliente.observacoes')}</p>
                <div className="flex flex-wrap gap-2">
                  {obsDoItem(itemSelecionado.id).map(function (obs) {
                    const checked = cfgAtual.obsSelecionadas.includes(obs.text);
                    return (
                      <button
                        key={obs.id}
                        type="button"
                        aria-pressed={checked}
                        onClick={function () { toggleObs(unidadeAtiva, obs.text); }}
                        className={'h-10 px-4 rounded-full text-sm font-semibold cursor-pointer transition-colors border ' +
                          (checked
                            ? 'bg-stone-900 text-white border-stone-900'
                            : 'bg-white text-stone-700 border-stone-300')
                        }
                      >
                        {tx(obs, 'text')}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Observação livre */}
            <div className="px-5 pt-5 pb-6">
              <label htmlFor="obs-livre-item" className="block text-[15px] font-bold text-stone-900">
                {t('cliente.algumaObs')}{qtd > 1 ? ' (' + t('cliente.unidadeN', { n: unidadeAtiva + 1 }) + ')' : ''}
              </label>
              <textarea
                id="obs-livre-item"
                value={cfgAtual.obsLivre}
                onChange={function (e) { setObsLivre(unidadeAtiva, e.target.value.slice(0, 150)); }}
                placeholder={t('cliente.exemploObs')}
                className="mt-2 w-full px-3.5 py-3 border border-stone-300 rounded-2xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-[color:var(--cor-loja-suave)] focus:border-[var(--cor-loja)] resize-none bg-white"
                rows={2}
                maxLength={150}
              />
            </div>

            {/* Rodapé: quantidade + adicionar (ou o que falta escolher) */}
            <div className="sticky bottom-0 bg-[#FBF8F4] border-t border-stone-200/70 px-4 pt-2.5 pb-4 flex items-center gap-2.5">
              <div className="shrink-0 flex items-center h-14 rounded-2xl border border-stone-300 bg-white">
                <button
                  type="button"
                  aria-label="Diminuir quantidade"
                  onClick={function () { ajustarQtd(qtd - 1); }}
                  className="w-11 h-14 flex items-center justify-center text-stone-900 cursor-pointer"
                >
                  <i className="ri-subtract-line text-lg" />
                </button>
                <span className="min-w-[22px] text-center text-base font-bold text-stone-900">{qtd}</span>
                <button
                  type="button"
                  aria-label="Aumentar quantidade"
                  onClick={function () { ajustarQtd(qtd + 1); }}
                  className="w-11 h-14 flex items-center justify-center text-stone-900 cursor-pointer"
                >
                  <i className="ri-add-line text-lg" />
                </button>
              </div>
              {faltaGrupo ? (
                <button
                  type="button"
                  onClick={irParaFaltando}
                  className="flex-1 min-w-0 h-14 rounded-2xl bg-stone-200 text-stone-800 px-3 cursor-pointer text-left"
                >
                  <span className="block text-xs font-semibold text-stone-600">{t('cliente.faltaEscolherTitulo')}</span>
                  <span className="block text-sm font-bold truncate">{tx(faltaGrupo)}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleAdicionar}
                  className="flex-1 min-w-0 h-14 rounded-2xl bg-[var(--cor-loja)] hover:bg-[var(--cor-loja-forte)] text-white flex items-center justify-between px-4 cursor-pointer transition-colors"
                >
                  <span className="text-[15px] font-bold truncate">
                    {editingCartIds.length > 0
                      ? t('cliente.atualizar')
                      : (qtd > 1 ? t('cliente.adicionar') + ' ' + qtd : t('cliente.adicionar'))}
                  </span>
                  <span className="text-[15px] font-bold">{formatCurrency(calcularPrecoTotal())}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
