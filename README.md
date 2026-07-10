# machine-root-mcp

> **⚠ Personal use only. Do not deploy to a real server. See [Security](#security).**

A self-hosted MCP (Model Context Protocol) server that gives AI coding assistants — Claude, Codex, or any MCP-compatible client — direct shell access to your local machine. One tool. Full access. No restrictions.

Built for personal local development workflows where you want AI to actually *do* things: run builds, read/write files, execute git commands, run tests, install packages, grep codebases — anything you'd type in a terminal.

---

## What it is

An HTTP server implementing the [Model Context Protocol](https://modelcontextprotocol.io/) spec with a single tool: `run_command`. When an AI client connects, it can call that tool with any bash command and get back stdout/stderr. That's it. No wrappers, no abstractions over the shell — just raw access.

The server handles full OAuth 2.0 Authorization Code + PKCE so any standard MCP client can connect using the discovery flow (`/.well-known/oauth-authorization-server`). OAuth state — registered clients, access tokens, refresh tokens — is persisted in a local SQLite database so registered clients survive server restarts without re-authenticating.

---

## What it does

- Exposes a single MCP tool: `run_command(command, cwd, timeout)`
- Implements a complete self-contained OAuth 2.0 authorization server (no external IdP)
- Supports dynamic client registration — AI clients register themselves automatically
- Serves a browser consent page when a client requests authorization
- Persists all OAuth state to SQLite (WAL mode) across restarts
- Logs every HTTP request, OAuth event, and tool call via structured pino logs
- Shuts down gracefully on SIGTERM/SIGINT (drains connections, closes DB)

---

## What it will be used for

Running AI coding assistants against local projects as if they had a terminal open on your machine:

- Navigate and explore codebases (`find`, `rg`, `cat`, `tree`)
- Read, write, and edit source files
- Run builds, tests, and linters (`pnpm build`, `vitest`, `eslint`)
- Execute git operations (`git log`, `git diff`, `git commit`)
- Install dependencies, restart dev servers, tail logs
- Anything else you'd do in a terminal — because it literally is a terminal

The intent is to connect this to Claude or Codex as a persistent MCP server and let the AI operate on your local workspace without constant copy-pasting.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 |
| Language | TypeScript (ESM, strict) |
| HTTP server | Express 5 |
| MCP protocol | `@modelcontextprotocol/sdk` |
| OAuth 2.0 | Built-in (Authorization Code + PKCE) |
| Persistence | SQLite via `better-sqlite3` (WAL) |
| Logging | `pino` + `pino-pretty` |
| Package manager | pnpm |

---

## Quick start

```bash
git clone https://github.com/yugalkishor/machine-root-mcp
cd machine-root-mcp

pnpm install

# Build better-sqlite3 native binary (required once)
cd node_modules/better-sqlite3 && node_modules/.bin/prebuild-install && cd ../..

cp .env.example .env          # edit if needed
pnpm build
pnpm start
```

Server starts at `http://localhost:3100`.

---

## Exposing publicly

To connect from a remote MCP client you need a public HTTPS URL. Deploy this on any server you have access to — a VPS (DigitalOcean, Hetzner, Linode), a home server with a static IP, or any machine you can put behind a reverse proxy (nginx, Caddy). Set `BASE_URL` in `.env` to your public HTTPS URL before building.

```bash
BASE_URL=https://your-server.com pnpm build && pnpm start
```

MCP endpoint: `https://your-server.com/mcp`

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3100` | HTTP listen port |
| `BASE_URL` | `http://localhost:3100` | Public base URL (set to your public server URL) |
| `MCP_DB_PATH` | `./data/local-mcp.db` | SQLite database path |
| `LOG_LEVEL` | `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `NODE_ENV` | `development` | `development` = pretty logs, `production` = JSON logs |

---

## Security

**This project is intentionally insecure. It is designed for local personal use only.**

- `run_command` executes arbitrary shell commands with no blocklist, no sandboxing, and no path restrictions
- The OAuth server issues tokens to anyone who completes the consent flow
- SQLite tokens are stored unencrypted on disk
- There is no rate limiting, no audit log, no scope enforcement beyond the single `mcp` scope

**Do not run this on a public server, a shared machine, or expose it without a tunnel you control.** Whoever holds a valid access token has full shell access to your machine as your user.

---

## License

Personal use. Not intended for distribution.
