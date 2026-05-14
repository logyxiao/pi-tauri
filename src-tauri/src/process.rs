use super::*;

pub(crate) struct RpcProcess {
    child: Child,
    stdin: ChildStdin,
}

pub(crate) struct SdkSidecarProcess {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub(crate) struct RpcState {
    process: Arc<Mutex<Option<RpcProcess>>>,
}

#[derive(Default)]
pub(crate) struct SdkSidecarState {
    process: Arc<Mutex<Option<SdkSidecarProcess>>>,
}

pub(crate) fn background_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub(crate) fn resolve_pi_bin() -> String {
    if let Ok(value) = std::env::var("PI_BIN") {
        if !value.trim().is_empty() {
            return value;
        }
    }
    resolve_program(&["pi.cmd", "pi.exe", "pi"]).unwrap_or_else(default_pi_bin)
}

pub(crate) fn resolve_program(names: &[&str]) -> Option<String> {
    for name in names {
        let path = PathBuf::from(name);
        if (path.is_absolute() || name.contains(std::path::MAIN_SEPARATOR)) && path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    for dir in candidate_program_dirs() {
        for name in names {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }

    None
}

pub(crate) fn candidate_program_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::<PathBuf>::new();
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }

    #[cfg(windows)]
    {
        push_env_joined(&mut dirs, "APPDATA", &["npm"]);
        push_env_joined(&mut dirs, "LOCALAPPDATA", &["pnpm"]);
        push_env_joined(&mut dirs, "LOCALAPPDATA", &["Volta", "bin"]);
        push_env_joined(&mut dirs, "VOLTA_HOME", &["bin"]);
        push_env_joined(&mut dirs, "SCOOP", &["shims"]);
        push_env_joined(&mut dirs, "SCOOP", &["apps", "volta", "current", "appdata", "bin"]);
        push_env_joined(&mut dirs, "SCOOP_GLOBAL", &["shims"]);
        push_env_joined(&mut dirs, "SCOOP_GLOBAL", &["apps", "volta", "current", "appdata", "bin"]);
        push_env_joined(&mut dirs, "USERPROFILE", &["scoop", "shims"]);
        push_env_joined(&mut dirs, "USERPROFILE", &["scoop", "apps", "volta", "current", "appdata", "bin"]);
    }

    #[cfg(not(windows))]
    {
        push_env_joined(&mut dirs, "HOME", &[".local", "bin"]);
        push_env_joined(&mut dirs, "HOME", &[".npm-global", "bin"]);
    }

    dedupe_paths(dirs)
}

pub(crate) fn push_env_joined(dirs: &mut Vec<PathBuf>, env_key: &str, parts: &[&str]) {
    let Ok(root) = std::env::var(env_key) else {
        return;
    };
    if root.trim().is_empty() {
        return;
    }
    let mut path = PathBuf::from(root);
    for part in parts {
        path.push(part);
    }
    dirs.push(path);
}

pub(crate) fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::<String>::new();
    let mut deduped = Vec::new();
    for path in paths {
        let key = path.to_string_lossy().replace('\\', "/").to_ascii_lowercase();
        if seen.insert(key) {
            deduped.push(path);
        }
    }
    deduped
}

#[tauri::command]
pub(crate) fn pi_rpc_start(app: AppHandle, state: State<'_, RpcState>, cwd: Option<String>) -> RpcResult<()> {
    let mut slot = state.process.lock().map_err(|error| error.to_string())?;
    if slot.is_some() {
        return Ok(());
    }

    let cwd_path = match cwd.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => Some(safe_root(value)?),
        None => None,
    };
    let pi_bin = resolve_pi_bin();
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
pub(crate) fn pi_rpc_send(state: State<'_, RpcState>, message: String) -> RpcResult<()> {
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
pub(crate) fn pi_rpc_stop(state: State<'_, RpcState>) -> RpcResult<()> {
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
pub(crate) fn pi_sdk_sidecar_start(app: AppHandle, state: State<'_, SdkSidecarState>) -> RpcResult<()> {
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
pub(crate) fn pi_sdk_sidecar_send(state: State<'_, SdkSidecarState>, message: String) -> RpcResult<()> {
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
pub(crate) fn pi_sdk_sidecar_stop(state: State<'_, SdkSidecarState>) -> RpcResult<()> {
    let mut slot = state.process.lock().map_err(|error| error.to_string())?;
    if let Some(mut process) = slot.take() {
        process
            .child
            .kill()
            .map_err(|error| format!("failed to kill pi sdk sidecar: {error}"))?;
    }
    Ok(())
}

pub(crate) fn spawn_stdout_reader(app: AppHandle, stdout: std::process::ChildStdout) {
    spawn_named_stdout_reader(app, "pi-rpc-message", "pi-rpc-error", stdout);
}

pub(crate) fn spawn_named_stdout_reader(app: AppHandle, message_event: &'static str, error_event: &'static str, stdout: std::process::ChildStdout) {
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

pub(crate) fn spawn_stderr_reader(app: AppHandle, stderr: std::process::ChildStderr) {
    spawn_named_stderr_reader(app, "pi-rpc-stderr", "pi-rpc-error", stderr);
}

pub(crate) fn spawn_named_stderr_reader(app: AppHandle, stderr_event: &'static str, error_event: &'static str, stderr: std::process::ChildStderr) {
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

