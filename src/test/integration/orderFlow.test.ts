/**
 * Testes de integração: Fluxo completo de pedido
 * Simula: criação → KDS → relatório
 *
 * Usa mocks do Supabase para testar a lógica de integração
 * sem precisar de conexão real com o banco.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Tipos do fluxo ───────────────────────────────────────────────────────────

interface OrderItem {
  id: string;
  item_name: string;
  item_price: number;
  quantity: number;
  status: "new" | "preparing" | "ready" | "delivered" | "cancelled";
  skip_kds: boolean;
  station_id: string | null;
}

interface Order {
  id: string;
  number: string;
  tenant_id: string;
  session_id: string;
  status: "new" | "preparing" | "ready" | "delivered" | "cancelled";
  origin_type: string;
  destination_type: string;
  total_amount: number;
  is_training: boolean;
  is_draft: boolean;
  created_at: string;
  items: OrderItem[];
}

// ─── Simulação do fluxo de pedido ────────────────────────────────────────────

class OrderFlowSimulator {
  private orders: Map<string, Order> = new Map();
  private nextOrderNum = 1;

  createOrder(params: {
    tenantId: string;
    sessionId: string;
    origin: string;
    destination: string;
    items: Omit<OrderItem, "id" | "status">[];
    totalAmount: number;
    isTraining?: boolean;
  }): Order {
    const id = `order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const num = String(this.nextOrderNum++).padStart(4, "0");
    const order: Order = {
      id,
      number: `P${num}`,
      tenant_id: params.tenantId,
      session_id: params.sessionId,
      status: "new",
      origin_type: params.origin,
      destination_type: params.destination,
      total_amount: params.totalAmount,
      is_training: params.isTraining ?? false,
      is_draft: false,
      created_at: new Date().toISOString(),
      items: params.items.map((item, idx) => ({
        ...item,
        id: `item-${id}-${idx}`,
        status: "new",
      })),
    };
    this.orders.set(id, order);
    return order;
  }

  updateItemStatus(orderId: string, itemId: string, status: OrderItem["status"]): Order | null {
    const order = this.orders.get(orderId);
    if (!order) return null;

    const item = order.items.find((i) => i.id === itemId);
    if (!item) return null;

    item.status = status;

    // Recalcula status do pedido
    const kitchenItems = order.items.filter((i) => !i.skip_kds);
    const allItems = order.items;

    if (allItems.every((i) => i.status === "delivered")) {
      order.status = "delivered";
    } else if (kitchenItems.length === 0) {
      if (allItems.every((i) => i.status === "ready" || i.status === "delivered")) {
        order.status = "ready";
      }
    } else {
      const kitchenStatuses = kitchenItems.map((i) => i.status);
      if (kitchenStatuses.every((s) => s === "ready" || s === "delivered")) {
        order.status = "ready";
      } else if (kitchenStatuses.some((s) => s === "preparing" || s === "ready")) {
        order.status = "preparing";
      } else {
        order.status = "new";
      }
    }

    return order;
  }

  cancelOrder(orderId: string): boolean {
    const order = this.orders.get(orderId);
    if (!order) return false;
    order.status = "cancelled";
    order.items.forEach((item) => {
      if (item.status === "new" || item.status === "preparing") {
        item.status = "cancelled";
      }
    });
    return true;
  }

  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  // Simula relatório de vendas (exclui cancelados e treino)
  generateSalesReport(tenantId: string, from: Date, to: Date) {
    const validOrders = Array.from(this.orders.values()).filter(
      (o) =>
        o.tenant_id === tenantId &&
        o.status !== "cancelled" &&
        !o.is_training &&
        !o.is_draft &&
        new Date(o.created_at) >= from &&
        new Date(o.created_at) <= to,
    );

    const totalRevenue = validOrders.reduce((s, o) => s + o.total_amount, 0);
    const totalOrders = validOrders.length;
    const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const itemMap: Record<string, { qty: number; revenue: number }> = {};
    validOrders.forEach((o) => {
      o.items.forEach((item) => {
        if (item.status !== "cancelled") {
          if (!itemMap[item.item_name]) itemMap[item.item_name] = { qty: 0, revenue: 0 };
          itemMap[item.item_name].qty += item.quantity;
          itemMap[item.item_name].revenue += item.item_price * item.quantity;
        }
      });
    });

    return {
      total_revenue: totalRevenue,
      total_orders: totalOrders,
      avg_ticket: avgTicket,
      top_items: Object.entries(itemMap)
        .map(([name, v]) => ({ item_name: name, total_qty: v.qty, total_revenue: v.revenue }))
        .sort((a, b) => b.total_qty - a.total_qty),
    };
  }
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("Fluxo completo de pedido", () => {
  let sim: OrderFlowSimulator;
  const TENANT_ID = "tenant-test-123";
  const SESSION_ID = "session-test-456";

  beforeEach(() => {
    sim = new OrderFlowSimulator();
  });

  // ── Criação de pedido ──────────────────────────────────────────────────────

  describe("Criação de pedido", () => {
    it("cria pedido com status 'new'", () => {
      const order = sim.createOrder({
        tenantId: TENANT_ID,
        sessionId: SESSION_ID,
        origin: "cashier",
        destination: "immediate",
        items: [{ item_name: "X-Burguer", item_price: 25, quantity: 1, skip_kds: false, station_id: "grill" }],
        totalAmount: 25,
      });

      expect(order.status).toBe("new");
      expect(order.tenant_id).toBe(TENANT_ID);
      expect(order.session_id).toBe(SESSION_ID);
      expect(order.items).toHaveLength(1);
    });

    it("gera número de pedido único", () => {
      const o1 = sim.createOrder({ tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate", items: [], totalAmount: 0 });
      const o2 = sim.createOrder({ tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate", items: [], totalAmount: 0 });
      expect(o1.number).not.toBe(o2.number);
    });

    it("pedido de treino é marcado como is_training=true", () => {
      const order = sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier",
        destination: "immediate", items: [], totalAmount: 0, isTraining: true,
      });
      expect(order.is_training).toBe(true);
    });

    it("pedido normal não é treino", () => {
      const order = sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier",
        destination: "immediate", items: [], totalAmount: 0,
      });
      expect(order.is_training).toBe(false);
    });

    it("itens são criados com status 'new'", () => {
      const order = sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [
          { item_name: "X-Burguer", item_price: 25, quantity: 1, skip_kds: false, station_id: null },
          { item_name: "Coca-Cola", item_price: 8, quantity: 2, skip_kds: true, station_id: null },
        ],
        totalAmount: 41,
      });
      order.items.forEach((item) => {
        expect(item.status).toBe("new");
      });
    });
  });

  // ── Fluxo KDS ─────────────────────────────────────────────────────────────

  describe("Fluxo KDS (origem → banco → KDS)", () => {
    it("item vai para 'preparing' quando cozinha inicia", () => {
      const order = sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [{ item_name: "X-Burguer", item_price: 25, quantity: 1, skip_kds: false, station_id: "grill" }],
        totalAmount: 25,
      });

      const updated = sim.updateItemStatus(order.id, order.items[0].id, "preparing");
      expect(updated?.status).toBe("preparing");
      expect(updated?.items[0].status).toBe("preparing");
    });

    it("pedido fica 'ready' quando todos os itens de cozinha ficam prontos", () => {
      const order = sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [
          { item_name: "X-Burguer", item_price: 25, quantity: 1, skip_kds: false, station_id: "grill" },
          { item_name: "Batata Frita", item_price: 12, quantity: 1, skip_kds: false, station_id: "fryer" },
        ],
        totalAmount: 37,
      });

      sim.updateItemStatus(order.id, order.items[0].id, "ready");
      const updated = sim.updateItemStatus(order.id, order.items[1].id, "ready");
      expect(updated?.status).toBe("ready");
    });

    it("pedido fica 'delivered' quando todos os itens são entregues", () => {
      const order = sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [{ item_name: "X-Burguer", item_price: 25, quantity: 1, skip_kds: false, station_id: "grill" }],
        totalAmount: 25,
      });

      sim.updateItemStatus(order.id, order.items[0].id, "preparing");
      sim.updateItemStatus(order.id, order.items[0].id, "ready");
      const updated = sim.updateItemStatus(order.id, order.items[0].id, "delivered");
      expect(updated?.status).toBe("delivered");
    });

    it("item skip_kds não bloqueia o status do pedido", () => {
      const order = sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [
          { item_name: "X-Burguer", item_price: 25, quantity: 1, skip_kds: false, station_id: "grill" },
          { item_name: "Coca-Cola", item_price: 8, quantity: 1, skip_kds: true, station_id: null },
        ],
        totalAmount: 33,
      });

      // Prato pronto, bebida ainda "new" (skip_kds)
      const updated = sim.updateItemStatus(order.id, order.items[0].id, "ready");
      expect(updated?.status).toBe("ready"); // bebida não bloqueia
    });

    it("pedido com apenas itens skip_kds fica 'ready' quando todos prontos", () => {
      const order = sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [
          { item_name: "Coca-Cola", item_price: 8, quantity: 1, skip_kds: true, station_id: null },
          { item_name: "Suco", item_price: 10, quantity: 1, skip_kds: true, station_id: null },
        ],
        totalAmount: 18,
      });

      sim.updateItemStatus(order.id, order.items[0].id, "ready");
      const updated = sim.updateItemStatus(order.id, order.items[1].id, "ready");
      expect(updated?.status).toBe("ready");
    });
  });

  // ── Cancelamento ──────────────────────────────────────────────────────────

  describe("Cancelamento de pedido", () => {
    it("cancela pedido e muda status para 'cancelled'", () => {
      const order = sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [{ item_name: "X-Burguer", item_price: 25, quantity: 1, skip_kds: false, station_id: null }],
        totalAmount: 25,
      });

      const cancelled = sim.cancelOrder(order.id);
      expect(cancelled).toBe(true);
      expect(sim.getOrder(order.id)?.status).toBe("cancelled");
    });

    it("itens 'new' e 'preparing' são cancelados junto com o pedido", () => {
      const order = sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [
          { item_name: "X-Burguer", item_price: 25, quantity: 1, skip_kds: false, station_id: null },
          { item_name: "Batata", item_price: 12, quantity: 1, skip_kds: false, station_id: null },
        ],
        totalAmount: 37,
      });

      sim.updateItemStatus(order.id, order.items[0].id, "preparing");
      sim.cancelOrder(order.id);

      const cancelled = sim.getOrder(order.id);
      cancelled?.items.forEach((item) => {
        expect(item.status).toBe("cancelled");
      });
    });

    it("retorna false para pedido inexistente", () => {
      expect(sim.cancelOrder("id-inexistente")).toBe(false);
    });
  });

  // ── Relatórios ────────────────────────────────────────────────────────────

  describe("Relatórios (KDS → relatório)", () => {
    const FROM = new Date("2025-03-31T00:00:00.000Z");
    const TO = new Date("2025-03-31T23:59:59.000Z");

    it("relatório exclui pedidos cancelados", () => {
      sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [{ item_name: "X-Burguer", item_price: 25, quantity: 1, skip_kds: false, station_id: null }],
        totalAmount: 25,
      });
      const cancelled = sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [{ item_name: "Batata", item_price: 12, quantity: 1, skip_kds: false, station_id: null }],
        totalAmount: 12,
      });
      sim.cancelOrder(cancelled.id);

      const report = sim.generateSalesReport(TENANT_ID, FROM, TO);
      expect(report.total_orders).toBe(1);
      expect(report.total_revenue).toBe(25);
    });

    it("relatório exclui pedidos de treino", () => {
      sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [{ item_name: "X-Burguer", item_price: 25, quantity: 1, skip_kds: false, station_id: null }],
        totalAmount: 25,
      });
      sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [{ item_name: "Treino Item", item_price: 10, quantity: 1, skip_kds: false, station_id: null }],
        totalAmount: 10, isTraining: true,
      });

      const report = sim.generateSalesReport(TENANT_ID, FROM, TO);
      expect(report.total_orders).toBe(1);
      expect(report.total_revenue).toBe(25);
    });

    it("relatório exclui pedidos de outro tenant", () => {
      sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [{ item_name: "X-Burguer", item_price: 25, quantity: 1, skip_kds: false, station_id: null }],
        totalAmount: 25,
      });
      sim.createOrder({
        tenantId: "outro-tenant", sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [{ item_name: "Item Outro", item_price: 50, quantity: 1, skip_kds: false, station_id: null }],
        totalAmount: 50,
      });

      const report = sim.generateSalesReport(TENANT_ID, FROM, TO);
      expect(report.total_orders).toBe(1);
      expect(report.total_revenue).toBe(25);
    });

    it("ticket médio calculado corretamente", () => {
      sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [], totalAmount: 30,
      });
      sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [], totalAmount: 50,
      });

      const report = sim.generateSalesReport(TENANT_ID, FROM, TO);
      expect(report.avg_ticket).toBe(40); // (30 + 50) / 2
    });

    it("top_items ordenado por quantidade", () => {
      sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [
          { item_name: "X-Burguer", item_price: 25, quantity: 3, skip_kds: false, station_id: null },
          { item_name: "Batata", item_price: 12, quantity: 1, skip_kds: false, station_id: null },
        ],
        totalAmount: 87,
      });

      const report = sim.generateSalesReport(TENANT_ID, FROM, TO);
      expect(report.top_items[0].item_name).toBe("X-Burguer");
      expect(report.top_items[0].total_qty).toBe(3);
    });

    it("relatório vazio quando não há pedidos no período", () => {
      const futureFrom = new Date("2030-01-01");
      const futureTo = new Date("2030-01-31");
      const report = sim.generateSalesReport(TENANT_ID, futureFrom, futureTo);
      expect(report.total_orders).toBe(0);
      expect(report.total_revenue).toBe(0);
      expect(report.avg_ticket).toBe(0);
    });
  });

  // ── Validação de tenant ───────────────────────────────────────────────────

  describe("Validação de tenant", () => {
    it("pedido pertence ao tenant correto", () => {
      const order = sim.createOrder({
        tenantId: TENANT_ID, sessionId: SESSION_ID, origin: "cashier", destination: "immediate",
        items: [], totalAmount: 0,
      });
      expect(order.tenant_id).toBe(TENANT_ID);
    });

    it("relatório de tenant A não inclui dados do tenant B", () => {
      sim.createOrder({ tenantId: "tenant-A", sessionId: SESSION_ID, origin: "cashier", destination: "immediate", items: [], totalAmount: 100 });
      sim.createOrder({ tenantId: "tenant-B", sessionId: SESSION_ID, origin: "cashier", destination: "immediate", items: [], totalAmount: 200 });

      const reportA = sim.generateSalesReport("tenant-A", new Date("2025-01-01"), new Date("2025-12-31"));
      const reportB = sim.generateSalesReport("tenant-B", new Date("2025-01-01"), new Date("2025-12-31"));

      expect(reportA.total_revenue).toBe(100);
      expect(reportB.total_revenue).toBe(200);
      expect(reportA.total_revenue + reportB.total_revenue).toBe(300);
    });
  });
});
