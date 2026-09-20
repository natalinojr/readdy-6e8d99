---
issue: PROJ-XXXX
tipo: feat
titulo: Título curto da mudança
branch: feat/PROJ-XXXX
tdd: false
tdd_integracao: fora
feature_flag: nao
status: draft
criado: YYYY-MM-DD
autor: @usuario
---

# Spec: {titulo}

## Metadados

| Campo | Valor |
|-------|-------|
| Issue | [PROJ-XXXX]({ISSUE_BASE_URL}/PROJ-XXXX) — ou `N/A` |
| Tipo | feat \| fix \| refactor \| perf \| chore \| docs |
| Branch | `feat/PROJ-XXXX` (ver [sdd-branch.md](../templates/sdd-branch.md)) |
| TDD | `false` · integrações: `fora` (ver [sdd-tdd.md](../templates/sdd-tdd.md) e [AGENTS.md](../../AGENTS.md)) |
| Feature flag | `nao` (ver [AGENTS.md](../../AGENTS.md)) |
| Pasta | `specs/YYYY-MM-PROJ-XXXX-slug/` |
| Status | draft \| research \| specified \| planned \| in-review \| executing \| done |

**Tipos:** `feat` (feature/comportamento novo), `fix` (bug), `refactor`, `perf`, `chore`, `docs`.

## Por quê?

<!-- O quê (problema/objetivo) e por quê (impacto, urgência). Preencher no /sdd-01-new. -->

## 1. As Is (Research)

### Contexto

<!-- Fatos do estado atual: como funciona hoje, quem usa, fluxos envolvidos. -->

### Comportamento atual

<!-- Como funciona hoje. Referencie arquivos, endpoints, fluxos. -->

### Arquivos e componentes relevantes

| Área | Caminho / componente | Papel |
|------|----------------------|-------|
| | | |

### Lacunas do research

- [ ] ...

---

## 2. To Be (Specify)

### Resumo

<!-- Uma frase: o que muda. -->

### Goals

- [ ] ...

### Critérios de sucesso

<!-- Como saber que deu certo (mensurável). Distinto de goals e de critérios de aceite das US. -->

- [ ] ...

### Non-goals

<!-- O que explicitamente NÃO faremos nesta spec. -->

- ...

### Restrições

<!-- Limites que NÃO podem ser violados. Ver sdd-restricoes.md e AGENTS.md. -->

- ...

### Abordagens consideradas

<!-- feat/refactor com decisão de design: 2–3 opções. fix trivial: "N/A — abordagem única" + justificativa. -->

| Opção | Prós | Contras | Escolha |
|-------|------|---------|---------|
| A | | | |
| B | | | |

**Recomendação do agente:** ...

### Escopo da entrega

<!-- Uma spec | Dividir em N specs: ... | Uma spec em fases: ... + justificativa -->

- **Decisão:**
- **Justificativa:**

### Requisitos funcionais

1. ...

### Edge cases

| Cenário | Comportamento esperado |
|---------|------------------------|
| | |

### Revisão da spec (Specify)

<!-- Agente preenche em /sdd-03-specify; corrigir inline antes da confirmação do dev -->

- [ ] Sem TBD / placeholders vagos em §2 e §4
- [ ] Goals ↔ critérios de sucesso ↔ RF ↔ US alinhados
- [ ] Restrições e non-goals sem contradição
- [ ] Abordagem escolhida refletida no To Be (ou N/A justificado)
- [ ] Escopo da entrega adequado (não grande demais para uma spec)

### Confirmação de entendimento

<!-- Preenchido na fase Specify: resumo do agente + validação do dev -->

**Agente entendeu como:** ...

**Dev confirmou:** [ ] Sim  [ ] Ajustes: ...

---

## 3. Design

<!-- Se complexo: criar design.md (aprovação por blocos — ver design-template.md) e linkar aqui -->
<!-- Se simples: seção curta abaixo -->

### Decisões

| Decisão | Alternativas | Motivo |
|---------|--------------|--------|
| | | |

---

## 4. User stories

### US-01: Título

**Como** ... **quero** ... **para** ...

**Critérios de aceite:**

- [ ] ...

---

## 5. Tasks

<!-- Se < 5 tarefas, listar aqui (mesmo rigor zero-context quando o tipo exigir). Se ≥ 5, usar tasks.md -->

> Quando o formato completo for obrigatório (`feat`/`refactor`/`perf`/`fix` multi-arquivo): incluir **Global Constraints**, **Mapa de arquivos**, **`plan_depth`**, e por task **Context pack** + **Interfaces** + **Steps** (ver `specs/templates/tasks-template.md` e `/sdd-04-plan` §4.0).

### Global Constraints

- ...

### Mapa de arquivos

| Path | Ação | Responsabilidade | Task |
|------|------|------------------|------|
| | | | |

### Profundidade (`plan_depth`)

| Campo | Valor |
|-------|-------|
| **plan_depth** | `snippets` \| `contracts` |
| **Critério** | ... |

### Task 01: Título

- **Entregável:** ...
- **Onde:** ...
- **Depende de:** —
- **Interfaces:** Consumes: … · Produces: …
- **DoD:** ...
- **Context pack / Steps:** (obrigatório conforme `/sdd-04-plan` §4.1)

---

## 6. Referências

- Issue: PROJ-XXXX
- Issue summary: `specs/YYYY-MM-PROJ-XXXX-slug/issue-summary.md`
- Anexos versionados: apenas `.md` (demais formatos apenas referenciados no `issue-summary.md`)
- Docs: ver mapa em `AGENTS.md`
