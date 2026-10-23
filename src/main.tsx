import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { usesCloudWorkspace } from "./workspaceMode";

const CloudApp = lazy(() => import("./CloudApp"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {usesCloudWorkspace(window.location.pathname, import.meta.env.MODE) ? <Suspense fallback={<p role="status">Loading cloud workspace...</p>}><CloudApp /></Suspense> : <App />}
  </StrictMode>
);
