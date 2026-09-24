// task-write — escritas do módulo de Gestão de Tarefas (ver PLANO-MODULO-TAREFAS.md)
// Padrão do projeto: service_role + validação de membership (igual stock-write).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { ACOES_MODELOS, acaoModelos } from './modelos.ts';
import { proximaOcorrencia, validarRecorrencia } from '../_shared/recorrencia.ts';

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

/** Plano de horas por dia: {dias: {"YYYY-MM-DD": minutos}} (0 a 24h por dia, até 366 dias) ou null. */
function validarPlano(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const dias = (v as { dias?: unknown })?.dias;
  if (typeof v !== 'object' || Array.isArray(v) || !dias || typeof dias !== 'object' || Array.isArray(dias)) {
    return 'time_plan deve ser {dias: {data: minutos}}';
  }
  const entradas = Object.entries(dias as Record<string, unknown>);
  if (entradas.length > 366) return 'time_plan: no máximo 366 dias';
  for (const [dia, min] of entradas) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || isNaN(Date.parse(dia))) return `time_plan: data inválida ${dia}`;
    if (typeof min !== 'number' || !Number.isInteger(min) || min < 0 || min > 1440) return `time_plan: minutos inválidos em ${dia}`;
  }
  return null;
}

/** Estimativa em minutos: inteiro de 0 a 1000 h, ou null pra limpar. */
function validarEstimativa(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 60000
    ? null : 'time_estimate_minutes deve ser inteiro entre 0 e 60000';
}

// Próxima ocorrência: ver ../_shared/recorrencia.ts (dias da semana, dia do mês,
// N-ésima sexta, último dia, até quando…). Mesmo cálculo da tela.

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
    // Sem loja: vale para quem tem o módulo Tarefas liberado no Admin Master
    // (Tarefas é por pessoa). Os registros dessa pessoa ficam com tenant_id nulo.
    if (!tenantRows?.length) {
      const { data: temTarefas, error: modErr } = await admin.rpc('fn_user_tem_tarefas', { p_user_id: user.id });
      if (modErr) return json({ error: errMsg(modErr) }, 500);
      if (!temTarefas) return json({ error: 'User does not belong to any tenant' }, 403);
    }

    const resolveTenant = (requested: string | null): string | null => {
      if (!tenantRows?.length) return null;
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
        .from('tasks').select('id, created_by, assignee_id, list_id').eq('id', taskId).maybeSingle();
      if (!taskRow) return json({ error: 'Tarefa não encontrada' }, 404);
      const { data: souResp } = await admin.from('task_assignees')
        .select('user_id').eq('task_id', taskId).eq('user_id', user.id).maybeSingle();
      if (taskRow.assignee_id !== user.id && !souResp) {
        const { data: acessoUp } = await admin.rpc('fn_task_list_access', { p_list_id: taskRow.list_id, p_user_id: user.id });
        if (acessoUp !== 'owner' && acessoUp !== 'edit') {
          return json({ error: 'Você não tem permissão para anexar arquivos nesta tarefa' }, 403);
        }
      }

      const nomeSeguro = (file.name.replace(/[^a-zA-Z0-9.\-_ ]/g, '') || 'arquivo').slice(0, 120);
      const filePath = `${tenantId ?? 'sem-loja'}/${taskId}/${Date.now()}-${nomeSeguro}`;
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

    const tenantId: string | null = resolveTenant(body.active_tenant_id ?? body.tenant_id ?? null);

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
      // Só notifica quem pertence à loja ou enxerga a tarefa (responsável ou
      // acesso à pasta) — pasta compartilhada junta gente de outra loja ou sem
      // loja. Nunca qualquer id: a menção vem do corpo da requisição.
      const { data: membros } = tenantId
        ? await admin.from('user_tenants').select('user_id').eq('tenant_id', tenantId).in('user_id', destinos)
        : { data: [] };
      const validos = (membros ?? []).map((m: { user_id: string }) => m.user_id);
      const fora = destinos.filter((uid) => !validos.includes(uid));
      if (fora.length) {
        const { data: tarefa } = await admin.from('tasks').select('list_id, assignee_id').eq('id', taskId).maybeSingle();
        const { data: resps } = await admin.from('task_assignees').select('user_id').eq('task_id', taskId);
        const idsResp = new Set([tarefa?.assignee_id, ...(resps ?? []).map((r: { user_id: string }) => r.user_id)]);
        for (const uid of fora) {
          if (idsResp.has(uid)) { validos.push(uid); continue; }
          if (!tarefa?.list_id) continue;
          const { data: acesso } = await admin.rpc('fn_task_list_access', { p_list_id: tarefa.list_id, p_user_id: uid });
          if (acesso) validos.push(uid);
        }
      }
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

    // Busca um registro do módulo de tarefas por id. Sem filtro de tenant de
    // propósito: tarefas são do usuário, não da loja — quem criou uma pasta
    // com a Loja A ativa continua dono dela depois de trocar pra Loja B.
    // A autorização de verdade vem de created_by/assignee_id (assertListOwner,
    // assertTaskAccess e os checks manuais logo abaixo), nunca do tenant_id.
    const assertOwned = async (table: string, id: string): Promise<Record<string, unknown>> => {
      const { data, error } = await admin.from(table).select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(errMsg(error));
      if (!data) throw new Error(`${table}: registro não encontrado`);
      return data as Record<string, unknown>;
    };

    // Acesso à pasta (sobe pelos ancestrais): 'owner' = criou ela ou uma pasta
    // acima; 'edit'/'view' = compartilhada (task_list_shares); null = nenhum.
    const acessoPasta = async (listId: string): Promise<'owner' | 'edit' | 'view' | null> => {
      const { data, error } = await admin.rpc('fn_task_list_access', { p_list_id: listId, p_user_id: user.id });
      if (error) throw new Error(errMsg(error));
      return (data as 'owner' | 'edit' | 'view' | null) ?? null;
    };

    // Gerenciar a pasta (status, campos, excluir, compartilhar): só o dono.
    const assertListOwner = async (listId: string): Promise<Record<string, unknown>> => {
      const list = await assertOwned('task_lists', listId);
      if ((await acessoPasta(listId)) !== 'owner') throw new Error('Só o dono da pasta pode fazer isso');
      return list;
    };

    // Criar/editar tarefas e subpastas: dono ou compartilhada com "editar".
    const assertListEdit = async (listId: string): Promise<Record<string, unknown>> => {
      const list = await assertOwned('task_lists', listId);
      const acesso = await acessoPasta(listId);
      if (acesso !== 'owner' && acesso !== 'edit') {
        throw new Error(acesso === 'view' ? 'Você só tem acesso de leitura nesta pasta' : 'Você não tem acesso a esta pasta');
      }
      return list;
    };

    // Tarefa: o responsável faz tudo (é assim que se delega uma tarefa avulsa).
    // O resto vem da PASTA: dono/'edit' editam, 'view' só vê e comenta. Ter
    // CRIADO a tarefa não basta — senão quem perdeu o compartilhamento de uma
    // pasta continuava mexendo nas tarefas que criou nela.
    // Todos os responsáveis da tarefa (task_assignees; o principal fica em tasks.assignee_id).
    const responsaveisDe = async (taskId: string): Promise<string[]> => {
      const { data } = await admin.from('task_assignees').select('user_id').eq('task_id', taskId);
      return (data ?? []).map((r: { user_id: string }) => r.user_id);
    };

    // Troca a lista de responsáveis (tabela), avisa quem entrou e registra.
    // `antesDaGravacao`: lista lida ANTES do update da tarefa — o gatilho
    // trg_task_assignee_principal já põe o novo principal na tabela ao gravar, e
    // relendo aqui ele não contaria como "entrou" (sem aviso nem registro).
    const sincronizarResponsaveis = async (taskId: string, ids: string[], titulo: unknown, antesDaGravacao?: string[]) => {
      const agora = await responsaveisDe(taskId);
      const antes = antesDaGravacao ?? agora;
      const sair = antes.filter((id) => !ids.includes(id));
      const entrar = ids.filter((id) => !antes.includes(id));
      // Grava pela lista atual da tabela (o gatilho pode já ter feito parte).
      const tirar = agora.filter((id) => !ids.includes(id));
      const por = ids.filter((id) => !agora.includes(id));
      if (tirar.length) await admin.from('task_assignees').delete().eq('task_id', taskId).in('user_id', tirar);
      if (por.length) {
        await admin.from('task_assignees').upsert(
          por.map((id) => ({ task_id: taskId, user_id: id, added_by: user.id })),
          { onConflict: 'task_id,user_id', ignoreDuplicates: true },
        );
      }
      if (sair.length || entrar.length) {
        await logActivity(taskId, 'assignee_changed', { to: ids, entraram: entrar, sairam: sair });
        if (entrar.length) await notify(entrar, taskId, 'assigned', { title: titulo });
      }
    };

    // Horas/folgas de outra pessoa: só de quem divide alguma loja comigo.
    const podeMexerHoras = async (alvo: string): Promise<boolean> => {
      if (alvo === user.id) return true;
      const meusTenants = (tenantRows ?? []).map((r) => r.tenant_id);
      if (!meusTenants.length) return false;
      const { data: comum } = await admin.from('user_tenants')
        .select('tenant_id').eq('user_id', alvo).in('tenant_id', meusTenants).limit(1);
      return !!comum?.length;
    };

    const assertTaskAccess = async (taskId: string, nivel: 'edit' | 'comment' | 'view' = 'edit'): Promise<Record<string, unknown>> => {
      const task = await assertOwned('tasks', taskId);
      if (task.assignee_id === user.id || (await responsaveisDe(taskId)).includes(user.id)) return task;
      const acesso = await acessoPasta(task.list_id as string);
      if (acesso === 'owner' || acesso === 'edit') return task;
      if (acesso === 'view' && nivel !== 'edit') return task;
      throw new Error(acesso === 'view' ? 'Você só tem acesso de leitura nesta pasta' : 'Você não tem permissão para editar esta tarefa');
    };

    // Responsável de tarefa: quem divide alguma loja com o DONO da pasta ou tem
    // acesso ao módulo Tarefas. Sem isso, quem tem "editar" podia atribuir a
    // tarefa a qualquer id e dar acesso a ela pra alguém de fora.
    const assertResponsavelValido = async (listId: string, assigneeId: unknown) => {
      if (!assigneeId) return;
      const { data: pasta } = await admin.from('task_lists').select('created_by').eq('id', listId).maybeSingle();
      const { data: ok, error } = await admin.rpc('fn_task_responsavel_valido', { p_dono: pasta?.created_by ?? user.id, p_responsavel: assigneeId });
      if (error) throw new Error(errMsg(error));
      if (!ok) throw new Error('Esse responsável não tem acesso ao módulo Tarefas');
    };

    // ═══ Modelos de estrutura de pastas (ações em ./modelos.ts) ═══
    if (ACOES_MODELOS.has(action)) {
      return await acaoModelos(action, { admin, userId: user.id, tenantId, body, json, errMsg, notify });
    }

    switch (action) {
      // ═══ Listas ═══
      case 'create_list': {
        const { name, color, icon, parent_list_id } = body;
        if (!name) return json({ error: 'name is required' }, 400);
        // Subpasta criada por quem só tem "editar" fica do DONO da pasta-mãe —
        // senão quem a criou viraria dono dela (e o dono de verdade, só por herança).
        const pai = parent_list_id ? await assertListEdit(parent_list_id) : null;
        const { data, error } = await admin.from('task_lists')
          .insert({
            tenant_id: tenantId, name, color: color ?? '#6366f1', icon: icon ?? null,
            parent_list_id: parent_list_id ?? null, created_by: (pai?.created_by as string | undefined) ?? user.id,
          })
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
      case 'delete_list': {
        // Remove a pasta, todas as subpastas (qualquer profundidade) e as
        // tarefas delas. Arquiva em vez de apagar, como o delete_task — e
        // arquiva as tarefas também, senão as atribuídas a outra pessoa
        // continuariam aparecendo pra ela (fn_get_tasks não olha a pasta).
        const { list_id } = body;
        if (!list_id) return json({ error: 'list_id is required' }, 400);
        await assertListOwner(list_id);
        const ids: string[] = [list_id];
        let fronteira: string[] = [list_id];
        while (fronteira.length > 0) {
          const { data, error } = await admin.from('task_lists').select('id')
            .in('parent_list_id', fronteira).eq('created_by', user.id).eq('is_archived', false);
          if (error) return json({ error: errMsg(error) }, 500);
          fronteira = (data ?? []).map((r: { id: string }) => r.id).filter((id: string) => !ids.includes(id));
          ids.push(...fronteira);
        }
        const { error: tErr } = await admin.from('tasks').update({ is_archived: true }).in('list_id', ids).eq('is_archived', false);
        if (tErr) return json({ error: errMsg(tErr) }, 500);
        const { error: lErr } = await admin.from('task_lists').update({ is_archived: true }).in('id', ids);
        if (lErr) return json({ error: errMsg(lErr) }, 500);
        return json({ success: true, deleted_lists: ids.length });
      }

      // ═══ Compartilhar pasta ═══
      // Vale pra pasta e toda a subárvore. Só o dono compartilha. A pessoa é
      // achada por e-mail exato ou matrícula, entre quem tem acesso ao módulo
      // Tarefas (decisão do dono 2026-09-23: não precisa ser da mesma loja).
      case 'share_list': {
        const { list_id, identificador, permission } = body;
        if (!list_id || !identificador) return json({ error: 'Informe a pasta e o e-mail ou matrícula' }, 400);
        if (permission !== 'view' && permission !== 'edit') return json({ error: 'Permissão deve ser view ou edit' }, 400);
        const pasta = await assertListOwner(list_id);
        // E-mail EXATO (sem curinga — ilike deixava "a%@%" varrer e-mails) ou
        // matrícula, só entre quem tem o módulo Tarefas.
        const termo = String(identificador).trim();
        const { data: achados, error: buscaErr } = await admin.rpc('fn_task_share_lookup', { p_requester: user.id, p_termo: termo });
        if (buscaErr) return json({ error: errMsg(buscaErr) }, 500);
        if (!achados?.length) return json({ error: 'Ninguém com esse e-mail ou matrícula com acesso ao módulo Tarefas' }, 404);
        if (achados.length > 1) return json({ error: 'Mais de uma pessoa com essa matrícula — use o e-mail' }, 409);
        const alvo = achados[0] as { id: string; name: string | null; email: string | null };
        if (alvo.id === user.id || alvo.id === pasta.created_by) return json({ error: 'Essa pessoa já é dona da pasta' }, 400);
        const { data: share, error } = await admin.from('task_list_shares')
          .upsert({ list_id, user_id: alvo.id, permission, invited_by: user.id }, { onConflict: 'list_id,user_id' })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);

        // Aviso no celular (push). Falha aqui não desfaz o compartilhamento.
        try {
          const { data: eu } = await admin.from('users').select('name').eq('id', user.id).maybeSingle();
          await fetch(`${supabaseUrl}/functions/v1/send-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({
              action: 'send', user_ids: [alvo.id], tenant_id: tenantId,
              payload: {
                titulo: 'Pasta compartilhada com você',
                corpo: `${eu?.name ?? 'Alguém'} compartilhou "${pasta.name}" (${permission === 'edit' ? 'pode editar' : 'só ver'})`,
                url: '/tarefas',
              },
            }),
          });
        } catch (e) {
          console.error('[task-write] push de compartilhamento falhou (ignorado):', e instanceof Error ? e.message : e);
        }
        return json({ success: true, id: share.id, user: { id: alvo.id, name: alvo.name, email: alvo.email } });
      }
      case 'update_share': {
        const { share_id, permission } = body;
        if (permission !== 'view' && permission !== 'edit') return json({ error: 'Permissão deve ser view ou edit' }, 400);
        const share = await assertOwned('task_list_shares', share_id);
        await assertListOwner(share.list_id as string);
        const { error } = await admin.from('task_list_shares').update({ permission }).eq('id', share_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }
      case 'set_share_exclusion': {
        // Subpasta fora do compartilhamento (2026-09-24): deixa de herdar os compartilhamentos das
        // pastas de cima (ela e tudo abaixo). Só quem é dono da pasta-mãe decide — quem só edita
        // uma pasta compartilhada não consegue esconder uma subpasta do dono nem dos outros.
        const { list_id, excluded } = body;
        if (!list_id || typeof excluded !== 'boolean') return json({ error: 'Informe a subpasta e se ela fica fora' }, 400);
        const sub = await assertOwned('task_lists', list_id);
        if (!sub.parent_list_id) return json({ error: 'Só subpastas podem ficar fora do compartilhamento' }, 400);
        if ((await acessoPasta(sub.parent_list_id as string)) !== 'owner') {
          return json({ error: 'Só o dono da pasta pode tirar subpastas do compartilhamento' }, 403);
        }
        const { error } = excluded
          ? await admin.from('task_list_share_exclusions').upsert({ list_id, created_by: user.id }, { onConflict: 'list_id' })
          : await admin.from('task_list_share_exclusions').delete().eq('list_id', list_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }
      case 'remove_share': {
        // O dono tira alguém; ou a própria pessoa "sai" da pasta.
        const { share_id } = body;
        const share = await assertOwned('task_list_shares', share_id);
        if (share.user_id !== user.id) await assertListOwner(share.list_id as string);
        const { error } = await admin.from('task_list_shares').delete().eq('id', share_id);
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
          await admin.from('tasks').update({ status_id: reassign_to }).eq('status_id', status_id);
        }
        const { error } = await admin.from('task_statuses').delete().eq('id', status_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Tarefas ═══
      case 'create_task': {
        const { list_id, title, description, status_id, priority, start_date, due_date, due_has_time, parent_task_id, recurrence, sort_order, tag_ids, time_estimate_minutes } = body;
        // Vários responsáveis (assignee_ids) ou um só (assignee_id, como antes).
        const idsResp: string[] = Array.isArray(body.assignee_ids)
          ? [...new Set((body.assignee_ids as unknown[]).filter((x): x is string => typeof x === 'string' && !!x))]
          : body.assignee_id ? [String(body.assignee_id)] : [];
        if (idsResp.length > 20) return json({ error: 'No máximo 20 responsáveis' }, 400);
        const assignee_id = idsResp[0] ?? null;
        if (!list_id || !title) return json({ error: 'list_id and title are required' }, 400);
        const estimativaErro = validarEstimativa(time_estimate_minutes);
        if (estimativaErro) return json({ error: estimativaErro }, 400);
        const recErroNovo = validarRecorrencia(recurrence);
        if (recErroNovo) return json({ error: recErroNovo }, 400);
        await assertListEdit(list_id);
        for (const id of idsResp) await assertResponsavelValido(list_id, id);
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
          time_estimate_minutes: time_estimate_minutes ?? null,
          created_by: user.id,
        }).select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        if (Array.isArray(tag_ids) && tag_ids.length) {
          await admin.from('task_tag_links').insert(
            tag_ids.map((tid: string) => ({ tenant_id: tenantId, task_id: data.id, tag_id: tid })),
          );
        }
        await logActivity(data.id, 'created', { title });
        // O gatilho já colocou o principal na lista; aqui entram os demais.
        if (idsResp.length > 1) {
          await admin.from('task_assignees').upsert(
            idsResp.slice(1).map((id) => ({ task_id: data.id, user_id: id, added_by: user.id })),
            { onConflict: 'task_id,user_id', ignoreDuplicates: true },
          );
        }
        if (idsResp.length) await notify(idsResp, data.id, 'assigned', { title });
        return json({ success: true, id: data.id });
      }

      case 'update_task': {
        const { task_id, ...rest } = body;
        const current = await assertTaskAccess(task_id);
        if (rest.list_id !== undefined && rest.list_id !== current.list_id) await assertListEdit(rest.list_id);
        // Lista nova de responsáveis: assignee_ids (vários) ou assignee_id (um só, como
        // antes — substitui todos). O principal (tasks.assignee_id) continua o mesmo se
        // ainda estiver na lista; senão vira o primeiro.
        let novosResp: string[] | null = null;
        let respAntes: string[] | undefined;
        if (Array.isArray(rest.assignee_ids)) {
          novosResp = [...new Set((rest.assignee_ids as unknown[]).filter((x): x is string => typeof x === 'string' && !!x))];
          if (novosResp.length > 20) return json({ error: 'No máximo 20 responsáveis' }, 400);
          rest.assignee_id = novosResp.includes(current.assignee_id as string) ? current.assignee_id : (novosResp[0] ?? null);
        } else if (rest.assignee_id !== undefined && rest.assignee_id !== current.assignee_id) {
          // Só o responsável (formato antigo) e ele MUDOU: passa a tarefa pra essa pessoa.
          novosResp = rest.assignee_id ? [String(rest.assignee_id)] : [];
        }
        if (novosResp) {
          const jaEram = await responsaveisDe(task_id);
          respAntes = jaEram;
          for (const id of novosResp) {
            if (!jaEram.includes(id)) await assertResponsavelValido((rest.list_id ?? current.list_id) as string, id);
          }
        }
        const patch: Record<string, unknown> = {};
        const editable = ['title', 'description', 'status_id', 'priority', 'assignee_id', 'start_date', 'due_date', 'due_has_time', 'list_id', 'sort_order', 'recurrence', 'is_archived', 'parent_task_id', 'time_estimate_minutes', 'time_plan'];
        for (const k of editable) {
          if (rest[k] !== undefined) patch[k] = rest[k];
        }
        if (patch.recurrence !== undefined) {
          const recErro = validarRecorrencia(patch.recurrence);
          if (recErro) return json({ error: recErro }, 400);
        }
        if (patch.time_estimate_minutes !== undefined) {
          const estimativaErro = validarEstimativa(patch.time_estimate_minutes);
          if (estimativaErro) return json({ error: estimativaErro }, 400);
        }
        if (patch.time_plan !== undefined) {
          const planoErro = validarPlano(patch.time_plan);
          if (planoErro) return json({ error: planoErro }, 400);
          // Com plano, a estimativa é SEMPRE a soma dos dias (nunca ficam contraditórios).
          if (patch.time_plan) {
            const soma = Object.values((patch.time_plan as { dias: Record<string, number> }).dias).reduce((a, b) => a + b, 0);
            patch.time_estimate_minutes = soma;
          }
        } else if (patch.time_estimate_minutes !== undefined && current.time_plan) {
          // Mudou só a estimativa (ex.: pela coluna da lista): o plano por dia deixa de
          // bater, então volta pro automático.
          patch.time_plan = null;
        }

        // Resolve o status pelo NOME DA CATEGORIA em vez do id — necessário
        // sempre que quem está escrevendo não enxerga os status da lista (tarefa
        // compartilhada) ou nem sabe a qual lista a tarefa pertence (visões
        // agregadas como "Minhas"/"Todas", que misturam tarefas de várias
        // pastas com status_id diferentes por trás do mesmo "Concluído").
        if (patch.status_id === undefined) {
          if (rest.status_category) {
            const { data: resolvido } = await admin.from('task_statuses')
              .select('id').eq('list_id', current.list_id).eq('category', rest.status_category)
              .order('sort_order').limit(1).maybeSingle();
            if (resolvido) patch.status_id = resolvido.id;
          } else if (rest.status_action === 'undone') {
            // "Desmarcar" não tem uma categoria única de destino — pega o
            // primeiro status não-terminal da própria lista da tarefa.
            const { data: resolvido } = await admin.from('task_statuses')
              .select('id').eq('list_id', current.list_id).not('category', 'in', '(done,cancelled)')
              .order('sort_order').limit(1).maybeSingle();
            if (resolvido) patch.status_id = resolvido.id;
          }
        }

        // Mudança de status: registra atividade e trata conclusão/recorrência
        let createdNextId: string | null = null;
        if (patch.status_id && patch.status_id !== current.status_id) {
          const { data: newStatus } = await admin.from('task_statuses')
            .select('id, name, category').eq('id', patch.status_id).maybeSingle();
          if (!newStatus) return json({ error: 'status inexistente' }, 400);
          await logActivity(task_id, 'status_changed', { to: newStatus.name });
          if (newStatus.category === 'done') {
            patch.completed_at = new Date().toISOString();
            // Recorrência: cria a próxima ocorrência (modelo Todoist)
            const rec = (patch.recurrence ?? current.recurrence) as Parameters<typeof proximaOcorrencia>[1];
            if (rec && rec.freq) {
              const nextDue = proximaOcorrencia(current.due_date as string | null, rec);
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
                  const respsRec = await responsaveisDe(task_id);
                  if (respsRec.length) {
                    await admin.from('task_assignees').upsert(
                      respsRec.map((id) => ({ task_id: next.id, user_id: id, added_by: user.id })),
                      { onConflict: 'task_id,user_id', ignoreDuplicates: true },
                    );
                  }
                  await logActivity(next.id, 'created_from_recurrence', { source_task_id: task_id });
                }
              }
            }
          } else {
            patch.completed_at = null;
          }
        }
        // (a troca de responsáveis é registrada/avisada em sincronizarResponsaveis, depois de gravar)
        if (patch.due_date !== undefined && patch.due_date !== current.due_date) {
          await logActivity(task_id, 'due_date_changed', { to: patch.due_date });
        }
        if (patch.priority !== undefined && patch.priority !== current.priority) {
          await logActivity(task_id, 'priority_changed', { to: patch.priority });
        }
        if (patch.time_estimate_minutes !== undefined && patch.time_estimate_minutes !== current.time_estimate_minutes) {
          await logActivity(task_id, 'estimate_changed', { to: patch.time_estimate_minutes });
        }

        if (Object.keys(patch).length) {
          const { error } = await admin.from('tasks').update(patch).eq('id', task_id);
          if (error) return json({ error: errMsg(error) }, 500);
        }
        if (novosResp) await sincronizarResponsaveis(task_id, novosResp, current.title, respAntes);

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
        const acessoArq = await acessoPasta(current.list_id as string);
        if (acessoArq !== 'owner' && acessoArq !== 'edit') return json({ error: 'Só quem edita a pasta pode arquivar a tarefa' }, 403);
        const { error } = await admin.from('tasks').update({ is_archived: true }).eq('id', task_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Cronômetro ═══
      // Um cronômetro rodando por pessoa (índice único parcial no banco):
      // iniciar numa tarefa encerra o que estiver rodando em outra.
      case 'start_timer': {
        const { task_id } = body;
        if (!task_id) return json({ error: 'task_id is required' }, 400);
        await assertTaskAccess(task_id);
        const agora = new Date().toISOString();
        const { data: rodando } = await admin.from('task_time_entries')
          .select('id, task_id').eq('user_id', user.id).is('ended_at', null).maybeSingle();
        if (rodando && rodando.task_id === task_id) return json({ success: true, id: rodando.id });
        if (rodando) {
          await admin.from('task_time_entries').update({ ended_at: agora }).eq('id', rodando.id);
        }
        const { data, error } = await admin.from('task_time_entries')
          .insert({ tenant_id: tenantId, task_id, user_id: user.id, started_at: agora })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true, id: data.id, stopped_task_id: rodando?.task_id ?? null });
      }
      case 'stop_timer': {
        const { data: rodando } = await admin.from('task_time_entries')
          .select('id, task_id, started_at').eq('user_id', user.id).is('ended_at', null).maybeSingle();
        if (!rodando) return json({ success: true, seconds: 0 });
        const fim = new Date();
        const { error } = await admin.from('task_time_entries').update({ ended_at: fim.toISOString() }).eq('id', rodando.id);
        if (error) return json({ error: errMsg(error) }, 500);
        const segundos = Math.max(0, Math.round((fim.getTime() - new Date(rodando.started_at).getTime()) / 1000));
        await logActivity(rodando.task_id, 'time_tracked', { seconds: segundos });
        return json({ success: true, seconds: segundos, task_id: rodando.task_id });
      }
      case 'add_time_entry': {
        // Lançamento manual ("esqueci de ligar o cronômetro"). Minutos > 0
        // somam; negativos descontam do tempo que a PRÓPRIA pessoa registrou.
        const { task_id, minutes } = body;
        const min = Number(minutes);
        if (!task_id || !Number.isInteger(min) || min === 0 || Math.abs(min) > 24 * 60) {
          return json({ error: 'minutes deve ser inteiro, diferente de 0, até 24h' }, 400);
        }
        await assertTaskAccess(task_id);
        if (min < 0) {
          let falta = -min * 60;
          const { data: minhas } = await admin.from('task_time_entries')
            .select('id, started_at, ended_at').eq('task_id', task_id).eq('user_id', user.id)
            .not('ended_at', 'is', null).order('ended_at', { ascending: false });
          const meuTotal = (minhas ?? []).reduce((acc: number, e: { started_at: string; ended_at: string }) =>
            acc + (new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()) / 1000, 0);
          if (meuTotal < falta) return json({ error: 'Só dá pra descontar do tempo que você mesmo registrou' }, 400);
          for (const e of minhas ?? []) {
            if (falta <= 0) break;
            const dur = (new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()) / 1000;
            if (dur <= falta) {
              await admin.from('task_time_entries').delete().eq('id', e.id);
              falta -= dur;
            } else {
              await admin.from('task_time_entries')
                .update({ ended_at: new Date(new Date(e.ended_at).getTime() - falta * 1000).toISOString() }).eq('id', e.id);
              falta = 0;
            }
          }
        } else {
          const fim = new Date();
          const inicio = new Date(fim.getTime() - min * 60 * 1000);
          const { error } = await admin.from('task_time_entries').insert({
            tenant_id: tenantId, task_id, user_id: user.id,
            started_at: inicio.toISOString(), ended_at: fim.toISOString(),
          });
          if (error) return json({ error: errMsg(error) }, 500);
        }
        await logActivity(task_id, 'time_added', { minutes: min });
        return json({ success: true });
      }

      // ═══ Avisos de vencimento: preferências da própria pessoa ═══
      case 'set_notification_prefs': {
        const { ativo, lembretes, hora_dia_todo, vibrar, incluir_criadas_sem_resp } = body;
        const lista = Array.isArray(lembretes) ? [...new Set(lembretes as unknown[])] : [];
        if (lista.length > 8 || !lista.every((m) => typeof m === 'number' && Number.isInteger(m) && m >= 0 && m <= 10080)) {
          return json({ error: 'lembretes: até 8 valores em minutos, de 0 a 7 dias' }, 400);
        }
        if (typeof hora_dia_todo !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora_dia_todo)) {
          return json({ error: 'hora_dia_todo deve ser HH:MM' }, 400);
        }
        const { error } = await admin.from('task_notification_prefs').upsert({
          user_id: user.id,
          ativo: ativo !== false,
          lembretes: (lista as number[]).sort((a, b) => b - a),
          hora_dia_todo,
          vibrar: vibrar !== false,
          incluir_criadas_sem_resp: incluir_criadas_sem_resp !== false,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Carga de trabalho: horas por dia de cada pessoa ═══
      case 'set_capacity': {
        // hours[0] = domingo … hours[6] = sábado. Qualquer um pode ajustar as
        // próprias horas ou as de quem divide alguma loja com ele.
        const { user_id: alvo, hours } = body;
        if (!alvo) return json({ error: 'user_id is required' }, 400);
        const valido = Array.isArray(hours) && hours.length === 7
          && hours.every((h: unknown) => typeof h === 'number' && Number.isFinite(h) && h >= 0 && h <= 24);
        if (!valido) return json({ error: 'hours deve ter 7 números entre 0 e 24' }, 400);
        if (!(await podeMexerHoras(alvo))) return json({ error: 'Essa pessoa não é de nenhuma das suas lojas' }, 403);
        const { error } = await admin.from('task_user_capacity').upsert({
          user_id: alvo, hours, updated_by: user.id, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // Folga/ausência em dias específicos (Carga). horas = quanto trabalha no dia (0 = não trabalha).
      case 'set_absence':
      case 'remove_absence': {
        const { user_id: alvo, dias, horas, motivo } = body;
        if (!alvo) return json({ error: 'user_id is required' }, 400);
        const lista = Array.isArray(dias) ? [...new Set(dias as unknown[])] : [];
        if (!lista.length || lista.length > 62 || !lista.every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))) {
          return json({ error: 'dias deve ter de 1 a 62 datas AAAA-MM-DD' }, 400);
        }
        if (!(await podeMexerHoras(alvo))) return json({ error: 'Essa pessoa não é de nenhuma das suas lojas' }, 403);
        if (action === 'remove_absence') {
          const { error } = await admin.from('task_user_absences').delete().eq('user_id', alvo).in('dia', lista as string[]);
          if (error) return json({ error: errMsg(error) }, 500);
          return json({ success: true });
        }
        const h = horas === undefined || horas === null ? 0 : Number(horas);
        if (!Number.isFinite(h) || h < 0 || h > 24) return json({ error: 'horas deve ser entre 0 e 24' }, 400);
        const texto = typeof motivo === 'string' ? motivo.trim().slice(0, 80) || null : null;
        const { error } = await admin.from('task_user_absences').upsert(
          (lista as string[]).map((dia) => ({ user_id: alvo, dia, horas: h, motivo: texto, created_by: user.id })),
          { onConflict: 'user_id,dia' },
        );
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
        await assertTaskAccess(task_id, 'comment');
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
        const resps = [...new Set([tarefa?.assignee_id as string | null, ...(await responsaveisDe(task_id))])]
          .filter((id): id is string => !!id && !listaMencoes.includes(id));
        if (resps.length) await notify(resps, task_id, 'commented', { title: tarefa?.title, trecho });
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
          .insert({ tenant_id: tenantId, name, color: color ?? '#64748b', created_by: user.id })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true, id: data.id });
      }
      case 'update_tag': {
        const { tag_id, ...rest } = body;
        const tag = await assertOwned('task_tags', tag_id);
        if (tag.created_by !== user.id) return json({ error: 'Esta etiqueta é de outro usuário' }, 403);
        const patch: Record<string, unknown> = {};
        for (const k of ['name', 'color']) if (rest[k] !== undefined) patch[k] = rest[k];
        const { error } = await admin.from('task_tags').update(patch).eq('id', tag_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }
      case 'delete_tag': {
        const { tag_id } = body;
        const tag = await assertOwned('task_tags', tag_id);
        if (tag.created_by !== user.id) return json({ error: 'Esta etiqueta é de outro usuário' }, 403);
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
          .insert({ tenant_id: tenantId, name, field_type, list_id: list_id ?? null, options: options ?? [], show_on_card: show_on_card ?? false, sort_order: Date.now(), created_by: user.id })
          .select('id').single();
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true, id: data.id });
      }
      case 'update_field': {
        const { field_id, ...rest } = body;
        const field = await assertOwned('task_custom_fields', field_id);
        if (field.created_by !== user.id) return json({ error: 'Este campo é de outro usuário' }, 403);
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
          .eq('id', notification_id).eq('user_id', user.id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }
      case 'mark_all_notifications_read': {
        const { error } = await admin.from('task_notifications')
          .update({ is_read: true })
          .eq('user_id', user.id).eq('is_read', false);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Views salvas ═══
      case 'create_view': {
        const { name, list_id, view_type, group_by, filters } = body;
        if (!name) return json({ error: 'name is required' }, 400);
        if (list_id && !(await acessoPasta(list_id))) return json({ error: 'Você não tem acesso a esta pasta' }, 403);
        const { data, error } = await admin.from('task_views').insert({
          tenant_id: tenantId,
          list_id: list_id ?? null,
          user_id: user.id,
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
        if (view.created_by !== user.id) return json({ error: 'Esta view é de outro usuário' }, 403);
        const patch: Record<string, unknown> = {};
        for (const k of ['name', 'view_type', 'group_by', 'filters', 'sort_order']) {
          if (rest[k] !== undefined) patch[k] = rest[k];
        }
        const { error } = await admin.from('task_views').update(patch).eq('id', view_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }
      case 'delete_view': {
        const { view_id } = body;
        const view = await assertOwned('task_views', view_id);
        if (view.created_by !== user.id) return json({ error: 'Esta view é de outro usuário' }, 403);
        const { error } = await admin.from('task_views').delete().eq('id', view_id);
        if (error) return json({ error: errMsg(error) }, 500);
        return json({ success: true });
      }

      // ═══ Anexos (o upload em si é multipart, tratado antes do switch) ═══
      case 'sign_attachment': {
        const { attachment_id } = body;
        const att = await assertOwned('task_attachments', attachment_id);
        await assertTaskAccess(att.task_id as string, 'view');
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
        const template0 = await assertOwned('task_checklist_templates', template_id);
        if (template0.created_by !== user.id) return json({ error: 'Este template é de outro usuário' }, 403);
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
        const template1 = await assertOwned('task_checklist_templates', template_id);
        if (template1.created_by !== user.id) return json({ error: 'Este template é de outro usuário' }, 403);
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
