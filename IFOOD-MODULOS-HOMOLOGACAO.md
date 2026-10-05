# iFood — critérios de homologação dos módulos do app "ERPOS PDV"

Lido na doc oficial em 2026-09-26 (developer.ifood.com.br › Restaurante › Módulos › <módulo> › Critérios de homologação).
Chamado: Portal do Desenvolvedor › Minhas solicitações › Abrir nova solicitação › tipo **Homologação** (loja de teste
4117700, status "concluí o desenvolvimento", marcar os módulos). Order e Events têm fluxo automático próprio (menu
Homologação) — Events não é marcável no chamado. Shipping: ver `IFOOD-SHIPPING.md` (pronto).

## Merchant (loja no iFood) — por chamado
- GET /merchants (paginação page/size), GET /merchants/{id} (operações + endereço), GET /merchants/{id}/status
  (OK/WARNING/CLOSED/ERROR + validações).
- Pausas: GET/POST/DELETE /merchants/{id}/interruptions (201 / 204; sobreposição → 409 InterruptionOverlap).
- Horários: GET/PUT /merchants/{id}/opening-hours (turnos dayOfWeek/start/duration; sobreposição → 400).
- Erros 400/401/403/409/429(Retry-After)/500 tratados; backoff em 5xx; polling de status ≥ 30 s.

## Review (avaliações) — por chamado
- review/v2.0: GET /merchants/{id}/reviews (page, pageSize ≤ 50, dateFrom/dateTo, addCount), GET .../reviews/{id}
  (404 se não existe), POST .../reviews/{id}/answers (texto 10–300; só NOT_REPLIED → senão 409/422),
  GET /merchants/{id}/summary (totalReviewsCount, validReviewsCount, score).
- **Obrigatório na tela: link para a Política de Avaliações do iFood.** Tratar 401/403/404/429.
- Ter avaliações recentes (2–3 dias) na loja para a demonstração.

## Teste de Merchant e Review — 2026-09-26 (edge `ifood-shipping`, loja Testes PDV, app C, homologação ligada)
Feito pela edge (SQL `net.http_post` + chave interna), **não pela tela** (sessão na nuvem, sem login).
| Ação | Resultado |
|---|---|
| `merchant_overview` | OK: dados da loja 4117700, status "Loja aberta" (OK), pausas, 7 turnos 00:00 +1439 min, `errors: []` |
| `merchant_pause_create` 15 min | OK (iFood 201). Pausa aparece no `GET` depois de alguns segundos |
| 2ª pausa sobreposta | **iFood aceitou** (sem 409) na loja de teste — nosso tratamento do 409 fica sem prova |
| `merchant_pause_delete` (3 pausas) | OK (204) |
| `merchant_hours_save` (os mesmos 7 turnos) | OK — horário da loja igual ao de antes |
| turnos sobrepostos no mesmo dia | recusado antes de ir ao iFood ("Há turnos sobrepostos no mesmo dia.") |
| `reviews_list` | OK: `{ reviews: [], total: 0, pageCount: 0 }` — **loja de teste sem avaliações** |
| `reviews_summary` | iFood 404 "Summary not found" (sem avaliações) → edge agora devolve resumo zerado |
| `review_get` id inexistente | "Avaliação não encontrada." (404 tratado) |
| `review_answer` id inexistente / texto < 10 | 404 do iFood com mensagem / recusado antes ("10 a 300 caracteres") |
| loja do iFood não autorizada | "Essa loja do iFood não autorizou o app ERPOS PDV." |
Achados: horário da pausa volta em UTC **sem `Z`** (tela corrigida); `/status` não muda com pausa na loja de teste.
Sem teste: a tela "Loja iFood" em si (abrir, pausar, editar turno, responder), resposta real a uma avaliação (não há
avaliação na loja de teste), 401/403/429 reais.

### Teste pela tela — 2026-09-26 à noite (produção, Testes PDV logada no navegador do app)
- Loja iFood: status "Aberta"; pausa 30 min criada e exibida em hora de Brasília (18:34–19:04, certo); removida.
  Turno de segunda 23:59 → 22:00 → 23:59, conferido no iFood. **Achado:** o `GET /opening-hours` leva ~1 min para
  refletir o `PUT` → a tela agora mostra os turnos devolvidos pelo próprio PUT (corrigido e conferido em produção).
- Avaliações: "Sem nota ainda · 0 de 0", lista vazia com filtro de período, link da Política abre em nova aba.
- Pedidos de teste do Portal: o gerador só tem categoria **FOOD** (entrega iFood, crédito) e **FOOD_SELF_SERVICE**
  (= `orderType` **DINE_IN**, canal TOTEM, `dineIn.deliveryDateTime`, confirmado pelo próprio iFood em 0,2 s). O card
  mostrava "Entregador iFood" + botão Despachar → corrigido (`ifoodTipoPedido`/`ifoodPodeDespachar`); preparo → pronto
  ok. Retirada, agendado, dinheiro com troco e disputa **não** saem do gerador do Portal (precisa do "Usuário de testes"
  pedindo pelo app do iFood).

## Chamado de homologação — Shipping, Merchant e Review (texto pronto)
Portal do Desenvolvedor › Minhas solicitações › Abrir nova solicitação › **Homologação**. Marcar Shipping, Merchant e
Review; loja de teste 4117700; status "concluí o desenvolvimento".

**Assunto:** Homologação dos módulos Shipping, Merchant e Review — ERPOS PDV (IDEAR PROJETOS COMPLEMENTARES LTDA.)

> Olá, time de integração do iFood.
>
> Solicitamos a homologação dos módulos **Shipping (Entrega Sob Demanda)**, **Merchant** e **Review** do aplicativo
> **ERPOS PDV** (categoria PDV), ERP para restaurantes. Integradora: IDEAR PROJETOS COMPLEMENTARES LTDA. App de teste:
> "Teste (C)" (centralizado). Loja de teste: 4117700 (1fac24ad-b86c-49d6-a8c3-6a60a57294c4). Chamadas de teste com
> `x-request-homologation: true`.
>
> **Shipping:** a loja chama o entregador do iFood para pedidos de delivery próprios (site, WhatsApp, balcão). Cotação
> (deliveryAvailabilities) antes de registrar; registro com itens, taxa, pagamento (pago ou cobrado na entrega com troco)
> e idempotency-key; polling de eventos a cada 30 s com acknowledgment imediato e deduplicação por eventId; status do
> entregador, código de entrega e de coleta na tela; cancelamento só com motivos do /cancellationReasons; tratamento de
> cancelamento pelo iFood/cliente; aceitar/recusar troca de endereço dentro do prazo; token renovado antes de vencer;
> backoff exponencial com jitter em 429/5xx, respeitando Retry-After (POST que muda estado não é repetido); logs com orderId/eventId por 30 dias e
> aviso na configuração após mais de 5 falhas seguidas do polling. Observação: pela FAQ, a loja de teste não aloca entregador nem gera eventos de
> Sob Demanda; demonstramos a cotação, o registro e o tratamento dos eventos com simulação e podemos repetir com uma loja
> real quando liberado.
>
> **Merchant:** tela "Loja iFood" com dados da loja, status por canal com as validações, pausas (criar com duração e
> motivo, listar e remover; 409 de sobreposição tratado, embora a loja de teste tenha aceitado pausa sobreposta sem 409)
> e horários de funcionamento por dia/turno (PUT completo, validação de sobreposição antes do envio). Lista de lojas
> paginada (page/size). Como o GET de horários e de pausas leva alguns instantes para refletir o PUT/POST/DELETE, a tela
> mostra o que o próprio iFood devolveu na gravação. Não há consulta automática de status: ele é lido só ao abrir a
> tela ou no botão Atualizar.
>
> **Review:** lista paginada (até 50 por página) com filtro de período, detalhe por id, resposta (10 a 300 caracteres,
> só para avaliação sem resposta; 409/422 tratados) e resumo (nota, total e válidas). A tela tem o link para a Política
> de Avaliações do iFood. A loja de teste está sem avaliações (lista vazia e /summary 404, tratado como "sem nota
> ainda"); para a demonstração da resposta, pedimos orientação de como gerar avaliações de teste.
>
> Erros 400/401/403/404/409/429/5xx são mostrados em português para a loja. Ficamos no aguardo das orientações e do roteiro
> de demonstração.
>
> Obrigado!

Anexos sugeridos (até 5): print do Gestor de Entregas › iFood Entrega (config), modal da entrega com cotação, tela
"Loja iFood" (status + pausas + horários), aba Avaliações com o link da política, log de eventos (`ifood_pdv_events`).

## Analytics (indicadores) — wizard automático do Devportal (desde 2026-09-30)
- **Mudou em 2026-09-30 (comunicado do iFood):** acabou o chamado/formulário/reunião. Agora é só pelo wizard:
  Portal do Desenvolvedor › Homologação › Nova homologação (ou link de autenticação). Precisa ter em mãos o **payload
  devolvido pela API** chamada com `x-request-homologation: true`. Só o **dono do app** (quem criou) inicia.
  Aprovado → ainda passa por especialistas antes de liberar; reprovado → relatório com os pontos; **1 tentativa por
  app a cada 4 h**. Mesmo modelo da homologação automática do Order.
- **FEITO 2026-09-30:** edge `ifood-shipping` ação `analytics_kpis` (regras em `ifood-shipping/analytics.ts`, testes
  `src/test/edge/ifoodAnalytics.test.ts`) + aba **Indicadores** no modal "Loja no iFood" do Gestor de Entregas
  (`IfoodIndicadores.tsx`; admin/gerente). Uma consulta agrupada por dayOfWeek × orderStatus × deliveredBy ×
  paymentMethod × salesChannel, todas as páginas (size 1000, até 20), somada aqui: GMV/GMV sem entrega/ticket só dos
  concluídos, taxa de cancelamento, distribuições e tabela canal × entrega. Período até ontem (D-1), aviso D-1 e período
  consultado visíveis; validação local de todos os "motivos de rejeição"; mensagens por HTTP (400/401/403/404/429/5xx).
  Em modo homologação aparece o botão **"Gerar payload de homologação"** (corpo do exemplo da doc + resposta, com Copiar)
  — é o payload que o wizard pede.
- **Pegadinhas do ambiente de teste (2026-09-30):** com `x-request-homologation` o iFood IGNORA o corpo e devolve sempre
  o exemplo da doc (esse agrupamento, página de 20, totalItems 91, 5 páginas que REPETEM a 1ª) → sem `terms`; por isso a
  tela usa groupBy e descarta linha com chave já vista. `dayOfWeek` vem em nome (`WEDNESDAY`), não 1–7 como diz a doc.
  Canais/pagamentos que aparecem além da doc: `EMBEDDED_UBER`, `VOUCHER`, `OTHER_VOUCHER`, `BANK_PAY`. O app C (teste)
  já tem o escopo analytics.
- POST analytics/v1.0/merchants/{id}/orders/kpis com `x-request-homologation: true` na loja de teste (payload fixo).
- Sempre `filter.referenceDate` + ao menos uma agregação (metrics/terms/groupBy/dateIntervals); page 1–1000, size 1–10000;
  funções sum/avg/min/max e count/cardinality; sem duplicados; gte ≤ lte.
- Tela: GMV, GMV sem entrega, ticket médio, pedidos concluídos/cancelados, distribuição por canal (IFOOD/
  DIGITAL_CATALOG), status, pagamento, logística (IFOOD_DELIVERY/MERCHANT_DELIVERY), seletor de período visível,
  aviso claro de dados D-1 (dia anterior), sempre agregado. Rate limit 500/min; backoff 429/500/503.

## Catalog (cardápio) — por chamado + vídeos de cada cenário (checklist enviado pelo analista)
- Aplicação completa (tela real, não curl). Categorias (POST /categories), itens simples (PUT /items), GET /catalogs,
  GET /items; complementos (grupos com min/max); pizza/combo se aplicável.
- Em massa: PATCH /items/price e PATCH /items/status; preços/status por contexto (Delivery, Digital Menu, Dine-in —
  contextModifiers); agendamento de disponibilidade; multi-catálogo se aplicável.
- Validação: título ≤ 100, descrição ≤ 500, preço > 0, status AVAILABLE/UNAVAILABLE; erros CONFLICT/NOT_FOUND/
  VALIDATION_ERROR com mensagem; retry só em 5xx/timeout; refletir preço/status em ≤ 2 s; 100+ itens em ≤ 10 s.
- Checklist inclui multi-idioma (pt-BR, es-CO, en-US), caracteres especiais, requisições concorrentes, rate limit.

## Order (pedidos do iFood) — FEITO 2026-09-26, modo só leitura por padrão
- Decisão do dono: Order entra para trazer os **itens de cada pedido** (CMV por pedido, estoque); a loja segue operando
  no Gestor de Pedidos do iFood. Catalog NÃO (dono não quer alterar o cardápio do iFood pelo ERPOS). Analytics depois.
- Order foi marcado no próprio app ERPOS PDV (em desenvolvimento aceitou).
- Peças: migration `20260926180000_ifood_orders.sql` (`ifood_orders`, `ifood_order_items`, colunas `order_enabled`,
  `order_mode` read_only|operate, `order_merchant_ids` em `ifood_pdv_config`; cron de 30 s roda sempre com pedidos
  ligados), regras em `supabase/functions/ifood-shipping/order.ts` (testes `src/test/edge/ifoodOrder.test.ts`),
  edge `ifood-shipping` (polling agrupado por autorização; `order_refresh`, `order_action`, `order_cancel_reasons`),
  tela Gestor de Entregas › **Pedidos iFood** (itens, complementos, observações, pagamento/bandeira/troco, cupom e quem
  paga, código de coleta, CPF da nota) e seção "3. Pedidos do iFood" na configuração.
- Testado na loja de teste (app C, Testes PDV, modo operar): pedidos gerados no Portal › Pedidos de teste chegaram
  com itens; confirmar → preparo → pronto → despachar e cancelar (motivos 501–523) confirmados pelo iFood.
- **Pegadinhas:** `requestCancellation` exige `{ reason, cancellationCode }` (a doc mostra só `reason` → 400
  "cancellationCode is required"); eventos de pedido chegam pelo mesmo `/events/v1.0/events:polling`; a homologação
  é automática (menu Homologação › Nova homologação; 1 tentativa a cada 4 h; só o dono do app inicia).
- Falta: baixa de estoque / CMV a partir de `ifood_order_items` (vínculo item do iFood → ficha do ERPOS).
- **Plataforma de Negociação (2026-09-26):** HANDSHAKE_DISPUTE (cliente pede cancelamento/reembolso) agora aparece no
  card do pedido com o pedido, a mensagem e o prazo; no modo "operar", **Aceitar** / **Recusar (com motivo)** →
  `order_action` op `dispute_accept|dispute_reject` → `POST /order/v1.0/disputes/{id}/accept|reject`. Contraproposta
  (alternatives) não foi feita. Ainda sem teste real (nenhuma disputa na loja de teste até agora).

### Roteiro para a homologação automática do Order (o dono inicia; 1 tentativa a cada 4 h)
Antes de iniciar: loja Testes PDV com **Pedidos do iFood ligado, modo "operar"**, loja do iFood 4117700 marcada, modo
homologação ligado (vence 27/09 15h — religar se preciso) e a tela Gestor de Entregas › **Pedidos iFood** aberta.
Durante: o polling de 30 s e o ack são automáticos; cada pedido que o iFood mandar aparece em até 30 s. Fazer na tela o
que o roteiro pedir: **Confirmar** → **Iniciar preparo** → **Pronto** → **Despachar** (entrega própria) / pronto p/
retirada (TAKEOUT: só "Pronto"); **Cancelar pedido** escolhendo o motivo da lista; cancelamento pedido pelo cliente →
responder no bloco vermelho (**Aceitar** / **Recusar**). Conferir no card itens, complementos, observações, troco,
cupom e quem paga, código de coleta e CPF da nota. Se falhar, anotar o passo e o horário para eu ler `ifood_pdv_events`.


### Homologação automática do Order — 2026-09-28 (bloqueada)
- Iniciada pelo dono (loja de teste 4117700, eventos por POLLING). Etapa 1 "Testar conexão" falhou: "Cliente de heartbeat
  diferente do esperado. Esperado: …teste-d. Atual: …teste-c". A homologação do Order exige o app de teste DISTRIBUÍDO
  "Teste (D)" (o ERPOS PDV é distribuído); todos os testes até aqui usaram o "Teste (C)" centralizado.
- O D foi salvo na Testes PDV (Avançado, tipo distribuído, client 1deede1c…) mas NÃO autorizado: a loja de teste não
  entra no Portal do Parceiro (e-mail da conta dev natalinojunior@idearprojetos.com.br dá "inválido"; "Esqueci" não
  manda e-mail; "Configurações da Loja" também pede login). Com o D sem autorização a Testes PDV NÃO faz polling.
- **Chamado 34062004** (28/09 10:22, "Em análise"): pedido de acesso ao Portal do Parceiro da loja de teste OU aceitar
  o app C na homologação. Quando liberar: gerar código no ERPOS, autorizar no Portal do Parceiro (mesmo navegador),
  colar o código, religar pelo banco homologação + order_enabled/merchant 4117700 + modo operar, e repetir "Testar
  conexão".

### Respostas aos chamados — 2026-09-28 (tarde)
- CNPJ da integradora vinculado à conta dev: **19.831.665/0001-75** (IDEAR PROJETOS COMPLEMENTARES LTDA).
- **34064791** (Shipping/Merchant/Review): responder só com o CNPJ + razão social + e-mail da conta dev.
- **34062004** (Order): CNPJ; confirmar que é o módulo **Order** do app ERPOS PDV; **1ª tentativa** da homologação
  automática (falhou na etapa "Testar conexão" por usar o app C); último chamado **33335462** (app ERPOS, Financial +
  Merchant, homologado 25/09). Pedir que aceitem o C ou liberem o D.
- **Chamado novo** (separado, pedido pelo suporte): acesso ao Portal do Parceiro da loja de teste 4117700 para
  autorizar o app de teste "Teste (D)".
  **ABERTO em 2026-09-30 15:20: chamado 34164879**, tipo "Dúvidas ou Informações" › Acessos/Permissões › Dúvidas
  sobre credenciais de acesso (NÃO é homologação). Pergunta: qual login/senha do Portal do Parceiro da loja 4117700,
  como criar/redefinir a senha, e outra forma de autorizar app distribuído nela. A IA do portal sugeriu "Esqueci a
  senha" + olhar o spam (já tentado) — seguimos com o ticket.
  **2026-10-02 (noite): DESTRAVADO.** O dono entrou no Portal do Parceiro com as credenciais do Portal do
  Desenvolvedor e autorizou o app D na Testes PDV (ifood_pdv_auths com a loja 4117700). Homologação religada até
  04/10 00h13 UTC; polling poll_all respondendo 200 sem erro. Próximo: dono inicia Homologação › Nova homologação (Order).
  **2026-10-02 (noite): ORDER HOMOLOGADO** — homologação automática "Concluído", 6/6 itens com sucesso, 0 falhas
  (o dono exportou o PDF no Devportal). Chamado 34062004 pode ser encerrado; 34164879 também (acesso resolvido).
  Relatório: app homologada `erpos-pdv`, app de teste `…-teste-d`, merchant 1fac24ad-b86c-49d6-a8c3-6a60a57294c4,
  protocolo POLLING, status CONCLUDED em 03/10/2026 (UTC), **60/60 pontos**. Cenários: heartbeat (Firefly), eventos
  (Firefly Audit), Confirmado, Cancelado, Despachado imediato, Despachado agendado — todos 10/10. Recomendações
  genéricas do iFood: manter heartbeat/ack em produção, tratar timeout/indisponibilidade/evento duplicado.
  **2026-10-03: APP `erpos-pdv` APROVADO PARA PRODUÇÃO** (e-mail "Homologação aprovada" do iFood for Developers,
  ID 7ecddd73-…). Lojas reais já podem autorizar o ERPOS PDV (antes dava "integrações não homologadas"). Em 05/10
  nenhuma loja real tinha autorização (`ifood_pdv_auths` só da Testes PDV; Paranaguá, Vila Leste e Vila Burguer com
  código gerado e vencido). Conferir no Devportal se Shipping/Merchant/Review (chamado 34064791) entraram junto.
- Tela: botões de tipo em Avançado agora dizem "Distribuído (app de teste "D")" / "Centralizado (app de teste "C")".
