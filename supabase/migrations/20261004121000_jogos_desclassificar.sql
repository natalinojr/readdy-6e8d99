-- Jogos: desclassificar trapaça (2026-10-04).
-- A loja passa a poder tirar uma pontuação do ranking (aba Clientes › Jogos). A linha
-- fica guardada (auditoria) e o ranking/top 3 da Edge `jogos` ignora as desclassificadas.
-- Escrita só pela Edge (service_role); o grant da tabela já existe na migração do ranking.
alter table public.game_scores add column if not exists disqualified_at timestamptz;
alter table public.game_scores add column if not exists disqualified_by uuid;
