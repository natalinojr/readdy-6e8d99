# Módulo Financeiro — Mapa de Referência (ERPOS V2)

> Documento vivo. É a fonte única para entender a aba **Financeiro**: telas, dados, fluxos, conexões com Estoque/Faturamento, a DRE e os problemas conhecidos.
> **Sempre confirme no código atual antes de afirmar** — atualize este arquivo quando algo mudar.
> Última revisão: **2026-07-03** (auditoria + fixes P1/P2/P3/P6 aplicados — ver §7).

Arquivos-base: `src/pages/financeiro/`, `src/hooks/useFinanceiro.ts`, `useDespesas.ts`, `useReceitas.ts`, `useFinanceiroAlertas.ts`, `src/types/financeiro.ts`, Edge Functions `financial-write`, `purchase-write`, `purchase-confirm-delivery`, `order-write` (integração de venda), RPC `fn_get_cmv_report`.

---

## 1. Visão geral

- **Acesso:** só `admin` e `gerente` (`page.tsx:58-70`). Outros perfis veem "Acesso Restrito".
- **Livro-razão central:** a tabela **`fin_cash_flow`** é a fonte de verdade do caixa **realizado** (entradas/saídas). Quase tudo que é "receita/despesa realizada" deveria passar por ela via `origin`.
- **Padrão de escrita:** o front chama a Edge Function **`financial-write`** através de `invokeFinancial(action, tenantId, payload)` (`useFinanceiro.ts:184-204`). Compras usam **`purchase-write`** (separada). Toda query filtra `tenant_id`.

### `fin_cash_flow.origin` — vocabulário
| origin | tipo | quem gera | significado |
|---|---|---|---|
| `auto_sale` | income | `order-write` (record_payment, à vista) e liquidação de recebível | venda reconhecida no caixa |
| `auto_card_fee` | expense | `order-write` (record_payment, à vista com taxa) | taxa de maquininha da venda à vista |
| `auto_purchase` | expense | `purchase-write` (quando compra já sai paga) | compra paga à vista |
| `auto_payroll` | expense | `financial-write` (pay_payroll) | folha paga |
| `auto_sangria` / `auto_suprimento` | expense / income | `order-write` (cash_movements) | sangria / suprimento de caixa |
| `manual` | income/expense | usuário (Receitas/Despesas/Fluxo) | lançamento manual |

> ⚠️ **Não existe `auto_bill_payment`.** Pagar uma conta a pagar (`pay_bill`) debita o banco (`fn_bank_debit`) mas **NÃO** insere em `fin_cash_flow` (ver Problema P3). Também não há `auto_anticipation` em uso.

---

## 2. As 17 abas (`page.tsx:22-40`)

| # | id | Label | Componente | Fonte principal |
|---|---|---|---|---|
| 1 | `visao` | Visão Geral | `VisaoGeralFinTab` | `fin_cash_flow` + dashboard hook |
| 2 | `receitas` | Receitas | `ReceitasTab` | `orders` (delivered) + `fin_cash_flow` manual |
| 3 | `despesas` | Despesas | `DespesasTab` | 5 fontes (ver §5) |
| 4 | `fluxo` | Fluxo de Caixa (realizado) | `FluxoCaixaTab` | `fin_cash_flow` |
| 5 | `previsao` | Previsão (projetado) | `PrevisaoCaixaTab` | AP + recebíveis + folha + manual |
| 6 | `pagar` | Contas a Pagar | `ContasPagarTab` | `fin_accounts_payable` |
| 7 | `receber` | Contas a Receber | `ContasReceberTab` | `fin_receivable_installments` |
| 8 | `orcamentos` | Orçamentos | `OrcamentosTab` | `fin_budgets` / `fin_budget_items` |
| 9 | `compras` | Compras | `ComprasTab` | `fin_purchases` / `fin_purchase_items` |
| 10 | `rh` | RH / Folha | `RHTab` | `hr_employees` / `hr_payroll` |
| 11 | `rh-relatorio` | Relatório RH | `RHRelatorioTab` | `hr_payroll` |
| 12 | `centros` | Centro de Custos | `CentroCustosTab` | `fin_cost_centers` |
| 13 | `dre` | DRE | `DREContainer`→`DRETab`/`DREComparativoTab` | ver §6 |
| 14 | `contas-vencidas` | Contas Vencidas | `ContasVencidasPanel` | `fin_accounts_payable` vencidas |
| 15 | `bancos` | Bancos e Contas | `BancosContasTab` | `fin_bank_accounts` / `fin_bank_transactions` |
| 16 | `conciliacao` | Conciliação | `ConciliacaoTab` | `fin_bank_statement_imports` + Stone |
| 17 | `implantacao` | Implantação | `ImplantacaoTab` | `fin_implementation_costs` |

---

## 3. Conexão com o FATURAMENTO (venda → financeiro)

Fluxo em `order-write` → action **`record_payment`** (`index.ts:904-917`):

1. `fn_record_payment_bypass` grava o `payment`.
2. Quando `totalPago >= total do pedido` → `orders.is_paid = true`.
3. Integração financeira (por forma de pagamento, lê `payment_methods.days_to_receive` e `fee_percentage`):
   - **`days_to_receive = 0`** (dinheiro/pix/débito à vista):
     - insere `fin_cash_flow` `origin='auto_sale'` (dedup por `reference_id = paymentId`);
     - credita conta bancária via `fn_bank_credit` **se** houver `fin_income_routing` para aquela forma;
     - se `fee_percentage > 0` → insere `fin_cash_flow` `origin='auto_card_fee'` (despesa) — **taxa de cartão à vista é automática**.
   - **`days_to_receive > 0`** (cartão a prazo): insere **`fin_receivable_installments`** (`status='pending'`, `due_date = hoje + N`). **Não** cria `auto_sale` agora (evita dupla contagem). Na liquidação (`receive_installment`) é que vira caixa.

**Reconhecimento de receita = data do recebimento no caixa (regime de caixa por padrão).** `auto_sale` é datado no dia do pagamento/recebimento, não no dia da venda.

### Origem das parcelas a receber (`fin_receivable_installments`)
Criadas por `record_payment` quando a forma de pagamento tem `days_to_receive > 0`. `payment_method_name`, `order_number`, `order_id` preenchidos. Antecipação: `ContasReceberTab` → `insert_anticipation` (desconta taxa da operadora, grava `fin_anticipations`).

---

## 4. Conexão com o ESTOQUE

### 4a. Compra → estoque (entrada)
`purchase-write` cria `fin_purchases` + `fin_purchase_items`. Depois **`purchase-confirm-delivery`** (`index.ts`):
- grava `received_quantity`/`received_total_price` por item;
- para itens com `ingredient_id`: insere `stock_movements` `type='in'` (entrada de estoque);
- atualiza `fin_purchases.delivery_confirmed_at` e `total_amount` (recalculado pelo recebido);
- atualiza `fin_accounts_payable` vinculada (`reference_id = purchase_id`, `reference_type='purchase'`): `delivery_confirmed=true` e ajusta valor.
- (Preço do insumo pode ser atualizado via `fn_update_ingredient_price_from_purchase`.)

### 4b. Venda → baixa de estoque (saída) + custo
`order-write` → `deductStockForOrderItem` (`index.ts:304-339`), disparado quando item fica `ready`/`delivered`:
- monta deduções pela **ficha técnica** (`item_ingredients`, `combo_items`, `combo_ingredients`, opções com `ingredient_id`);
- insere `stock_movements` `type='theoretical_out'` (baixa teórica, idempotente por `reason` = `item_sale:<item>:<orderItemId>`);
- **grava `order_items.unit_cost`** = custo teórico snapshot no momento da venda (preço do insumo naquele instante).

### 4c. CMV — existem DOIS números diferentes ⚠️
1. **CMV teórico / consumo** — Σ `order_items.unit_cost × qtd` dos itens vendidos (custo snapshot na venda, via ficha técnica). Também exposto pela RPC `fn_get_cmv_report` no módulo Estoque. É o CMV **correto** contábil (custo do que foi **vendido**). **A DRE usa este número (desde 2026-07-03).**
2. **CMV por compras** — `fin_purchases` do período. É custo de **compras** (reposição de estoque), não de consumo. A DRE **não** usa mais isto no resultado; aparece só como referência no aviso.

> Confiabilidade do CMV depende da **cobertura de ficha técnica** (`order_items.unit_cost > 0`). Hoje ~2,2% → CMV subestimado até as fichas serem cadastradas.

---

## 5. Despesas e Receitas (abas 2 e 3)

- **`useReceitas`**: `orders` com `status='delivered' AND is_paid=true AND NOT is_training` + `fin_cash_flow` `origin='manual'` income. (Base = pedidos entregues, não `auto_sale` — pode divergir da Visão Geral/DRE.)
- **`useDespesas`**: 5 fontes — `fin_accounts_payable` (**excluindo `reference_type='purchase'`**, `useDespesas.ts:~96`), `fin_purchases`, `hr_payroll` (`gross_salary + fgts`), `fin_cash_flow` manual expense, `fin_anticipations` (taxa = `gross - net`).
- **Prevenção de dupla contagem** (`useFinanceiro.ts:519-532`): `useTopDespesas` exclui `auto_purchase`/`auto_bill_payment`/`auto_payroll` do somatório de `fin_cash_flow`. Invariante documentado: somatório deve bater com saídas do `fin_cash_flow` no período.

---

## 6. A DRE (`DRETab.tsx`)

Dois regimes: **Caixa** (`fetchDREData`, ~L68-291) e **Competência** (`fetchDREDataCompetencia`, ~L294-488). Comparativo em `DREComparativoTab`.

### Fontes (regime Caixa)
| Linha DRE | Fonte | Filtro |
|---|---|---|
| Receita (à vista) | `payments` com `days_to_receive=0` **e** com `auto_sale` correspondente | período por `created_at`; cruza `reference_id` |
| Receita (cartão a prazo) | `fin_receivable_installments` `status='received'` | por `received_at` |
| Entradas manuais | `fin_cash_flow` `origin='manual'` income | por `date` |
| (–) Cancelamentos | `orders status='cancelled'` → `total_amount` | por `created_at` |
| (–) Descontos | `orders.discount_amount` | por `created_at` |
| CMV | **consumo**: Σ `order_items.unit_cost × qtd` dos pedidos pagos não cancelados | por `orders.created_at` |
| Despesas por categoria | `fin_accounts_payable` `status='paid'` agrupado por `dre_category_id`, **excluindo `reference_type='purchase'`** | por `paid_date` |
| Custo com pessoal | `hr_payroll` (`gross_salary + fgts`) | por `reference_month` |
| Taxas de cartão | `fin_cash_flow origin='auto_card_fee'` (do razão) | por `date` |

### Fórmulas (`DRETab.tsx` ~L836-874)
```
receitaBruta      = receitaRecebida
receitaLiquida    = receitaBruta − cancelamentos − descontos
cmvTotal          = cmvTeorico  (consumo Σ unit_cost × qtd; igual nos dois regimes)
lucroBruto        = receitaLiquida − cmvTotal
resultadoOperac.  = lucroBruto − despesasOp − custosCat − custoPessoal − taxasMaquininha − customGroups
margemBruta       = lucroBruto / receitaBruta × 100
margemLiquida     = resultadoOperacional / receitaBruta × 100
```
- **Não há linha de EBITDA** explícita.
- Categorias DRE: `fin_dre_categories` (`group_type ∈ revenue|cost|expense|tax`, hierárquicas via `parent_id`). Grupos "custom" ficam em `localStorage` por tenant.
- Regime **Competência**: receita reconhecida = `receitaRecebida` (recebível pendente é **saldo**, não soma na receita — comentado como "BUG-41", intencional); CMV/despesas por `purchase_date`/`due_date`.

---

## 7. Problemas conhecidos e correções (auditoria 2026-07-02, fixes 2026-07-03)

> Verificados no código + dados reais do tenant (`execute_sql`). Severidade: 🔴 crítico, 🟠 alto, 🟡 médio.
> Legenda: ✅ corrigido · 🔶 corrigido parcialmente / decisão consciente · ⏳ pendente.

- **✅ 🔴 P1 — Dupla contagem CMV × contas a pagar de compra (DRE).** `DRETab` somava compras pagas no CMV (`fin_purchases`) **e** as contas a pagar de compra por categoria (sem excluir `reference_type='purchase'`). As 6 contas geradas por compras entravam 2×. **Fix:** `billsRes` dos dois regimes agora exclui `reference_type='purchase'` (`.or('reference_type.is.null,reference_type.neq.purchase')`), mesmo critério da `DespesasTab`.
- **✅ 🔴 P2 — CMV agora é por CONSUMO (custo dos produtos vendidos).** DRE e DRE Comparativo passam a usar Σ `order_items.unit_cost × qtd` (`fetchCmvConsumo`/`fetchCmvConsumoComp`), regime-agnóstico. Compras saem do CMV (viram estoque/caixa). Drill-down do CMV mostra itens vendidos. **⚠️ Cobertura de ficha técnica medida = 2,2%** (25 de 1.136 itens) → hoje o CMV está **subestimado** (margem inflada) até o usuário cadastrar as fichas. Aviso na tela mostra a cobertura e as compras do período. **Raiz a resolver: subir a cobertura de ficha técnica.**
- **✅ 🟠 P3 — `pay_bill` gravava caixa com `origin='manual'` → dupla contagem em Despesas.** `pay_bill` **já** inseria `fin_cash_flow`, mas como `origin='manual'`; `useDespesas` soma `fin_accounts_payable` (pagas) **e** `fin_cash_flow` manual → conta contada 2× na aba Despesas. O design já previa `auto_bill_payment` (lista de exclusão em `useFinanceiro.ts:519-532`). **Fix:** `pay_bill` usa `origin='auto_bill_payment'`. **Deployado: `financial-write` v35 (2026-07-03).**
- **✅ 🟠 P4 — Três bases de "receita" (rotuladas).** `ReceitasTab` = faturamento (pedidos entregues); Visão Geral/DRE = recebido em caixa (`auto_sale`). São visões legítimas diferentes — não colapsadas. **Fix:** aviso azul na aba Receitas explicando "faturamento por venda"; KPIs da Visão Geral relabelados "Receita … (caixa)". Reconciliação automática entre as duas fica como evolução futura.
- **✅ 🟡 P5 — Previsão: saldo inicial híbrido.** Usa `Σ fin_bank_accounts.current_balance` (saldo bancário real) **quando os bancos estão em uso**; senão cai no proxy do `fin_cash_flow` acumulado. Sub-label indica a fonte. Hoje há 2 contas com saldo R$0 e 0 rotas de income routing → usa o proxy. Configurar bancos/routing ativa o saldo real automaticamente.
- **✅ 🟡 P6 — `payment_methods` sem `tenant_id`** na DRE. **Fix:** `.eq('tenant_id', tenantId)` nos dois regimes.
- **✅ 🟡 P7 — Taxa de cartão da DRE agora vem do razão.** DRE lê `fin_cash_flow origin='auto_card_fee'` (criado na venda à vista e na liquidação de recebíveis — BUG-43) em vez de recalcular `payments × fee`. Cobre cartão a prazo e bate com o razão.
- **⏳ 🟡 P8 — Alinhamento de período por hora** (`created_at` T23:59:59 vs data pura). Pendente (baixo impacto).

### Backlog restante
- **P8:** padronizar limites de período (borda de 1h).
- **Raiz do P2 (prioridade):** subir a cobertura de ficha técnica (hoje 2,2%) — sem isso o CMV por consumo fica subestimado.
- **Bancos/income routing:** configurar para o saldo bancário e o P5 usarem dados reais.
- **Evolução P4:** reconciliação automática faturamento ↔ caixa recebido.

---

## 8. Invariantes de reconciliação (para testes)
- Σ receitas por categoria (DRE) ≈ Σ `auto_sale`+`manual income` do período (quando bases unificadas).
- Σ `useTopDespesas` = saídas de `fin_cash_flow` no período (auto_purchase/bill/payroll excluídos por design).
- CMV teórico (`fn_get_cmv_report`) só é confiável com **cobertura de ficha técnica alta** (o report expõe `cobertura_pct`).
- Toda compra confirmada gera `stock_movements type='in'`; toda venda ready/delivered gera `theoretical_out` + `unit_cost`.

---

## 9. Tabelas do módulo (schema `public`)
`fin_cash_flow`, `fin_accounts_payable`, `fin_receivable_installments`, `fin_anticipations`, `fin_purchases`, `fin_purchase_items`, `fin_purchase_catalog`, `fin_suppliers`, `fin_cost_centers`, `fin_dre_categories`, `fin_bank_accounts`, `fin_bank_transactions`, `fin_bank_statement_imports`, `fin_bank_statements`, `fin_reconciliation_rules`, `fin_budgets`, `fin_budget_items`, `fin_income_routing`, `fin_investment_settings`, `fin_implementation_costs`, `fin_implementation_columns`, `fin_stone_config`, `fin_stone_imports`, `fin_pix_payments`, `fin_payable_aging`(view), `fin_receivable_aging`(view), `hr_employees`, `hr_payroll`, `hr_payroll_custom_fields`.

RPCs relevantes: `fn_get_cmv_report`, `fn_bank_credit`, `fn_bank_debit`, `fn_record_payment_bypass`, `fn_update_ingredient_price_from_purchase`, `fn_update_ingredient_stock`.
Edge Functions: `financial-write` (~47 actions), `purchase-write`, `purchase-confirm-delivery`, `stone-conciliation`, `pix-payment`, `implementation-write`, `order-write` (integração de venda).
