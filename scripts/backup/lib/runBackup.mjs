// Orquestra um backup diário: lock, disco livre, extração sequencial e
// paginada de todas as tabelas de public, manifest, verificação, promoção
// atômica da pasta. Só é promovido a sucesso (e libera a limpeza) se
// TODAS as tabelas extraíram e a verificação pós-escrita bateu.
import { statfsSync, existsSync, mkdirSync, rmSync, openSync, closeSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { brasiliaDate } from "./retention.mjs";
import { listTablesSql, countsSql, fkEdgesSql, buildPageSql, rowsToTableInfo, listTenantsForBackupSql, tableHasTenantId } from "./queries.mjs";
import { buildManifest, checksumRows } from "./manifest.mjs";
import { writeTableGz, appendLog, verifyBackupDir } from "./files.mjs";

const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

function hhmmss(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/:/g, "");
}

function defaultFreeMb(dir) {
  const s = statfsSync(dir);
  return Math.floor((s.bavail * s.bsize) / (1024 * 1024));
}

export async function runBackup({ config, runQuery, now = () => new Date(), getFreeMb = defaultFreeMb }) {
  mkdirSync(config.backupDir, { recursive: true });
  const logFile = join(config.backupDir, "logs", "backup.log");
  const log = (level, msg) => appendLog(logFile, level, msg);
  const lockFile = join(config.backupDir, "backup.lock");

  if (existsSync(lockFile)) {
    const age = Date.now() - statSync(lockFile).mtimeMs;
    if (age < LOCK_STALE_MS) {
      log("WARN", "backup já em andamento (lock ativo); saindo");
      return { status: "skipped", dir: null, manifest: null, reason: "lock" };
    }
    log("WARN", "lock órfão (mais de 6h) removido");
    rmSync(lockFile, { force: true });
  }
  closeSync(openSync(lockFile, "wx"));

  try {
    const freeMb = getFreeMb(config.backupDir);
    if (freeMb < config.minFreeMb) {
      log("ERROR", `disco insuficiente: ${freeMb}MB livres, mínimo ${config.minFreeMb}MB`);
      return { status: "aborted", dir: null, manifest: null, reason: "disco" };
    }

    const date = brasiliaDate(now());
    const finalDir = join(config.backupDir, date);
    if (existsSync(finalDir)) {
      log("WARN", `pasta ${date} já existe; pulando (apague/renomeie para refazer)`);
      return { status: "skipped", dir: finalDir, manifest: null, reason: "já existe" };
    }

    // Escolha de lojas do Admin Master: padrão é nenhuma loja ligada (nada exporta).
    const tenantRows = await runQuery(listTenantsForBackupSql());
    if (tenantRows.length === 0) {
      log("INFO", "Nenhuma loja com backup ligado no Admin Master — nada feito");
      return { status: "skipped", dir: null, manifest: null, reason: "sem-lojas" };
    }
    const tenants = tenantRows.map((r) => ({ id: r.id, name: r.name }));
    const tenantIds = tenants.map((t) => t.id);
    log("INFO", `lojas incluídas no backup: ${tenants.map((t) => t.name).join(", ")}`);

    const startedAt = new Date().toISOString();
    log("INFO", `início do backup ${date} — projeto ${config.projectRef} — destino ${config.backupDir}`);

    const workDir = join(config.backupDir, `${date}.partial-${hhmmss(now())}`);
    mkdirSync(join(workDir, "tables"), { recursive: true });

    const tableRows = await runQuery(listTablesSql());
    const tables = rowsToTableInfo(tableRows);
    const countSpecs = tables.map((t) => ({ name: t.name, tenantIds: tableHasTenantId(t) ? tenantIds : null }));
    const expected = countSpecs.length ? await runQuery(countsSql(countSpecs)) : [];
    const expectedByName = new Map(expected.map((r) => [r.table_name, Number(r.row_count)]));
    const fkEdges = await runQuery(fkEdgesSql());

    const entries = [];
    for (const t of tables) {
      const filtered = tableHasTenantId(t);
      const filterIds = filtered ? tenantIds : undefined;
      try {
        let rows = [];
        let offset = 0;
        for (;;) {
          const page = await runQuery(buildPageSql(t.name, t.pkColumns, config.pageSize, offset, filterIds));
          rows = rows.concat(page);
          if (page.length < config.pageSize) break;
          offset += config.pageSize;
        }
        const file = `${t.name}.json.gz`;
        const bytes = await writeTableGz(join(workDir, "tables", file), rows);
        const checksum = checksumRows(rows);
        const expectedRowCount = expectedByName.has(t.name) ? expectedByName.get(t.name) : null;
        entries.push({
          name: t.name,
          file,
          rowCount: rows.length,
          expectedRowCount,
          checksum,
          pkColumns: t.pkColumns,
          columns: t.columns,
          filtered,
        });
        log("INFO", `${t.name}: ${rows.length} linhas, ${bytes} bytes${filtered ? " (filtrado por loja)" : ""}`);
        if (expectedRowCount !== null && expectedRowCount !== rows.length) {
          log("WARN", `${t.name}: contagem inicial ${expectedRowCount} difere do extraído ${rows.length}`);
        }
      } catch (e) {
        log("ERROR", `${t.name}: falha na extração — ${e.message}`);
        entries.push({
          name: t.name,
          file: `${t.name}.json.gz`,
          rowCount: 0,
          expectedRowCount: expectedByName.has(t.name) ? expectedByName.get(t.name) : null,
          checksum: null,
          pkColumns: t.pkColumns,
          columns: t.columns,
          filtered,
          error: e.message,
        });
      }
    }

    const manifest = buildManifest({
      date,
      projectRef: config.projectRef,
      startedAt,
      finishedAt: new Date().toISOString(),
      tables: entries,
      fkEdges,
      tenants,
    });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(workDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    const verify = await verifyBackupDir(workDir);
    if (manifest.status === "complete" && verify.ok) {
      renameSync(workDir, finalDir);
      log("INFO", `backup ${date} concluído com sucesso (${entries.length} tabelas)`);
      return { status: "complete", dir: finalDir, manifest };
    }
    log("ERROR", `backup ${date} incompleto (status=${manifest.status}, verify=${verify.ok}); pasta parcial mantida em ${workDir}`);
    if (!verify.ok) verify.errors.forEach((e) => log("ERROR", `verificação: ${e}`));
    return { status: "partial", dir: workDir, manifest };
  } finally {
    rmSync(lockFile, { force: true });
  }
}
