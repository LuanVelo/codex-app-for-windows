import { invoke } from "@tauri-apps/api/core";
import type { CommandResult } from "../common/types";

export async function runWorkspaceCommand(
  workspacePath: string,
  command: string,
): Promise<CommandResult> {
  if (!workspacePath.trim()) {
    throw new Error("Define a workspace path before running commands.");
  }

  if (!command.trim()) {
    throw new Error("Command cannot be empty.");
  }

  return invoke<CommandResult>("run_terminal_command", {
    workspacePath,
    command,
  });
}
