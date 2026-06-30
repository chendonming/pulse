import { useState, useEffect, useRef } from "react";
import type { ShortcutEngine } from "../shortcuts/ShortcutEngine";
import { useActiveScope } from "../shortcuts/useActiveScope";

// ===== 自定义输入对话框，替代原生 window.prompt =====
//
// 设计语言：延续 Pulse 系列对话框的视觉体系（overlay + 表面卡片）
// 品牌签名：顶部琥珀色渐变光晕条，呼应 "Pulse" 品牌名
// 交互：Enter 确认，Escape 取消（通过 ShortcutEngine 作用域）

interface PromptDialogProps {
  visible: boolean;
  title: string;
  defaultValue: string;
  placeholder: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 确认回调，传入用户输入的最终值 */
  onConfirm: (value: string) => void;
  onCancel: () => void;
  engine: ShortcutEngine | null;
}

export default function PromptDialog({
  visible,
  title,
  defaultValue,
  placeholder,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  engine,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // 对话框打开时声明 dialog 作用域（阻止所有全局快捷键，如 Ctrl+S）
  useActiveScope(visible ? "dialog" : "global", engine);

  // 对话框打开时同步默认值并自动聚焦输入框
  useEffect(() => {
    if (visible) {
      setValue(defaultValue);
      // 延迟聚焦以确保 DOM 已挂载
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible, defaultValue]);

  // Enter 键确认（仅当输入值非空时）
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && value.trim()) {
      onConfirm(value.trim());
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-pulse-overlay animate-fade-in">
      <div className="relative bg-pulse-surface border border-pulse-border rounded-xl shadow-2xl w-80 overflow-hidden animate-slide-up">
        {/* 品牌标识：顶部淡琥珀色光晕条 —— Pulse 签名元素 */}
        <div className="h-0.5 bg-gradient-to-r from-transparent via-pulse-accent/60 to-transparent" />

        <div className="p-5 space-y-4">
          {/* 标题 */}
          <h3 className="text-sm font-semibold text-pulse-text-primary">
            {title}
          </h3>

          {/* 输入框——等宽字体贴合技术工具气质 */}
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="w-full bg-pulse-deepest border border-pulse-border rounded-lg px-3 py-2 text-sm font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors duration-150 focus:border-pulse-accent/50 focus:ring-1 focus:ring-pulse-accent/40"
          />

          {/* 按钮区域 */}
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="btn-ghost text-xs px-3 py-1.5"
            >
              {cancelLabel}
            </button>
            <button
              onClick={() => {
                const trimmed = value.trim();
                if (trimmed) onConfirm(trimmed);
              }}
              disabled={!value.trim()}
              className="btn-primary text-xs px-4 py-1.5"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
