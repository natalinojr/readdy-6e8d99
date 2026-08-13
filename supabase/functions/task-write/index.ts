// task-write — escritas do módulo de Gestão de Tarefas (ver PLANO-MODULO-TAREFAS.md)
// Padrão do projeto: service_role + validação de membership (igual stock-write).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errMsg(err: unknown): string {
  if (err == null) return 'Erro desconhecido';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  const obj = err as Record<string, unknown>;
  if (obj.message) return String(obj.message);
  return JSON.stringify(err);
}

const FIELD_TYPES = ['text', 'textarea', 'number', 'currency', 'date', 'checkbox', 'dropdown', 'labels', 'user', 'rating', 'url', 'phone'];

// Valida o value JSONB de um campo custom conforme o tipo.
function validateFieldValue(fieldType: string, value: unknown, options: Array<{ id: string }>): string | null {
  if (value === null || value === undefined) return null; // limpar valor é sempre ok
  switch (fieldType) {
    case 'text':
    case 'textarea':
    case 'url':
    case 'phone':
      return typeof value === 'string' ? null : 'valor deve ser texto';
    case 'number':
    case 'currency':
      return typeof value === 'number' && isFinite(value) ? null : 'valor deve ser número';
    case 'date':
      return typeof value === 'string' && !isNaN(Date.parse(value)) ? null : 'valor deve ser data ISO';
    case 'checkbox':
      return typeof value === 'boolean' ? null : 'valor deve ser booleano';
    case 'rating':
      return typeof value === 'number' && value >= 1 && value <= 5 ? null : 'rating deve ser 1-5';
    case 'user':
      return typeof value === 'string' ? null : 'valor deve ser id de usuário';
    case 'dropdown': {
      if (typeof value !== 'string') return 'valor deve ser id de opção';
      return options.some((o) => o.id === value) ? null : 'opção inexistente';
    }
    case 'labels': {
      if (!Array.isArray(value)) return 'valor deve ser lista de ids';
      const ids = new Set(options.map((o) => o.id));
      return (value as unknown[]).every((v) => typeof v === 'string' && ids.has(v)) ? null : 'opção inexistente';
    }
    default:
      return 'tipo desconhecido';
  }
}

// Próxima ocorrência de recorrência {freq: daily|weekly|monthly, interval: n}
function nextDueDate(current: string | null, recurrence: { freq?: string; interval?: number }): string | null {
  const base = current ? new Date(current) : new Date();
  const interval = Math.max(1, Number(recurrence.interval) || 1);
  const d = new Date(base);
  switch (recurrence.freq) {
    case 'daily': d.setDate(d.getDate() + interval); break;
    case 'weekly': d.setDate(d.getDate() + 7 * interval); break;
    case 'monthly': d.setMonth(d.getMonth() + interval); break;
    default: return null;
  }
  return d.toISOString();
}

Deno.serve({ verify_jwt: false }, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';

  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey || anonKey, {
    ...(serviceRoleKey ? {} : { global: { headers: { Authorization: authHeader } } }),
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: userError } = await db.auth.getUser();
  if (userError || !user) return json({ error: 'Unauthorized' }, 401);

  try {
    // ── Resolve tenant por membership (nunca confiar só no body) ──
    // Vem antes de ler o corpo porque o upload multipart também precisa do tenant.
    const { data: tenantRows, error: tenantErr } = await admin
      .from('user_tenants').select('tenant_id, role').eq('user_id', user.id);
    if (tenantErr) return json({ error: `Tenant lookup failed: ${errMsg(tenantErr)}` }, 500);
    if (!tenantRows?.length) return json({ error: 'User does not belong to any tenant' }, 403);

    const resolveTenant = (requested: string | null): string => {
      const match = requested ? tenantRows.find((r) => r.tenant_id === requested) : null;
      return match?.tenant_id ?? tenantRows[0].tenant_id;
    };

    // ── Upload de anexo (multipart) ──
    // Uploads NÃO podem ir pelo storage do client: ele roda com autoRefreshToken:false,
    // então um token expirado chega ao Storage como `anon` e a RLS recusa. Aqui usamos
    // o service role. Mesmo padrão do menu-write.
    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const taskId = formData.get('task_id') as string | null;
      const tenantId = resolveTenant((formData.get('tenant_id') as string | null) ?? null);

      if (!file) return json({ error: 'Nenhum arquivo enviado' }, 400);
      if (!taskId) return json({ error: 'task_id é obrigatório' }, 400);

      const { data: taskRow } = await admin
        .from('tasks').select('id, created_by, assignee_id').eq('id', taskId).eq('tenant_id', tenantId).maybeSingle();
      if (!taskRow) return json({ error: 'Tarefa não encontrada neste tenant' }, 404);
      if (taskRow.created_by !== user.id && taskRow.assignee_id !== user.id) {
        return json({ error: 'Você não tem permissão para anexar arquivos nesta tarefa' }, 403);
      }

      const nomeSeguro = (file.name.replace(/[^a-zA-Z0-9.\-_ ]/g, '') || 'arquivo').slice(0, 120);
      const filePath = `${tenantId}/${taskId}/${Date.now()}-${nomeSeguro}`;
      const bytes = new Uint8Array(await file.arrayBuffer());

      const { error: upErr } = await admin.storage
        .from('task-attachments')
        .upload(filePath, bytes, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (upErr) return json({ error: `Falha no upload: ${errMsg(upErr)}` }, 500);

      const { data: att, error: attErr } = await admin.from('task_attachments').insert({
        tenant_id: tenantId,
        task_id: taskId,
        file_name: nomeSeguro,
        file_path: filePath,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: user.id,
      }).select('id').single();
      if (attErr) {
        // Não deixa arquivo órfão no bucket se a linha falhar
        await admin.storage.from('task-attachments').remove([filePath]);
        return json({ error: errMsg(attErr) }, 500);
      }

      await admin.from('task_activity').insert({
        tenant_id: tenantId, task_id: taskId, user_id: user.id,
        action: 'attachment_added', payload: { file_name: nomeSeguro },
      });

      return json({ success: true, id: att.id, file_path: filePath });
    }

    const body = await req.json();
    const { action } = body;
    if (!action) return json({ error: 'action is required' }, 400);

    const tenantId: string = resolveTenant(body.active_tenant_id ?? body.tenant_id ?? null);

    console.log('[task-write]', action, 'user:', user.id, 'tenant:', tenantId);

    const logActivity = async (taskId: string, act: string, payload: Record<string, unknown> = {}) => {
      await admin.from('task_activity').insert({
        tenant_id: tenantId, task_id: taskId, user_id: user.id, action: act, payload,
      });
    };

    /**
     * Cria notificações persistidas para os destinatários (o contexto de
     * notificação do app é em memória e por perfil — não serve para avisar
     * uma pessoa específica). Nunca notifica quem causou a ação.
     */
    const notify = async (
      userIds: Array<string | null | undefined>,
      taskId: string,
      type: 'assigned' | 'mentioned' | 'commented',
      payload: Record<string, unknown> = {},
    ) => {
      const destinos = [...new Set(userIds.filter((id): id is string => !!id && id !== user.id))];
      if (!destinos.length) return;
      // Só notifica quem realmente pertence ao tenant
      const { data: membros } = await admin
        .from('user_tenants').select('user_id').eq('tenant_id', tenantId).in('user_id', destinos);
      const validos = (membros ?? []).map((m: { user_id: string }) => m.user_id);
      if (!validos.length) return;
      await admin.from('task_notifications').insert(
        validos.map((uid) => ({
          tenant_id: tenantId, user_id: uid, task_id: taskId,
          type, actor_id: user.id, payload,
        })),
      );

      // Push: chega mesmo com o app fechado (é o que faz o celular valer a pena).
      // Falha aqui nunca pode derrubar a escrita — a notificação no app já foi gravada.
      try {
        const titulos: Record<string, string> = {
          assigned: 'Nova tarefa para você',
          mentioned: 'Mencionaram você',
          commented: 'Novo comentário',
        };
        await fetch(`${supabaseUrl}/functions/v1/send-push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            action: 'send',
            user_ids: validos,
            tenant_id: tenantId,
            payload: {
              titulo: titulos[type] ?? 'Tarefas',
              corpo: String(payload.title ?? 'Abra para ver os detalhes'),
              url: `/tarefas?task=${taskId}`,
              task_id: taskId,
            },
          }),
        });
      } catch (e) {
        console.error('[task-write] push falhou (ignorado):', e instanceof Error ? e.message : e);
      }
    };

    // Garante que um registro pertence ao tenant resolvido
    const assertOwned = async (table: string, id: string): Promise<Record<string, unknown>> => {
      const { data, error } = await admin.from(table).select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      if (error) throw new Error(errMsg(error));
      if (!data) throw new Error(`${table}: registro não encontrado neste tenant`);
      return data as Record<string, unknown>;
    };

    // Listas (e o que pertence só a elas: status, campos por lista) são
    // pessoais — só quem criou pode gerenciar.
    const assertListOwner = async (listId: string): Promise<Record<string, unknown>> => {
      const list = await assertOwned('task_lists', listId);
      if (list.created_by !== user.id) throw new Error('Você não tem permissão para editar esta lista');
      return list;
    };

    // Tarefa é visível/editável por quem criou (dono da lista) OU pelo
    // responsável (é assim que ela "compartilha" com outro usuário).
    const assertTaskAccess = async (taskId: string): Promise<Record<string, unknown>> => {
      const task = await assertOwned('tasks', taskId);
      if (task.created_by !== user.id && task.assignee_id !== user.id) {
        throw new Error('Você não tem permissão para editar esta tarefa');
      }
      return task;
    };

    switch (action) {
      // ═══ Listas ═══
      case 'create_list': {
        const { name, color, icon } = body;
        if (!name) return json({ error: 'name is required' }, 400);
        const { data, error } = await admin.from('task_lists')
          .insert({ tenant_id: tenantId, name, color: color ?? '#6366f1', icon: icon ?? null, created_by: user.id })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true, id: data.id });
      }
      case 'update_list': {
        const { list_id, ...rest } = body;
        await assertListOwner(list_id);
        const patch: Record<string, unknown> = {};
        for (const k of ['name', 'color', 'icon', 'sort_order', 'is_archived']) {
          if (rest[k] !== undefined) patch[k] = rest[k];
        }
        const { error } = await admin.from('task_lists').update(patch).eq('id', list_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Status ═══
      case 'create_status': {
        const { list_id, name, color, category, sort_order } = body;
        if (!list_id || !name) return json({ error: 'list_id and name are required' }, 400);
        await assertListOwner(list_id);
        const { data, error } = await admin.from('task_statuses')
          .insert({ tenant_id: tenantId, list_id, name, color: color ?? '#94a3b8', category: category ?? 'todo', sort_order: sort_order ?? 99 })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true, id: data.id });
      }
      case 'update_status': {
        const { status_id, ...rest } = body;
        const status = await assertOwned('task_statuses', status_id);
        await assertListOwner(status.list_id as string);
        const patch: Record<string, unknown> = {};
        for (const k of ['name', 'color', 'category', 'sort_order']) {
          if (rest[k] !== undefined) patch[k] = rest[k];
        }
        const { error } = await admin.from('task_statuses').update(patch).eq('id', status_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }
      case 'delete_status': {
        const { status_id, reassign_to } = body;
        const status = await assertOwned('task_statuses', status_id);
        await assertListOwner(status.list_id as string);
        if (reassign_to) {
          const reassignStatus = await assertOwned('task_statuses', reassign_to);
          await assertListOwner(reassignStatus.list_id as string);
          await admin.from('tasks').update({ status_id: reassign_to }).eq('status_id', status_id).eq('tenant_id', tenantId);
        }
        const { error } = await admin.from('task_statuses').delete().eq('id', status_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Tarefas ═══
      case 'create_task': {
        const { list_id, title, description, status_id, priority, assignee_id, start_date, due_date, due_has_time, parent_task_id, recurrence, sort_order, tag_ids } = body;
        if (!list_id || !title) return json({ error: 'list_id and title are required' }, 400);
        await assertListOwner(list_id);
        let resolvedStatus = status_id ?? null;
        if (!resolvedStatus) {
          const { data: st } = await admin.from('task_statuses')
            .select('id').eq('list_id', list_id).order('sort_order').limit(1).maybeSingle();
          resolvedStatus = st?.id ?? null;
        }
        const { data, error } = await admin.from('tasks').insert({
          tenant_id: tenantId, list_id, title,
          description: description ?? null,
          status_id: resolvedStatus,
          priority: priority ?? 0,
          assignee_id: assignee_id ?? null,
          start_date: start_date ?? null,
          due_date: due_date ?? null,
          due_has_time: due_has_time ?? false,
          parent_task_id: parent_task_id ?? null,
          recurrence: recurrence ?? null,
          sort_order: sort_order ?? Date.now(),
          created_by: user.id,
        }).select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        if (Array.isArray(tag_ids) && tag_ids.length) {
          await admin.from('task_tag_links').insert(
            tag_ids.map((tid: string) => ({ tenant_id: tenantId, task_id: data.id, tag_id: tid })),
          );
        }
        await logActivity(data.id, 'created', { title });
        if (assignee_id) await notify([assignee_id], data.id, 'assigned', { title });
        return json({ success: true, id: data.id });
      }

      case 'update_task': {
        const { task_id, ...rest } = body;
        const current = await assertTaskAccess(task_id);
        const patch: Record<string, unknown> = {};
        const editable = ['title', 'description', 'status_id', 'priority', 'assignee_id', 'start_date', 'due_date', 'due_has_time', 'list_id', 'sort_order', 'recurrence', 'is_archived', 'parent_task_id'];
        for (const k of editable) {
          if (rest[k] !== undefined) patch[k] = rest[k];
        }

        // Atalho para concluir sem saber o status_id da lista — quem só é
        // responsável (tarefa compartilhada) não enxerga a lista de quem criou,
        // então não tem como escolher o status "feito" manualmente.
        if (rest.mark_done && patch.status_id === undefined) {
          const { data: doneStatus } = await admin.from('task_statuses')
            .select('id').eq('list_id', current.list_id).eq('category', 'done')
            .order('sort_order').limit(1).maybeSingle();
          if (doneStatus) patch.status_id = doneStatus.id;
        }

        // Mudança de status: registra atividade e trata conclusão/recorrência
        let createdNextId: string | null = null;
        if (patch.status_id && patch.status_id !== current.status_id) {
          const { data: newStatus } = await admin.from('task_statuses')
            .select('id, name, category').eq('id', patch.status_id).eq('tenant_id', tenantId).maybeSingle();
          if (!newStatus) return json({ error: 'status inexistente neste tenant' }, 400);
          await logActivity(task_id, 'status_changed', { to: newStatus.name });
          if (newStatus.category === 'done') {
            patch.completed_at = new Date().toISOString();
            // Recorrência: cria a próxima ocorrência (modelo Todoist)
            const rec = (patch.recurrence ?? current.recurrence) as { freq?: string; interval?: number } | null;
            if (rec && rec.freq) {
              const nextDue = nextDueDate(current.due_date as string | null, rec);
              if (nextDue) {
                const { data: next } = await admin.from('tasks').insert({
                  tenant_id: tenantId,
                  list_id: current.list_id,
                  title: current.title,
                  description: current.description,
                  status_id: null, // será o primeiro status da lista
                  priority: current.priority,
                  assignee_id: current.assignee_id,
                  due_date: nextDue,
                  due_has_time: current.due_has_time,
                  recurrence: rec,
                  sort_order: Date.now(),
                  // Herda o dono original (a lista é dele), não quem completou —
                  // senão o dono perde a visão da própria recorrência quando
                  // quem marca "concluído" é o responsável, não ele.
                  created_by: current.created_by,
                }).select('id').single();
                if (next) {
                  const { data: st } = await admin.from('task_statuses')
                    .select('id').eq('list_id', current.list_id).order('sort_order').limit(1).maybeSingle();
                  if (st) await admin.from('tasks').update({ status_id: st.id }).eq('id', next.id);
                  createdNextId = next.id;
                  await logActivity(next.id, 'created_from_recurrence', { source_task_id: task_id });
                }
              }
            }
          } else {
            patch.completed_at = null;
          }
        }
        if (patch.assignee_id !== undefined && patch.assignee_id !== current.assignee_id) {
          await logActivity(task_id, 'assignee_changed', { to: patch.assignee_id });
          await notify([patch.assignee_id as string | null], task_id, 'assigned', { title: current.title });
        }
        if (patch.due_date !== undefined && patch.due_date !== current.due_date) {
          await logActivity(task_id, 'due_date_changed', { to: patch.due_date });
        }
        if (patch.priority !== undefined && patch.priority !== current.priority) {
          await logActivity(task_id, 'priority_changed', { to: patch.priority });
        }

        if (Object.keys(patch).length) {
          const { error } = await admin.from('tasks').update(patch).eq('id', task_id);
          if (error) return json({ error: errMsg(error) }, 500);
        }

        // Tags: substituição completa quando tag_ids vier no body
        if (Array.isArray(rest.tag_ids)) {
          await admin.from('task_tag_links').delete().eq('task_id', task_id);
          if (rest.tag_ids.length) {
            await admin.from('task_tag_links').insert(
              rest.tag_ids.map((tid: string) => ({ tenant_id: tenantId, task_id, tag_id: tid })),
            );
          }
        }
        return json({ success: true, next_occurrence_id: createdNextId });
      }

      case 'delete_task': {
        const { task_id } = body;
        const current = await assertOwned('tasks', task_id);
        if (current.created_by !== user.id) return json({ error: 'Só quem criou a tarefa pode arquivá-la' }, 403);
        const { error } = await admin.from('tasks').update({ is_archived: true }).eq('id', task_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Checklist ═══
      case 'add_checklist_item': {
        const { task_id, title } = body;
        if (!task_id || !title) return json({ error: 'task_id and title are required' }, 400);
        await assertTaskAccess(task_id);
        const { data, error } = await admin.from('task_checklist_items')
          .insert({ tenant_id: tenantId, task_id, title, sort_order: Date.now() })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true, id: data.id });
      }
      case 'update_checklist_item': {
        const { item_id, ...rest } = body;
        const item = await assertOwned('task_checklist_items', item_id);
        await assertTaskAccess(item.task_id as string);
        const patch: Record<string, unknown> = {};
        for (const k of ['title', 'is_done', 'sort_order']) {
          if (rest[k] !== undefined) patch[k] = rest[k];
        }
        const { error } = await admin.from('task_checklist_items').update(patch).eq('id', item_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }
      case 'delete_checklist_item': {
        const { item_id } = body;
        const item = await assertOwned('task_checklist_items', item_id);
        await assertTaskAccess(item.task_id as string);
        const { error } = await admin.from('task_checklist_items').delete().eq('id', item_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Comentários ═══
      case 'add_comment': {
        const { task_id, body: commentBody, mentions } = body;
        if (!task_id || !commentBody) return json({ error: 'task_id and body are required' }, 400);
        await assertTaskAccess(task_id);
        const listaMencoes: string[] = Array.isArray(mentions) ? mentions : [];
        const { data, error } = await admin.from('task_comments')
          .insert({ tenant_id: tenantId, task_id, user_id: user.id, body: commentBody, mentions: listaMencoes })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);

        const { data: tarefa } = await admin
          .from('tasks').select('title, assignee_id').eq('id', task_id).maybeSingle();
        const trecho = String(commentBody).slice(0, 140);
        // Mencionados têm prioridade; o responsável recebe o aviso genérico de comentário
        await notify(listaMencoes, task_id, 'mentioned', { title: tarefa?.title, trecho });
        const responsavel = tarefa?.assignee_id as string | null | undefined;
        if (responsavel && !listaMencoes.includes(responsavel)) {
          await notify([responsavel], task_id, 'commented', { title: tarefa?.title, trecho });
        }
        return json({ success: true, id: data.id });
      }
      case 'delete_comment': {
        const { comment_id } = body;
        const comment = await assertOwned('task_comments', comment_id);
        if (comment.user_id !== user.id) return json({ error: 'só o autor pode excluir o comentário' }, 403);
        const { error } = await admin.from('task_comments').delete().eq('id', comment_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Tags ═══
      case 'create_tag': {
        const { name, color } = body;
        if (!name) return json({ error: 'name is required' }, 400);
        const { data, error } = await admin.from('task_tags')
          .insert({ tenant_id: tenantId, name, color: color ?? '#64748b' })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true, id: data.id });
      }
      case 'update_tag': {
        const { tag_id, ...rest } = body;
        await assertOwned('task_tags', tag_id);
        const patch: Record<string, unknown> = {};
        for (const k of ['name', 'color']) if (rest[k] !== undefined) patch[k] = rest[k];
        const { error } = await admin.from('task_tags').update(patch).eq('id', tag_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }
      case 'delete_tag': {
        const { tag_id } = body;
        await assertOwned('task_tags', tag_id);
        const { error } = await admin.from('task_tags').delete().eq('id', tag_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Campos personalizados ═══
      case 'create_field': {
        const { name, field_type, list_id, options, show_on_card } = body;
        if (!name || !field_type) return json({ error: 'name and field_type are required' }, 400);
        if (!FIELD_TYPES.includes(field_type)) return json({ error: `field_type inválido: ${field_type}` }, 400);
        if (list_id) await assertListOwner(list_id);
        const { data, error } = await admin.from('task_custom_fields')
          .insert({ tenant_id: tenantId, name, field_type, list_id: list_id ?? null, options: options ?? [], show_on_card: show_on_card ?? false, sort_order: Date.now() })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true, id: data.id });
      }
      case 'update_field': {
        const { field_id, ...rest } = body;
        await assertOwned('task_custom_fields', field_id);
        const patch: Record<string, unknown> = {};
        for (const k of ['name', 'options', 'show_on_card', 'sort_order', 'is_archived']) {
          if (rest[k] !== undefined) patch[k] = rest[k];
        }
        const { error } = await admin.from('task_custom_fields').update(patch).eq('id', field_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }
      case 'set_field_value': {
        const { task_id, field_id, value } = body;
        await assertTaskAccess(task_id);
        const field = await assertOwned('task_custom_fields', field_id);
        const validationError = validateFieldValue(
          field.field_type as string, value,
          (field.options as Array<{ id: string }>) ?? [],
        );
        if (validationError) return json({ error: `valor inválido: ${validationError}` }, 400);
        if (value === null || value === undefined) {
          await admin.from('task_field_values').delete().eq('task_id', task_id).eq('field_id', field_id);
        } else {
          const { error } = await admin.from('task_field_values')
            .upsert({ tenant_id: tenantId, task_id, field_id, value }, { onConflict: 'task_id,field_id' });
          if (error) return json({ error: errMsg(error) }, 500);
        }
        return json({ success: true });
      }

      // ═══ Notificações ═══
      case 'mark_notification_read': {
        const { notification_id } = body;
        // Filtra por user_id: ninguém marca a notificação de outro como lida
        const { error } = await admin.from('task_notifications')
          .update({ is_read: true })
          .eq('id', notification_id).eq('user_id', user.id).eq('tenant_id', tenantId);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }
      case 'mark_all_notifications_read': {
        const { error } = await admin.from('task_notifications')
          .update({ is_read: true })
          .eq('user_id', user.id).eq('tenant_id', tenantId).eq('is_read', false);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Views salvas ═══
      case 'create_view': {
        const { name, list_id, view_type, group_by, filters, is_shared } = body;
        if (!name) return json({ error: 'name is required' }, 400);
        if (list_id) await assertListOwner(list_id);
        const { data, error } = await admin.from('task_views').insert({
          tenant_id: tenantId,
          list_id: list_id ?? null,
          user_id: is_shared ? null : user.id, // null = visível para a equipe
          name,
          view_type: view_type ?? 'lista',
          group_by: group_by ?? 'status',
          filters: filters ?? {},
          sort_order: Date.now(),
          created_by: user.id,
        }).select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true, id: data.id });
      }
      case 'update_view': {
        const { view_id, ...rest } = body;
        const view = await assertOwned('task_views', view_id);
        // Views pessoais só o dono edita; compartilhadas, quem criou
        if (view.user_id && view.user_id !== user.id) {
          return json({ error: 'Esta view pertence a outro usuário' }, 403);
        }
        const patch: Record<string, unknown> = {};
        for (const k of ['name', 'view_type', 'group_by', 'filters', 'sort_order']) {
          if (rest[k] !== undefined) patch[k] = rest[k];
        }
        if (rest.is_shared !== undefined) patch.user_id = rest.is_shared ? null : user.id;
        const { error } = await admin.from('task_views').update(patch).eq('id', view_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }
      case 'delete_view': {
        const { view_id } = body;
        const view = await assertOwned('task_views', view_id);
        if (view.user_id && view.user_id !== user.id) {
          return json({ error: 'Esta view pertence a outro usuário' }, 403);
        }
        const { error } = await admin.from('task_views').delete().eq('id', view_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Anexos (o upload em si é multipart, tratado antes do switch) ═══
      case 'sign_attachment': {
        const { attachment_id } = body;
        const att = await assertOwned('task_attachments', attachment_id);
        await assertTaskAccess(att.task_id as string);
        // Bucket privado: gera URL temporária em vez de expor o arquivo
        const { data, error } = await admin.storage
          .from('task-attachments')
          .createSignedUrl(att.file_path as string, 3600);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true, url: data.signedUrl });
      }
      case 'delete_attachment': {
        const { attachment_id } = body;
        const att = await assertOwned('task_attachments', attachment_id);
        await assertTaskAccess(att.task_id as string);
        await admin.storage.from('task-attachments').remove([att.file_path as string]);
        const { error } = await admin.from('task_attachments').delete().eq('id', attachment_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Templates de checklist ═══
      case 'create_checklist_template': {
        const { name, items } = body;
        if (!name) return json({ error: 'name is required' }, 400);
        const limpos = (Array.isArray(items) ? items : [])
          .map((i: unknown) => String(i).trim()).filter(Boolean);
        const { data, error } = await admin.from('task_checklist_templates')
          .insert({ tenant_id: tenantId, name, items: limpos, created_by: user.id })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true, id: data.id });
      }
      case 'update_checklist_template': {
        const { template_id, name, items } = body;
        await assertOwned('task_checklist_templates', template_id);
        const patch: Record<string, unknown> = {};
        if (name !== undefined) patch.name = name;
        if (items !== undefined) {
          patch.items = (Array.isArray(items) ? items : [])
            .map((i: unknown) => String(i).trim()).filter(Boolean);
        }
        const { error } = await admin.from('task_checklist_templates').update(patch).eq('id', template_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }
      case 'delete_checklist_template': {
        const { template_id } = body;
        await assertOwned('task_checklist_templates', template_id);
        const { error } = await admin.from('task_checklist_templates').delete().eq('id', template_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }
      case 'apply_checklist_template': {
        const { task_id, template_id } = body;
        await assertTaskAccess(task_id);
        const tpl = await assertOwned('task_checklist_templates', template_id);
        const itens = (tpl.items as string[]) ?? [];
        if (!itens.length) return json({ success: true, added: 0 });
        // Acrescenta ao checklist existente, sem apagar o que já está lá
        const base = Date.now();
        const { error } = await admin.from('task_checklist_items').insert(
          itens.map((title, i) => ({
            tenant_id: tenantId, task_id, title, sort_order: base + i,
          })),
        );
        if (error) return json({ error: errMsg(error) }, 500);
        await logActivity(task_id, 'checklist_template_applied', { template: tpl.name, itens: itens.length });
        return json({ success: true, added: itens.length });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error('[task-write] Error:', errMsg(err));
    return json({ error: errMsg(err) }, 500);
  }
});
