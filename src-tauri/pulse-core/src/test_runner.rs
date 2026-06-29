// ============================================================
// Test Script Runner 模块
//
// 解析 YAML 测试脚本，逐个执行请求，验证断言，返回结构化结果。
// 纯执行逻辑，不依赖 Tauri 状态——execute_http_request 由调用方注入。
// ============================================================

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{
    chrono_now_iso, execute_http_request, substitute_variables,
    EnvironmentVariable, HeaderInput, RequestInput, ResponseData,
};

// ============================================================
// YAML 解析数据结构（反序列化）
// ============================================================

/** YAML 测试脚本顶层结构 */
#[derive(Debug, Serialize, Deserialize)]
pub struct TestScript {
    /** 脚本名称（用于结果展示） */
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /** 脚本级变量，用于 {{key}} 模板替换，优先级高于激活环境 */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variables: Option<HashMap<String, String>>,
    /** 内联请求定义列表 */
    #[serde(default)]
    pub requests: Vec<TestRequest>,
}

/** 测试脚本中的单个请求定义 */
#[derive(Debug, Serialize, Deserialize)]
pub struct TestRequest {
    /** 步骤显示名称 */
    pub name: String,
    /** HTTP 方法（GET/POST 等） */
    pub method: String,
    /** 请求 URL（支持 {{variable}} 插值） */
    pub url: String,
    /** 请求头键值对 */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    /** 请求体（null 表示无体） */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /** Content-Type */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /** 断言表达式列表，例如 "status == 200" 或 "body.success == true" */
    #[serde(default)]
    pub assertions: Vec<String>,
    /** 设为 true 可临时跳过此请求 */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip: Option<bool>,
}

// ============================================================
// 执行结果数据结构（序列化 → 返回前端）
// ============================================================

/** 一次测试运行的完整结果 */
#[derive(Debug, Serialize)]
pub struct TestRunResult {
    pub script_name: String,
    pub started_at: String,
    pub completed_at: String,
    pub total_steps: usize,
    pub passed_steps: usize,
    pub failed_steps: usize,
    pub steps: Vec<TestStepResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/** 单个请求的执行结果 */
#[derive(Debug, Serialize)]
pub struct TestStepResult {
    pub name: String,
    pub passed: bool,
    pub status: u16,
    pub status_text: String,
    pub duration_ms: f64,
    pub size_label: String,
    pub url: String,
    pub method: String,
    pub assertion_results: Vec<AssertionResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/** 单条断言的验证结果 */
#[derive(Debug, Serialize)]
pub struct AssertionResult {
    pub expression: String,
    pub passed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ============================================================
// 公共入口：解析 YAML 测试脚本
// ============================================================

/** 将 YAML 字符串解析为 TestScript */
pub fn parse_test_script(yaml: &str) -> Result<TestScript, String> {
    serde_yaml::from_str::<TestScript>(yaml)
        .map_err(|e| format!("YAML 解析失败: {}", e))
}

/** 将 TestScript 序列化为 YAML 字符串 */
pub fn test_script_to_yaml(script: &TestScript) -> Result<String, String> {
    serde_yaml::to_string(script)
        .map_err(|e| format!("YAML 序列化失败: {}", e))
}

// ============================================================
// 公共入口：执行测试脚本
// ============================================================

/**
 * 运行测试脚本（主入口）
 *
 * 1. 解析 YAML → TestScript
 * 2. 合并脚本变量与激活环境变量（脚本变量优先级更高）
 * 3. 逐个执行请求，验证断言
 * 4. 返回 TestRunResult（含总览 + 每步明细）
 *
 * @param yaml_content       YAML 文件内容
 * @param active_variables   当前激活的环境变量（来自 app 状态）
 */
pub async fn run_test_script_internal(
    yaml_content: &str,
    active_variables: &[EnvironmentVariable],
) -> TestRunResult {
    let started_at = chrono_now_iso();

    // 步骤 1: 解析 YAML
    let script = match parse_test_script(yaml_content) {
        Ok(s) => s,
        Err(e) => {
            return TestRunResult {
                script_name: "Parse Error".into(),
                started_at,
                completed_at: chrono_now_iso(),
                total_steps: 0,
                passed_steps: 0,
                failed_steps: 0,
                steps: vec![],
                error: Some(e),
            };
        }
    };

    // 步骤 2: 合并变量（激活环境 + 脚本变量，脚本优先）
    let merged_vars = merge_variables(active_variables, &script.variables);

    // 步骤 3: 逐个执行请求
    let mut steps = Vec::with_capacity(script.requests.len());
    let mut passed_steps = 0usize;

    for req_item in &script.requests {
        let step_result = execute_single_request(req_item, &merged_vars).await;
        if step_result.passed {
            passed_steps += 1;
        }
        steps.push(step_result);
    }

    let total_steps = steps.len();
    let failed_steps = total_steps - passed_steps;

    TestRunResult {
        script_name: script.name,
        started_at,
        completed_at: chrono_now_iso(),
        total_steps,
        passed_steps,
        failed_steps,
        steps,
        error: None,
    }
}

// ============================================================
// 内部函数
// ============================================================

/**
 * 合并激活环境变量与脚本级变量
 * 脚本级变量优先级更高（同名覆盖环境变量）
 */
fn merge_variables(
    active: &[EnvironmentVariable],
    script_vars: &Option<HashMap<String, String>>,
) -> Vec<EnvironmentVariable> {
    let mut combined: HashMap<String, String> = HashMap::new();

    // 先加入激活环境中启用的变量
    for v in active {
        if v.enabled {
            combined.insert(v.key.clone(), v.value.clone());
        }
    }

    // 脚本级变量覆盖（优先级更高）
    if let Some(vars) = script_vars {
        for (k, v) in vars {
            combined.insert(k.clone(), v.clone());
        }
    }

    combined
        .into_iter()
        .map(|(key, value)| EnvironmentVariable {
            key,
            value,
            enabled: true,
        })
        .collect()
}

/**
 * 执行单个请求并验证断言
 */
async fn execute_single_request(
    req_item: &TestRequest,
    variables: &[EnvironmentVariable],
) -> TestStepResult {
    // 检查是否跳过
    if req_item.skip.unwrap_or(false) {
        return TestStepResult {
            name: req_item.name.clone(),
            passed: true,
            status: 0,
            status_text: "Skipped".into(),
            duration_ms: 0.0,
            size_label: "0 B".into(),
            url: req_item.url.clone(),
            method: req_item.method.clone(),
            assertion_results: vec![],
            error: None,
        };
    }

    // 对 URL 和请求体执行变量替换
    let url = substitute_variables(&req_item.url, variables);
    let body = req_item
        .body
        .as_ref()
        .map(|b| substitute_variables(b, variables));
    let content_type = req_item
        .content_type
        .as_ref()
        .map(|ct| substitute_variables(ct, variables));

    // 构建请求头列表（HashMap → Vec<HeaderInput> + 变量替换）
    let headers = build_headers(&req_item.headers, variables);

    let method = req_item.method.to_uppercase();

    // 构建 RequestInput 并执行
    let input = RequestInput {
        method: method.clone(),
        url: url.clone(),
        headers,
        body,
        content_type,
    };

    let exec_start = std::time::Instant::now();
    let result = execute_http_request(input).await;
    let duration_ms = exec_start.elapsed().as_secs_f64() * 1000.0;

    match result {
        Ok(response) => {
            // 验证断言
            let assertion_results =
                evaluate_assertions(&req_item.assertions, &response, duration_ms);

            let all_passed = assertion_results.iter().all(|a| a.passed);

            TestStepResult {
                name: req_item.name.clone(),
                passed: all_passed,
                status: response.status,
                status_text: response.status_text,
                duration_ms,
                size_label: response.size_label,
                url,
                method,
                assertion_results,
                error: None,
            }
        }
        Err(err) => TestStepResult {
            name: req_item.name.clone(),
            passed: false,
            status: 0,
            status_text: "Error".into(),
            duration_ms,
            size_label: "0 B".into(),
            url,
            method,
            assertion_results: vec![],
            error: Some(err),
        },
    }
}

/**
 * 将可选的 HashMap 请求头转换为 Vec<HeaderInput>，同时执行变量替换
 */
fn build_headers(
    headers_opt: &Option<HashMap<String, String>>,
    variables: &[EnvironmentVariable],
) -> Vec<HeaderInput> {
    match headers_opt {
        Some(hdrs) => hdrs
            .iter()
            .map(|(k, v)| HeaderInput {
                key: k.clone(),
                value: substitute_variables(v, variables),
                enabled: true,
            })
            .collect(),
        None => vec![],
    }
}

// ============================================================
// 断言引擎
// ============================================================

/**
 * 验证所有断言表达式
 *
 * 支持的表达式格式：<field> <op> <expected>
 *
 * 字段：
 *   status               — HTTP 状态码
 *   body                 — 响应体原始字符串（用于 contains）
 *   body.<jsonpath>      — JSON 路径取值
 *   duration_ms          — 请求耗时（毫秒）
 *   headers.<name>       — 响应头值
 *
 * 运算符：
 *   ==, !=, <, <=, >, >=, contains
 *
 * 预期值：
 *   数字 (200, 5.5)      — 数值比较
 *   '引号字符串'          — 字符串比较
 *   "双引号字符串"        — 字符串比较
 *   true / false          — 布尔比较
 *   null                  — null 值比较
 *   []                    — 空数组比较
 */
fn evaluate_assertions(
    assertions: &[String],
    response: &ResponseData,
    duration_ms: f64,
) -> Vec<AssertionResult> {
    if assertions.is_empty() {
        // 无断言则默认通过
        return vec![];
    }

    assertions
        .iter()
        .map(|expr| evaluate_single_assertion(expr, response, duration_ms))
        .collect()
}

/** 验证单条断言表达式 */
fn evaluate_single_assertion(
    expression: &str,
    response: &ResponseData,
    duration_ms: f64,
) -> AssertionResult {
    let trimmed = expression.trim();

    // 为空时视作通过
    if trimmed.is_empty() {
        return AssertionResult {
            expression: expression.to_string(),
            passed: true,
            actual_value: None,
            expected_value: None,
            error: None,
        };
    }

    // 步骤 1: 解析表达式 → (left, op, right)
    let (left, op, right) = match split_expression(trimmed) {
        Some(parts) => parts,
        None => {
            return AssertionResult {
                expression: expression.to_string(),
                passed: false,
                actual_value: None,
                expected_value: None,
                error: Some(format!("无法解析断言表达式: '{}'", trimmed)),
            };
        }
    };

    // 步骤 2: 解析右侧值
    let expected = parse_expected_value(right);

    // 步骤 3: 解析左侧值
    let actual = resolve_left_value(left, response, duration_ms);

    // 步骤 4: 执行比较
    let passed = match actual {
        Some(ref actual_val) => compare_values(actual_val, &expected, op),
        None => false, // 左侧值无法解析 → 不通过
    };

    AssertionResult {
        expression: expression.to_string(),
        passed,
        actual_value: actual.map(|v| v.to_string()),
        expected_value: Some(format!("{:?}", expected)),
        error: None,
    }
}

// ============================================================
// 表达式解析
// ============================================================

/**
 * 要检查的运算符（按长度降序排列，确保先匹配 <=、>= 等双字符运算符）
 */
const OPERATORS: &[&str] = &["<=", ">=", "==", "!=", "<", ">", "contains"];

/**
 * 将断言表达式拆分为 (左值, 运算符, 右值)
 */
fn split_expression(expr: &str) -> Option<(&str, &str, &str)> {
    for op in OPERATORS {
        if let Some(idx) = expr.find(op) {
            let left = expr[..idx].trim();
            let right = expr[idx + op.len()..].trim();
            if !left.is_empty() && !right.is_empty() {
                return Some((left, op, &right));
            }
        }
    }
    None
}

// ============================================================
// 左侧值解析器
// ============================================================

/**
 * 解析左侧字段路径，返回实际值
 */
fn resolve_left_value(
    left: &str,
    response: &ResponseData,
    duration_ms: f64,
) -> Option<ResolvedValue> {
    if left == "status" {
        return Some(ResolvedValue::Number(response.status as f64));
    }

    if left == "body" {
        return Some(ResolvedValue::String(response.body.clone()));
    }

    if left == "duration_ms" {
        return Some(ResolvedValue::Number(duration_ms));
    }

    if let Some(header_name) = left.strip_prefix("headers.") {
        let value = response.headers.get(header_name).cloned();
        return value.map(ResolvedValue::String);
    }

    if let Some(json_path) = left.strip_prefix("body.") {
        // 尝试将响应体解析为 JSON 并导航路径
        match serde_json::from_str::<serde_json::Value>(&response.body) {
            Ok(json_value) => match resolve_json_path(&json_value, json_path) {
                Some(v) => Some(json_value_to_resolved(v)),
                None => Some(ResolvedValue::Error(format!(
                    "JSON 路径 '{}' 不存在",
                    json_path
                ))),
            },
            Err(_) => Some(ResolvedValue::Error(
                "响应体不是有效的 JSON".to_string(),
            )),
        }
    } else {
        Some(ResolvedValue::Error(format!(
            "未知的字段: '{}'",
            left
        )))
    }
}

// ============================================================
// JSON 路径导航
// ============================================================

/**
 * 沿点分路径导航 JSON Value。
 * 支持数组索引语法：items[0].id
 */
fn resolve_json_path<'a>(
    value: &'a serde_json::Value,
    path: &str,
) -> Option<&'a serde_json::Value> {
    let segments = path.split('.');
    let mut current = value;

    for segment in segments {
        current = match current {
            serde_json::Value::Object(map) => {
                // 处理 array[index] 语法
                if let Some(bracket) = segment.find('[') {
                    let key = &segment[..bracket];
                    let rest = &segment[bracket..];
                    if let Some(arr) = map.get(key) {
                        resolve_array_index(arr, rest)?
                    } else {
                        return None;
                    }
                } else {
                    map.get(segment)?
                }
            }
            serde_json::Value::Array(arr) => {
                // 当前是数组，segment 应为数字索引
                let idx: usize = segment.parse().ok()?;
                arr.get(idx)?
            }
            _ => return None,
        };
    }

    Some(current)
}

/**
 * 从数组语法 `[index]` 或 `[index].rest` 中提取元素
 */
fn resolve_array_index<'a>(
    array: &'a serde_json::Value,
    bracket_expr: &str,
) -> Option<&'a serde_json::Value> {
    let rest = bracket_expr.strip_prefix('[')?;
    let close = rest.find(']')?;
    let idx: usize = rest[..close].parse().ok()?;

    match array {
        serde_json::Value::Array(arr) => {
            let item = arr.get(idx)?;
            // 检查后面是否有继续导航的路径
            let after = rest[close + 1..].trim();
            if after.is_empty() || after == "." {
                Some(item)
            } else if let Some(tail) = after.strip_prefix('.') {
                resolve_json_path(item, tail)
            } else {
                Some(item)
            }
        }
        _ => None,
    }
}

// ============================================================
// 值表示与比较
// ============================================================

/** 内部值表示，支持数字、字符串、布尔、null、数组比较 */
#[derive(Debug)]
enum ResolvedValue {
    Number(f64),
    String(String),
    Bool(bool),
    Null,
    EmptyArray,
    Error(String),
}

impl std::fmt::Display for ResolvedValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResolvedValue::Number(n) => write!(f, "{}", n),
            ResolvedValue::String(s) => write!(f, "'{}'", s),
            ResolvedValue::Bool(b) => write!(f, "{}", b),
            ResolvedValue::Null => write!(f, "null"),
            ResolvedValue::EmptyArray => write!(f, "[]"),
            ResolvedValue::Error(e) => write!(f, "<error: {}>", e),
        }
    }
}

/** 将 serde_json::Value 转换为 ResolvedValue */
fn json_value_to_resolved(v: &serde_json::Value) -> ResolvedValue {
    match v {
        serde_json::Value::Null => ResolvedValue::Null,
        serde_json::Value::Bool(b) => ResolvedValue::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                ResolvedValue::Number(f)
            } else {
                ResolvedValue::String(n.to_string())
            }
        }
        serde_json::Value::String(s) => ResolvedValue::String(s.clone()),
        serde_json::Value::Array(a) => {
            if a.is_empty() {
                ResolvedValue::EmptyArray
            } else {
                ResolvedValue::String(serde_json::to_string(a).unwrap_or_default())
            }
        }
        serde_json::Value::Object(_) => {
            ResolvedValue::String(serde_json::to_string(v).unwrap_or_default())
        }
    }
}

/** 解析期望值字符串 */
fn parse_expected_value(s: &str) -> ResolvedValue {
    let s = s.trim();

    // 空数组
    if s == "[]" {
        return ResolvedValue::EmptyArray;
    }

    // null
    if s == "null" {
        return ResolvedValue::Null;
    }

    // 布尔值
    if s == "true" {
        return ResolvedValue::Bool(true);
    }
    if s == "false" {
        return ResolvedValue::Bool(false);
    }

    // 引号字符串
    if (s.starts_with('\'') && s.ends_with('\'')) || (s.starts_with('"') && s.ends_with('"')) {
        let inner = &s[1..s.len() - 1];
        return ResolvedValue::String(inner.to_string());
    }

    // 数字
    if let Ok(n) = s.parse::<f64>() {
        return ResolvedValue::Number(n);
    }

    // 兜底：作为字符串处理
    ResolvedValue::String(s.to_string())
}

/**
 * 比较两个值
 * 尽量进行类型安全的比较（数字 vs 数字，字符串 vs 字符串）
 */
fn compare_values(actual: &ResolvedValue, expected: &ResolvedValue, op: &str) -> bool {
    // contains 运算符特殊处理
    if op == "contains" {
        return compare_contains(actual, expected);
    }

    // 将两个值归一化为可比较的形式
    match (actual, expected) {
        // 两个数字 → 数值比较
        (ResolvedValue::Number(a), ResolvedValue::Number(e)) => compare_numbers(*a, *e, op),

        // 数字 vs 字符串 → 尝试将字符串转为数字
        (ResolvedValue::Number(a), ResolvedValue::String(e)) => {
            if let Ok(en) = e.parse::<f64>() {
                compare_numbers(*a, en, op)
            } else {
                // 转数字失败，使用字符串表示
                compare_strings(&a.to_string(), e, op)
            }
        }
        (ResolvedValue::String(a), ResolvedValue::Number(e)) => {
            if let Ok(an) = a.parse::<f64>() {
                compare_numbers(an, *e, op)
            } else {
                compare_strings(a, &e.to_string(), op)
            }
        }

        // 两个布尔值
        (ResolvedValue::Bool(a), ResolvedValue::Bool(e)) => compare_bools(*a, *e, op),

        // null 比较
        (ResolvedValue::Null, ResolvedValue::Null) => compare_nulls(op),
        (ResolvedValue::Null, _) | (_, ResolvedValue::Null) => {
            // null vs 非 null → 仅 == 和 != 有意义
            matches!(op, "!=")
        }

        // 空数组比较
        (ResolvedValue::EmptyArray, ResolvedValue::EmptyArray) => {
            compare_empty_arrays(op)
        }
        (ResolvedValue::EmptyArray, ResolvedValue::String(s)) if s == "[]" => {
            compare_empty_arrays(op)
        }

        // 默认：字符串比较
        _ => compare_strings(&actual.to_string(), &expected.to_string(), op),
    }
}

/** 数值比较 */
fn compare_numbers(a: f64, e: f64, op: &str) -> bool {
    match op {
        "==" => (a - e).abs() < f64::EPSILON,
        "!=" => (a - e).abs() >= f64::EPSILON,
        "<" => a < e,
        "<=" => a <= e,
        ">" => a > e,
        ">=" => a >= e,
        _ => false,
    }
}

/** 字符串比较 */
fn compare_strings(a: &str, e: &str, op: &str) -> bool {
    match op {
        "==" => a == e,
        "!=" => a != e,
        "<" => a < e,
        "<=" => a <= e,
        ">" => a > e,
        ">=" => a >= e,
        _ => false,
    }
}

/** 布尔比较 */
fn compare_bools(a: bool, e: bool, op: &str) -> bool {
    match op {
        "==" => a == e,
        "!=" => a != e,
        _ => false,
    }
}

/** null 值比较 */
fn compare_nulls(op: &str) -> bool {
    matches!(op, "==")
}

/** 空数组比较 */
fn compare_empty_arrays(op: &str) -> bool {
    matches!(op, "==")
}

/** contains 运算符：左侧是否包含右侧 */
fn compare_contains(actual: &ResolvedValue, expected: &ResolvedValue) -> bool {
    let haystack = match actual {
        ResolvedValue::String(s) => s.clone(),
        ResolvedValue::Number(n) => n.to_string(),
        ResolvedValue::Bool(b) => b.to_string(),
        ResolvedValue::Null => "null".to_string(),
        ResolvedValue::EmptyArray => "[]".to_string(),
        ResolvedValue::Error(e) => e.clone(),
    };

    let needle = match expected {
        ResolvedValue::String(s) => s.clone(),
        ResolvedValue::Number(n) => n.to_string(),
        ResolvedValue::Bool(b) => b.to_string(),
        ResolvedValue::Null => "null".to_string(),
        ResolvedValue::EmptyArray => "[]".to_string(),
        ResolvedValue::Error(e) => e.clone(),
    };

    haystack.contains(&needle)
}
