import { dataUrlToBlob } from "./dataUrl";
import type { CaptureAnalysis, OpenAiUsage, RecordingSession, ScreenshotEvidence, TicketDraft, TicketTemplate, TranscriptionResult } from "./types";

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
const TICKET_MODEL = "gpt-5.6-terra";
const MAX_DRAFT_SCREENSHOTS = 30;
const ESTIMATED_INPUT_COST_PER_1M = 2.5;
const ESTIMATED_OUTPUT_COST_PER_1M = 15;

export const REQUIRED_OPENAI_MODELS = [TICKET_MODEL, TRANSCRIPTION_MODEL] as const;

export async function transcribeAudio(apiKey: string, audioDataUrl?: string): Promise<TranscriptionResult> {
  if (!audioDataUrl) return { text: "", segments: [] };
  if (!audioDataUrl.startsWith("data:")) return { text: "", segments: [] };

  const blob = await dataUrlToBlob(audioDataUrl);
  if (blob.size === 0) return { text: "", segments: [] };

  const formData = new FormData();
  formData.append("model", TRANSCRIPTION_MODEL);
  formData.append("file", blob, "recording.webm");
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
    segments: (payload.segments ?? []).map((segment) => ({
      start: segment.start ?? 0,
      end: segment.end ?? 0,
      text: segment.text ?? ""
    }))
  };
}

/**
 * Checks model access before a user spends time recording. This deliberately
 * does not fall back to an older model: JesSee's output contract is Terra.
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

export interface GenerateTicketResult {
  ticket: TicketDraft;
  usage: OpenAiUsage;
  analysis: CaptureAnalysis;
}

export async function generateTicket(
  apiKey: string,
  session: RecordingSession,
  transcript: TranscriptionResult,
  template: TicketTemplate,
  preparedAnalysis?: CaptureAnalysis,
  privateMode = false
): Promise<GenerateTicketResult> {
  const timeline = session.timeline.map((event) => ({
    type: event.type,
    atMs: event.atMs,
    atSeconds: Math.round(event.atMs / 100) / 10,
    url: event.url,
    title: event.title,
    note: event.note,
    screenshotId: event.screenshotId,
    rect: event.rect,
    point: event.point
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

  const analysisResult = preparedAnalysis
    ? { analysis: preparedAnalysis, usage: emptyUsage() }
    : await analyzeCapture(apiKey, transcript, template, timeline, evidenceFrames);
  const selectedScreenshots = selectScreenshotsForAnalysis(session.screenshots, analysisResult.analysis);
  const screenshotContent = privateMode ? [] : selectedScreenshots
    .map((shot) => ({
      type: "input_image",
      image_url: shot.dataUrl,
      detail: "high"
    }));

  const instructions = [
    "You turn screen captures, narration, URLs, steps, and screenshots into structured documents that AI and humans can understand.",
    "Return only valid JSON. Do not wrap it in code fences.",
    "The JSON schema is: title:string, templateName:string, summary:string, environment:string[], reproductionSteps:string[], expectedBehavior:string, actualBehavior:string, evidence:{screenshotId?:string, caption:string}[], openQuestions:string[].",
    `Use this template: ${template.name}.`,
    `Template instructions: ${template.instructions}`,
    "Use the captureAnalysis as the plan for the document. It was prepared from the transcript, timeline, and screenshot timestamps before image review.",
    "The response should follow the selected template, be detailed, Codex-ready, and grounded in the capture.",
    "Prefer completeness over brevity. Preserve every supported action, state transition, decision, problem, expectation, and relevant piece of narration. Reproduction steps should be atomic and chronological, and evidence captions should explain what each image proves.",
    "Use as many of the selected screenshots as needed to make the document independently understandable. Avoid omitting useful evidence merely to keep the document short.",
    "Screenshots, clicks, annotations, redactions, and URL changes are timestamped in seconds from capture start. Use clicks and page changes as interaction anchors: choose screenshots immediately before or after those events when they prove a reproduction step or state transition. When transcript segments are available, their start is when the sentence began and their end is the better representation of the resulting screen state.",
    privateMode
      ? "Evidence screenshotId values must come from selectedScreenshotIds only. Screenshot pixels are not available in Private Mode; use the transcript, timestamps, selected screenshot IDs, annotations, and timeline context to place local PDF evidence without inventing visual details."
      : "Evidence screenshotId values must come from selectedScreenshotIds only. Do not invent facts not present in the analysis, transcript, screenshots, or timeline."
  ].join("\n");

  const response = await openAiFetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: TICKET_MODEL,
      reasoning: { effort: "high" },
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
                  transcriptSegments: transcript.segments.map((segment) => ({
                    ...segment,
                    selectionAtSeconds: segment.end
                  })),
                  selectedTemplate: {
                    id: template.id,
                    name: template.name,
                    instructions: template.instructions
                  },
                  captureAnalysis: analysisResult.analysis,
                  selectedScreenshotIds: selectedScreenshots.map((shot) => shot.id),
                  timeline,
                  evidenceFrames
                },
                null,
                2
              )
            },
            ...screenshotContent
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Ticket generation failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as ResponsesPayload;
  const text = extractOutputText(payload);
  return {
    ticket: parseTicket(text),
    usage: combineUsage(analysisResult.usage, usageFromPayload(payload)),
    analysis: analysisResult.analysis
  };
}

export async function analyzeCapture(
  apiKey: string,
  transcript: TranscriptionResult,
  template: TicketTemplate,
  sessionOrTimeline: RecordingSession | unknown[],
  frames?: unknown[]
): Promise<{ analysis: CaptureAnalysis; usage: OpenAiUsage }> {
  const timeline = Array.isArray(sessionOrTimeline)
    ? sessionOrTimeline
    : sessionOrTimeline.timeline.map((event) => ({
        type: event.type,
        atMs: event.atMs,
        atSeconds: Math.round(event.atMs / 100) / 10,
        url: event.url,
        title: event.title,
        note: event.note,
        screenshotId: event.screenshotId,
        rect: event.rect,
        point: event.point
      }));
  const evidenceFrames = frames ?? (Array.isArray(sessionOrTimeline)
    ? []
    : sessionOrTimeline.screenshots.map((shot) => ({
        id: shot.id,
        capturedAtMs: shot.capturedAtMs,
        capturedAtSeconds: Math.round(shot.capturedAtMs / 100) / 10,
        url: shot.url,
        title: shot.title,
        annotations: shot.annotations,
        redactions: shot.redactions
      })));
  const alignedTranscriptSegments = transcript.segments.map((segment) => ({
    ...segment,
    selectionAtSeconds: segment.end,
    screenshotAtSentenceEnd: screenshotAtOrAfter(evidenceFrames, segment.end)
  }));
  const instructions = [
    "You prepare screen captures before final document generation.",
    "Start with the transcript and timestamped timeline. Identify what the user is trying to communicate before looking for screenshots.",
    "Return only valid JSON. Do not wrap it in code fences.",
    "The JSON schema is: userGoal:string, bestDelivery:string, breakingPoints:string[], helpfulImageMoments:{screenshotId?:string, atSeconds:number, reason:string}[], story:string.",
    "userGoal should capture the user's intended outcome.",
    "bestDelivery should provide a detailed outline of the best document shape for that goal and the selected template.",
    "breakingPoints should comprehensively list every moment where the workflow changed, failed, became confusing, introduced important context, or established a decision or expected result.",
    "helpfulImageMoments should be generous and detailed. Add evidence for every meaningful spoken segment, action, page change, annotation, redaction, error, and visible state transition unless the frame is truly redundant.",
    "Transcript timestamps mark when a segment starts. For screenshot selection, use selectionAtSeconds and screenshotAtSentenceEnd so the chosen image reflects the completed sentence and resulting UI state, not the beginning of the narration.",
    "Prefer the first screenshot at or after a segment ends. Use the closest prior screenshot only when no later screenshot exists. Return the exact screenshotId from evidenceFrames whenever possible.",
    "story should be a detailed chronological walkthrough that preserves the full narrative from the audio rather than a short summary.",
    `Selected template: ${template.name}.`,
    `Template instructions: ${template.instructions}`
  ].join("\n");

  const response = await openAiFetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: TICKET_MODEL,
      reasoning: { effort: "high" },
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
                  evidenceFrames
                },
                null,
                2
              )
            }
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
    analysis: alignAnalysisToSentenceEnds(parseCaptureAnalysis(extractOutputText(payload)), transcript, evidenceFrames),
    usage: usageFromPayload(payload)
  };
}

function parseCaptureAnalysis(text: string): CaptureAnalysis {
  const parsed = JSON.parse(stripCodeFence(text)) as Partial<CaptureAnalysis>;
  return {
    userGoal: parsed.userGoal || "",
    bestDelivery: parsed.bestDelivery || "",
    breakingPoints: Array.isArray(parsed.breakingPoints) ? parsed.breakingPoints : [],
    helpfulImageMoments: Array.isArray(parsed.helpfulImageMoments)
      ? parsed.helpfulImageMoments.map((moment) => ({
          screenshotId: typeof moment.screenshotId === "string" ? moment.screenshotId : undefined,
          atSeconds: typeof moment.atSeconds === "number" ? moment.atSeconds : 0,
          reason: typeof moment.reason === "string" ? moment.reason : ""
        }))
      : [],
    story: parsed.story || ""
  };
}

export function selectScreenshotsForAnalysis(screenshots: ScreenshotEvidence[], analysis: CaptureAnalysis): ScreenshotEvidence[] {
  const imageScreenshots = screenshots.filter((shot) => shot.dataUrl.startsWith("data:image/"));
  const selected: ScreenshotEvidence[] = [];
  const addUnique = (shot?: ScreenshotEvidence) => {
    if (shot && !selected.some((existing) => existing.id === shot.id)) selected.push(shot);
  };

  for (const moment of analysis.helpfulImageMoments) {
    if (moment.screenshotId) addUnique(imageScreenshots.find((shot) => shot.id === moment.screenshotId));
    const targetMs = moment.atSeconds * 1000;
    addUnique([...imageScreenshots].sort((a, b) => Math.abs(a.capturedAtMs - targetMs) - Math.abs(b.capturedAtMs - targetMs))[0]);
  }

  if (selected.length > MAX_DRAFT_SCREENSHOTS) return selectEvenlySpaced(selected, MAX_DRAFT_SCREENSHOTS);

  for (const representative of selectEvenlySpaced(imageScreenshots, MAX_DRAFT_SCREENSHOTS)) addUnique(representative);

  return selected.slice(0, MAX_DRAFT_SCREENSHOTS);
}

export function alignAnalysisToSentenceEnds(
  analysis: CaptureAnalysis,
  transcript: TranscriptionResult,
  frames: unknown[]
): CaptureAnalysis {
  if (transcript.segments.length === 0) return analysis;
  return {
    ...analysis,
    helpfulImageMoments: analysis.helpfulImageMoments.map((moment) => {
      const segment = closestTranscriptSegment(transcript, moment.atSeconds);
      if (!segment) return moment;
      const frame = screenshotAtOrAfter(frames, segment.end);
      return {
        ...moment,
        atSeconds: segment.end,
        screenshotId: frame?.id ?? moment.screenshotId
      };
    })
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

export function parseTicket(text: string): TicketDraft {
  const parsed = JSON.parse(stripCodeFence(text)) as Partial<TicketDraft>;
  return {
    title: parsed.title || "Untitled ticket",
    templateName: parsed.templateName,
    summary: parsed.summary || "",
    environment: parsed.environment || [],
    reproductionSteps: parsed.reproductionSteps || [],
    expectedBehavior: parsed.expectedBehavior || "",
    actualBehavior: parsed.actualBehavior || "",
    evidence: parsed.evidence || [],
    openQuestions: parsed.openQuestions || []
  };
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

function combineUsage(...usages: OpenAiUsage[]): OpenAiUsage {
  const inputTokens = usages.reduce((sum, usage) => sum + usage.inputTokens, 0);
  const outputTokens = usages.reduce((sum, usage) => sum + usage.outputTokens, 0);
  const totalTokens = usages.reduce((sum, usage) => sum + usage.totalTokens, 0);
  const estimatedCostUsd = usages.reduce((sum, usage) => sum + usage.estimatedCostUsd, 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000
  };
}

function emptyUsage(): OpenAiUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0
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
