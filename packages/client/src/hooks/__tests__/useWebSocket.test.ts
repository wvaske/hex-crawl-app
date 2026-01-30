import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebSocket } from "../useWebSocket";
import { useSessionStore } from "../../stores/useSessionStore";

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readyState = 0;
  close = vi.fn();
  send = vi.fn();

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  simulateClose() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("useWebSocket", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    useSessionStore.getState().reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets connecting on mount with a campaignId", () => {
    renderHook(() => useWebSocket("c1"));
    expect(useSessionStore.getState().connectionStatus).toBe("connecting");
  });

  it("sets connected on ws open", () => {
    renderHook(() => useWebSocket("c1"));
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.simulateOpen());
    expect(useSessionStore.getState().connectionStatus).toBe("connected");
  });

  it("cleans up on unmount", () => {
    const { unmount } = renderHook(() => useWebSocket("c1"));
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.simulateOpen());
    unmount();
    expect(ws.close).toHaveBeenCalled();
  });

  it("sets reconnecting on close", () => {
    vi.useFakeTimers();
    renderHook(() => useWebSocket("c1"));
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.simulateOpen());
    act(() => ws.simulateClose());
    expect(useSessionStore.getState().connectionStatus).toBe("reconnecting");
    vi.useRealTimers();
  });

  it("does nothing for null campaignId", () => {
    renderHook(() => useWebSocket(null));
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(useSessionStore.getState().connectionStatus).toBe("disconnected");
  });
});
