#!/usr/bin/env node
/**
 * check.mjs — verificador determinístico do ERPOS (Fase 0.1 de ORQUESTRACAO-AGENTES.md)
 *
 * Compara o estado atual com scripts/baseline.json e acusa REGRESSÃO
 * (não o legado: ~290 erros de TS herdados são aceitos enquanto não aumentarem).
 *
 * Modos:
 *   node scripts/check.mjs --fast            testes relacionados ao arquivo editado
 *                                            (lê o JSON do hook PostToolUse no stdin, ou --file <path>)
 *   node scripts/check.mjs                   completo: tsc + vitest (pula se nada mudou desde o último OK)
 *   node scripts/check.mjs --build           completo + vite build
 *   node scripts/check.mjs --force           completo mesmo sem mudança
 *   node scripts/check.mjs --update-baseline grava o estado atual como novo baseline
 *
 * Saída/exit code (pensado para hooks do Claude Code):
 *   0  sem regressão (stdout: resumo)
 *   2  regressão (stderr: o que quebrou → o Claude lê e corrige)
 *   1  erro do próprio script
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts", "baseline.json");
const TMP = join(ROOT, "node_modules", ".tmp");
const STAMP = join(TMP, "check-stamp.json");
const VITEST_JSON = join(TMP, "vitest-result.json");
// caminho RELATIVO na linha de comando: com shell:true no Windows, o espaço em
// "ERPOS V2 - claude" partiria o argumento absoluto
const VITEST_JSON_ARG = "node_modules/.tmp/vitest-result.json";
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

const args = new Set(process.argv.slice(2));
const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

mkdirSync(TMP, { recursive: true });

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return { code: r.status ?? 1, out: (r.stdout || "") + (r.stderr || "") };
}

function readJson(p, fallback) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

// ─── tsc ────────────────────────────────────────────────────────────────────
function runTsc() {
  const t0 = Date.now();
  const { out } = run(NPX, ["tsc", "--noEmit", "--incremental", "--project", "tsconfig.app.json"]);
  const lines = out.split(/\r?\n/).filter((l) => /error TS\d+/.test(l));
  // "src/x.tsx(10,5): error TS2339: ..." → "src/x.tsx: TS2339"
  const keys = lines.map((l) => {
    const m = l.match(/^(.+?)\(\d+,\d+\): error (TS\d+)/);
    return m ? `${m[1].replace(/\\/g, "/")}: ${m[2]}` : l;
  });
  return { count: lines.length, keys, lines, secs: Math.round((Date.now() - t0) / 1000) };
}

// ─── vitest ─────────────────────────────────────────────────────────────────
function parseVitestJson() {
  const j = readJson(VITEST_JSON, null);
  if (!j) return null;
  const failed = [];
  for (const f of j.testResults || []) {
    const file = relative(ROOT, f.name).replace(/\\/g, "/");
    if (f.status === "failed" && (!f.assertionResults || f.assertionResults.length === 0)) {
      failed.push(`${file} (arquivo não carregou: ${(f.message || "").split("\n")[0]})`);
    }
    for (const a of f.assertionResults || []) {
      if (a.status === "failed") failed.push(`${file} > ${a.fullName}`);
    }
  }
  return { total: j.numTotalTests, passed: j.numPassedTests, failed };
}

function runVitest(extra = []) {
  const t0 = Date.now();
  const { out } = run(NPX, ["vitest", "run", "--reporter=json", `--outputFile=${VITEST_JSON_ARG}`, ...extra]);
  const parsed = parseVitestJson();
  if (!parsed) return { error: out.slice(-2000), secs: Math.round((Date.now() - t0) / 1000) };
  return { ...parsed, secs: Math.round((Date.now() - t0) / 1000) };
}

function runVitestRelated(file) {
  const t0 = Date.now();
  const { out } = run(NPX, ["vitest", "related", "--run", "--reporter=json", `--outputFile=${VITEST_JSON_ARG}`, file]);
  const parsed = parseVitestJson();
  if (!parsed) return { error: out.slice(-2000), secs: Math.round((Date.now() - t0) / 1000) };
  return { ...parsed, secs: Math.round((Date.now() - t0) / 1000) };
}

// ─── build ──────────────────────────────────────────────────────────────────
function runBuild() {
  const t0 = Date.now();
  const { code, out } = run(NPX, ["vite", "build"]);
  return { ok: code === 0, tail: out.slice(-1500), secs: Math.round((Date.now() - t0) / 1000) };
}

// ─── "mudou alguma coisa?" ──────────────────────────────────────────────────
function codeFingerprint() {
  const status = run("git", ["status", "--porcelain", "--untracked-files=all"]).out;
  const diff = run("git", ["diff", "HEAD", "--", "src", "supabase", "package.json", "tsconfig.app.json", "vite.config.ts"]).out;
  const head = run("git", ["rev-parse", "HEAD"]).out.trim();
  const relevant = status
    .split(/\r?\n/)
    .filter((l) => /\s(src\/|supabase\/|package\.json|tsconfig|vite\.config)/.test(l))
    .join("\n");
  return createHash("sha1").update(head + relevant + diff).digest("hex");
}

// ─── modos ──────────────────────────────────────────────────────────────────
function fast() {
  let file = argValue("--file");
  if (!file) {
    let stdin = "";
    try {
      stdin = readFileSync(0, "utf8");
    } catch {
      /* sem stdin */
    }
    const hook = stdin.trim() ? readJson0(stdin) : null;
    if (stdin.trim() && !hook) process.stderr.write("[check --fast] stdin do hook não é JSON válido; nada verificado.\n");
    file = hook?.tool_input?.file_path || hook?.tool_input?.notebook_path;
  }
  if (!file) return 0;
  const rel = relative(ROOT, resolve(file)).replace(/\\/g, "/");
  if (!/^src\/.*\.(ts|tsx)$/.test(rel)) return 0; // só código do front tem teste unitário
  const r = runVitestRelated(rel);
  if (r.error) {
    process.stderr.write(`[check --fast] vitest não rodou para ${rel}:\n${r.error}\n`);
    return 2;
  }
  if (r.total === 0) return 0; // nada testa esse arquivo
  const baseline = readJson(BASELINE, { vitest: { failed: [] } });
  const novos = r.failed.filter((f) => !baseline.vitest.failed.includes(f));
  if (novos.length) {
    process.stderr.write(
      `[check --fast] ${novos.length} teste(s) passaram a falhar após editar ${rel} (${r.secs}s):\n` +
        novos.map((f) => `  ✗ ${f}`).join("\n") +
        `\nRode: npx vitest run <arquivo de teste> para ver o detalhe. Corrija antes de seguir.\n`,
    );
    return 2;
  }
  process.stdout.write(`[check --fast] ${r.passed}/${r.total} testes relacionados a ${rel} OK (${r.secs}s)\n`);
  return 0;
}

function readJson0(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function full({ withBuild, force, update }) {
  const fp = codeFingerprint();
  if (!force && !update) {
    const stamp = readJson(STAMP, null);
    if (stamp?.fingerprint === fp && stamp?.ok && (!withBuild || stamp?.build)) {
      process.stdout.write(`[check] nada mudou em src/ ou supabase/ desde o último check OK (${stamp.at}). Pulando.\n`);
      return 0;
    }
  }

  const baseline = readJson(BASELINE, null);
  const tsc = runTsc();
  const vt = runVitest();
  const build = withBuild ? runBuild() : null;

  if (update || !baseline) {
    const b = {
      updated_at: new Date().toISOString(),
      tsc: { count: tsc.count, keys: tsc.keys },
      vitest: { total: vt.total ?? 0, failed: vt.failed ?? [] },
    };
    writeFileSync(BASELINE, JSON.stringify(b, null, 2) + "\n");
    process.stdout.write(`[check] baseline gravado: tsc=${b.tsc.count} erros, vitest=${b.vitest.total} testes (${b.vitest.failed.length} falhando)\n`);
    writeFileSync(STAMP, JSON.stringify({ fingerprint: fp, ok: true, build: !!build?.ok, at: new Date().toISOString() }));
    return 0;
  }

  const problems = [];

  // tsc: regressão = erros NOVOS (arquivo+código) ou contagem maior
  const baseKeys = new Map();
  for (const k of baseline.tsc.keys || []) baseKeys.set(k, (baseKeys.get(k) || 0) + 1);
  const novosTs = [];
  const seen = new Map();
  tsc.keys.forEach((k, i) => {
    seen.set(k, (seen.get(k) || 0) + 1);
    if (seen.get(k) > (baseKeys.get(k) || 0)) novosTs.push(tsc.lines[i]);
  });
  if (tsc.count > baseline.tsc.count || novosTs.length) {
    problems.push(
      `TypeScript: ${tsc.count} erros (baseline ${baseline.tsc.count}). Novos:\n` +
        novosTs.slice(0, 15).map((l) => `  ${l}`).join("\n") +
        (novosTs.length > 15 ? `\n  … +${novosTs.length - 15}` : ""),
    );
  }

  // vitest
  if (vt.error) {
    problems.push(`vitest não rodou:\n${vt.error}`);
  } else {
    const novos = vt.failed.filter((f) => !baseline.vitest.failed.includes(f));
    if (novos.length) {
      problems.push(`Testes: ${novos.length} falha(s) nova(s):\n` + novos.map((f) => `  ✗ ${f}`).join("\n"));
    }
    if (vt.total < baseline.vitest.total) {
      problems.push(`Testes: a suíte encolheu (${vt.total} < ${baseline.vitest.total}). Algum arquivo de teste sumiu ou não carregou.`);
    }
  }

  if (build && !build.ok) {
    problems.push(`vite build FALHOU:\n${build.tail}`);
  }

  const resumo =
    `tsc ${tsc.count}/${baseline.tsc.count} erros (${tsc.secs}s) · ` +
    `vitest ${vt.passed ?? "?"}/${vt.total ?? "?"} passando, ${vt.failed?.length ?? "?"} falhando (${vt.secs}s)` +
    (build ? ` · build ${build.ok ? "OK" : "FALHOU"} (${build.secs}s)` : "");

  if (problems.length) {
    process.stderr.write(`[check] REGRESSÃO — ${resumo}\n\n${problems.join("\n\n")}\n\nCorrija antes de encerrar. (Se a mudança for intencional: node scripts/check.mjs --update-baseline)\n`);
    writeFileSync(STAMP, JSON.stringify({ fingerprint: fp, ok: false, at: new Date().toISOString() }));
    return 2;
  }

  // melhorou? avisa para atualizar o baseline (não faz sozinho: decisão humana)
  const ganhos = [];
  if (tsc.count < baseline.tsc.count) ganhos.push(`tsc caiu de ${baseline.tsc.count} para ${tsc.count}`);
  if (vt.failed && vt.failed.length < baseline.vitest.failed.length) ganhos.push(`testes falhando caíram de ${baseline.vitest.failed.length} para ${vt.failed.length}`);
  process.stdout.write(`[check] OK — ${resumo}\n` + (ganhos.length ? `  Melhorou (${ganhos.join("; ")}). Para travar: node scripts/check.mjs --update-baseline\n` : ""));
  writeFileSync(STAMP, JSON.stringify({ fingerprint: fp, ok: true, build: !!build?.ok, at: new Date().toISOString() }));
  return 0;
}

// Hook Stop: se já estamos num loop de "stop bloqueado", não bloqueia de novo
function stopHookActive() {
  if (!args.has("--stop-hook")) return false;
  try {
    const hook = readJson0(readFileSync(0, "utf8"));
    return !!hook?.stop_hook_active;
  } catch {
    return false;
  }
}

let code;
if (args.has("--fast")) {
  code = fast();
} else if (stopHookActive()) {
  process.stdout.write("[check] stop hook já ativo; não bloqueia de novo.\n");
  code = 0;
} else {
  code = full({ withBuild: args.has("--build"), force: args.has("--force"), update: args.has("--update-baseline") });
}
process.exit(code);
