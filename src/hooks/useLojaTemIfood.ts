import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// A loja ativa usa iFood? Sim se tem loja do iFood cadastrada (financeiro) ou já recebeu pedido do iFood
// (módulo Pedidos). Só o "sim" fica guardado na sessão: depois de conectar, o menu aparece sem recarregar. Usado pelo menu (tela iFood), pelas ações rápidas do assistente e pela
// linha do iFood na Hoje. null = ainda lendo.
const IFOOD_POR_LOJA = new Map<string, boolean>();

export function useLojaTemIfood(tenantId: string | undefined): boolean | null {
  const [tem, setTem] = useState<boolean | null>(tenantId ? IFOOD_POR_LOJA.get(tenantId) ?? null : false);
  useEffect(() => {
    if (!tenantId) { setTem(false); return; }
    const salvo = IFOOD_POR_LOJA.get(tenantId);
    if (salvo !== undefined) { setTem(salvo); return; }
    let vivo = true;
    setTem(null);
    Promise.all([
      supabase.from('fin_ifood_merchants').select('merchant_id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('ifood_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).limit(1),
    ]).then(([a, b]) => {
      const v = (!a.error && (a.count ?? 0) > 0) || (!b.error && (b.count ?? 0) > 0);
      if (v) IFOOD_POR_LOJA.set(tenantId, true);
      if (vivo) setTem(v);
    });
    return () => { vivo = false; };
  }, [tenantId]);
  return tem;
}
