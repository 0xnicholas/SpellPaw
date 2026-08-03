// /api/mcp — MCP Streamable HTTP endpoint (spec §3, ADR-0010 embedded).
// One server per SSE session, keyed by Mcp-Session-Id. Auth is handled by the
// root app middleware (bearer token or session cookie).
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "../mcp/server";

/** 0 = unlimited; unparseable values fall back to undefined (default cap). */
function parseWriteCap(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
import type { AppEnv, RouteDeps } from "./shared";

interface McpSession {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}

export function mcpRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // In-process session registry (single deployment, ADR-0010). Sessions expire
  // when the client disconnects (DELETE), go idle for >1h, or the process
  // restarts — bounded memory, no unbounded growth.
  const sessions = new Map<string, { session: McpSession; lastUsed: number }>();
  const SESSION_IDLE_MS = 60 * 60 * 1000;

  app.all("/", async (c) => {
    const workspaceId = c.get("workspaceId");
    const sessionId = c.req.header("mcp-session-id");
    let holder: { session: McpSession; lastUsed: number } | undefined = sessionId
      ? sessions.get(sessionId)
      : undefined;

    if (holder && Date.now() - holder.lastUsed > SESSION_IDLE_MS) {
      sessions.delete(sessionId!);
      holder = undefined;
    }

    if (!holder) {
      let session: McpSession | null = null;
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          if (session) sessions.set(sid, { session, lastUsed: Date.now() });
        },
        onsessionclosed: (sid) => {
          sessions.delete(sid);
        },
      });
      const server = createMcpServer({
        prisma: deps.prisma,
        publisher: deps.publisher,
        rateLimiter: deps.rateLimiter,
        // 0 = unlimited (consistent with FREE_PLAN_* semantics); missing or
        // unparseable falls back to the default cap in the tool layer.
        writeDailyCap: parseWriteCap(process.env.MCP_WRITE_DAILY_CAP),
      });
      await server.connect(transport);
      session = { server, transport };
      holder = { session, lastUsed: Date.now() };
    }

    holder.lastUsed = Date.now();
    return holder.session.transport.handleRequest(c.req.raw, {
      // AuthInfo requires token/clientId — carry the workspace id in clientId.
      authInfo: { token: "spellpaw-session", clientId: workspaceId } as never,
    });
  });

  return app;
}
