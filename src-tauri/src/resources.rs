use super::*;

#[tauri::command]
pub(crate) fn pi_skill_resources(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
    let cwd_path = if cwd.trim().is_empty() || cwd == "unknown cwd" || cwd == "Unknown cwd" {
        std::env::current_dir().map_err(|error| format!("failed to resolve current directory: {error}"))?
    } else {
        safe_root(&cwd)?
    };
    list_skill_resources(&cwd_path)
}

#[tauri::command]
pub(crate) fn pi_skill_set_enabled(path: String, enabled: bool) -> RpcResult<Vec<serde_json::Value>> {
    let target_path = normalize_existing_or_candidate_path(&path)?;
    let cwd = std::env::current_dir().map_err(|error| format!("failed to resolve current directory: {error}"))?;
    set_resource_enabled(&target_path, enabled, "skills")?;
    list_skill_resources(&cwd)
}

#[tauri::command]
pub(crate) fn pi_skill_delete(path: String) -> RpcResult<()> {
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
pub(crate) fn pi_extension_resources(cwd: String) -> RpcResult<Vec<serde_json::Value>> {
    let cwd_path = if cwd.trim().is_empty() || cwd == "unknown cwd" || cwd == "Unknown cwd" {
        std::env::current_dir().map_err(|error| format!("failed to resolve current directory: {error}"))?
    } else {
        safe_root(&cwd)?
    };
    list_extension_resources(&cwd_path)
}

#[tauri::command]
pub(crate) fn pi_extension_set_enabled(path: String, enabled: bool) -> RpcResult<Vec<serde_json::Value>> {
    let target_path = normalize_existing_or_candidate_path(&path)?;
    let cwd = std::env::current_dir().map_err(|error| format!("failed to resolve current directory: {error}"))?;
    set_resource_enabled(&target_path, enabled, "extensions")?;
    list_extension_resources(&cwd)
}

#[tauri::command]
pub(crate) fn pi_extension_delete(path: String) -> RpcResult<()> {
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

pub(crate) fn list_skill_resources(cwd: &Path) -> RpcResult<Vec<serde_json::Value>> {
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

pub(crate) fn collect_skill_dir(dir: &Path, scope: &str, disabled: &HashSet<String>, resources: &mut Vec<serde_json::Value>) -> RpcResult<()> {
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

pub(crate) fn list_extension_resources(cwd: &Path) -> RpcResult<Vec<serde_json::Value>> {
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

pub(crate) fn collect_package_resources(settings: &serde_json::Value, kind: &str, disabled: &HashSet<String>, resources: &mut Vec<serde_json::Value>) -> RpcResult<()> {
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

pub(crate) fn collect_package_extension_path(path: &Path, disabled: &HashSet<String>, resources: &mut Vec<serde_json::Value>) {
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

pub(crate) fn collect_package_skill_path(path: &Path, disabled: &HashSet<String>, resources: &mut Vec<serde_json::Value>) -> RpcResult<()> {
    if path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("md") {
        let disabled_by_pattern = disabled.contains(&normalize_config_path(&display_path(path)));
        push_extension_resource(resources, path.to_path_buf(), "package", "package", !disabled_by_pattern, false, disabled_by_pattern);
    } else if path.is_dir() {
        collect_skill_dir(path, "package", disabled, resources)?;
    }
    Ok(())
}

pub(crate) fn resolve_package_root(source: &str) -> RpcResult<Option<PathBuf>> {
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

pub(crate) fn strip_npm_version(spec: &str) -> String {
    if spec.starts_with('@') {
        let at_positions = spec.match_indices('@').map(|(index, _)| index).collect::<Vec<_>>();
        if at_positions.len() > 1 {
            return spec[..*at_positions.last().unwrap()].to_string();
        }
        return spec.to_string();
    }
    spec.split('@').next().unwrap_or(spec).to_string()
}

pub(crate) fn npm_global_roots() -> Vec<PathBuf> {
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

pub(crate) fn read_package_json(path: &Path) -> Option<serde_json::Value> {
    let content = fs::read_to_string(path.join("package.json")).ok()?;
    serde_json::from_str(&content).ok()
}

pub(crate) fn collect_auto_extensions(dir: &Path, scope: &str, disabled: &HashSet<String>, resources: &mut Vec<serde_json::Value>) -> RpcResult<()> {
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

pub(crate) fn push_extension_resource(resources: &mut Vec<serde_json::Value>, path: PathBuf, scope: &str, source: &str, enabled: bool, removable: bool, disabled_by_pattern: bool) {
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

