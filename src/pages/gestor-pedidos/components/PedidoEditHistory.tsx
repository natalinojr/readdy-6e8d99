import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface AuditEntry {
  id: string;
  user_id: string | null;
  action_type: string;
  details: Record<string, unknown> | null;
  created_at: string;
  user_name?: string;
}

interface Props {
  orderId: string;
}

const ACTION_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  order_edit_started:  { label: 'Edição iniciada',   icon: 'ri-edit-2-line',          color: 'text-orange-500 bg-orange-50 border-orange-200' },
  order_edit_finished: { label: 'Edição concluída',  icon: 'ri-check-line',            color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  order_edit_force_unlocked: { label: 'Desbloqueado',icon: 'ri-lock-unlock-line',      color: 'text-zinc-500 bg-zinc-50 border-zinc-200' },
  discount_applied:    { label: 'Desconto aplicado', icon: 'ri-discount-percent-line', color: 'text-sky-600 bg-sky-50 border-sky-200' },
  order_refunded:      { label: 'Estorno solicitado',icon: 'ri-refund-2-line',         color: 'text-red-500 bg-red-50 border-red-200' },
};

function formatTs(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function PedidoEditHistory({ orderId }: Props) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.tenantId || !orderId) { setLoading(false); return; }
    let cancelled = false;

    supabase
      .from('audit_log')
      .select('id, user_id, action_type, details, created_at')
      .eq('entity_id', orderId)
      .eq('tenant_id', user.tenantId)
      .in('action_type', ['order_edit_started', 'order_edit_finished', 'order_edit_force_unlocked', 'discount_applied', 'order_refunded'])
      .order('created_at', { ascending: false })
      .limit(20)
      .then(async ({ data, error }) => {
        if (cancelled || error) { setLoading(false); return; }
        const rows = data ?? [];

        // Resolve nomes de usuários
        const userIds = [...new Set(rows.map((r: AuditEntry) => r.user_id).filter(Boolean))] as string[];
        const nameMap = new Map<string, string>();
        if (userIds.length > 0) {
          const { data: users } = await supabase
            .from('users')
            .select('id, name')
            .in('id', userIds);
          (users ?? []).forEach((u: { id: string; name: string }) => nameMap.set(u.id, u.name));
        }

        if (!cancelled) {
          setEntries(rows.map((r: AuditEntry) => ({
            ...r,
            user_name: r.user_id ? (nameMap.get(r.user_id) ?? 'Usuário') : 'Sistema',
          })));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [orderId, user?.tenantId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-zinc-400">
        <div className="w-4 h-4 border-2 border-zinc-300 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs">Carregando histórico...</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-xs text-zinc-400 py-2 text-center">Nenhuma alteração registrada para este pedido.</p>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const cfg = ACTION_LABELS[entry.action_type] ?? {
          label: entry.action_type,
          icon: 'ri-information-line',
          color: 'text-zinc-500 bg-zinc-50 border-zinc-200',
        };
        const summary = entry.details?.modifications_summary as string | undefined;
        return (
          <div key={entry.id} className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border ${cfg.color}`}>
            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5">
              <i className={`${cfg.icon} text-xs`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold">{cfg.label}</span>
                <span className="text-[10px] font-semibold text-zinc-400 ml-auto whitespace-nowrap">
                  {formatTs(entry.created_at)}
                </span>
              </div>
              <p className="text-[10px] text-zinc-500 mt-0.5">
                <i className="ri-user-line mr-0.5 text-[9px]" />
                {entry.user_name}
              </p>
              {summary && (
                <p className="text-[10px] text-zinc-600 mt-0.5 break-words">{summary}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}