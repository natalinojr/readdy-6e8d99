import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDateObjects } from '@/lib/dateUtils';

export interface ClienteRanking {
  pos: number;
  nome: string;
  visitas: number;
  ultimaVisita: string;
  totalGasto: number;
  ticketMedio: number;
  tipo: 'pessoa' | 'empresa';
}

export interface ClienteRisco {
  nome: string;
  diasSemVisita: number;
  ultimaVisita: string;
  visitas: number;
  totalHistorico: number;
}

export interface ClientesKpis {
  totalUnicos: number;
  novos: number;
  retornantes: number;
  frequenciaMedia: number;
  ticketMedioGeral: number;
  clientesSemVisita30: number;
  clientesSemVisita60: number;
}

export interface ClientesReportData {
  kpis: ClientesKpis;
  topClientes: ClienteRanking[];
  clientesRisco: ClienteRisco[];
}

export function useClientesReport(periodo: string) {
  const { user } = useAuth();
  const [dados, setDados] = useState<ClientesReportData>({
    kpis: {
      totalUnicos: 0, novos: 0, retornantes: 0,
      frequenciaMedia: 0, ticketMedioGeral: 0,
      clientesSemVisita30: 0, clientesSemVisita60: 0,
    },
    topClientes: [],
    clientesRisco: [],
  });
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const { from, to } = getPeriodDateObjects(periodo);
      const { data } = await supabase.rpc('fn_get_clientes_report', {
        p_tenant_id: user.tenantId,
        p_start: from.toISOString(),
        p_end: to.toISOString(),
      });

      const raw = data as Record<string, unknown>;
      const kpisRaw = (raw?.kpis ?? {}) as Record<string, number>;

      setDados({
        kpis: {
          totalUnicos: kpisRaw.totalUnicos ?? 0,
          novos: kpisRaw.novos ?? 0,
          retornantes: kpisRaw.retornantes ?? 0,
          frequenciaMedia: parseFloat(String(kpisRaw.frequenciaMedia ?? 0)),
          ticketMedioGeral: parseFloat(String(kpisRaw.ticketMedioGeral ?? 0)),
          clientesSemVisita30: kpisRaw.clientesSemVisita30 ?? 0,
          clientesSemVisita60: kpisRaw.clientesSemVisita60 ?? 0,
        },
        topClientes: ((raw?.topClientes ?? []) as Record<string, unknown>[]).map((c, i) => ({
          pos: i + 1,
          nome: c.nome as string,
          visitas: c.visitas as number,
          ultimaVisita: c.ultimaVisita as string,
          totalGasto: parseFloat(String(c.totalGasto ?? 0)),
          ticketMedio: parseFloat(String(c.ticketMedio ?? 0)),
          tipo: 'pessoa' as const,
        })),
        clientesRisco: ((raw?.clientesRisco ?? []) as Record<string, unknown>[]).map((c) => ({
          nome: c.nome as string,
          diasSemVisita: (c.diasSemVisita as number) ?? 0,
          ultimaVisita: (c.ultimaVisita as string) ?? '—',
          visitas: (c.visitas as number) ?? 0,
          totalHistorico: parseFloat(String(c.totalHistorico ?? 0)),
        })),
      });
    } catch (e) {
      console.error('useClientesReport:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, periodo]);

  useEffect(() => { carregar(); }, [carregar]);

  return { dados, loading, recarregar: carregar };
}
