import { useState, useEffect, useRef, useMemo, type MutableRefObject } from 'react';
import { useMenuPing, comJitter } from '@/hooks/useMenuPing';
import { clubeLimparReservas, type ClubeSelecao } from '@/components/fidelidade/ClubeCheckout';
import { supabase } from '@/lib/supabase';
import { rawPromoAtivaHoje } from '@/lib/promoUtils';
import { loadCart, saveCart } from '@/lib/cartStorage';
import { trackPixel } from '@/lib/metaPixel';
import { formatPhoneBR, readSavedDeliveryPhone, saveDeliveryPhone, clearSavedDeliveryPhone } from '@/lib/deliveryPhone';
import { idsForaDoHorario, normalizarHorario } from '@/lib/horarioExibicao';
import { useRelogioMinuto } from '@/hooks/useRelogioMinuto';
import { COLUNAS_MARCA_LOJA, lerCapasLoja, type CapaLoja } from '@/lib/capasLoja';

// Origem do pedido (campanha): lê utm_source da URL na 1ª visita e persiste na sessão,
// pois o cliente navega vários passos antes de fechar o pedido (a query pode se perder).
// Ex.: link do anúncio no Instagram = ?utm_source=instagram
const ORDER_SRC_KEY = 'erpos_delivery_src';
export function getOrderSource(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('utm_source');
    if (fromUrl && fromUrl.trim()) {
      const v = fromUrl.trim().toLowerCase().slice(0, 40);
      sessionStorage.setItem(ORDER_SRC_KEY, v);
      return v;
    }
    return sessionStorage.getItem(ORDER_SRC_KEY);
  } catch { return null; }
}

// Cupom vindo do link do voucher (?voucher=CODIGO — ex.: botão "Pedir no Delivery"
// da página pública /voucher/:token). Mesmo padrão do utm_source: persiste na
// sessão e é aplicado automaticamente quando o carrinho tiver itens.
const URL_VOUCHER_KEY = 'erpos_delivery_voucher';
export function getUrlVoucher(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('voucher');
    if (fromUrl && fromUrl.trim()) {
      const v = fromUrl.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 30);
      if (v) { sessionStorage.setItem(URL_VOUCHER_KEY, v); return v; }
    }
    return sessionStorage.getItem(URL_VOUCHER_KEY);
  } catch { return null; }
}
function clearUrlVoucher() {
  try { sessionStorage.removeItem(URL_VOUCHER_KEY); } catch { /* noop */ }
}

// Etapa (step) persistida por loja p/ o cliente voltar ONDE PAROU ao retornar do
// segundo plano do navegador (Instagram/WhatsApp costumam descartar a aba). Só
// restauramos as etapas de vitrine ('preview'/'cardapio'), que funcionam sem
// exigir cliente/endereço carregado — evita cair num estado quebrado. Fica em
// sessionStorage (por aba): some quando o cliente fecha de vez, sobrevive à volta.
type ResumableStep = 'preview' | 'cardapio';
const RESUMABLE_STEPS: ResumableStep[] = ['preview', 'cardapio'];
function stepStorageKey(slug?: string): string {
  return 'delivery_step_' + (slug || 'default');
}
function loadSavedStep(slug?: string): ResumableStep | null {
  try {
    const v = sessionStorage.getItem(stepStorageKey(slug));
    return (v && (RESUMABLE_STEPS as string[]).includes(v)) ? (v as ResumableStep) : null;
  } catch { return null; }
}

// ── Visita ao cardápio (carrinho abandonado) ─────────────────────────────────
// Um id por aparelho/loja, guardado em localStorage: a mesma pessoa voltando no
// mesmo dia continua a MESMA visita (senão viraria um "abandono" por reload).
// É um id anônimo — quem identifica de verdade é o telefone, quando digitado.
function visitStorageKey(slug?: string): string {
  return 'delivery_visit_' + (slug || 'default');
}

/** Id da visita atual. Renova depois de 12h paradas — aí já é outra intenção de pedido. */
function getVisitKey(slug?: string): string {
  const key = visitStorageKey(slug);
  const agora = Date.now();
  const MAX_IDLE_MS = 12 * 60 * 60 * 1000;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as { id?: string; at?: number };
      if (parsed && parsed.id && typeof parsed.at === 'number' && (agora - parsed.at) < MAX_IDLE_MS) {
        localStorage.setItem(key, JSON.stringify({ id: parsed.id, at: agora }));
        return parsed.id;
      }
    }
  } catch { /* sem storage: gera um id volátil */ }
  const novo = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : 'v-' + agora.toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  try { localStorage.setItem(key, JSON.stringify({ id: novo, at: agora })); } catch { /* noop */ }
  return novo;
}

/** Encerra a visita (pedido feito): o próximo acesso começa uma visita nova. */
function clearVisitKey(slug?: string): void {
  try { localStorage.removeItem(visitStorageKey(slug)); } catch { /* noop */ }
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

type TenantInfo = {
  id: string;
  name: string;
  /** Logo da loja (Configurações → Dados da Loja). Ausente = mostrar iniciais. */
  logo_url?: string | null;
  cover_url?: string | null;
  brand_color?: string | null;
  cover_position?: string | null;
  /** Fotos de capa (até 10) — já normalizadas, inclusive para lojas só com cover_url */
  capas?: CapaLoja[];
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
  birth_date?: string | null;
  gender?: string | null;
  /** Já aceitou ofertas pelo WhatsApp (lookup_customer): o checkout não pergunta de novo. */
  aceita_ofertas?: boolean;
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
  opcoes: { grupoNome: string; opcaoNome: string; precoAdicional: number; opcaoId?: string; obrigatorio?: boolean }[];
  observacoes: string[];
  observacaoLivre: string;
  skipKds: boolean;
  stationId: string | null;
  subproducao?: Array<{ nome: string; estacaoId: string }>;
};

type Step = 'loading' | 'preview' | 'identificacao' | 'modo_entrega' | 'endereco' | 'cardapio' | 'confirmacao' | 'erro_config';

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

type ProductionPart = {
  name: string;
  station_id: string;
};

type ProductionPartsMap = Record<string, ProductionPart[]>;

const DESTAQUES_CATEGORY_ID = '__destaques__';

/** Horário de funcionamento do delivery (Config › Delivery) e pedido mínimo (0 = sem). */
export interface InfoLoja {
  horario: { enabled?: boolean; days?: Record<string, { open?: string; close?: string; enabled?: boolean }> } | null;
  pedidoMinimo: number;
}
const PROMOCAO_CATEGORY_ID = '__promocao__';

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
  const mergedItemsWithPromos = merged.items.map(function (item) {
    return Object.assign({}, item, {
      promotions: base.promotions.filter(function (p) { return p.item_id === item.id; }),
    });
  });

  // Categoria virtual "Promoção": itens (não-destaque) com promoção válida HOJE.
  const promoItems: typeof mergedItemsWithPromos = mergedItemsWithPromos
    .filter(function (item) {
      return item.category_id !== DESTAQUES_CATEGORY_ID && rawPromoAtivaHoje(item.promotions) != null;
    })
    .map(function (item) { return { ...item, category_id: PROMOCAO_CATEGORY_ID }; });

  let finalCategories = merged.categories;
  let finalItems = mergedItemsWithPromos;
  if (promoItems.length > 0) {
    const promoCategory: CardapioCategory = { id: PROMOCAO_CATEGORY_ID, name: '🔥 Promoção', order_index: -0.5, station_id: null };
    finalCategories = [promoCategory].concat(merged.categories);
    finalItems = promoItems.concat(mergedItemsWithPromos);
  }

  // Não exibir categorias que ficaram sem NENHUM item disponível no delivery.
  // finalItems já vem filtrado pelo backend (itens "só balcão" / delivery desativado
  // são removidos), então uma categoria 100% balcão ficaria vazia — não deve aparecer.
  const catIdsComItens = new Set(finalItems.map(function (it) { return it.category_id; }));
  finalCategories = finalCategories.filter(function (c) { return catIdsComItens.has(c.id); });
  return { categories: finalCategories, items: finalItems };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getDeliveryWriteUrl(): string {
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
    setCardapioBase: (v: CardapioBase | null) => void;
    setOptionGroups: (v: OptionGroup[]) => void;
    setOptions: (v: OptionItem[]) => void;
    setObservations: (v: PresetObservation[]) => void;
    setOutOfStockIds: (v: string[]) => void;
    setOpcoesIndisponiveisIds: (v: string[]) => void;
    setCategoriaAtiva: (v: string | null) => void;
    setDeliveryFee: (v: number) => void;
    setPaymentMethods: (v: Record<string, boolean>) => void;
    setRetiradaAtivo: (v: boolean) => void;
    setDeliveryOpenNow: (v: boolean) => void;
    setDeliveryClosedReason: (v: string | null) => void;
    setStoreWhatsapp: (v: string) => void;
    setStoreLocation: (v: StoreLocation | null) => void;
    setTiers: (v: FaixaEntrega[]) => void;
    setLocales: (v: string[]) => void;
    /** Horário e pedido mínimo — só para mostrar no topo da loja. */
    setInfoLoja?: (v: InfoLoja) => void;
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
    if (data.error) {
      // Códigos crus da edge (ex.: 'delivery_not_configured' sem message) não aparecem para o cliente.
      if (data.error === 'delivery_not_configured') throw new Error('Delivery indisponível no momento.');
      throw new Error(data.message || data.error);
    }

    // Logo da loja (tenants.logo_url) — a edge function não retorna; busca direto
    // via select anônimo (mesma permissão do resolveTenantIdBySlug). Falhou = sem logo,
    // as telas caem no fallback de iniciais.
    // IMPORTANTE: com timeout (2s) — `supabase.from()` passa pelo lock de sessão do
    // supabase-js, que pode TRAVAR (várias abas / volta do background). Sem o timeout,
    // isso prenderia o carregamento do delivery inteiro. Logo é secundário: se demorar, segue sem.
    let tenantInfo: TenantInfo = data.tenant;
    try {
      // Junto com a logo: capa e cor do cardápio online (Configurações › Loja)
      const logoPromise = supabase
        .from('tenants')
        .select(COLUNAS_MARCA_LOJA)
        .eq('id', data.tenant.id)
        .maybeSingle()
        .then(function (r) { return r.data || null; });
      const timeoutPromise = new Promise<null>(function (resolve) {
        setTimeout(function () { resolve(null); }, 2000);
      });
      const marca = await Promise.race([logoPromise, timeoutPromise]) as { logo_url?: string | null; cover_url?: string | null; brand_color?: string | null; cover_position?: string | null; cover_images?: unknown } | null;
      tenantInfo = { ...data.tenant, logo_url: marca?.logo_url || null, cover_url: marca?.cover_url || null, brand_color: marca?.brand_color || null, cover_position: marca?.cover_position || null, capas: lerCapasLoja(marca) };
    } catch (_e) { /* segue sem logo */ }

    setters.setTenant(tenantInfo);
    setters.setCity(data.city || '');
    setters.setNeighborhoods(data.neighborhoods || []);

    const base: CardapioBase = {
      categories: data.categories || [],
      items: data.items || [],
      highlights: data.highlights || [],
      promotions: data.promotions || [],
    };
    setters.setCardapioBase(base);
    const finalCategories = montarCardapio(base, new Set(idsForaDoHorario(base, 'delivery'))).categories;
    setters.setLocales(Array.isArray(data.locales) ? data.locales : []);

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

    // Estado de abertura do delivery (sessão + pausa + agenda + manual), calculado no backend.
    setters.setDeliveryOpenNow(data.delivery_open_now !== false);
    setters.setDeliveryClosedReason(data.delivery_closed_reason ?? null);

    if (setters.setInfoLoja) {
      setters.setInfoLoja({
        horario: (dc.delivery_schedule && typeof dc.delivery_schedule === 'object') ? dc.delivery_schedule : null,
        pedidoMinimo: dc.pedido_minimo_ativo ? (Number(dc.pedido_minimo_valor) || 0) : 0,
      });
    }

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

    if (finalCategories && finalCategories.length > 0) {
      setters.setCategoriaAtiva(finalCategories[0].id);
    }

    const hoods: Neighborhood[] = data.neighborhoods || [];
    if (hoods.length > 0) {
      setters.setDeliveryFee(hoods[0].delivery_fee);
    }

    return { tenant: tenantInfo, retiradaAtivo: ra !== false };
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
  // Apelido do estado: handleConfirmarPedido recebe o cliente recém-salvo e usa o nome `customer` localmente
  const customerState = customer;
  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [genero, setGenero] = useState('');
  // Aceite de ofertas pelo WhatsApp (LGPD: começa desmarcado; só grava quando marcado).
  const [aceitaOfertas, setAceitaOfertas] = useState(false);
  // Voucher aplicado no checkout do delivery (pré-preenchido se veio de ?voucher= no link)
  const [voucherInput, setVoucherInput] = useState(() => getUrlVoucher() ?? '');
  const [voucherCodigo, setVoucherCodigo] = useState('');
  // CPF/CNPJ na nota fiscal (opcional): fica no aparelho para o próximo pedido.
  const [cpfNota, setCpfNota] = useState<string>(function () {
    try { return localStorage.getItem('erpos_delivery_cpf_nota') || ''; } catch { return ''; }
  });
  const [voucherDesconto, setVoucherDesconto] = useState(0);
  // Clube de fidelidade: cartão do clube + prêmios reservados p/ este pedido (ClubeCheckout).
  // O desconto de verdade é recalculado pela delivery-write.
  const [clubeSel, setClubeSel] = useState<ClubeSelecao>({ token: null, holdIds: [], desconto: 0, nomes: [] });
  const [voucherMsg, setVoucherMsg] = useState('');
  const [voucherLoading, setVoucherLoading] = useState(false);
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
    return cardapioBase && usaHorario ? idsForaDoHorario(cardapioBase, 'delivery').join(',') : '';
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
  const [deliveryFee, setDeliveryFee] = useState(0);

  // Carrinho (persistido em localStorage p/ sobreviver ao refresh/reload)
  const cartKey = 'delivery_' + (storeSlug || 'default');
  const [cart, setCart] = useState<CartItem[]>(() => loadCart<CartItem>(cartKey));
  useEffect(function () { saveCart(cartKey, cart); }, [cart, cartKey]);

  // Persiste a etapa de vitrine para o cliente voltar onde parou (ver loadSavedStep).
  // Ao confirmar o pedido ('confirmacao') limpamos, senão a volta cairia num pedido já feito.
  useEffect(function () {
    try {
      const key = stepStorageKey(storeSlug);
      if ((RESUMABLE_STEPS as string[]).includes(step)) {
        sessionStorage.setItem(key, step);
      } else if (step === 'confirmacao') {
        sessionStorage.removeItem(key);
      }
    } catch { /* noop */ }
  }, [step, storeSlug]);

  // Registra a visita ao cardápio (para ver quem entrou/montou carrinho e não
  // pediu). Debounce de 2s e só reenvia quando algo muda de verdade — o carrinho
  // muda a cada clique e não pode virar uma chamada por clique.
  const trackUltimoRef = useRef<string>('');
  useEffect(function () {
    if (!tenant) return;
    if (step === 'loading' || step === 'erro_config') return;
    // 'confirmacao' = pedido feito: o próprio create_delivery_order encerra a visita.
    if (step === 'confirmacao') return;

    const itens = cart.map(function (c) {
      return { nome: c.name, qtd: c.quantidade, total: Number((c.precoTotal * c.quantidade).toFixed(2)) };
    });
    const totalCarrinho = Number(cart.reduce(function (s, i) { return s + i.precoTotal * i.quantidade; }, 0).toFixed(2));
    const totalItens = cart.reduce(function (s, i) { return s + i.quantidade; }, 0);
    const cleanPhone = phone.replace(/\D/g, '');

    const assinatura = [step, cleanPhone, String(totalItens), String(totalCarrinho)].join('|');
    if (assinatura === trackUltimoRef.current) return;

    const timer = setTimeout(function () {
      trackUltimoRef.current = assinatura;
      fetch(getDeliveryWriteUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'track_visit',
          tenant_id: tenant.id,
          visit_key: getVisitKey(storeSlug),
          step: step,
          phone: cleanPhone || null,
          customer_name: customerName || null,
          items_count: totalItens,
          cart_total: totalCarrinho,
          cart_items: itens,
        }),
      }).catch(function () { /* tracking nunca atrapalha o pedido */ });
    }, 2000);

    return function () { clearTimeout(timer); };
  }, [tenant, step, cart, phone, customerName, storeSlug]);

  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [pedidoConfirmado, setPedidoConfirmado] = useState(false);
  const [numeroPedido, setNumeroPedido] = useState('');
  const [orderTotal, setOrderTotal] = useState(0);
  // Resumo de valores capturado NO MOMENTO da confirmação (o carrinho é limpo depois)
  const [resumoConfirmacao, setResumoConfirmacao] = useState<{ subtotal: number; desconto: number; deliveryFee: number; voucherCodigo: string } | null>(null);
  const [pagamentoSelecionado, setPagamentoSelecionado] = useState('');

  // ── Pix pelo app (pagamento online via Mercado Pago) ─────────────────────
  // Disponível quando a loja tem o provedor ativo (mesma regra do mesa-qr). O pedido
  // recém-criado guarda {orderId, orderToken} — o token é o client_request_id que
  // este aparelho gerou: é a prova de posse do pedido para a Edge online-payments.
  // `metodo` diz qual painel a tela do pedido mostra: Pix ou cartão de crédito (Mercado Pago).
  // Memo antigo (sem o campo) = Pix. Nunca renderizar os dois painéis juntos: cada um cancela
  // a cobrança pendente do outro, então a troca é sempre um clique explícito do cliente.
  const [pixOnlineDisponivel, setPixOnlineDisponivel] = useState(false);
  const [cartaoOnlineDisponivel, setCartaoOnlineDisponivel] = useState(false);
  const [mpPublicKey, setMpPublicKey] = useState('');
  // public_status já respondeu (ou falhou)? Enquanto não, a tela do cartão espera — nunca cai no Pix sozinha.
  const [pagamentoAppPronto, setPagamentoAppPronto] = useState(false);
  const [pixOnline, setPixOnline] = useState<{ orderId: string; orderToken: string; number: string; total: number; metodo: 'pix' | 'cartao' } | null>(null);
  useEffect(function () {
    // Troca de loja: não herda o que a loja anterior tinha ligado
    setPixOnlineDisponivel(false);
    setCartaoOnlineDisponivel(false);
    setMpPublicKey('');
    setPagamentoAppPronto(false);
    if (!tenant?.id) return;
    let cancelled = false;
    const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
    fetch(base + '/functions/v1/online-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'public_status', tenant_id: tenant.id }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (cancelled) return;
        const chave = d && typeof d.public_key === 'string' ? d.public_key : '';
        setPixOnlineDisponivel(Boolean(d && d.enabled));
        setCartaoOnlineDisponivel(Boolean(d && d.enabled && d.card_enabled && chave));
        setMpPublicKey(chave);
        setPagamentoAppPronto(true);
      })
      .catch(function () { if (!cancelled) setPagamentoAppPronto(true); /* fica desligado */ });
    return function () { cancelled = true; };
  }, [tenant?.id]);
  const [paymentMethods, setPaymentMethods] = useState<Record<string, boolean>>({});
  const [modoEntrega, setModoEntrega] = useState<'entrega' | 'retirada'>('entrega');
  const [retiradaAtivo, setRetiradaAtivo] = useState(true);
  const [deliveryOpenNow, setDeliveryOpenNow] = useState(true);
  const [deliveryClosedReason, setDeliveryClosedReason] = useState<string | null>(null);
  const [storeWhatsapp, setStoreWhatsapp] = useState('');
  const [infoLoja, setInfoLoja] = useState<InfoLoja>({ horario: null, pedidoMinimo: 0 });

  // Entrega por distância (pin do cliente + faixas configuradas pela loja)
  const [storeLocation, setStoreLocation] = useState<StoreLocation | null>(null);
  const [tiers, setTiers] = useState<FaixaEntrega[]>([]);
  // Idiomas que ESTA loja oferece ao cliente (fora o portugues, que e implicito).
  // Vazio = seletor de idioma nem aparece.
  const [locales, setLocales] = useState<string[]>([]);
  const [addressLat, setAddressLat] = useState<number | null>(null);
  const [addressLng, setAddressLng] = useState<number | null>(null);

  const prevStoreSlugRef = useRef<string | undefined>(storeSlug);
  const productionPartsRef = useRef<ProductionPartsMap | undefined>();

  // "Publicar cardápio" (aba Cardápio) → recarrega itens/preços sem F5. Só os
  // dados do cardápio (e aberto/fechado) — taxa, endereço, loja e a categoria
  // em que o cliente está ficam como estão (setters no-op).
  useMenuPing(tenant?.id, comJitter(function () {
    const nada = function () {};
    fetchDeliveryConfig(storeSlug, {
      setTenant: nada, setCity: nada, setNeighborhoods: nada, setCategoriaAtiva: nada,
      setDeliveryFee: nada, setPaymentMethods: nada, setRetiradaAtivo: nada, setStoreWhatsapp: nada,
      setStoreLocation: nada, setTiers: nada,
      setCardapioBase, setOptionGroups, setOptions, setObservations,
      setOutOfStockIds, setOpcoesIndisponiveisIds, setLocales,
      setDeliveryOpenNow, setDeliveryClosedReason,
      productionPartsRef,
    }).catch(function () { /* mantém o que já está na tela */ });
  }));

  // ── Inicializar ──────────────────────────────────────────────────────────────

  useEffect(function () {
    // Re-inicializa a cada mudanca de storeSlug E a cada (re)montagem do componente.
    // NAO usamos mais uma trava "ja inicializou" (initializedRef): combinada com o
    // duplo-mount do StrictMode em dev (e qualquer remontagem em prod) ela deixava a
    // tela presa em "Carregando" — o 1o init era cancelado pela limpeza e o 2o nem
    // rodava. Como as deps sao [storeSlug], este efeito so dispara em mudanca de slug
    // ou (re)montagem; a flag `cancelled` por execucao garante que apenas o resultado
    // da ultima execucao aplique o estado.
    const slugChanged = prevStoreSlugRef.current !== storeSlug;
    prevStoreSlugRef.current = storeSlug;

    // Reset states para o novo slug
    setStep('loading');
    setErrorMsg('');
    setTenant(null);
    setCity('');
    setNeighborhoods([]);
    setCardapioBase(null);
    setOptionGroups([]);
    setOptions([]);
    setObservations([]);
    setOutOfStockIds([]);
    setOpcoesIndisponiveisIds([]);
    setCategoriaAtiva(null);
    setDeliveryFee(0);
    setPaymentMethods({});
    setRetiradaAtivo(true);
    setDeliveryOpenNow(true);
    setDeliveryClosedReason(null);
    setStoreWhatsapp('');
    setCustomer(null);
    setPhone('');
    setCustomerName('');
    setDataNascimento('');
    setGenero('');
    // Preserva o cupom que veio no link (?voucher=) — o reset da sessão não pode
    // apagar o código, senão a auto-aplicação nunca acontece.
    setVoucherInput(getUrlVoucher() ?? '');
    setVoucherCodigo('');
    setVoucherDesconto(0);
    setVoucherMsg('');
    setSelectedNeighborhoodId('');
    setStreet('');
    setAddressNumber('');
    setComplement('');
    setReferencePoint('');
    setBairro('');
    setSavedAddresses([]);
    setSelectedAddressId(null);
    if (slugChanged) setCart([]); // mantém o carrinho ao recarregar a MESMA loja (refresh)
    setEditingItem(null);
    setShowCart(false);
    setPedidoConfirmado(false);
    setNumeroPedido('');
    setOrderTotal(0);
    setResumoConfirmacao(null);
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
    // Se o cliente estava navegando o cardápio/vitrine e voltou do 2º plano,
    // restaura essa etapa em vez de recomeçar do zero. Só vale p/ a MESMA loja.
    const savedStep = slugChanged ? null : loadSavedStep(storeSlug);

    async function init() {
      try {
        const configResult = await fetchDeliveryConfig(storeSlug, {
          setTenant,
          setCity,
          setNeighborhoods,
          setCardapioBase,
          setOptionGroups,
          setOptions,
          setObservations,
          setOutOfStockIds,
          setOpcoesIndisponiveisIds,
          setCategoriaAtiva,
          setDeliveryFee,
          setPaymentMethods,
          setRetiradaAtivo,
          setDeliveryOpenNow,
          setDeliveryClosedReason,
          setStoreWhatsapp,
          setStoreLocation,
          setTiers,
          setLocales,
          setInfoLoja,
          productionPartsRef,
        });

        if (cancelled) return;

        const savedPhone = configResult ? readSavedDeliveryPhone(localStorage, configResult.tenant.id) : null;
        if (savedPhone && configResult) {
          setPhone(formatPhoneBR(savedPhone));

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
              if (c.birth_date) setDataNascimento(String(c.birth_date).slice(0, 10));
              if (c.gender) setGenero(c.gender);
              setPhone(formatPhoneBR(c.phone));

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

              saveDeliveryPhone(localStorage, configResult.tenant.id, c.phone);

              // Pagamento pelo app (Pix ou cartão) em andamento (voltou do banco / recarregou): reabre a tela do pedido
              try {
                const rawPix = localStorage.getItem('delivery_pix_' + configResult.tenant.id);
                const memo = rawPix ? JSON.parse(rawPix) : null;
                if (memo && memo.orderId && Date.now() - Number(memo.at || 0) < 2 * 60 * 60 * 1000) {
                  const metodoMemo: 'pix' | 'cartao' = memo.metodo === 'cartao' ? 'cartao' : 'pix';
                  setPixOnline({ orderId: memo.orderId, orderToken: memo.orderToken || '', number: memo.number || '', total: Number(memo.total || 0), metodo: metodoMemo });
                  setNumeroPedido(memo.number || '');
                  setOrderTotal(Number(memo.total || 0));
                  // Reconstrói o que a tela mostra (taxa 0 na retirada) — sem isso ela usaria a taxa do endereço atual
                  if (memo.modo === 'retirada' || memo.modo === 'entrega') setModoEntrega(memo.modo);
                  const feeMemo = Number(memo.fee || 0);
                  setResumoConfirmacao({ subtotal: Math.max(0, Number(memo.total || 0) - feeMemo), desconto: 0, deliveryFee: feeMemo, voucherCodigo: '' });
                  setPagamentoSelecionado(metodoMemo === 'cartao' ? 'Cartão de crédito pelo app' : 'PIX pelo app');
                  setPedidoConfirmado(true);
                  setStep('confirmacao');
                  return;
                }
              } catch { /* memo inválido: segue o fluxo normal */ }

              // Cliente estava navegando o cardápio e voltou do 2º plano: retoma lá.
              if (savedStep === 'cardapio') { setStep('cardapio'); return; }

              // Entrega/retirada e endereço ficam no cartão do cardápio e na sacola
              setBuscaCliente('encontrado');
              setStep('cardapio');
              return;
            }
          } catch (_err) {
            // Se falhar a busca automática, cai na tela de identificação
          }
        }

        // Tráfego novo (sem telefone salvo ou lookup falhou): mostra o cardápio
        // primeiro (vitrine). O telefone só é pedido no checkout — quem vem de
        // anúncio quer ver comida/preço antes de cadastrar, senão abandona.
        // Se voltou do 2º plano numa etapa de vitrine, retoma nela.
        setStep(savedStep ?? 'preview');
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

  // Situação do WhatsApp digitado na sacola: ainda não buscado, buscando, cliente novo ou já cadastrado
  const [buscaCliente, setBuscaCliente] = useState<'nao' | 'buscando' | 'novo' | 'encontrado'>('nao');
  // Telefone da última busca da sacola: resposta de um número que o cliente já mudou é descartada
  const ultimaBuscaRef = useRef('');

  // Cliente achado pelo telefone: preenche nome, endereços (o principal já selecionado) e guarda o telefone no aparelho
  function aplicarClienteEncontrado(c: DeliveryCustomer, addresses: SavedAddress[]) {
    setCustomer(c);
    setCustomerName(c.name);
    if (c.birth_date) setDataNascimento(String(c.birth_date).slice(0, 10));
    if (c.gender) setGenero(c.gender);
    setPhone(formatPhoneBR(c.phone));
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
    if (tenant) saveDeliveryPhone(localStorage, tenant.id, c.phone);
    setBuscaCliente('encontrado');
  }

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
          aplicarClienteEncontrado(data.customer as DeliveryCustomer, (data.addresses || []) as SavedAddress[]);
          setStep('cardapio');
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
          setBuscaCliente('novo');
          // Cliente novo: nome e endereço são pedidos na sacola, junto com o pagamento
          setStep('cardapio');
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
        birth_date: dataNascimento || null,
        gender: genero || null,
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
        setPhone(formatPhoneBR(c.phone));
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

        saveDeliveryPhone(localStorage, tenant.id, c.phone);
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
        // O nome vem do cliente (exigido na tela de modo de entrega). NUNCA assumimos
        // um nome: sem nome, não salva — volta a pedir.
        if (!customerName.trim()) { setErrorMsg('Digite seu nome para continuar.'); return; }
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
            name: customerName.trim(),
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
              saveDeliveryPhone(localStorage, tenant.id, c.phone);
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
    // Pixel da Meta: item adicionado ao carrinho. É a etapa do meio do funil — sem ela a Meta
    // só enxerga visita e checkout, e o relatório de Tráfego Pago fica com um degrau vazio.
    trackPixel('AddToCart', {
      value: item.precoTotal * item.quantidade,
      currency: 'BRL',
      content_type: 'product',
      content_ids: [item.itemId],
      content_name: item.name,
      num_items: item.quantidade,
    });
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

  // "Esvaziar" da sacola (já confirmado pelo cliente)
  function handleEsvaziarSacola() {
    setCart([]);
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

  // Resolve true quando o pedido foi criado (a tela fecha o modal de pagamento);
  // false em erro — o modal fica aberto com a forma escolhida.
  function handleConfirmarPedido(paymentMethod?: string, cashAmount?: string, clienteSalvo?: DeliveryCustomer | null): Promise<boolean> {
    const customer = clienteSalvo || customerState;
    if (!tenant) { setErrorMsg('Erro ao carregar a loja. Recarregue a página.'); return Promise.resolve(false); }
    if (!customer) { setErrorMsg('Não identificamos seu cadastro. Toque em "Trocar" e confirme seu telefone novamente.'); return Promise.resolve(false); }
    if (cart.length === 0) return Promise.resolve(false);

    // Modo distância: bloqueia se fora da área de entrega (sem pin ou além da última faixa)
    if (foraDeArea) {
      setErrorMsg(addressLat == null
        ? 'Marque sua localização no mapa para calcular a entrega.'
        : 'Endereço fora da área de entrega desta loja.');
      return Promise.resolve(false);
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
      pix_online: 'PIX pelo app',
      cartao_online: 'Cartão de crédito pelo app',
    };
    // Pix ou cartão pelo app: o servidor segura o pedido (held) até o pagamento confirmar
    const isPixOnline = methodLabel === 'pix_online';
    const isCartaoOnline = methodLabel === 'cartao_online';
    const methodName = methodMap[methodLabel] || methodLabel;
    setPagamentoSelecionado(methodName);

    const cashAmountNum = cashAmount ? parseFloat(cashAmount) : 0;

    const url = getDeliveryWriteUrl();
    const subtotal = cart.reduce(function (s, i) { return s + i.precoTotal * i.quantidade; }, 0);
    const total = subtotal + effectiveDeliveryFee;

    // Pixel da Meta: o cliente iniciou o fechamento do pedido (funil de anúncio).
    trackPixel('InitiateCheckout', {
      value: total,
      currency: 'BRL',
      num_items: cart.reduce(function (s, i) { return s + i.quantidade; }, 0),
    });

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

    // Idempotência: a mesma tentativa de pedido (carrinho + endereço + pagamento + troco)
    // reenviada após erro de rede/5xx reusa o client_request_id — o servidor devolve o
    // pedido já criado em vez de duplicar. Descartado após sucesso ou recusa 4xx.
    const requestKey = 'delivery_order_req_' + tenant.id;
    const requestSignature = JSON.stringify([
      customer.id, itemsPayload, endereco, bairroName, selectedNeighborhoodId, modoEntrega,
      effectiveDeliveryFee, methodName, cashAmountNum, voucherCodigo || '', cpfNota.replace(/\D/g, ''),
      addressLat, addressLng,
    ]);
    let clientRequestId = '';
    try {
      const saved = JSON.parse(localStorage.getItem(requestKey) || 'null');
      if (saved && saved.sig === requestSignature && typeof saved.id === 'string') clientRequestId = saved.id;
    } catch { /* ignora */ }
    if (!clientRequestId) {
      clientRequestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
      try { localStorage.setItem(requestKey, JSON.stringify({ id: clientRequestId, sig: requestSignature })); } catch { /* ignora */ }
    }
    const clearRequestId = function () { try { localStorage.removeItem(requestKey); } catch { /* ignora */ } };
    try {
      const soDig = cpfNota.replace(/\D/g, '');
      if (soDig) localStorage.setItem('erpos_delivery_cpf_nota', soDig);
      else localStorage.removeItem('erpos_delivery_cpf_nota');
    } catch { /* sem storage */ }

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_delivery_order',
        tenant_id: tenant.id,
        customer_id: customer.id,
        customer_name: customerName,
        customer_phone: phone,
        customer_cpf: cpfNota.replace(/\D/g, '') || null,
        customer_address: endereco,
        birth_date: dataNascimento || null,
        gender: genero || null,
        accepts_marketing: aceitaOfertas || undefined,
        voucher_code: voucherCodigo || null,
        ...(clubeSel.token ? { loyalty_token: clubeSel.token } : {}),
        ...(clubeSel.token && clubeSel.holdIds.length > 0 ? { loyalty_hold_ids: clubeSel.holdIds } : {}),
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
        order_source: getOrderSource(),
        // Fecha a visita: este carrinho não foi abandonado.
        visit_key: getVisitKey(storeSlug),
      }),
    })
      .then(function (res) {
        return res.json()
          .catch(function () { return { error: 'invalid_response' }; })
          .then(function (data) { return { status: res.status, data: data || {} }; });
      })
      .then(function (r) {
        const data = r.data;
        if (data.error || r.status >= 400) {
          if (r.status < 500) {
            // Recusa definitiva (4xx ou erro de negócio com 200: fechado, fora da área, item
            // indisponível…): a próxima tentativa é outro pedido.
            clearRequestId();
            setErrorMsg(data.message || data.error || 'Não foi possível enviar o pedido.');
          } else {
            // 5xx: o pedido pode ter sido criado — mantém o id para o retry não duplicar.
            setErrorMsg(data.message || 'Erro de conexão. Tente novamente.');
          }
          setEnviando(false);
          return false;
        }
        clearRequestId();
        // Pedido feito: a próxima entrada no cardápio é uma visita nova.
        clearVisitKey(storeSlug);
        const totalConfirmado = data.data?.total || total;
        setNumeroPedido(data.data?.number || '');
        setOrderTotal(totalConfirmado);
        // Pix/cartão pelo app: guarda o pedido + token no aparelho para cobrar (e sobreviver a reload)
        if ((isPixOnline || isCartaoOnline) && data.data?.id) {
          const memo = { orderId: String(data.data.id), orderToken: clientRequestId, number: String(data.data.number || ''), total: Number(totalConfirmado), fee: Number(data.data.delivery_fee ?? effectiveDeliveryFee ?? 0), modo: modoEntrega, metodo: (isCartaoOnline ? 'cartao' : 'pix') as 'pix' | 'cartao', at: Date.now() };
          setPixOnline(memo);
          try { localStorage.setItem('delivery_pix_' + tenant.id, JSON.stringify(memo)); } catch { /* sem storage */ }
        } else {
          setPixOnline(null);
        }
        // Desconto real aplicado pelo backend (voucher) = bruto - total confirmado.
        const descontoAplicado = Math.max(0, (subtotal + effectiveDeliveryFee) - totalConfirmado);
        setResumoConfirmacao({ subtotal, desconto: descontoAplicado, deliveryFee: effectiveDeliveryFee, voucherCodigo: [voucherCodigo, clubeSel.nomes.length ? 'Clube' : ''].filter(Boolean).join(' + ') });
        // Pixel da Meta: PEDIDO CONFIRMADO — evento de conversão principal pro anúncio.
        trackPixel('Purchase', { value: totalConfirmado, currency: 'BRL' });
        setPedidoConfirmado(true);
        clubeLimparReservas(tenant.id);
        setClubeSel({ token: null, holdIds: [], desconto: 0, nomes: [] });
        setCart([]);
        setShowCart(false);
        setEnviando(false);
        setStep('confirmacao');
        return true;
      })
      .catch(function () {
        // Erro de rede: mantém o client_request_id (o pedido pode ter chegado ao servidor).
        setEnviando(false);
        setErrorMsg('Erro de conexão. Tente novamente.');
        return false;
      });
  }

  // ── Novo pedido ─────────────────────────────────────────────────────────────

  // ── Sacola única (dados + entrega + pagamento numa tela) ─────────────────────

  // WhatsApp digitado na sacola: busca o cadastro sem trocar de tela
  async function buscarClienteCheckout(p: string): Promise<void> {
    if (!tenant) return;
    const dig = p.replace(/\D/g, '');
    if (dig.length < 10) return;
    ultimaBuscaRef.current = dig;
    setBuscaCliente('buscando');
    setErrorMsg('');
    try {
      const res = await fetch(getDeliveryWriteUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lookup_customer', phone: dig, tenant_id: tenant.id }),
      });
      const data = await res.json();
      if (ultimaBuscaRef.current !== dig) return; // o cliente já mudou o número
      if (data.error) {
        setBuscaCliente('nao');
        setErrorMsg(data.message || data.error);
        return;
      }
      if (data.customer) {
        aplicarClienteEncontrado(data.customer as DeliveryCustomer, (data.addresses || []) as SavedAddress[]);
      } else {
        setCustomer(null);
        setSavedAddresses([]);
        setSelectedAddressId(null);
        setBuscaCliente('novo');
      }
    } catch {
      if (ultimaBuscaRef.current !== dig) return;
      setBuscaCliente('nao');
      setErrorMsg('Erro de conexão. Tente novamente.');
    }
  }

  // Número mudou na sacola: a busca anterior deixa de valer
  function reiniciarBuscaCliente() {
    ultimaBuscaRef.current = '';
    setBuscaCliente(function (b) { return b === 'encontrado' ? b : 'nao'; });
  }

  // "Não é você?": esquece o cliente deste aparelho sem esvaziar a sacola
  function trocarCliente() {
    try {
      clearSavedDeliveryPhone(localStorage, tenant?.id);
      localStorage.removeItem(PIN_STORAGE_KEY);
    } catch { /* sem storage */ }
    setAddressLat(null);
    setAddressLng(null);
    ultimaBuscaRef.current = '';
    setCustomer(null);
    setPhone('');
    setCustomerName('');
    setDataNascimento('');
    setGenero('');
    setSavedAddresses([]);
    setSelectedAddressId(null);
    setStreet('');
    setAddressNumber('');
    setComplement('');
    setReferencePoint('');
    setBairro('');
    setSelectedNeighborhoodId('');
    setBuscaCliente('nao');
    setErrorMsg('');
  }

  // Botão "Fazer pedido" da sacola: valida, salva o cadastro quando precisa (cliente novo ou
  // endereço digitado agora) e só então cria o pedido — com o cliente que acabou de voltar do servidor.
  // Um envio por vez: dois toques rápidos não criam dois cadastros/pedidos
  const finalizandoRef = useRef(false);
  async function finalizarCheckout(paymentMethod?: string, cashAmount?: string): Promise<boolean> {
    if (finalizandoRef.current) return false;
    finalizandoRef.current = true;
    try {
      return await finalizarCheckoutInterno(paymentMethod, cashAmount);
    } finally {
      finalizandoRef.current = false;
    }
  }

  async function finalizarCheckoutInterno(paymentMethod?: string, cashAmount?: string): Promise<boolean> {
    if (!tenant) { setErrorMsg('Erro ao carregar a loja. Recarregue a página.'); return false; }
    const dig = phone.replace(/\D/g, '');
    if (dig.length < 10) { setErrorMsg('Digite seu WhatsApp com DDD.'); return false; }
    if (!customerName.trim()) { setErrorMsg('Digite seu nome.'); return false; }
    const subtotal = cart.reduce(function (acc, i) { return acc + i.precoTotal * i.quantidade; }, 0);
    if (modoEntrega !== 'retirada' && infoLoja.pedidoMinimo > 0 && subtotal < infoLoja.pedidoMinimo) {
      setErrorMsg('O pedido mínimo é de R$ ' + infoLoja.pedidoMinimo.toFixed(2).replace('.', ',') + '.');
      return false;
    }

    const entrega = modoEntrega !== 'retirada';
    const enderecoPronto = entrega && (
      distanceMode
        ? (addressLat != null && addressLng != null && !!street.trim() && !!addressNumber.trim())
        : (!!selectedNeighborhoodId && !!street.trim() && !!addressNumber.trim())
    );
    if (entrega && !enderecoPronto) {
      setErrorMsg(distanceMode
        ? (addressLat == null ? 'Marque o endereço no mapa para calcular a entrega.' : 'Preencha rua e número.')
        : (!selectedNeighborhoodId ? 'Escolha o bairro.' : 'Preencha rua e número.'));
      return false;
    }
    const temEnderecoSalvo = !!customer && (
      (selectedAddressId != null && selectedAddressId !== '') ||
      (!!customer.street && (distanceMode ? addressLat != null : !!customer.neighborhood_id))
    );
    const precisaSalvar = !customer || (entrega && !temEnderecoSalvo);

    let cli: DeliveryCustomer | null = customer;
    // Sem cadastro carregado: confere pelo telefone antes de salvar. save_customer SOBRESCREVE nome e
    // endereço de quem já existe — se achar o cliente, carrega os dados e pede para conferir.
    if (!cli) {
      setEnviando(true);
      try {
        const resBusca = await fetch(getDeliveryWriteUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'lookup_customer', phone: dig, tenant_id: tenant.id }),
        });
        const achado = await resBusca.json();
        if (achado && achado.customer) {
          aplicarClienteEncontrado(achado.customer as DeliveryCustomer, (achado.addresses || []) as SavedAddress[]);
          setEnviando(false);
          setErrorMsg('Achamos seu cadastro. Confira o endereço e toque em "Fazer pedido" de novo.');
          return false;
        }
      } catch {
        setEnviando(false);
        setErrorMsg('Erro de conexão. Tente novamente.');
        return false;
      }
    }
    if (precisaSalvar) {
      setEnviando(true);
      setErrorMsg('');
      try {
        const res = await fetch(getDeliveryWriteUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({
            action: 'save_customer',
            tenant_id: tenant.id,
            phone: dig,
            name: customerName.trim(),
            birth_date: dataNascimento || null,
            gender: genero || null,
          }, entrega ? {
            neighborhood_id: selectedNeighborhoodId || null,
            street: street.trim() || null,
            number: addressNumber.trim() || null,
            complement: complement.trim() || null,
            reference_point: referencePoint.trim() || null,
            bairro: bairro.trim() || null,
            address_lat: addressLat,
            address_lng: addressLng,
          } : {
            neighborhood_id: null, street: null, number: null, complement: null, reference_point: null,
          })),
        });
        const data = await res.json();
        if (data.error || !data.customer) {
          setEnviando(false);
          setErrorMsg(data.message || data.error || 'Não foi possível salvar seus dados.');
          return false;
        }
        cli = data.customer as DeliveryCustomer;
        setCustomer(cli);
        const addresses: SavedAddress[] = data.addresses || [];
        setSavedAddresses(addresses);
        if (entrega && addresses.length > 0) setSelectedAddressId(addresses[addresses.length - 1].id);
        saveDeliveryPhone(localStorage, tenant.id, cli.phone);
        setBuscaCliente('encontrado');
      } catch {
        setEnviando(false);
        setErrorMsg('Erro de conexão. Tente novamente.');
        return false;
      }
    }
    const ok = await handleConfirmarPedido(paymentMethod, cashAmount, cli);
    if (!ok) setEnviando(false);
    return ok;
  }

  // Cliente desistiu do pagamento pelo app (Pix ou cartão): escolhe outra forma e o pedido segurado vai pra cozinha.
  // Autentica pela chave do aparelho (se for o pedido pendente daqui) ou pelo telefone.
  async function trocarPagamentoPedidoSegurado(orderId: string, metodoKey: string, cashAmount?: string): Promise<boolean> {
    if (!tenant) return false;
    const labels: Record<string, string> = { dinheiro: 'Dinheiro', cartao_credito: 'Cartão de Crédito', cartao_debito: 'Cartão de Débito', pix: 'PIX', vale_refeicao: 'Vale Refeição' };
    const label = labels[metodoKey] || metodoKey;
    const cashNum = cashAmount ? parseFloat(cashAmount) : 0;
    const token = pixOnline && pixOnline.orderId === orderId ? pixOnline.orderToken : '';
    try {
      const res = await fetch(getDeliveryWriteUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change_held_payment', tenant_id: tenant.id,
          order_id: orderId,
          order_token: token || undefined, order_phone: token ? undefined : phone,
          payment_method: label, cash_amount: cashNum > 0 ? cashNum : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) { setErrorMsg(data.message || data.error); return false; }
      setPagamentoSelecionado(label);
      if (pixOnline && pixOnline.orderId === orderId) limparPixOnline();
      return true;
    } catch {
      setErrorMsg('Erro de conexão. Tente novamente.');
      return false;
    }
  }

  function handleTrocarPagamentoPixOnline(metodoKey: string, cashAmount?: string): Promise<boolean> {
    if (!pixOnline) return Promise.resolve(false);
    return trocarPagamentoPedidoSegurado(pixOnline.orderId, metodoKey, cashAmount);
  }

  // Cliente desistiu do pedido que ainda espera o pagamento pelo app. O servidor confere no
  // Mercado Pago antes de cancelar. Devolve null quando cancelou; senão, o motivo para mostrar.
  async function cancelarPedidoSegurado(orderId: string): Promise<string | null> {
    if (!tenant?.id) return 'Não deu para cancelar agora. Tente de novo.';
    const token = pixOnline && pixOnline.orderId === orderId ? pixOnline.orderToken : '';
    if (!token && !phone) return 'Abra o cardápio com o telefone que fez o pedido para cancelar.';
    const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
    try {
      const res = await fetch(base + '/functions/v1/online-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign(
          { action: 'cancel_held_order', tenant_id: tenant.id, order_id: orderId },
          token ? { order_token: token } : { order_phone: phone },
        )),
      });
      const d = await res.json().catch(function () { return {}; });
      if (!res.ok || d.error) return d.message || d.error || 'Não deu para cancelar agora. Tente de novo.';
      if (pixOnline && pixOnline.orderId === orderId) limparPixOnline();
      return null;
    } catch {
      return 'Erro de conexão. Tente novamente.';
    }
  }

  function limparPixOnline() {
    // Chamado quando o pagamento confirma (ou o cliente troca a forma): o pedido deixa de estar pendente
    try { if (tenant?.id) localStorage.removeItem('delivery_pix_' + tenant.id); } catch { /* ignore */ }
    setPixOnline(null);
  }

  // Cliente tocou em "Pagar com Pix" / "Pagar com cartão": só troca qual painel aparece
  // (o painel novo cria a cobrança dele e cancela a pendente do outro).
  function trocarMetodoPagamentoApp(metodo: 'pix' | 'cartao') {
    if (!pixOnline || pixOnline.metodo === metodo) return;
    try {
      if (tenant?.id) {
        const chave = 'delivery_pix_' + tenant.id;
        const raw = localStorage.getItem(chave);
        const memo = raw ? JSON.parse(raw) : null;
        if (memo && memo.orderId === pixOnline.orderId) localStorage.setItem(chave, JSON.stringify({ ...memo, metodo }));
      }
    } catch { /* sem storage */ }
    setPixOnline({ ...pixOnline, metodo });
    setPagamentoSelecionado(metodo === 'cartao' ? 'Cartão de crédito pelo app' : 'PIX pelo app');
  }

  // Aparelho perdeu a chave (ou nunca teve): retoma o pedido segurado pelo TELEFONE do
  // cliente. `orderToken` vazio faz a tela autenticar por `order_phone`.
  // `metodo` vem das notas do pedido ("Cartão de crédito pelo app" → cartão); sem isso, Pix.
  function voltarParaPagamentoPixPorTelefone(orderId: string, number: string, total: number, fee?: number, isRetirada?: boolean, metodo?: 'pix' | 'cartao') {
    if (!tenant?.id) return;
    const feeNum = Number(fee || 0);
    const modo: 'entrega' | 'retirada' = isRetirada ? 'retirada' : 'entrega';
    const metodoApp: 'pix' | 'cartao' = metodo === 'cartao' ? 'cartao' : 'pix';
    const memo = { orderId, orderToken: '', number, total, fee: feeNum, modo, metodo: metodoApp, at: Date.now() };
    setPixOnline(memo);
    try { localStorage.setItem('delivery_pix_' + tenant.id, JSON.stringify(memo)); } catch { /* sem storage */ }
    setNumeroPedido(number);
    setOrderTotal(total);
    setModoEntrega(modo);
    setResumoConfirmacao({ subtotal: Math.max(0, total - feeNum), desconto: 0, deliveryFee: feeNum, voucherCodigo: '' });
    setPagamentoSelecionado(metodoApp === 'cartao' ? 'Cartão de crédito pelo app' : 'PIX pelo app');
    setPedidoConfirmado(true);
    setErrorMsg('');
    setStep('confirmacao');
  }

  // O pedido pendente guardado no aparelho pode ter morrido no servidor (cancelado no
  // fechamento do caixa, pago pelo caixa, liberado com outra forma…). Confere na Edge e,
  // se não houver mais nada a pagar, esquece o memo — senão o banner "falta pagar" mente.
  useEffect(function () {
    if (!pixOnline || !tenant?.id) return;
    let cancelled = false;
    const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
    const auth = pixOnline.orderToken
      ? { order_id: pixOnline.orderId, order_token: pixOnline.orderToken }
      : { order_id: pixOnline.orderId, order_phone: phone };
    fetch(base + '/functions/v1/online-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_bill', ...auth }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (cancelled || !d) return;
        const orders = (d.orders || []) as { remaining: number }[];
        const restante = orders.reduce(function (acc: number, o) { return acc + Number(o.remaining || 0); }, 0);
        const morto = !!d.error || (orders.length > 0 && restante <= 0);
        if (morto) limparPixOnline();
      })
      .catch(function () { /* sem rede: mantém o memo, a tela do Pix trata */ });
    return function () { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixOnline?.orderId, tenant?.id]);

  // Cliente saiu pro cardápio antes de pagar: volta pra tela do pedido com o Pix (ou o cartão).
  function voltarParaPagamentoPix() {
    if (!pixOnline) return;
    setNumeroPedido(pixOnline.number);
    setOrderTotal(pixOnline.total);
    setPagamentoSelecionado(pixOnline.metodo === 'cartao' ? 'Cartão de crédito pelo app' : 'PIX pelo app');
    setPedidoConfirmado(true);
    setErrorMsg('');
    setStep('confirmacao');
  }

  function handleNovoPedido() {
    // NÃO apaga o Pix pendente: "fazer outro pedido" só volta ao cardápio; o pedido
    // segurado continua esperando pagamento (banner no cardápio leva de volta).
    setPedidoConfirmado(false);
    setNumeroPedido('');
    setErrorMsg('');
    setEnderecoFromCardapio(false);
    setVoucherInput('');
    setVoucherCodigo('');
    setVoucherDesconto(0);
    setVoucherMsg('');
    setStep('cardapio');
  }

  // ── Sair / trocar de número ─────────────────────────────────────────────────
  // Encerra a sessão do cliente neste aparelho: apaga o telefone salvo (auto-login),
  // limpa carrinho/PIN/endereços e volta pra tela de identificação, pra outra pessoa
  // (ou o mesmo cliente com outro número) entrar do zero.
  function handleSair() {
    try {
      clearSavedDeliveryPhone(localStorage, tenant?.id);
      localStorage.removeItem(PIN_STORAGE_KEY);
    } catch { /* armazenamento indisponível — ignora */ }

    setCart([]); // saveCart remove a chave do carrinho quando vazio
    setCustomer(null);
    setPhone('');
    setCustomerName('');
    setDataNascimento('');
    setGenero('');
    setAceitaOfertas(false); // tablet compartilhado: o próximo cliente decide por si
    setSavedAddresses([]);
    setSelectedAddressId(null);
    setStreet('');
    setAddressNumber('');
    setComplement('');
    setReferencePoint('');
    setBairro('');
    setSelectedNeighborhoodId('');
    setVoucherInput('');
    setVoucherCodigo('');
    setVoucherDesconto(0);
    setVoucherMsg('');
    setPedidoConfirmado(false);
    setNumeroPedido('');
    setErrorMsg('');
    setStep('identificacao');
  }

  // ── Voucher (cupom) no checkout do delivery ─────────────────────────────────

  function voucherMotivo(reason?: string, minOrder?: number): string {
    if (reason === 'below_min_order') {
      return minOrder && minOrder > 0
        ? `Este cupom vale para pedidos a partir de ${minOrder.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`
        : 'O pedido não atingiu o valor mínimo deste cupom.';
    }
    if (reason === 'not_found') return 'Cupom não encontrado.';
    if (reason === 'expired') return 'Cupom expirado.';
    if (reason === 'depleted') return 'Cupom já utilizado.';
    if (reason === 'cancelled') return 'Cupom cancelado.';
    if (reason === 'not_yet_valid') return 'Este cupom ainda não está vigente.';
    if (reason === 'free_item_indisponivel') return 'Este cupom não é válido para delivery.';
    if (reason === 'sem_desconto') return 'Cupom sem desconto aplicável a este pedido.';
    return 'Cupom inválido.';
  }

  // Auto-aplica o cupom vindo do link do voucher assim que houver itens no carrinho
  // (uma única tentativa automática; se falhar — ex.: pedido mínimo — o campo fica
  // preenchido e a mensagem explica, e o cliente pode tocar "Aplicar" depois).
  // Retenta conforme o carrinho CRESCE (ex.: cruzar o pedido mínimo do cupom) —
  // guarda o último subtotal tentado p/ não spammar validate a cada mudança.
  const autoVoucherLastSubtotal = useRef(-1);
  useEffect(function () {
    if (voucherCodigo || voucherLoading) return;
    const code = voucherInput.trim();
    if (!code || !tenant || getUrlVoucher() !== code) return;
    const subtotal = cart.reduce(function (s, i) { return s + i.precoTotal * i.quantidade; }, 0);
    if (subtotal <= 0) return;
    if (subtotal <= autoVoucherLastSubtotal.current) return;
    autoVoucherLastSubtotal.current = subtotal;
    handleAplicarVoucher();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, tenant, voucherCodigo, voucherInput, voucherLoading]);

  async function handleAplicarVoucher() {
    const code = voucherInput.trim();
    if (!code || !tenant) return;
    const subtotal = cart.reduce(function (s, i) { return s + i.precoTotal * i.quantidade; }, 0);
    setVoucherLoading(true);
    setVoucherMsg('');
    try {
      const res = await fetch(getDeliveryWriteUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate_voucher', tenant_id: tenant.id, code, order_amount: subtotal }),
      });
      const data = await res.json();
      if (data && data.valid) {
        setVoucherCodigo(data.code);
        setVoucherDesconto(Number(data.applicable_amount) || 0);
        setVoucherMsg('');
      } else {
        setVoucherCodigo('');
        setVoucherDesconto(0);
        setVoucherMsg(voucherMotivo(data && data.reason, data && Number(data.min_order_amount)));
      }
    } catch (_e) {
      setVoucherMsg('Erro ao validar o cupom. Tente novamente.');
    } finally {
      setVoucherLoading(false);
    }
  }

  function handleRemoverVoucher() {
    setVoucherInput('');
    setVoucherCodigo('');
    setVoucherDesconto(0);
    setVoucherMsg('');
    clearUrlVoucher(); // remoção manual não deve "ressuscitar" o cupom do link
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
  // Por bairro, a taxa vem do bairro escolhido (o endereço salvo chega do servidor com taxa 0;
  // o servidor recalcula ao gravar o pedido, mas a tela mostrava "Grátis").
  const bairroEscolhido = neighborhoods.find(function (n) { return n.id === selectedNeighborhoodId; });
  const effectiveDeliveryFee = modoEntrega === 'retirada'
    ? 0
    : distanceMode
      ? (deliveryQuote && deliveryQuote.dentroArea ? deliveryQuote.taxa : 0)
      : (bairroEscolhido ? (Number(bairroEscolhido.delivery_fee) || 0) : deliveryFee);

  // Modo distância: ao (re)selecionar um endereço salvo, restaura o pin dele e recalcula a taxa.
  useEffect(function () {
    if (!distanceMode || !selectedAddressId) return;
    const addr = savedAddresses.find(function (a) { return a.id === selectedAddressId; });
    if (!addr) return;
    if (typeof addr.lat === 'number' && typeof addr.lng === 'number') {
      setAddressLat(addr.lat);
      setAddressLng(addr.lng);
    } else {
      // Sem pin salvo: precisa marcar no mapa (senão a taxa sairia do endereço anterior)
      setAddressLat(null);
      setAddressLng(null);
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
  // Endereços salvos chegam sem nome/taxa do bairro: completa pela lista de bairros da loja
  const displayAddresses: SavedAddress[] = savedAddresses.length > 0
    ? savedAddresses.map(function (a) {
        if (a.neighborhood_name || !a.neighborhood_id) return a;
        const nb = neighborhoods.find(function (n) { return n.id === a.neighborhood_id; });
        return nb ? Object.assign({}, a, { neighborhood_name: nb.name, neighborhood_delivery_fee: Number(nb.delivery_fee) || 0 }) : a;
      })
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
    dataNascimento,
    genero,
    voucherInput,
    setVoucherInput,
    voucherCodigo,
    voucherDesconto,
    clubeSel,
    setClubeSel,
    voucherMsg,
    voucherLoading,
    handleAplicarVoucher,
    handleRemoverVoucher,
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
    resumoConfirmacao,
    deliveryFee: effectiveDeliveryFee,
    totalItens,
    totalItensProdutos,
    totalValor,
    paymentMethods,
    pagamentoSelecionado,
    pixOnlineDisponivel,
    cartaoOnlineDisponivel,
    mpPublicKey,
    pagamentoAppPronto,
    pixOnline,
    limparPixOnline,
    trocarMetodoPagamentoApp,
    handleTrocarPagamentoPixOnline,
    trocarPagamentoPedidoSegurado,
    voltarParaPagamentoPix,
    voltarParaPagamentoPixPorTelefone,
    modoEntrega,
    setModoEntrega,
    retiradaAtivo,
    deliveryOpenNow,
    deliveryClosedReason,
    storeWhatsapp,
    infoLoja,
    setPhone,
    setCustomerName,
    setDataNascimento,
    setGenero,
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
    handleEsvaziarSacola,
    cancelarPedidoSegurado,
    handleAbrirEdicao,
    handleSalvarEdicao,
    handleFecharEdicao,
    handleConfirmarPedido,
    buscaCliente,
    buscarClienteCheckout,
    reiniciarBuscaCliente,
    trocarCliente,
    finalizarCheckout,
    effectiveDeliveryFee,
    cpfNota,
    setCpfNota,
    aceitaOfertas,
    setAceitaOfertas,
    jaAceitaOfertas: customer?.aceita_ofertas === true,
    handleNovoPedido,
    handleSair,
    handleChangeNeighborhood,
    enderecoFromCardapio,
    setEnderecoFromCardapio,
    // Entrega por distância (pin)
    distanceMode,
    storeLocation,
    tiers,
    locales,
    addressLat,
    addressLng,
    setAddressPin,
    deliveryQuote,
    foraDeArea,
  };
}