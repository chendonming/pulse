/**
 * Toast 通知组件
 */
import { useState, useEffect, useCallback } from "react";

export interface ToastItem {
  id: string;
  type: "success" | "error" | "info" | "warning";
  message: string;
  action?: { label: string; onClick: () => void };
  duration?: number; // 默认 3000ms，0 = 常驻手动关闭
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

/** 根据类型返回图标 SVG */
function ToastIcon({ type }: { type: ToastItem["type"] }) {
  const paths: Record<ToastItem["type"], { circle: string; path: string }> = {
    success: {
      circle: "text-pulse-emerald",
      path: "M5 13l4 4L19 7",
    },
    error: {
      circle: "text-pulse-rose",
      path: "M6 18L18 6M6 6l12 12",
    },
    info: {
      circle: "text-pulse-blue",
      path: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    warning: {
      circle: "text-pulse-amber",
      path: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z",
    },
  };
  const icon = paths[type];
  return (
    <svg className={`w-4 h-4 shrink-0 ${icon.circle}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon.path} />
    </svg>
  );
}

/** 左边框颜色映射 */
const borderColor: Record<ToastItem["type"], string> = {
  success: "border-l-pulse-emerald",
  error: "border-l-pulse-rose",
  info: "border-l-pulse-blue",
  warning: "border-l-pulse-amber",
};

/** 单个 Toast 条目 */
function ToastEntry({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const [leaving, setLeaving] = useState(false);

  // 定时自动关闭
  useEffect(() => {
    if (toast.duration === 0) return;
    const timer = setTimeout(() => {
      setLeaving(true);
      setTimeout(() => onDismiss(toast.id), 200);
    }, toast.duration ?? 3000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  const handleDismiss = useCallback(() => {
    setLeaving(true);
    setTimeout(() => onDismiss(toast.id), 200);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`flex items-start gap-2.5 px-3 py-2.5 bg-pulse-surface border border-pulse-border rounded-lg shadow-2xl border-l-4 ${borderColor[toast.type]} min-w-[280px] max-w-[400px] pointer-events-auto ${
        leaving ? "opacity-0 transition-opacity duration-200" : "animate-slide-up"
      }`}
    >
      <ToastIcon type={toast.type} />
      <p className="flex-1 text-xs text-pulse-text-primary leading-relaxed">{toast.message}</p>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.onClick();
            handleDismiss();
          }}
          className="shrink-0 text-[11px] font-medium text-pulse-accent hover:text-pulse-accent-soft transition-colors"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={handleDismiss}
        className="shrink-0 text-pulse-text-muted hover:text-pulse-text-secondary transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Toast 容器（固定定位，渲染在应用右上角）
 */
export default function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <ToastEntry key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
