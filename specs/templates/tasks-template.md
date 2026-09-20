# Tasks: {titulo}

> Spec: [spec.md](./spec.md) · Issue: PROJ-XXXX

## Global Constraints

> Valem para **todas** as tasks. Copiar **verbatim** de `spec.md` §2 (Restrições) + restrições padrão do [`AGENTS.md`](../../AGENTS.md) aplicáveis. O Context pack referencia esta seção — não reescreve.

- {restrição 1 — valor exato}
- {restrição 2 — valor exato}
- {ex.: gate iterativo = comandos do AGENTS.md; sem shadow code; …}

## Mapa de arquivos

> Preencher **antes** de detalhar as tasks. Trava responsabilidades e o corte T01/T02/…

| Path | Ação | Responsabilidade | Task |
|------|------|------------------|------|
| `src/.../Foo.<ext>` | criar / modificar | {uma frase} | T01 |
| `tests/.../FooTest.<ext>` | criar / modificar | {uma frase} | T01 |
| `src/.../Bar.<ext>` | modificar | {uma frase} | T02 |

## Profundidade do plano (`plan_depth`)

> Decidir **depois** do Mapa de arquivos, **antes** dos Steps. Ver árvore em `/sdd-04-plan` §4.0.

| Campo | Valor |
|-------|-------|
| **plan_depth** | `snippets` \| `contracts` |
| **Critério** | {ex.: maioria modificar → snippets · ≥8 criar → contracts · override do dev} |
| **Override do dev?** | não \| sim |

- **`snippets`:** step de código = snippet **completo** + verificação com comando/esperado.
- **`contracts`:** step de código = assinaturas/esqueleto + **Produces**; verificação com teste **completo** (ou scaffold verificável). Corpo completo só em thin slice / steps que cabem em 2–5 min.
- Override por task: campo **Profundidade** na tabela da task.
- Override por fase: anotar na coluna/modo da fase ou no Critério.

## Progresso do Plan (ondas)

> Preencher quando `/sdd-04-plan` §4.2 (Plan em ondas) estiver ativo. Sessão nova retoma por esta tabela — não pelo chat.

| Onda | Escopo | Status | Compliance | Nota |
|------|--------|--------|------------|------|
| 0 | Skeleton (Constraints + Mapa + Fases) | pending \| ✅ | — / ✅ skeleton | |
| 1 | Fase 1 detalhe | pending \| ✅ | — / ✅ fase-1 | |
| 2 | Fase 2 detalhe | pending \| ✅ | — / ✅ fase-2 | |
| final | cross | pending \| ✅ | — / ✅ cross | `planned` só após esta |

## Plano de execução

### Fases

> Com **≥ 5 tasks**, fases são obrigatórias. Execute com `/sdd-06-execute` informando a fase (ex.: `Fase 1`).

| Fase | Tasks | Depende de | Paralelo? | Modo execução |
|------|-------|------------|-----------|---------------|
| 1 | T01, T02 | — | sim | `parallel-execution` ou `/sdd-06-execute` sequencial |
| 2 | T03 | Fase 1 | — | `/sdd-06-execute` |

> **Paralelo? = sim** só se as colunas **Onde** forem disjuntas (sem overlap de arquivos).

### Feature flag

| Propriedade | Default | Task |
|-------------|---------|------|
| `{flag}.enabled` | `false` | T0X |

Ou: **N/A** — {justificativa}. Padrão de flags: ver [`AGENTS.md`](../../AGENTS.md).

### Impactos (resumo)

| Mudança | Intencional | Risco não intencional |
|---------|-------------|----------------------|
| | | |

### Grafo de dependências

```
T01 ──┬──> T03
T02 ──┘
```

---

## T01: {título}

| Campo | Valor |
|-------|-------|
| **Entregável** | O que existe ao final (arquivo, endpoint, teste) |
| **Onde** | Paths exatos (ex.: `src/.../FooService.<ext>`) |
| **Depende de** | — / T0X |
| **Bloqueia** | T0Y |
| **Paralelo com** | T02 (∥) — só se **Onde** disjunto |
| **Profundidade** | _(opcional)_ `snippets` \| `contracts` — override do plan_depth |
| **Requisitos** | RF/US da spec |

### Context pack

> Executor **sem** histórico do chat: implementar só com Global Constraints + esta task (Context pack + Interfaces + Steps).

- **Spec:** [spec.md](./spec.md) §2 goal …, US-…
- **Constraints:** ver [Global Constraints](#global-constraints) (não recopiar — só exceções locais se houver)
- **Padrão do repo:** {ex.: camada de entrada delega ao serviço; imitar `ExemploExistente`}
- **Arquivos vizinhos:** {1–2 exemplos existentes}
- **Não fazer:** {non-goals + fora do escopo desta task}

### Interfaces

> Contrato para subagentes: a task seguinte **não** lê esta task — só o que está em **Produces**.

- **Consumes:** {o que esta task usa de tasks anteriores ou do As Is — nomes/assinaturas exatos; ou `—` se for a primeira / só tipos existentes}
  - ex.: `FooClient.send(req: Request): Response` (As Is) · `retry` de T01
- **Produces:** {o que tasks posteriores dependem — nomes, params, retornos}
  - ex.: `function retry<T>(op: () => T, times = 3): T` — lança após esgotar tentativas

### O que será feito

- ...

### Steps

> **Bite-sized:** 1 ação por step, alvo **2–5 min**. Exceção 2–10 min só com justificativa no step.  
> **Iron Law:** artefato executável **suficiente para o `plan_depth` / Profundidade** + comando + output esperado.  
> Sem TBD, "adicionar validação" ou "similar à T02" sem repetir artefato. Sem step de commit automático.

#### Se `plan_depth` / Profundidade = `snippets` (exemplo)

- [ ] **Step 1: Escrever teste que falha** (`tdd: true` ou N/A integração)

```
// trecho COMPLETO do teste — caminho exato do arquivo
```

- [ ] **Step 2: Rodar teste — confirmar FAIL**

```
# comando de teste único do projeto (ver AGENTS.md — Gate de qualidade)
```

Esperado: FAILURE — {motivo exato, ex.: "retry is not defined"}

- [ ] **Step 3: Implementação mínima**

```
// trecho COMPLETO de produção — caminho exato do arquivo
```

- [ ] **Step 4: Rodar teste — confirmar PASS**

```
# comando de teste do projeto (ver AGENTS.md)
```

Esperado: SUCCESS, 0 falhas

- [ ] **Step 5: Gate iterativo da task**

```
# comandos de gate iterativo (AGENTS.md)
```

Esperado: exit 0 — {evidência-chave}

#### Se `plan_depth` / Profundidade = `contracts` (exemplo)

- [ ] **Step 1: Fixar contrato em Interfaces + esqueleto**

```
// assinaturas / exports alinhados a Produces — caminho exato (sem corpo completo se >2–5 min)
```

- [ ] **Step 2: Escrever teste completo que trava o comportamento** (obrigatório em thin slice)

```
// teste COMPLETO — caminho exato
```

- [ ] **Step 3: Rodar teste — confirmar FAIL**

```
# comando (AGENTS.md)
```

Esperado: FAILURE — {motivo}

- [ ] **Step 4: Implementação mínima que satisfaz o teste + Produces**

> Corpo completo no Plan **só** se couber em 2–5 min; senão: “implementar o mínimo que faça o teste passar respeitando Produces {assinaturas}” — o Execute preenche o corpo.

- [ ] **Step 5: Rodar teste — confirmar PASS** + gate iterativo (`AGENTS.md`)

### Definição de pronto (DoD)

- [ ] Steps concluídos
- [ ] Interfaces Consumes/Produces respeitadas (nomes/assinaturas)
- [ ] Código + testes
- [ ] Gate iterativo verde (skill `verification` em `executions.md`)
- [ ] Revisão do `/sdd-06-execute` aprovada (Estágio 1 + Estágio 2 + receiving-review quando houver fix)
- [ ] Sem shadow code (tudo rastreável na spec)
- [ ] Docs (`/sdd-08-docs`) se impacto em API/contrato público

### Notas de execução

<!-- Preenchido em executions.md -->

---

## T02: ...

<!-- Repetir bloco por task -->
