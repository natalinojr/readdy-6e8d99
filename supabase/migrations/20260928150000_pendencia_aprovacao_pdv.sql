-- ── Pedido de aprovação do PDV vira pendência (2026-09-28) ─────────────────────
-- Decisão do dono: o sino sai para todo mundo e a caixa de Pendências passa a ser o
-- lugar onde tudo que espera alguém aparece — inclusive o pedido de cancelamento do
-- caixa. Cada linha de pdv_approval_requests abre uma pendência kind='aprovacao'
-- (ref = id da solicitação, rota /aprovacoes) e ela fecha sozinha quando a
-- solicitação é aprovada, recusada ou cancelada por quem pediu.

create or replace function public.fn_pendencia_aprovacao_pdv_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_quem text := coalesce(nullif(new.payload->>'garcomNome', ''), new.requested_by_name, 'Operador');
  v_item text := coalesce(nullif(new.payload->>'itemNome', ''), 'pedido');
  v_titulo text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pendente' then return new; end if;
    v_titulo := case new.tipo
      when 'cancelamento' then 'Cancelamento: ' || v_item || ' — ' || v_quem || ' pede aprovação'
      when 'desconto' then 'Desconto: ' || v_quem || ' pede aprovação'
      else 'Problema relatado: ' || v_item || ' (' || v_quem || ')'
    end;
    perform public.fn_pendencia_upsert(
      new.tenant_id, 'aprovacao', new.id::text, v_titulo,
      nullif(new.payload->>'descricao', ''),
      jsonb_build_object('solicitacao_id', new.id, 'tipo', new.tipo),
      '/aprovacoes',
      case when new.tipo = 'cancelamento' or new.urgente then 'alta' else 'normal' end,
      true, 'app', false);
  elsif new.status is distinct from old.status and new.status <> 'pendente' then
    perform public.fn_pendencia_resolver_ref(
      new.tenant_id, 'aprovacao', new.id::text,
      case new.status
        when 'aprovado' then 'aprovado por ' || coalesce(new.resolved_by_name, 'gerente')
        when 'rejeitado' then 'recusado por ' || coalesce(new.resolved_by_name, 'gerente')
        else 'cancelado por quem pediu'
      end);
  end if;
  return new;
exception when others then
  -- A pendência é ponteiro: se falhar, a solicitação continua valendo na tela Aprovações.
  return new;
end $$;

drop trigger if exists trg_pendencia_aprovacao_pdv on public.pdv_approval_requests;
create trigger trg_pendencia_aprovacao_pdv
  after insert or update of status on public.pdv_approval_requests
  for each row execute function public.fn_pendencia_aprovacao_pdv_sync();

revoke all on function public.fn_pendencia_aprovacao_pdv_sync() from public, anon, authenticated;
