// @vitest-environment node
// Import por caminho montado em tempo de execução: o tsc do app (tsconfig.app.json,
// include: ["src"]) não chega a checar scripts/backup/lib/*.mjs — evita TS7016.
import { describe, it, expect, beforeAll } from "vitest";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const CONFIG_PATH = pathToFileURL(resolve(__dirname, "../../../scripts/backup/lib/config.mjs")).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

beforeAll(async () => {
  mod = await import(/* @vite-ignore */ CONFIG_PATH);
});

const REPO = join(tmpdir(), "erpos-repo-falso");
const FORA = join(tmpdir(), "erpos-backups-teste");

describe("resolveConfig (backup diário)", () => {
  it("sem env nem argv usa os defaults", () => {
    expect(mod.PRODUCTION_PROJECT_REF).toBe("mdghhjemzdmeuqpzuyzx");
    expect(mod.resolveConfig({ env: {}, argv: [], repoRoot: REPO })).toEqual({
      backupDir: resolve(mod.DEFAULT_BACKUP_DIR),
      projectRef: mod.PRODUCTION_PROJECT_REF,
      retentionDays: 30,
      pageSize: 1000,
      minFreeMb: 1024,
      supabaseCli: "npx supabase",
    });
  });

  it("ERPOS_BACKUP_DIR troca a pasta e as variáveis numéricas são lidas", () => {
    const cfg = mod.resolveConfig({
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
    const cfg = mod.resolveConfig({ env: { ERPOS_BACKUP_DIR: FORA }, argv: ["--dir", outra], repoRoot: REPO });
    expect(cfg.backupDir).toBe(resolve(outra));
  });

  it("recusa pasta dentro do repositório (ou o próprio repositório)", () => {
    expect(() => mod.resolveConfig({ env: { ERPOS_BACKUP_DIR: join(REPO, "backups") }, argv: [], repoRoot: REPO })).toThrow(
      "dentro do repositório",
    );
    expect(() => mod.resolveConfig({ env: {}, argv: ["--dir", REPO], repoRoot: REPO })).toThrow("dentro do repositório");
  });

  it("aceita pasta irmã com prefixo parecido (não é dentro do repositório)", () => {
    const irma = REPO + "-backups";
    expect(mod.resolveConfig({ env: { ERPOS_BACKUP_DIR: irma }, argv: [], repoRoot: REPO }).backupDir).toBe(resolve(irma));
  });

  it("recusa pageSize fora de 1..10000, retenção < 1, espaço mínimo negativo e --dir sem valor", () => {
    const base = { argv: [] as string[], repoRoot: REPO };
    expect(() => mod.resolveConfig({ ...base, env: { ERPOS_BACKUP_PAGE_SIZE: "0" } })).toThrow();
    expect(() => mod.resolveConfig({ ...base, env: { ERPOS_BACKUP_PAGE_SIZE: "10001" } })).toThrow();
    expect(() => mod.resolveConfig({ ...base, env: { ERPOS_BACKUP_PAGE_SIZE: "abc" } })).toThrow();
    expect(() => mod.resolveConfig({ ...base, env: { ERPOS_BACKUP_RETENTION_DAYS: "0" } })).toThrow();
    expect(() => mod.resolveConfig({ ...base, env: { ERPOS_BACKUP_MIN_FREE_MB: "-1" } })).toThrow();
    expect(() => mod.resolveConfig({ env: {}, argv: ["--dir"], repoRoot: REPO })).toThrow();
  });

  it("recusa project ref inválido", () => {
    expect(() => mod.resolveConfig({ env: { ERPOS_BACKUP_PROJECT_REF: "ABC" }, argv: [], repoRoot: REPO })).toThrow(
      "project ref inválido",
    );
  });
});
