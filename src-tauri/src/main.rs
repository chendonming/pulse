// 防止 Windows 发布版出现额外控制台窗口（仅 GUI 模式有效）
// CLI 模式在 debug 构建下自动有控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/**
 * 程序入口
 *
 * 双模式入口：
 * - 不带参数 → 启动 Tauri GUI 应用（委托给 pulse_lib::run()）
 * - 带参数    → 进入 CLI 命令行模式（委托给 pulse_lib::cli_run()）
 *   CLI 支持 request/test/collections/environments/export/import 子命令
 */
fn main() {
    // 如果有命令行参数，走 CLI 模式
    if std::env::args().len() > 1 {
        pulse_lib::cli_run();
    } else {
        // 无参数则启动 Tauri GUI
        pulse_lib::run()
    }
}
