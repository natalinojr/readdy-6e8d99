import { useState, useEffect, useRef, useMemo, type MutableRefObject } from 'react';
import { clubeLimparReservas, type ClubeSelecao } from '@/components/fidelidade/ClubeCheckout';
import { useMenuPing, comJitter } from '@/hooks/useMenuPing';
import { useParams } from 'react-router-dom';
import { queueOrderForPrint, type OrderItemForPrint, type OrderPrintDestino } from '@/lib/printOrderQueue';
import { rawPromoAtivaHoje } from '@/lib/promoUtils';
import { loadCart, saveCart } from '@/lib/cartStorage';
import { loadPixMemo, clearPixMemo } from './pixMemo';
import { idsForaDoHorario, normalizarHorario } from '@/lib/horarioExibicao';
import { useRelogioMinuto } from '@/hooks/useRelogioMinuto';
import { supabase } from '@/lib/supabase';

// Nome que o cliente usou da última vez neste aparelho (preenche "Como chamamos você?")
const NOME_CLIENTE_KEY = 'qr_nome_cliente';
function lerNomeSalvo(): string {
  try { return localStorage.getItem(NOME_CLIENTE_KEY) || ''; } catch { return ''; }
}

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
  availability_schedule?: unknown;
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
  availability_schedule?: unknown;
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

type Step = 'loading' | 'encerrada' | 'identificacao' | 'cardapio' | 'confirmacao' | 'comprovante';

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
  availability_schedule?: unknown;
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

// Cardápio como veio do servidor; o que aparece é montado por montarCardapio a cada minuto.
type CardapioBase = { categories: CardapioCategory[]; items: CardapioItem[]; highlights: Highlight[]; promotions: Promotion[] };

/**
 * Monta o cardápio que o cliente vê: tira categoria/item/destaque fora do horário de
 * exibição (`fora` = idsForaDoHorario; o destaque só aparece se o item dele também
 * estiver no horário), cria as categorias virtuais Destaques e Promoção e esconde a
 * categoria que ficou vazia só por causa do horário.
 */
function montarCardapio(base: CardapioBase, fora: Set<string>): { categories: CardapioCategory[]; items: CardapioItem[] } {
  const items = base.items.filter(function (it) { return !fora.has(it.id); });
  const comItemAgora = new Set(items.map(function (it) { return it.category_id; }));
  const comItemSempre = new Set(base.items.map(function (it) { return it.category_id; }));
  const categories = base.categories.filter(function (c) {
    return !fora.has(c.id) && (comItemAgora.has(c.id) || !comItemSempre.has(c.id));
  });
  const visiveis = new Set(items.map(function (it) { return it.id; }));
  const highlights = base.highlights.filter(function (h) {
    return visiveis.has(h.item_id) && !fora.has('h:' + h.id);
  });

  const merged = mergeHighlightsIntoCardapio(categories, items, highlights);

  // Merge promotions into items
  const mergedItems = (merged.items).map(function (item) {
    return Object.assign({}, item, {
      promotions: base.promotions.filter(function (p) { return p.item_id === item.id; }),
    });
  });

  // Categoria virtual "Promoção": itens (não-destaque) com promoção válida HOJE.
  const promoItems: typeof mergedItems = mergedItems
    .filter(function (item) {
      return item.category_id !== DESTAQUES_CATEGORY_ID && rawPromoAtivaHoje(item.promotions) != null;
    })
    .map(function (item) { return { ...item, category_id: PROMOCAO_CATEGORY_ID }; });

  if (promoItems.length > 0) {
    const promoCategory: CardapioCategory = { id: PROMOCAO_CATEGORY_ID, name: '🔥 Promoção', order_index: -0.5, station_id: null };
    return { categories: [promoCategory].concat(merged.categories), items: promoItems.concat(mergedItems) };
  }
  return { categories: merged.categories, items: mergedItems };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMesaWriteUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/mesa-write';
}

async function fetchCardapioData(tenantId: string, setters: {
  setCardapioBase: (v: CardapioBase) => void;
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

    const base: CardapioBase = {
      categories: data.categories || [],
      items: data.items || [],
      highlights: data.highlights || [],
      promotions: data.promotions || [],
    };

    setters.setOptionGroups(data.option_groups || []);
    setters.setOptions(data.options || []);
    setters.setObservations(data.observations || []);
    setters.setOutOfStockIds(data.out_of_stock_ids || []);
    setters.setOpcoesIndisponiveisIds(data.opcoes_indisponiveis_ids || []);

    setters.setCardapioBase(base);
    const finalCategories = montarCardapio(base, new Set(idsForaDoHorario(base, 'casa'))).categories;

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

// Pagou e a tela recarregou (aba descartada, "puxar para atualizar") ou a sessão da
// mesa fechou sozinha porque a conta zerou — nos dois casos o participante salvo já
// não vale e o cliente cairia na tela de nome achando que perdeu o pagamento.
// Antes disso, conferimos o Pix que ESTE aparelho gerou e mostramos o comprovante.
async function buscarComprovantePix(qrToken: string): Promise<{ amount: number; method?: string } | null> {
  const memo = loadPixMemo(qrToken);
  if (!memo) return null;
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  try {
    const res = await fetch(base + '/functions/v1/online-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'get_pix_status',
        pix_payment_id: memo.pixId,
        reconcile: true,
        participant_id: memo.participantId,
        access_token: memo.accessToken,
      }),
    });
    const data = await res.json();
    if (data?.pix?.status === 'confirmed') return { amount: Number(data.pix.amount ?? memo.amount), method: data.pix.method || 'pix' };
    if (data?.pix && data.pix.status !== 'pending') clearPixMemo(qrToken);
  } catch { /* sem rede: segue o fluxo normal */ }
  return null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMesaQRData() {
  const params = useParams<{ qr_token: string; session_token?: string }>();
  const qrToken = params.qr_token;
  const urlSessionToken = params.session_token;

  // Estado de carregamento
  const [step, setStep] = useState<Step>('loading');
  const [table, setTable] = useState<TableInfo | null>(null);
  const [tableSessionId, setTableSessionId] = useState('');    // table_sessions.id ('' na fila por senha)
  const [caixaSessionId, setCaixaSessionId] = useState('');    // sessions.id (sessão de caixa real)
  // QR universal (mesa 0): fila por SENHA — não existe sessão de mesa nenhuma.
  const [queueMode, setQueueMode] = useState(false);
  const [sessionToken, setSessionToken] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [tenantName, setTenantName] = useState('');
  // Logo da loja (tenants.logo_url) — a mesa-write não devolve; leitura pública direta
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  // Capa e cor do cardápio online (Configurações › Loja)
  const [capaUrl, setCapaUrl] = useState<string | null>(null);
  const [corLoja, setCorLoja] = useState<string | null>(null);
  const [capaPosicao, setCapaPosicao] = useState<string | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Cardápio
  const [cardapioBase, setCardapioBase] = useState<CardapioBase | null>(null);
  // Horário de exibição: o relógio só roda se algo do cardápio tiver horário.
  const usaHorario = useMemo(function () {
    if (!cardapioBase) return false;
    const tem = function (r: { availability_schedule?: unknown }) { return normalizarHorario(r.availability_schedule) != null; };
    return cardapioBase.categories.some(tem) || cardapioBase.items.some(tem) || cardapioBase.highlights.some(tem);
  }, [cardapioBase]);
  const minutoAgora = useRelogioMinuto(usaHorario);
  // Chave do que está fora do horário: muda só quando algo entra/sai (não a cada minuto).
  // minutoAgora só dispara o recálculo na virada do minuto; a hora vem de new Date().
  const chaveForaDoHorario = useMemo(function () {
    return cardapioBase && usaHorario ? idsForaDoHorario(cardapioBase, 'casa').join(',') : '';
  }, [cardapioBase, usaHorario, minutoAgora]);
  const cardapioAgora = useMemo(function () {
    if (!cardapioBase) return { categories: [] as CardapioCategory[], items: [] as CardapioItem[] };
    return montarCardapio(cardapioBase, new Set(chaveForaDoHorario ? chaveForaDoHorario.split(',') : []));
  }, [cardapioBase, chaveForaDoHorario]);
  const categories = cardapioAgora.categories;
  const items = cardapioAgora.items;
  const [optionGroups, setOptionGroups] = useState<OptionGroup[]>([]);
  const [options, setOptions] = useState<OptionItem[]>([]);
  const [observations, setObservations] = useState<PresetObservation[]>([]);
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(null);
  const [outOfStockIds, setOutOfStockIds] = useState<string[]>([]);
  const [opcoesIndisponiveisIds, setOpcoesIndisponiveisIds] = useState<string[]>([]);

  // "Publicar cardápio" (aba Cardápio) → recarrega sem F5. Mantém a categoria
  // em que o cliente está (setter no-op) e espalha os pedidos no tempo.
  useMenuPing(tenantId, comJitter(function () {
    if (!tenantId) return;
    fetchCardapioData(tenantId, { setCardapioBase, setOptionGroups, setOptions, setObservations, setOutOfStockIds, setOpcoesIndisponiveisIds, setCategoriaAtiva: function () {}, productionPartsRef });
  }));

  // Carrinho (persistido em localStorage p/ sobreviver ao refresh/reload)
  const cartKey = 'qr_' + (qrToken || 'default');
  const [cart, setCart] = useState<CartItem[]>(() => loadCart<CartItem>(cartKey));
  useEffect(function () { saveCart(cartKey, cart); }, [cart, cartKey]);
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Clube de fidelidade: cartão + prêmios reservados para o próximo pedido (desconto
  // recalculado pela mesa-write; conta e Pix leem o total do pedido).
  const [clubeSel, setClubeSel] = useState<ClubeSelecao>({ token: null, holdIds: [], desconto: 0, nomes: [] });
  // Desconto do clube que o servidor gravou no último pedido (tela de confirmação).
  const [descontoConfirmado, setDescontoConfirmado] = useState(0);
  const [pedidoConfirmado, setPedidoConfirmado] = useState(false);
  const [numeroPedido, setNumeroPedido] = useState('');
  const [confirmedCartItems, setConfirmedCartItems] = useState<CartItem[]>([]);

  // Meus Pedidos
  const [showMeusPedidos, setShowMeusPedidos] = useState(false);

  // Comprovante de pagamento (quando a identificação se perdeu depois de pagar)
  const [comprovante, setComprovante] = useState<{ amount: number; method?: string } | null>(null);

  // QR universal em "só vai pra cozinha depois de pago": pedido segurado (rascunho) esperando o
  // pagamento. `pago` vira true quando o Pix/cartão confirma ou o caixa recebe.
  const [pedidoAguardandoPagamento, setPedidoAguardandoPagamento] = useState<{ id: string; numero: string; total: number; pago: boolean } | null>(null);

  // Pagar a conta (Pix online) — botão só aparece se a loja tem provedor ativo
  const [showPagarConta, setShowPagarConta] = useState(false);
  const [onlinePayEnabled, setOnlinePayEnabled] = useState(false);
  useEffect(function () {
    if (!tenantId) return;
    let cancelled = false;
    const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
    fetch(base + '/functions/v1/online-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'public_status', tenant_id: tenantId }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!cancelled) setOnlinePayEnabled(Boolean(d && d.enabled)); })
      .catch(function () { /* fica desligado */ });
    return function () { cancelled = true; };
  }, [tenantId]);

  // Pedido segurado: enquanto a confirmação espera o pagamento, confere a conta de tempos em tempos.
  // Cobre o caixa recebendo pela senha e o Pix pago com o modal já fechado.
  useEffect(function () {
    if (step !== 'confirmacao' || !pedidoAguardandoPagamento || pedidoAguardandoPagamento.pago || !participant) return;
    const pedidoId = pedidoAguardandoPagamento.id;
    const credencial = { participant_id: participant.id, access_token: participant.access_token };
    const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
    let cancelled = false;

    async function checar() {
      try {
        const res = await fetch(base + '/functions/v1/online-payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_bill', ...credencial }),
        });
        const d = await res.json();
        if (cancelled || !d || d.error || !Array.isArray(d.orders)) return;
        const meu = d.orders.find(function (o: { id: string }) { return o.id === pedidoId; });
        if (meu && (meu.is_paid || Number(meu.remaining) <= 0)) {
          setPedidoAguardandoPagamento(function (p) { return p && p.id === pedidoId ? Object.assign({}, p, { pago: true }) : p; });
        }
      } catch { /* próximo ciclo */ }
    }

    const timer = setInterval(checar, 8000);
    function aoVoltar() { if (document.visibilityState === 'visible') checar(); }
    document.addEventListener('visibilitychange', aoVoltar);
    return function () {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pedidoAguardandoPagamento?.id, pedidoAguardandoPagamento?.pago, participant?.id, participant?.access_token]);

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
          // "Estabelecimento fechado." (caixa fechado) × mesa encerrada: a tela diz qual
          setErrorMsg(data.message || '');
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
        const isFila = data.mode === 'queue';
        if (!data.table || (!isFila && !data.session)) {
          setStep('encerrada');
          return;
        }

        const currentTable = data.table;
        const currentSession = isFila ? null : data.session;
        const currentSessionToken = currentSession ? currentSession.session_token : '';
        const currentCaixaId = isFila ? (data.queue?.session_id || '') : (currentSession.session_id || '');
        const currentTenantId = currentTable.tenant_id;
        const currentTenantName = data.tenant_name || currentTable.area || 'Estabelecimento';

        setTable(currentTable);
        setQueueMode(isFila);
        setTableSessionId(isFila ? '' : currentSession.id);
        setCaixaSessionId(currentCaixaId);
        setSessionToken(currentSessionToken || '');
        setTenantId(currentTenantId);
        setTenantName(currentTenantName);

        // Logo: secundário — com timeout, porque o supabase-js pode travar no lock de sessão
        Promise.race([
          supabase.from('tenants').select('logo_url, cover_url, brand_color, cover_position').eq('id', currentTenantId).maybeSingle()
            .then(function (r) { return r.data || null; }),
          new Promise<null>(function (resolve) { setTimeout(function () { resolve(null); }, 2500); }),
        ]).then(function (m) {
          const marca = m as { logo_url?: string | null; cover_url?: string | null; brand_color?: string | null; cover_position?: string | null } | null;
          if (cancelled || !marca) return;
          if (marca.logo_url) setLogoUrl(marca.logo_url);
          if (marca.cover_url) setCapaUrl(marca.cover_url);
          if (marca.brand_color) setCorLoja(marca.brand_color);
          if (marca.cover_position) setCapaPosicao(marca.cover_position);
        }).catch(function () { /* segue sem logo */ });

        if (!isFila && currentSessionToken && !urlSessionToken) {
          window.history.replaceState(null, '', '/mesa-qr/' + qrToken + '/' + currentSessionToken);
        }

        // Na fila a senha vive enquanto o caixa estiver aberto; na mesa, enquanto a sessão durar.
        const storageKey = isFila ? 'mesa_participant_qr_' + qrToken : 'mesa_participant_' + currentSession.id;
        const savedParticipant = localStorage.getItem(storageKey);
        if (savedParticipant) {
          try {
            const p = JSON.parse(savedParticipant);
            // Fila: a senha só vale dentro da mesma sessão de caixa (novo dia = senha nova).
            const invalidQueue = isFila && (!p.caixa_session_id || p.caixa_session_id !== currentCaixaId);
            const invalidToken = !isFila && p.session_token && currentSessionToken && p.session_token !== currentSessionToken;
            const invalidTableSession = !isFila && p.table_session_id && p.table_session_id !== currentSession.id;

            if (invalidQueue || invalidToken || invalidTableSession) {
              localStorage.removeItem(storageKey);
              Object.keys(localStorage)
                .filter(function (k) { return k.startsWith('mesa_participant_'); })
                .forEach(function (k) { localStorage.removeItem(k); });
              const recibo = await buscarComprovantePix(qrToken || '');
              if (cancelled) return;
              if (recibo) {
                setComprovante(recibo);
                setStep('comprovante');
                return;
              }
              setStep('cardapio');
              await fetchCardapioData(currentTenantId, { setCardapioBase, setOptionGroups, setOptions, setObservations, setOutOfStockIds, setOpcoesIndisponiveisIds, setCategoriaAtiva, productionPartsRef });
              return;
            }

            setParticipant(p);
            setStep('cardapio');
            await fetchCardapioData(currentTenantId, { setCardapioBase, setOptionGroups, setOptions, setObservations, setOutOfStockIds, setOpcoesIndisponiveisIds, setCategoriaAtiva, productionPartsRef });
            return;
          } catch {
            localStorage.removeItem(storageKey);
          }
        }

        const reciboSemParticipante = await buscarComprovantePix(qrToken || '');
        if (cancelled) return;
        if (reciboSemParticipante) {
          setComprovante(reciboSemParticipante);
          setStep('comprovante');
          return;
        }

        setStep('cardapio');
        await fetchCardapioData(currentTenantId, { setCardapioBase, setOptionGroups, setOptions, setObservations, setOutOfStockIds, setOpcoesIndisponiveisIds, setCategoriaAtiva, productionPartsRef });
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
      // StrictMode (dev) roda o efeito 2x: sem liberar a ref, a 2ª rodada era ignorada e a tela ficava em "Carregando".
      initializedRef.current = false;
    };
  }, [qrToken, urlSessionToken]);

  // ── Criar participante ──────────────────────────────────────────────────────

  // O cliente olha o cardápio sem se identificar; a senha (participante) nasce quando ele
  // finaliza o primeiro pedido — ou quando abre "Meus pedidos"/"Pagar conta" sem ter pedido.
  async function garantirParticipante(nome: string): Promise<Participant | null> {
    if (participant) return participant;
    if (!table) return null;
    if (queueMode ? !caixaSessionId : !tableSessionId) return null;
    const nomeLimpo = (nome || '').trim();
    if (!nomeLimpo) { setErrorMsg('Digite seu nome'); return null; }
    try {
      const res = await fetch(getMesaWriteUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queueMode
          ? { action: 'create_participant', session_id: caixaSessionId, name: nomeLimpo, tenant_id: table.tenant_id }
          : { action: 'create_participant', table_session_id: tableSessionId, name: nomeLimpo, tenant_id: table.tenant_id, session_token: sessionToken }),
      });
      const data = await res.json();
      if (data.error || !data.participant) {
        setErrorMsg(data.message || data.error || 'Não foi possível registrar seu nome');
        return null;
      }
      setParticipant(data.participant);
      localStorage.setItem(
        queueMode ? 'mesa_participant_qr_' + (qrToken || '') : 'mesa_participant_' + tableSessionId,
        JSON.stringify(Object.assign({}, data.participant, queueMode ? { caixa_session_id: caixaSessionId } : { session_token: sessionToken }))
      );
      try { localStorage.setItem(NOME_CLIENTE_KEY, nomeLimpo); } catch { /* ignora */ }
      return data.participant as Participant;
    } catch {
      setErrorMsg('Erro de conexão. Tente novamente.');
      return null;
    }
  }

  function handleIdentificar(nome: string) {
    if (!table) return;
    if (queueMode ? !caixaSessionId : !tableSessionId) return;
    const url = getMesaWriteUrl();
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queueMode
        ? { action: 'create_participant', session_id: caixaSessionId, name: nome.trim(), tenant_id: table.tenant_id }
        : { action: 'create_participant', table_session_id: tableSessionId, name: nome.trim(), tenant_id: table.tenant_id, session_token: sessionToken }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          setErrorMsg(data.message || data.error || 'Erro ao criar participante');
          return;
        }
        setParticipant(data.participant);
        localStorage.setItem(
          queueMode ? 'mesa_participant_qr_' + (qrToken || '') : 'mesa_participant_' + tableSessionId,
          JSON.stringify(Object.assign({}, data.participant, queueMode ? { caixa_session_id: caixaSessionId } : { session_token: sessionToken }))
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

  // "Esvaziar" da sacola (já confirmado pelo cliente)
  function handleEsvaziarSacola() {
    setCart([]);
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

  async function handleConfirmarPedido(nome?: string) {
    if (!table) return;
    if (queueMode ? !caixaSessionId : !tableSessionId) return;
    if (cart.length === 0) return;

    setEnviando(true);
    setErrorMsg('');
    const participant = await garantirParticipante(nome || '');
    if (!participant) { setEnviando(false); return; }
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

    // Idempotência: o mesmo carrinho reenviado (retry após falha de rede, recarga da página)
    // reusa o client_request_id — o servidor devolve o pedido já criado em vez de duplicar.
    const requestKey = 'mesa_order_req_' + (qrToken || 'default');
    const cartSignature = JSON.stringify([participant.id, itemsPayload]);
    let clientRequestId = '';
    try {
      const saved = JSON.parse(localStorage.getItem(requestKey) || 'null');
      if (saved && saved.sig === cartSignature && typeof saved.id === 'string') clientRequestId = saved.id;
    } catch { /* ignora */ }
    if (!clientRequestId) {
      clientRequestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
      try { localStorage.setItem(requestKey, JSON.stringify({ id: clientRequestId, sig: cartSignature })); } catch { /* ignora */ }
    }
    const clearRequestId = function () { try { localStorage.removeItem(requestKey); } catch { /* ignora */ } };

    const payload = {
      action: 'create_mesa_order',
      client_request_id: clientRequestId,
      tenant_id: table.tenant_id,
      table_session_id: queueMode ? null : tableSessionId,
      session_id: caixaSessionId,    // sessions.id real (sessão de caixa)
      participant_id: participant.id,
      access_token: participant.access_token,
      participant_name: participant.name,
      mesa_number: queueMode ? null : table.number,
      items: itemsPayload,
      subtotal: subtotal,
      total_amount: subtotal,
      ...(clubeSel.token ? { loyalty_token: clubeSel.token } : {}),
      ...(clubeSel.token && clubeSel.holdIds.length > 0 ? { loyalty_hold_ids: clubeSel.holdIds } : {}),
    };

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        // Resposta definitiva do servidor (sucesso ou recusa 4xx): a próxima tentativa é um
        // envio novo. Falha de rede / 5xx mantém o id para o retry não duplicar o pedido.
        if (res.status < 500) clearRequestId();
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
        setDescontoConfirmado(Number(data.data?.discount_amount ?? 0));
        setPedidoConfirmado(true);
        clubeLimparReservas(table.tenant_id);
        setClubeSel({ token: clubeSel.token, holdIds: [], desconto: 0, nomes: [] });
        setCart([]);
        setShowCart(false);
        setEnviando(false);
        setStep('confirmacao');

        // "Só vai pra cozinha depois de pago": o pedido nasceu rascunho, fora do KDS. O servidor imprime
        // os tickets quando o pagamento confirma (Pix/cartão pelo app) ou o caixa recebe — por isso
        // aqui NÃO enfileiramos impressão. Abre o pagamento logo de cara (se a loja tem pagamento online).
        const held = data.data?.held === true;
        if (held) {
          setPedidoAguardandoPagamento({
            id: data.data?.id || '',
            numero: data.data?.number || '',
            total: typeof data.data?.total_amount === 'number' ? data.data.total_amount : subtotal,
            pago: false,
          });
          if (onlinePayEnabled) setShowPagarConta(true);
        } else {
          setPedidoAguardandoPagamento(null);
        }

        // ── Impressão via fila centralizada (BUG-43: mesa QR não enfileirava impressão) ──
        const orderId = data.data?.id;
        const orderNumber = data.data?.number;
        if (!held && orderId && orderNumber) {
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

          // Fila (QR universal): a senha já sai no bloco grande do ticket (parâmetro
          // `senha`); o destino leva o NOME que o cliente digitou, senão a cozinha
          // recebia a mesma senha impressa duas vezes e nenhum nome.
          const printDestino: OrderPrintDestino = queueMode
            ? { tipo: 'nome', destination_name: (participant.name || '').trim() || ('Senha ' + participant.access_token), table_number: null }
            : { tipo: 'table', table_number: table.number, destination_name: 'Mesa ' + table.number + ' - ' + participant.name };

          queueOrderForPrint(
            table.tenant_id,
            orderId,
            orderNumber,
            queueMode ? 'self_service' : 'table',
            printItems,
            printDestino,
            undefined,
            typeof data.data?.total_amount === 'number' ? data.data.total_amount : subtotal,
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

  // Um pagamento (Pix ou cartão) foi confirmado no modal: se havia pedido segurado, ele já foi pra cozinha.
  function handlePagamentoConfirmado() {
    setPedidoAguardandoPagamento(function (p) { return p && !p.pago ? Object.assign({}, p, { pago: true }) : p; });
  }

  function handleNovoPedido() {
    setPedidoAguardandoPagamento(null);
    setPedidoConfirmado(false);
    setNumeroPedido('');
    setConfirmedCartItems([]);
    setErrorMsg('');
    setStep('cardapio');
  }

  function handleFecharComprovante() {
    clearPixMemo(qrToken || '');
    setComprovante(null);
    // Recarrega para abrir uma sessão nova da mesa (a anterior foi encerrada ao zerar a conta)
    window.location.reload();
  }

  // ── Valores derivados ───────────────────────────────────────────────────────

  const totalItens = cart.reduce(function (s, i) { return s + i.quantidade; }, 0);
  const totalValor = cart.reduce(function (s, i) { return s + i.precoTotal * i.quantidade; }, 0);

  return {
    clubeSel,
    setClubeSel,
    descontoConfirmado,
    step: step,
    tenantId: tenantId,
    table: table,
    participant: participant,
    error: errorMsg,
    tenantName: tenantName,
    logoUrl: logoUrl,
    capaUrl: capaUrl,
    corLoja: corLoja,
    capaPosicao: capaPosicao,
    nomeSalvo: lerNomeSalvo(),
    garantirParticipante: garantirParticipante,
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
    showPagarConta: showPagarConta,
    comprovante: comprovante,
    pedidoAguardandoPagamento: pedidoAguardandoPagamento,
    handlePagamentoConfirmado: handlePagamentoConfirmado,
    queueMode: queueMode,
    qrToken: qrToken || '',
    handleFecharComprovante: handleFecharComprovante,
    onlinePayEnabled: onlinePayEnabled,
    totalItens: totalItens,
    totalValor: totalValor,
    confirmedCartItems: confirmedCartItems,
    setCategoriaAtiva: setCategoriaAtiva,
    setShowCart: setShowCart,
    setShowMeusPedidos: setShowMeusPedidos,
    setShowPagarConta: setShowPagarConta,
    handleIdentificar: handleIdentificar,
    handleAdicionar: handleAdicionar,
    handleAlterarQtd: handleAlterarQtd,
    handleRemover: handleRemover,
    handleEsvaziarSacola: handleEsvaziarSacola,
    handleAbrirEdicao: handleAbrirEdicao,
    handleSalvarEdicao: handleSalvarEdicao,
    handleFecharEdicao: handleFecharEdicao,
    handleConfirmarPedido: handleConfirmarPedido,
    handleNovoPedido: handleNovoPedido,
    setError: setErrorMsg,
  };
}