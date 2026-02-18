import { invoke } from "@tauri-apps/api/core";

const FALLBACK_KEY = "codex.auth.refresh_token";
const API_FALLBACK_KEY = "codex.auth.api_key";

export interface TokenStore {
  getRefreshToken(): Promise<string | null>;
  saveRefreshToken(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

export class SecureTokenStore implements TokenStore {
  async getRefreshToken(): Promise<string | null> {
    try {
      return await invoke<string | null>("load_refresh_token");
    } catch {
      return localStorage.getItem(FALLBACK_KEY);
    }
  }

  async saveRefreshToken(refreshToken: string): Promise<void> {
    try {
      await invoke("save_refresh_token", { refreshToken });
    } catch {
      localStorage.setItem(FALLBACK_KEY, refreshToken);
    }
  }

  async clear(): Promise<void> {
    try {
      await invoke("clear_refresh_token");
    } catch {
      localStorage.removeItem(FALLBACK_KEY);
    }
  }
}

export async function loadApiKey(): Promise<string | null> {
  try {
    return await invoke<string | null>("load_api_key");
  } catch {
    return localStorage.getItem(API_FALLBACK_KEY);
  }
}

export async function saveApiKey(apiKey: string): Promise<void> {
  try {
    await invoke("save_api_key", { apiKey });
  } catch {
    localStorage.setItem(API_FALLBACK_KEY, apiKey);
  }
}

export async function clearApiKey(): Promise<void> {
  try {
    await invoke("clear_api_key");
  } catch {
    localStorage.removeItem(API_FALLBACK_KEY);
  }
}
