import { jsPDF } from "jspdf";
import type { RecordingSession, TicketDraft } from "./types";

export function createTicketPdf(ticket: TicketDraft, session: RecordingSession): Blob {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  pdf.setProperties({
    title: ticket.title,
    subject: "JesSee capture summary",
    author: "JesSee",
    creator: "JesSee",
    keywords: ["capture", "debug ticket", "evidence", ticket.templateName].filter(Boolean).join(", ")
  });
  drawTicket(pdf, ticket, session);
  addFooter(pdf);
  return pdf.output("blob");
}

function drawTicket(pdf: jsPDF, ticket: TicketDraft, session: RecordingSession): void {
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

  const addParagraph = (text: string) => {
    if (!text) return;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    const lines = pdf.splitTextToSize(text, maxTextWidth);
    ensureSpace(lines.length * 13 + 10);
    pdf.setTextColor(63, 63, 70);
    pdf.text(lines, margin, y);
    y += lines.length * 13 + 10;
  };

  const addEvidenceImage = (caption: string, screenshot: RecordingSession["screenshots"][number], index: number) => {
    const props = pdf.getImageProperties(screenshot.dataUrl);
    const maxImageHeight = 360;
    const naturalHeight = (props.height * maxTextWidth) / props.width;
    const imageHeight = Math.min(maxImageHeight, naturalHeight);
    const imageWidth = Math.min(maxTextWidth, (props.width * imageHeight) / props.height);
    const cardHeight = imageHeight + 68;
    ensureSpace(cardHeight);
    pdf.setFillColor(250, 250, 250);
    pdf.setDrawColor(228, 228, 231);
    pdf.roundedRect(margin, y, imageWidth, cardHeight - 8, 8, 8, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(24, 24, 27);
    pdf.text(`Evidence ${index + 1}  ·  ${formatTimestamp(screenshot.capturedAtMs)}`, margin + 12, y + 18);
    const captionLines = pdf.splitTextToSize(caption, imageWidth - 24).slice(0, 2);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(82, 82, 91);
    pdf.text(captionLines, margin + 12, y + 32);
    const imageY = y + 48;
    const format = screenshot.dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
    pdf.addImage(screenshot.dataUrl, format, margin + (maxTextWidth - imageWidth) / 2, imageY, imageWidth, imageHeight, undefined, "SLOW");
    y += cardHeight + 10;
  };

  addHeading(ticket.title, 20);
  if (ticket.templateName) addParagraph(`Template: ${ticket.templateName}`);
  addParagraph(ticket.summary);

  addHeading("Environment");
  for (const item of ticket.environment) addParagraph(`- ${item}`);

  addHeading("Reproduction Steps");
  ticket.reproductionSteps.forEach((step, index) => addParagraph(`${index + 1}. ${step}`));

  addHeading("Expected Behavior");
  addParagraph(ticket.expectedBehavior);

  addHeading("Actual Behavior");
  addParagraph(ticket.actualBehavior);

  addHeading("Evidence");
  ticket.evidence.forEach((evidence, index) => {
    const screenshot = evidence.screenshotId
      ? session.screenshots.find((shot) => shot.id === evidence.screenshotId)
      : undefined;
    if (screenshot) {
      try {
        addEvidenceImage(evidence.caption, screenshot, index);
      } catch {
        addParagraph(evidence.caption);
        addParagraph(`[Screenshot ${screenshot.id} could not be embedded]`);
      }
    } else {
      addParagraph(evidence.caption);
    }
  });

  if (ticket.openQuestions.length > 0) {
    addHeading("Open Questions");
    for (const question of ticket.openQuestions) addParagraph(`- ${question}`);
  }

}

function formatTimestamp(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
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
    pdf.text("JesSee capture", 44, height - 17);
    pdf.text(`Page ${page} of ${pageCount}`, width - 44, height - 17, { align: "right" });
  }
}

export function ticketPdfFilename(ticket: TicketDraft, now = new Date()): string {
  const timestamp = now.toISOString().slice(0, 19).replace(/:/g, "-");
  const slug = ticket.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "ticket";
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
