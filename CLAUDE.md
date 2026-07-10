# local-mcp

A local MCP (Model Context Protocol) server that exposes a single `run_command` shell tool over HTTP with full OAuth 2.0 authorization. Built with Node.js + TypeScript + Express + SQLite.

## What this is

An MCP server you run locally (or tunnel via ngrok) so AI clients (Claude, Codex, etc.) can connect and execute shell commands on your machine. Full shell access, no restrictions — intended for personal local use only.

## Stack

- **Runtime**: Node.js 24 (uses `--env-file` natively, no dotenv)
- **Language**: TypeScript (ESM, `NodeNext` module resolution)
- **HTTP**: Express 5
- **MCP SDK**: `@modelcontextprotocol/sdk` v1.29
- **Auth**: OAuth 2.0 Authorization Code + PKCE (self-contained, no external IdP)
- **DB**: SQLite via `better-sqlite3` (WAL mode) — persists OAuth clients/tokens across restarts
- **Logging**: `pino` + `pino-pretty` (dev) / JSON (prod)
- **Package manager**: pnpm

## Project structure

```
src/
  index.ts              — entry point, boot, graceful shutdown
  config.ts             — env vars (Zod-validated), exports `env` and `BASE_URL`
  logger.ts             — pino instance (pretty in dev, JSON in prod)
  server.ts             — Express app factory: OAuth routes + MCP endpoint
  types.ts              — Tool, ToolResult interfaces
  auth/
    provider.ts         — LocalOAuthProvider (implements OAuthServerProvider)
    store.ts            — SqliteClientsStore, SqliteCodeStore, SqliteTokenStore
    consent-page.ts     — HTML consent page renderer
  db/
    database.ts         — SQLite singleton (getDb, closeDb), schema migrations
  tools/
    run-command.ts      — the one tool: run_command
dist/                   — compiled output (gitignored)
data/                   — SQLite DB files (gitignored)
```

## Environment variables

Defined in `.env` (copy from `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3100` | HTTP port |
| `BASE_URL` | `http://localhost:3100` | Public base URL (set to ngrok URL when tunneling) |
| `MCP_DB_PATH` | `./data/local-mcp.db` | SQLite file path |
| `LOG_LEVEL` | `info` | pino level: trace/debug/info/warn/error/fatal |
| `NODE_ENV` | `development` | `development` = pino-pretty, `production` = JSON logs |

## Commands

```bash
pnpm build          # compile TypeScript → dist/
pnpm start          # run compiled server (loads .env)
pnpm dev            # build once then node --watch dist/ (loads .env)
pnpm dev:build      # tsc --watch in a separate terminal
pnpm typecheck      # type-check without emitting
```

**Important**: `tsx` is installed but NOT used to run the server — `better-sqlite3` is a native CJS addon that conflicts with tsx's ESM resolver. Always run via compiled JS (`node dist/index.js`).

## The tool: `run_command`

Single MCP tool. Full shell access.

```
name:    run_command
args:
  command  string   — any bash command
  cwd      string   — working directory (default: /home/superbot/Documents/workspace)
  timeout  number   — seconds before SIGKILL (default: 60, max: 300)
```

No blocklist. No path restrictions. The model can do anything bash can do.

## OAuth flow (how AI clients connect)

1. Client fetches `GET /.well-known/oauth-authorization-server` — discovers endpoints
2. Client POSTs to `POST /register` — dynamic client registration, gets `client_id`
3. Client redirects user to `GET /authorize` — server renders HTML consent page
4. User clicks **Allow** → POSTs to `POST /authorize/decision` → redirected back with `?code=`
5. Client exchanges code at `POST /token` → gets `access_token` + `refresh_token`
6. Client calls `POST /mcp` with `Authorization: Bearer <token>`

OAuth state (clients, codes, tokens) is persisted in SQLite — registered clients survive server restarts.

## SQLite schema

```sql
oauth_clients   — registered AI clients (client_id, JSON data)
auth_codes      — short-lived PKCE codes (5 min TTL)
access_tokens   — active access tokens (1 hour TTL)
refresh_tokens  — refresh tokens (no expiry, consumed on use)
```

Expired tokens are purged automatically every hour.

## Graceful shutdown

On `SIGTERM` / `SIGINT`:
1. Stop accepting new HTTP connections (`server.close()`)
2. Wait for in-flight requests to finish
3. Close SQLite (`db.close()`)
4. `process.exit(0)`

Force-killed after 10 seconds if shutdown hangs. `uncaughtException` and `unhandledRejection` both trigger the same shutdown path with a `fatal` log.

## Adding a new tool

1. Create `src/tools/your-tool.ts` — implement the `Tool` interface from `src/types.ts`
2. Add it to the `TOOLS` array in `src/index.ts`
3. `pnpm build && pnpm start`

```ts
import { z } from "zod";
import type { Tool } from "../types.js";

export const myTool: Tool = {
  name: "my_tool",
  description: "...",
  schema: {
    arg1: z.string().describe("..."),
  },
  async execute(raw) {
    // validate: const args = z.object({ arg1: z.string() }).parse(raw);
    return { content: [{ type: "text", text: "result" }] };
  },
};
```

## Running publicly via ngrok (no domain needed)

```bash
# 1. Get a free static domain from ngrok.com dashboard
# 2. Update .env:  BASE_URL=https://your-name.ngrok-free.app
# 3. Terminal 1:   pnpm start
# 4. Terminal 2:   ngrok http --domain=your-name.ngrok-free.app 3100
```

Or use `start.sh`:
```bash
NGROK_DOMAIN=your-name.ngrok-free.app bash start.sh
```

## Known quirks

- `pnpm install` shows `[ERR_PNPM_IGNORED_BUILDS]` for `better-sqlite3` and `esbuild`. Safe to ignore — the native binary for `better-sqlite3` was built manually via `prebuild-install` and is in place.
- `pnpm-workspace.yaml` is modified by a local hook on every `pnpm install`. Do not fight it — it doesn't break anything.
- `tsx` cannot run the server directly because it tries to resolve TypeScript sources inside `better-sqlite3`'s package directory. Always use compiled JS.
