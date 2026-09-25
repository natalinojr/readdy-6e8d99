# Tarefas × OneDrive/SharePoint — Plano da Fase 1

> Escrito em 2026-09-24. Contexto: escritório de engenharia do dono (3 pessoas), Microsoft 365 Business
> (1 TB por pessoa + biblioteca do SharePoint da equipe). Integração pela **Microsoft Graph API**.
>
> **Andamento:** passo 2 (conexão) FEITO em 2026-09-26 — tabela `ms_graph_connections`, Edge `ms-graph`
> (config/exchange/status/disconnect/browse) e tela `ConexaoMicrosoft.tsx`. Falta o passo 0 do dono
> (registrar o app no Entra + secrets) para testar com a conta real.

## Objetivo da Fase 1

1. Conectar **uma vez** a conta Microsoft do escritório ao ERPOS.
2. Ligar uma **pasta raiz** das Tarefas a uma pasta do SharePoint. Tudo o que nasce dentro dela (pastas criadas à mão ou por **modelo de pastas**) cria a pasta espelho na nuvem.
3. Na tarefa: **anexar arquivo da nuvem** (navegando na pasta do projeto) e **enviar arquivo** direto para a pasta, inclusive arquivo grande (RVT/DWG/PDF).
4. **Aviso de arquivo alterado**: quando alguém salva um arquivo na pasta do projeto, o ERPOS registra; se o arquivo está anexado a uma tarefa, entra comentário + notificação para os responsáveis.

**Fora da Fase 1** (Fase 2+): link de compartilhamento com validade/senha para cliente, conversão para PDF, histórico de versões na tarefa, Excel, calendário do Outlook, Teams, visualizador Autodesk.

## Como o módulo está hoje (fatos do código)

- Tarefas é **por usuário**, sem loja (`20260814000000_tasks_folders_and_true_user_scope.sql`); acesso ao módulo por `user_module_access` / `fn_user_tem_tarefas`. Pastas = `task_lists` com `parent_list_id`; compartilhamento = `task_list_shares`.
- Escrita só pela Edge **`task-write`** (service role; `authenticated` não grava). Autorização por dono/compartilhamento: `assertListOwner`, `assertListEdit`, `assertTaskAccess`.
- Anexos: bucket privado `task-attachments` (10 MB), tabela `task_attachments` (`file_path` obrigatório, sem URL externa). Upload multipart no `task-write`; abrir = `sign_attachment`. UI em `TaskDrawer.tsx` (seção Anexos) + `useTarefas.ts` (`fetchAnexos/enviarAnexo/abrirAnexo`).
- Modelos de pastas: `supabase/functions/_shared/modelo-estrutura.ts` + `task-write/modelos.ts` (aplicar modelo cria a árvore de `task_lists`).
- Padrão OAuth copiado: **`meta-connect`** + popup tratado no `main.tsx` (mensagem `meta_oauth`).
- Padrão de webhook público a copiar: **`whatsapp-cloud`** (handshake + validação + responde na hora e processa em `EdgeRuntime.waitUntil`).

## Decisões de desenho

| Tema | Decisão | Por quê |
|---|---|---|
| Tipo de login | **Delegado** (a conta de quem conecta), escopos `offline_access openid profile User.Read Files.ReadWrite.All Sites.ReadWrite.All` | Simples. `Sites.Selected` (só a biblioteca escolhida) fica como endurecimento futuro. |
| Registro do app | Microsoft Entra, **multi-organização** (`organizations`) | Permite vender o módulo depois sem refazer. |
| Dono da conexão | **Um usuário ERPOS** (quem conectou). Pastas compartilhadas usam a conexão do **dono da pasta raiz** | Tarefas é por usuário; os 3 do escritório não precisam conectar cada um. |
| Tokens | Tabela só do service role; `refresh_token` nunca vai ao front | Igual ao Meta. |
| Seletor de arquivos | **Navegador próprio** (lista a pasta do projeto via Edge), não o File Picker da Microsoft | O picker oficial exige token Graph no navegador (MSAL no front). O nosso fica preso à pasta do projeto. |
| Upload | Edge cria **upload session** do Graph e devolve a `uploadUrl`; o **navegador envia os pedaços direto para a Microsoft** | Arquivo de 300 MB não passa pela Edge; a `uploadUrl` já vem autorizada e expira sozinha. |
| Abrir arquivo | Abre o `webUrl` do SharePoint (quem tem licença do escritório abre) | Link público para cliente é Fase 2. |
| Excluir | Apagar pasta/anexo no ERPOS **nunca apaga** na nuvem; só desfaz o vínculo | Evitar perda de projeto. |
| Renomear pasta no ERPOS | Renomeia a pasta espelho (se ainda vinculada) | Mantém os nomes iguais. |
| Conflito de nome | `@microsoft.graph.conflictBehavior=rename` ao criar | Nunca sobrescreve. |
| Aviso de mudança | Assinatura (subscription) no **root do drive** + **delta query** | No OneDrive Business/SharePoint a assinatura só é aceita na raiz; a notificação não traz detalhes, então lê-se o delta e filtra pelas pastas vinculadas. |
| Anti-spam | Mesmo arquivo alterado várias vezes → 1 aviso por arquivo a cada 30 min | Autosave do Office gera várias versões. |

## Banco

Já aplicado: `20260926200000_ms_graph_connections.sql` (`ms_graph_connections`, 1 por usuário, sem acesso para `authenticated`).

A fazer (próximas etapas):

```sql
-- estado do drive para avisos
ms_graph_drives (
  drive_id text pk, connection_user_id uuid references ms_graph_connections,
  delta_link text, subscription_id text, subscription_expires_at timestamptz,
  client_state text  -- segredo aleatório conferido em cada notificação
)
-- pasta do ERPOS ↔ pasta na nuvem
task_list_cloud (
  list_id uuid pk references task_lists on delete cascade,
  drive_id text, item_id text, web_url text, path text,
  is_root boolean,  -- a pasta raiz que foi ligada à mão
  created_at timestamptz
)
-- anexos passam a aceitar nuvem
alter table task_attachments
  add column source text not null default 'storage' check (source in ('storage','onedrive')),
  add column drive_id text, add column drive_item_id text, add column web_url text,
  alter column file_path drop not null;
-- log de arquivos alterados (para o aviso e para o histórico da pasta)
task_cloud_events (id, list_id, drive_id, item_id, file_name, web_url,
  changed_by_name, changed_at, kind /* criado|alterado|removido */, notified_at)
```

RLS: `ms_graph_drives` sem acesso para `authenticated`; `task_list_cloud` e `task_cloud_events` com leitura pelas mesmas regras de `task_lists`. **GRANT para service_role** nas tabelas novas.

## Edge Functions

**`ms-graph`** (no ar): `config`, `exchange`, `status`, `disconnect`, `browse` (`{}` → Meu OneDrive + sites; `{site_id}` → bibliotecas; `{drive_id, item_id?}` → conteúdo). Helper `_shared/ms-graph.ts` com `graphFetch()` e renovação automática do token.

**`task-write`** (ações novas; reaproveita as checagens de acesso):
- `link_list_cloud` `{list_id, drive_id, item_id}` — só dono da pasta raiz.
- `unlink_list_cloud`.
- `create_list` / aplicar modelo / `update_list` (rename): se a pasta-mãe está vinculada, cria/renomeia a espelho. **Falha na Microsoft não bloqueia a criação no ERPOS**: grava a pasta, marca pendente e mostra "não criada na nuvem — tentar de novo".
- `attach_cloud_item` `{task_id, drive_id, item_id}` → linha em `task_attachments` com `source='onedrive'`.
- `start_cloud_upload` `{task_id, file_name, size}` → upload session na pasta da tarefa, devolve `uploadUrl`; `finish_cloud_upload` `{task_id, item_id}` grava o anexo.
- `sign_attachment` passa a devolver `web_url` quando `source='onedrive'`.

**`ms-graph-webhook`** (nova, pública):
- Handshake: responde `validationToken` em texto puro.
- Notificação: confere `clientState`; responde 202 na hora; em `waitUntil` lê o **delta**, filtra itens sob alguma `task_list_cloud`, grava `task_cloud_events`, e se o item é anexo de alguma tarefa → `task_comments` + `task_notifications` para responsáveis/observadores, respeitando o anti-spam.

**Cron diário**: renovar assinaturas que vencem em < 3 dias (a de drive dura no máximo ~30 dias) e rodar um delta de segurança. Isso também mantém o refresh token vivo (expira após ~90 dias sem uso).

**Assistente** (regra do projeto): liberar as ações novas do `task-write` e o `browse` do `ms-graph` no `EDGE_ALLOW`.

## Telas

1. **Conexão** (FEITA): menu das Tarefas → "OneDrive / SharePoint" → "Conectar Microsoft 365" (popup) → conta conectada, navegador de pastas, "Desconectar".
2. **Pasta** (`ArvorePastas` / menu da pasta): "Ligar a uma pasta da nuvem" → escolher site/biblioteca → navegar → confirmar. Ícone de nuvem nas pastas vinculadas; "Abrir no SharePoint".
3. **Tarefa** (`TaskDrawer`, seção Anexos): botões **"Da nuvem"** e **"Enviar"** (pasta vinculada → vai para a nuvem com barra de progresso; senão, Storage como hoje).
4. **Atividade de arquivos** da pasta: lista dos `task_cloud_events` recentes.

## Ordem de execução

| # | Entrega | Estado |
|---|---|---|
| 0 | Dono: contratar M365 Business, criar bibliotecas "Projetos" e "ERPOS-Teste", **registrar o app no Entra** + consentimento de administrador → secrets `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | pendente (dono) |
| 1 | Migration da conexão + GRANTs | feito 09-26 |
| 2 | Edge `ms-graph` + tela de conexão | feito 09-26 (sem teste com conta real) |
| 3 | Vincular pasta + espelho em create_list/modelo/rename | a fazer |
| 4 | Anexar da nuvem + upload por sessão no TaskDrawer | a fazer |
| 5 | Webhook + delta + cron + comentário/notificação (revisão Opus: endpoint público) | a fazer |
| 6 | EDGE_ALLOW do assistente + docs | a fazer |

## Registro do app no Microsoft Entra (passo 0)

1. https://entra.microsoft.com com a conta **administradora** do Microsoft 365 do escritório.
2. Aplicativos → **Registros de aplicativo** → Novo registro.
   - Nome: `ERPOS Tarefas`.
   - Tipos de conta: **Contas em qualquer diretório organizacional (multilocatário)**.
   - URI de redirecionamento: plataforma **Web**, `https://erpos.vercel.app/tarefas`.
3. Em **Autenticação**, adicionar também `http://localhost:5571/tarefas` (testes).
4. Em **Certificados e segredos** → Novo segredo do cliente, validade 24 meses. Copiar o **Valor** na hora (só aparece uma vez) e anotar a data de vencimento.
5. Em **Permissões de API** → Microsoft Graph → Permissões delegadas: `offline_access`, `openid`, `profile`, `User.Read`, `Files.ReadWrite.All`, `Sites.ReadWrite.All` → **Conceder consentimento do administrador**.
6. Copiar o **ID do aplicativo (cliente)** da Visão geral.
7. Gravar no Supabase: `npx supabase secrets set MS_CLIENT_ID=<id> MS_CLIENT_SECRET=<valor> --project-ref mdghhjemzdmeuqpzuyzx` (o dono roda; o segredo não passa pelo chat).

## Critérios de aceite

- Conectar a conta e ver o nome/e-mail da conta; desconectar remove o token.
- Criar pasta dentro da raiz vinculada → pasta aparece no SharePoint em até 5 s. Aplicar um modelo de 10 pastas → as 10 aparecem, com a mesma hierarquia.
- Anexar arquivo da nuvem numa tarefa e abrir → abre no SharePoint.
- Enviar arquivo de **200 MB** pela tarefa → chega na pasta certa e vira anexo.
- Salvar nova versão de um arquivo anexado → comentário na tarefa + notificação em até ~2 min; salvar 5 vezes seguidas gera **1** aviso.
- Apagar tarefa/pasta no ERPOS → nada é apagado na nuvem.
- Microsoft fora do ar ao criar pasta → pasta criada no ERPOS com aviso "tentar de novo".
- Usuário sem acesso à pasta não consegue `browse`, anexar nem enviar para ela.

## Riscos e pegadinhas

- **Client secret do Entra expira** (máx. 24 meses): anotar a data e criar lembrete (tarefa recorrente).
- Refresh token morre após ~90 dias sem uso → o cron diário o mantém vivo; se morrer, a tela mostra "reconectar".
- Admin do M365 pode revogar o consentimento → mesma tela de "reconectar".
- Arquivos sincronizados pelo OneDrive no PC geram muitos eventos; o anti-spam e o filtro por pastas vinculadas seguram isso.
- Testar numa biblioteca **"ERPOS-Teste"** antes de ligar em "Projetos".
