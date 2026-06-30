// ============================================================
// Pulse 共享核心库（纯 Rust，无 Tauri 依赖）
//
// 包含类型定义、HTTP 执行、数据持久化、导入/导出、
// 测试脚本执行和 CLI 命令处理等核心逻辑。
// 被 pulse-cli 和 Tauri GUI 共同引用。
// ============================================================

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

// ===== 子模块 =====
pub mod io;
pub mod test_runner;
pub mod cli;

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

/** 响应提取规则：从响应 JSON 中提取值并赋给变量 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractRule {
    /** 变量名（后续通过 {{name}} 引用） */
    pub name: String,
    /** JSON Path 来源，如 "body.data" 或 "body.data.token" */
    pub source: String,
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

/** 集合中的单个请求定义（合并 TestRequest 和 RequestItem 的全部字段） */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionItem {
    pub id: String,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<HeaderInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /** 认证方式：none / bearer / inherit */
    pub auth_type: String,
    pub bearer_token: String,
    #[serde(default)]
    pub params: Vec<HeaderInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_params: Option<Vec<HeaderInput>>,
    /** 断言表达式列表，例如 "status == 200" 或 "body.success == true" */
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assertions: Vec<String>,
    /** 设为 true 可临时跳过此请求 */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip: Option<bool>,
    /** 响应提取规则：从响应中提取 JSON 值并赋给变量 */
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extract: Vec<ExtractRule>,
}

/** 请求集合：一组相关请求的容器 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub base_url: String,
    pub auth_type: String,
    pub bearer_token: String,
    /** 集合级默认变量，用于 {{key}} 模板替换 */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variables: Option<std::collections::HashMap<String, String>>,
    pub requests: Vec<CollectionItem>,
}

/** 集合数据容器：全部集合列表 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionData {
    pub collections: Vec<Collection>,
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
    /** multipart/form-data 条目列表（优先于 body/content_type） */
    pub form_data: Option<Vec<FormDataEntry>>,
}

/** multipart/form-data 中的单个条目（文本值或文件） */
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormDataEntry {
    pub key: String,
    /** 文本值（is_file=false 时使用） */
    pub value: String,
    pub enabled: bool,
    /** true=文件上传，false=文本值 */
    pub is_file: bool,
    /** 已选择的文件路径（is_file=true 时有效） */
    pub file_path: Option<String>,
    /** 显示用的文件名（is_file=true 时有效） */
    pub file_name: Option<String>,
    /** 覆盖的 MIME 类型（为空时由 mime_guess 自动推断） */
    pub file_content_type: String,
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

// ============================================================
// HTTP 执行
// ============================================================

/**
 * 环境变量替换：将字符串中的 {{key}} 替换为对应的变量值
 * 例如：{{base_url}}/api/users → https://example.com/api/users
 */
pub fn substitute_variables(input: &str, variables: &[EnvironmentVariable]) -> String {
    let mut result = input.to_string();
    for var in variables {
        if var.enabled {
            let pattern = format!("{{{{{}}}}}", var.key);
            result = result.replace(&pattern, &var.value);
        }
    }
    result
}

/**
 * execute_http_request：纯 HTTP 执行函数（不含日志/事件）
 *
 * 发送 HTTP 请求并返回响应数据，不涉及日志存储或事件通知。
 * 调用方需确保 input 中的 URL/headers/body 已完成 {{variable}} 替换。
 * 供 send_request（带日志）和 test_runner（批量测试）共用。
 */
pub async fn execute_http_request(input: RequestInput) -> Result<ResponseData, String> {
    let full_start = Instant::now();

    // 构建 HTTP 客户端（60 秒超时）
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let req_method = input
        .method
        .parse::<reqwest::Method>()
        .map_err(|_| format!("Invalid HTTP method: {}", input.method))?;

    let mut req = client.request(req_method, &input.url);

    // 装配请求头
    let mut headers_map = HeaderMap::new();
    for h in &input.headers {
        if h.enabled && !h.key.trim().is_empty() {
            if let (Ok(n), Ok(v)) = (
                HeaderName::from_bytes(h.key.trim().as_bytes()),
                HeaderValue::from_str(h.value.trim()),
            ) {
                headers_map.insert(n, v);
            }
        }
    }

    // 如果 Content-Type 尚未设置且参数中提供了，则补充
    // 注意：有 form_data 时不手动设置 Content-Type（reqwest::multipart 自动处理）
    let has_form_data = input.form_data.as_ref().map_or(false, |fd| {
        fd.iter().any(|e| e.enabled)
    });

    if !has_form_data {
        if let Some(ct) = &input.content_type {
            if !headers_map.contains_key("content-type") && !ct.is_empty() {
                if let Ok(v) = HeaderValue::from_str(ct) {
                    headers_map.insert("content-type", v);
                }
            }
        }
    }

    req = req.headers(headers_map);

    // 装配请求体（multipart/form-data 优先）
    if has_form_data {
        let fd = input.form_data.as_ref().unwrap();
        let mut form = reqwest::multipart::Form::new();

        for entry in fd.iter().filter(|e| e.enabled && !e.key.trim().is_empty()) {
            if entry.is_file {
                if let Some(ref path) = entry.file_path {
                    let path = path.trim();
                    if !path.is_empty() {
                        match std::fs::read(path) {
                            Ok(bytes) => {
                                let file_name = entry.file_name.as_deref()
                                    .unwrap_or("file")
                                    .to_string();

                                // 自动推断 MIME 类型（用户未指定时）
                                let mime_str = if entry.file_content_type.is_empty() {
                                    let ext = std::path::Path::new(path)
                                        .extension()
                                        .and_then(|e| e.to_str())
                                        .unwrap_or("");
                                    match ext.to_lowercase().as_str() {
                                        "txt" => "text/plain",
                                        "html" | "htm" => "text/html",
                                        "json" => "application/json",
                                        "xml" => "application/xml",
                                        "png" => "image/png",
                                        "jpg" | "jpeg" => "image/jpeg",
                                        "gif" => "image/gif",
                                        "webp" => "image/webp",
                                        "svg" => "image/svg+xml",
                                        "pdf" => "application/pdf",
                                        "zip" => "application/zip",
                                        "gz" | "gzip" => "application/gzip",
                                        "mp4" => "video/mp4",
                                        _ => "application/octet-stream",
                                    }
                                } else {
                                    &entry.file_content_type
                                };

                                match reqwest::multipart::Part::bytes(bytes)
                                    .file_name(file_name)
                                    .mime_str(mime_str)
                                {
                                    Ok(part) => {
                                        form = form.part(entry.key.clone(), part);
                                    }
                                    Err(e) => {
                                        eprintln!("Invalid MIME for field '{}': {}", entry.key, e);
                                        form = form.text(entry.key.clone(), format!("[MIME error: {}]", e));
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!("Failed to read file '{}' for field '{}': {}",
                                    path, entry.key, e);
                                form = form.text(entry.key.clone(), format!("[File read error: {}]", e));
                            }
                        }
                    }
                }
            } else {
                form = form.text(entry.key.clone(), entry.value.clone());
            }
        }
        req = req.multipart(form);
    } else if let Some(body_str) = &input.body {
        if !body_str.is_empty() {
            req = req.body(body_str.clone());
        }
    }

    // 发送请求并测量耗时
    let before_send = Instant::now();
    let resp_result = req.send().await;

    let ttfb_elapsed = before_send.elapsed();

    // 处理响应
    match resp_result {
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
    }
}

// ============================================================
// 数据持久化 —— 纯 Rust，无 Tauri 依赖
// CLI 和 GUI 共享同一份数据文件
// ============================================================

/**
 * 解析数据目录路径
 *
 * 优先级: PULSE_DATA_DIR 环境变量 > 系统默认数据目录+/com.pulse.app
 * 确保 CLI 和 GUI 模式读写同一份数据文件
 */
pub fn resolve_data_dir() -> Result<std::path::PathBuf, String> {
    if let Ok(dir) = std::env::var("PULSE_DATA_DIR") {
        return Ok(std::path::PathBuf::from(dir));
    }

    #[cfg(target_os = "windows")]
    let base = {
        let app_data = std::env::var("APPDATA")
            .map_err(|_| "无法获取 APPDATA 环境变量".to_string())?;
        std::path::PathBuf::from(app_data)
    };

    #[cfg(not(target_os = "windows"))]
    let base = {
        let home = std::env::var("HOME")
            .map_err(|_| "无法获取 HOME 环境变量".to_string())?;
        std::path::PathBuf::from(home).join(".local/share")
    };

    Ok(base.join("com.pulse.app"))
}

/** 从数据目录加载 collections.json（文件不存在时返回空集合数据） */
pub fn load_collections_data(data_dir: &std::path::Path) -> CollectionData {
    let file_path = data_dir.join("collections.json");
    if !file_path.exists() {
        return CollectionData {
            collections: Vec::new(),
        };
    }
    match std::fs::read_to_string(&file_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or(CollectionData {
            collections: Vec::new(),
        }),
        Err(_) => CollectionData {
            collections: Vec::new(),
        },
    }
}

/** 从数据目录加载 environments.json（文件不存在时返回空环境） */
pub fn load_environments_data(data_dir: &std::path::Path) -> EnvironmentData {
    let file_path = data_dir.join("environments.json");
    if !file_path.exists() {
        return EnvironmentData {
            environments: vec![],
            active_id: None,
        };
    }
    match std::fs::read_to_string(&file_path) {
        Ok(content) => {
            serde_json::from_str(&content).unwrap_or(EnvironmentData {
                environments: vec![],
                active_id: None,
            })
        }
        Err(_) => EnvironmentData {
            environments: vec![],
            active_id: None,
        },
    }
}

/** 将集合数据持久化到 collections.json */
pub fn save_collections_data(
    data_dir: &std::path::Path,
    data: &CollectionData,
) -> Result<(), String> {
    std::fs::create_dir_all(data_dir)
        .map_err(|e| format!("无法创建数据目录: {}", e))?;
    let file_path = data_dir.join("collections.json");
    let content =
        serde_json::to_string_pretty(data).map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&file_path, content).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

/** 将环境数据持久化到 environments.json */
pub fn save_environments_data(
    data_dir: &std::path::Path,
    data: &EnvironmentData,
) -> Result<(), String> {
    std::fs::create_dir_all(data_dir)
        .map_err(|e| format!("无法创建数据目录: {}", e))?;
    let file_path = data_dir.join("environments.json");
    let content =
        serde_json::to_string_pretty(data).map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&file_path, content).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

// ============================================================
// 时间工具
// ============================================================

/** 获取当前时间的 ISO 8601 格式字符串 */
pub fn chrono_now_iso() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // 简单计算 YYYY-MM-DDTHH:MM:SS.000Z 格式
    let secs_per_day: u64 = 86400;
    let days = now / secs_per_day;
    let time_secs = now % secs_per_day;

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
    let d = remaining_days + 1;

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

// ============================================================
// 响应分析 —— 为 AI Agent 提供结构化响应摘要
// ============================================================

/**
 * 响应分析结果，包含 JSON 路径结构和体摘要
 *
 * 在 CLI JSON 模式下附加到响应输出中供 AI 解析：
 * {
 *   "status": 200,
 *   "body": "{...}",
 *   "_analysis": {
 *     "json_paths": ["data.users", "data.users[0].id", ...],
 *     "body_preview": "前 2000 字符...",
 *     "is_json": true
 *   }
 * }
 */
#[derive(Debug, Serialize)]
pub struct ResponseAnalysis {
    /** JSON 路径列表（仅对 JSON 响应有效） */
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub json_paths: Vec<String>,
    /** 响应体前 2000 字符摘要 */
    pub body_preview: String,
    /** 响应体是否为有效 JSON */
    pub is_json: bool,
    /** JSON 值类型（object / array / string / number / boolean / null） */
    #[serde(skip_serializing_if = "Option::is_none")]
    pub json_type: Option<String>,
    /** 顶层键列表（仅对 JSON 对象有效） */
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub top_keys: Vec<String>,
}

/**
 * 分析 HTTP 响应体，提取结构化摘要
 *
 * 如果响应体是 JSON，递归提取所有 JSON 路径及类型。
 * 无论是否 JSON，都返回前 2000 字符的 body_preview。
 */
pub fn analyze_response(body: &str) -> ResponseAnalysis {
    let body_preview = if body.len() > 2000 {
        format!("{}...（共 {} 字符）", &body[..2000], body.len())
    } else {
        body.to_string()
    };

    match serde_json::from_str::<serde_json::Value>(body) {
        Ok(val) => {
            let mut paths = Vec::new();
            let json_type = json_value_type_name(&val);
            let top_keys = extract_top_keys(&val);
            extract_json_paths(&val, "", &mut paths);
            ResponseAnalysis {
                json_paths: paths,
                body_preview,
                is_json: true,
                json_type: Some(json_type),
                top_keys,
            }
        }
        Err(_) => ResponseAnalysis {
            json_paths: vec![],
            body_preview,
            is_json: false,
            json_type: None,
            top_keys: vec![],
        },
    }
}

/** 获取 JSON 值的类型名称 */
fn json_value_type_name(val: &serde_json::Value) -> String {
    match val {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(_) => "boolean".to_string(),
        serde_json::Value::Number(_) => "number".to_string(),
        serde_json::Value::String(_) => "string".to_string(),
        serde_json::Value::Array(_) => "array".to_string(),
        serde_json::Value::Object(_) => "object".to_string(),
    }
}

/** 提取 JSON 对象的顶层键列表 */
fn extract_top_keys(val: &serde_json::Value) -> Vec<String> {
    match val {
        serde_json::Value::Object(map) => map.keys().cloned().collect(),
        _ => vec![],
    }
}

/**
 * 递归提取 JSON 路径
 *
 * 从根节点开始遍历 JSON 树，收集所有叶子节点和数组元素的路径。
 * 例如：{"data": {"users": [{"id": 1, "name": "Alice"}]}}
 * 生成路径：
 *   data
 *   data.users
 *   data.users[0]
 *   data.users[0].id
 *   data.users[0].name
 */
fn extract_json_paths(val: &serde_json::Value, prefix: &str, paths: &mut Vec<String>) {
    match val {
        serde_json::Value::Object(map) => {
            // 只有非空对象才记录自身路径
            if !prefix.is_empty() && !map.is_empty() {
                paths.push(prefix.to_string());
            }
            for (key, child) in map {
                let child_path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{}.{}", prefix, key)
                };
                extract_json_paths(child, &child_path, paths);
            }
        }
        serde_json::Value::Array(arr) => {
            if arr.is_empty() {
                paths.push(format!("{}[]", prefix));
            } else {
                paths.push(format!("{}[0]（共 {} 项）", prefix, arr.len()));
                // 只展开第一个元素作为示例（避免路径爆炸）
                if let Some(first) = arr.first() {
                    let example_path = format!("{}[0]", prefix);
                    extract_json_paths(first, &example_path, paths);
                }
            }
        }
        _ => {
            // 叶子节点
            paths.push(prefix.to_string());
        }
    }
}
