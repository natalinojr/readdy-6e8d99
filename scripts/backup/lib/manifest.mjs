// Manifest de integridade do backup: contagem + checksum por tabela.
import { createHash } from "node:crypto";

export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] === undefined) continue;
      out[k] = sortKeys(v[k]);
    }
    return out;
  }
  return v;
}

export function checksumRows(rows) {
  return "sha256:" + createHash("sha256").update(canonicalJson(rows)).digest("hex");
}

export function buildManifest({ date, projectRef, startedAt, finishedAt, tables, fkEdges, tenants }) {
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name));
  const status = sorted.some((t) => t.error || t.checksum === null) ? "partial" : "complete";
  // tenants: lojas com backup_enabled incluídas nesta extração ([] = nenhuma restrição
  // configurada ainda / backup antigo anterior a esta feature — tratado como "sem filtro").
  return { version: 1, date, projectRef, startedAt, finishedAt, status, tables: sorted, fkEdges, tenants: tenants ?? [] };
}

export function compareManifests(base, other, opts = {}) {
  const tolerancePct = opts.tolerancePct ?? 5;
  const errors = [];
  const warnings = [];
  const otherByName = new Map(other.tables.map((t) => [t.name, t]));
  const baseNames = new Set(base.tables.map((t) => t.name));

  for (const bt of base.tables) {
    const ot = otherByName.get(bt.name);
    if (!ot) {
      errors.push(`tabela ${bt.name} ausente`);
      continue;
    }
    const diff = Math.abs(ot.rowCount - bt.rowCount);
    const pct = (diff / Math.max(bt.rowCount, 1)) * 100;
    if (pct > tolerancePct) {
      errors.push(`tabela ${bt.name}: base ${bt.rowCount}, outro ${ot.rowCount} (${pct.toFixed(1)}%)`);
    } else if (diff > 0) {
      warnings.push(`tabela ${bt.name}: base ${bt.rowCount}, outro ${ot.rowCount} (${pct.toFixed(1)}%)`);
    } else if (bt.checksum && ot.checksum && bt.checksum !== ot.checksum) {
      warnings.push(`tabela ${bt.name}: mesmo nº de linhas, conteúdo diferente`);
    }
  }
  for (const name of otherByName.keys()) {
    if (!baseNames.has(name)) warnings.push(`tabela ${name} nova`);
  }
  return { ok: errors.length === 0, errors, warnings };
}
