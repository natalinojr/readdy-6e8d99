// IO de arquivos do backup: gzip por tabela, log e verificação de integridade.
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checksumRows } from "./manifest.mjs";

export async function writeTableGz(path, rows) {
  await mkdir(dirname(path), { recursive: true });
  const buf = gzipSync(Buffer.from(JSON.stringify(rows), "utf8"));
  await writeFile(path, buf);
  return buf.length;
}

export async function readTableGz(path) {
  const buf = await readFile(path);
  return JSON.parse(gunzipSync(buf).toString("utf8"));
}

export function appendLog(logFile, level, message) {
  const dir = dirname(logFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(logFile, `${new Date().toISOString()} | ${level} | ${message}\n`, "utf8");
}

export async function verifyBackupDir(dir) {
  const errors = [];
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  } catch (e) {
    return { ok: false, errors: [`manifest.json ausente ou inválido: ${e.message}`], manifest: null };
  }
  for (const t of manifest.tables || []) {
    if (t.error) continue;
    try {
      const rows = await readTableGz(join(dir, "tables", t.file));
      if (rows.length !== t.rowCount) {
        errors.push(`${t.name}: esperava ${t.rowCount} linhas, arquivo tem ${rows.length}`);
        continue;
      }
      if (t.checksum && checksumRows(rows) !== t.checksum) {
        errors.push(`${t.name}: checksum não bate`);
      }
    } catch (e) {
      errors.push(`${t.name}: falha lendo arquivo (${e.message})`);
    }
  }
  return { ok: errors.length === 0, errors, manifest };
}
