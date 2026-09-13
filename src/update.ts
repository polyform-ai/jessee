export const RELEASE_METADATA_URL = "https://jessee.ai/releases/latest.json";

export interface ReleaseChannel {
  channel: "developer-preview" | "chrome-web-store" | "sparkle" | "app-store";
  automaticUpdates: boolean;
  installUrl: string;
}

export interface JesseeReleaseMetadata {
  schemaVersion: 1;
  version: string;
  browserVersion: string;
  publishedAt: string;
  notes: string;
  chrome: ReleaseChannel;
  safari: ReleaseChannel;
}

export type UpdateState =
  | { status: "checking"; installedVersion: string; installedVersionName: string }
  | { status: "error"; installedVersion: string; installedVersionName: string; message: string }
  | {
      status: "current" | "available";
      installedVersion: string;
      installedVersionName: string;
      release: JesseeReleaseMetadata;
      channel: ReleaseChannel;
    };

export function initialUpdateState(): UpdateState {
  const manifest = chrome.runtime.getManifest();
  return {
    status: "checking",
    installedVersion: manifest.version,
    installedVersionName: manifest.version_name ?? manifest.version
  };
}

export async function checkForJesseeUpdate(fetchRelease: typeof fetch = fetch): Promise<UpdateState> {
  const initial = initialUpdateState();
  try {
    const response = await fetchRelease(RELEASE_METADATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Update service returned ${response.status}.`);
    const release = validateReleaseMetadata(await response.json());
    const channel = isSafari() ? release.safari : release.chrome;
    return {
      status: compareBrowserVersions(release.browserVersion, initial.installedVersion) > 0 ? "available" : "current",
      installedVersion: initial.installedVersion,
      installedVersionName: initial.installedVersionName,
      release,
      channel
    };
  } catch (error) {
    return {
      ...initial,
      status: "error",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export function compareBrowserVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function validateReleaseMetadata(value: unknown): JesseeReleaseMetadata {
  if (!value || typeof value !== "object") throw new Error("Update service returned an invalid release.");
  const candidate = value as Partial<JesseeReleaseMetadata>;
  if (
    candidate.schemaVersion !== 1
    || typeof candidate.version !== "string"
    || typeof candidate.browserVersion !== "string"
    || typeof candidate.publishedAt !== "string"
    || typeof candidate.notes !== "string"
  ) throw new Error("Update service returned incomplete release metadata.");
  validateChannel(candidate.chrome);
  validateChannel(candidate.safari);
  return candidate as JesseeReleaseMetadata;
}

function validateChannel(value: unknown): asserts value is ReleaseChannel {
  if (!value || typeof value !== "object") throw new Error("Update service returned an invalid browser channel.");
  const channel = value as Partial<ReleaseChannel>;
  const allowedChannels: ReleaseChannel["channel"][] = ["developer-preview", "chrome-web-store", "sparkle", "app-store"];
  if (
    !allowedChannels.includes(channel.channel as ReleaseChannel["channel"])
    || typeof channel.automaticUpdates !== "boolean"
    || typeof channel.installUrl !== "string"
    || !isSecureUrl(channel.installUrl)
  ) {
    throw new Error("Update service returned incomplete browser channel metadata.");
  }
}

function isSecureUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function versionParts(value: string): number[] {
  if (!/^\d+(?:\.\d+)*$/.test(value)) return [0];
  return value.split(".").map(Number);
}

function isSafari(): boolean {
  return typeof navigator !== "undefined" && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}
