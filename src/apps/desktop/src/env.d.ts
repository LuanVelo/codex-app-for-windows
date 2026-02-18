/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OAUTH_CLIENT_ID?: string;
  readonly VITE_OAUTH_AUTHORIZE_URL?: string;
  readonly VITE_OAUTH_TOKEN_URL?: string;
  readonly VITE_OAUTH_REDIRECT_URI?: string;
  readonly VITE_OAUTH_SCOPE?: string;
  readonly VITE_CODEX_CHAT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
