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

## Pendente (ordem)

1. Validar no uso real o Telegram: conversa, áudio, foto e clique em botão.
2. Pagar boleto/Pix pelo Inter (escopos de pagamento na integração Inter + confirmação por botão).
3. Google Agenda + Gmail (OAuth do dono, tokens em `asst_settings`).
4. Nome do assistente (ainda não escolhido; bot aparece como "John Snow").
