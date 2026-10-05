// Ligações da página de Módulos nova: a chave (recurso da loja OU casca nova da pessoa) e os terminais que
// o login abre neste aparelho. Regras puras em src/lib/modulosCara.ts.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { usePermissoes } from '@/hooks/usePermissoes';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { useRecursoLoja } from '@/hooks/useRecursoLoja';
import { useCascaNova } from '@/hooks/useCascaNova';
import { empresaTemPdv } from '@/lib/tipoEmpresa';
import type { ContextoTelas } from '@/constants/telas';
import { terminaisDoAparelho, type TerminalAparelho } from '@/lib/modulosCara';

/** Configurações da loja ativa já lidas (não os padrões "tudo ligado" de antes da 1ª carga). */
export function useSettingsProntas(): boolean {
  const { user } = useAuth();
  const { settings, loading } = useSystemSettings();
  return !loading && (!user?.tenantId || settings.tenant_id === user.tenantId);
}

/**
 * Sem loja não há recurso de loja nem preferência gravada (user_preferences é por loja): vale o último
 * valor da casca nova guardado neste aparelho para a pessoa (erpos.casca_nova:<id>).
 */
function useCascaLocalSemLoja(): boolean | null {
  const { hasNoTenants } = useAuth();
  const [v, setV] = useState<boolean | null>(hasNoTenants ? null : false);
  useEffect(() => {
    if (!hasNoTenants) { setV(false); return; }
    let vivo = true;
    supabase.auth.getSession().then(({ data }) => {
      const id = data.session?.user?.id;
      let lido = false;
      try { lido = !!id && localStorage.getItem(`erpos.casca_nova:${id}`) === '1'; } catch { /* sem storage */ }
      if (vivo) setV(lido);
    }).catch(() => { if (vivo) setV(false); });
    return () => { vivo = false; };
  }, [hasNoTenants]);
  return v;
}

/** A página nova vale para esta pessoa nesta loja? `pronta` = já dá para decidir sem piscar. */
export function usePaginaNovaAtiva(): { pronta: boolean; ativa: boolean } {
  const { hasNoTenants } = useAuth();
  const settingsProntas = useSettingsProntas();
  const recurso = useRecursoLoja('modulos_novo');
  const casca = useCascaNova();
  const semLoja = useCascaLocalSemLoja();
  if (hasNoTenants) return { pronta: semLoja !== null, ativa: semLoja === true };
  return { pronta: settingsProntas, ativa: recurso || casca.ligada };
}

/** Os terminais que este login abre (com os de cozinha desligados na loja, apagados). */
export function useTerminaisDoAparelho(): { terminais: TerminalAparelho[]; pronto: boolean } {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const { hasPermissao, loading: permLoading } = usePermissoes();
  const { hasModule } = useModuleAccess();
  const settingsProntas = useSettingsProntas();
  const terminais = useMemo(() => {
    const ctx: ContextoTelas = {
      email: user?.email,
      perfil: user?.perfil,
      pode: hasPermissao,
      modulo: hasModule,
      pdvConfig: settings.pdv_config as unknown as Record<string, boolean | undefined>,
      kitchenView: settings.kitchen_view,
      temPdv: empresaTemPdv(user?.tenantKind),
    };
    return terminaisDoAparelho(ctx);
  }, [user?.email, user?.perfil, user?.tenantKind, hasPermissao, hasModule, settings.pdv_config, settings.kitchen_view]);
  return { terminais, pronto: settingsProntas && !permLoading };
}
