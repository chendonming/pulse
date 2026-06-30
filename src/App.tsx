import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePulse } from "./hooks/usePulse";
import { ShortcutEngine } from "./shortcuts/ShortcutEngine";
import { DEFAULT_COMMANDS, serializeCombo } from "./shortcuts/defaults";
import type { KeybindingData, RequestItem } from "./types";
import Sidebar from "./components/Sidebar";
import RequestPanel from "./components/RequestPanel";
import ResponsePanel from "./components/ResponsePanel";
import TabBar from "./components/TabBar";
import SaveDialog from "./components/SaveDialog";
import ConfirmDialog from "./components/ConfirmDialog";
import ImportDialog from "./components/ImportDialog";
import ExportDialog from "./components/ExportDialog";
import TestScriptDialog from "./components/TestScriptDialog";
import SettingsDialog from "./components/SettingsDialog";
import { FONT_FAMILY_MAP, FONT_SIZE_PX_MAP } from "./components/SettingsDialog";
import ToastContainer from "./components/Toast";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
  useGroupRef,
  type Layout,
} from "react-resizable-panels";

/**
 * 应用根组件
 *
 * 布局结构（PanelGroup 双层拖拽布局）：
 * ┌──────────┬──────────────────────────────────────────────┐
 * │          │  TabBar（标签栏）                              │
 * │  Sidebar ├──────────────────────────────────────────────┤
 * │  (拖拽)   │  RequestPanel（请求面板，可上下拖拽）          │
 * │          ├──────────────────────────────────────────────┤
 * │          │  ResponsePanel（响应面板）                     │
 * └──────────┴──────────────────────────────────────────────┘
 *     ↕ 水平拖拽分隔条              ↕ 垂直拖拽分隔条
 *
 * 所有状态和回调均由 usePulse() hook 单点管理，通过 props 下发给子组件。
 * 多标签页架构：tabs[] 数组存储所有标签页状态，activeTabId 标记当前激活页。
 */
export default function App() {
  const state = usePulse();
  const engineRef = useRef<ShortcutEngine | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [flashCommand, setFlashCommand] = useState<string | null>(null);

  // 使用 ref 解决快捷键引擎闭包陈旧性问题
  // 避免 useEffect([]) 捕获过时的 handler 引用
  const handlerRef = useRef(state);
  handlerRef.current = state;

  // 使用 ref 追踪最新设置值，解决闭包和竞态问题
  const latestSettingsRef = useRef(state.settings);
  // settingsLoaded 也通过 ref 同步
  const settingsLoadedRef = useRef(state.settingsLoaded);
  useEffect(() => {
    latestSettingsRef.current = state.settings;
  }, [state.settings]);
  useEffect(() => {
    settingsLoadedRef.current = state.settingsLoaded;
  }, [state.settingsLoaded]);

  /**
   * 直接保存设置到 Rust（绕过 300ms 防抖）。
   * onLayoutChanged 只在拖拽释放时触发，库自身已防抖。
   * 使用 ref 确保总是获取最新值，避免 useCallback 闭包问题。
   */
  const saveSettingsDirectly = useCallback((partial: Partial<{
    sidebarWidth: number;
    requestPanelHeight: number;
  }>) => {
    if (!settingsLoadedRef.current) return;
    const current = latestSettingsRef.current;
    invoke("save_settings", {
      data: {
        zoomLevel: current.zoomLevel,
        fontFamily: current.fontFamily,
        fontSize: current.fontSize,
        sidebarWidth: partial.sidebarWidth ?? current.sidebarWidth ?? 18,
        requestPanelHeight: partial.requestPanelHeight ?? current.requestPanelHeight ?? 35,
      },
    }).catch(() => {});
  }, []);

  // 水平布局变化时持久化侧边栏宽度
  const onHorizontalLayoutChanged = useCallback(
    (layout: Layout) => {
      if (layout["sidebar-panel"]) {
        const val = layout["sidebar-panel"];
        state.updateSettings({ sidebarWidth: val });
        saveSettingsDirectly({ sidebarWidth: val });
      }
    },
    [state.updateSettings, saveSettingsDirectly],
  );

  // 垂直布局变化时持久化请求面板高度
  const onVerticalLayoutChanged = useCallback(
    (layout: Layout) => {
      if (layout["request-panel"]) {
        const val = layout["request-panel"];
        state.updateSettings({ requestPanelHeight: val });
        saveSettingsDirectly({ requestPanelHeight: val });
      }
    },
    [state.updateSettings, saveSettingsDirectly],
  );

  // 智能加载：如果请求已在一个标签页中打开，切换到该标签页而非重复加载
  const smartLoadCollectionRequest = useCallback(
    (item: RequestItem, collectionId: string) => {
      const existingTab = state.tabs.find(
        (t) =>
          t.editingRequest?.collectionId === collectionId &&
          t.editingRequest?.requestId === item.id,
      );
      if (existingTab) {
        state.switchTab(existingTab.id);
      } else {
        state.loadCollectionRequest(item, collectionId);
      }
    },
    [state.tabs, state.switchTab, state.loadCollectionRequest],
  );

  // 从侧边栏在新标签页中打开请求
  const openInNewTab = useCallback(
    (item: RequestItem, collectionId: string) => {
      state.openInTab(item, collectionId, true);
    },
    [state.openInTab],
  );

  // 快速切换暗色/浅色主题
  const toggleTheme = useCallback(() => {
    const next = state.settings.theme === "dark" ? "light" : "dark";
    state.updateSettings({ theme: next });
  }, [state.settings.theme, state.updateSettings]);

  // 初始化快捷键引擎（仅挂载一次）
  useEffect(() => {
    const engine = new ShortcutEngine();

    // 从 usePulse 获取实际处理函数并映射到命令
    // 通过 handlerRef 访问最新引用，避免 useEffect([]) 闭包陈旧性问题
    const getHandlers = () => handlerRef.current;
    const commands = DEFAULT_COMMANDS.map((cmd) => {
      switch (cmd.id) {
        case "sendRequest":
          return { ...cmd, handler: () => getHandlers().sendRequest() };
        case "newRequest":
          return { ...cmd, handler: () => getHandlers().newTab() };
        case "saveRequest":
          return { ...cmd, handler: () => getHandlers().saveCurrentRequest() };
        case "focusUrlBar":
          return {
            ...cmd,
            handler: () =>
              document.getElementById("request-url-input")?.focus(),
          };
        case "clearResponse":
          return { ...cmd, handler: () => getHandlers().clearResponse() };
        case "switchCollectionsTab":
          return {
            ...cmd,
            handler: () => getHandlers().setSidebarTab("collections"),
          };
        case "switchHistoryTab":
          return { ...cmd, handler: () => getHandlers().setSidebarTab("history") };
        case "switchEnvironmentsTab":
          return {
            ...cmd,
            handler: () => getHandlers().setSidebarTab("environments"),
          };
        case "requestTabParams":
          return { ...cmd, handler: () => getHandlers().setRequestTab("params") };
        case "requestTabAuth":
          return { ...cmd, handler: () => getHandlers().setRequestTab("auth") };
        case "requestTabHeaders":
          return { ...cmd, handler: () => getHandlers().setRequestTab("headers") };
        case "requestTabBody":
          return { ...cmd, handler: () => getHandlers().setRequestTab("body") };
        case "responseTabBody":
          return { ...cmd, handler: () => getHandlers().setResponseTab("body") };
        case "responseTabHeaders":
          return { ...cmd, handler: () => getHandlers().setResponseTab("headers") };
        case "dialogConfirm":
          return { ...cmd, handler: () => getHandlers().confirmSave() };
        case "dialogCancel":
          return { ...cmd, handler: () => getHandlers().cancelSave() };
        case "openKeybindingsEditor":
          return { ...cmd, handler: () => setEditorOpen(true) };
        case "openSettings":
          return { ...cmd, handler: () => getHandlers().openSettingsDialog() };
        case "closeTab":
          return {
            ...cmd,
            handler: () => getHandlers().closeTab(getHandlers().activeTabId),
          };
        case "nextTab": {
          return {
            ...cmd,
            handler: () => {
              const h = getHandlers();
              const idx = h.tabs.findIndex(
                (t: { id: string }) => t.id === h.activeTabId,
              );
              if (idx < 0) return;
              const next = h.tabs[(idx + 1) % h.tabs.length];
              h.switchTab(next.id);
            },
          };
        }
        case "prevTab": {
          return {
            ...cmd,
            handler: () => {
              const h = getHandlers();
              const idx = h.tabs.findIndex(
                (t: { id: string }) => t.id === h.activeTabId,
              );
              if (idx < 0) return;
              const prev =
                h.tabs[(idx - 1 + h.tabs.length) % h.tabs.length];
              h.switchTab(prev.id);
            },
          };
        }
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
    // handlerRef.current 在每次渲染时更新，快捷键引擎通过 ref 调用
    // 最新 handler，解决 useEffect([]) 的闭包陈旧性问题
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

  // ── PanelGroup 引用：用于设置加载完成后更新布局 ──
  const horizontalGroupRef = useGroupRef();
  const verticalGroupRef = useGroupRef();

  /** 设置加载完成后，将持久化的布局值应用到 PanelGroup */
  useEffect(() => {
    if (!state.settingsLoaded) return;
    // requestAnimationFrame 确保 PanelGroup 已完成布局计算
    const raf = requestAnimationFrame(() => {
      if (state.settings.sidebarWidth !== undefined) {
        horizontalGroupRef.current?.setLayout({
          "sidebar-panel": state.settings.sidebarWidth,
          "main-panel": 100 - state.settings.sidebarWidth,
        });
      }
      if (state.settings.requestPanelHeight !== undefined) {
        verticalGroupRef.current?.setLayout({
          "request-panel": state.settings.requestPanelHeight,
          "response-panel": 100 - state.settings.requestPanelHeight,
        });
      }
    });
    return () => cancelAnimationFrame(raf);
    // 只在 settingsLoaded 首次变为 true 时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settingsLoaded]);

  return (
    <div
      data-theme={state.settingsLoaded ? state.settings.theme : "dark"}
      className="h-screen flex overflow-hidden bg-pulse-deepest"
      style={{
        fontFamily: state.settingsLoaded ? FONT_FAMILY_MAP[state.settings.fontFamily] || undefined : undefined,
        fontSize: state.settingsLoaded ? `${FONT_SIZE_PX_MAP[state.settings.fontSize] || 14}px` : undefined,
      }}
    >
      <PanelGroup
        orientation="horizontal"
        defaultLayout={{
          "sidebar-panel": state.settings.sidebarWidth ?? 18,
          "main-panel": 100 - (state.settings.sidebarWidth ?? 18),
        }}
        onLayoutChanged={onHorizontalLayoutChanged}
        className="flex-1 min-w-0"
        groupRef={horizontalGroupRef}
      >
        {/* ── 侧边栏（可水平拖拽调整宽度） ── */}
        <Panel
          id="sidebar-panel"
          minSize="10%"
          maxSize="35%"
          className="flex flex-col"
        >
          <Sidebar
            collections={state.collections}
            history={state.history}
            activeTab={state.sidebarTab}
            onTabChange={state.setSidebarTab}
            onLoadHistory={state.loadFromHistory}
            onLoadRequest={smartLoadCollectionRequest}
            /* ── 新建请求 & 集合管理 ── */
            onNewRequest={state.newTab}
            onDeleteRequest={state.deleteCollectionRequest}
            onRenameRequest={state.renameCollectionRequest}
            onAddCollection={state.addCollection}
            onDeleteCollection={state.deleteCollection}
            onUpdateCollectionAuth={state.updateCollectionAuth}
            onMoveRequest={state.moveRequest}
            onMoveCollection={state.moveCollection}
            onUpdateCollectionBaseUrl={state.updateCollectionBaseUrl}
            onUpdateCollectionVariables={state.updateCollectionVariables}
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
            onImport={state.openImportDialog}
            onExport={state.openExportDialog}
            onRunTestScript={state.openTestScriptDialog}
            /* ── 新标签页打开请求 ── */
            onOpenInNewTab={openInNewTab}
            /* ── 打开设置面板 ── */
            onOpenSettings={state.openSettingsDialog}
            /* ── 主题切换 ── */
            theme={state.settings.theme}
            onToggleTheme={toggleTheme}
          />
        </Panel>

        {/* 水平拖拽分隔条 */}
        <PanelResizeHandle className="resize-handle-horizontal" />

        {/* ── 主区域 ── */}
        <Panel id="main-panel" minSize="50%" className="flex flex-col">
          {/* 标签栏 */}
          <TabBar
            tabs={state.tabs}
            activeTabId={state.activeTabId}
            onSwitchTab={state.switchTab}
            onCloseTab={state.closeTab}
            onNewTab={state.newTab}
          />

          {/* 请求面板 + 响应面板（垂直可拖拽） */}
          <div className="flex-1 min-h-0 flex flex-col">
            <PanelGroup
              orientation="vertical"
              defaultLayout={{
                "request-panel": state.settings.requestPanelHeight ?? 35,
                "response-panel": 100 - (state.settings.requestPanelHeight ?? 35),
              }}
              onLayoutChanged={onVerticalLayoutChanged}
              className="flex-1 min-h-0"
              groupRef={verticalGroupRef}
            >
              <Panel
                id="request-panel"
                minSize="10%"
                maxSize="60%"
                className="flex flex-col"
              >
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
                  bodyFormData={state.bodyFormData}
                  onAddFormDataField={state.addFormDataField}
                  onUpdateFormDataField={state.updateFormDataField}
                  onRemoveFormDataField={state.removeFormDataField}
                  onToggleFormDataType={state.toggleFormDataType}
                  onPickFormFile={state.pickFormFile}
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
              </Panel>

              {/* 垂直拖拽分隔条 */}
              <PanelResizeHandle className="resize-handle-vertical" />

              <Panel id="response-panel" minSize="20%" className="flex flex-col">
                <ResponsePanel
                  response={state.response}
                  isLoading={state.isLoading}
                  error={state.error}
                  responseTab={state.responseTab}
                  onResponseTabChange={state.setResponseTab}
                />
              </Panel>
            </PanelGroup>
          </div>
        </Panel>
      </PanelGroup>

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

      {/* 导入对话框 */}
      <ImportDialog
        visible={state.importDialogVisible}
        preview={state.importPreview}
        fileName={state.importFileName}
        strategy={state.importStrategy}
        hasPending={state.pendingImportPath !== null}
        error={state.importError}
        onStrategyChange={state.setImportStrategy}
        onPickFile={state.handlePickImportFile}
        onConfirm={state.handleConfirmImport}
        onCancel={state.closeImportDialog}
      />

      {/* 导出对话框 */}
      <ExportDialog
        visible={state.exportDialogVisible}
        collections={state.collections}
        environmentsCount={state.environments.length}
        onExport={state.handleExport}
        onCancel={state.closeExportDialog}
      />

      {/* Test Script 对话框 */}
      <TestScriptDialog
        visible={state.testScriptDialogVisible}
        fileName={state.testScriptFileName}
        hasPending={state.pendingTestScriptPath !== null}
        isRunning={state.isTestRunning}
        result={state.testRunResult}
        error={state.testRunError}
        onPickFile={state.handlePickTestScript}
        onRun={state.handleRunTestScript}
        onCancel={state.closeTestScriptDialog}
      />

      {/* 设置对话框 */}
      <SettingsDialog
        visible={state.settingsDialogVisible}
        settings={state.settings}
        onUpdateSettings={state.updateSettings}
        onClose={state.closeSettingsDialog}
        engine={engineRef.current}
      />

      {/* Toast 通知容器 */}
      <ToastContainer toasts={state.toasts} onDismiss={state.dismissToast} />
    </div>
  );
}
