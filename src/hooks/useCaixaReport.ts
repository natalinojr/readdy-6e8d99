import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface CashTransaction {
  id: string;
  hora: string;
  valor_venda: number;
  valor_pago: number;
  troco: number;
  operador: string | null;
  numero_pedido: string | null;
  origem: string | null;
  is_refunded: boolean;
}

export interface CashMovimento {
  tipo: 'out' | 'in';
  valor: number;
  motivo: string | null;
  hora: string;
}

export interface CashMovimentos {
  retiradas: number;
  adicoes: number;
  total_retiradas: number;
  total_adicoes: number;
  lista: CashMovimento[];
}

export interface CashRegisterInfo {
  id: string;
  opening_value: number;
  closing_value_expected: number | null;
  closing_value_actual: number | null;
  closing_difference: number | null;
  closing_notes: string | null;
  opened_at: string;
  closed_at: string | null;
  status: string;
  operador?: string | null;
  total_retiradas?: number;
  total_adicoes?: number;
}

export interface PorFormaPagamento {
  forma: string;
  tipo: string;
  total: number;
  count: number;
}

export interface PorOrigem {
  origem: string;
  pedidos: number;
  total: number;
}

export interface CashSession {
  id: string;
  numero: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  closing_amount_declared: number | null;
  operador: string | null;
  faturamento: number;
  num_pedidos: number;
  num_cancelados: number;
  total_descontos: number;
  total_troco: number;
  cash_register: CashRegisterInfo | null;
  cash_registers: CashRegisterInfo[];
  movimentos: CashMovimentos;
  por_forma_pagamento: PorFormaPagamento[];
  por_origem: PorOrigem[];
  cash_transactions: CashTransaction[];
}

export interface CaixaFiltros {
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;   // YYYY-MM-DD
}

export function useCaixaReport(filtros?: CaixaFiltros) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      // Tentar RPC primeiro
      const { data, error } = await supabase.rpc('fn_get_cash_sessions_v2', {
        p_tenant_id: user.tenantId,
        p_limit: 60,
        p_start_date: filtros?.startDate ?? null,
        p_end_date: filtros?.endDate ?? null,
      });

      if (error) {
        console.error('[useCaixaReport] RPC error:', error);
      }

      let rawSessions: CashSession[] = [];
      if (Array.isArray(data) && data.length > 0) {
        // RPC retorna SETOF jsonb: cada row pode ser o objeto direto ou wrapper
        rawSessions = data.map((row: any) => {
          // Se a row for um objeto com chave 'fn_get_cash_sessions_v2', desembrulha
          if (row && typeof row === 'object' && 'fn_get_cash_sessions_v2' in row) {
            return row.fn_get_cash_sessions_v2;
          }
          // Row já é o objeto direto
          return row;
        }).filter((r: any) => r && r.id);
      }

      // Fallback: se RPC nao retornou nada, buscar direto das tabelas
      if (rawSessions.length === 0 && !error) {
        console.log('[useCaixaReport] RPC vazio, usando fallback direto...');
        // Não usa .eq('tenant_id') — o RLS já filtra via JWT, evitar conflito
        let sessQuery = supabase
          .from('sessions')
          .select('id, number, status, opened_at, closed_at, opening_amount, closing_amount_declared, opened_by')
          .eq('tenant_id', user.tenantId)
          .eq('is_training', false)
          .order('opened_at', { ascending: false })
          .limit(60);

        if (filtros?.startDate) {
          sessQuery = sessQuery.gte('opened_at', `${filtros.startDate}T00:00:00`);
        }
        if (filtros?.endDate) {
          sessQuery = sessQuery.lte('opened_at', `${filtros.endDate}T23:59:59`);
        }

        const { data: sessData, error: sessError } = await sessQuery;

        if (sessError) {
          console.error('[useCaixaReport] Fallback error:', sessError);
        } else if (sessData && sessData.length > 0) {
          const sessionIds = sessData.map((s) => s.id).filter(Boolean);

          let registersMap: Record<string, any[]> = {};
          let ordersMap: Record<string, { total: number; count: number; cancelados: number }> = {};

          if (sessionIds.length > 0) {
            const [regResult, ordersResult] = await Promise.all([
              supabase
                .from('cash_registers')
                .select('id, session_id, opening_value, closing_value_expected, closing_value_actual, closing_difference, closing_notes, opened_at, closed_at, status, total_retiradas, total_adicoes')
                .eq('tenant_id', user.tenantId)
                .in('session_id', sessionIds),
              supabase
                .from('orders')
                .select('session_id, total_amount, status')
                .eq('tenant_id', user.tenantId)
                .in('session_id', sessionIds)
                .eq('is_training', false)
                .eq('is_draft', false),
            ]);

            if (!regResult.error && regResult.data) {
              registersMap = regResult.data.reduce((acc, r) => {
                const key = r.session_id;
                if (!acc[key]) acc[key] = [];
                acc[key].push(r);
                return acc;
              }, {} as Record<string, any[]>);
            }

            if (!ordersResult.error && ordersResult.data) {
              for (const o of ordersResult.data) {
                const sid = o.session_id;
                if (!ordersMap[sid]) ordersMap[sid] = { total: 0, count: 0, cancelados: 0 };
                if (o.status === 'cancelled') {
                  ordersMap[sid].cancelados += 1;
                } else {
                  ordersMap[sid].total += Number(o.total_amount ?? 0);
                  ordersMap[sid].count += 1;
                }
              }
            }
          }

          rawSessions = sessData.map((sess: any) => {
            const regs = registersMap[sess.id] ?? [];
            const cr = regs[0] ?? null;
            const ords = ordersMap[sess.id] ?? { total: 0, count: 0, cancelados: 0 };
            return {
              id: sess.id,
              numero: sess.number ?? '-',
              status: sess.status,
              opened_at: sess.opened_at,
              closed_at: sess.closed_at,
              opening_amount: sess.opening_amount ?? 0,
              closing_amount_declared: sess.closing_amount_declared,
              operador: sess.opened_by ?? null,
              faturamento: ords.total,
              num_pedidos: ords.count,
              num_cancelados: ords.cancelados,
              total_descontos: 0,
              total_troco: 0,
              cash_register: cr,
              cash_registers: regs,
              movimentos: {
                retiradas: cr?.total_retiradas ?? 0,
                adicoes: cr?.total_adicoes ?? 0,
                total_retiradas: cr?.total_retiradas ?? 0,
                total_adicoes: cr?.total_adicoes ?? 0,
                lista: [],
              },
              por_forma_pagamento: [],
              por_origem: [],
            };
          });
        }
      }

      const normalized = rawSessions.map((s) => ({
        ...s,
        num_cancelados: s.num_cancelados ?? 0,
        total_descontos: s.total_descontos ?? 0,
        total_troco: s.total_troco ?? 0,
        por_forma_pagamento: s.por_forma_pagamento ?? [],
        por_origem: s.por_origem ?? [],
        cash_registers: s.cash_registers ?? [],
        cash_transactions: s.cash_transactions ?? [],
        movimentos: {
          ...s.movimentos,
          lista: s.movimentos?.lista ?? [],
        },
      }));
      setSessions(normalized);
    } catch (e) {
      console.error('[useCaixaReport]', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, filtros?.startDate, filtros?.endDate]);

  useEffect(() => { load(); }, [load]);

  return { sessions, loading, reload: load };
}