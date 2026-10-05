// Dados da casca nova: telas e produtos que a pessoa vê, estado da conexão/fila offline e teclado do celular.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { usePermissoes } from '@/hooks/usePermissoes';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { empresaTemPdv } from '@/lib/tipoEmpresa';
import { filtrarProdutos, filtrarTelas, type ContextoTelas } from '@/constants/telas';
import { countPendingOrders } from '@/lib/offlineDB';
import { startAutoSync, stopAutoSync } from '@/lib/offlineSync';

// Comparar lojas aparece para quem vê o Dashboard em 2+ lojas — a mesma conta da faixa "Suas lojas agora"
// de /modulos (fn_lojas_comparar). Uma leitura por pessoa enquanto a página está aberta.
const comparar = new Map<string, Promise<boolean>>();
function useVeCompararLojas(): boolean {
  const { user, canSwitchTenant } = useAuth();
  const [ve, setVe] = useState(false);
  useEffect(() => {
    if (!user?.id || !canSwitchTenant) { setVe(false); return; }
    let vivo = true;
    let p = comparar.get(user.id);
    if (!p) {
      p = Promise.resolve(supabase.rpc('fn_lojas_comparar', { p_periodo: 'hoje' }))
        .then(({ data, error }) => {
          if (error) { comparar.delete(user.id); return false; }
          return Array.isArray(data) && data.length >= 2;
        })
        .catch(() => { comparar.delete(user.id); return false; });
      comparar.set(user.id, p);
    }
    p.then((v) => { if (vivo) setVe(v); });
    return () => { vivo = false; };
  }, [user?.id, canSwitchTenant]);
  return ve;
}

export function useTelasVisiveis() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const { hasPermissao } = usePermissoes();
  const { hasModule } = useModuleAccess();
  const veCompararLojas = useVeCompararLojas();

  const ctx: ContextoTelas = {
    email: user?.email,
    perfil: user?.perfil,
    pode: hasPermissao,
    modulo: hasModule,
    pdvConfig: settings.pdv_config as unknown as Record<string, boolean | undefined>,
    kitchenView: settings.kitchen_view,
    temPdv: empresaTemPdv(user?.tenantKind),
    veCompararLojas,
  };
  const telas = useMemo(() => filtrarTelas(ctx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.email, user?.perfil, user?.tenantKind, hasPermissao, hasModule, settings.pdv_config, settings.kitchen_view, veCompararLojas]);
  const produtos = useMemo(() => filtrarProdutos(ctx, !!user?.tenantId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.perfil, user?.tenantId, hasModule]);
  return { telas, produtos };
}

/** OFFLINE e pedidos na fila de sincronização — a mesma conta do TopBar antigo (que também liga o auto-sync). */
export function useConexao() {
  const { user } = useAuth();
  const [online, setOnline] = useState(navigator.onLine);
  const [pendentes, setPendentes] = useState(0);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    if (!user?.tenantId) return;
    const tenantId = user.tenantId;
    const refresh = async () => setPendentes(await countPendingOrders(tenantId).catch(() => 0));
    refresh();
    startAutoSync(tenantId, (summary) => { if (summary.succeeded > 0) refresh(); });
    const t = setInterval(refresh, 30_000);
    return () => { stopAutoSync(); clearInterval(t); };
  }, [user?.tenantId]);

  return { online, pendentes };
}

/** Teclado aberto no celular (a área visível encolhe bastante): a barra de baixo sai do caminho. */
export function useTecladoAberto(): boolean {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const medir = () => setAberto(window.innerHeight - vv.height > 150);
    vv.addEventListener('resize', medir);
    return () => vv.removeEventListener('resize', medir);
  }, []);
  return aberto;
}

/** Hora pequena do topo (HH:MM). */
export function useHora(): string {
  const fmt = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const [hora, setHora] = useState(fmt);
  useEffect(() => {
    const t = setInterval(() => setHora(fmt()), 10_000);
    return () => clearInterval(t);
  }, []);
  return hora;
}
