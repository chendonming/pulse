import { useState, useCallback, useMemo, memo } from "react";
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
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ============================================================
// 拖拽 ID 编码方案
//
// 集合和请求项在同一个 SortableContext 中混排，
// 使用前缀区分类型：
//   集合项: "c:<collectionId>"
//   请求项: "r:<collectionId>:<requestId>"
//
// 分隔符使用冒号 : —— UUID 中只含十六进制字符和连字符，不含冒号
// ============================================================

const CP = "c:"; // Collection Prefix
const RP = "r:"; // Request Prefix

/** 集合色标指示点颜色循环调色板（8种，使用现有 pulse 语义色） */
const COLLECTION_DOT_COLORS = [
  "bg-pulse-indigo",
  "bg-pulse-teal",
  "bg-pulse-blue",
  "bg-pulse-purple",
  "bg-pulse-amber",
  "bg-pulse-rose",
  "bg-pulse-emerald",
  "bg-pulse-sky",
] as const;

/** 将集合 ID 编码为拖拽 ID */
function cid(id: string) {
  return `${CP}${id}`;
}
/** 将集合 ID + 请求 ID 编码为拖拽 ID */
function rid(colId: string, requestId: string) {
  return `${RP}${colId}:${requestId}`;
}

/** 解析拖拽 ID，返回类型和原始 ID */
function parse(nid: string):
  | { type: "col"; colId: string }
  | { type: "req"; colId: string; requestId: string }
  | null {
  if (nid.startsWith(CP)) return { type: "col", colId: nid.slice(CP.length) };
  if (nid.startsWith(RP)) {
    const body = nid.slice(RP.length);
    const sep = body.indexOf(":");
    if (sep === -1) return null;
    return { type: "req", colId: body.slice(0, sep), requestId: body.slice(sep + 1) };
  }
  return null;
}

// ============================================================
// 辅助函数
// ============================================================

/** HTTP 方法对应的文本颜色 class */
const methodStyles: Record<string, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  PUT: "text-method-put",
  PATCH: "text-method-patch",
  DELETE: "text-method-delete",
  HEAD: "text-method-head",
  OPTIONS: "text-method-get",
};

/** 格式化时间戳为相对时间或日期字符串 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

// ============================================================
// 可拖拽集合头部组件
// ============================================================

function SortableColHeader({
  id,
  name,
  count,
  colorClass,
}: {
  id: string;
  name: string;
  count: number;
  /** 集合色标指示点的 Tailwind 背景色 class（循环调色板） */
  colorClass: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    position: "relative" as const,
    zIndex: isDragging ? 1 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-pulse-text-secondary uppercase tracking-wider select-none"
    >
      {/* 集合色标指示点 —— 循环调色板，快速区分不同集合 */}
      <span className={`w-2 h-2 rounded-full shrink-0 ${colorClass}`} />
      {/* 六点手柄拖拽图标 */}
      <span
        {...listeners}
        className="shrink-0 grid grid-cols-2 gap-[2px] w-4 h-4 cursor-grab active:cursor-grabbing text-pulse-text-muted/30 hover:text-pulse-text-muted/60 transition-colors"
      >
        <span className="w-[3px] h-[3px] rounded-full bg-current" />
        <span className="w-[3px] h-[3px] rounded-full bg-current" />
        <span className="w-[3px] h-[3px] rounded-full bg-current" />
        <span className="w-[3px] h-[3px] rounded-full bg-current" />
        <span className="w-[3px] h-[3px] rounded-full bg-current" />
        <span className="w-[3px] h-[3px] rounded-full bg-current" />
      </span>
      <span className="flex-1 truncate">{name}</span>
      {count > 0 && (
        <span className="text-[10px] text-pulse-text-muted/50 tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}

// ============================================================
// 可拖拽请求行组件
// ============================================================

function SortableRequestItem({
  id,
  method,
  name,
  onLoad,
  onRename,
  onDelete,
}: {
  id: string;
  method: string;
  name: string;
  onLoad: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: "relative" as const,
    zIndex: isDragging ? 1 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onLoad}
      className="w-full flex items-center gap-2.5 pl-5 pr-3 py-1.5 text-xs cursor-pointer hover:bg-pulse-hover transition-colors text-left group"
    >
      <span
        className={`font-mono font-semibold text-[10px] uppercase tracking-wide ${
          methodStyles[method] || "text-pulse-text-muted"
        }`}
      >
        {method}
      </span>
      <span className="flex-1 text-pulse-text-secondary truncate group-hover:text-pulse-text-primary transition-colors">
        {name}
      </span>
      {/* 悬停时显示的操作按钮（重命名 + 删除） */}
      <span
        className="hidden group-hover:flex items-center gap-0.5 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onRename}
          className="w-5 h-5 flex items-center justify-center rounded text-pulse-text-muted hover:text-pulse-text-primary hover:bg-pulse-hover transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="w-5 h-5 flex items-center justify-center rounded text-pulse-text-muted hover:text-pulse-rose hover:bg-pulse-hover transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </span>
    </div>
  );
}

// ============================================================
// 拖拽幽灵效果组件
// ============================================================

function DragGhost({ info }: { info: { type: "col" | "req" } | null }) {
  if (!info) return null;
  return (
    <div className="rounded-md bg-pulse-elevated border border-pulse-border shadow-lg px-3 py-2 text-xs text-pulse-text-primary flex items-center gap-2.5">
      {info.type === "col" ? (
        <>
          <span className="w-4 flex items-center justify-center text-pulse-text-muted/40">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" />
              <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" />
            </svg>
          </span>
          <span className="font-semibold text-[11px] uppercase tracking-wider text-pulse-text-muted">
            Moving collection…
          </span>
        </>
      ) : (
        <>
          <span className="font-mono font-semibold text-[10px] uppercase text-pulse-text-muted">
            Req
          </span>
          <span className="text-pulse-text-secondary">Moving request…</span>
        </>
      )}
    </div>
  );
}

// ============================================================
// Sidebar 属性接口
// ============================================================

interface SidebarProps {
  collections: Collection[];
  history: HistoryItem[];
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onLoadHistory: (item: HistoryItem) => void;
  onLoadRequest: (item: RequestItem, collectionId: string) => void;
  onNewRequest: () => void;
  onDeleteRequest: (collectionId: string, requestId: string) => void;
  onRenameRequest: (collectionId: string, requestId: string) => void;
  onAddCollection: () => void;
  onUpdateCollectionAuth: (
    collectionId: string,
    authType: AuthType,
    bearerToken: string,
  ) => void;
  onMoveRequest: (
    sourceColId: string,
    requestId: string,
    targetColId: string,
    targetIndex: number,
  ) => void;
  onMoveCollection: (collectionId: string, targetIndex: number) => void;
  /** 更新集合的 Base URL */
  onUpdateCollectionBaseUrl: (collectionId: string, baseUrl: string) => void;
  /* ── 环境变量 ── */
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

// ============================================================
// 侧边栏主组件（使用 React.memo 避免无关状态更新导致的重渲染）
//
// 三个 Tab：
// 1. Collections（集合 + 请求，带 DnD 拖拽排序）
// 2. History（历史记录列表）
// 3. Envs（环境变量管理——委托给 EnvironmentPanel）
// ============================================================

export default memo(function Sidebar({
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
  onMoveRequest,
  onMoveCollection,
  onUpdateCollectionBaseUrl,
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

  // ── DnD 状态 ──
  const [activeDndId, setActiveDndId] = useState<string | null>(null);
  const activeInfo = activeDndId ? parse(activeDndId) : null;
  const isDraggingCollection = activeInfo?.type === "col";
  const isDraggingRequest = activeInfo?.type === "req";

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }, // 5px 拖拽阈值，防止误触
    }),
  );

  // ── 将集合和请求展开为扁平列表（用于单个 SortableContext） ──

  const { flatItems, allIds } = useMemo(() => {
    const items: { dndId: string; col: Collection; req?: RequestItem }[] = [];
    for (const col of collections) {
      items.push({ dndId: cid(col.id), col });
      for (const req of col.requests) {
        items.push({ dndId: rid(col.id, req.id), col, req });
      }
    }
    return { flatItems: items, allIds: items.map((i) => i.dndId) };
  }, [collections]);

  // ── 拖拽事件处理 ──

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDndId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDndId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIdx = allIds.indexOf(String(active.id));
      const newIdx = allIds.indexOf(String(over.id));
      if (oldIdx === -1 || newIdx === -1) return;

      const sorted = arrayMove(allIds, oldIdx, newIdx);
      const info = parse(String(active.id));

      if (info?.type === "col") {
        // 集合重排
        const newOrder = sorted
          .filter((id) => id.startsWith(CP))
          .map((id) => id.slice(CP.length))
          .filter((id) => collections.some((c) => c.id === id));

        const oldPos = collections.findIndex((c) => c.id === info.colId);
        const newPos = newOrder.indexOf(info.colId);
        if (oldPos !== newPos && newPos >= 0) {
          onMoveCollection(info.colId, newPos);
        }
      } else if (info?.type === "req") {
        // 请求移入目标集合
        let lastColId: string | null = null;
        let idx = 0;

        for (const id of sorted) {
          if (id.startsWith(CP)) {
            lastColId = id.slice(CP.length);
            idx = 0;
          } else if (id.startsWith(RP)) {
            if (id === String(active.id)) break;
            idx++;
          }
        }

        if (lastColId) {
          onMoveRequest(info.colId, info.requestId, lastColId, idx);
        }
      }
    },
    [allIds, collections, onMoveRequest, onMoveCollection],
  );

  // ── 渲染 ──

  return (
    <aside className="w-60 flex flex-col border-r border-pulse-border bg-pulse-surface shrink-0">
      {/* 头部 Logo */}
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
        {/* 新建请求按钮 */}
        <button
          onClick={onNewRequest}
          title="New Request"
          className="w-7 h-7 flex items-center justify-center rounded-md text-pulse-text-muted hover:text-pulse-accent hover:bg-pulse-hover transition-colors active:scale-95 relative group"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {/* 快捷键提示 tooltip */}
          <span className="absolute -bottom-6 right-0 hidden group-hover:flex items-center gap-1 px-1.5 py-0.5 bg-pulse-elevated border border-pulse-border rounded text-[10px] text-pulse-text-muted whitespace-nowrap z-50">
            New
            <kbd className="font-mono text-pulse-text-muted/60">Ctrl+N</kbd>
          </span>
        </button>
      </div>

      {/* Tab 切换栏 */}
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

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "collections" ? (
          <div className="py-2">
            {collections.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-pulse-text-muted">
                <p>No collections yet</p>
                <p className="mt-1">
                  <button
                    onClick={onAddCollection}
                    className="text-pulse-accent hover:underline"
                  >
                    Create one
                  </button>
                </p>
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={allIds}
                  strategy={verticalListSortingStrategy}
                >
                  {/* 遍历扁平化的项目列表，分组渲染：
                      每个集合依次渲染：
                        - SortableColHeader（可拖拽）
                        - Auth 区域（静态，在 header 下方）
                        - 请求列表（SortableRequestItem，每个可拖拽） */}
                  {(() => {
                    const nodes: React.ReactNode[] = [];
                    let lastColId: string | null = null;
                    let colIndex = 0; // 集合序号，用于循环分配色标颜色

                    for (const item of flatItems) {
                      const p = parse(item.dndId);
                      if (!p) continue;

                      if (p.type === "col") {
                        lastColId = p.colId;
                        const col = collections.find((c) => c.id === p.colId);
                        if (!col) continue;

                        // 按集合出现顺序循环分配颜色
                        const colorClass = COLLECTION_DOT_COLORS[colIndex % COLLECTION_DOT_COLORS.length];
                        colIndex++;

                        nodes.push(
                          <div
                            key={item.dndId}
                            className="mt-3 pt-2 border-t border-pulse-border first:mt-0 first:pt-0 first:border-t-0"
                          >
                            <SortableColHeader
                              id={item.dndId}
                              name={col.name}
                              count={col.requests.length}
                              colorClass={colorClass}
                            />

                            {/* 集合 Base URL 输入 */}
                            <div className="pl-5 pr-3 py-1">
                              <input
                                value={col.base_url}
                                onChange={(e) =>
                                  onUpdateCollectionBaseUrl(col.id, e.target.value)
                                }
                                placeholder="Base URL (optional) — e.g. https://api.example.com"
                                className="w-full bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-[10px] font-mono text-pulse-text-primary outline-none placeholder:text-pulse-text-muted/60 focus:border-pulse-accent transition-colors"
                              />
                            </div>

                            {/* 集合认证配置折叠行 */}
                            <button
                              onClick={() =>
                                setExpandedAuthCol(
                                  expandedAuthCol === col.id ? null : col.id,
                                )
                              }
                              className="w-full flex items-center gap-2 pl-5 pr-3 py-1 text-[11px] text-pulse-text-muted hover:text-pulse-text-secondary hover:bg-pulse-hover transition-colors group"
                            >
                              <svg
                                className="w-3.5 h-3.5 shrink-0"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                                />
                              </svg>
                              <span className="flex-1 text-left">Auth</span>
                              {col.authType === "bearer" && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-pulse-accent/10 text-pulse-accent">
                                  Bearer
                                </span>
                              )}
                              {col.authType === "inherit" && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-pulse-hover text-pulse-text-muted">
                                  Inherit
                                </span>
                              )}
                              <svg
                                className={`w-3 h-3 transition-transform ${
                                  expandedAuthCol === col.id ? "rotate-90" : ""
                                }`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M9 5l7 7-7 7"
                                />
                              </svg>
                            </button>

                            {/* 展开的认证编辑区域 */}
                            {expandedAuthCol === col.id && (
                              <div className="pl-5 pr-3 py-1.5 space-y-1.5 bg-pulse-deepest/40">
                                <select
                                  value={col.authType}
                                  onChange={(e) =>
                                    onUpdateCollectionAuth(
                                      col.id,
                                      e.target.value as AuthType,
                                      col.bearerToken,
                                    )
                                  }
                                  className="w-full bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary cursor-pointer transition-colors"
                                >
                                  <option value="inherit">Inherit</option>
                                  <option value="none">No Auth</option>
                                  <option value="bearer">Bearer Token</option>
                                </select>
                                {col.authType === "bearer" && (
                                  <input
                                    type="text"
                                    value={col.bearerToken}
                                    onChange={(e) =>
                                      onUpdateCollectionAuth(
                                        col.id,
                                        col.authType,
                                        e.target.value,
                                      )
                                    }
                                    placeholder="Enter bearer token..."
                                    className="w-full bg-pulse-deepest border border-pulse-border rounded px-2 py-1 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
                                  />
                                )}
                              </div>
                            )}
                          </div>,
                        );
                      } else if (p.type === "req" && lastColId) {
                        // 从任意集合中查找完整请求对象
                        const req = collections
                          .find((c) => c.id === p.colId)
                          ?.requests.find((r) => r.id === p.requestId);
                        if (!req) continue;

                        nodes.push(
                          <SortableRequestItem
                            key={item.dndId}
                            id={item.dndId}
                            method={req.method}
                            name={req.name}
                            onLoad={() => onLoadRequest(req, p.colId)}
                            onRename={() => onRenameRequest(p.colId, p.requestId)}
                            onDelete={() =>
                              onDeleteRequest(p.colId, p.requestId)
                            }
                          />,
                        );
                      }
                    }
                    return nodes;
                  })()}
                </SortableContext>

                {/* 拖拽时的幽灵效果 */}
                <DragOverlay dropAnimation={null}>
                  {activeDndId ? (
                    <DragGhost
                      info={
                        isDraggingCollection
                          ? { type: "col" }
                          : isDraggingRequest
                            ? { type: "req" }
                            : null
                      }
                    />
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}

            {/* 新建集合按钮 */}
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
})
