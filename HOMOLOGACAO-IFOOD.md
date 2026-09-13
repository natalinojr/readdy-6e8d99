# Homologação do módulo Financial do iFood — ERPOS

Guia para o dono pedir e passar a homologação. Integradora: **IDEAR PROJETOS COMPLEMENTARES LTDA.**
(conta Profissional no Portal do Desenvolvedor). Loja de teste: **Teste - IDEAR PROJETOS COMPLEMENTARES LTDA.**,
merchant **4117700** (uuid `1fac24ad-b86c-49d6-a8c3-6a60a57294c4`). App de teste usado: **"Teste (C)"** (centralizado).

Regras do iFood (doc `developer.ifood.com.br/pt-BR/docs/food/guides/modules/financial/homologation`):
chamado **separado** para o Financial · questionário com dados do **ambiente de teste** (header
`x-request-homologation: true`) · para Food, **vídeos** dos cenários · depois da aprovação cria-se o app oficial.

---

## 1. Onde clicar

1. Portal do Desenvolvedor (developer.ifood.com.br), logado.
2. Menu lateral › **Minhas solicitações**.
3. Botão preto **Abrir nova solicitação** (canto superior direito).
4. **Tipo de solicitação:** escolher **Homologação** ("Agendar a homologação da sua integração").
   As outras opções são Dúvidas, Incidente e Requisição.
5. **Assunto** (até 255 caracteres): o assunto da seção 2.
6. **Descrição** (até 4000 caracteres): o texto da seção 2.
7. **Evidências técnicas** (opcional, até 5 arquivos): pode anexar prints da aba iFood (Pedidos, Eventos).
8. **Próximo** → conferir o que o formulário pedir a mais → enviar.

---

## 2. Texto do chamado (copiar e colar)

**Assunto:** Homologação do módulo Financial — ERPOS (IDEAR PROJETOS COMPLEMENTARES LTDA.)

> Olá, time de integração do iFood.
>
> Solicitamos a homologação do **módulo Financial** para o nosso aplicativo **ERPOS**, sistema de gestão
> (ERP) para restaurantes, de uso consultivo: o app só **lê** dados financeiros para mostrar à loja vendas,
> comissões, taxas, repasses e a conciliação com o extrato bancário. Não usamos módulos operacionais neste pedido.
>
> - Integradora: IDEAR PROJETOS COMPLEMENTARES LTDA. (conta Profissional)
> - App de teste: IDEAR PROJETOS COMPLEMENTARES LTDA. - Teste (C) — centralizado
> - Loja de teste: 4117700 (1fac24ad-b86c-49d6-a8c3-6a60a57294c4)
> - APIs integradas (financial/v3.0): Sales, Financial Events, Settlements, Anticipations, Reconciliation e
>   Reconciliation On-Demand, todas testadas com o header `x-request-homologation: true`.
>
> Observação sobre o ambiente de teste: a API Sales devolve para a loja de teste o pedido de exemplo
> #0686 (01/08/2025, merchant "ABC"), que é o que aparece nas nossas evidências; Settlements e
> Anticipations vêm vazios e o Reconciliation On-Demand responde "No financial entries exist for merchant…"
> — tratamos e exibimos essa mensagem ao usuário. O Resumo (Reconciliation) foi demonstrado com dados de
> uma loja real nossa, cujos totais conferem no centavo com o Portal do Parceiro.
>
> Ficamos no aguardo do questionário e das orientações para o envio dos vídeos dos cenários.
>
> Obrigado!

---

## 3. Respostas para o questionário

### Abordagem de implementação das APIs
- Backend próprio (Supabase Edge Function `ifood-financial`, Deno/TypeScript), chamado pelo ERP e por uma
  rotina diária às 07h20 (horário de Brasília); também atualiza quando a loja abre a tela de Conciliação.
- Base: `https://merchant-api.ifood.com.br/financial/v3.0/merchants/{merchantId}/…`.
- **Sales:** consulta por período (`beginSalesDate`/`endSalesDate`, últimos 30 dias), paginada por
  `page` até `pageCount`.
- **Financial Events:** `beginDate`/`endDate` respeitando a janela máxima de 33 dias, `page` + `size=100`
  até `hasNextPage=false`.
- **Settlements:** `beginPaymentDate`/`endPaymentDate` (35 dias para trás e para frente); tratamos os
  tipos REPASSE, BOLETO e REGISTRO_RECEBIVEIS de `closingItems`.
- **Anticipations:** `beginAnticipatedPaymentDate`/`endAnticipatedPaymentDate`, com valor original,
  taxa (R$ e %), valor antecipado e datas.
- **Reconciliation:** por competência (AAAA-MM); baixamos o `downloadPath`, descompactamos o CSV `.gz`
  (separador `;`), comparamos o `sha256` do `metadata` para não reprocessar arquivo repetido e validamos
  `total_linhas` e `total_pedido_associado_ifood` contra o que foi lido.
- **Conferência cruzada:** por data de repasse, Financial Events (com impacto) × Reconciliation × Settlements.
- **Reconciliation On-Demand:** POST com a competência; em **409** reutilizamos o `requestId` do pedido
  em andamento; consultamos o GET com backoff exponencial até o arquivo ficar pronto e então importamos.
- Autenticação: fluxo **distribuído** (`userCode` + `authorizationCode` + `refresh_token`) e **centralizado**
  (`client_credentials`), conforme o tipo do app.

### Armazenamento e tratamento de dados financeiros
- Banco PostgreSQL (Supabase) com isolamento por loja (Row Level Security por vínculo do usuário à loja).
- Tabelas: vendas, eventos financeiros, liquidações, antecipações, pedidos on-demand e as linhas do relatório
  de conciliação (uma importação por loja + competência; reimportar substitui).
- **Credenciais** (client secret, tokens) ficam em tabela sem acesso pelo navegador — só o servidor lê. O
  segredo nunca volta para a tela (a tela mostra só o Client ID mascarado).
- Valores monetários gravados como número decimal; o JSON original de cada item também é guardado para auditoria.
- **Filtro de repasse:** só entram no cálculo do repasse as linhas com `impacto_no_repasse = SIM`
  (Reconciliation) e `hasTransferImpact = true` (Financial Events). Lançamentos com responsável LOJA
  (pagos direto à loja na entrega) ficam fora do repasse e são mostrados à parte.
- **Cálculo do repasse:** receita = Entrada Financeira + Subsídio (promoção paga pelo iFood);
  taxas = Cobrança + Retenção (comissão, taxa de transação, entrega, serviço, parcelamento);
  receita − taxas = soma dos depósitos. Conferido com dado real: 4.286,95 − 1.549,98 = 2.736,97,
  igual ao "Total em repasses" do Portal do Parceiro.

### Interface do usuário e apresentação de dados
- Aba **iFood** no Financeiro do ERP, com subabas:
  - **Resumo** (Reconciliation): vendas, comissões e taxas (% efetivo), líquido, promoções pagas pela loja e
    pelo iFood, tabela de repasses por data (valor informado pelo iFood × crédito no banco, diferença e situação:
    Previsto / Conferido / Com diferença / Não encontrado) e detalhamento "para onde foi o dinheiro".
  - **Pedidos** (Sales): número e data do pedido, situação, forma de pagamento e responsável, valor bruto,
    promoções, comissões e taxas por item, líquido.
  - **Repasses** (Settlements + Anticipations): data de pagamento, tipo, período apurado, valor, situação e conta
    bancária (quando SUCCEED); antecipações com data original × antecipada, taxa em R$ e %, valor recebido.
  - **Eventos** (Financial Events): evento, gatilho, valor com sinal, data, data prevista de repasse e
    indicação se afeta o repasse (filtro "só o que afeta o repasse").
- **Exportar CSV** do relatório de conciliação do mês.
- **Gerar relatório agora** (On-Demand) com mensagens de andamento e de erro do iFood exibidas ao usuário.
- Repasses futuros também aparecem em **Contas a Receber** do ERP.

### Tratamento de erros e casos extremos
- Toda resposta de erro mostra ao usuário a mensagem do iFood e o código HTTP; nada é descartado em silêncio.
- **401:** renova o token e repete a chamada uma vez.
- **404** em Sales/Events/Settlements/Anticipations/Reconciliation: tratado como "sem dados no período".
- **409** no On-Demand: reutiliza o `requestId` já existente.
- On-Demand com `status: error` (ex.: "No financial entries exist…") é mostrado ao usuário, sem importar nada.
- Arquivo de conciliação sem lançamentos não gera importação vazia.
- Registros repetidos na mesma página são deduplicados antes de gravar (chave única por item).

### Rate limiting e resiliência
- Retentativa com **backoff exponencial** em **429** e **5xx**: até 4 novas tentativas, esperando
  0,5 s · 2ⁿ (máx. 8 s) com variação aleatória, ou o tempo do cabeçalho `Retry-After` quando enviado.
- Token reaproveitado até 5 minutos antes de expirar (sem pedir token a cada chamada).
- Busca diária em horário fixo (07h20) e sob demanda pelo usuário — sem polling agressivo.
- Polling do On-Demand com espera crescente (3 s, 6 s, 12 s… até 60 s, no máximo 8 consultas).
- Falha em uma API não interrompe as outras: cada uma é executada e registrada separadamente.

---

## 4. Roteiro dos vídeos (loja "Testes PDV" do ERP, modo homologação ligado)

| # | Cenário | O que mostrar |
|---|---|---|
| 1 | Autenticação | Financeiro › iFood › Importar/configurar: tipo de app, Client ID, segredo oculto, Modo homologação, **Conectar** → loja 4117700 encontrada; "Buscar agora" |
| 2 | Sales | Subaba **Pedidos**: o pedido de teste e todos os campos (pagamento/responsável, bruto, promoções, comissões, líquido) |
| 3 | Financial Events | Subaba **Eventos**: valores com sinal, datas, repasse previsto; ligar/desligar "só o que afeta o repasse" |
| 4 | Settlements / Anticipations | Subaba **Repasses** (na loja de teste vem vazio — mostrar a tela e a mensagem) |
| 5 | On-Demand | **Gerar relatório agora** → mensagem de andamento → mensagem de erro clara do iFood |
| 6 | Reconciliation | Subaba **Resumo** + **Exportar CSV**. A loja de teste não tem relatório de conciliação; gravar com dados reais de uma loja e explicar isso no chamado |

Antes de gravar: gerar 2–3 pedidos de teste (Portal › Pedidos de teste › Gerar pedido de teste) e clicar
"Buscar agora" no ERP.

---

## 5. Conferências e validações (feitas em 2026-09-13)

- **Conferência entre APIs:** subaba Repasses › "Conferência entre fontes do iFood" — por data de repasse,
  soma dos Financial Events com `hasTransferImpact` × linhas do Reconciliation com impacto no repasse ×
  valor liquidado (Settlements tipo REPASSE). Situação "Conferido" quando as fontes disponíveis diferem até
  R$ 0,05; "Diferença" caso contrário.
- **Integridade do arquivo de conciliação:** além do `sha256`, comparamos `metadata.total_linhas` e
  `metadata.total_pedido_associado_ifood` com as linhas e pedidos lidos do arquivo; a importação fica marcada
  como conferida ou com diferença (aviso em vermelho na aba iFood, com orientação para gerar de novo).
- **Antecipações × D+30:** para cada antecipação mostramos quantos dias o dinheiro chegou antes, a taxa em
  R$ e %, o custo equivalente ao mês e o total pago no mês para receber antes (que no prazo normal, D+30,
  entraria inteiro).

**Limitação da loja de teste:** ela não gera Settlements, Anticipations nem Reconciliation — esses cenários
serão mostrados vazios (com as mensagens de erro/aviso) ou gravados com dados reais de uma loja.
