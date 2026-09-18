// Runner da CLI do Supabase (`supabase db query`). Só IO — sem lógica testável
// em isolamento; o parsing/classificação de erro mora em queries.mjs.
// A query vai por ARQUIVO temporário: passar SQL como argumento quebra no
// shell do Windows (mesma solução de scripts/monitor-noite.mjs).
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertReadOnlySql, parseCliOutput, classifyCliError, CliOutputError } from "./queries.mjs";

export function createCliRunner({ projectRef, supabaseCli = "npx supabase", readOnly, tmpDir }) {
  return async function runQuery(sql) {
    if (readOnly) assertReadOnlySql(sql);
    const dir = await mkdtemp(join(tmpDir ?? tmpdir(), "erpos-backup-"));
    const file = join(dir, "q.sql");
    try {
      await writeFile(file, sql, "utf8");
      const [cmd, ...baseArgs] = supabaseCli.split(" ");
      const args = [...baseArgs, "db", "query", "--linked", "--project-ref", projectRef, "--agent", "yes", "-f", file];
      const { stdout, stderr } = await new Promise((resolvePromise) => {
        execFile(
          cmd,
          args,
          { shell: process.platform === "win32", maxBuffer: 256 * 1024 * 1024, timeout: 10 * 60 * 1000 },
          (_err, stdout, stderr) => resolvePromise({ stdout: stdout ?? "", stderr: stderr ?? "" }),
        );
      });
      try {
        return parseCliOutput(stdout);
      } catch {
        // stdout não é JSON válido (ex.: erro de conexão antes de chamar a Management API):
        // classifica a partir de stdout+stderr, mas nunca loga a linha crua (pode ter token).
        const combined = `${stdout}\n${stderr}`;
        const safe = combined
          .split("\n")
          .filter((l) => !/PGPASSWORD|password|token/i.test(l))
          .join(" ")
          .slice(0, 300);
        throw new CliOutputError(safe || "falha ao chamar a CLI do Supabase", classifyCliError(combined));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

// exportado para reaproveitar a classificação quando stdout+stderr precisam ser combinados
export { classifyCliError };
