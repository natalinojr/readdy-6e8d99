-- Jogos só para membros do clube de fidelidade (regra do dono, 2026-09-27): quem joga é
-- identificado pelo cartão do clube, e o ranking passa a contar por cliente.
alter table public.game_sessions add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.game_scores add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists game_scores_customer_idx on public.game_scores (tenant_id, week_start, game, customer_id);
