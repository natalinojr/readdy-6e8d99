# Convenção de branches — SDD

Fonte única para nomenclatura de branches Git no fluxo SDD. **MR/PR, branch base e plataforma:** ver [`AGENTS.md`](../../AGENTS.md).

## Regras

| Item | Regra |
|------|-------|
| Branch Git | `{tipo}/{ISSUE-KEY}` (ex.: `feat/PROJ-1234`); sem issue tracker: `{tipo}/{slug}` |
| Tipos válidos | `feat`, `fix`, `refactor`, `perf`, `chore`, `docs` |
| Pasta da spec | `specs/YYYY-MM-{ISSUE-KEY-ou-slug}/` |
| Título MR/PR | `{ISSUE-KEY}-{slug}` (formato do projeto em `AGENTS.md`) |
| Criação | Sugerir em `/sdd-01-new`; criar só com confirmação do dev |
| Branch base (padrão) | Conforme `AGENTS.md` |
| Branch base (alternativa) | Outra, **somente** se o dev escolher explicitamente |

## Fluxo de criação (em `/sdd-01-new`)

1. Propor o nome da branch de trabalho: `{tipo}/{ISSUE-KEY}` (ou `{tipo}/{slug}` sem issue tracker).
2. Informar ao dev, de forma explícita no chat:
   - Nome proposto da branch de trabalho.
   - **Branch base padrão** (ver `AGENTS.md`).
   - Perguntar se deseja usar outra branch base.
3. Perguntar: "Deseja que eu crie a branch `{tipo}/{ISSUE-KEY}` agora?" (ou `{tipo}/{slug}` sem issue tracker).
4. Se **sim**:
   - Confirmar a branch base.
   - `git fetch` (se necessário).
   - `git checkout {branch-base}` → `git pull` (atualizar a base antes de ramificar).
   - `git checkout -b {tipo}/{ISSUE-KEY}` (ou `{tipo}/{slug}` sem issue tracker).
5. Registrar em `spec.md` (frontmatter + metadados) e em `executions.md`:
   - Branch de trabalho.
   - Branch base usada na criação.

## Legado

Branches longas em specs anteriores a esta convenção permanecem válidas; não renomear.
