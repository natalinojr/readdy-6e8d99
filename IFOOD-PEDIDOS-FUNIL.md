# Pedidos do iFood no funil do ERPOS — desenho (2026-09-27, APROVADO pelo dono)

Objetivo: o pedido do iFood vira um pedido normal do ERPOS (cozinha/KDS, Gestor de Pedidos, Gestor de Entregas,
estoque, NFC-e) e cada mudança de status é avisada ao iFood. Vale para **qualquer loja**, ligado por configuração.
Base já pronta: `ifood_orders`/`ifood_order_items` + polling de 30 s no servidor + ações do iFood (confirmar, preparo,
pronto, despachar, cancelar, disputa) na edge `ifood-shipping` (ver `IFOOD-MODULOS-HOMOLOGACAO.md`).

## Decisões do dono (2026-09-27)
- ERPOS emite a NFC-e dos pedidos do iFood (Paranaguá não emite hoje) — **opção por loja**.
- Não é piloto por loja: recurso genérico, cada loja liga na configuração.
- Confirmação automática ou manual = **configuração da loja**.
- Cancelar pelo ERPOS = pedir cancelamento (só cancela quando o iFood confirmar) — ok.
- Financeiro sem contagem dupla (pedido do iFood não gera a receber/auto_sale; fonte "Pedidos" ignora iFood quando a
  fonte "iFood" está ligada) — ok.
- **Complementos também dão baixa de estoque** (vínculo do complemento com a opção do cardápio / ficha).
- **NFC-e pelo valor da venda** (itens + entrega − desconto pago pela loja). Comissão e taxas do iFood NÃO abatem a
  nota: são serviço do iFood (despesa, já vem pela conciliação). Dono: "faz do jeito certo contabilmente".
- Conflito com a "Fase 4 motoboy do iFood" (pedido só em `ifood_orders`) **resolvido**: o dono confirmou este desenho;
  a outra sessão desfez a Fase 4 (commit ea4a65f + migration 20260927190000). Ver seção "Motoboy da loja" no fim.

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
   iFood, sem baixa de estoque, e aparece como pendência para ligar. Complementos (2º e 3º nível do iFood) também
   são vinculados — a uma opção do cardápio (`order_item_options.option_id` → ficha da opção) ou a um item — e dão
   baixa; "não usa estoque" é uma escolha explícita.
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
   **Levantamento 2026-09-27 (etapa 2):** `fn_record_payment_bypass` só insere `payments` (exige caixa da sessão do
   pedido) — não gera `auto_sale`, banco nem pontos (isso é do `order-write › record_payment`). Então DRE, Visão Geral,
   Fluxo de Caixa e Contas a Receber ficam certos se o funil **não** lançar `fin_cash_flow`/recebível. Pontos e
   contadores do cliente vêm do gatilho `trg_orders_customer_counters` (só com `customer_id`) → pedido do iFood entra
   **sem `customer_id`** (iFood mascara o cliente). Somam `orders`/`payments` direto e precisam ignorar
   `orders.ifood_order_id is not null`: `useReceitas.ts` (fonte Pedidos), DRE comparativo (cancelados/descontos),
   Dashboard `ResumoFinanceiro.tsx`, `fn_get_sales_report` (Vendas/Origem/Gestor de Pedidos), `fn_get_cash_sessions_v2*`
   (fechamento: iFood vira linha à parte, fora do total vendido), resumos do assistente (vendasDoDia, FechamentoDia,
   CaixaAberto). CMV/consumo/ranking de produtos passam a INCLUIR o iFood (correto: estoque saiu uma vez).
6. **NFC-e** — com `order_emit_nfce`, emite pelo `fiscal-write` como os demais delivery. Valor = itens + entrega −
   desconto pago pela loja (valor da venda); cupom pago pelo iFood não é desconto da loja; comissão/taxas do iFood não
   abatem. Código de pagamento da nota: "99 – outros" (igual à iFood Entrega) — conferir com a contabilidade.
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

## Motoboy da loja (`delivered_by = MERCHANT`) — peças já prontas e o que falta (2026-09-27, sessão do delivery)
Uma primeira versão levava o pedido do iFood ao Gestor de Entregas/portal do motoboy **sem** virar `orders` (commit
d95420e); foi **desfeita** no mesmo dia porque o dono escolheu este desenho. Aprendizados e peças que ficaram:
- **Já no ar:** `ifood-shipping › order_action` op **`verify_code`** (`POST /order/v1.0/orders/{id}/verifyDeliveryCode`
  `{code}`) — só vale com `valid === true` explícito (resposta em outro formato = não confirmado); código certo → o
  iFood conclui sozinho (CONCLUDED). `ifood_orders.delivery_lat/lng/fee` (0,0 do pedido de teste = sem posição) e
  `delivery_code_ok`/`delivery_code_fails` (migration `20260927190000_ifood_campos_entrega.sql`).
- **Entrega = prova com código:** para `delivered_by = MERCHANT`, "Entreguei" do motoboy (e "Marcar entregue" do Gestor)
  pede o código que o cliente vê no app do iFood → `verify_code`. O portal do motoboy é público (login só nome +
  celular): **limitar tentativas** (5 erros travam até o Gestor "liberar entregador", que zera `delivery_code_fails`).
- **Avisar o iFood antes de gravar:** se o iFood recusar (despacho/código), o funil do ERPOS não anda — as duas pontas
  ficam iguais. Com a fila (`ifood_order_outbox`), o "coletou" do motoboy vira `dispatch`.
- **Filtros que vão precisar mudar:** o Gestor de Entregas (`delivery-write › list_delivery_board`) esconde
  `delivery_platform` de apps externos (`PLATAFORMAS_EXTERNAS`, inclui 'ifood') — o pedido criado por este desenho com
  `delivered_by = MERCHANT` precisa passar (marcar pelo vínculo `ifood_orders.order_id`, não só pela plataforma, porque
  pedido lançado à mão no PDV como "iFood" é entregue pelo iFood). O portal (`motoboy-signal › list_orders`) hoje só
  esconde retirada.
- **Acerto dos entregadores:** sai sozinho pelo gatilho de `orders` (`trg_delivery_driver_ledger`) quando o pedido tem
  motoboy e fica `delivered`; taxa = `delivery_fee` do iFood; km nulo (faixa_km usa o valor base) — gravar
  `delivery_lat/lng` no pedido para o mapa e, se quiser km, calcular a distância na criação.
- Pedido com entregador do iFood (`delivered_by = IFOOD`) nunca vai para o motoboy da loja.

## Estado — 2026-09-27 madrugada (Claude, dono dormindo; tudo no main e no ar)
- **Etapa 1 FEITA** (eb03e39, 7084e77): `ifood_item_links` + tela Pedidos iFood › Vincular itens.
- **Etapa 2 FEITA** (152139b): `orders.ifood_order_id`; pedido do funil fora de Relatório de Vendas, fechamento de caixa
  (linha própria "iFood"; dinheiro cobrado na entrega fica na linha Dinheiro/gaveta), Receitas, DRE, DRE comparativo,
  Dashboard, resumos do assistente e relatórios de delivery. Conferido: funções antigas × novas dão o mesmo resultado na
  Paranaguá (só muda a ordem de uma lista sem ORDER BY).
- **Etapas 3 e 4 FEITAS** (c4e82f1): config "Pedido entra no ERPOS" + "Aceitar sozinho" (Gestor de Entregas › iFood
  Entrega › 3. Pedidos do iFood); `funnel.ts` (montador puro, 6 testes); pedido nasce rascunho e é liberado pelo
  `delivery-write › release_held_order` (tickets, estoque de itens sem preparo); confirmação no iFood; sem caixa aberto
  espera (varredura a cada polling); só pedidos depois de ligar (`funnel_since`). Fila `ifood_order_outbox` (gatilho em
  `orders`): preparing→startPreparation, ready→readyToPickup, saiu com motoboy da loja→dispatch. CANCELLED do iFood
  cancela no ERPOS (`fn_ifood_cancel_erpos_order`); CONCLUDED conclui e baixa o que a cozinha não marcou. Trava: pedido
  do iFood não cancela direto no ERPOS (gatilho) — cancela em Pedidos iFood com o motivo do iFood.
- **Testado na Testes PDV (produção, sessão do dono no navegador do app + Portal no Chrome)**: #4639 (entrega pela loja)
  → P2609260009 pago, na cozinha, KDS mostra "iFood #4639" com complementos; preparo/pronto/despacho → fila "sent" e
  iFood foi a preparing/ready/dispatched; aparece no Gestor de Entregas (R$ 26, taxa 5, PAGO); fechamento: faturamento
  igual (R$ 545) + linha iFood 1 pedido R$ 26. #5357 com aceite manual → rascunho ("aguardando aceite") → Aceitar pela
  tela → cozinha + iFood confirmado → Cancelar pela tela (motivo 501) → iFood cancelled → ERPOS cancelado com itens.
  Trava de cancelamento direto conferida (transação desfeita).
- **Sem teste:** baixa de estoque pela ficha (o item vinculado na loja de teste não tem ficha), complemento→item,
  entregador do iFood (os pedidos de teste vieram com entrega pela loja), retirada/agendado/dinheiro (o gerador do
  Portal não faz), CONCLUDED no funil, disputa no funil, fechar caixa com pedido do iFood aberto.
- A Testes PDV voltou para o modo **"operar"** (roteiro da homologação automática do Order).
- **Etapa 5 (NFC-e) NÃO feita**: decisão/validação do dono + contabilidade; Testes PDV não tem fiscal.
- **Revisão Opus (reprovou: 5 P1 + 6 P2) → tudo corrigido em 5ff9f36** e retestado (#2852 → P2609260012):
  `orders.ifood_repasse` (só o que vem pelo repasse sai das somas; cobrado pela loja é venda da loja); retirada/mesa
  paga no balcão não é "pago"; total do cobrado = o que o cliente paga; complemento 2x = 2 linhas; `fn_close_session`
  não cancela rascunho do iFood (aceite leva p/ caixa aberto); trava de polling por loja; `release_held_order`
  condicional; aceite automático refeito pela varredura; agendado retido até preparo+20 min; fila espera o confirm e
  tem ordem fixa; pedidos ligados seguem fora do funil; cancelar = gerente/admin/caixa; CONCLUDED tira do rascunho.
- Estoque pela ficha **testado** (#7445 → P2609260011): item→Quesadilla, complemento→item Burrito (linha própria),
  complemento→opção Guacamole — as 7 baixas certas. Vínculos de teste ficaram na Testes PDV.


## Etapa 5 — NFC-e (2026-10-05, Claude; chave desligada em todas as lojas)
- **Regra única do valor da venda** em `supabase/functions/_shared/ifood-valores.ts` (funil e NFC-e usam a mesma):
  itens pelo preço do iFood + entrega feita pela loja − desconto bancado pela loja (MERCHANT e CHAIN). Cupom do iFood
  (IFOOD) e da indústria (EXTERNAL) não abatem; taxa de serviço do iFood não entra. **Correção:** a entrega grátis
  bancada pela loja (benefício DELIVERY_FEE) só abate quando a LOJA entrega — com entregador do iFood a taxa não está
  na venda (1º pedido real, #1631 da Paranaguá: 31,49 − 5,00 = 26,49; antes o funil gravava 19,50).
- **fiscal-write:** pedido com `orders.ifood_order_id` usa os valores do `ifood_orders` (não o `orders.total_amount`,
  que no cobrado pela loja é o que o cliente paga, já sem o cupom do iFood). O que não passou pelo caixa vira tPag 99
  com descrição **"iFood - online"** (pedido do dono). Emissão automática de pedido do iFood só com
  `ifood_pdv_config.order_emit_nfce` (trava também o cobrado na entrega, que o order-write dispara ao receber no
  caixa). Emissão manual (Notas Fiscais, force) não depende da chave.
- **Quando sai: escolha da loja (`order_nfce_momento`, dono 05/10)** — `saida` (padrão, recomendado: pronto ou saiu;
  a NFC-e deve estar autorizada antes da mercadoria circular, Ajuste SINIEF 19/16 + FAQ SEFA-PR 1504) ou `conclusao`.
  Versão anterior (só conclusão): com o pedido CONCLUÍDO no iFood e pago — o que acontecer por último
  (depois da conclusão não há mais risco de cancelamento). Pago no app → no CONCLUDED; cobrado pela loja → no CONCLUDED
  se o caixa já recebeu, senão quando o caixa receber (a fiscal-write recusa pedido do iFood não concluído). Tempos
  vistos: entregador do iFood conclui na validação do código (#1631: 23 min); entrega pela loja ~30 min; consumo no
  local ~4 h. Roda em segundo plano (não segura o polling). **Uma tentativa automática só**: qualquer
  documento já criado (erro, rejeição, cancelado à mão) fica para a tela Notas Fiscais — erro de tempo esgotado pode
  ter sido autorizado na SEFAZ e reenviar sozinho geraria 2ª nota.
  Pedido do iFood decide só pela chave do iFood (não pelas chaves por canal); pedido de teste do iFood (`is_test`)
  nunca vira nota. Revisão Opus 05/10: 0 P1; 4 P2 + 4 P3 corrigidos.
- **Cancelado pelo iFood depois da nota:** cancela a NFC-e (justificativa fixa); se a SEFAZ recusar (prazo), fica o
  aviso em `ifood_orders.funnel_error`.
- **Chave:** Gestor de Entregas › iFood Entrega › Pedidos do iFood › "Emitir NFC-e dos pedidos do iFood" (aparece no
  modo "Pedido entra no ERPOS").
- **Presença e intermediador (contadora 05/10: "não presencial" + iFood como intermediador)** — `_shared/ifood-nota.ts`.
  NFC-e só aceita indPres 1, 4 ou 5 (rejeição 717); "não presencial" na NFC-e = 4 (entrega a domicílio), que exige
  destinatário com endereço (787/788; Ajuste SINIEF 09/2026) e indIntermed (434). Homologação SEFAZ-PR 05/10 (conta
  Brasil NFe da Paranaguá): entrega + CPF + endereço + intermediador (CNPJ iFood 14.380.200/0001-21 + merchant id)
  → AUTORIZADA; sem CPF → 787; intermediador com indPres 1 → recusado pelo Brasil NFe. **O Brasil NFe liberou os dois
  em 06/10** (dest com `<idEstrangeiro/>` vazio + nome + endereço quando indPres 4 sem CpfCnpj; intermediador com
  indPres 1). **Regra (branch `claude/ifood-nfce-sem-cpf`, publicar só depois da homologação com a versão nova e do
  OK da contadora sobre o idEstrangeiro vazio = "estrangeiro sem documento"):** entrega com endereço completo →
  indPres 4 + intermediador + destinatário (CPF só se o cliente pediu); retirada/no local/endereço incompleto →
  presencial + intermediador. Código IBGE pelo CEP (ViaCEP, depois lista do IBGE).
- **Partes da ficha montada do iFood (dono 05/10: dividir o preço entre comida e bebida)** — `fiscal-write/valores.ts
  › ratearPartesIfood`. O funil grava as partes como linhas a R$ 0 com notes `parte de <origem>` (contrato com o
  funnel.ts). Na nota: parte de complemento pago leva o preço do complemento (tirado dos opcionais do produto);
  complemento a R$ 0 ("Escolha sua bebida") e parte da ficha do produto dividem o preço-base pelo preço de cardápio
  (produto × partes); parte sem referência fica fora; centavos para baixo nas partes (nunca negativo), resto no
  produto; total igual. Bebida sai na própria linha com NCM/CEST/CSOSN 500 (senão o ICMS-ST seria pago de novo no
  Simples). Limitação conhecida: produto com o mesmo nome de um complemento no mesmo pedido — a parte é tratada como
  do complemento (total certo, divisão entre NCMs pode errar). Revisão Opus 05/10: 1 P1 (preço negativo por
  arredondamento) e 1 P2 (complemento a R$ 0) corrigidos.
- **Regra do dono (05/10):** a loja só abre no iFood depois de abrir o caixa no ERPOS.
