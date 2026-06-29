// ============================================================
// 导出对话框组件
// 显示可勾选的 Collection 列表 + 格式选择（JSON/YAML），确认导出
// ============================================================

import { useState, useCallback, useRef, useEffect } from "react";

interface ExportDialogProps {
  visible: boolean;
  /** 所有 Collection（用于展示勾选列表） */
  collections: { id: string; name: string }[];
  /** 当前环境数量（用于展示） */
  environmentsCount: number;
  /** 执行导出（传入选择的格式 + 选中的 Collection ID 列表） */
  onExport: (format: "json" | "yaml", collectionIds: string[]) => void;
  /** 取消/关闭对话框 */
  onCancel: () => void;
}

export default function ExportDialog({
  visible,
  collections,
  environmentsCount,
  onExport,
  onCancel,
}: ExportDialogProps) {
  const [format, setFormat] = useState<"json" | "yaml">("json");
  /** 已勾选的 Collection ID 集合 */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const exportBtnRef = useRef<HTMLButtonElement>(null);

  // 对话框打开时重置勾选状态（默认全选）并聚焦导出按钮
  useEffect(() => {
    if (visible) {
      setSelectedIds(new Set(collections.map((c) => c.id)));
      setTimeout(() => exportBtnRef.current?.focus(), 100);
    }
  }, [visible, collections]);

  /** 切换单个 Collection 的勾选状态 */
  const toggleCollection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /** 全选 */
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(collections.map((c) => c.id)));
  }, [collections]);

  /** 取消全选 */
  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

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
      <div className="w-[400px] bg-pulse-surface border border-pulse-border rounded-xl shadow-2xl p-5 space-y-4 animate-slide-up">
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
          <p>• {collections.length} collection{collections.length !== 1 ? "s" : ""}</p>
          <p>• {environmentsCount} environment{environmentsCount !== 1 ? "s" : ""}</p>
        </div>

        {/* Collection 勾选列表 */}
        {collections.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-pulse-text-muted uppercase tracking-wider">
                Collections to export
              </p>
              <div className="flex gap-2">
                <button
                  onClick={selectAll}
                  className="text-[10px] text-pulse-accent hover:text-pulse-text-primary transition-colors"
                >
                  Select All
                </button>
                <button
                  onClick={deselectAll}
                  className="text-[10px] text-pulse-text-muted hover:text-pulse-text-secondary transition-colors"
                >
                  Deselect All
                </button>
              </div>
            </div>
            <div className="max-h-[180px] overflow-y-auto space-y-0.5 rounded-lg bg-pulse-deepest/30 p-1">
              {collections.map((col) => (
                <label
                  key={col.id}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer hover:bg-pulse-hover transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(col.id)}
                    onChange={() => toggleCollection(col.id)}
                    className="w-3.5 h-3.5 rounded border-pulse-border bg-pulse-deepest accent-pulse-accent cursor-pointer"
                  />
                  <span className="text-xs text-pulse-text-primary truncate">
                    {col.name}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

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
            onClick={() => onExport(format, Array.from(selectedIds))}
            className="btn-primary text-xs px-4 py-1.5"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
