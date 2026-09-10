-- Conciliação sem rotina automática: o extrato do Inter e o arquivo da Stone são
-- buscados quando o usuário abre Financeiro › Conciliação ou clica em atualizar.
-- (decisão do usuário em 2026-09-10 — não precisa consultar o banco de hora em hora)

select cron.unschedule(jobid) from cron.job where jobname in ('inter-bank-sync', 'stone-sync');
drop function if exists public.fn_inter_bank_sync_all();
drop function if exists public.fn_stone_sync_all();
