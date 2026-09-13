-- App iFood distribuído (código de vínculo + refresh_token) ou centralizado
-- (client_credentials, sem código — os apps de TESTE já têm permissão na loja de teste).
alter table public.fin_ifood_config add column if not exists app_type text not null default 'distributed';
alter table public.fin_ifood_config drop constraint if exists fin_ifood_config_app_type_chk;
alter table public.fin_ifood_config add constraint fin_ifood_config_app_type_chk check (app_type in ('distributed', 'centralized'));
