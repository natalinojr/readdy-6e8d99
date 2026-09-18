// Lógica pura de restauração: ordem topológica por FK, SQL de insert, guarda de alvo.
import { randomBytes } from "node:crypto";

function qi(name) {
  if (!name || name.includes("\0")) throw new Error("identificador inválido");
  return `"${name.replace(/"/g, '""')}"`;
}

// Kahn: pais antes de filhos; empate alfabético; o que sobrar (ciclo) vai em `cycles`.
export function topoSortTables(tables, fkEdges) {
  const set = new Set(tables);
  const edges = fkEdges.filter((e) => e.child !== e.parent && set.has(e.child) && set.has(e.parent));

  const indegree = new Map(tables.map((t) => [t, 0]));
  const childrenOf = new Map(tables.map((t) => [t, []]));
  for (const e of edges) {
    indegree.set(e.child, (indegree.get(e.child) || 0) + 1);
    childrenOf.get(e.parent).push(e.child);
  }

  let ready = tables.filter((t) => indegree.get(t) === 0).sort();
  const order = [];
  while (ready.length) {
    ready.sort();
    const t = ready.shift();
    order.push(t);
    for (const c of childrenOf.get(t) || []) {
      indegree.set(c, indegree.get(c) - 1);
      if (indegree.get(c) === 0) ready.push(c);
    }
  }
  const cycles = tables.filter((t) => !order.includes(t)).sort();
  return { order: [...order, ...cycles], cycles };
}

export function chunkRows(rows, maxBytes) {
  const out = [];
  let cur = [];
  for (const row of rows) {
    const rowLen = JSON.stringify(row).length;
    if (rowLen > maxBytes) {
      if (cur.length) {
        out.push(cur);
        cur = [];
      }
      out.push([row]);
      continue;
    }
    const wouldBe = JSON.stringify([...cur, row]).length;
    if (cur.length && wouldBe > maxBytes) {
      out.push(cur);
      cur = [row];
    } else {
      cur.push(row);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

export function buildInsertSql(table, columns, rows, opts = {}) {
  const cols = columns.filter((c) => !c.generated);
  if (!cols.length) throw new Error("nenhuma coluna não-gerada para restaurar");
  if (!rows.length) throw new Error("sem linhas para restaurar");

  let tag;
  do {
    tag = "$bk" + randomBytes(4).toString("hex") + "$";
  } while (JSON.stringify(rows).includes(tag));

  const colList = cols.map((c) => qi(c.name)).join(", ");
  const onConflict = opts.onConflict === "error" ? "" : " on conflict do nothing";
  return (
    `set session_replication_role = replica;\n` +
    `insert into public.${qi(table)} (${colList}) select ${colList} from jsonb_populate_recordset(null::public.${qi(table)}, ${tag}${JSON.stringify(rows)}${tag}::jsonb)` +
    onConflict +
    `;\n`
  );
}

export function assertRestoreTarget({ projectRef, confirmProjectRef, productionRef }) {
  if (!projectRef) throw new Error("projectRef é obrigatório para restaurar");
  if (confirmProjectRef !== projectRef) throw new Error("confirmProjectRef precisa ser igual a projectRef");
  if (projectRef === productionRef) throw new Error("restauração recusada: alvo é o projeto de produção");
}
