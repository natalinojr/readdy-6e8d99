import { useEffect, useState } from 'react';
import { X, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import type { Insumo } from '@/contexts/EstoqueContext';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface CompraHistorico {
  id: string;
  purchase_date: string;
  supplier: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit: string;
  purchase_unit?: string | null;
  purchase_factor?: number | null;
}

interface Props {
  insumo: Insumo;
  onClose: () => void;
}

export default function HistoricoComprasModal({ insumo, onClose }: Props) {
  const { user } = useAuth();
  const [compras, setCompras] = useState<CompraHistorico[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      if (!user?.tenantId) { setLoading(false); return; }
      setLoading(true);
      setError(null);

      console.log('[HistoricoComprasModal] Buscando histórico para ingrediente:', insumo.id, 'tenant:', user.tenantId);

      const { data, error: apiErr } = await invokeWithAuth<{
        data: Array<{
          id: string;
          purchase_date: string;
          supplier: string;
          quantity: number;
          unit_price: number;
          total_price: number;
          purchase_unit: string | null;
          purchase_factor: number | null;
        }>;
      }>('purchase-write', {
        body: {
          action: 'list_purchase_items',
          tenant_id: user.tenantId,
          payload: { ingredient_id: insumo.id },
        },
      });

      if (apiErr) {
        console.error('[HistoricoComprasModal] Erro API:', apiErr.message);
        setError(apiErr.message);
        setCompras([]);
        setLoading(false);
        return;
      }

      const rows = data?.data ?? [];
      console.log('[HistoricoComprasModal] Recebido', rows.length, 'registros');

      setCompras(rows.map((r) => ({
        id: r.id,
        purchase_date: r.purchase_date,
        supplier: r.supplier,
        quantity: Number(r.quantity),
        unit_price: Number(r.unit_price),
        total_price: Number(r.total_price),
        unit: insumo.unidade,
        purchase_unit: r.purchase_unit,
        purchase_factor: r.purchase_factor,
      })));
      setLoading(false);
    };
    fetch();
  }, [insumo.id, insumo.unidade, user?.tenantId]);

  // Cálculos de tendência
  const pricesOverTime = compras.slice().reverse().map((c) => c.unit_price);
  const minPrice = compras.length > 0 ? Math.min(...compras.map((c) => c.unit_price)) : 0;
  const maxPrice = compras.length > 0 ? Math.max(...compras.map((c) => c.unit_price)) : 0;
  const avgPrice = compras.length > 0
    ? compras.reduce((s, c) => s + c.unit_price, 0) / compras.length
    : 0;

  const lastPrice = compras[0]?.unit_price ?? 0;
  const prevPrice = compras[1]?.unit_price ?? 0;
  const variation = prevPrice > 0 ? ((lastPrice - prevPrice) / prevPrice) * 100 : 0;

  const totalComprado = compras.reduce((s, c) => s + c.total_price, 0);

  // Mini sparkline
  const sparklineMax = Math.max(...pricesOverTime, 0.01);
  const sparklinePoints = pricesOverTime.map((p, i) => {
    const x = compras.length === 1 ? 50 : (i / (pricesOverTime.length - 1)) * 100;
    const y = 30 - (p / sparklineMax) * 28;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Histórico de Compras</h2>
            <p className="text-xs text-zinc-500 mt-0.5">{insumo.nome}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-zinc-400">
              <i className="ri-loader-4-line animate-spin text-xl" />
              <span className="text-sm">Carregando histórico...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <i className="ri-error-warning-line text-4xl text-red-300 block mb-3" />
              <p className="text-sm font-semibold text-red-500">Erro ao carregar</p>
              <p className="text-xs text-zinc-400 mt-1 max-w-xs">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-3 text-xs text-amber-600 hover:text-amber-700 font-medium cursor-pointer"
              >
                Tentar novamente
              </button>
            </div>
          ) : compras.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <i className="ri-shopping-cart-2-line text-4xl text-zinc-200 block mb-3" />
              <p className="text-sm font-semibold text-zinc-500">Nenhuma compra registrada</p>
              <p className="text-xs text-zinc-400 mt-1">As compras aparecem aqui quando vinculadas a este insumo.</p>
            </div>
          ) : (
            <>
              {/* Cards de resumo */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-zinc-50 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-400 mb-0.5">Total comprado</p>
                  <p className="text-sm font-bold text-zinc-800">{fmt(totalComprado)}</p>
                  <p className="text-[10px] text-zinc-400">{compras.length} compra{compras.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="bg-zinc-50 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-400 mb-0.5">Preço médio</p>
                  <p className="text-sm font-bold text-zinc-800">{fmt(avgPrice)}</p>
                  <p className="text-[10px] text-zinc-400">por {insumo.unidade}</p>
                </div>
                <div className="bg-zinc-50 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-400 mb-0.5">Faixa de preço</p>
                  <p className="text-sm font-bold text-zinc-800">{fmt(minPrice)} – {fmt(maxPrice)}</p>
                  <p className="text-[10px] text-zinc-400">mín – máx</p>
                </div>
                <div className="bg-zinc-50 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-400 mb-0.5">Variação recente</p>
                  <div className="flex items-center gap-1">
                    {variation === 0 ? (
                      <Minus size={14} className="text-zinc-400" />
                    ) : variation > 0 ? (
                      <TrendingUp size={14} className="text-red-500" />
                    ) : (
                      <TrendingDown size={14} className="text-emerald-500" />
                    )}
                    <p className={`text-sm font-bold ${variation === 0 ? 'text-zinc-500' : variation > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {variation === 0 ? '—' : `${variation > 0 ? '+' : ''}${variation.toFixed(1)}%`}
                    </p>
                  </div>
                  <p className="text-[10px] text-zinc-400">vs compra anterior</p>
                </div>
              </div>

              {/* Sparkline de evolução de preço */}
              {pricesOverTime.length > 1 && (
                <div className="bg-white border border-zinc-100 rounded-xl p-4">
                  <p className="text-xs font-semibold text-zinc-600 mb-3">Evolução do Preço por {insumo.unidade}</p>
                  <div className="relative w-full">
                    <svg viewBox="0 0 100 32" className="w-full h-16" preserveAspectRatio="none">
                      {/* Area fill */}
                      <defs>
                        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
                        </linearGradient>
                      </defs>
                      {pricesOverTime.length > 1 && (
                        <polygon
                          points={`0,32 ${sparklinePoints} 100,32`}
                          fill="url(#sparkGrad)"
                        />
                      )}
                      <polyline
                        points={sparklinePoints}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {pricesOverTime.map((p, i) => {
                        const x = pricesOverTime.length === 1 ? 50 : (i / (pricesOverTime.length - 1)) * 100;
                        const y = 30 - (p / sparklineMax) * 28;
                        return (
                          <circle key={i} cx={x} cy={y} r="1.5" fill="#f59e0b" />
                        );
                      })}
                    </svg>
                    {/* Labels */}
                    <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                      <span>{compras[compras.length - 1]?.purchase_date
                        ? new Date(compras[compras.length - 1].purchase_date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
                        : ''}</span>
                      <span className="font-semibold text-amber-600">{fmt(lastPrice)}</span>
                      <span>{compras[0]?.purchase_date
                        ? new Date(compras[0].purchase_date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
                        : ''}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabela de compras */}
              <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-50 flex items-center gap-2">
                  <i className="ri-history-line text-zinc-400 text-sm" />
                  <p className="text-xs font-semibold text-zinc-600">Todas as Compras</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-50 border-b border-zinc-100">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">Data</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">Fornecedor</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-zinc-500">Qtd</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-zinc-500">Preço/{insumo.unidade}</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-zinc-500">Total</th>
                        <th className="px-4 py-2.5 text-center font-semibold text-zinc-500">Variação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {compras.map((compra, idx) => {
                        const prev = compras[idx + 1];
                        const varPct = prev && prev.unit_price > 0
                          ? ((compra.unit_price - prev.unit_price) / prev.unit_price) * 100
                          : null;
                        return (
                          <tr key={compra.id} className={`hover:bg-zinc-50 transition-colors ${idx === 0 ? 'bg-amber-50/30' : ''}`}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {idx === 0 && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full whitespace-nowrap">Última</span>
                                )}
                                <span className="text-zinc-600">
                                  {new Date(compra.purchase_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-medium text-zinc-800">
                              {compra.supplier || <span className="text-zinc-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-600">
                              {compra.quantity} {insumo.unidade}
                              {insumo.purchaseUnit && insumo.purchaseFactor && (
                                <span className="block text-[10px] text-zinc-400">
                                  {(compra.quantity / insumo.purchaseFactor).toFixed(1)} {insumo.purchaseUnit}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-zinc-800">
                              {fmt(compra.unit_price)}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-zinc-800">
                              {fmt(compra.total_price)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {varPct === null ? (
                                <span className="text-zinc-300">—</span>
                              ) : varPct === 0 ? (
                                <span className="text-zinc-400 text-[10px]">—</span>
                              ) : (
                                <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${varPct > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                                  {varPct > 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                                  {varPct > 0 ? '+' : ''}{varPct.toFixed(1)}%
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}