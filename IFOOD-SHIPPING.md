# iFood Entrega (Shipping / Sob Demanda) no ERPOS

Entregador do iFood para pedidos de **delivery do próprio ERPOS** (link do delivery, caixa, WhatsApp).
Começou em 2026-09-26. Não confundir com a integração financeira (`ifood-financial`, app "ERPOS").

## Apps no Portal do Desenvolvedor

O iFood cria apps **por categoria**; a categoria define os módulos e não muda depois.

| App | Categoria | Módulos | Uso |
|---|---|---|---|
| ERPOS | Finanças | Financial, Merchant | Conciliação (homologado 2026-09-25) |
| ERPOS PDV | PDV | Shipping, Events, Merchant, Catalog, Review, Analytics (sem Order) | Este documento. "Em desenvolvimento" até a homologação do Shipping |

Cada app tem Client ID/Secret e autorizações próprias; cada loja autoriza cada app no Portal do Parceiro.
Order (receber pedidos do iFood no ERPOS) ficou de fora por decisão do dono e exigiria outro app.
Webhook só existe em app Centralizado; aqui é polling.

## Peças

- Migration `supabase/migrations/20260926150000_ifood_shipping.sql`
  - `ifood_pdv_config` (1 por loja; segredos — só service_role), `ifood_pdv_auths` (token por autorização)
  - `ifood_shipping_orders` (entrega pedida; SELECT por vínculo `auth_is_member_of`) — no máximo 1 ativa por pedido (índice único parcial)
  - `ifood_pdv_events` (dedup por `event_id` + log de 30 dias, critério de homologação)
  - cron `ifood-shipping-poll` a cada 30 s → `fn_ifood_shipping_poll()` (pg_net assíncrono; sem entrega ativa e fora da homologação não chama nada)
- Edge `supabase/functions/ifood-shipping/index.ts` (ações no cabeçalho do arquivo)
- Front: `src/lib/ifoodShipping.ts`, Gestor de Entregas › botão **iFood Entrega** (config) e botão **iFood** no card (`IfoodEntregaModal`)

## Fluxo

1. Card do Gestor de Entregas › **iFood** → `prepare` monta o formulário: endereço estruturado vem de
   `delivery_customer_addresses` (o mais perto do pino do pedido), cidade/UF de `tenants`, CEP pelo ViaCEP
   (UF/cidade/rua; escolhe a faixa do bairro), telefone de `orders.destination_phone`, pagamento de `orders.notes`.
2. **Ver preço e prazo** → `quote` (`GET shipping/v1.0/merchants/{m}/deliveryAvailabilities`). Custo = `quote.netValue`.
3. **Chamar entregador** → `create` (`POST shipping/v1.0/merchants/{m}/orders`). `merchantFee` = taxa de entrega do pedido;
   itens somam `total − taxa` (se não baterem por desconto/voucher, vai uma linha só "Pedido #N").
   Pagamento: já pago → sem `payments`; na entrega → OFFLINE CASH/CREDIT/DEBIT com `value = total` (o entregador do iFood cobra).
4. Polling (30 s) aplica os eventos na entrega e no pedido do ERPOS (mesmos campos do `motoboy-signal`):
   ASSIGN_DRIVER/GOING_TO_ORIGIN → `a_caminho_loja`; DISPATCHED/IN_TRANSIT → `coletou`; CONCLUDED → pedido entregue;
   CANCELLED/REQUEST_DRIVER_FAILED → libera o pedido e grava um "problema" para a loja chamar outro entregador.
   DELIVERY_DROP_CODE_REQUESTED → código de entrega; DELIVERY_ADDRESS_CHANGE_REQUESTED → aceitar/recusar no modal (15 min).
   Entrega encerrada não é reaberta por evento atrasado.
5. Cancelar: motivos sempre de `/cancellationReasons` (proibido fixar no código).

## Critérios de homologação (resumo da doc do iFood)

Polling a cada 30 s + acknowledgment imediato + dedup por eventId; pedidos Sob Demanda (DELIVERY/IMMEDIATE/POS);
confirmação de pedidos; cancelamento com motivos dinâmicos; reagir a cancelamento pelo iFood/cliente; aceitar/recusar
troca de endereço no prazo; **código de coleta** (conferir com o entregador); renovar token antes de vencer; backoff 2x
com jitter (3–5 tentativas); idempotency-key em operações que mudam estado; logs com orderId/eventId por 30 dias;
alertas (> 5 falhas seguidas de polling). Submissão: descrever como cada critério é atendido + logs + métricas.

## Pagamento cobrado pelo entregador (decisão do dono, 2026-09-26: automático)

Cliente paga ao entregador do iFood (dinheiro/cartão) → o valor vem no **repasse do iFood**, não na gaveta. No
CONCLUDED o pedido é pago com a forma **"iFood Entrega"** (`payment_methods` type `other`, criada sozinha na 1ª vez,
`fiscal_code` 99, `days_to_receive` 7 → vira **a receber** em `fin_receivable_installments`), `paid_by_pdv =
'ifood_shipping'`, NFC-e pela fiscal-write se a loja emite. Mesmo caminho do Pix pelo app (`fn_record_payment_bypass`,
que exige caixa aberto na sessão do pedido — sem caixa, fica a observação para dar baixa à mão). Idempotente.
Teste: ação interna `simulate_event` (só com homologação ligada) — testado na Testes PDV (pagamento, a receber, nota
no pedido, evento repetido não duplica).

## Proteções (revisão 2026-09-26)

- POST que chama/cancela entregador vai **uma vez só** (5xx pode ter sido aceito); só GET, token e ack repetem.
- `create` **reserva a linha antes** do POST (índice único = trava contra 2 cliques/2 abas); resposta 5xx/queda →
  `failed` + `uncertain` e o modal exige "conferi no Gestor de Pedidos do iFood" antes de "Chamar de novo".
- Entrega sem notícia há 6 h vira `failed`/`uncertain` (cron) — não trava o pedido nem segura o polling.
- Homologação liga por 24 h (`homologation_until`); job diário limpa `cron.job_run_details` > 3 dias.
- Evento que falha ao aplicar não recebe ack (volta na próxima rodada); notas não duplicam.
- Pedido com motoboy da loja não vai ao iFood, e pedido com iFood ativo some da lista do motoboy (`motoboy-signal` → `com_ifood`).
- Contabilidade (accountant) não chama/cancela; trocar app/loja/desligar é recusado com entrega ativa.
- Gestor mostra faixa vermelha para entrega iFood ativa de pedido que saiu do quadro (ex.: cancelado no ERPOS).
- Testes: `src/test/edge/ifoodShipping.test.ts` (regras puras em `supabase/functions/ifood-shipping/core.ts`).

## Em aberto (conferir no teste com a loja de teste 4117700)

- Se o evento PLACED de pedido Sob Demanda precisa de confirmação: a edge tenta `order/v1.0/orders/{id}/confirm`
  (pode dar 403 sem o módulo Order — ver o log do evento).
- Onde vem o `pickupCode` (metadata do evento? detalhe do pedido?). Hoje lê `metadata.pickupCode`.
- Nomes exatos dos campos do entregador na metadata (`workerName`/`workerPhone` assumidos).
- Se o polling precisa de `categories`/`types` para trazer os eventos de pedidos POS.
- Financeiro: o custo do iFood (`ifood_fee`) e o dinheiro cobrado pelo entregador entram no repasse; casar com o
  relatório de conciliação do app financeiro.
- **Loja de teste não suporta Entrega iFood** (FAQ do portal): sem alocação nem eventos em teste. O 1º teste real depende
  do app autorizar uma loja real (provavelmente só após a homologação).
- NFC-e do pagamento "iFood Entrega" (tPag 99, descrição "iFood Entrega") ainda não foi emitida de verdade: a loja
  Testes PDV não tem fiscal ligado. Conferir na 1ª entrega real de uma loja com NFC-e.
- Se o relatório financeiro do iFood (app ERPOS) trouxer as cobranças do Sob Demanda como crédito do repasse, conferir
  que não soma em dobro com a fonte "pedidos" (hoje são produtos separados).
