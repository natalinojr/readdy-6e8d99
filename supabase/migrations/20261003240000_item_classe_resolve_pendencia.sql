-- Pendência "N itens sem classificação (CMV × despesa)" some na hora em que a loja zera os itens
-- (2026-10-03). Antes só o item_classify do chat recontava (assistente-app › syncPendenciaContagem);
-- classificar pela tela (Financeiro › Classificação), pelo vínculo com insumo ou qualquer outro
-- caminho deixava o aviso "1 item" no Hoje/📥 até a próxima volta do cron (até 30 min).
-- Só RESOLVE (zerou). Abrir/recontar para cima continua com o cron (syncPendenciasClassificacao).

create or replace function public.fn_trg_item_classe_resolve_pendencia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
begin
  for t in select distinct tenant_id from linhas loop
    if exists (select 1 from pendencias p
                where p.tenant_id = t and p.kind = 'item_sem_classe' and p.ref = 'pendentes'
                  and p.status in ('aberta', 'vista'))
       and not exists (select 1 from fin_item_classifications c where c.tenant_id = t and c.classe is null) then
      perform fn_pendencia_resolver_ref(t, 'item_sem_classe', 'pendentes', 'tudo classificado');
    end if;
  end loop;
  return null;
end $$;

revoke all on function public.fn_trg_item_classe_resolve_pendencia() from public, anon, authenticated;

drop trigger if exists trg_item_classe_resolve_pendencia_upd on public.fin_item_classifications;
create trigger trg_item_classe_resolve_pendencia_upd
  after update on public.fin_item_classifications
  referencing new table as linhas
  for each statement execute function public.fn_trg_item_classe_resolve_pendencia();

drop trigger if exists trg_item_classe_resolve_pendencia_del on public.fin_item_classifications;
create trigger trg_item_classe_resolve_pendencia_del
  after delete on public.fin_item_classifications
  referencing old table as linhas
  for each statement execute function public.fn_trg_item_classe_resolve_pendencia();
