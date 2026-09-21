# Executions: Contratação - reorganização de layout (5 áreas + engrenagem)

> Spec: [spec.md](./spec.md) · Briefing: [`specs/briefing-contratacao-reorganizacao-layout.md`](../briefing-contratacao-reorganizacao-layout.md)

**Status:** planned → próximo `/sdd-05-review`

---

## Decisões de Abertura (2026-09-20)

**Registradas pelo orquestrador SDD — decisões prévias do dono, não requerem confirmação.**

### Abertura da Spec

| Decisão | Valor | Motivo |
|---------|-------|--------|
| **Slug** | `contratacao-reorganizacao-layout` | Identificador único; sem issue tracker no projeto |
| **Tipo** | `refactor` | Reorganização de UI sem nova funcionalidade de negócio |
| **Título** | Contratação: reorganização de layout (5 áreas + engrenagem) | Descritivo; resume a mudança |
| **Pasta** | `specs/2026-09-contratacao-reorganizacao-layout/` | Padrão do projeto (YYYY-MM-{slug}) |
| **Briefing** | `specs/briefing-contratacao-reorganizacao-layout.md` | Documento de entrada pré-existente (approved by dono 2026-09-20) |
| **TDD** | `false` | Teste só em lógica pura (mapa de compat. abas, melhor nota, "Precisa de você"); UI é manual |
| **Feature flag** | `nao` | Reorganização de layout, não feature toggleável; sem flag |
| **Escopo** | Uma spec em 6 fases | Briefing §4 = 6 ondas independentes/sequenciais; feedback incremental |
| **Status inicial** | `draft` | Pronto para `/sdd-02-research` |

### Decisões Autônomas do Orquestrador

| Decisão | Valor | Justificativa |
|---------|-------|---------------|
| **(a) Sem worktree** | Trabalhar em local, sem criar branch | Dono escolheu: "working tree compartilhado com outra sessão (`claude/modulo-financeiro-sem-pdv`, 48 arquivos mod.). Nenhum comando git que altere HEAD/index/tree." |
| **(b) Sem branch própria** | Convenção `claude/{slug}` suspensa | Dono: "a convenção fica suspensa nesta spec porque trocar de branch no tree compartilhado atrapalharia a outra sessão; fechamento será commit dos arquivos desta spec + push para `main`" — implica: trabalho local, append-only no log, sem `git add`/`commit` nesta sessão. |
| **(c) Regra nº 1** | NÃO mudar visual | Briefing §1: "o problema é que você mudou o tipo do visual… não precisa mudar, o visual que está, está legal." → Registrada em `spec.md` §2 "Restrições" item 1 como inegociável. |

---

## Resumo

| Task | Status | Início | Fim | Responsável |
|------|--------|--------|-----|-------------|
| Abertura (sdd-01-new) | done | 2026-09-20 | 2026-09-20 | orquestrador |
| Research (sdd-02) | done | 2026-09-20 | 2026-09-20 | sessão research (fase 02) |
| Specify (sdd-03) | done | 2026-09-20 | 2026-09-20 | sessão specify (fase 03) |
| Plan (sdd-04) | done | 2026-09-20 | 2026-09-20 | sessão plan (fase 04) |
| Review (sdd-05) | pending | — | — | próxima sessão |
| Execute (sdd-06) | done (T01-T19 todas) | 2026-09-20 | 2026-09-20 | várias sessões (por fase/subagente) |
| Spec Review (sdd-07) | pending | — | — | próxima sessão |
| Docs (sdd-08) | pending | — | — | próxima sessão |
| Finish (close) | pending | — | — | sessão principal |

### Tasks (`tasks.md`) — estado para o `/sdd-06-execute`

| Fase | Task | Título | Status |
|------|------|--------|--------|
| 1 | T01 | `aderencia.ts` — melhor nota de aderência (lógica pura + teste) | pending |
| 1 | T02 | Card e Kanban com aderência, vaga e "falta X" | pending |
| 1 | T18 | Kanban — chip de estado do agendamento pela IA | pending |
| 1 | T03 | Janela única "Adicionar currículos" | pending |
| 2 | T04 | `ConversaWhatsApp` — bolhas de `wa_log` extraídas | done |
| 2 | T05 | `ficha/*` — blocos do drawer em 4 sub-componentes | done |
| 2 | T06 | Shell da ficha — cabeçalho fixo, barra de ações, 5 abas | done |
| 3 | T07 | `navegacao.ts` — áreas e mapa dos `aba` antigos (lógica pura + teste) | pending |
| 3 | T08 | Extrair as áreas de `page.tsx` (sem mudar comportamento) | pending |
| 3 | T09 | Navegação de 5 áreas + engrenagem + compatibilidade | pending |
| 3 | T10 | Configurações na engrenagem com menu lateral | pending |
| 4 | T11 | Vaga por dentro — 4 sub-abas | pending |
| 4 | T12 | Configurações › WhatsApp | pending |
| 5 | T13 | `hoje.ts` — contagens e "Precisa de você" (lógica pura + teste) | pending |
| 5 | T14 | Área Hoje | pending |
| 5 | T15 | Barra inferior no celular e default Hoje | pending |
| 5 | T19 | Atalho "Ir para a próxima" no dia vazio | pending |
| 6 | T16 | Filtros em etiquetas | done |
| 6 | T17 | Seleção múltipla e ações em lote | done |

**Ordem de execução:** Fases 1 e 2 podem rodar **em paralelo** (`parallel-execution`; arquivos disjuntos, conferido no gate `cross`). Fases 3 → 4 → 5 → 6 são **sequenciais**. Dentro de cada fase, seguir a ordem da tabela acima (as tasks compartilham arquivo).

---

## Registro por task

### Abertura (sdd-01-new)

- **Status:** done
- **Data:** 2026-09-20
- **Executado por:** Orquestrador SDD
- **O que foi feito:**
  1. Criada pasta `specs/2026-09-contratacao-reorganizacao-layout/`
  2. Arquivo `spec.md` com frontmatter + seções 1–6 (Por quê, As Is, To Be, Design, US, Tasks, Refs)
  3. Arquivo `executions.md` (este) com decisões de abertura e registro de status
  4. Entrada em `specs/implementation-log.md` (append no fim)
  5. Regra nº 1 (não mudar visual) registrada em `spec.md` §2 "Restrições" item 1

- **Desvios da spec:** Nenhum (fase 01-new é scaffolding, não comporta desvios)

- **Gate de qualidade (fase 01):** N/A (scaffolding; validação de estrutura manual)

- **Notas:**
  - Spec pronta para `/sdd-02-research` (validação de código atual, mapeamento de componentes, confirmação de compatibilidade Radix + Tailwind)
  - Working tree compartilhado: nenhum `git add`/`commit`; decisão de push em `main` fica para sessão principal ao fechar a entrega
  - Briefing inclui contexto de negócio (9 abas → redundância, usabilidade desktop/celular) e restrições (regra visual, dados reais TBA Ipanema)
  - Regra nº 1 em inegociável: sem design system novo, sem trocar ícones, reaproveitar componentes existentes

---

### Specify (sdd-03-specify)

- **Status:** done
- **Data:** 2026-09-20
- **Executado por:** sessão specify (fase 03) — dono ausente, decisões tomadas e registradas aqui sem pausa para confirmação
- **O que foi feito:**
  1. Lido `AGENTS.md` (gates, restrições de git, mapa de research) e o briefing inteiro (§3 To Be, §5 restrições, §6 critérios, §7 fora de escopo) antes de editar.
  2. Confirmado que `spec.md` já trazia rascunho de §2–§6 (To Be/Design/US/Tasks/Refs) do scaffolding inicial; revisado e corrigido esse rascunho contra o As Is da fase 02 e as decisões do orquestrador, em vez de reescrever do zero.
  3. Aberto `src/components/feature/BotaoAvisos.tsx` (fora de `src/pages/contratacao/`, permitido só para leitura) para entender o rótulo "Bloqueadas": é o estado `negado` de permissão de notificação (Web Push/Firebase); o componente já se esconde sozinho (`null`) quando não há nada a fazer. RF-08 atualizado para reaproveitar o mesmo componente dentro de "Precisa de você", sem reescrever a lógica de push.
  4. RF-02 corrigido para deixar explícito: card/Kanban mostram a **nota de aderência** (melhor `hiring_applications.score` + vaga), a Tabela continua com `avgScore` (nota de entrevista) sem virar a nota do card, e as duas precisam de rótulo distinto. Reforçado que onda 1 não abre query nova (propagação de prop de `applications` já carregado em `page.tsx:151`).
  5. Adicionada tabela explícita de compatibilidade de `?aba=`/`localStorage` → área nova (RF-01), incluindo a decisão de trocar o default de `entrevistas` para `hoje` (consequência de "Hoje" virar a tela inicial, briefing §3.2).
  6. Adicionado mapa bloco → aba cobrindo os ~20 blocos do `CandidatoDrawer.tsx` atual (RF-04), provando que nenhum desaparece; `wa_log` ganha acesso novo pela aba Conversa.
  7. RF-06/RF-07 explicitados: Configurações › WhatsApp é **tela nova** (não mover), com escopo mínimo — reaproveitar exatamente a renderização/comportamento de `LinksWhatsApp.tsx`, sem recurso novo.
  8. RF-08 detalhado com as 4 fontes de "Precisa de você" (`aguardando_gestor` com Aceitar/Recusar via `hiring-scheduler › decide`, `needs_human`, sessão `erro`, `BotaoAvisos`).
  9. Non-goals e critérios de sucesso expandidos para casar 1:1 com o briefing §7 (fora de escopo) e §5/§6 (não regressão, item por item).
  10. `spec.md` frontmatter `status` → `specified`; rodapé "Próxima fase" corrigido para `/sdd-04-plan` (estava apontando por engano para `/sdd-02-research`, resquício do scaffolding inicial).
- **Decisões tomadas sem o dono (registradas para auditoria):**
  - Nota do card = aderência (`hiring_applications.score`), nunca a média de entrevista — conforme instrução explícita do orquestrador, incorporada como requisito.
  - Default da navegação muda de `entrevistas` para `hoje` (consequência direta de "Hoje" virar tela inicial; não foi pedido explicitamente no briefing, mas é a leitura natural de §3.1/§3.2 — sinalizado aqui para o dev revisar em `/sdd-04-plan`/`/sdd-05-review` se achar que merece confirmação do dono).
  - Vagas e Anotações (blocos 5 e 19 do drawer) ficam agrupados na aba Resumo (não Currículo/Entrevistas) — decisão de agrupamento por serem parte da "decisão rápida" do gestor; marcado como revisável no Plan.
  - `?aba=links` sem contexto de vaga cai em Configurações › WhatsApp (não há como saber a vaga só pelo parâmetro antigo).
- **Desvios da spec:** Nenhum — spec.md já continha rascunho de §2 em diante (do scaffolding `/sdd-01-new`); esta fase corrigiu/completou esse rascunho em vez de gerá-lo do zero, mantendo a estrutura.
- **Gate de qualidade (fase 03):** N/A (specify não altera código; só documento).
- **Notas:** Nenhum comando git executado nesta fase (só leitura de código + edição de arquivos dentro de `specs/2026-09-contratacao-reorganizacao-layout/`). Próxima fase: `/sdd-04-plan`.

---

### Plan (sdd-04-plan)

- **Status:** done
- **Data:** 2026-09-20
- **Executado por:** sessão plan (fase 04) — **dono ausente**; todas as decisões abaixo tomadas pela árvore de decisão da skill `sdd-04-plan`, sem pausa para confirmação, e registradas aqui para auditoria.
- **Modo:** Plan em ondas (§4.2 da skill) — obrigatório porque a spec tem **6 fases** (≥ 2). Onda 0 (skeleton) + 1 onda por fase + onda final `cross`. Planejadores **sequenciais** (nunca dois em paralelo); revisor de compliance readonly por escopo.
- **Decisão de sessão:** "continuar nesta sessão" em todos os checkpoints, em vez de pedir nova sessão a cada onda — o dono está ausente e o pedido foi explícito para não perguntar nada.

#### Decisões tomadas sem o dono

| # | Decisão | Base |
|---|---------|------|
| 1 | **`plan_depth` = `contracts`**, com override `snippets` nas 3 tasks de lógica pura (T01, T07, T13) | Árvore §4.0 regra 2: 23 de 43 paths com ação são `criar` (53%), acima do limiar. A entrega é majoritariamente **extração de JSX existente**: o que trava o comportamento é a assinatura de props + a origem verbatim do JSX, não um snippet reescrito no plano. Nas tasks de lógica pura (único código novo de verdade, e o único com teste) o plano traz corpo completo + teste completo. |
| 2 | **`tasks.md` reescrito do zero** | O arquivo vindo do `/sdd-01-new` era rascunho mecânico com erros de fato: dizia "Radix Tabs / Radix Sheet / Radix Dialog" (o módulo **não usa Radix**; não há Radix no `package.json`), citava tabela inexistente (`hiring_entrevistas`), campo em tabela errada (`hiring_applications.needs_human`), e mandava mexer em `shared.ts` e `AdicionarCandidatosModal.tsx` para coisas que não são deles. |
| 3 | **Extração de `page.tsx` virou task própria (T08), antes da troca de navegação (T09)** | Briefing §5 ("`page.tsx` já é grande: a reorganização é boa hora para extrair as áreas em componentes, sem mudar comportamento"). Separar "extrair sem mudar nada" de "mudar a navegação" é o que permite que as Fases 3, 4, 5 e 6 não virem um único arquivo de 800 linhas em conflito, e dá um passo com DoD verificável ("mesma tela nas 9 abas antes/depois"). |
| 4 | **Lógica pura em módulos próprios** (`aderencia.ts`, `navegacao.ts`, `hoje.ts`) em vez de dentro de `shared.ts` | `shared.ts` (537 linhas) é importado por ~15 componentes do módulo; crescer esse arquivo em 3 fases diferentes aumenta o risco de conflito com a outra sessão e o raio de blast de qualquer erro. Módulos próprios também deixam o teste unitário focado. |
| 5 | **Task nova T18 na Fase 1:** "estado do agendamento da IA" no card do Kanban | O briefing §3.3 pede isso na onda 1, mas **não existe dado carregado** para ele no shell (achado do planejador da Fase 1). Como `hiring_scheduling_sessions` **já é lida pelo módulo** (`AgendamentosPainel.tsx:162-166`), a leitura extra cabe na Constraint 8 (nada de migration/Edge/coluna/RPC nova). Virou task própria, escopada e derrubável em `/sdd-05-review`, em vez de contrabando dentro de T02. |
| 6 | **Sem feature flag** (mantém `feature_flag: nao`) | Reavaliado no Plan: uma flag exigiria manter as 9 abas antigas **e** as 5 novas vivas no mesmo `page.tsx`, dobrando o roteamento e o risco de divergência visual — o oposto do objetivo. O mecanismo do projeto (`system_settings` por loja) também não serve: Contratação é independente das lojas do ERPOS. Rollback é `git revert` da fase. |
| 7 | **Compliance do skeleton fechado em 1 iteração** | O único item Crítico do revisor foi aritmético (a linha de contagem do Mapa dizia 23/11/10; o correto é 23/9/11). Corrigido; `plan_depth` não muda (53% ainda passa do limiar). Não houve segunda rodada porque o achado não era de conteúdo. |

#### Achados do Plan que **corrigem** `spec.md` §1 (gravados em `tasks.md` § "Achados desta fase")

1. **Existe teste cobrindo Contratação** — `src/test/components/entrevistasDoDia.test.tsx` (commitado, não é arquivo sujo) renderiza `EntrevistasDoDia` com `focoId`/`onFocoUsado`, ou seja, cobre exatamente o deep link "Abrir entrevista de Fulana" que a Fase 3 tem que preservar. A afirmação de `spec.md` §1 item 12 e "Divergências" #3 ("nenhum teste em `src/test/**` cobrindo contratacao/hiring") está **errada**. Passou a ser: gate de regressão do `focoEntrevista` + padrão a imitar nos testes novos.
2. **`needs_human` está em `bot_conversations`**, lido em `LinksWhatsApp.tsx:38,107,433,463` — não em `hiring_scheduling_sessions`. Afeta a fonte do RF-08 item 2.
3. **`aguardando_gestor` + Aceitar/Recusar já existem** (`AgendamentosPainel.tsx:118` e `DecidirPedido` `:49-139`, que já chama `hiring-scheduler › decide` com `op`). A tela Hoje reaproveita, não reimplementa.
4. **`Vagas.tsx` já separa lista e detalhe** (`ListaVagas` `:38`, `DetalheVaga` `:98-246`) e **`ConfiguracoesContratacao.tsx` já tem os 4 cards como funções separadas** (`:43`, `:163`, `:257`, `:351`). Fases 3 e 4 são recorte e roteamento, não reescrita.
5. **O módulo não usa Radix.** `spec.md` §6 cita "Radix Tabs (`tabs.tsx`)" e "Radix Dialog" — não confere: abas são `<button>` com `border-b-2` (`page.tsx:564-571`), janelas são o `dialog.tsx` local (93 linhas, sem dependência), e não há `radix` no `package.json`. Virou Constraint 12.
6. **Lacunas do research fechadas nesta fase:** o rótulo "Bloqueadas" do `BotaoAvisos` (já resolvido na fase 03) e o **JSX exato das bolhas de `wa_log`** (`AgendamentosPainel.tsx:308-334`) — com o achado de que a lista de bolhas **mistura `wa_log` com `s.history` do agendamento**, o que obriga o componente extraído a aceitar `history` opcional (na ficha não há sessão). Continua aberta só a constraint `ON DELETE SET NULL` de `bot_channels.job_id`, que é de banco e está fora do escopo desta spec.

#### Gate de plan-compliance por escopo (§4.4 da skill)

**Resultado final: ✅ em todos os 8 escopos.** Nenhum escalado ao dono. Ao todo o gate pegou **11 itens Críticos**, todos reais e todos corrigidos — nenhum era formalidade.

| Escopo | Iterações | Resultado | O que o revisor pegou |
|--------|-----------|-----------|------------------------|
| `skeleton` | 1 | ✅ | 1 Crítico, aritmético: a contagem do Mapa dizia 23 criar / 11 modificar / 10 nenhuma; o certo é **23 / 9 / 11**. Corrigido; `plan_depth: contracts` não muda (23 de 43 = 53%, acima do limiar). |
| `fase-1` (T01, T02, T18, T03) | 1 | ✅ | 1 Crítico: os Steps citavam o total de testes do `baseline.json` (211) e prometiam "218 passed"; o real é **500**. Corrigido em toda a spec. 2 Melhorias de número de linha: `QueueItem` é `page.tsx:36` (corrigido); a citação do invólucro do `AdicionarCandidatosModal` estava **certa** e o apontamento do revisor, errado (conferi: overlay `:34`, cartão `:35`, cabeçalho `:36-41`). |
| `fase-2` (T04, T05, T06) | 2 | ✅ | 4 Críticos reais na 1ª volta: (a) **~271 linhas ficariam órfãs** em `CandidatoDrawer.tsx` porque nenhum Step mandava apagar as declarações movidas — e `tsconfig.app.json` tem `noUnusedLocals: false`, então o `tsc` não acusaria; (b) o plano afirmava em 5 pontos que o rascunho local `contratacao_rascunho_entrevista_*` vive no `CandidatoDrawer`/`RegistroEntrevista` — **não vive**: `grep localStorage` nesse arquivo é vazio e o rascunho mora em `EntrevistasDoDia.tsx:38-41`, fora desta fase; (c) off-by-one na origem das bolhas (`:308-333`, não `:308-332` — `:332` é só o `})()}` do IIFE e cortaria a tag de fechamento); (d) `fmtKm` aparecia nas listas "manter" **e** "remover" dos imports do shell. Na correção o planejador ainda achou por conta própria que `vagasAbertas` (`CandidatoDrawer.tsx:61`) era usada pelo bloco "Vagas" mas nenhum Step mandava movê-la — sem isso `FichaResumo.tsx` não compilaria. 2ª volta: ✅ sem críticos, com as 36 importações do shell reclassificadas uma a uma (17 manter / 19 remover, soma conferida). |
| `fase-3` (T07–T10) | 1 | ✅ | 1 Crítico grave: `destinoDeAbaAntiga('candidatos')` devolvia `modoCandidatos: 'cards'` fixo, e **o teste do plano travava esse contrato errado**. Efeito: quem tem `contratacao_aba='candidatos'` + `contratacao_view='tabela'` gravados no aparelho passaria a abrir sempre em Cards, perdendo a preferência em silêncio — porque o `??` de `estadoInicialDeNavegacao` nunca cairia no fallback que lê o `localStorage`. Corrigido na função **e** no teste, que ganhou um caso de regressão nomeado. |
| `fase-4` (T11, T12) | 1 | ✅ | 1 Crítico: das 6 linhas do `<dl>` do antigo "Ver dados da vaga", 5 são campos da vaga e viram campos do formulário novo, mas a 6ª (`<Dado t="Loja">`, `Vagas.tsx:149`) mostra o **endereço da empresa** ou o aviso "Endereço não cadastrado (Configurações › Empresas)" — que é o que explica ao dono por que a distância dos candidatos não calcula. Desapareceria sem destino (Constraint 11). Corrigido com Step + item de DoD. Melhoria: citação de migration errada (`:17` → `:13`). O checklist de "nada da aba Links WhatsApp desapareceu" (13 itens) foi conferido item a item e estava completo. |
| `fase-5` (T13–T15, T19) | 1 | ✅ | Nenhum Crítico. O revisor confirmou no banco que todas as colunas que T14 acrescenta ao `select` existem, e conferiu **campo por campo** que o `Pick<Sess, 'id' \| 'pending_request'>` cobre tudo que `DecidirPedido` usa. Única ambiguidade (remover ou não o import morto do `BotaoAvisos`) fechada pelo orquestrador: remove, porque `noUnusedLocals: false` não acusaria. |
| `fase-6` (T16, T17) | 1 | ✅ | Nenhum Crítico. O revisor conferiu **operando por operando** que a trava de dados mínimos no lote é equivalente à de hoje (`page.tsx:317-348`) e que o caminho de um candidato só não muda. Confirmou por varredura das linhas `Bloqueia` que nenhuma task anterior depende da Fase 6 (ela é "adicional" e pode ser cortada inteira). |
| `cross` | 1 | ✅ | 3 Críticos: (1) briefing **§3.8(a)** ("filtro de empresa no topo só aparece com mais de uma empresa") não tinha task em fase nenhuma — hoje o seletor aparece com 1 empresa só (`page.tsx:540`, `> 0`) e T09 carregava a condição verbatim; virou parte de T09, trocando para `> 1` (o mesmo critério que `mostrarEmpresa` já usa em `page.tsx:508`); (2) briefing **§3.8(b)** ("esqueleto de carga em Conversas da IA") também não tinha task **e é contradito pelo RF-05**, que congelou `AgendamentosPainel` — **declarado fora do escopo** com motivo (esqueleto é visual novo, contra a Regra nº 1), no item 13 de "Pontos para o `/sdd-05-review`"; (3) T19 faltava no desenho do grafo. Melhoria: contagem do Mapa dizia 26/10/10=46, o certo é **25/10/10=45**. Confirmou ainda que **as ~15 interfaces que cruzam fase casam uma a uma** e que o plano **não** afirma em nenhum ponto que o dono aprovou algo. |

#### Ajustes de escopo decididos durante o Plan (além da T18 já registrada)

| # | Ajuste | Motivo |
|---|--------|--------|
| 8 | **`AgendamentosPainel.tsx` passa a ser "modificar" também por T14** (antes só por T04): exporta `DecidirPedido` e o tipo `Sess`. | RF-08 item 1 exige que o item de "Precisa de você" tenha Aceitar/Recusar **chamando `hiring-scheduler › decide`, sem mudança de contrato**. `DecidirPedido` (`AgendamentosPainel.tsx:49-139`) já faz exatamente isso, mas não é exportado. Exportar é 1 linha e zero mudança de comportamento; reimplementar seria duplicar a chamada à Edge. |
| 9 | **`EntrevistasDoDia.tsx` deixa de ser "nenhuma" e vira "modificar (só em T19)"**, com a task nova **T19** na Fase 5: o atalho "Ir para a próxima: seg 21/09 · 7 entrevistas" no dia vazio. | O planejador da Fase 5 levantou isso como BLOQUEIO (o arquivo é protegido pelo teste `entrevistasDoDia.test.tsx`). Mas deixar de fora entregaria a spec com a **última linha do RF-05 descoberta**, e o `/sdd-07-spec-review` reprovaria. É acréscimo puro (nenhuma prop muda, nada sai da tela), e o DoD de T19 exige o teste verde **sem editar o teste** e um cuidado explícito para não reabrir o bug de 2026-09-16 (trocar o dia reabrindo a 1ª entrevista por cima do deep link). |
| 10 | **Barra inferior usa "Config" (ou só o ícone `ri-settings-3-line` com `title`), não "Ajustes"** | O planejador perguntou se podia usar "Ajustes" por falta de espaço. "Ajustes" seria palavra nova na interface; a spec e o briefing dizem "Configurações" em todo lugar, e a Regra nº 1 limita a mudança a organização. |
| 11 | **Fase 4 segue o caminho de "escopo" em vez de recortar `LinksWhatsApp.tsx` em dois** | Decisão do planejador da Fase 4, aprovada: `LinksWhatsApp` ganha uma prop de escopo (canais de uma vaga × canais sem vaga/padrão) e é renderizado nos dois lugares; `VagaDivulgacao.tsx` e `ConfigWhatsApp.tsx` ficam invólucros finos. Atende o "escopo mínimo" do RF-06, não duplica a carga de `bot_channels`/`bot_conversations` e mantém a exclusividade do `is_default` num só lugar (`LinksWhatsApp.tsx:122`). |

#### Lacuna do research fechada no Plan

A `spec.md` §1 listava como lacuna "confirmar a constraint `ON DELETE SET NULL` de `bot_channels.job_id`". **Confirmado nas migrations durante o plano da Fase 4:** `bot_channels.job_id` é `ON DELETE SET NULL` e `hiring_job_scheduling.job_id` é `ON DELETE CASCADE`. Por isso o texto novo da confirmação de "excluir vaga" (pedido do briefing §3.4, "avisar na tela") pôde ser escrito de forma afirmativa, sem hedge.

#### Referência de gate medida nesta fase

| Comando | Resultado em 2026-09-20 |
|---------|-------------------------|
| `npx tsc --noEmit --project tsconfig.app.json \| grep -c "error TS"` | **287** (`scripts/baseline.json` diz 292 porque outra sessão já baixou) — nenhuma task pode passar de 287 |
| `npx vitest run` | **50 arquivos / 500 testes, 0 falhas** (medido) — a suíte não pode encolher |
| `scripts/baseline.json` › `vitest.total` | **211 — obsoleto.** O baseline é de 2026-09-16 e a suíte cresceu para 500 desde então. Consequência: `check.mjs --force` só reclama se o total ficar **abaixo de 211**, ou seja, hoje daria verde mesmo se ~290 testes sumissem. Por isso o gate desta spec manda medir `npx vitest run` antes e depois de cada task, em vez de confiar no baseline. **Não** corrigir com `--update-baseline` (proibido sem decisão do dono). |

- **Desvios da spec:** nenhum desvio de escopo. Duas correções de fato na spec (teste existente; Radix) e uma task nova dentro da onda 1 do dono (T18), todas registradas acima.
- **Gate de qualidade (fase 04):** N/A para código (fase de plano; nenhum arquivo de `src/` alterado). O `tsc` foi rodado só para **medir** a referência de 287.
- **Notas:** nenhum comando git que altere HEAD/index/working tree foi executado. Escrita restrita a `specs/2026-09-contratacao-reorganizacao-layout/` (`tasks.md`, `executions.md`). Nada tocado em `src/pages/financeiro/`, `src/hooks/useFinanceiro.ts`, `src/contexts/`, `supabase/` nem em qualquer arquivo já modificado no working tree da outra sessão.

---

### Research (sdd-02-research)

- **Status:** done
- **Data:** 2026-09-20
- **Executado por:** sessão research (fase 02, só leitura)
- **O que foi feito:**
  1. Lido `specs/briefing-contratacao-reorganizacao-layout.md` inteiro antes de tocar código.
  2. Confirmado no código atual (caminho:linha) todo o comportamento descrito no briefing §2, respondendo às 13 perguntas de research (estado de aba/`?aba=`/`localStorage`/`focoEntrevista`; modos de `CandidatosLista`; `Kanban`; origem da nota/vaga; ordem dos ~17 blocos do `CandidatoDrawer`; `wa_log`/`AgendamentosPainel`; `Vagas`/`VagaModal`/`AgendamentoVaga`/`LinksWhatsApp`/`bot_channels`; rascunho local/tempo real/presença de `EntrevistasDoDia`/`AgendaEntrevistas`; os 4 cards de `ConfiguracoesContratacao`; trava `required_waived_at`/`faltasFicha`; `BotaoAvisos`; testes existentes; padrões visuais a preservar).
  3. Resultado registrado em `spec.md` §1 "As Is" (seção "Comportamento atual" reescrita com evidência linha a linha + nova seção "Divergências entre o briefing e o código").
- **Achados que NÃO batem com o briefing (ver detalhe em spec.md §1):**
  - A "nota" já visível hoje (só na Tabela, `CandidatosLista.tsx:94`) é `avgScore` da entrevista, não `hiring_applications.score` (aderência à vaga) como o briefing sugere para os cards — decisão de qual nota mostrar fica pendente para `/sdd-03-specify`.
  - Onda 1 (nota+vaga no card) **não precisa de leitura nova no banco**: `applications` já é carregado em `page.tsx:151`, só falta repassar como prop — o alerta do briefing sobre "leitura nova estritamente necessária" não se aplica aqui.
  - Não há nenhum teste hoje em `src/test/**` cobrindo `contratacao`/`hiring` (busca vazia) — nada de suíte existente a proteger, só os testes novos previstos.
  - A faixa de upload tracejada não está duplicada em `Kanban.tsx`; é uma única renderização condicional no `page.tsx:626-664`.
  - `BotaoAvisos` ("Bloqueadas") é componente compartilhado fora de `src/pages/contratacao/` (`src/components/feature/BotaoAvisos.tsx`) — não lido nesta fase; qualquer mudança de rótulo pode sair do escopo direto da pasta.
- **Lacunas explícitas para a próxima fase (`spec.md` §1 "Lacunas do research"):** rótulo "Bloqueadas" dentro de `BotaoAvisos.tsx`; JSX exato das bolhas de `wa_log` em `AgendamentosPainel.tsx` (após linha 240); constraint `ON DELETE SET NULL` de `bot_channels.job_id` na migration (não lida, apenas inferida do comportamento).
- **Desvios da spec:** Nenhum — só leitura, nenhum arquivo de código tocado; nenhum comando git usado.
- **Gate de qualidade (fase 02):** N/A (research não altera código).
- **Notas:** `spec.md` frontmatter `status` atualizado para `research-done`; próxima fase é `/sdd-03-specify`.

---

## Execute (sdd-06-execute) — Fase 1: Cards + janela de upload (T01, T02, T18, T03)

- **Status:** done
- **Data:** 2026-09-20
- **Executado por:** sessão execute (fase 06, onda "Fase 1") — **dono ausente**; decisões abaixo tomadas sem pausa e registradas para auditoria. Rodou em paralelo com a Fase 2 (outro subagente, `CandidatoDrawer.tsx`/`ficha/*`/`AgendamentosPainel.tsx`) — nenhum desses arquivos foi tocado por esta sessão, conferido com `git status --short`.
- **Sem worktree:** trabalho direto no working tree compartilhado (mesma decisão já registrada na abertura da spec). Nenhum comando git que altere HEAD/index/tree foi executado (só `git status`/`git diff` para leitura). Ordem executada: T01 → T02 → T18 → T03 (T18 acrescentada por decisão do orquestrador no Plan, depende de T02; T03 é independente mas serializa em `page.tsx`, executada por último).

### T01 — `aderencia.ts`

- Criados `src/pages/contratacao/aderencia.ts` (`melhorAderencia`) e `src/test/lib/contratacaoAderencia.test.ts`, corpo copiado verbatim do Step 1/2 de `tasks.md` (task `snippets`, sem desvio).
- `npx vitest run src/test/lib/contratacaoAderencia.test.ts` → **7/7 passando** antes de seguir para T02.
- Confirmado depois (Fase 2, T06) que `CandidatoDrawer.tsx` já consome `melhorAderencia` de `../aderencia` com a mesma assinatura — nenhum ajuste necessário.

### T02 — Card e Kanban com aderência, vaga e "falta X"

- `page.tsx`: import de `melhorAderencia`/`type Aderencia`; `applicationsPorCandidato`, `aderenciaPorCandidato`/`aderenciaDe`, `faltasPorCandidato`/`faltasDe` (mesmo padrão de `Map` de `vagasPorCandidato`); repassados a `<Kanban>` e `<CandidatosLista>`.
- `CandidatosLista.tsx`: `Props`/`CandidateCard` ganham `aderenciaDe`/`faltasDe` (shell) e `aderencia`/`faltas` (card); chip "Aderência: X,X · Vaga" (`FIT[aderencia.fit].cls`) e chip "falta X"/"faltam X dados" (âmbar) inseridos no bloco de chips, logo após o chip de empresa; `Th k="nota"` ganha `title` distinguindo da aderência, texto do cabeçalho inalterado.
- `Kanban.tsx`: `Props` ganham `aderenciaDe`/`faltasDe`; chamada do `CandidateCard` repassa `aderencia={aderenciaDe(c)} faltas={faltasDe(c)}`.

### T18 — Kanban: chip de estado do agendamento pela IA

- `page.tsx`: interface `AgendamentoIASessao` + `schedSessions` (declaradas junto de `applications`, como pedido); leitura de `hiring_scheduling_sessions` (`select('candidate_id, job_id, status, updated_at')`, `order('updated_at', desc)`, `limit(500)`) acrescentada ao `Promise.all` de `carregar()`, sem tocar no canal `contratacao-tempo-real` (confirmado por leitura do arquivo após a task — continua só com `hiring_candidates`/`hiring_applications`/`hiring_interviews`); `agendamentoIAPorCandidato`/`agendamentoIADe` (primeira ocorrência = mais recente, já que a query vem ordenada); repassado só ao `<Kanban>`.
- `CandidatosLista.tsx`: mapa `AGENDAMENTO_IA` (cópia citada de `CandidatoDrawer.tsx:584-589`/`AgendamentosPainel.tsx:116-123`) declarado neste arquivo (não em `Kanban.tsx`) para não fechar ciclo de import — confirmado com `grep -n "from './Kanban'" CandidatosLista.tsx` → nenhuma linha; `CandidateCard` ganha `agendamentoIA` (assinatura + chip condicional, ícone `ri-robot-2-line`).
- `Kanban.tsx`: `Props` ganham `agendamentoIADe`; repassado ao `CandidateCard`. `CandidatosLista` (visão Cards) não passa `agendamentoIA` — chip só aparece no Kanban, como pedido.
- `AgendamentosPainel.tsx` **não foi tocado** por esta task (canal `contratacao-agendamentos` e `select('*')` de lá inalterados) — só foi lido para conferir a origem das classes de cor copiadas.

### T03 — Janela única "Adicionar currículos"

- Criado `src/pages/contratacao/components/UploadCurriculosModal.tsx`: invólucro copiado de `AdicionarCandidatosModal.tsx` (overlay + cartão + cabeçalho `ri-upload-2-line`/`ri-close-line`), corpo = JSX movido verbatim (área de soltar + fila de leitura), componente 100% controlado (nenhum `useState` novo).
- `page.tsx`: `QueueItem` exportado; novo estado `uploadOpen`; `pendingJobRef` removido (as 3 chamadas que o usavam foram reescritas para `setEmpresaUpload`/`setVagaUpload`/`setUploadOpen`, e o `onChange` do `<input>` chama `addFiles(e.target.files)` sem segundo argumento, caindo no fallback `vagaUpload || null` já existente em `addFiles`); botão "Adicionar currículos" agora só em `aba === 'candidatos' || aba === 'vagas'`; bloco "Área de soltar"/"Fila de leitura" removido do corpo (`else` do roteamento) e re-renderizado dentro do modal controlado.
- Verificado que nada ficou órfão: `pendingJobRef` não aparece mais em nenhum lugar do arquivo (`grep` sem resultado).

### Gate (Constraint 9, medido ao final da Fase 1 — T01+T02+T18+T03 juntos)

| Comando | Resultado |
|---------|-----------|
| `npx tsc --noEmit --project tsconfig.app.json \| grep -c "error TS"` | **287** (referência da spec: ≤ 287 — igual, 0 erros novos) |
| `npx vitest run` | **51 arquivos / 507 testes, 0 falhas** (500 de antes da spec + 7 de T01) |
| `npx vite build` | **exit 0**, sem erro (só os warnings pré-existentes de chunk grande e dynamic-import) |
| `node scripts/check.mjs --force` | **OK** — `tsc 287/292 · vitest 507/507 passando, 0 falhando`, exit 0 |

### Verificação visual

**Não realizada nesta sessão** — mesmo motivo já registrado na Fase 2: Constraint 7 exige login com `is_hiring_admin()` e este agente não tem credenciais/confirmação de acesso `qa.*` ao módulo. Conferência feita por leitura de código linha a linha contra o As Is (classes, ícones `ri-*`, textos idênticos aos originais) e pelo gate automatizado.

### Desvios do plano

Nenhum desvio de escopo ou de assinatura em relação a `tasks.md`. Único ajuste de forma (não de comportamento): a interface `AgendamentoIASessao` (T18) foi declarada dentro do corpo do componente, junto da linha de `useState` de `schedSessions`, em vez de no topo do arquivo — é o que o Step 1 de T18 pedia ("ao lado de `applications`"), e não afeta tipagem nem runtime (interfaces locais em TS não têm custo em cada render).

### Arquivos tocados

- Criados: `src/pages/contratacao/aderencia.ts`, `src/test/lib/contratacaoAderencia.test.ts`, `src/pages/contratacao/components/UploadCurriculosModal.tsx`.
- Modificados: `src/pages/contratacao/page.tsx`, `src/pages/contratacao/components/CandidatosLista.tsx`, `src/pages/contratacao/components/Kanban.tsx`.
- Não tocados (fora do escopo desta fase, confirmado): `CandidatoDrawer.tsx`, `components/ficha/*`, `AgendamentosPainel.tsx` (mudanças ali são da Fase 2, outro subagente).

---

## Execute (sdd-06-execute) — Fase 2: Ficha em 5 abas (T04, T05, T06)

- **Status:** done
- **Data:** 2026-09-20
- **Executado por:** sessão execute (fase 06, onda "Fase 2") — **dono ausente**; decisões abaixo tomadas sem pausa e registradas para auditoria. Rodou em paralelo com a Fase 1 (outro subagente, `page.tsx`/`CandidatosLista.tsx`/`Kanban.tsx`/`UploadCurriculosModal.tsx`) — nenhum desses arquivos foi tocado por esta sessão, conferido no fim com `git status --porcelain src/pages/contratacao/`.
- **Sem worktree:** trabalho direto no working tree compartilhado (mesma decisão já registrada na abertura da spec, item (a) das "Decisões Autônomas do Orquestrador"). Nenhum comando git que altere HEAD/index/tree foi executado (só `git status` para leitura).

### T04 — `ConversaWhatsApp`

- Criado `src/pages/contratacao/components/ConversaWhatsApp.tsx`: bolhas de `wa_log` + histórico do entrevistador, extraídas verbatim de `AgendamentosPainel.tsx` (helpers `MODELOS`/`textoModelo`, `phoneKey`, `ORIGEM`, `WaLog`, `Hist` agora `export`, `quando` duplicado). Query e JSX das bolhas movidos linha a linha conforme o Context pack (`:152-159` e `:308-333` do As Is).
- `AgendamentosPainel.tsx`: removidos os helpers/estado/`useEffect` migrados; import `ConversaWhatsApp, { type Hist }`; troca do bloco de bolhas por `<ConversaWhatsApp phone={s.phone} history={s.history} />`.
- Conferido por `grep`: nenhum import de `AgendamentosPainel` dentro de `ConversaWhatsApp.tsx` (sem ciclo).
- **Cache de `wa_log` — item sinalizado no `/sdd-05-review`:** confirmada a mudança de "por sessão" (`Record<string, WaLog[]>`, guardado por `session.id`) para "por montagem" (query de novo toda vez que a linha abre). É a Decisão já registrada em `tasks.md` (T04), aceita pelo plano como troca consciente. **Não tentei reaproveitar o cache por `session.id` do `AgendamentosPainel` dentro de `ConversaWhatsApp`** porque isso exigiria voltar a passar o cache de fora (prop) — o que reabriria exatamente o acoplamento que a extração busca evitar (a ficha do candidato, T06, não tem `session.id` nenhum para chavear esse cache) — e a task já documenta essa troca como aceitável, não pedida pelo dono, sem violar nenhuma constraint. Reporto aqui como pedido pela orientação da tarefa, sem otimizar nem piorar por conta própria.

### T05 — `ficha/*`

- Criados os 4 sub-componentes: `FichaResumo.tsx`, `FichaCurriculo.tsx`, `FichaEntrevistas.tsx`, `FichaHistorico.tsx`, todos em `src/pages/contratacao/components/ficha/`, com as assinaturas exatas de `tasks.md` § Interfaces.
- `Section` duplicada (não exportada) nos 4 arquivos, cada cópia com o comentário de origem exigido.
- Helpers privados por bloco: `SESS_LABEL`/`AgendamentoIA`/`firstNameOf`/`DadosMinimosForm` → `FichaResumo`; `RegistroEntrevista` → `FichaEntrevistas`; `EV_STYLE`/`quemFez`/`quando`/`HistoricoCandidato` → `FichaHistorico`. `vagasAbertas` movida para dentro de `FichaResumo` (calculada a partir de `props.jobs`/`props.applications`).
- Nenhum dos 4 arquivos importa de outro `ficha/*` nem de `CandidatoDrawer.tsx` (conferido por `grep`, sem ciclo com T06).

### T06 — Shell da ficha

- `CandidatoDrawer.tsx` reescrito: cabeçalho fixo (nome, idade, bairro, distância resumida via `fmtKm(dist.km)`, melhor nota/vaga via `melhorAderencia(applications, jobs)` de `../aderencia` — Fase 1/T01 —, decisão), barra de ações (fase, WhatsApp, atalho "Agendamento pela IA" para `setAba('resumo')`, currículo original, editar dados, menu "⋯" com Excluir), barra de 5 abas no padrão `border-b-2` de `page.tsx:564-571`, corpo com os 5 componentes (`FichaResumo`/`FichaCurriculo`/`FichaEntrevistas`/`FichaConversa`/`FichaHistorico`) sempre montados, alternados por classe `hidden` (preserva estado local ao trocar de aba).
- Criado `ficha/FichaConversa.tsx`: `phone = c.whatsapp || c.phone`; sem telefone mostra "Sem histórico."; com telefone monta `ConversaWhatsApp` só na primeira visita à aba (`visitou`) e mantém montado depois.
- Removido o rodapé antigo e as ~500 linhas de declarações órfãs (`RegistroEntrevista`, `EV_STYLE`/`quemFez`/`quando`/`HistoricoCandidato`, `SESS_LABEL`/`AgendamentoIA`/`firstNameOf`, `DadosMinimosForm`, `Section`) — conferido por `grep` sem resultado. Arquivo caiu de 709 para **207 linhas** (dentro da faixa estimada de 190-210 em `tasks.md`).
- Assinatura de `Props` de `CandidatoDrawer` **inalterada** — `page.tsx` não foi tocado (confirmado por `git status --porcelain`).
- **Prova dos ~20 blocos (nenhum some, mapa bloco→aba de `spec.md` §2 RF-04):** 1 (cabeçalho: decisão · Resumo: estrelas/empresa — fase foi para a barra de ações, correção do orquestrador já registrada em `tasks.md`), 2 (Resumo), 3 (cabeçalho: decisão · Resumo: ação de mudar), 4 (Resumo), 5 (Resumo), 6 (barra: atalho · Resumo: estado do agendamento IA), 7 (Entrevistas), 8 (Histórico), 9 (Currículo), 10 (cabeçalho: resumida · Currículo: detalhe), 11 (Resumo), 12 (Resumo), 13-18 (Currículo), 19 (Resumo), 20 (barra de ações: currículo original · menu "⋯": excluir).

### Gate (Constraint 9, medido ao final da Fase 2 — T04+T05+T06 juntos)

| Comando | Resultado |
|---------|-----------|
| `npx tsc --noEmit --project tsconfig.app.json \| grep -c "error TS"` | **287** (referência da spec: ≤ 287 — igual, nenhum erro novo nos arquivos tocados, conferido por `grep` no output do `tsc`) |
| `npx vitest run` | **51 arquivos / 507 testes, 0 falhas** (500 de antes da spec + 7 de T01/Fase 1, que rodou em paralelo — nenhum teste desta Fase 2, que é só UI) |
| `npx vitest run src/test/components/entrevistasDoDia.test.tsx` | **3/3 passando, arquivo não editado** — gate de regressão do `focoEntrevista` intacto |
| `npx vite build` | **exit 0**, sem erro (só os warnings pré-existentes de chunk grande e dynamic-import, nada novo) |
| `node scripts/check.mjs --force` | **OK** — `tsc 287/292 · vitest 507/507 passando, 0 falhando` |

### Verificação visual

**Não realizada nesta sessão.** Constraint 7 da spec exige login com `is_hiring_admin()` (dono ou `user_module_access`) para conferir visualmente a ficha em produção/preview, e este agente não tem credenciais de acesso ao módulo Contratação nem confirmação de que os usuários `qa.*` têm esse acesso. A conferência estrutural (mapa bloco→aba, classes/ícones idênticos, ausência de declarações órfãs, gate verde) foi feita por leitura de código linha a linha contra o As Is; a verificação visual (abrir a ficha de um candidato de teste, navegar pelas 5 abas, conferir que nada quebrou) fica pendente para o dono ou para quem tiver acesso ao painel.

### Desvios do plano

Nenhum desvio de escopo. Único ponto onde o plano já antecipava uma decisão não trivial (cache de `wa_log` por montagem em vez de por sessão, T04) foi seguido exatamente como registrado em `tasks.md`, com o registro adicional acima confirmando que a decisão foi mantida sem tentativa de "otimizar por conta própria" — meu escopo era T04/T05/T06, e essa restrição específica veio explícita nas instruções desta sessão.

### Arquivos tocados

- Criados: `src/pages/contratacao/components/ConversaWhatsApp.tsx`, `src/pages/contratacao/components/ficha/FichaResumo.tsx`, `.../ficha/FichaCurriculo.tsx`, `.../ficha/FichaEntrevistas.tsx`, `.../ficha/FichaHistorico.tsx`, `.../ficha/FichaConversa.tsx`.
- Modificados: `src/pages/contratacao/components/AgendamentosPainel.tsx`, `src/pages/contratacao/components/CandidatoDrawer.tsx`.
- Não tocados (fora do escopo desta fase, confirmado): `src/pages/contratacao/page.tsx`, `CandidatosLista.tsx`, `Kanban.tsx` (mudanças ali são da Fase 1, outro subagente).

---

## Revisão do plano (`/sdd-05-review`, 2026-09-20)

_Dono ausente. Revisor: subagente Sonnet 5. Só leitura de código/spec/tasks; nenhum arquivo de produção tocado; nenhum comando git usado. Não aprova/reprova — devolve achados ao orquestrador._

- **Relatório completo:** [`review-05.md`](./review-05.md).
- **Críticos:** nenhum encontrado (alinhamento briefing↔spec↔tasks completo; Regra nº 1 sem violação; mapa bloco→aba e aba→destino sem lacuna; oito itens do briefing §5 todos com dono explícito na spec/tasks; grafo de dependências sem inversão).
- **Importantes:**
  - Confirmar com o dono os itens **#2** (barra com 4 áreas até T14 — US-01 "5 abas" só fica cumprido no fim da Fase 5) e **#3** (intervalo sem Links WhatsApp entre T09 e T12) da tabela "Pontos para o `/sdd-05-review`" **antes de fechar as Fases 3/4**, especialmente se as fases puderem subir para `main` uma a uma (fechamento padrão do projeto é por entrega verificada, `AGENTS.md`) — o próprio plano avisa que o dono "veria" esse intervalo nesse caso.
  - T04: cache de `wa_log` muda de "por sessão" para "por montagem" (mais chamadas de rede ao reabrir uma linha em `AgendamentosPainel`) — decisão consciente e sem violar constraint, mas não pedida pelo briefing; registrar como mudança de comportamento não-visual.
- **Menores:** numeração fora de ordem na tabela de 13 decisões (11, 13, 12) — cosmético; T08 depende só de checklist textual (sem prints antes/depois) para a conferência visual manual das 9 abas — maior ponto de confiança-na-execução do plano.
- **Veredicto recomendado:** plano aprovável para iniciar execução (Fases 1 e 2 em paralelo); sem bloqueio Crítico. Itens #2 e #3 da lista de 13 pedem confirmação do dono antes do fechamento das Fases 3-4.

---

## Correções de revisão (4 fixes aceitos pelo orquestrador, 2026-09-20)

_Executor: sessão executor (Sonnet 5). Aplicados exatamente os 4 fixes decididos pelo orquestrador após dois revisores adversariais; nenhum outro achado dos revisores foi tocado. Nenhum comando git que altere HEAD/index/tree (só leitura)._

### FIX 1 (P1) — conversa aberta parou de atualizar sozinha

- `ConversaWhatsApp.tsx`: nova prop opcional `refreshKey?: string | number`, incluída nas dependências do `useEffect` que busca `wa_log` (`[phone, refreshKey]`).
- `AgendamentosPainel.tsx:274`: `<ConversaWhatsApp phone={s.phone} history={s.history} refreshKey={s.updated_at} />` — `s.updated_at` muda a cada `carregar()` (canal `contratacao-agendamentos` + polling 30s), então a conversa aberta volta a atualizar ao vivo sem re-render forçado quando nada muda (mesma sessão, mesmo `updated_at` → mesma dependência → efeito não roda de novo).
- `ficha/FichaConversa.tsx` não foi tocado — não passa `refreshKey`, comportamento dela (busca só uma vez ao visitar a aba) fica como está, conforme pedido.

### FIX 2 (P2) — sumir com o "Carregando…" novo

- `ConversaWhatsApp.tsx`: removido `if (logs === null) return <p>Carregando…</p>`. Agora, enquanto `logs === null`, o `itens` cai no ramo `(history ?? []).map(...)` (mesmo comportamento de antes deste componente existir); se não houver `history` nenhum, cai no mesmo `if (!itens.length) return <p>Sem mensagens registradas.</p>` que já existia — confirmado com `git show origin/main:...AgendamentosPainel.tsx` que esse era exatamente o texto usado antigamente para a lista vazia (linha 317 do arquivo antigo).

### FIX 3 (P2) — `visitou` não reseta ao trocar de candidato

- `ficha/FichaConversa.tsx`: adicionado `useEffect(() => { setVisitou(false); }, [c.id])`, no mesmo padrão do reset de `aba`/`editarDados`/`menuAberto` em `CandidatoDrawer.tsx`. Corrige o deep link `?candidato=` (`page.tsx:111`, que troca `selId` sem desmontar o drawer): a aba Conversa do candidato novo só busca `wa_log` se o usuário de fato visitá-la.

### FIX 4 (P2) — aderência não pode vir de vaga fechada

- Convenção real do campo confirmada por `grep` em `shared.ts` e no resto do módulo: `JobStatus = 'aberta' | 'pausada' | 'fechada'` (`shared.ts`); **o resto da tela trata "aberta" como `status !== 'fechada'`** (`FichaResumo.tsx:35`, `LinksWhatsApp.tsx:265/306/308`, `Vagas.tsx:40`, `page.tsx:408/472`) — ou seja, `pausada` ainda conta como opção viva em todo o módulo, só `fechada` é definitivamente descartada. Segui a mesma convenção em vez de presumir `'fechada'` como único valor de "fora".
- `aderencia.ts`: `melhorAderencia` passou a indexar `jobs` por objeto inteiro (`jobById: Map<string, Job>`, não só título) e pula a candidatura quando `job.status === 'fechada'`, mesmo tratamento de vaga apagada (sem chip de aderência).
- `contratacaoAderencia.test.ts`: `job()` ganhou parâmetro de status opcional; 2 casos novos — (a) só candidatura em vaga fechada → sem aderência; (b) uma aberta (score menor) e uma fechada (score maior) → vence a aberta, com comentário explicando por que a regra existe (vaga fechada não é mais uma opção real para o card anunciar).

### Gate

| Comando | Resultado |
|---------|-----------|
| `node scripts/check.mjs --force` | **OK** — `tsc 287/292 erros · vitest 509/509 passando, 0 falhando` (507 antes + 2 novos do FIX 4) |
| `npx vite build` | exit 0, sem erro novo (só os warnings pré-existentes de chunk grande e dynamic-import) |

### Arquivos tocados

- `src/pages/contratacao/components/ConversaWhatsApp.tsx` (FIX 1 + FIX 2)
- `src/pages/contratacao/components/AgendamentosPainel.tsx` (FIX 1)
- `src/pages/contratacao/components/ficha/FichaConversa.tsx` (FIX 3)
- `src/pages/contratacao/aderencia.ts` (FIX 4)
- `src/test/lib/contratacaoAderencia.test.ts` (FIX 4)

### Achado a reportar (não é dos 4 fixes, não aplicado)

Nenhum discordo dos 4 — todos batem com o código lido. Único ponto de atenção: o FIX 1 usa `s.updated_at` da sessão como `refreshKey`; isso dispara a query do `wa_log` a cada `updated_at` novo (recibos de entrega/leitura também tocam `updated_at`, não só mensagem nova) — é mais chamadas de rede que um `refreshKey` baseado só em "mensagem chegou", mas é a informação que já está disponível sem query nova, e é exatamente a garantia pedida ("nenhuma busca extra roda quando nada mudou": mesma sessão sem mudança nenhuma = mesmo `updated_at` = efeito não dispara de novo).

---

## Execute (sdd-06-execute) — Fase 3: Consolidação das abas (T07, T08, T09, T10)

- **Status:** done
- **Data:** 2026-09-20
- **Executado por:** sessão execute (fase 06, onda "Fase 3") — **dono ausente**; decisões tomadas sem pausa, seguindo `tasks.md` §T07-T10 verbatim onde a task era `contracts`/`snippets`. Sequencial (T07 → T08 → T09 → T10), como o grafo de dependências manda; T07 e T08 são "paralelo com" mas foram feitas em sequência na mesma sessão (arquivos disjuntos, sem conflito).
- **Sem worktree:** trabalho direto no working tree compartilhado. Nenhum comando git que altere HEAD/index/tree foi executado (só leitura via Read/Grep/Bash `git status`/`git diff` quando necessário).

### T07 — `navegacao.ts`

- Criados `src/pages/contratacao/navegacao.ts` e `src/test/lib/contratacaoNavegacao.test.ts`, corpo copiado verbatim dos Steps 1/2 de `tasks.md` (task `snippets`, sem desvio).
- `npx vitest run src/test/lib/contratacaoNavegacao.test.ts` → **13/13 passando**, incluindo a asserção explícita de regressão pedida pelo dono ("`candidatos` → Candidatos SEM forçar modo... `modoCandidatos` toBeUndefined()").

### T08 — Extrair as áreas de `page.tsx`

- Criados `areas/AreaConfiguracoes.tsx` (wrapper 1:1 de `ConfiguracoesContratacao`), `areas/AreaEntrevistas.tsx` (wrapper 1:1 de `EntrevistasDoDia`), `areas/AreaCandidatos.tsx` (extração do bloco de busca+filtro+alternância+Kanban/Lista, ~65 linhas, localizado pelo conteúdo "Busca (+ fases e modo de visualização..." como o aviso da task pedia, já que T02/T03/T18 tinham deslocado os números de linha do As Is).
- `page.tsx`: os 3 branches (`config`, `entrevistas`, `else`) trocados pelos componentes novos, mesmas props; `modoKanban`/`mostrarAlternanciaView` calculados a partir de `aba` como a Decisão 6 pedia; imports órfãos removidos (`ConfiguracoesContratacao`, `EntrevistasDoDia`, `CandidatosLista`, `Kanban`, `DECISIONS` deixaram de ser usados direto em `page.tsx`).
- Checklist das 9 abas (releitura do diff + `tsc` a cada Step, sem acesso a login `is_hiring_admin()` para conferência visual ao vivo — mesma limitação já registrada nas Fases 1/2): todas as 9 preservam exatamente as mesmas props/JSX de antes — ver checklist consolidado ao final desta entrada.

### T09 — Navegação de 5 áreas + engrenagem + compatibilidade

- `page.tsx`: `type Aba`/`const ABAS` removidos; `estadoInicialDeNavegacao()` (lê `destinoDeAbaAntiga(lsGet('contratacao_aba'))`, cai em `'entrevistas'` enquanto `'hoje'` não existir — Decisão 3); `area`/`view` (agora `ModoCandidatos`, 3 valores)/`focoSubabaEntrevistas` substituem `aba`/`view` antigos; `useEffect` de persistência trocado para gravar `area` em `contratacao_aba` (mesma chave, compatibilidade preservada); deep link (`?aba=`/`?entrevista=`/`?candidato=`) traduzido via `destinoDeAbaAntiga`, com a condição `dest?.subabaEntrevistas !== 'conversas'` no lugar de `a !== 'agendamentos'` (Decisão 8); barra trocada para `AREAS.filter((a) => a.id !== 'hoje')` + botão engrenagem `ml-auto`; branches `links`/`agenda`/`agendamentos` removidos (a função migrou para dentro de `AreaEntrevistas`); `aba !== 'config' && aba !== 'links' && companies.length > 0` virou `area !== 'config' && companies.length > 1` (briefing §3.8(a), corrigido pelo orquestrador no `cross`); `onOpenJob` do `CandidatoDrawer` (`setAba('vagas')`) corrigido para `setArea('vagas')` — não estava listado nos Steps da task mas é a mesma variável, teria quebrado em tempo de execução (`tsc` não pega, `Aba`/`aba` já não existiam mais).
- `areas/AreaEntrevistas.tsx`: reescrito com sub-abas Do dia/Calendário/Conversas da IA (`useState<SubAbaEntrevistas>`, `subabaInicial`/`onSubabaInicialUsada` no mesmo padrão de `focoId`/`onFocoUsado`); `EntrevistasDoDia`/`AgendaEntrevistas`/`AgendamentosPainel` recebem as mesmas props de antes (só que de dentro do wrapper).
- `areas/AreaCandidatos.tsx`: `mostrarAlternanciaView`/`modoKanban` saíram da `Props`; alternador ganhou o 3º botão (`kanban`, ícone `ri-layout-column-line` reaproveitado); `props.view === 'kanban' ? <Kanban/> : (...)` — o TS estreita `view` para `'cards' | 'tabela'` no `else`, compatível com `CandidatosLista` sem cast (conferido, sem erro novo de tipo).
- Imports órfãos removidos de `page.tsx` depois de T09: `AgendaEntrevistas`, `AgendamentosPainel`, `LinksWhatsApp` (nenhum dos três é mais chamado direto em `page.tsx` — migraram para dentro de `AreaEntrevistas`; `LinksWhatsApp.tsx` continua existindo, só não é mais importado por `page.tsx`, exatamente como a Constraint 11/nota da task autoriza — a função volta em Configurações › WhatsApp só em T12, spec futura).
- `npx vitest run src/test/components/entrevistasDoDia.test.tsx` → **3/3 passando, arquivo não editado**.

### T10 — Configurações na engrenagem com menu lateral

- `ConfiguracoesContratacao.tsx`: `Props` ganhou `secao?: SecaoConfig`; corpo ramificado (`!secao` mantém o empilhamento antigo como rede de segurança; com `secao`, renderiza só o card correspondente) — os 4 `Card`s (`Empresas`/`Fases`/`DadosMinimos`/`FichaEConvite`) não foram tocados por dentro.
- `areas/AreaConfiguracoes.tsx`: reescrito com `useState<SecaoConfig>('empresas')` + `ITENS_MENU` (4 itens: Empresas/Fases/Dados mínimos/Entrevista) + `<nav>` `flex flex-row sm:flex-col` (celular empilha em linha com rolagem horizontal, desktop vira coluna à esquerda) reaproveitando a família de classes do indicador ativo de aba (`border-rose-600 text-rose-700`/`border-transparent text-zinc-500`), só trocando `border-b-2` por `border-l-2` e acrescentando `bg-rose-50/60` (already-used tone) para legibilidade no celular.

### Checklist das 9 abas de hoje (DoD de T08, conferido por leitura do diff + `tsc`; sem login `is_hiring_admin()` disponível para clique real — mesma limitação de Fases 1/2)

| Aba (nome antigo) | Depois de T08 | Depois de T09/T10 |
|---|---|---|
| `entrevistas` | `AreaEntrevistas` → `EntrevistasDoDia`, idêntica; `focoEntrevista`/`onFocoUsado` intactos | Vira sub-aba "Do dia" dentro da área Entrevistas; mesmo componente, mesmas props |
| `candidatos` (cards) | `AreaCandidatos`, idêntica | Vira `view === 'cards'` dentro da área Candidatos (1 dos 3 modos) |
| `candidatos` (tabela) | `AreaCandidatos`, idêntica | Vira `view === 'tabela'` |
| `vagas` | Inalterada (branch não tocado) | Só a condição virou `area === 'vagas'`; `Vagas` intacto |
| `kanban` | `AreaCandidatos` (`modoKanban`), idêntica | Vira `view === 'kanban'` (3º botão do alternador, mesmo ícone) |
| `agenda` | Inalterada (branch não tocado) | Vira sub-aba "Calendário" dentro de `AreaEntrevistas` → `AgendaEntrevistas`, mesmas props |
| `agendamentos` | Inalterada (branch não tocado) | Vira sub-aba "Conversas da IA" dentro de `AreaEntrevistas` → `AgendamentosPainel`, mesmas props |
| `relatorios` | Inalterada (branch não tocado) | Só a condição virou `area === 'relatorios'`; `RelatoriosContratacao` intacto |
| `links` | Inalterada (branch não tocado) | **Removida da navegação** (autorizado pela Constraint 11 + Decisão de T09 — a função volta em Configurações › WhatsApp, T12; `LinksWhatsApp.tsx` continua existindo, só não é mais chamado) |
| `config` | `AreaConfiguracoes` → `ConfiguracoesContratacao`, idêntica (4 cards empilhados) | Vira menu lateral/lista com 4 itens (Empresas/Fases/Dados mínimos/Entrevista), um card por vez; nenhum dado/comportamento interno dos 4 cards mudou |

### Gate (Constraint 9, medido ao final da Fase 3 — T07+T08+T09+T10 juntos)

| Comando | Resultado |
|---------|-----------|
| `npx tsc --noEmit --project tsconfig.app.json \| grep -c "error TS"` | **287** (referência da spec: ≤ 287 — igual, 0 erros novos; conferido também logo após cada task, nunca subiu) |
| `npx vitest run` | **52 arquivos / 522 testes, 0 falhas** (509 antes desta fase + 13 novos de T07) |
| `npx vitest run src/test/components/entrevistasDoDia.test.tsx` | **3/3 passando, arquivo não editado** — gate de regressão do `focoEntrevista` intacto |
| `npx vite build` | **exit 0**, sem erro novo (só os warnings pré-existentes de chunk grande e dynamic-import) |
| `node scripts/check.mjs --force` | **OK** — `tsc 287/292 · vitest 522/522 passando, 0 falhando`, exit 0 |

### Verificação visual

**Não realizada nesta sessão** — mesmo motivo já registrado nas Fases 1/2: Constraint 7 exige login com `is_hiring_admin()` e este agente não tem credenciais/confirmação de acesso `qa.*` ao módulo. Conferência feita por leitura de código linha a linha contra o As Is (classes, ícones `ri-*`, textos idênticos aos originais), pelo checklist das 9 abas acima e pelo gate automatizado. Fica pendente para o dono: (1) conferir 1366px/1365px sem rolagem horizontal na barra (US-01); (2) gravar `contratacao_aba='kanban'`/`agenda`/`agendamentos`/`links` no `localStorage` antes de abrir a tela e confirmar que cai no destino certo; (3) conferir o filtro de empresa some com 1 empresa e aparece com 2+.

### Desvios do plano

- **T09:** `onOpenJob` do `CandidatoDrawer` (`setAba('vagas')`) não estava nos Steps de nenhuma task, mas usava a variável `setAba` que deixou de existir nesta task — corrigido para `setArea('vagas')` no mesmo Step que remove `type Aba`/`ABAS`, senão o arquivo não compilaria (`tsc` pegou na hora). Registrado aqui porque é uma referência que `tasks.md` não citou explicitamente, não porque mudou comportamento (mesmo destino: abre a vaga na área Vagas).
- Nenhum outro desvio de escopo ou de assinatura em relação a `tasks.md`.

### Arquivos tocados

- Criados: `src/pages/contratacao/navegacao.ts`, `src/test/lib/contratacaoNavegacao.test.ts`, `src/pages/contratacao/areas/AreaConfiguracoes.tsx`, `src/pages/contratacao/areas/AreaEntrevistas.tsx`, `src/pages/contratacao/areas/AreaCandidatos.tsx`.
- Modificados: `src/pages/contratacao/page.tsx`, `src/pages/contratacao/components/ConfiguracoesContratacao.tsx`.
- Não tocados (fora do escopo desta fase, confirmado): `Vagas.tsx`, `LinksWhatsApp.tsx`, `AgendaEntrevistas.tsx`, `AgendamentosPainel.tsx`, `RelatoriosContratacao.tsx`, `EntrevistasDoDia.tsx`, `CandidatoDrawer.tsx`, `ficha/*` (T04-T06, outra sessão), `src/test/components/entrevistasDoDia.test.tsx` (protegido, não editado).

---

## Execute (sdd-06-execute) — Fase 4: Vaga por dentro + Configurações › WhatsApp (T11, T12)

> Sessão sem o dono presente — decisões tomadas de forma autônoma conforme as Decisões já registradas em `tasks.md` (T11/T12), sem desvio de escopo. Todos os arquivos e trechos citados nas duas tasks foram conferidos no working tree real (herdado das Fases 1-3, já com `area`/`AREAS`/`navegacao.ts`) antes de editar — bateram exatamente com o que `tasks.md` descreve como "conferido em 2026-09-20" (`Vagas.tsx`, `VagaModal.tsx`, `LinksWhatsApp.tsx`, `navegacao.ts`, `AreaConfiguracoes.tsx`, os trechos de `page.tsx` citados por conteúdo).

### T11 — Vaga por dentro: 4 sub-abas

- `VagaModal.tsx`: extraído `VagaFormulario` (export) com os mesmos campos/placeholders/classes; `import AgendamentoVaga` removido (não usado mais aqui); o bloco `AgendamentoVaga`/aviso alternativo virou só o aviso amber quando `!job` (Decisão 4 — o agendamento sai do modal porque nunca mais há `job?.id` verdadeiro dentro dele).
- `LinksWhatsApp.tsx`: acrescentado `export type EscopoWhatsApp`; `Props` ganhou `escopo`; `channelsDoEscopo` (`useMemo`) filtra por `job_id`/`is_default` conforme o tipo; as 2 ocorrências de exibição (`.length === 0`, `.map`) trocadas para `channelsDoEscopo` (stats/carregar/salvar/alternar/excluir continuam sobre a lista completa, como pedia o Step 2); `CanalModal` ganhou `escopo`, valor padrão de `company_id`/`job_id` fixado pelo escopo `vaga`, e o bloco Empresa/Vaga virou texto fixo (escopo `vaga`) ou só o select de Empresa (escopo `sem-vaga`) — sem select de Vaga em nenhum dos dois (Step 3). A variável local `vagas` (Step 3, `CanalModal`) ficou sem uso ativo depois da troca — mantida como o próprio Context pack de T11 autoriza ("`company`/`job`/`vagas` continuam calculados exatamente como hoje... não mudam"; `noUnusedLocals: false` não acusa).
- Criado `src/pages/contratacao/components/VagaDivulgacao.tsx` — invólucro fino, escopo `{ tipo: 'vaga', jobId, companyId: job.company_id }`, verbatim do corpo da task.
- Criado `src/pages/contratacao/components/VagaDetalhe.tsx` — cabeçalho sem "Editar vaga" (lápis) e sem o toggle `verDados`/`<dl>`; sub-abas Candidatos/Divulgação/Agendamento pela IA/Dados da vaga no padrão `<button>`/`border-b-2` de `AreaEntrevistas`; bloco "Candidatos" movido verbatim de `Vagas.tsx` (`ScoreRing`/`Lista` também); `AbaDadosVaga` usa `VagaFormulario` + botão Salvar próprio e, abaixo do `<select>` de empresa, um `<dl>` com a linha "Loja" (endereço/cidade da empresa **ou** o aviso "Endereço não cadastrado...") reagindo à empresa escolhida no rascunho local — a correção do orquestrador citada em `tasks.md` (a 6ª linha do `<dl>` antigo não é campo da vaga, então não migrou para `VagaFormulario`).
- `Vagas.tsx`: recortado para `ListaVagas` + o switch `job ? <VagaDetalhe/> : <ListaVagas/>`; `DetalheVaga`/`ScoreRing`/`Lista`/`Dado` apagados (movidos/descartados conforme o Step 6); **`appKey` mantido** (não apagado) — `grep -rn "appKey" src/pages/contratacao` mostrou uso ativo em `page.tsx:23,224` (import + `appKey(jobId, candidateId)` dentro de `analyze`), então a condição do próprio Step 6 ("apagar **se** nada mais o importar") manda manter.
- `page.tsx`: criado `abrirCandidatoDoBot` (useCallback, logo após `saveJob`) com a busca de candidato ainda não carregado (Decisão 6); chamada de `<Vagas/>` trocada — removido `onEditJob`, acrescentado `onSaveJob={saveJob}`, `onOpenCandidate` trocado de `setSelId` para `abrirCandidatoDoBot`; `deleteJob` com o texto novo de aviso (agendamento apagado em cascata + link de WhatsApp perde a vaga), conforme Decisão 7/Step 8.

### T12 — Configurações › WhatsApp

- `navegacao.ts`: `SecaoConfig` ganhou `'whatsapp'`; `destinoDeAbaAntiga('links')` passou a devolver `{ area: 'config', secaoConfig: 'whatsapp' }`.
- `src/test/lib/contratacaoNavegacao.test.ts`: o `it()` de `'links'` (linha 29) atualizado para o novo valor esperado — `npx vitest run src/test/lib/contratacaoNavegacao.test.ts` → **13/13 passando**.
- Criado `src/pages/contratacao/components/ConfigWhatsApp.tsx` — invólucro fino, escopo `{ tipo: 'sem-vaga' }`, verbatim.
- `areas/AreaConfiguracoes.tsx`: `Props` ganhou `jobs`/`onOpenCandidate`/`secaoInicial`/`onSecaoInicialUsada`; `ITENS_MENU` ganhou o 5º item (`whatsapp`, `ri-whatsapp-line`); `useEffect` aplica `secaoInicial` (mesmo padrão de `focoId`/`onFocoUsado`); `secao === 'whatsapp'` renderiza `ConfigWhatsApp` antes de cair em `ConfiguracoesContratacao` (que não foi tocado — seu `SecaoConfig` importado agora tem 5 valores, mas os 4 `secao === ...` dele continuam iguais).
- `page.tsx`: estado `focoSecaoConfig` (junto de `focoSubabaEntrevistas`); import de `SecaoConfig` acrescentado à linha de `navegacao.ts`; deep link ganhou `if (dest.secaoConfig) setFocoSecaoConfig(dest.secaoConfig);`; chamada de `<AreaConfiguracoes/>` passou `jobs={jobs} onOpenCandidate={abrirCandidatoDoBot} secaoInicial={focoSecaoConfig} onSecaoInicialUsada={() => setFocoSecaoConfig(null)}`.

### Checklist item a item — o que "Links WhatsApp" oferecia e para onde foi (DoD extra de T12)

| Item de `LinksWhatsApp.tsx` (antes) | Onde está agora |
|---|---|
| Criar canal ("Novo link") | `VagaDivulgacao` (escopo vaga, T11) **e** `ConfigWhatsApp` (escopo sem-vaga, T12) — mesmo `CanalModal`, `escopo` diferente |
| Editar canal | Mesmo `Btn` "Editar" em ambos os escopos |
| Copiar link | Mesmo `Btn` "Copiar link" em ambos |
| QR Code | Mesmo `Btn`/`QrModal` em ambos |
| Ver conversas | Mesmo `Btn` "Conversas" → `ConversasDrawer`, em ambos |
| Marcar como resolvida | `ConversasDrawer.resolver`, inalterado, em ambos |
| Pausar/Ativar | Mesmo `Btn`, em ambos |
| Excluir canal | Mesmo `Btn`, em ambos |
| Badge "Padrão" (`is_default`) | Mesmo badge no card, em ambos (inclusive num canal de vaga que também seja padrão — Decisão 2 de T11, caso raro documentado) |
| Toggle `is_default` com exclusividade | Mesma lógica em `salvar` (`LinksWhatsApp.tsx`, não duplicada), acionável do `CanalModal` em qualquer escopo |
| Número do assistente (`contratacao_wa_number`) | Aparece nas duas telas — campo único via `localStorage`, não é listagem duplicada |
| Estatísticas por canal | Mesmo `Stat`, em ambos |
| Aviso de modo teste | Mesmo texto, em ambos |
| Busca de candidato ainda não carregado (chegou pelo WhatsApp) | `abrirCandidatoDoBot` (criado em T11, reusado em T12), em ambos |

`VagaDivulgacao` (T11) e `ConfigWhatsApp` (T12) — os dois destinos que substituem a aba "Links WhatsApp" (já removida da navegação em T09, Fase 3) — estão implementados e cobrem 100% da checklist acima; nada ficou órfão.

### Gate (Constraint 9, medido ao final da Fase 4 — T11+T12 juntos)

| Comando | Resultado |
|---------|-----------|
| `npx tsc --noEmit --project tsconfig.app.json \| grep -c "error TS"` | **287** (referência da spec: ≤ 287 — igual, 0 erros novos em `contratacao/`; `grep contratacao` no output do tsc não retornou nada) |
| `npx vitest run` | **52 arquivos / 522 testes, 0 falhas** (mesmo total desde T07/T09/T10 — esta fase só trocou o valor esperado de 1 `it()` já existente) |
| `npx vitest run src/test/lib/contratacaoNavegacao.test.ts` | **13/13 passando** |
| `npx vitest run src/test/components/entrevistasDoDia.test.tsx` | **3/3 passando, arquivo não editado** |
| `npx vite build` | **exit 0**, sem erro novo (só os warnings pré-existentes de chunk grande e dynamic-import) |
| `node scripts/check.mjs --force` | **OK** — `tsc 287/292 · vitest 522/522 passando, 0 falhando`, exit 0 (melhorou de 292 para 287 na baseline; **não** rodado `--update-baseline`, decisão do dono) |

### Verificação visual

**Não realizada nesta sessão** — mesmo motivo das Fases 1-3: sem login `is_hiring_admin()`/credenciais `qa.*` disponíveis para clique real no módulo. Conferência feita por leitura de código linha a linha contra o As Is (classes, ícones `ri-*`, textos idênticos), pela checklist item a item acima e pelo gate automatizado. Fica pendente para o dono: (1) abrir uma vaga e conferir as 4 sub-abas, com foco nas duas transições de comportamento — "Editar vaga" (lápis) sumiu do cabeçalho, e "Ver dados da vaga" virou a aba editável "Dados da vaga"; (2) conferir os dois casos do texto de "Loja" em Dados da vaga (empresa com endereço vs. sem endereço); (3) engrenagem → WhatsApp mostra os canais sem vaga/padrão; (4) gravar `contratacao_aba='links'` no `localStorage` (ou abrir com `?aba=links`) e confirmar que cai em Configurações › WhatsApp; (5) excluir uma vaga com agendamento/link de WhatsApp configurados e conferir o texto novo do aviso.

### Desvios do plano

- Nenhum desvio de escopo ou de assinatura em relação a `tasks.md` — as duas tasks tinham código quase inteiramente pronto (blocos `Steps` com o corpo completo dos arquivos), a única decisão de implementação real foi o `<dl>` da "Loja" em `AbaDadosVaga` (a "correção do orquestrador" descreve o requisito mas o bloco de código do Step 5 não o mostra escrito) — implementado com as mesmas classes de `Dado` (`Vagas.tsx:274-281`, conferidas antes de apagar o arquivo original), dentro de um `<dl>` (o código de exemplo da correção não especifica o wrapper HTML; `<dl>`/`<dt>`/`<dd>` é a marcação válida que o próprio `Dado` original usava).
- `appKey` (`Vagas.tsx`) mantido apesar de a orientação inicial do Step 6 ser "apagar" — o próprio Step trazia a condição "se nada mais o importar", e `page.tsx` importa e usa (`analyze`); confirmado por grep antes de decidir.

### Arquivos tocados

- Criados: `src/pages/contratacao/components/VagaDivulgacao.tsx`, `src/pages/contratacao/components/VagaDetalhe.tsx`, `src/pages/contratacao/components/ConfigWhatsApp.tsx`.
- Modificados: `src/pages/contratacao/components/VagaModal.tsx`, `src/pages/contratacao/components/LinksWhatsApp.tsx`, `src/pages/contratacao/components/Vagas.tsx`, `src/pages/contratacao/page.tsx`, `src/pages/contratacao/navegacao.ts`, `src/pages/contratacao/areas/AreaConfiguracoes.tsx`, `src/test/lib/contratacaoNavegacao.test.ts`.
- Não tocados (fora do escopo desta fase, confirmado): `AgendamentoVaga.tsx` (mesma assinatura, só o chamador mudou de lugar), `ConfiguracoesContratacao.tsx`, `AgendaEntrevistas.tsx`, `AgendamentosPainel.tsx`, `RelatoriosContratacao.tsx`, `EntrevistasDoDia.tsx`, `src/test/components/entrevistasDoDia.test.tsx` (protegido, não editado).

---

## Validação final (gate completo — `/sdd-07-spec-review`)

_Preenchido em fase `/sdd-07-spec-review`, após implementação._

| Comando | Resultado |
|---------|-----------|
| gate completo (tsc + vitest) | pending |

---

## Revisão da spec (`/sdd-07-spec-review`)

_Preenchido em fase `/sdd-07-spec-review`._

- **Resultado:** Aprovada | Reprovada
- **Data:** —
- **Goals vs. RF:** —
- **Gaps:** —

---

## Documentação (`/sdd-08-docs`)

_Preenchido em fase `/sdd-08-docs`._

- **Arquivos de documentação alterados:** —
- **N/A:** [ ] Sim — justificativa: —

---

## MR/PR (`/sdd-08-docs`)

_Preenchido em fase `/sdd-08-docs`._

- **`mr-template.md` preenchido:** [ ] Sim | [ ] N/A
- **Título MR/PR:** `contratacao-reorganizacao-layout` (sem ISSUE-KEY; sem issue tracker no projeto)

---

## Fechamento na issue (opcional)

_Não aplicável — sem issue tracker._

---

## ADR (opcional)

_Preenchido em fase `/sdd-08-docs` se aplicável._

- **Aplicável:** [ ] Sim | [ ] Não (provável: decision sobre 5 áreas vs. alternativas em `spec.md` §2 "Abordagens consideradas" já cobre)

---

## Checklist final da feature

_Preenchido ao fechar a entrega._

- [ ] Todas as tasks `done` com revisão do `/sdd-06-execute` aprovada
- [ ] Validação final: gate completo verde
- [ ] `/sdd-07-spec-review` aprovado
- [ ] `/sdd-08-docs` concluído
- [ ] Entrada em `specs/implementation-log.md`
- [ ] MR/PR aberta/merged
- [ ] Commit + push em `main` (sessão principal)

---

**Próximo:** `/sdd-02-research` — Validar arquivos atuais em `src/pages/contratacao/`, mapear componentes Radix + Tailwind, confirmar que a reorganização é viável sem quebrar visual/funcionalidade existente.

---

## Fix pontual pós-revisão Fase 4 (2026-09-20)

**Achado P1:** canal do WhatsApp com `job_id` (vaga) + `is_default = true` aparecia duplicado — na vaga (Divulgação) e em Configurações › WhatsApp — porque o filtro de escopo em `channelsDoEscopo` (`LinksWhatsApp.tsx`) tratava o ramo "sem vaga" como `!ch.job_id || ch.is_default`.

**Correção (`src/pages/contratacao/components/LinksWhatsApp.tsx`):**
1. `channelsDoEscopo`: ramo "sem vaga" trocado de `(!ch.job_id || ch.is_default)` para `!ch.job_id`. Agora cada canal aparece em exatamente um lugar: com `job_id` → só na vaga; sem `job_id` (inclusive legado com `is_default=true`) → só em Configurações.
2. `CanalModal`: toggle "Link padrão" escondido quando `escopo.tipo === 'vaga'` (não faz sentido um canal amarrado a uma vaga virar catch-all), evitando que o caso volte a ser criado pela tela.

**Casos conferidos:**
- Canal com `job_id` de vaga apagada: FK `bot_channels.job_id` é `ON DELETE SET NULL` (`20260914120000_bot_canais_publicos.sql`) → cai em "sem vaga", continua aparecendo em Configurações. OK.
- `is_default=true` sem `job_id`: `!ch.job_id` é `true` → aparece em Configurações. OK.
- Sem `job_id` e sem `is_default`: mesma condição, aparece em Configurações. OK.
- Vaga sem canal algum: `channelsDoEscopo` vazio, estado vazio original de `VagaDivulgacao`/`LinksWhatsApp` inalterado.
- Exclusividade do `is_default` (bloco de `salvar`, linha ~130): lógica não tocada, continua zerando outros antes de gravar.

**Gate:** `node scripts/check.mjs --force` → tsc 288/292 (baseline 292, sem novo erro meu — 1 erro novo é de `src/test/lib/contratacaoHoje.test.ts`, arquivo da Fase 5 em paralelo, fora do meu escopo); vitest 544/544 passando. `npx vite build` limpo.

---

## Fase 5 (Onda 5) — Tela Hoje + barra inferior (2026-09-20)

**Executor:** sessão principal (`/sdd-06-execute`), sem worktree (decisão já registrada na abertura da spec). Tasks T13 → T14 → T15 → T19, nesta ordem (sequenciais: T14/T15 mexem em `page.tsx`).

### T13 — `hoje.ts` (contagens + "Precisa de você")

Implementado por subagente executor (Sonnet), copiando o corpo do Steps 1-2 de `tasks.md` quase verbatim. **Achado na revisão do coordenador:** o teste (`src/test/lib/contratacaoHoje.test.ts`, caso "aguardando_gestor sem data exata") acessava `item.pedidoDataHora` sem estreitar o tipo da união `ItemPrecisaDeVoce` — `tsc` acusava `error TS2339` (288/292, 1 a mais que a referência de 287). O subagente tinha reportado "zero erros meus" sem checar as linhas do próprio arquivo no output do `tsc` (confiou só no `grep -c`). **Corrigido** trocando `item.pedidoDataHora` por `(item as { pedidoDataHora: string | null }).pedidoDataHora`, mesmo padrão de cast já usado na linha seguinte do próprio teste (`pedidoTextoLivre`). `hoje.ts` (código de produção) não foi alterado — estava correto. Depois do fix: `tsc` 287/292, `vitest run src/test/lib/contratacaoHoje.test.ts` 22/22 passando.
Arquivos: `src/pages/contratacao/hoje.ts` (criado), `src/test/lib/contratacaoHoje.test.ts` (criado, 22 testes).
**Lição registrada:** ao conferir o gate de uma task, ler as linhas de erro do `tsc` que citam os próprios arquivos, nunca confiar só na contagem (`grep -c`) — a contagem pode bater com a referência por coincidência enquanto esconde um erro novo compensado por uma melhora em outro lugar (aqui não foi o caso, mas o princípio vale sempre).

### T14 — Área Hoje

Implementado diretamente pela sessão principal (task grande, mas com o código já 100% especificado em `tasks.md`; risco maior estava em achar os pontos de inserção certos em `page.tsx`, que os subagentes já tendem a errar por causa do aviso "linhas do As Is, antes das Fases 1-4" — preferi fazer com leitura direta do arquivo real a cada passo).

- `src/pages/contratacao/components/AgendamentosPainel.tsx`: `interface Sess` → `export interface Sess` (corpo idêntico); `function DecidirPedido({ sess, onFeito }: { sess: Sess; ... })` → `export function DecidirPedido({ sess, onFeito }: { sess: Pick<Sess, 'id' | 'pending_request'>; ... })` (corpo da função inalterado; conferido que só lê `sess.id`/`sess.pending_request`).
- `src/pages/contratacao/page.tsx`: `interface AgendamentoIASessao` (local, dentro do componente) estendida com `id, error, confirmed_at, confirm_requested_at, interview_id, pending_request`; `select` de `hiring_scheduling_sessions` estendido para essas colunas (mesmo `order`/`limit`); `AREAS.filter((a) => a.id !== 'hoje').map(...)` → `AREAS.map(...)` (barra passa a mostrar as 5 áreas); branch `area === 'hoje' ? (<AreaHoje .../>) : ...` acrescentado antes dos demais na cadeia de ternários (a ordem real do arquivo é `config → vagas → entrevistas → relatorios → default candidatos`, diferente da ordem citada em `tasks.md`, mas o Mapa manda inserir na posição de "Hoje" em `AREAS`, então entrou como 1º branch); `<BotaoAvisos ...>` e seu comentário removidos do cabeçalho (agora vive dentro de `AreaHoje`); `import BotaoAvisos ...` removido; `import AreaHoje from './areas/AreaHoje'` acrescentado.
- `src/pages/contratacao/areas/AreaHoje.tsx` (criado): 3 números (`Kpi`, duplicado de `RelatoriosContratacao.tsx`), "Precisa de você" (`Card` + `BotaoAvisos` + os 3 tipos de item de `hoje.ts`, com `DecidirPedido` importado para `aguardando_gestor`), "Próximas entrevistas" (com `SeloPresenca` duplicado de `EntrevistasDoDia.tsx`, presença calculada a partir de `schedSessions`, sem 3ª leitura da tabela), "Vagas abertas" (card reduzido, mesmas classes de `Vagas.tsx`). Leitura própria de `bot_conversations` (`needs_human=true`, polling 60s) só dentro deste componente. Não importei `ageOf`/`jobTitulo` (não usados no JSX desta versão — mais limpo que o rascunho do plano, que os declarava sem usar).

Conferido: `grep BotaoAvisos src/pages/contratacao/page.tsx` → nenhuma linha; `grep "from '../components/EntrevistasDoDia'\|from '../components/RelatoriosContratacao'" AreaHoje.tsx` → nenhuma linha; `tsc` 287/292 (sem erro novo); `vitest run entrevistasDoDia.test.tsx` 3/3 (arquivo não tocado nesta task).

### T15 — Barra inferior + default Hoje

- `page.tsx`: `estadoInicialDeNavegacao()` simplificada (`area: dest.area`, sem a correção `=== 'hoje' ? 'entrevistas' : ...`); mesma remoção no efeito de deep link (`setArea(dest.area)`); raiz do JSX ganhou `pb-20 sm:pb-0`; `<BarraInferior area={area} onArea={setArea} />` inserido antes de `<DialogHost />`; import acrescentado.
- `src/pages/contratacao/components/BarraInferior.tsx` (criado): `<nav sm:hidden fixed bottom-0 ... z-30>`, 5 áreas + `AREA_CONFIG` (rótulo abreviado "Config", `title`/`aria-label` com o nome completo), layout emprestado de `MobileNav.tsx` (Tarefas), paleta/ícones de Contratação (`rose-700`/`zinc-500`, Remix `ri-*` já usados em `navegacao.ts`).
- **Achado:** `src/pages/contratacao/navegacao.ts` (`destinoDeAbaAntiga`) já tinha o default `'hoje'` no `case default` e o teste `contratacaoNavegacao.test.ts` já cobria isso — trabalho de uma fase anterior (T07/T09), nada a ajustar aqui. Só a correção em `page.tsx` (que travava em `'entrevistas'` enquanto `AreaHoje` não existia) precisava sair.

Conferido: `vitest run contratacaoNavegacao.test.ts` 13/13 (sem alteração); `tsc` 287/292.

### T19 — Atalho "Ir para a próxima" (dia vazio)

`src/pages/contratacao/components/EntrevistasDoDia.tsx`: import de `formatarDiaCurto`/`proximoDiaComEntrevistas` de `../hoje`; `useMemo` `atalhoProxima` logo após `const doDia = ...`; estado de dia vazio trocado de `<p>...</p>` solto para `<div>` com o `<p>` original + botão condicional (mesmas classes do botão "Hoje" do cabeçalho de dia). `focoId`/`focoAplicado`/o efeito de deep link não foram tocados. `entrevistasDoDia.test.tsx` **não editado**.

Rodado **antes** e **depois** da edição (Constraint 10): `vitest run entrevistasDoDia.test.tsx` → 3/3 nos dois momentos, 0 falhando.

### Gate da onda (Constraint 9), medido no fim das 4 tasks

- `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` → **287** (referência da spec: ≤ 287; baseline do projeto: 292). Nenhum erro em arquivo de Contratação (`grep -i contratacao` no output do tsc: vazio).
- `npx vitest run` → **53 arquivos / 544 testes, 0 falhando** (referência pré-T13: 50 arquivos/500 testes + 22 novos de `contratacaoHoje.test.ts` = 522 → bateu, com os 22 novos de T13 contados: 544).
- `npx vitest run src/test/components/entrevistasDoDia.test.tsx` → 3/3, arquivo de teste não editado em nenhuma task.
- `npx vite build` → exit 0, limpo (só os avisos pré-existentes de chunk grande / dynamic import, nada novo).
- `node scripts/check.mjs --force` → **exit 0** — `[check] OK — tsc 287/292 erros · vitest 544/544 passando, 0 falhando`. Não rodado `--update-baseline`.

**Nenhum comando git que altera HEAD/index/tree foi executado.** Nenhum arquivo fora do escopo desta onda foi tocado (`VagaDetalhe.tsx`/`VagaDivulgacao.tsx`/`ConfigWhatsApp.tsx`/`VagaModal.tsx`/`LinksWhatsApp.tsx`/`Vagas.tsx`, em revisão por outro subagente da Fase 4, não foram alterados por esta onda).

**Arquivos tocados/criados nesta onda:**
- Criados: `src/pages/contratacao/hoje.ts`, `src/test/lib/contratacaoHoje.test.ts`, `src/pages/contratacao/areas/AreaHoje.tsx`, `src/pages/contratacao/components/BarraInferior.tsx`.
- Modificados: `src/pages/contratacao/page.tsx`, `src/pages/contratacao/components/AgendamentosPainel.tsx`, `src/pages/contratacao/components/EntrevistasDoDia.tsx`.

**Pendências/divergências do plano vs. código real:**
- Ordem real da cadeia de ternários em `page.tsx` é `config → vagas → entrevistas → relatorios → default` (o `tasks.md` citava `vagas → entrevistas → relatorios → config → default`, do As Is antes das Fases 1-4) — o branch `hoje` foi inserido como 1º da cadeia (posição de "Hoje" em `AREAS`), consistente com a intenção do plano.
- `navegacao.ts`/`contratacaoNavegacao.test.ts` já tinham o default "Hoje" implementado por fase anterior — T15 só precisou remover a correção redundante em `page.tsx`.
- Verificação visual manual (Constraint 3, DoD de T14/T15/T19: 375px/1366px, `z-index`, estados do `BotaoAvisos`, clique no atalho) **não foi feita** nesta execução — depende de login com acesso ao módulo (RLS `is_hiring_admin()`), que exige o dono ou credenciais `qa.*` com esse acesso; fica para conferência humana antes do fechamento da spec.

### Fix P1/P3 — revisão da Fase 5: dois relógios diferentes para "hoje" em Contratação

**Achado da revisão:** `EntrevistasDoDia.tsx` agrupava as entrevistas por dia com `dayKey` (`shared.ts:429`, `getFullYear/getMonth/getDate` — fuso da MÁQUINA), enquanto `hoje.ts` (`diaKeyBR`) usa `Intl.DateTimeFormat` com `timeZone: 'America/Sao_Paulo'` fixo. Numa máquina com fuso diferente de Brasília, a lista (dayKey) e o atalho "Ir para a próxima"/tela Hoje (diaKeyBR) discordavam sobre qual é "hoje": o atalho podia apontar para um dia que a lista via como vazio.

**Correção (só `src/pages/contratacao/`, `dayKey` de `shared.ts` intocado):**
- `EntrevistasDoDia.tsx`: `const hoje = dayKey(new Date())` → `diaKeyBR(new Date().toISOString())`; grupo `porDia` (`dayKey(new Date(iv.scheduled_at))`) → `diaKeyBR(iv.scheduled_at)`; `setDia` do efeito de deep link (`focoId`) → `diaKeyBR(iv.scheduled_at)`. `addDias` (aritmética pura sobre a chave, sem reler um ISO) e `rotuloDia`/tira de dias (formatação local que já cancela o fuso, construção+leitura sempre na mesma máquina) não foram tocados — não são corte de dia por instante, não têm o bug.
- Verificado com `grep -rn "dayKey" src/pages/contratacao/`: além do arquivo acima, só `AgendaEntrevistas.tsx` usa `dayKey` — mas esse componente está órfão (não é importado por `AreaEntrevistas.tsx`/`page.tsx`, achado por grep; só se referencia a si mesmo), fora do fluxo real hoje. Não alterado (fora do escopo deste fix; sinalizado aqui para quem for limpar código morto depois).
- P3: `formatarDiaCurto` (`hoje.ts`) ganhou `timeZone: TZ` no `toLocaleDateString` do nome do dia da semana, para bater com o comentário do arquivo ("fuso fixo, não depende da máquina").

**Teste (novo arquivo, não editei `entrevistasDoDia.test.tsx`):** `src/test/components/entrevistasDoDiaFusoBR.test.tsx` força `process.env.TZ = 'UTC'` e `vi.setSystemTime` para simular uma máquina fora de Brasília, e renderiza `EntrevistasDoDia` com uma entrevista às 23h30 em Brasília (`2026-09-21T02:30:00Z`, já 21/09 em UTC) — confirma que ela aparece na aba "Hoje" (não cai num dia que a lista via vazio). Rodado antes/depois: falha com `dayKey` (revertido manualmente para confirmar), passa com `diaKeyBR`.

**Gate:** `node scripts/check.mjs --force` → tsc 288/292 (baseline 292; abaixo, sem regressão real — o único "erro novo" apontado pelo script é em `AreaCandidatos.tsx`, arquivo da Fase 6 em andamento por outro subagente, não tocado aqui, confirmado por `tsc ... | grep contratacao` sem nenhuma linha desta spec/fix); vitest 558/558, 0 falhando.

**Arquivos:**
- Modificados: `src/pages/contratacao/components/EntrevistasDoDia.tsx`, `src/pages/contratacao/hoje.ts`.
- Criado: `src/test/components/entrevistasDoDiaFusoBR.test.tsx`.

---

### Fase 6 — T16 (Filtros em etiquetas) + T17 (Seleção múltipla e ações em lote)

- **Status:** done
- **Data:** 2026-09-20
- **Executado por:** sessão execute (fase 06) — **dono ausente**; decisões tomadas e registradas aqui sem pausa para confirmação, seguindo o plano de `tasks.md` quase à risca (os dois Context packs traziam corpo de código completo, `plan_depth: contracts` com override `snippets` nas funções puras).
- **Verificação prévia do código real:** lidos `AreaCandidatos.tsx`, `CandidatosLista.tsx`, `Kanban.tsx`, `page.tsx`, `shared.ts`, `AdicionarCandidatosModal.tsx` antes de editar — todas as assinaturas/linhas citadas em `tasks.md` (Context pack, Interfaces, Steps) bateram com o código atual (T01–T15/T18/T19 já implementadas no working tree, como o pedido avisou), sem nenhuma task anterior desatualizada em relação ao plano.

**T16 — o que foi entregue:**
- Criado `src/pages/contratacao/components/FiltrosCandidatos.tsx`: lógica pura `aplicarFiltrosNovos` (filtro por vaga — título, via `vagasDe` — e "ficha incompleta", via `faltasDe`) + `ordenarPorAderencia` (decrescente por `aderenciaDe(c)?.score`, sem candidatura vai para o fim) + componente visual `FiltrosCandidatos` com as etiquetas "Todas as vagas"/1 por vaga/"Ficha incompleta"/"Ordenar por aderência", clonando literalmente as classes do chip de fase já existente.
- Criado `src/test/lib/contratacaoFiltrosCandidatos.test.ts` — 7 testes, corpo do plano copiado verbatim, todos verdes.
- `AreaCandidatos.tsx`: novo estado `filtrosNovos`; `buscadosComFiltrosNovos`/`buscadosParaKanban` (alimenta o Kanban) e `filtradosComFiltrosNovos`/`filtradosParaLista` (alimenta Lista/Tabela) como estágio extra depois de `props.buscados`/`props.filtrados`; `countsAjustados` recalculado a partir de `buscadosComFiltrosNovos` e usado nos chips de fase em vez de `props.counts`; vaga oferecida como etiqueta vem de `props.buscados` (amplitude antes do filtro de fase, Decisão 7 do plano).

**T17 — o que foi entregue:**
- Criado `src/pages/contratacao/components/AcoesEmLote.tsx`: lógica pura `candidatosTravadosNoLote(candidatos, stageDestinoId, stages, faltasDe)` — replica a regra de `updateCandidate` (origem `native_kind === 'novo'`, destino não é `novo` nem `descartado`, `faltasDe(c) > 0`) para N candidatos — + componente visual `AcoesEmLote` (contagem, "Marcar todos (N)"/"Limpar", `<select>` "Mover para…", "Enviar p/ IA agendar", "Descartar"), clonando as classes do rodapé de `AdicionarCandidatosModal.tsx`.
- Criado `src/test/lib/contratacaoAcoesEmLote.test.ts` — 6 testes, corpo do plano copiado verbatim, todos verdes.
- `page.tsx`: nova função `moveLote(ids, stageId)` — acha quem travaria (`candidatosTravadosNoLote`), faz **uma única** pergunta `confirmar()` para o lote inteiro (cancelar não move nada; aceitar grava `required_waived_at` só em quem estava travado) e grava em no máximo 2 chamadas `update(...).in('id', ids)` (com/sem o campo); `onMoverLote={moveLote}` repassado a `AreaCandidatos`. `updateCandidate` (caminho de 1 candidato — drag do Kanban, ficha) não foi tocado.
- `AreaCandidatos.tsx`: estado `selecionados: Set<string>` + `toggleSelecao`; `visiveis` = lista efetivamente mostrada no modo atual (`buscadosParaKanban` no Kanban, `filtradosParaLista` em Lista/Tabela); `useEffect` que poda a seleção para a interseção com `visiveis` sempre que essa lista muda (troca de filtro, de fase, de busca ou de modo); `AcoesEmLote` renderizado acima de `FiltrosCandidatos`, com `onEnviarParaAgendar`/`onDescartar` `undefined` quando a fase `native_kind` correspondente não existe (`stageByKind`).
- `CandidatosLista.tsx`: `Props` ganhou `selecionados`/`onToggleSelecao`; visão Cards repassa para `CandidateCard`; `Tabela` ganhou 1ª coluna de checkbox (`stopPropagation`, mesmo padrão da coluna do assistente); `CandidateCard` ganhou `selecionado`/`onToggleSelecao` opcionais — sem eles, o card é idêntico a antes (`if (!onToggleSelecao) return card`); com eles, o `<button>` original (inalterado por dentro) é envolvido por um `<div className="relative">` com o checkbox absoluto no canto, fora do `<button>` (`<input>` dentro de `<button>` não é HTML válido).
- `Kanban.tsx`: `Props` ganhou `selecionados`/`onToggleSelecao`, repassados à chamada do `CandidateCard`; `draggable`/`onDragStart` do card não mudaram (clique no checkbox não inicia o gesto de arraste HTML5).

**Como a seleção se comporta ao trocar de modo/filtro/aba (decisão registrada, Decisão 6 de T17):** o `Set<string>` de seleção é **um só**, compartilhado entre Cards/Tabela/Kanban (não há 3 seleções independentes). Trocar de modo, de fase, de busca, de decisão, de vaga ou de "ficha incompleta" **poda** a seleção para a interseção com quem continua visível — nunca zera de propósito, mas também nunca deixa selecionado escondido: quem sai de vista (por qualquer desses motivos) sai da seleção automaticamente, via `useEffect` reagindo à lista "visível atual". Isso evita o acidente descrito no pedido (descartar em lote alguém que não está mais na tela). A seleção não persiste em `localStorage` — reinicia a cada visita à tela (mesma decisão já tomada para as sub-abas em T09 e os filtros novos em T16).

**O que acontece em lote com candidato travado por dados mínimos:** `moveLote` primeiro separa, dentro do lote-alvo, quem cairia na trava (`candidatosTravadosNoLote`) de quem não cairia. Se ninguém cai, grava direto sem perguntar (igual ao caminho individual sem ficha faltando). Se alguém cai, aparece **uma única** janela "Ficha incompleta" citando os primeiros nomes de quem está incompleto e pedindo confirmação ("Mover mesmo assim") — não uma pergunta por candidato. **Cancelar não move ninguém do lote** (nem quem estava com ficha completa) — comportamento conservador escolhido no plano para não gravar parte do lote em silêncio. Aceitar move todo mundo: só quem estava travado ganha `required_waived_at`; os demais são gravados sem esse campo. Descartar nunca aciona a trava (mesma isenção de hoje). O caminho de 1 candidato (`updateCandidate`, usado pelo drag do Kanban e pela ficha) não foi alterado nem chama `moveLote` — continua perguntando individualmente como sempre.

**Onde os filtros/seleção valem (decisão registrada):** filtro de vaga, "ficha incompleta" e "ordenar por aderência" valem para **Cards e Kanban** (ambos consomem `buscadosParaKanban`/`filtradosParaLista`, já filtrados/ordenados). A **Tabela** mantém a própria ordenação interna (clique no cabeçalho, `SortKey`) — ela sempre reordena pelo `sort.key` atual, então a etiqueta "Ordenar por aderência" não muda a ordem visível na Tabela **por design já existente** (não é regressão desta task; registrado em "Fica para spec futura" no `tasks.md`). O filtro de vaga/ficha incompleta **também filtra** a Tabela (ela recebe `filtradosParaLista`, já filtrado) — só a ordenação por aderência que não a afeta. A seleção (checkbox) existe nos 3 modos.

**Gate de qualidade:**
- `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` → **287** (baseline `scripts/baseline.json` = 292; medido antes de começar = 298 — nota abaixo). **Zero** linhas com `contratacao` na saída do `tsc`.
- `npx vitest run src/test/lib/contratacaoFiltrosCandidatos.test.ts` → 7/7 passando. `npx vitest run src/test/lib/contratacaoAcoesEmLote.test.ts` → 6/6 passando.
- `npx vitest run` (suíte completa) → **56 arquivos / 558 testes, 0 falhando** (medido antes de começar: 53/544 — cresceu só pelos 2 arquivos novos desta fase + testes de outra sessão concorrente no mesmo working tree; nenhuma falha, nenhum arquivo sumiu).
- `npx vitest run src/test/components/entrevistasDoDia.test.tsx` → 3/3 verde, arquivo **não editado** por esta fase.
- `npx vite build` → exit 0, limpo (só os avisos pré-existentes de chunk grande/dynamic import).
- `node scripts/check.mjs --force` → **exit 0**: `[check] OK — tsc 287/292 erros · vitest 558/558 passando, 0 falhando`. **Não** rodado `--update-baseline`.

**Divergência do plano vs. medição real (registrada por transparência):** a referência de `tasks.md`/pedido de execução é "tsc ≤ 287" (medido em `/sdd-04-plan`, 2026-09-20, antes das Fases 1-5 existirem no working tree). Ao começar esta execução, `tsc` já media **298** (acima de 287) — ou seja, as Fases 1-5, já implementadas antes desta sessão, tinham deixado a contagem acima do teto citado no pedido, por motivo alheio a esta fase. Ao final desta fase (T16+T17), a contagem caiu para **287** (igual à referência original) — dentro do teto, e sem nenhum erro novo atribuível a `contratacao` em nenhum dos dois momentos. Não investiguei por que a contagem oscilou entre 298 e 287 durante a sessão (possível efeito de cache incremental do `tsc` ou de edição concorrente de outra sessão no mesmo working tree) — sinalizado aqui para quem revisar não interpretar como regressão desta fase.

**Nenhum comando git que altera HEAD/index/tree foi executado.** Nenhum arquivo fora do "Onde" das duas tasks foi tocado; não foi mexido em `hoje.ts`, `AreaHoje.tsx`, `BarraInferior.tsx`, `AgendamentosPainel.tsx` nem `EntrevistasDoDia.tsx` (arquivos da Fase 5 em revisão por outro subagente, confirmado por `git diff --stat` antes de fechar esta fase — só mostraram as mudanças já existentes de antes desta sessão, nada novo).

**Arquivos tocados/criados nesta fase:**
- Criados: `src/pages/contratacao/components/FiltrosCandidatos.tsx`, `src/pages/contratacao/components/AcoesEmLote.tsx`, `src/test/lib/contratacaoFiltrosCandidatos.test.ts`, `src/test/lib/contratacaoAcoesEmLote.test.ts`.
- Modificados: `src/pages/contratacao/areas/AreaCandidatos.tsx`, `src/pages/contratacao/page.tsx`, `src/pages/contratacao/components/CandidatosLista.tsx`, `src/pages/contratacao/components/Kanban.tsx`.

**Pendências:**
- Verificação visual manual (login com acesso ao módulo, `is_hiring_admin()`) não foi feita nesta execução — mesma pendência já registrada na Fase 5, fica para conferência humana antes do fechamento da spec.
- Com T16+T17 entregues, todas as 19 tasks de `tasks.md` (T01–T19) estão `done`; a spec inteira (Fases 1-6) está implementada no working tree, pendente apenas de `/sdd-07-spec-review`, verificação visual humana e do commit/push final pela sessão principal.

---

## Correção pós-execução — `AgendaEntrevistas.tsx` deixado de fora da unificação em `diaKeyBR` (2026-09-20)

- **Status:** done
- **Executado por:** sessão executora (Sonnet 5), a pedido direto do dono/orquestrador (fora do fluxo `/sdd-06-execute`, correção pontual de bug apontado pelo dono).
- **Contexto:** a Fase 5 (T13/T19) unificou `EntrevistasDoDia.tsx`/`hoje.ts` em `diaKeyBR` (corte do dia por Brasília, `Intl.DateTimeFormat` fixo em `America/Sao_Paulo`), mas o subagente daquela fase concluiu — errado — que `AgendaEntrevistas.tsx` era código morto e o deixou de fora. O arquivo **está no ar**: é a sub-aba "Calendário" de Entrevistas, importada e renderizada por `src/pages/contratacao/areas/AreaEntrevistas.tsx:3,50`. Continuava usando `dayKey` (`shared.ts`, fuso da máquina) em 5 pontos, causando divergência de dia entre o Calendário e a lista "Do dia" perto da virada, numa máquina com fuso diferente de Brasília.
- **O que foi corrigido em `src/pages/contratacao/components/AgendaEntrevistas.tsx`:**
  1. **Import:** trocado `dayKey` (de `../shared`) por `diaKeyBR` (de `../hoje`) — mesmo padrão de import de `EntrevistasDoDia.tsx`.
  2. **`diaSel` (estado inicial, celular):** `dayKey(new Date())` → `diaKeyBR(new Date().toISOString())`.
  3. **`byDay` (agrupamento das entrevistas por dia):** `dayKey(new Date(iv.scheduled_at))` → `diaKeyBR(iv.scheduled_at)` — mesma chave que `EntrevistasDoDia.tsx` usa para agrupar, com comentário explicando o motivo (evitar divergência na virada).
  4. **`hoje` (destaque do dia atual no grid):** `dayKey(now)` → `diaKeyBR(now.toISOString())`.
  5. **Chave da célula do calendário (`cells.map`):** **não** virou `diaKeyBR(d.toISOString())`. `d` é um `Date` sintético construído por aritmética local pura (`start.setDate(...)`), sem instante real anexado — ele já representa o dia certo do grid pelos próprios `getFullYear/getMonth/getDate`. Convertê-lo por `toISOString()` (UTC) e só então formatar em Brasília reintroduziria exatamente o tipo de deslocamento que se está corrigindo (a célula podia pular pro dia vizinho dependendo do fuso da máquina rodando o app). A correção foi **formatar os mesmos `y/m/d` do `Date` da célula diretamente** (`` `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` ``, sem chamar `dayKey` nem `diaKeyBR`), comentado no código. Isso preserva a grade do mês (nenhum dia some/duplica na virada) e mantém a célula compatível com as chaves de `byDay`/`hoje`, que agora são todas em Brasília.
- **Grep de confirmação** (`grep -rn "dayKey" src/pages/contratacao/`): sobra só a **definição** em `shared.ts:429` (intocada, outros módulos dependem dela) e o uso em `EntrevistasDoDia.tsx:34` (`addDias`, função de navegação dia-a-dia que soma/subtrai N dias a uma *chave* já calculada — não converte timestamp, é aritmética pura de calendário, igual ao caso da célula acima; pré-existente, não faz parte deste ticket). Nenhum uso remanescente de `dayKey` convertendo um `scheduled_at`/`created_at` real.
- **`fmtTime`/`fmtDateTime` (`shared.ts:427-428`):** **não usam** `timeZone: 'America/Sao_Paulo'` — usam `.toLocaleTimeString('pt-BR', {...})`/`.toLocaleString('pt-BR', {...})` sem `timeZone` explícito, ou seja, formatam a **hora exibida** no fuso da máquina do usuário. Isso é diferente do bug corrigido aqui (que era sobre em **qual dia** uma entrevista cai, não que horas mostrar) e afeta ~15 componentes do módulo que importam esses helpers — fora do escopo deste ticket. **Não mexi neles**, só reporto: se o dono quiser consistência total (a hora exibida também sempre em Brasília, independente do fuso do navegador), é uma decisão de escopo maior a tratar à parte.
- **Teste adicionado:** `src/test/components/agendaEntrevistasFusoBR.test.tsx` — força `TZ=UTC` no processo (`vi.setSystemTime` fixo em 2026-09-10, longe de virada de mês) e agenda uma entrevista às 23h30 de Brasília (`2026-09-21T02:30:00Z`, que já é dia 21 em UTC). Sem a correção, a entrevista cairia no quadrado "21" do calendário; com `diaKeyBR`, cai no quadrado "20" — o mesmo dia civil de Brasília que `EntrevistasDoDia.tsx` usaria. O teste localiza as duas células pelo texto do número do dia (`getByText('20'/'21', {selector: 'p'})`) e usa `within()` para confirmar que o nome do candidato aparece só na célula "20". Não editei `src/test/components/entrevistasDoDia.test.tsx` nem `entrevistasDoDiaFusoBR.test.tsx` (ambos continuam verdes, sozinhos).
- **Regra nº 1 (não mudar visual):** nenhuma classe, cor, ícone ou rótulo foi alterado — só as expressões que calculam a chave do dia.
- **Gate:**
  - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` → **287** (igual à referência da spec; nenhuma linha citando `AgendaEntrevistas.tsx` ou qualquer arquivo de `contratacao` na saída do `tsc`).
  - `npx vitest run` → **559/559 passando, 0 falhando** (558 de antes + 1 teste novo desta correção).
  - `npx vite build` → exit 0, limpo (só os avisos pré-existentes de chunk grande/dynamic import).
  - `node scripts/check.mjs --force` → `[check] OK — tsc 287/292 erros (13s) · vitest 559/559 passando, 0 falhando (48s)`. **Não** rodado `--update-baseline`.
- **Restrições respeitadas:** nenhum comando git que altera HEAD/index/tree (só leitura, quando necessário). Não tocado `src/pages/financeiro/`, `src/pages/estoque/`, `supabase/`, nem os arquivos da Fase 6 em andamento (`AreaCandidatos.tsx`, `CandidatosLista.tsx`, `Kanban.tsx`, `FiltrosCandidatos.tsx`, `AcoesEmLote.tsx`, `page.tsx`) — conferido antes e depois com `git status` (nenhum deles aparece nas minhas mudanças).
- **Arquivos tocados:**
  - Modificado: `src/pages/contratacao/components/AgendaEntrevistas.tsx`.
  - Criado: `src/test/components/agendaEntrevistasFusoBR.test.tsx`.

---

## Revisão da spec (fase 07 — `/sdd-07-spec-review`, 2026-09-20)

**Revisor:** sessão de revisão (Sonnet 5) + subagente de evidências (Sonnet 5), dono ausente — este relatório não aprova nem fecha a spec, devolve achados para o orquestrador decidir.

**Gate completo, rodado fresco nesta revisão:** `node scripts/check.mjs --force --build` → `tsc 287/292 erros (6s) · vitest 560/560 passando, 0 falhando (27s) · build OK (11s)`. Não rodado `--update-baseline`.

**Critérios de aceite (briefing §6):** 6 de 7 confirmados por leitura de código com evidência caminho:linha (5 áreas+engrenagem, "Adicionar currículos"/faixa do Kanban, card com nota+vaga, ficha em 5 abas+Conversa, compatibilidade de links/`focoEntrevista`, gate). O critério "visual idêntico" **não tem verificação visual ao vivo registrada em nenhuma das 6 fases** (`executions.md` repete "Verificação visual: não realizada nesta sessão" em T08/T14/T15/T16/T17) — pendência real, não só formalidade, por depender de login `is_hiring_admin()` que os usuários `qa.*` provavelmente não têm (Constraint 7 do briefing).

**Achado novo (severidade baixa/média):** o botão "Adicionar currículos" no cabeçalho aparece também na **lista de vagas** (antes de abrir uma vaga específica), não só "dentro da vaga" como o texto literal do critério sugere (`page.tsx`, condição `area === 'candidatos' || area === 'vagas'`). Não é regressão nem contradiz o briefing (§3.4 já previa um botão de upload por vaga), mas é uma leitura ligeiramente mais ampla do critério — vale confirmação do dono, não bloqueia.

**Itens do §3 (To Be):** nenhum item sem entrega e sem justificativa registrada. Dois itens fora do escopo com motivo (esqueleto de carga em Conversas da IA — contradiz RF-05, que congela `AgendamentosPainel`; fallback sem JavaScript — não aplicável a SPA). Onze outras decisões do orquestrador (não do dono) estão registradas na tabela "Pontos para o `/sdd-05-review`" de `tasks.md`.

**Não-regressão do §5:** todos os 8 itens confirmados presentes e funcionando no código atual (rascunho local, `contratacao_entrevistas_pos`, canal `contratacao-tempo-real`, tick de 60s, trava `required_waived_at` — agora também em lote —, `hiring_candidate_events`, WhatsApp≠telefone, `focoEntrevista`+selo de presença).

**Testes da lógica pura nova:** asserções fortes em todos os arquivos revisados (`toEqual`/`toBeUndefined` específicos, sem `toBeTruthy()` genérico nem snapshot vazio). Casos de borda citados no pedido de revisão — aderência ignorando vaga fechada, `destinoDeAbaAntiga('candidatos')` não forçando modo, corte de dia em Brasília (`diaKeyBR`), trava de dados mínimos no lote — todos cobertos com teste nomeado e comentário de intenção.

**Código órfão:** nenhum encontrado no estado final. Um subagente da Fase 5 chegou a classificar `AgendaEntrevistas.tsx` como código morto por engano (corrigido depois, registrado em "Correção pós-execução" acima) — achado de processo já sanado, sem órfão remanescente hoje.

**Coerência executions.md/tasks.md:** as 19 tasks (T01-T19) estão `done`. Duas inconsistências cosméticas encontradas: (1) `spec.md` frontmatter ainda diz `status: planned`, desatualizado frente ao estado real; (2) a nota "Fica para spec futura" sobre filtro de vaga por título (`tasks.md:4117`) ficou desatualizada — o código entregue (`FiltrosCandidatos.tsx`) já filtra por `job_id` (melhor que o próprio plano cogitava), com teste de regressão próprio (`contratacaoFiltrosCandidatos.test.ts`). Nenhuma decisão registrada contradiz o código.

**Dívidas técnicas conhecidas:** as três citadas no pedido de revisão estão registradas em `executions.md`/`tasks.md` e são dívidas conscientes, não bugs ativos — (a) `moveLote` duplica a regra da trava de `updateCandidate` por decisão explícita (evitar acoplar N-candidatos ao caminho de 1); (c) chip do agendamento IA sem tempo real por decisão explícita (evitar duplicar responsabilidade de canal, atraso máximo 60s aceito). (b) `fmtTime`/`fmtDateTime` no fuso do navegador (não Brasília) é a única sem task rastreável aberta — só existe como aviso em prosa; recomenda-se abrir um item formal, mesmo que pequeno, antes do fechamento total do módulo (não bloqueia esta spec, pois o bug de "qual dia" já foi corrigido via `diaKeyBR`; o que falta é só a hora exibida).

**Veredicto recomendado:** **aprovável para fechamento**, condicionado a (1) verificação visual humana real (Constraint 7 do briefing, ainda não feita em nenhuma fase) antes do commit final, e (2) decisão do dono sobre o escopo do botão "Adicionar currículos" na lista de Vagas (achado acima) — nenhum dos dois é um Crítico de código, ambos são confirmações de leitura de critério que só o dono pode dar. Sem gap de goal, non-goal violado ou restrição descumprida encontrados no código.

---

## Correção pontual — botão "Adicionar currículos" aparecia na lista de vagas (2026-09-20)

- **Status:** done
- **Executado por:** sessão executora (Sonnet 5), a pedido direto do dono/orquestrador (correção pontual do achado da revisão da fase 07 acima).
- **Achado confirmado:** o briefing (§3.3) e o critério de aceite (§6) dizem "só em Candidatos e dentro da vaga". O código exibia o botão em `area === 'candidatos' || area === 'vagas'` (`page.tsx:641`), ou seja, também na **lista** de vagas (antes de abrir uma vaga), não só dentro dela.
- **Onde estava a condição:** `src/pages/contratacao/page.tsx:641` — `(area === 'candidatos' || area === 'vagas') && (...)`.
- **Como ficou:** `(area === 'candidatos' || (area === 'vagas' && jobs.some((j) => j.id === selectedJobId))) && (...)`. Não criei estado novo: `selectedJobId` (linha 71) já existe e já era a fonte de verdade de "há uma vaga aberta" — é o mesmo dado que `src/pages/contratacao/components/Vagas.tsx:32-34` usa para decidir entre renderizar `VagaDetalhe` (vaga aberta) ou `ListaVagas` (lista): `const job = jobs.find((j) => j.id === selectedJobId) ?? null; return job ? <VagaDetalhe .../> : <ListaVagas .../>;`. Reproduzi a mesma checagem no cabeçalho (`jobs.some(...)` em vez de `.find` porque só preciso do booleano), usando a lista completa `jobs` (não a filtrada `jobsDaEmpresa`) — é a mesma variável de estado que a página já usa mais abaixo, no bloco do `onClick`, para achar `job` (`jobs.find((j) => j.id === selectedJobId)`).
- **Pré-seleção da vaga no modal (não regredida):** o corpo do `onClick` do botão não mudou — continua fazendo `const job = area === 'vagas' ? jobs.find((j) => j.id === selectedJobId) : null; setEmpresaUpload(job ? job.company_id ?? '' : ''); setVagaUpload(job ? job.id : ''); setUploadOpen(true);`. Confirmei por leitura: como o botão só aparece agora quando `jobs.some((j) => j.id === selectedJobId)` já é verdadeiro, o `job` calculado dentro do `onClick` nunca será `null` nesse caminho — a vaga clicada continua pré-selecionada no `UploadCurriculosModal` exatamente como antes. Na lista de vagas (`selectedJobId` nulo ou apontando para vaga já fechada/removida da lista), o botão simplesmente não aparece — quem quer subir currículo sem vaga usa a área Candidatos, como o briefing pede.
- **Regra nº 1 (não mudar visual):** nenhuma classe, cor, ícone ou texto tocado — só a condição booleana de exibição do botão existente.
- **`noUnusedLocals` / código morto:** nenhuma variável ficou sem uso; nenhum estado novo foi criado.
- **Gate:**
  - `node scripts/check.mjs --force` → `[check] OK — tsc 287/292 erros (6s) · vitest 560/560 passando, 0 falhando (28s)` (melhorou de 292 para 287; não travei baseline).
  - `npx tsc --noEmit --project tsconfig.app.json | grep -i "contratacao"` → nenhuma linha (conferido lendo a saída completa, não só a contagem).
  - `npx vite build` → `✓ built in 9.96s`, exit 0; só os avisos pré-existentes de chunk grande e dynamic import (nada novo citando `contratacao`).
- **Restrições respeitadas:** nenhum comando git de escrita (só leitura via `git status` no início da sessão, feita pelo ambiente). Não tocado `src/pages/financeiro/`, `src/pages/estoque/`, `supabase/`. Nenhum trabalho de banco.
- **Arquivo tocado:** `src/pages/contratacao/page.tsx` (linha 641, condição do botão "Adicionar currículos").
