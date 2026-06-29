import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  HttpMethod,
  SidebarTab,
  RequestTab,
  HeaderInput,
  ResponseData,
  Collection,
  RequestItem,
  HistoryItem,
  AuthType,
  Environment,
  EnvironmentVariable,
  EnvironmentData,
  CollectionData,
  ImportExportStrategy,
  ImportPreview,
  ImportResult,
  TestRunResult,
  TabState,
  AppSettings,
} from "../types";
import { DEFAULT_SETTINGS } from "../types";
import type { ToastItem } from "../components/Toast";

// ============================================================
// 工具函数：URL 查询字符串解析
// ============================================================

/**
 * 从 URL 中解析出查询参数列表
 * 例如：https://api.example.com/users?page=1&limit=10
 * → [{ key: "page", value: "1", enabled: true }, { key: "limit", value: "10", enabled: true }]
 */
function parseUrlParams(url: string): HeaderInput[] {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return [{ key: "", value: "", enabled: true }];
  const query = url.slice(qIndex + 1).split("#")[0]; // 移除 hash 片段
  if (!query) return [{ key: "", value: "", enabled: true }];
  const pairs = query.split("&").filter(Boolean);
  if (pairs.length === 0) return [{ key: "", value: "", enabled: true }];
  return pairs.map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1)
      return { key: decodeURIComponent(pair), value: "", enabled: true };
    return {
      key: decodeURIComponent(pair.slice(0, eq)),
      value: decodeURIComponent(pair.slice(eq + 1)),
      enabled: true,
    };
  });
}

/** 获取 URL 的基础部分（? 之前的内容） */
function getBaseUrl(url: string): string {
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

/** 将基础 URL 和查询参数组合为完整 URL */
function buildUrlWithParams(base: string, params: HeaderInput[]): string {
  const active = params.filter((p) => p.key.trim() && p.enabled);
  if (active.length === 0) return base;
  const qs = active
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join("&");
  return `${base}?${qs}`;
}

/**
 * 将 bodyParams 序列化为 URL 编码的字符串
 * 用于 application/x-www-form-urlencoded 类型的请求体
 */
function serializeBodyParams(params: HeaderInput[]): string {
  const active = params.filter((p) => p.key.trim() && p.enabled);
  if (active.length === 0) return "";
  return active
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join("&");
}

/**
 * 将 URL 编码的请求体字符串解析为 bodyParams 列表
 * 从已保存的 form-urlencoded body 还原为键值对
 */
function parseBodyParams(body: string): HeaderInput[] {
  if (!body) return [{ key: "", value: "", enabled: true }];
  const pairs = body.split("&").filter(Boolean);
  if (pairs.length === 0) return [{ key: "", value: "", enabled: true }];
  return pairs.map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1)
      return { key: decodeURIComponent(pair), value: "", enabled: true };
    return {
      key: decodeURIComponent(pair.slice(0, eq)),
      value: decodeURIComponent(pair.slice(eq + 1)),
      enabled: true,
    };
  });
}

// ============================================================
// 标签页工厂函数
// ============================================================

/** 创建空白标签页的默认状态 */
function createBlankTab(overrides?: Partial<TabState>): TabState {
  return {
    id: crypto.randomUUID(),
    title: "New Request",
    createdAt: Date.now(),
    method: "GET" as HttpMethod,
    url: "",
    headers: [{ key: "", value: "", enabled: true }],
    body: "",
    bodyParams: [{ key: "", value: "", enabled: true }],
    contentType: "application/json",
    authType: "none" as AuthType,
    bearerToken: "",
    rawParams: [{ key: "", value: "", enabled: true }],
    requestTab: "headers" as RequestTab,
    response: null,
    isLoading: false,
    error: null,
    responseTab: "body" as "body" | "headers",
    editingRequest: null,
    savedSnapshot: null,
    ...overrides,
  };
}

/** 从集合中的请求创建标签页（含已保存快照） */
function createTabFromRequest(item: RequestItem, collectionId: string): TabState {
  const method = item.method as HttpMethod;
  const url = item.url;
  const headers = item.headers?.length
    ? item.headers
    : [{ key: "", value: "", enabled: true }];
  const body = item.body ?? "";
  const bodyParams = item.bodyParams?.length
    ? item.bodyParams
    : (item.contentType === "application/x-www-form-urlencoded" && item.body
      ? parseBodyParams(item.body)
      : [{ key: "", value: "", enabled: true }]);
  const contentType = item.contentType ?? "application/json";
  const authType = (item.authType as AuthType) ?? "none";
  const bearerToken = item.bearerToken ?? "";
  const rawParams = item.params?.length
    ? item.params
    : [{ key: "", value: "", enabled: true }];

  return {
    id: crypto.randomUUID(),
    title: item.name,
    createdAt: Date.now(),
    method,
    url,
    headers,
    body,
    bodyParams,
    contentType,
    authType,
    bearerToken,
    rawParams,
    requestTab: "headers" as RequestTab,
    response: null,
    isLoading: false,
    error: null,
    responseTab: "body" as "body" | "headers",
    editingRequest: { collectionId, requestId: item.id },
    savedSnapshot: {
      method, url: url.trim(), headers, body, bodyParams,
      contentType, authType, bearerToken, rawParams,
    },
  };
}

// ============================================================
// 应用状态管理 Hook
//
// 重构为多标签页架构：
// - tabs[] 数组存储所有标签页的完整请求/响应状态
// - activeTabId 标记当前激活标签页
// - 所有请求参数/响应相关的 props 推导自 activeTab
// - 新增 newTab / closeTab / switchTab / openInTab 函数
// ============================================================

/**
 * 合并环境变量与 Collection 变量
 * Collection 变量作为默认值，环境变量覆盖同名变量（环境优先）
 */
function mergeRequestVariables(
  envVars: EnvironmentVariable[],
  allCollections: Collection[],
  collectionId?: string,
): EnvironmentVariable[] {
  const merged = new Map<string, string>();

  // 1. Collection 变量作为基础（默认值）
  if (collectionId) {
    const collection = allCollections.find((c) => c.id === collectionId);
    if (collection?.variables) {
      for (const [key, value] of Object.entries(collection.variables)) {
        merged.set(key, value);
      }
    }
  }

  // 2. 环境变量覆盖（环境优先）
  for (const v of envVars) {
    if (v.enabled) {
      merged.set(v.key, v.value);
    }
  }

  return Array.from(merged.entries()).map(([key, value]) => ({
    key,
    value,
    enabled: true,
  }));
}

export function usePulse() {
  // ── 标签页状态：核心数据结构 ──
  const [tabs, setTabs] = useState<TabState[]>(() => [createBlankTab()]);
  const [activeTabId, setActiveTabId] = useState<string>("");

  // 首次渲染时同步 activeTabId（仅在 activeTabId 为空时执行一次）
  if (activeTabId === "" && tabs.length > 0) {
    setActiveTabId(tabs[0].id);
  }

  // 推导当前激活标签页
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  // ── 标签页管理函数 ──

  /** 创建新标签页并切换到它 */
  const newTab = useCallback(() => {
    const tab = createBlankTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  /** 关闭指定标签页（若为最后一个则自动创建空白标签页） */
  const closeTab = useCallback(
    (tabId: string) => {
      // 预先创建空白标签页，确保两个 setState 使用同一个 ID
      const fallbackTab = createBlankTab();
      setTabs((prev) => {
        if (prev.length <= 1) {
          // 关闭最后一个标签页 → 使用预先创建的空白标签页替代
          return [fallbackTab];
        }
        return prev.filter((t) => t.id !== tabId);
      });
      setActiveTabId((prevId) => {
        if (prevId !== tabId) return prevId; // 关闭的不是当前标签页
        if (tabs.length <= 1) {
          // 关闭最后一个标签页 → 切换到预先创建的空白标签页
          return fallbackTab.id;
        }
        // 切换到左侧相邻标签页，若无则切到右侧
        const remaining = tabs.filter((t) => t.id !== tabId);
        const idx = tabs.findIndex((t) => t.id === tabId);
        const target = Math.max(0, Math.min(idx, remaining.length - 1));
        return remaining[target]?.id ?? tabId;
      });
    },
    [tabs],
  );

  /** 切换到指定标签页 */
  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  /** 从集合加载请求（新建标签页 or 使用当前标签页） */
  const openInTab = useCallback(
    (item: RequestItem, collectionId: string, inNewTab: boolean) => {
      if (inNewTab) {
        const tab = createTabFromRequest(item, collectionId);
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
      } else {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId
              ? createTabFromRequest(item, collectionId)
              : t,
          ),
        );
      }
    },
    [activeTabId],
  );

  // ── 向后兼容：读取当前激活标签页的字段 ──

  const method = activeTab.method;
  const url = activeTab.url;
  const headers = activeTab.headers;
  const body = activeTab.body;
  const bodyParams = activeTab.bodyParams;
  const contentType = activeTab.contentType;
  const authType = activeTab.authType;
  const bearerToken = activeTab.bearerToken;
  const rawParams = activeTab.rawParams;
  const requestTab = activeTab.requestTab;
  const response = activeTab.response;
  const isLoading = activeTab.isLoading;
  const error = activeTab.error;
  const responseTab = activeTab.responseTab;
  const editingRequest = activeTab.editingRequest;

  // ── 脏状态计算（比较当前值与已保存快照） ──

  const isDirty = useMemo(() => {
    if (!activeTab.savedSnapshot) return false;
    const s = activeTab.savedSnapshot;
    return (
      activeTab.method !== s.method ||
      activeTab.url.trim() !== s.url ||
      JSON.stringify(activeTab.headers) !== JSON.stringify(s.headers) ||
      activeTab.body !== s.body ||
      JSON.stringify(activeTab.bodyParams) !== JSON.stringify(s.bodyParams) ||
      activeTab.contentType !== s.contentType ||
      activeTab.authType !== s.authType ||
      activeTab.bearerToken !== s.bearerToken ||
      JSON.stringify(activeTab.rawParams) !== JSON.stringify(s.rawParams)
    );
  }, [
    activeTab.method, activeTab.url, activeTab.headers,
    activeTab.body, activeTab.bodyParams, activeTab.contentType,
    activeTab.authType, activeTab.bearerToken, activeTab.rawParams,
    activeTab.savedSnapshot,
  ]);

  // ── 向后兼容：设置器代理到当前激活标签页 ──

  const setMethod = useCallback(
    (m: HttpMethod) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, method: m } : t)),
      );
    },
    [activeTabId],
  );

  const setBody = useCallback(
    (b: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, body: b } : t)),
      );
    },
    [activeTabId],
  );

  const setContentType = useCallback(
    (ct: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, contentType: ct } : t)),
      );
    },
    [activeTabId],
  );

  const setAuthType = useCallback(
    (at: AuthType) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, authType: at } : t)),
      );
    },
    [activeTabId],
  );

  const setBearerToken = useCallback(
    (bt: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, bearerToken: bt } : t)),
      );
    },
    [activeTabId],
  );

  const setRequestTab = useCallback(
    (rt: RequestTab) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, requestTab: rt } : t)),
      );
    },
    [activeTabId],
  );

  const setResponseTab = useCallback(
    (rt: "body" | "headers") => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, responseTab: rt } : t)),
      );
    },
    [activeTabId],
  );

  // ── 请求头 CRUD ──

  const addHeader = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, headers: [...t.headers, { key: "", value: "", enabled: true }] }
          : t,
      ),
    );
  }, [activeTabId]);

  const updateHeader = useCallback(
    (index: number, field: keyof HeaderInput, value: string | boolean) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId) return t;
          const next = [...t.headers];
          next[index] = { ...next[index], [field]: value };
          return { ...t, headers: next };
        }),
      );
    },
    [activeTabId],
  );

  const removeHeader = useCallback(
    (index: number) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId) return t;
          return { ...t, headers: t.headers.filter((_, i) => i !== index) };
        }),
      );
    },
    [activeTabId],
  );

  // ── 请求体键值对 CRUD ──

  const addBodyParam = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, bodyParams: [...t.bodyParams, { key: "", value: "", enabled: true }] }
          : t,
      ),
    );
  }, [activeTabId]);

  const updateBodyParam = useCallback(
    (index: number, field: keyof HeaderInput, value: string | boolean) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId) return t;
          const next = [...t.bodyParams];
          next[index] = { ...next[index], [field]: value };
          return { ...t, bodyParams: next };
        }),
      );
    },
    [activeTabId],
  );

  const removeBodyParam = useCallback(
    (index: number) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId) return t;
          return { ...t, bodyParams: t.bodyParams.filter((_, i) => i !== index) };
        }),
      );
    },
    [activeTabId],
  );

  // ── URL / 查询参数双向同步 ──

  const skipUrlSync = useRef(false);
  const prevParamsJson = useRef("");

  const handleUrlChange = useCallback(
    (newUrl: string) => {
      skipUrlSync.current = true;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? { ...t, url: newUrl, rawParams: parseUrlParams(newUrl) }
            : t,
        ),
      );
    },
    [activeTabId],
  );

  // 切换标签页时重置参数同步状态
  useEffect(() => {
    prevParamsJson.current = JSON.stringify(activeTab.rawParams);
    skipUrlSync.current = false;
  }, [activeTabId, activeTab.rawParams]);

  // 监听参数变化 → 更新 URL（排除来自 handleUrlChange 的触发）
  useEffect(() => {
    if (skipUrlSync.current) {
      skipUrlSync.current = false;
      return;
    }
    const json = JSON.stringify(activeTab.rawParams);
    if (json === prevParamsJson.current) return;
    prevParamsJson.current = json;

    const base = getBaseUrl(activeTab.url);
    if (!base) return;
    const newUrl = buildUrlWithParams(base, activeTab.rawParams);
    if (newUrl !== activeTab.url) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, url: newUrl } : t,
        ),
      );
    }
  }, [activeTab.rawParams, activeTab.url, activeTabId]);

  // ── 查询参数 CRUD ──

  const addParam = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, rawParams: [...t.rawParams, { key: "", value: "", enabled: true }] }
          : t,
      ),
    );
  }, [activeTabId]);

  const updateParam = useCallback(
    (index: number, field: keyof HeaderInput, value: string | boolean) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId) return t;
          const next = [...t.rawParams];
          next[index] = { ...next[index], [field]: value };
          return { ...t, rawParams: next };
        }),
      );
    },
    [activeTabId],
  );

  const removeParam = useCallback(
    (index: number) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId) return t;
          return { ...t, rawParams: t.rawParams.filter((_, i) => i !== index) };
        }),
      );
    },
    [activeTabId],
  );

  // ── 响应状态 ──

  const clearResponse = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId ? { ...t, response: null, error: null } : t,
      ),
    );
  }, [activeTabId]);

  // ── 更新已保存快照（加载/保存请求后调用） ──

  const updateActiveSnapshot = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTabId) return t;
        return {
          ...t,
          savedSnapshot: {
            method: t.method,
            url: t.url.trim(),
            headers: t.headers,
            body: t.body,
            bodyParams: t.bodyParams,
            contentType: t.contentType,
            authType: t.authType,
            bearerToken: t.bearerToken,
            rawParams: t.rawParams,
          },
        };
      }),
    );
  }, [activeTabId]);

  // ── 持久化状态 ──

  const [collections, setCollections] = useState<Collection[]>(() => [
    {
      id: "default",
      name: "My Collection",
      base_url: '',
      authType: "inherit",
      bearerToken: "",
      requests: [
        {
          id: "example-1",
          name: "JSONPlaceholder Posts",
          method: "GET",
          url: "https://jsonplaceholder.typicode.com/posts/1",
          headers: [{ key: "", value: "", enabled: true }],
          body: "",
          contentType: "application/json",
          authType: "inherit",
          bearerToken: "",
          params: [{ key: "", value: "", enabled: true }],
        },
        {
          id: "example-2",
          name: "Create Post",
          method: "POST",
          url: "https://jsonplaceholder.typicode.com/posts",
          headers: [{ key: "", value: "", enabled: true }],
          body: JSON.stringify({ title: "foo", body: "bar", userId: 1 }, null, 2),
          contentType: "application/json",
          authType: "inherit",
          bearerToken: "",
          params: [{ key: "", value: "", enabled: true }],
        },
      ],
    },
  ]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("collections");

  // ── 环境变量 ──

  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [activeEnvironmentId, setActiveEnvironmentId] = useState<string | null>(null);
  const [envLoaded, setEnvLoaded] = useState(false);
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);

  // ── Toast 通知状态 ──

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...toast, id }]);
    if (toast.duration !== 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, toast.duration ?? 3000);
    }
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── 删除确认对话框状态 ──

  const [confirmDialog, setConfirmDialog] = useState<{
    type: "deleteRequest" | "deleteCollection";
    collectionId: string;
    requestId?: string;
    requestName?: string;
    collectionName?: string;
  } | null>(null);

  const undoStack = useRef<Array<{
    type: "deleteRequest" | "deleteCollection";
    collectionId?: string;
    requestIndex?: number;
    request?: RequestItem;
    collection?: Collection;
    collectionIndex?: number;
    timestamp: number;
  }>>([]);

  const confirmDestructive = useCallback(() => {
    if (!confirmDialog) return;
    if (confirmDialog.type === "deleteRequest") {
      const { collectionId, requestId, requestName } = confirmDialog;
      const col = collections.find((c) => c.id === collectionId);
      const reqIndex = col?.requests.findIndex((r) => r.id === requestId) ?? -1;
      const deletedReq = reqIndex >= 0 ? col!.requests[reqIndex] : null;

      setCollections((prev) =>
        prev.map((c) =>
          c.id === collectionId
            ? { ...c, requests: c.requests.filter((r) => r.id !== requestId) }
            : c,
        ),
      );

      // 清除所有标签页中对该请求的编辑状态
      setTabs((prev) =>
        prev.map((t) =>
          t.editingRequest?.collectionId === collectionId &&
          t.editingRequest?.requestId === requestId
            ? { ...t, editingRequest: null, savedSnapshot: null }
            : t,
        ),
      );

      if (deletedReq && reqIndex >= 0) {
        undoStack.current.push({
          type: "deleteRequest",
          collectionId,
          requestIndex: reqIndex,
          request: deletedReq,
          timestamp: Date.now(),
        });
        const now = Date.now();
        undoStack.current = undoStack.current.filter((e) => now - e.timestamp < 30000);
      }

      addToast({
        type: "info",
        message: `Deleted "${requestName ?? deletedReq?.name ?? "Untitled"}"`,
        duration: 5000,
        action: { label: "Undo", onClick: undoLastDelete },
      });
    } else if (confirmDialog.type === "deleteCollection") {
      const { collectionId, collectionName } = confirmDialog;

      // 删除集合（使用函数式更新，不受闭包陈旧性影响）
      setCollections((prev) => prev.filter((c) => c.id !== collectionId));

      // 清除所有标签页中对该集合的编辑状态
      setTabs((prev) =>
        prev.map((t) =>
          t.editingRequest?.collectionId === collectionId
            ? { ...t, editingRequest: null, savedSnapshot: null }
            : t,
        ),
      );

      undoStack.current.push({
        type: "deleteCollection",
        collectionIndex: collections.findIndex((c) => c.id === collectionId),
        collection: collections.find((c) => c.id === collectionId) || {
          id: collectionId,
          name: collectionName ?? "Unknown",
          base_url: "",
          authType: "none" as const,
          bearerToken: "",
          requests: [],
        },
        timestamp: Date.now(),
      });
      const now = Date.now();
      undoStack.current = undoStack.current.filter((e) => now - e.timestamp < 30000);

      addToast({
        type: "info",
        message: `Deleted collection "${collectionName ?? "Unknown"}"`,
        duration: 5000,
        action: { label: "Undo", onClick: undoLastDelete },
      });
    }
    setConfirmDialog(null);
  }, [confirmDialog, collections, addToast]);

  const cancelDestructive = useCallback(() => {
    setConfirmDialog(null);
  }, []);

  const undoLastDelete = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    if (entry.type === "deleteRequest" && entry.collectionId && entry.request) {
      setCollections((prev) =>
        prev.map((c) => {
          if (c.id !== entry.collectionId) return c;
          const newRequests = [...c.requests];
          newRequests.splice(entry.requestIndex ?? 0, 0, entry.request!);
          return { ...c, requests: newRequests };
        }),
      );
      addToast({ type: "success", message: `"${entry.request.name}" restored` });
    } else if (entry.type === "deleteCollection" && entry.collection) {
      setCollections((prev) => {
        const newCols = [...prev];
        newCols.splice(entry.collectionIndex ?? prev.length, 0, entry.collection!);
        return newCols;
      });
      addToast({ type: "success", message: `"${entry.collection.name}" restored` });
    }
  }, [addToast]);

  // ── 加载与持久化：环境变量 ──

  useEffect(() => {
    invoke<EnvironmentData>("load_environments")
      .then((data) => {
        setEnvironments(data.environments);
        setActiveEnvironmentId(data.active_id);
      })
      .catch((e) => console.error("Failed to load environments:", e))
      .finally(() => setEnvLoaded(true));
  }, []);

  useEffect(() => {
    if (!envLoaded) return;
    invoke("save_environments", {
      data: { environments, active_id: activeEnvironmentId },
    }).catch((e) => console.error("Failed to save environments:", e));
  }, [environments, activeEnvironmentId, envLoaded]);

  // ── 加载与持久化：请求集合 ──

  useEffect(() => {
    invoke<CollectionData | null>("load_collections")
      .then((data) => {
        if (data?.collections?.length) {
          setCollections(data.collections);
        }
      })
      .catch((e) => console.error("Failed to load collections:", e))
      .finally(() => setCollectionsLoaded(true));
  }, []);

  useEffect(() => {
    if (!collectionsLoaded) return;
    invoke("save_collections", {
      data: { collections },
    }).catch((e) => console.error("Failed to save collections:", e));
  }, [collections, collectionsLoaded]);

  // ── 数据迁移：将 Environment 中的 base_url 迁移到 Collection ──

  const baseUrlMigrated = useRef(false);

  useEffect(() => {
    if (!envLoaded || !collectionsLoaded) return;
    if (baseUrlMigrated.current) return;

    const oldEnvs = environments as unknown as Array<{ id: string; base_url?: string }>;
    const hasOldBaseUrl = oldEnvs.some((e) => e.base_url);
    if (!hasOldBaseUrl) {
      baseUrlMigrated.current = true;
      return;
    }

    const active = oldEnvs.find((e) => e.id === activeEnvironmentId);
    const envBaseUrl = active?.base_url ?? '';
    if (envBaseUrl) {
      setCollections((prev) =>
        prev.map((c) => ({
          ...c,
          base_url: c.base_url || envBaseUrl,
        })),
      );
    }

    setEnvironments((prev) =>
      prev.map((e) => {
        const { base_url: _removed, ...rest } = e as unknown as { base_url?: string };
        return rest;
      }) as Environment[],
    );
    baseUrlMigrated.current = true;
  }, [envLoaded, collectionsLoaded, environments, activeEnvironmentId]);

  // ── 核心：发送 HTTP 请求 ──

  const sendRequest = useCallback(async () => {
    // 读取当前标签页的最新状态
    const {
      method: tabMethod,
      url: tabUrl,
      headers: tabHeaders,
      body: tabBody,
      bodyParams: tabBodyParams,
      contentType: tabContentType,
      authType: tabAuthType,
      bearerToken: tabBearerToken,
      editingRequest: tabEditingRequest,
    } = activeTab;

    if (!tabUrl.trim()) return;

    // 捕获发起请求时的标签页 ID
    const requestTabId = activeTabId;

    setTabs((prev) =>
      prev.map((t) =>
        t.id === requestTabId
          ? { ...t, isLoading: true, error: null, response: null }
          : t,
      ),
    );

    try {
      let cleanHeaders = tabHeaders.filter((h) => h.key.trim() !== "");

      // 解析认证继承链
      let resolvedAuthType = tabAuthType;
      let resolvedBearerToken = tabBearerToken;
      if (tabAuthType === "inherit") {
        if (tabEditingRequest) {
          const col = collections.find((c) => c.id === tabEditingRequest.collectionId);
          if (col) {
            resolvedAuthType = col.authType === "inherit" ? "none" : col.authType;
            resolvedBearerToken = col.bearerToken;
          } else {
            resolvedAuthType = "none";
          }
        } else {
          resolvedAuthType = "none";
        }
      }

      if (resolvedAuthType === "bearer" && resolvedBearerToken.trim()) {
        cleanHeaders = cleanHeaders.filter(
          (h) => h.key.toLowerCase() !== "authorization",
        );
        cleanHeaders.push({
          key: "Authorization",
          value: resolvedBearerToken.trim(),
          enabled: true,
        });
      }

      const activeEnv = environments.find((e) => e.id === activeEnvironmentId);
      const activeVars: EnvironmentVariable[] =
        activeEnv?.variables.filter((v) => v.enabled) ?? [];

      // 合并 Collection 变量与环境变量（环境变量优先级更高）
      const mergedVars = mergeRequestVariables(activeVars, collections, tabEditingRequest?.collectionId);

      let collectionBaseUrl = '';
      if (tabEditingRequest) {
        const col = collections.find((c) => c.id === tabEditingRequest.collectionId);
        if (col?.base_url) {
          collectionBaseUrl = col.base_url;
        }
      }

      let finalUrl = tabUrl.trim();
      if (collectionBaseUrl && !finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        const base = collectionBaseUrl.replace(/\/+$/, '');
        const path = finalUrl.startsWith('/') ? finalUrl : '/' + finalUrl;
        finalUrl = base + path;
      }

      let finalBody = tabBody;
      if (tabContentType === "application/x-www-form-urlencoded") {
        finalBody = serializeBodyParams(tabBodyParams);
      }

      const result = await invoke<ResponseData>("send_request", {
        input: {
          method: tabMethod,
          url: finalUrl,
          headers: cleanHeaders,
          body: finalBody || null,
          content_type: tabContentType || null,
        },
        variables: mergedVars,
      });

      setTabs((prev) =>
        prev.map((t) =>
          t.id === requestTabId ? { ...t, response: result, isLoading: false } : t,
        ),
      );
      setHistory((prev) => [
        {
          id: crypto.randomUUID(),
          method: tabMethod,
          url: tabUrl.trim(),
          status: result.status,
          timestamp: Date.now(),
        },
        ...prev.slice(0, 49),
      ]);
    } catch (e) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === requestTabId
            ? { ...t, error: typeof e === "string" ? e : "Request failed", isLoading: false }
            : t,
        ),
      );
    }
  }, [activeTab, activeTabId, environments, activeEnvironmentId, collections, addToast]);

  // ── 从历史加载请求 ──

  const loadFromHistory = useCallback(
    (item: HistoryItem) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? { ...t, method: item.method as HttpMethod, url: item.url, rawParams: parseUrlParams(item.url), editingRequest: null, savedSnapshot: null }
            : t,
        ),
      );
    },
    [activeTabId],
  );

  // ── 从集合加载请求 ──

  const loadCollectionRequest = useCallback(
    (item: RequestItem, collectionId: string) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId) return t;
          const updated = {
            ...t,
            method: item.method as HttpMethod,
            url: item.url,
            headers: item.headers?.length ? item.headers : [{ key: "", value: "", enabled: true }],
            body: item.body ?? "",
            contentType: item.contentType ?? "application/json",
            bodyParams: item.bodyParams?.length
              ? item.bodyParams
              : ((item.contentType ?? "application/json") === "application/x-www-form-urlencoded" && item.body
                ? parseBodyParams(item.body)
                : [{ key: "", value: "", enabled: true }]),
            authType: (item.authType as AuthType) ?? "none",
            bearerToken: item.bearerToken ?? "",
            rawParams: item.params?.length ? item.params : [{ key: "", value: "", enabled: true }],
            editingRequest: { collectionId, requestId: item.id },
          };
          // 立即设置已保存快照
          updated.savedSnapshot = {
            method: updated.method,
            url: updated.url.trim(),
            headers: updated.headers,
            body: updated.body,
            bodyParams: updated.bodyParams,
            contentType: updated.contentType,
            authType: updated.authType,
            bearerToken: updated.bearerToken,
            rawParams: updated.rawParams,
          };
          return updated;
        }),
      );
    },
    [activeTabId],
  );

  // ── 新建请求（创建空白标签页） ──

  const newRequest = useCallback(() => {
    const tab = createBlankTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  // ── 内联保存命名对话框状态 ──

  const [saveDialogVisible, setSaveDialogVisible] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState("");

  const saveCurrentRequest = useCallback(() => {
    const {
      method: tabMethod,
      url: tabUrl,
      headers: tabHeaders,
      body: tabBody,
      bodyParams: tabBodyParams,
      contentType: tabContentType,
      authType: tabAuthType,
      bearerToken: tabBearerToken,
      rawParams: tabRawParams,
      editingRequest: tabEditingRequest,
    } = activeTab;

    const bodyToSave = tabContentType === "application/x-www-form-urlencoded"
      ? serializeBodyParams(tabBodyParams)
      : tabBody;

    const filteredHeaders = tabHeaders
      .filter((h) => h.key.trim())
      .concat(
        tabHeaders.some((h) => h.key.trim()) ? [] : [{ key: "", value: "", enabled: true } as HeaderInput],
      );
    if (filteredHeaders.length === 0) {
      filteredHeaders.push({ key: "", value: "", enabled: true });
    }

    if (tabEditingRequest) {
      setCollections((prev) =>
        prev.map((c) =>
          c.id === tabEditingRequest.collectionId
            ? {
                ...c,
                requests: c.requests.map((r) =>
                  r.id === tabEditingRequest.requestId
                    ? {
                        ...r,
                        name: r.name,
                        method: tabMethod,
                        url: tabUrl.trim(),
                        headers: filteredHeaders,
                        body: bodyToSave,
                        contentType: tabContentType,
                        authType: tabAuthType,
                        bearerToken: tabBearerToken,
                        params: tabRawParams,
                        bodyParams: tabBodyParams,
                      }
                    : r,
                ),
              }
            : c,
        ),
      );
      requestAnimationFrame(() => { updateActiveSnapshot(); });
      addToast({ type: "success", message: "Request updated" });
    } else {
      const defaultName = tabUrl.trim()
        ? tabUrl.trim().split("/").filter(Boolean).pop() || tabUrl.trim()
        : "New Request";
      setSaveDialogName(defaultName);
      setSaveDialogVisible(true);
    }
  }, [activeTab, collections, updateActiveSnapshot, addToast]);

  const confirmSave = useCallback(() => {
    const name = saveDialogName.trim();
    if (!name) return;

    const {
      method: tabMethod,
      url: tabUrl,
      headers: tabHeaders,
      body: tabBody,
      bodyParams: tabBodyParams,
      contentType: tabContentType,
      authType: tabAuthType,
      bearerToken: tabBearerToken,
      rawParams: tabRawParams,
    } = activeTab;

    const bodyToSave = tabContentType === "application/x-www-form-urlencoded"
      ? serializeBodyParams(tabBodyParams)
      : tabBody;

    const filteredHeaders = tabHeaders
      .filter((h) => h.key.trim())
      .concat(
        tabHeaders.some((h) => h.key.trim()) ? [] : [{ key: "", value: "", enabled: true } as HeaderInput],
      );
    if (filteredHeaders.length === 0) {
      filteredHeaders.push({ key: "", value: "", enabled: true });
    }

    const newReq: RequestItem = {
      id: crypto.randomUUID(),
      name,
      method: tabMethod,
      url: tabUrl.trim(),
      headers: filteredHeaders,
      body: bodyToSave,
      contentType: tabContentType,
      authType: tabAuthType,
      bearerToken: tabBearerToken,
      params: tabRawParams,
      bodyParams: tabBodyParams,
    };

    let colId: string;
    if (collections.length === 0) {
      colId = crypto.randomUUID();
      setCollections([
        { id: colId, name: "My Collection", base_url: '', authType: "inherit", bearerToken: "", requests: [newReq] },
      ]);
    } else {
      colId = collections[0].id;
      setCollections((prev) =>
        prev.map((c) =>
          c.id === colId
            ? { ...c, requests: [...c.requests, newReq] }
            : c,
        ),
      );
    }

    // 更新当前标签页的 editingRequest
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, editingRequest: { collectionId: colId, requestId: newReq.id } }
          : t,
      ),
    );

    setSaveDialogVisible(false);
    requestAnimationFrame(() => { updateActiveSnapshot(); });
    const colName = collections.find((c) => c.id === colId)?.name ?? "My Collection";
    addToast({ type: "success", message: `Saved to ${colName}` });
  }, [saveDialogName, activeTab, activeTabId, collections, updateActiveSnapshot, addToast]);

  const cancelSave = useCallback(() => {
    setSaveDialogVisible(false);
  }, []);

  // ── 集合 CRUD ──

  const deleteCollectionRequest = useCallback(
    (collectionId: string, requestId: string) => {
      const col = collections.find((c) => c.id === collectionId);
      const req = col?.requests.find((r) => r.id === requestId);
      if (!req) return;
      setConfirmDialog({
        type: "deleteRequest",
        collectionId,
        requestId,
        requestName: req.name,
      });
    },
    [collections],
  );

  const renameCollectionRequest = useCallback(
    (collectionId: string, requestId: string) => {
      const col = collections.find((c) => c.id === collectionId);
      const req = col?.requests.find((r) => r.id === requestId);
      if (!req) return;
      const name =
        window.prompt("Rename request:", req.name) ?? "";
      if (!name.trim()) return;
      setCollections((prev) =>
        prev.map((c) =>
          c.id === collectionId
            ? {
                ...c,
                requests: c.requests.map((r) =>
                  r.id === requestId ? { ...r, name: name.trim() } : r,
                ),
              }
            : c,
        ),
      );
    },
    [collections],
  );

  const addCollection = useCallback(() => {
    const name =
      window.prompt("Collection name:", `Collection ${collections.length + 1}`) ?? "";
    if (!name.trim()) return;
    const newCol: Collection = {
      id: crypto.randomUUID(),
      name: name.trim(),
      base_url: '',
      authType: "inherit",
      bearerToken: "",
      requests: [],
    };
    setCollections((prev) => [...prev, newCol]);
  }, [collections.length]);

  const deleteCollection = useCallback(
    (collectionId: string) => {
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      setConfirmDialog({
        type: "deleteCollection",
        collectionId,
        collectionName: col.name,
      });
    },
    [collections],
  );

  const updateCollectionAuth = useCallback(
    (collectionId: string, authType: AuthType, bearerToken: string) => {
      setCollections((prev) =>
        prev.map((c) =>
          c.id === collectionId ? { ...c, authType, bearerToken } : c,
        ),
      );
    },
    [],
  );

  const moveRequest = useCallback(
    (sourceColId: string, requestId: string, targetColId: string, targetIndex: number) => {
      setCollections((prev) => {
        const sourceCol = prev.find((c) => c.id === sourceColId);
        if (!sourceCol) return prev;
        const req = sourceCol.requests.find((r) => r.id === requestId);
        if (!req) return prev;

        const withoutReq = sourceCol.requests.filter((r) => r.id !== requestId);

        if (sourceColId === targetColId) {
          const newRequests = [...withoutReq];
          newRequests.splice(targetIndex, 0, req);
          return prev.map((c) =>
            c.id === sourceColId ? { ...c, requests: newRequests } : c,
          );
        }

        return prev.map((c) => {
          if (c.id === sourceColId) {
            return { ...c, requests: withoutReq };
          }
          if (c.id === targetColId) {
            const newRequests = [...c.requests];
            newRequests.splice(targetIndex, 0, req);
            return { ...c, requests: newRequests };
          }
          return c;
        });
      });
    },
    [],
  );

  const moveCollection = useCallback((collectionId: string, targetIndex: number) => {
    setCollections((prev) => {
      const idx = prev.findIndex((c) => c.id === collectionId);
      if (idx === -1) return prev;
      const col = prev[idx];
      const without = prev.filter((c) => c.id !== collectionId);
      const result = [...without];
      result.splice(targetIndex, 0, col);
      return result;
    });
  }, []);

  // 获取当前编辑请求所属的集合名称
  const editingCollectionName = useMemo(
    () => {
      if (!activeTab.editingRequest) return null;
      return collections.find((c) => c.id === activeTab.editingRequest!.collectionId)?.name ?? null;
    },
    [activeTab.editingRequest, collections],
  );

  // 获取当前编辑请求的名称
  const editingRequestName = useMemo(
    () => {
      if (!activeTab.editingRequest) return null;
      return collections
        .find((c) => c.id === activeTab.editingRequest!.collectionId)
        ?.requests.find((r) => r.id === activeTab.editingRequest!.requestId)?.name ?? null;
    },
    [activeTab.editingRequest, collections],
  );

  // ── 环境 CRUD ──

  const addEnvironment = useCallback(() => {
    const newEnv: Environment = {
      id: crypto.randomUUID(),
      name: `New Environment ${environments.length + 1}`,
      variables: [{ key: "", value: "", enabled: true }],
    };
    setEnvironments((prev) => [...prev, newEnv]);
  }, [environments.length]);

  const deleteEnvironment = useCallback((id: string) => {
    setEnvironments((prev) => prev.filter((e) => e.id !== id));
    setActiveEnvironmentId((prev) => (prev === id ? null : prev));
  }, []);

  const renameEnvironment = useCallback((id: string, name: string) => {
    setEnvironments((prev) =>
      prev.map((e) => (e.id === id ? { ...e, name } : e)),
    );
  }, []);

  const updateCollectionBaseUrl = useCallback((collectionId: string, baseUrl: string) => {
    setCollections((prev) =>
      prev.map((c) => (c.id === collectionId ? { ...c, base_url: baseUrl } : c)),
    );
  }, []);

  /**
   * 更新集合的变量
   * 集合变量作为 {{key}} 替换的默认值（环境变量可覆盖）
   */
  const updateCollectionVariables = useCallback((collectionId: string, variables: Record<string, string>) => {
    setCollections((prev) =>
      prev.map((c) => (c.id === collectionId ? { ...c, variables } : c)),
    );
  }, []);

  const setActiveEnvironment = useCallback((id: string | null) => {
    setActiveEnvironmentId(id);
  }, []);

  const addVariable = useCallback((envId: string) => {
    setEnvironments((prev) =>
      prev.map((e) =>
        e.id === envId
          ? { ...e, variables: [...e.variables, { key: "", value: "", enabled: true }] }
          : e,
      ),
    );
  }, []);

  const updateVariable = useCallback(
    (envId: string, index: number, field: keyof EnvironmentVariable, value: string | boolean) => {
      setEnvironments((prev) =>
        prev.map((e) =>
          e.id === envId
            ? {
                ...e,
                variables: e.variables.map((v, i) =>
                  i === index ? { ...v, [field]: value } : v,
                ),
              }
            : e,
        ),
      );
    },
    [],
  );

  const removeVariable = useCallback((envId: string, index: number) => {
    setEnvironments((prev) =>
      prev.map((e) =>
        e.id === envId
          ? { ...e, variables: e.variables.filter((_, i) => i !== index) }
          : e,
      ),
    );
  }, []);

  // ── 导入/导出 ──

  const [importDialogVisible, setImportDialogVisible] = useState(false);
  const [exportDialogVisible, setExportDialogVisible] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importStrategy, setImportStrategy] = useState<ImportExportStrategy>("replace");
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const openImportDialog = useCallback(() => {
    setImportPreview(null);
    setImportFileName("");
    setPendingImportPath(null);
    setImportError(null);
    setImportStrategy("replace");
    setImportDialogVisible(true);
  }, []);

  const closeImportDialog = useCallback(() => {
    setImportDialogVisible(false);
    setImportPreview(null);
    setImportFileName("");
    setPendingImportPath(null);
    setImportError(null);
  }, []);

  const openExportDialog = useCallback(() => {
    setExportDialogVisible(true);
  }, []);

  const closeExportDialog = useCallback(() => {
    setExportDialogVisible(false);
  }, []);

  const handlePickImportFile = useCallback(async () => {
    try {
      setImportError(null);
      const path = await invoke<string | null>("pick_import_file", {});
      if (!path) return;

      const preview = await invoke<ImportPreview>("preview_import", { path });
      setImportPreview(preview);
      setImportFileName(path.split(/[/\\]/).pop() || path);
      setPendingImportPath(path);
    } catch (e) {
      setImportError(typeof e === "string" ? e : "Failed to read file");
    }
  }, []);

  const refreshData = useCallback(async () => {
    try {
      const cd = await invoke<CollectionData | null>("load_collections");
      if (cd?.collections?.length) {
        setCollections(cd.collections);
      }
      const ed = await invoke<EnvironmentData>("load_environments");
      setEnvironments(ed.environments);
      setActiveEnvironmentId(ed.active_id);
    } catch (e) {
      console.error("Failed to refresh data:", e);
    }
  }, []);

  const handleConfirmImport = useCallback(async () => {
    if (!pendingImportPath) return;
    try {
      setImportError(null);
      const result = await invoke<ImportResult>("import_data_from_file", {
        path: pendingImportPath,
        strategy: importStrategy,
      });

      await refreshData();

      addToast({
        type: "success",
        message: `Imported ${result.collections_count} collections and ${result.environments_count} environments`,
      });
      closeImportDialog();
    } catch (e) {
      setImportError(typeof e === "string" ? e : "Import failed");
    }
  }, [pendingImportPath, importStrategy, refreshData, addToast, closeImportDialog]);

  const handleExport = useCallback(async (format: string, collectionIds: string[]) => {
    try {
      const fileName = await invoke<string | null>("export_data_to_file", {
        format,
        collectionIds,
      });
      if (!fileName) return;

      addToast({
        type: "success",
        message: `Exported to ${fileName}`,
      });
      closeExportDialog();
    } catch (e) {
      addToast({
        type: "error",
        message: typeof e === "string" ? e : "Export failed",
      });
    }
  }, [addToast, closeExportDialog]);

  // ── Test Script 状态管理 ──

  const [testScriptDialogVisible, setTestScriptDialogVisible] = useState(false);
  const [testRunResult, setTestRunResult] = useState<TestRunResult | null>(null);
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [testRunError, setTestRunError] = useState<string | null>(null);
  const [pendingTestScriptPath, setPendingTestScriptPath] = useState<string | null>(null);
  const [testScriptFileName, setTestScriptFileName] = useState("");

  const openTestScriptDialog = useCallback(() => {
    setTestRunResult(null);
    setTestRunError(null);
    setPendingTestScriptPath(null);
    setTestScriptFileName("");
    setTestScriptDialogVisible(true);
  }, []);

  const closeTestScriptDialog = useCallback(() => {
    setTestScriptDialogVisible(false);
    setTestRunResult(null);
    setTestRunError(null);
  }, []);

  const handlePickTestScript = useCallback(async () => {
    try {
      setTestRunError(null);
      const path = await invoke<string | null>("pick_test_script_file", {});
      if (!path) return;
      setTestScriptFileName(path.split(/[/\\]/).pop() || path);
      setPendingTestScriptPath(path);
      setTestRunResult(null);
    } catch (e) {
      setTestRunError(typeof e === "string" ? e : "Failed to select file");
    }
  }, []);

  const handleRunTestScript = useCallback(async () => {
    if (!pendingTestScriptPath) return;
    setIsTestRunning(true);
    setTestRunResult(null);
    setTestRunError(null);
    try {
      const activeEnv = environments.find((e) => e.id === activeEnvironmentId);
      const activeVars: EnvironmentVariable[] =
        activeEnv?.variables.filter((v) => v.enabled) ?? [];
      const result = await invoke<TestRunResult>("run_test_script", {
        path: pendingTestScriptPath,
        variables: activeVars,
      });
      setTestRunResult(result);
    } catch (e) {
      setTestRunError(typeof e === "string" ? e : "Test run failed");
    } finally {
      setIsTestRunning(false);
    }
  }, [pendingTestScriptPath, environments, activeEnvironmentId]);

  // ============================================================
  // 应用设置状态管理
  // ============================================================

  /** 应用设置（UI 缩放、字体等） */
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  /** 标记：设置数据是否已从 Rust 加载完成 */
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  /** 设置面板是否可见 */
  const [settingsDialogVisible, setSettingsDialogVisible] = useState(false);

  // 启动时从 Rust 加载设置
  useEffect(() => {
    invoke<AppSettings>("load_settings")
      .then((data) => {
        setSettings(data);
        setSettingsLoaded(true);
      })
      .catch(() => {
        // settings.json 不存在时使用默认值
        setSettingsLoaded(true);
      });
  }, []);

  // 设置变化时调用 Rust 持久化（带 300ms 防抖）
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!settingsLoaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      invoke("save_settings", { data: settings }).catch(() => {
        // 静默处理保存失败
      });
    }, 300);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [settings, settingsLoaded]);

  // 缩放变化时通过 Tauri 原生 API 设置 WebView 缩放（与 VS Code 一致的方式）
  useEffect(() => {
    if (!settingsLoaded) return;
    getCurrentWebviewWindow().setZoom(settings.zoomLevel).catch(() => {
      // WebView 尚未准备好时静默忽略
    });
  }, [settings.zoomLevel, settingsLoaded]);

  /** 合并更新部分设置字段 */
  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  /** 打开设置面板 */
  const openSettingsDialog = useCallback(() => {
    setSettingsDialogVisible(true);
  }, []);

  /** 关闭设置面板 */
  const closeSettingsDialog = useCallback(() => {
    setSettingsDialogVisible(false);
  }, []);

  // ============================================================
  // 导出状态和方法
  // ============================================================

  return {
    authType,
    setAuthType,
    bearerToken,
    setBearerToken,
    method,
    setMethod,
    url,
    onUrlChange: handleUrlChange,
    headers,
    body,
    setBody,
    bodyParams,
    addBodyParam,
    updateBodyParam,
    removeBodyParam,
    contentType,
    setContentType,
    rawParams,
    addParam,
    updateParam,
    removeParam,
    requestTab,
    setRequestTab,
    response,
    isLoading,
    error,
    responseTab,
    setResponseTab,
    collections,
    history,
    sidebarTab,
    setSidebarTab,
    sendRequest,
    addHeader,
    updateHeader,
    removeHeader,
    loadFromHistory,
    loadCollectionRequest,
    clearResponse,
    /* ── 集合 CRUD ── */
    newRequest,
    saveCurrentRequest,
    deleteCollectionRequest,
    renameCollectionRequest,
    addCollection,
    deleteCollection,
    updateCollectionAuth,
    updateCollectionBaseUrl,
    updateCollectionVariables,
    moveRequest,
    moveCollection,
    editingCollectionName,
    editingRequestName,
    editingRequest,
    /* ── Toast 通知 ── */
    toasts,
    addToast,
    dismissToast,
    /* ── 脏状态跟踪 ── */
    isDirty,
    /* ── 删除确认对话框 ── */
    confirmDialog,
    confirmDestructive,
    cancelDestructive,
    undoLastDelete,
    /* ── 保存命名对话框 ── */
    saveDialogVisible,
    saveDialogName,
    setSaveDialogName,
    confirmSave,
    cancelSave,
    /* ── 环境 CRUD ── */
    environments,
    activeEnvironmentId,
    addEnvironment,
    deleteEnvironment,
    renameEnvironment,
    setActiveEnvironment,
    addVariable,
    updateVariable,
    removeVariable,
    /* ── 导入/导出 ── */
    importDialogVisible,
    exportDialogVisible,
    importPreview,
    importFileName,
    importStrategy,
    setImportStrategy,
    importError,
    pendingImportPath,
    openImportDialog,
    closeImportDialog,
    openExportDialog,
    closeExportDialog,
    handlePickImportFile,
    handleConfirmImport,
    handleExport,
    refreshData,
    /* ── Test Script ── */
    testScriptDialogVisible,
    openTestScriptDialog,
    closeTestScriptDialog,
    testScriptFileName,
    pendingTestScriptPath,
    isTestRunning,
    testRunResult,
    testRunError,
    handlePickTestScript,
    handleRunTestScript,
    /* ── 应用设置 ── */
    settings,
    settingsLoaded,
    settingsDialogVisible,
    updateSettings,
    openSettingsDialog,
    closeSettingsDialog,
    /* ── 标签页管理（新增） ── */
    tabs,
    activeTabId,
    newTab,
    closeTab,
    switchTab,
    openInTab,
  };
}
