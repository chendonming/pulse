// ============================================================
// 导出对话框组件
// 显示导出数据概览，选择格式（JSON/YAML），确认导出
// ============================================================

import { useState, useCallback, useRef, useEffect } from "react";

interface ExportDialogProps {
  visible: boolean;
  /** 当前集合数量（用于展示） */
  collectionsCount: number;
  /** 当前环境数量（用于展示） */
  environmentsCount: number;
  /** 执行导出（传入选择的格式） */
  onExport: (format: "json" | "yaml") => void;
  /** 取消/关闭对话框 */
  onCancel: () => void;
}

export default function ExportDialog({
  visible,
  collectionsCount,
  environmentsCount,
  onExport,
  onCancel,
}: ExportDialogProps) {
  const [format, setFormat] = useState<"json" | "yaml">("json");
  const exportBtnRef = useRef<HTMLButtonElement>(null);

  // 对话框打开时聚焦导出按钮
  useEffect(() => {
    if (visible) {
      setTimeout(() => exportBtnRef.current?.focus(), 100);
    }
  }, [visible]);

  // 点击浮层背景时关闭
  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onCancel();
    },
    [onCancel],
  );

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in"
      onClick={handleBackdrop}
    >
      <div className="w-[360px] bg-pulse-surface border border-pulse-border rounded-xl shadow-2xl p-5 space-y-4 animate-slide-up">
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-pulse-text-primary">
            Export Data
          </h2>
          <button
            onClick={onCancel}
            className="btn-ghost text-xs px-2 py-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 数据概览 */}
        <div className="bg-pulse-deepest/50 rounded-lg px-4 py-3 space-y-1 text-xs text-pulse-text-secondary">
          <p>• {collectionsCount} collection{collectionsCount !== 1 ? "s" : ""}</p>
          <p>• {environmentsCount} environment{environmentsCount !== 1 ? "s" : ""}</p>
        </div>

        {/* 格式选择 */}
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-pulse-text-muted uppercase tracking-wider">
            Format
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setFormat("json")}
              className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-medium transition-all ${
                format === "json"
                  ? "bg-pulse-accent text-white shadow-sm"
                  : "bg-pulse-deepest/50 text-pulse-text-muted hover:text-pulse-text-secondary hover:bg-pulse-hover border border-pulse-border/50"
              }`}
            >
              JSON
            </button>
            <button
              onClick={() => setFormat("yaml")}
              className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-medium transition-all ${
                format === "yaml"
                  ? "bg-pulse-accent text-white shadow-sm"
                  : "bg-pulse-deepest/50 text-pulse-text-muted hover:text-pulse-text-secondary hover:bg-pulse-hover border border-pulse-border/50"
              }`}
            >
              YAML
            </button>
          </div>
        </div>

        {/* 提示 */}
        <p className="text-[10px] text-pulse-text-muted">
          File will be saved via native save dialog
        </p>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="btn-ghost text-xs px-4 py-1.5">
            Cancel
          </button>
          <button
            ref={exportBtnRef}
            onClick={() => onExport(format)}
            className="btn-primary text-xs px-4 py-1.5"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
