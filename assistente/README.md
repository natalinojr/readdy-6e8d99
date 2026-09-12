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

## Pendente (ordem)

1. **Número do assistente**: chip → parear com QR (`GET /instance/connect/assistente`
   ou pelo `/manager`). Cadastrar o número do dono em `allowed_chat_ids` **e**
   `owner_chat_id` (JID `55DDDNUMERO@s.whatsapp.net`).
2. Ferramenta para lançar conta a pagar direto da foto do boleto (hoje o
   assistente só sugere criar tarefa).
3. Google Agenda + Gmail (OAuth do dono, tokens em `asst_settings`).
4. Nome do assistente (ainda não escolhido).
