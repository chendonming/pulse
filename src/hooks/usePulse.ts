import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  HttpMethod,
  RequestTab,
  SidebarTab,
  HeaderInput,
  ResponseData,
  Collection,
  HistoryItem,
  AuthType,
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

  const [collections, _setCollections] = useState<Collection[]>(() => [
    {
      id: "default",
      name: "My Collection",
      requests: [
        {
          id: "example-1",
          name: "JSONPlaceholder Posts",
          method: "GET",
          url: "https://jsonplaceholder.typicode.com/posts/1",
        },
        {
          id: "example-2",
          name: "Create Post",
          method: "POST",
          url: "https://jsonplaceholder.typicode.com/posts",
        },
      ],
    },
  ]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("collections");

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
        // Remove any existing Authorization header to avoid duplicates
        cleanHeaders = cleanHeaders.filter(
          (h) => h.key.toLowerCase() !== "authorization",
        );
        cleanHeaders.push({
          key: "Authorization",
          value: token,
          enabled: true,
        });
      }

      const result = await invoke<ResponseData>("send_request", {
        input: {
          method,
          url: url.trim(),
          headers: cleanHeaders,
          body: body || null,
          content_type: contentType || null,
        },
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
  }, [method, url, headers, body, contentType, authType, bearerToken]);

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
  }, []);

  const loadCollectionRequest = useCallback(
    (item: { method: string; url: string }) => {
      setMethod(item.method as HttpMethod);
      setUrl(item.url);
      setRawParams(parseUrlParams(item.url));
    },
    [],
  );

  const clearResponse = useCallback(() => {
    setResponse(null);
    setError(null);
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
  };
}
