import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettingsRecord,
  GitStatusResult,
  ProjectRecord,
  SkillRecord,
  TaskLogRecord,
  TaskRecord,
  ThreadMessage,
  ThreadRecord,
  WorktreeResult,
} from "./types";

export function createProject(path: string, name?: string) {
  return invoke<ProjectRecord>("create_project", { path, name });
}

export function listProjects() {
  return invoke<ProjectRecord[]>("list_projects");
}

export function touchProject(projectId: string) {
  return invoke<void>("touch_project", { projectId });
}

export function createThread(projectId: string, name: string, description?: string, skillId?: string) {
  return invoke<ThreadRecord>("create_thread", { projectId, name, description, skillId });
}

export function listThreads(projectId: string) {
  return invoke<ThreadRecord[]>("list_threads", { projectId });
}

export function addThreadMessage(threadId: string, role: string, content: string) {
  return invoke<ThreadMessage>("add_thread_message", { threadId, role, content });
}

export function listThreadMessages(threadId: string) {
  return invoke<ThreadMessage[]>("list_thread_messages", { threadId });
}

export function runTask(
  threadId: string,
  command: string,
  cwd: string,
  shell?: string,
  confirmDestructive?: boolean,
) {
  return invoke<TaskRecord>("run_task", { threadId, command, cwd, shell, confirmDestructive });
}

export function cancelTask(taskId: string) {
  return invoke<void>("cancel_task", { taskId });
}

export function listTasks(threadId: string) {
  return invoke<TaskRecord[]>("list_tasks", { threadId });
}

export function listTaskLogs(taskId: string) {
  return invoke<TaskLogRecord[]>("list_task_logs", { taskId });
}

export function setMaxParallelTasks(value: number) {
  return invoke<void>("set_max_parallel_tasks", { value });
}

export function getAppSettings() {
  return invoke<AppSettingsRecord>("get_app_settings");
}

export function updateAppSettings(settings: AppSettingsRecord) {
  return invoke<void>("update_app_settings", { settings });
}

export function listSkills() {
  return invoke<SkillRecord[]>("list_skills");
}

export function createSkill(
  name: string,
  systemPrompt: string,
  checklist?: string,
  suggestedCommands?: string[],
) {
  return invoke<SkillRecord>("create_skill", { name, systemPrompt, checklist, suggestedCommands });
}

export function updateSkill(
  skillId: string,
  name: string,
  systemPrompt: string,
  checklist?: string,
  suggestedCommands?: string[],
) {
  return invoke<SkillRecord>("update_skill", {
    skillId,
    name,
    systemPrompt,
    checklist,
    suggestedCommands,
  });
}

export function deleteSkill(skillId: string) {
  return invoke<void>("delete_skill", { skillId });
}

export function createWorktree(projectPath: string, branchName: string, worktreePath: string) {
  return invoke<WorktreeResult>("create_worktree", { projectPath, branchName, worktreePath });
}

export function attachThreadWorktree(threadId: string, worktreePath: string, branchName: string) {
  return invoke<void>("attach_thread_worktree", { threadId, worktreePath, branchName });
}

export function gitStatus(path: string) {
  return invoke<GitStatusResult>("git_status", { path });
}

export function gitDiff(path: string, file?: string) {
  return invoke<string>("git_diff", { path, file });
}

export function setThreadPermission(
  threadId: string,
  permissionMode: "safe" | "normal" | "danger-confirm",
) {
  return invoke<ThreadRecord>("set_thread_permission", { threadId, permissionMode });
}
