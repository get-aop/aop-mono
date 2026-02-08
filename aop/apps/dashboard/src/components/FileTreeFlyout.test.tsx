import { afterEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { FileTreeFlyout } from "./FileTreeFlyout";

if (!globalThis.document || !("defaultView" in globalThis.document)) {
  const win = new Window({ url: "http://localhost" });
  for (const key of Object.getOwnPropertyNames(win)) {
    if (!(key in globalThis)) {
      Object.defineProperty(globalThis, key, {
        value: (win as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
  }
  globalThis.document = win.document as unknown as Document;
}

const { render, screen, cleanup, fireEvent } = await import("@testing-library/react");

afterEach(cleanup);

const files = ["tasks.md", "design.md", "proposal.md", "specs/api.md", "specs/ui.md"];

describe("FileTreeFlyout", () => {
  test("renders collapsed pill by default", () => {
    render(<FileTreeFlyout files={files} activeFile="tasks.md" onSelectFile={() => {}} />);
    expect(screen.getByTestId("flyout-pill")).toBeTruthy();
    expect(screen.queryByTestId("flyout-panel")).toBeNull();
  });

  test("opens flyout panel on pill click", () => {
    render(<FileTreeFlyout files={files} activeFile="tasks.md" onSelectFile={() => {}} />);
    fireEvent.click(screen.getByTestId("flyout-pill"));
    expect(screen.getByTestId("flyout-panel")).toBeTruthy();
  });

  test("shows all files in flyout when open", () => {
    render(<FileTreeFlyout files={files} activeFile="tasks.md" onSelectFile={() => {}} />);
    fireEvent.click(screen.getByTestId("flyout-pill"));
    expect(screen.getByTestId("file-tasks.md")).toBeTruthy();
    expect(screen.getByTestId("file-design.md")).toBeTruthy();
    expect(screen.getByTestId("file-proposal.md")).toBeTruthy();
    expect(screen.getByTestId("file-specs/api.md")).toBeTruthy();
    expect(screen.getByTestId("file-specs/ui.md")).toBeTruthy();
  });

  test("shows folder nodes for nested paths", () => {
    render(<FileTreeFlyout files={files} activeFile="tasks.md" onSelectFile={() => {}} />);
    fireEvent.click(screen.getByTestId("flyout-pill"));
    expect(screen.getByTestId("folder-specs")).toBeTruthy();
  });

  test("calls onSelectFile when a file is clicked", () => {
    const onSelect = mock<(path: string) => void>();
    render(<FileTreeFlyout files={files} activeFile="tasks.md" onSelectFile={onSelect} />);
    fireEvent.click(screen.getByTestId("flyout-pill"));
    fireEvent.click(screen.getByTestId("file-design.md"));
    expect(onSelect).toHaveBeenCalledWith("design.md");
  });

  test("closes flyout after selecting a file", () => {
    render(<FileTreeFlyout files={files} activeFile="tasks.md" onSelectFile={() => {}} />);
    fireEvent.click(screen.getByTestId("flyout-pill"));
    expect(screen.getByTestId("flyout-panel")).toBeTruthy();
    fireEvent.click(screen.getByTestId("file-design.md"));
    expect(screen.queryByTestId("flyout-panel")).toBeNull();
  });

  test("highlights active file with amber styling", () => {
    render(<FileTreeFlyout files={files} activeFile="design.md" onSelectFile={() => {}} />);
    fireEvent.click(screen.getByTestId("flyout-pill"));
    const activeItem = screen.getByTestId("file-design.md");
    expect(activeItem.className).toContain("text-aop-amber");
  });

  test("non-active files do not have amber styling", () => {
    render(<FileTreeFlyout files={files} activeFile="tasks.md" onSelectFile={() => {}} />);
    fireEvent.click(screen.getByTestId("flyout-pill"));
    const item = screen.getByTestId("file-design.md");
    expect(item.className).not.toContain("text-aop-amber");
  });

  test("renders empty tree when no files", () => {
    render(<FileTreeFlyout files={[]} activeFile="" onSelectFile={() => {}} />);
    fireEvent.click(screen.getByTestId("flyout-pill"));
    expect(screen.getByTestId("flyout-panel")).toBeTruthy();
  });
});
