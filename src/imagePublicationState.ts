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
  additionalImages?: readonly PublishedImageState[];
}

export interface PublishedImageState {
  filename: string;
  annotations: readonly ImagePublicationAnnotation[];
}

export function imagePublicationState<T extends {
  steps: readonly ImagePublicationStep[];
}>(story: T, fallbackFilename?: string): string | undefined {
  const image = story.steps.flatMap((step) => [
    ...(step.imageFilename ? [{ filename: step.imageFilename, annotations: step.imageAnnotations }] : []),
    ...(step.additionalImages || [])
  ])[0];
  const filename = image?.filename || fallbackFilename;
  if (!filename) return undefined;
  return serializedImagePublicationState({ filename, annotations: image?.annotations || [] });
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
