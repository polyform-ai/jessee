import type { RecordingSession } from "./types";

export const FRESH_CAPTURE_AFTER_MS = 4 * 60 * 60 * 1000;

export function shouldStartWithFreshCapture(session: RecordingSession, now = Date.now()): boolean {
  if (session.status === "recording" || session.status === "planning" || session.status === "generating") return false;
  const lastActivityAt = session.stoppedAt ?? session.startedAt;
  return Boolean(lastActivityAt && now - lastActivityAt >= FRESH_CAPTURE_AFTER_MS);
}
