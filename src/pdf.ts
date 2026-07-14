import { jsPDF } from "jspdf";
import { buildCaptureStory } from "./captureStory";
import type { CaptureStoryStep, RecordingSession } from "./types";

export function createPlanPdf(session: RecordingSession): Blob {
  if (!session.captureAnalysis) throw new Error("A reviewed plan is required before creating the PDF.");
  const title = session.captureAnalysis.userGoal || session.tabTitle || "JesSee capture";
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  pdf.setProperties({
    title,
    subject: "JesSee visual story",
    author: "JesSee",
    creator: "JesSee",
    keywords: "capture, visual story, transcript, evidence"
  });
  drawPlan(pdf, session);
  addFooter(pdf);
  return pdf.output("blob");
}

function drawPlan(pdf: jsPDF, session: RecordingSession): void {
  const analysis = session.captureAnalysis!;
  const storySteps = buildCaptureStory(analysis, session.transcript, session.timeline, session.screenshots);
  const margin = 44;
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const maxTextWidth = width - margin * 2;
  const bottom = height - 42;
  let y = margin;

  const ensureSpace = (requiredHeight: number) => {
    if (y + requiredHeight <= bottom) return;
    pdf.addPage();
    y = margin;
  };

  const addHeading = (text: string, size = 16) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(text, maxTextWidth);
    ensureSpace(lines.length * (size + 5) + 12);
    pdf.setTextColor(24, 24, 27);
    pdf.text(lines, margin, y);
    y += lines.length * (size + 5) + 8;
  };

  const addParagraph = (text: string, color: [number, number, number] = [63, 63, 70]) => {
    if (!text) return;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    const lines = pdf.splitTextToSize(text, maxTextWidth);
    ensureSpace(lines.length * 13 + 10);
    pdf.setTextColor(...color);
    pdf.text(lines, margin, y);
    y += lines.length * 13 + 10;
  };

  const addEvidenceImage = (step: CaptureStoryStep, screenshot: RecordingSession["screenshots"][number], index: number) => {
    const props = pdf.getImageProperties(screenshot.dataUrl);
    const maxImageHeight = 360;
    const naturalHeight = (props.height * maxTextWidth) / props.width;
    const imageHeight = Math.min(maxImageHeight, naturalHeight);
    const imageWidth = Math.min(maxTextWidth, (props.width * imageHeight) / props.height);
    const caption = step.narrative || step.title;
    const captionLines = pdf.splitTextToSize(caption, imageWidth - 24);
    const captionHeight = Math.max(1, captionLines.length) * 11;
    const cardHeight = imageHeight + captionHeight + 58;
    ensureSpace(cardHeight);
    pdf.setFillColor(250, 250, 250);
    pdf.setDrawColor(228, 228, 231);
    pdf.roundedRect(margin, y, imageWidth, cardHeight - 8, 8, 8, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(24, 24, 27);
    pdf.text(`Story step ${index + 1}  ·  ${formatTimestamp(screenshot.capturedAtMs)}`, margin + 12, y + 18);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(82, 82, 91);
    pdf.text(captionLines, margin + 12, y + 32);
    const imageY = y + 38 + captionHeight;
    const format = screenshot.dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
    pdf.addImage(screenshot.dataUrl, format, margin + (maxTextWidth - imageWidth) / 2, imageY, imageWidth, imageHeight, undefined, "SLOW");
    y += cardHeight + 10;
  };

  addHeading(analysis.userGoal || session.tabTitle || "JesSee capture", 20);
  addParagraph(analysis.story);

  const keyPoints = analysis.keyPoints?.length ? analysis.keyPoints : analysis.breakingPoints ?? [];
  if (keyPoints.length) {
    addHeading("Key points");
    keyPoints.forEach((point) => addParagraph(`• ${point}`));
  }

  addHeading("Story");
  storySteps.forEach((step, index) => {
    addHeading(`${index + 1}. ${step.title}`, 14);
    addParagraph(`${formatSeconds(step.startSeconds)}${step.endSeconds !== step.startSeconds ? `–${formatSeconds(step.endSeconds)}` : ""} · ${storyKindLabel(step)}`, [113, 113, 122]);
    addParagraph(step.narrative);
    if (step.transcript) addParagraph(`What the user said: “${step.transcript}”`, [39, 39, 42]);
    if (step.pageUrl) addParagraph(`Page: ${step.pageTitle || step.pageUrl}${step.pageTitle ? ` — ${step.pageUrl}` : ""}`, [3, 105, 161]);
    const screenshot = step.screenshotId ? session.screenshots.find((shot) => shot.id === step.screenshotId) : undefined;
    if (screenshot) {
      try {
        addEvidenceImage(step, screenshot, index);
      } catch {
        addParagraph(`[Screenshot ${screenshot.id} could not be embedded]`);
      }
    }
  });
}

function storyKindLabel(step: CaptureStoryStep): string {
  if (step.kind === "page-change") return "Page change";
  if (step.kind === "manual") return "Added story step";
  if (step.kind === "action") return "Action";
  return "User narration";
}

function formatTimestamp(milliseconds: number): string {
  return formatSeconds(milliseconds / 1000);
}

function formatSeconds(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function addFooter(pdf: jsPDF): void {
  const pageCount = pdf.getNumberOfPages();
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(228, 228, 231);
    pdf.line(44, height - 30, width - 44, height - 30);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(113, 113, 122);
    pdf.text("JesSee visual story", 44, height - 17);
    pdf.text(`Page ${page} of ${pageCount}`, width - 44, height - 17, { align: "right" });
  }
}

export function planPdfFilename(title: string, now = new Date()): string {
  const timestamp = now.toISOString().slice(0, 19).replace(/:/g, "-");
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "visual-story";
  return `${timestamp}-${slug}.pdf`;
}

export async function createDownload(data: Blob | string, filename: string, mimeType: string): Promise<void> {
  const blob = typeof data === "string" ? new Blob([data], { type: mimeType }) : data;
  const url = await blobToDataUrl(blob);
  await chrome.downloads.download({ url, filename, saveAs: false });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
