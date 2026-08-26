# Módulo Financeiro — Mapa de Referência (ERPOS V2)

> Documento vivo. É a fonte única para entender a aba **Financeiro**: telas, dados, fluxos, conexões com Estoque/Faturamento, a DRE e os problemas conhecidos.
> **Sempre confirme no código atual antes de afirmar** — atualize este arquivo quando algo mudar.
> Última revisão: **2026-08-26** (Fase 1 de compras: bugs P9/P10/P11 corrigidos + correção conceitual do CMV — ver §7 e §10).

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

> ✅ **`auto_bill_payment` EXISTE e está em uso** desde o fix do P3 (`financial-write` v35). Pagar uma conta (`pay_bill`) insere em `fin_cash_flow` com esse `origin` **e** debita o banco (`fn_bank_debit`). *(Este parágrafo afirmava o contrário até 2026-08-26 — estava obsoleto.)* Não há `auto_anticipation` em uso.

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
`purchase-write` (`create_purchase`) cria `fin_purchases` + `fin_purchase_items` e **já dá a entrada de estoque** ali mesmo, via `fn_add_stock_movement` `p_type='in'`, convertendo unidade de compra → unidade de estoque (`quantity × units_per_package`). Também atualiza o custo do insumo (`fn_update_ingredient_price_from_purchase`) com o `cost_per_base_unit`.

> ⚠️ Este documento afirmou até 2026-08-26 que a entrada ocorria no `confirm-delivery`. **Não ocorre** — lá só entra o *delta* entre pedido e recebido.

Depois, **`purchase-confirm-delivery`** (`index.ts`):
- grava `received_quantity`/`received_total_price` por item;
- lança em `stock_movements` apenas o **delta** recebido−pedido (`type='in'` ou `'manual_out'`);
- atualiza `fin_purchases.delivery_confirmed_at` e `total_amount` (recalculado pelo recebido);
- atualiza `fin_accounts_payable` vinculada (`reference_id = purchase_id`, `reference_type='purchase'`): `delivery_confirmed=true` e ajusta valor.
- (Preço do insumo pode ser atualizado via `fn_update_ingredient_price_from_purchase`.)

### 4b. Venda → baixa de estoque (saída) + custo
`order-write` → `deductStockForOrderItem` (`index.ts:304-339`), disparado quando item fica `ready`/`delivered`:
- monta deduções pela **ficha técnica** (`item_ingredients`, `combo_items`, `combo_ingredients`, opções com `ingredient_id`);
- insere `stock_movements` `type='theoretical_out'` (baixa teórica, idempotente por `reason` = `item_sale:<item>:<orderItemId>`);
- **grava `order_items.unit_cost`** = custo teórico snapshot no momento da venda (preço do insumo naquele instante).

### 4c. CMV — DOIS números com propósitos DIFERENTES ⚠️

**Definição de negócio (decidida pelo dono em 2026-08-26 — é a regra a seguir):**

1. **CMV real → é o que vai na DRE.**
   - **Competência:** `CMV = Compras do mês (por data do pedido) + Estoque inicial − Estoque final`
   - **Caixa:** `CMV = Compras pagas no mês` (sem ajuste de estoque)

2. **CMV teórico → NÃO vai na DRE.** Σ `order_items.unit_cost × qtd` via ficha técnica. É o custo que *deveria* ter sido consumido.

**Por que a ficha técnica não serve para a DRE:** a diferença entre o real e o teórico **é** a perda (quebra, desvio, porcionamento errado). Usar o teórico na DRE apaga exatamente o que se quer medir — a margem exibida passa a ser a planejada, nunca a realizada.

> **Uso correto do CMV teórico:** indicador gerencial de eficiência. `CMV real − CMV teórico = perda do período`.

**Validação contra a planilha do dono** (aba `Geral Comp.`, EP Paranaguá) — a fórmula fecha nos 5 meses:

| Mês | Compras | Est. inicial | Est. final | CMV |
|---|---|---|---|---|
| Abril | 13.889,47 | 8.151,89 | 6.689,26 | 15.352,10 |
| Maio | 10.756,17 | 6.689,26 | 4.784,92 | 12.660,51 |
| Junho | 18.819,56 | 4.784,92 | 7.292,73 | 16.311,75 |
| Julho | 22.233,97 | 7.292,73 | 6.599,86 | 22.926,84 |

> 🔴 **A DRE atual NÃO segue esta regra** — desde o "fix" P2 (2026-07-03) ela usa o CMV teórico. Ver P12 em §7. **Não implementado ainda.**

> **Bloqueio conhecido:** não existe snapshot mensal de estoque valorizado. `inventory_sessions` guarda contagens (`valor_ajuste_liquido`, `items` jsonb) mas **não** o valor total do estoque em cada fechamento. Sem isso o regime de competência não tem como obter Estoque inicial/final. O regime de caixa (compras pagas no mês) é implementável hoje.

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
- **❌ 🔴 P2 — REVERTIDO CONCEITUALMENTE (ver P12). O remédio estava errado.** O diagnóstico ("compras ≠ CMV") era correto, mas a solução escolhida (ficha técnica) não é CMV de DRE — é CMV teórico. O caminho certo é `Compras + Estoque inicial − Estoque final`. Texto original abaixo, mantido para histórico: ~~CMV agora é por CONSUMO (custo dos produtos vendidos).~~ DRE e DRE Comparativo passam a usar Σ `order_items.unit_cost × qtd` (`fetchCmvConsumo`/`fetchCmvConsumoComp`), regime-agnóstico. Compras saem do CMV (viram estoque/caixa). Drill-down do CMV mostra itens vendidos. **⚠️ Cobertura de ficha técnica medida = 2,2%** (25 de 1.136 itens) → hoje o CMV está **subestimado** (margem inflada) até o usuário cadastrar as fichas. Aviso na tela mostra a cobertura e as compras do período. **Raiz a resolver: subir a cobertura de ficha técnica.**
- **✅ 🟠 P3 — `pay_bill` gravava caixa com `origin='manual'` → dupla contagem em Despesas.** `pay_bill` **já** inseria `fin_cash_flow`, mas como `origin='manual'`; `useDespesas` soma `fin_accounts_payable` (pagas) **e** `fin_cash_flow` manual → conta contada 2× na aba Despesas. O design já previa `auto_bill_payment` (lista de exclusão em `useFinanceiro.ts:519-532`). **Fix:** `pay_bill` usa `origin='auto_bill_payment'`. **Deployado: `financial-write` v35 (2026-07-03).**
- **✅ 🟠 P4 — Três bases de "receita" (rotuladas).** `ReceitasTab` = faturamento (pedidos entregues); Visão Geral/DRE = recebido em caixa (`auto_sale`). São visões legítimas diferentes — não colapsadas. **Fix:** aviso azul na aba Receitas explicando "faturamento por venda"; KPIs da Visão Geral relabelados "Receita … (caixa)". Reconciliação automática entre as duas fica como evolução futura.
- **✅ 🟡 P5 — Previsão: saldo inicial híbrido.** Usa `Σ fin_bank_accounts.current_balance` (saldo bancário real) **quando os bancos estão em uso**; senão cai no proxy do `fin_cash_flow` acumulado. Sub-label indica a fonte. Hoje há 2 contas com saldo R$0 e 0 rotas de income routing → usa o proxy. Configurar bancos/routing ativa o saldo real automaticamente.
- **✅ 🟡 P6 — `payment_methods` sem `tenant_id`** na DRE. **Fix:** `.eq('tenant_id', tenantId)` nos dois regimes.
- **✅ 🟡 P7 — Taxa de cartão da DRE agora vem do razão.** DRE lê `fin_cash_flow origin='auto_card_fee'` (criado na venda à vista e na liquidação de recebíveis — BUG-43) em vez de recalcular `payments × fee`. Cobre cartão a prazo e bate com o razão.
- **⏳ 🟡 P8 — Alinhamento de período por hora** (`created_at` T23:59:59 vs data pura). Pendente (baixo impacto).

### Auditoria 2026-08-26 (Fase 1 — compras, para substituir a planilha do dono)

- **✅ 🔴 P9 — Financeiro › Compras não salvava NADA desde ~jun/2026.** `compras/NovaCompraModal` envia `catalog_id` por item, mas essa coluna **não existe** em `fin_purchase_items`; o PostgREST rejeitava o insert inteiro (PGRST204) porque `purchase-write` fazia `...rest` do payload direto no insert. Último item gravado: **2026-06-01**. As telas de Estoque usam o OUTRO modal (`components/NovaCompraModal`, sem `catalog_id`) e por isso continuaram funcionando — o bug passou despercebido. **Fix:** `create_purchase` passou a montar as linhas com **lista explícita de colunas**, imune a campos extras do front. **Deployado: `purchase-write` (2026-08-26).**
- **✅ 🟠 P10 — Unidade e R$/kg eram destruídos em toda compra.** `purchase-write` lia `item.purchase_unit`/`item.purchase_factor`, nomes que **nenhum** front envia (ambos os modais mandam `unit_label`/`units_per_package`), e sobrescrevia com `null`/`1`. Efeito medido: de 25 itens gravados, só 4 tinham unidade. A conversão para estoque não era afetada (lia do objeto cru), só a linha persistida. **Fix:** aceita os dois nomes, com fallback.
- **✅ 🔴 P11 — `pay_bill` quitava conta paga pela metade.** `update({ status: 'paid' })` incondicional, ignorando `paid_amount < amount`, sem saldo residual — o valor a pagar restante simplesmente sumia. **Fix:** `paid_amount` agora **acumula** os pagamentos; `status='partial'` enquanto não cobrir o total (tolerância de meio centavo); recorrente só gera o mês seguinte quando quitada; rejeita pagar conta já quitada (409) e valor ≤ 0 (400). **Deployado: `financial-write` (2026-08-26).**
- **⏳ 🔴 P12 — DRE usa CMV teórico (ficha técnica) em vez do CMV real.** Ver §4c para a regra correta e a validação numérica. **Bloqueado por:** falta de snapshot mensal de estoque valorizado. Regime de caixa é destravável antes do de competência.

### Backlog restante
- **P12 (prioridade):** refazer o CMV da DRE conforme §4c. Pré-requisito: snapshot mensal de estoque valorizado.
- **Fase 2 de compras:** catálogo de recorrentes ligado ao modal (lançamento rápido do dia a dia); pagamento em lote por fornecedor; listagem de compras espelhando a aba "CM" da planilha (filtros mês/fornecedor/categoria + totais), para rodar sistema × planilha em paralelo antes de largar a planilha.
- **Duplicação de modal de compra:** existem DOIS `NovaCompraModal` (`components/` usado pelo Estoque, `components/compras/` usado pelo Financeiro). Unificar — foi a divergência que escondeu o P9.
- **`GerenciarFornecedoresModal` órfão:** existe em `src/pages/estoque/components/` sem nenhum import. Fornecedor na compra é ligado por **nome** (`ilike`), não por FK.
- **P8:** padronizar limites de período (borda de 1h).
- **Cobertura de ficha técnica** (hoje 2,2%): continua importante — mas para o **CMV teórico / indicador de perda**, não para a DRE.
- **Bancos/income routing:** configurar para o saldo bancário e o P5 usarem dados reais.
- **Evolução P4:** reconciliação automática faturamento ↔ caixa recebido.

---

## 8. Invariantes de reconciliação (para testes)
- Σ receitas por categoria (DRE) ≈ Σ `auto_sale`+`manual income` do período (quando bases unificadas).
- Σ `useTopDespesas` = saídas de `fin_cash_flow` no período (auto_purchase/bill/payroll excluídos por design).
- CMV teórico (`fn_get_cmv_report`) só é confiável com **cobertura de ficha técnica alta** (o report expõe `cobertura_pct`).
- Toda compra criada gera `stock_movements type='in'`; toda venda ready/delivered gera `theoretical_out` + `unit_cost`.
- Em `fin_purchase_items`: `total_price = quantity × (unit_price − discount_per_unit)` e `cost_per_base_unit = (total_price + freight_allocated) / (quantity × units_per_package)`. O `total_amount` da compra é **derivado** da soma dos itens + frete (calculado no `purchase-write`, não confiado ao front).
- Em `fin_accounts_payable`: `paid_amount` é **acumulado**; saldo devedor = `amount − paid_amount`; `status='paid'` só quando `paid_amount ≥ amount`.

---

## 8b. Taxonomia única: categorias de mercadoria e fornecedores (2026-08-26)

**Problema:** existiam **três** listas de categoria concorrentes — `ingredients.category` (texto livre), `ingredient_categories` (lista de sugestão do cadastro de insumo) e `fin_merchandise_categories` (compras) — e elas já haviam divergido (o estoque tinha Panificação/Mercearia/Chips; as compras tinham Chope/Sucos/Tortilha/Secos). Sem uma taxonomia comum é impossível calcular **CMV por categoria**, porque `Compras + Estoque inicial − Estoque final` exige que os três termos falem a mesma língua.

**Solução — FK como fonte de verdade + texto espelhado por trigger.** ~40 pontos do front leem `ingredients.category` como TEXTO (relatórios, CSVs, filtros) e duas RPCs que nem estão versionadas no repo (`fn_get_ingredients`, `fn_get_ingredients_consumo`) o retornam. Trocar tudo por UUID de uma vez quebraria demais. Então:

- `fin_merchandise_categories` é a **lista única** (estoque + compras). `ingredient_categories` foi absorvida e não é mais lida.
- `ingredients.merchandise_category_id` é a **fonte de verdade**; `ingredients.category` continua existindo como **espelho**.
- **`trg_sync_ingredient_category`** (BEFORE INSERT/UPDATE em `ingredients`) sincroniza nos DOIS sentidos:
  - FK definida → escreve o texto;
  - só texto (caminhos legados: `fn_upsert_ingredient`, `bulk_insert_ingredients`, `import-menu-template`) → resolve/cria a categoria e preenche a FK.
- **`trg_propagate_merchandise_category_rename`** (AFTER UPDATE OF name) propaga rename/merge para o texto dos insumos.
- Ambas as funções são `SECURITY DEFINER` owned by `postgres` (as tabelas não têm FORCE RLS, então a trigger escreve normalmente).
- Action **`merge_merchandise_category`** permite colapsar duplicatas (move insumos + itens de compra, desativa a origem).

> Consequência prática: nenhum código de leitura precisou mudar. `useIngredientCategories` foi reapontado para a lista única mantendo a interface idêntica.

**Fornecedores — FK tenant-safe.** O vínculo era por **nome** com `ilike`, que falhava silenciosamente em nomes com espaço duplo/sobrando (ex.: `Alvino␣␣dos Passos Junior`). Pior: **36 insumos** (24 em EP Paranaguá + 12 em EP PAR MALL) tinham `supplier_id` apontando para fornecedores de **outra loja**.

- Corrigido: os fornecedores foram recriados na loja certa (pelo nome em `ingredients.supplier`) e os vínculos reapontados. EP Paranaguá saiu de 0 → 6 fornecedores.
- `fin_purchases.supplier_id` criado; `purchase-write` resolve **ou cria** o fornecedor do tenant e grava a FK.
- **Trava contra recorrência:** FKs compostas `(supplier_id, tenant_id) → fin_suppliers(id, tenant_id)` e `(merchandise_category_id, tenant_id) → fin_merchandise_categories(id, tenant_id)` em `ingredients`, `fin_purchase_items` e `fin_purchase_catalog`. Cross-tenant agora é **erro**, não vazamento silencioso.
- ⚠️ Por causa disso, `import-menu-template` **não copia mais `supplier_id`** do template (o id é de outro tenant e violaria a FK); só o nome em `supplier`.

> Pendente: `fin_purchase_catalog.merchandise_category_id` existe mas ainda não é preenchido pela UI do catálogo; `AlertasReposicao` agrupa só por texto de fornecedor, ignorando a FK.

---

## 9. Tabelas do módulo (schema `public`)
`fin_cash_flow`, `fin_accounts_payable`, `fin_receivable_installments`, `fin_anticipations`, `fin_purchases`, `fin_purchase_items`, `fin_purchase_catalog`, `fin_merchandise_categories`, `fin_suppliers`, `fin_cost_centers`, `fin_dre_categories`, `fin_bank_accounts`, `fin_bank_transactions`, `fin_bank_statement_imports`, `fin_bank_statements`, `fin_reconciliation_rules`, `fin_budgets`, `fin_budget_items`, `fin_income_routing`, `fin_investment_settings`, `fin_implementation_costs`, `fin_implementation_columns`, `fin_stone_config`, `fin_stone_imports`, `fin_pix_payments`, `fin_payable_aging`(view), `fin_receivable_aging`(view), `hr_employees`, `hr_payroll`, `hr_payroll_custom_fields`.

RPCs relevantes: `fn_get_cmv_report`, `fn_bank_credit`, `fn_bank_debit`, `fn_record_payment_bypass`, `fn_update_ingredient_price_from_purchase`, `fn_update_ingredient_stock`.
Edge Functions: `financial-write` (~47 actions), `purchase-write`, `purchase-confirm-delivery`, `stone-conciliation`, `pix-payment`, `implementation-write`, `order-write` (integração de venda).

### Edição de compra (`update_purchase`, 2026-08-26)

`purchase-write` ganhou a action `update_purchase`, ao lado de `create_purchase`/`delete_purchase`. A lógica de cálculo (custo por item, resolução de fornecedor, herança de categoria, entrada de estoque, geração de contas a pagar) foi extraída para funções compartilhadas (`computePurchaseItems`, `resolveOrCreateSupplier`, `inheritMerchandiseCategories`, `applyStockAndPricing`, `reverseStockForItems`, `createBillsForPurchase`) — create e update chamam as mesmas, para não duplicar bug.

**Guarda de segurança:** só edita quando a compra original **não teve nenhum efeito colateral ainda** — nem recebimento confirmado (`delivery_confirmed_at`), nem qualquer pagamento registrado (`payment_status='paid'` na criação, ou qualquer `fin_accounts_payable` vinculada com `status='paid'`/`paid_amount>0`). Fora dessas condições, `update_purchase` devolve **409** com mensagem explicando; o front orienta a excluir e lançar de novo (a exclusão já reverte estoque/contas corretamente).

Quando aceita: estorna o estoque da versão antiga (`manual_out`), apaga as contas a pagar/caixa antigas (nenhuma tinha pagamento, garantido pela guarda) e os itens antigos, e recria tudo com os dados novos — mesmo caminho do `create_purchase`.

Front: `ComprasTab.tsx` tem botão de editar (lápis) na coluna Ações — checa a elegibilidade (via `fin_accounts_payable` do `reference_id`) antes de abrir o modal; se bloqueado, mostra banner explicando por quê. `compras/NovaCompraModal.tsx` ganhou os props `editingPurchase`/`editingInstallments` para pré-preencher o formulário. Hook `usePurchases` ganhou `update(id, payload, auditFn)`.
