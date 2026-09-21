-- Criterios do funil configuraveis por loja.
--
-- Antes os cortes (90 dias = perdido, 1,5x o ciclo = em risco, 6 pedidos =
-- fiel, top 10% = VIP) viviam dentro da fn_crm_recompute_stages. Cada
-- operacao tem um ritmo: hamburgueria de bairro e restaurante de almoco nao
-- perdem cliente no mesmo prazo. Agora a loja define.
--
-- Uma linha por loja. Sem linha = os defaults abaixo (que sao os valores que
-- a funcao usava fixos), entao lojas existentes nao mudam de comportamento.
create table if not exists public.crm_stage_criteria (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,

  -- Carrinho abandonado: por quanto tempo um carrinho parado ainda conta como
  -- "quente". Passou disso, o cliente volta pro estagio normal dele.
  carrinho_horas integer not null default 72
    check (carrinho_horas between 1 and 720),

  -- Perdido: dias sem pedir a partir dos quais a pessoa e considerada perdida.
  perdido_dias integer not null default 90
    check (perdido_dias between 30 and 365),

  -- Em risco: "sumiu" e relativo AO CLIENTE — multiplicador do ciclo medio
  -- dele, com um piso em dias (senao quem pede todo dia entraria em risco em
  -- 2 dias).
  risco_multiplicador numeric(4,2) not null default 1.5
    check (risco_multiplicador between 1 and 5),
  risco_min_dias integer not null default 21
    check (risco_min_dias between 3 and 180),

  -- Ciclo assumido para quem ainda nao tem historico (1 pedido so).
  ciclo_padrao_dias integer not null default 30
    check (ciclo_padrao_dias between 1 and 120),

  -- Fiel: a partir de quantos pedidos. Abaixo disso (e com 2+) e recorrente.
  fiel_min_pedidos integer not null default 6
    check (fiel_min_pedidos between 2 and 50),

  -- VIP: fiel que tambem esta no topo de gasto da loja. O percentil e relativo
  -- (0.90 = 10% que mais gastam); o piso em R$ e absoluto (0 = sem piso).
  vip_min_pedidos integer not null default 6
    check (vip_min_pedidos between 1 and 50),
  vip_percentil numeric(4,3) not null default 0.900
    check (vip_percentil between 0.5 and 0.999),
  vip_min_gasto numeric(12,2) not null default 0
    check (vip_min_gasto >= 0),

  updated_at timestamptz not null default now(),

  -- Perdido tem que vir DEPOIS de em risco, senao um estagio engole o outro.
  constraint crm_criteria_ordem check (perdido_dias > risco_min_dias)
);

comment on table public.crm_stage_criteria is
  'Cortes do funil por loja (o que define cada estagio). Lido por fn_crm_recompute_stages; sem linha, valem os defaults das colunas.';

alter table public.crm_stage_criteria enable row level security;
grant select, insert, update, delete on public.crm_stage_criteria to service_role;
