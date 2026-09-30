-- Notas de entrada: data a partir da qual a loja quer receber as notas (2026-09-30).
-- Nota emitida antes dela não entra na busca; as que já estavam "A conferir" são ignoradas
-- com motivo próprio (voltam se a data for recuada).
alter table public.fiscal_settings add column if not exists inbound_start_date date;
comment on column public.fiscal_settings.inbound_start_date is 'Notas de entrada: só recebe notas emitidas a partir desta data (null = sem limite)';
