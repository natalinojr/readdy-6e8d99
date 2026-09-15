-- hiring_candidates_log() quebrava TODA alteração de dados da ficha (2026-09-15, Luciane Paiva):
-- `mudou := mudou || 'escolaridade'` com mudou text[] → o Postgres lê o literal como array e dá
-- "malformed array literal", cancelando o UPDATE. Efeito: o completar_ficha do canal-publico
-- (e a edição pela tela) não gravava nada. Trocado por array_append, sem ambiguidade. Resto igual.
create or replace function public.hiring_candidates_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s_old text; s_new text; c_new text; f_old text[]; f_new text[]; mudou text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform hiring_log(new.id, 'criado', 'Currículo recebido',
      case coalesce(new.source, '')
        when 'whatsapp_link' then 'Pelo link de candidatura do WhatsApp'
        when 'whatsapp_link_teste' then 'Pelo link do WhatsApp (teste do dono)'
        when '' then 'Enviado pela tela ou pelo assistente'
        else 'Origem: ' || new.source end
      || case when new.ai_processed then ' · lido pela IA' else ' · leitura simples' end,
      jsonb_build_object('source', new.source));
    return new;
  end if;
  if new.stage_id is distinct from old.stage_id then
    select name into s_old from hiring_stages where id = old.stage_id;
    select name into s_new from hiring_stages where id = new.stage_id;
    perform hiring_log(new.id, 'fase', 'Fase: ' || coalesce(s_new, '—'),
      'De ' || coalesce(s_old, 'Novo') || ' para ' || coalesce(s_new, '—')
      || case when new.required_waived_at is not null and new.required_waived_at is distinct from old.required_waived_at
              then ' · movido sem os dados mínimos completos' else '' end);
  end if;
  if new.decision is distinct from old.decision then
    perform hiring_log(new.id, 'decisao',
      case when new.decision is null then 'Tomada de decisão removida' else 'Tomada de decisão: ' || upper(new.decision) end,
      case new.decision when 'gpc' then 'Grande potencial de contratação' when 'pc' then 'Potencial de contratação'
        when 'r' then 'Quadro de reserva' when 'na' then 'Não adequado' else null end);
  end if;
  if new.company_id is distinct from old.company_id then
    select name into c_new from hiring_companies where id = new.company_id;
    perform hiring_log(new.id, 'loja', 'Loja: ' || coalesce(c_new, 'sem loja'));
  end if;
  if new.rating is distinct from old.rating then
    perform hiring_log(new.id, 'avaliacao',
      case when new.rating is null then 'Estrelas removidas' else 'Avaliação: ' || new.rating || ' estrela' || case when new.rating > 1 then 's' else '' end end);
  end if;
  if new.ai_processed and not coalesce(old.ai_processed, false) then
    perform hiring_log(new.id, 'ia', 'Currículo organizado pela IA');
    return new; -- a leitura da IA troca muitos campos de uma vez: não lista um por um
  end if;
  -- Dados da ficha
  if new.full_name is distinct from old.full_name then mudou := array_append(mudou, 'nome'); end if;
  if new.phone is distinct from old.phone then mudou := array_append(mudou, 'telefone'); end if;
  if new.whatsapp is distinct from old.whatsapp then mudou := array_append(mudou, 'WhatsApp'); end if;
  if new.email is distinct from old.email then mudou := array_append(mudou, 'e-mail'); end if;
  if new.birth_date is distinct from old.birth_date then mudou := array_append(mudou, 'nascimento'); end if;
  if new.marital_status is distinct from old.marital_status then mudou := array_append(mudou, 'estado civil'); end if;
  if new.address is distinct from old.address then mudou := array_append(mudou, 'endereço'); end if;
  if new.neighborhood is distinct from old.neighborhood then mudou := array_append(mudou, 'bairro'); end if;
  if new.city is distinct from old.city then mudou := array_append(mudou, 'cidade'); end if;
  if new.desired_role is distinct from old.desired_role then mudou := array_append(mudou, 'cargo pretendido'); end if;
  if new.availability is distinct from old.availability then mudou := array_append(mudou, 'disponibilidade'); end if;
  if new.salary_expectation is distinct from old.salary_expectation then mudou := array_append(mudou, 'pretensão salarial'); end if;
  if new.driver_license is distinct from old.driver_license then mudou := array_append(mudou, 'CNH'); end if;
  if new.summary is distinct from old.summary then mudou := array_append(mudou, 'resumo'); end if;
  if new.education is distinct from old.education then mudou := array_append(mudou, 'escolaridade'); end if;
  if new.experiences is distinct from old.experiences then mudou := array_append(mudou, 'experiências'); end if;
  if new.extra_fields is distinct from old.extra_fields then mudou := array_append(mudou, 'outros dados'); end if;
  if cardinality(mudou) > 0 then
    f_old := hiring_missing_fields(old);
    f_new := hiring_missing_fields(new);
    if cardinality(f_new) < cardinality(f_old) and cardinality(f_new) = 0 then
      perform hiring_log(new.id, 'ficha', 'Dados mínimos completos', 'Alterado: ' || array_to_string(mudou, ', '));
    else
      perform hiring_log(new.id, 'ficha', 'Dados alterados', 'Alterado: ' || array_to_string(mudou, ', '));
    end if;
  end if;
  return new;
end $function$;
