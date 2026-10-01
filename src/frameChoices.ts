interface Frame {
  filename: string;
  seconds: number;
}

export function framesAroundSection<T extends Frame>(
  frames: readonly T[], startSeconds: number, endSeconds: number,
  selectedFilenames: readonly string[] = []
): T[] {
  const chronological = [...frames].sort((a, b) => a.seconds - b.seconds);
  if (!chronological.length) return [];
  const start = Math.min(startSeconds, endSeconds);
  const end = Math.max(startSeconds, endSeconds);
  const nearestIndex = (time: number) => chronological.reduce((best, frame, index) =>
    Math.abs(frame.seconds - time) < Math.abs(chronological[best].seconds - time) ? index : best, 0);
  const first = Math.max(0, nearestIndex(start) - 2);
  const last = Math.min(chronological.length - 1, nearestIndex(end) + 2);
  return chronological.filter((frame, index) =>
    (index >= first && index <= last) || (frame.seconds >= start - 2 && frame.seconds <= end + 2)
      || selectedFilenames.includes(frame.filename));
}
