export interface RecordingHudShortcut {
  key: "B" | "R" | "C";
  label: string;
  detail: string;
}

export const recordingHudShortcuts: RecordingHudShortcut[] = [
  { key: "B", label: "Highlight", detail: "Hold and drag a box" },
  { key: "R", label: "Redact", detail: "Hold and drag" },
  { key: "C", label: "Clear", detail: "Remove every mark" }
];

export function formatRecordingElapsed(startedAt: number | undefined, now = Date.now()): string {
  const elapsedSeconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1_000)) : 0;
  const hours = Math.floor(elapsedSeconds / 3_600);
  const minutes = Math.floor((elapsedSeconds % 3_600) / 60);
  const seconds = elapsedSeconds % 60;
  const shortTime = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours ? `${String(hours).padStart(2, "0")}:${shortTime}` : shortTime;
}

export function recordingHudShortcutMarkup(): string {
  return recordingHudShortcuts.map((shortcut) => `
    <div class="str-recording-shortcut">
      <kbd>${shortcut.key}</kbd>
      <span><strong>${shortcut.label}</strong><small>${shortcut.detail}</small></span>
    </div>`).join("");
}
