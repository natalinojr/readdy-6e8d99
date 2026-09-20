-- "Meu financeiro começa em MM/AAAA" (2026-09-19, pedido do dono: o usuário de qualquer loja tem que
-- conseguir fazer isso sozinho pela tela). Loja que entra no sistema com meses de histórico bagunçado
-- fecha o período anterior de uma vez: o que está PENDENTE vira ignorado/encerrado, e o que já está
-- feito (baixa, nota lançada, classificação de item, vínculo com insumo) NÃO é tocado.
-- Reversível: tudo que é fechado leva a marca no motivo/observação.

alter table public.fin_revenue_settings
  add column if not exists financeiro_inicio date,
  add column if not exists financeiro_inicio_em timestamptz,
  add column if not exists financeiro_inicio_por uuid;
do $$ begin
  alter table public.fin_revenue_settings add constraint fin_revenue_settings_inicio_check
    check (financeiro_inicio is null or extract(day from financeiro_inicio) = 1);
exception when duplicate_object then null; end $$;

create or replace function public.fn_marca_corte(p_inicio date)
returns text language sql immutable as $$
  select '[Fechado: financeiro começa em ' || to_char(p_inicio, 'MM/YYYY') || ']'
$$;

-- O que seria fechado (a tela mostra antes de confirmar)
create or replace function public.fn_periodo_anterior_preview(p_tenant uuid, p_inicio date)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'inicio', to_char(p_inicio, 'YYYY-MM-DD'),
    'extrato', (select jsonb_build_object('n', count(*),
        'saidas', coalesce(sum(amount) filter (where transaction_type = 'debit'), 0),
        'entradas', coalesce(sum(amount) filter (where transaction_type = 'credit'), 0))
       from fin_bank_statement_imports
      where tenant_id = p_tenant and status = 'pending' and not coalesce(reconciled, false) and transaction_date < p_inicio),
    'contas', (select jsonb_build_object('n', count(*), 'total', coalesce(sum(amount - coalesce(paid_amount, 0)), 0))
       from fin_accounts_payable
      where tenant_id = p_tenant and status in ('pending', 'overdue', 'partial') and due_date < p_inicio),
    'notas', (select jsonb_build_object('n', count(*), 'total', coalesce(sum(valor_total), 0))
       from fiscal_inbound_documents
      where tenant_id = p_tenant and status = 'new' and emitted_at::date < p_inicio)
  )
$$;

-- Fecha o período anterior. Só mexe no que está PENDENTE.
create or replace function public.fn_fechar_periodo_anterior(p_tenant uuid, p_inicio date, p_user uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_marca text := fn_marca_corte(p_inicio);
  v_ext int; v_contas int; v_notas int;
begin
  if p_inicio is null or extract(day from p_inicio) <> 1 then raise exception 'A data de início tem que ser o dia 1 do mês'; end if;

  update fin_bank_statement_imports
     set status = 'ignored', notes = trim(both ' · ' from coalesce(notes || ' · ', '') || v_marca)
   where tenant_id = p_tenant and status = 'pending' and not coalesce(reconciled, false) and transaction_date < p_inicio;
  get diagnostics v_ext = row_count;

  update fin_accounts_payable
     set status = 'cancelled', notes = trim(both ' · ' from coalesce(notes || ' · ', '') || v_marca), updated_at = now()
   where tenant_id = p_tenant and status in ('pending', 'overdue', 'partial') and due_date < p_inicio;
  get diagnostics v_contas = row_count;

  update fiscal_inbound_documents
     set status = 'ignored', ignore_reason = v_marca
   where tenant_id = p_tenant and status = 'new' and emitted_at::date < p_inicio;
  get diagnostics v_notas = row_count;

  insert into fin_revenue_settings (tenant_id, sources, financeiro_inicio, financeiro_inicio_em, financeiro_inicio_por)
  values (p_tenant, array['orders', 'manual'], p_inicio, now(), p_user)
  on conflict (tenant_id) do update set financeiro_inicio = excluded.financeiro_inicio,
    financeiro_inicio_em = excluded.financeiro_inicio_em, financeiro_inicio_por = excluded.financeiro_inicio_por;

  return jsonb_build_object('inicio', to_char(p_inicio, 'YYYY-MM-DD'), 'extrato', v_ext, 'contas', v_contas, 'notas', v_notas);
end $$;

-- Reabre: desfaz só o que foi fechado por este corte (pela marca).
create or replace function public.fn_reabrir_periodo_anterior(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_inicio date;
  v_marca text;
  v_ext int; v_contas int; v_notas int;
begin
  select financeiro_inicio into v_inicio from fin_revenue_settings where tenant_id = p_tenant;
  if v_inicio is null then raise exception 'Esta loja não tem período fechado'; end if;
  v_marca := fn_marca_corte(v_inicio);

  update fin_bank_statement_imports
     set status = 'pending', notes = nullif(trim(both ' · ' from replace(coalesce(notes, ''), v_marca, '')), '')
   where tenant_id = p_tenant and status = 'ignored' and not coalesce(reconciled, false) and position(v_marca in coalesce(notes, '')) > 0;
  get diagnostics v_ext = row_count;

  update fin_accounts_payable
     set status = case when due_date < current_date then 'overdue' else 'pending' end,
         notes = nullif(trim(both ' · ' from replace(coalesce(notes, ''), v_marca, '')), ''), updated_at = now()
   where tenant_id = p_tenant and status = 'cancelled' and position(v_marca in coalesce(notes, '')) > 0;
  get diagnostics v_contas = row_count;

  update fiscal_inbound_documents set status = 'new', ignore_reason = null
   where tenant_id = p_tenant and status = 'ignored' and ignore_reason = v_marca;
  get diagnostics v_notas = row_count;

  update fin_revenue_settings set financeiro_inicio = null, financeiro_inicio_em = null, financeiro_inicio_por = null
   where tenant_id = p_tenant;

  return jsonb_build_object('reaberto', to_char(v_inicio, 'YYYY-MM-DD'), 'extrato', v_ext, 'contas', v_contas, 'notas', v_notas);
end $$;

grant execute on function public.fn_periodo_anterior_preview(uuid, date) to service_role;
grant execute on function public.fn_fechar_periodo_anterior(uuid, date, uuid) to service_role;
grant execute on function public.fn_reabrir_periodo_anterior(uuid) to service_role;
revoke execute on function public.fn_fechar_periodo_anterior(uuid, date, uuid) from public, anon, authenticated;
revoke execute on function public.fn_reabrir_periodo_anterior(uuid) from public, anon, authenticated;
