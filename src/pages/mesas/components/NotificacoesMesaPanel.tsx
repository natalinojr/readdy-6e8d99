import { useEffect, useState } from 'react';
import type { NotificacaoMesa } from '@/hooks/useMesaKDSNotificacoes';
import { TIPO_CFG } from '@/hooks/useMesaKDSNotificacoes';

interface Props {
  notificacoes: NotificacaoMesa[];
  onMarcarLida: (id: string) => void;
  onMarcarTodasLidas: () => void;
  onSelecionarMesa: (mesaId: string) => void;
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatTempo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  return `${Math.floor(diff / 3600)}h atrás`;
}

const COR_MAP = {
  emerald: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    icon: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
    badge: 'bg-emerald-500',
    text: 'text-emerald-800',
    sub: 'text-emerald-600',
    btn: 'bg-emerald-500 hover:bg-emerald-600',
  },
  amber: {
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    icon: 'text-amber-600',
    iconBg: 'bg-amber-100',
    badge: 'bg-amber-500',
    text: 'text-amber-900',
    sub: 'text-amber-700',
    btn: 'bg-amber-500 hover:bg-amber-600',
  },
  zinc: {
    bg: 'bg-zinc-50',
    border: 'border-zinc-200',
    icon: 'text-zinc-500',
    iconBg: 'bg-zinc-100',
    badge: 'bg-zinc-500',
    text: 'text-zinc-800',
    sub: 'text-zinc-500',
    btn: 'bg-zinc-700 hover:bg-zinc-800',
  },
} as const;

function NotifCard({
  notif,
  onMarcarLida,
  onSelecionarMesa,
}: {
  notif: NotificacaoMesa;
  onMarcarLida: (id: string) => void;
  onSelecionarMesa: (mesaId: string) => void;
}) {
  const cfg = TIPO_CFG[notif.tipo];
  const cor = COR_MAP[cfg.cor];
  const [visible, setVisible] = useState(false);
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    // Entrada com pequeno delay para animação
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (notif.lida) {
      setSaindo(true);
    }
  }, [notif.lida]);

  const handleDismiss = () => {
    setSaindo(true);
    setTimeout(() => onMarcarLida(notif.id), 300);
  };

  const handleVerMesa = () => {
    if (notif.mesaId) onSelecionarMesa(notif.mesaId);
    handleDismiss();
  };

  return (
    <div
      className={`
        transition-all duration-300 ease-out overflow-hidden
        ${visible && !saindo ? 'opacity-100 translate-x-0 max-h-40' : 'opacity-0 translate-x-4 max-h-0'}
      `}
    >
      <div className={`flex items-start gap-2.5 p-3 rounded-xl border ${cor.bg} ${cor.border} mb-2`}>
        {/* Ícone */}
        <div className={`w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0 ${cor.iconBg} ${notif.tipo === 'pedido_pronto' ? 'animate-pulse' : ''}`}>
          <i className={`${cfg.icon} text-sm ${cor.icon}`} />
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full text-white ${cor.badge}`}>
              Mesa {notif.mesaNumero}
            </span>
            <span className={`text-[10px] font-semibold ${cor.sub}`}>{cfg.label}</span>
          </div>
          <p className={`text-xs font-semibold ${cor.text} truncate`}>
            {notif.numeroPedido} {cfg.descricao}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {notif.totalAmount > 0 && (
              <span className={`text-[10px] font-bold ${cor.sub}`}>
                {formatPrice(notif.totalAmount)}
              </span>
            )}
            <span className="text-[9px] text-zinc-400">{formatTempo(notif.timestamp)}</span>
          </div>
        </div>

        {/* Ações */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          {notif.mesaId && (
            <button
              onClick={handleVerMesa}
              className={`text-[9px] font-bold text-white px-2 py-1 rounded-lg cursor-pointer whitespace-nowrap transition-colors ${cor.btn}`}
            >
              Ver mesa
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400 hover:text-zinc-600 transition-colors self-end"
          >
            <i className="ri-close-line text-xs" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NotificacoesMesaPanel({
  notificacoes,
  onMarcarLida,
  onMarcarTodasLidas,
  onSelecionarMesa,
}: Props) {
  const naoLidas = notificacoes.filter((n) => !n.lida);

  if (naoLidas.length === 0) return null;

  const totalProntas = naoLidas.filter((n) => n.tipo === 'pedido_pronto').length;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 flex flex-col gap-0">
      {/* Header do painel */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 flex items-center justify-center">
            <i className="ri-notification-3-line text-amber-400 text-sm" />
          </div>
          <span className="text-xs font-bold text-white">
            Atualizações das Mesas
          </span>
          <span className="text-[9px] font-black bg-amber-500 text-zinc-900 px-1.5 py-0.5 rounded-full">
            {naoLidas.length}
          </span>
          {totalProntas > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-400 animate-pulse">
              <i className="ri-alarm-warning-line text-[9px]" />
              {totalProntas} pronto{totalProntas !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          onClick={onMarcarTodasLidas}
          className="text-[9px] text-zinc-400 hover:text-zinc-200 cursor-pointer whitespace-nowrap transition-colors"
        >
          Limpar tudo
        </button>
      </div>

      {/* Lista de notificações */}
      <div className="bg-white border border-zinc-200 border-t-0 rounded-b-xl p-2 max-h-96 overflow-y-auto">
        {naoLidas.map((notif) => (
          <NotifCard
            key={notif.id}
            notif={notif}
            onMarcarLida={onMarcarLida}
            onSelecionarMesa={onSelecionarMesa}
          />
        ))}
      </div>
    </div>
  );
}
