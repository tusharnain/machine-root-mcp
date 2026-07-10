import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { getDb } from "../db/database.js";

// ── Pending authorization code record ───────────────────────────────────────

export interface PendingCode {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: string;
  state?: string;
  resource?: URL;
  expiresAt: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ── SQLite clients store ─────────────────────────────────────────────────────

export class SqliteClientsStore implements OAuthRegisteredClientsStore {
  readonly #db: BetterSqlite3.Database;

  constructor() {
    this.#db = getDb();
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = this.#db
      .prepare<[string], { data: string }>("SELECT data FROM oauth_clients WHERE client_id = ?")
      .get(clientId);
    return row ? (JSON.parse(row.data) as OAuthClientInformationFull) : undefined;
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: randomUUID(),
      client_id_issued_at: nowSeconds(),
    };
    this.#db
      .prepare("INSERT INTO oauth_clients (client_id, data) VALUES (?, ?)")
      .run(full.client_id, JSON.stringify(full));
    return full;
  }
}

// ── SQLite authorization code store ──────────────────────────────────────────

export class SqliteCodeStore {
  readonly #db: BetterSqlite3.Database;

  constructor() {
    this.#db = getDb();
  }

  save(code: string, record: PendingCode): void {
    this.#db
      .prepare(`
        INSERT INTO auth_codes
          (code, client_id, redirect_uri, scopes, code_challenge, code_challenge_method, state, resource, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        code,
        record.clientId,
        record.redirectUri,
        record.scopes.join(" "),
        record.codeChallenge,
        record.codeChallengeMethod,
        record.state ?? null,
        record.resource?.toString() ?? null,
        record.expiresAt,
      );
  }

  consume(code: string): PendingCode | undefined {
    const row = this.#db
      .prepare<[string], {
        client_id: string;
        redirect_uri: string;
        scopes: string;
        code_challenge: string;
        code_challenge_method: string;
        state: string | null;
        resource: string | null;
        expires_at: number;
      }>("SELECT * FROM auth_codes WHERE code = ?")
      .get(code);

    if (!row) return undefined;
    this.#db.prepare("DELETE FROM auth_codes WHERE code = ?").run(code);
    if (row.expires_at < Date.now()) return undefined;

    return {
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      scopes: row.scopes.split(" ").filter(Boolean),
      codeChallenge: row.code_challenge,
      codeChallengeMethod: row.code_challenge_method,
      state: row.state ?? undefined,
      resource: row.resource ? new URL(row.resource) : undefined,
      expiresAt: row.expires_at,
    };
  }

  peek(code: string): PendingCode | undefined {
    const row = this.#db
      .prepare<[string], {
        client_id: string;
        redirect_uri: string;
        scopes: string;
        code_challenge: string;
        code_challenge_method: string;
        state: string | null;
        resource: string | null;
        expires_at: number;
      }>("SELECT * FROM auth_codes WHERE code = ?")
      .get(code);

    if (!row) return undefined;

    return {
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      scopes: row.scopes.split(" ").filter(Boolean),
      codeChallenge: row.code_challenge,
      codeChallengeMethod: row.code_challenge_method,
      state: row.state ?? undefined,
      resource: row.resource ? new URL(row.resource) : undefined,
      expiresAt: row.expires_at,
    };
  }
}

// ── SQLite token store ───────────────────────────────────────────────────────

const ACCESS_TOKEN_TTL_SECONDS = 3600;

export class SqliteTokenStore {
  readonly #db: BetterSqlite3.Database;

  constructor() {
    this.#db = getDb();
  }

  issueTokens(
    clientId: string,
    scopes: string[],
    resource?: URL,
  ): { accessToken: string; refreshToken: string; expiresIn: number } {
    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    const expiresAt = nowSeconds() + ACCESS_TOKEN_TTL_SECONDS;
    const scopeStr = scopes.join(" ");
    const resourceStr = resource?.toString() ?? null;

    this.#db
      .prepare("INSERT INTO access_tokens (token, client_id, scopes, expires_at, resource) VALUES (?, ?, ?, ?, ?)")
      .run(accessToken, clientId, scopeStr, expiresAt, resourceStr);

    this.#db
      .prepare("INSERT INTO refresh_tokens (token, client_id, scopes, resource) VALUES (?, ?, ?, ?)")
      .run(refreshToken, clientId, scopeStr, resourceStr);

    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  verify(token: string): AuthInfo | undefined {
    const row = this.#db
      .prepare<[string], { client_id: string; scopes: string; expires_at: number; resource: string | null }>(
        "SELECT client_id, scopes, expires_at, resource FROM access_tokens WHERE token = ?",
      )
      .get(token);

    if (!row) return undefined;

    if (row.expires_at < nowSeconds()) {
      this.#db.prepare("DELETE FROM access_tokens WHERE token = ?").run(token);
      return undefined;
    }

    return {
      token,
      clientId: row.client_id,
      scopes: row.scopes.split(" ").filter(Boolean),
      expiresAt: row.expires_at,
      resource: row.resource ? new URL(row.resource) : undefined,
    };
  }

  consumeRefreshToken(
    refreshToken: string,
  ): { clientId: string; scopes: string[]; resource?: URL } | undefined {
    const row = this.#db
      .prepare<[string], { client_id: string; scopes: string; resource: string | null }>(
        "SELECT client_id, scopes, resource FROM refresh_tokens WHERE token = ?",
      )
      .get(refreshToken);

    if (!row) return undefined;
    this.#db.prepare("DELETE FROM refresh_tokens WHERE token = ?").run(refreshToken);

    return {
      clientId: row.client_id,
      scopes: row.scopes.split(" ").filter(Boolean),
      resource: row.resource ? new URL(row.resource) : undefined,
    };
  }

  revoke(token: string): void {
    this.#db.prepare("DELETE FROM access_tokens WHERE token = ?").run(token);
    this.#db.prepare("DELETE FROM refresh_tokens WHERE token = ?").run(token);
  }

  // Purge expired access tokens — call periodically to keep the DB tidy
  purgeExpired(): void {
    this.#db.prepare("DELETE FROM auth_codes WHERE expires_at < ?").run(Date.now());
    this.#db.prepare("DELETE FROM access_tokens WHERE expires_at < ?").run(nowSeconds());
  }
}
