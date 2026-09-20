# Tasks: Módulo Financeiro para empresa sem PDV (Fase 1)

> Spec: [spec.md](./spec.md) · Issue: N/A (slug `modulo-financeiro-sem-pdv`)

## Global Constraints

> Valem para **todas** as tasks. Copiadas de [spec.md](./spec.md) §2 (Restrições) + [`AGENTS.md`](../../AGENTS.md).

- **R1 — O caminho de quem tem PDV não muda**, nem visualmente. Toda diferença é condicionada a
  `kind === 'financeiro'`, nunca a `kind !== 'loja'` como efeito colateral.
- **R2 — Não duplicar telas do Financeiro.** Mesma rota, mesmos componentes, diferença só por condição.
- **R3 — O papel `financeiro` não grava em nada de PDV** (pedido, caixa, cardápio, estoque, mesa, impressora),
  nem por chamada direta à Edge.
- **R4 — `ALTER TYPE ... ADD VALUE` vai em migration própria**, antes de qualquer migration que use o valor.
- **R5 — Ao versionar função existente, o corpo é cópia literal do banco** + a alteração desta spec.
- **R6 — `kind` é somente-leitura para o app**; só o Admin Master define, no nascimento.
- **R7 — Nenhuma migration desta spec altera ou apaga dado existente.**
- `tenant_id` em toda leitura e escrita; contexts resetam ao trocar de empresa.
- Datas em horário de Brasília. CMV = compras realizadas.
- Função `SECURITY DEFINER` nova: `REVOKE ALL ... FROM PUBLIC, anon` na própria migration.
- Tabela nova: `GRANT` ao `service_role`.
- **Gate iterativo por task:** `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` (não pode
  aumentar vs `scripts/baseline.json`), `npx vitest run` (sem falha nova), `npx vite build` (limpo).
  **Nunca** `check.mjs --update-baseline`.
- Teste manual só na loja **Testes PDV** (`db3ca014-6c03-4c2e-97b9-9542cf825da2`) e nas empresas financeiras
  de teste criadas por esta spec. **Nunca** escrever em loja real.
- Sem commit dentro das tasks: quem commita é a sessão principal, no fechamento.

## Mapa de arquivos

| Path | Ação | Responsabilidade | Task |
|------|------|------------------|------|
| `supabase/migrations/20260920100000_user_role_financeiro.sql` | criar | Valor `'financeiro'` no enum `user_role` (sozinho, R4) | T01 |
| `supabase/migrations/20260920100100_tenants_kind_e_funcoes.sql` | criar | `tenants.kind`; versiona `get_user_tenants` **e `get_user_profile_for_tenant`** (ambas com `kind`) e `fn_setup_tenant_bypass` (literal); `fn_admin_set_user_tenant` aceita `financeiro` | T02 |
| `supabase/migrations/20260920100200_fn_admin_create_finance_tenant.sql` | criar | RPC de nascimento da empresa financeira + plano de contas + fontes de receita | T03 |
| `supabase/functions/_shared/tenant-auth.ts` | modificar | `isFinanceiroRole` | T04 |
| `src/test/edge/financeiroRole.test.ts` | criar | Teste de `isFinanceiroRole` | T04 |
| `supabase/functions/financial-write/index.ts` | modificar | Aceitar papel `financeiro` | T05 |
| `supabase/functions/purchase-write/index.ts` | modificar | idem | T05 |
| `supabase/functions/config-write/index.ts` | modificar | idem | T05 |
| `supabase/functions/inter-bank/index.ts` | modificar | idem (cheque inline) | T05 |
| `supabase/functions/stone-conciliation/index.ts` | modificar | idem (3 pontos) | T05 |
| `supabase/functions/fiscal-inbound/index.ts` | modificar | idem (5 pontos) | T05 |
| `supabase/functions/ifood-financial/index.ts` | modificar | idem (4 pontos) | T05 |
| `src/constants/usuarios.ts` | modificar | `PerfilUsuario` + `perfilConfig` | T06 |
| `src/contexts/AuthContext.tsx` | modificar | `UserPerfil`, `DB_TO_FRONTEND_ROLE`, `tenantKind` | T06, T08 |
| `src/hooks/useUsuarios.ts` · `src/hooks/useAcessoMultiLoja.ts` | modificar | `ROLE_MAP` / `ROLE_MAP_REVERSE` | T06 |
| `src/pages/configuracoes/components/PermissoesTab.tsx` | modificar | `defaultPermissoes:55`, `papeisToDbRole` / `dbRoleToPapel:81-95` | T06 |
| `src/pages/invite/page.tsx` | modificar | `PERFIL_LABEL:16`, `PERFIL_ROTA:27`, `PERFIL_COLOR:38` (`Record<UserPerfil, …>`) | T06 |
| `src/hooks/usePermissoes.ts` | modificar | `Papel`, `PAPEL_TO_DB_ROLE`, `DEFAULT_PERMISSOES` | T06 |
| `src/components/feature/Sidebar.tsx` · `src/pages/selecionar-loja/page.tsx` · `src/pages/modulos/page.tsx` | modificar | 3 cópias de `perfilLabel` | T06 |
| `src/pages/admin-master/acessos.tsx` | modificar | `ROLE_OPTIONS` / `ROLE_LABEL` | T06 |
| `supabase/functions/user-write/index.ts` | modificar | 2 mapas inline | T06 |
| `src/test/business/papeisMapa.test.ts` | criar | Todas as cópias conhecem `financeiro` | T06 |
| `src/components/feature/RotaProtegida.tsx` | modificar | Hard-lock do papel | T07 |
| `src/lib/acessoRota.ts` | criar | Lógica pura do hard-lock (extraída, testável) | T07 |
| `src/test/lib/acessoRota.test.ts` | criar | Teste do hard-lock | T07 |
| `src/lib/tipoEmpresa.ts` | criar | `empresaTemPdv()` — a única pergunta "tem PDV?" | T08 |
| `src/test/lib/tipoEmpresa.test.ts` | criar | Teste do helper + default de fontes | T08 |
| `src/lib/revenueSources.ts` | modificar | Default sem `orders` quando a empresa é financeira | T08 |
| `src/pages/modulos/page.tsx` | modificar | Card "Financeiro" | T09 |
| `src/pages/financeiro/page.tsx` | modificar | Aceitar o papel no cheque de acesso | T09 |
| `src/pages/selecionar-loja/page.tsx` | modificar | Selo "sem PDV" + "empresa" | T09 |
| `src/pages/financeiro/components/DRETab.tsx` | modificar | Esconder canal/cancelamento/desconto/CMV teórico | T10 |
| `src/pages/financeiro/components/DREComparativoTab.tsx` | modificar | idem | T10 |
| `src/pages/financeiro/components/VisaoGeralFinTab.tsx` | modificar | Ticket médio e Modo Sessão | T11 |
| `src/pages/financeiro/components/ContasVencidasPanel.tsx` | modificar | "sem receita no período" (RF17) | T11 |
| `src/pages/financeiro/components/BancosContasTab.tsx` | modificar | Rótulos de roteamento de PDV | T11 |
| `src/test/components/contasVencidasImpacto.test.ts` | criar | Rótulo sem receita | T11 |
| `src/providers/AppProviders.tsx` + 6 contexts de PDV | modificar | Montar sem buscar em empresa financeira | T12 |
| `src/pages/admin-master/page.tsx` · `modals.tsx` | modificar | "Nova empresa financeira" | T13 |

## Profundidade do plano (`plan_depth`)

| Campo | Valor |
|-------|-------|
| **plan_depth** | `snippets` |
| **Critério** | 30 dos 34 arquivos são **modificar** em código existente, com ponto de ancoragem conhecido (arquivo:linha no As Is). Override para `contracts` em T03, T10, T12 e T13, onde o artefato é grande e o contrato importa mais que o corpo. |
| **Override do dev?** | não |

## Progresso do Plan (ondas)

| Onda | Escopo | Status | Compliance | Nota |
|------|--------|--------|------------|------|
| 0 | Skeleton (Constraints + Mapa + Fases) | ✅ | ✅ skeleton | |
| 1 | Detalhe T01–T13 | ✅ | ✅ 2026-09-20 | Reprovado na 1ª volta (1 P0 + 2 P1); corrigido — ver nota |
| final | cross | ✅ | ✅ | `planned` |

> **Correções da revisão de compliance (2026-09-20):**
> 1. **P0 — T08 apontava a RPC errada.** `user.tenantKind` vem de `get_user_profile_for_tenant` (via
>    `fetchProfileForTenant`), e não de `get_user_tenants` (que só alimenta a lista do seletor). Sem isso,
>    `tenantKind` ficaria sempre `undefined`, `empresaTemPdv` devolveria `true` e **a empresa financeira se
>    comportaria como loja com PDV** — derrubando CS4, CS6 e CS7 em silêncio. T02 agora versiona **as duas**
>    RPCs; T08 cobre os **2** retornos de `fetchProfileForTenant` e os **3** mapeamentos de `TenantOption`
>    (o ramo de retry de JWT expirado, `:197-204`, não estava no plano).
> 2. **P1 — T06 tinha 2 arquivos fora do mapa.** `PermissoesTab.tsx:55` (`defaultPermissoes`) e
>    `invite/page.tsx:16,27,38` são `Record<UserPerfil|Papel, …>` exaustivos: parariam de compilar ao
>    acrescentar o papel, aumentando a contagem de erros TS e reprovando o gate. São 13 pontos, não 11.
> 3. **P1 — o teste de T06 não rodaria:** o campo de `FIN_ABAS` é `key` (não `permissao`), e os 4 mapas são
>    `const` sem `export`. Corrigido no snippet e declarado em **Produces**.
> 4. **P2 — T12 citava o `useCallback` no lugar do `useEffect` de mount** em Estoque e Produção, e prometia
>    ganho de peso em Impressoras que não existe (lá não há requisição de rede). Tabela de pontos reais
>    acrescentada e a expectativa de Impressoras corrigida por escrito.

## Plano de execução

### Fases

| Fase | Tasks | Depende de | Paralelo? | Modo execução |
|------|-------|------------|-----------|---------------|
| 1 — Banco | T01, T02, T03 | — | **não** (enum antes de uso, R4) | `/sdd-06-execute` sequencial |
| 2 — Escrita no servidor | T04, T05 | Fase 1 | não (T05 consome T04) | `/sdd-06-execute` sequencial |
| 3 — Papel no front | T06, T07 | Fase 1 | **sim** (Onde disjunto) | `parallel-execution` |
| 4 — Entrada e empresa | T08, T09 | Fase 3 | não (T09 consome T08) | `/sdd-06-execute` sequencial |
| 5 — Telas condicionais | T10, T11 | Fase 4 | **sim** (Onde disjunto) | `parallel-execution` |
| 6 — Peso ao abrir | T12 | Fase 4 | — | `/sdd-06-execute` |
| 7 — Nascimento | T13 | Fase 1, Fase 4 | — | `/sdd-06-execute` |

> **Paralelo? = sim** só onde as colunas **Onde** são disjuntas. Atenção: `modulos/page.tsx` aparece em T06
> (cópia de `perfilLabel`) e em T09 (card) — **não** executar T06 e T09 em paralelo; estão em fases distintas.
> `AuthContext.tsx` aparece em T06 e T08 — idem.

### Feature flag

**N/A** — a marca `tenants.kind` é a chave (spec §2, decisão do dono 2026-09-20). Toda empresa existente é
`'loja'` por default, então nenhum caminho novo é alcançado sem criação explícita de empresa financeira.

### Impactos (resumo)

| Mudança | Intencional | Risco não intencional |
|---------|-------------|----------------------|
| Valor novo no enum `user_role` | Papel `financeiro` gravável | Código que faz `switch` exaustivo em role pode ficar sem ramo — mitigado por T06 (todas as cópias) |
| `tenants.kind` com default | Marca o tipo | Nenhum: as 10 empresas ficam `'loja'` |
| `get_user_tenants` devolve `kind` | Front conhece o tipo | Função é `CREATE OR REPLACE` com corpo literal + 1 campo; conferir que nada além disso mudou (R5) |
| `isFinanceiroRole` em 8 Edges | Papel grava no Financeiro | Trocar a checagem errada abriria PDV ao papel — cada ponto conferido contra a lista do As Is (R3) |
| Condicionais nas telas | Empresa financeira não vê PDV | Condição invertida esconderia da loja com PDV — CS3 (antes/depois) é o guarda |
| RF17 (texto sem receita) | Fim do "0,0%" enganoso | Alcança a loja com PDV em mês sem venda; é texto, nenhum número muda |
| Providers sem buscar | Empresa financeira abre leve | Condição vazando para `'loja'` deixaria o PDV sem dados — teste em Testes PDV é obrigatório |

### Grafo de dependências

```
T01 ──> T02 ──> T03 ──────────────────────────┐
         │                                     │
         ├──> T04 ──> T05                      │
         │                                     │
         ├──> T06 ─┐                           │
         └──> T07 ─┴──> T08 ──> T09 ─┬──> T10  │
                                     ├──> T11  │
                                     ├──> T12  │
                                     └──> T13 <┘
```

---

## T01: Valor `financeiro` no enum `user_role`

| Campo | Valor |
|-------|-------|
| **Entregável** | `supabase/migrations/20260920100000_user_role_financeiro.sql` aplicada |
| **Onde** | `supabase/migrations/20260920100000_user_role_financeiro.sql` |
| **Depende de** | — |
| **Bloqueia** | T02, T03, T06 |
| **Requisitos** | RF02 |

### Context pack

- **Spec:** [spec.md](./spec.md) §2 RF02, restrição R4.
- **Padrão do repo:** `supabase/migrations/20260819000000_add_tasks_only_user_role.sql` é o precedente exato
  (acrescentou `'tasks_only'` ao mesmo enum).
- **Não fazer:** nada além do valor do enum nesta migration. Não usar o valor aqui.

### Interfaces

- **Consumes:** enum `user_role` (As Is): `admin, manager, cashier, waiter, kitchen, customer, tablet, delivery_manager, tasks_only`.
- **Produces:** valor `'financeiro'` disponível para `user_tenants.role`.

### Steps

- [ ] **Step 1: Escrever a migration**

```sql
-- Papel "financeiro": vê e opera só o módulo Financeiro da empresa.
-- ALTER TYPE ADD VALUE precisa vir sozinho, numa migration própria: o valor novo
-- não pode ser usado na mesma transação em que é criado.
alter type public.user_role add value if not exists 'financeiro';
```

- [ ] **Step 2: Aplicar e conferir**

```sql
select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
where t.typname = 'user_role' order by e.enumsortorder;
```

Esperado: a lista termina com `financeiro`.

### Definição de pronto (DoD)

- [ ] Migration criada, aplicada e valor presente no enum
- [ ] Gate iterativo verde
- [ ] Nenhum outro objeto tocado nesta migration

---

## T02: `tenants.kind` e versionamento das funções de entrada

| Campo | Valor |
|-------|-------|
| **Entregável** | Coluna `kind`; `get_user_tenants` **e `get_user_profile_for_tenant`** devolvendo `kind`; `fn_setup_tenant_bypass` versionada; `fn_admin_set_user_tenant` aceitando `financeiro` |
| **Onde** | `supabase/migrations/20260920100100_tenants_kind_e_funcoes.sql` |
| **Depende de** | T01 |
| **Bloqueia** | T03, T08 |
| **Requisitos** | RF01, RF03, RF04, RF05 |

### Context pack

- **Spec:** §2 RF01/RF03/RF04/RF05, restrições R5, R6, R7.
- **Padrão do repo:** `20260918010000_tenants_backup_enabled.sql` (coluna nova em `tenants` + função admin +
  `revoke ... from public, anon` + `grant execute ... to authenticated`).
- **Corpos atuais** (lidos do banco em 2026-09-20, copiar **literal** e só então alterar):
  - `get_user_tenants(p_user_id uuid) returns json` — valida `p_user_id != auth.uid()` → `Unauthorized`;
    `json_agg` com `tenant_id, tenant_name, role, training_mode, is_active`, join `tenants`, filtro
    `t.is_active = true`, `order by t.name`.
  - `get_user_profile_for_tenant(p_user_id uuid, p_tenant_id uuid) returns json` — valida
    `p_user_id != auth.uid()` → `Unauthorized`; `json_build_object` com `role, tenant_id, training_mode,
    name, is_active, tenant_name`, de `user_tenants ut` join `users u` left join `tenants t`, filtrando por
    `ut.user_id` e `ut.tenant_id`. **É esta** a função que monta o objeto `user` do front — não a
    `get_user_tenants` (que só alimenta a lista do seletor).
  - `fn_setup_tenant_bypass(text,text,text,uuid,text,text) returns jsonb` — insere `tenants(name, slug, cnpj,
    plan='trial', is_active=true)`, `users(id,name,email,is_active,badge_number='0001')` com
    `on conflict (id) do update`, `user_tenants(user_id,tenant_id,role='admin',training_mode=false)` com
    `on conflict do nothing`, `system_settings(tenant_id)` com `on conflict do nothing`, retorna
    `{tenant_id, success:true}`.
- **Não fazer:** mudar comportamento de `fn_setup_tenant_bypass` (o onboarding com PDV continua igual);
  dar ao app qualquer caminho de escrita em `kind` (R6).

### Interfaces

- **Consumes:** `'financeiro'` no enum (T01).
- **Produces:**
  - `tenants.kind text not null default 'loja'`, CHECK `in ('loja','financeiro')`
  - `get_user_tenants(p_user_id uuid)` devolve, por empresa, também `"kind"`
  - `get_user_profile_for_tenant(p_user_id uuid, p_tenant_id uuid)` devolve também `"kind"`
  - `fn_admin_set_user_tenant` aceita `'financeiro'`

### Steps

- [ ] **Step 1: Coluna `kind`**

```sql
alter table public.tenants
  add column if not exists kind text not null default 'loja';

alter table public.tenants
  drop constraint if exists tenants_kind_chk;
alter table public.tenants
  add constraint tenants_kind_chk check (kind in ('loja', 'financeiro'));

comment on column public.tenants.kind is
  'loja = usa PDV (padrão). financeiro = empresa que só usa o módulo Financeiro.';
```

- [ ] **Step 2: `get_user_tenants` versionada, agora com `kind`** — corpo literal do banco + o campo novo

```sql
create or replace function public.get_user_tenants(p_user_id uuid)
returns json
language plpgsql
security definer
as $function$
BEGIN
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN (
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'tenant_id', ut.tenant_id,
          'tenant_name', t.name,
          'role', ut.role,
          'training_mode', ut.training_mode,
          'is_active', t.is_active,
          'kind', t.kind
        )
        ORDER BY t.name
      ),
      '[]'::json
    )
    FROM user_tenants ut
    JOIN tenants t ON t.id = ut.tenant_id
    WHERE ut.user_id = p_user_id
      AND t.is_active = true
  );
END;
$function$;

revoke all on function public.get_user_tenants(uuid) from public, anon;
grant execute on function public.get_user_tenants(uuid) to authenticated;
```

- [ ] **Step 3: `get_user_profile_for_tenant` versionada, agora com `kind`** — corpo literal do banco + o campo novo

```sql
create or replace function public.get_user_profile_for_tenant(p_user_id uuid, p_tenant_id uuid)
returns json
language plpgsql
security definer
as $function$
DECLARE
  v_result json;
BEGIN
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'role', ut.role,
    'tenant_id', ut.tenant_id,
    'training_mode', ut.training_mode,
    'name', u.name,
    'is_active', u.is_active,
    'tenant_name', t.name,
    'kind', t.kind
  ) INTO v_result
  FROM user_tenants ut
  JOIN users u ON u.id = ut.user_id
  LEFT JOIN tenants t ON t.id = ut.tenant_id
  WHERE ut.user_id = p_user_id
    AND ut.tenant_id = p_tenant_id;

  RETURN v_result;
END;
$function$;

revoke all on function public.get_user_profile_for_tenant(uuid, uuid) from public, anon;
grant execute on function public.get_user_profile_for_tenant(uuid, uuid) to authenticated;
```

- [ ] **Step 4: `fn_setup_tenant_bypass` versionada (literal, sem mudança de comportamento)**

> Copiar o corpo exato do Context pack. `search_path` = `public`, `security definer`. Ao final:
> `revoke all on function public.fn_setup_tenant_bypass(text,text,text,uuid,text,text) from public, anon;`
> (a Edge chama com service key, não precisa de `grant` a `authenticated`).

- [ ] **Step 5: `fn_admin_set_user_tenant` aceita o papel novo**

> Em `20260914000000_user_module_access_admin_master.sql:77` a lista é
> `('admin','manager','cashier','waiter','kitchen','delivery_manager','tasks_only')`.
> Recriar a função idêntica, só acrescentando `'financeiro'` à lista.

- [ ] **Step 6: Conferir**

```sql
select kind, count(*) from public.tenants group by kind;
```

Esperado: `loja | 10` e nenhuma outra linha.

### Definição de pronto (DoD)

- [ ] Steps concluídos; migration aplicada
- [ ] **As duas** RPCs devolvem `kind` (conferir chamando com um usuário real de teste)
- [ ] Diff das funções versionadas × corpo do banco: só o campo `kind` e a lista de papéis
- [ ] Gate iterativo verde

---

## T03: Nascimento da empresa financeira (RPC)

| Campo | Valor |
|-------|-------|
| **Entregável** | `fn_admin_create_finance_tenant` criando empresa, papel, fontes de receita e plano de contas |
| **Onde** | `supabase/migrations/20260920100200_fn_admin_create_finance_tenant.sql` |
| **Depende de** | T01, T02 |
| **Bloqueia** | T13 |
| **Profundidade** | `contracts` |
| **Requisitos** | RF19, RF21 |

### Context pack

- **Spec:** §2 RF19/RF21, US-04, restrição R7.
- **Padrão do repo:** família `fn_admin_*` em `20260914000000_user_module_access_admin_master.sql` —
  `security definer`, primeira linha `perform fn_assert_platform_admin();`, depois `revoke all ... from
  public, anon` + `grant execute ... to authenticated`.
- **Atenção:** `tenants` tem 2 triggers de insert (`handle_new_tenant` cria `system_settings`;
  `fn_platform_owner_membership` dá `admin` ao dono da plataforma). Ambos são desejados — não desabilitar.
- **Não fazer:** nada de PDV (estação, mesa, categoria de cardápio, `pdv_config`, forma de pagamento).

### Interfaces

- **Consumes:** `tenants.kind` (T02), `'financeiro'` no enum (T01), `fn_assert_platform_admin()` (As Is),
  `fin_revenue_settings(tenant_id, sources)` (As Is), `fin_dre_categories(tenant_id, group_type, name, sort_order, is_active)` (As Is).
- **Produces:**
  `fn_admin_create_finance_tenant(p_name text, p_cnpj text, p_user_id uuid) returns jsonb`
  → `{ tenant_id uuid, success boolean }`; lança se o chamador não for admin da plataforma, se o nome for
  vazio ou se `p_user_id` não existir em `users`.

### O que será feito

1. Gerar `slug` a partir do nome (minúsculo, sem acento, hífen), com sufixo numérico se já existir.
2. `insert into tenants (name, slug, cnpj, plan, is_active, kind) values (..., 'trial', true, 'financeiro')`.
3. `insert into user_tenants (user_id, tenant_id, role, training_mode) values (p_user_id, v_tenant_id, 'financeiro', false) on conflict do nothing`.
4. `insert into fin_revenue_settings (tenant_id, sources) values (v_tenant_id, array['manual','pix'])`.
5. Inserir o plano de contas padrão de RF21 em `fin_dre_categories`, com `sort_order` sequencial por grupo:
   - `revenue`: Receita de Serviços, Receita de Vendas, Outras Receitas
   - `cost`: Custo dos Serviços/Mercadorias
   - `tax`: Impostos sobre Vendas (DAS/Simples)
   - `expense`: Folha e Encargos, Pró-labore, Aluguel, Água/Luz/Internet, Contabilidade, Marketing,
     Manutenção, Tarifas Bancárias, Transporte, Material de Escritório, Outras Despesas
6. Retornar `{tenant_id, success:true}`.

### Steps

- [ ] **Step 1: Confirmar as colunas obrigatórias de `fin_dre_categories`**

```sql
select column_name, is_nullable, column_default from information_schema.columns
where table_schema='public' and table_name='fin_dre_categories' order by ordinal_position;
```

Esperado: confirmar que `group_type`, `name`, `tenant_id` são obrigatórios e o resto tem default
(a trigger de validação de `group_type` aceita `revenue|cost|expense|tax`).

- [ ] **Step 2: Escrever a função conforme **Produces** e "O que será feito"**, com
  `perform fn_assert_platform_admin();` na primeira linha.

- [ ] **Step 3: Grants**

```sql
revoke all on function public.fn_admin_create_finance_tenant(text, text, uuid) from public, anon;
grant execute on function public.fn_admin_create_finance_tenant(text, text, uuid) to authenticated;
```

- [ ] **Step 4: Criar 2 empresas de teste** (CS5 precisa de duas)

```sql
select public.fn_admin_create_finance_tenant('Empresa Teste Financeiro A', null, '<user_id de teste>');
select public.fn_admin_create_finance_tenant('Empresa Teste Financeiro B', null, '<user_id de teste>');
```

Esperado: 2 `tenant_id`; cada uma com 16 categorias DRE, `sources = {manual,pix}`, `kind='financeiro'`,
e **zero** linhas em `kitchen_stations`, `tables`, `menu_categories`, `payment_methods`.

- [ ] **Step 5: Gate iterativo**

### Definição de pronto (DoD)

- [ ] Função criada com `fn_assert_platform_admin()` e grants
- [ ] 2 empresas de teste criadas e conferidas (incluindo a ausência de objetos de PDV)
- [ ] Nenhuma loja existente tocada
- [ ] Gate iterativo verde

---

## T04: `isFinanceiroRole` no helper compartilhado

| Campo | Valor |
|-------|-------|
| **Entregável** | `isFinanceiroRole` + teste |
| **Onde** | `supabase/functions/_shared/tenant-auth.ts`, `src/test/edge/financeiroRole.test.ts` |
| **Depende de** | — |
| **Bloqueia** | T05 |
| **Requisitos** | RF06 |

### Context pack

- **Spec:** §2 RF06, restrição R3.
- **As Is:** `tenant-auth.ts:14-27` tem `ROLE_RANK = { admin:3, manager:2, gerente:2 }` e
  `isManagerRole(role)` = rank ≥ 2. **Não alterar `ROLE_RANK` nem `isManagerRole`** — é o que protege o PDV.
- **Vizinho de estilo de teste:** `src/test/edge/fiscalValores.test.ts`.
- **Não fazer:** dar rank ao papel `financeiro`.

### Interfaces

- **Consumes:** `isManagerRole(role?: string | null): boolean` (As Is).
- **Produces:** `export function isFinanceiroRole(role?: string | null): boolean` — `true` para
  `admin`, `manager`, `gerente`, `financeiro`; `false` para qualquer outro, `null` e `undefined`.

### Steps

- [ ] **Step 1: Teste que falha** (`src/test/edge/financeiroRole.test.ts`)

> **Import estático NÃO serve.** `tenant-auth.ts` usa `Deno.env`, e um `import` estático o traz para dentro
> do programa do `tsc`, criando o erro novo `Cannot find name 'Deno'` (o portão reprova). O repo já tem o
> padrão certo, com o porquê comentado: `src/test/edge/fiscalValores.test.ts:5-17` monta o caminho em tempo
> de execução (`pathToFileURL` + `import(/* @vite-ignore */ …)`). Seguir esse padrão.

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Caminho montado em tempo de execução: o tsc do app não passa a checar código Deno.
const AUTH_PATH = pathToFileURL(
  resolve(__dirname, '../../../supabase/functions/_shared/tenant-auth.ts'),
).href;

type Mod = {
  isFinanceiroRole: (r?: string | null) => boolean;
  isManagerRole: (r?: string | null) => boolean;
};
const load = () => import(/* @vite-ignore */ AUTH_PATH) as Promise<Mod>;

describe('isFinanceiroRole', () => {
  it('aceita quem opera o Financeiro', async () => {
    const m = await load();
    for (const r of ['admin', 'manager', 'gerente', 'financeiro']) {
      expect(m.isFinanceiroRole(r)).toBe(true);
    }
  });

  it('recusa papel de PDV e vazio', async () => {
    const m = await load();
    for (const r of ['cashier', 'waiter', 'kitchen', 'tablet', 'customer', 'tasks_only', 'delivery_manager', '']) {
      expect(m.isFinanceiroRole(r)).toBe(false);
    }
    expect(m.isFinanceiroRole(null)).toBe(false);
    expect(m.isFinanceiroRole(undefined)).toBe(false);
  });

  it('não dá ao papel financeiro acesso de gerente (o PDV continua barrado)', async () => {
    const m = await load();
    expect(m.isManagerRole('financeiro')).toBe(false);
  });
});
```

> **Não** duplicar a função no lado do teste: o valor do teste está em exercitar o código real da Edge.

- [ ] **Step 2: Rodar — confirmar FAIL**

```
npx vitest run src/test/edge/financeiroRole.test.ts
```

Esperado: FAILURE — `isFinanceiroRole is not a function` / não exportado.

- [ ] **Step 3: Implementar em `tenant-auth.ts`** (logo abaixo de `isManagerRole`)

```ts
/**
 * Quem pode ESCREVER no módulo Financeiro.
 * Separado de isManagerRole de propósito: o papel 'financeiro' não tem rank e
 * por isso continua barrado nas Edges de PDV (pedido, caixa, cardápio, estoque).
 */
export function isFinanceiroRole(role?: string | null): boolean {
  if (isManagerRole(role)) return true;
  return role === 'financeiro';
}
```

- [ ] **Step 4: Rodar — confirmar PASS** + gate iterativo

### Definição de pronto (DoD)

- [ ] Teste passa; `isManagerRole` e `ROLE_RANK` intocados
- [ ] Gate iterativo verde

---

## T05: Aplicar `isFinanceiroRole` nas 8 Edges do Financeiro

| Campo | Valor |
|-------|-------|
| **Entregável** | As 8 Edges aceitam o papel `financeiro`; as de PDV não |
| **Onde** | `financial-write`, `purchase-write`, `config-write`, `inter-bank`, `stone-conciliation`, `fiscal-inbound`, `ifood-financial` (`supabase/functions/*/index.ts`) |
| **Depende de** | T04 |
| **Requisitos** | RF07, RF08 |

### Context pack

- **Spec:** §2 RF07/RF08, restrição R3.
- **Pontos exatos (As Is, conferir antes de editar):** `financial-write:51`, `purchase-write:535`,
  `config-write:50`, `inter-bank:992`, `stone-conciliation:588,628,665`,
  `fiscal-inbound:879,891,946,987,1021`, `ifood-financial:679,700,742,788`.
  Os 4 últimos arquivos comparam **inline** (`role === 'admin' || role === 'manager'`) — trocar pelo helper,
  importando de `../_shared/tenant-auth.ts`.
- **Não fazer:** tocar em qualquer outra Edge. `order-write`, `cash-*`, `menu-*`, `stock-*`, `table-*`,
  `print-*` continuam com `isManagerRole` — é o que garante R3 e o CS6.
- **`config-write` NÃO entra** (corrigido em 2026-09-20, durante a execução — o plano original a incluía por
  engano): é a configuração **geral**, com `create_table`, `create_kitchen_station`,
  `create_payment_method`, `update_tenant` e `upsert_permissions`. Liberar o papel ali daria PDV e
  **escalação de privilégio** (gravar as próprias permissões). Nenhuma tela do Financeiro escreve por ela;
  só lê `get_permissions`, que já é liberada a qualquer membro via `CONFIG_READ_ACTIONS`.
- **Atenção:** `inter-bank` compara só `'admin'|'manager'` e **não** aceita a grafia `'gerente'`; usar o
  helper corrige isso de passagem — é ganho, não regressão (gerente já podia pela tela).

### Interfaces

- **Consumes:** `isFinanceiroRole` (T04).
- **Produces:** nenhuma assinatura nova.

### Steps

- [ ] **Step 1: Listar os pontos atuais antes de editar**

```
grep -rn "isManagerRole\|role === 'admin'" supabase/functions/financial-write/index.ts supabase/functions/purchase-write/index.ts supabase/functions/config-write/index.ts supabase/functions/inter-bank/index.ts supabase/functions/stone-conciliation/index.ts supabase/functions/fiscal-inbound/index.ts supabase/functions/ifood-financial/index.ts
```

Esperado: os ~16 pontos do Context pack. Se algum não aparecer ou aparecer a mais, **parar e conferir**.

- [ ] **Step 2: Trocar cada ponto**, importando o helper onde ainda não estiver importado.
  Exemplo (`financial-write/index.ts:51`), preservando a mensagem de erro existente:

```ts
// Financeiro/RH é admin, gerente ou o papel financeiro (spec modulo-financeiro-sem-pdv, 2026-09-20).
if (!isFinanceiroRole(tenantCheck.role)) {
```

- [ ] **Step 3: Conferir que nenhuma Edge de PDV mudou**

```
git diff --name-only supabase/functions/
```

Esperado: exatamente os 7 arquivos da coluna **Onde** (mais `_shared/tenant-auth.ts` se T04 ainda não foi
commitada) — nenhum outro.

- [ ] **Step 4: Deploy das 7 Edges** — atenção à pegadinha do projeto: `verify_jwt` **misto**
  (memória "Deploy com verify_jwt misto"). Conferir a flag atual de cada função **antes** e deployar uma a
  uma, sem aplicar a mesma flag a todas.

- [ ] **Step 5: Gate iterativo**

### Definição de pronto (DoD)

- [ ] Os ~16 pontos trocados; nenhuma Edge fora da lista tocada
- [ ] Deploy feito preservando `verify_jwt` de cada função
- [ ] Gate iterativo verde

---

## T06: Papel `financeiro` em todas as cópias do front

| Campo | Valor |
|-------|-------|
| **Entregável** | O papel existe em tipos, mapas, rótulos e permissões padrão |
| **Onde** | `src/constants/usuarios.ts`, `src/contexts/AuthContext.tsx`, `src/hooks/useUsuarios.ts`, `src/hooks/useAcessoMultiLoja.ts`, `src/pages/configuracoes/components/PermissoesTab.tsx`, `src/pages/invite/page.tsx`, `src/hooks/usePermissoes.ts`, `src/components/feature/Sidebar.tsx`, `src/pages/selecionar-loja/page.tsx`, `src/pages/modulos/page.tsx`, `src/pages/admin-master/acessos.tsx`, `supabase/functions/user-write/index.ts`, `src/test/business/papeisMapa.test.ts` |
| **Depende de** | T01 |
| **Paralelo com** | T07 (∥) |
| **Requisitos** | RF09, RF10 |

### Context pack

- **Spec:** §2 RF09/RF10. Memória do projeto: "o papel novo precisa aparecer em **todas** as cópias, senão a
  pessoa loga e cai fora".
- **As Is — os 13 pontos:** `AuthContext.tsx:8` (`UserPerfil`) e `:64-73` (`DB_TO_FRONTEND_ROLE`);
  `useUsuarios.ts:6-26` e `useAcessoMultiLoja.ts:6-26` (`ROLE_MAP`/`ROLE_MAP_REVERSE`);
  `PermissoesTab.tsx:55` (`defaultPermissoes`) e `:81-95` (`papeisToDbRole`/`dbRoleToPapel`);
  `usePermissoes.ts:7` (`Papel`), `:40-48` (`PAPEL_TO_DB_ROLE`), `:51-84` (`DEFAULT_PERMISSOES`);
  `constants/usuarios.ts:1` (`PerfilUsuario`) e `:3-12` (`perfilConfig`); `Sidebar.tsx:91-97`,
  `selecionar-loja/page.tsx:7-13`, `modulos/page.tsx:179-185` (3× `perfilLabel`);
  `admin-master/acessos.tsx:8-22` (`ROLE_OPTIONS`/`ROLE_LABEL`); `user-write/index.ts:78` e `:110-114`
  (2 mapas inline); **`invite/page.tsx:16,27,38`** (`PERFIL_LABEL`, `PERFIL_ROTA`, `PERFIL_COLOR`).
- **Por que `invite/page.tsx` e `PermissoesTab.tsx:55` importam:** são `Record<UserPerfil, …>` /
  `Record<Papel, …>` **exaustivos**. No instante em que o union ganha `'financeiro'`, eles param de
  compilar por falta de chave — e isso **aumenta** a contagem de erros TS, reprovando o gate. Em
  `PERFIL_ROTA`, a rota do papel novo é `/financeiro`.
- **Convenção:** no banco o valor é `'financeiro'` e no front o perfil também é `'financeiro'` — é a única
  entrada onde PT e EN coincidem; manter assim evita uma tradução a mais.
- **Não fazer:** unificar as cópias (é dívida antiga, non-goal da spec); mexer em papéis existentes.

### Interfaces

- **Consumes:** `'financeiro'` no enum (T01).
- **Produces:**
  - `PerfilUsuario`/`UserPerfil`/`Papel` incluem `'financeiro'`
  - `DEFAULT_PERMISSOES.financeiro` com todas as chaves `fin_*` de `FIN_ABAS` e nenhuma fora
  - **superfície nova exigida pelo teste:** `export` em `ROLE_MAP` e `ROLE_MAP_REVERSE`
    (`useUsuarios.ts:6,17`) e em `PAPEL_TO_DB_ROLE` e `DEFAULT_PERMISSOES` (`usePermissoes.ts:40,51`) —
    hoje são `const` sem `export`. Só acrescentar a palavra `export`; nenhum valor muda.

### Steps

- [ ] **Step 1: Teste que falha** (`src/test/business/papeisMapa.test.ts`) — trava as cópias importáveis

```ts
import { describe, it, expect } from 'vitest';
import { ROLE_MAP, ROLE_MAP_REVERSE } from '../../hooks/useUsuarios';
import { PAPEL_TO_DB_ROLE, DEFAULT_PERMISSOES } from '../../hooks/usePermissoes';
import { perfilConfig } from '../../constants/usuarios';
import { FIN_ABAS } from '../../constants/permissoesAbas';

describe('papel financeiro nos mapas', () => {
  it('traduz nos dois sentidos', () => {
    expect(ROLE_MAP['financeiro']).toBe('financeiro');
    expect(ROLE_MAP_REVERSE['financeiro']).toBe('financeiro');
    expect(PAPEL_TO_DB_ROLE['financeiro']).toBe('financeiro');
  });

  it('tem rótulo e cor próprios', () => {
    expect(perfilConfig['financeiro']).toBeTruthy();
    expect(perfilConfig['financeiro'].label).toBeTruthy();
  });

  it('nasce com todas as permissões do Financeiro e nada além', () => {
    const perms = DEFAULT_PERMISSOES['financeiro'];
    const finKeys = FIN_ABAS.map((a) => a.key);
    for (const k of finKeys) expect(perms).toContain(k);
    for (const k of perms) expect(k.startsWith('fin_')).toBe(true);
  });
});
```

> Confirmado em 2026-09-20: `FIN_ABAS` tem o formato `{ aba, key, label }` (por isso `.key`), e os quatro
> mapas são `const` **sem** `export` — acrescentar `export` faz parte desta task (ver **Produces**).

- [ ] **Step 2: Rodar — confirmar FAIL**

```
npx vitest run src/test/business/papeisMapa.test.ts
```

- [ ] **Step 3: Acrescentar `'financeiro'` nos 13 pontos.** Rótulo: **"Financeiro"**. Em `perfilConfig`,
  seguir o formato das entradas vizinhas (label, cor, descrição — ex.: "Vê e opera só o módulo Financeiro").
  Em `PERFIL_ROTA` (`invite/page.tsx:27`), a rota é `/financeiro`.

- [ ] **Step 4: Conferir que nenhuma cópia ficou para trás** — o compilador é o juiz final aqui, porque os
  `Record<UserPerfil, …>` exaustivos acusam o que faltar:

```
npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"
grep -rln "financeiro" src/constants/usuarios.ts src/contexts/AuthContext.tsx src/hooks/useUsuarios.ts src/hooks/useAcessoMultiLoja.ts src/hooks/usePermissoes.ts src/pages/configuracoes/components/PermissoesTab.tsx src/pages/invite/page.tsx src/components/feature/Sidebar.tsx src/pages/selecionar-loja/page.tsx src/pages/modulos/page.tsx src/pages/admin-master/acessos.tsx supabase/functions/user-write/index.ts
```

Esperado: contagem de erros TS **igual ou menor** que o baseline, e os 12 arquivos listados.

- [ ] **Step 5: Rodar teste — PASS** + gate iterativo

### Definição de pronto (DoD)

- [ ] Teste passa; os 13 pontos cobertos; contagem de erros TS não aumentou
- [ ] Papéis existentes inalterados
- [ ] Gate iterativo verde

---

## T07: Hard-lock do papel `financeiro` na rota

| Campo | Valor |
|-------|-------|
| **Entregável** | Papel `financeiro` preso a `/financeiro`, com a decisão testável fora da tela |
| **Onde** | `src/lib/acessoRota.ts` (criar), `src/components/feature/RotaProtegida.tsx`, `src/test/lib/acessoRota.test.ts` (criar) |
| **Depende de** | — |
| **Paralelo com** | T06 (∥) |
| **Requisitos** | RF11 |

### Context pack

- **Spec:** §2 RF11, US-01, edge case "papel `financeiro` numa empresa e `admin` em outra".
- **As Is:** `RotaProtegida.tsx:45-54` tem o padrão a copiar (dois `if` para `gestor_entregas` e `tarefas`).
  `PAPEIS_ADMIN = ['admin','gerente']` na linha 30.
- **Por que extrair:** o hard-lock é lógica pura (papel + caminho → para onde ir) e a spec pede teste de
  lógica pura. A extração é **mínima**: os dois papéis existentes entram na mesma tabela, sem mudar o
  comportamento deles.
- **Não fazer:** mexer no resto do `RotaProtegida` (permissões, `loading`, `PAPEIS_ADMIN`).

### Interfaces

- **Consumes:** `user.perfil` (As Is), `location.pathname` (As Is).
- **Produces:**
  `export function rotaForcada(perfil: string | undefined, pathname: string): string | null` — devolve o
  caminho para onde redirecionar, ou `null` quando o papel não é restrito ou já está no lugar certo.
  `export const PAPEIS_PRESOS: Record<string, string>` — `{ gestor_entregas: '/gestor-entregas', tarefas: '/tarefas', financeiro: '/financeiro' }`.

### Steps

- [ ] **Step 1: Teste que falha** (`src/test/lib/acessoRota.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { rotaForcada } from '../../lib/acessoRota';

describe('rotaForcada', () => {
  it('prende o papel financeiro ao Financeiro', () => {
    expect(rotaForcada('financeiro', '/dashboard')).toBe('/financeiro');
    expect(rotaForcada('financeiro', '/pdv/caixa')).toBe('/financeiro');
    expect(rotaForcada('financeiro', '/estoque')).toBe('/financeiro');
    expect(rotaForcada('financeiro', '/modulos')).toBe('/financeiro');
  });

  it('deixa o papel financeiro em paz dentro do Financeiro', () => {
    expect(rotaForcada('financeiro', '/financeiro')).toBe(null);
    expect(rotaForcada('financeiro', '/financeiro?tab=dre')).toBe(null);
  });

  it('mantém o comportamento dos papéis que já eram presos', () => {
    expect(rotaForcada('gestor_entregas', '/financeiro')).toBe('/gestor-entregas');
    expect(rotaForcada('gestor_entregas', '/gestor-entregas')).toBe(null);
    expect(rotaForcada('tarefas', '/dashboard')).toBe('/tarefas');
    expect(rotaForcada('tarefas', '/tarefas/123')).toBe(null);
  });

  it('não prende quem não é papel restrito', () => {
    for (const p of ['admin', 'gerente', 'caixa', 'garcom', 'cozinha', undefined]) {
      expect(rotaForcada(p, '/dashboard')).toBe(null);
    }
  });
});
```

- [ ] **Step 2: Rodar — confirmar FAIL**

```
npx vitest run src/test/lib/acessoRota.test.ts
```

Esperado: FAILURE — módulo `src/lib/acessoRota` não existe.

- [ ] **Step 3: Criar `src/lib/acessoRota.ts`**

```ts
/**
 * Papéis presos a uma única área do sistema: entram por ela e não saem.
 * A decisão vive aqui, fora do componente, para poder ser testada sem tela.
 */
export const PAPEIS_PRESOS: Record<string, string> = {
  gestor_entregas: '/gestor-entregas',
  tarefas: '/tarefas',
  financeiro: '/financeiro',
};

export function rotaForcada(perfil: string | undefined | null, pathname: string): string | null {
  if (!perfil) return null;
  const destino = PAPEIS_PRESOS[perfil];
  if (!destino) return null;
  return pathname.startsWith(destino) ? null : destino;
}
```

- [ ] **Step 4: Usar no `RotaProtegida.tsx`**, substituindo os dois `if` das linhas 45-54

```tsx
const forcada = rotaForcada(user?.perfil, location.pathname);
if (forcada) return <Navigate to={forcada} replace />;
```

- [ ] **Step 5: Rodar teste — PASS** + gate iterativo

### Definição de pronto (DoD)

- [ ] Teste passa, incluindo os casos dos dois papéis que já existiam
- [ ] `RotaProtegida` sem outra alteração
- [ ] Gate iterativo verde

---

## T08: A empresa tem tipo, e o front sabe disso

| Campo | Valor |
|-------|-------|
| **Entregável** | `user.tenantKind` + helper único "tem PDV?" + default de fontes de receita coerente |
| **Onde** | `src/lib/tipoEmpresa.ts` (criar), `src/contexts/AuthContext.tsx`, `src/lib/revenueSources.ts`, `src/test/lib/tipoEmpresa.test.ts` (criar) |
| **Depende de** | T02, T06 |
| **Bloqueia** | T09, T10, T11, T12 |
| **Requisitos** | RF14, edge case "empresa financeira sem linha em `fin_revenue_settings`" |

### Context pack

- **Spec:** §2 RF14, decisão de design "um helper único".
- **As Is — atenção, são DUAS RPCs diferentes** (o ponto que reprovou a primeira versão deste plano):
  - **`get_user_tenants`** alimenta só a **lista do seletor** (`TenantOption`). Mapeada em **3** lugares:
    `AuthContext.tsx:197-204` (ramo de retry após JWT expirado), `:226-233` (caminho normal) e
    `:630-637` (`switchTenant`). Os três precisam levar `kind`, senão o selo some depois de um refresh.
  - **`get_user_profile_for_tenant`** é quem monta o objeto **`user`** (`fetchProfileForTenant`,
    `AuthContext.tsx:77-141`). É de onde saem `perfil`, `loja`, `tenantId`, `modoTreino` — e é de onde
    `tenantKind` tem de sair. Essa função tem **dois** pontos de retorno: o caminho normal
    (`:130-140`) e o retry após JWT expirado (`:110-118`). **Os dois** precisam do campo, senão o tipo da
    empresa some justamente quando o token expira e a tela volta a se comportar como se tivesse PDV.
- `revenueSources.ts:13` tem `DEFAULT_REVENUE_SOURCES = ['orders','manual']` e `:103` faz
  `row?.sources ?? DEFAULT_REVENUE_SOURCES`.
- **Não fazer:** dar caminho de escrita em `kind` (R6); segunda query em `tenants` (o dado vem da RPC).

### Interfaces

- **Consumes:** `get_user_tenants` **e** `get_user_profile_for_tenant` devolvendo `kind` (T02).
- **Produces:**
  - `export type TipoEmpresa = 'loja' | 'financeiro'`
  - `export function empresaTemPdv(kind?: string | null): boolean` — `false` só para `'financeiro'`;
    `true` para `'loja'`, desconhecido, `null` e `undefined` (**o padrão seguro é "tem PDV"**, para que
    nenhuma loja perca tela por dado faltando).
  - `export function fontesPadrao(kind?: string | null): RevenueSettingSource[]` — `['manual']` para
    `'financeiro'`, `['orders','manual']` caso contrário.
  - `user.tenantKind?: TipoEmpresa` e `TenantOption.kind?: TipoEmpresa` no `AuthContext`.

### Steps

- [ ] **Step 1: Teste que falha** (`src/test/lib/tipoEmpresa.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { empresaTemPdv, fontesPadrao } from '../../lib/tipoEmpresa';

describe('tipo da empresa', () => {
  it('só a empresa financeira não tem PDV', () => {
    expect(empresaTemPdv('financeiro')).toBe(false);
    expect(empresaTemPdv('loja')).toBe(true);
  });

  it('na dúvida, assume que tem PDV (nenhuma loja perde tela por dado faltando)', () => {
    expect(empresaTemPdv(undefined)).toBe(true);
    expect(empresaTemPdv(null)).toBe(true);
    expect(empresaTemPdv('')).toBe(true);
    expect(empresaTemPdv('coisa_nova')).toBe(true);
  });

  it('empresa financeira não nasce contando pedidos', () => {
    expect(fontesPadrao('financeiro')).toEqual(['manual']);
    expect(fontesPadrao('loja')).toEqual(['orders', 'manual']);
    expect(fontesPadrao(undefined)).toEqual(['orders', 'manual']);
  });
});
```

- [ ] **Step 2: Rodar — confirmar FAIL**

```
npx vitest run src/test/lib/tipoEmpresa.test.ts
```

- [ ] **Step 3: Criar `src/lib/tipoEmpresa.ts`** conforme **Produces**, importando
  `RevenueSettingSource` de `./revenueSources`.

- [ ] **Step 4: Levar `kind` até o `user`** — nos **dois** retornos de `fetchProfileForTenant`
  (`AuthContext.tsx:110-118` no retry e `:130-140` no caminho normal), acrescentar
  `tenantKind: data.kind ?? 'loja'` (e `retry.data.kind ?? 'loja'`), com o campo `tenantKind?: TipoEmpresa`
  no tipo `AuthUser`.

- [ ] **Step 4b: Levar `kind` até o seletor** — nos **três** mapeamentos de `TenantOption`
  (`:197-204`, `:226-233`, `:630-637`), acrescentar `kind: (t.kind as TipoEmpresa) ?? 'loja'`, com o campo
  no tipo `TenantOption`.

- [ ] **Step 4c: Conferir que o valor chega mesmo**

```
# no navegador, logado na loja Testes PDV, no console:
# deve imprimir 'loja' — se imprimir undefined, o Step 4 não pegou o ponto certo
```

Esperado: `user.tenantKind === 'loja'` em Testes PDV e `'financeiro'` numa empresa de teste de T03.

- [ ] **Step 5: `fetchRevenueSettings` respeita o tipo** (`revenueSources.ts:93-104`) — receber o `kind` como
  parâmetro opcional e, quando não houver linha, cair em `fontesPadrao(kind)` em vez do default fixo.
  Atualizar as chamadas (`DRETab`, `DREComparativoTab`, `useFinanceiro`, `useReceitas`) para passar
  `user?.tenantKind`. Manter a assinatura compatível: sem o parâmetro, o comportamento é o de hoje.

- [ ] **Step 6: Rodar teste — PASS** + gate iterativo

### Definição de pronto (DoD)

- [ ] Teste passa; `user.tenantKind` chega às telas (conferir no navegador com a loja Testes PDV: `'loja'`)
- [ ] Os **2** retornos de `fetchProfileForTenant` e os **3** mapeamentos de `TenantOption` cobertos
- [ ] `DEFAULT_REVENUE_SOURCES` continua existindo e valendo para quem não passa `kind`
- [ ] Gate iterativo verde

---

## T09: Porta de entrada — card, acesso à página e seletor

| Campo | Valor |
|-------|-------|
| **Entregável** | Card "Financeiro" em `/modulos`; página aceita o papel; seletor com selo e "empresa" |
| **Onde** | `src/pages/modulos/page.tsx`, `src/pages/financeiro/page.tsx`, `src/pages/selecionar-loja/page.tsx` |
| **Depende de** | T06, T07, T08 |
| **Requisitos** | RF12, RF13, RF15 |

### Context pack

- **Spec:** §2 RF12/RF13/RF15, US-01.
- **As Is:** `modulos/page.tsx:15-31` (interface `ModuloCard`), `:33-177` (array `MODULOS`, o card "Gestão"
  nas linhas 164-177 é o vizinho a imitar), `:450-466` (`modulosVisiveis`, com `perfilOk`).
  `financeiro/page.tsx:84` restringe a `admin`/`gerente`.
  `selecionar-loja/page.tsx:95,97,106,127-129` tem os textos com "loja"; o ícone é `Store` (linha 33).
- **Não fazer:** mudar a visibilidade de qualquer card existente; mexer no card "Gestão".

### Interfaces

- **Consumes:** `empresaTemPdv` (T08), `user.tenantKind` (T08), papel `'financeiro'` (T06).
- **Produces:** card com `id: 'financeiro'`, `rota: '/financeiro'`.

### Steps

- [ ] **Step 1: Card novo** em `MODULOS`, no estilo do card "Gestão" (ícone de dinheiro/gráfico, tag `'Admin'`):

```ts
{
  id: 'financeiro',
  titulo: 'Financeiro',
  descricao: 'Contas, bancos, conciliação, notas, folha e DRE',
  icon: 'ri-money-dollar-circle-line',
  rota: '/financeiro',
  // acento*: copiar o conjunto de classes de um card existente
  tag: 'Admin',
},
```

> Conferir o nome real do campo de ícone e o formato do acento no card "Gestão" antes de escrever.

- [ ] **Step 2: Visibilidade** em `modulosVisiveis` — o card aparece quando o papel é `financeiro`
  **ou** quando a empresa não tem PDV:

```ts
if (m.id === 'financeiro') {
  return user?.perfil === 'financeiro' || !empresaTemPdv(user?.tenantKind);
}
```

> Encaixar junto das outras regras específicas por `id` já existentes no bloco, preservando os filtros de
> `emails`/`modulo`/`perfis`.

- [ ] **Step 3: Página aceita o papel** (`financeiro/page.tsx:84`) — acrescentar `'financeiro'` ao cheque que
  hoje só deixa passar `admin`/`gerente`. O filtro de abas por permissão continua valendo.

- [ ] **Step 4: Seletor** (`selecionar-loja/page.tsx`) — quando a empresa não tem PDV:
  selo "sem PDV" no cartão, e as palavras "Loja"/"lojas" viram "Empresa"/"empresas". Quando **todas** as
  empresas da lista não têm PDV, o título e o texto de apoio também usam "empresa".
  Loja com PDV: texto **idêntico** ao de hoje.

- [ ] **Step 5: Conferir no navegador**, na loja Testes PDV com `qa.admin`: `/modulos` sem card novo e com os
  mesmos cards de antes; seletor com o texto de hoje. **Evidência para CS3.**

- [ ] **Step 6: Gate iterativo**

### Definição de pronto (DoD)

- [ ] Card aparece só nos dois casos previstos
- [ ] `/modulos` e seletor inalterados para a loja com PDV (evidência registrada)
- [ ] Gate iterativo verde

---

## T10: DRE e DRE Comparativo sem o que é de PDV

| Campo | Valor |
|-------|-------|
| **Entregável** | Cancelamentos, descontos, CMV teórico e cobertura de ficha ausentes em empresa financeira |
| **Onde** | `src/pages/financeiro/components/DRETab.tsx`, `src/pages/financeiro/components/DREComparativoTab.tsx` |
| **Depende de** | T08 |
| **Paralelo com** | T11 (∥) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF16 |

### Context pack

- **Spec:** §2 RF16, US-03, US-05, restrições R1 e R2.
- **As Is:** a receita por canal **já some sozinha** (`applyRevenueSources` zera e o JSX condiciona a `> 0`,
  `DRETab.tsx:1290-1305`) — **não mexer nisso**. O que precisa de condição:
  - `DRETab.tsx:1340-1349` (cancelamentos e descontos, blocos informativos "Só conferência")
  - `DRETab.tsx:82-104` (`fetchCmvConsumo`) e `:1401-1406` (CMV teórico + cobertura de ficha)
  - `DREComparativoTab.tsx:53-66` (`fetchCmvConsumoComp`) e `:596-606` (cancelamentos/descontos)
- **Não fazer:** mudar cálculo de receita, de CMV real (compras) ou o resultado da DRE; tocar em
  `DREDrillDownModal` (ele só abre a partir de linhas que já não aparecem).

### Interfaces

- **Consumes:** `empresaTemPdv(user?.tenantKind)` (T08).
- **Produces:** nenhuma assinatura nova.

### O que será feito

1. Uma constante por componente: `const temPdv = empresaTemPdv(user?.tenantKind);`
2. **Não buscar** o CMV teórico quando `!temPdv` (evita query inútil): sair cedo de `fetchCmvConsumo` /
   `fetchCmvConsumoComp` devolvendo o mesmo formato vazio que já é usado em caso de erro.
3. Envolver em `temPdv && (...)` os blocos de JSX de cancelamentos, descontos, CMV teórico e cobertura.
4. Conferir que, com `temPdv === true`, o JSX renderizado é **byte a byte** o de hoje.

### Steps

- [ ] **Step 1: Ler os 4 blocos** nos números de linha do Context pack e confirmar que continuam lá.
- [ ] **Step 2: Aplicar a condição** conforme "O que será feito", sem alterar nenhuma conta.
- [ ] **Step 3: Conferir a loja com PDV** — Testes PDV, aba DRE, regime caixa e competência: receita por
  canal, cancelamentos, descontos e CMV teórico continuam presentes. **Evidência para CS3.**
- [ ] **Step 4: Conferir a empresa financeira** — uma das empresas de teste de T03: nenhum dos 4 blocos.
- [ ] **Step 5: Gate iterativo**

### Definição de pronto (DoD)

- [ ] Os 4 blocos condicionados nos 2 componentes
- [ ] Nenhuma query de CMV teórico disparada em empresa financeira (conferir na aba de rede)
- [ ] DRE da loja com PDV idêntica (evidência registrada)
- [ ] Gate iterativo verde

---

## T11: Visão Geral, Contas Vencidas e Bancos

| Campo | Valor |
|-------|-------|
| **Entregável** | Sem ticket médio nem Modo Sessão; impacto na margem honesto; rótulos de roteamento coerentes |
| **Onde** | `src/pages/financeiro/components/VisaoGeralFinTab.tsx`, `src/pages/financeiro/components/ContasVencidasPanel.tsx`, `src/pages/financeiro/components/BancosContasTab.tsx`, `src/test/components/contasVencidasImpacto.test.ts` (criar) |
| **Depende de** | T08 |
| **Paralelo com** | T10 (∥) |
| **Requisitos** | RF16, RF17 |

### Context pack

- **Spec:** §2 RF16/RF17, US-03, US-05. **RF17 vale para toda empresa** — é o único ponto em que a loja com
  PDV muda, e muda só o texto quando não há receita no período.
- **As Is:** `useFinanceiro.ts:794` (ticket médio, já com guarda de zero); `VisaoGeralFinTab.tsx:184-185`
  (`isSessao`) e `:245-251` (`SessaoSelector` + `ModoFaturamentoToggle`);
  `ContasVencidasPanel.tsx:215` (`impactoMargem`) e `:333-337` (cartão);
  `BancosContasTab.tsx:26-32` (`INCOME_SOURCES`), usado em `:437` e `:800`.
- **Não fazer:** mexer no `ModoFaturamentoContext` (é global, o PDV depende dele); remover `INCOME_SOURCES`
  (filtrar na hora do uso).

### Interfaces

- **Consumes:** `empresaTemPdv(user?.tenantKind)` (T08).
- **Produces:** `export function rotuloImpactoMargem(totalVencido: number, receitaBruta: number): string` em
  `ContasVencidasPanel` (ou em `src/lib/`, se o teste exigir import isolado) — devolve
  `'sem receita no período'` quando `receitaBruta <= 0`, senão o percentual com uma casa (ex.: `'12,3%'`).

### Steps

- [ ] **Step 1: Teste que falha** (`src/test/components/contasVencidasImpacto.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { rotuloImpactoMargem } from '../../lib/impactoMargem';

describe('impacto na margem', () => {
  it('não finge que está tudo bem quando não houve receita', () => {
    expect(rotuloImpactoMargem(1500, 0)).toBe('sem receita no período');
    expect(rotuloImpactoMargem(0, 0)).toBe('sem receita no período');
    expect(rotuloImpactoMargem(1500, -1)).toBe('sem receita no período');
  });

  it('mostra o percentual quando há receita', () => {
    expect(rotuloImpactoMargem(1000, 10000)).toBe('10,0%');
    expect(rotuloImpactoMargem(1234, 10000)).toBe('12,3%');
  });
});
```

- [ ] **Step 2: Rodar — confirmar FAIL**

```
npx vitest run src/test/components/contasVencidasImpacto.test.ts
```

- [ ] **Step 3: Criar `src/lib/impactoMargem.ts`** com `rotuloImpactoMargem` e usá-lo em
  `ContasVencidasPanel.tsx:333-337`, no lugar de `{impacto.impactoMargem.toFixed(1)}%`.
  Quando o rótulo for a frase, usar o mesmo tom visual de valor ausente já usado na tela (texto `muted`).

- [ ] **Step 4: Visão Geral** — com `!temPdv`: não renderizar o KPI de ticket médio nem o bloco de Modo
  Sessão (`ModoFaturamentoToggle` + `SessaoSelector` + KPIs por sessão), e não chamar
  `useSalesReportBySession`. Com `temPdv`, tudo como hoje.

- [ ] **Step 5: Bancos e Contas** — filtrar `INCOME_SOURCES` quando `!temPdv` nos dois pontos de uso
  (`:437` e `:800`), mantendo as origens que não são de PDV.

- [ ] **Step 6: Rodar teste — PASS**; conferir Testes PDV (ticket médio e Modo Sessão presentes) e a empresa
  financeira (ausentes). **Evidência para CS3 e CS4.**

- [ ] **Step 7: Gate iterativo**

### Definição de pronto (DoD)

- [ ] Teste passa; a loja com PDV em mês com venda mostra o percentual como sempre
- [ ] Ticket médio e Modo Sessão ausentes só em empresa financeira
- [ ] Gate iterativo verde

---

## T12: Empresa financeira abre sem carregar PDV

| Campo | Valor |
|-------|-------|
| **Entregável** | Os 6 contextos de PDV montam sem buscar dados em empresa `kind='financeiro'` |
| **Onde** | `src/contexts/EstoqueContext.tsx`, `ProducaoContext.tsx`, `CardapioContext.tsx`, `ImpressorasContext.tsx`, `KDSContext.tsx`, `MesasContext.tsx` |
| **Depende de** | T08 |
| **Profundidade** | `contracts` |
| **Requisitos** | RF18 |

### Context pack

- **Spec:** §2 RF18, decisão de design B1 (**montar sem buscar**, e não deixar de montar).
- **As Is:** `AppProviders.tsx:78-85` monta os 6. Todos os hooks lançam erro fora do provider — por isso
  **não** se mexe em `AppProviders`. **A guarda vai na função de carga** (o `useCallback` que busca), e não
  só no `useEffect`, para pegar também as chamadas automáticas de Realtime:

  | Context | Carga (`useCallback`) | `useEffect` de mount |
  |---|---|---|
  | `EstoqueContext.tsx` | `:269-368` (`loadInsumos`) | `:450` |
  | `ProducaoContext.tsx` | `:227-289` (`loadFromBackend`) | `:221`, `:292`, `:299` |
  | `CardapioContext.tsx` | `:396` (`recarregar`) | `:574` |
  | `ImpressorasContext.tsx` | — (ver nota) | `:150`, `:164` |
  | `KDSContext.tsx` | carga em `:968-978` | `:919`, `:926`, `:942`, `:949` |
  | `MesasContext.tsx` | `:97-129` | `:110` |

- **Nota sobre Impressoras — expectativa a ajustar, não bug:** `ImpressorasContext:129-166` **não busca
  rede**; ele copia `settings.printers_config` do `SystemSettingsContext`, que é lido para toda empresa e
  está fora desta spec. Guardar aqui não economiza requisição nenhuma. Fazer mesmo assim (por consistência
  e para não manter estado de impressora de empresa que não imprime), mas **não** contar este context no
  ganho de peso, e registrar isso em `executions.md`.
- **Consumidores que não podem quebrar:** `ComprasTab.tsx:60`, `ItensClassificacaoTab.tsx:87` (`useEstoque`),
  `DRETab.tsx:762`, `FolhaRelatorioPDF.tsx:19` (`useImpressoras`), `dashboard/page.tsx:40` (`useKDS`).
- **Não fazer:** alterar `AppProviders.tsx`; afrouxar o `throw` dos hooks; mexer em Realtime de outros
  contextos que não sejam de PDV.

### Interfaces

- **Consumes:** `empresaTemPdv(user?.tenantKind)` (T08).
- **Produces:** nenhuma assinatura nova — o estado público de cada context continua igual (listas vazias e
  `loading: false` quando não busca).

### O que será feito

Em cada um dos 6 contextos, no `useEffect` de carga inicial e nas assinaturas de Realtime: sair cedo quando
`!empresaTemPdv(user?.tenantKind)`, deixando o estado no valor inicial vazio e `loading` em `false` (nunca
preso em `true`, senão a tela fica girando). Funções chamadas **sob demanda** (ex.: `reloadInsumos()` da aba
Compras) continuam funcionando normalmente — o corte é só na carga automática.

### Steps

- [ ] **Step 1:** Para cada context, abrir os pontos da tabela do Context pack e confirmar que continuam lá.
- [ ] **Step 2:** Aplicar a saída antecipada, garantindo `loading = false`.
- [ ] **Step 3: Conferir a empresa financeira** — abrir `/financeiro`, aba de rede: **nenhuma** requisição a
  tabelas de PDV (`menu_items`, `tables`, `kitchen_stations`, `orders`, `printers`, `stock*`). Abrir a aba
  Compras: `reloadInsumos()` funciona e a tela não quebra. Abrir a aba DRE: não quebra (usa `useImpressoras`).
- [ ] **Step 4: Conferir a loja com PDV** — Testes PDV: PDV, KDS, mesas, cardápio e estoque carregam
  **exatamente** como antes. **Evidência para CS3.**
- [ ] **Step 5: Gate iterativo**

### Definição de pronto (DoD)

- [ ] Nenhuma requisição de PDV em empresa financeira; nenhum `loading` preso
- [ ] Os 5 consumidores citados abrem sem erro
- [ ] Loja com PDV sem nenhuma diferença (evidência registrada)
- [ ] Gate iterativo verde

---

## T13: Admin Master cria a empresa financeira

| Campo | Valor |
|-------|-------|
| **Entregável** | Botão "Nova empresa financeira" chamando a RPC de T03 |
| **Onde** | `src/pages/admin-master/page.tsx`, `src/pages/admin-master/modals.tsx` |
| **Depende de** | T03, T06 |
| **Profundidade** | `contracts` |
| **Requisitos** | RF20 |

### Context pack

- **Spec:** §2 RF20, US-04.
- **As Is:** `admin-master/page.tsx:96-101` tem as ações de manutenção da aba Lojas; `modals.tsx:7` define
  `ADMIN_MASTER_EMAIL`; `acessos.tsx:54-57` mostra como as RPCs `fn_admin_*` são chamadas do front.
  `NewInviteModal` em `modals.tsx` é o vizinho de estilo para um modal novo.
- **Não fazer:** tocar no fluxo de convite/onboarding com PDV; criar caminho de criação fora do Admin Master.

### Interfaces

- **Consumes:** `fn_admin_create_finance_tenant(p_name, p_cnpj, p_user_id)` (T03); papel `'financeiro'` em
  `ROLE_OPTIONS` (T06).
- **Produces:** nenhuma assinatura nova.

### O que será feito

Modal com nome (obrigatório), CNPJ (opcional) e a pessoa responsável (o mesmo seletor de usuário já usado na
aba Acessos). Ao confirmar, chama a RPC, mostra erro do banco como está (sem engolir) e, no sucesso, recarrega
a lista de empresas e avisa que a empresa nasceu com plano de contas e fontes de receita.

### Steps

- [ ] **Step 1:** Ler `NewInviteModal` e a chamada de `fn_admin_set_user_tenant` para seguir o mesmo padrão.
- [ ] **Step 2:** Criar o modal e o botão na aba Lojas.
- [ ] **Step 3:** Testar criando uma **terceira** empresa financeira de teste pela tela; conferir no banco
  `kind`, papel, `sources` e as 16 categorias.
- [ ] **Step 4:** Conferir que a aba Lojas continua listando e operando as lojas existentes como antes.
- [ ] **Step 5: Gate iterativo**

### Definição de pronto (DoD)

- [ ] Empresa criada pela tela, completa
- [ ] Erro do banco aparece para o dono, sem ser engolido
- [ ] Aba Lojas sem regressão
- [ ] Gate iterativo verde

---

## Definição de pronto — comum a todas as tasks

- [ ] Steps concluídos; Interfaces (Consumes/Produces) respeitadas
- [ ] Código + testes quando a task tem teste
- [ ] Gate iterativo verde, com evidência em `executions.md` (skill `verification`)
- [ ] Revisão do `/sdd-06-execute` aprovada (Estágio 1 + Estágio 2 + `receiving-review` quando houver fix)
- [ ] Sem shadow code — tudo rastreável a um RF da spec
- [ ] Nenhum arquivo fora da coluna **Onde** modificado
