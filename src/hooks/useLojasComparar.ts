import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { fetchIfoodVendas } from '@/lib/ifoodVendas';
import { janelaDeBusca, type PedidoValor } from '@/lib/diaLoja';
import { montarLoja, type LinhaLojasRpc, type LojaComparada, type PeriodoLojas } from '@/lib/lojasComparar';
import { useOrdersPingLojas } from '@/hooks/useOrdersPing';

// Lojas em que a pessoa vê o Dashboard, lado a lado (fn_lojas_comparar + iFood). Ao vivo (períodos com hoje): pedido
// de qualquer loja recarrega o PDV em ~3 s, no máximo uma vez a cada 15 s (canal orders-ping de cada loja, uma
// consulta só para todas); o iFood é relido a cada 5 min e a API de Vendas do iFood é sincronizada no máximo a cada
// 10 min por loja (como o Dashboard faz ao abrir). `ativo` false = não busca nada; com menos de `minLojas` lojas
// (a faixa da /modulos some) para tudo depois da primeira consulta.

const PREF_OCULTAR = 'comparar_lojas_ocultar';
const SYNC_MIN_MS = 10 * 60 * 1000;
const RECARGA_MIN_MS = 15 * 1000;
const ultimoSync = new Map<string, number>();

export function useLojasComparar(periodo: PeriodoLojas, ativo = true, minLojas = 1) {
  const { user } = useAuth();
  const [linhas, setLinhas] = useState<LinhaLojasRpc[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  // iFood bruto por loja e período: `${tenant}|${periodo}|a` (atual) / `|b` (anterior)
  const [ifood, setIfood] = useState<Record<string, PedidoValor[]>>({});
  const [ifoodTick, setIfoodTick] = useState(0);
  const req = useRef(0);
  const ultimaCarga = useRef(0);

  const carregar = useCallback(async () => {
    if (!ativo) return;
    const minha = ++req.current;
    ultimaCarga.current = Date.now();
    const { data, error } = await supabase.rpc('fn_lojas_comparar', { p_periodo: periodo });
    if (minha !== req.current) return;
    if (error) { console.error('[useLojasComparar]', error); setErro(error.message); return; }
    setErro(null);
    setLinhas((data ?? []) as LinhaLojasRpc[]);
    setAtualizadoEm(new Date());
  }, [periodo, ativo]);

  // Troca de período: zera e busca de novo
  useEffect(() => { setLinhas(null); carregar(); }, [carregar]);

  // Vale a pena acompanhar? Só com lojas suficientes para mostrar e período que inclui hoje.
  const temLojas = (linhas?.length ?? 0) >= minLojas;
  const aoVivo = ativo && temLojas && periodo !== 'ontem';

  // Recarga leve a cada 2 min (o "agora": atrasados, caixa) e o iFood a cada 5 min, só com a tela visível
  useEffect(() => {
    if (!aoVivo) return;
    const t1 = setInterval(() => { if (!document.hidden) carregar(); }, 2 * 60 * 1000);
    const t2 = setInterval(() => { if (!document.hidden) setIfoodTick((k) => k + 1); }, 5 * 60 * 1000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [aoVivo, carregar]);

  // Tempo real: pedido novo/pago em qualquer loja mostrada → recarrega 3 s depois, no máximo uma vez a cada 15 s
  // (no pico, com várias lojas, o aviso não fica empurrando a recarga para depois).
  const visiveis = useMemo(() => (linhas ?? []).filter((l) => !l.oculta).map((l) => l.tenant_id), [linhas]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useOrdersPingLojas(aoVivo ? visiveis : [], () => {
    if (debounce.current) return;
    const espera = Math.max(3000, RECARGA_MIN_MS - (Date.now() - ultimaCarga.current));
    debounce.current = setTimeout(() => { debounce.current = null; carregar(); }, espera);
  });
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  // iFood: busca o bruto de cada loja mostrada (atual e anterior) quando chegam as linhas / troca o período / tick.
  // As janelas para encaixar no dia são as da última resposta (montarLoja), então uma sessão que fecha não exige busca.
  const buscados = useRef<string>('');
  useEffect(() => {
    if (!ativo || !linhas || !temLojas) return;
    const alvo = linhas.filter((l) => l.tem_ifood && !l.oculta);
    const chave = `${periodo}|${ifoodTick}|${alvo.map((l) => l.tenant_id).join(',')}`;
    if (buscados.current === chave) return;
    buscados.current = chave;
    // Sem "cancelar" na limpeza: cada recarga das linhas re-roda o efeito e descartaria a busca em andamento.
    // O resultado é guardado pela chave do período, então resposta atrasada de outro período não atrapalha.
    for (const l of alvo) {
      const { d1, d2, c1, c2, corte } = l.periodo;
      const a = janelaDeBusca(d1, d2, l.janelas_atual);
      const b = janelaDeBusca(c1, c2, l.janelas_anterior, corte ? new Date(corte) : null);
      Promise.all([fetchIfoodVendas(l.tenant_id, a.from, a.to), fetchIfoodVendas(l.tenant_id, b.from, b.to)])
        .then(([ra, rb]) => {
          setIfood((ant) => ({ ...ant, [`${l.tenant_id}|${periodo}|a`]: ra.lista, [`${l.tenant_id}|${periodo}|b`]: rb.lista }));
        })
        .catch((e) => console.error('[useLojasComparar] iFood', l.nome, e));
    }
  }, [ativo, linhas, temLojas, periodo, ifoodTick]);

  // API de Vendas do iFood só atualiza quando alguém pede: sincroniza as lojas com iFood ligado (períodos com hoje)
  useEffect(() => {
    if (!aoVivo || !linhas) return;
    const agora = Date.now();
    const alvo = linhas.filter((l) => l.sincroniza_ifood && !l.oculta && agora - (ultimoSync.get(l.tenant_id) ?? 0) > SYNC_MIN_MS);
    if (alvo.length === 0) return;
    for (const l of alvo) ultimoSync.set(l.tenant_id, agora);
    Promise.all(alvo.map((l) => invokeWithAuth('ifood-financial', { body: { action: 'sync_sales', tenant_id: l.tenant_id, days: 2 } })
      .catch(() => null)))
      .then(() => setIfoodTick((k) => k + 1));
  }, [aoVivo, linhas]);

  const lojas: LojaComparada[] = useMemo(() => (linhas ?? []).map((l) => montarLoja(
    l,
    l.tem_ifood ? ifood[`${l.tenant_id}|${periodo}|a`] ?? null : [],
    l.tem_ifood ? ifood[`${l.tenant_id}|${periodo}|b`] ?? null : [],
  )), [linhas, ifood, periodo]);

  /** Esconde/mostra uma loja só para esta pessoa (vale em qualquer aparelho: user_preferences). */
  const setOculta = useCallback(async (tenantId: string, oculta: boolean) => {
    setLinhas((ls) => ls?.map((l) => (l.tenant_id === tenantId ? { ...l, oculta } : l)) ?? ls);
    if (!user?.id) return;
    const { error } = oculta
      ? await supabase.from('user_preferences').upsert({
        user_id: user.id, tenant_id: tenantId, preference_key: PREF_OCULTAR, preference_value: '1', updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,tenant_id,preference_key' })
      : await supabase.from('user_preferences').delete()
        .eq('user_id', user.id).eq('tenant_id', tenantId).eq('preference_key', PREF_OCULTAR);
    if (error) { console.error('[useLojasComparar] ocultar', error); carregar(); }
  }, [user?.id, carregar]);

  return { lojas, carregando: ativo && linhas === null && !erro, erro, atualizadoEm, recarregar: carregar, setOculta };
}
