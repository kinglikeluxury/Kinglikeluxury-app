import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/i18n"; // Import i18n configuration

// Initialize i18next before rendering the app
createRoot(document.getElementById("root")!).render(<App />);

// Register service worker for push notifications and PWA caching.
// Runs after the app mounts so it never blocks first render.
// Any failure is logged and silently ignored — it does not affect the app.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("[SW] Registered — scope:", reg.scope);
      })
      .catch((err) => {
        console.error("[SW] Registration failed:", err);
      });
  });
}
