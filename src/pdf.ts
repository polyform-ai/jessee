import { jsPDF } from "jspdf";
import { buildCaptureStory } from "./captureStory";
import type { CaptureStoryStep, RecordingSession, SerializedEditorNode } from "./types";

const PAGE_WIDTH = 612;
const MINIMUM_PAGE_HEIGHT = 792;
const MAXIMUM_PAGE_HEIGHT = 14_400;
const MARGIN = 44;
const FOOTER_SPACE = 54;

interface RichTextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  indent?: number;
  resetIndent?: boolean;
}

interface PositionedRun extends RichTextRun {
  width: number;
}

interface PositionedLine {
  runs: PositionedRun[];
  offset: number;
}

interface ImageDimensions {
  width: number;
  height: number;
}

export function createPlanPdf(session: RecordingSession): Blob {
  if (!session.captureAnalysis) throw new Error("A reviewed plan is required before creating the PDF.");
  const title = session.captureAnalysis.userGoal || session.tabTitle || "JesSee capture";
  const measurementPdf = new jsPDF({ unit: "pt", format: [PAGE_WIDTH, MAXIMUM_PAGE_HEIGHT], orientation: "portrait" });
  const storySteps = buildCaptureStory(session.captureAnalysis, session.transcript, session.timeline, session.screenshots);
  const imageDimensions = measureSelectedImages(measurementPdf, storySteps, session.screenshots);
  const availableHeight = MAXIMUM_PAGE_HEIGHT - FOOTER_SPACE;
  let contentScale = 1;
  let contentHeight = drawPlan(measurementPdf, session, storySteps, imageDimensions, false, contentScale);

  if (contentHeight > availableHeight) {
    let lowerScale = 0.001;
    let upperScale = 1;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const candidateScale = (lowerScale + upperScale) / 2;
      const candidateHeight = drawPlan(measurementPdf, session, storySteps, imageDimensions, false, candidateScale);
      if (candidateHeight <= availableHeight) lowerScale = candidateScale;
      else upperScale = candidateScale;
    }
    contentScale = lowerScale;
    contentHeight = drawPlan(measurementPdf, session, storySteps, imageDimensions, false, contentScale);
  }

  const pageHeight = Math.max(MINIMUM_PAGE_HEIGHT, Math.ceil(contentHeight + FOOTER_SPACE));
  if (pageHeight > MAXIMUM_PAGE_HEIGHT) throw new Error("This story is too long to fit safely on one continuous PDF page.");
  const pdf = new jsPDF({ unit: "pt", format: [PAGE_WIDTH, pageHeight], orientation: "portrait" });
  pdf.setProperties({
    title,
    subject: "JesSee visual walkthrough",
    author: "JesSee",
    creator: "JesSee",
    keywords: "capture, visual walkthrough, explanation, evidence"
  });
  drawPlan(pdf, session, storySteps, imageDimensions, true, contentScale);
  addFooter(pdf);
  return pdf.output("blob");
}

function drawPlan(
  pdf: jsPDF,
  session: RecordingSession,
  storySteps: CaptureStoryStep[],
  imageDimensions: ReadonlyMap<string, ImageDimensions>,
  shouldRender: boolean,
  scale: number
): number {
  const analysis = session.captureAnalysis!;
  const editorDocument = analysis.editorDocument;
  const overviewNode = childOfType(editorDocument, "storyOverview");
  const editorSteps = childrenOfType(editorDocument, "storyStep");
  const maxTextWidth = PAGE_WIDTH - MARGIN * 2;
  let y = MARGIN;

  const addRichText = (
    runs: RichTextRun[],
    size: number,
    color: [number, number, number],
    baseBold: boolean,
    trailingSpace: number
  ) => {
    const fontSize = Math.max(0.1, size * scale);
    const lineHeight = (size + (baseBold ? 5 : 3)) * scale;
    const lines = wrapRichText(pdf, runs, maxTextWidth, fontSize, baseBold);
    if (shouldRender) {
      pdf.setTextColor(...color);
      lines.forEach((line) => {
        let x = MARGIN + line.offset;
        line.runs.forEach((run) => {
          setFont(pdf, baseBold || run.bold, run.italic);
          pdf.setFontSize(fontSize);
          pdf.text(run.text, x, y);
          x += run.width;
        });
        y += lineHeight;
      });
    } else {
      y += lines.length * lineHeight;
    }
    y += trailingSpace * scale;
  };

  const addHeading = (runs: RichTextRun[], size = 16) => addRichText(runs, size, [24, 24, 27], true, 8);
  const addParagraph = (runs: RichTextRun[], color: [number, number, number] = [63, 63, 70]) => addRichText(runs, 10, color, false, 10);
  const addCallout = (runs: RichTextRun[]) => {
    const fontSize = Math.max(0.1, 10 * scale);
    const lineHeight = 13 * scale;
    const inset = 16 * scale;
    const lines = wrapRichText(pdf, runs, maxTextWidth - inset * 2, fontSize, false);
    const boxHeight = Math.max(lineHeight, lines.length * lineHeight) + 24 * scale;
    if (shouldRender) {
      pdf.setFillColor(245, 243, 255);
      pdf.setDrawColor(221, 214, 254);
      pdf.roundedRect(MARGIN, y, maxTextWidth, boxHeight, 8 * scale, 8 * scale, "FD");
      pdf.setFillColor(124, 58, 237);
      pdf.roundedRect(MARGIN, y, 4 * scale, boxHeight, 2 * scale, 2 * scale, "F");
      pdf.setTextColor(76, 29, 149);
      let lineY = y + 17 * scale;
      lines.forEach((line) => {
        let x = MARGIN + inset + line.offset;
        line.runs.forEach((run) => {
          setFont(pdf, run.bold, run.italic);
          pdf.setFontSize(fontSize);
          pdf.text(run.text, x, lineY);
          x += run.width;
        });
        lineY += lineHeight;
      });
    }
    y += boxHeight + 10 * scale;
  };

  const addEvidenceImage = (step: CaptureStoryStep, screenshot: RecordingSession["screenshots"][number], index: number) => {
    const props = imageDimensions.get(screenshot.id);
    if (!props) throw new Error(`Could not read image dimensions for ${screenshot.id}.`);
    const maximumImageHeight = 360 * scale;
    const naturalHeight = (props.height * maxTextWidth) / props.width;
    const imageHeight = Math.min(maximumImageHeight, naturalHeight);
    const imageWidth = Math.min(maxTextWidth, (props.width * imageHeight) / props.height);
    const captionRuns = plainRuns(screenshot.title || step.title);
    const captionFontSize = Math.max(0.1, 9 * scale);
    const captionLines = wrapRichText(pdf, captionRuns, Math.max(20, maxTextWidth - 24 * scale), captionFontSize, false);
    const captionHeight = Math.max(1, captionLines.length) * 11 * scale;
    const cardHeight = imageHeight + captionHeight + 58 * scale;

    if (shouldRender) {
      pdf.setFillColor(250, 250, 250);
      pdf.setDrawColor(228, 228, 231);
      pdf.roundedRect(MARGIN, y, maxTextWidth, cardHeight - 8 * scale, 8 * scale, 8 * scale, "FD");
      setFont(pdf, true, false);
      pdf.setFontSize(Math.max(0.1, 10 * scale));
      pdf.setTextColor(24, 24, 27);
      pdf.text(`Step ${index + 1} - selected visual at ${formatTimestamp(screenshot.capturedAtMs)}`, MARGIN + 12 * scale, y + 18 * scale);
      pdf.setTextColor(82, 82, 91);
      let captionY = y + 32 * scale;
      captionLines.forEach((line) => {
        let captionX = MARGIN + 12 * scale + line.offset;
        line.runs.forEach((run) => {
          setFont(pdf, run.bold, run.italic);
          pdf.setFontSize(captionFontSize);
          pdf.text(run.text, captionX, captionY);
          captionX += run.width;
        });
        captionY += 11 * scale;
      });
      const imageY = y + 38 * scale + captionHeight;
      const format = screenshot.dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
      pdf.addImage(screenshot.dataUrl, format, MARGIN + (maxTextWidth - imageWidth) / 2, imageY, imageWidth, imageHeight, undefined, "SLOW");
    }
    y += cardHeight + 10 * scale;
  };

  addHeading(runsFromNode(childOfType(overviewNode, "storyTitle"), analysis.userGoal), 20);
  addParagraph(runsFromNode(childOfType(overviewNode, "storySummary"), analysis.story));

  const keyPoints = analysis.keyPoints?.length ? analysis.keyPoints : analysis.breakingPoints ?? [];
  const editorKeyPointRuns = overviewNode ? runsFromBulletList(childOfType(overviewNode, "bulletList")) : [];
  if (overviewNode ? hasVisibleText(editorKeyPointRuns) : keyPoints.length > 0) {
    addHeading(plainRuns("Key points"));
    if (overviewNode) addParagraph(editorKeyPointRuns);
    else keyPoints.forEach((point) => addParagraph([{ text: "- ", bold: false, italic: false }, ...plainRuns(point)]));
  }

  addHeading(plainRuns("Walkthrough"));
  storySteps.forEach((step, index) => {
    const editorStep = editorSteps[index];
    const headingNode = childOfType(editorStep, "heading");
    const bodyNodes = editorStep?.content?.filter((child) => ["paragraph", "bulletList", "orderedList", "blockquote"].includes(child.type ?? "")) ?? [];
    const screenshot = step.screenshotId ? session.screenshots.find((shot) => shot.id === step.screenshotId) : undefined;
    addHeading([{ text: `${index + 1}. `, bold: false, italic: false }, ...runsFromNode(headingNode, step.title)], 14);
    if (!bodyNodes.length) addParagraph(plainRuns(step.narrative));
    else bodyNodes.forEach((node) => {
      if (node.type === "blockquote") addCallout(runsFromNode(node, ""));
      else addParagraph(runsFromBodyNodes([node], ""));
    });
    if (step.pageUrl && step.showPageUrl !== false) addParagraph(plainRuns(`Source: ${step.pageTitle || step.pageUrl}${step.pageTitle ? ` - ${step.pageUrl}` : ""}`), [3, 105, 161]);
    if (screenshot) {
      try {
        addEvidenceImage(step, screenshot, index);
      } catch {
        addParagraph(plainRuns(`[Screenshot ${screenshot.id} could not be embedded]`));
      }
    }
  });
  return y;
}

function wrapRichText(pdf: jsPDF, runs: RichTextRun[], maxWidth: number, fontSize: number, baseBold: boolean): PositionedLine[] {
  const lines: PositionedLine[] = [{ runs: [], offset: 0 }];
  let lineWidth = 0;
  let activeIndent = 0;

  const nextLine = (offset = activeIndent) => {
    lines.push({ runs: [], offset });
    lineWidth = offset;
  };

  const addPiece = (piece: string, run: RichTextRun) => {
    if (!piece) return;
    if (lineWidth === 0 && run.indent) {
      activeIndent = run.indent * fontSize * 1.4;
      lines.at(-1)!.offset = activeIndent;
      lineWidth = activeIndent;
    }
    setFont(pdf, baseBold || run.bold, run.italic);
    pdf.setFontSize(fontSize);
    const pieceWidth = pdf.getTextWidth(piece);
    if (lines.at(-1)!.runs.length > 0 && lineWidth + pieceWidth > maxWidth) nextLine();
    if (lineWidth + pieceWidth <= maxWidth) {
      if (!piece.trim() && lineWidth === 0) return;
      appendPositionedRun(lines.at(-1)!.runs, { ...run, text: piece, width: pieceWidth });
      lineWidth += pieceWidth;
      return;
    }

    let fragment = "";
    for (const character of piece) {
      const candidate = fragment + character;
      const candidateWidth = pdf.getTextWidth(candidate);
      if (fragment && lineWidth + candidateWidth > maxWidth) {
        const fragmentWidth = pdf.getTextWidth(fragment);
        appendPositionedRun(lines.at(-1)!.runs, { ...run, text: fragment, width: fragmentWidth });
        nextLine();
        fragment = character;
      } else {
        fragment = candidate;
      }
    }
    if (fragment) {
      const fragmentWidth = pdf.getTextWidth(fragment);
      appendPositionedRun(lines.at(-1)!.runs, { ...run, text: fragment, width: fragmentWidth });
      lineWidth += fragmentWidth;
    }
  };

  for (const run of runs.length ? runs : plainRuns("")) {
    for (const piece of run.text.replace(/\r/g, "").split(/(\n|[ \t]+)/)) {
      if (piece === "\n") {
        if (run.resetIndent) activeIndent = 0;
        nextLine(activeIndent);
      }
      else addPiece(/^[ \t]+$/.test(piece) ? " " : piece, run);
    }
  }
  return lines.length ? lines : [{ runs: [], offset: 0 }];
}

function appendPositionedRun(line: PositionedRun[], run: PositionedRun): void {
  const previous = line.at(-1);
  if (previous && previous.bold === run.bold && previous.italic === run.italic) {
    previous.text += run.text;
    previous.width += run.width;
  } else {
    line.push(run);
  }
}

function runsFromBodyNodes(nodes: SerializedEditorNode[], fallback: string): RichTextRun[] {
  if (!nodes.length) return plainRuns(fallback);
  const runs: RichTextRun[] = [];
  nodes.forEach((node, index) => {
    if (index) runs.push({ text: "\n", bold: false, italic: false, resetIndent: true });
    if (node.type !== "bulletList" && node.type !== "orderedList") {
      runs.push(...runsFromNode(node, ""));
      return;
    }
    runs.push(...runsFromList(node, node.type === "orderedList"));
  });
  return runs.length ? runs : plainRuns(fallback);
}

function runsFromBulletList(node: SerializedEditorNode | undefined, depth = 0): RichTextRun[] {
  return runsFromList(node, false, depth);
}

function runsFromList(node: SerializedEditorNode | undefined, ordered: boolean, depth = 0): RichTextRun[] {
  const runs: RichTextRun[] = [];
  childrenOfType(node, "listItem").forEach((item, index) => {
    const directRuns: RichTextRun[] = [];
    childrenOfType(item, "paragraph").forEach((paragraph, paragraphIndex) => {
      if (paragraphIndex) directRuns.push({ text: "\n", bold: false, italic: false });
      directRuns.push(...runsFromNode(paragraph, ""));
    });
    const nestedLists = (item.content ?? []).filter((child) => child.type === "bulletList" || child.type === "orderedList");
    if (hasVisibleText(directRuns)) {
      if (runs.length) runs.push({ text: "\n", bold: false, italic: false, resetIndent: true });
      runs.push({ text: ordered ? `${index + 1}. ` : "- ", bold: false, italic: false, indent: depth }, ...directRuns);
    }
    nestedLists.forEach((nestedList) => {
      const nestedRuns = runsFromList(nestedList, nestedList.type === "orderedList", hasVisibleText(directRuns) ? depth + 1 : depth);
      if (!hasVisibleText(nestedRuns)) return;
      if (runs.length) runs.push({ text: "\n", bold: false, italic: false, resetIndent: true });
      runs.push(...nestedRuns);
    });
  });
  return runs;
}

function hasVisibleText(runs: RichTextRun[]): boolean {
  return runs.some((run) => run.text.trim().length > 0);
}

function runsFromNode(node: SerializedEditorNode | undefined, fallback: string): RichTextRun[] {
  if (!node) return plainRuns(fallback);
  const runs: RichTextRun[] = [];
  const visit = (current: SerializedEditorNode) => {
    if (current.type === "hardBreak") {
      runs.push({ text: "\n", bold: false, italic: false });
      return;
    }
    if (typeof current.text === "string") {
      const markNames = new Set(current.marks?.map((mark) => mark.type) ?? []);
      runs.push({ text: current.text, bold: markNames.has("bold"), italic: markNames.has("italic") });
      return;
    }
    current.content?.forEach(visit);
  };
  visit(node);
  return runs.length ? runs : plainRuns("");
}

function measureSelectedImages(
  pdf: jsPDF,
  storySteps: CaptureStoryStep[],
  screenshots: RecordingSession["screenshots"]
): Map<string, ImageDimensions> {
  const dimensions = new Map<string, ImageDimensions>();
  for (const step of storySteps) {
    if (!step.screenshotId || dimensions.has(step.screenshotId)) continue;
    const screenshot = screenshots.find((candidate) => candidate.id === step.screenshotId);
    if (!screenshot) continue;
    try {
      const properties = pdf.getImageProperties(screenshot.dataUrl);
      dimensions.set(screenshot.id, { width: properties.width, height: properties.height });
    } catch {
      // The renderer will replace unreadable selected images with a text placeholder.
    }
  }
  return dimensions;
}

function plainRuns(text: string): RichTextRun[] {
  return [{ text, bold: false, italic: false }];
}

function childOfType(node: SerializedEditorNode | undefined, type: string): SerializedEditorNode | undefined {
  return node?.content?.find((child) => child.type === type);
}

function childrenOfType(node: SerializedEditorNode | undefined, type: string): SerializedEditorNode[] {
  return node?.content?.filter((child) => child.type === type) ?? [];
}

function setFont(pdf: jsPDF, bold: boolean, italic: boolean): void {
  const style = bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal";
  pdf.setFont("helvetica", style);
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
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  pdf.setDrawColor(228, 228, 231);
  pdf.line(MARGIN, height - 30, width - MARGIN, height - 30);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(113, 113, 122);
  pdf.text("JesSee visual walkthrough", MARGIN, height - 17);
  pdf.text("One continuous story", width - MARGIN, height - 17, { align: "right" });
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
