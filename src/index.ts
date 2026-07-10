import { createApp } from "./server.js";
import { runCommandTool } from "./tools/run-command.js";
import { logger } from "./logger.js";
import { env, BASE_URL } from "./config.js";
import { closeDb } from "./db/database.js";
import type { Server } from "node:http";

const TOOLS = [runCommandTool] as const;

// ── Boot ───────────────────────────────────────────────────────────────────

const app = createApp({ port: env.PORT, issuerUrl: new URL(BASE_URL), tools: TOOLS });

let httpServer: Server;

function startServer(): void {
  httpServer = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, url: BASE_URL, env: env.NODE_ENV }, "server:started");
    logger.info({ url: `${BASE_URL}/mcp` }, "mcp:endpoint");
    logger.info({ url: `${BASE_URL}/.well-known/oauth-authorization-server` }, "oauth:metadata");
  });

  httpServer.on("error", (err) => {
    logger.fatal({ err }, "server:error");
    process.exit(1);
  });
}

// ── Graceful shutdown ──────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "server:shutdown initiated");

  await new Promise<void>((resolve) => {
    httpServer.close((err) => {
      if (err) logger.error({ err }, "server:close error");
      else logger.info("server:http closed");
      resolve();
    });
  });

  closeDb();

  logger.info("server:shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT",  () => { void shutdown("SIGINT"); });

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "process:uncaughtException");
  void shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "process:unhandledRejection");
  void shutdown("unhandledRejection");
});

// ── Force-kill fallback (10s after shutdown signal) ────────────────────────
function armForceKill(): void {
  const t = setTimeout(() => {
    logger.error("server:force killed after 10s timeout");
    process.exit(1);
  }, 10_000);
  t.unref();
}

process.once("SIGTERM", armForceKill);
process.once("SIGINT",  armForceKill);

startServer();
