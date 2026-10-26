import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SessionProvider } from "./session";
import { ConfirmProvider, ToastProvider } from "./ui/feedback";
import "./styles/admin.css";

const container = document.getElementById("root");
if (!container) throw new Error("root element missing");

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
);

// The service worker only caches the application shell (see sw.ts); it needs https or localhost.
if ("serviceWorker" in navigator && (window.isSecureContext || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" }).catch(() => undefined);
  });
}
