export function isKnownCwd(cwd: string | undefined | null): cwd is string {
  return Boolean(cwd && cwd.trim() && cwd !== "unknown cwd" && cwd !== "Unknown cwd");
}

export function firstKnownCwd(paths: string[]): string | undefined {
  return paths.find(isKnownCwd);
}

export function displayCwd(cwd: string | undefined | null, fallback: string): string {
  return isKnownCwd(cwd) ? cwd : fallback;
}
