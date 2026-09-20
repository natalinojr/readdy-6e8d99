---
issue: N/A
tipo: feat
slug: modulo-financeiro-sem-pdv
titulo: Módulo Financeiro para empresa sem PDV (Fase 1)
branch: claude/modulo-financeiro-sem-pdv
tdd: true
tdd_integracao: fora
feature_flag: nao
status: done
criado: 2026-09-20
autor: "@natalinojr"
---

# Spec: Módulo Financeiro para empresa sem PDV (Fase 1)

## Metadados

| Campo | Valor |
|-------|-------|
| Issue | `N/A` — sem issue tracker neste projeto (ver [AGENTS.md](../../AGENTS.md)); entrada = [`BRIEFING-MODULO-FINANCEIRO.md`](../../BRIEFING-MODULO-FINANCEIRO.md) |
| Tipo | `feat` |
| Branch | `claude/modulo-financeiro-sem-pdv` · base `main` (convenção do projeto; ver [sdd-branch.md](../templates/sdd-branch.md)) |
| TDD | `true` **só na lógica pura** (o que aparece por tipo de empresa, guarda de rota do papel novo, fontes de receita padrão, divisão por zero); telas e migrations = teste manual · integrações: `fora` (ver [sdd-tdd.md](../templates/sdd-tdd.md) e [AGENTS.md](../../AGENTS.md)) |
| Feature flag | `nao` — a marca da empresa (`tenants.kind = 'financeiro'`) já é a chave: loja com PDV nasce e continua `'loja'`, então nada novo liga para ela (decisão do dono, 2026-09-20) |
| Pasta | `specs/2026-09-modulo-financeiro-sem-pdv/` |
| Status | done |

**Tipos:** `feat` (feature/comportamento novo), `fix` (bug), `refactor`, `perf`, `chore`, `docs`.

## Por quê?

Hoje o Financeiro é uma aba dentro de "Gestão" e só existe dentro de uma loja com PDV: nascer loja é nascer
PDV (estações, cardápio, mesas), não existe papel "só financeiro", não há card em `/modulos`, e as telas que
leem pedido/caixa aparecem zeradas — o que parece defeito. O dono quer que exista também um **módulo
Financeiro para quem não tem PDV** (empresa que usa só contas, bancos, conciliação, notas, folha e DRE;
caso típico: contador com várias empresas).

Decisões já tomadas pelo dono (2026-09-20): quem tem PDV continua **idêntico** (toda mudança em tela
compartilhada é condicional); mesmo banco, mesmas telas, mesma rota `/financeiro` — **sem duplicar** o
Financeiro; uma pessoa pode ter várias empresas (usa o seletor que já existe, com a palavra "empresa");
nome do módulo = "Financeiro".

**Escopo desta spec = Fase 1 do briefing (§4):** marca no tenant, papel `financeiro`, card em `/modulos`,
entrada/navegação sem contextos de PDV, telas condicionais (DRE, Visão Geral, Contas Vencidas), nascimento
da empresa financeira pelo Admin Master e versionamento de `fn_setup_tenant_bypass`.
**Fora:** cadastro self-service, cobrança por módulo, empresa-mãe/DRE consolidada, app móvel dedicado (§5).

## 1. As Is (Research)

> Levantado em 2026-09-20 por 3 frentes paralelas (Sonnet, só leitura) + consulta direta ao banco
> (`mdghhjemzdmeuqpzuyzx`) via MCP Supabase. Números de linha conferidos no código atual; onde o briefing
> divergia, vale o que está aqui.

### Contexto

O Financeiro é uma **rota própria** (`/financeiro`, `src/router/config.tsx:41,113`), não uma aba de
`/dashboard` — mas só se chega nela pelo menu lateral da seção "Gestão" (`Sidebar.tsx:68`), que por sua vez
só aparece depois de entrar pelo card "Gestão" de `/modulos` (`rota: '/dashboard'`, `perfis: ['admin','gerente']`).
A página tem **20 abas** (`src/pages/financeiro/page.tsx:27-48`), filtradas por permissão
(`FIN_ABAS` em `src/constants/permissoesAbas.ts:6-27`), e é guardada por `RotaProtegida` exigindo `FIN_KEYS`
mais um cheque de `admin`/`gerente` na própria página (`page.tsx:84`). "DRE Comparativo" **não é uma das 20
abas**: é sub-aba de `dre` (`DREContainer.tsx:6-10`, junto com `CategoriasDRETab`).

RLS das tabelas `fin_*` filtra **só por participação na loja** (`auth_is_member_of(tenant_id)`), sem olhar
`role` — confirma o briefing §3.1: empresa sem PDV não exige mudança de RLS para **leitura**.

### Comportamento atual

**Papéis.** `user_tenants.role` é **enum Postgres `user_role`**, hoje com
`admin, manager, cashier, waiter, kitchen, customer, tablet, delivery_manager, tasks_only` (consulta ao
banco, 2026-09-20). Um papel novo exige `ALTER TYPE user_role ADD VALUE 'financeiro'` **antes** de qualquer
escrita. O mapa PT↔EN tem **5 cópias no front** (a memória do projeto dizia 4), mais 2 mapas inline numa Edge
e 1 lista fixa em SQL — ver tabela de arquivos.

**Guarda de rota.** `RotaProtegida.tsx` tem o padrão de hard-lock que o papel novo deve copiar (linhas 45-54):
`gestor_entregas` e `tarefas` são presos ao próprio prefixo antes de qualquer outra lógica;
`PAPEIS_ADMIN = ['admin','gerente']` (linha 30) passa por tudo sem checar permissão. Permissões vêm de
`usePermissoes()` (Context, `src/hooks/usePermissoes.ts:105`), populado por `config-write/get_permissions`
com fallback `DEFAULT_PERMISSOES` por papel (linhas 51-84) — onde o papel `financeiro` ainda não existe.

**Escrita no Financeiro é barrada por rank, não por lista.** Ponto **não previsto no briefing** e o mais
importante do research: as Edge Functions do Financeiro exigem `isManagerRole` / rank ≥ 2
(`supabase/functions/_shared/tenant-auth.ts:14-27`, onde só `admin:3, manager:2, gerente:2` existem) ou
comparam `role === 'admin' || role === 'manager'` inline. Um papel `financeiro` **seria barrado em toda
escrita**: `financial-write:51` (comentário explícito "Financeiro/RH é só admin/gerente, 2026-09-19"),
`purchase-write:535`, `config-write:50`, `inter-bank:992`, `stone-conciliation:588,628,665`,
`fiscal-inbound:879,891,946,987,1021`, `ifood-financial:679,700,742,788`.

**Entrada / seletor.** Não há `TenantContext`: é o `AuthContext`. A lista de empresas vem da RPC
**`get_user_tenants`**, que devolve `tenant_id, tenant_name, role, training_mode, is_active` (definição lida
no banco) — **sem `kind`**, e **não versionada** em migrations. A troca de empresa não recarrega a página:
`selectTenant` (`AuthContext.tsx:585-602`) grava `localStorage` e troca `user`, e cada context re-busca por
`useEffect([user?.tenantId])`. A UI do seletor (`src/pages/selecionar-loja/page.tsx:95,97,106,127-129`) diz
"loja" em texto fixo.

**Contextos de PDV — o item 4 do briefing não é só "não montar".** `AppProviders.tsx:78-85` monta
`Estoque → Producao → Cardapio → Impressoras → KDS → Mesas`; todos buscam no mount por `user?.tenantId` e
**todos os hooks lançam erro fora do provider** (ex.: `EstoqueContext.tsx:818`). Consumidores fora de telas
de PDV que quebrariam: `financeiro/components/ComprasTab.tsx:60` e `ItensClassificacaoTab.tsx:87`
(`useEstoque`), `financeiro/components/DRETab.tsx:762` e `FolhaRelatorioPDF.tsx:19` (`useImpressoras`), e
`src/pages/dashboard/page.tsx:40` (`useKDS`).

**Telas que assumem PDV.** Boa parte já se resolve sozinha por `fin_revenue_settings.sources`:
`applyRevenueSources()` (`src/lib/revenueSources.ts:175-191`) **zera** receita de canal quando `orders` não
está ligado, e o JSX da DRE condiciona cada linha a `> 0` (`DRETab.tsx:1290-1305`) — some sozinho. O mesmo
vale para a aba Receitas, que já nem dispara a query (`useReceitas.ts:143`) e esconde o KPI
(`ReceitasTab.tsx:410,466,940`). **O que não se resolve sozinho:** cancelamentos e descontos
(`DRETab.tsx:1340-1349`), CMV teórico e cobertura de ficha (`DRETab.tsx:82-104, 1401-1406`;
`DREComparativoTab.tsx:53-66`), ticket médio (`useFinanceiro.ts:794`) e Modo Sessão
(`VisaoGeralFinTab.tsx:184-185,245-251`, tabela `sessions`), além dos rótulos de roteamento
(`BancosContasTab.tsx:26-32`). O "% de impacto na margem" de `ContasVencidasPanel.tsx:215` **já tem guarda**
de divisão por zero — o problema real não é `NaN`, é exibir "0,0%" como se não houvesse impacto.

**Nascimento de empresa.** Hoje **não existe "criar loja" no Admin Master**: a tela lista e faz manutenção
(`admin-master/page.tsx:96-101`). Loja nasce por convite → onboarding público → Edge `setup-tenant`, que
**não valida JWT** (só `inviteCode`) e chama `fn_setup_tenant_bypass` — cujo corpo, lido no banco, cria
`tenants(plan='trial')`, `users`, `user_tenants(role='admin')` e `system_settings`; nada de `fin_*`. Dois
triggers em `tenants` já rodam no insert: `handle_new_tenant` (system_settings) e
`fn_platform_owner_membership` (dá `admin` ao dono da plataforma em toda loja nova).

**Plano de contas DRE.** Tabela `fin_dre_categories` (não `fin_categories`), legada, não versionada.
**Não há seed**: das 10 empresas do banco, só 3 têm categorias (26, 4 e 1 linha). Hoje o plano nasce vazio e
o usuário cadastra na sub-aba Categorias.

**`fin_revenue_settings`.** `sources text[] default array['orders','manual']`, CHECK atual
`<@ array['orders','stone','pix','manual','ifood']`; RLS só de `select`; escrita só por `service_role`.
Sem linha na tabela, o front cai no default `['orders','manual']` (`revenueSources.ts:103`) — ou seja, uma
empresa sem PDV **se comporta como se tivesse PDV** até alguém gravar a linha.

**Testes.** Não existe **nenhum** teste hoje de `RotaProtegida`, `AppLayout`, `/modulos`, mapas de papéis,
`revenueSources.ts`, `DRETab`, `useFinanceiro` ou `ContasVencidasPanel`. A cobertura desta spec parte do zero.
Vizinhos úteis como estilo: `src/test/lib/comprasDRE.test.ts`, `dreGroups.test.ts`, `acoesFinanceiroDre.test.ts`.

### Arquivos e componentes relevantes

| Área | Caminho / componente | Papel |
|------|----------------------|-------|
| Papéis (mapa PT↔EN) | `src/contexts/AuthContext.tsx:64-73` · `src/hooks/useUsuarios.ts:6-26` · `src/hooks/useAcessoMultiLoja.ts:6-26` · `src/pages/configuracoes/components/PermissoesTab.tsx:81-95` · `src/hooks/usePermissoes.ts:40-48` | 5 cópias do mapa |
| Papéis (listas/tipos) | `src/constants/usuarios.ts:1-12` (`PerfilUsuario` + `perfilConfig`) · `AuthContext.tsx:8` · `usePermissoes.ts:7` · `src/pages/admin-master/acessos.tsx:8-22` (`ROLE_OPTIONS`) · 3 cópias de `perfilLabel` (`Sidebar.tsx:91-97`, `selecionar-loja/page.tsx:7-13`, `modulos/page.tsx:179-185`) | Enumerações a estender |
| Papéis (backend) | enum `user_role` (banco) · `supabase/functions/user-write/index.ts:78,110-114` · `fn_admin_set_user_tenant` (`20260914000000_...sql:77`) | Validação server-side |
| Guarda de rota | `src/components/feature/RotaProtegida.tsx:13-25,30,45-54` | Hard-lock a copiar |
| Moldura / sem loja | `src/components/feature/AppLayout.tsx:30,76-105,144-188` | `NO_TENANT_ROUTES` |
| Entrada | `src/pages/modulos/page.tsx:15-31,33-177,450-466` | Cards e visibilidade |
| Seletor | `src/contexts/AuthContext.tsx:181,226-233,585-644` · `src/pages/selecionar-loja/page.tsx` · RPC `get_user_tenants` (banco) | Lista e troca de empresa |
| Contexts de PDV | `src/providers/AppProviders.tsx:78-85` + consumidores citados acima | Peso e quebra |
| Telas condicionais | `DRETab.tsx` · `DREComparativoTab.tsx` · `VisaoGeralFinTab.tsx` · `useFinanceiro.ts:794` · `ContasVencidasPanel.tsx:108-117,215` · `BancosContasTab.tsx:26-32` | O que esconder |
| Fontes de receita | `src/lib/revenueSources.ts` · `supabase/migrations/20260912120000_fin_revenue_settings.sql` | Mecanismo central |
| Nascimento | `supabase/functions/setup-tenant/index.ts:194-200,344-351,384-502` · `fn_setup_tenant_bypass` (banco) · triggers `on_tenant_created*` | Criar empresa |
| Admin Master | `src/pages/admin-master/page.tsx`, `modals.tsx:7`, `acessos.tsx:54-59` · `fn_admin_*` | Onde criar/conceder |
| Escrita do Financeiro | `supabase/functions/_shared/tenant-auth.ts:14-27` + 8 Edges listadas acima | Barreira de papel |
| Precedente de módulo | `src/hooks/useModuleAccess.ts` · `supabase/migrations/20260914000000_user_module_access_admin_master.sql` | Estilo a seguir |

### Lacunas do research

- [x] Corpo de `fn_setup_tenant_bypass` e de `get_user_tenants` — **obtidos** no banco (a CLI não serve: `db dump` exige Docker, ausente na máquina).
- [x] `user_tenants.role` é enum (não text) — **confirmado**; exige `ALTER TYPE`.
- [x] Quantas cópias do mapa de papéis — **5** no front (+2 inline na Edge `user-write`, +1 lista em SQL).
- [ ] **Decisão para o Specify:** o papel `financeiro` precisa **escrever** (pagar conta, lançar compra, conciliar). Como as Edges barram por rank, é preciso escolher entre dar rank 2 ao papel novo (ele passa a poder tudo que gerente pode, inclusive fora do Financeiro) ou criar um rank/permissão específica. **Nenhum trabalho de front resolve isso** — é decisão de desenho, tratada em §2.
- [x] **Decisão para o Specify:** contextos de PDV — resolvido por B1 (montar sem buscar).
- [x] **Achado tardio (revisão do plano, 2026-09-20):** o objeto `user` do front é montado por
  **`get_user_profile_for_tenant`**, não por `get_user_tenants`. Ambas precisam devolver `kind`, e ambas
  estão não versionadas. Há ainda um 3º mapeamento de `TenantOption` (ramo de retry de JWT,
  `AuthContext.tsx:197-204`) que o As Is não tinha visto.
- [ ] `fn_setup_tenant_bypass` e `get_user_tenants` não estão versionadas: ao versionar, o arquivo passa a ser a fonte da verdade — conferir que o `CREATE OR REPLACE` não perca nada do corpo atual (copiado literal do banco).
- [ ] Plano de contas DRE padrão **não existe em lugar nenhum** — o conteúdo inicial (quais categorias) precisa ser definido no Specify/Plan; não há de onde copiar.

---

## 2. To Be (Specify)

### Resumo

Uma empresa passa a ter **tipo** (`tenants.kind`: `'loja'` padrão, `'financeiro'`). Quem é `'financeiro'`
ganha porta de entrada própria em `/modulos`, um papel `financeiro` que só alcança `/financeiro` (na tela e
no servidor), telas sem o que depende de pedido/caixa, e nasce pronta (plano de contas + fontes de receita).
Para `kind='loja'` **nada muda** — nenhum caminho novo é avaliado em tempo de execução além de comparar o
tipo, que é `'loja'` para todas as 10 empresas existentes.

### Goals

- [ ] G1 — `tenants.kind` existe, com `'loja'` como padrão, e chega ao front pelo mesmo caminho da lista de empresas.
- [ ] G2 — Papel `financeiro` existe de ponta a ponta: enum, mapas PT↔EN, seletor do Admin Master, permissões padrão, guarda de rota e **escrita liberada só nas funções do Financeiro**.
- [ ] G3 — Quem tem o papel entra pelo card "Financeiro" em `/modulos` e não enxerga nem alcança nada de PDV.
- [ ] G4 — Onde a empresa é `'financeiro'`, o texto fala "empresa" e o seletor mostra que ela não tem PDV.
- [ ] G5 — Nas telas do Financeiro, o que depende de pedido/caixa não aparece para empresa `'financeiro'`.
- [ ] G6 — O Admin Master cria uma empresa financeira já com plano de contas e fontes de receita corretas, e concede o papel.
- [ ] G7 — `fn_setup_tenant_bypass` e `get_user_tenants` passam a existir em migration (hoje só no banco).
- [ ] G8 — Empresa `'financeiro'` não carrega dados de PDV ao abrir.

### Critérios de sucesso

- [ ] CS1 — `node scripts/check.mjs --force` verde, **sem** `--update-baseline` (contagem de erros TS não aumenta; nenhum teste novo falhando; suíte não encolhe).
- [ ] CS2 — Testes novos (lógica pura) passando: visibilidade por tipo de empresa, guarda do papel, `DEFAULT_REVENUE_SOURCES` da empresa financeira, rótulo de impacto na margem sem receita, `isFinanceiroRole`.
- [ ] CS3 — Na loja **Testes PDV** (`kind='loja'`), com `qa.admin`: `/modulos`, `/dashboard` e as 20 abas do Financeiro **idênticas** ao estado atual — comparação antes/depois registrada em `executions.md` (a DRE continua mostrando receita por canal, cancelamentos, descontos e CMV teórico).
- [ ] CS4 — Numa empresa de teste `kind='financeiro'`, com um usuário de papel `financeiro`: entra direto no Financeiro; digitar `/pdv`, `/dashboard`, `/estoque` na barra devolve para `/financeiro`; a DRE não mostra linha de canal, cancelamento, desconto, CMV teórico nem cobertura de ficha; a Visão Geral não mostra ticket médio nem Modo Sessão; Contas Vencidas não mostra "0,0%" de impacto e sim a frase de ausência de receita.
- [ ] CS5 — Com o mesmo usuário em **duas** empresas financeiras: trocar de empresa troca os dados e nenhum valor da anterior permanece na tela.
- [ ] CS6 — Uma conta a pagar é **efetivamente paga** pelo usuário de papel `financeiro` (a Edge aceita), e a mesma chamada feita contra uma função de PDV (ex.: `order-write`) é recusada por papel.
- [ ] CS7 — Empresa financeira criada pelo Admin Master nasce com as categorias DRE padrão e `sources` sem `'orders'`; nenhuma estação, mesa, categoria de cardápio ou `pdv_config` é criada para ela.
- [ ] CS8 — Nenhuma escrita em loja real durante os testes (só Testes PDV e as empresas financeiras de teste criadas para isso).

### Non-goals

- Cadastro público/self-service: a empresa financeira nasce pelo Admin Master.
- Cobrança/planos por módulo.
- Empresa-mãe com várias lojas e DRE consolidada.
- App móvel dedicado ao financeiro.
- Reescrever o Financeiro, extrair componentes ou criar uma "versão avulsa" das telas.
- Corrigir a dívida existente de papéis (as 5 cópias do mapa continuam 5; só ganham mais uma entrada).
- Trocar o texto "loja"→"empresa" em telas fora do escopo (iFood, notas, freelancers) — só onde o tipo da empresa é conhecido e o texto é da entrada/navegação.

### Restrições

**Do `AGENTS.md` (padrão do projeto):**
- `tenant_id` em toda leitura e escrita; contexts resetam ao trocar de empresa.
- Datas em horário de Brasília.
- CMV = compras realizadas (a regra não muda; o CMV **teórico** é que some da tela sem PDV).
- Função `SECURITY DEFINER` nova exige `REVOKE ALL ... FROM PUBLIC, anon` na própria migration.
- Tabela nova exige `GRANT` ao `service_role`.
- Nunca `check.mjs --update-baseline`; nunca escrever em loja real em teste.

**Específicas desta spec:**
- R1 — **O caminho de quem tem PDV não muda**, nem visualmente. Toda diferença é condicionada a `kind === 'financeiro'`, nunca a `kind !== 'loja'` como efeito colateral de outra regra.
- R2 — **Não duplicar telas do Financeiro.** Mesma rota, mesmos componentes.
- R3 — O papel `financeiro` **não pode** gravar em nada de PDV (pedido, caixa, cardápio, mesa, impressora),
  nem por chamada direta à Edge.
  **Precisão dada em 2026-09-20, na execução** (a redação original dizia só "estoque" e a revisão adversarial
  mostrou que ela se contradizia com a própria RF07): lançar compra e receber nota **dão entrada no estoque**
  — é a mesma operação, e é dela que o CMV vive. Então:
  - **Permitido** ao papel: a movimentação de estoque que é **consequência** de uma compra ou nota que ele
    tem direito de lançar (`create_purchase`, `update_purchase`, `confirm_delivery` em `purchase-write`,
    incluindo o `fn_add_stock_movement` e o ajuste de fornecedor/unidade/fator do insumo comprado).
  - **Proibido** ao papel: mexer no estoque **por fora** de uma compra — edição de insumo, inventário, perda,
    ficha técnica (Edges de estoque/cardápio, que seguem com `isManagerRole`) — e
    **`bulk_insert_ingredients`** em `financial-write`, que cria insumo em massa e vem do modal de
    importar/exportar modelos (`ImportExportTemplatesModal.tsx`), não de tela do Financeiro.
  (Decisão do dono, 2026-09-20: "pode lançar compra, com o estoque junto".)
- R4 — `ALTER TYPE ... ADD VALUE` não roda dentro de transação com uso do valor no mesmo bloco: o valor novo do enum vai em **migration própria**, antes de qualquer migration que o use.
- R5 — Ao versionar `fn_setup_tenant_bypass` e `get_user_tenants`, o corpo é cópia **literal** do que está no banco hoje, mais a alteração desta spec — nada a menos.
- R6 — `kind` é somente-leitura para o app: só o Admin Master define, no nascimento.
- R7 — Nenhuma migration desta spec altera ou apaga dado existente (só acrescenta coluna com default, valor de enum, função e linhas novas).

### Abordagens consideradas

**Decisão A — como o papel `financeiro` grava** (barrado hoje por `isManagerRole`/rank ≥ 2):

| Opção | Prós | Contras | Escolha |
|-------|------|---------|---------|
| A1 — `isFinanceiroRole` novo, aplicado só nas 8 Edges do Financeiro | Menor privilégio: o papel não alcança PDV nem por fora da tela; a barreira do PDV fica intacta | Toca 8 arquivos; exige disciplina em Edge financeira futura | ✅ **escolhida** (dono, 2026-09-20) |
| A2 — `financeiro` com rank 2 (= gerente) | Uma linha | Passa a gravar em **qualquer** Edge: cancelar pedido, mexer em estoque de loja com PDV. Trava só visual — viola R3 | ✗ |
| A3 — só leitura nesta fase | Entrega menor | Empresa sem PDV não consegue pagar conta; o módulo não se sustenta | ✗ |

**Decisão B — contextos de PDV para empresa financeira** (G8):

| Opção | Prós | Contras | Escolha |
|-------|------|---------|---------|
| B1 — providers montam, mas **não buscam** quando `kind='financeiro'` | Ganho real (a lentidão é rede/dados, não a casca do provider); zero risco para os 5 consumidores que hoje quebrariam; nada muda para `'loja'` | A casca continua na árvore | ✅ **escolhida** |
| B2 — não montar os providers | "Mais limpo" no papel | Quebra na hora `ComprasTab`, `ItensClassificacaoTab`, `DRETab`, `FolhaRelatorioPDF` e `/dashboard` — os hooks lançam erro fora do provider. Exigiria afrouxar 6 hooks e perder a proteção que eles dão hoje ao PDV | ✗ |

**Recomendação do agente:** A1 + B1 — é o par que entrega o pedido sem tocar no caminho do PDV.

**Decisão C — tipo da empresa:** `tenants.kind text not null default 'loja'` com `CHECK (kind in ('loja','financeiro'))`, no estilo de `20260918010000_tenants_backup_enabled.sql`. Coluna `text` com CHECK, e não enum, porque um tipo futuro (ex.: `'contabilidade'`) sai num `ALTER TABLE` simples em vez de `ALTER TYPE` — e porque `kind` não é usado em índice nem em comparação de alto volume. `N/A — abordagem única` para o transporte: `kind` chega ao front pela RPC `get_user_tenants`, que já é a fonte única da lista de empresas.

### Escopo da entrega

- **Decisão:** **uma spec, em 7 fases** (ordem do briefing §9), executadas em sequência com portão de regressão por fase.
- **Justificativa:** apesar de tocar banco, Edges e front, tudo depende da mesma marca no tenant e do mesmo papel — dividir em specs criaria uma primeira entrega que não funciona sozinha (empresa marcada sem papel, ou papel sem porta de entrada). As fases dão pontos de parada seguros.

### Requisitos funcionais

**Banco e papel**
1. RF01 — `tenants.kind text not null default 'loja'` com CHECK `in ('loja','financeiro')`; as 10 empresas existentes ficam `'loja'`.
2. RF02 — `user_role` ganha o valor `'financeiro'`, em migration própria (R4).
3. RF03 — `get_user_tenants` passa a devolver `kind`, preservando o corpo atual; fica versionada.
4. RF04 — `fn_setup_tenant_bypass` fica versionada com o corpo atual (cópia literal) — sem mudança de comportamento para o onboarding com PDV.
5. RF05 — `fn_admin_set_user_tenant` aceita `'financeiro'` na lista de papéis válidos.

**Escrita (A1)**
6. RF06 — `_shared/tenant-auth.ts` ganha `isFinanceiroRole(role)` = `admin | manager | gerente | financeiro`.
7. RF07 — As **6** Edges do Financeiro (`financial-write`, `purchase-write`, `inter-bank`,
   `stone-conciliation`, `fiscal-inbound`, `ifood-financial`) passam a usar `isFinanceiroRole` no lugar de
   `isManagerRole`/comparação inline. Nenhuma outra Edge muda.
   **`config-write` foi retirada desta lista em 2026-09-20, durante a execução:** ela é a configuração
   **geral**, não a financeira — cria mesa, estação de cozinha e forma de pagamento, altera a loja e grava
   permissões (`upsert_permissions`). Liberar o papel ali daria a ele o PDV e a chance de **ampliar o
   próprio acesso**, violando R3. Nenhuma tela do Financeiro chama `config-write` para escrita; a única
   ação que o caminho do Financeiro usa é `get_permissions`, já liberada a qualquer membro da loja por
   `CONFIG_READ_ACTIONS`.
8. RF08 — Edges de PDV continuam com `isManagerRole` — o papel `financeiro` é recusado nelas (verificável, CS6).

**Front — papel e entrada**
9. RF09 — O papel entra nas 5 cópias do mapa PT↔EN, em `PerfilUsuario`/`Papel`/`perfilConfig`, nas 3 cópias de `perfilLabel`, em `ROLE_OPTIONS` do Admin Master e nos 2 mapas inline de `user-write`.
10. RF10 — `DEFAULT_PERMISSOES` ganha o papel `financeiro` com todas as chaves `fin_*` e nada fora delas.
11. RF11 — `RotaProtegida` prende `financeiro` ao prefixo `/financeiro`, no mesmo padrão de `gestor_entregas`/`tarefas`.
12. RF12 — `/modulos` ganha o card "Financeiro" (rota `/financeiro`), visível para o papel `financeiro` e para quem está numa empresa `kind='financeiro'`.
13. RF13 — A página `/financeiro` aceita o papel `financeiro` no cheque que hoje só deixa `admin`/`gerente` passar.

**Front — empresa e telas**
14. RF14 — `user.tenantKind` existe no `AuthContext`, vindo da RPC, e há um jeito único de perguntar "esta empresa tem PDV?" (helper) usado por todas as telas.
15. RF15 — No seletor, empresa `'financeiro'` aparece com selo "sem PDV" e os textos de entrada usam "empresa" no lugar de "loja".
16. RF16 — Em empresa `'financeiro'`, somem: receita por canal, cancelamentos, descontos, CMV teórico e cobertura de ficha (DRE e DRE Comparativo); ticket médio e Modo Sessão (Visão Geral); rótulos de roteamento de PDV (Bancos e Contas).
17. RF17 — Em Contas Vencidas, quando não há receita no período, o cartão de impacto na margem mostra "sem receita no período" em vez de "0,0%" — **para qualquer tipo de empresa** (hoje a loja com PDV sem venda no mês vê o mesmo "0,0%" enganoso).
18. RF18 — Em empresa `'financeiro'`, os 6 contextos de PDV montam sem buscar dados (B1).

**Nascimento**
19. RF19 — RPC `fn_admin_create_finance_tenant(nome, cnpj, user_id)`, `SECURITY DEFINER`, protegida por `fn_assert_platform_admin()`, cria: tenant `kind='financeiro'`, vínculo do usuário com papel `financeiro`, `fin_revenue_settings.sources = ['manual','pix']` e o plano de contas DRE padrão. Não cria nada de PDV.
20. RF20 — O Admin Master ganha o botão "Nova empresa financeira" que chama essa RPC.
21. RF21 — Plano de contas padrão (`fin_dre_categories`): receita — Receita de Serviços, Receita de Vendas, Outras Receitas; custo — Custo dos Serviços/Mercadorias; imposto — Impostos sobre Vendas (DAS/Simples); despesa — Folha e Encargos, Pró-labore, Aluguel, Água/Luz/Internet, Contabilidade, Marketing, Manutenção, Tarifas Bancárias, Transporte, Material de Escritório, Outras Despesas. É ponto de partida editável na tela, não regra fiscal.

### Edge cases

| Cenário | Comportamento esperado |
|---------|------------------------|
| Empresa `'financeiro'` sem linha em `fin_revenue_settings` | O default do front é `['orders','manual']` e faria a empresa parecer ter PDV. A RPC de nascimento **sempre** grava a linha; além disso, `fetchRevenueSettings` passa a cair em `['manual']` quando a empresa é `'financeiro'` e não há linha |
| Empresa `'financeiro'` criada antes desta spec (não existe hoje) | N/A — as 10 empresas são `'loja'`; a coluna nasce com default |
| Pessoa com papel `financeiro` numa empresa e `admin` em outra | O hard-lock olha o papel **da empresa selecionada**: preso ao Financeiro na primeira, livre na segunda. Trocar de empresa reavalia |
| Pessoa com papel `financeiro` numa empresa `kind='loja'` | Permitido e coerente: vê só o Financeiro daquela loja. As telas continuam mostrando canal/CMV porque a empresa **tem** PDV |
| Empresa `'financeiro'` e alguém com papel `admin` nela | Vê o Financeiro sem as partes de PDV (o corte é pelo tipo da empresa, não pelo papel) e continua alcançando as telas de configuração |
| `/dashboard` acessado por papel `financeiro` | Redirecionado para `/financeiro` pelo hard-lock, antes de `useKDS()` montar |
| Aba Compras/Classificação de itens em empresa `'financeiro'` | Abre normalmente: os contextos montam (B1), só não buscam — a aba usa `reloadInsumos()` sob demanda, que continua funcionando |
| DRE de empresa `'financeiro'` no regime de competência | Mesma regra do regime caixa: linhas de canal ausentes, receita vinda de manual/Pix/recebíveis |
| Loja com PDV sem nenhuma venda no mês | Contas Vencidas mostra "sem receita no período" (RF17) — melhoria que alcança o caminho do PDV **por ser texto**, não número; registrar no antes/depois de CS3 |
| Troca de empresa `'loja'` → `'financeiro'` sem recarregar a página | Os contextos re-avaliam por `useEffect([user?.tenantId])` e param de buscar; a tela do Financeiro re-renderiza pelo novo `tenantKind` |
| Empresa financeira nasce com o dono da plataforma junto | O trigger `fn_platform_owner_membership` dá `admin` ao dono em toda empresa nova — esperado e desejado (é assim que o Admin Master enxerga) |

### Revisão da spec (Specify)

<!-- Agente preenche em /sdd-03-specify; corrigir inline antes da confirmação do dev -->

- [x] Sem TBD / placeholders vagos em §2 e §4 — o único ponto de julgamento (conteúdo do plano de contas) está escrito por extenso em RF21 e marcado como editável.
- [x] Goals ↔ critérios de sucesso ↔ RF ↔ US alinhados — G1→RF01/RF03, G2→RF02/RF05..RF11, G3→RF11..RF13, G4→RF14/RF15, G5→RF16/RF17, G6→RF19..RF21, G7→RF03/RF04, G8→RF18.
- [x] Restrições e non-goals sem contradição — RF17 é a única mudança que alcança a loja com PDV; é troca de texto quando não há receita, declarada aqui e coberta pelo antes/depois de CS3, e não conflita com R1 (nenhum número muda).
- [x] Abordagem escolhida refletida no To Be — A1 em RF06..RF08, B1 em RF18, C em RF01.
- [x] Escopo da entrega adequado — uma spec em 7 fases, cada uma com portão de regressão.

### Confirmação de entendimento

**Agente entendeu como:** a empresa ganha um tipo. Quando o tipo é "financeiro", ela entra por um card
próprio, com um papel que só alcança o Financeiro — na tela e no servidor — e as partes das telas que
dependem de pedido e de caixa não aparecem, porque ali elas não significam nada. A empresa nasce pronta,
pela mão do dono no Admin Master, com plano de contas e com as fontes de receita certas. Para quem tem PDV,
o sistema continua exatamente o mesmo: a única diferença visível é que, num mês sem venda nenhuma, Contas
Vencidas passa a dizer "sem receita no período" em vez de "0,0%".

**Dev confirmou:** [x] Sim — 2026-09-20, na abertura (briefing §2 + escolha A1 no chat). Ajustes: nenhum.

---

## 3. Design

Sem `design.md`: as duas decisões de peso (A1 e B1) estão fechadas em §2 com alternativas e motivo, e o
restante é aplicação do padrão que já existe no código (hard-lock de `RotaProtegida`, card de `/modulos`,
família `fn_admin_*`, estilo de migration de `tenants_backup_enabled`).

### Decisões

| Decisão | Alternativas | Motivo |
|---------|--------------|--------|
| `isFinanceiroRole` só nas Edges do Financeiro | rank 2; só leitura | Menor privilégio: o papel não alcança PDV nem por chamada direta (R3) |
| Providers de PDV montam sem buscar | não montar | Não montar quebra 5 consumidores fora do PDV, 4 deles no próprio Financeiro |
| `tenants.kind` text + CHECK | enum; tabela de tipos; booleano `has_pdv` | Tipo futuro sai em `ALTER TABLE`; `text` evita a cerimônia de `ALTER TYPE`; nome diz o que é, e não o que falta |
| Tipo transportado por `get_user_tenants` | query separada de `tenants` no front | É a fonte única da lista de empresas; evita segunda ida ao banco e mantém `tenant_id` em toda leitura |
| Um helper único "tem PDV?" | cada tela comparar a string | Uma só regra para mudar; testável sem tela |
| RPC `fn_admin_create_finance_tenant` | estender `setup-tenant` | `setup-tenant` é onboarding público sem JWT; a criação pelo dono pertence à família `fn_admin_*`, já protegida por `fn_assert_platform_admin()` |

---

## 4. User stories

### US-01: Contador entra na empresa certa

**Como** pessoa com papel `financeiro` em duas empresas sem PDV, **quero** escolher a empresa e ver só o
Financeiro dela, **para** cuidar das contas de cada cliente sem esbarrar no que não é meu.

**Critérios de aceite:**

- [ ] Ao entrar, vejo o card "Financeiro" em `/modulos` e nenhum card de PDV, KDS, gestor ou Gestão.
- [ ] O seletor lista as duas empresas com o selo "sem PDV" e fala "empresa", não "loja".
- [ ] Digitar `/pdv`, `/estoque` ou `/dashboard` na barra me devolve para `/financeiro`.
- [ ] Trocar de empresa troca os dados na tela, sem nenhum valor remanescente da anterior.

### US-02: Pagar uma conta sem ser gerente

**Como** pessoa com papel `financeiro`, **quero** pagar contas, lançar compras e conciliar o banco,
**para** que a empresa funcione sem depender de um admin.

**Critérios de aceite:**

- [ ] Dar baixa numa conta a pagar funciona (a classificação DRE continua obrigatória, como hoje).
- [ ] Lançar compra, importar nota de entrada e conciliar extrato funcionam.
- [ ] A mesma credencial é **recusada** por uma função de PDV (ex.: `order-write`).

### US-03: DRE que não mente

**Como** dono de empresa sem PDV, **quero** que a DRE mostre só o que existe aqui, **para** não olhar linhas
zeradas e achar que o sistema está quebrado.

**Critérios de aceite:**

- [ ] A DRE não traz receita por canal, cancelamentos, descontos, CMV teórico nem cobertura de ficha.
- [ ] A Visão Geral não traz ticket médio nem Modo Sessão.
- [ ] Contas Vencidas não mostra "0,0%" de impacto quando não há receita no período.
- [ ] A receita vem de lançamento manual e Pix, conforme as fontes da empresa.

### US-04: O dono cria a empresa

**Como** dono da plataforma, **quero** criar uma empresa financeira pelo Admin Master e dar o papel a alguém,
**para** colocar um cliente novo no ar sem passar por convite e onboarding de PDV.

**Critérios de aceite:**

- [ ] "Nova empresa financeira" cria a empresa com nome e CNPJ e já vincula a pessoa com papel `financeiro`.
- [ ] A empresa nasce com o plano de contas padrão e com fontes de receita sem `orders`.
- [ ] Nenhuma estação, mesa, categoria de cardápio ou `pdv_config` é criada.
- [ ] O papel `financeiro` aparece no seletor de papéis do Admin Master para vincular mais pessoas.

### US-05: Quem tem PDV não percebe nada

**Como** usuária da loja com PDV, **quero** que tudo continue como está, **para** não ter surpresa no meio
do expediente.

**Critérios de aceite:**

- [ ] `/modulos`, `/dashboard` e as 20 abas do Financeiro continuam iguais (antes/depois registrado).
- [ ] A DRE continua com receita por canal, cancelamentos, descontos e CMV teórico.
- [ ] Papéis existentes (`admin`, `gerente`, `caixa`, `garçom`, cozinha, entregas, tarefas) não mudam de alcance.

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

- Issue: N/A — entrada: `BRIEFING-MODULO-FINANCEIRO.md`
- Issue summary: `specs/2026-09-modulo-financeiro-sem-pdv/issue-summary.md`
- Anexos versionados: apenas `.md` (demais formatos apenas referenciados no `issue-summary.md`)
- Docs: ver mapa em `AGENTS.md`
