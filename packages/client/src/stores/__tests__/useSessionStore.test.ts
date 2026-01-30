import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../useSessionStore";

describe("useSessionStore", () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
  });

  it("has disconnected as initial connectionStatus", () => {
    expect(useSessionStore.getState().connectionStatus).toBe("disconnected");
  });

  it("setConnectionStatus updates status", () => {
    useSessionStore.getState().setConnectionStatus("connecting");
    expect(useSessionStore.getState().connectionStatus).toBe("connecting");
  });

  it("dispatch handles connected message", () => {
    useSessionStore.getState().dispatch({
      type: "connected",
      userId: "u1",
      role: "dm",
    });
    const state = useSessionStore.getState();
    expect(state.userId).toBe("u1");
    expect(state.userRole).toBe("dm");
  });

  it("reset clears state back to initial values", () => {
    useSessionStore.getState().setConnectionStatus("connected");
    useSessionStore.getState().dispatch({
      type: "connected",
      userId: "u1",
      role: "player",
    });
    useSessionStore.getState().reset();

    const state = useSessionStore.getState();
    expect(state.connectionStatus).toBe("disconnected");
    expect(state.userId).toBeNull();
    expect(state.userRole).toBeNull();
  });
});
