import { invoke } from "@tauri-apps/api/core";

export type ProjectOpenTarget = "fileManager" | "terminal" | "vscode" | "cursor";

export async function openProjectPath(path: string, target: ProjectOpenTarget) {
  if (!path || path === "unknown cwd" || path === "Unknown cwd") return;
  try {
    await invoke("pi_open_project_with", { path, target });
  } catch (error) {
    console.error("failed to open project", { path, target, error });
    throw error;
  }
}
