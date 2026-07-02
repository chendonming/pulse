import { useRef } from "react";
import type { HeaderInput, FormDataEntry, RequestTab, HttpMethod, AuthType, ExtractRule } from "../types";
import AuthPanel from "./AuthPanel";
import JsonEditor from "./JsonEditor";

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
  /** 请求体键值对（用于 application/x-www-form-urlencoded 类型） */
  bodyParams: HeaderInput[];
  onAddBodyParam: () => void;
  onUpdateBodyParam: (i: number, f: keyof HeaderInput, v: string | boolean) => void;
  onRemoveBodyParam: (i: number) => void;
  /** multipart/form-data 条目列表 */
  bodyFormData: FormDataEntry[];
  onAddFormDataField: () => void;
  onUpdateFormDataField: (i: number, f: keyof FormDataEntry, v: string | boolean) => void;
  onRemoveFormDataField: (i: number) => void;
  onToggleFormDataType: (i: number) => void;
  onPickFormFile: (i: number) => void;
  contentType: string;
  onContentTypeChange: (ct: string) => void;
  isLoading: boolean;
  onSend: () => void;
  onSave: () => void;
  editingRequest: { collectionId: string; requestId: string } | null;
  editingCollectionName: string | null;
  requestName: string | null;
  isDirty: boolean;
  onShowCollectionContext: () => void;
  authType: AuthType;
  onAuthTypeChange: (t: AuthType) => void;
  bearerToken: string;
  onBearerTokenChange: (t: string) => void;
  rawParams: HeaderInput[];
  onAddParam: () => void;
  onUpdateParam: (i: number, f: keyof HeaderInput, v: string | boolean) => void;
  onRemoveParam: (i: number) => void;
  requestTab: RequestTab;
  onRequestTabChange: (tab: RequestTab) => void;
  flashCommand: string | null;
  shortcutHints: { commandId: string; label: string }[];
  /** "dark" | "light" 主题，传递给 JsonEditor */
  theme: string;
  /** 断言表达式列表 */
  assertions: string[];
  onAddAssertion: () => void;
  onUpdateAssertion: (i: number, v: string) => void;
  onRemoveAssertion: (i: number) => void;
  /** 响应提取规则列表 */
  extract: ExtractRule[];
  onAddExtractRule: () => void;
  onUpdateExtractRule: (i: number, f: keyof ExtractRule, v: string) => void;
  onRemoveExtractRule: (i: number) => void;
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
  "multipart/form-data",
  "text/plain",
  "application/xml",
  "text/html",
];

/**
 * 请求面板（顶部区域）
 *
 * 包含：
 * - URL 栏（方法选择器 + URL 输入框 + 保存按钮 + 发送按钮）
 * - 五个配置 Tab：Auth / Params / Headers / Body / Tests
 *
 * 快捷键 Ctrl+Enter（或 Cmd+Enter）由 ShortcutEngine 统一管理
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
  bodyParams,
  onAddBodyParam,
  onUpdateBodyParam,
  onRemoveBodyParam,
  bodyFormData,
  onAddFormDataField,
  onUpdateFormDataField,
  onRemoveFormDataField,
  onToggleFormDataType,
  onPickFormFile,
  contentType,
  onContentTypeChange,
  isLoading,
  onSend,
  onSave,
  editingRequest,
  editingCollectionName,
  requestName,
  isDirty,
  onShowCollectionContext,
  authType,
  onAuthTypeChange,
  bearerToken,
  onBearerTokenChange,
  rawParams,
  onAddParam,
  onUpdateParam,
  onRemoveParam,
  requestTab,
  onRequestTabChange,
  flashCommand,
  shortcutHints,
  theme,
  assertions,
  onAddAssertion,
  onUpdateAssertion,
  onRemoveAssertion,
  extract,
  onAddExtractRule,
  onUpdateExtractRule,
  onRemoveExtractRule,
}: RequestPanelProps) {
  const urlRef = useRef<HTMLInputElement>(null);

  return (
    <div className="border-b border-pulse-border bg-pulse-surface">
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
            id="request-url-input"
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

        {/* 集合上下文徽标：显示当前请求所属的集合名称 */}
        {editingCollectionName && (
          <button
            onClick={onShowCollectionContext}
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md
                       bg-pulse-accent/10 text-pulse-accent text-[11px] font-medium
                       hover:bg-pulse-accent/20 transition-colors"
            title={`所属集合: ${editingCollectionName}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="max-w-[120px] truncate">{editingCollectionName}</span>
          </button>
        )}

        {/* 保存到集合按钮 */}
        <button
          onClick={onSave}
          disabled={isLoading}
          title={editingRequest ? "Update request in collection" : "Save to collection"}
          className={`btn-ghost min-w-[70px] justify-center text-xs gap-1 relative active:scale-[0.96] transition-transform duration-75 ${flashCommand === 'saveRequest' ? 'flash-key' : ''}`}
        >
          {/* 脏状态指示点：当有未保存更改时显示 */}
          {isDirty && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-pulse-accent
                           animate-pulse-soft shadow-[0_0_4px_rgba(240,180,41,0.5)]" />
          )}
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
          {editingRequest ? "Update" : "Save"}
        </button>

        {/* 发送按钮（加载中显示旋转动画） */}
        <button
          onClick={onSend}
          disabled={isLoading || !url.trim()}
          className={`btn-primary min-w-[80px] justify-center active:scale-[0.96] transition-transform duration-75 ${flashCommand === 'sendRequest' ? 'flash-key' : ''}`}
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
        {/* 快捷键提示标签 */}
        {shortcutHints.find((h) => h.commandId === "sendRequest") && (
          <kbd className="hidden sm:inline-flex text-[10px] font-mono text-pulse-text-muted/50
                         px-1.5 py-0.5 rounded border border-pulse-border/30 bg-pulse-deepest/50">
            {shortcutHints.find((h) => h.commandId === "sendRequest")!.label}
          </kbd>
        )}
      </div>

      {/* 面包屑导航：当前请求的位置路径 */}
      <div className="flex items-center gap-1 px-3 pb-1 text-[11px] text-pulse-text-muted">
        <span className="text-pulse-text-muted/60">Requests</span>
        <svg className="w-2.5 h-2.5 text-pulse-text-muted/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {editingCollectionName ? (
          <>
            <button
              onClick={onShowCollectionContext}
              className="text-pulse-accent hover:underline truncate max-w-[120px]"
            >
              {editingCollectionName}
            </button>
            <svg className="w-2.5 h-2.5 text-pulse-text-muted/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </>
        ) : null}
        <span className={`truncate max-w-[180px] ${requestName ? 'text-pulse-text-secondary' : 'text-pulse-text-muted italic'}`}>
          {requestName ?? (url ? "Unsaved Request" : "New Request")}
        </span>
      </div>

      {/* 配置 Tab：Auth / Params / Headers / Body */}
      <div className="flex items-center gap-1 px-3">
        <button
          onClick={() => onRequestTabChange("auth")}
          className={`pb-2 pt-1 px-3 text-xs font-medium transition-all duration-150 border-b-2 ${
            requestTab === "auth"
              ? "text-pulse-accent border-pulse-accent bg-pulse-accent/[0.04]"
              : "text-pulse-text-muted border-transparent hover:text-pulse-text-secondary hover:border-pulse-border hover:bg-pulse-hover/50"
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
          onClick={() => onRequestTabChange("params")}
          className={`pb-2 pt-1 px-3 text-xs font-medium transition-all duration-150 border-b-2 ${
            requestTab === "params"
              ? "text-pulse-accent border-pulse-accent bg-pulse-accent/[0.04]"
              : "text-pulse-text-muted border-transparent hover:text-pulse-text-secondary hover:border-pulse-border hover:bg-pulse-hover/50"
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
          onClick={() => onRequestTabChange("headers")}
          className={`pb-2 pt-1 px-3 text-xs font-medium transition-all duration-150 border-b-2 ${
            requestTab === "headers"
              ? "text-pulse-accent border-pulse-accent bg-pulse-accent/[0.04]"
              : "text-pulse-text-muted border-transparent hover:text-pulse-text-secondary hover:border-pulse-border hover:bg-pulse-hover/50"
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
          onClick={() => onRequestTabChange("body")}
          className={`pb-2 pt-1 px-3 text-xs font-medium transition-all duration-150 border-b-2 ${
            requestTab === "body"
              ? "text-pulse-accent border-pulse-accent bg-pulse-accent/[0.04]"
              : "text-pulse-text-muted border-transparent hover:text-pulse-text-secondary hover:border-pulse-border hover:bg-pulse-hover/50"
          }`}
        >
          Body
          {(body || bodyParams.some((p) => p.key.trim())) && (
            <span className="ml-1.5 px-1 py-0.5 text-[10px] rounded bg-pulse-accent/10 text-pulse-accent">
              ●
            </span>
          )}
        </button>
        <button
          onClick={() => onRequestTabChange("tests")}
          className={`pb-2 pt-1 px-3 text-xs font-medium transition-all duration-150 border-b-2 ${
            requestTab === "tests"
              ? "text-pulse-accent border-pulse-accent bg-pulse-accent/[0.04]"
              : "text-pulse-text-muted border-transparent hover:text-pulse-text-secondary hover:border-pulse-border hover:bg-pulse-hover/50"
          }`}
        >
          Tests
          {assertions.length > 0 && (
            <span className="ml-1.5 px-1 py-0.5 text-[10px] rounded bg-pulse-accent/10 text-pulse-accent">
              {assertions.length}
            </span>
          )}
          {extract.length > 0 && (
            <span className="ml-1.5 px-1 py-0.5 text-[10px] rounded bg-pulse-indigo/10 text-pulse-indigo">
              {extract.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab 内容区域 */}
      <div
        className="max-h-52 border-t border-pulse-border"
        style={
          requestTab === "body" && contentType === "application/json"
            ? { overflowY: "hidden" as const, height: "208px" }
            : { overflowY: "auto" as const }
        }
      >
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

        {/* Body Tab：Content-Type 选择 + 请求体编辑器 */}
        {requestTab === "body" && (
          <div
            className={
              contentType === "application/json"
                ? "p-2 flex flex-col h-full min-h-0 gap-2"
                : "p-2 space-y-2"
            }
          >
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
            {/* application/x-www-form-urlencoded → 键值对编辑器 */}
            {contentType === "application/x-www-form-urlencoded" ? (
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr_1fr_24px] gap-1.5 text-[11px] text-pulse-text-muted font-medium px-2 pb-1">
                  <span>Key</span>
                  <span>Value</span>
                </div>
                {bodyParams.map((param, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_24px] gap-1.5 items-center">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onUpdateBodyParam(i, "enabled", !param.enabled)}
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
                          onUpdateBodyParam(i, "key", e.target.value)
                        }
                        placeholder="Field name"
                        className="flex-1 bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
                      />
                    </div>
                    <input
                      type="text"
                      value={param.value}
                      onChange={(e) =>
                        onUpdateBodyParam(i, "value", e.target.value)
                      }
                      placeholder="Value"
                      className="bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
                    />
                    <button
                      onClick={() => onRemoveBodyParam(i)}
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
                  onClick={onAddBodyParam}
                  className="btn-ghost text-xs w-full justify-center py-1"
                >
                  + Add field
                </button>
              </div>
            ) : contentType === "multipart/form-data" ? (
              /* multipart/form-data → 键值对编辑器（支持文件） */
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-1.5 text-[11px] text-pulse-text-muted font-medium px-2 pb-1">
                  <span>Key</span>
                  <span>Value</span>
                  <span className="w-6 text-center">Type</span>
                  <span className="w-8"></span>
                </div>
                {bodyFormData.map((param, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-1.5 items-center">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onUpdateFormDataField(i, "enabled", !param.enabled)}
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
                          onUpdateFormDataField(i, "key", e.target.value)
                        }
                        placeholder="Field name"
                        className="flex-1 bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
                      />
                    </div>
                    {/* 值区域：文本输入或文件选择 */}
                    <div className="flex items-center gap-1">
                      {param.isFile ? (
                        <button
                          onClick={() => onPickFormFile(i)}
                          className="flex-1 flex items-center gap-1.5 bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary hover:border-pulse-accent/40 transition-colors overflow-hidden"
                        >
                          <svg
                            className="w-3.5 h-3.5 shrink-0 text-pulse-accent"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                            />
                          </svg>
                          <span className="truncate">
                            {param.fileName || "Choose file..."}
                          </span>
                        </button>
                      ) : (
                        <input
                          type="text"
                          value={param.value}
                          onChange={(e) =>
                            onUpdateFormDataField(i, "value", e.target.value)
                          }
                          placeholder="Value"
                          className="flex-1 bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
                        />
                      )}
                    </div>
                    {/* 切换文本/文件模式按钮 */}
                    <button
                      onClick={() => onToggleFormDataType(i)}
                      className={`text-xs px-1.5 py-1 rounded transition-colors ${
                        param.isFile
                          ? "text-pulse-accent hover:text-pulse-accent/80"
                          : "text-pulse-text-muted hover:text-pulse-text-primary"
                      }`}
                      title={param.isFile ? "Switch to text" : "Switch to file"}
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        {param.isFile ? (
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                          />
                        ) : (
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        )}
                      </svg>
                    </button>
                    {/* 删除按钮 */}
                    <button
                      onClick={() => onRemoveFormDataField(i)}
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
                  onClick={onAddFormDataField}
                  className="btn-ghost text-xs w-full justify-center py-1"
                >
                  + Add field
                </button>
              </div>
            ) : contentType === "application/json" ? (
              /* application/json → JSON 编辑器（flex 容器填满剩余空间） */
              <div className="flex-1 min-h-0 overflow-hidden">
                <JsonEditor value={body} onChange={onBodyChange} theme={theme} />
              </div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => onBodyChange(e.target.value)}
                placeholder="Request body (raw)"
                className="w-full h-28 bg-pulse-deepest border border-pulse-border rounded-lg px-3 py-2 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 resize-none transition-colors"
                spellCheck={false}
              />
            )}
          </div>
        )}

        {/* Tests Tab：断言 + 响应提取规则 */}
        {requestTab === "tests" && (
          <div className="p-2 space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-pulse-text-muted font-medium">Assertions</span>
                <button
                  onClick={onAddAssertion}
                  className="btn-ghost text-xs py-0.5 px-2"
                >
                  + Add
                </button>
              </div>
              {assertions.length === 0 && (
                <p className="text-[11px] text-pulse-text-muted/50 italic px-1">
                  No assertions — response will be treated as passed
                </p>
              )}
              {assertions.map((expr, i) => (
                <div key={i} className="flex items-center gap-1.5 mb-1">
                  <input
                    type="text"
                    value={expr}
                    onChange={(e) => onUpdateAssertion(i, e.target.value)}
                    placeholder='e.g. status == 200'
                    className="flex-1 bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
                  />
                  <button
                    onClick={() => onRemoveAssertion(i)}
                    className="text-pulse-text-muted hover:text-pulse-rose transition-colors p-0.5 shrink-0"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            <div className="border-t border-pulse-border/50 pt-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-pulse-text-muted font-medium">
                  Extract Variables <span className="text-pulse-text-muted/50 font-normal">(JSON Path → {'{{name}}'})</span>
                </span>
                <button
                  onClick={onAddExtractRule}
                  className="btn-ghost text-xs py-0.5 px-2"
                >
                  + Add
                </button>
              </div>
              {extract.length === 0 && (
                <p className="text-[11px] text-pulse-text-muted/50 italic px-1">
                  Extract values from JSON response into variables for chaining requests
                </p>
              )}
              <div className="grid grid-cols-[1fr_1fr_24px] gap-1.5 text-[11px] text-pulse-text-muted font-medium px-2 pb-1">
                <span>Variable Name</span>
                <span>JSON Path (e.g. body.data.token)</span>
              </div>
              {extract.map((rule, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_24px] gap-1.5 items-center mb-1">
                  <input
                    type="text"
                    value={rule.name}
                    onChange={(e) => onUpdateExtractRule(i, "name", e.target.value)}
                    placeholder="Variable name"
                    className="bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
                  />
                  <input
                    type="text"
                    value={rule.source}
                    onChange={(e) => onUpdateExtractRule(i, "source", e.target.value)}
                    placeholder="body.data.token"
                    className="bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
                  />
                  <button
                    onClick={() => onRemoveExtractRule(i)}
                    className="text-pulse-text-muted hover:text-pulse-rose transition-colors p-0.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
