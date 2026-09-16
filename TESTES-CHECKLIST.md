# Checklists de teste por módulo — ERPOS V2

Estado: **v1 — revisado pelo dono em 2026-09-15** (respostas na seção "Decisões do dono", no fim).
Itens marcados com 🚫 não podem ser testados por agente (dinheiro real, hardware em uso,
terceiros sem API) — só o dono. Itens ❓ ainda dependem de resposta.

## Como usar (agentes e pessoas)

- Cada passo é **Ação → Esperado**. Se o "Esperado" não acontecer, é falha; não há "quase".
- **Ambiente**: produção, loja **"Testes PDV"** (`tenant_id db3ca014-6c03-4c2e-97b9-9542cf825da2`,
  slug `testes-pdv-1777515908321`). O dono autorizou fazer **qualquer coisa** nela. Fora dela,
  só leitura. Em lojas reais, se for inevitável, **Modo Treino ligado** (pedidos
  `is_training = true` não emitem NFC-e, não entram em relatório nem DRE).
- **Usuários de teste** (loja Testes PDV): admin, caixa e garçom com e-mail, senha, crachá e PIN
  em `.test-users.json` (gitignored). Recriar/rotacionar: `scripts/seed-test-users.mjs`
  (precisa de `SUPABASE_SERVICE_ROLE_KEY` no ambiente; a chave sai de
  `npx supabase projects api-keys --project-ref mdghhjemzdmeuqpzuyzx`). Crachás 9001/9002/9003.
- **Evidência** = `read_page` do estado final, ou screenshot, ou `SELECT` na tabela citada.
  "Cliquei e não deu erro" não é evidência.
- **Invariantes globais** (valem em todo checklist):
  1. Nada de outra loja aparece (trocar de loja e conferir que listas, impressoras e config zeram).
  2. Nenhuma escrita com `tenant_id` diferente da loja atual.
  3. Sem erro no console (`read_console_messages`), sem 4xx/5xx nas Edge Functions (`read_network_requests`).
  4. `npm run check` continua verde.
- Prefixo de cada checklist = módulo. O Testador escolhe pelo(s) arquivo(s) tocados no diff
  (tabela "Arquivo → módulo" no fim).

---

## 1. Login, loja e perfis

Pré: `qa.admin` (admin), `qa.caixa` (caixa) e `qa.garcom` (garçom) de `.test-users.json`.
Para 1.3 (multi-loja) use o dono (`natalinojr.engel@gmail.com`) 🚫 — só ele tem várias lojas;
ou vincule `qa.admin` a uma segunda loja de teste pelo Admin Master antes.

| # | Ação | Esperado |
|---|---|---|
| 1.1 | Login com e-mail/senha válidos | Vai para `/selecionar-loja` (multi-loja) ou `/modulos` (1 loja) |
| 1.2 | Login com senha errada | Mensagem de erro, permanece em `/login`, sem tela branca |
| 1.3 | Selecionar loja A, abrir `/configuracoes`; trocar para loja B | Impressoras, config e listas da loja A **não** aparecem na B |
| 1.4 | Login por PIN no kiosk/PDV (`login-pin`) com PIN válido | Sessão abre com o perfil certo |
| 1.5 | Login por PIN com senha > 72 bytes cadastrada (caso bcrypt) | Não trava, autentica (regressão do go-live 07-12) |
| 1.6 | Perfil garçom tenta abrir `/financeiro` pela URL | Bloqueado/redirecionado; menu não mostra o módulo |
| 1.7 | Sessão expirada (token velho) ao clicar em qualquer ação | Refresh silencioso ou volta ao login; nunca "erro genérico" preso |

## 2. PDV Caixa

Pré: Modo Treino ON; caixa fechado; cardápio com ≥ 2 itens e 1 item com opcionais.

| # | Ação | Esperado |
|---|---|---|
| 2.1 | Abrir caixa com fundo R$ 100 | `cash_registers` abre com `opening_amount=100`; tela mostra "aberto" |
| 2.2 | Venda: 1 item simples, dinheiro R$ 50 sobre R$ 38 | Troco R$ 12; `orders.status` avança; `payments` com 1 linha de R$ 38 |
| 2.3 | Venda com item + opcional pago + observação | `order_item_options` e `order_item_observations` gravados; total = item + opcional |
| 2.4 | Venda paga em 2 formas (Pix + cartão) | 2 linhas em `payments`, soma = total; no grupo, nenhum pagamento grava o total do grupo (bug do rateio 07-17) |
| 2.5 | Desconto de R$ 5 em pedido de R$ 38 | `order_discounts` gravado; total 33; pagamento de 33 fecha |
| 2.6 | Cancelar item já lançado antes de pagar | `fn_cancel_order_item`; total recalculado; KDS remove o item |
| 2.7 | Cancelar pedido pago (estorno) | `fn_cancel_and_refund_order`; `refunds` gravado; caixa desconta |
| 2.8 | Sangria R$ 30 e suprimento R$ 20 | `cash_movements` out=30, in=20; saldo esperado = 100 + vendas − 30 + 20 |
| 2.9 | Fechar caixa | Relatório de fechamento bate com a soma acima; caixa não aceita venda depois |
| 2.10 | Enviar mesmo pedido 2× rápido (duplo clique) | 1 pedido só (`client_request_id` dedup) |
| 2.11 | Pedido de treino | Não aparece em `/relatorios`, não emite NFC-e, não entra na DRE |

## 3. Mesas, garçom e QR da mesa

Pré: mesa 1 livre; QR da mesa 1 impresso ou URL `/mesa-qr/<token>`.

| # | Ação | Esperado |
|---|---|---|
| 3.1 | Garçom abre mesa 1 e lança 2 itens | `table_sessions` aberta; itens no KDS com "Mesa 1" |
| 3.2 | Cliente abre QR da mesa 1 no celular, informa nome | `table_session_participants` com `access_token` sequencial a partir de 300 **por sessão de caixa** |
| 3.3 | Segundo cliente entra na mesma mesa | Token = anterior + 1; ambos veem a mesma conta |
| 3.4 | Cliente pede pelo QR | Pedido com `origin=table`, cai no KDS, aparece para o garçom |
| 3.5 | Mesa 0 / QR universal | Vira **fila por senha**, não ocupa mesa (regra 09-13) |
| 3.6 | Chamar garçom pelo QR | `waiter_calls` gravado; garçom vê o aviso |
| 3.7 | Fechar mesa com 2 participantes, pagar dividido | `session-payments` soma = total; sessão fecha; mesa volta a livre |
| 3.8 | Pagar mesa online (Mercado Pago) 🚫 token real pendente | Só até a criação da preferência; settle não testável ainda |
| 3.9 | QR de mesa já fechada | Mensagem "sessão encerrada", não deixa pedir |
| 3.10 | Reserva para mesa 1 às 20h | `table_reservations`; mesa mostra reservada no horário |

## 4. Delivery (cardápio público, PDV delivery, motoboy)

Pré: bairro com taxa cadastrada em `/config-delivery`; loja com slug.

| # | Ação | Esperado |
|---|---|---|
| 4.1 | Abrir `/<slug>-delivery` sem login | Cardápio carrega; itens de outra loja não aparecem |
| 4.2 | Cliente novo: nome, telefone, endereço em bairro com taxa R$ 7 | Taxa aplicada; `delivery_customers` + `delivery_customer_addresses` criados |
| 4.3 | Mesmo telefone de novo | Endereço anterior sugerido; não duplica cliente |
| 4.4 | Endereço fora da área (ou distância acima do limite ORS) | Recusa com mensagem clara, não cria pedido |
| 4.5 | Pedido delivery pelo PDV Caixa (fluxo 08-29) | `origin=cashier`, `destination=delivery`, taxa e telefone gravados |
| 4.6 | Gestor de entregas: atribuir motoboy e enviar sinal | Motoboy abre `/motoboy/<id>` e vê endereço/rota; `motoboy-signal` OK |
| 4.7 | Motoboy marca "entregue" | `orders.status=delivered`; some da lista `/entregas/<slug>` |
| 4.8 | Pedido iFood 🚫 (sem API integrada; não há como simular) | Só o repasse é testável, via 8.3: cai no Inter sem virar receita (regra iFood) |
| 4.9 | Pedido novo com tela `/gestor-pedidos` aberta | Aparece **sem F5** (orders-ping broadcast) |

## 5. KDS e impressão

Pré: 1 estação de cozinha. Impressora: a **real da El Patron Paranaguá** (autorizado pelo dono).
Regras: cadastrar o IP dela na loja Testes PDV só durante o teste e **remover ao final**; rodar
**fora do horário de operação** (antes das 11h ou depois das 23h de Brasília); no máximo 3
impressões por rodada; `printer-ping` à vontade. 5.6 (impressora fora) = simular com IP inválido
na loja de teste, nunca desligar a real.

| # | Ação | Esperado |
|---|---|---|
| 5.1 | Pedido com 1 item de cozinha + 1 bebida (`skip_kds`) | KDS mostra só o item de cozinha; pedido `status=new` |
| 5.2 | Marcar item "preparando" → "pronto" | `orders.status` = preparing → ready (bebida não trava) |
| 5.3 | Todos entregues | `orders.status = delivered` |
| 5.4 | Pedido pago gera impressão | `print_queue` com **1** job (dedup do go-live); status `pending` → `printed` quando agente pega |
| 5.5 | Agente offline | Job fica `pending` (não `failed`); ao voltar, imprime uma vez |
| 5.6 | Impressora TCP fora | Job `failed` com erro; reclaim de `printing` travado após timeout (edge v18) |
| 5.7 | Reimprimir pelo `/pedidos` | Novo job, mesmo conteúdo; não reimprime os anteriores |
| 5.8 | Trocar de loja com KDS aberto | Estações e pedidos da loja anterior somem |

## 6. Cardápio

| # | Ação | Esperado |
|---|---|---|
| 6.1 | Criar categoria + item com preço e foto | Aparece no PDV e no delivery público na hora |
| 6.2 | Item com grupo de opcionais (mín 1, máx 2) | PDV e QR obrigam 1 e impedem 3 |
| 6.3 | Desativar item | Some do PDV/delivery; pedidos antigos continuam mostrando o nome |
| 6.4 | Ficha técnica: item usa 0,150 kg de insumo | Venda baixa 0,150 do estoque (ver 7.4). Contexto: só ~10% dos itens (22/226, auditoria 07-11) têm ficha técnica, então 90% das vendas não baixam estoque — não é regra, é cobertura baixa; o teste garante que **quem tem ficha** baixa certo |
| 6.5 | Exportar e reimportar template | Mesmo cardápio, sem duplicar itens |
| 6.6 | Campos fiscais (NCM/CFOP) na categoria e no item | Item herda da categoria quando vazio |

## 7. Estoque e compras

Pré: insumo "Carne" 10 kg; fornecedor com CNPJ. NFC-e de teste para 7.5 (nota real, emitida pelo
próprio ERPOS em produção — VL Gastronomia, série 2 nº 3, 15/09/2026, R$ 103,50, Pix):
- chave `41260958193623000108650020000000031033481719`
- QR: `http://www.fazenda.pr.gov.br/nfce/qrcode?p=41260958193623000108650020000000031033481719|2|1|2|97a2b36be1b262a5aaaff59a2249f189afba45bf`
- esperado na leitura: 2 itens ("Burritos Duo Mex" 1 UN R$ 0,00 e "Nachos Chilli con Carne" 1 UN R$ 38,00),
  total R$ 103,50 (R$ 65,50 em "outras despesas" — ver 9.8), fornecedor CNPJ 58.193.623/0001-08.

| # | Ação | Esperado |
|---|---|---|
| 7.1 | Editar nome do insumo | Estoque **não** zera (bug P0 da auditoria 07-11) |
| 7.2 | Lançar perda de 1 kg | Estoque 9 kg; `stock_movements` tipo perda; **não soma** (bug P0) |
| 7.3 | Inventário: contar 8,5 kg | Ajuste de −0,5; sessão fecha atômica (tudo ou nada) |
| 7.4 | Vender item com ficha técnica | Baixa proporcional; sem ficha, não mexe |
| 7.5 | Nova Compra por QR da NFC-e (SEFAZ-PR) | Itens lidos; vínculo item→insumo lembrado da última vez |
| 7.6 | Nova Compra por foto | Haiku lê; custo ≈ R$ 0,02; itens editáveis antes de salvar |
| 7.7 | Confirmar entrega da compra | Estoque sobe; `fin_purchases` vira conta a pagar; **CMV = compra realizada** |
| 7.8 | Nota de entrada do mês com 3 pagamentos | 1 compra na data de **emissão**, 3 pagamentos vinculados |
| 7.9 | Classificar item da nota como embalagem de delivery | Vai para CMV (regra 09-12), memorizado por fornecedor+código |
| 7.10 | Alerta de estoque crítico | Insumo abaixo do mínimo aparece em `fn_get_stock_critical_alerts` e no assistente |

## 8. Financeiro

Pré: conta a pagar sem categoria DRE; extratos Inter/Stone **reais de ontem** (autorizado pelo dono;
só leitura e conciliação — nunca pagar nada).

| # | Ação | Esperado |
|---|---|---|
| 8.1 | Baixar conta **sem** categoria DRE | `pay_bill` recusa com mensagem; nada grava |
| 8.2 | Classificar e baixar | `fin_cash_flow` gravado; DRE do mês inclui |
| 8.3 | Conciliação Inter × Stone | Repasse Stone casa com crédito Inter; confirmação em lote |
| 8.4 | Pagamento no extrato sem nota | "Lançar pelo extrato" cria despesa/compra; juros da confirmação **gravam** (bug dos 17 antigos) |
| 8.5 | Receitas: fonte única por loja | Pedidos/Stone/Pix/manual não duplicam em Receitas, DRE e Visão Geral |
| 8.6 | "Como o dinheiro entra": trocar maquininha da loja | `fn_money_flow` reflete; conciliação usa a nova |
| 8.7 | DRE do mês | CMV = compras realizadas do mês; nada de treino |
| 8.8 | Comparar "7 dias" vs período anterior | Períodos não se sobrepõem (bug de `getPeriodoAnterior` 09-15) |
| 8.9 | Folha do Domínio (PDF) | Importa sem IA; totais batem com o PDF |
| 8.10 | Pagamento Pix pelo assistente 🚫 dinheiro real | Só lista branca de fornecedores; nunca cadastra fornecedor |

## 9. Fiscal (NFC-e)

Pré: **atenção — a loja Vila Leste já emite em PRODUÇÃO** (tpAmb=1, série 2, desde 15/09/2026;
a homologação foi na série 1). Testes de emissão só na loja Testes PDV com `fiscal_settings` em
**homologação** (série própria); nunca emitir teste em loja real.

| # | Ação | Esperado |
|---|---|---|
| 9.1 | Pagar pedido balcão (não treino) | 1 `fiscal_documents` autorizado; DANFE imprime |
| 9.2 | Mesa com 3 pedidos | **1** nota por sessão de mesa |
| 9.3 | Pedido de treino | Nenhuma nota |
| 9.4 | Item sem NCM | Erro claro antes de emitir, não 500 |
| 9.5 | Cancelar nota em < 30 min | `cancel` autorizado; pedido mantém histórico |
| 9.6 | Provider fora | `retry` reemite depois; pedido não trava |
| 9.7 | Virar para produção 🚫 | Só o dono |
| 9.8 | Pedido delivery com **combo** + taxa de entrega (caso real: nota série 2 nº 3, Vila Leste, 15/09) | ❓ **BUG ABERTO**: o combo foi para a SEFAZ com `vUnCom = 0,00` e o valor dele (R$ 57) somado à taxa (R$ 8,50) entrou em `vOutro = 65,50`; `vProd` da nota ficou 38 em vez de 95. A nota foi autorizada, mas o DANFE mostra o produto a R$ 0,00. Esperado: combo com preço próprio em `vProd`; taxa de entrega em `vFrete` ou `vOutro` separada. Decisão do dono pendente |

## 10. Tarefas (+ PWA)

| # | Ação | Esperado |
|---|---|---|
| 10.1 | Criar tarefa atribuída a outro usuário | `task_notifications` para ele; push chega (se inscrito) |
| 10.2 | Concluir tarefa recorrente semanal | Próxima ocorrência criada com data +7 |
| 10.3 | Campo personalizado tipo número recebe texto | `task-write` recusa |
| 10.4 | Anexo de 11 MB | Recusado (limite 10 MB); 9 MB entra e baixa por URL assinada |
| 10.5 | Trocar de loja | Lista de tarefas zera e recarrega |
| 10.6 | Usuário com acesso só a Tarefas (`tasks_only` / `user_module_access`) | Vê Tarefas, não vê PDV |
| 10.7 | Celular (viewport 375): Kanban, agenda, câmera no anexo | Barra inferior; sem scroll horizontal |
| 10.8 | Deploy novo com app aberto | HTML vem da rede (não do cache); sem chunk quebrado |

## 11. Contratação

| # | Ação | Esperado |
|---|---|---|
| 11.1 | Subir PDF com texto | Lido no navegador (grátis), campos preenchidos, sem chamar IA |
| 11.2 | Subir foto de currículo | Vai para IA; candidato criado |
| 11.3 | Currículo pelo WhatsApp (canal público CV-XXXX) | Entra na vaga certa; confirmação no Telegram do dono |
| 11.4 | Match candidato × vaga | Score 0–100; **não** envia idade/estado civil/filhos para a IA |
| 11.5 | Mover para "Chamar p/ entrevista" com config na vaga | Convite disparado; sem config, nada |
| 11.6 | Usuário sem `is_hiring_admin()` | Não vê `/contratacao` nem os dados (RLS) |
| 11.7 | Distância loja × candidato | Só calcula quando a ficha tem loja |

## 12. Assistente (Telegram e chat no ERPOS)

Pré: chat do dono no Telegram; PIN.

| # | Ação | Esperado |
|---|---|---|
| 12.1 | "como tá a loja hoje?" | Resposta com `fn_get_dashboard_metrics` da loja principal |
| 12.2 | "vendas da loja mall ontem" | Resolve loja por nome parcial; período Brasília |
| 12.3 | Mensagem de número não autorizado no WhatsApp | Ignorada, sem resposta |
| 12.4 | Pedir ação de escrita (criar tarefa) | Executa como o dono; `created_by = owner` |
| 12.5 | Pedir cadastro de fornecedor | Recusa (regra 09-14) |
| 12.6 | Mesma conversa no chat do ERPOS | Histórico igual ao Telegram; PIN igual |
| 12.7 | Update repetido do Telegram (502 → reenvio) | Não responde 2× |
| 12.8 | Toda edge/RPC nova do front | Está em `EDGE_ALLOW`/`erpos_rpc` (regra "faz tudo que a tela faz") |

## 13. Admin Master, usuários e acessos

| # | Ação | Esperado |
|---|---|---|
| 13.1 | Criar loja nova | `setup-tenant` cria tenant + admin; loja aparece em `/selecionar-loja` |
| 13.2 | Vincular usuário a loja B como caixa | Só vê a loja B no próximo login; perfil caixa |
| 13.3 | Remover vínculo | Não entra mais na loja; dados dela somem |
| 13.4 | Adicionar papel novo ❓ (checklist das 4 cópias do mapa PT↔EN) | Aparece em todos os 4 lugares |
| 13.5 | Convite por link | `store_invites` consumido 1×; segundo uso recusado |
| 13.6 | Desativar usuário | Login recusado; PIN recusado |

## 14. Relatórios e dashboard

| # | Ação | Esperado |
|---|---|---|
| 14.1 | Vendas "Hoje" às 23:30 de Brasília | Inclui os pedidos das 21h–23h (dia Brasília, não UTC) |
| 14.2 | "7 dias" | 7 dias-calendário incluindo hoje; anterior = 7 dias antes, sem sobreposição |
| 14.3 | Cancelados e treino | Fora do total; cancelados aparecem no relatório próprio |
| 14.4 | Ticket médio | total ÷ pedidos válidos |
| 14.5 | Loja A vs B | Totais não vazam entre lojas |
| 14.6 | Caixa: `fn_get_cash_sessions_v2` | Fechamento bate com 2.9 |

## 15. Clientes, promoções e vouchers

| # | Ação | Esperado |
|---|---|---|
| 15.1 | Promoção "10% às terças no delivery" | Aplica só terça e só delivery (`isRuleValidForChannel`) |
| 15.2 | Voucher R$ 20, usar 2× | Segunda recusada; `voucher_transactions` 1 linha |
| 15.3 | Link público `/voucher/<token>` | Ativa sem login; token inválido dá erro claro |
| 15.4 | Pontos de fidelidade na venda | `loyalty_transactions` credita; cancelamento estorna |

---

## Arquivo → módulo (para o Testador escolher o checklist)

| Caminho tocado | Checklists |
|---|---|
| `src/pages/login`, `selecionar-loja`, `AuthContext`, `login-pin`, `kiosk-auth` | 1 |
| `src/pages/pdv/caixa`, `PDVContext`, `SessaoContext`, `order-write`, `session-payments` | 2, 14 |
| `src/pages/mesas`, `mesa`, `mesa-qr`, `pdv/garcom`, `mesa-write`, `table-write` | 3 |
| `src/pages/delivery`, `pdv/delivery`, `gestor-entregas`, `motoboy*`, `delivery-write` | 4 |
| `src/pages/kds`, `KDSContext`, `ImpressorasContext`, `printQueue*`, `print-queue-*` | 5 |
| `src/pages/cardapio`, `CardapioContext`, `menu-write` | 6, 2.3 |
| `src/pages/estoque`, `EstoqueContext`, `stock-write`, `purchase-*`, `notas-entrada*` | 7, 8.7 |
| `src/pages/financeiro`, `useFinanceiro*`, `financial-write`, `*conciliation*`, `inter-*` | 8 |
| `fiscal-write`, `fiscal_*`, `src/pages/pedidos?tab=notas` | 9 |
| `src/pages/tarefas`, `task-write`, `sw.js`, `pwa.ts`, `send-push` | 10 |
| `src/pages/contratacao`, `hiring-*`, `canal-publico` | 11 |
| `supabase/functions/assistente-*`, `AssistenteChat` | 12 |
| `src/pages/admin-master`, `usuarios`, `admin-*`, `user-write`, `setup-tenant` | 13 |
| `src/lib/dateUtils.ts`, `src/pages/relatorios`, `dashboard`, `fn_get_*_report` | 14, 8.8 |
| `src/pages/clientes`, `promocoes`, `vouchers`, `voucher-*` | 15 |
| `src/lib/supabase.ts`, `AppProviders`, `router/config.tsx` | 1 + smoke de todos (abrir cada rota sem erro) |

## Decisões do dono (2026-09-15)

1. **Loja de testes**: "Testes PDV" — pode fazer o que quiser nela.
2. **Usuários de teste**: criados pelo Claude (`scripts/seed-test-users.mjs` → `.test-users.json`).
3. **Impressora**: a real da loja de Paranaguá (com as regras da seção 5).
4. **NFC-e de teste**: a nota série 2 nº 3 de 15/09/2026 (dados na seção 7).
5. **Extratos Inter/Stone**: reais, do dia anterior.
6. **"10%" da ficha técnica**: era cobertura (22/226 itens com ficha), não regra — 6.4 reescrito.
7. **iFood**: sem API integrada, não há como simular — 4.8 marcado 🚫.

## Ainda em aberto (❓)

- 9.8: como o combo e a taxa de entrega devem ir na NFC-e (bug real encontrado ao montar este arquivo).
- 13.4: checklist das 4 cópias do mapa de papéis ao criar papel novo (ver memória de perfis).
- Passos faltando ou errados: marcar direto no arquivo.
