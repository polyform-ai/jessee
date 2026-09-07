import type { CaptureStoryStep, ScreenshotEvidence } from "./types";

export interface ScreenshotCandidate {
  shot: ScreenshotEvidence;
  index: number;
  score: number;
  reason: string;
}

export function rankScreenshotsForStep(
  step: CaptureStoryStep,
  screenshots: ScreenshotEvidence[],
  limit = 8
): ScreenshotCandidate[] {
  if (screenshots.length === 0 || limit <= 0) return [];
  const targetMs = step.endSeconds * 1000;
  const ranked = screenshots.map((shot, index) => {
    const distanceMs = Math.abs(shot.capturedAtMs - targetMs);
    const samePage = Boolean(step.pageUrl && shot.url === step.pageUrl);
    const afterStep = shot.capturedAtMs >= targetMs;
    const marked = (shot.annotations?.length ?? 0) > 0 || (shot.redactions?.length ?? 0) > 0;
    const score = proximityScore(distanceMs)
      + (samePage ? 48 : 0)
      + (afterStep && distanceMs <= 3_000 ? 10 : 0)
      + (marked ? 12 : 0);
    return {
      shot,
      index,
      score,
      reason: candidateReason(distanceMs, afterStep, samePage, marked)
    };
  }).sort((a, b) => b.score - a.score || a.shot.capturedAtMs - b.shot.capturedAtMs);

  const shortlist = ranked.slice(0, Math.min(limit, ranked.length));
  const selected = ranked.find((candidate) => candidate.shot.id === step.screenshotId);
  if (selected && !shortlist.some((candidate) => candidate.shot.id === selected.shot.id)) {
    shortlist[shortlist.length - 1] = selected;
  }
  return shortlist;
}

export function screenshotTimingLabel(shot: ScreenshotEvidence, step: CaptureStoryStep): string {
  const deltaMs = shot.capturedAtMs - step.endSeconds * 1000;
  const seconds = Math.abs(deltaMs) / 1000;
  const formatted = seconds < 1 ? `${Math.round(seconds * 10) / 10}s` : `${Math.round(seconds)}s`;
  if (Math.abs(deltaMs) < 250) return "At this moment";
  return `${formatted} ${deltaMs > 0 ? "after" : "before"}`;
}

function proximityScore(distanceMs: number): number {
  if (distanceMs <= 750) return 70;
  if (distanceMs <= 2_000) return 52;
  if (distanceMs <= 5_000) return 30;
  if (distanceMs <= 10_000) return 12;
  return 0;
}

function candidateReason(distanceMs: number, afterStep: boolean, samePage: boolean, marked: boolean): string {
  const reasons: string[] = [];
  if (distanceMs <= 2_000) reasons.push(afterStep ? "Resulting state" : "Nearby moment");
  else if (distanceMs <= 5_000) reasons.push("Close in time");
  if (samePage) reasons.push("Same page");
  if (marked) reasons.push("Includes markup");
  return reasons.join(" · ") || "Nearby capture";
}
