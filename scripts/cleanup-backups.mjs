#!/usr/bin/env node
// Aplica a retenção de 30 dias sobre D:\backups\erpos (ou ERPOS_BACKUP_DIR/--dir).
// Uso: node scripts/cleanup-backups.mjs [--dir <pasta>] [--dry-run]
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "./backup/lib/config.mjs";
import { runCleanup } from "./backup/lib/cleanup.mjs";
import { brasiliaDate } from "./backup/lib/retention.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  let config;
  try {
    config = resolveConfig({ env: process.env, argv, repoRoot });
  } catch (e) {
    console.error(`[cleanup-backups] config inválida: ${e.message}`);
    process.exit(2);
  }
  const { removed } = await runCleanup({ config, today: brasiliaDate(new Date()), dryRun });
  console.log(`[cleanup-backups] ${dryRun ? "(dry-run) " : ""}${removed.length} pasta(s) removida(s)`);
}

main();
