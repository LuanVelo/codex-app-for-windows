const REFRESH_TOKEN_KEY = "codex.auth.refresh_token";

export interface TokenStore {
  getRefreshToken(): Promise<string | null>;
  saveRefreshToken(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

export class BrowserTokenStore implements TokenStore {
  async getRefreshToken(): Promise<string | null> {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  async saveRefreshToken(refreshToken: string): Promise<void> {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }

  async clear(): Promise<void> {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}

// TODO: replace with Tauri command backed by Windows Credential Manager.
