import { useEffect, useRef } from "react";
import type { ShortcutEngine } from "../shortcuts/ShortcutEngine";
import { useActiveScope } from "../shortcuts/useActiveScope";
import type { AppSettings } from "../types";

// ============================================================
// 设置面板组件
// 提供 UI 缩放、字体族和字号设置，更改即时生效
// ============================================================

interface SettingsDialogProps {
  visible: boolean;
  settings: AppSettings;
  onUpdateSettings: (partial: Partial<AppSettings>) => void;
  onClose: () => void;
  engine: ShortcutEngine | null;
}

/** 缩放预设值列表 */
const ZOOM_PRESETS = [0.75, 0.85, 1.0, 1.15, 1.25, 1.5] as const;

/** 字体选项映射：标识 → 显示名 → CSS font-family */
const FONT_OPTIONS: { id: string; label: string; css: string }[] = [
  { id: "inter", label: "Inter", css: "Inter, system-ui, sans-serif" },
  { id: "system-ui", label: "System UI", css: "system-ui, sans-serif" },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    css: '"JetBrains Mono", monospace',
  },
];

/** 字号选项映射：标识 → 显示名 → 基础 font-size */
const FONT_SIZE_OPTIONS: { id: string; label: string; px: number }[] = [
  { id: "small", label: "Small", px: 12 },
  { id: "medium", label: "Medium", px: 14 },
  { id: "large", label: "Large", px: 16 },
];

/** 字体族标识 → CSS font-family 映射 */
export const FONT_FAMILY_MAP: Record<string, string> = Object.fromEntries(
  FONT_OPTIONS.map((f) => [f.id, f.css]),
);

/** 字号标识 → CSS font-size (px) 映射 */
export const FONT_SIZE_PX_MAP: Record<string, number> = Object.fromEntries(
  FONT_SIZE_OPTIONS.map((f) => [f.id, f.px]),
);

export default function SettingsDialog({
  visible,
  settings,
  onUpdateSettings,
  onClose,
  engine,
}: SettingsDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // 对话框打开时声明 dialog 作用域（阻止所有全局快捷键）
  useActiveScope(visible ? "dialog" : "global", engine);

  // 打开时自动聚焦面板以便捕获 Escape 按键
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => panelRef.current?.focus());
    }
  }, [visible]);

  if (!visible) return null;

  /**
   * 渲染预设选项按钮组
   * selected：当前选中值，options：可选值数组，renderLabel：值到显示文本的映射
   * onSelect：选中回调
   */
  function renderPresetGroup<T>({
    selected,
    options,
    renderLabel,
    onSelect,
  }: {
    selected: T;
    options: readonly T[];
    renderLabel: (val: T) => string;
    onSelect: (val: T) => void;
  }) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((val) => (
          <button
            key={String(val)}
            onClick={() => onSelect(val)}
            className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors duration-150 ${
              val === selected
                ? "bg-pulse-accent text-pulse-deepest"
                : "bg-pulse-elevated text-pulse-text-secondary hover:bg-pulse-hover hover:text-pulse-text-primary"
            }`}
          >
            {renderLabel(val)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in"
      onClick={onClose}
    >
      {/* 设置面板 */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-[420px] max-h-[80vh] bg-pulse-surface border border-pulse-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-pulse-border shrink-0">
          <h2 className="text-sm font-semibold text-pulse-text-primary">
            Settings
          </h2>
          <button
            onClick={onClose}
            className="btn-ghost text-xs px-2 py-1"
            aria-label="Close settings"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 设置内容区 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* ── 缩放设置 ── */}
          <section>
            <h3 className="text-[11px] font-semibold text-pulse-text-muted uppercase tracking-wider mb-2.5">
              Layout
            </h3>
            <div className="space-y-3">
              {/* 缩放 */}
              <div className="flex items-start justify-between">
                <span className="text-xs text-pulse-text-secondary mt-1">
                  Zoom
                </span>
                <div className="flex-1 max-w-[280px]">
                  {renderPresetGroup({
                    selected: settings.zoomLevel,
                    options: ZOOM_PRESETS,
                    renderLabel: (v) => `${Math.round(v * 100)}%`,
                    onSelect: (val) => onUpdateSettings({ zoomLevel: val }),
                  })}
                </div>
              </div>

              {/* 字体 */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-pulse-text-secondary">Font</span>
                <select
                  value={settings.fontFamily}
                  onChange={(e) =>
                    onUpdateSettings({ fontFamily: e.target.value })
                  }
                  className="w-36 bg-pulse-deepest border border-pulse-border rounded-lg px-2.5 py-1.5 text-xs text-pulse-text-primary focus:ring-1 focus:ring-pulse-accent/40 cursor-pointer"
                >
                  {FONT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 字号 */}
              <div className="flex items-start justify-between">
                <span className="text-xs text-pulse-text-secondary mt-1">
                  Size
                </span>
                <div className="flex-1 max-w-[280px]">
                  {renderPresetGroup({
                    selected: settings.fontSize,
                    options: FONT_SIZE_OPTIONS.map((f) => f.id),
                    renderLabel: (id) =>
                      FONT_SIZE_OPTIONS.find((f) => f.id === id)?.label ?? id,
                    onSelect: (val) => onUpdateSettings({ fontSize: val }),
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* ── 主题设置 ── */}
          <section>
            <h3 className="text-[11px] font-semibold text-pulse-text-muted uppercase tracking-wider mb-2.5">
              Theme
            </h3>
            <div className="flex items-center justify-between">
              <span className="text-xs text-pulse-text-secondary">
                Appearance
              </span>
              <div className="flex items-center gap-1 bg-pulse-deepest border border-pulse-border rounded-lg p-0.5">
                <button
                  onClick={() => onUpdateSettings({ theme: "dark" })}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                    settings.theme === "dark"
                      ? "bg-pulse-accent text-pulse-deepest shadow-sm"
                      : "text-pulse-text-muted hover:text-pulse-text-secondary"
                  }`}
                >
                  {/* 月亮图标 —— 暗色模式 */}
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                  Dark
                </button>
                <button
                  onClick={() => onUpdateSettings({ theme: "light" })}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                    settings.theme === "light"
                      ? "bg-pulse-accent text-pulse-deepest shadow-sm"
                      : "text-pulse-text-muted hover:text-pulse-text-secondary"
                  }`}
                >
                  {/* 太阳图标 —— 浅色模式 */}
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  Light
                </button>
              </div>
            </div>
          </section>

          {/* ── 预览区 ── */}
          <section>
            <h3 className="text-[11px] font-semibold text-pulse-text-muted uppercase tracking-wider mb-2.5">
              Preview
            </h3>
            <div
              className="bg-pulse-deepest border border-pulse-border rounded-lg px-4 py-3 space-y-1"
              style={{
                fontFamily: FONT_FAMILY_MAP[settings.fontFamily] || undefined,
                fontSize: `${
                  FONT_SIZE_PX_MAP[settings.fontSize] || 14
                }px`,
              }}
            >
              <p className="text-pulse-text-primary">
                The quick brown fox jumps over the lazy dog.
              </p>
              <p className="text-pulse-text-secondary">
                Aa Bb Cc 123 !@# — 敏捷的棕色狐狸跳过了懒狗。
              </p>
              <p className="text-pulse-text-muted text-[0.85em]">
                Inter / System UI / JetBrains Mono — 12px / 14px / 16px
              </p>
            </div>
          </section>
        </div>

        {/* 页脚提示 */}
        <div className="px-5 py-2.5 border-t border-pulse-border shrink-0 flex items-center justify-between">
          <span className="text-[10px] text-pulse-text-muted">
            Settings are saved automatically
          </span>
          <span className="text-[10px] text-pulse-text-muted">
            Press <kbd className="font-mono px-1 bg-pulse-deepest rounded border border-pulse-border">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
