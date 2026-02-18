export type AssistantRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: AssistantRole;
  content: string;
  createdAt: number;
}

export interface AgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface WorkspaceEntry {
  name: string;
  relativePath: string;
  isDir: boolean;
  size: number;
}
