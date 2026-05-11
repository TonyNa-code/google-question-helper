const MENU_ID = "send-selection-to-study-helper";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "把选中题目发到搜题学习助手",
    contexts: ["selection"]
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  await toggleInPageHelper(tab);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  const question = (info.selectionText || "").trim();
  if (question) {
    await chrome.storage.local.set({
      pendingQuestion: question,
      pendingQuestionAt: Date.now()
    });
  }

  await toggleInPageHelper(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CAPTURE_VISIBLE_TAB") return undefined;

  captureVisibleTab(sender)
    .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));

  return true;
});

async function captureVisibleTab(sender) {
  const windowId = sender?.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
  return chrome.tabs.captureVisibleTab(windowId, {
    format: "png"
  });
}

async function toggleInPageHelper(tab) {
  if (!tab?.id) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });

    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_STUDY_HELPER" });
    return;
  } catch (error) {
    console.warn("In-page helper unavailable on this page.", error);
  }
}
