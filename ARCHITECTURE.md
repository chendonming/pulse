# Pulse 技术架构文档

> Pulse 是一款跨平台桌面 HTTP 客户端工具（类似 Postman），用于 API 测试和调试。
> 本文档从技术角度描述项目的整体架构、技术选型、数据流和设计决策。
>
> **注意**：项目实际产品名称为 Pulse，但代码仓库、安装包等仍沿用 `mypostman`。

---

## 目录

1. [技术栈概览](#1-技术栈概览)
2. [项目结构](#2-项目结构)
3. [数据流架构](#3-数据流架构)
4. [双窗口架构](#4-双窗口架构)
5. [前端架构](#5-前端架构)
6. [多标签页架构](#6-多标签页架构)
7. [快捷键系统](#7-快捷键系统)
8. [对话框系统](#8-对话框系统)
9. [Toast 通知系统](#9-toast-通知系统)
10. [Rust 后端架构](#10-rust-后端架构)
11. [持久化方案](#11-持久化方案)
12. [状态管理设计](#12-状态管理设计)
13. [认证继承体系](#13-认证继承体系)
14. [环境变量与 Collection 变量系统](#14-环境变量与-collection-变量系统)
15. [日志系统](#15-日志系统)
16. [拖拽排序实现](#16-拖拽排序实现)
17. [导入/导出系统](#17-导入导出系统)
18. [测试脚本系统](#18-测试脚本系统)
19. [Mock 服务器](#19-mock-服务器)
20. [设计系统与主题](#20-设计系统与主题)
21. [可拖拽布局](#21-可拖拽布局)
22. [JSON 语法高亮](#22-json-语法高亮)
23. [构建与部署](#23-构建与部署)
24. [已知限制与注意事项](#24-已知限制与注意事项)

---

## 1. 技术栈概览

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **桌面壳** | Tauri | v2 | 跨平台桌面应用（WebView2 渲染 + Rust 后端） |
| **前端框架** | React | 18.3 | UI 组件库 |
| **前端语言** | TypeScript | 5.6 | 类型安全的前端代码 |
| **构建工具** | Vite | 6 | 快速开发服务器和生产构建 |
| **样式** | Tailwind CSS | 3.4 | 原子化 CSS + CSS 变量双主题系统 |
| **后端语言** | Rust | 2021 edition | Tauri 命令和 HTTP 请求执行 |
| **HTTP 客户端** | reqwest | 0.12 | Rust 侧发送 HTTP 请求（含 multipart 支持） |
| **序列化** | serde / serde_json | 1.x | Rust <-> JS 的数据序列化 |
| **拖拽** | @dnd-kit | 6.x / 10.x | 集合和请求的拖拽排序 |
| **拖拽布局** | @bokuweb/react-resizable-layout | 1.x | 三栏面板自由拖拽调整大小 |
| **虚拟列表** | @tanstack/react-virtual | 3.x | 日志列表虚拟滚动 |
| **IPC** | @tauri-apps/api | 2.x | 前端调用 Rust 命令 |
| **快捷键** | 自实现 | — | 自定义快捷键引擎（支持单键/和弦/作用域） |

---

## 2. 项目结构

```
mypostman/
├── index.html                     # HTML 入口（加载 Google 字体）
├── vite.config.ts                 # Vite 构建配置
├── tailwind.config.ts             # Tailwind 主题配置（pulse 调色板 + CSS 变量）
├── tsconfig.json                  # TypeScript 配置
├── postcss.config.js              # PostCSS 配置
├── package.json                   # 前端依赖和脚本
│
├── src/                           # 前端 React 源码
│   ├── main.tsx                   # 应用入口（窗口路由）
│   ├── App.tsx                    # 根组件（布局编排 + 快捷键注册）
│   ├── LogViewer.tsx              # 日志窗口独立组件
│   ├── index.css                  # 全局样式 + CSS 变量（双主题）+ 组件类
│   │
│   ├── types/
│   │   └── index.ts               # TypeScript 类型定义（与 Rust 结构体镜像）
│   │
│   ├── hooks/
│   │   └── usePulse.ts            # 单一状态管理 Hook（所有 app 状态 + 多标签页）
│   │
│   ├── shortcuts/                 # 快捷键系统
│   │   ├── ShortcutEngine.ts      # 快捷键引擎核心
│   │   ├── types.ts               # 快捷键类型定义
│   │   ├── defaults.ts            # 默认快捷键绑定
│   │   └── useActiveScope.ts      # 作用域管理 Hook
│   │
│   └── components/
│       ├── Sidebar.tsx            # 侧边栏（集合/历史/环境 Tab + DnD）
│       ├── TabBar.tsx             # 多标签页栏
│       ├── RequestPanel.tsx       # 请求面板（URL + 方法 + 参数/头/体）
│       ├── ResponsePanel.tsx      # 响应面板（状态 + 瀑布图 + 内容高亮）
│       ├── AuthPanel.tsx          # 认证配置面板
│       ├── EnvironmentPanel.tsx   # 环境变量编辑器
│       ├── CollectionVariablesPanel.tsx  # 集合级变量编辑器
│       ├── WaterfallChart.tsx     # 请求耗时瀑布图（支持折叠/展开）
│       ├── JsonHighlighter.tsx    # JSON 语法高亮组件
│       ├── JsonViewer.tsx         # JSON 结构查看器
│       ├── Toast.tsx              # Toast 通知组件
│       ├── PromptDialog.tsx       # 输入对话框（替换 window.prompt）
│       ├── ConfirmDialog.tsx      # 确认对话框
│       ├── SaveDialog.tsx         # 请求保存/命名对话框
│       ├── SettingsDialog.tsx     # 设置面板（主题/缩放/字体）
│       ├── ImportDialog.tsx       # 数据导入对话框
│       ├── ExportDialog.tsx       # 数据导出对话框
│       └── TestScriptDialog.tsx   # 测试脚本管理对话框
│
└── src-tauri/                     # Rust 工作空间根
    ├── Cargo.toml                 # 工作空间清单（5 个 crate）
    ├── tauri.conf.json            # Tauri 应用配置
    ├── build.rs                   # Tauri 构建脚本
    ├── capabilities/default.json  # Tauri 权限配置
    │
    ├── src/                       # Tauri 应用壳
    │   ├── main.rs                # 程序入口
    │   ├── lib.rs                 # 21 个 Tauri 命令：请求、持久化、导入导出、文件选取等
    │   ├── cli.rs                 # 命令行入口逻辑
    │   ├── io.rs                  # 导入/导出（JSON/YAML 序列化与反序列化）
    │   ├── mock_server.rs         # Mock 服务器管理
    │   └── test_runner.rs         # 测试脚本执行引擎
    │
    ├── pulse-core/                # 核心库（HTTP 请求 + 数据结构）
    │   ├── Cargo.toml
    │   └── src/
    │       └── lib.rs             # 请求发送、变量替换、HTML form 解析
    │
    ├── pulse-cli/                 # CLI 命令行工具
    │   ├── Cargo.toml
    │   └── src/
    │       └── main.rs
    │
    ├── pulse-mcp/                 # MCP 服务器（AI Agent 集成）
    │   ├── Cargo.toml
    │   └── src/
    │       └── main.rs
    │
    └── pulse-mock-server/         # 独立的 Mock 服务器
        ├── Cargo.toml
        └── src/
            └── main.rs
```

---

## 3. 数据流架构

### 核心原则：前端不直接调用 `fetch()`

```
┌─────────────────────────────────────────────────────────────────┐
│  React UI                    Rust Backend (Tauri)                │
│                                                                  │
│  App.tsx                                                         │
│    │                                                             │
│    ├─ invoke("send_request") ──────►  lib.rs: send_request()     │
│    │                                    │                       │
│    │                                    ├─ pulse-core::send() ──► Target API
│    │                                    │                       │
│    │◄─────── ResponseData ─────────────┘                       │
│    │                                                             │
│    ├─ listeners (http-log event) ◄─── lib.rs: app.emit()        │
│    │                          (LogViewer 实时接收)               │
│    │                                                             │
│    ├─ invoke("get_logs") ──────────► lib.rs: get_logs()         │
│    ├─ invoke("save_collections") ──► lib.rs: save_collections()  │
│    ├─ invoke("load_environments")─► lib.rs: load_environments()  │
│    ├─ invoke("save_settings") ─────► lib.rs: save_settings()     │
│    ├─ invoke("load_keybindings") ──► lib.rs: load_keybindings()  │
│    └─ invoke("run_test_script") ───► lib.rs: run_test_script()   │
└─────────────────────────────────────────────────────────────────┘
```

### 请求生命周期

```
① 用户点击 Send 按钮 / 按 Ctrl+Enter
   │
② usePulse.sendRequest() 触发
   │
③ 认证继承链解析（inherit → 查集合 → 注入 Authorization 头）
   │
④ 获取当前环境激活的变量 + Collection 变量（环境优先覆盖）
   │
⑤ invoke<ResponseData>("send_request", { input, variables })
   │
⑥ Rust send_request 执行：
   ├─ 6a. {{variable}} 替换（URL/Headers/Body/Content-Type）
   ├─ 6b. 构建 reqwest 客户端（60s 超时，支持 multipart）
   ├─ 6c. 发送并测量耗时
   ├─ 6d. 估算各阶段时间（DNS/TCP/TLS/TTFB/Download）
   ├─ 6e. 构建 LogEntry → 存储 + 发送 http-log 事件
   └─ 6f. 若请求包含 assertions，逐条验证并生成 TestResult
   │
⑦ 前端收到 ResponseData → 更新当前标签页的 response 状态 → 渲染响应面板
   │
⑧ 若请求包含 extract 规则，从响应中提取 JSON 值 → 存入新标签页的环境变量
   │
⑨ 历史记录更新（最多 50 条）
```

### 持久化文件流

```
usePulse 状态变化
   │
   ├─ collections 变化 ─────► invoke("save_collections") ──► collections.json
   ├─ environments 变化 ────► invoke("save_environments") ──► environments.json
   ├─ settings 变化 ────────► invoke("save_settings") ─────► settings.json
   │                          （300ms 防抖合并）
   └─ keybindings 变化 ─────► invoke("save_keybindings") ──► keybindings.json
```

---

## 4. 双窗口架构

Pulse 使用 Tauri 的双窗口设计：

### 主窗口（main）

- **尺寸**: 1400×900（最小 900×600）
- **内容**: App 组件（Sidebar + TabBar + RequestPanel + ResponsePanel）
- **标题**: "Pulse"

### 日志窗口（logs）

- **尺寸**: 900×550
- **内容**: LogViewer 组件（独立的 HTTP 日志查看器）
- **标题**: "Pulse - Logs"
- **启动方式**：按需触发（快捷键或菜单打开），不再随主进程自动启动

### 窗口路由机制

`src/main.tsx` 中通过 `getCurrentWindow().label` 判断当前窗口：

```typescript
function Main() {
  const label = getCurrentWindow().label;
  if (label === "logs") return <LogViewer />;
  return <App />;
}
```

### 日志窗口打开机制

日志窗口通过 Tauri 命令 `toggle_log_window` 按需开启/关闭。此命令在 Rust 侧检查窗口是否存在，不存在则创建，存在则聚焦或关闭：

```typescript
// 快捷键触发或菜单按钮调用
invoke("toggle_log_window").catch(...)
```

### 日志实时更新机制

Rust 后端在每次 `send_request` 执行完后调用 `app.emit("http-log", &log_entry)`，日志窗口通过 `listen("http-log", callback)` 监听该事件实现实时更新。同时 `LogViewer` 启动时还通过 `invoke("get_logs")` 获取完整历史记录，并使用 buffer 机制防止事件丢失。

---

## 5. 前端架构

### 组件树

```
App (usePulse + ShortcutEngine)
│
├── PanelGroup (水平布局：侧边栏 | 主区域)
│   │
│   ├── Panel "sidebar-panel"
│   │   └── Sidebar (240px, 固定宽度, 可拖拽调整)
│   │       ├── Collections Tab
│   │       │   ├── DndContext > SortableContext
│   │       │   │   ├── SortableColHeader * N  (集合头部)
│   │       │   │   │   └── Auth / Collapse 折叠区域
│   │       │   │   └── SortableRequestItem * M  (请求行, 支持中键/按钮新标签页)
│   │       │   └── New Collection + Import/Export 按钮
│   │       ├── History Tab
│   │       │   └── HistoryItem * N
│   │       └── Envs Tab
│   │           └── EnvironmentPanel
│   │               └── 环境列表 + 变量编辑器
│   │
│   ├── PanelResizeHandle (水平拖拽分隔条)
│   │
│   └── Panel "main-panel"
│       ├── TabBar（多标签页栏 + 新建标签页按钮）
│       │
│       └── PanelGroup (垂直布局：请求面板 | 响应面板)
│           │
│           ├── Panel "request-panel"
│           │   └── RequestPanel
│           │       ├── URL Bar（方法选择器 + URL 输入 + 保存 + 发送）
│           │       ├── Auth Tab → AuthPanel
│           │       ├── Params Tab（Key-Value 编辑器）
│           │       ├── Headers Tab（Key-Value 编辑器）
│           │       └── Body Tab（Content-Type 选择 → JSON/Form/File/Text）
│           │
│           ├── PanelResizeHandle (垂直拖拽分隔条)
│           │
│           └── Panel "response-panel"
│               └── ResponsePanel
│                   ├── Loading / Error / Empty / 响应 四态
│                   ├── 状态栏（状态码 + 耗时 + 大小）
│                   ├── WaterfallChart（DNS/TCP/TLS/TTFB/Download, 支持折叠/展开）
│                   └── Body Tab（JsonHighlighter 高亮显示）/ Headers Tab
│
├── ToastContainer（固定右上角，成功/错误/信息/警告四种类型）
│
├── SaveDialog / PromptDialog / ConfirmDialog / SettingsDialog / ImportDialog / ExportDialog / TestScriptDialog
└── TabBar

---

## 6. 多标签页架构

Pulse 在较早版本中仅支持单一请求/响应视图。后期重构为多标签页架构，允许用户同时打开多个请求，在标签页间切换。

### 核心数据结构

```typescript
/** 单个标签页的完整状态 */
interface TabState {
  id: string;                    // 唯一 ID（crypto.randomUUID()）
  title: string;                 // 自动生成标题
  createdAt: number;             // 创建时间戳（用于排序）
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
  savedSnapshot: TabSnapshot | null;  // 用于脏状态比较
}
```

### 标签页管理

`usePulse` hook 内部维护 `tabs: TabState[]` 数组和 `activeTabId: string` 两个核心状态：

- **新建标签页** — `newTab()`：添加一个默认状态的空白标签页并切换到它
- **关闭标签页** — `closeTab(id)`：移除指定标签页，若为最后一个则自动创建空白标签页
- **切换标签页** — `switchTab(id)`：更新 `activeTabId`
- **从集合加载** — `openInTab(item, collectionId, inNewTab)`：已打开的请求跳转到已有标签页，否则可新建标签页

### 脏状态监测

每个标签页保存 `savedSnapshot`（请求参数快照），通过字段级比较（method/url/headers/body 等）判断当前是否处于"已修改"状态。TabBar 中脏标签页显示琥珀色圆点指示器。

### 标签页组件 TabBar

渲染在请求面板最上方，功能包括：
- 显示所有标签页（方法标徽 + 标题）
- 脏状态圆点指示
- 激活标签页顶部的琥珀色脉冲光晕动画
- 关闭按钮（悬停时显示）
- 末尾的"+"新建按钮
- 标签页过多时水平滚动

### 向后兼容

为了最小化对子组件的改动，`usePulse` 从 `activeTab` 推导出 `method`、`url`、`headers` 等"平面"状态变量，所有设置器（`setMethod`、`setBody`、`setAuthType` 等）通过 `activeTabId` 代理到当前激活标签页。

---

## 7. 快捷键系统

### 设计目的

替换浏览器原生快捷键机制，提供：
- 单键/两步和弦快捷键支持（如 `Ctrl+K` → `Ctrl+S`）
- 作用域系统（全局/侧边栏/请求面板/响应面板/对话框）
- 用户可自定义绑定（持久化到 `keybindings.json`）
- 快捷键触发时的闪烁反馈动画

### 核心架构

```
src/shortcuts/
├── types.ts              # 类型定义：KeyCombo, ShortcutDef, CommandDef, ShortcutScope 等
├── ShortcutEngine.ts     # 快捷键引擎核心：注册/注销/匹配/分发
├── defaults.ts           # 默认快捷键命令列表
└── useActiveScope.ts     # React Hook：声明当前作用域
```

### 快捷键引擎（ShortcutEngine）

```typescript
class ShortcutEngine {
  start(): void;                          // 开始监听键盘事件
  stop(): void;                           // 停止监听
  registerDefaults(commands: CommandDef[]); // 批量注册默认命令
  loadSerializedBindings(data);            // 加载用户自定义绑定
  getAllBindings(): BindingDisplay[];      // 获取所有绑定（用于设置 UI 显示）
  onCommandFired(cb): () => void;          // 订阅命令触发事件（闪烁反馈）
}
```

### 作用域系统

| 作用域 | 优先级 | 说明 |
|--------|--------|------|
| `dialog` | 最高 | 模态对话框打开时替代所有其他作用域 |
| `global` | 高 | 始终活跃，用于通用操作（发送请求、新建标签页、主题切换） |
| `sidebar` | 中 | 侧边栏聚焦时 |
| `requestPanel` | 中 | 请求面板聚焦时 |
| `responsePanel` | 中 | 响应面板聚焦时 |

作用域通过 `useActiveScope(scope, engine)` Hook 声明。对话框组件在显示时声明 `dialog` 作用域，自动屏蔽其他快捷键。

### 默认快捷键绑定

| 命令 | 快捷键 | 作用域 |
|------|--------|--------|
| `sendRequest` | `Ctrl+Enter` | global |
| `newRequest` | `Ctrl+N` | global |
| `saveRequest` | `Ctrl+S` | global |
| `focusUrlBar` | `Ctrl+L` | global |
| `clearResponse` | `Ctrl+Shift+D` | global |
| `toggleLogs` | `Ctrl+Shift+L` | global |
| `openSettings` | `Ctrl+,` | global |
| `closeTab` | `Ctrl+W` | global |
| `nextTab` / `prevTab` | `Ctrl+Tab` / `Ctrl+Shift+Tab` | global |
| `dialogConfirm` / `dialogCancel` | `Enter` / `Escape` | dialog |
| 侧边栏 Tab 切换 | `Ctrl+Shift+1/2/3` | global |
| 请求 Tab 切换 | `Ctrl+1/2/3/4` | global |

### App 中的集成方式

`App.tsx` 使用 `useEffect` 在挂载时创建 `ShortcutEngine` 实例，通过 `handlerRef` 模式解决闭包陈旧性问题（避免 `useEffect([])` 捕获过时的 handler 引用）：

```typescript
const handlerRef = useRef(state);
handlerRef.current = state; // 每次渲染更新 ref

// 快捷键引擎通过 handlerRef.current 获取最新 handler
const commands = DEFAULT_COMMANDS.map((cmd) => ({
  ...cmd,
  handler: () => getHandlers().sendRequest(),
}));
engine.registerDefaults(commands);
```

---

## 8. 对话框系统

Pulse 使用自定义对话框组件替代原生浏览器弹窗，提供一致的外观和交互体验。所有对话框组件位于 `src/components/` 目录下。

### PromptDialog（输入对话框）

- **用途**：替代 `window.prompt()`，用于重命名请求/集合、输入名称等
- **功能**：文本输入 + 确认/取消 + Enter/Escape 快捷键
- **作用域**：打开时声明 `dialog` 作用域阻止其他快捷键

### ConfirmDialog（确认对话框）

- **用途**：替代 `window.confirm()`，用于删除确认等操作
- **功能**：自定义消息 + 确认/取消按钮
- **作用域**：同上

### SaveDialog（保存/命名对话框）

- **用途**：请求保存时弹出，允许命名或重命名请求
- **功能**：输入名称 + 确认保存 + 脏状态提示
- **可选参数**：默认名称（从 URL/Tab 标题推导）

### SettingsDialog（设置面板）

- **用途**：应用全局设置（缩放、字体、字号、主题）
- **包含设置项**：
  - 缩放预设（75%/85%/100%/115%/125%/150%）
  - 字体选择（Inter / System UI / JetBrains Mono）
  - 字号选择（Small / Medium / Large）
  - 主题切换（Dark / Light）
  - 实时预览区域
- **特性**：设置即时生效，自动持久化到 `settings.json`

### ImportDialog（导入对话框）

- **用途**：从 JSON/YAML 文件导入集合和环境
- **功能**：选择文件 → 预览摘要 → 选择合并策略 → 确认导入
- **合并策略**：`replace`（全部替换）/ `merge`（ID 匹配覆盖，新增追加）

### ExportDialog（导出对话框）

- **用途**：将集合和环境导出为 JSON/YAML 文件
- **功能**：选择格式 + 勾选集合列表 → 原生保存对话框

### TestScriptDialog（测试脚本对话框）

- **用途**：查看和管理测试脚本执行结果
- **功能**：显示测试断言列表、通过/失败状态、响应提取变量

---

## 9. Toast 通知系统

Toast 通知组件提供非侵入式的即时反馈，固定渲染在应用右上角。

### 组件：`Toast.tsx`

| 属性 | 说明 |
|------|------|
| `toasts: ToastItem[]` | 当前显示的 Toast 列表 |
| `onDismiss: (id) => void` | 关闭回调 |

### ToastItem 结构

```typescript
interface ToastItem {
  id: string;
  type: "success" | "error" | "info" | "warning";
  message: string;
  action?: { label: string; onClick: () => void };  // 可选操作按钮
  duration?: number;  // 默认 3000ms，0 = 常驻手动关闭
}
```

### 四种类型

| 类型 | 图标 | 左边框颜色 | 典型用途 |
|------|------|-----------|---------|
| `success` | 勾选圆形 | 翠绿 | 保存成功、请求完成 |
| `error` | 叉号圆形 | 玫瑰红 | 错误提示 |
| `info` | 信息圆形 | 蓝色 | 一般信息 |
| `warning` | 警告三角 | 琥珀 | 警告提示 |

### 行为

- 自动消失：默认 3 秒后触发 `leaving` 动画（200ms），然后调用 `onDismiss`
- 常驻模式：`duration: 0` 时等待用户手动关闭
- 操作按钮：支持在 Toast 内嵌入一个操作按钮（如"撤销"）
- 动画：进入时 `animate-slide-up`，离开时 `opacity` 过渡
- 不遮挡交互：`pointer-events-auto` 仅作用于 Toast 本身

### 状态集成

Toast 状态由 `usePulse` hook 管理，通过 `toasts` 数组和 `addToast` 函数暴露。组件内部自动生成唯一 ID：

```typescript
const addToast = useCallback(
  (type, message, action?, duration?) => {
    const toast = { id: crypto.randomUUID(), type, message, action, duration };
    setToasts((prev) => [...prev, toast]);
  },
  [],
);

const dismissToast = useCallback((id: string) => {
  setToasts((prev) => prev.filter((t) => t.id !== id));
}, []);
```

---

## 10. Rust 后端架构

Pulse 的 Rust 后端使用 **Cargo 工作空间**（Workspace）组织，包含 5 个 crate：

| Crate | 路径 | 用途 |
|-------|------|------|
| `pulse`（主 crate） | `src-tauri/` | Tauri 应用壳 + 21 个 Tauri 命令 |
| `pulse-core` | `src-tauri/pulse-core/` | HTTP 请求核心库 + 数据结构 + 变量替换 |
| `pulse-cli` | `src-tauri/pulse-cli/` | 命令行工具（非 TTY 环境输出 JSON） |
| `pulse-mcp` | `src-tauri/pulse-mcp/` | MCP 服务器（AI Agent 集成） |
| `pulse-mock-server` | `src-tauri/pulse-mock-server/` | 独立 Mock 服务器 |

### 10.1 核心库：`pulse-core`

`pulse-core` 是独立的 HTTP 请求核心库，不依赖 Tauri，可被 CLI、MCP 服务器等复用。

**依赖**：reqwest 0.12（含 multipart）、serde/serde_json、serde_yaml、clap、mime、uuid

**核心功能**：

- `send()` — 发送 HTTP 请求，返回 `ResponseData`
- `substitute_variables()` — 对 URL/Headers/Body 执行 `{{key}}` → value 替换
- `parse_html_form()` — 解析 `application/x-www-form-urlencoded` 请求体
- 数据结构：`RequestInput`、`ResponseData`、`TimingInfo`、`LogEntry`、`HeaderInput`、`Collection`、`Environment` 等

### 10.2 Tauri 命令清单（21 个）

所有 Tauri 命令在 `src-tauri/src/lib.rs` 中注册，通过 `#[tauri::command]` 宏声明。
**注意**：`#[tauri::command]` 函数不可标记为 `pub`（Rust 2021 edition 的宏命名空间与 Tauri v2 冲突）。

#### 请求执行

| 命令 | 类型 | 说明 |
|------|------|------|
| `send_request` | 异步 | **核心命令**：发送 HTTP 请求，返回响应数据 |
| `run_test_script` | 异步 | 运行 YAML 测试脚本文件 |
| `run_collection_test` | 异步 | 执行集合中所有请求的断言 |

#### 日志

| 命令 | 类型 | 说明 |
|------|------|------|
| `get_logs` | 同步 | 获取所有日志条目 |
| `clear_logs` | 同步 | 清空日志存储 |

#### 窗口管理

| 命令 | 类型 | 说明 |
|------|------|------|
| `toggle_log_window` | 异步 | 切换日志窗口显示/隐藏 |

#### 持久化

| 命令 | 类型 | 说明 |
|------|------|------|
| `load_environments` | 同步 | 从磁盘加载环境变量 |
| `save_environments` | 同步 | 将环境变量持久化到磁盘 |
| `load_collections` | 同步 | 从磁盘加载集合数据 |
| `save_collections` | 同步 | 将集合数据持久化到磁盘 |
| `load_keybindings` | 同步 | 从磁盘加载快捷键绑定 |
| `save_keybindings` | 同步 | 将快捷键绑定持久化到磁盘 |
| `load_settings` | 同步 | 从磁盘加载应用设置 |
| `save_settings` | 同步 | 将应用设置持久化到磁盘 |

#### 导入/导出

| 命令 | 类型 | 说明 |
|------|------|------|
| `export_data_to_file` | 异步 | 将集合/环境导出为 JSON/YAML 文件 |
| `export_collection_as_document` | 同步 | 将集合导出为文档预览字符串 |
| `pick_import_file` | 异步 | 弹出原生文件选择器选取导入文件 |
| `preview_import` | 同步 | 预览导入文件的内容摘要 |
| `import_data_from_file` | 异步 | 从文件导入集合/环境数据 |

#### 文件选取

| 命令 | 类型 | 说明 |
|------|------|------|
| `pick_form_file` | 异步 | 弹出原生文件选择器选取上传文件 |
| `pick_test_script_file` | 异步 | 弹出原生文件选择器选取测试脚本 |

### 10.3 `send_request` 命令的完整流程

1. **合并变量** — 合并环境变量与 Collection 变量（环境优先覆盖同名变量）
2. **变量替换** — 对 URL/Headers/Body/Content-Type 执行 `{{key}}` → value 替换
3. **认证注入** — Bearer Token 自动注入 `Authorization` 头
4. **构建客户端** — 创建 reqwest `Client`（60 秒超时，支持 multipart）
5. **装配请求** — 构建请求头（过滤禁用项）、请求体（支持 JSON/Form/Text/Multipart）
6. **发送请求** — 记录发送开始时间 `Instant`
7. **处理响应** — 提取状态码、响应头、响应体、计算耗时
8. **估算各阶段时间** — 将 TTFB 的 35% 估算为连接时间，再分配 DNS(20%)/TCP(30%)/TLS(50%)
9. **构建日志条目** — 成功/失败统一记录到 `LogEntry`（请求体/响应体超 10000 字符安全截断）
10. **存储与通知** — 存入 `Mutex<LogStore>` 并 emit `http-log` 事件

### 10.4 CLI 工具：`pulse-cli`

命令行入口，在非 TTY 环境下所有输出自动格式化为 JSON。适用于 CI/CD 集成和脚本调用。

```bash
npm run cli:build          # 构建 CLI 调试版
npm run cli:run -- request send -m GET <url>     # 发送请求
npm run cli:run -- test <path>                  # 运行测试脚本
npm run cli:run -- collections list             # 列出集合
npm run cli:run -- collections tree             # 集合树
npm run cli:run -- env list                     # 列出环境
npm run cli:run -- env use <name>               # 激活环境
npm run cli:run -- export -f yaml               # 导出数据
```

### 10.5 MCP 服务器：`pulse-mcp`

提供 7 个 MCP 工具供 AI Agent（如 Claude Code）集成，用于自动化 API 测试：

| MCP 工具 | 功能 |
|----------|------|
| `create_test_script` | 从结构化参数创建 YAML 测试脚本 |
| `send_request` | 发送 HTTP 请求（支持环境变量、Bearer Token） |
| `run_test_script` / `run_test_file` | 运行 YAML 测试脚本 |
| `list_collections` / `get_collection_tree` | 浏览集合 |
| `get_collection_request` | 获取集合中特定请求的配置 |
| `list_environments` / `activate_environment` | 管理环境变量 |

---

## 11. 持久化方案

### 数据存储位置

使用 Tauri 的 `app.path().app_data_dir()` 获取操作系统标准的应用数据目录。

### 持久化文件

| 文件 | 内容 | 序列化格式 | 说明 |
|------|------|-----------|------|
| `environments.json` | 环境列表 + 激活 ID | JSON | 可手动编辑 |
| `collections.json` | 集合列表（含请求、断言、提取规则） | JSON | 通过 UI 创建/编辑 |
| `settings.json` | 应用设置（主题/缩放/字体/布局） | JSON | 设置面板自动保存 |
| `keybindings.json` | 用户自定义快捷键绑定 | JSON | 快捷键编辑器自动保存 |

### 同步机制

前端使用 `useState` + `useEffect` 实现自动持久化。关键设计是使用 `Loaded` 布尔标志**跳过初始加载完成前的自动保存**，防止空数据覆盖磁盘文件：

```typescript
const [collectionsLoaded, setCollectionsLoaded] = useState(false);

// 启动加载
useEffect(() => {
  invoke("load_collections").then(data => { ... })
    .finally(() => setCollectionsLoaded(true));
}, []);

// 自动保存（300ms 防抖，跳过初始加载）
useEffect(() => {
  if (!collectionsLoaded) return;
  const timer = setTimeout(() => {
    invoke("save_collections", { data: { collections } });
  }, 300);
  return () => clearTimeout(timer);
}, [collections, collectionsLoaded]);
```

### 设置与布局持久化

设置（`AppSettings`）和布局（侧边栏宽度、请求面板高度）通过 `save_settings` 命令持久化，采用 300ms 防抖合并批量写入。布局变化仅在拖拽释放时触发保存（`onLayoutChanged` 回调），避免频繁磁盘写入。

---

## 12. 状态管理设计

### 设计理念：单一 Hook + Props 穿透

本项目没有使用 Redux、Zustand、Context API 等状态管理库，而是将所有应用状态集中在 `usePulse()` 一个 hook 中，通过 props 逐层传递。这是对当前应用规模**刻意的简化选择**。

### 状态分组

```
usePulse()
├── Tabs（多标签页，核心数据结构）
│   ├── tabs: TabState[]     # 所有标签页
│   ├── activeTabId: string  # 当前激活标签页 ID
│   ├── newTab / closeTab / switchTab
│   └── openInTab / loadCollectionRequest
│
├── Active Tab State（从 activeTab 推导）
│   ├── Request（method, url, headers, body, contentType, auth, params…）
│   ├── Response（response, isLoading, error, responseTab）
│   └── Editing（editingRequest, savedSnapshot, isDirty）
│
├── Persistence（持久化）
│   ├── collections, history
│   └── sidebarTab
│
├── Environment（环境变量）
│   ├── environments, activeEnvironmentId
│   ├── envLoaded, collectionsLoaded
│   └── mergeRequestVariables()（环境 + Collection 变量合并）
│
├── Settings（应用设置）
│   ├── settings: AppSettings（theme, zoomLevel, fontFamily, fontSize, layout）
│   └── settingsLoaded
│
├── Toast（通知）
│   ├── toasts: ToastItem[]
│   ├── addToast / dismissToast
│   └── flashCommand（快捷键闪烁反馈）
│
└── Dialogs（对话框可见性）
    ├── saveDialogVisible
    ├── settingsDialogVisible
    ├── importDialogVisible / exportDialogVisible
    └── testScriptDialogVisible
```

### 关键设计决策

| 决策 | 原因 |
|------|------|
| 单一 Hook | 避免 Context 重渲染问题，简化状态追踪 |
| Props 穿透 | 组件树较浅（3 层），穿透成本低且易于调试 |
| `useCallback` 包裹 | 防止子组件不必要的重渲染 |
| `useRef` 防循环 | URL ↔ Params 双向同步时防止死循环 |
| 标签页隔离 | 每个 TabState 独立，切换标签页不丢失编辑状态 |

### URL ↔ Params 双向同步

```typescript
const skipUrlSync = useRef(false);

// URL 变化 → 解析参数
const handleUrlChange = (newUrl) => {
  skipUrlSync.current = true;  // 标记来自 URL 的变化
  setUrl(newUrl);
  setRawParams(parseUrlParams(newUrl));
};

// 参数变化 → 重构 URL
useEffect(() => {
  if (skipUrlSync.current) { skipUrlSync.current = false; return; }  // 跳过
  const newUrl = buildUrlWithParams(base, rawParams);
  if (newUrl !== url) setUrl(newUrl);
}, [rawParams]);
```

---

## 13. 认证继承体系

Pulse 支持三层认证继承链：

```
集合级认证（Collection.authType / bearerToken）
    │
    ▼
请求级认证（RequestItem.authType / bearerToken）
    │
    ▼
运行时解析（sendRequest 时 resolve）
```

### 解析规则

- 请求设置 `inherit` → 查找所属集合的认证配置
- 集合也是 `inherit` → 降级为 `none`
- 请求未保存到集合 → 降级为 `none`
- `bearer` 类型 → 自动注入 `Authorization: Bearer <token>` 请求头

### 请求发送时的认证注入

在 `sendRequest` 方法中，认证解析在 Rust 变量替换之后、请求发送之前执行：

```typescript
// 解析认证
let resolvedAuthType = authType;
let resolvedToken = bearerToken;
if (authType === "inherit" && editingRequest) {
  const col = collections.find(c => c.id === editingRequest.collectionId);
  if (col && col.authType !== "inherit") {
    resolvedAuthType = col.authType;
    resolvedToken = col.bearerToken;
  } else {
    resolvedAuthType = "none";
  }
}
// Bearer Token 注入到请求头
```

---

## 14. 环境变量与 Collection 变量系统

### 14.1 环境变量

- 创建多个环境（如：开发/测试/生产）
- 每个环境包含一组 `key-value` 变量
- 变量支持启用/禁用（禁用的变量在替换时被跳过）
- 通过 `{{variable_name}}` 语法在 URL/Headers/Body 中使用

### 14.2 Collection 变量

每个 Collection 可以定义自己的变量字典（`variables?: Record<string, string>`），作为请求中 `{{key}}` 模板替换的默认值。适用于同一组 API 共享的基础参数。

### 14.3 变量合并规则

```
Collection 变量（默认值）
    │
    ▼ 环境变量覆盖同名变量（环境优先）
最终合并变量 → Rust 端执行替换
```

```typescript
function mergeRequestVariables(
  envVars: EnvironmentVariable[],      // 环境变量（高优先级）
  allCollections: Collection[],        // 所有集合
  collectionId?: string,               // 当前请求所属集合
): EnvironmentVariable[] {
  // 1. Collection 变量作为基础
  // 2. 环境变量覆盖同名变量
  // 3. 返回合并后的变量列表
}
```

### 14.4 响应提取（Extract）

请求定义支持 `extract` 字段，用于从响应中提取 JSON 值并赋给变量：

```typescript
interface ExtractRule {
  source: "body";           // 提取源：目前仅支持响应体
  path: string;             // JSONPath 表达式，如 "data.token"
  variable: string;         // 变量名，提取的值存入此变量
}
```

提取的变量仅在**当前标签页**有效（非持久化），可用于后续请求的 `{{variable}}` 替换。

### 14.5 替换流程

```
① 前端：获取激活环境中启用的变量列表 activeVars
② 从集合中获取 Collection 变量作为基础
③ 环境变量覆盖同名变量（环境优先）
④ invoke("send_request", { ..., variables: mergedVars })
⑤ Rust：substitute_variables() 遍历每个变量执行 replace
   for var in variables {
     result = result.replace("{{key}}", &var.value);
   }
```

**注意**：变量替换在 Rust 后端执行，是最终的、权威的替换。

---

## 15. 日志系统

### 架构

```
send_request 执行
    │
    ├─ 构建 LogEntry
    │
    ├─ ❶ 存入 Rust Mutex<LogStore>（最大 2000 条，FIFO 淘汰）
    │
    ├─ ❷ app.emit("http-log", log_entry) → Tauri 事件
    │      │
    │      └─ LogViewer.listen("http-log") → 实时更新
    │
    └─❸ LogViewer 按需启动时 invoke("get_logs") → 完整历史
```

### 启动时的竞态处理

`LogViewer` 使用 buffer 策略防止事件丢失：

1. 先启动 `listen("http-log")` 事件监听
2. 事件到达时 push 到 `buffer` 数组
3. 并行执行 `invoke("get_logs")` 获取历史
4. 历史返回后，按 `id` 去重合并 buffer 中的事件

### LogEntry 结构

日志条目记录了请求和响应的完整信息（不是摘要），包括：
- 请求头（`Vec<HeaderInput>`）
- 请求体（已截断至 10000 字符）
- 响应头（`HashMap<String, String>`）
- 响应状态码、耗时、大小

### 日志查看器特性

- 使用 `@tanstack/react-virtual` 实现虚拟列表，支持大量日志高效渲染
- 每行显示：方法标徽、URL、状态码、耗时
- 选中后展开查看详情（请求体/响应体/请求头/响应头）
- 支持清空日志

---

## 16. 拖拽排序实现

### 技术选型

使用 `@dnd-kit` 库（比 react-beautiful-dnd 更轻量、更现代）。

### 实现方案

集合和请求项被**扁平化为一个列表**放入同一个 `SortableContext` 中：

```typescript
// ID 编码
const CP = "c:";                    // 集合前缀
const RP = "r:";                    // 请求前缀

// 集合项 ID: "c:<collectionId>"
// 请求项 ID: "r:<collectionId>:<requestId>"
```

### 拖拽后的目标定位

```
对排序后的扁平 ID 列表进行线性扫描：
1. 遇到 CP 前缀 → 记录 lastColId，重置 idx = 0
2. 遇到 RP 前缀 → 如果是被拖拽的项则停止，否则 idx++
3. 结果：目标集合 = lastColId，目标索引 = idx
```

### DnD 组件

| 组件 | 作用 |
|------|------|
| `DndContext` | 拖拽上下文 |
| `SortableContext` | 排序上下文（垂直列表策略） |
| `SortableColHeader` | 集合头部（可拖拽, 可折叠/展开） |
| `SortableRequestItem` | 请求行（可拖拽, 悬停显示操作按钮） |
| `DragOverlay` | 拖拽时的幽灵效果 |

### 集合折叠功能

每个集合头部支持折叠/展开（折叠时隐藏其下的请求列表），通过 `collapsed` 状态控制折叠箭头的旋转角度。折叠状态**不持久化**，仅在当前会话中有效。

### 新标签页打开

请求行悬停时显示"在新标签页中打开"按钮（同时支持鼠标中键点击），调用 `openInTab(item, collectionId, true)` 在新的标签页加载请求。

---

## 17. 导入/导出系统

### 导出流程

```
① 用户选择"导出"→ ExportDialog 显示
② 用户选择导出格式（JSON 或 YAML）+ 勾选要导出的 Collection
③ 前端调用 export_data_to_file 命令
④ Rust 端构造 ExportData（version + exported_at + collections + environments）
⑤ 以集合 ID 为维度筛选导出集合（每个集合完整序列化，含请求、变量、认证等）
⑥ 通过 Tauri 原生保存对话框写入文件（.json 或 .yaml）
```

### 导入流程

```
① 用户选择"导入"→ ImportDialog 显示
② 用户点击"选择文件"→ pick_import_file 原生文件对话框
③ 选取后调用 preview_import 预览文件内容（展示集合/环境数量）
④ 用户选择合并策略：replace（全部替换）或 merge（ID 匹配覆盖，新项追加）
⑤ 确认导入 → import_data_from_file 执行
```

### 数据结构

```typescript
/** 导入/导出信封数据 */
interface ExportData {
  version: number;           // 数据格式版本号
  exported_at: string;       // ISO 时间戳
  collections: CollectionData;
  environments: EnvironmentData;
}

/** 导入合并策略 */
type ImportExportStrategy = "replace" | "merge";
```

---

## 18. 测试脚本系统

### 请求级断言

每个 `RequestItem` 可以包含 `assertions` 字段，定义一组断言表达式：

```typescript
interface RequestItem {
  // ...
  assertions?: string[];  // 断言表达式，如 "status == 200" 或 "body.success == true"
  skip?: boolean;         // 设为 true 可临时跳过此请求
}
```

### 支持的断言格式

| 表达式 | 说明 |
|--------|------|
| `status == 200` | 状态码等于 200 |
| `status != 404` | 状态码不等于 404 |
| `status >= 200 && status < 300` | 状态码在 200-299 范围 |
| `body.success == true` | 响应体 JSON 路径 `success` 等于 true |
| `body.data.id != null` | JSON 路径不为 null |
| `header.content-type == "application/json"` | 响应头匹配 |
| `body.errors[0].message contains "required"` | 字符串包含匹配 |
| `response_time < 5000` | 响应耗时小于 5000ms |

### 测试执行流程

```
集合 → 遍历所有请求
   │
   ├─ skip === true → 跳过
   │
   ├─ 发送请求（支持变量替换、认证继承）
   │
   ├─ 逐条验证 assertions
   │   ├─ 解析表达式（tokenize + 求值）
   │   ├─ 通过 → 记录 pass
   │   └─ 失败 → 记录 fail + 错误信息
   │
   ├─ 如果有 extract 规则 → 提取变量（供后续请求使用）
   │
   └─ 收集 TestResult → 汇总报告
```

### YAML 测试脚本

测试脚本使用 YAML 格式定义，可被 MCP 服务器创建和运行：

```yaml
name: "User API Tests"
description: "冒烟测试用户管理 API"
variables:
  base_url: "https://api.example.com"
requests:
  - name: "获取用户列表"
    method: GET
    url: "{{base_url}}/users"
    headers:
      Authorization: "Bearer {{token}}"
    assertions:
      - "status == 200"
      - "body.data != null"
    extract:
      - source: "body"
        path: "data[0].id"
        variable: "first_user_id"
```

### Tauri 命令

- `run_test_script(path)` — 运行 YAML 测试脚本文件
- `run_collection_test(collections, collectionId)` — 运行集合中所有请求的断言
- `pick_test_script_file()` — 弹出文件选择器选取测试脚本

---

## 19. Mock 服务器

### 功能

Pulse 内置轻量级 Mock 服务器，基于 `axum` 框架实现（可选 feature `mock-server`），用于本地 API 模拟和测试。

### 启用手动方式

```bash
cd src-tauri && cargo build --features mock-server
```

### 实现

Mock 服务器在 `src-tauri/src/mock_server.rs` 中实现，使用 `axum` 0.7 框架。依赖通过 Cargo feature gate 控制：

```toml
[features]
mock-server = ["axum", "tokio"]
```

---

## 20. 设计系统与主题

### 20.1 双主题架构

Pulse 使用 **CSS 变量** 实现暗色/浅色双主题系统。不再使用 Tailwind 编译期固定的色值，所有颜色通过 `var(--pulse-*)` 引用 CSS 变量。

| 层 | 机制 | 说明 |
|----|------|------|
| **CSS 变量定义** | `src/index.css` | `:root` = 暗色主题，`[data-theme="light"]` = 浅色主题 |
| **Tailwind 配置** | `tailwind.config.ts` | 将 CSS 变量映射到 `pulse-*` 语义色类 |
| **运行时切换** | `App.tsx` | 通过 `data-theme` 属性切换：`<div data-theme={settings.theme}>` |

### 20.2 暗色主题（默认）

```
pulse-deepest   (#0B0D15)  最深背景（最底层）
pulse-surface   (#12141D)  表面背景（卡片/面板）
pulse-elevated  (#1A1D28)  隆起层（悬浮元素）
pulse-hover     (#222638)  悬停高亮
pulse-border    (#2E3348)  边框线

pulse-accent     (#F0B429)  琥珀金强调色
pulse-accent-soft(#F6D055)  强调色柔和版
pulse-accent-dim (#C4941F)  强调色暗淡版

pulse-text-primary   (#E8EAF0)  主要文字
pulse-text-secondary (#9499B3)  次要文字
pulse-text-muted     (#656A82)  弱化文字
```

### 20.3 浅色主题

```
pulse-deepest   (#F5F6FA)  最底层
pulse-surface   (#EBEDF2)  表面背景
pulse-elevated  (#E0E3EA)  隆起层
pulse-hover     (#D5D8E2)  悬停高亮
pulse-border    (#C8CBD8)  边框线

pulse-accent     (#D49520)  琥珀金强调色（暗色主题的变体）
pulse-accent-soft(#E8B440)
pulse-accent-dim (#A67A10)

pulse-text-primary   (#1A1D28)  主要文字（深色）
pulse-text-secondary (#4E5268)  次要文字
pulse-text-muted     (#858AA0)  弱化文字
```

### 20.4 主题CSS变量定义

```css
/* 暗色主题（默认） */
:root {
  --pulse-deepest: #0B0D15;
  --pulse-surface: #12141D;
  /* ... */
}

/* 浅色主题 */
[data-theme="light"] {
  --pulse-deepest: #F5F6FA;
  --pulse-surface: #EBEDF2;
  /* ... */
}
```

Tailwind 配置中，所有 `pulse-*` 颜色使用 `var(--pulse-*)` 引用，而非硬编码色值。运行时修改 CSS 变量即可切换主题，**无需重新编译**。

### 20.5 HTTP 方法颜色

| 方法 | 颜色 | 色值 |
|------|------|------|
| GET | Teal | `#2DD4BF` |
| POST | Blue | `#60A5FA` |
| PUT | Amber | `#F0B429` |
| PATCH | Purple | `#A78BFA` |
| DELETE | Rose | `#FB7185` |
| HEAD | Emerald | `#34D399` |
| OPTIONS | Slate | `#94A3B8` |

### 20.6 CSS 组件类（components layer）

| 类名 | 用途 |
|------|------|
| `.panel` | 卡片面板 |
| `.panel-header` | 面板头部 |
| `.btn-primary` | 主要操作按钮 |
| `.btn-ghost` | 次要/幽灵按钮 |
| `.input-field` | 文本输入框 |
| `.tab-active` / `.tab-inactive` | Tab 激活/非激活样式 |
| `.badge` | 小标签 |
| `.method-badge` | HTTP 方法标签 |

### 20.7 自定义动画

| 动画名 | 用途 |
|--------|------|
| `pulse-soft` | 脏状态圆点闪烁 |
| `fade-in` | 对话框/浮层淡入 |
| `slide-up` | Toast/对话框上滑进入 |

### 20.8 附加调色板语义色

| 色名 | 色值 | 典型用途 |
|------|------|---------|
| `pulse-indigo` | `#6366F1` | 集合色标循环 |
| `pulse-teal` | `#2DD4BF` | 集合色标/GET 方法 |
| `pulse-blue` | `#60A5FA` | 集合色标/POST 方法/信息提示 |
| `pulse-rose` | `#FB7185` | 集合色标/DELETE 方法/错误 |
| `pulse-emerald` | `#34D399` | 集合色标/成功状态 |
| `pulse-amber` | `#FBBF24` | 集合色标/警告 |
| `pulse-purple` | `#A78BFA` | 集合色标/PATCH 方法 |

---

## 21. 可拖拽布局

### 实现

使用 `@bokuweb/react-resizable-layout` 库实现三栏区域自由拖拽调整大小：

- **水平分割**：侧边栏（sidebar） | 主区域（main）
- **垂直分割**：请求面板（request） | 响应面板（response）

### 布局持久化

```typescript
// 默认布局配置
const DEFAULT_SETTINGS = {
  sidebarWidth: 18,          // 侧边栏宽度 18%
  requestPanelHeight: 35,    // 请求面板高度 35%
};
```

布局变化通过 `onLayoutChanged` 回调捕获，调用 `save_settings` 命令持久化：

```typescript
// 水平布局变化时持久化侧边栏宽度
const onHorizontalLayoutChanged = useCallback((layout) => {
  if (layout["sidebar-panel"]) {
    state.updateSettings({ sidebarWidth: layout["sidebar-panel"] });
    saveSettingsDirectly({ sidebarWidth: layout["sidebar-panel"] });
  }
}, []);

// 设置加载完成后恢复持久化的布局
useEffect(() => {
  if (!state.settingsLoaded) return;
  horizontalGroupRef.current?.setLayout({
    "sidebar-panel": state.settings.sidebarWidth,
    "main-panel": 100 - state.settings.sidebarWidth,
  });
}, [state.settingsLoaded]);
```

---

## 22. JSON 语法高亮

### JsonHighlighter 组件

自定义 JSON 语法高亮组件（`src/components/JsonHighlighter.tsx`），**不依赖**任何外部语法高亮库，使用纯正则表达式实现 JSON tokenizer。

### 实现原理

```
JSON 文本 → 正则 tokenizer → Token[] → 着色渲染
```

### 匹配优先级

| 优先级 | Token 类型 | 匹配规则 |
|--------|-----------|---------|
| 1 | key | `"..."` 后跟冒号（lookahead 判断） |
| 2 | string | 普通带引号的值 |
| 3 | keyword | `true` / `false` / `null` |
| 4 | number | 整数 / 小数 / 科学计数法 |
| 5 | structural | `{` `}` `[` `]` |
| 6 | punctuation | `,` `:` |
| 7 | whitespace | 保留原格式 |
| 8 | catch-all | 兜底，确保无遗漏 |

### 颜色映射

| Token 类型 | Tailwind 颜色类 | 色值 |
|-----------|----------------|------|
| key | `text-pulse-blue` | `#60A5FA` |
| string | `text-pulse-emerald` | `#34D399` |
| number | `text-pulse-amber` | `#FBBF24` |
| keyword | `text-pulse-purple` | `#A78BFA` |
| structural | `text-pulse-text-primary` | 跟随主题 |
| punctuation | `text-pulse-text-muted` | 跟随主题 |

### 行为

- 非 JSON 内容（如 HTML/XML/Plain Text）：原样输出
- JSON 内容：先 `JSON.stringify(JSON.parse(), null, 2)` pretty-print，再逐 token 着色
- 空 body：显示斜体占位文字 "Empty response body"
- 解析失败时回退到原始文本

---

## 23. 构建与部署

### 开发模式

```bash
npm run tauri dev          # Tauri 完整开发（Vite HMR + Cargo 热重编译）
npm run dev                # 纯前端 Vite 开发（不启动 Rust）
```

**注意**：仅运行 `npm run dev` 时无法使用 HTTP 请求功能——所有请求通过 Tauri IPC 调用 Rust 执行。

### 生产构建

```bash
npm run build              # tsc 类型检查 + Vite 前端构建
npm run tauri build        # 完整 Tauri 生产构建（生成 .msi/.exe）
```

### CLI 构建

```bash
npm run cli:build          # 构建 CLI 调试版
npm run cli:build:release  # 构建 CLI 发布版
```

### MCP 服务器构建

```bash
npm run mcp:build           # 构建 MCP 服务器调试版
npm run mcp:build:release   # 构建 MCP 服务器发布版
npm run mcp:run             # 运行 MCP 服务器
```

### 类型检查

```bash
npx tsc --noEmit           # TypeScript 类型检查（不生成文件）
cd src-tauri && cargo check # Rust 编译检查（快速）
```

---

## 24. 已知限制与注意事项

### 性能

- **DNS/TCP/TLS 时间估算**：reqwest 不提供原生分阶段计时，后端将 TTFB 的 35% 估算为连接时间，再按 20%/30%/50% 分配给 DNS/TCP/TLS。此数值仅供参考。
- **日志查看器**使用虚拟列表，但 `onScroll` 事件每次触发会重新渲染——对于极高频率的日志流可能造成性能压力。

### 数据安全

- **日志缓冲区**：`LogStore` 的最大容量为 2000 条（Rust 侧固定）。超出后旧日志被丢弃。
- **日志体截断**：请求/响应体超出 10000 字符时被截断（安全地在多字节字符边界处理，不会 panic）。

### 架构约束

- **`#[tauri::command]` 函数**不能标记为 `pub`（Rust 2021 edition 的宏命名空间与 Tauri v2 冲突）。
- **状态管理**使用单一 Hook + Props 穿透。如果应用规模继续增长，应考虑引入 Context 或轻量状态管理库。
- **同步机制**：环境变量、集合数据、设置和快捷键绑定在每次状态变更时**完整写入** JSON 文件。如果数据量显著增大，可能需要引入增量持久化。
- **集合折叠状态**不持久化，重启应用后恢复为展开状态。

### 已知 Bug 列表

详细问题记录见 `bug-report.json`，主要问题摘要：

| # | 严重程度 | 文件 | 问题 |
|---|---------|------|------|
| 1 | HIGH | `lib.rs` | UTF-8 字符串切片边界（已修复） |
| 2 | HIGH | `LogViewer.tsx` | `get_logs` 未处理的 Promise 拒绝 |
| 3 | HIGH | `LogViewer.tsx` | 事件合并竞态条件 |
| 4-9 | MEDIUM/LOW | 多处 | 超时清除、DOM 直接操作、渲染优化等 |

---

## 词汇表

| 术语 | 含义 |
|------|------|
| **Collection** | 请求集合，包含多个 RequestItem 和共享的认证配置、Base URL、变量 |
| **RequestItem** | 单个 HTTP 请求定义（方法、URL、头、体、认证、断言、提取规则） |
| **Tab** | 多标签系统中的单个标签页，包含完整的请求/响应状态和编辑跟踪 |
| **Environment** | 环境变量集合，通过 `{{key}}` 语法注入到请求中（优先级高于 Collection 变量） |
| **Collection Variable** | 集合级默认变量，作为环境变量的默认值（环境变量可覆盖） |
| **Extract Rule** | 响应提取规则：从响应 JSON 中提取值并赋给变量 |
| **Assertion** | 断言表达式：运行测试时逐条验证，支持 status/body/header/response_time 路径 |
| **LogEntry** | 日志条目，记录一次 HTTP 请求的完整生命周期 |
| **LogStore** | Rust 侧托管的日志环形缓冲区（最大 2000 条） |
| **Tauri Command** | 前端通过 `invoke()` 调用的 Rust 函数 |
| **Tauri Event** | Rust 后端通过 `app.emit()` 发送的前端事件 |
| **TTFB** | Time To First Byte，首字节到达时间 |
| **Waterfall** | 瀑布图，直观展示请求各阶段耗时分布 |
| **ShortcutEngine** | 自定义快捷键引擎，支持作用域和弦绑定 |
| **MCP** | Model Context Protocol，AI Agent 集成协议 |
| **Mock Server** | 基于 axum 的轻量级本地 API 模拟服务器 |
