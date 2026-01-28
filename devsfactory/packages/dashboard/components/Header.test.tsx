import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { fireEvent, render } from "@testing-library/react";
import { StoreContext } from "../context";
import { createDashboardStore } from "../store";
import { Header } from "./Header";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("Header with store", () => {
  let store: ReturnType<typeof createDashboardStore>;

  const renderWithStore = (storeInstance = store) => {
    return render(
      <StoreContext.Provider value={storeInstance}>
        <Header />
      </StoreContext.Provider>
    );
  };

  beforeEach(() => {
    store = createDashboardStore();
  });

  test("shows 'disconnected' when not connected", () => {
    const { container } = renderWithStore();
    expect(container.textContent).toContain("disconnected");
  });

  test("shows 'connected' when connected", () => {
    store.getState().setConnected(true);
    const { container } = renderWithStore();
    expect(container.textContent).toContain("connected");
  });

  test("shows debug mode as off by default", () => {
    const { container } = renderWithStore();
    const button = container.querySelector("button");
    expect(button?.className).not.toContain("active");
  });

  test("toggles debug mode on click", () => {
    const { container } = renderWithStore();
    const button = container.querySelector("button");

    fireEvent.click(button!);
    expect(store.getState().debugMode).toBe(true);

    fireEvent.click(button!);
    expect(store.getState().debugMode).toBe(false);
  });

  test("shows debug button as active when debug mode is on", () => {
    store.getState().toggleDebugMode();
    const { container } = renderWithStore();
    const button = container.querySelector("button");
    expect(button?.className).toContain("active");
  });
});
