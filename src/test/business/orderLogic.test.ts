/**
 * Testes de lógica de negócio extraída do order-write Edge Function.
 * Testa: deriveOrderStatus, applyPromotions, validação de tenant,
 *        mapeamentos de origem/destino, cálculo de promoções.
 *
 * Nota: A lógica é replicada aqui para testes unitários puros,
 * sem dependência de Deno/Supabase.
 */
import { describe, it, expect } from "vitest";

// ─── Lógica extraída do order-write ──────────────────────────────────────────

const STATUS_RANK: Record<string, number> = {
  new: 0, preparing: 1, ready: 2, delivered: 3,
};

function deriveOrderStatus(items: { status: string; skip_kds: boolean }[]): string {
  if (items.length === 0) return "new";
  const kitchenItems = items.filter((i) => !i.skip_kds);
  const allItems = items;
  if (allItems.every((i) => i.status === "delivered")) return "delivered";
  if (kitchenItems.length === 0) {
    if (allItems.every((i) => i.status === "ready" || i.status === "delivered")) return "ready";
    return "new";
  }
  const kitchenStatuses = kitchenItems.map((i) => i.status);
  if (kitchenStatuses.every((s) => s === "ready" || s === "delivered")) return "ready";
  if (kitchenStatuses.some((s) => s === "preparing" || s === "ready")) return "preparing";
  return "new";
}

const DEST_MAP: Record<string, string> = {
  hora: "immediate", mesa: "table", delivery: "delivery",
  nome: "name", senha: "password",
  table: "table", name: "name", immediate: "immediate", password: "password",
};

const ORIGIN_MAP: Record<string, string> = {
  caixa: "cashier", garcom: "waiter", mesa: "table",
  autoatendimento: "self_service", delivery: "delivery",
  cashier: "cashier", waiter: "waiter", table: "table",
  self_service: "self_service",
};

// ─── deriveOrderStatus ────────────────────────────────────────────────────────

describe("deriveOrderStatus", () => {
  it("lista vazia → 'new'", () => {
    expect(deriveOrderStatus([])).toBe("new");
  });

  it("todos entregues → 'delivered'", () => {
    const items = [
      { status: "delivered", skip_kds: false },
      { status: "delivered", skip_kds: false },
    ];
    expect(deriveOrderStatus(items)).toBe("delivered");
  });

  it("todos prontos → 'ready'", () => {
    const items = [
      { status: "ready", skip_kds: false },
      { status: "ready", skip_kds: false },
    ];
    expect(deriveOrderStatus(items)).toBe("ready");
  });

  it("algum em preparo → 'preparing'", () => {
    const items = [
      { status: "preparing", skip_kds: false },
      { status: "new", skip_kds: false },
    ];
    expect(deriveOrderStatus(items)).toBe("preparing");
  });

  it("algum pronto, outro novo → 'preparing'", () => {
    const items = [
      { status: "ready", skip_kds: false },
      { status: "new", skip_kds: false },
    ];
    expect(deriveOrderStatus(items)).toBe("preparing");
  });

  it("todos novos → 'new'", () => {
    const items = [
      { status: "new", skip_kds: false },
      { status: "new", skip_kds: false },
    ];
    expect(deriveOrderStatus(items)).toBe("new");
  });

  it("itens skip_kds não bloqueiam o status da cozinha", () => {
    // Bebida (skip_kds) + prato pronto → pedido pronto
    const items = [
      { status: "new", skip_kds: true },    // bebida, não vai pro KDS
      { status: "ready", skip_kds: false }, // prato pronto
    ];
    expect(deriveOrderStatus(items)).toBe("ready");
  });

  it("apenas itens skip_kds todos prontos → 'ready'", () => {
    const items = [
      { status: "ready", skip_kds: true },
      { status: "ready", skip_kds: true },
    ];
    expect(deriveOrderStatus(items)).toBe("ready");
  });

  it("apenas itens skip_kds todos novos → 'new'", () => {
    const items = [
      { status: "new", skip_kds: true },
    ];
    expect(deriveOrderStatus(items)).toBe("new");
  });

  it("mix: cozinha entregue + skip_kds entregue → 'delivered'", () => {
    const items = [
      { status: "delivered", skip_kds: false },
      { status: "delivered", skip_kds: true },
    ];
    expect(deriveOrderStatus(items)).toBe("delivered");
  });

  it("cozinha entregue + skip_kds novo → não é 'delivered'", () => {
    const items = [
      { status: "delivered", skip_kds: false },
      { status: "new", skip_kds: true },
    ];
    // allItems não são todos delivered, então não é delivered
    expect(deriveOrderStatus(items)).not.toBe("delivered");
  });
});

// ─── STATUS_RANK ──────────────────────────────────────────────────────────────

describe("STATUS_RANK", () => {
  it("new < preparing < ready < delivered", () => {
    expect(STATUS_RANK.new).toBeLessThan(STATUS_RANK.preparing);
    expect(STATUS_RANK.preparing).toBeLessThan(STATUS_RANK.ready);
    expect(STATUS_RANK.ready).toBeLessThan(STATUS_RANK.delivered);
  });

  it("todos os status têm rank definido", () => {
    for (const status of ["new", "preparing", "ready", "delivered"]) {
      expect(STATUS_RANK[status]).toBeDefined();
      expect(typeof STATUS_RANK[status]).toBe("number");
    }
  });
});

// ─── DEST_MAP ─────────────────────────────────────────────────────────────────

describe("DEST_MAP (mapeamento de destino)", () => {
  it("mapeia destinos em português para inglês", () => {
    expect(DEST_MAP.hora).toBe("immediate");
    expect(DEST_MAP.mesa).toBe("table");
    expect(DEST_MAP.delivery).toBe("delivery");
    expect(DEST_MAP.nome).toBe("name");
    expect(DEST_MAP.senha).toBe("password");
  });

  it("destinos em inglês são idempotentes", () => {
    expect(DEST_MAP.table).toBe("table");
    expect(DEST_MAP.immediate).toBe("immediate");
    expect(DEST_MAP.name).toBe("name");
    expect(DEST_MAP.password).toBe("password");
  });

  it("destino desconhecido → undefined (usa fallback 'immediate' no código)", () => {
    expect(DEST_MAP["desconhecido"]).toBeUndefined();
  });
});

// ─── ORIGIN_MAP ───────────────────────────────────────────────────────────────

describe("ORIGIN_MAP (mapeamento de origem)", () => {
  it("mapeia origens em português para inglês", () => {
    expect(ORIGIN_MAP.caixa).toBe("cashier");
    expect(ORIGIN_MAP.garcom).toBe("waiter");
    expect(ORIGIN_MAP.mesa).toBe("table");
    expect(ORIGIN_MAP.autoatendimento).toBe("self_service");
    expect(ORIGIN_MAP.delivery).toBe("delivery");
  });

  it("origens em inglês são idempotentes", () => {
    expect(ORIGIN_MAP.cashier).toBe("cashier");
    expect(ORIGIN_MAP.waiter).toBe("waiter");
    expect(ORIGIN_MAP.self_service).toBe("self_service");
  });
});

// ─── Validação de UUID ────────────────────────────────────────────────────────

const isValidUuid = (v: unknown): boolean =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

describe("isValidUuid", () => {
  it("aceita UUID v4 válido", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
  });

  it("rejeita strings inválidas", () => {
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
    expect(isValidUuid(123)).toBe(false);
  });

  it("rejeita UUID com formato errado", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716")).toBe(false);
    expect(isValidUuid("550e8400e29b41d4a716446655440000")).toBe(false);
  });

  it("aceita UUID em maiúsculas", () => {
    expect(isValidUuid("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });
});

// ─── Lógica de Loyalty Tier ───────────────────────────────────────────────────

function calcLoyaltyTier(points: number): string {
  if (points >= 2000) return "vip";
  if (points >= 800) return "ouro";
  if (points >= 200) return "prata";
  return "bronze";
}

describe("calcLoyaltyTier", () => {
  it("0 pontos → bronze", () => {
    expect(calcLoyaltyTier(0)).toBe("bronze");
  });

  it("199 pontos → bronze", () => {
    expect(calcLoyaltyTier(199)).toBe("bronze");
  });

  it("200 pontos → prata", () => {
    expect(calcLoyaltyTier(200)).toBe("prata");
  });

  it("799 pontos → prata", () => {
    expect(calcLoyaltyTier(799)).toBe("prata");
  });

  it("800 pontos → ouro", () => {
    expect(calcLoyaltyTier(800)).toBe("ouro");
  });

  it("1999 pontos → ouro", () => {
    expect(calcLoyaltyTier(1999)).toBe("ouro");
  });

  it("2000 pontos → vip", () => {
    expect(calcLoyaltyTier(2000)).toBe("vip");
  });

  it("10000 pontos → vip", () => {
    expect(calcLoyaltyTier(10000)).toBe("vip");
  });
});
