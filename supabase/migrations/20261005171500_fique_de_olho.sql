-- ═══════════════════════════════════════════════════════════════════════════
-- "Fique de olho" (2026-10-05) — cancelamento, desconto e sangria altos viram UM cartão por loja e dia na tela Hoje.
--
-- Quem chama: Edge audit-write (service_role), depois de gravar o evento em audit_log. A regra do que conta
-- (R$ 100 / R$ 50 / R$ 500) e o texto de cada ocorrência moram em supabase/functions/_shared/fique-de-olho.ts;
-- aqui só o que precisa ser ATÔMICO: juntar a ocorrência na linha do dia sem perder uma quando duas chegam juntas
-- (fn_pendencia_upsert troca o payload inteiro, então não serve para somar itens) e decidir se este é o aviso de
-- celular da regra (no máximo 1 por regra por hora, nunca entre 23h e 7h, hora de Brasília).
--
-- Pendência: kind 'fique_de_olho', ref = dia (YYYY-MM-DD de Brasília), acao_requerida = false (é ciência, não
-- tarefa: "Estou ciente" = fn_pendencia_marcar 'resolvida'). Sem tabela nova.
-- Depois do "ciente" (ou de um "descartar" pela caixa de pendências, tratado igual), uma ocorrência nova do mesmo dia
-- reabre o cartão só com o que é novo (payload.ja_vistos guarda quantas já tinham sido vistas). Descartar NÃO
-- desliga o alarme do resto do dia: é alarme de dinheiro, não tarefa.
-- O aviso de celular (1 por regra por hora, 7h-23h) é decidido aqui dentro, pelo carimbo payload.push, e vale
-- qualquer que seja o estado do cartão.
-- Só o Administrador (e o dono da plataforma) dá ciência: ver fn_pendencia_marcar no fim deste arquivo.
--
-- Aplicar no Supabase (projeto ERP OS, ref mdghhjemzdmeuqpzuyzx) ANTES de publicar a edge audit-write.
-- Sem esta função a edge só registra um aviso no log e o audit_log continua gravando normalmente.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.fn_fique_de_olho_add(p_tenant uuid, p_item jsonb, p_regra text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dia   text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
  v_hora  int  := extract(hour from now() at time zone 'America/Sao_Paulo')::int;
  r       public.pendencias;
  v_itens jsonb;
  v_ja    int := 0;
  v_n     int;
  v_push  jsonb;
  v_pode  boolean := false;
  v_ultimo timestamptz;
  v_detalhe text;
begin
  if p_tenant is null or p_item is null or coalesce(p_item->>'id', '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'item inválido');
  end if;
  if p_regra not in ('cancelamento', 'desconto', 'sangria') then
    return jsonb_build_object('ok', false, 'motivo', 'regra inválida');
  end if;

  -- Garante a linha do dia e a trava: duas ocorrências juntas entram uma de cada vez.
  insert into public.pendencias (tenant_id, kind, ref, titulo, payload, rota, urgencia, acao_requerida, origem)
  values (p_tenant, 'fique_de_olho', v_dia, 'Fique de olho', jsonb_build_object('itens', '[]'::jsonb, 'dia', v_dia),
          '/auditoria', 'normal', false, 'app')
  on conflict (tenant_id, kind, ref) do nothing;

  select * into r from public.pendencias
   where tenant_id = p_tenant and kind = 'fique_de_olho' and ref = v_dia
   for update;

  v_itens := coalesce(r.payload->'itens', '[]'::jsonb);

  -- Reenvio do mesmo evento (fila do aparelho): mesmo id em menos de 60 s não entra de novo.
  if exists (
    select 1 from jsonb_array_elements(v_itens) e
     where e->>'id' = p_item->>'id'
       and coalesce((e->>'ts')::timestamptz, '-infinity'::timestamptz) > now() - interval '60 seconds'
  ) then
    return jsonb_build_object('ok', true, 'novo', false, 'enviar_push', false);
  end if;

  v_ja := coalesce((r.payload->>'ja_vistos')::int, 0);
  if r.status in ('resolvida', 'descartada') then
    -- Já deu ciência (ou descartou) o que havia: o cartão volta só com o que é novo.
    v_ja := v_ja + jsonb_array_length(v_itens);
    v_itens := '[]'::jsonb;
  end if;
  v_itens := v_itens || jsonb_build_array(p_item);
  if jsonb_array_length(v_itens) > 40 then
    select coalesce(jsonb_agg(t.e order by t.i), '[]'::jsonb) into v_itens
      from jsonb_array_elements(v_itens) with ordinality as t(e, i)
     where t.i > jsonb_array_length(v_itens) - 40;
  end if;
  v_n := jsonb_array_length(v_itens);

  -- Celular: 1 por regra por hora, só de 7h às 23h. Fora da janela não fica "devendo" aviso: o cartão está na Hoje.
  v_push := coalesce(r.payload->'push', '{}'::jsonb);
  v_ultimo := nullif(v_push->>p_regra, '')::timestamptz;
  if v_hora >= 7 and v_hora < 23 and (v_ultimo is null or v_ultimo <= now() - interval '1 hour') then
    v_pode := true;
    v_push := v_push || jsonb_build_object(p_regra, now());
  end if;

  -- Texto simples (a caixa de pendências do chat e /pendencias não conhecem o cartão novo e mostram o detalhe).
  select string_agg('• ' || (e->>'titulo') || ' — ' || coalesce(e->>'quem', '') || ', ' || coalesce(e->>'hora', ''), E'\n' order by i)
    into v_detalhe
    from jsonb_array_elements(v_itens) with ordinality as t(e, i);

  update public.pendencias set
    status = 'aberta', vista_em = null, resolvida_em = null, resolvida_por = null, motivo = null,
    titulo = case when v_n = 1 then coalesce(p_item->>'titulo', 'Fique de olho') else v_n::text || ' coisas da equipe hoje' end,
    detalhe = v_detalhe,
    payload = jsonb_build_object('itens', v_itens, 'ja_vistos', v_ja, 'push', v_push, 'dia', v_dia),
    urgencia = 'normal', acao_requerida = false
   where id = r.id;

  return jsonb_build_object('ok', true, 'novo', true, 'enviar_push', v_pode, 'n', v_n, 'dia', v_dia);
end $$;

-- Só as Edge Functions (service_role) chamam; nunca o navegador.
revoke all on function public.fn_fique_de_olho_add(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.fn_fique_de_olho_add(uuid, jsonb, text) to service_role;


-- ── Só o Administrador dá ciência do "Fique de olho" ──────────────────────────────────────────
-- A ciência do Supervisor fechava o cartão para o dono, que é quem precisa ficar sabendo. Mesma função da
-- 20260918120000_pendencias.sql (corpo igual) com UMA trava a mais: pendência kind 'fique_de_olho' só muda de
-- estado (vista/resolvida/descartada/reabrir) por quem é Administrador da loja ou dono da plataforma. As demais
-- pendências seguem como antes (qualquer membro da loja). A tela também esconde o botão do Supervisor.
create or replace function public.fn_pendencia_marcar(
  p_id uuid, p_acao text, p_motivo text default null)
returns public.pendencias
language plpgsql security definer set search_path = public as $$
declare r public.pendencias;
begin
  if p_acao not in ('vista', 'resolvida', 'descartada', 'reabrir') then
    raise exception 'Ação inválida: %', p_acao;
  end if;
  select * into r from public.pendencias where id = p_id;
  if r.id is null then raise exception 'Pendência não encontrada.'; end if;
  if not exists (select 1 from public.user_tenants
                  where user_id = (select auth.uid()) and tenant_id = r.tenant_id) then
    raise exception 'Sem acesso a essa pendência.';
  end if;
  if r.kind = 'fique_de_olho' and p_acao in ('resolvida', 'descartada')
     and not public.is_platform_owner((select auth.uid()))
     and not exists (select 1 from public.user_tenants
                      where user_id = (select auth.uid()) and tenant_id = r.tenant_id and role::text = 'admin') then
    raise exception 'Quem dá ciência do "Fique de olho" é o dono.';
  end if;

  update public.pendencias set
    status = case when p_acao = 'reabrir' then 'aberta' else p_acao end,
    vista_em = case when p_acao = 'vista' then now()
                    when p_acao = 'reabrir' then null else vista_em end,
    resolvida_em = case when p_acao in ('resolvida', 'descartada') then now()
                        when p_acao = 'reabrir' then null else resolvida_em end,
    -- só em fechamento: uma pendência marcada "vista" não tem quem a resolveu
    resolvida_por = case when p_acao in ('resolvida', 'descartada') then (select auth.uid())
                         when p_acao = 'reabrir' then null else resolvida_por end,
    motivo = case when p_acao = 'reabrir' then null else coalesce(p_motivo, motivo) end,
    snooze_until = case when p_acao = 'reabrir' then null else snooze_until end
  where id = p_id
  returning * into r;
  return r;
end $$;

revoke all on function public.fn_pendencia_marcar(uuid, text, text) from public;
grant execute on function public.fn_pendencia_marcar(uuid, text, text) to authenticated, service_role;
