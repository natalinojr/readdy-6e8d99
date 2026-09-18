// @vitest-environment node
// Import por caminho montado em tempo de execução (tsconfig.app.json não cobre scripts/).
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RETENTION_PATH = pathToFileURL(resolve(__dirname, "../../../scripts/backup/lib/retention.mjs")).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

beforeAll(async () => {
  mod = await import(/* @vite-ignore */ RETENTION_PATH);
});

describe("brasiliaDate", () => {
  it("formata AAAA-MM-DD no fuso America/Sao_Paulo", () => {
    // 2026-09-17T02:00:00Z é 2026-09-16 23:00 em Brasília (UTC-3)
    expect(mod.brasiliaDate(new Date("2026-09-17T02:00:00Z"))).toBe("2026-09-16");
    expect(mod.brasiliaDate(new Date("2026-09-17T04:00:00Z"))).toBe("2026-09-17");
  });
});

describe("selectExpired (retenção de N dias)", () => {
  it("remove só pastas com mais de 30 dias, mantém as demais", () => {
    const entries = [
      { name: "2026-08-01", complete: true }, // expirado (corte = 2026-08-31)
      { name: "2026-08-31", complete: true }, // no limite: fica
      { name: "2026-09-01", complete: true },
      { name: "2026-09-30", complete: true },
    ];
    const expired = mod.selectExpired(entries, "2026-09-30", 30);
    expect(expired).toEqual(["2026-08-01"]);
  });

  it("ignora nomes que não são pasta de data (logs, backup.lock)", () => {
    const entries = [
      { name: "logs", complete: false },
      { name: "backup.lock", complete: false },
      { name: "2026-01-01", complete: true },
      { name: "2026-09-29", complete: true },
    ];
    expect(mod.selectExpired(entries, "2026-09-30", 30)).toEqual(["2026-01-01"]);
  });

  it("nunca remove a pasta completa mais recente, mesmo expirada", () => {
    const entries = [{ name: "2020-01-01", complete: true }];
    expect(mod.selectExpired(entries, "2026-09-30", 30)).toEqual([]);
  });

  it("considera pastas parciais (.partial-HHmmss) como candidatas a expirar", () => {
    const entries = [
      { name: "2020-01-01.partial-030500", complete: false },
      { name: "2026-09-29", complete: true },
    ];
    expect(mod.selectExpired(entries, "2026-09-30", 30)).toEqual(["2020-01-01.partial-030500"]);
  });

  it("retorna ordenado ascendente por data", () => {
    const entries = [
      { name: "2020-03-01", complete: false },
      { name: "2020-01-01", complete: false },
      { name: "2020-02-01", complete: false },
      { name: "2026-09-29", complete: true },
    ];
    expect(mod.selectExpired(entries, "2026-09-30", 30)).toEqual(["2020-01-01", "2020-02-01", "2020-03-01"]);
  });
});
