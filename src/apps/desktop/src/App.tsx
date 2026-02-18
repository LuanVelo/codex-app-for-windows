import { useMemo, useState } from "react";
import "./App.css";
import { OAuthService } from "./modules/auth/oauth-service";
import { BrowserTokenStore } from "./modules/auth/token-store";
import type { AuthSession } from "./modules/auth/types";
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

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
  };
}

function App() {
  const authService = useMemo(() => OAuthService.fromEnv(new BrowserTokenStore()), []);
  const [tab, setTab] = useState<TabKey>("sessions");

  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authStatus, setAuthStatus] = useState("Ready");
  const [callbackUrl, setCallbackUrl] = useState("");

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

  async function onStartLogin() {
    try {
      setAuthStatus("Abrindo browser para OAuth...");
      await authService.beginLogin();
      setAuthStatus("Browser aberto. Cole a callback URL para concluir o login.");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Falha ao iniciar login OAuth.");
    }
  }

  async function onCompleteLogin() {
    try {
      const next = await authService.completeLogin(callbackUrl);
      setAuthSession(next);
      setAuthStatus("Autenticado.");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Falha ao concluir login.");
    }
  }

  async function onRefreshLogin() {
    try {
      const next = await authService.refreshSession();
      setAuthSession(next);
      setAuthStatus("Sessão renovada.");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Falha ao renovar sessão.");
    }
  }

  async function onLogout() {
    await authService.logout();
    setAuthSession(null);
    setCallbackUrl("");
    setAuthStatus("Logout concluído.");
  }

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
      <header className="top-card">
        <div>
          <p className="eyebrow">Codex App for Windows</p>
          <h1>Workspace Agent Console</h1>
        </div>

        <div className="auth-actions">
          <button onClick={onStartLogin} disabled={!authService.isConfigured()}>
            Entrar OAuth
          </button>
          <button onClick={onRefreshLogin} disabled={!authSession}>
            Refresh
          </button>
          <button className="ghost" onClick={onLogout}>
            Logout
          </button>
        </div>

        <label htmlFor="callback-url">OAuth callback URL (dev)</label>
        <div className="inline-form">
          <input
            id="callback-url"
            value={callbackUrl}
            onChange={(event) => setCallbackUrl(event.currentTarget.value)}
            placeholder="http://127.0.0.1:4815/callback?code=...&state=..."
          />
          <button onClick={onCompleteLogin} disabled={!callbackUrl}>
            Concluir login
          </button>
        </div>

        <p className="status-line">Auth: {authStatus}</p>
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
