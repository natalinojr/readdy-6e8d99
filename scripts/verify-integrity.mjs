#!/usr/bin/env node
// Verifica a integridade de um backup (relê os .json.gz e confere manifest)
// ou compara dois manifests, ou compara um backup contra as contagens ao vivo do banco.
// Uso:
//   node scripts/verify-integrity.mjs --backup <dir>
//   node scripts/verify-integrity.mjs --compare <manifestA.json> <manifestB.json> [--tolerance 5]
//   node scripts/verify-integrity.mjs --live <dir> --project-ref <ref>
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyBackupDir } from "./backup/lib/files.mjs";
import { compareManifests } from "./backup/lib/manifest.mjs";
import { countsSql } from "./backup/lib/queries.mjs";
import { createCliRunner } from "./backup/lib/cli.mjs";

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("--backup")) {
    const dir = argValue(argv, "--backup");
    const { ok, errors } = await verifyBackupDir(dir);
    if (ok) {
      console.log(`[verify-integrity] OK — ${dir}`);
      process.exit(0);
    }
    console.error(`[verify-integrity] FALHOU — ${dir}\n` + errors.map((e) => `  - ${e}`).join("\n"));
    process.exit(1);
  }

  if (argv.includes("--compare")) {
    const i = argv.indexOf("--compare");
    const [a, b] = [argv[i + 1], argv[i + 2]];
    const tolerance = Number(argValue(argv, "--tolerance") ?? 5);
    const base = JSON.parse(await readFile(a, "utf8"));
    const other = JSON.parse(await readFile(b, "utf8"));
    const result = compareManifests(base, other, { tolerancePct: tolerance });
    result.warnings.forEach((w) => console.warn(`[verify-integrity] aviso: ${w}`));
    if (result.ok) {
      console.log(`[verify-integrity] manifests compatíveis`);
      process.exit(0);
    }
    console.error(`[verify-integrity] divergência:\n` + result.errors.map((e) => `  - ${e}`).join("\n"));
    process.exit(1);
  }

  if (argv.includes("--live")) {
    const dir = argValue(argv, "--live");
    const projectRef = argValue(argv, "--project-ref");
    if (!projectRef) {
      console.error("[verify-integrity] --live exige --project-ref");
      process.exit(2);
    }
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    // Mesmo filtro por loja do backup: tabela marcada "filtered" só conta as lojas
    // que estavam com backup_enabled quando o backup foi feito (manifest.tenants).
    const tenantIds = (manifest.tenants ?? []).map((t) => t.id);
    const tables = manifest.tables.filter((t) => !t.error);
    const runQuery = createCliRunner({ projectRef, readOnly: true });
    const specs = tables.map((t) => ({ name: t.name, tenantIds: t.filtered ? tenantIds : null }));
    const rows = specs.length ? await runQuery(countsSql(specs)) : [];
    const byName = new Map(rows.map((r) => [r.table_name, Number(r.row_count)]));
    const live = {
      version: 1,
      date: manifest.date,
      projectRef,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "complete",
      tables: tables.map((t) => ({ name: t.name, file: `${t.name}.json.gz`, rowCount: byName.get(t.name) ?? 0, expectedRowCount: null, checksum: null, pkColumns: [], columns: [] })),
      fkEdges: [],
    };
    const result = compareManifests(manifest, live);
    result.warnings.forEach((w) => console.warn(`[verify-integrity] aviso: ${w}`));
    if (result.ok) {
      console.log(`[verify-integrity] contagens ao vivo compatíveis com ${dir}`);
      process.exit(0);
    }
    console.error(`[verify-integrity] divergência com o banco ao vivo:\n` + result.errors.map((e) => `  - ${e}`).join("\n"));
    process.exit(1);
  }

  console.error("Uso: --backup <dir> | --compare <a.json> <b.json> [--tolerance N] | --live <dir> --project-ref <ref>");
  process.exit(2);
}

main();
