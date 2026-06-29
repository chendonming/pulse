// ============================================================
// Pulse Tauri 后端入口（GUI 专属）
//
// 包含 Tauri 命令、日志系统、GUI 运行时入口。
// 共享逻辑（类型定义、HTTP 执行、数据持久化、导入/导出、
// 测试脚本、CLI 命令）已迁移至 pulse-core crate。
// ============================================================

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

// ===== 共享核心库（类型 + 纯函数） =====
// 通过 re-export 保持向后兼容：crate::HeaderInput 等路径仍然有效
pub use pulse_core::{
    Environment, EnvironmentData, EnvironmentVariable, HeaderInput,
    RequestInput, ResponseData, TimingInfo,
    chrono_now_iso, execute_http_request, load_collections_data,
    load_environments_data, resolve_data_dir, save_collections_data,
    save_environments_data, substitute_variables,
};
// 子模块引用供 Tauri 命令使用
use pulse_core::io;
use pulse_core::test_runner;

// ===== Mock 测试服务器（feature flag 控制，默认不编译） =====
#[cfg(feature = "mock-server")]
mod mock_server;

// ============================================================
// 常量定义
// ============================================================

/** 日志中请求/响应体的最大字符数（超过则截断） */
const MAX_LOG_BODY_LEN: usize = 10_000;
/** Rust 侧日志存储的最大条目数（FIFO 淘汰） */
const MAX_LOG_ENTRIES: usize = 2000;

/** 自增日志 ID 原子计数器，确保每个日志条目有唯一 ID */
static NEXT_LOG_ID: AtomicU64 = AtomicU64::new(1);

/** 获取下一个自增日志 ID（原子递增，线程安全） */
fn next_log_id() -> u64 {
    NEXT_LOG_ID.fetch_add(1, Ordering::Relaxed)
}

// ============================================================
// 日志系统数据结构（Tauri 专属）
// ============================================================

/** 日志条目：记录一次完整的 HTTP 请求/响应生命周期 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub id: u64,                               // 自增唯一 ID
    pub timestamp: u64,                         // Unix 毫秒时间戳
    pub method: String,                         // HTTP 方法
    pub url: String,                            // 最终请求 URL（变量已替换）
    pub status: u16,                            // HTTP 状态码（0 表示出错）
    pub status_text: String,                    // 状态文本
    pub size_label: String,                     // 响应大小
    pub total_ms: f64,                          // 总耗时（毫秒）
    pub content_type: Option<String>,           // 响应 Content-Type
    pub error: Option<String>,                  // 错误信息（成功时为 None）
    pub request_headers: Vec<HeaderInput>,       // 发送的请求头
    pub request_body: Option<String>,           // 发送的请求体（已截断）
    pub response_headers: HashMap<String, String>, // 收到的响应头
}

/**
 * 日志存储（由 Rust 托管，Mutex 保护线程安全）
 * 前端通过 Tauri 命令 get_logs/clear_logs 读写
 */
pub struct LogStore {
    entries: Vec<LogEntry>,
}

impl LogStore {
    /** 追加日志条目，超过 MAX_LOG_ENTRIES 时移除最旧的（FIFO 淘汰） */
    fn push(&mut self, entry: LogEntry) {
        self.entries.push(entry);
        if self.entries.len() > MAX_LOG_ENTRIES {
            self.entries.remove(0);
        }
    }
}

/**
 * 截断过长的请求/响应体
 * 使用 floor_char_boundary 确保在多字节字符边界安全截断，避免 Panic
 */
fn truncate_body(s: &str) -> String {
    if s.len() > MAX_LOG_BODY_LEN {
        let end = s.floor_char_boundary(MAX_LOG_BODY_LEN);
        let mut t = s[..end].to_string();
        t.push_str(&format!("\n\n… (truncated, {} chars total)", s.len()));
        t
    } else {
        s.to_string()
    }
}

/** 获取当前 Unix 毫秒时间戳 */
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ============================================================
// Tauri 命令 —— 前端通过 invoke() 调用
// ============================================================

/**
 * send_request：核心 HTTP 命令（带日志和事件通知）
 *
 * 1. 对 URL/请求头/请求体 执行 {{variable}} 环境变量替换
 * 2. 调用 execute_http_request 发送请求
 * 3. 构建日志条目，存入 Rust 侧 LogStore
 * 4. 通过 Tauri Events 发送 http-log 事件
 */
#[tauri::command]
async fn send_request(app: AppHandle, input: RequestInput, variables: Vec<EnvironmentVariable>) -> Result<ResponseData, String> {
    let full_start = Instant::now();
    let method = input.method.to_uppercase();

    // 步骤 1: 变量替换 —— 将 {{key}} 模式替换为实际值
    let url = substitute_variables(&input.url, &variables);
    let substituted_headers: Vec<HeaderInput> = input
        .headers
        .iter()
        .map(|h| HeaderInput {
            key: h.key.clone(),
            value: substitute_variables(&h.value, &variables),
            enabled: h.enabled,
        })
        .collect();
    let body = input
        .body
        .as_ref()
        .map(|b| substitute_variables(b, &variables));
    let content_type = input
        .content_type
        .as_ref()
        .map(|ct| substitute_variables(ct, &variables));

    // 记录原始请求信息（用于日志）
    let request_headers: Vec<HeaderInput> = substituted_headers.clone();
    let request_body: Option<String> = body.as_ref().map(|b| truncate_body(b));

    // 步骤 2: 调用公共执行函数发送 HTTP 请求
    let exec_input = RequestInput {
        method: method.clone(),
        url: url.clone(),
        headers: substituted_headers,
        body,
        content_type,
    };
    let result = execute_http_request(exec_input).await;

    // 步骤 3: 构建日志条目（成功/失败统一记录）
    let total_ms = full_start.elapsed().as_secs_f64() * 1000.0;
    let now = now_millis();
    let log_id = next_log_id();

    let log_entry = match &result {
        Ok(data) => LogEntry {
            id: log_id,
            timestamp: now,
            request_headers: request_headers.clone(),
            request_body: request_body.clone(),
            response_headers: data.headers.clone(),
            method,
            url,
            status: data.status,
            status_text: data.status_text.clone(),
            size_label: data.size_label.clone(),
            total_ms,
            content_type: data.content_type.clone(),
            error: None,
        },
        Err(err) => LogEntry {
            id: log_id,
            timestamp: now,
            request_headers,
            request_body,
            response_headers: HashMap::new(),
            method,
            url,
            status: 0,
            status_text: "Error".into(),
            size_label: "0 B".into(),
            total_ms,
            content_type: None,
            error: Some(err.clone()),
        },
    };

    // 步骤 4: 持久化日志到 Rust 托管状态
    if let Some(store) = app.try_state::<Mutex<LogStore>>() {
        if let Ok(mut store) = store.lock() {
            store.push(log_entry.clone());
        }
    }

    // 步骤 5: 通过 Tauri Events 实时推送日志条目
    let _ = app.emit("http-log", &log_entry);

    result
}

/** 获取全部日志条目（LogViewer 启动时调用，用于弥补事件丢失） */
#[tauri::command]
fn get_logs(store: tauri::State<'_, Mutex<LogStore>>) -> Result<Vec<LogEntry>, String> {
    let store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(store.entries.clone())
}

/** 清空所有日志（由前端 Clear 按钮触发） */
#[tauri::command]
fn clear_logs(store: tauri::State<'_, Mutex<LogStore>>) -> Result<(), String> {
    let mut store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    store.entries.clear();
    Ok(())
}

/** 从操作系统应用数据目录加载 environments.json */
#[tauri::command]
fn load_environments(app: AppHandle) -> Result<EnvironmentData, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(load_environments_data(&data_dir))
}

/** 将环境数据持久化到 environments.json */
#[tauri::command]
fn save_environments(app: AppHandle, data: EnvironmentData) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    save_environments_data(&data_dir, &data)
}

/** 从操作系统应用数据目录加载 collections.json */
#[tauri::command]
fn load_collections(app: AppHandle) -> Result<serde_json::Value, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(load_collections_data(&data_dir))
}

/** 将集合数据持久化到 collections.json */
#[tauri::command]
fn save_collections(app: AppHandle, data: serde_json::Value) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    save_collections_data(&data_dir, &data)
}

/**
 * 快捷键绑定数据
 * 存储用户自定义的快捷键覆盖配置
 */
#[derive(Debug, Serialize, Deserialize)]
pub struct KeybindingData {
    pub version: i32,
    pub bindings: HashMap<String, Vec<String>>,
}

/** 从操作系统应用数据目录加载 keybindings.json */
#[tauri::command]
fn load_keybindings(app: AppHandle) -> Result<Option<KeybindingData>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let file_path = data_dir.join("keybindings.json");

    if !file_path.exists() {
        return Ok(None);
    }

    let content =
        std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|e| format!("Failed to parse: {}", e))
}

/** 将快捷键绑定持久化到 keybindings.json */
#[tauri::command]
fn save_keybindings(app: AppHandle, data: KeybindingData) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;
    let file_path = data_dir.join("keybindings.json");
    let content =
        serde_json::to_string_pretty(&data).map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&file_path, content).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

// ============================================================
// 导入/导出命令
// ============================================================

/**
 * export_data_to_file：导出数据到文件（支持按 Collection ID 筛选）
 *
 * 1. 从 app_data_dir 读取集合和环境数据
 * 2. 按 collection_ids 筛选（空数组 = 导出全部）
 * 3. 构建 ExportData 信封
 * 4. 序列化为 JSON 或 YAML
 * 5. 弹出原生保存对话框
 * 6. 写入文件
 *
 * 返回保存的文件名（用户取消时返回 None）
 */
#[tauri::command]
async fn export_data_to_file(app: AppHandle, format: String, collection_ids: Vec<String>) -> Result<Option<String>, String> {
    let export_fmt = io::ExportFormat::from_str(&format)?;

    // 读取集合数据
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let collections = load_collections_data(&data_dir);

    // 按 collection_ids 筛选集合
    let filtered_collections = if collection_ids.is_empty() {
        // 空数组 = 导出全部，不做筛选
        collections
    } else {
        // 仅保留 ID 在 collection_ids 中的集合
        let items = collections
            .get("collections")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter(|item| {
                        item.get("id")
                            .and_then(|id| id.as_str())
                            .map(|id| collection_ids.contains(&id.to_string()))
                            .unwrap_or(false)
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        serde_json::json!({ "collections": items })
    };

    // 读取环境数据
    let environments = load_environments_data(&data_dir);

    // 构建导出信封
    let exported_at = chrono_now_iso();
    let export_data = io::build_export_data(&filtered_collections, &environments, &exported_at);

    // 序列化
    let content = io::serialize_export(&export_data, export_fmt)?;

    // 弹出原生保存对话框
    let default_filename = format!("pulse-export-{}.{}",
        exported_at.replace(':', "-").split('.').next().unwrap_or("unknown"),
        export_fmt.to_extension()
    );

    let file_path = app
        .dialog()
        .file()
        .add_filter(export_fmt.file_filter_label(), &[export_fmt.to_extension()])
        .set_file_name(&default_filename)
        .blocking_save_file();

    let Some(path) = file_path else {
        return Ok(None); // 用户取消
    };

    // 写入文件
    let path_str = path.to_string();
    std::fs::write(&path_str, &content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    // 提取文件名用于返回
    let file_name = std::path::Path::new(&path_str)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&path_str)
        .to_string();

    Ok(Some(file_name))
}

/**
 * preview_import：预览导入文件内容（不写入）
 *
 * 解析并验证文件内容，返回集合和环境数量的摘要信息，
 * 供前端对话框显示确认。
 */
#[tauri::command]
fn preview_import(path: String) -> Result<io::ImportPreview, String> {
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    let fmt = io::ExportFormat::from_extension(&path)?;
    let preview = io::preview_from_content(&content, fmt)?;
    Ok(preview)
}

/**
 * import_data_from_file：从文件导入数据
 *
 * 1. 读取并解析文件（JSON/YAML 自动检测）
 * 2. 验证导入数据结构
 * 3. 按策略合并/替换现有数据
 * 4. 写入 app_data_dir
 *
 * strategy: "replace" 或 "merge"
 */
#[tauri::command]
fn import_data_from_file(
    app: AppHandle,
    path: String,
    strategy: String,
) -> Result<io::ImportResult, String> {
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    let fmt = io::ExportFormat::from_extension(&path)?;
    let import_data = io::deserialize_import(&content, fmt)?;
    io::validate_import(&import_data)?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;

    // 读取现有数据
    let existing_collections = load_collections_data(&data_dir);
    let existing_environments = load_environments_data(&data_dir);

    // 按策略合并
    let (final_collections, final_environments) = match strategy.as_str() {
        "replace" => (import_data.collections, import_data.environments),
        "merge" => (
            io::merge_collections(&existing_collections, &import_data.collections),
            io::merge_environments(&existing_environments, &import_data.environments),
        ),
        _ => return Err(format!("Unknown strategy: '{}'. Expected 'replace' or 'merge'", strategy)),
    };

    // 写入文件
    save_collections_data(&data_dir, &final_collections)?;
    save_environments_data(&data_dir, &final_environments)?;

    let collections_count = final_collections["collections"]
        .as_array()
        .map(|a| a.len())
        .unwrap_or(0);
    let environments_count = final_environments.environments.len();
    let active_id_changed = final_environments.active_id.is_some();

    Ok(io::ImportResult {
        collections_count,
        environments_count,
        active_id_changed,
    })
}

/**
 * pick_import_file：弹出原生文件打开对话框，选择导入文件
 *
 * 文件过滤器：.json, .yaml, .yml
 * 返回文件路径（用户取消时返回 None）
 */
#[tauri::command]
async fn pick_import_file(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app
        .dialog()
        .file()
        .add_filter("Pulse Export", &["json", "yaml", "yml"])
        .blocking_pick_file();

    Ok(file_path.map(|p| p.to_string()))
}

// ============================================================
// Test Script 相关 Tauri 命令
// ============================================================

/** 弹出原生文件选择器，选取 .yaml/.yml 测试脚本文件 */
#[tauri::command]
async fn pick_test_script_file(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app
        .dialog()
        .file()
        .add_filter("Test Script", &["yaml", "yml"])
        .blocking_pick_file();

    Ok(file_path.map(|p| p.to_string()))
}

/**
 * run_test_script：执行 YAML 测试脚本
 *
 * 1. 读取 YAML 文件
 * 2. 调用 test_runner 模块解析并执行
 * 3. 返回 TestRunResult（含每步状态和断言结果）
 */
#[tauri::command]
async fn run_test_script(
    path: String,
    variables: Vec<EnvironmentVariable>,
) -> Result<test_runner::TestRunResult, String> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("无法读取文件: {}", e))?;

    Ok(test_runner::run_test_script_internal(&content, &variables).await)
}

/**
 * 应用入口
 *
 * 1. 初始化 LogStore（Mutex 包裹的 Vec，线程共享）
 * 2. 注册所有 Tauri 命令
 * 3. 在 setup 中创建第二个"日志"窗口（900×550）
 * 4. 启动 GUI 事件循环
 */
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(LogStore {
            entries: Vec::new(),
        }))
        .invoke_handler(tauri::generate_handler![
            send_request,
            get_logs,
            clear_logs,
            load_environments,
            save_environments,
            load_collections,
            save_collections,
            load_keybindings,
            save_keybindings,
            export_data_to_file,
            preview_import,
            import_data_from_file,
            pick_import_file,
            pick_test_script_file,
            run_test_script,
        ])
        .setup(|app| {
            // 创建独立的日志查看窗口（标签为 "logs"）
            let app_handle = app.handle().clone();
            let logs_url = if tauri::is_dev() {
                tauri::WebviewUrl::External(
                    "http://localhost:1420".parse().expect("valid dev URL"),
                )
            } else {
                tauri::WebviewUrl::App("index.html".into())
            };

            match tauri::WebviewWindowBuilder::new(&app_handle, "logs", logs_url)
                .title("Pulse - Logs")
                .inner_size(900.0, 550.0)
                .build()
            {
                Ok(_) => {
                    #[cfg(feature = "mock-server")]
                    eprintln!("[logs] Log viewer window created");
                }
                Err(e) => eprintln!("[logs] Failed to create log viewer window: {}", e),
            }

            // 启动 Mock HTTP 测试服务器（feature=mock-server 时生效）
            #[cfg(feature = "mock-server")]
            {
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    mock_server::start().await;
                });
                eprintln!("[mock-server] Feature enabled — starting mock server on port 18789");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/**
 * CLI 模式入口
 *
 * 当 main.rs 检测到命令行参数时调用此函数。
 * 委托给 pulse_core::cli 模块解析参数并执行相应命令。
 * 退出码: 0=成功, 1=运行时错误
 */
pub fn cli_run() {
    let result = pulse_core::cli::run();
    match result {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            eprintln!("错误: {}", e);
            std::process::exit(1);
        }
    }
}
