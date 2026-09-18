// @vitest-environment node
// Import por caminho montado em tempo de execução (tsconfig.app.json não cobre scripts/).
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RESTORE_PATH = pathToFileURL(resolve(__dirname, "../../../scripts/backup/lib/restore.mjs")).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

beforeAll(async () => {
  mod = await import(/* @vite-ignore */ RESTORE_PATH);
});

describe("topoSortTables (ordem de restauração por FK)", () => {
  it("pais antes de filhos, empate alfabético", () => {
    const { order, cycles } = mod.topoSortTables(
      ["order_items", "orders", "tenants"],
      [
        { child: "orders", parent: "tenants" },
        { child: "order_items", parent: "orders" },
      ],
    );
    expect(order).toEqual(["tenants", "orders", "order_items"]);
    expect(cycles).toEqual([]);
  });

  it("ignora arestas com ponta fora da lista e auto-referências", () => {
    const { order } = mod.topoSortTables(
      ["a", "b"],
      [
        { child: "a", parent: "fora" },
        { child: "a", parent: "a" },
        { child: "b", parent: "a" },
      ],
    );
    expect(order).toEqual(["a", "b"]);
  });

  it("ciclo vai para cycles (alfabético) e fica anexado ao fim", () => {
    const { order, cycles } = mod.topoSortTables(
      ["x", "y"],
      [
        { child: "x", parent: "y" },
        { child: "y", parent: "x" },
      ],
    );
    expect(cycles).toEqual(["x", "y"]);
    expect(order).toEqual(["x", "y"]);
  });
});

describe("chunkRows", () => {
  it("preserva ordem e respeita o tamanho máximo por chunk", () => {
    const rows = [{ a: "x".repeat(10) }, { a: "y".repeat(10) }, { a: "z".repeat(10) }];
    const chunks = mod.chunkRows(rows, 40);
    expect(chunks.flat()).toEqual(rows);
    for (const c of chunks) expect(JSON.stringify(c).length).toBeLessThanOrEqual(40 + 30); // margem: linha isolada pode passar
  });

  it("linha sozinha maior que maxBytes vira chunk próprio", () => {
    const grande = { a: "x".repeat(1000) };
    const chunks = mod.chunkRows([{ a: "1" }, grande, { a: "2" }], 50);
    expect(chunks.some((c: unknown[]) => c.length === 1 && (c[0] as { a: string }).a === grande.a)).toBe(true);
  });

  it("array vazio vira []", () => {
    expect(mod.chunkRows([], 100)).toEqual([]);
  });
});

describe("buildInsertSql", () => {
  it("gera insert com jsonb_populate_recordset, exclui colunas geradas, session_replication_role e on conflict", () => {
    const sql = mod.buildInsertSql(
      "orders",
      [
        { name: "id", generated: false },
        { name: "total", generated: false },
        { name: "calc", generated: true },
      ],
      [{ id: "1", total: 10 }],
    );
    expect(sql).toContain("set session_replication_role = replica;");
    expect(sql).toContain('insert into public."orders" ("id", "total")');
    expect(sql).toContain("jsonb_populate_recordset(null::public.\"orders\"");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).not.toContain('"calc"');
  });

  it("onConflict 'error' omite o on conflict do nothing", () => {
    const sql = mod.buildInsertSql("t", [{ name: "a", generated: false }], [{ a: 1 }], { onConflict: "error" });
    expect(sql).not.toContain("on conflict");
  });

  it("recusa sem colunas restauráveis ou sem linhas", () => {
    expect(() => mod.buildInsertSql("t", [{ name: "a", generated: true }], [{ a: 1 }])).toThrow();
    expect(() => mod.buildInsertSql("t", [{ name: "a", generated: false }], [])).toThrow();
  });
});

describe("assertRestoreTarget (guarda contra escrever em produção)", () => {
  const productionRef = "mdghhjemzdmeuqpzuyzx";

  it("recusa sem projectRef", () => {
    expect(() => mod.assertRestoreTarget({ projectRef: undefined, confirmProjectRef: undefined, productionRef })).toThrow();
  });

  it("recusa se confirmProjectRef não bate", () => {
    expect(() =>
      mod.assertRestoreTarget({ projectRef: "abcdefghijklmnopqrst", confirmProjectRef: "outro", productionRef }),
    ).toThrow();
  });

  it("recusa produção mesmo com confirmação igual (sem flag de escape)", () => {
    expect(() =>
      mod.assertRestoreTarget({ projectRef: productionRef, confirmProjectRef: productionRef, productionRef }),
    ).toThrow("produção");
  });

  it("aceita projeto de teste com confirmação igual", () => {
    expect(() =>
      mod.assertRestoreTarget({
        projectRef: "abcdefghijklmnopqrst",
        confirmProjectRef: "abcdefghijklmnopqrst",
        productionRef,
      }),
    ).not.toThrow();
  });
});
