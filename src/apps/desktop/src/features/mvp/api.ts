import { invoke } from "@tauri-apps/api/core";
import type {
  GitStatusResult,
  ProjectRecord,
  TaskLogRecord,
  TaskRecord,
  ThreadMessage,
  ThreadRecord,
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

export function createThread(projectId: string, name: string, description?: string) {
  return invoke<ThreadRecord>("create_thread", { projectId, name, description });
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

export function runTask(threadId: string, command: string, cwd: string, shell?: string) {
  return invoke<TaskRecord>("run_task", { threadId, command, cwd, shell });
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

export function gitStatus(path: string) {
  return invoke<GitStatusResult>("git_status", { path });
}

export function gitDiff(path: string, file?: string) {
  return invoke<string>("git_diff", { path, file });
}
