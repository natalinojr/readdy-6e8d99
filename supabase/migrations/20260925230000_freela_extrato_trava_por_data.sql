-- Trava "Pix parece ser do pedido de freelancer" só vale para Pix a partir do dia do pedido (1 dia de folga) até 30 dias depois.
-- Antes comparava só nome+valor e travava Pix antigos (ex.: Pix de 04/08 contra pedido criado em 25/09).

CREATE OR REPLACE FUNCTION public.fn_freelancer_do_extrato(p_bill_id uuid, p_nome text, p_dias date[] DEFAULT NULL::date[], p_funcao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b fin_accounts_payable;
  v_nome text := nullif(trim(p_nome), '');
  v_free uuid;
  v_novo boolean := false;
  v_dias date[];
  v_n int;
  v_parte numeric(12,2);
  v_i int;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into b from fin_accounts_payable where id = p_bill_id;
  if not found then raise exception 'conta a pagar nao encontrada'; end if;
  if not _fn_freelancer_pode(b.tenant_id) then raise exception 'sem acesso a esta loja'; end if;
  if v_nome is null then raise exception 'sem nome de quem recebeu'; end if;
  if coalesce(b.amount, 0) <= 0 then raise exception 'conta sem valor'; end if;
  if exists (select 1 from unnest(coalesce(p_dias, '{}'::date[])) d where d > v_hoje + 7 or d < v_hoje - 365) then
    raise exception 'dia fora do esperado (ate um ano atras ou 7 dias a frente)';
  end if;

  -- Pedido de freela aprovado pelo app (mesmo valor, mesmo nome, Pix feito depois do pedido) com conta em aberto: esse Pix é dele.
  -- Lançar de novo daria duas contas e diárias em dobro — o certo é ligar o débito à conta do pedido.
  if exists (select 1 from fin_payment_requests pr join fin_accounts_payable ap on ap.id = pr.bill_id
             where pr.tenant_id = b.tenant_id and pr.tipo = 'freelancer' and pr.status = 'aprovada'
               and ap.status in ('pending', 'overdue') and ap.amount = b.amount and ap.id <> b.id
               and split_part(lower(trim(pr.favorecido_nome)), ' ', 1) = split_part(lower(v_nome), ' ', 1)
               and coalesce(b.paid_date, b.due_date)
                   between (pr.created_at at time zone 'America/Sao_Paulo')::date - 1
                       and (pr.created_at at time zone 'America/Sao_Paulo')::date + 30) then
    raise exception 'Esse Pix parece ser do pedido de freelancer aprovado pelo app (mesmo nome e valor). Ligue o pagamento à conta a pagar desse pedido em vez de lançar de novo.';
  end if;

  select id into v_free from hr_freelancers
    where tenant_id = b.tenant_id and lower(name) = lower(v_nome) order by created_at limit 1;
  if v_free is null then
    insert into hr_freelancers (tenant_id, name, role)
    values (b.tenant_id, v_nome, nullif(trim(p_funcao), '')) returning id into v_free;
    v_novo := true;
  elsif nullif(trim(p_funcao), '') is not null then
    update hr_freelancers set role = trim(p_funcao), updated_at = now() where id = v_free and role is null;
  end if;

  v_dias := (select array_agg(distinct d order by d) from unnest(coalesce(p_dias, '{}'::date[])) d where d is not null);
  v_n := coalesce(array_length(v_dias, 1), 0);
  delete from hr_freelancer_shifts where bill_id = b.id;
  if v_n = 0 then
    insert into hr_freelancer_shifts (tenant_id, freelancer_id, work_date, amount, bill_id, status)
    values (b.tenant_id, v_free, null, b.amount, b.id, 'aguardando_dias');
  else
    v_parte := trunc(b.amount / v_n, 2);
    for v_i in 1..v_n loop
      insert into hr_freelancer_shifts (tenant_id, freelancer_id, work_date, amount, bill_id, status)
      values (b.tenant_id, v_free, v_dias[v_i],
              case when v_i = v_n then b.amount - v_parte * (v_n - 1) else v_parte end,
              b.id, 'registrada');
    end loop;
  end if;

  update fin_accounts_payable
    set description = _fn_freelancer_descricao(v_nome, v_dias), supplier = v_nome, updated_at = now()
    where id = b.id;

  return jsonb_build_object(
    'freelancer_id', v_free, 'freelancer', v_nome, 'freelancer_novo', v_novo,
    'conta_a_pagar_id', b.id, 'dias_registrados', v_n, 'aguardando_dias', v_n = 0, 'valor', b.amount);
end $function$;
grant execute on function public.fn_freelancer_do_extrato(uuid, text, date[], text) to authenticated, service_role;
