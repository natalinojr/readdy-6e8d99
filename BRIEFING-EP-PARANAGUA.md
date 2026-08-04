# Briefing — Auditoria EP Paranaguá → requisitos para o ERPOS

> Documento de contexto gerado a partir de uma sessão de consultoria financeira sobre a loja
> **El Patrón Paranaguá** (shopping Estação Mall), analisando abril–julho/2026.
> Serve para abrir uma nova sessão no ERPOS já sabendo **o que precisa ser construído e por quê**.
> Última revisão: 2026-08-03.

---

## 1. A loja e as fontes de dados

Franquia El Patrón (mexicano), praça de alimentação de shopping, aberta em **abril/2026**
(março foi pré-operacional). Existe uma unidade irmã (EP Ipanema) com transferências de caixa.

Cinco fontes de dados que **não conversam entre si** — essa é a raiz de quase todo problema:

| Fonte | O que tem | Formato hoje |
|---|---|---|
| **TOTVS** | Vendas por produto (inclui dinheiro) | Export XLSX manual |
| **Goomer** | Totem/delivery, painel web | Export manual, **incompleto** |
| **Stone / maquininha** | Dinheiro que entra, por forma de pagamento | Lançado à mão na planilha |
| **Planilha Financeira V3** | Compras, despesas, folha, impostos, DRE | Excel, 29 abas |
| **Banco (Itaú)** | Extrato | CSV manual |
| **Contagem de estoque** | Contagem física semanal/mensal | Excel separado |
| **Ficha técnica** | Custo por prato | Excel separado |
| **Caderno de saída** | Retirada diária do freezer | **WhatsApp** |

---

## 2. Números estabelecidos (use como baseline / caso de teste)

### DRE por competência

| | Abril | Maio | Junho | Julho |
|---|---:|---:|---:|---:|
| Receita total | 42.188 | 42.518 | **37.715** | **60.322** |
| CMV real | 36,4% | 29,8% | **46,2%** | **34,9%** |
| Resultado | +2.937 | +3.100 | **−2.996** | **+10.114** |
| Compras / receita | 34,5% | — | **52,9%** | 33,8% |

### CMV teórico × real (calculado: vendas TOTVS × ficha técnica + CMV iFood da planilha)

| | Junho | Julho | Bimestre |
|---|---:|---:|---:|
| CMV teórico | ~35,6% | ~36,3% | ~36,0% |
| CMV real | 46,2% | 34,9% | 39,3% |
| **Fator (real ÷ teórico)** | **1,30** | **0,96** | **1,09** |

**Leitura:** junho é anomalia, julho é normal, o bimestre roda em 1,09 — dentro do padrão.
A oscilação vem de **calendário de compra**, não de desperdício: junho comprou 52,9% da receita
e empilhou R$ 2.508 de estoque; julho comprou 33,8% e queimou R$ 693.

### Fatores de consumo verificados em junho (real ÷ teórico)

| Família | Fator | Método |
|---|---:|---|
| Proteínas El Patron (11 itens) | **1,09** | Contagem semanal × ficha × TOTVS |
| Caderno da cozinha (mesma base) | **1,11** | Registro diário WhatsApp |
| Bebidas engarrafadas | **1,09** | Contagem × compras × vendas |
| Mussarela (jun / jul / bimestre) | 1,26 / 1,11 / **1,18** | Contagem mensal |
| **Chope** | **2,08** | Barril fechado — 155,5 L sem venda |

**Três medições independentes convergindo em ~1,09 é a evidência mais forte da auditoria.**
O chope é o único desvio real que sobreviveu a todas as revisões.

---

## 3. Armadilhas metodológicas (não repetir)

Cada uma delas produziu uma conclusão errada que precisou ser corrigida durante a análise:

1. **Goomer não tem tudo.** Junho: R$ 26.765 no Goomer vs **R$ 35.619 no TOTVS**.
   Um "furo de R$ 6,9 mil entre maquininha e sistema" era só o painel incompleto.
   → *Nunca usar o Goomer como base de venda.*

2. **TOTVS não tem o iFood completo.** Julho: R$ 9.093 no DRE vs **R$ 2.126 lançados**.
   → *Somar o CMV do iFood à parte, ou o teórico nasce subestimado.*

3. **Data de pedido ≠ data de entrega.** Pedido de fim de mês distorce o consumo dos dois meses.
   → *A tabela de compras precisa de campo `data_entrega` separado de `data_pedido` e `data_pagamento`.*

4. **Mistura de bases de receita.** Percentuais por família calculados sobre a receita do TOTVS
   comparados com CMV real sobre a receita do DRE = número sem sentido.
   → *Fixar uma base de receita por relatório e declarar qual é.*

5. **Contagem gravada como texto.** `"5.750 kg"`, `"3,110 kg"`, `"697g"`, `"2 litros"` numa
   célula de texto fizeram 13 dos 51 itens desaparecerem de um parser numérico.
   → *Campo tipado (numeric) + unidade em coluna separada. Resolve sozinho no ERPOS.*

6. **Ficha técnica desatualizada.** O Bowl Básico usa gramagens próprias (chilli 150 g,
   frango 100 g) diferentes dos bowls prontos (200 g / 60 g). Preços de venda na ficha
   ainda em R$ 25,90.
   → *Ficha precisa de versionamento e data de vigência.*

7. **Estoque final subavaliado ≠ hipótese confirmada.** Valorizei os 51 itens contados em
   30/06 em ~R$ 7.809 contra R$ 7.293 lançados — diferença de 7%, dentro do ruído.
   O estoque estava certo; o excesso de junho é real.

---

## 4. O que o ERPOS já tem (e por que ele é a resposta certa)

Confirmado no código: **PDV, totem, KDS, estoque com ficha técnica, financeiro com 17 abas,
DRE em caixa E competência, contas a pagar/receber, conciliação Stone, multi-contas bancárias,
folha.**

O mais relevante: o sistema **já calcula os dois CMVs** —
- `theoretical_out` (baixa por ficha técnica a cada venda, com `order_items.unit_cost` como snapshot)
- CMV por compras (`fin_purchases`)

**O "fator de desperdício" que levamos um dia para reconstruir à mão é literalmente a razão
entre dois números que o ERPOS já produz.**

### Lacunas identificadas

| Problema da loja | ERPOS já tem | Falta |
|---|---|---|
| Venda fora do sistema | PDV/totem próprio | Loja usar como frente, ou importar TOTVS |
| Fator descoberto 40 dias depois | Os dois CMVs | **KPI + tela + alerta** |
| Contagem abandonada | Movimentação de estoque | **Tela de contagem física + variância** |
| Duas contas bancárias | `fin_bank_accounts` multi-conta | **Importador de extrato Itaú CSV** |
| Juros escondidos | `fin_accounts_payable` | **Campo juros/multa no `pay_bill`** (+ o P3 do próprio mapa: `pay_bill` não grava em `fin_cash_flow`) |
| Ficha técnica cega | Ficha existe | **Cobertura hoje ~2,2%** — carregar do Excel |
| Promo sem governança | Relatórios | **Alerta preço médio realizado × tabela** |

---

## 5. KPIs a implementar (fórmulas exatas)

Todos calculáveis com dados que o ERPOS já modela.

```
1. FATOR DE CONSUMO (o principal)
   fator = CMV_real / CMV_teórico
   CMV_real     = estoque_inicial + compras_recebidas − estoque_final
   CMV_teórico  = Σ (order_items.unit_cost × qtd) dos pedidos pagos não cancelados
   Meta: ≤ 1,10   |   Alerta: > 1,15   |   Crítico: > 1,25
   Granularidade: por insumo, por família, por período de contagem

2. VARIÂNCIA DE CONTAGEM (por insumo, por janela)
   consumo_real     = contagem_inicial + entregas_na_janela − contagem_final
   consumo_teórico  = Σ (ficha[insumo] × qtd_vendida) na janela
   variância_%      = (real − teórico) / teórico
   Sinal: variância ALTA e CONSTANTE = porção errada (corrige com balança)
          variância ALTA e PONTUAL   = evento (investigar data/turno)

3. CONCILIAÇÃO DIÁRIA
   venda_sistema (order-write) vs venda_maquininha (Stone) vs crédito_banco
   Alerta se |diferença| > 3% no dia
   (foi o gap de 20% em junho que sinalizou o problema)

4. COBERTURA DE ESTOQUE (dias)
   dias = estoque_atual / (consumo_médio_diário_últimos_30d)
   Alerta: < 5 dias (ruptura) ou > 40 dias (capital parado)
   Caso real: mussarela terminou julho com 5,7 dias; Del Valle pêssego com 47

5. COMPRAS / RECEITA (mensal)
   Alerta se > 40% — foi 52,9% em junho e distorceu o CMV do mês inteiro

6. PREÇO MÉDIO REALIZADO × TABELA (por produto)
   desvio = 1 − (venda_total / (qtd × preço_tabela))
   Alerta: > 10% — julho deu 6–21% de desconto na linha principal

7. CMV TEÓRICO POR FAMÍLIA
   Comida ~34% | Bebidas ~42% | Chope ~44%
   Bebida e chope são 24% da venda e rodam 10 pontos acima do que deveriam
```

---

## 6. Plano sugerido — Fase 1 (ERPOS como cérebro de gestão)

A loja continua operando no Goomer/Stone. Zero risco operacional.

1. **Carga das fichas técnicas** a partir de `CUSTO PRODUTO VENDIDO.xlsx`
   → resolve a cobertura de 2,2% e destrava o CMV teórico
2. **Importador de CSV**: TOTVS (vendas por produto), extrato Itaú, Stone
3. **Tela de contagem física** + relatório de variância (KPIs 1 e 2)
4. **Juros/multa no contas a pagar** + correção do P3 (`pay_bill` sem `fin_cash_flow`)
5. **Dashboard com os 7 KPIs** acima

Só depois, Fase 2: ERPOS assume a frente de venda. Pré-requisitos a responder antes —
**emissão fiscal (quem faz a NFC-e hoje?)** e troca de hardware/treino da equipe.

---

## 7. Ganho financeiro estimado (para priorizar)

| Ação | R$/mês |
|---|---:|
| Resolver o chope (155 L em junho) | 1.700–2.000 |
| Reprecificar bebida + chope (CMV 42–44% → 32%) | ~900 |
| Porção do sour cream / molho 4 queijos | ~220 |
| Cancelar Goomer (se ERPOS assumir) | 630 |
| Cancelar TOTVS (se ERPOS assumir) | 480 |
| Juros e multas evitados | ~250 |

Contexto: o resultado acumulado da loja em 5 meses foi **R$ 4.235**. Os itens acima somam
mais que isso por mês.

---

## 8. Arquivos de referência

Ficaram em `D:\dev\Análise DRE\`:

- `CLAUDE PLANILHA FINANCEIRA - EP PARANAGUÁ - V3.xlsx` — 29 abas, DRE caixa + competência
- `CUSTO PRODUTO VENDIDO.xlsx` — ficha técnica (13 abas por categoria)
- `Levantamento de estoque - 2026.xlsx` — contagens (jun: 01, 09, 16, 23, 30; jul: 31)
- `VEndas junho TOTVS.xlsx` / `VEndas julhoo TOTVS.xlsx` — vendas por produto
- `Extrato-01-04-2026-a-31-07-2026-CSV.csv` — extrato Itaú (na prática começa em 06/05)

Painel visual da auditoria de junho:
https://claude.ai/code/artifact/ef0ee727-862e-47c1-b794-9559e537b27a
