// Configuração do delivery da loja (system_settings.delivery_config + delivery_city), do jeito que a tela
// Delivery edita. Lê tolerando lixo e grava SÓ o que a tela conhece — o servidor (delivery-write
// save_delivery_settings) junta com o que já existe, então chaves de outras telas (cart_recovery,
// que mora em Clientes & Marketing desde 2026-10-05) e do botão do caixa (abrir/pausar/dia corrido) ficam.
import { supabase } from '@/lib/supabase';
import { somarDias, todayBrasilia } from '@/lib/dateUtils';
import type { MotoboyAlertEntry } from '@/contexts/SystemSettingsContext';
import { lerAcertoCfg, acertoParaSalvar, ACERTO_PADRAO, type AcertoCfg } from './acertoCfg';
import { normalizarHorarioDelivery, type HorarioDelivery } from '../../../supabase/functions/_shared/horario-delivery';

/** Faixa de entrega por distância: até X km cobra R$ e promete chegar em até N min. */
export interface FaixaEntrega { ate_km: number; taxa: number; tempo_max_min: number }

export interface ConfigDelivery {
  cidade: string;
  pedidoMinimoAtivo: boolean;
  pedidoMinimoValor: number;
  retiradaAtivo: boolean;
  /** Entrega grátis acima de um valor (ideia aprovada em 2026-10-05; começa desligada). ate_km 0 = qualquer distância. */
  freteGratis: { ativo: boolean; acima_de: number; ate_km: number };
  /** Só dígitos, com DDD. Vazio = sem botão "Falar com a loja". */
  whatsappLoja: string;
  formasPagamento: Record<string, boolean>;
  lojaLat: number | null;
  lojaLng: number | null;
  faixas: FaixaEntrega[];
  horario: HorarioDelivery;
  avisosMotoboy: { categorias: MotoboyAlertEntry[]; itens: MotoboyAlertEntry[] };
  acerto: AcertoCfg;
  /** Mensagens prontas para o cliente por fase (novo, preparo, pronto, em_rota, entregue). */
  mensagens: Record<string, string[]>;
}

export const CONFIG_VAZIA: ConfigDelivery = {
  cidade: '', pedidoMinimoAtivo: false, pedidoMinimoValor: 0, retiradaAtivo: true,
  freteGratis: { ativo: false, acima_de: 0, ate_km: 0 },
  whatsappLoja: '', formasPagamento: {}, lojaLat: null, lojaLng: null, faixas: [],
  horario: normalizarHorarioDelivery({}), avisosMotoboy: { categorias: [], itens: [] },
  acerto: { ...ACERTO_PADRAO }, mensagens: {},
};

const num = (v: unknown) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : 0; };

/** Formas "pelo app": no cardápio do cliente valem como LIGADAS quando a chave não existe (só `false` desliga). */
export const FORMAS_PELO_APP = ['pix_online', 'cartao_online'];
export function formaLigada(formas: Record<string, boolean>, chave: string): boolean {
  return FORMAS_PELO_APP.includes(chave) ? formas[chave] !== false : formas[chave] === true;
}
/** As formas de pagamento que a tela conhece (as que o cliente pode ver no cardápio). */
export const FORMAS_CONHECIDAS = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'vale_refeicao', 'pix_online', 'cartao_online'];

/** Duas escolhas de pagamento valem o mesmo para o cliente? Compara o valor efetivo (chave que não existe = padrão), não o texto. */
function formasIguais(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  if (FORMAS_CONHECIDAS.some((k) => formaLigada(a, k) !== formaLigada(b, k))) return false;
  const outras = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !FORMAS_CONHECIDAS.includes(k)));
  for (const k of outras) if ((a[k] ?? false) !== (b[k] ?? false)) return false;
  return true;
}

/** Início da janela "últimos 30 dias" de TODAS as consultas da tela: hoje (Brasília) menos 29 dias, às 00:00 (-03:00), em ISO. */
export function inicioDosUltimos30Dias(): string {
  return new Date(`${somarDias(todayBrasilia(), -29)}T00:00:00-03:00`).toISOString();
}

export function lerConfig(dcRaw: unknown, cidade: unknown): ConfigDelivery {
  const dc = (dcRaw && typeof dcRaw === 'object' ? dcRaw : {}) as Record<string, any>;
  const sl = dc.store_location;
  const ma = dc.motoboy_alertas && typeof dc.motoboy_alertas === 'object' ? dc.motoboy_alertas : {};
  const alertas = (x: unknown): MotoboyAlertEntry[] => Array.isArray(x)
    ? x.filter((e) => e && e.id).map((e) => ({ id: String(e.id), nome: String(e.nome ?? '') }))
    : [];
  const msgs: Record<string, string[]> = {};
  if (dc.whatsapp_msgs && typeof dc.whatsapp_msgs === 'object') {
    for (const k of Object.keys(dc.whatsapp_msgs)) {
      const arr = dc.whatsapp_msgs[k];
      if (Array.isArray(arr)) msgs[k] = arr.filter((s: unknown) => typeof s === 'string');
    }
  }
  const fg = dc.frete_gratis && typeof dc.frete_gratis === 'object' ? dc.frete_gratis : {};
  return {
    cidade: typeof cidade === 'string' ? cidade : '',
    pedidoMinimoAtivo: dc.pedido_minimo_ativo === true,
    pedidoMinimoValor: num(dc.pedido_minimo_valor),
    retiradaAtivo: dc.retirada_ativo !== false,
    freteGratis: { ativo: fg.ativo === true, acima_de: num(fg.acima_de), ate_km: num(fg.ate_km) },
    whatsappLoja: dc.whatsapp_loja ? String(dc.whatsapp_loja).replace(/\D/g, '') : '',
    formasPagamento: dc.formas_pagamento && typeof dc.formas_pagamento === 'object' ? { ...dc.formas_pagamento } : {},
    lojaLat: sl && typeof sl.lat === 'number' ? sl.lat : null,
    lojaLng: sl && typeof sl.lng === 'number' ? sl.lng : null,
    faixas: Array.isArray(dc.delivery_fee_tiers)
      ? dc.delivery_fee_tiers.map((t: any) => ({ ate_km: num(t?.ate_km), taxa: num(t?.taxa), tempo_max_min: Math.round(num(t?.tempo_max_min)) }))
      : [],
    horario: normalizarHorarioDelivery(dc.delivery_schedule ?? {}),
    avisosMotoboy: { categorias: alertas(ma.categorias), itens: alertas(ma.itens) },
    acerto: lerAcertoCfg(dc.acerto_motoboy),
    mensagens: msgs,
  };
}

/** Faixas válidas (km > 0), em ordem de distância. */
export function faixasOrdenadas(faixas: FaixaEntrega[]): FaixaEntrega[] {
  return faixas.filter((f) => f.ate_km > 0).slice().sort((a, b) => a.ate_km - b.ate_km);
}

export function paraSalvar(c: ConfigDelivery): { delivery_city: string; delivery_config: Record<string, unknown> } {
  const mensagens: Record<string, string[]> = {};
  for (const k of Object.keys(c.mensagens)) {
    const arr = (c.mensagens[k] ?? []).map((s) => s.trim()).filter(Boolean);
    if (arr.length) mensagens[k] = arr;
  }
  return {
    delivery_city: c.cidade.trim(),
    delivery_config: {
      pedido_minimo_ativo: c.pedidoMinimoAtivo,
      pedido_minimo_valor: c.pedidoMinimoAtivo ? Math.round(c.pedidoMinimoValor * 100) / 100 : 0,
      retirada_ativo: c.retiradaAtivo,
      frete_gratis: { ativo: c.freteGratis.ativo, acima_de: Math.round(c.freteGratis.acima_de * 100) / 100, ate_km: c.freteGratis.ate_km || 0 },
      whatsapp_loja: c.whatsappLoja.replace(/\D/g, '') || null,
      formas_pagamento: c.formasPagamento,
      store_location: c.lojaLat != null && c.lojaLng != null ? { lat: c.lojaLat, lng: c.lojaLng } : null,
      delivery_fee_tiers: faixasOrdenadas(c.faixas).map((f) => ({ ...f, taxa: Math.round(f.taxa * 100) / 100 })),
      delivery_schedule: normalizarHorarioDelivery(c.horario),
      motoboy_alertas: c.avisosMotoboy,
      acerto_motoboy: acertoParaSalvar(c.acerto),
      whatsapp_msgs: mensagens,
    },
  };
}

/** Quais partes da configuração mudaram ('delivery_city' e as chaves de delivery_config), na ordem em que são gravadas. */
export function chavesMudadas(salvo: ConfigDelivery | null, rascunho: ConfigDelivery | null): string[] {
  if (!salvo || !rascunho) return [];
  const a = paraSalvar(salvo); const b = paraSalvar(rascunho);
  const chaves: string[] = [];
  if (a.delivery_city !== b.delivery_city) chaves.push('delivery_city');
  for (const k of Object.keys(b.delivery_config)) {
    const igual = k === 'formas_pagamento'
      ? formasIguais(salvo.formasPagamento, rascunho.formasPagamento)
      : JSON.stringify(a.delivery_config[k]) === JSON.stringify(b.delivery_config[k]);
    if (!igual) chaves.push(k);
  }
  return chaves;
}

/** Quantas partes da configuração mudaram (para a barra "N mudanças ainda não salvas"). */
export function contarMudancas(salvo: ConfigDelivery | null, rascunho: ConfigDelivery | null): number {
  return chavesMudadas(salvo, rascunho).length;
}

/**
 * O corpo do "Salvar": SÓ o que mudou em relação ao que está gravado. O servidor junta com o que já existe,
 * então o que não vai aqui fica como está (e não pisa no que outra tela gravou no meio tempo).
 * `delivery_city` só vai se mudou.
 */
export function mudancasParaSalvar(salvo: ConfigDelivery, rascunho: ConfigDelivery): { delivery_city?: string; delivery_config: Record<string, unknown> } {
  const b = paraSalvar(rascunho);
  const corpo: { delivery_city?: string; delivery_config: Record<string, unknown> } = { delivery_config: {} };
  for (const k of chavesMudadas(salvo, rascunho)) {
    if (k === 'delivery_city') corpo.delivery_city = b.delivery_city;
    else corpo.delivery_config[k] = b.delivery_config[k];
  }
  return corpo;
}

// ── Chamadas ao servidor ────────────────────────────────────────────────────

function urlEdge(nome: string): string {
  const base = ((import.meta.env.VITE_PUBLIC_SUPABASE_URL as string) || '').replace(/\/$/, '');
  return `${base}/functions/v1/${nome}`;
}

export const MSG_SEM_CONEXAO = 'Sem conexão com o servidor. Tente de novo.';

/** `fetch` que troca a falha de rede ("Failed to fetch", "Load failed"…) por uma frase em português. */
export async function fetchPtBr(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error(MSG_SEM_CONEXAO);
  }
}

/**
 * Chama uma ação da Edge `delivery-write` com o login de quem está usando.
 * Devolve o JSON; lança Error com a mensagem do servidor quando vem `error`.
 */
export async function chamarDelivery<T = Record<string, any>>(action: string, corpo: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre de novo.');
  const res = await fetchPtBr(urlEdge('delivery-write'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ action, ...corpo }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.error) throw new Error(String(out?.message || out?.error || `Erro ${res.status}`));
  return out as T;
}

/** Situação do Mercado Pago da loja (o que o cliente vê como "pelo app"). Pública, sem login. */
export async function situacaoPagamentoOnline(tenantId: string): Promise<{ pix: boolean; cartao: boolean } | null> {
  try {
    const res = await fetch(urlEdge('online-payments'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'public_status', tenant_id: tenantId }),
    });
    const d = await res.json();
    // Erro do servidor (ou resposta sem corpo) NÃO é "Mercado Pago desligado": devolve null = "não consegui conferir".
    if (!res.ok || d?.error) return null;
    const chave = d && typeof d.public_key === 'string' ? d.public_key : '';
    return { pix: !!(d && d.enabled), cartao: !!(d && d.enabled && d.card_enabled && chave) };
  } catch {
    return null;
  }
}
