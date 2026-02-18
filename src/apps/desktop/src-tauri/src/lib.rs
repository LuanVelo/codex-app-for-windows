use keyring::{Entry, Error as KeyringError};
use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

const TOKEN_SERVICE: &str = "codex-app-for-windows";
const TOKEN_ACCOUNT: &str = "oauth-refresh-token";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
    duration_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceEntry {
    name: String,
    relative_path: String,
    is_dir: bool,
    size: u64,
}

fn ensure_safe_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative_path);
    if rel.is_absolute() {
        return Err("Relative path expected.".to_string());
    }

    for component in rel.components() {
        if matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return Err("Path traversal is not allowed.".to_string());
        }
    }

    Ok(rel.to_path_buf())
}

fn canonical_workspace(workspace_path: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(workspace_path)
        .map_err(|err| format!("Invalid workspace path: {err}"))?;

    if !canonical.is_dir() {
        return Err("Workspace path must be a directory.".to_string());
    }

    Ok(canonical)
}

fn resolve_workspace_target(workspace_root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let rel = ensure_safe_relative_path(relative_path)?;
    let joined = workspace_root.join(rel);

    if !joined.starts_with(workspace_root) {
        return Err("Target path is outside workspace.".to_string());
    }

    Ok(joined)
}

#[tauri::command]
fn run_terminal_command(workspace_path: String, command: String) -> Result<CommandResult, String> {
    let workspace = canonical_workspace(&workspace_path)?;
    let started = Instant::now();

    let output = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", command.as_str()])
            .current_dir(&workspace)
            .output()
    } else {
        Command::new("sh")
            .args(["-lc", command.as_str()])
            .current_dir(&workspace)
            .output()
    }
    .map_err(|err| format!("Failed to execute command: {err}"))?;

    Ok(CommandResult {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        duration_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
fn list_workspace_entries(
    workspace_path: String,
    relative_path: Option<String>,
) -> Result<Vec<WorkspaceEntry>, String> {
    let workspace = canonical_workspace(&workspace_path)?;
    let rel = relative_path.unwrap_or_default();
    let target = resolve_workspace_target(&workspace, &rel)?;

    if !target.exists() {
        return Err("Directory does not exist.".to_string());
    }

    if !target.is_dir() {
        return Err("Target is not a directory.".to_string());
    }

    let mut items: Vec<WorkspaceEntry> = fs::read_dir(&target)
        .map_err(|err| format!("Failed reading directory: {err}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let meta = entry.metadata().ok()?;
            let relative = path
                .strip_prefix(&workspace)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            Some(WorkspaceEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                relative_path: relative,
                is_dir: meta.is_dir(),
                size: if meta.is_file() { meta.len() } else { 0 },
            })
        })
        .collect();

    items.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(items)
}

#[tauri::command]
fn read_workspace_file(workspace_path: String, relative_path: String) -> Result<String, String> {
    let workspace = canonical_workspace(&workspace_path)?;
    let target = resolve_workspace_target(&workspace, &relative_path)?;

    if !target.exists() {
        return Err("File does not exist.".to_string());
    }

    if !target.is_file() {
        return Err("Target is not a file.".to_string());
    }

    fs::read_to_string(target).map_err(|err| format!("Failed to read file: {err}"))
}

#[tauri::command]
fn write_workspace_file(
    workspace_path: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let workspace = canonical_workspace(&workspace_path)?;
    let target = resolve_workspace_target(&workspace, &relative_path)?;

    if !target.exists() {
        return Err("File does not exist.".to_string());
    }

    if !target.is_file() {
        return Err("Target is not a file.".to_string());
    }

    let mut file = fs::File::create(&target).map_err(|err| format!("Failed to open file: {err}"))?;
    file.write_all(content.as_bytes())
        .map_err(|err| format!("Failed to write file: {err}"))
}

#[tauri::command]
fn wait_for_oauth_callback(port: u16, timeout_secs: Option<u64>) -> Result<String, String> {
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|err| format!("Failed to start callback server: {err}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|err| format!("Failed to set callback server nonblocking: {err}"))?;

    let started = Instant::now();
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(120));

    loop {
        if started.elapsed() > timeout {
            return Err("OAuth callback timeout.".to_string());
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buffer = [0u8; 8192];
                let read = stream
                    .read(&mut buffer)
                    .map_err(|err| format!("Failed to read callback request: {err}"))?;
                let request = String::from_utf8_lossy(&buffer[..read]);
                let first_line = request.lines().next().unwrap_or("");
                let callback_target = first_line
                    .split_whitespace()
                    .nth(1)
                    .ok_or_else(|| "Invalid callback request.".to_string())?;

                let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!doctype html><html><body><h2>Login concluido</h2><p>Voce pode fechar esta aba e voltar para o app.</p></body></html>";

                stream
                    .write_all(response.as_bytes())
                    .map_err(|err| format!("Failed to write callback response: {err}"))?;

                return Ok(format!("http://127.0.0.1:{port}{callback_target}"));
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(err) => return Err(format!("Callback listener failed: {err}")),
        }
    }
}

fn token_entry() -> Result<Entry, String> {
    Entry::new(TOKEN_SERVICE, TOKEN_ACCOUNT).map_err(|err| format!("Token store unavailable: {err}"))
}

#[tauri::command]
fn save_refresh_token(refresh_token: String) -> Result<(), String> {
    let entry = token_entry()?;
    entry
        .set_password(&refresh_token)
        .map_err(|err| format!("Failed to save refresh token: {err}"))
}

#[tauri::command]
fn load_refresh_token() -> Result<Option<String>, String> {
    let entry = token_entry()?;

    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!("Failed to read refresh token: {err}")),
    }
}

#[tauri::command]
fn clear_refresh_token() -> Result<(), String> {
    let entry = token_entry()?;

    match entry.delete_credential() {
        Ok(_) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(format!("Failed to clear refresh token: {err}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            run_terminal_command,
            list_workspace_entries,
            read_workspace_file,
            write_workspace_file,
            wait_for_oauth_callback,
            save_refresh_token,
            load_refresh_token,
            clear_refresh_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
