import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LogEntry } from "./types";

const MAX_ENTRIES = 2000;
const ROW_HEIGHT = 36;
const PANEL_WIDTH = 420;

const STATUS_COLORS: Record<string, string> = {
  "2": "text-pulse-emerald",
  "3": "text-pulse-amber",
  "4": "text-pulse-rose",
  "5": "text-pulse-rose",
};

const METHOD_COLORS: Record<string, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  PUT: "text-method-put",
  PATCH: "text-method-patch",
  DELETE: "text-method-delete",
};

function statusClass(status: number): string {
  if (status === 0) return "text-pulse-rose";
  return STATUS_COLORS[String(status)[0]] ?? "text-pulse-text-secondary";
}

function methodClass(method: string): string {
  return METHOD_COLORS[method] ?? "text-pulse-text-secondary";
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

function truncateUrl(url: string, max = 120): string {
  return url.length <= max ? url : url.slice(0, max) + "…";
}

/* ─── Copy button component (self-contained, no module-level state) ─── */

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1200);
  }, [text]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return (
    <button onClick={handleClick} className="btn-ghost text-[10px] py-0.5 px-2">
      {copied ? "Copied!" : label}
    </button>
  );
}

/* ─── Detail section helpers ─── */

function HeaderTable({
  headers,
}: {
  headers: Record<string, string> | { key: string; value: string; enabled: boolean }[];
}) {
  const rows = Array.isArray(headers)
    ? headers.filter((h) => h.key.trim())
    : Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));

  if (rows.length === 0) {
    return <p className="text-pulse-text-muted text-xs italic px-4 py-2">(none)</p>;
  }

  return (
    <table className="w-full text-xs font-mono border-collapse">
      <tbody>
        {rows.map((row) => {
          const [k, v] = Array.isArray(row) ? row : [row.key, row.value];
          return (
            <tr key={`${k}\x00${v}`} className="border-b border-pulse-border/20">
              <td className="px-4 py-1.5 text-pulse-accent whitespace-nowrap align-top w-[35%]">
                {k}
              </td>
              <td className="px-4 py-1.5 text-pulse-text-primary break-all">{v}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="px-4 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-pulse-text-secondary uppercase tracking-wider">
          {label}
        </span>
        <CopyButton text={text} />
      </div>
      <pre className="bg-pulse-deepest rounded border border-pulse-border p-2 text-xs text-pulse-text-primary overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
        {text || <span className="text-pulse-text-muted italic">(empty)</span>}
      </pre>
    </div>
  );
}

/* ─── Detail Panel ─── */

function DetailPanel({ entry, onClose }: { entry: LogEntry; onClose: () => void }) {
  const headersText = entry.request_headers
    .filter((h) => h.key.trim())
    .map((h) => `${h.key}: ${h.value}`)
    .join("\n");

  const respHeadersText = Object.entries(entry.response_headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const copyAllText = [
    `${entry.method} ${entry.url}`,
    `Status: ${entry.status} ${entry.status_text}`,
    `Time: ${entry.total_ms.toFixed(0)}ms  Size: ${entry.size_label}`,
    "",
    "── Request Headers ──",
    headersText,
    ...(entry.request_body
      ? ["", "── Request Body ──", entry.request_body]
      : []),
    ...(Object.keys(entry.response_headers).length > 0
      ? ["", "── Response Headers ──", respHeadersText]
      : []),
    ...(entry.error ? ["", "── Error ──", entry.error] : []),
  ].join("\n");

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      <div
        className="fixed top-0 right-0 h-full z-50 bg-pulse-surface border-l border-pulse-border shadow-2xl overflow-hidden"
        style={{ width: PANEL_WIDTH }}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-pulse-border shrink-0">
          <span className="text-xs font-semibold text-pulse-text-primary tracking-wide uppercase">
            Request Detail
          </span>
          <div className="flex items-center gap-1">
            <CopyButton text={copyAllText} label="Copy All" />
            <button
              onClick={onClose}
              className="btn-ghost text-xs px-2 py-1"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="overflow-y-auto h-[calc(100%-40px)]">
          <div className="px-4 py-3 space-y-1.5 border-b border-pulse-border/40">
            <div className="flex items-center gap-2">
              <span className={`method-badge ${statusClass(entry.status)}`}>
                {entry.status === 0 ? "ERR" : entry.status}
              </span>
              <span className={`method-badge ${methodClass(entry.method)}`}>
                {entry.method}
              </span>
            </div>
            <div className="text-xs text-pulse-text-primary break-all font-mono">
              {entry.url}
            </div>
            <div className="flex gap-4 text-[11px] text-pulse-text-muted">
              <span>
                {entry.total_ms < 1000
                  ? `${entry.total_ms.toFixed(0)}ms`
                  : `${(entry.total_ms / 1000).toFixed(2)}s`}
              </span>
              <span>{entry.size_label}</span>
              <span>{formatTime(entry.timestamp)}</span>
            </div>
            {entry.error && (
              <div className="text-xs text-pulse-rose bg-pulse-rose/10 rounded px-2 py-1">
                {entry.error}
              </div>
            )}
          </div>

          <div className="border-b border-pulse-border/40">
            <div className="flex items-center justify-between px-4 py-1.5">
              <span className="text-[11px] font-medium text-pulse-text-secondary uppercase tracking-wider">
                Request Headers
              </span>
              {headersText && <CopyButton text={headersText} />}
            </div>
            <HeaderTable headers={entry.request_headers} />
          </div>

          {entry.request_body && (
            <div className="border-b border-pulse-border/40">
              <CopyBlock label="Request Body" text={entry.request_body} />
            </div>
          )}

          {Object.keys(entry.response_headers).length > 0 && (
            <div className="border-b border-pulse-border/40">
              <div className="flex items-center justify-between px-4 py-1.5">
                <span className="text-[11px] font-medium text-pulse-text-secondary uppercase tracking-wider">
                  Response Headers
                </span>
                {respHeadersText && <CopyButton text={respHeadersText} />}
              </div>
              <HeaderTable headers={entry.response_headers} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ─── Main LogViewer ─── */

export default function LogViewer() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const listRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const entryCountRef = useRef(0);

  // Fetch history + listen for events, with proper race-condition handling
  useEffect(() => {
    let cancelled = false;
    const buffer: LogEntry[] = [];

    // Start listening immediately so no event is missed during initial fetch
    (async () => {
      const unlisten = await listen<LogEntry>("http-log", (event) => {
        buffer.push(event.payload);
        // Once history is loaded, flush buffer into state
        setEntries((prev) => {
          // If history hasn't loaded yet, buffer accumulates — skip state update
          if (prev.length === 0 && buffer.length > 0 && buffer.every((b) => b !== event.payload)) {
            return prev;
          }
          // Normal path: deduplicate and append
          if (prev.some((e) => e.id === event.payload.id)) return prev;
          const next = prev.concat(event.payload);
          return next.length > MAX_ENTRIES
            ? next.slice(next.length - MAX_ENTRIES)
            : next;
        });
      });

      if (cancelled) {
        unlisten();
      } else {
        unlistenRef.current = unlisten;
      }
    })();

    // Fetch all existing logs from Rust store (source of truth)
    invoke<LogEntry[]>("get_logs")
      .then((history) => {
        if (cancelled) return;
        // Merge history with buffered events (dedup by id)
        const seen = new Set(history.map((e) => e.id));
        const extra = buffer.filter((e) => !seen.has(e.id));
        const merged = history.concat(extra);
        setEntries(merged);
        entryCountRef.current = merged.length;
      })
      .catch(() => {
        // Tauri IPC failed — show buffer contents if any, otherwise empty
        if (!cancelled && buffer.length > 0) {
          setEntries(buffer);
          entryCountRef.current = buffer.length;
        }
      });

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  // Virtual list
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  // Scroll to bottom when new entries arrive and auto-scroll is on
  useEffect(() => {
    if (autoScroll && entries.length > entryCountRef.current) {
      virtualizer.scrollToIndex(entries.length - 1, { align: "end" });
    }
    entryCountRef.current = entries.length;
  }, [entries.length, autoScroll, virtualizer]);

  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    const el = listRef.current;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  const clearLogs = useCallback(async () => {
    try {
      await invoke("clear_logs");
    } catch {
      // Rust-side clear failed — still clear the frontend to let user retry
    }
    setEntries([]);
    setSelectedEntry(null);
  }, []);

  const handleEntryClick = useCallback((entry: LogEntry) => {
    setSelectedEntry((prev) => (prev?.id === entry.id ? null : entry));
  }, []);

  const handlePanelClose = useCallback(() => {
    setSelectedEntry(null);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-pulse-deepest overflow-hidden select-text">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-pulse-border shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-pulse-text-primary tracking-wide">
            HTTP Logs
          </h1>
          <span className="text-xs text-pulse-text-muted">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>
        </div>
        <button onClick={clearLogs} className="btn-ghost text-xs">
          Clear
        </button>
      </header>

      {/* Log list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-xs"
      >
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-pulse-text-muted font-sans text-sm">
            <div className="text-center space-y-1">
              <p>No HTTP requests recorded yet</p>
              <p className="text-xs">
                Send a request from the main window to see logs here
              </p>
            </div>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const entry = entries[virtualItem.index];
              const isSelected = selectedEntry?.id === entry.id;

              return (
                <div
                  key={entry.id}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  onClick={() => handleEntryClick(entry)}
                  className={`absolute left-0 w-full border-b border-pulse-border/40 cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-pulse-accent/10"
                      : "hover:bg-pulse-hover/30"
                  }`}
                  style={{
                    height: virtualItem.size,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <div className="flex items-center gap-3 px-4 h-full">
                    <span className={`method-badge shrink-0 ${statusClass(entry.status)}`}>
                      {entry.status === 0 ? "ERR" : entry.status}
                    </span>
                    <span className={`method-badge shrink-0 ${methodClass(entry.method)}`}>
                      {entry.method}
                    </span>
                    <span
                      className={`truncate min-w-0 ${entry.error ? "text-pulse-rose" : "text-pulse-text-primary"}`}
                      title={entry.url}
                    >
                      {truncateUrl(entry.url)}
                    </span>
                    <span className="ml-auto shrink-0 text-pulse-text-muted flex items-center gap-3">
                      <span>
                        {entry.total_ms < 1000
                          ? `${entry.total_ms.toFixed(0)}ms`
                          : `${(entry.total_ms / 1000).toFixed(2)}s`}
                      </span>
                      <span>{entry.size_label}</span>
                      <span className="w-16 text-right">
                        {formatTime(entry.timestamp)}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedEntry && (
        <DetailPanel entry={selectedEntry} onClose={handlePanelClose} />
      )}
    </div>
  );
}
