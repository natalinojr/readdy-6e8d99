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
mensagens / ~40k caracteres). O cron apaga mensagens de grupo com mais de 90 dias.
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

## Pendente (ordem)

1. **Número do assistente**: chip → parear com QR (`GET /instance/connect/assistente`
   ou pelo `/manager`). Cadastrar o número do dono em `allowed_chat_ids` **e**
   `owner_chat_id` (JID `55DDDNUMERO@s.whatsapp.net`).
2. Ferramenta para lançar conta a pagar direto da foto do boleto (hoje o
   assistente só sugere criar tarefa).
3. Google Agenda + Gmail (OAuth do dono, tokens em `asst_settings`).
4. Nome do assistente (ainda não escolhido).
