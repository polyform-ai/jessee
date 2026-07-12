import type { OverlayMode, Rect, RuntimeMessage } from "./types";

declare global {
  interface Window {
    __screenTicketRecorderLoaded?: boolean;
  }
}

let mode: OverlayMode = "off";
let root: HTMLDivElement | undefined;
let cursor: HTMLDivElement | undefined;
let startPoint: { x: number; y: number } | undefined;
let draftRect: HTMLDivElement | undefined;

if (window.__screenTicketRecorderLoaded) {
  // The background may force-inject this script after an unpacked extension reload.
  // Avoid duplicate event listeners in tabs that already have the content script.
} else {
  window.__screenTicketRecorderLoaded = true;

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message.type === "SET_OVERLAY_MODE") {
    mode = message.mode;
    ensureOverlay();
    updateCursor();
  }
});

window.addEventListener("mousemove", (event) => {
  if (!cursor) return;
  cursor.style.transform = `translate(${event.clientX - 27}px, ${event.clientY - 27}px)`;
});

window.addEventListener("mousedown", (event) => {
  if (mode !== "highlight" && mode !== "redact") return;
  ensureOverlay();
  startPoint = { x: event.clientX, y: event.clientY };
  draftRect = document.createElement("div");
  draftRect.className = mode === "redact" ? "str-draft str-redact" : "str-draft str-highlight";
  root?.appendChild(draftRect);
  event.preventDefault();
});

window.addEventListener("mousemove", (event) => {
  if (!startPoint || !draftRect) return;
  const rect = normalizeRect(startPoint.x, startPoint.y, event.clientX, event.clientY);
  Object.assign(draftRect.style, toStyleRect(rect));
});

window.addEventListener("mouseup", (event) => {
  if (!startPoint || !draftRect) return;
  const rect = normalizeRect(startPoint.x, startPoint.y, event.clientX, event.clientY);
  const kind = mode === "redact" ? "redaction" : "highlight";
  const payload: Rect = { ...rect, kind, color: kind === "redaction" ? "#111111" : "#f59e0b" };
  draftRect.className = kind === "redaction" ? "str-box str-redact" : "str-box str-highlight";
  chrome.runtime.sendMessage({ type: "CONTENT_RECT_CREATED", rect: payload });
  startPoint = undefined;
  draftRect = undefined;
});

window.addEventListener("click", (event) => {
  if (mode !== "cursor") return;
  void chrome.runtime.sendMessage({ type: "CONTENT_CLICKED", point: { x: event.clientX, y: event.clientY } });
}, true);

function ensureOverlay(): void {
  if (root) return;
  root = document.createElement("div");
  root.id = "screen-ticket-recorder-overlay";
  root.innerHTML = `<style>
    #screen-ticket-recorder-overlay {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483647;
      font-family: Inter, system-ui, sans-serif;
    }
    #screen-ticket-recorder-overlay .str-cursor {
      position: fixed;
      width: 54px;
      height: 54px;
      border: 5px solid #ff2d20;
      border-radius: 999px;
      background: rgba(255, 214, 10, 0.2);
      box-shadow: 0 0 0 7px rgba(255, 45, 32, 0.26), 0 0 30px rgba(255, 45, 32, 0.62);
      pointer-events: none;
      left: 0;
      top: 0;
      transform: translate(calc(50vw - 27px), calc(50vh - 27px));
    }
    #screen-ticket-recorder-overlay .str-draft,
    #screen-ticket-recorder-overlay .str-box {
      position: fixed;
      box-sizing: border-box;
      pointer-events: none;
    }
    #screen-ticket-recorder-overlay .str-highlight {
      border: 3px solid #f59e0b;
      background: rgba(245, 158, 11, 0.18);
    }
    #screen-ticket-recorder-overlay .str-redact {
      border: 3px solid #111111;
      background: rgba(17, 17, 17, 0.82);
    }
  </style>`;
  document.documentElement.appendChild(root);
}

function updateCursor(): void {
  if (!root) return;
  if (mode === "cursor" && !cursor) {
    cursor = document.createElement("div");
    cursor.className = "str-cursor";
    root.appendChild(cursor);
  }
  if (cursor) cursor.style.display = mode === "cursor" ? "block" : "none";
  root.style.pointerEvents = mode === "highlight" || mode === "redact" ? "auto" : "none";
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  };
}

function toStyleRect(rect: Rect): Partial<CSSStyleDeclaration> {
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  };
}

}
