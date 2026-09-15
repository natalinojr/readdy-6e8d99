# Assistente pessoal (WhatsApp + Claude) — projeto PESSOAL do dono

Nada aqui é exposto aos usuários do ERPOS: sem tela, rota ou menu. O assistente
usa o mesmo projeto Supabase porque precisa dos dados (tarefas, vendas, caixa,
financeiro, estoque), mas as tabelas dele (`asst_*`) têm RLS ligada sem policies:
só a service role (Edge Functions `assistente-*`) lê e escreve.

Só o dono fala com ele. A lista de chats autorizados fica em
`asst_settings.allowed_chat_ids` (checada pelo webhook do WhatsApp); qualquer
outro número é ignorado sem resposta.

## Arquitetura

```
WhatsApp (número do assistente, Evolution API na VPS Hetzner)
   │  webhook
   ▼
assistente-webhook (Edge)  ── valida remetente, transcreve áudio, chama ▼
assistente-brain   (Edge)  ── Claude Opus 5 + ferramentas do ERPOS ── responde
   │
   ├─ asst_messages   histórico da conversa (últimas 30 mensagens viram contexto)
   ├─ asst_memories   fatos que o dono pediu para lembrar (vão no system prompt)
   ├─ asst_reminders  lembretes com hora (enviados por um cron/edge — pendente)
   └─ asst_settings   owner_user_id, default_tenant_id, allowed_chat_ids
```

### assistente-brain (NO AR desde 2026-09-11)

`POST /functions/v1/assistente-brain` com header `x-internal-key: <ASSISTENTE_INTERNAL_KEY>`
(ou `Authorization: Bearer <service role>`), body `{ text, chat_id?, channel? }`.
Retorna `{ reply, tool_calls, usage }`. Teste manual:

```bash
curl -s -X POST https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/assistente-brain \
  -H "Content-Type: application/json" -H "x-internal-key: $ASSISTENTE_INTERNAL_KEY" \
  -d '{"text":"como tá a loja hoje?"}'
```

Ferramentas: `listar_tarefas`, `criar_tarefa` (pasta padrão "Assistente", criada
automaticamente), `concluir_tarefa`, `resumo_loja` (`fn_get_dashboard_metrics`),
`vendas` (`fn_get_sales_report`), `caixa_atual`, `contas_a_pagar`,
`estoque_critico` (`fn_get_stock_critical_alerts`), `salvar_memoria`,
`criar_lembrete`, `listar_lembretes`, `cancelar_lembrete`.

Decisões:
- Tarefas são escritas direto nas tabelas (não via `task-write`, que exige JWT
  do usuário), sempre com `created_by = assignee_id = owner_user_id`.
- Loja é resolvida por nome parcial (`loja: "mall"`); sem nome, usa a principal.
- Data/hora atual entra na mensagem do usuário (não no system) para não invalidar
  o cache do prompt. Fuso fixo `America/Sao_Paulo`.
- Modelo **`claude-sonnet-5`** desde 2026-09-11 (pedido do dono, custo), `effort: medium`.
  Com Opus 5 medimos ~2k tokens de entrada + ~5k de cache + ~400 de saída por
  mensagem ≈ US$ 0,02–0,03; Sonnet 5 custa ~40% disso. Se errar datas/consultas,
  voltar para `claude-opus-5` (mesma API).
- Anexos: `attachment: { base64, media_type }` (foto ou PDF) vai como bloco
  image/document só na mensagem atual; no histórico fica "[Foto] legenda".

### VPS + Evolution API (NO AR desde 2026-09-11)

- **Hetzner CX23** (2 vCPU, 4 GB, 40 GB, Helsinki), Ubuntu 24.04, US$ 7,09/mês.
  IP `2.29.44.94`. Conta Hetzner do dono (em USD). SSH só por chave:
  `~/.ssh/erpos_assistente_ed25519` na máquina do dono (usuário `root`).
- Firewall ufw (22/80/443) + fail2ban. Docker CE.
- Stack em `/opt/assistente` (`docker-compose.yml`, `.env`, `Caddyfile`):
  `evoapicloud/evolution-api:latest` (v2.3.7) + postgres 16 + redis 7 +
  **Caddy** (HTTPS automático via `2.29.44.94.sslip.io`) + **Uptime Kuma**
  (`https://kuma.2.29.44.94.sslip.io`, ainda sem conta criada).
- API: `https://2.29.44.94.sslip.io` (header `apikey` = secret `EVOLUTION_API_KEY`
  no Supabase; também em `/opt/assistente/.env`). Manager web: `/manager`.
- Instância `assistente` (Baileys) com webhook `MESSAGES_UPSERT` →
  `assistente-webhook` (header `x-internal-key`), `groupsIgnore`, `rejectCall`.
- Comandos úteis (na VPS): `cd /opt/assistente && docker compose ps`,
  `docker logs evolution --tail 50`, `docker compose pull && docker compose up -d`.

### assistente-webhook (NO AR desde 2026-09-11)

Recebe o evento da Evolution, ignora `fromMe`/grupos/status, checa
`asst_settings.allowed_chat_ids` (JID `55DDDNUMERO@s.whatsapp.net` ou só o
número), chama o brain e responde via `/message/sendText/assistente`.
Responde 200 na hora e processa com `EdgeRuntime.waitUntil` (a Evolution
repete o webhook se demorar). Contas novas do WhatsApp podem chegar como
`@lid`: o número real vem em `key.remoteJidAlt`/`senderPn` e também é checado.

Mídia (desde 2026-09-11):
- **Áudio** → base64 do webhook (ou `/chat/getBase64FromMediaMessage`) →
  **Whisper na VPS** (`https://whisper.2.29.44.94.sslip.io/asr`, header
  `X-Api-Key` = secret `WHISPER_API_KEY`; Caddy devolve 401 sem a chave) →
  brain recebe `[Áudio] transcrição`. Modelo `small` (faster-whisper, CPU),
  ~7 s por áudio curto; sem custo por minuto.
- **Foto / PDF** → brain como `attachment` (Claude lê). Vídeo e outros tipos
  respondem pedindo foto/PDF/texto.
- Mensagem encaminhada → prefixo `[Encaminhada]` (tratada como informação,
  nunca como ordem).

### assistente-cron (NO AR desde 2026-09-11)

pg_cron `assistente-tick` (a cada minuto) → `fn_assistente_tick()` → `net.http_post`
(pg_net, assíncrono) → edge `assistente-cron` com a chave do Vault
(`assistente_internal_key`). A cada tick:
- **Lembretes** vencidos (`sent_at is null`) saem no WhatsApp como "⏰ Lembrete: …".
  `sent_at` é marcado antes do envio (update condicional) e volta a null se falhar.
- **Resumo da manhã**: 1×/dia a partir de `asst_settings.morning_brief.time`
  (padrão `07:30`, janela de 3h), gerado pelo brain e enviado ao dono.
  Controle em `last_brief_date`. Desligar: `morning_brief.enabled = false`.
- Destino: `chat_id` do lembrete se for JID; senão `asst_settings.owner_chat_id`.
  **Enquanto `owner_chat_id` for null, nada é enviado** (fica pendente).
- Migração versionada: `supabase/migrations/20260911180000_assistente_pessoal.sql`.

### Tela Assistente no ERPOS (2026-09-11 — front pendente de push)

Rota `/assistente` (`src/pages/assistente/page.tsx`), card em Módulos e item no
Sidebar › Ferramentas, visível só para o e-mail do dono (mesmo padrão da
Contratação: `adminMasterOnly`, `emails: [...]`, `Navigate` na página). Backend:
edge **`assistente-config`** (JWT + e-mail do dono + `asst_settings.owner_user_id`):
`get`, `save_settings`, `add_memory`, `delete_memory`, `cancel_reminder`,
`whatsapp_connect` (QR de pareamento direto na tela), `whatsapp_state`.
Abas: Conversa, Lembretes, Memórias, Configurações (lojas acompanhadas + loja
principal, resumo da manhã, WhatsApp). `AppMode` ganhou `'assistente'`.

Lojas: `asst_settings.watched_tenant_ids` + `default_tenant_id` (o brain só
consulta essas; sem escolha, usa as lojas do dono). Padrão inicial: as 4 lojas
El Patron, principal **VILA LESTE / EL PATRON** (a que tem movimento).

### Dono da plataforma (acesso a todas as lojas) — NO AR 2026-09-11

Tabela `platform_owners` + `is_platform_owner(uuid)`. O dono tem vínculo `admin`
em todas as lojas (backfill) e ganha automaticamente em loja nova (gatilho
`on_tenant_created_platform_owner`). Esses vínculos usam `created_at = 2000-01-01`
de propósito: `auth_tenant_id()` usa o vínculo mais recente e isso não pode mudar.
`fn_get_users_list` e `fn_get_users_for_admin_panel` escondem o dono.
Migração: `supabase/migrations/20260911210000_platform_owner_all_stores.sql`.

### Grupos do WhatsApp — só leitura (2026-09-12)

Evolution com `groupsIgnore=false`. O webhook manda mensagem de grupo (`@g.us`)
para `handleGroup`: nunca responde no grupo; grava em `asst_group_messages`
(texto; áudio transcrito pelo Whisper; foto/arquivo/vídeo viram "[Foto] legenda").
Na 1ª mensagem de um grupo cria `asst_groups` com nome (Evolution
`/group/findGroupInfos`) e `is_enabled = true` **só se o dono for participante**
(qualquer um pode adicionar o número num grupo). Liga/desliga na tela
Assistente › Configurações (`toggle_group`). Brain: `listar_grupos` e `ler_grupo`
(grupo por nome parcial, período padrão 24 h, filtro por palavra, até 600
mensagens / ~40k caracteres). Mensagens de grupo não são apagadas (histórico completo; decisão de 2026-09-12).
Migração: `supabase/migrations/20260912000000_assistente_grupos.sql`.

### Leitor universal — acesso de LEITURA a todo o ERPOS (2026-09-12)

Motivo: com só as ferramentas prontas ele dizia "não tenho acesso" (ex.: conta
paga, notas de entrada). Agora o brain tem `ver_tabelas`, `ver_colunas` e
`consultar_banco` (SQL SELECT/WITH, 1 consulta, máx. 500 linhas, resultado
cortado em 30k caracteres). Execução: conexão direta `SUPABASE_DB_URL`
(postgres.js) → `BEGIN READ ONLY` → `SET LOCAL ROLE asst_reader` →
`statement_timeout 10s`. O papel `asst_reader` (NOLOGIN, BYPASSRLS) tem SELECT
**coluna a coluna** via `fn_asst_reader_refresh()`: bloqueia 8 tabelas de
credenciais (Inter, provedor de pagamento, quiosque, Meta, push, links de
tráfego, platform_owners, asst_settings) e toda coluna cujo nome case com
secret/token/senha/pin_hash/cert/key_pem/api_key/client_id/... O cron roda o
refresh 1×/dia às 04:00 (tabela nova entra sozinha, sem as colunas sensíveis).
Tabela nova com segredo em coluna de nome "inocente" → adicionar em `v_block`.
Também: `contas_a_pagar` aceita `fornecedor` e `incluir_pagas`.
Migração: `supabase/migrations/20260912010000_assistente_leitor_universal.sql`.

### Custo — mapa do banco + cache (2026-09-12)

- **Mapa do banco** (`DB_MAP` no brain): tabelas principais, colunas, status e
  regras (faturamento sem is_training/cancelados, cardápio em uso = is_active,
  conta em aberto = status <> 'paid', fin_cash_flow = razão, CMV = compras,
  NF de entrada = fiscal_inbound_documents). Vai no bloco fixo junto com as
  instruções. Ao criar módulo novo relevante, acrescentar aqui.
- **Cache:** ferramentas + instruções + mapa com `ttl: '1h'` (o dono manda
  mensagens espaçadas; 5 min venceria). `cache_control` top-level (automático)
  guarda o resto da conversa, então cada rodada de ferramenta relê o histórico
  a 1/10 do preço. Histórico: 20 mensagens.
- `effort` configurável (`asst_settings.effort`, padrão `medium`). Medido em
  2026-09-12: `low` economiza só 1–3% com a mesma resposta → mantido `medium`.
- `resumo_loja` manda só 10 alertas de estoque + o total.
- `usage.cache_write_1h` separado (1 h = 2x; 5 min = 1,25x); a tela usa isso.

- **Cache mantido aquecido** (`assistente-cron` › `keepWarm`): entre 07:00 e
  23:00, se o dono falou nas últimas 4 h e está 50–58 min sem uso, chama o brain
  com `{ action: 'warm' }` → `max_tokens: 0` com o MESMO bloco fixo (ferramentas
  + instruções + mapa, `ttl: '1h'`, sem cache automático). Custa uma leitura
  (~R$ 0,008) e renova o TTL; evita regravar (~R$ 0,15). Fora da janela não
  aquece (se já venceu, aquecer = regravar). Controle: `asst_settings.last_warm_at`.
  **Pegadinha medida:** no Sonnet 5 o `effort` entra na chave do cache das
  instruções — o aquecimento sem `output_config.effort` (= padrão high) gravava
  uma entrada separada que nenhuma pergunta real (medium) lia. O warm usa o mesmo
  `asst_settings.effort`; confirmado: warm lê os 7.034 tokens gravados pela pergunta real.
- **Debounce** (`assistente-webhook` › `debounce`, tabela `asst_inbox`): texto e
  áudio esperam 3 s (era 6 s até 2026-09-12); se chegar outra mensagem, a mais nova responde por todas
  (1 chamada ao Claude em vez de várias). Foto/PDF vão direto. Fila limpa pelo
  cron após 7 dias.
- **Ferramentas em paralelo:** as pedidas na mesma rodada rodam com Promise.all.

Medição (Sonnet 5, cache quente): pergunta que garimpa o banco (Voxi) caiu de
R$ 0,28 para ~R$ 0,06 (8 → 2 ferramentas); cardápio/clientes R$ 0,12 → R$ 0,05;
"como tá a loja" ~R$ 0,07. A 1ª mensagem depois de >1 h sem uso paga a gravação
do cache (~R$ 0,15). Script de medição: mesmas perguntas via `body.effort`.

### Busca por nome aproximado — `buscar_nome` (2026-09-12)

Caso real: "foi pago a **Voxi**?" → o sistema tem **VOXY-SC LTDA** (conta NF 3540
paga em 08/09). Tanto o assistente quanto a checagem manual buscaram
`ILIKE '%voxi%'` e concluíram, errado, que não existia. Correção:
extensões `pg_trgm` + `unaccent` (schema `extensions`, `USAGE` para
`asst_reader`) e a ferramenta `buscar_nome`, que usa `word_similarity ≥ 0.35`
(ou "contém") sobre fornecedores, contas a pagar, notas de entrada, extrato,
clientes, cardápio, insumos e funcionários das lojas acompanhadas. O prompt
proíbe dizer "não existe/não foi lançado" sem ter usado `buscar_nome`.
`unaccent` precisa do dicionário explícito
(`extensions.unaccent('extensions.unaccent'::regdictionary, ...)`) porque o
`asst_reader` não tem `extensions` no search_path.
Migração: `supabase/migrations/20260912030000_assistente_busca_aproximada.sql`.

### Custo em reais na tela (2026-09-12)

O card "Custo IA estimado (30 dias)" mostra R$ convertido pela cotação do dia
(venda, comercial, sem IOF do cartão): AwesomeAPI
(`economia.awesomeapi.com.br/json/last/USD-BRL`, campo `ask`) e, se falhar, PTAX
do Banco Central (`CotacaoDolarPeriodo`, `cotacaoVenda`). Guardada 1 h em
`asst_settings.usd_brl`; sem fonte, usa a última conhecida. Abaixo do valor: US$,
cotação e fonte. Em 2026-09-11 o dólar estava ~R$ 5,13 (as estimativas antigas
deste README usavam R$ 5,50 → ~7% acima do real).

### Recursos nativos do WhatsApp — reação, enquete, localização, contato (2026-09-12)

Item 1.1 de `IDEIAS.md` (sem a resposta por áudio). Tudo via Evolution API, sem tokens:
- **Reação na mensagem do dono**: 👀 ao receber, depois ✅ (respondi), ⚠️ (respondi
  mas alguma ferramenta falhou), ❌ (erro), ❓ (mídia que não leio), 👍 (sem resposta).
  No debounce, a reação final vai em todas as mensagens do lote
  (`asst_inbox.message_key`).
- **"digitando…"/"gravando…"** (`sendPresence`): a Evolution segura a requisição pelo
  `delay` inteiro, então é disparado sem `await` (antes bloqueava 1,2 s por mensagem).
- **Resposta silenciosa**: se a mensagem não pede nada ("ok", "valeu", "👍"), o brain
  responde exatamente `NO_REPLY` e o webhook só reage 👍. Fica `NO_REPLY` no histórico.
- **Ações nativas pedidas pelo brain** (`actions[]` na resposta; o webhook executa
  depois do texto): `enviar_enquete` (`sendPoll`, 2–12 opções, uma ou várias),
  `enviar_localizacao` (`sendLocation`; pega `system_settings.delivery_config.store_location`
  da loja ou lat/lng livres), `enviar_contato` (`sendContact`, vCard com +55).
  Fora do WhatsApp (`channel` ≠ whatsapp) as ferramentas devolvem erro e o modelo
  responde em texto. No histórico fica "[Enquete enviada: …]" etc.
- **Voto na enquete**: enquete enviada é guardada em `asst_polls` (key.id). O webhook
  da Evolution passou a assinar `MESSAGES_UPDATE` (alterado via `/webhook/set` na VPS);
  o voto decifrado chega com `pollUpdates` → vira mensagem
  `[Enquete "pergunta"] Resposta: opção` e segue o fluxo normal (debounce → brain).
  Eventos `messages.update` sem `pollUpdates` (entregue/lido) são descartados antes
  de tocar o banco. **Ainda não validado com voto real** — se não chegar, olhar o log
  `pollUpdates sem enquete conhecida` (mostra as chaves do payload).
- **Modo "⏳ → editar"** (`asst_settings.ui.edit_placeholder = true`): manda "⏳" e
  edita a mesma mensagem com a resposta (`chat/updateMessage`). Desligado por padrão
  (reação + digitando já bastam e o WhatsApp marca "editada").
- Migração: `supabase/migrations/20260912040000_assistente_ux_whatsapp.sql`.
  Testes diretos no brain (2026-09-12): "valeu!" → `NO_REPLY`; pedido de enquete →
  `actions[poll]` com 3 lojas; "localização da principal + contato da Voxy" →
  `actions[location, contact]` (buscar_nome achou VOXY-SC LTDA e o telefone).

### Importar histórico de grupo (arquivo "Exportar conversa") — 2026-09-12

O WhatsApp **não entrega a um participante novo as mensagens anteriores** à entrada
dele no grupo (nem a Evolution tem como buscar). Para o assistente conhecer o passado,
o dono exporta no celular (Grupo › ⋮ › Mais › Exportar conversa › **Sem mídia**) e
manda o `.txt` para o assistente, com o nome do grupo na legenda se o nome do arquivo
não bastar. O webhook (`importGroupExport`) reconhece `text/plain`/`.txt`, faz o parse
dos formatos Android (`12/09/2026 10:31 - Nome: msg`) e iPhone
(`[12/09/2026, 10:31:05] Nome: msg`, inclusive AM/PM), junta linhas de continuação,
troca mídia por `[Mídia]`, ignora linhas de sistema e mensagens apagadas, e grava em
`asst_group_messages` com `message_id = import:<jid>:<hash>` (reimportar não duplica).
Se o grupo ainda não tem linha em `asst_groups` (nenhuma mensagem chegou desde a
entrada), procura pelo nome em `/group/fetchAllGroups` e cria já habilitado. Responde
"Importei N mensagens do grupo X (data a data)" sem passar pelo brain (custo zero).
No iPhone a exportação vem em `.zip`: descompactar e mandar o `_chat.txt`.
**Retenção:** mensagens de grupo **não são apagadas** (decisão do dono em 2026-09-12;
antes o cron apagava com mais de 90 dias).

### Camada 1 completa — dados públicos, clima, busca na web e proatividade (2026-09-12)

Itens 1.2–1.5 de `IDEIAS.md`. Brain (`assistente-brain`):
- `dados_publicos` (BrasilAPI, grátis, sem chave): `cnpj` (situação, CNAE, sócios,
  endereço), `cep`, `feriados` (ano), `taxas` (SELIC/CDI/IPCA), `ncm`. CNPJ
  inexistente/inválido → 404 da API → ferramenta falha e o modelo pede conferir.
- `previsao_tempo` (Open-Meteo, grátis): loja (coordenada de
  `system_settings.delivery_config.store_location`; sem ela, geocodifica
  `delivery_city`), cidade ou lat/lng. Devolve agora, próximas 12 h (hora a hora,
  % e mm de chuva) e 3 dias. Códigos WMO traduzidos.
- **Busca na web** nativa da Anthropic (`web_search_20250305`, `max_uses: 3`,
  localização aproximada Paranaguá/PR). US$ 10 por 1.000 buscas + tokens; contado em
  `usage.web_searches`. `API_TOOLS = [...TOOLS, WEB_SEARCH]` é usado na chamada real
  E no aquecimento (senão o cache não bate). Prompt: só quando a resposta não está
  no ERPOS nem nas outras ferramentas.

Cron (`assistente-cron` › `proactive`), **sem modelo** (regras em SQL via
`SUPABASE_DB_URL`, texto montado no código; custo zero por aviso). Configuração em
`asst_settings.proactive` (mesclada com os padrões abaixo); estado em
`asst_settings.proactive_state`. Cada aviso vai ao dono e entra em `asst_messages`
(`channel = 'cron'`) para o brain saber o que já foi dito.
- `closing` (23:00, janela 2 h, 1×/dia): fechamento por loja com
  `fn_get_sales_report` (mesma conta das telas) + cancelados, descontos, quebra de
  caixa e caixas abertos; compara com o mesmo dia da semana passada. Sem movimento em
  todas as lojas → não manda.
- `anomaly` (11:30–22:30, a cada 30 min): venda de hoje até agora × média do mesmo
  dia da semana nas últimas 4 semanas até o mesmo horário (só semanas com venda,
  mínimo 2, base ≥ R$ 300). Queda ≥ 30% → 📉; alta ≥ 50% → 📈. 1 aviso por loja por dia.
- `due_tomorrow` (17:00): contas em aberto que vencem amanhã (na sexta: sáb+dom+seg),
  total de atrasadas e `synced_balance` dos bancos. Nada vencendo e nada atrasado → não manda.
- `stock` (09:00): estoque crítico (`current_stock <= min_stock`, `min_stock > 0`,
  sem deletados) — manda **só o que entrou** em crítico desde o último aviso e
  quantos saíram; estado por loja (lista de ids). A 1ª execução lista tudo (baseline).
- `tasks_overdue` (18:00): tarefas do dono vencidas e não concluídas (até 12).
- **Prévia sem enviar:** `POST assistente-cron { preview: 'closing'|'anomaly'|'due_tomorrow'|'stock'|'tasks_overdue' }`
  (com `x-internal-key`) devolve o texto que seria enviado; não marca estado.
  Testado 2026-09-12: os 5 geram; `due_tomorrow` achou 1 conta (COPAL) + 35 atrasadas
  + saldo Inter; `stock` listou 14 + 31 itens; `tasks_overdue` 1.
- Desligar um aviso: `proactive.<nome>.enabled = false`; mudar horário: `.time`
  (`HH:MM`); anomalia: `drop_pct`, `spike_pct`, `min_base`, `from`, `to`, `every_min`.
- Resumo da manhã passou a pedir a previsão do tempo da loja principal (uma linha)
  e a não repetir o estoque crítico (o cron já avisa o que muda).

### Sistema pergunta pelo WhatsApp — classificação DRE (2026-09-12)

Regra do dono: **"sempre que o sistema não souber fazer algo, pergunta pra mim no
WhatsApp"**. 1º caso: conta a pagar sem classificação DRE (o `pay_bill` da
`financial-write` passou a recusar a baixa sem ela, exceto compra e folha).
- **Enquete foi abandonada (2026-09-12):** o dono votou e o voto nunca chegou ao
  webhook, e ele achou que enquete "fica em aberto". Agora é **mensagem de texto**.
- `assistente-cron` › `proactive.dre_classify` (08:00–21:00, checa a cada 2 min, **uma
  pergunta aberta por vez**): conta sem `dre_category_id` (pagas primeiro) → texto com a
  lista numerada **grupo › categoria** (todos os grupos, mesmo sem categoria) + quantas
  faltam. Cada conta é perguntada uma vez só.
- Resposta (webhook `tryDreAnswer`/`dreAnswer`, **sem modelo**): citando a pergunta ou
  não (sem citação só vale se houver uma única aberta e o texto parecer resposta):
  número da lista · nome exato da categoria · "Grupo Nome novo" (cria a categoria no
  grupo) · só o nome do grupo (categoria raiz) · "pular". Texto que não parece resposta
  segue para o brain normalmente. Depois de gravar, o webhook chama
  `assistente-cron { run: 'dre_classify' }` e a próxima pergunta sai na hora.
- `asst_polls` ganhou `kind` e `ref` (migração `20260912060000_asst_polls_kind_dre.sql`);
  a pergunta em texto usa a mesma tabela (`message_id` = id da mensagem enviada,
  `ref = { tenant_id, bill_id, options[{n,label,category_id}], groups[{key,label}] }`).
  `handleDreVote` (voto de enquete) ficou só por compatibilidade.
- Prévia: `POST assistente-cron { preview: 'dre_classify' }`. Resposta em texto ainda
  não validada com uso real.
- Novo caso de "perguntar ao dono" = novo `kind` em `asst_polls` + tratador no webhook.

### Ações no ERPOS como o dono — `erpos_executar` (2026-09-12)

Pedido do dono: "o assistente executa tudo no ERPOS como se fosse eu". Em vez de
escrever nas tabelas (pularia regra de negócio), o brain **age com uma sessão real
do dono** e chama as mesmas Edge Functions das telas.

- **Sessão do dono** (`ownerToken`): `auth.admin.generateLink({type:'magiclink'})` →
  `verifyOtp({token_hash, type:'magiclink'})` com a anon key → JWT do dono válido por
  1 h, guardado em memória do isolate e renovado 2 min antes de vencer. Nenhum e-mail
  é enviado. Diagnóstico: `POST assistente-brain { action: 'session_check' }`.
- **Ferramenta `erpos_executar`** `{ funcao, action, dados, loja?, confirmado?, resumo }`:
  allowlist de funções (`EDGE_ALLOW`: menu, financial, purchase, stock, customer,
  reservation, table, config, voucher, production, user, task, delivery, order,
  fiscal, implementation; `create_order` bloqueado; mesa-write e print-queue-write
  fora por não autenticarem). `callEdge` manda `dados` **como `payload` e também no
  nível de cima**, e o tenant nos dois nomes (`tenant_id` e `active_tenant_id`),
  porque as edges divergem de convenção. Timeout 25 s.
- **Confirmação:** ações cujo nome casa com `SENSITIVE`
  (delete/pay/refund/cancel/void/close/reset/archive/…) exigem `confirmado=true`; sem
  isso a ferramenta devolve erro pedindo para perguntar ao dono. O prompt manda
  descrever ação + valor, esperar o "sim" e só então repetir com `confirmado`.
  Criar/editar cardápio, cliente, fornecedor, conta a pagar e ajuste de estoque
  podem ir direto quando o pedido é claro.
- **Auditoria:** cada chamada em `asst_actions` (função, ação, payload com `_resumo`
  e `_loja`, ok/status/result/error/ms). O `audit_log` do ERPOS registra o dono.
- **MAPA DE AÇÕES** (`EDGE_MAP`, no bloco fixo cacheado junto com o `DB_MAP`):
  contratos reais extraídos do código das 19 edges (ações, campos, enums, (S) para
  sensível, formato de retorno). Ao mudar uma edge, atualizar o mapa.
- Pegadinhas das edges (do levantamento): `stock-write` e `task-write` caem no
  primeiro tenant se o enviado não bater; `user-write` devolve erros com HTTP 200
  `{error}` (tratado: `ok` exige sem `error` e sem `success:false`); `config-write`
  não autentica (o `tenant_id` do body é lei); `menu-write upsert_item` com
  `option_groups` substitui todos os grupos.
- Migração: `supabase/migrations/20260912070000_assistente_acoes_erpos.sql`.
- Testes 2026-09-12 (via brain, depois limpos): criar item inativo "Teste Assistente"
  na categoria com mais itens (achou Pasteis sozinho) → ok; lançar conta a pagar de
  R$ 1 → ok; "paga a COPAL" → parou e pediu confirmação com valor; "apaga o item" →
  pediu confirmação, "sim" → `delete_item` com `confirmado=true`; idem `delete_bill`.

### Telegram — canal principal de conversa (2026-09-12)

Decisão do dono: conversa, áudio, fotos, confirmações e avisos do cron vão pelo
**Telegram** (botões nativos, sem risco de banimento, grátis); o **WhatsApp fica só
para leitura de grupos** (`channels.whatsapp_dm = false` → DM no WhatsApp recebe,
uma vez por dia, "agora eu converso pelo Telegram").

- Edge **`assistente-telegram`** (webhook do Bot API; `setWebhook` com
  `secret_token = ASSISTENTE_INTERNAL_KEY`, conferido no header
  `X-Telegram-Bot-Api-Secret-Token`; `allowed_updates = message, callback_query`).
  Secret `TELEGRAM_BOT_TOKEN`. Só responde a `asst_settings.telegram_allowed_ids`;
  desconhecido recebe o próprio id (para cadastro).
- Entrada: texto; voz/áudio (`getFile` → Whisper na VPS); foto (maior tamanho) e PDF
  → anexo do brain; localização/contato viram texto; encaminhada ganha
  `[Encaminhada]`. Debounce de 2,5 s na mesma `asst_inbox` (chat_id `tg:<id>`).
  `.txt` de exportação de grupo continua só pelo WhatsApp.
- Saída: `*negrito*`/`_itálico_` do modelo → HTML do Telegram (fallback texto puro);
  mensagens > 3.900 caracteres quebram em parágrafos. **`enviar_enquete` vira
  teclado inline** (1 botão por opção; `callback_data = <fim do id>|<índice>`;
  registro em `asst_polls` com `kind = 'tg_buttons'`). Clique → `answerCallbackQuery`,
  a mensagem é editada para "❓ pergunta / ✅ escolha" (botões somem), e o brain
  recebe `[Botão "pergunta"] Resposta: X`. `enviar_localizacao` → `sendVenue`;
  `enviar_contato` → `sendContact` (vCard).
- Reações (conjunto limitado do Telegram): 👀 recebi, 👍 respondi, 🤔 alguma ferramenta
  falhou, 😱 erro, 🫡 NO_REPLY. "digitando…" renovado a cada 4,5 s durante o brain.
- Brain: `channel = 'telegram'`, `chat_id = tg:<id>` (histórico separado do WhatsApp;
  memórias são compartilhadas). Prompt pede botões também para confirmar ação
  sensível (em vez de "manda sim").
- Cron: `deliver(target)` manda para Telegram quando o destino é `tg:<id>`; o
  destino do dono é `tg:<telegram_owner_chat_id>` quando `primary_channel =
  'telegram'`, senão o JID do WhatsApp. Lembretes criados no Telegram guardam
  `chat_id = tg:...` e voltam lá. **Exceção:** a enquete de classificação DRE
  (`dreClassify`, do Codex) usa `sendPoll` da Evolution e continua indo ao WhatsApp.
- Setup (uma vez): criar bot no @BotFather → `supabase secrets set TELEGRAM_BOT_TOKEN=...`
  → `setWebhook` → dono manda /start → id aparece na resposta e no log → gravar
  `telegram_allowed_ids = [id]`, `telegram_owner_chat_id = id`,
  `primary_channel = 'telegram'`, `channels.whatsapp_dm = false`.
- Migração (só settings): `supabase/migrations/20260912080000_assistente_telegram.sql`.
- **NO AR 2026-09-12:** bot `@assistente_erpos_bot` (t.me/assistente_erpos_bot,
  nome de exibição ainda "John Snow"); webhook confirmado pelo `getWebhookInfo`;
  dono = Telegram id `8745495079` (em `telegram_allowed_ids` e
  `telegram_owner_chat_id`); `primary_channel = 'telegram'`;
  `channels.whatsapp_dm = false`. Mensagem de boas-vindas enviada pela API.
  Falta: 1ª conversa real pelo webhook e 1º clique em botão.

### Testes reais no Telegram + correções (2026-09-12)

Teste do dono: texto, 2 áudios e botão — tudo respondeu (reações, "digitando",
botão virou "✅ escolha" e o brain seguiu). Achados e correções:
- **Whisper errou nome de lugar** ("Paranaguá" → "parar na água"). Agora o `/asr`
  recebe `initial_prompt` com o vocabulário (El Patrón, Paranaguá, Vila Leste,
  ERPOS, cardápio, DRE, Pix, iFood…) no Telegram e nos áudios de grupo do WhatsApp.
- **Sessão do dono em corrida:** o modelo pediu 8 `upsert_dre_category` em paralelo;
  cada `generateLink` invalida o link anterior → 7 falharam com "Email link is
  invalid or has expired" (ele repetiu e as 8 categorias foram criadas). Agora
  `ownerToken` é **single-flight** (uma geração por vez no isolate), a sessão fica em
  `asst_settings.owner_session` para outros isolates reaproveitarem, e há 1 retry.
  Testado: 5 `session_check` simultâneos, todos ok.
- **Bug grave removido:** depois de gerar a sessão o código chamava
  `signOut({ scope: 'others' })`, que encerra TODAS as outras sessões do dono (ERPOS
  no navegador/celular). Não houve revogação registrada hoje, mas foi removido.
- **Update repetido do Telegram:** um 502 (cold start) faz o Telegram reenviar;
  `asst_tg_updates` guarda o `update_id` e ignora repetidos (limpo em 7 dias pelo cron).
- **Classificação DRE agora no Telegram, com botões** (pedido do dono): `dreClassify`
  manda para o canal principal; no Telegram cada categoria é um botão (`d|<n>`,
  `d|0` = pular), `asst_polls.message_id = tgdre:<chat>:<message_id>`. Clique grava
  direto (sem modelo), edita a pergunta com o resultado e já pede a próxima
  (`run: dre_classify`). Resposta digitada também vale (número, nome, "grupo + nome"
  cria categoria, "pular"). `dreAnswer`/`applyDreChoice` são **cópia** das do
  `assistente-webhook` — mudar nos dois. A pergunta que estava aberta no WhatsApp foi
  apagada para ser refeita no Telegram.
- Migração: `supabase/migrations/20260912090000_assistente_tg_updates.sql`.

### Classificação DRE em duas etapas no Telegram (2026-09-12)

Pedido do dono depois de classificar algumas: **primeiro o grupo, depois a categoria
dentro dele**, e **"➕ Nova categoria" como botão** (escolhe o grupo e digita o nome).
A mesma mensagem é editada a cada toque (`assistente-telegram` › `dreView`/`showDre`):
- Tela 1 (enviada pelo cron): despesa + um botão por grupo com a contagem de
  categorias, "➕ Nova categoria", "⏭️ Pular".
- Tela 2 (`d|g|<i>`): categorias só daquele grupo (`d|c|<n>`), "➕ Nova categoria em
  <grupo>" e "⬅️ Grupos".
- Nova categoria (`d|n` → `d|ng|<i>`): lista os grupos; escolhido o grupo, grava
  `asst_polls.ref.awaiting_new = i` e pede o nome. A próxima mensagem digitada vira o
  nome (até 60 caracteres; "cancelar"/"voltar" desfaz), cria a categoria (raiz) no grupo
  e classifica a conta. "⬅️ Voltar" limpa a espera.
- Fim: a pergunta é editada com "✅ Classificada em …" e a próxima conta já chega.
- `ref` ganhou `header`, `footer` e `options[].group` (o cron grava). Botões antigos
  `d|<n>` continuam funcionando (legado). A resposta digitada antiga (número/nome/
  "grupo + nome"/"pular") também continua.

### Solicitação de pagamento no grupo — mídia lida e pagamento preparado (2026-09-12)

O que o dono pediu: *"nesse tipo de msg com solicitação é pra ler msg, imagem, doc ou áudio,
pegar as informações, preparar o pagamento e me avisar"* — depois de o assistente dizer, sobre
uma foto no grupo *Financeiro loja - EP MALL*, que só via o texto da mensagem.

**Como ficou.** No grupo, foto e PDF passam a ser baixados e LIDOS: o webhook chama
`assistente-brain` com `action: 'ler_midia'` (uma chamada curta, sem ferramentas, sem histórico)
e guarda o resultado em `asst_group_messages.extracted`, com o resumo junto do `content` (é isso
que o `ler_grupo` mostra depois). Áudio continua transcrito pelo Whisper.

**Itens de cupom/nota (2026-09-12, à noite).** A primeira versão pedia "transcrição curta (até
600 caracteres)" com `max_tokens` 1200 e não tinha campo de itens: no cupom do Sacolão veio só
cabeçalho + total, e o assistente disse ao dono que o cupom não tinha valor por item. Agora
`extracted.itens = [{ descricao, quantidade, unidade, valor_unitario, valor_total }]` (todas as
linhas), `texto` até 3000 caracteres, `max_tokens` 6000; o `ler_grupo` devolve os itens em
`documentos_de_pagamento` e a triagem manda até 12000 caracteres da leitura. A imagem não fica
salva: para reler uma mensagem já gravada, `POST assistente-webhook { action: 'reler_midia',
message_id }` (aceita `Authorization: Bearer <SERVICE_ROLE_KEY>` — no projeto é a chave
`sb_secret_…`, não a JWT legada); a Evolution devolve a mídia pelo id. Só atualiza
`content`/`extracted`, não refaz a triagem.

**Status automático + comprovante no grupo (2026-09-12, à noite).** Antes o cartão do pagamento
só mudava tocando em "Ver status". Agora o `assistente-cron`, a cada tick, conta os pagamentos em
andamento (`sent/pending_approval/approved/scheduled`, enviados há até 7 dias, chat `tg:`) e, se
houver, chama `assistente-telegram { action: 'pay_watch' }`: consulta o Inter (`payment_status`)
a cada ~minuto nas primeiras 2 h e a cada 30 min depois, e edita o cartão quando o status muda.
Não é sync de extrato (ver regra "conciliação sem cron"): só roda enquanto há pagamento mandado
pelo dono. Quando vira `paid` e o pagamento está ligado a um pedido de grupo
(`asst_group_requests.payment_id`), o comprovante em texto (valor, recebedor, data, E2E do Pix /
linha digitável, código no Inter, loja pagadora) é postado no grupo **respondendo a mensagem do
pedido**, via `assistente-webhook { action: 'group_send' }` — única escrita em grupo, texto do
código (não do modelo), só em grupo com `is_enabled`. `receipt_sent_at` é o trinco (uma vez só);
falhou → `receipt_error` e o "Ver status" tenta de novo. O vínculo nasce na triagem ou no
`preparar_pagamento` (param `solicitacao_grupo_id`, ou pedido do grupo com o mesmo valor em 72 h).
A API do Inter não entrega o comprovante oficial (não achamos endpoint), então o comprovante é
uma **imagem gerada** (`assistente-telegram/receipt.ts`: SVG → PNG com `@resvg/resvg-wasm` e fonte
Inter TTF do jsDelivr, layout aprovado pelo dono em 2026-09-12) com os dados do `response` do Inter
(recebedor, pagador = tenant name/cnpj, E2E, código, horário de aprovação) e rodapé "gerado pelo
ERPOS". Vai no grupo via `sendMedia` **citando a mensagem do pedido** (a citação leva o
`participant` = autor, lido de `asst_group_messages.sender_jid`) e uma cópia vai ao dono no
Telegram (`sendPhoto`). Se a imagem falhar, cai no texto. Reenvio manual:
`assistente-telegram { action: 'send_receipt', payment_id }` (x-internal-key ou Bearer da chave
`sb_secret_…`). Primeiro envio real: Pix do Sacolão (R$ 210,12) respondendo a foto da Thati.

**Cupom de compra → compra → pagamento → estoque → baixa (2026-09-12, à noite).** Regra
"CUPOM/NOTA DE COMPRA" no system do brain (vale na conversa e na triagem de grupo), na ordem:
(1) ler todas as linhas; (2) casar com insumos — memória `purchase_receipt_item_links`
(supplier_key = CNPJ/nome normalizado, description_key) e depois `buscar_nome`; dúvida → botões,
sem insumo → avisa para criar; (3) `purchase-write create_purchase` com `payment_status 'pending'`
(nunca `'paid'`: debitaria o banco e o extrato debitaria de novo; e nunca `upsert_bill` à parte —
a compra já gera a conta); (4) `preparar_pagamento` com `conta_a_pagar_id` da conta gerada;
(5) cupom de balcão (NFC-e) → `confirm_delivery` (estoque só entra no recebimento); entrega
futura → não confirma; (6) baixa automática. **Baixa**: pago + `bill_id` → telegram chama
`assistente-brain { action: 'baixa_conciliada', payment_id }`, que faz `inter-bank sync` (3 dias,
só a loja), `conciliacao-pagamentos rematch` e confirma SÓ a linha de `fin_bank_statement_imports`
com `match_kind='payable'` e `match_ref_id = bill_id` (mesmo caminho da tela: `pay_bill` com a
conta do banco). Débito ainda não caiu no extrato → `pendente`; o `pay_watch` tenta de novo a cada
10 min por até 2 dias (15 tentativas; colunas `fin_inter_payments.settled_at / settle_attempts /
settle_last_try / settle_error`). É exceção deliberada à regra "conciliação sem cron": só roda para
pagamento que o dono acabou de fazer pelo assistente.

**Entrada de compra pelo grupo, sem pedido de pagamento (2026-09-13).** Cupom/nota postado só
"para avisar que chegou" (ex.: mercado pago em dinheiro, só marcando o dono) antes era descartado
pela triagem. Agora, se a leitura da mídia diz `tipo_documento` nota_fiscal/cupom/pedido com
`itens` e não há pedido de pagamento, o webhook chama `triarPagamento(..., 'compra')`:
`asst_group_requests.kind = 'compra'` e brain em `modo: 'entrada_compra_grupo'` (regra
ENTRADA DE COMPRA PELO GRUPO): casar insumos, lançar a compra e confirmar recebimento do cupom de
balcão, **sem** `preparar_pagamento`. Pago na hora (dinheiro/cartão/Pix no cupom) → compra
`'paid'` com essa forma e sem conta bancária (não abre conta a pagar); senão `'pending'`. Desliga
com `asst_settings.group_watch.purchase_entries = false`. Primeiro caso: cupom da Condor
(R$ 29,31, dinheiro) — o modelo perguntou as dúvidas de insumo antes de lançar.

**Tudo que a tela faz, o assistente faz (2026-09-14, regra do dono).** Gatilho: ele respondeu que
não podia "atualizar a conciliação da Stone", mas a tela tem o botão (`stone-conciliation › sync`)
e a edge não estava no `EDGE_ALLOW`. Agora, sempre com o JWT do dono (mesma RLS/permissão da tela):
- `erpos_executar`: `EDGE_ALLOW` cobre todas as edges que o front chama (inclui stone-conciliation,
  inter-bank, ifood-financial, fiscal-inbound, conciliacao-pagamentos, purchase-confirm-delivery,
  hiring-cv-scan…), com as ações documentadas no `EDGE_MAP`. Bloqueio: credenciais/autorização
  de integração (`EDGE_ACTION_BLOCK`) e pagamento direto no inter-bank (só `preparar_pagamento`).
- `erpos_rpc` (novo): qualquer função do banco que as telas usam (`/rest/v1/rpc`), exceto
  `RPC_BLOCK` (acesso de pessoas a lojas, convites, tokens do quiosque, admin); `RPC_SENSITIVE`
  (cancelar, estornar, fechar…) exige `confirmado`. `p_tenant_id` é sempre a loja resolvida.
  Parâmetros: o modelo consulta `pg_get_function_arguments` via `consultar_banco`.
- `erpos_tabela` (novo): gravação direta só nas tabelas que o front grava sem edge (`TABLE_ALLOW`:
  hiring_*, ingredient_batches, ingredients/print_queue/system_settings/table_sessions update,
  user_preferences); update/delete um registro por vez (`filtro.id`); delete, system_settings e
  table_sessions exigem `confirmado`; chave Pix bloqueada.
- System prompt: nunca dizer "não consigo" sem procurar nos três caminhos. Inventário de onde
  saiu a lista: `grep invokeWithAuth|functions.invoke|.rpc(|.from().insert/update` em `src/`.

**Demandas pelo WhatsApp → assistente do Telegram (2026-09-14).** O dono recebe demandas no
WhatsApp e encaminha para o número do assistente. Com `channels.whatsapp_dm = false`, em vez do
aviso "converso pelo Telegram", o webhook (`relayToTelegram`) manda tudo para o brain **no chat do
Telegram** (`chat_id = tg:<telegram_owner_chat_id>`, mesmo histórico e ferramentas), com o prefixo
`[Encaminhada pelo WhatsApp]` / `[Pelo WhatsApp]`: texto; áudio transcrito (Whisper); foto e PDF
como anexo; vídeo/outros arquivos só anotados. Mensagens seguidas passam pelo `debounce` (viram
uma). A resposta sai no Telegram (`deliver`, prefixo 📲). No WhatsApp: 👀 recebi, ✅ repassei,
❌ falhou (+ aviso). Exceções que continuam no WhatsApp: janela de currículos (abaixo) e `.txt` de
exportação de conversa (histórico de grupo). Arquivo sem aviso de currículo também é repassado.

**Agendamento de entrevista com o candidato (2026-09-14, Fases 1–2).** Decisões do dono: início
automático pela etapa "Chamar p/ entrevista" (`hiring_stages.native_kind = 'agendar'`); disponibilidade
e entrevistadores por vaga (`hiring_job_scheduling`, tela Contratação › Vagas › editar › "Entrevistas
pelo assistente" — `AgendamentoVaga.tsx`); **sem configuração completa (janela + entrevistador com
WhatsApp + local se presencial) nada é enviado**; entrevistadores = gestores da vaga, respondem pelo
WhatsApp do assistente. Edge **`hiring-scheduler`** (x-internal-key/service role, `--no-verify-jwt`):
- `tick` (assistente-cron, todo minuto): convites 8h–20h (até 3/rodada, 10/hora — risco de bloqueio do
  número Baileys), 1 inscrição por candidato por vez; cobrança após 24 h sem resposta (1×) e depois
  `sem_resposta` (+ aviso aos entrevistadores); lembrete na véspera (candidato + entrevistadores).
- `inbound` (assistente-webhook, ANTES do canal-publico, só para quem não é o dono): candidato com
  sessão ativa (`hiring_scheduling_sessions`, casado pelos últimos 11 dígitos) ou entrevistador com
  pedido pendente → `{handled:true}`; senão o webhook segue para o `canal-publico`. Candidato: número =
  horário oferecido; texto → Haiku SÓ classifica (escolher/propor/pergunta/recusar/cancelar/remarcar)
  e responde com os fatos da vaga (sem ferramentas; salário/benefícios → "a equipe explica").
  Horário pedido que está livre → reserva; fora da agenda → `aguardando_gestor` e mensagem aos
  entrevistadores com código: `#ABCD 1` aceita (reserva forçada), `#ABCD 2` recusa (reoferece),
  `#ABCD dd/mm hh:mm` propõe (candidato responde 1/2).
- Banco (migration `20260914220000_hiring_agendamento_fase2.sql`): `hiring_interviews.job_id`;
  `fn_hiring_free_slots(job, limit)` (janelas, duração+intervalo, antecedência, datas bloqueadas,
  capacidade por horário, fuso SP); `fn_hiring_book(sessão, início, force)` atômica (lock por vaga):
  entrevista 'agendada' + candidato em "Entrevista agendada" (+ cancela a anterior na remarcação).
- **Status das conversas (2026-09-14, Fase 3):** aba Contratação › **Agendamentos**
  (`AgendamentosPainel.tsx`): linha do tempo Enviada → Entregue → Lida → Respondeu → Agendada →
  Confirmada, filtros por status/vaga, conversa completa (`history`), pedidos aguardando entrevistador
  (código) e quem está em "Chamar p/ entrevista" SEM convite com o motivo (vaga sem config/incompleta,
  sem telefone, fora do horário, fila). Recibos: `hiring-scheduler` guarda o `key.id` da última
  mensagem ao candidato (`last_out_msg_id`); o `assistente-webhook` trata `messages.update`
  (`hiringReceipts`: DELIVERY_ACK → `delivered_at`, READ/PLAYED → `read_at`). Confirmação de
  presença: a véspera pede "1 confirma / 2 não posso" (`confirm_requested_at`); no dia, das 8h até
  1 h antes, pede de novo se faltar; "1" → `confirmed_at` + aviso aos entrevistadores; "2" → cancela
  e oferece remarcar. Migration `20260914230000_hiring_agendamento_status.sql`.
- Pegadinhas: `hiring_interviews.format` aceita presencial/telefone/**video** (não "online");
  enquete do WhatsApp não entrega voto (por isso respostas por número/texto).

**Pix só para quem está cadastrado — pelo NOME, nunca pedindo chave (2026-09-14, regra do dono).**
Gatilho: pedido de reembolso "Pix para o Eduardo" no grupo e o assistente pediu a chave Pix ao dono (e
nem achou o Eduardo, que estava em `fin_pix_favorecidos` — ele procurou em hr_employees). Agora
`preparar_pagamento` tem `favorecido` (nome): o brain resolve a chave em `fin_pix_favorecidos` (ativo,
da loja do Inter) + `fin_suppliers.pix_key`, por nome sem acento; 1 resultado → usa a chave; vários →
pergunta qual pelo nome (sem mostrar chave); nenhum → responde para cadastrar em Assistente › Pix
permitidos. `chave_pix` só quando a chave veio num documento (boleto/QR/copia e cola). Prompt (regra de
solicitação de pagamento, PAGAMENTOS PELO INTER e TRIAGEM DE GRUPO): NUNCA pedir, sugerir ou aceitar
chave Pix digitada na conversa. A trava do inter-bank (chave precisa ser de fornecedor ou Pix
permitido) continua valendo.

**Ler grupo = ir buscar no WhatsApp (2026-09-14, pedido do dono).** Gatilho: "veja as msgs do grupo
de hoje" respondeu "sem mensagens", mas as mensagens do grupo não estavam chegando (a conta passou a
`addressingMode: 'lid'` depois de 2 LOGOUT/re-pareamentos em 14/09; o próprio banco da Evolution não
tinha mensagem de grupo depois de 13/09 19:39). Agora `ler_grupo`: (1) `resgatarGrupo` busca na
Evolution (`POST /chat/findMessages/{inst}` com `where.key.remoteJid` = grupo) o que existe lá e não
está em `asst_group_messages`, grava (conteúdo "… (resgatada)") e manda foto/PDF para
`assistente-webhook › reler_midia`; devolve `resgatadas_agora`. (2) Sem mensagens no período e a
última do grupo com mais de 6 h → devolve `aviso` e o modelo NÃO pode dizer "não teve mensagens":
diz desde quando não recebe e pede para encaminhar. Limite: a Evolution só tem o que o WhatsApp
entregou a ela; mensagem que nunca chegou ao número não dá para puxar (o `onDemandHistSync` da
Evolution só dispara com esse texto enviado pelo próprio celular dentro da conversa).

**Nada repetido (2026-09-14, regra do dono).** Currículo repetido não entra: `hiring-cv-scan ›
intake` confere telefone (últimos 11 dígitos), e-mail ou nome ANTES de subir o arquivo e responde
409 `{duplicate: true}`; a tela (grava direto) é travada pelos índices únicos
`hiring_candidates_phone_uniq` / `hiring_candidates_email_uniq` (migration
`20260914190000_hiring_candidates_sem_repetido.sql`, que também removeu a Natalia duplicada). No
WhatsApp, `cvFromWhatsApp` devolve `ok | dup | not_cv | erro`: repetido → "⚠️ … não salvei" (🔁);
não é currículo (422, ex.: demanda encaminhada com a janela aberta) → `relayToTelegram`. Brain:
antes de criar tarefa/lembrete/compra/conta/cadastro confere se já existe; `task-write
delete_task` documentado no `EDGE_MAP`.

**Currículos pelo WhatsApp — só recebimento (2026-09-13).** O dono recebe currículos no WhatsApp
dele e ENCAMINHA para o número do assistente. Com `channels.whatsapp_dm = false`, a conversa
particular continua desligada, com uma exceção no webhook — **só depois de o dono avisar**
(decisão dele: PDF sem aviso não é currículo): mensagem curta com "currículo" abre 1 h de
recebimento (`asst_settings.wa_cv_intake { until, count }`, renovada a cada arquivo); nesse
período PDF, foto ou texto ≥ 250 caracteres vai para `cvFromWhatsApp` → `hiring-cv-scan › intake`
(x-internal-key), sem passar pelo modelo; "pronto" encerra com a contagem. Arquivo com "currículo"
na legenda vale mesmo sem aviso. Arquivo sem aviso → resposta pedindo o aviso (nada é salvo).
Confirmação por arquivo: "✅ Currículo salvo: Nome — cargo" (⚠️ se repetido; ❌ com o motivo). Se o modo de currículos do Telegram
estiver ligado (`asst_settings.hiring_intake`, válido), usa a mesma empresa/vaga; senão o
candidato entra no banco geral em "Novo". Triagem, vaga e conversa ficam no Telegram.

Se a mensagem parecer **pedido de pagamento** — `extracted.pagamento.e_solicitacao`, ou o
pré-filtro `PAY_HINT` no texto/transcrição — o webhook grava a solicitação em
`asst_group_requests` e chama o brain em `modo: 'triagem_grupo'`, no chat do dono. O brain
prepara o pagamento (`preparar_pagamento`) e o aviso chega no Telegram já com os botões
Pagar/Cancelar, pela entrada interna `{ action: 'deliver', chat_key, text, actions }` do
`assistente-telegram`. Falta dado (linha ilegível, sem valor, chave que não é de fornecedor
cadastrado nem dos Pix permitidos)? Ele avisa o que falta em vez de preparar. Não é pedido de
pagamento? Responde `NO_REPLY` e nada é enviado.

**Segurança e custo (as travas).**
- Mensagem de grupo é de terceiro: vai delimitada em `<mensagem_do_grupo>` e o system manda
  tratar como dado, nunca ordem. Preparar é só rascunho: o pagamento continua exigindo o botão,
  o PIN (que não passa pelo modelo) e a aprovação no app do Inter. Pix só para fornecedor
  cadastrado ou Pix permitido; o assistente não cadastra ninguém.
- `asst_group_requests.message_id` é único: reenvio do webhook não prepara o mesmo pedido 2×.
- Teto de `max_per_day` (padrão 30) triagens por 24 h e chaves de liga/desliga em
  `asst_settings.group_watch = { read_media, pay_requests, max_per_day }`.
- Migration: `supabase/migrations/20260912160000_assistente_grupo_midia_solicitacoes.sql`
  (aplicar antes de publicar as funções; sem ela o webhook grava a mensagem sem `extracted` e a
  triagem não roda).

### Currículos para o módulo Contratação (2026-09-13)

Pedido do dono: "sempre que eu enviar arquivo eu falo que vou enviar e ele sobe pro módulo Contratação".
- Brain: ferramenta **`modo_curriculos`** `{acao: ligar|desligar, empresa?, vaga?}`. Ela grava
  `asst_settings.hiring_intake = { chat_id, until (+1 h), count, company_id/name, job_id/title }`.
  Empresa e vaga vêm do módulo Contratação (`hiring_companies`/`hiring_jobs`, por nome parcial) e
  não das lojas do ERPOS.
- Com o modo ligado, o `assistente-telegram` (`tryHiringIntake`, antes do PIN/DRE) manda **cada
  PDF/foto, ou texto ≥ 250 caracteres**, direto para `hiring-cv-scan › intake`, **sem passar pelo
  modelo**. O intake lê com o Haiku, guarda o arquivo no bucket `curriculos`, cria o candidato em
  "Novo" e, se houver vaga, inscreve e roda a análise currículo × vaga. O dono recebe "✅ Nome —
  cargo · idade · bairro / salvo em … / aderência". "pronto"/"acabou" encerra; mensagem curta vai
  ao brain normalmente; o modo desliga sozinho após 1 h sem arquivo.
- Arquivo avulso ("salva esse currículo pra vaga X"): ferramenta **`salvar_curriculo`**
  `{texto?, empresa?, vaga?}`, que usa o anexo da mensagem atual (`ctx.attachment`).
- `hiring-cv-scan` aceita `x-internal-key = ASSISTENTE_INTERNAL_KEY` (publicada com
  `--no-verify-jwt`; o login do dono é conferido dentro). WhatsApp DM continua desligado, então o
  canal é o Telegram.

### Canais públicos — links wa.me com código (2026-09-14)

Pedido do dono: "disponibilizar um número para as pessoas mandarem currículo, o assistente conversa
pedindo o currículo e dá informações conforme a gente permitir", **sem comprar linha nova**. Usa o
MESMO número do assistente (a conversa direta dele estava parada desde que foi para o Telegram).

- **Roteador** (`assistente-webhook` › `handle`): mensagem direta de quem NÃO está em
  `allowed_chat_ids` → `toPublicChannel` → edge **`canal-publico`** (antes era ignorada). O dono só
  cai lá testando: mensagem com o código de um canal existente, ou teste aberto há < 30 min
  (`ownerTestingPublic`); "#sair" encerra o teste. Grupos e o fluxo do dono não mudaram.
- **Links:** `https://wa.me/<número>?text=<start_text>`; o texto pronto leva um código
  `XX-XXXX` (ex.: `CV-7K2P`, regex `/\b([A-Z]{2,4}-[A-Z0-9]{4})\b/i` nas duas edges). O código
  identifica o canal; conversa aberta continua no mesmo canal por até 7 dias sem precisar do código.
  Sem código e sem conversa: só atende se houver canal `is_default`; senão ignora.
- **`canal-publico`** (verify_jwt false; `incoming` com x-internal-key, `info` com JWT de quem tem
  o módulo Contratação → número da instância via Evolution `fetchInstances`). SEM sessão do dono e
  sem acesso ao ERPOS: arquivo (PDF/foto) vai direto para `hiring-cv-scan › intake` com a
  empresa/vaga do canal (sem modelo de conversa); texto/áudio → debounce 3 s → **Haiku 4.5** com
  system montado só com os campos da vaga liberados (`share_fields`) + `extra_info` + `forbidden`
  e 3 ferramentas: `registrar_sem_curriculo` (intake com texto), `chamar_equipe` (aviso ao dono no
  Telegram, `needs_human`) e `encerrar_conversa`. Limites: 30 respostas/dia por conversa, 3
  currículos por conversa. Cada currículo avisa o dono no Telegram (`notify_owner`), com
  aderência à vaga quando há vaga.
- Tabelas: `bot_channels`, `bot_conversations`, `bot_messages` (RLS `is_hiring_admin()`);
  `hiring_candidates.source` (`whatsapp_link` / `whatsapp_link_teste`) + `source_channel_id`;
  telefone do WhatsApp entra no candidato quando o currículo não traz.
  Migração: `supabase/migrations/20260914120000_bot_canais_publicos.sql`.
- Tela: Contratação › **Links WhatsApp** (`components/LinksWhatsApp.tsx`): criar/editar link
  (empresa, vaga, texto pronto, 1ª resposta com `{nome}/{empresa}/{vaga}`, o que pode contar,
  proibidos, aviso, padrão, ativo), copiar link, QR Code (`react-qr-code`), conversas no estilo
  WhatsApp com "Abrir candidato" e "Falar pelo meu WhatsApp".
- Novo propósito (reservas, fornecedores…): valor novo em `bot_channels.purpose` + prompt/ferramentas
  próprias no `canal-publico` (hoje só `curriculos`).

### Respostas no @lid — nada saía pelo WhatsApp (2026-09-14)

Depois do `device_removed` e do repareamento, **todo envio para o telefone (`55...@s.whatsapp.net`)
sumia sem erro**: a Evolution aceitava (201, status PENDING), mas nada aparecia nem no celular do
assistente. As mensagens do dono passaram a chegar de `197701790621715@lid` (telefone só em
`remoteJidAlt`) e o webhook respondia no telefone. Teste autorizado: `sendText` para o `@lid` →
**chegou**. Correção: `assistente-webhook` separa identidade (`number` = telefone) de destino
(`replyTo` = JID de origem quando `@lid`) nos envios do dono e repassa `reply_to` ao `canal-publico`,
que responde em `to(m)`. Diagnóstico: no Postgres da Evolution, `"Message".key->>'remoteJid'` das
recebidas (`@lid`?) × das enviadas. **Atenção — o evento NÃO traz o @lid:** no webhook, `key.remoteJid` e `key.remoteJidAlt` vêm ambos
com o telefone e só `key.addressingMode = 'lid'` indica o caso; o @lid real fica no Postgres da
Evolution. `resolveLid` (webhook) usa o @lid se vier no evento, senão `wa_lid_map` (telefone → @lid),
senão `POST /chat/findMessages/{instância}` com `where.key.id` (até 3 tentativas) e grava no mapa.
Resposta (`replyTo`) e chave das reações (`msgKey.remoteJid`) usam esse @lid; o `hiring-scheduler`
consulta o mapa (`destFor`, telefone com e sem o 9) inclusive no 1º convite. Mapa semeado com o dono.
**Agendamento (`hiring-scheduler`), mesmo dia:** o webhook repassa
`reply_to`; quando o candidato responde, o `@lid` fica em `hiring_scheduling_sessions.jid` e `toCand`
passa a enviar para ele (o 1º convite continua pelo telefone, único dado que temos); o entrevistador
que responde tem o `@lid` guardado em `hiring_job_scheduling.interviewers[].jid`, usado por
`toInterviewers`, e a resposta a ele vai para o `@lid`. O cron/Telegram não usa WhatsApp. O status "PENDING" do Postgres da
Evolution não reflete entrega (fica PENDING até nas mensagens que chegam).

### Currículo salvo mesmo sem IA (2026-09-14)

Teste real pelo link: a conta da Anthropic ficou **sem créditos** ("credit balance is too low") e o
`hiring-cv-scan › intake` devolvia 402 → o candidato recebia "Tive um probleminha" e o currículo se
perdia. Agora, com a IA indisponível (402/429/5xx), o intake **salva assim mesmo**: arquivo no bucket,
nome = nome do arquivo, `ai_processed = false` ("Leitura simples"), sem análise da vaga (a candidatura
fica com `error = 'IA indisponível: …'`), e devolve `pending_ai` + `ai_error`. O `canal-publico`
responde "Recebi seu currículo" normalmente e o aviso do dono no Telegram diz que foi salvo sem IA.
Sem créditos, param também o brain (Telegram), a leitura de notinhas e a análise de vagas.

### Confirmação do currículo do WhatsApp também no Telegram (2026-09-14)

Currículo salvo pela rota do WhatsApp do dono (`cvFromWhatsApp`) agora manda cópia da confirmação no
Telegram ("📲 ✅ Currículo salvo…"). Caso real: 13:08, o PDF da Eduarda foi salvo e a confirmação saiu
pela Evolution, mas o dono não viu nada no WhatsApp. **Publicado isolado** (último commit + só esse
trecho, via `--workdir` numa pasta temporária) porque o arquivo local tinha `hiringReceipts` (recibos
do agendamento) ainda não commitado de outra sessão; o arquivo local tem as duas mudanças.

### Último anexo por conversa + inscrever na vaga (2026-09-14)

Caso real: o dono mandou um PDF de currículo pelo WhatsApp sem aviso → repassado ao Telegram → o
brain perguntou a vaga antes de salvar → no "só salva" (outra mensagem) o anexo já não existia.
- O brain guarda o anexo de cada mensagem no bucket privado **`assistente-anexos`**
  (`<chat>/ultimo`, sobrescrito; só service role). `salvar_curriculo` usa o anexo da mensagem ou,
  sem ele, o último da conversa com até 1 h (`lastAttachment`).
- Regra na ferramenta: currículo sem instrução é **salvo na hora sem vaga**; depois o assistente
  oferece `inscrever_na_vaga` (nova: `{vaga, candidato?, empresa?}` → `hiring_applications` +
  `hiring-cv-scan › match`; sem candidato = o último salvo).

### Queda do WhatsApp em 2026-09-14 + Word no canal público

- 15:21 UTC: candidata entrou pelo link, a boas-vindas foi aceita pela Evolution e gravada em
  `bot_messages`, mas a sessão caiu 1 s depois (`stream:error 401 conflict device_removed`,
  instância `state: close`). Só a reação chegou. **Parear de novo** (Assistente › Configurações ›
  QR). Diagnóstico: `docker logs evolution | grep device_removed` e
  `docker exec evolution node -e "fetch('http://localhost:8080/instance/connectionState/assistente',{headers:{apikey:process.env.AUTHENTICATION_API_KEY}}).then(r=>r.text()).then(console.log)"`.
- `canal-publico`: se o envio pela Evolution falhar, avisa o dono no Telegram (1× a cada 30 min,
  `asst_settings.wa_public_down_alert_at`). Primeira resposta padrão = "Olá! Por favor, nos envie seu
  currículo (pode ser em PDF, imagens ou em word)". Aceita **Word .docx**: o webhook baixa, o
  canal extrai o texto (`fflate`, `word/document.xml`) → intake como texto, e o .docx original vai
  para o bucket `curriculos`. O `.doc` antigo continua sem suporte (pede PDF/foto).

### Chat no ERPOS (2026-09-15, Fase 1)

Conversa com o assistente **dentro do ERPOS**, somando ao Telegram (não substitui).
- **Mesma conversa:** a edge `assistente-app` usa o histórico do chat do Telegram do dono
  (`asst_messages.chat_id = 'tg:<telegram_allowed_ids[0]>'`), gravando com `channel = 'app'`.
  Começa num canal e continua no outro. Sem migration (`channel` é texto livre).
- **Front:** `src/components/feature/AssistenteChat.tsx` — botão flutuante em todas as telas do
  modo gestão (`AppLayout`, só o e-mail do dono; escondido em `/assistente`) e embutido na aba
  Assistente › Conversa. Texto, foto (reduzida a 1600 px no aparelho), PDF e áudio (MediaRecorder →
  Whisper na VPS). Enquete do brain vira botões; a cada 8 s puxa o que chegou por outro canal.
- **Contexto de tela:** cada mensagem vai com `[Pelo ERPOS · tela: <título> — <rota> · loja aberta: X]`,
  para "paga essa", "esse candidato" funcionarem. O balão esconde esse prefixo.
- **Pagamento:** brain aceita `channel 'app'` em `preparar_pagamento` e nas ações (`CHAT_CHANNELS`).
  O cartão aparece acima da caixa de texto (Pagar / Ver status / Cancelar); Pagar abre o PIN — **o
  mesmo do Telegram** (`asst_settings.pay_pin`, hash com o id do chat do Telegram, 3 erros = 15 min),
  conferido na edge e nunca enviado ao modelo nem ao histórico. `inter-bank › execute_payment` faz o
  claim atômico. Pago na hora → `send_receipt` + `baixa_conciliada`; senão o `pay_watch` segue
  (e manda os status no Telegram como mensagem nova, porque o cartão não existe lá).
- Próximos: push dos avisos no app (Web Push já existe em `send-push`), tópicos por assunto no chat,
  app Android com Capacitor (compartilhar do celular, biometria, notificação com botões).

## Pendente (ordem)

1. Validar no uso real o Telegram: conversa, áudio, foto e clique em botão.
2. Pagar boleto/Pix pelo Inter. **Código no ar desde 2026-09-12**: tools `preparar_pagamento` e `status_pagamento`, botões Pagar e Cancelar no Telegram, PIN criado por `/pin` e interceptado sem passar pelo modelo, e aprovação final no app do Inter. Detalhes em `AI_SYSTEM_MAP.md`. **Bloqueio:** a integração do Inter (client_id final 078f) ainda só tem `extrato.read`. Os escopos `pagamento-boleto.*` e `pagamento-pix.*` voltam "No registered scope value". Depois de liberar, rodar `inter-bank › check_payment_scopes` e fazer o 1º boleto pequeno real.
3. Google Agenda + Gmail (OAuth do dono, tokens em `asst_settings`).
4. Nome do assistente (ainda não escolhido; bot aparece como "John Snow").
