import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface ProductionPricePoint {
  date: string;
  price: number;
  batchId: string;
  producedQuantity: number;
  notes: string;
}

export interface ProductionPriceStats {
  points: ProductionPricePoint[];
  avg3m: number;
  avg1m: number;
  lastPrice: number;
  minPrice: number;
  maxPrice: number;
  trend: 'up' | 'down' | 'stable';
  trendPct: number;
}

const cache = new Map<string, { stats: ProductionPriceStats; ts: number }>();

export function useProductionPriceHistory(ingredientId: string | null) {
  const { user } = useAuth();
  const [stats, setStats] = useState<ProductionPriceStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!ingredientId || !user?.tenantId) {
      console.log('[useProductionPriceHistory] skip — no ingredientId or tenantId', { ingredientId, tenantId: user?.tenantId });
      return;
    }

    const cacheKey = `${user.tenantId}_prod_${ingredientId}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 60_000) {
      setStats(cached.stats);
      return;
    }

    setLoading(true);
    try {
      console.log('[useProductionPriceHistory] calling RPC for', { tenantId: user.tenantId, ingredientId });
      const { data: rows, error } = await supabase
        .rpc('get_production_price_history', {
          p_tenant_id: user.tenantId,
          p_ingredient_id: ingredientId,
        });

      console.log('[useProductionPriceHistory] RPC result:', { rows, error, rowCount: rows?.length });

      if (error) throw error;
      if (!rows || rows.length === 0) {
        setStats(null);
        setLoading(false);
        return;
      }

      const points: ProductionPricePoint[] = rows.map((b) => ({
        date: (b.produced_at as string).split('T')[0],
        price: Number(b.unit_cost ?? 0),
        batchId: b.batch_id as string,
        producedQuantity: Number(b.produced_quantity ?? 0),
        notes: (b.notes as string) || '',
      }));

      const now = new Date();
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      const oneMonthAgoStr = oneMonthAgo.toISOString().split('T')[0];

      const all = points.map((r) => r.price);
      const last30 = points.filter((r) => r.date >= oneMonthAgoStr).map((r) => r.price);

      const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);

      const lastPrice = points[points.length - 1]?.price ?? 0;
      const prevPrice = points[points.length - 2]?.price ?? lastPrice;
      const trendPct = prevPrice > 0 ? ((lastPrice - prevPrice) / prevPrice) * 100 : 0;
      const trend: 'up' | 'down' | 'stable' =
        Math.abs(trendPct) < 1 ? 'stable' : trendPct > 0 ? 'up' : 'down';

      const resultStats: ProductionPriceStats = {
        points,
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
      console.error('[useProductionPriceHistory] erro:', e);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [ingredientId, user?.tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  return { stats, loading };
}