import { useState } from "react";
import type {
  Collection,
  HistoryItem,
  SidebarTab,
  Environment,
  EnvironmentVariable,
  RequestItem,
  AuthType,
} from "../types";
import EnvironmentPanel from "./EnvironmentPanel";

interface SidebarProps {
  collections: Collection[];
  history: HistoryItem[];
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onLoadHistory: (item: HistoryItem) => void;
  onLoadRequest: (item: RequestItem, collectionId: string) => void;
  /* ── New request & collection management ── */
  onNewRequest: () => void;
  onDeleteRequest: (collectionId: string, requestId: string) => void;
  onRenameRequest: (collectionId: string, requestId: string) => void;
  onAddCollection: () => void;
  onUpdateCollectionAuth: (collectionId: string, authType: AuthType, bearerToken: string) => void;
  /* ── Environment props ── */
  environments: Environment[];
  activeEnvironmentId: string | null;
  onAddEnvironment: () => void;
  onDeleteEnvironment: (id: string) => void;
  onRenameEnvironment: (id: string, name: string) => void;
  onSetActiveEnvironment: (id: string | null) => void;
  onAddVariable: (envId: string) => void;
  onUpdateVariable: (
    envId: string,
    index: number,
    field: keyof EnvironmentVariable,
    value: string | boolean,
  ) => void;
  onRemoveVariable: (envId: string, index: number) => void;
}

const methodStyles: Record<string, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  PUT: "text-method-put",
  PATCH: "text-method-patch",
  DELETE: "text-method-delete",
  HEAD: "text-method-head",
  OPTIONS: "text-method-get",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

export default function Sidebar({
  collections,
  history,
  activeTab,
  onTabChange,
  onLoadHistory,
  onLoadRequest,
  onNewRequest,
  onDeleteRequest,
  onRenameRequest,
  onAddCollection,
  onUpdateCollectionAuth,
  environments,
  activeEnvironmentId,
  onAddEnvironment,
  onDeleteEnvironment,
  onRenameEnvironment,
  onSetActiveEnvironment,
  onAddVariable,
  onUpdateVariable,
  onRemoveVariable,
}: SidebarProps) {
  const [expandedAuthCol, setExpandedAuthCol] = useState<string | null>(null);
  return (
    <aside className="w-60 flex flex-col border-r border-pulse-border bg-pulse-surface shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-pulse-border">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-pulse-indigo to-pulse-accent flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 128 128" fill="none">
              <path
                d="M40 44 L60 64 L40 84"
                stroke="#0B0D15"
                strokeWidth="10"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M60 64 L88 64"
                stroke="#0B0D15"
                strokeWidth="10"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span className="text-sm font-semibold text-pulse-text-primary tracking-tight">
            Pulse
          </span>
        </div>
        <button
          onClick={onNewRequest}
          title="New Request"
          className="w-7 h-7 flex items-center justify-center rounded-md text-pulse-text-muted hover:text-pulse-accent hover:bg-pulse-hover transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-pulse-border">
        <button
          onClick={() => onTabChange("collections")}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === "collections"
              ? "text-pulse-accent border-b-2 border-pulse-accent"
              : "text-pulse-text-muted hover:text-pulse-text-secondary"
          }`}
        >
          Collections
        </button>
        <button
          onClick={() => onTabChange("history")}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === "history"
              ? "text-pulse-accent border-b-2 border-pulse-accent"
              : "text-pulse-text-muted hover:text-pulse-text-secondary"
          }`}
        >
          History
        </button>
        <button
          onClick={() => onTabChange("environments")}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === "environments"
              ? "text-pulse-accent border-b-2 border-pulse-accent"
              : "text-pulse-text-muted hover:text-pulse-text-secondary"
          }`}
        >
          Envs
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "collections" ? (
          <div className="py-2">
            {collections.map((col) => (
              <div key={col.id}>
                <div className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-[11px] font-semibold text-pulse-text-muted uppercase tracking-wider">
                    {col.name}
                  </span>
                  <button
                    onClick={() => {
                      onNewRequest();
                      onTabChange("collections");
                    }}
                    title="Add request"
                    className="w-5 h-5 flex items-center justify-center rounded text-pulse-text-muted hover:text-pulse-accent hover:bg-pulse-hover transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>

                {/* Collection-level Auth */}
                <button
                  onClick={() =>
                    setExpandedAuthCol(expandedAuthCol === col.id ? null : col.id)
                  }
                  className="w-full flex items-center gap-2 px-3 py-1 text-[11px] text-pulse-text-muted hover:text-pulse-text-secondary hover:bg-pulse-hover transition-colors group"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="flex-1 text-left">Auth</span>
                  {col.authType === "bearer" && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-pulse-accent/10 text-pulse-accent">
                      Bearer
                    </span>
                  )}
                  <svg
                    className={`w-3 h-3 transition-transform ${expandedAuthCol === col.id ? "rotate-90" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {expandedAuthCol === col.id && (
                  <div className="px-3 py-1.5 space-y-1.5 bg-pulse-deepest/40">
                    <select
                      value={col.authType}
                      onChange={(e) =>
                        onUpdateCollectionAuth(col.id, e.target.value as AuthType, col.bearerToken)
                      }
                      className="w-full bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary cursor-pointer transition-colors"
                    >
                      <option value="none">No Auth</option>
                      <option value="bearer">Bearer Token</option>
                    </select>
                    {col.authType === "bearer" && (
                      <input
                        type="text"
                        value={col.bearerToken}
                        onChange={(e) =>
                          onUpdateCollectionAuth(col.id, col.authType, e.target.value)
                        }
                        placeholder="Enter bearer token..."
                        className="w-full bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
                      />
                    )}
                  </div>
                )}

                {col.requests.map((req) => (
                  <button
                    key={req.id}
                    onClick={() => onLoadRequest(req, col.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-pulse-hover transition-colors text-left group"
                  >
                    <span
                      className={`font-mono font-semibold text-[10px] uppercase tracking-wide ${
                        methodStyles[req.method] || "text-pulse-text-muted"
                      }`}
                    >
                      {req.method}
                    </span>
                    <span className="flex-1 text-pulse-text-secondary truncate group-hover:text-pulse-text-primary transition-colors">
                      {req.name}
                    </span>
                    <span className="hidden group-hover:flex items-center gap-0.5">
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          onRenameRequest(col.id, req.id);
                        }}
                        className="w-5 h-5 flex items-center justify-center rounded text-pulse-text-muted hover:text-pulse-text-primary hover:bg-pulse-hover transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteRequest(col.id, req.id);
                        }}
                        className="w-5 h-5 flex items-center justify-center rounded text-pulse-text-muted hover:text-pulse-rose hover:bg-pulse-hover transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
            <button
              onClick={onAddCollection}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-pulse-text-muted hover:text-pulse-text-secondary hover:bg-pulse-hover transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Collection
            </button>
          </div>
        ) : activeTab === "history" ? (
          <div className="py-2">
            {history.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-pulse-text-muted">
                <p>No requests yet</p>
                <p className="mt-1">Send a request to see it here</p>
              </div>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onLoadHistory(item)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-pulse-hover transition-colors text-left group"
                >
                  <span
                    className={`font-mono font-semibold text-[10px] uppercase tracking-wide shrink-0 ${
                      methodStyles[item.method] || "text-pulse-text-muted"
                    }`}
                  >
                    {item.method}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-pulse-text-secondary group-hover:text-pulse-text-primary transition-colors">
                      {item.url}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {item.status && (
                        <span
                          className={`text-[10px] font-medium ${
                            item.status < 300
                              ? "text-pulse-emerald"
                              : item.status < 500
                                ? "text-pulse-amber"
                                : "text-pulse-rose"
                          }`}
                        >
                          {item.status}
                        </span>
                      )}
                      <span className="text-[10px] text-pulse-text-muted">
                        {formatTime(item.timestamp)}
                      </span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <EnvironmentPanel
            environments={environments}
            activeEnvironmentId={activeEnvironmentId}
            onAddEnvironment={onAddEnvironment}
            onDeleteEnvironment={onDeleteEnvironment}
            onRenameEnvironment={onRenameEnvironment}
            onSetActiveEnvironment={onSetActiveEnvironment}
            onAddVariable={onAddVariable}
            onUpdateVariable={onUpdateVariable}
            onRemoveVariable={onRemoveVariable}
          />
        )}
      </div>
    </aside>
  );
}
