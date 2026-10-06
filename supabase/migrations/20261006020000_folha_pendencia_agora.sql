-- Folha a pagar em "Agora" (dono, 2026-10-05): assim que a folha entra no sistema (Domínio ou RH), a tela
-- Hoje mostra um cartão por loja e competência — quantas pessoas, quanto falta e quando vence (5º dia útil).
-- Atualiza a cada pagamento e fecha sozinho quando todas as contas da folha estão pagas. Mantido pelos
-- mesmos gatilhos que sincronizam folha × conta (20261006010000), sem esperar o cron.
-- A conta da folha sai de "Vence hoje" / "Contas atrasadas" (assistente-cron) para não aparecer duas vezes.

create or replace function public.fn_folha_pendencia_sync(p_tenant uuid, p_comp date)
returns void language plpgsql security definer set search_path to 'public' as $$
declare n int; v_total numeric; v_venc date; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_ref text := to_char(p_comp, 'YYYY-MM'); v_mes text := to_char(p_comp, 'MM/YYYY');
begin
  if p_tenant is null or p_comp is null then return; end if;
  select count(*), coalesce(sum(amount - coalesce(paid_amount, 0)), 0), min(due_date)
    into n, v_total, v_venc
    from fin_accounts_payable
   where tenant_id = p_tenant and reference_type = 'hr_payroll' and reference_id is not null
     and competence_month = p_comp and status not in ('paid', 'cancelled');
  if n > 0 then
    perform public.fn_pendencia_upsert(
      p_tenant, 'folha_a_pagar', v_ref,
      'Folha ' || v_mes || ' — ' || n || case when n = 1 then ' pessoa a pagar' else ' pessoas a pagar' end
        || ' — R$ ' || replace(replace(replace(to_char(v_total, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.'),
      case when v_venc < v_hoje then 'Venceu ' || to_char(v_venc, 'DD/MM') || ' (5º dia útil). '
           else 'Vence ' || to_char(v_venc, 'DD/MM') || ' (5º dia útil). ' end
        || 'Pague o Pix de cada um no banco: a Conciliação dá baixa sozinha. Se já pagou, dê baixa aqui.',
      jsonb_build_object('valor', round(v_total, 2), 'total', n, 'competencia', v_ref,
                         'vencimento', to_char(v_venc, 'DD/MM'), 'vencida', v_venc < v_hoje),
      '/financeiro?tab=rh',
      case when v_venc <= v_hoje + 1 then 'alta' else 'normal' end,
      true, 'folha', true);
  else
    perform public.fn_pendencia_resolver_ref(p_tenant, 'folha_a_pagar', v_ref, 'folha paga');
  end if;
end $$;

revoke all on function public.fn_folha_pendencia_sync(uuid, date) from public, anon, authenticated;

-- hr_payroll → conta (+ cartão). Igual à 20261006010000, chamando o cartão no fim.
create or replace function public.trg_folha_conta_sync()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare b fin_accounts_payable; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_venc date;
        r hr_payroll := case when tg_op = 'DELETE' then old else new end;
begin
  if pg_trigger_depth() > 1 then return null; end if;  -- veio do gatilho da conta
  if tg_op = 'DELETE' then
    delete from fin_accounts_payable where reference_type = 'hr_payroll' and reference_id = old.id
       and tenant_id = old.tenant_id and status in ('pending', 'overdue');
  else
    select * into b from fin_accounts_payable
     where reference_type = 'hr_payroll' and reference_id = new.id and tenant_id = new.tenant_id limit 1;

    if b.id is null then
      if new.status = 'pending' and public.fn_folha_tem_conta(new) then perform public.fn_folha_conta_criar(new); end if;
    elsif new.status = 'paid' then
      if b.status <> 'paid' then
        update fin_accounts_payable set status = 'paid', paid_amount = amount, paid_date = coalesce(new.paid_date, v_hoje),
               payment_method = coalesce(nullif(new.payment_method, ''), payment_method), updated_at = now()
         where id = b.id;
      end if;
    elsif new.status = 'pending' then
      if not public.fn_folha_tem_conta(new) then
        delete from fin_accounts_payable where id = b.id and status in ('pending', 'overdue');
      else
        v_venc := public.fn_folha_vencimento(new.reference_month);
        update fin_accounts_payable set
               amount = round(new.net_salary, 2),
               due_date = v_venc,
               competence_month = to_date(left(new.reference_month, 7) || '-01', 'YYYY-MM-DD'),
               supplier = coalesce(new.employee_name, supplier),
               status = case when b.status = 'partial' then 'partial' when v_venc < v_hoje then 'overdue' else 'pending' end,
               paid_amount = case when b.status = 'partial' then paid_amount end,
               paid_date = case when b.status = 'partial' then paid_date end,
               updated_at = now()
         where id = b.id;
      end if;
    elsif new.status = 'cancelled' then
      delete from fin_accounts_payable where id = b.id and status in ('pending', 'overdue');
    end if;
  end if;

  if coalesce(r.reference_month, '') ~ '^\d{4}-\d{2}' then
    perform public.fn_folha_pendencia_sync(r.tenant_id, to_date(left(r.reference_month, 7) || '-01', 'YYYY-MM-DD'));
  end if;
  if tg_op = 'UPDATE' and old.reference_month is distinct from new.reference_month
     and coalesce(old.reference_month, '') ~ '^\d{4}-\d{2}' then
    perform public.fn_folha_pendencia_sync(old.tenant_id, to_date(left(old.reference_month, 7) || '-01', 'YYYY-MM-DD'));
  end if;
  return null;
end $$;

-- conta → hr_payroll (+ cartão): qualquer mudança de status da conta da folha (paga, estornada, virou vencida)
create or replace function public.trg_conta_folha_sync()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;  -- veio do gatilho da folha (que já atualiza o cartão)
  if tg_op = 'UPDATE' then
    if new.status = 'paid' and old.status is distinct from 'paid' then
      update hr_payroll set status = 'paid', paid_date = coalesce(new.paid_date, (now() at time zone 'America/Sao_Paulo')::date),
             payment_method = coalesce(nullif(new.payment_method, ''), payment_method, 'PIX'), updated_at = now()
       where id = new.reference_id and tenant_id = new.tenant_id and status = 'pending';
    elsif old.status = 'paid' and new.status in ('pending', 'overdue', 'partial') then
      update hr_payroll set status = 'pending', paid_date = null, payment_method = null, updated_at = now()
       where id = new.reference_id and tenant_id = new.tenant_id and status = 'paid';
      delete from fin_cash_flow where tenant_id = new.tenant_id and origin = 'auto_payroll' and reference_id = new.reference_id;
    end if;
    perform public.fn_folha_pendencia_sync(new.tenant_id, new.competence_month);
  else
    perform public.fn_folha_pendencia_sync(old.tenant_id, old.competence_month);
  end if;
  return null;
end $$;

drop trigger if exists trg_conta_folha_sync on public.fin_accounts_payable;
create trigger trg_conta_folha_sync after update of status on public.fin_accounts_payable
  for each row when (new.reference_type = 'hr_payroll' and new.reference_id is not null)
  execute function public.trg_conta_folha_sync();
drop trigger if exists trg_conta_folha_sync_del on public.fin_accounts_payable;
create trigger trg_conta_folha_sync_del after delete on public.fin_accounts_payable
  for each row when (old.reference_type = 'hr_payroll' and old.reference_id is not null)
  execute function public.trg_conta_folha_sync();

-- Cartão para o que já existe (folha 09/2026 da Paranaguá)
do $$
declare x record;
begin
  for x in select distinct tenant_id, competence_month from fin_accounts_payable
            where reference_type = 'hr_payroll' and reference_id is not null and competence_month is not null
              and status not in ('paid', 'cancelled')
  loop
    perform public.fn_folha_pendencia_sync(x.tenant_id, x.competence_month);
  end loop;
end $$;
