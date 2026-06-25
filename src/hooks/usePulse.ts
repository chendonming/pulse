import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  HttpMethod,
  RequestTab,
  SidebarTab,
  HeaderInput,
  ResponseData,
  Collection,
  RequestItem,
  HistoryItem,
  AuthType,
  Environment,
  EnvironmentVariable,
  EnvironmentData,
} from "../types";

/* ── Query-string helpers ── */

function parseUrlParams(url: string): HeaderInput[] {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return [{ key: "", value: "", enabled: true }];
  const query = url.slice(qIndex + 1).split("#")[0]; // strip hash
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

function getBaseUrl(url: string): string {
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

function buildUrlWithParams(base: string, params: HeaderInput[]): string {
  const active = params.filter((p) => p.key.trim() && p.enabled);
  if (active.length === 0) return base;
  const qs = active
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join("&");
  return `${base}?${qs}`;
}

export function usePulse() {
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderInput[]>([
    { key: "", value: "", enabled: true },
  ]);
  const [body, setBody] = useState("");
  const [contentType, setContentType] = useState("application/json");
  const [authType, setAuthType] = useState<AuthType>("none");
  const [bearerToken, setBearerToken] = useState("");
  const [rawParams, setRawParams] = useState<HeaderInput[]>([
    { key: "", value: "", enabled: true },
  ]);
  const [requestTab, setRequestTab] = useState<RequestTab>("headers");

  const [response, setResponse] = useState<ResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [responseTab, setResponseTab] = useState<"body" | "headers">("body");

  const [collections, setCollections] = useState<Collection[]>(() => [
    {
      id: "default",
      name: "My Collection",
      requests: [
        {
          id: "example-1",
          name: "JSONPlaceholder Posts",
          method: "GET",
          url: "https://jsonplaceholder.typicode.com/posts/1",
          headers: [{ key: "", value: "", enabled: true }],
          body: "",
          contentType: "application/json",
          authType: "none",
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
          authType: "none",
          bearerToken: "",
          params: [{ key: "", value: "", enabled: true }],
        },
      ],
    },
  ]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("collections");

  /* ── Environment state ── */
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [activeEnvironmentId, setActiveEnvironmentId] = useState<string | null>(null);
  const [envLoaded, setEnvLoaded] = useState(false);

  /* ── Collection editing state ── */
  const [editingRequest, setEditingRequest] = useState<{
    collectionId: string;
    requestId: string;
  } | null>(null);

  // Load environments from Rust on mount
  useEffect(() => {
    invoke<EnvironmentData>("load_environments")
      .then((data) => {
        setEnvironments(data.environments);
        setActiveEnvironmentId(data.active_id);
      })
      .catch((e) => console.error("Failed to load environments:", e))
      .finally(() => setEnvLoaded(true));
  }, []);

  // Persist environments to Rust whenever they change (skip the initial load)
  useEffect(() => {
    if (!envLoaded) return;
    invoke("save_environments", {
      data: { environments, active_id: activeEnvironmentId },
    }).catch((e) => console.error("Failed to save environments:", e));
  }, [environments, activeEnvironmentId, envLoaded]);

  const sendRequest = useCallback(async () => {
    if (!url.trim()) return;

    setIsLoading(true);
    setError(null);
    setResponse(null);

    try {
      let cleanHeaders = headers.filter((h) => h.key.trim() !== "");

      // Inject auth header if Bearer Token is configured
      if (authType === "bearer" && bearerToken.trim()) {
        let token = bearerToken.trim();
        if (!token.startsWith("Bearer ")) {
          token = `Bearer ${token}`;
        }
        cleanHeaders = cleanHeaders.filter(
          (h) => h.key.toLowerCase() !== "authorization",
        );
        cleanHeaders.push({
          key: "Authorization",
          value: token,
          enabled: true,
        });
      }

      // Get active environment's enabled variables for substitution
      const activeEnv = environments.find((e) => e.id === activeEnvironmentId);
      const activeVars: EnvironmentVariable[] =
        activeEnv?.variables.filter((v) => v.enabled) ?? [];

      const result = await invoke<ResponseData>("send_request", {
        input: {
          method,
          url: url.trim(),
          headers: cleanHeaders,
          body: body || null,
          content_type: contentType || null,
        },
        variables: activeVars,
      });
      setResponse(result);
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
  }, [method, url, headers, body, contentType, authType, bearerToken, environments, activeEnvironmentId]);

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

  /* ── URL / Params bidirectional sync ── */

  const skipUrlSync = useRef(false);
  const prevParamsJson = useRef("");

  const handleUrlChange = useCallback((newUrl: string) => {
    setUrl(newUrl);
    skipUrlSync.current = true;
    setRawParams(parseUrlParams(newUrl));
  }, []);

  // Watch rawParams changes → update URL (skip when the change came from handleUrlChange)
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

  const loadFromHistory = useCallback((item: HistoryItem) => {
    setMethod(item.method as HttpMethod);
    setUrl(item.url);
    setRawParams(parseUrlParams(item.url));
    setEditingRequest(null);
  }, []);

  const loadCollectionRequest = useCallback(
    (item: RequestItem, collectionId: string) => {
      setMethod(item.method as HttpMethod);
      setUrl(item.url);
      setHeaders(
        item.headers?.length ? item.headers : [{ key: "", value: "", enabled: true }],
      );
      setBody(item.body ?? "");
      setContentType(item.contentType ?? "application/json");
      setAuthType((item.authType as AuthType) ?? "none");
      setBearerToken(item.bearerToken ?? "");
      setRawParams(
        item.params?.length ? item.params : [{ key: "", value: "", enabled: true }],
      );
      setEditingRequest({ collectionId, requestId: item.id });
    },
    [],
  );

  const clearResponse = useCallback(() => {
    setResponse(null);
    setError(null);
  }, []);

  /* ── Collection CRUD ── */

  const newRequest = useCallback(() => {
    setMethod("GET");
    setUrl("");
    setHeaders([{ key: "", value: "", enabled: true }]);
    setBody("");
    setContentType("application/json");
    setAuthType("none");
    setBearerToken("");
    setRawParams([{ key: "", value: "", enabled: true }]);
    setResponse(null);
    setError(null);
    setEditingRequest(null);
  }, []);

  const saveCurrentRequest = useCallback(() => {
    const filteredHeaders = headers
      .filter((h) => h.key.trim())
      .concat(
        headers.some((h) => h.key.trim()) ? [] : [{ key: "", value: "", enabled: true } as HeaderInput],
      );
    if (filteredHeaders.length === 0) {
      filteredHeaders.push({ key: "", value: "", enabled: true });
    }

    if (editingRequest) {
      // Update existing request in-place
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
                        body,
                        contentType,
                        authType,
                        bearerToken,
                        params: rawParams,
                      }
                    : r,
                ),
              }
            : c,
        ),
      );
    } else {
      const name =
        window.prompt(
          "Request name:",
          url.trim()
            ? url.trim().split("/").filter(Boolean).pop() || url.trim()
            : "New Request",
        ) ?? "";
      if (!name.trim()) return;

      const newReq: RequestItem = {
        id: crypto.randomUUID(),
        name: name.trim(),
        method,
        url: url.trim(),
        headers: filteredHeaders,
        body,
        contentType,
        authType,
        bearerToken,
        params: rawParams,
      };

      let colId: string;
      if (collections.length === 0) {
        colId = crypto.randomUUID();
        setCollections([
          { id: colId, name: "My Collection", requests: [newReq] },
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
    }
  }, [
    method,
    url,
    headers,
    body,
    contentType,
    authType,
    bearerToken,
    rawParams,
    editingRequest,
    collections,
  ]);

  const deleteCollectionRequest = useCallback(
    (collectionId: string, requestId: string) => {
      setCollections((prev) =>
        prev.map((c) =>
          c.id === collectionId
            ? {
                ...c,
                requests: c.requests.filter((r) => r.id !== requestId),
              }
            : c,
        ),
      );
      if (
        editingRequest?.collectionId === collectionId &&
        editingRequest?.requestId === requestId
      ) {
        setEditingRequest(null);
      }
    },
    [editingRequest],
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
      requests: [],
    };
    setCollections((prev) => [...prev, newCol]);
  }, [collections.length]);

  /* ── Environment CRUD ── */

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
    /* ── Collection CRUD exports ── */
    newRequest,
    saveCurrentRequest,
    deleteCollectionRequest,
    renameCollectionRequest,
    addCollection,
    editingRequest,
    /* ── Environment exports ── */
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
