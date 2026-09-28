-- Agente Pesquisador do manual do gestor de tráfego (PLANO-TRAFEGO-PAGO-AGENTES.md §3.1c, 2026-09-28).
-- O manual (MANUAL-GESTOR-TRAFEGO-PAGO.md) vira itens estruturados que os agentes podem ler; o
-- Pesquisador roda 1x/mês com busca na web e propõe mudanças. Só fonte oficial da Meta (conferida
-- pelo endereço, no código) entra sozinha; o resto fica "a testar"/"pendente" para o admin decidir.
-- Tabelas globais (o manual vale para todas as lojas): leitura para qualquer usuário logado,
-- escrita só pela service role (Edge trafego-pesquisador).

create table if not exists public.trafego_manual_itens (
  chave          text primary key,
  tema           text not null,
  regra          text not null,
  valor          text,
  confianca      text not null check (confianca in ('oficial', 'oficial_a_confirmar', 'dado_medido', 'mercado', 'inferencia')),
  fonte_url      text,
  verificado_em  date,
  status         text not null default 'vigente' check (status in ('vigente', 'a_testar', 'revogada')),
  updated_at     timestamptz not null default now()
);
comment on table public.trafego_manual_itens is 'Regras do manual do gestor de tráfego (estruturadas), com confiança e fonte; atualizadas pelo Pesquisador.';

create table if not exists public.trafego_pesquisas (
  id           uuid primary key default gen_random_uuid(),
  trigger      text not null default 'manual' check (trigger in ('manual', 'cron')),
  status       text not null default 'running' check (status in ('running', 'done', 'error')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  model        text,
  buscas       int,
  usage        jsonb,
  custo_usd    numeric(10, 4),
  relatorio    text,
  error        text,
  requested_by text
);

create table if not exists public.trafego_manual_propostas (
  id            uuid primary key default gen_random_uuid(),
  pesquisa_id   uuid references public.trafego_pesquisas(id) on delete cascade,
  item_chave    text references public.trafego_manual_itens(chave) on delete set null,
  tipo          text not null check (tipo in ('confirmar', 'alterar', 'nova', 'alerta')),
  resumo        text not null,
  regra         text,
  valor         text,
  fonte_url     text,
  fonte_oficial boolean not null default false,
  trecho        text,
  status        text not null default 'pendente' check (status in ('aplicada', 'a_testar', 'pendente', 'rejeitada')),
  decided_by    text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists trafego_manual_propostas_status_idx on public.trafego_manual_propostas (status, created_at desc);

grant select on public.trafego_manual_itens, public.trafego_pesquisas, public.trafego_manual_propostas to authenticated;
grant select, insert, update, delete on public.trafego_manual_itens, public.trafego_pesquisas, public.trafego_manual_propostas to service_role;
alter table public.trafego_manual_itens enable row level security;
alter table public.trafego_pesquisas enable row level security;
alter table public.trafego_manual_propostas enable row level security;
do $$
declare t text;
begin
  foreach t in array array['trafego_manual_itens', 'trafego_pesquisas', 'trafego_manual_propostas'] loop
    execute format('drop policy if exists %I_select_auth on public.%I', t, t);
    execute format('create policy %I_select_auth on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists service_role_bypass_%I on public.%I', t, t);
    execute format('create policy service_role_bypass_%I on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- Itens iniciais = tabela "Valores padrão" + pontos oficiais do manual v1 (2026-09-27).
insert into public.trafego_manual_itens (chave, tema, regra, valor, confianca, fonte_url, verificado_em) values
  ('aprendizado_eventos', 'Fase de aprendizado', 'Conjunto sai do aprendizado após N eventos de otimização em 7 dias', '50 eventos / 7 dias por conjunto', 'oficial_a_confirmar', 'https://www.facebook.com/business/help/411605549765586', '2026-09-27'),
  ('orcamento_mudanca_max', 'Escala', 'Mudança máxima de orçamento por vez (acima disso tende a reiniciar o aprendizado)', '20%', 'mercado', 'https://www.facebook.com/business/help/316478108955072', '2026-09-27'),
  ('orcamento_intervalo', 'Escala', 'Intervalo mínimo entre mudanças de orçamento', '72 h (48–96 h)', 'mercado', 'https://roaspig.com/blog/budget-increase-frequency-meta-ads/', '2026-09-27'),
  ('julgar_gasto_minimo', 'Stop-loss', 'Gasto mínimo antes de julgar anúncio sem conversão', '2× o CPA-alvo', 'mercado', 'https://admanage.ai/blog/when-to-kill-a-facebook-ad', '2026-09-27'),
  ('stop_loss', 'Stop-loss', 'Pausar com custo por resultado acima de N× a meta e zero conversão, com dados assentados (48–72 h)', '3× o CPA-alvo', 'mercado', 'https://admanage.ai/blog/when-to-kill-a-facebook-ad', '2026-09-27'),
  ('fadiga_frequencia', 'Criativo', 'Frequência semanal de alerta/ação de fadiga em prospecção', 'alertar ≥ 2,5; agir ≥ 3,5', 'mercado', 'https://goodmorningco.com/blog/what-is-creative-fatigue-meta-ads-frequency-thresholds', '2026-09-27'),
  ('fadiga_ctr', 'Criativo', 'Sinal complementar de fadiga: queda sustentada de CTR', '20–25% por 3+ dias', 'mercado', 'https://www.tryatria.com/blog/meta-creative-fatigue-diagnose-and-fix-2026', '2026-09-27'),
  ('teste_criativo_duracao', 'Criativo', 'Duração mínima e impressões antes de julgar criativo', '7 dias e 1.000+ impressões', 'mercado', 'https://theoptimizer.io/blog/how-to-test-ad-creatives-on-meta-after-the-andromeda-update-2026-playbook', '2026-09-27'),
  ('criativos_por_conjunto', 'Criativo', 'Número de criativos por conjunto em conta pequena (R$ 20–100/dia)', '5–10', 'inferencia', null, '2026-09-27'),
  ('relevancia_impressoes', 'Diagnóstico', 'Rankings de qualidade/engajamento/conversão aparecem a partir de N impressões', '~500 impressões', 'oficial_a_confirmar', 'https://www.facebook.com/business/help/403110480493160', '2026-09-27'),
  ('raio_delivery', 'Público', 'Raio de segmentação para delivery local (pin no endereço da loja)', '3–8 km', 'mercado', 'https://radiusmapper.com/blog/local-marketing-radius-targeting', '2026-09-27'),
  ('dayparting_vitalicio', 'Orçamento', 'Programação por horário só funciona com orçamento vitalício (não diário)', null, 'oficial_a_confirmar', 'https://tribeupacademy.com/meta-ads-budget-daily-vs-lifetime/', '2026-09-27'),
  ('alcool_idade', 'Política', 'Álcool permitido no Brasil com idade mínima 18 e leis locais', '18+', 'oficial_a_confirmar', 'https://transparency.meta.com/policies/ad-standards/restricted-goods-services/alcohol/', '2026-09-27'),
  ('atribuicao_padrao', 'Medição', 'Janela de atribuição padrão (e remoção de 7d visualização/28d na API em jan/2026)', '7 dias clique + 1 dia visualização', 'mercado', null, '2026-09-27'),
  ('cpa_alvo_formula', 'Meta de custo', 'CPA-alvo do 1º pedido = ticket médio × margem de contribuição', '≈ ticket × 40%', 'inferencia', null, '2026-09-27'),
  ('orcamento_minimo_teste', 'Orçamento', 'Orçamento diário mínimo para começar a testar', 'R$ 10–20/dia', 'mercado', 'https://ejfgv.com/blog/como-comecar-trafego-pago-r-20-dia-sem-erro/', '2026-09-27')
on conflict (chave) do nothing;

-- Cron mensal: dia 1, 10h UTC (07h de Brasília).
create or replace function public.fn_trafego_pesquisador_run()
returns text
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_key text; v_anon text; v_status int; v_body text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'fiscal_internal_key';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_key is null or v_anon is null then return 'sem segredos no vault'; end if;
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '290000');
  select status, content into v_status, v_body from http((
    'POST',
    'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/trafego-pesquisador',
    array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
    'application/json',
    '{"action":"run"}'
  )::http_request);
  return v_status::text || ' ' || left(coalesce(v_body, ''), 300);
end;
$$;
revoke all on function public.fn_trafego_pesquisador_run() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'trafego-pesquisador-mensal';
select cron.schedule('trafego-pesquisador-mensal', '0 10 1 * *', $$select public.fn_trafego_pesquisador_run();$$);
