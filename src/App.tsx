import { useRef, useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePulse } from "./hooks/usePulse";
import { ShortcutEngine } from "./shortcuts/ShortcutEngine";
import { DEFAULT_COMMANDS, serializeCombo } from "./shortcuts/defaults";
import type { KeybindingData } from "./types";
import Sidebar from "./components/Sidebar";
import RequestPanel from "./components/RequestPanel";
import ResponsePanel from "./components/ResponsePanel";
import SaveDialog from "./components/SaveDialog";
import ConfirmDialog from "./components/ConfirmDialog";
import ToastContainer from "./components/Toast";

/**
 * 应用根组件
 *
 * 布局结构（flex 纵向 + 横向）：
 * ┌──────────┬──────────────────────────────┐
 * │          │  RequestPanel（请求面板）       │
 * │  Sidebar ├──────────────────────────────┤
 * │  (240px) │  ResponsePanel（响应面板）      │
 * │          │                              │
 * └──────────┴──────────────────────────────┘
 *
 * 所有状态和回调均由 usePulse() hook 单点管理，通过 props 下发给子组件
 * 快捷键系统由 ShortcutEngine 实例管理，通过 ref 绑定生命周期
 */
export default function App() {
  const state = usePulse();
  const engineRef = useRef<ShortcutEngine | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [flashCommand, setFlashCommand] = useState<string | null>(null);

  // 初始化快捷键引擎（仅挂载一次）
  useEffect(() => {
    const engine = new ShortcutEngine();

    // 从 usePulse 获取实际处理函数并映射到命令
    const commands = DEFAULT_COMMANDS.map((cmd) => {
      switch (cmd.id) {
        case "sendRequest":
          return { ...cmd, handler: state.sendRequest };
        case "newRequest":
          return { ...cmd, handler: state.newRequest };
        case "saveRequest":
          return { ...cmd, handler: state.saveCurrentRequest };
        case "focusUrlBar":
          return {
            ...cmd,
            handler: () =>
              document.getElementById("request-url-input")?.focus(),
          };
        case "clearResponse":
          return { ...cmd, handler: state.clearResponse };
        case "switchCollectionsTab":
          return {
            ...cmd,
            handler: () => state.setSidebarTab("collections"),
          };
        case "switchHistoryTab":
          return { ...cmd, handler: () => state.setSidebarTab("history") };
        case "switchEnvironmentsTab":
          return {
            ...cmd,
            handler: () => state.setSidebarTab("environments"),
          };
        case "requestTabParams":
          return { ...cmd, handler: () => state.setRequestTab("params") };
        case "requestTabAuth":
          return { ...cmd, handler: () => state.setRequestTab("auth") };
        case "requestTabHeaders":
          return { ...cmd, handler: () => state.setRequestTab("headers") };
        case "requestTabBody":
          return { ...cmd, handler: () => state.setRequestTab("body") };
        case "responseTabBody":
          return { ...cmd, handler: () => state.setResponseTab("body") };
        case "responseTabHeaders":
          return { ...cmd, handler: () => state.setResponseTab("headers") };
        case "dialogConfirm":
          return { ...cmd, handler: state.confirmSave };
        case "dialogCancel":
          return { ...cmd, handler: state.cancelSave };
        case "openKeybindingsEditor":
          return { ...cmd, handler: () => setEditorOpen(true) };
        default:
          return cmd;
      }
    });

    engine.registerDefaults(commands);

    // 加载已保存的自定义绑定
    invoke<KeybindingData | null>("load_keybindings")
      .then((data) => {
        if (data?.bindings) {
          engine.loadSerializedBindings(data.bindings);
        }
      })
      .catch(() => {
        // 首次使用时 keybindings.json 不存在，静默忽略
      });

    engine.start();
    engineRef.current = engine;

    // 订阅快捷键触发事件（用于闪烁反馈）
    const unsubFired = engine.onCommandFired((commandId) => {
      setFlashCommand(commandId);
      setTimeout(() => setFlashCommand(null), 600);
    });

    return () => {
      unsubFired();
      engine.stop();
      engineRef.current = null;
    };
    // state 的引用在组件生命周期内不变（useCallback 已稳定化）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 计算快捷键提示文本（供 UI 按钮显示）
  const shortcutHints = useMemo(() => {
    if (!engineRef.current) return [];
    return engineRef.current.getAllBindings().map((b) => ({
      commandId: b.commandId,
      label: b.defs
        .map((def) =>
          Array.isArray(def)
            ? `${serializeCombo(def[0])} ${serializeCombo(def[1])}`
            : serializeCombo(def),
        )
        .join(" / "),
    }));
  }, []);

  return (
    <div className="h-screen flex overflow-hidden bg-pulse-deepest">
      <Sidebar
        collections={state.collections}
        history={state.history}
        activeTab={state.sidebarTab}
        onTabChange={state.setSidebarTab}
        onLoadHistory={state.loadFromHistory}
        onLoadRequest={state.loadCollectionRequest}
        /* ── 新建请求 & 集合管理 ── */
        onNewRequest={state.newRequest}
        onDeleteRequest={state.deleteCollectionRequest}
        onRenameRequest={state.renameCollectionRequest}
        onAddCollection={state.addCollection}
        onUpdateCollectionAuth={state.updateCollectionAuth}
        onMoveRequest={state.moveRequest}
        onMoveCollection={state.moveCollection}
        onUpdateCollectionBaseUrl={state.updateCollectionBaseUrl}
        /* ── 环境变量 ── */
        environments={state.environments}
        activeEnvironmentId={state.activeEnvironmentId}
        onAddEnvironment={state.addEnvironment}
        onDeleteEnvironment={state.deleteEnvironment}
        onRenameEnvironment={state.renameEnvironment}
        onSetActiveEnvironment={state.setActiveEnvironment}
        onAddVariable={state.addVariable}
        onUpdateVariable={state.updateVariable}
        onRemoveVariable={state.removeVariable}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <RequestPanel
          method={state.method}
          onMethodChange={state.setMethod}
          url={state.url}
          onUrlChange={state.onUrlChange}
          headers={state.headers}
          onAddHeader={state.addHeader}
          onUpdateHeader={state.updateHeader}
          onRemoveHeader={state.removeHeader}
          body={state.body}
          onBodyChange={state.setBody}
          bodyParams={state.bodyParams}
          onAddBodyParam={state.addBodyParam}
          onUpdateBodyParam={state.updateBodyParam}
          onRemoveBodyParam={state.removeBodyParam}
          contentType={state.contentType}
          onContentTypeChange={state.setContentType}
          isLoading={state.isLoading}
          onSend={state.sendRequest}
          onSave={state.saveCurrentRequest}
          editingRequest={state.editingRequest}
          editingCollectionName={state.editingCollectionName}
          requestName={state.editingRequestName}
          isDirty={state.isDirty}
          onShowCollectionContext={() => state.setSidebarTab("collections")}
          authType={state.authType}
          onAuthTypeChange={state.setAuthType}
          bearerToken={state.bearerToken}
          onBearerTokenChange={state.setBearerToken}
          rawParams={state.rawParams}
          onAddParam={state.addParam}
          onUpdateParam={state.updateParam}
          onRemoveParam={state.removeParam}
          requestTab={state.requestTab}
          onRequestTabChange={state.setRequestTab}
          flashCommand={flashCommand}
          shortcutHints={shortcutHints}
        />

        <div className="flex-1 min-h-0 border-t border-pulse-border">
          <ResponsePanel
            response={state.response}
            isLoading={state.isLoading}
            error={state.error}
            responseTab={state.responseTab}
            onResponseTabChange={state.setResponseTab}
          />
        </div>
      </main>

      {/* 请求保存命名对话框 */}
      <SaveDialog
        visible={state.saveDialogVisible}
        defaultName={state.saveDialogName}
        onConfirm={state.confirmSave}
        onCancel={state.cancelSave}
        engine={engineRef.current}
      />

      {/* 删除确认对话框 */}
      <ConfirmDialog
        visible={state.confirmDialog !== null}
        title={state.confirmDialog !== null && state.confirmDialog.type === "deleteRequest" ? "Delete Request" : "Delete Collection"}
        message={
          state.confirmDialog !== null
            ? state.confirmDialog.type === "deleteRequest"
              ? `Are you sure you want to delete "${state.confirmDialog.requestName}"?`
              : `Are you sure you want to delete "${state.confirmDialog.collectionName}"?`
            : ""
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={state.confirmDestructive}
        onCancel={state.cancelDestructive}
        engine={engineRef.current}
      />

      {/* 快捷键编辑器（第二阶段实现） */}
      {editorOpen && engineRef.current && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in"
          onClick={() => setEditorOpen(false)}
        >
          <div
            className="w-[560px] max-h-[80vh] bg-pulse-surface border border-pulse-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-pulse-border shrink-0">
              <h2 className="text-sm font-semibold text-pulse-text-primary">
                Keyboard Shortcuts
              </h2>
              <button
                onClick={() => setEditorOpen(false)}
                className="btn-ghost text-xs px-2 py-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 快捷键列表 */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
              {Array.from(
                new Map(
                  engineRef.current.getAllBindings().map((b) => [b.category, b.category]),
                ).keys(),
              ).map((category) => {
                const bindings = engineRef.current!.getAllBindings().filter(
                  (b) => b.category === category,
                );
                return (
                  <div key={category}>
                    <h3 className="text-[11px] font-semibold text-pulse-text-muted uppercase tracking-wider mb-2">
                      {category}
                    </h3>
                    <div className="space-y-0.5">
                      {bindings.map((b) => (
                        <div
                          key={b.commandId}
                          className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-pulse-hover transition-colors"
                        >
                          <span className="text-xs text-pulse-text-primary">{b.label}</span>
                          <div className="flex items-center gap-1">
                            {b.defs.map((def, i) => {
                              const comboStr = Array.isArray(def)
                                ? `${serializeCombo(def[0])} ${serializeCombo(def[1])}`
                                : serializeCombo(def);
                              return (
                                <kbd
                                  key={i}
                                  className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-pulse-deepest border border-pulse-border text-pulse-text-secondary"
                                >
                                  {comboStr}
                                </kbd>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 页脚提示 */}
            <div className="px-5 py-2 border-t border-pulse-border shrink-0 text-[10px] text-pulse-text-muted">
              Press <kbd className="font-mono px-1 bg-pulse-deepest rounded border border-pulse-border">Escape</kbd> to close
            </div>
          </div>
        </div>
      )}

      {/* Toast 通知容器 */}
      <ToastContainer toasts={state.toasts} onDismiss={state.dismissToast} />
    </div>
  );
}
