-- Delivery (2026-10-05, revisão da tela Delivery aprovada pelo dono).

-- 1) "Saiu para entrega" marcado pelo caixa/gestor (out_for_delivery_at) grava a hora da saída na linha do
--    tempo do motoboy (motoboy_timeline.coletou) — é a base do "tempo de entrega" (saiu → entregou). Antes
--    12 de 20 entregas da Vila Leste ficavam sem marcação nenhuma.
--    Se o pedido JÁ TEM entregador, ele passa para "Coletou" (só precisa tocar "Entreguei"). Sem entregador,
--    o status não muda: quem pegar o pedido no app ainda assume (o rastreio do cliente depende disso).
--    Vale para entrega da loja (própria, WhatsApp, telefone…); fora retirada e apps de fora.
create or replace function public.fn_delivery_saiu_marca_coletou_trg()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  quando timestamptz := coalesce(new.out_for_delivery_at, now());
  tl jsonb := case when jsonb_typeof(new.motoboy_timeline) = 'object' then new.motoboy_timeline else '{}'::jsonb end;
begin
  if not (tl ? 'coletou') then
    tl := tl || jsonb_build_object('coletou', to_char(quando at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;
  new.motoboy_timeline := tl;
  if new.motoboy_driver_id is not null then
    new.motoboy_status := 'coletou';
    new.motoboy_updated_at := quando;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_delivery_saiu_marca_coletou on public.orders;
create trigger trg_delivery_saiu_marca_coletou
  before update of out_for_delivery_at on public.orders
  for each row
  when (
    new.origin_type = 'delivery'
    and old.out_for_delivery_at is null
    and new.out_for_delivery_at is not null
    and coalesce(new.delivery_platform, 'propria') not in ('retirada', 'ifood', 'rappi', 'uber_eats', '99food')
    and coalesce(new.motoboy_status, '') in ('', 'a_caminho_loja')
    and new.status <> 'delivered'
  )
  execute function public.fn_delivery_saiu_marca_coletou_trg();

-- 2) Entrega grátis acima de um valor (começa desligada): o pedido grava delivery_fee = 0, mas o acerto
--    "% da taxa" do entregador precisa da taxa da faixa — senão ele receberia R$ 0. A taxa da faixa vai
--    para orders.delivery_fee_faixa (gravada pelo delivery-write) e o acerto usa ela quando existe.
alter table public.orders add column if not exists delivery_fee_faixa numeric(10,2);
comment on column public.orders.delivery_fee_faixa is
  'Taxa da faixa de distância antes da entrega grátis (delivery-write). Base do acerto "% da taxa" do entregador.';

create or replace function public.fn_delivery_driver_ledger_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cfg jsonb;
  v_e delivery_driver_ledger;
  v_calc jsonb;
  v_km numeric;
  v_agora timestamptz := now();
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  begin
    select * into v_e from delivery_driver_ledger where order_id = new.id and kind = 'entrega' for update;

    if new.status = 'delivered' and new.motoboy_driver_id is not null
       and coalesce(new.delivery_platform, '') <> 'retirada' and not coalesce(new.is_training, false) then
      if v_e.id is null then
        select delivery_config->'acerto_motoboy' into v_cfg from system_settings where tenant_id = new.tenant_id;
        if v_cfg is null or coalesce(v_cfg->>'ativo', '') <> 'true' then return new; end if;
        if not exists (select 1 from delivery_drivers where id = new.motoboy_driver_id and tenant_id = new.tenant_id) then return new; end if;
        v_km := new.delivery_distance_km;
        -- Entrega grátis: a taxa cobrada é 0, mas o "% da taxa" usa a taxa da faixa (2026-10-05).
        v_calc := _acerto_motoboy_valor(v_cfg, v_km, coalesce(new.delivery_fee_faixa, new.delivery_fee));
        insert into delivery_driver_ledger (tenant_id, driver_id, order_id, kind, amount, km, occurred_at, work_date, regra)
        values (new.tenant_id, new.motoboy_driver_id, new.id, 'entrega', (v_calc->>'valor')::numeric, v_km, v_agora, v_dia, v_calc->'regra')
        on conflict (order_id) where kind = 'entrega' do nothing;
      elsif v_e.status = 'estornado' then
        update delivery_driver_ledger set status = 'aberto', driver_id = new.motoboy_driver_id,
               occurred_at = v_agora, work_date = v_dia, updated_at = v_agora
         where id = v_e.id and status = 'estornado';
      elsif v_e.status = 'aberto' and v_e.driver_id <> new.motoboy_driver_id then
        update delivery_driver_ledger set driver_id = new.motoboy_driver_id, updated_at = v_agora
         where id = v_e.id and status = 'aberto';
      end if;
      delete from delivery_driver_ledger where order_id = new.id and kind = 'estorno' and status = 'aberto';
    elsif v_e.id is not null then
      if v_e.status = 'aberto' then
        update delivery_driver_ledger set status = 'estornado', updated_at = v_agora where id = v_e.id and status = 'aberto';
      elsif v_e.status = 'fechado' then
        insert into delivery_driver_ledger (tenant_id, driver_id, order_id, kind, amount, km, occurred_at, work_date, note)
        values (v_e.tenant_id, v_e.driver_id, new.id, 'estorno', -v_e.amount, v_e.km, v_agora, v_dia,
                'Pedido ' || coalesce(new.number, '') || ' desfeito depois do acerto')
        on conflict (order_id) where kind = 'estorno' do nothing;
      end if;
    end if;
  exception when others then
    begin
      perform fn_dev_error_report(jsonb_build_object(
        'source', 'other', 'severity', 'error', 'tenant_id', new.tenant_id, 'fn', 'fn_delivery_driver_ledger_trg',
        'message', 'Acerto do motoboy não lançado: ' || sqlerrm,
        'context', jsonb_build_object('order_id', new.id, 'status', new.status, 'sqlstate', sqlstate)));
    exception when others then
      raise warning 'acerto_motoboy: pedido % — %', new.id, sqlerrm;
    end;
  end;
  return new;
end $function$;
