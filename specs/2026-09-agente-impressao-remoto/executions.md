# Execuções — Agente de impressão gerenciado remotamente (slug: agente-impressao-remoto)

## Fase 01 — New (2026-09-18)

**Invocação:** `/sdd-01-new` com argumentos:
- `--tipo feat`
- `--slug agente-impressao-remoto`
- `--titulo "Agente de impressão gerenciado remotamente, com token por PC"`
- `--tdd true`
- `--feature-flag true`
- `--issue-tracker N/A`
- `--branch-create false`

**Artefato:** Criação de pasta `specs/2026-09-agente-impressao-remoto/` e `spec.md` com frontmatter + contexto/problema.

**Contexto registrado na spec:**
- Problema atual: segurança (chave pública vaza), config manual frágil, sem controle de duplicação, sem visibilidade de status.
- Objetivo: token por PC, tela de status, atribuição por clique, config remota, atualização automática (fase futura).
- Transição: servidor aceita agente antigo (anon) + novo (token) até flag `require_print_agent_token` ligar por loja.
- Prazo: antes de seg 21/09/2026 para Paranaguá.

**Status:** Estrutura inicial criada. Aguardando `/sdd-02-research`.

---

## Fase 02 — Research (2026-09-18)

**Invocação:** `/sdd-02-research` (dono ausente; execução autônoma conforme instrução do dono no pedido — decisões conservadoras, registrar aqui, só parar para decisão de arquitetura/segurança irreversível).

**Método:** 2 sub-agentes de exploração em paralelo (`Explore`) mapeando: (1) `agente-local/index.js` + instaladores + Edge `print-queue-agent`/`regras.ts` + schema `print_queue`/`printers_config` + `polling_enabled`; (2) tela `ImpressorasTab`/`ImpressorasContext` + Admin Master + assistente + rotas + `AI_SYSTEM_MAP.md`. Toda a saída consolidada em `spec.md § 1. As Is` com evidência `arquivo:linha`.

**Achados-chave (detalhe completo em `spec.md § 1.9`):**
1. **Risco de segurança confirmado no código**: a Edge `print-queue-agent` aceita `poll`/`confirm` de **qualquer** `tenant_id` só com a anon key pública — não há checagem de identidade de máquina hoje (`supabase/functions/print-queue-agent/index.ts:429-453,660-694`). Isso valida a preocupação #1 do "Por quê?" da spec.
2. **Sem inventário de agentes**: nenhuma tabela de heartbeat/presença existe hoje; não há como saber de fora quantos agentes/PCs existem, versão ou último erro. Confirmado por busca ampla — zero resultado.
3. **Instalador não coleta nem grava config**: `instalar.js`/`instalar.bat` só instalam o serviço Windows (via `node-windows`); a edição do `config.json` (URL, anon key, tenant_id(s)) é 100% manual, já causou parada silenciosa por JSON inválido.
4. **`print_queue` e `system_settings` não têm `CREATE TABLE` rastreado** nas migrations — tabelas pré-existentes fora do fluxo de migrations deste repo. Qualquer alteração de schema nelas precisa ser feita via migration nova (ALTER), sem assumir controle total da criação original. Nenhuma RLS encontrada em `print_queue` hoje.
5. **Rota `confirm` da Edge não filtra por tenant** — gap a fechar no desenho do token (token precisa valer também no `confirm`, não só no `poll`).
6. **Admin Master está 100% livre de qualquer coisa relacionada a print/agente** — confirmado por grep; é o local natural para a nova tela "Agentes de impressão" (visão cross-tenant). A aba `ImpressorasTab` em Configurações continua sendo o mapa impressoras↔estações por loja e não precisa mudar de propósito.
7. **Versão do agente é hardcoded** (`'3.3.0'` em `agente-local/index.js:887,1011`) e diverge do `package.json` (`1.0.0`) — usar a constante hardcoded como fonte de versão a reportar ao servidor (mais confiável que o `package.json`, que está desatualizado).

**Decisões conservadoras tomadas nesta fase (sem bloquear, registradas para o dono revisar quando puder):**
- Nenhuma decisão de arquitetura irreversível foi necessária só para research — mapeamento é factual. Decisões de desenho (nome de tabela, mecanismo exato de disputa de loja, hospedagem do auto-update) ficam para `/sdd-03-specify`, marcadas como pendentes se aplicável.

**Status:** `spec.md § 1. As Is` preenchido e revisado com evidência. Frontmatter atualizado para `status: 02-research`. Seguindo para `/sdd-03-specify` na mesma sessão (autorizado pelo pedido do dono).

---

## Fase 03 — Specify (2026-09-18)

**Invocação:** `/sdd-03-specify` (dono ausente; execução autônoma, mesma autorização da Fase 02).

**Preenchido em `spec.md`:** §2 To Be completo (Resumo, Goals, Critérios de sucesso, Non-goals, Restrições, Abordagens consideradas com 3 decisões comparadas e recomendação, Escopo da entrega, Requisitos funcionais 1-12, Edge cases, Auto-revisão, Confirmação de entendimento) + §3 Design (tabela de decisões) + §4 User stories (US-01 a US-05, com critérios de aceite).

**Decisões de design tomadas de forma conservadora (nenhuma julgada irreversível o bastante para travar a entrega — todas reversíveis em fase futura se o dono discordar):**
1. Estender a Edge `print-queue-agent` existente para aceitar os 2 modos de auth (anon + token) em vez de criar uma Edge nova — evita duplicar lógica de fila/reclaim, e é a leitura mais direta do pedido do dono.
2. Modelo de dados: `print_agent_stores` com `tenant_id` como **chave primária** (não `agent_id`) — garante no schema que uma loja só pode ter um agente por vez, preservando a capacidade de um agente atender várias lojas (como o `tenant_ids[]` de hoje).
3. **Regra exata de exclusividade** (pedida explicitamente pelo dono como "defina a regra exata"): assim que uma loja tem uma atribuição ativa a um agente-token em `print_agent_stores`, o `poll` do agente antigo (anon) para aquela loja específica passa a retornar lista vazia — **independente** do valor da flag `require_print_agent_token`. A flag continua existindo para o caso adicional de bloquear tudo mesmo sem atribuição (endurecimento manual). Essa combinação resolve o caso de uso crítico descrito (PC de casa testando Paranaguá vs. PC da loja na segunda) sem exigir que o dono lembre de ligar a flag.
4. Token: gerado com alta entropia, mostrado uma única vez, armazenado como hash (SHA-256) — nunca texto puro no banco.
5. Modo do agente local (`agente-local/index.js`) decidido pela presença de `agent_token` no `config.json` — sem campo de modo explícito separado, reduz chance de config inconsistente.
6. Tela "Agentes de impressão" alocada em **Admin Master** (confirmado no research como área livre, cross-tenant) — `ImpressorasTab` em Configurações não muda de propósito (continua sendo o mapa impressoras↔estações por loja).

**Decisão pendente registrada (não bloqueia Fases 1-2, isolada como Fase 3 do escopo):** hospedagem/assinatura do pacote de atualização automática do agente — opções não avaliadas em profundidade nesta fase porque o dono pediu explicitamente que isso pudesse vir depois; será decisão do dono quando a Fase 3 for aberta (candidatos típicos a comparar então: GitHub Releases + checksum, bucket privado do Supabase Storage servindo build assinado, ou continuar manual). Nenhuma arquitetura das Fases 1-2 depende dessa escolha.

**Gate não cumprido intencionalmente (Iron Law do Specify):** a skill `sdd-03-specify` exige confirmação explícita do dev antes de `status: specified` e antes de qualquer `/sdd-04-plan`. Como o dono está ausente nesta sessão e o pedido original autorizou research + specify **em sequência** (não plan), o `status` do frontmatter foi mantido em `03-specify` (não `specified`), e a seção "Confirmação de entendimento" em `spec.md §2` está marcada como pendente. **Não segui para `/sdd-04-plan`** — nenhuma das decisões acima pareceu irreversível ou de segurança a ponto de exigir parar sem entregar a spec (todas são reversíveis/ajustáveis no Plan se o dono pedir), então completei research + specify integralmente conforme pedido, mas paro aqui aguardando a confirmação do dono antes do Plan.

**Status:** `spec.md` com §1, §2, §3, §4 completos. Pronta para revisão do dono. Próximo passo (quando o dono confirmar ou pedir ajustes): `/sdd-04-plan`.

---

## Ratificação da spec (2026-09-18)

Spec ratificada pelo orquestrador; Fase 3 (atualização automática) fica fora deste plano — decisão de hospedagem pendente do dono. Confirmação de entendimento (`spec.md §2`) marcada como feita pelo orquestrador, em nome do dono (ausente). Frontmatter → `status: specified`. Liberado `/sdd-04-plan` só para Fases 1 e 2.

---

## Fase 04 — Plan (2026-09-18)

**Invocação:** `/sdd-04-plan` pelo orquestrador (dono ausente). Escopo: só Fases 1 e 2 da spec.

- **plan_depth:** `contracts` (10 paths `criar` ≥ 8). Plano enxuto por pedido do dono (sem código completo; contratos + testes).
- **TDD:** só lógica pura — T02 (token/hash/acesso anon×token/config remota/heartbeat), T05 (online/offline), T07 (modo/config do agente).
- **Desvio de processo (autorizado pelo orquestrador):** a skill exige ondas com checkpoint + nova sessão; skeleton + Fase 1 + Fase 2 foram detalhados nesta sessão, sem subagente planejador, com **um** gate de compliance `cross` (1 subagente sonnet, 1 rodada).
- **Decisões de rotina tomadas no Plan:** token em header `x-agent-token` (formato `epa_` + 43 base64url); `print-queue-agent` passa a ser publicada com `--no-verify-jwt` (token não é JWT) e confere a anon key no código (`isAnonCaller`), com secret opcional `PRINT_AGENT_EXTRA_ANON_KEYS`; anon em loja atribuída/bloqueada → 200 `tickets:[]` + `blocked`; token em loja não atribuída → 403; heartbeat gravado no máximo a cada 30 s; config remota com defaults do servidor (sem colunas por agente); revogar libera as lojas do agente (RPC); admin por Edge nova `print-agents-admin` (dono da plataforma via `isPlatformOwner`); flag fora do `SystemSettingsContext`.
- **Achado:** `agente-local/config.json` **está versionado** no git (a spec dizia que o `.gitignore` cobria). Não alterado; registrado em Riscos do `tasks.md`.
- **Plan compliance:** `cross` ✅ na iteração 1 (sem Crítico). Melhoria aplicada: US-01 em T01. Melhorias não aplicadas: teste automatizado da RPC de atribuição (fica manual em T10, coerente com `tdd_integracao: fora`); regex do token duplicada em 2 runtimes (registrar no `AI_SYSTEM_MAP.md` em T10).

| Task | Fase | Estado |
|------|------|--------|
| T01 Migration | 1 | pending |
| T02 Regras puras (TDD) | 1 | pending |
| T03 print-queue-agent auth dual | 1 | pending |
| T04 Edge print-agents-admin | 1 | pending |
| T05 Status online/offline (TDD) | 2 | pending |
| T06 Aba Agentes de impressão | 2 | pending |
| T07 Regras puras do agente (TDD) | 2 | pending |
| T08 Agente modo-token | 2 | pending |
| T09 Instalador + README | 2 | pending |
| T10 Verificação E2E + docs | 2 | pending |

**Status:** `spec.md` → `planned`. Próximo: `/sdd-05-review`.

---

## Fase 05 — Review (2026-09-18)

**Invocação:** `/sdd-05-review` pelo orquestrador (dono ausente; aprovação autônoma autorizada se não houver achado grave).

**Achado grave identificado pelo orquestrador ANTES desta revisão, corrigido em `spec.md`/`tasks.md` nesta fase:** o plano original (T03/Handoff) fazia `print-queue-agent` validar a anon key do agente antigo no código (`isAnonCaller`, comparando `apikey`/`Bearer` contra `SUPABASE_ANON_KEY` + secret opcional `PRINT_AGENT_EXTRA_ANON_KEYS`), com fallback "se 401, setar o secret". Confirmado no código atual (`supabase/functions/print-queue-agent/index.ts:429-453`) que a Edge **hoje não faz nenhuma checagem de chave** além do roteamento padrão do gateway Supabase — o plano teria introduzido uma checagem nova que podia derrubar a impressão em produção (agentes instalados usando a chave `sb_publishable_…` nova, diferente da legacy JWT que a Edge conheceria). **Correção aplicada em `tasks.md`:**
- Removida a função `isAnonCaller` e a env `PRINT_AGENT_EXTRA_ANON_KEYS` de todo o plano (T02 Interfaces/Steps, T03 Context pack/Produces, Análise de impacto, Global Constraints, Handoff).
- Modo legado (sem `x-agent-token`) passa a ser explicitamente "nenhuma checagem adicional no código — idêntico ao comportamento atual"; proteção vem só de (a) loja atribuída a agente-token → fila vazia/`blocked`, e (b) `require_print_agent_token` ligada → anônimo recusado.
- Handoff step 3 corrigido: não há mais fallback de secret; 401 novo no modo legado após o deploy é tratado como regressão (rollback = redeploy da versão anterior).
- `spec.md` não precisou de correção — RF-06/07/08 já descreviam a regra em nível conceitual, sem mencionar `isAnonCaller`/comparação de chave.

**Verificações adicionais pedidas pelo orquestrador, checadas nesta fase:**
- Flags de deploy (`npx supabase functions list --project-ref mdghhjemzdmeuqpzuyzx -o json`): `print-queue-agent` já está `verify_jwt:false` hoje — plano mantém `--no-verify-jwt`, sem mudança de flag. `print-agents-admin` (nova) planejava `verify_jwt: true`, mas o padrão real das outras edges de Admin Master (`admin-manage-user`, `admin-create-user`, `bootstrap-admin`) é **`verify_jwt:false`** com auth manual (`authenticate()`+`isPlatformOwner`/`getUser` dentro do código). **Corrigido em `tasks.md` T04**: deploy com `--no-verify-jwt`, seguindo o mesmo padrão.
- Nenhuma task toca o agente real da porta 9876 nem `agente-local/config.json` — confirmado (Global Constraints + "Não fazer" de T08/T09/T10 já cobrem isso, sem alteração necessária).
- Tabelas/funções novas (`print_agents`, `print_agent_stores`, `fn_print_agent_*`): RLS `ENABLE` sem policy, `GRANT` a `service_role`, `REVOKE ALL FROM PUBLIC, anon, authenticated` nas funções `SECURITY DEFINER` — já presentes em T01, sem alteração necessária.
- Tabelas novas não entram na publicação `supabase_realtime` (plano Free) — confirmado por ausência: `tasks.md`/`spec.md` não mencionam `ALTER PUBLICATION` para as tabelas novas; nenhuma alteração necessária.
- Heartbeat não gera escrita a cada poll — já mitigado por `shouldHeartbeat` (T02, mínimo 30s entre gravações); sem alteração necessária.

**Checklist da skill (Interfaces / bite-size / Iron Law / zero-context):** plano já passou por 1 rodada de compliance `cross` na Fase 04 (sem Crítico); nesta revisão humana, cada task mantém contrato `Interfaces (Consumes/Produces)`, `Context pack` com caminho:linha do código atual, `Não fazer` explícito, `Steps` numerados e `DoD` verificável — sem lacunas de zero-contexto novas introduzidas pela correção acima (a correção só remove uma função/env do contrato, não adiciona ambiguidade). TDD (Iron Law red→green→refactor) mantido em T02/T05/T07; nenhuma task subsequente depende da função removida.

**Resultado:** nenhum outro achado grave. **Plano aprovado autonomamente em 2026-09-18 — correção do modo legado aplicada.** `spec.md` `status` permanece `planned` (plano já cobre só Fases 1-2, sem mudança de escopo). Liberado para `/sdd-06-execute`.

---

## Próximas fases

- [x] **Fase 02 — Research** (`/sdd-02-research`): concluída 2026-09-18.
- [x] **Fase 03 — Specify** (`/sdd-03-specify`): concluída 2026-09-18; **aguardando confirmação do dono** antes do Plan (Iron Law).
- [x] **Fase 04 — Plan** (`/sdd-04-plan`): concluída 2026-09-18 (`tasks.md`, compliance `cross` ✅).
- [x] **Fase 05 — Review** (`/sdd-05-review`): concluída 2026-09-18 — aprovada autonomamente após correção do modo legado (auth) e da flag de deploy do `print-agents-admin`.
- [ ] **Fase 06 — Execute** (`/sdd-06-execute`): código.
- [ ] **Fase 07 — Spec Review** (`/sdd-07-spec-review`): validação do código contra spec.
- [ ] **Fase 08 — Docs** (`/sdd-08-docs`): documentação e MR.
- [ ] **Finish** (`finish-branch`): merge e fechamento.
