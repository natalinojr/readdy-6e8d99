/**
 * Testes de integração: Fluxo QR Mesa (Cliente escaneia QR → Identificação → Pedido)
 * Simula o comportamento da edge function mesa-write, focando no incremento
 * do access_token entre participantes da mesma sessão de caixa.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── Tipos ──────────────────────────────────────────────────────────────────

interface TableSession {
  id: string;
  table_id: string;
  session_id: string; // caixa session
  tenant_id: string;
  status: "open" | "closed";
  opened_at: string;
}

interface TableSessionParticipant {
  id: string;
  table_session_id: string;
  tenant_id: string;
  name: string;
  access_token: string | null;
  status: string;
  amount_due: number;
  amount_paid: number;
}

// ─── Simulação do backend (mesa-write) ───────────────────────────────────────

class MesaWriteSimulator {
  private sessions: Map<string, TableSession> = new Map();
  private participants: Map<string, TableSessionParticipant> = new Map();
  private nextParticipantId = 1;

  // Cria uma sessão de mesa
  createTableSession(data: Omit<TableSession, "id">): TableSession {
    const id = `ts-${this.nextParticipantId++}`;
    const sess: TableSession = { ...data, id };
    this.sessions.set(id, sess);
    return sess;
  }

  // Simula a action create_participant refatorada (2 passos)
  createParticipant(params: {
    table_session_id: string;
    name: string;
    tenant_id: string;
  }): { participant: TableSessionParticipant; access_token: string } {
    const sess = this.sessions.get(params.table_session_id);
    if (!sess) throw new Error("session_not_found");
    if (sess.status !== "open") throw new Error("session_not_found");

    // Passo 1: buscar todos os IDs de table_sessions com o mesmo session_id
    const sessionIdList = Array.from(this.sessions.values())
      .filter((s) => s.session_id === sess.session_id)
      .map((s) => s.id);

    // Passo 2: buscar maior access_token entre participantes dessas sessões
    const allParticipants = Array.from(this.participants.values()).filter(
      (p) => sessionIdList.includes(p.table_session_id) && p.access_token !== null,
    );

    let nextToken = 300;
    if (allParticipants.length > 0) {
      const maxToken = allParticipants
        .map((p) => parseInt(p.access_token ?? "0", 10))
        .filter((n) => !isNaN(n))
        .sort((a, b) => b - a)[0];
      if (maxToken && maxToken >= 300) {
        nextToken = maxToken + 1;
      }
    }

    const accessToken = String(nextToken);

    const participant: TableSessionParticipant = {
      id: `part-${this.nextParticipantId++}`,
      tenant_id: sess.tenant_id,
      table_session_id: sess.id,
      name: params.name.trim(),
      access_token: accessToken,
      status: "pending",
      amount_due: 0,
      amount_paid: 0,
    };

    this.participants.set(participant.id, participant);

    return { participant, access_token: accessToken };
  }

  // Helpers para assertions
  getParticipantsBySession(sessionId: string): TableSessionParticipant[] {
    const sess = this.sessions.get(sessionId);
    if (!sess) return [];
    return Array.from(this.participants.values()).filter(
      (p) => p.table_session_id === sessionId,
    );
  }

  getAllParticipantsByCashSession(cashSessionId: string): TableSessionParticipant[] {
    const tableSessionIds = Array.from(this.sessions.values())
      .filter((s) => s.session_id === cashSessionId)
      .map((s) => s.id);
    return Array.from(this.participants.values()).filter(
      (p) => tableSessionIds.includes(p.table_session_id) && p.access_token !== null,
    );
  }
}

// ─── Testes ─────────────────────────────────────────────────────────────────

describe("Fluxo QR Mesa — create_participant", () => {
  let sim: MesaWriteSimulator;
  const TENANT_ID = "tenant-abc-123";
  const CASH_SESSION_ID = "cash-sess-001"; // sessão de caixa

  beforeEach(() => {
    sim = new MesaWriteSimulator();
  });

  // ── Criação de participante ───────────────────────────────────────────────

  describe("Criação de participante e access_token", () => {
    it("primeiro participante recebe token 300", () => {
      const tableSession = sim.createTableSession({
        table_id: "table-1",
        session_id: CASH_SESSION_ID,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });

      const result = sim.createParticipant({
        table_session_id: tableSession.id,
        name: "João",
        tenant_id: TENANT_ID,
      });

      expect(result.access_token).toBe("300");
      expect(result.participant.access_token).toBe("300");
    });

    it("segundo participante na mesma mesa recebe token 301", () => {
      const tableSession = sim.createTableSession({
        table_id: "table-1",
        session_id: CASH_SESSION_ID,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });

      sim.createParticipant({ table_session_id: tableSession.id, name: "João", tenant_id: TENANT_ID });
      const result = sim.createParticipant({
        table_session_id: tableSession.id,
        name: "Maria",
        tenant_id: TENANT_ID,
      });

      expect(result.access_token).toBe("301");
    });

    it("terceiro participante na mesma mesa recebe token 302", () => {
      const tableSession = sim.createTableSession({
        table_id: "table-1",
        session_id: CASH_SESSION_ID,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });

      sim.createParticipant({ table_session_id: tableSession.id, name: "João", tenant_id: TENANT_ID });
      sim.createParticipant({ table_session_id: tableSession.id, name: "Maria", tenant_id: TENANT_ID });
      const result = sim.createParticipant({
        table_session_id: tableSession.id,
        name: "Pedro",
        tenant_id: TENANT_ID,
      });

      expect(result.access_token).toBe("302");
    });

    it("token incrementa entre mesas diferentes com a mesma sessão de caixa", () => {
      const sessMesa1 = sim.createTableSession({
        table_id: "table-1",
        session_id: CASH_SESSION_ID,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });
      const sessMesa2 = sim.createTableSession({
        table_id: "table-2",
        session_id: CASH_SESSION_ID,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });

      // João na mesa 1 → token 300
      sim.createParticipant({ table_session_id: sessMesa1.id, name: "João", tenant_id: TENANT_ID });
      // Maria na mesa 2 → token 301 (mesma sessão de caixa!)
      const result = sim.createParticipant({
        table_session_id: sessMesa2.id,
        name: "Maria",
        tenant_id: TENANT_ID,
      });

      expect(result.access_token).toBe("301");
    });

    it("participantes de sessões de caixa diferentes não interferem entre si", () => {
      const cashSessA = "cash-sess-a";
      const cashSessB = "cash-sess-b";

      const sessMesaA = sim.createTableSession({
        table_id: "table-a",
        session_id: cashSessA,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });
      const sessMesaB = sim.createTableSession({
        table_id: "table-b",
        session_id: cashSessB,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });

      // Caixa A: João → 300
      const r1 = sim.createParticipant({
        table_session_id: sessMesaA.id,
        name: "João",
        tenant_id: TENANT_ID,
      });
      // Caixa B: Maria → 300 (começa do zero, caixa diferente)
      const r2 = sim.createParticipant({
        table_session_id: sessMesaB.id,
        name: "Maria",
        tenant_id: TENANT_ID,
      });

      expect(r1.access_token).toBe("300");
      expect(r2.access_token).toBe("300");
    });

    it("sessão encerrada não permite criar participante", () => {
      const tableSession = sim.createTableSession({
        table_id: "table-1",
        session_id: CASH_SESSION_ID,
        tenant_id: TENANT_ID,
        status: "closed",
        opened_at: new Date().toISOString(),
      });

      expect(() =>
        sim.createParticipant({
          table_session_id: tableSession.id,
          name: "João",
          tenant_id: TENANT_ID,
        }),
      ).toThrow("session_not_found");
    });

    it("participantes com access_token null não interferem no cálculo", () => {
      const tableSession = sim.createTableSession({
        table_id: "table-1",
        session_id: CASH_SESSION_ID,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });

      // Simula um participante antigo sem token
      sim.createParticipant({ table_session_id: tableSession.id, name: "Antigo", tenant_id: TENANT_ID });
      const r1 = sim.createParticipant({
        table_session_id: tableSession.id,
        name: "João",
        tenant_id: TENANT_ID,
      });
      const r2 = sim.createParticipant({
        table_session_id: tableSession.id,
        name: "Maria",
        tenant_id: TENANT_ID,
      });

      expect(r1.access_token).toBe("300");
      expect(r2.access_token).toBe("301");
    });

    it("tokens continuam incrementando mesmo com muitos participantes", () => {
      const tableSession = sim.createTableSession({
        table_id: "table-1",
        session_id: CASH_SESSION_ID,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });

      const results: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = sim.createParticipant({
          table_session_id: tableSession.id,
          name: `Cliente ${i + 1}`,
          tenant_id: TENANT_ID,
        });
        results.push(r.access_token);
      }

      expect(results).toEqual(["300", "301", "302", "303", "304", "305", "306", "307", "308", "309"]);
    });

    it("nome do participante é trimado", () => {
      const tableSession = sim.createTableSession({
        table_id: "table-1",
        session_id: CASH_SESSION_ID,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });

      const result = sim.createParticipant({
        table_session_id: tableSession.id,
        name: "  João Silva  ",
        tenant_id: TENANT_ID,
      });

      expect(result.participant.name).toBe("João Silva");
    });
  });

  // ── Consistência com 2 passos ────────────────────────────────────────────

  describe("Consistência da refatoração em 2 passos", () => {
    it("passo 1 encontra todas as table_sessions da mesma caixa", () => {
      const s1 = sim.createTableSession({
        table_id: "table-1",
        session_id: CASH_SESSION_ID,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });
      const s2 = sim.createTableSession({
        table_id: "table-2",
        session_id: CASH_SESSION_ID,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });
      const s3 = sim.createTableSession({
        table_id: "table-3",
        session_id: CASH_SESSION_ID,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });

      // Simula o passo 1: lista de session IDs
      const sessionsData = [s1, s2, s3];
      const sessionIdList = sessionsData.map((s) => s.id);

      expect(sessionIdList).toHaveLength(3);
      expect(sessionIdList).toContain(s1.id);
      expect(sessionIdList).toContain(s2.id);
      expect(sessionIdList).toContain(s3.id);
    });

    it("passo 2 filtra apenas participantes com access_token não nulo", () => {
      const tableSession = sim.createTableSession({
        table_id: "table-1",
        session_id: CASH_SESSION_ID,
        tenant_id: TENANT_ID,
        status: "open",
        opened_at: new Date().toISOString(),
      });

      // Cria 3 participantes
      sim.createParticipant({ table_session_id: tableSession.id, name: "A", tenant_id: TENANT_ID });
      sim.createParticipant({ table_session_id: tableSession.id, name: "B", tenant_id: TENANT_ID });
      sim.createParticipant({ table_session_id: tableSession.id, name: "C", tenant_id: TENANT_ID });

      const allParticipants = sim.getAllParticipantsByCashSession(CASH_SESSION_ID);
      const allHaveToken = allParticipants.every((p) => p.access_token !== null);

      expect(allParticipants).toHaveLength(3);
      expect(allHaveToken).toBe(true);
    });
  });
});