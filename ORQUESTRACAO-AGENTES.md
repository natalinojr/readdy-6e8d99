# Orquestração de agentes para construir o ERPOS — desenho e plano

Data: 2026-09-15. Estado: **Fase 0.1 FEITA em 2026-09-15** (`scripts/check.mjs`, `scripts/baseline.json`,
hooks em `.claude/settings.json`, 15 testes velhos reescritos, bug de `getPeriodoAnterior` corrigido).
**Fase 0.3 FEITA em 2026-09-15**: `TESTES-CHECKLIST.md` v1 (15 módulos, ~110 passos) revisado pelo dono.
Ambiente: loja "Testes PDV" (tudo liberado) + usuários `qa.admin/qa.caixa/qa.garcom`
(`scripts/seed-test-users.mjs` → `.test-users.json`, gitignored) + Modo Treino fora dela.
**Fase 0.2 FEITA em 2026-09-16**: `dev_error_events` + Edge `client-errors` + `errorReporter.ts` + cron `dev-error-collect` (detalhes em `AI_SYSTEM_MAP.md`). Front pendente de push. 
**Fase 1 FEITA em 2026-09-16**: `.claude/agents/{triador,executor,testador,revisor}.md`, `.claude/workflows/{ciclo,auditoria-erros}.js`, trava `scripts/guard-git.mjs` (hook PreToolUse). Reiniciar a sessão para os tipos aparecerem. Próximo: rodar `/auditoria-erros` e `/ciclo` de verdade; Fase 2 quando estiver estável. Detalhes do
verificador em `AI_SYSTEM_MAP.md` › "Verificador determinístico".

## 1. Diagnóstico — por que hoje depende do dono

O gargalo não é "faltam agentes". É que a máquina não tem como saber sozinha
**o que é correto** e **o que está quebrado**:

| Falta | Consequência |
|---|---|
| Suíte de testes não confiável (185 testes, **15 quebrando** em 3 arquivos; ~350 erros de TS herdados) | um agente "testador" não distingue regressão de sujeira antiga |
| Nenhum teste de ponta a ponta (PDV, mesa QR, delivery, compras, impressão) | só o dono sabe clicar o fluxo certo |
| Nenhuma fila de erros (front, Edge Functions, print_queue, crons) | ninguém "avalia os erros" porque eles não chegam em lugar nenhum |
| Só existe o banco de produção; `push main` = deploy | agente autônomo não pode escrever no banco nem fazer push |

Então a ordem certa é: **fundação (o que é correto + o que quebrou) → agentes → autonomia**.
Agentes em cima de fundação vazia só multiplicam pedidos de "me diz o que testar".

## 2. Papéis (o que faz sentido, o que não faz)

Cinco papéis pedidos, reduzidos a quatro + o orquestrador:

| Papel | Ferramentas | Modelo | Entrada | Saída |
|---|---|---|---|---|
| **Triador** (avalia erros) | só leitura + Supabase logs | Sonnet | fila de erros / relato do dono | ticket: reprodução, arquivo(s) suspeito(s), severidade |
| **Executor** | tudo, em worktree | herda (Fable/Opus) | ticket | diff + explicação |
| **Testador** | Bash (vitest/build/tsc), Browser preview | Sonnet | diff + checklist do módulo | resultado objetivo (passou/falhou + evidência) |
| **Revisor** (verifica) | só leitura | Opus | diff | achados adversariais (bugs, RLS, multi-loja, CMV) |
| **Orquestrador** | Workflow script / sessão principal | — | pedido | pipeline com portões |

"Verificar" e "testar" não são dois agentes: o **Testador** roda coisas
(determinístico) e o **Revisor** lê código (julgamento). Juntos são o "verificar".

Contrato de pronto (Definition of Done) que o orquestrador impõe, sem IA:

1. `tsc` não aumentou a contagem de erros em relação ao baseline.
2. `vitest` não tem falha nova (baseline registrado).
3. `vite build` passa.
4. Checklist do módulo afetado (ver §3.3) executado no preview e evidenciado (screenshot/read_page).
5. Revisor sem achado P0/P1 aberto.
6. **Push em `main` liberado desde 2026-09-18** (decisão do dono): a sessão principal commita e sobe depois da verificação. Subagentes não commitam.

## 3. Fase 0 — fundação (1 a 2 dias, sem agentes novos)

### 3.1 Baseline verde e mensurável
- Consertar ou colocar em quarentena os 15 testes quebrados (`src/test/integration/*`, etc.).
- Script `scripts/check.mjs` que imprime **delta vs baseline**: erros TS, testes, build.
  Baseline gravado em `scripts/baseline.json` (tsc: N, vitest: pass/fail por arquivo).
- Hook `PostToolUse` (Edit/Write) em `.claude/settings.json` roda `check.mjs --fast`
  (só tsc count + testes do arquivo tocado). Hook `Stop` roda o check completo.
  É o "verificador" mais barato que existe: zero tokens.

### 3.2 Fila de erros (o que o Triador vai ler)
- Front: `window.onerror` + `unhandledrejection` + erro de Supabase → Edge `client-errors`
  → tabela `dev_error_events` (tenant, rota, user agent, stack, hash p/ dedup, contagem).
- Backend: view/cron que junta `print_queue.status='failed'`, falhas de `assistente-cron`,
  Edge Functions 5xx (via `query_logs` do MCP Supabase) na mesma tabela.
- Alternativa mais rápida: Sentry free tier no front + Edge. Decidir pelo custo de manutenção;
  a tabela própria tem a vantagem de o assistente e os agentes lerem via SQL.

### 3.3 Checklists por módulo (o que o Testador vai executar)
Arquivo `TESTES-CHECKLIST.md`: para cada módulo, 5–10 passos objetivos com dado de
entrada e resultado esperado (ex.: "PDV › venda dinheiro R$ 10 com troco → caixa soma,
pedido `paid`, item de impressão enfileirado"). O dono escreve uma vez; os agentes
reutilizam para sempre. É aqui que sai o "depende de mim dizer o que testar".

### 3.4 Ambiente seguro
- Código: `git worktree` por tarefa (já existe `.claude/worktrees/`). Agente nunca toca `main`.
- Banco: hoje só produção. Opções: (a) Supabase Branching (Pro) — banco efêmero por branch;
  (b) projeto `erpos-staging` com dump semanal; (c) por ora, agentes só **leem** produção
  e testes de escrita rodam em mocks/`src/mocks`. Recomendo (c) agora e (b) quando os E2E existirem.
- Vercel: consertar as variáveis de Preview (pendente por bug da CLI) para cada PR
  ter URL própria; o Testador testa na URL de preview, não no `main`.

## 4. Fase 1 — agentes e pipeline (2 a 3 dias)

### 4.1 Subagentes em `.claude/agents/`
```
triador.md    tools: Read, Grep, Glob, Bash(git log*), mcp supabase query_logs/execute_sql (só SELECT)  model: sonnet
executor.md   tools: * (sem push)  model: inherit  isolation: worktree
testador.md   tools: Bash, Read, Browser pane  model: sonnet
revisor.md    tools: Read, Grep, Glob  model: opus
```
Cada um com system prompt curto apontando para `AI_SYSTEM_MAP.md`, `TESTES-CHECKLIST.md`
e as regras duras (RLS multi-loja, CMV = compras, nunca push main).

### 4.2 Workflow `/ciclo` (`.claude/workflows/ciclo.js`)
```
pedido → Triador (ticket) → Executor (diff em worktree)
       → [portão determinístico: check.mjs] → Testador + Revisor em paralelo
       → se falhou: volta ao Executor com os achados (máx. 2 voltas)
       → PR aberto com relatório (o que mudou, evidências, riscos)
```
Portões determinísticos antes dos agentes: barato e elimina metade dos loops.

### 4.3 `/auditoria-erros`
Workflow só de leitura: Triador varre `dev_error_events` das últimas 24h, agrupa,
gera tickets em `dev_tickets` (ou tarefas do módulo de Tarefas na pasta "Dev").
Isso é a "IA: auditoria contínua" que o dono achou o uso mais interessante.

## 5. Fase 2 — autonomia (quando a Fase 1 estiver rodando estável)

- **Routine noturna (cloud)**: `/auditoria-erros` às 06h, resultado no Telegram via
  `assistente-brain`. Roda na nuvem da Anthropic com clone do repo; usa o MCP do Supabase.
- **Gatilho de GitHub**: a cada PR, routine roda Testador + Revisor e comenta no PR.
- **Fila de jobs do assistente** (§7, opção C): o dono manda "corrige o erro X" pelo Telegram
  e o ciclo roda sem abrir o desktop.

## 6. Fase 3 — E2E (o investimento que mais reduz dependência do dono)

Playwright contra o preview, 6 fluxos: PDV venda, mesa QR, delivery no caixa, nova compra
(QR SEFAZ com fixture), baixa de conta com DRE, impressão (mock do agente). Com isso o
Testador testa de verdade, não só "clicou e não deu erro".

## 7. Assistente pessoal (Telegram) comandando o Claude Code

Quatro caminhos, do mais barato ao mais integrado:

| Opção | O que é | Prós | Contras |
|---|---|---|---|
| **A. Remote Control** (oficial) | ligar o interruptor na sessão do desktop; dirigir pelo app Claude no celular | zero código; permissões e contexto iguais aos daqui; já existe | não passa pelo assistente; PC ligado com sessão aberta; 1 sessão por instância |
| **B. Channels: plugin Telegram** (oficial, preview) | um bot do Telegram empurra mensagens para a sessão CLI aberta (`claude --channels plugin:telegram`) | oficial; allowlist por pareamento | precisa de **outro bot** (o do assistente já tem webhook no Supabase; um token não pode ter webhook e polling ao mesmo tempo); exige Bun; sessão CLI aberta; sem o contexto do assistente |
| **C. Fila de jobs + worker local** (custom) | ferramenta `dev_pedido` no brain → tabela `asst_dev_jobs` → worker Node no PC (Realtime) roda `claude -p` em worktree → PR + resposta no Telegram | o assistente orquestra e conhece o ERPOS; fila, histórico e auditoria; funciona sem o app aberto; ele já responde "como o dono" | ~1 dia de trabalho; `claude -p` **não pede permissão**, então o perfil tem que ser restrito; PC ligado; superfície de injeção (grupos do WhatsApp) |
| **D. Routine por API** (oficial) | brain chama `POST /fire` de uma routine na nuvem com o texto do pedido | PC desligado serve; sandbox; sem worker | sem acesso a PC/impressoras/preview local; secrets na nuvem; só branch `claude/*`; custo por execução |

### Recomendação
1. **Agora**: ligar **A** (Remote Control) — resolve "dar comando do celular" hoje, sem código.
2. **Fase 2**: **C** como integração real, com estas travas:
   - só do chat do dono no Telegram, **nunca** a partir do relay de grupos do WhatsApp;
   - pedido vira job só após confirmação com PIN (mesmo PIN do `erpos_executar`);
   - worker roda `claude -p` com `--permission-mode acceptEdits`, allow-list
     (`Read, Edit, Write, Bash(npm run *), Bash(npx vitest*), Bash(git checkout/commit/push origin claude/*)`),
     deny para `git push origin main`, sem MCP do Supabase com escrita;
   - sempre em worktree em branch `claude/<job-id>`; saída = PR + resumo; o merge é humano;
   - job tem timeout, custo máximo e log em `asst_dev_jobs` (status, tokens, PR URL).
3. **D** para o que é agendado (auditoria noturna), não para comando ad hoc.
4. **B** opcional para experimentar; não vale montar um segundo bot só para isso.

### Riscos gerais (valem para tudo acima)
- **Produção**: push em `main` publica. Desde 2026-09-18 a sessão principal pode fazê-lo, depois de verificar; subagentes não.
- **Custo**: um ciclo completo (4 agentes + 2 voltas) custa na faixa de US$ 1–5 com Opus;
  medir nos primeiros 10 jobs e gravar em `asst_dev_jobs.usage`.
- **Injeção de prompt**: erros e mensagens que os agentes leem (stack traces, currículos,
  grupos) são dados, não ordens; os system prompts dos agentes têm que dizer isso.
- **Loop infinito**: máx. 2 voltas Executor↔Testador; depois devolve para o dono.
- **Windows**: hooks e worker em Node/PowerShell, não bash puro (Git Bash existe, mas
  o worker tem que sobreviver a reboot: NSSM ou Tarefa Agendada).

## 8. Ordem de execução sugerida

1. Fase 0.1 (baseline verde + `check.mjs` + hooks) — primeiro, porque tudo depende dele.
2. Fase 0.3 (checklists por módulo) — o dono escreve com ajuda; 1 sessão.
3. Fase 0.2 (fila de erros) — tabela + Edge + front.
4. Fase 1 (subagentes + `/ciclo` + `/auditoria-erros`).
5. Remote Control ligado (opção A) — pode ser hoje.
6. Fase 2 (routine noturna, gatilho de PR, opção C).
7. Fase 3 (E2E).
