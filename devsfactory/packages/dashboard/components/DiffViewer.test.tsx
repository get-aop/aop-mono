import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { DiffViewer, type DiffViewerProps } from "./DiffViewer";

const defaultProps: DiffViewerProps = {
  diff: null,
  loading: false,
  error: null
};

const renderDiffViewer = (overrides: Partial<DiffViewerProps> = {}) => {
  return renderToString(<DiffViewer {...defaultProps} {...overrides} />);
};

const sampleDiff = `diff --git a/src/auth/login.ts b/src/auth/login.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/auth/login.ts
@@ -0,0 +1,15 @@
+export async function login(email: string, password: string) {
+  const user = await db.users.findByEmail(email);
+  if (!user) {
+    throw new Error('Invalid credentials');
+  }
+  return user;
+}
diff --git a/src/auth/session.ts b/src/auth/session.ts
index def5678..ghi9012 100644
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -1,3 +1,8 @@
-export const SESSION_DURATION = 3600;
+export const SESSION_DURATION = 86400;
+
+export function createSession(userId: string) {
+  return { userId, expiresAt: Date.now() + SESSION_DURATION * 1000 };
+}`;

describe("DiffViewer", () => {
  test("renders diff viewer container", () => {
    const html = renderDiffViewer();
    expect(html).toContain("diff-viewer");
  });

  test("shows loading state", () => {
    const html = renderDiffViewer({ loading: true });
    expect(html).toContain("Loading diff");
  });

  test("shows error state", () => {
    const html = renderDiffViewer({ error: "Failed to load diff" });
    expect(html).toContain("Failed to load diff");
    expect(html).toContain("diff-error");
  });

  test("shows empty state when no diff", () => {
    const html = renderDiffViewer({ diff: null });
    expect(html).toContain("No changes");
  });

  test("renders diff content", () => {
    const html = renderDiffViewer({ diff: sampleDiff });
    expect(html).toContain("login");
    expect(html).toContain("session");
  });

  test("renders file headers", () => {
    const html = renderDiffViewer({ diff: sampleDiff });
    expect(html).toContain("src/auth/login.ts");
    expect(html).toContain("src/auth/session.ts");
  });

  test("highlights additions in green", () => {
    const html = renderDiffViewer({ diff: sampleDiff });
    expect(html).toContain("diff-add");
  });

  test("highlights deletions in red", () => {
    const html = renderDiffViewer({ diff: sampleDiff });
    expect(html).toContain("diff-del");
  });

  test("renders line numbers", () => {
    const html = renderDiffViewer({ diff: sampleDiff });
    expect(html).toContain("diff-line-num");
  });

  test("renders file sections", () => {
    const html = renderDiffViewer({ diff: sampleDiff });
    expect(html).toContain("diff-file");
  });

  test("shows stats for additions and deletions", () => {
    const html = renderDiffViewer({ diff: sampleDiff });
    expect(html).toContain("diff-stats");
  });

  test("renders context lines without highlighting", () => {
    const diffWithContext = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,5 +1,5 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;`;
    const html = renderDiffViewer({ diff: diffWithContext });
    expect(html).toContain("diff-context");
  });

  test("renders hunk headers", () => {
    const html = renderDiffViewer({ diff: sampleDiff });
    expect(html).toContain("diff-hunk");
  });

  test("renders collapse toggle button for each file", () => {
    const html = renderDiffViewer({ diff: sampleDiff });
    expect(html).toContain("diff-file-toggle");
  });

  test("file sections are expanded by default", () => {
    const html = renderDiffViewer({ diff: sampleDiff });
    expect(html).toContain("diff-file-content");
    expect(html).not.toContain("collapsed");
  });
});
