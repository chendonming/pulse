import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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
} from "../types";
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
// 应用状态管理 Hook
//
// 设计理念：单一 Hook 管理所有应用状态，通过 props 下发给子组件。
// 不使用 Context 或 Redux——对当前规模而言 props 穿透是刻意的简化。
// ============================================================

export function usePulse() {
  // ── 请求参数状态 ──
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderInput[]>([
    { key: "", value: "", enabled: true },
  ]);
  const [body, setBody] = useState("");
  // 请求体键值对（用于 application/x-www-form-urlencoded 类型）
  const [bodyParams, setBodyParams] = useState<HeaderInput[]>([
    { key: "", value: "", enabled: true },
  ]);
  const [contentType, setContentType] = useState("application/json");
  // 请求级认证
  const [authType, setAuthType] = useState<AuthType>("none");
  const [bearerToken, setBearerToken] = useState("");
  // URL 查询参数（与 URL 双向同步）
  const [rawParams, setRawParams] = useState<HeaderInput[]>([
    { key: "", value: "", enabled: true },
  ]);
  // 请求面板 Tab（由 ShortcutEngine 的标签切换快捷键控制，保留在全局便于 App.tsx 注册命令）
  const [requestTab, setRequestTab] = useState<RequestTab>("headers");

  // ── 响应状态 ──
  const [response, setResponse] = useState<ResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 响应面板 Tab（Body / Headers）
  const [responseTab, setResponseTab] = useState<"body" | "headers">("body");

  // 请求面板 Tab 状态已移至 RequestPanel 组件内部，不再由全局状态管理
  // 避免切换 Tab 时触发 App 级重渲染导致 Sidebar 和 ResponsePanel 不必要的重渲染

  // ── 持久化数据 ──
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
  const [envLoaded, setEnvLoaded] = useState(false);          // 标记：环境数据是否已从 Rust 加载完成
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);  // 标记：集合数据是否已加载完成

  // ── 当前编辑的请求信息（用于保存时定位到集合） ──
  const [editingRequest, setEditingRequest] = useState<{
    collectionId: string;
    requestId: string;
  } | null>(null);

  // ── Toast 通知状态 ──
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  /** 添加 Toast 通知 */
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

  /** 手动关闭 Toast */
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── 脏状态跟踪（未保存更改检测） ──
  const [isDirty, setIsDirty] = useState(false);
  const savedSnapshot = useRef<{
    method: string;
    url: string;
    headers: HeaderInput[];
    body: string;
    bodyParams: HeaderInput[];
    contentType: string;
    authType: string;
    bearerToken: string;
    rawParams: HeaderInput[];
  } | null>(null);

  /** 更新已保存状态快照（在加载/保存请求后调用） */
  const updateSnapshot = useCallback(() => {
    savedSnapshot.current = {
      method,
      url: url.trim(),
      headers,
      body,
      bodyParams,
      contentType,
      authType,
      bearerToken,
      rawParams,
    };
    setIsDirty(false);
  }, [method, url, headers, body, bodyParams, contentType, authType, bearerToken, rawParams]);

  /** 脏状态比较：当请求参数变化时自动更新 isDirty */
  useEffect(() => {
    if (!savedSnapshot.current) { setIsDirty(false); return; }
    const s = savedSnapshot.current;
    const changed =
      method !== s.method ||
      url.trim() !== s.url ||
      JSON.stringify(headers) !== JSON.stringify(s.headers) ||
      body !== s.body ||
      JSON.stringify(bodyParams) !== JSON.stringify(s.bodyParams) ||
      contentType !== s.contentType ||
      authType !== s.authType ||
      bearerToken !== s.bearerToken ||
      JSON.stringify(rawParams) !== JSON.stringify(s.rawParams);
    setIsDirty(changed);
  }, [method, url, headers, body, bodyParams, contentType, authType, bearerToken, rawParams]);

  // ── 删除确认对话框状态 ──
  const [confirmDialog, setConfirmDialog] = useState<{
    type: "deleteRequest" | "deleteCollection";
    collectionId: string;
    requestId?: string;
    requestName?: string;
    collectionName?: string;
  } | null>(null);

  /** 撤销删除栈（最多保存 30 秒内的操作） */
  const undoStack = useRef<Array<{
    type: "deleteRequest";
    collectionId: string;
    requestIndex: number;
    request: RequestItem;
    timestamp: number;
  }>>([]);

  /** 确认危险操作 */
  const confirmDestructive = useCallback(() => {
    if (!confirmDialog) return;
    if (confirmDialog.type === "deleteRequest") {
      const { collectionId, requestId, requestName } = confirmDialog;
      // 执行删除前捕获索引
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
      // 如果删除的请求正在编辑，清除编辑状态
      if (
        editingRequest?.collectionId === collectionId &&
        editingRequest?.requestId === requestId
      ) {
        setEditingRequest(null);
      }

      // 推入撤销栈
      if (deletedReq && reqIndex >= 0) {
        undoStack.current.push({
          type: "deleteRequest",
          collectionId,
          requestIndex: reqIndex,
          request: deletedReq,
          timestamp: Date.now(),
        });
        // 自动清理超过 30 秒的旧记录
        const now = Date.now();
        undoStack.current = undoStack.current.filter((e) => now - e.timestamp < 30000);
      }

      // 弹出含撤销按钮的 Toast
      addToast({
        type: "info",
        message: `Deleted "${requestName ?? deletedReq?.name ?? "Untitled"}"`,
        duration: 5000,
        action: { label: "Undo", onClick: undoLastDelete },
      });
    }
    setConfirmDialog(null);
  }, [confirmDialog, collections, editingRequest, addToast]);

  /** 取消危险操作 */
  const cancelDestructive = useCallback(() => {
    setConfirmDialog(null);
  }, []);

  /** 撤销上一次删除 */
  const undoLastDelete = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    if (entry.type === "deleteRequest") {
      setCollections((prev) =>
        prev.map((c) => {
          if (c.id !== entry.collectionId) return c;
          const newRequests = [...c.requests];
          newRequests.splice(entry.requestIndex, 0, entry.request);
          return { ...c, requests: newRequests };
        }),
      );
      addToast({ type: "success", message: `"${entry.request.name}" restored` });
    }
  }, [addToast]);

  // ── 加载与持久化：环境变量 ──

  // 启动时从 Rust 加载环境变量（通过 Tauri invoke）
  useEffect(() => {
    invoke<EnvironmentData>("load_environments")
      .then((data) => {
        setEnvironments(data.environments);
        setActiveEnvironmentId(data.active_id);
      })
      .catch((e) => console.error("Failed to load environments:", e))
      .finally(() => setEnvLoaded(true));
  }, []);

  // 环境数据变化时自动持久化到 Rust（跳过初始加载）
  useEffect(() => {
    if (!envLoaded) return;
    invoke("save_environments", {
      data: { environments, active_id: activeEnvironmentId },
    }).catch((e) => console.error("Failed to save environments:", e));
  }, [environments, activeEnvironmentId, envLoaded]);

  // ── 加载与持久化：请求集合 ──

  // 启动时从 Rust 加载集合数据
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

  // 集合数据变化时自动持久化到 Rust（跳过初始加载）
  useEffect(() => {
    if (!collectionsLoaded) return;
    invoke("save_collections", {
      data: { collections },
    }).catch((e) => console.error("Failed to save collections:", e));
  }, [collections, collectionsLoaded]);

  // ── 数据迁移：将 Environment 中的 base_url 迁移到 Collection ──
  // 旧版本中 base_url 存储在 Environment 中，新版本改为 Collection 级配置。
  // 首次加载时，自动将激活环境的 base_url 复制到所有集合中，然后清空环境上的 base_url。
  const baseUrlMigrated = useRef(false);

  useEffect(() => {
    if (!envLoaded || !collectionsLoaded) return;
    if (baseUrlMigrated.current) return;

    // 从已加载的旧数据中读取 base_url（Environment 类型已无该字段）
    const oldEnvs = environments as unknown as Array<{ id: string; base_url?: string }>;
    const hasOldBaseUrl = oldEnvs.some((e) => e.base_url);
    if (!hasOldBaseUrl) {
      baseUrlMigrated.current = true;
      return;
    }

    // 取激活环境的 base_url 作为迁移源
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

    // 清除所有环境上的 base_url
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
    if (!url.trim()) return;

    setIsLoading(true);
    setError(null);
    setResponse(null);

    try {
      let cleanHeaders = headers.filter((h) => h.key.trim() !== "");

      // 解析认证继承链：请求级 "inherit" → 查找所属集合的认证配置
      let resolvedAuthType = authType;
      let resolvedBearerToken = bearerToken;
      if (authType === "inherit") {
        if (editingRequest) {
          const col = collections.find((c) => c.id === editingRequest.collectionId);
          if (col) {
            // 如果集合也是 "inherit"，退化为 "none"
            resolvedAuthType = col.authType === "inherit" ? "none" : col.authType;
            resolvedBearerToken = col.bearerToken;
          } else {
            resolvedAuthType = "none";
          }
        } else {
          resolvedAuthType = "none";
        }
      }

      // Bearer Token 认证：直接使用 token 原始值作为 Authorization 请求头，不做前缀处理
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

      // 获取当前激活环境中启用的变量（用于 {{key}} 模板替换）
      const activeEnv = environments.find((e) => e.id === activeEnvironmentId);
      const activeVars: EnvironmentVariable[] =
        activeEnv?.variables.filter((v) => v.enabled) ?? [];

      // Base URL 拼接：从正在编辑的请求所属的 Collection 获取 base_url
      let collectionBaseUrl = '';
      if (editingRequest) {
        const col = collections.find((c) => c.id === editingRequest.collectionId);
        if (col?.base_url) {
          collectionBaseUrl = col.base_url;
        }
      }

      let finalUrl = url.trim();
      if (collectionBaseUrl && !finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        const base = collectionBaseUrl.replace(/\/+$/, ''); // 去掉末尾斜杠
        const path = finalUrl.startsWith('/') ? finalUrl : '/' + finalUrl;
        finalUrl = base + path;
      }

      // 步骤：根据 Content-Type 决定请求体
      // - application/x-www-form-urlencoded → 将 bodyParams 序列化为 URL 编码字符串
      // - 其他类型 → 使用原始 body 文本
      let finalBody = body;
      if (contentType === "application/x-www-form-urlencoded") {
        finalBody = serializeBodyParams(bodyParams);
      }

      const result = await invoke<ResponseData>("send_request", {
        input: {
          method,
          url: finalUrl,
          headers: cleanHeaders,
          body: finalBody || null,
          content_type: contentType || null,
        },
        variables: activeVars,
      });
      setResponse(result);
      // 添加到历史记录（最多保留 50 条）
      setHistory((prev) => [
        {
          id: crypto.randomUUID(),
          method,
          url: url.trim(),
          status: result.status,
          timestamp: Date.now(),
        },
        ...prev.slice(0, 49),
      ]);
    } catch (e) {
      setError(typeof e === "string" ? e : "Request failed");
    } finally {
      setIsLoading(false);
    }
  }, [method, url, headers, body, bodyParams, contentType, authType, bearerToken, environments, activeEnvironmentId, collections, editingRequest]);

  // ── 请求头 CRUD ──

  const addHeader = useCallback(() => {
    setHeaders((prev) => [...prev, { key: "", value: "", enabled: true }]);
  }, []);

  const updateHeader = useCallback(
    (index: number, field: keyof HeaderInput, value: string | boolean) => {
      setHeaders((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
    },
    [],
  );

  const removeHeader = useCallback((index: number) => {
    setHeaders((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── URL / 查询参数双向同步 ──
  //
  // 用户在 URL 输入框中输入时 → 自动解析出参数列表
  // 用户在参数表格中修改时   → 自动更新 URL
  // 使用 skipUrlSync ref 防止循环更新

  const skipUrlSync = useRef(false);
  const prevParamsJson = useRef("");

  const handleUrlChange = useCallback((newUrl: string) => {
    setUrl(newUrl);
    skipUrlSync.current = true;
    setRawParams(parseUrlParams(newUrl));
  }, []);

  // 监听参数变化 → 更新 URL（排除来自 handleUrlChange 的触发）
  useEffect(() => {
    if (skipUrlSync.current) {
      skipUrlSync.current = false;
      return;
    }
    const json = JSON.stringify(rawParams);
    if (json === prevParamsJson.current) return;
    prevParamsJson.current = json;

    const base = getBaseUrl(url);
    if (!base) return;
    const newUrl = buildUrlWithParams(base, rawParams);
    if (newUrl !== url) setUrl(newUrl);
  }, [rawParams, url]);

  const addParam = useCallback(() => {
    setRawParams((prev) => [...prev, { key: "", value: "", enabled: true }]);
  }, []);

  const updateParam = useCallback(
    (index: number, field: keyof HeaderInput, value: string | boolean) => {
      setRawParams((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
    },
    [],
  );

  const removeParam = useCallback((index: number) => {
    setRawParams((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Body 键值对 CRUD（用于 form-urlencoded 类型） ──

  const addBodyParam = useCallback(() => {
    setBodyParams((prev) => [...prev, { key: "", value: "", enabled: true }]);
  }, []);

  const updateBodyParam = useCallback(
    (index: number, field: keyof HeaderInput, value: string | boolean) => {
      setBodyParams((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
    },
    [],
  );

  const removeBodyParam = useCallback((index: number) => {
    setBodyParams((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── 从历史加载请求 ──

  const loadFromHistory = useCallback((item: HistoryItem) => {
    setMethod(item.method as HttpMethod);
    setUrl(item.url);
    setRawParams(parseUrlParams(item.url));
    setEditingRequest(null);
  }, []);

  // ── 从集合加载请求 ──

  const loadCollectionRequest = useCallback(
    (item: RequestItem, collectionId: string) => {
      setMethod(item.method as HttpMethod);
      setUrl(item.url);
      setHeaders(
        item.headers?.length ? item.headers : [{ key: "", value: "", enabled: true }],
      );
      setBody(item.body ?? "");
      setContentType(item.contentType ?? "application/json");
      // 加载 bodyParams：如果已保存则直接使用，否则如果是 form-urlencoded 类型则从 body 字符串解析
      if (item.bodyParams?.length) {
        setBodyParams(item.bodyParams);
      } else if ((item.contentType ?? "application/json") === "application/x-www-form-urlencoded" && item.body) {
        setBodyParams(parseBodyParams(item.body));
      } else {
        setBodyParams([{ key: "", value: "", enabled: true }]);
      }
      setAuthType((item.authType as AuthType) ?? "none");
      setBearerToken(item.bearerToken ?? "");
      setRawParams(
        item.params?.length ? item.params : [{ key: "", value: "", enabled: true }],
      );
      setEditingRequest({ collectionId, requestId: item.id });
      // 加载请求时重置脏状态（下一帧 snapshot 由 editingRequest 触发 useEffect 完成）
    },
    [],
  );

  // 编辑请求变化时自动更新已保存快照
  const prevEditingRef = useRef(editingRequest);
  useEffect(() => {
    if (editingRequest && editingRequest !== prevEditingRef.current) {
      // 延迟一帧确保所有 setState 已生效
      requestAnimationFrame(() => { updateSnapshot(); });
    }
    prevEditingRef.current = editingRequest;
  }, [editingRequest, updateSnapshot]);

  // 清除当前响应和错误
  const clearResponse = useCallback(() => {
    setResponse(null);
    setError(null);
  }, []);

  // ============================================================
  // 集合 CRUD
  // ============================================================

  /** 创建新请求（清空当前请求表单，重置编辑状态） */
  const newRequest = useCallback(() => {
    setMethod("GET");
    setUrl("");
    setHeaders([{ key: "", value: "", enabled: true }]);
    setBody("");
    setBodyParams([{ key: "", value: "", enabled: true }]);
    setContentType("application/json");
    setAuthType("none");
    setBearerToken("");
    setRawParams([{ key: "", value: "", enabled: true }]);
    setResponse(null);
    setError(null);
    setEditingRequest(null);
  }, []);

  // ── 内联保存命名对话框状态 ──
  const [saveDialogVisible, setSaveDialogVisible] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState("");

  /**
   * 保存当前请求到集合
   * - 如果正在编辑已有请求 → 原地更新
   * - 如果是新请求 → 弹出命名对话框，添加到第一个集合（或创建新集合）
   */
  const saveCurrentRequest = useCallback(() => {
    // 根据 Content-Type 计算待保存的请求体：
    // - form-urlencoded → 从 bodyParams 序列化为 URL 编码字符串
    // - 其他类型 → 直接使用 body 文本
    const bodyToSave = contentType === "application/x-www-form-urlencoded"
      ? serializeBodyParams(bodyParams)
      : body;

    const filteredHeaders = headers
      .filter((h) => h.key.trim())
      .concat(
        headers.some((h) => h.key.trim()) ? [] : [{ key: "", value: "", enabled: true } as HeaderInput],
      );
    if (filteredHeaders.length === 0) {
      filteredHeaders.push({ key: "", value: "", enabled: true });
    }

    if (editingRequest) {
      // 更新已有请求（原地修改）
      setCollections((prev) =>
        prev.map((c) =>
          c.id === editingRequest.collectionId
            ? {
                ...c,
                requests: c.requests.map((r) =>
                  r.id === editingRequest.requestId
                    ? {
                        ...r,
                        name: r.name,
                        method,
                        url: url.trim(),
                        headers: filteredHeaders,
                        body: bodyToSave,
                        contentType,
                        authType,
                        bearerToken,
                        params: rawParams,
                        bodyParams,
                      }
                    : r,
                ),
              }
            : c,
        ),
      );
      // 更新成功：重置脏状态并弹出通知
      requestAnimationFrame(() => { updateSnapshot(); });
      addToast({ type: "success", message: "Request updated" });
    } else {
      // 新建请求：弹出内联命名对话框
      const defaultName = url.trim()
        ? url.trim().split("/").filter(Boolean).pop() || url.trim()
        : "New Request";
      setSaveDialogName(defaultName);
      setSaveDialogVisible(true);
    }
  }, [
    method,
    url,
    headers,
    body,
    bodyParams,
    contentType,
    authType,
    bearerToken,
    rawParams,
    editingRequest,
    collections,
    updateSnapshot,
    addToast,
  ]);

  /**
   * 确认保存新请求（内联对话框回调）
   */
  const confirmSave = useCallback(() => {
    const name = saveDialogName.trim();
    if (!name) return;

    // 根据 Content-Type 计算待保存的请求体
    const bodyToSave = contentType === "application/x-www-form-urlencoded"
      ? serializeBodyParams(bodyParams)
      : body;

    const filteredHeaders = headers
      .filter((h) => h.key.trim())
      .concat(
        headers.some((h) => h.key.trim()) ? [] : [{ key: "", value: "", enabled: true } as HeaderInput],
      );
    if (filteredHeaders.length === 0) {
      filteredHeaders.push({ key: "", value: "", enabled: true });
    }

    const newReq: RequestItem = {
      id: crypto.randomUUID(),
      name,
      method,
      url: url.trim(),
      headers: filteredHeaders,
      body: bodyToSave,
      contentType,
      authType,
      bearerToken,
      params: rawParams,
      bodyParams,
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
    setEditingRequest({ collectionId: colId, requestId: newReq.id });
    setSaveDialogVisible(false);
    // 保存成功后重置脏状态并弹出通知
    requestAnimationFrame(() => { updateSnapshot(); });
    const colName = collections.find((c) => c.id === colId)?.name ?? "My Collection";
    addToast({ type: "success", message: `Saved to ${colName}` });
  }, [saveDialogName, method, url, headers, body, bodyParams, contentType, authType, bearerToken, rawParams, collections, addToast, updateSnapshot]);

  const cancelSave = useCallback(() => {
    setSaveDialogVisible(false);
  }, []);

  /** 删除集合中的某个请求 */
  const deleteCollectionRequest = useCallback(
    (collectionId: string, requestId: string) => {
      // 弹出确认对话框（不再直接删除）
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

  /** 重命名集合中的请求（弹出对话框） */
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

  /** 创建新集合（弹出命名对话框） */
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

  /** 更新集合的认证配置（类型 + Token） */
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

  /**
   * 移动请求（支持跨集合拖拽）
   * @param sourceColId 来源集合
   * @param requestId   请求 ID
   * @param targetColId 目标集合
   * @param targetIndex 目标位置索引
   */
  const moveRequest = useCallback(
    (sourceColId: string, requestId: string, targetColId: string, targetIndex: number) => {
      setCollections((prev) => {
        const sourceCol = prev.find((c) => c.id === sourceColId);
        if (!sourceCol) return prev;
        const req = sourceCol.requests.find((r) => r.id === requestId);
        if (!req) return prev;

        // 从源集合移除
        const withoutReq = sourceCol.requests.filter((r) => r.id !== requestId);

        if (sourceColId === targetColId) {
          // 同一集合内重排
          const newRequests = [...withoutReq];
          newRequests.splice(targetIndex, 0, req);
          return prev.map((c) =>
            c.id === sourceColId ? { ...c, requests: newRequests } : c,
          );
        }

        // 移动到不同集合
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

  /** 移动集合（拖拽排序） */
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

  // 获取当前编辑请求所属的集合名称（用于 AuthPanel 显示继承来源）
  const editingCollectionName = editingRequest
    ? collections.find((c) => c.id === editingRequest.collectionId)?.name ?? null
    : null;

  // 获取当前编辑请求的名称（用于面包屑导航显示）
  const editingRequestName = editingRequest
    ? collections
        .find((c) => c.id === editingRequest.collectionId)
        ?.requests.find((r) => r.id === editingRequest.requestId)?.name ?? null
    : null;

  // ============================================================
  // 环境 CRUD
  // ============================================================

  /** 创建新环境 */
  const addEnvironment = useCallback(() => {
    const newEnv: Environment = {
      id: crypto.randomUUID(),
      name: `New Environment ${environments.length + 1}`,
      variables: [{ key: "", value: "", enabled: true }],
    };
    setEnvironments((prev) => [...prev, newEnv]);
  }, [environments.length]);

  /** 删除环境 */
  const deleteEnvironment = useCallback((id: string) => {
    setEnvironments((prev) => prev.filter((e) => e.id !== id));
    setActiveEnvironmentId((prev) => (prev === id ? null : prev));
  }, []);

  /** 重命名环境 */
  const renameEnvironment = useCallback((id: string, name: string) => {
    setEnvironments((prev) =>
      prev.map((e) => (e.id === id ? { ...e, name } : e)),
    );
  }, []);

  /** 更新集合的 Base URL */
  const updateCollectionBaseUrl = useCallback((collectionId: string, baseUrl: string) => {
    setCollections((prev) =>
      prev.map((c) => (c.id === collectionId ? { ...c, base_url: baseUrl } : c)),
    );
  }, []);

  /** 设置当前激活环境（切换时自动替换 {{key}} 模板） */
  const setActiveEnvironment = useCallback((id: string | null) => {
    setActiveEnvironmentId(id);
  }, []);

  /** 向指定环境添加新变量 */
  const addVariable = useCallback((envId: string) => {
    setEnvironments((prev) =>
      prev.map((e) =>
        e.id === envId
          ? { ...e, variables: [...e.variables, { key: "", value: "", enabled: true }] }
          : e,
      ),
    );
  }, []);

  /** 更新指定环境的某个变量字段 */
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

  /** 从指定环境移除变量 */
  const removeVariable = useCallback((envId: string, index: number) => {
    setEnvironments((prev) =>
      prev.map((e) =>
        e.id === envId
          ? { ...e, variables: e.variables.filter((_, i) => i !== index) }
          : e,
      ),
    );
  }, []);

  // ============================================================
  // 导出状态和方法（组件通过 props 接收）
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
    updateCollectionAuth,
    updateCollectionBaseUrl,
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
  };
}
