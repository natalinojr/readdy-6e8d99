import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface PosicaoMotoboy {
  driver_id: string;
  nome: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  recorded_at: string;
}

// Posições mais velhas que isso não aparecem no mapa (motoboy que desligou/fechou a tela).
const JANELA_MS = 12 * 3600 * 1000;
const DEBOUNCE_MS = 4000;

/**
 * Última posição dos motoboys da loja (tabela `delivery_driver_positions`, RLS por loja).
 * Carga inicial 1x e depois só quando chega o broadcast público `drivers-ping:<tenant>`
 * (payload mínimo { driver_id }, enviado pela fn_driver_ping) — refetch com debounce de 4 s.
 * Sem polling e sem postgres_changes. Só assina enquanto `enabled` (ex.: mapa aberto).
 */
export function useDriverPositions(tenantId: string | null | undefined, enabled: boolean) {
  const [posicoes, setPosicoes] = useState<PosicaoMotoboy[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    const desde = new Date(Date.now() - JANELA_MS).toISOString();
    const { data } = await supabase
      .from('delivery_driver_positions')
      .select('driver_id, lat, lng, accuracy, recorded_at, driver:delivery_drivers!driver_id(name, is_active)')
      .eq('tenant_id', tenantId)
      .gte('recorded_at', desde);
    type Row = { driver_id: string; lat: number; lng: number; accuracy: number | null; recorded_at: string; driver?: { name: string | null; is_active: boolean | null } | { name: string | null; is_active: boolean | null }[] | null };
    const lista = ((data ?? []) as Row[]).flatMap((r) => {
      const d = Array.isArray(r.driver) ? r.driver[0] : r.driver;
      if (d && d.is_active === false) return [];
      return [{ driver_id: r.driver_id, nome: d?.name ?? 'Motoboy', lat: Number(r.lat), lng: Number(r.lng), accuracy: r.accuracy != null ? Number(r.accuracy) : null, recorded_at: r.recorded_at }];
    });
    setPosicoes(lista);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !enabled) return;
    carregar();
    const ch = supabase
      .channel(`drivers-ping:${tenantId}`)
      .on('broadcast', { event: 'driver_position' }, () => {
        if (timerRef.current) return; // já tem um refetch agendado
        timerRef.current = setTimeout(() => { timerRef.current = null; carregar(); }, DEBOUNCE_MS);
      })
      .subscribe();
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      supabase.removeChannel(ch);
    };
  }, [tenantId, enabled, carregar]);

  return { posicoes, recarregar: carregar };
}

/** "agora", "há 3 min", "há 1h05". */
export function haQuanto(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}
