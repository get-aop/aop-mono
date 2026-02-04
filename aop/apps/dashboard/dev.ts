#!/usr/bin/env bun
/**
 * Development server for the dashboard with HMR.
 * Uses Bun.serve() with HTML imports for React/CSS/Tailwind.
 * Proxies /api/* requests to local-server.
 */

import { configureLogging, getLogger } from "@aop/infra";

const log = getLogger("dashboard", "dev");

const PORT = Number(process.env.DASHBOARD_PORT) || 5173;
const API_URL = process.env.API_URL || "http://localhost:3847";

const streamSSEResponse = async (response: Response): Promise<Response> => {
  const { readable, writable } = new TransformStream();

  pipeSSEStream(response, writable);

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
};

const pipeSSEStream = (response: Response, writable: WritableStream<Uint8Array>): void => {
  const reader = response.body?.getReader();
  const writer = writable.getWriter();

  if (!reader) {
    writer.close();
    return;
  }

  const pump = async (): Promise<void> => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
    } catch {
      // Connection closed
    } finally {
      try {
        await writer.close();
      } catch {
        // Already closed
      }
    }
  };

  pump();
};

const proxyApiRequest = async (req: Request, url: URL): Promise<Response> => {
  const apiUrl = `${API_URL}${url.pathname}${url.search}`;
  const headers = new Headers(req.headers);
  headers.delete("host");

  try {
    const response = await fetch(apiUrl, {
      method: req.method,
      headers,
      body: req.body,
      // @ts-expect-error - Bun supports duplex
      duplex: "half",
    });

    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      return streamSSEResponse(response);
    }

    return response;
  } catch (err) {
    log.error("Proxy error: {error}", { error: String(err) });
    return new Response(`Proxy error: ${err}`, { status: 502 });
  }
};

const resolvePathname = (pathname: string): string => {
  if (pathname === "/" || (!pathname.includes(".") && !pathname.startsWith("/src/"))) {
    return "/src/index.html";
  }
  if (pathname.startsWith("/src/")) {
    return pathname;
  }
  const exts = [".css", ".js", ".ts", ".tsx"];
  if (exts.some((ext) => pathname.endsWith(ext))) {
    return `/src${pathname}`;
  }
  return pathname;
};

const serveTypeScript = async (filePath: string): Promise<Response | null> => {
  const result = await Bun.build({
    entrypoints: [filePath],
    target: "browser",
    format: "esm",
    define: { "process.env.NODE_ENV": '"development"' },
  });

  if (result.success && result.outputs[0]) {
    return new Response(await result.outputs[0].text(), {
      headers: { "Content-Type": "application/javascript" },
    });
  }
  return null;
};

const serveTailwindCSS = async (filePath: string): Promise<Response | null> => {
  const result = await Bun.$`bunx tailwindcss -i ${filePath}`.quiet();
  if (result.exitCode === 0) {
    return new Response(new Uint8Array(result.stdout), {
      headers: { "Content-Type": "text/css" },
    });
  }
  return null;
};

const serveStaticFile = async (pathname: string): Promise<Response | null> => {
  const filePath = `.${pathname}`;
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return null;
  }

  if (filePath.endsWith(".tsx") || filePath.endsWith(".ts")) {
    return serveTypeScript(filePath);
  }

  if (filePath.endsWith(".css")) {
    return serveTailwindCSS(filePath);
  }

  return new Response(file);
};

const serveSpaFallback = async (): Promise<Response> => {
  const indexFile = Bun.file("./src/index.html");
  if (await indexFile.exists()) {
    return new Response(indexFile, { headers: { "Content-Type": "text/html" } });
  }
  return new Response("Not Found", { status: 404 });
};

const main = async () => {
  await configureLogging({ format: "pretty" });

  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname.startsWith("/api/")) {
        return proxyApiRequest(req, url);
      }

      const pathname = resolvePathname(url.pathname);
      const staticResponse = await serveStaticFile(pathname);
      if (staticResponse) {
        return staticResponse;
      }

      return serveSpaFallback();
    },
  });

  log.info("Dashboard dev server running at http://localhost:{port}", { port: PORT });
  log.info("Proxying /api/* to {apiUrl}", { apiUrl: API_URL });
};

main();
