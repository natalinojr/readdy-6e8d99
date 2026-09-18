# Executions: Backup diário automático do banco (plano Free sem backup)

> Spec: [spec.md](./spec.md) · Tasks: ainda não gerado (`/sdd-04-plan` não executado nesta sessão)

**Branch:** `claude/backup-diario` (ainda não criada — nenhuma alteração de código feita nesta sessão, só `spec.md`/`executions.md`)

Legenda: `pending` · `in_progress` · `blocked` · `done` · `skipped`

## Resumo

| Fase | Status | Início | Fim | Responsável |
|------|--------|--------|-----|-------------|
| `/sdd-02-research` | done | 2026-09-17 | 2026-09-17 | Claude (autônomo, dono ausente) |
| `/sdd-03-specify` | done | 2026-09-17 | 2026-09-17 | Claude (autônomo, dono ausente) |
| Ratificação da spec | done | 2026-09-17 | 2026-09-17 | Orquestrador (em nome do dono, ausente) |
| `/sdd-04-plan` | done (via `tasks.md` já detalhado nesta pasta) | 2026-09-17 | 2026-09-17 | Claude (autônomo, dono ausente) |
| Execução (Executor) | done | 2026-09-17 | 2026-09-17 | Claude (Executor, pedido explícito do dono: "de forma ENXUTA") |

---

## Contexto desta execução

O dono pediu para rodar `sdd-02-research` e depois `sdd-03-specify` na spec ativa (`specs/2026-09-backup-diario/spec.md`) de forma autônoma, respondendo perguntas de rotina com decisões conservadoras e parando só se houvesse decisão de arquitetura irreversível, risco de perda de dados ou dado sensível que exigisse o dono. A spec já existia com um rascunho completo (RF, testes, AC) escrito antes desta sessão, mas fora do formato padrão do template SDD (`specs/templates/spec-template.md`) e sem nenhuma validação real das suposições técnicas.

## Research — o que foi validado por execução real (não só lido)

1. **`npx supabase db dump --linked --project-ref mdghhjemzdmeuqpzuyzx -s public -f <arquivo>`** (schema-only, sem tocar dados) → falhou com `LegacyDockerRunError: docker: command not found (podman also not found)`. Confirma que `db dump` **não** funciona sem Docker/Podman nesta máquina — não é suposição, é comportamento reproduzido.
2. **`which pg_dump` / `which psql`** → nenhum dos dois instalado na máquina. Confirma a suposição do pedido.
3. **`npx supabase db query --linked --project-ref mdghhjemzdmeuqpzuyzx -f arquivo.sql`** → funciona sem Docker (usa Management API via HTTP, não conexão Postgres direta). Testado com:
   - Query de metadados (`pg_stat_user_tables`, `pg_database_size`, contagem de schemas) → OK, resposta JSON rápida.
   - Extração completa da maior tabela do banco (`fin_bank_statement_imports`, 6.079 linhas, ~12 MB em disco) via `select * from fin_bank_statement_imports` → **~9s**, JSON de ~10,1 MB, válido e sem truncamento. Não há indício de limite de payload dentro dessa faixa (não testei acima de ~10 MB porque não há tabela maior no banco hoje).
4. **Tamanho real do banco:** 78 MB total (bate com estimativa do pedido de ~77 MB); 184 tabelas em `public`; 27 em `auth`; 2 em `net` (incluindo `net._http_response`, 360 linhas/536 kB); 10 em `realtime` (incluindo partições diárias `realtime.messages_YYYY_MM_DD`). `auth.users` tem 28 linhas.
5. **Achado de segurança durante o teste:** `supabase db dump --dry-run` imprime no console um script bash com `PGHOST`/`PGUSER`/`PGPASSWORD` em texto puro (credenciais de um role `cli_login_postgres` temporário e escopado, mas ainda assim sensível). Esse output apareceu no meu terminal durante o teste. Não foi commitado, não foi salvo em nenhum arquivo do repositório, e não é reproduzido no `spec.md` (só menciono que aconteceu, como alerta operacional). Como `db dump` foi descartado como abordagem, esse caminho não será usado na implementação — registrando aqui só para o dono saber que esse comando específico (`db dump --dry-run`) vaza credencial temporária no stdout e não deve ser usado casualmente por quem for debugar isso depois.
6. Nenhum arquivo de dados real do banco foi salvo em disco fora de arquivos temporários (`/tmp`) que já foram apagados ao final da sessão de pesquisa; nada disso entrou no repositório.

## Decisões de rotina tomadas de forma autônoma (conservadoras, documentadas)

| # | Decisão | Por que não precisou parar para o dono |
|---|---------|------------------------------------------|
| 1 | Formato de exportação: **JSON por tabela** via `supabase db query` (não SQL INSERT gerado, não pg_dump) | Reversível; escolha técnica de implementação, não de negócio; validada como a única opção que funciona de ponta a ponta sem Docker nesta pesquisa |
| 2 | Escopo = **schema `public` inteiro** (184 tabelas), sem exclusão adicional de tabelas "de lixo" dentro de `public` (nenhuma foi identificada como transiente) | O pedido já definia "schema public inteiro"; `net`/`realtime` (schemas fora de `public`) já ficam fora por definição de escopo, sem precisar de uma decisão de exclusão explícita |
| 3 | Schema `auth` (incluindo `auth.users`) **fora do backup de dados**; documentar recriação de usuário no `RESTORE.md` | Essa decisão **já vinha indicada no próprio pedido do dono** ("recomendação: não incluir, e documentar como recriar usuários") — não é uma decisão nova minha, só formalizei/confirmei no spec |
| 4 | Alertas de sucesso/falha ficam só em log local nesta entrega (sem Telegram/WhatsApp) | Non-goal conservador: `AGENTS.md` já restringe disparo real de mensagem fora de teste supervisionado; adicionar alerta externo seria escopo novo não pedido |
| 5 | Registro da tarefa no Agendador de Tarefas do Windows fica só como **script entregável**, nunca executado pelo agente | Já explicitamente exigido pelo pedido original ("script de registro que o DONO executa") |
| 6 | Escopo da entrega = **uma spec só**, sem dividir em fases/sub-specs | Componentes fortemente acoplados (mesmo fluxo diário, mesmo formato de dado); não identifiquei ≥2 subsistemas independentes |
| 7 | `tdd_integracao: fora` para chamadas reais à CLI Supabase/rede (mockadas em teste automatizado) | Consistente com `AGENTS.md` (escrita real só na loja "Testes PDV"/teste manual supervisionado; nada de chamada de rede real em CI) |

Nenhuma dessas decisões foi julgada irreversível, de risco de perda de dados ou envolvendo dado sensível **novo** (a única candidata a isso — `auth.users` — já vinha resolvida no pedido do dono).

## Pendências para o dono (não bloqueiam, mas pedem revisão)

- **Confirmação formal da §2 do `spec.md`** ("Confirmação de entendimento") — o dono estava ausente; a spec está com `status: specified`, mas a confirmação humana no sentido estrito do processo SDD (Iron Law do `/sdd-03-specify`) não aconteceu. Recomendo revisar antes de rodar `/sdd-04-plan`.
- Validar se 03:30 (Brasília) continua sendo o horário certo depois que Paranaguá entrar em produção em 18/09 (pode ter rotina noturna própria).
- Confirmar se realmente não quer nenhum alerta externo (Telegram/WhatsApp) em caso de falha do backup — hoje ficou como non-goal, só log local.

## Ratificação da spec (2026-09-17)

**Spec ratificada pelo orquestrador — sem decisão irreversível/sensível pendente.** O orquestrador, agindo em nome do dono (ausente), ratificou `spec.md` em 2026-09-17 e autorizou `/sdd-04-plan`, com as decisões de rotina: `plan_depth` pela árvore de decisão da skill; TDD só na lógica pura (montagem das consultas/paginação, manifest/checksum, retenção, ordem de restauração por FK); fechamento no working tree sem commit; sem worktree; sem feature flag. Restrições adicionais reforçadas para o plano: nunca escrever no banco de produção (backup só leitura; restauração só documentada e testável fora de produção — teste automatizado com fixtures/mocks); não registrar a tarefa do Agendador automaticamente; nenhuma credencial em arquivo do repo; saída fora do repo configurável por variável de ambiente; extração sequencial e paginada. As pendências listadas acima (horário, alerta externo) continuam como pontos de revisão do dono, não bloqueiam.

## Próximo passo sugerido (histórico — pré-ratificação)

`/sdd-04-plan` — mas só depois que o dono revisar/confirmar o `spec.md` (em especial §2, Abordagens consideradas e Restrições).

---

## Execução (2026-09-17) — implementação enxuta pelo Executor

O dono pediu explicitamente para implementar "de forma ENXUTA", usando `spec.md` e `tasks.md` como referência de requisitos e casos de borda, **sem seguir cada passo cerimonial** do plano (T01–T10, contratos `.d.mts`, arquivos de teste espelhando verbatim os Steps do plano). Diferenças conscientes em relação ao `tasks.md`:

- **Sem `.d.mts` ao lado dos módulos.** Verificado que `tsconfig.app.json` só inclui `"src"` e `"vite-env.d.ts"` — `scripts/**` nunca é checado pelo `tsc` do projeto. Os testes importam os `.mjs` por caminho montado em tempo de execução (`pathToFileURL` + `import(/* @vite-ignore */ ...)`), o mesmo padrão já usado em `src/test/edge/fiscalValores.test.ts` para módulos fora de `src/` — evita qualquer erro `TS7016` sem precisar duplicar tipagem. (O portão apontou isso uma vez durante a execução; corrigido nos 5 arquivos de teste.)
- **9 módulos em `scripts/backup/lib/`** em vez de 9 pares `.mjs`+`.d.mts` (config, queries, manifest, retention, restore, cli, files, runBackup, cleanup) — mesma responsabilidade da tabela de arquivos do `tasks.md`, só sem o par de tipos.
- **5 arquivos de teste** em `src/test/backup/` (`config`, `queries`, `manifest`, `retention`, `restore` — um por módulo de lógica pura), em vez de 3 arquivos gigantes (`backupUtils`, `backupIntegration`, `restoreValidation`) com T01–T08 acumulados. Cobrem os mesmos casos de borda descritos no `tasks.md` (config recusa pasta dentro do repo, `assertReadOnlySql` rejeita escrita, paginação por PK, checksum determinístico, retenção não remove o mais recente, ordem topológica por FK, recusa de produção) com fixtures — nenhum teste chama a CLI real.
- **README único** (`scripts/backup/README.md`, pedido explícito do dono) em vez de `docs/RESTORE.md` + `docs/BACKUP-MAINTENANCE.md` separados — cobre agendamento, verificação, restauração passo a passo e o que não está no backup.
- **`registrar-agendamento.ps1`** (nome pedido pelo dono) simplificado: a tarefa do Agendador chama só `node scripts/backup-diario.mjs`, porque esse script já roda verify (antes de promover a pasta do dia) e cleanup (depois de promover) internamente — não precisa orquestrar 3 comandos separados nem descobrir "qual pasta é a de hoje" em PowerShell.
- **IO com mocks, sem TDD estrito** em `cli.mjs`/`files.mjs`/`runBackup.mjs`/`cleanup.mjs` (consistente com `tdd_integracao: fora` do `tasks.md`) — validados de verdade pela execução real (abaixo), não por teste automatizado com mock de processo.

### Bug real encontrado e corrigido durante a validação end-to-end

`listTablesSql()` devolvia `pk_columns` como **array literal do Postgres** (`"{id}"`), não JSON — `rowsToTableInfo` tentava `JSON.parse("{id}")` e quebrava (`Expected property name or '}'`) assim que a extração real começava a rodar. Corrigido trocando `array_agg(...)` por `to_jsonb(array_agg(...))` na query. Só foi pego porque o backup foi rodado de verdade contra produção (só leitura) — nenhum teste unitário com fixture cobria o formato exato que a CLI devolve para um `text[]`. Registrado como lição também em `AI_SYSTEM_MAP.md`.

### Backup real executado (só leitura) e apagado depois

`ERPOS_BACKUP_DIR` apontado para uma pasta temporária do scratchpad da sessão; rodado `node scripts/backup-diario.mjs` contra o projeto de produção (`mdghhjemzdmeuqpzuyzx`), **sem nenhuma escrita** (todo SQL passa por `assertReadOnlySql`):

- **Tempo total:** 27min31s (184 tabelas, sequencial, cada `npx supabase db query` novo tem overhead de alguns segundos de spawn — dominante no tempo total, não o tamanho dos dados).
- **Tamanho total:** 7,0 MB compactado (dentro da faixa de 5–15 MB/dia estimada na spec).
- **Tabelas:** 184/184 extraídas sem erro; manifest `status: "complete"`.
- **Maiores arquivos:** `tenants.json.gz` (1,64 MB — colunas grandes tipo config/base64, mesmo com só 10 linhas), `fin_ifood_entries.json.gz` (1,12 MB), `fin_bank_statement_imports.json.gz` (855 KB), `fiscal_inbound_documents.json.gz` (603 KB), `order_items.json.gz` (322 KB).
- **`verify-integrity.mjs --backup`**: **passou** (todas as contagens e checksums batem com o manifest).
- **`restore-from-backup.mjs` (dry-run, 3 tabelas `tenants,orders,order_items`):** gerou os `.sql` na ordem correta por FK (`tenants` → `orders` → `order_items`).
- **`restore-from-backup.mjs --apply` contra o project-ref de produção:** recusado como esperado (`restauração recusada: alvo é o projeto de produção`), sem enviar nenhum SQL.
- **`cleanup-backups.mjs --dry-run`:** 0 pastas removidas (backup do dia, dentro da retenção) — correto.
- A pasta de teste (`.../scratchpad/backup-teste`, com dados reais de produção) foi **apagada** ao final da validação.

### Portão de qualidade

- `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` → **287** (baseline 292/287 conforme scripts/baseline.json no momento — sem regressão, contagem igual ou menor).
- `npx vitest run` → **400 passed (400)**, incluindo os **59 testes novos** em `src/test/backup/*.test.ts` (5 arquivos: config, queries, manifest, retention, restore).
- `scripts/check.mjs` **não foi rodado** (instrução explícita do pedido — portão desta execução foi só tsc + vitest, não o `check.mjs --force` completo).

### Entregáveis (caminhos)

```
scripts/backup-diario.mjs
scripts/cleanup-backups.mjs
scripts/verify-integrity.mjs
scripts/restore-from-backup.mjs
scripts/backup/lib/{config,queries,manifest,retention,restore,cli,files,runBackup,cleanup}.mjs
scripts/backup/registrar-agendamento.ps1   (NÃO executado pelo agente)
scripts/backup/README.md
src/test/backup/{config,queries,manifest,retention,restore}.test.ts
```

### Pendências para o dono

- **Rodar `powershell -ExecutionPolicy Bypass -File .\scripts\backup\registrar-agendamento.ps1`** para ativar o agendamento diário (03:30) — o agente nunca executa isso.
- **Confirmar o e-mail/pendências já registradas antes** (horário 03:30 após Paranaguá entrar em produção; ausência de alerta externo em caso de falha — só log local).
- Revisar `scripts/backup/README.md` e, quando quiser testar uma restauração de verdade, seguir o passo a passo lá (projeto Supabase novo, nunca a loja "Testes PDV" porque ela mora no mesmo projeto de produção).

---

## Execução (2026-09-18) — escolha de lojas por loja no Admin Master (Executor)

Pedido do dono: no Admin Master, escolher quais lojas entram no backup diário. **Padrão: nenhuma loja ligada** — o dono liga manualmente cada loja que quer no backup local.

### O que mudou

- **Migration `supabase/migrations/20260918010000_tenants_backup_enabled.sql`** (NÃO aplicada — aplicar via `mcp__supabase__apply_migration`, é decisão do dono):
  coluna `tenants.backup_enabled boolean not null default false`; RPC `fn_admin_set_tenant_backup(p_tenant_id, p_enabled)` (mesma checagem `fn_assert_platform_admin()` das demais `fn_admin_*`, `REVOKE` de `public`/`anon`, `GRANT` a `authenticated`); `fn_admin_get_tenants()` recriada para incluir `backup_enabled` na resposta.
- **Admin Master** (`src/pages/admin-master/page.tsx`, `acessos.tsx`, `modals.tsx`): interruptor "Backup diário" no painel de detalhe de cada loja (mesmo lugar do bloco de Manutenção), com o texto de ajuda pedido; chama `fn_admin_set_tenant_backup` e recarrega a lista de lojas. Já restrito por ser a mesma tela do Admin Master (só `ADMIN_MASTER_EMAIL`).
- **`scripts/backup/lib/queries.mjs`**: `listTenantsForBackupSql()` (lê `tenants` com `backup_enabled = true`); `tenantWhereSql(tenantIds)` (monta `where tenant_id = any(array[...]::uuid[])`, valida formato UUID contra injeção); `tableHasTenantId(table)` (usa a lista de colunas que `listTablesSql()` já trazia); `countsSql` reescrita como `UNION ALL` de `select count(*)` por tabela (antes usava `query_to_xml`/`format` — não dava pra variar o `where` por tabela nesse formato) aceitando tanto nomes simples (sem filtro, comportamento antigo preservado) quanto `{name, tenantIds}`; `buildPageSql` ganhou um 5º parâmetro opcional `tenantIds`.
- **`scripts/backup/lib/runBackup.mjs`**: antes de listar tabelas, lê as lojas com `backup_enabled`. **Vazio → não exporta nada**, loga `"Nenhuma loja com backup ligado no Admin Master — nada feito"` e retorna `{status: "skipped", reason: "sem-lojas"}` (== exit code 0 em `backup-diario.mjs`, que já trata `skipped` como sucesso). Com lojas: tabelas com `tenant_id` (via `tableHasTenantId`) são extraídas e contadas só dessas lojas; tabelas sem `tenant_id` saem inteiras (users, tenants, etc. — pequenas, necessárias pra restaurar). Cada entrada do manifest ganhou `filtered: boolean`.
- **`scripts/backup/lib/manifest.mjs`**: `buildManifest` ganhou o campo `tenants` (lojas incluídas, `[]` = sem filtro/backup antigo anterior a esta feature).
- **`scripts/verify-integrity.mjs --live`**: agora lê `manifest.tenants` e usa `t.filtered` por tabela pra montar a mesma contagem filtrada antes de comparar com o manifest — sem isso, toda loja fora do backup apareceria como "divergência" contra o banco ao vivo.
- **`scripts/backup/README.md`**: nova seção explicando a escolha por loja no Admin Master e o comportamento com nenhuma loja ligada.

### Por que a migration não foi aplicada

Regra do Executor: migração fica escrita no repositório e a aplicação em produção é decisão do dono/orquestrador. `fn_admin_set_tenant_backup` e a recriação de `fn_admin_get_tenants` precisam rodar antes do toggle funcionar na tela — sem a migration aplicada, o botão do Admin Master vai falhar com "function does not exist".

### TDD (lógica pura)

`src/test/backup/queries.test.ts` — `countsSql`/`buildPageSql` com e sem `tenantIds`, `tenantWhereSql` (com ids, sem ids, id inválido rejeitado), `listTenantsForBackupSql`, `tableHasTenantId`.
`src/test/backup/manifest.test.ts` — `buildManifest` registra `tenants` e `filtered` por tabela.
`src/test/backup/runBackup.test.ts` (novo) — sem loja ligada: `status: "skipped"`, `reason: "sem-lojas"`, nenhuma pasta criada, nenhuma outra query disparada; com loja ligada: `manifest.tenants` e `filtered: true` na tabela com `tenant_id`.

### Portão de qualidade

- `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` → **287** (limite ≤287, sem regressão).
- `npx vitest run` → **411 passed (40 arquivos)**, incluindo os testes novos/ajustados de backup.
- `scripts/check.mjs` não foi rodado (instrução explícita do pedido para esta execução).

### Entregáveis (caminhos)

```
supabase/migrations/20260918010000_tenants_backup_enabled.sql   (NÃO aplicada)
src/pages/admin-master/page.tsx
src/pages/admin-master/acessos.tsx
src/pages/admin-master/modals.tsx
scripts/backup/lib/queries.mjs
scripts/backup/lib/runBackup.mjs
scripts/backup/lib/manifest.mjs
scripts/verify-integrity.mjs
scripts/backup/README.md
src/test/backup/queries.test.ts
src/test/backup/manifest.test.ts
src/test/backup/runBackup.test.ts   (novo)
```

### Pendências para o dono

- **Aplicar a migration** `20260918010000_tenants_backup_enabled.sql` (via MCP do Supabase, já que `db push` falha neste repo).
- Depois de aplicada, ir no Admin Master → Lojas → abrir uma loja e ligar "Backup diário" para as lojas desejadas (padrão é tudo desligado — nada será exportado até o dono ligar pelo menos uma).
- Não foi rodado o backup real de novo (já validado na execução anterior); só os testes automatizados desta vez.
