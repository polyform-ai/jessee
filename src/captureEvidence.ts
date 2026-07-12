import type { Rect, TimelineEvent } from "./types";

export function visiblePageRects(timeline: TimelineEvent[], type: "annotation" | "redaction"): Rect[] {
  const lastPageChange = timeline.map((event) => event.type).lastIndexOf("url-change");
  return timeline
    .slice(lastPageChange + 1)
    .filter((event) => event.type === type && event.rect)
    .map((event) => event.rect!);
}
