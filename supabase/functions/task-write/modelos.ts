// ═══ Modelos de estrutura de pastas ═══
// Ações do task-write para salvar uma pasta (com a subárvore) como modelo,
// aplicar um modelo e mantê-lo (renomear, opções, regravar, versões).
// Fica fora do index.ts de propósito: o index é mexido por outras frentes
// (ex.: compartilhamento de pastas) e aqui é só chamado pelo switch.
// Lógica pura (montar/filtrar/planejar): ../_shared/modelo-estrutura.ts.
import {
  montarModelo, filtrarModelo, planejarAplicacao, resolverStatus, resumirModelo, normalizarOpcoes,
  diaLocal, LIMITE_PASTAS, LIMITE_TAREFAS,
  type OrigemBruta, type ModeloConteudo, type ExibicaoModelo, type PastaModelo, type TarefaModelo,
} from '../_shared/modelo-estrutura.ts';

export const ACOES_MODELOS = new Set([
  'preview_structure_template',
  'save_structure_template',
  'update_structure_template',
  'duplicate_structure_template',
  'delete_structure_template',
  'restore_structure_template_version',
  'apply_structure_template',
]);

/** Quantas versões anteriores ficam guardadas por modelo. */
const VERSOES_GUARDADAS = 10;

export interface CtxModelos {
  // deno-lint-ignore no-explicit-any
  admin: any;
  userId: string;
  tenantId: string | null;
  body: Record<string, unknown>;
  json: (b: unknown, status?: number) => Response;
  errMsg: (e: unknown) => string;
  notify: (userIds: Array<string | null | undefined>, taskId: string, type: 'assigned', payload?: Record<string, unknown>) => Promise<void>;
}

async function emLotes<T>(ids: string[], ler: (lote: string[]) => Promise<T[]>, tamanho = 150): Promise<T[]> {
  const r: T[] = [];
  for (let i = 0; i < ids.length; i += tamanho) r.push(...(await ler(ids.slice(i, i + tamanho))));
  return r;
}

export async function acaoModelos(action: string, c: CtxModelos): Promise<Response> {
  const { admin, userId, body, json, errMsg } = c;

  const falhou = (e: { message?: string } | null | undefined) => {
    if (e) throw new Error(errMsg(e));
  };

  // A API devolve no máximo 1000 linhas por consulta: lê em páginas.
  // deno-lint-ignore no-explicit-any
  const paginar = async (montar: () => any): Promise<any[]> => {
    // deno-lint-ignore no-explicit-any
    const r: any[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await montar().range(de, de + 999);
      falhou(error);
      r.push(...(data ?? []));
      if (!data || data.length < 1000) return r;
    }
  };

  const acesso = async (listId: string): Promise<string | null> => {
    const { data, error } = await admin.rpc('fn_task_list_access', { p_list_id: listId, p_user_id: userId });
    falhou(error);
    return (data as string | null) ?? null;
  };

  const meuModelo = async (id: unknown) => {
    if (typeof id !== 'string' || !id) throw new Error('template_id é obrigatório');
    const { data, error } = await admin.from('task_structure_templates').select('*').eq('id', id).maybeSingle();
    falhou(error);
    if (!data) throw new Error('Modelo não encontrado');
    if (data.created_by !== userId) throw new Error('Este modelo é de outro usuário');
    return data as {
      id: string; name: string; description: string | null; content: ModeloConteudo; options: unknown;
      source_list_id: string | null; version: number;
    };
  };

  /** Lê a pasta e tudo o que há dentro dela, pronto para virar modelo. */
  const lerOrigem = async (listId: string, exibicao: unknown): Promise<OrigemBruta> => {
    if (!(await acesso(listId))) throw new Error('Você não tem acesso a esta pasta');

    const { data: raiz, error: rErr } = await admin.from('task_lists')
      .select('id, name, color, icon, parent_list_id, sort_order, is_archived').eq('id', listId).maybeSingle();
    falhou(rErr);
    if (!raiz || raiz.is_archived) throw new Error('Pasta não encontrada');

    const pastas: OrigemBruta['pastas'] = [raiz];
    let fronteira = [listId];
    while (fronteira.length) {
      const filhas = await emLotes(fronteira, (lote) => paginar(() => admin.from('task_lists')
          .select('id, name, color, icon, parent_list_id, sort_order').in('parent_list_id', lote).eq('is_archived', false)));
      const novas = filhas.filter((f: { id: string }) => !pastas.some((p) => p.id === f.id));
      pastas.push(...novas);
      if (pastas.length > LIMITE_PASTAS) throw new Error(`A pasta tem mais de ${LIMITE_PASTAS} subpastas — grande demais para um modelo`);
      fronteira = novas.map((f: { id: string }) => f.id);
    }
    const ids = pastas.map((p) => p.id);

    const [statuses, campos, tarefas, visoes] = await Promise.all([
      emLotes(ids, (lote) => paginar(() => admin.from('task_statuses').select('id, list_id, name, color, category, sort_order').in('list_id', lote))),
      emLotes(ids, (lote) => paginar(() => admin.from('task_custom_fields')
          .select('id, list_id, name, field_type, options, show_on_card, sort_order').in('list_id', lote).eq('is_archived', false))),
      emLotes(ids, (lote) => paginar(() => admin.from('tasks')
          .select('id, list_id, parent_task_id, title, description, status_id, priority, assignee_id, start_date, due_date, due_has_time, recurrence, time_estimate_minutes, sort_order')
          .in('list_id', lote).eq('is_archived', false))),
      emLotes(ids, (lote) => paginar(() => admin.from('task_views')
          .select('list_id, name, view_type, group_by, filters, sort_order').in('list_id', lote).eq('created_by', userId))),
    ]);
    if (tarefas.length > LIMITE_TAREFAS) throw new Error(`A pasta tem mais de ${LIMITE_TAREFAS} tarefas — grande demais para um modelo`);

    const idsTarefas = tarefas.map((t: { id: string }) => t.id);
    const [checklist, links, valoresBrutos] = await Promise.all([
      emLotes(idsTarefas, (lote) => paginar(() => admin.from('task_checklist_items').select('task_id, title, is_done, sort_order').in('task_id', lote))),
      emLotes(idsTarefas, (lote) => paginar(() => admin.from('task_tag_links').select('task_id, task_tags(name, color)').in('task_id', lote))),
      emLotes(idsTarefas, (lote) => paginar(() => admin.from('task_field_values').select('task_id, field_id, value').in('task_id', lote))),
    ]);

    // Valor de campo global (sem pasta) vai junto; de campo de outra pasta, não.
    const idsCamposDaArvore = new Set(campos.map((f: { id: string }) => f.id));
    const outros = [...new Set(valoresBrutos.map((v: { field_id: string }) => v.field_id).filter((id: string) => !idsCamposDaArvore.has(id)))] as string[];
    const globais = new Set<string>();
    if (outros.length) {
      const defs = await emLotes(outros, (lote) => paginar(() => admin.from('task_custom_fields').select('id, list_id, is_archived').in('id', lote)));
      defs.filter((d: { list_id: string | null; is_archived: boolean }) => !d.list_id && !d.is_archived)
        .forEach((d: { id: string }) => globais.add(d.id));
    }

    return {
      raiz_id: listId,
      pastas,
      statuses,
      campos,
      tarefas,
      checklist,
      etiquetas: links
        .filter((l: { task_tags: unknown }) => l.task_tags)
        .map((l: { task_id: string; task_tags: { name: string; color: string } | Array<{ name: string; color: string }> }) => {
          const t = Array.isArray(l.task_tags) ? l.task_tags[0] : l.task_tags;
          return { task_id: l.task_id, name: t?.name ?? '', color: t?.color ?? '#64748b' };
        })
        .filter((e: { name: string }) => e.name),
      valores: valoresBrutos
        .filter((v: { field_id: string }) => idsCamposDaArvore.has(v.field_id) || globais.has(v.field_id))
        .map((v: { task_id: string; field_id: string; value: unknown }) => ({ ...v, global: globais.has(v.field_id) })),
      visoes,
      exibicao: exibicao && typeof exibicao === 'object' ? (exibicao as Record<string, ExibicaoModelo>) : {},
    };
  };

  const nomeValido = (n: unknown): string => {
    const s = typeof n === 'string' ? n.trim() : '';
    if (!s) throw new Error('Dê um nome ao modelo');
    return s.slice(0, 120);
  };
  const descricaoValida = (d: unknown): string | null => {
    const s = typeof d === 'string' ? d.trim() : '';
    return s ? s.slice(0, 2000) : null;
  };

  /** Guarda o estado atual como versão antiga e apaga as que passam do limite. */
  const guardarVersao = async (tpl: { id: string; name: string; content: unknown; options: unknown; source_list_id: string | null; version: number }) => {
    const { error } = await admin.from('task_structure_template_versions').insert({
      template_id: tpl.id, version: tpl.version, name: tpl.name, content: tpl.content,
      options: tpl.options, source_list_id: tpl.source_list_id, saved_by: userId,
    });
    falhou(error);
    const { data: antigas } = await admin.from('task_structure_template_versions')
      .select('id').eq('template_id', tpl.id).order('version', { ascending: false }).range(VERSOES_GUARDADAS, 1000);
    if (antigas?.length) {
      await admin.from('task_structure_template_versions').delete().in('id', antigas.map((a: { id: string }) => a.id));
    }
  };

  switch (action) {
    // Lê a pasta e devolve o modelo sem gravar (tela de "Salvar como modelo").
    case 'preview_structure_template': {
      const { list_id, exibicao } = body;
      if (typeof list_id !== 'string') return json({ error: 'list_id é obrigatório' }, 400);
      const content = montarModelo(await lerOrigem(list_id, exibicao));
      return json({ success: true, content, resumo: resumirModelo(content) });
    }

    // Novo modelo a partir de uma pasta — ou, com template_id, regrava um
    // modelo existente (o conteúdo anterior vira versão guardada).
    case 'save_structure_template': {
      const { template_id, list_id, exibicao } = body;
      if (typeof list_id !== 'string') return json({ error: 'list_id é obrigatório' }, 400);
      const content = montarModelo(await lerOrigem(list_id, exibicao));
      const options = normalizarOpcoes(body.options);
      if (template_id) {
        const tpl = await meuModelo(template_id);
        await guardarVersao(tpl);
        const patch: Record<string, unknown> = {
          content, options, source_list_id: list_id, version: tpl.version + 1, updated_at: new Date().toISOString(),
        };
        if (body.name !== undefined) patch.name = nomeValido(body.name);
        if (body.description !== undefined) patch.description = descricaoValida(body.description);
        const { error } = await admin.from('task_structure_templates').update(patch).eq('id', tpl.id);
        falhou(error);
        return json({ success: true, id: tpl.id });
      }
      const { data, error } = await admin.from('task_structure_templates').insert({
        tenant_id: c.tenantId, created_by: userId, name: nomeValido(body.name), description: descricaoValida(body.description),
        content, options, source_list_id: list_id,
      }).select('id').single();
      falhou(error);
      return json({ success: true, id: data.id });
    }

    // Renomear, descrição e o que entra (opções / itens desmarcados) — sem regravar.
    case 'update_structure_template': {
      const tpl = await meuModelo(body.template_id);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.name !== undefined) patch.name = nomeValido(body.name);
      if (body.description !== undefined) patch.description = descricaoValida(body.description);
      if (body.options !== undefined) patch.options = normalizarOpcoes(body.options);
      const { error } = await admin.from('task_structure_templates').update(patch).eq('id', tpl.id);
      falhou(error);
      return json({ success: true, id: tpl.id });
    }

    case 'duplicate_structure_template': {
      const tpl = await meuModelo(body.template_id);
      const nome = body.name !== undefined ? nomeValido(body.name) : `${tpl.name} (cópia)`.slice(0, 120);
      const { data, error } = await admin.from('task_structure_templates').insert({
        tenant_id: c.tenantId, created_by: userId, name: nome, description: tpl.description,
        content: tpl.content, options: tpl.options, source_list_id: tpl.source_list_id,
      }).select('id').single();
      falhou(error);
      return json({ success: true, id: data.id });
    }

    case 'delete_structure_template': {
      const tpl = await meuModelo(body.template_id);
      const { error } = await admin.from('task_structure_templates').delete().eq('id', tpl.id);
      falhou(error);
      return json({ success: true });
    }

    // Volta a uma versão guardada — o estado atual também é guardado, então dá pra desfazer.
    case 'restore_structure_template_version': {
      const tpl = await meuModelo(body.template_id);
      const { data: v, error: vErr } = await admin.from('task_structure_template_versions')
        .select('*').eq('id', body.version_id).eq('template_id', tpl.id).maybeSingle();
      falhou(vErr);
      if (!v) return json({ error: 'Versão não encontrada' }, 404);
      await guardarVersao(tpl);
      const { error } = await admin.from('task_structure_templates').update({
        content: v.content, options: v.options, source_list_id: v.source_list_id,
        version: tpl.version + 1, updated_at: new Date().toISOString(),
      }).eq('id', tpl.id);
      falhou(error);
      return json({ success: true, id: tpl.id });
    }

    case 'apply_structure_template': {
      const tpl = await meuModelo(body.template_id);
      const opcoes = normalizarOpcoes(body.options ?? tpl.options);
      const conteudo = filtrarModelo(tpl.content, opcoes);
      const resumo = resumirModelo(conteudo);
      if (resumo.pastas > LIMITE_PASTAS || resumo.tarefas + resumo.subtarefas > LIMITE_TAREFAS) {
        return json({ error: 'Modelo grande demais para aplicar de uma vez' }, 400);
      }
      const dataBase = typeof body.data_base === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.data_base)
        ? body.data_base : diaLocal(new Date().toISOString());

      // Destino: raiz (minha) ou dentro de uma pasta que eu possa editar. Dentro
      // de pasta compartilhada, as pastas novas ficam do dono dela (igual create_list).
      const parentId = typeof body.parent_list_id === 'string' && body.parent_list_id ? body.parent_list_id : null;
      let donoPastas = userId;
      if (parentId) {
        const nivel = await acesso(parentId);
        if (nivel !== 'owner' && nivel !== 'edit') return json({ error: 'Você não pode criar pastas dentro desta pasta' }, 403);
        const { data: pai } = await admin.from('task_lists').select('created_by, is_archived').eq('id', parentId).maybeSingle();
        if (!pai || pai.is_archived) return json({ error: 'Pasta de destino não encontrada' }, 404);
        donoPastas = pai.created_by ?? userId;
      }

      const { data: minhasTags } = await admin.from('task_tags').select('id, name').eq('created_by', userId);
      const etiquetasExistentes: Record<string, string> = {};
      for (const t of minhasTags ?? []) {
        const k = String(t.name).trim().toLowerCase();
        if (!etiquetasExistentes[k]) etiquetasExistentes[k] = t.id;
      }

      const refsGlobais = new Set<string>();
      const juntarGlobais = (t: TarefaModelo) => {
        t.valores.forEach((v) => { if (v.global) refsGlobais.add(v.campo_ref); });
        t.subtarefas.forEach(juntarGlobais);
      };
      const percorrer = (p: PastaModelo) => { p.tarefas.forEach(juntarGlobais); p.filhas.forEach(percorrer); };
      percorrer(conteudo.raiz);
      let camposGlobais: string[] = [];
      if (refsGlobais.size) {
        const { data } = await admin.from('task_custom_fields').select('id')
          .in('id', [...refsGlobais]).is('list_id', null).eq('is_archived', false);
        camposGlobais = (data ?? []).map((f: { id: string }) => f.id);
      }

      const plano = planejarAplicacao(conteudo, {
        tenant_id: c.tenantId, user_id: userId, parent_list_id: parentId,
        nome: typeof body.name === 'string' ? body.name : null, data_base: dataBase,
        etiquetas_existentes: etiquetasExistentes, campos_globais: camposGlobais,
        novo_id: () => crypto.randomUUID(), agora: Date.now(),
      });
      plano.pastas.forEach((p) => { p.created_by = donoPastas; });
      const idsPastas = plano.pastas.map((p) => p.id as string);
      const idsTags = plano.novas_etiquetas.map((t) => t.id as string);

      const inserir = async (tabela: string, linhas: Record<string, unknown>[], lote = 500) => {
        for (let i = 0; i < linhas.length; i += lote) {
          const { error } = await admin.from(tabela).insert(linhas.slice(i, i + lote));
          falhou(error);
        }
      };

      try {
        await inserir('task_tags', plano.novas_etiquetas);
        await inserir('task_lists', plano.pastas); // mãe antes das filhas (pré-ordem)
        // O gatilho cria 3 status padrão em toda pasta nova; quem tem status no modelo troca pelos dele.
        if (plano.pastas_com_status.length) {
          const { error } = await admin.from('task_statuses').delete().in('list_id', plano.pastas_com_status);
          falhou(error);
        }
        await inserir('task_statuses', plano.statuses);
        await inserir('task_custom_fields', plano.campos);
        const statuses = await emLotes(idsPastas, (lote) => paginar(() => admin.from('task_statuses').select('id, list_id, category, sort_order').in('list_id', lote)));
        await inserir('tasks', resolverStatus(plano.tarefas, statuses));
        await inserir('task_checklist_items', plano.checklist);
        await inserir('task_tag_links', plano.etiquetas);
        await inserir('task_field_values', plano.valores);
        await inserir('task_views', plano.visoes);
        await inserir('task_activity', plano.tarefas.map((t) => ({
          tenant_id: c.tenantId, task_id: t.id, user_id: userId,
          action: 'created_from_template', payload: { template: tpl.name },
        })));
      } catch (e) {
        // Desfaz: apagar as pastas leva junto (cascade) status, campos, tarefas e o resto.
        console.error('[task-write] apply_structure_template falhou, desfazendo:', errMsg(e));
        await admin.from('task_lists').delete().in('id', idsPastas);
        if (idsTags.length) await admin.from('task_tags').delete().in('id', idsTags);
        return json({ error: `Não foi possível aplicar o modelo: ${errMsg(e)}` }, 500);
      }

      // Um aviso por responsável (não um por tarefa).
      const porResponsavel = new Map<string, string[]>();
      for (const t of plano.tarefas) {
        const a = t.assignee_id as string | null;
        if (!a || a === userId) continue;
        porResponsavel.set(a, [...(porResponsavel.get(a) ?? []), t.id as string]);
      }
      for (const [pessoa, tarefas] of porResponsavel) {
        await c.notify([pessoa], tarefas[0], 'assigned', {
          title: tarefas.length === 1
            ? String(plano.tarefas.find((t) => t.id === tarefas[0])?.title ?? '')
            : `${tarefas.length} tarefas do modelo "${tpl.name}"`,
        });
      }

      return json({ success: true, id: plano.raiz_id, lists: plano.mapa_pastas, exibicao: plano.exibicao, resumo });
    }
  }
  return json({ error: `unknown action: ${action}` }, 400);
}
