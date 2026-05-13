import { getCurrentWindow } from "@tauri-apps/api/window";

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export async function minimizeWindow() {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow() {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().toggleMaximize();
}

export async function toggleFullscreenWindow() {
  if (!isTauriRuntime()) return;
  const win = getCurrentWindow();
  await win.setFullscreen(!(await win.isFullscreen()));
}

export async function closeWindow() {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().close();
}

export async function startWindowDrag() {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().startDragging();
}
