import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { OAuthService } from "./modules/auth/oauth-service";
import {
  SecureTokenStore,
  clearApiKey,
  loadApiKey,
  saveApiKey,
} from "./modules/auth/token-store";
import type { AuthSession, OAuthConfig } from "./modules/auth/types";
import type {
  AgentSession,
  ChatMessage,
  CommandResult,
  WorkspaceEntry,
} from "./modules/common/types";
import { requestAssistantReply } from "./modules/session/codex-client";
import { appendMessage, createSession, loadSessions } from "./modules/session/session-store";
import { runWorkspaceCommand } from "./modules/terminal/terminal-service";
import { buildLineDiff } from "./modules/workspace/diff";
import {
  listWorkspaceEntries,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "./modules/workspace/workspace-service";

type TabKey = "sessions" | "terminal" | "workspace";
type AuthMethod = "oauth" | "api_key";

interface AuthSettings {
  method: AuthMethod;
  oauth: OAuthConfig;
  apiModel: string;
  apiBaseUrl: string;
}

const AUTH_SETTINGS_KEY = "codex.auth.settings.v1";

function defaultOAuthConfig(): OAuthConfig {
  return {
    clientId: import.meta.env.VITE_OAUTH_CLIENT_ID ?? "",
    authorizeUrl: import.meta.env.VITE_OAUTH_AUTHORIZE_URL ?? "",
    tokenUrl: import.meta.env.VITE_OAUTH_TOKEN_URL ?? "",
    redirectUri: import.meta.env.VITE_OAUTH_REDIRECT_URI ?? "http://127.0.0.1:4815/callback",
    scope: import.meta.env.VITE_OAUTH_SCOPE ?? "openid profile offline_access",
  };
}

function loadAuthSettings(): AuthSettings {
  const defaults: AuthSettings = {
    method: "oauth",
    oauth: defaultOAuthConfig(),
    apiModel: "gpt-4.1-mini",
    apiBaseUrl: "https://api.openai.com/v1",
  };

  const raw = localStorage.getItem(AUTH_SETTINGS_KEY);
  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AuthSettings> & {
      oauth?: Partial<OAuthConfig>;
    };

    return {
      method: parsed.method === "api_key" ? "api_key" : "oauth",
      oauth: {
        clientId: parsed.oauth?.clientId ?? defaults.oauth.clientId,
        authorizeUrl: parsed.oauth?.authorizeUrl ?? defaults.oauth.authorizeUrl,
        tokenUrl: parsed.oauth?.tokenUrl ?? defaults.oauth.tokenUrl,
        redirectUri: parsed.oauth?.redirectUri ?? defaults.oauth.redirectUri,
        scope: parsed.oauth?.scope ?? defaults.oauth.scope,
      },
      apiModel: parsed.apiModel ?? defaults.apiModel,
      apiBaseUrl: parsed.apiBaseUrl ?? defaults.apiBaseUrl,
    };
  } catch {
    return defaults;
  }
}

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
  };
}

function missingOAuthConfigFields(config: OAuthConfig): string[] {
  const missing: string[] = [];
  if (!config.clientId.trim()) missing.push("Client ID");
  if (!config.authorizeUrl.trim()) missing.push("Authorize URL");
  if (!config.tokenUrl.trim()) missing.push("Token URL");
  if (!config.redirectUri.trim()) missing.push("Redirect URI");
  return missing;
}

function App() {
  const [authSettings, setAuthSettings] = useState<AuthSettings>(() => loadAuthSettings());
  const authService = useMemo(
    () => new OAuthService(authSettings.oauth, new SecureTokenStore()),
    [authSettings.oauth],
  );

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authDraft, setAuthDraft] = useState<AuthSettings>(authSettings);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");

  const [tab, setTab] = useState<TabKey>("sessions");
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authStatus, setAuthStatus] = useState("Not connected");

  const [workspacePath, setWorkspacePath] = useState("");

  const [sessions, setSessions] = useState<AgentSession[]>(() => {
    const loaded = loadSessions();
    return loaded.length ? loaded : [createSession("Primeira sessão")];
  });
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const loaded = loadSessions();
    return loaded[0]?.id ?? "";
  });
  const [prompt, setPrompt] = useState("");
  const [sessionStatus, setSessionStatus] = useState("Idle");

  const [command, setCommand] = useState("");
  const [terminalStatus, setTerminalStatus] = useState("Idle");
  const [commandHistory, setCommandHistory] = useState<Array<CommandResult & { command: string }>>([]);

  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState("Idle");
  const [selectedFile, setSelectedFile] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [editableContent, setEditableContent] = useState("");

  const activeSession = sessions.find((item) => item.id === activeSessionId) ?? sessions[0] ?? null;

  useEffect(() => {
    async function bootstrapAuth() {
      const loadedKey = await loadApiKey();
      setApiKey(loadedKey ?? "");

      if (authSettings.method !== "oauth" || !authService.isConfigured()) {
        if (authSettings.method === "api_key" && loadedKey) {
          setAuthStatus("Connected with API key.");
        } else if (authSettings.method === "api_key") {
          setAuthStatus("API key not configured.");
        } else {
          setAuthStatus("OAuth not configured.");
        }
        return;
      }

      try {
        const restored = await authService.refreshSession();
        setAuthSession(restored);
        setAuthStatus("Connected with OAuth.");
      } catch {
        setAuthStatus("OAuth session not active. Open Add Key to connect.");
      }
    }

    void bootstrapAuth();
  }, [authService, authSettings.method]);

  function openAuthModal() {
    setAuthDraft(authSettings);
    setApiKeyDraft(apiKey);
    setIsAuthModalOpen(true);
  }

  function closeAuthModal() {
    setIsAuthModalOpen(false);
  }

  async function connectOAuthNow(config: OAuthConfig) {
    const runtime = new OAuthService(config, new SecureTokenStore());
    setAuthStatus("Opening browser and waiting for OAuth callback...");
    const next = await runtime.beginLoginWithLoopback();
    setAuthSession(next);
    setAuthStatus("Connected with OAuth.");
  }

  async function onSaveAuthSettings() {
    localStorage.setItem(AUTH_SETTINGS_KEY, JSON.stringify(authDraft));
    setAuthSettings(authDraft);

    if (authDraft.method === "api_key") {
      if (apiKeyDraft.trim()) {
        await saveApiKey(apiKeyDraft.trim());
        setApiKey(apiKeyDraft.trim());
        setAuthSession(null);
        setAuthStatus("Connected with API key.");
      } else {
        await clearApiKey();
        setApiKey("");
        setAuthStatus("API key cleared.");
      }
      setIsAuthModalOpen(false);
      return;
    }

    const missing = missingOAuthConfigFields(authDraft.oauth);
    if (missing.length > 0) {
      setAuthStatus(`Missing OAuth fields: ${missing.join(", ")}`);
      return;
    }

    try {
      await connectOAuthNow(authDraft.oauth);
      setIsAuthModalOpen(false);
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Failed to connect OAuth.");
    }
  }

  function onCreateSession() {
    const next = createSession();
    setSessions(loadSessions());
    setActiveSessionId(next.id);
  }

  async function onSendPrompt() {
    if (!activeSession || !prompt.trim()) {
      return;
    }

    const userText = prompt.trim();
    setPrompt("");

    const userMessage = createMessage("user", userText);
    const afterUser = appendMessage(activeSession.id, userMessage);
    setSessions(afterUser);
    setSessionStatus("Generating assistant reply...");

    try {
      const current = afterUser.find((item) => item.id === activeSession.id);
      const history = current?.messages ?? [];

      const replyText = await requestAssistantReply(history, userText, {
        method: authSettings.method,
        accessToken: authSession?.accessToken,
        apiKey,
        model: authSettings.apiModel,
        apiBaseUrl: authSettings.apiBaseUrl,
      });

      const assistantMessage = createMessage("assistant", replyText);
      const afterAssistant = appendMessage(activeSession.id, assistantMessage);
      setSessions(afterAssistant);
      setSessionStatus("Reply received.");
    } catch (error) {
      const systemMessage = createMessage(
        "system",
        error instanceof Error ? error.message : "Failed to process assistant reply.",
      );
      const afterError = appendMessage(activeSession.id, systemMessage);
      setSessions(afterError);
      setSessionStatus("Assistant request failed.");
    }
  }

  async function onRunCommand() {
    try {
      setTerminalStatus("Executando comando...");
      const result = await runWorkspaceCommand(workspacePath, command);
      setCommandHistory((prev) => [{ ...result, command }, ...prev].slice(0, 30));
      setTerminalStatus(`Comando finalizado com exit code ${result.exitCode}.`);
    } catch (error) {
      setTerminalStatus(error instanceof Error ? error.message : "Falha ao executar comando.");
    }
  }

  async function onLoadEntries(relativePath = "") {
    try {
      setWorkspaceStatus("Carregando arquivos...");
      const items = await listWorkspaceEntries(workspacePath, relativePath);
      setEntries(items);
      setWorkspaceStatus(`Foram listados ${items.length} itens.`);
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Falha ao listar arquivos.");
    }
  }

  async function onOpenFile(relativePath: string) {
    try {
      setWorkspaceStatus(`Abrindo ${relativePath}...`);
      const content = await readWorkspaceFile(workspacePath, relativePath);
      setSelectedFile(relativePath);
      setOriginalContent(content);
      setEditableContent(content);
      setWorkspaceStatus(`Arquivo ${relativePath} carregado.`);
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Falha ao abrir arquivo.");
    }
  }

  async function onSaveFile() {
    if (!selectedFile) {
      return;
    }

    try {
      await writeWorkspaceFile(workspacePath, selectedFile, editableContent);
      setOriginalContent(editableContent);
      setWorkspaceStatus(`Arquivo ${selectedFile} salvo.`);
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Falha ao salvar arquivo.");
    }
  }

  const diffLines = buildLineDiff(originalContent, editableContent);
  const missingOAuthFields = missingOAuthConfigFields(authDraft.oauth);

  return (
    <main className="app">
      {isAuthModalOpen && (
        <section className="auth-overlay">
          <div className="auth-modal">
            <h2>Add Key</h2>
            <p>Select authentication method and save.</p>

            <label htmlFor="auth-method">Method</label>
            <select
              id="auth-method"
              value={authDraft.method}
              onChange={(event) =>
                setAuthDraft((prev) => ({
                  ...prev,
                  method: event.currentTarget.value === "api_key" ? "api_key" : "oauth",
                }))
              }
            >
              <option value="oauth">OAuth</option>
              <option value="api_key">OpenAI API Key</option>
            </select>

            {authDraft.method === "api_key" ? (
              <div className="oauth-grid modal-oauth-grid">
                <input
                  value={apiKeyDraft}
                  onChange={(event) => setApiKeyDraft(event.currentTarget.value)}
                  placeholder="OpenAI API key"
                />
                <input
                  value={authDraft.apiModel}
                  onChange={(event) =>
                    setAuthDraft((prev) => ({ ...prev, apiModel: event.currentTarget.value }))
                  }
                  placeholder="Model (e.g. gpt-4.1-mini)"
                />
                <input
                  value={authDraft.apiBaseUrl}
                  onChange={(event) =>
                    setAuthDraft((prev) => ({ ...prev, apiBaseUrl: event.currentTarget.value }))
                  }
                  placeholder="API base URL"
                />
              </div>
            ) : (
              <div className="oauth-grid modal-oauth-grid">
                <input
                  value={authDraft.oauth.clientId}
                  onChange={(event) =>
                    setAuthDraft((prev) => ({
                      ...prev,
                      oauth: { ...prev.oauth, clientId: event.currentTarget.value },
                    }))
                  }
                  placeholder="OAuth Client ID"
                />
                <input
                  value={authDraft.oauth.redirectUri}
                  onChange={(event) =>
                    setAuthDraft((prev) => ({
                      ...prev,
                      oauth: { ...prev.oauth, redirectUri: event.currentTarget.value },
                    }))
                  }
                  placeholder="Redirect URI (loopback)"
                />
                <input
                  value={authDraft.oauth.authorizeUrl}
                  onChange={(event) =>
                    setAuthDraft((prev) => ({
                      ...prev,
                      oauth: { ...prev.oauth, authorizeUrl: event.currentTarget.value },
                    }))
                  }
                  placeholder="Authorize URL"
                />
                <input
                  value={authDraft.oauth.tokenUrl}
                  onChange={(event) =>
                    setAuthDraft((prev) => ({
                      ...prev,
                      oauth: { ...prev.oauth, tokenUrl: event.currentTarget.value },
                    }))
                  }
                  placeholder="Token URL"
                />
                <input
                  value={authDraft.oauth.scope}
                  onChange={(event) =>
                    setAuthDraft((prev) => ({
                      ...prev,
                      oauth: { ...prev.oauth, scope: event.currentTarget.value },
                    }))
                  }
                  placeholder="Scopes"
                />
              </div>
            )}

            {authDraft.method === "oauth" && missingOAuthFields.length > 0 && (
              <p className="status-line">Missing OAuth fields: {missingOAuthFields.join(", ")}</p>
            )}

            <div className="auth-actions">
              <button onClick={onSaveAuthSettings}>Save</button>
              <button className="ghost" onClick={closeAuthModal}>
                Close
              </button>
            </div>
          </div>
        </section>
      )}

      <header className="top-card">
        <div>
          <p className="eyebrow">Codex App for Windows</p>
          <h1>Workspace Agent Console</h1>
          <p className="status-line">Auth: {authStatus}</p>
        </div>
        <div className="auth-actions">
          <button onClick={openAuthModal}>Add Key</button>
        </div>
      </header>

      <section className="workspace-card">
        <label htmlFor="workspace-path">Workspace path</label>
        <div className="inline-form">
          <input
            id="workspace-path"
            value={workspacePath}
            onChange={(event) => setWorkspacePath(event.currentTarget.value)}
            placeholder="C:/repos/meu-projeto"
          />
          <button onClick={() => onLoadEntries()} disabled={!workspacePath.trim()}>
            Carregar
          </button>
        </div>
      </section>

      <nav className="tabs">
        <button className={tab === "sessions" ? "active" : ""} onClick={() => setTab("sessions")}>
          Sessions
        </button>
        <button className={tab === "terminal" ? "active" : ""} onClick={() => setTab("terminal")}>
          Terminal
        </button>
        <button className={tab === "workspace" ? "active" : ""} onClick={() => setTab("workspace")}>
          Workspace
        </button>
      </nav>

      {tab === "sessions" && (
        <section className="panel two-column">
          <aside className="session-list">
            <div className="panel-head">
              <h2>Sessões</h2>
              <button onClick={onCreateSession}>Nova</button>
            </div>

            {sessions.map((item) => (
              <button
                key={item.id}
                className={item.id === activeSession?.id ? "session-item active" : "session-item"}
                onClick={() => setActiveSessionId(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{new Date(item.updatedAt).toLocaleString()}</span>
              </button>
            ))}
          </aside>

          <div className="chat-area">
            <h2>{activeSession?.title ?? "Sem sessão"}</h2>
            <div className="messages">
              {(activeSession?.messages ?? []).map((message) => (
                <article key={message.id} className={`msg ${message.role}`}>
                  <header>{message.role}</header>
                  <pre>{message.content}</pre>
                </article>
              ))}
            </div>

            <div className="inline-form">
              <input
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                placeholder="Descreva uma tarefa para o agente..."
              />
              <button onClick={onSendPrompt}>Enviar</button>
            </div>
            <p className="status-line">Session: {sessionStatus}</p>
          </div>
        </section>
      )}

      {tab === "terminal" && (
        <section className="panel">
          <h2>Terminal</h2>
          <div className="inline-form">
            <input
              value={command}
              onChange={(event) => setCommand(event.currentTarget.value)}
              placeholder="npm run build"
            />
            <button onClick={onRunCommand}>Executar</button>
          </div>

          <p className="status-line">Terminal: {terminalStatus}</p>

          <div className="terminal-log">
            {commandHistory.map((item, index) => (
              <article key={`${item.command}-${index}`}>
                <h3>
                  {item.command} (exit {item.exitCode}, {item.durationMs}ms)
                </h3>
                <pre>{item.stdout || "(sem stdout)"}</pre>
                {item.stderr && <pre className="stderr">{item.stderr}</pre>}
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "workspace" && (
        <section className="panel two-column">
          <aside className="file-list">
            <h2>Arquivos</h2>
            <div className="file-items">
              {entries.map((entry) => (
                <button
                  key={entry.relativePath}
                  className={entry.isDir ? "dir" : "file"}
                  onClick={() =>
                    entry.isDir ? onLoadEntries(entry.relativePath) : onOpenFile(entry.relativePath)
                  }
                >
                  {entry.isDir ? "[DIR]" : "[FILE]"} {entry.relativePath}
                </button>
              ))}
            </div>
          </aside>

          <div className="editor-area">
            <h2>{selectedFile || "Selecione um arquivo"}</h2>
            <textarea
              value={editableContent}
              onChange={(event) => setEditableContent(event.currentTarget.value)}
              placeholder="Conteúdo do arquivo"
            />
            <button onClick={onSaveFile} disabled={!selectedFile}>
              Salvar arquivo
            </button>
            <p className="status-line">Workspace: {workspaceStatus}</p>

            <h3>Diff preview</h3>
            <div className="diff-box">
              {diffLines.map((line, index) => (
                <pre key={`${line.type}-${index}`} className={line.type}>
                  {line.type === "same" ? "  " : line.type === "added" ? "+ " : "- "}
                  {line.content}
                </pre>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
