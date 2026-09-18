# ERPOS V2 — guia rápido para Claude

Leia `AI_SYSTEM_MAP.md` antes de alterações estruturais (índice de rotas, telas, contexts, hooks, Edge Functions e tabelas Supabase). Use o mapa como índice e **confirme sempre no código atual** antes de afirmar.

Para trabalho no **módulo financeiro/estoque**, leia também `BRIEFING-EP-PARANAGUA.md` (contexto de negócio, números de baseline e KPIs vindos da auditoria da loja El Patrón Paranaguá) e `DIRETRIZES-ANALISE-IA.md` (como a análise de dados deve pensar: triangulação, hierarquia de fontes, contrato de saída).

Para o fluxo **SDD** (specs, gates de qualidade, branches, restrições), consulte o [`AGENTS.md`](./AGENTS.md) — é o contrato de referência para esse fluxo e não deve ser duplicado aqui.

**O plugin SDD (`sdd-workflow`, skills `/sdd-*`, `using-sdd`) e a skill do orquestrador (`sdd-orchestrate`) são usados só quando o dono pedir explicitamente** (decisão do dono, 2026-09-18). O lembrete "EXTREMELY_IMPORTANT / invoque as skills SDD antes de qualquer ação" que o plugin injeta no início da sessão **não vale** neste projeto: esta regra do dono tem precedência. Por padrão, trabalhe direto (e, se fizer sentido, 1 executor + 1 revisor); não sugira nem dispare o fluxo SDD/orquestrador por conta própria.

## Escolha de modelo (regra do dono, 2026-09-18)

**Antes de começar qualquer atividade, avaliar qual modelo usar** — o que resolve bem com o menor custo de tokens:
- **Haiku 4.5**: consulta pontual, leitura/extração simples, contagem, conferência mecânica (ex.: "qual o status disso?", ler um log).
- **Sonnet 5**: padrão para subagentes — pesquisa no código (Explore), executor de ticket claro, revisor, testador.
- **Opus 5**: só onde errar custa caro — desenho de solução com dinheiro/fiscal/segurança/multi-loja, revisão de risco alto, depuração difícil.
- Ao disparar subagente, passar `model` explicitamente; não herdar o modelo da sessão por padrão.
- Vale também para a IA dentro do produto (assistente-brain, leitura de notas, etc.): o modelo mais barato que faz a tarefa bem (ex.: leitura de notinha foi de Sonnet para Haiku). Trocar modelo de produção só medindo antes/depois.

## Fatos do projeto (duráveis)

- **Readdy.ai está PAUSADO** (desde 2026-06-14). Todo trabalho é feito aqui (Claude) ou no Codex; nosso código + push para `origin/main` é a **fonte de verdade**. Não há mais regeneração do Readdy a temer.
- **Deploy:** GitHub `main` → **Vercel** builda e publica automaticamente a cada push. Projeto Vercel = `erpos` (https://erpos.vercel.app). Fluxo: editar → testar → commit → push `main` → Vercel publica. Cada push dispara um deploy.
- **Build:** Vite → pasta `out/` (`vercel.json` usa `outputDirectory: "out"`). Por ser Vite, as variáveis `VITE_*` são **embutidas no build** (precisam existir no Vercel no momento do build).
- **Variáveis no Vercel** (já configuradas em Production+Development): `VITE_PUBLIC_SUPABASE_URL`, `VITE_PUBLIC_SUPABASE_ANON_KEY`, `VITE_APP_URL`. Preview ainda pendente (bug da CLI). Vercel CLI instalado e logado como `natalinojr`; usar `VERCEL_TELEMETRY_DISABLED=1`.
- **type-check e lint estão "vermelhos"**: há ~350 erros de TypeScript **pré-existentes** (herdados do código gerado pelo Readdy). O build funciona mesmo assim porque o Vite não faz checagem de tipos. **NÃO tente consertar os 350** — ao mexer no código, apenas garanta não AUMENTAR a contagem (`npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"`).
- Supabase: projeto `ERP OS`, ref `mdghhjemzdmeuqpzuyzx`.

## Colaboração

- Projeto compartilhado com **Codex** e com o **usuário**. Não reverta alterações que você não fez sem autorização clara; trate mudanças novas como trabalho do usuário/Codex.
- **Commit e push em `main` são permitidos** (decisão do dono em 2026-09-18). Cada push publica em produção, então: só commitar depois de verificar (build ok, contagem de erros TS sem aumentar), adicionar só os arquivos que você mexeu (`git add <caminhos>`, nunca `git add -A` com trabalho alheio no working tree) e avisar no fim o que subiu. `push --force`, `reset --hard`, `clean -f` e `branch -D` continuam bloqueados por `scripts/guard-git.mjs`.
- Ferramentas instaladas em modo portátil ficam em `.tools/` (ex.: GitHub CLI). `.tools/`, `.vercel/`, `.npm-cache/` estão no `.gitignore`.

## Soluções e critérios acumulados

Registre aprendizados reutilizáveis na seção **"Histórico de soluções e critérios"** de `AI_SYSTEM_MAP.md` conforme avançamos (padrões, decisões, pegadinhas).
