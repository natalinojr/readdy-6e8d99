# Tasks — agente-impressao-remoto (Fases 1 e 2)

> Spec: `spec.md` (§2 To Be, RF-01..12, US-01..05). **Fase 3 (auto-update) fora deste plano.** Este arquivo não repete a spec — referencia RF/US.
> Plano enxuto por pedido do dono (economia): Steps com contratos + testes; sem código completo.

## Cabeçalho do plano

| Campo | Valor |
|-------|-------|
| **plan_depth** | `contracts` |
| **Critério** | Mapa com 10 paths `criar` (≥ 8) → `contracts`. Thin slice com teste completo: T02 (regras puras de auth/exclusividade). |
| **Override do dev?** | não (orquestrador pediu "plano enxuto, sem repetir código completo" — compatível com `contracts`) |
| **TDD** | Só lógica pura: T02, T05, T07 (red → green → refactor). Edges/tela/agente/instalador: verificação por curl/manual (`tdd_integracao: fora`, impressora real fora). |
| **Ondas** | ≥ 2 fases → ondas obrigatórias pela skill; o orquestrador autorizou fazer skeleton + Fase 1 + Fase 2 nesta sessão e **um** gate de compliance (`cross`, 1 subagente sonnet, 1 rodada de ajuste). Desvio registrado em `executions.md`. |

## Global Constraints (valem para todas as tasks)

- `AGENTS.md` § Restrições padrão: `tenant_id` em toda leitura/escrita; datas exibidas em Brasília (`src/lib/dateUtils.ts`: `formatOrderDate`, `formatOrderTime`); tabela nova → `GRANT` a `service_role`; `SECURITY DEFINER` nova → `REVOKE ALL ... FROM PUBLIC, anon` (aqui também `authenticated`).
- **Nunca** commit/push/deploy/`db push`/`db reset`. Migrations são só arquivos em `supabase/migrations/` (quem aplica é o orquestrador). Deploy de Edge é do orquestrador (ver §Handoff).
- **Nunca** tocar no agente real desta máquina (porta **9876**, serviço "ERPOS Print Agent") nem em `agente-local/config.json` (arquivo **versionado** no git — ver Riscos). Teste do agente novo = cópia fora do repo, porta **9877**, loja **Testes PDV** `db3ca014-6c03-4c2e-97b9-9542cf825da2`, usuário `qa.admin` / dono.
- Token: prefixo `epa_` + 32 bytes aleatórios em base64url (43 chars) = 47 chars; banco guarda **só** `sha256` hex (64 chars minúsculos). Token em texto aparece **só** na resposta de `create` (RF-01).
- Transporte do token: header **`x-agent-token`** (mesmo `POST` JSON de hoje). Sem header = modo anon (legado) — **sem nenhuma validação de chave adicional no código**, idêntico ao comportamento atual (correção 2026-09-18, ver Análise de impacto).
- Regra de acesso (RF-06/07/08) — única fonte: `decidePoll`/`decideConfirm` em `supabase/functions/_shared/print-agents.ts` (T02).
- Online = `last_seen_at` < `AGENT_ONLINE_THRESHOLD_MS = 120000` (spec §2 Critérios).
- Gate iterativo por task (`AGENTS.md`): `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` ≤ 292 (baseline); `npx vitest run` sem falha nova; `npx vite build` limpo. Nunca `check.mjs --update-baseline`.
- Não adicionar dependência npm nova (front nem agente).

## Feature flag

- Reavaliada: **mantida**. `system_settings.require_print_agent_token boolean NOT NULL DEFAULT false` (padrão flat-boolean do projeto, `AGENTS.md` § Feature flags — seção já preenchida, sem alteração no `AGENTS.md`).
- Lida só pela Edge `print-queue-agent` (T03) e exibida/gravada pela tela via `print-agents-admin` (T04/T06). **Não** entra no `SystemSettingsContext` (nenhuma tela de loja usa; evita mexer num context com erros TS herdados).
- Exclusividade por atribuição (RF-07) **independe** da flag.

## Análise de impacto

| Mudança | Intencional | Não intencional (risco) → mitigação |
|---------|-------------|--------------------------------------|
| `print-queue-agent` com 2 modos de auth | Token por PC; exclusividade por loja | Quebrar os agentes antigos em produção (Vila Leste/Paranaguá) → modo anon mantém contrato de resposta idêntico; smoke pós-deploy nos logs (Handoff) e rollback = redeploy da versão anterior. |
| Deploy de `print-queue-agent` com `--no-verify-jwt` (token não é JWT; o gateway recusaria) | Agente-token entra sem anon key | **Correção 2026-09-18 (achado grave do orquestrador):** no modo legado (sem `x-agent-token`), a Edge **não** valida a anon key do chamador no código — comportamento idêntico ao de hoje (nenhuma checagem além do que o gateway padrão já faz). A proteção do modo legado vem só de (a) loja atribuída a agente-token → `poll` anônimo recebe fila vazia/`blocked`, e (b) flag `require_print_agent_token` ligada → anônimo recusado para aquela loja. Isso evita que agentes antigos instalados (que podem usar a chave `sb_publishable_…` nova, diferente da legacy JWT que a Edge conheceria) tomem 401 em produção. `isAnonCaller`/`PRINT_AGENT_EXTRA_ANON_KEYS` foram removidos do desenho. |
| Heartbeat gravado em `print_agents` | Status na tela | Escrita a cada poll (3s × lojas) → `shouldHeartbeat` só grava se `last_seen_at` > 30s. |
| Atribuição exclusiva | Fim da disputa PC casa × PC loja | Atribuir loja real a um agente sem PC ligado para a impressão da loja → tela avisa "loja sem agente online"; só o dono atribui. |
| `require_print_agent_token` | Endurecimento opcional | Ligar sem agente atribuído = loja sem impressão (spec edge case) → aviso visível na tela (T06). |
| Revogar agente | Desliga o PC na hora | Lojas dele ficariam bloqueadas → `fn_print_agent_revoke` apaga as atribuições (loja volta ao agente antigo, se houver) e a tela avisa antes de confirmar. |
| Agente local modo-token | Config remota; `config.json` mínimo | Regressão no modo anon → modo decidido só por `agent_token`; bloco anon intocado; teste em cópia porta 9877. |
| Realtime no modo token | Impressão instantânea igual hoje | Precisa de anon key → vem na resposta `config` (é pública). Canal `print-jobs:*` segue público (limitação conhecida, não piora). |

## Riscos registrados

- `agente-local/config.json` **está versionado** (spec §2 diz que `.gitignore` cobre — **não cobre**). Não alterar nesta spec; T09 cria `config.example.json` e a doc orienta a instalar o agente numa pasta fora do repo. Destrackear fica para o dono.
- Tabelas `system_settings`/`tenants`/`platform_owners` não têm `CREATE TABLE` rastreado; a migration só faz `ALTER`/FK — conferir nomes com `npx supabase db query --linked` (só leitura) antes de entregar T01.

## Mapa de arquivos

| Path | Ação | Responsabilidade | Task |
|------|------|------------------|------|
| `supabase/migrations/20260918120000_print_agents.sql` | criar | `print_agents`, `print_agent_stores`, flag, RPCs de atribuição/revogação | T01 |
| `supabase/functions/_shared/print-agents.ts` | criar | Regras puras: token, hash, modo, acesso, config remota, heartbeat | T02 |
| `src/test/edge/printAgents.test.ts` | criar | Testes de T02 | T02 |
| `supabase/functions/print-queue-agent/index.ts` | modificar | Auth dual, ação `config`, heartbeat, confirm com vínculo | T03 |
| `supabase/functions/print-agents-admin/index.ts` | criar | Admin: list/create/revoke/assign/unassign/set_require_token | T04 |
| `src/lib/printAgents.ts` | criar | Tipos + `agentStatus` + `storeWarning` (front) | T05 |
| `src/test/lib/printAgents.test.ts` | criar | Testes de T05 | T05 |
| `src/pages/admin-master/agentes.tsx` | criar | Aba "Agentes de impressão" | T06 |
| `src/pages/admin-master/page.tsx` | modificar | Registrar aba `agentes` | T06 |
| `agente-local/lib/modo.js` | criar | Regras puras do agente (modo, token, config efetiva, versão) | T07 |
| `src/test/agente/agenteModo.test.ts` | criar | Testes de T07 | T07 |
| `agente-local/index.js` | modificar | Modo-token (config remota, heartbeat, 401, resubscribe Realtime) | T08 |
| `agente-local/package.json` | modificar | `version` → `3.4.0` | T08 |
| `agente-local/instalar.js` | modificar | Onboarding URL + token + porta → `config.json` mínimo | T09 |
| `agente-local/config.example.json` | criar | Exemplo do config mínimo (sem segredo) | T09 |
| `agente-local/README.md` | modificar | Instalação modo-token / migração do modo antigo | T09 |
| `AI_SYSTEM_MAP.md` | modificar | Histórico de soluções + índice (edge nova, tabelas) | T10 |

## Fases e tasks

| ID | Título | Onde | Depende de | Paralelo? (com) | RF/US |
|----|--------|------|------------|-----------------|-------|
| **Fase 1 — Backend** |||||
| T01 | Migration: tabelas, flag e RPCs | migration | — | sim (T02, T05, T07) | RF-03,04,06,09,12 / US-01,03,05 |
| T02 | Regras puras de agente (TDD) | `_shared/print-agents.ts` + teste | — | sim (T01, T05, T07) | RF-01,02,06,07,08 |
| T03 | `print-queue-agent`: auth dual + config + heartbeat | `print-queue-agent/index.ts` | T01, T02 | sim (T04) | RF-02,06,07,08,09 / US-04,05 |
| T04 | Edge `print-agents-admin` | `print-agents-admin/index.ts` | T01, T02 | sim (T03) | RF-01,04,05,06,09 / US-01,03,05 |
| **Fase 2 — Tela e agente** |||||
| T05 | Status online/offline (TDD, front) | `src/lib/printAgents.ts` + teste | — | sim (T01, T02, T07) | RF-05 / US-02 |
| T06 | Aba "Agentes de impressão" no Admin Master | `admin-master/agentes.tsx`, `page.tsx` | T04, T05 | sim (T08, T09) | RF-01,05,06,09 / US-01,02,03,05 |
| T07 | Regras puras do agente local (TDD) | `agente-local/lib/modo.js` + teste | — | sim (T01, T02, T05) | RF-10,11 |
| T08 | Agente local: modo-token | `agente-local/index.js`, `package.json` | T03 (contrato), T07 | sim (T06, T09) | RF-02,10 / US-04 |
| T09 | Instalador + exemplo + README | `instalar.js`, `config.example.json`, `README.md` | T07 | sim (T06, T08) | RF-11 / US-01 |
| T10 | Verificação ponta a ponta (cópia 9877, Testes PDV) + docs | `AI_SYSTEM_MAP.md` (+ cópia fora do repo) | T01–T09 + Handoff aplicado | não | Critérios de sucesso §2 |

Grafo: `{T01,T02,T05,T07}` → `{T03,T04}` → `{T06,T08,T09}` → T10. Ondas de execução sugeridas: **A** = T01‖T02‖T05‖T07; **B** = T03‖T04; **Handoff** (orquestrador aplica migration + deploy); **C** = T06‖T08‖T09; **D** = T10.

## Progresso do Plan

| Onda | Escopo | Estado |
|------|--------|--------|
| 0 | skeleton | ✅ |
| 1 | Fase 1 (T01–T04) | ✅ detalhada |
| 2 | Fase 2 (T05–T10) | ✅ detalhada |
| final | compliance `cross` | ✅ (iter 1, sem Crítico) |

---

## Fase 1 — Backend

### T01 — Migration: tabelas, flag e RPCs

**Context pack:** RF-03/04/06/09/12; decisão "tenant_id como PK" (spec §3). Padrão de migration: `supabase/migrations/20260917230000_bloqueio_estoque_opcional.sql` (ALTER flat-boolean) e `20260918010000_tenants_backup_enabled.sql` (função + revoke/grant). Invocar skill `postgresql-table-design` antes do DDL. **Não fazer:** policy para `anon`/`authenticated`; `db push`; tocar em `print_queue`.

**Interfaces — Produces:**
- `public.print_agents(id uuid PK default gen_random_uuid(), apelido text NOT NULL CHECK (char_length(btrim(apelido)) BETWEEN 1 AND 60), token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'), version text, last_seen_at timestamptz, last_ticket_at timestamptz, last_error text, last_error_at timestamptz, created_at timestamptz NOT NULL default now(), created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, revoked_at timestamptz)`.
- `public.print_agent_stores(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE, agent_id uuid NOT NULL REFERENCES public.print_agents(id) ON DELETE CASCADE, assigned_at timestamptz NOT NULL default now(), assigned_by uuid)` + `CREATE INDEX print_agent_stores_agent_id_idx ON print_agent_stores(agent_id)`.
- `ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS require_print_agent_token boolean NOT NULL DEFAULT false`.
- `fn_print_agent_assign(p_tenant_id uuid, p_agent_id uuid, p_expected_agent_id uuid, p_user_id uuid) RETURNS boolean` — `RAISE EXCEPTION 'agente_invalido'` se agente não existe ou revogado. Se `p_expected_agent_id IS NULL`: `INSERT … ON CONFLICT (tenant_id) DO NOTHING` → true se inseriu. Se não nulo: `UPDATE … SET agent_id=p_agent_id, assigned_at=now(), assigned_by=p_user_id WHERE tenant_id=p_tenant_id AND agent_id=p_expected_agent_id` → true se 1 linha. `false` = conflito (tela recarrega).
- `fn_print_agent_unassign(p_tenant_id uuid, p_expected_agent_id uuid) RETURNS boolean` — `DELETE … WHERE tenant_id AND agent_id=expected`.
- `fn_print_agent_revoke(p_agent_id uuid) RETURNS integer` — `UPDATE print_agents SET revoked_at=now() WHERE id AND revoked_at IS NULL`; `DELETE FROM print_agent_stores WHERE agent_id` ; retorna nº de lojas liberadas.
- Todas as 3 funções: `LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'`; `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role`.
- RLS `ENABLE` nas 2 tabelas, sem policy; `REVOKE ALL … FROM anon, authenticated`; `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role`.

**Steps:**
1. Conferir (só leitura) colunas-chave: `npx supabase db query --linked "select column_name from information_schema.columns where table_name in ('system_settings','tenants','platform_owners') and column_name in ('tenant_id','id','user_id')"` → espera `tenant_id` (system_settings), `id` (tenants), `user_id` (platform_owners).
2. Escrever o arquivo com cabeçalho-comentário (propósito, RF, "aplicar via orquestrador") + DDL das tabelas/índice conforme Produces.
3. Acrescentar flag, RLS, grants e as 3 funções conforme Produces (idempotente: `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`).
4. Revisão estática: `grep -c "REVOKE ALL ON FUNCTION" <arquivo>` → `3`; `grep -c "GRANT EXECUTE" <arquivo>` → `3`; `grep -ci "create policy" <arquivo>` → `0`.

**DoD:** arquivo existe e passa no step 4; nada aplicado no banco; T10 valida a constraint de exclusividade (critério §2 #3) após o Handoff.

### T02 — Regras puras de agente (TDD, thin slice)

**Context pack:** RF-01/02/06/07/08; Global Constraints (token, header, regra única). Padrão de módulo puro + teste Node: `supabase/functions/print-queue-agent/regras.ts` + `src/test/edge/printQueueRegras.test.ts` (import dinâmico por `pathToFileURL`, `// @vitest-environment node`). Só Web APIs (`crypto.getRandomValues`, `crypto.subtle`, `Headers`) — roda em Deno e Node 20. **Não fazer:** importar supabase-js ou `Deno.*` neste arquivo.

**Interfaces — Produces** (`supabase/functions/_shared/print-agents.ts`):
```ts
export const AGENT_TOKEN_PREFIX = "epa_";
export const HEARTBEAT_MIN_INTERVAL_MS = 30_000;
export const AGENT_CONFIG_DEFAULTS: { print_queue_enabled: true; polling_enabled: true; poll_interval_ms: 3000; realtime_enabled: true; realtime_debounce_ms: 250; safety_poll_interval_ms: 60000; realtime_watchdog_ms: 60000; config_refresh_ms: 60000 };
export type AgentAuth = { mode: "anon" } | { mode: "token"; token: string } | { mode: "token-invalid" };
export type AgentRemoteConfig = typeof AGENT_CONFIG_DEFAULTS & { agent_id: string; apelido: string; tenant_ids: string[]; supabase_anon_key: string };
export function generateAgentToken(): string;                        // "epa_" + base64url(32 bytes), 47 chars
export function isWellFormedAgentToken(t: unknown): t is string;     // /^epa_[A-Za-z0-9_-]{43}$/
export async function hashAgentToken(token: string): Promise<string>;// sha256 hex minúsculo (64)
export function readAgentAuth(headers: Headers): AgentAuth;          // x-agent-token ausente/vazio → anon; malformado → token-invalid
export function decidePoll(i: { mode: "anon" | "token"; callerAgentId: string | null; assignedAgentId: string | null; requireToken: boolean }): "serve" | "empty_assigned" | "empty_require_token" | "forbidden";
export function decideConfirm(i: { mode: "anon" | "token"; callerAgentId: string | null; assignedAgentId: string | null }): "ok" | "forbidden";
export function buildAgentConfig(i: { agentId: string; apelido: string; tenantIds: string[]; anonKey: string }): AgentRemoteConfig; // tenant_ids únicos e ordenados
export function shouldHeartbeat(lastSeenIso: string | null, nowMs: number): boolean; // null ou ≥ 30s
export function sanitizeVersion(v: unknown): string | null;          // /^[0-9A-Za-z.+-]{1,32}$/ senão null
export function truncateError(s: unknown, max?: number): string | null; // default 500
```
Regras de `decidePoll`: token → `serve` se `assignedAgentId === callerAgentId` (não nulo), senão `forbidden`. anon → `empty_assigned` se `assignedAgentId` não nulo; senão `empty_require_token` se `requireToken`; senão `serve`. `decideConfirm`: anon → `ok` (sem mudança, RF-08); token → `ok` só se `assignedAgentId === callerAgentId`.

**Steps:**
1. RED: escrever `src/test/edge/printAgents.test.ts` cobrindo: formato/unicidade de 2 tokens gerados; `hashAgentToken("epa_x")` = sha256 hex conhecido (calcular com `node -e "console.log(require('crypto').createHash('sha256').update('epa_x').digest('hex'))"`) e hash ≠ token; `readAgentAuth` (sem header, vazio, malformado, válido); tabela-verdade completa de `decidePoll` (token atribuído/outro/nenhum; anon atribuído/flag/livre; anon atribuído+flag → `empty_assigned`) e `decideConfirm`; `buildAgentConfig` dedup/ordem + defaults; `shouldHeartbeat` (null, 29s, 30s); `sanitizeVersion`; `truncateError`.
2. `npx vitest run src/test/edge/printAgents.test.ts` → FAIL (módulo inexistente).
3. GREEN: implementar o mínimo em `_shared/print-agents.ts` conforme Produces.
4. `npx vitest run src/test/edge/printAgents.test.ts` → PASS; refactor sem mudar testes.
5. Gate iterativo (Global Constraints).

**DoD:** testes verdes; arquivo sem dependência de Deno; gate ok.

### T03 — `print-queue-agent`: auth dual, ação `config`, heartbeat, confirm com vínculo

**Context pack:** RF-02/06/07/08/09; US-04/05. Arquivo atual: `serve(...)` em `index.ts:420-721` (poll `445-656`, confirm `659-708`, `corsHeaders` l.5-9, tipos `PollPayload`/`ConfirmPayload` l.408-419). **Não fazer:** mudar formato de resposta do modo anon quando `serve`; mexer em reclaim/backoff/formatação ESC/POS; aceitar `config` em modo anon.

**Interfaces — Consumes:** de T02 todas as funções acima; de T01 as tabelas `print_agents`, `print_agent_stores`, coluna `system_settings.require_print_agent_token`.
**Produces (contrato HTTP usado por T08/T10):**
- Headers CORS: acrescentar `x-agent-token, apikey` em `Access-Control-Allow-Headers`.
- Env: `SUPABASE_ANON_KEY` (só para devolver no `config` de agentes-token, RF-02; não é mais usada para validar chamador).
- Entrada: `readAgentAuth(req.headers)`. `token-invalid` (header presente mas malformado) → **401** `{success:false,error:"token_invalido"}`. `token` (header bem formado) → `select id, apelido, last_seen_at, revoked_at from print_agents where token_hash = hashAgentToken(token)`; não achou ou `revoked_at` → 401 idem. `anon` (header ausente/vazio) → **nenhuma checagem adicional no código** — comportamento idêntico ao de hoje (`index.ts:429-453` atual não valida `apikey`/`Authorization` além do que o gateway padrão do Supabase já faz); segue direto para `poll`/`confirm`. A proteção do modo legado é só via RF-06 (flag) e RF-07 (exclusividade por atribuição), nunca por comparação de chave.
- Heartbeat (modo token, toda ação): se `shouldHeartbeat(last_seen_at, now)` → `update print_agents set last_seen_at=now(), version=coalesce(sanitizeVersion(body.version), version)`.
- `action:"config"` (só token): 200 `{success:true, config: buildAgentConfig({agentId, apelido, tenantIds: <tenant_id de print_agent_stores where agent_id>, anonKey: SUPABASE_ANON_KEY})}`. Anon → 400 `"Acao invalida"` (como hoje).
- `action:"poll"`: carregar `assignedAgentId` (`print_agent_stores` por `tenant_id`) e `requireToken` (`system_settings` por `tenant_id`, default false se sem linha); `decidePoll` → `serve` = fluxo atual; `empty_*` → 200 `{success:true,tickets:[],blocked:"assigned"|"require_token"}`; `forbidden` → **403** `{success:false,error:"loja_nao_atribuida"}`.
- `action:"confirm"`: buscar `tenant_id` do `queue_id` (junto do select existente); `decideConfirm` → `forbidden` = 403 idem; `ok` = fluxo atual. Modo token: `printed` → `last_ticket_at=now()`; `failed` → `last_error=truncateError(error)`, `last_error_at=now()`.

**Steps:**
1. Adicionar imports de `../_shared/print-agents.ts`, headers CORS e tipo `ConfigPayload {action:"config"; version?: string}`; `version?: string` em `PollPayload`/`ConfirmPayload`.
2. Inserir bloco de autenticação logo após criar `supabaseAdmin` (antes de `if (body.action === "poll")`), produzindo `auth: {mode, agentId, apelido}` e heartbeat, conforme Produces.
3. Inserir `action:"config"` antes do poll.
4. No poll, após validar `tenant_id`: consulta de atribuição + flag e `decidePoll` com retornos do Produces.
5. No confirm: incluir `tenant_id` no select; aplicar `decideConfirm`; gravar `last_ticket_at`/`last_error` no modo token.
6. Checagem estática: `deno check supabase/functions/print-queue-agent/index.ts` se Deno instalado; senão `npx esbuild supabase/functions/print-queue-agent/index.ts --bundle=false --format=esm --outfile=NUL` → sem erro de sintaxe. Gate iterativo (tsc do app não cobre Deno; conferir que a contagem não mudou).

**DoD:** contrato acima implementado; fluxo anon `serve` byte-idêntico ao de hoje; verificação funcional em T10 (curl dos 4 casos: token atribuído 200, revogado 401, não atribuído 403, anon em loja atribuída 200 vazio).

### T04 — Edge `print-agents-admin`

**Context pack:** RF-01/04/05/06/09; US-01/03/05. Padrão: `supabase/functions/admin-manage-user/index.ts` (estrutura `serve`, CORS, respostas JSON) + `_shared/tenant-auth.ts` (`authenticate`, `isPlatformOwner`). **Correção 2026-09-18:** deploy com `--no-verify-jwt` (verify_jwt **false**), igual ao padrão confirmado nas outras edges de Admin Master (`admin-manage-user`, `admin-create-user`, `bootstrap-admin` — todas `verify_jwt:false` em produção, `npx supabase functions list --project-ref mdghhjemzdmeuqpzuyzx -o json`); a auth real é manual, via `authenticate(req, admin)` + `isPlatformOwner` dentro do código (mesmo padrão de `admin-manage-user/index.ts`). **Não fazer:** devolver `token_hash`; aceitar service role sem usuário para `create`; escrever direto em `print_agent_stores` (só pelas RPCs).

**Interfaces — Consumes:** T02 `generateAgentToken`, `hashAgentToken`; T01 tabelas e RPCs.
**Produces (contrato usado por T06):** `POST {action, ...}`; 401 sem login; 403 `{error:"forbidden"}` se `!isPlatformOwner`.
- `list` → `{agents: PrintAgentRow[], stores: PrintAgentStoreRow[]}` onde `PrintAgentRow = {id, apelido, version, last_seen_at, last_ticket_at, last_error, last_error_at, created_at, revoked_at, tenant_ids: string[]}` (ordem `created_at desc`) e `PrintAgentStoreRow = {tenant_id, name, agent_id: string|null, require_print_agent_token: boolean}` (todas as `tenants`, ordem `name`).
- `create {apelido}` → valida 1..60 chars → `{agent:{id, apelido}, token}` (token só aqui; grava `token_hash`, `created_by`).
- `revoke {agent_id}` → rpc `fn_print_agent_revoke` → `{released: number}`.
- `assign {tenant_id, agent_id, expected_agent_id: string|null}` → rpc `fn_print_agent_assign` → `false` = **409** `{error:"conflito"}`; exceção `agente_invalido` = 400.
- `unassign {tenant_id, expected_agent_id}` → rpc → `false` = 409.
- `set_require_token {tenant_id, value: boolean}` → `update system_settings set require_print_agent_token=value where tenant_id` ; 0 linhas → 404 `{error:"loja_sem_configuracao"}`.
- Ação desconhecida → 400. Todos os ids validados como UUID (regex) → 400.

**Steps:**
1. Criar `supabase/functions/print-agents-admin/index.ts` com CORS, client service role, `authenticate` + `isPlatformOwner`, dispatcher por `action`.
2. Implementar `list` e `create` conforme Produces.
3. Implementar `revoke`, `assign`, `unassign`, `set_require_token` conforme Produces.
4. Checagem estática como T03 step 6; `grep -n "token_hash" supabase/functions/print-agents-admin/index.ts` → só no insert de `create` (nunca em select).

**DoD:** contrato implementado; verificação funcional em T10.

---

## Fase 2 — Tela e agente

### T05 — Status online/offline (TDD, front)

**Context pack:** RF-05, US-02, spec §2 Critério #4. Padrão de lib pura + teste: `src/lib/dateUtils.ts`, `src/test/lib/*`. **Não fazer:** chamar rede aqui.

**Interfaces — Produces** (`src/lib/printAgents.ts`):
```ts
export const AGENT_ONLINE_THRESHOLD_MS = 120_000;
export type AgentStatus = 'revogado' | 'aguardando' | 'online' | 'offline';
export interface PrintAgentRow { id: string; apelido: string; version: string | null; last_seen_at: string | null; last_ticket_at: string | null; last_error: string | null; last_error_at: string | null; created_at: string; revoked_at: string | null; tenant_ids: string[] }
export interface PrintAgentStoreRow { tenant_id: string; name: string; agent_id: string | null; require_print_agent_token: boolean }
export function agentStatus(a: Pick<PrintAgentRow, 'revoked_at' | 'last_seen_at'>, nowMs: number): AgentStatus; // revogado > aguardando(last_seen null) > online(< 120000 ms) > offline
export function storeWarning(s: PrintAgentStoreRow, agents: PrintAgentRow[], nowMs: number): 'bloqueada_sem_agente' | 'agente_offline' | null;
// bloqueada_sem_agente: agent_id null && require_print_agent_token; agente_offline: agent_id aponta para agente com status ≠ online; senão null
```

**Steps:**
1. RED: `src/test/lib/printAgents.test.ts` — `agentStatus` nos 4 estados + limite exato (119999 online, 120000 offline); `storeWarning` nos 3 retornos.
2. `npx vitest run src/test/lib/printAgents.test.ts` → FAIL.
3. GREEN: implementar conforme Produces.
4. Mesmo comando → PASS; gate iterativo.

**DoD:** testes verdes; tipos reutilizados por T06.

### T06 — Aba "Agentes de impressão" no Admin Master

**Context pack:** RF-01/05/06/09; US-01/02/03/05. Página: `src/pages/admin-master/page.tsx` (`Tab` + `Segmented` l.688-693, render por aba l.696-709; acesso só `isMaster`). Componente-irmão de referência para estilo/modais: `src/pages/admin-master/acessos.tsx`. Chamada: `invokeWithAuth('print-agents-admin', { body })` (`src/lib/supabase.ts:418`). Datas: `formatOrderDate`/`formatOrderTime` (Brasília). **Não fazer:** ler tabelas direto via `supabase.from`; guardar o token em estado após fechar o modal; tocar outras abas.

**Interfaces — Consumes:** T04 contrato (`list/create/revoke/assign/unassign/set_require_token`, 409 = conflito); T05 `agentStatus`, `storeWarning`, `PrintAgentRow`, `PrintAgentStoreRow`.
**Produces:** `export function AgentesTab(): JSX.Element` (autocontido: carrega `list` ao montar e a cada 30 s; botão "Atualizar").

**Comportamento (UI):**
- Card por agente: apelido, badge `agentStatus` (verde online / cinza aguardando / vermelho offline / riscado revogado), versão, "Última impressão" e "Último erro" (texto + data/hora Brasília), chips das lojas atribuídas com "×" (unassign com `expected_agent_id`).
- "Novo agente": pede apelido → `create` → modal com o token, botão Copiar e aviso "não será mostrado de novo"; ao fechar, descarta o token e recarrega.
- "Atribuir loja" (por agente não revogado): select com todas as lojas; se a loja já tem outro agente mostra "Loja X está com o agente Y — transferir?" e envia `expected_agent_id` = dono atual (ou `null` se livre). 409 → toast "A loja mudou de agente, recarregando" + `list`.
- "Revogar": confirmação listando as lojas que serão liberadas → `revoke`.
- Seção "Lojas": linha por loja com agente atual, toggle "Exigir token do agente" (`set_require_token`) e aviso de `storeWarning` (`bloqueada_sem_agente` em vermelho: "Sem agente: esta loja não imprime"; `agente_offline` em amarelo).

**Steps:**
1. Criar `agentes.tsx` com `AgentesTab`, estado `{agents, stores, loading}`, `load()` via `list` e polling 30 s (limpar no unmount).
2. Implementar lista de agentes + badges + datas (Consumes T05).
3. Implementar "Novo agente" + modal de exibição única.
4. Implementar "Atribuir/transferir", remoção de chip e tratamento 409.
5. Implementar "Revogar" e a seção "Lojas" com toggle e avisos.
6. Em `page.tsx`: acrescentar `'agentes'` ao tipo `Tab`, opção `{ id: 'agentes', label: 'Agentes de impressão', icon: 'ri-printer-line' }` e `{tab === 'agentes' && <AgentesTab />}`.
7. Gate iterativo (tsc ≤ 292, vitest, `npx vite build`).

**DoD:** aba renderiza com o dono; gate ok; verificação funcional em T10.

### T07 — Regras puras do agente local (TDD)

**Context pack:** RF-10/11; decisão "modo pela presença de `agent_token`" (spec §3). Agente é CommonJS Node, sem TS (`agente-local/index.js`). Teste em Vitest via `createRequire` (sem nova dependência). **Não fazer:** I/O, rede ou `fs` neste módulo.

**Interfaces — Produces** (`agente-local/lib/modo.js`, `module.exports = {...}`):
```js
AGENT_VERSION            // '3.4.0'
resolveMode(cfg)         // 'token' se typeof cfg.agent_token === 'string' && trim() !== ''; 'anon' se supabase_anon_key && (tenant_ids?.length || tenant_id); senão 'none'
isWellFormedAgentToken(t)// /^epa_[A-Za-z0-9_-]{43}$/
isValidSupabaseUrl(u)    // /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/
buildMinimalConfig({supabase_url, agent_token, agent_port}) // {supabase_url (sem '/' final), agent_token, agent_port: Number||9876, print_queue_enabled: true}; lança Error('url_invalida'|'token_invalido'|'porta_invalida' (1024..65535))
applyRemoteConfig(localCfg, remote) // novo objeto: localCfg + campos de remote (tenant_ids, supabase_anon_key, polling_enabled, poll_interval_ms, realtime_enabled, realtime_debounce_ms, safety_poll_interval_ms, realtime_watchdog_ms, print_queue_enabled, config_refresh_ms); descarta tenant_id legado; preserva agent_port, agent_token, supabase_url, impressoras, default_timeout_ms
tenantsChanged(prev, next)   // true se conjuntos diferem (ordem irrelevante)
```

**Steps:**
1. RED: `src/test/agente/agenteModo.test.ts` (`// @vitest-environment node`; `const m = createRequire(import.meta.url)(resolve(__dirname,'../../../agente-local/lib/modo.js'))`) cobrindo cada função: 3 modos (inclusive token presente + anon presente → token), token bom/ruim, URL boa/ruim, `buildMinimalConfig` feliz + 3 erros, `applyRemoteConfig` (ignora `tenant_ids` local, preserva porta/impressoras, remove `tenant_id`), `tenantsChanged`.
2. `npx vitest run src/test/agente/agenteModo.test.ts` → FAIL.
3. GREEN: implementar `modo.js`.
4. Mesmo comando → PASS; gate iterativo.

**DoD:** testes verdes; módulo sem dependência.

### T08 — Agente local: modo-token

**Context pack:** RF-02/10; US-04; Edge cases "token revogado com processo rodando" e "sem loja atribuída". Pontos do `index.js`: defaults `35-54`, `loadConfig` `76-115`, `callEdge` com headers `225-240`, `getValidTenantIds` `531-539`, `processPrintQueue` `545-..`, `confirmTicket` `674-686`, polling `688-701`, Realtime `760-846`, `/health` `883-901`, `/queue-status` `904-915`, bootstrap `1009-1060`, versão hardcoded `887,1011`. **Não fazer:** mudar o comportamento do modo anon; rodar/instalar o serviço; editar `agente-local/config.json`.

**Interfaces — Consumes:** T07 (`AGENT_VERSION`, `resolveMode`, `applyRemoteConfig`, `tenantsChanged`); contrato HTTP de T03 (`x-agent-token`; `config` → `{config}`; 401 `token_invalido`; 403 `loja_nao_atribuida`; poll pode trazer `blocked`).
**Produces:** `/health` passa a incluir `mode`, `agent_id` (token) e `version: AGENT_VERSION`; log de boot `ERPOS Print Agent v3.4.0 (modo token|anon)`.

**Regras:**
- Modo decidido uma vez no boot (`resolveMode`); `none` → loga "config.json incompleto" e mantém só o servidor HTTP local.
- Token: headers `x-agent-token` + (quando já conhecido) `apikey`/`Authorization` com `supabase_anon_key` vindo do servidor; todas as chamadas levam `version: AGENT_VERSION`.
- Boot token: `fetchRemoteConfig()` → `applyRemoteConfig`; repetir a cada `config_refresh_ms` (60 s). Se `tenantsChanged` → refazer canais Realtime (remover os antigos, assinar os novos). 0 lojas → não faz poll, loga "aguardando atribuição" uma vez.
- 401 em qualquer chamada → loga "token inválido ou revogado", zera `tenant_ids` efetivos (para de pollar) e tenta de novo só no próximo refresh; nunca `process.exit`.
- 403 no poll de uma loja → loga e pula a loja até o próximo refresh.
- `getValidTenantIds()` passa a ser a única fonte de lojas (substituir as cópias em `99`, `550`, `905`, `1023`).
- Versão: trocar `'3.3.0'` pelos usos de `AGENT_VERSION`; `package.json` `version` → `3.4.0`.

**Steps:**
1. `require('./lib/modo')`; trocar versões hardcoded; `package.json` → `3.4.0`.
2. Centralizar lojas em `getValidTenantIds()` (4 pontos citados).
3. Headers e `version` no `callEdge`/poll/confirm conforme Regras.
4. `fetchRemoteConfig()` + refresh periódico + tratamento 401/403.
5. Resubscribe de Realtime quando `tenantsChanged`; `/health` com `mode`/`agent_id`.
6. Sintaxe: `node --check agente-local/index.js` → sem saída. Smoke modo anon em cópia (sem rede real): copiar `agente-local` para `%TEMP%\\agente-anon` com config de exemplo anon apontando para URL inválida e `agent_port: 9878`, `node index.js` por 5 s → log de boot "modo anon" e `curl http://127.0.0.1:9878/health` com `mode:"anon"`; encerrar o processo.

**DoD:** `node --check` ok; smoke anon ok; teste real do modo token em T10.

### T09 — Instalador + exemplo + README

**Context pack:** RF-11; US-01. `instalar.js` hoje: verifica Node, `npm install`, `service-install.js` (`32-65`), já cria `readline` (`rl`). **Não fazer:** gravar anon key/tenant; sobrescrever config existente sem backup; rodar o instalador nesta máquina.

**Interfaces — Consumes:** T07 `buildMinimalConfig`, `isValidSupabaseUrl`, `isWellFormedAgentToken`, `resolveMode`.
**Produces:** fluxo do instalador — antes de `[1/3]`: se `config.json` ausente ou `resolveMode(cfg) !== 'token'`, perguntar URL (default `https://mdghhjemzdmeuqpzuyzx.supabase.co`), token (repergunta até `isWellFormedAgentToken`) e porta (default 9876); se havia `config.json`, copiar para `config.json.bak-<timestamp>` antes; gravar `JSON.stringify(buildMinimalConfig(...), null, 2)`. Se já está em modo token, perguntar "Manter configuração atual? (S/n)".

**Steps:**
1. Implementar a etapa `[0/3] Configuração` em `instalar.js` conforme Produces (usar `rl.question` promisificado).
2. Criar `config.example.json` = saída de `buildMinimalConfig` com token fictício `epa_` + 43×`x` e comentário no README (JSON não aceita comentário).
3. README: seções "Instalação (modo token)", "Migrar PC do modo antigo" (gerar agente no Admin Master → rodar `instalar.bat` → colar token → atribuir loja; o antigo para de receber a loja no mesmo instante) e aviso "instale fora da pasta do repositório".
4. `node --check agente-local/instalar.js` → sem saída.

**DoD:** sintaxe ok; README cobre instalação e migração; nenhum segredo real no exemplo.

### T10 — Verificação ponta a ponta + documentação

**Context pack:** Critérios de sucesso §2; US-01..05. Pré-requisito: Handoff aplicado pelo orquestrador. Loja **Testes PDV** apenas; lojas reais **não** são atribuídas. **Não fazer:** parar/alterar o agente da porta 9876; ligar a flag de loja real; commit.

**Steps:**
1. Tela (preview local, dono logado): criar agente "QA 9877" → copiar token (US-01); conferir no banco `select token_hash from print_agents where apelido='QA 9877'` = 64 hex e ≠ token.
2. Copiar `agente-local` para `%TEMP%\\agente-qa` (fora do repo), `config.json` = `buildMinimalConfig` com porta **9877**; subir impressora fake: `node -e "require('net').createServer(s=>s.on('data',d=>console.log('RX',d.length))).listen(9101,'127.0.0.1')"`; apontar a impressora da Testes PDV para `127.0.0.1:9101` (anotar valor anterior para restaurar).
3. `node index.js` na cópia → `/health` em 9877 com `mode:"token"`; tela mostra "online", versão 3.4.0, sem lojas (edge case "sem loja").
4. Atribuir Testes PDV ao "QA 9877"; enfileirar ticket de teste na Testes PDV → impressora fake recebe bytes; `last_ticket_at` atualiza na tela.
5. curl (critérios §2 #1/#2): anon `poll` Testes PDV → 200 `tickets:[]`, `blocked:"assigned"`; token `poll` de loja não atribuída → 403; criar 2º agente e tentar `assign` com `expected_agent_id:null` na mesma loja → 409 (critério #3).
6. Revogar "QA 9877" → próximo poll 401, agente segue vivo e loga; tela mostra revogado na hora (US-05).
7. Parar a cópia com outro agente válido e observar "offline" em ≤ ~2 min (critério #4).
8. Limpeza: restaurar impressora da Testes PDV, apagar agentes QA (`delete from print_agents where apelido like 'QA %'` — só esses), encerrar processos 9877/9101; conferir `curl http://127.0.0.1:9876/health` inalterado.
9. `AI_SYSTEM_MAP.md`: entrada no "Histórico de soluções e critérios" (token `x-agent-token`, `--no-verify-jwt` separado, regra de exclusividade, heartbeat 30 s, `config.json` versionado) + índice (edge `print-agents-admin`, tabelas novas).
10. Gate completo: `node scripts/check.mjs --force` → exit 0.

**DoD:** todos os critérios §2 evidenciados em `executions.md`; ambiente de teste limpo; gate completo ok.

## Handoff ao orquestrador (entre ondas B e C)

1. Aplicar `supabase/migrations/20260918120000_print_agents.sql` (fluxo sem MCP, sem `db push`).
2. Deploy **separado** (flags conferidas antes via `npx supabase functions list --project-ref mdghhjemzdmeuqpzuyzx -o json`, mantendo a flag atual de cada função): `print-agents-admin` com `--no-verify-jwt` (igual às demais edges de Admin Master); `print-queue-agent` com `--no-verify-jwt` (já é a flag atual dela hoje).
3. Logo após o deploy da `print-queue-agent`: conferir nos logs pollings dos agentes reais com 200 (Vila Leste/Paranaguá) — como o modo legado não passou a validar nenhuma chave nova, não deve haver 401 novo para o agente antigo; se aparecer, é regressão (não config de secret) → rollback = redeploy da versão anterior da função.
