import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { aparelhoAtual, criarDebounce, perfilRegistra, rotaParaTelemetria } from '@/lib/telaAberta';

// Um por aba: a mesma rota (por loja) conta no máximo 1x por minuto.
const podeContar = criarDebounce(60_000);

/**
 * Telemetria de telas (2026-10-05): na troca de rota, avisa o banco que esta pessoa abriu esta tela
 * (RPC fn_tela_aberta → public.telas_abertas). Nunca em rota pública nem com perfil totem/tablet.
 * Falha em silêncio: telemetria não pode atrapalhar ninguém.
 */
export function useTelaAberta() {
  const { pathname } = useLocation();
  const { isAuthenticated, user } = useAuth();
  const tenantId = user?.tenantId;
  const perfil = user?.perfil;

  useEffect(() => {
    if (!isAuthenticated || !tenantId || !perfilRegistra(perfil)) return;
    const rota = rotaParaTelemetria(pathname);
    if (!rota || !podeContar(`${tenantId}|${rota}`)) return;
    try {
      void Promise.resolve(supabase.rpc('fn_tela_aberta', { p_tenant: tenantId, p_rota: rota, p_aparelho: aparelhoAtual() }))
        .then(() => undefined, () => undefined);
    } catch { /* silencioso */ }
  }, [pathname, isAuthenticated, tenantId, perfil]);
}
