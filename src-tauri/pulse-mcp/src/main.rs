// ============================================================
// Pulse MCP 服务器
//
// 实现 Model Context Protocol (MCP) 服务器，使 Claude Code 等
// AI Agent 能直接调用 Pulse 的 API 测试功能。
//
// 协议：JSON-RPC 2.0 over stdio
// - 从 stdin 读取 JSON-RPC 请求（每行一个 JSON 对象）
// - 向 stdout 写入 JSON-RPC 响应
// - 支持 tools/list 和 tools/call 方法
// ============================================================

// 允许：MCP 协议字段名（camelCase）和反序列化时未读取的框架字段
#![allow(non_snake_case, dead_code)]

use pulse_core::{
    analyze_response, execute_http_request, load_collections_data, load_environments_data,
    resolve_data_dir, save_environments_data, test_runner::test_script_to_yaml,
    EnvironmentVariable, HeaderInput, RequestInput,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================
// JSON-RPC 2.0 协议类型
// ============================================================

/** JSON-RPC 请求 */
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    #[serde(default)]
    id: Option<serde_json::Value>,
    method: String,
    #[serde(default)]
    params: Option<serde_json::Value>,
}

/** JSON-RPC 成功响应 */
#[derive(Debug, Serialize)]
struct JsonRpcSuccess {
    jsonrpc: String,
    id: serde_json::Value,
    result: serde_json::Value,
}

/** JSON-RPC 错误响应 */
#[derive(Debug, Serialize)]
struct JsonRpcError {
    jsonrpc: String,
    id: serde_json::Value,
    error: JsonRpcErrorBody,
}

/** JSON-RPC 错误体 */
#[derive(Debug, Serialize)]
struct JsonRpcErrorBody {
    code: i32,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
}

/** JSON-RPC 通知（无 ID） */
#[derive(Debug, Deserialize)]
struct JsonRpcNotification {
    jsonrpc: String,
    method: String,
    #[serde(default)]
    params: Option<serde_json::Value>,
}

// JSON-RPC 标准错误码
const PARSE_ERROR: i32 = -32700;
const METHOD_NOT_FOUND: i32 = -32601;

// ============================================================
// MCP 工具定义
// ============================================================

/** MCP 工具描述（返回给客户端用于 tools/list） */
#[derive(Debug, Serialize)]
struct McpTool {
    name: String,
    description: String,
    inputSchema: serde_json::Value,
}

/** MCP 工具调用结果中的内容项 */
#[derive(Debug, Serialize)]
struct McpContent {
    #[serde(rename = "type")]
    content_type: String,
    text: String,
}

/** MCP 工具调用结果 */
#[derive(Debug, Serialize)]
struct McpToolResult {
    content: Vec<McpContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    isError: Option<bool>,
}

// ============================================================
// 工具注册表
// ============================================================

/** 工具处理函数签名：接收参数字典，返回 MCP 结果 */
type ToolHandler = fn(&HashMap<String, serde_json::Value>) -> McpToolResult;

/** 注册的工具列表 */
struct RegisteredTool {
    tool: McpTool,
    handler: ToolHandler,
}

/** 全局工具注册表 */
struct ToolRegistry {
    tools: Vec<RegisteredTool>,
}

impl ToolRegistry {
    /** 创建工具注册表并注册所有工具 */
    fn new() -> Self {
        let mut registry = ToolRegistry { tools: Vec::new() };
        registry.register_all();
        registry
    }

    /** 注册所有 Pulse MCP 工具 */
    fn register_all(&mut self) {
        self.register(
            "send_request",
            "发送 HTTP 请求并返回完整响应（含状态码、头、体、耗时和 JSON 分析）",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "method": {
                        "type": "string",
                        "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
                        "description": "HTTP 方法"
                    },
                    "url": { "type": "string", "description": "请求 URL（支持 {{variable}} 插值）" },
                    "headers": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "key": { "type": "string" },
                                "value": { "type": "string" },
                                "enabled": { "type": "boolean" }
                            }
                        },
                        "description": "请求头列表（可选）"
                    },
                    "body": { "type": "string", "description": "请求体（可选）" },
                    "content_type": { "type": "string", "description": "Content-Type（可选）" },
                    "env_name": { "type": "string", "description": "激活的环境名称（可选，用于 {{key}} 变量替换）" }
                },
                "required": ["method", "url"]
            }),
            handle_send_request,
        );

        self.register(
            "run_test_script",
            "运行 YAML 格式的测试脚本（内联字符串），返回每个步骤的断言结果",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "script_yaml": { "type": "string", "description": "YAML 测试脚本内容" },
                    "env_name": { "type": "string", "description": "激活的环境名称（可选）" }
                },
                "required": ["script_yaml"]
            }),
            handle_run_test_script,
        );

        self.register(
            "run_test_file",
            "从文件路径加载并运行 YAML 测试脚本",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "YAML 测试脚本文件路径" },
                    "env_name": { "type": "string", "description": "激活的环境名称（可选）" }
                },
                "required": ["path"]
            }),
            handle_run_test_file,
        );

        self.register(
            "list_collections",
            "列出所有 API 集合及其包含的请求数量",
            serde_json::json!({
                "type": "object",
                "properties": {}
            }),
            handle_list_collections,
        );

        self.register(
            "get_collection_tree",
            "以树形结构展示所有集合及其请求的方法和 URL",
            serde_json::json!({
                "type": "object",
                "properties": {}
            }),
            handle_get_collection_tree,
        );

        self.register(
            "get_collection_request",
            "从指定集合中按名称查找并返回某条请求的详细配置",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "collection_name": { "type": "string", "description": "集合名称" },
                    "request_name": { "type": "string", "description": "请求名称" }
                },
                "required": ["collection_name", "request_name"]
            }),
            handle_get_collection_request,
        );

        self.register(
            "list_environments",
            "列出所有环境及其变量数量和激活状态",
            serde_json::json!({
                "type": "object",
                "properties": {}
            }),
            handle_list_environments,
        );

        self.register(
            "activate_environment",
            "按名称激活指定的环境，后续请求将使用该环境的变量进行 {{key}} 替换",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "要激活的环境名称" }
                },
                "required": ["name"]
            }),
            handle_activate_environment,
        );

        self.register(
            "create_test_script",
            "创建 YAML 格式的测试脚本文件，支持指定名称、描述、变量和请求列表，自动生成合法的 YAML 并保存到指定路径",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "测试脚本文件保存路径（必填）" },
                    "name": { "type": "string", "description": "测试脚本名称（必填）" },
                    "description": { "type": "string", "description": "测试脚本描述（可选）" },
                    "variables": {
                        "type": "object",
                        "description": "脚本级变量键值对（可选），如 {\"base_url\": \"http://localhost:8080\"}",
                        "additionalProperties": { "type": "string" }
                    },
                    "requests": {
                        "type": "array",
                        "description": "请求定义列表（必填，至少一个请求）",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": { "type": "string", "description": "请求步骤名称（必填）" },
                                "method": {
                                    "type": "string",
                                    "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
                                    "description": "HTTP 方法（必填）"
                                },
                                "url": { "type": "string", "description": "请求 URL，支持 {{variable}} 插值（必填）" },
                                "headers": {
                                    "type": "object",
                                    "description": "请求头键值对（可选）",
                                    "additionalProperties": { "type": "string" }
                                },
                                "body": { "type": "string", "description": "请求体字符串（可选）" },
                                "content_type": { "type": "string", "description": "Content-Type（可选）" },
                                "assertions": {
                                    "type": "array",
                                    "items": { "type": "string" },
                                    "description": "断言表达式列表，如 [\"status == 200\", \"body.success == true\"]"
                                },
                                "skip": { "type": "boolean", "description": "设为 true 可临时跳过此请求" }
                            },
                            "required": ["name", "method", "url"]
                        }
                    }
                },
                "required": ["path", "name", "requests"]
            }),
            handle_create_test_script,
        );
    }

    /** 注册单个工具 */
    fn register(&mut self, name: &str, description: &str, input_schema: serde_json::Value, handler: ToolHandler) {
        self.tools.push(RegisteredTool {
            tool: McpTool {
                name: name.to_string(),
                description: description.to_string(),
                inputSchema: input_schema,
            },
            handler,
        });
    }

    /** 获取所有工具的 JSON 描述列表 */
    fn list_tools(&self) -> Vec<McpTool> {
        self.tools.iter().map(|t| McpTool {
            name: t.tool.name.clone(),
            description: t.tool.description.clone(),
            inputSchema: t.tool.inputSchema.clone(),
        }).collect()
    }

    /** 调用指定名称的工具 */
    fn call_tool(&self, name: &str, args: &HashMap<String, serde_json::Value>) -> Result<McpToolResult, String> {
        for t in &self.tools {
            if t.tool.name == name {
                return Ok((t.handler)(args));
            }
        }
        Err(format!("未知工具: '{}'", name))
    }
}

// ============================================================
// 工具处理器实现
// ============================================================

/** 辅助：从参数字典提取字符串值 */
fn get_str(args: &HashMap<String, serde_json::Value>, key: &str) -> Option<String> {
    args.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

/** 辅助：获取活跃环境变量 */
fn get_active_variables(env_name: Option<&str>) -> Vec<EnvironmentVariable> {
    let data_dir = match resolve_data_dir() {
        Ok(d) => d,
        Err(_) => return vec![],
    };
    let env_data = load_environments_data(&data_dir);
    match env_name {
        Some(name) => env_data.environments.iter()
            .find(|e| e.name == name)
            .map(|e| e.variables.iter().filter(|v| v.enabled).cloned().collect())
            .unwrap_or_default(),
        None => env_data.active_id.as_ref()
            .and_then(|id| env_data.environments.iter().find(|e| &e.id == id))
            .map(|e| e.variables.iter().filter(|v| v.enabled).cloned().collect())
            .unwrap_or_default(),
    }
}

/** 处理 send_request 工具 */
fn handle_send_request(args: &HashMap<String, serde_json::Value>) -> McpToolResult {
    let method = get_str(args, "method").unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let url = match get_str(args, "url") {
        Some(u) => u,
        None => return error_result("缺少必填参数: url"),
    };
    let env_name = get_str(args, "env_name");

    // 解析请求头
    let headers: Vec<HeaderInput> = match args.get("headers") {
        Some(serde_json::Value::Array(arr)) => arr.iter().filter_map(|h| {
            let key = h.get("key")?.as_str()?.to_string();
            let value = h.get("value")?.as_str()?.to_string();
            let enabled = h.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true);
            Some(HeaderInput { key, value, enabled })
        }).collect(),
        _ => vec![],
    };

    let body = get_str(args, "body");
    let content_type = get_str(args, "content_type");

    let input = RequestInput {
        method,
        url: url.clone(),
        headers,
        body,
        content_type,
    };

    // 执行变量替换
    let variables = get_active_variables(env_name.as_deref());
    let exec_url = pulse_core::substitute_variables(&url, &variables);
    let exec_headers: Vec<HeaderInput> = input.headers.iter().map(|h| HeaderInput {
        key: pulse_core::substitute_variables(&h.key, &variables),
        value: pulse_core::substitute_variables(&h.value, &variables),
        enabled: h.enabled,
    }).collect();
    let exec_body = input.body.as_ref().map(|b| pulse_core::substitute_variables(b, &variables));
    let exec_ct = input.content_type.as_ref().map(|ct| pulse_core::substitute_variables(ct, &variables));

    let exec_input = RequestInput {
        method: input.method,
        url: exec_url,
        headers: exec_headers,
        body: exec_body,
        content_type: exec_ct,
    };

    let rt = match tokio::runtime::Runtime::new() {
        Ok(r) => r,
        Err(e) => return error_result(&format!("无法创建运行时: {}", e)),
    };

    match rt.block_on(execute_http_request(exec_input)) {
        Ok(response) => {
            let analysis = analyze_response(&response.body);
            let result = serde_json::json!({
                "status": response.status,
                "status_text": response.status_text,
                "headers": response.headers,
                "body": response.body,
                "content_type": response.content_type,
                "size": response.size,
                "size_label": response.size_label,
                "timing": response.timing,
                "_analysis": {
                    "json_paths": analysis.json_paths,
                    "body_preview": analysis.body_preview,
                    "is_json": analysis.is_json,
                    "json_type": analysis.json_type,
                    "top_keys": analysis.top_keys,
                },
            });
            text_result(&serde_json::to_string_pretty(&result).unwrap_or_default())
        }
        Err(e) => error_result(&e),
    }
}

/** 处理 run_test_script 工具 */
fn handle_run_test_script(args: &HashMap<String, serde_json::Value>) -> McpToolResult {
    let script_yaml = match get_str(args, "script_yaml") {
        Some(s) => s,
        None => return error_result("缺少必填参数: script_yaml"),
    };
    let env_name = get_str(args, "env_name");
    let variables = get_active_variables(env_name.as_deref());

    let rt = match tokio::runtime::Runtime::new() {
        Ok(r) => r,
        Err(e) => return error_result(&format!("无法创建运行时: {}", e)),
    };

    let result = rt.block_on(pulse_core::test_runner::run_test_script_internal(&script_yaml, &variables));
    text_result(&serde_json::to_string_pretty(&result).unwrap_or_default())
}

/** 处理 run_test_file 工具 */
fn handle_run_test_file(args: &HashMap<String, serde_json::Value>) -> McpToolResult {
    let path = match get_str(args, "path") {
        Some(p) => p,
        None => return error_result("缺少必填参数: path"),
    };
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => return error_result(&format!("无法读取文件 '{}': {}", path, e)),
    };
    let env_name = get_str(args, "env_name");
    let variables = get_active_variables(env_name.as_deref());

    let rt = match tokio::runtime::Runtime::new() {
        Ok(r) => r,
        Err(e) => return error_result(&format!("无法创建运行时: {}", e)),
    };

    let result = rt.block_on(pulse_core::test_runner::run_test_script_internal(&content, &variables));
    text_result(&serde_json::to_string_pretty(&result).unwrap_or_default())
}

/** 处理 list_collections 工具 */
fn handle_list_collections(_args: &HashMap<String, serde_json::Value>) -> McpToolResult {
    let data_dir = match resolve_data_dir() {
        Ok(d) => d,
        Err(e) => return error_result(&e),
    };
    let collections = load_collections_data(&data_dir);
    let summary = extract_collections_summary(&collections);
    text_result(&serde_json::to_string_pretty(&summary).unwrap_or_else(|_| "[]".to_string()))
}

/** 处理 get_collection_tree 工具 */
fn handle_get_collection_tree(_args: &HashMap<String, serde_json::Value>) -> McpToolResult {
    let data_dir = match resolve_data_dir() {
        Ok(d) => d,
        Err(e) => return error_result(&e),
    };
    let collections = load_collections_data(&data_dir);
    let tree = build_collection_tree(&collections);
    text_result(&serde_json::to_string_pretty(&tree).unwrap_or_else(|_| "{}".to_string()))
}

/** 处理 get_collection_request 工具 */
fn handle_get_collection_request(args: &HashMap<String, serde_json::Value>) -> McpToolResult {
    let collection_name = match get_str(args, "collection_name") {
        Some(n) => n,
        None => return error_result("缺少必填参数: collection_name"),
    };
    let request_name = match get_str(args, "request_name") {
        Some(n) => n,
        None => return error_result("缺少必填参数: request_name"),
    };

    let data_dir = match resolve_data_dir() {
        Ok(d) => d,
        Err(e) => return error_result(&e),
    };
    let collections = load_collections_data(&data_dir);
    let items = match collections.get("collections").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => return error_result("集合数据为空"),
    };

    let collection = match items.iter().find(|c| c.get("name").and_then(|n| n.as_str()) == Some(&collection_name)) {
        Some(c) => c,
        None => return error_result(&format!("未找到名为 '{}' 的集合", collection_name)),
    };

    let requests = match collection.get("requests").and_then(|r| r.as_array()) {
        Some(arr) => arr,
        None => return error_result(&format!("集合 '{}' 中没有请求", collection_name)),
    };

    match requests.iter().find(|r| r.get("name").and_then(|n| n.as_str()) == Some(&request_name)) {
        Some(req) => text_result(&serde_json::to_string_pretty(req).unwrap_or_default()),
        None => error_result(&format!("在集合 '{}' 中未找到请求 '{}'", collection_name, request_name)),
    }
}

/** 处理 list_environments 工具 */
fn handle_list_environments(_args: &HashMap<String, serde_json::Value>) -> McpToolResult {
    let data_dir = match resolve_data_dir() {
        Ok(d) => d,
        Err(e) => return error_result(&e),
    };
    let env_data = load_environments_data(&data_dir);
    let summary: Vec<serde_json::Value> = env_data.environments.iter().map(|env| {
        let is_active = env_data.active_id.as_ref().map(|id| id == &env.id).unwrap_or(false);
        serde_json::json!({
            "name": env.name,
            "variable_count": env.variables.len(),
            "active": is_active,
        })
    }).collect();
    text_result(&serde_json::to_string_pretty(&summary).unwrap_or_else(|_| "[]".to_string()))
}

/** 处理 activate_environment 工具 */
fn handle_activate_environment(args: &HashMap<String, serde_json::Value>) -> McpToolResult {
    let name = match get_str(args, "name") {
        Some(n) => n,
        None => return error_result("缺少必填参数: name"),
    };

    let data_dir = match resolve_data_dir() {
        Ok(d) => d,
        Err(e) => return error_result(&e),
    };
    let mut env_data = load_environments_data(&data_dir);

    match env_data.environments.iter().find(|e| e.name == name) {
        Some(env) => {
            env_data.active_id = Some(env.id.clone());
            match save_environments_data(&data_dir, &env_data) {
                Ok(_) => text_result(&format!("已成功激活环境 '{}'", name)),
                Err(e) => error_result(&format!("保存环境数据失败: {}", e)),
            }
        }
        None => error_result(&format!("未找到名为 '{}' 的环境", name)),
    }
}

/** 处理 create_test_script 工具 */
fn handle_create_test_script(args: &HashMap<String, serde_json::Value>) -> McpToolResult {
    let path = match get_str(args, "path") {
        Some(p) => p,
        None => return error_result("缺少必填参数: path"),
    };
    let name = match get_str(args, "name") {
        Some(n) => n,
        None => return error_result("缺少必填参数: name"),
    };
    let description = get_str(args, "description");

    // 解析脚本级变量
    let variables = args.get("variables").and_then(|v| v.as_object()).map(|obj| {
        obj.iter().map(|(k, v)| {
            (k.clone(), v.as_str().unwrap_or("").to_string())
        }).collect()
    });

    // 解析请求列表
    let requests = match args.get("requests").and_then(|r| r.as_array()) {
        Some(arr) if arr.is_empty() => return error_result("requests 不能为空数组"),
        Some(arr) => {
            let mut result = Vec::new();
            for (i, item) in arr.iter().enumerate() {
                let obj = match item.as_object() {
                    Some(o) => o,
                    None => return error_result(&format!("requests[{}] 必须是一个对象", i)),
                };
                let r_name = match obj.get("name").and_then(|v| v.as_str()) {
                    Some(n) => n.to_string(),
                    None => return error_result(&format!("requests[{}] 缺少必填字段: name", i)),
                };
                let method = match obj.get("method").and_then(|v| v.as_str()) {
                    Some(m) => m.to_string(),
                    None => return error_result(&format!("requests[{}] 缺少必填字段: method", i)),
                };
                let url = match obj.get("url").and_then(|v| v.as_str()) {
                    Some(u) => u.to_string(),
                    None => return error_result(&format!("requests[{}] 缺少必填字段: url", i)),
                };
                let headers = obj.get("headers").and_then(|v| v.as_object()).map(|h| {
                    h.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string())).collect()
                });
                let body = obj.get("body").and_then(|v| v.as_str()).map(|s| s.to_string());
                let content_type = obj.get("content_type").and_then(|v| v.as_str()).map(|s| s.to_string());
                let assertions = obj.get("assertions").and_then(|v| v.as_array())
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default();
                let skip = obj.get("skip").and_then(|v| v.as_bool());

                result.push(pulse_core::test_runner::TestRequest {
                    name: r_name,
                    method,
                    url,
                    headers,
                    body,
                    content_type,
                    assertions,
                    skip,
                });
            }
            result
        }
        None => return error_result("缺少必填参数: requests"),
    };

    let script = pulse_core::test_runner::TestScript {
        name,
        description,
        variables,
        requests,
    };

    // 序列化为 YAML
    let yaml = match test_script_to_yaml(&script) {
        Ok(y) => y,
        Err(e) => return error_result(&e),
    };

    // 确保目标目录存在
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // 写入文件（静默覆盖已有文件）
    match std::fs::write(&path, &yaml) {
        Ok(_) => text_result(&format!(
            "测试脚本已成功创建\n路径: {}\n名称: {}\n请求数: {}",
            path, script.name, script.requests.len()
        )),
        Err(e) => error_result(&format!("写入文件失败 '{}': {}", path, e)),
    }
}

// ============================================================
// 辅助函数
// ============================================================

/** 创建文本类型的 MCP 结果 */
fn text_result(text: &str) -> McpToolResult {
    McpToolResult {
        content: vec![McpContent {
            content_type: "text".to_string(),
            text: text.to_string(),
        }],
        isError: None,
    }
}

/** 创建错误类型的 MCP 结果 */
fn error_result(error: &str) -> McpToolResult {
    McpToolResult {
        content: vec![McpContent {
            content_type: "text".to_string(),
            text: error.to_string(),
        }],
        isError: Some(true),
    }
}

/** 提取集合摘要（名称 + 请求数量） */
fn extract_collections_summary(collections: &serde_json::Value) -> Vec<serde_json::Value> {
    collections
        .get("collections")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|c| {
                    let name = c.get("name").and_then(|n| n.as_str()).unwrap_or("(未命名)");
                    let count = c
                        .get("requests")
                        .and_then(|r| r.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    serde_json::json!({
                        "name": name,
                        "request_count": count,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/** 构建集合树结构 */
fn build_collection_tree(collections: &serde_json::Value) -> serde_json::Value {
    let items: Vec<serde_json::Value> = collections
        .get("collections")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|c| {
                    let name = c.get("name").and_then(|n| n.as_str()).unwrap_or("(未命名)");
                    let requests: Vec<serde_json::Value> = c
                        .get("requests")
                        .and_then(|r| r.as_array())
                        .map(|reqs| {
                            reqs
                                .iter()
                                .map(|r| {
                                    let rname = r.get("name").and_then(|n| n.as_str()).unwrap_or("(未命名)");
                                    let method = r.get("method").and_then(|m| m.as_str()).unwrap_or("GET");
                                    let url = r.get("url").and_then(|u| u.as_str()).unwrap_or("");
                                    serde_json::json!({
                                        "name": rname,
                                        "method": method,
                                        "url": url,
                                    })
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    serde_json::json!({
                        "name": name,
                        "requests": requests,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    serde_json::json!({ "collections": items })
}

// ============================================================
// 主入口：stdio JSON-RPC 服务器
// ============================================================

fn main() {
    // 支持 --version 参数输出兼容的 MCP 协议版本
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && (args[1] == "--version" || args[1] == "-v") {
        println!("pulse-mcp 0.1.0 (MCP 2024-11-05)");
        return;
    }

    let registry = ToolRegistry::new();
    let stdin = std::io::stdin();
    let reader = std::io::BufReader::new(stdin);

    use std::io::BufRead;

    // 持续读取 stdin 上的 JSON-RPC 请求
    for line in reader.lines() {
        match line {
            Ok(text) => {
                let trimmed = text.trim().to_string();
                if trimmed.is_empty() {
                    continue;
                }
                // 处理单行 JSON-RPC 请求
                match serde_json::from_str::<JsonRpcRequest>(&trimmed) {
                    Ok(req) => {
                        let response = handle_request(&registry, &req);
                        // 对于有 ID 的请求，写入响应
                        if req.id.is_some() {
                            println!("{}", serde_json::to_string(&response).unwrap_or_default());
                        }
                        // 无 ID 的请求是通知，不响应
                    }
                    Err(_) => {
                        // 尝试解析为通知（无 ID 的消息）
                        if let Ok(_notif) = serde_json::from_str::<JsonRpcNotification>(&trimmed) {
                            // 通知不需要响应，忽略
                        } else {
                            // 解析失败 → 返回 JSON-RPC 解析错误
                            let err_resp = JsonRpcError {
                                jsonrpc: "2.0".to_string(),
                                id: serde_json::Value::Null,
                                error: JsonRpcErrorBody {
                                    code: PARSE_ERROR,
                                    message: "无法解析 JSON-RPC 请求".to_string(),
                                    data: Some(serde_json::json!({
                                        "raw": trimmed
                                    })),
                                },
                            };
                            println!("{}", serde_json::to_string(&err_resp).unwrap_or_default());
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("读取 stdin 错误: {}", e);
                break;
            }
        }
    }
}

/**
 * 处理 JSON-RPC 请求并返回响应
 */
fn handle_request(registry: &ToolRegistry, req: &JsonRpcRequest) -> serde_json::Value {
    let id = req.id.clone().unwrap_or(serde_json::Value::Null);

    match req.method.as_str() {
        // ===== MCP 协议方法 =====
        "initialize" => {
            // 初始化握手：返回服务器信息
            serde_json::to_value(JsonRpcSuccess {
                jsonrpc: "2.0".to_string(),
                id,
                result: serde_json::json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "pulse-mcp",
                        "version": "0.1.0"
                    }
                }),
            }).unwrap_or_default()
        }

        "tools/list" => {
            let tools = registry.list_tools();
            serde_json::to_value(JsonRpcSuccess {
                jsonrpc: "2.0".to_string(),
                id,
                result: serde_json::json!({ "tools": tools }),
            }).unwrap_or_default()
        }

        "tools/call" => {
            // 从 params 中提取工具名称和参数
            let params = req.params.as_ref().and_then(|p| p.as_object()).cloned().unwrap_or_default();
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let arguments = params.get("arguments")
                .and_then(|a| a.as_object())
                .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                .unwrap_or_default();

            match registry.call_tool(name, &arguments) {
                Ok(result) => {
                    serde_json::to_value(JsonRpcSuccess {
                        jsonrpc: "2.0".to_string(),
                        id,
                        result: serde_json::json!(result),
                    }).unwrap_or_default()
                }
                Err(e) => {
                    serde_json::to_value(JsonRpcError {
                        jsonrpc: "2.0".to_string(),
                        id,
                        error: JsonRpcErrorBody {
                            code: METHOD_NOT_FOUND,
                            message: e,
                            data: None,
                        },
                    }).unwrap_or_default()
                }
            }
        }

        // ===== 其他方法 → 未找到 =====
        _ => {
            serde_json::to_value(JsonRpcError {
                jsonrpc: "2.0".to_string(),
                id,
                error: JsonRpcErrorBody {
                    code: METHOD_NOT_FOUND,
                    message: format!("未知方法: '{}'", req.method),
                    data: None,
                },
            }).unwrap_or_default()
        }
    }
}
