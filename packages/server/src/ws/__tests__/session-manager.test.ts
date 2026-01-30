import { describe, it, expect, vi } from "vitest";
import { SessionManager } from "../session-manager.js";

function mockWs(overrides?: Partial<{ close: () => void }>) {
  return {
    send: vi.fn(),
    close: overrides?.close ?? vi.fn(),
    raw: null,
    readyState: 1,
    url: null,
  } as any;
}

describe("SessionManager", () => {
  describe("addConnection", () => {
    it("closes old ws when replacing a connection for the same userId", () => {
      const mgr = new SessionManager();
      const ws1 = mockWs();
      const ws2 = mockWs();

      mgr.addConnection("c1", "u1", "Alice", "player", ws1);
      mgr.addConnection("c1", "u1", "Alice", "player", ws2);

      expect(ws1.close).toHaveBeenCalledWith(4000, "Replaced by new connection");
      const room = mgr.getRoom("c1")!;
      expect(room.connectedClients.get("u1")!.ws).toBe(ws2);
    });

    it("does not close ws when re-adding the same ws instance", () => {
      const mgr = new SessionManager();
      const ws1 = mockWs();

      mgr.addConnection("c1", "u1", "Alice", "player", ws1);
      mgr.addConnection("c1", "u1", "Alice", "player", ws1);

      expect(ws1.close).not.toHaveBeenCalled();
    });

    it("handles close() throwing on old ws", () => {
      const mgr = new SessionManager();
      const ws1 = mockWs({
        close: () => {
          throw new Error("already closed");
        },
      });
      const ws2 = mockWs();

      // Should not throw
      expect(() => {
        mgr.addConnection("c1", "u1", "Alice", "player", ws1);
        mgr.addConnection("c1", "u1", "Alice", "player", ws2);
      }).not.toThrow();

      expect(mgr.getRoom("c1")!.connectedClients.get("u1")!.ws).toBe(ws2);
    });
  });

  describe("removeConnection", () => {
    it("cleans up empty rooms in waiting state", () => {
      const mgr = new SessionManager();
      const ws = mockWs();

      mgr.addConnection("c1", "u1", "Alice", "player", ws);
      mgr.removeConnection("c1", "u1");

      expect(mgr.getRoom("c1")).toBeUndefined();
    });

    it("keeps rooms that are active even if empty", () => {
      const mgr = new SessionManager();
      const ws = mockWs();

      mgr.addConnection("c1", "u1", "Alice", "player", ws);
      mgr.setSessionStatus("c1", "active", "s1");
      mgr.removeConnection("c1", "u1");

      expect(mgr.getRoom("c1")).toBeDefined();
    });
  });
});
