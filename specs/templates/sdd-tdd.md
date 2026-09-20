# TDD no SDD — Convenção centralizada

Fonte única para regras de TDD no fluxo SDD (genérico). **Áreas de integração excluídas por padrão** neste repositório: ver a seção **Integrações** / **TDD** em [`AGENTS.md`](../../AGENTS.md).

Disciplina operacional (Iron Law, red/green, red flags): skill **`tdd`**.

## Opt-in global

Em `/sdd-01-new` o agente **pergunta** ao dev se a spec usará TDD.

- Registrar `tdd: true | false` no frontmatter de `spec.md`.
- Quando `tdd: false`: o gate do projeto (`AGENTS.md`) permanece obrigatório; sem impor a ordem test-first; skill **`tdd`** **não** se aplica.
- Quando `tdd: true`: skill **`tdd`** é obrigatória em plan/execute — **nenhum código de produção sem teste falhando pelo motivo certo primeiro**.

## Ciclo (quando `tdd: true`)

**Red → green → refactor** por task, em código testável sem depender de infra externa real. Ver skill **`tdd`**.

- No **plan** (`/sdd-04-plan`): o DoD das tasks inclui a ordem explícita (teste falhando → implementação mínima → refactor); referenciar skill **`tdd`**.
- No **execute** (`/sdd-06-execute`): micro-plano ou Steps; invocar **`tdd`**; implement + loop de revisão (Estágio 1 → Estágio 2); registrar em `executions.md` **ao concluir**; gate via skill **`verification`**.
- No loop de revisão do execute: Estágio 1 spec compliance → Estágio 2 code quality; validar o teste de aceite.

## Exclusão padrão de integrações

Quando o escopo da spec incluir integrações pesadas listadas em `AGENTS.md`, TDD nessas áreas fica **fora do escopo por padrão**.

### Comportamento obrigatório do agente

Se research, plan ou specify identificar integrações excluídas em `AGENTS.md`:

1. **Avisar** o dev que TDD nessas integrações fica **fora do escopo por padrão**.
2. Registrar em `spec.md` (frontmatter `tdd_integracao`) e na subseção **TDD — escopo**: `integrações: fora` ou lista opt-in se o dev aceitar incluir.
3. Só incluir TDD em integração após **opt-in explícito** do dev e atualização da spec.

### Opt-in de integração

```yaml
tdd_integracao: incluir: area1,area2   # conforme a nomenclatura em AGENTS.md
```

## Escopo TDD padrão (sem restrição)

Camadas testáveis sem infra externa real — detalhar os paths no `AGENTS.md` do projeto.

## Legado

Specs anteriores a esta convenção podem não ter `tdd` no frontmatter; tratar como `tdd: false`.
