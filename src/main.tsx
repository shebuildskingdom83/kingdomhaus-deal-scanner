import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { usesCloudWorkspace } from "./workspaceMode";
import PublicDemoApp from "./PublicDemoApp";

const LocalDocumentWorkspace = import.meta.env.DEV && import.meta.env.MODE === "local-documents" && ["127.0.0.1", "localhost"].includes(location.hostname) ? lazy(() => import("./LocalDocumentWorkspace")) : null;
const CloudApp = lazy(() => import("./CloudApp"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {LocalDocumentWorkspace ? <Suspense fallback={<p role="status">Loading local synthetic documents…</p>}><LocalDocumentWorkspace /></Suspense> : window.location.pathname.endsWith("/demo") ? <PublicDemoApp /> : usesCloudWorkspace(window.location.pathname, import.meta.env.MODE) ? <Suspense fallback={<p role="status">Loading cloud workspace...</p>}><CloudApp /></Suspense> : <App />}
  </StrictMode>
);
