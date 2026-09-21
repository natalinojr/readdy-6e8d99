// Idioma do cardápio do CLIENTE (delivery, mesa-qr, totem).
//
// Regra que sustenta tudo: o texto traduzido chega do backend em campos
// SEPARADOS (`name_i18n`, `description_i18n`, `text_i18n`) e o português
// continua em `name`/`description`/`text`. Aqui só escolhemos qual mostrar.
// Nada do que sai daqui vai para o pedido — carrinho, KDS e impressora da
// cozinha usam sempre o campo em português. Ver supabase/functions/_shared/menu-i18n.ts.

import { CHAVE_IDIOMA, IDIOMA_PADRAO, normalizarIdioma, type Idioma } from '../i18n';

export type { Idioma };

/** O que o cliente escolheu antes neste aparelho. */
export function idiomaSalvo(): Idioma | null {
  try {
    return normalizarIdioma(localStorage.getItem(CHAVE_IDIOMA));
  } catch {
    return null;
  }
}

export function salvarIdioma(idioma: Idioma): void {
  try {
    localStorage.setItem(CHAVE_IDIOMA, idioma);
  } catch {
    /* navegador sem storage (aba anônima, WebView travado): segue sem lembrar */
  }
}

/**
 * Qual idioma abrir.
 * 1. o que o cliente já escolheu aqui;
 * 2. o idioma do aparelho, se a loja oferecer;
 * 3. português.
 * `disponiveis` vem da loja (`locales` na resposta do cardápio) — loja que só
 * fala português nunca sai do português, mesmo com celular em inglês.
 */
export function detectarIdioma(disponiveis: string[]): Idioma {
  const ofertados = new Set<string>(['pt-BR', ...disponiveis.map((l) => normalizarIdioma(l)).filter(Boolean) as string[]]);

  const escolhido = idiomaSalvo();
  if (escolhido && ofertados.has(escolhido)) return escolhido;

  const doAparelho = normalizarIdioma(typeof navigator !== 'undefined' ? navigator.language : null);
  if (doAparelho && ofertados.has(doAparelho)) return doAparelho;

  return IDIOMA_PADRAO;
}

/** A loja oferece mais de um idioma? Se não, o seletor nem aparece. */
export function temMaisDeUmIdioma(disponiveis: string[] | null | undefined): boolean {
  return Array.isArray(disponiveis) && disponiveis.length > 0;
}

/**
 * Texto para MOSTRAR: a tradução quando existe, senão o português.
 * O fallback é por campo — item com nome traduzido e descrição sem tradução
 * mostra o nome em inglês e a descrição em português, em vez de sumir com ela.
 */
export function tx<T extends object>(linha: T | null | undefined, campo = 'name'): string {
  if (!linha) return '';
  const l = linha as Record<string, unknown>;
  const traduzido = l[`${campo}_i18n`];
  if (typeof traduzido === 'string' && traduzido.trim() !== '') return traduzido;
  const original = l[campo];
  return typeof original === 'string' ? original : '';
}

/**
 * Texto para BUSCAR: junta português e tradução, para o cliente achar o prato
 * digitando em qualquer um dos dois ("chicken" e "frango" acham o mesmo item).
 */
export function txBusca<T extends object>(linha: T | null | undefined, campo = 'name'): string {
  if (!linha) return '';
  const l = linha as Record<string, unknown>;
  const o = l[campo];
  const t = l[`${campo}_i18n`];
  return `${typeof o === 'string' ? o : ''} ${typeof t === 'string' ? t : ''}`.toLowerCase();
}

/** URL de uma Edge Function publica (usada pelos canais do cliente). */
export function edgeUrl(nome: string): string {
  const base = ((import.meta.env.VITE_PUBLIC_SUPABASE_URL as string) || '').replace(/\/$/, '');
  return base + '/functions/v1/' + nome;
}
