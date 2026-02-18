import { useEffect, useMemo, useState } from "react";
import { FolderOpen, MessageSquarePlus, Settings } from "lucide-react";
import { Button } from "./components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { useAppStore } from "./state/app-store";
import type { AuthSession, OAuthConfig } from "./modules/auth/types";
import { OAuthService } from "./modules/auth/oauth-service";
import {
  SecureTokenStore,
  clearApiKey,
  loadApiKey,
  saveApiKey,
} from "./modules/auth/token-store";
import { requestAssistantReply } from "./modules/session/codex-client";
import { addThreadMessage } from "./features/mvp/api";

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

function missingOAuthFields(config: OAuthConfig): string[] {
  const missing: string[] = [];
  if (!config.clientId.trim()) missing.push("Client ID");
  if (!config.authorizeUrl.trim()) missing.push("Authorize URL");
  if (!config.tokenUrl.trim()) missing.push("Token URL");
  if (!config.redirectUri.trim()) missing.push("Redirect URI");
  return missing;
}

function App() {
  const {
    projects,
    activeProjectId,
    threads,
    activeThreadId,
    messages,
    tasks,
    selectedTaskId,
    taskLogs,
    git,
    statusText,
    init,
    createProject,
    selectProject,
    createThread,
    selectThread,
    sendUserMessage,
    runTask,
    cancelTask,
    selectTask,
    refreshGit,
  } = useAppStore();

  const [projectPathInput, setProjectPathInput] = useState("");
  const [threadNameInput, setThreadNameInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [taskCommandInput, setTaskCommandInput] = useState("");

  const [authSettings, setAuthSettings] = useState<AuthSettings>(() => loadAuthSettings());
  const [authDraft, setAuthDraft] = useState<AuthSettings>(authSettings);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [authStatus, setAuthStatus] = useState("Not connected");
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);

  const authService = useMemo(
    () => new OAuthService(authSettings.oauth, new SecureTokenStore()),
    [authSettings.oauth],
  );

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    async function bootstrapAuth() {
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

    void bootstrapAuth();
  }, [authService, authSettings.method]);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const activeThread = threads.find((t) => t.id === activeThreadId);

  async function onAddProject() {
    if (!projectPathInput.trim()) return;
    await createProject(projectPathInput.trim());
    setProjectPathInput("");
  }

  async function onCreateThread() {
    const name = threadNameInput.trim() || "New thread";
    await createThread(name);
    setThreadNameInput("");
  }

  async function onSendChat() {
    const content = chatInput.trim();
    if (!content || !activeThreadId) return;

    setChatInput("");
    await sendUserMessage(content);

    try {
      const assistant = await requestAssistantReply(
        messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
          createdAt: m.createdAt,
        })),
        content,
        {
          method: authSettings.method,
          accessToken: authSession?.accessToken,
          apiKey,
          model: authSettings.apiModel,
          apiBaseUrl: authSettings.apiBaseUrl,
        },
      );
      await addThreadMessage(activeThreadId, "assistant", assistant);
      await selectThread(activeThreadId);
    } catch (error) {
      await addThreadMessage(
        activeThreadId,
        "system",
        error instanceof Error ? error.message : "Assistant request failed",
      );
      await selectThread(activeThreadId);
    }
  }

  async function onRunTask() {
    if (!taskCommandInput.trim()) return;
    await runTask(taskCommandInput.trim());
    setTaskCommandInput("");
  }

  async function onSaveAuthSettings() {
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

  const missingDraft = missingOAuthFields(authDraft.oauth);

  return (
    <div className="h-full p-3">
      <div className="mx-auto grid h-full max-w-[1600px] grid-cols-[300px_1fr] gap-3">
        <aside className="flex h-full flex-col rounded-xl bg-zinc-100 p-3">
          <div className="mb-3">
            <p className="text-sm font-semibold">Projects</p>
            <div className="mt-2 flex gap-2">
              <Input
                value={projectPathInput}
                onChange={(e) => setProjectPathInput(e.currentTarget.value)}
                placeholder="C:/workspace/repo"
                className="h-8 bg-white"
              />
              <Button size="sm" variant="outline" onClick={onAddProject}>
                Add
              </Button>
            </div>
            <div className="mt-2 space-y-1">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => selectProject(project.id)}
                  className={`w-full rounded-md px-2 py-2 text-left text-sm ${
                    project.id === activeProjectId
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-700 hover:bg-zinc-200"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    <span className="truncate">{project.name}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Threads</p>
            <Button size="sm" variant="ghost" onClick={onCreateThread}>
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </div>

          <Input
            value={threadNameInput}
            onChange={(e) => setThreadNameInput(e.currentTarget.value)}
            placeholder="Thread name"
            className="mb-2 h-8 bg-white"
          />

          <div className="flex-1 space-y-1 overflow-auto">
            {threads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => selectThread(thread.id)}
                className={`w-full rounded-md px-2 py-2 text-left text-sm ${
                  thread.id === activeThreadId
                    ? "bg-zinc-200 text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-200"
                }`}
              >
                <p className="truncate">{thread.name}</p>
                <p className="text-[11px] text-zinc-500">{thread.status}</p>
              </button>
            ))}
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
              <h2 className="text-lg font-semibold">Settings</h2>
              <p className="text-xs text-zinc-500">{authStatus}</p>

              <label className="text-sm font-medium">Auth Method</label>
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
                  <Button onClick={onSaveAuthSettings}>Save</Button>
                </DialogClose>
              </div>
            </DialogContent>
          </Dialog>
        </aside>

        <section className="grid h-full grid-rows-[1fr_320px] overflow-hidden rounded-xl bg-white">
          <div className="flex flex-col border-b border-zinc-200">
            <header className="border-b border-zinc-100 px-5 py-3">
              <p className="text-lg font-semibold">{activeThread?.name ?? "No thread selected"}</p>
              <p className="text-xs text-zinc-500">{statusText}</p>
              <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                <span>{activeProject?.path ?? "No project"}</span>
                {git?.isRepo ? (
                  <>
                    <span>•</span>
                    <span>branch: {git.branch ?? "unknown"}</span>
                    <span>•</span>
                    <span>{git.modifiedFiles.length} modified</span>
                    <button onClick={() => refreshGit()} className="rounded px-2 py-0.5 hover:bg-zinc-100">
                      refresh git
                    </button>
                  </>
                ) : (
                  <span>• not a git repository</span>
                )}
              </div>
            </header>

            <div className="flex-1 overflow-auto px-5 py-3">
              <div className="mx-auto max-w-4xl space-y-3">
                {messages.map((message) => (
                  <article key={message.id} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">{message.role}</p>
                    <pre className="whitespace-pre-wrap text-sm leading-6">{message.content}</pre>
                  </article>
                ))}
              </div>
            </div>

            <div className="border-t border-zinc-100 px-5 py-3">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.currentTarget.value)}
                  placeholder="Write your message"
                />
                <Button onClick={onSendChat}>Send</Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 p-3">
            <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-2">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  value={taskCommandInput}
                  onChange={(e) => setTaskCommandInput(e.currentTarget.value)}
                  placeholder="Task command (PowerShell)"
                />
                <Button onClick={onRunTask}>Run</Button>
              </div>

              <div className="h-full overflow-auto rounded-md bg-zinc-50 p-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`mb-2 rounded border p-2 text-xs ${
                      task.id === selectedTaskId ? "border-emerald-500 bg-white" : "border-zinc-200 bg-white"
                    }`}
                  >
                    <button className="w-full text-left" onClick={() => selectTask(task.id)}>
                      <p className="font-semibold">{task.command}</p>
                      <p className="text-zinc-500">{task.status}</p>
                    </button>
                    {(task.status === "queued" || task.status === "running") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-1"
                        onClick={() => cancelTask(task.id)}
                      >
                        cancel
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-2">
              <p className="text-xs font-medium text-zinc-500">Task logs (streaming)</p>
              <div className="h-full overflow-auto rounded-md bg-zinc-50 p-2">
                {taskLogs.map((line) => (
                  <pre
                    key={line.id}
                    className={`mb-1 whitespace-pre-wrap text-xs ${
                      line.stream === "stderr" ? "text-red-700" : "text-zinc-800"
                    }`}
                  >
                    {line.stream === "stderr" ? "[err]" : "[out]"} {line.line}
                  </pre>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
