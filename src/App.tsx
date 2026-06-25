import { usePulse } from "./hooks/usePulse";
import Sidebar from "./components/Sidebar";
import RequestPanel from "./components/RequestPanel";
import ResponsePanel from "./components/ResponsePanel";

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
        /* ── New request & collection management ── */
        onNewRequest={state.newRequest}
        onDeleteRequest={state.deleteCollectionRequest}
        onRenameRequest={state.renameCollectionRequest}
        onAddCollection={state.addCollection}
        onUpdateCollectionAuth={state.updateCollectionAuth}
        onMoveRequest={state.moveRequest}
        onMoveCollection={state.moveCollection}
        /* ── Environment props ── */
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
          requestTab={state.requestTab}
          onRequestTabChange={state.setRequestTab}
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
    </div>
  );
}
