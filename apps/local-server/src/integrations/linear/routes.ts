import { type Context, Hono } from "hono";
import { LinearHandlersError } from "./handlers.ts";
import type { LinearRoutesDeps } from "./types.ts";

const LINEAR_OAUTH_CHANNEL = "aop-linear-oauth";

export const createLinearRoutes = (deps: LinearRoutesDeps) => {
  const app = new Hono();

  app.post("/connect", async (c) => {
    try {
      return c.json(await deps.handlers.connect());
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  app.get("/callback", async (c) => {
    return handleOAuthCallback(c, deps);
  });

  app.get("/status", async (c) => {
    return c.json(await deps.handlers.getStatus());
  });

  app.post("/unlock", async (c) => {
    try {
      await deps.handlers.unlock();
      return c.json({ ok: true });
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  app.post("/disconnect", async (c) => {
    try {
      await deps.handlers.disconnect();
      return c.json({ ok: true });
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  app.post("/test-connection", async (c) => {
    try {
      return c.json(await deps.handlers.testConnection());
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  return app;
};

const wantsHtml = (c: Context): boolean =>
  (c.req.header("accept") ?? "").toLowerCase().includes("text/html");

const handleOAuthCallback = async (c: Context, deps: LinearRoutesDeps) => {
  try {
    const result = await deps.handlers.callback({
      code: c.req.query("code") ?? null,
      error: c.req.query("error") ?? null,
      errorDescription: c.req.query("error_description") ?? null,
      state: c.req.query("state") ?? null,
    });

    return wantsHtml(c)
      ? c.html(buildOAuthCallbackPage({ connected: result.connected }))
      : c.json(result);
  } catch (error) {
    if (wantsHtml(c)) {
      return c.html(
        buildOAuthCallbackPage({ connected: false, error: getErrorMessage(error) }),
        500,
      );
    }

    return toErrorResponse(c, error);
  }
};

const buildOAuthCallbackPage = (params: { connected: boolean; error?: string }): string => {
  const title = params.connected ? "Linear connected" : "Linear connection failed";
  const message = params.connected
    ? "You can close this tab. AOP will refresh the Settings page automatically."
    : (params.error ?? "Linear connection failed");
  const serializedPayload = JSON.stringify(
    params.connected
      ? { type: "linear-oauth-complete" }
      : { type: "linear-oauth-error", error: message },
  );

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0b0d12;
        color: #f5f5f4;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      main {
        width: min(32rem, calc(100vw - 2rem));
        padding: 1.25rem;
        border: 1px solid #262a33;
        border-radius: 0.75rem;
        background: #11141b;
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1rem;
      }
      p {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.5;
        color: #b5bcc9;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
    <script>
      const payload = ${serializedPayload};
      try {
        const channel = new BroadcastChannel("${LINEAR_OAUTH_CHANNEL}");
        channel.postMessage(payload);
        channel.close();
      } catch {}
      ${params.connected ? 'try { window.close(); } catch {} setTimeout(() => { window.location.replace("/settings"); }, 300);' : ""}
    </script>
  </body>
</html>`;
};

const toErrorResponse = (c: Context, error: unknown) => {
  if (error instanceof LinearHandlersError) {
    return c.json({ error: error.message }, error.status);
  }

  return c.json({ error: getErrorMessage(error) }, 500);
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown Linear integration error";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
