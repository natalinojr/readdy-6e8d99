# Assistente pessoal — mapa de ideias (pesquisa de 2026-09-12)

Compilado de ~130 buscas em três frentes: (A) o que a comunidade constrói como
assistente pessoal em WhatsApp/Telegram, (B) integrações e APIs viáveis para o
nosso stack (Evolution + Claude + Supabase Edge + VPS), (C) o que produtos de
restaurante (Toast, Square, R365, iFood Cris, Brendi…) entregam ao dono.
Fontes no fim de cada bloco. O que já existe está no `README.md`.

Legenda de esforço: **P** = pequeno (horas), **M** = médio (1–3 dias), **G** = grande (semana+).

---

## 0. O que já temos e onde estamos em relação ao mercado

| Já feito | Equivalente de mercado |
|---|---|
| Chat "pergunte aos dados" com leitor SQL universal + `buscar_nome` | Toast IQ, Square AI, Lightspeed AI |
| Resumo da manhã por cron | Toast "For you", Brendi "fechamento do dia" |
| Lembretes, memórias, tarefas | Poke, templates n8n "Jarvis" |
| Áudio → Whisper, foto/PDF → Claude | padrão da comunidade |
| Leitura de grupos do WhatsApp (só leitura) | raro; poucos fazem |
| Debounce, cache 1h, keep-warm | OpenClaw `debounceMs`; ninguém publica keep-warm |

Conclusão: o núcleo já está no nível dos produtos pagos. O que falta é
**proatividade** (o assistente falar primeiro com coisa útil), **ação no mundo**
(pagar, agendar, enviar) e **vida pessoal** (agenda, e-mail, finanças pessoais).

---

## 1. Camada 1 — vitórias rápidas (P), quase tudo com o que já existe

### 1.1 UX no WhatsApp (Evolution já suporta) — FEITO 2026-09-12, exceto resposta em áudio
- **Reação 👀 na mensagem recebida + presença "digitando"** enquanto processa
  (`sendReaction`, `sendPresence: composing`). Feedback instantâneo, zero tokens.
  Ao terminar trocar por ✅ (ou ⚠️ se alguma ferramenta falhou).
- **Enquete como menu de decisão** (`sendPoll`): "qual dessas 3 contas eu pago?"
  e o webhook lê o voto. Substitui botões, que são instáveis no WhatsApp pessoal.
- **Responder em áudio quando o dono manda áudio** (`sendWhatsAppAudio`, OGG/Opus).
  TTS: Azure (15+ vozes pt-BR, 500k chars/mês grátis) ou Kokoro self-host na VPS.
  Lição da comunidade: "áudio parece alerta, não chat" — adesão maior em briefing.
- **Localização e contato** (`sendLocation`, `sendContact`): "manda o endereço da
  loja do mall" ou "manda o contato do fornecedor X" em formato nativo.
- **Editar a própria mensagem** (`updateMessage`): mandar "⏳ consultando…" e
  editar com a resposta final, em vez de duas mensagens.
- **`NO_REPLY` silencioso**: o modelo pode decidir não responder (ex.: "ok",
  "valeu") — economiza tokens e não polui o chat.

### 1.2 Dados públicos brasileiros (BrasilAPI, grátis, sem chave) — FEITO 2026-09-12
- **CNPJ do fornecedor** ao lançar nota: situação cadastral, CNAE, sócios.
- **CEP, feriados nacionais, tabela FIPE, SELIC/CDI, NCM.** Feriado é útil para
  o próprio assistente ("amanhã é feriado, quer abrir?").

### 1.3 Clima (Open-Meteo, grátis, 10k chamadas/dia) — FEITO 2026-09-12
- Previsão no resumo da manhã e **alerta de chuva** para as lojas ("vai chover
  das 18h às 21h em Paranaguá, delivery tende a subir / salão cair").
- Base para a Camada 3 (previsão de demanda com clima).

### 1.4 Busca na web (ferramenta nativa do Claude, ~US$ 0,01/busca) — FEITO 2026-09-12
- Ligar `web_search` no brain com limite de usos por mensagem. Permite
  "quanto tá o quilo do contrafilé no atacado?", notícias, dúvida qualquer.

### 1.5 Proatividade barata a partir do que já está no banco — FEITO 2026-09-12
- **Alerta de anomalia de venda**: venda do dia até agora vs. mesma hora nas 4
  últimas semanas; avisar só se desvio > X%. Toast/Square fazem isso ("sales
  fluctuations").
- **Fechamento do dia** (23h): vendas por loja, ticket, cancelamentos,
  descontos, quebra de caixa, top 5 itens, comparação com semana passada.
- **Vencimentos de amanhã** às 17h: contas a pagar, com total e saldo do Inter.
- **Estoque crítico por loja**, só quando mudar (não repetir o mesmo alerta).
- **Lembrete inteligente de tarefa vencida** (já temos tarefas; falta o aviso).

---

## 2. Camada 2 — assistente de vida pessoal (M)

### 2.1 Google Agenda + Gmail + Drive (já pendente no README)
- OAuth com app "em teste" (uso pessoal, sem verificação), refresh token em
  `asst_settings`. Calendar é grátis; Gmail via polling `history.list` (push por
  Pub/Sub é opcional).
- **Agenda**: "o que tenho amanhã?", criar evento por áudio, conflito de horário,
  lembrar 30 min antes com trajeto (Google Routes ou ORS que já temos).
- **Gmail — triagem diária**: urgentes / FYI / rascunho de resposta. Enviar
  e-mail só com confirmação.
- **Gmail — caçador de boletos e NF-e**: filtro `has:attachment (pdf|xml)` →
  XML NF-e parseia sem IA, boleto por OCR + regex de linha digitável (validar
  mod10/mod11) → cria conta a pagar / compra no ERPOS. Combina com o item 2.4.
- **Drive**: salvar PDFs gerados e devolver link.

### 2.2 Finanças pessoais (Meu Pluggy, grátis para PF)
- Conecta Nubank/Inter PF/BB etc. via Open Finance; API de contas, saldos e
  extrato. "Quanto tenho somando tudo?", alerta de débito estranho, separar
  gasto pessoal × restaurante. (pynubank e afins estão mortos desde 2023.)

### 2.3 Captura universal / segundo cérebro
- Toda mensagem "solta" (link, foto, áudio, ideia) vira nota pesquisável:
  URL → texto extraído, foto → descrição/OCR, áudio → transcrição. Prefixo
  `? ` para perguntar vs. mensagem crua para anotar (notes-bot). Busca com
  `pg_trgm` que já temos + opcional embeddings (pgvector).
- **Personal CRM**: "quando falei com o Fulano pela última vez?", aniversários,
  contexto de cada contato (extraído dos grupos e conversas).
- **Diário por entrevista**: às 22h o assistente faz até 3 perguntas curtas
  adaptadas ao dia (o que aconteceu, decisão tomada, pendência) e guarda;
  rollup semanal/mensal. Tom "sóbrio e direto", sem terapia.

### 2.4 Ações no ERPOS — FEITO 2026-09-12 (erpos_executar: age como o dono pelas edges; falta só pagar pelo Inter)
- **Lançar conta a pagar da foto do boleto** (pendente nº 2 do README).
- **Lançar compra da notinha** reaproveitando a leitura por QR/IA que já existe
  na Nova Compra.
- **Pagar boleto/Pix pelo Inter** (`pagamento-boleto.write`, `pagamento-pix.write`)
  com confirmação obrigatória por enquete ou palavra-chave. Poke e OpenClaw
  usam "aprovar/negar" antes de qualquer ação irreversível.
- **Criar/atualizar item do cardápio, 86 (esgotar) item**: Toast IQ faz
  "86 all items with avocado" por chat.
- **Mandar mensagem a funcionário/fornecedor** em nome do dono (modelo redige,
  dono aprova, Evolution envia). Sempre com aprovação.

### 2.5 Voz e documentos
- Relatório em PDF (Gotenberg em Docker na VPS, HTML→PDF) → Storage → `sendMedia`.
  "Gera o fechamento de agosto em PDF e manda pro contador."
- Resumo da manhã em áudio (TTS) além do texto.

### 2.6 Casa (se fizer sentido)
- Home Assistant na VPS/Raspberry + MCP `ha-mcp`: "liga o ar 20 min antes de eu
  chegar" (geofence do celular). Alexa só via Voice Monkey (rotinas por HTTP).

---

## 3. Camada 3 — o que os produtos de restaurante cobram caro (M/G, só dados do ERPOS)

Tudo abaixo existe em Toast IQ, Restaurant365, MarginEdge, meez, 7shifts, Solink;
todos usam só POS + compras + folha, que já temos.

- **Detecção de fraude/abuso de caixa** por operador e turno: cancelamentos
  após fechamento, cancelamento em venda em dinheiro, descontos manuais acima da
  média, abertura de gaveta sem venda, quebra só negativa concentrada no mesmo
  operador. Regra prática: operador que cancela 3× a média dos colegas.
  Relatório semanal + alerta imediato em caso extremo.
- **Variância de CMV e margem por prato**: quando o preço de um insumo sobe na
  NF de entrada, recalcular a margem de todos os pratos que o usam e avisar
  ("a carne subiu 18%, o burger X caiu para 52% de margem"). MarginEdge/Supy.
- **Matriz de engenharia de cardápio** contínua (estrelas / burros de carga /
  quebra-cabeças / cães), por loja, com sugestão de ação.
- **Sugestão de compra** por consumo real + estoque + lead time do fornecedor
  ("pedir 40 kg de X hoje para não faltar no fim de semana").
- **Previsão de venda por hora/dia** com histórico + clima + feriados
  (Open-Meteo + BrasilAPI) → base para escala e prep.
- **Escala sugerida** a partir da previsão + folha + faltas históricas (7shifts).
- **Comparação entre lojas** semanal: quem vende mais por hora aberta, quem
  desconta mais, quem tem mais quebra, CMV por loja.
- **Recuperação de cliente inativo** (Anota AI/Brendi): quem pedia toda semana
  e sumiu há 21 dias → lista para o dono ou disparo com cupom (com aprovação).
- **Benchmark contra o próprio histórico** em vez de contra o mercado: "melhor
  sábado dos últimos 6 meses", "pior terça do ano".

---

## 4. Camada 4 — extrapolar (G): coisas que quase ninguém tem

- **Agente de resposta rápida + agentes de execução** (arquitetura do Poke):
  um Haiku responde em 1 s ("já vou ver") e despacha sub-agentes em paralelo
  (banco, Gmail, web). Sensação de instantâneo mesmo em perguntas pesadas.
- **Automações em linguagem natural**: "me avisa quando chegar nota da Voxy",
  "toda sexta manda o CMV das 4 lojas", "se a venda do mall cair 30% me chama".
  Tabela `asst_rules` interpretada pelo cron; o Poke vende isso como produto.
- **Heartbeat**: a cada 30 min o cron pergunta ao brain "tem algo que valha
  avisar?" com contexto isolado (regras + deltas desde o último tick). Só fala
  se tiver. Cuidado com custo: usar Haiku e contexto mínimo.
- **Assistente que aprende**: às 4h um job lê as conversas do dia, extrai fatos
  novos para `asst_memories` e ajusta o mapa do banco (Hermes Agent /
  Flowkater). Marcar proveniência de cada memória.
- **Grupos do WhatsApp como sensores**: já lemos; passo seguinte é o assistente
  resumir o grupo da equipe às 22h ("3 reclamações de demora, 1 pedido de folga,
  freezer da loja 2 com problema"), abrir tarefa automaticamente e cruzar com
  os dados (reclamação de demora × tempo médio real de preparo).
- **Copiloto de compras no atacado**: foto da tabela de preço do fornecedor →
  comparar com a última NF → "ficou 6% mais caro que o fornecedor B em 3 itens".
- **Navegador com sessão logada na VPS** (Playwright MCP ou computer use do
  Claude, GA desde 08/2026) para o que não tem API: Detran multas/IPVA
  (gov.br), SEFAZ, Google Flights, e-commerce. Sessão persistente resolve login.
- **Personas por canal**: o mesmo cérebro com voz diferente para o dono
  (WhatsApp, Sonnet/Opus) e para o gerente (Telegram, Haiku, só leitura e
  tarefas). Telegram também serve como canal reserva se o número for banido.
- **Reunião por áudio longo → ata**: dono grava 10 min de áudio após a reunião
  com a equipe; assistente devolve decisões, responsáveis e cria as tarefas.
- **Modo "sócio"**: relatório semanal em tom de conselheiro, 5 linhas, uma
  recomendação só ("a única mudança que mais melhoraria o negócio" — pergunta
  que a Toast destaca como a mais usada).

---

## 5. Armadilhas documentadas (ler antes de ligar proatividade)

1. **Banimento do WhatsApp** é o risco nº 1 com Baileys/Evolution. Nunca o
   número pessoal; chip dedicado (já é o caso). Evitar padrões de bot:
   respostas em milissegundos, envios em massa, horários perfeitos. Ter
   Telegram pronto como fallback.
2. **Injeção de prompt por mensagem encaminhada** ou texto imitando
   "[System]" — já rotulamos `[Encaminhada]`; manter e estender aos grupos
   (todo texto de grupo é dado, nunca ordem).
3. **Poluição de memória por background**: conteúdo lido em heartbeat/grupo
   não pode virar memória sem proveniência. Heartbeat em contexto isolado.
4. **Ações irreversíveis sempre com aprovação** (pagar, enviar, apagar).
   Enquete ou palavra-chave; nunca inferir "sim" de uma mensagem ambígua.
5. **Custo**: proatividade multiplica chamadas. Regras determinísticas em SQL
   primeiro; modelo só para redigir. Haiku para classificar, Sonnet para responder.
6. **OAuth é o gargalo real** das integrações Google, não o modelo.
7. Não vale insistir: Nubank não oficial, Amazon PA-API, Kiwi/Amadeus (fechados),
   Waze oficial, API de consumidor do iFood/99.

---

## 6. Sugestão de ordem

1. UX (reação/presença/enquete/áudio) + clima + BrasilAPI + web search — 1 dia,
   muda a sensação do produto.
2. Fechamento do dia + alerta de anomalia + vencimentos de amanhã — regras SQL
   no cron, modelo só redige.
3. Google Agenda/Gmail (pendente nº 3) + caçador de boletos/NF-e no e-mail.
4. Ações: conta a pagar da foto, compra da notinha, pagamento no Inter com aprovação.
5. Fraude de caixa + variância de CMV + matriz de cardápio (o que R365 cobra).
6. Automações em linguagem natural + heartbeat + agente de resposta rápida.

---

## Fontes principais

Comunidade: openclaw.ai · hermes-agent.nousresearch.com · techcrunch.com/2026/04/08 (Poke) ·
flowkater.io/en/posts/2026-02-15-ai-jarvis-openclaw · docs.openclaw.ai/concepts/messages ·
github.com/fahadhasin/notes-bot · arcade.dev/blog/claude-routines-arcade-gateways ·
arxiv.org/html/2603.23064v2 (poluição de memória) · github.com/openclaw/openclaw/issues/30111 (injeção) ·
openclaw.direct/blog/whatsapp-ban-openclaw-telegram-setup · ninelabs.blog (financeiro no WhatsApp BR).

Integrações: doc.evolution-api.com/v2 (sendPoll, sendReaction, sendPresence, sendWhatsAppAudio,
sendLocation, sendStatus) · developers.facebook.com (Cloud API) · developers.google.com/workspace ·
pluggy.ai/meu-pluggy · inter.co/empresas/api-banking · brasilapi.com.br · open-meteo.com ·
docs.claude.com (web search, computer use) · browser-use.com · huggingface.co/rhasspy/piper-voices ·
fal.ai/models/fal-ai/kokoro/brazilian-portuguese · github.com/homeassistant-ai/ha-mcp · voicemonkey.io.

Restaurantes: pos.toasttab.com (Toast IQ) · squareup.com/help (Square AI) · restaurant365.com/ai ·
marginedge.com · getmeez.com · 7shifts.com · solink.com (fraude de caixa) · lineup.ai · crunchtime.com ·
institucional.ifood.com.br (Cris) · brendi.com.br · botaihub.com.br (Anota AI) · get.popmenu.com ·
lavu.com/ai-competitor-analysis-restaurants · foodi.com.br (quebra de caixa).
