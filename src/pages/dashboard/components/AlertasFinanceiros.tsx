import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useFinanceiroAlertas } from '@/hooks/useFinanceiroAlertas';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const URGENCIA_CONFIG = {
  alta: {
    dot: 'bg-red-500',
    badge: 'bg-red-100 text-red-700 border-red-200',
    icon: 'ri-error-warning-line text-red-500',
    barColor: 'bg-red-500',
    label: 'Urgente',
  },
  media: {
    dot: 'bg-amber-400',
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    icon: 'ri-alarm-warning-line text-amber-500',
    barColor: 'bg-amber-400',
    label: 'Atenção',
  },
  baixa: {
    dot: 'bg-zinc-400',
    badge: 'bg-zinc-100 text-zinc-500 border-zinc-200',
    icon: 'ri-information-line text-zinc-400',
    barColor: 'bg-zinc-300',
    label: 'Info',
  },
};

const TIPO_ICON: Record<string, string> = {
  conta_vencida: 'ri-calendar-close-line',
  conta_vencendo: 'ri-calendar-event-line',
  folha_pendente: 'ri-team-line',
  orcamento_expirando: 'ri-file-list-3-line',
  compra_recebida_pendente: 'ri-truck-line',
};

const TIPO_ROUTE: Record<string, string> = {
  conta_vencida: '/financeiro',
  conta_vencendo: '/financeiro',
  folha_pendente: '/financeiro',
  orcamento_expirando: '/financeiro',
  compra_recebida_pendente: '/financeiro',
};

const TIPO_TAB: Record<string, string> = {
  conta_vencida: 'pagar',
  conta_vencendo: 'pagar',
  folha_pendente: 'rh',
  orcamento_expirando: 'orcamentos',
  compra_recebida_pendente: 'compras',
};

export default function AlertasFinanceiros() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { alertas, totalUrgente, contasVencidas, contasVencendo, folhaPendente, loading } = useFinanceiroAlertas();

  if (!user || !['admin', 'gerente'].includes(user.perfil)) return null;
  if (loading) return null;
  if (alertas.length === 0) return null;

  const totalAlertas = alertas.length;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100">
        <div className="flex items-center gap-2.5">
          <div className={`w-7 h-7 flex items-center justify-center rounded-lg ${totalUrgente > 0 ? 'bg-red-100' : 'bg-amber-100'}`}>
            <i className={`text-sm ${totalUrgente > 0 ? 'ri-alarm-warning-line text-red-500' : 'ri-alarm-line text-amber-500'}`} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-800">Alertas Financeiros</h3>
            <p className="text-xs text-zinc-400">{totalAlertas} alerta{totalAlertas > 1 ? 's' : ''} ativo{totalAlertas > 1 ? 's' : ''}</p>
          </div>
          {totalUrgente > 0 && (
            <span className="text-[10px] font-black bg-red-500 text-white px-2 py-0.5 rounded-full animate-pulse">
              {totalUrgente} urgente{totalUrgente > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          onClick={() => navigate('/financeiro')}
          className="text-xs text-amber-600 hover:text-amber-700 font-semibold cursor-pointer whitespace-nowrap transition-colors"
        >
          Ver financeiro →
        </button>
      </div>

      {/* Resumo rápido em pills */}
      {(contasVencidas > 0 || contasVencendo > 0 || folhaPendente > 0) && (
        <div className="flex gap-2 px-5 py-3 border-b border-zinc-100 flex-wrap">
          {contasVencidas > 0 && (
            <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span className="text-xs font-semibold text-red-700">{contasVencidas} vencida{contasVencidas > 1 ? 's' : ''}</span>
            </div>
          )}
          {contasVencendo > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-xs font-semibold text-amber-700">{contasVencendo} vencendo</span>
            </div>
          )}
          {folhaPendente > 0 && (
            <div className="flex items-center gap-1.5 bg-zinc-100 border border-zinc-200 rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
              <span className="text-xs font-semibold text-zinc-600">{folhaPendente} func. sem pagamento</span>
            </div>
          )}
        </div>
      )}

      {/* Alertas */}
      <div className="divide-y divide-zinc-50">
        {alertas.map((alerta, idx) => {
          const cfg = URGENCIA_CONFIG[alerta.urgencia];
          const icon = TIPO_ICON[alerta.tipo] ?? 'ri-information-line';

          return (
            <button
              key={idx}
              onClick={() => navigate(TIPO_ROUTE[alerta.tipo] ?? '/financeiro', { state: { activeTab: TIPO_TAB[alerta.tipo] ?? 'visao' } })}
              className="w-full flex items-start gap-3.5 px-5 py-3.5 hover:bg-zinc-50 transition-colors text-left cursor-pointer"
            >
              {/* Ícone */}
              <div className={`w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 mt-0.5 ${
                alerta.urgencia === 'alta' ? 'bg-red-100' :
                alerta.urgencia === 'media' ? 'bg-amber-100' : 'bg-zinc-100'
              }`}>
                <i className={`${icon} text-sm ${
                  alerta.urgencia === 'alta' ? 'text-red-600' :
                  alerta.urgencia === 'media' ? 'text-amber-600' : 'text-zinc-500'
                }`} />
              </div>

              {/* Texto */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <p className="text-sm font-semibold text-zinc-800 leading-tight">{alerta.titulo}</p>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cfg.badge}`}>
                    {cfg.label}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed">{alerta.descricao}</p>
              </div>

              {/* Valor */}
              {alerta.valor !== undefined && (
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-bold ${
                    alerta.urgencia === 'alta' ? 'text-red-600' :
                    alerta.urgencia === 'media' ? 'text-amber-600' : 'text-zinc-600'
                  }`}>
                    {fmt(alerta.valor)}
                  </p>
                </div>
              )}

              <i className="ri-arrow-right-s-line text-zinc-300 text-sm flex-shrink-0 mt-1" />
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 bg-zinc-50 border-t border-zinc-100">
        <button
          onClick={() => navigate('/financeiro', { state: { activeTab: 'pagar' } })}
          className="w-full py-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700 cursor-pointer transition-colors"
        >
          Abrir Contas a Pagar →
        </button>
      </div>
    </div>
  );
}
