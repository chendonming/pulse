import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import LogViewer from "./LogViewer";
import "./index.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

function Main() {
  const label = getCurrentWindow().label;

  if (label === "logs") {
    return <LogViewer />;
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Main />
  </React.StrictMode>,
);
