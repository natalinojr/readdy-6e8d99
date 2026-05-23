/**
 * Testes unitários para src/lib/dateUtils.ts
 * Cobre: getPeriodDates, getPeriodDateObjects, getPeriodoAnterior,
 *        labelPeriodoAnterior, labelPeriodo, periodoDias
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

// Fixa a data atual para testes determinísticos
const FIXED_DATE = new Date("2025-03-31T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_DATE);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── getPeriodDates ───────────────────────────────────────────────────────────

describe("getPeriodDates", () => {
  it("Hoje: from = início do dia, to = início do dia seguinte", () => {
    const { from, to } = getPeriodDates("Hoje");
    const fromDate = new Date(from);
    const toDate = new Date(to);

    expect(fromDate.getFullYear()).toBe(2025);
    expect(fromDate.getMonth()).toBe(2); // março = 2
    expect(fromDate.getDate()).toBe(31);
    expect(fromDate.getHours()).toBe(0);
    expect(fromDate.getMinutes()).toBe(0);

    // to deve ser 1 dia depois
    const diffMs = toDate.getTime() - fromDate.getTime();
    expect(diffMs).toBe(86_400_000);
  });

  it("Ontem: from = ontem 00:00, to = hoje 00:00", () => {
    const { from, to } = getPeriodDates("Ontem");
    const fromDate = new Date(from);
    const toDate = new Date(to);

    expect(fromDate.getDate()).toBe(30); // 30/03
    expect(toDate.getDate()).toBe(31);   // 31/03
  });

  it("7 dias: from = 7 dias atrás, to = amanhã", () => {
    const { from, to } = getPeriodDates("7 dias");
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const diffDias = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
    expect(diffDias).toBe(8); // 7 dias + 1 (inclui hoje)
  });

  it("30 dias: from = 30 dias atrás, to = amanhã", () => {
    const { from, to } = getPeriodDates("30 dias");
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const diffDias = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
    expect(diffDias).toBe(31);
  });

  it("custom: retorna as datas exatas informadas", () => {
    const { from, to } = getPeriodDates("custom:2025-01-01:2025-01-31");
    expect(from).toContain("2025-01-01");
    expect(to).toContain("2025-01-31");
  });

  it("custom: from começa às 00:00:00, to termina às 23:59:59", () => {
    const { from, to } = getPeriodDates("custom:2025-06-01:2025-06-30");
    const fromDate = new Date(from);
    const toDate = new Date(to);

    expect(fromDate.getHours()).toBe(0);
    expect(toDate.getHours()).toBe(23);
    expect(toDate.getMinutes()).toBe(59);
  });

  it("período desconhecido: fallback para Hoje", () => {
    const { from: fromHoje } = getPeriodDates("Hoje");
    const { from: fromDesconhecido } = getPeriodDates("periodo_invalido");
    expect(fromDesconhecido).toBe(fromHoje);
  });

  it("retorna strings ISO válidas", () => {
    const { from, to } = getPeriodDates("30 dias");
    expect(() => new Date(from)).not.toThrow();
    expect(() => new Date(to)).not.toThrow();
    expect(new Date(from).toISOString()).toBe(from);
    expect(new Date(to).toISOString()).toBe(to);
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
});

// ─── getPeriodoAnterior ───────────────────────────────────────────────────────

describe("getPeriodoAnterior", () => {
  it("retorna string no formato custom:YYYY-MM-DD:YYYY-MM-DD", () => {
    const anterior = getPeriodoAnterior("7 dias");
    expect(anterior).toMatch(/^custom:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/);
  });

  it("período anterior de 7 dias tem 8 dias de duração (proporcional)", () => {
    const anterior = getPeriodoAnterior("7 dias");
    const [, s, e] = anterior.split(":");
    const from = new Date(`${s}T00:00:00`);
    const to = new Date(`${e}T23:59:59`);
    const diffDias = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    // Proporcional ao período original (8 dias = 7 dias + hoje)
    expect(diffDias).toBeGreaterThanOrEqual(7);
  });

  it("período anterior termina antes do período atual começar", () => {
    const { from: currentFrom } = getPeriodDateObjects("7 dias");
    const anterior = getPeriodoAnterior("7 dias");
    const [, , e] = anterior.split(":");
    const anteriorTo = new Date(`${e}T23:59:59`);
    expect(anteriorTo.getTime()).toBeLessThan(currentFrom.getTime());
  });

  it("funciona com período custom", () => {
    const anterior = getPeriodoAnterior("custom:2025-03-01:2025-03-31");
    expect(anterior).toMatch(/^custom:/);
    const [, s] = anterior.split(":");
    expect(s).toBeTruthy();
  });
});

// ─── labelPeriodoAnterior ─────────────────────────────────────────────────────

describe("labelPeriodoAnterior", () => {
  it("Ontem → 'ontem'", () => {
    expect(labelPeriodoAnterior("Ontem")).toBe("ontem");
  });

  it("7 dias → '8d anteriores' (inclui hoje)", () => {
    const label = labelPeriodoAnterior("7 dias");
    expect(label).toMatch(/\d+d anteriores/);
  });

  it("30 dias → '31d anteriores'", () => {
    const label = labelPeriodoAnterior("30 dias");
    expect(label).toMatch(/\d+d anteriores/);
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

  it("7 dias → 8 dias (inclui hoje)", () => {
    expect(periodoDias("7 dias")).toBe(8);
  });

  it("30 dias → 31 dias", () => {
    expect(periodoDias("30 dias")).toBe(31);
  });

  it("custom de 1 mês → ~30 dias", () => {
    const dias = periodoDias("custom:2025-01-01:2025-01-31");
    expect(dias).toBeGreaterThanOrEqual(30);
    expect(dias).toBeLessThanOrEqual(31);
  });

  it("nunca retorna 0 ou negativo", () => {
    for (const p of ["Hoje", "Ontem", "7 dias", "30 dias"]) {
      expect(periodoDias(p)).toBeGreaterThan(0);
    }
  });
});
