import type { RecordingSession } from "./types";

export function acceptsContentEvent(session: RecordingSession, tabId: number | undefined): boolean {
  return session.status === "recording" && tabId !== undefined && session.activeTabId === tabId;
}

export function ownsActiveCapture(
  session: RecordingSession,
  localCaptureId: string | undefined,
  recorderState: RecordingState | undefined
): boolean {
  return Boolean(
    localCaptureId
    && session.captureId === localCaptureId
    && (session.status === "recording" || session.status === "paused")
    && recorderState
    && recorderState !== "inactive"
  );
}

export function shouldRecordPageChange(
  session: RecordingSession,
  tabUrl: string | undefined,
  changedUrl: string | undefined,
  status: string | undefined
): boolean {
  if (changedUrl) return true;
  if (status !== "complete") return false;
  const nowMs = session.startedAt ? Date.now() - session.startedAt : 0;
  const lastPageChange = [...session.timeline].reverse().find((event) => event.type === "url-change");
  return !lastPageChange || lastPageChange.url !== (tabUrl ?? "") || nowMs - lastPageChange.atMs > 2_000;
}
