-- Leitor universal do assistente pessoal (projeto pessoal do dono; ver assistente/README.md).
-- Papel só-leitura que enxerga TODO o schema public, menos credenciais. O assistente-brain
-- conecta direto (SUPABASE_DB_URL) e roda cada consulta em:
--   BEGIN READ ONLY; SET LOCAL ROLE asst_reader; SET LOCAL statement_timeout = '10s'; ...; COMMIT
-- Aplicada via MCP (migração assistente_leitor_universal) em 2026-09-12; cópia versionada.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'asst_reader') then
    create role asst_reader nologin bypassrls;
  end if;
end $$;
grant asst_reader to postgres with set true;
grant usage on schema public to asst_reader;

-- (Re)concede SELECT coluna a coluna, sem colunas com cara de segredo e sem as tabelas
-- de credenciais. Idempotente; o assistente-cron roda 1×/dia às 04:00 (tabelas novas
-- entram sozinhas). Ao criar tabela com segredo cujo nome de coluna não case com v_pat,
-- inclua a tabela em v_block.
create or replace function public.fn_asst_reader_refresh()
returns int language plpgsql security definer set search_path to 'public'
as $$
declare
  r record; c record; cols text; n int := 0;
  v_block text[] := array['fin_inter_config','fin_payment_provider_config','kiosk_tokens','meta_ad_connections',
                          'push_subscriptions','trafego_pago_shares','platform_owners','asst_settings'];
  v_pat text := '(secret|token|password|passwd|senha|pin_hash|_hash$|cert_pem|key_pem|private|api_key|apikey|credential|access_key|refresh|cookie|p256dh|^auth$|client_id)';
begin
  for r in
    select cl.relname from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname = 'public' and cl.relkind in ('r','v','m','p')
  loop
    if r.relname = any(v_block) then
      execute format('revoke all on public.%I from asst_reader', r.relname);
      for c in select a.attname from pg_attribute a join pg_class cl on cl.oid = a.attrelid join pg_namespace ns on ns.oid = cl.relnamespace
               where ns.nspname = 'public' and cl.relname = r.relname and a.attnum > 0 and not a.attisdropped loop
        execute format('revoke select (%I) on public.%I from asst_reader', c.attname, r.relname);
      end loop;
      continue;
    end if;
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
    from pg_attribute a join pg_class cl on cl.oid = a.attrelid join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname = 'public' and cl.relname = r.relname and a.attnum > 0 and not a.attisdropped and a.attname !~* v_pat;
    if cols is not null then
      execute format('grant select (%s) on public.%I to asst_reader', cols, r.relname);
      n := n + 1;
    end if;
    for c in select a.attname from pg_attribute a join pg_class cl on cl.oid = a.attrelid join pg_namespace ns on ns.oid = cl.relnamespace
             where ns.nspname = 'public' and cl.relname = r.relname and a.attnum > 0 and not a.attisdropped and a.attname ~* v_pat loop
      execute format('revoke select (%I) on public.%I from asst_reader', c.attname, r.relname);
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.fn_asst_reader_refresh() from public, anon, authenticated;
grant execute on function public.fn_asst_reader_refresh() to service_role;

select public.fn_asst_reader_refresh();
