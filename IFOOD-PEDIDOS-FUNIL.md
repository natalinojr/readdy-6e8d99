# Pedidos do iFood no funil do ERPOS — desenho (2026-09-27, aguardando aprovação do dono)

Objetivo: o pedido do iFood vira um pedido normal do ERPOS (cozinha/KDS, Gestor de Pedidos, Gestor de Entregas,
estoque, NFC-e) e cada mudança de status é avisada ao iFood. Vale para **qualquer loja**, ligado por configuração.
Base já pronta: `ifood_orders`/`ifood_order_items` + polling de 30 s no servidor + ações do iFood (confirmar, preparo,
pronto, despachar, cancelar, disputa) na edge `ifood-shipping` (ver `IFOOD-MODULOS-HOMOLOGACAO.md`).

## Decisões do dono (2026-09-27)
- ERPOS emite a NFC-e dos pedidos do iFood (Paranaguá não emite hoje) — **opção por loja**.
- Não é piloto por loja: recurso genérico, cada loja liga na configuração.
- Confirmação automática ou manual = **configuração da loja**.

## Configuração por loja (`ifood_pdv_config`)
- `order_mode`: `read_only` (hoje) | `funnel` (novo: pedido entra no ERPOS e o ERPOS avisa o iFood).
  `operate` (botões manuais na tela Pedidos iFood) continua só para a loja de teste/homologação.
- `order_auto_confirm` (bool): confirma sozinho ao chegar; desligado → pedido espera "Aceitar" no Gestor de Pedidos.
- `order_emit_nfce` (bool): emitir NFC-e dos pedidos do iFood (exige `fiscal_settings.enabled` da loja).
- Só funciona em loja real depois do Order homologado no iFood (app em desenvolvimento não autoriza loja real).

## Fluxo
| ERPOS | Ação no iFood |
|---|---|
| PLACED chega (polling) → cria o pedido do ERPOS | — |
| auto_confirm ligado: já entra em preparo (tickets na cozinha) | `confirm` na hora |
| auto_confirm desligado: fica "aguardando aceite" (tipo o pedido Pix retido, `is_draft`) com contagem do prazo | — |
| "Aceitar" no Gestor de Pedidos → libera cozinha | `confirm` |
| "Recusar" → escolhe motivo da lista do iFood | `requestCancellation` |
| 1º item começa na cozinha (`started_preparing_at`) | `startPreparation` |
| todos os itens prontos | `readyToPickup` |
| saiu com motoboy da loja (`out_for_delivery_at`) — só `delivered_by = MERCHANT` | `dispatch` |
| cancelar no ERPOS → **pede** cancelamento com motivo do iFood; o pedido só cancela no ERPOS quando vier `CANCELLED` (o iFood pode negar) | `requestCancellation` |
| iFood/cliente cancela (`CANCELLED`) | cancela no ERPOS (cozinha e entrega somem; estoque volta como em qualquer cancelamento) |
| disputa (cliente pede cancelamento/reembolso) | Aceitar/Recusar no card do pedido |
| `CONCLUDED` | pedido concluído no ERPOS |

Entregador do iFood (`delivered_by = IFOOD`): aparece no Gestor de Entregas como "retirada pelo entregador iFood" com o
código de coleta; sem motoboy da loja. Retirada (TAKEOUT) e consumo no local (DINE_IN) não despacham.

## Peças
1. **Vínculo de itens** — tabela `ifood_item_links` (loja, chave do iFood = `externalCode` ou id do item no catálogo +
   nome, `menu_item_id`/`combo_id`). Tela para ligar o que ficou sem par (lista dos itens do iFood já vendidos).
   Regra do projeto: só vínculo confirmado liga, o sistema não chuta. Item sem vínculo entra na cozinha com o nome do
   iFood, sem baixa de estoque, e aparece como pendência para ligar. Complementos entram como texto
   (`order_item_options`); vínculo de complemento para estoque fica para depois.
2. **Criação do pedido** — caminho próprio na edge `ifood-shipping` (não o `create_delivery_order`, que reprecifica pelo
   cardápio do ERPOS): `orders` (`origin_type delivery`, `delivery_platform 'ifood'`, `destination_type` pelo tipo do
   iFood, cliente/endereço/observações, taxa de entrega) + `order_items` com **o preço do iFood**; reaproveita
   `enqueue_print_ticket` e a baixa de estoque de `_shared/stock.ts`. Liga `ifood_orders.order_id → orders.id`
   (idempotente: evento repetido não cria outro pedido).
3. **Fila de avisos ao iFood** — tabela `ifood_order_outbox` preenchida por gatilhos em `orders`/`order_items`
   (hoje o status muda por vários caminhos: KDS, Gestor de Pedidos, Gestor de Entregas — o gatilho pega todos).
   Enviada na hora (pg_net) e reprocessada pelo cron de 30 s, com tentativas e log; falha fica visível na tela.
4. **Pagamento** — pago no app: forma "iFood (pago no app)" criada sozinha (mesmo padrão da "iFood Entrega"),
   pagamento registrado pelo `fn_record_payment_bypass`. Cobrar na entrega com motoboy da loja: fluxo normal do caixa.
5. **Financeiro sem contagem dupla** — o dinheiro do iFood já entra pelo repasse (fonte "iFood" / conciliação).
   Pedido do iFood no ERPOS **não gera** conta a receber nem `auto_sale`, e a fonte "Pedidos" ignora
   `delivery_platform = 'ifood'` quando a fonte "iFood" está ligada (Receitas, DRE, DRE comparativo, Visão Geral).
6. **NFC-e** — com `order_emit_nfce`, emite pelo `fiscal-write` como os demais delivery. Valor = itens + entrega −
   desconto pago pela loja; cupom pago pelo iFood não é desconto da loja. **Conferir com a contabilidade** o código
   de pagamento da nota (hoje "99 – outros" na iFood Entrega).
7. **Telas** — configuração (seção "Pedidos do iFood"), aguardando aceite + prazo no Gestor de Pedidos, selo "iFood"
   nos cards (cozinha, gestor, entregas), cancelar com motivos do iFood, tela de vínculo de itens.

## Ordem de execução
1. Vínculo de itens + tela (serve também para CMV no modo só leitura).
2. Regra do financeiro (antes de ligar em loja real).
3. Criação do pedido + aceite automático/manual + cozinha.
4. Fila de avisos + cancelamento nos dois sentidos + disputa.
5. NFC-e opcional.
6. Teste completo na Testes PDV com pedidos de teste do Portal; homologação do Order; depois as lojas ligam.

## Riscos
- Loja mexendo também pelo Gestor do iFood → ações em dobro (não quebra, confunde). Orientar: tablet do iFood só de reserva.
- Cardápio do iFood com preço diferente do ERPOS: a venda vale pelo preço do iFood (correto); CMV pela ficha.
- Se o ERPOS/Supabase cair, o polling para e o iFood pode cancelar pedido não confirmado → aviso de falha do polling já existe.
