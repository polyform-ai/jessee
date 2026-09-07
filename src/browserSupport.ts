export function supportsDirectoryPicker(): boolean {
  return typeof window.showDirectoryPicker === "function";
}

export function usesFullPageRecorder(): boolean {
  if (typeof chrome === "undefined") return false;
  return !(chrome as typeof chrome & { sidePanel?: unknown }).sidePanel;
}

export function screenCaptureOptions(preferCompatibility: boolean): DisplayMediaStreamOptions {
  if (preferCompatibility) return { video: true, audio: false };
  return {
    video: {
      cursor: "always",
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 30, max: 60 }
    } as MediaTrackConstraints & { cursor: "always" },
    audio: false
  };
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
