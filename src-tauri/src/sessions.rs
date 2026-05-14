use super::*;
use std::sync::OnceLock;

#[derive(Clone)]
pub(crate) struct SessionSummaryCacheEntry {
    modified_ms: u128,
    len: u64,
    summary: serde_json::Value,
}

static SESSION_SUMMARY_CACHE: OnceLock<Mutex<HashMap<String, SessionSummaryCacheEntry>>> = OnceLock::new();

fn session_summary_cache() -> &'static Mutex<HashMap<String, SessionSummaryCacheEntry>> {
    SESSION_SUMMARY_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub(crate) async fn pi_list_sessions(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(move || pi_list_sessions_blocking(cwd))
        .await
        .map_err(|error| format!("list sessions task failed: {error}"))?
}

pub(crate) fn pi_list_sessions_blocking(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
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

pub(crate) fn find_tool_call_arguments_by_id(content: &serde_json::Value, tool_call_id: Option<&str>) -> serde_json::Value {
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

pub(crate) fn find_assistant_tool_args(messages: &[serde_json::Value], parent_id: Option<&str>, tool_call_id: Option<&str>) -> serde_json::Value {
    if let Some(parent_id) = parent_id {
        let mut current_parent_id = Some(parent_id);
        while let Some(id) = current_parent_id {
            let Some(entry) = messages.iter().rev().find(|entry| entry.get("id").and_then(|item| item.as_str()) == Some(id)) else {
                break;
            };
            if let Some(content) = entry.get("message").and_then(|message| message.get("content")) {
                let args = find_tool_call_arguments_by_id(content, tool_call_id);
                if !args.is_null() {
                    return args;
                }
            }
            current_parent_id = entry.get("parentId").and_then(|item| item.as_str());
        }
    }

    messages
        .iter()
        .rev()
        .filter_map(|entry| entry.get("message").and_then(|message| message.get("content")))
        .map(|content| find_tool_call_arguments_by_id(content, tool_call_id))
        .find(|args| !args.is_null())
        .unwrap_or(serde_json::Value::Null)
}

#[tauri::command]
pub(crate) async fn pi_read_session_messages(session_path: String) -> RpcResult<Vec<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(move || pi_read_session_messages_blocking(session_path))
        .await
        .map_err(|error| format!("read session messages task failed: {error}"))?
}

pub(crate) fn pi_read_session_messages_blocking(session_path: String) -> RpcResult<Vec<serde_json::Value>> {
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
pub(crate) fn pi_delete_session(session_path: String) -> RpcResult<()> {
    let path = safe_session_path(&session_path)?;
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(path).map_err(|error| format!("failed to delete session: {error}"))
}

#[tauri::command]
pub(crate) async fn pi_session_tree(session_path: String) -> RpcResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || pi_session_tree_blocking(session_path))
        .await
        .map_err(|error| format!("session tree task failed: {error}"))?
}

pub(crate) fn pi_session_tree_blocking(session_path: String) -> RpcResult<serde_json::Value> {
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
pub(crate) async fn pi_set_session_label(session_path: String, target_id: String, label: Option<String>) -> RpcResult<()> {
    tauri::async_runtime::spawn_blocking(move || pi_set_session_label_blocking(session_path, target_id, label))
        .await
        .map_err(|error| format!("set session label task failed: {error}"))?
}

pub(crate) fn pi_set_session_label_blocking(session_path: String, target_id: String, label: Option<String>) -> RpcResult<()> {
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

pub(crate) fn safe_session_path(session_path: &str) -> RpcResult<PathBuf> {
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

pub(crate) fn default_sessions_root() -> RpcResult<PathBuf> {
    let home = std::env::var("PI_HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from))
        .or_else(|_| std::env::var("HOME").map(PathBuf::from))
        .map_err(|_| "failed to resolve home directory for pi sessions".to_string())?;
    Ok(home.join(".pi").join("agent").join("sessions"))
}

pub(crate) fn collect_session_files(root: &Path, target_cwd: Option<&str>, sessions: &mut Vec<serde_json::Value>) -> RpcResult<()> {
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
            if let Some(summary) = parse_session_summary_cached(&path, target_cwd) {
                sessions.push(summary);
            }
        }
    }
    Ok(())
}

pub(crate) fn parse_session_summary_cached(path: &Path, target_cwd: Option<&str>) -> Option<serde_json::Value> {
    let metadata = fs::metadata(path).ok()?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let len = metadata.len();
    let key = normalize_session_path(&path.to_string_lossy());

    if let Ok(cache) = session_summary_cache().lock() {
        if let Some(entry) = cache.get(&key) {
            if entry.modified_ms == modified_ms && entry.len == len {
                return filter_session_summary(entry.summary.clone(), target_cwd);
            }
        }
    }

    let summary = parse_session_summary_uncached(path)?;
    if let Ok(mut cache) = session_summary_cache().lock() {
        cache.insert(
            key,
            SessionSummaryCacheEntry {
                modified_ms,
                len,
                summary: summary.clone(),
            },
        );
    }
    filter_session_summary(summary, target_cwd)
}

pub(crate) fn filter_session_summary(summary: serde_json::Value, target_cwd: Option<&str>) -> Option<serde_json::Value> {
    if target_cwd.is_some_and(|target| summary.get("cwd").and_then(|value| value.as_str()).map(normalize_session_path).as_deref() != Some(target)) {
        return None;
    }
    Some(summary)
}

pub(crate) fn parse_session_summary_uncached(path: &Path) -> Option<serde_json::Value> {
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

    if id.is_empty() {
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

pub(crate) fn session_tree_type(entry_type: &str) -> &str {
    match entry_type {
        "session" | "message" | "model_change" | "thinking_level_change" | "compaction" | "branch_summary" | "custom" => entry_type,
        _ => "unknown",
    }
}

pub(crate) fn session_tree_title(entry_type: &str, role: Option<&str>, value: &serde_json::Value) -> String {
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

pub(crate) fn unix_ms_to_iso(ms: u128) -> String {
    format!("unix-ms:{ms}")
}

pub(crate) fn normalize_session_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let without_unc_prefix = normalized
        .strip_prefix("//?/")
        .or_else(|| normalized.strip_prefix("/?/"))
        .unwrap_or(&normalized);
    without_unc_prefix.trim_end_matches('/').to_ascii_lowercase()
}

pub(crate) fn extract_session_text(content: Option<&serde_json::Value>) -> Option<String> {
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

