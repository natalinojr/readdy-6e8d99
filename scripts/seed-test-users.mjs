#!/usr/bin/env node
/**
 * seed-test-users.mjs — cria/atualiza os usuários de teste da loja "Testes PDV"
 * (TESTES-CHECKLIST.md › pergunta 2). Idempotente: rodar de novo só troca senha/PIN.
 *
 * Uso (a chave NUNCA vai para o git nem para o terminal):
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-test-users.mjs
 * Pegar a chave: npx supabase projects api-keys --project-ref mdghhjemzdmeuqpzuyzx
 *
 * Saída: .test-users.json (gitignored) com e-mail, senha, crachá e PIN de cada perfil.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";

const URL = "https://mdghhjemzdmeuqpzuyzx.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error("Defina SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}
const TENANT_TESTES_PDV = "db3ca014-6c03-4c2e-97b9-9542cf825da2";

const PERFIS = [
  { key: "admin", name: "QA Admin", email: "qa.admin@erpos-teste.com", role: "admin", badge: "9001" },
  { key: "caixa", name: "QA Caixa", email: "qa.caixa@erpos-teste.com", role: "cashier", badge: "9002" },
  { key: "garcom", name: "QA Garçom", email: "qa.garcom@erpos-teste.com", role: "waiter", badge: "9003" },
];

const senha = () => randomBytes(12).toString("base64url"); // 16 chars, sem espaço
const pin = () => String(randomInt(1000, 9999));
// mesma fórmula do login-pin: sha256(pin + user.id) em hex
const pinHash = (p, id) => createHash("sha256").update(p + id).digest("hex");

const db = createClient(URL, KEY, { auth: { persistSession: false } });

async function findUserByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === email);
    if (u) return u;
    if (data.users.length < 200) return null;
    page++;
  }
}

const out = { tenant_id: TENANT_TESTES_PDV, tenant_name: "Testes PDV", created_at: new Date().toISOString(), users: {} };

for (const p of PERFIS) {
  const password = senha();
  const userPin = pin();
  let user = await findUserByEmail(p.email);
  if (user) {
    const { error } = await db.auth.admin.updateUserById(user.id, { password, email_confirm: true, user_metadata: { name: p.name } });
    if (error) throw error;
  } else {
    const { data, error } = await db.auth.admin.createUser({ email: p.email, password, email_confirm: true, user_metadata: { name: p.name } });
    if (error) throw error;
    user = data.user;
  }
  const id = user.id;

  // public.users (o trigger handle_new_auth_user já cria id/name/email; aqui garantimos crachá + PIN)
  const { error: uErr } = await db
    .from("users")
    .upsert({ id, name: p.name, email: p.email, badge_number: p.badge, pin_hash: pinHash(userPin, id), is_active: true, deleted_at: null }, { onConflict: "id" });
  if (uErr) throw uErr;

  // vínculo com a loja de testes
  const { error: tErr } = await db
    .from("user_tenants")
    .upsert({ user_id: id, tenant_id: TENANT_TESTES_PDV, role: p.role, training_mode: false }, { onConflict: "user_id,tenant_id" });
  if (tErr) throw tErr;

  out.users[p.key] = { id, name: p.name, email: p.email, password, role: p.role, badge_number: p.badge, pin: userPin };
  console.log(`${p.key.padEnd(7)} ${p.email} (${p.role}) crachá ${p.badge} — ok`);
}

writeFileSync(".test-users.json", JSON.stringify(out, null, 2) + "\n");
console.log("Credenciais gravadas em .test-users.json (gitignored).");
