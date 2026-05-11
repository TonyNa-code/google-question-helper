const elements = {
  closeOverlayButton: document.querySelector("#closeOverlayButton"),
  settingsToggle: document.querySelector("#settingsToggle"),
  settingsPanel: document.querySelector("#settingsPanel"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  modelInput: document.querySelector("#modelInput"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  questionInput: document.querySelector("#questionInput"),
  captureAndAnswerButton: document.querySelector("#captureAndAnswerButton"),
  captureScreenButton: document.querySelector("#captureScreenButton"),
  fullScreenCaptureButton: document.querySelector("#fullScreenCaptureButton"),
  pullSelectionButton: document.querySelector("#pullSelectionButton"),
  pasteButton: document.querySelector("#pasteButton"),
  imageInput: document.querySelector("#imageInput"),
  ocrStatus: document.querySelector("#ocrStatus"),
  answerButton: document.querySelector("#answerButton"),
  copyButton: document.querySelector("#copyButton"),
  clearButton: document.querySelector("#clearButton"),
  status: document.querySelector("#status"),
  answerOutput: document.querySelector("#answerOutput"),
  modeButtons: Array.from(document.querySelectorAll(".mode-button"))
};

const DEFAULT_MODEL = "deepseek-v4-flash";
const AVAILABLE_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
const IS_OVERLAY = new URLSearchParams(location.search).get("mode") === "overlay";

let selectedMode = "explain";
let lastPendingQuestionAt = 0;
let ocrWorkerPromise = null;

init();

async function init() {
  document.body.classList.toggle("overlay", IS_OVERLAY);
  elements.closeOverlayButton.classList.toggle("hidden", !IS_OVERLAY);

  const saved = await chrome.storage.local.get([
    "deepseekApiKey",
    "deepseekModel",
    "pendingQuestion",
    "pendingQuestionAt"
  ]);

  elements.apiKeyInput.value = saved.deepseekApiKey || "";
  elements.modelInput.value = normalizeModel(saved.deepseekModel);

  if (saved.pendingQuestion) {
    elements.questionInput.value = saved.pendingQuestion;
    lastPendingQuestionAt = saved.pendingQuestionAt || 0;
    setStatus("已导入你刚刚选中的题目。", "ok");
  }

  bindEvents();
}

function bindEvents() {
  elements.settingsToggle.addEventListener("click", () => {
    elements.settingsPanel.classList.toggle("hidden");
  });

  elements.saveSettingsButton.addEventListener("click", saveSettings);
  elements.closeOverlayButton.addEventListener("click", closeOverlay);
  elements.captureAndAnswerButton.addEventListener("click", () => recognizeSelectedRegion({ autoAnswer: true }));
  elements.captureScreenButton.addEventListener("click", () => recognizeSelectedRegion({ autoAnswer: false }));
  elements.fullScreenCaptureButton.addEventListener("click", () => recognizeCurrentScreen({ autoAnswer: false }));
  elements.pullSelectionButton.addEventListener("click", pullActiveSelection);
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

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const incomingText = changes.pendingQuestion?.newValue;
    const incomingAt = changes.pendingQuestionAt?.newValue || 0;
    if (!incomingText || incomingAt <= lastPendingQuestionAt) return;

    lastPendingQuestionAt = incomingAt;
    elements.questionInput.value = incomingText;
    setStatus("已导入你刚刚选中的题目。", "ok");
  });
}

async function saveSettings() {
  const apiKey = elements.apiKeyInput.value.trim();
  const model = normalizeModel(elements.modelInput.value);

  await chrome.storage.local.set({
    deepseekApiKey: apiKey,
    deepseekModel: model
  });

  elements.modelInput.value = model;
  setStatus("设置已保存。", "ok");
}

async function pullActiveSelection() {
  setStatus("正在读取当前网页选中文字...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("没有找到当前网页。");

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection().toString().trim()
    });

    const selectedText = (results?.[0]?.result || "").trim();
    if (!selectedText) {
      setStatus("当前页面没有选中文字，可以手动粘贴题目。", "error");
      return;
    }

    elements.questionInput.value = selectedText;
    await chrome.storage.local.set({
      pendingQuestion: selectedText,
      pendingQuestionAt: Date.now()
    });
    setStatus("已抓取当前选中文字。", "ok");
  } catch (error) {
    setStatus(readableError(error), "error");
  }
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      setStatus("剪贴板里没有文字。", "error");
      return;
    }

    mergeQuestionText(text.trim());
    setStatus("已读取剪贴板文字。", "ok");
  } catch (error) {
    setStatus("浏览器没有允许读取剪贴板，可以手动粘贴。", "error");
  }
}

async function recognizeSelectedRegion({ autoAnswer = false } = {}) {
  setStatus("请在网页上拖动框选题目区域...");
  setOcrStatus("框选模式中，按 Esc 可取消。");
  setBusy(true);

  try {
    const selection = await requestRegionSelection();
    if (!selection?.ok) {
      throw new Error(selection?.error || "已取消框选。");
    }

    setStatus("正在截取框选区域...");
    const response = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
    if (!response?.ok || !response.dataUrl) {
      throw new Error(response?.error || "截图失败。");
    }

    await setOverlayVisible(true).catch(() => {});
    const croppedImage = await cropDataUrl(response.dataUrl, selection.rect, selection.viewport);
    const recognized = await recognizeImageSource(croppedImage, "框选区域文字已识别并填入题目框。");
    if (autoAnswer && recognized) {
      await answerQuestion();
    }
  } catch (error) {
    setStatus(readableSelectionError(error), "error");
    setOcrStatus("");
  } finally {
    await setOverlayVisible(true).catch(() => {});
    setBusy(false);
  }
}

async function recognizeCurrentScreen({ autoAnswer = false } = {}) {
  setStatus("正在截取当前网页可见区域...");
  setOcrStatus("截图准备中...");
  setBusy(true);

  try {
    await setOverlayVisible(false);
    await sleep(180);

    const response = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
    if (!response?.ok || !response.dataUrl) {
      throw new Error(response?.error || "截图失败。");
    }

    await setOverlayVisible(true).catch(() => {});
    const recognized = await recognizeImageSource(response.dataUrl, "当前屏幕文字已识别并填入题目框。");
    if (autoAnswer && recognized) {
      await answerQuestion();
    }
  } catch (error) {
    setStatus(readableCaptureError(error), "error");
    setOcrStatus("");
  } finally {
    await setOverlayVisible(true).catch(() => {});
    setBusy(false);
  }
}

async function requestRegionSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("没有找到当前网页。");

  return chrome.tabs.sendMessage(tab.id, { type: "START_REGION_SELECTION" });
}

async function recognizeImageFile(event) {
  const file = event.target.files?.[0];
  elements.imageInput.value = "";
  if (!file) return;

  await recognizeImageSource(file, "图片文字已识别并填入题目框。");
}

async function recognizeImageSource(imageSource, successMessage) {
  if (!window.Tesseract?.createWorker) {
    setStatus("OCR 组件没有加载成功，请重新加载插件。", "error");
    return;
  }

  setStatus("正在识别图片文字，第一次可能会慢一点...");
  setOcrStatus("准备 OCR...");
  setBusy(true);

  try {
    const worker = await getOcrWorker();
    const result = await worker.recognize(imageSource);
    const text = (result?.data?.text || "").trim();

    if (!text) {
      setStatus("没有识别到文字。可以换一张更清晰的图片再试。", "error");
      return;
    }

    mergeQuestionText(text);
    setStatus(successMessage, "ok");
    setOcrStatus("");
    return true;
  } catch (error) {
    setStatus(readableOcrError(error), "error");
    setOcrStatus("");
    return false;
  } finally {
    setBusy(false);
  }
}

function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = Tesseract.createWorker(["chi_sim", "eng"], 1, {
      workerPath: chrome.runtime.getURL("vendor/tesseract/worker.min.js"),
      corePath: chrome.runtime.getURL("vendor/tesseract-core"),
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      workerBlobURL: false,
      logger: (message) => {
        if (message?.status) {
          const progress = Math.round((message.progress || 0) * 100);
          setOcrStatus(`${message.status}${progress ? ` ${progress}%` : ""}`);
        }
      }
    });
  }

  return ocrWorkerPromise;
}

function mergeQuestionText(text) {
  const current = elements.questionInput.value.trim();
  elements.questionInput.value = current ? `${current}\n\n${text}` : text;
}

function cropDataUrl(dataUrl, rect, viewport) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scaleX = image.naturalWidth / viewport.width;
        const scaleY = image.naturalHeight / viewport.height;
        const sourceX = clampNumber(Math.round(rect.left * scaleX), 0, image.naturalWidth - 1);
        const sourceY = clampNumber(Math.round(rect.top * scaleY), 0, image.naturalHeight - 1);
        const sourceWidth = clampNumber(Math.round(rect.width * scaleX), 1, image.naturalWidth - sourceX);
        const sourceHeight = clampNumber(Math.round(rect.height * scaleY), 1, image.naturalHeight - sourceY);

        const canvas = document.createElement("canvas");
        canvas.width = sourceWidth;
        canvas.height = sourceHeight;
        const context = canvas.getContext("2d");
        context.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          sourceWidth,
          sourceHeight
        );
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("截图图片读取失败。"));
    image.src = dataUrl;
  });
}

async function answerQuestion() {
  const question = elements.questionInput.value.trim();
  if (!question) {
    setStatus("先输入或抓取题目文字。", "error");
    return;
  }

  const { deepseekApiKey, deepseekModel } = await chrome.storage.local.get([
    "deepseekApiKey",
    "deepseekModel"
  ]);
  const apiKey = deepseekApiKey;
  if (!apiKey) {
    elements.settingsPanel.classList.remove("hidden");
    setStatus("请先填写并保存 DeepSeek API Key。", "error");
    return;
  }

  const model = normalizeModel(deepseekModel || elements.modelInput.value);
  setBusy(true);
  elements.answerOutput.textContent = "";
  setStatus("正在生成讲解...");

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(buildRequestBody(model, question))
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || `请求失败：${response.status}`);
    }

    const answer = extractOutputText(payload);
    elements.answerOutput.textContent = answer || "没有收到文字结果，请换个模型或稍后再试。";
    setStatus("讲解完成。", "ok");
  } catch (error) {
    setStatus(readableError(error), "error");
  } finally {
    setBusy(false);
  }
}

function buildRequestBody(model, question) {
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "你是一个学习辅导助手，请用中文帮助用户理解题目。",
          "如果这是作业、练习或测验，请优先讲清思路、关键步骤和易错点；不要鼓励违规代考或直接用于作弊。"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          modeInstruction(selectedMode),
          `题目文字：\n${question}`
        ].join("\n\n")
      }
    ],
    thinking: { type: "disabled" },
    temperature: 0.2,
    max_tokens: 1600,
    stream: false
  };
}

function modeInstruction(mode) {
  if (mode === "short") {
    return "输出要求：先给一句结论，再用 3-6 行说明关键依据。";
  }

  if (mode === "hint") {
    return "输出要求：只给分步提示和下一步该怎么想，不直接给最终答案。";
  }

  return "输出要求：给出完整讲解，包含题意理解、步骤、答案和检查方法。";
}

function extractOutputText(payload) {
  return payload?.choices?.[0]?.message?.content?.trim() || "";
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

function setStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`.trim();
}

function setOcrStatus(message) {
  elements.ocrStatus.textContent = message;
}

function closeOverlay() {
  if (!IS_OVERLAY) return;

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "CLOSE_STUDY_HELPER" }).catch(() => {});
  });
}

async function setOverlayVisible(visible) {
  if (!IS_OVERLAY) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  await chrome.tabs.sendMessage(tab.id, {
    type: "SET_STUDY_HELPER_VISIBLE",
    visible
  });
}

function setBusy(isBusy) {
  elements.answerButton.disabled = isBusy;
  elements.captureAndAnswerButton.disabled = isBusy;
  elements.captureScreenButton.disabled = isBusy;
  elements.fullScreenCaptureButton.disabled = isBusy;
  elements.pullSelectionButton.disabled = isBusy;
  elements.pasteButton.disabled = isBusy;
  elements.imageInput.disabled = isBusy;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readableError(error) {
  const message = error?.message || String(error);

  if (message.includes("401")) return "DeepSeek API Key 无效，请检查后重新保存。";
  if (message.includes("429")) return "请求太频繁或额度不足，请稍后再试。";
  if (message.includes("Failed to fetch")) return "无法连接 DeepSeek API，请检查网络或代理。";

  return message;
}

function readableCaptureError(error) {
  const message = error?.message || String(error);
  if (message.includes("Cannot access") || message.includes("not permitted")) {
    return "这个页面不允许插件截图。请在普通网页里使用。";
  }

  if (message.includes("activeTab") || message.includes("permission")) {
    return "截图权限不够。请先点一次浏览器工具栏里的插件图标，再点“搜题：框选并讲解”。";
  }

  return `当前屏幕识别失败：${message}`;
}

function readableSelectionError(error) {
  const message = error?.message || String(error);
  if (message.includes("Receiving end does not exist")) {
    return "当前网页还没有加载悬浮窗。请先点一次插件图标打开悬浮窗。";
  }

  if (message.includes("已取消框选")) return "已取消框选。";
  if (message.includes("框选范围太小")) return message;

  return `框选识别失败：${message}`;
}

function readableOcrError(error) {
  const message = error?.message || String(error);
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return "OCR 语言包下载失败，请检查网络后再试。";
  }

  return `OCR 识别失败：${message}`;
}

function normalizeModel(model) {
  return AVAILABLE_MODELS.has(model) ? model : DEFAULT_MODEL;
}

function clampNumber(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
