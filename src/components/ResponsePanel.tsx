import { memo, useState } from "react";
import type { ResponseData } from "../types";
import WaterfallChart from "./WaterfallChart";
import JsonViewer from "./JsonViewer";

interface ResponsePanelProps {
  response: ResponseData | null;
  isLoading: boolean;
  error: string | null;
  responseTab: "body" | "headers";
  onResponseTabChange: (t: "body" | "headers") => void;
}

/** 根据 HTTP 状态码返回对应的 Badge 颜色 */
function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return "bg-pulse-emerald text-pulse-deepest";
  if (status >= 300 && status < 400) return "bg-pulse-blue text-pulse-deepest";
  if (status >= 400 && status < 500) return "bg-pulse-amber text-pulse-deepest";
  return "bg-pulse-rose text-white";
}

/** 根据 HTTP 状态码返回状态条颜色 */
function getStatusBarColor(status: number): string {
  if (status >= 200 && status < 300) return "bg-pulse-emerald";
  if (status >= 300 && status < 400) return "bg-pulse-blue";
  if (status >= 400 && status < 500) return "bg-pulse-amber";
  return "bg-pulse-rose";
}

/**
 * 响应面板
 *
 * 四种显示状态：
 * 1. 加载中（Loading）→ 旋转动画 + "Sending request..."
 * 2. 出错（Error）→ 警告图标 + 错误信息
 * 3. 空（Empty）→ "Ready to send a request" 引导提示
 * 4. 有响应 → 状态栏 + 瀑布图 + Body/Headers 双 Tab
 */
export default memo(function ResponsePanel({
  response,
  isLoading,
  error,
  responseTab,
  onResponseTabChange,
}: ResponsePanelProps) {
  // 瀑布图折叠状态
  const [waterfallCollapsed, setWaterfallCollapsed] = useState(false);
  if (isLoading) {
    return (
      <div className="h-full flex flex-col bg-pulse-deepest animate-fade-in">
        {/* 状态栏骨架 */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-pulse-border bg-pulse-surface">
          <div className="h-5 w-28 rounded bg-pulse-elevated animate-pulse-soft" />
          <div className="h-4 w-16 rounded bg-pulse-elevated animate-pulse-soft" />
          <div className="h-4 w-12 rounded bg-pulse-elevated animate-pulse-soft" />
        </div>
        {/* 瀑布图骨架 */}
        <div className="px-4 py-2.5 border-b border-pulse-border space-y-2">
          <div className="h-3 w-28 rounded bg-pulse-elevated animate-pulse-soft" />
          {[90, 65, 80, 45, 30].map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-3 w-12 rounded bg-pulse-elevated animate-pulse-soft" />
              <div
                className="h-4 rounded bg-pulse-elevated animate-pulse-soft"
                style={{ width: `${w}%`, animationDelay: `${i * 80}ms` }}
              />
            </div>
          ))}
        </div>
        {/* Body 骨架 */}
        <div className="flex-1 p-4 space-y-2">
          {[85, 92, 78, 60, 95, 70, 88].map((w, i) => (
            <div
              key={i}
              className="h-3 rounded bg-pulse-elevated animate-pulse-soft"
              style={{ width: `${w}%`, animationDelay: `${(i + 5) * 80}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-pulse-deepest">
        <div className="max-w-md text-center px-6 animate-fade-in">
          <div className="w-10 h-10 rounded-full bg-pulse-rose/10 flex items-center justify-center mx-auto mb-3">
            <svg
              className="w-5 h-5 text-pulse-rose"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-pulse-rose mb-1">
            Request Failed
          </p>
          <p className="text-xs text-pulse-text-muted font-mono break-all">
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="h-full flex items-center justify-center bg-pulse-deepest">
        <div className="text-center animate-fade-in">
          <div className="w-12 h-12 rounded-full bg-pulse-elevated flex items-center justify-center mx-auto mb-3">
            <svg
              className="w-6 h-6 text-pulse-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
          </div>
          <p className="text-sm text-pulse-text-muted">
            Ready to send a request
          </p>
          <p className="text-xs text-pulse-text-muted/60 mt-1">
            Press Ctrl+Enter to send
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-pulse-deepest animate-fade-in">
      {/* 状态栏：状态码 + 耗时 + 大小 */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-pulse-border bg-pulse-surface shrink-0">
        <div className="flex items-center gap-2">
          <span
            className={`badge font-mono font-semibold text-xs ${getStatusColor(response.status)}`}
          >
            {response.status} {response.status_text}
          </span>
          <div
            className={`h-1.5 w-1.5 rounded-full ${getStatusBarColor(response.status)}`}
          />
        </div>
        {/* 响应时间 —— 点击可折叠/展开瀑布图 */}
        <button
          onClick={() => setWaterfallCollapsed(!waterfallCollapsed)}
          className="flex items-center gap-1 text-xs text-pulse-text-muted font-mono hover:text-pulse-text-secondary transition-colors"
          title={waterfallCollapsed ? "展开瀑布图" : "折叠瀑布图"}
        >
          <svg
            className={`w-3 h-3 transition-transform duration-200 ${waterfallCollapsed ? "-rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          {response.timing.total_ms < 1000
            ? `${response.timing.total_ms.toFixed(0)} ms`
            : `${(response.timing.total_ms / 1000).toFixed(2)} s`}
        </button>
        <span className="text-xs text-pulse-text-muted">{response.size_label}</span>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {/* 耗时瀑布图（可折叠） */}
        {!waterfallCollapsed && <WaterfallChart timing={response.timing} />}

        {/* Tab：Body / Headers */}
        <div className="flex items-center gap-1 px-3 border-b border-pulse-border shrink-0">
          <button
            onClick={() => onResponseTabChange("body")}
            className={`pb-2 pt-1 px-3 text-xs font-medium transition-all duration-150 border-b-2 ${
              responseTab === "body"
                ? "text-pulse-accent border-pulse-accent bg-pulse-accent/[0.04]"
                : "text-pulse-text-muted border-transparent hover:text-pulse-text-secondary hover:border-pulse-border hover:bg-pulse-hover/50"
            }`}
          >
            Body
          </button>
          <button
            onClick={() => onResponseTabChange("headers")}
            className={`pb-2 pt-1 px-3 text-xs font-medium transition-all duration-150 border-b-2 ${
              responseTab === "headers"
                ? "text-pulse-accent border-pulse-accent bg-pulse-accent/[0.04]"
                : "text-pulse-text-muted border-transparent hover:text-pulse-text-secondary hover:border-pulse-border hover:bg-pulse-hover/50"
            }`}
          >
            Headers
            <span className="ml-1.5 text-[10px] text-pulse-text-muted">
              ({Object.keys(response.headers).length})
            </span>
          </button>
        </div>

        {/* Tab 内容 */}
        <div className="flex-1 overflow-auto">
          {responseTab === "body" ? (
            <JsonViewer body={response.body} contentType={response.content_type} />
          ) : (
            <div className="p-3 space-y-1">
              {Object.entries(response.headers).map(([key, value]) => (
                <div
                  key={key}
                  className="grid grid-cols-[200px_1fr] gap-3 text-xs py-1 px-2 rounded hover:bg-pulse-hover transition-colors"
                >
                  <span className="font-mono font-medium text-pulse-accent truncate">
                    {key}
                  </span>
                  <span className="font-mono text-pulse-text-secondary break-all">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
})
