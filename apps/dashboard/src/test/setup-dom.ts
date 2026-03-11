import { Window } from "happy-dom";

const copyWindowProperties = (win: Window) => {
  for (const key of Object.getOwnPropertyNames(win)) {
    if (!(key in globalThis)) {
      Object.defineProperty(globalThis, key, {
        value: (win as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
  }
};

export const setupDashboardDom = () => {
  if (!globalThis.document || !("defaultView" in globalThis.document)) {
    const win = new Window({ url: "http://localhost" });
    copyWindowProperties(win);
    globalThis.document = win.document as unknown as Document;
  }

  const win = globalThis.document.defaultView as (Window & { SyntaxError?: typeof SyntaxError }) | null;
  if (win && win.SyntaxError === undefined) {
    Object.defineProperty(win, "SyntaxError", {
      value: SyntaxError,
      configurable: true,
      writable: true,
    });
  }
};
