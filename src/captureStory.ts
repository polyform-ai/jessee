import type { CaptureAnalysis, CaptureStoryStep, ScreenshotEvidence, TimelineEvent, TranscriptionResult } from "./types";

type StoryTimelineEvent = Pick<TimelineEvent, "type" | "atMs" | "url" | "title">;

export function splitTranscriptIntoSentences(
  segments: TranscriptionResult["segments"]
): TranscriptionResult["segments"] {
  return segments.flatMap((segment) => {
    const sentences = segment.text
      .match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? [];
    if (sentences.length <= 1) return [{ ...segment, text: segment.text.trim() }];

    const totalCharacters = sentences.reduce((total, sentence) => total + sentence.length, 0);
    const duration = Math.max(0, segment.end - segment.start);
    let consumedCharacters = 0;
    return sentences.map((sentence, index) => {
      const start = segment.start + duration * (consumedCharacters / totalCharacters);
      consumedCharacters += sentence.length;
      const end = index === sentences.length - 1
        ? segment.end
        : segment.start + duration * (consumedCharacters / totalCharacters);
      return { start: roundTimestamp(start), end: roundTimestamp(end), text: sentence };
    });
  }).filter((segment) => segment.text.length > 0);
}

export function buildCaptureStory(
  analysis: CaptureAnalysis,
  transcript: TranscriptionResult | undefined,
  timeline: StoryTimelineEvent[],
  screenshots: Array<Pick<ScreenshotEvidence, "id" | "capturedAtMs" | "url" | "title">>
): CaptureStoryStep[] {
  const segments = splitTranscriptIntoSentences(transcript?.segments ?? []);
  const modelSteps = analysis.storySteps?.length
    ? analysis.storySteps.map(normalizeStep)
    : analysis.helpfulImageMoments.map((moment) => normalizeStep({
        startSeconds: moment.atSeconds,
        endSeconds: moment.atSeconds,
        title: "Visual evidence",
        narrative: moment.reason,
        transcript: "",
        screenshotId: moment.screenshotId,
        kind: "action"
      }));
  const claimedModelSteps = new Set<number>();

  const narrationSteps = segments.map((segment) => {
    const modelIndex = closestUnclaimedStep(modelSteps, claimedModelSteps, segment.start, segment.end);
    const modelStep = modelIndex >= 0 ? modelSteps[modelIndex] : undefined;
    if (modelIndex >= 0) claimedModelSteps.add(modelIndex);
    const screenshot = screenshotAtOrAfter(screenshots, segment.end, modelStep?.pageUrl);
    return normalizeStep({
      ...modelStep,
      startSeconds: segment.start,
      endSeconds: segment.end,
      title: modelStep?.title || "What the user explained",
      narrative: modelStep?.narrative || segment.text,
      transcript: segment.text,
      screenshotId: modelStep?.screenshotId || screenshot?.id,
      pageUrl: modelStep?.pageUrl || screenshot?.url,
      pageTitle: modelStep?.pageTitle || screenshot?.title,
      kind: modelStep?.kind || "narration"
    });
  });

  const unclaimedSteps = modelSteps.filter((_, index) => !claimedModelSteps.has(index));
  const story = [...narrationSteps, ...unclaimedSteps];
  for (const event of timeline.filter((item) => item.type === "url-change")) {
    const eventSeconds = event.atMs / 1000;
    const alreadyRepresented = story.some((step) =>
      step.kind === "page-change"
      && Math.abs(step.startSeconds - eventSeconds) <= 2
      && (!step.pageUrl || step.pageUrl === event.url)
    );
    if (alreadyRepresented) continue;
    const screenshot = screenshotAtOrAfter(screenshots, eventSeconds, event.url);
    story.push(normalizeStep({
      startSeconds: eventSeconds,
      endSeconds: eventSeconds,
      title: event.title ? `Opened ${event.title}` : "Page changed",
      narrative: event.url ? `The walkthrough moved to ${event.url}.` : "The walkthrough moved to a new page.",
      transcript: "",
      screenshotId: screenshot?.id,
      pageUrl: event.url,
      pageTitle: event.title,
      kind: "page-change"
    }));
  }

  return story.sort((a, b) => a.startSeconds - b.startSeconds || storyKindOrder(a.kind) - storyKindOrder(b.kind));
}

function closestUnclaimedStep(
  steps: CaptureStoryStep[],
  claimed: Set<number>,
  start: number,
  end: number
): number {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  steps.forEach((step, index) => {
    if (claimed.has(index) || step.kind === "manual") return;
    const overlaps = step.startSeconds <= end && step.endSeconds >= start;
    const distance = overlaps ? 0 : Math.min(Math.abs(step.startSeconds - end), Math.abs(step.endSeconds - start));
    if (distance < bestDistance && distance <= 3) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function screenshotAtOrAfter(
  screenshots: Array<Pick<ScreenshotEvidence, "id" | "capturedAtMs" | "url" | "title">>,
  atSeconds: number,
  preferredUrl?: string
): Pick<ScreenshotEvidence, "id" | "capturedAtMs" | "url" | "title"> | undefined {
  const ordered = [...screenshots].sort((a, b) => a.capturedAtMs - b.capturedAtMs);
  const targetMs = atSeconds * 1000;
  return ordered.find((shot) => shot.capturedAtMs >= targetMs && (!preferredUrl || shot.url === preferredUrl))
    ?? ordered.find((shot) => shot.capturedAtMs >= targetMs)
    ?? ordered.at(-1);
}

function normalizeStep(step: Partial<CaptureStoryStep>): CaptureStoryStep {
  const startSeconds = finiteNumber(step.startSeconds);
  return {
    startSeconds,
    endSeconds: Math.max(startSeconds, finiteNumber(step.endSeconds, startSeconds)),
    title: step.title?.trim() || "Story step",
    narrative: step.narrative?.trim() || "",
    transcript: step.transcript?.trim() || "",
    screenshotId: step.screenshotId,
    pageUrl: step.pageUrl,
    pageTitle: step.pageTitle,
    kind: step.kind === "page-change" || step.kind === "action" || step.kind === "manual" ? step.kind : "narration"
  };
}

function finiteNumber(value: number | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundTimestamp(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function storyKindOrder(kind: CaptureStoryStep["kind"]): number {
  return kind === "page-change" ? 0 : 1;
}
