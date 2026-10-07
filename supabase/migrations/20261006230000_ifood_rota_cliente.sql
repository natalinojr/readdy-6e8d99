-- Rota de verdade (OpenRouteService) do pedido do iFood com entrega nossa, para a previsão do link
-- /p/<código> (2026-10-06). Calculada uma vez, da posição do motoboy em rota até a casa, pela
-- motoboy-signal › pedido_link. Fica no ifood_orders (e não em orders.delivery_distance_km, que é a
-- base do acerto do motoboy por km). rota_min = 0 → tentou e o ORS não respondeu (não tenta de novo).
alter table public.ifood_orders add column if not exists rota_km numeric;
alter table public.ifood_orders add column if not exists rota_min numeric;
