// ============================================================
// Pulse 独立 CLI 入口
//
// 与 Tauri GUI 共享同一份数据文件（%APPDATA%/com.pulse.app/）
// 由 `npm run cli:build` 构建，不依赖 Tauri 运行时
// ============================================================

fn main() {
    let result = pulse_core::cli::run();
    match result {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            eprintln!("错误: {}", e);
            std::process::exit(1);
        }
    }
}
