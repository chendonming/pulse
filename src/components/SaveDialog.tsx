import { useState, useEffect, useRef } from "react";
import type { ShortcutEngine } from "../shortcuts/ShortcutEngine";
import { useActiveScope } from "../shortcuts/useActiveScope";

/**
 * 请求保存命名对话框
 *
 * 替代 window.prompt，在 Tauri webview 中更可靠。
 * 弹出层让用户输入请求名称，确认后回调确认函数。
 * 键盘快捷键 Enter（确认）和 Escape（取消）由 ShortcutEngine 管理。
 */
interface SaveDialogProps {
  visible: boolean;
  defaultName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
  engine: ShortcutEngine | null;
}

export default function SaveDialog({
  visible,
  defaultName,
  onConfirm,
  onCancel,
  engine,
}: SaveDialogProps) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  // 对话框打开时声明 dialog 作用域（阻止所有全局快捷键）
  useActiveScope(visible ? "dialog" : "global", engine);

  // 对话框打开时同步默认名称并自动聚焦
  useEffect(() => {
    if (visible) {
      setName(defaultName);
      // 延迟聚焦以确保 DOM 已挂载
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible, defaultName]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-pulse-surface border border-pulse-border rounded-xl shadow-2xl w-80 p-5 space-y-4">
        {/* 标题 */}
        <h3 className="text-sm font-semibold text-pulse-text-primary">
          Save Request
        </h3>

        {/* 名称输入 */}
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter request name..."
          className="w-full bg-pulse-deepest border border-pulse-border rounded-lg px-3 py-2 text-sm font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors focus:ring-1 focus:ring-pulse-accent/40"
        />

        {/* 按钮区域 */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="btn-ghost text-xs px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={() => name.trim() && onConfirm(name.trim())}
            disabled={!name.trim()}
            className="btn-primary text-xs px-4 py-1.5"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
