// ============================================================
// 导入/导出核心模块
// 纯 Rust 函数，不依赖 Tauri 类型——未来 CLI 可直接复用
// ============================================================

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{EnvironmentData};

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

/**
 * 统一导出信封结构
 *
 * version:     格式版本号（当前为 1），未来扩展兼容性
 * exported_at: ISO 8601 时间戳
 * collections: 集合数据（与 save_collections 的 JSON 格式一致）
 * environments: 环境数据（使用强类型 EnvironmentData）
 */
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportData {
    pub version: i32,
    pub exported_at: String,
    pub collections: Value,
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
 * @param collections 从 load_collections 获取的 JSON Value（可为 Null）
 * @param environments 当前环境数据
 * @param exported_at ISO 8601 时间戳字符串
 */
pub fn build_export_data(
    collections: &Value,
    environments: &EnvironmentData,
    exported_at: &str,
) -> ExportData {
    // 如果 collections 为 Null/空，填充空结构
    let coll_data = if collections.is_null() || !collections.is_object() {
        serde_json::json!({ "collections": [] })
    } else {
        collections.clone()
    };

    ExportData {
        version: 1,
        exported_at: exported_at.to_string(),
        collections: coll_data,
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
 * - collections 包含 "collections" 数组
 * - environments 包含 "environments" 数组
 */
pub fn validate_import(data: &ExportData) -> Result<(), String> {
    if data.version != 1 {
        return Err(format!(
            "Unsupported export version: {}. Expected: 1",
            data.version
        ));
    }

    // 验证 collections 结构
    if let Some(arr) = data.collections.get("collections") {
        if !arr.is_array() {
            return Err("Invalid format: 'collections.collections' must be an array".to_string());
        }
    } else {
        return Err("Invalid format: missing 'collections.collections' field".to_string());
    }

    // environments 由强类型 EnvironmentData 保证结构正确
    Ok(())
}

/**
 * 解析导入文件内容，返回预览信息
 */
pub fn preview_from_content(content: &str, format: ExportFormat) -> Result<ImportPreview, String> {
    let data = deserialize_import(content, format)?;
    validate_import(&data)?;

    let collections_count = data.collections["collections"]
        .as_array()
        .map(|a| a.len())
        .unwrap_or(0);

    let environments_count = data.environments.environments.len();

    Ok(ImportPreview {
        collections_count,
        environments_count,
    })
}

/**
 * 合并导入数据与本地数据
 *
 * strategy = "replace": 用导入数据完全替换本地数据
 * strategy = "merge":   按 ID 匹配，已有 ID 覆盖，新 ID 追加
 */
pub fn merge_collections(existing: &Value, imported: &Value) -> Value {
    let existing_arr = existing
        .get("collections")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let imported_arr = imported
        .get("collections")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    // 用 HashMap 按 ID 索引现有集合
    let mut merged: std::collections::HashMap<String, Value> = existing_arr
        .into_iter()
        .filter_map(|c| {
            let id = c.get("id")
                .and_then(|id| id.as_str())
                .map(|id| (id.to_string(), c.clone()));
            id
        })
        .collect();

    // 合并导入集合：已有 ID 覆盖，新 ID 追加
    for col in imported_arr {
        if let Some(id) = col.get("id").and_then(|id| id.as_str()) {
            merged.insert(id.to_string(), col);
        }
    }

    let mut result: Vec<Value> = merged.into_values().collect();
    // 保持导入顺序：先排导入的集合，再追加仅本地有的
    let imported_ids: std::collections::HashSet<String> = imported
        .get("collections")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| c.get("id").and_then(|id| id.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();

    result.sort_by_key(|c| {
        let id = c.get("id").and_then(|id| id.as_str()).unwrap_or("");
        if imported_ids.contains(id) {
            imported_ids.iter().position(|i| i == id).unwrap_or(usize::MAX)
        } else {
            imported_ids.len() // 只有本地的排在最后
        }
    });

    serde_json::json!({ "collections": result })
}

/**
 * 合并环境数据
 */
pub fn merge_environments(existing: &EnvironmentData, imported: &EnvironmentData) -> EnvironmentData {
    // 按 ID 索引现有环境
    let mut merged: std::collections::HashMap<String, crate::Environment> = existing
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
