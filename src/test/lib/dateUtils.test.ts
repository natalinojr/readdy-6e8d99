/**
 * Testes unitários para src/lib/dateUtils.ts
 * Cobre: getPeriodDates, getPeriodDateObjects, getPeriodoAnterior,
 *        labelPeriodoAnterior, labelPeriodo, periodoDias
 *
 * Contrato atual (desde 2026-09-05): todos os períodos são calculados no
 * calendário de BRASÍLIA e devolvidos como strings com offset fixo "-03:00".
 *   - from = "YYYY-MM-DDT00:00:00-03:00", to = "YYYY-MM-DDT23:59:59-03:00" (inclusivo)
 *   - "7 dias" = 7 dias-calendário INCLUINDO hoje (hoje-6 … hoje); "30 dias" idem (hoje-29 … hoje)
 * As asserções comparam strings, não getHours()/getDate(), para não depender
 * do fuso da máquina que roda os testes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getPeriodDates,
  getPeriodDateObjects,
  getPeriodoAnterior,
  labelPeriodoAnterior,
  labelPeriodo,
  periodoDias,
} from "@/lib/dateUtils";

// Fixa a data atual: 2025-03-31 09:00 em Brasília (12:00Z)
const FIXED_DATE = new Date("2025-03-31T12:00:00.000Z");
const DAY_MS = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_DATE);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── getPeriodDates ───────────────────────────────────────────────────────────

describe("getPeriodDates", () => {
  it("Hoje: from = 00:00 de hoje, to = 23:59:59 de hoje (Brasília)", () => {
    const { from, to } = getPeriodDates("Hoje");
    expect(from).toBe("2025-03-31T00:00:00-03:00");
    expect(to).toBe("2025-03-31T23:59:59-03:00");
  });

  it("Hoje: usa o dia de Brasília mesmo quando o UTC já virou", () => {
    // 2025-03-31 23:30 em Brasília = 2025-04-01 02:30Z
    vi.setSystemTime(new Date("2025-04-01T02:30:00.000Z"));
    const { from } = getPeriodDates("Hoje");
    expect(from).toBe("2025-03-31T00:00:00-03:00");
  });

  it("Ontem: from = ontem 00:00, to = ontem 23:59:59", () => {
    const { from, to } = getPeriodDates("Ontem");
    expect(from).toBe("2025-03-30T00:00:00-03:00");
    expect(to).toBe("2025-03-30T23:59:59-03:00");
  });

  it("7 dias: hoje-6 até hoje (7 dias-calendário incluindo hoje)", () => {
    const { from, to } = getPeriodDates("7 dias");
    expect(from).toBe("2025-03-25T00:00:00-03:00");
    expect(to).toBe("2025-03-31T23:59:59-03:00");
  });

  it("30 dias: hoje-29 até hoje", () => {
    const { from, to } = getPeriodDates("30 dias");
    expect(from).toBe("2025-03-02T00:00:00-03:00");
    expect(to).toBe("2025-03-31T23:59:59-03:00");
  });

  it("aliases '7d' e '30d' equivalem a '7 dias' e '30 dias'", () => {
    expect(getPeriodDates("7d")).toEqual(getPeriodDates("7 dias"));
    expect(getPeriodDates("30d")).toEqual(getPeriodDates("30 dias"));
  });

  it("Este mês: do dia 1 até hoje", () => {
    const { from, to } = getPeriodDates("Este mês");
    expect(from).toBe("2025-03-01T00:00:00-03:00");
    expect(to).toBe("2025-03-31T23:59:59-03:00");
  });

  it("custom: retorna as datas exatas informadas", () => {
    const { from, to } = getPeriodDates("custom:2025-01-01:2025-01-31");
    expect(from).toBe("2025-01-01T00:00:00-03:00");
    expect(to).toBe("2025-01-31T23:59:59-03:00");
  });

  it("período desconhecido: fallback para Hoje", () => {
    expect(getPeriodDates("periodo_invalido")).toEqual(getPeriodDates("Hoje"));
  });

  it("retorna strings que o Date consegue interpretar (com offset -03:00)", () => {
    const { from, to } = getPeriodDates("30 dias");
    expect(Number.isNaN(new Date(from).getTime())).toBe(false);
    expect(Number.isNaN(new Date(to).getTime())).toBe(false);
    // 00:00 em Brasília = 03:00Z
    expect(new Date(from).toISOString()).toBe("2025-03-02T03:00:00.000Z");
  });
});

// ─── getPeriodDateObjects ─────────────────────────────────────────────────────

describe("getPeriodDateObjects", () => {
  it("retorna objetos Date (não strings)", () => {
    const { from, to } = getPeriodDateObjects("Hoje");
    expect(from).toBeInstanceOf(Date);
    expect(to).toBeInstanceOf(Date);
  });

  it("from < to sempre", () => {
    for (const periodo of ["Hoje", "Ontem", "7 dias", "30 dias"]) {
      const { from, to } = getPeriodDateObjects(periodo);
      expect(from.getTime()).toBeLessThan(to.getTime());
    }
  });

  it("Hoje cobre 1 dia menos 1 segundo (to é inclusivo)", () => {
    const { from, to } = getPeriodDateObjects("Hoje");
    expect(to.getTime() - from.getTime()).toBe(DAY_MS - 1000);
  });
});

// ─── getPeriodoAnterior ───────────────────────────────────────────────────────

describe("getPeriodoAnterior", () => {
  it("retorna string no formato custom:YYYY-MM-DD:YYYY-MM-DD", () => {
    const anterior = getPeriodoAnterior("7 dias");
    expect(anterior).toMatch(/^custom:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/);
  });

  it("7 dias (25/03–31/03) → anterior = 18/03–24/03", () => {
    expect(getPeriodoAnterior("7 dias")).toBe("custom:2025-03-18:2025-03-24");
  });

  it("Hoje → ontem", () => {
    expect(getPeriodoAnterior("Hoje")).toBe("custom:2025-03-30:2025-03-30");
  });

  it("período anterior termina antes do período atual começar (sem dia duplicado)", () => {
    for (const p of ["Hoje", "Ontem", "7 dias", "30 dias", "custom:2025-03-01:2025-03-31"]) {
      const { from: currentFrom } = getPeriodDateObjects(p);
      const { to: anteriorTo } = getPeriodDateObjects(getPeriodoAnterior(p));
      expect(anteriorTo.getTime()).toBeLessThan(currentFrom.getTime());
    }
  });

  it("período anterior tem a mesma duração do atual", () => {
    for (const p of ["Hoje", "7 dias", "30 dias", "custom:2025-03-01:2025-03-31"]) {
      expect(periodoDias(getPeriodoAnterior(p))).toBe(periodoDias(p));
    }
  });

  it("funciona com período custom", () => {
    expect(getPeriodoAnterior("custom:2025-03-01:2025-03-31")).toBe("custom:2025-01-29:2025-02-28");
  });
});

// ─── labelPeriodoAnterior ─────────────────────────────────────────────────────

describe("labelPeriodoAnterior", () => {
  it("Ontem → 'ontem'", () => {
    expect(labelPeriodoAnterior("Ontem")).toBe("ontem");
  });

  it("7 dias → '7d anteriores'", () => {
    expect(labelPeriodoAnterior("7 dias")).toBe("7d anteriores");
  });

  it("30 dias → '30d anteriores'", () => {
    expect(labelPeriodoAnterior("30 dias")).toBe("30d anteriores");
  });
});

// ─── labelPeriodo ─────────────────────────────────────────────────────────────

describe("labelPeriodo", () => {
  it("retorna o próprio período para strings simples", () => {
    expect(labelPeriodo("Hoje")).toBe("Hoje");
    expect(labelPeriodo("7 dias")).toBe("7 dias");
    expect(labelPeriodo("30 dias")).toBe("30 dias");
  });

  it("custom com datas iguais → exibe só uma data", () => {
    const label = labelPeriodo("custom:2025-03-31:2025-03-31");
    expect(label).toBe("31/03/2025");
  });

  it("custom com datas diferentes → exibe intervalo com →", () => {
    const label = labelPeriodo("custom:2025-01-01:2025-01-31");
    expect(label).toContain("→");
    expect(label).toContain("01/01/2025");
    expect(label).toContain("31/01/2025");
  });
});

// ─── periodoDias ─────────────────────────────────────────────────────────────

describe("periodoDias", () => {
  it("Hoje → 1 dia", () => {
    expect(periodoDias("Hoje")).toBe(1);
  });

  it("Ontem → 1 dia", () => {
    expect(periodoDias("Ontem")).toBe(1);
  });

  it("7 dias → 7 dias (inclui hoje)", () => {
    expect(periodoDias("7 dias")).toBe(7);
  });

  it("30 dias → 30 dias", () => {
    expect(periodoDias("30 dias")).toBe(30);
  });

  it("custom de 1 mês → 31 dias", () => {
    expect(periodoDias("custom:2025-01-01:2025-01-31")).toBe(31);
  });

  it("nunca retorna 0 ou negativo", () => {
    for (const p of ["Hoje", "Ontem", "7 dias", "30 dias"]) {
      expect(periodoDias(p)).toBeGreaterThan(0);
    }
  });
});
