export interface ImagePublicationAnnotation {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImagePublicationStep {
  imageFilename?: string;
  imageAnnotations: readonly ImagePublicationAnnotation[];
}

export interface PublishedImageState {
  filename: string;
  annotations: readonly ImagePublicationAnnotation[];
}

export function imagePublicationState<T extends {
  steps: readonly ImagePublicationStep[];
}>(story: T, fallbackFilename?: string): string | undefined {
  const step = story.steps.find((candidate) => candidate.imageFilename);
  const filename = step?.imageFilename || fallbackFilename;
  if (!filename) return undefined;
  return serializedImagePublicationState({ filename, annotations: step?.imageAnnotations || [] });
}

export function serializedImagePublicationState(
  state?: PublishedImageState
): string | undefined {
  if (!state) return undefined;
  return JSON.stringify({
    filename: state.filename,
    annotations: state.annotations.map((annotation) => ({
      id: annotation.id,
      kind: annotation.kind,
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height
    }))
  });
}
