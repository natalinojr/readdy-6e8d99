import { useState, useEffect, useRef, type MutableRefObject } from 'react';
import { useParams } from 'react-router-dom';
import { queueOrderForPrint, type OrderItemForPrint, type OrderPrintDestino } from '@/lib/printOrderQueue';
import { rawPromoAtivaHoje } from '@/lib/promoUtils';
import { loadCart, saveCart } from '@/lib/cartStorage';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type TableInfo = {
  id: string;
  number: number;
  capacity: number;
  area: string;
  tenant_id: string;
  qr_token: string;
};

type CardapioItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  photo_url: string | null;
  category_id: string | null;
  sla_minutes: number | null;
  skip_kds: boolean | null;
  station_id: string | null;
  promotions?: Promotion[];
};

type Promotion = {
  id: string;
  item_id: string;
  promotional_price: number;
  days_of_week: number[] | null;
  is_recurring: boolean;
  specific_date: string | null;
  is_active: boolean;
};

type CardapioCategory = {
  id: string;
  name: string;
  order_index: number | null;
  station_id: string | null;
};

type OptionGroup = {
  id: string;
  name: string;
  item_id: string;
  is_required: boolean;
  min_selections: number | null;
  max_selections: number | null;
};

type OptionItem = {
  id: string;
  name: string;
  option_group_id: string;
  additional_price: number;
  is_active: boolean;
};

type PresetObservation = {
  id: string;
  item_id: string;
  text: string;
};

export type CartItem = {
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
};

export type Participant = {
  id: string;
  name: string;
  access_token: string;
  table_session_id: string;
  tenant_id: string;
};

type Step = 'loading' | 'encerrada' | 'identificacao' | 'cardapio' | 'confirmacao';

type Highlight = {
  id: string;
  item_id: string;
  custom_price: number | null;
  custom_description: string | null;
  sort_order: number;
  item_name: string;
  item_price: number;
  item_photo_url: string | null;
  item_description: string | null;
  item_category_id: string;
  item_station_id: string | null;
  item_skip_kds: boolean | null;
  item_sla_minutes: number | null;
};

const DESTAQUES_CATEGORY_ID = '__destaques__';
const PROMOCAO_CATEGORY_ID = '__promocao__';

function mergeHighlightsIntoCardapio(
  categories: CardapioCategory[],
  items: CardapioItem[],
  highlights: Highlight[],
): { categories: CardapioCategory[]; items: CardapioItem[] } {
  if (!highlights || highlights.length === 0) {
    return { categories, items };
  }

  // Cria categoria sintetica "Destaques" com order_index negativo para ficar sempre primeiro
  const destaquesCategory: CardapioCategory = {
    id: DESTAQUES_CATEGORY_ID,
    name: '⭐ Destaques',
    order_index: -1,
    station_id: null,
  };

  // Cria itens sinteticos para cada destaque, usando custom_price e custom_description quando definidos
  const destaquesItems: CardapioItem[] = highlights.map(function (h) {
    return {
      id: h.item_id,
      name: h.item_name,
      description: h.custom_description ?? h.item_description,
      price: h.custom_price != null ? h.custom_price : h.item_price,
      photo_url: h.item_photo_url,
      category_id: DESTAQUES_CATEGORY_ID,
      sla_minutes: h.item_sla_minutes,
      skip_kds: h.item_skip_kds,
      station_id: h.item_station_id,
    };
  });

  return {
    categories: [destaquesCategory].concat(categories),
    items: destaquesItems.concat(items),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMesaWriteUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/mesa-write';
}

async function fetchCardapioData(tenantId: string, setters: {
  setCategories: (v: CardapioCategory[]) => void;
  setItems: (v: CardapioItem[]) => void;
  setOptionGroups: (v: OptionGroup[]) => void;
  setOptions: (v: OptionItem[]) => void;
  setObservations: (v: PresetObservation[]) => void;
  setOutOfStockIds: (v: string[]) => void;
  setOpcoesIndisponiveisIds: (v: string[]) => void;
  setCategoriaAtiva: (v: string | null) => void;
  productionPartsRef: MutableRefObject<Record<string, Array<{ name: string; station_id: string }>> | undefined>;
}) {
  const url = getMesaWriteUrl();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_cardapio', tenant_id: tenantId }),
    });
    const data = await res.json();

    // Processa highlights e merge no cardápio
    const merged = mergeHighlightsIntoCardapio(
      data.categories || [],
      data.items || [],
      data.highlights || [],
    );

    setters.setOptionGroups(data.option_groups || []);
    setters.setOptions(data.options || []);
    setters.setObservations(data.observations || []);
    setters.setOutOfStockIds(data.out_of_stock_ids || []);
    setters.setOpcoesIndisponiveisIds(data.opcoes_indisponiveis_ids || []);

    // Merge promotions into items
    const allPromotions: Promotion[] = data.promotions || [];
    const mergedItems = (merged.items).map(function (item) {
      return Object.assign({}, item, {
        promotions: allPromotions.filter(function (p) { return p.item_id === item.id; }),
      });
    });

    // Categoria virtual "Promoção": itens (não-destaque) com promoção válida HOJE.
    const promoItems: typeof mergedItems = mergedItems
      .filter(function (item) {
        return item.category_id !== DESTAQUES_CATEGORY_ID && rawPromoAtivaHoje(item.promotions) != null;
      })
      .map(function (item) { return { ...item, category_id: PROMOCAO_CATEGORY_ID }; });

    let finalCategories = merged.categories;
    let finalItems = mergedItems;
    if (promoItems.length > 0) {
      const promoCategory: CardapioCategory = { id: PROMOCAO_CATEGORY_ID, name: '🔥 Promoção', order_index: -0.5, station_id: null };
      finalCategories = [promoCategory].concat(merged.categories);
      finalItems = promoItems.concat(mergedItems);
    }
    setters.setCategories(finalCategories);
    setters.setItems(finalItems);

    if (data.production_parts) {
      setters.productionPartsRef.current = data.production_parts;
      const keys = Object.keys(data.production_parts);
      console.log('[mesa-qr] fetchCardapioData: production_parts carregado com ' + keys.length + ' itens:', keys.map(function(k) { return k.slice(0,8) + '...'; }));
    } else {
      console.warn('[mesa-qr] fetchCardapioData: NENHUM production_parts na resposta!');
    }
    if (finalCategories && finalCategories.length > 0) {
      setters.setCategoriaAtiva(finalCategories[0].id);
    }
  } catch {
    // Silencioso
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMesaQRData() {
  const params = useParams<{ qr_token: string; session_token?: string }>();
  const qrToken = params.qr_token;
  const urlSessionToken = params.session_token;

  // Estado de carregamento
  const [step, setStep] = useState<Step>('loading');
  const [table, setTable] = useState<TableInfo | null>(null);
  const [tableSessionId, setTableSessionId] = useState('');    // table_sessions.id
  const [caixaSessionId, setCaixaSessionId] = useState('');    // sessions.id (sessão de caixa real)
  const [sessionToken, setSessionToken] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Cardápio
  const [categories, setCategories] = useState<CardapioCategory[]>([]);
  const [items, setItems] = useState<CardapioItem[]>([]);
  const [optionGroups, setOptionGroups] = useState<OptionGroup[]>([]);
  const [options, setOptions] = useState<OptionItem[]>([]);
  const [observations, setObservations] = useState<PresetObservation[]>([]);
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(null);
  const [outOfStockIds, setOutOfStockIds] = useState<string[]>([]);
  const [opcoesIndisponiveisIds, setOpcoesIndisponiveisIds] = useState<string[]>([]);

  // Carrinho (persistido em localStorage p/ sobreviver ao refresh/reload)
  const cartKey = 'qr_' + (qrToken || 'default');
  const [cart, setCart] = useState<CartItem[]>(() => loadCart<CartItem>(cartKey));
  useEffect(function () { saveCart(cartKey, cart); }, [cart, cartKey]);
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [pedidoConfirmado, setPedidoConfirmado] = useState(false);
  const [numeroPedido, setNumeroPedido] = useState('');
  const [confirmedCartItems, setConfirmedCartItems] = useState<CartItem[]>([]);

  // Meus Pedidos
  const [showMeusPedidos, setShowMeusPedidos] = useState(false);

  // Ref para evitar dupla chamada
  const initializedRef = useRef(false);

  // Ref para production_parts do cardápio (evita repassar como state)
  const productionPartsRef = useRef<Record<string, Array<{ name: string; station_id: string }>>>();

  // ── Buscar mesa ──────────────────────────────────────────────────────────────

  useEffect(function () {
    if (initializedRef.current) return;
    if (!qrToken) {
      setErrorMsg('QR Code inválido');
      setStep('encerrada');
      return;
    }

    let cancelled = false;
    initializedRef.current = true;

    async function doBuscarMesa() {
      const url = getMesaWriteUrl();
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'lookup_mesa', qr_token: qrToken }),
        });
        const data = await res.json();

        if (cancelled) return;

        if (data.error === 'mesa_encerrada') {
          Object.keys(localStorage)
            .filter(function (k) { return k.startsWith('mesa_participant_'); })
            .forEach(function (k) { localStorage.removeItem(k); });
          setStep('encerrada');
          return;
        }
        if (data.error) {
          setErrorMsg(data.message || 'Erro ao buscar mesa');
          setStep('encerrada');
          return;
        }
        if (!data.table || !data.session) {
          setStep('encerrada');
          return;
        }

        const currentTable = data.table;
        const currentSession = data.session;
        const currentSessionToken = currentSession.session_token;
        const currentTenantId = currentTable.tenant_id;
        const currentTenantName = data.tenant_name || currentTable.area || 'Estabelecimento';

        setTable(currentTable);
        setTableSessionId(currentSession.id);                   // table_sessions.id
        setCaixaSessionId(currentSession.session_id || '');     // sessions.id (real)
        setSessionToken(currentSessionToken || '');
        setTenantId(currentTenantId);
        setTenantName(currentTenantName);

        if (currentSessionToken && !urlSessionToken) {
          window.history.replaceState(null, '', '/mesa-qr/' + qrToken + '/' + currentSessionToken);
        }

        // Verificar participante salvo
        const savedParticipant = localStorage.getItem('mesa_participant_' + currentSession.id);
        if (savedParticipant) {
          try {
            const p = JSON.parse(savedParticipant);
            const invalidToken = p.session_token && currentSessionToken && p.session_token !== currentSessionToken;
            const invalidTableSession = p.table_session_id && p.table_session_id !== currentSession.id;

            if (invalidToken || invalidTableSession) {
              localStorage.removeItem('mesa_participant_' + currentSession.id);
              Object.keys(localStorage)
                .filter(function (k) { return k.startsWith('mesa_participant_'); })
                .forEach(function (k) { localStorage.removeItem(k); });
              setStep('identificacao');
              await fetchCardapioData(currentTenantId, { setCategories, setItems, setOptionGroups, setOptions, setObservations, setOutOfStockIds, setOpcoesIndisponiveisIds, setCategoriaAtiva, productionPartsRef });
              return;
            }

            setParticipant(p);
            setStep('cardapio');
            await fetchCardapioData(currentTenantId, { setCategories, setItems, setOptionGroups, setOptions, setObservations, setOutOfStockIds, setOpcoesIndisponiveisIds, setCategoriaAtiva, productionPartsRef });
            return;
          } catch {
            localStorage.removeItem('mesa_participant_' + currentSession.id);
          }
        }

        setStep('identificacao');
        await fetchCardapioData(currentTenantId, { setCategories, setItems, setOptionGroups, setOptions, setObservations, setOutOfStockIds, setOpcoesIndisponiveisIds, setCategoriaAtiva, productionPartsRef });
      } catch {
        if (!cancelled) {
          setErrorMsg('Erro de conexão. Tente novamente.');
          setStep('encerrada');
        }
      }
    }

    doBuscarMesa();

    return function () {
      cancelled = true;
    };
  }, [qrToken, urlSessionToken]);

  // ── Criar participante ──────────────────────────────────────────────────────

  function handleIdentificar(nome: string) {
    if (!tableSessionId || !table) return;
    const url = getMesaWriteUrl();
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_participant',
        table_session_id: tableSessionId,
        name: nome.trim(),
        tenant_id: table.tenant_id,
        session_token: sessionToken,
      }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          setErrorMsg(data.message || data.error || 'Erro ao criar participante');
          return;
        }
        setParticipant(data.participant);
        localStorage.setItem(
          'mesa_participant_' + tableSessionId,
          JSON.stringify(Object.assign({}, data.participant, { session_token: sessionToken }))
        );
        setStep('cardapio');
      })
      .catch(function () {
        setErrorMsg('Erro de conexão. Tente novamente.');
        setEnviando(false);
      });
  }

  // ── Carrinho ────────────────────────────────────────────────────────────────

  function handleAdicionar(item: CartItem) {
    // Sempre adiciona como item separado (suporta observações diferentes por unidade)
    setCart(function (prev) { return prev.concat([item]); });
  }

  function handleAlterarQtd(cartId: string, delta: number) {
    setCart(function (prev) {
      const idx = prev.findIndex(function (c) { return c.cartId === cartId; });
      if (idx < 0) return prev;
      const novo = prev.slice();
      const novaQtd = novo[idx].quantidade + delta;
      if (novaQtd <= 0) {
        return novo.filter(function (_, i) { return i !== idx; });
      }
      novo[idx] = Object.assign({}, novo[idx], { quantidade: novaQtd });
      return novo;
    });
  }

  function handleRemover(cartId: string) {
    setCart(function (prev) { return prev.filter(function (c) { return c.cartId !== cartId; }); });
  }

  // ── Editar item do carrinho ─────────────────────────────────────────────

  function handleAbrirEdicao(cartId: string) {
    const item = cart.find(function (c) { return c.cartId === cartId; });
    if (item) {
      setEditingItem(item);
    }
  }

  function handleSalvarEdicao(updatedItem: CartItem) {
    setCart(function (prev) {
      return prev.map(function (c) {
        if (c.cartId === updatedItem.cartId) return updatedItem;
        return c;
      });
    });
    setEditingItem(null);
  }

  function handleFecharEdicao() {
    setEditingItem(null);
  }

  // ── Confirmar pedido ────────────────────────────────────────────────────────

  function handleConfirmarPedido() {
    if (!tableSessionId || !table || !participant) return;
    if (cart.length === 0) return;

    setEnviando(true);
    setErrorMsg('');
    const url = getMesaWriteUrl();

    const subtotal = cart.reduce(function (s, i) { return s + i.precoTotal * i.quantidade; }, 0);
    
    console.log('[mesa-qr] handleConfirmarPedido: cart tem ' + cart.length + ' itens');
    
    const itemsPayload = cart.map(function (ci) {
      // Busca as partes de produção pré-carregadas do cardápio
      const partsForItem = ci.itemId ? productionPartsRef.current?.[ci.itemId] : undefined;
      const productionPartsPayload = partsForItem && partsForItem.length > 0
        ? partsForItem.map(function (p) { return { name: p.name, station_id: p.station_id }; })
        : undefined;

      return {
        item_id: ci.itemId,
        item_name: ci.name,
        item_price: ci.precoTotal,
        quantity: ci.quantidade,
        station_id: ci.stationId,
        skip_kds: ci.skipKds,
        notes: ci.observacaoLivre || null,
        production_parts: productionPartsPayload,
        options: ci.opcoes.map(function (o) {
          return {
            option_id: o.opcaoId || null,
            option_name: o.opcaoNome,
            group_name: o.grupoNome,
            additional_price: o.precoAdicional,
            group_obrigatorio: o.obrigatorio,
          };
        }),
        observations: ci.observacoes.map(function (t) { return { text: t, is_checked: false }; }),
      };
    });

    const payload = {
      action: 'create_mesa_order',
      tenant_id: table.tenant_id,
      table_session_id: tableSessionId,
      session_id: caixaSessionId,    // sessions.id real (sessão de caixa)
      participant_id: participant.id,
      access_token: participant.access_token,
      participant_name: participant.name,
      mesa_number: table.number,
      items: itemsPayload,
      subtotal: subtotal,
      total_amount: subtotal,
    };

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data.error) {
          // 🔒 Se a sessao do caixa foi fechada, mostrar tela de encerrada
          if (data.code === 'session_closed' || data.code === 'table_session_closed') {
            setStep('encerrada');
            setErrorMsg(data.error || 'O estabelecimento esta fechado. Pedidos nao podem ser enviados neste momento.');
            setEnviando(false);
            return;
          }
          setErrorMsg(data.message || data.error || 'Erro ao enviar pedido');
          setEnviando(false);
          return;
        }
        setNumeroPedido(data.data && data.data.number ? data.data.number : '');
        setConfirmedCartItems(cart);
        setPedidoConfirmado(true);
        setCart([]);
        setShowCart(false);
        setEnviando(false);
        setStep('confirmacao');

        // ── Impressão via fila centralizada (BUG-43: mesa QR não enfileirava impressão) ──
        const orderId = data.data?.id;
        const orderNumber = data.data?.number;
        if (orderId && orderNumber) {
          const printItems: OrderItemForPrint[] = itemsPayload.map(function (item) {
            return {
              item_name: item.item_name,
              quantity: item.quantity,
              skip_kds: item.skip_kds,
              station_id: item.station_id,
              item_id: item.item_id,
              production_parts: item.production_parts,
              options: (item.options || []).map(function (o: Record<string, unknown>) {
                return { option_name: (o.option_name as string) || '', obrigatorio: (o.group_obrigatorio as boolean) || undefined };
              }),
              observations: (item.observations || []).map(function (o: Record<string, unknown>) {
                return { text: (o.text as string) || '' };
              }),
              notes: item.notes,
            };
          });

          const printDestino: OrderPrintDestino = {
            tipo: 'table',
            table_number: table.number,
            destination_name: 'Mesa ' + table.number + ' - ' + participant.name,
          };

          queueOrderForPrint(
            table.tenant_id,
            orderId,
            orderNumber,
            'table',
            printItems,
            printDestino,
            undefined,
            subtotal,
            false,
            participant.access_token,
          ).catch(function (e: unknown) {
            console.warn('[mesa-qr] Falha ao enfileirar impressão (non-blocking):', e instanceof Error ? e.message : String(e));
          });
        }
      })
      .catch(function () {
        setErrorMsg('Erro de conexão. Tente novamente.');
        setEnviando(false);
      });
  }

  // ── Novo pedido ─────────────────────────────────────────────────────────────

  function handleNovoPedido() {
    setPedidoConfirmado(false);
    setNumeroPedido('');
    setConfirmedCartItems([]);
    setErrorMsg('');
    setStep('cardapio');
  }

  // ── Valores derivados ───────────────────────────────────────────────────────

  const totalItens = cart.reduce(function (s, i) { return s + i.quantidade; }, 0);
  const totalValor = cart.reduce(function (s, i) { return s + i.precoTotal * i.quantidade; }, 0);

  return {
    step: step,
    table: table,
    participant: participant,
    error: errorMsg,
    tenantName: tenantName,
    categories: categories,
    items: items,
    optionGroups: optionGroups,
    options: options,
    observations: observations,
    categoriaAtiva: categoriaAtiva,
    outOfStockIds: outOfStockIds,
    opcoesIndisponiveisIds: opcoesIndisponiveisIds,
    cart: cart,
    editingItem: editingItem,
    showCart: showCart,
    enviando: enviando,
    pedidoConfirmado: pedidoConfirmado,
    numeroPedido: numeroPedido,
    showMeusPedidos: showMeusPedidos,
    totalItens: totalItens,
    totalValor: totalValor,
    confirmedCartItems: confirmedCartItems,
    setCategoriaAtiva: setCategoriaAtiva,
    setShowCart: setShowCart,
    setShowMeusPedidos: setShowMeusPedidos,
    handleIdentificar: handleIdentificar,
    handleAdicionar: handleAdicionar,
    handleAlterarQtd: handleAlterarQtd,
    handleRemover: handleRemover,
    handleAbrirEdicao: handleAbrirEdicao,
    handleSalvarEdicao: handleSalvarEdicao,
    handleFecharEdicao: handleFecharEdicao,
    handleConfirmarPedido: handleConfirmarPedido,
    handleNovoPedido: handleNovoPedido,
    setError: setErrorMsg,
  };
}