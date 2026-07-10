import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../logger.js";
import { env } from "../config.js";

// better-sqlite3 is a native CJS addon — bypass tsx's TS resolver
const _require = createRequire(import.meta.url);
const DatabaseCtor = _require("better-sqlite3") as typeof BetterSqlite3;

const DB_PATH = resolve(env.MCP_DB_PATH);

let instance: BetterSqlite3.Database | null = null;

export function getDb(): BetterSqlite3.Database {
  if (instance) return instance;

  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  instance = new DatabaseCtor(DB_PATH);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");

  applySchema(instance);
  logger.info({ path: DB_PATH }, "db:open");
  return instance;
}

export function closeDb(): void {
  if (!instance) return;
  instance.close();
  instance = null;
  logger.info({ path: DB_PATH }, "db:closed");
}

function applySchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id   TEXT PRIMARY KEY,
      data        TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS auth_codes (
      code                   TEXT PRIMARY KEY,
      client_id              TEXT NOT NULL,
      redirect_uri           TEXT NOT NULL,
      scopes                 TEXT NOT NULL,
      code_challenge         TEXT NOT NULL,
      code_challenge_method  TEXT NOT NULL DEFAULT 'S256',
      state                  TEXT,
      resource               TEXT,
      expires_at             INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS access_tokens (
      token       TEXT PRIMARY KEY,
      client_id   TEXT NOT NULL,
      scopes      TEXT NOT NULL,
      expires_at  INTEGER NOT NULL,
      resource    TEXT
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token      TEXT PRIMARY KEY,
      client_id  TEXT NOT NULL,
      scopes     TEXT NOT NULL,
      resource   TEXT
    );
  `);
}
