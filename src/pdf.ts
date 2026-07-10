import { jsPDF } from "jspdf";
import type { RecordingSession, TicketDraft } from "./types";

export function createTicketPdf(ticket: TicketDraft, session: RecordingSession): Blob {
  const maxPageHeight = 14400;
  const measuringPdf = new jsPDF({ unit: "pt", format: [612, maxPageHeight] });
  const measuredHeight = drawTicket(measuringPdf, ticket, session);
  const pageHeight = Math.min(maxPageHeight, Math.max(792, Math.ceil(measuredHeight + 44)));
  const pdf = new jsPDF({ unit: "pt", format: [612, pageHeight] });
  drawTicket(pdf, ticket, session);
  return pdf.output("blob");
}

function drawTicket(pdf: jsPDF, ticket: TicketDraft, session: RecordingSession): number {
  const margin = 44;
  const width = pdf.internal.pageSize.getWidth();
  const maxTextWidth = width - margin * 2;
  let y = margin;

  const addHeading = (text: string, size = 16) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(text, maxTextWidth);
    pdf.text(lines, margin, y);
    y += lines.length * (size + 5) + 8;
  };

  const addParagraph = (text: string) => {
    if (!text) return;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    const lines = pdf.splitTextToSize(text, maxTextWidth);
    pdf.text(lines, margin, y);
    y += lines.length * 13 + 10;
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
  for (const evidence of ticket.evidence) {
    const screenshot = evidence.screenshotId
      ? session.screenshots.find((shot) => shot.id === evidence.screenshotId)
      : undefined;
    if (screenshot) {
      try {
        const props = pdf.getImageProperties(screenshot.dataUrl);
        const imageWidth = maxTextWidth;
        const imageHeight = Math.min(300, (props.height * imageWidth) / props.width);
        addParagraph(evidence.caption);
        pdf.addImage(screenshot.dataUrl, "PNG", margin, y, imageWidth, imageHeight, undefined, "FAST");
        y += imageHeight + 18;
      } catch {
        addParagraph(evidence.caption);
        addParagraph(`[Screenshot ${screenshot.id} could not be embedded]`);
      }
    } else {
      addParagraph(evidence.caption);
    }
  }

  if (ticket.openQuestions.length > 0) {
    addHeading("Open Questions");
    for (const question of ticket.openQuestions) addParagraph(`- ${question}`);
  }

  return y;
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
