// ============================================================
// CLI 命令行界面模块
//
// 使用 clap 实现参数解析，支持 request/test/collections/
// environments/export/import 等命令。与 GUI 共享同一份数据文件。
// ============================================================

use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;

use crate::{
    EnvironmentData, EnvironmentVariable, HeaderInput, RequestInput, ResponseData,
    execute_http_request, load_collections_data, load_environments_data,
    resolve_data_dir, save_collections_data, save_environments_data,
    substitute_variables,
};
use crate::io::{self, ExportFormat};
use crate::test_runner;

// ============================================================
// CLI 参数定义
// ============================================================

/** CLI 顶层参数 */
#[derive(Parser)]
#[command(name = "pulse", version = "0.1.0", about = "Pulse — HTTP 请求调试工具 (CLI 模式)")]
struct Cli {
    /** 全局 JSON 输出模式，所有命令输出 JSON 格式 */
    #[arg(long, global = true, help = "以 JSON 格式输出（默认 human-readable）")]
    json: bool,

    #[command(subcommand)]
    command: Command,
}

/** CLI 子命令 */
#[derive(Subcommand)]
enum Command {
    /** 发送 HTTP 请求并打印响应 */
    Request(RequestArgs),
    /** 运行 YAML 测试脚本 */
    Test(TestArgs),
    /** 管理集合（列出等） */
    #[command(subcommand)]
    Collections(CollectionAction),
    /** 管理环境变量 */
    #[command(subcommand)]
    Env(EnvAction),
    /** 导出数据到文件 */
    Export(ExportArgs),
    /** 从文件导入数据 */
    Import(ImportArgs),
}

/** request 子命令参数 */
#[derive(Args)]
struct RequestArgs {
    /** HTTP 方法 */
    #[arg(short = 'm', long, default_value = "GET", help = "HTTP 方法 (GET/POST/PUT/PATCH/DELETE 等)")]
    method: String,

    /** 请求头，支持重复: -H "Key: Value" */
    #[arg(short = 'H', long = "header", help = "请求头，格式 Key: Value（可重复）")]
    header: Vec<String>,

    /** 请求体 */
    #[arg(short = 'b', long = "body", help = "请求体字符串")]
    body: Option<String>,

    /** Content-Type */
    #[arg(short = 't', long = "content-type", help = "Content-Type 头")]
    content_type: Option<String>,

    /** 激活的环境名称 */
    #[arg(short = 'e', long = "env", help = "激活的环境名称（用于 {{key}} 变量替换）")]
    env: Option<String>,

    /** Bearer Token */
    #[arg(long = "auth-bearer", help = "Bearer Token 鉴权")]
    auth_bearer: Option<String>,

    /** 目标 URL */
    #[arg(help = "请求目标 URL")]
    url: String,
}

/** test 子命令参数 */
#[derive(Args)]
struct TestArgs {
    /** 激活的环境名称 */
    #[arg(short = 'e', long = "env", help = "激活的环境名称")]
    env: Option<String>,

    /** YAML 测试脚本路径 */
    #[arg(help = "YAML 测试脚本路径")]
    path: String,
}

/** env 子命令 */
#[derive(Subcommand)]
enum EnvAction {
    /** 列出所有环境 */
    List,
    /** 激活指定名称的环境 */
    Use { name: String },
}

/** collections 子命令 */
#[derive(Subcommand)]
enum CollectionAction {
    /** 列出所有集合 */
    List,
}

/** export 子命令参数 */
#[derive(Args)]
struct ExportArgs {
    /** 输出文件路径 */
    #[arg(short = 'o', long = "output", help = "输出文件路径（默认自动生成）")]
    output: Option<String>,

    /** 导出格式 */
    #[arg(short = 'f', long = "format", default_value = "json", help = "导出格式 (json|yaml)")]
    format: String,

    /** 按集合名称筛选（可重复） */
    #[arg(short = 'c', long = "collection", help = "按集合名称筛选（可重复，默认全部）")]
    collection: Vec<String>,
}

/** import 子命令参数 */
#[derive(Args)]
struct ImportArgs {
    /** 合并策略 */
    #[arg(short = 's', long = "strategy", default_value = "merge", help = "导入策略 (replace|merge)")]
    strategy: String,

    /** 导入文件路径 */
    #[arg(help = "导入文件路径 (.json/.yaml/.yml)")]
    path: String,
}

// ============================================================
// CLI 入口
// ============================================================

/**
 * CLI 主入口
 *
 * 1. 解析命令行参数
 * 2. 确定数据目录
 * 3. 派发到对应命令处理器
 * 4. 打印输出
 */
pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let json_mode = cli.json;
    let data_dir = resolve_data_dir()?;

    match cli.command {
        Command::Request(args) => handle_request(&args, &data_dir, json_mode),
        Command::Test(args) => handle_test(&args, &data_dir, json_mode),
        Command::Collections(action) => handle_collections_action(&action, &data_dir, json_mode),
        Command::Env(action) => handle_env_action(&action, &data_dir, json_mode),
        Command::Export(args) => handle_export(&args, &data_dir, json_mode),
        Command::Import(args) => handle_import(&args, &data_dir, json_mode),
    }
}

// ============================================================
// 命令处理器
// ============================================================

/**
 * 获取活跃环境变量列表
 *
 * 如果指定了 env_name，按名称查找并激活该环境；
 * 否则使用数据文件中记录的活跃环境。
 */
fn get_active_variables(
    data_dir: &std::path::Path,
    env_name: Option<&str>,
) -> Vec<EnvironmentVariable> {
    let env_data = load_environments_data(data_dir);

    // 按名称查找
    if let Some(name) = env_name {
        if let Some(env) = env_data.environments.iter().find(|e| e.name == name) {
            return env.variables.iter().filter(|v| v.enabled).cloned().collect();
        }
        // 环境名称未找到也返回空（不报错，安静替换）
        return vec![];
    }

    // 使用活跃环境
    if let Some(active_id) = &env_data.active_id {
        if let Some(env) = env_data.environments.iter().find(|e| &e.id == active_id) {
            return env.variables.iter().filter(|v| v.enabled).cloned().collect();
        }
    }

    vec![]
}

// -------- request 命令 --------

/** 处理 request 子命令：发送 HTTP 请求并打印响应 */
fn handle_request(
    args: &RequestArgs,
    data_dir: &std::path::Path,
    json_mode: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    // 1. 获取活跃环境变量
    let variables = get_active_variables(data_dir, args.env.as_deref());

    // 2. 解析请求头
    let mut headers: Vec<HeaderInput> = Vec::new();
    for h in &args.header {
        if let Some(pos) = h.find(':') {
            let key = h[..pos].trim().to_string();
            let value = h[pos + 1..].trim().to_string();
            headers.push(HeaderInput { key, value, enabled: true });
        } else {
            eprintln!("警告: 忽略无效的请求头格式 '{}'（应为 Key: Value）", h);
        }
    }

    // 3. 注入 Bearer Token（如果指定）
    if let Some(token) = &args.auth_bearer {
        headers.push(HeaderInput {
            key: "Authorization".to_string(),
            value: format!("Bearer {}", token),
            enabled: true,
        });
    }

    // 4. 构建 RequestInput
    let method = args.method.to_uppercase();
    let input = RequestInput {
        method: method.clone(),
        url: args.url.clone(),
        headers,
        body: args.body.clone(),
        content_type: args.content_type.clone(),
    };

    // 5. 执行变量替换后发送请求
    let url = substitute_variables(&args.url, &variables);
    let substituted_headers: Vec<HeaderInput> = input
        .headers
        .iter()
        .map(|h| HeaderInput {
            key: substitute_variables(&h.key, &variables),
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

    let exec_input = RequestInput {
        method,
        url: url.clone(),
        headers: substituted_headers,
        body,
        content_type,
    };

    // 6. 创建 tokio 运行时并发起 HTTP 请求
    let rt = tokio::runtime::Runtime::new()?;
    let result = rt.block_on(execute_http_request(exec_input))?;

    // 7. 打印输出
    if json_mode {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        print_response(&result);
    }

    Ok(())
}

// -------- test 命令 --------

/** 处理 test 子命令：运行 YAML 测试脚本 */
fn handle_test(
    args: &TestArgs,
    data_dir: &std::path::Path,
    json_mode: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    // 1. 读取 YAML 文件
    let content = std::fs::read_to_string(&args.path)
        .map_err(|e| format!("无法读取测试脚本文件 '{}': {}", args.path, e))?;

    // 2. 获取活跃环境变量
    let variables = get_active_variables(data_dir, args.env.as_deref());

    // 3. 创建 tokio 运行时执行测试
    let rt = tokio::runtime::Runtime::new()?;
    let result = rt.block_on(test_runner::run_test_script_internal(&content, &variables));

    // 4. 打印输出
    if json_mode {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        print_test_result(&result);
    }

    Ok(())
}

// -------- collections 命令 --------

/** 处理 collections 子命令：列出所有集合 */
fn handle_list_collections(
    data_dir: &std::path::Path,
    json_mode: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let collections = load_collections_data(data_dir);

    if json_mode {
        println!("{}", serde_json::to_string_pretty(&collections)?);
    } else {
        print_collections(&collections);
    }

    Ok(())
}

// -------- env 命令 --------

/** 处理 collections 子命令 */
fn handle_collections_action(
    action: &CollectionAction,
    data_dir: &std::path::Path,
    json_mode: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    match action {
        CollectionAction::List => handle_list_collections(data_dir, json_mode),
    }
}

/** 处理 env 子命令：列出环境或激活环境 */
fn handle_env_action(
    action: &EnvAction,
    data_dir: &std::path::Path,
    json_mode: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    match action {
        EnvAction::List => {
            let env_data = load_environments_data(data_dir);
            if json_mode {
                println!("{}", serde_json::to_string_pretty(&env_data)?);
            } else {
                print_environments(&env_data);
            }
        }
        EnvAction::Use { name } => {
            let mut env_data = load_environments_data(data_dir);
            if let Some(env) = env_data.environments.iter().find(|e| e.name == *name) {
                env_data.active_id = Some(env.id.clone());
                save_environments_data(data_dir, &env_data)?;
                if json_mode {
                    println!("{{\"status\":\"ok\",\"active_environment\":\"{}\"}}", name);
                } else {
                    println!("已激活环境: {}", name);
                }
            } else {
                return Err(format!("未找到名为 '{}' 的环境", name).into());
            }
        }
    }
    Ok(())
}

// -------- export 命令 --------

/** 处理 export 子命令：导出数据到文件 */
fn handle_export(
    args: &ExportArgs,
    data_dir: &std::path::Path,
    json_mode: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    // 1. 解析导出格式
    let export_fmt = ExportFormat::from_str(&args.format)?;

    // 2. 读取集合和环境数据
    let collections = load_collections_data(data_dir);
    let environments = load_environments_data(data_dir);

    // 3. 按集合名称筛选
    let filtered_collections = if args.collection.is_empty() {
        collections
    } else {
        let items = collections
            .get("collections")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter(|item| {
                        item.get("name")
                            .and_then(|n| n.as_str())
                            .map(|name| args.collection.contains(&name.to_string()))
                            .unwrap_or(false)
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        serde_json::json!({ "collections": items })
    };

    // 4. 构建导出信封
    let now_iso = crate::chrono_now_iso();
    let export_data = io::build_export_data(&filtered_collections, &environments, &now_iso);

    // 5. 序列化
    let content = io::serialize_export(&export_data, export_fmt)?;

    // 6. 确定输出路径
    let output_path = match &args.output {
        Some(path) => PathBuf::from(path),
        None => {
            let default_name = format!(
                "pulse-export-{}.{}",
                now_iso.replace(':', "-").split('.').next().unwrap_or("unknown"),
                export_fmt.to_extension()
            );
            PathBuf::from(&default_name)
        }
    };

    // 7. 写入文件
    std::fs::write(&output_path, &content)
        .map_err(|e| format!("无法写入文件 '{}': {}", output_path.display(), e))?;

    if json_mode {
        println!(
            "{{\"status\":\"ok\",\"file\":\"{}\",\"format\":\"{}\",\"collections\":{}}}",
            output_path.display(),
            args.format,
            filtered_collections["collections"].as_array().map(|a| a.len()).unwrap_or(0)
        );
    } else {
        let collection_count = filtered_collections["collections"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0);
        println!("导出成功!");
        println!("  文件: {}", output_path.display());
        println!("  格式: {}", args.format);
        println!("  集合数: {}", collection_count);
        println!("  环境数: {}", environments.environments.len());
    }

    Ok(())
}

// -------- import 命令 --------

/** 处理 import 子命令：从文件导入数据 */
fn handle_import(
    args: &ImportArgs,
    data_dir: &std::path::Path,
    json_mode: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    // 1. 检测格式
    let import_fmt = ExportFormat::from_extension(&args.path)?;

    // 2. 读取文件
    let content = std::fs::read_to_string(&args.path)
        .map_err(|e| format!("无法读取导入文件 '{}': {}", args.path, e))?;

    // 3. 反序列化和验证
    let import_data = io::deserialize_import(&content, import_fmt)?;
    io::validate_import(&import_data)?;

    // 4. 创建数据目录
    std::fs::create_dir_all(data_dir)
        .map_err(|e| format!("无法创建数据目录: {}", e))?;

    // 5. 读取现有数据
    let existing_collections = load_collections_data(data_dir);
    let existing_environments = load_environments_data(data_dir);

    // 6. 按策略合并
    let (final_collections, final_environments) = match args.strategy.as_str() {
        "replace" => (import_data.collections, import_data.environments),
        "merge" => (
            io::merge_collections(&existing_collections, &import_data.collections),
            io::merge_environments(&existing_environments, &import_data.environments),
        ),
        _ => return Err(format!("未知策略 '{}'，请使用 'replace' 或 'merge'", args.strategy).into()),
    };

    // 7. 写入文件
    save_collections_data(data_dir, &final_collections)?;
    save_environments_data(data_dir, &final_environments)?;

    let collections_count = final_collections["collections"]
        .as_array()
        .map(|a| a.len())
        .unwrap_or(0);
    let environments_count = final_environments.environments.len();

    if json_mode {
        println!(
            "{{\"status\":\"ok\",\"strategy\":\"{}\",\"collections\":{},\"environments\":{}}}",
            args.strategy, collections_count, environments_count
        );
    } else {
        println!("导入成功!");
        println!("  策略: {}", args.strategy);
        println!("  集合数: {}", collections_count);
        println!("  环境数: {}", environments_count);
    }

    Ok(())
}

// ============================================================
// 输出格式化辅助函数
// ============================================================

/** 打印 HTTP 响应（human-readable） */
fn print_response(resp: &ResponseData) {
    println!("Status:     {} {}", resp.status, resp.status_text);
    println!("Time:       {:.0}ms", resp.timing.total_ms);
    println!("Size:       {}", resp.size_label);
    if let Some(ref ct) = resp.content_type {
        println!("Type:       {}", ct);
    }
    println!();

    if !resp.body.is_empty() {
        println!("{}", resp.body);
    }
}

/** 打印测试结果（human-readable） */
fn print_test_result(result: &test_runner::TestRunResult) {
    println!("测试脚本: {}             耗时: {}ms",
        result.script_name,
        // 计算两端时间差（毫秒）
        {
            let start = parse_iso_time(&result.started_at);
            let end = parse_iso_time(&result.completed_at);
            if end > start { end - start } else { 0u64 }
        }
    );
    println!();

    for (_, step) in result.steps.iter().enumerate() {
        let icon = if step.passed { "✓" } else { "✗" };
        let status_str = if step.status > 0 {
            format!("{} {}", step.status, step.status_text)
        } else if let Some(ref err) = step.error {
            format!("ERR: {}", err)
        } else {
            "—".to_string()
        };

        println!("  {} {} {}  {}   {:.0}ms",
            icon, step.method, step.url, status_str, step.duration_ms
        );

        for assertion in &step.assertion_results {
            let a_icon = if assertion.passed { "✓" } else { "✗" };
            println!("    {} {}", a_icon, assertion.expression);
            if !assertion.passed {
                if assertion.error.is_some() {
                    println!("      错误: {}", assertion.error.as_ref().unwrap());
                } else {
                    let expected = assertion.expected_value.as_deref().unwrap_or("");
                    let actual = assertion.actual_value.as_deref().unwrap_or("");
                    println!("      期望: {} 实际: {}", expected, actual);
                }
            }
        }
    }

    println!();
    println!("结果: {}/{} 通过",
        result.passed_steps, result.total_steps
    );
}

/** 打印集合列表（human-readable） */
fn print_collections(collections: &serde_json::Value) {
    let items = collections
        .get("collections")
        .and_then(|v| v.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[]);

    if items.is_empty() {
        println!("(无集合)");
        return;
    }

    println!("集合列表:");
    for item in items {
        let name = item.get("name").and_then(|n| n.as_str()).unwrap_or("(未命名)");
        let request_count = item
            .get("requests")
            .and_then(|r| r.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        println!("  {} ({} 个请求)", name, request_count);
    }
}

/** 打印环境列表（human-readable） */
fn print_environments(env_data: &EnvironmentData) {
    if env_data.environments.is_empty() {
        println!("(无环境)");
        return;
    }

    println!("环境列表:");
    for env in &env_data.environments {
        let active_mark = if Some(&env.id) == env_data.active_id.as_ref() {
            " [活跃]"
        } else {
            ""
        };
        println!("  {}{} ({} 个变量)", env.name, active_mark, env.variables.len());
    }
}

/** 解析 ISO 8601 时间字符串为 Unix 毫秒时间戳 */
fn parse_iso_time(iso: &str) -> u64 {
    // 简单解析 "YYYY-MM-DDTHH:MM:SS.000Z" 格式
    if iso.len() < 19 {
        return 0;
    }
    let year = iso[0..4].parse::<i64>().unwrap_or(0);
    let month = iso[5..7].parse::<u64>().unwrap_or(1);
    let day = iso[8..10].parse::<u64>().unwrap_or(1);
    let hour = iso[11..13].parse::<u64>().unwrap_or(0);
    let min = iso[14..16].parse::<u64>().unwrap_or(0);
    let sec = iso[17..19].parse::<u64>().unwrap_or(0);

    // 简化为秒数计算（从 1970 起的天数计算，不考虑闰秒）
    let days_from_1970 = |y: i64, m: u64, d: u64| -> u64 {
        let mut total = 0u64;
        for yr in 1970..y {
            total += if (yr % 4 == 0 && yr % 100 != 0) || (yr % 400 == 0) { 366 } else { 365 };
        }
        let month_days = if (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0) {
            [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        } else {
            [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        };
        for i in 0..(m as usize - 1) {
            total += month_days[i] as u64;
        }
        total += d - 1;
        total
    };

    let days = days_from_1970(year, month, day);
    (days * 86400 + hour * 3600 + min * 60 + sec) * 1000
}
