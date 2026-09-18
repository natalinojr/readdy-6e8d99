// @vitest-environment node
// Import por caminho montado em tempo de execução (tsconfig.app.json não cobre scripts/).
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const QUERIES_PATH = pathToFileURL(resolve(__dirname, "../../../scripts/backup/lib/queries.mjs")).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

beforeAll(async () => {
  mod = await import(/* @vite-ignore */ QUERIES_PATH);
});

function capturar(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    return e as { kind: string; message: string };
  }
  throw new Error("não lançou");
}

describe("quoteIdent", () => {
  it("põe aspas e dobra aspas internas", () => {
    expect(mod.quoteIdent("pedidos")).toBe('"pedidos"');
    expect(mod.quoteIdent('a"b')).toBe('"a""b"');
  });

  it("recusa vazio e \\0", () => {
    expect(() => mod.quoteIdent("")).toThrow();
    expect(() => mod.quoteIdent("a\0b")).toThrow();
  });
});

describe("assertReadOnlySql (backup nunca escreve em produção)", () => {
  it("aceita todos os SQLs que o backup gera", () => {
    const gerados = [
      mod.listTablesSql(),
      mod.countsSql(["a", "o'b"]),
      mod.fkEdgesSql(),
      mod.buildPageSql("pedidos", ["id"], 1000, 0),
      mod.buildPageSql("log_sem_pk", [], 1000, 2000),
    ];
    for (const sql of gerados) expect(() => mod.assertReadOnlySql(sql)).not.toThrow();
  });

  it("aceita palavra proibida dentro de literal e um ; final", () => {
    expect(() => mod.assertReadOnlySql("select 'drop table' as txt")).not.toThrow();
    expect(() => mod.assertReadOnlySql("select 1;")).not.toThrow();
  });

  it.each([
    "delete from x",
    "select 1; drop table x",
    "with a as (select 1) insert into y select * from a",
    "update t set a=1",
    "truncate pedidos",
  ])("rejeita %s", (sql) => {
    expect(() => mod.assertReadOnlySql(sql)).toThrow("SQL não é só-leitura");
  });
});

describe("montagem das consultas", () => {
  it("listTablesSql lê o catálogo do schema public, sem ;", () => {
    const sql = mod.listTablesSql();
    expect(sql).toContain("pg_class");
    expect(sql).toContain("'public'");
    expect(sql).toContain("relkind in ('r', 'p')");
    expect(sql).toContain("table_name");
    expect(sql).toContain("pk_columns");
    expect(sql).not.toContain(";");
  });

  it("countsSql usa count(*) exato por tabela e dobra aspas simples", () => {
    const sql = mod.countsSql(["a", "o'b"]);
    expect(sql).toContain("count(*)");
    expect(sql).toContain("'o''b'");
    expect(sql).toContain("union all");
    expect(() => mod.countsSql([])).toThrow();
  });

  it("countsSql filtra por tenant_id quando a tabela tem tenantIds (backup por loja)", () => {
    const sql = mod.countsSql([
      { name: "orders", tenantIds: ["11111111-1111-1111-1111-111111111111"] },
      { name: "tenants", tenantIds: null },
    ]);
    expect(sql).toContain('from public."orders" where tenant_id = any(array');
    expect(sql).toContain("11111111-1111-1111-1111-111111111111");
    expect(sql.endsWith('from public."tenants"')).toBe(true);
  });

  it("fkEdgesSql lista só FKs entre tabelas do public, sem auto-referência", () => {
    const sql = mod.fkEdgesSql();
    expect(sql).toContain("contype = 'f'");
    expect(sql).toContain("ch.oid <> pa.oid");
  });

  it("buildPageSql ordena pela PK (composta) com limit/offset", () => {
    expect(mod.buildPageSql("itens_pedido", ["pedido_id", "item"], 1000, 2000)).toBe(
      'select * from public."itens_pedido" order by "pedido_id", "item" limit 1000 offset 2000',
    );
  });

  it("buildPageSql sem PK ordena pela linha inteira como texto", () => {
    expect(mod.buildPageSql("log", [], 500, 0)).toBe('select * from public."log" as t order by t::text limit 500 offset 0');
  });

  it("buildPageSql recusa limit/offset inválidos", () => {
    expect(() => mod.buildPageSql("t", ["id"], 0, 0)).toThrow();
    expect(() => mod.buildPageSql("t", ["id"], 1.5, 0)).toThrow();
    expect(() => mod.buildPageSql("t", ["id"], 10, -1)).toThrow();
  });

  it("buildPageSql filtra por tenant_id quando recebe tenantIds (com e sem PK)", () => {
    expect(mod.buildPageSql("orders", ["id"], 1000, 0, ["11111111-1111-1111-1111-111111111111"])).toBe(
      'select * from public."orders" where tenant_id = any(array[\'11111111-1111-1111-1111-111111111111\']::uuid[]) order by "id" limit 1000 offset 0',
    );
    expect(mod.buildPageSql("log", [], 500, 0, ["11111111-1111-1111-1111-111111111111"])).toBe(
      'select * from public."log" as t where tenant_id = any(array[\'11111111-1111-1111-1111-111111111111\']::uuid[]) order by t::text limit 500 offset 0',
    );
  });

  it("buildPageSql sem tenantIds (ou vazio) não filtra — tabela sai inteira", () => {
    expect(mod.buildPageSql("tenants", ["id"], 10, 0)).toBe('select * from public."tenants" order by "id" limit 10 offset 0');
    expect(mod.buildPageSql("tenants", ["id"], 10, 0, [])).toBe('select * from public."tenants" order by "id" limit 10 offset 0');
  });
});

describe("tenantWhereSql (filtro do backup por loja — Admin Master)", () => {
  it("sem ids não filtra", () => {
    expect(mod.tenantWhereSql(null)).toBe("");
    expect(mod.tenantWhereSql([])).toBe("");
  });

  it("com ids monta where tenant_id = any(array[...]::uuid[])", () => {
    expect(mod.tenantWhereSql(["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"])).toBe(
      " where tenant_id = any(array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']::uuid[])",
    );
  });

  it("recusa id que não parece uuid (proteção contra injeção)", () => {
    expect(() => mod.tenantWhereSql(["'; drop table tenants; --"])).toThrow("tenant id inválido");
  });
});

describe("listTenantsForBackupSql / tableHasTenantId", () => {
  it("lista só lojas com backup_enabled = true", () => {
    const sql = mod.listTenantsForBackupSql();
    expect(sql).toContain("backup_enabled = true");
    expect(sql).toContain("public.tenants");
  });

  it("tableHasTenantId detecta a coluna tenant_id entre as colunas da tabela", () => {
    expect(mod.tableHasTenantId({ columns: [{ name: "id" }, { name: "tenant_id" }] })).toBe(true);
    expect(mod.tableHasTenantId({ columns: [{ name: "id" }] })).toBe(false);
    expect(mod.tableHasTenantId({ columns: [] })).toBe(false);
  });
});

describe("saída da CLI do Supabase", () => {
  it("devolve rows do formato {boundary, rows, warning}", () => {
    const out = JSON.stringify({ boundary: "abc", rows: [{ a: 1 }], warning: "dados não confiáveis" });
    expect(mod.parseCliOutput(out)).toEqual([{ a: 1 }]);
  });

  it("aceita array puro com espaços em volta", () => {
    expect(mod.parseCliOutput('\n [{"a":1}] \n')).toEqual([{ a: 1 }]);
  });

  it("erro de SQL (42P01) vira CliOutputError kind sql", () => {
    const out = JSON.stringify({
      _tag: "Error",
      error: { code: "42P01", message: 'Failed to run sql query: ERROR:  42P01: relation "x" does not exist' },
    });
    const err = capturar(() => mod.parseCliOutput(out));
    expect(err).toBeInstanceOf(mod.CliOutputError);
    expect(err.kind).toBe("sql");
    expect(err.message.startsWith("42P01: ")).toBe(true);
  });

  it("projeto não linkado / login vira kind auth", () => {
    const out = JSON.stringify({
      _tag: "Error",
      error: { code: "LegacyProjectNotLinkedError", message: "Cannot find project ref. Have you run supabase link?" },
    });
    expect(capturar(() => mod.parseCliOutput(out)).kind).toBe("auth");
  });

  it("mensagem de erro é truncada em 300 caracteres", () => {
    const out = JSON.stringify({ _tag: "Error", error: { code: "X", message: "y".repeat(1000) } });
    expect(capturar(() => mod.parseCliOutput(out)).message.length).toBeLessThanOrEqual(300);
  });

  it("classifyCliError classifica rede e desconhecido", () => {
    expect(mod.classifyCliError("ETIMEDOUT ao conectar")).toBe("network");
    expect(mod.classifyCliError("algo bizarro aconteceu")).toBe("unknown");
  });

  it("saída não-JSON vira CliOutputError unknown", () => {
    expect(() => mod.parseCliOutput("não é json")).toThrow(mod.CliOutputError);
  });
});

describe("rowsToTableInfo", () => {
  it("converte linhas cruas (com pk_columns/columns como JSON string) em TableInfo", () => {
    const rows = [
      { table_name: "orders", pk_columns: '["id"]', columns: '[{"name":"id","generated":false}]' },
      { table_name: "sem_pk", pk_columns: [], columns: [{ name: "a", generated: true }] },
    ];
    expect(mod.rowsToTableInfo(rows)).toEqual([
      { name: "orders", pkColumns: ["id"], columns: [{ name: "id", generated: false }] },
      { name: "sem_pk", pkColumns: [], columns: [{ name: "a", generated: true }] },
    ]);
  });
});
