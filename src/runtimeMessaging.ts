import type { RecordingSession, RuntimeMessage } from "./types";

export interface RuntimeResponse {
  ok: boolean;
  session?: RecordingSession;
  error?: string;
}

/** Safari's Chrome-compatible runtime messaging is callback-based. */
export function sendRuntimeMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response: RuntimeResponse | undefined) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(response ?? {
          ok: false,
          error: "JesSee could not reach its background process. Reload the extension in Safari and try again."
        });
      });
    } catch (error) {
      reject(error);
    }
  });
}
