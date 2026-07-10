import express from "express";
import { randomUUID } from "node:crypto";
import pinoHttp from "pino-http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { LocalOAuthProvider } from "./auth/provider.js";
import { logger } from "./logger.js";
import type { Tool } from "./types.js";

export interface ServerConfig {
  port: number;
  issuerUrl: URL;
  tools: readonly Tool[];
}

function buildMcpServer(tools: readonly Tool[]): McpServer {
  const server = new McpServer({ name: "local-mcp", version: "1.0.0" });

  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.schema, async (args) => {
      const start = Date.now();
      logger.info({ tool: tool.name, args }, "mcp:tool call");
      try {
        const result = await tool.execute(args as Record<string, unknown>);
        logger.info({ tool: tool.name, ms: Date.now() - start }, "mcp:tool ok");
        return result;
      } catch (e) {
        logger.error({ tool: tool.name, err: e, ms: Date.now() - start }, "mcp:tool error");
        throw e;
      }
    });
  }

  return server;
}

export function createApp(config: ServerConfig): express.Application {
  const app = express();
  const provider = new LocalOAuthProvider();

  // ── HTTP request logging ───────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const httpLoggerMiddleware = (pinoHttp.default ?? (pinoHttp as any))({ logger }) as express.RequestHandler;
  app.use(httpLoggerMiddleware);

  // ── Body parsing ───────────────────────────────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ── Purge expired tokens every hour ────────────────────────────────────────
  setInterval(() => provider.purgeExpired(), 60 * 60 * 1000).unref();

  // ── OAuth routes ───────────────────────────────────────────────────────────
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: config.issuerUrl,
      scopesSupported: ["mcp"],
      resourceName: "Local MCP Server",
    }),
  );

  // ── Consent decision ───────────────────────────────────────────────────────
  app.post("/authorize/decision", (req, res) => {
    const { decision, client_id, redirect_uri, state, code_challenge, scopes, resource } =
      req.body as Record<string, string>;

    const redirectUrl = new URL(redirect_uri ?? "");

    if (decision !== "allow") {
      logger.info({ clientId: client_id }, "oauth:consent denied");
      redirectUrl.searchParams.set("error", "access_denied");
      if (state) redirectUrl.searchParams.set("state", state);
      res.redirect(redirectUrl.toString());
      return;
    }

    logger.info({ clientId: client_id, scopes }, "oauth:consent granted");
    const code = provider.issueAuthorizationCode({
      clientId: client_id ?? "",
      redirectUri: redirect_uri ?? "",
      scopes: scopes ? scopes.split(" ").filter(Boolean) : ["mcp"],
      codeChallenge: code_challenge ?? "",
      state: state || undefined,
      resource: resource ? new URL(resource) : undefined,
    });

    redirectUrl.searchParams.set("code", code);
    if (state) redirectUrl.searchParams.set("state", state);
    res.redirect(redirectUrl.toString());
  });

  // ── MCP endpoint (Bearer-protected) ───────────────────────────────────────
  const resourceMetadataUrl = new URL("/.well-known/oauth-protected-resource", config.issuerUrl).toString();
  const bearerAuth = requireBearerAuth({ verifier: provider, resourceMetadataUrl });

  app.post("/mcp", bearerAuth, async (req, res) => {
    const sessionId = randomUUID();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      onsessioninitialized: (id) => logger.info({ sessionId: id, clientId: req.auth?.clientId }, "mcp:session started"),
    });
    transport.onclose = () => logger.info({ sessionId }, "mcp:session closed");

    const mcpServer = buildMcpServer(config.tools);
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", bearerAuth, async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = buildMcpServer(config.tools);
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", bearerAuth, async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = buildMcpServer(config.tools);
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  });

  return app;
}
