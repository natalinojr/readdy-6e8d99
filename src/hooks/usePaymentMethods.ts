import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { notifyReload, subscribeReload } from '@/lib/reloadSignal';

export interface PaymentMethod {
  id: string;
  nome: string;
  tipo: 'dinheiro' | 'credito' | 'debito' | 'pix' | 'vale';
  ativo: boolean;
  taxa: number;
  exigeTroco: boolean;
  ordem: number;
  icone: string;
  prazoRecebimento: number; // dias para recebimento: 0=D+0, 1=D+1, 30=D+30
}

const DB_TO_TIPO: Record<string, PaymentMethod['tipo']> = {
  cash: 'dinheiro',
  credit_card: 'credito',
  debit_card: 'debito',
  pix: 'pix',
  meal_voucher: 'vale',
  other: 'vale',
  dinheiro: 'dinheiro',
  credito: 'credito',
  debito: 'debito',
  vale: 'vale',
};

const TIPO_ICONE: Record<string, string> = {
  dinheiro: 'ri-money-dollar-circle-line',
  credito: 'ri-bank-card-line',
  debito: 'ri-bank-card-2-line',
  pix: 'ri-qr-code-line',
  vale: 'ri-coupon-line',
};

interface DBPaymentMethod {
  id: string;
  name: string;
  type: string;
  is_active: boolean | null;
  fee_percentage: number | string | null;
  requires_change: boolean | null;
  sort_order: number | null;
  days_to_receive?: number | null;
}

function mapPaymentMethod(row: DBPaymentMethod): PaymentMethod {
  const tipo: PaymentMethod['tipo'] = DB_TO_TIPO[row.type] ?? 'dinheiro';
  return {
    id: row.id,
    nome: row.name,
    tipo,
    ativo: row.is_active ?? true,
    taxa: Number(row.fee_percentage ?? 0),
    exigeTroco: row.requires_change ?? false,
    ordem: row.sort_order ?? 0,
    icone: TIPO_ICONE[tipo] ?? 'ri-wallet-line',
    prazoRecebimento: Number(row.days_to_receive ?? 0),
  };
}

const CHANNEL = 'payment_methods';

export function usePaymentMethods() {
  const { user } = useAuth();
  const [formas, setFormas] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const unsub = subscribeReload(CHANNEL, () => {
      if (mountedRef.current) setTick(t => t + 1);
    });
    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, []);

  const carregar = useCallback(async () => {
    if (!user?.tenantId) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .rpc('fn_get_payment_methods', { p_tenant_id: user.tenantId });

      if (error) {
        console.error('[usePaymentMethods] load error:', error.code, error.message);
      } else if (data) {
        const methods: DBPaymentMethod[] = Array.isArray(data) ? (data as DBPaymentMethod[]) : [];

        if (mountedRef.current) setFormas(methods.map(mapPaymentMethod));
      }
    } catch (e) {
      console.error('[usePaymentMethods] unexpected error:', e);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => { carregar(); }, [carregar, tick]);

  const recarregar = useCallback(() => {
    notifyReload(CHANNEL);
  }, []);

  const formasAtivas = formas.filter((f) => f.ativo);

  return { formas, formasAtivas, loading, recarregar };
}
