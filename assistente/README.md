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
- Modelo `claude-opus-5`, `effort: medium`. Custo medido: ~2k tokens de entrada
  + ~5k de cache + ~400 de saída por mensagem ≈ US$ 0,02–0,03. Se ficar caro,
  trocar para `claude-sonnet-5` (mesma API).

## Pendente (ordem)

1. **VPS Hetzner (CX22) + Evolution API** — dono precisa criar conta Hetzner e
   arranjar um chip/número para o assistente. Depois: Docker + Evolution +
   webhook apontando para `assistente-webhook`.
2. `assistente-webhook`: recebe evento da Evolution, checa `allowed_chat_ids`,
   baixa mídia, transcreve áudio (Whisper), chama o brain, responde pela API da
   Evolution. Mensagens encaminhadas viram contexto ("resume isso e cria tarefa").
3. Envio de lembretes (`asst_reminders.sent_at is null and due_at <= now()`) —
   cron no Supabase (pg_cron + pg_net) chamando uma edge que manda pela Evolution.
4. Resumo da manhã (tarefas do dia, agenda, contas vencendo) — mesmo mecanismo.
5. Google Agenda + Gmail (OAuth do dono, tokens em `asst_settings`).
6. Nome do assistente (ainda não escolhido).
