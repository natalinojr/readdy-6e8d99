-- ═══════════════════════════════════════════════════════════════════════════
-- Freelancer lançado pelo extrato (2026-09-20)
--
-- Pedido do dono: "esse pagamento é de freelancer — como faço pra classificar por aqui?", olhando um
-- Pix pendente na Conciliação. Até aqui só existia o caminho do Pix feito PELO ERPOS
-- (fn_freelancer_registrar_pagamento, que parte de fin_inter_payments): um Pix feito pelo app do
-- banco só podia virar "despesa", sem entrar no controle de freelancers.
--
-- Esta função faz o mesmo que aquela, mas a partir da CONTA A PAGAR que a conciliação acabou de
-- criar e baixar (Conciliação › Lançar a partir deste pagamento › Freelancer):
--   • acha ou cria o freelancer pelo nome de quem recebeu (mesma regra de nome da outra função);
--   • grava uma diária por dia trabalhado (valor dividido), ou uma linha "aguardando_dias" quando
--     os dias ainda não se sabem — a aba Freelancers pergunta depois, igual ao fluxo do grupo;
--   • ajusta a descrição da conta para "Freelancer — Nome (dias)".
-- payment_id fica nulo: não houve Pix pelo ERPOS, o dinheiro saiu direto do banco.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.fn_freelancer_do_extrato(
  p_bill_id uuid,
  p_nome text,
  p_dias date[] default null,
  p_funcao text default null
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
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
  if not found then raise exception 'conta a pagar não encontrada'; end if;
  if not _fn_freelancer_pode(b.tenant_id) then raise exception 'sem acesso a esta loja'; end if;
  if v_nome is null then raise exception 'sem nome de quem recebeu'; end if;
  if coalesce(b.amount, 0) <= 0 then raise exception 'conta sem valor'; end if;
  if exists (select 1 from unnest(coalesce(p_dias, '{}'::date[])) d where d > v_hoje + 7 or d < v_hoje - 365) then
    raise exception 'dia fora do esperado (até um ano atrás ou 7 dias à frente)';
  end if;

  -- 1) freelancer (pelo nome; o vínculo com a chave Pix só se faz pela lista de favorecidos)
  select id into v_free from hr_freelancers
    where tenant_id = b.tenant_id and lower(name) = lower(v_nome) order by created_at limit 1;
  if v_free is null then
    insert into hr_freelancers (tenant_id, name, role)
    values (b.tenant_id, v_nome, nullif(trim(p_funcao), '')) returning id into v_free;
    v_novo := true;
  elsif nullif(trim(p_funcao), '') is not null then
    update hr_freelancers set role = trim(p_funcao), updated_at = now() where id = v_free and role is null;
  end if;

  -- 2) diárias desta conta (regrava sempre: a conta é sempre nova, criada pela conciliação)
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

  -- 3) a conta passa a se chamar como as outras de freelancer
  update fin_accounts_payable
    set description = _fn_freelancer_descricao(v_nome, v_dias), supplier = v_nome, updated_at = now()
    where id = b.id;

  return jsonb_build_object(
    'freelancer_id', v_free, 'freelancer', v_nome, 'freelancer_novo', v_novo,
    'conta_a_pagar_id', b.id, 'dias_registrados', v_n, 'aguardando_dias', v_n = 0, 'valor', b.amount);
end $$;

grant execute on function public.fn_freelancer_do_extrato(uuid, text, date[], text) to authenticated, service_role;
