import { useState, useEffect, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface PricePoint {
  date: string;
  price: number;
  supplier: string;
}

export interface IngredientPriceStats {
  points: PricePoint[];
  avg3m: number;
  avg1m: number;
  lastPrice: number;
  minPrice: number;
  maxPrice: number;
  trend: 'up' | 'down' | 'stable';
  trendPct: number;
}

const cache = new Map<string, { stats: IngredientPriceStats; ts: number }>();

export function useIngredientPriceHistory(ingredientId: string | null) {
  const { user } = useAuth();
  const [stats, setStats] = useState<IngredientPriceStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!ingredientId || !user?.tenantId) return;

    const cacheKey = `${user.tenantId}_${ingredientId}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 60_000) {
      setStats(cached.stats);
      return;
    }

    setLoading(true);
    try {
      const { data, error: apiErr } = await invokeWithAuth<{
        data: Array<{ date: string; price: number; supplier: string }>;
      }>('purchase-write', {
        body: {
          action: 'list_purchase_prices',
          tenant_id: user.tenantId,
          payload: { ingredient_id: ingredientId },
        },
      });

      if (apiErr) throw apiErr;

      const rows = data?.data ?? [];

      if (rows.length === 0) {
        setStats(null);
        setLoading(false);
        return;
      }

      const now = new Date();
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      const oneMonthAgoStr = oneMonthAgo.toISOString().split('T')[0];

      const all = rows.map((r) => r.price);
      const last30 = rows.filter((r) => r.date >= oneMonthAgoStr).map((r) => r.price);

      const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

      const lastPrice = rows[rows.length - 1]?.price ?? 0;
      const prevPrice = rows[rows.length - 2]?.price ?? lastPrice;
      const trendPct = prevPrice > 0 ? ((lastPrice - prevPrice) / prevPrice) * 100 : 0;
      const trend: 'up' | 'down' | 'stable' =
        Math.abs(trendPct) < 1 ? 'stable' : trendPct > 0 ? 'up' : 'down';

      const resultStats: IngredientPriceStats = {
        points: rows,
        avg3m: avg(all),
        avg1m: avg(last30.length > 0 ? last30 : all),
        lastPrice,
        minPrice: Math.min(...all),
        maxPrice: Math.max(...all),
        trend,
        trendPct,
      };

      cache.set(cacheKey, { stats: resultStats, ts: Date.now() });
      setStats(resultStats);
    } catch (e) {
      console.error('[useIngredientPriceHistory] erro:', e);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [ingredientId, user?.tenantId]);

  useEffect(() => { load(); }, [load]);

  return { stats, loading };
}