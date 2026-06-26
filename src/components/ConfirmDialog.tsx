import { useEffect, useRef } from "react";
import type { ShortcutEngine } from "../shortcuts/ShortcutEngine";
import { useActiveScope } from "../shortcuts/useActiveScope";

/**
 * 确认对话框（用于删除等危险操作）
 */
interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;    // 默认 "Delete"
  cancelLabel?: string;     // 默认 "Cancel"
  variant?: "danger" | "default"; // 默认 "danger"
  onConfirm: () => void;
  onCancel: () => void;
  engine: ShortcutEngine | null;
}

export default function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel,
  engine,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // 对话框打开时声明 dialog 作用域（阻止所有全局快捷键）
  useActiveScope(visible ? "dialog" : "global", engine);

  // 自动聚焦确认按钮
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => confirmRef.current?.focus());
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in">
      <div className="bg-pulse-surface border border-pulse-border rounded-xl shadow-2xl w-80 p-5 space-y-4">
        {/* 标题 */}
        <h3 className="text-sm font-semibold text-pulse-text-primary">{title}</h3>

        {/* 消息 */}
        <p className="text-xs text-pulse-text-secondary leading-relaxed">{message}</p>

        {/* 按钮区域 */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="btn-ghost text-xs px-3 py-1.5"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 ${
              variant === "danger"
                ? "bg-pulse-rose text-white hover:bg-pulse-rose/80"
                : "btn-primary"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
