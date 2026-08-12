import { useState, useMemo, useEffect, useCallback } from 'react';
import { Bell, AtSign, UserPlus, MessageSquare, AlertCircle, Sun, CheckCheck, BellRing, BellOff, Send, Loader2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { ativarPush, desativarPush, enviarPushTeste, estadoPush, type EstadoPush } from '@/lib/push';
import type { TaskNotificacao, TaskRow } from '../hooks/useTarefas';

interface NotificacoesInboxProps {
  notificacoes: TaskNotificacao[];
  tasks: TaskRow[];
  meuId: string | null;
  tenantId: string | null;
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  onOpenTask: (taskId: string) => void;
}

const ICONE: Record<TaskNotificacao['type'], typeof AtSign> = {
  assigned: UserPlus,
  mentioned: AtSign,
  commented: MessageSquare,
};

const ROTULO: Record<TaskNotificacao['type'], string> = {
  assigned: 'atribuiu esta tarefa a você',
  mentioned: 'mencionou você',
  commented: 'comentou na sua tarefa',
};

/**
 * Alertas de prazo derivados das tarefas já carregadas — sem tabela e sem cron,
 * então nunca ficam desatualizados. Exportado para o selo da navegação reusar.
 */
export function calcularVencimentos(tasks: TaskRow[], meuId: string | null) {
  const atrasadas: TaskRow[] = [];
  const hoje: TaskRow[] = [];
  if (!meuId) return { atrasadas, hoje };

  const hojeRef = new Date();
  hojeRef.setHours(0, 0, 0, 0);
  for (const t of tasks) {
    if (t.assignee_id !== meuId || !t.due_date) continue;
    if (t.status_category === 'done' || t.status_category === 'cancelled') continue;
    const due = new Date(t.due_date);
    due.setHours(0, 0, 0, 0);
    const dias = Math.round((due.getTime() - hojeRef.getTime()) / 86400000);
    if (dias < 0) atrasadas.push(t);
    else if (dias === 0) hoje.push(t);
  }
  return { atrasadas, hoje };
}

function tempoRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export default function NotificacoesInbox({
  notificacoes, tasks, meuId, tenantId, write, onOpenTask,
}: NotificacoesInboxProps) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [push, setPush] = useState<EstadoPush | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const atualizarEstadoPush = useCallback(() => {
    estadoPush().then(setPush).catch(() => setPush('nao-suportado'));
  }, []);

  useEffect(() => {
    if (aberto) atualizarEstadoPush();
  }, [aberto, atualizarEstadoPush]);

  const alternarPush = async () => {
    if (!tenantId) return;
    setOcupado(true);
    const r = push === 'ativo' ? await desativarPush(tenantId) : await ativarPush(tenantId);
    setOcupado(false);
    if (!r.ok) toast.error('Notificações', r.erro);
    else if (push !== 'ativo') toast.success('Avisos ativados neste aparelho');
    atualizarEstadoPush();
  };

  const vencimentos = useMemo(() => calcularVencimentos(tasks, meuId), [tasks, meuId]);

  const naoLidas = notificacoes.filter((n) => !n.is_read).length;
  const totalBadge = naoLidas + vencimentos.atrasadas.length;

  const abrirTarefa = async (n: TaskNotificacao) => {
    setAberto(false);
    if (!n.is_read) await write('mark_notification_read', { notification_id: n.id });
    onOpenTask(n.task_id);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className={`relative p-1.5 rounded-lg border transition ${
          totalBadge > 0
            ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
        }`}
        title="Notificações de tarefas"
      >
        <Bell size={15} />
        {totalBadge > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-semibold">
            {totalBadge > 99 ? '99+' : totalBadge}
          </span>
        )}
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-full mt-1 z-30 w-80 bg-white rounded-xl border border-slate-200 shadow-lg max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
              <span className="text-xs font-semibold text-slate-700">Notificações</span>
              {naoLidas > 0 && (
                <button
                  onClick={() => write('mark_all_notifications_read')}
                  className="text-[11px] text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                >
                  <CheckCheck size={12} /> Marcar todas como lidas
                </button>
              )}
            </div>

            {/* Avisos no aparelho (Web Push) */}
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/60">
              {push === 'precisa-instalar' ? (
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  <strong>Para receber avisos no iPhone</strong>, instale o app pelo botão
                  Compartilhar → Adicionar à Tela de Início.
                </p>
              ) : push === 'nao-suportado' ? (
                <p className="text-[11px] text-slate-400">Este navegador não suporta avisos.</p>
              ) : push === 'negado' ? (
                <p className="text-[11px] text-slate-500">
                  Avisos bloqueados. Libere as notificações nas configurações do navegador.
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={alternarPush}
                    disabled={ocupado || push === null}
                    className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-1.5 rounded-lg border transition disabled:opacity-50 ${
                      push === 'ativo'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-indigo-200 bg-white text-indigo-600'
                    }`}
                  >
                    {ocupado ? <Loader2 size={12} className="animate-spin" />
                      : push === 'ativo' ? <BellRing size={12} /> : <BellOff size={12} />}
                    {push === 'ativo' ? 'Avisos ativos neste aparelho' : 'Ativar avisos neste aparelho'}
                  </button>
                  {push === 'ativo' && (
                    <button
                      onClick={async () => {
                        if (!tenantId) return;
                        setOcupado(true);
                        const r = await enviarPushTeste(tenantId);
                        setOcupado(false);
                        if (!r.ok) toast.error('Teste falhou', r.erro);
                      }}
                      disabled={ocupado}
                      className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-indigo-600 px-1.5 py-1.5 disabled:opacity-50"
                      title="Enviar uma notificação de teste"
                    >
                      <Send size={11} /> Testar
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Alertas de prazo (derivados, sempre atuais) */}
              {(vencimentos.atrasadas.length > 0 || vencimentos.hoje.length > 0) && (
                <div className="px-3 py-2 border-b border-slate-100 space-y-1.5">
                  {vencimentos.atrasadas.length > 0 && (
                    <button
                      onClick={() => {
                        setAberto(false);
                        onOpenTask(vencimentos.atrasadas[0].id);
                      }}
                      className="w-full flex items-center gap-2 text-left px-1.5 py-1 rounded hover:bg-red-50"
                    >
                      <AlertCircle size={14} className="text-red-500 shrink-0" />
                      <span className="text-xs text-slate-700">
                        <strong className="text-red-600">{vencimentos.atrasadas.length}</strong>{' '}
                        {vencimentos.atrasadas.length === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'}
                      </span>
                    </button>
                  )}
                  {vencimentos.hoje.length > 0 && (
                    <button
                      onClick={() => {
                        setAberto(false);
                        onOpenTask(vencimentos.hoje[0].id);
                      }}
                      className="w-full flex items-center gap-2 text-left px-1.5 py-1 rounded hover:bg-amber-50"
                    >
                      <Sun size={14} className="text-amber-500 shrink-0" />
                      <span className="text-xs text-slate-700">
                        <strong className="text-amber-600">{vencimentos.hoje.length}</strong>{' '}
                        {vencimentos.hoje.length === 1 ? 'tarefa vence hoje' : 'tarefas vencem hoje'}
                      </span>
                    </button>
                  )}
                </div>
              )}

              {/* Notificações persistidas */}
              {notificacoes.map((n) => {
                const Icone = ICONE[n.type];
                const trecho = typeof n.payload?.trecho === 'string' ? n.payload.trecho : null;
                return (
                  <button
                    key={n.id}
                    onClick={() => abrirTarefa(n)}
                    className={`w-full flex items-start gap-2 px-3 py-2 text-left border-b border-slate-50 hover:bg-slate-50 transition ${
                      n.is_read ? '' : 'bg-indigo-50/40'
                    }`}
                  >
                    <Icone size={14} className={`mt-0.5 shrink-0 ${n.is_read ? 'text-slate-400' : 'text-indigo-500'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-700 leading-snug">
                        <strong>{n.actor_name ?? 'Alguém'}</strong> {ROTULO[n.type]}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{n.task_title ?? 'Tarefa'}</p>
                      {trecho && <p className="text-[11px] text-slate-400 truncate italic">"{trecho}"</p>}
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0">{tempoRelativo(n.created_at)}</span>
                  </button>
                );
              })}

              {notificacoes.length === 0 && vencimentos.atrasadas.length === 0 && vencimentos.hoje.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-8 px-3">
                  Nada por aqui.<br />Você será avisado quando alguém atribuir uma tarefa ou mencionar você.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
