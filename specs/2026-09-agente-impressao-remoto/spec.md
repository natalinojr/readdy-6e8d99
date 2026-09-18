---
issue: N/A
tipo: feat
slug: agente-impressao-remoto
titulo: Agente de impressão gerenciado remotamente, com token por PC
branch: claude/agente-impressao-remoto
tdd: true
tdd_integracao: fora
feature_flag: true
status: planned
criado: 2026-09-18
autor: "@natalinojr (fase inicial SDD 01, spec mecânica — contexto e problema abaixo)"
---

# Spec: Agente de impressão gerenciado remotamente, com token por PC

## Metadados

| Campo | Valor |
|-------|-------|
| Issue | N/A — sem issue tracker neste projeto (ver `AGENTS.md`) |
| Tipo | `feat` |
| Branch | `claude/agente-impressao-remoto` (convenção do projeto, sem prefixo de issue) |
| TDD | `true` para lógica de token, associação loja-agente, status; `tdd_integracao: fora` para chamadas reais a impressoras (mockadas em teste) |
| Feature flag | `true` — coluna booleana em `system_settings` por loja: `require_print_agent_token` (padrão: false para manter compatibilidade com agente antigo) |
| Pasta | `specs/2026-09-agente-impressao-remoto/` |
| Status | `planned` — ratificada pelo orquestrador em nome do dono (2026-09-18); plano (`tasks.md`) cobre só Fases 1-2 |
| Prazo | Pronto antes de seg 21/09/2026 para Paranaguá instalar versão nova |

## Por quê?

Hoje cada loja tem um PC com o agente de impressão (`agente-local/index.js`, Node, serviço do Windows) que puxa a fila `print_queue` pela Edge `print-queue-agent` usando apenas a **chave pública (anon)** + `tenant_ids` escritos no `config.json` local. Isso traz problemas de segurança, operação e escalabilidade:

1. **Segurança** — com a chave pública e o id da loja, qualquer pessoa com acesso ao PC (ou à chave pública vaza em log/screenshot) consegue ler/manipular a fila de impressão de todas as lojas configuradas.

2. **Configuração manual e frágil** — toda mudança de quais lojas o PC atende exige ir até o PC e editar manualmente o `config.json`. Já houve instância de JSON inválido por falta de vírgula, parando o agente silenciosamente.

3. **Sem controle de duplicação** — nada impede dois PCs atenderem à mesma loja. Hoje o PC de casa do dono atende a Paranaguá para testes e vai disputar tickets com o PC da loja na segunda, causando impressão duplicada ou perdida.

4. **Sem visibilidade** — não há como ver de fora (pelo ERPOS) se o agente está online, qual versão está rodando, quando foi a última impressão bem-sucedida, ou se houve erro.

**Objetivo (caminho escolhido pelo dono):** instalar o agente UMA vez por PC e daí em diante tudo remoto:

- **Token de máquina por PC** — cada PC recebe um token único, evitando que qualquer pessoa com a chave pública acesse a fila.
- **Tela "Agentes de impressão" no ERPOS** com status online/offline, versão instalada, última impressão, erros recentes.
- **Atribuição por clique** — quais lojas cada agente atende, com a regra de uma loja por agente de cada vez.
- **Configuração buscada do servidor** — agente consulta a API do ERPOS em vez de ler `config.json` local.
- **Atualização automática do agente** — pode ficar como fase final se arriscado.

**Transição sem parar ninguém:** o servidor aceita o agente antigo (anon) **E** o novo (token) até o dono ligar, por loja, a flag "Exigir token do agente"; voltar a desligar reativa o antigo.

---

## 1. As Is (Research)

> Mapeado em 2026-09-18 (`/sdd-02-research`). Evidência sempre `arquivo:linha`. Onde não achei (`CREATE TABLE` de `print_queue`/`system_settings`), registrei explicitamente — essas tabelas existem no banco mas não têm migration de criação rastreada neste repo (criadas fora do fluxo de migrations, antes do rastreamento atual).

### 1.1 Agente local (`agente-local/index.js`, 1068 linhas)

**`config.json` — campos e defaults** (defaults em `agente-local/index.js:35-54`, merge em `loadConfig()` `index.js:76-115`):
- `agent_port` (default `9876`) `index.js:36`
- `impressoras[]` (`{id, nome, ip, porta, papel}`) `index.js:37`, resolução em `findImpressora` `index.js:130-133`
- `default_timeout_ms` (default `10000`) `index.js:38`
- `supabase_url` / `supabase_anon_key` (chave **pública**, hoje é a credencial de auth do agente) `index.js:40-41`
- `tenant_id` (legado, string única) `index.js:42` — e `tenant_ids` (array, suportado hoje via `getValidTenantIds()` com fallback pro legado) `index.js:531-539`, mesma lógica duplicada em `loadConfig()` (`94-100`), `processPrintQueue()` (`550-553`), `/queue-status` (`905`) e bootstrap (`1023-1024`) — **duplicação, não centralizada**
- `poll_interval_ms` (default `3000`) `index.js:43`; `print_queue_enabled` (default `false`) `index.js:44`; `realtime_enabled` (default `true`) `index.js:45`; `realtime_debounce_ms` (default `250`) `index.js:46`; `safety_poll_interval_ms` (default `60000`) `index.js:47-51`; `realtime_watchdog_ms` (default `60000`) `index.js:53`
- `polling_enabled` — sem default no objeto, tratado como `!== false` (ausente = ligado) `index.js:693,892,1029`; hoje é **campo manual do `config.json`**, sem contraparte no banco/Edge/front (confirmado: nenhuma ocorrência em `src/` nem `supabase/`)

**Polling da fila**: `POST {supabase_url}/functions/v1/print-queue-agent` (`index.js:558,676`), auth = `Authorization: Bearer {anon_key}` + header `apikey` (`index.js:232-235`), payload `{action:'poll', tenant_id, limit:10}` por tenant em loop (`index.js:560,564-568`), disparado por `setInterval` (`index.js:698,700`).

**Realtime**: canal `` `print-jobs:${tenant_id}` ``, um por tenant válido, evento `broadcast:new_job` (`index.js:770-794`). Origem no banco: trigger `trg_print_queue_notify` → `fn_print_queue_notify()` → `realtime.send(...)` (documentado em `AI_SYSTEM_MAP.md:1139-1143`; **não** achei o `CREATE TRIGGER` correspondente nas migrations rastreadas).

**Confirmação de ticket**: `confirmTicket(queueId, status, errorMsg)` `index.js:674-686` → mesma Edge, `{action:'confirm', queue_id, status, error}`.

**Endpoints HTTP locais** (bind `127.0.0.1:{agent_port}`, `index.js:1009`): `GET /health` (`883-901`, inclui `version:'3.3.0'` hardcoded, `polling_enabled`, `realtime_connected` etc.), `GET /queue-status` (`904-915`), `GET /impressoras` (`918-930`), `POST /print` (RAW ou TICKET, legado, `935-997`), `OPTIONS *` CORS (`872-880`).

**Versão**: hardcoded `'3.3.0'` em dois pontos (`index.js:887,1011`) — **diverge** de `agente-local/package.json:3` (`"version":"1.0.0"`). Não há leitura de `package.json` para a versão.

**Retry/backoff**: nenhum retry local — cada falha de TCP reporta `confirmTicket(...,'failed',msg)` uma vez (`index.js:648,654`); retry fica todo do lado da Edge. Rede de segurança local: poll lento (`safety_poll_interval_ms`) mesmo com Realtime ligado (`index.js:688-701`); watchdog de Realtime reconecta com backoff mínimo de 30s (`index.js:808-846`).

**Instalação** (`instalar.js`, `instalar.bat`, `service-install.js`, `service-uninstall.js`): serviço Windows via `node-windows` (`package.json:14`, `^1.0.0-beta.8`) — não usa NSSM/Task Scheduler diretamente. `instalar.bat` só chama `node instalar.js` (`instalar.bat:1-3`). `instalar.js` verifica Node, roda `npm install`, chama `service-install.js` (`instalar.js:32-65`) — **não pergunta nada ao usuário** (sem `rl.question` para URL/anon key/tenant) e **não grava `config.json`** — hoje isso é 100% manual (editar o arquivo à mão antes/depois de instalar; já causou parada silenciosa por JSON inválido, conforme "Por quê?" da spec). `service-install.js` cria o serviço `'ERPOS Print Agent'` rodando `index.js` (`service-install.js:4-9,11-20`).

### 1.2 Edge Function `print-queue-agent` (`index.ts` 721 linhas, `regras.ts` 127 linhas)

**Ações aceitas**: só `action: "poll"` (`index.ts:445-656`) e `action: "confirm"` (`index.ts:659-708`); qualquer outra → `400` (`710-713`); `OPTIONS` → `204` (`422-424`). **Não existe** rota `health` na Edge (health check só existe localmente no agente).

**Auth hoje**: a função cria client admin com `SUPABASE_SERVICE_ROLE_KEY` do env (`index.ts:429-442`) e **não valida nada além do que o agente manda** — o `apikey`/`Authorization: Bearer {anon_key}` do agente só passa pelo gateway padrão do Supabase (não há checagem custom de token/tenant dentro do código da função). A autorização real de negócio está na RPC `enqueue_print_ticket` (quem cria o ticket), não em quem faz `poll`/`confirm`: exige `order_id` pertencente ao `p_tenant_id` (`supabase/migrations/20260917170000_golive_p2_authz.sql:25-29,33-38`). **Ou seja: hoje, qualquer chamador com a anon key pública consegue fazer `poll`/`confirm` de qualquer `tenant_id` que quiser** — é exatamente o risco #1 do "Por quê?" da spec, confirmado no código.

**`confirm` não filtra por tenant**: recebe só `queue_id` (`index.ts:660-694`), sem checar se o chamador tem relação com o `tenant_id` daquele ticket.

**Reclaim de tickets travados**: dentro do `poll`, `RECLAIM_STALE_MS = 2min` (`index.ts:468`), busca `status='printing' AND updated_at < now()-2min` por tenant (`471-476`); incrementa `retry_count`, decide desistência via `retryGiveUp()`, senão volta a `pending` com `updated_at` recuado (`478-498`).

**Backoff/retry** (`regras.ts`): `RETRY_DELAYS_MS=[5s,15s,30s,60s]` (linha 72), `RETRY_WINDOW_MS=15min` (73), `RETRY_MIN_ATTEMPTS=5` (74); `retryEligibleFilter()` monta filtro PostgREST (76-87, usado em `index.ts:506`); `retryGiveUp()` desiste só se `retry_count>=5 E now-created_at>=15min` (89-93), aplicado também na rota `confirm` quando `status==='failed'` (`index.ts:677-689`).

**Multi-tenant**: `poll` exige `tenant_id` no payload (`400` se ausente, `index.ts:448-453`), toda query filtra `.eq("tenant_id",...)` (`474,504`); resolução de impressora lê `system_settings.printers_config` por tenant (`537-541`).

### 1.3 Tabelas `print_queue` / `printers_config` (`system_settings`)

**`print_queue`**: nenhum `CREATE TABLE` encontrado em `supabase/migrations/*.sql` — tabela pré-existente fora do rastreamento de migrations. Colunas conhecidas por inferência de INSERT/UPDATE: `id` (uuid PK), `tenant_id`, `order_id`, `order_number`, `station_key`, `station_label`, `content_type` (default `'ticket_json'`), `payload` (jsonb), `paper_style` (default `'80mm'`), `status` (`pending|printing|printed|failed`), `retry_count`, `max_retries`, `created_at`, `updated_at`, `printed_at`, `last_error` — evidência em `supabase/migrations/enqueue_print_ticket_dedup.sql:54-64,75` e `20260917170000_golive_p2_authz.sql:63-77`. Grants (`supabase/migrations/grants_definitivos.sql`): `authenticated` SELECT/INSERT/UPDATE/DELETE (l.81), `anon` SELECT (l.152), `service_role` SELECT/INSERT/UPDATE/DELETE (l.223). **Nenhuma RLS/policy encontrada** para `print_queue`.

**`printers_config`**: não é tabela própria — é coluna jsonb de `system_settings` (cujo `CREATE TABLE` também não está nas migrations rastreadas). Estrutura esperada em runtime, lida pela Edge (`index.ts:537-559`) e pelo front: `{ impressoras: [{id, ip, porta|port, paperStyle|papel, nome}], mapaEstacoes: {station_key -> printer_id}, printTemplates }`. Referência cruzada em comentário: `supabase/migrations/20260909010000_fiscal_nfce.sql:47`.

**`polling_enabled`**: só existe no `config.json` local do agente — confirmado zero ocorrências em `src/` e `supabase/`.

### 1.4 Tela de impressoras (front)

`src/pages/configuracoes/components/ImpressorasTab.tsx` + `src/contexts/ImpressorasContext.tsx` — gerenciam **só** o mapa impressoras/estações dentro de `system_settings.printers_config` por tenant (leitura/gravação via `useSystemSettings()`, `ImpressorasContext.tsx:127,172`, auto-save debounced 2s com guard de perfil admin/gerente e de `tenant_id` — este último foi bug corrigido 2026-07-11, `AI_SYSTEM_MAP.md:1325-1341`). **Não leem nem gravam nada do `config.json` do agente** (isso é local ao PC, fora do repo front).

**Status hoje na tela**: existe só um "ping" direto na **impressora de rede** (porta 9100) via Edge `printer-ping` (`ImpressorasTab.tsx:436-467`, badge `PingBadge` `145-175`, estados `idle|testing|online|offline`) — isso testa a impressora, **não** o agente/serviço Windows. **Não existe hoje nenhum indicador de agente online/offline, versão ou heartbeat** em lugar nenhum do front (confirmado: `ImpressorasContext` não expõe nada disso, `ImpressorasContext.tsx:35-51`).

### 1.5 Admin Master

`src/pages/admin-master/{page,modals,acessos}.tsx` — grep case-insensitive por "print" não retorna nada. **Confirmado: não existe hoje nenhuma tela/rota/menção a impressoras ou agentes em Admin Master** — área livre para a nova tela.

**Rotas** (`src/router/config.tsx`): `configuracoes` (linha 102, lazy `pages/configuracoes/page.tsx` linha 27) e `admin-master` (linha 113, lazy `pages/admin-master/page.tsx` linha 45) são rotas de nível único, sem sub-rotas no router — abas internas (como `ImpressorasTab`) são geridas dentro da própria página. Não existe hoje rota tipo `configuracoes/impressoras` ou `admin-master/agentes`.

### 1.6 Assistente pessoal

Não há diretório `assistente/**` de frontend — o assistente vive só como Edge Functions `supabase/functions/assistente-*`. Sobre impressão: `assistente-brain/index.ts:597,1521` lista `print-queue-write` entre as Edges que o assistente pode invocar; `index.ts:610` dá permissão `print_queue: ['update']`; `index.ts:1568` cita `print_queue (status)` como tabela consultável por SQL. **Não existe hoje uma ação dedicada "impressora parou"** — o assistente só teria acesso genérico de leitura ao status da fila se o dono perguntasse, e **não consulta nenhuma tabela de heartbeat de agente** (porque ela não existe hoje).

### 1.7 Documentação viva (`AI_SYSTEM_MAP.md`)

Não existem seções com os títulos exatos citados no pedido; o histórico está em entradas de changelog:
- `AI_SYSTEM_MAP.md:982-989` (2026-06-28) — diagnóstico "agente offline": tickets presos em `pending`/`printing` sem avançar; causa raiz e fix do reclaim.
- `AI_SYSTEM_MAP.md:991-995` (2026-06-28) — agente v3.3.0 "auto-cura" (safety-net poll); validação via `localhost:9876/health`; rollout hoje = copiar `index.js` manualmente em cada PC e reiniciar o serviço, **sem auto-update**.
- `AI_SYSTEM_MAP.md:1121-1127` (2026-06-23) — mismatch de `impressora_id` entre app e `config.json` local.
- `AI_SYSTEM_MAP.md:1139-1143` (2026-06-18) — trigger `trg_print_queue_notify` → canal `print-jobs:<tenant>`, base do Realtime.
- `AI_SYSTEM_MAP.md:1325-1341` (2026-07-11) — vazamento de config de impressora entre lojas no `ImpressorasContext` (fix já aplicado).

### 1.8 Quantos agentes/lojas hoje

Não há tabela de registro/inventário de agentes (nenhuma tabela de heartbeat/presença encontrada). O único artefato observável é o `agente-local/config.json` local de cada PC — hoje sabidamente **2 lojas operando com agente** (Vila Leste e, a partir de 21/09, Paranaguá), cada uma com seu PC, sem nenhum inventário central. O `config.json` real inspecionado nesta pesquisa tem `tenant_ids` com 2 entradas e `polling_enabled:false` (modo Realtime-first) — não há campo de versão registrado em banco, só o hardcoded local.

### 1.9 Achados-chave para o To-Be

- **Risco de segurança confirmado**: `print-queue-agent` aceita `poll`/`confirm` de qualquer `tenant_id` só com a anon key pública, sem checagem de identidade da máquina — valida a preocupação #1 da spec.
- **Sem inventário de agentes**: não existe hoje tabela nem tela para saber quantos agentes existem, quais lojas atendem, versão, heartbeat — tudo isso precisa ser criado do zero (tabela `print_agents` + tela).
- **Config 100% manual e sem validação**: instalador não pergunta nada nem grava `config.json`; edição manual já causou parada silenciosa (JSON inválido) — motiva "config buscada do servidor".
- **`confirm` sem tenant**: ao desenhar o novo fluxo com token, o token precisa carregar/validar o(s) tenant(s) permitidos também na rota `confirm`, não só no `poll` (gap hoje).
- **Nenhuma RLS em `print_queue`**: qualquer tabela nova (`print_agents`, tokens) precisa RLS + GRANT service_role desde a criação (regra do projeto, `AGENTS.md` § Restrições padrão).
- **Rota de UI**: melhor encaixe é nova aba/página dentro de Admin Master (visão cross-tenant, hoje vazia de "print") para a lista/atribuição de agentes; a aba `ImpressorasTab` em Configurações continua sendo o mapa impressoras↔estações por loja (não muda).

---

## 2. To Be (Specify)

> Preenchido em `/sdd-03-specify` (2026-09-18), com base no §1 As Is e nos requisitos não-negociáveis do dono no pedido. Dono ausente: decisões técnicas de rotina tomadas de forma conservadora abaixo e registradas em `executions.md`; a única decisão marcada como pendente (hospedagem/assinatura do auto-update) é opcional e não bloqueia as Fases 1-2.

### Resumo

Cada PC passa a rodar o agente com um **token de máquina** (gerado uma vez, no ERPOS, mostrado uma única vez, guardado como hash no banco); uma tela nova **"Agentes de impressão"** (em Admin Master) mostra status/versão/última impressão/erro de cada agente e permite atribuir, por clique, quais lojas cada agente atende — com a garantia (no banco) de que **uma loja só pode estar atribuída a um agente por vez**. O agente deixa de depender de `tenant_id`/`anon key` fixos no `config.json` local: ele passa a buscar sua configuração (lojas atribuídas, polling, realtime) do servidor a cada ciclo, usando só `{url, token, port}` localmente. O agente antigo (anon + `tenant_ids` locais) continua funcionando por padrão; quando uma loja é atribuída a um agente com token, o servidor para de atender pedidos do agente antigo para aquela loja específica (elimina a disputa), e a flag `require_print_agent_token` por loja permite ao dono endurecer ainda mais (bloquear anon mesmo sem atribuição). Atualização automática do agente fica especificada como fase separada e não bloqueia esta entrega.

### Goals

- [ ] Emitir e armazenar um **token de máquina** por PC: gerado na tela "Agentes de impressão", exibido uma única vez, persistido no banco só como hash.
- [ ] Tela **"Agentes de impressão"** (Admin Master): lista de agentes com online/offline (heartbeat), versão, último ticket, último erro.
- [ ] **Atribuição por clique** de quais lojas cada agente atende, com exclusividade "uma loja por agente de cada vez" **garantida no banco** (constraint, não só validação de UI) e troca remota em até 2 cliques.
- [ ] Agente busca **configuração do servidor** (lojas atribuídas, polling, realtime) a cada ciclo; `config.json` local só guarda `{url, token, port}`.
- [ ] **Compatibilidade**: agente antigo (anon + `tenant_ids` locais) continua funcionando por padrão; feature flag `system_settings.require_print_agent_token` por loja (default `false`) permite ao dono endurecer; **independentemente da flag**, loja atribuída a um agente com token para de responder ao agente antigo (regra exata em RF-07).
- [ ] Revogar token na tela desliga o agente imediatamente (próxima chamada dele falha com 401).
- [ ] Nenhuma credencial em repo; tabela(s) nova(s) com RLS + `GRANT` a `service_role`; função(ões) `SECURITY DEFINER` novas com `REVOKE ALL FROM PUBLIC, anon`.
- [ ] Especificar (não implementar) **atualização automática** como fase final separável, com opções de hospedagem/assinatura marcadas como decisão pendente do dono.

### Critérios de sucesso

- [ ] `POST print-queue-agent {action:"poll"}` com token válido e loja atribuída retorna tickets normalmente; com token revogado retorna `401`; com token válido mas loja **não** atribuída àquele agente retorna `403` (verificável por teste automatizado, sem impressora real).
- [ ] Para uma loja com pelo menos uma atribuição ativa a um agente-token, `poll` com a anon key antiga **não** retorna mais tickets daquela loja (retorna lista vazia, sem erro/crash no agente antigo) — testável simulando os dois tipos de chamada na mesma spec de teste.
- [ ] Tentar atribuir a **mesma loja** a dois agentes diferentes (em paralelo ou em sequência sem desatribuir antes) falha/é automaticamente substituída de forma atômica — nunca duas linhas ativas para o mesmo `tenant_id` em `print_agent_stores` (verificável por constraint de banco + teste).
- [ ] Tela "Agentes de impressão" reflete um agente como **offline** se `last_seen_at` (heartbeat) está a mais de 2 minutos (`AGENT_ONLINE_THRESHOLD_MS = 120000`) — verificável manualmente parando o serviço do agente local e observando a tela mudar em até ~2min.
- [ ] `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` não aumenta em relação ao baseline (`scripts/baseline.json`); `node scripts/check.mjs --force` passa.
- [ ] Nenhum segredo (token em texto puro, anon key, service role key) aparece em commit/diff — conferência manual antes do PR.

### Non-goals

- Atualização automática do agente **implementada** nesta entrega (fica especificada como Fase 3, ver §2 Escopo da entrega; implementação é entrega futura separada).
- Dashboard avançado com histórico/gráficos de impressão (tela simples: lista + status + atribuição).
- Revogação/reemissão de token **via fluxo self-service do dono da loja** — revogar/reemitir é ação de admin master, não há tela para o operador da loja mexer no próprio token.
- Suporte a múltiplos tokens ativos por PC (um PC = um token; reinstalar/trocar de token = revogar o antigo e gerar um novo).
- Migrar a autenticação de usuários do ERPOS (login humano) — este token é exclusivamente de máquina/impressão.
- Mexer no agente real rodando na porta 9876 desta máquina de desenvolvimento nem em `agente-local/config.json` (dado explicitamente pelo pedido — ambiente de produção local do dono).

### Restrições

**Do `AGENTS.md` (padrão do projeto):**
- `tenant_id` (loja) em toda leitura/escrita nova; nunca query sem filtro de loja.
- Datas em horário de Brasília em qualquer exibição na tela nova.
- Tabela nova → `GRANT` explícito a `service_role` na própria migration.
- Função `SECURITY DEFINER` nova → `REVOKE ALL ... FROM PUBLIC, anon` na própria migration.
- Nunca commitar/push (entrega fica no working tree); nunca `scripts/check.mjs --update-baseline`; nunca escrever em loja real durante teste — só "Testes PDV" (`db3ca014-6c03-4c2e-97b9-9542cf825da2`) com `qa.admin`/`qa.caixa`/`qa.garcom`.
- Gate iterativo/completo de `AGENTS.md` § Gate de qualidade vale para todo código desta spec.

**Específicas desta spec (do pedido do dono, não-negociáveis):**
- **Uma loja atendida por um agente de cada vez** — garantido no banco (constraint), não só na UI.
- Token só é mostrado **uma vez** na criação; banco guarda **só o hash**; PC guarda o token em texto no `config.json` local (fora do repo, `.gitignore` já cobre isso — não versionado).
- Token tem **escopo só de impressão** da(s) loja(s) atribuída(s) — não pode ser usado para nenhuma outra leitura/escrita no ERPOS.
- Revogar token na tela **desliga o agente** (chamada seguinte falha).
- Compatibilidade obrigatória com agente antigo enquanto o dono não decidir migrar todas as lojas.
- Não tocar no agente real da porta 9876 desta máquina nem em `agente-local/config.json` durante o trabalho desta spec (ambiente do dono).
- Banco: só leitura direta (`SELECT` via `npx supabase db query --linked`) durante a spec; qualquer escrita de schema vai por migration revisável, nunca `db push`/`db reset` direto.
- Prazo: Fases 1-2 prontas antes de segunda 21/09/2026.

### Abordagens consideradas

**1) Onde validar o token novo — estender `print-queue-agent` existente vs. Edge Function nova dedicada:**

| Opção | Prós | Contras | Escolha |
|-------|------|---------|---------|
| A — Estender `print-queue-agent` (mesmo endpoint aceita anon **e** token, decide o modo pelo formato do header/payload) | Um único lugar de lógica de fila; menos Edge Functions para deployar/manter; agente antigo e novo continuam batendo no mesmo endpoint, reduzindo risco de quebrar algo já em produção | Função cresce em responsabilidade (auth de 2 modos no mesmo arquivo); precisa cuidado para não vazar comportamento de um modo para o outro | ✅ **Escolhida** |
| B — Nova Edge Function dedicada só para agentes com token (`print-queue-agent-v2` ou similar), migração completa depois | Isola a lógica nova, zero risco de regressão no fluxo antigo | Duplica lógica de fila/reclaim/backoff (ou exige extrair para módulo compartilhado, mais escopo); mais uma função para gerenciar; sem ganho real já que o objetivo é os dois modos coexistirem na mesma fila | Descartada |

**Recomendação do agente:** A — o próprio pedido do dono é "aceitar tanto agente antigo (anon) quanto agente novo (token)" no mesmo fluxo de fila; estender é mais simples e teve menos risco de regressão. Decisão tomada de forma conservadora (não é irreversível: dá para extrair depois se a função ficar grande demais).

**2) Modelo de dados para garantir "uma loja por agente por vez":**

| Opção | Prós | Contras | Escolha |
|-------|------|---------|---------|
| A — Tabela de junção `print_agent_stores(tenant_id PK, agent_id FK, assigned_at)` — `tenant_id` como **chave primária** garante no próprio schema que só existe uma linha (logo, um agente) por loja | Exclusividade garantida pelo motor do banco, não por lógica de aplicação; troca remota = 1 `UPDATE`/`UPSERT` (atende "2 cliques"); um agente pode atender várias lojas (como hoje o `tenant_ids[]`), só cada loja não pode ter 2 agentes | Precisa de uma tabela extra além de `print_agents` | ✅ **Escolhida** |
| B — Coluna `tenant_id` direto em `print_agents` (1 agente = 1 loja só) | Mais simples (uma tabela só) | Quebra o caso de uso de hoje onde 1 PC atende 2 lojas (`config.json` real tem `tenant_ids` com 2 entradas); obrigaria o dono a rodar 2 agentes por PC | Descartada |

**Recomendação do agente:** A — preserva a capacidade atual de 1 agente atender N lojas, e ainda assim garante exclusividade por loja no banco (a real exigência do dono).

**3) Regra exata de "loja atribuída a agente-token bloqueia o agente antigo":**

| Opção | Prós | Contras | Escolha |
|-------|------|---------|---------|
| A — Exclusividade automática por atribuição: assim que uma loja tem uma linha ativa em `print_agent_stores`, o `poll` anônimo (antigo) para aquela loja passa a retornar lista vazia (sem erro), **independente** do valor de `require_print_agent_token` | Resolve a disputa no momento exato em que o dono clica "atribuir" — sem precisar lembrar de ligar a flag depois; comportamento previsível: "atribuiu = exclusivo" | Menos controle fino (não dá pra "atribuir mas deixar o antigo continuar atendendo também") — mas isso nunca foi pedido | ✅ **Escolhida** |
| B — Só a flag `require_print_agent_token` decide; atribuição sozinha não bloqueia nada | Mais "explícito" (dono decide quando bloquear) | Não resolve o caso de uso crítico descrito pelo dono ("PC de casa testando Paranaguá vai disputar com o PC da loja na segunda") — nesse caso a atribuição já existiria mas a flag ainda estaria off por padrão, e a disputa aconteceria do mesmo jeito | Descartada |

**Recomendação do agente:** A — é a única opção que atende literalmente o pedido "se uma loja está atribuída a um agente com token, agentes antigos não devem mais puxar a fila dela" (citação do pedido do dono), sem depender de um passo manual extra. A flag `require_print_agent_token` continua existindo para o caso adicional de "quero forçar token mesmo sem ninguém atribuído ainda" (bloqueia todo mundo, inclusive deixa a loja sem impressão até alguém ser atribuído — uso avançado, documentado no edge case correspondente).

### Escopo da entrega

- **Decisão:** Uma spec, dividida em **3 fases** dentro dela (não specs separadas) — Fase 1 e 2 formam a entrega obrigatória do prazo de 21/09; Fase 3 (auto-update) é especificada mas não implementada agora.
  - **Fase 1 — Token, registro e Edges**: migrations (`print_agents`, `print_agent_stores`, coluna `require_print_agent_token` em `system_settings`), Edge de administração (criar/listar/revogar agente, atribuir/desatribuir loja), extensão da Edge `print-queue-agent` para aceitar token (poll/confirm/heartbeat) com a regra de exclusividade do item 3 acima.
  - **Fase 2 — Tela e agente remoto**: tela "Agentes de impressão" em Admin Master (lista, status, atribuição por clique); `agente-local/index.js` ganha modo-token (busca config do servidor, envia heartbeat) mantendo o modo-anon antigo intacto; `instalar.js` passa a perguntar URL + token na primeira instalação.
  - **Fase 3 — Atualização automática (especificação apenas)**: descrita em §2 Edge cases/decisões pendentes; **não implementada** nesta entrega — non-goal explícito.
- **Justificativa:** o dono pediu explicitamente fases 1-2 prontas até segunda e disse que a atualização automática "pode vir depois" — dividir em fases dentro da mesma spec evita reabrir o fluxo SDD inteiro para a Fase 3, mas também não bloqueia o prazo curto com uma decisão (hospedagem do pacote) que nem precisa estar fechada agora.

### Requisitos funcionais

1. **Geração de token** — na tela "Agentes de impressão", botão "Novo agente" pede um apelido (ex.: "PC Vila Leste") e gera um token aleatório de alta entropia (≥ 32 bytes/256 bits, ex. `crypto.randomBytes(32).toString('base64url')`); o token em texto puro é mostrado **uma única vez** num modal com botão copiar; o banco grava só `token_hash` (SHA-256 do token) — nunca o valor puro.
2. **Registro/config remota do agente** — o agente, ao iniciar e a cada ciclo de poll, chama a Edge com o token (header `Authorization: Bearer {token}` ou campo próprio no payload — a definir em `/sdd-04-plan` mantendo o mesmo transporte HTTP já usado) e recebe de volta: lista de `tenant_id`s atualmente atribuídos a ele, e parâmetros de polling/realtime vindos do servidor (não mais hardcoded no `config.json` local). A cada resposta, atualiza `last_seen_at` (heartbeat) no `print_agents`.
3. **Tabela `print_agents`** — campos mínimos: `id` (uuid PK), `apelido` (text), `token_hash` (text, único), `version` (text, reportada pelo agente), `last_seen_at` (timestamptz), `last_ticket_at` (timestamptz), `last_error` (text), `last_error_at` (timestamptz), `created_at`, `created_by` (uuid do usuário admin que gerou), `revoked_at` (timestamptz, null = ativo).
4. **Tabela `print_agent_stores`** — junção `tenant_id` (uuid, **PK**) × `agent_id` (uuid, FK `print_agents.id`) × `assigned_at`/`assigned_by`; `tenant_id` como PK garante no schema que uma loja tem no máximo 1 atribuição ativa. Reatribuir = `UPSERT` (2 cliques: desatribuir da Loja A + atribuir na Loja B, ou uma ação "transferir" que faz os dois passos numa RPC só).
5. **Tela "Agentes de impressão"** (Admin Master) — lista de agentes com: apelido, badge online/offline (`last_seen_at` < 2min = online), versão reportada, `last_ticket_at`, `last_error` (+ timestamp), lojas atualmente atribuídas; ação "Novo agente" (gera token, modal de exibição única); ação "Atribuir loja" (seletor de loja não atribuída ou já atribuída a outro agente, com aviso de transferência); ação "Revogar" (seta `revoked_at`, agente para de conseguir autenticar).
6. **Feature flag por loja** — `system_settings.require_print_agent_token` (boolean, default `false`); quando `true`, a Edge rejeita `poll` do modo anon para aquele `tenant_id` **mesmo sem atribuição ativa** (bloqueio total até alguém ser atribuído).
7. **Regra de exclusividade (independe da flag)** — para cada `tenant_id`: se existir linha ativa em `print_agent_stores`, o `poll` anônimo (antigo) para esse `tenant_id` retorna `200` com lista de tickets **vazia** (não erro — evita crash/loop de erro no agente antigo já instalado, que não trata `403` como caso especial); o `poll` com token só retorna tickets dos `tenant_id`s atribuídos àquele `agent_id` (outros `tenant_id`s pedidos → resposta vazia ou `403`, a decidir em `/sdd-04-plan` pelo formato mais simples de implementar sem quebrar o agente).
8. **`confirm` também valida o vínculo agente↔loja** — corrige o gap encontrado no As-Is (§1.9): a rota `confirm` da Edge passa a exigir que o `queue_id` pertença a um `tenant_id` que o token chamador tem permissão de atender (ou, no modo anon, sem mudança de comportamento).
9. **Revogação** — marcar `revoked_at`; qualquer chamada subsequente com aquele token → `401`; a tela reflete o agente como revogado/offline imediatamente (não depende de heartbeat expirar).
10. **Compatibilidade do agente local** — `agente-local/index.js` passa a suportar 2 modos, decidido pela presença de `agent_token` no `config.json`: se presente → modo-token (busca config do servidor, ignora `tenant_ids` locais); se ausente e `supabase_anon_key`+`tenant_id(s)` presentes → modo-anon (comportamento atual, inalterado). Nenhuma mudança de comportamento para quem não atualizar o `config.json`.
11. **Onboarding do instalador** — `instalar.js` passa a perguntar (via `readline`, uma vez, na primeira instalação) a URL do Supabase e o token de máquina (colado da tela), gravando um `config.json` mínimo `{supabase_url, agent_token, agent_port}`; não grava mais `tenant_id`/`anon_key` (esses somem do fluxo de instalação no modo novo).
12. **Segurança de tabelas/funções novas** — `print_agents` e `print_agent_stores`: RLS habilitado, sem policy para `anon`/`authenticated` (deny-all — toda leitura/escrita passa por Edge Function com `service_role`, mesmo padrão de `invokeWithAuth` já usado no projeto), `GRANT` explícito a `service_role`. Qualquer RPC `SECURITY DEFINER` nova (ex.: transferência atômica de loja) com `REVOKE ALL FROM PUBLIC, anon`.

### Edge cases

| Cenário | Comportamento esperado |
|---------|------------------------|
| Agente novo instalado mas ainda sem nenhuma loja atribuída | Aparece na tela como online (heartbeat funcionando), sem lojas listadas; `poll` não retorna tickets (não há `tenant_id` a consultar); nenhum erro no agente. |
| Dono tenta atribuir uma loja já atribuída a outro agente | Ação vira "transferir": UI avisa "Loja X está com o agente Y, transferir para este agente?"; confirmando, a RPC troca o `agent_id` daquela linha atomicamente (sem janela em que a loja fica sem nenhum agente ou com dois). |
| Token revogado enquanto o agente está com o processo rodando | Próxima chamada (poll ou heartbeat) recebe `401`; agente local loga o erro localmente e continua tentando no próximo ciclo (sem crashar o serviço Windows); tela mostra offline/revogado assim que a revogação é salva (não espera heartbeat expirar). |
| Ticket já em `printing` no momento em que a loja é reatribuída para outro agente | Ticket em voo não é afetado (fica em `printing` até o agente original confirmar ou o reclaim de 2min agir); só as **próximas** buscas de fila (`poll`) passam a ir para o novo agente. Pode gerar 1 ticket "órfão" temporário que o reclaim já resolve hoje — não é regressão, é o mesmo mecanismo existente. |
| Loja com `require_print_agent_token = true` mas **sem** agente-token atribuído ainda | Nenhum agente (nem antigo nem novo) consegue puxar a fila dessa loja — bloqueio total até o dono atribuir alguém; UI deve deixar isso visível (loja "sem agente" com aviso, não silencioso) — detalhar exibição em `/sdd-04-plan`. |
| PC roda agente antigo com `tenant_ids` cobrindo 2 lojas, e só 1 delas é atribuída a um agente-token | O `poll` daquele agente antigo continua funcionando normalmente para a loja **não** atribuída e passa a retornar vazio só para a loja atribuída — o loop do agente antigo já itera por `tenant_id` (`index.js:560`), então o comportamento por-loja funciona sem mudar o agente antigo. |
| Heartbeat não chega por 2min mas o agente está, na real, só lento (Realtime caiu, safety poll de 60s) | Tela mostra offline mesmo que o agente volte a funcionar logo — aceitável (é só indicador visual); não desliga nem revoga nada sozinho; volta a "online" no próximo heartbeat recebido. |
| Dois cliques rápidos de "atribuir" na mesma loja para agentes diferentes (concorrência) | A constraint de `tenant_id` como PK em `print_agent_stores` garante que só um `UPSERT` vence; o segundo clique deve tratar o conflito como "a loja já foi atribuída, recarregando" — sem duplicar nem falhar silenciosamente. |
| Auto-update (Fase 3, apenas especificado) — pacote corrompido ou versão quebrada baixada | Fora do escopo de implementação desta spec; ao especificar a Fase 3 futuramente, exigir rollback automático (manter binário anterior até validar `/health` da nova versão) — registrado aqui como requisito para quando a Fase 3 for aberta, não implementado agora. |

### Revisão da spec (Specify)

- [x] Sem TBD / placeholders vagos em §2 e §4
- [x] Goals ↔ critérios de sucesso ↔ RF ↔ US alinhados (cada goal tem RF correspondente; US cobrem os fluxos de RF 1-2-5-9-10)
- [x] Restrições e non-goals sem contradição (auto-update: non-goal de implementação, mas presente como Fase 3/edge case de especificação futura — não contraditório, só delimita "especificar ≠ implementar")
- [x] Abordagem escolhida refletida no To Be (as 3 decisões da tabela "Abordagens consideradas" estão refletidas nos RF 1, 4 e 7)
- [x] Escopo da entrega adequado — 1 spec em 3 fases internas; Fases 1-2 são o entregável real do prazo, Fase 3 é só especificação (não infla o escopo implementável)

### Confirmação de entendimento

**Agente entendeu como:** Substituir a autenticação por anon key pura do agente de impressão por um token de máquina (hash no banco, texto só localmente), com uma tela em Admin Master para o dono ver quais agentes existem, seu status/versão/erro, e atribuir por clique quais lojas cada um atende — com exclusividade garantida no banco (uma loja, um agente, por vez), migração sem quebrar quem não atualizar o PC (compatibilidade com o agente antigo, com a regra de que atribuição a um agente-token já basta para tirar o agente antigo da disputa daquela loja específica). Atualização automática do agente fica só especificada (não implementada) como Fase 3, com a decisão de hospedagem/assinatura do pacote marcada como pendente do dono. Prazo das Fases 1-2: antes de segunda 21/09/2026.

**Dev confirmou:** [x] Sim — **ratificada pelo orquestrador em nome do dono (ausente) em 2026-09-18**; Fase 3 (atualização automática) fica fora do plano — decisão de hospedagem pendente do dono. (Histórico: antes estava "Pendente — dono ausente durante esta sessão (autorizado a prosseguir de forma autônoma pelo pedido original, mas a Iron Law do Specify exige confirmação explícita antes do Plan; ver nota em `executions.md`). Nenhuma decisão aqui é irreversível o suficiente para justificar parar e não entregar a spec — a única decisão realmente pendente (hospedagem/assinatura do auto-update, Fase 3) está isolada e não bloqueia Fases 1-2. `status` do frontmatter mantido em `03-specify` (não `specified`) até o dono confirmar ou pedir ajuste.")

---

## 3. Design

Complexidade moderada (2 tabelas novas + extensão de Edge + tela + mudanças no agente local), mas sem ambiguidade de arquitetura suficiente para justificar `design.md` incremental — as decisões estruturais já estão fechadas em §2 "Abordagens consideradas". Detalhamento de contratos/schema fica para `/sdd-04-plan` (que deve invocar a skill `postgresql-table-design` antes de fechar tipos/constraints/índices de `print_agents` e `print_agent_stores`).

### Decisões

| Decisão | Alternativas | Motivo |
|---------|--------------|--------|
| Estender `print-queue-agent` para aceitar os 2 modos de auth (anon e token) no mesmo endpoint | Edge Function nova dedicada a token | Evita duplicar lógica de fila/reclaim/backoff; é o próprio pedido do dono (mesma fila, dois tipos de agente coexistindo) |
| `print_agent_stores.tenant_id` como chave primária (não `agent_id`) | Coluna `tenant_id` direto em `print_agents` (1 agente = 1 loja) | Garante exclusividade "uma loja por agente" no schema, mas preserva 1 agente atendendo N lojas (caso real de hoje, `tenant_ids[]`) |
| Exclusividade automática por atribuição (bloqueia agente antigo assim que a loja é atribuída a um agente-token, independente da flag) | Só a flag `require_print_agent_token` decide o bloqueio | É a única leitura literal do pedido do dono para o caso crítico (PC de casa vs. PC da loja em 21/09) |
| Token armazenado como hash (SHA-256) no banco, texto puro só no `config.json` local do PC | Guardar o token também em texto no banco (mesmo criptografado reversível) | Reduz superfície de vazamento — nem um dump do banco expõe tokens ativos; consistente com "nunca hardcode token" e path de segurança pedido pelo dono |
| Modo do agente local decidido pela presença de `agent_token` no `config.json` (sem flag de modo separada) | Campo explícito `"mode": "token"` \| `"anon"` no config | Menos um campo pra errar/configurar; presença do token já é sinal suficiente e inequívoco |

---

## 4. User stories

### US-01: Gerar token de máquina para um PC novo

**Como** dono do ERPOS **quero** gerar um token único na tela "Agentes de impressão" **para** instalar o agente em um PC novo sem expor a chave pública do sistema.

**Critérios de aceite:**

- [ ] Botão "Novo agente" pede um apelido e gera um token de alta entropia.
- [ ] O token em texto puro aparece **uma única vez**, num modal com botão copiar; fechar o modal ou recarregar a tela não permite ver o valor de novo.
- [ ] O banco grava só o hash do token (`token_hash`), nunca o valor puro.
- [ ] O agente aparece na lista imediatamente após criado, mesmo sem nenhuma loja atribuída ainda (status "aguardando" até o primeiro heartbeat).

### US-02: Ver status dos agentes de impressão

**Como** dono do ERPOS **quero** ver, numa tela só, todos os agentes de impressão com status online/offline, versão, última impressão e último erro **para** saber rapidamente se alguma loja está sem impressão funcionando.

**Critérios de aceite:**

- [ ] Lista mostra apelido, badge online (heartbeat < 2min) / offline, versão reportada pelo agente, timestamp da última impressão (`last_ticket_at`) e último erro com timestamp, se houver.
- [ ] Lojas atualmente atribuídas a cada agente aparecem na mesma linha/card.
- [ ] Parar o serviço do agente localmente faz o badge virar offline em até ~2 minutos, sem nenhuma ação manual na tela.

### US-03: Atribuir/transferir uma loja entre agentes

**Como** dono do ERPOS **quero** atribuir, por clique, qual agente atende cada loja — e trocar isso remotamente em poucos cliques **para** poder testar uma loja na impressora de casa e depois devolver o atendimento ao PC da loja sem ir até lá.

**Critérios de aceite:**

- [ ] Atribuir uma loja a um agente que já não a atende funciona em 1 clique + confirmação.
- [ ] Atribuir uma loja já atribuída a outro agente é tratado como "transferir" (aviso explícito, confirmação, troca atômica — nunca fica um instante sem nenhum agente responsável nem com dois).
- [ ] Depois da troca, o agente antigo daquela loja deixa de receber tickets dela no próximo `poll`; o novo agente passa a recebê-los no próximo `poll`/heartbeat dele.
- [ ] Nenhuma escrita direta no banco fora de migration/Edge — tudo via RPC/Edge com `service_role`.

### US-04: Migrar um PC do modo antigo (anon) para o modo novo (token) sem quebrar impressão

**Como** dono do ERPOS **quero** que o PC com o agente antigo continue imprimindo normalmente até eu decidir migrá-lo **para** não correr risco de parar a impressão da loja em produção durante a transição.

**Critérios de aceite:**

- [ ] Com a flag `require_print_agent_token` desligada (default) e nenhuma atribuição de agente-token para aquela loja, o agente antigo continua funcionando exatamente como hoje.
- [ ] Assim que qualquer loja é atribuída a um agente-token, o agente antigo daquela loja específica passa a receber fila vazia (sem erro/crash) — outras lojas no mesmo `config.json` antigo continuam normais.
- [ ] Ligar `require_print_agent_token` para uma loja sem agente-token atribuído bloqueia toda impressão daquela loja até alguém ser atribuído (comportamento visível na tela, não silencioso).

### US-05: Revogar um token comprometido/PC trocado

**Como** dono do ERPOS **quero** revogar o token de um agente pela tela **para** desligar o acesso imediatamente se um PC for trocado, roubado ou o token vazar.

**Critérios de aceite:**

- [ ] Ação "Revogar" na tela marca o token como revogado; próxima chamada daquele agente falha com `401`.
- [ ] A tela reflete o agente como revogado/offline imediatamente, sem esperar o heartbeat expirar.
- [ ] Revogar não afeta outras lojas/agentes — só aquele token específico.

---

## 5. Tasks

Planejado em `/sdd-04-plan` (2026-09-18): ver `tasks.md` — 10 tasks (T01–T10) em 2 fases (Fase 1 backend, Fase 2 tela + agente), `plan_depth: contracts`. Fase 3 (auto-update) fora do plano.

---

## 6. Contexto de negócio (resumido)

- **Loja Paranaguá:** go-live 21/09/2026; novo agente remoto deve estar pronto para instalação antes disso.
- **Lojas operando:** Vila Leste (desde jun/2026) + Paranaguá (a partir 21/09). Cada uma com seu PC de agente de impressão.
- **Caso de uso crítico:** Paranaguá terá múltiplos tipos de impressora (cupom, comanda, etc.); agente remoto reduz overhead de configuração e suporta escalabilidade para mais lojas.

---

## 7. Referências

- Agente atual: `agente-local/index.js`
- Edge atual: `supabase/functions/print-queue-agent/index.ts`
- Sistema de print: mencionado em `AI_SYSTEM_MAP.md` (seção "Histórico de soluções — Agente impressão Realtime")
- Feature flags: `AGENTS.md` § Feature flags; implementação em `src/contexts/SystemSettingsContext.tsx`
- Documentação viva de soluções: `AI_SYSTEM_MAP.md` ("Histórico de soluções e critérios")
