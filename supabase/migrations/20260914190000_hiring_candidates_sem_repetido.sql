-- Contratação: currículo repetido não entra (regra do dono, 2026-09-14).
-- A edge hiring-cv-scan (intake do assistente) já recusa por telefone, e-mail ou nome; estes índices
-- travam também a tela (que grava direto em hiring_candidates) — telefone pelos últimos 11 dígitos
-- e e-mail sem caixa/espaços. Antes: remove a cópia repetida da Natalia Rosa Pires Pereira
-- (salva 2× em 2026-09-14 pelo WhatsApp; sem candidatura nem entrevista).
delete from public.hiring_candidates where id = '92737388-d84e-42ba-8a84-3af9d490320d';

create unique index if not exists hiring_candidates_phone_uniq
  on public.hiring_candidates ((right(regexp_replace(phone, '\D', '', 'g'), 11)))
  where length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10;

create unique index if not exists hiring_candidates_email_uniq
  on public.hiring_candidates ((lower(btrim(email))))
  where email is not null and btrim(email) <> '';
