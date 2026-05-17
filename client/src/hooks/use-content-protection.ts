import { useEffect } from "react";

/**
 * Protects page content from copying, right-click, and selection.
 * Apply inside any page component that displays proprietary content.
 */
export function useContentProtection() {
  useEffect(() => {
    const BLOCKED_KEYS = new Set(["c", "a", "x", "u", "s", "p"]);

    const blockContextMenu = (e: MouseEvent) => e.preventDefault();

    const blockKeyboard = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && BLOCKED_KEYS.has(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();
      }
      // Block F12 / DevTools shortcut
      if (e.key === "F12") e.preventDefault();
      // Block Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };

    const blockCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const blockDrag = (e: DragEvent) => e.preventDefault();

    document.addEventListener("contextmenu", blockContextMenu);
    document.addEventListener("keydown", blockKeyboard);
    document.addEventListener("copy", blockCopy);
    document.addEventListener("cut", blockCopy);
    document.addEventListener("dragstart", blockDrag);

    // Inject CSS to disable text selection across the page
    const styleId = "content-protection-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .protected-content,
        .protected-content * {
          -webkit-user-select: none !important;
          -moz-user-select: none !important;
          -ms-user-select: none !important;
          user-select: none !important;
          -webkit-touch-callout: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    return () => {
      document.removeEventListener("contextmenu", blockContextMenu);
      document.removeEventListener("keydown", blockKeyboard);
      document.removeEventListener("copy", blockCopy);
      document.removeEventListener("cut", blockCopy);
      document.removeEventListener("dragstart", blockDrag);
    };
  }, []);
}
