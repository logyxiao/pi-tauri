use std::{
    fs,
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{SystemTime, UNIX_EPOCH},
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
fn pi_list_sessions(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
    let target_cwd = if cwd.trim().is_empty() {
        None
    } else {
        Some(normalize_session_path(&safe_root(&cwd)?.to_string_lossy()))
    };
    let sessions_root = default_sessions_root()?;
    let mut sessions = Vec::new();
    collect_session_files(&sessions_root, target_cwd.as_deref(), &mut sessions)?;
    sessions.sort_by(|a, b| {
        let left = a.get("updatedAt").and_then(|value| value.as_str()).unwrap_or("");
        let right = b.get("updatedAt").and_then(|value| value.as_str()).unwrap_or("");
        right.cmp(left)
    });
    Ok(sessions)
}

#[tauri::command]
fn pi_delete_session(session_path: String) -> RpcResult<()> {
    let sessions_root = default_sessions_root()?;
    let path = PathBuf::from(&session_path)
        .canonicalize()
        .map_err(|error| format!("failed to resolve session path: {error}"))?;
    if !path.starts_with(&sessions_root) || path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
        return Err("session delete path must be a jsonl file inside pi sessions dir".to_string());
    }
    fs::remove_file(path).map_err(|error| format!("failed to delete session: {error}"))
}

#[tauri::command]
fn pi_session_tree(session_path: String) -> RpcResult<serde_json::Value> {
    let path = safe_session_path(&session_path)?;
    let file = fs::File::open(&path).map_err(|error| format!("failed to open session file: {error}"))?;
    let reader = BufReader::new(file);
    let mut nodes = Vec::<serde_json::Value>::new();
    let mut parent_ids = Vec::<(String, Option<String>)>::new();
    let mut labels = std::collections::HashMap::<String, Option<String>>::new();

    for line in reader.lines().map_while(Result::ok) {
        let value = match serde_json::from_str::<serde_json::Value>(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let entry_type = value.get("type").and_then(|item| item.as_str()).unwrap_or("unknown");
        if entry_type == "label" {
            if let Some(target_id) = value.get("targetId").and_then(|item| item.as_str()) {
                labels.insert(target_id.to_string(), value.get("label").and_then(|item| item.as_str()).map(str::to_string));
            }
            continue;
        }

        let id = value
            .get("id")
            .and_then(|item| item.as_str())
            .or_else(|| if entry_type == "session" { value.get("id").and_then(|item| item.as_str()) } else { None })
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }
        let parent_id = value.get("parentId").and_then(|item| item.as_str()).map(str::to_string);
        let role = value
            .get("message")
            .and_then(|message| message.get("role"))
            .and_then(|item| item.as_str())
            .map(str::to_string);
        let summary = value.get("summary").and_then(|item| item.as_str()).map(str::to_string);
        let title = session_tree_title(entry_type, role.as_deref(), &value);
        nodes.push(serde_json::json!({
            "id": id,
            "parentId": parent_id,
            "type": session_tree_type(entry_type),
            "role": role,
            "title": title,
            "timestamp": value.get("timestamp").and_then(|item| item.as_str()),
            "summary": summary,
            "depth": 0,
            "childrenCount": 0,
            "isLeaf": false
        }));
        parent_ids.push((id, parent_id));
    }

    let mut children_count = std::collections::HashMap::<String, usize>::new();
    for (_, parent_id) in &parent_ids {
        if let Some(parent_id) = parent_id {
            *children_count.entry(parent_id.clone()).or_insert(0) += 1;
        }
    }
    let parent_map = parent_ids.iter().cloned().collect::<std::collections::HashMap<_, _>>();

    for node in &mut nodes {
        let id = node.get("id").and_then(|item| item.as_str()).unwrap_or("").to_string();
        let mut depth = 0usize;
        let mut cursor = parent_map.get(&id).and_then(|item| item.clone());
        while let Some(parent_id) = cursor {
            depth += 1;
            cursor = parent_map.get(&parent_id).and_then(|item| item.clone());
        }
        let count = children_count.get(&id).copied().unwrap_or(0);
        if let Some(object) = node.as_object_mut() {
            object.insert("depth".to_string(), serde_json::json!(depth));
            object.insert("childrenCount".to_string(), serde_json::json!(count));
            object.insert("isLeaf".to_string(), serde_json::json!(count == 0));
            if let Some(Some(label)) = labels.get(&id) {
                object.insert("label".to_string(), serde_json::json!(label));
            }
        }
    }

    let active_leaf_id = nodes
        .iter()
        .rev()
        .find(|node| node.get("isLeaf").and_then(|item| item.as_bool()).unwrap_or(false))
        .and_then(|node| node.get("id").and_then(|item| item.as_str()))
        .map(str::to_string);

    Ok(serde_json::json!({
        "sessionFile": path.to_string_lossy(),
        "activeLeafId": active_leaf_id,
        "nodes": nodes
    }))
}

#[tauri::command]
fn pi_set_session_label(session_path: String, target_id: String, label: Option<String>) -> RpcResult<()> {
    let path = safe_session_path(&session_path)?;
    let file = fs::File::open(&path).map_err(|error| format!("failed to read session file: {error}"))?;
    let reader = BufReader::new(file);
    let mut last_entry_id = None::<String>;
    for line in reader.lines().map_while(Result::ok) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
            if let Some(id) = value.get("id").and_then(|item| item.as_str()) {
                last_entry_id = Some(id.to_string());
            }
        }
    }
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("clock error: {error}"))?
        .as_millis();
    let entry = serde_json::json!({
        "type": "label",
        "id": format!("label-{now_ms}"),
        "parentId": last_entry_id,
        "timestamp": unix_ms_to_iso(now_ms),
        "targetId": target_id,
        "label": label
    });
    let mut file = OpenOptions::new()
        .append(true)
        .open(&path)
        .map_err(|error| format!("failed to append label: {error}"))?;
    writeln!(file, "{}", entry).map_err(|error| format!("failed to write label: {error}"))
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

fn safe_session_path(session_path: &str) -> RpcResult<PathBuf> {
    let sessions_root = default_sessions_root()?
        .canonicalize()
        .map_err(|error| format!("failed to resolve sessions dir: {error}"))?;
    let path = PathBuf::from(session_path)
        .canonicalize()
        .map_err(|error| format!("failed to resolve session path: {error}"))?;
    if !path.starts_with(&sessions_root) || path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
        return Err("session path must be a jsonl file inside pi sessions dir".to_string());
    }
    Ok(path)
}

fn default_sessions_root() -> RpcResult<PathBuf> {
    let home = std::env::var("PI_HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from))
        .or_else(|_| std::env::var("HOME").map(PathBuf::from))
        .map_err(|_| "failed to resolve home directory for pi sessions".to_string())?;
    Ok(home.join(".pi").join("agent").join("sessions"))
}

fn collect_session_files(root: &Path, target_cwd: Option<&str>, sessions: &mut Vec<serde_json::Value>) -> RpcResult<()> {
    if !root.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(root).map_err(|error| format!("failed to read sessions dir {}: {error}", root.display()))? {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.is_dir() {
            collect_session_files(&path, target_cwd, sessions)?;
        } else if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            if let Some(summary) = parse_session_summary(&path, target_cwd) {
                sessions.push(summary);
            }
        }
    }
    Ok(())
}

fn parse_session_summary(path: &Path, target_cwd: Option<&str>) -> Option<serde_json::Value> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut id = String::new();
    let mut cwd = String::new();
    let mut first_user = None::<String>;
    let mut name = None::<String>;
    let mut model = None::<String>;
    let mut updated_at = None::<String>;
    let mut message_count = 0usize;

    for line in reader.lines().map_while(Result::ok) {
        let value = serde_json::from_str::<serde_json::Value>(&line).ok()?;
        if let Some(timestamp) = value.get("timestamp").and_then(|item| item.as_str()) {
            updated_at = Some(timestamp.to_string());
        }

        match value.get("type").and_then(|item| item.as_str()) {
            Some("session") => {
                id = value.get("id").and_then(|item| item.as_str()).unwrap_or("").to_string();
                cwd = value
                    .get("cwd")
                    .and_then(|item| item.as_str())
                    .unwrap_or("")
                    .replace('\\', "/")
                    .trim_end_matches('/')
                    .to_string();
            }
            Some("session_info") => {
                name = value.get("name").and_then(|item| item.as_str()).map(str::to_string);
            }
            Some("model_change") => {
                let provider = value.get("provider").and_then(|item| item.as_str()).unwrap_or("unknown");
                let model_id = value.get("modelId").and_then(|item| item.as_str()).unwrap_or("unknown");
                model = Some(format!("{provider}/{model_id}"));
            }
            Some("message") => {
                message_count += 1;
                let message = value.get("message")?;
                if message.get("role").and_then(|item| item.as_str()) == Some("user") && first_user.is_none() {
                    first_user = extract_session_text(message.get("content")).map(|text| text.chars().take(72).collect());
                }
                if message.get("role").and_then(|item| item.as_str()) == Some("assistant") {
                    if let Some(model_id) = message.get("model").and_then(|item| item.as_str()) {
                        model = Some(model_id.to_string());
                    }
                }
            }
            _ => {}
        }
    }

    if id.is_empty() || target_cwd.is_some_and(|target| normalize_session_path(&cwd) != target) {
        return None;
    }

    let fallback_name = first_user.unwrap_or_else(|| path.file_stem().and_then(|item| item.to_str()).unwrap_or("Untitled session").to_string());
    Some(serde_json::json!({
        "id": id,
        "name": name.unwrap_or(fallback_name),
        "cwd": cwd,
        "updatedAt": updated_at.unwrap_or_else(|| "unknown".to_string()),
        "model": model.unwrap_or_else(|| "unknown".to_string()),
        "status": "idle",
        "filePath": path.to_string_lossy(),
        "messageCount": message_count
    }))
}

fn session_tree_type(entry_type: &str) -> &str {
    match entry_type {
        "session" | "message" | "model_change" | "thinking_level_change" | "compaction" | "branch_summary" | "custom" => entry_type,
        _ => "unknown",
    }
}

fn session_tree_title(entry_type: &str, role: Option<&str>, value: &serde_json::Value) -> String {
    match entry_type {
        "session" => "Session start".to_string(),
        "message" => extract_session_text(value.get("message").and_then(|message| message.get("content")))
            .map(|text| text.chars().take(96).collect())
            .unwrap_or_else(|| role.unwrap_or("message").to_string()),
        "model_change" => format!(
            "Model: {}/{}",
            value.get("provider").and_then(|item| item.as_str()).unwrap_or("unknown"),
            value.get("modelId").and_then(|item| item.as_str()).unwrap_or("unknown")
        ),
        "thinking_level_change" => format!(
            "Thinking: {}",
            value.get("thinkingLevel").and_then(|item| item.as_str()).unwrap_or("unknown")
        ),
        "compaction" => "Compaction".to_string(),
        "branch_summary" => "Branch summary".to_string(),
        _ => entry_type.to_string(),
    }
}

fn unix_ms_to_iso(ms: u128) -> String {
    format!("unix-ms:{ms}")
}

fn normalize_session_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let without_unc_prefix = normalized
        .strip_prefix("//?/")
        .or_else(|| normalized.strip_prefix("/?/"))
        .unwrap_or(&normalized);
    without_unc_prefix.trim_end_matches('/').to_ascii_lowercase()
}

fn extract_session_text(content: Option<&serde_json::Value>) -> Option<String> {
    match content? {
        serde_json::Value::String(value) => Some(value.clone()),
        serde_json::Value::Array(items) => Some(
            items
                .iter()
                .filter_map(|item| item.get("text").and_then(|text| text.as_str()))
                .collect::<Vec<_>>()
                .join("\n"),
        ),
        _ => None,
    }
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
        .plugin(tauri_plugin_dialog::init())
        .manage(RpcState::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            pi_rpc_start,
            pi_rpc_send,
            pi_rpc_stop,
            pi_list_sessions,
            pi_delete_session,
            pi_session_tree,
            pi_set_session_label,
            pi_list_files,
            pi_read_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
