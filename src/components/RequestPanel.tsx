import { useRef, useEffect, useState } from "react";
import type { HeaderInput, RequestTab, HttpMethod, AuthType } from "../types";
import AuthPanel from "./AuthPanel";

/**
 * 请求面板属性
 * 所有状态由 usePulse() hook 通过 props 传入（无 Context/Redux）
 */
interface RequestPanelProps {
  method: HttpMethod;
  onMethodChange: (m: HttpMethod) => void;
  url: string;
  onUrlChange: (u: string) => void;
  headers: HeaderInput[];
  onAddHeader: () => void;
  onUpdateHeader: (i: number, f: keyof HeaderInput, v: string | boolean) => void;
  onRemoveHeader: (i: number) => void;
  body: string;
  onBodyChange: (b: string) => void;
  contentType: string;
  onContentTypeChange: (ct: string) => void;
  isLoading: boolean;
  onSend: () => void;
  onSave: () => void;
  editingRequest: { collectionId: string; requestId: string } | null;
  editingCollectionName: string | null;
  authType: AuthType;
  onAuthTypeChange: (t: AuthType) => void;
  bearerToken: string;
  onBearerTokenChange: (t: string) => void;
  rawParams: HeaderInput[];
  onAddParam: () => void;
  onUpdateParam: (i: number, f: keyof HeaderInput, v: string | boolean) => void;
  onRemoveParam: (i: number) => void;
}

/** 支持的 HTTP 方法列表 */
const METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

/** 方法选择器每项的颜色映射 */
const methodSelectColors: Record<string, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  PUT: "text-method-put",
  PATCH: "text-method-patch",
  DELETE: "text-method-delete",
  HEAD: "text-method-head",
  OPTIONS: "text-method-get",
};

/** 支持的 Content-Type 下拉选项 */
const CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "text/plain",
  "application/xml",
  "text/html",
];

/**
 * 请求面板（顶部区域）
 *
 * 包含：
 * - URL 栏（方法选择器 + URL 输入框 + 保存按钮 + 发送按钮）
 * - 四个配置 Tab：Auth / Params / Headers / Body
 *
 * 支持快捷键 Ctrl+Enter（或 Cmd+Enter）快速发送请求
 */
export default function RequestPanel({
  method,
  onMethodChange,
  url,
  onUrlChange,
  headers,
  onAddHeader,
  onUpdateHeader,
  onRemoveHeader,
  body,
  onBodyChange,
  contentType,
  onContentTypeChange,
  isLoading,
  onSend,
  onSave,
  editingRequest,
  editingCollectionName,
  authType,
  onAuthTypeChange,
  bearerToken,
  onBearerTokenChange,
  rawParams,
  onAddParam,
  onUpdateParam,
  onRemoveParam,
}: RequestPanelProps) {
  const urlRef = useRef<HTMLInputElement>(null);

  // 请求面板 Tab 状态（局部状态，避免切换 Tab 时触发 App 级重渲染）
  const [requestTab, setRequestTab] = useState<RequestTab>("headers");

  // 注册全局键盘快捷键：Ctrl+Enter 发送请求
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        onSend();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onSend]);

  return (
    <div className="shrink-0 border-b border-pulse-border bg-pulse-surface">
      {/* URL 栏：方法选择器 + URL 输入 + 保存 + 发送 */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* HTTP 方法下拉选择器 */}
        <div className="relative">
          <select
            value={method}
            onChange={(e) => onMethodChange(e.target.value as HttpMethod)}
            className={`appearance-none bg-pulse-deepest border border-pulse-border rounded-lg px-3 py-1.5 pr-7 text-sm font-mono font-bold ${methodSelectColors[method]} cursor-pointer hover:border-pulse-accent/40 transition-colors focus:ring-1 focus:ring-pulse-accent/40`}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <svg
            className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-pulse-text-muted pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>

        {/* URL 输入框（支持 Enter 快捷发送） */}
        <div className="flex-1 relative">
          <input
            ref={urlRef}
            type="text"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="Enter request URL or paste a cURL command..."
            className="w-full bg-pulse-deepest border border-pulse-border rounded-lg px-3 py-1.5 pr-10 text-sm font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors focus:ring-1 focus:ring-pulse-accent/40"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isLoading) onSend();
            }}
          />
          {/* URL 清空按钮 */}
          {url && (
            <button
              onClick={() => onUrlChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-pulse-text-muted hover:text-pulse-text-secondary transition-colors"
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
          )}
        </div>

        {/* 保存到集合按钮 */}
        <button
          onClick={onSave}
          disabled={isLoading}
          title={editingRequest ? "Update request in collection" : "Save to collection"}
          className="btn-ghost min-w-[70px] justify-center text-xs gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
          {editingRequest ? "Update" : "Save"}
        </button>

        {/* 发送按钮（加载中显示旋转动画） */}
        <button
          onClick={onSend}
          disabled={isLoading || !url.trim()}
          className="btn-primary min-w-[80px] justify-center"
        >
          {isLoading ? (
            <>
              <svg
                className="animate-spin -ml-1 h-4 w-4"
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
              Sending
            </>
          ) : (
            <>
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
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
              Send
            </>
          )}
        </button>
      </div>

      {/* 配置 Tab：Auth / Params / Headers / Body */}
      <div className="flex items-center gap-1 px-3">
        <button
          onClick={() => setRequestTab("auth")}
          className={`pb-2 pt-1 px-3 text-xs font-medium transition-colors border-b-2 ${
            requestTab === "auth"
              ? "text-pulse-accent border-pulse-accent"
              : "text-pulse-text-muted border-transparent hover:text-pulse-text-secondary hover:border-pulse-border"
          }`}
        >
          Auth
          {authType === "bearer" && (
            <span className="ml-1.5 px-1 py-0.5 text-[10px] rounded bg-pulse-accent/10 text-pulse-accent">
              Bearer
            </span>
          )}
          {authType === "inherit" && editingCollectionName && (
            <span className="ml-1.5 px-1 py-0.5 text-[10px] rounded bg-pulse-indigo/10 text-pulse-indigo">
              Inherit
            </span>
          )}
        </button>
        <button
          onClick={() => setRequestTab("params")}
          className={`pb-2 pt-1 px-3 text-xs font-medium transition-colors border-b-2 ${
            requestTab === "params"
              ? "text-pulse-accent border-pulse-accent"
              : "text-pulse-text-muted border-transparent hover:text-pulse-text-secondary hover:border-pulse-border"
          }`}
        >
          Params
          {rawParams.some((p) => p.key.trim()) && (
            <span className="ml-1.5 px-1 py-0.5 text-[10px] rounded bg-pulse-accent/10 text-pulse-accent">
              {rawParams.filter((p) => p.key.trim()).length}
            </span>
          )}
        </button>
        <button
          onClick={() => setRequestTab("headers")}
          className={`pb-2 pt-1 px-3 text-xs font-medium transition-colors border-b-2 ${
            requestTab === "headers"
              ? "text-pulse-accent border-pulse-accent"
              : "text-pulse-text-muted border-transparent hover:text-pulse-text-secondary hover:border-pulse-border"
          }`}
        >
          Headers
          {headers.some((h) => h.key.trim()) && (
            <span className="ml-1.5 px-1 py-0.5 text-[10px] rounded bg-pulse-accent/10 text-pulse-accent">
              {headers.filter((h) => h.key.trim()).length}
            </span>
          )}
        </button>
        <button
          onClick={() => setRequestTab("body")}
          className={`pb-2 pt-1 px-3 text-xs font-medium transition-colors border-b-2 ${
            requestTab === "body"
              ? "text-pulse-accent border-pulse-accent"
              : "text-pulse-text-muted border-transparent hover:text-pulse-text-secondary hover:border-pulse-border"
          }`}
        >
          Body
          {body && (
            <span className="ml-1.5 px-1 py-0.5 text-[10px] rounded bg-pulse-accent/10 text-pulse-accent">
              ●
            </span>
          )}
        </button>
      </div>

      {/* Tab 内容区域 */}
      <div className="max-h-52 overflow-y-auto border-t border-pulse-border">
        {/* Auth Tab */}
        {requestTab === "auth" && (
          <AuthPanel
            authType={authType}
            onAuthTypeChange={onAuthTypeChange}
            bearerToken={bearerToken}
            onBearerTokenChange={onBearerTokenChange}
            editingCollectionName={editingCollectionName}
          />
        )}

        {/* Params Tab：Key-Value 编辑器 */}
        {requestTab === "params" && (
          <div className="p-2 space-y-1">
            <div className="grid grid-cols-[1fr_1fr_24px] gap-1.5 text-[11px] text-pulse-text-muted font-medium px-2 pb-1">
              <span>Key</span>
              <span>Value</span>
            </div>
            {rawParams.map((param, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_24px] gap-1.5 items-center">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onUpdateParam(i, "enabled", !param.enabled)}
                    className={`shrink-0 w-3.5 h-3.5 rounded border ${
                      param.enabled
                        ? "bg-pulse-accent border-pulse-accent"
                        : "bg-pulse-deepest border-pulse-border"
                    } flex items-center justify-center transition-colors`}
                  >
                    {param.enabled && (
                      <svg
                        className="w-2.5 h-2.5 text-pulse-deepest"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </button>
                  <input
                    type="text"
                    value={param.key}
                    onChange={(e) =>
                      onUpdateParam(i, "key", e.target.value)
                    }
                    placeholder="Parameter name"
                    className="flex-1 bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
                  />
                </div>
                <input
                  type="text"
                  value={param.value}
                  onChange={(e) =>
                    onUpdateParam(i, "value", e.target.value)
                  }
                  placeholder="Value"
                  className="bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
                />
                <button
                  onClick={() => onRemoveParam(i)}
                  className="text-pulse-text-muted hover:text-pulse-rose transition-colors p-0.5"
                >
                  <svg
                    className="w-3.5 h-3.5"
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
            ))}
            <button
              onClick={onAddParam}
              className="btn-ghost text-xs w-full justify-center py-1"
            >
              + Add parameter
            </button>
          </div>
        )}

        {/* Headers Tab：Key-Value 编辑器 */}
        {requestTab === "headers" && (
          <div className="p-2 space-y-1">
            <div className="grid grid-cols-[1fr_1fr_24px] gap-1.5 text-[11px] text-pulse-text-muted font-medium px-2 pb-1">
              <span>Key</span>
              <span>Value</span>
            </div>
            {headers.map((header, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_24px] gap-1.5 items-center">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onUpdateHeader(i, "enabled", !header.enabled)}
                    className={`shrink-0 w-3.5 h-3.5 rounded border ${
                      header.enabled
                        ? "bg-pulse-accent border-pulse-accent"
                        : "bg-pulse-deepest border-pulse-border"
                    } flex items-center justify-center transition-colors`}
                  >
                    {header.enabled && (
                      <svg
                        className="w-2.5 h-2.5 text-pulse-deepest"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </button>
                  <input
                    type="text"
                    value={header.key}
                    onChange={(e) =>
                      onUpdateHeader(i, "key", e.target.value)
                    }
                    placeholder="Header name"
                    className="flex-1 bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
                  />
                </div>
                <input
                  type="text"
                  value={header.value}
                  onChange={(e) =>
                    onUpdateHeader(i, "value", e.target.value)
                  }
                  placeholder="Value"
                  className="bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
                />
                <button
                  onClick={() => onRemoveHeader(i)}
                  className="text-pulse-text-muted hover:text-pulse-rose transition-colors p-0.5"
                >
                  <svg
                    className="w-3.5 h-3.5"
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
            ))}
            <button
              onClick={onAddHeader}
              className="btn-ghost text-xs w-full justify-center py-1"
            >
              + Add header
            </button>
          </div>
        )}

        {/* Body Tab：Content-Type 选择 + 请求体文本域 */}
        {requestTab === "body" && (
          <div className="p-2 space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={contentType}
                onChange={(e) => onContentTypeChange(e.target.value)}
                className="bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary cursor-pointer transition-colors"
              >
                {CONTENT_TYPES.map((ct) => (
                  <option key={ct} value={ct}>
                    {ct}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              placeholder="Request body (raw)"
              className="w-full h-28 bg-pulse-deepest border border-pulse-border rounded-lg px-3 py-2 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 resize-none transition-colors"
              spellCheck={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
