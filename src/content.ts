import type { OverlayMode, Rect, RuntimeMessage } from "./types";
import { formatRecordingElapsed, recordingHudShortcutMarkup } from "./recordingHud";

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
let cursorClickTimeout: number | undefined;
let recordingTimer: number | undefined;
let recordingStartedAt: number | undefined;
let suppressNextClick = false;

if (!window.__screenTicketRecorderLoaded) {
  window.__screenTicketRecorderLoaded = true;

  chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
    if (message.type !== "SET_OVERLAY_MODE") return;
    mode = message.mode;
    if (message.mode === "cursor") recordingStartedAt = message.startedAt ?? recordingStartedAt ?? Date.now();
    ensureOverlay();
    updateOverlayState();
  });

  window.addEventListener("mousemove", (event) => {
    if (cursor) cursor.style.transform = `translate3d(${event.clientX - 4}px, ${event.clientY - 3}px, 0)`;
    if (!startPoint || !draftRect) return;
    Object.assign(draftRect.style, toStyleRect(normalizeRect(startPoint.x, startPoint.y, event.clientX, event.clientY)));
  }, true);

  window.addEventListener("keydown", (event) => {
    if (mode === "off" || event.repeat || isTypingTarget(event.target) || isOverlayUiTarget(event.target)) return;
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
    if (isOverlayUiTarget(event.target)) return;
    const drawingMode = heldMode ?? (mode === "highlight" || mode === "redact" ? mode : undefined);
    if (!drawingMode && mode === "cursor") setCursorPressed(true);
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
    if (isOverlayUiTarget(event.target) && !startPoint) return;
    if (mode === "cursor" && !heldMode) animateCursorClick();
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

  window.addEventListener("blur", () => setCursorPressed(false), true);

  window.addEventListener("click", (event) => {
    if (isOverlayUiTarget(event.target)) return;
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
    html.str-recording-cursor-active,
    html.str-recording-cursor-active * {
      cursor: none !important;
    }
    #screen-ticket-recorder-overlay .str-cursor {
      position: fixed;
      z-index: 2;
      width: 38px;
      height: 42px;
      pointer-events: none;
      left: 0;
      top: 0;
      transform: translate3d(calc(50vw - 4px), calc(50vh - 3px), 0);
      will-change: transform;
    }
    #screen-ticket-recorder-overlay .str-pointer-glow {
      position: absolute;
      left: -7px;
      top: -7px;
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(91, 94, 248, 0.42) 0%, rgba(91, 94, 248, 0.12) 48%, transparent 72%);
      filter: blur(2px);
      animation: str-glow-breathe 1.8s ease-in-out infinite;
    }
    #screen-ticket-recorder-overlay .str-pointer-shape {
      position: absolute;
      left: 0;
      top: 0;
      width: 28px;
      height: 34px;
      overflow: visible;
      transform-origin: 4px 3px;
      transition: transform 90ms cubic-bezier(0.2, 0.9, 0.2, 1);
      filter: drop-shadow(0 2px 2px rgba(24, 24, 27, 0.32)) drop-shadow(0 0 7px rgba(91, 94, 248, 0.72));
    }
    #screen-ticket-recorder-overlay .str-cursor.is-pressing .str-pointer-shape {
      transform: scale(0.78);
    }
    #screen-ticket-recorder-overlay .str-cursor.is-clicking .str-pointer-shape {
      animation: str-pointer-pop 280ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    #screen-ticket-recorder-overlay .str-click-pulse {
      position: absolute;
      left: -8px;
      top: -8px;
      width: 24px;
      height: 24px;
      border: 2px solid rgba(91, 94, 248, 0.85);
      border-radius: 999px;
      opacity: 0;
      transform: scale(0.3);
    }
    #screen-ticket-recorder-overlay .str-cursor.is-clicking .str-click-pulse {
      animation: str-click-pulse 420ms ease-out;
    }
    @keyframes str-pointer-pop {
      0% { transform: scale(0.78); }
      48% { transform: scale(1.18); }
      100% { transform: scale(1); }
    }
    @keyframes str-click-pulse {
      0% { opacity: 0.95; transform: scale(0.3); }
      100% { opacity: 0; transform: scale(1.7); }
    }
    @keyframes str-glow-breathe {
      0%, 100% { opacity: 0.72; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.12); }
    }
    @media (prefers-reduced-motion: reduce) {
      #screen-ticket-recorder-overlay .str-pointer-glow,
      #screen-ticket-recorder-overlay .str-cursor.is-clicking .str-pointer-shape,
      #screen-ticket-recorder-overlay .str-cursor.is-clicking .str-click-pulse {
        animation: none;
      }
    }
    #screen-ticket-recorder-overlay .str-recording-hud {
      position: fixed;
      z-index: 1;
      top: 18px;
      right: 18px;
      width: 224px;
      color: #18181b;
      pointer-events: auto;
      filter: drop-shadow(0 18px 32px rgba(24, 24, 27, 0.18));
    }
    #screen-ticket-recorder-overlay .str-recording-hud-summary {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 9px;
      box-sizing: border-box;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 999px;
      background: rgba(24, 24, 27, 0.94);
      padding: 8px 12px;
      color: white;
      font: inherit;
      cursor: pointer;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset;
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    #screen-ticket-recorder-overlay .str-recording-dot {
      width: 8px;
      height: 8px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: #fb7185;
      box-shadow: 0 0 0 4px rgba(251, 113, 133, 0.15);
      animation: str-recording-pulse 1.8s ease-in-out infinite;
    }
    #screen-ticket-recorder-overlay .str-recording-label {
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
    }
    #screen-ticket-recorder-overlay .str-recording-time {
      margin-left: auto;
      color: #d4d4d8;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    #screen-ticket-recorder-overlay .str-recording-chevron {
      color: #a1a1aa;
      font-size: 10px;
      transition: transform 160ms ease;
    }
    #screen-ticket-recorder-overlay .str-recording-hud:hover .str-recording-chevron,
    #screen-ticket-recorder-overlay .str-recording-hud:focus-within .str-recording-chevron,
    #screen-ticket-recorder-overlay .str-recording-hud.is-open .str-recording-chevron {
      transform: rotate(180deg);
    }
    #screen-ticket-recorder-overlay .str-recording-hud-panel {
      visibility: hidden;
      margin-top: 8px;
      border: 1px solid rgba(228, 228, 231, 0.96);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.97);
      padding: 14px;
      opacity: 0;
      transform: translateY(-6px) scale(0.98);
      transform-origin: top right;
      transition: opacity 140ms ease, transform 140ms ease, visibility 140ms;
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }
    #screen-ticket-recorder-overlay .str-recording-hud:hover .str-recording-hud-panel,
    #screen-ticket-recorder-overlay .str-recording-hud:focus-within .str-recording-hud-panel,
    #screen-ticket-recorder-overlay .str-recording-hud.is-open .str-recording-hud-panel {
      visibility: visible;
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    #screen-ticket-recorder-overlay .str-recording-hud-panel > strong {
      display: block;
      font-size: 13px;
      line-height: 1.35;
    }
    #screen-ticket-recorder-overlay .str-recording-hud-panel > p {
      margin: 4px 0 12px;
      color: #71717a;
      font-size: 11px;
      line-height: 1.45;
    }
    #screen-ticket-recorder-overlay .str-recording-guide {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 5px;
      margin-bottom: 12px;
    }
    #screen-ticket-recorder-overlay .str-recording-guide span {
      border: 1px solid #ede9fe;
      border-radius: 8px;
      background: #f5f3ff;
      padding: 7px 5px;
      color: #5b21b6;
      font-size: 9px;
      font-weight: 700;
      line-height: 1.3;
      text-align: center;
    }
    #screen-ticket-recorder-overlay .str-recording-shortcuts {
      display: grid;
      gap: 6px;
      border-top: 1px solid #f4f4f5;
      padding-top: 10px;
    }
    #screen-ticket-recorder-overlay .str-recording-shortcut {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
    }
    #screen-ticket-recorder-overlay .str-recording-shortcut kbd {
      display: flex;
      height: 24px;
      align-items: center;
      justify-content: center;
      border: 1px solid #d4d4d8;
      border-bottom-width: 2px;
      border-radius: 6px;
      background: #fafafa;
      color: #3f3f46;
      font: 700 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    #screen-ticket-recorder-overlay .str-recording-shortcut span,
    #screen-ticket-recorder-overlay .str-recording-shortcut strong,
    #screen-ticket-recorder-overlay .str-recording-shortcut small {
      display: block;
    }
    #screen-ticket-recorder-overlay .str-recording-shortcut strong {
      font-size: 11px;
      line-height: 1.2;
    }
    #screen-ticket-recorder-overlay .str-recording-shortcut small {
      margin-top: 1px;
      color: #71717a;
      font-size: 9px;
      line-height: 1.2;
    }
    #screen-ticket-recorder-overlay .str-finish-recording {
      width: 100%;
      margin-top: 12px;
      border: 0;
      border-radius: 9px;
      background: #18181b;
      padding: 9px 12px;
      color: white;
      font: 700 11px Inter, system-ui, sans-serif;
      cursor: pointer;
    }
    #screen-ticket-recorder-overlay .str-finish-recording:hover:not(:disabled) {
      background: #27272a;
    }
    #screen-ticket-recorder-overlay .str-finish-recording:focus-visible,
    #screen-ticket-recorder-overlay .str-recording-hud-summary:focus-visible {
      outline: 3px solid rgba(139, 92, 246, 0.45);
      outline-offset: 2px;
    }
    #screen-ticket-recorder-overlay .str-finish-recording:disabled {
      cursor: wait;
      opacity: 0.62;
    }
    @keyframes str-recording-pulse {
      0%, 100% { opacity: 0.65; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1); }
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
  </style>`;
  document.documentElement.appendChild(root);
}

function updateOverlayState(): void {
  if (!root) return;
  if (mode === "off") {
    root.querySelectorAll(".str-draft, .str-box").forEach((element) => element.remove());
    startPoint = undefined;
    draftRect = undefined;
    interactionMode = undefined;
    heldMode = undefined;
    recordingStartedAt = undefined;
    stopRecordingTimer();
    root.querySelector(".str-recording-hud")?.remove();
    document.documentElement.classList.remove("str-recording-cursor-active");
  }
  if (mode === "cursor" && !cursor) {
    cursor = document.createElement("div");
    cursor.className = "str-cursor";
    cursor.innerHTML = `<span class="str-pointer-glow"></span><svg class="str-pointer-shape" viewBox="0 0 28 34" aria-hidden="true"><path d="M3.4 2.2 23.7 21c1.2 1.1.4 3.1-1.2 3.1h-8l-3.9 7.1c-.8 1.5-3.1.9-3.1-.8V4.1c0-2 2.2-3.2 3.4-1.9Z" fill="#fff" stroke="#18181b" stroke-width="2.2" stroke-linejoin="round"/></svg><span class="str-click-pulse"></span>`;
    root.appendChild(cursor);
  }
  if (cursor) cursor.style.display = mode === "cursor" && !heldMode ? "block" : "none";
  if (mode !== "off") ensureRecordingHud();
  document.documentElement.classList.toggle("str-recording-cursor-active", mode === "cursor" && !heldMode);
  root.style.pointerEvents = heldMode || mode === "highlight" || mode === "redact" ? "auto" : "none";
}

function ensureRecordingHud(): void {
  if (!root || root.querySelector(".str-recording-hud")) return;
  const hud = document.createElement("aside");
  hud.className = "str-recording-hud";
  hud.dataset.recordingHud = "";
  hud.setAttribute("aria-label", "JesSee recording controls");
  hud.innerHTML = `
    <button class="str-recording-hud-summary" type="button" aria-expanded="false" aria-controls="str-recording-hud-panel">
      <span class="str-recording-dot" aria-hidden="true"></span>
      <span class="str-recording-label">Recording</span>
      <time class="str-recording-time">${formatRecordingElapsed(recordingStartedAt)}</time>
      <span class="str-recording-chevron" aria-hidden="true">⌄</span>
    </button>
    <div class="str-recording-hud-panel" id="str-recording-hud-panel">
      <strong>Keep the story clear</strong>
      <p>Hover here anytime. Your walkthrough keeps recording while you use these controls.</p>
      <div class="str-recording-guide" aria-label="Walkthrough guidance">
        <span>1 · Frame it</span><span>2 · Show it</span><span>3 · Land it</span>
      </div>
      <div class="str-recording-shortcuts" aria-label="Annotation shortcuts">${recordingHudShortcutMarkup()}</div>
      <button class="str-finish-recording" type="button">Finish recording</button>
    </div>`;
  root.append(hud);

  for (const eventName of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) {
    hud.addEventListener(eventName, (event) => event.stopPropagation());
  }

  const summary = hud.querySelector<HTMLButtonElement>(".str-recording-hud-summary");
  summary?.addEventListener("click", () => {
    const open = hud.classList.toggle("is-open");
    summary.setAttribute("aria-expanded", String(open));
  });
  hud.querySelector<HTMLButtonElement>(".str-finish-recording")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "Finishing…";
    try {
      await chrome.runtime.sendMessage({ type: "CONTENT_STOP_CAPTURE" } satisfies RuntimeMessage);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Try finishing again";
      button.title = error instanceof Error ? error.message : String(error);
    }
  });
  updateRecordingTimer();
  recordingTimer = window.setInterval(updateRecordingTimer, 1_000);
}

function updateRecordingTimer(): void {
  const timer = root?.querySelector<HTMLTimeElement>(".str-recording-time");
  if (timer) timer.textContent = formatRecordingElapsed(recordingStartedAt);
}

function stopRecordingTimer(): void {
  if (recordingTimer) window.clearInterval(recordingTimer);
  recordingTimer = undefined;
}

function isOverlayUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("[data-recording-hud]"));
}

function setCursorPressed(pressed: boolean): void {
  cursor?.classList.toggle("is-pressing", pressed);
}

function animateCursorClick(): void {
  if (!cursor) return;
  setCursorPressed(false);
  if (cursorClickTimeout) window.clearTimeout(cursorClickTimeout);
  cursor.classList.remove("is-clicking");
  void cursor.offsetWidth;
  cursor.classList.add("is-clicking");
  cursorClickTimeout = window.setTimeout(() => cursor?.classList.remove("is-clicking"), 430);
}

function clearAnnotations(): void {
  root?.querySelectorAll(".str-draft, .str-box").forEach((element) => element.remove());
  startPoint = undefined;
  draftRect = undefined;
  interactionMode = undefined;
  heldMode = undefined;
  suppressNextClick = false;
  updateOverlayState();
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
