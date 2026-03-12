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
const actualClientModule = await import("../api/client.ts?settings-page-test-actual");

mock.module("../api/client", () => ({
  ...actualClientModule,
  cleanupWorktrees: mockCleanupWorktrees,
  connectLinear: mockConnectLinear,
  disconnectLinear: mockDisconnectLinear,
  getLinearStatus: mockGetLinearStatus,
  getSettings: mockGetSettings,
  testLinearConnection: mockTestLinearConnection,
  unlockLinear: mockUnlockLinear,
  updateSettings: mockUpdateSettings,
}));

const { render, screen, cleanup, fireEvent, waitFor, act } = await import("@testing-library/react");
const { SettingsPage } = await import("./SettingsPage");

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];

  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    for (const channel of FakeBroadcastChannel.instances) {
      if (channel.name === this.name && channel !== this) {
        channel.onmessage?.({ data } as MessageEvent);
      }
    }
  }

  close() {
    FakeBroadcastChannel.instances = FakeBroadcastChannel.instances.filter(
      (channel) => channel !== this,
    );
  }

  static reset() {
    FakeBroadcastChannel.instances = [];
  }
}

const originalOpen = globalThis.open;
const originalBroadcastChannel = globalThis.BroadcastChannel;

beforeEach(() => {
  mockCleanupWorktrees.mockReset();
  mockConnectLinear.mockReset();
  mockDisconnectLinear.mockReset();
  mockGetLinearStatus.mockReset();
  mockGetSettings.mockReset();
  mockTestLinearConnection.mockReset();
  mockUnlockLinear.mockReset();
  mockUpdateSettings.mockReset();
  FakeBroadcastChannel.reset();
  globalThis.BroadcastChannel = FakeBroadcastChannel as typeof BroadcastChannel;
  globalThis.open = mock(() => null) as typeof globalThis.open;
});

afterEach(() => {
  cleanup();
  globalThis.BroadcastChannel = originalBroadcastChannel;
  globalThis.open = originalOpen;
});

const primeSettingsLoad = (overrides?: { linearClientId?: string; linearCallbackUrl?: string }) => {
  mockGetSettings.mockResolvedValue([
    { key: "linear_client_id", value: overrides?.linearClientId ?? "" },
    {
      key: "linear_callback_url",
      value: overrides?.linearCallbackUrl ?? "",
    },
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
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText("Linear Client ID")).toBeDefined();
    expect(screen.getByText("Linear Callback URL")).toBeDefined();
    expect(screen.queryByLabelText("Linear passphrase")).toBeNull();
  });

  test("renders Linear OAuth settings and saves them", async () => {
    primeSettingsLoad();
    mockGetLinearStatus.mockResolvedValue({ connected: false, locked: false });
    mockUpdateSettings.mockResolvedValue(undefined);

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText("Linear Client ID")).toBeDefined());

    fireEvent.change(screen.getByLabelText("Linear Client ID"), {
      target: { value: "linear-client-id" },
    });
    fireEvent.change(screen.getByLabelText("Linear Callback URL"), {
      target: { value: "http://127.0.0.1:4310/api/linear/callback" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalled());
    expect(mockUpdateSettings).toHaveBeenCalledWith([
      { key: "linear_client_id", value: "linear-client-id" },
      { key: "linear_callback_url", value: "http://127.0.0.1:4310/api/linear/callback" },
    ]);
  });

  test("opens the returned authorization URL after connect", async () => {
    primeSettingsLoad({
      linearClientId: "linear-client-id",
      linearCallbackUrl: "http://127.0.0.1:4310/api/linear/callback",
    });
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

  test("refreshes Linear status after OAuth completion is broadcast from the callback tab", async () => {
    primeSettingsLoad({
      linearClientId: "linear-client-id",
      linearCallbackUrl: "http://127.0.0.1:25150/api/linear/callback",
    });
    mockGetLinearStatus
      .mockResolvedValueOnce({ connected: false, locked: true })
      .mockResolvedValueOnce({ connected: true, locked: false });
    mockConnectLinear.mockResolvedValue({
      authorizeUrl: "https://linear.app/oauth/authorize?state=abc",
    });
    mockTestLinearConnection.mockResolvedValue({
      ok: true,
      organizationName: "Acme",
      userName: "Jane Doe",
      userEmail: "jane@example.com",
    });

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Connect" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(mockConnectLinear).toHaveBeenCalled());

    await act(async () => {
      const callbackChannel = new FakeBroadcastChannel("aop-linear-oauth");
      callbackChannel.postMessage({ type: "linear-oauth-complete" });
      callbackChannel.close();
    });

    await waitFor(() => expect(screen.getByText("Connected")).toBeDefined());
    expect(screen.getByText("Acme")).toBeDefined();
    expect(screen.getByText("Jane Doe")).toBeDefined();
    expect(screen.getByText("jane@example.com")).toBeDefined();
  });

  test("renders locked state and unlocks from secure storage", async () => {
    primeSettingsLoad({
      linearClientId: "linear-client-id",
      linearCallbackUrl: "http://127.0.0.1:4310/api/linear/callback",
    });
    mockGetLinearStatus.mockResolvedValue({ connected: true, locked: true });
    mockUnlockLinear.mockResolvedValue(undefined);

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByText("Connected, locked")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => expect(mockUnlockLinear).toHaveBeenCalled());
  });

  test("renders unlocked workspace details", async () => {
    primeSettingsLoad({
      linearClientId: "linear-client-id",
      linearCallbackUrl: "http://127.0.0.1:4310/api/linear/callback",
    });
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
