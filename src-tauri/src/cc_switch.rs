use super::*;
use rusqlite::{Connection, OpenFlags};

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

#[tauri::command]
pub(crate) fn pi_sync_cc_switch_models() -> RpcResult<serde_json::Value> {
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

pub(crate) fn cc_switch_db_path() -> RpcResult<PathBuf> {
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

pub(crate) fn sqlite_table_has_column(conn: &Connection, table: &str, column: &str) -> RpcResult<bool> {
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

pub(crate) fn safe_sqlite_identifier(value: &str) -> RpcResult<String> {
    if value.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
        Ok(value.to_string())
    } else {
        Err(format!("unsafe sqlite identifier: {value}"))
    }
}

pub(crate) fn cc_switch_provider_import(_id: &str, app_type: &str, name: &str, config: &serde_json::Value, meta: &serde_json::Value) -> Option<CcSwitchProviderImport> {
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

pub(crate) fn ensure_unique_provider_keys(imports: &mut [CcSwitchProviderImport]) {
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

pub(crate) fn first_config_string(config: &serde_json::Value, paths: &[&[&str]]) -> Option<String> {
    paths.iter().find_map(|path| config_string_at(config, path))
}

pub(crate) fn config_string_at(config: &serde_json::Value, path: &[&str]) -> Option<String> {
    let mut value = config;
    for segment in path {
        value = value.get(*segment)?;
    }
    value.as_str().map(str::trim).filter(|value| !value.is_empty()).map(str::to_string)
}

pub(crate) fn collect_config_models(config: &serde_json::Value, output: &mut Vec<String>) {
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

pub(crate) fn collect_cc_switch_headers(config: &serde_json::Value) -> HashMap<String, String> {
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

pub(crate) fn normalize_cc_switch_secret_ref(value: String) -> String {
    let trimmed = value.trim();
    if let Some(inner) = trimmed.strip_prefix("{env:").and_then(|item| item.strip_suffix('}')) {
        return inner.trim().to_string();
    }
    trimmed.trim_start_matches('$').to_string()
}

pub(crate) fn extract_toml_value(content: &str, key: &str) -> Option<String> {
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

pub(crate) fn infer_cc_switch_api(app_type: &str, base_url: &str, config: &serde_json::Value, models: &[String]) -> String {
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

pub(crate) fn safe_provider_key(value: &str) -> String {
    let mut key = value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch.to_ascii_lowercase() } else { '-' })
        .collect::<String>();
    while key.contains("--") {
        key = key.replace("--", "-");
    }
    key.trim_matches('-').to_string()
}

