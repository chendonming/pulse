# Pulse

> A modern, high-performance HTTP client for API testing and debugging — built with Tauri, Rust, and React.

Pulse is a cross-platform desktop application for crafting HTTP requests, inspecting responses, and organizing API workflows. It combines the speed and safety of a Rust backend with a responsive React frontend, delivering a native experience without Electron's overhead.

---

## Features

### Request Composition

- **7 HTTP methods** — GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- **URL parameters** — key/value editor with per-parameter toggle
- **Headers** — enable/disable individual headers on the fly
- **Body editor** — raw body with content-type selection (JSON, form-urlencoded, plain text, XML, HTML)
- **Authentication** — Bearer token support, with collection-level "inherit" mode for shared credentials
- **cURL import** — paste a cURL command directly into the URL bar

### Response Inspection

- **Status & timing** — response code, duration, and size at a glance
- **Response body** — raw body viewer
- **Response headers** — full header breakdown
- **Timing waterfall** — visualize DNS lookup, TCP connection, TLS handshake, TTFB, and download phases

### Collections

- Organize requests into named collections
- Add, rename, and delete requests within collections
- Collection-level bearer token inheritance — set a token once on the collection, all child requests inherit it automatically
- Persistent local storage via the Rust backend

### Environment Variables

- Create and switch between named environments (development, staging, production, …)
- Define `{{variable}}` placeholders that are substituted into URLs, headers, and body fields before sending
- Per-variable enable/disable toggle for granular control
- Variables are substituted in the Rust backend — no JavaScript interpolation

### Request History

- Every request is automatically logged with method, URL, status, timing, size, and timestamp
- Full request/response capture including headers and body (truncated at 10 KB for performance)
- Real-time log viewer window with search and filtering
- Tail-click to replay any historical request
- Up to 2,000 entries kept in-memory, persisted per session

---

## Architecture

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
│  │   • Tauri commands (send_request, load/save, etc.)        │   │
│  │   • LogStore (in-memory request history)                  │   │
│  │   • Dual-mode entry: args → CLI, else → GUI               │   │
│  └────────────────────────┬───────────────────────────────────┘   │
│                           │ depends on                             │
│  ┌────────────────────────▼───────────────────────────────────┐   │
│  │   pulse-core (Shared Library, no Tauri dependency)          │   │
│  │                                                             │   │
│  │   ┌──────────┐  ┌──────────┐  ┌────────────────┐          │   │
│  │   │ Types    │  │ HTTP     │  │ Variable       │          │   │
│  │   │ (structs)│  │ Execution│  │ Substitution   │          │   │
│  │   └──────────┘  └──────────┘  └────────────────┘          │   │
│  │   ┌──────────┐  ┌──────────┐  ┌────────────────┐          │   │
│  │   │ I/O     │  │ Test     │  │ CLI            │          │   │
│  │   │(Export/ │  │ Runner   │  │ (clap parsing) │          │   │
│  │   │ Import) │  │(YAML/    │  │                │          │   │
│  │   │         │  │Asserts)  │  │                │          │   │
│  │   └──────────┘  └──────────┘  └────────────────┘          │   │
│  └────────────────────────────────────────────────────────────┘   │
│                           │ depends on                             │
│  ┌────────────────────────▼───────────────────────────────────┐   │
│  │   pulse-cli (Standalone Binary, ~4 MB)                     │   │
│  │   Thin entry point: pulse_core::cli::run()                 │   │
│  │   Built via: npm run cli:build                             │   │
│  └────────────────────────────────────────────────────────────┘   │
│                           │                                       │
│                           ▼                                       │
│                   Target API (external HTTP server)                │
└────────────────────────────────────────────────────────────────────┘
```

All HTTP requests execute in the Rust backend, avoiding CORS restrictions. The frontend never calls `fetch()` directly — it uses `invoke()` from `@tauri-apps/api/core`.

The **`pulse-core` library** encapsulates all shared business logic with zero Tauri dependencies, enabling the CLI to be built independently in seconds. The **`pulse-cli` binary** is a thin wrapper (20 lines) around `pulse_core::cli::run()`. The **Tauri binary** (`pulse.exe`) re-exports `pulse-core` types and functions for backward-compatible dual-mode dispatch.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop Shell** | [Tauri v2](https://v2.tauri.app/) (WebView2 on Windows) |
| **Frontend** | React 18 + TypeScript + Vite 6 |
| **Styling** | Tailwind CSS 3.4 with custom `pulse-*` design tokens |
| **Backend (Shared)** | Rust — `pulse-core` library (reqwest 0.12, clap, serde) |
| **CLI** | Standalone binary — `pulse-cli` (no Tauri dependency) |
| **IPC** | `@tauri-apps/api` (invoke / event system) |
| **Persistence** | JSON files in the OS app data directory |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) (WebView2 on Windows)

### Development

```bash
# Install frontend dependencies
npm install

# Launch the app in development mode (Vite HMR + Tauri window)
npm run tauri dev

# Vite dev server only (browser-based UI development)
npm run dev        # → http://localhost:1420
```

### Build

```bash
# TypeScript check
npx tsc --noEmit

# Production build
npm run build                # Frontend only
npm run tauri build           # Full Tauri desktop build (.msi/.exe)

# Standalone CLI build (no Tauri dependency, ~4 MB release binary)
npm run cli:build             # Debug build
npm run cli:build:release     # Optimized release build
```

### CLI Mode

Pulse exposes a feature-rich command-line interface that can be built independently of the desktop app:

```bash
# Run CLI commands via npm
npm run cli:run -- request GET https://api.example.com/users
npm run cli:run -- env list
npm run cli:run -- collections list --json
npm run cli:run -- export -f yaml -o ./backup.yaml
npm run cli:run -- import ./backup.yaml
```

Or directly, after building:

```bash
./src-tauri/target/release/pulse-cli.exe --help
```

#### Available Commands

| Command | Description |
|---------|-------------|
| `request <url>` | Send an HTTP request and print the response |
| `test <path>` | Run a YAML test script with assertions |
| `collections list` | List all saved collections |
| `env list` | List all environments |
| `env use <name>` | Activate an environment |
| `export` | Export collections/environments to JSON or YAML |
| `import <path>` | Import data from a JSON/YAML file |

Flags: `--json` on any command outputs machine-readable JSON. `--env <name>` on `request`/`test` selects an environment for `{{variable}}` interpolation.

### Tauri Binary (Dual-Mode)

The Tauri-built `pulse.exe` retains backward-compatible dual-mode: run with arguments for CLI mode, without arguments to launch the GUI.

```bash
./src-tauri/target/release/pulse.exe                      # → GUI mode
./src-tauri/target/release/pulse.exe request GET ...       # → CLI mode
```

### Rust Commands

```bash
cd src-tauri
cargo check        # Fast compilation check
cargo build        # Debug build (all workspace members)
cargo build -p pulse-cli    # Build only the standalone CLI
cargo test         # Run Rust tests
```

---

## Project Structure

```
pulse/
├── src/                          # React frontend
│   ├── App.tsx                   # Root component — state wiring
│   ├── main.tsx                  # React entry point
│   ├── LogViewer.tsx             # Real-time request log window
│   ├── hooks/
│   │   └── usePulse.ts           # Single hook owning all application state
│   ├── types/
│   │   └── index.ts              # TypeScript interfaces (mirrors Rust structs)
│   └── components/
│       ├── RequestPanel.tsx      # URL bar, method selector, tabs (auth/params/headers/body)
│       ├── ResponsePanel.tsx     # Response display (status, body, headers)
│       ├── WaterfallChart.tsx    # Timing waterfall visualization
│       ├── Sidebar.tsx           # Collections list, history, environment management
│       ├── AuthPanel.tsx         # Authentication configuration
│       └── EnvironmentPanel.tsx  # Environment variable editor
├── src-tauri/                    # Rust backend (Cargo workspace)
│   ├── pulse-core/               # Shared library (no Tauri dependency)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs            # Types, HTTP execution, variable substitution, persistence
│   │       ├── cli.rs            # CLI argument parsing and command handlers
│   │       ├── io.rs             # Import/export (JSON, YAML)
│   │       └── test_runner.rs    # YAML test script engine
│   ├── pulse-cli/                # Standalone CLI binary (~4 MB release)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       └── main.rs           # CLI entry point (thin wrapper around pulse-core)
│   ├── src/
│   │   ├── lib.rs                # Tauri commands, log store, GUI entry
│   │   ├── main.rs               # Dual-mode entry: CLI args → CLI mode, else GUI
│   │   └── mock_server.rs        # Optional mock HTTP server (feature-gated)
│   ├── tauri.conf.json           # Tauri application configuration
│   └── Cargo.toml                # Workspace root + Tauri GUI package
├── tailwind.config.ts            # Custom color tokens and design system
├── package.json
└── vite.config.ts
```

---

## Design System

Pulse uses a custom dark-themed palette defined via Tailwind CSS. All UI components use the `pulse-*` token classes:

| Token | Purpose |
|-------|---------|
| `bg-pulse-deepest` | Primary background (level 0) |
| `bg-pulse-surface` | Elevated surface (level 1) |
| `bg-pulse-elevated` | Popover / modal surface (level 2) |
| `text-pulse-text-primary` | Primary text |
| `text-pulse-text-secondary` | Secondary / subdued text |
| `text-pulse-text-muted` | Muted / placeholder text |
| `border-pulse-border` | Borders and dividers |
| `bg-pulse-accent` / `text-pulse-accent` | Amber/gold accent |
| `text-method-{get,post,put,patch,delete}` | Per-HTTP-method semantic colors |

---

## Roadmap

### short-term

- [ ] **cURL export** — generate cURL command strings from composed requests
- [ ] **Multi-tab interface** — switch between multiple requests in the same window
- [ ] **request history persistence** — save history across app restarts

### Mid-term

- [ ] **GraphQL support** — query builder and schema introspection
- [ ] **WebSocket client** — real-time message send/receive panel
- [ ] **Plugin system** — custom middleware for request/response pipelines

### Claude Code / LLM Integration

- [x] **Independent CLI binary** — `pulse-cli` can be built and distributed standalone (no Tauri/GUI dependency)
- [ ] **Structured JSON output** — all CLI commands support `--json` for machine consumption (已实现)
- [ ] **MCP tool wrapping** — expose pulse-cli as a [Model Context Protocol](https://modelcontextprotocol.io/) tool so Claude Code and other LLM agents can send HTTP requests, run tests, and manage collections directly from conversation
- [ ] **Schema-driven request generation** — given an OpenAPI/Swagger spec, auto-generate collections and test scripts

The independent `pulse-core` library and `--json` output mode lay the groundwork for LLM-native API testing — where an AI agent invokes pulse-cli as a tool to make live HTTP requests, validate responses, and maintain collections without a GUI.

---

## Known Limitations

- **Timing waterfall**: DNS lookup, TCP connection, and TLS handshake phases are estimated as percentages of TTFB — reqwest does not expose per-step timing hooks natively.
- **Body truncation**: Request/response bodies over 10 KB are truncated in the history log to manage memory usage. Full content is always visible in the response panel.
- **Single-window UI**: The current release uses a single main window plus a dedicated log viewer window. A multi-tab interface is planned.

---

## License

[MIT](LICENSE)
