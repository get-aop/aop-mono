import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const mockCleanupWorktrees = mock();
const mockConnectLinear = mock();
const mockDisconnectLinear = mock();
const mockGetLinearStatus = mock();
const mockGetSettings = mock();
const mockTestLinearConnection = mock();
const mockUnlockLinear = mock();
const mockUpdateSettings = mock();

mock.module("../api/client", () => ({
  cleanupWorktrees: mockCleanupWorktrees,
  connectLinear: mockConnectLinear,
  disconnectLinear: mockDisconnectLinear,
  getLinearStatus: mockGetLinearStatus,
  getSettings: mockGetSettings,
  testLinearConnection: mockTestLinearConnection,
  unlockLinear: mockUnlockLinear,
  updateSettings: mockUpdateSettings,
}));

const { render, screen, cleanup, fireEvent, waitFor } = await import("@testing-library/react");
const { SettingsPage } = await import("./SettingsPage");

const originalOpen = globalThis.open;

beforeEach(() => {
  mockCleanupWorktrees.mockReset();
  mockConnectLinear.mockReset();
  mockDisconnectLinear.mockReset();
  mockGetLinearStatus.mockReset();
  mockGetSettings.mockReset();
  mockTestLinearConnection.mockReset();
  mockUnlockLinear.mockReset();
  mockUpdateSettings.mockReset();
  globalThis.open = mock(() => null) as typeof globalThis.open;
});

afterEach(() => {
  cleanup();
  globalThis.open = originalOpen;
});

const primeSettingsLoad = () => {
  mockGetSettings.mockResolvedValue([
    { key: "max_concurrent_tasks", value: "3" },
    { key: "watcher_poll_interval_secs", value: "5" },
    { key: "agent_provider", value: "codex" },
    { key: "fast_mode", value: "true" },
  ]);
};

describe("SettingsPage Linear section", () => {
  test("renders disconnected Linear state", async () => {
    primeSettingsLoad();
    mockGetLinearStatus.mockResolvedValue({ connected: false, locked: true });

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByText("Linear")).toBeDefined());
    expect(screen.getByText("Not connected")).toBeDefined();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDefined();
    expect(screen.queryByLabelText("Linear passphrase")).toBeNull();
  });

  test("opens the returned authorization URL after connect", async () => {
    primeSettingsLoad();
    mockGetLinearStatus.mockResolvedValue({ connected: false, locked: true });
    mockConnectLinear.mockResolvedValue({
      authorizeUrl: "https://linear.app/oauth/authorize?state=abc",
    });

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Connect" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(mockConnectLinear).toHaveBeenCalled());
    expect(globalThis.open).toHaveBeenCalledWith(
      "https://linear.app/oauth/authorize?state=abc",
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("renders locked state and unlocks from secure storage", async () => {
    primeSettingsLoad();
    mockGetLinearStatus.mockResolvedValue({ connected: true, locked: true });
    mockUnlockLinear.mockResolvedValue(undefined);

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByText("Connected, locked")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => expect(mockUnlockLinear).toHaveBeenCalled());
  });

  test("renders unlocked workspace details", async () => {
    primeSettingsLoad();
    mockGetLinearStatus.mockResolvedValue({ connected: true, locked: false });
    mockTestLinearConnection.mockResolvedValue({
      ok: true,
      organizationName: "Acme",
      userName: "Jane Doe",
      userEmail: "jane@example.com",
    });

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByText("Connected")).toBeDefined());
    expect(screen.getByText("Acme")).toBeDefined();
    expect(screen.getByText("Jane Doe")).toBeDefined();
    expect(screen.getByText("jane@example.com")).toBeDefined();
  });

  test("does not render LLM provider or fast mode settings", async () => {
    primeSettingsLoad();
    mockGetLinearStatus.mockResolvedValue({ connected: false, locked: true });

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Connect" })).toBeDefined());
    expect(screen.queryByText("LLM Provider")).toBeNull();
    expect(screen.queryByText("Fast Mode")).toBeNull();
  });
});
