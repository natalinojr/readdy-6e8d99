-- Inventário (contagem cheia): insumo que ninguém mexeu não gera ajuste (2026-10-04).
--
-- A contagem cheia manda todos os insumos; os que a pessoa não digitou nem conferiu vão com o teórico
-- que a tela tinha. Se uma venda entra entre a última atualização da tela e o "Confirmar", o servidor
-- comparava esse número velho com o estoque ao vivo e gravava um ajuste positivo (desfazia a venda).
-- Agora o item pode vir com "semMudanca": true e conta como contado igual ao teórico daquele momento
-- (diferença 0). Itens sem o campo continuam como antes.
--
-- Só essa linha muda; o resto da função é reescrito como está no banco (troca de texto conferida).

do $$
declare
  v text;
  v_old constant text := $old$
    v_teorico := v_live - v_depois;
    v_delta := v_counted - v_teorico;
$old$;
  v_new constant text := $new$
    v_teorico := v_live - v_depois;
    -- Campo que ninguém mexeu na contagem cheia: vale o teórico de agora (2026-10-04).
    IF COALESCE((v_item->>'semMudanca')::boolean, false) THEN
      v_counted := v_teorico;
    END IF;
    v_delta := v_counted - v_teorico;
$new$;
begin
  v := pg_get_functiondef('public.fn_confirm_inventory(uuid,uuid,text,jsonb,timestamptz)'::regprocedure);
  if position('semMudanca' in v) > 0 then
    return;  -- já aplicado
  end if;
  if position(v_old in v) = 0 then
    raise exception 'fn_confirm_inventory mudou: revisar à mão';
  end if;
  execute replace(v, v_old, v_new);
end;
$$;
