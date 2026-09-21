-- "Nao me manda mensagem": opt-out explicito do CRM.
--
-- Por que nao usar `accepts_marketing`: ela nasce false no cadastro do delivery
-- e nunca e preenchida, entao TODO cliente pareceria ter recusado contato — o
-- funil bloquearia a loja inteira. Recusa e um ato: fica registrada aqui.
alter table public.customers
  add column if not exists crm_opt_out_at timestamptz;

comment on column public.customers.crm_opt_out_at is
  'Cliente pediu para NAO receber mensagens de CRM. Preenchido = nunca abordar. Usar esta coluna, e nao accepts_marketing (que nasce false por default e nao significa recusa).';
