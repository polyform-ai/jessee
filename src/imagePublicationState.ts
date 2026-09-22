export interface ImagePublicationStep {
  imageFilename?: string;
  imageAnnotations: readonly unknown[];
}

export function imagePublicationState<T extends {
  steps: readonly ImagePublicationStep[];
}>(story: T): string | undefined {
  const step = story.steps.find((candidate) => candidate.imageFilename);
  if (!step?.imageFilename) return undefined;
  return JSON.stringify({
    filename: step.imageFilename,
    annotations: step.imageAnnotations || []
  });
}
