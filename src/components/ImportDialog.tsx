// ============================================================
// 导入对话框组件
// 支持选取文件 → 预览摘要 → 选择合并策略 → 确认导入
// ============================================================

import { useCallback, useRef, useEffect } from "react";
import type { ImportPreview, ImportExportStrategy } from "../types";

interface ImportDialogProps {
  visible: boolean;
  /** 导入文件预览摘要信息（选取文件后获取） */
  preview: ImportPreview | null;
  /** 选中的文件名（显示用） */
  fileName: string;
  /** 导入合并策略 */
  strategy: ImportExportStrategy;
  /** 是否已选取了文件 */
  hasPending: boolean;
  /** 错误信息（解析失败、版本不匹配等） */
  error: string | null;
  /** 切换合并策略 */
  onStrategyChange: (s: ImportExportStrategy) => void;
  /** 点击"选择文件"按钮 */
  onPickFile: () => void;
  /** 确认导入 */
  onConfirm: () => void;
  /** 取消/关闭对话框 */
  onCancel: () => void;
}

export default function ImportDialog({
  visible,
  preview,
  fileName,
  strategy,
  hasPending,
  error,
  onStrategyChange,
  onPickFile,
  onConfirm,
  onCancel,
}: ImportDialogProps) {
  // 自动聚焦到"选择文件"按钮
  const pickBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (visible) {
      setTimeout(() => pickBtnRef.current?.focus(), 100);
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
      <div className="w-[400px] bg-pulse-surface border border-pulse-border rounded-xl shadow-2xl p-5 space-y-4 animate-slide-up">
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-pulse-text-primary">
            Import Data
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

        {/* 第一步：选取文件 */}
        <div>
          <button
            ref={pickBtnRef}
            onClick={onPickFile}
            className="w-full flex items-center gap-2.5 px-4 py-3 rounded-lg border border-pulse-border border-dashed hover:border-pulse-accent/50 hover:bg-pulse-hover transition-colors text-xs text-pulse-text-muted hover:text-pulse-text-secondary group"
          >
            <svg className="w-5 h-5 shrink-0 text-pulse-text-muted/60 group-hover:text-pulse-accent/60 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>{fileName || "Select File (.json, .yaml, .yml)"}</span>
          </button>
        </div>

        {/* 文件名和预览摘要（选取文件后显示） */}
        {hasPending && preview && (
          <div className="bg-pulse-deepest/50 rounded-lg px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-pulse-text-muted">File:</span>
              <span className="text-pulse-text-primary font-medium truncate">{fileName}</span>
              <span className="px-1.5 py-0.5 rounded bg-pulse-hover text-[10px] text-pulse-text-muted">
                {fileName.endsWith(".yaml") || fileName.endsWith(".yml") ? "YAML" : "JSON"}
              </span>
            </div>
            <div className="text-xs text-pulse-text-secondary space-y-0.5">
              <p>• {preview.collections_count} collection{preview.collections_count !== 1 ? "s" : ""}</p>
              <p>• {preview.environments_count} environment{preview.environments_count !== 1 ? "s" : ""}</p>
            </div>
          </div>
        )}

        {/* 策略选择（选取文件后显示） */}
        {hasPending && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium text-pulse-text-muted uppercase tracking-wider">
              Import strategy
            </p>
            <div className="space-y-1.5">
              <label
                className={`flex items-start gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  strategy === "replace"
                    ? "bg-pulse-accent/10 border border-pulse-accent/30"
                    : "bg-pulse-deepest/30 border border-transparent hover:bg-pulse-hover"
                }`}
              >
                <input
                  type="radio"
                  name="strategy"
                  value="replace"
                  checked={strategy === "replace"}
                  onChange={() => onStrategyChange("replace")}
                  className="mt-0.5 accent-pulse-accent"
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-pulse-text-primary">Replace all data</p>
                  <p className="text-[10px] text-pulse-text-muted mt-0.5">
                    Existing collections and environments will be overwritten
                  </p>
                </div>
              </label>
              <label
                className={`flex items-start gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  strategy === "merge"
                    ? "bg-pulse-accent/10 border border-pulse-accent/30"
                    : "bg-pulse-deepest/30 border border-transparent hover:bg-pulse-hover"
                }`}
              >
                <input
                  type="radio"
                  name="strategy"
                  value="merge"
                  checked={strategy === "merge"}
                  onChange={() => onStrategyChange("merge")}
                  className="mt-0.5 accent-pulse-accent"
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-pulse-text-primary">Merge with existing</p>
                  <p className="text-[10px] text-pulse-text-muted mt-0.5">
                    Matching IDs will be overwritten, new items appended
                  </p>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="px-3 py-2 rounded-lg bg-pulse-rose/10 border border-pulse-rose/20 text-xs text-pulse-rose">
            {error}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="btn-ghost text-xs px-4 py-1.5">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!hasPending}
            className="btn-primary text-xs px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
