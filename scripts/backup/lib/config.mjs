// Configuração do backup diário (specs/2026-09-backup-diario).
// Lê ENV + argv, nunca lê/guarda credencial.
import { resolve, sep } from "node:path";

export const PRODUCTION_PROJECT_REF = "mdghhjemzdmeuqpzuyzx";
export const DEFAULT_BACKUP_DIR = "D:\\backups\\erpos";

function intEnv(env, name, def, min, max) {
  const raw = env[name];
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
    throw new Error(`${name} inválido: ${raw}`);
  }
  return n;
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined) throw new Error(`${flag} exige um valor`);
  return v;
}

export function resolveConfig({ env, argv, repoRoot }) {
  const backupDirRaw = argValue(argv, "--dir") ?? env.ERPOS_BACKUP_DIR ?? DEFAULT_BACKUP_DIR;
  const backupDir = resolve(backupDirRaw);
  const repo = resolve(repoRoot);
  // no Windows o filesystem é case-insensitive: comparar em minúsculas evita
  // burlar a checagem com "D:\Dev" vs "d:\dev"
  const a = process.platform === "win32" ? backupDir.toLowerCase() : backupDir;
  const b = process.platform === "win32" ? repo.toLowerCase() : repo;
  if (a === b || a.startsWith(b + sep)) {
    throw new Error("ERPOS_BACKUP_DIR não pode ficar dentro do repositório");
  }

  const projectRef = env.ERPOS_BACKUP_PROJECT_REF ?? PRODUCTION_PROJECT_REF;
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error("project ref inválido");
  }

  return {
    backupDir,
    projectRef,
    retentionDays: intEnv(env, "ERPOS_BACKUP_RETENTION_DAYS", 30, 1),
    pageSize: intEnv(env, "ERPOS_BACKUP_PAGE_SIZE", 1000, 1, 10000),
    minFreeMb: intEnv(env, "ERPOS_BACKUP_MIN_FREE_MB", 1024, 0),
    supabaseCli: env.ERPOS_SUPABASE_CLI ?? "npx supabase",
  };
}
