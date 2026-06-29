use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
// ===== Mock 测试服务器（feature flag 控制，默认不编译） =====
#[cfg(feature = "mock-server")]
mod mock_server;

// ===== 导入/导出核心模块（纯 Rust，无 Tauri 依赖，CLI 可复用） =====
mod io;

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
// 数据结构 —— 与前端 TypeScript 类型一一对应
// ============================================================

/** HTTP 请求头/参数键值对，支持启用/禁用 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeaderInput {
    pub key: String,
    pub value: String,
    /** 是否启用（禁用的条目不会出现在实际请求中） */
    pub enabled: bool,
}

/** 环境变量：用于 {{key}} 模板替换 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentVariable {
    pub key: String,
    pub value: String,
    /** 是否启用（禁用的变量不会被替换） */
    pub enabled: bool,
}

/** 环境：一组可复用的变量集合 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Environment {
    pub id: String,
    pub name: String,
    pub variables: Vec<EnvironmentVariable>,
}

/** 环境数据：全部环境列表 + 当前激活的环境 ID */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentData {
    pub environments: Vec<Environment>,
    pub active_id: Option<String>,
}

/** 前端传入的请求参数（由 invoke("send_request") 携带） */
#[derive(Debug, Serialize, Deserialize)]
pub struct RequestInput {
    pub method: String,
    pub url: String,
    pub headers: Vec<HeaderInput>,
    /** 请求体（None 表示无请求体） */
    pub body: Option<String>,
    /** Content-Type 字段值 */
    pub content_type: Option<String>,
}

/**
 * 各阶段耗时（单位：毫秒）
 * 注：DNS/TCP/TLS 为估算值，reqwest 不提供原生分阶段计时
 */
#[derive(Debug, Serialize, Deserialize)]
pub struct TimingInfo {
    pub dns_lookup_ms: f64,   // DNS 解析耗时
    pub tcp_connect_ms: f64,  // TCP 连接耗时
    pub tls_handshake_ms: f64,// TLS 握手耗时
    pub ttfb_ms: f64,          // 首字节到达耗时（Time To First Byte）
    pub download_ms: f64,      // 内容下载耗时
    pub total_ms: f64,         // 总耗时
}

/** Tauri 命令返回到前端的响应数据 */
#[derive(Debug, Serialize, Deserialize)]
pub struct ResponseData {
    pub status: u16,                        // HTTP 状态码
    pub status_text: String,                // 状态文本（如 "OK"）
    pub headers: HashMap<String, String>,    // 响应头键值对
    pub body: String,                        // 响应体文本
    pub content_type: Option<String>,        // 响应 Content-Type
    pub size: usize,                         // 响应体字节数
    pub size_label: String,                  // 人类可读的大小字符串（如 "12.3 KB"）
    pub timing: TimingInfo,                  // 各阶段耗时
}

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

/**
 * 环境变量替换：将字符串中的 {{key}} 替换为对应的变量值
 * 例如：{{base_url}}/api/users → https://example.com/api/users
 */
fn substitute_variables(input: &str, variables: &[EnvironmentVariable]) -> String {
    let mut result = input.to_string();
    for var in variables {
        if var.enabled {
            let pattern = format!("{{{{{}}}}}", var.key);
            result = result.replace(&pattern, &var.value);
        }
    }
    result
}

// ============================================================
// Tauri 命令 —— 前端通过 invoke() 调用
// ============================================================

/**
 * send_request：核心 HTTP 命令
 *
 * 1. 对 URL/请求头/请求体 执行 {{variable}} 环境变量替换
 * 2. 通过 reqwest 发送 HTTP 请求（60 秒超时）
 * 3. 测量各阶段耗时（TTFB、下载等；DNS/TCP/TLS 按百分比估算）
 * 4. 构建日志条目，存入 Rust 侧 LogStore
 * 5. 通过 Tauri Events 发送 http-log 事件，供日志窗口实时更新
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

    // 步骤 2: 构建 HTTP 客户端（60 秒超时）
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let req_method = method
        .parse::<reqwest::Method>()
        .map_err(|_| format!("Invalid HTTP method: {}", method))?;

    let mut req = client.request(req_method, &url);

    // 步骤 3: 装配请求头
    let mut headers = HeaderMap::new();
    for h in &substituted_headers {
        if h.enabled && !h.key.trim().is_empty() {
            if let (Ok(n), Ok(v)) = (
                HeaderName::from_bytes(h.key.trim().as_bytes()),
                HeaderValue::from_str(h.value.trim()),
            ) {
                headers.insert(n, v);
            }
        }
    }

    // 如果 Content-Type 尚未设置且参数中提供了，则补充
    if let Some(ct) = &content_type {
        if !headers.contains_key("content-type") && !ct.is_empty() {
            if let Ok(v) = HeaderValue::from_str(ct) {
                headers.insert("content-type", v);
            }
        }
    }

    req = req.headers(headers);

    // 步骤 4: 装配请求体
    if let Some(body_str) = &body {
        if !body_str.is_empty() {
            req = req.body(body_str.clone());
        }
    }

    // 记录原始请求信息（用于日志）
    let request_headers: Vec<HeaderInput> = substituted_headers.clone();
    let request_body: Option<String> = body.as_ref().map(|b| truncate_body(b));

    // 步骤 5: 发送请求并测量耗时
    let before_send = Instant::now();
    let resp_result = req.send().await;

    let ttfb_elapsed = before_send.elapsed();

    let mut log_response_headers: HashMap<String, String> = HashMap::new();

    // 步骤 6: 处理响应
    let result: Result<ResponseData, String> = match resp_result {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let status_text = resp
                .status()
                .canonical_reason()
                .unwrap_or("Unknown")
                .to_string();

            // 提取响应头
            let resp_headers: HashMap<String, String> = resp
                .headers()
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                .collect();
            log_response_headers = resp_headers.clone();

            let content_type = resp_headers.get("content-type").cloned();

            // 读取响应体
            let body = resp
                .text()
                .await
                .map_err(|e| format!("Failed to read response body: {}", e))?;

            let total_elapsed = full_start.elapsed();

            // 计算人类可读的大小
            let size = body.len();
            let size_label = if size < 1024 {
                format!("{} B", size)
            } else if size < 1024 * 1024 {
                format!("{:.1} KB", size as f64 / 1024.0)
            } else {
                format!("{:.1} MB", size as f64 / (1024.0 * 1024.0))
            };

            let total_ms = total_elapsed.as_secs_f64() * 1000.0;
            let ttfb_ms = ttfb_elapsed.as_secs_f64() * 1000.0;
            let download_ms = (total_ms - ttfb_ms).max(0.1);

            // timing 估算：将 TTFB 的 35% 估算为连接时间，再按 20%/30%/50% 分给 DNS/TCP/TLS
            // 注：reqwest 不提供原生分阶段计时，此处为近似值
            let (dns_ms, tcp_ms, tls_ms) = if ttfb_ms > 10.0 {
                let connection = ttfb_ms * 0.35;
                (connection * 0.2, connection * 0.3, connection * 0.5)
            } else {
                (0.0, 0.0, 0.0)
            };

            let timing = TimingInfo {
                dns_lookup_ms: dns_ms,
                tcp_connect_ms: tcp_ms,
                tls_handshake_ms: tls_ms,
                ttfb_ms: (ttfb_ms - dns_ms - tcp_ms - tls_ms).max(0.0),
                download_ms,
                total_ms,
            };

            Ok(ResponseData {
                status,
                status_text,
                headers: resp_headers,
                body,
                content_type,
                size,
                size_label,
                timing,
            })
        }
        Err(e) => {
            // 根据错误类型给出中文友好的错误消息
            let msg = if e.is_timeout() {
                "Request timed out after 60 seconds".to_string()
            } else if e.is_connect() {
                format!("Connection failed: {}", e)
            } else if e.is_status() {
                format!("HTTP error: {}", e)
            } else {
                format!("Request failed: {}", e)
            };
            Err(msg)
        }
    };

    // 步骤 7: 构建日志条目（成功/失败统一记录）
    let total_ms = full_start.elapsed().as_secs_f64() * 1000.0;
    let now = now_millis();
    let log_id = next_log_id();

    let log_entry = match &result {
        Ok(data) => LogEntry {
            id: log_id,
            timestamp: now,
            request_headers: request_headers.clone(),
            request_body: request_body.clone(),
            response_headers: log_response_headers.clone(),
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

    // 步骤 8: 持久化日志到 Rust 托管状态
    if let Some(store) = app.try_state::<Mutex<LogStore>>() {
        if let Ok(mut store) = store.lock() {
            store.push(log_entry.clone());
        }
    }

    // 步骤 9: 通过 Tauri Events 实时推送日志条目
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
    let file_path = data_dir.join("environments.json");

    if !file_path.exists() {
        return Ok(EnvironmentData {
            environments: vec![],
            active_id: None,
        });
    }

    let content =
        std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse: {}", e))
}

/** 将环境数据持久化到 environments.json */
#[tauri::command]
fn save_environments(app: AppHandle, data: EnvironmentData) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;
    let file_path = data_dir.join("environments.json");
    let content =
        serde_json::to_string_pretty(&data).map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&file_path, content).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

/** 从操作系统应用数据目录加载 collections.json */
#[tauri::command]
fn load_collections(app: AppHandle) -> Result<serde_json::Value, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let file_path = data_dir.join("collections.json");

    if !file_path.exists() {
        return Ok(serde_json::Value::Null);
    }

    let content =
        std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse: {}", e))
}

/** 将集合数据持久化到 collections.json */
#[tauri::command]
fn save_collections(app: AppHandle, data: serde_json::Value) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;
    let file_path = data_dir.join("collections.json");
    let content =
        serde_json::to_string_pretty(&data).map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&file_path, content).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
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
 * export_data_to_file：导出所有数据到文件
 *
 * 1. 从 app_data_dir 读取集合和环境数据
 * 2. 构建 ExportData 信封
 * 3. 序列化为 JSON 或 YAML
 * 4. 弹出原生保存对话框
 * 5. 写入文件
 *
 * 返回保存的文件名（用户取消时返回 None）
 */
#[tauri::command]
async fn export_data_to_file(app: AppHandle, format: String) -> Result<Option<String>, String> {
    let export_fmt = io::ExportFormat::from_str(&format)?;

    // 读取集合数据
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let collections_path = data_dir.join("collections.json");
    let collections: serde_json::Value = if collections_path.exists() {
        let content = std::fs::read_to_string(&collections_path)
            .map_err(|e| format!("Failed to read collections: {}", e))?;
        serde_json::from_str(&content).unwrap_or(serde_json::Value::Null)
    } else {
        serde_json::Value::Null
    };

    // 读取环境数据
    let environments_path = data_dir.join("environments.json");
    let environments: EnvironmentData = if environments_path.exists() {
        let content = std::fs::read_to_string(&environments_path)
            .map_err(|e| format!("Failed to read environments: {}", e))?;
        serde_json::from_str(&content).unwrap_or(EnvironmentData {
            environments: vec![],
            active_id: None,
        })
    } else {
        EnvironmentData {
            environments: vec![],
            active_id: None,
        }
    };

    // 构建导出信封
    let exported_at = chrono_now_iso();
    let export_data = io::build_export_data(&collections, &environments, &exported_at);

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
 * 获取当前时间的 ISO 8601 格式字符串
 * 不使用 chrono crate，保持最小依赖
 */
fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // 简单计算 YYYY-MM-DDTHH:MM:SS.000Z 格式
    // 从 Unix 纪元秒数计算
    let secs_per_day: u64 = 86400;
    let days = now / secs_per_day;
    let time_secs = now % secs_per_day;

    // 闰年计算（1970-01-01 基准）
    let mut y = 1970i64;
    let mut remaining_days = days as i64;
    loop {
        let days_in_year = if is_leap_year(y) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        y += 1;
    }

    let mut m = 1;
    let month_days = if is_leap_year(y) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    for &md in &month_days {
        if remaining_days < md {
            break;
        }
        remaining_days -= md;
        m += 1;
    }
    let d = remaining_days + 1; // day of month (1-based)

    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z",
        y, m, d, hours, minutes, seconds
    )
}

fn is_leap_year(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
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
    let collections_path = data_dir.join("collections.json");
    let existing_collections: serde_json::Value = if collections_path.exists() {
        let c = std::fs::read_to_string(&collections_path)
            .map_err(|e| format!("Failed to read collections: {}", e))?;
        serde_json::from_str(&c).unwrap_or(serde_json::json!({ "collections": [] }))
    } else {
        serde_json::json!({ "collections": [] })
    };

    let environments_path = data_dir.join("environments.json");
    let existing_environments: EnvironmentData = if environments_path.exists() {
        let c = std::fs::read_to_string(&environments_path)
            .map_err(|e| format!("Failed to read environments: {}", e))?;
        serde_json::from_str(&c).unwrap_or(EnvironmentData {
            environments: vec![],
            active_id: None,
        })
    } else {
        EnvironmentData {
            environments: vec![],
            active_id: None,
        }
    };

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
    let coll_content = serde_json::to_string_pretty(&final_collections)
        .map_err(|e| format!("Failed to serialize collections: {}", e))?;
    std::fs::write(&collections_path, coll_content)
        .map_err(|e| format!("Failed to write collections: {}", e))?;

    let env_content = serde_json::to_string_pretty(&final_environments)
        .map_err(|e| format!("Failed to serialize environments: {}", e))?;
    std::fs::write(&environments_path, env_content)
        .map_err(|e| format!("Failed to write environments: {}", e))?;

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
        ])
        .setup(|app| {
            // 创建独立的日志查看窗口（标签为 "logs"）
            // - dev 模式：从 Vite 开发服务器加载，确保热更新
            // - 正式构建：从打包后的 dist/index.html 加载
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
