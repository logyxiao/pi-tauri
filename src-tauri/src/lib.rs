use std::{
    collections::{HashMap, HashSet},
    fs,
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    path::{Component, Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OpenFlags};
use tauri::{AppHandle, Emitter, State};

type RpcResult<T> = Result<T, String>;

struct CcSwitchProviderImport {
    provider_key: String,
    base_url: String,
    api_key: String,
    api: String,
    headers: HashMap<String, String>,
    balance_base_url: Option<String>,
    balance_api_key: Option<String>,
    models: Vec<String>,
}

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
        "name": "π Tauri",
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

fn background_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
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
fn pi_settings_json_read() -> RpcResult<serde_json::Value> {
    let path = pi_settings_json_path()?;
    let content = if path.exists() {
        fs::read_to_string(&path).map_err(|error| format!("failed to read settings.json: {error}"))?
    } else {
        "{}".to_string()
    };
    Ok(serde_json::json!({
        "path": display_path(&path),
        "exists": path.exists(),
        "content": content,
    }))
}

#[tauri::command]
async fn pi_fetch_provider_models(base_url: String, api_key: Option<String>, headers: Option<HashMap<String, String>>, auth_header: Option<bool>) -> RpcResult<Vec<String>> {
    fetch_provider_models_with_options(base_url, api_key, headers, auth_header).await.map(|result| result.models)
}

#[tauri::command]
async fn pi_test_provider(base_url: String, api_key: Option<String>, headers: Option<HashMap<String, String>>, auth_header: Option<bool>) -> RpcResult<serde_json::Value> {
    let started = Instant::now();
    let result = fetch_provider_models_with_options(base_url, api_key, headers, auth_header).await?;
    Ok(serde_json::json!({
        "status": "ok",
        "modelCount": result.models.len(),
        "url": result.url,
        "latencyMs": started.elapsed().as_millis() as u64,
        "detail": "provider URL and credentials can access model list"
    }))
}

async fn fetch_provider_models_with_options(base_url: String, api_key: Option<String>, headers: Option<HashMap<String, String>>, auth_header: Option<bool>) -> RpcResult<ProviderModelsResult> {
    let client = reqwest::Client::new();
    let key = resolve_optional_secret(api_key)?;
    let resolved_headers = resolve_provider_headers(headers)?;
    let use_auth_header = auth_header.unwrap_or(true);
    let urls = model_list_urls(&base_url);
    let mut last_error = String::new();

    for url in urls {
        let request = provider_get_request(&client, &url, key.as_deref(), &resolved_headers, use_auth_header);
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
        return Ok(ProviderModelsResult { models, url });
    }

    Err(format!("failed to fetch models. Tried /models, /v1/models, /api/v1/models. Last error: {last_error}"))
}

#[tauri::command]
async fn pi_probe_provider(base_url: String, api_key: Option<String>, headers: Option<HashMap<String, String>>, auth_header: Option<bool>, balance_base_url: Option<String>, balance_api_key: Option<String>) -> RpcResult<serde_json::Value> {
    let key = resolve_optional_secret(api_key.clone())?;
    let balance_key = resolve_optional_secret(balance_api_key.clone())?.or_else(|| key.clone());
    let resolved_headers = resolve_provider_headers(headers.clone())?;
    let use_auth_header = auth_header.unwrap_or(true);
    let models_result = fetch_provider_models_with_options(base_url.clone(), api_key, headers, auth_header).await;
    let model_count = models_result.as_ref().map(|models| models.len()).unwrap_or(0);
    let models_error = models_result.as_ref().err().cloned();

    let client = reqwest::Client::new();
    let mut balance_error = String::new();
    let balance_base = balance_base_url.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or(base_url.as_str());
    for url in provider_balance_urls(balance_base) {
        let request = provider_get_request(&client, &url, balance_key.as_deref(), &resolved_headers, use_auth_header);
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                balance_error = format!("{url}: request failed: {error}");
                continue;
            }
        };
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            balance_error = format!("{url}: request failed: {status}: {}", body.chars().take(240).collect::<String>());
            continue;
        }
        let value = match serde_json::from_str::<serde_json::Value>(&body) {
            Ok(value) => value,
            Err(error) => {
                balance_error = format!("{url}: response is not JSON: {error}");
                continue;
            }
        };
        if let Some(summary) = summarize_provider_balance(&value) {
            return Ok(serde_json::json!({
                "status": "ok",
                "modelCount": model_count,
                "balance": summary,
                "balanceSource": url,
                "detail": "provider model endpoint and balance endpoint responded"
            }));
        }
        balance_error = format!("{url}: JSON parsed but no balance/quota field recognized");
    }

    if models_result.is_ok() {
        return Ok(serde_json::json!({
            "status": "ok",
            "modelCount": model_count,
            "detail": if balance_error.is_empty() { "provider model endpoint responded; no balance endpoint detected" } else { balance_error.as_str() }
        }));
    }

    Err(format!(
        "provider probe failed. models: {}; balance: {}",
        models_error.unwrap_or_else(|| "unknown model error".to_string()),
        if balance_error.is_empty() { "no balance endpoint detected".to_string() } else { balance_error },
    ))
}

#[tauri::command]
async fn pi_probe_configured_provider(provider_id: String) -> RpcResult<serde_json::Value> {
    let models_json = read_models_json()?;
    let providers = models_json.get("providers").and_then(|value| value.as_object()).ok_or("models.json providers not found")?;
    let provider = providers.get(&provider_id).ok_or_else(|| format!("provider '{provider_id}' not found in models.json"))?;
    let base_url = provider.get("baseUrl").and_then(|value| value.as_str()).ok_or_else(|| format!("provider '{provider_id}' missing baseUrl"))?.to_string();
    let api_key = provider.get("apiKey").and_then(|value| value.as_str()).map(str::to_string);
    let headers = provider
        .get("headers")
        .and_then(|value| value.as_object())
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| value.as_str().map(|text| (key.clone(), text.to_string())))
                .collect::<HashMap<_, _>>()
        });
    let auth_header = provider.get("authHeader").and_then(|value| value.as_bool());
    let balance_base_url = provider.get("balanceBaseUrl").and_then(|value| value.as_str()).map(str::to_string);
    let balance_api_key = provider.get("balanceApiKey").and_then(|value| value.as_str()).map(str::to_string);
    pi_probe_provider(base_url, api_key, headers, auth_header, balance_base_url, balance_api_key).await
}

struct ProviderModelsResult {
    models: Vec<String>,
    url: String,
}

impl ProviderModelsResult {
    fn len(&self) -> usize {
        self.models.len()
    }
}

fn resolve_optional_secret(value: Option<String>) -> RpcResult<Option<String>> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(resolve_secret_value)
        .transpose()
}

fn resolve_provider_headers(headers: Option<HashMap<String, String>>) -> RpcResult<HashMap<String, String>> {
    let mut resolved = HashMap::new();
    for (key, value) in headers.unwrap_or_default() {
        if key.trim().is_empty() {
            continue;
        }
        resolved.insert(key, resolve_secret_value(&value)?);
    }
    Ok(resolved)
}

fn provider_get_request(client: &reqwest::Client, url: &str, api_key: Option<&str>, headers: &HashMap<String, String>, auth_header: bool) -> reqwest::RequestBuilder {
    let mut request = client
        .get(url)
        .header("accept", "application/json")
        .header("user-agent", "cc-switch/1.0");
    for (key, value) in headers {
        request = request.header(key, value);
    }
    if auth_header {
        if let Some(key) = api_key.filter(|value| !value.trim().is_empty()) {
            request = request.bearer_auth(key);
        }
    }
    request
}

#[tauri::command]
fn pi_skill_resources(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
    let cwd_path = if cwd.trim().is_empty() || cwd == "unknown cwd" || cwd == "Unknown cwd" {
        std::env::current_dir().map_err(|error| format!("failed to resolve current directory: {error}"))?
    } else {
        safe_root(&cwd)?
    };
    list_skill_resources(&cwd_path)
}

#[tauri::command]
fn pi_skill_set_enabled(path: String, enabled: bool) -> RpcResult<Vec<serde_json::Value>> {
    let target_path = normalize_existing_or_candidate_path(&path)?;
    let cwd = std::env::current_dir().map_err(|error| format!("failed to resolve current directory: {error}"))?;
    set_resource_enabled(&target_path, enabled, "skills")?;
    list_skill_resources(&cwd)
}

#[tauri::command]
fn pi_skill_delete(path: String) -> RpcResult<()> {
    let target_path = normalize_existing_or_candidate_path(&path)?;
    if !is_manageable_resource_path(&target_path, "skills") {
        return Err("skill path is outside manageable skill directories".to_string());
    }
    if target_path.is_dir() {
        fs::remove_dir_all(&target_path).map_err(|error| format!("failed to delete skill directory: {error}"))
    } else if target_path.exists() {
        fs::remove_file(&target_path).map_err(|error| format!("failed to delete skill file: {error}"))
    } else {
        Ok(())
    }
}

#[tauri::command]
fn pi_extension_resources(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
    let cwd_path = if cwd.trim().is_empty() || cwd == "unknown cwd" || cwd == "Unknown cwd" {
        std::env::current_dir().map_err(|error| format!("failed to resolve current directory: {error}"))?
    } else {
        safe_root(&cwd)?
    };
    list_extension_resources(&cwd_path)
}

#[tauri::command]
fn pi_extension_set_enabled(path: String, enabled: bool) -> RpcResult<Vec<serde_json::Value>> {
    let target_path = normalize_existing_or_candidate_path(&path)?;
    let cwd = std::env::current_dir().map_err(|error| format!("failed to resolve current directory: {error}"))?;
    set_resource_enabled(&target_path, enabled, "extensions")?;
    list_extension_resources(&cwd)
}

#[tauri::command]
fn pi_extension_delete(path: String) -> RpcResult<()> {
    let target_path = normalize_existing_or_candidate_path(&path)?;
    if !is_manageable_resource_path(&target_path, "extensions") {
        return Err("extension path is outside manageable extension directories".to_string());
    }
    if target_path.is_dir() {
        fs::remove_dir_all(&target_path).map_err(|error| format!("failed to delete extension directory: {error}"))
    } else if target_path.exists() {
        fs::remove_file(&target_path).map_err(|error| format!("failed to delete extension file: {error}"))
    } else {
        Ok(())
    }
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

#[tauri::command]
fn pi_settings_set_provider_enabled(provider_id: String, enabled: bool, models: Vec<String>) -> RpcResult<serde_json::Value> {
    let enable_patterns = if enabled { vec![provider_id.clone()] } else { Vec::new() };
    let disable_patterns = if enabled { Vec::new() } else { vec![provider_id.clone()] };
    sync_provider_enabled_models(enable_patterns, disable_patterns, models)
}

#[tauri::command]
fn pi_settings_set_provider_model_selection(provider_id: String, provider_enabled: bool, enabled_models: Vec<String>, disabled_models: Vec<String>, legacy_models_to_remove: Vec<String>) -> RpcResult<serde_json::Value> {
    sync_provider_model_selection(&provider_id, provider_enabled, enabled_models, disabled_models, legacy_models_to_remove)
}

fn sync_provider_model_selection(provider_id: &str, provider_enabled: bool, enabled_models: Vec<String>, disabled_models: Vec<String>, legacy_models_to_remove: Vec<String>) -> RpcResult<serde_json::Value> {
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

    let provider_id = provider_id.trim();
    let object = settings.as_object_mut().ok_or("settings.json root must be object")?;
    let provider_wildcard = provider_wildcard_model(provider_id);
    let provider_prefix = format!("{provider_id}/");
    let legacy_models = legacy_models_to_remove
        .iter()
        .chain(enabled_models.iter())
        .chain(disabled_models.iter())
        .map(|model| model.trim().to_string())
        .filter(|model| !model.is_empty())
        .collect::<HashSet<_>>();

    let mut enabled = object
        .get("enabledModels")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .filter(|item| {
                    let trimmed = item.trim();
                    trimmed != provider_wildcard
                        && !trimmed.starts_with(&provider_prefix)
                        && !legacy_models.contains(trimmed)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut added = 0usize;
    if provider_enabled && !provider_id.is_empty() {
        let has_disabled_models = disabled_models.iter().any(|model| !model.trim().is_empty());
        if has_disabled_models {
            for model in enabled_models {
                let model = model.trim();
                if model.is_empty() {
                    continue;
                }
                let pattern = format!("{provider_id}/{model}");
                if enabled.iter().any(|item| item == &pattern) {
                    continue;
                }
                enabled.push(pattern);
                added += 1;
            }
        } else if provider_wildcard != "/*" && !enabled.iter().any(|item| item == &provider_wildcard) {
            enabled.push(provider_wildcard);
            added += 1;
        }
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

fn sync_provider_enabled_models(enabled_providers: Vec<String>, disabled_providers: Vec<String>, legacy_models_to_remove: Vec<String>) -> RpcResult<serde_json::Value> {
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
    let disabled_patterns = disabled_providers
        .iter()
        .map(|provider| provider_wildcard_model(provider))
        .collect::<HashSet<_>>();
    let disabled_prefixes = disabled_providers
        .iter()
        .map(|provider| format!("{}/", provider.trim()))
        .collect::<Vec<_>>();
    let legacy_models = legacy_models_to_remove
        .iter()
        .map(|model| model.trim().to_string())
        .filter(|model| !model.is_empty())
        .collect::<HashSet<_>>();

    let mut enabled = object
        .get("enabledModels")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .filter(|item| {
                    let trimmed = item.trim();
                    !disabled_patterns.contains(trimmed)
                        && !legacy_models.contains(trimmed)
                        && !disabled_prefixes.iter().any(|prefix| trimmed.starts_with(prefix))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut added = 0usize;
    for provider in enabled_providers {
        let pattern = provider_wildcard_model(&provider);
        if pattern == "/*" || enabled.iter().any(|item| item == &pattern) {
            continue;
        }
        enabled.push(pattern);
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

fn provider_wildcard_model(provider: &str) -> String {
    format!("{}/*", provider.trim())
}

#[tauri::command]
fn pi_sync_cc_switch_models() -> RpcResult<serde_json::Value> {
    let db_path = cc_switch_db_path()?;
    if !db_path.exists() {
        return Err(format!("cc-switch database not found: {}", display_path(&db_path)));
    }

    let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("failed to open cc-switch database: {error}"))?;
    let meta_select = if sqlite_table_has_column(&conn, "providers", "meta")? { "meta" } else { "'{}'" };
    let query = format!(
        "SELECT id, app_type, name, settings_config, {meta_select}
         FROM providers
         ORDER BY app_type ASC, COALESCE(sort_index, 999999), created_at ASC, id ASC",
    );
    let mut stmt = conn
        .prepare(&query)
        .map_err(|error| format!("failed to query cc-switch providers: {error}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|error| format!("failed to read cc-switch providers: {error}"))?;

    let mut imports = Vec::new();
    for row in rows {
        let (id, app_type, name, settings_config, meta) = row.map_err(|error| format!("failed to read cc-switch provider row: {error}"))?;
        let config = serde_json::from_str::<serde_json::Value>(&settings_config).unwrap_or(serde_json::Value::Null);
        let meta = serde_json::from_str::<serde_json::Value>(&meta).unwrap_or(serde_json::Value::Null);
        if let Some(import) = cc_switch_provider_import(&id, &app_type, &name, &config, &meta) {
            imports.push(import);
        }
    }

    if imports.is_empty() {
        return Err("no cc-switch providers with usable model settings were found".to_string());
    }
    ensure_unique_provider_keys(&mut imports);

    let path = pi_models_json_path()?;
    let content = if path.exists() {
        fs::read_to_string(&path).map_err(|error| format!("failed to read models.json: {error}"))?
    } else {
        default_models_json()
    };
    let mut models_config = serde_json::from_str::<serde_json::Value>(&content).unwrap_or_else(|_| serde_json::json!({ "providers": {} }));
    if !models_config.is_object() {
        models_config = serde_json::json!({ "providers": {} });
    }
    let object = models_config.as_object_mut().ok_or("models.json root must be object")?;
    if !object.get("providers").map(|value| value.is_object()).unwrap_or(false) {
        object.insert("providers".to_string(), serde_json::json!({}));
    }
    let providers = object
        .get_mut("providers")
        .and_then(|value| value.as_object_mut())
        .ok_or("models.json providers must be object")?;

    let mut enabled_providers = Vec::new();
    let mut disabled_providers = Vec::new();
    let mut legacy_models_to_remove = Vec::new();
    let mut synced_providers = 0usize;
    let mut synced_models = 0usize;
    for import in imports {
        let provider_key = import.provider_key;
        let base_url = import.base_url;
        let api = import.api;
        let api_key = import.api_key;
        let headers = import.headers;
        let balance_base_url = import.balance_base_url;
        let balance_api_key = import.balance_api_key;
        let imported_models = import.models;
        let matching_old_provider_keys = providers
            .iter()
            .filter(|(key, value)| {
                key.as_str() != provider_key.as_str()
                    && key.starts_with("ccswitch-")
                    && value.get("baseUrl").and_then(|item| item.as_str()) == Some(base_url.as_str())
            })
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        let migrated_provider_key = if providers.contains_key(&provider_key) {
            None
        } else {
            matching_old_provider_keys.first().cloned()
        };
        let existing_provider = migrated_provider_key
            .as_ref()
            .and_then(|key| providers.remove(key))
            .or_else(|| providers.get(&provider_key).cloned());
        if let Some(old_key) = migrated_provider_key {
            disabled_providers.push(old_key);
        }
        for old_key in matching_old_provider_keys {
            providers.remove(&old_key);
            disabled_providers.push(old_key);
        }
        let provider_enabled = existing_provider
            .as_ref()
            .and_then(|value| value.get("enabled"))
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        let existing_models = existing_provider
            .as_ref()
            .and_then(|value| value.get("models"))
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        let mut model_ids = existing_models
            .iter()
            .filter_map(|value| value.get("id").and_then(|id| id.as_str()).map(str::to_string))
            .collect::<HashSet<_>>();
        let mut models = existing_models;
        for model_id in &imported_models {
            if !model_id.trim().is_empty() {
                legacy_models_to_remove.push(model_id.clone());
            }
            if model_id.trim().is_empty() || !model_ids.insert(model_id.clone()) {
                continue;
            }
            synced_models += 1;
            models.push(serde_json::json!({
                "id": model_id,
                "name": model_id,
                "enabled": true,
                "reasoning": false,
                "input": ["text"],
                "contextWindow": 128000,
                "maxTokens": 32000
            }));
        }

        let mut provider = serde_json::Map::new();
        provider.insert("baseUrl".to_string(), serde_json::json!(base_url));
        provider.insert("api".to_string(), serde_json::json!(api));
        provider.insert("apiKey".to_string(), serde_json::json!(api_key));
        provider.insert("enabled".to_string(), serde_json::json!(provider_enabled));
        provider.insert("models".to_string(), serde_json::json!(models));
        if !headers.is_empty() {
            provider.insert("headers".to_string(), serde_json::json!(headers));
        }
        if let Some(value) = balance_base_url {
            provider.insert("balanceBaseUrl".to_string(), serde_json::json!(value));
        }
        if let Some(value) = balance_api_key {
            provider.insert("balanceApiKey".to_string(), serde_json::json!(value));
        }
        providers.insert(provider_key.clone(), serde_json::Value::Object(provider));
        if provider_enabled {
            let mut provider_enabled_models = Vec::new();
            let mut provider_disabled_models = Vec::new();
            for model in models.iter() {
                let Some(model_id) = model.get("id").and_then(|value| value.as_str()).map(str::trim).filter(|value| !value.is_empty()) else {
                    continue;
                };
                if model.get("enabled").and_then(|value| value.as_bool()) == Some(false) {
                    provider_disabled_models.push(model_id.to_string());
                } else {
                    provider_enabled_models.push(model_id.to_string());
                }
            }
            if provider_disabled_models.is_empty() {
                enabled_providers.push(provider_key.clone());
            } else {
                sync_provider_model_selection(&provider_key, true, provider_enabled_models, provider_disabled_models, imported_models.clone())?;
            }
        } else {
            disabled_providers.push(provider_key.clone());
        }
        synced_providers += 1;
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("failed to create models.json directory: {error}"))?;
    }
    let serialized = serde_json::to_string_pretty(&models_config).map_err(|error| format!("failed to serialize models.json: {error}"))?;
    fs::write(&path, format!("{}\n", serialized)).map_err(|error| format!("failed to write models.json: {error}"))?;

    let enabled_provider_count = enabled_providers.len();
    let _enabled = sync_provider_enabled_models(enabled_providers, disabled_providers, legacy_models_to_remove).unwrap_or_else(|error| serde_json::json!({ "added": 0, "error": error }));

    Ok(serde_json::json!({
        "path": display_path(&path),
        "ccSwitchDb": display_path(&db_path),
        "providers": synced_providers,
        "models": synced_models,
        "enabled": enabled_provider_count,
        "content": format!("{}\n", serialized),
    }))
}

fn pi_models_json_path() -> RpcResult<PathBuf> {
    Ok(pi_agent_dir()?.join("models.json"))
}

fn pi_settings_json_path() -> RpcResult<PathBuf> {
    Ok(pi_agent_dir()?.join("settings.json"))
}

fn list_skill_resources(cwd: &Path) -> RpcResult<Vec<serde_json::Value>> {
    let settings = read_pi_settings_json().unwrap_or_else(|_| serde_json::json!({}));
    let configured = settings
        .get("skills")
        .and_then(|value| value.as_array())
        .map(|items| items.iter().filter_map(|item| item.as_str().map(str::to_string)).collect::<Vec<_>>())
        .unwrap_or_default();
    let disabled = configured
        .iter()
        .filter_map(|item| item.strip_prefix('!').or_else(|| item.strip_prefix('-')).map(normalize_config_path))
        .collect::<HashSet<_>>();

    let mut resources = Vec::new();
    collect_skill_dir(&pi_agent_dir()?.join("skills"), "global", &disabled, &mut resources)?;
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from).or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from)) {
        collect_skill_dir(&home.join(".agents").join("skills"), "global", &disabled, &mut resources)?;
    }
    collect_skill_dir(&cwd.join(".pi").join("skills"), "project", &disabled, &mut resources)?;
    collect_skill_dir(&cwd.join(".agents").join("skills"), "project", &disabled, &mut resources)?;
    collect_package_resources(&settings, "skills", &disabled, &mut resources)?;

    for item in configured {
        if item.starts_with('!') || item.starts_with('-') {
            continue;
        }
        let forced = item.strip_prefix('+').unwrap_or(&item);
        let path = expand_config_path(forced, &pi_agent_dir()?)?;
        push_extension_resource(&mut resources, path, "settings", "settings", true, true, false);
    }

    resources.sort_by(|a, b| {
        let left = a.get("path").and_then(|value| value.as_str()).unwrap_or_default();
        let right = b.get("path").and_then(|value| value.as_str()).unwrap_or_default();
        left.cmp(right)
    });
    resources.dedup_by(|a, b| a.get("path") == b.get("path"));
    Ok(resources)
}

fn collect_skill_dir(dir: &Path, scope: &str, disabled: &HashSet<String>, resources: &mut Vec<serde_json::Value>) -> RpcResult<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|error| format!("failed to read skills directory: {error}"))?.flatten() {
        let path = entry.path();
        let is_skill = path.is_dir() && path.join("SKILL.md").exists()
            || path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("md") && path.file_name().and_then(|value| value.to_str()) != Some("SKILL.md");
        if !is_skill {
            continue;
        }
        let disabled_by_pattern = disabled.contains(&normalize_config_path(&display_path(&path)));
        push_extension_resource(resources, path, scope, "auto", !disabled_by_pattern, true, disabled_by_pattern);
    }
    Ok(())
}

fn list_extension_resources(cwd: &Path) -> RpcResult<Vec<serde_json::Value>> {
    let settings = read_pi_settings_json().unwrap_or_else(|_| serde_json::json!({}));
    let configured = settings
        .get("extensions")
        .and_then(|value| value.as_array())
        .map(|items| items.iter().filter_map(|item| item.as_str().map(str::to_string)).collect::<Vec<_>>())
        .unwrap_or_default();
    let disabled = configured
        .iter()
        .filter_map(|item| item.strip_prefix('!').or_else(|| item.strip_prefix('-')).map(normalize_config_path))
        .collect::<HashSet<_>>();

    let mut resources = Vec::new();
    let global_dir = pi_agent_dir()?.join("extensions");
    collect_auto_extensions(&global_dir, "global", &disabled, &mut resources)?;
    collect_auto_extensions(&cwd.join(".pi").join("extensions"), "project", &disabled, &mut resources)?;
    collect_package_resources(&settings, "extensions", &disabled, &mut resources)?;

    for item in configured {
        if item.starts_with('!') || item.starts_with('-') {
            continue;
        }
        let forced = item.strip_prefix('+').unwrap_or(&item);
        let path = expand_config_path(forced, &pi_agent_dir()?)?;
        push_extension_resource(&mut resources, path, "settings", "settings", true, true, false);
    }

    resources.sort_by(|a, b| {
        let left = a.get("path").and_then(|value| value.as_str()).unwrap_or_default();
        let right = b.get("path").and_then(|value| value.as_str()).unwrap_or_default();
        left.cmp(right)
    });
    resources.dedup_by(|a, b| a.get("path") == b.get("path"));
    Ok(resources)
}

fn collect_package_resources(settings: &serde_json::Value, kind: &str, disabled: &HashSet<String>, resources: &mut Vec<serde_json::Value>) -> RpcResult<()> {
    let Some(packages) = settings.get("packages").and_then(|value| value.as_array()) else {
        return Ok(());
    };
    for package in packages {
        let source = package.as_str().or_else(|| package.get("source").and_then(|value| value.as_str()));
        let Some(source) = source else { continue; };
        let Some(package_root) = resolve_package_root(source)? else { continue; };
        let manifest = read_package_json(&package_root);
        let configured = manifest
            .as_ref()
            .and_then(|value| value.get("pi"))
            .and_then(|pi| pi.get(kind))
            .and_then(|value| value.as_array())
            .map(|items| items.iter().filter_map(|item| item.as_str().map(str::to_string)).collect::<Vec<_>>())
            .unwrap_or_else(|| vec![kind.to_string()]);
        for item in configured {
            if item.starts_with('!') || item.starts_with('-') {
                continue;
            }
            let relative = item.trim_start_matches('+');
            let path = package_root.join(relative);
            if kind == "extensions" {
                collect_package_extension_path(&path, disabled, resources);
            } else {
                collect_package_skill_path(&path, disabled, resources)?;
            }
        }
    }
    Ok(())
}

fn collect_package_extension_path(path: &Path, disabled: &HashSet<String>, resources: &mut Vec<serde_json::Value>) {
    if path.is_file() && matches!(path.extension().and_then(|value| value.to_str()), Some("ts" | "js")) {
        let disabled_by_pattern = disabled.contains(&normalize_config_path(&display_path(path)));
        push_extension_resource(resources, path.to_path_buf(), "package", "package", !disabled_by_pattern, false, disabled_by_pattern);
    } else if path.is_dir() {
        let Ok(entries) = fs::read_dir(path) else { return; };
        for entry in entries.flatten() {
            let child = entry.path();
            if child.is_file() && matches!(child.extension().and_then(|value| value.to_str()), Some("ts" | "js")) {
                let disabled_by_pattern = disabled.contains(&normalize_config_path(&display_path(&child)));
                push_extension_resource(resources, child, "package", "package", !disabled_by_pattern, false, disabled_by_pattern);
            }
        }
    }
}

fn collect_package_skill_path(path: &Path, disabled: &HashSet<String>, resources: &mut Vec<serde_json::Value>) -> RpcResult<()> {
    if path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("md") {
        let disabled_by_pattern = disabled.contains(&normalize_config_path(&display_path(path)));
        push_extension_resource(resources, path.to_path_buf(), "package", "package", !disabled_by_pattern, false, disabled_by_pattern);
    } else if path.is_dir() {
        collect_skill_dir(path, "package", disabled, resources)?;
    }
    Ok(())
}

fn resolve_package_root(source: &str) -> RpcResult<Option<PathBuf>> {
    if source.starts_with("npm:") {
        let spec = source.trim_start_matches("npm:");
        let name = strip_npm_version(spec);
        for root in npm_global_roots() {
            let candidate = root.join(&name);
            if candidate.exists() {
                return Ok(Some(candidate));
            }
        }
        return Ok(None);
    }
    let path = expand_config_path(source, &pi_agent_dir()?)?;
    Ok(path.exists().then_some(path))
}

fn strip_npm_version(spec: &str) -> String {
    if spec.starts_with('@') {
        let at_positions = spec.match_indices('@').map(|(index, _)| index).collect::<Vec<_>>();
        if at_positions.len() > 1 {
            return spec[..*at_positions.last().unwrap()].to_string();
        }
        return spec.to_string();
    }
    spec.split('@').next().unwrap_or(spec).to_string()
}

fn npm_global_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(output) = Command::new(default_node_bin()).args(["-e", "console.log(require('child_process').execSync('npm root -g').toString().trim())"]).output() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !text.is_empty() {
            roots.push(PathBuf::from(text));
        }
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        roots.push(PathBuf::from(appdata).join("npm").join("node_modules"));
    }
    roots.sort();
    roots.dedup();
    roots
}

fn read_package_json(path: &Path) -> Option<serde_json::Value> {
    let content = fs::read_to_string(path.join("package.json")).ok()?;
    serde_json::from_str(&content).ok()
}

fn collect_auto_extensions(dir: &Path, scope: &str, disabled: &HashSet<String>, resources: &mut Vec<serde_json::Value>) -> RpcResult<()> {
    if !dir.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(|error| format!("failed to read extensions directory: {error}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_extension = path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("ts")
            || path.is_dir() && path.join("index.ts").exists();
        if !is_extension {
            continue;
        }
        let disabled_by_pattern = disabled.contains(&normalize_config_path(&display_path(&path)));
        push_extension_resource(resources, path, scope, "auto", !disabled_by_pattern, true, disabled_by_pattern);
    }
    Ok(())
}

fn push_extension_resource(resources: &mut Vec<serde_json::Value>, path: PathBuf, scope: &str, source: &str, enabled: bool, removable: bool, disabled_by_pattern: bool) {
    let name = path.file_stem().or_else(|| path.file_name()).and_then(|value| value.to_str()).unwrap_or("extension").to_string();
    let path_text = display_path(&path);
    resources.push(serde_json::json!({
        "id": path_text,
        "name": name,
        "path": path_text,
        "scope": scope,
        "source": source,
        "enabled": enabled,
        "removable": removable,
        "disabledByPattern": disabled_by_pattern,
    }));
}

fn read_pi_settings_json() -> RpcResult<serde_json::Value> {
    let path = pi_settings_json_path()?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("failed to read settings.json: {error}"))?;
    serde_json::from_str::<serde_json::Value>(&content).map_err(|error| format!("settings.json is invalid JSON: {error}"))
}

fn write_pi_settings_json(settings: &serde_json::Value) -> RpcResult<()> {
    let path = pi_settings_json_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("failed to create settings.json directory: {error}"))?;
    }
    let content = serde_json::to_string_pretty(settings).map_err(|error| format!("failed to serialize settings.json: {error}"))?;
    fs::write(&path, format!("{}\n", content)).map_err(|error| format!("failed to write settings.json: {error}"))
}

fn set_resource_enabled(path: &Path, enabled: bool, setting_key: &str) -> RpcResult<()> {
    if !is_manageable_resource_path(path, setting_key) {
        return Err(format!("{setting_key} path is outside manageable directories"));
    }
    let mut settings = read_pi_settings_json()?;
    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    let object = settings.as_object_mut().ok_or("settings.json root must be object")?;
    let mut resources = object
        .get(setting_key)
        .and_then(|value| value.as_array())
        .map(|items| items.iter().filter_map(|item| item.as_str().map(str::to_string)).collect::<Vec<_>>())
        .unwrap_or_default();
    let path_text = display_path(path);
    let normalized = normalize_config_path(&path_text);
    resources.retain(|item| normalize_config_path(item.trim_start_matches(['!', '-', '+'])) != normalized);
    if !enabled {
        resources.push(format!("!{path_text}"));
    }
    object.insert(setting_key.to_string(), serde_json::Value::Array(resources.into_iter().map(serde_json::Value::String).collect()));
    write_pi_settings_json(&settings)
}

fn normalize_existing_or_candidate_path(path: &str) -> RpcResult<PathBuf> {
    let expanded = expand_config_path(path, &pi_agent_dir()?)?;
    Ok(expanded)
}

fn is_manageable_resource_path(path: &Path, kind: &str) -> bool {
    let normalized = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut roots = Vec::new();
    if let Ok(agent) = pi_agent_dir() {
        roots.push(agent.join(kind));
    }
    if kind == "skills" {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from).or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from)) {
            roots.push(home.join(".agents").join("skills"));
        }
    }
    if let Ok(project) = std::env::current_dir() {
        roots.push(project.join(".pi").join(kind));
        if kind == "skills" {
            roots.push(project.join(".agents").join("skills"));
        }
    }
    roots.into_iter().any(|root| {
        let root = root.canonicalize().unwrap_or(root);
        normalized.starts_with(root)
    })
}

fn expand_config_path(value: &str, base: &Path) -> RpcResult<PathBuf> {
    let trimmed = value.trim().trim_start_matches(['!', '-', '+']);
    if trimmed.is_empty() {
        return Err("extension path is empty".to_string());
    }
    if trimmed == "~" {
        return std::env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
            .ok_or("failed to resolve home directory".to_string());
    }
    if let Some(rest) = trimmed.strip_prefix("~/").or_else(|| trimmed.strip_prefix("~\\")) {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
            .ok_or("failed to resolve home directory".to_string())?;
        return Ok(home.join(rest));
    }
    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(base.join(path))
    }
}

fn normalize_config_path(value: &str) -> String {
    value.trim().trim_start_matches(['!', '-', '+']).replace('\\', "/").to_lowercase()
}

fn pi_agent_dir() -> RpcResult<PathBuf> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .ok_or("failed to resolve home directory for pi settings")?;
    Ok(home.join(".pi").join("agent"))
}

fn cc_switch_db_path() -> RpcResult<PathBuf> {
    if let Ok(forced) = std::env::var("CC_SWITCH_DB") {
        let trimmed = forced.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .ok_or("failed to resolve home directory for cc-switch database")?;
    Ok(home.join(".cc-switch").join("cc-switch.db"))
}

fn sqlite_table_has_column(conn: &Connection, table: &str, column: &str) -> RpcResult<bool> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", safe_sqlite_identifier(table)?))
        .map_err(|error| format!("failed to inspect sqlite table '{table}': {error}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("failed to inspect sqlite columns for '{table}': {error}"))?;
    for row in rows {
        if row.map_err(|error| format!("failed to read sqlite column for '{table}': {error}"))? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn safe_sqlite_identifier(value: &str) -> RpcResult<String> {
    if value.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
        Ok(value.to_string())
    } else {
        Err(format!("unsafe sqlite identifier: {value}"))
    }
}

fn cc_switch_provider_import(_id: &str, app_type: &str, name: &str, config: &serde_json::Value, meta: &serde_json::Value) -> Option<CcSwitchProviderImport> {
    let base_url = first_config_string(
        config,
        &[
            &["baseUrl"],
            &["baseURL"],
            &["apiUrl"],
            &["env", "ANTHROPIC_BASE_URL"],
            &["env", "GOOGLE_GEMINI_BASE_URL"],
            &["env", "OPENAI_BASE_URL"],
            &["env", "BASE_URL"],
            &["options", "baseURL"],
            &["options", "baseUrl"],
        ],
    )
    .or_else(|| extract_toml_value(config.get("config").and_then(|value| value.as_str()).unwrap_or(""), "base_url"))?;

    let api_key = first_config_string(
        config,
        &[
            &["apiKey"],
            &["api_key"],
            &["env", "ANTHROPIC_AUTH_TOKEN"],
            &["env", "ANTHROPIC_API_KEY"],
            &["env", "GEMINI_API_KEY"],
            &["env", "GOOGLE_API_KEY"],
            &["env", "OPENAI_API_KEY"],
            &["env", "API_KEY"],
            &["auth", "OPENAI_API_KEY"],
            &["options", "apiKey"],
            &["options", "api_key"],
        ],
    )
    .map(normalize_cc_switch_secret_ref)
    .unwrap_or_default();

    let mut models = Vec::new();
    collect_config_models(config, &mut models);
    let toml_config = config.get("config").and_then(|value| value.as_str()).unwrap_or("");
    if let Some(model) = extract_toml_value(toml_config, "model") {
        models.push(model);
    }
    models.sort();
    models.dedup();

    let api = infer_cc_switch_api(app_type, &base_url, config, &models);
    let headers = collect_cc_switch_headers(config);
    let balance_base_url = config_string_at(meta, &["usage_script", "baseUrl"]).or_else(|| config_string_at(meta, &["usageScript", "baseUrl"]));
    let balance_api_key = config_string_at(meta, &["usage_script", "apiKey"])
        .or_else(|| config_string_at(meta, &["usageScript", "apiKey"]))
        .map(normalize_cc_switch_secret_ref);
    let provider_slug = safe_provider_key(name);
    let provider_slug = if provider_slug.is_empty() { safe_provider_key(app_type) } else { provider_slug };
    Some(CcSwitchProviderImport {
        provider_key: format!("ccswitch-{}-{}", safe_provider_key(app_type), provider_slug),
        base_url,
        api_key,
        api,
        headers,
        balance_base_url,
        balance_api_key,
        models,
    })
}

fn ensure_unique_provider_keys(imports: &mut [CcSwitchProviderImport]) {
    let mut seen = HashMap::<String, usize>::new();
    for import in imports {
        let base = import.provider_key.clone();
        let count = seen.entry(base.clone()).or_insert(0);
        *count += 1;
        if *count > 1 {
            import.provider_key = format!("{base}-{}", *count);
        }
    }
}

fn first_config_string(config: &serde_json::Value, paths: &[&[&str]]) -> Option<String> {
    paths.iter().find_map(|path| config_string_at(config, path))
}

fn config_string_at(config: &serde_json::Value, path: &[&str]) -> Option<String> {
    let mut value = config;
    for segment in path {
        value = value.get(*segment)?;
    }
    value.as_str().map(str::trim).filter(|value| !value.is_empty()).map(str::to_string)
}

fn collect_config_models(config: &serde_json::Value, output: &mut Vec<String>) {
    for path in [
        &["model"][..],
        &["defaultModel"][..],
        &["env", "ANTHROPIC_MODEL"][..],
        &["env", "ANTHROPIC_DEFAULT_HAIKU_MODEL"][..],
        &["env", "ANTHROPIC_DEFAULT_SONNET_MODEL"][..],
        &["env", "ANTHROPIC_DEFAULT_OPUS_MODEL"][..],
        &["env", "GEMINI_MODEL"][..],
        &["env", "OPENAI_MODEL"][..],
    ] {
        if let Some(model) = config_string_at(config, path) {
            output.push(model);
        }
    }

    if let Some(models) = config.get("models").and_then(|value| value.as_object()) {
        for (id, value) in models {
            output.push(id.clone());
            if let Some(name) = value.get("name").and_then(|item| item.as_str()).filter(|item| !item.trim().is_empty()) {
                output.push(name.trim().to_string());
            }
        }
    }
}

fn collect_cc_switch_headers(config: &serde_json::Value) -> HashMap<String, String> {
    let mut headers = HashMap::new();
    for path in [&["headers"][..], &["customHeaders"][..], &["options", "headers"][..]] {
        let mut value = config;
        let mut found = true;
        for segment in path {
            match value.get(*segment) {
                Some(next) => value = next,
                None => {
                    found = false;
                    break;
                }
            }
        }
        if !found {
            continue;
        }
        if let Some(object) = value.as_object() {
            for (key, value) in object {
                if let Some(text) = value.as_str().map(str::trim).filter(|item| !item.is_empty()) {
                    headers.insert(key.clone(), normalize_cc_switch_secret_ref(text.to_string()));
                }
            }
        }
    }
    headers
}

fn normalize_cc_switch_secret_ref(value: String) -> String {
    let trimmed = value.trim();
    if let Some(inner) = trimmed.strip_prefix("{env:").and_then(|item| item.strip_suffix('}')) {
        return inner.trim().to_string();
    }
    trimmed.trim_start_matches('$').to_string()
}

fn extract_toml_value(content: &str, key: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || !trimmed.starts_with(key) {
            continue;
        }
        let Some((left, right)) = trimmed.split_once('=') else {
            continue;
        };
        if left.trim() != key {
            continue;
        }
        let value = right.trim().trim_matches('"').trim_matches('\'').trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

fn infer_cc_switch_api(app_type: &str, base_url: &str, config: &serde_json::Value, models: &[String]) -> String {
    let app = app_type.to_lowercase();
    let base = base_url.to_lowercase();
    if app.contains("claude") || base.contains("anthropic") || models.iter().any(|model| model.starts_with("claude-")) {
        return "anthropic-messages".to_string();
    }
    if app.contains("gemini") || base.contains("generativelanguage") || models.iter().any(|model| model.starts_with("gemini-")) {
        return "google-generative-ai".to_string();
    }
    if config.get("config").and_then(|value| value.as_str()).map(|value| value.contains("wire_api = \"responses\"")).unwrap_or(false) {
        return "openai-responses".to_string();
    }
    "openai-completions".to_string()
}

fn safe_provider_key(value: &str) -> String {
    let mut key = value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch.to_ascii_lowercase() } else { '-' })
        .collect::<String>();
    while key.contains("--") {
        key = key.replace("--", "-");
    }
    key.trim_matches('-').to_string()
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

fn provider_balance_urls(base_url: &str) -> Vec<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut root = trimmed.to_string();
    for suffix in ["/api/v1", "/v1"] {
        if root.ends_with(suffix) {
            root.truncate(root.len() - suffix.len());
            break;
        }
    }
    let mut urls = Vec::new();
    for base in [root.as_str(), trimmed] {
        for suffix in [
            "/dashboard/billing/credit_grants",
            "/v1/dashboard/billing/credit_grants",
            "/api/v1/dashboard/billing/credit_grants",
            "/user/balance",
            "/v1/user/balance",
            "/api/v1/user/balance",
            "/api/user/self",
            "/v1/api/user/self",
            "/api/v1/api/user/self",
            "/usage",
            "/v1/usage",
            "/api/v1/usage",
            "/credits",
            "/v1/credits",
            "/api/v1/credits",
        ] {
            urls.push(format!("{base}{suffix}"));
        }
    }
    urls.sort();
    urls.dedup();
    urls
}

fn summarize_provider_balance(value: &serde_json::Value) -> Option<String> {
    if let Some(summary) = summarize_quota_balance(value) {
        return Some(summary);
    }

    if let Some(quota) = value.get("quota").filter(|item| item.is_object()) {
        if let Some(summary) = summarize_provider_balance(quota) {
            return Some(summary);
        }
    }

    let unit = value.get("unit").and_then(|item| item.as_str()).unwrap_or("USD");
    for key in [
        "total_available",
        "remaining",
        "remain",
        "available",
        "balance",
        "amount",
        "credit",
        "credits",
        "quota",
        "hard_limit_usd",
        "soft_limit_usd",
        "used_quota",
        "total_granted",
        "total_used",
    ] {
        if let Some(summary) = balance_number_or_string(value.get(key), unit) {
            return Some(format!("{key}: {summary}"));
        }
    }

    if let Some(data) = value.get("data") {
        if let Some(summary) = summarize_provider_balance(data) {
            return Some(summary);
        }
    }

    if let Some(object) = value.as_object() {
        let pairs = object
            .iter()
            .filter_map(|(key, value)| json_number_or_string(Some(value)).map(|summary| format!("{key}: {summary}")))
            .take(3)
            .collect::<Vec<_>>();
        if !pairs.is_empty() {
            return Some(pairs.join(" · "));
        }
    }

    None
}

fn summarize_quota_balance(value: &serde_json::Value) -> Option<String> {
    let quota = json_number_value(value.get("quota"));
    let used_quota = json_number_value(value.get("used_quota").or_else(|| value.get("usedQuota")));
    let total_quota = json_number_value(value.get("total_quota").or_else(|| value.get("totalQuota")));
    match (quota, used_quota, total_quota) {
        (Some(quota), Some(used), _) => Some(format!("remaining: {} · used: {}", format_quota_value(quota), format_quota_value(used))),
        (Some(quota), None, Some(total)) => Some(format!("remaining: {} · total: {}", format_quota_value(quota), format_quota_value(total))),
        _ => None,
    }
}

fn json_number_value(value: Option<&serde_json::Value>) -> Option<f64> {
    let value = value?;
    value.as_f64().or_else(|| value.as_str()?.trim().parse::<f64>().ok())
}

fn format_quota_value(value: f64) -> String {
    if value.abs() >= 10_000.0 {
        return format!("{} USD", format_compact_number(value / 500_000.0));
    }
    format!("{} USD", format_compact_number(value))
}

fn format_compact_number(value: f64) -> String {
    format!("{value:.1}")
}

fn json_number_or_string(value: Option<&serde_json::Value>) -> Option<String> {
    let value = value?;
    if let Some(number) = value.as_f64() {
        let formatted = format!("{number:.4}");
        let trimmed = formatted.trim_end_matches('0').trim_end_matches('.');
        return Some(if trimmed.is_empty() { "0".to_string() } else { trimmed.to_string() });
    }
    value.as_str().filter(|item| !item.trim().is_empty()).map(str::to_string)
}

fn balance_number_or_string(value: Option<&serde_json::Value>, unit: &str) -> Option<String> {
    let value = value?;
    if let Some(number) = value.as_f64() {
        return Some(format!("{} {}", format_compact_number(number), normalize_balance_unit(unit)));
    }
    let text = value.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    if text.chars().any(|ch| ch.is_ascii_alphabetic() || ch == '$' || ch == '¥' || ch == '€' || ch == '￥') {
        Some(text.to_string())
    } else {
        Some(format!("{text} {}", normalize_balance_unit(unit)))
    }
}

fn normalize_balance_unit(unit: &str) -> &str {
    let trimmed = unit.trim();
    if trimmed.is_empty() { "USD" } else { trimmed }
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
fn pi_rpc_start(app: AppHandle, state: State<'_, RpcState>, cwd: Option<String>) -> RpcResult<()> {
    let mut slot = state.process.lock().map_err(|error| error.to_string())?;
    if slot.is_some() {
        return Ok(());
    }

    let cwd_path = match cwd.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => Some(safe_root(value)?),
        None => None,
    };
    let pi_bin = std::env::var("PI_BIN").unwrap_or_else(|_| default_pi_bin());
    let mut command = background_command(pi_bin);
    command.args(["--mode", "rpc", "--no-session", "--offline"]);
    if let Some(path) = cwd_path {
        command.current_dir(path);
    }
    let mut child = command
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
    let mut child = background_command(sidecar_bin)
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
    open_path_with_target(&project_path, &target)
}

#[tauri::command]
fn pi_open_code_file_with(path: String, target: String) -> RpcResult<()> {
    let file_path = safe_root(&path)?;
    open_path_with_target(&file_path, &target)
}

fn open_path_with_target(path: &Path, target: &str) -> RpcResult<()> {
    match target {
        "fileManager" => open_file_manager(path),
        "terminal" => open_terminal(path.parent().unwrap_or(path)),
        "vscode" => open_editor(path, "vscode", "code", "Code.exe"),
        "cursor" => open_editor(path, "cursor", "cursor", "Cursor.exe"),
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

#[tauri::command]
async fn pi_git_file_diff(cwd: String, path: String, staged: bool) -> RpcResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || pi_git_file_diff_blocking(cwd, path, staged))
        .await
        .map_err(|error| format!("git file diff task failed: {error}"))?
}

fn pi_git_file_diff_blocking(cwd: String, path: String, staged: bool) -> RpcResult<serde_json::Value> {
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
async fn pi_git_generate_commit_message(cwd: String, model: Option<String>, provider: Option<String>, thinking_level: Option<String>) -> RpcResult<String> {
    tauri::async_runtime::spawn_blocking(move || pi_git_generate_commit_message_blocking(cwd, model, provider, thinking_level))
        .await
        .map_err(|error| format!("git commit message task failed: {error}"))?
}

fn pi_git_generate_commit_message_blocking(cwd: String, model: Option<String>, provider: Option<String>, thinking_level: Option<String>) -> RpcResult<String> {
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

fn generate_commit_message_via_provider(model: Option<String>, provider: Option<String>, thinking_level: Option<String>, prompt: &str, context: &str) -> RpcResult<String> {
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

fn resolve_commit_model_config(model: Option<String>, provider: Option<String>, thinking_level: Option<String>) -> RpcResult<CommitModelConfig> {
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

fn read_models_json() -> RpcResult<serde_json::Value> {
    let path = pi_models_json_path()?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("failed to read models.json: {error}"))?;
    serde_json::from_str::<serde_json::Value>(&content).map_err(|error| format!("models.json is invalid JSON: {error}"))
}

fn split_model_key_for_commit(value: &str) -> Option<(Option<String>, Option<String>)> {
    value.split_once('/').map(|(provider, model)| (Some(provider.to_string()), Some(model.to_string())))
}

fn find_model_config<'a>(provider: &'a serde_json::Value, model_id: &str) -> Option<&'a serde_json::Value> {
    provider.get("models")?.as_array()?.iter().find(|item| item.get("id").and_then(|value| value.as_str()) == Some(model_id))
}

fn default_base_url_for_api(provider_id: &str, api: &str) -> Option<String> {
    match api {
        "anthropic-messages" => Some("https://api.anthropic.com/v1".to_string()),
        "google-generative-ai" => Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
        "openai-responses" | "openai-completions" | "openai-chat-completions" | "openai" if provider_id == "openai" => Some("https://api.openai.com/v1".to_string()),
        _ => None,
    }
}

fn resolve_secret_value(value: &str) -> RpcResult<String> {
    let trimmed = value.trim();
    if let Some(command) = trimmed.strip_prefix('!') {
        let output = if cfg!(windows) {
            Command::new("cmd.exe").args(["/C", command]).output()
        } else {
            Command::new("sh").args(["-c", command]).output()
        }.map_err(|error| format!("failed to resolve secret command: {error}"))?;
        if !output.status.success() {
            return Err(format!("secret command failed: {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    Ok(std::env::var(trimmed).unwrap_or_else(|_| trimmed.to_string()))
}

fn resolve_header_map(value: Option<&serde_json::Value>) -> RpcResult<HashMap<String, String>> {
    let mut headers = HashMap::new();
    if let Some(object) = value.and_then(|value| value.as_object()) {
        for (key, value) in object {
            if let Some(text) = value.as_str() {
                headers.insert(key.clone(), resolve_secret_value(text)?);
            }
        }
    }
    Ok(headers)
}

fn request_builder_with_auth(client: &reqwest::blocking::Client, config: &CommitModelConfig, url: String) -> reqwest::blocking::RequestBuilder {
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

fn call_openai_chat_completions(client: &reqwest::blocking::Client, config: &CommitModelConfig, prompt: &str, context: &str) -> RpcResult<String> {
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

fn call_openai_responses(client: &reqwest::blocking::Client, config: &CommitModelConfig, prompt: &str, context: &str) -> RpcResult<String> {
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

fn call_anthropic_messages(client: &reqwest::blocking::Client, config: &CommitModelConfig, prompt: &str, context: &str) -> RpcResult<String> {
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

fn call_google_generate_content(client: &reqwest::blocking::Client, config: &CommitModelConfig, prompt: &str, context: &str) -> RpcResult<String> {
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

fn reasoning_effort(level: Option<&str>) -> Option<&'static str> {
    match level {
        Some("minimal") => Some("minimal"),
        Some("low") => Some("low"),
        Some("medium") => Some("medium"),
        Some("high") | Some("xhigh") => Some("high"),
        _ => None,
    }
}

fn send_json_request(request: reqwest::blocking::RequestBuilder, body: serde_json::Value) -> RpcResult<serde_json::Value> {
    let response = request.json(&body).send().map_err(|error| format!("commit message request failed: {error}"))?;
    let status = response.status();
    let text = response.text().map_err(|error| format!("failed to read commit message response: {error}"))?;
    if !status.is_success() {
        return Err(format!("commit message request failed with {status}: {text}"));
    }
    serde_json::from_str(&text).map_err(|error| format!("commit message response is invalid JSON: {error}"))
}

fn extract_openai_response_text(value: &serde_json::Value) -> Option<String> {
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

fn git_diff_allow_nonzero(cwd: &Path, args: &[&str]) -> RpcResult<String> {
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
    spawn_editor_cli(cli_name, std::slice::from_ref(&path_arg))
        .or_else(|_| open_editor_from_registry(path, target))
        .or_else(|_| open_editor_from_common_paths(path, exe_name))
}

#[cfg(windows)]
fn spawn_editor_cli(cli_name: &str, args: &[String]) -> RpcResult<()> {
    let mut errors = Vec::new();
    for program in [cli_name.to_string(), format!("{cli_name}.cmd"), format!("{cli_name}.exe")] {
        match spawn_windows_program(&program, args) {
            Ok(()) => return Ok(()),
            Err(error) => errors.push(error),
        }
    }

    let output = Command::new("where.exe")
        .arg(cli_name)
        .output()
        .map_err(|error| format!("failed to locate {cli_name}: {error}; {}", errors.join("; ")))?;
    for line in String::from_utf8_lossy(&output.stdout).lines().map(str::trim).filter(|line| !line.is_empty()) {
        match spawn_windows_program(line, args) {
            Ok(()) => return Ok(()),
            Err(error) => errors.push(error),
        }
    }

    Err(format!("failed to launch {cli_name}: {}", errors.join("; ")))
}

#[cfg(not(windows))]
fn spawn_editor_cli(cli_name: &str, args: &[String]) -> RpcResult<()> {
    spawn_app(cli_name, args)
}

#[cfg(windows)]
fn spawn_windows_program(program: &str, args: &[String]) -> RpcResult<()> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let lower = program.to_lowercase();
    if lower.ends_with(".cmd") || lower.ends_with(".bat") {
        return Command::new("cmd.exe")
            .args(["/C", program])
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("failed to open {program}: {error}"));
    }

    Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to open {program}: {error}"))
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
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let path_value = path.to_string_lossy();
    let replaced = command.replace("%1", &path_value).replace("%V", &path_value).replace("%v", &path_value);
    Command::new("cmd.exe")
        .args(["/C", "start", "", &replaced])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to run registry command: {error}"))
}

fn open_file_manager(path: &Path) -> RpcResult<()> {
    if cfg!(windows) {
        spawn_app("explorer.exe", &[path.to_string_lossy().to_string()])
    } else if cfg!(target_os = "macos") {
        spawn_app("open", &[path.to_string_lossy().to_string()])
    } else {
        spawn_app("xdg-open", &[path.to_string_lossy().to_string()])
    }
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

fn os_null_path() -> &'static str {
    if cfg!(windows) { "NUL" } else { "/dev/null" }
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
            pi_settings_json_read,
            pi_models_json_write,
            pi_sync_cc_switch_models,
            pi_fetch_provider_models,
            pi_test_provider,
            pi_probe_provider,
            pi_probe_configured_provider,
            pi_skill_resources,
            pi_skill_set_enabled,
            pi_skill_delete,
            pi_extension_resources,
            pi_extension_set_enabled,
            pi_extension_delete,
            pi_settings_enable_models,
            pi_settings_set_provider_enabled,
            pi_settings_set_provider_model_selection,
            pi_rpc_start,
            pi_rpc_send,
            pi_rpc_stop,
            pi_sdk_sidecar_start,
            pi_sdk_sidecar_send,
            pi_sdk_sidecar_stop,
            pi_list_sessions,
            pi_read_session_messages,
            pi_open_project_with,
            pi_open_code_file_with,
            pi_delete_session,
            pi_session_tree,
            pi_set_session_label,
            pi_list_files,
            pi_read_file,
            pi_git_status,
            pi_git_log,
            pi_git_action,
            pi_git_file_diff,
            pi_git_sync,
            pi_git_commit,
            pi_git_generate_commit_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
