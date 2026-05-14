use super::*;

#[tauri::command]
pub(crate) fn pi_models_json_read() -> RpcResult<serde_json::Value> {
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
pub(crate) fn pi_settings_json_read() -> RpcResult<serde_json::Value> {
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
pub(crate) fn pi_settings_enable_models(models: Vec<String>) -> RpcResult<serde_json::Value> {
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
pub(crate) fn pi_models_json_write(content: String) -> RpcResult<serde_json::Value> {
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
pub(crate) fn pi_settings_set_provider_enabled(provider_id: String, enabled: bool, models: Vec<String>) -> RpcResult<serde_json::Value> {
    let enable_patterns = if enabled { vec![provider_id.clone()] } else { Vec::new() };
    let disable_patterns = if enabled { Vec::new() } else { vec![provider_id.clone()] };
    sync_provider_enabled_models(enable_patterns, disable_patterns, models)
}

#[tauri::command]
pub(crate) fn pi_settings_set_provider_model_selection(provider_id: String, provider_enabled: bool, enabled_models: Vec<String>, disabled_models: Vec<String>, legacy_models_to_remove: Vec<String>) -> RpcResult<serde_json::Value> {
    sync_provider_model_selection(&provider_id, provider_enabled, enabled_models, disabled_models, legacy_models_to_remove)
}

pub(crate) fn sync_provider_model_selection(provider_id: &str, provider_enabled: bool, enabled_models: Vec<String>, disabled_models: Vec<String>, legacy_models_to_remove: Vec<String>) -> RpcResult<serde_json::Value> {
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

pub(crate) fn sync_provider_enabled_models(enabled_providers: Vec<String>, disabled_providers: Vec<String>, legacy_models_to_remove: Vec<String>) -> RpcResult<serde_json::Value> {
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

pub(crate) fn provider_wildcard_model(provider: &str) -> String {
    format!("{}/*", provider.trim())
}

pub(crate) fn pi_models_json_path() -> RpcResult<PathBuf> {
    Ok(pi_agent_dir()?.join("models.json"))
}

pub(crate) fn pi_settings_json_path() -> RpcResult<PathBuf> {
    Ok(pi_agent_dir()?.join("settings.json"))
}

pub(crate) fn read_pi_settings_json() -> RpcResult<serde_json::Value> {
    let path = pi_settings_json_path()?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("failed to read settings.json: {error}"))?;
    serde_json::from_str::<serde_json::Value>(&content).map_err(|error| format!("settings.json is invalid JSON: {error}"))
}

pub(crate) fn write_pi_settings_json(settings: &serde_json::Value) -> RpcResult<()> {
    let path = pi_settings_json_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("failed to create settings.json directory: {error}"))?;
    }
    let content = serde_json::to_string_pretty(settings).map_err(|error| format!("failed to serialize settings.json: {error}"))?;
    fs::write(&path, format!("{}\n", content)).map_err(|error| format!("failed to write settings.json: {error}"))
}

pub(crate) fn set_resource_enabled(path: &Path, enabled: bool, setting_key: &str) -> RpcResult<()> {
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

pub(crate) fn normalize_existing_or_candidate_path(path: &str) -> RpcResult<PathBuf> {
    let expanded = expand_config_path(path, &pi_agent_dir()?)?;
    Ok(expanded)
}

pub(crate) fn is_manageable_resource_path(path: &Path, kind: &str) -> bool {
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

pub(crate) fn expand_config_path(value: &str, base: &Path) -> RpcResult<PathBuf> {
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

pub(crate) fn normalize_config_path(value: &str) -> String {
    value.trim().trim_start_matches(['!', '-', '+']).replace('\\', "/").to_lowercase()
}

pub(crate) fn pi_agent_dir() -> RpcResult<PathBuf> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .ok_or("failed to resolve home directory for pi settings")?;
    Ok(home.join(".pi").join("agent"))
}

pub(crate) fn default_models_json() -> String {
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

