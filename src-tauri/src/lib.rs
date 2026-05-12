use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use tauri::{AppHandle, Emitter, State};

type RpcResult<T> = Result<T, String>;

struct RpcProcess {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
struct RpcState {
    process: Arc<Mutex<Option<RpcProcess>>>,
}

#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "Pi Desktop",
        "goal": "Desktop workbench for pi coding agent"
    })
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

fn spawn_stdout_reader(app: AppHandle, stdout: std::process::ChildStdout) {
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    let trimmed = line.strip_suffix('\r').unwrap_or(&line);
                    match serde_json::from_str::<serde_json::Value>(trimmed) {
                        Ok(value) => {
                            let _ = app.emit("pi-rpc-message", value);
                        }
                        Err(error) => {
                            let _ = app.emit(
                                "pi-rpc-error",
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
                        "pi-rpc-error",
                        serde_json::json!({"source": "stdout", "error": error.to_string()}),
                    );
                    break;
                }
            }
        }
    });
}

fn spawn_stderr_reader(app: AppHandle, stderr: std::process::ChildStderr) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    let trimmed = line.strip_suffix('\r').unwrap_or(&line);
                    if !trimmed.trim().is_empty() {
                        let _ = app.emit(
                            "pi-rpc-stderr",
                            serde_json::json!({"line": trimmed}),
                        );
                    }
                }
                Err(error) => {
                    let _ = app.emit(
                        "pi-rpc-error",
                        serde_json::json!({"source": "stderr", "error": error.to_string()}),
                    );
                    break;
                }
            }
        }
    });
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
        .manage(RpcState::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            pi_rpc_start,
            pi_rpc_send,
            pi_rpc_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
