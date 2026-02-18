import { useMemo, useState } from "react";
import "./App.css";
import { OAuthService } from "./modules/auth/oauth-service";
import { BrowserTokenStore } from "./modules/auth/token-store";
import type { AuthSession } from "./modules/auth/types";

function App() {
  const authService = useMemo(() => OAuthService.fromEnv(new BrowserTokenStore()), []);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [status, setStatus] = useState("Ready");

  const config = authService.getConfig();

  async function onStartLogin() {
    try {
      setStatus("Opening browser for OAuth login...");
      await authService.beginLogin();
      setStatus("Browser opened. Complete login and paste callback URL below.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to start login.");
    }
  }

  async function onCompleteLogin() {
    try {
      setStatus("Processing callback...");
      const newSession = await authService.completeLogin(callbackUrl);
      setSession(newSession);
      setStatus("Authenticated with OAuth.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to complete login.");
    }
  }

  async function onRefresh() {
    try {
      setStatus("Refreshing session...");
      const newSession = await authService.refreshSession();
      setSession(newSession);
      setStatus("Session refreshed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to refresh session.");
    }
  }

  async function onLogout() {
    await authService.logout();
    setSession(null);
    setCallbackUrl("");
    setStatus("Logged out.");
  }

  return (
    <main className="app">
      <section className="card">
        <p className="eyebrow">Codex App for Windows</p>
        <h1>OAuth Login v1</h1>
        <p className="description">
          Base flow with OAuth 2.1 + PKCE for Tauri desktop. This screen is a development harness for auth integration.
        </p>

        <div className="config-grid">
          <span>Client ID</span>
          <code>{config.clientId || "missing"}</code>
          <span>Authorize URL</span>
          <code>{config.authorizeUrl || "missing"}</code>
          <span>Token URL</span>
          <code>{config.tokenUrl || "missing"}</code>
          <span>Redirect URI</span>
          <code>{config.redirectUri}</code>
        </div>

        <div className="actions">
          <button onClick={onStartLogin} disabled={!authService.isConfigured()}>
            Entrar com OAuth
          </button>
          <button onClick={onRefresh} disabled={!session}>
            Refresh
          </button>
          <button className="ghost" onClick={onLogout}>
            Logout
          </button>
        </div>

        <label htmlFor="callback-url">Callback URL (dev)</label>
        <input
          id="callback-url"
          value={callbackUrl}
          onChange={(event) => setCallbackUrl(event.currentTarget.value)}
          placeholder="http://127.0.0.1:4815/callback?code=...&state=..."
        />
        <button className="secondary" onClick={onCompleteLogin} disabled={!callbackUrl}>
          Processar callback
        </button>

        <p className="status">Status: {status}</p>

        {session && (
          <div className="session">
            <h2>Session</h2>
            <p>
              <strong>Token type:</strong> {session.tokenType}
            </p>
            <p>
              <strong>Expires:</strong> {new Date(session.expiresAt).toLocaleString()}
            </p>
            <p>
              <strong>Scopes:</strong> {session.scope || "n/a"}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
