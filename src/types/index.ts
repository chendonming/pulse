// ============================================================
// Pulse 应用数据类型定义
// 与 src-tauri/src/lib.rs 中的 Rust 结构体一一对应
// 修改时必须同步更新两边
// ============================================================

/** HTTP 键值对（请求头/查询参数共用），支持启用/禁用 */
export interface HeaderInput {
  key: string;
  value: string;
  enabled: boolean;
}

/** multipart/form-data 条目：文本值或文件 */
export interface FormDataEntry {
  /** 字段名 */
  key: string;
  /** 文本值（当 isFile=false 时使用） */
  value: string;
  /** 是否启用 */
  enabled: boolean;
  /** true=文件上传，false=文本值 */
  isFile: boolean;
  /** 已选择的文件路径（isFile=true 时有效） */
  filePath: string | null;
  /** 显示用的文件名（isFile=true 时有效） */
  fileName: string | null;
  /** 覆盖的 MIME 类型（isFile=true，可选，为空时由 Rust 自动推断） */
  fileContentType: string;
}

/** 响应提取规则：从响应 JSON 中提取值并赋给变量 */
export interface ExtractRule {
  /** 变量名（后续通过 {{name}} 引用） */
  name: string;
  /** JSON Path 来源，如 "body.data" 或 "body.data.token" */
  source: string;
}

/** 请求各阶段耗时（毫秒），由 Rust 后端估算 */
export interface TimingInfo {
  dns_lookup_ms: number;    // DNS 解析耗时
  tcp_connect_ms: number;   // TCP 连接耗时
  tls_handshake_ms: number; // TLS 握手耗时
  ttfb_ms: number;          // 首字节到达耗时（Time To First Byte）
  download_ms: number;      // 内容下载耗时
  total_ms: number;         // 总耗时
}

/** HTTP 响应数据 */
export interface ResponseData {
  status: number;                        // HTTP 状态码
  status_text: string;                   // 状态文本（如 "OK"）
  headers: Record<string, string>;       // 响应头键值对
  body: string;                          // 响应体文本
  content_type: string | null;           // Content-Type
  size: number;                          // 响应体字节数
  size_label: string;                    // 人类可读大小（如 "12.3 KB"）
  timing: TimingInfo;                    // 各阶段耗时
}

/** 请求集合：一组相关请求的容器 */
export interface Collection {
  id: string;
  name: string;
  /** 集合描述（可选） */
  description?: string;
  requests: RequestItem[];
  /** 集合级默认认证方式（子请求可继承） */
  authType: AuthType;
  bearerToken: string;
  /** Base URL：编辑集合中的请求时，相对路径会自动拼接此前缀 */
  base_url: string;
  /** 集合级默认变量，用于 {{key}} 模板替换 */
  variables?: Record<string, string>;
}

/** 集合中的单个请求定义 */
export interface RequestItem {
  id: string;
  name: string;         // 显示名称
  method: string;       // HTTP 方法（GET/POST 等）
  url: string;           // 请求 URL
  headers: HeaderInput[];
  body: string;
  contentType: string;
  /** 请求级认证方式（可继承自集合） */
  authType: AuthType;
  bearerToken: string;
  /** URL 查询参数列表 */
  params: HeaderInput[];
  /** 请求体键值对（用于 application/x-www-form-urlencoded），可选向后兼容 */
  bodyParams?: HeaderInput[];
  /** multipart/form-data 条目列表，可选向后兼容 */
  bodyFormData?: FormDataEntry[];
  /** 断言表达式列表，例如 "status == 200" 或 "body.success == true" */
  assertions?: string[];
  /** 设为 true 可临时跳过此请求 */
  skip?: boolean;
  /** 响应提取规则：从响应中提取 JSON 值并赋给变量 */
  extract?: ExtractRule[];
}

/** 历史记录摘要（侧边栏列表用，不含完整请求详情） */
export interface HistoryItem {
  id: string;
  method: string;
  url: string;
  status: number | null;  // 响应状态码（尚未发送时为 null）
  timestamp: number;      // Unix 毫秒时间戳
}

/** 支持的 HTTP 方法枚举 */
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/** 认证方式：无 / 继承集合 / Bearer Token */
export type AuthType = "none" | "bearer" | "inherit";

/** 认证配置（类型 + Token） */
export interface AuthConfig {
  type: AuthType;
  bearerToken: string;
}

/** 日志条目——记录一次完整的 HTTP 请求/响应生命周期 */
export interface LogEntry {
  id: number;                              // 自增 ID
  timestamp: number;                        // Unix 毫秒时间戳
  method: string;
  url: string;
  status: number;
  status_text: string;
  size_label: string;                       // 响应大小
  total_ms: number;                         // 总耗时
  content_type: string | null;              // 响应 Content-Type
  error: string | null;                     // 错误信息
  request_headers: HeaderInput[];           // 发出的请求头
  request_body: string | null;              // 发出的请求体
  response_headers: Record<string, string>; // 收到的响应头
}

/** 请求面板的 Tab 类型 */
export type RequestTab = "params" | "auth" | "headers" | "body" | "tests";
/** 侧边栏的 Tab 类型 */
export type SidebarTab = "collections" | "history" | "environments";

/** 环境变量键值对 */
export interface EnvironmentVariable {
  key: string;
  value: string;
  enabled: boolean;
}

/** 环境：一组可复用变量的集合，用于 {{key}} 模板替换 */
export interface Environment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
}

/** 环境数据：全部环境列表 + 当前激活的环境 ID */
export interface EnvironmentData {
  environments: Environment[];
  active_id: string | null;
}

/** 集合数据：全部集合列表 */
export interface CollectionData {
  collections: Collection[];
}

/** 快捷键绑定持久化数据 */
export interface KeybindingData {
  version: number;
  bindings: Record<string, string[]>;
}

// ============================================================
// 导入/导出相关类型定义
// ============================================================

/** 导入/导出信封数据 */
export interface ExportData {
  version: number;
  exported_at: string;
  collections: CollectionData;
  environments: EnvironmentData;
}

/** 导入合并策略 */
export type ImportExportStrategy = "replace" | "merge";

/** 导入文件预览信息 */
export interface ImportPreview {
  collections_count: number;
  environments_count: number;
}

/** 导入操作结果统计 */
export interface ImportResult {
  collections_count: number;
  environments_count: number;
  active_id_changed: boolean;
}

// ============================================================
// Test Script 相关类型定义
// ============================================================

/** 单条断言的验证结果 */
export interface AssertionResult {
  expression: string;
  passed: boolean;
  actual_value: string | null;
  expected_value: string | null;
  error: string | null;
}

/** 单个请求的执行结果 */
export interface TestStepResult {
  name: string;
  passed: boolean;
  status: number;
  status_text: string;
  duration_ms: number;
  size_label: string;
  url: string;
  method: string;
  assertion_results: AssertionResult[];
  error: string | null;
}

/** 一次测试运行的完整结果 */
export interface TestRunResult {
  script_name: string;
  started_at: string;
  completed_at: string;
  total_steps: number;
  passed_steps: number;
  failed_steps: number;
  steps: TestStepResult[];
  error: string | null;
}

// ============================================================
// 多标签页系统类型定义
// ============================================================

/** 标签页中请求参数的快照，用于脏状态比较 */
export interface TabSnapshot {
  method: string;
  url: string;
  headers: HeaderInput[];
  body: string;
  bodyParams: HeaderInput[];
  bodyFormData: FormDataEntry[];
  contentType: string;
  authType: string;
  bearerToken: string;
  rawParams: HeaderInput[];
  assertions: string[];
  extract: ExtractRule[];
}

/** 单个标签页的完整状态 */
export interface TabState {
  id: string;
  /** 自动生成的标题："New Request" 或 URL 最后一段路径 */
  title: string;
  /** 创建时间戳（用于排序） */
  createdAt: number;
  // ── 请求参数 ──
  method: HttpMethod;
  url: string;
  headers: HeaderInput[];
  body: string;
  bodyParams: HeaderInput[];
  bodyFormData: FormDataEntry[];
  contentType: string;
  authType: AuthType;
  bearerToken: string;
  rawParams: HeaderInput[];
  requestTab: RequestTab;
  // ── 响应状态 ──
  response: ResponseData | null;
  isLoading: boolean;
  error: string | null;
  responseTab: "body" | "headers";
  // ── 编辑跟踪 ──
  editingRequest: { collectionId: string; requestId: string } | null;
  savedSnapshot: TabSnapshot | null;
  /** 断言表达式列表，例如 "status == 200" */
  assertions: string[];
  /** 响应提取规则列表 */
  extract: ExtractRule[];
}

// ============================================================
// 应用设置相关类型定义
// ============================================================

/** 应用设置 */
export interface AppSettings {
  /** UI 缩放比例 */
  zoomLevel: number;
  /** 字体标识：inter | system-ui | jetbrains-mono */
  fontFamily: string;
  /** 字号标识：small | medium | large */
  fontSize: string;
  /** 主题：暗色 / 浅色 */
  theme: "dark" | "light";
  /** 侧边栏宽度百分比（10-35） */
  sidebarWidth?: number;
  /** 请求面板高度百分比（10-60） */
  requestPanelHeight?: number;
}

/** 默认应用设置 */
export const DEFAULT_SETTINGS: AppSettings = {
  zoomLevel: 1.0,
  fontFamily: "inter",
  fontSize: "medium",
  theme: "dark",
  sidebarWidth: 18,
  requestPanelHeight: 35,
};
