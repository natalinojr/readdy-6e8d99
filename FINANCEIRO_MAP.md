# Módulo Financeiro — Mapa de Referência (ERPOS V2)

> Documento vivo. É a fonte única para entender a aba **Financeiro**: telas, dados, fluxos, conexões com Estoque/Faturamento, a DRE e os problemas conhecidos.
> **Sempre confirme no código atual antes de afirmar** — atualize este arquivo quando algo mudar.
> Última revisão: **2026-09-05** (CMV da DRE = compras realizadas §9d · catálogo de compras separado em dois tipos §9e · aba Relatórios de compras §9c).

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
| 4 | `fluxo` | Fluxo de Caixa | `FluxoCaixaTab` — 3 visões: **Projeção** (padrão, = `PrevisaoCaixaTab`), **Calendário** (`CalendarioFluxoCaixa`), **Extrato** (realizado) | projeção: AP + recebíveis + folha + `fin_cash_flow`; extrato: só `fin_cash_flow` |
| ~~5~~ | ~~`previsao`~~ | *removida da navegação em 2026-09-05* — virou a visão padrão do `fluxo`. O id antigo ainda roteia para `FluxoCaixaTab` por causa de links salvos. | — | — |
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

> ✅ **Implementado em 2026-09-05** (o dono reafirmou a regra: *"no CMV tem que ir compras realizadas; o CMV dos produtos vendidos é teórico e isso não entra no DRE"*). `DRETab` e `DREComparativoTab` passaram a usar **compras realizadas** como CMV, nos dois regimes. O CMV teórico continua sendo calculado e aparece **só como comparativo** no aviso abaixo da linha do CMV. Ver §9d.

> **Bloqueio remanescente (só do ajuste de estoque):** o termo `+ Estoque inicial − Estoque final` da competência **ainda não é aplicado** — não existe snapshot mensal de estoque valorizado. `inventory_sessions` guarda contagens (`valor_ajuste_liquido`, `items` jsonb) mas **não** o valor total do estoque em cada fechamento. Sem isso o regime de competência não tem como obter Estoque inicial/final. O regime de caixa (compras pagas no mês) é implementável hoje.

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
- **✅ 🔴 P2/P12 — RESOLVIDO em 2026-09-05: CMV da DRE = compras realizadas.** Ver §9d. O texto abaixo fica como histórico do caminho errado.
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

### Auditoria completa do módulo (2026-08-26, tarde)

Revisão sistemática de todas as abas. Classes de bug recorrentes encontradas: **(a)** status derivado de campo do banco que ninguém atualiza em vez de derivado por DATA; **(b)** somas ignorando `paid_amount` depois que o P11 fez ele ACUMULAR; **(c)** `status='partial'` não previsto em filtros; **(d)** datas em UTC (`toISOString()`) numa loja que fatura à noite; **(e)** queries sem paginação truncadas em ~1000 linhas em silêncio.

**Contas a pagar / vencidas**
- **✅ 🔴 P13 — Pagar pela aba "Contas Vencidas" não tirava o dinheiro do sistema.** `ContasVencidasPanel.handlePay` gravava DIRETO na tabela: quitava conta paga pela metade (ressuscitando o P11), **não** inseria `fin_cash_flow auto_bill_payment`, **não** chamava `fn_bank_debit`, não gerava a recorrente e não filtrava `tenant_id`. Agora usa `useBillsPayable().pay()`.
- **✅ 🔴 P14 — Pagamento em LOTE pagava o valor cheio de conta parcial.** Conta de R$1.000 com R$600 pagos recebia mais R$1.000 no caixa e no banco. Agora paga `saldoRestante(bill)`.
- **✅ 🔴 P15 — `pay_bill` não limitava o pagamento ao saldo devedor.** Agora recusa (400) com o saldo na mensagem.
- **✅ 🔴 P16 — Erro de pagamento era engolido.** `useBillsPayable.pay` ignorava o retorno de `invokeFinancial` → o modal fechava fingindo sucesso. Agora **lança**, e os dois modais exibem o erro.
- **✅ 🟠 P17 — Contas `partial` sumiam do painel de vencidas** (`.in('status',['overdue','pending'])`) e os totais somavam `amount` cheio. Corrigido; o modal também passa a sugerir o SALDO, não o valor original.
- **✅ 🟠 P18 — Aging ignorava pagamento parcial** (`AgingContasPagar`): conta de R$1.000 com R$900 pagos entrava no bucket valendo R$1.000, distorcendo faixas, % de inadimplência e o alerta de 20%.
- **✅ 🟡 P19 — A tabela não mostrava o saldo devedor** de conta parcial (exibia só o valor original).
- **✅ 🟡 P20 — Detalhe da compra buscava parcelas por TEXTO** (`.ilike('description','%fornecedor%NF%')`) → trazia parcelas de TODAS as compras do mesmo fornecedor. Agora por `reference_id`+`reference_type`.

**DRE**
- **✅ 🔴 P21 — Cancelamentos e descontos deduzidos DUAS vezes.** `receitaBruta` vem de `paymentsMatched`, que já exclui cancelados e já é líquida de desconto; a fórmula subtraía de novo. Agora `receitaLiquida = receitaBruta`, e as duas linhas viram **informativas** (rotuladas como tal na tela).
- **✅ 🔴 P22 — Regime de caixa ignorava contas `partial`.** Conta de R$10.000 com R$6.000 pagos entrava com ZERO no mês em que o dinheiro saiu. Agora `.in('status',['paid','partial'])` somando `paid_amount`. Idem no Comparativo e no drill-down. *(Limitação de schema: `paid_date` guarda só a data do ÚLTIMO pagamento — conta paga em 2 meses aparece inteira no mês final. Corrigir exige ledger de pagamentos.)*
- **✅ 🟠 P23 — Item de compra com `dre_category_id` burlava o P1.** `billsRes` exclui `reference_type='purchase'`, mas o ITEM com categoria era somado em `despesasPorCategoria` → mercadoria virava despesa E CMV. Agora todo item de compra vai só para `cmvCompras`.
- **✅ 🟠 P24 — Despesas SEM categoria DRE sumiam do resultado.** Iam para `__sem_categoria__` e nunca eram subtraídas; o aviso amarelo mostrava o valor sem descontá-lo. Agora entram no total (com linha própria).
- **✅ 🟠 P25 — Folha entrava no regime de CAIXA sem estar paga.** Agora `.eq('status','paid')` no caixa; competência segue por `reference_month`.
- **✅ 🔴 P26 — DRE Comparativo contava venda a prazo DUAS vezes** (`receitaRecebida + receitaAReceber`) e **não subtraía folha nem taxa de cartão** — o "Resultado Líquido" dele não batia com a aba DRE. Ambos corrigidos; "a receber" virou linha informativa.

**Fluxo de caixa / Previsão / Receitas**
- **✅ 🔴 P27 — Datas em UTC gravavam dado errado no razão.** `new Date().toISOString().split('T')[0]` das 21h à meia-noite locais já retorna o dia seguinte: o botão "Hoje" mostrava tela vazia, o preset "Mês" pulava de mês no dia 31, e **lançamento manual era salvo com a data de amanhã**. Agora tudo usa `todayBrasilia()` de `src/lib/dateUtils.ts` (helper canônico). No `ReceitasTab` as datas eram `const` de nível de MÓDULO — congelavam no carregamento do bundle (PWA aberto por dias); viraram funções.
- **✅ 🔴 P28 — Previsão: a folha NUNCA entrava.** Filtrava `paid_date` (NULL enquanto pendente) → `NULL >= data` é NULL → resultado vazio por construção. Agora projeta por `reference_month` no dia 5 do mês seguinte (CLT art. 459 §1º), empurrando para segunda em fim de semana; folha atrasada cai em hoje. *(Limitação: `hr_payroll` não tem `paid_amount` nem data prevista.)*
- **✅ 🔴 P29 — Receitas contava pedido entregue e NÃO PAGO.** `is_paid` era selecionado e nunca aplicado — comanda em aberto/fiado entrava como receita recebida. Agora `.eq('is_paid', true)`, alinhado ao contrato do §5.
- **✅ 🟠 P30 — Queries sem paginação truncadas em ~1000 linhas SEM ERRO.** Novo helper `src/lib/fetchAllRows.ts` (padrão de `useOrdersHistory`), aplicado em `useReceitas`. **Ainda falta aplicar** em `list_cash_flow` (financial-write) e nas queries de `fin_purchase_items`/`payments` da DRE — ver backlog.
- **✅ 🟡 Diversos:** filtro de categoria do Fluxo de Caixa agora deriva dos dados (a lista fixa não cobria "Taxas de Cartao", "Folha de Pagamento" etc.); `originLabel` completado; "Média Diária" das Receitas dividia pelo mês inteiro (no dia 5 mostrava 1/6 do real); Previsão rotulava toda entrada como "manual"; Calendário partia de saldo ZERO no alerta de negativo, tratava `partial` como "Paga" e o resumo semanal usava o mês.

### Migração das escritas diretas → Edge Function (2026-08-26)

**O problema real, medido:** a política que de fato restringe (`*_auth_uid`) usa
`tenant_id = (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() LIMIT 1)` — **sem `ORDER BY`**. Para um usuário com várias lojas (há um com **4** no banco) o Postgres devolve uma membership arbitrária: nas demais lojas a escrita direta afeta **zero linhas, sem erro**. O usuário clica em salvar e nada acontece.

Por isso as escritas estão sendo movidas para `financial-write` (roda como `service_role`, valida a membership e escopa por `tenant_id`), uma de cada vez:

| # | Origem | Status | Action usada |
|---|---|---|---|
| 1 | `useReceitas` → receita manual (`fin_cash_flow`) | ✅ | `insert_cash_flow` (já existia) |
| 2 | `ContasPagarDREModal` → vínculo DRE (`fin_accounts_payable`) | ✅ | **`bulk_update_bill_dre_category`** (nova, em lote) |
| 3 | `OrcamentosTab` (`fin_budgets` + `fin_budget_items`) | ✅ | **`upsert_budget` / `update_budget_status` / `delete_budget`** (novas) |
| 4 | `usePayrollCustomFields` (`hr_payroll_custom_fields`) | ✅ | **`upsert_payroll_custom_field` / `delete_payroll_custom_field`** (novas) |
| 5 | `useRH` (`hr_employees`, `hr_payroll`) | ✅ | **`upsert_employee` / `delete_employee` / `update_employee_vacation` / `update_employee_thirteenth` / `upsert_payroll` / `delete_payroll` / `bulk_insert_payroll`** (novas) |

Ganhos além do isolamento: o vínculo DRE em lote contava `count++` mesmo quando o update falhava (dizia "N salvos" sem ter salvo nada); orçamento e itens agora são gravados **atomicamente** (antes o orçamento podia ficar com valor cheio e zero itens, virando compra vazia); campos de folha passaram a filtrar `tenant_id` no update/delete (antes só `id`).

**Leituras continuam diretas** — não são o problema, e a RLS de SELECT funciona.

> ✅ **Migração COMPLETA em 2026-08-26.** Varredura automatizada em `src/**` confirma: **zero** `.insert/.update/.delete` direto em tabelas `fin_*`/`hr_*`. Só restam leituras (`.select`), que são legítimas.
>
> **Próximo passo possível (não executado):** converter as políticas `deny_direct_write_*` de PERMISSIVE para **RESTRICTIVE**, aí a tranca passa a valer de verdade. Antes de virar essa chave, testar o módulo inteiro em produção por alguns dias — se algum caminho de escrita tiver escapado da varredura, ele passa a falhar.

> **Sobre as políticas `deny_direct_write_*`:** verificado em 2026-08-26 que TODAS são **PERMISSIVAS**. Como políticas permissivas se somam por OR, uma com `using(false)` **não bloqueia nada** — as escritas diretas do front funcionam. Elas dão falsa sensação de proteção. Torná-las RESTRICTIVE quebraria RH, orçamentos e outros caminhos que escrevem direto; decisão consciente de não mexer agora.

### Backlog restante
- ~~**P12:** refazer o CMV da DRE conforme §4c~~ → **feito em 2026-09-05** (§9d). Resta só o ajuste `+ Estoque inicial − Estoque final` da competência, que depende do snapshot mensal de estoque valorizado.
- **Fase 2 de compras:** catálogo de recorrentes ligado ao modal (lançamento rápido do dia a dia); pagamento em lote por fornecedor. ~~Listagem espelhando a aba "CM" da planilha~~ → **feito em 2026-09-05** (aba **Relatórios**, ver §9c).
- **Duplicação de modal de compra:** existem DOIS `NovaCompraModal` (`components/` usado pelo Estoque, `components/compras/` usado pelo Financeiro). Unificar — foi a divergência que escondeu o P9.
- **`GerenciarFornecedoresModal` órfão:** existe em `src/pages/estoque/components/` sem nenhum import. Fornecedor na compra é ligado por **nome** (`ilike`), não por FK.
- **P8:** padronizar limites de período (borda de 1h).
- **Cobertura de ficha técnica** (hoje 2,2%): continua importante — mas para o **CMV teórico / indicador de perda**, não para a DRE.
- **Bancos/income routing:** configurar para o saldo bancário e o P5 usarem dados reais.
- **Evolução P4:** reconciliação automática faturamento ↔ caixa recebido.

---

## 7b. Fluxo de caixa = projeção (2026-09-05)

**Decisão de produto.** Para a loja, "fluxo de caixa" é a pergunta *"quando vai
faltar dinheiro para honrar os compromissos?"*. O sistema tinha isso em uma aba
separada (`previsao`) enquanto a aba chamada "Fluxo de Caixa" mostrava só o
extrato do passado — o dono abria, via vazio ou irrelevante, e não achava a
projeção. As duas foram unificadas: `fluxo` abre na **Projeção**, com
**Calendário** e **Extrato** ao lado.

### P31 — `'overdue'` era tratado como se não fosse dívida  ✅ corrigido
A rotina `fn_mark_overdue_bills()` (chamada em todo `list_bills_payable`) troca
`status 'pending' → 'overdue'` assim que `due_date < CURRENT_DATE`. Mas a
projeção e o calendário filtravam contas em aberto por
`status IN ('pending','partial')` — ou seja, **descartavam exatamente as contas
atrasadas**, que são as mais urgentes.

Efeito medido em 2026-09-05: **100% das contas em aberto do banco inteiro
estavam em `'overdue'`** (9 contas, R$ 5.015,04; em EP Paranaguá, as 5 parcelas
do Chilli, R$ 1.361,04). A projeção mostrava **saída zero** e saldo saudável.

**Regra:** conta em aberto = `status <> 'paid'`. Nunca listar status "em aberto"
por enumeração positiva sem incluir `'overdue'`.

### P32 — compromisso vencido sumia da projeção  ✅ corrigido
Mesmo com o status certo, as queries tinham piso `.gte('due_date', hoje)` e o
calendário só somava previsão em dias `isFuture`. Uma conta vencida ficava
ancorada numa data passada e nunca entrava no acumulado.
**Regra:** compromisso em aberto com vencimento no passado é jogado em **HOJE**
(mesmo tratamento que a folha em atraso já tinha), rotulado "VENCIDA em dd/mm".
Vale para `fin_accounts_payable` e para `fin_receivable_installments` pendentes.
Corolário: **hoje faz parte do horizonte de projeção** (`isProjecao = isFuture || isToday`).

### P33 — saldo de abertura truncado em 1000 linhas  ✅ corrigido
`PrevisaoCaixaTab` e `CalendarioFluxoCaixa` somavam o razão anterior ao período
sem `.range()`; `list_bills_payable` idem. Todos passaram por `fetchAllRows`
(front) / laço de páginas (edge). Ver P30.

### P34 — data do dispositivo na projeção  ✅ corrigido
`PrevisaoCaixaTab` montava o horizonte com `new Date()` do navegador. Passou a
usar `todayBrasilia()`, o helper canônico (ver P27).

### O que a projeção mostra hoje
`Saldo atual` (banco real, ou razão acumulado como proxy) **+** recebíveis de
cartão pendentes (D+N) **−** contas a pagar em aberto (incluindo vencidas)
**−** folha pendente projetada no 5º dia do mês seguinte à competência,
acumulado dia a dia por 30/60/90 dias. O alerta nomeia **a data exata** em que o
saldo cruza zero e o **pior momento** do horizonte (menor saldo acumulado — o
caixa mínimo necessário para atravessar o período).

**Limite honesto, exibido na tela:** só entram compromissos **já lançados**.
Vendas futuras não são estimadas. Então a projeção é o pior caso "se não
entrar mais nada" — que é exatamente a leitura pedida.

---

## 8. Invariantes de reconciliação (para testes)
- Σ receitas por categoria (DRE) ≈ Σ `auto_sale`+`manual income` do período (quando bases unificadas).
- Σ `useTopDespesas` = saídas de `fin_cash_flow` no período (auto_purchase/bill/payroll excluídos por design).
- CMV teórico (`fn_get_cmv_report`) só é confiável com **cobertura de ficha técnica alta** (o report expõe `cobertura_pct`).
- Toda compra criada gera `stock_movements type='in'`; toda venda ready/delivered gera `theoretical_out` + `unit_cost`.
- Em `fin_purchase_items`: `total_price = quantity × (unit_price − discount_per_unit)` e `cost_per_base_unit = (total_price + freight_allocated) / (quantity × units_per_package)`. O `total_amount` da compra é **derivado** da soma dos itens + frete (calculado no `purchase-write`, não confiado ao front).
- Em `fin_accounts_payable`: `paid_amount` é **acumulado**; saldo devedor = `amount − paid_amount`; `status='paid'` só quando `paid_amount ≥ amount`.
- **Conta em aberto = `status <> 'paid'`** (`pending`, `partial` E `overdue`). Σ das saídas previstas do horizonte da projeção deve bater com Σ(`amount − paid_amount`) das contas em aberto com `due_date ≤ fim do horizonte`. Ver P31.

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

## 9c. Aba Relatórios de Compras (2026-09-05)

`compras/ComprasRelatoriosPanel.tsx`, ligado em `ComprasTab` como view `relatorios` (botão **Relatórios**, antes de "Por Fornecedor"/"Por Centro de Custo", que continuam existindo e trabalham no nível da COMPRA).

- **Nível do ITEM** (`fin_purchase_items`), não da compra: é o que permite agrupar por **categoria de mercadoria**. Valor da linha = `total_price + freight_allocated` (custo real, frete rateado incluso). Por isso o total do painel pode diferir em centavos da soma de `total_amount` quando o frete não foi rateado por item.
- **Categoria do item:** `item.merchandise_category_id` → senão `ingredients.merchandise_category_id` do insumo ligado → senão **"Sem categoria"** (KPI vermelho clicável que filtra os itens para classificar). Insumos são lidos com `fetchAllRows` (id, name, unit, categoria).
- **Chave de item:** `ingredient_id` quando existe; senão a descrição normalizada (sem acento/caixa). Itens sem insumo com descrição igual se juntam.
- **Período:** mês atual / anterior / 3-6-12 meses / ano / personalizado, sempre comparado ao **período anterior de mesma duração** (▲ vermelho = gastou mais). Filtros: busca, categoria, fornecedor, status de pagamento.
- **Agrupamento:** Categoria / Fornecedor / Insumo / Mês → expande para itens (qtd em unid. de estoque, custo médio, **último custo** destacado quando ≥5% fora da média, mín–máx, nº compras) → expande para as compras individuais (link abre `DetalhePurchaseModal` via prop `onOpenPurchase`).
- **Matriz Categoria × Mês** (espelho da aba "CM" da planilha) + gráfico empilhado (top 7 categorias + "Outras") só quando o período tem 2+ meses.
- **CSV** de itens com os filtros aplicados (`Compras_itens_<from>_<to>.csv`, `;`, BOM, decimal com vírgula).
- Teste de fumaça: `src/test/components/comprasRelatoriosPanel.test.tsx`. **Pegadinha corrigida no `vite.config.ts`:** o alias `@` do Vitest usava `new URL(...).pathname`, que devolve `%20` no espaço do caminho do projeto — NENHUM teste com `@/` rodava no Windows. Agora usa `resolve(__dirname, "src")`. Com isso a suíte voltou a rodar e expôs 15 falhas pré-existentes (`dateUtils`, `orderFlow`, `mesaQRFlow`), não relacionadas a compras.

## 9d. CMV da DRE = compras realizadas (2026-09-05)

Decisão reafirmada pelo dono e implementada. Fecha o P2/P12.

- **Regra:** o CMV da DRE é o que foi **comprado** no período. O CMV por ficha técnica é **teórico** e não entra no resultado; segue calculado (`fetchCmvConsumo`/`fetchCmvConsumoComp`) e aparece só como comparativo no aviso sob a linha do CMV. `CMV real − CMV teórico = perda do período` continua sendo a leitura gerencial.
- **Helper compartilhado `src/lib/comprasDRE.ts`.** `fetchComprasDRE(tenantId, purchases)` devolve `{ cmv, despesasPorCategoria, total }`. Usado pelos dois regimes do `DRETab` e do `DREComparativoTab`, para os dois não divergirem de novo.
- **Split exclusivo (é o que impede o P23 de voltar):** item de compra cuja categoria DRE é do grupo `expense` vai para a **despesa** daquela categoria; **todo o resto** (sem categoria, ou categoria de custo) vai para o **CMV**. Nunca os dois. Invariante testado: `cmv + Σ despesas === total` (`src/test/lib/comprasDRE.test.ts`).
- **Só `expense` sai do CMV, de propósito.** Os grupos `tax`/`revenue` não são somados em lugar nenhum da DRE; mandar um item para lá faria o valor **sumir** do resultado.
- **Compra sem itens lançados** entra pelo `total_amount` dela, em CMV (antes o fallback era global: só valia se NENHUMA compra do período tivesse item).
- **P30 (continuação):** a query de `fin_purchase_items` da DRE puxava **todos** os itens do tenant, sem paginação nem filtro de período, e truncava em ~1000 linhas sem erro. Agora é filtrada por `purchase_id` (em lotes de 150 ids) e paginada com `fetchAllRows`. Como os itens viraram a base do próprio CMV, esse truncamento passaria a subnotificar o resultado.
- **Limitação conhecida (herdada):** no regime de caixa o filtro das compras é `payment_status in ('paid','partial')` **por `purchase_date`**, não pela data do pagamento. Uma compra parcial entra pelo valor cheio. Corrigir isso é trabalho à parte.

---

## 9e. Catálogo de compras: as duas funções agora são explícitas (2026-09-05)

`compras/CatalogoComprasModal.tsx`. A janela fazia dois trabalhos sem dizer qual era qual: o texto prometia "itens de limpeza/embalagem com classificação no DRE" e o formulário oferecia vínculo com estoque, que é coisa de apresentação de fornecedor.

- **Escolha de tipo no topo do formulário.** `tipo` não é coluna: é derivado de `ingredient_id` estar preenchido.
  - **Não entra no estoque** (limpeza, embalagem, escritório): mostra **Classificação DRE**, esconde o vínculo. É o que faz o valor sair do CMV e virar despesa (§9d).
  - **Entra no estoque** (apresentação de fornecedor de um insumo): mostra **insumo + embalagem**, esconde a classificação DRE e grava `dre_category_id = null`. Item de estoque é sempre CMV; oferecer outra classificação seria uma promessa que a conta não cumpre.
- **Categoria de mercadoria entrou no catálogo.** `fin_purchase_catalog.merchandise_category_id` existia mas **nenhuma UI preenchia** (era o pendente registrado em §8b). Sem ela, item que não é de estoque caía permanentemente em "Sem categoria" nos relatórios de compras: o servidor só herda a categoria pelo insumo vinculado, e esse item não tem insumo. Não precisou de migração nem de deploy da Edge Function: a coluna já existia e `upsert_purchase_catalog` repassa o payload inteiro.
- **Duplicata no seletor de compra resolvida.** `compras/NovaCompraModal` montava a lista como catálogo + insumos, então um insumo com apresentação aparecia **duas vezes**, em seções diferentes e com comportamento diferente (pela seção "Insumos" perdia-se a embalagem do fornecedor). Agora o insumo que já tem apresentação some da seção "Insumos". A embalagem segue editável na linha, para a compra do dia que vier em caixa diferente.
- **Obrigatoriedades honestas:** o asterisco de "Classificação DRE" era decorativo (o salvamento só exigia o nome) e sumiu, porque vazio tem significado real (= CMV). No tipo "entra no estoque" o **insumo** virou obrigatório de verdade, com o botão desabilitado.
- Testes: `src/test/components/catalogoComprasModal.test.tsx` cobre os dois modos e o payload gravado em cada um.

---

## 9. Tabelas do módulo (schema `public`)
`fin_cash_flow`, `fin_accounts_payable`, `fin_receivable_installments`, `fin_anticipations`, `fin_purchases`, `fin_purchase_items`, `fin_purchase_catalog`, `fin_merchandise_categories`, `fin_suppliers`, `fin_cost_centers`, `fin_dre_categories`, `fin_bank_accounts`, `fin_bank_transactions`, `fin_bank_statement_imports`, `fin_bank_statements`, `fin_reconciliation_rules`, `fin_budgets`, `fin_budget_items`, `fin_income_routing`, `fin_investment_settings`, `fin_implementation_costs`, `fin_implementation_columns`, `fin_stone_config`, `fin_stone_imports`, `fin_pix_payments`, `fin_payable_aging`(view), `fin_receivable_aging`(view), `hr_employees`, `hr_payroll`, `hr_payroll_custom_fields`.

RPCs relevantes: `fn_get_cmv_report`, `fn_bank_credit`, `fn_bank_debit`, `fn_record_payment_bypass`, `fn_update_ingredient_price_from_purchase`, `fn_update_ingredient_stock`.
Edge Functions: `financial-write` (~47 actions), `purchase-write`, `purchase-confirm-delivery`, `stone-conciliation`, `pix-payment`, `implementation-write`, `order-write` (integração de venda).

### Unidades de compra × estoque e apresentações (2026-08-26)

**Princípio:** o estoque de cada insumo vive numa ÚNICA unidade base (`ingredients.unit` — kg, un, L). Caixa/fardo/pote são linguagem de **compra**; a linha da compra faz a tradução.

**Embalagem desdobrada** (`fin_purchase_items.pack_count` × `pack_size`): "cx 12×1,5kg" entra como 12 e 1,5 — o sistema calcula `units_per_package = 18` (kg por cx), que segue sendo a verdade para entrada de estoque e `cost_per_base_unit`. `pack_size` vazio = 1 (a unidade interna já é a de estoque). Motivo: o campo único obrigava conta de cabeça e induzia erro em embalagens de meio quilo (cx 9×0,5kg era digitada como 9 em vez de 4,5).

**Apresentações no catálogo** (`fin_purchase_catalog.ingredient_id` + `purchase_unit` + `pack_count`/`pack_size`): o catálogo virou catálogo de SKUs por fornecedor. Duas apresentações ("Requeijão — Forn. A (cx 12×1,5kg)" e "Requeijão — Forn. B (cx 6×1kg)") apontam para o MESMO insumo; escolher uma no modal de compra preenche insumo, embalagem, categoria e fornecedor de uma vez. FK tenant-safe `(ingredient_id, tenant_id) → ingredients(id, tenant_id)` (novo unique `ingredients_id_tenant_uk`).

**Auto-cadastro:** `purchase-write` (`upsertCatalogPresentations`) cria a apresentação automaticamente em toda compra com insumo + fornecedor + embalagem desdobrada (dedup por insumo+fornecedor+pack). O catálogo se constrói sozinho com o uso. Falha nesse passo nunca derruba a compra.

**Sincronização de tela:** o `EstoqueContext` é global e confiava só no Realtime — que fica MUDO para admin multi-loja (RLS `get_user_tenant_id()` = última membership). `ComprasTab` agora chama `reloadInsumos()`/`reloadMovimentacoes()` após criar/editar/excluir/receber compra.

Migration: `supabase/migrations/purchase_pack_breakdown_and_catalog_sku.sql` (aplicada via função temporária — MCP fora do ar).

### Edição de compra (`update_purchase`, 2026-08-26)

`purchase-write` ganhou a action `update_purchase`, ao lado de `create_purchase`/`delete_purchase`. A lógica de cálculo (custo por item, resolução de fornecedor, herança de categoria, entrada de estoque, geração de contas a pagar) foi extraída para funções compartilhadas (`computePurchaseItems`, `resolveOrCreateSupplier`, `inheritMerchandiseCategories`, `applyStockAndPricing`, `reverseStockForItems`, `createBillsForPurchase`) — create e update chamam as mesmas, para não duplicar bug.

**Guarda de segurança:** só edita quando a compra original **não teve nenhum efeito colateral ainda** — nem recebimento confirmado (`delivery_confirmed_at`), nem qualquer pagamento registrado (`payment_status='paid'` na criação, ou qualquer `fin_accounts_payable` vinculada com `status='paid'`/`paid_amount>0`). Fora dessas condições, `update_purchase` devolve **409** com mensagem explicando; o front orienta a excluir e lançar de novo (a exclusão já reverte estoque/contas corretamente).

Quando aceita: estorna o estoque da versão antiga (`manual_out`), apaga as contas a pagar/caixa antigas (nenhuma tinha pagamento, garantido pela guarda) e os itens antigos, e recria tudo com os dados novos — mesmo caminho do `create_purchase`.

Front: `ComprasTab.tsx` tem botão de editar (lápis) na coluna Ações — checa a elegibilidade (via `fin_accounts_payable` do `reference_id`) antes de abrir o modal; se bloqueado, mostra banner explicando por quê. `compras/NovaCompraModal.tsx` ganhou os props `editingPurchase`/`editingInstallments` para pré-preencher o formulário. Hook `usePurchases` ganhou `update(id, payload, auditFn)`.
