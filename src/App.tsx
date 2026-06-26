import { useRef, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePulse } from "./hooks/usePulse";
import { ShortcutEngine } from "./shortcuts/ShortcutEngine";
import { DEFAULT_COMMANDS } from "./shortcuts/defaults";
import type { KeybindingData } from "./types";
import Sidebar from "./components/Sidebar";
import RequestPanel from "./components/RequestPanel";
import ResponsePanel from "./components/ResponsePanel";
import SaveDialog from "./components/SaveDialog";

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

    return () => {
      engine.stop();
      engineRef.current = null;
    };
    // state 的引用在组件生命周期内不变（useCallback 已稳定化）
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          contentType={state.contentType}
          onContentTypeChange={state.setContentType}
          isLoading={state.isLoading}
          onSend={state.sendRequest}
          onSave={state.saveCurrentRequest}
          editingRequest={state.editingRequest}
          editingCollectionName={state.editingCollectionName}
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

      {/* 快捷键编辑器（第二阶段实现） */}
      {editorOpen && engineRef.current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[640px] max-h-[80vh] bg-pulse-surface border border-pulse-border rounded-xl shadow-2xl flex flex-col p-6">
            <h2 className="text-sm font-semibold text-pulse-text-primary mb-4">
              Keyboard Shortcuts
            </h2>
            <p className="text-xs text-pulse-text-muted">
              Shortcut editor will be available in the next phase.
            </p>
            <button
              onClick={() => setEditorOpen(false)}
              className="btn-primary text-xs px-4 py-1.5 mt-4 self-end"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
