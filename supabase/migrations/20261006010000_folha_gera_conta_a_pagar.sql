-- Folha gera conta a pagar (decisão do dono, 2026-10-05): cada lançamento de folha pendente
-- (hr_payroll) ganha UMA conta a pagar do funcionário, pelo líquido, vencendo no 5º dia útil do
-- mês seguinte à competência. A conta leva reference_type 'hr_payroll' + reference_id = folha, então
-- a DRE continua lendo o custo só pelo RH (bruto + FGTS) — DRETab/DREComparativo/useDespesas já
-- excluem reference_type 'hr_payroll' (o mesmo das guias de INSS/FGTS, que têm reference_id nulo).
-- Os dois lados ficam sincronizados por gatilho, qualquer que seja o caminho (tela, Domínio,
-- Conciliação, assistente): pagar/desfazer de um lado reflete no outro.
-- Fora: sócio "Só o INSS" (rubricas só inss_socio) e líquido zero (rescisão) — não há Pix.

-- 5º dia útil do mês seguinte à competência 'YYYY-MM'. Dia útil para salário (CLT art. 459 §1º):
-- segunda a sábado, fora domingo e feriado nacional (inclui Sexta-feira Santa).
create or replace function public.fn_folha_vencimento(p_ref text)
returns date language plpgsql immutable set search_path to 'public' as $$
declare
  d date; n int := 0; y int; a int; b int; c int; k int; i int; l int; m int; mes int; dia int; pascoa date;
begin
  if coalesce(p_ref, '') !~ '^\d{4}-\d{2}' then return null; end if;
  d := (to_date(left(p_ref, 7) || '-01', 'YYYY-MM-DD') + interval '1 month')::date;
  y := extract(year from d);
  -- Páscoa (Meeus/Butcher) → Sexta-feira Santa = Páscoa − 2
  a := y % 19; b := y / 100; c := y % 100;
  k := (19 * a + b - b / 4 - (b - (8 * b + 13) / 25) + 15) % 30;
  i := c / 4; l := (32 + 2 * (b % 4) + 2 * i - k - (c % 4)) % 7;
  m := (a + 11 * k + 22 * l) / 451;
  mes := (k + l - 7 * m + 114) / 31; dia := ((k + l - 7 * m + 114) % 31) + 1;
  pascoa := make_date(y, mes, dia);
  d := d - 1;
  while n < 5 loop
    d := d + 1;
    continue when extract(isodow from d) = 7;
    continue when to_char(d, 'MM-DD') in ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25');
    continue when d = pascoa - 2;
    n := n + 1;
  end loop;
  return d;
end $$;

-- A folha deve ter conta? (líquido > 0, competência válida, não é o sócio "Só o INSS")
create or replace function public.fn_folha_tem_conta(p hr_payroll)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(p.net_salary, 0) > 0.005
     and coalesce(p.reference_month, '') ~ '^\d{4}-\d{2}'
     and coalesce(p.status, '') <> 'cancelled'
     and not (jsonb_typeof(p.rubricas) = 'array' and jsonb_array_length(p.rubricas) > 0
              and not exists (select 1 from jsonb_array_elements(p.rubricas) r where coalesce(r->>'categoria', '') <> 'inss_socio'))
$$;

create or replace function public.fn_folha_conta_criar(p hr_payroll)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_venc date := public.fn_folha_vencimento(p.reference_month);
        v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_tipo text := case coalesce(p.entry_type, 'regular')
                         when 'thirteenth_first' then '13º salário (1ª parcela)'
                         when 'thirteenth_second' then '13º salário (2ª parcela)'
                         when 'vacation_pay' then 'Férias'
                         else 'Salário' end;
begin
  insert into fin_accounts_payable (tenant_id, description, supplier, category, amount, due_date, payment_method,
                                    status, reference_type, reference_id, competence_month, notes)
  values (p.tenant_id,
          v_tipo || ' ' || substr(p.reference_month, 6, 2) || '/' || substr(p.reference_month, 1, 4) || ' — ' || coalesce(p.employee_name, 'Funcionário'),
          coalesce(p.employee_name, 'Funcionário'), 'Folha de pagamento', round(p.net_salary, 2), v_venc, 'PIX',
          case when v_venc < v_hoje then 'overdue' else 'pending' end,
          'hr_payroll', p.id, to_date(left(p.reference_month, 7) || '-01', 'YYYY-MM-DD'),
          'Gerada pela folha (RH). Pagar aqui, no RH ou pela Conciliação marca os dois lados.');
end $$;

-- hr_payroll → conta
create or replace function public.trg_folha_conta_sync()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare b fin_accounts_payable; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_venc date;
begin
  if pg_trigger_depth() > 1 then return null; end if;  -- veio do gatilho da conta
  if tg_op = 'DELETE' then
    delete from fin_accounts_payable where reference_type = 'hr_payroll' and reference_id = old.id
       and tenant_id = old.tenant_id and status in ('pending', 'overdue');
    return null;
  end if;

  select * into b from fin_accounts_payable
   where reference_type = 'hr_payroll' and reference_id = new.id and tenant_id = new.tenant_id limit 1;

  if b.id is null then
    if new.status = 'pending' and public.fn_folha_tem_conta(new) then perform public.fn_folha_conta_criar(new); end if;
    return null;
  end if;

  if new.status = 'paid' then
    if b.status <> 'paid' then
      update fin_accounts_payable set status = 'paid', paid_amount = amount, paid_date = coalesce(new.paid_date, v_hoje),
             payment_method = coalesce(nullif(new.payment_method, ''), payment_method), updated_at = now()
       where id = b.id;
    end if;
  elsif new.status = 'pending' then
    if not public.fn_folha_tem_conta(new) then
      delete from fin_accounts_payable where id = b.id and status in ('pending', 'overdue');
      return null;
    end if;
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
  elsif new.status = 'cancelled' then
    delete from fin_accounts_payable where id = b.id and status in ('pending', 'overdue');
  end if;
  return null;
end $$;

drop trigger if exists trg_folha_conta_sync on public.hr_payroll;
create trigger trg_folha_conta_sync after insert or update or delete on public.hr_payroll
  for each row execute function public.trg_folha_conta_sync();

-- conta → hr_payroll (pagou/desfez pela tela de Contas a Pagar, Trilha, Conciliação…)
create or replace function public.trg_conta_folha_sync()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;  -- veio do gatilho da folha
  if new.status = 'paid' and old.status is distinct from 'paid' then
    update hr_payroll set status = 'paid', paid_date = coalesce(new.paid_date, (now() at time zone 'America/Sao_Paulo')::date),
           payment_method = coalesce(nullif(new.payment_method, ''), payment_method, 'PIX'), updated_at = now()
     where id = new.reference_id and tenant_id = new.tenant_id and status = 'pending';
  elsif old.status = 'paid' and new.status in ('pending', 'overdue', 'partial') then
    update hr_payroll set status = 'pending', paid_date = null, payment_method = null, updated_at = now()
     where id = new.reference_id and tenant_id = new.tenant_id and status = 'paid';
    -- lançamento de caixa do pagamento feito pela folha (pay_payroll), se houver
    delete from fin_cash_flow where tenant_id = new.tenant_id and origin = 'auto_payroll' and reference_id = new.reference_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_conta_folha_sync on public.fin_accounts_payable;
create trigger trg_conta_folha_sync after update of status on public.fin_accounts_payable
  for each row when (new.reference_type = 'hr_payroll' and new.reference_id is not null)
  execute function public.trg_conta_folha_sync();

revoke all on function public.fn_folha_conta_criar(hr_payroll) from public, anon, authenticated;
revoke all on function public.trg_folha_conta_sync() from public, anon, authenticated;
revoke all on function public.trg_conta_folha_sync() from public, anon, authenticated;

-- Carga: folhas pendentes a partir de 08/2026 (as pendentes de abr–jun/2026 são antigas, ficam fora).
do $$
declare p hr_payroll;
begin
  for p in select * from hr_payroll h
            where h.status = 'pending' and h.reference_month >= '2026-08' and public.fn_folha_tem_conta(h)
              and not exists (select 1 from fin_accounts_payable a where a.reference_type = 'hr_payroll' and a.reference_id = h.id)
  loop
    perform public.fn_folha_conta_criar(p);
  end loop;
end $$;
