# Go-live El Patrón Paranaguá — checklist do dono (gerado 2026-09-17)

Resultado da varredura com agentes em 17/09. Detalhe técnico em `AI_SYSTEM_MAP.md` › "Operação go-live Paranaguá".
Legenda: ⛔ bloqueia segunda · ⚠️ importante · 💡 opcional.

## 1. Antes do push (só você)

- [ ] ⛔ **Cadastrar matrícula + PIN de um gerente/admin SÓ da Paranaguá** (Usuários). Depois do push, sair do totem e abrir a
  configuração dele exigem matrícula + PIN de admin/gerente **daquela loja**. Hoje os 2 admins da loja não têm matrícula nem PIN,
  e um deles é admin de 10 lojas (não serve enquanto a função nova de PIN não subir).
- [ ] ⛔ **Push da `main`** (GitHub Desktop). São ~90 arquivos de tela. Build, testes (330) e type-check conferidos aqui.
- [ ] ⚠️ Avisar a equipe: caixa/garçom/tablet **não salvam mais** a configuração de impressoras (só admin/gerente).

## 2. Configuração da loja (antes de abrir)

- [ ] ⛔ **Impressoras**: hoje TODAS as estações + caixa/pedidos/DANFE apontam para "Impressora de casa" (10.0.0.186).
  Mapear em Configurações › Impressoras: estações de cozinha → **cozinha 192.168.0.8**; caixa/pedidos/comprovantes → **caixa 192.168.0.20**.
  Remover a impressora de casa da loja. 💡 Mapear também `delivery-receipt` (hoje só funciona por regra de reserva).
- [ ] ⛔ **Fechar o caixa e a sessão abertos desde 14/09** (senão os pagamentos de segunda caem neles).
- [ ] ⛔ **Agente de impressão no PC da loja** (passo a passo na seção 5).
- [ ] ⚠️ **Limpar os pedidos de teste** da loja (32, sem marca de treino; 2 cancelados com pagamento válido e 1 pago parado em "novo" — P1409260005).
- [ ] ⚠️ **Desativar o item "Teste" R$ 1,00** (categoria Combo) — aparece para o cliente no delivery/QR.
- [ ] ⚠️ **Inativar 16 itens ativos de categorias apagadas** (Pastéis 11, Espetinhos 5). Já não aparecem no cardápio público, mas seguem no cadastro.
- [ ] ⚠️ **Equipe**: criar garçom, cozinha e gerente (hoje só 2 admins, 1 caixa sem PIN e 2 tablets). Cancelamento/desconto exigem gerente.
- [ ] ⚠️ **Tablet**: confirmar identificação (comanda × senha no balcão) e formas de pagamento
  (Configurações › Operação › Autoatendimento). PIX só aparece no tablet com cobrança automática (Inter/Mercado Pago).
- [ ] ⚠️ **Delivery** (se abrir segunda): bairros/taxas, localização da loja, WhatsApp, pedido mínimo, horário e motoboys (hoje 1 bairro, 0 motoboys).
- [ ] ⚠️ **NFC-e** (se emitir segunda): ligar, série, ambiente produção, certificado A1 + CSC na Brasil NFe. 39 itens sem NCM usam o padrão da loja (tributação genérica).
- [ ] 💡 **Ordem das fichas técnicas**: lançar **inventário e preço dos insumos ANTES** de cadastrar ficha (item com ficha e insumo sem saldo some do cardápio público).
  41 de 65 insumos estão em 0 e 39 sem preço. Montar 117 fichas pela tela leva 4–6 h; mande planilha **item | insumo | quantidade | unidade** que eu carrego.

## 3. Decisões pendentes (me responda quando puder)

- [ ] **Banco (custo)**: o Postgres está no plano **Micro**. No pico simulado travou 3× por 25–50 s (ações de 10–17 s).
  Recomendo **Small/Medium** (Supabase › Settings › Compute) fora do horário da Vila Leste.
- [ ] **Agente de impressão deste PC**: `agente-local/config.json` está com JSON inválido (falta vírgula) e puxa a fila da **Paranaguá**.
  Na segunda vai disputar tickets com o PC da loja. Autoriza eu corrigir e reiniciar o serviço?
- [ ] **Relatório por dia de negócio**: a loja fecha o dia às 05h, mas relatório/dashboard usam o dia do calendário
  (venda 00:30 aparece no dia seguinte; a numeração do pedido usa o corte). Mudar para o corte das 05h?
- [ ] **Taxa de entrega na NFC-e**: continua em "outras despesas" (vOutro). Sua contadora prefere `vFrete`?
- [ ] **Venda de R$ 75 sem nota (16/09, Vila Leste)**: emitir agora em Pedidos › P1609260001 › "Emitir NF" (sai com a data de hoje) — confirmar com a contadora.
- [ ] **Notas nº 3 e nº 4 (Vila Leste)**: total certo, divisão errada (combo/adicional). Passou o prazo de cancelamento — avisar a contadora.

## 4. Smoke test depois do push (10 min)

1. Abrir o app com Ctrl+F5; em DevTools › Network, `order-write` deve ter `?forceFunctionRegion=us-west-1`; `fiscal-write` e `pix-payment`, não.
2. Testes PDV, Modo Treino: venda com 2 formas → fecha paga, número em sequência.
3. **Vila Leste**: 1ª venda paga do dia → NFC-e autorizada em ~1 min (Pedidos › Notas).
4. Voucher + desconto manual numa venda → fecha paga e voucher baixado.
5. Garçom: dividir conta de mesa com 2 rodadas entre 2 pessoas → todas pagas, nada acima do total.
6. Gestor de Pedidos: cancelar pedido pago → abre cancelamento com estorno.
7. Totem: pedido → "Pagar no balcão: X" no pedido; testar Sair e engrenagem com matrícula+PIN.
8. Totem: parar 90 s antes do pagamento → "Ainda está aí?" e volta ao início (na tela de Pix não volta).
9. Delivery público em treino: derrubar a rede no envio e reenviar → 1 pedido só.
10. KDS: desligar Wi-Fi 1 min → faixa "Sem sincronizar"; religar → "Tentar agora" recarrega.

## 5. PC da loja — agente de impressão

1. Instalar Node LTS; copiar `agente-local` para `C:\ERPOS\agente-local` **sem** `node_modules` e **sem** o `config.json` do repo.
2. `npm install` na pasta.
3. Criar `config.json`:
   ```json
   { "agent_port": 9876, "default_timeout_ms": 10000, "impressoras": [],
     "print_queue_enabled": true,
     "supabase_url": "https://mdghhjemzdmeuqpzuyzx.supabase.co",
     "supabase_anon_key": "<sb_publishable do .env do projeto>",
     "tenant_ids": ["7221d7f3-cd49-4820-93cb-c0abcd16f43c"],
     "realtime_enabled": true, "polling_enabled": true, "poll_interval_ms": 15000 }
   ```
   (IPs vêm do app; validar o JSON antes.)
4. `instalar.bat` como administrador (vira serviço do Windows). Plano de energia: nunca suspender.
5. Testar: `http://localhost:9876/health` → `queue_enabled: true`, `realtime_healthy: true`.
   Pedido de treino pelo QR → 1 ticket por estação na impressora certa em ~5 s.
   Desligar a impressora da cozinha, pedir, religar em até 1 min → o ticket sai (acima de 15 min ele falha e precisa reimprimir no Gestor).
6. Durante o serviço: pedido "pendente" = agente/PC fora; "falhou" = impressora não respondeu. Use "impressora parou" no assistente ou reimprima no Gestor.

## 6. Pendências técnicas conhecidas (não bloqueiam)

- Fila de impressão (`print-queue-agent`) aceita chamada só com a chave pública → precisa de token por dispositivo (exige reinstalar o agente nos 3 PCs).
- Estorno de pontos de fidelidade no cancelamento não existe.
- Aprovação de gerente "por notificação" é só memória do navegador — use senha do gerente (já é o padrão da loja).
- Conta/compra paga não pode ser excluída e ainda não há botão "estornar baixa".
- `fn_get_cash_sessions_v2` soma pedidos não pagos no "faturamento" da sessão (rótulo engana).
- `station_id`/`skip_kds` do delivery público vêm do cliente (podem ser forjados) — resolver no servidor.
- KDS envia a sessão inteira a cada atualização (~3,6 KB por pedido) — pesa no banco em dia cheio.
- Combos: nenhum canal vende hoje; ficha técnica de combo não baixa estoque.
