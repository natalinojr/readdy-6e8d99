# ERPOS V2 - mapa do sistema para agentes

Atualizado em: 2026-06-14.

Objetivo: reduzir tempo de busca quando o usuario pedir alteracoes. Antes de mexer em qualquer area, use este arquivo como indice, depois confirme no codigo atual.

## Visao geral

- Frontend: React 19 + Vite + TypeScript.
- Roteamento: React Router em `src/router/config.tsx`.
- UI: Tailwind CSS, lucide-react e alguns icones `ri-*`.
- Backend: Supabase Auth, Postgres, Storage e Edge Functions.
- Deploy/build: `npm run build` gera `out/`; `vercel.json` aponta `outputDirectory` para `out` e reescreve rotas SPA para `index.html`.
- Supabase principal: projeto `ERP OS`, ref `mdghhjemzdmeuqpzuyzx`.

## Comandos uteis

- Dev local: `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`
- Type-check: `npm run type-check`
- Lint: `npm run lint`
- Testes: `npx vitest`

Deploy/Vercel (confirmado em 2026-06-14): Vercel CLI instalado e logado como `natalinojr`. Projeto Vercel = `erpos` (https://erpos.vercel.app). O GitHub `main` esta conectado ao Vercel, que builda e publica automaticamente a cada push. Variaveis `VITE_PUBLIC_SUPABASE_URL`, `VITE_PUBLIC_SUPABASE_ANON_KEY` e `VITE_APP_URL` ja estao configuradas (Production+Development; Preview pendente). Ao usar a CLI, definir `VERCEL_TELEMETRY_DISABLED=1`. Lembrete: por ser Vite, variaveis `VITE_*` sao embutidas no build e precisam existir no Vercel no momento do build.

## Arquivos que todo agente deve abrir primeiro

- `src/router/config.tsx`: mapa oficial de rotas/telas.
- `src/providers/AppProviders.tsx`: ordem dos contexts globais.
- `src/lib/supabase.ts`: cliente Supabase, refresh de sessao, `invokeWithAuth`, upload de imagens.
- `src/contexts/AuthContext.tsx`: login, tenant atual, perfil e troca de loja.
- `src/components/feature/AppLayout`: layout autenticado, menu e estrutura principal.
- `package.json`: scripts e dependencias.
- `vercel.json` e `vite.config.ts`: build, base path, aliases e saida.

## Fluxo de aplicacao

`src/main.tsx` carrega i18n, CSS, Supabase e renderiza `App`.

`src/App.tsx` monta:
- ErrorBoundary global.
- `AppProviders`.
- `BrowserRouter` com `basename={__BASE_PATH__}`.
- `AppRoutes`.
- `ToastContainer`.

`src/providers/AppProviders.tsx` monta providers nesta ordem:
- Core: `ToastProvider`, `AppModeProvider`, `KioskAuthProvider`, `AuthProvider`, `SystemSettingsProvider`.
- Sessao: `SessaoProvider`, `NotificacoesProvider`, `AuditoriaProvider`.
- Dados: `EstoqueProvider`, `ProducaoProvider`, `CardapioProvider`, `ImpressorasProvider`, `KDSProvider`, `MesasProvider`.
- Features: `ModoTreinoProvider`, `MesaEdicaoProvider`, `AprovacoesProvider`, `ModoFaturamentoProvider`, `PermissoesProvider`, `OfflineProvider`.
- UI global: `VirtualKeyboardProvider` e `VirtualKeyboardOverlay`.

## Rotas principais

Rotas publicas ou fora do layout:
- `/login`: `src/pages/login/page.tsx`
- `/mesa/:mesaId`: `src/pages/mesa/page.tsx`
- `/mesa-qr/:qr_token` e variantes `/pedido/...`: `src/pages/mesa-qr/page.tsx`
- `/delivery` e `/:storeSlug-delivery`: `src/pages/delivery/page.tsx`
- `/autoatendimento`: `src/pages/autoatendimento/page.tsx`
- `/totem/:token`: `src/pages/totem/page.tsx`
- `/selecionar-loja`: `src/pages/selecionar-loja/page.tsx`
- `/supabase-debug`: `src/pages/supabase-debug/page.tsx`

Rotas dentro do layout autenticado:
- `/modulos`: `src/pages/modulos/page.tsx`
- `/dashboard`: `src/pages/dashboard/page.tsx`
- `/cardapio`: `src/pages/cardapio/page.tsx`
- `/pdv/caixa`: `src/pages/pdv/caixa/page.tsx`
- `/pdv/garcom`: `src/pages/pdv/garcom/page.tsx`
- `/pdv/delivery`: `src/pages/pdv/delivery/page.tsx`
- `/kds`: `src/pages/kds/page.tsx`
- `/gestor-pedidos`: `src/pages/gestor-pedidos/page.tsx`
- `/mesas`: `src/pages/mesas/page.tsx`
- `/relatorios`: `src/pages/relatorios/page.tsx`
- `/pedidos`: `src/pages/pedidos/page.tsx`
- `/estoque`: `src/pages/estoque/page.tsx`
- `/financeiro`: `src/pages/financeiro/page.tsx`
- `/configuracoes`: `src/pages/configuracoes/page.tsx`
- `/config-delivery`: `src/pages/config-delivery/page.tsx`
- `/usuarios`: `src/pages/usuarios/page.tsx`
- `/clientes`: `src/pages/clientes/page.tsx`
- `/auditoria`: `src/pages/auditoria/page.tsx`
- `/promocoes`: `src/pages/promocoes/page.tsx`
- `/vouchers`: `src/pages/vouchers/page.tsx`
- `/diagnostico`: `src/pages/diagnostico/page.tsx`
- `/diagnostico/simulacao`: `src/pages/diagnostico/SimulacaoPedidos.tsx`
- `/diagnostico/qa`: `src/pages/diagnostico/QADashboard.tsx`
- `/diagnostico/checklist`: `src/pages/diagnostico/ChecklistTeste.tsx`
- `/imprimir-qrcodes`: `src/pages/imprimir-qrcodes/page.tsx`
- `/admin-master`: `src/pages/admin-master/page.tsx`

## Mapa por dominio

Autenticacao, lojas e permissoes:
- Telas: `src/pages/login`, `src/pages/selecionar-loja`, `src/pages/admin-master`, `src/pages/usuarios`.
- Contexts/hooks: `AuthContext`, `PermissoesContext`, `useUsuarios`, `useValidarPIN`, `useKioskTokens`.
- Supabase RPCs: `get_user_profile_for_tenant`, `get_user_tenants`, `fn_get_users_list`, `fn_update_user`, `fn_toggle_user_active`, `fn_admin_list_users_v3`.
- Edge Functions: `login-pin`, `kiosk-auth`, `user-write`, `admin-create-user`, `admin-manage-user`, `setup-tenant`, `bootstrap-admin`.

Cardapio e produtos:
- Tela: `src/pages/cardapio`.
- Componentes: categorias, itens, combos, delivery, destaques, ficha tecnica, observacoes globais.
- Context/hook: `CardapioContext`, `useOptionGroupTemplates`, `useObsParaItem`, `useObsPorItemId`.
- RPCs/tabelas: `fn_get_full_menu`, `fn_get_item_ingredients`, `menu_categories`, `menu_items`, `combos`, `option_groups`, `options`, `item_ingredients`, `menu_highlights`, `item_promotions`.
- Edge Functions: `menu-write`, `export-menu-template`, `import-menu-template`.

PDV, pedidos e pagamentos:
- Telas: `src/pages/pdv/caixa`, `src/pages/pdv/garcom`, `src/pages/pdv/delivery`, `src/pages/pedidos`, `src/pages/gestor-pedidos`.
- Contexts/hooks: `PDVContext`, `SessaoContext`, `KDSContext`, `useOrderSubmit`, `useOrdersHistory`, `usePedidosAgrupados`, `usePaymentMethods`.
- RPCs/tabelas: `orders`, `order_items`, `order_item_options`, `order_item_observations`, `payments`, `order_discounts`, `cash_registers`, `cash_movements`, `fn_next_senha`, `fn_peek_senha`, `fn_update_paid_by_pdv`, `fn_cancel_order_item`, `fn_cancel_and_refund_order`, `fn_get_payment_methods`.
- Edge Functions: `order-write`, `order-edit-lock`, `session-payments`, `voucher-write`, `pix-payment`.

Mesas, QR e atendimento no salao:
- Telas: `src/pages/mesas`, `src/pages/mesa`, `src/pages/mesa-qr`, `src/pages/pdv/garcom`.
- Contexts/hooks: `MesasContext`, `MesaEdicaoContext`, `useMesaQRData`, `useMesaKDSNotificacoes`, `useTablesConfig`.
- Tabelas: `tables`, `table_sessions`, `table_session_participants`, `table_reservations`, `waiter_calls`.
- Edge Functions: `table-write`, `mesa-write`, `reservation-write`, `verify-manager-credentials`.

KDS, producao e impressao:
- Telas: `src/pages/kds`, `src/pages/gestor-pedidos`, `src/pages/imprimir-qrcodes`.
- Contexts/hooks: `KDSContext`, `ProducaoContext`, `ImpressorasContext`, `useKDSTick`, `useKDSSound`, `usePrintQueue`.
- Libs: `src/lib/printQueue.ts`, `src/lib/printOrderQueue.ts`, `src/lib/printUtils.ts`, `src/pages/kds/lib/autoPrint.ts`.
- Tabelas: `kitchen_stations`, `station_operators`, `print_queue`, `production_recipes`, `production_batches`, `production_batch_items`.
- Edge Functions: `production-write`, `print-queue-write`, `print-queue-agent`, `printer-ping`, `printer-raw`.

Estoque, compras e CMV:
- Tela: `src/pages/estoque`.
- Componentes: insumos, inventario, movimentacoes, validade, producao, CMV, fornecedores.
- Contexts/hooks: `EstoqueContext`, `ProducaoContext`, `useCmvReport`, `useCmvRelatorio`, `useItensSemEstoque`, `useStockCriticalAlerts`, `useIngredientCategories`, `useIngredientPriceHistory`, `useSuppliers`.
- Tabelas: `ingredients`, `ingredient_categories`, `ingredient_batches`, `stock_movements`, `inventory_sessions`, `fin_suppliers`, `fin_purchases`, `fin_purchase_items`.
- RPCs: `fn_get_ingredients`, `fn_get_stock_movements`, `fn_get_items_sem_estoque`, `fn_get_stock_critical_alerts`, `fn_get_cmv_report`.
- Edge Functions: `stock-write`, `purchase-write`, `purchase-confirm-delivery`.

Financeiro, RH e conciliacao:
- Tela: `src/pages/financeiro`.
- Componentes: fluxo de caixa, contas a pagar/receber, DRE, compras, RH, bancos, conciliacao, orcamentos, implantacao.
- Hooks: `useFinanceiro`, `useDespesas`, `useReceitas`, `useConciliacao`, `useRH`, `usePayrollCustomFields`, `useImplantacao`, `useFinanceiroAlertas`.
- Tabelas: `fin_cash_flow`, `fin_accounts_payable`, `fin_receivable_installments`, `fin_bank_accounts`, `fin_bank_transactions`, `fin_bank_statements`, `fin_reconciliation_rules`, `fin_cost_centers`, `fin_dre_categories`, `hr_employees`, `hr_payroll`, `hr_payroll_custom_fields`.
- Edge Functions: `financial-write`, `purchase-write`, `purchase-confirm-delivery`, `stone-conciliation`, `implementation-write`.

Delivery externo e autoatendimento:
- Telas: `src/pages/delivery`, `src/pages/autoatendimento`, `src/pages/totem`, `src/pages/config-delivery`.
- Hooks/data: `src/pages/delivery/useDeliveryData.ts`, `KioskAuthContext`.
- Tabelas: `delivery_customers`, `delivery_customer_addresses`, `delivery_neighborhoods`, `kiosk_tokens`.
- Edge Functions: `delivery-write`, `kiosk-auth`, `login-pin`, `pix-payment`.

Relatorios, dashboard e auditoria:
- Telas: `src/pages/dashboard`, `src/pages/relatorios`, `src/pages/auditoria`, `src/pages/diagnostico`.
- Hooks: `useDashboardMetrics`, `useSalesReport`, `useCaixaReport`, `useDeliveryReport`, `useCancelamentosReport`, `useClientesReport`, `useOrigemReport`, `useSLAHistorico`, `useConsumo*`.
- Context: `AuditoriaContext`.
- RPCs: `fn_get_dashboard_metrics`, `fn_get_sales_report`, `fn_get_cash_sessions_v2`, `fn_get_cancelamentos_report`, `fn_get_clientes_report`, `fn_get_audit_log_v3`.
- Edge Functions: `audit-write`, `qa-full-simulation`, `simulate-orders`, `simulate-pdv-orders`, `weekly-divergence-alert`.

Clientes, promocoes e vouchers:
- Telas: `src/pages/clientes`, `src/pages/promocoes`, `src/pages/vouchers`.
- Hooks: `useClientes`, `useClientesReport`, `useClientesRetencao`.
- Tabelas: `customers`, `loyalty_transactions`, `promotion_rules`, `vouchers`, `voucher_transactions`.
- Edge Functions: `voucher-write`, `menu-write`.

## Padroes de acesso ao backend

- Leituras geralmente usam `supabase.rpc(...)` ou `supabase.from(...)` em contexts/hooks.
- Escritas sensiveis geralmente usam `invokeWithAuth(functionName, { body })` em `src/lib/supabase.ts`.
- Algumas telas ainda usam `fetch(`${SUPABASE_URL}/functions/v1/...`)` direto; procurar por `functions/v1`.
- Edge Functions ficam em `supabase/functions/<slug>/index.ts`.
- Migracoes ficam em `supabase/migrations`.

Ao alterar regra de negocio:
1. Comece na tela/componente do dominio.
2. Siga para o hook/context usado.
3. Confira chamadas RPC/Edge Function.
4. Se mudar banco, procurar migracao existente ou criar nova migracao.
5. Rodar `npm run type-check` e, se possivel, `npm run build`. ATENCAO: o type-check ja esta vermelho com ~350 erros pre-existentes (ver "Alertas e cuidado"). Nao tente zera-los; apenas garanta que sua mudanca nao AUMENTOU a contagem.

## Supabase - tabelas principais por grupo

Base/multi-tenant:
- `tenants`, `users`, `user_tenants`, `permissions`, `system_settings`, `user_preferences`, `store_invites`.

Operacao:
- `sessions`, `cash_registers`, `cash_movements`, `orders`, `order_items`, `order_item_options`, `order_item_observations`, `order_item_units`, `payments`, `order_discounts`, `refunds`.

Salo/mesa:
- `tables`, `table_sessions`, `table_session_customers`, `table_session_participants`, `order_item_assignments`, `table_reservations`, `waiter_calls`.

Cardapio:
- `menu_categories`, `menu_items`, `combos`, `combo_items`, `option_groups`, `options`, `item_preset_observations`, `global_observations`, `item_promotions`, `menu_highlights`.

Estoque/producao:
- `ingredients`, `ingredient_categories`, `ingredient_batches`, `stock_movements`, `inventory_sessions`, `production_recipes`, `production_recipe_items`, `production_recipe_steps`, `production_batches`, `production_batch_items`, `item_ingredients`, `item_production_parts`, `combo_ingredients`.

Financeiro/RH:
- `fin_cash_flow`, `fin_accounts_payable`, `fin_receivable_installments`, `fin_purchases`, `fin_purchase_items`, `fin_suppliers`, `fin_cost_centers`, `fin_dre_categories`, `fin_bank_accounts`, `fin_bank_transactions`, `fin_bank_statement_imports`, `fin_reconciliation_rules`, `fin_purchase_catalog`, `fin_stone_config`, `fin_stone_imports`, `fin_pix_payments`, `hr_employees`, `hr_payroll`, `hr_payroll_custom_fields`.

Delivery/kiosk:
- `delivery_neighborhoods`, `delivery_customers`, `delivery_customer_addresses`, `kiosk_tokens`.

Auditoria/impressao/outros:
- `audit_log`, `print_queue`, `vouchers`, `voucher_transactions`, `loyalty_transactions`, `senha_counter`, `tenant_day_order_seq`.

## Edge Functions locais

Diretorio: `supabase/functions`.

Slugs importantes:
- Admin/auth: `bootstrap-admin`, `login-pin`, `setup-tenant`, `kiosk-auth`, `admin-create-user`, `admin-manage-user`, `user-write`.
- Cardapio: `menu-write`, `export-menu-template`, `import-menu-template`.
- Pedidos: `order-write`, `order-edit-lock`, `check-session-pending`, `session-payments`.
- Mesa/delivery: `table-write`, `mesa-write`, `delivery-write`, `reservation-write`.
- Financeiro: `financial-write`, `purchase-write`, `purchase-confirm-delivery`, `stone-conciliation`, `pix-payment`, `implementation-write`.
- Estoque/producao: `stock-write`, `production-write`.
- Impressao: `printer-ping`, `printer-raw`, `print-queue-write`, `print-queue-agent`.
- QA/diagnostico: `simulate-orders`, `simulate-pdv-orders`, `qa-full-simulation`.
- Auditoria/notificacoes: `audit-write`, `weekly-divergence-alert`.

## Alertas e cuidado

- TYPE-CHECK/LINT JA ESTAO VERMELHOS: `npm run type-check` retorna ~350 erros de TypeScript pre-existentes (herdados do codigo gerado pelo Readdy). O `npm run build` (Vite/esbuild) NAO faz checagem de tipos, por isso o deploy funciona apesar disso. NAO tente consertar os 350 erros — nao e o pedido. Ao mexer no codigo, so confira que sua mudanca nao aumentou a contagem: `npx tsc --noEmit --project tsconfig.app.json 2>&1 | grep -c "error TS"`.
- Supabase Advisor informou que `public.tenant_day_order_seq` esta com RLS desabilitado. Nao corrigir automaticamente sem decisao do usuario, porque habilitar RLS sem policy pode quebrar acesso. SQL sugerido pelo advisor: `ALTER TABLE public.tenant_day_order_seq ENABLE ROW LEVEL SECURITY;`
- Muitas Edge Functions no projeto remoto estao com `verify_jwt: false`; antes de mudar seguranca, conferir se a funcao implementa autenticacao propria.
- Arquivos existentes tem alguns comentarios/textos com encoding quebrado. Evite mexer nisso em alteracoes nao relacionadas.
- O app depende bastante de tenant atual (`user.tenantId`). Sempre conferir filtros `tenant_id` em leituras/escritas.
- Para novas telas, adicionar rota em `src/router/config.tsx` e conferir menu/layout em `src/components/feature/AppLayout`.

## Como responder pedidos futuros rapido

Quando o usuario pedir "muda X":
- Identifique o dominio pelo mapa acima.
- Abra a rota/tela correspondente em `src/pages/.../page.tsx`.
- Abra componentes citados pelo nome visivel da UI.
- Procure chamadas `use...`, `invokeWithAuth`, `supabase.rpc`, `supabase.from`.
- Se envolver banco, consulte `supabase/migrations` e as tabelas do grupo.
- Se envolver deploy/build, use `npm run build` e confirme saida em `out/`.

## Historico de solucoes e criterios

Secao viva: registrar aqui padroes, decisoes e pegadinhas reutilizaveis conforme o sistema evolui. Cada entrada com data, contexto e onde foi aplicado.

### 2026-06-17 — Abrir/fechar delivery (botao no PDV + agendamento) acoplado a sessao

Feature: controlar a abertura do delivery. **Fonte da verdade da abertura = backend** (`delivery-write`), funcao `computeDeliveryOpen(dc, hasSession, now)`:
  `aberto = sessao_aberta E nao_pausado E (dentro_do_horario OU override_manual)`. Sem sessao -> SEMPRE fechado.
- **Estado mora em `system_settings.delivery_config` (JSON)**, 3 chaves novas: `delivery_manual_open` (bool, abrir fora do horario), `delivery_paused_until` (ISO, pausa temporaria), `delivery_schedule` `{ enabled, days: {"0".."6": {enabled, open:"HH:MM", close:"HH:MM"}} }` (0=Dom, fuso America/Sao_Paulo; suporta janela que cruza a meia-noite). Helpers no edge: `spNowParts` (Intl tz), `isWithinSchedule`, `minutesUntilWindowClose`.
- **Acoes novas no `delivery-write`** (auth = QUALQUER membro da loja, nao precisa admin): `get_delivery_state` e `set_delivery_state` (op: open|close|pause|resume|force_off). `close` DENTRO do horario = pausa ate o fim da janela de hoje (decisao do usuario: horario manda, botao/pausa sao overrides temporarios). `pause` recebe `minutes`. `force_off` zera os overrides (chamado ao fechar a sessao).
- **Gates**: `create_delivery_order` agora usa `computeDeliveryOpen` (antes so checava sessao); `get_delivery_config` devolve `delivery_open_now` + `delivery_closed_reason` pro cliente. **`save_delivery_settings` virou MERGE** (le-mescla-grava) pra nao apagar as chaves de runtime que a tela de config nao conhece. **Deploy: delivery-write byte-exato via `npx supabase functions deploy --use-api` (sintaxe validada pelo bundler).**
- **Frontend (precisa push)**: hook `src/hooks/useDeliveryState.ts`; botao+modal `src/pages/pdv/caixa/components/DeliveryControle.tsx` (status na barra do caixa aberto, desktop + mobile, com pausas rapidas 30min/1h/2h/4h/resto-do-dia + horas custom); secao "Horario de funcionamento do delivery" em `config-delivery/page.tsx`; `SessaoContext.fecharSessao` chama `set_delivery_state op=force_off` (regra: fechar sessao desliga delivery); banner "loja fechada" em `delivery/page.tsx` + flags expostas via `useDeliveryData` (espelhando `retiradaAtivo`). tsc 348 (nao aumentou).
- Pegadinha: renderizo `<DeliveryControle/>` 2x (desktop+mobile), cada um com seu poll de 60s — duplicacao aceitavel (so 1 visivel). Se incomodar, subir o estado pra um context.

### 2026-06-17 — Fechamento de caixa: valor esperado inflado por pagamentos agrupados (LIVE)

Bug: caixas com pagamentos AGRUPADOS (mesmo `payment_group_id`, pedidos pagos juntos) fechavam com `closing_value_expected` inflado -> "Diferenca de Caixa" fantasma. Causa raiz: a MESMA duplicacao ja corrigida no relatorio (ver 2026-06-15) ainda existia no FECHAMENTO. `order-write` action `close_cash_register` calculava `cashTotal = SUM(p.amount em dinheiro)` cru; como o pagamento PRINCIPAL grava `amount` = total do GRUPO e os vinculados gravam o deles, somar duplica. Caso real (caixa S120626002): esperado gravado 332,28 vs correto 236,29 = +95,99 fantasma (alem do operador ter declarado 0,00 contado). Fix (`order-write/index.ts` ~L654): agrupa os pagamentos cash por `COALESCE(payment_group_id, id)`; grupo (>1) usa `SUM(o.total_amount)` (venda real), avulso usa `p.amount` (preserva parciais); ignora pedidos `cancelled`/`draft` (igual o relatorio). **Deploy: order-write v126 ACTIVE (byte-exato via `npx supabase functions deploy --use-api`).** Corrige caixas NOVOS; caixas ja fechados mantem o valor antigo gravado. Convencao confirmada de novo: `payments.amount` = venda (fica na gaveta); `change_amount` = troco; recebido = amount+troco.

### 2026-06-17 — Edicao de insumo (preco unitario) quebrada: fn_upsert_ingredient sem p_price_source (LIVE)

Bug: salvar insumo no Estoque dava 500 com "Could not find the function public.fn_upsert_ingredient(...) in the schema cache" -> preco unitario (e qualquer edicao) nao salvava. Causa raiz: `stock-write` action `upsert_ingredient` passou a enviar 15 params nomeados (inclui `p_price_source`, o seletor Manual/Automatico), mas NENHUMA overload de `fn_upsert_ingredient` aceitava `p_price_source` (a maior tinha 14) -> PostgREST nao resolve a chamada por nome de argumento. A coluna `ingredients.price_source` (text, default 'manual') ja existia. Fix: migration `fn_upsert_ingredient_add_price_source.sql` cria a overload de 15 params com `p_price_source text DEFAULT 'manual'`, gravando a coluna no UPDATE e no INSERT; aplicada em prod + `NOTIFY pgrst,'reload schema'`. Pegadinha geral: ao adicionar param novo a uma RPC chamada via PostgREST, a FUNCAO no banco precisa de uma assinatura que contenha exatamente o conjunto de nomes enviados (a migration da funcao costuma viver so no banco — verificar `pg_get_functiondef` antes). Obs.: ha 4+ "Carne moida hamburguer" duplicados no cadastro (preco 0) — nao limpado.

### 2026-06-17 — Permissoes por papel (aba Configuracoes): role EN/PT quebrado + toggles "mortos"

Contexto: auditoria da aba Configuracoes > Permissoes (`PermissoesTab.tsx`) e do enforcement real. Modelo: 23 chaves em `hooks/usePermissoes.ts`; admin sempre `true`; nao-admin carrega da tabela `permissions` via `config-write` (`get_permissions`/`upsert_permissions`).

**BUG CRITICO (corrigido no frontend, precisa push):** a coluna `permissions.role` e enum `user_role` em INGLES (admin/manager/cashier/waiter/kitchen). A aba salva em ingles (`papeisToDbRole`) e `config-write` grava/le sem traduzir. Mas `usePermissoes` filtrava `r.role === papel` com papel em PORTUGUES (gerente/caixa/garcom/cozinha) -> nunca casava. Efeito: assim que um admin SALVA a matriz, todo nao-admin cai em `setPermissoes([])` = SEM nenhuma permissao (rotas bloqueadas, menu some). Antes de usar a aba funciona pelos defaults (`DEFAULT_PERMISSOES`). Fix: `usePermissoes` agora traduz papel->role-EN (`PAPEL_TO_DB_ROLE`) e aceita ambos; se houver linhas no banco mas nenhuma do papel, cai em default (evita lockout por matriz parcial). Provado por SQL: filtro antigo=vazio p/ todos; novo=correto por papel. (`user-write` ja mapeava PT->EN certo na criacao de usuario; `AuthContext.DB_TO_FRONTEND_ROLE` faz EN->PT na leitura — so o filtro de permissao estava errado.)

**Toggles que NAO sao aplicados (enforcement inexistente)** — so existe checagem de ROTA (`RotaProtegida` `ROUTE_PERMISSIONS` + `Sidebar` `item.permissao`) e nas paginas KDS/Gestor (`modulos`). Aplicadas de verdade: `cardapio_editar`(/cardapio,/promocoes), `estoque_movimentar`(/estoque), `relatorio_financeiro`(/relatorios,/financeiro), `usuarios_gerenciar`(/usuarios,/aprovacoes), `configuracoes_editar`(/configuracoes,/config-delivery), `auditoria_ver`(/auditoria,/diagnostico), `clientes_ver`(/clientes), `kds_acessar`, `gestor_pedidos_acessar`. **Toggles "mortos" (nenhum `hasPermissao` os le):** `pdv_abrir_caixa`, `pdv_fechar_caixa`, `pdv_sangria`, `pdv_cancelar_pedido`, `pdv_cancelar_item`, `pdv_editar_item_pos_kds`, `pdv_estornar_pagamento`, `garcom_fechar_mesa`, `garcom_transferir_mesa`, `cardapio_alterar_preco`, `estoque_inventario`, `gestor_pedidos_entregar`, `relatorio_estoque`. Obs.: cancelar/desconto tambem tem o mecanismo de senha de gerente (`cancel_mode`/`discount_profile` na aba Operacao + `AutorizacaoGerenteModal`/`verify-manager-credentials`); os dois coexistem (a permissao decide se o botao APARECE pro papel; a senha de gerente continua valendo por cima).

**Enforcement dos 13 toggles LIGADO (2026-06-17, decisao do usuario "ligar todos" — frontend, precisa push):** cada acao agora checa `hasPermissao` e esconde/bloqueia o gatilho pra quem nao tem (admin sempre passa). Onde foi aplicado: `pdv_abrir_caixa`/`pdv_fechar_caixa`/`pdv_sangria` em `pdv/caixa/page.tsx` (CaixaFechadoView + header desktop/mobile); `pdv_desconto` em `caixa/components/CarrinhoPanel.tsx` (esconde a entrada de desconto, mantem exibicao de desconto ja aplicado); `pdv_cancelar_item`/`pdv_editar_item_pos_kds` em `caixa/components/PedidosRecentesPanel.tsx` (`ItemDetalheRow` flags `podeCancelarItem`/`podeEditar`); `pdv_cancelar_pedido`/`pdv_estornar_pagamento` nos dois cards (`PedidoCardAgrupado` e `PedidoCard`) do mesmo arquivo; `garcom_transferir_mesa` em `garcom/components/IdentificacaoMesaModal.tsx`; `garcom_fechar_mesa` em `garcom/components/PedidoView.tsx` (2 botoes) e `ContaMesaView.tsx`; `cardapio_alterar_preco` em `cardapio/components/ItemModal.tsx` (desabilita o input de preco); `estoque_inventario` em `estoque/components/InventarioTab.tsx` (esconde "Nova Contagem" + guarda nos handlers); `gestor_pedidos_entregar` em `gestor-pedidos/page.tsx` (guarda nos handlers `handleEntregar`/`handleEntregarItem` + inline `onEntregarUnidade`, incluido nos deps dos useCallback p/ evitar closure velho). Padrao: gate no GATILHO (esconde botao) e, onde o botao e complexo/multiplo, guarda tambem no handler. tsc 348 (sem aumento).

### 2026-06-17 — Criacao de loja (onboarding): multi-loja, estacoes duplicadas e perda de itens

Contexto: jornada "criar usuario -> convite -> aceitar -> criar loja -> entrar" testada end-to-end contra o Supabase ao vivo (signup real + chamadas diretas a `setup-tenant`). O fluxo de PRIMEIRA loja de um usuario novo ja funcionava (mInimo e completo). Tres problemas corrigidos:

1. **Multi-loja bloqueado (causa do "sempre da erro" pro dono):** os botoes "Criar nova loja" ([TopBar.tsx], [perfil/page.tsx]) levam um usuario JA logado ao `/onboarding?invite=`, mas `setup-tenant` `checkExistingTenant` bloqueava QUALQUER usuario com loja (409 `already_exists`), ignorando o convite -> o onboarding so jogava de volta pro /modulos sem criar nada. Decisao do usuario (2026-06-17): **liberar multi-loja com convite valido**. Fix (edge `setup-tenant` v24): o bloqueio so roda quando NAO ha convite valido e nao-usado (`!(inviteId && inviteValid)`); com convite valido, usuario existente cria loja adicional normalmente. Sem convite, mantem o anti-abuso de 1 loja. Verificado: 1a loja OK, 2a com novo convite OK (user_tenants=2), 3a sem convite bloqueada.
2. **Estacoes duplicadas:** `fn_setup_tenant_bypass` criava SEMPRE "Cozinha"+"Bar" E a edge function inseria as estacoes do onboarding -> resultado "Cozinha, Cozinha, Bar, Bar". Fix: migration `fn_setup_tenant_bypass_sem_estacoes_default` (RPC nao cria mais estacoes); a edge function virou dona unica das estacoes — usa as escolhidas no onboarding, ou um par padrao (Cozinha+Bar) se `estacoes` vier vazio.
3. **Perda silenciosa de itens:** `menu_items.category_id` e NOT NULL; um item com `categoriaId` nao mapeado virava `null` e, como o insert e um LOTE unico (`return=minimal`), o erro derrubava TODOS os itens silenciosamente. Fix: a edge function filtra itens sem categoria mapeada antes de inserir (loga quantos descartou), preservando os validos.

Pegadinhas confirmadas: (a) `users.email` tem UNIQUE (`uq_users_email`), mas `fn_setup_tenant_bypass` so faz `ON CONFLICT (id)` — ok na pratica porque o trigger `handle_new_auth_user` ja cria `public.users` com o mesmo id no signup. (b) `setup-tenant` ignora a identidade do JWT (usa service_role pra tudo; `verify_jwt:false`) — da pra testar via curl com a anon key e qualquer `existingUserId` que exista em `auth.users`. (c) signup do GoTrue rejeita dominios "invalidos" (ex. exemplo-teste.com) e tem rate-limit de email; pra testes em lote, criar usuarios direto em `auth.users` via SQL (com `crypt()`+`gen_salt('bf')`) dispara o trigger e cria `public.users`. Funcao `fn_setup_tenant_bypass` so e chamada pelo `setup-tenant`. As correcoes sao 100% backend (migration + edge function ja LIVE) — nao precisa push de frontend.

### 2026-06-14 — Pedidos de QR code universal ("Mesa 0")

Contexto: o QR code universal (nao amarrado a uma mesa fisica) gera pedidos com `destino = 'mesa'` e `mesaNumero = 0`. A identidade real do cliente fica na SENHA do participante, guardada em `participantToken` (no KDS) — NAO em `p.senha`. O `nomeCliente` desses pedidos costuma vir poluido como `"Mesa 0 - Nome"`.

Criterios definidos:
- Detectar QR universal por: tem `participantToken` E `mesaNumero` ausente/0 (`!!token && !mesaNumero`).
- Nesses casos, exibir a SENHA (`Senha {token}`) no lugar de "Mesa 0", e o nome do cliente em UM lugar so.
- Para limpar o nome, remover o prefixo: `nome.replace(/^Mesa\s*\d*\s*[-–.·]?\s*/i, '').trim()`.
- `PedidoAgrupado` (em `src/hooks/usePedidosAgrupados.ts`) agora carrega `participantToken` (antes se perdia no mapeamento KDS→Agrupado).

Onde ja foi aplicado:
- `src/pages/pdv/caixa/components/PedidosRecentesPanel.tsx` (`destinoLabel`): cabecalho e pedido principal do modal de pagamento.
- `src/components/feature/PagamentoRapidoModal.tsx` (`formatarDestino` + filtro de busca `filtrarPorBusca`): janela "Vincular Pedidos", pedidos vinculados, e busca por senha (agora inclui `participantToken`).
- `src/pages/gestor-pedidos/components/GestorKanbanView.tsx`: cards do Gestor de Pedidos — esconde a linha de destino duplicada em QR universal, remove o badge "Mesa 0" (so mostra mesa real > 0), nome do cliente fica ao lado do badge da senha.

Pegadinha relacionada (UI): nos cards do Gestor, nomes de item usavam `truncate` e cortavam em telas estreitas. Criterio: preferir `break-words` para o nome do item sempre aparecer inteiro (quebra de linha) em vez de cortar.

### 2026-06-15 — Relatorio de Caixa: agrupar pagamentos conjuntos + canal QR

Bug: pedidos pagos JUNTOS (mesmo `payment_group_id`) apareciam separados e com "Pago"/recebido duplicado. Causa raiz: o pedido PRINCIPAL grava `payments.amount` = total do GRUPO e os vinculados gravam o deles → somar duplica. Solucao (definitiva, na RPC, ja LIVE no banco):
- `fn_get_cash_sessions_v2` (migration `fn_get_cash_sessions_v2_agrupar_pagamentos.sql`): `cash_transactions` agora AGRUPA por `payment_group_id` no SQL e usa `o.total_amount` (venda real) em vez de `p.amount`. `valor_pago` do grupo = soma(total_amount)+soma(troco). `por_forma_pagamento` usa `CASE WHEN payment_group_id IS NOT NULL THEN o.total_amount ELSE p.amount`. `por_origem` separa canal `qr_universal` (origin_type 'table' + table_number 0/null) de `table` (mesa real).
- `fn_get_sales_report` (2 overloads, migration `fn_get_sales_report_qr_universal_canal.sql`): `by_destination` faz o mesmo split `qr_universal`.
- Convencao confirmada: `payments.amount` = valor COBRADO (venda); troco em `change_amount`; valor entregue = amount + troco. O modal `PedidoDetalheModal` (`consolidatePayments`) foi corrigido pra essa convencao (nao subtrair troco; nao escalar troco).
- Frontend rotula `qr_universal` -> "QR CODE" em: `CaixaTab`, `OrigemTab`, `useOrigemReport`, `VisaoGeralTab`.
- Deteccao de QR universal foi relaxada para `origem === 'mesa' && !mesaNumero` (funciona em historico sem token). Token (senha) propagado via `fn_get_kds_orders` -> `useOrdersHistory` (DBOrder.participant_token/name) -> `dbParaRecente`.

Pegadinha: a aba Pedidos faz polling? NAO mais — virou realtime puro (Supabase `postgres_changes` em orders/payments, debounce 800ms, sem fallback). RPCs (fn_get_kds_orders) ja retornam `payment_group_id` na versao de 2 args.

### 2026-06-15 — EM ANDAMENTO: Delivery por DISTANCIA (Pin + OpenRouteService)

Objetivo: substituir taxa por BAIRRO (burlavel) por taxa por DISTANCIA REAL de rota. Decisoes do usuario: (a) SUBSTITUIR bairro por distancia (remover bairro do fluxo do cliente); (b) pedido BLOQUEADO se alem da ultima faixa; (c) cidade pequena, CEP unico — entao o cliente marca a casa num PIN no mapa (nao geocodificar texto, que falha em cidade pequena); (d) pedir tambem o endereco em texto pro motoboy; (e) gerar link do Google Maps pro motoboy.

Stack: Leaflet/OSM (pin) + OpenRouteService (rota grátis, ~2k/dia). Componente reutilizavel `src/components/feature/MapaPin.tsx` (ja criado).

Modelo de dados: tudo em `system_settings.delivery_config` (JSON): `store_location {lat,lng}` + `delivery_fee_tiers: [{ate_km, taxa, tempo_max_min}]` (alem de pedido_minimo_*, retirada_ativo, formas_pagamento). Salvar via supabase direto (RLS: policy `public` exige `tenant_id=auth_tenant_id() AND auth_role()='admin'`). ATENCAO: a acao `save_delivery_settings` da Edge Function `delivery-write` (v52) e um STUB (nao salva) — por isso o save da config foi feito direto via supabase.

FASES:
- [x] Fase 1 (FEITA): Config em `config-delivery/page.tsx` — pin da loja (MapaPin) + editor de faixas + save direto via supabase. Build OK.
- [x] Fase 2 (FEITA 2026-06-15): Tela do cliente. Arquivos: `useDeliveryData.ts` (le `store_location`+`delivery_fee_tiers` do `delivery_config`; estado do pin `addressLat/Lng` + `setAddressPin` persistido em `localStorage` chave `delivery_pin`; helpers `haversineKm`/`quoteFromTiers`; `ROAD_FACTOR=1.3`; derivados `distanceMode`/`deliveryQuote`/`foraDeArea`/`effectiveDeliveryFee` — `deliveryFee` retornado JA e o efetivo; envia `address_lat/lng`+`distance_km` no payload de `create_delivery_order`); novo `components/EnderecoPinDelivery.tsx` (MapaPin + "usar minha localizacao" via geolocation + endereco texto p/ motoboy + estimativa taxa/tempo ao vivo / aviso fora de area); `page.tsx` (step `endereco` usa EnderecoPinDelivery quando `distanceMode`, senao o EnderecoDelivery de bairro; chip do header e resumo do carrinho mostram km/tempo; botao Confirmar bloqueado se `foraDeArea`). `distanceMode` so liga se a loja configurou `store_location`+`tiers` (senao cai no fluxo de bairro legado — degradacao segura). Build OK, tsc 350 (sem aumento).
  - Frontend NAO commitado/deployado ainda (usuario faz push GitHub->Vercel). O backend (Fase 3) JA esta no ar e e retrocompativel, entao a ordem de deploy e segura (backend primeiro, frontend depois).
  - Geocodificacao reversa (2026-06-15): ao soltar o pino, `EnderecoPinDelivery` chama Nominatim/OSM (`nominatim.openstreetmap.org/reverse`, gratis, sem chave, CORS ok) e preenche rua/numero/bairro pro cliente so confirmar. `geoReqRef` evita race entre pinos. Numero raramente vem do OSM em cidade pequena — cliente completa. So frontend (precisa push).
- [x] Fase 3 (FEITA + DEPLOYADA 2026-06-15, delivery-write **v54**): `create_delivery_order` agora calcula a taxa por DISTANCIA quando ha `store_location`+`tiers` na config E o pedido traz pin (`address_lat/lng`): rota real loja->pin via OpenRouteService (`ORS_API_KEY` secret, endpoint `directions/driving-car`, ordem [lng,lat], timeout 6s), **fallback haversine×1.3** se ORS falhar/sem chave; mapeia km->faixa (`quoteFromTiers`), BLOQUEIA com `{error:"fora_area"}` se alem da ultima faixa; grava `delivery_lat/lng/distance_km` no pedido (UPDATE pos-insert, pois `fn_create_order_bypass` tem lista fixa de colunas) e imprime a distancia no comprovante. **Retrocompativel:** sem pin (frontend de bairro antigo) cai no ramo legado por `neighborhood_id`. Migration `add_delivery_pin_columns_to_orders` aplicada (colunas nullable em `orders`). Deploy incluiu tambem a notificacao WhatsApp que ja estava no arquivo local (inerte sem o secret `WHATSAPP_INTERNAL_TOKEN`). Pegadinha: o `get_edge_function` por MCP retornava v52 (sem o WhatsApp), mas o arquivo local `supabase/functions/delivery-write/index.ts` estava a frente — sempre conferir drift local vs deploy. ORS ainda nao verificado com pedido real (fallback garante que nada quebra); conferir `orders.delivery_distance_km` no primeiro pedido real para confirmar que a rota ORS esta ativa.
- [x] Fase 4 (FEITA 2026-06-15, precisa push frontend): botao "Rota no Google Maps" no `gestor-pedidos/components/PedidoDetailModal.tsx`. Busca `delivery_lat/lng/address/distance_km` do pedido sob demanda via supabase (RLS `orders_select_by_user_tenant` = `tenant_id IN (user_tenants...)`, cobre multi-loja). Com pin → `maps/dir/?api=1&destination=lat,lng`; sem pin → fallback `maps/search/?api=1&query=<endereco>`. Bloco mostra endereco + distancia + botao rota + WhatsApp do cliente. (NAO mexi na RPC `fn_get_kds_orders` — 8KB, risco; por isso o fetch sob demanda no modal.)

### 2026-06-16 — Delivery por distancia: SLA por horario no Gestor + limpeza dos cards

Pedido do usuario (cards de delivery do LINK no Gestor de Pedidos):
1. Nao concatenar o endereco no nome do cliente (o endereco ja tem bloco proprio no card).
2. Remover o botao "Rota" (rota e do motoboy, que nao acessa o Gestor; o link da rota ja vai pro motoboy pelo botao WhatsApp Motoboy).
3/4. SLA por DISTANCIA com dois horarios-limite por card: **Preparo ate HH:MM** e **Entrega ate HH:MM**.
   - `tempo total` = `tier.tempo_max_min` da faixa de distancia do pedido (ja existia na config).
   - `tempo de rota` (moto) = duracao da rota da API ORS (antes so a distancia era usada).
   - `deslocamento da entrega` = rota + 5 min; `preparo` = total - deslocamento.
   - Ex.: rota 8 min -> entrega 13 min; total 40 -> preparo 27. Pedido as 20:00 -> Preparo 20:27 / Entrega 20:40.

Implementacao:
- **Migration `add_delivery_sla_columns_to_orders`** (aplicada): colunas `orders.delivery_route_min` (duracao da rota ORS, min) e `orders.delivery_sla_min` (tempo total da faixa, min). Nullable, retrocompativel.
- **delivery-write v58** (deployada): `orsRoute()` (antes `orsRouteKm`) agora retorna `{km, durationMin}` lendo `summary.duration` do ORS; fallback de tempo = `km / 25 km/h` (const `MOTO_KMH`). No `create_delivery_order`, grava `delivery_route_min` e `delivery_sla_min` no UPDATE pos-insert (junto de lat/lng/distance_km) e devolve `route_min`/`sla_min` na resposta. **Reconciliacao de drift:** o deploy v57 usava separador ASCII `" - "` no `destination_name`/tickets enquanto o arquivo local usava em-dash `" — "`; alinhei o arquivo local para `" - "` antes do deploy. (Deploy v58 foi a versao minificada — o arquivo local pretty e funcionalmente identico.)
- **Frontend (precisa push):**
  - `gestor-pedidos/components/GestorKanbanView.tsx`: helper `nomeClienteDelivery()` remove o sufixo de endereco do `destination_name` ("Nome - Endereco"); item 1. Botao "Rota" e funcao `abrirRotaMaps` removidos; item 2 (mantido `resolverMapsUrl`, usado pelo WhatsApp Motoboy). Badges de SLA: busca em LOTE (uma query, `.in('id', ...)`) os campos `delivery_route_min`/`delivery_sla_min` dos deliveries do link (sem mexer na RPC `fn_get_kds_orders`), guarda em `slaMap` e passa `slaInfo` pro card; so para `deliveryPlatform === 'propria'`. Badge vermelho quando passou do horario.
  - `gestor-pedidos/components/PedidoDetailModal.tsx`: botao "Rota no Google Maps" removido (mesma logica do item 2); mantem endereco, distancia e WhatsApp do cliente. `mapsUrl` removido.

Pegadinha/decisao: NAO toquei na RPC `fn_get_kds_orders` (8KB, risco). Os tempos chegam ao card por um fetch em lote direto em `orders` (RLS `orders_select_by_user_tenant` cobre multi-loja), no padrao que ja existia no card (resolverMapsUrl). Pedidos antigos (sem as colunas novas) simplesmente nao mostram os badges. tsc 348 (sem aumento), build OK.

### 2026-06-16 — Delivery (cliente): previsão de entrega + WhatsApp da loja

Pedido do usuario (tela do cliente, app de delivery do link):
1. Em "Acompanhar pedido", mostrar a **hora prevista máxima de entrega**.
2. Botao "Falar com a loja" via WhatsApp; numero configurado em config-delivery.

Implementacao:
- **delivery-write v59** (deployada): acao `get_order_status` agora seleciona/retorna `delivery_sla_min`. (O numero do WhatsApp ja vem no `delivery_config` via `get_delivery_config`.)
- **config-delivery/page.tsx** (precisa push): novo campo "WhatsApp da loja" -> salva `delivery_config.whatsapp_loja` (so digitos). Bloco novo na UI.
- **delivery/useDeliveryData.ts** (precisa push): le `dc.whatsapp_loja` -> estado `storeWhatsapp`, exposto no retorno do hook (plumbing: interface dos setters, loadConfig, useState, reset, objeto de setters, return).
- **delivery/page.tsx** (precisa push): botao "Falar com a loja" no header do cardapio (gradiente laranja), link `wa.me/55<digits>` (prefixa 55 se faltar). So aparece se houver numero valido (>=10 digitos).
- **delivery/components/AcompanharPedido.tsx** (precisa push): tipo `OrderStatusData` + `delivery_sla_min`; card "Previsao de entrega ate HH:MM" = `created_at + delivery_sla_min min` (so quando ha SLA e nao entregue/cancelado).

Convencao do WhatsApp: numero guardado em digitos (sem 55), igual ao `handleWhatsAppCliente` do gestor; link usa `wa.me/55<digits>` (helper prefixa 55 se nao vier com codigo). tsc 348 (sem aumento), build OK.

### 2026-06-16 — Varredura da aba Relatórios (auditoria)

Fontes de dados por aba: Visão Geral/Produtos/Origem → RPC `fn_get_sales_report`; Calendário → `fn_get_sales_report` (modal `DiaDetalheModal`); Caixa → RPC `fn_get_cash_sessions_v2` (+ fallback direto); Cancelamentos → `fn_get_cancelamentos_report`; Clientes → `fn_get_clientes_report`/`fn_get_customers_list`; CMV → `fn_get_cmv_report`; **SLA da Cozinha → lê `order_items`/`users` DIRETO** (sem RPC); **Delivery → lê `orders` direto**; Clientes/Retenção → `orders` direto.

**BUG corrigido (multi-loja, DB imediato — sem push):** `order_items` e `payments` só tinham SELECT por `auth_tenant_id()`/`get_user_tenant_id()` (= última membership), ao contrário de `orders` (que tem `orders_select_by_user_tenant` por `user_tenants`). Logo, para admin de várias lojas na loja NÃO-última, a aba **SLA da Cozinha** (lê order_items direto) e o **fallback do Caixa** (lê payments) vinham VAZIOS. Fix: migration `rls_user_tenants_select_order_items_payments` adicionou policies `*_select_by_user_tenant` (tenant_id IN user_tenants do auth.uid()) iguais à de orders. (Delivery e Clientes/Retenção leem `orders`, que já tinha a policy → OK.)

**Verificado OK:** `fn_get_cash_sessions_v2.por_forma_pagamento` usa `CASE WHEN payment_group_id IS NOT NULL THEN o.total_amount ELSE p.amount` e BATE com a receita da sessão (testado: sessão 40 pedidos, receita 1485 = por_forma 1485). by_destination/top_items usam `o.total_amount`/`item_price*qty` (corretos). RPCs de Cancelamentos/Clientes/CMV são SECURITY DEFINER com `p_tenant_id` (sem o problema multi-loja).

**Follow-ups FEITOS (2026-06-16, DB imediato):** (a) `users` ganhou policy `users_select_by_user_tenant` (id IN usuários que compartilham loja comigo via user_tenants) — corrige nomes de operador no SLA p/ admin multi-loja (migration `rls_user_tenants_select_users`). (b) `fn_get_cash_sessions_v2.por_forma_pagamento` migrado p/ atribuição PROPORCIONAL (`o.total_amount * p.amount / SUM(p.amount do pedido)`, JOIN ops) igual ao Calendário — robusto contra split+grupo (migration `fn_get_cash_sessions_v2_por_forma_proporcional`); verificado: 3 sessões com faturamento = soma das formas (1317/810/143). **Resta menor:** fallback do Caixa lê `order_discounts`/`cash_movements` direto (multi-loja pode ficar incompleto SÓ se a RPC principal falhar — raro; não alterado).

### 2026-06-16 — BUG: "permission denied for table menu_highlights" (Destaques do cardápio)

Sintoma: na aba Cardápio → Destaques, load e adição falhavam; console: `[Cardapio] Destaques load failed: permission denied for table menu_highlights` (401/403). Causa: a tabela `menu_highlights` tinha GRANT só p/ `postgres` — faltava `authenticated` (load direto via `supabase.from('menu_highlights')` no `CardapioContext`) e `service_role` (Edge Functions menu-write `upsert_highlight` e delivery-write/mesa-write que leem highlights). RLS já existia e é correta (`tenant_id IN (user_tenants do auth.uid())`, cobre multi-loja). Fix: migration `grant_menu_highlights_roles` (`GRANT SELECT,INSERT,UPDATE,DELETE TO authenticated, service_role`). **DB grant — efeito imediato, sem deploy/push.** Bônus: como o service_role também estava sem grant, os Destaques do cardápio do cliente (Parte 1 acima) também voltariam vazios via `get_delivery_config`/`get_cardapio` — corrigido junto. **Regra reforçada:** tabela nova precisa de GRANT p/ `authenticated` (se o frontend lê/escreve direto) E `service_role` (se Edge Function acessa) — não só service_role (ver pegadinha 2026-06-15).

### 2026-06-16 — BUG: formas de pagamento do Calendário (modal do dia) não batiam com o faturamento

Sintoma: no Relatórios → Calendário, ao clicar num dia, a soma das "Formas de Pagamento" (ex.: R$ 2.005,02) era MUITO maior que o faturamento do dia (R$ 1.317,00). Fonte: `DiaDetalheModal` → RPC `fn_get_sales_report` campo `by_payment`.

Causa raiz (dupla): o `by_payment` (a) somava `p.amount` por linha de pagamento SEM agrupar `payment_group_id` (pagamento conjunto: pedido principal grava o total do GRUPO em `p.amount` e os vinculados também gravam → duplica) e ainda contava o total do grupo no principal; e (b) filtrava por `p.created_at`, conjunto diferente do faturamento (que usa `o.created_at`). Pegadinha extra: nesses dados há pagamento conjunto cruzando vários pedidos E split (vários métodos no mesmo pedido), então nem `p.amount` puro nem `o.total_amount` puro fecham — o `CASE WHEN payment_group_id IS NOT NULL THEN o.total_amount` (usado no relatório de Caixa `fn_get_cash_sessions_v2`) também SUPERCONTA quando o pedido tem split (conta `o.total_amount` 1x por linha).

Correção (migration `fn_get_sales_report_by_payment_proporcional`, ambos os overloads — LIVE, não precisa push): `by_payment` agora ATRIBUI o `o.total_amount` de cada pedido às suas formas PROPORCIONALMENTE ao `p.amount` de cada pagamento (`o.total_amount * p.amount / SUM(p.amount do pedido)`), sobre o MESMO conjunto de pedidos do faturamento (filtro por `o.created_at`/sessão). Garante que a soma das formas SEMPRE = receita do período. Verificado: 13/06 → receita 1317,00 e soma das formas 1317,00 (Crédito 629 / Débito 374 / Dinheiro 284 / PIX 30). Troco fica naturalmente fora (usa a venda, não o valor recebido em dinheiro). **Pendência:** o relatório de Caixa (`fn_get_cash_sessions_v2.por_forma_pagamento`) ainda usa o `CASE WHEN payment_group_id` e pode superestimar em cenários de split+grupo — não alterado (fora do escopo pedido); avaliar aplicar a mesma atribuição proporcional se o usuário relatar divergência lá.

### 2026-06-16 — Cardápio do cliente (destaques/promoção/busca), nascimento/gênero, vouchers no delivery

Escopo confirmado: itens 1-2 só nas TELAS DO CLIENTE (delivery, mesa-qr/QR, autoatendimento/totem) — NÃO no caixa/garçom.

**Três fontes de dados de cardápio distintas** (importante): `CardapioContext` (totem/kiosk via `itensPublicos`; e caixa/garçom via `itens`), `useMesaQRData` (mesa-qr) e `useDeliveryData` (link /delivery). O link /delivery REUSA o componente `CardapioMesaQR` para renderizar o cardápio.

1. **Promoção válida HOJE (bug corrigido):** os cardápios marcavam promo só por `is_active`, ignorando dia/data. Novo `src/lib/promoUtils.ts`: `promoAtivaHoje(PromocaoItem[])` (formato admin, usado em `CardapioContext.itensPublicos`) e `rawPromoAtivaHoje(RawPromotion[])` (formato cru `is_active`+`days_of_week`+`is_recurring`+`specific_date`, usado em mesa-qr/delivery). Regras: pontual(`specific_date` & !recurring)=só na data; senão semanal por `days_of_week` (vazio=todo dia); escolhe a de menor preço.
2. **Categorias virtuais Destaques + Promoção (1º lugar):**
   - kiosk (`CardapioKiosk.tsx`): `itensPublicos` agora expõe `destaque`/`destaqueOrdem` (de `menu_highlights` ativos) e `temPromocao` (promo hoje). Categorias `⭐ Destaques` e `🔥 Promoção` injetadas no início da sidebar; filtro por flag.
   - mesa-qr e /delivery: `useMesaQRData`/`useDeliveryData` já criavam `__destaques__`; agora também criam `__promocao__` (order_index -0.5, depois de destaques -1) com itens-clone que carregam `promotions`. `CardapioMesaQR` usa `rawPromoAtivaHoje` no preço (corrige bug do dia).
3. **Busca no cardápio (cliente):** `CardapioMesaQR` (cobre mesa-qr + /delivery) e `CardapioKiosk` ganharam campo de busca; resultado é lista plana por nome/descrição, ignorando categorias virtuais (`id` começa com `__`) p/ não duplicar.
4. **Nascimento + gênero no cadastro do cliente (delivery):** migration `add_birthdate_gender_to_customers` (`customers.birth_date date`, `customers.gender text` com CHECK masculino|feminino|outro). `fn_get_customers_list` retorna `dataNascimento`/`genero`. delivery-write: `save_customer` e `create_delivery_order` gravam em `customers`; `lookup_customer` retorna os campos p/ pré-preencher. Frontend: `EnderecoPinDelivery` + `EnderecoDelivery` (campos), `useDeliveryData` (estado/plumbing/prefill), `useClientes`+`ClientePerfil` (exibe na aba Clientes).
5. **Vouchers no delivery + revisão (light):** delivery-write ganhou `validate_voucher` (público, service role, por tenant_id+code; espelha voucher-write: expiry/status/applicable; bloqueia free_item) e, no `create_delivery_order`, aceita `voucher_code`, calcula desconto sobre o subtotal server-side, ajusta total + `discount_amount`, e faz o RESGATE (baixa saldo + `voucher_transactions`) só após criar o pedido (`processed_by: null`). Frontend: input de cupom no rodapé do carrinho (`delivery/page.tsx`) + estado/handlers em `useDeliveryData` (`handleAplicarVoucher`/`handleRemoverVoucher`). **Bug corrigido na aba Vouchers:** `vouchers/page.tsx` lia `vouchers` direto via supabase (RLS `auth_tenant_id()` = última membership → admin multi-loja via lista errada) → agora usa `voucher-write` `list_vouchers` com `active_tenant_id` (mesmo padrão do config-delivery). Emitir/cancelar já passavam `active_tenant_id`.

**delivery-write v60** deployada (inclui Fases 5/6 anteriores + tudo acima); validate_voucher smoke-test OK. tsc 348 (sem aumento), build OK. **TODO o frontend precisa push** (GitHub→Vercel). Migrations + RPC + Edge já no ar.

### 2026-06-15 — PEGADINHA: tabela nova sem GRANT pro service_role (Edge Function da 42501/500)

`delivery_customer_addresses`, `delivery_customers` e `delivery_neighborhoods` NAO tinham GRANT pro papel `service_role` (so as tabelas "antigas" tinham, via default privileges). A Edge Function `delivery-write` usa service_role e escreve/le DIRETO nessas tabelas (acoes de endereco que implementei na v56, e `create_delivery_order` que faz `select` em `delivery_neighborhoods`) → `ERROR 42501: permission denied for table ...` → resposta 500 (que aparecia como `[object Object]` no front porque o erro do PostgREST nao e `Error` e o catch fazia `String(err)`). **O bypass de RLS do service_role NAO substitui o GRANT de tabela.** Fix: `GRANT SELECT, INSERT, UPDATE, DELETE ON <tabela> TO service_role` (migrations `grant_service_role_delivery_*`). **Regra:** ao criar tabela nova que uma Edge Function (service_role) vai escrever DIRETO (sem passar por RPC SECURITY DEFINER), conferir/conceder os grants pro service_role. Catch da `delivery-write` melhorado p/ expor a msg real do Postgres (local, entra no proximo deploy).

### 2026-06-15 — BUG RLS multi-loja: auth_tenant_id() = ultima membership (config-delivery nao salvava)

Sintoma: na loja **EP PAR MALL** o pin/config do delivery nao salvava (mostrava "sucesso" falso); na **VILA LESTE** salvava. Causa raiz: `config-delivery/page.tsx` salvava com `supabase.from('system_settings').update(...).eq('tenant_id', tenantId)` DIRETO, sujeito a RLS. As funcoes `auth_tenant_id()`/`auth_role()`/`get_user_tenant_id()` fazem `SELECT ... FROM user_tenants WHERE user_id=auth.uid() ORDER BY created_at DESC LIMIT 1` — ou seja, para dono de **varias lojas** retornam a membership **criada por ultimo**, IGNORANDO a loja ativa no app (que e so client-side: `localStorage 'erpos_selected_tenant_id'`, sem claim no JWT). O admin da EP PAR MALL (`ecefdcca…`) tem membership mais recente em "Testes PDV", entao `auth_tenant_id()` != EP PAR MALL → UPDATE casa 0 linhas (RLS), sem erro. Vila Leste salvava pq o admin dela so tem 1 loja. (A cidade da EP PAR MALL ficou salva de quando a membership dela ainda era a mais recente.)

**Implicacao geral:** QUALQUER escrita direta via supabase-js para tabela com RLS por `auth_tenant_id()` e nao-confiavel para admins multi-loja. Por isso o resto do app passa por Edge Functions (service role) / RPCs com `p_tenant_id` explicito. Ao criar telas novas que gravam dados de tenant, NAO usar `.update().eq('tenant_id', ...)` direto — rotear por Edge Function que valida o usuario.

**Correcao (FEITA, delivery-write v55):** acao `save_delivery_settings` deixou de ser stub: le o JWT do header Authorization, `admin.auth.getUser(token)`, confere em `user_tenants` que o usuario e `admin` DAQUELE `tenant_id`, e salva `system_settings` com service role. `config-delivery/page.tsx` agora chama essa acao (com `Bearer <access_token>`) em vez do write direto. **Pendente:** push do frontend (config-delivery) pro Vercel — so depois disso o save da config volta a funcionar pela UI nas lojas multi-tenant.

