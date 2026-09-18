// SQL só-leitura para o backup + leitura/parsing da saída do `supabase db query`.
// Nada aqui chama rede/CLI (é lógica pura) — quem chama é scripts/backup/lib/cli.mjs.

export function quoteIdent(name) {
  if (!name || name.includes("\0")) throw new Error("identificador inválido");
  return `"${name.replace(/"/g, '""')}"`;
}

const WRITE_WORDS =
  /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|set|reset|vacuum|analyze|refresh|lock|comment|security)\b/i;

export function assertReadOnlySql(sql) {
  let s = sql.trim();
  if (s.endsWith(";")) s = s.slice(0, -1);
  // remove literais 'texto' (com '' interno) e identificadores "texto" antes de checar palavras proibidas
  const stripped = s.replace(/'(?:[^']|'')*'/g, "").replace(/"(?:[^"]|"")*"/g, "");
  if (stripped.includes(";")) throw new Error("SQL não é só-leitura");
  if (!/^(select|with)\b/i.test(s.trim())) throw new Error("SQL não é só-leitura");
  if (WRITE_WORDS.test(stripped)) throw new Error("SQL não é só-leitura");
}

// Lista tabelas do schema public com PK (ordem) e colunas (com flag "gerada").
export function listTablesSql() {
  return `select
  c.relname as table_name,
  coalesce((
    select to_jsonb(array_agg(a.attname order by k.ord))
    from pg_constraint pk
    join unnest(pk.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
    where pk.conrelid = c.oid and pk.contype = 'p'
  ), '[]'::jsonb) as pk_columns,
  coalesce((
    select jsonb_agg(jsonb_build_object('name', a.attname, 'generated', a.attgenerated <> '') order by a.attnum)
    from pg_attribute a
    where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  ), '[]'::jsonb) as columns
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by c.relname`;
}

// Lojas com backup diário ligado no Admin Master (padrão: nenhuma).
export function listTenantsForBackupSql() {
  return `select id, name from public.tenants where backup_enabled = true order by name`;
}

function assertUuid(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`tenant id inválido: ${id}`);
  }
  return id;
}

// where tenant_id = any(array[...]::uuid[]) — ou "" se não houver filtro (tabela sem
// tenant_id, ou nenhum id passado). Usado tanto na extração quanto na contagem, pro
// backup filtrado por loja (Admin Master) bater com a mesma regra dos dois lados.
export function tenantWhereSql(tenantIds) {
  if (!tenantIds || tenantIds.length === 0) return "";
  const arr = tenantIds.map((id) => `'${assertUuid(id)}'`).join(", ");
  return ` where tenant_id = any(array[${arr}]::uuid[])`;
}

// tables: array de nomes (sem filtro) ou de { name, tenantIds } (filtro por loja).
export function countsSql(tables) {
  if (!tables.length) throw new Error("countsSql precisa de ao menos uma tabela");
  const parts = tables.map((t) => {
    const spec = typeof t === "string" ? { name: t, tenantIds: null } : t;
    const ident = quoteIdent(spec.name);
    const where = tenantWhereSql(spec.tenantIds);
    const lit = `'${spec.name.replace(/'/g, "''")}'`;
    return `select ${lit}::text as table_name, count(*)::bigint as row_count from public.${ident}${where}`;
  });
  return parts.join("\nunion all\n");
}

export function fkEdgesSql() {
  return `select distinct
  ch.relname as child,
  pa.relname as parent
from pg_constraint con
join pg_class ch on ch.oid = con.conrelid
join pg_namespace chn on chn.oid = ch.relnamespace
join pg_class pa on pa.oid = con.confrelid
join pg_namespace pan on pan.oid = pa.relnamespace
where con.contype = 'f' and chn.nspname = 'public' and pan.nspname = 'public' and ch.oid <> pa.oid
order by 1, 2`;
}

export function buildPageSql(table, orderBy, limit, offset, tenantIds) {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit inválido");
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset inválido");
  const t = quoteIdent(table);
  const where = tenantWhereSql(tenantIds);
  if (!orderBy || orderBy.length === 0) {
    return `select * from public.${t} as t${where} order by t::text limit ${limit} offset ${offset}`;
  }
  const cols = orderBy.map(quoteIdent).join(", ");
  return `select * from public.${t}${where} order by ${cols} limit ${limit} offset ${offset}`;
}

export class CliOutputError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = "CliOutputError";
    this.kind = kind;
  }
}

export function classifyCliError(text) {
  if (/unauthorized|\b401\b|access token|not logged in|supabase login|ProjectNotLinked/i.test(text)) return "auth";
  if (/Failed to run sql query|ERROR:\s+\w+|status 400/i.test(text)) return "sql";
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|timeout|network|fetch failed|status 5\d\d/i.test(text)) return "network";
  return "unknown";
}

export function parseCliOutput(stdout) {
  let json;
  try {
    json = JSON.parse(stdout.trim());
  } catch {
    throw new CliOutputError("saída não-JSON da CLI", "unknown");
  }
  if (json && json._tag === "Error") {
    const msg = `${json.error?.code ?? "?"}: ${json.error?.message ?? ""}`.slice(0, 300);
    throw new CliOutputError(msg, classifyCliError(msg));
  }
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.rows)) return json.rows;
  throw new CliOutputError("saída inesperada da CLI", "unknown");
}

// Tabela tem coluna tenant_id? Só essas são filtradas por loja; o resto (pequenas,
// necessárias pra restaurar: users, tenants, etc.) sempre vai inteira.
export function tableHasTenantId(table) {
  return (table.columns || []).some((c) => c.name === "tenant_id");
}

export function rowsToTableInfo(rows) {
  return rows.map((r) => {
    const pk = typeof r.pk_columns === "string" ? JSON.parse(r.pk_columns) : r.pk_columns;
    const cols = typeof r.columns === "string" ? JSON.parse(r.columns) : r.columns;
    return { name: r.table_name, pkColumns: pk ?? [], columns: cols ?? [] };
  });
}
