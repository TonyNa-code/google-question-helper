const { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, nativeImage, screen } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const { createWorker } = require("tesseract.js");

const DEFAULT_MODEL = "deepseek-v4-flash";
const AVAILABLE_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

let mainWindow = null;
let ocrWorkerPromise = null;

app.whenReady().then(() => {
  createMainWindow();
  registerIpcHandlers();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 620,
    minWidth: 320,
    minHeight: 420,
    resizable: true,
    title: "题目助手",
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function registerIpcHandlers() {
  ipcMain.handle("settings:load", loadSettings);
  ipcMain.handle("settings:save", async (event, settings) => saveSettings(settings));
  ipcMain.handle("clipboard:read-text", () => clipboard.readText());
  ipcMain.handle("screen:capture-region", captureSelectedRegion);
  ipcMain.handle("screen:capture-full", captureFullScreen);
  ipcMain.handle("ocr:recognize", async (event, dataUrl) => recognizeImage(dataUrl));
  ipcMain.handle("deepseek:answer", async (event, payload) => answerWithDeepSeek(payload));
}

async function loadSettings() {
  try {
    const raw = await fs.readFile(getSettingsPath(), "utf8");
    const settings = JSON.parse(raw);
    return {
      apiKey: settings.apiKey || "",
      model: normalizeModel(settings.model)
    };
  } catch {
    return {
      apiKey: "",
      model: DEFAULT_MODEL
    };
  }
}

async function saveSettings(settings) {
  const next = {
    apiKey: String(settings?.apiKey || "").trim(),
    model: normalizeModel(settings?.model)
  };

  await fs.mkdir(path.dirname(getSettingsPath()), { recursive: true });
  await fs.writeFile(getSettingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

async function captureSelectedRegion() {
  const display = getMainDisplay();
  const selection = await selectRegion(display);
  if (!selection?.ok) return selection;

  const dataUrl = await captureDisplay(display);
  const cropped = cropDataUrl(dataUrl, selection.rect, display);
  return { ok: true, dataUrl: cropped };
}

async function captureFullScreen() {
  const display = getMainDisplay();
  const dataUrl = await captureDisplay(display);
  return { ok: true, dataUrl };
}

function getMainDisplay() {
  if (!mainWindow) return screen.getPrimaryDisplay();
  const bounds = mainWindow.getBounds();
  return screen.getDisplayNearestPoint({
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2)
  });
}

function selectRegion(display) {
  return new Promise((resolve) => {
    if (mainWindow) mainWindow.hide();

    let resolved = false;
    const overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: "框选题目区域",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.js")
      }
    });

    const cleanup = () => {
      ipcMain.removeHandler("selection:finish");
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    };

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      if (!overlay.isDestroyed()) overlay.close();
      resolve(result);
    };

    ipcMain.handle("selection:finish", (event, result) => {
      if (event.sender !== overlay.webContents) return { ok: false };
      finish(result);
      return { ok: true };
    });

    overlay.on("closed", () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ ok: false, canceled: true, error: "已取消框选。" });
      }
    });

    overlay.loadFile(path.join(__dirname, "renderer", "selector.html"));
    overlay.once("ready-to-show", () => overlay.show());
  });
}

async function captureDisplay(display) {
  const thumbnailSize = {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor)
  };

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize
  });

  const source = sources.find((item) => item.display_id === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error("无法截取屏幕。macOS 可能需要在系统设置里允许屏幕录制权限。");
  }

  return source.thumbnail.toDataURL();
}

function cropDataUrl(dataUrl, rect, display) {
  const image = nativeImage.createFromDataURL(dataUrl);
  const size = image.getSize();
  const scaleX = size.width / display.bounds.width;
  const scaleY = size.height / display.bounds.height;

  const x = clampNumber(Math.round(rect.left * scaleX), 0, size.width - 1);
  const y = clampNumber(Math.round(rect.top * scaleY), 0, size.height - 1);
  const width = clampNumber(Math.round(rect.width * scaleX), 1, size.width - x);
  const height = clampNumber(Math.round(rect.height * scaleY), 1, size.height - y);

  return image.crop({ x, y, width, height }).toDataURL();
}

async function recognizeImage(dataUrl) {
  const worker = await getOcrWorker();
  const result = await worker.recognize(dataUrl);
  return (result?.data?.text || "").trim();
}

function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker(["chi_sim", "eng"], 1, {
      logger: (message) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("ocr:progress", {
            status: message.status,
            progress: message.progress
          });
        }
      }
    });
  }

  return ocrWorkerPromise;
}

async function answerWithDeepSeek(payload) {
  const question = String(payload?.question || "").trim();
  const apiKey = String(payload?.apiKey || "").trim();
  const model = normalizeModel(payload?.model);
  const mode = String(payload?.mode || "explain");

  if (!question) throw new Error("请先输入或识别题目。");
  if (!apiKey) throw new Error("请先填写并保存 DeepSeek API Key。");

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
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
          content: [modeInstruction(mode), `题目文字：\n${question}`].join("\n\n")
        }
      ],
      thinking: { type: "disabled" },
      temperature: 0.2,
      max_tokens: 1600,
      stream: false
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `请求失败：${response.status}`);
  }

  return body?.choices?.[0]?.message?.content?.trim() || "";
}

function modeInstruction(mode) {
  if (mode === "short") return "输出要求：先给一句结论，再用 3-6 行说明关键依据。";
  if (mode === "hint") return "输出要求：只给分步提示和下一步该怎么想，不直接给最终答案。";
  return "输出要求：给出完整讲解，包含题意理解、步骤、答案和检查方法。";
}

function normalizeModel(model) {
  return AVAILABLE_MODELS.has(model) ? model : DEFAULT_MODEL;
}

function clampNumber(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
