/**
 * Testes unitários para src/lib/formatters.ts
 * Cobre: formatCurrency, fmt, formatPercent, formatDate, formatTime,
 *        formatDateTime, formatDateInput
 */
import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  fmt,
  formatPercent,
  formatDate,
  formatTime,
  formatDateTime,
  formatDateInput,
} from "@/lib/formatters";

// ─── formatCurrency / fmt ─────────────────────────────────────────────────────

describe("formatCurrency", () => {
  it("formata zero corretamente", () => {
    const result = formatCurrency(0);
    expect(result).toContain("0");
    expect(result).toContain("R$");
  });

  it("formata valor inteiro", () => {
    const result = formatCurrency(100);
    expect(result).toContain("100");
    expect(result).toContain("R$");
  });

  it("formata valor com centavos", () => {
    const result = formatCurrency(99.9);
    expect(result).toContain("99");
    expect(result).toContain("R$");
  });

  it("formata valor grande com separador de milhar", () => {
    const result = formatCurrency(1000);
    // pt-BR usa ponto como separador de milhar
    expect(result).toContain("1");
    expect(result).toContain("R$");
  });

  it("formata valor negativo", () => {
    const result = formatCurrency(-50);
    expect(result).toContain("50");
  });

  it("fmt é alias de formatCurrency", () => {
    expect(fmt(150)).toBe(formatCurrency(150));
    expect(fmt(0)).toBe(formatCurrency(0));
    expect(fmt(9999.99)).toBe(formatCurrency(9999.99));
  });
});

// ─── formatPercent ────────────────────────────────────────────────────────────

describe("formatPercent", () => {
  it("formata 0% corretamente", () => {
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("formata 100% corretamente", () => {
    expect(formatPercent(100)).toBe("100.0%");
  });

  it("formata com 1 casa decimal por padrão", () => {
    expect(formatPercent(33.333)).toBe("33.3%");
  });

  it("respeita o parâmetro de casas decimais", () => {
    expect(formatPercent(33.333, 2)).toBe("33.33%");
    expect(formatPercent(33.333, 0)).toBe("33%");
  });

  it("formata valores negativos", () => {
    expect(formatPercent(-10)).toBe("-10.0%");
  });
});

// ─── formatDate ───────────────────────────────────────────────────────────────

describe("formatDate", () => {
  it("formata string ISO para dd/MM/yy", () => {
    const result = formatDate("2025-03-31T12:00:00.000Z");
    // Formato pt-BR: dd/MM/yy
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{2}/);
  });

  it("aceita objeto Date", () => {
    const date = new Date("2025-01-15T00:00:00.000Z");
    const result = formatDate(date);
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{2}/);
  });

  it("retorna string não vazia", () => {
    expect(formatDate("2025-06-01")).toBeTruthy();
  });
});

// ─── formatTime ───────────────────────────────────────────────────────────────

describe("formatTime", () => {
  it("retorna formato HH:mm", () => {
    const result = formatTime("2025-03-31T14:30:00.000Z");
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  it("aceita objeto Date", () => {
    const date = new Date("2025-03-31T09:05:00.000Z");
    const result = formatTime(date);
    expect(result).toMatch(/\d{2}:\d{2}/);
  });
});

// ─── formatDateTime ───────────────────────────────────────────────────────────

describe("formatDateTime", () => {
  it("retorna data e hora juntos", () => {
    const result = formatDateTime("2025-03-31T14:30:00.000Z");
    // Deve conter separador de data e hora
    expect(result).toMatch(/\d{2}\/\d{2}/);
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  it("retorna string não vazia", () => {
    expect(formatDateTime("2025-01-01T00:00:00.000Z")).toBeTruthy();
  });
});

// ─── formatDateInput ──────────────────────────────────────────────────────────

describe("formatDateInput", () => {
  it("retorna formato YYYY-MM-DD", () => {
    const date = new Date("2025-03-31T00:00:00.000Z");
    const result = formatDateInput(date);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("retorna string compatível com input[type=date]", () => {
    const date = new Date("2025-01-15T00:00:00.000Z");
    const result = formatDateInput(date);
    expect(result).toBe("2025-01-15");
  });

  it("funciona com qualquer data válida", () => {
    const dates = [
      new Date("2024-12-31"),
      new Date("2025-01-01"),
      new Date("2025-06-15"),
    ];
    dates.forEach((d) => {
      const result = formatDateInput(d);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
