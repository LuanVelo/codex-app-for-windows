import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceEntry } from "../common/types";

export async function listWorkspaceEntries(
  workspacePath: string,
  relativePath = "",
): Promise<WorkspaceEntry[]> {
  if (!workspacePath.trim()) {
    throw new Error("Workspace path is required.");
  }

  return invoke<WorkspaceEntry[]>("list_workspace_entries", {
    workspacePath,
    relativePath,
  });
}

export async function readWorkspaceFile(
  workspacePath: string,
  relativePath: string,
): Promise<string> {
  return invoke<string>("read_workspace_file", {
    workspacePath,
    relativePath,
  });
}

export async function writeWorkspaceFile(
  workspacePath: string,
  relativePath: string,
  content: string,
): Promise<void> {
  await invoke("write_workspace_file", {
    workspacePath,
    relativePath,
    content,
  });
}
