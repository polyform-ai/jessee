export interface ImageAnnotation {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SectionImage<A = ImageAnnotation> {
  filename: string;
  annotations: A[];
}

export function sectionImages<A>(step: {
  imageFilename?: string;
  imageAnnotations: A[];
  additionalImages?: SectionImage<A>[];
}): SectionImage<A>[] {
  return [
    ...(step.imageFilename ? [{ filename: step.imageFilename, annotations: step.imageAnnotations }] : []),
    ...(step.additionalImages || [])
  ];
}

export function imageFields<A>(images: SectionImage<A>[]): {
  imageFilename?: string;
  imageAnnotations: A[];
  additionalImages: SectionImage<A>[];
} {
  return {
    imageFilename: images[0]?.filename,
    imageAnnotations: images[0]?.annotations || [],
    additionalImages: images.slice(1)
  };
}
