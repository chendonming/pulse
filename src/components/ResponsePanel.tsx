import type { ResponseData } from "../types";
import WaterfallChart from "./WaterfallChart";
import JsonHighlighter from "./JsonHighlighter";

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
export default function ResponsePanel({
  response,
  isLoading,
  error,
  responseTab,
  onResponseTabChange,
}: ResponsePanelProps) {
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-pulse-deepest">
        <div className="text-center">
          <svg
            className="animate-spin h-8 w-8 text-pulse-accent mx-auto mb-3"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p className="text-sm text-pulse-text-muted font-mono animate-pulse-soft">
            Sending request...
          </p>
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
        <span className="text-xs text-pulse-text-muted font-mono">
          {response.timing.total_ms < 1000
            ? `${response.timing.total_ms.toFixed(0)} ms`
            : `${(response.timing.total_ms / 1000).toFixed(2)} s`}
        </span>
        <span className="text-xs text-pulse-text-muted">{response.size_label}</span>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {/* 耗时瀑布图 */}
        <WaterfallChart timing={response.timing} />

        {/* Tab：Body / Headers */}
        <div className="flex items-center gap-1 px-3 border-b border-pulse-border shrink-0">
          <button
            onClick={() => onResponseTabChange("body")}
            className={`pb-2 pt-1 px-3 text-xs font-medium transition-colors border-b-2 ${
              responseTab === "body"
                ? "text-pulse-accent border-pulse-accent"
                : "text-pulse-text-muted border-transparent hover:text-pulse-text-secondary hover:border-pulse-border"
            }`}
          >
            Body
          </button>
          <button
            onClick={() => onResponseTabChange("headers")}
            className={`pb-2 pt-1 px-3 text-xs font-medium transition-colors border-b-2 ${
              responseTab === "headers"
                ? "text-pulse-accent border-pulse-accent"
                : "text-pulse-text-muted border-transparent hover:text-pulse-text-secondary hover:border-pulse-border"
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
            <pre className="p-4 text-xs font-mono text-pulse-text-primary whitespace-pre-wrap break-all">
              <JsonHighlighter body={response.body} contentType={response.content_type} />
            </pre>
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
}
