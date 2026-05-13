use std::{
    collections::HashSet,
    fs,
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    path::{Component, Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Emitter, State};

type RpcResult<T> = Result<T, String>;

struct RpcProcess {
    child: Child,
    stdin: ChildStdin,
}

struct SdkSidecarProcess {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
struct RpcState {
    process: Arc<Mutex<Option<RpcProcess>>>,
}

#[derive(Default)]
struct SdkSidecarState {
    process: Arc<Mutex<Option<SdkSidecarProcess>>>,
}

#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "Pi Desktop",
        "goal": "Desktop workbench for pi coding agent"
    })
}

#[tauri::command]
fn app_restart(app: AppHandle) -> RpcResult<()> {
    let exe = std::env::current_exe().map_err(|error| format!("failed to resolve current executable: {error}"))?;
    Command::new(exe)
        .spawn()
        .map_err(|error| format!("failed to restart app: {error}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn pi_models_json_read() -> RpcResult<serde_json::Value> {
    let path = pi_models_json_path()?;
    let content = if path.exists() {
        fs::read_to_string(&path).map_err(|error| format!("failed to read models.json: {error}"))?
    } else {
        default_models_json()
    };
    Ok(serde_json::json!({
        "path": display_path(&path),
        "exists": path.exists(),
        "content": content,
    }))
}

#[tauri::command]
async fn pi_fetch_provider_models(base_url: String, api_key: Option<String>) -> RpcResult<Vec<String>> {
    let client = reqwest::Client::new();
    let key = api_key.and_then(resolve_api_key_value).filter(|value| !value.trim().is_empty());
    let urls = model_list_urls(&base_url);
    let mut last_error = String::new();

    for url in urls {
        let mut request = client.get(&url).header("accept", "application/json");
        if let Some(key) = key.as_ref() {
            request = request.bearer_auth(key);
        }
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                last_error = format!("{url}: request failed: {error}");
                continue;
            }
        };
        let status = response.status();
        let body = match response.text().await {
            Ok(body) => body,
            Err(error) => {
                last_error = format!("{url}: failed to read response: {error}");
                continue;
            }
        };
        if !status.is_success() {
            last_error = format!("{url}: request failed: {status}: {}", body.chars().take(240).collect::<String>());
            continue;
        }
        let value = match serde_json::from_str::<serde_json::Value>(&body) {
            Ok(value) => value,
            Err(error) => {
                let starts = body.chars().take(240).collect::<String>();
                last_error = format!("{url}: response is not JSON: {error}; starts with: {starts}");
                continue;
            }
        };
        let mut models = Vec::<String>::new();
        collect_model_ids(value.get("data"), &mut models);
        collect_model_ids(value.get("models"), &mut models);
        if models.is_empty() {
            last_error = format!("{url}: JSON parsed but no models found");
            continue;
        }
        models.sort();
        models.dedup();
        return Ok(models);
    }

    Err(format!("failed to fetch models. Tried /models, /v1/models, /api/v1/models. Last error: {last_error}"))
}

#[tauri::command]
fn pi_settings_enable_models(models: Vec<String>) -> RpcResult<serde_json::Value> {
    let path = pi_settings_json_path()?;
    let mut settings = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|error| format!("failed to read settings.json: {error}"))?;
        serde_json::from_str::<serde_json::Value>(&content).map_err(|error| format!("settings.json is invalid JSON: {error}"))?
    } else {
        serde_json::json!({})
    };

    if !settings.is_object() {
        settings = serde_json::json!({});
    }

    let object = settings.as_object_mut().ok_or("settings.json root must be object")?;
    let mut enabled = object
        .get("enabledModels")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut added = 0usize;
    for model in models {
        let model = model.trim();
        if model.is_empty() || enabled.iter().any(|item| item == model) {
            continue;
        }
        enabled.push(model.to_string());
        added += 1;
    }

    object.insert(
        "enabledModels".to_string(),
        serde_json::Value::Array(enabled.iter().map(|item| serde_json::Value::String(item.clone())).collect()),
    );

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("failed to create settings.json directory: {error}"))?;
    }
    let content = serde_json::to_string_pretty(&settings).map_err(|error| format!("failed to serialize settings.json: {error}"))?;
    fs::write(&path, format!("{}\n", content)).map_err(|error| format!("failed to write settings.json: {error}"))?;

    Ok(serde_json::json!({
        "path": display_path(&path),
        "enabledModels": enabled,
        "added": added,
    }))
}

#[tauri::command]
fn pi_models_json_write(content: String) -> RpcResult<serde_json::Value> {
    let trimmed = content.trim();
    serde_json::from_str::<serde_json::Value>(trimmed).map_err(|error| format!("models.json is invalid JSON: {error}"))?;
    let path = pi_models_json_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("failed to create models.json directory: {error}"))?;
    }
    fs::write(&path, format!("{}\n", trimmed)).map_err(|error| format!("failed to write models.json: {error}"))?;
    Ok(serde_json::json!({
        "path": display_path(&path),
        "exists": true,
        "content": format!("{}\n", trimmed),
    }))
}

fn pi_models_json_path() -> RpcResult<PathBuf> {
    Ok(pi_agent_dir()?.join("models.json"))
}

fn pi_settings_json_path() -> RpcResult<PathBuf> {
    Ok(pi_agent_dir()?.join("settings.json"))
}

fn pi_agent_dir() -> RpcResult<PathBuf> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .ok_or("failed to resolve home directory for pi settings")?;
    Ok(home.join(".pi").join("agent"))
}

fn model_list_urls(base_url: &str) -> Vec<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut urls = vec![format!("{trimmed}/models")];
    if !trimmed.ends_with("/v1") {
        urls.push(format!("{trimmed}/v1/models"));
    }
    if !trimmed.ends_with("/api/v1") {
        urls.push(format!("{trimmed}/api/v1/models"));
    }
    urls.sort();
    urls.dedup();
    urls
}

fn resolve_api_key_value(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with('!') {
        return None;
    }
    std::env::var(trimmed).ok().or_else(|| Some(trimmed.to_string()))
}

fn collect_model_ids(value: Option<&serde_json::Value>, output: &mut Vec<String>) {
    let Some(serde_json::Value::Array(items)) = value else {
        return;
    };
    for item in items {
        if let Some(id) = item.as_str() {
            output.push(id.to_string());
            continue;
        }
        let id = item
            .get("id")
            .or_else(|| item.get("name"))
            .or_else(|| item.get("model"))
            .and_then(|value| value.as_str());
        if let Some(id) = id.filter(|id| !id.trim().is_empty()) {
            output.push(id.trim().to_string());
        }
    }
}

fn default_models_json() -> String {
    r#"{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "qwen2.5-coder:7b",
          "name": "Qwen 2.5 Coder 7B (Local)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 32000
        }
      ]
    }
  }
}
"#
    .to_string()
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
fn pi_sdk_sidecar_start(app: AppHandle, state: State<'_, SdkSidecarState>) -> RpcResult<()> {
    let mut slot = state.process.lock().map_err(|error| error.to_string())?;
    if slot.is_some() {
        return Ok(());
    }

    let sidecar_bin = std::env::var("PI_SDK_SIDECAR_BIN").unwrap_or_else(|_| default_node_bin());
    let sidecar_script = std::env::var("PI_SDK_SIDECAR_SCRIPT").unwrap_or_else(|_| "src-sidecar/pi-sdk-sidecar.mjs".to_string());
    let mut child = Command::new(sidecar_bin)
        .arg(sidecar_script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start pi sdk sidecar: {error}"))?;

    let stdin = child.stdin.take().ok_or("failed to open pi sdk sidecar stdin")?;
    let stdout = child.stdout.take().ok_or("failed to open pi sdk sidecar stdout")?;
    let stderr = child.stderr.take().ok_or("failed to open pi sdk sidecar stderr")?;

    spawn_named_stdout_reader(app.clone(), "pi-sdk-sidecar-message", "pi-sdk-sidecar-error", stdout);
    spawn_named_stderr_reader(app, "pi-sdk-sidecar-stderr", "pi-sdk-sidecar-error", stderr);

    *slot = Some(SdkSidecarProcess { child, stdin });
    Ok(())
}

#[tauri::command]
fn pi_sdk_sidecar_send(state: State<'_, SdkSidecarState>, message: String) -> RpcResult<()> {
    let mut slot = state.process.lock().map_err(|error| error.to_string())?;
    let process = slot.as_mut().ok_or("pi sdk sidecar is not running")?;
    process
        .stdin
        .write_all(message.as_bytes())
        .map_err(|error| format!("failed to write pi sdk sidecar stdin: {error}"))?;
    process
        .stdin
        .write_all(b"\n")
        .map_err(|error| format!("failed to write pi sdk sidecar newline: {error}"))?;
    process
        .stdin
        .flush()
        .map_err(|error| format!("failed to flush pi sdk sidecar stdin: {error}"))?;
    Ok(())
}

#[tauri::command]
fn pi_sdk_sidecar_stop(state: State<'_, SdkSidecarState>) -> RpcResult<()> {
    let mut slot = state.process.lock().map_err(|error| error.to_string())?;
    if let Some(mut process) = slot.take() {
        process
            .child
            .kill()
            .map_err(|error| format!("failed to kill pi sdk sidecar: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn pi_list_sessions(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(move || pi_list_sessions_blocking(cwd))
        .await
        .map_err(|error| format!("list sessions task failed: {error}"))?
}

fn pi_list_sessions_blocking(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
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

fn find_tool_call_arguments_by_id(content: &serde_json::Value, tool_call_id: Option<&str>) -> serde_json::Value {
    let Some(blocks) = content.as_array() else {
        return serde_json::Value::Null;
    };
    blocks
        .iter()
        .find(|block| {
            block.get("type").and_then(|item| item.as_str()) == Some("toolCall")
                && tool_call_id.map(|id| block.get("id").and_then(|item| item.as_str()) == Some(id)).unwrap_or(true)
        })
        .and_then(|block| block.get("arguments"))
        .cloned()
        .unwrap_or(serde_json::Value::Null)
}

fn find_assistant_tool_args(messages: &[serde_json::Value], parent_id: Option<&str>, tool_call_id: Option<&str>) -> serde_json::Value {
    let Some(parent_id) = parent_id else {
        return serde_json::Value::Null;
    };
    messages
        .iter()
        .rev()
        .find(|entry| entry.get("id").and_then(|item| item.as_str()) == Some(parent_id))
        .and_then(|entry| entry.get("message"))
        .and_then(|message| message.get("content"))
        .map(|content| find_tool_call_arguments_by_id(content, tool_call_id))
        .unwrap_or(serde_json::Value::Null)
}

#[tauri::command]
async fn pi_read_session_messages(session_path: String) -> RpcResult<Vec<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(move || pi_read_session_messages_blocking(session_path))
        .await
        .map_err(|error| format!("read session messages task failed: {error}"))?
}

fn pi_read_session_messages_blocking(session_path: String) -> RpcResult<Vec<serde_json::Value>> {
    let path = safe_session_path(&session_path)?;
    let file = fs::File::open(&path).map_err(|error| format!("failed to open session file: {error}"))?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();

    for line in reader.lines().map_while(Result::ok) {
        let value = match serde_json::from_str::<serde_json::Value>(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if value.get("type").and_then(|item| item.as_str()) == Some("message") {
            entries.push(value);
        }
    }

    let mut messages = Vec::new();
    let mut hidden_commit_generation_ids = HashSet::new();

    for value in &entries {
        let entry_id = value.get("id").or_else(|| value.get("entryId")).and_then(|item| item.as_str());
        let parent_id_for_filter = value.get("parentId").and_then(|item| item.as_str());
        if parent_id_for_filter.map(|id| hidden_commit_generation_ids.contains(id)).unwrap_or(false) {
            if let Some(id) = entry_id {
                hidden_commit_generation_ids.insert(id.to_string());
            }
            continue;
        }
        let message = match value.get("message") {
            Some(message) => message,
            None => continue,
        };
        let role = match message.get("role").and_then(|item| item.as_str()) {
            Some("user") => "user",
            Some("assistant") => "assistant",
            Some("system") => "system",
            Some("toolResult") => "toolResult",
            Some("bashExecution") => "bashExecution",
            Some("custom") => "custom",
            Some("branchSummary") => "branchSummary",
            Some("compactionSummary") => "compactionSummary",
            _ => continue,
        };
        let content = match role {
            "branchSummary" => message.get("summary").and_then(|item| item.as_str()).map(str::to_string).unwrap_or_default(),
            "compactionSummary" => message.get("summary").and_then(|item| item.as_str()).map(str::to_string).unwrap_or_default(),
            "bashExecution" => message.get("output").and_then(|item| item.as_str()).map(str::to_string).unwrap_or_default(),
            _ => extract_session_text(message.get("content")).unwrap_or_default(),
        };
        if role == "user" && content.starts_with("Staged git diff for commit message generation.") {
            if let Some(id) = entry_id {
                hidden_commit_generation_ids.insert(id.to_string());
            }
            continue;
        }
        if role == "assistant" && content.trim().is_empty() && message.get("content").and_then(|item| item.as_array()).map(|items| items.is_empty()).unwrap_or(true) {
            continue;
        }
        let id = value
            .get("id")
            .or_else(|| value.get("entryId"))
            .and_then(|item| item.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{}:{}", path.to_string_lossy(), messages.len()));
        let created_at = value
            .get("timestamp")
            .and_then(|item| item.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| "--:--".to_string());
        let tool_call_id = message.get("toolCallId").and_then(|item| item.as_str());
        let parent_id = value.get("parentId").and_then(|item| item.as_str());
        let tool_args = if role == "toolResult" {
            find_assistant_tool_args(&entries, parent_id, tool_call_id)
        } else {
            serde_json::Value::Null
        };
        messages.push(serde_json::json!({
            "id": id,
            "role": role,
            "content": content,
            "contentBlocks": message.get("content").cloned().unwrap_or(serde_json::Value::Null),
            "toolArgs": tool_args,
            "toolDetails": message.get("details").cloned().unwrap_or(serde_json::Value::Null),
            "createdAt": created_at,
            "stopReason": message.get("stopReason").cloned().unwrap_or(serde_json::Value::Null),
            "errorMessage": message.get("errorMessage").cloned().unwrap_or(serde_json::Value::Null),
            "customType": message.get("customType").cloned().unwrap_or(serde_json::Value::Null),
            "tokensBefore": message.get("tokensBefore").cloned().unwrap_or(serde_json::Value::Null),
            "toolName": message.get("toolName").cloned().unwrap_or(serde_json::Value::Null),
            "toolCallId": message.get("toolCallId").cloned().unwrap_or(serde_json::Value::Null),
            "isError": message.get("isError").cloned().unwrap_or(serde_json::Value::Null),
            "cancelled": message.get("cancelled").cloned().unwrap_or(serde_json::Value::Null),
            "truncated": message.get("truncated").cloned().unwrap_or(serde_json::Value::Null),
            "fullOutputPath": message.get("fullOutputPath").cloned().unwrap_or(serde_json::Value::Null),
            "excludeFromContext": message.get("excludeFromContext").cloned().unwrap_or(serde_json::Value::Null)
        }));
    }

    Ok(messages)
}

#[tauri::command]
fn pi_open_project_with(path: String, target: String) -> RpcResult<()> {
    let project_path = safe_root(&path)?;
    match target.as_str() {
        "terminal" => open_terminal(&project_path),
        "vscode" => open_editor(&project_path, "vscode", "code", "Code.exe"),
        "cursor" => open_editor(&project_path, "cursor", "cursor", "Cursor.exe"),
        _ => Err(format!("unsupported open target: {target}")),
    }
}

#[tauri::command]
fn pi_delete_session(session_path: String) -> RpcResult<()> {
    let path = safe_session_path(&session_path)?;
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(path).map_err(|error| format!("failed to delete session: {error}"))
}

#[tauri::command]
async fn pi_session_tree(session_path: String) -> RpcResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || pi_session_tree_blocking(session_path))
        .await
        .map_err(|error| format!("session tree task failed: {error}"))?
}

fn pi_session_tree_blocking(session_path: String) -> RpcResult<serde_json::Value> {
    let path = safe_session_path(&session_path)?;
    let file = fs::File::open(&path).map_err(|error| format!("failed to open session file: {error}"))?;
    let reader = BufReader::new(file);
    let mut nodes = Vec::<serde_json::Value>::new();
    let mut parent_ids = Vec::<(String, Option<String>)>::new();
    let mut labels = std::collections::HashMap::<String, Option<String>>::new();
    let mut parent_session = None::<String>;

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
        if entry_type == "session" {
            parent_session = value.get("parentSession").and_then(|item| item.as_str()).map(str::to_string);
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
        "parentSession": parent_session,
        "activeLeafId": active_leaf_id,
        "activeLeafSource": "jsonl-inferred",
        "activeLeafNote": "pi RPC does not expose current tree cursor; active leaf is inferred from JSONL leaf entries. Use SDK SessionManager.getLeafEntry() later for exact cursor.",
        "nodes": nodes
    }))
}

#[tauri::command]
async fn pi_set_session_label(session_path: String, target_id: String, label: Option<String>) -> RpcResult<()> {
    tauri::async_runtime::spawn_blocking(move || pi_set_session_label_blocking(session_path, target_id, label))
        .await
        .map_err(|error| format!("set session label task failed: {error}"))?
}

fn pi_set_session_label_blocking(session_path: String, target_id: String, label: Option<String>) -> RpcResult<()> {
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
async fn pi_list_files(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(move || pi_list_files_blocking(cwd))
        .await
        .map_err(|error| format!("list files task failed: {error}"))?
}

fn pi_list_files_blocking(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
    let root = safe_root(&cwd)?;
    let mut entries = Vec::new();
    collect_files(&root, &root, 0, &mut entries)?;
    Ok(entries)
}

#[tauri::command]
async fn pi_read_file(cwd: String, path: String) -> RpcResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || pi_read_file_blocking(cwd, path))
        .await
        .map_err(|error| format!("read file task failed: {error}"))?
}

fn pi_read_file_blocking(cwd: String, path: String) -> RpcResult<serde_json::Value> {
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

#[tauri::command]
async fn pi_git_status(cwd: String) -> RpcResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || pi_git_status_blocking(cwd))
        .await
        .map_err(|error| format!("git status task failed: {error}"))?
}

fn pi_git_status_blocking(cwd: String) -> RpcResult<serde_json::Value> {
    let repo_root = git_repo_root(&cwd)?;
    let output = git_output(&repo_root, &["status", "--porcelain=v1", "-b"])?;
    let mut branch = "HEAD".to_string();
    let mut upstream = None::<String>;
    let mut ahead = 0usize;
    let mut behind = 0usize;
    let mut files = Vec::<serde_json::Value>::new();
    let mut staged = 0usize;
    let mut unstaged = 0usize;
    let mut untracked = 0usize;

    for line in output.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            let (next_branch, next_upstream, next_ahead, next_behind) = parse_git_branch_header(header);
            branch = next_branch;
            upstream = next_upstream;
            ahead = next_ahead;
            behind = next_behind;
            continue;
        }
        if line.len() < 4 {
            continue;
        }
        let index_status = line.chars().next().unwrap_or(' ');
        let worktree_status = line.chars().nth(1).unwrap_or(' ');
        let raw_path = line.get(3..).unwrap_or("");
        let (path, original_path) = parse_git_status_path(raw_path);
        if path.is_empty() {
            continue;
        }
        if index_status != ' ' && index_status != '?' {
            staged += 1;
        }
        if worktree_status != ' ' || index_status == '?' {
            unstaged += 1;
        }
        if index_status == '?' {
            untracked += 1;
        }
        files.push(serde_json::json!({
            "path": path,
            "originalPath": original_path,
            "indexStatus": index_status.to_string(),
            "worktreeStatus": worktree_status.to_string()
        }));
    }

    Ok(serde_json::json!({
        "repoRoot": display_path(&repo_root),
        "branch": branch,
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
        "staged": staged,
        "unstaged": unstaged,
        "untracked": untracked,
        "files": files
    }))
}

#[tauri::command]
async fn pi_git_log(cwd: String, limit: Option<usize>) -> RpcResult<Vec<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(move || pi_git_log_blocking(cwd, limit))
        .await
        .map_err(|error| format!("git log task failed: {error}"))?
}

fn pi_git_log_blocking(cwd: String, limit: Option<usize>) -> RpcResult<Vec<serde_json::Value>> {
    let repo_root = git_repo_root(&cwd)?;
    let limit_arg = format!("-n{}", limit.unwrap_or(40).clamp(1, 200));
    let output = git_output(
        &repo_root,
        &[
            "log",
            "--date-order",
            "--decorate=short",
            "--pretty=format:%H%x1f%h%x1f%an%x1f%s%x1f%D",
            &limit_arg,
        ],
    )?;
    Ok(output
        .lines()
        .filter_map(parse_git_log_line)
        .collect())
}

#[tauri::command]
async fn pi_git_action(cwd: String, action: String, path: Option<String>) -> RpcResult<()> {
    tauri::async_runtime::spawn_blocking(move || pi_git_action_blocking(cwd, action, path))
        .await
        .map_err(|error| format!("git action task failed: {error}"))?
}

fn pi_git_action_blocking(cwd: String, action: String, path: Option<String>) -> RpcResult<()> {
    let repo_root = git_repo_root(&cwd)?;
    match (action.as_str(), path.as_deref()) {
        ("stage", Some(file_path)) => {
            safe_git_relative_path(file_path)?;
            git_status(&repo_root, &["add", "--", file_path])
        }
        ("stage", None) => git_status(&repo_root, &["add", "-A"]),
        ("unstage", Some(file_path)) => {
            safe_git_relative_path(file_path)?;
            git_status(&repo_root, &["restore", "--staged", "--", file_path])
        }
        ("unstage", None) => git_status(&repo_root, &["restore", "--staged", "."]),
        ("discard", Some(file_path)) => {
            safe_git_relative_path(file_path)?;
            if is_untracked_file(&repo_root, file_path)? {
                git_status(&repo_root, &["clean", "-fd", "--", file_path])
            } else {
                git_status(&repo_root, &["restore", "--", file_path])
            }
        }
        _ => Err("unsupported git action".to_string()),
    }
}

#[tauri::command]
async fn pi_git_sync(cwd: String) -> RpcResult<()> {
    tauri::async_runtime::spawn_blocking(move || pi_git_sync_blocking(cwd))
        .await
        .map_err(|error| format!("git sync task failed: {error}"))?
}

fn pi_git_sync_blocking(cwd: String) -> RpcResult<()> {
    let repo_root = git_repo_root(&cwd)?;
    let status = pi_git_status_blocking(cwd)?;
    let ahead = status.get("ahead").and_then(|value| value.as_u64()).unwrap_or(0);
    let behind = status.get("behind").and_then(|value| value.as_u64()).unwrap_or(0);
    if behind > 0 {
        git_status(&repo_root, &["pull", "--ff-only"])?;
    }
    if ahead > 0 {
        git_status(&repo_root, &["push"])?;
    }
    Ok(())
}

#[tauri::command]
async fn pi_git_commit(cwd: String, message: String) -> RpcResult<()> {
    tauri::async_runtime::spawn_blocking(move || pi_git_commit_blocking(cwd, message))
        .await
        .map_err(|error| format!("git commit task failed: {error}"))?
}

fn pi_git_commit_blocking(cwd: String, message: String) -> RpcResult<()> {
    let repo_root = git_repo_root(&cwd)?;
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("commit message is required".to_string());
    }
    git_status(&repo_root, &["commit", "-m", trimmed])
}

#[tauri::command]
async fn pi_git_generate_commit_message(cwd: String, model: Option<String>, thinking_level: Option<String>) -> RpcResult<String> {
    tauri::async_runtime::spawn_blocking(move || pi_git_generate_commit_message_blocking(cwd, model, thinking_level))
        .await
        .map_err(|error| format!("git commit message task failed: {error}"))?
}

fn pi_git_generate_commit_message_blocking(cwd: String, model: Option<String>, thinking_level: Option<String>) -> RpcResult<String> {
    let repo_root = git_repo_root(&cwd)?;
    let stat = git_output(&repo_root, &["diff", "--cached", "--stat"])?;
    let diff = git_output(&repo_root, &["diff", "--cached", "--no-ext-diff", "--"])?;
    if stat.trim().is_empty() && diff.trim().is_empty() {
        return Err("stage changes before generating a commit message".to_string());
    }

    let mut context = String::new();
    context.push_str("Staged git diff for commit message generation.\n\n");
    context.push_str("STAT:\n");
    context.push_str(&stat);
    context.push_str("\n\nDIFF:\n");
    context.push_str(&truncate_for_prompt(&diff, 80_000));

    let prompt = "Generate a git commit message for the staged diff from stdin. Output only one concise commit subject line, imperative mood, <=72 characters. Prefer Conventional Commits when obvious. No markdown, no quotes, no explanation.";
    let pi_bin = std::env::var("PI_BIN").unwrap_or_else(|_| default_pi_bin());
    let mut args = vec!["--no-tools".to_string(), "--no-session".to_string()];
    if let Some(model) = model.as_deref().map(str::trim).filter(|value| !value.is_empty() && *value != "no model") {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    if let Some(level) = thinking_level.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        args.push("--thinking".to_string());
        args.push(level.to_string());
    }
    args.push("-p".to_string());
    args.push(prompt.to_string());

    let mut child = Command::new(pi_bin)
        .args(args)
        .current_dir(&repo_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start pi for commit message: {error}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(context.as_bytes())
            .map_err(|error| format!("failed to send diff to pi: {error}"))?;
    }

    let output = wait_with_output_timeout(child, Duration::from_secs(90))
        .map_err(|error| format!("failed to wait for pi commit message: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() { "pi failed to generate commit message".to_string() } else { stderr });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let message = clean_commit_message(&stdout);
    if message.is_empty() {
        return Err("pi returned an empty commit message".to_string());
    }
    Ok(message)
}

fn wait_with_output_timeout(mut child: Child, timeout: Duration) -> std::io::Result<std::process::Output> {
    let started = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output();
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let output = child.wait_with_output()?;
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!("process timed out after {}s; stderr: {}", timeout.as_secs(), String::from_utf8_lossy(&output.stderr).trim()),
            ));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn truncate_for_prompt(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut truncated = text.chars().take(max_chars).collect::<String>();
    truncated.push_str("\n\n[diff truncated]\n");
    truncated
}

fn clean_commit_message(output: &str) -> String {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("```") && !line.starts_with("["))
        .next()
        .unwrap_or("")
        .trim_matches(|ch| ch == '"' || ch == '\'' || ch == '`')
        .chars()
        .take(120)
        .collect::<String>()
}

fn spawn_stdout_reader(app: AppHandle, stdout: std::process::ChildStdout) {
    spawn_named_stdout_reader(app, "pi-rpc-message", "pi-rpc-error", stdout);
}

fn spawn_named_stdout_reader(app: AppHandle, message_event: &'static str, error_event: &'static str, stdout: std::process::ChildStdout) {
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    let trimmed = line.strip_suffix('\r').unwrap_or(&line);
                    match serde_json::from_str::<serde_json::Value>(trimmed) {
                        Ok(value) => {
                            let _ = app.emit(message_event, value);
                        }
                        Err(error) => {
                            let _ = app.emit(
                                error_event,
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
                        error_event,
                        serde_json::json!({"source": "stdout", "error": error.to_string()}),
                    );
                    break;
                }
            }
        }
    });
}

fn spawn_stderr_reader(app: AppHandle, stderr: std::process::ChildStderr) {
    spawn_named_stderr_reader(app, "pi-rpc-stderr", "pi-rpc-error", stderr);
}

fn spawn_named_stderr_reader(app: AppHandle, stderr_event: &'static str, error_event: &'static str, stderr: std::process::ChildStderr) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    let trimmed = line.strip_suffix('\r').unwrap_or(&line);
                    if !trimmed.trim().is_empty() {
                        let _ = app.emit(
                            stderr_event,
                            serde_json::json!({"line": trimmed}),
                        );
                    }
                }
                Err(error) => {
                    let _ = app.emit(
                        error_event,
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
    let candidate = PathBuf::from(session_path);
    let path = if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|error| format!("failed to resolve session path: {error}"))?
    } else {
        candidate
    };
    let normalized_root = normalize_session_path(&sessions_root.to_string_lossy());
    let normalized_path = normalize_session_path(&path.to_string_lossy());
    if !normalized_path.starts_with(&normalized_root) || path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
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
    let candidate = if root.is_absolute() {
        root
    } else {
        std::env::current_dir()
            .map_err(|error| format!("failed to resolve current dir: {error}"))?
            .join(root)
    };
    candidate
        .canonicalize()
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

fn parse_git_log_line(line: &str) -> Option<serde_json::Value> {
    let mut parts = line.split('\u{1f}');
    let hash = parts.next()?.to_string();
    let short_hash = parts.next()?.to_string();
    let author = parts.next()?.to_string();
    let subject = parts.next()?.to_string();
    let refs = parts.next().map(str::to_string).filter(|value| !value.trim().is_empty());
    Some(serde_json::json!({
        "hash": hash,
        "shortHash": short_hash,
        "author": author,
        "subject": subject,
        "refs": refs
    }))
}

fn git_repo_root(cwd: &str) -> RpcResult<PathBuf> {
    let mut errors = Vec::<String>::new();
    for candidate in git_root_candidates(cwd) {
        match git_output(&candidate, &["rev-parse", "--show-toplevel"]) {
            Ok(output) => {
                return PathBuf::from(output.trim())
                    .canonicalize()
                    .map_err(|error| format!("failed to resolve git repo root: {error}"));
            }
            Err(error) => errors.push(format!("{}: {error}", candidate.display())),
        }
    }
    Err(format!("failed to locate git repository. cwd={cwd}. tried: {}", errors.join(" | ")))
}

fn git_root_candidates(cwd: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::<PathBuf>::new();
    let mut push_candidate = |path: PathBuf| {
        if path.exists() && !candidates.iter().any(|item| item == &path) {
            candidates.push(path);
        }
    };

    let trimmed = cwd.trim();
    if !trimmed.is_empty() && trimmed != "unknown cwd" {
        if let Ok(path) = safe_root(trimmed) {
            push_candidate(path);
        }
    }

    if let Ok(current) = std::env::current_dir().and_then(|path| path.canonicalize()) {
        push_candidate(current.clone());
        for ancestor in current.ancestors().skip(1) {
            push_candidate(ancestor.to_path_buf());
        }
    }

    candidates
}

fn git_output(cwd: &Path, args: &[&str]) -> RpcResult<String> {
    let child = Command::new(default_git_bin())
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to run git: {error}"))?;
    let output = wait_with_output_timeout(child, Duration::from_secs(30))
        .map_err(|error| format!("git command timed out or failed: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() { "git command failed".to_string() } else { stderr })
    }
}

fn git_status(cwd: &Path, args: &[&str]) -> RpcResult<()> {
    git_output(cwd, args).map(|_| ())
}

fn parse_git_branch_header(header: &str) -> (String, Option<String>, usize, usize) {
    let mut subject = header;
    let mut meta = "";
    if let Some((left, right)) = header.split_once('[') {
        subject = left.trim();
        meta = right.trim_end_matches(']').trim();
    }
    let (branch, upstream) = if let Some((left, right)) = subject.split_once("...") {
        (left.trim().to_string(), Some(right.trim().to_string()))
    } else {
        (subject.trim().to_string(), None)
    };
    let mut ahead = 0usize;
    let mut behind = 0usize;
    for part in meta.split(',').map(str::trim) {
        if let Some(value) = part.strip_prefix("ahead ") {
            ahead = value.parse().unwrap_or(0);
        }
        if let Some(value) = part.strip_prefix("behind ") {
            behind = value.parse().unwrap_or(0);
        }
    }
    (branch, upstream, ahead, behind)
}

fn parse_git_status_path(raw_path: &str) -> (String, Option<String>) {
    let cleaned = raw_path.trim().trim_matches('"').replace('\\', "/");
    if let Some((left, right)) = cleaned.split_once(" -> ") {
        (right.trim_matches('"').to_string(), Some(left.trim_matches('"').to_string()))
    } else {
        (cleaned, None)
    }
}

fn safe_git_relative_path(path: &str) -> RpcResult<()> {
    let requested = Path::new(path);
    if requested.is_absolute() || path.trim().is_empty() {
        return Err("git path must be relative".to_string());
    }
    if requested.components().any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
        return Err("git path must stay inside repository".to_string());
    }
    Ok(())
}

fn is_untracked_file(repo_root: &Path, path: &str) -> RpcResult<bool> {
    let output = git_output(repo_root, &["status", "--porcelain=v1", "--", path])?;
    Ok(output.lines().any(|line| line.starts_with("?? ")))
}

fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    value
        .strip_prefix("//?/")
        .or_else(|| value.strip_prefix("/?/"))
        .unwrap_or(&value)
        .to_string()
}

fn open_editor(path: &Path, target: &str, cli_name: &str, exe_name: &str) -> RpcResult<()> {
    let path_arg = path.to_string_lossy().to_string();
    spawn_app(cli_name, std::slice::from_ref(&path_arg))
        .or_else(|_| open_editor_from_registry(path, target))
        .or_else(|_| open_editor_from_common_paths(path, exe_name))
}

#[cfg(windows)]
fn open_editor_from_registry(path: &Path, target: &str) -> RpcResult<()> {
    let needle = if target == "cursor" { "cursor" } else { "code" };
    let keys = [
        r"HKCU\Software\Classes\Directory\shell",
        r"HKCR\Directory\shell",
        r"HKCU\Software\Classes\Directory\Background\shell",
        r"HKCR\Directory\Background\shell",
    ];
    for root in keys {
        let output = Command::new("reg.exe")
            .args(["query", root, "/s"])
            .output()
            .map_err(|error| format!("failed to query registry: {error}"))?;
        let text = String::from_utf8_lossy(&output.stdout);
        if !text.to_lowercase().contains(needle) {
            continue;
        }
        for line in text.lines() {
            let lower = line.to_lowercase();
            if !lower.contains("reg_sz") || !lower.contains(needle) || !(lower.contains("%1") || lower.contains("%v")) {
                continue;
            }
            let command = line.split_once("REG_SZ").map(|(_, value)| value.trim()).unwrap_or(line.trim());
            return run_shell_command(command, path);
        }
    }
    Err(format!("failed to find {target} registry open command"))
}

#[cfg(not(windows))]
fn open_editor_from_registry(_path: &Path, target: &str) -> RpcResult<()> {
    Err(format!("registry open command unsupported for {target}"))
}

#[cfg(windows)]
fn open_editor_from_common_paths(path: &Path, exe_name: &str) -> RpcResult<()> {
    let mut candidates = Vec::new();
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(&local_app_data).join("Programs").join("Microsoft VS Code").join("Code.exe"));
        candidates.push(PathBuf::from(&local_app_data).join("Programs").join("Cursor").join("Cursor.exe"));
    }
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        candidates.push(PathBuf::from(&program_files).join("Microsoft VS Code").join("Code.exe"));
        candidates.push(PathBuf::from(&program_files).join("Cursor").join("Cursor.exe"));
    }
    for candidate in candidates.into_iter().filter(|candidate| candidate.file_name().and_then(|name| name.to_str()) == Some(exe_name)) {
        if candidate.exists() {
            return Command::new(candidate)
                .arg(path)
                .spawn()
                .map(|_| ())
                .map_err(|error| format!("failed to open {exe_name}: {error}"));
        }
    }
    Err(format!("failed to find {exe_name}"))
}

#[cfg(not(windows))]
fn open_editor_from_common_paths(_path: &Path, exe_name: &str) -> RpcResult<()> {
    Err(format!("failed to find {exe_name}"))
}

#[cfg(windows)]
fn run_shell_command(command: &str, path: &Path) -> RpcResult<()> {
    let path_value = path.to_string_lossy();
    let replaced = command.replace("%1", &path_value).replace("%V", &path_value).replace("%v", &path_value);
    Command::new("cmd.exe")
        .args(["/C", "start", "", &replaced])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to run registry command: {error}"))
}

fn open_terminal(path: &Path) -> RpcResult<()> {
    if cfg!(windows) {
        let args = vec!["-NoExit".to_string(), "-Command".to_string(), format!("Set-Location -LiteralPath '{}'", path.to_string_lossy().replace("'", "''''"))];
        spawn_app("wt.exe", &["-d".to_string(), path.to_string_lossy().to_string()])
            .or_else(|_| spawn_app("powershell.exe", &args))
    } else if cfg!(target_os = "macos") {
        let script = format!("tell application \"Terminal\" to do script \"cd '{}'\"", path.to_string_lossy().replace("'", "'\\''"));
        spawn_app("osascript", &["-e".to_string(), script])
    } else {
        spawn_app("xdg-terminal-exec", &[path.to_string_lossy().to_string()])
            .or_else(|_| spawn_app("gnome-terminal", &["--working-directory".to_string(), path.to_string_lossy().to_string()]))
            .or_else(|_| spawn_app("konsole", &["--workdir".to_string(), path.to_string_lossy().to_string()]))
    }
}

fn spawn_app(program: &str, args: &[String]) -> RpcResult<()> {
    Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to open {program}: {error}"))
}

fn default_git_bin() -> String {
    if cfg!(windows) {
        "git.exe".to_string()
    } else {
        "git".to_string()
    }
}

fn default_node_bin() -> String {
    if cfg!(windows) {
        "node.exe".to_string()
    } else {
        "node".to_string()
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
        .manage(SdkSidecarState::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            app_restart,
            pi_models_json_read,
            pi_models_json_write,
            pi_fetch_provider_models,
            pi_settings_enable_models,
            pi_rpc_start,
            pi_rpc_send,
            pi_rpc_stop,
            pi_sdk_sidecar_start,
            pi_sdk_sidecar_send,
            pi_sdk_sidecar_stop,
            pi_list_sessions,
            pi_read_session_messages,
            pi_open_project_with,
            pi_delete_session,
            pi_session_tree,
            pi_set_session_label,
            pi_list_files,
            pi_read_file,
            pi_git_status,
            pi_git_log,
            pi_git_action,
            pi_git_sync,
            pi_git_commit,
            pi_git_generate_commit_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
