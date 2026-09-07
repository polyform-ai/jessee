import { dataUrlToBlob } from "./dataUrl";
import { buildCaptureStory, splitTranscriptIntoSentences } from "./captureStory";
import type { CaptureAnalysis, CaptureStoryStep, OpenAiUsage, RecordingSession, ScreenshotEvidence, TimelineEvent, TranscriptionResult } from "./types";

interface ResponsesOutputText {
  type: "output_text";
  text: string;
}

interface ResponsesMessageContent {
  type: string;
  text?: string;
}

interface ResponsesOutput {
  type: string;
  content?: ResponsesMessageContent[] | ResponsesOutputText[];
}

interface ResponsesPayload {
  output_text?: string;
  output?: ResponsesOutput[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize";
const PLAN_MODEL = "gpt-5.6-sol";
const MAX_PLANNING_SCREENSHOTS = 20;
const ESTIMATED_INPUT_COST_PER_1M = 5;
const ESTIMATED_OUTPUT_COST_PER_1M = 30;

export const REQUIRED_OPENAI_MODELS = [PLAN_MODEL, TRANSCRIPTION_MODEL] as const;

export async function transcribeAudio(apiKey: string, audioDataUrl?: string): Promise<TranscriptionResult> {
  if (!audioDataUrl) return { text: "", segments: [] };
  if (!audioDataUrl.startsWith("data:")) return { text: "", segments: [] };

  const blob = await dataUrlToBlob(audioDataUrl);
  if (blob.size === 0) return { text: "", segments: [] };

  const formData = new FormData();
  formData.append("model", TRANSCRIPTION_MODEL);
  formData.append("file", blob, transcriptionFilename(blob.type));
  formData.append("response_format", "diarized_json");
  formData.append("chunking_strategy", "auto");

  const response = await openAiFetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Transcription failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    text?: string;
    segments?: Array<{ start?: number; end?: number; text?: string }>;
  };
  return {
    text: payload.text ?? "",
    segments: splitTranscriptIntoSentences((payload.segments ?? []).map((segment) => ({
      start: segment.start ?? 0,
      end: segment.end ?? 0,
      text: segment.text ?? ""
    })))
  };
}

export function transcriptionFilename(mimeType: string): string {
  if (/mp4|m4a/i.test(mimeType)) return "recording.m4a";
  if (/mpeg|mp3/i.test(mimeType)) return "recording.mp3";
  if (/wav/i.test(mimeType)) return "recording.wav";
  return "recording.webm";
}

/**
 * Checks model access before a user spends time recording. This deliberately
 * does not fall back to an older model: JesSee's planning contract is Sol.
 */
export async function testOpenAiSetup(apiKey: string): Promise<void> {
  for (const model of REQUIRED_OPENAI_MODELS) {
    const response = await openAiFetch(`${OPENAI_BASE_URL}/models/${model}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      throw new Error(`OpenAI setup failed for ${model}: ${response.status} ${await response.text()}`);
    }
  }
}

export async function analyzeCapture(
  apiKey: string,
  transcript: TranscriptionResult,
  session: RecordingSession,
  privateMode = false
): Promise<{ analysis: CaptureAnalysis; usage: OpenAiUsage }> {
  const timeline = session.timeline.map((event) => ({
        ...event,
        atSeconds: Math.round(event.atMs / 100) / 10,
      }));
  const evidenceFrames = session.screenshots.map((shot) => ({
        id: shot.id,
        capturedAtMs: shot.capturedAtMs,
        capturedAtSeconds: Math.round(shot.capturedAtMs / 100) / 10,
        url: shot.url,
        title: shot.title,
        annotations: shot.annotations,
        redactions: shot.redactions
      }));
  const planningScreenshots = selectPlanningScreenshots(session);
  const alignedTranscriptSegments = transcript.segments.map((segment) => ({
    ...segment,
    selectionAtSeconds: segment.end,
    screenshotAtSentenceEnd: screenshotAtOrAfter(evidenceFrames, segment.end)
  }));
  const instructions = [
    "You turn a narrated screen capture into a clear visual story plan. The reviewed plan will be rendered directly as the PDF, with no later AI formatting pass.",
    "Start with the transcript and timestamped timeline. Identify what the user is trying to communicate before looking for screenshots.",
    "Return only valid JSON. Do not wrap it in code fences.",
    "The JSON schema is: userGoal:string, keyPoints:string[], story:string, storySteps:{startSeconds:number,endSeconds:number,title:string,narrative:string,transcript:string,screenshotId?:string,pageUrl?:string,pageTitle?:string,kind:'narration'|'page-change'|'action'}[].",
    "userGoal should capture the user's intended outcome.",
    "keyPoints should preserve every important claim, request, problem, expectation, and decision made by the user. Prefer detail over compression.",
    "story should be a concise but complete summary of what the user is trying to communicate.",
    "storySteps are the detailed chronological plan. Create a step for every meaningful transcript sentence, action, page change, annotation, redaction, error, and visible state transition unless it is truly redundant.",
    "Each story step must explain what is happening in narrative, preserve the exact relevant transcript sentence in transcript, and select the screenshot that best illustrates the resulting state.",
    "Every URL change in the timeline must appear as a page-change story step with pageUrl and pageTitle. Page changes are part of the story, not incidental metadata.",
    "Transcript timestamps mark when a sentence starts and ends. For screenshot selection, use selectionAtSeconds and screenshotAtSentenceEnd so the chosen image reflects the completed sentence and resulting UI state, not the beginning of the narration.",
    "Prefer the first screenshot at or after a sentence ends. Use the closest prior screenshot only when no later screenshot exists. Return the exact screenshotId from evidenceFrames whenever possible.",
    "The attached images are only representative transition frames, not the full screenshot set. Use all evidenceFrames timestamps, URLs, titles, and IDs to choose an earlier or later screenshot when that ID better illustrates the point.",
    privateMode
      ? "Private Mode is enabled. No screenshot pixels are provided. Use only transcript, timeline metadata, annotations, timestamps, and screenshot IDs; never claim to have visually inspected a frame."
      : "Representative transition screenshot pixels follow the JSON. Use them to understand the visual changes, while choosing the most appropriate exact screenshotId from the complete evidenceFrames list."
  ].join("\n");

  const response = await openAiFetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: PLAN_MODEL,
      reasoning: { effort: "medium" },
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: instructions }]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(
                {
                  transcriptText: transcript.text,
                  transcriptSegments: alignedTranscriptSegments,
                  timeline,
                  evidenceFrames,
                  shownTransitionScreenshotIds: privateMode ? [] : planningScreenshots.map((shot) => shot.id)
                },
                null,
                2
              )
            },
            ...(privateMode ? [] : planningScreenshots.flatMap((shot) => [
              { type: "input_text", text: `Transition screenshot ${shot.id} at ${Math.round(shot.capturedAtMs / 100) / 10}s · ${shot.title || shot.url}` },
              { type: "input_image", image_url: shot.dataUrl, detail: "high" }
            ]))
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Capture analysis failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as ResponsesPayload;
  return {
    analysis: alignAnalysisToSentenceEnds(parseCaptureAnalysis(extractOutputText(payload)), transcript, evidenceFrames, timeline),
    usage: usageFromPayload(payload)
  };
}

function parseCaptureAnalysis(text: string): CaptureAnalysis {
  const parsed = JSON.parse(stripCodeFence(text)) as Partial<CaptureAnalysis>;
  return {
    userGoal: parsed.userGoal || "",
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter((point): point is string => typeof point === "string") : [],
    bestDelivery: parsed.bestDelivery || "",
    breakingPoints: Array.isArray(parsed.breakingPoints) ? parsed.breakingPoints : [],
    helpfulImageMoments: Array.isArray(parsed.helpfulImageMoments)
      ? parsed.helpfulImageMoments.map((moment) => ({
          screenshotId: typeof moment.screenshotId === "string" ? moment.screenshotId : undefined,
          atSeconds: typeof moment.atSeconds === "number" ? moment.atSeconds : 0,
          reason: typeof moment.reason === "string" ? moment.reason : ""
        }))
      : [],
    story: parsed.story || "",
    storySteps: Array.isArray(parsed.storySteps)
      ? parsed.storySteps.map(parseStoryStep)
      : []
  };
}

function parseStoryStep(step: Partial<CaptureStoryStep>): CaptureStoryStep {
  const startSeconds = typeof step.startSeconds === "number" ? step.startSeconds : 0;
  return {
    startSeconds,
    endSeconds: typeof step.endSeconds === "number" ? step.endSeconds : startSeconds,
    title: typeof step.title === "string" ? step.title : "Story step",
    narrative: typeof step.narrative === "string" ? step.narrative : "",
    transcript: typeof step.transcript === "string" ? step.transcript : "",
    screenshotId: typeof step.screenshotId === "string" ? step.screenshotId : undefined,
    pageUrl: typeof step.pageUrl === "string" ? step.pageUrl : undefined,
    pageTitle: typeof step.pageTitle === "string" ? step.pageTitle : undefined,
    kind: step.kind === "page-change" || step.kind === "action" ? step.kind : "narration"
  };
}

export function selectPlanningScreenshots(session: RecordingSession): ScreenshotEvidence[] {
  const imageScreenshots = session.screenshots.filter((shot) => shot.dataUrl.startsWith("data:image/"));
  const selected: ScreenshotEvidence[] = [];
  const addUnique = (shot?: ScreenshotEvidence) => {
    if (shot && !selected.some((existing) => existing.id === shot.id)) selected.push(shot);
  };

  addUnique(imageScreenshots[0]);
  addUnique(imageScreenshots.at(-1));
  for (const event of session.timeline) {
    if (!(["url-change", "annotation", "redaction", "click"] as string[]).includes(event.type)) continue;
    addUnique(imageScreenshots.find((shot) => shot.capturedAtMs >= event.atMs));
  }
  imageScreenshots.forEach((shot, index) => {
    const previous = imageScreenshots[index - 1];
    if (!previous || shot.url !== previous.url || shot.annotations.length > 0 || shot.redactions.length > 0) addUnique(shot);
  });
  if (selected.length > MAX_PLANNING_SCREENSHOTS) {
    return selectEvenlySpaced(selected.sort((a, b) => a.capturedAtMs - b.capturedAtMs), MAX_PLANNING_SCREENSHOTS);
  }
  for (const representative of selectEvenlySpaced(imageScreenshots, MAX_PLANNING_SCREENSHOTS)) {
    if (selected.length >= MAX_PLANNING_SCREENSHOTS) break;
    addUnique(representative);
  }
  for (const screenshot of imageScreenshots) {
    if (selected.length >= MAX_PLANNING_SCREENSHOTS) break;
    addUnique(screenshot);
  }
  return selected.sort((a, b) => a.capturedAtMs - b.capturedAtMs);
}

export function alignAnalysisToSentenceEnds(
  analysis: CaptureAnalysis,
  transcript: TranscriptionResult,
  frames: unknown[],
  timeline: TimelineEvent[] = []
): CaptureAnalysis {
  const screenshots = frames.filter((frame): frame is Pick<ScreenshotEvidence, "id" | "capturedAtMs" | "url" | "title"> => {
    if (!frame || typeof frame !== "object") return false;
    const candidate = frame as Partial<ScreenshotEvidence>;
    return typeof candidate.id === "string" && typeof candidate.capturedAtMs === "number";
  });
  const storySteps = buildCaptureStory(analysis, transcript, timeline, screenshots);
  return {
    ...analysis,
    storySteps,
    helpfulImageMoments: analysis.helpfulImageMoments.map((moment) => {
      const segment = closestTranscriptSegment(transcript, moment.atSeconds);
      if (!segment) return moment;
      const frame = screenshotAtOrAfter(frames, segment.end);
      return {
        ...moment,
        atSeconds: segment.end,
        screenshotId: frame?.id ?? moment.screenshotId
      };
    }).concat(
      storySteps
        .filter((step) => step.screenshotId && !analysis.helpfulImageMoments.some((moment) => moment.screenshotId === step.screenshotId))
        .map((step) => ({ screenshotId: step.screenshotId, atSeconds: step.endSeconds, reason: step.narrative || step.title }))
    )
  };
}

function closestTranscriptSegment(transcript: TranscriptionResult, atSeconds: number): TranscriptionResult["segments"][number] | undefined {
  return [...transcript.segments].sort((a, b) => {
    const distanceA = atSeconds >= a.start && atSeconds <= a.end ? 0 : Math.abs(a.start - atSeconds);
    const distanceB = atSeconds >= b.start && atSeconds <= b.end ? 0 : Math.abs(b.start - atSeconds);
    return distanceA - distanceB;
  })[0];
}

function screenshotAtOrAfter(frames: unknown[], atSeconds: number): { id: string; capturedAtMs: number } | undefined {
  const screenshots = frames
    .filter((frame): frame is { id: string; capturedAtMs: number } => {
      if (!frame || typeof frame !== "object") return false;
      const candidate = frame as { id?: unknown; capturedAtMs?: unknown };
      return typeof candidate.id === "string" && typeof candidate.capturedAtMs === "number";
    })
    .sort((a, b) => a.capturedAtMs - b.capturedAtMs);
  const targetMs = atSeconds * 1000;
  return screenshots.find((shot) => shot.capturedAtMs >= targetMs) ?? screenshots.at(-1);
}

function selectEvenlySpaced(screenshots: ScreenshotEvidence[], limit: number): ScreenshotEvidence[] {
  if (screenshots.length <= limit) return screenshots;
  return Array.from({ length: limit }, (_, index) => {
    const position = Math.round((index * (screenshots.length - 1)) / (limit - 1));
    return screenshots[position];
  });
}

function extractOutputText(payload: ResponsesPayload): string {
  if (payload.output_text) return payload.output_text;
  const parts: string[] = [];
  for (const output of payload.output ?? []) {
    for (const item of output.content ?? []) {
      if ("text" in item && typeof item.text === "string") parts.push(item.text);
    }
  }
  return parts.join("\n").trim();
}

function stripCodeFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function usageFromPayload(payload: ResponsesPayload): OpenAiUsage {
  const inputTokens = payload.usage?.input_tokens ?? 0;
  const outputTokens = payload.usage?.output_tokens ?? 0;
  const totalTokens = payload.usage?.total_tokens ?? inputTokens + outputTokens;
  const estimatedCostUsd = (inputTokens / 1_000_000) * ESTIMATED_INPUT_COST_PER_1M + (outputTokens / 1_000_000) * ESTIMATED_OUTPUT_COST_PER_1M;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000
  };
}

async function openAiFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach OpenAI API. Check network access and extension permissions. ${message}`);
  }
}
