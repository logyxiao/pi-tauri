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

export function loadPreferredOpenTarget(): ProjectOpenTarget {
  try {
    const value = window.localStorage.getItem("pi-tauri.projectOpenTarget");
    if (value === "fileManager" || value === "terminal" || value === "vscode" || value === "cursor") return value;
  } catch {
    // Ignore storage failures.
  }
  return "terminal";
}

export function persistPreferredOpenTarget(target: ProjectOpenTarget) {
  try {
    window.localStorage.setItem("pi-tauri.projectOpenTarget", target);
  } catch {
    // Ignore storage failures.
  }
}

export async function openCodeFile(path: string, target: ProjectOpenTarget) {
  if (!path) return;
  try {
    await invoke("pi_open_code_file_with", { path, target });
  } catch (error) {
    console.error("failed to open file", { path, target, error });
    throw error;
  }
}
