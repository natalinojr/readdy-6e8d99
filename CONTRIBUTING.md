# Padrões do Projeto

## ⚠️ Regra obrigatória: Chamadas para Edge Functions

NUNCA use `supabase.functions.invoke` diretamente. Use sempre o helper `invokeWithAuth`:

```typescript
// ❌ ERRADO — causa 401 / non-2xx
import { supabase } from '@/lib/supabase'
supabase.functions.invoke('order-write', { body: { ... } })

// ✅ CORRETO
import { invokeWithAuth } from '@/lib/supabase'
invokeWithAuth('order-write', { body: { ... } })
```

**Por quê:** O Supabase usa um formato novo de service role key (`sb_secret_...`) que não funciona com `verify_jwt`. O `invokeWithAuth` busca o token fresco da sessão e envia os headers `Authorization` e `apikey` corretamente via `fetch` direto.

---

## Edge Functions — padrão de validação JWT

Dentro das Edge Functions, sempre crie o client assim:

```typescript
const db = createClient(supabaseUrl, anonKey, {
  global: { headers: { Authorization: authHeader } },
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: { user } } = await db.auth.getUser();
```

---

## Exceção: AuthContext (login-pin)

O `AuthContext.tsx` usa `supabase.functions.invoke('login-pin', ...)` diretamente **de forma intencional** — nesse caso ainda não existe sessão ativa (é o próprio fluxo de login), então `invokeWithAuth` não funcionaria. **Não altere essa chamada.**

---

## Arquivos que usam `invokeWithAuth` (referência)

| Arquivo | Funções chamadas |
|---|---|
| `src/contexts/AuditoriaContext.tsx` | `audit-write` |
| `src/contexts/CardapioContext.tsx` | `menu-write` |
| `src/contexts/EstoqueContext.tsx` | `stock-write` |
| `src/contexts/KDSContext.tsx` | `order-write` |
| `src/contexts/MesasContext.tsx` | `table-write` |
| `src/contexts/PDVContext.tsx` | `order-write` |
| `src/hooks/useUsuarios.ts` | `user-write` |
| `src/hooks/useValidarPIN.ts` | `login-pin` |
| `src/pages/cardapio/components/FichaTecnicaTab.tsx` | `menu-write` |
| `src/pages/pdv/caixa/components/SangriaSuprimentoModal.tsx` | `order-write` |
| `src/pages/pdv/garcom/page.tsx` | `order-write` |
