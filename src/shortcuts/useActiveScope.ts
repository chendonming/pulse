// ===== 作用域管理 Hook =====
//
// 组件挂载时声明作用域激活，卸载时自动清除

import { useEffect } from "react";
import type { ShortcutScope } from "./types";
import { ShortcutEngine } from "./ShortcutEngine";

/**
 * 在组件挂载期间声明一个作用域为激活状态。
 * 如 scope="dialog"，则挂载期间所有非 dialog 快捷键被阻止。
 */
export function useActiveScope(scope: ShortcutScope, engine: ShortcutEngine | null): void {
  useEffect(() => {
    if (!engine) return;
    engine.pushScope(scope);
    return () => engine.popScope(scope);
  }, [scope, engine]);
}
