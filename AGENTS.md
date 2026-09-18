# ERPOS V2 - guia rapido para agentes

Antes de alterar o sistema, leia `AI_SYSTEM_MAP.md`.

Regras de trabalho neste repositorio:
- Nao reverta alteracoes existentes sem pedido explicito do usuario.
- O usuario pode alternar entre Codex e Claude na mesma pasta; trate mudancas novas como trabalho do usuario/Claude.
- Para localizar uma area, comece pelo mapa em `AI_SYSTEM_MAP.md`, depois abra a rota em `src/router/config.tsx` e os providers em `src/providers/AppProviders.tsx`.
- Para escrita no backend, procure primeiro Edge Functions em `supabase/functions/*` e chamadas `invokeWithAuth(...)` em `src/lib/supabase.ts`.
- Build principal: `npm run build` gera `out/`. Vercel usa `vercel.json` com `outputDirectory: "out"`.

---

> A partir daqui: contrato SDD (Spec-Driven Development). Gerado/atualizado por `/sdd-init`.
> Referência do contrato: `skills/using-sdd/references/agents-md-contract.md` (no plugin sdd-workflow).
> Quando usar: só usar o contrato para tarefas mais complexas e usar junto com a skill do orquestrador, para tarefas que durem mais tempo e que julgue ser necessário o orquestrador. E me pergunte se é pra usar
> As regras acima (seção original deste arquivo) continuam valendo e têm prioridade em caso de conflito.

## Stack

- **Linguagem:** TypeScript (front) + SQL/PLpgSQL (Supabase) + TypeScript/Deno (Edge Functions)
- **Framework:** React 19 + React Router 7 (front, SPA), Vite 8 (build/dev server), Tailwind CSS; Supabase (Postgres + Auth + Edge Functions + Realtime) no backend
- **Build/package:** npm (`package.json`, sem lockfile de workspaces — projeto único)

## Gate de qualidade

### Gate iterativo (por task)

- lint/compile: `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — o número **não pode aumentar** em relação a `scripts/baseline.json` (baseline atual: 292 erros pré-existentes, herdados do código gerado pelo Readdy; ver CLAUDE.md). `npm run lint` (eslint) existe mas hoje também está "vermelho" por herança — mesma regra: não aumentar.
- testes: `npx vitest run` (ou `npm test`) — nenhuma falha nova em relação ao baseline; a suíte não pode encolher (arquivo de teste sumir/não carregar).
- build: `npx vite build` (ou `npm run build`) — precisa passar limpo (sem erro; type-check não bloqueia o build porque o Vite não type-checka).

### Gate completo (antes de merge)

- `node scripts/check.mjs --force` — roda tsc + vitest (+ `--build` opcional para incluir `vite build`) e compara com `scripts/baseline.json`; sai com exit 2 e a lista do que regrediu se algo piorou. **Nunca** rodar com `--update-baseline` durante uma spec (isso trava um novo baseline — decisão do dono, não do agente).
- Esse mesmo comando já roda sozinho: hook `PostToolUse` (`check.mjs --fast`, testes relacionados ao arquivo tocado) e hook `Stop` (`check.mjs --stop-hook`, completo) em `.claude/settings.json`.

### Teste único (debug)

- `npx vitest run src/test/caminho/do/arquivo.test.ts` (ou `npx vitest related --run <arquivo-alterado>` para achar os testes relacionados a um arquivo de código)

## Issue tracker

- **Plataforma:** N/A — não há issue tracker configurado neste projeto.
- **URL base:** N/A
- **Como ler:** specs são identificadas por **slug** (sem `{ISSUE-KEY}`); pedidos chegam pelo dono em chat/Telegram ou por `dev_error_events` (fila de erros da Fase 0.2 da orquestração, ver `AI_SYSTEM_MAP.md` e `ORQUESTRACAO-AGENTES.md`).

## Branches Git

- **Branch base:** `main`
- **Convenção:** `claude/{slug}` (ex.: `claude/delivery-pix-message`, `claude/relatorios-mobile-sobreposicao`) — sem `{ISSUE-KEY}` porque não há issue tracker. Codex usa a mesma pasta/repo; não presumir dono de uma branch pelo nome.
- **Plataforma de MR/PR:** GitHub (`origin` = repo do projeto). Abrir PR é permitido; **commit, merge e push em `main` são permitidos aos agentes** desde 2026-09-18 (cada push nessa branch dispara deploy em produção via Vercel — só depois de verificar).
- **Título MR/PR:** `{slug}` (sem prefixo de issue)

### Fechamento padrão do SDD neste projeto

**Entrega verificada termina em commit + push em `main`** (regra do dono desde 2026-09-18; antes era só working tree). Quem commita é a sessão principal, ao fechar a entrega: só os arquivos que mexeu (`git add <caminhos>`), depois do gate verde; avisar o dono o que subiu. `scripts/guard-git.mjs` (hook `PreToolUse`) continua bloqueando, para qualquer agente: `git push --force`, `git reset --hard`, `git checkout -- .` / `git restore .`, `git clean -f`, `git branch -D`, `supabase db reset`/`db push`. Não há issue para "fechar".

## Integrações externas

| Integração | TDD por padrão? | Notas |
|------------|-----------------|-------|
| SEFAZ / Brasil NFe (emissão NFC-e/NFS-e) | fora | Nunca emitir de verdade em teste. Pedido de treino não emite NFC-e nem entra em relatório. |
| Banco Inter (API Banking) | fora | Extrato/saldo reais; não chamar em teste. |
| Stone (conciliação de maquininha) | fora | Endpoint v2 com StoneCode real; não chamar em teste. |
| Mercado Pago (Point/Online Payments) | fora | Há MCP `mercadopago` configurado (`.mcp.json`) só para consulta/documentação; nunca disparar cobrança real em teste. |
| WhatsApp / Telegram (assistente pessoal, canais públicos) | fora | Não enviar mensagem real a partir de teste automatizado. |
| Impressoras reais (agente de impressão local, `print_queue`) | fora | Testar via mock/`polling_enabled`/fila, nunca contra impressora física do restaurante. |
| Firebase (push notifications / PWA) | fora | Não disparar push real em teste. |
| Supabase (Postgres + Auth + Edge Functions + Realtime) | sim, quando possível | Núcleo do backend; lógica pura (RPCs, regras de negócio) deve ter teste; escrita em teste manual só na loja "Testes PDV". |

## Restrições padrão

- **`tenant_id` (loja) em toda leitura e escrita** — nunca query sem filtro de loja; RLS multi-loja é frágil (`auth_tenant_id()` = última membership quebra write/read direto para admin multi-loja — ver histórico em `AI_SYSTEM_MAP.md`). Contexts devem resetar estado próprio ao trocar de loja (já houve vazamento de impressoras/config entre lojas).
- **Datas em horário de Brasília** (não UTC "cru") em toda exibição e regra de negócio com corte por dia.
- **CMV = compras realizadas** (regra do financeiro; não é "consumo teórico" nem "ficha técnica"). Ver `FINANCEIRO_MAP.md` / `BRIEFING-EP-PARANAGUA.md`.
- **Pedido de treino** (Modo Treino) nunca emite NFC-e e nunca entra em relatório/CMV/caixa real.
- **Função `SECURITY DEFINER` nova** precisa `REVOKE ALL ... FROM PUBLIC, anon` explícito na própria migration.
- **Tabela nova** precisa `GRANT` ao `service_role` (senão Edge Function que escreve direto dá 42501/500 — pegadinha já documentada).
- Commit/push só depois de verificar e só com os próprios arquivos (ver "Fechamento padrão" acima); nunca rodar `scripts/check.mjs --update-baseline` sem decisão explícita do dono; nunca escrever em loja real durante teste — usar só a loja "Testes PDV" (`db3ca014-6c03-4c2e-97b9-9542cf825da2`) com os usuários `qa.admin` / `qa.caixa` / `qa.garcom`.
- Não reverter alterações existentes de Codex/dono sem pedido explícito (regra original deste arquivo).
- Não editar `CLAUDE.md` além de manter a referência a este arquivo (ver seção "Colaboração" do `CLAUDE.md`); os "Fatos do projeto (duráveis)" lá são autoritativos e não devem ser duplicados/contraditados aqui.

## Convenção de pastas (specs)

```
specs/
├── templates/                 # scaffoldado pelo /sdd-01-new
├── implementation-log.md      # log global
└── YYYY-MM-{slug}/
    ├── spec.md
    ├── design.md              # opcional
    ├── tasks.md               # opcional (≥ 5 tasks)
    ├── executions.md
    ├── mr-template.md         # preenchido em /sdd-08-docs
    └── issue-summary.md
```

Ainda não existe pasta `specs/` neste repositório — será criada pela primeira `/sdd-01-new`. Sem issue tracker: usar o **slug** no lugar de `{ISSUE-KEY}` em todo lugar do fluxo SDD (branch, título de PR, pasta da spec).

## Mapa de research (As Is)

| Área | Caminhos |
|------|----------|
| Índice geral (rotas, telas, contexts, hooks, Edge Functions, tabelas) | `AI_SYSTEM_MAP.md` (ler antes de qualquer alteração estrutural) |
| Rotas | `src/router/config.tsx` |
| Providers / contexts globais | `src/providers/AppProviders.tsx`, `src/contexts/*` |
| Chamadas ao backend (front → Edge) | `src/lib/supabase.ts` (`invokeWithAuth(...)`) |
| Edge Functions (Deno) | `supabase/functions/*` (66 funções) |
| Migrations SQL | `supabase/migrations/*.sql` |
| Telas | `src/pages/*` |
| Hooks de negócio | `src/hooks/*` |
| Testes | `src/test/{lib,business,components,edge,integration}` |
| Financeiro/estoque (contexto de negócio) | `BRIEFING-EP-PARANAGUA.md`, `FINANCEIRO_MAP.md`, `DIRETRIZES-ANALISE-IA.md` |
| Orquestração de agentes / verificador | `ORQUESTRACAO-AGENTES.md`, `scripts/check.mjs`, `scripts/guard-git.mjs`, `.claude/agents/*.md` |
| Checklist de testes manuais/QA | `TESTES-CHECKLIST.md` |
| Assistente pessoal (Telegram/WhatsApp) | `assistente/README.md` |
| App Android (Capacitor) | `android-app/` |
| Relay Node (NFS-e nacional, fora do Edge) | `nfse-relay/` |

## Mapa de documentação

- `AI_SYSTEM_MAP.md` — índice vivo do sistema; seção **"Histórico de soluções e critérios"** recebe padrões/decisões/pegadinhas reutilizáveis conforme o trabalho avança (compartilhado com Codex).
- `FINANCEIRO_MAP.md` — referência viva do módulo financeiro (achados de auditoria, regra do CMV).
- `TESTES-CHECKLIST.md` — checklist manual por módulo, usado pelo agente Testador.
- Mudanças públicas/decisões de arquitetura relevantes: registrar em `AI_SYSTEM_MAP.md`; não criar novo doc solto sem necessidade.

## Feature flags

| Campo | Valor |
|-------|-------|
| **Mecanismo** | arquivo-config (tabela `system_settings`, colunas boolean por loja) — não é env var nem serviço externo |
| **Convenção de nome** | coluna descritiva em `system_settings` (ex.: `delivery_habilitado`, campos lidos via `SystemSettingsContext`); sem prefixo fixo — conferir nomes existentes na tabela antes de adicionar |
| **Default seguro** | `false` (recurso novo começa desligado por loja até habilitação explícita) |
| **Path / registro no código** | `src/contexts/SystemSettingsContext.tsx` (leitura) + migration em `supabase/migrations/*.sql` adicionando a coluna em `system_settings` (escrita/definição) |

## ADR (opcional)

- **Path:** N/A — não há pasta de ADR neste projeto; decisões arquiteturais relevantes vão para `AI_SYSTEM_MAP.md` ("Histórico de soluções e critérios").
