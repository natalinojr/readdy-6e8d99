-- iFood: segunda rodada diária da busca (07h50 BRT). A das 07h20 pede o relatório sob demanda
-- quando o iFood não tem o arquivo mensal; esta importa o que ficou pronto.
select cron.unschedule(jobid) from cron.job where jobname = 'ifood-sync-2';
select cron.schedule('ifood-sync-2', '50 10 * * *', $$select public.fn_ifood_sync_all();$$);
