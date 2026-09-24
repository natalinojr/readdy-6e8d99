// task-lembretes — avisa quando a tarefa vai vencer (2026-09-24).
// Chamada a cada minuto pelo pg_cron (job "task-lembretes", fn_task_lembretes_tick)
// com x-internal-key. fn_task_lembretes_da_vez() devolve os avisos da vez e já os
// registra (nunca repete). Para cada um: notificação no app (task_notifications,
// tipo 'due') + push no celular pelo send-push (vibra no Android se a pessoa quis).
// Secrets: ASSISTENTE_INTERNAL_KEY (mesma chave do assistente-cron).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const internalKey = Deno.env.get('ASSISTENTE_INTERNAL_KEY') ?? '';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Aviso {
  task_id: string;
  user_id: string;
  minutos_antes: number;
  title: string;
  due_date: string;
  due_has_time: boolean;
  list_name: string | null;
  tenant_id: string | null;
  vibrar: boolean;
}

/** "Vence em 1h", "Vence em 30 min", "Vence amanhã", "Vence agora", "Vence hoje". */
export function tituloAviso(minutos: number, comHorario: boolean): string {
  if (minutos === 0) return comHorario ? '⏰ Tarefa vence agora' : '⏰ Tarefa vence hoje';
  if (minutos % 1440 === 0) return minutos === 1440 ? '⏰ Tarefa vence amanhã' : `⏰ Tarefa vence em ${minutos / 1440} dias`;
  if (minutos % 60 === 0) return `⏰ Tarefa vence em ${minutos / 60}h`;
  if (minutos > 60) return `⏰ Tarefa vence em ${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')}`;
  return `⏰ Tarefa vence em ${minutos} min`;
}

function horaBR(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

Deno.serve(async (req: Request) => {
  if (!internalKey || req.headers.get('x-internal-key') !== internalKey) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await admin.rpc('fn_task_lembretes_da_vez');
  if (error) {
    console.error('[task-lembretes] rpc', error.message);
    return json({ error: error.message }, 500);
  }
  const avisos = (data ?? []) as Aviso[];
  if (!avisos.length) return json({ success: true, enviados: 0 });

  // Notificação dentro do app (sino de Tarefas)
  await admin.from('task_notifications').insert(avisos.map((a) => ({
    tenant_id: a.tenant_id, user_id: a.user_id, task_id: a.task_id, type: 'due', actor_id: null,
    payload: { title: a.title, minutos_antes: a.minutos_antes, due_date: a.due_date, due_has_time: a.due_has_time },
  })));

  // Push: um por aviso (o texto muda por tarefa). Falha num não impede os outros.
  let enviados = 0;
  for (const a of avisos) {
    const corpo = [a.title, a.due_has_time ? `às ${horaBR(a.due_date)}` : null, a.list_name].filter(Boolean).join(' · ');
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({
          action: 'send',
          user_ids: [a.user_id],
          tenant_id: a.tenant_id,
          payload: {
            titulo: tituloAviso(a.minutos_antes, a.due_has_time),
            corpo,
            url: `/tarefas?task=${a.task_id}`,
            task_id: a.task_id,
            tag: `vencimento-${a.task_id}`,
            // Android vibra neste padrão (curto, curto, longo); iPhone ignora — quem decide lá é o sistema.
            vibrate: a.vibrar ? [200, 100, 200, 100, 500] : [],
            silencioso: !a.vibrar,
            requireInteraction: a.minutos_antes === 0,
          },
        }),
      });
      if (r.ok) enviados++;
      else console.error('[task-lembretes] send-push', r.status, await r.text());
    } catch (e) {
      console.error('[task-lembretes] push falhou', e instanceof Error ? e.message : e);
    }
  }
  return json({ success: true, avisos: avisos.length, enviados });
});
