// @totum/ui: Sandboxed renderer: command bar, task view, approval dialogs.
import type { TotumApi } from "@totum/shared";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

declare global {
  interface Window {
    /** Exposed by the preload (packages/main/src/preload.ts). */
    totum: TotumApi;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <App api={window.totum} />
  </StrictMode>,
);
