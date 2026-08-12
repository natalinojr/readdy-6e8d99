# ERPOS V2 - guia rapido para agentes

Antes de alterar o sistema, leia `AI_SYSTEM_MAP.md`.

Regras de trabalho neste repositorio:
- Nao reverta alteracoes existentes sem pedido explicito do usuario.
- O usuario pode alternar entre Codex e Claude na mesma pasta; trate mudancas novas como trabalho do usuario/Claude.
- Para localizar uma area, comece pelo mapa em `AI_SYSTEM_MAP.md`, depois abra a rota em `src/router/config.tsx` e os providers em `src/providers/AppProviders.tsx`.
- Para escrita no backend, procure primeiro Edge Functions em `supabase/functions/*` e chamadas `invokeWithAuth(...)` em `src/lib/supabase.ts`.
- Build principal: `npm run build` gera `out/`. Vercel usa `vercel.json` com `outputDirectory: "out"`.

