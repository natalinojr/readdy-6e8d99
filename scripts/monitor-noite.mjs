// Retrato rápido da operação de uma loja (padrão: VILA LESTE, hoje).
// Uso: node scripts/monitor-noite.mjs [tenant_id] [horas]
// Só leitura. Feito para responder em ~1 min "a noite foi bem?" depois de um deploy:
// pedidos, pagamentos, NFC-e, impressão, estoque negativo e erros do front.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REF = 'mdghhjemzdmeuqpzuyzx';
const TENANT = process.argv[2] || 'ac66279a-47b0-469c-8228-4844d87831a6'; // VILA LESTE
const HORAS = Number(process.argv[3] || 12);

// A query vai por arquivo: passar SQL como argumento quebra no shell do Windows.
const DIR = mkdtempSync(join(tmpdir(), 'erpos-monitor-'));
let n = 0;
function sql(query) {
  const f = join(DIR, `q${n++}.sql`);
  writeFileSync(f, query, 'utf8');
  const out = execFileSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', REF, '-f', f], {
    encoding: 'utf8', shell: true, maxBuffer: 20 * 1024 * 1024,
  });
  const json = out.slice(out.indexOf('{'));
  return JSON.parse(json).rows ?? [];
}

const W = `t.created_at > now() - interval '${HORAS} hours'`;
const bloco = (titulo, rows) => {
  console.log(`\n## ${titulo}`);
  if (!rows.length) { console.log('  (nada)'); return; }
  for (const r of rows) console.log('  ' + Object.entries(r).map(([k, v]) => `${k}=${v}`).join('  '));
};

const q = {
  resumo: `select count(*)::int pedidos, count(*) filter (where t.is_paid)::int pagos,
      count(*) filter (where t.status='cancelled')::int cancelados,
      coalesce(sum(t.total_amount) filter (where t.is_paid),0)::numeric faturamento,
      max(t.created_at at time zone 'America/Sao_Paulo')::text ultimo
    from orders t where t.tenant_id='${TENANT}' and ${W}`,
  pagamentos: `select count(*)::int linhas, coalesce(sum(t.amount),0)::numeric total,
      count(distinct t.order_id)::int pedidos from payments t where t.tenant_id='${TENANT}' and ${W}`,
  pago_em_dobro: `select t.order_id::text, count(*)::int linhas, sum(t.amount)::numeric pago, o.total_amount
    from payments t join orders o on o.id=t.order_id
    where t.tenant_id='${TENANT}' and ${W} group by 1, o.total_amount
    having sum(t.amount) > o.total_amount + 0.01`,
  nfce: `select t.status, count(*)::int, max(left(coalesce(t.error_message,''),80)) erro
    from fiscal_documents t where t.tenant_id='${TENANT}' and ${W} group by 1`,
  nfce_faltando: `select o.number, o.total_amount, (o.created_at at time zone 'America/Sao_Paulo')::text quando
    from orders o where o.tenant_id='${TENANT}' and o.is_paid and coalesce(o.is_training,false)=false
      and o.status <> 'cancelled' and o.created_at > now() - interval '${HORAS} hours'
      and not exists (select 1 from fiscal_documents f where f.tenant_id=o.tenant_id and o.id = any(f.order_ids)) order by o.created_at desc limit 10`,
  impressao: `select t.status, count(*)::int, max(left(coalesce(t.last_error,''),60)) erro
    from print_queue t where t.tenant_id='${TENANT}' and ${W} group by 1`,
  impressao_presa: `select t.order_number, t.station_label, t.status, t.retry_count,
      (t.created_at at time zone 'America/Sao_Paulo')::text quando, left(coalesce(t.last_error,''),60) erro
    from print_queue t where t.tenant_id='${TENANT}' and ${W} and t.status <> 'printed'
    order by t.created_at desc limit 10`,
  estoque_negativo: `select t.name, t.current_stock, t.unit from ingredients t
    where t.tenant_id='${TENANT}' and t.current_stock < 0 order by t.current_stock limit 10`,
  pedido_travado: `select t.number, t.status, t.is_paid, (t.created_at at time zone 'America/Sao_Paulo')::text quando
    from orders t where t.tenant_id='${TENANT}' and ${W} and t.is_paid and t.status='new' order by t.created_at limit 10`,
  erros_front: `select left(t.message,90) erro, t.count, t.route, (t.last_seen at time zone 'America/Sao_Paulo')::text visto
    from dev_error_events t where t.last_seen > now() - interval '${HORAS} hours' order by t.last_seen desc limit 10`,
};

const loja = sql(`select name from tenants t where t.id='${TENANT}'`)[0]?.name ?? TENANT;
console.log(`# ${loja} — últimas ${HORAS}h (${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`);
for (const [titulo, query] of Object.entries(q)) {
  try { bloco(titulo, sql(query)); }
  catch (e) { console.log(`\n## ${titulo}\n  ERRO: ${String(e.message).slice(0, 200)}`); }
}
