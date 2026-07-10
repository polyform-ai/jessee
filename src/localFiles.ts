const DB_NAME = "screen-ticket-recorder-files";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const ROOT_HANDLE_KEY = "rootDirectory";
type PickerStartDirectory = "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";

let rootDirectory: FileSystemDirectoryHandle | undefined;
let recordingDirectory: FileSystemDirectoryHandle | undefined;
let rootDirectoryName: string | undefined;

declare global {
  interface Window {
    showDirectoryPicker(options?: { mode?: "read" | "readwrite"; id?: string; startIn?: PickerStartDirectory }): Promise<FileSystemDirectoryHandle>;
  }
}

export function hasExportFolder(): boolean {
  return Boolean(rootDirectory);
}

export function exportFolderName(): string | undefined {
  return rootDirectoryName;
}

export async function chooseExportFolder(): Promise<void> {
  try {
    rootDirectory = await window.showDirectoryPicker({
      id: "screen-ticket-output",
      mode: "readwrite",
      startIn: "documents"
    });
    rootDirectoryName = rootDirectory.name;
    await saveRootDirectory(rootDirectory);
  } catch (error) {
    throw new Error(folderPickerErrorMessage(error));
  }
}

export async function restoreExportFolder(): Promise<boolean> {
  rootDirectory = await loadRootDirectory(false);
  rootDirectoryName = rootDirectory?.name;
  return Boolean(rootDirectory);
}

export async function ensureExportFolderPermission(requestPermission = true): Promise<boolean> {
  rootDirectory = rootDirectory ?? await loadRootDirectory(false);
  rootDirectoryName = rootDirectory?.name;
  if (!rootDirectory) return false;
  const permissionHandle = rootDirectory as FileSystemDirectoryHandle & {
    queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  };
  const descriptor = { mode: "readwrite" as const };
  const current = await permissionHandle.queryPermission?.(descriptor);
  if (current === "granted") return true;
  if (!requestPermission) return false;
  try {
    const requested = await permissionHandle.requestPermission?.(descriptor);
    return requested === "granted";
  } catch (error) {
    throw new Error(folderPermissionErrorMessage(error));
  }
}

export async function startRecordingFolder(name: string): Promise<string | undefined> {
  rootDirectory = rootDirectory ?? await loadRootDirectory(false);
  rootDirectoryName = rootDirectory?.name;
  if (!rootDirectory) return undefined;
  const folderName = sanitizeName(name);
  recordingDirectory = await rootDirectory.getDirectoryHandle(folderName, { create: true });
  await recordingDirectory.getDirectoryHandle("screenshots", { create: true });
  return folderName;
}

export async function deleteOldCaptureFolders(retentionDays: number, requestPermission = false): Promise<number> {
  if (retentionDays <= 0) return 0;
  if (!await ensureExportFolderPermission(requestPermission)) return 0;
  rootDirectoryName = rootDirectory?.name;
  if (!rootDirectory) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  const entries = rootDirectory as FileSystemDirectoryHandle & {
    entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  };
  if (!entries.entries) return 0;
  for await (const [name, handle] of entries.entries()) {
    if (handle.kind !== "directory") continue;
    const createdAt = timestampFromCaptureFolderName(name);
    if (!createdAt || createdAt >= cutoff) continue;
    await rootDirectory.removeEntry(name, { recursive: true });
    deleted += 1;
  }
  return deleted;
}

export async function writeRecordingBlob(filename: string, blob: Blob): Promise<void> {
  if (!recordingDirectory) return;
  await writeBlob(recordingDirectory, filename, blob);
}

export async function writeScreenshot(filename: string, blob: Blob): Promise<void> {
  if (!recordingDirectory) return;
  const screenshots = await recordingDirectory.getDirectoryHandle("screenshots", { create: true });
  await writeBlob(screenshots, filename, blob);
}

export async function writeRecordingText(filename: string, text: string, type = "text/plain"): Promise<void> {
  await writeRecordingBlob(filename, new Blob([text], { type }));
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "jessee-capture";
}

function timestampFromCaptureFolderName(name: string): number | undefined {
  const match = name.match(/^(\d{4})-(\d{2})-(\d{2})t(\d{2})-(\d{2})-(\d{2})/i);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const time = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
  return Number.isNaN(time) ? undefined : time;
}

async function writeBlob(directory: FileSystemDirectoryHandle, filename: string, blob: Blob): Promise<void> {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function folderPickerErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort/i.test(message)) return "Folder selection was cancelled.";
  if (/system|sensitive|dangerous|permission|not allowed|denied/i.test(message)) {
    return "Chrome blocked that folder because it is protected or managed by the system. Create or choose a normal folder such as Documents/JesSee Captures, Desktop/JesSee Captures, or another project folder you own.";
  }
  return `Could not use that folder. ${message}`;
}

function folderPermissionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/dismiss|abort|cancel/i.test(message)) return "Folder permission was dismissed. Click Start Capture again and allow folder access.";
  if (/activation|gesture/i.test(message)) return "Folder permission must be approved from the Start Capture click. Click Start Capture again and allow folder access.";
  if (/permission|not allowed|denied/i.test(message)) return "Chrome denied access to the capture folder. Choose or allow a folder before starting.";
  return `Could not confirm folder access. ${message}`;
}

async function saveRootDirectory(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(handle, ROOT_HANDLE_KEY));
  db.close();
}

async function loadRootDirectory(requestPermission: boolean): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await openDb();
  const handle = await requestToPromise<FileSystemDirectoryHandle | undefined>(
    db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(ROOT_HANDLE_KEY)
  );
  db.close();
  if (!handle) return undefined;
  const permissionHandle = handle as FileSystemDirectoryHandle & {
    queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  };
  const descriptor = { mode: "readwrite" as const };
  const current = await permissionHandle.queryPermission?.(descriptor);
  if (current === "granted") return handle;
  if (!requestPermission) return handle;
  const requested = await permissionHandle.requestPermission?.(descriptor);
  return requested === "granted" ? handle : undefined;
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
