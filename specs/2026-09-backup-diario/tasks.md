# Tasks: Backup diário automático do banco (plano Free sem backup)

> Spec: [spec.md](./spec.md) · Issue: N/A (sem issue tracker — slug `backup-diario`)

## Global Constraints

> Valem para **todas** as tasks. O Context pack de cada task referencia esta seção — não reescreve.

**Da spec (§2 Restrições / Non-goals — verbatim):**

- **`schema auth` fora do escopo do backup de dados** — `auth.users` contém hash de senha (28 usuários hoje); é dado sensível e sua cópia em texto/JSON local aumentaria a superfície de risco sem necessidade clara (recriação de usuário é uma operação simples via Supabase Auth). Documentar em `RESTORE.md` como recriar usuários (convite/reset de senha) em vez de restaurar hashes.
- **Sem Docker, sem `pg_dump`, sem `psql`** — Toda extração e toda restauração devem passar por `supabase db query` (Management API).
- **Nunca hardcode de token/senha** nos scripts — CLI já autenticada localmente faz a auth; scripts não devem imprimir nem logar credenciais.
- **Rodar fora do horário de operação das lojas** (madrugada, sugestão 03:30 Brasília) e de forma sequencial/paginada por tabela — não pode competir por conexões/carga com o banco em produção durante o expediente.
- **Nunca escrever em loja real durante teste** (`AGENTS.md`) — testes automatizados usam mocks da CLI; teste manual de restauração só contra a loja "Testes PDV" (`db3ca014-6c03-4c2e-97b9-9542cf825da2`) ou um projeto Supabase de teste, nunca sobre o banco de produção.
- **Gate de qualidade do projeto** (`AGENTS.md`): `node scripts/check.mjs --force` sem aumentar baseline; nunca rodar `--update-baseline` sem decisão do dono.
- **Registro do Task Scheduler é do dono** — o agente entrega o script PowerShell/`.mjs` de registro, mas não o executa (config persistente na máquina do dono).
- **Feature flag não se aplica** — não é comportamento do app ERPOS lido por `SystemSettingsContext`; é infraestrutura local.
- Non-goals: sem nuvem (S3/Azure), sem Edge Function de restore, sem tela/dashboard, **sem alerta Telegram/WhatsApp** (só log local), sem upgrade de plano.

**Da ratificação do orquestrador (2026-09-17, ver `executions.md`) — valem como restrição dura:**

- **Nunca escrever no banco de produção.** Backup é **só leitura** (todo SQL enviado pelo backup passa por `assertReadOnlySql`). Restauração: só documentada e testável **fora de produção**; o teste automatizado de restore **não** chama a CLI — usa fixtures/mocks (runner injetado).
- **Consequência de plano:** a loja "Testes PDV" mora **no mesmo projeto Supabase de produção** (`mdghhjemzdmeuqpzuyzx`); restaurar nela seria escrever em produção. Por isso `restore-from-backup.mjs` **recusa** `PRODUCTION_PROJECT_REF` como alvo de `--apply` (sem flag de escape), e o teste manual de restore é feito num **projeto Supabase separado** (ver T10). Desastre real = criar projeto novo, restaurar nele e apontar o app para ele (documentado em `docs/RESTORE.md`).
- **Não registrar a tarefa do Agendador do Windows automaticamente** — entregar script que o dono roda. Nenhum step de nenhuma task executa `register-scheduled-task.ps1`, `schtasks /create` ou `Register-ScheduledTask`.
- **Nenhuma credencial em arquivo do repo** (nem `.env` novo, nem token, nem connection string). O único identificador versionado é o project ref de produção (não é credencial).
- **Saída fora do repo**, default `D:\backups\erpos`, configurável por **`ERPOS_BACKUP_DIR`** (e `--dir <path>` na linha de comando). `resolveConfig` **recusa** diretório dentro do repositório.
- **Sequencial e paginado:** uma consulta por vez (nunca `Promise.all` sobre tabelas/páginas); página = `ERPOS_BACKUP_PAGE_SIZE` linhas (default 1000).
- **TDD = true só na lógica pura** (montagem das consultas/paginação, manifest/checksum, retenção, ordem de restauração por FK, guarda de alvo). Módulos com IO (runner da CLI, orquestração, entradas) têm teste com mocks mas **sem** exigência test-first (`tdd_integracao: fora`).
- **Fechamento:** working tree, **sem commit/push**, sem worktree, sem feature flag.

**Do `AGENTS.md` (restrições padrão aplicáveis):**

- Gate iterativo por task: `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` ≤ baseline (`scripts/baseline.json`, hoje 292); `npx vitest run` sem falha nova; `npx vite build` passa. Gate completo: `node scripts/check.mjs --force` (exit 0).
- Datas em horário de Brasília (pasta do dia = data `America/Sao_Paulo`, não UTC).
- Não reverter alterações existentes de Codex/dono; não editar `CLAUDE.md`.

**Decisões técnicas do Plan (fixadas aqui para todas as tasks):**

- **Formato em disco:** `{BACKUP_DIR}/{AAAA-MM-DD}/manifest.json` + `{BACKUP_DIR}/{AAAA-MM-DD}/tables/{tabela}.json.gz` (gzip por tabela via `node:zlib`). Substitui o "dump.zip" da spec, que ela mesma deixou "(ou equivalente / a definir no Plan)": `node:zlib` não escreve ZIP, e gzip por tabela permite verificar cada arquivo (reabrir + recalcular checksum) e restaurar tabela a tabela.
- **Promoção atômica:** o backup do dia é montado em `{AAAA-MM-DD}.partial-{HHmmss}` e só é renomeado para `{AAAA-MM-DD}` depois do manifest `status: "complete"` + verificação dos `.json.gz`. Falha → pasta `.partial-*` fica (para diagnóstico), **não** promove, **não** roda limpeza.
- **Logs:** `{BACKUP_DIR}/logs/backup.log` e `{BACKUP_DIR}/logs/cleanup.log`, uma linha por evento: `{ISO-8601} | {INFO|WARN|ERROR} | {mensagem}`.
- **Lock:** `{BACKUP_DIR}/backup.lock` criado com `open(..., "wx")`; lock com mais de 6 h é considerado órfão (removido com log WARN).
- **CLI:** `npx supabase db query --linked --project-ref {ref} --agent yes -f {arquivo.sql}` (validado em 2026-09-17: stdout = JSON `{"boundary","rows":[...],"warning"}`; erro = `{"_tag":"Error","error":{"code","message"}}` com exit 1; `Initialising login role...` vai para stderr). O SQL vai por arquivo temporário (`-f`) para evitar limite/escape de linha de comando no Windows.
- **Horário do agendamento:** 03:30 (hora local de Brasília da máquina), parâmetro `-Time`. A US-04 da spec cita "23h30" — conflita com a Restrição e com os Edge cases (03:30); prevalece a Restrição, e o script aceita qualquer horário.
- **Restauração:** SQL gerado a partir do JSON com `jsonb_populate_recordset(null::public."t", $tag$...$tag$::jsonb)` (tipos convertidos pelo próprio Postgres), colunas geradas excluídas, `set session_replication_role = replica;` no início de cada lote (não dispara triggers de negócio/`pg_net` e não checa FK durante a carga), `on conflict do nothing` por padrão. Default do script = **dry-run** (só gera `.sql` em disco).
- **Fatos medidos (2026-09-17, só leitura):** 184 tabelas em `public` (0 partições), 2 sem PK, 1 coluna `GENERATED ALWAYS`, 0 identity `ALWAYS`, 378 FKs (4 auto-referências, 2 apontando para `auth.users`), 65 triggers de usuário, nenhum tipo exótico (`bytea`, `tsvector`, `geometry`, `interval`...).

## Mapa de arquivos

> Módulos de lógica em `.mjs` (rodam direto no Node 22 das entradas) + `.d.mts` ao lado (tipagem para os testes `.test.ts` passarem no `tsc` sem aumentar o baseline — `noImplicitAny: true` em `tsconfig.app.json`). Testes em `src/test/lib/` (único glob que o Vitest inclui), com `// @vitest-environment node` na 1ª linha.

| Path | Ação | Responsabilidade | Task |
|------|------|------------------|------|
| `scripts/backup/lib/config.mjs` | criar | `PRODUCTION_PROJECT_REF`, `DEFAULT_BACKUP_DIR`, `resolveConfig()` (env + argv, recusa dir dentro do repo) | T01 |
| `scripts/backup/lib/config.d.mts` | criar | Tipos de `config.mjs` | T01 |
| `scripts/backup/lib/queries.mjs` | criar | Montagem de SQL só-leitura (listar tabelas/colunas/PK, contagens, FKs, página) + `assertReadOnlySql` + `parseCliOutput`/`classifyCliError` | T01 |
| `scripts/backup/lib/queries.d.mts` | criar | Tipos de `queries.mjs` | T01 |
| `src/test/lib/backupUtils.test.ts` | criar (T01) / modificar (T02, T03) | Testes da lógica pura de config, queries, manifest, retenção | T01, T02, T03 |
| `scripts/backup/lib/manifest.mjs` | criar | `canonicalJson`, `checksumRows`, `buildManifest`, `compareManifests` | T02 |
| `scripts/backup/lib/manifest.d.mts` | criar | Tipos de `manifest.mjs` (inclui `Manifest`, `TableEntry`, `FkEdge`) | T02 |
| `scripts/backup/lib/retention.mjs` | criar | `brasiliaDate`, `selectExpired` | T03 |
| `scripts/backup/lib/retention.d.mts` | criar | Tipos de `retention.mjs` | T03 |
| `scripts/backup/lib/restore.mjs` | criar | `topoSortTables`, `chunkRows`, `buildInsertSql`, `assertRestoreTarget` | T04 |
| `scripts/backup/lib/restore.d.mts` | criar | Tipos de `restore.mjs` | T04 |
| `src/test/lib/restoreValidation.test.ts` | criar (T04) / modificar (T08) | Testes da ordem por FK, SQL de restauração, guarda de alvo, script de restore com runner mock | T04, T08 |
| `scripts/backup/lib/cli.mjs` | criar | `createCliRunner()` — chama `supabase db query` via arquivo temporário, parse, erro classificado sem vazar stderr cru | T05 |
| `scripts/backup/lib/cli.d.mts` | criar | Tipos de `cli.mjs` (`QueryRunner`) | T05 |
| `scripts/backup/lib/files.mjs` | criar | `writeTableGz`, `readTableGz`, `verifyBackupDir`, `appendLog` | T05 |
| `scripts/backup/lib/files.d.mts` | criar | Tipos de `files.mjs` | T05 |
| `src/test/lib/backupIntegration.test.ts` | criar (T05) / modificar (T06, T07) | Testes com pasta temporária + runner mock (nunca CLI real) | T05, T06, T07 |
| `scripts/backup/lib/runBackup.mjs` | criar | `runBackup()` — lock, disco livre, extração sequencial paginada, manifest, verificação, promoção | T06 |
| `scripts/backup/lib/runBackup.d.mts` | criar | Tipos de `runBackup.mjs` | T06 |
| `scripts/backup-diario.mjs` | criar (T06) / modificar (T07: liga `runCleanup`) | Entrada: `resolveConfig` → `runBackup` → (se `complete`) `runCleanup`; exit code | T06, T07 |
| `scripts/backup/lib/cleanup.mjs` | criar | `runCleanup()` — lista pastas, aplica `selectExpired`, apaga, loga em `cleanup.log` | T07 |
| `scripts/backup/lib/cleanup.d.mts` | criar | Tipos de `cleanup.mjs` | T07 |
| `scripts/cleanup-backups.mjs` | criar | Entrada da limpeza (`--dry-run` suportado) | T07 |
| `scripts/verify-integrity.mjs` | criar | Entrada: `--backup <dir>` / `--compare <manifestA> <manifestB>` / `--live <dir> --project-ref <ref>` (contagens só-leitura) | T07 |
| `scripts/restore-from-backup.mjs` | criar | Entrada + `runRestore()` exportada: dry-run (gera `.sql`) por padrão; `--apply` só com `--project-ref` = `--confirm-project-ref` ≠ produção | T08 |
| `scripts/restore-from-backup.d.mts` | criar | Tipos de `runRestore` (para o teste) | T08 |
| `scripts/backup/register-scheduled-task.ps1` | criar | Script que **o dono** roda para registrar a tarefa diária (não executado pelo agente) | T09 |
| `docs/BACKUP-MAINTENANCE.md` | criar | Operação: variáveis, agendar, conferir tarefa, logs, reautenticar CLI, remover tarefa | T09 |
| `docs/RESTORE.md` | criar | Passo a passo de restauração sem Docker/psql, ordem por FK, recriar usuários, nunca produção | T10 |
| `AI_SYSTEM_MAP.md` | modificar | Registro no "Histórico de soluções e critérios" (padrão de backup + pegadinhas) | T10 |

Contagem: 30 paths, **29 `criar`** (≈ 97 %), 1 `modificar`.

## Contratos entre módulos (Interfaces globais — nomes/assinaturas VERBATIM)

> Fixados no skeleton para que tasks paralelas/zero-context usem os mesmos nomes. Cada task copia para seu bloco **Interfaces** o trecho que consome/produz; em caso de divergência, **esta seção vence**.

Tipos em notação TS (vão nos .d.mts). Todas as funções são ESM `export`. Módulos importam uns aos outros com extensão `.mjs` (ex.: `import { brasiliaDate } from "./retention.mjs"`). Testes `.test.ts` importam por caminho relativo, ex. `import { resolveConfig } from "../../../scripts/backup/lib/config.mjs";` — o `tsc` resolve para o `config.d.mts` ao lado.

### scripts/backup/lib/config.mjs (T01)
```ts
export const PRODUCTION_PROJECT_REF: "mdghhjemzdmeuqpzuyzx";
export const DEFAULT_BACKUP_DIR: "D:\\backups\\erpos";
export interface BackupConfig { backupDir: string; projectRef: string; retentionDays: number; pageSize: number; minFreeMb: number; supabaseCli: string; }
export function resolveConfig(input: { env: Record<string, string | undefined>; argv: string[]; repoRoot: string }): BackupConfig;
```
Regras:
- backupDir = valor após `--dir` em argv > env.ERPOS_BACKUP_DIR > DEFAULT_BACKUP_DIR; sempre `path.resolve`.
- projectRef = env.ERPOS_BACKUP_PROJECT_REF ?? PRODUCTION_PROJECT_REF; precisa casar /^[a-z0-9]{20}$/ senão `throw new Error("project ref inválido")`.
- retentionDays = inteiro de env.ERPOS_BACKUP_RETENTION_DAYS ?? 30 (>= 1 senão throw). pageSize = env.ERPOS_BACKUP_PAGE_SIZE ?? 1000 (1..10000 senão throw). minFreeMb = env.ERPOS_BACKUP_MIN_FREE_MB ?? 1024 (>= 0 senão throw). supabaseCli = env.ERPOS_SUPABASE_CLI ?? "npx supabase".
- `throw new Error(... "dentro do repositório" ...)` se backupDir === repoRoot ou começa com repoRoot + path.sep (no win32 comparar em minúsculas). Testes usam `path.join(os.tmpdir(), ...)` para funcionar em qualquer SO.
- Nunca lê nem guarda credencial.

### scripts/backup/lib/queries.mjs (T01)
```ts
export interface TableInfo { name: string; pkColumns: string[]; columns: { name: string; generated: boolean }[] }
export function quoteIdent(name: string): string;
export function assertReadOnlySql(sql: string): void;
export function listTablesSql(): string;
export function countsSql(tables: string[]): string;
export function fkEdgesSql(): string;
export function buildPageSql(table: string, orderBy: string[], limit: number, offset: number): string;
export class CliOutputError extends Error { kind: "auth" | "network" | "sql" | "unknown"; constructor(message: string, kind: "auth" | "network" | "sql" | "unknown") }
export function classifyCliError(text: string): "auth" | "network" | "sql" | "unknown";
export function parseCliOutput(stdout: string): Record<string, unknown>[];
export function rowsToTableInfo(rows: Record<string, unknown>[]): TableInfo[];
```
Regras:
- quoteIdent: `"` + nome com `"` dobrado + `"`; throw se vazio ou contém `\0`.
- assertReadOnlySql: trim; remove um único `;` final; remove literais `'...'` (com `''` interno) e identificadores `"..."`; então: se sobrar `;` → throw; precisa começar (case-insensitive) com `select` ou `with`; throw se casar `\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|set|reset|vacuum|analyze|refresh|lock|comment|security)\b` (case-insensitive). Mensagem: "SQL não é só-leitura".
- listTablesSql: uma consulta (select/with) sobre pg_class/pg_namespace/pg_attribute/pg_constraint retornando linhas `{ table_name: string, pk_columns: string[] (ordem da PK, [] se não houver), columns: {name, generated}[] (ordem attnum, generated = attgenerated <> '') }` para relkind in ('r','p') do schema public, ordenadas por table_name. Sem `;`.
- countsSql(tables): `throw` se vazio; retorna linhas `{ table_name, row_count }` com count(*) EXATO via `query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')` e xpath; tabelas via `unnest(array['a','b']::text[]) as t` com `'` dobrado. Precisa passar em assertReadOnlySql (atenção: `format(...)` dentro de literal some na remoção de literais).
- fkEdgesSql: linhas `{ child, parent }` distintas, contype='f', ambos no schema public, child <> parent, ordenado.
- buildPageSql: `select * from public."t" order by "a", "b" limit N offset M`; orderBy vazio → `select * from public."t" as t order by t::text limit N offset M`. limit inteiro > 0 e offset inteiro >= 0, senão throw.
- classifyCliError (testar nesta ordem): auth /unauthorized|\b401\b|access token|not logged in|supabase login|ProjectNotLinked/i → sql /Failed to run sql query|ERROR:\s+\w+|status 400/i → network /ENOTFOUND|ECONNRESET|ETIMEDOUT|timeout|network|fetch failed|status 5\d\d/i → "unknown".
- parseCliOutput: JSON.parse(stdout.trim()) (JSON inválido → CliOutputError("saída não-JSON da CLI","unknown")); objeto com `_tag === "Error"` → msg = `${error.code}: ${error.message}` truncado a 300 chars → CliOutputError(msg, classifyCliError(msg)); objeto com `rows` array → rows; array → ele mesmo; senão CliOutputError("saída inesperada da CLI","unknown").
- rowsToTableInfo: converte linhas do listTablesSql em TableInfo[] (`table_name`→name, `pk_columns`→pkColumns, `columns`→columns); aceita pk_columns/columns vindo como string JSON (JSON.parse) ou array.

### scripts/backup/lib/manifest.mjs (T02)
```ts
export interface FkEdge { child: string; parent: string }
export interface TableEntry { name: string; file: string; rowCount: number; expectedRowCount: number | null; checksum: string | null; pkColumns: string[]; columns: { name: string; generated: boolean }[]; error?: string }
export interface Manifest { version: 1; date: string; projectRef: string; startedAt: string; finishedAt: string; status: "complete" | "partial"; tables: TableEntry[]; fkEdges: FkEdge[] }
export function canonicalJson(value: unknown): string;
export function checksumRows(rows: unknown[]): string;
export function buildManifest(input: { date: string; projectRef: string; startedAt: string; finishedAt: string; tables: TableEntry[]; fkEdges: FkEdge[] }): Manifest;
export interface CompareResult { ok: boolean; errors: string[]; warnings: string[] }
export function compareManifests(base: Manifest, other: Manifest, opts?: { tolerancePct?: number }): CompareResult;
```
Regras:
- canonicalJson: chaves de objeto ordenadas recursivamente; arrays mantêm ordem; propriedades `undefined` omitidas; `null` mantido.
- checksumRows: `"sha256:" + hex(sha256(canonicalJson(rows)))` (node:crypto).
- buildManifest: version 1; tables ordenadas por name; status "partial" se alguma tabela tem `error` ou checksum null, senão "complete".
- compareManifests (tolerancePct default 5), para cada tabela de base: ausente em other → error `tabela X ausente`; |diff| / max(base.rowCount, 1) * 100 > tolerância → error `tabela X: base N, outro M (P%)`; 0 < |diff| ≤ tolerância → warning; rowCount igual e ambos checksums não-null e diferentes → warning `tabela X: mesmo nº de linhas, conteúdo diferente`. Tabela só em other → warning `tabela X nova`. ok = errors.length === 0.

### scripts/backup/lib/retention.mjs (T03)
```ts
export function brasiliaDate(d: Date): string;
export interface BackupDirEntry { name: string; complete: boolean }
export function selectExpired(entries: BackupDirEntry[], today: string, retentionDays: number): string[];
```
Regras:
- brasiliaDate: "AAAA-MM-DD" via `new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)`.
- selectExpired: só considera nomes /^\d{4}-\d{2}-\d{2}$/ ou /^\d{4}-\d{2}-\d{2}\.partial-\d{6}$/ (outros ignorados: "logs", "backup.lock", etc.); data do nome < corte, onde corte = today − retentionDays dias → expirado (ex.: today 2026-09-30, 30 dias → corte 2026-08-31; 2026-08-30 expira, 2026-08-31 fica). Nunca devolve a entrada `complete` mais recente, mesmo expirada. Retorno ordenado ascendente. Aritmética com `Date.UTC` sobre as strings (sem fuso).

### scripts/backup/lib/restore.mjs (T04)
```ts
export function topoSortTables(tables: string[], fkEdges: { child: string; parent: string }[]): { order: string[]; cycles: string[] };
export function chunkRows(rows: unknown[], maxBytes: number): unknown[][];
export function buildInsertSql(table: string, columns: { name: string; generated: boolean }[], rows: unknown[], opts?: { onConflict?: "nothing" | "error" }): string;
export function assertRestoreTarget(input: { projectRef: string | undefined; confirmProjectRef: string | undefined; productionRef: string }): void;
```
Regras:
- topoSortTables: Kahn, pais antes de filhos, empate alfabético; arestas com ponta fora de `tables` ignoradas; auto-arestas ignoradas; o que sobra (ciclo) vai em `cycles` (alfabético) e é anexado ao fim de `order`.
- chunkRows: preserva ordem; cada chunk com `JSON.stringify(chunk).length <= maxBytes`; linha sozinha maior que maxBytes vira chunk próprio; [] → [].
- buildInsertSql: cols = columns sem generated (throw se vazio; throw se rows vazio); tag = `"$bk" + randomBytes(4).toString("hex") + "$"`, regenerada enquanto JSON.stringify(rows) contiver a tag; retorno EXATO:
  `set session_replication_role = replica;\ninsert into public."t" ("a", "b") select "a", "b" from jsonb_populate_recordset(null::public."t", ${tag}${json}${tag}::jsonb)` + (onConflict === "error" ? "" : " on conflict do nothing") + `;\n`
  (identificadores via a mesma regra do quoteIdent — restore.mjs tem o próprio helper local `qi` para não importar queries.mjs e manter o Onde disjunto de T01).
- assertRestoreTarget: throw se projectRef vazio/ausente; throw se confirmProjectRef !== projectRef; throw com mensagem contendo "produção" se projectRef === productionRef. Sem flag de escape.

### scripts/backup/lib/cli.mjs (T05) — IO, sem TDD
```ts
export type QueryRunner = (sql: string) => Promise<Record<string, unknown>[]>;
export function createCliRunner(opts: { projectRef: string; supabaseCli?: string; readOnly: boolean; tmpDir?: string }): QueryRunner;
```
readOnly → assertReadOnlySql(sql) antes de tudo. Grava sql em arquivo temp (mkdtemp em tmpDir ?? os.tmpdir()), spawn com shell:true no win32 e paths entre aspas: `${supabaseCli ?? "npx supabase"} db query --linked --project-ref ${projectRef} --agent yes -f "<arquivo>"`, maxBuffer 256 MB, timeout 10 min; remove o temp no finally; parseCliOutput(stdout); exit != 0 com stdout não parseável → CliOutputError(classifyCliError(stdout+stderr)) com mensagem truncada em 300 chars e sem linhas que casem /PGPASSWORD|password|token/i. Nunca loga stderr cru.

### scripts/backup/lib/files.mjs (T05) — IO
```ts
export function writeTableGz(path: string, rows: unknown[]): Promise<number>;   // gzip(JSON.stringify(rows)); cria pasta pai; retorna bytes gravados
export function readTableGz(path: string): Promise<unknown[]>;
export function appendLog(logFile: string, level: "INFO" | "WARN" | "ERROR", message: string): void; // cria pasta; `${new Date().toISOString()} | ${level} | ${message}\n`
export function verifyBackupDir(dir: string): Promise<{ ok: boolean; errors: string[]; manifest: Manifest | null }>;
```
verifyBackupDir: lê `dir/manifest.json` (ausente/ inválido → ok false); para cada tabela sem `error`: lê `dir/tables/<file>` e confere `rows.length === rowCount` e `checksumRows(rows) === checksum`; arquivo ausente/corrompido → error.

### scripts/backup/lib/runBackup.mjs (T06)
```ts
export interface RunBackupResult { status: "complete" | "partial" | "aborted" | "skipped"; dir: string | null; manifest: Manifest | null; reason?: string }
export function runBackup(input: { config: BackupConfig; runQuery: QueryRunner; now?: () => Date; getFreeMb?: (dir: string) => number }): Promise<RunBackupResult>;
```
Log em `join(config.backupDir, "logs", "backup.log")`. Ordem:
1. mkdir backupDir; lock `backup.lock` via open "wx" (existe e mtime < 6 h → `skipped`, reason "lock"; ≥ 6 h → remove + WARN e segue).
2. getFreeMb (default: `fs.statfsSync(dir)` → bavail*bsize/1048576) < minFreeMb → `aborted` (reason "disco").
3. date = brasiliaDate(now()); se pasta `${date}` já existe → `skipped` (reason "já existe"; refazer = dono renomeia/apaga a pasta à mão). Sem `--force`.
4. work = `${date}.partial-${HHmmss}` (hora de Brasília).
5. runQuery(listTablesSql()) → rowsToTableInfo; runQuery(countsSql(names)) (`row_count` é bigint e pode vir como texto no JSON → `expectedRowCount = Number(row_count)`); runQuery(fkEdgesSql()).
6. Para cada tabela, EM SEQUÊNCIA (for…of + await, nunca Promise.all): offset 0, páginas `buildPageSql(name, pkColumns, pageSize, offset)` até vir página com < pageSize linhas; writeTableGz(`work/tables/${name}.json.gz`); TableEntry {file: `${name}.json.gz`, rowCount, expectedRowCount, checksum: checksumRows(rows)}. Erro numa tabela → entry.error = mensagem (de CliOutputError: `[kind] message`), checksum null, rowCount 0, segue para a próxima.
7. buildManifest → grava `work/manifest.json` (JSON.stringify(manifest, null, 2)) → verifyBackupDir(work).
8. manifest.status "complete" e verify ok → rename(work, `${date}`) → `complete`. Senão → `partial` (work fica).
9. finally: remove lock.
Log: INFO início (projectRef, dir); INFO por tabela (linhas, bytes); ERROR por tabela falha; WARN se rowCount ≠ expectedRowCount; INFO/ERROR final com status e total em MB.

### scripts/backup/lib/cleanup.mjs (T07)
```ts
export function runCleanup(input: { config: BackupConfig; today: string; dryRun?: boolean }): Promise<{ removed: string[] }>;
```
Lista diretórios de config.backupDir; complete = nome sem ".partial" e `manifest.json` com status "complete"; selectExpired(entries, today, config.retentionDays); `fs.rm(recursive, force)` de cada (não em dryRun); log em `logs/cleanup.log` uma linha por removida (ou "[dry-run] removeria X") + resumo.

### Entradas
- `scripts/backup-diario.mjs` (T06): `resolveConfig({ env: process.env, argv: process.argv.slice(2), repoRoot })` (repoRoot = pasta acima de scripts/) → `createCliRunner({ projectRef, supabaseCli, readOnly: true })` → `runBackup` → se `complete`: `runCleanup({ config, today: brasiliaDate(new Date()) })`. Exit: 0 complete/skipped, 1 partial/aborted, 2 erro inesperado (log ERROR).
- `scripts/cleanup-backups.mjs` (T07): `[--dir X] [--dry-run]`.
- `scripts/verify-integrity.mjs` (T07): `--backup <dir>` | `--compare <manifestA.json> <manifestB.json> [--tolerance 5]` | `--live <dir> --project-ref <ref>` (live: createCliRunner readOnly:true + countsSql; monta Manifest "other" com rowCount das contagens e checksum null; compareManifests). Exit 0 ok, 1 divergência.
- `scripts/restore-from-backup.mjs` + `scripts/restore-from-backup.d.mts` (T08): exporta
  ```ts
  export function runRestore(input: { backupDir: string; tables?: string[]; outDir?: string; apply: boolean; projectRef?: string; confirmProjectRef?: string; onConflict?: "nothing" | "error"; runQuery?: QueryRunner; maxChunkBytes?: number }): Promise<{ files: string[]; applied: number; order: string[]; cycles: string[] }>;
  ```
  Bloco main só quando `import.meta.url === pathToFileURL(process.argv[1]).href`. Sempre verifyBackupDir antes (falhou → throw). apply → assertRestoreTarget({ projectRef, confirmProjectRef, productionRef: PRODUCTION_PROJECT_REF }) ANTES de qualquer chamada; em seguida **pré-checagem de alvo vazio** (defesa independente da semântica `--linked`/`--project-ref` da CLI): `runQuery("select (select count(*) from public.tenants)::int as n")` → se a consulta falhar (schema ausente) → throw "aplique as migrations no projeto alvo antes"; se `n > 0` → throw contendo "alvo não está vazio" (produção tem lojas; restore só em projeto recém-criado) — **nenhum** SQL de restauração é enviado nesses casos; runQuery default = createCliRunner({ projectRef, readOnly: false }). Ordem = topoSortTables(tabelas selecionadas, manifest.fkEdges). Arquivos `NNN-<tabela>-<k>.sql` (NNN = posição 3 dígitos, k = chunk) em outDir (default `join(backupDir, "restore-sql")`), chunkRows(maxChunkBytes default 5_000_000). CLI: `--backup <dir> [--tables a,b] [--out <dir>] [--apply --project-ref X --confirm-project-ref X] [--on-conflict nothing|error]`.

## Profundidade do plano (`plan_depth`)

| Campo | Valor |
|-------|-------|
| **plan_depth** | `contracts` |
| **Critério** | Árvore §4.0 regra 2 — "maioria criar": 29 de 30 paths são `criar` (≥ 50 % **e** ≥ 8). Sem override do dev. |
| **Override do dev?** | não |

- **Mix por task (recomendado em greenfield):** as tasks de **lógica pura com TDD** (T01–T04) e o **thin slice** do caminho feliz (T06 — primeiro backup completo com runner mock) levam **teste completo** nos Steps; os corpos de produção pequenos (≤ 2–5 min) vêm completos, os maiores ficam em assinatura + regras (Produces). T09/T10 (docs + `.ps1`) são `snippets` (conteúdo completo no Step).
- Override por task: campo **Profundidade** na tabela da task.

## Progresso do Plan (ondas)

| Onda | Escopo | Status | Compliance | Nota |
|------|--------|--------|------------|------|
| 0 | Skeleton (Constraints + Mapa + Fases) | ✅ | ✅ skeleton (iter 1; 3 melhorias aplicadas) | |
| 1 | Fase 1 detalhe (T01–T04) | ✅ | ✅ fase-1 (iter 1; 2 melhorias, 1 aplicada) | planejador validou os snippets numa cópia temporária: 70/70 testes, tsc 0 erros |
| 2 | Fase 2 detalhe (T05–T08) | ✅ | ✅ fase-2 (iter 1 ❌ só pela nota de contagem; corrigida + melhoria da pré-checagem aplicada; iter 2 ✅) | validação do zero numa cópia temporária a partir dos Steps finais: backupIntegration 35 + restoreValidation 29 = 64 testes, tsc 0; nenhum teste chama a CLI real |
| 3 | Fase 3 detalhe (T09–T10) | pending | — | |
| final | cross | pending | — | `planned` só após esta |

## Plano de execução

### Fases

| Fase | Tasks | Depende de | Paralelo? | Modo execução |
|------|-------|------------|-----------|---------------|
| 1 — Núcleo puro (TDD) | T01 → T02 → T03 (mesmo arquivo de teste, sequencial) ∥ T04 | — | sim (T04 ∥ cadeia T01–T03) | `parallel-execution` (2 trilhas) ou `/sdd-06-execute` sequencial |
| 2 — IO com mocks (backup, limpeza, verificação, restore) | T05 → T06 → T07 (mesmo arquivo de teste) ∥ T08 (após T05) | por task (autoritativo = tabela de tasks/grafo): T05 ← T01+T02; T06 ← T03+T05; T08 ← T04+T05 | sim (T08 ∥ T06/T07) | `parallel-execution` (2 trilhas) ou sequencial |
| 3 — Entregáveis do dono + docs + validação real | T09 ∥ T10 | Fase 2 | sim | `parallel-execution` ou sequencial |

| Task | Título | Depende de | Paralelo com | Onde (resumo) |
|------|--------|------------|--------------|---------------|
| T01 | Config + montagem de SQL só-leitura + parse da CLI | — | T04 | `scripts/backup/lib/{config,queries}.{mjs,d.mts}`, `src/test/lib/backupUtils.test.ts` |
| T02 | Manifest + checksum + comparação | T01 | T04 | `scripts/backup/lib/manifest.{mjs,d.mts}`, `src/test/lib/backupUtils.test.ts` |
| T03 | Retenção de 30 dias + data de Brasília | T02 | T04 | `scripts/backup/lib/retention.{mjs,d.mts}`, `src/test/lib/backupUtils.test.ts` |
| T04 | Ordem de restauração por FK + SQL de insert + guarda de alvo | — (usa `PRODUCTION_PROJECT_REF` de T01 → ver nota) | T01, T02, T03 | `scripts/backup/lib/restore.{mjs,d.mts}`, `src/test/lib/restoreValidation.test.ts` |
| T05 | Runner da CLI + arquivos gz/log/verificação | T01, T02 | T03, T04 (Onde disjunto) | `scripts/backup/lib/{cli,files}.{mjs,d.mts}`, `src/test/lib/backupIntegration.test.ts` |
| T06 | `runBackup` + entrada `backup-diario.mjs` (thin slice) | T03, T05 | T08 | `scripts/backup/lib/runBackup.{mjs,d.mts}`, `scripts/backup-diario.mjs`, `src/test/lib/backupIntegration.test.ts` |
| T07 | Limpeza + entradas `cleanup-backups.mjs` / `verify-integrity.mjs` | T06 | T08 | `scripts/backup/lib/cleanup.{mjs,d.mts}`, `scripts/cleanup-backups.mjs`, `scripts/verify-integrity.mjs`, `src/test/lib/backupIntegration.test.ts` |
| T08 | Entrada `restore-from-backup.mjs` (dry-run padrão, produção recusada) | T04, T05 | T06, T07 | `scripts/restore-from-backup.{mjs,d.mts}`, `src/test/lib/restoreValidation.test.ts` |
| T09 | Script de registro do Agendador + `docs/BACKUP-MAINTENANCE.md` | T06, T07 | T10 | `scripts/backup/register-scheduled-task.ps1`, `docs/BACKUP-MAINTENANCE.md` |
| T10 | `docs/RESTORE.md` + `AI_SYSTEM_MAP.md` + validação real só-leitura | T06, T07, T08 | T09 | `docs/RESTORE.md`, `AI_SYSTEM_MAP.md` |

> Nota T04 × T01: `restore.mjs` importa `PRODUCTION_PROJECT_REF` de `config.mjs`. Para T04 rodar em paralelo com T01 sem depender dele, T04 **não** importa `config.mjs`: `assertRestoreTarget` recebe `productionRef` como parâmetro (a entrada T08 passa `PRODUCTION_PROJECT_REF`). Assim o **Onde** fica disjunto.

### Feature flag

**N/A** — `feature_flag: false` no frontmatter. Não é comportamento do app ERPOS (não passa por `system_settings`/`SystemSettingsContext`); é infraestrutura local da máquina do dono (Node + Agendador do Windows). Padrão de flags: ver [`AGENTS.md`](../../AGENTS.md).

### Impactos (resumo)

| Mudança | Intencional | Risco não intencional |
|---------|-------------|----------------------|
| Extração diária via `supabase db query` (Management API) | Cópia local diária de todo `public` sem Docker | Carga no banco de produção: mitigada por sequencial + página de 1000 + 03:30. Leitura em várias consultas (sem snapshot único): linhas escritas durante o backup podem sair inconsistentes entre tabelas — aceitável às 03:30; manifest registra `expectedRowCount` (contagem no início) × `rowCount` extraído e loga WARN se divergir. |
| `assertReadOnlySql` em todo SQL do backup | Garantir que o backup nunca escreve em produção | Falso positivo (bloquear SELECT legítimo) → teste cobre os SQLs gerados. |
| Arquivos em `D:\backups\erpos` | Backups fora do repo | Dados de clientes (nome/telefone/endereço) e financeiros em disco local **sem criptografia** — documentar em `BACKUP-MAINTENANCE.md` (pasta só do usuário; não sincronizar com nuvem pública). `auth` fica fora (sem hashes). |
| Retenção de 30 dias (apaga pastas) | Não encher o disco | Apagar backup bom por erro de data/regex → `selectExpired` só considera nomes `AAAA-MM-DD` / `AAAA-MM-DD.partial-*`, nunca apaga o backup completo mais recente, só roda após backup `complete`; `--dry-run` disponível. |
| Script de restore | Recuperação testável | Escrita acidental em produção → produção recusada em código (sem escape), dry-run padrão, `--confirm-project-ref` obrigatório. Triggers/`pg_net` disparando na carga → `session_replication_role = replica`. |
| Tarefa do Agendador (quando o dono registrar) | Execução automática | Tarefa roda só com o usuário logado (token da CLI fica no perfil do usuário) — documentar; `StartWhenAvailable` cobre PC desligado às 03:30. |
| Testes novos em `src/test/lib/` | Cobertura da lógica | `.d.mts` errado aumenta a contagem de erros TS → gate de tsc por task. |

### Grafo de dependências

```
T01 ──> T02 ──> T03 ──┐
 │       │            ▼
 └───────┴──> T05 ──> T06 ──> T07 ──> T09
               │                │
T04 ──────────>┴──> T08 ────────┴──> T10   (T10 também ← T06, T08)
```

(T05 depende de T01 e T02; T06 de T03 e T05; T08 de T04 e T05; T10 de T06, T07, T08; T09 de T06, T07.)

---

## T01: Config + montagem de SQL só-leitura + parse da CLI

| Campo | Valor |
|-------|-------|
| **Entregável** | `resolveConfig` (env + argv, recusa pasta dentro do repo) e o módulo de consultas só-leitura (`assertReadOnlySql`, SQL de catálogo/contagem/FK/página, leitura e classificação da saída da CLI), cobertos por teste |
| **Onde** | `scripts/backup/lib/config.mjs` (criar), `scripts/backup/lib/config.d.mts` (criar), `scripts/backup/lib/queries.mjs` (criar), `scripts/backup/lib/queries.d.mts` (criar), `src/test/lib/backupUtils.test.ts` (criar) |
| **Depende de** | — |
| **Bloqueia** | T02 (mesmo arquivo de teste), T05 |
| **Paralelo com** | T04 (Onde disjunto) |
| **Profundidade** | snippets (corpo completo) — override |
| **Requisitos** | RF-1 (lista de tabelas dinâmica: tabela nova entra sozinha via catálogo), RF-2 (página ordenada pela PK; fallback `t::text` nas 2 tabelas sem PK), Restrições "backup só leitura", "sem credencial", "saída fora do repo (`ERPOS_BACKUP_DIR`)"; edge case "login expirado identificável" (`classifyCliError` → `auth`); US-01 |

### Context pack
- **Spec:** §2 RF-1, RF-2, Restrições (só leitura, sem credencial, saída configurável fora do repo), Edge case "login/token da CLI expirado"; §4 US-01.
- **Constraints:** ver [Global Constraints](#global-constraints) e [Contratos entre módulos](#contratos-entre-módulos-interfaces-globais--nomesassinaturas-verbatim) (seções `config.mjs (T01)` e `queries.mjs (T01)` — vencem este bloco em caso de divergência).
- **Padrão do repo:** módulo Node 22 ESM como `scripts/check.mjs` (cabeçalho JSDoc em português, imports `node:*`, aspas duplas, ponto-e-vírgula, sem dependência nova); teste como `src/test/lib/coalescedRunner.test.ts` (`import { describe, it, expect } from "vitest"`), com `// @vitest-environment node` na 1ª linha (o ambiente padrão do Vitest é jsdom); import relativo `../../../scripts/backup/lib/x.mjs` — o `tsc` usa o `x.d.mts` ao lado (`noImplicitAny`, `strictNullChecks`, `moduleResolution: bundler`).
- **Arquivos vizinhos:** `scripts/check.mjs` (estilo), `vite.config.ts` bloco `test` (include só `src/**`), `tsconfig.app.json`.
- **Não fazer:** não ler/gravar credencial nem `.env`; não chamar a CLI nem rede nos testes; não importar `config.mjs` a partir de `queries.mjs` (módulos independentes); não criar `scripts/backup/lib/cli.mjs` (é T05); não rodar `check.mjs --update-baseline`; sem commit.

### Interfaces
- **Consumes:** nenhuma (primeira task).
- **Produces** (verbatim dos Contratos):
  ```ts
  // config.mjs
  export const PRODUCTION_PROJECT_REF: "mdghhjemzdmeuqpzuyzx";
  export const DEFAULT_BACKUP_DIR: "D:\\backups\\erpos";
  export interface BackupConfig { backupDir: string; projectRef: string; retentionDays: number; pageSize: number; minFreeMb: number; supabaseCli: string; }
  export function resolveConfig(input: { env: Record<string, string | undefined>; argv: string[]; repoRoot: string }): BackupConfig;
  // queries.mjs
  export interface TableInfo { name: string; pkColumns: string[]; columns: { name: string; generated: boolean }[] }
  export function quoteIdent(name: string): string;
  export function assertReadOnlySql(sql: string): void;
  export function listTablesSql(): string;
  export function countsSql(tables: string[]): string;
  export function fkEdgesSql(): string;
  export function buildPageSql(table: string, orderBy: string[], limit: number, offset: number): string;
  export class CliOutputError extends Error { kind: "auth" | "network" | "sql" | "unknown"; constructor(message: string, kind: "auth" | "network" | "sql" | "unknown") }
  export function classifyCliError(text: string): "auth" | "network" | "sql" | "unknown";
  export function parseCliOutput(stdout: string): Record<string, unknown>[];
  export function rowsToTableInfo(rows: Record<string, unknown>[]): TableInfo[];
  ```
  Consumidores: T05 (`createCliRunner` usa `assertReadOnlySql`, `parseCliOutput`, `classifyCliError`, `CliOutputError`), T06 (`resolveConfig`, `listTablesSql`, `rowsToTableInfo`, `countsSql`, `fkEdgesSql`, `buildPageSql`), T07/T08 (`PRODUCTION_PROJECT_REF`, `countsSql`).

### Steps
- [ ] **Step 1: Escrever o teste completo (RED)** — criar `src/test/lib/backupUtils.test.ts` com exatamente:
  ```ts
  // @vitest-environment node
  /**
   * Testes da lógica pura do backup diário (specs/2026-09-backup-diario).
   * T01: config + SQL só-leitura + leitura da saída da CLI.
   * T02 e T03 acrescentam describes neste arquivo (manifest/checksum e retenção).
   * Nenhum teste chama a CLI do Supabase nem a rede.
   */
  import { describe, it, expect } from "vitest";
  import { join, resolve } from "node:path";
  import { tmpdir } from "node:os";
  import { DEFAULT_BACKUP_DIR, PRODUCTION_PROJECT_REF, resolveConfig } from "../../../scripts/backup/lib/config.mjs";
  import {
    CliOutputError,
    assertReadOnlySql,
    buildPageSql,
    classifyCliError,
    countsSql,
    fkEdgesSql,
    listTablesSql,
    parseCliOutput,
    quoteIdent,
    rowsToTableInfo,
  } from "../../../scripts/backup/lib/queries.mjs";

  const REPO = join(tmpdir(), "erpos-repo-falso");
  const FORA = join(tmpdir(), "erpos-backups-teste");

  function capturar(fn: () => unknown): CliOutputError {
    try {
      fn();
    } catch (e) {
      return e as CliOutputError;
    }
    throw new Error("não lançou");
  }

  describe("resolveConfig (backup diário)", () => {
    it("sem env nem argv usa os defaults (produção só leitura, D:\\backups\\erpos, 30 dias, página 1000)", () => {
      expect(PRODUCTION_PROJECT_REF).toBe("mdghhjemzdmeuqpzuyzx");
      expect(DEFAULT_BACKUP_DIR).toBe("D:\\backups\\erpos");
      expect(resolveConfig({ env: {}, argv: [], repoRoot: REPO })).toEqual({
        backupDir: resolve(DEFAULT_BACKUP_DIR),
        projectRef: PRODUCTION_PROJECT_REF,
        retentionDays: 30,
        pageSize: 1000,
        minFreeMb: 1024,
        supabaseCli: "npx supabase",
      });
    });

    it("ERPOS_BACKUP_DIR troca a pasta e as variáveis numéricas são lidas", () => {
      const cfg = resolveConfig({
        env: {
          ERPOS_BACKUP_DIR: FORA,
          ERPOS_BACKUP_RETENTION_DAYS: "7",
          ERPOS_BACKUP_PAGE_SIZE: "500",
          ERPOS_BACKUP_MIN_FREE_MB: "0",
          ERPOS_SUPABASE_CLI: "supabase",
          ERPOS_BACKUP_PROJECT_REF: "abcdefghijklmnopqrst",
        },
        argv: [],
        repoRoot: REPO,
      });
      expect(cfg).toEqual({
        backupDir: resolve(FORA),
        projectRef: "abcdefghijklmnopqrst",
        retentionDays: 7,
        pageSize: 500,
        minFreeMb: 0,
        supabaseCli: "supabase",
      });
    });

    it("--dir na linha de comando vence ERPOS_BACKUP_DIR", () => {
      const outra = join(tmpdir(), "erpos-backups-argv");
      const cfg = resolveConfig({ env: { ERPOS_BACKUP_DIR: FORA }, argv: ["--dir", outra], repoRoot: REPO });
      expect(cfg.backupDir).toBe(resolve(outra));
    });

    it("recusa pasta dentro do repositório (ou o próprio repositório)", () => {
      expect(() => resolveConfig({ env: { ERPOS_BACKUP_DIR: join(REPO, "backups") }, argv: [], repoRoot: REPO })).toThrow(
        "dentro do repositório",
      );
      expect(() => resolveConfig({ env: {}, argv: ["--dir", REPO], repoRoot: REPO })).toThrow("dentro do repositório");
    });

    it("aceita pasta irmã com prefixo parecido (não é dentro do repositório)", () => {
      const irma = REPO + "-backups";
      expect(resolveConfig({ env: { ERPOS_BACKUP_DIR: irma }, argv: [], repoRoot: REPO }).backupDir).toBe(resolve(irma));
    });

    it.runIf(process.platform === "win32")("no Windows compara sem diferenciar maiúsculas", () => {
      expect(() =>
        resolveConfig({ env: { ERPOS_BACKUP_DIR: join(REPO.toUpperCase(), "bk") }, argv: [], repoRoot: REPO }),
      ).toThrow("dentro do repositório");
    });

    it("recusa pageSize fora de 1..10000, retenção < 1, espaço mínimo negativo e --dir sem valor", () => {
      const base = { argv: [] as string[], repoRoot: REPO };
      expect(() => resolveConfig({ ...base, env: { ERPOS_BACKUP_PAGE_SIZE: "0" } })).toThrow();
      expect(() => resolveConfig({ ...base, env: { ERPOS_BACKUP_PAGE_SIZE: "10001" } })).toThrow();
      expect(() => resolveConfig({ ...base, env: { ERPOS_BACKUP_PAGE_SIZE: "abc" } })).toThrow();
      expect(() => resolveConfig({ ...base, env: { ERPOS_BACKUP_RETENTION_DAYS: "0" } })).toThrow();
      expect(() => resolveConfig({ ...base, env: { ERPOS_BACKUP_MIN_FREE_MB: "-1" } })).toThrow();
      expect(() => resolveConfig({ env: {}, argv: ["--dir"], repoRoot: REPO })).toThrow();
    });

    it("recusa project ref inválido", () => {
      expect(() => resolveConfig({ env: { ERPOS_BACKUP_PROJECT_REF: "ABC" }, argv: [], repoRoot: REPO })).toThrow(
        "project ref inválido",
      );
    });
  });

  describe("quoteIdent", () => {
    it("põe aspas e dobra aspas internas", () => {
      expect(quoteIdent("pedidos")).toBe('"pedidos"');
      expect(quoteIdent('a"b')).toBe('"a""b"');
    });

    it("recusa vazio e \\0", () => {
      expect(() => quoteIdent("")).toThrow();
      expect(() => quoteIdent("a\0b")).toThrow();
    });
  });

  describe("assertReadOnlySql (backup nunca escreve em produção)", () => {
    it("aceita todos os SQLs que o backup gera", () => {
      const gerados = [
        listTablesSql(),
        countsSql(["a", "o'b"]),
        fkEdgesSql(),
        buildPageSql("pedidos", ["id"], 1000, 0),
        buildPageSql("log_sem_pk", [], 1000, 2000),
      ];
      for (const sql of gerados) expect(() => assertReadOnlySql(sql)).not.toThrow();
    });

    it("aceita palavra proibida dentro de literal e um ; final", () => {
      expect(() => assertReadOnlySql("select 'drop table' as txt")).not.toThrow();
      expect(() => assertReadOnlySql("select 1;")).not.toThrow();
    });

    it.each([
      "delete from x",
      "select 1; drop table x",
      "with a as (select 1) insert into y select * from a",
      "update t set a=1",
      "truncate pedidos",
    ])("rejeita %s", (sql) => {
      expect(() => assertReadOnlySql(sql)).toThrow("SQL não é só-leitura");
    });
  });

  describe("montagem das consultas", () => {
    it("listTablesSql lê o catálogo do schema public, sem ;", () => {
      const sql = listTablesSql();
      expect(sql).toContain("pg_class");
      expect(sql).toContain("'public'");
      expect(sql).toContain("relkind in ('r', 'p')");
      expect(sql).toContain("table_name");
      expect(sql).toContain("pk_columns");
      expect(sql).not.toContain(";");
    });

    it("countsSql usa count(*) exato por tabela e dobra aspas simples", () => {
      const sql = countsSql(["a", "o'b"]);
      expect(sql).toContain("query_to_xml");
      expect(sql).toContain("count(*)");
      expect(sql).toContain("array['a', 'o''b']::text[]");
      expect(() => countsSql([])).toThrow();
    });

    it("fkEdgesSql lista só FKs entre tabelas do public, sem auto-referência", () => {
      const sql = fkEdgesSql();
      expect(sql).toContain("contype = 'f'");
      expect(sql).toContain("ch.oid <> pa.oid");
    });

    it("buildPageSql ordena pela PK (composta) com limit/offset", () => {
      expect(buildPageSql("itens_pedido", ["pedido_id", "item"], 1000, 2000)).toBe(
        'select * from public."itens_pedido" order by "pedido_id", "item" limit 1000 offset 2000',
      );
    });

    it("buildPageSql sem PK ordena pela linha inteira como texto", () => {
      expect(buildPageSql("log", [], 500, 0)).toBe('select * from public."log" as t order by t::text limit 500 offset 0');
    });

    it("buildPageSql recusa limit/offset inválidos", () => {
      expect(() => buildPageSql("t", ["id"], 0, 0)).toThrow();
      expect(() => buildPageSql("t", ["id"], 1.5, 0)).toThrow();
      expect(() => buildPageSql("t", ["id"], 10, -1)).toThrow();
    });
  });

  describe("saída da CLI do Supabase", () => {
    it("devolve rows do formato {boundary, rows, warning}", () => {
      const out = JSON.stringify({ boundary: "abc", rows: [{ a: 1 }], warning: "dados não confiáveis" });
      expect(parseCliOutput(out)).toEqual([{ a: 1 }]);
    });

    it("aceita array puro com espaços em volta", () => {
      expect(parseCliOutput('\n [{"a":1}] \n')).toEqual([{ a: 1 }]);
    });

    it("erro de SQL (42P01) vira CliOutputError kind sql", () => {
      const out = JSON.stringify({
        _tag: "Error",
        error: { code: "42P01", message: 'Failed to run sql query: ERROR:  42P01: relation "x" does not exist' },
      });
      const err = capturar(() => parseCliOutput(out));
      expect(err).toBeInstanceOf(CliOutputError);
      expect(err.kind).toBe("sql");
      expect(err.message.startsWith("42P01: ")).toBe(true);
    });

    it("projeto não linkado / login vira kind auth", () => {
      const out = JSON.stringify({
        _tag: "Error",
        error: { code: "LegacyProjectNotLinkedError", message: "Cannot find project ref. Have you run supabase link?" },
      });
      expect(capturar(() => parseCliOutput(out)).kind).toBe("auth");
    });

    it("mensagem de erro é truncada em 300 caracteres", () => {
      const out = JSON.stringify({ _tag: "Error", error: { code: "X", message: "y".repeat(1000) } });
      expect(capturar(() => parseCliOutput(out)).message.length).toBeLessThanOrEqual(300);
    });

    it("texto não-JSON e JSON inesperado viram CliOutputError unknown", () => {
      const naoJson = capturar(() => parseCliOutput("Initialising login role..."));
      expect(naoJson).toBeInstanceOf(CliOutputError);
      expect(naoJson.kind).toBe("unknown");
      expect(naoJson.message).toBe("saída não-JSON da CLI");
      expect(capturar(() => parseCliOutput('{"foo":1}')).message).toBe("saída inesperada da CLI");
    });

    it.each<[string, string]>([
      ["Unauthorized", "auth"],
      ["Access token not provided. Run supabase login", "auth"],
      ["Failed to run sql query: ERROR:  42703: column x does not exist", "sql"],
      ["ECONNRESET", "network"],
      ["unexpected status 503", "network"],
      ["algo estranho", "unknown"],
    ])("classifyCliError(%s) → %s", (texto, kind) => {
      expect(classifyCliError(texto)).toBe(kind);
    });

    it("rowsToTableInfo aceita pk_columns/columns como string JSON ou array", () => {
      const info = rowsToTableInfo([
        {
          table_name: "pedidos",
          pk_columns: '["id"]',
          columns: '[{"name":"id","generated":false},{"name":"total_calc","generated":true}]',
        },
        { table_name: "log_sem_pk", pk_columns: [], columns: [{ name: "msg", generated: false }] },
      ]);
      expect(info).toEqual([
        {
          name: "pedidos",
          pkColumns: ["id"],
          columns: [
            { name: "id", generated: false },
            { name: "total_calc", generated: true },
          ],
        },
        { name: "log_sem_pk", pkColumns: [], columns: [{ name: "msg", generated: false }] },
      ]);
    });
  });
  ```
  Esperado: arquivo criado; nenhum arquivo em `scripts/backup/` ainda.

- [ ] **Step 2: Rodar e ver falhar pelo motivo certo**
  ```
  npx vitest run src/test/lib/backupUtils.test.ts
  ```
  Esperado: FAIL da suíte com `Error: Cannot find module '../../../scripts/backup/lib/config.mjs'` (ou `Failed to load url ../../../scripts/backup/lib/config.mjs ... Does the file exist?`). Qualquer outro motivo → corrigir o teste antes de seguir.

- [ ] **Step 3: Criar os `.d.mts` completos** — `scripts/backup/lib/config.d.mts`:
  ```ts
  export declare const PRODUCTION_PROJECT_REF: "mdghhjemzdmeuqpzuyzx";
  export declare const DEFAULT_BACKUP_DIR: "D:\\backups\\erpos";
  export interface BackupConfig { backupDir: string; projectRef: string; retentionDays: number; pageSize: number; minFreeMb: number; supabaseCli: string; }
  export declare function resolveConfig(input: { env: Record<string, string | undefined>; argv: string[]; repoRoot: string }): BackupConfig;
  ```
  e `scripts/backup/lib/queries.d.mts`:
  ```ts
  export interface TableInfo { name: string; pkColumns: string[]; columns: { name: string; generated: boolean }[] }
  export declare function quoteIdent(name: string): string;
  export declare function assertReadOnlySql(sql: string): void;
  export declare function listTablesSql(): string;
  export declare function countsSql(tables: string[]): string;
  export declare function fkEdgesSql(): string;
  export declare function buildPageSql(table: string, orderBy: string[], limit: number, offset: number): string;
  export declare class CliOutputError extends Error {
    kind: "auth" | "network" | "sql" | "unknown";
    constructor(message: string, kind: "auth" | "network" | "sql" | "unknown");
  }
  export declare function classifyCliError(text: string): "auth" | "network" | "sql" | "unknown";
  export declare function parseCliOutput(stdout: string): Record<string, unknown>[];
  export declare function rowsToTableInfo(rows: Record<string, unknown>[]): TableInfo[];
  ```
  Esperado: tipos idênticos aos Contratos.

- [ ] **Step 4: Implementar `scripts/backup/lib/config.mjs`** (corpo completo):
  ```js
  /**
   * config.mjs — configuração do backup diário (specs/2026-09-backup-diario, T01)
   *
   * Resolve pasta de saída, projeto, retenção, tamanho de página e CLI a partir
   * de variáveis de ambiente e da linha de comando. Nunca lê nem guarda credencial:
   * a autenticação é a da CLI do Supabase já logada na máquina.
   *
   *   ERPOS_BACKUP_DIR            pasta dos backups (default D:\backups\erpos; --dir vence)
   *   ERPOS_BACKUP_PROJECT_REF    projeto Supabase (default = produção, só leitura)
   *   ERPOS_BACKUP_RETENTION_DAYS dias mantidos (default 30)
   *   ERPOS_BACKUP_PAGE_SIZE      linhas por consulta (default 1000, 1..10000)
   *   ERPOS_BACKUP_MIN_FREE_MB    espaço livre mínimo (default 1024)
   *   ERPOS_SUPABASE_CLI          comando da CLI (default "npx supabase")
   */
  import { resolve, sep } from "node:path";

  export const PRODUCTION_PROJECT_REF = "mdghhjemzdmeuqpzuyzx";
  export const DEFAULT_BACKUP_DIR = "D:\\backups\\erpos";

  function intFrom(raw, fallback, min, max, label) {
    const value = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${label} inválido: ${raw}`);
    }
    return value;
  }

  function sameCase(p) {
    return process.platform === "win32" ? p.toLowerCase() : p;
  }

  export function resolveConfig({ env, argv, repoRoot }) {
    const dirIdx = argv.indexOf("--dir");
    const argDir = dirIdx >= 0 ? argv[dirIdx + 1] : undefined;
    if (dirIdx >= 0 && !argDir) throw new Error("--dir exige um caminho");

    const backupDir = resolve(argDir || env.ERPOS_BACKUP_DIR || DEFAULT_BACKUP_DIR);
    const root = resolve(repoRoot);
    const dirCmp = sameCase(backupDir);
    const rootCmp = sameCase(root);
    if (dirCmp === rootCmp || dirCmp.startsWith(rootCmp + sep)) {
      throw new Error(`pasta de backup não pode ficar dentro do repositório: ${backupDir}`);
    }

    const projectRef = env.ERPOS_BACKUP_PROJECT_REF ?? PRODUCTION_PROJECT_REF;
    if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("project ref inválido");

    return {
      backupDir,
      projectRef,
      retentionDays: intFrom(env.ERPOS_BACKUP_RETENTION_DAYS, 30, 1, Number.MAX_SAFE_INTEGER, "ERPOS_BACKUP_RETENTION_DAYS"),
      pageSize: intFrom(env.ERPOS_BACKUP_PAGE_SIZE, 1000, 1, 10000, "ERPOS_BACKUP_PAGE_SIZE"),
      minFreeMb: intFrom(env.ERPOS_BACKUP_MIN_FREE_MB, 1024, 0, Number.MAX_SAFE_INTEGER, "ERPOS_BACKUP_MIN_FREE_MB"),
      supabaseCli: env.ERPOS_SUPABASE_CLI ?? "npx supabase",
    };
  }
  ```
  Esperado: `resolveConfig` segue as regras do Contrato (`--dir` > env > default; `path.resolve`; minúsculas no win32; `"dentro do repositório"`; `"project ref inválido"`).

- [ ] **Step 5: Implementar `scripts/backup/lib/queries.mjs`** (corpo completo):
  ```js
  /**
   * queries.mjs — SQL só-leitura do backup diário + leitura da saída da CLI (T01)
   *
   * Todo SQL que o backup manda para `supabase db query` sai daqui e passa por
   * assertReadOnlySql. Nada neste módulo faz IO.
   */

  const WRITE_WORDS = /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|set|reset|vacuum|analyze|refresh|lock|comment|security)\b/i;

  export function quoteIdent(name) {
    if (typeof name !== "string" || name.length === 0 || name.includes("\0")) {
      throw new Error(`identificador inválido: ${JSON.stringify(name)}`);
    }
    return `"${name.replace(/"/g, '""')}"`;
  }

  export function assertReadOnlySql(sql) {
    let s = String(sql).trim();
    if (s.endsWith(";")) s = s.slice(0, -1);
    s = s.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""').trim();
    if (s.includes(";") || !/^(select|with)\b/i.test(s) || WRITE_WORDS.test(s)) {
      throw new Error("SQL não é só-leitura");
    }
  }

  export function listTablesSql() {
    return [
      "select c.relname as table_name,",
      "  coalesce((select jsonb_agg(a.attname order by k.ord)",
      "    from pg_constraint pk",
      "    cross join lateral unnest(pk.conkey) with ordinality as k(attnum, ord)",
      "    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum",
      "    where pk.conrelid = c.oid and pk.contype = 'p'), '[]'::jsonb) as pk_columns,",
      "  coalesce((select jsonb_agg(jsonb_build_object('name', a.attname, 'generated', a.attgenerated <> '') order by a.attnum)",
      "    from pg_attribute a",
      "    where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '[]'::jsonb) as columns",
      "from pg_class c",
      "join pg_namespace n on n.oid = c.relnamespace",
      "where n.nspname = 'public' and c.relkind in ('r', 'p')",
      "order by c.relname",
    ].join("\n");
  }

  export function countsSql(tables) {
    if (!Array.isArray(tables) || tables.length === 0) throw new Error("countsSql: lista de tabelas vazia");
    const list = tables.map((t) => `'${String(t).replace(/'/g, "''")}'`).join(", ");
    return [
      "select t as table_name,",
      "  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text::bigint as row_count",
      `from unnest(array[${list}]::text[]) as t`,
      "order by t",
    ].join("\n");
  }

  export function fkEdgesSql() {
    return [
      "select distinct ch.relname as child, pa.relname as parent",
      "from pg_constraint fk",
      "join pg_class ch on ch.oid = fk.conrelid",
      "join pg_namespace chn on chn.oid = ch.relnamespace",
      "join pg_class pa on pa.oid = fk.confrelid",
      "join pg_namespace pan on pan.oid = pa.relnamespace",
      "where fk.contype = 'f' and chn.nspname = 'public' and pan.nspname = 'public' and ch.oid <> pa.oid",
      "order by child, parent",
    ].join("\n");
  }

  export function buildPageSql(table, orderBy, limit, offset) {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error(`limit inválido: ${limit}`);
    if (!Number.isInteger(offset) || offset < 0) throw new Error(`offset inválido: ${offset}`);
    const t = quoteIdent(table);
    if (orderBy.length === 0) {
      return `select * from public.${t} as t order by t::text limit ${limit} offset ${offset}`;
    }
    return `select * from public.${t} order by ${orderBy.map(quoteIdent).join(", ")} limit ${limit} offset ${offset}`;
  }

  export class CliOutputError extends Error {
    constructor(message, kind) {
      super(message);
      this.name = "CliOutputError";
      this.kind = kind;
    }
  }

  export function classifyCliError(text) {
    const s = String(text);
    if (/unauthorized|\b401\b|access token|not logged in|supabase login|ProjectNotLinked/i.test(s)) return "auth";
    if (/Failed to run sql query|ERROR:\s+\w+|status 400/i.test(s)) return "sql";
    if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|timeout|network|fetch failed|status 5\d\d/i.test(s)) return "network";
    return "unknown";
  }

  export function parseCliOutput(stdout) {
    let data;
    try {
      data = JSON.parse(String(stdout).trim());
    } catch {
      throw new CliOutputError("saída não-JSON da CLI", "unknown");
    }
    if (Array.isArray(data)) return data;
    if (data !== null && typeof data === "object") {
      if (data._tag === "Error") {
        const err = data.error ?? {};
        const msg = `${err.code}: ${err.message}`.slice(0, 300);
        throw new CliOutputError(msg, classifyCliError(msg));
      }
      if (Array.isArray(data.rows)) return data.rows;
    }
    throw new CliOutputError("saída inesperada da CLI", "unknown");
  }

  function jsonArray(value) {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  }

  export function rowsToTableInfo(rows) {
    return rows.map((r) => ({
      name: String(r.table_name),
      pkColumns: jsonArray(r.pk_columns).map(String),
      columns: jsonArray(r.columns).map((c) => ({ name: String(c.name), generated: c.generated === true })),
    }));
  }
  ```
  Esperado: nenhum SQL gerado contém `;` nem palavra da lista proibida fora de literal (o `format('select count(*) ...')` fica dentro de literal e some na checagem).

- [ ] **Step 6: Rodar o teste e ver passar (GREEN)**
  ```
  npx vitest run src/test/lib/backupUtils.test.ts
  ```
  Esperado: PASS — 36 testes (35 fora do Windows: o `it.runIf(win32)` é pulado).

- [ ] **Step 7: Refactor/limpeza** — conferir que não há `console.log`, código morto ou export fora do Contrato; nomes idênticos aos Contratos. Se mudar algo, repetir o Step 6.
  Esperado: sem alteração de comportamento.

- [ ] **Step 8: Gate iterativo**
  ```
  npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"
  npx vitest run
  ```
  Esperado: contagem ≤ 292 (baseline de `scripts/baseline.json`; o arquivo novo não pode adicionar erro); suíte sem falha nova. (`npx vite build` não é afetado por `scripts/`; roda no gate da fase.)

### Definição de pronto (DoD)
- [ ] `config.mjs`, `config.d.mts`, `queries.mjs`, `queries.d.mts` criados; `backupUtils.test.ts` criado e verde.
- [ ] Teste viu FAIL (módulo inexistente) antes da implementação — ciclo RED → GREEN registrado.
- [ ] Os 5 SQLs gerados (4 funções; `buildPageSql` com e sem PK) passam em `assertReadOnlySql`; os 5 de escrita são rejeitados.
- [ ] Interfaces = Contratos (nomes, assinaturas, mensagens `"dentro do repositório"`, `"project ref inválido"`, `"SQL não é só-leitura"`, `"saída não-JSON da CLI"`, `"saída inesperada da CLI"`).
- [ ] Gate iterativo: tsc ≤ 292, `npx vitest run` sem falha nova.
- [ ] Sem shadow code (nenhum helper duplicado fora do Mapa; nenhum arquivo além do Onde); nenhuma credencial; sem commit.

---

## T02: Manifest + checksum + comparação

| Campo | Valor |
|-------|-------|
| **Entregável** | `canonicalJson`, `checksumRows`, `buildManifest` (status `complete`/`partial`) e `compareManifests` (tolerância 5%), cobertos por teste |
| **Onde** | `scripts/backup/lib/manifest.mjs` (criar), `scripts/backup/lib/manifest.d.mts` (criar), `src/test/lib/backupUtils.test.ts` (modificar: imports + novos `describe`) |
| **Depende de** | T01 (mesmo arquivo de teste) |
| **Bloqueia** | T03 (mesmo arquivo de teste), T05 |
| **Paralelo com** | T04 |
| **Profundidade** | snippets (corpo completo) — override |
| **Requisitos** | RF-3 (manifest com contagem + checksum por tabela), RF-7 (falha parcial → `status: "partial"`, não promove), RF-8 (verificação reutilizável; critério de sucesso "manifests idênticos sem divergência; tabela divergindo > 5% → erro"); US-01, US-02 |

### Context pack
- **Spec:** §2 RF-3, RF-7, RF-8 e critério de sucesso de integridade; Edge case "tabela removida/erro numa tabela → falha parcial"; §4 US-01, US-02.
- **Constraints:** ver [Global Constraints](#global-constraints) e [Contratos entre módulos](#contratos-entre-módulos-interfaces-globais--nomesassinaturas-verbatim) (seção `manifest.mjs (T02)`).
- **Padrão do repo:** mesmo de T01 (`.mjs` ESM + `.d.mts`; teste no `backupUtils.test.ts` já com `// @vitest-environment node`). Hash com `node:crypto` como `scripts/check.mjs` (`createHash`).
- **Arquivos vizinhos:** `src/test/lib/backupUtils.test.ts` (T01), `scripts/backup/lib/queries.mjs` (não é importado aqui).
- **Não fazer:** não mexer nos `describe` de T01; não fazer IO (ler/gravar manifest em disco é T05/T06); não importar `retention.mjs` ainda (T03); sem commit.

### Interfaces
- **Consumes:** nenhuma de T01 em código (só compartilha o arquivo de teste).
- **Produces** (verbatim dos Contratos):
  ```ts
  export interface FkEdge { child: string; parent: string }
  export interface TableEntry { name: string; file: string; rowCount: number; expectedRowCount: number | null; checksum: string | null; pkColumns: string[]; columns: { name: string; generated: boolean }[]; error?: string }
  export interface Manifest { version: 1; date: string; projectRef: string; startedAt: string; finishedAt: string; status: "complete" | "partial"; tables: TableEntry[]; fkEdges: FkEdge[] }
  export function canonicalJson(value: unknown): string;
  export function checksumRows(rows: unknown[]): string;
  export function buildManifest(input: { date: string; projectRef: string; startedAt: string; finishedAt: string; tables: TableEntry[]; fkEdges: FkEdge[] }): Manifest;
  export interface CompareResult { ok: boolean; errors: string[]; warnings: string[] }
  export function compareManifests(base: Manifest, other: Manifest, opts?: { tolerancePct?: number }): CompareResult;
  ```
  Consumidores: T05 (`verifyBackupDir` usa `checksumRows` e `Manifest`), T06 (`buildManifest`, `checksumRows`), T07 (`compareManifests` no `verify-integrity.mjs`), T08 (`Manifest.fkEdges`).

### Steps
- [ ] **Step 1: Escrever os testes (RED)** — em `src/test/lib/backupUtils.test.ts`: (a) logo abaixo do import de `queries.mjs`, acrescentar
  ```ts
  import { buildManifest, canonicalJson, checksumRows, compareManifests } from "../../../scripts/backup/lib/manifest.mjs";
  import type { Manifest, TableEntry } from "../../../scripts/backup/lib/manifest.mjs";
  ```
  (b) no fim do arquivo, acrescentar:
  ```ts
  // ---------------------------------------------------------------- T02

  function entrada(name: string, rowCount: number, checksum: string | null = "sha256:aaa", extra: Partial<TableEntry> = {}): TableEntry {
    return {
      name,
      file: `${name}.json.gz`,
      rowCount,
      expectedRowCount: rowCount,
      checksum,
      pkColumns: ["id"],
      columns: [{ name: "id", generated: false }],
      ...extra,
    };
  }

  function manifesto(tables: TableEntry[]): Manifest {
    return buildManifest({
      date: "2026-09-17",
      projectRef: "mdghhjemzdmeuqpzuyzx",
      startedAt: "2026-09-17T06:30:00.000Z",
      finishedAt: "2026-09-17T06:41:00.000Z",
      tables,
      fkEdges: [{ child: "itens", parent: "pedidos" }],
    });
  }

  describe("canonicalJson / checksumRows", () => {
    it("ordena chaves aninhadas, mantém ordem de arrays, omite undefined e mantém null", () => {
      expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null }, e: undefined })).toBe(
        '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
      );
    });

    it("checksum igual para as mesmas linhas com chaves em outra ordem", () => {
      const a = checksumRows([{ id: 1, nome: "x", extra: { p: 1, q: 2 } }]);
      const b = checksumRows([{ extra: { q: 2, p: 1 }, nome: "x", id: 1 }]);
      expect(a).toBe(b);
      expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("checksum muda se um valor ou a ordem das linhas muda", () => {
      const base = checksumRows([{ id: 1 }, { id: 2 }]);
      expect(checksumRows([{ id: 1 }, { id: 3 }])).not.toBe(base);
      expect(checksumRows([{ id: 2 }, { id: 1 }])).not.toBe(base);
    });
  });

  describe("buildManifest", () => {
    it("version 1, tabelas ordenadas por nome e status complete", () => {
      const m = manifesto([entrada("pedidos", 10), entrada("clientes", 5)]);
      expect(m.version).toBe(1);
      expect(m.status).toBe("complete");
      expect(m.tables.map((t) => t.name)).toEqual(["clientes", "pedidos"]);
      expect(m.fkEdges).toEqual([{ child: "itens", parent: "pedidos" }]);
      expect(m.date).toBe("2026-09-17");
    });

    it("status partial se alguma tabela tem error ou checksum null", () => {
      expect(manifesto([entrada("a", 1), entrada("b", 0, null, { error: "[sql] 42P01: relation" })]).status).toBe("partial");
      expect(manifesto([entrada("a", 1), entrada("b", 0, null)]).status).toBe("partial");
    });
  });

  describe("compareManifests (verificação reutilizável)", () => {
    it("manifests idênticos → ok, sem erros nem avisos", () => {
      const m = manifesto([entrada("pedidos", 100), entrada("clientes", 50)]);
      expect(compareManifests(m, m)).toEqual({ ok: true, errors: [], warnings: [] });
    });

    it("diferença de 10% (acima de 5%) → erro", () => {
      const r = compareManifests(manifesto([entrada("pedidos", 100)]), manifesto([entrada("pedidos", 90)]));
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual(["tabela pedidos: base 100, outro 90 (10.0%)"]);
    });

    it("diferença de 2% → aviso e ok", () => {
      const r = compareManifests(manifesto([entrada("pedidos", 100)]), manifesto([entrada("pedidos", 98)]));
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain("tabela pedidos");
    });

    it("tolerância configurável", () => {
      const r = compareManifests(manifesto([entrada("pedidos", 100)]), manifesto([entrada("pedidos", 90)]), { tolerancePct: 20 });
      expect(r.ok).toBe(true);
    });

    it("tabela vazia na base e 1 linha no outro → erro (divide por max(base,1))", () => {
      expect(compareManifests(manifesto([entrada("a", 0)]), manifesto([entrada("a", 1)])).ok).toBe(false);
    });

    it("tabela ausente no outro → erro; tabela só no outro → aviso", () => {
      const r = compareManifests(
        manifesto([entrada("pedidos", 10), entrada("itens", 5)]),
        manifesto([entrada("pedidos", 10), entrada("nova_tabela", 1)]),
      );
      expect(r.ok).toBe(false);
      expect(r.errors).toContain("tabela itens ausente");
      expect(r.warnings).toContain("tabela nova_tabela nova");
    });

    it("mesma contagem e checksums diferentes → aviso; checksum null não compara", () => {
      const r = compareManifests(manifesto([entrada("pedidos", 10, "sha256:aaa")]), manifesto([entrada("pedidos", 10, "sha256:bbb")]));
      expect(r.ok).toBe(true);
      expect(r.warnings).toEqual(["tabela pedidos: mesmo nº de linhas, conteúdo diferente"]);
      const semHash = compareManifests(manifesto([entrada("pedidos", 10)]), manifesto([entrada("pedidos", 10, null)]));
      expect(semHash).toEqual({ ok: true, errors: [], warnings: [] });
    });
  });
  ```
  Esperado: arquivo salvo; `describe` de T01 intactos.

- [ ] **Step 2: Rodar e ver falhar pelo motivo certo**
  ```
  npx vitest run src/test/lib/backupUtils.test.ts
  ```
  Esperado: FAIL da suíte inteira com `Cannot find module '../../../scripts/backup/lib/manifest.mjs'` (o import no topo derruba o arquivo; os testes de T01 voltam no Step 5).

- [ ] **Step 3: Criar `scripts/backup/lib/manifest.d.mts`** (completo):
  ```ts
  export interface FkEdge { child: string; parent: string }
  export interface TableEntry { name: string; file: string; rowCount: number; expectedRowCount: number | null; checksum: string | null; pkColumns: string[]; columns: { name: string; generated: boolean }[]; error?: string }
  export interface Manifest { version: 1; date: string; projectRef: string; startedAt: string; finishedAt: string; status: "complete" | "partial"; tables: TableEntry[]; fkEdges: FkEdge[] }
  export declare function canonicalJson(value: unknown): string;
  export declare function checksumRows(rows: unknown[]): string;
  export declare function buildManifest(input: { date: string; projectRef: string; startedAt: string; finishedAt: string; tables: TableEntry[]; fkEdges: FkEdge[] }): Manifest;
  export interface CompareResult { ok: boolean; errors: string[]; warnings: string[] }
  export declare function compareManifests(base: Manifest, other: Manifest, opts?: { tolerancePct?: number }): CompareResult;
  ```
  Esperado: tipos idênticos aos Contratos.

- [ ] **Step 4: Implementar `scripts/backup/lib/manifest.mjs`** (corpo completo):
  ```js
  /**
   * manifest.mjs — manifest do backup diário, checksum e comparação (T02)
   *
   * O checksum é sobre o JSON canônico (chaves ordenadas), então a mesma tabela
   * extraída duas vezes dá o mesmo hash mesmo se a ordem das chaves mudar.
   */
  import { createHash } from "node:crypto";

  function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value !== null && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value).sort()) {
        if (value[key] !== undefined) out[key] = sortKeys(value[key]);
      }
      return out;
    }
    return value;
  }

  export function canonicalJson(value) {
    return JSON.stringify(sortKeys(value));
  }

  export function checksumRows(rows) {
    return "sha256:" + createHash("sha256").update(canonicalJson(rows)).digest("hex");
  }

  export function buildManifest({ date, projectRef, startedAt, finishedAt, tables, fkEdges }) {
    const sorted = [...tables].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const partial = sorted.some((t) => Boolean(t.error) || t.checksum === null);
    return {
      version: 1,
      date,
      projectRef,
      startedAt,
      finishedAt,
      status: partial ? "partial" : "complete",
      tables: sorted,
      fkEdges: [...fkEdges],
    };
  }

  export function compareManifests(base, other, opts = {}) {
    const tolerancePct = opts.tolerancePct ?? 5;
    const errors = [];
    const warnings = [];
    const otherByName = new Map(other.tables.map((t) => [t.name, t]));
    const baseNames = new Set(base.tables.map((t) => t.name));

    for (const b of base.tables) {
      const o = otherByName.get(b.name);
      if (!o) {
        errors.push(`tabela ${b.name} ausente`);
        continue;
      }
      const diff = Math.abs(o.rowCount - b.rowCount);
      const pct = (diff / Math.max(b.rowCount, 1)) * 100;
      const detail = `tabela ${b.name}: base ${b.rowCount}, outro ${o.rowCount} (${pct.toFixed(1)}%)`;
      if (pct > tolerancePct) errors.push(detail);
      else if (diff > 0) warnings.push(detail);
      else if (b.checksum !== null && o.checksum !== null && b.checksum !== o.checksum) {
        warnings.push(`tabela ${b.name}: mesmo nº de linhas, conteúdo diferente`);
      }
    }
    for (const o of other.tables) {
      if (!baseNames.has(o.name)) warnings.push(`tabela ${o.name} nova`);
    }
    return { ok: errors.length === 0, errors, warnings };
  }
  ```
  Esperado: mensagens exatamente `tabela X ausente`, `tabela X: base N, outro M (P%)`, `tabela X: mesmo nº de linhas, conteúdo diferente`, `tabela X nova`.

- [ ] **Step 5: Rodar o teste e ver passar (GREEN)**
  ```
  npx vitest run src/test/lib/backupUtils.test.ts
  ```
  Esperado: PASS — 48 testes (36 de T01 + 12 de T02; 1 a menos fora do Windows).

- [ ] **Step 6: Refactor/limpeza** — sem `console.log`, sem export extra; `buildManifest` não muta o array recebido (usa cópia). Se mudar algo, repetir o Step 5.
  Esperado: sem alteração de comportamento.

- [ ] **Step 7: Gate iterativo**
  ```
  npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"
  npx vitest run
  ```
  Esperado: ≤ 292; suíte sem falha nova.

### Definição de pronto (DoD)
- [ ] `manifest.mjs` + `manifest.d.mts` criados; novos `describe` verdes; `describe` de T01 continuam verdes.
- [ ] RED (módulo inexistente) visto antes do GREEN.
- [ ] Checksum `sha256:` + 64 hex, estável a ordem de chaves; `status` `partial` com `error` ou checksum null; tolerância default 5% (10% → erro, 2% → aviso).
- [ ] Interfaces = Contratos; gate iterativo ok (tsc ≤ 292, vitest sem falha nova).
- [ ] Sem shadow code; sem IO; sem commit.

---

## T03: Retenção de 30 dias + data de Brasília

| Campo | Valor |
|-------|-------|
| **Entregável** | `brasiliaDate` (data `America/Sao_Paulo`) e `selectExpired` (retenção por nome de pasta, nunca apaga o completo mais recente), cobertos por teste |
| **Onde** | `scripts/backup/lib/retention.mjs` (criar), `scripts/backup/lib/retention.d.mts` (criar), `src/test/lib/backupUtils.test.ts` (modificar: import + novos `describe`) |
| **Depende de** | T02 (mesmo arquivo de teste) |
| **Bloqueia** | T06 |
| **Paralelo com** | T04 |
| **Profundidade** | snippets (corpo completo) — override |
| **Requisitos** | RF-5 (retenção de 30 dias, configurável), RF-7 (pastas `.partial-*` antigas também expiram; backup falho não derruba o último bom); Edge case "datas em horário de Brasília"; US-03 |

### Context pack
- **Spec:** §2 RF-5, RF-7, Edge cases de data (Brasília) e de limpeza (nunca apagar o último backup válido); §4 US-03.
- **Constraints:** ver [Global Constraints](#global-constraints) (datas em Brasília; formato `{AAAA-MM-DD}` e `{AAAA-MM-DD}.partial-{HHmmss}`) e [Contratos entre módulos](#contratos-entre-módulos-interfaces-globais--nomesassinaturas-verbatim) (seção `retention.mjs (T03)`).
- **Padrão do repo:** mesmo de T01/T02; comparação de datas por string como em `src/test/lib/dateUtils.test.ts` (não depende do fuso da máquina).
- **Arquivos vizinhos:** `src/test/lib/backupUtils.test.ts`, `src/test/lib/dateUtils.test.ts` (padrão de teste de data).
- **Não fazer:** não listar/apagar pastas (IO é T07 — `runCleanup`); não usar `new Date(string)` local nem `getDate()` na aritmética (só `Date.UTC`); não importar `src/lib/dateUtils.ts` (script Node fora do bundle); sem commit.

### Interfaces
- **Consumes:** nenhuma em código.
- **Produces** (verbatim dos Contratos):
  ```ts
  export function brasiliaDate(d: Date): string;
  export interface BackupDirEntry { name: string; complete: boolean }
  export function selectExpired(entries: BackupDirEntry[], today: string, retentionDays: number): string[];
  ```
  Consumidores: T06 (`brasiliaDate` para a pasta do dia e `today` da limpeza), T07 (`selectExpired` no `runCleanup`).

### Steps
- [ ] **Step 1: Escrever os testes (RED)** — em `src/test/lib/backupUtils.test.ts`: (a) logo abaixo dos imports de `manifest.mjs`, acrescentar
  ```ts
  import { brasiliaDate, selectExpired } from "../../../scripts/backup/lib/retention.mjs";
  ```
  (b) no fim do arquivo, acrescentar:
  ```ts
  // ---------------------------------------------------------------- T03

  describe("brasiliaDate (pasta do dia em horário de Brasília)", () => {
    it("02:30 UTC ainda é o dia anterior em Brasília (23:30)", () => {
      expect(brasiliaDate(new Date("2026-09-18T02:30:00Z"))).toBe("2026-09-17");
    });

    it("03:30 UTC já é o dia seguinte em Brasília (00:30)", () => {
      expect(brasiliaDate(new Date("2026-09-18T03:30:00Z"))).toBe("2026-09-18");
    });
  });

  describe("selectExpired (retenção de 30 dias)", () => {
    it("expira antes do corte (hoje − 30), ignora nomes estranhos e inclui .partial antigos, em ordem", () => {
      const entries = [
        { name: "2026-09-29", complete: true },
        { name: "2026-08-31", complete: true },
        { name: "logs", complete: false },
        { name: "2026-08-30", complete: true },
        { name: "backup.lock", complete: false },
        { name: "2026-08-01.partial-031500", complete: false },
        { name: "2026-09-29.partial-031500", complete: false },
        { name: "2026-8-1", complete: true },
      ];
      expect(selectExpired(entries, "2026-09-30", 30)).toEqual(["2026-08-01.partial-031500", "2026-08-30"]);
    });

    it("nunca devolve o backup completo mais recente, mesmo expirado", () => {
      const entries = [
        { name: "2026-07-01", complete: true },
        { name: "2026-07-02", complete: true },
        { name: "2026-07-03.partial-031500", complete: false },
        { name: "2026-07-04", complete: false },
      ];
      expect(selectExpired(entries, "2026-09-30", 30)).toEqual(["2026-07-01", "2026-07-03.partial-031500", "2026-07-04"]);
    });

    it("lista vazia → nada a apagar", () => {
      expect(selectExpired([], "2026-09-30", 30)).toEqual([]);
    });
  });
  ```
  Esperado: arquivo salvo; `describe` de T01/T02 intactos.

- [ ] **Step 2: Rodar e ver falhar pelo motivo certo**
  ```
  npx vitest run src/test/lib/backupUtils.test.ts
  ```
  Esperado: FAIL da suíte com `Cannot find module '../../../scripts/backup/lib/retention.mjs'`.

- [ ] **Step 3: Criar `scripts/backup/lib/retention.d.mts`** (completo):
  ```ts
  export declare function brasiliaDate(d: Date): string;
  export interface BackupDirEntry { name: string; complete: boolean }
  export declare function selectExpired(entries: BackupDirEntry[], today: string, retentionDays: number): string[];
  ```
  Esperado: tipos idênticos aos Contratos.

- [ ] **Step 4: Implementar `scripts/backup/lib/retention.mjs`** (corpo completo):
  ```js
  /**
   * retention.mjs — data de Brasília e retenção dos backups (T03)
   *
   * A pasta do dia usa a data de America/Sao_Paulo (não UTC). A retenção só
   * olha nomes AAAA-MM-DD e AAAA-MM-DD.partial-HHmmss e nunca devolve o backup
   * completo mais recente.
   */

  const BRASILIA = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const DAY_NAME = /^\d{4}-\d{2}-\d{2}$/;
  const PARTIAL_NAME = /^(\d{4}-\d{2}-\d{2})\.partial-\d{6}$/;
  const DAY_MS = 86_400_000;

  export function brasiliaDate(d) {
    return BRASILIA.format(d);
  }

  function utcMs(day) {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  }

  export function selectExpired(entries, today, retentionDays) {
    const cutoff = utcMs(today) - retentionDays * DAY_MS;
    let newestComplete = null;
    for (const e of entries) {
      if (e.complete && DAY_NAME.test(e.name) && (newestComplete === null || e.name > newestComplete)) {
        newestComplete = e.name;
      }
    }
    const expired = [];
    for (const e of entries) {
      const day = DAY_NAME.test(e.name) ? e.name : PARTIAL_NAME.exec(e.name)?.[1];
      if (!day || e.name === newestComplete) continue;
      if (utcMs(day) < cutoff) expired.push(e.name);
    }
    return expired.sort();
  }
  ```
  Esperado: `selectExpired([...], "2026-09-30", 30)` usa corte 2026-08-31 (2026-08-30 expira, 2026-08-31 fica).

- [ ] **Step 5: Rodar o teste e ver passar (GREEN)**
  ```
  npx vitest run src/test/lib/backupUtils.test.ts
  ```
  Esperado: PASS — 53 testes (48 anteriores + 5 de T03; 1 a menos fora do Windows).

- [ ] **Step 6: Refactor/limpeza** — `Intl.DateTimeFormat` criado uma vez no módulo; sem export extra. Se mudar algo, repetir o Step 5.
  Esperado: sem alteração de comportamento.

- [ ] **Step 7: Gate iterativo**
  ```
  npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"
  npx vitest run
  ```
  Esperado: ≤ 292; suíte sem falha nova.

### Definição de pronto (DoD)
- [ ] `retention.mjs` + `retention.d.mts` criados; `backupUtils.test.ts` inteiro verde (T01+T02+T03).
- [ ] RED visto antes do GREEN.
- [ ] 23:30 de Brasília (02:30 UTC) cai no dia anterior; nomes fora do padrão ignorados (`logs`, `backup.lock`, `2026-8-1`); `.partial-*` antigos expiram; o `complete` mais recente nunca é devolvido; retorno ordenado.
- [ ] Interfaces = Contratos; gate iterativo ok (tsc ≤ 292, vitest sem falha nova).
- [ ] Sem shadow code; sem IO; sem commit.

---

## T04: Ordem de restauração por FK + SQL de insert + guarda de alvo

| Campo | Valor |
|-------|-------|
| **Entregável** | `topoSortTables` (Kahn, pais antes de filhos, ciclos no fim), `chunkRows`, `buildInsertSql` (dollar-quote com tag aleatória, `session_replication_role = replica`, `on conflict do nothing` padrão) e `assertRestoreTarget` (produção proibida, sem escape), cobertos por teste |
| **Onde** | `scripts/backup/lib/restore.mjs` (criar), `scripts/backup/lib/restore.d.mts` (criar), `src/test/lib/restoreValidation.test.ts` (criar) |
| **Depende de** | — (não importa `config.mjs`: `productionRef` chega por parâmetro) |
| **Bloqueia** | T08 |
| **Paralelo com** | T01, T02, T03 (Onde disjunto) |
| **Profundidade** | snippets (corpo completo) — override |
| **Requisitos** | RF-9 (restauração respeitando a ordem das FKs; tabela a tabela); Restrição "nunca escrever em produção" (restore recusa `PRODUCTION_PROJECT_REF`); Edge case "restauração contra produção proibida"; US-02 |

### Context pack
- **Spec:** §2 RF-9, Restrições (nunca escrever em produção; sem Docker/`psql` — restauração por SQL via `supabase db query`), Edge case de restauração contra produção; §4 US-02.
- **Constraints:** ver [Global Constraints](#global-constraints) (decisão "Restauração": `jsonb_populate_recordset`, colunas geradas excluídas, `set session_replication_role = replica;`, `on conflict do nothing` padrão; 4 auto-referências e 2 FKs para `auth.users` nos fatos medidos) e [Contratos entre módulos](#contratos-entre-módulos-interfaces-globais--nomesassinaturas-verbatim) (seção `restore.mjs (T04)`).
- **Padrão do repo:** mesmo de T01 (`.mjs` + `.d.mts`, teste com `// @vitest-environment node`, import relativo).
- **Arquivos vizinhos:** `scripts/backup/lib/queries.mjs` (T01 — **não** importar; `restore.mjs` tem o próprio helper local `qi`, mesma regra do `quoteIdent`), `scripts/backup/lib/config.mjs` (T01 — **não** importar).
- **Não fazer:** não chamar a CLI nem abrir conexão; não criar flag de escape para produção; não gravar `.sql` em disco (é T08); não mockar `node:crypto` (o teste da tag é por propriedade: a tag escolhida não aparece no JSON); sem commit.

### Interfaces
- **Consumes:** nenhuma (Onde disjunto de T01–T03).
- **Produces** (verbatim dos Contratos):
  ```ts
  export function topoSortTables(tables: string[], fkEdges: { child: string; parent: string }[]): { order: string[]; cycles: string[] };
  export function chunkRows(rows: unknown[], maxBytes: number): unknown[][];
  export function buildInsertSql(table: string, columns: { name: string; generated: boolean }[], rows: unknown[], opts?: { onConflict?: "nothing" | "error" }): string;
  export function assertRestoreTarget(input: { projectRef: string | undefined; confirmProjectRef: string | undefined; productionRef: string }): void;
  ```
  Consumidor: T08 (`runRestore` chama `assertRestoreTarget({ ..., productionRef: PRODUCTION_PROJECT_REF })` antes de qualquer chamada, `topoSortTables(tabelas, manifest.fkEdges)`, `chunkRows(rows, maxChunkBytes ?? 5_000_000)`, `buildInsertSql`).

### Steps
- [ ] **Step 1: Escrever o teste completo (RED)** — criar `src/test/lib/restoreValidation.test.ts` com exatamente:
  ```ts
  // @vitest-environment node
  /**
   * Testes da lógica pura da restauração do backup diário (specs/2026-09-backup-diario, T04).
   * Ordem por FK, lotes, SQL de insert e a guarda que proíbe restaurar em produção.
   * Nenhum teste chama a CLI do Supabase nem a rede. (T08 acrescenta o runRestore com runner mock.)
   */
  import { describe, it, expect } from "vitest";
  import { assertRestoreTarget, buildInsertSql, chunkRows, topoSortTables } from "../../../scripts/backup/lib/restore.mjs";

  const PRODUCAO = "mdghhjemzdmeuqpzuyzx";
  const TESTE = "abcdefghijklmnopqrst";
  const TAG = /\$bk[0-9a-f]{8}\$/;

  describe("topoSortTables (ordem de restauração por FK)", () => {
    it("pai antes de filho", () => {
      const r = topoSortTables(
        ["itens", "pedidos", "clientes", "lojas"],
        [
          { child: "pedidos", parent: "clientes" },
          { child: "itens", parent: "pedidos" },
          { child: "clientes", parent: "lojas" },
        ],
      );
      expect(r).toEqual({ order: ["lojas", "clientes", "pedidos", "itens"], cycles: [] });
    });

    it("empate em ordem alfabética", () => {
      expect(topoSortTables(["c", "a", "b"], []).order).toEqual(["a", "b", "c"]);
      expect(
        topoSortTables(["filho_b", "filho_a", "pai"], [
          { child: "filho_b", parent: "pai" },
          { child: "filho_a", parent: "pai" },
        ]).order,
      ).toEqual(["pai", "filho_a", "filho_b"]);
    });

    it("ignora auto-referência e aresta com tabela fora da lista (ex.: auth.users)", () => {
      const r = topoSortTables(["categorias", "perfis"], [
        { child: "categorias", parent: "categorias" },
        { child: "perfis", parent: "users" },
      ]);
      expect(r).toEqual({ order: ["categorias", "perfis"], cycles: [] });
    });

    it("aresta repetida não trava a ordenação", () => {
      const r = topoSortTables(["a", "b"], [
        { child: "b", parent: "a" },
        { child: "b", parent: "a" },
      ]);
      expect(r).toEqual({ order: ["a", "b"], cycles: [] });
    });

    it("ciclo a↔b vai para cycles e para o fim da ordem", () => {
      const r = topoSortTables(["x", "b", "a"], [
        { child: "a", parent: "b" },
        { child: "b", parent: "a" },
      ]);
      expect(r).toEqual({ order: ["x", "a", "b"], cycles: ["a", "b"] });
    });
  });

  describe("chunkRows (lotes por tamanho)", () => {
    it("respeita o limite em bytes e preserva a ordem", () => {
      const rows = [{ a: 1 }, { a: 2 }, { a: 3 }]; // cada linha = 7 chars; 2 linhas = 17
      expect(chunkRows(rows, 17)).toEqual([[{ a: 1 }, { a: 2 }], [{ a: 3 }]]);
      expect(chunkRows(rows, 16)).toEqual([[{ a: 1 }], [{ a: 2 }], [{ a: 3 }]]);
      expect(chunkRows(rows, 1000)).toEqual([rows]);
    });

    it("linha maior que o limite vira lote próprio; demais lotes cabem no limite", () => {
      const gigante = { s: "x".repeat(100) };
      const chunks = chunkRows([{ a: 1 }, gigante, { a: 2 }, { a: 3 }], 20);
      expect(chunks).toEqual([[{ a: 1 }], [gigante], [{ a: 2 }, { a: 3 }]]);
      for (const c of chunks) {
        if (c.length > 1) expect(JSON.stringify(c).length).toBeLessThanOrEqual(20);
      }
    });

    it("[] → []", () => {
      expect(chunkRows([], 100)).toEqual([]);
    });
  });

  describe("buildInsertSql (SQL de restauração a partir do JSON)", () => {
    const colunas = [
      { name: "id", generated: false },
      { name: "nome", generated: false },
      { name: "total_calc", generated: true },
    ];

    it("gera o SQL exato: replica + insert via jsonb_populate_recordset + on conflict do nothing", () => {
      const rows = [{ id: 1, nome: "Ana", total_calc: 10 }];
      const sql = buildInsertSql("clientes", colunas, rows);
      const tag = sql.match(TAG)?.[0] ?? "";
      expect(tag).not.toBe("");
      expect(sql).toBe(
        "set session_replication_role = replica;\n" +
          'insert into public."clientes" ("id", "nome") select "id", "nome" from jsonb_populate_recordset(null::public."clientes", ' +
          tag +
          JSON.stringify(rows) +
          tag +
          "::jsonb) on conflict do nothing;\n",
      );
    });

    it("onConflict error não põe on conflict", () => {
      const sql = buildInsertSql("clientes", colunas, [{ id: 1, nome: "Ana" }], { onConflict: "error" });
      expect(sql).not.toContain("on conflict");
      expect(sql.endsWith("::jsonb);\n")).toBe(true);
      expect(sql.startsWith("set session_replication_role = replica;\n")).toBe(true);
    });

    it("exclui colunas geradas e cita identificadores com aspas", () => {
      const sql = buildInsertSql('ta"b', [{ name: 'co"l', generated: false }, { name: "g", generated: true }], [{ 'co"l': 1 }]);
      expect(sql).toContain('insert into public."ta""b" ("co""l") select "co""l"');
      expect(sql).not.toContain('"g"');
    });

    it("JSON contendo $bk não quebra o dollar-quote (a tag escolhida não aparece no JSON)", () => {
      const rows = [{ id: 1, nome: "texto com $bk e $bkdeadbeef$ e $$ dentro" }];
      const json = JSON.stringify(rows);
      const sql = buildInsertSql("clientes", colunas, rows);
      const inicio = sql.indexOf("null::public.\"clientes\", ") + 'null::public."clientes", '.length;
      const tag = sql.slice(inicio).match(/^\$bk[0-9a-f]{8}\$/)?.[0] ?? "";
      expect(tag).not.toBe("");
      expect(json.includes(tag)).toBe(false);
      expect(sql).toContain(tag + json + tag + "::jsonb");
    });

    it("recusa rows vazio e tabela só com colunas geradas", () => {
      expect(() => buildInsertSql("clientes", colunas, [])).toThrow();
      expect(() => buildInsertSql("t", [{ name: "g", generated: true }], [{ g: 1 }])).toThrow();
    });
  });

  describe("assertRestoreTarget (restaurar em produção é proibido)", () => {
    it("ref de produção → erro mencionando produção, mesmo confirmado", () => {
      expect(() => assertRestoreTarget({ projectRef: PRODUCAO, confirmProjectRef: PRODUCAO, productionRef: PRODUCAO })).toThrow(
        /produção/,
      );
    });

    it("confirmação diferente → erro", () => {
      expect(() => assertRestoreTarget({ projectRef: TESTE, confirmProjectRef: "outroprojeto00000000", productionRef: PRODUCAO })).toThrow();
      expect(() => assertRestoreTarget({ projectRef: TESTE, confirmProjectRef: undefined, productionRef: PRODUCAO })).toThrow();
    });

    it("ref ausente ou vazio → erro", () => {
      expect(() => assertRestoreTarget({ projectRef: undefined, confirmProjectRef: undefined, productionRef: PRODUCAO })).toThrow();
      expect(() => assertRestoreTarget({ projectRef: "", confirmProjectRef: "", productionRef: PRODUCAO })).toThrow();
    });

    it("projeto de teste confirmado → ok", () => {
      expect(() => assertRestoreTarget({ projectRef: TESTE, confirmProjectRef: TESTE, productionRef: PRODUCAO })).not.toThrow();
    });
  });
  ```
  Esperado: arquivo criado.

- [ ] **Step 2: Rodar e ver falhar pelo motivo certo**
  ```
  npx vitest run src/test/lib/restoreValidation.test.ts
  ```
  Esperado: FAIL da suíte com `Error: Cannot find module '../../../scripts/backup/lib/restore.mjs'` (`Failed to load url ... Does the file exist?`).

- [ ] **Step 3: Criar `scripts/backup/lib/restore.d.mts`** (completo):
  ```ts
  export declare function topoSortTables(tables: string[], fkEdges: { child: string; parent: string }[]): { order: string[]; cycles: string[] };
  export declare function chunkRows(rows: unknown[], maxBytes: number): unknown[][];
  export declare function buildInsertSql(table: string, columns: { name: string; generated: boolean }[], rows: unknown[], opts?: { onConflict?: "nothing" | "error" }): string;
  export declare function assertRestoreTarget(input: { projectRef: string | undefined; confirmProjectRef: string | undefined; productionRef: string }): void;
  ```
  Esperado: tipos idênticos aos Contratos.

- [ ] **Step 4: Implementar `scripts/backup/lib/restore.mjs`** (corpo completo):
  ```js
  /**
   * restore.mjs — lógica pura da restauração do backup diário (T04)
   *
   * Ordem das tabelas pelas FKs (pais antes de filhos), divisão em lotes, SQL de
   * insert a partir do JSON e a guarda que proíbe restaurar em produção.
   * Não importa config.mjs/queries.mjs: o ref de produção chega por parâmetro.
   */
  import { randomBytes } from "node:crypto";

  function qi(name) {
    if (typeof name !== "string" || name.length === 0 || name.includes("\0")) {
      throw new Error(`identificador inválido: ${JSON.stringify(name)}`);
    }
    return `"${name.replace(/"/g, '""')}"`;
  }

  export function topoSortTables(tables, fkEdges) {
    const names = [...new Set(tables)];
    const known = new Set(names);
    const indegree = new Map(names.map((t) => [t, 0]));
    const children = new Map(names.map((t) => [t, new Set()]));
    for (const { child, parent } of fkEdges) {
      if (child === parent || !known.has(child) || !known.has(parent)) continue;
      if (children.get(parent).has(child)) continue;
      children.get(parent).add(child);
      indegree.set(child, indegree.get(child) + 1);
    }
    const ready = names.filter((t) => indegree.get(t) === 0).sort();
    const order = [];
    while (ready.length > 0) {
      const t = ready.shift();
      order.push(t);
      for (const c of children.get(t)) {
        indegree.set(c, indegree.get(c) - 1);
        if (indegree.get(c) === 0) {
          ready.push(c);
          ready.sort();
        }
      }
    }
    const placed = new Set(order);
    const cycles = names.filter((t) => !placed.has(t)).sort();
    return { order: [...order, ...cycles], cycles };
  }

  export function chunkRows(rows, maxBytes) {
    const chunks = [];
    let current = [];
    let size = 2; // "[]"
    for (const row of rows) {
      const rowSize = JSON.stringify(row).length;
      if (current.length > 0 && size + 1 + rowSize > maxBytes) {
        chunks.push(current);
        current = [];
        size = 2;
      }
      size += current.length === 0 ? rowSize : rowSize + 1;
      current.push(row);
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }

  export function buildInsertSql(table, columns, rows, opts = {}) {
    const cols = columns.filter((c) => !c.generated).map((c) => qi(c.name));
    if (cols.length === 0) throw new Error(`tabela ${table} sem colunas restauráveis`);
    if (rows.length === 0) throw new Error(`tabela ${table} sem linhas para restaurar`);
    const json = JSON.stringify(rows);
    let tag;
    do {
      tag = "$bk" + randomBytes(4).toString("hex") + "$";
    } while (json.includes(tag));
    const target = `public.${qi(table)}`;
    const list = cols.join(", ");
    return (
      "set session_replication_role = replica;\n" +
      `insert into ${target} (${list}) select ${list} from jsonb_populate_recordset(null::${target}, ${tag}${json}${tag}::jsonb)` +
      (opts.onConflict === "error" ? "" : " on conflict do nothing") +
      ";\n"
    );
  }

  export function assertRestoreTarget({ projectRef, confirmProjectRef, productionRef }) {
    if (!projectRef) throw new Error("--project-ref é obrigatório para --apply");
    if (confirmProjectRef !== projectRef) {
      throw new Error("--confirm-project-ref precisa ser igual a --project-ref");
    }
    if (projectRef === productionRef) {
      throw new Error("restaurar no projeto de produção é proibido — use um projeto Supabase separado");
    }
  }
  ```
  Esperado: `buildInsertSql` devolve exatamente o formato do Contrato; `assertRestoreTarget` checa ausente → confirmação → produção, nesta ordem.

- [ ] **Step 5: Rodar o teste e ver passar (GREEN)**
  ```
  npx vitest run src/test/lib/restoreValidation.test.ts
  ```
  Esperado: PASS — 17 testes.

- [ ] **Step 6: Refactor/limpeza** — `qi` idêntico em regra ao `quoteIdent` (aspas dobradas, recusa vazio/`\0`); sem export extra; sem `console.log`. Se mudar algo, repetir o Step 5.
  Esperado: sem alteração de comportamento.

- [ ] **Step 7: Gate iterativo**
  ```
  npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"
  npx vitest run
  ```
  Esperado: ≤ 292; suíte sem falha nova.

### Definição de pronto (DoD)
- [ ] `restore.mjs` + `restore.d.mts` criados; `restoreValidation.test.ts` criado e verde.
- [ ] RED (módulo inexistente) visto antes do GREEN.
- [ ] Pais antes de filhos, empate alfabético, auto-aresta e aresta para fora (ex.: `auth.users`) ignoradas, ciclo em `cycles` e no fim de `order`.
- [ ] SQL começa com `set session_replication_role = replica;`, exclui colunas geradas, `on conflict do nothing` por padrão e ausente com `"error"`; tag `$bk{8 hex}$` nunca contida no JSON.
- [ ] Produção recusada com mensagem contendo "produção", sem flag de escape; confirmação obrigatória e igual.
- [ ] Interfaces = Contratos; `restore.mjs` não importa `config.mjs` nem `queries.mjs`; gate iterativo ok (tsc ≤ 292, vitest sem falha nova).
- [ ] Sem shadow code; sem IO; sem commit.

---

## T05: Runner da CLI + arquivos gz/log/verificação

| Campo | Valor |
|-------|-------|
| **Entregável** | `createCliRunner` (SQL por arquivo `-f`, saída JSON lida por `parseCliOutput`, erro classificado sem vazar stderr cru, `readOnly` barrando escrita antes de qualquer processo) e `writeTableGz` / `readTableGz` / `appendLog` / `verifyBackupDir`, cobertos por teste com uma **CLI falsa** gravada no tmp |
| **Onde** | `scripts/backup/lib/cli.mjs` (criar), `scripts/backup/lib/cli.d.mts` (criar), `scripts/backup/lib/files.mjs` (criar), `scripts/backup/lib/files.d.mts` (criar), `src/test/lib/backupIntegration.test.ts` (criar) |
| **Depende de** | T01 (`assertReadOnlySql`, `parseCliOutput`, `classifyCliError`, `CliOutputError`), T02 (`checksumRows`, `Manifest`) |
| **Bloqueia** | T06 (mesmo arquivo de teste + `createCliRunner`/`files`), T08 (`createCliRunner`, `readTableGz`, `verifyBackupDir`, `writeTableGz` na fixture) |
| **Paralelo com** | T03, T04 (Onde disjunto) |
| **Profundidade** | snippets (corpo completo) — override; teste completo |
| **Requisitos** | RF-4 (compactação: gzip por tabela `tables/<t>.json.gz`), RF-6 (log com data/hora e nível, uma linha por evento), RF-8 (verificação reutilizável: reabre cada `.json.gz` e confere contagem + checksum), Restrições "backup só leitura" (`readOnly`), "sem credencial / não logar stderr cru da CLI", "sem Docker/`pg_dump`/`psql`" (`supabase db query`); Edge cases "arquivo corrompido → verificação reabre e confere antes de promover", "token expirado → `auth`", "rede → `network`"; US-01, US-02 |

### Context pack
- **Spec:** §2 RF-4, RF-6, RF-8, Restrições (só leitura; sem credencial; sem Docker), Edge cases de arquivo corrompido e de login/rede; §4 US-01, US-02.
- **Constraints:** ver [Global Constraints](#global-constraints) (decisões "Formato em disco", "Logs", "CLI") e [Contratos entre módulos](#contratos-entre-módulos-interfaces-globais--nomesassinaturas-verbatim) (seções `cli.mjs (T05)` e `files.mjs (T05)` — vencem este bloco).
- **Padrão do repo:** módulo Node 22 ESM como `scripts/check.mjs` (JSDoc em português no topo, imports `node:*`, aspas duplas, ponto-e-vírgula, sem dependência nova; `shell` no spawn porque no Windows o `npx` é `.cmd` — ver o comentário do `check.mjs` sobre o espaço em "ERPOS V2 - claude": por isso todo caminho vai **entre aspas** na linha de comando). Teste como `src/test/edge/fcm.test.ts`: `// @vitest-environment node` na 1ª linha; pastas temporárias com `mkdtempSync(join(tmpdir(), "erpos-bk-"))` e limpeza em `afterEach`.
- **Arquivos vizinhos:** `scripts/backup/lib/queries.mjs` (T01), `scripts/backup/lib/manifest.mjs` (T02), `scripts/check.mjs` (spawn/shell), `src/test/edge/fcm.test.ts` (teste Node).
- **Não fazer:** não chamar a CLI real do Supabase nem a rede em teste (só a CLI falsa que o próprio teste grava no tmp); não logar/devolver stderr cru nem linha com `PGPASSWORD`/`password`/`token`; não usar `execSync` com SQL na linha de comando (SQL vai por arquivo `-f`); não criar `runBackup.mjs` (é T06); não mexer em `backupUtils.test.ts`/`restoreValidation.test.ts`; sem commit.

### Interfaces
- **Consumes** (verbatim dos Contratos):
  ```ts
  // queries.mjs (T01)
  export function assertReadOnlySql(sql: string): void;
  export class CliOutputError extends Error { kind: "auth" | "network" | "sql" | "unknown"; constructor(message: string, kind: "auth" | "network" | "sql" | "unknown") }
  export function classifyCliError(text: string): "auth" | "network" | "sql" | "unknown";
  export function parseCliOutput(stdout: string): Record<string, unknown>[];
  // manifest.mjs (T02)
  export interface Manifest { version: 1; date: string; projectRef: string; startedAt: string; finishedAt: string; status: "complete" | "partial"; tables: TableEntry[]; fkEdges: FkEdge[] }
  export function checksumRows(rows: unknown[]): string;
  ```
- **Produces** (verbatim dos Contratos):
  ```ts
  // cli.mjs
  export type QueryRunner = (sql: string) => Promise<Record<string, unknown>[]>;
  export function createCliRunner(opts: { projectRef: string; supabaseCli?: string; readOnly: boolean; tmpDir?: string }): QueryRunner;
  // files.mjs
  export function writeTableGz(path: string, rows: unknown[]): Promise<number>;
  export function readTableGz(path: string): Promise<unknown[]>;
  export function appendLog(logFile: string, level: "INFO" | "WARN" | "ERROR", message: string): void;
  export function verifyBackupDir(dir: string): Promise<{ ok: boolean; errors: string[]; manifest: Manifest | null }>;
  ```
  Precisões (não mudam assinatura): `createCliRunner` valida `projectRef` com `/^[a-z0-9]{20}$/` (`throw new Error("project ref inválido")`) porque ele entra na linha de comando; o `spawn` usa `shell: true` em todas as plataformas (o `supabaseCli` é uma string de comando, ex. `npx supabase` ou `"C:\...\node.exe" "C:\...\fake-cli.mjs"`); exit 0 com saída ilegível → o `CliOutputError` do próprio `parseCliOutput`; exit ≠ 0 com JSON de erro → o `CliOutputError` classificado do `parseCliOutput`; exit ≠ 0 com saída ilegível → `CliOutputError(mensagem limpa ≤ 300, classifyCliError(stdout + stderr))`; estouro de 256 MB → `unknown`; timeout de 10 min → `network`. `appendLog` troca quebras de linha da mensagem por espaço (uma linha por evento). Mensagens de `verifyBackupDir`: `manifest.json ausente ou inválido em <dir>`, `tabela X: arquivo X.json.gz ausente ou corrompido`, `tabela X: manifest N linhas, arquivo M`, `tabela X: checksum diferente do manifest`.
  Consumidores: T06 (`createCliRunner` na entrada; `writeTableGz`, `verifyBackupDir`, `appendLog` no `runBackup`), T07 (`appendLog` no `runCleanup`, `verifyBackupDir` e `createCliRunner` no `verify-integrity.mjs`), T08 (`createCliRunner` readOnly:false, `readTableGz`, `verifyBackupDir`; `writeTableGz` na fixture do teste).

### Steps
- [ ] **Step 1: Escrever o teste completo** (IO — `tdd_integracao: fora`, mas escrito antes para ver o RED) — criar `src/test/lib/backupIntegration.test.ts` com exatamente:
  ```ts
  // @vitest-environment node
  /**
   * Testes de IO do backup diário (specs/2026-09-backup-diario) com pasta temporária.
   * T05: runner da CLI (contra uma CLI FALSA gravada no tmp) + arquivos .json.gz, log e verificação.
   * T06 e T07 acrescentam describes neste arquivo (runBackup, entradas, limpeza, verificação).
   * Nenhum teste chama a CLI real do Supabase nem a rede.
   */
  import { describe, it, expect, afterEach } from "vitest";
  import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { createCliRunner } from "../../../scripts/backup/lib/cli.mjs";
  import { appendLog, readTableGz, verifyBackupDir, writeTableGz } from "../../../scripts/backup/lib/files.mjs";
  import { buildManifest, checksumRows } from "../../../scripts/backup/lib/manifest.mjs";
  import type { Manifest, TableEntry } from "../../../scripts/backup/lib/manifest.mjs";
  import { CliOutputError } from "../../../scripts/backup/lib/queries.mjs";

  const REF_TESTE = "abcdefghijklmnopqrst";
  const pastas: string[] = [];

  function novaPasta(): string {
    const dir = mkdtempSync(join(tmpdir(), "erpos-bk-"));
    pastas.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of pastas.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  interface TabelaFalsa {
    pk: string[];
    linhas: Record<string, unknown>[];
    contagem?: number;
  }
  interface DadosFalsos {
    tabelas: Record<string, TabelaFalsa>;
    fks?: { child: string; parent: string }[];
    falhaTabela?: string;
  }

  /**
   * Grava no tmp uma CLI FALSA (`fake-cli.mjs`) que imita `supabase db query ... -f arquivo.sql`:
   * lê o SQL do arquivo, anota a chamada em `chamadas.log` (mesma pasta), escreve
   * "Initialising login role..." no stderr e responde JSON {boundary, rows, warning} conforme o SQL
   * (catálogo, contagens, FKs, páginas limit/offset). `falhaTabela` ou SQL com "erro_sql" → erro
   * JSON da CLI com exit 1; SQL com "quebra_feia" → saída não-JSON, exit 1 e PGPASSWORD no stderr.
   * Devolve o comando para `supabaseCli` / `ERPOS_SUPABASE_CLI`.
   */
  function escreverCliFalsa(dir: string, dados: DadosFalsos = { tabelas: {} }): string {
    const script = String.raw`
  import { appendFileSync, readFileSync } from "node:fs";
  import { dirname, join } from "node:path";
  import { fileURLToPath } from "node:url";
  const DADOS = __DADOS__;
  const args = process.argv.slice(2);
  const iF = args.indexOf("-f");
  const sql = readFileSync(args[iF + 1], "utf8");
  appendFileSync(join(dirname(fileURLToPath(import.meta.url)), "chamadas.log"), sql + "\n---\n");
  process.stderr.write("Initialising login role...\n");
  const ok = (rows) => process.stdout.write(JSON.stringify({ boundary: "x", rows, warning: "dados não confiáveis" }));
  const nomes = Object.keys(DADOS.tabelas).sort();
  const pagina = /from public\."([^"]+)"/.exec(sql)?.[1];
  if (sql.includes("quebra_feia")) {
    process.stderr.write("PGPASSWORD=segredo\nconnect ECONNRESET 10.0.0.1:443\n");
    process.stdout.write("isto não é json");
    process.exit(1);
  }
  if ((pagina && pagina === DADOS.falhaTabela) || sql.includes("erro_sql")) {
    process.stderr.write("PGPASSWORD=segredo\n");
    const message = "unexpected status 400: ERROR:  42P01: relation " + (pagina ?? "erro_sql") + " does not exist";
    process.stdout.write(JSON.stringify({ _tag: "Error", error: { code: "LegacyDbQueryUnexpectedStatusError", message } }));
    process.exit(1);
  }
  if (sql.includes("query_to_xml")) {
    ok(nomes.map((n) => ({ table_name: n, row_count: String(DADOS.tabelas[n].contagem ?? DADOS.tabelas[n].linhas.length) })));
  } else if (sql.includes("contype = 'f'")) {
    ok(DADOS.fks ?? []);
  } else if (sql.includes("pk_columns")) {
    ok(nomes.map((n) => ({
      table_name: n,
      pk_columns: DADOS.tabelas[n].pk,
      columns: Object.keys(DADOS.tabelas[n].linhas[0] ?? { id: 0 }).map((c) => ({ name: c, generated: false })),
    })));
  } else if (pagina) {
    const m = /limit (\d+) offset (\d+)/.exec(sql);
    ok((DADOS.tabelas[pagina]?.linhas ?? []).slice(Number(m[2]), Number(m[2]) + Number(m[1])));
  } else {
    ok([{ sql, args: args.filter((_, i) => i !== iF + 1) }]);
  }
  `.replace("__DADOS__", JSON.stringify(dados));
    const file = join(dir, "fake-cli.mjs");
    writeFileSync(file, script, "utf8");
    return `"${process.execPath}" "${file}"`;
  }

  /** Quantas vezes a CLI falsa gravada em `dir` foi chamada. */
  function chamadasDaCli(dir: string): number {
    const log = join(dir, "chamadas.log");
    return existsSync(log) ? readFileSync(log, "utf8").split("\n---\n").filter(Boolean).length : 0;
  }

  function capturarAsync(p: Promise<unknown>): Promise<CliOutputError> {
    return p.then(
      () => {
        throw new Error("não lançou");
      },
      (e) => e as CliOutputError,
    );
  }

  describe("createCliRunner (CLI falsa, nunca a real)", () => {
    it("manda o SQL por arquivo -f com os argumentos do contrato e apaga o temporário", async () => {
      const dir = novaPasta();
      const sqlTmp = novaPasta();
      const runner = createCliRunner({ projectRef: REF_TESTE, supabaseCli: escreverCliFalsa(dir), readOnly: true, tmpDir: sqlTmp });
      const rows = await runner("select 'eco' as x");
      expect(rows).toEqual([
        {
          sql: "select 'eco' as x",
          args: ["db", "query", "--linked", "--project-ref", REF_TESTE, "--agent", "yes", "-f"],
        },
      ]);
      expect(readdirSync(sqlTmp)).toEqual([]);
      expect(chamadasDaCli(dir)).toBe(1);
    }, 30_000);

    it("readOnly recusa escrita ANTES de criar arquivo ou chamar a CLI", async () => {
      const dir = novaPasta();
      const sqlTmp = novaPasta();
      const runner = createCliRunner({ projectRef: REF_TESTE, supabaseCli: escreverCliFalsa(dir), readOnly: true, tmpDir: sqlTmp });
      await expect(runner("delete from x")).rejects.toThrow("SQL não é só-leitura");
      expect(readdirSync(sqlTmp)).toEqual([]);
      expect(chamadasDaCli(dir)).toBe(0);
    });

    it("readOnly false deixa passar insert (uso da restauração)", async () => {
      const dir = novaPasta();
      const runner = createCliRunner({ projectRef: REF_TESTE, supabaseCli: escreverCliFalsa(dir), readOnly: false });
      const rows = await runner("insert into x values (1)");
      expect(rows[0]).toMatchObject({ sql: "insert into x values (1)" });
    }, 30_000);

    it("erro JSON da CLI (42P01) vira CliOutputError sql, sem PGPASSWORD na mensagem", async () => {
      const dir = novaPasta();
      const runner = createCliRunner({ projectRef: REF_TESTE, supabaseCli: escreverCliFalsa(dir), readOnly: true });
      const err = await capturarAsync(runner("select * from erro_sql"));
      expect(err).toBeInstanceOf(CliOutputError);
      expect(err.kind).toBe("sql");
      expect(err.message).toContain("42P01");
      expect(err.message).not.toMatch(/PGPASSWORD|segredo/);
    }, 30_000);

    it("saída não-JSON com exit 1 → erro classificado pelo texto, truncado e sem linha de senha", async () => {
      const dir = novaPasta();
      const runner = createCliRunner({ projectRef: REF_TESTE, supabaseCli: escreverCliFalsa(dir), readOnly: true });
      const err = await capturarAsync(runner("select 'quebra_feia'"));
      expect(err).toBeInstanceOf(CliOutputError);
      expect(err.kind).toBe("network");
      expect(err.message).toContain("ECONNRESET");
      expect(err.message).not.toMatch(/PGPASSWORD|segredo/);
      expect(err.message.length).toBeLessThanOrEqual(300);
    }, 30_000);

    it("recusa project ref inválido (ele vai para a linha de comando)", () => {
      expect(() => createCliRunner({ projectRef: "x & del *", readOnly: true })).toThrow("project ref inválido");
    });
  });

  // ---------------------------------------------------------------- arquivos

  function entradaDe(name: string, rows: unknown[], extra: Partial<TableEntry> = {}): TableEntry {
    return {
      name,
      file: `${name}.json.gz`,
      rowCount: rows.length,
      expectedRowCount: rows.length,
      checksum: checksumRows(rows),
      pkColumns: ["id"],
      columns: [{ name: "id", generated: false }],
      ...extra,
    };
  }

  async function montarBackup(dir: string, tabelas: Record<string, unknown[]>, extras: TableEntry[] = []): Promise<Manifest> {
    const entries: TableEntry[] = [];
    for (const [name, rows] of Object.entries(tabelas)) {
      await writeTableGz(join(dir, "tables", `${name}.json.gz`), rows);
      entries.push(entradaDe(name, rows));
    }
    const manifest = buildManifest({
      date: "2026-09-18",
      projectRef: REF_TESTE,
      startedAt: "2026-09-18T06:30:00.000Z",
      finishedAt: "2026-09-18T06:31:00.000Z",
      tables: [...entries, ...extras],
      fkEdges: [],
    });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  describe("writeTableGz / readTableGz / appendLog", () => {
    it("grava gzip criando a pasta e lê de volta as mesmas linhas", async () => {
      const dir = novaPasta();
      const file = join(dir, "sub", "tables", "clientes.json.gz");
      const rows = [{ id: 1, nome: "Ana ção" }, { id: 2, nome: null }];
      const bytes = await writeTableGz(file, rows);
      expect(bytes).toBe(readFileSync(file).length);
      expect([...readFileSync(file).subarray(0, 2)]).toEqual([0x1f, 0x8b]);
      expect(await readTableGz(file)).toEqual(rows);
    });

    it("readTableGz rejeita arquivo que não é gzip", async () => {
      const dir = novaPasta();
      const file = join(dir, "lixo.json.gz");
      writeFileSync(file, "isto não é gzip");
      await expect(readTableGz(file)).rejects.toThrow();
    });

    it("appendLog cria a pasta e grava uma linha por evento: ISO | NÍVEL | mensagem", () => {
      const dir = novaPasta();
      const log = join(dir, "logs", "backup.log");
      appendLog(log, "INFO", "primeira");
      appendLog(log, "ERROR", "segunda\ncom quebra");
      const linhas = readFileSync(log, "utf8").trimEnd().split("\n");
      expect(linhas).toHaveLength(2);
      expect(linhas[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \| INFO \| primeira$/);
      expect(linhas[1]).toMatch(/ \| ERROR \| segunda com quebra$/);
    });
  });

  describe("verifyBackupDir (reabre cada .json.gz antes de promover/restaurar)", () => {
    it("backup íntegro → ok com o manifest; tabela com error é pulada", async () => {
      const dir = novaPasta();
      const falhou = entradaDe("pedidos", [], { checksum: null, error: "[sql] 42P01" });
      await montarBackup(dir, { clientes: [{ id: 1 }, { id: 2 }], vazia: [] }, [falhou]);
      const r = await verifyBackupDir(dir);
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
      expect(r.manifest?.tables.map((t) => t.name)).toEqual(["clientes", "pedidos", "vazia"]);
    });

    it("arquivo corrompido → erro citando a tabela", async () => {
      const dir = novaPasta();
      await montarBackup(dir, { clientes: [{ id: 1 }] });
      writeFileSync(join(dir, "tables", "clientes.json.gz"), "lixo");
      const r = await verifyBackupDir(dir);
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual(["tabela clientes: arquivo clientes.json.gz ausente ou corrompido"]);
    });

    it("linha alterada (mesma contagem) → checksum diferente", async () => {
      const dir = novaPasta();
      await montarBackup(dir, { clientes: [{ id: 1 }, { id: 2 }] });
      await writeTableGz(join(dir, "tables", "clientes.json.gz"), [{ id: 1 }, { id: 3 }]);
      const r = await verifyBackupDir(dir);
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual(["tabela clientes: checksum diferente do manifest"]);
    });

    it("linha faltando → contagem diferente", async () => {
      const dir = novaPasta();
      await montarBackup(dir, { clientes: [{ id: 1 }, { id: 2 }] });
      await writeTableGz(join(dir, "tables", "clientes.json.gz"), [{ id: 1 }]);
      expect((await verifyBackupDir(dir)).errors).toEqual(["tabela clientes: manifest 2 linhas, arquivo 1"]);
    });

    it("sem manifest.json (ou inválido) → ok false e manifest null", async () => {
      const dir = novaPasta();
      expect(await verifyBackupDir(dir)).toMatchObject({ ok: false, manifest: null });
      writeFileSync(join(dir, "manifest.json"), "{ quebrado");
      expect(await verifyBackupDir(dir)).toMatchObject({ ok: false, manifest: null });
    });
  });
  ```
  Esperado: arquivo criado. A CLI falsa é um `.mjs` gravado pelo próprio teste no tmp e chamado com `process.execPath` — nenhum teste chama `npx supabase`.

- [ ] **Step 2: Rodar e ver falhar pelo motivo certo**
  ```
  npx vitest run src/test/lib/backupIntegration.test.ts
  ```
  Esperado: FAIL da suíte com `Cannot find module '../../../scripts/backup/lib/cli.mjs'` (ou `Failed to load url ... Does the file exist?`).

- [ ] **Step 3: Criar os `.d.mts` completos** — `scripts/backup/lib/cli.d.mts`:
  ```ts
  export type QueryRunner = (sql: string) => Promise<Record<string, unknown>[]>;
  export declare function createCliRunner(opts: { projectRef: string; supabaseCli?: string; readOnly: boolean; tmpDir?: string }): QueryRunner;
  ```
  e `scripts/backup/lib/files.d.mts`:
  ```ts
  import type { Manifest } from "./manifest.mjs";
  export declare function writeTableGz(path: string, rows: unknown[]): Promise<number>;
  export declare function readTableGz(path: string): Promise<unknown[]>;
  export declare function appendLog(logFile: string, level: "INFO" | "WARN" | "ERROR", message: string): void;
  export declare function verifyBackupDir(dir: string): Promise<{ ok: boolean; errors: string[]; manifest: Manifest | null }>;
  ```
  Esperado: tipos idênticos aos Contratos.

- [ ] **Step 4: Implementar `scripts/backup/lib/cli.mjs`** (corpo completo):
  ```js
  /**
   * cli.mjs — executa SQL pela CLI do Supabase (`supabase db query`) (T05)
   *
   * O SQL vai por arquivo temporário (-f) para não esbarrar em limite/escape de
   * linha de comando no Windows. A saída JSON é lida por parseCliOutput. Em erro,
   * a mensagem é truncada e sem linhas com senha/token; o stderr cru da CLI nunca
   * é logado nem devolvido. Com readOnly, todo SQL passa por assertReadOnlySql
   * ANTES de qualquer arquivo ou processo.
   */
  import { spawn } from "node:child_process";
  import { mkdtemp, rm, writeFile } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { CliOutputError, assertReadOnlySql, classifyCliError, parseCliOutput } from "./queries.mjs";

  const MAX_BUFFER = 256 * 1024 * 1024;
  const TIMEOUT_MS = 10 * 60 * 1000;
  const SECRET_LINE = /PGPASSWORD|password|token/i;

  function safeMessage(text) {
    return String(text)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !SECRET_LINE.test(l))
      .join(" | ")
      .slice(0, 300);
  }

  function exec(command) {
    return new Promise((resolvePromise, reject) => {
      // shell: o comando da CLI é uma string ("npx supabase", `node "C:\x y\cli.mjs"`),
      // e no Windows o npx é um .cmd. Caminhos vão entre aspas (a pasta do repo tem espaço).
      const child = spawn(command, { shell: true, windowsHide: true, timeout: TIMEOUT_MS });
      const out = [];
      const err = [];
      let size = 0;
      let overflow = false;
      const collect = (bucket) => (chunk) => {
        size += chunk.length;
        if (size > MAX_BUFFER) {
          overflow = true;
          child.kill();
          return;
        }
        bucket.push(chunk);
      };
      child.stdout.on("data", collect(out));
      child.stderr.on("data", collect(err));
      child.on("error", (e) => reject(new CliOutputError(`falha ao iniciar a CLI (${e.code ?? "erro"})`, "unknown")));
      child.on("close", (code, signal) =>
        resolvePromise({
          code: code ?? 1,
          signal,
          overflow,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
        }),
      );
    });
  }

  export function createCliRunner({ projectRef, supabaseCli, readOnly, tmpDir }) {
    if (!/^[a-z0-9]{20}$/.test(String(projectRef))) throw new Error("project ref inválido");
    const cli = supabaseCli ?? "npx supabase";

    return async function runQuery(sql) {
      if (readOnly) assertReadOnlySql(sql);
      const dir = await mkdtemp(join(tmpDir ?? tmpdir(), "erpos-sql-"));
      try {
        const file = join(dir, "query.sql");
        await writeFile(file, sql, "utf8");
        const r = await exec(`${cli} db query --linked --project-ref ${projectRef} --agent yes -f "${file}"`);
        if (r.overflow) throw new CliOutputError("saída da CLI acima de 256 MB", "unknown");
        if (r.signal) throw new CliOutputError(`CLI interrompida (${r.signal}) — timeout de 10 min?`, "network");
        let rows;
        try {
          rows = parseCliOutput(r.stdout);
        } catch (e) {
          const unreadable = e instanceof CliOutputError && e.kind === "unknown" && e.message.startsWith("saída ");
          if (r.code === 0 || !unreadable) throw e;
          const raw = `${r.stdout}\n${r.stderr}`;
          const msg = safeMessage(`CLI saiu com código ${r.code}\n${raw}`);
          throw new CliOutputError(msg, classifyCliError(raw));
        }
        if (r.code !== 0) throw new CliOutputError(`CLI saiu com código ${r.code}`, "unknown");
        return rows;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    };
  }
  ```
  Esperado: `readOnly` roda `assertReadOnlySql` antes do `mkdtemp` (nenhum arquivo/processo para SQL de escrita); o temporário é removido no `finally`; stderr nunca volta cru.

- [ ] **Step 5: Implementar `scripts/backup/lib/files.mjs`** (corpo completo):
  ```js
  /**
   * files.mjs — arquivos do backup diário: tabela em .json.gz, log e verificação (T05)
   *
   * Formato: {pasta}/manifest.json + {pasta}/tables/{tabela}.json.gz (gzip do JSON
   * das linhas). verifyBackupDir reabre cada .json.gz e confere contagem e checksum
   * contra o manifest — é o que decide se um backup pode ser promovido/restaurado.
   */
  import { appendFileSync, mkdirSync } from "node:fs";
  import { mkdir, readFile, writeFile } from "node:fs/promises";
  import { dirname, join } from "node:path";
  import { promisify } from "node:util";
  import { gunzip as gunzipCb, gzip as gzipCb } from "node:zlib";
  import { checksumRows } from "./manifest.mjs";

  const gzip = promisify(gzipCb);
  const gunzip = promisify(gunzipCb);

  export async function writeTableGz(path, rows) {
    await mkdir(dirname(path), { recursive: true });
    const data = await gzip(Buffer.from(JSON.stringify(rows), "utf8"));
    await writeFile(path, data);
    return data.length;
  }

  export async function readTableGz(path) {
    const raw = await gunzip(await readFile(path));
    const rows = JSON.parse(raw.toString("utf8"));
    if (!Array.isArray(rows)) throw new Error(`conteúdo não é uma lista: ${path}`);
    return rows;
  }

  export function appendLog(logFile, level, message) {
    mkdirSync(dirname(logFile), { recursive: true });
    const oneLine = String(message).replace(/\r?\n/g, " ");
    appendFileSync(logFile, `${new Date().toISOString()} | ${level} | ${oneLine}\n`, "utf8");
  }

  export async function verifyBackupDir(dir) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    } catch {
      return { ok: false, errors: [`manifest.json ausente ou inválido em ${dir}`], manifest: null };
    }
    if (!manifest || !Array.isArray(manifest.tables)) {
      return { ok: false, errors: [`manifest.json sem lista de tabelas em ${dir}`], manifest: null };
    }
    const errors = [];
    for (const t of manifest.tables) {
      if (t.error) continue;
      let rows;
      try {
        rows = await readTableGz(join(dir, "tables", t.file));
      } catch {
        errors.push(`tabela ${t.name}: arquivo ${t.file} ausente ou corrompido`);
        continue;
      }
      if (rows.length !== t.rowCount) {
        errors.push(`tabela ${t.name}: manifest ${t.rowCount} linhas, arquivo ${rows.length}`);
      } else if (checksumRows(rows) !== t.checksum) {
        errors.push(`tabela ${t.name}: checksum diferente do manifest`);
      }
    }
    return { ok: errors.length === 0, errors, manifest };
  }
  ```
  Esperado: `.json.gz` começa com os bytes gzip `1f 8b`; `verifyBackupDir` pula tabelas com `error` e reabre as demais.

- [ ] **Step 6: Rodar o teste e ver passar**
  ```
  npx vitest run src/test/lib/backupIntegration.test.ts
  ```
  Esperado: PASS — 14 testes (6 do runner com CLI falsa + 3 de arquivos/log + 5 de `verifyBackupDir`).

- [ ] **Step 7: Refactor/limpeza** — sem `console.log` nos módulos, sem export fora do Contrato, nenhum trecho que imprima stderr. Se mudar algo, repetir o Step 6.
  Esperado: sem alteração de comportamento.

- [ ] **Step 8: Gate iterativo**
  ```
  npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"
  npx vitest run
  ```
  Esperado: ≤ 292; suíte sem falha nova.

### Definição de pronto (DoD)
- [ ] `cli.mjs`, `cli.d.mts`, `files.mjs`, `files.d.mts` criados; `backupIntegration.test.ts` criado e verde (14).
- [ ] Nenhum teste chama a CLI real nem a rede (só `fake-cli.mjs` no tmp); `readOnly` recusa `delete from x` sem criar arquivo nem processo; mensagens de erro sem `PGPASSWORD`/`segredo`.
- [ ] `verifyBackupDir` acusa arquivo corrompido, linha alterada (checksum) e linha faltando (contagem).
- [ ] Interfaces = Contratos; gate iterativo ok (tsc ≤ 292, vitest sem falha nova).
- [ ] Sem shadow code (sem segundo parser de saída da CLI — usa `parseCliOutput`; sem segundo checksum — usa `checksumRows`); nenhuma credencial; sem commit.

---

## T06: `runBackup` + entrada `backup-diario.mjs` (thin slice)

| Campo | Valor |
|-------|-------|
| **Entregável** | `runBackup` (lock, disco livre, pasta do dia em Brasília, catálogo dinâmico, extração **sequencial e paginada**, manifest, verificação, promoção atômica) e a entrada `node scripts/backup-diario.mjs` — **primeiro backup completo ponta a ponta** (runner mock em memória + processo real com CLI falsa) |
| **Onde** | `scripts/backup/lib/runBackup.mjs` (criar), `scripts/backup/lib/runBackup.d.mts` (criar), `scripts/backup-diario.mjs` (criar), `src/test/lib/backupIntegration.test.ts` (modificar: imports + novos `describe`) |
| **Depende de** | T03 (`brasiliaDate`), T05 (`createCliRunner`, `files.mjs`, mesmo arquivo de teste) |
| **Bloqueia** | T07 (mesmo arquivo de teste; limpeza entra na entrada), T09, T10 |
| **Paralelo com** | T08 (Onde disjunto: `restoreValidation.test.ts` × `backupIntegration.test.ts`) |
| **Profundidade** | snippets (corpo completo) — thin slice; teste completo; `runBackup.mjs` dividido em 2 steps (helpers / função exportada) |
| **Requisitos** | RF-1 (todo `public`, lista dinâmica), RF-2 (sequencial + paginado), RF-3 (manifest com contagem e checksum), RF-4 (gzip por tabela), RF-6 (`backup.log` com data/hora, status, tamanho, tabela a tabela na falha), RF-7 (falha parcial não promove nem limpa); Edge cases: falha numa tabela → `partial`, disco < `minFreeMb` → `aborted` antes de extrair, lock (dois disparos) → `skipped`, tabela nova entra sozinha, token expirado → `[auth]` no log; Restrições só leitura (`readOnly: true` na entrada), sequencial, saída fora do repo; US-01 |

### Context pack
- **Spec:** §2 RF-1..RF-4, RF-6, RF-7, Edge cases (rede/CLI numa tabela, disco, lock, tabela nova/removida, token expirado, horário de Brasília), Restrições (só leitura, sequencial/paginado, 03:30, sem credencial, saída fora do repo); §4 US-01.
- **Constraints:** ver [Global Constraints](#global-constraints) (decisões "Formato em disco", "Promoção atômica", "Logs", "Lock", "Sequencial e paginado") e [Contratos entre módulos](#contratos-entre-módulos-interfaces-globais--nomesassinaturas-verbatim) (seções `runBackup.mjs (T06)` e `Entradas` → `backup-diario.mjs`).
- **Padrão do repo:** módulo Node ESM como `scripts/check.mjs` (`ROOT` via `fileURLToPath(import.meta.url)`; exit code como contrato de automação). Entrada testada com `spawnSync(process.execPath, [scriptAbsoluto, ...args])` **sem shell** — o espaço do caminho do repo não atrapalha. Teste no `backupIntegration.test.ts` (T05) reaproveitando `novaPasta`, `escreverCliFalsa`, `chamadasDaCli`.
- **Arquivos vizinhos:** `scripts/backup/lib/{config,queries,manifest,retention,cli,files}.mjs` (T01–T05), `src/test/lib/backupIntegration.test.ts` (T05).
- **Não fazer:** nunca `Promise.all` sobre tabelas/páginas; nunca SQL montado fora de `queries.mjs`; não rodar a limpeza aqui (a chamada a `runCleanup` entra na entrada em T07 — `cleanup.mjs` ainda não existe); não rodar `node scripts/backup-diario.mjs` contra o Supabase real nesta fase (validação real é da T10); não usar `--force`/sobrescrever pasta do dia; não mexer nos `describe` de T05; sem commit.

### Interfaces
- **Consumes** (verbatim dos Contratos):
  ```ts
  // config.mjs (T01)
  export interface BackupConfig { backupDir: string; projectRef: string; retentionDays: number; pageSize: number; minFreeMb: number; supabaseCli: string; }
  export function resolveConfig(input: { env: Record<string, string | undefined>; argv: string[]; repoRoot: string }): BackupConfig;
  // queries.mjs (T01)
  export function listTablesSql(): string;
  export function countsSql(tables: string[]): string;
  export function fkEdgesSql(): string;
  export function buildPageSql(table: string, orderBy: string[], limit: number, offset: number): string;
  export function rowsToTableInfo(rows: Record<string, unknown>[]): TableInfo[];
  export class CliOutputError extends Error { kind: "auth" | "network" | "sql" | "unknown"; constructor(message: string, kind: "auth" | "network" | "sql" | "unknown") }
  // manifest.mjs (T02)
  export function checksumRows(rows: unknown[]): string;
  export function buildManifest(input: { date: string; projectRef: string; startedAt: string; finishedAt: string; tables: TableEntry[]; fkEdges: FkEdge[] }): Manifest;
  // retention.mjs (T03)
  export function brasiliaDate(d: Date): string;
  // cli.mjs / files.mjs (T05)
  export type QueryRunner = (sql: string) => Promise<Record<string, unknown>[]>;
  export function createCliRunner(opts: { projectRef: string; supabaseCli?: string; readOnly: boolean; tmpDir?: string }): QueryRunner;
  export function writeTableGz(path: string, rows: unknown[]): Promise<number>;
  export function appendLog(logFile: string, level: "INFO" | "WARN" | "ERROR", message: string): void;
  export function verifyBackupDir(dir: string): Promise<{ ok: boolean; errors: string[]; manifest: Manifest | null }>;
  ```
- **Produces** (verbatim dos Contratos):
  ```ts
  export interface RunBackupResult { status: "complete" | "partial" | "aborted" | "skipped"; dir: string | null; manifest: Manifest | null; reason?: string }
  export function runBackup(input: { config: BackupConfig; runQuery: QueryRunner; now?: () => Date; getFreeMb?: (dir: string) => number }): Promise<RunBackupResult>;
  ```
  Entrada `scripts/backup-diario.mjs`: `resolveConfig({ env: process.env, argv: process.argv.slice(2), repoRoot })` → `createCliRunner({ projectRef, supabaseCli, readOnly: true })` → `runBackup`; exit 0 complete/skipped, 1 partial/aborted, 2 erro inesperado (ERROR no `backup.log` quando a config já foi resolvida; senão só stderr).
  Precisões (não mudam assinatura): `reason` ∈ `"lock"` (skipped, `dir: null`), `"já existe"` (skipped, `dir` = pasta do dia), `"disco"` (aborted), `"catálogo"` (aborted: falha em `listTablesSql`/`countsSql`/`fkEdgesSql` ou nenhuma tabela — o log traz `[kind] mensagem`, ex. `[auth]`), `"tabelas com erro"` / `"verificação"` (partial, `dir` = pasta `.partial-*`). A idade do lock usa o relógio real (`Date.now()` × `mtime`), não o `now` injetado. Pasta de trabalho só é criada depois do catálogo lido. `error` de tabela = `[kind] message` para `CliOutputError`, `[unknown] message` para outros erros.
  Consumidores: T07 (entrada ganha `runCleanup` após `complete`), T09 (tarefa agendada roda `backup-diario.mjs`), T10 (validação real).

### Steps
- [ ] **Step 1: Escrever os testes** — em `src/test/lib/backupIntegration.test.ts`: (a) substituir três linhas de import. Trocar
  ```ts
  import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
  ```
  por
  ```ts
  import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
  ```
  trocar
  ```ts
  import { join } from "node:path";
  ```
  por
  ```ts
  import { join, resolve } from "node:path";
  import { spawnSync } from "node:child_process";
  ```
  e trocar
  ```ts
  import { CliOutputError } from "../../../scripts/backup/lib/queries.mjs";
  ```
  por
  ```ts
  import { CliOutputError, assertReadOnlySql } from "../../../scripts/backup/lib/queries.mjs";
  import { runBackup } from "../../../scripts/backup/lib/runBackup.mjs";
  import type { BackupConfig } from "../../../scripts/backup/lib/config.mjs";
  import type { QueryRunner } from "../../../scripts/backup/lib/cli.mjs";
  ```
  (b) no fim do arquivo, acrescentar:
  ```ts
  // ---------------------------------------------------------------- T06

  const AGORA = () => new Date("2026-09-18T06:30:00Z"); // 03:30 em Brasília
  const DADOS: DadosFalsos = {
    tabelas: {
      clientes: { pk: ["id"], linhas: [1, 2, 3, 4, 5].map((id) => ({ id, nome: `cliente ${id}` })) },
      log_sem_pk: { pk: [], linhas: [{ msg: "a" }], contagem: 2 },
      pedidos: { pk: ["id"], linhas: [{ id: 10, cliente_id: 1 }, { id: 11, cliente_id: 2 }] },
    },
    fks: [{ child: "pedidos", parent: "clientes" }],
  };

  function configTeste(backupDir: string, extra: Partial<BackupConfig> = {}): BackupConfig {
    return {
      backupDir,
      projectRef: REF_TESTE,
      retentionDays: 30,
      pageSize: 2,
      minFreeMb: 0,
      supabaseCli: "cli-que-nunca-deve-ser-chamada",
      ...extra,
    };
  }

  /**
   * Runner mock em memória (mesmas respostas da CLI falsa, sem processo): recusa SQL que não seja
   * só-leitura, registra cada chamada e mede quantas estão "em voo" ao mesmo tempo.
   */
  function criarRunnerMock(dados: DadosFalsos, opts: { erroCatalogo?: CliOutputError } = {}) {
    const chamadas: string[] = [];
    let emVoo = 0;
    let maxEmVoo = 0;
    const nomes = Object.keys(dados.tabelas).sort();
    const runQuery: QueryRunner = async (sql) => {
      assertReadOnlySql(sql);
      chamadas.push(sql);
      emVoo++;
      maxEmVoo = Math.max(maxEmVoo, emVoo);
      try {
        await new Promise((r) => setTimeout(r, 1));
        const pagina = /from public\."([^"]+)"/.exec(sql)?.[1];
        if (sql.includes("query_to_xml")) {
          return nomes.map((n) => ({ table_name: n, row_count: String(dados.tabelas[n].contagem ?? dados.tabelas[n].linhas.length) }));
        }
        if (sql.includes("contype = 'f'")) return dados.fks ?? [];
        if (sql.includes("pk_columns")) {
          if (opts.erroCatalogo) throw opts.erroCatalogo;
          return nomes.map((n) => ({
            table_name: n,
            pk_columns: dados.tabelas[n].pk,
            columns: Object.keys(dados.tabelas[n].linhas[0] ?? { id: 0 }).map((c) => ({ name: c, generated: false })),
          }));
        }
        if (pagina) {
          if (pagina === dados.falhaTabela) {
            throw new CliOutputError(`LegacyDbQueryUnexpectedStatusError: unexpected status 400: ERROR:  42P01: relation "${pagina}" does not exist`, "sql");
          }
          const m = /limit (\d+) offset (\d+)/.exec(sql)!;
          return dados.tabelas[pagina].linhas.slice(Number(m[2]), Number(m[2]) + Number(m[1]));
        }
        throw new Error(`SQL inesperado no mock: ${sql}`);
      } finally {
        emVoo--;
      }
    };
    return { runQuery, chamadas, maxEmVoo: () => maxEmVoo };
  }

  function lerLog(root: string, nome = "backup.log"): string {
    return readFileSync(join(root, "logs", nome), "utf8");
  }

  describe("runBackup (thin slice: backup completo ponta a ponta com runner mock)", () => {
    it("extrai tudo em sequência e paginado, grava manifest, verifica e promove AAAA-MM-DD", async () => {
      const root = novaPasta();
      const mock = criarRunnerMock(DADOS);
      const r = await runBackup({ config: configTeste(root), runQuery: mock.runQuery, now: AGORA, getFreeMb: () => 999_999 });

      expect(r.status).toBe("complete");
      expect(r.dir).toBe(join(root, "2026-09-18"));
      expect(readdirSync(root).sort()).toEqual(["2026-09-18", "logs"]); // sem .partial e sem backup.lock
      expect(r.manifest?.status).toBe("complete");
      expect(r.manifest?.tables.map((t) => [t.name, t.rowCount, t.expectedRowCount])).toEqual([
        ["clientes", 5, 5],
        ["log_sem_pk", 1, 2],
        ["pedidos", 2, 2],
      ]);
      expect(r.manifest?.fkEdges).toEqual([{ child: "pedidos", parent: "clientes" }]);
      expect(await readTableGz(join(root, "2026-09-18", "tables", "clientes.json.gz"))).toEqual(DADOS.tabelas.clientes.linhas);
      expect((await verifyBackupDir(join(root, "2026-09-18"))).ok).toBe(true);

      // paginação: 5 linhas com página 2 → offsets 0, 2, 4; tabela sem PK ordena por t::text
      const paginasClientes = mock.chamadas.filter((s) => s.includes('public."clientes"'));
      expect(paginasClientes.map((s) => /offset (\d+)/.exec(s)?.[1])).toEqual(["0", "2", "4"]);
      expect(mock.chamadas.find((s) => s.includes('public."log_sem_pk"'))).toContain("order by t::text");
      // 3 de catálogo + 3 (clientes) + 1 (log_sem_pk) + 2 (pedidos)
      expect(mock.chamadas).toHaveLength(9);
      expect(mock.maxEmVoo()).toBe(1); // nunca duas consultas ao mesmo tempo

      const log = lerLog(root);
      expect(log).toContain("| INFO | início do backup do projeto abcdefghijklmnopqrst");
      expect(log).toContain("| INFO | tabela clientes: 5 linhas");
      expect(log).toContain("| WARN | tabela log_sem_pk: contagem no início 2, extraídas 1");
      expect(log).toContain("| INFO | backup complete: 3 tabelas");
    });

    it("falha numa tabela → partial: segue para as próximas, não promove e mantém a pasta .partial", async () => {
      const root = novaPasta();
      const mock = criarRunnerMock({ ...DADOS, falhaTabela: "clientes" });
      const r = await runBackup({ config: configTeste(root), runQuery: mock.runQuery, now: AGORA, getFreeMb: () => 999_999 });

      expect(r.status).toBe("partial");
      expect(r.dir).toBe(join(root, "2026-09-18.partial-033000"));
      expect(existsSync(join(root, "2026-09-18"))).toBe(false);
      expect(existsSync(join(root, "2026-09-18.partial-033000", "manifest.json"))).toBe(true);
      const clientes = r.manifest?.tables.find((t) => t.name === "clientes");
      expect(clientes?.error).toMatch(/^\[sql\] .*42P01/);
      expect(clientes?.checksum).toBeNull();
      expect(r.manifest?.tables.find((t) => t.name === "pedidos")?.rowCount).toBe(2);
      expect(existsSync(join(root, "backup.lock"))).toBe(false);
      const log = lerLog(root);
      expect(log).toContain("| ERROR | tabela clientes: [sql]");
      expect(log).toContain("| ERROR | backup partial: 1 tabela(s) com erro [clientes]");
    });

    it("login expirado no catálogo → aborted com erro [auth] identificável no log", async () => {
      const root = novaPasta();
      const mock = criarRunnerMock(DADOS, { erroCatalogo: new CliOutputError("Unauthorized: run supabase login", "auth") });
      const r = await runBackup({ config: configTeste(root), runQuery: mock.runQuery, now: AGORA, getFreeMb: () => 999_999 });

      expect(r).toMatchObject({ status: "aborted", reason: "catálogo", dir: null });
      expect(readdirSync(root).sort()).toEqual(["logs"]);
      expect(lerLog(root)).toContain("| ERROR | backup abortado ao ler o catálogo: [auth] Unauthorized");
    });

    it("disco abaixo do mínimo → aborted antes de qualquer consulta", async () => {
      const root = novaPasta();
      const mock = criarRunnerMock(DADOS);
      const r = await runBackup({ config: configTeste(root, { minFreeMb: 1024 }), runQuery: mock.runQuery, now: AGORA, getFreeMb: () => 10 });

      expect(r).toMatchObject({ status: "aborted", reason: "disco" });
      expect(mock.chamadas).toHaveLength(0);
      expect(existsSync(join(root, "backup.lock"))).toBe(false);
      expect(lerLog(root)).toContain("| ERROR | backup abortado: 10 MB livres");
    });

    it("lock recente (outro backup rodando) → skipped, sem consultas e sem apagar o lock alheio", async () => {
      const root = novaPasta();
      writeFileSync(join(root, "backup.lock"), "123 outro processo");
      const mock = criarRunnerMock(DADOS);
      const r = await runBackup({ config: configTeste(root), runQuery: mock.runQuery, now: AGORA, getFreeMb: () => 999_999 });

      expect(r).toMatchObject({ status: "skipped", reason: "lock" });
      expect(mock.chamadas).toHaveLength(0);
      expect(existsSync(join(root, "backup.lock"))).toBe(true);
    });

    it("lock com mais de 6 h é órfão → removido com WARN e o backup segue", async () => {
      const root = novaPasta();
      const lock = join(root, "backup.lock");
      writeFileSync(lock, "999 processo morto");
      const seteHorasAtras = new Date(Date.now() - 7 * 3_600_000);
      utimesSync(lock, seteHorasAtras, seteHorasAtras);
      const mock = criarRunnerMock(DADOS);
      const r = await runBackup({ config: configTeste(root), runQuery: mock.runQuery, now: AGORA, getFreeMb: () => 999_999 });

      expect(r.status).toBe("complete");
      expect(existsSync(lock)).toBe(false);
      expect(lerLog(root)).toContain("| WARN | lock órfão");
    });

    it("pasta do dia já existe → skipped sem consultar (refazer = dono apaga/renomeia)", async () => {
      const root = novaPasta();
      mkdirSync(join(root, "2026-09-18"));
      const mock = criarRunnerMock(DADOS);
      const r = await runBackup({ config: configTeste(root), runQuery: mock.runQuery, now: AGORA, getFreeMb: () => 999_999 });

      expect(r).toMatchObject({ status: "skipped", reason: "já existe", dir: join(root, "2026-09-18") });
      expect(mock.chamadas).toHaveLength(0);
    });

    it("23:30 de Brasília (02:30 UTC) grava na pasta do dia anterior", async () => {
      const root = novaPasta();
      const mock = criarRunnerMock(DADOS);
      const r = await runBackup({
        config: configTeste(root),
        runQuery: mock.runQuery,
        now: () => new Date("2026-09-18T02:30:00Z"),
        getFreeMb: () => 999_999,
      });
      expect(r.dir).toBe(join(root, "2026-09-17"));
    });
  });

  // ---------------------------------------------------------------- T06: entrada backup-diario.mjs

  const SCRIPT_BACKUP = resolve(process.cwd(), "scripts/backup-diario.mjs");

  /** Roda uma entrada .mjs num processo Node separado (sem shell: o espaço do caminho do repo não atrapalha). */
  function rodarEntrada(script: string, args: string[], env: Record<string, string>) {
    return spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });
  }

  function envBackup(root: string, cli: string): Record<string, string> {
    return {
      ERPOS_BACKUP_DIR: root,
      ERPOS_SUPABASE_CLI: cli,
      ERPOS_BACKUP_PROJECT_REF: REF_TESTE,
      ERPOS_BACKUP_PAGE_SIZE: "2",
      ERPOS_BACKUP_MIN_FREE_MB: "0",
      ERPOS_BACKUP_RETENTION_DAYS: "30",
    };
  }

  const DIA = /^\d{4}-\d{2}-\d{2}$/;

  describe("scripts/backup-diario.mjs (processo real + CLI falsa)", () => {
    it("backup completo → exit 0; segunda execução no mesmo dia → skipped, exit 0", () => {
      const root = novaPasta();
      const cliDir = novaPasta();
      const cli = escreverCliFalsa(cliDir, DADOS);

      const r1 = rodarEntrada(SCRIPT_BACKUP, [], envBackup(root, cli));
      expect(r1.status).toBe(0);
      expect(r1.stdout).toContain("backup complete");
      const dias = readdirSync(root).filter((n) => DIA.test(n));
      expect(dias).toHaveLength(1);
      expect(chamadasDaCli(cliDir)).toBe(9);

      const r2 = rodarEntrada(SCRIPT_BACKUP, [], envBackup(root, cli));
      expect(r2.status).toBe(0);
      expect(r2.stdout).toContain("backup skipped (já existe)");
      expect(chamadasDaCli(cliDir)).toBe(9);
    }, 60_000);

    it("CLI falha numa tabela → exit 1, log com [sql] e sem o stderr cru (PGPASSWORD)", () => {
      const root = novaPasta();
      const cli = escreverCliFalsa(novaPasta(), { ...DADOS, falhaTabela: "pedidos" });

      const r = rodarEntrada(SCRIPT_BACKUP, [], envBackup(root, cli));
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("backup partial");
      expect(readdirSync(root).filter((n) => DIA.test(n))).toEqual([]);
      expect(readdirSync(root).filter((n) => n.includes(".partial-"))).toHaveLength(1);
      const log = lerLog(root);
      expect(log).toContain("| ERROR | tabela pedidos: [sql]");
      expect(log).not.toMatch(/PGPASSWORD|segredo|Initialising login role/);
    }, 60_000);

    it("--dir dentro do repositório → exit 2 sem criar nada", () => {
      const dentro = join(process.cwd(), "backups-nao-deve-existir");
      const r = rodarEntrada(SCRIPT_BACKUP, ["--dir", dentro], envBackup(novaPasta(), "cli-que-nunca-deve-ser-chamada"));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("dentro do repositório");
      expect(existsSync(dentro)).toBe(false);
    }, 30_000);
  });
  ```
  Esperado: arquivo salvo; `describe` de T05 intactos. O runner mock chama `assertReadOnlySql` em todo SQL recebido e mede consultas "em voo" (tem que ser 1).

- [ ] **Step 2: Rodar e ver falhar pelo motivo certo**
  ```
  npx vitest run src/test/lib/backupIntegration.test.ts
  ```
  Esperado: FAIL da suíte com `Cannot find module '../../../scripts/backup/lib/runBackup.mjs'`.

- [ ] **Step 3: Criar `scripts/backup/lib/runBackup.d.mts`** (completo):
  ```ts
  import type { BackupConfig } from "./config.mjs";
  import type { QueryRunner } from "./cli.mjs";
  import type { Manifest } from "./manifest.mjs";
  export interface RunBackupResult { status: "complete" | "partial" | "aborted" | "skipped"; dir: string | null; manifest: Manifest | null; reason?: string }
  export declare function runBackup(input: { config: BackupConfig; runQuery: QueryRunner; now?: () => Date; getFreeMb?: (dir: string) => number }): Promise<RunBackupResult>;
  ```
  Esperado: tipos idênticos aos Contratos.

- [ ] **Step 4: Criar `scripts/backup/lib/runBackup.mjs` — parte 1: imports e helpers** (lock, hora de Brasília, disco, extração paginada de uma tabela):
  ```js
  /**
   * runBackup.mjs — orquestra o backup diário (T06)
   *
   * lock → disco livre → pasta do dia (Brasília) → catálogo/contagens/FKs →
   * extração SEQUENCIAL e paginada tabela a tabela → manifest → verificação →
   * promoção atômica (rename de AAAA-MM-DD.partial-HHmmss para AAAA-MM-DD).
   * Falha em qualquer tabela → status "partial": a pasta .partial fica para
   * diagnóstico e nada é promovido. Todo SQL sai de queries.mjs (só leitura).
   */
  import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, statfsSync, writeFileSync, writeSync } from "node:fs";
  import { join } from "node:path";
  import { appendLog, verifyBackupDir, writeTableGz } from "./files.mjs";
  import { buildManifest, checksumRows } from "./manifest.mjs";
  import { CliOutputError, buildPageSql, countsSql, fkEdgesSql, listTablesSql, rowsToTableInfo } from "./queries.mjs";
  import { brasiliaDate } from "./retention.mjs";

  const LOCK_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const BRASILIA_TIME = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  function brasiliaHHmmss(d) {
    return BRASILIA_TIME.format(d).replace(/\D/g, "");
  }

  function defaultFreeMb(dir) {
    const s = statfsSync(dir);
    return (s.bavail * s.bsize) / 1048576;
  }

  function describeError(e) {
    if (e instanceof CliOutputError) return `[${e.kind}] ${e.message}`;
    return `[unknown] ${e instanceof Error ? e.message : String(e)}`;
  }

  /** true = lock adquirido; false = outro backup em andamento. A idade usa o relógio real. */
  function acquireLock(lockFile, log) {
    const create = () => {
      const fd = openSync(lockFile, "wx");
      writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
      closeSync(fd);
    };
    try {
      create();
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const ageMs = Date.now() - statSync(lockFile).mtimeMs;
    if (ageMs < LOCK_MAX_AGE_MS) return false;
    log("WARN", `lock órfão (${(ageMs / 3_600_000).toFixed(1)} h) removido: ${lockFile}`);
    rmSync(lockFile, { force: true });
    try {
      create();
      return true;
    } catch (e) {
      if (e.code === "EEXIST") return false;
      throw e;
    }
  }

  async function extractTable(table, pageSize, runQuery) {
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await runQuery(buildPageSql(table.name, table.pkColumns, pageSize, offset));
      for (const row of page) rows.push(row);
      if (page.length < pageSize) return rows;
    }
  }
  ```
  Esperado: `extractTable` faz uma página por vez (`await` dentro do `for`), parando na primeira página com menos de `pageSize` linhas.

- [ ] **Step 5: Completar `scripts/backup/lib/runBackup.mjs` — parte 2: acrescentar no fim do arquivo (depois de uma linha em branco) a função exportada**:
  ```js
  export async function runBackup({ config, runQuery, now = () => new Date(), getFreeMb = defaultFreeMb }) {
    const root = config.backupDir;
    const logFile = join(root, "logs", "backup.log");
    const log = (level, message) => appendLog(logFile, level, message);
    mkdirSync(root, { recursive: true });

    const lockFile = join(root, "backup.lock");
    if (!acquireLock(lockFile, log)) {
      log("WARN", "backup ignorado: outro backup em andamento (backup.lock recente)");
      return { status: "skipped", dir: null, manifest: null, reason: "lock" };
    }

    try {
      const freeMb = getFreeMb(root);
      if (freeMb < config.minFreeMb) {
        log("ERROR", `backup abortado: ${Math.floor(freeMb)} MB livres em ${root}, mínimo ${config.minFreeMb} MB`);
        return { status: "aborted", dir: null, manifest: null, reason: "disco" };
      }

      const started = now();
      const date = brasiliaDate(started);
      const finalDir = join(root, date);
      if (existsSync(finalDir)) {
        log("WARN", `backup de ${date} já existe (${finalDir}); para refazer, renomeie ou apague a pasta`);
        return { status: "skipped", dir: finalDir, manifest: null, reason: "já existe" };
      }
      const work = join(root, `${date}.partial-${brasiliaHHmmss(started)}`);
      log("INFO", `início do backup do projeto ${config.projectRef} em ${work}`);

      let tables;
      let expected;
      let fkEdges;
      try {
        tables = rowsToTableInfo(await runQuery(listTablesSql()));
        if (tables.length === 0) throw new Error("nenhuma tabela no schema public");
        const counts = await runQuery(countsSql(tables.map((t) => t.name)));
        expected = new Map(counts.map((r) => [String(r.table_name), Number(r.row_count)]));
        fkEdges = (await runQuery(fkEdgesSql())).map((r) => ({ child: String(r.child), parent: String(r.parent) }));
      } catch (e) {
        log("ERROR", `backup abortado ao ler o catálogo: ${describeError(e)}`);
        return { status: "aborted", dir: null, manifest: null, reason: "catálogo" };
      }

      mkdirSync(join(work, "tables"), { recursive: true });
      const entries = [];
      let totalBytes = 0;
      for (const table of tables) {
        const exp = expected.get(table.name);
        const entry = {
          name: table.name,
          file: `${table.name}.json.gz`,
          rowCount: 0,
          expectedRowCount: Number.isFinite(exp) ? exp : null,
          checksum: null,
          pkColumns: table.pkColumns,
          columns: table.columns,
        };
        try {
          const rows = await extractTable(table, config.pageSize, runQuery);
          const bytes = await writeTableGz(join(work, "tables", entry.file), rows);
          entry.rowCount = rows.length;
          entry.checksum = checksumRows(rows);
          totalBytes += bytes;
          log("INFO", `tabela ${table.name}: ${rows.length} linhas, ${bytes} bytes`);
          if (entry.expectedRowCount !== null && entry.expectedRowCount !== rows.length) {
            log("WARN", `tabela ${table.name}: contagem no início ${entry.expectedRowCount}, extraídas ${rows.length}`);
          }
        } catch (e) {
          entry.error = describeError(e);
          log("ERROR", `tabela ${table.name}: ${entry.error}`);
        }
        entries.push(entry);
      }

      const manifest = buildManifest({
        date,
        projectRef: config.projectRef,
        startedAt: started.toISOString(),
        finishedAt: now().toISOString(),
        tables: entries,
        fkEdges,
      });
      writeFileSync(join(work, "manifest.json"), JSON.stringify(manifest, null, 2));
      const verify = await verifyBackupDir(work);
      const totalMb = (totalBytes / 1048576).toFixed(2);

      if (manifest.status === "complete" && verify.ok) {
        renameSync(work, finalDir);
        log("INFO", `backup complete: ${entries.length} tabelas, ${totalMb} MB em ${finalDir}`);
        return { status: "complete", dir: finalDir, manifest };
      }
      for (const err of verify.errors) log("ERROR", `verificação: ${err}`);
      const failed = entries.filter((e) => e.error).map((e) => e.name);
      log(
        "ERROR",
        `backup partial: ${failed.length} tabela(s) com erro [${failed.join(", ")}], ${verify.errors.length} erro(s) de verificação, ${totalMb} MB; pasta mantida em ${work}; nada promovido`,
      );
      return { status: "partial", dir: work, manifest, reason: failed.length > 0 ? "tabelas com erro" : "verificação" };
    } finally {
      rmSync(lockFile, { force: true });
    }
  }
  ```
  Esperado: `for…of` + `await` nas tabelas (nunca `Promise.all`); `rename` só com manifest `complete` **e** `verifyBackupDir` ok; lock removido no `finally` só quando foi adquirido por este processo.

- [ ] **Step 6: Criar a entrada `scripts/backup-diario.mjs`** (corpo completo):
  ```js
  #!/usr/bin/env node
  /**
   * backup-diario.mjs — backup diário do banco Supabase do ERPOS (specs/2026-09-backup-diario)
   *
   * Extrai todas as tabelas do schema public via `supabase db query` (só leitura),
   * grava em {ERPOS_BACKUP_DIR}/{AAAA-MM-DD}/ e registra em logs/backup.log.
   *
   *   node scripts/backup-diario.mjs [--dir <pasta>]
   *
   * Exit: 0 complete/skipped · 1 partial/aborted · 2 erro inesperado.
   * Variáveis: ver scripts/backup/lib/config.mjs. Nunca lê nem imprime credencial.
   */
  import { dirname, join, resolve } from "node:path";
  import { fileURLToPath } from "node:url";
  import { createCliRunner } from "./backup/lib/cli.mjs";
  import { resolveConfig } from "./backup/lib/config.mjs";
  import { appendLog } from "./backup/lib/files.mjs";
  import { runBackup } from "./backup/lib/runBackup.mjs";

  // raiz do repo = pasta acima de scripts/ (só para recusar backup dentro do repo)
  const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  let config = null;
  try {
    config = resolveConfig({ env: process.env, argv: process.argv.slice(2), repoRoot: REPO_ROOT });
    const runQuery = createCliRunner({ projectRef: config.projectRef, supabaseCli: config.supabaseCli, readOnly: true });
    const result = await runBackup({ config, runQuery });
    console.log(`backup ${result.status}${result.reason ? ` (${result.reason})` : ""}${result.dir ? `: ${result.dir}` : ""}`);
    process.exitCode = result.status === "complete" || result.status === "skipped" ? 0 : 1;
  } catch (e) {
    const message = `erro inesperado: ${e instanceof Error ? e.message : String(e)}`;
    if (config) {
      try {
        appendLog(join(config.backupDir, "logs", "backup.log"), "ERROR", message);
      } catch {
        // sem onde registrar: fica só o stderr
      }
    }
    console.error(message);
    process.exitCode = 2;
  }
  ```
  Esperado: `readOnly: true` fixo; nenhum `console.log` de config/credencial.

- [ ] **Step 7: Rodar o teste e ver passar**
  ```
  npx vitest run src/test/lib/backupIntegration.test.ts
  ```
  Esperado: PASS — 25 testes (14 de T05 + 8 de `runBackup` + 3 da entrada com processo real e CLI falsa).

- [ ] **Step 8: Refactor/limpeza** — sem export fora do Contrato em `runBackup.mjs`; nenhum SQL literal fora de `queries.mjs`; nenhum `Promise.all`. Se mudar algo, repetir o Step 7.
  ```
  grep -n "Promise.all" scripts/backup/lib/runBackup.mjs scripts/backup-diario.mjs
  ```
  Esperado: `grep` sem saída; sem alteração de comportamento.

- [ ] **Step 9: Gate iterativo**
  ```
  npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"
  npx vitest run
  ```
  Esperado: ≤ 292; suíte sem falha nova.

### Definição de pronto (DoD)
- [ ] `runBackup.mjs`, `runBackup.d.mts`, `backup-diario.mjs` criados; `backupIntegration.test.ts` verde (25).
- [ ] Thin slice provado: backup completo ponta a ponta (mock em memória **e** processo real + CLI falsa) promove `AAAA-MM-DD`, `verifyBackupDir` ok, `backup.log` com início/tabelas/`complete`.
- [ ] Sequencial (máx. 1 consulta em voo) e paginado (5 linhas, página 2 → offsets 0/2/4; sem PK → `t::text`); todo SQL passa em `assertReadOnlySql`.
- [ ] Falha numa tabela → `partial`, `.partial-033000` mantida, nada promovido, log `[sql]` sem `PGPASSWORD`; `[auth]` no catálogo → `aborted`; disco → `aborted` sem consultas; lock recente → `skipped` sem apagar lock alheio; lock > 6 h → removido com WARN; pasta do dia existente → `skipped`; 02:30 UTC → pasta do dia anterior.
- [ ] Entrada: exit 0 complete/skipped, 1 partial, 2 `--dir` dentro do repo; nenhum teste chama a CLI real.
- [ ] Interfaces = Contratos; gate iterativo ok (tsc ≤ 292, vitest sem falha nova); sem shadow code; sem commit.

---

## T07: Limpeza + entradas `cleanup-backups.mjs` / `verify-integrity.mjs`

| Campo | Valor |
|-------|-------|
| **Entregável** | `runCleanup` (retenção por nome de pasta + manifest, `--dry-run`, `cleanup.log`), entradas `node scripts/cleanup-backups.mjs` e `node scripts/verify-integrity.mjs` (`--backup` / `--compare` / `--live`), e a limpeza ligada à entrada do backup (só após `complete`) |
| **Onde** | `scripts/backup/lib/cleanup.mjs` (criar), `scripts/backup/lib/cleanup.d.mts` (criar), `scripts/cleanup-backups.mjs` (criar), `scripts/verify-integrity.mjs` (criar), `scripts/backup-diario.mjs` (modificar: chamar `runCleanup` após `complete` — ver nota), `src/test/lib/backupIntegration.test.ts` (modificar: imports + novos `describe`) |
| **Depende de** | T06 (mesmo arquivo de teste; entrada `backup-diario.mjs`) |
| **Bloqueia** | T09, T10 |
| **Paralelo com** | T08 (Onde disjunto) |
| **Profundidade** | snippets (corpo completo) — override; teste completo |
| **Requisitos** | RF-5 (retenção de 30 dias só após backup bem-sucedido), RF-6 (`cleanup.log` com data/hora), RF-7 (falha parcial não limpa), RF-8 (`verify-integrity` reutilizável); critérios de sucesso "cleanup em pasta de teste com datas fictícias remove só > 30 dias com log" e "manifests idênticos → sem divergência; > 5% → erro (exit 1)"; Restrição só leitura (`--live` com `readOnly: true`); US-02, US-03 |

> Nota de Onde: o Contrato da entrada `backup-diario.mjs` manda chamar `runCleanup` após `complete`, mas `cleanup.mjs` só nasce aqui. Por isso T06 cria a entrada sem a limpeza e **T07 a modifica** (4 trechos, Step 6). T08 não toca nesse arquivo — o paralelismo T07 ∥ T08 continua disjunto.

### Context pack
- **Spec:** §2 RF-5..RF-8, critérios de sucesso de limpeza e de verificação, Edge case "falha parcial não limpa e preserva os anteriores"; §4 US-02, US-03.
- **Constraints:** ver [Global Constraints](#global-constraints) (formato `{AAAA-MM-DD}` / `{AAAA-MM-DD}.partial-{HHmmss}`, logs) e [Contratos entre módulos](#contratos-entre-módulos-interfaces-globais--nomesassinaturas-verbatim) (seções `cleanup.mjs (T07)` e `Entradas`).
- **Padrão do repo:** entradas como `scripts/check.mjs` (JSDoc de uso no topo, exit code documentado, `REPO_ROOT` via `fileURLToPath`); teste por `spawnSync(process.execPath, [script, ...args])` sem shell, reaproveitando `rodarEntrada`, `envBackup`, `configTeste`, `lerLog`, `escreverCliFalsa`, `montarBackup`, `entradaDe` (T05/T06).
- **Arquivos vizinhos:** `scripts/backup/lib/retention.mjs` (T03 — `selectExpired`), `scripts/backup/lib/manifest.mjs` (T02 — `compareManifests`), `scripts/backup-diario.mjs` (T06).
- **Não fazer:** não reimplementar a regra de retenção (só `selectExpired`); não apagar nada fora de `config.backupDir` nem arquivos soltos (só diretórios); não chamar `runCleanup` em `partial`/`aborted`/`skipped`; `--live` nunca com `readOnly: false`; nenhum teste contra a CLI real; não mexer nos `describe` de T05/T06; sem commit.

### Interfaces
- **Consumes** (verbatim dos Contratos):
  ```ts
  export function selectExpired(entries: BackupDirEntry[], today: string, retentionDays: number): string[]; // retention.mjs (T03)
  export function brasiliaDate(d: Date): string;                                                          // retention.mjs (T03)
  export function compareManifests(base: Manifest, other: Manifest, opts?: { tolerancePct?: number }): CompareResult; // manifest.mjs (T02)
  export function buildManifest(input: { date: string; projectRef: string; startedAt: string; finishedAt: string; tables: TableEntry[]; fkEdges: FkEdge[] }): Manifest;
  export function countsSql(tables: string[]): string;                                                    // queries.mjs (T01)
  export function resolveConfig(input: { env: Record<string, string | undefined>; argv: string[]; repoRoot: string }): BackupConfig; // config.mjs (T01)
  export function createCliRunner(opts: { projectRef: string; supabaseCli?: string; readOnly: boolean; tmpDir?: string }): QueryRunner; // cli.mjs (T05)
  export function appendLog(logFile: string, level: "INFO" | "WARN" | "ERROR", message: string): void;  // files.mjs (T05)
  export function verifyBackupDir(dir: string): Promise<{ ok: boolean; errors: string[]; manifest: Manifest | null }>;
  export function runBackup(input: { config: BackupConfig; runQuery: QueryRunner; now?: () => Date; getFreeMb?: (dir: string) => number }): Promise<RunBackupResult>; // runBackup.mjs (T06)
  ```
- **Produces** (verbatim dos Contratos):
  ```ts
  export function runCleanup(input: { config: BackupConfig; today: string; dryRun?: boolean }): Promise<{ removed: string[] }>;
  ```
  Entradas: `scripts/cleanup-backups.mjs [--dir X] [--dry-run]` (exit 0 ok, 2 erro); `scripts/verify-integrity.mjs --backup <dir> | --compare <a.json> <b.json> [--tolerance 5] | --live <dir> --project-ref <ref> [--tolerance 5]` (exit 0 ok, 1 divergência, 2 uso inválido/erro; saída `ERRO: …` / `AVISO: …` / `OK: sem divergência`).
  Precisões (não mudam assinatura): em `dryRun`, `removed` lista o que **seria** removido (nada é apagado); `complete` = nome sem `.partial` **e** `manifest.json` com `status: "complete"`; arquivos soltos (`backup.lock`) são ignorados; `--live` compara só as tabelas sem `error` do manifest e usa `ERPOS_SUPABASE_CLI` (default `npx supabase`) com `readOnly: true`.
  Consumidores: T09 (`BACKUP-MAINTENANCE.md` documenta `cleanup-backups.mjs`/`verify-integrity.mjs`), T10 (validação real `--live`).

### Steps
- [ ] **Step 1: Escrever os testes** — em `src/test/lib/backupIntegration.test.ts`: (a) logo abaixo de
  ```ts
  import { runBackup } from "../../../scripts/backup/lib/runBackup.mjs";
  ```
  acrescentar
  ```ts
  import { runCleanup } from "../../../scripts/backup/lib/cleanup.mjs";
  import { brasiliaDate } from "../../../scripts/backup/lib/retention.mjs";
  ```
  (b) no fim do arquivo, acrescentar:
  ```ts
  // ---------------------------------------------------------------- T07

  /** Cria {root}/{nome}; com status grava um manifest.json mínimo ({ status }). */
  function criarPastaBackup(root: string, nome: string, status: "complete" | "partial" | null): void {
    mkdirSync(join(root, nome), { recursive: true });
    if (status) writeFileSync(join(root, nome, "manifest.json"), JSON.stringify({ status }));
  }

  /** "AAAA-MM-DD" n dias antes de `dia` (aritmética em UTC, sem fuso). */
  function diasAntes(dia: string, n: number): string {
    const [y, m, d] = dia.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) - n * 86_400_000).toISOString().slice(0, 10);
  }

  function montarPastasDeRetencao(root: string): void {
    criarPastaBackup(root, "2026-08-01", "complete");
    criarPastaBackup(root, "2026-08-15.partial-031500", "partial");
    criarPastaBackup(root, "2026-08-30", "complete");
    criarPastaBackup(root, "2026-08-31", "complete");
    criarPastaBackup(root, "2026-09-29", "complete");
    mkdirSync(join(root, "logs"), { recursive: true });
    writeFileSync(join(root, "backup.lock"), "arquivo, não pasta");
  }

  describe("runCleanup (retenção de 30 dias em pasta de teste)", () => {
    it("remove só o que passou do corte (hoje − 30) e registra em cleanup.log", async () => {
      const root = novaPasta();
      montarPastasDeRetencao(root);
      const r = await runCleanup({ config: configTeste(root), today: "2026-09-30" });

      expect(r.removed).toEqual(["2026-08-01", "2026-08-15.partial-031500", "2026-08-30"]);
      expect(readdirSync(root).sort()).toEqual(["2026-08-31", "2026-09-29", "backup.lock", "logs"]);
      const log = lerLog(root, "cleanup.log");
      expect(log).toContain("| INFO | removido 2026-08-01");
      expect(log).toContain("| INFO | removido 2026-08-15.partial-031500");
      expect(log).toContain("3 de 3 pasta(s) expirada(s) removidas");
    });

    it("dry-run não apaga nada, mas lista e loga o que removeria", async () => {
      const root = novaPasta();
      montarPastasDeRetencao(root);
      const r = await runCleanup({ config: configTeste(root), today: "2026-09-30", dryRun: true });

      expect(r.removed).toEqual(["2026-08-01", "2026-08-15.partial-031500", "2026-08-30"]);
      expect(existsSync(join(root, "2026-08-01"))).toBe(true);
      expect(existsSync(join(root, "2026-08-30"))).toBe(true);
      expect(lerLog(root, "cleanup.log")).toContain("| INFO | [dry-run] removeria 2026-08-30");
    });

    it("nunca apaga o backup completo mais recente, mesmo expirado; pasta de dia com manifest partial não conta", async () => {
      const root = novaPasta();
      criarPastaBackup(root, "2026-07-01", "complete");
      criarPastaBackup(root, "2026-07-02", "partial");
      const r = await runCleanup({ config: configTeste(root), today: "2026-09-30" });

      expect(r.removed).toEqual(["2026-07-02"]);
      expect(existsSync(join(root, "2026-07-01"))).toBe(true);
    });
  });

  const SCRIPT_CLEANUP = resolve(process.cwd(), "scripts/cleanup-backups.mjs");
  const SCRIPT_VERIFY = resolve(process.cwd(), "scripts/verify-integrity.mjs");
  const ENV_LIMPO = { ERPOS_BACKUP_RETENTION_DAYS: "30", ERPOS_BACKUP_PROJECT_REF: REF_TESTE };

  describe("scripts/cleanup-backups.mjs (processo real)", () => {
    it("--dry-run lista sem apagar; sem a flag apaga só o expirado", () => {
      const root = novaPasta();
      const hoje = brasiliaDate(new Date());
      const velho = diasAntes(hoje, 40);
      const recente = diasAntes(hoje, 1);
      criarPastaBackup(root, velho, "complete");
      criarPastaBackup(root, recente, "complete");

      const seco = rodarEntrada(SCRIPT_CLEANUP, ["--dir", root, "--dry-run"], ENV_LIMPO);
      expect(seco.status).toBe(0);
      expect(seco.stdout).toContain(`1 pasta(s) seriam removidas: ${velho}`);
      expect(existsSync(join(root, velho))).toBe(true);
      expect(lerLog(root, "cleanup.log")).toContain(`[dry-run] removeria ${velho}`);

      const real = rodarEntrada(SCRIPT_CLEANUP, ["--dir", root], ENV_LIMPO);
      expect(real.status).toBe(0);
      expect(existsSync(join(root, velho))).toBe(false);
      expect(existsSync(join(root, recente))).toBe(true);
      expect(lerLog(root, "cleanup.log")).toContain(`| INFO | removido ${velho}`);
    }, 30_000);
  });

  describe("scripts/backup-diario.mjs + retenção", () => {
    it("backup complete aplica a limpeza; backup partial não apaga nada", () => {
      const hoje = brasiliaDate(new Date());
      const velho = diasAntes(hoje, 40);

      const rootOk = novaPasta();
      criarPastaBackup(rootOk, velho, "complete");
      const ok = rodarEntrada(SCRIPT_BACKUP, [], envBackup(rootOk, escreverCliFalsa(novaPasta(), DADOS)));
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain("limpeza: 1 pasta(s) removida(s)");
      expect(existsSync(join(rootOk, velho))).toBe(false);

      const rootFalha = novaPasta();
      criarPastaBackup(rootFalha, velho, "complete");
      const falha = rodarEntrada(SCRIPT_BACKUP, [], envBackup(rootFalha, escreverCliFalsa(novaPasta(), { ...DADOS, falhaTabela: "pedidos" })));
      expect(falha.status).toBe(1);
      expect(existsSync(join(rootFalha, velho))).toBe(true);
      expect(existsSync(join(rootFalha, "logs", "cleanup.log"))).toBe(false);
    }, 60_000);
  });

  function gravarManifest(dir: string, nome: string, tables: TableEntry[]): string {
    const file = join(dir, nome);
    const m = buildManifest({
      date: "2026-09-18",
      projectRef: REF_TESTE,
      startedAt: "2026-09-18T06:30:00.000Z",
      finishedAt: "2026-09-18T06:31:00.000Z",
      tables,
      fkEdges: [],
    });
    writeFileSync(file, JSON.stringify(m, null, 2));
    return file;
  }

  describe("scripts/verify-integrity.mjs (processo real)", () => {
    it("--compare de manifests idênticos → exit 0 sem divergência", () => {
      const dir = novaPasta();
      const a = gravarManifest(dir, "a.json", [entradaDe("pedidos", [], { rowCount: 100 }), entradaDe("clientes", [], { rowCount: 50 })]);
      const r = rodarEntrada(SCRIPT_VERIFY, ["--compare", a, a], ENV_LIMPO);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("OK: sem divergência");
    }, 30_000);

    it("--compare com tabela divergindo > 5% → exit 1 citando a tabela; --tolerance 25 aceita", () => {
      const dir = novaPasta();
      const a = gravarManifest(dir, "a.json", [entradaDe("pedidos", [], { rowCount: 100 })]);
      const b = gravarManifest(dir, "b.json", [entradaDe("pedidos", [], { rowCount: 80 })]);
      const r = rodarEntrada(SCRIPT_VERIFY, ["--compare", a, b], ENV_LIMPO);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("ERRO: tabela pedidos: base 100, outro 80 (20.0%)");
      expect(rodarEntrada(SCRIPT_VERIFY, ["--compare", a, b, "--tolerance", "25"], ENV_LIMPO).status).toBe(0);
    }, 30_000);

    it("--backup: íntegro → exit 0; .json.gz corrompido → exit 1", async () => {
      const dir = novaPasta();
      await montarBackup(dir, { clientes: [{ id: 1 }, { id: 2 }] });
      expect(rodarEntrada(SCRIPT_VERIFY, ["--backup", dir], ENV_LIMPO).status).toBe(0);
      writeFileSync(join(dir, "tables", "clientes.json.gz"), "lixo");
      const r = rodarEntrada(SCRIPT_VERIFY, ["--backup", dir], ENV_LIMPO);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("tabela clientes");
    }, 30_000);

    it("--live compara o manifest com count(*) atual (CLI falsa, só leitura)", async () => {
      const dir = novaPasta();
      await montarBackup(dir, { clientes: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] });
      const igual = escreverCliFalsa(novaPasta(), { tabelas: { clientes: { pk: ["id"], linhas: [], contagem: 5 } } });
      const menor = escreverCliFalsa(novaPasta(), { tabelas: { clientes: { pk: ["id"], linhas: [], contagem: 1 } } });

      const ok = rodarEntrada(SCRIPT_VERIFY, ["--live", dir, "--project-ref", REF_TESTE], { ...ENV_LIMPO, ERPOS_SUPABASE_CLI: igual });
      expect(ok.status).toBe(0);
      const diverge = rodarEntrada(SCRIPT_VERIFY, ["--live", dir, "--project-ref", REF_TESTE], { ...ENV_LIMPO, ERPOS_SUPABASE_CLI: menor });
      expect(diverge.status).toBe(1);
      expect(diverge.stdout).toContain("tabela clientes: base 5, outro 1");
    }, 30_000);

    it("sem argumentos → exit 2 com a forma de uso", () => {
      const r = rodarEntrada(SCRIPT_VERIFY, [], ENV_LIMPO);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("uso:");
    }, 30_000);
  });
  ```
  Esperado: arquivo salvo; `describe` de T05/T06 intactos. Os testes da entrada usam datas relativas a `brasiliaDate(new Date())` (hoje − 40 / hoje − 1), então não dependem do dia em que rodam.

- [ ] **Step 2: Rodar e ver falhar pelo motivo certo**
  ```
  npx vitest run src/test/lib/backupIntegration.test.ts
  ```
  Esperado: FAIL da suíte com `Cannot find module '../../../scripts/backup/lib/cleanup.mjs'`.

- [ ] **Step 3: Criar `scripts/backup/lib/cleanup.d.mts` e `scripts/backup/lib/cleanup.mjs`** (completos) — `cleanup.d.mts`:
  ```ts
  import type { BackupConfig } from "./config.mjs";
  export declare function runCleanup(input: { config: BackupConfig; today: string; dryRun?: boolean }): Promise<{ removed: string[] }>;
  ```
  e `cleanup.mjs`:
  ```js
  /**
   * cleanup.mjs — retenção dos backups diários (T07)
   *
   * Lista as pastas de config.backupDir, marca como "complete" só as AAAA-MM-DD
   * cujo manifest.json diz status "complete", pede a selectExpired o que passou
   * da retenção (nunca o completo mais recente) e apaga. Uma linha por pasta em
   * logs/cleanup.log + resumo. Em dryRun nada é apagado e `removed` lista o que
   * SERIA removido.
   */
  import { existsSync, readFileSync, readdirSync } from "node:fs";
  import { rm } from "node:fs/promises";
  import { join } from "node:path";
  import { appendLog } from "./files.mjs";
  import { selectExpired } from "./retention.mjs";

  function manifestComplete(dir) {
    try {
      return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).status === "complete";
    } catch {
      return false;
    }
  }

  export async function runCleanup({ config, today, dryRun = false }) {
    const root = config.backupDir;
    const logFile = join(root, "logs", "cleanup.log");
    const prefix = dryRun ? "[dry-run] " : "";
    const entries = existsSync(root)
      ? readdirSync(root, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => ({ name: d.name, complete: !d.name.includes(".partial") && manifestComplete(join(root, d.name)) }))
      : [];
    const expired = selectExpired(entries, today, config.retentionDays);

    const removed = [];
    for (const name of expired) {
      if (dryRun) {
        appendLog(logFile, "INFO", `[dry-run] removeria ${name}`);
        removed.push(name);
        continue;
      }
      try {
        await rm(join(root, name), { recursive: true, force: true });
        appendLog(logFile, "INFO", `removido ${name}`);
        removed.push(name);
      } catch (e) {
        appendLog(logFile, "ERROR", `falha ao remover ${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    appendLog(
      logFile,
      expired.length === removed.length ? "INFO" : "ERROR",
      `${prefix}limpeza em ${today} (retenção ${config.retentionDays} dias): ${removed.length} de ${expired.length} pasta(s) expirada(s) ${dryRun ? "seriam removidas" : "removidas"}`,
    );
    return { removed };
  }
  ```
  Esperado: a decisão do que expira é 100 % `selectExpired` (nunca o completo mais recente).

- [ ] **Step 4: Criar a entrada `scripts/cleanup-backups.mjs`** (corpo completo):
  ```js
  #!/usr/bin/env node
  /**
   * cleanup-backups.mjs — aplica a retenção dos backups diários (specs/2026-09-backup-diario)
   *
   *   node scripts/cleanup-backups.mjs [--dir <pasta>] [--dry-run]
   *
   * Remove pastas AAAA-MM-DD e AAAA-MM-DD.partial-HHmmss mais antigas que
   * ERPOS_BACKUP_RETENTION_DAYS (default 30), nunca o backup completo mais recente.
   * Log em {pasta}/logs/cleanup.log. Exit: 0 ok · 2 erro.
   */
  import { dirname, resolve } from "node:path";
  import { fileURLToPath } from "node:url";
  import { runCleanup } from "./backup/lib/cleanup.mjs";
  import { resolveConfig } from "./backup/lib/config.mjs";
  import { brasiliaDate } from "./backup/lib/retention.mjs";

  const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  try {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes("--dry-run");
    const config = resolveConfig({ env: process.env, argv, repoRoot: REPO_ROOT });
    const { removed } = await runCleanup({ config, today: brasiliaDate(new Date()), dryRun });
    const verb = dryRun ? "seriam removidas" : "removidas";
    console.log(`${removed.length} pasta(s) ${verb}${removed.length ? `: ${removed.join(", ")}` : ""}`);
  } catch (e) {
    console.error(`erro: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
  }
  ```
  Esperado: `--dir` e as variáveis `ERPOS_BACKUP_*` resolvidas por `resolveConfig` (recusa pasta dentro do repo).

- [ ] **Step 5: Criar a entrada `scripts/verify-integrity.mjs`** (corpo completo):
  ```js
  #!/usr/bin/env node
  /**
   * verify-integrity.mjs — verificação reutilizável dos backups diários (specs/2026-09-backup-diario)
   *
   *   node scripts/verify-integrity.mjs --backup <pasta>
   *       reabre cada tables/*.json.gz e confere contagem + checksum com o manifest
   *   node scripts/verify-integrity.mjs --compare <manifestA.json> <manifestB.json> [--tolerance 5]
   *       compara dois manifests (ex.: antes/depois de uma restauração)
   *   node scripts/verify-integrity.mjs --live <pasta> --project-ref <ref> [--tolerance 5]
   *       compara o manifest com count(*) atual do banco (SÓ LEITURA, via CLI)
   *
   * Exit: 0 ok · 1 divergência · 2 uso inválido/erro.
   */
  import { readFileSync } from "node:fs";
  import { join } from "node:path";
  import { createCliRunner } from "./backup/lib/cli.mjs";
  import { verifyBackupDir } from "./backup/lib/files.mjs";
  import { buildManifest, compareManifests } from "./backup/lib/manifest.mjs";
  import { countsSql } from "./backup/lib/queries.mjs";

  const USAGE =
    "uso: --backup <pasta> | --compare <manifestA.json> <manifestB.json> [--tolerance 5] | --live <pasta> --project-ref <ref> [--tolerance 5]";

  function argAfter(argv, name, offset = 1) {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + offset] : undefined;
  }

  function readManifest(file) {
    return JSON.parse(readFileSync(file, "utf8"));
  }

  function report(result) {
    for (const e of result.errors) console.log(`ERRO: ${e}`);
    for (const w of result.warnings ?? []) console.log(`AVISO: ${w}`);
    console.log(result.ok ? "OK: sem divergência" : `DIVERGÊNCIA: ${result.errors.length} erro(s)`);
    return result.ok ? 0 : 1;
  }

  async function liveManifest(base, projectRef) {
    const runQuery = createCliRunner({ projectRef, supabaseCli: process.env.ERPOS_SUPABASE_CLI, readOnly: true });
    const rows = await runQuery(countsSql(base.tables.map((t) => t.name)));
    const now = new Date().toISOString();
    return buildManifest({
      date: base.date,
      projectRef,
      startedAt: now,
      finishedAt: now,
      tables: rows.map((r) => ({
        name: String(r.table_name),
        file: "",
        rowCount: Number(r.row_count),
        expectedRowCount: null,
        checksum: null,
        pkColumns: [],
        columns: [],
      })),
      fkEdges: [],
    });
  }

  async function main(argv) {
    const tolRaw = argAfter(argv, "--tolerance");
    const tolerancePct = tolRaw === undefined ? 5 : Number(tolRaw);
    if (!Number.isFinite(tolerancePct) || tolerancePct < 0) throw new Error(`--tolerance inválido: ${tolRaw}`);

    if (argv.includes("--backup")) {
      const dir = argAfter(argv, "--backup");
      if (!dir) throw new Error(USAGE);
      return report({ ...(await verifyBackupDir(dir)), warnings: [] });
    }
    if (argv.includes("--compare")) {
      const a = argAfter(argv, "--compare", 1);
      const b = argAfter(argv, "--compare", 2);
      if (!a || !b) throw new Error(USAGE);
      return report(compareManifests(readManifest(a), readManifest(b), { tolerancePct }));
    }
    if (argv.includes("--live")) {
      const dir = argAfter(argv, "--live");
      const projectRef = argAfter(argv, "--project-ref");
      if (!dir || !projectRef) throw new Error(USAGE);
      const manifest = readManifest(join(dir, "manifest.json"));
      const base = { ...manifest, tables: manifest.tables.filter((t) => !t.error) };
      return report(compareManifests(base, await liveManifest(base, projectRef), { tolerancePct }));
    }
    throw new Error(USAGE);
  }

  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(`erro: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
  }
  ```
  Esperado: `--live` só monta `countsSql` e passa por `createCliRunner({ readOnly: true })`.

- [ ] **Step 6: Ligar a limpeza na entrada `scripts/backup-diario.mjs`** (4 trechos). Trocar
  ```js
   * grava em {ERPOS_BACKUP_DIR}/{AAAA-MM-DD}/ e registra em logs/backup.log.
  ```
  por
  ```js
   * grava em {ERPOS_BACKUP_DIR}/{AAAA-MM-DD}/ e registra em logs/backup.log.
   * Só depois de um backup complete aplica a retenção (logs/cleanup.log).
  ```
  trocar
  ```js
  import { createCliRunner } from "./backup/lib/cli.mjs";
  ```
  por
  ```js
  import { runCleanup } from "./backup/lib/cleanup.mjs";
  import { createCliRunner } from "./backup/lib/cli.mjs";
  ```
  e trocar
  ```js
  import { runBackup } from "./backup/lib/runBackup.mjs";
  ```
  por
  ```js
  import { brasiliaDate } from "./backup/lib/retention.mjs";
  import { runBackup } from "./backup/lib/runBackup.mjs";
  ```
  e, logo antes da linha `  process.exitCode = result.status === "complete" || result.status === "skipped" ? 0 : 1;`, inserir:
  ```js
    if (result.status === "complete") {
      // retenção só depois de um backup completo (RF-5/RF-7): partial/aborted/skipped não apagam nada
      const { removed } = await runCleanup({ config, today: brasiliaDate(new Date()) });
      console.log(`limpeza: ${removed.length} pasta(s) removida(s)`);
    }
  ```
  Esperado: arquivo final = o do Step 6 da T06 com essas 4 inserções (1 linha de comentário, 2 imports, 1 bloco `if`).

- [ ] **Step 7: Rodar o teste e ver passar**
  ```
  npx vitest run src/test/lib/backupIntegration.test.ts
  ```
  Esperado: PASS — 35 testes (25 anteriores + 3 `runCleanup` + 1 `cleanup-backups.mjs` + 1 backup+retenção + 5 `verify-integrity.mjs`).

- [ ] **Step 8: Refactor/limpeza** — sem export fora do Contrato; nenhuma regra de data duplicada fora de `retention.mjs`; nenhum `rm` fora de `runCleanup`. Se mudar algo, repetir o Step 7.
  Esperado: sem alteração de comportamento.

- [ ] **Step 9: Gate iterativo + fechamento da trilha**
  ```
  npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"
  npx vitest run
  npx vite build
  ```
  Esperado: ≤ 292; suíte sem falha nova; build passa (`scripts/` fica fora do bundle).

### Definição de pronto (DoD)
- [ ] `cleanup.mjs`, `cleanup.d.mts`, `cleanup-backups.mjs`, `verify-integrity.mjs` criados; `backup-diario.mjs` chama `runCleanup` só após `complete`; `backupIntegration.test.ts` verde (35).
- [ ] Critério de sucesso: pasta de teste com datas fictícias (hoje 2026-09-30) → remove `2026-08-01`, `2026-08-15.partial-031500`, `2026-08-30`; mantém `2026-08-31`, `2026-09-29`, `logs`, `backup.lock`; `cleanup.log` escrito; `--dry-run` não apaga.
- [ ] Critério de sucesso: `verify-integrity --compare a a` → exit 0; tabela 100 → 80 → exit 1 citando a tabela; `--backup` íntegro 0 / corrompido 1; `--live` com CLI falsa 0 / 1.
- [ ] Backup `partial` pela entrada não apaga nada nem cria `cleanup.log` (RF-7).
- [ ] Interfaces = Contratos; gate ok (tsc ≤ 292, vitest sem falha nova, `vite build`); sem shadow code; nenhum teste chama a CLI real; sem commit.

---

## T08: Entrada `restore-from-backup.mjs` (dry-run padrão, produção recusada)

| Campo | Valor |
|-------|-------|
| **Entregável** | `runRestore` exportada + entrada `node scripts/restore-from-backup.mjs`: verifica o backup, ordena por FK, gera `NNN-<tabela>-<k>.sql` (dry-run padrão) e, com `--apply`, executa arquivo a arquivo **só** num projeto confirmado, diferente de produção **e vazio** (pré-checagem `public.tenants`) — testado com fixture + runner mock |
| **Onde** | `scripts/restore-from-backup.mjs` (criar), `scripts/restore-from-backup.d.mts` (criar), `src/test/lib/restoreValidation.test.ts` (modificar: imports + novos `describe`) |
| **Depende de** | T04 (`topoSortTables`, `chunkRows`, `buildInsertSql`, `assertRestoreTarget`), T05 (`createCliRunner`, `readTableGz`, `verifyBackupDir`, `writeTableGz`) |
| **Bloqueia** | T10 |
| **Paralelo com** | T06, T07 (Onde disjunto; **não** depende de `runBackup` — a fixture é montada com `writeTableGz` + `checksumRows` + `buildManifest`) |
| **Profundidade** | snippets (corpo completo) — override; teste completo |
| **Requisitos** | RF-9 (restauração por script respeitando a ordem das FKs; parcial com `--tables`), Restrições "nunca escrever em produção" (produção recusada em código, sem escape; dry-run padrão; `--confirm-project-ref` obrigatório), "teste de restore usa runner mock (nunca CLI real)", "sem Docker/`psql`"; Edge cases "restauração contra produção → recusada" (guarda de ref + pré-checagem de alvo vazio), "restauração parcial respeitando FK", "backup corrompido → recusado antes de gerar"; US-02 |

### Context pack
- **Spec:** §2 RF-9, Restrições (produção proibida; sem `psql`), Edge cases de restauração; §4 US-02.
- **Constraints:** ver [Global Constraints](#global-constraints) (ratificação: `restore-from-backup.mjs` recusa `PRODUCTION_PROJECT_REF` como alvo de `--apply`; decisão "Restauração") e [Contratos entre módulos](#contratos-entre-módulos-interfaces-globais--nomesassinaturas-verbatim) (seção `Entradas` → `restore-from-backup.mjs`, e `restore.mjs (T04)`).
- **Padrão do repo:** entrada Node ESM com bloco main guardado por `import.meta.url === pathToFileURL(process.argv[1]).href` (o Vitest importa o módulo sem rodar o main); teste no `restoreValidation.test.ts` (T04, já com `// @vitest-environment node`), pastas temporárias `erpos-bk-` limpas em `afterEach`.
- **Arquivos vizinhos:** `scripts/backup/lib/restore.mjs` (T04), `scripts/backup/lib/files.mjs` e `cli.mjs` (T05), `scripts/backup/lib/config.mjs` (T01 — `PRODUCTION_PROJECT_REF`).
- **Não fazer:** não importar `runBackup.mjs` nem tocar em `backupIntegration.test.ts` (trilha paralela); nenhuma flag de escape para produção; não chamar `createCliRunner` em teste (sempre `runQuery` mock ou caminho que falha antes); nunca rodar `--apply` contra projeto real nesta fase (teste manual é da T10, em projeto separado); não mexer nos `describe` de T04; sem commit.

### Interfaces
- **Consumes** (verbatim dos Contratos):
  ```ts
  export const PRODUCTION_PROJECT_REF: "mdghhjemzdmeuqpzuyzx";                                               // config.mjs (T01)
  export function topoSortTables(tables: string[], fkEdges: { child: string; parent: string }[]): { order: string[]; cycles: string[] }; // restore.mjs (T04)
  export function chunkRows(rows: unknown[], maxBytes: number): unknown[][];
  export function buildInsertSql(table: string, columns: { name: string; generated: boolean }[], rows: unknown[], opts?: { onConflict?: "nothing" | "error" }): string;
  export function assertRestoreTarget(input: { projectRef: string | undefined; confirmProjectRef: string | undefined; productionRef: string }): void;
  export type QueryRunner = (sql: string) => Promise<Record<string, unknown>[]>;                               // cli.mjs (T05)
  export function createCliRunner(opts: { projectRef: string; supabaseCli?: string; readOnly: boolean; tmpDir?: string }): QueryRunner;
  export class CliOutputError extends Error { kind: "auth" | "network" | "sql" | "unknown"; constructor(message: string, kind: "auth" | "network" | "sql" | "unknown") } // queries.mjs (T01, pré-checagem)
  export function readTableGz(path: string): Promise<unknown[]>;                                               // files.mjs (T05)
  export function verifyBackupDir(dir: string): Promise<{ ok: boolean; errors: string[]; manifest: Manifest | null }>;
  export function writeTableGz(path: string, rows: unknown[]): Promise<number>;                                // (fixture do teste)
  export function checksumRows(rows: unknown[]): string;                                                       // manifest.mjs (T02, fixture)
  export function buildManifest(input: { date: string; projectRef: string; startedAt: string; finishedAt: string; tables: TableEntry[]; fkEdges: FkEdge[] }): Manifest;
  ```
- **Produces** (verbatim dos Contratos):
  ```ts
  export function runRestore(input: { backupDir: string; tables?: string[]; outDir?: string; apply: boolean; projectRef?: string; confirmProjectRef?: string; onConflict?: "nothing" | "error"; runQuery?: QueryRunner; maxChunkBytes?: number }): Promise<{ files: string[]; applied: number; order: string[]; cycles: string[] }>;
  ```
  CLI: `--backup <dir> [--tables a,b] [--out <dir>] [--apply --project-ref X --confirm-project-ref X] [--on-conflict nothing|error]`; exit 0 ok, 1 erro (inclui produção recusada).
  **Pré-checagem de alvo vazio (Contrato, defesa independente da semântica `--linked`/`--project-ref` da CLI):** com `apply`, depois de `assertRestoreTarget` e do `verifyBackupDir` e **antes** de gerar/enviar qualquer SQL de restauração, `runRestore` executa `runQuery("select (select count(*) from public.tenants)::int as n")`; consulta rejeitada com `CliOutputError` de `kind` `"sql"` (ex.: 42P01, `public.tenants` não existe) ou resposta sem `n` numérico → throw contendo "aplique as migrations no projeto alvo antes"; rejeitada com `kind` `"auth"`/`"network"`/`"unknown"` (ou erro que não é `CliOutputError`) → throw contendo "não foi possível consultar o projeto alvo [kind]" (sem falar em migrations); `n > 0` → throw contendo "alvo não está vazio"; nos dois casos nenhum `.sql` é gerado nem enviado. `applied` conta só os SQLs de restauração (o runner recebe 1 pré-checagem + N arquivos).
  Precisões (não mudam assinatura): com `apply`, `assertRestoreTarget` roda **antes** até do `verifyBackupDir` (nenhum IO com alvo inválido); `NNN` = posição 1-based em `order` e `k` = lote 1-based (`001-clientes-1.sql`); tabela sem linhas entra em `order` mas não gera arquivo; tabelas com `error` no manifest ficam fora (e `--tables` com elas é recusado: `tabela(s) fora do backup ou com erro`); `runQuery` default = `createCliRunner({ projectRef, supabaseCli: process.env.ERPOS_SUPABASE_CLI, readOnly: false })`, um arquivo por vez na ordem.
  Consumidor: T10 (`docs/RESTORE.md` e teste manual em projeto Supabase separado).

### Steps
- [ ] **Step 1: Escrever os testes** — em `src/test/lib/restoreValidation.test.ts`: (a) trocar as duas primeiras linhas de import
  ```ts
  import { describe, it, expect } from "vitest";
  import { assertRestoreTarget, buildInsertSql, chunkRows, topoSortTables } from "../../../scripts/backup/lib/restore.mjs";
  ```
  por
  ```ts
  import { describe, it, expect, afterEach } from "vitest";
  import { assertRestoreTarget, buildInsertSql, chunkRows, topoSortTables } from "../../../scripts/backup/lib/restore.mjs";
  import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { basename, join, resolve } from "node:path";
  import { spawnSync } from "node:child_process";
  import type { QueryRunner } from "../../../scripts/backup/lib/cli.mjs";
  import { writeTableGz } from "../../../scripts/backup/lib/files.mjs";
  import { buildManifest, checksumRows } from "../../../scripts/backup/lib/manifest.mjs";
  import type { TableEntry } from "../../../scripts/backup/lib/manifest.mjs";
  import { CliOutputError } from "../../../scripts/backup/lib/queries.mjs";
  import { runRestore } from "../../../scripts/restore-from-backup.mjs";
  ```
  (b) no fim do arquivo, acrescentar:
  ```ts
  // ---------------------------------------------------------------- T08: runRestore + entrada restore-from-backup.mjs

  const pastasRestore: string[] = [];

  function pastaTemp(): string {
    const dir = mkdtempSync(join(tmpdir(), "erpos-bk-"));
    pastasRestore.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of pastasRestore.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const TABELAS_FIXTURE: Record<string, Record<string, unknown>[]> = {
    clientes: [
      { id: 1, nome: "Ana" },
      { id: 2, nome: "Bia" },
      { id: 3, nome: "Caio" },
    ],
    pedidos: [{ id: 10, cliente_id: 1 }],
    itens: [{ id: 100, pedido_id: 10 }],
    vazia: [],
  };

  /** Backup de fixture montado direto com writeTableGz + checksumRows + buildManifest (sem runBackup). */
  async function montarBackupFixture(): Promise<string> {
    const dir = pastaTemp();
    const entries: TableEntry[] = [];
    for (const [name, rows] of Object.entries(TABELAS_FIXTURE)) {
      await writeTableGz(join(dir, "tables", `${name}.json.gz`), rows);
      entries.push({
        name,
        file: `${name}.json.gz`,
        rowCount: rows.length,
        expectedRowCount: rows.length,
        checksum: checksumRows(rows),
        pkColumns: ["id"],
        columns: Object.keys(rows[0] ?? { id: 0 }).map((c) => ({ name: c, generated: false })),
      });
    }
    const manifest = buildManifest({
      date: "2026-09-18",
      projectRef: PRODUCAO,
      startedAt: "2026-09-18T06:30:00.000Z",
      finishedAt: "2026-09-18T06:31:00.000Z",
      tables: entries,
      fkEdges: [
        { child: "pedidos", parent: "clientes" },
        { child: "itens", parent: "pedidos" },
      ],
    });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    return dir;
  }

  const PRE_CHECAGEM = "select (select count(*) from public.tenants)::int as n";

  /**
   * Runner mock (nunca a CLI real): registra o SQL recebido; na pré-checagem de alvo vazio responde
   * { n: tenants } — ou rejeita com o erro dado (ex.: [sql] 42P01 = projeto sem as migrations).
   */
  function runnerMock(opts: { tenants?: number; erroPreChecagem?: Error } = {}): { runQuery: QueryRunner; recebidos: string[] } {
    const recebidos: string[] = [];
    return {
      recebidos,
      runQuery: async (sql) => {
        recebidos.push(sql);
        if (sql === PRE_CHECAGEM) {
          if (opts.erroPreChecagem) throw opts.erroPreChecagem;
          return [{ n: opts.tenants ?? 0 }];
        }
        return [];
      },
    };
  }

  const nomes = (files: string[]) => files.map((f) => basename(f));

  describe("runRestore (dry-run padrão, produção recusada, runner mock)", () => {
    it("dry-run gera NNN-<tabela>-<k>.sql na ordem das FKs (pai antes de filho) e não executa nada", async () => {
      const dir = await montarBackupFixture();
      const mock = runnerMock();
      const r = await runRestore({ backupDir: dir, apply: false, runQuery: mock.runQuery });

      expect(r.order).toEqual(["clientes", "pedidos", "itens", "vazia"]);
      expect(r.cycles).toEqual([]);
      expect(nomes(r.files)).toEqual(["001-clientes-1.sql", "002-pedidos-1.sql", "003-itens-1.sql"]); // vazia não gera arquivo
      expect(r.files.every((f) => f.startsWith(join(dir, "restore-sql")))).toBe(true);
      expect(r.applied).toBe(0);
      expect(mock.recebidos).toEqual([]);
      for (const f of r.files) expect(readFileSync(f, "utf8").startsWith("set session_replication_role = replica;\n")).toBe(true);
      expect(readFileSync(r.files[0], "utf8")).toContain('insert into public."clientes" ("id", "nome")');
      expect(readFileSync(r.files[0], "utf8")).toContain("on conflict do nothing;");
    });

    it("maxChunkBytes pequeno divide a tabela em vários arquivos -<k>", async () => {
      const dir = await montarBackupFixture();
      const r = await runRestore({ backupDir: dir, apply: false, maxChunkBytes: 40 });
      expect(nomes(r.files).filter((n) => n.includes("clientes"))).toEqual([
        "001-clientes-1.sql",
        "001-clientes-2.sql",
        "001-clientes-3.sql",
      ]);
    });

    it("tables filtra e reordena por FK; outDir e onConflict error são respeitados; tabela desconhecida é recusada", async () => {
      const dir = await montarBackupFixture();
      const out = pastaTemp();
      const r = await runRestore({ backupDir: dir, apply: false, tables: ["itens", "clientes"], outDir: out, onConflict: "error" });
      expect(r.order).toEqual(["clientes", "itens"]);
      expect(nomes(r.files)).toEqual(["001-clientes-1.sql", "002-itens-1.sql"]);
      expect(readdirSync(out).sort()).toEqual(["001-clientes-1.sql", "002-itens-1.sql"]);
      expect(readFileSync(r.files[0], "utf8")).not.toContain("on conflict");
      await expect(runRestore({ backupDir: dir, apply: false, tables: ["nao_existe"] })).rejects.toThrow("fora do backup");
    });

    it("apply contra PRODUÇÃO é recusado antes de gerar arquivo ou chamar o runner", async () => {
      const dir = await montarBackupFixture();
      const mock = runnerMock();
      await expect(
        runRestore({ backupDir: dir, apply: true, projectRef: PRODUCAO, confirmProjectRef: PRODUCAO, runQuery: mock.runQuery }),
      ).rejects.toThrow(/produção/);
      expect(mock.recebidos).toEqual([]);
      expect(existsSync(join(dir, "restore-sql"))).toBe(false);
    });

    it("apply com confirmação diferente (ou ausente) é recusado", async () => {
      const dir = await montarBackupFixture();
      const mock = runnerMock();
      await expect(
        runRestore({ backupDir: dir, apply: true, projectRef: TESTE, confirmProjectRef: "outroprojeto00000000", runQuery: mock.runQuery }),
      ).rejects.toThrow();
      await expect(runRestore({ backupDir: dir, apply: true, projectRef: TESTE, runQuery: mock.runQuery })).rejects.toThrow();
      expect(mock.recebidos).toEqual([]);
    });

    it("apply num projeto de teste vazio: 1 pré-checagem + os .sql, um por vez, na ordem", async () => {
      const dir = await montarBackupFixture();
      const mock = runnerMock({ tenants: 0 });
      const r = await runRestore({ backupDir: dir, apply: true, projectRef: TESTE, confirmProjectRef: TESTE, runQuery: mock.runQuery });
      expect(r.applied).toBe(3); // conta só os SQLs de restauração
      expect(mock.recebidos).toEqual([PRE_CHECAGEM, ...r.files.map((f) => readFileSync(f, "utf8"))]);
      expect(mock.recebidos[1]).toContain('public."clientes"');
      expect(mock.recebidos[3]).toContain('public."itens"');
    });

    it("alvo com dados (tenants > 0) é recusado sem enviar nenhum insert", async () => {
      const dir = await montarBackupFixture();
      const mock = runnerMock({ tenants: 3 });
      await expect(
        runRestore({ backupDir: dir, apply: true, projectRef: TESTE, confirmProjectRef: TESTE, runQuery: mock.runQuery }),
      ).rejects.toThrow("alvo não está vazio");
      expect(mock.recebidos).toEqual([PRE_CHECAGEM]);
      expect(mock.recebidos.some((s) => s.includes("insert"))).toBe(false);
      expect(existsSync(join(dir, "restore-sql"))).toBe(false);
    });

    it("pré-checagem com erro [sql] (public.tenants não existe) → pede para aplicar as migrations, sem insert", async () => {
      const dir = await montarBackupFixture();
      const mock = runnerMock({ erroPreChecagem: new CliOutputError('42P01: relation "public.tenants" does not exist', "sql") });
      await expect(
        runRestore({ backupDir: dir, apply: true, projectRef: TESTE, confirmProjectRef: TESTE, runQuery: mock.runQuery }),
      ).rejects.toThrow("aplique as migrations no projeto alvo antes");
      expect(mock.recebidos).toEqual([PRE_CHECAGEM]);
    });

    it("pré-checagem com erro de rede/login → \"não foi possível consultar o projeto alvo\" (sem falar em migrations), sem insert", async () => {
      const dir = await montarBackupFixture();
      const mock = runnerMock({ erroPreChecagem: new CliOutputError("fetch failed", "network") });
      const erro = await runRestore({ backupDir: dir, apply: true, projectRef: TESTE, confirmProjectRef: TESTE, runQuery: mock.runQuery }).then(
        () => null,
        (e: Error) => e,
      );
      expect(erro?.message).toContain("não foi possível consultar o projeto alvo [network]");
      expect(erro?.message).not.toContain("migrations");
      expect(mock.recebidos).toEqual([PRE_CHECAGEM]);
      expect(mock.recebidos.some((s) => s.includes("insert"))).toBe(false);
    });

    it("backup corrompido é recusado antes de gerar qualquer .sql", async () => {
      const dir = await montarBackupFixture();
      writeFileSync(join(dir, "tables", "clientes.json.gz"), "lixo");
      await expect(runRestore({ backupDir: dir, apply: false })).rejects.toThrow("backup inválido");
      expect(existsSync(join(dir, "restore-sql"))).toBe(false);
    });
  });

  const SCRIPT_RESTORE = resolve(process.cwd(), "scripts/restore-from-backup.mjs");

  function rodarRestore(args: string[]) {
    return spawnSync(process.execPath, [SCRIPT_RESTORE, ...args], {
      env: { ...process.env, ERPOS_SUPABASE_CLI: "cli-que-nunca-deve-ser-chamada" },
      encoding: "utf8",
    });
  }

  describe("scripts/restore-from-backup.mjs (processo real, sem CLI)", () => {
    it("sem --apply é dry-run: gera os .sql em --out e sai 0", async () => {
      const dir = await montarBackupFixture();
      const out = pastaTemp();
      const r = rodarRestore(["--backup", dir, "--out", out]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("dry-run: nada foi executado no banco");
      expect(readdirSync(out).sort()).toEqual(["001-clientes-1.sql", "002-pedidos-1.sql", "003-itens-1.sql"]);
    }, 30_000);

    it("--apply com o ref de produção sai 1 com erro mencionando produção", async () => {
      const dir = await montarBackupFixture();
      const r = rodarRestore(["--backup", dir, "--apply", "--project-ref", PRODUCAO, "--confirm-project-ref", PRODUCAO]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/produção/);
      expect(existsSync(join(dir, "restore-sql"))).toBe(false);
    }, 30_000);
  });
  ```
  Esperado: arquivo salvo; `describe` de T04 intactos; nenhum import de `runBackup.mjs`.

- [ ] **Step 2: Rodar e ver falhar pelo motivo certo**
  ```
  npx vitest run src/test/lib/restoreValidation.test.ts
  ```
  Esperado: FAIL da suíte com `Cannot find module '../../../scripts/restore-from-backup.mjs'`.

- [ ] **Step 3: Criar `scripts/restore-from-backup.d.mts`** (completo):
  ```ts
  import type { QueryRunner } from "./backup/lib/cli.mjs";
  export declare function runRestore(input: {
    backupDir: string;
    tables?: string[];
    outDir?: string;
    apply: boolean;
    projectRef?: string;
    confirmProjectRef?: string;
    onConflict?: "nothing" | "error";
    runQuery?: QueryRunner;
    maxChunkBytes?: number;
  }): Promise<{ files: string[]; applied: number; order: string[]; cycles: string[] }>;
  ```
  Esperado: tipo idêntico ao Contrato.

- [ ] **Step 4: Criar `scripts/restore-from-backup.mjs`** (corpo completo):
  ```js
  #!/usr/bin/env node
  /**
   * restore-from-backup.mjs — restauração de um backup diário (specs/2026-09-backup-diario, T08)
   *
   *   node scripts/restore-from-backup.mjs --backup <pasta> [--tables a,b] [--out <pasta>]
   *       DRY-RUN (padrão): só gera os .sql em <out> (default <pasta>/restore-sql), na ordem das FKs
   *   node scripts/restore-from-backup.mjs --backup <pasta> --apply --project-ref X --confirm-project-ref X [--on-conflict nothing|error]
   *       executa os .sql no projeto X pela CLI. O projeto de PRODUÇÃO é sempre recusado (sem escape).
   *
   * Sempre verifica o backup (verifyBackupDir) antes de gerar qualquer arquivo. Com --apply,
   * antes de qualquer SQL de restauração confere que o alvo está vazio (public.tenants sem linhas).
   * Passo a passo e recriação de usuários: docs/RESTORE.md.
   */
  import { mkdir, readFile, writeFile } from "node:fs/promises";
  import { join, resolve } from "node:path";
  import { pathToFileURL } from "node:url";
  import { createCliRunner } from "./backup/lib/cli.mjs";
  import { PRODUCTION_PROJECT_REF } from "./backup/lib/config.mjs";
  import { readTableGz, verifyBackupDir } from "./backup/lib/files.mjs";
  import { CliOutputError } from "./backup/lib/queries.mjs";
  import { assertRestoreTarget, buildInsertSql, chunkRows, topoSortTables } from "./backup/lib/restore.mjs";

  const TARGET_EMPTY_SQL = "select (select count(*) from public.tenants)::int as n";

  /**
   * Defesa independente da semântica --linked/--project-ref da CLI: produção tem lojas, então
   * só um projeto recém-criado (migrations aplicadas, sem dados) passa.
   */
  async function assertTargetEmpty(run) {
    let rows;
    try {
      rows = await run(TARGET_EMPTY_SQL);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      // só erro de SQL (ex.: 42P01, public.tenants não existe) indica schema ausente;
      // auth/network/unknown = não deu para perguntar ao alvo, e migrations não resolvem
      if (e instanceof CliOutputError && e.kind === "sql") {
        throw new Error(`pré-checagem do alvo falhou (${detail}) — aplique as migrations no projeto alvo antes de restaurar`);
      }
      const kind = e instanceof CliOutputError ? e.kind : "unknown";
      throw new Error(`não foi possível consultar o projeto alvo [${kind}]: ${detail}`);
    }
    const n = Number(rows[0]?.n);
    if (!Number.isFinite(n)) throw new Error("pré-checagem do alvo sem resposta válida — aplique as migrations no projeto alvo antes de restaurar");
    if (n > 0) throw new Error(`alvo não está vazio: public.tenants tem ${n} linha(s) — restaure só num projeto recém-criado`);
  }

  export async function runRestore({
    backupDir,
    tables,
    outDir,
    apply,
    projectRef,
    confirmProjectRef,
    onConflict = "nothing",
    runQuery,
    maxChunkBytes = 5_000_000,
  }) {
    // guarda de alvo ANTES de qualquer IO ou chamada
    if (apply) assertRestoreTarget({ projectRef, confirmProjectRef, productionRef: PRODUCTION_PROJECT_REF });

    const verify = await verifyBackupDir(backupDir);
    if (!verify.ok || !verify.manifest) {
      throw new Error(`backup inválido em ${backupDir}: ${verify.errors.join("; ")}`);
    }
    const manifest = verify.manifest;

    // apply: pré-checagem de alvo vazio ANTES de gerar/enviar qualquer SQL de restauração
    const run = apply
      ? (runQuery ?? createCliRunner({ projectRef, supabaseCli: process.env.ERPOS_SUPABASE_CLI, readOnly: false }))
      : null;
    if (run) await assertTargetEmpty(run);

    const byName = new Map(manifest.tables.filter((t) => !t.error).map((t) => [t.name, t]));

    let selected = [...byName.keys()];
    if (tables && tables.length > 0) {
      const missing = tables.filter((t) => !byName.has(t));
      if (missing.length > 0) throw new Error(`tabela(s) fora do backup ou com erro: ${missing.join(", ")}`);
      selected = [...new Set(tables)];
    }
    const { order, cycles } = topoSortTables(selected, manifest.fkEdges);

    const target = resolve(outDir ?? join(backupDir, "restore-sql"));
    await mkdir(target, { recursive: true });
    const files = [];
    for (const [i, name] of order.entries()) {
      const entry = byName.get(name);
      const rows = await readTableGz(join(backupDir, "tables", entry.file));
      for (const [k, chunk] of chunkRows(rows, maxChunkBytes).entries()) {
        const file = join(target, `${String(i + 1).padStart(3, "0")}-${name}-${k + 1}.sql`);
        await writeFile(file, buildInsertSql(name, entry.columns, chunk, { onConflict }), "utf8");
        files.push(file);
      }
    }

    let applied = 0;
    if (run) {
      for (const file of files) {
        await run(await readFile(file, "utf8")); // um arquivo por vez, na ordem das FKs
        applied++;
      }
    }
    return { files, applied, order, cycles };
  }

  function argAfter(argv, name) {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  }

  if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const argv = process.argv.slice(2);
    try {
      const backupDir = argAfter(argv, "--backup");
      if (!backupDir) throw new Error("uso: --backup <pasta> [--tables a,b] [--out <pasta>] [--apply --project-ref X --confirm-project-ref X] [--on-conflict nothing|error]");
      const onConflict = argAfter(argv, "--on-conflict") ?? "nothing";
      if (onConflict !== "nothing" && onConflict !== "error") throw new Error(`--on-conflict inválido: ${onConflict}`);
      const tablesArg = argAfter(argv, "--tables");
      const outArg = argAfter(argv, "--out");
      const result = await runRestore({
        backupDir: resolve(backupDir),
        tables: tablesArg ? tablesArg.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
        outDir: outArg ? resolve(outArg) : undefined,
        apply: argv.includes("--apply"),
        projectRef: argAfter(argv, "--project-ref"),
        confirmProjectRef: argAfter(argv, "--confirm-project-ref"),
        onConflict,
      });
      console.log(`ordem: ${result.order.join(" → ")}`);
      if (result.cycles.length > 0) console.log(`AVISO: tabelas em ciclo de FK (no fim da ordem): ${result.cycles.join(", ")}`);
      console.log(`${result.files.length} arquivo(s) .sql gerado(s)${result.files.length ? ` em ${resolve(result.files[0], "..")}` : ""}`);
      console.log(argv.includes("--apply") ? `${result.applied} arquivo(s) aplicado(s)` : "dry-run: nada foi executado no banco");
    } catch (e) {
      console.error(`erro: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  }
  ```
  Esperado: sem `--apply` nenhum runner é criado; produção recusada antes de qualquer IO; com `--apply` a pré-checagem `public.tenants` roda antes de gerar/enviar SQL (alvo com dados ou sem migrations → recusa; falha de login/rede → "não foi possível consultar o projeto alvo [kind]"); `.sql` aplicados um por vez na ordem das FKs.

- [ ] **Step 5: Rodar o teste e ver passar**
  ```
  npx vitest run src/test/lib/restoreValidation.test.ts
  ```
  Esperado: PASS — 29 testes (17 de T04 + 10 de `runRestore` + 2 da entrada).

- [ ] **Step 6: Refactor/limpeza** — sem export além de `runRestore`; nenhuma flag/variável que pule `assertRestoreTarget`; sem segunda ordenação por FK (só `topoSortTables`); nenhum caminho de `--apply` que pule `assertTargetEmpty`. Se mudar algo, repetir o Step 5.
  ```
  grep -n "PRODUCTION_PROJECT_REF" scripts/restore-from-backup.mjs
  ```
  Esperado: só o import e a chamada de `assertRestoreTarget`; sem alteração de comportamento.

- [ ] **Step 7: Gate iterativo + fechamento da trilha**
  ```
  npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"
  npx vitest run
  npx vite build
  ```
  Esperado: ≤ 292; suíte sem falha nova; build passa. (Quando T07 e T08 estiverem prontas, rodar o critério de sucesso da spec: `npx vitest run src/test/lib/backupUtils.test.ts src/test/lib/backupIntegration.test.ts src/test/lib/restoreValidation.test.ts` → 3 arquivos verdes, e o gate completo `node scripts/check.mjs --force` → exit 0.)

### Definição de pronto (DoD)
- [ ] `restore-from-backup.mjs` + `restore-from-backup.d.mts` criados; `restoreValidation.test.ts` verde (29).
- [ ] Dry-run padrão: `001-clientes-1.sql`, `002-pedidos-1.sql`, `003-itens-1.sql` (pai antes de filho), cada um começando com `set session_replication_role = replica;`; runner nunca chamado.
- [ ] `--tables` filtra e reordena; tabela desconhecida recusada; `maxChunkBytes` divide em `-1`, `-2`, `-3`.
- [ ] Produção recusada (função e entrada) sem gerar arquivo nem chamar runner; confirmação diferente/ausente recusada; projeto de teste confirmado e vazio → runner recebe 1 pré-checagem + os SQLs na ordem e `applied` = nº de arquivos; backup corrompido recusado antes de gerar.
- [ ] Pré-checagem de alvo vazio: `n: 3` → recusa com "alvo não está vazio" e nenhum `insert` enviado (nem `.sql` gerado); pré-checagem rejeitada com `[sql]` → recusa com "aplique as migrations no projeto alvo antes"; rejeitada com `[network]` (ou `auth`/`unknown`) → recusa com "não foi possível consultar o projeto alvo [network]", sem mencionar migrations; nos dois casos só a pré-checagem chega ao runner (nenhum `insert`).
- [ ] Nenhum teste usa a CLI real; `runRestore` não depende de `runBackup`; Interfaces = Contratos; gate ok (tsc ≤ 292, vitest, `vite build`); sem shadow code; sem commit.

---

<!-- Blocos ## T01 … ## T10 detalhados nas Ondas 1–3 pelo planejador de cada fase. -->
