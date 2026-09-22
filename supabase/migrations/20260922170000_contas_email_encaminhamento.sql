-- Caixa de boletos: encaminhamento em vez de OAuth do Google (2026-09-22)
--
-- Por que trocou: o caminho pela API do Gmail exige um app OAuth, e app em status "Testing"
-- tem o refresh_token EXPIRADO EM 7 DIAS pelo Google. Publicar para não expirar exige
-- verificação (escopo gmail.readonly é restrito) — desproporcional para uma loja, e só não
-- morde quem tem Google Workspace, que não é o caso. Falha silenciosa depois de uma semana
-- é exatamente o que este módulo existe para eliminar.
--
-- Desenho novo: o Gmail da loja continua sendo o endereço bonito que se dá aos fornecedores,
-- e encaminha automaticamente para um endereço de um serviço de recebimento, que entrega o
-- e-mail aqui por webhook. Não expira, é instantâneo (empurrado, não consultado) e dispensa
-- Google Cloud. As colunas de OAuth continuam na tabela sem uso — removê-las não traz ganho
-- e uma loja com Workspace poderia querer o outro caminho um dia.
alter table public.fin_mail_config
  drop constraint if exists fin_mail_config_provider_check;

alter table public.fin_mail_config
  add constraint fin_mail_config_provider_check check (provider in ('gmail', 'inbound'));

alter table public.fin_mail_config
  -- segredo do webhook: vai na URL que o serviço de recebimento chama. Sem ele, qualquer um
  -- que descobrisse o endereço poderia empurrar "boleto" para dentro do financeiro.
  add column if not exists inbound_token text,
  -- endereço que o serviço deu (para onde o Gmail encaminha) — só para mostrar na tela
  add column if not exists inbound_address text,
  add column if not exists last_received_at timestamptz;

alter table public.fin_mail_config alter column provider set default 'inbound';

create unique index if not exists fin_mail_config_inbound_token_uidx
  on public.fin_mail_config (inbound_token) where inbound_token is not null;

comment on column public.fin_mail_config.inbound_token is
  'Segredo do webhook de entrada (vai na URL). Trocar invalida a configuração no serviço de recebimento.';
comment on column public.fin_mail_config.inbound_address is
  'Endereço do serviço de recebimento para onde o Gmail da loja encaminha.';
