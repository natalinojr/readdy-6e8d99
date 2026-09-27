-- Rascunho de treino do atendente de WhatsApp da loja (edge atendimento-loja, action 'simulate').
-- Cria o schema `treino` com os cenários, dispara as simulações pela pg_net e junta as respostas.
-- É RASCUNHO: criar para treinar e apagar no fim (`drop schema treino cascade;`). Não é migração.
-- Rodar: npx supabase db query --linked --project-ref mdghhjemzdmeuqpzuyzx -f scripts/atendimento-treino/treino.sql
-- Depois carregar os cenários: node scripts/atendimento-treino/carregar-cenarios.mjs (gera o INSERT).

create schema if not exists treino;

create table if not exists treino.cenarios (id text primary key, body jsonb not null);
create table if not exists treino.rodadas (
  rodada text not null, sim text not null, req bigint, created_at timestamptz default now()
);

-- Dispara um pedido HTTP por cenário (a edge responde em ~1–3 min; a resposta fica em net._http_response,
-- que o Supabase apaga depois de ~6 h — exporte antes). p_extra entra por cima do corpo do cenário:
-- {"avaliar": false} (avaliação fora da API), {"modelo": "claude-sonnet-5"}, {"tenant_id": "..."}.
create or replace function treino.rodar(p_rodada text, p_ids text[] default null, p_extra jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare n int := 0; r record; v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'assistente_internal_key';
  for r in select * from treino.cenarios where p_ids is null or id = any(p_ids) order by id loop
    insert into treino.rodadas(rodada, sim, req) values (p_rodada, r.id, net.http_post(
      url := 'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/atendimento-loja',
      headers := jsonb_build_object('Content-Type','application/json','x-internal-key', v_key),
      -- Loja padrão: El Patron Paranaguá (cardápio real). Troque com p_extra {"tenant_id": ...}.
      body := jsonb_build_object('action','simulate','tenant_id','7221d7f3-cd49-4820-93cb-c0abcd16f43c','turnos',6,'aberto',true) || r.body || p_extra,
      timeout_milliseconds := 180000));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace view treino.resultado as
select d.rodada, d.sim, h.status_code as st,
  (h.content::jsonb -> 'avaliacao') ->> 'nota' as nota,
  (h.content::jsonb -> 'avaliacao') ->> 'vendeu' as vendeu,
  h.content::jsonb ->> 'equipe' as equipe,
  h.content::jsonb ->> 'link' as link,
  h.content::jsonb ->> 'custo_usd' as custo,
  (select string_agg((p.value ->> 'gravidade') || ': ' || (p.value ->> 'o_que'), ' | ')
     from jsonb_array_elements(coalesce((h.content::jsonb -> 'avaliacao') -> 'problemas', '[]'::jsonb)) p(value)) as problemas,
  h.content::jsonb as c
from treino.rodadas d left join net._http_response h on h.id = d.req;
