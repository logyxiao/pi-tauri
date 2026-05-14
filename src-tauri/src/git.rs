use super::*;

#[tauri::command]
pub(crate) async fn pi_git_status(cwd: String) -> RpcResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || pi_git_status_blocking(cwd))
        .await
        .map_err(|error| format!("git status task failed: {error}"))?
}

pub(crate) fn pi_git_status_blocking(cwd: String) -> RpcResult<serde_json::Value> {
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
pub(crate) async fn pi_git_log(cwd: String, limit: Option<usize>) -> RpcResult<Vec<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(move || pi_git_log_blocking(cwd, limit))
        .await
        .map_err(|error| format!("git log task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn pi_git_file_diff(cwd: String, path: String, staged: bool) -> RpcResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || pi_git_file_diff_blocking(cwd, path, staged))
        .await
        .map_err(|error| format!("git file diff task failed: {error}"))?
}

pub(crate) fn pi_git_file_diff_blocking(cwd: String, path: String, staged: bool) -> RpcResult<serde_json::Value> {
    safe_git_relative_path(&path)?;
    let repo_root = git_repo_root(&cwd)?;
    let stat = if staged {
        git_output(&repo_root, &["diff", "--cached", "--stat", "--", &path])?
    } else if is_untracked_file(&repo_root, &path)? {
        "Untracked file".to_string()
    } else {
        git_output(&repo_root, &["diff", "--stat", "--", &path])?
    };
    let diff = if staged {
        git_output(&repo_root, &["diff", "--cached", "--no-ext-diff", "--", &path])?
    } else if is_untracked_file(&repo_root, &path)? {
        git_diff_allow_nonzero(&repo_root, &["diff", "--no-index", "--", os_null_path(), &path])?
    } else {
        git_output(&repo_root, &["diff", "--no-ext-diff", "--", &path])?
    };
    Ok(serde_json::json!({
        "path": path,
        "absolutePath": display_path(&repo_root.join(&path)),
        "stat": stat,
        "diff": diff
    }))
}

pub(crate) fn pi_git_log_blocking(cwd: String, limit: Option<usize>) -> RpcResult<Vec<serde_json::Value>> {
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
pub(crate) async fn pi_git_action(cwd: String, action: String, path: Option<String>) -> RpcResult<()> {
    tauri::async_runtime::spawn_blocking(move || pi_git_action_blocking(cwd, action, path))
        .await
        .map_err(|error| format!("git action task failed: {error}"))?
}

pub(crate) fn pi_git_action_blocking(cwd: String, action: String, path: Option<String>) -> RpcResult<()> {
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
pub(crate) async fn pi_git_sync(cwd: String) -> RpcResult<()> {
    tauri::async_runtime::spawn_blocking(move || pi_git_sync_blocking(cwd))
        .await
        .map_err(|error| format!("git sync task failed: {error}"))?
}

pub(crate) fn pi_git_sync_blocking(cwd: String) -> RpcResult<()> {
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
pub(crate) async fn pi_git_commit(cwd: String, message: String) -> RpcResult<()> {
    tauri::async_runtime::spawn_blocking(move || pi_git_commit_blocking(cwd, message))
        .await
        .map_err(|error| format!("git commit task failed: {error}"))?
}

pub(crate) fn pi_git_commit_blocking(cwd: String, message: String) -> RpcResult<()> {
    let repo_root = git_repo_root(&cwd)?;
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("commit message is required".to_string());
    }
    git_status(&repo_root, &["commit", "-m", trimmed])
}

#[tauri::command]
pub(crate) async fn pi_git_generate_commit_message(cwd: String, model: Option<String>, provider: Option<String>, thinking_level: Option<String>) -> RpcResult<String> {
    tauri::async_runtime::spawn_blocking(move || pi_git_generate_commit_message_blocking(cwd, model, provider, thinking_level))
        .await
        .map_err(|error| format!("git commit message task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn pi_optimize_prompt_keywords(input: String, model: Option<String>, provider: Option<String>, thinking_level: Option<String>) -> RpcResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || pi_optimize_prompt_keywords_blocking(input, model, provider, thinking_level))
        .await
        .map_err(|error| format!("prompt optimize task failed: {error}"))?
}

pub(crate) fn pi_optimize_prompt_keywords_blocking(input: String, model: Option<String>, provider: Option<String>, thinking_level: Option<String>) -> RpcResult<Vec<String>> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("input is required".to_string());
    }
    let prompt = "You are optimizing a user's short coding-agent prompt. Return exactly 3 improved Chinese prompt options as a JSON array of strings. Each option should preserve the user's intent, be concrete, actionable, and concise. Do not include markdown, numbering, explanations, or any extra text.";
    let context = format!("Original user input:\n{trimmed}");
    let raw = generate_commit_message_via_provider(model, provider, thinking_level, prompt, &context)?;
    let options = parse_prompt_options(&raw);
    if options.is_empty() {
        return Err("model returned no prompt options".to_string());
    }
    Ok(options.into_iter().take(3).collect())
}

pub(crate) fn pi_git_generate_commit_message_blocking(cwd: String, model: Option<String>, provider: Option<String>, thinking_level: Option<String>) -> RpcResult<String> {
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

    let prompt = "Generate a git commit message for the staged diff. Output only one concise commit subject line, imperative mood, <=72 characters. Prefer Conventional Commits when obvious. No markdown, no quotes, no explanation.";
    let raw = generate_commit_message_via_provider(model, provider, thinking_level, prompt, &context)?;
    let message = clean_commit_message(&raw);
    if message.is_empty() {
        return Err("model returned an empty commit message".to_string());
    }
    Ok(message)
}

pub(crate) fn generate_commit_message_via_provider(model: Option<String>, provider: Option<String>, thinking_level: Option<String>, prompt: &str, context: &str) -> RpcResult<String> {
    let config = resolve_commit_model_config(model, provider, thinking_level)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| format!("failed to create HTTP client: {error}"))?;

    match config.api.as_str() {
        "anthropic-messages" => call_anthropic_messages(&client, &config, prompt, context),
        "google-generative-ai" => call_google_generate_content(&client, &config, prompt, context),
        "openai-responses" => call_openai_responses(&client, &config, prompt, context),
        "openai-completions" | "openai-chat-completions" | "openai" => call_openai_chat_completions(&client, &config, prompt, context),
        other => Err(format!("unsupported commit message model api: {other}")),
    }
}

struct CommitModelConfig {
    model_id: String,
    api: String,
    base_url: String,
    api_key: Option<String>,
    headers: HashMap<String, String>,
    auth_header: bool,
    max_tokens: u64,
    thinking_level: Option<String>,
}

pub(crate) fn resolve_commit_model_config(model: Option<String>, provider: Option<String>, thinking_level: Option<String>) -> RpcResult<CommitModelConfig> {
    let models_json = read_models_json().unwrap_or_else(|_| serde_json::json!({}));
    let settings = read_pi_settings_json().unwrap_or_else(|_| serde_json::json!({}));
    let requested_model = model.as_deref().map(str::trim).filter(|value| !value.is_empty() && *value != "no model").map(str::to_string);
    let requested_provider = provider.as_deref().map(str::trim).filter(|value| !value.is_empty()).map(str::to_string);
    let (model_provider, model_id_from_key) = requested_model.as_deref().and_then(split_model_key_for_commit).unwrap_or((None, requested_model.clone()));
    let provider_id = requested_provider
        .or(model_provider)
        .or_else(|| settings.get("defaultProvider").and_then(|value| value.as_str()).map(str::to_string))
        .ok_or("commit message generation needs provider in settings or active model".to_string())?;
    let model_id = model_id_from_key
        .or_else(|| settings.get("defaultModel").and_then(|value| value.as_str()).map(str::to_string))
        .ok_or("commit message generation needs model in settings or active model".to_string())?;

    let providers = models_json.get("providers").and_then(|value| value.as_object()).ok_or("models.json providers not found; configure provider API/key first".to_string())?;
    let provider_value = providers.get(&provider_id).ok_or_else(|| format!("provider '{provider_id}' not found in models.json"))?;
    let model_value = find_model_config(provider_value, &model_id);
    let api = model_value.and_then(|value| value.get("api")).and_then(|value| value.as_str())
        .or_else(|| provider_value.get("api").and_then(|value| value.as_str()))
        .unwrap_or("openai-completions")
        .to_string();
    let base_url = provider_value.get("baseUrl").and_then(|value| value.as_str()).map(str::to_string).or_else(|| default_base_url_for_api(&provider_id, &api));
    let base_url = base_url.ok_or_else(|| format!("provider '{provider_id}' missing baseUrl"))?;
    let api_key = provider_value.get("apiKey").and_then(|value| value.as_str()).map(resolve_secret_value).transpose()?;
    let headers = resolve_header_map(provider_value.get("headers"))?;
    let auth_header = provider_value.get("authHeader").and_then(|value| value.as_bool()).unwrap_or(true);
    let max_tokens = model_value
        .and_then(|value| value.get("maxTokens"))
        .and_then(|value| value.as_u64())
        .unwrap_or(128)
        .min(512);

    Ok(CommitModelConfig { model_id, api, base_url, api_key, headers, auth_header, max_tokens, thinking_level })
}

pub(crate) fn split_model_key_for_commit(value: &str) -> Option<(Option<String>, Option<String>)> {
    value.split_once('/').map(|(provider, model)| (Some(provider.to_string()), Some(model.to_string())))
}

pub(crate) fn find_model_config<'a>(provider: &'a serde_json::Value, model_id: &str) -> Option<&'a serde_json::Value> {
    provider.get("models")?.as_array()?.iter().find(|item| item.get("id").and_then(|value| value.as_str()) == Some(model_id))
}

pub(crate) fn default_base_url_for_api(provider_id: &str, api: &str) -> Option<String> {
    match api {
        "anthropic-messages" => Some("https://api.anthropic.com/v1".to_string()),
        "google-generative-ai" => Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
        "openai-responses" | "openai-completions" | "openai-chat-completions" | "openai" if provider_id == "openai" => Some("https://api.openai.com/v1".to_string()),
        _ => None,
    }
}

pub(crate) fn request_builder_with_auth(client: &reqwest::blocking::Client, config: &CommitModelConfig, url: String) -> reqwest::blocking::RequestBuilder {
    let mut request = client.post(url);
    for (key, value) in &config.headers {
        request = request.header(key, value);
    }
    if config.auth_header {
        if let Some(api_key) = &config.api_key {
            request = request.bearer_auth(api_key);
        }
    }
    request
}

pub(crate) fn call_openai_chat_completions(client: &reqwest::blocking::Client, config: &CommitModelConfig, prompt: &str, context: &str) -> RpcResult<String> {
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let mut body = serde_json::json!({
        "model": config.model_id,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": context}
        ],
        "temperature": 0.2,
        "max_tokens": config.max_tokens
    });
    if let Some(effort) = reasoning_effort(config.thinking_level.as_deref()) {
        body["reasoning_effort"] = serde_json::Value::String(effort.to_string());
    }
    let value = send_json_request(request_builder_with_auth(client, config, url), body)?;
    value.get("choices").and_then(|value| value.as_array()).and_then(|items| items.first())
        .and_then(|item| item.get("message")).and_then(|message| message.get("content")).and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or("OpenAI chat response missing message content".to_string())
}

pub(crate) fn call_openai_responses(client: &reqwest::blocking::Client, config: &CommitModelConfig, prompt: &str, context: &str) -> RpcResult<String> {
    let url = format!("{}/responses", config.base_url.trim_end_matches('/'));
    let mut body = serde_json::json!({
        "model": config.model_id,
        "instructions": prompt,
        "input": context,
        "temperature": 0.2,
        "max_output_tokens": config.max_tokens
    });
    if let Some(effort) = reasoning_effort(config.thinking_level.as_deref()) {
        body["reasoning"] = serde_json::json!({ "effort": effort });
    }
    let value = send_json_request(request_builder_with_auth(client, config, url), body)?;
    extract_openai_response_text(&value).ok_or("OpenAI responses output text missing".to_string())
}

pub(crate) fn call_anthropic_messages(client: &reqwest::blocking::Client, config: &CommitModelConfig, prompt: &str, context: &str) -> RpcResult<String> {
    let url = format!("{}/messages", config.base_url.trim_end_matches('/'));
    let mut request = request_builder_with_auth(client, config, url)
        .header("anthropic-version", "2023-06-01");
    if !config.auth_header {
        if let Some(api_key) = &config.api_key {
            request = request.header("x-api-key", api_key);
        }
    } else if let Some(api_key) = &config.api_key {
        request = request.header("x-api-key", api_key);
    }
    let body = serde_json::json!({
        "model": config.model_id,
        "system": prompt,
        "messages": [{"role": "user", "content": context}],
        "max_tokens": config.max_tokens
    });
    let value = send_json_request(request, body)?;
    value.get("content").and_then(|value| value.as_array()).and_then(|items| items.first())
        .and_then(|item| item.get("text")).and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or("Anthropic response missing text content".to_string())
}

pub(crate) fn call_google_generate_content(client: &reqwest::blocking::Client, config: &CommitModelConfig, prompt: &str, context: &str) -> RpcResult<String> {
    let api_key = config.api_key.as_deref().ok_or("Google provider requires apiKey".to_string())?;
    let url = format!("{}/models/{}:generateContent?key={}", config.base_url.trim_end_matches('/'), config.model_id, api_key);
    let body = serde_json::json!({
        "contents": [{"role": "user", "parts": [{"text": format!("{}\n\n{}", prompt, context)}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": config.max_tokens}
    });
    let value = send_json_request(request_builder_with_auth(client, config, url), body)?;
    value.get("candidates").and_then(|value| value.as_array()).and_then(|items| items.first())
        .and_then(|item| item.get("content")).and_then(|content| content.get("parts")).and_then(|parts| parts.as_array()).and_then(|parts| parts.first())
        .and_then(|part| part.get("text")).and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or("Google response missing text content".to_string())
}

pub(crate) fn reasoning_effort(level: Option<&str>) -> Option<&'static str> {
    match level {
        Some("minimal") => Some("minimal"),
        Some("low") => Some("low"),
        Some("medium") => Some("medium"),
        Some("high") | Some("xhigh") => Some("high"),
        _ => None,
    }
}

pub(crate) fn send_json_request(request: reqwest::blocking::RequestBuilder, body: serde_json::Value) -> RpcResult<serde_json::Value> {
    let response = request.json(&body).send().map_err(|error| format!("commit message request failed: {error}"))?;
    let status = response.status();
    let text = response.text().map_err(|error| format!("failed to read commit message response: {error}"))?;
    if !status.is_success() {
        return Err(format!("commit message request failed with {status}: {text}"));
    }
    serde_json::from_str(&text).map_err(|error| format!("commit message response is invalid JSON: {error}"))
}

pub(crate) fn extract_openai_response_text(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.get("output_text").and_then(|value| value.as_str()) {
        return Some(text.to_string());
    }
    let output = value.get("output")?.as_array()?;
    for item in output {
        let content = item.get("content").and_then(|value| value.as_array())?;
        for part in content {
            if let Some(text) = part.get("text").and_then(|value| value.as_str()) {
                return Some(text.to_string());
            }
        }
    }
    None
}

pub(crate) fn wait_with_output_timeout(mut child: Child, timeout: Duration) -> std::io::Result<std::process::Output> {
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

pub(crate) fn truncate_for_prompt(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut truncated = text.chars().take(max_chars).collect::<String>();
    truncated.push_str("\n\n[diff truncated]\n");
    truncated
}

pub(crate) fn clean_commit_message(output: &str) -> String {
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

pub(crate) fn parse_prompt_options(output: &str) -> Vec<String> {
    if let Ok(values) = serde_json::from_str::<Vec<String>>(output.trim()) {
        return values.into_iter().filter_map(clean_prompt_option).collect();
    }
    output
        .lines()
        .filter_map(|line| {
            let cleaned = line
                .trim()
                .trim_start_matches(|ch: char| ch.is_ascii_digit() || ch == '.' || ch == '-' || ch == '*' || ch == '、')
                .trim()
                .trim_matches(|ch| ch == '"' || ch == '\'' || ch == '`' || ch == ',' || ch == '[' || ch == ']')
                .to_string();
            clean_prompt_option(cleaned)
        })
        .collect()
}

fn clean_prompt_option(value: String) -> Option<String> {
    let cleaned = value.trim().trim_matches(|ch| ch == '"' || ch == '\'' || ch == '`').to_string();
    if cleaned.is_empty() || cleaned.starts_with("```") {
        return None;
    }
    Some(cleaned.chars().take(500).collect())
}

pub(crate) fn parse_git_log_line(line: &str) -> Option<serde_json::Value> {
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

pub(crate) fn git_repo_root(cwd: &str) -> RpcResult<PathBuf> {
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

pub(crate) fn git_root_candidates(cwd: &str) -> Vec<PathBuf> {
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

pub(crate) fn git_output(cwd: &Path, args: &[&str]) -> RpcResult<String> {
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

pub(crate) fn git_status(cwd: &Path, args: &[&str]) -> RpcResult<()> {
    git_output(cwd, args).map(|_| ())
}

pub(crate) fn git_diff_allow_nonzero(cwd: &Path, args: &[&str]) -> RpcResult<String> {
    let child = Command::new(default_git_bin())
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to run git: {error}"))?;
    let output = wait_with_output_timeout(child, Duration::from_secs(30))
        .map_err(|error| format!("git command timed out or failed: {error}"))?;
    if output.status.success() || output.status.code() == Some(1) {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() { "git diff failed".to_string() } else { stderr })
    }
}

pub(crate) fn parse_git_branch_header(header: &str) -> (String, Option<String>, usize, usize) {
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

pub(crate) fn parse_git_status_path(raw_path: &str) -> (String, Option<String>) {
    let cleaned = raw_path.trim().trim_matches('"').replace('\\', "/");
    if let Some((left, right)) = cleaned.split_once(" -> ") {
        (right.trim_matches('"').to_string(), Some(left.trim_matches('"').to_string()))
    } else {
        (cleaned, None)
    }
}

pub(crate) fn safe_git_relative_path(path: &str) -> RpcResult<()> {
    let requested = Path::new(path);
    if requested.is_absolute() || path.trim().is_empty() {
        return Err("git path must be relative".to_string());
    }
    if requested.components().any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
        return Err("git path must stay inside repository".to_string());
    }
    Ok(())
}

pub(crate) fn is_untracked_file(repo_root: &Path, path: &str) -> RpcResult<bool> {
    let output = git_output(repo_root, &["status", "--porcelain=v1", "--", path])?;
    Ok(output.lines().any(|line| line.starts_with("?? ")))
}

pub(crate) fn os_null_path() -> &'static str {
    if cfg!(windows) { "NUL" } else { "/dev/null" }
}

pub(crate) fn default_git_bin() -> String {
    if cfg!(windows) {
        "git.exe".to_string()
    } else {
        "git".to_string()
    }
}

