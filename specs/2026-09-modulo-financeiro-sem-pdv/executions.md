# Executions: Módulo Financeiro para empresa sem PDV (Fase 1)

> Spec: [spec.md](./spec.md) · Tasks: [tasks.md](./tasks.md)

**Branch:** `claude/modulo-financeiro-sem-pdv` · **Base:** `main` — conforme [sdd-branch.md](../templates/sdd-branch.md) e [AGENTS.md](../../AGENTS.md)

## Abertura (`/sdd-01-new`, 2026-09-20)

- Entrada: `BRIEFING-MODULO-FINANCEIRO.md` (escopo = §4 Fase 1; §5 fora). Fluxo SDD pedido explicitamente pelo dono.
- Decisões do dono: TDD só na lógica pura · sem feature flag (a marca `tenants.kind` é a chave) · branch `claude/modulo-financeiro-sem-pdv` a partir de `main` (criada em 2026-09-20).
- Decomposição: uma spec, em fases (ordem do briefing §9) — os 7 itens dependem da mesma marca no tenant.
- Template de MR/PR: `specs/templates/mr-template.md` (bundled do plugin; o repo não tem `.github/` nem `.gitlab/`).
- `specs/templates/` não existia: scaffold copiado do plugin sdd-workflow 1.2.0.

## Research (`/sdd-02-research`, 2026-09-20)

- 3 frentes paralelas (Sonnet, só leitura) + consulta direta ao banco pelo MCP Supabase (o servidor `supabase` caiu, mas há um segundo servidor MCP configurado que respondeu).
- Achados que mudam o briefing: mapa de papéis tem **5** cópias no front (não 4); `user_tenants.role` é **enum** `user_role`; `fn_setup_tenant_bypass` **e** `get_user_tenants` não são versionadas (corpos obtidos do banco); as Edges do Financeiro barram por **rank** (`isManagerRole`), não por lista — o papel novo seria barrado em toda escrita; não montar os contexts de PDV **quebraria** 5 consumidores fora do PDV; **não existe** plano de contas DRE padrão (só 3 das 10 empresas têm categorias); `ContasVencidasPanel` já tem guarda de divisão por zero (o problema é exibir "0,0%").

## Specify (`/sdd-03-specify`, 2026-09-20)

- **Decisão A1 (dono, no chat):** escrita do papel `financeiro` liberada por um `isFinanceiroRole` aplicado **só** nas 8 Edges do Financeiro; Edges de PDV seguem com `isManagerRole`. Alternativas recusadas: rank 2 (alcançaria o PDV) e só-leitura (módulo não se sustenta).
- **Decisão B1 (autônoma):** providers de PDV **montam sem buscar** em empresa `financeiro`, em vez de não montar — não montar quebraria `ComprasTab`, `ItensClassificacaoTab`, `DRETab`, `FolhaRelatorioPDF` e `/dashboard`.
- **Decisão C (autônoma):** `tenants.kind` é `text` + CHECK (não enum), transportado pela RPC `get_user_tenants`.
- **Decisão autônoma:** RPC nova `fn_admin_create_finance_tenant` na família `fn_admin_*`, em vez de estender `setup-tenant` (que é onboarding público sem JWT).
- **Decisão autônoma:** conteúdo do plano de contas padrão escrito em RF21 (não havia de onde copiar); é ponto de partida editável na tela.
- **Desvio declarado do "nada muda para o PDV":** RF17 troca "0,0%" por "sem receita no período" também na loja com PDV, quando o mês não tem receita. É texto, nenhum número muda; entra no antes/depois de CS3.

## Plan (`/sdd-04-plan`, 2026-09-20)

- Plano escrito pelo orquestrador (Opus): 13 tasks, 7 fases, `plan_depth: snippets` (override `contracts` em T03, T10, T12, T13). Fases 3 e 5 em paralelo.
- **Revisão de compliance (Sonnet, só leitura): REPROVADA na 1ª volta** — 1 P0 + 2 P1 + 1 P2. Todos corrigidos no `tasks.md` (ver nota em "Progresso do Plan"); ~90% das ancoragens do plano conferiam linha a linha.
- **P0 (o que teria quebrado calado):** T08 mandava buscar `kind` na RPC errada. O `user` do front vem de `get_user_profile_for_tenant`; `get_user_tenants` só alimenta a lista do seletor. `tenantKind` ficaria `undefined` para sempre e, como `empresaTemPdv(undefined) === true` por desenho, a empresa financeira se comportaria como loja com PDV — CS4, CS6 e CS7 falhariam sem erro visível.
- **Plano aprovado autonomamente em 2026-09-20** após as correções (contrato do orquestrador: aprovar sem achado grave em aberto). Sem nova volta de revisão porque as 4 correções são de texto do plano, com evidência conferida no código pelo orquestrador.

## Fase 1 — Banco (T01, T02, T03) — **done**, 2026-09-20

**Baseline antes de qualquer código:** `check.mjs --force` → tsc **287**/292 · vitest **485/485**.

| Task | Status | O que foi feito |
|---|---|---|
| T01 | done | `20260920100000_user_role_financeiro.sql` — `'financeiro'` no enum `user_role`, sozinha (R4) |
| T02 | done | `20260920100100_tenants_kind_e_funcoes.sql` — `tenants.kind` + CHECK; versionadas `get_user_tenants`, `get_user_profile_for_tenant` (ambas agora com `kind`) e `fn_setup_tenant_bypass` (literal); `fn_admin_set_user_tenant` aceita `financeiro` |
| T03 | done | `20260920100200_fn_admin_create_finance_tenant.sql` — RPC de nascimento (slug único, papel, fontes, plano de contas) |

**Aplicação:** pelo MCP do Supabase (o `db push` é bloqueado pelo guard). As 3 migrations são
**só acréscimo** (R7): nenhuma linha existente alterada ou apagada.

**Conferência dos corpos versionados (R5):** o orquestrador leu `get_user_tenants`,
`get_user_profile_for_tenant` e `fn_setup_tenant_bypass` direto do banco antes de aplicar; o texto das
migrations é idêntico ao corpo atual, mais o campo `kind` (nas duas primeiras) e mais `'financeiro'` na
lista de `fn_admin_set_user_tenant`. `fn_setup_tenant_bypass` ficou sem nenhuma mudança de comportamento.

**Correção do orquestrador durante a aplicação:** ao aplicar T03 eu troquei, por engano,
`on conflict do nothing` por `do update set role` no vínculo do usuário. Isso faria o **dono da plataforma
virar papel `financeiro`** (o trigger `fn_platform_owner_membership` já o insere como `admin` em toda
empresa nova) e o hard-lock de rota o prenderia fora do Admin Master. Revertido no banco e no arquivo, com
o porquê comentado no SQL.

**Verificação no banco (evidência de CS7):**

| Item | Resultado |
|---|---|
| `select kind, count(*) from tenants group by kind` | `loja = 10`, `financeiro = 2` — nenhuma loja existente tocada |
| enum `user_role` | termina em `financeiro` |
| Empresas de teste | `Empresa Teste Financeiro A` (`71b454b1-468c-4073-9282-41c956eb027e`) e `B` (`896be873-f876-4f4e-817f-6bc3298f1e96`) |
| Papéis em cada uma | `financeiro` (qa.caixa) + `admin` (dono, pelo trigger) |
| `fin_revenue_settings.sources` | `manual,pix` — sem `orders` |
| `fin_dre_categories` | 16 por empresa: 3 `revenue`, 1 `cost`, 1 `tax`, 11 `expense` |
| Objetos de PDV (estações, mesas, cardápio, formas de pagamento) | **0** em cada |
| `system_settings` | 1 por empresa (trigger `handle_new_tenant`, esperado) |

**Achado para o teste manual:** a RPC exige o e-mail do dono no token (`fn_assert_platform_admin`), então
não dá para chamá-la sem sessão; para criar as empresas de teste foi preciso simular o claim de e-mail numa
transação. O caminho real da tela é testado em T13. O usuário de papel `financeiro` nos testes é
**`qa.caixa`** (que é `cashier` na loja Testes PDV) — de quebra, isso exercita o edge case "mesma pessoa com
papéis diferentes em empresas diferentes".

**Gate iterativo:** `check.mjs --force` → tsc **287**/292 · vitest **485/485** (SQL não afeta o gate).

## Fases 2 e 3 (T04, T05, T06, T07) — **done**, 2026-09-20 (executadas em paralelo)

**Gate ao final das duas:** `check.mjs --force` → tsc **287**/292 · vitest **495/495** (485 + 10 novos).

### T04 — `isFinanceiroRole` (done)
`supabase/functions/_shared/tenant-auth.ts`: helper novo logo abaixo de `isManagerRole`.
`ROLE_RANK` e `isManagerRole` **intocados** — é o que mantém o PDV barrado ao papel novo.
Teste: `src/test/edge/financeiroRole.test.ts` (3 casos), incluindo o caso-chave
`isManagerRole('financeiro') === false`.

**Erro do orquestrador no plano, corrigido:** o snippet de teste usava `import` estático do arquivo da
Edge, o que arrasta código Deno para dentro do `tsc` e criou o erro novo `Cannot find name 'Deno'`
(o portão acusou, corretamente, mesmo com a contagem total abaixo do baseline). O repo já tinha o padrão
certo, com o porquê comentado em `src/test/edge/fiscalValores.test.ts:5-17`: caminho montado em tempo de
execução (`pathToFileURL` + `import(/* @vite-ignore */ …)`). Plano e teste corrigidos.

### T05 — as Edges do Financeiro (done, com correção de escopo)
Trocadas para `isFinanceiroRole`: `financial-write:51`, `purchase-write:535`, `inter-bank:992`,
`stone-conciliation:588`, `fiscal-inbound:879`, `ifood-financial:679`. Nas 4 últimas a troca é na
**definição** de `const isManager = internal || …`; os usos posteriores (stone `:628,:665`, fiscal
`:891,:946,:987,:1021`, ifood `:700,:742,:788`) herdam sem edição própria.

**`config-write` foi RETIRADA da lista pelo orquestrador (achado de segurança, 2026-09-20).** O plano a
incluía por engano. Ela é a configuração **geral**: expõe `create_table`, `create_kitchen_station`,
`create_payment_method`, `update_tenant` e — o pior — **`upsert_permissions`**. Liberar o papel ali daria
a ele o PDV e a chance de **gravar as próprias permissões** (escalação de privilégio), violando R3.
Nenhuma tela do Financeiro escreve por ela; a única ação que o caminho do Financeiro usa é
`get_permissions`, já liberada a qualquer membro por `CONFIG_READ_ACTIONS`. Revertida para
`isManagerRole`, com o porquê comentado no código para ninguém "corrigir" de volta. Spec (RF07) e plano
(T05) atualizados: são **6** Edges, não 7.

**Verificado:** nenhuma Edge de PDV tocada; `order-write`, `export-menu-template` e
`import-menu-template` seguem com `isManagerRole`.

### T06 — papel nas cópias do front (done)
14 pontos, não 13: o agente achou um **14º** que o compilador exigiu — `PermissoesTab.tsx:123`
(`newMatrix: Record<Papel, string[]>` dentro de `carregarPermissoes`). É a mesma exaustividade de
`Record<Papel, …>` que já tinha pego `PermissoesTab.tsx:55` e `invite/page.tsx` na revisão do plano.
`DEFAULT_PERMISSOES.financeiro = [...FIN_KEYS]` — só chaves `fin_*`.
Teste: `src/test/business/papeisMapa.test.ts` (3 casos).

### T07 — hard-lock de rota (done)
`src/lib/acessoRota.ts` novo (`PAPEIS_PRESOS` + `rotaForcada`), consumido por `RotaProtegida.tsx` no lugar
dos dois `if`. `PAPEIS_ADMIN`, permissões e `loading` intocados.
Teste: `src/test/lib/acessoRota.test.ts` (4 casos), cobrindo os dois papéis que já eram presos.

**Pendente desta fase:** deploy das 6 Edges (a sessão principal faz, atenta ao `verify_jwt` misto) e
revisão adversarial (em andamento).

## Revisão adversarial das Fases 1-3 — **REPROVADA na 1ª volta**, corrigida (2026-09-20)

Revisor (Sonnet, só leitura) sobre o diff das Fases 1-3. Um achado ALTA; o resto limpo.

**[ALTA] O papel `financeiro` gravava em `ingredients` (estoque) por dois caminhos:**
1. `financial-write` → `bulk_insert_ingredients` (`:1405-1434`) — cria insumo em massa. **Não vem de tela
   do Financeiro**: vem de `src/components/ImportExportTemplatesModal.tsx:137`, o modal de importar/exportar
   modelos. É ato de estoque. **Corrigido:** lista `ACOES_SO_GERENTE` no topo de `financial-write` exige
   `isManagerRole` nessa ação específica.
2. `purchase-write` → `create_purchase`/`confirm_delivery` (`:231, :313-338, :857-863`) — dão entrada no
   estoque via `fn_add_stock_movement`. **Mantido, por decisão do dono (2026-09-20):** lançar compra e dar
   entrada é a **mesma** operação, e é dela que o CMV vive; bloquear tiraria as abas Compras e Notas de
   entrada do papel. A restrição R3 da spec estava mal redigida (dizia "estoque" e se contradizia com a
   própria RF07) e foi **precisada**: permitido o estoque que é consequência de compra/nota; proibido mexer
   no estoque por fora (edição de insumo, inventário, perda, ficha técnica — Edges que seguem com
   `isManagerRole`).

**Itens verificados e limpos pelo revisor:** as outras 5 Edges (todo uso de `isManager` ali guarda só ação
financeira; `prepare_payment`/`execute_payment`/`cancel_payment`/`decode_boleto` seguem em
`PAY_INTERNAL_ONLY`, fora do alcance de qualquer papel); reversão de `config-write` completa (sem vestígio
de `isFinanceiroRole`); `ROLE_RANK`/`isManagerRole` inalterados; nenhuma Edge de PDV tocada; RLS não piora
com o papel novo (as policies `fin_*` abrem por vínculo com a loja, não por papel); hard-lock sem regressão
para `gestor_entregas`/`tarefas` e sem rota de fuga (`/financeiro` cai no ramo com `RotaProtegida`; o único
ramo sem ele é `/modulos`, onde o grid fica vazio para o papel); os 14 pontos de papéis batem e
`DEFAULT_PERMISSOES.financeiro` só tem chaves `fin_*`; as 3 migrations não alteram nem apagam dado, a
função de nascimento roda em transação única (sem empresa pela metade) e tem `fn_assert_platform_admin()`
+ `revoke`; nenhuma regressão para `admin`/`gerente`/`caixa`/`garçom`.

## Fase 4 — Tipo da empresa e porta de entrada (T08, T09) — **done**, 2026-09-20

**Gate:** `check.mjs --force` → tsc **287**/292 · vitest **498/498** (495 + 3 de `tipoEmpresa.test.ts`).
`npx vite build` limpo.

### T08 (done)
- `src/lib/tipoEmpresa.ts` novo: `TipoEmpresa`, `empresaTemPdv`, `fontesPadrao`. Padrão seguro: tudo que
  não for `'financeiro'` — inclusive `undefined` — conta como **tem PDV**, para que nenhuma loja perca
  tela por dado faltando (R1).
- `AuthContext.tsx`: os **5** pontos cobertos — os 2 retornos de `fetchProfileForTenant` (retry de JWT
  expirado e caminho normal) e os 3 mapeamentos de `TenantOption` (retry, normal, `switchTenant`). Era
  exatamente o ponto que a revisão do plano pegou como P0.
- `revenueSources.ts`: `fetchRevenueSettings`/`fetchRevenueSources`/`loadRevenueExtras` ganharam `kind?`
  **opcional** — sem o parâmetro, comportamento idêntico ao de hoje. Chamadas de `DRETab`,
  `DREComparativoTab`, `useFinanceiro` e `useReceitas` passaram a informar o tipo.

### T09 (done)
- Card "Financeiro" em `/modulos`, visível só para o papel `financeiro` **ou** empresa sem PDV.
- `AppModeContext.tsx`: `'financeiro'` no union `AppMode` (o `id` do card exigia).
- `financeiro/page.tsx`: o cheque de acesso aceita o papel novo.
- `selecionar-loja/page.tsx`: selo "sem PDV" por cartão; título/subtítulo só trocam para "empresa" quando
  **todas** as opções da lista são sem PDV — quem tem ao menos uma loja com PDV vê o texto de hoje.

**Pendente:** conferência visual (CS3/CS4) — o agente não tinha navegador; a sessão principal faz.

**Preparo do teste de ponta a ponta (conferido no banco):** `qa.caixa@erpos-teste.com` é `cashier` na loja
**Testes PDV** e `financeiro` nas duas empresas financeiras de teste — serve de uma vez para CS4, CS5 e para
o edge case "mesma pessoa, papéis diferentes em empresas diferentes". `qa.admin` segue `admin` em Testes
PDV, para o antes/depois de CS3.

## Deploy das Edges — `verify_jwt` levantado antes (pegadinha conhecida do projeto)

Um comando de deploy aplica a mesma flag a todas as funções; aqui elas **divergem**. Estado lido do
projeto em 2026-09-20, a ser preservado função a função:

| Função | `verify_jwt` |
|---|---|
| `financial-write` | **false** |
| `purchase-write` | **true** ← a exceção |
| `inter-bank` | false |
| `stone-conciliation` | false |
| `fiscal-inbound` | false |
| `ifood-financial` | false |
| `config-write` (só comentário, sem mudança de comportamento) | false |

**Deploy feito em 2026-09-20**, uma função por vez, pelo CLI (`npx supabase functions deploy <nome>
--project-ref mdghhjemzdmeuqpzuyzx`, com `--no-verify-jwt` só onde a flag era `false`). Docker não é
necessário (o CLI avisa e segue). Conferido depois pela listagem do projeto: `purchase-write` continuou
`verify_jwt: true` (v55) e as demais `false` — a pegadinha não pegou.

## Fases 5, 6 e 7 (T10..T13) — **done**, 2026-09-20

- **T10** — DRE e DRE Comparativo: cancelamentos, descontos e CMV teórico/cobertura condicionados a
  `temPdv`; `fetchCmvConsumo`/`fetchCmvConsumoComp` saem cedo (sem query em `order_items`). Receita por
  canal não foi tocada — ela já some sozinha por `applyRevenueSources`.
- **T11** — `src/lib/impactoMargem.ts` novo (RF17); Visão Geral sem ticket médio e sem Modo Sessão em
  empresa financeira (`isSessao` forçado a `false`, sem chamar `useSalesReportBySession`); `INCOME_SOURCES`
  preservada e filtrada no uso.
- **T12** — os 6 contexts de PDV saem cedo da carga e do Realtime, com `loading: false`.
  **Contradição do plano resolvida pelo executor, corretamente:** a tabela mandava guardar `loadInsumos`,
  mas o texto exigia `reloadInsumos()` funcionando sob demanda para a aba Compras. Guardou só o `useEffect`
  de mount — o Financeiro continua podendo pedir insumos quando o usuário age.
- **T13** — botão "Nova empresa financeira" + `NewFinanceTenantModal` no Admin Master, chamando a RPC e
  mostrando o erro do banco como veio.

## Verificação no navegador (evidência de CS3 e CS4) — 2026-09-20

Servidor local, usuários `qa.*`. **Nada escrito em loja real** (CS8): só leitura de tela.

### Loja com PDV — `Testes PDV`, `qa.admin` (CS3: tem de estar idêntica)

| Tela | Resultado |
|---|---|
| `/modulos` | **6 módulos**, os mesmos de antes; **nenhum card "Financeiro" a mais** |
| DRE | "Vendas balcão / hora" **presente**; "CMV teórico pela ficha técnica: R$ 6,70 · cobertura 17%" **presente** |
| Visão Geral | **TICKET MÉDIO R$ 36,60** e alternador **Calendário/Sessão** presentes |
| Contas Vencidas | "Impacto na Margem **180,3%**" — o percentual aparece normalmente quando há receita |
| As 20 abas | todas presentes |

### Empresa sem PDV — `Empresa Teste Financeiro A`, `qa.caixa` com papel `financeiro` (CS4)

| Tela | Resultado |
|---|---|
| Seletor | selo **"sem PDV"** nas duas empresas financeiras, ausente em Testes PDV; texto seguiu "Loja" porque a lista é **mista** (o previsto) |
| Entrada | caiu **direto em `/financeiro`** |
| `/modulos` | **1 módulo**: "Financeiro — Contas, bancos, conciliação, notas, folha e DRE". Nenhum card de PDV, KDS, gestor ou Gestão |
| Hard-lock | `/dashboard`, `/pdv/caixa` e `/estoque` → todos devolvem para `/financeiro` |
| DRE | **sem** receita por canal, **sem** CMV teórico/cobertura; mostra o **plano de contas que nasceu com a empresa** (Folha e Encargos, Pró-labore, Aluguel, Contabilidade, …) — evidência viva de CS7 |
| Visão Geral | **sem** ticket médio, **sem** Modo Sessão |

### Achado do orquestrador na verificação (corrigido)

A empresa financeira ainda disparava uma query em **`orders`**: a contagem do ticket médio em
`useFinanceiro.ts:725`. A T11 escondeu o número, mas a consulta continuava saindo — RF18/G8 pedem que a
empresa financeira **não carregue dado de PDV**. Corrigido no mesmo padrão que o repo já usa
(`useReceitas.ts:143`): a promise vira `{count: 0}` quando `!empresaTemPdv`. Conferido depois:
`orders: 0` na empresa financeira e **ticket médio ainda R$ 36,60** na loja com PDV.

### Resíduo conhecido, deixado de propósito

`rpc/fn_get_active_session` (sessão de caixa) continua sendo chamada em empresa financeira. Vem do
`SessaoContext`, que está em `SessionProviders` e **não** entre os 6 contexts de PDV do escopo de T12. É uma
RPC leve que volta vazia e não mostra nada errado na tela; guardá-la mexeria num context do qual todo o PDV
depende, sem revisão, no fim da entrega — risco maior que o ganho. Fica anotado para uma fase futura.

## Revisão adversarial das Fases 4-7 — APROVADA com 2 ressalvas, ambas tratadas (2026-09-20)

**[P2 — corrigido] Admin de empresa financeira via cards de PDV em `/modulos`.**
`modulos/page.tsx` tratava só o card `financeiro`; os demais passavam por `perfilOk`, que olha o **papel** e
não o **tipo da empresa**. Cenário real e provável: o trigger `fn_platform_owner_membership` dá `admin` ao
dono da plataforma em **toda** empresa nova — ao abrir uma empresa financeira ele veria PDV Caixa, KDS,
Gestor de Pedidos etc., e cada clique cairia em tela vazia, porque os contexts de PDV não carregam ali.
Corrigido: empresa sem PDV não mostra card `Terminal` nem `Cozinha`, para papel nenhum. O card **Gestão**
continua, de propósito — é por onde o admin chega às Configurações (edge case previsto na spec §2).
**Verificado no navegador** (dando `admin` ao `qa.admin` na Empresa Teste Financeiro A): antes 6 cards,
depois **2** (Financeiro e Gestão); e a loja **Testes PDV** seguiu com os mesmos **6**.

**[P3 — mantido, decisão registrada] Separador decimal do "Impacto na Margem".**
`rotuloImpactoMargem` formata `12,3%` onde antes saía `12.3%`, e isso alcança a loja com PDV mesmo havendo
receita — além do que RF17 declarava. **Mantido de propósito:** é pt-BR e é o que o resto da mesma tela já
faz (`R$ 330,00`, `R$ 150,00`); o ponto decimal ali era a inconsistência. Fica registrado como segunda
exceção consciente a R1, do mesmo tipo da primeira: só formato de texto, nenhum número muda.

**Itens verificados e limpos pelo revisor:** `empresaTemPdv(undefined)` devolve `true` (padrão seguro);
nenhum uso de `temPdv` está invertido — todas as guardas são aditivas e a loja com PDV mantém o
comportamento; `loading` vai a `false` em todos os caminhos dos 6 contexts (nenhuma tela girando);
`reloadInsumos` segue funcionando sob demanda; canais de Realtime só são criados quando a guarda passa e o
cleanup do `useEffect` desinscreve ao trocar de empresa (sem vazamento); `tenantKind` e `tenantId` são
trocados **no mesmo** `setUser` (não existe janela com empresa nova e tipo antigo — o vazamento entre lojas
que já aconteceu no projeto não se repete aqui); `kind` é opcional em todas as funções de
`revenueSources.ts` e nenhuma chamada passou argumento na posição errada; o modal do Admin Master valida
antes de chamar, desabilita o botão durante a chamada e não engole o erro do banco; nenhum `console.log`,
código morto ou `any` novo (os dois `console.log` existentes são pré-existentes, de 2026-06-14, conferidos
com `git blame`).

Legenda: `pending` · `in_progress` · `blocked` · `done` · `skipped`

## Resumo

| Task | Status | Início | Fim | Responsável |
|------|--------|--------|-----|-------------|
| T01 | pending | | | |

---

## Registro por task

### T01: {título}

- **Status:** pending
- **Plano de execução (passo 06):** [ ] Sim — aprovado em ___ | [ ] Dispensado
- **Branch / MR:**

#### O que foi feito

<!-- Lista objetiva de alterações -->

#### Desvios da spec

<!-- Se houve, exigir atualização de spec.md antes de merge -->

#### Gate de qualidade (iterativo — ver AGENTS.md)

| Comando | Resultado | Observação |
|---------|-----------|------------|
| gate iterativo (lint/compile) | | |
| gate iterativo (testes) | | |
| gate iterativo (build) | | |

#### Revisão de task (loop do `/sdd-06-execute`)

- **Modo:** subagentes | mesma sessão
- **Resultado:** Aprovada | Aprovada com ressalvas | Reprovada | Escalada ao dev
- **Data:**
- **Itens:** ...

#### Notas

---

## Validação final (gate completo — `/sdd-07-spec-review`)

| Comando | Resultado |
|---------|-----------|
| gate completo (ver AGENTS.md) | |

## Revisão da spec (`/sdd-07-spec-review`)

- **Resultado:** Aprovada | Reprovada
- **Data:**
- **Goals:** ...
- **Gaps:** ...

## Documentação (`/sdd-08-docs`)

- **Arquivos de documentação alterados:** ...
- **N/A:** [ ] Sim — justificativa: ...

## MR/PR (`/sdd-08-docs`)

- **`mr-template.md` preenchido:** [ ] Sim | [ ] N/A — justificativa: ...
- **Título MR/PR:** `{ISSUE-KEY}-{slug}`

## Fechamento na issue (opcional)

- **Perguntado ao dev se deseja comentário final na issue:** [ ] Sim
- **Decisão do dev:** [ ] Publicar | [ ] Não publicar
- **Execução via ferramenta do projeto:** [ ] Sim | [ ] N/A
- **Link/comentário:** ...

## ADR (opcional, quando aplicável)

- **Perguntado ao dev se deseja ADR:** [ ] Sim
- **Aplicável para esta spec:** [ ] Sim | [ ] Não
- **Decisão do dev:** [ ] Criar ADR | [ ] Não criar ADR
- **Arquivo ADR:** path em `AGENTS.md` | N/A

---

## Checklist final da feature

- [ ] Todas as tasks `done` com revisão do `/sdd-06-execute` aprovada (gate iterativo por task)
- [ ] Validação final: gate completo verde (`AGENTS.md`)
- [ ] `/sdd-07-spec-review` aprovado
- [ ] `/sdd-08-docs` concluído (documentação + `mr-template.md`)
- [ ] Fechamento na issue opcional registrado
- [ ] ADR opcional registrado (quando aplicável)
- [ ] Entrada em `specs/implementation-log.md`
- [ ] MR/PR: `{ISSUE-KEY}-{slug}`
