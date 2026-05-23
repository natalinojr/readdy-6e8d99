import { useState, useRef, useEffect, useCallback } from 'react';
import { useNotificacoes, TIPO_CONFIG, type Notificacao, type TipoNotificacao, type PerfilAlvo, type PendingApproval } from '../../contexts/NotificacoesContext';
import { useAuth } from '../../contexts/AuthContext';

function formatTs(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return new Date(timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

const fmtCur = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function PendingApprovalCard({
  pa,
  onApprove,
  onDeny,
}: {
  pa: PendingApproval;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
}) {
  const [showItens, setShowItens] = useState(false);
  const temItens = (pa.itensPedido?.length ?? 0) > 0;

  return (
    <div className="bg-white border border-orange-200 rounded-xl overflow-hidden">
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-zinc-800">
              {fmtCur(pa.valor)} de desconto
            </p>
            <p className="text-[10px] text-zinc-400 truncate">Solicitado por {pa.operadorNome ?? 'Operador'}</p>
          </div>
          <button
            onClick={() => onApprove(pa.approvalId)}
            className="flex items-center gap-1 text-[10px] font-bold bg-green-500 hover:bg-green-600 text-white px-2.5 py-1.5 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-check-line" />
            Aprovar
          </button>
          <button
            onClick={() => onDeny(pa.approvalId)}
            className="flex items-center gap-1 text-[10px] font-bold bg-red-100 hover:bg-red-200 text-red-600 px-2.5 py-1.5 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-close-line" />
            Recusar
          </button>
        </div>

        {temItens && (
          <button
            onClick={() => setShowItens((v) => !v)}
            className="w-full flex items-center gap-1.5 text-[10px] font-semibold text-orange-700 hover:text-orange-800 cursor-pointer transition-colors"
          >
            <i className="ri-receipt-line text-[10px]" />
            <span>{showItens ? 'Ocultar pedido' : `Ver pedido (${pa.itensPedido!.reduce((a, i) => a + i.quantidade, 0)} itens${pa.totalPedido !== undefined ? ' · ' + fmtCur(pa.totalPedido) : ''})`}</span>
            <i className={`ri-arrow-down-s-line text-[10px] transition-transform ${showItens ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {showItens && temItens && (
        <div className="border-t border-orange-100">
          {pa.itensPedido!.map((item, idx) => (
            <div key={idx} className="flex items-start justify-between gap-2 px-3 py-2 border-b border-orange-50 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-zinc-700">
                  <span className="text-amber-600 font-bold">{item.quantidade}x </span>{item.nome}
                </p>
                {item.opcoes && item.opcoes.length > 0 && (
                  <p className="text-[9px] text-zinc-400 truncate">{item.opcoes.join(' · ')}</p>
                )}
                {item.observacoes && item.observacoes.length > 0 && (
                  <p className="text-[9px] text-amber-600 truncate">Obs: {item.observacoes.join(' · ')}</p>
                )}
              </div>
              <span className="text-[10px] font-bold text-zinc-700 flex-shrink-0">{fmtCur(item.precoTotal)}</span>
            </div>
          ))}
          {pa.totalPedido !== undefined && (
            <div className="flex items-center justify-between px-3 py-2 bg-orange-50">
              <span className="text-[10px] font-bold text-zinc-600">Subtotal</span>
              <span className="text-xs font-black text-zinc-900">{fmtCur(pa.totalPedido)}</span>
            </div>
          )}
          {pa.totalPedido !== undefined && (
            <div className="flex items-center justify-between px-3 py-1.5 bg-amber-50 border-t border-orange-100">
              <span className="text-[10px] font-bold text-amber-700">Com desconto</span>
              <span className="text-xs font-black text-amber-700">{fmtCur(pa.totalPedido - pa.valor)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type FiltroTab = 'todas' | 'nao_lidas' | TipoNotificacao;

const FILTROS: { key: FiltroTab; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'nao_lidas', label: 'Não lidas' },
  { key: 'pedido_pronto', label: 'Prontos' },
  { key: 'chamado_garcom', label: 'Chamados' },
  { key: 'sla_ultrapassado', label: 'SLA' },
  { key: 'estoque_minimo', label: 'Estoque' },
  { key: 'insumo_esgotado', label: 'Esgotado' },
];

function NotifItem({
  n,
  onLer,
  onRemover,
  pendingApproval,
  onApprove,
  onDeny,
}: {
  n: Notificacao;
  onLer: (id: string) => void;
  onRemover: (id: string) => void;
  pendingApproval?: PendingApproval;
  onApprove?: (approvalId: string) => void;
  onDeny?: (approvalId: string) => void;
}) {
  const cfg = TIPO_CONFIG[n.tipo];
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const isPendingDiscount = !!pendingApproval;

  return (
    <div
      className={`flex gap-3 px-4 py-3 border-b border-zinc-100 transition-colors ${
        isPendingDiscount ? 'bg-orange-50 border-orange-100' : !n.lida ? 'bg-white cursor-pointer hover:bg-zinc-50/80' : 'bg-zinc-50/50 cursor-pointer hover:bg-zinc-50/80'
      }`}
      onClick={() => !n.lida && !isPendingDiscount && onLer(n.id)}
    >
      {/* Ícone */}
      <div className={`w-8 h-8 flex items-center justify-center rounded-xl flex-shrink-0 mt-0.5 ${isPendingDiscount ? 'bg-orange-100' : cfg.corBg}`}>
        <i className={`${cfg.icone} text-sm ${isPendingDiscount ? 'text-orange-600' : cfg.corTexto}`} />
      </div>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-xs font-semibold leading-tight ${n.lida && !isPendingDiscount ? 'text-zinc-500' : 'text-zinc-900'}`}>
            {n.urgente && <i className="ri-alarm-warning-fill text-red-500 mr-1 text-[10px]" />}
            {n.titulo}
          </p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[10px] text-zinc-400 whitespace-nowrap">{formatTs(n.timestamp)}</span>
            {!n.lida && !isPendingDiscount && <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />}
          </div>
        </div>
        <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug line-clamp-2">{n.mensagem}</p>

        {/* Ações de aprovação de desconto */}
        {isPendingDiscount && onApprove && onDeny ? (
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-full">
              <i className="ri-time-line text-[10px]" />
              {pendingApproval.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onApprove(pendingApproval.approvalId); }}
              className="flex items-center gap-1 text-[10px] font-bold bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded-full cursor-pointer whitespace-nowrap transition-colors"
            >
              <i className="ri-check-line text-[10px]" />
              Aprovar
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDeny(pendingApproval.approvalId); }}
              className="flex items-center gap-1 text-[10px] font-bold bg-red-100 hover:bg-red-200 text-red-600 px-3 py-1 rounded-full cursor-pointer whitespace-nowrap transition-colors"
            >
              <i className="ri-close-line text-[10px]" />
              Recusar
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between mt-1">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cfg.corBg} ${cfg.corTexto}`}>
              {cfg.label}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onRemover(n.id); }}
              className="text-[9px] text-zinc-300 hover:text-red-400 transition-colors cursor-pointer"
            >
              <i className="ri-close-line text-[11px]" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  perfil: PerfilAlvo;
}

export default function CentralNotificacoes({ perfil }: Props) {
  const {
    notificacoes, marcarLida, marcarTodasLidas, remover, limparTodas,
    naoLidasPara, dispararNotificacao, pendingApprovals, approvePending, denyPending,
  } = useNotificacoes();
  const { user } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [filtro, setFiltro] = useState<FiltroTab>('todas');
  const panelRef = useRef<HTMLDivElement>(null);
  const naoLidas = naoLidasPara(perfil);

  // Contagem adicional de aprovações pendentes para gerentes/admins
  const pendingForMe = (perfil === 'gerente' || perfil === 'admin') ? pendingApprovals.length : 0;
  const badgeCount = naoLidas + pendingForMe;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const notifsFiltradas = notificacoes.filter((n) => {
    const deveReceber = n.perfisAlvo.includes(perfil);
    if (!deveReceber) return false;
    if (filtro === 'todas') return true;
    if (filtro === 'nao_lidas') return !n.lida;
    return n.tipo === filtro;
  });

  const handleApprove = useCallback((approvalId: string) => {
    const approverName = user?.nome ?? 'Gerente';
    approvePending(approvalId, approverName);
  }, [approvePending, user]);

  const handleDeny = useCallback((approvalId: string) => {
    denyPending(approvalId);
  }, [denyPending]);

  const handleDispararTeste = useCallback(() => {
    const exemplos: Array<Omit<Notificacao, 'id' | 'lida' | 'timestamp'>> = [
      {
        tipo: 'pedido_pronto',
        titulo: 'Pedido #0047 pronto',
        mensagem: 'Mesa 4 — X-Bacon, Fritas G, Suco de Laranja prontos.',
        urgente: false,
        perfisAlvo: ['garcom', 'caixa'],
        icone: 'ri-check-double-line',
        cor: 'green',
      },
      {
        tipo: 'chamado_garcom',
        titulo: 'Chamado — Mesa 9',
        mensagem: 'Cliente solicitou atendimento na mesa 9.',
        urgente: false,
        perfisAlvo: ['garcom', 'caixa'],
        icone: 'ri-hand-heart-line',
        cor: 'amber',
      },
      {
        tipo: 'insumo_esgotado',
        titulo: 'Insumo esgotado: Bacon',
        mensagem: 'Bacon fatiado esgotado. Itens com esse insumo removidos do cardápio.',
        urgente: true,
        perfisAlvo: ['garcom', 'caixa'],
        icone: 'ri-forbid-2-line',
        cor: 'red',
      },
      {
        tipo: 'sla_ultrapassado',
        titulo: 'SLA ultrapassado — Mesa 11',
        mensagem: 'Pedido #0051 ultrapassou o tempo limite em 4min.',
        urgente: true,
        perfisAlvo: ['gerente', 'caixa'],
        icone: 'ri-alarm-warning-line',
        cor: 'red',
      },
      {
        tipo: 'estoque_minimo',
        titulo: 'Estoque mínimo: Tomate',
        mensagem: 'Tomate fresco atingiu nível crítico (1.2 kg restante).',
        urgente: false,
        perfisAlvo: ['admin', 'gerente'],
        icone: 'ri-archive-line',
        cor: 'yellow',
      },
    ];
    const rand = exemplos[Math.floor(Math.random() * exemplos.length)];
    dispararNotificacao(rand);
  }, [dispararNotificacao]);

  return (
    <div className="relative" ref={panelRef}>
      {/* Sino */}
      <button
        onClick={() => setAberto((v) => !v)}
        className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
          aberto ? 'bg-zinc-100' : 'hover:bg-zinc-100'
        }`}
      >
        <i className={`ri-notification-3-line text-lg ${badgeCount > 0 ? 'text-zinc-700' : 'text-zinc-400'}`} />
        {badgeCount > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[9px] font-black text-white px-1 ${
            pendingForMe > 0 ? 'bg-orange-500 animate-pulse' :
            notificacoes.find((n) => n.urgente && !n.lida && n.perfisAlvo.includes(perfil)) ? 'bg-red-500 animate-pulse' : 'bg-red-500'
          }`}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </button>

      {/* Painel */}
      {aberto && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white border border-zinc-200 rounded-2xl z-50 flex flex-col overflow-hidden"
          style={{ maxHeight: '560px', boxShadow: '0 8px 32px rgba(0,0,0,0.10)' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-100 flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 flex items-center justify-center bg-zinc-100 rounded-lg">
                <i className="ri-notification-3-fill text-zinc-600 text-sm" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-900">Central de Notificações</p>
                {(naoLidas > 0 || pendingForMe > 0) && (
                  <p className="text-[10px] text-zinc-400">
                    {naoLidas > 0 ? `${naoLidas} não lida${naoLidas !== 1 ? 's' : ''}` : ''}
                    {pendingForMe > 0 ? `${naoLidas > 0 ? ' · ' : ''}${pendingForMe} desconto${pendingForMe > 1 ? 's' : ''} aguardando` : ''}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {naoLidas > 0 && (
                <button
                  onClick={marcarTodasLidas}
                  className="text-[10px] font-semibold text-zinc-500 hover:text-zinc-800 px-2 py-1 rounded-lg hover:bg-zinc-100 cursor-pointer whitespace-nowrap transition-colors"
                >
                  Marcar tudo
                </button>
              )}
              <button
                onClick={limparTodas}
                className="text-[10px] font-semibold text-zinc-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 cursor-pointer whitespace-nowrap transition-colors"
              >
                Limpar
              </button>
            </div>
          </div>

          {/* Solicitações de desconto pendentes para gerentes/admins */}
          {pendingForMe > 0 && (
            <div className="px-3 py-2 bg-orange-50 border-b border-orange-100 flex-shrink-0">
              <p className="text-[10px] font-bold text-orange-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <i className="ri-shield-keyhole-line" />
                {pendingForMe} solicitação{pendingForMe > 1 ? 'ões' : ''} de desconto aguardando
              </p>
              <div className="space-y-1.5">
                {pendingApprovals.map((pa) => (
                  <PendingApprovalCard
                    key={pa.approvalId}
                    pa={pa}
                    onApprove={handleApprove}
                    onDeny={handleDeny}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Filtros */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-100 overflow-x-auto flex-shrink-0 scrollbar-none">
            {FILTROS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFiltro(f.key)}
                className={`flex-shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-full cursor-pointer whitespace-nowrap transition-colors ${
                  filtro === f.key
                    ? 'bg-zinc-800 text-white'
                    : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto">
            {notifsFiltradas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-2xl mb-3">
                  <i className="ri-notification-off-line text-2xl text-zinc-300" />
                </div>
                <p className="text-sm font-semibold text-zinc-400">Nenhuma notificação</p>
                <p className="text-xs text-zinc-300 mt-1">
                  {filtro === 'nao_lidas' ? 'Tudo em dia!' : 'Sem eventos recentes'}
                </p>
              </div>
            ) : (
              notifsFiltradas.map((n) => {
                const pa = n.tipo === 'aprovacao_pendente'
                  ? pendingApprovals.find((a) => a.notifId === n.id)
                  : undefined;
                return (
                  <NotifItem
                    key={n.id}
                    n={n}
                    onLer={marcarLida}
                    onRemover={remover}
                    pendingApproval={pa}
                    onApprove={pa ? handleApprove : undefined}
                    onDeny={pa ? handleDeny : undefined}
                  />
                );
              })
            )}
          </div>

          {/* Footer: botão de teste */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-zinc-100 bg-zinc-50/80 flex-shrink-0">
            <p className="text-[10px] text-zinc-400">Sons automáticos por evento</p>
            <button
              onClick={handleDispararTeste}
              className="text-[10px] font-semibold text-zinc-500 hover:text-zinc-800 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-zinc-100 cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-flashlight-line text-[11px]" />
              Testar notif.
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
