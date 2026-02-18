import type { AgentSession, ChatMessage } from "../common/types";

const STORE_KEY = "codex.sessions.v1";

function readStore(): AgentSession[] {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as AgentSession[];
  } catch {
    localStorage.removeItem(STORE_KEY);
    return [];
  }
}

function writeStore(sessions: AgentSession[]): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(sessions));
}

export function loadSessions(): AgentSession[] {
  return readStore().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createSession(title?: string): AgentSession {
  const now = Date.now();
  const session: AgentSession = {
    id: crypto.randomUUID(),
    title: title?.trim() || `Session ${new Date(now).toLocaleString()}`,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };

  const all = [session, ...readStore()];
  writeStore(all);
  return session;
}

export function appendMessage(sessionId: string, message: ChatMessage): AgentSession[] {
  const all = readStore().map((session) => {
    if (session.id !== sessionId) {
      return session;
    }

    return {
      ...session,
      updatedAt: Date.now(),
      messages: [...session.messages, message],
    };
  });

  writeStore(all);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function renameSession(sessionId: string, title: string): AgentSession[] {
  const all = readStore().map((session) =>
    session.id === sessionId
      ? { ...session, title: title.trim() || session.title, updatedAt: Date.now() }
      : session,
  );

  writeStore(all);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}
