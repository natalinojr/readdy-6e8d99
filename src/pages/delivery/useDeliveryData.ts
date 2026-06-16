import { useState, useEffect, useRef, type MutableRefObject } from 'react';
import { supabase } from '@/lib/supabase';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type TenantInfo = {
  id: string;
  name: string;
};

type Neighborhood = {
  id: string;
  name: string;
  delivery_fee: number;
};

type DeliveryCustomer = {
  id: string;
  phone: string;
  name: string;
  neighborhood_id: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  reference_point: string | null;
  last_used_at: string;
  delivery_neighborhoods?: Neighborhood | null;
};

export type SavedAddress = {
  id: string;
  label: string;
  neighborhood_id: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  reference_point: string | null;
  is_default: boolean;
  neighborhood_name: string | null;
  neighborhood_delivery_fee: number;
  neighborhood_is_active: boolean;
  lat: number | null;
  lng: number | null;
  bairro: string | null;
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
  opcoes: { grupoNome: string; opcaoNome: string; precoAdicional: number; opcaoId?: string; obrigatorio?: boolean }[];
  observacoes: string[];
  observacaoLivre: string;
  skipKds: boolean;
  stationId: string | null;
  subproducao?: Array<{ nome: string; estacaoId: string }>;
};

type Step = 'loading' | 'identificacao' | 'modo_entrega' | 'endereco' | 'cardapio' | 'confirmacao' | 'erro_config';

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

type ProductionPart = {
  name: string;
  station_id: string;
};

type ProductionPartsMap = Record<string, ProductionPart[]>;

const DESTAQUES_CATEGORY_ID = '__destaques__';

function mergeHighlightsIntoCardapio(
  categories: CardapioCategory[],
  items: CardapioItem[],
  highlights: Highlight[],
): { categories: CardapioCategory[]; items: CardapioItem[] } {
  if (!highlights || highlights.length === 0) {
    return { categories, items };
  }

  const destaquesCategory: CardapioCategory = {
    id: DESTAQUES_CATEGORY_ID,
    name: '⭐ Destaques',
    order_index: -1,
    station_id: null,
  };

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

function getDeliveryWriteUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/delivery-write';
}

// ── Entrega por distância (pin + faixas) ───────────────────────────────────────

type StoreLocation = { lat: number; lng: number };

export type FaixaEntrega = {
  ate_km: number;        // distância máxima da faixa (km)
  taxa: number;          // taxa de entrega (R$)
  tempo_max_min: number; // tempo máximo de entrega da faixa (min)
};

export type DeliveryQuote = {
  km: number;            // distância estimada (km, já com fator de via)
  taxa: number;          // taxa da faixa correspondente (R$)
  tempoMax: number;      // tempo máximo da faixa (min)
  dentroArea: boolean;   // false → além da última faixa (pedido bloqueado)
};

// A reta (haversine) subestima a distância de rua. Aplicamos um fator de via para
// a ESTIMATIVA não ficar abaixo da taxa real (que virá da rota ORS na Fase 3).
const ROAD_FACTOR = 1.3;

const PIN_STORAGE_KEY = 'delivery_pin';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // raio da Terra em km
  const toRad = function (d: number) { return (d * Math.PI) / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Mapeia uma distância (km) para a faixa configurada. Retorna dentroArea=false se além da última faixa. */
function quoteFromTiers(km: number, tiers: FaixaEntrega[]): DeliveryQuote | null {
  if (!tiers || tiers.length === 0) return null;
  const sorted = tiers.slice().sort(function (a, b) { return a.ate_km - b.ate_km; });
  for (const t of sorted) {
    if (km <= t.ate_km) {
      return { km, taxa: t.taxa, tempoMax: t.tempo_max_min, dentroArea: true };
    }
  }
  const last = sorted[sorted.length - 1];
  return { km, taxa: last.taxa, tempoMax: last.tempo_max_min, dentroArea: false };
}

function loadStoredPin(): { lat: number; lng: number } | null {
  try {
    const raw = localStorage.getItem(PIN_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.lat === 'number' && typeof p?.lng === 'number') return { lat: p.lat, lng: p.lng };
  } catch (_e) { /* ignora */ }
  return null;
}

// ── Resolve slug → tenant_id localmente (bypass edge function deploy issues) ──

async function resolveTenantIdBySlug(slug: string): Promise<string | null> {
  // Abordagem 1: Supabase JS client (normal)
  try {
    const { data, error } = await supabase
      .from('tenants')
      .select('id, slug, is_active')
      .eq('slug', slug)
      .maybeSingle();

    if (!error && data?.id) {
      console.log('[useDeliveryData] resolveTenantIdBySlug: SUCCESS via JS client — slug:', slug, 'id:', data.id);
      return data.id;
    }

    if (error) {
      console.warn('[useDeliveryData] resolveTenantIdBySlug JS client error:', error.message);
    }
  } catch (err) {
    console.warn('[useDeliveryData] resolveTenantIdBySlug JS client exception:', err);
  }

  // Abordagem 2: REST API direta (bypassa o client JS e possiveis problemas de auth/sessao)
  // Usa Authorization Bearer com anon key para garantir acesso anonimo
  try {
    const supabaseUrl = import.meta.env.VITE_PUBLIC_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string;
    const rawUrl = supabaseUrl.replace(/\/$/, '') + '/rest/v1/tenants?select=id&slug=eq.' + encodeURIComponent(slug) + '&limit=1';

    const rawRes = await fetch(rawUrl, {
      headers: {
        'apikey': anonKey,
        'Authorization': 'Bearer ' + anonKey,
        'Content-Type': 'application/json',
      },
    });

    if (rawRes.ok) {
      const rawData = await rawRes.json();
      if (Array.isArray(rawData) && rawData.length > 0 && rawData[0].id) {
        console.log('[useDeliveryData] resolveTenantIdBySlug: SUCCESS via REST API — slug:', slug, 'id:', rawData[0].id);
        return rawData[0].id;
      }
    } else {
      console.warn('[useDeliveryData] resolveTenantIdBySlug REST API failed:', rawRes.status, rawRes.statusText);
    }
  } catch (err) {
    console.warn('[useDeliveryData] resolveTenantIdBySlug REST API exception:', err);
  }

  console.warn('[useDeliveryData] resolveTenantIdBySlug: ALL approaches failed for slug:', slug);
  return null;
}

async function fetchDeliveryConfig(
  storeSlug: string | undefined,
  setters: {
    setTenant: (v: TenantInfo) => void;
    setCity: (v: string) => void;
    setNeighborhoods: (v: Neighborhood[]) => void;
    setCategories: (v: CardapioCategory[]) => void;
    setItems: (v: CardapioItem[]) => void;
    setOptionGroups: (v: OptionGroup[]) => void;
    setOptions: (v: OptionItem[]) => void;
    setObservations: (v: PresetObservation[]) => void;
    setOutOfStockIds: (v: string[]) => void;
    setOpcoesIndisponiveisIds: (v: string[]) => void;
    setCategoriaAtiva: (v: string | null) => void;
    setDeliveryFee: (v: number) => void;
    setPaymentMethods: (v: Record<string, boolean>) => void;
    setRetiradaAtivo: (v: boolean) => void;
    setStoreWhatsapp: (v: string) => void;
    setStoreLocation: (v: StoreLocation | null) => void;
    setTiers: (v: FaixaEntrega[]) => void;
    productionPartsRef: MutableRefObject<ProductionPartsMap | undefined>;
  },
) {
  const url = getDeliveryWriteUrl();
  try {
    // ── Resolve slug → tenant_id localmente ANTES de chamar a edge function ──
    let resolvedTenantId: string | null = null;
    if (storeSlug) {
      resolvedTenantId = await resolveTenantIdBySlug(storeSlug);
      console.log('[useDeliveryData] slug:', storeSlug, '→ tenantId:', resolvedTenantId);
    }

    // Monta payload: se temos tenant_id resolvido, manda APENAS tenant_id (sem store_slug)
    // Isso elimina qualquer chance de fallback no edge function
    const payload: Record<string, unknown> = { action: 'get_delivery_config' };
    if (resolvedTenantId) {
      payload.tenant_id = resolvedTenantId;
      console.log('[useDeliveryData] calling edge function with tenant_id ONLY:', resolvedTenantId);
    } else if (storeSlug) {
      payload.store_slug = storeSlug;
      payload.tenant_id = null;
      console.log('[useDeliveryData] calling edge function with store_slug ONLY:', storeSlug);
    } else {
      payload.store_slug = null;
      payload.tenant_id = null;
      console.log('[useDeliveryData] calling edge function with NO tenant/slug (fallback mode)');
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.message || data.error);

    setters.setTenant(data.tenant);
    setters.setCity(data.city || '');
    setters.setNeighborhoods(data.neighborhoods || []);

    const merged = mergeHighlightsIntoCardapio(
      data.categories || [],
      data.items || [],
      data.highlights || [],
    );

    setters.setCategories(merged.categories);
    setters.setItems(merged.items);

    // Merge promotions into items
    const allPromotions: Promotion[] = data.promotions || [];
    const mergedItemsWithPromos = merged.items.map(function (item) {
      return Object.assign({}, item, {
        promotions: allPromotions.filter(function (p) { return p.item_id === item.id; }),
      });
    });
    setters.setItems(mergedItemsWithPromos);

    setters.setOptionGroups(data.option_groups || []);
    setters.setOptions(data.options || []);
    setters.setObservations(data.observations || []);
    setters.setOutOfStockIds(data.out_of_stock_ids || []);
    setters.setOpcoesIndisponiveisIds(data.opcoes_indisponiveis_ids || []);

    if (data.production_parts) {
      setters.productionPartsRef.current = data.production_parts;
    }

    const dc = data.delivery_config || {};
    const fp = dc.formas_pagamento;
    if (fp && typeof fp === 'object') {
      setters.setPaymentMethods(fp as Record<string, boolean>);
    }

    const ra = dc.retirada_ativo;
    setters.setRetiradaAtivo(ra !== false);

    const ws = dc.whatsapp_loja;
    setters.setStoreWhatsapp((typeof ws === 'string' || typeof ws === 'number') ? String(ws) : '');

    // Entrega por distância: localização da loja + faixas (km → taxa/tempo)
    const sl = dc.store_location;
    if (sl && typeof sl === 'object' && typeof sl.lat === 'number' && typeof sl.lng === 'number') {
      setters.setStoreLocation({ lat: sl.lat, lng: sl.lng });
    } else {
      setters.setStoreLocation(null);
    }
    const rawTiers = dc.delivery_fee_tiers;
    if (Array.isArray(rawTiers)) {
      setters.setTiers(rawTiers.map(function (t: any) {
        return {
          ate_km: Number(t.ate_km) || 0,
          taxa: Number(t.taxa) || 0,
          tempo_max_min: Number(t.tempo_max_min) || 0,
        };
      }).filter(function (t: FaixaEntrega) { return t.ate_km > 0; }));
    } else {
      setters.setTiers([]);
    }

    if (merged.categories && merged.categories.length > 0) {
      setters.setCategoriaAtiva(merged.categories[0].id);
    }

    const hoods: Neighborhood[] = data.neighborhoods || [];
    if (hoods.length > 0) {
      setters.setDeliveryFee(hoods[0].delivery_fee);
    }

    return { tenant: data.tenant as TenantInfo, retiradaAtivo: ra !== false };
  } catch (err) {
    throw err;
  }
}

function applyAddressToFields(addr: SavedAddress, setters: {
  setSelectedNeighborhoodId: (v: string) => void;
  setStreet: (v: string) => void;
  setAddressNumber: (v: string) => void;
  setComplement: (v: string) => void;
  setReferencePoint: (v: string) => void;
  setDeliveryFee: (v: number) => void;
  setAddressPin?: (lat: number, lng: number) => void;
}) {
  if (addr.neighborhood_id) setters.setSelectedNeighborhoodId(addr.neighborhood_id);
  if (addr.street) setters.setStreet(addr.street);
  if (addr.number) setters.setAddressNumber(addr.number);
  if (addr.complement) setters.setComplement(addr.complement);
  if (addr.reference_point) setters.setReferencePoint(addr.reference_point);
  setters.setDeliveryFee(addr.neighborhood_delivery_fee);
  // Modo distância: restaura o pin salvo deste endereço (recalcula taxa/tempo)
  if (setters.setAddressPin && typeof addr.lat === 'number' && typeof addr.lng === 'number') {
    setters.setAddressPin(addr.lat, addr.lng);
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDeliveryData(storeSlug?: string) {
  // Estado geral
  const [step, setStep] = useState<Step>('loading');
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [city, setCity] = useState('');
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  // Cliente
  const [customer, setCustomer] = useState<DeliveryCustomer | null>(null);
  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [selectedNeighborhoodId, setSelectedNeighborhoodId] = useState('');
  const [street, setStreet] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [referencePoint, setReferencePoint] = useState('');
  const [bairro, setBairro] = useState('');

  // Endereços salvos (múltiplos)
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);

  // Cardápio
  const [categories, setCategories] = useState<CardapioCategory[]>([]);
  const [items, setItems] = useState<CardapioItem[]>([]);
  const [optionGroups, setOptionGroups] = useState<OptionGroup[]>([]);
  const [options, setOptions] = useState<OptionItem[]>([]);
  const [observations, setObservations] = useState<PresetObservation[]>([]);
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(null);
  const [outOfStockIds, setOutOfStockIds] = useState<string[]>([]);
  const [opcoesIndisponiveisIds, setOpcoesIndisponiveisIds] = useState<string[]>([]);
  const [deliveryFee, setDeliveryFee] = useState(0);

  // Carrinho
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [pedidoConfirmado, setPedidoConfirmado] = useState(false);
  const [numeroPedido, setNumeroPedido] = useState('');
  const [orderTotal, setOrderTotal] = useState(0);
  const [pagamentoSelecionado, setPagamentoSelecionado] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<Record<string, boolean>>({});
  const [modoEntrega, setModoEntrega] = useState<'entrega' | 'retirada'>('entrega');
  const [retiradaAtivo, setRetiradaAtivo] = useState(true);
  const [storeWhatsapp, setStoreWhatsapp] = useState('');

  // Entrega por distância (pin do cliente + faixas configuradas pela loja)
  const [storeLocation, setStoreLocation] = useState<StoreLocation | null>(null);
  const [tiers, setTiers] = useState<FaixaEntrega[]>([]);
  const [addressLat, setAddressLat] = useState<number | null>(null);
  const [addressLng, setAddressLng] = useState<number | null>(null);

  const initializedRef = useRef(false);
  const prevStoreSlugRef = useRef<string | undefined>(storeSlug);
  const productionPartsRef = useRef<ProductionPartsMap | undefined>();

  // ── Inicializar ──────────────────────────────────────────────────────────────

  useEffect(function () {
    // Re-inicializa se o storeSlug mudar (ex: navegacao entre links de lojas diferentes)
    const slugChanged = prevStoreSlugRef.current !== storeSlug;
    if (initializedRef.current && !slugChanged) return;

    initializedRef.current = true;
    prevStoreSlugRef.current = storeSlug;

    // Reset states para o novo slug
    setStep('loading');
    setErrorMsg('');
    setTenant(null);
    setCity('');
    setNeighborhoods([]);
    setCategories([]);
    setItems([]);
    setOptionGroups([]);
    setOptions([]);
    setObservations([]);
    setOutOfStockIds([]);
    setOpcoesIndisponiveisIds([]);
    setCategoriaAtiva(null);
    setDeliveryFee(0);
    setPaymentMethods({});
    setRetiradaAtivo(true);
    setStoreWhatsapp('');
    setCustomer(null);
    setPhone('');
    setCustomerName('');
    setSelectedNeighborhoodId('');
    setStreet('');
    setAddressNumber('');
    setComplement('');
    setReferencePoint('');
    setBairro('');
    setSavedAddresses([]);
    setSelectedAddressId(null);
    setCart([]);
    setEditingItem(null);
    setShowCart(false);
    setPedidoConfirmado(false);
    setNumeroPedido('');
    setOrderTotal(0);
    setPagamentoSelecionado('');
    setModoEntrega('entrega');
    setStoreLocation(null);
    setTiers([]);
    setEnderecoFromCardapio(false);

    // Restaura o último pin marcado neste dispositivo (pin é por aparelho, não por bairro)
    const storedPin = loadStoredPin();
    setAddressLat(storedPin ? storedPin.lat : null);
    setAddressLng(storedPin ? storedPin.lng : null);

    let cancelled = false;

    async function init() {
      try {
        const configResult = await fetchDeliveryConfig(storeSlug, {
          setTenant,
          setCity,
          setNeighborhoods,
          setCategories,
          setItems,
          setOptionGroups,
          setOptions,
          setObservations,
          setOutOfStockIds,
          setOpcoesIndisponiveisIds,
          setCategoriaAtiva,
          setDeliveryFee,
          setPaymentMethods,
          setRetiradaAtivo,
          setStoreWhatsapp,
          setStoreLocation,
          setTiers,
          productionPartsRef,
        });

        if (cancelled) return;

        const savedPhone = localStorage.getItem('delivery_phone');
        if (savedPhone && configResult) {
          setPhone(savedPhone);

          // Busca cliente automaticamente — se já tem cadastro, pula direto pro cardápio ou endereço
          try {
            const url = getDeliveryWriteUrl();
            const lookupRes = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'lookup_customer', phone: savedPhone, tenant_id: configResult.tenant.id }),
            });
            const lookupData = await lookupRes.json();

            if (cancelled) return;

            if (lookupData.customer) {
              const c = lookupData.customer;
              setCustomer(c);
              setCustomerName(c.name);
              setPhone(c.phone);

              const addresses = lookupData.addresses || [];
              setSavedAddresses(addresses);

              if (addresses.length > 0) {
                const defaultAddr = addresses.find(function (a) { return a.is_default; }) || addresses[0];
                setSelectedAddressId(defaultAddr.id);
                applyAddressToFields(defaultAddr, {
                  setSelectedNeighborhoodId,
                  setStreet,
                  setAddressNumber,
                  setComplement,
                  setReferencePoint,
                  setDeliveryFee,
                });
              } else {
                setSelectedAddressId(null);
                if (c.neighborhood_id) setSelectedNeighborhoodId(c.neighborhood_id);
                if (c.street) setStreet(c.street);
                if (c.number) setAddressNumber(c.number);
                if (c.complement) setComplement(c.complement);
                if (c.reference_point) setReferencePoint(c.reference_point);
                if (c.delivery_neighborhoods) {
                  setDeliveryFee(c.delivery_neighborhoods.delivery_fee);
                }
              }

              localStorage.setItem('delivery_phone', c.phone);

              const temEndereco = addresses.length > 0 || (c.neighborhood_id && c.street);

              if (temEndereco) {
                // Já tem endereço — vai direto pro cardápio ou modo de entrega
                if (!configResult.retiradaAtivo) {
                  setStep('cardapio');
                } else {
                  setStep('modo_entrega');
                }
              } else {
                // Não tem endereço nenhum — vai pro preenchimento
                if (!configResult.retiradaAtivo) {
                  setStep('endereco');
                } else {
                  setStep('modo_entrega');
                }
              }
              return;
            }
          } catch (_err) {
            // Se falhar a busca automática, cai na tela de identificação
          }
        }

        setStep('identificacao');
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Erro ao carregar configuração');
          setStep('erro_config');
        }
      }
    }

    init();

    return function () { cancelled = true; };
  }, [storeSlug]);

  // ── Buscar cliente por telefone ──────────────────────────────────────────────

  function handleLookupCustomer(p: string) {
    if (!tenant) return;
    const url = getDeliveryWriteUrl();

    setEnviando(true);
    setErrorMsg('');

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lookup_customer', phone: p, tenant_id: tenant.id }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        setEnviando(false);
        if (data.error) {
          setErrorMsg(data.message || data.error);
          return;
        }
        if (data.customer) {
          const c: DeliveryCustomer = data.customer;
          setCustomer(c);
          setCustomerName(c.name);
          setPhone(c.phone);

          // Carrega endereços salvos
          const addresses: SavedAddress[] = data.addresses || [];
          setSavedAddresses(addresses);

          if (addresses.length > 0) {
            // Seleciona o default ou o primeiro
            const defaultAddr = addresses.find(function (a) { return a.is_default; }) || addresses[0];
            setSelectedAddressId(defaultAddr.id);
            applyAddressToFields(defaultAddr, {
              setSelectedNeighborhoodId,
              setStreet,
              setAddressNumber,
              setComplement,
              setReferencePoint,
              setDeliveryFee,
            });
          } else {
            setSelectedAddressId(null);
            if (c.neighborhood_id) setSelectedNeighborhoodId(c.neighborhood_id);
            if (c.street) setStreet(c.street);
            if (c.number) setAddressNumber(c.number);
            if (c.complement) setComplement(c.complement);
            if (c.reference_point) setReferencePoint(c.reference_point);
            if (c.delivery_neighborhoods) {
              setDeliveryFee(c.delivery_neighborhoods.delivery_fee);
            }
          }

          localStorage.setItem('delivery_phone', c.phone);
          if (!retiradaAtivo) {
            setStep('cardapio');
          } else {
            setStep('modo_entrega');
          }
        } else {
          setCustomer(null);
          setCustomerName('');
          setSelectedNeighborhoodId('');
          setStreet('');
          setAddressNumber('');
          setComplement('');
          setReferencePoint('');
          setSavedAddresses([]);
          setSelectedAddressId(null);
          setPhone(p);
          if (!retiradaAtivo) {
            setStep('endereco');
          } else {
            setStep('modo_entrega');
          }
        }
      })
      .catch(function () {
        setEnviando(false);
        setErrorMsg('Erro de conexão. Tente novamente.');
      });
  }

  // ── Salvar endereço e avançar ───────────────────────────────────────────────

  function handleSalvarEndereco(nome: string, bairroId: string, rua: string, num: string, comp: string, ref: string) {
    if (!tenant) return;

    setEnviando(true);
    setErrorMsg('');

    const url = getDeliveryWriteUrl();
    const cleanPhone = phone.replace(/\D/g, '');

    const nb = neighborhoods.find(function (n) { return n.id === bairroId; });
    if (nb) setDeliveryFee(nb.delivery_fee);

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save_customer',
        tenant_id: tenant.id,
        phone: cleanPhone,
        name: nome.trim(),
        neighborhood_id: bairroId || null,
        street: rua.trim() || null,
        number: num.trim() || null,
        complement: comp.trim() || null,
        reference_point: ref.trim() || null,
        bairro: bairro.trim() || null,
        address_lat: addressLat,
        address_lng: addressLng,
      }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        setEnviando(false);
        if (data.error) {
          setErrorMsg(data.message || data.error);
          return;
        }
        const c: DeliveryCustomer = data.customer;
        setCustomer(c);
        setCustomerName(c.name);
        setPhone(c.phone);
        if (c.neighborhood_id) setSelectedNeighborhoodId(c.neighborhood_id);
        if (c.street) setStreet(c.street);
        if (c.number) setAddressNumber(c.number);
        if (c.complement) setComplement(c.complement);
        if (c.reference_point) setReferencePoint(c.reference_point);

        // Atualiza endereços salvos
        const addresses: SavedAddress[] = data.addresses || [];
        setSavedAddresses(addresses);
        if (addresses.length > 0) {
          setSelectedAddressId(addresses[addresses.length - 1].id);
        }

        localStorage.setItem('delivery_phone', c.phone);
        setStep('cardapio');
      })
      .catch(function () {
        setEnviando(false);
        setErrorMsg('Erro de conexão. Tente novamente.');
      });
  }

  // ── Selecionar endereço salvo ───────────────────────────────────────────────

  function handleSelecionarEndereco(addressId: string) {
    // Endereço legado — já está nos campos do customer
    if (addressId === '__legacy__') {
      setSelectedAddressId('__legacy__');
      return;
    }

    const addr = savedAddresses.find(function (a) { return a.id === addressId; });
    if (!addr) return;

    setSelectedAddressId(addressId);
    setSelectedNeighborhoodId('');
    setStreet('');
    setAddressNumber('');
    setComplement('');
    setReferencePoint('');

    applyAddressToFields(addr, {
      setSelectedNeighborhoodId,
      setStreet,
      setAddressNumber,
      setComplement,
      setReferencePoint,
      setDeliveryFee,
    });
  }

  // ── Salvar novo endereço (a partir da lista) ─────────────────────────────────

  function handleSalvarNovoEndereco(
    label: string,
    bairroId: string,
    rua: string,
    num: string,
    comp: string,
    ref: string,
    editAddressId?: string | null,
    lat?: number | null,
    lng?: number | null,
  ): Promise<void> {
    return new Promise(function (resolve, reject) {
      if (!tenant || !customer) {
        reject(new Error('Cliente não encontrado'));
        return;
      }

      setEnviando(true);
      setErrorMsg('');

      const url = getDeliveryWriteUrl();

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_customer_address',
          tenant_id: tenant.id,
          customer_id: customer.id,
          address_id: editAddressId || null,
          label: label.trim(),
          neighborhood_id: bairroId || null,
          street: rua.trim() || null,
          number: num.trim() || null,
          complement: comp.trim() || null,
          reference_point: ref.trim() || null,
          bairro: bairro.trim() || null,
          address_lat: lat ?? null,
          address_lng: lng ?? null,
        }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          setEnviando(false);
          if (data.error) {
            setErrorMsg(data.message || data.error);
            reject(new Error(data.message || data.error));
            return;
          }
          const addresses: SavedAddress[] = data.addresses || [];
          setSavedAddresses(addresses);

          if (!editAddressId && addresses.length > 0) {
            const newAddr = addresses[addresses.length - 1];
            setSelectedAddressId(newAddr.id);
            applyAddressToFields(newAddr, {
              setSelectedNeighborhoodId,
              setStreet,
              setAddressNumber,
              setComplement,
              setReferencePoint,
              setDeliveryFee,
            });
          }
          resolve();
        })
        .catch(function (err) {
          setEnviando(false);
          setErrorMsg('Erro de conexão. Tente novamente.');
          reject(err);
        });
    });
  }

  // ── Deletar endereço ────────────────────────────────────────────────────────

  function handleDeletarEndereco(addressId: string) {
    if (!tenant || !customer) return;
    if (savedAddresses.length <= 1) return; // não deixa deletar o último

    setEnviando(true);
    setErrorMsg('');

    const url = getDeliveryWriteUrl();

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete_customer_address',
        tenant_id: tenant.id,
        customer_id: customer.id,
        address_id: addressId,
      }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        setEnviando(false);
        if (data.error) {
          setErrorMsg(data.message || data.error);
          return;
        }
        const addresses: SavedAddress[] = data.addresses || [];
        setSavedAddresses(addresses);

        // Se deletou o selecionado, seleciona o default
        if (selectedAddressId === addressId && addresses.length > 0) {
          const defaultAddr = addresses.find(function (a) { return a.is_default; }) || addresses[0];
          setSelectedAddressId(defaultAddr.id);
          applyAddressToFields(defaultAddr, {
            setSelectedNeighborhoodId,
            setStreet,
            setAddressNumber,
            setComplement,
            setReferencePoint,
            setDeliveryFee,
          });
        }
      })
      .catch(function () {
        setEnviando(false);
        setErrorMsg('Erro de conexão. Tente novamente.');
      });
  }

  // ── Definir endereço como principal ──────────────────────────────────────────

  function handleSetDefaultAddress(addressId: string) {
    if (!tenant || !customer) return;

    setEnviando(true);
    setErrorMsg('');

    const url = getDeliveryWriteUrl();

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set_default_address',
        tenant_id: tenant.id,
        customer_id: customer.id,
        address_id: addressId,
      }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        setEnviando(false);
        if (data.error) {
          setErrorMsg(data.message || data.error);
          return;
        }
        const addresses: SavedAddress[] = data.addresses || [];
        setSavedAddresses(addresses);

        // Seleciona o novo default automaticamente
        const defaultAddr = addresses.find(function (a) { return a.is_default; });
        if (defaultAddr) {
          setSelectedAddressId(defaultAddr.id);
          applyAddressToFields(defaultAddr, {
            setSelectedNeighborhoodId,
            setStreet,
            setAddressNumber,
            setComplement,
            setReferencePoint,
            setDeliveryFee,
          });
        }
      })
      .catch(function () {
        setEnviando(false);
        setErrorMsg('Erro de conexão. Tente novamente.');
      });
  }

  // Navegar para tela de endereços (a partir do cardápio)
  const [enderecoFromCardapio, setEnderecoFromCardapio] = useState(false);

  // ── Navegar para tela de endereços ──────────────────────────────────────────

  function handleIrParaEnderecos() {
    setEnderecoFromCardapio(true);
    setStep('endereco');
  }

  // ── Confirmar modo de entrega ────────────────────────────────────────────────

  function handleConfirmarModo(modo: 'entrega' | 'retirada') {
    setModoEntrega(modo);
    setEnderecoFromCardapio(false);

    if (modo === 'retirada') {
      setDeliveryFee(0);

      if (customer) {
        setStep('cardapio');
      } else {
        if (!tenant) return;
        const cleanPhone = phone.replace(/\D/g, '');

        setEnviando(true);
        const url = getDeliveryWriteUrl();
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save_customer',
            tenant_id: tenant.id,
            phone: cleanPhone,
            name: customerName.trim() || 'Cliente Retirada',
            neighborhood_id: null,
            street: null,
            number: null,
            complement: null,
            reference_point: null,
          }),
        })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            setEnviando(false);
            if (data.customer) {
              const c: DeliveryCustomer = data.customer;
              setCustomer(c);
              setCustomerName(c.name);
              localStorage.setItem('delivery_phone', c.phone);
            }
            setStep('cardapio');
          })
          .catch(function () {
            setEnviando(false);
            setStep('cardapio');
          });
      }
    } else {
      // Entrega (delivery)
      if (customer) {
        if (customer.delivery_neighborhoods) {
          setDeliveryFee(customer.delivery_neighborhoods.delivery_fee);
        }

        // Modo distância exige pin marcado (+ texto do endereço); modo bairro mantém o legado
        const temEndereco = distanceMode
          ? (addressLat != null && addressLng != null && !!customer.street)
          : (savedAddresses.length > 0 || (customer.neighborhood_id && customer.street));

        if (temEndereco) {
          // Já tem endereço (salvo ou legado) — vai direto pro cardápio
          setStep('cardapio');
        } else {
          // Não tem endereço nenhum — vai pra tela de endereço
          setStep('endereco');
        }
      } else {
        setStep('endereco');
      }
    }
  }

  // ── Alterar modo de entrega (volta pra escolha) ─────────────────────────────

  function handleAlterarModo() {
    setStep('modo_entrega');
  }

  // ── Carrinho ────────────────────────────────────────────────────────────────

  function handleAdicionar(item: CartItem) {
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
      novo[idx] = { ...novo[idx], quantidade: novaQtd };
      return novo;
    });
  }

  function handleRemover(cartId: string) {
    setCart(function (prev) { return prev.filter(function (c) { return c.cartId !== cartId; }); });
  }

  function handleAbrirEdicao(cartId: string) {
    const item = cart.find(function (c) { return c.cartId === cartId; });
    if (item) setEditingItem(item);
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

  // ── Confirmar pedido ─────────────────────────────────────────────────────────

  function handleConfirmarPedido(paymentMethod?: string, cashAmount?: string) {
    if (!tenant) { setErrorMsg('Erro ao carregar a loja. Recarregue a página.'); return; }
    if (!customer) { setErrorMsg('Não identificamos seu cadastro. Toque em "Trocar" e confirme seu telefone novamente.'); return; }
    if (cart.length === 0) return;

    // Modo distância: bloqueia se fora da área de entrega (sem pin ou além da última faixa)
    if (foraDeArea) {
      setErrorMsg(addressLat == null
        ? 'Marque sua localização no mapa para calcular a entrega.'
        : 'Endereço fora da área de entrega desta loja.');
      return;
    }

    setEnviando(true);
    setErrorMsg('');

    const methodLabel = paymentMethod || 'Não informado';
    const methodMap: Record<string, string> = {
      dinheiro: 'Dinheiro',
      cartao_credito: 'Cartão de Crédito',
      cartao_debito: 'Cartão de Débito',
      pix: 'PIX',
      vale_refeicao: 'Vale Refeição',
    };
    const methodName = methodMap[methodLabel] || methodLabel;
    setPagamentoSelecionado(methodName);

    const cashAmountNum = cashAmount ? parseFloat(cashAmount) : 0;

    const url = getDeliveryWriteUrl();
    const subtotal = cart.reduce(function (s, i) { return s + i.precoTotal * i.quantidade; }, 0);
    const total = subtotal + effectiveDeliveryFee;

    const enderecoParts: string[] = [];
    if (street) enderecoParts.push(street);
    if (addressNumber) enderecoParts.push(addressNumber);
    if (complement) enderecoParts.push('(' + complement + ')');
    const bairroName = bairro.trim() || (neighborhoods.find(function (n) { return n.id === selectedNeighborhoodId; })?.name || '');
    if (bairroName) enderecoParts.push('- ' + bairroName);
    if (city) enderecoParts.push('- ' + city);
    if (referencePoint.trim()) enderecoParts.push('(Ref: ' + referencePoint.trim() + ')');
    const endereco = enderecoParts.join(' ') || 'Endereço não informado';

    const itemsPayload = cart.map(function (ci) {
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

    const clientRequestId = crypto.randomUUID();

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_delivery_order',
        tenant_id: tenant.id,
        customer_id: customer.id,
        customer_name: customerName,
        customer_phone: phone,
        customer_address: endereco,
        neighborhood_name: bairroName,
        neighborhood_id: selectedNeighborhoodId,
        delivery_fee: effectiveDeliveryFee,
        // Pin do cliente + distância estimada (Fase 3: backend recalcula via rota ORS)
        address_lat: addressLat,
        address_lng: addressLng,
        distance_km: deliveryQuote ? Number(deliveryQuote.km.toFixed(2)) : null,
        items: itemsPayload,
        subtotal: subtotal,
        total_amount: total,
        notes: '',
        payment_method: methodName,
        cash_amount: cashAmountNum > 0 ? cashAmountNum : undefined,
        order_type: modoEntrega,
        client_request_id: clientRequestId,
      }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          setErrorMsg(data.message || data.error);
          setEnviando(false);
          return;
        }
        setNumeroPedido(data.data?.number || '');
        setOrderTotal(data.data?.total || total);
        setPedidoConfirmado(true);
        setCart([]);
        setShowCart(false);
        setEnviando(false);
        setStep('confirmacao');
      })
      .catch(function () {
        setEnviando(false);
        setErrorMsg('Erro de conexão. Tente novamente.');
      });
  }

  // ── Novo pedido ─────────────────────────────────────────────────────────────

  function handleNovoPedido() {
    setPedidoConfirmado(false);
    setNumeroPedido('');
    setErrorMsg('');
    setEnderecoFromCardapio(false);
    setStep('cardapio');
  }

  // ── Mudar bairro (no checkout) ──────────────────────────────────────────────

  function handleChangeNeighborhood(neighborhoodId: string) {
    setSelectedNeighborhoodId(neighborhoodId);
    const nb = neighborhoods.find(function (n) { return n.id === neighborhoodId; });
    if (nb) setDeliveryFee(nb.delivery_fee);
  }

  // ── Pin do cliente (entrega por distância) ──────────────────────────────────

  function setAddressPin(lat: number, lng: number) {
    setAddressLat(lat);
    setAddressLng(lng);
    try {
      localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify({ lat, lng }));
    } catch (_e) { /* ignora */ }
  }

  // ── Valores derivados ───────────────────────────────────────────────────────

  // distanceMode = a loja configurou localização + faixas de distância (Fase 1).
  // Quando ativo, a taxa vem do PIN (não do bairro). Senão, mantém o fluxo legado de bairro.
  const distanceMode = storeLocation != null && tiers.length > 0;

  const deliveryQuote: DeliveryQuote | null = (distanceMode && storeLocation && addressLat != null && addressLng != null)
    ? quoteFromTiers(haversineKm(storeLocation.lat, storeLocation.lng, addressLat, addressLng) * ROAD_FACTOR, tiers)
    : null;

  // Pedido bloqueado: modo distância + entrega + (sem pin ou além da última faixa)
  const foraDeArea = distanceMode && modoEntrega === 'entrega'
    && (deliveryQuote == null || !deliveryQuote.dentroArea);

  // Taxa efetiva: no modo distância vem da faixa do pin; senão, do bairro (estado deliveryFee)
  const effectiveDeliveryFee = modoEntrega === 'retirada'
    ? 0
    : distanceMode
      ? (deliveryQuote && deliveryQuote.dentroArea ? deliveryQuote.taxa : 0)
      : deliveryFee;

  // Modo distância: ao (re)selecionar um endereço salvo, restaura o pin dele e recalcula a taxa.
  useEffect(function () {
    if (!distanceMode || !selectedAddressId) return;
    const addr = savedAddresses.find(function (a) { return a.id === selectedAddressId; });
    if (!addr) return;
    if (typeof addr.lat === 'number' && typeof addr.lng === 'number') {
      setAddressLat(addr.lat);
      setAddressLng(addr.lng);
    }
    setBairro(addr.bairro || '');
  }, [selectedAddressId, savedAddresses, distanceMode]);

  const totalItens = cart.reduce(function (s, i) { return s + i.quantidade; }, 0);
  const totalItensProdutos = cart.reduce(function (s, i) { return s + i.precoTotal * i.quantidade; }, 0);
  const totalValor = totalItensProdutos + effectiveDeliveryFee;
  const bairroAtual = neighborhoods.find(function (n) { return n.id === selectedNeighborhoodId; });
  const tenantId = tenant?.id || '';
  const customerId = customer?.id || '';

  // Lista unificada: endereços salvos + legado (se não houver salvos)
  const displayAddresses: SavedAddress[] = savedAddresses.length > 0
    ? savedAddresses
    : (customer && customer.neighborhood_id && customer.street)
      ? [{
          id: '__legacy__',
          label: 'Meu endereço',
          neighborhood_id: customer.neighborhood_id,
          street: customer.street,
          number: customer.number,
          complement: customer.complement,
          reference_point: customer.reference_point,
          is_default: true,
          neighborhood_name: customer.delivery_neighborhoods?.name || null,
          neighborhood_delivery_fee: customer.delivery_neighborhoods?.delivery_fee || 0,
          neighborhood_is_active: true,
          lat: null,
          lng: null,
          bairro: null,
        }]
      : [];

  // Endereço atualmente selecionado (para label)
  const enderecoAtual = selectedAddressId
    ? displayAddresses.find(function (a) { return a.id === selectedAddressId; }) || null
    : null;

  return {
    step,
    setStep,
    tenant,
    tenantId,
    city,
    neighborhoods,
    error: errorMsg,
    customer,
    customerId,
    phone,
    customerName,
    selectedNeighborhoodId,
    street,
    addressNumber,
    complement,
    referencePoint,
    bairroAtual,
    savedAddresses,
    displayAddresses,
    selectedAddressId,
    enderecoAtual,
    categories,
    items,
    optionGroups,
    options,
    observations,
    categoriaAtiva,
    outOfStockIds,
    opcoesIndisponiveisIds,
    cart,
    editingItem,
    showCart,
    enviando,
    pedidoConfirmado,
    numeroPedido,
    orderTotal,
    deliveryFee: effectiveDeliveryFee,
    totalItens,
    totalItensProdutos,
    totalValor,
    paymentMethods,
    pagamentoSelecionado,
    modoEntrega,
    setModoEntrega,
    retiradaAtivo,
    storeWhatsapp,
    setPhone,
    setCustomerName,
    setSelectedNeighborhoodId,
    setStreet,
    setAddressNumber,
    setComplement,
    setReferencePoint,
    bairro,
    setBairro,
    setCategoriaAtiva,
    setShowCart,
    setError: setErrorMsg,
    handleLookupCustomer,
    handleSalvarEndereco,
    handleSelecionarEndereco,
    handleSalvarNovoEndereco,
    handleDeletarEndereco,
    handleSetDefaultAddress,
    handleIrParaEnderecos,
    handleConfirmarModo,
    handleAlterarModo,
    handleAdicionar,
    handleAlterarQtd,
    handleRemover,
    handleAbrirEdicao,
    handleSalvarEdicao,
    handleFecharEdicao,
    handleConfirmarPedido,
    handleNovoPedido,
    handleChangeNeighborhood,
    enderecoFromCardapio,
    setEnderecoFromCardapio,
    // Entrega por distância (pin)
    distanceMode,
    storeLocation,
    tiers,
    addressLat,
    addressLng,
    setAddressPin,
    deliveryQuote,
    foraDeArea,
  };
}