import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { SqliteClientsStore, SqliteCodeStore, SqliteTokenStore } from "./store.js";
import { renderConsentPage } from "./consent-page.js";
import { logger } from "../logger.js";

const CODE_TTL_MS = 5 * 60 * 1000;

export class LocalOAuthProvider implements OAuthServerProvider {
  readonly #clients: SqliteClientsStore;
  readonly #codes: SqliteCodeStore;
  readonly #tokens: SqliteTokenStore;

  constructor() {
    this.#clients = new SqliteClientsStore();
    this.#codes = new SqliteCodeStore();
    this.#tokens = new SqliteTokenStore();
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this.#clients;
  }

  get codeStore(): SqliteCodeStore {
    return this.#codes;
  }

  purgeExpired(): void {
    this.#tokens.purgeExpired();
    logger.debug("oauth:purge expired tokens");
  }

  authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    logger.info({ clientId: client.client_id, scopes: params.scopes }, "oauth:authorize request");
    const html = renderConsentPage({
      clientId: client.client_id,
      clientName: Array.isArray(client.client_name)
        ? (client.client_name[0] ?? client.client_id)
        : (client.client_name ?? client.client_id),
      scopes: params.scopes ?? [],
      redirectUri: params.redirectUri,
      state: params.state ?? "",
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: "S256",
      resource: params.resource?.toString() ?? "",
    });
    res.status(200).send(html);
    return Promise.resolve();
  }

  challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const record = this.#codes.peek(authorizationCode);
    if (!record) {
      logger.warn({ code: authorizationCode }, "oauth:unknown auth code");
      return Promise.reject(new Error("Unknown or expired authorization code"));
    }
    return Promise.resolve(record.codeChallenge);
  }

  exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = this.#codes.consume(authorizationCode);
    if (!record || record.clientId !== client.client_id) {
      logger.warn({ clientId: client.client_id }, "oauth:invalid auth code exchange");
      return Promise.reject(new Error("Invalid or expired authorization code"));
    }

    const { accessToken, refreshToken, expiresIn } = this.#tokens.issueTokens(
      client.client_id,
      record.scopes,
      resource ?? record.resource,
    );

    logger.info({ clientId: client.client_id, scopes: record.scopes }, "oauth:token issued");
    return Promise.resolve({
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: record.scopes.join(" "),
    });
  }

  exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const stored = this.#tokens.consumeRefreshToken(refreshToken);
    if (!stored || stored.clientId !== client.client_id) {
      logger.warn({ clientId: client.client_id }, "oauth:invalid refresh token");
      return Promise.reject(new Error("Invalid refresh token"));
    }

    const grantedScopes = scopes?.length ? scopes : stored.scopes;
    const { accessToken, refreshToken: newRefreshToken, expiresIn } = this.#tokens.issueTokens(
      client.client_id,
      grantedScopes,
      resource ?? stored.resource,
    );

    logger.info({ clientId: client.client_id, scopes: grantedScopes }, "oauth:token refreshed");
    return Promise.resolve({
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      refresh_token: newRefreshToken,
      scope: grantedScopes.join(" "),
    });
  }

  verifyAccessToken(token: string): Promise<AuthInfo> {
    const info = this.#tokens.verify(token);
    if (!info) {
      logger.debug("oauth:token verification failed");
      return Promise.reject(new Error("Invalid or expired access token"));
    }
    logger.debug({ clientId: info.clientId }, "oauth:token verified");
    return Promise.resolve(info);
  }

  revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.#tokens.revoke(request.token);
    logger.info({ clientId: client.client_id }, "oauth:token revoked");
    return Promise.resolve();
  }

  issueAuthorizationCode(params: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge: string;
    state?: string;
    resource?: URL;
  }): string {
    const code = randomUUID();
    this.#codes.save(code, {
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      scopes: params.scopes,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: "S256",
      state: params.state,
      resource: params.resource,
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    logger.info({ clientId: params.clientId, scopes: params.scopes }, "oauth:code issued");
    return code;
  }
}
