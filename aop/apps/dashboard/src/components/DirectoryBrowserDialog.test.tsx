import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { DirectoryBrowserDialog } from "./DirectoryBrowserDialog";

const renderToString = async (component: ReactElement): Promise<string> => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(component);
};

describe("DirectoryBrowserDialog", () => {
  describe("rendering", () => {
    test("renders dialog element", async () => {
      const html = await renderToString(
        <DirectoryBrowserDialog open={false} onSelect={() => {}} onCancel={() => {}} />,
      );
      expect(html).toContain("<dialog");
    });

    test("renders title", async () => {
      const html = await renderToString(
        <DirectoryBrowserDialog open={false} onSelect={() => {}} onCancel={() => {}} />,
      );
      expect(html).toContain("Select Repository");
    });

    test("renders description", async () => {
      const html = await renderToString(
        <DirectoryBrowserDialog open={false} onSelect={() => {}} onCancel={() => {}} />,
      );
      expect(html).toContain("Navigate to a git repository directory");
    });

    test("renders path input field", async () => {
      const html = await renderToString(
        <DirectoryBrowserDialog open={false} onSelect={() => {}} onCancel={() => {}} />,
      );
      expect(html).toContain('placeholder="Enter path..."');
    });

    test("renders Go button for path navigation", async () => {
      const html = await renderToString(
        <DirectoryBrowserDialog open={false} onSelect={() => {}} onCancel={() => {}} />,
      );
      expect(html).toContain(">Go</button>");
    });

    test("renders Cancel button", async () => {
      const html = await renderToString(
        <DirectoryBrowserDialog open={false} onSelect={() => {}} onCancel={() => {}} />,
      );
      expect(html).toContain(">Cancel</button>");
    });

    test("renders Select button", async () => {
      const html = await renderToString(
        <DirectoryBrowserDialog open={false} onSelect={() => {}} onCancel={() => {}} />,
      );
      expect(html).toContain(">Select</button>");
    });

    test("Select button is disabled initially", async () => {
      const html = await renderToString(
        <DirectoryBrowserDialog open={false} onSelect={() => {}} onCancel={() => {}} />,
      );
      // Button is disabled when no path is selected
      expect(html).toContain("disabled");
      expect(html).toContain("Select</button>");
    });

    test("renders with proper dialog styling classes", async () => {
      const html = await renderToString(
        <DirectoryBrowserDialog open={false} onSelect={() => {}} onCancel={() => {}} />,
      );
      expect(html).toContain("rounded-aop-lg");
      expect(html).toContain("bg-aop-darkest");
    });

    test("renders path display area", async () => {
      const html = await renderToString(
        <DirectoryBrowserDialog open={false} onSelect={() => {}} onCancel={() => {}} />,
      );
      expect(html).toContain("truncate font-mono text-xs");
    });

    test("renders form for path input", async () => {
      const html = await renderToString(
        <DirectoryBrowserDialog open={false} onSelect={() => {}} onCancel={() => {}} />,
      );
      expect(html).toContain("<form");
    });

    test("renders directory listing container", async () => {
      const html = await renderToString(
        <DirectoryBrowserDialog open={false} onSelect={() => {}} onCancel={() => {}} />,
      );
      expect(html).toContain("h-64 overflow-y-auto");
    });
  });
});
