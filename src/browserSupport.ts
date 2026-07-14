export function supportsDirectoryPicker(): boolean {
  return typeof window.showDirectoryPicker === "function";
}

export function createCompatibleMediaRecorder(stream: MediaStream, mimeTypes: string[]): MediaRecorder {
  const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
  return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
}

export function mediaFileExtension(mimeType: string, fallback: string): string {
  if (/mp4/i.test(mimeType)) return mimeType.startsWith("audio/") ? "m4a" : "mp4";
  if (/webm/i.test(mimeType)) return "webm";
  return fallback;
}
