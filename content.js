(() => {
if (window.__gqhStudyHelperInjected) {
  return;
}

window.__gqhStudyHelperInjected = true;

const STUDY_HELPER_WRAP_ID = "gqh-study-helper-wrap";
const STUDY_HELPER_FRAME_ID = "gqh-study-helper-frame";
const REGION_OVERLAY_ID = "gqh-region-selection-overlay";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "TOGGLE_STUDY_HELPER") {
    openOrFocusStudyHelper();
    sendResponse({ ok: true });
    return undefined;
  }

  if (message?.type === "SET_STUDY_HELPER_VISIBLE") {
    setStudyHelperVisible(Boolean(message.visible));
    sendResponse({ ok: true });
    return undefined;
  }

  if (message?.type === "CLOSE_STUDY_HELPER") {
    closeStudyHelper();
    sendResponse({ ok: true });
    return undefined;
  }

  if (message?.type === "START_REGION_SELECTION") {
    startRegionSelection()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  return undefined;
});

function openOrFocusStudyHelper() {
  const existing = document.getElementById(STUDY_HELPER_WRAP_ID);
  if (existing) {
    existing.style.visibility = "visible";
    existing.dataset.collapsed = "false";
    syncCollapsedState(existing);
    existing.style.zIndex = "2147483647";
    return;
  }

  const wrap = document.createElement("section");
  wrap.id = STUDY_HELPER_WRAP_ID;
  wrap.dataset.collapsed = "false";
  Object.assign(wrap.style, {
    position: "fixed",
    right: "18px",
    bottom: "18px",
    width: "360px",
    height: "520px",
    minWidth: "300px",
    minHeight: "320px",
    maxWidth: "min(420px, calc(100vw - 24px))",
    maxHeight: "min(620px, calc(100vh - 24px))",
    border: "1px solid rgba(15, 23, 42, 0.18)",
    borderRadius: "10px",
    boxShadow: "0 18px 50px rgba(15, 23, 42, 0.24)",
    background: "#ffffff",
    overflow: "hidden",
    resize: "both",
    zIndex: "2147483647"
  });

  const titlebar = document.createElement("div");
  Object.assign(titlebar.style, {
    height: "34px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "0 8px 0 11px",
    borderBottom: "1px solid rgba(15, 23, 42, 0.12)",
    background: "#f8fafc",
    color: "#172033",
    font: "600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    cursor: "move",
    userSelect: "none"
  });

  const title = document.createElement("span");
  title.textContent = "搜题助手";

  const controls = document.createElement("div");
  Object.assign(controls.style, {
    display: "flex",
    alignItems: "center",
    gap: "6px"
  });

  const minimizeButton = createChromeButton("－", "最小化");
  minimizeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    wrap.dataset.collapsed = wrap.dataset.collapsed === "true" ? "false" : "true";
    syncCollapsedState(wrap);
  });

  const closeButton = createChromeButton("×", "关闭");
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeStudyHelper();
  });

  controls.append(minimizeButton, closeButton);
  titlebar.append(title, controls);

  const frame = document.createElement("iframe");
  frame.id = STUDY_HELPER_FRAME_ID;
  frame.title = "搜题学习助手";
  frame.allow = "clipboard-read; clipboard-write";
  frame.src = chrome.runtime.getURL("sidepanel.html?mode=overlay");
  Object.assign(frame.style, {
    display: "block",
    width: "100%",
    height: "calc(100% - 34px)",
    border: "0",
    background: "#ffffff",
  });

  wrap.append(titlebar, frame);
  document.documentElement.appendChild(wrap);
  makeDraggable(wrap, titlebar);
}

function setStudyHelperVisible(visible) {
  const wrap = document.getElementById(STUDY_HELPER_WRAP_ID);
  if (!wrap) return;

  wrap.style.visibility = visible ? "visible" : "hidden";
}

function closeStudyHelper() {
  document.getElementById(STUDY_HELPER_WRAP_ID)?.remove();
}

function startRegionSelection() {
  return new Promise((resolve) => {
    document.getElementById(REGION_OVERLAY_ID)?.remove();
    setStudyHelperVisible(false);

    const overlay = document.createElement("div");
    overlay.id = REGION_OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      cursor: "crosshair",
      background: "rgba(15, 23, 42, 0.12)",
      userSelect: "none"
    });

    const hint = document.createElement("div");
    hint.textContent = "拖动框选题目区域，松开后识别；按 Esc 取消";
    Object.assign(hint.style, {
      position: "fixed",
      left: "50%",
      top: "18px",
      transform: "translateX(-50%)",
      padding: "8px 12px",
      borderRadius: "8px",
      background: "rgba(15, 23, 42, 0.92)",
      color: "#ffffff",
      font: "600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      boxShadow: "0 10px 30px rgba(15, 23, 42, 0.24)",
      pointerEvents: "none"
    });

    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed",
      display: "none",
      border: "2px solid #2563eb",
      background: "rgba(37, 99, 235, 0.16)",
      boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.18)",
      pointerEvents: "none"
    });

    overlay.append(hint, box);
    document.documentElement.appendChild(overlay);

    let startX = 0;
    let startY = 0;
    let currentRect = null;
    let dragging = false;

    const finish = (result) => {
      cleanup();
      if (!result.ok) {
        setStudyHelperVisible(true);
      }
      resolve(result);
    };

    const updateBox = (clientX, clientY) => {
      const left = clamp(Math.min(startX, clientX), 0, window.innerWidth);
      const top = clamp(Math.min(startY, clientY), 0, window.innerHeight);
      const right = clamp(Math.max(startX, clientX), 0, window.innerWidth);
      const bottom = clamp(Math.max(startY, clientY), 0, window.innerHeight);
      const width = right - left;
      const height = bottom - top;

      currentRect = { left, top, width, height };
      Object.assign(box.style, {
        display: "block",
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`
      });
    };

    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      updateBox(event.clientX, event.clientY);
      overlay.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event) => {
      if (!dragging) return;
      event.preventDefault();
      updateBox(event.clientX, event.clientY);
    };

    const onPointerUp = (event) => {
      if (!dragging) return;
      event.preventDefault();
      dragging = false;
      updateBox(event.clientX, event.clientY);

      if (!currentRect || currentRect.width < 12 || currentRect.height < 12) {
        finish({ ok: false, error: "框选范围太小，请重新框选。" });
        return;
      }

      finish({
        ok: true,
        rect: currentRect,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      });
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        finish({ ok: false, canceled: true, error: "已取消框选。" });
      }
    };

    const cleanup = () => {
      overlay.removeEventListener("pointerdown", onPointerDown);
      overlay.removeEventListener("pointermove", onPointerMove);
      overlay.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
    };

    overlay.addEventListener("pointerdown", onPointerDown);
    overlay.addEventListener("pointermove", onPointerMove);
    overlay.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown, true);
  });
}

function syncCollapsedState(wrap) {
  const isCollapsed = wrap.dataset.collapsed === "true";
  const frame = wrap.querySelector(`#${STUDY_HELPER_FRAME_ID}`);
  const minimizeButton = wrap.querySelector("[data-gqh-minimize]");

  if (isCollapsed) {
    wrap.dataset.expandedHeight = wrap.style.height || "520px";
    wrap.style.height = "34px";
    wrap.style.minHeight = "34px";
    wrap.style.resize = "none";
    if (frame) frame.style.display = "none";
    if (minimizeButton) minimizeButton.textContent = "□";
    return;
  }

  wrap.style.minHeight = "320px";
  wrap.style.height = wrap.dataset.expandedHeight || "520px";
  wrap.style.resize = "both";
  if (frame) frame.style.display = "block";
  if (minimizeButton) minimizeButton.textContent = "－";
}

function createChromeButton(label, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  if (title === "最小化") {
    button.dataset.gqhMinimize = "true";
  }

  Object.assign(button.style, {
    width: "24px",
    height: "24px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid rgba(15, 23, 42, 0.16)",
    borderRadius: "6px",
    background: "#ffffff",
    color: "#243044",
    font: "700 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    cursor: "pointer",
    padding: "0"
  });

  return button;
}

function makeDraggable(wrap, handle) {
  let drag = null;

  handle.addEventListener("pointerdown", (event) => {
    if (event.target instanceof HTMLButtonElement) return;

    const rect = wrap.getBoundingClientRect();
    drag = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };

    wrap.style.left = `${rect.left}px`;
    wrap.style.top = `${rect.top}px`;
    wrap.style.right = "auto";
    wrap.style.bottom = "auto";
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener("pointermove", (event) => {
    if (!drag) return;

    const width = wrap.offsetWidth;
    const height = wrap.offsetHeight;
    const left = clamp(event.clientX - drag.offsetX, 6, window.innerWidth - width - 6);
    const top = clamp(event.clientY - drag.offsetY, 6, window.innerHeight - height - 6);

    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;
  });

  handle.addEventListener("pointerup", () => {
    drag = null;
  });

  handle.addEventListener("pointercancel", () => {
    drag = null;
  });
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
})();
