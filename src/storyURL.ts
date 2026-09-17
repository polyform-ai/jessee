export function normalizeSourceURL(candidate: string): string | undefined {
  let value = candidate.trim();
  if (!value) return undefined;
  if (!value.includes("://")) value = `https://${value}`;

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    if (!url.hostname || url.hostname.includes(" ")) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
