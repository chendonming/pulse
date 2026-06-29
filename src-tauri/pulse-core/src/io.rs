// ============================================================
// 导入/导出核心模块
// 纯 Rust 函数，不依赖 Tauri 类型
// ============================================================

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{Collection, CollectionData, EnvironmentData};

/** 导出格式枚举 */
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ExportFormat {
    Json,
    Yaml,
}

impl ExportFormat {
    /** 根据文件扩展名检测格式 */
    pub fn from_extension(path: &str) -> Result<Self, String> {
        let ext = path
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_lowercase();
        match ext.as_str() {
            "json" => Ok(ExportFormat::Json),
            "yaml" | "yml" => Ok(ExportFormat::Yaml),
            other => Err(format!(
                "Unsupported file format: '.{}'. Expected '.json', '.yaml', or '.yml'",
                other
            )),
        }
    }

    /** 获取默认的文件扩展名（含点号） */
    pub fn to_extension(&self) -> &'static str {
        match self {
            ExportFormat::Json => "json",
            ExportFormat::Yaml => "yaml",
        }
    }

    /** 获取文件对话框过滤器标签 */
    pub fn file_filter_label(&self) -> &'static str {
        match self {
            ExportFormat::Json => "JSON",
            ExportFormat::Yaml => "YAML",
        }
    }

    /** 从字符串 "json" / "yaml" 解析 */
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "json" => Ok(ExportFormat::Json),
            "yaml" | "yml" => Ok(ExportFormat::Yaml),
            _ => Err(format!("Unsupported format: '{}'. Expected 'json' or 'yaml'", s)),
        }
    }
}

// ============================================================
// 统一的 Collection YAML 格式（可用于导入、导出、测试）
// ============================================================

/**
 * 统一的集合文档格式（用于文件导入导出和测试）
 *
 * 此格式同时兼容 TestScript 的 {{variable}} 替换方式和
 * Collection 的 base_url + 相对路径机制。
 * 导入时自动检测并转换。
 */
#[derive(Debug, Serialize, Deserialize)]
pub struct CollectionDocument {
    /** 集合名称 */
    pub name: String,
    /** 可选描述 */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /** 集合级 Base URL（请求可使用相对路径） */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /** 集合级默认变量（用于 {{key}} 模板替换） */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variables: Option<HashMap<String, String>>,
    /** 集合级默认认证配置 */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthConfig>,
    /** 请求列表 */
    #[serde(default)]
    pub requests: Vec<CollectionDocumentItem>,
}

/** 统一格式中的单个请求定义 */
#[derive(Debug, Serialize, Deserialize)]
pub struct CollectionDocumentItem {
    /** 请求名称 */
    pub name: String,
    /** HTTP 方法 */
    pub method: String,
    /** URL（支持 {{variable}} 插值，相对路径使用 base_url） */
    pub url: String,
    /** 请求头键值对 */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    /** 请求体 */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /** Content-Type */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /** 请求级认证配置（可选，默认继承集合级） */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthConfig>,
    /** URL 查询参数（可选，导入时自动转换为 HeaderInput 格式） */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Vec<crate::HeaderInput>>,
    /** 请求体键值对（用于 application/x-www-form-urlencoded） */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_params: Option<Vec<crate::HeaderInput>>,
    /** 断言表达式列表，例如 "status == 200" 或 "body.success == true" */
    #[serde(default)]
    pub assertions: Vec<String>,
    /** 设为 true 可临时跳过此请求 */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip: Option<bool>,
    /** 响应提取规则列表：从响应中提取值存入变量 */
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extract: Vec<crate::ExtractRule>,
}

/** 认证配置 */
#[derive(Debug, Serialize, Deserialize)]
pub struct AuthConfig {
    /** 认证方式：none / bearer / inherit */
    #[serde(rename = "type")]
    pub auth_type: String,
    /** Bearer Token（当 type=inherit 时忽略） */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bearer_token: Option<String>,
}

// ============================================================
// 格式转换：CollectionDocument ↔ Collection
// ============================================================

/**
 * 将 CollectionDocument 转换为 Collection（导入时使用）
 *
 * 生成 UUID、转换 headers 格式、展开 params。
 */
pub fn collection_document_to_collection(doc: CollectionDocument) -> Collection {
    use uuid::Uuid;

    let auth_type = doc.auth.as_ref().map(|a| a.auth_type.clone()).unwrap_or_else(|| "none".to_string());
    let bearer_token = doc.auth.as_ref()
        .and_then(|a| a.bearer_token.clone())
        .unwrap_or_default();

    let requests = doc.requests.into_iter().map(|req| {
        let req_auth_type = req.auth.as_ref().map(|a| a.auth_type.clone()).unwrap_or_else(|| "inherit".to_string());
        let req_bearer_token = req.auth.as_ref()
            .and_then(|a| a.bearer_token.clone())
            .unwrap_or_default();

        crate::CollectionItem {
            id: Uuid::new_v4().to_string(),
            name: req.name,
            method: req.method,
            url: req.url,
            headers: req.headers
                .unwrap_or_default()
                .into_iter()
                .map(|(k, v)| crate::HeaderInput {
                    key: k,
                    value: v,
                    enabled: true,
                })
                .collect(),
            body: req.body,
            content_type: req.content_type,
            auth_type: req_auth_type,
            bearer_token: req_bearer_token,
            params: req.params.unwrap_or_default(),
            body_params: req.body_params,
            assertions: req.assertions,
            skip: req.skip,
            extract: req.extract,
        }
    }).collect();

    Collection {
        id: Uuid::new_v4().to_string(),
        name: doc.name,
        description: doc.description,
        base_url: doc.base_url.unwrap_or_default(),
        auth_type,
        bearer_token,
        variables: doc.variables,
        requests,
    }
}

/**
 * 将 Collection 转换为 CollectionDocument（导出时使用）
 *
 * 转换 header 格式、可选展开 params、保留断言和变量。
 */
pub fn collection_to_collection_document(col: &Collection) -> CollectionDocument {
    CollectionDocument {
        name: col.name.clone(),
        description: col.description.clone(),
        base_url: if col.base_url.is_empty() { None } else { Some(col.base_url.clone()) },
        variables: col.variables.clone(),
        auth: Some(AuthConfig {
            auth_type: col.auth_type.clone(),
            bearer_token: if col.bearer_token.is_empty() { None } else { Some(col.bearer_token.clone()) },
        }),
        requests: col.requests.iter().map(|req| {
            CollectionDocumentItem {
                name: req.name.clone(),
                method: req.method.clone(),
                url: req.url.clone(),
                headers: {
                    let h: HashMap<String, String> = req.headers.iter()
                        .filter(|h| h.enabled)
                        .map(|h| (h.key.clone(), h.value.clone()))
                        .collect();
                    if h.is_empty() { None } else { Some(h) }
                },
                body: req.body.clone(),
                content_type: req.content_type.clone(),
                auth: Some(AuthConfig {
                    auth_type: req.auth_type.clone(),
                    bearer_token: if req.bearer_token.is_empty() { None } else { Some(req.bearer_token.clone()) },
                }),
                assertions: req.assertions.clone(),
                params: if req.params.is_empty() { None } else { Some(req.params.clone()) },
                body_params: req.body_params.clone(),
                skip: req.skip,
                extract: req.extract.clone(),
            }
        }).collect(),
    }
}

// ============================================================
// 统一导出信封结构（完整备份格式）
// ============================================================

/**
 * 统一导出信封结构
 *
 * version:     格式版本号（当前为 1），未来扩展兼容性
 * exported_at: ISO 8601 时间戳
 * collections: 集合数据（使用强类型 CollectionData）
 * environments: 环境数据（使用强类型 EnvironmentData）
 */
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportData {
    pub version: i32,
    pub exported_at: String,
    pub collections: CollectionData,
    pub environments: EnvironmentData,
}

/** 导入预览：供对话框显示摘要信息 */
#[derive(Debug, Serialize, Deserialize)]
pub struct ImportPreview {
    pub collections_count: usize,
    pub environments_count: usize,
}

/** 导入结果：导入完成后返回统计 */
#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub collections_count: usize,
    pub environments_count: usize,
    pub active_id_changed: bool,
}

/**
 * 构建导出数据信封
 *
 * @param collections 从 load_collections 获取的 CollectionData
 * @param environments 当前环境数据
 * @param exported_at ISO 8601 时间戳字符串
 */
pub fn build_export_data(
    collections: &CollectionData,
    environments: &EnvironmentData,
    exported_at: &str,
) -> ExportData {
    ExportData {
        version: 1,
        exported_at: exported_at.to_string(),
        collections: collections.clone(),
        environments: environments.clone(),
    }
}

/**
 * 将 ExportData 序列化为字符串
 */
pub fn serialize_export(data: &ExportData, format: ExportFormat) -> Result<String, String> {
    match format {
        ExportFormat::Json => {
            serde_json::to_string_pretty(data)
                .map_err(|e| format!("JSON serialization failed: {}", e))
        }
        ExportFormat::Yaml => {
            serde_yaml::to_string(data)
                .map_err(|e| format!("YAML serialization failed: {}", e))
        }
    }
}

/**
 * 从字符串反序列化为 ExportData
 * 自动处理格式差异（JSON 和 YAML 使用不同的解析器）
 */
pub fn deserialize_import(content: &str, format: ExportFormat) -> Result<ExportData, String> {
    match format {
        ExportFormat::Json => {
            serde_json::from_str(content)
                .map_err(|e| format!("JSON parsing failed: {}", e))
        }
        ExportFormat::Yaml => {
            serde_yaml::from_str(content)
                .map_err(|e| format!("YAML parsing failed: {}", e))
        }
    }
}

/**
 * 验证导入数据的完整性
 *
 * 检查项：
 * - version 字段存在且为 1
 * - collections 包含集合列表
 * - environments 存在
 */
pub fn validate_import(data: &ExportData) -> Result<(), String> {
    if data.version != 1 {
        return Err(format!(
            "Unsupported export version: {}. Expected: 1",
            data.version
        ));
    }

    // collections 和 environments 由强类型保证结构正确
    Ok(())
}

/**
 * 解析导入文件内容，返回预览信息
 */
pub fn preview_from_content(content: &str, format: ExportFormat) -> Result<ImportPreview, String> {
    let data = deserialize_import(content, format)?;
    validate_import(&data)?;

    let collections_count = data.collections.collections.len();
    let environments_count = data.environments.environments.len();

    Ok(ImportPreview {
        collections_count,
        environments_count,
    })
}

/**
 * 合并集合数据
 *
 * strategy = "replace": 用导入数据完全替换本地数据
 * strategy = "merge":   按 ID 匹配，已有 ID 覆盖，新 ID 追加
 */
pub fn merge_collections(existing: &CollectionData, imported: &CollectionData) -> CollectionData {
    // 用 HashMap 按 ID 索引现有集合
    let mut merged: HashMap<String, Collection> = existing.collections
        .iter()
        .map(|c| (c.id.clone(), c.clone()))
        .collect();

    // 合并导入集合：已有 ID 覆盖，新 ID 追加
    for col in &imported.collections {
        merged.insert(col.id.clone(), col.clone());
    }

    let mut result: Vec<Collection> = merged.into_values().collect();
    // 保持导入顺序：先排导入的集合，再追加仅本地有的
    let imported_ids: std::collections::HashSet<String> = imported.collections
        .iter()
        .map(|c| c.id.clone())
        .collect();

    result.sort_by_key(|c| {
        if imported_ids.contains(&c.id) {
            imported.collections.iter().position(|ic| ic.id == c.id).unwrap_or(usize::MAX)
        } else {
            imported.collections.len() // 只有本地的排在最后
        }
    });

    CollectionData { collections: result }
}

/**
 * 合并环境数据
 */
pub fn merge_environments(existing: &EnvironmentData, imported: &EnvironmentData) -> EnvironmentData {
    // 按 ID 索引现有环境
    let mut merged: HashMap<String, crate::Environment> = existing
        .environments
        .iter()
        .map(|e| (e.id.clone(), e.clone()))
        .collect();

    // 合并导入环境
    for env in &imported.environments {
        merged.insert(env.id.clone(), env.clone());
    }

    let environments: Vec<crate::Environment> = merged.into_values().collect();

    // 如果导入数据有激活的环境 ID 且非空，优先使用；否则保留现有
    let active_id = imported.active_id.clone().or_else(|| existing.active_id.clone());

    EnvironmentData {
        environments,
        active_id,
    }
}

// ============================================================
// CollectionDocument 格式的导入/导出
// ============================================================

/**
 * 将 CollectionDocument 序列化为字符串
 */
pub fn serialize_collection_document(doc: &CollectionDocument, format: ExportFormat) -> Result<String, String> {
    match format {
        ExportFormat::Json => {
            serde_json::to_string_pretty(doc)
                .map_err(|e| format!("JSON serialization failed: {}", e))
        }
        ExportFormat::Yaml => {
            serde_yaml::to_string(doc)
                .map_err(|e| format!("YAML serialization failed: {}", e))
        }
    }
}

/**
 * 从字符串反序列化为 CollectionDocument
 */
pub fn deserialize_collection_document(content: &str, format: ExportFormat) -> Result<CollectionDocument, String> {
    match format {
        ExportFormat::Json => {
            serde_json::from_str(content)
                .map_err(|e| format!("JSON parsing failed: {}", e))
        }
        ExportFormat::Yaml => {
            serde_yaml::from_str(content)
                .map_err(|e| format!("YAML parsing failed: {}", e))
        }
    }
}

/**
 * 自动检测导入文件格式并解析
 *
 * 尝试顺序：
 * 1. 先尝试解析为 ExportData（标准备份格式）
 * 2. 如果失败，尝试解析为 CollectionDocument（单个集合格式）
 */
pub fn detect_and_parse_import(content: &str, format: ExportFormat) -> Result<ImportResult, String> {
    // 尝试作为 ExportData 解析
    if let Ok(export) = deserialize_import(content, format) {
        return Ok(ImportResult {
            collections_count: export.collections.collections.len(),
            environments_count: export.environments.environments.len(),
            active_id_changed: export.environments.active_id.is_some(),
        });
    }

    // 尝试作为 CollectionDocument 解析
    if let Ok(_doc) = deserialize_collection_document(content, format) {
        return Ok(ImportResult {
            collections_count: 1, // 单个集合
            environments_count: 0,
            active_id_changed: false,
        });
    }

    Err("无法识别的文件格式：不是有效的 Pulse 导出文件或 Collection 文件".to_string())
}

/**
 * 将 Collection 导出为单个 CollectionDocument 字符串
 */
pub fn export_collection_as_document(col: &Collection, format: ExportFormat) -> Result<String, String> {
    let doc = collection_to_collection_document(col);
    serialize_collection_document(&doc, format)
}

// ============================================================
// CollectionDocument ↔ TestScript 转换
// ============================================================

use crate::test_runner::{TestRequest, TestScript as TestScriptType};

/**
 * 将 CollectionDocument 转换为 TestScript（用于兼容旧版测试运行器）
 *
 * 确保旧版 run_test_script_internal 也能执行新格式的 YAML。
 */
pub fn collection_document_to_test_script(doc: &CollectionDocument) -> TestScriptType {
    TestScriptType {
        name: doc.name.clone(),
        description: doc.description.clone(),
        variables: doc.variables.clone(),
        requests: doc.requests.iter().map(|req| {
            let headers = req.headers.as_ref().map(|h| {
                h.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
            });
            TestRequest {
                name: req.name.clone(),
                method: req.method.clone(),
                url: req.url.clone(),
                headers,
                body: req.body.clone(),
                content_type: req.content_type.clone(),
                assertions: req.assertions.clone(),
                skip: req.skip,
                extract: req.extract.clone(),
            }
        }).collect(),
    }
}

/**
 * 尝试将 YAML 内容解析为 CollectionDocument，失败则回退到 TestScript
 */
pub fn parse_yaml_as_test_script(content: &str) -> Result<TestScriptType, String> {
    // 先尝试 CollectionDocument（新统一格式）
    if let Ok(doc) = serde_yaml::from_str::<CollectionDocument>(content) {
        return Ok(collection_document_to_test_script(&doc));
    }
    // 再尝试 TestScript（旧格式）
    serde_yaml::from_str::<TestScriptType>(content)
        .map_err(|e| format!("YAML 解析失败（已尝试两种格式）: {}", e))
}
