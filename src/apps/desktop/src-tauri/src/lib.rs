use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const TOKEN_SERVICE: &str = "codex-app-for-windows";
const TOKEN_ACCOUNT: &str = "oauth-refresh-token";
const API_KEY_ACCOUNT: &str = "openai-api-key";

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectRecord {
    id: String,
    name: String,
    path: String,
    last_accessed_at: i64,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadRecord {
    id: String,
    project_id: String,
    name: String,
    description: String,
    status: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadMessage {
    id: String,
    thread_id: String,
    role: String,
    content: String,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskRecord {
    id: String,
    thread_id: String,
    command: String,
    cwd: String,
    shell: String,
    status: String,
    created_at: i64,
    started_at: Option<i64>,
    finished_at: Option<i64>,
    exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskLogRecord {
    id: String,
    task_id: String,
    stream: String,
    line: String,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    max_parallel_tasks: usize,
    default_shell: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            max_parallel_tasks: 2,
            default_shell: "powershell".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppDb {
    projects: Vec<ProjectRecord>,
    threads: Vec<ThreadRecord>,
    messages: Vec<ThreadMessage>,
    tasks: Vec<TaskRecord>,
    task_logs: Vec<TaskLogRecord>,
    settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatusResult {
    is_repo: bool,
    branch: Option<String>,
    modified_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskStatusEvent {
    task_id: String,
    thread_id: String,
    status: String,
    exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskLogEvent {
    task_id: String,
    thread_id: String,
    stream: String,
    line: String,
}

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

#[derive(Clone)]
struct QueuedTask {
    task_id: String,
    thread_id: String,
    command: String,
    cwd: String,
    shell: String,
}

#[derive(Clone)]
struct AppState {
    db: Arc<Mutex<AppDb>>,
    queue: Arc<Mutex<VecDeque<QueuedTask>>>,
    running: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            db: Arc::new(Mutex::new(AppDb::default())),
            queue: Arc::new(Mutex::new(VecDeque::new())),
            running: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn now_ms() -> i64 {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0));
    duration.as_millis() as i64
}

fn next_id(prefix: &str) -> String {
    let n = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}-{}", prefix, now_ms(), n)
}

fn db_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Unable to resolve app data dir: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("Unable to create app data dir: {err}"))?;
    Ok(dir.join("mvp-db.json"))
}

fn load_db_from_disk(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let path = db_file_path(app)?;
    if !path.exists() {
        save_db_to_disk(app, state)?;
        return Ok(());
    }

    let raw = fs::read_to_string(path).map_err(|err| format!("Failed reading db file: {err}"))?;
    if raw.trim().is_empty() {
        return Ok(());
    }

    let parsed: AppDb = serde_json::from_str(&raw).map_err(|err| format!("Invalid db json: {err}"))?;
    if let Ok(mut db) = state.db.lock() {
        *db = parsed;
    }
    Ok(())
}

fn save_db_to_disk(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let path = db_file_path(app)?;
    let snapshot = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Database lock poisoned".to_string())?;
        serde_json::to_string_pretty(&*db).map_err(|err| format!("Failed serializing db: {err}"))?
    };

    fs::write(path, snapshot).map_err(|err| format!("Failed writing db file: {err}"))
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

fn update_thread_status(state: &AppState, thread_id: &str, status: &str) {
    if let Ok(mut db) = state.db.lock() {
        if let Some(thread) = db.threads.iter_mut().find(|item| item.id == thread_id) {
            thread.status = status.to_string();
            thread.updated_at = now_ms();
        }
    }
}

fn emit_task_status(app: &AppHandle, task_id: &str, thread_id: &str, status: &str, exit_code: Option<i32>) {
    let _ = app.emit(
        "task:status",
        TaskStatusEvent {
            task_id: task_id.to_string(),
            thread_id: thread_id.to_string(),
            status: status.to_string(),
            exit_code,
        },
    );
}

fn append_task_log(app: &AppHandle, state: &AppState, task_id: &str, thread_id: &str, stream: &str, line: &str) {
    if let Ok(mut db) = state.db.lock() {
        db.task_logs.push(TaskLogRecord {
            id: next_id("log"),
            task_id: task_id.to_string(),
            stream: stream.to_string(),
            line: line.to_string(),
            created_at: now_ms(),
        });
    }

    let _ = app.emit(
        if stream == "stderr" {
            "task:stderr"
        } else {
            "task:stdout"
        },
        TaskLogEvent {
            task_id: task_id.to_string(),
            thread_id: thread_id.to_string(),
            stream: stream.to_string(),
            line: line.to_string(),
        },
    );

    let _ = save_db_to_disk(app, state);
}

fn run_shell_command(shell: &str, command: &str, cwd: &str) -> Result<Child, String> {
    let mut process = if cfg!(target_os = "windows") {
        let shell_name = shell.to_lowercase();
        if shell_name.contains("cmd") {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", command]);
            cmd
        } else {
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-Command", command]);
            cmd
        }
    } else {
        let mut cmd = Command::new("sh");
        cmd.args(["-lc", command]);
        cmd
    };

    process
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to spawn task process: {err}"))
}

fn spawn_task_worker(app: AppHandle, state: AppState, queued: QueuedTask) {
    let task_id = queued.task_id.clone();
    let thread_id = queued.thread_id.clone();

    thread::spawn(move || {
        if let Ok(mut db) = state.db.lock() {
            if let Some(task) = db.tasks.iter_mut().find(|task| task.id == task_id) {
                task.status = "running".to_string();
                task.started_at = Some(now_ms());
            }
        }
        update_thread_status(&state, &thread_id, "running");
        let _ = save_db_to_disk(&app, &state);
        emit_task_status(&app, &task_id, &thread_id, "running", None);

        let child = match run_shell_command(&queued.shell, &queued.command, &queued.cwd) {
            Ok(child) => child,
            Err(err) => {
                if let Ok(mut db) = state.db.lock() {
                    if let Some(task) = db.tasks.iter_mut().find(|task| task.id == task_id) {
                        task.status = "failed".to_string();
                        task.finished_at = Some(now_ms());
                    }
                }
                update_thread_status(&state, &thread_id, "failed");
                append_task_log(&app, &state, &task_id, &thread_id, "stderr", &err);
                let _ = save_db_to_disk(&app, &state);
                emit_task_status(&app, &task_id, &thread_id, "failed", None);
                schedule_tasks(app, state);
                return;
            }
        };

        let child_arc = Arc::new(Mutex::new(child));
        if let Ok(mut running) = state.running.lock() {
            running.insert(task_id.clone(), child_arc.clone());
        }

        let out_reader = {
            let guard = child_arc.lock();
            if let Ok(mut guard) = guard {
                guard.stdout.take().map(BufReader::new)
            } else {
                None
            }
        };

        let err_reader = {
            let guard = child_arc.lock();
            if let Ok(mut guard) = guard {
                guard.stderr.take().map(BufReader::new)
            } else {
                None
            }
        };

        let app_out = app.clone();
        let state_out = state.clone();
        let task_out = task_id.clone();
        let thread_out = thread_id.clone();

        let stdout_handle = thread::spawn(move || {
            if let Some(reader) = out_reader {
                for line in reader.lines().map_while(Result::ok) {
                    append_task_log(&app_out, &state_out, &task_out, &thread_out, "stdout", &line);
                }
            }
        });

        let app_err = app.clone();
        let state_err = state.clone();
        let task_err = task_id.clone();
        let thread_err = thread_id.clone();

        let stderr_handle = thread::spawn(move || {
            if let Some(reader) = err_reader {
                for line in reader.lines().map_while(Result::ok) {
                    append_task_log(&app_err, &state_err, &task_err, &thread_err, "stderr", &line);
                }
            }
        });

        let exit_code = {
            let mut guard = child_arc.lock().ok();
            if let Some(ref mut guard) = guard {
                match guard.wait() {
                    Ok(status) => status.code(),
                    Err(_) => None,
                }
            } else {
                None
            }
        };

        let _ = stdout_handle.join();
        let _ = stderr_handle.join();

        if let Ok(mut running) = state.running.lock() {
            running.remove(&task_id);
        }

        let mut final_status = "success".to_string();
        if let Some(code) = exit_code {
            if code != 0 {
                final_status = "failed".to_string();
            }
        } else {
            final_status = "cancelled".to_string();
        }

        if let Ok(mut db) = state.db.lock() {
            if let Some(task) = db.tasks.iter_mut().find(|task| task.id == task_id) {
                if task.status == "cancelled" {
                    final_status = "cancelled".to_string();
                } else {
                    task.status = final_status.clone();
                }
                task.finished_at = Some(now_ms());
                task.exit_code = exit_code;
            }
        }

        update_thread_status(&state, &thread_id, &final_status);
        let _ = save_db_to_disk(&app, &state);
        emit_task_status(&app, &task_id, &thread_id, &final_status, exit_code);

        schedule_tasks(app, state);
    });
}

fn schedule_tasks(app: AppHandle, state: AppState) {
    loop {
        let max_parallel = {
            if let Ok(db) = state.db.lock() {
                db.settings.max_parallel_tasks.max(1)
            } else {
                1
            }
        };

        let running_count = state.running.lock().map(|running| running.len()).unwrap_or(0);
        if running_count >= max_parallel {
            break;
        }

        let next_task = {
            let mut queue = match state.queue.lock() {
                Ok(queue) => queue,
                Err(_) => break,
            };
            queue.pop_front()
        };

        if let Some(queued) = next_task {
            spawn_task_worker(app.clone(), state.clone(), queued);
        } else {
            break;
        }
    }
}

#[tauri::command]
fn create_project(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    name: Option<String>,
) -> Result<ProjectRecord, String> {
    let canonical = canonical_workspace(&path)?;
    let canonical_str = canonical.to_string_lossy().to_string();
    let now = now_ms();

    let mut project = ProjectRecord {
        id: next_id("proj"),
        name: name
            .unwrap_or_else(|| {
                canonical
                    .file_name()
                    .map(|v| v.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Workspace".to_string())
            })
            .trim()
            .to_string(),
        path: canonical_str.clone(),
        last_accessed_at: now,
        created_at: now,
    };

    if let Ok(mut db) = state.db.lock() {
        if let Some(existing) = db.projects.iter_mut().find(|p| p.path == canonical_str) {
            existing.last_accessed_at = now;
            project = existing.clone();
        } else {
            db.projects.push(project.clone());
        }
    }

    save_db_to_disk(&app, &state)?;
    Ok(project)
}

#[tauri::command]
fn list_projects(state: State<AppState>) -> Result<Vec<ProjectRecord>, String> {
    let mut items = state
        .db
        .lock()
        .map_err(|_| "Database lock poisoned".to_string())?
        .projects
        .clone();
    items.sort_by(|a, b| b.last_accessed_at.cmp(&a.last_accessed_at));
    Ok(items)
}

#[tauri::command]
fn touch_project(app: AppHandle, state: State<AppState>, project_id: String) -> Result<(), String> {
    if let Ok(mut db) = state.db.lock() {
        if let Some(item) = db.projects.iter_mut().find(|p| p.id == project_id) {
            item.last_accessed_at = now_ms();
        }
    }
    save_db_to_disk(&app, &state)
}

#[tauri::command]
fn create_thread(
    app: AppHandle,
    state: State<AppState>,
    project_id: String,
    name: String,
    description: Option<String>,
) -> Result<ThreadRecord, String> {
    let now = now_ms();

    {
        let db = state
            .db
            .lock()
            .map_err(|_| "Database lock poisoned".to_string())?;
        if !db.projects.iter().any(|p| p.id == project_id) {
            return Err("Project not found".to_string());
        }
    }

    let thread = ThreadRecord {
        id: next_id("thread"),
        project_id,
        name: if name.trim().is_empty() {
            "New thread".to_string()
        } else {
            name.trim().to_string()
        },
        description: description.unwrap_or_default(),
        status: "idle".to_string(),
        created_at: now,
        updated_at: now,
    };

    if let Ok(mut db) = state.db.lock() {
        db.threads.push(thread.clone());
    }

    save_db_to_disk(&app, &state)?;
    Ok(thread)
}

#[tauri::command]
fn list_threads(state: State<AppState>, project_id: String) -> Result<Vec<ThreadRecord>, String> {
    let mut items: Vec<ThreadRecord> = state
        .db
        .lock()
        .map_err(|_| "Database lock poisoned".to_string())?
        .threads
        .iter()
        .filter(|t| t.project_id == project_id)
        .cloned()
        .collect();
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

#[tauri::command]
fn add_thread_message(
    app: AppHandle,
    state: State<AppState>,
    thread_id: String,
    role: String,
    content: String,
) -> Result<ThreadMessage, String> {
    let message = ThreadMessage {
        id: next_id("msg"),
        thread_id: thread_id.clone(),
        role,
        content,
        created_at: now_ms(),
    };

    if let Ok(mut db) = state.db.lock() {
        db.messages.push(message.clone());
        if let Some(thread) = db.threads.iter_mut().find(|item| item.id == thread_id) {
            thread.updated_at = now_ms();
        }
    }

    save_db_to_disk(&app, &state)?;
    Ok(message)
}

#[tauri::command]
fn list_thread_messages(state: State<AppState>, thread_id: String) -> Result<Vec<ThreadMessage>, String> {
    let mut messages: Vec<ThreadMessage> = state
        .db
        .lock()
        .map_err(|_| "Database lock poisoned".to_string())?
        .messages
        .iter()
        .filter(|m| m.thread_id == thread_id)
        .cloned()
        .collect();
    messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(messages)
}

#[tauri::command]
fn run_task(
    app: AppHandle,
    state: State<AppState>,
    thread_id: String,
    command: String,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<TaskRecord, String> {
    let resolved_cwd = cwd.unwrap_or_default();
    if resolved_cwd.trim().is_empty() {
        return Err("Task cwd is required".to_string());
    }

    let canonical = canonical_workspace(&resolved_cwd)?;
    let cwd_string = canonical.to_string_lossy().to_string();
    let shell_name = {
        if let Some(shell) = shell {
            if !shell.trim().is_empty() {
                shell
            } else {
                state
                    .db
                    .lock()
                    .map(|db| db.settings.default_shell.clone())
                    .unwrap_or_else(|_| "powershell".to_string())
            }
        } else {
            state
                .db
                .lock()
                .map(|db| db.settings.default_shell.clone())
                .unwrap_or_else(|_| "powershell".to_string())
        }
    };

    let task = TaskRecord {
        id: next_id("task"),
        thread_id: thread_id.clone(),
        command: command.clone(),
        cwd: cwd_string.clone(),
        shell: shell_name.clone(),
        status: "queued".to_string(),
        created_at: now_ms(),
        started_at: None,
        finished_at: None,
        exit_code: None,
    };

    if let Ok(mut db) = state.db.lock() {
        db.tasks.push(task.clone());
        if let Some(thread) = db.threads.iter_mut().find(|t| t.id == thread_id) {
            thread.status = "queued".to_string();
            thread.updated_at = now_ms();
        }
    }

    if let Ok(mut queue) = state.queue.lock() {
        queue.push_back(QueuedTask {
            task_id: task.id.clone(),
            thread_id: thread_id.clone(),
            command,
            cwd: cwd_string,
            shell: shell_name,
        });
    }

    save_db_to_disk(&app, &state)?;
    emit_task_status(&app, &task.id, &thread_id, "queued", None);
    schedule_tasks(app, state.inner().clone());

    Ok(task)
}

#[tauri::command]
fn cancel_task(app: AppHandle, state: State<AppState>, task_id: String) -> Result<(), String> {
    let mut cancelled_thread_id: Option<String> = None;

    if let Ok(mut queue) = state.queue.lock() {
        if let Some(index) = queue.iter().position(|item| item.task_id == task_id) {
            if let Some(item) = queue.remove(index) {
                cancelled_thread_id = Some(item.thread_id);
            }
        }
    }

    if cancelled_thread_id.is_none() {
        if let Ok(running) = state.running.lock() {
            if let Some(child_arc) = running.get(&task_id) {
                if let Ok(mut child) = child_arc.lock() {
                    let _ = child.kill();
                }
            }
        }
    }

    if let Ok(mut db) = state.db.lock() {
        if let Some(task) = db.tasks.iter_mut().find(|item| item.id == task_id) {
            task.status = "cancelled".to_string();
            task.finished_at = Some(now_ms());
            cancelled_thread_id = Some(task.thread_id.clone());
        }
    }

    if let Some(thread_id) = cancelled_thread_id.clone() {
        update_thread_status(&state, &thread_id, "cancelled");
        emit_task_status(&app, &task_id, &thread_id, "cancelled", None);
    }

    save_db_to_disk(&app, &state)?;
    schedule_tasks(app, state.inner().clone());
    Ok(())
}

#[tauri::command]
fn list_tasks(state: State<AppState>, thread_id: String) -> Result<Vec<TaskRecord>, String> {
    let mut tasks: Vec<TaskRecord> = state
        .db
        .lock()
        .map_err(|_| "Database lock poisoned".to_string())?
        .tasks
        .iter()
        .filter(|task| task.thread_id == thread_id)
        .cloned()
        .collect();
    tasks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(tasks)
}

#[tauri::command]
fn list_task_logs(state: State<AppState>, task_id: String) -> Result<Vec<TaskLogRecord>, String> {
    let mut logs: Vec<TaskLogRecord> = state
        .db
        .lock()
        .map_err(|_| "Database lock poisoned".to_string())?
        .task_logs
        .iter()
        .filter(|log| log.task_id == task_id)
        .cloned()
        .collect();
    logs.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(logs)
}

#[tauri::command]
fn set_max_parallel_tasks(app: AppHandle, state: State<AppState>, value: usize) -> Result<(), String> {
    if value == 0 {
        return Err("max_parallel_tasks must be >= 1".to_string());
    }

    if let Ok(mut db) = state.db.lock() {
        db.settings.max_parallel_tasks = value;
    }

    save_db_to_disk(&app, &state)?;
    schedule_tasks(app, state.inner().clone());
    Ok(())
}

#[tauri::command]
fn git_status(path: String) -> Result<GitStatusResult, String> {
    let canonical = canonical_workspace(&path)?;
    let path_str = canonical.to_string_lossy().to_string();

    let repo_check = Command::new("git")
        .args(["-C", path_str.as_str(), "rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|err| format!("Failed to execute git: {err}"))?;

    if !repo_check.status.success() {
        return Ok(GitStatusResult {
            is_repo: false,
            branch: None,
            modified_files: vec![],
        });
    }

    let branch = Command::new("git")
        .args(["-C", path_str.as_str(), "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                None
            }
        });

    let status_output = Command::new("git")
        .args(["-C", path_str.as_str(), "status", "--porcelain"])
        .output()
        .map_err(|err| format!("Failed to execute git status: {err}"))?;

    let modified_files = String::from_utf8_lossy(&status_output.stdout)
        .lines()
        .filter_map(|line| {
            if line.len() > 3 {
                Some(line[3..].to_string())
            } else {
                None
            }
        })
        .collect();

    Ok(GitStatusResult {
        is_repo: true,
        branch,
        modified_files,
    })
}

#[tauri::command]
fn git_diff(path: String, file: Option<String>) -> Result<String, String> {
    let canonical = canonical_workspace(&path)?;
    let path_str = canonical.to_string_lossy().to_string();

    let mut args = vec!["-C".to_string(), path_str, "diff".to_string()];
    if let Some(file) = file {
        if !file.trim().is_empty() {
            args.push("--".to_string());
            args.push(file);
        }
    }

    let output = Command::new("git")
        .args(args)
        .output()
        .map_err(|err| format!("Failed to execute git diff: {err}"))?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
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

fn api_key_entry() -> Result<Entry, String> {
    Entry::new(TOKEN_SERVICE, API_KEY_ACCOUNT).map_err(|err| format!("Token store unavailable: {err}"))
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

#[tauri::command]
fn save_api_key(api_key: String) -> Result<(), String> {
    let entry = api_key_entry()?;
    entry
        .set_password(&api_key)
        .map_err(|err| format!("Failed to save API key: {err}"))
}

#[tauri::command]
fn load_api_key() -> Result<Option<String>, String> {
    let entry = api_key_entry()?;

    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!("Failed to read API key: {err}")),
    }
}

#[tauri::command]
fn clear_api_key() -> Result<(), String> {
    let entry = api_key_entry()?;

    match entry.delete_credential() {
        Ok(_) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(format!("Failed to clear API key: {err}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new();

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = app.state::<AppState>();
            load_db_from_disk(&app.handle().clone(), state.inner())
                .map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_project,
            list_projects,
            touch_project,
            create_thread,
            list_threads,
            add_thread_message,
            list_thread_messages,
            run_task,
            cancel_task,
            list_tasks,
            list_task_logs,
            set_max_parallel_tasks,
            git_status,
            git_diff,
            run_terminal_command,
            list_workspace_entries,
            read_workspace_file,
            write_workspace_file,
            wait_for_oauth_callback,
            save_refresh_token,
            load_refresh_token,
            clear_refresh_token,
            save_api_key,
            load_api_key,
            clear_api_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
