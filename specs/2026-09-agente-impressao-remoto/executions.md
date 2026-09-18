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

## Próximas fases

- [ ] **Fase 02 — Research** (`/sdd-02-research`): mapeamento do agente atual, Edge `print-queue-agent`, storage do token, comunicação PC→servidor.
- [ ] **Fase 03 — Specify** (`/sdd-03-specify`): detalhamento de goals/UX/non-goals, usuários, fluxo de onboarding.
- [ ] **Fase 04 — Plan** (`/sdd-04-plan`): tasks e ondas de implementação.
- [ ] **Fase 05 — Review** (`/sdd-05-review`): revisão adversarial do plano.
- [ ] **Fase 06 — Execute** (`/sdd-06-execute`): código.
- [ ] **Fase 07 — Spec Review** (`/sdd-07-spec-review`): validação do código contra spec.
- [ ] **Fase 08 — Docs** (`/sdd-08-docs`): documentação e MR.
- [ ] **Finish** (`finish-branch`): merge e fechamento.
