export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  lastAccessedAt: number;
  createdAt: number;
}

export interface ThreadRecord {
  id: string;
  projectId: string;
  name: string;
  description: string;
  skillId?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  permissionMode: "safe" | "normal" | "danger-confirm" | string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  role: string;
  content: string;
  createdAt: number;
}

export interface TaskRecord {
  id: string;
  threadId: string;
  command: string;
  cwd: string;
  shell: string;
  status: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number;
}

export interface TaskLogRecord {
  id: string;
  taskId: string;
  stream: string;
  line: string;
  createdAt: number;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch?: string;
  modifiedFiles: string[];
}

export interface TaskStatusEvent {
  taskId: string;
  threadId: string;
  status: string;
  exitCode?: number;
}

export interface TaskLogEvent {
  taskId: string;
  threadId: string;
  stream: string;
  line: string;
}

export interface SkillRecord {
  id: string;
  name: string;
  systemPrompt: string;
  checklist: string;
  suggestedCommands: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AppSettingsRecord {
  maxParallelTasks: number;
  defaultShell: string;
  defaultWorkspaceRoot: string;
  theme: string;
}

export interface WorktreeResult {
  branchName: string;
  worktreePath: string;
}
