# Plano — Conciliação automática (extrato × notas de entrada × contas)

> Criado em 2026-09-10. Referência viva do módulo: `FINANCEIRO_MAP.md` (§9j Inter, §9k Stone).
> Loja piloto: El Patron Paranaguá (única com Inter conectado).

## 1. Onde estamos (medido no banco em 2026-09-10)

| Item | Valor |
|---|---|
| Extrato Inter importado | 59 linhas (03/09 a 10/09), 0 conciliadas |
| Notas de entrada da loja | 137 (desde 13/06), 45 com parcelas, **0 importadas** |
| Contas a pagar da loja | 5, todas abertas, todas de compra |
| Fornecedores | 31, **nenhum com CNPJ** |
| Recebíveis de cartão | 0 |

**O que já funciona:** match por valor + data contra `fin_bank_transactions` e `fin_cash_flow`, regras por texto da descrição.
**O que falta:** conciliar não lança nada (só marca a linha), conta a pagar não tem vínculo com fornecedor nem com a nota, e os dados ricos do extrato (`raw.detalhes`) não são usados.

### Teste de viabilidade com os 9 boletos pagos na semana

| Boleto | Pago | Nota encontrada | Como bateu |
|---|---|---|---|
| Copal Alimentos | 307,39 | parcela 307,39 venc. 07/09 | vencimento + valor |
| Bebidas Nova Geração | 622,44 | parcela 622,44 venc. 05/09 | vencimento + valor |
| Encarta Embalagens | 555,11 | parcela 542,48 venc. 02/09 | vencimento + valor de face (pago com R$ 12,63 de juros) |
| Voxy SC | 525,60 | NF 3540, total 525,60 | valor total + nome (nota sem parcelas) |
| Sequoia Alimentos | 642,99 | NF 1514, total 642,99 | valor total + nome |
| Alvino Embalagens | 187,95 | NF 787, total 187,95 | valor total + nome |
| Estação Litoral | 3.823,54 (face 4.226,02) | — | aluguel/condomínio: conta recorrente |
| Josiane F. Silva (2×) | 347,04 (face 330,00) | — | pessoa física, recorrente semanal, com juros |

**6 de 9 boletos têm nota correspondente e dá para achar sozinho.** Os 3 restantes são despesas recorrentes sem NF-e.
Os Pix enviados foram quase todos para CPF (pessoas); nenhum CNPJ de Pix bateu com nota nesta semana.

### Pegadinha descoberta
No **boleto**, o `cpfCnpj` do extrato é o **da própria loja** (pagador), não do beneficiário. O beneficiário vem só como nome (`nomeDestinatario`). O valor de face e o vencimento estão no código de barras (últimos 10 dígitos ÷ 100) e em `dataVencimento`. Juros aparecem em `adicionado`.
No **Pix**, `cpfCnpjRecebedor` é confiável.

## 2. Motor de correlação (níveis de confiança)

Cada linha do extrato recebe **um vínculo** e **um nível**. Só o nível `exato` pode ser confirmado em lote.

| Nível | Regra | Exemplo |
|---|---|---|
| **exato** | Boleto: `dataVencimento` = vencimento da parcela **e** valor de face = valor da parcela (±0,05) | Copal, Bebidas, Encarta |
| **exato** | Pix: CNPJ recebedor = CNPJ emitente (ou mesma raiz de 8 dígitos) **e** valor = total/parcela **e** até 60 dias após a emissão | — |
| **exato** | Conta a pagar aberta com o mesmo código de barras | futuro, quando a conta guardar a linha digitável |
| **forte** | Boleto: nota sem parcelas com total = valor de face, nome do destinatário parecido com o emitente (similaridade ≥ 0,5), emissão 0–60 dias antes | Voxy, Sequoia, Alvino |
| **forte** | Conta a pagar aberta do mesmo fornecedor (CNPJ ou nome), saldo = valor, vencimento ±5 dias | — |
| **provável** | Só valor + data (regra atual) ou mais de um candidato empatado | — |
| **regra** | Sem documento; regra por CNPJ/CPF ou texto classifica a categoria | aluguel, freelas |

Regras de segurança:
- Uma parcela/nota/conta só pode ser vinculada **uma vez**. Empate entre candidatos rebaixa para `provável`.
- Diferença entre pago e face vira **juros/multa** (ou desconto) explícito, nunca some.
- Nota cancelada na SEFAZ (`sefaz_status=2`) nunca é candidata e gera alerta se estiver paga.

Quando roda (sem cron, conforme decisão do dono):
1. No sync do Inter (linhas novas), como hoje.
2. Botão **"Reprocessar vínculos"** na Conciliação, para linhas pendentes (a nota às vezes chega depois do pagamento).
3. Ao importar uma nota em Notas de Entrada: procura pagamento já existente no extrato (sentido inverso).

## 3. Fases

### Fase 0 — Base de dados (migration)
- `fin_accounts_payable`: `supplier_id`, `fiscal_document_id`, `barcode` (linha digitável).
- `fin_bank_statement_imports`: `match_kind` (`payable` | `receivable` | `inbound_doc` | `bank_transaction` | `cash_flow` | `rule`), `match_ref_id`, `match_confidence`, `counterpart_doc`, `counterpart_name`, `face_value`, `due_date`, `interest_amount`.
- Backfill dessas colunas a partir de `raw.detalhes` nas linhas existentes.
- Backfill do CNPJ em `fin_suppliers` a partir das notas (casando por nome), e `supplier_id` nas contas a pagar existentes.
- Grants para `service_role` nas colunas/tabelas novas.

### Fase 1 — Motor na edge
- Módulo compartilhado de matching usado por `inter-bank` (sync) e por uma ação nova `rematch` (botão).
- Ação `find_payment` em `fiscal-inbound` para o sentido nota → extrato.
- Teste de aceitação: os 6 boletos da tabela acima saem vinculados, com os níveis indicados, e Encarta com R$ 12,63 de juros.

### Fase 2 — Conciliar = lançar
Nova ação `confirm_statement_match` em `financial-write`, atômica, por tipo de vínculo:
- **Conta a pagar** → `pay_bill` com valor da parcela, data do extrato e conta Inter; juros viram lançamento de despesa financeira.
- **Nota ainda não importada** → importa como **compra paga** (mantém a regra do CMV) e já baixa a parcela.
- **Recebível** → liquida a parcela.
- **Regra sem documento** → lança despesa/receita no fluxo com a categoria da regra.
- Ação inversa `undo_statement_match` que **estorna** o que foi lançado (hoje "desconciliar" só desmarca a linha). Sem estorno, a confirmação não é liberada.
- Botão "Confirmar todos os exatos" em lote.

### Fase 3 — Tela da Conciliação
- Coluna **Vínculo** com o documento (nota nº, fornecedor) e selo de confiança.
- Detalhe da transação mostra a nota (itens, XML/PDF) e a diferença de juros.
- Filtros: "Exatos a confirmar", "Sem documento", "Divergências".
- Regras passam a aceitar CNPJ/CPF, e conciliar manualmente oferece "Criar regra para este CNPJ/CPF".
- Sugestão de conta recorrente para pagamentos repetidos sem nota (Estação Litoral, Josiane).

### Fase 4 — Alertas de confiabilidade (painel na Conciliação)
- Parcela de nota vencida sem pagamento no extrato.
- Pagamento a CNPJ sem nenhuma nota nos últimos 60 dias (compra sem NF, afeta CMV).
- Juros pagos no mês (dinheiro perdido com atraso).
- Possível pagamento em duplicidade (mesmo destinatário, mesmo valor, ≤ 3 dias).
- Nota cancelada na SEFAZ que foi paga ou importada.
- Saldo do ERP × saldo real do Inter (já temos `synced_balance`).

### Fase 5 — Entradas (depois)
- `DOMICILIO_CARTAO` do Inter × API da Stone agrupada por dia (depende de configurar a chave da Stone).
- Pix recebido de cliente × pagamentos Pix dos pedidos (valor + horário).
- Observação: a loja tem 0 recebíveis de cartão, então as formas de pagamento de cartão estão com `days_to_receive = 0`. Precisa rever antes desta fase.

### Fase 6 — APIs novas (opcional)
- **Inter Pagamentos:** pagar boleto/Pix a partir da conta a pagar; a conciliação já nasce fechada e o código de barras fica gravado. Exige integração nova no Inter com novo certificado.
- **Brasil NFe:** manifestação conclusiva (confirmar operação / desconhecer nota emitida indevidamente).
- **BrasilAPI CNPJ** (grátis): razão social e situação cadastral ao criar fornecedor.

## 4. Decisões pendentes do dono
1. Vínculos **exatos**: confirmar e lançar sozinhos, ou sempre com um clique em "Confirmar todos os exatos"? (Recomendação: clique em lote.)
2. Pagamento que bate com nota **ainda não importada**: importar automaticamente como compra paga, ou só sugerir?
3. Pix para CPF (freelas, motoboys, funcionários): qual categoria da DRE usar?

## 5. Ordem recomendada
Fases 0 → 1 → 2 → 3 são a primeira entrega útil (nota × pagamento funcionando de ponta a ponta). Fase 4 logo depois. Fases 5 e 6 dependem de configuração externa.
