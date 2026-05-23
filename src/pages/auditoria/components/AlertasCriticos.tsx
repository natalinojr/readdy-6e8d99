import { useMemo } from 'react';
import { AlertTriangle, TrendingDown, UserX, DollarSign, Clock } from 'lucide-react';
import { type EventoAuditoria, ALERT_THRESHOLDS } from '@/constants/auditoria';

interface AlertasCriticosProps {
  eventos: EventoAuditoria[];
  onFiltrarUsuario: (usuario: string) => void;
}

interface AlertaItem {
  id: string;
  tipo: 'cancelamentos_frequentes' | 'desconto_alto' | 'sangria_alta' | 'login_falho' | 'cancelamento_alto';
  titulo: string;
  descricao: string;
  usuario?: string;
  valor?: number;
  count?: number;
  severidade: 'critico' | 'aviso';
  hora: string;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export default function AlertasCriticos({ eventos, onFiltrarUsuario }: AlertasCriticosProps) {
  const alertas = useMemo<AlertaItem[]>(() => {
    const result: AlertaItem[] = [];
    const agora = new Date();
    const trinta = new Date(agora.getTime() - 30 * 60 * 1000);

    // 1. Múltiplos cancelamentos por usuário nos últimos 30 min
    const cancelamentosRecentes = eventos.filter((e) => {
      if (e.tipo !== 'pedido_cancelado' && e.tipo !== 'item_cancelado') return false;
      const [h, m] = e.hora.split(':').map(Number);
      const evDate = new Date();
      evDate.setHours(h, m, 0, 0);
      return evDate >= trinta;
    });

    const cancelPorUsuario: Record<string, EventoAuditoria[]> = {};
    cancelamentosRecentes.forEach((e) => {
      if (!cancelPorUsuario[e.usuario]) cancelPorUsuario[e.usuario] = [];
      cancelPorUsuario[e.usuario].push(e);
    });

    Object.entries(cancelPorUsuario).forEach(([usuario, evs]) => {
      if (evs.length >= ALERT_THRESHOLDS.multiploCancelamentosMin) {
        result.push({
          id: `cancel_freq_${usuario}`,
          tipo: 'cancelamentos_frequentes',
          titulo: 'Cancelamentos frequentes',
          descricao: `${evs.length} cancelamentos em 30 min`,
          usuario,
          count: evs.length,
          severidade: 'critico',
          hora: evs[0].hora,
        });
      }
    });

    // 2. Cancelamentos de alto valor
    eventos
      .filter((e) => e.tipo === 'pedido_cancelado')
      .forEach((e) => {
        const match = e.descricao.match(/R\$\s*([\d.,]+)/);
        if (match) {
          const valor = parseFloat(match[1].replace('.', '').replace(',', '.'));
          if (valor >= ALERT_THRESHOLDS.cancelamentoAltoValor) {
            result.push({
              id: `cancel_alto_${e.id}`,
              tipo: 'cancelamento_alto',
              titulo: 'Cancelamento de alto valor',
              descricao: `Pedido cancelado: ${fmt(valor)}`,
              usuario: e.usuario,
              valor,
              severidade: 'critico',
              hora: e.hora,
            });
          }
        }
      });

    // 3. Descontos de alto valor
    eventos
      .filter((e) => e.tipo === 'desconto_aplicado')
      .forEach((e) => {
        const match = e.descricao.match(/R\$\s*([\d.,]+)/);
        if (match) {
          const valor = parseFloat(match[1].replace('.', '').replace(',', '.'));
          if (valor >= ALERT_THRESHOLDS.descontoAltoValor) {
            result.push({
              id: `desc_alto_${e.id}`,
              tipo: 'desconto_alto',
              titulo: 'Desconto de alto valor',
              descricao: `Desconto aplicado: ${fmt(valor)}`,
              usuario: e.usuario,
              valor,
              severidade: 'aviso',
              hora: e.hora,
            });
          }
        }
      });

    // 4. Sangrias de alto valor
    eventos
      .filter((e) => e.tipo === 'sangria')
      .forEach((e) => {
        const match = e.descricao.match(/R\$\s*([\d.,]+)/);
        if (match) {
          const valor = parseFloat(match[1].replace('.', '').replace(',', '.'));
          if (valor >= ALERT_THRESHOLDS.sangriaAltoValor) {
            result.push({
              id: `sangria_alto_${e.id}`,
              tipo: 'sangria_alta',
              titulo: 'Sangria de alto valor',
              descricao: `Retirada de caixa: ${fmt(valor)}`,
              usuario: e.usuario,
              valor,
              severidade: 'critico',
              hora: e.hora,
            });
          }
        }
      });

    // 5. Tentativas de login falhas
    const loginsFalhos = eventos.filter((e) => e.tipo === 'acesso_login_falhou');
    if (loginsFalhos.length >= 3) {
      result.push({
        id: 'login_falho_multiplo',
        tipo: 'login_falho',
        titulo: 'Múltiplas tentativas de login falhas',
        descricao: `${loginsFalhos.length} tentativas falhas registradas`,
        count: loginsFalhos.length,
        severidade: 'critico',
        hora: loginsFalhos[0]?.hora ?? '--:--',
      });
    }

    // Ordenar: críticos primeiro, depois por hora
    return result
      .sort((a, b) => {
        if (a.severidade !== b.severidade) return a.severidade === 'critico' ? -1 : 1;
        return b.hora.localeCompare(a.hora);
      })
      .slice(0, 8);
  }, [eventos]);

  if (alertas.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-center gap-3">
        <div className="w-8 h-8 flex items-center justify-center bg-emerald-100 rounded-lg flex-shrink-0">
          <i className="ri-shield-check-line text-emerald-600 text-base" />
        </div>
        <div>
          <p className="text-xs font-bold text-emerald-800">Nenhum alerta ativo</p>
          <p className="text-[10px] text-emerald-600">Sem atividades suspeitas no período filtrado</p>
        </div>
      </div>
    );
  }

  const iconePorTipo: Record<AlertaItem['tipo'], JSX.Element> = {
    cancelamentos_frequentes: <TrendingDown size={14} />,
    cancelamento_alto: <DollarSign size={14} />,
    desconto_alto: <DollarSign size={14} />,
    sangria_alta: <TrendingDown size={14} />,
    login_falho: <UserX size={14} />,
  };

  return (
    <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 bg-red-50">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 flex items-center justify-center">
            <AlertTriangle size={14} className="text-red-500" />
          </div>
          <p className="text-xs font-bold text-red-700">Alertas Automáticos</p>
          <span className="px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full">
            {alertas.length}
          </span>
        </div>
        <p className="text-[10px] text-red-400">Baseado nos eventos filtrados</p>
      </div>
      <div className="divide-y divide-zinc-50">
        {alertas.map((alerta) => (
          <div key={alerta.id} className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors">
            <div className={`w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 mt-0.5 ${
              alerta.severidade === 'critico' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
            }`}>
              {iconePorTipo[alerta.tipo]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-bold text-zinc-800">{alerta.titulo}</p>
                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${
                  alerta.severidade === 'critico'
                    ? 'bg-red-100 text-red-600'
                    : 'bg-amber-100 text-amber-600'
                }`}>
                  {alerta.severidade === 'critico' ? 'Crítico' : 'Aviso'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5">{alerta.descricao}</p>
              {alerta.usuario && (
                <button
                  onClick={() => onFiltrarUsuario(alerta.usuario!)}
                  className="flex items-center gap-1 mt-1 text-[10px] text-amber-600 hover:text-amber-700 font-semibold cursor-pointer transition-colors"
                >
                  <i className="ri-user-line text-xs" />
                  {alerta.usuario} — ver eventos
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 text-[10px] text-zinc-400 flex-shrink-0">
              <Clock size={10} />
              {alerta.hora}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
