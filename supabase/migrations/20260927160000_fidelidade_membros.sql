-- Lista de membros do clube para a aba Fidelidade (quem tem saldo, entrou no
-- clube ou já comprou identificado). Nível pelo mesmo cálculo do tablet.
create or replace function public.fn_fidelidade_membros(p_tenant uuid, p_limite int default 300)
returns table (
  customer_id uuid, nome text, celular text, membro_desde timestamptz,
  saldo numeric, compras integer, nivel text, nivel_emoji text, nivel_cor text,
  giros integer, beneficios integer, ultima_compra timestamptz
)
language plpgsql stable as $$
declare
  cfg jsonb; niveis jsonb; janela int; trilha_on boolean;
begin
  select config into cfg from public.loyalty_programs where tenant_id = p_tenant;
  cfg := coalesce(cfg, '{}'::jsonb);
  niveis := public.fn_fidelidade_niveis(cfg);
  janela := coalesce((cfg->'trilha'->>'janela_dias')::int, 0);
  trilha_on := coalesce((cfg->'trilha'->>'ativo')::boolean, true);
  return query
  with base as (
    select c.id, c.name, c.phone, c.loyalty_joined_at, c.loyalty_points, c.last_visit_at,
           (select count(*)::int from public.orders o
             where o.customer_id = c.id and o.status <> 'cancelled' and coalesce(o.is_training, false) = false
               and (janela = 0 or o.created_at > now() - make_interval(days => janela))) as n
      from public.customers c
     where c.tenant_id = p_tenant and c.deleted_at is null
       and (c.loyalty_joined_at is not null or coalesce(c.loyalty_points, 0) > 0)
  )
  select b.id, b.name, b.phone, b.loyalty_joined_at,
         coalesce(b.loyalty_points, 0), b.n,
         case when trilha_on then niveis->public.fn_fidelidade_rank(niveis, b.n)->>'nome' end,
         case when trilha_on then niveis->public.fn_fidelidade_rank(niveis, b.n)->>'emoji' end,
         case when trilha_on then niveis->public.fn_fidelidade_rank(niveis, b.n)->>'cor' end,
         (select count(*)::int from public.loyalty_spins s where s.customer_id = b.id and s.used_at is null and (s.expires_at is null or s.expires_at > now())),
         (select count(*)::int from public.loyalty_benefits x where x.customer_id = b.id and x.used_at is null and (x.expires_at is null or x.expires_at > now())),
         b.last_visit_at
    from base b
   order by coalesce(b.loyalty_points, 0) desc, b.n desc
   limit greatest(1, least(p_limite, 1000));
end $$;

revoke all on function public.fn_fidelidade_membros(uuid, integer) from public, anon, authenticated;
grant execute on function public.fn_fidelidade_membros(uuid, integer) to service_role;
