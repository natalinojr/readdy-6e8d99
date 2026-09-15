-- Contratação em tempo real (2026-09-15, pedido do dono): o robô/IA muda etapa, nota, entrevista e
-- agendamento sozinho, e a tela só via depois de recarregar. Tabela fora da publicação supabase_realtime
-- não dá erro no postgres_changes: fica muda (ver project_orders_ping). RLS continua valendo para quem
-- assina (is_hiring_admin). hiring_distances fica de fora (muitas linhas, muda junto com o candidato).
do $$
declare t text;
begin
  foreach t in array array['hiring_candidates', 'hiring_applications', 'hiring_interviews',
                           'hiring_scheduling_sessions', 'hiring_candidate_events'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
