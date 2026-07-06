const STORAGE_KEY = "gitreplay_panel_sizes_v4";
const DEFAULT_PANELS = { files: 0.45, code: 1.275, preview: 1.275 };
const STACK_STORAGE_PREFIX = "gitreplay_split_";
const MIN_FLEX = 0.4;

const DEFAULT_STACK = {
  code: [1, 1, 1],
};

let activeDrag = null;

export function initPanelResize(workspace) {
  if (!workspace) return;

  const panels = {
    files: workspace.querySelector(".panel-files"),
    code: workspace.querySelector(".panel-code"),
    preview: workspace.querySelector(".panel-preview"),
  };

  const handles = workspace.querySelectorAll(":scope > .resize-handle");
  if (!panels.files || !panels.code || !panels.preview || handles.length < 2) return;

  let sizes = loadSizes();
  applySizes(workspace, sizes);

  if (workspace.dataset.resizeBound === "1") return;
  workspace.dataset.resizeBound = "1";

  handles.forEach((handle) => {
    bindResizeHandle(handle, (e) => startDrag(e, handle, workspace, sizes));
  });
}

export function initStackResize(container) {
  if (!container?.dataset.splitId) return;

  endActiveDrag();

  const splitId = container.dataset.splitId;
  const vertical = container.classList.contains("stack-split-v");
  const handleSel = vertical ? ".resize-handle-v" : ".resize-handle-h";
  const panes = [...container.querySelectorAll(":scope > .split-pane")];
  const handles = [...container.querySelectorAll(`:scope > ${handleSel}`)];

  if (panes.length < 2 || handles.length !== panes.length - 1) return;

  let sizes = loadStackSizes(splitId, panes.length);
  applyStackSizes(container, sizes);

  handles.forEach((handle, index) => {
    const clone = handle.cloneNode(true);
    handle.replaceWith(clone);
    bindResizeHandle(clone, (e) =>
      startStackDrag(e, clone, container, sizes, index, splitId, vertical)
    );
  });
}

export function initAllStackResizes(root = document) {
  root.querySelectorAll("[data-split-id]").forEach((el) => initStackResize(el));
}

function loadSizes() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.files && saved?.code && saved?.preview) return saved;
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PANELS };
}

export function equalizeStackSplit(container) {
  if (!container) return;
  const panes = container.querySelectorAll(":scope > .split-pane").length;
  if (panes < 1) return;
  const sizes = Array(panes).fill(1);
  applyStackSizes(container, sizes);
  const splitId = container.dataset.splitId;
  if (splitId) saveStackSizes(splitId, sizes);
}

export function equalizeWorkspacePanels(workspace) {
  if (!workspace) return;
  const sizes = { ...DEFAULT_PANELS };
  applySizes(workspace, sizes);
  saveSizes(sizes);
}

function saveSizes(sizes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
}

function loadStackSizes(splitId, paneCount) {
  const defaults = DEFAULT_STACK[splitId] ?? Array(paneCount).fill(1);
  try {
    const saved = JSON.parse(localStorage.getItem(STACK_STORAGE_PREFIX + splitId));
    if (Array.isArray(saved) && saved.length === paneCount) return saved;
  } catch {
    /* ignore */
  }
  return defaults.slice(0, paneCount);
}

function saveStackSizes(splitId, sizes) {
  localStorage.setItem(STACK_STORAGE_PREFIX + splitId, JSON.stringify(sizes));
}

function applySizes(workspace, sizes) {
  workspace.style.setProperty("--flex-files", String(sizes.files));
  workspace.style.setProperty("--flex-code", String(sizes.code));
  workspace.style.setProperty("--flex-preview", String(sizes.preview));
}

function applyStackSizes(container, sizes) {
  sizes.forEach((size, i) => {
    container.style.setProperty(`--flex-${i}`, String(size));
  });
}

function isVerticalLayout(workspace) {
  return window.matchMedia("(max-width: 900px)").matches;
}

function bindResizeHandle(handle, onPointerDown) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onPointerDown(e);
  });

  handle.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    const touch = e.touches[0];
    onPointerDown({
      preventDefault: () => {},
      clientX: touch.clientX,
      clientY: touch.clientY,
      button: 0,
      pointerId: touch.identifier,
      currentTarget: handle,
    });
  }, { passive: false });
}

function endActiveDrag() {
  if (!activeDrag) return;
  activeDrag.finish();
  activeDrag = null;
}

function beginDragSession(handle, vertical, onMove, onEnd) {
  endActiveDrag();

  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    handle.classList.remove("dragging");
    document.body.classList.remove("is-resizing");
    document.body.classList.remove("is-resizing-v", "is-resizing-h");
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerUp);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onPointerUp);
    window.removeEventListener("blur", onPointerUp);
    document.removeEventListener("visibilitychange", onVisibilityEnd);
    if (activeDrag?.finish === finish) activeDrag = null;
    onEnd();
  };

  const onPointerMove = (ev) => {
    if (ev.buttons === 0) {
      finish();
      return;
    }
    onMove(ev.clientX, ev.clientY);
  };

  const onMouseMove = (ev) => {
    if (ev.buttons === 0) {
      finish();
      return;
    }
    onMove(ev.clientX, ev.clientY);
  };

  const onPointerUp = () => finish();

  const onVisibilityEnd = () => {
    if (document.visibilityState === "hidden") finish();
  };

  handle.classList.add("dragging");
  document.body.classList.add("is-resizing");
  if (vertical) document.body.classList.add("is-resizing-v");
  else document.body.classList.add("is-resizing-h");

  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onPointerUp);
  window.addEventListener("blur", onPointerUp);
  document.addEventListener("visibilitychange", onVisibilityEnd);

  activeDrag = { finish };
  return finish;
}

function startDrag(e, handle, workspace, sizes) {
  try {
    handle.setPointerCapture?.(e.pointerId);
  } catch {
    /* ignore */
  }

  const index = parseInt(handle.dataset.index, 10);
  const vertical = isVerticalLayout(workspace);
  const startPos = vertical ? e.clientY : e.clientX;
  const startSizes = { ...sizes };

  beginDragSession(handle, vertical, (clientX, clientY) => {
    const pos = vertical ? clientY : clientX;
    const total = vertical ? workspace.clientHeight : workspace.clientWidth;
    if (total <= 0) return;
    const delta = (pos - startPos) / total;

    if (index === 0) {
      sizes.files = clamp(startSizes.files + delta * 4);
      sizes.code = clamp(startSizes.code - delta * 4);
      sizes.preview = startSizes.preview;
    } else {
      sizes.files = startSizes.files;
      sizes.code = clamp(startSizes.code + delta * 4);
      sizes.preview = clamp(startSizes.preview - delta * 4);
    }

    normalizePanelSizes(sizes);
    applySizes(workspace, sizes);
  }, () => {
    try {
      handle.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    saveSizes(sizes);
  });
}

function startStackDrag(e, handle, container, sizes, handleIndex, splitId, vertical) {
  try {
    handle.setPointerCapture?.(e.pointerId);
  } catch {
    /* ignore */
  }

  const startPos = vertical ? e.clientY : e.clientX;
  const startSizes = [...sizes];
  const scale = sizes.length * 2;

  beginDragSession(handle, vertical, (clientX, clientY) => {
    const pos = vertical ? clientY : clientX;
    const total = vertical ? container.clientHeight : container.clientWidth;
    if (total <= 0) return;
    const delta = ((pos - startPos) / total) * scale;

    sizes[handleIndex] = clamp(startSizes[handleIndex] + delta);
    sizes[handleIndex + 1] = clamp(startSizes[handleIndex + 1] - delta);

    normalizeStackSizes(sizes);
    applyStackSizes(container, sizes);
  }, () => {
    try {
      handle.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    saveStackSizes(splitId, sizes);
  });
}

function clamp(value) {
  return Math.max(MIN_FLEX, value);
}

function normalizePanelSizes(sizes) {
  const total = sizes.files + sizes.code + sizes.preview;
  if (total <= 0) return;
  sizes.files = (sizes.files / total) * 5;
  sizes.code = (sizes.code / total) * 5;
  sizes.preview = (sizes.preview / total) * 5;
}

function normalizeStackSizes(sizes) {
  const total = sizes.reduce((sum, n) => sum + n, 0);
  if (total <= 0) return;
  const target = sizes.length;
  for (let i = 0; i < sizes.length; i++) {
    sizes[i] = (sizes[i] / total) * target;
  }
}
