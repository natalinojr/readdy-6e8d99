#!/usr/bin/env node
// Restauração a partir de um backup. Por PADRÃO só simula (dry-run: gera os
// .sql em disco e mostra a ordem por FK + contagens). Para escrever de
// verdade exige --apply --project-ref X --confirm-project-ref X, e RECUSA
// escrever no projeto de produção (mdghhjemzdmeuqpzuyzx) mesmo assim.
// Uso:
//   node scripts/restore-from-backup.mjs --backup <dir> [--tables a,b] [--out <dir>]
//   node scripts/restore-from-backup.mjs --backup <dir> --apply --project-ref X --confirm-project-ref X [--on-conflict nothing|error]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PRODUCTION_PROJECT_REF } from "./backup/lib/config.mjs";
import { verifyBackupDir, readTableGz } from "./backup/lib/files.mjs";
import { topoSortTables, chunkRows, buildInsertSql, assertRestoreTarget } from "./backup/lib/restore.mjs";
import { createCliRunner } from "./backup/lib/cli.mjs";

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
  const verify = await verifyBackupDir(backupDir);
  if (!verify.ok) {
    throw new Error(`backup em ${backupDir} não passou na verificação: ${verify.errors.join("; ")}`);
  }
  const manifest = verify.manifest;
  const wanted = tables && tables.length ? tables : manifest.tables.filter((t) => !t.error).map((t) => t.name);
  const byName = new Map(manifest.tables.map((t) => [t.name, t]));
  for (const name of wanted) {
    if (!byName.has(name)) throw new Error(`tabela ${name} não está no backup`);
  }

  const { order, cycles } = topoSortTables(wanted, manifest.fkEdges);

  if (apply) {
    assertRestoreTarget({ projectRef, confirmProjectRef, productionRef: PRODUCTION_PROJECT_REF });
    const runner = runQuery ?? createCliRunner({ projectRef, readOnly: false });
    // defesa independente do --project-ref: nunca escreve num alvo que já tem dados
    // (produção tem lojas; restauração só serve para projeto novo/vazio)
    let n;
    try {
      const rows = await runner("select (select count(*) from public.tenants)::int as n");
      n = rows[0]?.n ?? 0;
    } catch (e) {
      throw new Error(`não foi possível checar o alvo (aplique as migrations no projeto alvo antes): ${e.message}`);
    }
    if (n > 0) throw new Error("restauração recusada: alvo não está vazio (tabela tenants já tem linhas)");
  }

  const out = outDir ?? join(backupDir, "restore-sql");
  if (!apply) await mkdir(out, { recursive: true });

  const files = [];
  let applied = 0;
  let pos = 0;
  for (const name of order) {
    pos += 1;
    const entry = byName.get(name);
    const rows = await readTableGz(join(backupDir, "tables", entry.file));
    if (!rows.length) continue;
    const chunks = chunkRows(rows, maxChunkBytes);
    for (let k = 0; k < chunks.length; k++) {
      const sql = buildInsertSql(name, entry.columns, chunks[k], { onConflict });
      if (apply) {
        await runQuery(sql);
        applied += chunks[k].length;
      } else {
        const file = join(out, `${String(pos).padStart(3, "0")}-${name}-${k + 1}.sql`);
        await writeFile(file, sql, "utf8");
        files.push(file);
      }
    }
  }

  return { files, applied, order, cycles };
}

async function main() {
  const argv = process.argv.slice(2);
  const argValue = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const backupDir = argValue("--backup");
  if (!backupDir) {
    console.error("Uso: --backup <dir> [--tables a,b] [--out <dir>] [--apply --project-ref X --confirm-project-ref X] [--on-conflict nothing|error]");
    process.exit(2);
  }
  const tables = argValue("--tables")?.split(",").map((s) => s.trim()).filter(Boolean);
  const outDir = argValue("--out");
  const apply = argv.includes("--apply");
  const projectRef = argValue("--project-ref");
  const confirmProjectRef = argValue("--confirm-project-ref");
  const onConflict = argValue("--on-conflict") ?? "nothing";

  try {
    const result = await runRestore({ backupDir, tables, outDir, apply, projectRef, confirmProjectRef, onConflict });
    if (apply) {
      console.log(`[restore-from-backup] aplicado: ${result.applied} linha(s) em ${result.order.length} tabela(s)`);
    } else {
      console.log(`[restore-from-backup] dry-run — ordem: ${result.order.join(", ")}`);
      if (result.cycles.length) console.log(`[restore-from-backup] ciclo de FK entre: ${result.cycles.join(", ")} (anexadas ao fim)`);
      console.log(`[restore-from-backup] ${result.files.length} arquivo(s) .sql gerado(s) em ${outDir ?? join(backupDir, "restore-sql")}`);
    }
  } catch (e) {
    console.error(`[restore-from-backup] erro: ${e.message}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
