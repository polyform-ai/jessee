export interface ImagePublicationStep {
  imageFilename?: string;
  imageAnnotations: readonly unknown[];
}

export function imagePublicationState<T extends {
  steps: readonly ImagePublicationStep[];
}>(story: T, fallbackFilename?: string): string | undefined {
  const step = story.steps.find((candidate) => candidate.imageFilename);
  const filename = step?.imageFilename || fallbackFilename;
  if (!filename) return undefined;
  return JSON.stringify({
    filename,
    annotations: step?.imageAnnotations || []
  });
}
