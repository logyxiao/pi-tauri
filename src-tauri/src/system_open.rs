use super::*;

#[tauri::command]
pub(crate) fn pi_open_project_with(path: String, target: String) -> RpcResult<()> {
    let project_path = safe_root(&path)?;
    open_path_with_target(&project_path, &target)
}

#[tauri::command]
pub(crate) fn pi_open_code_file_with(path: String, target: String) -> RpcResult<()> {
    let file_path = safe_root(&path)?;
    open_path_with_target(&file_path, &target)
}

pub(crate) fn open_path_with_target(path: &Path, target: &str) -> RpcResult<()> {
    match target {
        "fileManager" => open_file_manager(path),
        "terminal" => open_terminal(path.parent().unwrap_or(path)),
        "vscode" => open_editor(path, "vscode", "code", "Code.exe"),
        "cursor" => open_editor(path, "cursor", "cursor", "Cursor.exe"),
        _ => Err(format!("unsupported open target: {target}")),
    }
}

pub(crate) fn open_editor(path: &Path, target: &str, cli_name: &str, exe_name: &str) -> RpcResult<()> {
    let path_arg = path.to_string_lossy().to_string();
    spawn_editor_cli(cli_name, std::slice::from_ref(&path_arg))
        .or_else(|_| open_editor_from_registry(path, target))
        .or_else(|_| open_editor_from_common_paths(path, exe_name))
}

#[cfg(windows)]
pub(crate) fn spawn_editor_cli(cli_name: &str, args: &[String]) -> RpcResult<()> {
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
pub(crate) fn spawn_editor_cli(cli_name: &str, args: &[String]) -> RpcResult<()> {
    spawn_app(cli_name, args)
}

#[cfg(windows)]
pub(crate) fn spawn_windows_program(program: &str, args: &[String]) -> RpcResult<()> {
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
pub(crate) fn open_editor_from_registry(path: &Path, target: &str) -> RpcResult<()> {
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
pub(crate) fn open_editor_from_registry(_path: &Path, target: &str) -> RpcResult<()> {
    Err(format!("registry open command unsupported for {target}"))
}

#[cfg(windows)]
pub(crate) fn open_editor_from_common_paths(path: &Path, exe_name: &str) -> RpcResult<()> {
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
pub(crate) fn open_editor_from_common_paths(_path: &Path, exe_name: &str) -> RpcResult<()> {
    Err(format!("failed to find {exe_name}"))
}

#[cfg(windows)]
pub(crate) fn run_shell_command(command: &str, path: &Path) -> RpcResult<()> {
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

pub(crate) fn open_file_manager(path: &Path) -> RpcResult<()> {
    if cfg!(windows) {
        spawn_app("explorer.exe", &[path.to_string_lossy().to_string()])
    } else if cfg!(target_os = "macos") {
        spawn_app("open", &[path.to_string_lossy().to_string()])
    } else {
        spawn_app("xdg-open", &[path.to_string_lossy().to_string()])
    }
}

pub(crate) fn open_terminal(path: &Path) -> RpcResult<()> {
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

pub(crate) fn spawn_app(program: &str, args: &[String]) -> RpcResult<()> {
    Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to open {program}: {error}"))
}

