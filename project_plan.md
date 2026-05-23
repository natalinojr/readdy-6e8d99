# ERPOS V2 — Sistema PDV para Restaurantes e Lanchonetes

## 1. Descrição do Projeto

Sistema completo de ponto de venda (PDV) para restaurantes e lanchonetes, com suporte a múltiplos terminais (caixa, garçom, mesa via QR Code, autoatendimento, delivery) e KDS (Kitchen Display System). Multitenant com suporte a múltiplas lojas.

**Target:** Restaurantes, lanchonetes, praças de alimentação  
**Perfis:** Admin, Gerente, Caixa/Balcão, Garçom, Operador de Cozinha

---

## STATUS GERAL DO PROJETO

### ✅ FRONTEND — 100% COMPLETO (com mock data)

Todos os módulos de interface foram construídos e estão funcionando com dados mockados:

| Módulo | Status | Observação |
|--------|--------|-----------|
| Login / Auth UI | ✅ Completo | Mock |
| Onboarding | ✅ Completo | Mock |
| Dashboard | ✅ Completo | Mock |
| Cardápio (cats, itens, combos, fichas, obs) | ✅ Completo | Mock |
| PDV Caixa | ✅ Completo | Context |
| PDV Garçom | ✅ Completo | Context |
| PDV Mesa (QR Code) | ✅ Completo | Mock |
| PDV Autoatendimento | ✅ Completo | Mock |
| PDV Delivery | ✅ Completo | Mock |
| KDS | ✅ Completo | Context |
| Gestor de Pedidos | ✅ Completo | Context |
| Mesas | ✅ Completo | Context |
| Estoque | ✅ Completo | Context |
| Relatórios | ✅ Completo | Mock |
| Configurações | ✅ Completo | Mock |
| Usuários | ✅ Completo | Mock |
| Clientes | ✅ Completo | Mock |
| Pedidos | ✅ Completo | Context + Mock |
| Auditoria | ✅ Completo | Mock |
| Aprovações | ✅ Completo | Mock |

---

## ROADMAP PARA PRODUÇÃO

### 🔴 FASE 1 — Supabase: Fundação do Backend
**Prioridade: Crítica | Pré-requisito de tudo**

- [ ] Conectar Supabase ao projeto
- [ ] Criar todas as tabelas (ver schema completo na seção 4)
- [ ] Configurar Row Level Security (RLS) em todas as tabelas
- [ ] Configurar Supabase Auth (email+senha)
- [ ] Criar tabela `usuarios` vinculada ao Auth
- [ ] Criar tenant + loja iniciais para teste
- [ ] Configurar Supabase Storage (bucket para fotos de itens e logos)

---

### 🔴 FASE 2 — Autenticação Real
**Prioridade: Crítica | Depende da Fase 1**

- [ ] Substituir AuthContext mock → Supabase Auth
- [ ] Login por email + senha (real)
- [ ] Login por matrícula + PIN (Edge Function custom)
- [ ] Sessão persistente (refresh token automático)
- [ ] Logout seguro
- [ ] Proteção de rotas por perfil
- [ ] Onboarding salvo no banco (criação de tenant + loja + usuário admin)

---

### 🟠 FASE 3 — Cardápio Real
**Prioridade: Alta | Depende da Fase 1-2**

- [ ] CRUD de categorias → Supabase (substituir CardapioContext mock)
- [ ] CRUD de itens → Supabase
- [ ] Upload de fotos → Supabase Storage
- [ ] Grupos de opções e opções → Supabase
- [ ] Observações pré-cadastradas → Supabase
- [ ] Ficha técnica → Supabase
- [ ] Promoções por item → Supabase
- [ ] Cardápio Delivery separado → Supabase (tabela ou flag `canal`)
- [ ] Combos → Supabase

---

### 🟠 FASE 4 — Sessão de Caixa + Pedidos Reais
**Prioridade: Alta | Depende da Fase 3**

Esta é a fase mais complexa. Toda a lógica de PDV precisa persistir no banco.

- [ ] Sessões de caixa → Supabase (`sessoes_caixa`)
- [ ] Abertura/fechamento de caixa gravado no banco
- [ ] Sangria e suprimento → banco
- [ ] Pedidos criados no banco (`pedidos`, `pedido_itens`)
- [ ] Opções e observações de pedido → banco
- [ ] KDS em tempo real via **Supabase Realtime** (substituir KDSContext)
- [ ] Gestor de Pedidos lendo do Realtime
- [ ] PDV Garçom gravando pedidos no banco
- [ ] PDV Mesa (QR Code) gravando pedidos no banco
- [ ] PDV Autoatendimento gravando pedidos no banco
- [ ] PDV Delivery gravando pedidos no banco
- [ ] Atualizações de status KDS → Realtime → todos os terminais sincronizados

---

### 🟠 FASE 5 — Estoque Real
**Prioridade: Alta | Depende da Fase 4**

- [ ] Insumos → Supabase
- [ ] Ficha técnica → Supabase (já modelada, só ligar)
- [ ] Movimentações automáticas por venda (trigger ou Edge Function)
- [ ] Movimentações manuais → banco
- [ ] Inventário salvo → banco
- [ ] Alertas de estoque mínimo → banco
- [ ] Transferências entre lojas → banco

---

### 🟡 FASE 6 — Pagamentos & Financeiro
**Prioridade: Média | Depende da Fase 4**

- [ ] Formas de pagamento → Supabase
- [ ] Pagamentos gravados no banco (`pagamentos`)
- [ ] Movimentações de caixa → banco
- [ ] Fechamento de caixa com cálculo real
- [ ] Relatório de caixa com dados reais
- [ ] Estorno → banco + auditoria

**PIX Stone (fase própria):**
- [ ] Edge Function: criar cobrança Stone (QR dinâmico)
- [ ] Edge Function: webhook de confirmação Stone
- [ ] Credenciais Stone no Supabase Secrets
- [ ] Integrar PIX na mesa do cliente e autoatendimento

---

### 🟡 FASE 7 — Relatórios com Dados Reais
**Prioridade: Média | Depende das Fases 4-5-6**

- [ ] Dashboard → queries reais no Supabase
- [ ] Vendas por período → banco
- [ ] Produtos mais vendidos → banco
- [ ] SLA de cozinha → timestamps reais
- [ ] Relatório de caixa → banco
- [ ] Relatório de clientes → banco
- [ ] CMV real → ficha técnica + movimentações
- [ ] Auditoria → banco (log de ações)

---

### 🟡 FASE 8 — Mesas, Clientes e Dados Transacionais
**Prioridade: Média | Depende da Fase 4**

- [ ] Mesas → Supabase (status em tempo real via Realtime)
- [ ] Mesa clientes → banco
- [ ] Chamados de garçom → banco + Realtime
- [ ] Clientes → banco (histórico de pedidos real)
- [ ] Usuários e permissões → banco

---

### 🟢 FASE 9 — Notificações Push
**Prioridade: Complementar | Depende da Fase 4**

- [ ] Service Worker para Web Push API
- [ ] Edge Function para enviar notificações
- [ ] Alerta de novo pedido no KDS
- [ ] Alerta de SLA estourado
- [ ] Alerta de chamado de garçom
- [ ] Alerta de pedido pronto para entrega

---

### 🟢 FASE 10 — Modo Offline (Caixa)
**Prioridade: Complementar | Depende da Fase 4**

- [ ] Service Worker + IndexedDB para o PDV Caixa
- [ ] Fila de sincronização de pedidos
- [ ] Sincronização automática ao reconectar
- [ ] Cardápio cacheado offline
- [ ] UI de indicador de modo offline

---

### 🔵 FASE 11 — Produção & Qualidade
**Prioridade: Final**

- [ ] Testes de integração nos fluxos principais
- [ ] Configurar domínio customizado
- [ ] Regras de backup automático no Supabase
- [ ] Monitoramento de erros (ex: Sentry)
- [ ] Modo Treino com dados isolados
- [ ] Documentação de uso

---

## ORDEM DE EXECUÇÃO RECOMENDADA

```
Fase 1 (Supabase Setup)
    └── Fase 2 (Auth Real)
            └── Fase 3 (Cardápio Real)
                    └── Fase 4 (Pedidos + KDS Real)  ← NÚCLEO
                            ├── Fase 5 (Estoque)
                            ├── Fase 6 (Pagamentos + PIX)
                            ├── Fase 7 (Relatórios)
                            └── Fase 8 (Mesas/Clientes)
                                        ├── Fase 9 (Push)
                                        ├── Fase 10 (Offline)
                                        └── Fase 11 (Produção)
```

**A Fase 4 é o coração do sistema.** Quando os pedidos estiverem persistindo no banco e o KDS rodar via Realtime, o sistema já estará operacionalmente funcional para um piloto real.

---

## 2. Estrutura de Páginas

### Autenticação
- `/login` — Login por email+senha ou matrícula+senha

### Admin / Gerente
- `/dashboard` — Dashboard tempo real (faturamento, pedidos, mesas, alertas)
- `/cardapio` — Gestão do cardápio (categorias, itens, combos)
- `/cardapio/categorias` — Categorias
- `/cardapio/itens` — Itens
- `/cardapio/itens/:id` — Detalhe/edição de item (grupos de opções, promoções, ficha técnica)
- `/cardapio/combos` — Combos
- `/mesas` — Gestão de mesas (mapa visual, QR codes)
- `/estoque` — Gestão de insumos e estoque
- `/estoque/insumos` — Cadastro de insumos
- `/estoque/movimentacoes` — Entradas, saídas, perdas
- `/estoque/inventario` — Inventário real vs teórico
- `/relatorios` — Relatórios detalhados (vendas, caixa, garçons, tempos, clientes)
- `/relatorios/auditoria` — Log de auditoria
- `/configuracoes` — Configurações do sistema
- `/usuarios` — Gestão de usuários e permissões

### PDV — Caixa
- `/pdv/caixa` — Terminal do caixa (carrinho, mesas, KDS view, pedidos)

### PDV — Garçom (mobile-first)
- `/pdv/garcom` — Terminal do garçom (mesas, pedidos, chamados)

### PDV — Mesa do Cliente (QR Code)
- `/mesa/:mesaId` — Cardápio do cliente via QR Code (público, sem login)

### PDV — Autoatendimento (Tablet)
- `/autoatendimento` — Terminal de autoatendimento

### KDS — Cozinha
- `/kds` — Kitchen Display System (Kanban 4 fases)
- `/kds/:estacaoId` — KDS de estação específica

---

## 3. Funcionalidades Core

### Autenticação & Usuários
- [ ] Login por email+senha
- [ ] Login por matrícula+senha
- [ ] 5 perfis: Admin, Gerente, Caixa, Garçom, Operador de Cozinha
- [ ] Permissões por papel configuráveis
- [ ] Modo Treino (dados isolados)

### Cardápio
- [ ] Categorias (criar/editar/excluir/reordenar, vinculada a estação)
- [ ] Itens (nome, descrição, preço, foto, SLA, ficha técnica, status)
- [ ] Grupos de opções/adicionais (obrigatório/opcional, min/max, preço por opção)
- [ ] Observações pré-cadastradas por item + globais
- [ ] Promoções por item (dias da semana, pontual ou semanal)
- [ ] Combos (itens existentes ou exclusivos)

### PDV Caixa
- [ ] Carrinho com categorias + itens + busca
- [ ] Fluxo: montar → destino → KDS
- [ ] Destinos: fechar na hora, mesa, delivery, nome, senha
- [ ] Rascunho de carrinho
- [ ] Abertura/fechamento de caixa com resumo financeiro
- [ ] Sangria / suprimento com motivo
- [ ] Desconto (percentual ou fixo) com senha Gerente/Admin
- [ ] Pagamento: múltiplas formas, divisão de conta, gorjeta, taxa de serviço, troco
- [ ] PIX via Stone (QR dinâmico + webhook)
- [ ] Impressão via window.print
- [ ] Painel de mesas
- [ ] Visualização KDS em tempo real
- [ ] Lista de pedidos da sessão com rastreio completo
- [ ] Offline com sync automático (Service Worker + IndexedDB)

### PDV Garçom (Mobile)
- [ ] Interface mobile-first
- [ ] Selecionar mesa, montar pedido progressivamente
- [ ] Marcar entregue, fechar mesa
- [ ] Chamados de clientes (fila, som, push)
- [ ] Pagamento igual ao caixa

### PDV Mesa Cliente (QR Code)
- [ ] Acesso público via QR Code
- [ ] Identificação: nome + celular
- [ ] Responsável da mesa, aprovação de entrada, transferência
- [ ] Pedidos individuais por cliente
- [ ] PIX: QR Code dinâmico Stone
- [ ] Chamar garçom para finalizar (outros pagamentos)

### PDV Autoatendimento (Tablet)
- [ ] Interface touch otimizada
- [ ] Identificação por senha ou nome (configurável)
- [ ] Pagar na hora (PIX) ou na entrega
- [ ] Pedido vai direto pro KDS

### KDS
- [ ] Kanban 4 fases: Novos / Em Preparo / Prontos / Entregues
- [ ] Visualização por estação (operador vê só os seus)
- [ ] Alerta de pedidos pendentes em outras estações
- [ ] Card 3 níveis (fechado / expandido / item aberto)
- [ ] Cronômetro com SLA (verde/amarelo/vermelho)
- [ ] Observações em destaque
- [ ] Rastreamento completo: hora entrada, início preparo, pronto, entregue, operador
- [ ] Multi-estação: pronto quando todas estações terminam
- [ ] Entrega parcial
- [ ] Alertas: novo pedido (som + pisca), SLA ultrapassado (push)

### Cancelamentos & Modificações
- [ ] Regras por fase (livre → senha Gerente → só estorno)
- [ ] Adicionar/remover itens pós-KDS
- [ ] Motivo obrigatório + auditoria

### Gestão de Mesas
- [ ] Mapa visual do salão
- [ ] Transferir pedido entre mesas
- [ ] Juntar mesas
- [ ] QR Code por mesa (fixo, regenerável)

### Chamados do Garçom
- [ ] Fila por ordem de chegada
- [ ] Confirmação por cliente e garçom
- [ ] Lembrete automático (som + push)

### Notificações
- [ ] Push notifications via Web Push API + Service Workers
- [ ] Som + visual no KDS
- [ ] Alertas por tipo de evento (tabela mapeada)

### Pagamentos
- [ ] Cadastro de formas de pagamento
- [ ] PIX automático via Stone API
- [ ] Estorno com senha Gerente + motivo

### Ficha Técnica & Estoque
- [ ] Cadastro de insumos (nome, unidade, preço)
- [ ] Ficha técnica vinculada ao item (gramagem por insumo)
- [ ] Saída automática por venda
- [ ] Saída manual / perda com motivo
- [ ] Inventário real vs teórico
- [ ] Alerta de estoque mínimo
- [ ] Transferência entre lojas

### Relatórios
- [ ] Dashboard tempo real
- [ ] Vendas totais, por hora, por categoria, por forma de pagamento
- [ ] Ticket médio, ranking de itens, pedidos por origem
- [ ] Tempos de cozinha por item
- [ ] Relatório de caixa (abertura/movimentos/fechamento)
- [ ] Relatório de garçons
- [ ] Relatório de estoque
- [ ] Dashboard de clientes KPI
- [ ] Log de auditoria

### Configurações
- [ ] Dados da loja (nome, endereço, logo, CNPJ)
- [ ] Mesas, estações da cozinha
- [ ] Formas de pagamento, taxa de serviço
- [ ] Credenciais Stone (PIX)
- [ ] Impressão automática
- [ ] Autoatendimento (senha ou nome; pagar na hora ou entrega)
- [ ] Mensagens de boas-vindas
- [ ] Modo treino por usuário

---

## 4. Modelo de Dados (Supabase)

> **Regras globais de schema:**
> - Toda tabela tem `criado_em timestamptz DEFAULT now()`
> - Tabelas mutáveis têm `atualizado_em timestamptz DEFAULT now()` com trigger
> - Credenciais Stone ficam em Supabase Edge Function Secrets (não no banco)
> - Numeração de pedidos: formato `Pddmmaa000x` (ex: P310325001) — sequencial por sessão, inicia em 001 na abertura e para no fechamento

### tenants
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| nome | text | Nome da empresa |
| cnpj | text | CNPJ |
| logo_url | text | Logo |
| plano | text | 'trial' / 'basic' / 'pro' DEFAULT 'trial' |
| ativo | bool | DEFAULT true |
| criado_em | timestamptz | DEFAULT now() |

### lojas
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| tenant_id | uuid | FK tenants |
| nome | text | Nome da loja |
| endereco | text | Endereço completo |
| telefone | text | Telefone de contato |
| email | text | E-mail da loja |
| cnpj | text | CNPJ da unidade |
| logo_url | text | Logo da unidade |
| ativo | bool | DEFAULT true |
| configuracoes | jsonb | Config operacional (ConfigOperacao do frontend) |
| criado_em | timestamptz | DEFAULT now() |

### usuarios
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK = Supabase Auth UID |
| tenant_id | uuid | FK tenants |
| loja_id | uuid | FK lojas (null = acesso a todas) |
| nome | text | Nome completo |
| email | text | E-mail para login (Supabase Auth) |
| matricula | text | Matrícula numérica para login PIN |
| pin_hash | text | Hash do PIN (bcrypt via Edge Function) |
| perfil | text | 'admin' / 'gerente' / 'caixa' / 'garcom' / 'cozinha' |
| foto_url | text | Foto do perfil |
| modo_treino | bool | DEFAULT false |
| ativo | bool | DEFAULT true |
| ultimo_acesso | timestamptz | Atualizado a cada login |
| criado_em | timestamptz | DEFAULT now() |

### estacoes_cozinha
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| loja_id | uuid | FK lojas |
| nome | text | Ex: Grelha, Frituras, Balcão |
| cor | text | Cor hex (#f97316) para UI |
| ordem | int | Ordenação na tela |
| sla_minutos | int | SLA padrão da estação |
| ativo | bool | DEFAULT true |
| criado_em | timestamptz | DEFAULT now() |

### categorias
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| loja_id | uuid | FK lojas |
| nome | text | Nome da categoria |
| estacao_id | uuid | FK estacoes_cozinha |
| ordem | int | Ordenação |
| ativo | bool | DEFAULT true |
| criado_em | timestamptz | DEFAULT now() |

### itens
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| loja_id | uuid | FK lojas |
| categoria_id | uuid | FK categorias |
| nome | text | Nome do item |
| descricao | text | Descrição |
| preco | numeric | Preço base |
| foto_url | text | Foto |
| sla_minutos | int | SLA em minutos |
| sem_preparo | bool | DEFAULT false — pula KDS (ex: refrigerante) |
| ordem | int | Ordenação dentro da categoria |
| canais | jsonb | {caixa, garcom, delivery, autoatendimento, mesa_qr} booleans |
| status | text | 'ativo' / 'inativo' |
| criado_em | timestamptz | DEFAULT now() |
| atualizado_em | timestamptz | DEFAULT now() |

### grupos_opcoes
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| item_id | uuid | FK itens |
| nome | text | Nome do grupo |
| obrigatorio | bool | Se é obrigatório |
| min_selecao | int | Mínimo de seleções |
| max_selecao | int | Máximo de seleções |
| ordem | int | Ordenação |

### opcoes
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| grupo_id | uuid | FK grupos_opcoes |
| nome | text | Nome da opção |
| preco_adicional | numeric | Preço adicional |
| ativo | bool | DEFAULT true |

### observacoes_item
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| item_id | uuid | FK itens (null = observação global) |
| loja_id | uuid | FK lojas |
| texto | text | Texto da observação |

### promocoes_item
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| item_id | uuid | FK itens |
| preco_promocional | numeric | Preço promocional |
| tipo | text | 'semanal' / 'pontual' |
| dias_semana | int[] | Dias ativos (0=dom..6=sab) |
| data_especifica | date | Para tipo pontual |
| ativo | bool | DEFAULT true |

### combos
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| loja_id | uuid | FK lojas |
| nome | text | Nome do combo |
| descricao | text | Descrição |
| foto_url | text | Foto |
| preco | numeric | Preço do combo |
| categoria_id | uuid | FK categorias (para exibição) |
| sla_minutos | int | SLA do combo |
| ativo | bool | DEFAULT true |
| criado_em | timestamptz | DEFAULT now() |

### combo_itens
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| combo_id | uuid | FK combos |
| item_id | uuid | FK itens (null = item exclusivo do combo) |
| nome | text | Nome se item exclusivo |
| quantidade | int | Quantidade |

### mesas
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| loja_id | uuid | FK lojas |
| numero | int | Número da mesa |
| qr_code | text | Código do QR |
| status | text | 'livre' / 'ocupada' |
| capacidade | int | Capacidade de pessoas |
| area | text | 'Salão' / 'Terraço' / 'Varanda' etc |
| posicao_x | numeric | Posição X no mapa visual |
| posicao_y | numeric | Posição Y no mapa visual |
| ativo | bool | DEFAULT true |
| criado_em | timestamptz | DEFAULT now() |

### sessoes_caixa
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| loja_id | uuid | FK lojas |
| numero | text | Identificador legível ex: SESS-20250115-001 |
| usuario_id | uuid | FK usuarios (quem abriu) |
| usuario_fechamento_id | uuid | FK usuarios (quem fechou) |
| valor_abertura | numeric | Valor declarado na abertura |
| valor_fechamento | numeric | Valor declarado no fechamento |
| observacoes | text | Observações do fechamento |
| modo_treino | bool | DEFAULT false |
| ultimo_numero_pedido | int | DEFAULT 0 — incrementado a cada pedido criado na sessão |
| aberto_em | timestamptz | |
| fechado_em | timestamptz | |

### sessoes_kds
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| loja_id | uuid | FK lojas |
| sessao_caixa_id | uuid | FK sessoes_caixa (null = independente) |
| estacao_id | uuid | FK estacoes_cozinha (null = "Todas") |
| operador_id | uuid | FK usuarios |
| aberta_em | timestamptz | DEFAULT now() |
| encerrada_em | timestamptz | |

### pedidos
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| loja_id | uuid | FK lojas |
| sessao_id | uuid | FK sessoes_caixa |
| numero | text | Formato Pddmmaa000x — sequencial por sessão |
| origem | text | 'caixa' / 'garcom' / 'mesa' / 'autoatendimento' / 'delivery' |
| destino | text | 'hora' / 'mesa' / 'delivery' / 'nome' / 'senha' |
| mesa_id | uuid | FK mesas |
| nome_cliente | text | Para balcão / delivery / nome |
| telefone_cliente | text | Para delivery |
| endereco_entrega | text | Endereço completo de entrega |
| taxa_entrega | numeric | DEFAULT 0 |
| senha | text | Para chamada por senha |
| status | text | 'rascunho' / 'aberto' / 'pronto' / 'entregue' / 'cancelado' |
| valor_total | numeric | Total com adicionais |
| desconto | numeric | DEFAULT 0 |
| taxa_servico | numeric | DEFAULT 0 |
| gorjeta | numeric | DEFAULT 0 |
| modo_treino | bool | DEFAULT false |
| usuario_criacao | uuid | FK usuarios |
| criado_em | timestamptz | DEFAULT now() |
| atualizado_em | timestamptz | DEFAULT now() |

> **Lógica de numeração:** A sessão guarda o último número em `sessoes_caixa.ultimo_numero_pedido int DEFAULT 0`. Ao criar pedido, incrementa via função e monta `P` + dd + mm + aa + zero-pad(3) do incremento. Ex: 1º pedido da sessão em 31/03/25 → `P3103250001`.

### pedido_itens
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| pedido_id | uuid | FK pedidos |
| item_id | uuid | FK itens |
| nome_item | text | Snapshot do nome |
| preco_unitario | numeric | Snapshot do preço |
| quantidade | int | Quantidade |
| sem_preparo | bool | Snapshot do item.sem_preparo |
| observacao_livre | text | Texto livre |
| status | text | 'novo' / 'preparo' / 'pronto' / 'entregue' / 'cancelado' |
| estacao_id | uuid | FK estacoes_cozinha |
| operador_id | uuid | FK usuarios (quem preparou) |
| entregue_por | uuid | FK usuarios |
| entrou_kds_em | timestamptz | |
| iniciou_preparo_em | timestamptz | |
| ficou_pronto_em | timestamptz | |
| entregue_em | timestamptz | |

### pedido_item_partes
> Itens multi-estação (ex: X-Burguer tem parte Grelha + parte Montagem)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| pedido_item_id | uuid | FK pedido_itens |
| nome | text | Ex: 'Hambúrguer', 'Montagem' |
| estacao_id | uuid | FK estacoes_cozinha |
| sla_minutos | int | SLA específico da parte |
| status | text | 'novo' / 'preparo' / 'pronto' / 'entregue' |
| operador_id | uuid | FK usuarios |
| iniciou_preparo_em | timestamptz | |
| ficou_pronto_em | timestamptz | |
| entregue_em | timestamptz | |
| ordem | int | Ordem das partes |

### pedido_item_opcoes
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| pedido_item_id | uuid | FK pedido_itens |
| opcao_id | uuid | FK opcoes |
| nome_opcao | text | Snapshot |
| preco_adicional | numeric | Snapshot |

### pedido_item_observacoes
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| pedido_item_id | uuid | FK pedido_itens |
| observacao_id | uuid | FK observacoes_item (null se texto livre) |
| texto | text | Texto da observação |

### pagamentos
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| pedido_id | uuid | FK pedidos |
| forma_pagamento_id | uuid | FK formas_pagamento |
| valor | numeric | Valor pago |
| troco | numeric | DEFAULT 0 |
| pix_qr_code | text | QR Code PIX (Stone) |
| pix_txid | text | TxID Stone |
| status | text | 'pendente' / 'confirmado' / 'estornado' |
| pago_em | timestamptz | |

### formas_pagamento
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| loja_id | uuid | FK lojas |
| nome | text | Ex: Dinheiro, Crédito |
| tipo | text | 'dinheiro' / 'credito' / 'debito' / 'pix' / 'vale' |
| taxa_percentual | numeric | DEFAULT 0 — taxa da bandeira |
| exige_troco | bool | DEFAULT false — só dinheiro |
| ordem | int | Ordenação na tela |
| ativo | bool | DEFAULT true |
| criado_em | timestamptz | DEFAULT now() |

### movimentacoes_caixa
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| sessao_id | uuid | FK sessoes_caixa |
| tipo | text | 'suprimento' / 'sangria' |
| valor | numeric | Valor |
| motivo | text | Motivo obrigatório |
| usuario_id | uuid | FK usuarios |
| criado_em | timestamptz | DEFAULT now() |

### insumos
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| loja_id | uuid | FK lojas |
| nome | text | Nome do insumo |
| categoria | text | 'Carnes' / 'Bebidas' / 'Embalagens' etc |
| fornecedor | text | Nome do fornecedor |
| unidade | text | 'kg' / 'g' / 'l' / 'ml' / 'un' |
| custo_unitario | numeric | Preço de custo por unidade |
| estoque_minimo | numeric | Alerta de estoque mínimo |
| estoque_atual | numeric | Calculado por triggers |
| criado_em | timestamptz | DEFAULT now() |

### ficha_tecnica
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| item_id | uuid | FK itens |
| insumo_id | uuid | FK insumos |
| gramagem | numeric | Quantidade consumida por unidade do item |

### movimentacoes_estoque
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| loja_id | uuid | FK lojas |
| insumo_id | uuid | FK insumos |
| tipo | text | 'entrada' / 'saida_venda' / 'saida_manual' / 'perda' / 'transferencia' |
| quantidade | numeric | Quantidade movimentada |
| custo_unitario | numeric | Snapshot do custo no momento (para CMV real) |
| motivo | text | Motivo (se manual) |
| pedido_id | uuid | FK pedidos (se saida_venda) |
| usuario_id | uuid | FK usuarios |
| criado_em | timestamptz | DEFAULT now() |

### log_auditoria
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| loja_id | uuid | FK lojas |
| usuario_id | uuid | FK usuarios |
| tipo_acao | text | Tipo da ação |
| detalhes | jsonb | Valores antes/depois |
| terminal | text | 'pdv_caixa' / 'kds' / 'garcom' / 'delivery' etc |
| ip_address | text | IP do terminal |
| criado_em | timestamptz | DEFAULT now() |

### mesa_clientes
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| mesa_id | uuid | FK mesas |
| sessao_mesa_id | uuid | Agrupamento de uma abertura de mesa |
| nome | text | Nome do cliente |
| telefone | text | Celular |
| responsavel | bool | DEFAULT false |
| entrou_em | timestamptz | DEFAULT now() |

### chamados_garcom
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| mesa_id | uuid | FK mesas |
| motivo | text | 'atendimento' / 'pagamento' |
| status | text | 'pendente' / 'confirmado' |
| solicitado_em | timestamptz | DEFAULT now() |
| confirmado_em | timestamptz | |
| confirmado_por | uuid | FK usuarios |

---

## 5. Integrações

- **Supabase:** Auth (login email+senha e matrícula), PostgreSQL, Realtime (pedidos/KDS ao vivo), Storage (fotos de itens, logos), Edge Functions (PIX Stone, webhooks)
- **Stone API:** PIX dinâmico com QR Code + webhook de confirmação (Edge Function)
- **Web Push API + Service Workers:** Notificações push para garçons/caixa/gerente
- **IndexedDB + Service Worker:** Modo offline para o terminal caixa

---

## MÓDULO DE PRODUÇÃO (Semi-acabados)

### Problema que resolve
Alguns insumos brutos sofrem transformação antes de virarem itens vendáveis:
- **Carne moída** → 100% da carne moída entra, mas cozinhando rende menos (perda de peso por água/gordura)
- **Abacate** → compra-se a fruta inteira, mas descarta-se casca e semente para fazer guacamole
- **Coxinha de frango** → frango cru + farinha de trigo, mas depois da fritura absorve óleo e muda de peso

### Conceitos

| Conceito | Descrição |
|----------|-----------|
| **Ficha de Produção** | Receita de um produto semi-acabado: insumos brutos → quantidades → rendimento % |
| **Produto Semi-acabado** | Item que sai do estoque (ex: "Carne moída cozida", "Guacamole pronto", "Coxinha frita") |
| **Batelada** | Execução da ficha: X unidades brutas entram, Y unidades semi-acabadas saem |
| **Rendimento** | % do peso bruto que vira peso do produto acabado |
| **Custo da Batelada** | (soma dos custos dos insumos brutos usados) / (quantidade produzida) |

### Fluxo de batelada

```
1. Usuário registra batelada de "Carne moída cozida":
   - Insumo: "Carne moída (cruda)" → 5 kg
   - Rendimento: 80% → produz 4 kg de carne cozida
   
2. Sistema faz:
   a. Baixa 5 kg de "Carne moída (cruda)" do estoque
   b. Gera 4 kg de "Carne moída cozida" no estoque (produto semi-acabado)
   c. Custo unitário da batelada = custo_total / 4 kg
   d. Atualiza o preço de venda sugerido dos itens que usam esse produto

3. Na venda de "Pastel de carne":
   - Ficha técnica do pastel usa 150g de "Carne moída cozida"
   - Sistema baixa 150g do estoque de "Carne moída cozida"
   - NÃO baixa carne crua — já foi baixada na batelada
```

### Tabelas (mock/backend)

#### production_recipes (Fichas de Produção)
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| tenant_id | uuid | FK tenants |
| name | text | Ex: "Carne moída cozida", "Guacamole pronto" |
| unit | text | 'kg', 'g', 'L', 'ml', 'un' |
| yield_percent | numeric | % de rendimento (0-100) |
| instructions | text | Modo de preparo |
| is_active | bool | DEFAULT true |

#### production_recipe_items (Insumos da ficha)
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| recipe_id | uuid | FK production_recipes |
| ingredient_id | uuid | FK ingredients |
| quantity | numeric | Quantidade usada por unidade de saída |
| unit | text | Unidade do insumo |

#### production_batches (Bateladas)
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| tenant_id | uuid | FK tenants |
| recipe_id | uuid | FK production_recipes |
| produced_quantity | numeric | Quantidade produzida |
| unit | text | Unidade de saída |
| yield_percent_actual | numeric | Rendimento real da batelada |
| total_cost | numeric | Custo total dos insumos usados |
| unit_cost | numeric | Custo unitário do produto gerado |
| produced_by | uuid | FK users |
| produced_at | timestamptz | DEFAULT now() |
| notes | text | Observações |

---

## 6. Plano de Fases

### Fase 1: Fundação — Login + Layout + Dashboard ✅ ← ATUAL
- **Meta:** Estrutura base do sistema, tela de login funcional, layout do painel admin, dashboard com dados mock
- **Entregável:** Login, sidebar de navegação, dashboard do gerente com métricas, navegação entre seções

### Fase 2: Gestão do Cardápio
- **Meta:** CRUD completo de categorias, itens, grupos de opções, observações e promoções
- **Entregável:** Páginas funcionais de gerenciamento do cardápio

### Fase 3: PDV Caixa — Interface e Fluxo de Pedido
- **Meta:** Interface completa do caixa, montagem de pedidos, destinos, rascunho
- **Entregável:** Terminal do caixa funcional com mock data

### Fase 4: KDS — Kitchen Display System
- **Meta:** Kanban 4 fases, cards 3 níveis, cronômetro, SLA, multi-estação
- **Entregável:** Tela KDS funcional com mock data

### Fase 5: PDV Garçom (Mobile)
- **Meta:** Interface mobile-first do garçom, pedido progressivo, chamados
- **Entregável:** Terminal garçom funcional

### Fase 6: PDV Mesa (QR Code)
- **Meta:** Fluxo completo do cliente via QR Code, responsável, pedidos individuais
- **Entregável:** Página pública da mesa funcional

### Fase 7: PDV Autoatendimento (Tablet)
- **Meta:** Interface touch para autoatendimento
- **Entregável:** Terminal autoatendimento funcional

### Fase 8: Gestão de Mesas
- **Meta:** Mapa visual, QR codes, transferência, juntar mesas
- **Entregável:** Página de gestão de mesas completa

### Fase 9: Pagamentos & Operações de Caixa
- **Meta:** Formas de pagamento, divisão de conta, gorjeta, abertura/fechamento de caixa, sangria/suprimento
- **Entregável:** Fluxo de pagamento completo no PDV

### Fase 10: Relatórios
- **Meta:** Dashboard em tempo real + relatórios detalhados com filtros
- **Entregável:** Todas as telas de relatório

### Fase 11: Estoque, Ficha Técnica e Produção
- **Meta:** Cadastro de insumos, ficha técnica de itens, movimentações, inventário e controle de produção (produtos semi-acabados com rendimento, perda e repreço)
- **Entregável:** Módulo de estoque completo + aba de Produção
- **Status:** ✅ UI completa com mock data. Refatorado:
  - Ficha de Produção: removido rendimento esperado global, custo estimado = soma bruta dos insumos
  - Registro de Produção: rendimento real calculado automaticamente (produzido ÷ insumos × 100)
  - Insumos: novo flag `usageType` ('final' | 'production') no cadastro
  - Ficha Técnica do Cardápio: agora permite selecionar insumos de uso final E produtos de produção
  - "Batelada" renomeado para "Registro de Produção" em toda a UI

### Fase 12: Supabase — Backend e Dados Reais
- **Meta:** Conectar Supabase, criar tabelas, migrar toda a lógica de mock para real, Auth, Realtime
- **Entregável:** Sistema funcionando com backend real

### Fase 13: PIX Stone + Notificações Push
- **Meta:** Edge Functions para PIX, webhook Stone, Web Push API
- **Entregável:** PIX funcionando, push notifications

### Fase 14: Offline + Configurações + Auditoria
- **Meta:** Service Worker + IndexedDB no caixa, configurações do sistema, log de auditoria, modo treino
- **Entregável:** Sistema completo e pronto para produção
