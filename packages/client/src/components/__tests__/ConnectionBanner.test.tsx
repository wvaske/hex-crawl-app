import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionBanner } from "../ConnectionBanner";
import { useSessionStore } from "../../stores/useSessionStore";

describe("ConnectionBanner", () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
  });

  it("renders nothing when connected", () => {
    useSessionStore.getState().setConnectionStatus("connected");
    const { container } = render(<ConnectionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when disconnected", () => {
    const { container } = render(<ConnectionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("shows yellow banner when connecting", () => {
    useSessionStore.getState().setConnectionStatus("connecting");
    render(<ConnectionBanner />);
    expect(screen.getByText("Connecting...")).toBeInTheDocument();
  });

  it("shows red banner when reconnecting", () => {
    useSessionStore.getState().setConnectionStatus("reconnecting");
    render(<ConnectionBanner />);
    expect(
      screen.getByText("Connection lost. Reconnecting...")
    ).toBeInTheDocument();
  });
});
