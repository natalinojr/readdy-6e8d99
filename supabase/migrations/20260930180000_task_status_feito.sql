-- Status "Feito": conta como concluído (category = 'done': completed_at, recorrência,
-- carga, avisos), mas a tarefa CONTINUA na tela — não vai para o grupo recolhido nem
-- some com "ocultar concluídas". Só some quando passa para um "Concluído" de verdade.
alter table public.task_statuses add column if not exists keep_visible boolean not null default false;

-- keep_visible só faz sentido em status da categoria done.
update public.task_statuses set keep_visible = false where category <> 'done' and keep_visible;

-- Leitura: statuses da pasta trazem keep_visible; tarefas trazem status_keep_visible.
-- (Edita a definição atual por replace para não sobrescrever mudanças de outras sessões.)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.fn_get_task_lists(uuid)'::regprocedure);
  if position('''keep_visible''' in d) = 0 then
    d := replace(d, '''category'', s.category, ''sort_order'', s.sort_order',
                    '''category'', s.category, ''sort_order'', s.sort_order, ''keep_visible'', s.keep_visible');
    execute d;
  end if;

  d := pg_get_functiondef('public.fn_get_tasks(uuid, uuid[], uuid, boolean, boolean)'::regprocedure);
  if position('''status_keep_visible''' in d) = 0 then
    d := replace(d, '''status_category'', st.category,',
                    '''status_category'', st.category,' || chr(10) || '      ''status_keep_visible'', coalesce(st.keep_visible, false),');
    d := replace(d, 'st.category not in (''done'',''cancelled''))',
                    'st.category not in (''done'',''cancelled'') or st.keep_visible)');
    execute d;
  end if;
end $$;
