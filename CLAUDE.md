# ERPOS V2 — guia rápido para Claude

Leia `AI_SYSTEM_MAP.md` antes de alterações estruturais (índice de rotas, telas, contexts, hooks, Edge Functions e tabelas Supabase). Use o mapa como índice e **confirme sempre no código atual** antes de afirmar.

Para trabalho no **módulo financeiro/estoque**, leia também `BRIEFING-EP-PARANAGUA.md` (contexto de negócio, números de baseline e KPIs vindos da auditoria da loja El Patrón Paranaguá) e `DIRETRIZES-ANALISE-IA.md` (como a análise de dados deve pensar: triangulação, hierarquia de fontes, contrato de saída).

## Fatos do projeto (duráveis)

- **Readdy.ai está PAUSADO** (desde 2026-06-14). Todo trabalho é feito aqui (Claude) ou no Codex; nosso código + push para `origin/main` é a **fonte de verdade**. Não há mais regeneração do Readdy a temer.
- **Deploy:** GitHub `main` → **Vercel** builda e publica automaticamente a cada push. Projeto Vercel = `erpos` (https://erpos.vercel.app). Fluxo: editar → testar → commit → push `main` → Vercel publica. Cada push dispara um deploy.
- **Build:** Vite → pasta `out/` (`vercel.json` usa `outputDirectory: "out"`). Por ser Vite, as variáveis `VITE_*` são **embutidas no build** (precisam existir no Vercel no momento do build).
- **Variáveis no Vercel** (já configuradas em Production+Development): `VITE_PUBLIC_SUPABASE_URL`, `VITE_PUBLIC_SUPABASE_ANON_KEY`, `VITE_APP_URL`. Preview ainda pendente (bug da CLI). Vercel CLI instalado e logado como `natalinojr`; usar `VERCEL_TELEMETRY_DISABLED=1`.
- **type-check e lint estão "vermelhos"**: há ~350 erros de TypeScript **pré-existentes** (herdados do código gerado pelo Readdy). O build funciona mesmo assim porque o Vite não faz checagem de tipos. **NÃO tente consertar os 350** — ao mexer no código, apenas garanta não AUMENTAR a contagem (`npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"`).
- Supabase: projeto `ERP OS`, ref `mdghhjemzdmeuqpzuyzx`.

## Colaboração

- Projeto compartilhado com **Codex** e com o **usuário**. Não reverta alterações que você não fez sem autorização clara; trate mudanças novas como trabalho do usuário/Codex.
- **Commit/push só quando o usuário pedir** (cada push publica em produção).
- Ferramentas instaladas em modo portátil ficam em `.tools/` (ex.: GitHub CLI). `.tools/`, `.vercel/`, `.npm-cache/` estão no `.gitignore`.

## Soluções e critérios acumulados

Registre aprendizados reutilizáveis na seção **"Histórico de soluções e critérios"** de `AI_SYSTEM_MAP.md` conforme avançamos (padrões, decisões, pegadinhas).
