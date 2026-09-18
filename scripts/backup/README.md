# Backup diário do banco (ERPOS)

Rotina local (sem Docker, sem `pg_dump`/`psql`) que copia todo dia o schema
`public` do banco Supabase de produção para o disco do dono. Referência
completa: `specs/2026-09-backup-diario/spec.md`.

## O que faz

1. `scripts/backup-diario.mjs` — lista as tabelas de `public` (via catálogo,
   automático — tabela nova entra sozinha), extrai cada uma **sequencialmente**
   (nunca em paralelo) e **paginada** (`ERPOS_BACKUP_PAGE_SIZE`, padrão 1000
   linhas) usando `npx supabase db query` (Management API — não precisa de
   Docker). Grava `tables/<tabela>.json.gz` e `manifest.json` (contagem +
   checksum sha256 por tabela) numa pasta temporária `AAAA-MM-DD.partial-HHmmss`.
   Só promove essa pasta para `AAAA-MM-DD` se **todas** as tabelas extraíram e a
   verificação pós-escrita bateu; senão a pasta parcial fica para diagnóstico e
   os backups anteriores não são mexidos. Se o backup do dia for promovido,
   roda a limpeza de retenção em seguida.
2. `scripts/cleanup-backups.mjs` — remove pastas de backup completas com mais
   de 30 dias (nunca a mais recente completa, mesmo que ela já esteja fora do
   prazo).
3. `scripts/verify-integrity.mjs` — relê um backup e confere se as contagens e
   checksums batem com o `manifest.json` (`--backup`); ou compara dois
   manifests (`--compare`); ou compara um backup contra o `count(*)` real do
   banco agora (`--live`).
4. `scripts/restore-from-backup.mjs` — gera o SQL de restauração a partir de um
   backup, respeitando a ordem de dependência por FK. **Por padrão só simula**
   (`dry-run`): grava os `.sql` em disco e mostra a ordem, não escreve em
   banco nenhum. Só escreve de verdade com `--apply` **e** recusa, sem
   exceção, escrever no projeto de produção (`mdghhjemzdmeuqpzuyzx`).
5. `scripts/backup/registrar-agendamento.ps1` — registra a tarefa diária
   (03:30, horário local de Brasília) no Agendador de Tarefas do Windows. **O
   agente nunca executa este script** — é o dono quem roda, na própria
   máquina, quando decidir ativar.

## Quais lojas entram (Admin Master)

O backup **não exporta tudo por padrão**. No **Admin Master → Lojas**, abrindo o
detalhe de cada loja há um interruptor **"Backup diário"** ("Inclui os dados
desta loja no backup automático de madrugada, salvo no PC do dono"). Só o
dono da plataforma vê e altera esse interruptor (mesma tela restrita a
`ADMIN_MASTER_EMAIL`).

- **Padrão: nenhuma loja ligada.** Se nenhuma loja tiver o backup ligado, o
  backup do dia **não exporta nada** — só grava no log
  `Nenhuma loja com backup ligado no Admin Master — nada feito` e sai com
  sucesso (não é um erro, é o estado inicial esperado).
- Com uma ou mais lojas ligadas: tabelas que têm coluna `tenant_id` (pedidos,
  itens de cardápio, financeiro, etc.) saem **só com os dados dessas lojas**.
  Tabelas sem `tenant_id` (usuários, a própria `tenants`, catálogos globais —
  pequenas e necessárias para restaurar) sempre saem **inteiras**.
- O `manifest.json` registra quais lojas (`id`/`name`) entraram naquela
  extração e, por tabela, se ela foi filtrada (`filtered: true/false`).
  `verify-integrity.mjs --live` usa esse mesmo filtro para comparar com o
  banco ao vivo — senão toda loja fora do backup apareceria como divergência.
- Ligar/desligar não afeta backups já feitos, só os próximos.

## Onde salva

Por padrão `D:\backups\erpos\`. Configurável com a variável de ambiente
`ERPOS_BACKUP_DIR` ou `--dir <pasta>` em qualquer um dos scripts. **Recusa**
uma pasta dentro do repositório do ERPOS (proteção contra commit acidental de
dados de produção). Dentro:

```
D:\backups\erpos\
  2026-09-17\
    manifest.json
    tables\
      orders.json.gz
      order_items.json.gz
      ...
  logs\
    backup.log
    cleanup.log
  backup.lock          (só existe enquanto um backup está rodando)
```

**Schema `auth` (usuários/senhas) NÃO está no backup.** `auth.users` tem hash
de senha — dado sensível sem necessidade clara de cópia local; recriar um
usuário é uma operação simples pelo Supabase Auth (convite/reset de senha). Só
o schema `public` (dados de negócio: pedidos, financeiro, estoque, fiscal,
etc.) é copiado.

## Como agendar (1 comando, roda o dono)

```powershell
cd "D:\dev\ERPOS V2 - claude"
powershell -ExecutionPolicy Bypass -File .\scripts\backup\registrar-agendamento.ps1
```

Isso cria a tarefa "ERPOS Backup Diario" no Agendador do Windows, rodando
`node scripts/backup-diario.mjs` (que já inclui verificação e limpeza) todo
dia às 03:30, mesmo se o PC estava desligado nesse horário (`StartWhenAvailable`).

Conferir: `Get-ScheduledTask -TaskName "ERPOS Backup Diario" | Get-ScheduledTaskInfo`
Remover: `Unregister-ScheduledTask -TaskName "ERPOS Backup Diario" -Confirm:$false`

## Como verificar um backup manualmente

```
node scripts/verify-integrity.mjs --backup "D:\backups\erpos\2026-09-17"
```

Compara com o banco ao vivo (confirma que o backup de ontem ainda bate com o
banco de hoje, dentro de uma tolerância de crescimento normal):

```
node scripts/verify-integrity.mjs --live "D:\backups\erpos\2026-09-17" --project-ref mdghhjemzdmeuqpzuyzx
```

## Como restaurar (só em projeto de teste — NUNCA em produção)

1. Crie um **projeto Supabase novo** (não é a loja "Testes PDV" — ela mora no
   mesmo projeto de produção) e rode as migrations do ERPOS nele
   (`npx supabase db push` apontando para esse projeto novo, ou aplicando os
   arquivos de `supabase/migrations/` na ordem).
2. Gere o SQL (dry-run, não escreve nada ainda):
   ```
   node scripts/restore-from-backup.mjs --backup "D:\backups\erpos\2026-09-17"
   ```
   Isso grava os arquivos `.sql` em `D:\backups\erpos\2026-09-17\restore-sql\`,
   numerados na ordem correta de dependência (tabelas "pai" antes das
   "filhas"), e mostra a ordem no console.
3. Confira a ordem e, se quiser, os arquivos gerados.
4. Aplique de verdade, apontando para o projeto de teste (nunca para
   `mdghhjemzdmeuqpzuyzx`):
   ```
   node scripts/restore-from-backup.mjs --backup "D:\backups\erpos\2026-09-17" ^
     --apply --project-ref SEU_PROJETO_DE_TESTE --confirm-project-ref SEU_PROJETO_DE_TESTE
   ```
   O script recusa (sem flag de escape) se `--project-ref` for o projeto de
   produção, e recusa também se o alvo já tiver dados (checa
   `select count(*) from public.tenants`) — restauração só serve para um
   projeto novo/vazio.
5. Depois de restaurar, recrie os usuários no projeto de teste pelo Supabase
   Auth (convite/reset de senha) — `auth.users` não faz parte do backup.

Para restaurar só algumas tabelas: `--tables tabela_a,tabela_b` (tabelas com
FK para uma tabela não restaurada vão falhar no `insert` — é esperado).

## O que NÃO está no backup

- Schema `auth` (usuários, hash de senha) — ver acima.
- Schemas internos da plataforma Supabase: `net`, `realtime`, `storage`,
  `cron`, `extensions` (lixo transiente/infra, regenerado pela própria
  plataforma, fora do escopo por já estarem fora do schema `public`).
- Armazenamento em nuvem (S3/Azure) — fica só no disco local do dono nesta
  entrega.
- Alertas automáticos (Telegram/WhatsApp) de sucesso/falha — só log local
  (`logs/backup.log`, `logs/cleanup.log`).

## Variáveis de ambiente (todas opcionais)

| Variável | Padrão | Uso |
|---|---|---|
| `ERPOS_BACKUP_DIR` | `D:\backups\erpos` | Pasta de destino (recusa dentro do repo) |
| `ERPOS_BACKUP_PROJECT_REF` | `mdghhjemzdmeuqpzuyzx` (produção) | Projeto a extrair |
| `ERPOS_BACKUP_RETENTION_DAYS` | `30` | Dias de retenção |
| `ERPOS_BACKUP_PAGE_SIZE` | `1000` | Linhas por página |
| `ERPOS_BACKUP_MIN_FREE_MB` | `1024` | Espaço mínimo livre para iniciar |
| `ERPOS_SUPABASE_CLI` | `npx supabase` | Comando da CLI (ex.: `supabase` se instalada globalmente) |

## Se o login da CLI expirar

O backup falha com erro classificado como autenticação (log:
`[auth] ...`). Reautentique com `npx supabase login` na máquina do dono e
rode `node scripts/backup-diario.mjs` de novo — não apaga nada dos dias
anteriores.
