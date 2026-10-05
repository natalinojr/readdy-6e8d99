-- Recursos novos que cada loja liga ou desliga (TV de senhas, aviso no WhatsApp, telas novas…).
-- jsonb { "chave": true }; vazio = tudo desligado. Grava pelo config-write (upsert_system_settings).
alter table public.system_settings add column if not exists recursos jsonb not null default '{}'::jsonb;

-- Liga/desliga UM recurso sem apagar os outros (duas abas ao mesmo tempo não se atropelam).
-- Só o service_role chama (config-write confere Administrador/Supervisor antes).
create or replace function public.fn_set_recurso_loja(p_tenant_id uuid, p_chave text, p_ligado boolean)
returns jsonb
language sql
security definer
set search_path = public
as $$
  update public.system_settings
     set recursos = case when p_ligado then coalesce(recursos, '{}'::jsonb) || jsonb_build_object(p_chave, true)
                         else coalesce(recursos, '{}'::jsonb) - p_chave end,
         updated_at = now()
   where tenant_id = p_tenant_id
  returning recursos;
$$;
revoke all on function public.fn_set_recurso_loja(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fn_set_recurso_loja(uuid, text, boolean) to service_role;
