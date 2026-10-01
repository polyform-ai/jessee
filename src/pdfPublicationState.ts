import type { SectionImage } from "./storyImages";

interface PDFAnnotation {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PDFStoryEntry {
  title: string;
  narrative: string;
  narrativeHTML?: string;
  imageFilename?: string;
  imageAnnotations: PDFAnnotation[];
  additionalImages?: SectionImage<PDFAnnotation>[];
}

interface PDFStory {
  title: string;
  sourceURL?: string;
  documentType?: string;
  entryLabel?: string;
  summary: string;
  summaryHTML?: string;
  keyPoints: Array<{ text: string }>;
  steps: PDFStoryEntry[];
}

export interface PDFPublicationState {
  title: string;
  sourceURL?: string;
  documentType?: string;
  entryLabel?: string;
  summary: string;
  summaryHTML?: string;
  keyPoints: string[];
  entries: PDFStoryEntry[];
}

export function pdfPublicationState(story: PDFStory): PDFPublicationState {
  return {
    title: story.title,
    sourceURL: story.sourceURL,
    documentType: story.documentType,
    entryLabel: story.entryLabel,
    summary: story.summary,
    summaryHTML: story.summaryHTML,
    keyPoints: story.keyPoints.map((point) => point.text),
    entries: story.steps.map((step) => ({
      title: step.title,
      narrative: step.narrative,
      narrativeHTML: step.narrativeHTML,
      imageFilename: step.imageFilename,
      additionalImages: step.additionalImages?.length ? step.additionalImages : undefined,
      imageAnnotations: step.imageAnnotations.map((annotation) => ({
        id: annotation.id,
        kind: annotation.kind,
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height
      }))
    }))
  };
}

export function serializedPDFPublicationState(state: PDFPublicationState): string {
  return JSON.stringify({
    title: state.title,
    sourceURL: state.sourceURL,
    documentType: state.documentType,
    entryLabel: state.entryLabel,
    summary: state.summary,
    summaryHTML: state.summaryHTML,
    keyPoints: state.keyPoints,
    entries: state.entries.map((entry) => ({
      title: entry.title,
      narrative: entry.narrative,
      narrativeHTML: entry.narrativeHTML,
      imageFilename: entry.imageFilename,
      additionalImages: entry.additionalImages?.length ? entry.additionalImages.map((image) => ({
        filename: image.filename,
        annotations: image.annotations.map((annotation) => ({
          id: annotation.id, kind: annotation.kind, x: annotation.x, y: annotation.y,
          width: annotation.width, height: annotation.height
        }))
      })) : undefined,
      imageAnnotations: entry.imageAnnotations.map((annotation) => ({
        id: annotation.id,
        kind: annotation.kind,
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height
      }))
    }))
  });
}
