import { useState, useEffect, memo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface ExpiryAlert {
  ingredient_name: string;
  batch_id: string;
  batch_code: string | null;
  quantity: number;
  unit: string;
  expires_at: string;
  days_until_expiry: number;
  status: 'expired' | 'critical' | 'warning' | 'ok';
}

const ValidadeAlertas = memo(function ValidadeAlertas({ refreshKey = 0 }: { refreshKey?: number }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<ExpiryAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.tenantId) return;
    supabase
      .from('ingredient_expiry_alerts')
      .select('*')
      .eq('tenant_id', user.tenantId)
      .in('status', ['expired', 'critical', 'warning'])
      .order('days_until_expiry', { ascending: true })
      .limit(6)
      .then(({ data }) => {
        setAlerts((data ?? []) as ExpiryAlert[]);
        setLoading(false);
      });
  }, [user?.tenantId, refreshKey]);

  const expired = alerts.filter((a) => a.status === 'expired').length;
  const critical = alerts.filter((a) => a.status === 'critical').length;
  const warning = alerts.filter((a) => a.status === 'warning').length;
  const total = expired + critical + warning;

  if (!loading && total === 0) return null;

  return (
    <div className="bg-white border border-zinc-100 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">Validade de Ingredientes</h3>
          <p className="text-xs text-zinc-400 mt-0.5">Lotes próximos do vencimento</p>
        </div>
        <div className="flex items-center gap-1.5">
          {expired > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
              {expired} vencido{expired !== 1 ? 's' : ''}
            </span>
          )}
          {critical > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-600">
              {critical} crítico{critical !== 1 ? 's' : ''}
            </span>
          )}
          {warning > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-600">
              {warning} atenção
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => {
            const isExpired = a.status === 'expired';
            const isCritical = a.status === 'critical';
            const bg = isExpired ? 'bg-red-50' : isCritical ? 'bg-orange-50' : 'bg-amber-50';
            const textColor = isExpired ? 'text-red-700' : isCritical ? 'text-orange-700' : 'text-amber-700';
            const subColor = isExpired ? 'text-red-500' : isCritical ? 'text-orange-500' : 'text-amber-500';
            const badge = isExpired ? 'bg-red-100 text-red-600' : isCritical ? 'bg-orange-100 text-orange-600' : 'bg-amber-100 text-amber-600';
            const icon = isExpired ? 'ri-error-warning-fill' : isCritical ? 'ri-alarm-warning-fill' : 'ri-alert-fill';
            const daysLabel = a.days_until_expiry < 0
              ? `${Math.abs(a.days_until_expiry)}d atrás`
              : a.days_until_expiry === 0
              ? 'Hoje!'
              : `${a.days_until_expiry}d`;

            return (
              <div key={a.batch_id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${bg}`}>
                <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${subColor}`}>
                  <i className={`${icon} text-sm`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold truncate ${textColor}`}>{a.ingredient_name}</p>
                  <p className={`text-[10px] ${subColor}`}>
                    {a.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {a.unit}
                    {a.batch_code ? ` · Lote ${a.batch_code}` : ''}
                  </p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${badge}`}>
                  {daysLabel}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={() => navigate('/estoque')}
        className="mt-3 w-full text-xs text-zinc-400 hover:text-amber-600 font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1 py-1"
      >
        Ver todos em Estoque
        <i className="ri-arrow-right-line text-xs" />
      </button>
    </div>
  );
});

export default ValidadeAlertas;
