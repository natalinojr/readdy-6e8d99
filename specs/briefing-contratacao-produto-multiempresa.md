# Briefing — Contratação como produto: vários clientes (organizações)

> Documento de passagem para uma nova sessão rodar o fluxo SDD com o orquestrador.
> Preparado em 2026-09-20 a partir de uma análise do código e do banco. **Nada disto foi executado.**
> Slug sugerido: `contratacao-multiempresa` → pasta `specs/2026-09-contratacao-multiempresa`, branch
> `claude/contratacao-multiempresa`.
> Spec irmã (só tela, independente): `specs/briefing-contratacao-reorganizacao-layout.md`.
> **Ordem recomendada: o layout primeiro, esta depois** (motivos no fim).

## 1. Decisões do dono (2026-09-20)

1. **Produto separado, para qualquer empresa** (não só restaurante, não só cliente do ERPOS).
2. **WhatsApp compartilhado** por enquanto: um número só (o atual, API oficial, +55 41 98411-0139) atende
   todos os clientes; o código do link (`CV-XXXX`) diz de quem é a conversa. Número próprio por cliente
   fica para o futuro — **não fechar essa porta no desenho**.
3. **Cobrança: mensalidade fixa com franquia de uso + excedente por uso — NÃO implementar agora** (módulo
   em teste). O que entra agora é só **medir** o uso por cliente, para a cobrança ter base depois.

Regra geral: risco alto (segurança de dados de terceiros + processo seletivo real em andamento). Modelo
forte (Opus) no desenho e na revisão da parte de banco/RLS; revisão adversarial obrigatória de vazamento
entre clientes.

## 2. Como está hoje (As Is, conferido em 2026-09-20)

**Não existe "cliente" no banco.** Quem tem acesso ao módulo vê tudo.

- Acesso: `public.is_hiring_admin()` = e-mail do dono (**fixo no SQL**) OU linha em
  `user_module_access (module='contratacao')`. `public.fn_hiring_team()` idem (e-mail fixo).
- Tabelas sem dono/organização (todas com 1 policy `is_hiring_admin()`):
  `hiring_candidates`, `hiring_companies`, `hiring_stages`, `hiring_settings` (**linha única id=1**),
  `hiring_jobs`, `hiring_applications`, `hiring_job_scheduling`, `hiring_scheduling_sessions`,
  `hiring_interviews`, `hiring_distances`, `hiring_candidate_events` (3 policies), `bot_channels`,
  `bot_conversations`, `bot_messages`, `wa_log`. Sem RLS de usuário (só service role): `wa_cloud_seen`,
  `wa_last_in`, `wa_lid_map`.
- Storage: bucket `curriculos`, policies `curriculos_owner_{select,insert,delete}` = `is_hiring_admin()`;
  caminho do arquivo = `<uuid>/<nome>` (sem pasta do cliente).
- Funções/gatilhos que leem configuração global: `hiring_required_fields()`, `hiring_missing_fields()`,
  `hiring_field_label()` (leem `hiring_settings id=1`), `hiring_candidates_stage_guard` (acha as fases
  nativas por `native_kind` **sem filtro** — com 2 clientes pega a fase do cliente errado),
  `hiring_candidates_log`/`hiring_*_log`, `fn_hiring_book`, `fn_hiring_free_slots`.
- E-mail do dono fixo no código: `supabase/functions/hiring-cv-scan/index.ts` (const `OWNER_EMAIL`),
  `supabase/functions/canal-publico/index.ts` (idem), `src/pages/contratacao/shared.ts`, e nas migrações
  `20260916200000_hiring_entrevistador_usuario.sql` (também inclui o dono como entrevistador em toda vaga).
- `hiring-cv-scan › intake`: a checagem de **currículo repetido lê TODOS os candidatos**
  (`select id, full_name, phone, email, created_at` sem filtro) → com 2 clientes vaza nome entre eles e
  recusa o currículo do segundo. Também há índice único de repetido
  (`20260914190000_hiring_candidates_sem_repetido.sql`) — precisa virar único **por organização**.
- Avisos presos ao dono: `canal-publico › notifyOwner` e `hiring-scheduler` usam
  `asst_settings.telegram_owner_chat_id` / `owner_user_id` (Telegram e chat do assistente pessoal).
  `whatsapp-cloud › ownerKeys` usa `asst_settings.allowed_chat_ids` para o "modo teste".
- WhatsApp: `asst_settings.wa_public` = um número. Modelos na Meta com exemplo "TBA Ipanema"
  (`_shared/wa.ts › TEMPLATES`); os textos já recebem o nome da empresa por variável — ok para compartilhar.
  `whatsapp-cloud › WHISPER_PROMPT` cita TBA Ipanema/Pontal do Paraná.
- Textos da IA com viés de restaurante/região: `hiring-cv-scan` ("relevantes para trabalhar em
  restaurante", campo `experiencia_food_service`), exemplos "Ipanema, Pontal do Paraná" no `canal-publico`.
- Front: `page.tsx` lê/grava `hiring_settings` com `id: 1`; rota `/contratacao` dentro do `AppLayout` do
  ERPOS (sidebar do PDV, selos "ABERTA", loja, relógio); acesso por `useModuleAccess`.
- LGPD: **nada** no código (sem aviso de privacidade, sem prazo de guarda, sem exclusão a pedido).
  Padrões sensíveis: pergunta de entrevista "Filhos", estado civil lido e oferecido como dado mínimo,
  nascimento obrigatório por padrão e perguntado pelo WhatsApp. Já entraram candidatos de 17/18 anos.
- Dependências frágeis: uma chave Anthropic para tudo (o crédito acabou em 2026-09-14 e parou o módulo);
  Whisper num servidor único do dono; **zero testes** no `hiring-scheduler`/`canal-publico` (os 3 erros
  da semana — 9 do telefone, "amanhã" virar hoje, "Não" virar desistência — eram lógica pura).
- Uso de IA/WhatsApp só em log (`log('INFO','lido',{input_tokens…})`); `bot_conversations.cost_usd` existe
  só para a conversa do link.

## 3. Como deve ficar (To Be)

### Fase 1 — Organização no banco (o bloqueio; vale em qualquer cenário)

- Tabelas novas: `hiring_orgs` (id, name, slug, status, created_at…) e `hiring_org_members`
  (org_id, user_id, role: `owner | recruiter | interviewer`). Usar a skill de desenho de tabelas Postgres.
- `org_id uuid not null` (FK) em todas as tabelas da lista acima que guardam dado de cliente, com índice.
  `hiring_settings` vira **uma linha por org** (PK `org_id`, acabar com `id=1`). `hiring_stages`: as 5
  nativas criadas **por org** na criação da organização. `wa_log`/`bot_conversations`: org vem do canal.
- **Migração sem perda e sem parar o processo seletivo em andamento:** criar a org "TBA / dono",
  preencher `org_id` em tudo (backfill), só então `not null`. Antes: cópia de segurança das tabelas
  (padrão já usado: schema `backup`/`hiring_backup_*`, sem acesso anon/authenticated). Migrações pelo
  caminho da memória "Migrações sem o MCP do Supabase" / MCP `apply_migration`; **nunca** `db push`/`db reset`.
- RLS: trocar `is_hiring_admin()` por funções por organização, ex. `hiring_member_of(org_id)` e
  `hiring_role_in(org_id)`; policies `using (hiring_member_of(org_id))`. Tirar o e-mail fixo de
  `is_hiring_admin`/`fn_hiring_team` (o dono vira `owner` da org dele + super-admin do produto por
  tabela/flag, não por e-mail no SQL). `fn_hiring_team(org)` = membros da org.
  Atenção às lições de `project_rls_multiloja` (não depender de "última membership"; usuário pode ter
  mais de uma org → org ativa explícita em toda chamada).
- Storage: caminho `<org_id>/<uuid>/<nome>` e policy conferindo a 1ª pasta contra a membership; mover os
  arquivos atuais (ou aceitar o caminho antigo só para a org do dono, documentado).
- Gatilhos/funções: `hiring_required_fields(org)`, `hiring_missing_fields` (usa `c.org_id`),
  `stage_guard` e `fn_hiring_book` filtrando fases **da mesma org**; `hiring_*_log` herdam o org.
- Edges: `hiring-cv-scan` (autorização por membership; `intake` recebe/deriva `org_id`; **repetido só
  dentro da org**; índice único por org), `canal-publico` (org = do `bot_channels`; config/custom fields
  da org), `hiring-scheduler` (tick e inbound sempre com org da sessão/vaga), `whatsapp-cloud`
  (roteia pelo código do link e pela conversa/sessão aberta do telefone — ver Fase 2).
- Front: tudo que grava manda `org_id` da org ativa; `hiring_settings` por org; seletor de organização só
  para quem tem mais de uma.

### Fase 2 — WhatsApp compartilhado entre clientes

- Roteamento de entrada: (1) sessão de agendamento ativa do telefone → org dela; (2) conversa aberta do
  link → org do canal; (3) mensagem com código `CV-XXXX` → org do canal. **Caso novo a decidir na spec:**
  o mesmo telefone é candidato em **dois clientes** ao mesmo tempo (duas sessões ativas) — regra sugerida:
  responder citando a empresa e desambiguar pela última mensagem enviada (`last_out_at`) ou perguntar.
- Toda mensagem ao candidato já leva o nome da empresa; conferir que **nenhuma** sai sem ele (o número é
  de um terceiro — o candidato precisa saber quem está falando). Nome de exibição do número: neutro
  (marca do produto), não "TBA"/"ERPOS".
- `wa_log` e `wa_last_in`: a janela de 24 h é por telefone (da Meta), mas a **tela** só mostra ao cliente
  as mensagens da org dele (`wa_log.org_id`; mensagem recebida sem dono identificável fica sem org e só o
  super-admin vê).
- Modelos: manter os 3 atuais (variável com o nome da empresa). Trocar os exemplos "TBA Ipanema" por
  genéricos na próxima recriação. Limite da Meta é por portfólio (TIER_250/dia hoje): registrar como risco
  e criar contagem diária por org para não um cliente consumir tudo.
- Deixar o desenho pronto para "número por cliente" depois: `wa_public` vira configuração **por org com
  fallback no número compartilhado** (coluna/linha em `hiring_orgs` ou tabela `hiring_org_whatsapp`).
- Avisos ao cliente: sair do Telegram/assistente pessoal do dono → notificação do produto (push + e-mail
  e/ou WhatsApp para os membros `owner/recruiter` da org; `toInterviewers` já é o ponto único).
  O Telegram do dono continua só para a org dele / alertas de operação.
- "Modo teste do dono" (`ownerKeys`/`is_test`): virar "membro da org testando o próprio link".

### Fase 3 — LGPD mínima e padrões sensíveis (validar com advogado antes do 1º cliente pago)

- Aviso de privacidade na 1ª resposta do link (texto curto + link para a política), registrando data do
  aceite/ciência no candidato.
- Prazo de guarda por org (padrão sugerido: 12 meses) com rotina que apaga/anonimiza candidato, arquivo no
  bucket, conversas e `wa_log`; exclusão a pedido (pela tela e por pedido no WhatsApp → `chamar_equipe`).
- Exportar os dados de um candidato.
- Tirar do **padrão** de organizações novas: pergunta "Filhos", estado civil, nascimento obrigatório
  (a IA do match já não recebe idade/estado civil/filhos — manter). Cliente pode ligar por conta própria,
  com aviso na tela. Regra para menor de 18 (aviso na ficha; não agendar sozinho sem o cliente marcar que
  a vaga aceita aprendiz).
- Termo de uso + contrato de tratamento de dados (operador × controlador): fora do código, listar como
  pendência do dono. Registrar suboperadores: Anthropic, Meta, Supabase, servidor do Whisper.

### Fase 4 — Medição de uso (sem cobrança)

- Tabela `hiring_usage` (org_id, dia, tipo, quantidade, custo_estimado_usd): currículo lido por IA,
  análise de vaga, conversa da IA (tokens), mensagem de modelo paga, minutos de áudio transcrito.
  Gravar nas Edges no mesmo ponto onde hoje só há `log()`.
- Tela simples "Uso do mês" por org (super-admin vê todas). Limites/planos/bloqueio: **não agora**.

### Fase 5 — Produto separado

- Casca própria: rota/layout sem a sidebar e os selos do PDV (ABERTA, loja, relógio), marca do produto
  (nome **a decidir pelo dono**), login próprio reaproveitando o Supabase Auth; usuário do produto **não
  precisa de loja** (`push_subscriptions.tenant_id` já aceita nulo; conferir `RotaProtegida`/`AuthContext`
  para quem não tem `user_tenants`). Domínio próprio: pendência do dono.
- Criação de organização: por convite/gerado pelo super-admin nesta fase (cadastro aberto self-service
  fica para depois). Tela "Equipe e acessos" (convidar, papel, remover).
- Papéis: `owner`/`recruiter` veem tudo da org; `interviewer` vê só as entrevistas em que está marcado e a
  ficha desses candidatos.
- Tirar o viés de setor/região: "sobre a empresa/setor" vira campo da org usado nos prompts
  (`hiring-cv-scan`, `WHISPER_PROMPT`, exemplos do `canal-publico`); `experiencia_food_service` deixa de
  ser critério fixo.
- O módulo continua acessível de dentro do ERPOS para o dono (mesmos dados, org dele).

### Fase 6 — Confiabilidade

- Testes (vitest) da lógica pura do `hiring-scheduler`/`canal-publico`: `foneKey`/`cloudTo`, datas
  ("amanhã", dia da semana, `casaPreferencia`), intenção "não" × desistência, trava do dia, `birthIso`,
  roteamento por org. Extrair para módulos testáveis sem `Deno.serve`.
- Alertas de operação para o dono: crédito da Anthropic baixo/erro 402, WhatsApp recusando envio, modelo
  reprovado/pausado, Whisper fora. Chave da Anthropic separada para o produto.

### Depois (produto, fora desta spec)

Devolutiva automática ao candidato descartado; kanban por vaga; busca/paginação no servidor (hoje carrega
2.000 candidatos); relatórios de tempo até contratar/origem/falta; aprovado → admissão; número de
WhatsApp por cliente (Tech Provider da Meta); cobrança (mensalidade + franquia + excedente).

## 4. Ordem e paralelismo

Fase 1 é pré-requisito de todas. Depois: 2 → (3 e 4 em paralelo) → 5 → 6 (os testes da Fase 6 podem
começar em paralelo com a 1, porque não dependem de banco). Entregar e verificar fase a fase; **parar para
o dono validar ao fim da Fase 1** (é a de maior risco) antes de seguir.

## 5. Restrições e cuidados

- **Há processo seletivo real em andamento** (TBA Ipanema: candidatos, entrevistas marcadas, agendador
  rodando a cada minuto, link no ar). A Fase 1 não pode parar isso: migração em passos compatíveis
  (coluna nula → backfill → Edges novas → `not null` → RLS nova), janela fora do horário 8h–20h do
  agendador, plano de volta.
- Nunca testar com candidatos reais; criar uma **segunda organização de teste** com usuário próprio e
  provar o isolamento nos dois sentidos (tela, Edge, storage, tempo real/Realtime, `wa_log`).
- Realtime: as assinaturas `postgres_changes` do front respeitam RLS — conferir que cliente A não recebe
  evento do cliente B.
- Deploy de Edge: `npx supabase functions deploy <fn> --project-ref mdghhjemzdmeuqpzuyzx --use-api
  --no-verify-jwt` para estas funções (memória "Deploy com verify_jwt misto": não misturar com funções que
  exigem JWT no mesmo comando). `_shared/wa.ts` é empacotado em 3 funções: publicar as 3 juntas.
- Working tree compartilhado: não reverter trabalho alheio, sem `git stash`, `git add` só dos próprios
  arquivos. Gate: `node scripts/check.mjs --force`; nunca `--update-baseline`.
- Regra do dono "assistente faz tudo que a tela faz": o assistente pessoal (`assistente-brain`) grava em
  `hiring_*` (salvar_curriculo, inscrever_na_vaga) — passar a mandar a org do dono.
- Segredos nunca no chat: o dono cola direto no Supabase.

## 6. Critérios de aceite (mínimos)

- Usuário da org B não vê nem altera **nada** da org A: candidatos, vagas, entrevistas, conversas,
  arquivos do bucket, histórico, configurações, fases, eventos em tempo real. Provado com teste e com
  revisão adversarial.
- O mesmo currículo pode entrar nas duas orgs; "repetido" só dentro da mesma.
- Link `CV-…` de cada org cai na org certa; agendamento da org A nunca usa vaga/fase/config da org B.
- Processo seletivo da org do dono segue funcionando igual durante e depois da migração (convite,
  agendamento, lembrete, registro de entrevista, histórico).
- Nenhum e-mail de pessoa fixo em SQL/Edge/front.
- Aviso de privacidade na 1ª resposta; exclusão de candidato apaga também arquivo, conversas e `wa_log`.
- `hiring_usage` registra por org cada leitura, análise, conversa e modelo enviado.
- tsc sem aumento; vitest verde (com os testes novos); `vite build` ok.

## 7. Pendências do dono (não bloqueiam a Fase 1)

Nome/marca e domínio do produto; texto da política de privacidade, termo de uso e contrato de tratamento
de dados (advogado); prazo de guarda padrão; nome de exibição neutro do número do WhatsApp; verificação
da empresa na Meta (sai do limite de 250/dia); preços e franquia (quando sair do teste).

## 8. Por que o layout vem antes

- Layout é só tela, baixo risco, e o resultado aparece rápido (é o que o cliente vê numa demonstração).
- Esta spec é quase toda banco/RLS/Edge; no front ela toca pouco (`org_id` nas gravações, settings por
  org, casca do produto). Fazendo o layout antes, esta encaixa a casca do produto já na navegação nova,
  em vez de reorganizar a tela duas vezes.
- As duas mexem em `src/pages/contratacao/page.tsx`: **não rodar as duas ao mesmo tempo**. Exceção: os
  testes da Fase 6 podem ir em paralelo com o layout (arquivos diferentes).
