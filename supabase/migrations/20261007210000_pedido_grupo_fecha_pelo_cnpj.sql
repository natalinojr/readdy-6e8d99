-- Pedido de pagamento do grupo fecha quando a conta DELE é paga (2026-10-07, dono na tela Hoje: "não tem
-- por que esse card estar na Hoje"). Visto no EP MALL: "Pix de R$ 1.140,00 para Costa e Montenegro … chave
-- no CNPJ 09.585.491/0002-35" continuava aberto com a conta da nota 15213 já paga.
--
-- Ligação forte = o CNPJ do fornecedor da conta (compra → fin_suppliers.cnpj) está escrito no pedido E o
-- valor bate no centavo E é a ÚNICA conta desse fornecedor com esse valor perto da data do pedido (±20 dias
-- pelo vencimento) — com duas, pode ser um segundo pedido: não fecha (a Hoje mantém "Já foi pago — tirar
-- daqui"). Só pelo nome do fornecedor continua sem fechar sozinho. Mesma regra da tela (situacaoConta.ts →
-- contaPeloCnpj). Gatilho separado do trg_pendencia_conta_resolvida de propósito.

create or replace function public.fn_pedido_grupo_valor(t text)
returns numeric language sql immutable as $$
  select nullif(replace(replace(substring(coalesce(t, '') from 'R\$\s*([0-9.]+,[0-9]{2}|[0-9]+(?:,[0-9]{1,2})?)'), '.', ''), ',', '.'), '')::numeric
$$;

create or replace function public.fn_pedido_grupo_tem_cnpj(t text, cnpj text)
returns boolean language sql immutable as $$
  select cnpj is not null and length(cnpj) = 14 and exists (
    select 1 from regexp_matches(coalesce(t, ''), '(?<![0-9])([0-9]{2}\.?[0-9]{3}\.?[0-9]{3}/?[0-9]{4}-?[0-9]{2})(?![0-9])', 'g') m
     where regexp_replace(m[1], '[^0-9]', '', 'g') = cnpj)
$$;

/** Fecha os pedidos do grupo abertos cuja conta (pelo CNPJ) é esta e está paga. Devolve quantos fechou. */
create or replace function public.fn_fechar_pedido_grupo_da_conta(p_conta uuid)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  c record;
  v_cnpj text;
  v_n integer := 0;
begin
  select a.id, a.tenant_id, a.amount, a.due_date, a.status, a.reference_type, a.reference_id into c
    from fin_accounts_payable a where a.id = p_conta;
  if c.id is null or c.status <> 'paid' or c.reference_type <> 'purchase' or c.reference_id is null then return 0; end if;
  select regexp_replace(coalesce(s.cnpj, ''), '[^0-9]', '', 'g') into v_cnpj
    from fin_purchases p join fin_suppliers s on s.id = p.supplier_id where p.id = c.reference_id;
  if v_cnpj is null or length(v_cnpj) <> 14 then return 0; end if;

  update pendencias pd set status = 'resolvida', resolvida_em = now(),
         motivo = 'a conta deste pedido foi paga (mesmo CNPJ e valor)'
   where pd.tenant_id = c.tenant_id and pd.kind = 'pagamento_grupo' and pd.status in ('aberta', 'vista')
     and coalesce(pd.payload->>'bill_id', '') = ''
     and fn_pedido_grupo_tem_cnpj(pd.titulo || E'\n' || coalesce(pd.detalhe, ''), v_cnpj)
     and abs(fn_pedido_grupo_valor(pd.titulo || E'\n' || coalesce(pd.detalhe, '')) - c.amount) < 0.01
     and c.due_date between (pd.criada_em at time zone 'America/Sao_Paulo')::date - 20 and (pd.criada_em at time zone 'America/Sao_Paulo')::date + 20
     -- única candidata: nenhuma outra conta do mesmo fornecedor e valor perto da data do pedido
     and not exists (
       select 1 from fin_accounts_payable o
         join fin_purchases op on op.id = o.reference_id
         join fin_suppliers os on os.id = op.supplier_id
        where o.tenant_id = c.tenant_id and o.id <> c.id and o.reference_type = 'purchase'
          and abs(o.amount - c.amount) < 0.01
          and regexp_replace(coalesce(os.cnpj, ''), '[^0-9]', '', 'g') = v_cnpj
          and o.due_date between (pd.criada_em at time zone 'America/Sao_Paulo')::date - 20 and (pd.criada_em at time zone 'America/Sao_Paulo')::date + 20);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.fn_fechar_pedido_grupo_da_conta(uuid) from public, anon, authenticated;

create or replace function public.trg_pedido_grupo_conta_paga()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status <> 'paid' or old.status is not distinct from new.status then return new; end if;
  begin
    perform fn_fechar_pedido_grupo_da_conta(new.id);
  exception when others then
    -- Fechar aviso nunca pode impedir a baixa da conta.
    raise warning 'pedido do grupo da conta % não fechou: %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_pedido_grupo_conta_paga on public.fin_accounts_payable;
create trigger trg_pedido_grupo_conta_paga after update of status on public.fin_accounts_payable
  for each row execute function public.trg_pedido_grupo_conta_paga();

-- O que já está parado hoje: pedidos abertos cuja conta (pelo CNPJ) já foi paga.
select public.fn_fechar_pedido_grupo_da_conta(a.id)
  from fin_accounts_payable a
 where a.status = 'paid' and a.reference_type = 'purchase'
   and a.paid_date >= current_date - 90
   and exists (select 1 from pendencias pd where pd.tenant_id = a.tenant_id and pd.kind = 'pagamento_grupo' and pd.status in ('aberta', 'vista'));
