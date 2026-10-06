-- Chave Pix do funcionário + "Pagar Pix" da folha (dono, 2026-10-05). Mesmo modelo do prestador MEI
-- (20260928230000): a chave em si mora nos Pix permitidos (fin_pix_favorecidos — a lista branca do Inter,
-- editada só na tela do Assistente com o PIN do dono); o funcionário só APONTA para uma chave de lá.
-- Ligar/trocar a chave: só admin/gerente da loja, só por fn_funcionario_pix. O financial-write
-- (upsert_employee, escrita genérica que até a contabilidade usa) não consegue mudar a coluna: o gatilho recusa.

alter table public.hr_employees
  add column if not exists pix_favorecido_id uuid references public.fin_pix_favorecidos(id) on delete set null;

create or replace function public.trg_funcionario_pix_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.pix_favorecido_id is not null
     and (tg_op = 'INSERT' or new.pix_favorecido_id is distinct from old.pix_favorecido_id)
     and coalesce(current_setting('erpos.funcionario_pix', true), '') <> '1' then
    raise exception 'A chave Pix do funcionário só muda pela tela do RH (administrador ou gerente).';
  end if;
  return new;
end $$;

drop trigger if exists trg_funcionario_pix_guard on public.hr_employees;
create trigger trg_funcionario_pix_guard before insert or update of pix_favorecido_id on public.hr_employees
  for each row execute function public.trg_funcionario_pix_guard();

create or replace function public.fn_funcionario_pix(p_tenant uuid, p_employee uuid, p_pix_favorecido_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public._fn_prestador_pode(p_tenant) then raise exception 'sem acesso a esta loja'; end if;
  if p_pix_favorecido_id is not null and not exists (
    select 1 from fin_pix_favorecidos where id = p_pix_favorecido_id and tenant_id = p_tenant and is_active) then
    raise exception 'chave Pix não está entre os Pix permitidos desta loja';
  end if;
  perform set_config('erpos.funcionario_pix', '1', true);
  update hr_employees set pix_favorecido_id = p_pix_favorecido_id, updated_at = now()
   where id = p_employee and tenant_id = p_tenant;
  if not found then raise exception 'funcionário não encontrado nesta loja'; end if;
  perform set_config('erpos.funcionario_pix', '', true);
end $$;

revoke all on function public.fn_funcionario_pix(uuid, uuid, uuid) from public, anon;
grant execute on function public.fn_funcionario_pix(uuid, uuid, uuid) to authenticated;
