import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDates } from '@/lib/dateUtils';
import { fetchIfoodVendas, type IfoodVendas } from '@/lib/ifoodVendas';

// Vendas do iFood do período dos Relatórios ('Hoje', '7d', 'custom:AAAA-MM-DD:AAAA-MM-DD'…).
// Período vazio = desligado. `intervalo` (ISO) substitui o período — ex.: janela da sessão de caixa.
export function useIfoodVendas(periodo: string, intervalo?: { from: string; to: string } | null) {
  const { user } = useAuth();
  const [data, setData] = useState<IfoodVendas | null>(null);

  useEffect(() => {
    if (!user?.tenantId || (!periodo && !intervalo)) { setData(null); return; }
    let vivo = true;
    const { from, to } = intervalo ?? getPeriodDates(periodo);
    fetchIfoodVendas(user.tenantId, from, to).then((d) => { if (vivo) setData(d); });
    return () => { vivo = false; };
  }, [user?.tenantId, periodo, intervalo?.from, intervalo?.to]);

  return { data };
}
