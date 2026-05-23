/**
 * Testes de integração para src/lib/tenantQuery.ts
 * Testa os helpers de query com mocks do Supabase.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VALID_ORDER_FILTERS, applyValidOrderFilters } from "@/lib/tenantQuery";

// ─── VALID_ORDER_FILTERS ──────────────────────────────────────────────────────

describe("VALID_ORDER_FILTERS", () => {
  it("notStatus exclui cancelled e draft", () => {
    expect(VALID_ORDER_FILTERS.notStatus).toContain("cancelled");
    expect(VALID_ORDER_FILTERS.notStatus).toContain("draft");
  });

  it("isTraining é false", () => {
    expect(VALID_ORDER_FILTERS.isTraining).toBe(false);
  });

  it("isDraft é false", () => {
    expect(VALID_ORDER_FILTERS.isDraft).toBe(false);
  });
});

// ─── applyValidOrderFilters ───────────────────────────────────────────────────

describe("applyValidOrderFilters", () => {
  it("chama .not() com os filtros corretos de status", () => {
    const mockQuery = {
      not: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };

    applyValidOrderFilters(mockQuery as any);

    expect(mockQuery.not).toHaveBeenCalledWith(
      "status",
      "in",
      VALID_ORDER_FILTERS.notStatus,
    );
  });

  it("chama .eq() para is_training=false", () => {
    const mockQuery = {
      not: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };

    applyValidOrderFilters(mockQuery as any);

    expect(mockQuery.eq).toHaveBeenCalledWith("is_training", false);
  });

  it("chama .eq() para is_draft=false", () => {
    const mockQuery = {
      not: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };

    applyValidOrderFilters(mockQuery as any);

    expect(mockQuery.eq).toHaveBeenCalledWith("is_draft", false);
  });

  it("retorna o próprio query (chainable)", () => {
    const mockQuery = {
      not: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };

    const result = applyValidOrderFilters(mockQuery as any);
    expect(result).toBe(mockQuery);
  });

  it("aplica todos os 3 filtros (not + 2 eq)", () => {
    const mockQuery = {
      not: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };

    applyValidOrderFilters(mockQuery as any);

    expect(mockQuery.not).toHaveBeenCalledTimes(1);
    expect(mockQuery.eq).toHaveBeenCalledTimes(2);
  });
});

// ─── Consistência dos filtros ─────────────────────────────────────────────────

describe("Consistência dos filtros de pedido válido", () => {
  it("filtros são imutáveis (readonly)", () => {
    // TypeScript garante isso em tempo de compilação, mas verificamos o valor
    expect(VALID_ORDER_FILTERS.isTraining).toBe(false);
    expect(VALID_ORDER_FILTERS.isDraft).toBe(false);
  });

  it("formato do notStatus é compatível com Supabase .not('status', 'in', ...)", () => {
    // Supabase espera formato: (value1,value2) sem aspas
    const { notStatus } = VALID_ORDER_FILTERS;
    expect(notStatus).toMatch(/^\(.*\)$/); // começa com ( e termina com )
    expect(notStatus).not.toContain('"'); // sem aspas duplas
    expect(notStatus).not.toContain("'"); // sem aspas simples
  });
});
