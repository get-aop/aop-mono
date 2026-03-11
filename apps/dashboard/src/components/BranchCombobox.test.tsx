import { afterEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import type { ReactElement } from "react";
import { BranchCombobox } from "./BranchCombobox";

setupDashboardDom();

const { render, screen, cleanup, fireEvent } = await import("@testing-library/react");

afterEach(cleanup);

const renderToString = async (component: ReactElement): Promise<string> => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(component);
};

const noop = () => {};
const branches = ["main", "develop", "feature/auth", "feature/ui"];

describe("BranchCombobox", () => {
  describe("rendering", () => {
    test("renders input with custom id and testId", async () => {
      const html = await renderToString(
        <BranchCombobox
          branches={branches}
          selected="main"
          onSelect={noop}
          disabled={false}
          label="TARGET BRANCH"
          id="my-branch"
          testId="my-branch"
        />,
      );

      expect(html).toContain('id="my-branch"');
      expect(html).toContain('data-testid="my-branch"');
    });

    test("renders with default id and testId", async () => {
      const html = await renderToString(
        <BranchCombobox branches={branches} selected="main" onSelect={noop} disabled={false} />,
      );

      expect(html).toContain('id="branch-combobox"');
      expect(html).toContain('data-testid="branch-combobox"');
    });

    test("renders custom label", async () => {
      const html = await renderToString(
        <BranchCombobox
          branches={branches}
          selected=""
          onSelect={noop}
          disabled={false}
          label="TARGET BRANCH"
        />,
      );

      expect(html).toContain("TARGET BRANCH");
    });

    test("renders default label", async () => {
      const html = await renderToString(
        <BranchCombobox branches={branches} selected="" onSelect={noop} disabled={false} />,
      );

      expect(html).toContain("BASE BRANCH");
    });

    test("renders input element with autocomplete off", async () => {
      const html = await renderToString(
        <BranchCombobox branches={branches} selected="develop" onSelect={noop} disabled={false} />,
      );

      expect(html).toContain('type="text"');
      expect(html).toContain('autoComplete="off"');
    });

    test("shows loading placeholder when no branches", async () => {
      const html = await renderToString(
        <BranchCombobox branches={[]} selected="" onSelect={noop} disabled={false} />,
      );

      expect(html).toContain('placeholder="Loading..."');
    });

    test("shows search placeholder when branches exist", async () => {
      const html = await renderToString(
        <BranchCombobox branches={branches} selected="" onSelect={noop} disabled={false} />,
      );

      expect(html).toContain('placeholder="Search or type a branch..."');
    });

    test("renders disabled state", async () => {
      const html = await renderToString(
        <BranchCombobox branches={branches} selected="main" onSelect={noop} disabled={true} />,
      );

      expect(html).toContain("disabled");
    });

    test("renders as relative container for dropdown positioning", async () => {
      const html = await renderToString(
        <BranchCombobox branches={branches} selected="" onSelect={noop} disabled={false} />,
      );

      expect(html).toContain("relative");
    });
  });

  describe("dropdown interaction", () => {
    test("opens dropdown on focus and shows all branches", () => {
      render(<BranchCombobox branches={branches} selected="" onSelect={noop} disabled={false} />);
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);

      for (const branch of branches) {
        expect(screen.getByText(branch)).toBeTruthy();
      }
    });

    test("filters branches by query", () => {
      render(<BranchCombobox branches={branches} selected="" onSelect={noop} disabled={false} />);
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "feature" } });

      expect(screen.getByText("feature/auth")).toBeTruthy();
      expect(screen.getByText("feature/ui")).toBeTruthy();
      expect(screen.queryByText("main")).toBeNull();
      expect(screen.queryByText("develop")).toBeNull();
    });

    test("shows create option for non-matching query", () => {
      render(<BranchCombobox branches={branches} selected="" onSelect={noop} disabled={false} />);
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "new-branch" } });

      expect(screen.getByText("new-branch")).toBeTruthy();
    });

    test("does not show create option for exact match", () => {
      render(<BranchCombobox branches={branches} selected="" onSelect={noop} disabled={false} />);
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "main" } });

      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(1);
    });
  });

  describe("keyboard navigation", () => {
    test("ArrowDown highlights first item", () => {
      render(
        <BranchCombobox
          branches={branches}
          selected=""
          onSelect={mock(() => {})}
          disabled={false}
        />,
      );
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowDown" });

      const buttons = screen.getAllByRole("button");
      expect(buttons[0]?.className).toContain("bg-aop-charcoal text-aop-cream");
    });

    test("ArrowUp wraps to last item from initial state", () => {
      render(<BranchCombobox branches={branches} selected="" onSelect={noop} disabled={false} />);
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowUp" });

      const buttons = screen.getAllByRole("button");
      const last = buttons.at(-1);
      expect(last?.className).toContain("bg-aop-charcoal text-aop-cream");
    });

    test("Enter selects highlighted branch", () => {
      const onSelect = mock(() => {});
      render(
        <BranchCombobox branches={branches} selected="" onSelect={onSelect} disabled={false} />,
      );
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onSelect).toHaveBeenCalledWith("main");
    });

    test("Enter with no highlight commits typed query", () => {
      const onSelect = mock(() => {});
      render(
        <BranchCombobox branches={branches} selected="" onSelect={onSelect} disabled={false} />,
      );
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "custom-branch" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onSelect).toHaveBeenCalledWith("custom-branch");
    });

    test("Escape closes dropdown", () => {
      render(<BranchCombobox branches={branches} selected="" onSelect={noop} disabled={false} />);
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);

      expect(screen.getAllByRole("button").length).toBeGreaterThan(0);

      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });

    test("ArrowDown cycles past last item back to first", () => {
      render(<BranchCombobox branches={["a", "b"]} selected="" onSelect={noop} disabled={false} />);
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowDown" }); // index 0
      fireEvent.keyDown(input, { key: "ArrowDown" }); // index 1
      fireEvent.keyDown(input, { key: "ArrowDown" }); // wraps to 0

      const buttons = screen.getAllByRole("button");
      expect(buttons[0]?.className).toContain("bg-aop-charcoal text-aop-cream");
    });
  });

  describe("click-outside", () => {
    test("clicking outside closes dropdown and commits query", () => {
      const onSelect = mock(() => {});
      render(
        <div>
          <BranchCombobox
            branches={branches}
            selected="main"
            onSelect={onSelect}
            disabled={false}
          />
          <button type="button" data-testid="outside">
            outside
          </button>
        </div>,
      );
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "develop" } });

      fireEvent.mouseDown(screen.getByTestId("outside"));

      expect(onSelect).toHaveBeenCalledWith("develop");
    });

    test("clicking outside with unchanged query does not call onSelect", () => {
      const onSelect = mock(() => {});
      render(
        <div>
          <BranchCombobox
            branches={branches}
            selected="main"
            onSelect={onSelect}
            disabled={false}
          />
          <button type="button" data-testid="outside">
            outside
          </button>
        </div>,
      );
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);

      fireEvent.mouseDown(screen.getByTestId("outside"));

      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe("branch selection", () => {
    test("clicking a branch calls onSelect and closes dropdown", () => {
      const onSelect = mock(() => {});
      render(
        <BranchCombobox branches={branches} selected="" onSelect={onSelect} disabled={false} />,
      );
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);

      fireEvent.mouseDown(screen.getByText("develop"));

      expect(onSelect).toHaveBeenCalledWith("develop");
    });

    test("marks selected branch as current", () => {
      render(
        <BranchCombobox branches={branches} selected="main" onSelect={noop} disabled={false} />,
      );
      const input = screen.getByTestId("branch-combobox");
      fireEvent.focus(input);

      expect(screen.getByText("current")).toBeTruthy();
    });
  });
});
