import { useEffect, useMemo, useState } from "react";
import { FolderOpen, MessageSquarePlus, MoreHorizontal, Settings } from "lucide-react";
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
import { Button } from "./components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";

type AuthMethod = "oauth" | "api_key";

interface AuthSettings {
  method: AuthMethod;
  oauth: OAuthConfig;
  apiModel: string;
  apiBaseUrl: string;
}

const AUTH_SETTINGS_KEY = "codex.auth.settings.v1";
const WORKSPACES_KEY = "codex.workspaces.v1";

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
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw) as Partial<AuthSettings> & { oauth?: Partial<OAuthConfig> };
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
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now() };
}

function missingOAuthFields(config: OAuthConfig): string[] {
  const missing: string[] = [];
  if (!config.clientId.trim()) missing.push("Client ID");
  if (!config.authorizeUrl.trim()) missing.push("Authorize URL");
  if (!config.tokenUrl.trim()) missing.push("Token URL");
  if (!config.redirectUri.trim()) missing.push("Redirect URI");
  return missing;
}

function loadWorkspaces(): string[] {
  const raw = localStorage.getItem(WORKSPACES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as string[];
    return parsed.filter(Boolean);
  } catch {
    return [];
  }
}

function saveWorkspaces(items: string[]) {
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(items));
}

function App() {
  const [authSettings, setAuthSettings] = useState<AuthSettings>(() => loadAuthSettings());
  const [authDraft, setAuthDraft] = useState<AuthSettings>(authSettings);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [authStatus, setAuthStatus] = useState("Not connected");
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);

  const [workspaceInput, setWorkspaceInput] = useState("");
  const [workspaces, setWorkspaces] = useState<string[]>(() => loadWorkspaces());
  const [activeWorkspace, setActiveWorkspace] = useState<string>(() => loadWorkspaces()[0] ?? "");
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);

  const [sessions, setSessions] = useState<AgentSession[]>(() => {
    const loaded = loadSessions();
    return loaded.length ? loaded : [createSession("New chat")];
  });
  const [activeSessionId, setActiveSessionId] = useState<string>(() => loadSessions()[0]?.id ?? "");

  const [prompt, setPrompt] = useState("");
  const [sessionStatus, setSessionStatus] = useState("Idle");

  const [command, setCommand] = useState("");
  const [terminalStatus, setTerminalStatus] = useState("Idle");
  const [commandHistory, setCommandHistory] = useState<Array<CommandResult & { command: string }>>([]);

  const [selectedFile, setSelectedFile] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [editableContent, setEditableContent] = useState("");

  const authService = useMemo(
    () => new OAuthService(authSettings.oauth, new SecureTokenStore()),
    [authSettings.oauth],
  );

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;
  const diffLines = buildLineDiff(originalContent, editableContent);

  useEffect(() => {
    async function bootstrap() {
      const key = await loadApiKey();
      setApiKey(key ?? "");

      if (authSettings.method === "api_key") {
        setAuthStatus(key ? "Connected with API key" : "API key not configured");
        return;
      }

      if (!authService.isConfigured()) {
        setAuthStatus("OAuth not configured");
        return;
      }

      try {
        const restored = await authService.refreshSession();
        setAuthSession(restored);
        setAuthStatus("Connected with OAuth");
      } catch {
        setAuthStatus("OAuth session not active");
      }
    }

    void bootstrap();
  }, [authService, authSettings.method]);

  useEffect(() => {
    if (!activeWorkspace) {
      setEntries([]);
      return;
    }

    async function loadRoot() {
      try {
        const data = await listWorkspaceEntries(activeWorkspace, "");
        setEntries(data);
      } catch {
        setEntries([]);
      }
    }

    void loadRoot();
  }, [activeWorkspace]);

  function onCreateChat() {
    const next = createSession();
    setSessions(loadSessions());
    setActiveSessionId(next.id);
  }

  function onAddWorkspace() {
    const value = workspaceInput.trim();
    if (!value) return;
    if (workspaces.includes(value)) {
      setWorkspaceInput("");
      setActiveWorkspace(value);
      return;
    }

    const updated = [value, ...workspaces];
    setWorkspaces(updated);
    saveWorkspaces(updated);
    setWorkspaceInput("");
    setActiveWorkspace(value);
  }

  async function onSaveSettings() {
    localStorage.setItem(AUTH_SETTINGS_KEY, JSON.stringify(authDraft));
    setAuthSettings(authDraft);

    if (authDraft.method === "api_key") {
      if (apiKeyDraft.trim()) {
        await saveApiKey(apiKeyDraft.trim());
        setApiKey(apiKeyDraft.trim());
        setAuthSession(null);
        setAuthStatus("Connected with API key");
      } else {
        await clearApiKey();
        setApiKey("");
        setAuthStatus("API key cleared");
      }
      return;
    }

    const missing = missingOAuthFields(authDraft.oauth);
    if (missing.length > 0) {
      setAuthStatus(`Missing OAuth fields: ${missing.join(", ")}`);
      return;
    }

    try {
      const oauth = new OAuthService(authDraft.oauth, new SecureTokenStore());
      const session = await oauth.beginLoginWithLoopback();
      setAuthSession(session);
      setAuthStatus("Connected with OAuth");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "OAuth connection failed");
    }
  }

  async function onSendPrompt() {
    if (!activeSession || !prompt.trim()) return;

    const userText = prompt.trim();
    setPrompt("");
    const userMessage = createMessage("user", userText);
    const afterUser = appendMessage(activeSession.id, userMessage);
    setSessions(afterUser);
    setSessionStatus("Generating reply...");

    try {
      const history = afterUser.find((s) => s.id === activeSession.id)?.messages ?? [];
      const reply = await requestAssistantReply(history, userText, {
        method: authSettings.method,
        accessToken: authSession?.accessToken,
        apiKey,
        model: authSettings.apiModel,
        apiBaseUrl: authSettings.apiBaseUrl,
      });
      setSessions(appendMessage(activeSession.id, createMessage("assistant", reply)));
      setSessionStatus("Reply received");
    } catch (error) {
      setSessions(
        appendMessage(
          activeSession.id,
          createMessage("system", error instanceof Error ? error.message : "Request failed"),
        ),
      );
      setSessionStatus("Request failed");
    }
  }

  async function onRunCommand() {
    try {
      setTerminalStatus("Running command...");
      const result = await runWorkspaceCommand(activeWorkspace, command);
      setCommandHistory((prev) => [{ ...result, command }, ...prev].slice(0, 20));
      setTerminalStatus(`Done (exit ${result.exitCode})`);
    } catch (error) {
      setTerminalStatus(error instanceof Error ? error.message : "Command failed");
    }
  }

  async function onOpenFile(path: string) {
    try {
      const content = await readWorkspaceFile(activeWorkspace, path);
      setSelectedFile(path);
      setOriginalContent(content);
      setEditableContent(content);
    } catch {
      setSelectedFile("");
    }
  }

  async function onSaveFile() {
    if (!selectedFile) return;
    await writeWorkspaceFile(activeWorkspace, selectedFile, editableContent);
    setOriginalContent(editableContent);
  }

  const missingDraft = missingOAuthFields(authDraft.oauth);

  return (
    <div className="h-full p-3">
      <div className="mx-auto grid h-full max-w-[1500px] grid-cols-[290px_1fr] gap-3">
        <aside className="flex h-full flex-col rounded-xl bg-zinc-100 p-3">
          <div className="mb-2 flex items-center justify-between px-2">
            <h1 className="text-lg font-semibold">codex windows</h1>
            <button className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>

          <Button variant="ghost" className="justify-start px-2" onClick={onCreateChat}>
            <MessageSquarePlus className="h-4 w-4" />
            New chat
          </Button>

          <div className="mt-4 flex-1 space-y-4 overflow-auto">
            <section>
              <p className="px-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Threads</p>
              <div className="mt-1 space-y-1">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => setActiveSessionId(session.id)}
                    className={`w-full rounded-md px-2 py-2 text-left text-sm ${
                      session.id === activeSession?.id
                        ? "bg-zinc-200 text-zinc-900"
                        : "text-zinc-700 hover:bg-zinc-200"
                    }`}
                  >
                    <p className="truncate">{session.title}</p>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <p className="px-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Workspaces</p>
              <div className="mt-2 flex gap-2">
                <Input
                  value={workspaceInput}
                  onChange={(e) => setWorkspaceInput(e.currentTarget.value)}
                  placeholder="C:/repo"
                  className="h-8 bg-white"
                />
                <Button size="sm" variant="outline" onClick={onAddWorkspace}>
                  Add
                </Button>
              </div>
              <div className="mt-2 space-y-1">
                {workspaces.map((workspace) => (
                  <button
                    key={workspace}
                    onClick={() => setActiveWorkspace(workspace)}
                    className={`w-full rounded-md px-2 py-2 text-left text-sm ${
                      workspace === activeWorkspace
                        ? "bg-zinc-900 text-white"
                        : "text-zinc-700 hover:bg-zinc-200"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4" />
                      <span className="truncate">{workspace}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                className="mt-2 justify-start px-2 text-zinc-700"
                onClick={() => {
                  setAuthDraft(authSettings);
                  setApiKeyDraft(apiKey);
                }}
              >
                <Settings className="h-4 w-4" />
                Settings
              </Button>
            </DialogTrigger>
            <DialogContent>
              <h2 className="text-lg font-semibold">Authentication settings</h2>
              <p className="text-xs text-zinc-500">{authStatus}</p>

              <label className="text-sm font-medium">Method</label>
              <select
                className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm"
                value={authDraft.method}
                onChange={(e) =>
                  setAuthDraft((prev) => ({ ...prev, method: e.currentTarget.value as AuthMethod }))
                }
              >
                <option value="oauth">OAuth</option>
                <option value="api_key">OpenAI API Key</option>
              </select>

              {authDraft.method === "api_key" ? (
                <div className="space-y-2">
                  <Input
                    placeholder="OpenAI API key"
                    value={apiKeyDraft}
                    onChange={(e) => setApiKeyDraft(e.currentTarget.value)}
                  />
                  <Input
                    placeholder="Model"
                    value={authDraft.apiModel}
                    onChange={(e) =>
                      setAuthDraft((prev) => ({ ...prev, apiModel: e.currentTarget.value }))
                    }
                  />
                  <Input
                    placeholder="API base URL"
                    value={authDraft.apiBaseUrl}
                    onChange={(e) =>
                      setAuthDraft((prev) => ({ ...prev, apiBaseUrl: e.currentTarget.value }))
                    }
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    placeholder="OAuth Client ID"
                    value={authDraft.oauth.clientId}
                    onChange={(e) =>
                      setAuthDraft((prev) => ({
                        ...prev,
                        oauth: { ...prev.oauth, clientId: e.currentTarget.value },
                      }))
                    }
                  />
                  <Input
                    placeholder="Authorize URL"
                    value={authDraft.oauth.authorizeUrl}
                    onChange={(e) =>
                      setAuthDraft((prev) => ({
                        ...prev,
                        oauth: { ...prev.oauth, authorizeUrl: e.currentTarget.value },
                      }))
                    }
                  />
                  <Input
                    placeholder="Token URL"
                    value={authDraft.oauth.tokenUrl}
                    onChange={(e) =>
                      setAuthDraft((prev) => ({
                        ...prev,
                        oauth: { ...prev.oauth, tokenUrl: e.currentTarget.value },
                      }))
                    }
                  />
                  <Input
                    placeholder="Redirect URI"
                    value={authDraft.oauth.redirectUri}
                    onChange={(e) =>
                      setAuthDraft((prev) => ({
                        ...prev,
                        oauth: { ...prev.oauth, redirectUri: e.currentTarget.value },
                      }))
                    }
                  />
                  <Input
                    placeholder="Scopes"
                    value={authDraft.oauth.scope}
                    onChange={(e) =>
                      setAuthDraft((prev) => ({
                        ...prev,
                        oauth: { ...prev.oauth, scope: e.currentTarget.value },
                      }))
                    }
                  />
                  {missingDraft.length > 0 && (
                    <p className="text-xs text-red-600">Missing: {missingDraft.join(", ")}</p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="ghost">Close</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button onClick={onSaveSettings}>Save</Button>
                </DialogClose>
              </div>
            </DialogContent>
          </Dialog>
        </aside>

        <section className="flex h-full flex-col rounded-xl bg-white">
          <header className="border-b border-zinc-200 px-6 py-4">
            <p className="text-xl font-semibold">{activeSession?.title ?? "New chat"}</p>
            <p className="text-sm text-zinc-500">{sessionStatus}</p>
          </header>

          <div className="grid flex-1 grid-rows-[1fr_320px]">
            <div className="overflow-auto px-6 py-4">
              <div className="mx-auto max-w-4xl space-y-3">
                {(activeSession?.messages ?? []).map((message) => (
                  <article key={message.id} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">{message.role}</p>
                    <pre className="whitespace-pre-wrap text-sm leading-6">{message.content}</pre>
                  </article>
                ))}
              </div>
            </div>

            <div className="border-t border-zinc-200 px-6 py-3">
              <div className="grid h-full grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Input
                      value={prompt}
                      onChange={(e) => setPrompt(e.currentTarget.value)}
                      placeholder="Ask something..."
                    />
                    <Button onClick={onSendPrompt}>Send</Button>
                  </div>

                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Input
                      value={command}
                      onChange={(e) => setCommand(e.currentTarget.value)}
                      placeholder="npm run build"
                    />
                    <Button variant="outline" onClick={onRunCommand} disabled={!activeWorkspace}>
                      Run
                    </Button>
                  </div>
                  <p className="text-xs text-zinc-500">{terminalStatus}</p>

                  <div className="h-full overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2">
                    {commandHistory.map((item, idx) => (
                      <pre key={`${idx}-${item.command}`} className="mb-2 whitespace-pre-wrap text-xs">
                        $ {item.command}\n{item.stdout || item.stderr || "(no output)"}
                      </pre>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="h-20 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs">
                    {entries.map((entry) => (
                      <button
                        key={entry.relativePath}
                        className="block w-full rounded px-1 py-0.5 text-left hover:bg-zinc-200"
                        onClick={() =>
                          entry.isDir
                            ? listWorkspaceEntries(activeWorkspace, entry.relativePath).then(setEntries)
                            : onOpenFile(entry.relativePath)
                        }
                      >
                        {entry.isDir ? "[DIR]" : "[FILE]"} {entry.relativePath}
                      </button>
                    ))}
                  </div>

                  <Textarea
                    value={editableContent}
                    onChange={(e) => setEditableContent(e.currentTarget.value)}
                    placeholder="Select a file to edit"
                    className="h-24"
                  />

                  <div className="flex justify-end">
                    <Button variant="outline" onClick={onSaveFile} disabled={!selectedFile}>
                      Save file
                    </Button>
                  </div>

                  <div className="h-full overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs">
                    {diffLines.slice(0, 80).map((line, idx) => (
                      <pre
                        key={`${line.type}-${idx}`}
                        className={`${
                          line.type === "added"
                            ? "text-emerald-700"
                            : line.type === "removed"
                              ? "text-red-700"
                              : "text-zinc-700"
                        }`}
                      >
                        {line.type === "same" ? "  " : line.type === "added" ? "+ " : "- "}
                        {line.content}
                      </pre>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
