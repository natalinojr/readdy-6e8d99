#!/usr/bin/env node
// Backup diário do banco Supabase (schema public, exceto auth) — specs/2026-09-backup-diario.
// Só leitura. Uso: node scripts/backup-diario.mjs [--dir <pasta>]
// Variáveis: ERPOS_BACKUP_DIR, ERPOS_BACKUP_PROJECT_REF, ERPOS_BACKUP_RETENTION_DAYS,
//            ERPOS_BACKUP_PAGE_SIZE, ERPOS_BACKUP_MIN_FREE_MB, ERPOS_SUPABASE_CLI
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "./backup/lib/config.mjs";
import { createCliRunner } from "./backup/lib/cli.mjs";
import { runBackup } from "./backup/lib/runBackup.mjs";
import { runCleanup } from "./backup/lib/cleanup.mjs";
import { brasiliaDate } from "./backup/lib/retention.mjs";
import { appendLog } from "./backup/lib/files.mjs";
import { join } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  let config;
  try {
    config = resolveConfig({ env: process.env, argv: process.argv.slice(2), repoRoot });
  } catch (e) {
    console.error(`[backup-diario] config inválida: ${e.message}`);
    process.exit(2);
  }

  const runQuery = createCliRunner({ projectRef: config.projectRef, supabaseCli: config.supabaseCli, readOnly: true });

  let result;
  try {
    result = await runBackup({ config, runQuery });
  } catch (e) {
    appendLog(join(config.backupDir, "logs", "backup.log"), "ERROR", `falha inesperada: ${e.message}`);
    console.error(`[backup-diario] falha inesperada: ${e.message}`);
    process.exit(2);
  }

  console.log(`[backup-diario] status=${result.status} dir=${result.dir ?? "-"}`);

  if (result.status === "complete") {
    try {
      const { removed } = await runCleanup({ config, today: brasiliaDate(new Date()) });
      console.log(`[backup-diario] limpeza: ${removed.length} pasta(s) removida(s)`);
    } catch (e) {
      console.error(`[backup-diario] limpeza falhou: ${e.message}`);
    }
  }

  process.exit(result.status === "complete" || result.status === "skipped" ? 0 : 1);
}

main();
