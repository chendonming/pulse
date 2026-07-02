# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Coding Style

### 中文注释规则

**每次生成或修改代码，必须在以下关键处添加中文注释：**

| 位置 | 必须注释的内容 | 示例 |
|------|---------------|------|
| 文件顶部 | 文件功能概述 | `// ===== 状态管理 Hook，管理所有应用状态 =====` |
| 接口/类型定义 | 用途说明 | `/** HTTP 响应数据 */` |
| 函数/方法 | 功能、参数、返回值说明 | `/** 发送 HTTP 请求，返回响应数据 */` |
| 复杂逻辑块 | 算法意图、步骤说明 | `// 步骤 1: 变量替换 —— 将 {{key}} 替换为实际值` |
| 状态变量 | 含义说明（非显而易见的） | `// 标记：环境数据是否已从 Rust 加载完成` |
| 常量 | 作用说明 | `/** 日志中请求体的最大字符数 */` |
| 关键 `useEffect` | 触发时机和行为 | `// 环境数据变化时自动持久化到 Rust` |

**注释语言**：函数/接口级使用 `/** */` 文档注释，逻辑块内使用 `//` 行注释。英文变量名/函数名保持原样，注释用中文。

## Build & Dev Commands

```bash
npm run dev            # Vite dev server only (http://localhost:1420)
npm run build          # TypeScript check + Vite production build
npm run preview        # Vite preview of production build
npm run tauri dev      # Launch Tauri app with hot-reload (Vite + Cargo)
npm run tauri:mock     # Tauri dev with mock-server feature enabled
npm run tauri build    # Full Tauri production build (.msi/.exe)
```

Rust commands (workspace = 6 crates in `src-tauri/`):
```bash
cd src-tauri && cargo check          # Fast compilation check
cd src-tauri && cargo build          # Debug build
cd src-tauri && cargo test           # Run Rust tests
cd src-tauri && cargo clippy         # Lint all crates
```

Frontend type checking:
```bash
npx tsc --noEmit        # TypeScript check without emitting
```

## Architecture

### Stack
- **Frontend**: React 18 + TypeScript + Vite 6 + Tailwind CSS 3.4
- **Backend**: Rust with Tauri 2 (desktop shell) + reqwest 0.12 (HTTP client)
- **Desktop**: Tauri v2 (WebView2 on Windows)

### Data Flow: Frontend → Rust (pulse-core) → HTTP

```
React UI  ──invoke("send_request")──▶  Tauri Command (src-tauri/src/lib.rs)
              (IPC via @tauri-apps/api/core)    │
                                                ├─ variable substitution (pulse-core)
                                                ├─ execute_http_request (pulse-core/reqwest) ──▶ Target API
                                                └─ response + logging ──▶ LogStore (Rust)
Response JSON ◀─────── ResponseData ──────────────────┘
```

All HTTP requests execute in the Rust backend via Tauri commands, which avoids CORS restrictions. The frontend never calls `fetch()` directly — it uses `invoke()` from `@tauri-apps/api/core` to call the `send_request` Rust function.

### Workspace Crate Architecture (`src-tauri/`)

The workspace contains 6 crates sharing types and logic via `pulse-core`:

| Crate | Role |
|-------|------|
| `pulse` (main) | Tauri GUI — commands, log store, window management, `#[tauri::command]` handlers |
| `pulse-core` | **Shared core** — types (`HeaderInput`, `ResponseData`, etc.), HTTP execution (reqwest), I/O/persistence, test runner, CLI dispatch. No Tauri dependency. |
| `pulse-cli` | Standalone CLI binary (`npm run cli:run`), calls `pulse-core::cli::run()` |
| `pulse-mcp` | MCP server over stdio (JSON-RPC 2.0), wraps `pulse-core` for AI agent integration |
| `pulse-mock-server` | Optional mock HTTP server (axum), feature-gated behind `mock-server` |

`pulse-core` types are re-exported from the main crate so `crate::HeaderInput` etc. still work.

### Key Structures

- **`src/hooks/usePulse.ts`** — Single hook owning all app state (request params, response, history, collections). Every component receives state+setters via props from `App.tsx`. No context/Redux — props drilling is intentional for this scale.
- **`src/types/index.ts`** — Mirrors Rust structs from `pulse-core` exactly (`HeaderInput`, `ResponseData`, `TimingInfo`, etc.). Keep in sync with `pulse-core/src/lib.rs` when changing types.
- **`src/shortcuts/`** — Keyboard shortcut engine (`ShortcutEngine.ts`), defaults, scope tracking. Commands defined in `defaults.ts`, scoped by active UI context.
- **`tailwind.config.ts`** — Custom `pulse-*` color tokens (deep indigo/navy palette with amber/gold accent). Also defines `method-*` colors per HTTP verb.
- **`src-tauri/pulse-core/src/lib.rs`** — Shared types, `execute_http_request()` (reqwest), `substitute_variables()`, I/O, test runner. No Tauri dependency, shared by GUI + CLI + MCP.
- **`src-tauri/src/lib.rs`** — Tauri commands (`send_request`, `get_logs`, `clear_logs`, etc.), `LogStore`, window management (main + logs windows). Re-exports types from `pulse-core`.

### Multi-window Entry (`src/main.tsx`)

Two windows based on Tauri window label:
- `"main"` → `<App />` (main UI)
- `"logs"` → `<LogViewer />` (dedicated log viewer window)

### Component Tree (main window)

```
App
├── TabBar                    — Request tabs (open requests)
├── Sidebar                   — Collections tree + History (tabs)
├── RequestPanel              — URL bar + method selector + Send + Headers/Body/Auth tabs
├── ResponsePanel             — Status bar + WaterfallChart + Body/Headers tabs
├── ToastContainer            — Toast notifications
├── SaveDialog                — Save request to collection
├── ConfirmDialog             — Confirm actions
├── PromptDialog              — Prompt for input
├── ImportDialog              — Import (cURL, collections)
├── ExportDialog              — Export collections
├── TestScriptDialog          — Test script management
└── SettingsDialog            — App settings
```

### Design System (Tailwind Classes)

Use the custom `pulse-*` color classes everywhere instead of hardcoded colors:
- `bg-pulse-deepest`, `bg-pulse-surface`, `bg-pulse-elevated` — background hierarchy
- `text-pulse-text-primary/secondary/muted` — text hierarchy  
- `border-pulse-border` — all borders
- `bg-pulse-accent` / `text-pulse-accent` — amber/gold accent
- `text-method-get/post/put/patch/delete` — HTTP method colors

Convenience component classes in `src/index.css`: `.panel`, `.btn-primary`, `.btn-ghost`, `.input-field`, `.badge`, `.method-badge`.

### Known Limitations

- `#[tauri::command]` functions must NOT be `pub` (Rust 2021 macro namespace conflict with Tauri v2)
- Timing waterfall phases (DNS/TCP/TLS) are estimated as percentages of TTFB, not measured — reqwest lacks per-step timing hooks
- Icons are pre-generated via sharp in `src-tauri/icons/`; regenerate with `node -e "require('sharp')..."` if the SVG changes
- The `[mock-server]` feature adds axum + tokio dependencies; build with `npm run tauri:mock` to enable

## AI Agent 集成

### MCP 工具（推荐）
项目提供 pulse-mcp MCP 服务器：
- `create_test_script` — 从结构化参数创建 YAML 测试脚本并保存到指定路径
- `send_request` — 发送 HTTP 请求（支持环境变量、Bearer Token）
- `run_test_script` / `run_test_file` — 运行 YAML 测试脚本
- `list_collections` / `get_collection_tree` — 浏览集合
- `get_collection_request` — 获取集合中特定请求的配置
- `list_environments` / `activate_environment` — 管理环境变量

### CLI 命令（备用）
pulse-cli 二进制：非 TTY 环境自动输出 JSON
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

### MCP 服务器
```bash
npm run mcp:build          # 构建 MCP 服务器调试版
npm run mcp:build:release  # 构建 MCP 服务器发布版
npm run mcp:run            # 运行 MCP 服务器
```

### Mock 服务器（开发测试用）
```bash
npm run mock-server:build          # 构建 mock 服务器调试版
npm run mock-server:build:release  # 构建 mock 服务器发布版
npm run mock-server:run            # 运行 mock 服务器
```
Mock server 监听端口由 `MOCK_PORT` 环境变量控制（默认 3001）。

### 典型工作流
1. `create_test_script` 为新 API 创建测试脚本
2. `list_collections` 查看可用 API
3. `activate_environment` 选择环境
4. `send_request` 发起测试
5. `run_test_file` 运行完整的断言测试
