import type { RecordingSession, Rect, TimelineEvent } from "./types";

export function visiblePageRects(timeline: TimelineEvent[], type: "annotation" | "redaction"): Rect[] {
  const lastPageChange = timeline.map((event) => event.type).lastIndexOf("url-change");
  return timeline
    .slice(lastPageChange + 1)
    .filter((event) => event.type === type && event.rect)
    .map((event) => event.rect!);
}

export function clearAnnotationEvidence(session: RecordingSession): {
  session: RecordingSession;
  removedArtifactRefs: string[];
} {
  const markedScreenshots = session.screenshots.filter(
    (screenshot) => screenshot.annotations.length > 0 || screenshot.redactions.length > 0
  );
  const markedScreenshotIds = new Set(markedScreenshots.map((screenshot) => screenshot.id));
  return {
    session: {
      ...session,
      screenshots: session.screenshots.filter((screenshot) => !markedScreenshotIds.has(screenshot.id)),
      timeline: session.timeline.filter((event) =>
        event.type !== "annotation"
        && event.type !== "redaction"
        && !(event.type === "screenshot" && event.screenshotId && markedScreenshotIds.has(event.screenshotId))
      )
    },
    removedArtifactRefs: markedScreenshots.map((screenshot) => screenshot.dataUrl)
  };
}
