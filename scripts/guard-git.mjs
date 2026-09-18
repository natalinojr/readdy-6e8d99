#!/usr/bin/env node
/**
 * guard-git.mjs — hook PreToolUse (Bash) do Claude Code. Bloqueia, para qualquer agente:
 *   - git push --force / -f para qualquer branch
 * (commit e push em main são PERMITIDOS desde 2026-09-18, por decisão do dono; cada push é deploy.)
 *   - git reset --hard, git checkout -- ., git clean -f, git branch -D (perda de trabalho do dono/Codex)
 *   - supabase db reset / db push (banco de produção)
 * Exit 2 = bloqueado (o motivo vai no stderr para o Claude). Exit 0 = segue.
 */
import { readFileSync } from "node:fs";

let input = "";
try { input = readFileSync(0, "utf8"); } catch { /* sem stdin */ }
let cmd = "";
try { cmd = String(JSON.parse(input)?.tool_input?.command ?? ""); } catch { /* não é JSON */ }
if (!cmd) process.exit(0);

// Corpo de heredoc (cat > arquivo <<'EOF' ... EOF) é conteúdo, não comando: fora da análise.
// Sem isso, documentar a própria trava ("bloqueia git push --force") era bloqueado.
const semHeredoc = cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, " <<HEREDOC ");
const norm = semHeredoc.replace(/\s+/g, " ").trim();
const rules = [
  { re: /\bgit\s+push\b[^&;|]*(\s--force\b|\s-f\b|\s--force-with-lease\b)/, why: "git push --force é proibido para agentes." },
  { re: /\bgit\s+reset\s+--hard\b/, why: "git reset --hard apaga trabalho não commitado do dono/Codex." },
  { re: /\bgit\s+checkout\s+--\s+\.|\bgit\s+restore\s+(--staged\s+)?\.(\s|$)/, why: "descartar TODAS as mudanças do working tree apaga trabalho que não é seu." },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/, why: "git clean -f apaga arquivos não rastreados de outros." },
  { re: /\bgit\s+branch\s+-D\b/, why: "git branch -D apaga branch sem merge." },
  { re: /\bsupabase\s+db\s+(reset|push)\b/, why: "supabase db reset/push mexe no banco de produção. Migração é via MCP apply_migration com revisão." },
];

for (const r of rules) {
  if (r.re.test(norm)) {
    process.stderr.write(`[guard-git] BLOQUEADO: ${r.why}\nComando: ${norm}\n`);
    process.exit(2);
  }
}
process.exit(0);
