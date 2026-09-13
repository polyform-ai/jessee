const STORY_EDITOR_LOCK = "jessee-story-editor-owner";

export async function withStoryEditorOwnership<T>(
  run: () => Promise<T>,
  unavailable: () => Promise<T>
): Promise<T> {
  const attempt = async (available: boolean): Promise<T> => {
    if (!available || await focusOpenStoryEditor()) return unavailable();
    return run();
  };
  if (!navigator.locks?.request) return attempt(true);
  return navigator.locks.request(STORY_EDITOR_LOCK, { mode: "exclusive", ifAvailable: true }, (lock) => attempt(Boolean(lock)));
}

export async function hasOpenStoryEditor(): Promise<boolean> {
  return Boolean(await openStoryEditorTab());
}

export async function focusOpenStoryEditor(): Promise<boolean> {
  const existing = await openStoryEditorTab();
  if (!existing?.id) return false;
  await chrome.tabs.update(existing.id, { active: true });
  if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
  return true;
}

export async function openOrFocusStoryEditor(): Promise<void> {
  if (await focusOpenStoryEditor()) return;
  await chrome.tabs.create({ url: chrome.runtime.getURL("plan.html") });
}

async function openStoryEditorTab(): Promise<chrome.tabs.Tab | undefined> {
  const editorUrl = chrome.runtime.getURL("plan.html");
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab.id && tab.url?.startsWith(editorUrl));
}
