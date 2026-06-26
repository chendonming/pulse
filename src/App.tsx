import { usePulse } from "./hooks/usePulse";
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
 */
export default function App() {
  const state = usePulse();

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

      {/* 请求保存命名对话框（替代 window.prompt） */}
      <SaveDialog
        visible={state.saveDialogVisible}
        defaultName={state.saveDialogName}
        onConfirm={state.confirmSave}
        onCancel={state.cancelSave}
      />
    </div>
  );
}
