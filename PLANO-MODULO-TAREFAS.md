# Plano — Módulo de Gestão de Tarefas (ERPOS V2)

Criado em: 2026-08-11. Status: **MÓDULO COMPLETO — Fases 1 a 4 implementadas em 2026-08-11** (backend no ar; front pendente de push).

> **Fase 1** — migrações `create_tasks_module` e `create_tasks_read_rpcs` aplicadas; Edge Function `task-write` v1 ativa; rota `/tarefas`, card em `/modulos` (id `tarefas`, perfis admin/gerente); view Lista + TaskDrawer.
>
> **Fase 2** — campos personalizados completos (12 tipos, `CamposCustomManager` + `CampoInput`/`CampoBadge`, flag `show_on_card`, campos globais ou por lista); view Kanban com drag & drop nativo HTML5 (sem dependência nova) que move entre colunas e reordena via `sort_order` fracionário; agrupamento flexível por status/prioridade/responsável/dropdown custom nas views Lista e Kanban.
>
> **Fase 3** — view Calendário (mês/semana, arrastar para remarcar, clique no dia cria tarefa, painel lateral "Sem data"); Minhas Tarefas cross-listas agrupada por vencimento (atrasadas/hoje/7 dias/mais tarde/sem data); seletor de recorrência no drawer; barra de filtros (busca, prioridade, responsável, etiquetas, ocultar concluídas); subtarefas na UI (aninhadas na Lista, criação no drawer).
>
> **Fase 4** — notificações persistidas por usuário (`task_notifications` + canal `task-notify:<user_id>`), disparadas ao atribuir responsável, mencionar com `@` num comentário ou comentar na tarefa de alguém; alertas de atrasadas/vence-hoje derivados no cliente (sem cron); caixa de notificações no cabeçalho; views salvas (`task_views`, pessoais ou compartilhadas com a equipe); anexos em bucket privado com URL assinada; templates de checklist aplicáveis em 1 clique.
>
> **Limitação conhecida:** o drag & drop usa a API nativa do HTML5, que não funciona em toque. Em tablet/celular, use o dropdown de status no drawer (Kanban) e o campo de data (Calendário) — ambos fazem a mesma coisa.
>
> **Desvio consciente do plano original:** o plano dizia "integrar ao `NotificacoesProvider`". Esse contexto é estado em memória endereçado por *perfil*, então notificar uma pessoa específica por ele não funcionaria (o aviso apareceria só para quem fez a ação). As notificações do módulo são persistidas em tabela própria e entregues por canal por usuário. Ver a entrada de 2026-08-11 em `AI_SYSTEM_MAP.md` → Histórico de soluções.

## Arquivos do módulo (implementado)

```
src/pages/tarefas/
  page.tsx                      -- shell: sidebar de listas, seletor de view, filtros
  hooks/useTarefas.ts           -- dados + write() + realtime tasks-ping + reset na troca de loja
  lib/agrupamento.ts            -- agrupar/filtrar/sort_order fracionário/payload de movimentação
  components/
    ViewLista.tsx  ViewKanban.tsx  ViewCalendario.tsx  MinhasTarefas.tsx
    TaskCard.tsx   TaskDrawer.tsx  FiltrosBar.tsx  CamposCustomManager.tsx
    NotificacoesInbox.tsx  ViewsSalvas.tsx  TemplatesManager.tsx  ComentarioInput.tsx
    campos/CampoInput.tsx (editor por tipo)  campos/CampoBadge.tsx (leitura)
```

Upload de anexo: `uploadTaskAttachment()` em `src/lib/supabase.ts` (multipart → Edge Function → service_role).

Objetivo: módulo de gestão de tarefas multi-visão (Lista, Kanban, Calendário) com classificação flexível via **campos personalizados** estilo ClickUp, integrado à arquitetura existente (multi-tenant, Supabase, Edge Functions).

---

## 1. Benchmark — o que pegamos de cada ferramenta

| Ferramenta | Ideia adotada |
|---|---|
| **ClickUp** | Custom fields por lista (texto, número, moeda, dropdown, labels, data, checkbox, pessoa, rating); hierarquia Espaço → Lista → Tarefa → Subtarefa; múltiplas views sobre os mesmos dados |
| **Notion** | Agrupamento do Kanban por *qualquer* campo dropdown/status (não só status); filtros e ordenação salvos por view |
| **Linear** | Status com **categorias semânticas** (backlog / a fazer / em andamento / concluído / cancelado) — permite métricas e automações mesmo com nomes customizados; prioridade padronizada (urgente/alta/média/baixa/sem) |
| **Asana** | Uma tarefa com responsável + colaboradores (watchers); "Minhas Tarefas" como visão pessoal cross-listas |
| **Trello** | Kanban com drag & drop simples, capas/cores nos cards, checklist dentro do card |
| **Todoist** | Recorrência de tarefas (ex.: limpeza semanal, pagamento mensal) e datas em linguagem simples |

Contexto de uso real do negócio (restaurantes): checklists de abertura/fechamento, manutenção de equipamentos, tarefas administrativas (contas, compras), campanhas de marketing, onboarding de funcionários. As tarefas recorrentes e o calendário são importantes nesse cenário.

## 2. Conceitos e hierarquia

- **Lista** (`task_lists`): agrupador principal (equivale a projeto/lista do ClickUp). Tem cor, ícone, ordem, arquivamento. Opcional: **pastas/grupos de listas** ficam para fase futura (evitar complexidade).
- **Tarefa** (`tasks`): pertence a uma lista. Campos nativos: título, descrição (rich text simples/markdown), status, prioridade, responsável, colaboradores, data de início, data de vencimento (com hora opcional), tags, ordem manual, tarefa-pai (subtarefas 1 nível), recorrência, arquivamento.
- **Status por lista** (`task_statuses`): cada lista define seus próprios status (nome + cor + ordem), mas cada status tem uma `category` fixa: `backlog | todo | in_progress | done | cancelled` (ideia do Linear — nomes livres, semântica estável).
- **Campos personalizados** (`task_custom_fields` + valores em JSONB): definidos por lista (ou globais do tenant), tipos:
  - `text`, `textarea`, `number`, `currency`, `date`, `checkbox`, `dropdown` (opções com cor), `labels` (multi-select), `user` (pessoa), `rating` (1–5), `url`, `phone`.
- **Checklist** dentro da tarefa (`task_checklist_items`).
- **Comentários** (`task_comments`) com menções (@usuário) — menção gera notificação via `NotificacoesProvider`.
- **Atividade** (`task_activity`): log de mudanças (status, responsável, datas) para histórico no painel da tarefa.

## 3. Views (mesmos dados, três projeções)

Todas as views compartilham a mesma barra: seletor de lista(s), busca, filtros (status, responsável, prioridade, tags, campos custom), agrupamento e ordenação. Preferências de view salvas por usuário em `user_preferences` (ou tabela `task_views` se quisermos views nomeadas compartilhadas — fase 2).

1. **Lista**: tabela agrupada por status (ou por qualquer campo dropdown/pessoa/prioridade). Colunas nativas + colunas de campos custom que o usuário escolhe exibir. Edição inline (status, responsável, data, prioridade). Subtarefas expansíveis.
2. **Kanban**: colunas = status por padrão; agrupável por qualquer dropdown/prioridade/responsável (ideia Notion). Drag & drop muda o valor do campo agrupado; drag vertical reordena (`sort_order`). Card mostra título, tags, responsável (avatar), vencimento, contagem de checklist, campos custom marcados como "mostrar no card".
3. **Calendário**: mês/semana. Tarefa aparece pela data de vencimento (ou faixa início→fim). Drag para remarcar; clique em dia vazio cria tarefa com a data. Tarefas sem data ficam num painel lateral "Sem data" arrastável para o calendário.
4. **Minhas Tarefas** (bônus Asana, barato de fazer): filtro fixo `responsável = eu` cross-listas, agrupado por vencimento (atrasadas / hoje / semana / depois).

Painel de detalhe da tarefa: drawer lateral (padrão já usado no sistema) com descrição, campos custom, checklist, comentários, atividade, subtarefas.

## 4. Modelo de dados (Supabase)

Todas as tabelas com `tenant_id uuid not null` + RLS por tenant + **GRANT ao `service_role`** (pegadinha conhecida: tabela nova sem grant → Edge Function dá 42501/500).

```
task_lists            (id, tenant_id, name, color, icon, sort_order, is_archived, created_by, created_at)
task_statuses         (id, tenant_id, list_id, name, color, category, sort_order)
                      -- category: backlog|todo|in_progress|done|cancelled
tasks                 (id, tenant_id, list_id, parent_task_id, title, description,
                       status_id, priority smallint,           -- 0 sem, 1 baixa, 2 média, 3 alta, 4 urgente
                       assignee_id, start_date, due_date, due_has_time bool,
                       sort_order numeric,                     -- ordenação fracionária p/ drag&drop barato
                       recurrence jsonb,                       -- {freq, interval, byweekday...} estilo RRULE simplificado
                       completed_at, is_archived, created_by, created_at, updated_at)
task_watchers         (task_id, user_id)                        -- colaboradores/observadores
task_tags             (id, tenant_id, name, color)              -- tags globais do tenant
task_tag_links        (task_id, tag_id)
task_custom_fields    (id, tenant_id, list_id nullable,         -- null = campo global do tenant
                       name, field_type, options jsonb,         -- opções de dropdown/labels: [{id,label,color}]
                       show_on_card bool, sort_order, is_archived)
task_field_values     (task_id, field_id, value jsonb, PK(task_id, field_id))
task_checklist_items  (id, task_id, tenant_id, title, is_done, sort_order)
task_comments         (id, task_id, tenant_id, user_id, body, mentions uuid[], created_at)
task_activity         (id, task_id, tenant_id, user_id, action, payload jsonb, created_at)
```

Decisões de modelagem:
- **Valores custom em JSONB** (`value`): um único formato por linha, validado pela Edge Function conforme `field_type`. Evita 12 colunas tipadas e simplifica novos tipos. Índice GIN só se relatórios exigirem.
- **`sort_order numeric` fracionário** (média entre vizinhos) para drag & drop sem reescrever a lista inteira; job/normalização eventual se precisar.
- **Recorrência materializada na conclusão**: ao concluir tarefa recorrente, a Edge Function cria a próxima ocorrência (modelo Todoist). Sem cron: zero infraestrutura extra e funciona offline do ponto de vista do banco.
- **Subtarefa = 1 nível** (parent_task_id) no MVP. Hierarquia profunda estilo ClickUp fica fora.

RLS: padrão por `tenant_id`, mas **atenção à pegadinha do multi-loja** (`auth_tenant_id()` retorna a última membership — admins multi-loja quebram leitura/escrita direta). Seguir o padrão das telas recentes: leituras via RPC `security definer` que recebe/valida o tenant, escritas via Edge Function `task-write` com service_role validando membership — como já fazem `stock-write`/`financial-write`.

## 5. Backend (padrões do projeto)

- **Edge Function `task-write`** (`supabase/functions/task-write/index.ts`): todas as escritas — CRUD de listas, status, tarefas, campos, valores, checklist, comentários. Valida membership no tenant, valida `value` vs `field_type`, escreve `task_activity`, cria próxima ocorrência de recorrentes, dispara notificação em menção/atribuição.
- **Leituras**: RPC `fn_get_task_lists`, `fn_get_tasks(list_ids, filtros)` retornando tarefas + valores custom agregados em JSON (evita N+1), `fn_get_task_detail(task_id)`.
- **Realtime**: canal **broadcast** disparado por trigger (padrão `orders-ping` já validado no projeto — lembrar que `postgres_changes` de tabela fora da publicação fica mudo). Canal `tasks-ping:{tenant_id}` com payload leve (task_id, list_id, action) → front refaz fetch da lista afetada.
- **Migração**: uma migração `create_tasks_module.sql` com tabelas + RLS + grants + triggers + seeds de status padrão ao criar lista ("A fazer", "Em andamento", "Concluído").

## 6. Frontend

- **Rota**: `/tarefas` → `src/pages/tarefas/page.tsx`, dentro do layout autenticado. Card no `/modulos` (tag `Admin`), permissão nova `tarefas` no `PermissoesContext`.
- **Estrutura**:
  ```
  src/pages/tarefas/
    page.tsx                    -- shell: header, seletor de view, filtros
    components/
      ViewLista.tsx
      ViewKanban.tsx
      ViewCalendario.tsx
      MinhasTarefas.tsx
      TaskDrawer.tsx            -- detalhe da tarefa (drawer lateral)
      TaskCard.tsx              -- card compartilhado Kanban/calendário
      FiltrosBar.tsx
      CamposCustomManager.tsx   -- CRUD de campos da lista
      StatusManager.tsx         -- CRUD de status da lista
      campos/                   -- render/editor de cada field_type
    hooks/
      useTasks.ts, useTaskLists.ts, useTaskDetail.ts, useTaskWrite.ts
  ```
- **Sem context global novo**: dados via hooks locais da página (não entra no `AppProviders`); menos risco de vazamento entre lojas. Ainda assim, resetar estado na troca de loja (pegadinha conhecida dos contexts).
- **Drag & drop**: avaliar `@dnd-kit/core` (leve, mantido). Verificar se já existe algo de DnD no bundle antes de adicionar dependência.
- **Calendário**: grid próprio em Tailwind (mês/semana) — evitar lib pesada; o sistema já tem padrões visuais de agenda em reservas.

## 7. Fases de implementação

**Fase 1 — Fundação + View Lista (MVP utilizável)**
Migração completa do banco; `task-write`; RPCs de leitura; rota `/tarefas` + permissão + card em módulos; CRUD de listas e status; view Lista com edição inline; drawer de detalhe (descrição, checklist, comentários); prioridade, responsável, datas, tags.

**Fase 2 — Kanban + campos personalizados**
Kanban com drag & drop (status + reordenar); manager de campos custom + editores de todos os tipos; campos na view Lista (colunas) e no card; agrupamento por campo dropdown/pessoa/prioridade nas duas views.

**Fase 3 — Calendário + recorrência + Minhas Tarefas**
View calendário mês/semana com drag para remarcar; painel "Sem data"; recorrência (criação da próxima ocorrência na conclusão); visão Minhas Tarefas; realtime `tasks-ping`.

**Fase 4 — Refinos** ✅
Subtarefas na UI; notificações de menção/atribuição/comentário persistidas + alertas de vencimento; views salvas (`task_views`); anexos via Storage privado; templates de checklist.

Cada fase termina com: `npm run type-check` (não aumentar a contagem de erros — baseline ~350), `npm run build`, teste manual local. Commit/push só quando o usuário pedir.

## 8. Riscos e pegadinhas mapeadas

1. **RLS multi-loja**: nunca depender de `auth_tenant_id()` para admins multi-loja; RPCs recebem tenant validado, escritas via Edge Function.
2. **Grants service_role** nas tabelas novas na própria migração.
3. **Realtime**: usar broadcast por trigger, não `postgres_changes` (tabelas novas não estão na publicação).
4. **Troca de loja**: hooks devem limpar/refazer fetch ao trocar tenant.
5. **Validação de custom fields**: centralizada na `task-write` (JSONB aceita qualquer coisa — o guarda é a função).
