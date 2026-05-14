use super::*;

#[tauri::command]
pub(crate) async fn pi_list_files(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(move || pi_list_files_blocking(cwd))
        .await
        .map_err(|error| format!("list files task failed: {error}"))?
}

pub(crate) fn pi_list_files_blocking(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
    let root = safe_root(&cwd)?;
    let mut entries = Vec::new();
    collect_files(&root, &root, 0, &mut entries)?;
    Ok(entries)
}

#[tauri::command]
pub(crate) async fn pi_read_file(cwd: String, path: String) -> RpcResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || pi_read_file_blocking(cwd, path))
        .await
        .map_err(|error| format!("read file task failed: {error}"))?
}

pub(crate) fn pi_read_file_blocking(cwd: String, path: String) -> RpcResult<serde_json::Value> {
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

pub(crate) fn safe_join(root: &Path, relative_path: &str) -> RpcResult<PathBuf> {
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

pub(crate) fn collect_files(root: &Path, current: &Path, depth: usize, entries: &mut Vec<serde_json::Value>) -> RpcResult<()> {
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

pub(crate) fn is_hidden_or_ignored(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "dist" | "target" | "coverage" | ".git")
}

pub(crate) fn file_kind(path: &str) -> &'static str {
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

pub(crate) fn mime_for_path(path: &Path) -> &'static str {
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

