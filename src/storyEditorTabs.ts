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
