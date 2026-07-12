import type { RecordingSession } from "./types";

export function acceptsContentEvent(session: RecordingSession, tabId: number | undefined): boolean {
  return session.status === "recording" && tabId !== undefined && session.activeTabId === tabId;
}
