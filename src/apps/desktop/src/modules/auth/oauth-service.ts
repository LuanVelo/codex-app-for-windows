import { openUrl } from "@tauri-apps/plugin-opener";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateNonce,
  generateState,
} from "./pkce";
import type { AuthSession, OAuthConfig, PendingAuth, TokenResponse } from "./types";
import type { TokenStore } from "./token-store";

const PENDING_AUTH_KEY = "codex.auth.pending";

function readPendingAuth(): PendingAuth | null {
  const raw = sessionStorage.getItem(PENDING_AUTH_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PendingAuth;
  } catch {
    sessionStorage.removeItem(PENDING_AUTH_KEY);
    return null;
  }
}

function savePendingAuth(payload: PendingAuth): void {
  sessionStorage.setItem(PENDING_AUTH_KEY, JSON.stringify(payload));
}

function clearPendingAuth(): void {
  sessionStorage.removeItem(PENDING_AUTH_KEY);
}

function parseTokenResponse(data: TokenResponse): AuthSession {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenType: data.token_type,
    scope: data.scope,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export class OAuthService {
  constructor(
    private readonly config: OAuthConfig,
    private readonly tokenStore: TokenStore,
  ) {}

  static fromEnv(tokenStore: TokenStore): OAuthService {
    const cfg: OAuthConfig = {
      clientId: import.meta.env.VITE_OAUTH_CLIENT_ID ?? "",
      authorizeUrl: import.meta.env.VITE_OAUTH_AUTHORIZE_URL ?? "",
      tokenUrl: import.meta.env.VITE_OAUTH_TOKEN_URL ?? "",
      redirectUri: import.meta.env.VITE_OAUTH_REDIRECT_URI ?? "http://127.0.0.1:4815/callback",
      scope: import.meta.env.VITE_OAUTH_SCOPE ?? "openid profile",
    };

    return new OAuthService(cfg, tokenStore);
  }

  getConfig(): OAuthConfig {
    return this.config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.authorizeUrl && this.config.tokenUrl);
  }

  async beginLogin(): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error("OAuth config missing. Define VITE_OAUTH_* environment variables.");
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();
    const nonce = generateNonce();

    savePendingAuth({ codeVerifier, state, nonce, createdAt: Date.now() });

    const authorize = new URL(this.config.authorizeUrl);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", this.config.clientId);
    authorize.searchParams.set("redirect_uri", this.config.redirectUri);
    authorize.searchParams.set("scope", this.config.scope);
    authorize.searchParams.set("code_challenge", codeChallenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("nonce", nonce);

    await openUrl(authorize.toString());
  }

  async completeLogin(callbackUrl: string): Promise<AuthSession> {
    const pending = readPendingAuth();
    if (!pending) {
      throw new Error("No pending OAuth login found.");
    }

    const parsed = new URL(callbackUrl);
    const code = parsed.searchParams.get("code");
    const state = parsed.searchParams.get("state");
    const error = parsed.searchParams.get("error");

    if (error) {
      clearPendingAuth();
      throw new Error(`OAuth provider returned error: ${error}`);
    }

    if (!code) {
      throw new Error("Missing code on callback URL.");
    }

    if (state !== pending.state) {
      clearPendingAuth();
      throw new Error("Invalid OAuth state. Login attempt aborted.");
    }

    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        code_verifier: pending.codeVerifier,
      }),
    });

    if (!response.ok) {
      clearPendingAuth();
      throw new Error(`Token exchange failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as TokenResponse;
    const session = parseTokenResponse(payload);

    if (session.refreshToken) {
      await this.tokenStore.saveRefreshToken(session.refreshToken);
    }

    clearPendingAuth();
    return session;
  }

  async refreshSession(): Promise<AuthSession> {
    const refreshToken = await this.tokenStore.getRefreshToken();
    if (!refreshToken) {
      throw new Error("No refresh token available.");
    }

    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId,
      }),
    });

    if (!response.ok) {
      await this.tokenStore.clear();
      throw new Error(`Refresh failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as TokenResponse;
    const session = parseTokenResponse(payload);

    if (session.refreshToken) {
      await this.tokenStore.saveRefreshToken(session.refreshToken);
    }

    return session;
  }

  async logout(): Promise<void> {
    clearPendingAuth();
    await this.tokenStore.clear();
  }
}
