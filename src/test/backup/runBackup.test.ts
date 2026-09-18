// @vitest-environment node
// Import por caminho montado em tempo de execução (tsconfig.app.json não cobre scripts/).
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RUN_BACKUP_PATH = pathToFileURL(resolve(__dirname, "../../../scripts/backup/lib/runBackup.mjs")).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

beforeAll(async () => {
  mod = await import(/* @vite-ignore */ RUN_BACKUP_PATH);
});

const dirs: string[] = [];
function tempBackupDir() {
  const dir = mkdtempSync(join(tmpdir(), "erpos-backup-run-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const baseConfig = (backupDir: string) => ({
  backupDir,
  projectRef: "mdghhjemzdmeuqpzuyzx",
  retentionDays: 30,
  pageSize: 1000,
  minFreeMb: 0,
  supabaseCli: "npx supabase",
});

describe("runBackup — escolha de lojas (Admin Master)", () => {
  it("nenhuma loja com backup_enabled: não exporta nada, sai com status skipped/sem-lojas", async () => {
    const backupDir = tempBackupDir();
    const calledSql: string[] = [];
    const runQuery = async (sql: string) => {
      calledSql.push(sql);
      if (sql.includes("backup_enabled = true")) return []; // nenhuma loja ligada
      throw new Error(`não deveria consultar mais nada: ${sql}`);
    };
    const result = await mod.runBackup({ config: baseConfig(backupDir), runQuery, now: () => new Date("2026-09-18T06:30:00Z") });
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("sem-lojas");
    expect(result.dir).toBeNull();
    expect(existsSync(join(backupDir, "2026-09-18"))).toBe(false);
    // só a query de lojas foi disparada — nada de tabelas foi listado/extraído
    expect(calledSql.filter((s) => s.includes("backup_enabled = true"))).toHaveLength(1);
  });

  it("com loja ligada, consulta as tabelas filtrando por tenant_id (via countsSql/buildPageSql)", async () => {
    const backupDir = tempBackupDir();
    const runQuery = async (sql: string) => {
      if (sql.includes("backup_enabled = true")) return [{ id: "11111111-1111-1111-1111-111111111111", name: "Loja Teste" }];
      if (sql.includes("pg_class")) {
        return [{ table_name: "orders", pk_columns: ["id"], columns: [{ name: "id", generated: false }, { name: "tenant_id", generated: false }] }];
      }
      if (sql.startsWith("select 'orders'")) return [{ table_name: "orders", row_count: 1 }];
      if (sql.includes("contype = 'f'")) return [];
      if (sql.startsWith("select * from public.")) return [{ id: 1, tenant_id: "11111111-1111-1111-1111-111111111111" }];
      throw new Error(`sql inesperado: ${sql}`);
    };
    const result = await mod.runBackup({ config: baseConfig(backupDir), runQuery, now: () => new Date("2026-09-18T06:30:00Z") });
    expect(result.status).toBe("complete");
    expect(result.manifest.tenants).toEqual([{ id: "11111111-1111-1111-1111-111111111111", name: "Loja Teste" }]);
    expect(result.manifest.tables[0].filtered).toBe(true);
  });
});
