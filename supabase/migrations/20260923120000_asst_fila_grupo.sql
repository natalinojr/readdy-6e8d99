-- Fila dos documentos de grupo (2026-09-23, custo do assistente): cupons/pedidos postados juntos
-- eram mandados ao assistente-brain em paralelo (12 em 2 minutos em 20/09) — cada um relia o prompt
-- sem ver o que o outro fazia, repetia buscas e alguns terminavam em "Não entendi". Agora o
-- assistente-webhook põe o pedido em status 'fila' e UM trabalhador processa por vez.
-- Esta função é a trava: devolve o próximo pedido da fila (e o marca 'processando') só se nenhum
-- outro estiver em processamento há menos de 5 minutos.
create or replace function public.fn_asst_fila_proximo()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('asst_fila_grupo'));
  if exists (
    select 1 from asst_group_requests
    where status = 'processando' and updated_at > now() - interval '5 minutes'
  ) then
    return null;
  end if;
  select id into v_id from asst_group_requests where status = 'fila' order by created_at, id limit 1;
  if v_id is null then
    return null;
  end if;
  update asst_group_requests set status = 'processando', updated_at = now() where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.fn_asst_fila_proximo() from public, anon, authenticated;
grant execute on function public.fn_asst_fila_proximo() to service_role;
