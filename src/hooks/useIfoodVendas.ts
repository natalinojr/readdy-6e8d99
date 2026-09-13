import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDates } from '@/lib/dateUtils';
import { fetchIfoodVendas, type IfoodVendas } from '@/lib/ifoodVendas';

// Vendas do iFood do período dos Relatórios ('Hoje', '7d', 'custom:AAAA-MM-DD:AAAA-MM-DD'…).
// Período vazio = desligado (ex.: modo sessão, em que o iFood não entra).
export function useIfoodVendas(periodo: string) {
  const { user } = useAuth();
  const [data, setData] = useState<IfoodVendas | null>(null);

  useEffect(() => {
    if (!user?.tenantId || !periodo) { setData(null); return; }
    let vivo = true;
    const { from, to } = getPeriodDates(periodo);
    fetchIfoodVendas(user.tenantId, from, to).then((d) => { if (vivo) setData(d); });
    return () => { vivo = false; };
  }, [user?.tenantId, periodo]);

  return { data };
}
