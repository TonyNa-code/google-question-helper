const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("questionHelper", {
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  readClipboardText: () => ipcRenderer.invoke("clipboard:read-text"),
  captureRegion: () => ipcRenderer.invoke("screen:capture-region"),
  captureFullScreen: () => ipcRenderer.invoke("screen:capture-full"),
  recognizeImage: (dataUrl) => ipcRenderer.invoke("ocr:recognize", dataUrl),
  answerQuestion: (payload) => ipcRenderer.invoke("deepseek:answer", payload),
  finishSelection: (result) => ipcRenderer.invoke("selection:finish", result),
  onOcrProgress: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("ocr:progress", listener);
    return () => ipcRenderer.removeListener("ocr:progress", listener);
  }
});
