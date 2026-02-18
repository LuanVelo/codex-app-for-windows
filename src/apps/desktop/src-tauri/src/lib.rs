use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::Instant;

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
            let relative = path.strip_prefix(&workspace).ok()?.to_string_lossy().replace('\\', "/");
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            run_terminal_command,
            list_workspace_entries,
            read_workspace_file,
            write_workspace_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
