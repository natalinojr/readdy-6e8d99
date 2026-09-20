# Executions: {titulo}

> Spec: [spec.md](./spec.md) · Tasks: [tasks.md](./tasks.md)

**Branch:** `feat/PROJ-XXXX` · **Base:** conforme [sdd-branch.md](../templates/sdd-branch.md) e [AGENTS.md](../../AGENTS.md)

Legenda: `pending` · `in_progress` · `blocked` · `done` · `skipped`

## Resumo

| Task | Status | Início | Fim | Responsável |
|------|--------|--------|-----|-------------|
| T01 | pending | | | |

---

## Registro por task

### T01: {título}

- **Status:** pending
- **Plano de execução (passo 06):** [ ] Sim — aprovado em ___ | [ ] Dispensado
- **Branch / MR:**

#### O que foi feito

<!-- Lista objetiva de alterações -->

#### Desvios da spec

<!-- Se houve, exigir atualização de spec.md antes de merge -->

#### Gate de qualidade (iterativo — ver AGENTS.md)

| Comando | Resultado | Observação |
|---------|-----------|------------|
| gate iterativo (lint/compile) | | |
| gate iterativo (testes) | | |
| gate iterativo (build) | | |

#### Revisão de task (loop do `/sdd-06-execute`)

- **Modo:** subagentes | mesma sessão
- **Resultado:** Aprovada | Aprovada com ressalvas | Reprovada | Escalada ao dev
- **Data:**
- **Itens:** ...

#### Notas

---

## Validação final (gate completo — `/sdd-07-spec-review`)

| Comando | Resultado |
|---------|-----------|
| gate completo (ver AGENTS.md) | |

## Revisão da spec (`/sdd-07-spec-review`)

- **Resultado:** Aprovada | Reprovada
- **Data:**
- **Goals:** ...
- **Gaps:** ...

## Documentação (`/sdd-08-docs`)

- **Arquivos de documentação alterados:** ...
- **N/A:** [ ] Sim — justificativa: ...

## MR/PR (`/sdd-08-docs`)

- **`mr-template.md` preenchido:** [ ] Sim | [ ] N/A — justificativa: ...
- **Título MR/PR:** `{ISSUE-KEY}-{slug}`

## Fechamento na issue (opcional)

- **Perguntado ao dev se deseja comentário final na issue:** [ ] Sim
- **Decisão do dev:** [ ] Publicar | [ ] Não publicar
- **Execução via ferramenta do projeto:** [ ] Sim | [ ] N/A
- **Link/comentário:** ...

## ADR (opcional, quando aplicável)

- **Perguntado ao dev se deseja ADR:** [ ] Sim
- **Aplicável para esta spec:** [ ] Sim | [ ] Não
- **Decisão do dev:** [ ] Criar ADR | [ ] Não criar ADR
- **Arquivo ADR:** path em `AGENTS.md` | N/A

---

## Checklist final da feature

- [ ] Todas as tasks `done` com revisão do `/sdd-06-execute` aprovada (gate iterativo por task)
- [ ] Validação final: gate completo verde (`AGENTS.md`)
- [ ] `/sdd-07-spec-review` aprovado
- [ ] `/sdd-08-docs` concluído (documentação + `mr-template.md`)
- [ ] Fechamento na issue opcional registrado
- [ ] ADR opcional registrado (quando aplicável)
- [ ] Entrada em `specs/implementation-log.md`
- [ ] MR/PR: `{ISSUE-KEY}-{slug}`
