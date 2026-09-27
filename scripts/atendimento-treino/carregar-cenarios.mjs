// Gera o INSERT dos cenários (cenarios.json) para o schema treino.
// uso: node scripts/atendimento-treino/carregar-cenarios.mjs > /tmp/c.sql && npx supabase db query --linked --project-ref mdghhjemzdmeuqpzuyzx -f /tmp/c.sql
import fs from 'node:fs';
const cen = JSON.parse(fs.readFileSync(new URL('./cenarios.json', import.meta.url), 'utf8'));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
console.log('insert into treino.cenarios (id, body) values');
console.log(cen.map((c) => `(${q(c.id)}, ${q(JSON.stringify(c))}::jsonb)`).join(',\n') + '\non conflict (id) do update set body = excluded.body;');
