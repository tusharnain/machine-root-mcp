export interface ConsentPageParams {
  clientId: string;
  clientName: string;
  scopes: string[];
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
}

export function renderConsentPage(params: ConsentPageParams): string {
  const scopeList = params.scopes
    .map((s) => `<li><code>${escapeHtml(s)}</code></li>`)
    .join("\n");

  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize — Local MCP</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1rem;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.10);
      padding: 2rem 2.5rem;
      max-width: 420px;
      width: 100%;
    }
    h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
    .client { font-weight: 600; color: #1a1a1a; }
    .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .scopes { list-style: none; padding: 0; margin: 0 0 1.5rem; }
    .scopes li {
      padding: 0.4rem 0.75rem;
      background: #f0f4ff;
      border-radius: 6px;
      margin-bottom: 0.4rem;
      font-size: 0.875rem;
    }
    .scopes li code { color: #4f46e5; }
    .actions { display: flex; gap: 0.75rem; }
    button {
      flex: 1;
      padding: 0.65rem 1rem;
      border-radius: 8px;
      border: none;
      font-size: 0.95rem;
      cursor: pointer;
      font-weight: 500;
    }
    .allow { background: #4f46e5; color: #fff; }
    .allow:hover { background: #4338ca; }
    .deny { background: #f1f1f1; color: #333; }
    .deny:hover { background: #e5e5e5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorization Request</h1>
    <p class="subtitle">
      <span class="client">${escapeHtml(params.clientName || params.clientId)}</span>
      wants to access this MCP server with the following scopes:
    </p>
    <ul class="scopes">${scopeList}</ul>

    <form method="POST" action="/authorize/decision">
      ${hidden("client_id", params.clientId)}
      ${hidden("redirect_uri", params.redirectUri)}
      ${hidden("state", params.state)}
      ${hidden("code_challenge", params.codeChallenge)}
      ${hidden("code_challenge_method", params.codeChallengeMethod)}
      ${hidden("scopes", params.scopes.join(" "))}
      ${hidden("resource", params.resource)}
      <div class="actions">
        <button type="submit" name="decision" value="allow" class="allow">Allow</button>
        <button type="submit" name="decision" value="deny" class="deny">Deny</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
