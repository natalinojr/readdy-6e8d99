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

## Analytics (indicadores) — chamado + formulário (Google Forms) + reunião
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
