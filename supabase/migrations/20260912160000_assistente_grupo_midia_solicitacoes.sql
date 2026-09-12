-- Assistente pessoal — mídia de grupo LIDA e triagem de solicitação de pagamento
-- (2026-09-12). Antes, foto/PDF/arquivo de grupo viravam só "[Foto]" em
-- asst_group_messages: o assistente sabia que existia uma imagem mas não o que
-- havia nela (boleto, comprovante, print). Agora o webhook baixa a mídia, manda
-- ao assistente-brain (ler_midia) e guarda o conteúdo; quando a mensagem é um
-- PEDIDO DE PAGAMENTO, a triagem prepara o pagamento no Inter (rascunho com
-- botões Pagar/Cancelar, PIN e aprovação no app continuam valendo) e avisa o dono.
--
-- Aplicar no Supabase (projeto ERP OS, ref mdghhjemzdmeuqpzuyzx) via MCP/SQL editor.

alter table public.asst_group_messages add column if not exists media_mime text;
alter table public.asst_group_messages add column if not exists extracted jsonb;

comment on column public.asst_group_messages.extracted is
  'Leitura da mídia pelo Claude: { resumo, texto, pagamento: { e_solicitacao, tipo, linha_digitavel, chave_pix, valor, vencimento, beneficiario, documento } }';

-- Uma linha por mensagem de grupo que a triagem tratou como pedido de pagamento.
-- message_id é único: o mesmo pedido nunca é preparado duas vezes (reenvio do
-- webhook, reprocessamento).
create table if not exists public.asst_group_requests (
  id bigserial primary key,
  message_id text unique,
  group_jid text not null references public.asst_groups(group_jid) on delete cascade,
  group_name text,
  sender_name text,
  kind text not null default 'pagamento',
  -- novo (em triagem) | preparado | incompleto | ignorado | erro
  status text not null default 'novo',
  data jsonb,
  payment_id uuid references public.fin_inter_payments(id) on delete set null,
  reply text,
  error text,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists asst_group_requests_group_idx on public.asst_group_requests (group_jid, created_at desc);
create index if not exists asst_group_requests_created_idx on public.asst_group_requests (created_at desc);
create index if not exists asst_group_requests_status_idx on public.asst_group_requests (status);

alter table public.asst_group_requests enable row level security;
revoke all on public.asst_group_requests from anon, authenticated;
grant all on public.asst_group_requests to service_role;
grant usage, select on all sequences in schema public to service_role;

-- O assistente (papel asst_reader) enxerga a tabela nova já, sem esperar o refresh das 04:00
do $$ begin
  perform public.fn_asst_reader_refresh();
exception when others then null;
end $$;
