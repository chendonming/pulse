# Pulse

> 一款现代化、高性能的 HTTP 客户端，用于 API 测试与调试 —— 基于 Tauri、Rust 和 React 构建。

Pulse 是一个跨平台桌面应用，用于编排 HTTP 请求、查看响应和组织 API 工作流。它将 Rust 后端的速度与安全性，同 React 前端的响应式体验相结合，提供原生级桌面体验，避开 Electron 的体积开销。

---

## 功能特性

### 请求编辑

- **7 种 HTTP 方法** — GET、POST、PUT、PATCH、DELETE、HEAD、OPTIONS
- **URL 参数** — 支持逐参数启停的键值对编辑器
- **请求头** — 按需启用/禁用单个请求头
- **请求体编辑器** — 原始请求体，支持 Content-Type 选择（JSON、form-urlencoded、纯文本、XML、HTML）
- **鉴权** — Bearer Token 支持，集合级"继承"模式用于共享凭据
- **cURL 导入** — 将 cURL 命令直接粘贴到 URL 栏

### 响应查看

- **状态与耗时** — 响应码、时长、体积一目了然
- **响应体** — 原始响应体查看器
- **响应头** — 完整的响应头列表
- **耗时瀑布图** — 可视化展示 DNS 查询、TCP 连接、TLS 握手、TTFB 和下载阶段

### 集合管理

- 将请求组织到命名集合中
- 集合内请求的添加、重命名、删除操作
- 集合级 Bearer Token 继承 —— 在集合上设置一次 Token，所有子请求自动继承
- 通过 Rust 后端持久化到本地存储

### 环境变量

- 创建和切换命名环境（开发、预发布、生产……）
- 定义 `{{variable}}` 占位符，在发送前自动替换到 URL、请求头和请求体字段中
- 逐变量启用/禁用开关，实现精细控制
- 变量替换在 Rust 后端完成，不依赖 JavaScript 插值

### 请求历史

- 每次请求自动记录方法、URL、状态码、耗时、体积和时间戳
- 完整的请求/响应捕获，包含请求头和请求体（为性能考虑截断至 10 KB）
- 实时日志查看器窗口，支持搜索和过滤
- 点击日志条目可重新发起任意历史请求
- 内存中最多保留 2,000 条记录，每次会话持久化

---

## 架构

```
                        ┌──────────────────────────────────────────┐
                        │           React UI (WebView)             │
                        │  Vite + TypeScript + Tailwind CSS 3.4    │
                        │                                          │
                        │  invoke("send_request", payload)         │
                        └────────────────┬─────────────────────────┘
                                         │ Tauri IPC
                                         ▼
┌────────────────────────────────────────────────────────────────────┐
│  ┌────────────────────────────────────────────────────────────┐   │
│  │   Tauri GUI (pulse.exe)                                    │   │
│  │   • Tauri 命令（send_request、load/save 等）                │   │
│  │   • LogStore（内存请求历史）                                 │   │
│  │   • 双模式入口：有参数 → CLI，否则 → GUI                     │   │
│  └────────────────────────┬───────────────────────────────────┘   │
│                           │ 依赖                                   │
│  ┌────────────────────────▼───────────────────────────────────┐   │
│  │   pulse-core（共享库，不依赖 Tauri）                         │   │
│  │                                                             │   │
│  │   ┌──────────┐  ┌──────────┐  ┌────────────────┐          │   │
│  │   │ 类型定义  │  │ HTTP     │  │ 变量替换        │          │   │
│  │   │ (structs)│  │ 执行引擎  │  │ {{key}} → 值   │          │   │
│  │   └──────────┘  └──────────┘  └────────────────┘          │   │
│  │   ┌──────────┐  ┌──────────┐  ┌────────────────┐          │   │
│  │   │ 导入/导出 │  │ 测试脚本  │  │ CLI 命令       │          │   │
│  │   │ (JSON/   │  │ 执行引擎  │  │ (clap 解析)    │          │   │
│  │   │  YAML)   │  │(YAML/    │  │                │          │   │
│  │   │          │  │ 断言)    │  │                │          │   │
│  │   └──────────┘  └──────────┘  └────────────────┘          │   │
│  └────────────────────────────────────────────────────────────┘   │
│                           │ 依赖                                   │
│  ┌────────────────────────▼───────────────────────────────────┐   │
│  │   pulse-cli（独立二进制，约 4 MB）                           │   │
│  │   薄封装层：pulse_core::cli::run()                          │   │
│  │   构建命令：npm run cli:build                                │   │
│  └────────────────────────────────────────────────────────────┘   │
│                           │                                       │
│                           ▼                                       │
│                   目标 API（外部 HTTP 服务器）                      │
└────────────────────────────────────────────────────────────────────┘
```

所有 HTTP 请求在 Rust 后端执行，避免跨域（CORS）限制。前端从不直接调用 `fetch()` —— 而是使用 `@tauri-apps/api/core` 的 `invoke()` 调用 Rust 的 `send_request` 函数。

**`pulse-core` 库** 封装了全部共享业务逻辑，零 Tauri 依赖，使 CLI 能在数秒内独立构建。**`pulse-cli` 二进制** 是对 `pulse_core::cli::run()` 的薄封装（仅 20 行代码）。**Tauri 二进制**（`pulse.exe`）通过 re-export 暴露 `pulse-core` 的类型和函数，保持双模式入口向后兼容。

### 技术栈

| 层 | 技术选型 |
|-------|-----------|
| **桌面壳** | [Tauri v2](https://v2.tauri.app/)（Windows 上使用 WebView2） |
| **前端** | React 18 + TypeScript + Vite 6 |
| **样式** | Tailwind CSS 3.4 + 自定义 `pulse-*` 设计令牌 |
| **后端（共享）** | Rust — `pulse-core` 库（reqwest 0.12、clap、serde） |
| **CLI** | 独立二进制 — `pulse-cli`（不依赖 Tauri） |
| **IPC** | `@tauri-apps/api`（invoke / 事件系统） |
| **持久化** | 应用数据目录下的 JSON 文件 |

---

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install)（最新稳定版）
- [Tauri v2 前置条件](https://v2.tauri.app/start/prerequisites/)（Windows 上需 WebView2）

### 开发模式

```bash
# 安装前端依赖
npm install

# 启动开发模式（Vite HMR + Tauri 窗口）
npm run tauri dev

# 仅启动 Vite 开发服务器（浏览器内 UI 开发）
npm run dev        # → http://localhost:1420
```

### 构建

```bash
# TypeScript 类型检查
npx tsc --noEmit

# 生产构建
npm run build                # 仅前端
npm run tauri build           # 完整 Tauri 桌面构建（.msi/.exe）

# 独立 CLI 构建（不依赖 Tauri，release 约 4 MB）
npm run cli:build             # Debug 构建
npm run cli:build:release     # 优化 Release 构建
```

### CLI 命令行模式

Pulse 提供功能丰富的命令行界面，可独立于桌面应用构建：

```bash
# 通过 npm 运行 CLI 命令
npm run cli:run -- request GET https://api.example.com/users
npm run cli:run -- env list
npm run cli:run -- collections list --json
npm run cli:run -- export -f yaml -o ./backup.yaml
npm run cli:run -- import ./backup.yaml
```

构建后也可直接运行：

```bash
./src-tauri/target/release/pulse-cli.exe --help
```

#### 可用命令

| 命令 | 说明 |
|---------|-------------|
| `request <url>` | 发送 HTTP 请求并打印响应 |
| `test <path>` | 运行 YAML 测试脚本（含断言） |
| `collections list` | 列出所有已保存的集合 |
| `env list` | 列出所有环境 |
| `env use <name>` | 激活指定环境 |
| `export` | 将集合/环境导出为 JSON 或 YAML |
| `import <path>` | 从 JSON/YAML 文件导入数据 |

全局标志：`--json` 使任何命令输出机器可读的 JSON。`request`/`test` 命令的 `--env <name>` 选择用于 `{{variable}}` 插值的环境。

### Tauri 二进制（双模式）

由 Tauri 构建的 `pulse.exe` 保留向后兼容的双模式：带参数运行进入 CLI 模式，不带参数启动 GUI。

```bash
./src-tauri/target/release/pulse.exe                      # → GUI 模式
./src-tauri/target/release/pulse.exe request GET ...       # → CLI 模式
```

### Rust 命令

```bash
cd src-tauri
cargo check                   # 快速编译检查
cargo build                   # Debug 构建（所有 workspace 成员）
cargo build -p pulse-cli      # 仅构建独立 CLI
cargo test                    # 运行 Rust 测试
```

---

## AI Agent 集成

Pulse 提供 [Model Context Protocol](https://modelcontextprotocol.io/)（MCP）服务器，让 AI 代理（包括 **Claude Code**）可以在对话中直接发送 HTTP 请求、运行测试和管理集合。

```
Claude Code  ──MCP JSON-RPC over stdio──▶  pulse-mcp  ──pulse-core──▶  目标 API
```

### 快速安装

```bash
# 1. 构建 pulse-mcp
npm run mcp:build:release

# 2. 安装到 PATH
cp src-tauri/target/release/pulse-mcp /usr/local/bin/
pulse-mcp --version        # 验证
```

### 注册到 Claude Code

在项目根目录创建 `.claude/settings.local.json`：

```json
{
  "mcpServers": {
    "pulse": {
      "type": "stdio",
      "command": "pulse-mcp",
      "args": []
    }
  }
}
```

> 如果 `pulse-mcp` 不在 `$PATH` 中，请使用绝对路径代替（如 `/Users/you/project/src-tauri/target/release/pulse-mcp`）。

重启 Claude Code，它会自动发现 MCP 服务器并加载工具列表。

### 可用 MCP 工具

注册后，Claude 会根据你的请求自动调用以下工具：

| 工具 | 功能 |
|------|------|
| `send_request` | 发送任意 HTTP 请求（方法、URL、请求头、请求体、环境变量） |
| `run_test_script` | 运行 YAML 测试脚本（含断言） |
| `run_test_file` | 从文件路径运行测试脚本 |
| `list_collections` | 列出所有已保存的 API 集合 |
| `get_collection_tree` | 完整集合树（含方法和 URL） |
| `get_collection_request` | 按集合名和请求名提取特定请求配置 |
| `list_environments` | 列出所有环境 |
| `activate_environment` | 切换当前激活的环境 |

### 使用示例

在 Claude Code 中尝试以下对话：

| 你说 | Claude 执行 |
|------|------------|
| "列出我的 API 集合" | 调用 `list_collections` |
| "向 https://api.example.com/users 发送 GET 请求" | 调用 `send_request(method="GET", url="...")` |
| "激活 staging 环境，然后获取用户列表" | 调用 `activate_environment` 再调用 `send_request` |
| "用 staging 环境运行 tests/user-crud.yaml" | 调用 `run_test_file` |
| "我有哪些环境？" | 调用 `list_environments` |

### CLI 备用方式（无 MCP）

如果尚未构建 pulse-mcp，Claude Code 仍可通过 shell 命令使用 Pulse：

```bash
! pulse request -m GET https://api.example.com/users
! pulse test tests/user-crud.yaml
! pulse collections list --json
```

但 MCP 体验更优——Claude 能看见工具签名、参数描述，并自动填充默认值。**建议完成 MCP 配置。**

### 卸载

```bash
rm /usr/local/bin/pulse-mcp
rm .claude/settings.local.json
```

---

## 项目结构

```
pulse/
├── src/                          # React 前端
│   ├── App.tsx                   # 根组件 —— 状态编排
│   ├── main.tsx                  # React 入口
│   ├── LogViewer.tsx             # 实时请求日志窗口
│   ├── hooks/
│   │   └── usePulse.ts           # 单一 Hook 管理全部应用状态
│   ├── types/
│   │   └── index.ts              # TypeScript 接口（镜像 Rust 结构体）
│   └── components/
│       ├── RequestPanel.tsx      # URL 栏、方法选择器、标签页（认证/参数/请求头/请求体）
│       ├── ResponsePanel.tsx     # 响应展示（状态码、响应体、响应头）
│       ├── WaterfallChart.tsx    # 耗时瀑布图可视化
│       ├── Sidebar.tsx           # 集合列表、历史记录、环境管理
│       ├── AuthPanel.tsx         # 鉴权配置
│       └── EnvironmentPanel.tsx  # 环境变量编辑器
├── src-tauri/                    # Rust 后端（Cargo workspace）
│   ├── pulse-core/               # 共享库（不依赖 Tauri）
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs            # 类型定义、HTTP 执行、变量替换、持久化
│   │       ├── cli.rs            # CLI 参数解析与命令处理器
│   │       ├── io.rs             # 导入/导出（JSON、YAML）
│   │       └── test_runner.rs    # YAML 测试脚本引擎
│   ├── pulse-cli/                # 独立 CLI 二进制（release 约 4 MB）
│   │   ├── Cargo.toml
│   │   └── src/
│   │       └── main.rs           # CLI 入口（围绕 pulse-core 的薄封装）
│   ├── src/
│   │   ├── lib.rs                # Tauri 命令、日志存储、GUI 入口
│   │   ├── main.rs               # 双模式入口：有 CLI 参数 → CLI 模式，否则 → GUI
│   │   └── mock_server.rs        # 可选的 Mock HTTP 服务器（feature 控制）
│   ├── tauri.conf.json           # Tauri 应用配置
│   └── Cargo.toml                # Workspace 根 + Tauri GUI 包
├── tailwind.config.ts            # 自定义颜色令牌与设计系统
├── package.json
└── vite.config.ts
```

---

## 设计系统

Pulse 使用 Tailwind CSS 定义的自研深色主题色板。所有 UI 组件使用 `pulse-*` 令牌类：

| 令牌 | 用途 |
|-------|---------|
| `bg-pulse-deepest` | 主背景（层级 0） |
| `bg-pulse-surface` | 低层表面（层级 1） |
| `bg-pulse-elevated` | 弹出层/模态层（层级 2） |
| `text-pulse-text-primary` | 主文字 |
| `text-pulse-text-secondary` | 次要/弱化文字 |
| `text-pulse-text-muted` | 静默/占位文字 |
| `border-pulse-border` | 边框和分隔线 |
| `bg-pulse-accent` / `text-pulse-accent` | 琥珀金强调色 |
| `text-method-{get,post,put,patch,delete}` | 按 HTTP 方法区分的语义色 |

---

## 路线图

### 短期

- [ ] **cURL 导出** —— 从已编排的请求生成 cURL 命令字符串
- [ ] **多标签页界面** —— 在同一窗口中切换多个请求
- [ ] **请求历史持久化** —— 跨应用重启保留历史记录

### 中期

- [ ] **GraphQL 支持** —— 查询构造器与 Schema 内省
- [ ] **WebSocket 客户端** —— 实时消息收发面板
- [ ] **插件系统** —— 请求/响应管道的自定义中间件

### Claude Code / LLM 集成

- [x] **独立 CLI 二进制** —— `pulse-cli` 可独立构建分发的命令行工具（不依赖 Tauri/GUI）
- [ ] **结构化 JSON 输出** —— 所有 CLI 命令支持 `--json` 选项供机器消费（已实现）
- [ ] **MCP 工具封装** —— 将 pulse-cli 封装为 [Model Context Protocol](https://modelcontextprotocol.io/) 工具，使 Claude Code 和其他 LLM 代理可在对话中直接发送 HTTP 请求、运行测试和管理集合
- [ ] **Schema 驱动的请求生成** —— 给定 OpenAPI/Swagger 规范，自动生成集合和测试脚本

独立的 `pulse-core` 库和 `--json` 输出模式为 LLM 原生 API 测试奠定了基础 —— AI 代理可将 pulse-cli 作为工具调用，发起真实 HTTP 请求、验证响应、维护集合，全程无需图形界面。

---

## 已知限制

- **耗时瀑布图**：DNS 查询、TCP 连接和 TLS 握手阶段是按 TTFB 百分比估算的 —— reqwest 本身不暴露分阶段计时接口
- **请求体截断**：超过 10 KB 的请求/响应体在历史日志中被截断以控制内存占用。响应面板中始终可见完整内容
- **单窗口 UI**：当前版本使用一个主窗口加一个专用日志查看器窗口。多标签页界面已在计划中

---

## 许可证

[MIT](LICENSE)
