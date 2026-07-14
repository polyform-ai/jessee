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
let heldMode: "highlight" | "redact" | undefined;
let interactionMode: "highlight" | "redact" | undefined;
let shortcutBadge: HTMLDivElement | undefined;
let shortcutBadgeTimeout: number | undefined;
let suppressNextClick = false;

if (!window.__screenTicketRecorderLoaded) {
  window.__screenTicketRecorderLoaded = true;

  chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
    if (message.type !== "SET_OVERLAY_MODE") return;
    mode = message.mode;
    ensureOverlay();
    updateOverlayState();
  });

  window.addEventListener("mousemove", (event) => {
    if (cursor) cursor.style.transform = `translate(${event.clientX - 27}px, ${event.clientY - 27}px)`;
    if (!startPoint || !draftRect) return;
    Object.assign(draftRect.style, toStyleRect(normalizeRect(startPoint.x, startPoint.y, event.clientX, event.clientY)));
  }, true);

  window.addEventListener("keydown", (event) => {
    if (mode === "off" || event.repeat || isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === "c") {
      clearAnnotations();
      void chrome.runtime.sendMessage({ type: "CONTENT_CLEAR_ANNOTATIONS" });
      consumeShortcut(event);
      return;
    }
    if (key !== "b" && key !== "r") return;
    heldMode = key === "r" ? "redact" : "highlight";
    ensureOverlay();
    updateOverlayState();
    consumeShortcut(event);
  }, true);

  window.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    const releasedActiveShortcut = (key === "b" && heldMode === "highlight") || (key === "r" && heldMode === "redact");
    if (!releasedActiveShortcut) return;
    if (!startPoint) heldMode = undefined;
    updateOverlayState();
    consumeShortcut(event);
  }, true);

  window.addEventListener("mousedown", (event) => {
    const drawingMode = heldMode ?? (mode === "highlight" || mode === "redact" ? mode : undefined);
    if (!drawingMode) return;
    interactionMode = drawingMode;
    startPoint = { x: event.clientX, y: event.clientY };
    draftRect = document.createElement("div");
    draftRect.className = drawingMode === "redact" ? "str-draft str-redact" : "str-draft str-highlight";
    root?.appendChild(draftRect);
    event.preventDefault();
    event.stopPropagation();
  }, true);

  window.addEventListener("mouseup", (event) => {
    if (!startPoint || !draftRect || !interactionMode) return;
    const rect = normalizeRect(startPoint.x, startPoint.y, event.clientX, event.clientY);
    const kind = interactionMode === "redact" ? "redaction" : "highlight";
    const payload: Rect = { ...rect, kind, color: kind === "redaction" ? "#111111" : "#f59e0b" };
    draftRect.className = kind === "redaction" ? "str-box str-redact" : "str-box str-highlight";
    void chrome.runtime.sendMessage({ type: "CONTENT_RECT_CREATED", rect: payload });
    startPoint = undefined;
    draftRect = undefined;
    interactionMode = undefined;
    suppressNextClick = true;
    updateOverlayState();
    event.preventDefault();
    event.stopPropagation();
  }, true);

  window.addEventListener("click", (event) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (mode !== "cursor" || heldMode) return;
    void chrome.runtime.sendMessage({ type: "CONTENT_CLICKED", point: { x: event.clientX, y: event.clientY } });
  }, true);
}

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
      border: 4px solid #f59e0b;
      background: transparent;
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9), 0 4px 20px rgba(245, 158, 11, 0.35);
    }
    #screen-ticket-recorder-overlay .str-redact {
      border: 2px solid rgba(255, 255, 255, 0.72);
      background: rgba(24, 24, 27, 0.72);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
    }
    #screen-ticket-recorder-overlay .str-shortcut-badge {
      position: fixed;
      left: 50%;
      bottom: 28px;
      transform: translateX(-50%);
      display: none;
      align-items: center;
      border: 1px solid rgba(255, 255, 255, 0.24);
      border-radius: 999px;
      background: rgba(24, 24, 27, 0.9);
      color: white;
      padding: 9px 14px;
      font-size: 13px;
      font-weight: 650;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.28);
    }
  </style>`;
  document.documentElement.appendChild(root);
  shortcutBadge = document.createElement("div");
  shortcutBadge.className = "str-shortcut-badge";
  root.appendChild(shortcutBadge);
}

function updateOverlayState(): void {
  if (!root) return;
  if (mode === "off") {
    root.querySelectorAll(".str-draft, .str-box").forEach((element) => element.remove());
    startPoint = undefined;
    draftRect = undefined;
    interactionMode = undefined;
    heldMode = undefined;
  }
  if (mode === "cursor" && !cursor) {
    cursor = document.createElement("div");
    cursor.className = "str-cursor";
    root.appendChild(cursor);
  }
  if (cursor) cursor.style.display = mode === "cursor" && !heldMode ? "block" : "none";
  root.style.pointerEvents = heldMode || mode === "highlight" || mode === "redact" ? "auto" : "none";
  if (shortcutBadge) {
    shortcutBadge.textContent = heldMode === "redact" ? "R · Drag to redact" : heldMode === "highlight" ? "B · Drag an outline box" : "";
    shortcutBadge.style.display = heldMode ? "flex" : "none";
  }
}

function clearAnnotations(): void {
  root?.querySelectorAll(".str-draft, .str-box").forEach((element) => element.remove());
  startPoint = undefined;
  draftRect = undefined;
  interactionMode = undefined;
  heldMode = undefined;
  suppressNextClick = false;
  updateOverlayState();
  showShortcutConfirmation("C · Annotations cleared");
}

function showShortcutConfirmation(message: string): void {
  if (!shortcutBadge) return;
  if (shortcutBadgeTimeout) window.clearTimeout(shortcutBadgeTimeout);
  shortcutBadge.textContent = message;
  shortcutBadge.style.display = "flex";
  shortcutBadgeTimeout = window.setTimeout(() => {
    if (!shortcutBadge || heldMode) return;
    shortcutBadge.textContent = "";
    shortcutBadge.style.display = "none";
  }, 1_200);
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : undefined;
  return Boolean(element?.isContentEditable || element?.closest("input, textarea, select, [contenteditable='true']"));
}

function consumeShortcut(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
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
