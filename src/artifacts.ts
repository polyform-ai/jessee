import type { RecordingSession } from "./types";

const DB_NAME = "screen-ticket-recorder";
const DB_VERSION = 1;
const STORE_NAME = "artifacts";
const REF_PREFIX = "idb:";

export function artifactRef(key: string): string {
  return `${REF_PREFIX}${key}`;
}

export function isArtifactRef(value: string | undefined): boolean {
  return Boolean(value?.startsWith(REF_PREFIX));
}

export async function putArtifact(key: string, value: string): Promise<string> {
  const db = await openDb();
  await requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(value, key));
  db.close();
  return artifactRef(key);
}

export async function getArtifact(refOrValue: string | undefined): Promise<string | undefined> {
  if (!refOrValue) return undefined;
  if (!refOrValue.startsWith(REF_PREFIX)) return refOrValue;
  const db = await openDb();
  const value = await requestToPromise<string | undefined>(
    db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(refOrValue.slice(REF_PREFIX.length))
  );
  db.close();
  return value;
}

export async function hydrateSession(session: RecordingSession): Promise<RecordingSession> {
  return {
    ...session,
    screenshots: await Promise.all(
      session.screenshots.map(async (screenshot) => {
        const dataUrl = await getArtifact(screenshot.dataUrl);
        return {
          ...screenshot,
          dataUrl: dataUrl ?? (isArtifactRef(screenshot.dataUrl) ? "" : screenshot.dataUrl)
        };
      })
    ),
    videoDataUrl: (await getArtifact(session.videoDataUrl)) ?? (isArtifactRef(session.videoDataUrl) ? undefined : session.videoDataUrl),
    audioDataUrl: (await getArtifact(session.audioDataUrl)) ?? (isArtifactRef(session.audioDataUrl) ? undefined : session.audioDataUrl)
  };
}

export async function deleteSessionArtifacts(session: RecordingSession): Promise<void> {
  const refs = new Set([
    ...session.screenshots.map((screenshot) => screenshot.dataUrl),
    session.videoDataUrl,
    session.audioDataUrl
  ].filter((value): value is string => isArtifactRef(value)));
  if (refs.size === 0) return;
  const db = await openDb();
  const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
  await Promise.all([...refs].map((ref) => requestToPromise(store.delete(ref.slice(REF_PREFIX.length)))));
  db.close();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
