// @vitest-environment node
// Import por caminho montado em tempo de execução (tsconfig.app.json não cobre scripts/).
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST_PATH = pathToFileURL(resolve(__dirname, "../../../scripts/backup/lib/manifest.mjs")).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

beforeAll(async () => {
  mod = await import(/* @vite-ignore */ MANIFEST_PATH);
});

describe("canonicalJson / checksumRows", () => {
  it("ordena chaves de objeto recursivamente, mas preserva ordem de array", () => {
    expect(mod.canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(mod.canonicalJson([{ b: 1, a: 2 }, { a: 3 }])).toBe('[{"a":2,"b":1},{"a":3}]');
  });

  it("checksum é determinístico e sensível à ordem das chaves de origem", () => {
    const a = mod.checksumRows([{ id: 1, nome: "x" }]);
    const b = mod.checksumRows([{ nome: "x", id: 1 }]);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("linhas diferentes geram checksum diferente", () => {
    expect(mod.checksumRows([{ id: 1 }])).not.toBe(mod.checksumRows([{ id: 2 }]));
  });
});

describe("buildManifest", () => {
  it("ordena tabelas por nome e marca status complete quando tudo ok", () => {
    const m = mod.buildManifest({
      date: "2026-09-17",
      projectRef: "abc",
      startedAt: "t0",
      finishedAt: "t1",
      tables: [
        { name: "zebra", file: "zebra.json.gz", rowCount: 1, expectedRowCount: 1, checksum: "sha256:x" },
        { name: "abelha", file: "abelha.json.gz", rowCount: 2, expectedRowCount: 2, checksum: "sha256:y" },
      ],
      fkEdges: [],
    });
    expect(m.tables.map((t: { name: string }) => t.name)).toEqual(["abelha", "zebra"]);
    expect(m.status).toBe("complete");
    expect(m.version).toBe(1);
    expect(m.tenants).toEqual([]);
  });

  it("registra as lojas incluídas no backup (Admin Master)", () => {
    const m = mod.buildManifest({
      date: "2026-09-18",
      projectRef: "abc",
      startedAt: "t0",
      finishedAt: "t1",
      tables: [{ name: "orders", file: "orders.json.gz", rowCount: 1, expectedRowCount: 1, checksum: "sha256:x", filtered: true }],
      fkEdges: [],
      tenants: [{ id: "t1", name: "El Patrón Paranaguá" }],
    });
    expect(m.tenants).toEqual([{ id: "t1", name: "El Patrón Paranaguá" }]);
    expect(m.tables[0].filtered).toBe(true);
  });

  it("marca status partial se alguma tabela tem erro ou checksum nulo", () => {
    const m = mod.buildManifest({
      date: "2026-09-17",
      projectRef: "abc",
      startedAt: "t0",
      finishedAt: "t1",
      tables: [{ name: "a", file: "a.json.gz", rowCount: 0, expectedRowCount: 5, checksum: null, error: "falhou" }],
      fkEdges: [],
    });
    expect(m.status).toBe("partial");
  });
});

describe("compareManifests", () => {
  it("dois manifests idênticos não divergem", () => {
    const base = mod.buildManifest({
      date: "d",
      projectRef: "p",
      startedAt: "t0",
      finishedAt: "t1",
      tables: [
        { name: "orders", file: "orders.json.gz", rowCount: 100, expectedRowCount: 100, checksum: "sha256:aaa" },
        { name: "sumida", file: "sumida.json.gz", rowCount: 10, expectedRowCount: 10, checksum: "sha256:bbb" },
      ],
      fkEdges: [],
    });
    const r = mod.compareManifests(base, base);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("tabela ausente no outro vira erro", () => {
    const base = mod.buildManifest({
      date: "d",
      projectRef: "p",
      startedAt: "t0",
      finishedAt: "t1",
      tables: [
        { name: "orders", file: "orders.json.gz", rowCount: 100, expectedRowCount: 100, checksum: "sha256:aaa" },
        { name: "sumida", file: "sumida.json.gz", rowCount: 10, expectedRowCount: 10, checksum: "sha256:bbb" },
      ],
      fkEdges: [],
    });
    const other = mod.buildManifest({ ...base, tables: [base.tables[0]] });
    const r = mod.compareManifests(base, other);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e: string) => e.includes("sumida"))).toBe(true);
  });

  it("diferença de contagem acima da tolerância vira erro; dentro vira warning", () => {
    const base = mod.buildManifest({
      date: "d",
      projectRef: "p",
      startedAt: "t0",
      finishedAt: "t1",
      tables: [{ name: "orders", file: "orders.json.gz", rowCount: 100, expectedRowCount: 100, checksum: "sha256:aaa" }],
      fkEdges: [],
    });
    const foraDaTolerancia = mod.buildManifest({ ...base, tables: [{ ...base.tables[0], rowCount: 50 }] });
    expect(mod.compareManifests(base, foraDaTolerancia).ok).toBe(false);

    const dentroDaTolerancia = mod.buildManifest({ ...base, tables: [{ ...base.tables[0], rowCount: 102 }] });
    const r2 = mod.compareManifests(base, dentroDaTolerancia);
    expect(r2.ok).toBe(true);
    expect(r2.warnings.length).toBeGreaterThan(0);
  });

  it("mesma contagem mas checksum diferente vira warning", () => {
    const base = mod.buildManifest({
      date: "d",
      projectRef: "p",
      startedAt: "t0",
      finishedAt: "t1",
      tables: [{ name: "orders", file: "orders.json.gz", rowCount: 100, expectedRowCount: 100, checksum: "sha256:aaa" }],
      fkEdges: [],
    });
    const other = mod.buildManifest({ ...base, tables: [{ ...base.tables[0], checksum: "sha256:diferente" }] });
    const r = mod.compareManifests(base, other);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w: string) => w.includes("conteúdo diferente"))).toBe(true);
  });

  it("tabela nova só no outro vira warning, não erro", () => {
    const base = mod.buildManifest({
      date: "d",
      projectRef: "p",
      startedAt: "t0",
      finishedAt: "t1",
      tables: [{ name: "orders", file: "orders.json.gz", rowCount: 100, expectedRowCount: 100, checksum: "sha256:aaa" }],
      fkEdges: [],
    });
    const other = mod.buildManifest({
      ...base,
      tables: [...base.tables, { name: "nova", file: "nova.json.gz", rowCount: 1, expectedRowCount: 1, checksum: "sha256:c" }],
    });
    const r = mod.compareManifests(base, other);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w: string) => w.includes("nova"))).toBe(true);
  });
});
