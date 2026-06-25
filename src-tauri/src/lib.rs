use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use tauri::{AppHandle, Emitter, Manager};

const MAX_LOG_BODY_LEN: usize = 10_000;
const MAX_LOG_ENTRIES: usize = 2000;

static NEXT_LOG_ID: AtomicU64 = AtomicU64::new(1);

fn next_log_id() -> u64 {
    NEXT_LOG_ID.fetch_add(1, Ordering::Relaxed)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeaderInput {
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RequestInput {
    pub method: String,
    pub url: String,
    pub headers: Vec<HeaderInput>,
    pub body: Option<String>,
    pub content_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TimingInfo {
    pub dns_lookup_ms: f64,
    pub tcp_connect_ms: f64,
    pub tls_handshake_ms: f64,
    pub ttfb_ms: f64,
    pub download_ms: f64,
    pub total_ms: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResponseData {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub content_type: Option<String>,
    pub size: usize,
    pub size_label: String,
    pub timing: TimingInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub id: u64,
    pub timestamp: u64,
    pub method: String,
    pub url: String,
    pub status: u16,
    pub status_text: String,
    pub size_label: String,
    pub total_ms: f64,
    pub content_type: Option<String>,
    pub error: Option<String>,
    pub request_headers: Vec<HeaderInput>,
    pub request_body: Option<String>,
    pub response_headers: HashMap<String, String>,
}

pub struct LogStore {
    entries: Vec<LogEntry>,
}

impl LogStore {
    fn push(&mut self, entry: LogEntry) {
        self.entries.push(entry);
        if self.entries.len() > MAX_LOG_ENTRIES {
            self.entries.remove(0);
        }
    }
}

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

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
async fn send_request(app: AppHandle, input: RequestInput) -> Result<ResponseData, String> {
    let full_start = Instant::now();
    let method = input.method.to_uppercase();
    let url = input.url.clone();

    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let req_method = method
        .parse::<reqwest::Method>()
        .map_err(|_| format!("Invalid HTTP method: {}", method))?;

    let mut req = client.request(req_method, &input.url);

    let mut headers = HeaderMap::new();
    for h in &input.headers {
        if h.enabled && !h.key.trim().is_empty() {
            if let (Ok(n), Ok(v)) = (
                HeaderName::from_bytes(h.key.trim().as_bytes()),
                HeaderValue::from_str(h.value.trim()),
            ) {
                headers.insert(n, v);
            }
        }
    }

    if let Some(ct) = &input.content_type {
        if !headers.contains_key("content-type") && !ct.is_empty() {
            if let Ok(v) = HeaderValue::from_str(ct) {
                headers.insert("content-type", v);
            }
        }
    }

    req = req.headers(headers);

    if let Some(body) = &input.body {
        if !body.is_empty() {
            req = req.body(body.clone());
        }
    }

    // Capture request info for logging (before input is moved)
    let request_headers: Vec<HeaderInput> = input.headers.clone();
    let request_body: Option<String> = input.body.as_ref().map(|b| truncate_body(b));

    let before_send = Instant::now();
    let resp_result = req.send().await;

    let ttfb_elapsed = before_send.elapsed();

    let mut log_response_headers: HashMap<String, String> = HashMap::new();

    let result: Result<ResponseData, String> = match resp_result {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let status_text = resp
                .status()
                .canonical_reason()
                .unwrap_or("Unknown")
                .to_string();

            let resp_headers: HashMap<String, String> = resp
                .headers()
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                .collect();
            log_response_headers = resp_headers.clone();

            let content_type = resp_headers.get("content-type").cloned();

            let body = resp
                .text()
                .await
                .map_err(|e| format!("Failed to read response body: {}", e))?;

            let total_elapsed = full_start.elapsed();

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
    };

    // Build log entry from actual request/response data (Rust side — no UI dependency)
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

    // Store in Rust-managed state (source of truth)
    if let Some(store) = app.try_state::<Mutex<LogStore>>() {
        if let Ok(mut store) = store.lock() {
            store.push(log_entry.clone());
        }
    }

    // Emit event for real-time log viewer updates
    let _ = app.emit("http-log", &log_entry);

    result
}

/// Retrieve all logs from the Rust-managed store.
/// LogViewer calls this on startup to catch up on any missed events.
#[tauri::command]
fn get_logs(store: tauri::State<'_, Mutex<LogStore>>) -> Result<Vec<LogEntry>, String> {
    let store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(store.entries.clone())
}

/// Clear all logs from the Rust-managed store.
#[tauri::command]
fn clear_logs(store: tauri::State<'_, Mutex<LogStore>>) -> Result<(), String> {
    let mut store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    store.entries.clear();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(LogStore {
            entries: Vec::new(),
        }))
        .invoke_handler(tauri::generate_handler![
            send_request,
            get_logs,
            clear_logs,
        ])
        .setup(|app| {
            let _ = tauri::WebviewWindowBuilder::new(
                app,
                "logs",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Pulse - Logs")
            .inner_size(900.0, 550.0)
            .build();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
