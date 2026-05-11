const box = document.querySelector("#box");

let startX = 0;
let startY = 0;
let currentRect = null;
let dragging = false;

window.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  dragging = true;
  startX = event.clientX;
  startY = event.clientY;
  updateBox(event.clientX, event.clientY);
});

window.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  event.preventDefault();
  updateBox(event.clientX, event.clientY);
});

window.addEventListener("pointerup", async (event) => {
  if (!dragging) return;
  event.preventDefault();
  dragging = false;
  updateBox(event.clientX, event.clientY);

  if (!currentRect || currentRect.width < 12 || currentRect.height < 12) {
    await window.questionHelper.finishSelection({
      ok: false,
      error: "框选范围太小，请重新框选。"
    });
    return;
  }

  await window.questionHelper.finishSelection({
    ok: true,
    rect: currentRect
  });
});

window.addEventListener("keydown", async (event) => {
  if (event.key !== "Escape") return;
  await window.questionHelper.finishSelection({
    ok: false,
    canceled: true,
    error: "已取消框选。"
  });
});

function updateBox(clientX, clientY) {
  const left = clampNumber(Math.min(startX, clientX), 0, window.innerWidth);
  const top = clampNumber(Math.min(startY, clientY), 0, window.innerHeight);
  const right = clampNumber(Math.max(startX, clientX), 0, window.innerWidth);
  const bottom = clampNumber(Math.max(startY, clientY), 0, window.innerHeight);
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
}

function clampNumber(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
