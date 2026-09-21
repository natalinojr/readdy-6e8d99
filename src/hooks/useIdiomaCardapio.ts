// Idioma do cardápio nas telas do cliente.
//
// Por que não recarregar o cardápio ao trocar de idioma: o carregamento do
// delivery reseta etapa, endereço e (na troca de loja) carrinho. Trocar de
// idioma no meio do pedido não pode custar isso. Então buscamos SÓ as traduções
// (`get_menu_translations`) e sobrepomos em memória sobre o que já está na tela.
//
// A decoração devolve objetos NOVOS com `*_i18n` preenchido; o campo original em
// português continua intacto e é ele que vai para o carrinho e para a cozinha.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { detectarIdioma, salvarIdioma, type Idioma } from '@/lib/idiomaCardapio';
import { IDIOMA_PADRAO } from '@/i18n';
import i18n from '@/i18n';

type TipoEntidade = 'item' | 'category' | 'option_group' | 'option' | 'preset_obs';
type Mapa = Map<string, { n: string | null; d: string | null }>;

interface RespostaTraducao {
  locale?: string;
  locales?: string[];
  translations?: Array<{ t: string; id: string; n: string | null; d: string | null }>;
}

/**
 * @param edgeUrl  URL da edge do canal (delivery-write ou mesa-write).
 * @param tenantId loja; null enquanto o cardápio ainda está carregando.
 * @param disponiveis idiomas que a loja oferece (vem junto com o cardápio).
 */
export function useIdiomaCardapio(edgeUrl: string, tenantId: string | null, disponiveisProp: string[] = []) {
  const [idioma, setIdioma] = useState<Idioma>(IDIOMA_PADRAO);
  const [mapa, setMapa] = useState<Mapa>(() => new Map());
  const [carregando, setCarregando] = useState(false);
  // O totem nao carrega o cardapio pela edge publica e por isso nao recebe a
  // lista de idiomas junto. A propria resposta de traducao devolve `locales`,
  // entao a guardamos aqui e o seletor funciona igual nos dois casos.
  const [locaisDaResposta, setLocaisDaResposta] = useState<string[]>([]);

  const disponiveis = useMemo(
    () => (disponiveisProp.length > 0 ? disponiveisProp : locaisDaResposta),
    [disponiveisProp.join(','), locaisDaResposta.join(',')],
  );

  // O idioma de abertura só pode ser decidido depois que a loja diz o que
  // oferece: celular em inglês numa loja só-português continua em português.
  useEffect(() => {
    if (!tenantId) return;
    setIdioma(detectarIdioma(disponiveis));
  }, [tenantId, disponiveis.join(',')]);

  useEffect(() => {
    i18n.changeLanguage(idioma);
  }, [idioma]);

  useEffect(() => {
    let cancelado = false;
    if (!tenantId) return;
    // Em português não há tradução para aplicar, mas ainda perguntamos quais
    // idiomas a loja oferece — é isso que decide se o seletor aparece.
    if (idioma === IDIOMA_PADRAO) setMapa(new Map());
    setCarregando(true);
    (async () => {
      try {
        const res = await fetch(edgeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_menu_translations', tenant_id: tenantId, locale: idioma }),
        });
        const data: RespostaTraducao = await res.json();
        if (cancelado) return;
        setLocaisDaResposta(Array.isArray(data.locales) ? data.locales : []);
        const m: Mapa = new Map();
        for (const t of data.translations ?? []) m.set(`${t.t}:${t.id}`, { n: t.n, d: t.d });
        setMapa(m);
      } catch {
        // Sem tradução o cliente vê o cardápio em português — degrada, não quebra.
        if (!cancelado) setMapa(new Map());
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [edgeUrl, tenantId, idioma]);

  const trocarIdioma = useCallback((novo: Idioma) => {
    salvarIdioma(novo);
    setIdioma(novo);
  }, []);

  const decorar = useCallback(
    function <T extends Record<string, unknown>>(linhas: T[] | null | undefined, tipo: TipoEntidade, campoNome = 'name', campoDesc = 'description'): T[] {
      if (!linhas) return [];
      if (mapa.size === 0) return linhas;
      return linhas.map((linha) => {
        const t = mapa.get(`${tipo}:${linha.id}`);
        if (!t) return linha;
        const out: Record<string, unknown> = { ...linha };
        if (t.n) out[`${campoNome}_i18n`] = t.n;
        if (t.d) out[`${campoDesc}_i18n`] = t.d;
        return out as T;
      });
    },
    [mapa],
  );

  /**
   * Tradução avulsa por id, para telas cujo modelo já vem remapeado e não tem
   * os campos crus (o kiosk usa `item.nome`, `opcao.nome`). Devolve null quando
   * não há tradução — quem chama cai no texto em português.
   */
  const traduzir = useCallback(
    (tipo: TipoEntidade, id: string | null | undefined, campo: 'n' | 'd' = 'n'): string | null => {
      if (!id || mapa.size === 0) return null;
      const t = mapa.get(`${tipo}:${id}`);
      const v = t ? t[campo] : null;
      return v && v.trim() !== '' ? v : null;
    },
    [mapa],
  );

  const temSeletor = useMemo(() => disponiveis.length > 0, [disponiveis]);

  return { idioma, trocarIdioma, decorar, traduzir, temSeletor, disponiveis, carregandoIdioma: carregando };
}
