-- ═══════════════════════════════════════════════════════════════════════════
-- Compra online paga por Pix (2026-09-28, decisões do dono)
--
-- Quem pede manda o print do checkout + o Pix copia e cola gerado no site. O dono classifica
-- (Despesa + categoria do DRE, ou CMV + categoria de mercadoria) e autoriza: nasce uma COMPRA
-- (fin_purchases, com a conta a pagar dela) e o Pix sai pelo Inter com o PIN — o inter-bank só
-- aceita o copia e cola se a chave dentro dele estiver em Fornecedores ou nos Pix permitidos.
-- A NF-e do vendedor, se chegar, é IGNORADA (a compra já existe): gatilho abaixo.
-- ═══════════════════════════════════════════════════════════════════════════

-- A compra online agora tem conta a pagar (a da compra criada na aprovação)
drop trigger if exists trg_pedido_compra_online_sem_conta on public.fin_payment_requests;
drop function if exists public._fn_pedido_compra_online_sem_conta();

alter table public.fin_payment_requests
  add column if not exists pix_copia_e_cola text,
  add column if not exists nota_ignorada_id uuid;

-- NF-e do vendedor de uma compra online já lançada: entra como ignorada (desfazível na tela).
-- Critério: fornecedor sem nota lançada antes na loja (vendedor de marketplace), emitida entre
-- 3 dias antes e 45 dias depois do pedido, valor a até R$ 1 do Pix, do subtotal ou do subtotal
-- com desconto; cada pedido ignora uma nota só.
create or replace function public._fn_nota_da_compra_online() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_pedido uuid;
  v_desc text;
begin
  if new.status <> 'new' or coalesce(new.valor_total, 0) <= 0 or new.emitted_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.valor_total is not distinct from new.valor_total and old.status = new.status then return new; end if;
  if new.emitente_cnpj is not null and exists (
    select 1 from fiscal_inbound_documents d
     where d.tenant_id = new.tenant_id and d.emitente_cnpj = new.emitente_cnpj and d.status = 'imported' and d.id <> new.id
  ) then return new; end if;

  select r.id, r.descricao into v_pedido, v_desc
    from fin_payment_requests r
   where r.tenant_id = new.tenant_id and r.tipo = 'compra_online' and r.status in ('aprovada', 'comprada')
     and r.purchase_id is not null and r.nota_ignorada_id is null
     and new.emitted_at between r.created_at - interval '3 days' and r.created_at + interval '45 days'
     and (abs(r.valor - new.valor_total) <= 1
          or abs(coalesce((r.compra_detalhe->>'subtotal')::numeric, -99) - new.valor_total) <= 1
          or abs(coalesce((r.compra_detalhe->>'subtotal')::numeric - coalesce((r.compra_detalhe->>'desconto')::numeric, 0), -99) - new.valor_total) <= 1)
   order by abs(r.valor - new.valor_total), r.created_at
   limit 1
   for update skip locked;
  if v_pedido is null then return new; end if;

  new.status := 'ignored';
  new.ignore_reason := left('Compra online já lançada (pedido pelo app: ' || coalesce(v_desc, '') || ')', 200);
  update fin_payment_requests set nota_ignorada_id = new.id, updated_at = now() where id = v_pedido;
  return new;
end $$;

drop trigger if exists trg_nota_da_compra_online on public.fiscal_inbound_documents;
create trigger trg_nota_da_compra_online before insert or update of valor_total, status on public.fiscal_inbound_documents
  for each row execute function public._fn_nota_da_compra_online();
