use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use tauri::{AppHandle, Emitter, State};

type RpcResult<T> = Result<T, String>;

struct RpcProcess {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
struct RpcState {
    process: Arc<Mutex<Option<RpcProcess>>>,
}

#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "Pi Desktop",
        "goal": "Desktop workbench for pi coding agent"
    })
}

#[tauri::command]
fn pi_rpc_start(app: AppHandle, state: State<'_, RpcState>) -> RpcResult<()> {
    let mut slot = state.process.lock().map_err(|error| error.to_string())?;
    if slot.is_some() {
        return Ok(());
    }

    let pi_bin = std::env::var("PI_BIN").unwrap_or_else(|_| default_pi_bin());
    let mut child = Command::new(pi_bin)
        .args(["--mode", "rpc", "--no-session", "--offline"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start pi rpc: {error}"))?;

    let stdin = child.stdin.take().ok_or("failed to open pi rpc stdin")?;
    let stdout = child.stdout.take().ok_or("failed to open pi rpc stdout")?;
    let stderr = child.stderr.take().ok_or("failed to open pi rpc stderr")?;

    spawn_stdout_reader(app.clone(), stdout);
    spawn_stderr_reader(app, stderr);

    *slot = Some(RpcProcess { child, stdin });
    Ok(())
}

#[tauri::command]
fn pi_rpc_send(state: State<'_, RpcState>, message: String) -> RpcResult<()> {
    let mut slot = state.process.lock().map_err(|error| error.to_string())?;
    let process = slot.as_mut().ok_or("pi rpc is not running")?;

    process
        .stdin
        .write_all(message.as_bytes())
        .map_err(|error| format!("failed to write pi rpc stdin: {error}"))?;
    process
        .stdin
        .write_all(b"\n")
        .map_err(|error| format!("failed to write pi rpc newline: {error}"))?;
    process
        .stdin
        .flush()
        .map_err(|error| format!("failed to flush pi rpc stdin: {error}"))?;

    Ok(())
}

#[tauri::command]
fn pi_rpc_stop(state: State<'_, RpcState>) -> RpcResult<()> {
    let mut slot = state.process.lock().map_err(|error| error.to_string())?;
    if let Some(mut process) = slot.take() {
        process
            .child
            .kill()
            .map_err(|error| format!("failed to kill pi rpc: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn pi_list_files(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
    let root = safe_root(&cwd)?;
    let mut entries = Vec::new();
    collect_files(&root, &root, 0, &mut entries)?;
    Ok(entries)
}

#[tauri::command]
fn pi_read_file(cwd: String, path: String) -> RpcResult<serde_json::Value> {
    let root = safe_root(&cwd)?;
    let full_path = safe_join(&root, &path)?;
    let metadata = fs::metadata(&full_path).map_err(|error| format!("failed to stat file: {error}"))?;
    if !metadata.is_file() {
        return Err("preview target is not a file".to_string());
    }

    let size = metadata.len();
    let kind = file_kind(&path);
    let name = Path::new(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&path)
        .to_string();

    if kind == "image" || kind == "binary" {
        return Ok(serde_json::json!({
            "path": path,
            "name": name,
            "kind": kind,
            "size": size,
            "mime": mime_for_path(&full_path)
        }));
    }

    let bytes = fs::read(&full_path).map_err(|error| format!("failed to read file: {error}"))?;
    let limit = 64 * 1024;
    let truncated = bytes.len() > limit;
    let slice = if truncated { &bytes[..limit] } else { &bytes[..] };
    let content = String::from_utf8_lossy(slice).to_string();

    Ok(serde_json::json!({
        "path": path,
        "name": name,
        "kind": kind,
        "content": content,
        "size": size,
        "truncated": truncated,
        "mime": mime_for_path(&full_path)
    }))
}

fn spawn_stdout_reader(app: AppHandle, stdout: std::process::ChildStdout) {
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    let trimmed = line.strip_suffix('\r').unwrap_or(&line);
                    match serde_json::from_str::<serde_json::Value>(trimmed) {
                        Ok(value) => {
                            let _ = app.emit("pi-rpc-message", value);
                        }
                        Err(error) => {
                            let _ = app.emit(
                                "pi-rpc-error",
                                serde_json::json!({
                                    "source": "stdout-json",
                                    "error": error.to_string(),
                                    "line": trimmed
                                }),
                            );
                        }
                    }
                }
                Err(error) => {
                    let _ = app.emit(
                        "pi-rpc-error",
                        serde_json::json!({"source": "stdout", "error": error.to_string()}),
                    );
                    break;
                }
            }
        }
    });
}

fn spawn_stderr_reader(app: AppHandle, stderr: std::process::ChildStderr) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    let trimmed = line.strip_suffix('\r').unwrap_or(&line);
                    if !trimmed.trim().is_empty() {
                        let _ = app.emit(
                            "pi-rpc-stderr",
                            serde_json::json!({"line": trimmed}),
                        );
                    }
                }
                Err(error) => {
                    let _ = app.emit(
                        "pi-rpc-error",
                        serde_json::json!({"source": "stderr", "error": error.to_string()}),
                    );
                    break;
                }
            }
        }
    });
}

fn safe_root(cwd: &str) -> RpcResult<PathBuf> {
    let root = PathBuf::from(cwd);
    if !root.is_absolute() {
        return Err("cwd must be absolute".to_string());
    }
    root.canonicalize()
        .map_err(|error| format!("failed to resolve cwd: {error}"))
}

fn safe_join(root: &Path, relative_path: &str) -> RpcResult<PathBuf> {
    let requested = Path::new(relative_path);
    if requested.is_absolute() || relative_path.contains("..") {
        return Err("file preview path must stay inside cwd".to_string());
    }

    let full_path = root.join(requested);
    let canonical = full_path
        .canonicalize()
        .map_err(|error| format!("failed to resolve file path: {error}"))?;
    if !canonical.starts_with(root) {
        return Err("file preview path escapes cwd".to_string());
    }
    Ok(canonical)
}

fn collect_files(root: &Path, current: &Path, depth: usize, entries: &mut Vec<serde_json::Value>) -> RpcResult<()> {
    if depth > 3 || entries.len() >= 120 {
        return Ok(());
    }

    let mut children = fs::read_dir(current)
        .map_err(|error| format!("failed to read directory {}: {error}", current.display()))?
        .filter_map(Result::ok)
        .filter(|entry| !is_hidden_or_ignored(entry.path().file_name().and_then(|value| value.to_str()).unwrap_or("")))
        .collect::<Vec<_>>();

    children.sort_by_key(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase());

    for entry in children {
        if entries.len() >= 120 {
            break;
        }
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let relative = match path.strip_prefix(root) {
            Ok(value) => value.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        let kind = if metadata.is_dir() { "directory" } else { "file" };
        entries.push(serde_json::json!({
            "path": relative,
            "name": entry.file_name().to_string_lossy(),
            "kind": kind,
            "depth": depth,
            "size": if metadata.is_file() { Some(metadata.len()) } else { None }
        }));

        if metadata.is_dir() {
            collect_files(root, &path, depth + 1, entries)?;
        }
    }

    Ok(())
}

fn is_hidden_or_ignored(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "dist" | "target" | "coverage" | ".git")
}

fn file_kind(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "md" | "markdown" => "markdown",
        "html" | "htm" => "html",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" => "image",
        "json" | "ts" | "tsx" | "js" | "jsx" | "css" | "rs" | "toml" | "txt" | "yml" | "yaml" => "text",
        _ => "binary",
    }
}

fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "md" | "markdown" => "text/markdown",
        "html" | "htm" => "text/html",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "json" => "application/json",
        "css" => "text/css",
        "ts" | "tsx" | "js" | "jsx" | "rs" | "toml" | "txt" | "yml" | "yaml" => "text/plain",
        _ => "application/octet-stream",
    }
}

fn default_pi_bin() -> String {
    if cfg!(windows) {
        "pi.cmd".to_string()
    } else {
        "pi".to_string()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(RpcState::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            pi_rpc_start,
            pi_rpc_send,
            pi_rpc_stop,
            pi_list_files,
            pi_read_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
