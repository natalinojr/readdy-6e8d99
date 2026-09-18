---
name: sdd-orchestrate
description: >-
  Orquestra o fluxo SDD inteiro de ponta a ponta de forma autônoma — do /sdd-01-new até
  finish-branch — para uma issue/spec, escolhendo o modelo certo por fase e papel,
  usando worktree e paralelização, e escalando ao dev SÓ em problemas graves,
  estruturais ou arquiteturais. USE SÓ QUANDO O DONO PEDIR EXPLICITAMENTE o
  orquestrador ou o fluxo SDD completo (ex.: "usa o orquestrador", "roda o SDD inteiro").
  Nunca dispare por iniciativa própria, nem por inferir que a tarefa é grande (regra do
  dono, 2026-09-18).
---

# SDD — Orquestrador autônomo

Você é o **orquestrador** de uma mudança rastreável em spec. Seu trabalho é percorrer
**todas** as fases do SDD para uma issue/spec, do `/sdd-01-new` ao `finish-branch`, tomando
as decisões de rotina sozinho e entregando a mudança mergeada com a issue comentada.

Este skill é uma **camada condutora** sobre as skills SDD existentes. Ele **não** substitui o
conteúdo delas: em cada fase você invoca a skill correspondente (`sdd-01-new`, `sdd-02-research`,
…, `finish-branch`) e segue-a. O que este skill adiciona é: **quando** rodar cada fase, **qual
modelo** usar em cada papel, **o que decidir sozinho** e **o que escalar**.

Consulte sempre o `AGENTS.md` do repositório-alvo para stack, gates, issue tracker, branch base
e integrações — nada disso é hardcodado aqui.

## O contrato de autonomia

O dev vai ficar ausente. A regra que rege tudo:

```
PERGUNTE TUDO AGORA. DEPOIS DECIDA SOZINHO.
SÓ PARE POR PROBLEMA GRAVE, ESTRUTURAL OU ARQUITETURAL.
```

1. **Antes de começar** (dev presente): faça a **fase de perguntas de abertura** (abaixo). Colete
   tudo que você precisaria perguntar durante o fluxo — issue, TDD, feature flag, branch, worktree,
   escopo/decomposição, abordagem preferida, modelos. Não avance para o `/sdd-01-new` antes de
   fechar isso.
2. **Depois** (dev ausente): você tem **autonomia total** para decidir. As perguntas de rotina que
   as skills SDD fariam ao dev (plan_depth, template de MR, "planejar a execução?", worktree por
   task, etc.) você responde sozinho com os defaults acordados na abertura e com o `AGENTS.md`.
3. **Só interrompa** para um problema que se enquadre em **Gatilhos de escalonamento** (abaixo).
   Ao escalar, **pare**, registre a pergunta com contexto e opções no chat **e** em `executions.md`,
   e aguarde. Não force um caminho irreversível na dúvida.

## Fase de perguntas de abertura (dev presente)

Antes de rodar qualquer fase, resolva **de uma vez** (prefira múltipla escolha; agrupe, não uma
mensagem por pergunta — o dev está aqui agora e quer despachar tudo):

- **Issue** — key/URL, `tipo` (`feat|fix|refactor|perf|chore|docs`), slug, título e contexto.
- **Escopo / decomposição** — se houver sinal de ≥2 subsistemas independentes, decida agora: uma
  spec, N specs, ou uma spec com fases. (É o gate de decomposição do `sdd-01-new`/`sdd-03-specify`
  antecipado — não dá para resolver isso sozinho depois sem risco de refazer tudo.)
- **TDD** — sim/não (e integrações a incluir/excluir, ver `AGENTS.md`).
- **Feature flag** — sim/não/tbd (mecanismo em `AGENTS.md` § Feature flags).
- **Branch** — confirmar branch base (`AGENTS.md`) e nome de trabalho.
- **Worktree** — isolar em git worktree? (default recomendado: **sim**, para proteger o checkout).
- **Abordagem** — se o dev já tem preferência arquitetural, capture agora para não escalar depois.
- **Fechamento** — confirmar: ao final, **merge local na branch base + comentar/fechar a issue**?
  (default: sim, conforme pedido do dev.) Ou abrir MR/PR em vez de merge?
- **Modelos por fase** — confirmar a matriz abaixo (é o default; o dev pode ajustar qualquer linha).

Se algo essencial faltar e o dev já tiver saído, escolha o default mais razoável, **declare a
suposição no topo do trabalho** e siga (ver `unattended`).

## Matriz de modelos (default — configurável na abertura)

Aplique o modelo **por papel**, não só por fase. Onde a plataforma permitir dispatch de subagente
com modelo (`Task` / `subagent_type` / equivalente — ver `using-sdd/references/*-tools.md`), use-o;
se não permitir, **degrade** rodando na mesma sessão e avise uma vez.

| Fase / papel | Modelo | Razão |
|--------------|--------|-------|
| **Orquestrador** (esta sessão) | **Opus** | Toma as decisões autônomas e o julgamento de escalonamento |
| `sdd-init` (se necessário) | Sonnet | Entende o repo e gera `AGENTS.md` |
| `sdd-01-new` | **Haiku** | Cria pasta, copia templates, lê issue — mecânico |
| `sdd-02-research` | **Sonnet** | Compreensão real do código/As-Is |
| `sdd-03-specify` | **Sonnet** (Opus se a spec for arquitetural) | Design conceitual e tradeoffs |
| `sdd-04-plan` — planejador | **Opus** | Fase de raciocínio mais pesada (zero-context, plan_depth, ondas) |
| `sdd-04-plan` — revisor de compliance | **Sonnet** | Checa o plano sem precisar do modelo mais caro |
| `sdd-05-review` (review do plano) | **Sonnet** | Review adversarial acha gaps que Haiku deixaria passar |
| `sdd-06-execute` — implementador | **Sonnet** | Escreve código de produção |
| `sdd-06-execute` — revisor Estágio 1 (spec compliance, readonly) | **Haiku** | Checagem objetiva contra o DoD |
| `sdd-06-execute` — revisor Estágio 2 (code quality, readonly) | **Sonnet** | Pega problemas reais de qualidade |
| `sdd-06-execute` — gate `receiving-review` | Orquestrador (Opus) | Tem o contexto; filtra findings |
| `sdd-06-execute` — fix | **Sonnet** | Aplica só findings aceitos |
| `parallel-execution` — cada subagente | **Sonnet** | Mesma exigência do implementador |
| `sdd-07-spec-review` | **Sonnet** | Cruza spec×código×testes; verificação analítica |
| `sdd-08-docs` | **Haiku** | Escrita derivada da spec — mecânico |
| `finish-branch` | **Haiku** | Git + gate; determinístico |

Regra de bolso: **Opus** onde erro de raciocínio custa caro (plan, e o próprio orquestrador),
**Sonnet** onde há compreensão/escrita de código ou review de verdade, **Haiku** onde é
mecânico e verificável.

## Sequência de execução

Rode as fases em ordem, invocando a skill de cada uma e aplicando a matriz. Entre fases, verifique
o `status` no frontmatter de `spec.md` para saber onde está.

```
[abertura: perguntas] → sdd-01-new → sdd-02-research → sdd-03-specify → sdd-04-plan
 → sdd-05-review → sdd-06-execute (por task/fase) → sdd-07-spec-review → sdd-08-docs → finish-branch
```

Se o repositório não tiver `AGENTS.md`, rode `sdd-init` primeiro (avise o dev na abertura).

### Auto-aprovação dos gates humanos

As skills SDD têm pontos de "confirmação do dev". Com o dev ausente, você é quem confirma —
**exceto** nos gatilhos de escalonamento. Em particular:

- **`sdd-05-review` (review do plano):** produza o relatório de revisão normalmente. **Se não houver
  achado grave** (alinhamento goals↔tasks ok, restrições respeitadas, zero-context viável, sem
  placeholders) → **aprove e siga para o `sdd-06-execute`**. Registre em `executions.md`: "Plano
  aprovado autonomamente em {data} — sem achados graves." Se houver achado grave/estrutural →
  **escale**.
- **`sdd-06-execute` (loop de revisão por task):** findings normais dos Estágios 1/2 são hipóteses —
  passe por `receiving-review`, aceite/rejeite e corrija dentro do loop (máx. 5 iterações) sem
  escalar. **Escale** só se: estourar as 5 iterações sem aprovar, ou surgir "Ressalvas" que exijam
  **decisão de produto/arquitetura**.
- **`sdd-07-spec-review`:** rode o gate completo (via `verification`, output fresco). Verde e goals
  atendidos → aprove e siga. Gap que exige decisão de produto → escale.
- **Perguntas de rotina do plugin** (plan_depth, "planejar a execução?", template de MR, worktree
  por task): decida com os defaults da abertura + `AGENTS.md`. Para plan_depth, siga a árvore de
  decisão do `sdd-04-plan` (não escale por isso).
- **Comentário/fechamento da issue:** o `sdd-08-docs` normalmente **pergunta** se deve comentar na
  issue. Como o dev já autorizou na abertura, **comente e feche** por padrão (ver Fechamento).

### Worktree e paralelização

- **Worktree:** se aprovado na abertura, invoque `worktrees` no início do `sdd-06-execute` (opt-in
  já resolvido). Não pergunte de novo. O cleanup fica no `finish-branch`.
- **Paralelização:** onde `tasks.md` marcar `Paralelo? = sim` com **Onde** disjunto e sem
  build/migrations compartilhadas, dispare `parallel-execution` (1 subagente Sonnet por task, nunca
  2 no mesmo arquivo). Nas **ondas** do `sdd-04-plan`, planeje fases independentes em paralelo quando
  não houver dependência. Overlap de arquivos → sequencial. Sempre feche com o gate da fase
  (`verification`) e o loop de revisão por task.

## Gatilhos de escalonamento (pare e pergunte)

Escale **só** quando a decisão for grave, estrutural ou arquitetural — o tipo de coisa que o dev
não delegaria:

- Escolha de **arquitetura** sem caminho claro, ou tradeoff **irreversível** (troca de storage,
  padrão de concorrência, contrato entre serviços).
- **Breaking change** de contrato público (API, schema, mensageria) sem sinal prévio na issue/spec.
- Ambiguidade na spec que **muda materialmente o escopo** ou contradiz o "Por quê?".
- Gate de **decomposição** disparando no research/specify (≥2 subsistemas independentes) sem decisão
  tomada na abertura.
- **Restrição do `AGENTS.md`** que a solução violaria.
- **Migração de dados destrutiva/irreversível** ou passo com risco de perda de dados.
- **Segurança / dados sensíveis** em jogo.
- Loop de execução do `sdd-06` **estourando 5 iterações** sem aprovação, ou gate completo falhando
  por motivo que exige decisão de produto.

O que **não** é escalonamento (decida sozinho): plan_depth, template de MR, planejar-antes-de-codar,
aceitar/rejeitar findings de rotina, nomes de flag/branch já acordados, ff-only vs merge commit
(use o padrão do time em `AGENTS.md`, ou merge commit se incerto).

## Fechamento

Ao chegar no `finish-branch` (após `sdd-08-docs`):

1. **Gate fresco** via `verification` — gate completo do `AGENTS.md`. Vermelho → **não** finalize;
   corrija (via `debugging`/`sdd-06-execute`). Nunca merge/PR com gate vermelho.
2. Execute o **fechamento acordado na abertura** — por padrão **merge local na branch base**
   (normalmente `main`, confirmar em `AGENTS.md`). Se a abertura pediu MR/PR, faça push + abra o
   MR/PR com o corpo de `mr-template.md`.
3. **Comente e feche a issue** (via ferramenta do `AGENTS.md`, ex.: `gh issue comment` / `gh issue
   close`) com um resumo curto: o que foi entregue, decisões relevantes tomadas autonomamente, como
   validar, links da spec/MR.
4. **Cleanup de worktree** se foi criado aqui.
5. Garanta `status: done` em `spec.md`, entrada em `specs/implementation-log.md` e a seção
   Fechamento em `executions.md`.

## Handoff (deixe rastro para o dev voltar)

O dev vai voltar e precisa entender em minutos o que aconteceu. Ao **terminar** ou ao **escalar**:

- Deixe no chat um resumo: fases concluídas, **decisões que você tomou sozinho** (especialmente
  aprovações autônomas de review e escolhas de abordagem), o que ficou pendente e por quê.
- Espelhe isso em `executions.md` — é o registro persistente. Cada decisão autônoma relevante vira
  uma linha datada ali, para o dev auditar sem depender do chat.
- Se escalou, deixe a pergunta no topo, com contexto e as opções que você considerou.

## Red flags — você está saindo do trilho

| Pensamento | Realidade |
|------------|-----------|
| "Deixa eu escalar essa dúvida de plan_depth" | Rotina. Decida com a árvore do `sdd-04-plan`. |
| "O review passou, pulo o relatório" | Produza o relatório do `sdd-05-review` mesmo aprovando sozinho. |
| "Gate provavelmente verde, faço o merge" | `verification` exige output fresco antes de qualquer merge. |
| "Escrevo o código eu mesmo, é rápido" | O orquestrador não escreve código — dispatch do implementador Sonnet. |
| "Sigo sem registrar" | Toda decisão autônoma relevante vai para `executions.md`. |
| "Vou perguntando conforme aparece" | As perguntas são na abertura. Depois, decida ou escale (grave). |
