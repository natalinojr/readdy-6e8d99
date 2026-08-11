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
    const body = await req.json();
    const { action } = body;
    if (!action) return json({ error: 'action is required' }, 400);

    // ── Resolve tenant por membership (nunca confiar só no body) ──
    const requestedTenantId: string | null = body.active_tenant_id ?? body.tenant_id ?? null;
    const { data: tenantRows, error: tenantErr } = await admin
      .from('user_tenants').select('tenant_id, role').eq('user_id', user.id);
    if (tenantErr) return json({ error: `Tenant lookup failed: ${errMsg(tenantErr)}` }, 500);
    if (!tenantRows?.length) return json({ error: 'User does not belong to any tenant' }, 403);

    const match = requestedTenantId ? tenantRows.find((r) => r.tenant_id === requestedTenantId) : null;
    const tenantId: string = match?.tenant_id ?? tenantRows[0].tenant_id;

    console.log('[task-write]', action, 'user:', user.id, 'tenant:', tenantId);

    const logActivity = async (taskId: string, act: string, payload: Record<string, unknown> = {}) => {
      await admin.from('task_activity').insert({
        tenant_id: tenantId, task_id: taskId, user_id: user.id, action: act, payload,
      });
    };

    // Garante que um registro pertence ao tenant resolvido
    const assertOwned = async (table: string, id: string): Promise<Record<string, unknown>> => {
      const { data, error } = await admin.from(table).select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      if (error) throw new Error(errMsg(error));
      if (!data) throw new Error(`${table}: registro não encontrado neste tenant`);
      return data as Record<string, unknown>;
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
        await assertOwned('task_lists', list_id);
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
        await assertOwned('task_lists', list_id);
        const { data, error } = await admin.from('task_statuses')
          .insert({ tenant_id: tenantId, list_id, name, color: color ?? '#94a3b8', category: category ?? 'todo', sort_order: sort_order ?? 99 })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true, id: data.id });
      }
      case 'update_status': {
        const { status_id, ...rest } = body;
        await assertOwned('task_statuses', status_id);
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
        await assertOwned('task_statuses', status_id);
        if (reassign_to) {
          await assertOwned('task_statuses', reassign_to);
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
        await assertOwned('task_lists', list_id);
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
        return json({ success: true, id: data.id });
      }

      case 'update_task': {
        const { task_id, ...rest } = body;
        const current = await assertOwned('tasks', task_id);
        const patch: Record<string, unknown> = {};
        const editable = ['title', 'description', 'status_id', 'priority', 'assignee_id', 'start_date', 'due_date', 'due_has_time', 'list_id', 'sort_order', 'recurrence', 'is_archived', 'parent_task_id'];
        for (const k of editable) {
          if (rest[k] !== undefined) patch[k] = rest[k];
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
                  created_by: user.id,
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
        await assertOwned('tasks', task_id);
        const { error } = await admin.from('tasks').update({ is_archived: true }).eq('id', task_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Checklist ═══
      case 'add_checklist_item': {
        const { task_id, title } = body;
        if (!task_id || !title) return json({ error: 'task_id and title are required' }, 400);
        await assertOwned('tasks', task_id);
        const { data, error } = await admin.from('task_checklist_items')
          .insert({ tenant_id: tenantId, task_id, title, sort_order: Date.now() })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true, id: data.id });
      }
      case 'update_checklist_item': {
        const { item_id, ...rest } = body;
        await assertOwned('task_checklist_items', item_id);
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
        await assertOwned('task_checklist_items', item_id);
        const { error } = await admin.from('task_checklist_items').delete().eq('id', item_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Comentários ═══
      case 'add_comment': {
        const { task_id, body: commentBody, mentions } = body;
        if (!task_id || !commentBody) return json({ error: 'task_id and body are required' }, 400);
        await assertOwned('tasks', task_id);
        const { data, error } = await admin.from('task_comments')
          .insert({ tenant_id: tenantId, task_id, user_id: user.id, body: commentBody, mentions: mentions ?? [] })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
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
        if (list_id) await assertOwned('task_lists', list_id);
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
        await assertOwned('tasks', task_id);
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

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error('[task-write] Error:', errMsg(err));
    return json({ error: errMsg(err) }, 500);
  }
});
