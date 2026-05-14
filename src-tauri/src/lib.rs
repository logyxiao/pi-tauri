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

use tauri::{AppHandle, Emitter, State};

type RpcResult<T> = Result<T, String>;

mod cc_switch;
mod files;
mod git;
mod process;
mod prompt_optimize;
mod provider_probe;
mod resources;
mod sessions;
mod settings;
mod system_open;

use cc_switch::*;
use files::*;
use git::*;
use process::*;
use prompt_optimize::*;
use provider_probe::*;
use resources::*;
use sessions::*;
use settings::*;
use system_open::*;

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

fn read_models_json() -> RpcResult<serde_json::Value> {
    let path = pi_models_json_path()?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("failed to read models.json: {error}"))?;
    serde_json::from_str::<serde_json::Value>(&content).map_err(|error| format!("models.json is invalid JSON: {error}"))
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

fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    value
        .strip_prefix("//?/")
        .or_else(|| value.strip_prefix("/?/"))
        .unwrap_or(&value)
        .to_string()
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

macro_rules! pi_invoke_handlers {
    () => {
        tauri::generate_handler![
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
            pi_git_generate_commit_message,
            pi_optimize_prompt_keywords
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(RpcState::default())
        .manage(SdkSidecarState::default())
        .invoke_handler(pi_invoke_handlers!())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
