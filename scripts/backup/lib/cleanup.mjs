// Aplica a retenção de dias sobre as pastas de backup em disco.
import { readdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { selectExpired } from "./retention.mjs";
import { appendLog } from "./files.mjs";

function isComplete(dir, name) {
  if (name.includes(".partial-")) return false;
  const manifestPath = join(dir, name, "manifest.json");
  if (!existsSync(manifestPath)) return false;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")).status === "complete";
  } catch {
    return false;
  }
}

export async function runCleanup({ config, today, dryRun = false }) {
  const logFile = join(config.backupDir, "logs", "cleanup.log");
  if (!existsSync(config.backupDir)) return { removed: [] };

  const names = readdirSync(config.backupDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const entries = names.map((name) => ({ name, complete: isComplete(config.backupDir, name) }));
  const expired = selectExpired(entries, today, config.retentionDays);

  const removed = [];
  for (const name of expired) {
    if (dryRun) {
      appendLog(logFile, "INFO", `[dry-run] removeria ${name}`);
    } else {
      rmSync(join(config.backupDir, name), { recursive: true, force: true });
      appendLog(logFile, "INFO", `removida ${name}`);
      removed.push(name);
    }
  }
  appendLog(logFile, "INFO", `retenção de ${config.retentionDays} dias: ${dryRun ? expired.length + " a remover (dry-run)" : removed.length + " removida(s)"}`);
  return { removed: dryRun ? [] : removed };
}
