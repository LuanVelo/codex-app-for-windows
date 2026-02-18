import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { OAuthService } from "./modules/auth/oauth-service";
import { SecureTokenStore } from "./modules/auth/token-store";
import type { AuthSession, OAuthConfig } from "./modules/auth/types";
import type { AgentSession, ChatMessage, CommandResult, WorkspaceEntry } from "./modules/common/types";
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
const OAUTH_CONFIG_KEY = "codex.oauth.config.v1";

function loadOAuthConfig(): OAuthConfig {
  const fromEnv: OAuthConfig = {
    clientId: import.meta.env.VITE_OAUTH_CLIENT_ID ?? "",
    authorizeUrl: import.meta.env.VITE_OAUTH_AUTHORIZE_URL ?? "",
    tokenUrl: import.meta.env.VITE_OAUTH_TOKEN_URL ?? "",
    redirectUri: import.meta.env.VITE_OAUTH_REDIRECT_URI ?? "http://127.0.0.1:4815/callback",
    scope: import.meta.env.VITE_OAUTH_SCOPE ?? "openid profile offline_access",
  };

  const raw = localStorage.getItem(OAUTH_CONFIG_KEY);
  if (!raw) {
    return fromEnv;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<OAuthConfig>;
    return {
      clientId: parsed.clientId ?? fromEnv.clientId,
      authorizeUrl: parsed.authorizeUrl ?? fromEnv.authorizeUrl,
      tokenUrl: parsed.tokenUrl ?? fromEnv.tokenUrl,
      redirectUri: parsed.redirectUri ?? fromEnv.redirectUri,
      scope: parsed.scope ?? fromEnv.scope,
    };
  } catch {
    return fromEnv;
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

function App() {
  const [oauthConfig, setOauthConfig] = useState<OAuthConfig>(() => loadOAuthConfig());
  const authService = useMemo(() => new OAuthService(oauthConfig, new SecureTokenStore()), [oauthConfig]);
  const [tab, setTab] = useState<TabKey>("sessions");

  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authStatus, setAuthStatus] = useState("Ready");
  const [authRequired, setAuthRequired] = useState(true);
  const startupAttemptedRef = useRef(false);

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

  function onSaveOAuthConfig() {
    localStorage.setItem(OAUTH_CONFIG_KEY, JSON.stringify(oauthConfig));
    setAuthStatus("Config OAuth salva localmente.");
  }

  async function onStartLogin() {
    try {
      setAuthRequired(true);
      setAuthStatus("Abrindo browser e aguardando callback OAuth...");
      const next = await authService.beginLoginWithLoopback();
      setAuthSession(next);
      setAuthRequired(false);
      setAuthStatus("Autenticado.");
    } catch (error) {
      setAuthRequired(true);
      setAuthStatus(error instanceof Error ? error.message : "Falha ao iniciar login OAuth.");
    }
  }

  async function onRefreshLogin() {
    try {
      const next = await authService.refreshSession();
      setAuthSession(next);
      setAuthRequired(false);
      setAuthStatus("Sessão renovada.");
    } catch (error) {
      setAuthRequired(true);
      setAuthStatus(error instanceof Error ? error.message : "Falha ao renovar sessão.");
    }
  }

  async function onLogout() {
    await authService.logout();
    setAuthSession(null);
    setAuthRequired(true);
    setAuthStatus("Logout concluído.");
  }

  useEffect(() => {
    if (startupAttemptedRef.current) {
      return;
    }
    startupAttemptedRef.current = true;

    async function startupAuth() {
      if (!authService.isConfigured()) {
        setAuthRequired(true);
        setAuthStatus("Configure OAuth and click Connect to continue.");
        return;
      }

      try {
        setAuthStatus("Restoring session...");
        const session = await authService.refreshSession();
        setAuthSession(session);
        setAuthRequired(false);
        setAuthStatus("Sessão restaurada.");
      } catch {
        setAuthRequired(true);
        setAuthStatus("Sign-in required. Opening browser...");
        await onStartLogin();
      }
    }

    void startupAuth();
  }, [authService]);

  function onCreateSession() {
    const next = createSession();
    setSessions(loadSessions());
    setActiveSessionId(next.id);
  }

  async function onSendPrompt() {
    if (!activeSession) {
      return;
    }

    if (!prompt.trim()) {
      return;
    }

    const userText = prompt.trim();
    setPrompt("");

    const userMessage = createMessage("user", userText);
    const afterUser = appendMessage(activeSession.id, userMessage);
    setSessions(afterUser);
    setSessionStatus("Gerando resposta do agente...");

    try {
      const current = afterUser.find((item) => item.id === activeSession.id);
      const history = current?.messages ?? [];
      const replyText = await requestAssistantReply(history, userText, authSession?.accessToken);
      const assistantMessage = createMessage("assistant", replyText);
      const afterAssistant = appendMessage(activeSession.id, assistantMessage);
      setSessions(afterAssistant);
      setSessionStatus("Resposta recebida.");
    } catch (error) {
      const systemMessage = createMessage(
        "system",
        error instanceof Error ? error.message : "Falha ao consultar endpoint do agente.",
      );
      const afterError = appendMessage(activeSession.id, systemMessage);
      setSessions(afterError);
      setSessionStatus("Erro ao gerar resposta.");
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

  return (
    <main className="app">
      {authRequired && !authSession && (
        <section className="auth-overlay">
          <div className="auth-modal">
            <h2>Connect your account</h2>
            <p>
              Sign in is required before using the app. The browser OAuth flow will open and connect your ChatGPT
              account.
            </p>
            <div className="auth-actions">
              <button onClick={onStartLogin} disabled={!authService.isConfigured()}>
                Connect now
              </button>
              <button className="ghost" onClick={onRefreshLogin}>
                Retry session restore
              </button>
            </div>
            <p className="status-line">Auth: {authStatus}</p>
          </div>
        </section>
      )}

      <header className="top-card">
        <div>
          <p className="eyebrow">Codex App for Windows</p>
          <h1>Workspace Agent Console</h1>
        </div>

        <div className="auth-actions">
          <button onClick={onStartLogin}>
            Entrar OAuth
          </button>
          <button onClick={onRefreshLogin}>
            Refresh
          </button>
          <button className="ghost" onClick={onLogout}>
            Logout
          </button>
        </div>

        <p className="status-line">Auth: {authStatus}</p>

        <div className="oauth-grid">
          <input
            value={oauthConfig.clientId}
            onChange={(event) =>
              setOauthConfig((prev) => ({
                ...prev,
                clientId: event.currentTarget.value,
              }))
            }
            placeholder="OAuth Client ID"
          />
          <input
            value={oauthConfig.redirectUri}
            onChange={(event) =>
              setOauthConfig((prev) => ({
                ...prev,
                redirectUri: event.currentTarget.value,
              }))
            }
            placeholder="Redirect URI (loopback)"
          />
          <input
            value={oauthConfig.authorizeUrl}
            onChange={(event) =>
              setOauthConfig((prev) => ({
                ...prev,
                authorizeUrl: event.currentTarget.value,
              }))
            }
            placeholder="Authorize URL"
          />
          <input
            value={oauthConfig.tokenUrl}
            onChange={(event) =>
              setOauthConfig((prev) => ({
                ...prev,
                tokenUrl: event.currentTarget.value,
              }))
            }
            placeholder="Token URL"
          />
          <input
            value={oauthConfig.scope}
            onChange={(event) =>
              setOauthConfig((prev) => ({
                ...prev,
                scope: event.currentTarget.value,
              }))
            }
            placeholder="Scopes"
          />
          <button className="ghost" onClick={onSaveOAuthConfig}>
            Salvar config OAuth
          </button>
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
                  onClick={() => (entry.isDir ? onLoadEntries(entry.relativePath) : onOpenFile(entry.relativePath))}
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
