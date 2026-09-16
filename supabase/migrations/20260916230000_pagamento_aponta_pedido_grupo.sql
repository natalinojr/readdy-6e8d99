-- ═══════════════════════════════════════════════════════════════════════════
-- Uma solicitação de pagamento no grupo pode gerar VÁRIOS pagamentos (2026-09-16)
-- Aplicado via mcp__supabase__apply_migration; este arquivo é o registro.
--
-- Caso real: no grupo "Financeiro loja - EP MALL" uma mensagem pediu dois Pix (Marcelle e Joziane).
-- O assistente preparou os dois, mas asst_group_requests só tinha UM payment_id: o segundo não foi
-- ligado ao pedido e o comprovante dele nunca foi para o grupo.
--
-- Agora o PAGAMENTO aponta para o pedido de onde veio, e o "comprovante enviado" é por pagamento.
-- asst_group_requests.payment_id e receipt_sent_at ficam como estavam (1º pagamento), por compatibilidade.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.fin_inter_payments
  add column if not exists group_request_id bigint references public.asst_group_requests(id) on delete set null,
  add column if not exists group_receipt_sent_at timestamptz,
  add column if not exists group_receipt_error text;

create index if not exists idx_fin_inter_payments_group_request
  on public.fin_inter_payments(group_request_id) where group_request_id is not null;

-- Pagamentos já ligados pelo formato antigo (inclusive o comprovante que já saiu).
update public.fin_inter_payments p
set group_request_id = r.id,
    group_receipt_sent_at = coalesce(p.group_receipt_sent_at, r.receipt_sent_at),
    group_receipt_error = coalesce(p.group_receipt_error, r.receipt_error)
from public.asst_group_requests r
where r.payment_id = p.id and p.group_request_id is null;
