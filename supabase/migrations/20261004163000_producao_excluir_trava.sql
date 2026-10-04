-- Excluir produção (20261004160000): trava antes de estornar (revisão de 2026-10-04).
--
-- Sem trava, duas chamadas ao mesmo tempo (ex.: reenvio depois de erro de rede) passavam pela checagem
-- "existe" e as duas devolviam o estoque (estorno em dobro). Agora: trava da contagem da loja (a mesma de
-- fn_confirm_inventory, para uma contagem confirmada no meio não levar o estorno por cima) + trava do
-- registro; quem chega depois recebe "já foi excluída" e não mexe em nada.

do $$
declare
  v text;
  v_old constant text := $old$
    -- 2026-10-04: devolve ao estoque o que a produção mexeu (ver 20261004160000_producao_excluir_estorna.sql).
    DECLARE
$old$;
  v_new constant text := $new$
    -- 2026-10-04: devolve ao estoque o que a produção mexeu (ver 20261004160000_producao_excluir_estorna.sql).
    -- Trava a contagem da loja e o registro: exclusão repetida não estorna 2× (20261004163000).
    PERFORM pg_advisory_xact_lock(hashtext('inventory_confirm_' || p_tenant_id::text));
    PERFORM 1 FROM production_batches WHERE id = v_batch_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Esta produção já foi excluída.');
    END IF;
    DECLARE
$new$;
begin
  v := pg_get_functiondef('public.fn_production_crud(text,uuid,uuid,jsonb)'::regprocedure);
  if position('exclusão repetida não estorna' in v) > 0 then
    return;  -- já aplicado
  end if;
  if position(v_old in v) = 0 then
    raise exception 'fn_production_crud: bloco do estorno não encontrado (aplicar 20261004160000 antes)';
  end if;
  execute replace(v, v_old, v_new);
end;
$$;
