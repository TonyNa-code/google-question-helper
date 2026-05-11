const elements = {
  settingsToggle: document.querySelector("#settingsToggle"),
  settingsPanel: document.querySelector("#settingsPanel"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  modelInput: document.querySelector("#modelInput"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  questionInput: document.querySelector("#questionInput"),
  captureAndAnswerButton: document.querySelector("#captureAndAnswerButton"),
  captureRegionButton: document.querySelector("#captureRegionButton"),
  captureFullButton: document.querySelector("#captureFullButton"),
  pasteButton: document.querySelector("#pasteButton"),
  imageInput: document.querySelector("#imageInput"),
  answerButton: document.querySelector("#answerButton"),
  copyButton: document.querySelector("#copyButton"),
  clearButton: document.querySelector("#clearButton"),
  status: document.querySelector("#status"),
  ocrStatus: document.querySelector("#ocrStatus"),
  answerOutput: document.querySelector("#answerOutput"),
  modeButtons: Array.from(document.querySelectorAll(".mode-button"))
};

let selectedMode = "explain";

init();

async function init() {
  const settings = await window.questionHelper.loadSettings();
  elements.apiKeyInput.value = settings.apiKey || "";
  elements.modelInput.value = settings.model || "deepseek-v4-flash";
  bindEvents();
  window.questionHelper.onOcrProgress((message) => {
    if (!message?.status) return;
    const progress = Math.round((message.progress || 0) * 100);
    setOcrStatus(`${message.status}${progress ? ` ${progress}%` : ""}`);
  });
}

function bindEvents() {
  elements.settingsToggle.addEventListener("click", () => {
    elements.settingsPanel.classList.toggle("hidden");
  });
  elements.saveSettingsButton.addEventListener("click", saveSettings);
  elements.captureAndAnswerButton.addEventListener("click", () => captureRegion({ autoAnswer: true }));
  elements.captureRegionButton.addEventListener("click", () => captureRegion({ autoAnswer: false }));
  elements.captureFullButton.addEventListener("click", () => captureFullScreen({ autoAnswer: false }));
  elements.pasteButton.addEventListener("click", pasteFromClipboard);
  elements.imageInput.addEventListener("change", recognizeImageFile);
  elements.answerButton.addEventListener("click", answerQuestion);
  elements.copyButton.addEventListener("click", copyAnswer);
  elements.clearButton.addEventListener("click", clearAll);

  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedMode = button.dataset.mode;
      elements.modeButtons.forEach((item) => item.classList.toggle("selected", item === button));
    });
  });
}

async function saveSettings() {
  const settings = await window.questionHelper.saveSettings({
    apiKey: elements.apiKeyInput.value,
    model: elements.modelInput.value
  });
  elements.apiKeyInput.value = settings.apiKey || "";
  elements.modelInput.value = settings.model || "deepseek-v4-flash";
  setStatus("设置已保存。", "ok");
}

async function captureRegion({ autoAnswer }) {
  setBusy(true);
  setStatus("请拖动框选题目区域...");
  setOcrStatus("框选模式中，按 Esc 可取消。");

  try {
    const result = await window.questionHelper.captureRegion();
    if (!result?.ok) throw new Error(result?.error || "已取消框选。");

    const recognized = await recognizeImageSource(result.dataUrl, "框选区域文字已识别并填入题目框。");
    if (autoAnswer && recognized) await answerQuestion();
  } catch (error) {
    setStatus(readableError(error, "框选识别失败"), "error");
    setOcrStatus("");
  } finally {
    setBusy(false);
  }
}

async function captureFullScreen({ autoAnswer }) {
  setBusy(true);
  setStatus("正在识别当前屏幕...");
  setOcrStatus("截图准备中...");

  try {
    const result = await window.questionHelper.captureFullScreen();
    if (!result?.ok) throw new Error(result?.error || "截图失败。");

    const recognized = await recognizeImageSource(result.dataUrl, "当前屏幕文字已识别并填入题目框。");
    if (autoAnswer && recognized) await answerQuestion();
  } catch (error) {
    setStatus(readableError(error, "整屏识别失败"), "error");
    setOcrStatus("");
  } finally {
    setBusy(false);
  }
}

async function pasteFromClipboard() {
  try {
    const text = await window.questionHelper.readClipboardText();
    if (!text.trim()) {
      setStatus("剪贴板里没有文字。", "error");
      return;
    }
    mergeQuestionText(text.trim());
    setStatus("已读取剪贴板文字。", "ok");
  } catch (error) {
    setStatus(readableError(error, "读取剪贴板失败"), "error");
  }
}

async function recognizeImageFile(event) {
  const file = event.target.files?.[0];
  elements.imageInput.value = "";
  if (!file) return;

  setBusy(true);
  try {
    const dataUrl = await fileToDataUrl(file);
    await recognizeImageSource(dataUrl, "图片文字已识别并填入题目框。");
  } catch (error) {
    setStatus(readableError(error, "图片识别失败"), "error");
  } finally {
    setBusy(false);
  }
}

async function recognizeImageSource(dataUrl, successMessage) {
  setStatus("正在 OCR 识别，第一次可能会慢一点...");
  setOcrStatus("准备 OCR...");

  const text = await window.questionHelper.recognizeImage(dataUrl);
  if (!text) {
    setStatus("没有识别到文字。可以换一块更清晰的区域再试。", "error");
    setOcrStatus("");
    return false;
  }

  mergeQuestionText(text);
  setStatus(successMessage, "ok");
  setOcrStatus("");
  return true;
}

async function answerQuestion() {
  const question = elements.questionInput.value.trim();
  if (!question) {
    setStatus("请先输入或识别题目。", "error");
    return;
  }

  setBusy(true);
  elements.answerOutput.textContent = "";
  setStatus("正在生成讲解...");

  try {
    const answer = await window.questionHelper.answerQuestion({
      question,
      apiKey: elements.apiKeyInput.value,
      model: elements.modelInput.value,
      mode: selectedMode
    });
    elements.answerOutput.textContent = answer || "没有收到文字结果，请换个模型或稍后再试。";
    setStatus("讲解完成。", "ok");
  } catch (error) {
    setStatus(readableError(error, "讲解失败"), "error");
  } finally {
    setBusy(false);
  }
}

async function copyAnswer() {
  const answer = elements.answerOutput.textContent.trim();
  if (!answer) {
    setStatus("还没有可以复制的解答。", "error");
    return;
  }
  await navigator.clipboard.writeText(answer);
  setStatus("解答已复制。", "ok");
}

function clearAll() {
  elements.questionInput.value = "";
  elements.answerOutput.textContent = "";
  setOcrStatus("");
  setStatus("已清空。", "ok");
}

function mergeQuestionText(text) {
  const current = elements.questionInput.value.trim();
  elements.questionInput.value = current ? `${current}\n\n${text}` : text;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function setBusy(isBusy) {
  elements.captureAndAnswerButton.disabled = isBusy;
  elements.captureRegionButton.disabled = isBusy;
  elements.captureFullButton.disabled = isBusy;
  elements.pasteButton.disabled = isBusy;
  elements.answerButton.disabled = isBusy;
  elements.imageInput.disabled = isBusy;
}

function setStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`.trim();
}

function setOcrStatus(message) {
  elements.ocrStatus.textContent = message;
}

function readableError(error, prefix) {
  const message = error?.message || String(error);
  if (message.includes("401")) return "DeepSeek API Key 无效，请检查后重新保存。";
  if (message.includes("429")) return "请求太频繁或额度不足，请稍后再试。";
  if (message.includes("Failed to fetch")) return "无法连接 DeepSeek API，请检查网络。";
  if (message.includes("屏幕录制权限")) return message;
  return `${prefix}：${message}`;
}
