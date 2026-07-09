import {
  parseGitHubUrl,
  fetchRepoInfo,
  fetchRepoTree,
  fetchFileContent,
  clearInvalidUserToken,
  getUserGitHubToken,
  hasUserGitHubToken,
  isRateLimitError,
  setUserGitHubToken,
  validateUserGitHubToken,
} from "./github.js";
import {
  getRepoUrl,
  navigateToToken,
  navigateToWelcome,
  setPendingRepo,
  setRepoUrl,
} from "./session-nav.js";
import { createPreviewController, isWebFile, isPreviewableMedia, getPreviewMediaKind, isScriptPath, isStylePath, pickBundleEntry, scoreHtmlPath } from "./preview.js";
import { isMarkdownPath } from "./markdown.js";
import {
  codePanelPlaceholderLabel,
  isCodePanelExempt,
  isPreviewPrimary,
  usesLivePreview,
} from "./content-kind.js";
import { initPanelResize, initStackResize, equalizeStackSplit, equalizeWorkspacePanels } from "./resize.js";

const state = {
  parsed: null,
  repoInfo: null,
  fileTree: [],
  selectedPath: null,
  fileContent: "",
  viewMode: "browse",
  replaySteps: [],
  replayPaths: new Set(),
  currentStepIndex: 0,
  charIndex: 0,
  isPlaying: false,
  replaySpeed: 1,
  replayContent: "",
  replayPath: null,
  typingTimer: null,
  stepPauseTimer: null,
  typingFrame: null,
  lastFrameTime: 0,
  charAccumulator: 0,
  lastPreviewRefresh: 0,
  lastTimelineRefresh: 0,
  codeLayout: null,
  codeLayoutKey: null,
  loadedFiles: new Map(),
  parallelWeb: null,
  webPreviewPaths: null,
  replayAllMode: false,
  replayAllPaths: null,
  replayAllIndex: 0,
  raceMode: null,
  collapsedFolders: new Set(),
  lastPreviewHtmlPath: null,
  lastSession: null,
  progressScrubbing: false,
  scrubWasPlaying: false,
  scrubBookmark: null,
};

let replayAllSeekGen = 0;

const els = {
  headerRepo: document.getElementById("header-repo"),
  navTools: document.getElementById("nav-tools"),
  repoInput: document.getElementById("repo-input"),
  startBtn: document.getElementById("start-btn"),
  replayAllBtn: document.getElementById("replay-all-btn"),
  raceControls: document.getElementById("race-controls"),
  raceKindSelect: document.getElementById("race-kind-select"),
  raceBtn: document.getElementById("race-btn"),
  replayBtn: document.getElementById("replay-btn"),
  replayControls: document.getElementById("replay-controls"),
  playPauseBtn: document.getElementById("play-pause-btn"),
  speedSlider: document.getElementById("speed-slider"),
  speedLabel: document.getElementById("speed-label"),
  progressSlider: document.getElementById("progress-slider"),
  progressLabel: document.getElementById("progress-label"),
  errorBanner: document.getElementById("error-banner"),
  workspace: document.getElementById("workspace"),
  repoName: document.getElementById("repo-name"),
  fileTree: document.getElementById("file-tree"),
  timeline: document.getElementById("timeline"),
  stepCounter: document.getElementById("step-counter"),
  stepInfo: document.getElementById("step-info"),
  prevStepBtn: document.getElementById("prev-step-btn"),
  nextStepBtn: document.getElementById("next-step-btn"),
  prevFiles: document.getElementById("prev-files"),
  upcomingFiles: document.getElementById("upcoming-files"),
  codePath: document.getElementById("code-path"),
  codeViewer: document.getElementById("code-viewer"),
  previewFrame: document.getElementById("preview-frame"),
  previewPanel: document.getElementById("preview-panel"),
  previewFullscreenBtn: document.getElementById("preview-fullscreen-btn"),
  previewBuilding: document.getElementById("preview-building"),
  previewReplayDock: document.getElementById("preview-replay-dock"),
  previewEmpty: document.getElementById("preview-empty"),
  previewStatus: document.getElementById("preview-status"),
  tokenSettingsBtn: document.getElementById("token-settings-btn"),
};

const replayControlsHome = {
  parent: els.replayControls.parentElement,
  next: els.replayControls.nextElementSibling,
};

function isPreviewBuilding() {
  if (state.viewMode !== "replay" || !state.isPlaying || state.progressScrubbing) return false;
  if (els.previewFrame.classList.contains("hidden-frame")) return false;

  if (state.parallelWeb) return !isParallelBuildDone(state.parallelWeb);

  if (state.raceMode) {
    return state.raceMode.files.some((f) => f.i < f.full.length);
  }

  const step = state.replaySteps[state.currentStepIndex];
  if (!step) return false;
  const { stepToType } = getTypingStepSlice(step);
  return state.charIndex < stepToType.length;
}

function updatePreviewBuildingWidget() {
  els.previewBuilding?.classList.toggle("hidden", !isPreviewBuilding());
}

function syncPreviewFullscreenChrome() {
  const active = isPreviewFullscreen();
  updatePreviewFullscreenButton();

  if (!els.previewReplayDock || !els.replayControls) return;

  if (active) {
    els.previewReplayDock.appendChild(els.replayControls);
    const inReplay =
      state.viewMode === "replay" &&
      (state.replaySteps.length > 0 || state.raceMode || state.parallelWeb);
    els.replayControls.classList.toggle("hidden", !inReplay);
    return;
  }

  if (els.replayControls.parentElement === els.previewReplayDock) {
    replayControlsHome.parent.insertBefore(els.replayControls, replayControlsHome.next);
    updateReplayUI();
  }
}

const preview = createPreviewController(
  els.previewFrame,
  els.previewEmpty,
  els.previewStatus
);

function handleApiError(err, fallback = "Request failed") {
  if (isRateLimitError(err)) {
    const url = els.repoInput.value.trim();
    if (url) setPendingRepo(url);
    navigateToToken({ reason: "rateLimit", returnTo: "index.html" });
    showError(err.message ?? "GitHub rate limit reached. Add your token to continue.");
    return true;
  }
  showError(err?.message ?? fallback);
  return false;
}

function updateTokenUI() {
  els.tokenSettingsBtn.classList.toggle("is-connected", hasUserGitHubToken());
  els.tokenSettingsBtn.title = hasUserGitHubToken()
    ? "GitHub token connected for this tab — click to change"
    : "Add GitHub token for this tab (optional)";
}

async function bootWorkspace() {
  if (hasUserGitHubToken()) {
    const result = await validateUserGitHubToken(getUserGitHubToken());
    if (!result.valid && !result.networkError) clearInvalidUserToken();
  }
  updateTokenUI();

  const url = getRepoUrl();
  if (!url) {
    navigateToWelcome();
    return;
  }

  els.repoInput.value = url;
  await loadRepository();
}

function showError(msg) {
  els.errorBanner.textContent = msg;
  els.errorBanner.classList.remove("hidden");
}

function clearError() {
  els.errorBanner.classList.add("hidden");
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function activePath() {
  return state.viewMode === "replay" ? state.replayPath : state.selectedPath;
}

function activeContent() {
  return state.viewMode === "replay" ? state.replayContent : state.fileContent;
}

function fillFullSitePreview(htmlPath, overrides = null) {
  if (!htmlPath || !WEB.html.test(htmlPath)) return;

  const paths = collectPreviewSourcePaths(htmlPath);
  for (const key of [...preview.fileCache.keys()]) {
    if (!paths.has(key)) preview.fileCache.delete(key);
  }
  for (const p of paths) {
    const content =
      overrides?.has(p) ? overrides.get(p) : (state.loadedFiles.get(p) ?? "");
    preview.setFile(p, content);
  }
}

function collectPreviewSourcePaths(htmlPath) {
  const paths = new Set();
  if (!htmlPath) return paths;

  const bundle = getHtmlPageBundle(htmlPath);
  for (const p of bundle) {
    if (state.loadedFiles.has(p)) paths.add(p);
  }

  const available = getWebPathCatalog();
  const html = state.loadedFiles.get(htmlPath) ?? "";
  for (const linked of resolvePageAssets(html, htmlPath, available).linked) {
    if (state.loadedFiles.has(linked)) paths.add(linked);
  }

  const queue = [...paths];
  const seen = new Set();
  while (queue.length) {
    const p = queue.shift();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    paths.add(p);
    const content = state.loadedFiles.get(p);
    if (!content || !isScriptPath(p)) continue;
    for (const spec of parseRelativeImports(content)) {
      const resolved = resolveAssetPath(spec, p, available);
      if (resolved && state.loadedFiles.has(resolved) && !seen.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return paths;
}

function getPreviewAssetUrl(path) {
  if (!state.parsed || !state.repoInfo || !path) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://cdn.jsdelivr.net/gh/${state.parsed.owner}/${state.parsed.repo}@${state.repoInfo.defaultBranch}/${encoded}`;
}

function getRepoBlobUrl(path) {
  if (!state.parsed || !state.repoInfo || !path) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${state.parsed.owner}/${state.parsed.repo}/blob/${state.repoInfo.defaultBranch}/${encoded}`;
}

function previewRefreshOptions(extra = {}) {
  return {
    allowPartialJs: true,
    allowPartialCss: true,
    keepLast: true,
    resolveAssetUrl: getPreviewAssetUrl,
    ...extra,
  };
}
function refreshFullHtmlPreview(htmlPath, force = false) {
  if (state.lastPreviewHtmlPath !== htmlPath) {
    preview.invalidate();
    state.lastPreviewHtmlPath = htmlPath;
  }
  fillFullSitePreview(htmlPath);
  const opts = previewRefreshOptions({ liveBuild: false });
  const bundle = getPreviewBundle();
  const entry = bundle?.jsPath ?? bundle?.jsPaths?.[0];
  const asyncOpts = {
    ...opts,
    bundle,
    fullEntryLength: entry ? (state.loadedFiles.get(entry)?.length ?? 0) : 0,
  };
  if (force) {
    state.lastPreviewRefresh = performance.now();
    void preview.refreshAsync(htmlPath, { ...asyncOpts, forceMount: true });
  } else {
    void refreshPreviewThrottled(htmlPath, asyncOpts);
  }
}

function updatePreview() {
  const path = activePath();
  const content = activeContent() ?? "";

  if (!path) {
    preview.clear();
    els.previewFrame.classList.add("hidden-frame");
    els.previewEmpty.classList.remove("hidden");
    els.previewStatus.textContent = "—";
    return;
  }

  refreshPreviewForPath(path, content, true);
}

function collapsedStorageKey() {
  if (!state.repoInfo) return "gitreplay-tree-collapsed";
  return `gitreplay-tree-collapsed:${state.repoInfo.owner}/${state.repoInfo.repo}`;
}

function loadCollapsedFolders() {
  try {
    const raw = localStorage.getItem(collapsedStorageKey());
    state.collapsedFolders = raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    state.collapsedFolders = new Set();
  }
}

function saveCollapsedFolders() {
  try {
    localStorage.setItem(
      collapsedStorageKey(),
      JSON.stringify([...state.collapsedFolders])
    );
  } catch {
    /* ignore quota errors */
  }
}

function toggleFolder(path) {
  if (state.collapsedFolders.has(path)) state.collapsedFolders.delete(path);
  else state.collapsedFolders.add(path);
  saveCollapsedFolders();
  updateFileTree();
}

function ensureFolderExpanded(filePath) {
  if (!filePath) return false;
  let changed = false;
  const parts = filePath.split("/");
  let prefix = "";
  for (let i = 0; i < parts.length - 1; i++) {
    prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
    if (state.collapsedFolders.has(prefix)) {
      state.collapsedFolders.delete(prefix);
      changed = true;
    }
  }
  return changed;
}

function collectParentFolderPaths(filePath, into = new Set()) {
  if (!filePath) return into;
  const parts = filePath.split("/");
  let prefix = "";
  for (let i = 0; i < parts.length - 1; i++) {
    prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
    into.add(prefix);
  }
  return into;
}

function syncFolderExpansion() {
  const toExpand = new Set();
  collectParentFolderPaths(activePath(), toExpand);

  if (state.parallelWeb) {
    for (const file of state.parallelWeb.files) {
      if (file.i > 0) collectParentFolderPaths(file.path, toExpand);
    }
  }

  if (state.raceMode) {
    for (const file of state.raceMode.files) {
      if (file.i > 0) collectParentFolderPaths(file.path, toExpand);
    }
  }

  let changed = false;
  for (const folderPath of toExpand) {
    if (state.collapsedFolders.has(folderPath)) {
      state.collapsedFolders.delete(folderPath);
      changed = true;
    }
  }

  if (!changed) return;

  saveCollapsedFolders();
  for (const folderPath of toExpand) {
    const folder = els.fileTree.querySelector(
      `.tree-folder[data-path="${CSS.escape(folderPath)}"]`
    );
    if (!folder) continue;
    folder.classList.remove("tree-folder-collapsed");
    folder.querySelector(".tree-folder-toggle")?.setAttribute("aria-expanded", "true");
  }
}

function applyFileTreeButtonState(btn, path) {
  const parallelFile = state.parallelWeb?.files.find((f) => f.path === path);
  const parallelActive = parallelFile && parallelFile.i > 0 && state.isPlaying;
  const parallelDone = parallelFile && parallelFile.i >= parallelFile.full.length && state.isPlaying;
  const parallelLeader =
    parallelFile &&
    state.parallelWeb &&
    state.isPlaying &&
    path === state.parallelWeb.htmlPath;
  const raceFile = state.raceMode?.files.find((f) => f.path === path);
  const raceActive = raceFile && raceFile.i > 0;
  const raceDone = raceFile && raceFile.i >= raceFile.full.length;
  const raceLeader =
    raceFile && state.raceMode && getRaceLeader(state.raceMode)?.path === path;

  const replayAllCurrent = Boolean(
    state.replayAllMode &&
    state.replayAllPaths?.length &&
    path === state.replayAllPaths[state.replayAllIndex]
  );

  let singleFileGenerating = false;
  if (
    state.viewMode === "replay" &&
    !state.parallelWeb &&
    !state.raceMode &&
    !state.replayAllMode &&
    state.replayPath === path
  ) {
    const step = state.replaySteps[state.currentStepIndex];
    if (step?.path === path) {
      const { stepToType } = getTypingStepSlice(step);
      singleFileGenerating = state.charIndex < stepToType.length;
    }
  }

  const parallelGenerating = Boolean(
    state.parallelWeb &&
    state.isPlaying &&
    parallelFile &&
    parallelFile.i < parallelFile.full.length &&
    path === state.parallelWeb.htmlPath
  );

  const raceGenerating = Boolean(
    state.raceMode &&
    state.isPlaying &&
    raceFile &&
    raceFile.i < raceFile.full.length &&
    path === (state.raceMode.focusPath ?? state.raceMode.files[0]?.path)
  );

  const generatingCurrent =
    replayAllCurrent || singleFileGenerating || parallelGenerating || raceGenerating;

  const selected =
    !generatingCurrent &&
    (state.raceMode?.focusPath === path ||
      (state.viewMode !== "replay" && state.selectedPath === path) ||
      (state.viewMode === "replay" && !state.raceMode && state.replayPath === path));

  const typing = (parallelActive || raceActive) && !generatingCurrent;

  const stateKey = `${selected ? 1 : 0}${typing ? 1 : 0}${generatingCurrent ? 1 : 0}${(raceLeader || parallelLeader) && state.isPlaying ? 1 : 0}${raceDone || parallelDone ? 1 : 0}`;
  if (btn.dataset.treeState === stateKey) return;
  btn.dataset.treeState = stateKey;

  btn.classList.toggle("selected", selected);
  btn.classList.toggle("typing", typing && !selected);
  btn.classList.toggle("generating-current", generatingCurrent);
  btn.classList.toggle("race-leader", Boolean((raceLeader || parallelLeader) && state.isPlaying));
  btn.classList.toggle("race-done", Boolean(raceDone || parallelDone));
}

function expandActiveFileFolders() {
  let changed = false;
  const path = activePath();
  if (path && ensureFolderExpanded(path)) changed = true;

  if (state.parallelWeb) {
    for (const file of state.parallelWeb.files) {
      if (file.i > 0 && ensureFolderExpanded(file.path)) changed = true;
    }
  }

  if (state.raceMode) {
    for (const file of state.raceMode.files) {
      if (file.i > 0 && ensureFolderExpanded(file.path)) changed = true;
    }
  }

  if (state.replayAllMode && state.replayAllPaths?.length) {
    const current = state.replayAllPaths[state.replayAllIndex];
    if (current && ensureFolderExpanded(current)) changed = true;
  }

  if (state.viewMode === "replay" && state.replayPath && ensureFolderExpanded(state.replayPath)) {
    changed = true;
  }

  return changed;
}

function updateFileTreeState() {
  syncFolderExpansion();
  els.fileTree.querySelectorAll(".tree-file").forEach((btn) => {
    const path = btn.dataset.path;
    if (path) applyFileTreeButtonState(btn, path);
  });
}

function renderFileTree(nodes, depth = 0) {
  const frag = document.createDocumentFragment();

  for (const node of nodes) {
    const name = node.path.split("/").pop();

    if (node.type === "dir") {
      const folder = document.createElement("div");
      folder.className = "tree-folder";
      folder.dataset.path = node.path;
      const collapsed = state.collapsedFolders.has(node.path);
      if (collapsed) folder.classList.add("tree-folder-collapsed");

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "tree-folder-toggle";
      toggle.style.paddingLeft = `${depth * 12 + 6}px`;
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.innerHTML = `<span class="tree-chevron" aria-hidden="true"></span><span class="tree-folder-name">${escapeHtml(name)}</span>`;
      toggle.addEventListener("click", () => toggleFolder(node.path));

      const children = document.createElement("div");
      children.className = "tree-folder-children";
      if (node.children?.length) {
        children.appendChild(renderFileTree(node.children, depth + 1));
      }

      folder.appendChild(toggle);
      folder.appendChild(children);
      frag.appendChild(folder);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tree-file";
      btn.dataset.path = node.path;
      btn.style.paddingLeft = `${depth * 12 + 22}px`;
      btn.textContent = name;
      btn.title = "Double-click to build live";

      applyFileTreeButtonState(btn, node.path);

      let clickTimer = null;
      btn.addEventListener("click", (e) => {
        if (e.detail > 1) return;
        if (clickTimer) clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
          clickTimer = null;
          if (state.raceMode?.files.some((f) => f.path === node.path)) {
            focusRaceFile(node.path);
            return;
          }
          selectFile(node.path);
        }, 220);
      });
      btn.addEventListener("dblclick", (e) => {
        e.preventDefault();
        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = null;
        }
        replayFile(node.path);
      });
      frag.appendChild(btn);
    }
  }

  return frag;
}

function updateFileTree() {
  expandActiveFileFolders();
  els.fileTree.replaceChildren();
  if (!state.fileTree.length) {
    els.fileTree.innerHTML = '<p class="empty" style="padding:10px">No files</p>';
    return;
  }
  els.fileTree.appendChild(renderFileTree(state.fileTree));
}

function isFileGenerating(filePath, content = "") {
  if (!isLiveReplayPosition() || state.viewMode !== "replay") return false;

  if (state.parallelWeb) {
    const file = state.parallelWeb.files.find((f) => f.path === filePath);
    return file ? file.i < file.full.length : false;
  }

  if (state.raceMode) {
    const file = state.raceMode.files.find((f) => f.path === filePath);
    return file ? file.i < file.full.length : false;
  }

  const full =
    state.loadedFiles.get(filePath) ??
    (filePath === state.replayPath ? state.replaySteps[state.currentStepIndex]?.content : "") ??
    "";

  if (filePath === state.replayPath) {
    const typed = content || state.replayContent || "";
    return typed.length < full.length;
  }

  if (WEB.html.test(state.replayPath) && state.webPreviewPaths?.has(filePath)) {
    const typed = companionContent(filePath, state.replayPath, state.replayContent);
    return typed.length < full.length;
  }

  return false;
}

function getCodeScrollers() {
  return els.codeViewer.querySelectorAll(".code-pane-body, .code-scroll, .race-lane-body");
}

function scrollGeneratingCodeIntoView() {
  els.codeViewer.querySelectorAll(".code-pane-generating .code-pane-body").forEach((body) => {
    body.scrollTop = body.scrollHeight;
  });

  els.codeViewer.querySelectorAll(".code-scroll.code-generating").forEach((scroll) => {
    scroll.scrollTop = scroll.scrollHeight;
  });

  els.codeViewer.querySelectorAll(".race-lane-generating .race-lane-body").forEach((body) => {
    body.scrollTop = body.scrollHeight;
  });

  const split = els.codeViewer.querySelector(".code-split.code-split-scroll");
  if (split?.querySelector(".code-pane-generating")) {
    split.scrollTop = split.scrollHeight;
  }

  els.codeViewer.querySelectorAll(".code-pane-generating").forEach((pane) => {
    pane.scrollIntoView({ block: "nearest", behavior: "auto" });
  });
}

function followTypingScroll(typing) {
  els.codeViewer.classList.toggle("is-typing", typing);
  if (!typing) return;

  scrollGeneratingCodeIntoView();
  requestAnimationFrame(scrollGeneratingCodeIntoView);
}

function bindCodeScrollTracking() {
  if (els.codeViewer.dataset.scrollBound === "1") return;
  els.codeViewer.dataset.scrollBound = "1";

  const blockManualScroll = (e) => {
    const locked = e.target.closest(
      ".code-pane-generating .code-pane-body, .code-scroll.code-generating, .race-lane-generating .race-lane-body, .code-split.code-split-scroll:has(.code-pane-generating)"
    );
    if (locked) {
      e.preventDefault();
      scrollGeneratingCodeIntoView();
    }
  };

  els.codeViewer.addEventListener("wheel", blockManualScroll, { passive: false });
  els.codeViewer.addEventListener("touchmove", blockManualScroll, { passive: false });
}

const WEB = {
  html: /\.(html?|htm)$/i,
  css: /\.css$/i,
  js: /\.(mjs|cjs|js)$/i,
  svg: /\.svg$/i,
};
const MAX_RACE_FILES = 32;
const RACE_KIND = {
  html: WEB.html,
  js: WEB.js,
  css: WEB.css,
};

const TYPING_BASE_CPS = 45;
const MAX_CHARS_PER_FRAME = 4000;
const SPEED_SLIDER_MAX = 100;
const SPEED_MIN = 0.25;
const SPEED_MAX = 100000;

function sliderToSpeed(slider) {
  const t = Math.max(0, Math.min(1, slider / SPEED_SLIDER_MAX));
  return SPEED_MIN * (SPEED_MAX / SPEED_MIN) ** t;
}

function formatSpeedLabel(speed) {
  if (speed >= 1000) return `${Math.round(speed).toLocaleString()}x`;
  if (speed >= 10) return `${Math.round(speed)}x`;
  if (speed >= 1) return `${speed.toFixed(1)}x`;
  return `${speed.toFixed(2)}x`;
}

function isLiveReplayPosition() {
  return state.isPlaying || state.progressScrubbing;
}

function syncSpeedFromSlider() {
  const slider = parseFloat(els.speedSlider.value);
  state.replaySpeed = sliderToSpeed(slider);
  els.speedLabel.textContent = formatSpeedLabel(state.replaySpeed);
}

function getTypingStepSlice(step) {
  if (!step) return { stepBase: "", stepToType: "", path: null };
  const stepBase = step.isNewFile ? "" : step.content.slice(0, step.content.length - step.charsAdded);
  const stepToType = step.isNewFile ? step.content : step.content.slice(stepBase.length);
  return { stepBase, stepToType, path: step.path };
}

function getReplayAllFileLength(index) {
  const path = state.replayAllPaths?.[index];
  if (!path) return 0;
  const step = state.replaySteps[index];
  if (step?.path === path) return step.content.length;
  const loaded = state.loadedFiles.get(path);
  return loaded !== undefined ? loaded.length : 0;
}

function getReplayAllProgressRatio() {
  const fileCount = state.replayAllPaths?.length ?? 0;
  if (!fileCount) return 0;

  const currentLen = Math.max(1, getReplayAllFileLength(state.replayAllIndex));
  const fileProgress = Math.min(1, state.charIndex / currentLen);
  return Math.min(1, (state.replayAllIndex + fileProgress) / fileCount);
}

function getReplayAllProgressTarget() {
  const fileCount = state.replayAllPaths?.length ?? 0;
  if (!fileCount) return null;
  const ratio = getReplayAllProgressRatio();
  return {
    kind: "replayAll",
    fileCount,
    fileIndex: state.replayAllIndex,
    index: Math.round(ratio * 1000),
    length: 1000,
    ratio,
  };
}

function getReplayProgressTarget() {
  if (state.viewMode !== "replay") return null;

  if (state.replayAllMode && state.replayAllPaths?.length) {
    return getReplayAllProgressTarget();
  }

  if (state.parallelWeb) {
    const html = getParallelHtmlFile(state.parallelWeb);
    if (!html) return null;
    return { kind: "parallel", path: html.path, index: html.i, length: html.full.length };
  }

  if (state.raceMode) {
    const path = state.raceMode.focusPath ?? state.raceMode.files[0]?.path;
    const file = state.raceMode.files.find((f) => f.path === path);
    if (!file) return null;
    return { kind: "race", path: file.path, index: file.i, length: file.full.length };
  }

  const step = state.replaySteps[state.currentStepIndex];
  if (!step) return null;
  const { stepToType, path } = getTypingStepSlice(step);
  return { kind: "typing", path, index: state.charIndex, length: stepToType.length };
}

function formatProgressLabel(ratio, target = null) {
  if (target?.kind === "replayAll") {
    const fileCount = target.fileCount;
    if (ratio >= 1) return `${fileCount}/${fileCount}`;
    const pos = ratio * fileCount;
    const fileNum = Math.min(fileCount, Math.max(1, Math.ceil(pos - 1e-6)));
    return `${fileNum}/${fileCount}`;
  }
  return `${Math.min(100, Math.round(ratio * 100))}%`;
}

function updateProgressSlider() {
  const target = getReplayProgressTarget();
  if (!target?.length) {
    els.progressSlider.disabled = true;
    els.progressSlider.value = "0";
    els.progressLabel.textContent = "—";
    return;
  }

  els.progressSlider.disabled = false;
  if (!state.progressScrubbing) {
    const ratio = target.kind === "replayAll" ? target.ratio : target.index / target.length;
    els.progressSlider.value = String(Math.round(Math.min(1, ratio) * 1000));
    els.progressLabel.textContent = formatProgressLabel(ratio, target);
  }
}

async function ensureReplayAllStepsThrough(index) {
  for (let i = state.replaySteps.length; i <= index; i++) {
    await prepareReplayAllStep(i);
  }
}

async function applyReplayAllProgress(ratio) {
  const fileCount = state.replayAllPaths?.length ?? 0;
  if (!fileCount) return;

  const seekGen = ++replayAllSeekGen;
  const clamped = Math.max(0, Math.min(1, ratio));
  els.progressLabel.textContent = formatProgressLabel(clamped, {
    kind: "replayAll",
    fileCount,
  });

  const pos = clamped * fileCount;
  const fileIndex = Math.min(fileCount - 1, Math.floor(pos));
  const frac = Math.min(1, pos - fileIndex);

  try {
    await ensureReplayAllStepsThrough(fileIndex);
    if (seekGen !== replayAllSeekGen) return;

    const step = state.replaySteps[fileIndex];
    if (!step) return;

    const { stepToType } = getTypingStepSlice(step);
    const charIndex = stepToType.length ? Math.round(frac * stepToType.length) : 0;
    const content = stepToType.slice(0, charIndex);
    const jumpedFile = fileIndex !== state.replayAllIndex;

    state.replayAllIndex = fileIndex;
    state.currentStepIndex = fileIndex;
    state.charIndex = charIndex;
    state.replayPath = step.path;
    state.replayContent = content;

    ensureFolderExpanded(step.path);
    if (jumpedFile) preview.invalidate();
    if (isWebFile(step.path)) await setupWebPreviewContext(step.path);
    if (seekGen !== replayAllSeekGen) return;
    if (WEB.html.test(step.path)) refreshFullHtmlPreview(step.path, true);

    refreshPreviewForPath(step.path, content, true);
    renderCode(step.path, content, true);
    updateFileTreeState();
    renderTimeline();
  } catch (err) {
    if (seekGen !== replayAllSeekGen) return;
    handleApiError(err, "Failed to seek replay");
  }
}

function applyReplayProgress(ratio) {
  const clamped = Math.max(0, Math.min(1, ratio));

  if (state.replayAllMode && state.replayAllPaths?.length) {
    void applyReplayAllProgress(clamped);
    return;
  }

  els.progressLabel.textContent = formatProgressLabel(clamped);

  if (state.parallelWeb) {
    const html = getParallelHtmlFile(state.parallelWeb);
    if (!html?.full.length) return;
    html.i = Math.round(html.full.length * clamped);
    syncParallelFileSlices(state.parallelWeb);
    state.replayPath = html.path;
    state.replayContent = html.full.slice(0, html.i);
    refreshPreviewForPath(html.path, state.replayContent, true);
    renderParallelWebCode(true);
    updateFileTreeState();
    return;
  }

  if (state.raceMode) {
    const path = state.raceMode.focusPath ?? state.raceMode.files[0]?.path;
    const file = state.raceMode.files.find((f) => f.path === path);
    if (!file?.full.length) return;
    file.i = Math.round(file.full.length * clamped);
    state.replayPath = file.path;
    state.replayContent = file.full.slice(0, file.i);
    if (WEB.html.test(file.path)) {
      refreshPreviewForPath(file.path, state.replayContent, true);
    }
    renderRaceCode(true);
    updateFileTreeState();
    return;
  }

  const step = state.replaySteps[state.currentStepIndex];
  if (!step) return;
  const { stepBase, stepToType, path } = getTypingStepSlice(step);
  state.charIndex = Math.round(stepToType.length * clamped);
  const content = stepBase + stepToType.slice(0, state.charIndex);
  state.replayPath = path;
  state.replayContent = content;
  refreshPreviewForPath(path, content, true);
  renderCode(path, content, true);
  updateFileTreeState();
}

function beginProgressScrub() {
  if (state.progressScrubbing) return;
  state.progressScrubbing = true;
  state.scrubWasPlaying = state.isPlaying;
  const target = getReplayProgressTarget();
  state.scrubBookmark = target
    ? {
        ratio:
          target.kind === "replayAll"
            ? target.ratio
            : target.length
              ? target.index / target.length
              : 0,
      }
    : null;
  if (state.isPlaying) {
    state.isPlaying = false;
    clearTimers();
    updateReplayUI();
  }
}

function endProgressScrub() {
  if (!state.progressScrubbing) return;
  const shouldResume = state.scrubWasPlaying;
  state.scrubWasPlaying = false;
  state.scrubBookmark = null;

  const finishScrub = () => {
    if (!state.progressScrubbing) return;
    state.progressScrubbing = false;
    updateProgressSlider();
    if (shouldResume) {
      state.isPlaying = true;
      updateReplayUI();
      requestAnimationFrame(() => {
        if (state.isPlaying) resumeReplayLoop();
      });
    }
  };

  const ratio = parseInt(els.progressSlider.value, 10) / 1000;
  if (state.replayAllMode && state.replayAllPaths?.length) {
    void applyReplayAllProgress(ratio).then(finishScrub);
    return;
  }

  syncProgressFromSlider();
  finishScrub();
}

function resumeReplayLoop() {
  if (state.parallelWeb) runParallelWebLoop();
  else if (state.raceMode) runRaceLoop();
  else runTypingLoop();
}

function syncProgressFromSlider() {
  applyReplayProgress(parseInt(els.progressSlider.value, 10) / 1000);
}

function countLines(content) {
  if (!content) return 1;
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") lines++;
  }
  return lines;
}

function maxCharsPerFrame() {
  if (state.replaySpeed >= 20000) return 40000;
  if (state.replaySpeed >= 5000) return 20000;
  if (state.replaySpeed >= 1000) return 10000;
  if (state.replaySpeed >= 300) return 6000;
  if (state.replaySpeed >= 100) return 4000;
  return MAX_CHARS_PER_FRAME;
}

function consumeTypingChars(deltaMs) {
  state.charAccumulator += (deltaMs / 1000) * TYPING_BASE_CPS * state.replaySpeed;
  let chars = Math.floor(state.charAccumulator);
  if (chars <= 0) return 0;
  const cap = maxCharsPerFrame();
  if (chars > cap) chars = cap;
  state.charAccumulator -= chars;
  return chars;
}

function refreshPreviewThrottled(path, options = {}) {
  const now = performance.now();
  const minGap =
    state.replaySpeed >= 1000 ? 8 : state.replaySpeed >= 300 ? 16 : state.replaySpeed >= 100 ? 40 : state.replaySpeed >= 20 ? 80 : state.replaySpeed >= 5 ? 40 : 16;
  if (now - state.lastPreviewRefresh < minGap) return;
  state.lastPreviewRefresh = now;
  if (options.markdown !== undefined || isMarkdownPath(path)) {
    const md = options.markdown ?? state.loadedFiles.get(path) ?? "";
    void preview.refreshMarkdown(path, md, options);
    return;
  }
  void preview.refreshAsync(path, options);
}

function setLineNumbers(block, count) {
  const nums = block.querySelector(".line-nums");
  if (!nums) return;

  const target = Math.max(count, 1);
  if (block.dataset.lineCount === String(target)) return;
  block.dataset.lineCount = String(target);

  let pre = nums.querySelector(".line-nums-pre");
  if (!pre) {
    nums.replaceChildren();
    pre = document.createElement("pre");
    pre.className = "line-nums-pre";
    nums.appendChild(pre);
  }

  if (target === 1) {
    pre.textContent = "1";
    return;
  }

  const parts = new Array(target);
  for (let i = 0; i < target; i++) parts[i] = String(i + 1);
  pre.textContent = parts.join("\n");
}

function updateCodeBlock(block, content, showCursor) {
  const pre = block.querySelector(".code-pre");
  const code = block.querySelector("code");
  if (!pre || !code) return;

  setLineNumbers(block, content ? countLines(content) : 1);

  if (!content) {
    code.innerHTML = '<span class="code-pane-empty">—</span>';
  } else {
    code.textContent = content;
  }

  const cursor = pre.querySelector(".cursor");
  if (showCursor) {
    if (!cursor) {
      const el = document.createElement("span");
      el.className = "cursor";
      pre.appendChild(el);
    }
  } else if (cursor) {
    cursor.remove();
  }
}

function mountEmptyCodePane(label) {
  return `
    <div class="code-pane">
      <div class="code-pane-head">
        <span class="code-pane-kind">${label}<span class="code-pane-pct" hidden></span></span>
        <span class="code-pane-file">—</span>
      </div>
      <div class="code-pane-body">
        <div class="code-block">
          <div class="line-nums"><pre class="line-nums-pre">1</pre></div>
          <pre class="code-pre"><code><span class="code-pane-empty">—</span></code></pre>
        </div>
      </div>
    </div>`;
}

function updateSplitPane(paneKey, filePath, content, active, typing, progressLabel = "", generating = false) {
  const wrapper = els.codeViewer.querySelector(`.split-pane[data-pane="${paneKey}"]`);
  if (!wrapper) return;

  const pane = wrapper.querySelector(".code-pane");
  if (!pane) return;

  pane.classList.toggle("code-pane-active", active);
  pane.classList.toggle("code-pane-generating", generating);
  const fileEl = pane.querySelector(".code-pane-file");
  if (fileEl) fileEl.textContent = filePath ? filePath.split("/").pop() : "—";

  const pctEl = pane.querySelector(".code-pane-pct");
  if (pctEl) {
    pctEl.textContent = progressLabel;
    pctEl.hidden = !progressLabel;
  }

  const block = pane.querySelector(".code-block");
  if (block) updateCodeBlock(block, content, active && typing);
}

function paneLabel(path) {
  if (WEB.html.test(path)) return "HTML";
  if (WEB.css.test(path)) return "CSS";
  if (WEB.js.test(path)) return "JS";
  return path.split("/").pop() ?? "Code";
}

function fileDonePercent(filePath, content = "") {
  if (state.parallelWeb) {
    const html = getParallelHtmlFile(state.parallelWeb);
    if (html) {
      const progress = parallelBuildProgress(state.parallelWeb);
      return Math.min(100, Math.round(progress * 100));
    }
    const f = state.parallelWeb.files.find((x) => x.path === filePath);
    if (f) {
      if (!f.full.length) return f.i > 0 ? 100 : 0;
      return Math.min(100, Math.round((f.i / f.full.length) * 100));
    }
  }

  const full = state.loadedFiles.get(filePath) ?? "";
  const typed =
    filePath === state.replayPath ? (content || state.replayContent || "") : content || "";
  if (WEB.html.test(state.replayPath) && isLiveReplayPosition() && filePath !== state.replayPath) {
    const htmlFull = state.loadedFiles.get(state.replayPath) ?? "";
    const htmlTyped = state.replayContent ?? "";
    const progress = htmlFull.length ? htmlTyped.length / htmlFull.length : 0;
    return Math.min(100, Math.round(progress * 100));
  }
  if (!full.length) return typed.length > 0 ? 100 : 0;
  return Math.min(100, Math.round((typed.length / full.length) * 100));
}

function formatRemainingLabel(donePercent) {
  if (!isLiveReplayPosition() || state.viewMode !== "replay") return "";
  if (donePercent >= 100) return "done";
  return `${100 - donePercent}% left`;
}

function paneProgressLabel(filePath, content = "") {
  return formatRemainingLabel(fileDonePercent(filePath, content));
}

function companionContent(filePath, activePath, activeContent) {
  if (filePath === activePath) return activeContent ?? "";
  if (state.parallelWeb) {
    const f = state.parallelWeb.files.find((x) => x.path === filePath);
    if (f) return f.full.slice(0, f.i);
  }
  if (isLiveReplayPosition() && WEB.html.test(activePath)) {
    const full = state.loadedFiles.get(filePath) ?? "";
    const htmlFull = state.loadedFiles.get(activePath) ?? "";
    const htmlTyped = activeContent ?? "";
    const progress = htmlFull.length ? htmlTyped.length / htmlFull.length : 0;
    return full.slice(0, Math.round(full.length * progress));
  }
  return state.loadedFiles.get(filePath) ?? "";
}

function getWebPathCatalog() {
  return new Set(collectWebPaths(state.fileTree));
}

function htmlDirPrefix(htmlPath) {
  if (!htmlPath?.includes("/")) return "";
  return `${htmlPath.split("/").slice(0, -1).join("/")}/`;
}

function uniquePaths(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function getHtmlPageBundle(htmlPath) {
  const available = getWebPathCatalog();
  const html = state.loadedFiles.get(htmlPath) ?? "";
  const { cssPaths, jsPaths } = resolvePageAssets(html, htmlPath, available);
  const dirPrefix = htmlDirPrefix(htmlPath);

  const bundle = [htmlPath];
  if (cssPaths.length) {
    bundle.push(...cssPaths);
  } else {
    const cssPool = [...available].filter((p) => isStylePath(p));
    const localCss = dirPrefix
      ? cssPool.filter((p) => p.startsWith(dirPrefix) || p.split("/").length === 1)
      : cssPool;
    const css = pickBestCss(localCss.length ? localCss : cssPool, htmlPath);
    if (css) bundle.push(css);
  }
  if (jsPaths.length) {
    bundle.push(...jsPaths);
  } else {
    const jsPool = [...available].filter((p) => isScriptPath(p));
    const localJs = dirPrefix
      ? jsPool.filter((p) => p.startsWith(dirPrefix) || p.split("/").length === 1)
      : jsPool;
    const js = pickBestJs(localJs.length ? localJs : jsPool, htmlPath);
    if (js) bundle.push(js);
  }
  return uniquePaths(bundle);
}

async function ensurePageBundleLoaded(htmlPath) {
  for (const filePath of getHtmlPageBundle(htmlPath)) {
    await ensureFileContent(filePath).catch(() => {});
  }
  const available = getWebPathCatalog();
  await loadImportGraph(getHtmlPageBundle(htmlPath), available);
}

function getAssetParentHtml(assetPath) {
  const htmlPaths = collectWebPaths(state.fileTree).filter((p) => WEB.html.test(p));
  const available = getWebPathCatalog();

  for (const htmlPath of htmlPaths) {
    const html = state.loadedFiles.get(htmlPath) ?? "";
    if (resolvePageAssets(html, htmlPath, available).linked.has(assetPath)) return htmlPath;
  }
  return pickPrimaryHtml(assetPath, htmlPaths);
}

function sortCodePanes(panes) {
  const order = (path) => {
    if (WEB.html.test(path)) return 0;
    if (WEB.css.test(path)) return 1;
    if (WEB.js.test(path)) return 2;
    return 3;
  };
  return [...panes].sort(
    (a, b) => order(a.filePath) - order(b.filePath) || a.filePath.localeCompare(b.filePath)
  );
}

function getCodePanes(path, content) {
  if (!path) return [];

  if (state.parallelWeb) {
    const htmlPath = state.parallelWeb.htmlPath;
    return state.parallelWeb.files.map((f) => {
      const racing = state.viewMode === "replay" && isLiveReplayPosition() && f.i < f.full.length;
      const slice = f.full.slice(0, f.i);
      const isHtml = f.path === htmlPath;
      return {
        filePath: f.path,
        label: paneLabel(f.path),
        content: slice,
        progressLabel: paneProgressLabel(f.path, slice),
        active: racing,
        showCursor: racing && (isHtml || f.i > 0),
        generating: f.i < f.full.length,
      };
    });
  }

  const typing = state.viewMode === "replay" && isLiveReplayPosition();
  const byPath = new Map();

  byPath.set(path, {
    filePath: path,
    label: paneLabel(path),
    content: content ?? "",
    progressLabel: paneProgressLabel(path, content ?? ""),
    active: true,
    showCursor: typing,
    generating: isFileGenerating(path, content ?? ""),
  });

  if (WEB.html.test(path)) {
    for (const linkedPath of getHtmlPageBundle(path)) {
      if (linkedPath === path || byPath.has(linkedPath)) continue;
      const linkedContent =
        typing ? companionContent(linkedPath, path, content) : (state.loadedFiles.get(linkedPath) ?? "");
      byPath.set(linkedPath, {
        filePath: linkedPath,
        label: paneLabel(linkedPath),
        content: linkedContent,
        progressLabel: paneProgressLabel(linkedPath, linkedContent),
        active: false,
        showCursor: false,
        generating: isFileGenerating(linkedPath, linkedContent),
      });
    }
  } else if (WEB.css.test(path) || WEB.js.test(path)) {
    const parentHtml = getAssetParentHtml(path);
    if (parentHtml) {
      for (const linkedPath of getHtmlPageBundle(parentHtml)) {
        if (byPath.has(linkedPath)) continue;
        const linkedContent = companionContent(linkedPath, path, content);
        byPath.set(linkedPath, {
          filePath: linkedPath,
          label: paneLabel(linkedPath),
          content: linkedContent,
          progressLabel: paneProgressLabel(linkedPath, linkedContent),
          active: linkedPath === path,
          showCursor: typing && linkedPath === path,
          generating: isFileGenerating(linkedPath, linkedContent),
        });
      }
    }
  }

  return sortCodePanes([...byPath.values()]);
}

function paneKeyForPath(path) {
  if (WEB.html.test(path)) return "html";
  if (WEB.css.test(path)) return "css";
  if (WEB.js.test(path)) return "js";
  return path.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function visibleCodePanes(panes, typing) {
  if (typing && (state.parallelWeb || state.webPreviewPaths?.size)) return panes;
  if (panes.length > 1) return panes;
  return panes.filter((p) => p.active || p.content);
}

function buildCodeFileTabsHtml(panes) {
  return panes
    .map(
      (pane, i) =>
        `<button type="button" class="code-file-tab${i === 0 ? " active" : ""}" role="tab" data-pane-index="${i}" title="${escapeHtml(pane.filePath)}"><span class="code-file-tab-kind">${escapeHtml(pane.label)}</span><span class="code-file-tab-name">${escapeHtml(pane.filePath.split("/").pop() ?? pane.filePath)}</span></button>`
    )
    .join("");
}

function buildDynamicCodeSplitHtml(panes) {
  let split = "";
  panes.forEach((pane, i) => {
    if (i > 0) {
      split += `<div class="resize-handle resize-handle-v" data-index="${i - 1}" title="Drag to resize"></div>`;
    }
    split += `<div class="split-pane" data-pane="${paneKeyForPath(pane.filePath)}" data-pane-index="${i}" data-path="${escapeHtml(pane.filePath)}">${mountEmptyCodePane(pane.label)}</div>`;
  });

  const splitClass =
    panes.length > 1
      ? "code-split stack-split-v code-split-scroll"
      : "code-split stack-split-v";

  const splitHtml = `<div class="${splitClass}" data-split-id="code">${split}</div>`;

  if (panes.length <= 1) return splitHtml;

  return `<div class="code-split-layout"><div class="code-file-tabs" role="tablist" aria-label="Code files">${buildCodeFileTabsHtml(panes)}</div>${splitHtml}</div>`;
}

function scrollToCodePane(index, behavior = "smooth") {
  const split = els.codeViewer.querySelector('.code-split[data-split-id="code"]');
  const pane = els.codeViewer.querySelector(`.split-pane[data-pane-index="${index}"]`);
  if (!pane) return;
  if (split?.classList.contains("code-split-scroll")) {
    split.scrollTo({ top: Math.max(0, pane.offsetTop - 4), behavior });
  } else {
    pane.scrollIntoView({ behavior, block: "nearest" });
  }
}

function setActiveCodeFileTab(index) {
  const tabs = els.codeViewer.querySelectorAll(".code-file-tab");
  tabs.forEach((tab, i) => {
    tab.classList.toggle("active", i === index);
    tab.setAttribute("aria-selected", i === index ? "true" : "false");
  });
}

function bindCodePaneHeadScroll() {
  els.codeViewer.querySelectorAll(".code-split-scroll .code-pane-head").forEach((head) => {
    if (head.dataset.bound === "1") return;
    head.dataset.bound = "1";
    head.title = "Jump to this file";
    head.addEventListener("click", () => {
      const index = parseInt(head.closest(".split-pane")?.dataset.paneIndex ?? "", 10);
      if (Number.isNaN(index)) return;
      setActiveCodeFileTab(index);
      scrollToCodePane(index);
    });
  });
}

function bindCodeFileTabs() {
  const tablist = els.codeViewer.querySelector(".code-file-tabs");
  if (!tablist || tablist.dataset.bound === "1") return;
  tablist.dataset.bound = "1";

  tablist.addEventListener("click", (e) => {
    const btn = e.target.closest(".code-file-tab");
    if (!btn) return;
    const index = parseInt(btn.dataset.paneIndex, 10);
    if (Number.isNaN(index)) return;
    setActiveCodeFileTab(index);
    scrollToCodePane(index);
  });

  tablist.addEventListener("keydown", (e) => {
    const tabs = [...tablist.querySelectorAll(".code-file-tab")];
    const current = tabs.findIndex((t) => t.classList.contains("active"));
    if (current < 0) return;

    let next = current;
    if (e.key === "ArrowRight") next = Math.min(tabs.length - 1, current + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;

    e.preventDefault();
    tabs[next].focus();
    setActiveCodeFileTab(next);
    scrollToCodePane(next);
  });
}

function syncCodeFileTabs(panes) {
  const tablist = els.codeViewer.querySelector(".code-file-tabs");
  if (!tablist) return;

  const tabs = tablist.querySelectorAll(".code-file-tab");
  const activePane = panes.find((p) => p.active) ?? panes[0];
  tabs.forEach((tab, i) => {
    const pane = panes[i];
    if (!pane) return;
    const pct = pane.progressLabel ? ` · ${pane.progressLabel}` : "";
    const kind = tab.querySelector(".code-file-tab-kind");
    if (kind) kind.textContent = `${pane.label}${pct}`;
    tab.classList.toggle("active", pane.filePath === activePane?.filePath);
    tab.setAttribute("aria-selected", pane.filePath === activePane?.filePath ? "true" : "false");
  });
}

function initCodeSplitResize(forceEqual = false) {
  const split = els.codeViewer.querySelector('.code-split[data-split-id="code"]');
  if (!split) return;
  if (split.classList.contains("code-split-scroll")) return;
  initStackResize(split);
  if (forceEqual) equalizeStackSplit(split);
}

function updateCodePaneByPath(pane, typing) {
  const paneKey = paneKeyForPath(pane.filePath);
  updateSplitPane(
    paneKey,
    pane.filePath,
    pane.content,
    pane.active,
    typing && pane.showCursor,
    pane.progressLabel ?? "",
    Boolean(pane.generating)
  );
}

function renderLinkedCodePanes(panes, typing = false) {
  const layoutKey = panes.map((p) => p.filePath).join("\0");

  if (state.codeLayout !== "split" || state.codeLayoutKey !== layoutKey) {
    els.codeViewer.innerHTML = buildDynamicCodeSplitHtml(panes);
    initCodeSplitResize(panes.length <= 1);
    bindCodeFileTabs();
    bindCodePaneHeadScroll();
    state.codeLayout = "split";
    state.codeLayoutKey = layoutKey;
  } else {
    syncCodeFileTabs(panes);
  }

  els.codePath.textContent = panes
    .map((p) => p.filePath.split("/").pop())
    .join(" · ");

  for (const pane of panes) {
    updateCodePaneByPath(pane, typing);
  }

  bindCodePaneHeadScroll();
  syncCodeFileTabs(panes);
  followTypingScroll(typing);
}

function renderParallelWebCode(typing = false) {
  const path = state.parallelWeb?.htmlPath ?? state.replayPath;
  const panes = getCodePanes(path, state.replayContent);
  renderLinkedCodePanes(panes, typing);
}

function mountSingleCodeView() {
  els.codeViewer.innerHTML = `
    <div class="code-scroll">
      <div class="code-block">
        <div class="line-nums"><pre class="line-nums-pre">1</pre></div>
        <pre class="code-pre"><code></code></pre>
      </div>
    </div>`;
}

function updateSingleCodeView(content, typing, generating = false) {
  const scroll = els.codeViewer.querySelector(".code-scroll");
  if (scroll) scroll.classList.toggle("code-generating", generating);

  const block = els.codeViewer.querySelector(".code-scroll .code-block");
  if (!block) return;
  updateCodeBlock(block, content, typing);
}

function collectPathsByKind(nodes, kind, out = []) {
  const re = RACE_KIND[kind];
  if (!re) return out;
  for (const node of nodes) {
    if (node.type === "file" && re.test(node.path)) out.push(node.path);
    else if (node.children?.length) collectPathsByKind(node.children, kind, out);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function raceFileProgress(file) {
  if (!file.full.length) return file.i > 0 ? 100 : 0;
  return Math.min(100, Math.round((file.i / file.full.length) * 100));
}

function getRaceLeader(race) {
  if (!race?.files.length) return null;
  let leader = race.files[0];
  for (const file of race.files) {
    if (file.i > leader.i) leader = file;
    else if (file.i === leader.i && file.full.length < leader.full.length) leader = file;
  }
  return leader;
}

function getRaceSortedFiles(race) {
  return [...race.files].sort((a, b) => {
    if (b.i !== a.i) return b.i - a.i;
    return a.full.length - b.full.length;
  });
}

function mountRaceLane(file) {
  const name = file.path.split("/").pop() ?? file.path;
  const lane = document.createElement("div");
  lane.className = "race-lane";
  lane.dataset.path = file.path;
  lane.innerHTML = `
    <button type="button" class="race-lane-head" title="Focus this file">
      <span class="race-rank">—</span>
      <span class="race-name">${escapeHtml(name)}</span>
      <span class="race-pct">0%</span>
      <span class="race-solo btn btn-sm" title="Replay this file solo">Solo</span>
      <div class="race-bar-track"><div class="race-bar-fill"></div></div>
    </button>
    <div class="race-lane-body">
      <div class="code-block">
        <div class="line-nums"><pre class="line-nums-pre">1</pre></div>
        <pre class="code-pre"><code><span class="code-pane-empty">—</span></code></pre>
      </div>
    </div>`;

  lane.querySelector(".race-lane-head").addEventListener("click", (e) => {
    if (e.target.closest(".race-solo")) return;
    focusRaceFile(file.path);
  });
  lane.querySelector(".race-solo").addEventListener("click", (e) => {
    e.stopPropagation();
    replayFile(file.path);
  });

  return lane;
}

function mountRaceView(files) {
  els.codeViewer.innerHTML = `
    <div class="race-view">
      <div class="race-board"></div>
      <div class="race-lanes"></div>
    </div>`;

  const lanesEl = els.codeViewer.querySelector(".race-lanes");
  for (const file of files) {
    lanesEl.appendChild(mountRaceLane(file));
  }
  state.codeLayout = "race";
}

function updateRaceLane(file, rank, leaderPath, typing) {
  const lanes = els.codeViewer.querySelectorAll(".race-lane");
  let lane = null;
  for (const el of lanes) {
    if (el.dataset.path === file.path) {
      lane = el;
      break;
    }
  }
  if (!lane) return;

  const pct = raceFileProgress(file);
  const done = file.i >= file.full.length;
  const content = file.full.slice(0, file.i);
  const focused = state.raceMode?.focusPath === file.path;

  lane.classList.toggle("race-lane-leader", file.path === leaderPath && state.isPlaying);
  lane.classList.toggle("race-lane-done", done);
  lane.classList.toggle("race-lane-focus", focused);
  lane.classList.toggle("race-lane-generating", !done && state.isPlaying);

  const rankEl = lane.querySelector(".race-rank");
  const pctEl = lane.querySelector(".race-pct");
  if (rankEl) rankEl.textContent = done ? "✓" : String(rank);
  if (pctEl) pctEl.textContent = `${pct}%`;

  const fill = lane.querySelector(".race-bar-fill");
  if (fill) fill.style.width = `${pct}%`;

  const block = lane.querySelector(".code-block");
  if (block) updateCodeBlock(block, content, typing && !done && file.path === leaderPath);
}

function renderRaceBoard(race) {
  const board = els.codeViewer.querySelector(".race-board");
  if (!board) return;

  const sorted = getRaceSortedFiles(race).slice(0, 6);
  board.innerHTML = sorted
    .map((file, i) => {
      const pct = raceFileProgress(file);
      const name = file.path.split("/").pop() ?? file.path;
      const done = file.i >= file.full.length;
      return `<div class="race-board-row${done ? " race-board-done" : ""}">
        <span class="race-board-rank">${done ? "✓" : i + 1}</span>
        <span class="race-board-name">${escapeHtml(name)}</span>
        <div class="race-bar-track"><div class="race-bar-fill" style="width:${pct}%"></div></div>
        <span class="race-board-pct">${pct}%</span>
      </div>`;
    })
    .join("");
}

function renderRaceCode(typing = false) {
  const race = state.raceMode;
  if (!race) return;

  if (state.codeLayout !== "race") {
    mountRaceView(race.files);
  }

  const leader = getRaceLeader(race);
  const sorted = getRaceSortedFiles(race);
  const rankByPath = new Map(sorted.map((f, i) => [f.path, i + 1]));

  const kind = race.kind.toUpperCase();
  const doneCount = race.files.filter((f) => f.i >= f.full.length).length;
  const focusName = race.focusPath?.split("/").pop() ?? "—";
  els.codePath.textContent = `Race · ${kind} · ${doneCount}/${race.files.length} done · ${focusName}`;

  renderRaceBoard(race);
  for (const file of race.files) {
    updateRaceLane(file, rankByPath.get(file.path) ?? "—", leader?.path ?? null, typing);
  }

  followTypingScroll(typing);
}

async function focusRaceFile(path) {
  if (!state.raceMode?.files.some((f) => f.path === path)) return;

  state.raceMode.focusPath = path;
  state.replayPath = path;
  state.replayContent = state.raceMode.files.find((f) => f.path === path)?.full.slice(0, 
    state.raceMode.files.find((f) => f.path === path)?.i ?? 0) ?? "";

  if (WEB.html.test(path)) {
    await setupWebPreviewContext(path);
    refreshFullHtmlPreview(path, true);
  }

  renderRaceCode(state.isPlaying);
  updateFileTreeState();
}

function syncRacePreview() {
  if (!state.raceMode) return;

  const focus = state.raceMode.focusPath;
  if (focus && WEB.html.test(focus)) {
    const file = state.raceMode.files.find((f) => f.path === focus);
    const content = file ? file.full.slice(0, file.i) : "";
    preview.setFile(focus, content);
    refreshPreviewForPath(focus, content, false);
  }

  renderRaceCode(state.isPlaying);

  const now = performance.now();
  if (now - state.lastTimelineRefresh > 150) {
    state.lastTimelineRefresh = now;
    renderTimeline();
  }
  updateProgressSlider();
  updatePreviewBuildingWidget();
}

function runRaceLoop() {
  clearTimers();
  if (!state.isPlaying || !state.raceMode) return;

  state.lastFrameTime = performance.now();
  state.charAccumulator = 0;

  const tick = (now) => {
    if (!state.isPlaying || !state.raceMode) return;
    if (state.progressScrubbing) {
      state.typingFrame = requestAnimationFrame(tick);
      return;
    }

    const files = state.raceMode.files;
    const allDone = files.every((f) => f.i >= f.full.length);

    if (allDone) {
      state.isPlaying = false;
      const winner = getRaceLeader(state.raceMode);
      if (winner) {
        state.replayPath = winner.path;
        state.replayContent = winner.full;
        state.raceMode.focusPath = winner.path;
      }
      updateReplayUI();
      renderTimeline();
      renderRaceCode(false);
      updateFileTreeState();
      if (winner && WEB.html.test(winner.path)) {
        void setupWebPreviewContext(winner.path).then(() => refreshFullHtmlPreview(winner.path, true));
      }
      return;
    }

    const delta = Math.min(now - state.lastFrameTime, 48);
    state.lastFrameTime = now;
    const chars = consumeTypingChars(delta);

    if (chars > 0) {
      for (const file of files) {
        if (file.i < file.full.length) {
          file.i = Math.min(file.full.length, file.i + chars);
        }
      }
      syncRacePreview();
    }

    state.typingFrame = requestAnimationFrame(tick);
  };

  state.typingFrame = requestAnimationFrame(tick);
}

async function startRace() {
  if (!state.parsed || !state.repoInfo) return;

  const kind = els.raceKindSelect.value;
  const paths = collectPathsByKind(state.fileTree, kind);
  if (!paths.length) {
    showError(`No .${kind} files found in this repo`);
    return;
  }
  if (paths.length > MAX_RACE_FILES) {
    showError(`Too many .${kind} files (${paths.length}). Max ${MAX_RACE_FILES} for race mode.`);
    return;
  }

  clearError();
  clearTimers();
  state.parallelWeb = null;
  clearReplayAllSession();
  state.codeLayout = null;
  els.raceBtn.disabled = true;

  try {
    await Promise.all(paths.map((p) => ensureFileContent(p)));

    const files = paths.map((p) => ({
      path: p,
      full: state.loadedFiles.get(p) ?? "",
      i: 0,
    }));

    state.raceMode = {
      kind,
      files,
      focusPath: paths[0],
    };
    rememberSession({ kind: "race", raceKind: kind });
    state.replaySteps = files.map((f, i) => makeFileStep(i, f.path, f.full));
    state.replayPaths = new Set(paths);
    state.viewMode = "replay";
    state.currentStepIndex = 0;
    state.charIndex = 0;
    state.isPlaying = true;
    state.replayPath = paths[0];
    state.replayContent = "";
    state.lastPreviewRefresh = 0;
    state.lastTimelineRefresh = 0;

    for (const p of paths) ensureFolderExpanded(p);
    preview.clear();

    if (kind === "html") {
      await setupWebPreviewContext(paths[0]);
      refreshFullHtmlPreview(paths[0], true);
    }

    updateReplayUI();
    renderTimeline();
    mountRaceView(files);
    syncRacePreview();
    runRaceLoop();
  } catch (err) {
    handleApiError(err, "Failed to start race");
    state.raceMode = null;
  } finally {
    els.raceBtn.disabled = false;
  }
}

function getTimelineStepIndex() {
  if (state.replayAllMode && state.replayAllPaths?.length) {
    return state.replayAllIndex;
  }

  if (state.raceMode) {
    const files = state.raceMode.files;
    const total = files.reduce((sum, f) => sum + f.full.length, 0);
    const done = files.reduce((sum, f) => sum + f.i, 0);
    if (!total || !state.replaySteps.length) return 0;
    const ratio = done / total;
    return Math.min(Math.floor(ratio * state.replaySteps.length), state.replaySteps.length - 1);
  }

  if (!state.parallelWeb) return state.currentStepIndex;

  const files = state.parallelWeb.files;
  const total = files.reduce((sum, f) => sum + f.full.length, 0);
  const done = files.reduce((sum, f) => sum + f.i, 0);
  if (!total || !state.replaySteps.length) return 0;

  const ratio = done / total;
  return Math.min(Math.floor(ratio * state.replaySteps.length), state.replaySteps.length - 1);
}

function renderTimeline() {
  if (state.raceMode) {
    const race = state.raceMode;
    const doneCount = race.files.filter((f) => f.i >= f.full.length).length;
    const leader = getRaceLeader(race);
    const leaderName = leader?.path.split("/").pop() ?? "—";
    const leaderPct = leader ? raceFileProgress(leader) : 0;

    els.stepCounter.textContent = `${doneCount} / ${race.files.length} finished`;
    els.prevStepBtn.disabled = true;
    els.nextStepBtn.disabled = true;
    els.stepInfo.textContent = `Race · ${race.kind.toUpperCase()} · Leader: ${leaderName} (${leaderPct}%)`;

    const sorted = getRaceSortedFiles(race);
    els.prevFiles.innerHTML = sorted
      .slice(0, 5)
      .map(
        (f) =>
          `<button type="button" class="mini-item${f.i >= f.full.length ? " race-mini-done" : ""}" data-race-path="${encodeURIComponent(f.path)}">${escapeHtml(f.path.split("/").pop() ?? f.path)} · ${raceFileProgress(f)}%</button>`
      )
      .join("");

    const remaining = sorted.filter((f) => f.i < f.full.length).slice(0, 5);
    els.upcomingFiles.innerHTML = remaining.length
      ? remaining
          .map(
            (f) =>
              `<span class="mini-item static">${escapeHtml(f.path.split("/").pop() ?? f.path)} · ${raceFileProgress(f)}%</span>`
          )
          .join("")
      : '<span class="mini-empty">All finished</span>';

    els.prevFiles.querySelectorAll("[data-race-path]").forEach((btn) => {
      btn.addEventListener("click", () => focusRaceFile(decodeURIComponent(btn.dataset.racePath)));
    });
    return;
  }

  if (state.parallelWeb) {
    const files = state.parallelWeb.files;
    const html = getParallelHtmlFile(state.parallelWeb);
    const htmlPct = html ? parallelFileProgress(html) : 0;

    els.stepCounter.textContent = `HTML ${htmlPct}%`;
    els.prevStepBtn.disabled = true;
    els.nextStepBtn.disabled = true;
    els.stepInfo.textContent = `Building · ${files.length} files synced to HTML`;

    const sorted = [...files].sort((a, b) => {
      if (a.path === state.parallelWeb.htmlPath) return -1;
      if (b.path === state.parallelWeb.htmlPath) return 1;
      return a.path.localeCompare(b.path);
    });
    els.prevFiles.innerHTML = sorted
      .slice(0, 5)
      .map(
        (f) =>
          `<span class="mini-item static${f.i >= f.full.length ? " race-mini-done" : ""}">${escapeHtml(f.path.split("/").pop() ?? f.path)} · ${parallelFileProgress(f)}%</span>`
      )
      .join("");

    const remaining = sorted.filter((f) => f.i < f.full.length).slice(0, 5);
    els.upcomingFiles.innerHTML = remaining.length
      ? remaining
          .map(
            (f) =>
              `<span class="mini-item static">${escapeHtml(f.path.split("/").pop() ?? f.path)} · ${parallelFileProgress(f)}%</span>`
          )
          .join("")
      : '<span class="mini-empty">All finished</span>';
    return;
  }

  if (state.replayAllMode && state.replayAllPaths?.length) {
    const idx = state.replayAllIndex;
    const path = state.replayAllPaths[idx] ?? "";

    els.stepCounter.textContent = `${idx + 1} / ${state.replayAllPaths.length}`;
    els.prevStepBtn.disabled = idx === 0;
    els.nextStepBtn.disabled = idx >= state.replayAllPaths.length - 1;
    els.stepInfo.textContent = path ? `${path} — Replay all` : "Replay all";

    const prev = state.replayAllPaths.slice(Math.max(0, idx - 3), idx);
    const next = state.replayAllPaths.slice(idx + 1, idx + 4);

    els.prevFiles.innerHTML = prev.length
      ? prev
          .map(
            (p) =>
              `<span class="mini-item static${state.replayPaths.has(p) && p !== path ? " race-mini-done" : ""}">${escapeHtml(p.split("/").pop() ?? p)}</span>`
          )
          .join("")
      : '<span class="mini-empty">—</span>';

    els.upcomingFiles.innerHTML = next.length
      ? next.map((p) => `<span class="mini-item static">${escapeHtml(p.split("/").pop() ?? p)}</span>`).join("")
      : '<span class="mini-empty">—</span>';
    return;
  }

  const stepIndex = getTimelineStepIndex();
  const step = state.replaySteps[stepIndex];
  if (!step) return;

  els.stepCounter.textContent = `${stepIndex + 1} / ${state.replaySteps.length}`;
  els.prevStepBtn.disabled = stepIndex === 0;
  els.nextStepBtn.disabled = stepIndex >= state.replaySteps.length - 1;
  els.stepInfo.textContent = `${step.path} — ${step.commitMessage}`;

  const prev = state.replaySteps.slice(Math.max(0, stepIndex - 3), stepIndex);
  const next = state.replaySteps.slice(stepIndex + 1, stepIndex + 4);

  els.prevFiles.innerHTML = prev.length
    ? prev.map((s) => `<button type="button" class="mini-item" data-idx="${s.index}">${escapeHtml(s.path)}</button>`).join("")
    : '<span class="mini-empty">—</span>';

  els.upcomingFiles.innerHTML = next.length
    ? next.map((s) => `<span class="mini-item static">${escapeHtml(s.path)}</span>`).join("")
    : '<span class="mini-empty">—</span>';

  els.prevFiles.querySelectorAll("[data-idx]").forEach((btn) => {
    btn.addEventListener("click", () => goToStep(parseInt(btn.dataset.idx, 10)));
  });
}

function showCodePanelPlaceholder(path) {
  els.codePath.textContent = path?.split("/").pop() ?? "—";
  state.codeLayout = null;
  state.codeLayoutKey = null;
  els.codeViewer.innerHTML = `<p class="empty code-preview-only">${escapeHtml(codePanelPlaceholderLabel(path))}</p>`;
}

function renderCode(path, content, typing = false) {
  if (state.raceMode) {
    renderRaceCode(typing);
    return;
  }

  if (state.parallelWeb) {
    renderParallelWebCode(typing);
    return;
  }

  if (path && isCodePanelExempt(path)) {
    showCodePanelPlaceholder(path);
    return;
  }

  const panes = getCodePanes(path, content);
  const typingLive = typing || (state.viewMode === "replay" && isLiveReplayPosition());
  const visiblePanes = visibleCodePanes(panes, typingLive);

  if (visiblePanes.length > 1) {
    renderLinkedCodePanes(visiblePanes, typingLive);
    return;
  }

  const singleContent =
    visiblePanes[0]?.content ??
    (isPreviewableMedia(path) && !WEB.svg.test(path) ? "" : content) ??
    "";
  const singlePath = visiblePanes[0]?.filePath ?? path;

  els.codePath.textContent = singlePath ?? "—";

  if (!singlePath) {
    state.codeLayout = null;
    state.codeLayoutKey = null;
    els.codeViewer.innerHTML = '<p class="empty">Double-click a file to build it live</p>';
    return;
  }

  if (state.codeLayout !== "single") {
    mountSingleCodeView();
    state.codeLayout = "single";
    state.codeLayoutKey = null;
  }

  updateSingleCodeView(
    singleContent,
    typingLive && visiblePanes[0]?.showCursor,
    Boolean(visiblePanes[0]?.generating)
  );
  followTypingScroll(typingLive);
}

function updateDisplay() {
  updatePreview();
  renderCode(activePath(), activeContent(), state.viewMode === "replay" && state.isPlaying);
  updateFileTree();
}

function updateReplayUI() {
  const inReplay =
    state.viewMode === "replay" &&
    (state.replaySteps.length > 0 || state.raceMode || state.parallelWeb);
  els.replayControls.classList.toggle("hidden", !inReplay);
  els.timeline.classList.toggle("hidden", !inReplay);
  els.playPauseBtn.textContent = state.isPlaying ? "Pause" : "Play";
  updateProgressSlider();
  updatePreviewBuildingWidget();
  if (isPreviewFullscreen()) syncPreviewFullscreenChrome();
}

function clearTimers() {
  if (state.typingFrame) cancelAnimationFrame(state.typingFrame);
  if (state.typingTimer) clearTimeout(state.typingTimer);
  if (state.stepPauseTimer) clearTimeout(state.stepPauseTimer);
  state.typingFrame = null;
  state.typingTimer = null;
  state.stepPauseTimer = null;
  state.charAccumulator = 0;
}

function fillPreviewCache(path, content) {
  pushPreviewFiles(path, content);
}

function resolvePreviewHtmlPath(path) {
  if (path && WEB.html.test(path)) return path;
  if (state.parallelWeb?.htmlPath) return state.parallelWeb.htmlPath;
  if (state.webPreviewPaths?.size) {
    const html = [...state.webPreviewPaths].find((p) => WEB.html.test(p));
    if (html) return html;
  }
  if (path && isWebFile(path)) {
    const htmlPaths = collectWebPaths(state.fileTree).filter((p) => WEB.html.test(p));
    return getAssetParentHtml(path) ?? pickPrimaryHtml(path, htmlPaths);
  }
  return null;
}

function getParallelHtmlFile(pw) {
  if (!pw?.htmlPath) return null;
  return pw.files.find((f) => f.path === pw.htmlPath) ?? null;
}

function parallelBuildProgress(pw) {
  const html = getParallelHtmlFile(pw);
  if (!html) return 0;
  if (!html.full.length) return html.i > 0 ? 1 : 0;
  return Math.min(1, html.i / html.full.length);
}

function syncParallelFileSlices(pw) {
  const html = getParallelHtmlFile(pw);
  if (!html) return;
  const progress = parallelBuildProgress(pw);
  for (const file of pw.files) {
    if (file.path === html.path) continue;
    file.i = Math.min(file.full.length, Math.round(file.full.length * progress));
  }
}

function isParallelBuildDone(pw) {
  const html = getParallelHtmlFile(pw);
  return html ? html.i >= html.full.length : true;
}

function getParallelLeader(pw) {
  return getParallelHtmlFile(pw) ?? pw?.files[0] ?? null;
}

function parallelFileProgress(file) {
  if (!file.full.length) return file.i > 0 ? 100 : 0;
  return Math.min(100, Math.round((file.i / file.full.length) * 100));
}

function getPreviewPhase() {
  if (!state.isPlaying) return "all";

  if (state.parallelWeb) {
    return "all";
  }

  const path = state.replayPath;
  if (!path) return "all";
  if (WEB.html.test(path)) return "html";
  if (WEB.css.test(path)) return "css";
  if (WEB.js.test(path)) return "js";
  return "all";
}

function previewJsReady() {
  if (!state.isPlaying) return true;

  if (state.parallelWeb?.jsPath) {
    const jsFile = state.parallelWeb.files.find((f) => f.path === state.parallelWeb.jsPath);
    return jsFile ? jsFile.i >= jsFile.full.length : true;
  }

  const path = state.replayPath;
  if (path && WEB.js.test(path)) {
    const full = state.loadedFiles.get(path) ?? "";
    return (state.replayContent?.length ?? 0) >= full.length;
  }

  return true;
}

function getPreviewBundle() {
  if (state.parallelWeb) {
    const cssPaths =
      state.parallelWeb.cssPaths ??
      (state.parallelWeb.cssPath ? [state.parallelWeb.cssPath] : []);
    const jsPaths =
      state.parallelWeb.jsPaths ??
      (state.parallelWeb.jsPath ? [state.parallelWeb.jsPath] : []);
    return {
      htmlPath: state.parallelWeb.htmlPath,
      cssPaths,
      jsPaths,
      cssPath: cssPaths[0] ?? null,
      jsPath: jsPaths[0] ?? null,
    };
  }

  if (state.webPreviewPaths?.size) {
    const paths = uniquePaths([...state.webPreviewPaths]);
    const htmlPath = paths.find((p) => WEB.html.test(p));
    if (!htmlPath) return null;
    const cssPaths = paths.filter((p) => isStylePath(p));
    const jsPaths = paths.filter((p) => isScriptPath(p));
    const jsPath = pickBundleEntry({ jsPaths }) ?? jsPaths[0] ?? null;
    return {
      htmlPath,
      cssPaths,
      jsPaths,
      cssPath: cssPaths[0] ?? null,
      jsPath,
    };
  }

  return null;
}

function fillPreviewBundle(htmlPath) {
  fillFullSitePreview(htmlPath);
}

function getReplayFileSlice(filePath, activePath, activeContent) {
  if (state.parallelWeb) {
    const file = state.parallelWeb.files.find((f) => f.path === filePath);
    return file ? file.full.slice(0, file.i) : (state.loadedFiles.get(filePath) ?? "");
  }

  if (!isLiveReplayPosition()) {
    if (filePath === activePath) return activeContent || (state.loadedFiles.get(filePath) ?? "");
    return state.loadedFiles.get(filePath) ?? "";
  }

  if (filePath === activePath) return activeContent ?? "";

  if (state.webPreviewPaths?.has(filePath)) {
    return companionContent(filePath, activePath, activeContent);
  }

  return state.loadedFiles.get(filePath) ?? "";
}

function pushPreviewFiles(path, content = "") {
  if (state.parallelWeb) {
    for (const file of state.parallelWeb.files) {
      preview.setFile(file.path, getReplayFileSlice(file.path, path, content));
    }
    return;
  }

  if (state.webPreviewPaths?.size) {
    for (const p of state.webPreviewPaths) {
      preview.setFile(p, getReplayFileSlice(p, path, content));
    }
    return;
  }

  if (path && isWebFile(path)) {
    preview.setFile(path, getReplayFileSlice(path, path, content));
  }
}

function refreshPreviewForPath(path, content = "", force = false) {
  if (path && isMarkdownPath(path)) {
    const md = content || state.loadedFiles.get(path) || "";
    const live = isLiveReplayPosition();
    const opts = previewRefreshOptions({
      liveBuild: live,
      forceMount: force && !live,
      resolveAssetUrl: getPreviewAssetUrl,
      repoLinkUrl: getRepoBlobUrl,
    });
    if (force || live) {
      state.lastPreviewRefresh = performance.now();
      void preview.refreshMarkdown(path, md, opts);
    } else {
      refreshPreviewThrottled(path, { ...opts, markdown: md });
    }
    return;
  }

  if (path && isPreviewableMedia(path)) {
    const live = isLiveReplayPosition();
    const slice = content || state.loadedFiles.get(path) || "";

    if (WEB.svg.test(path)) {
      preview.setFile(path, slice);
      preview.invalidate();
      void preview.refresh(path, {
        keepLast: true,
        liveBuild: live,
        forceMount: force || live,
        resolveAssetUrl: getPreviewAssetUrl,
      });
      return;
    }

    const mediaUrl = getRawFileUrl(path);
    if (mediaUrl) {
      preview.invalidate();
      preview.refresh(path, { mediaUrl, keepLast: true, forceMount: true });
    }
    return;
  }

  const hasWeb =
    state.parallelWeb ||
    state.webPreviewPaths?.size ||
    (path && isWebFile(path));

  if (!hasWeb) {
    if (state.isPlaying && preview.hasDocument()) return;
    preview.clear();
    els.previewFrame.classList.add("hidden-frame");
    els.previewEmpty.classList.remove("hidden");
    els.previewStatus.textContent = "—";
    return;
  }

  pushPreviewFiles(path, content);
  const previewPath = resolvePreviewHtmlPath(path);
  if (!previewPath) return;

  if (!state.parallelWeb) {
    const overrides = new Map();
    if (path) overrides.set(path, content);
    fillFullSitePreview(previewPath, overrides);
  }

  const htmlSlice =
    state.parallelWeb?.files.find((f) => f.path === state.parallelWeb?.htmlPath)?.i ??
    (WEB.html.test(path) ? content.length : (state.loadedFiles.get(previewPath)?.length ?? 0));
  const live = isLiveReplayPosition();
  const bundle = getPreviewBundle();
  const entry = bundle?.jsPath ?? bundle?.jsPaths?.[0];
  const opts = previewRefreshOptions({
    liveBuild: live,
    building: live && htmlSlice === 0,
    forceMount: force && !live,
    bundle,
    fullEntryLength: entry ? (state.loadedFiles.get(entry)?.length ?? 0) : 0,
  });

  if (force || live) {
    state.lastPreviewRefresh = performance.now();
    void preview.refreshAsync(previewPath, opts);
  } else {
    refreshPreviewThrottled(previewPath, opts);
  }
}

function onTypingTick(content, path) {
  state.replayContent = content;
  state.replayPath = path;
  refreshPreviewForPath(path, content);
  renderCode(path, content, true);
  updateFileTreeState();
  updateProgressSlider();
  updatePreviewBuildingWidget();
}

function syncParallelPreview() {
  if (!state.parallelWeb) return;

  const htmlFile = getParallelHtmlFile(state.parallelWeb);
  if (htmlFile) {
    state.replayPath = htmlFile.path;
    state.replayContent = htmlFile.full.slice(0, htmlFile.i);
    refreshPreviewForPath(htmlFile.path, state.replayContent, false);
  }

  renderParallelWebCode(true);
  updateFileTreeState();

  const now = performance.now();
  if (now - state.lastTimelineRefresh > 150) {
    state.lastTimelineRefresh = now;
    renderTimeline();
  }
  updateProgressSlider();
  updatePreviewBuildingWidget();
}

function runParallelWebLoop() {
  clearTimers();
  if (!state.isPlaying || !state.parallelWeb) return;

  state.lastFrameTime = performance.now();
  state.charAccumulator = 0;

  const tick = (now) => {
    if (!state.isPlaying || !state.parallelWeb) return;
    if (state.progressScrubbing) {
      state.typingFrame = requestAnimationFrame(tick);
      return;
    }

    const files = state.parallelWeb.files;
    const htmlFile = getParallelHtmlFile(state.parallelWeb);
    const allDone = isParallelBuildDone(state.parallelWeb);

    if (allDone) {
      state.isPlaying = false;
      const htmlPath = state.parallelWeb.htmlPath;
      state.replayPath = htmlPath;
      state.replayContent = htmlFile?.full ?? "";
      for (const file of files) file.i = file.full.length;
      state.parallelWeb = null;
      state.codeLayout = null;
      preview.invalidate();
      fillPreviewBundle(htmlPath);
      updateReplayUI();
      renderTimeline();
      updateDisplay();
      refreshPreviewForPath(htmlPath, state.replayContent, true);
      return;
    }

    const delta = Math.min(now - state.lastFrameTime, 48);
    state.lastFrameTime = now;
    const chars = consumeTypingChars(delta);

    if (chars > 0 && htmlFile) {
      if (htmlFile.i < htmlFile.full.length) {
        htmlFile.i = Math.min(htmlFile.full.length, htmlFile.i + chars);
      }
      syncParallelFileSlices(state.parallelWeb);
      syncParallelPreview();
    }

    state.typingFrame = requestAnimationFrame(tick);
  };

  state.typingFrame = requestAnimationFrame(tick);
}

function syncPreviewCache(path, content) {
  refreshPreviewForPath(path, content, true);
  renderCode(path, content, state.isPlaying);
}

function clearReplayAllSession() {
  state.replayAllMode = false;
  state.replayAllPaths = null;
  state.replayAllIndex = 0;
}

function finishReplayAll() {
  state.isPlaying = false;
  clearReplayAllSession();
  state.codeLayout = null;
  state.codeLayoutKey = null;
  updateReplayUI();
  updateDisplay();
}

async function advanceReplayAll() {
  if (!state.replayAllMode || !state.replayAllPaths?.length) {
    finishReplayAll();
    return;
  }

  const nextIndex = state.replayAllIndex + 1;
  if (nextIndex >= state.replayAllPaths.length) {
    finishReplayAll();
    return;
  }

  try {
    await prepareReplayAllStep(nextIndex);
    state.replayAllIndex = nextIndex;
    state.currentStepIndex = nextIndex;
    state.charIndex = 0;
    state.charAccumulator = 0;
    state.codeLayout = null;
    state.codeLayoutKey = null;
    preview.invalidate();
    onStepChange("", state.replayAllPaths[nextIndex]);
    runTypingLoop();
  } catch (err) {
    handleApiError(err, "Failed to load next file");
    state.isPlaying = false;
    updateReplayUI();
  }
}

async function prepareReplayAllStep(index) {
  const path = state.replayAllPaths[index];
  const content = await ensureFileContent(path);
  const step = makeFileStep(index, path, content);

  if (state.replaySteps[index]) state.replaySteps[index] = step;
  else state.replaySteps.push(step);

  state.replayPaths.add(path);
  if (isWebFile(path)) await setupWebPreviewContext(path);
  if (WEB.html.test(path)) refreshFullHtmlPreview(path, true);
  return step;
}

function onStepChange(content, path) {
  state.replayContent = content;
  state.replayPath = path;
  updateFileTreeState();
  syncPreviewCache(path, content);
  renderTimeline();
  updateProgressSlider();
}

function collectFilePaths(nodes, out = []) {
  for (const node of nodes) {
    if (node.type === "file") out.push(node.path);
    else if (node.children?.length) collectFilePaths(node.children, out);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function collectWebPaths(nodes, out = []) {
  for (const node of nodes) {
    if (node.type === "file" && isWebFile(node.path)) out.push(node.path);
    else if (node.children?.length) collectWebPaths(node.children, out);
  }
  return out;
}

async function ensureFileContent(path) {
  let content = state.loadedFiles.get(path);
  if (content !== undefined) return content;

  content = await fetchFileContent(
    state.parsed.owner,
    state.parsed.repo,
    path,
    state.repoInfo.defaultBranch
  );
  state.loadedFiles.set(path, content);
  return content;
}

function getRawFileUrl(path) {
  return getPreviewAssetUrl(path);
}

function pickBestCss(paths, activePath) {
  if (activePath && WEB.css.test(activePath) && paths.includes(activePath)) {
    return activePath;
  }
  const dirPrefix = htmlDirPrefix(WEB.html.test(activePath) ? activePath : "");
  const score = (p) => {
    const n = p.split("/").pop()?.toLowerCase() ?? "";
    let s = 4;
    if (n === "site.css") s = 0;
    else if (n === "style.css") s = 1;
    else if (n === "styles.css") s = 2;
    else if (n === "main.css") s = 3;
    if (dirPrefix && p.startsWith(dirPrefix)) s -= 2;
    return s;
  };
  return [...paths].sort((a, b) => score(a) - score(b))[0] ?? null;
}

function pickBestJs(paths, activePath) {
  if (activePath && isScriptPath(activePath) && paths.includes(activePath)) {
    return activePath;
  }
  const dirPrefix = htmlDirPrefix(WEB.html.test(activePath) ? activePath : "");
  const score = (p) => {
    const n = p.split("/").pop()?.toLowerCase() ?? "";
    let s = 6;
    if (n === "main.tsx") s = -2;
    if (n === "main.ts") s = -1;
    if (n === "main.jsx") s = -1;
    if (n === "app.js") s = 0;
    else if (n === "script.js") s = 1;
    else if (n === "main.js") s = 2;
    else if (n === "index.js" || n === "index.tsx") s = 3;
    else if (n === "bundle.js") s = 4;
    if (dirPrefix && p.startsWith(dirPrefix)) s -= 2;
    return s;
  };
  return [...paths].sort((a, b) => score(a) - score(b))[0] ?? null;
}

const IMPORT_SPECS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
];

function parseRelativeImports(content) {
  const specs = new Set();
  for (const re of IMPORT_SPECS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content))) {
      if (
        m[1].startsWith(".") ||
        m[1].startsWith("/") ||
        m[1].startsWith("@/")
      ) {
        specs.add(m[1]);
      }
    }
  }
  return [...specs];
}

async function loadImportGraph(seedPaths, available) {
  const queue = [...new Set(seedPaths.filter(Boolean))];
  const seen = new Set();
  while (queue.length) {
    const path = queue.shift();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    let content = "";
    try {
      content = await ensureFileContent(path);
    } catch {
      continue;
    }
    if (!isScriptPath(path) && !isStylePath(path)) continue;
    for (const spec of parseRelativeImports(content)) {
      const resolved = resolveAssetPath(spec, path, available);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

function pickPrimaryHtml(activePath, htmlPaths) {
  if (WEB.html.test(activePath) && htmlPaths.includes(activePath)) return activePath;

  const preferSource =
    activePath &&
    (isScriptPath(activePath) ||
      /\/src\//i.test(activePath) ||
      /\.(tsx?|jsx)$/i.test(activePath));
  const sourceHtml = preferSource
    ? htmlPaths.filter((p) => !/(?:^|\/)(dist|build|out)\//i.test(p))
    : htmlPaths;
  const candidates = sourceHtml.length ? sourceHtml : htmlPaths;

  return [...candidates].sort((a, b) => scoreHtmlPath(a) - scoreHtmlPath(b))[0] ?? null;
}

function htmlTagAttr(tag, name) {
  const quoted = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  if (quoted) return quoted;
  return tag.match(new RegExp(`${name}\\s*=\\s*([^\\s>"']+)`, "i"))?.[1] ?? null;
}

function resolveAssetPath(rel, htmlPath, available) {
  if (!rel || /^https?:\/\//i.test(rel) || rel.startsWith("//") || rel.startsWith("data:")) {
    return null;
  }

  const clean = rel.split("?")[0];
  const aliased = clean.startsWith("@/") ? `src/${clean.slice(2)}` : clean;

  const baseDir = htmlPath.includes("/") ? htmlPath.split("/").slice(0, -1) : [];
  const parts = aliased.startsWith("/")
    ? aliased.slice(1).split("/")
    : [...baseDir, ...aliased.split("/")];
  const stack = [];
  for (const part of parts) {
    if (part === "..") stack.pop();
    else if (part !== "." && part) stack.push(part);
  }
  const resolved = stack.join("/");
  const candidates = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.jsx`,
    `${resolved}.mjs`,
    `${resolved}/index.ts`,
    `${resolved}/index.tsx`,
    `${resolved}/index.js`,
    `${resolved}/index.jsx`,
  ];
  for (const candidate of candidates) {
    if (available.has(candidate)) return candidate;
  }

  const name = resolved.split("/").pop()?.toLowerCase();
  if (!name) return null;
  for (const p of available) {
    if (p.split("/").pop()?.toLowerCase() === name) return p;
  }
  return null;
}

function resolvePageAssets(html, htmlPath, available) {
  const cssPaths = [];
  const jsPaths = [];
  const linked = new Set();
  const addLinked = (path) => {
    if (!path || linked.has(path)) return;
    linked.add(path);
    if (isStylePath(path)) cssPaths.push(path);
    else if (isScriptPath(path)) jsPaths.push(path);
  };

  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = htmlTagAttr(tag, "rel")?.toLowerCase() ?? "";
    const href = htmlTagAttr(tag, "href");
    if (!href) continue;
    if (rel.includes("modulepreload")) {
      addLinked(resolveAssetPath(href, htmlPath, available));
      continue;
    }
    if (rel && !rel.includes("stylesheet")) continue;
    addLinked(resolveAssetPath(href, htmlPath, available));
  }

  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    const src = htmlTagAttr(tag, "src");
    if (!src) continue;
    addLinked(resolveAssetPath(src, htmlPath, available));
  }

  return { cssPaths, jsPaths, linked };
}

async function loadFilesParallel(paths) {
  const unique = [...new Set(paths)];
  await Promise.all(unique.map((p) => ensureFileContent(p).catch(() => {})));
}

async function setupWebPreviewContext(activePath) {
  const allWeb = collectWebPaths(state.fileTree);
  if (!allWeb.length) {
    state.webPreviewPaths = null;
    return;
  }

  const available = new Set(allWeb);
  const htmlPaths = allWeb.filter((p) => WEB.html.test(p));
  const cssPaths = allWeb.filter((p) => isStylePath(p));
  const scriptPaths = allWeb.filter((p) => isScriptPath(p));

  const toLoad = new Set();
  if (isWebFile(activePath)) toLoad.add(activePath);

  const primaryHtml = pickPrimaryHtml(activePath, htmlPaths);
  if (primaryHtml) toLoad.add(primaryHtml);

  await loadFilesParallel([...toLoad]);

  if (primaryHtml) {
    const html = state.loadedFiles.get(primaryHtml) ?? "";
    for (const linked of resolvePageAssets(html, primaryHtml, available).linked) {
      toLoad.add(linked);
    }
    const bundle = getHtmlPageBundle(primaryHtml);
    for (const p of bundle) toLoad.add(p);
    await loadFilesParallel([...toLoad].filter((p) => !state.loadedFiles.has(p)));

    const imported = await loadImportGraph([...toLoad], available);
    const missing = [...imported].filter((p) => !state.loadedFiles.has(p));
    if (missing.length) await loadFilesParallel(missing);

    state.webPreviewPaths = collectPreviewSourcePaths(primaryHtml);
    return;
  }

  if (isStylePath(activePath) && cssPaths.includes(activePath)) toLoad.add(activePath);
  if (isScriptPath(activePath) && scriptPaths.includes(activePath)) toLoad.add(activePath);
  await loadFilesParallel([...toLoad].filter((p) => !state.loadedFiles.has(p)));

  state.webPreviewPaths = new Set([...toLoad].filter((p) => state.loadedFiles.has(p)));
}

function buildWebTargets(activePath) {
  const htmlPaths = collectWebPaths(state.fileTree).filter((p) => WEB.html.test(p));
  const htmlPath = WEB.html.test(activePath)
    ? activePath
    : pickPrimaryHtml(activePath, htmlPaths);
  if (!htmlPath || !state.loadedFiles.has(htmlPath)) return null;

  const bundle = getHtmlPageBundle(htmlPath);
  const files = bundle
    .filter((p) => state.loadedFiles.has(p))
    .map((p) => ({
      path: p,
      full: state.loadedFiles.get(p) ?? "",
      i: 0,
    }));
  if (!files.some((f) => f.path === htmlPath)) return null;

  const cssPaths = bundle.filter((p) => isStylePath(p));
  const jsPaths = bundle.filter((p) => isScriptPath(p));

  return {
    htmlPath,
    cssPaths,
    jsPaths,
    cssPath: cssPaths[0] ?? null,
    jsPath: jsPaths[0] ?? null,
    files,
  };
}

function startParallelWebReplay(targets) {
  clearTimers();
  clearReplayAllSession();
  state.parallelWeb = {
    htmlPath: targets.htmlPath,
    cssPaths: targets.cssPaths,
    jsPaths: targets.jsPaths,
    cssPath: targets.cssPath,
    jsPath: targets.jsPath,
    files: targets.files.map((f) => ({ ...f, i: 0 })),
  };
  state.replayAllMode = false;
  state.raceMode = null;
  state.replaySteps = targets.files.map((f, i) => makeFileStep(i, f.path, f.full));
  state.replayPaths = new Set(targets.files.map((f) => f.path));
  state.viewMode = "replay";
  state.currentStepIndex = 0;
  state.charIndex = 0;
  state.isPlaying = true;
  state.replayPath = targets.htmlPath;
  state.replayContent = "";
  state.codeLayout = null;
  state.lastPreviewRefresh = 0;
  state.lastTimelineRefresh = 0;

  for (const f of targets.files) ensureFolderExpanded(f.path);
  preview.beginLiveBuild();
  for (const f of targets.files) preview.setFile(f.path, "");
  updateReplayUI();
  renderTimeline();
  renderParallelWebCode(true);
  refreshPreviewForPath(targets.htmlPath, "", true);
  syncParallelPreview();
  runParallelWebLoop();
}

function makeFileStep(index, path, content) {
  return {
    index,
    path,
    content,
    commitSha: "—",
    commitMessage: state.replayAllMode ? "Replay all" : "Live build",
    commitDate: "",
    author: "",
    action: "added",
    previousPath: null,
    charsAdded: content.length,
    isNewFile: true,
  };
}

function startFileReplay(steps) {
  clearTimers();
  state.parallelWeb = null;
  state.raceMode = null;
  state.replaySteps = steps;
  state.viewMode = "replay";
  state.currentStepIndex = state.replayAllMode ? state.replayAllIndex : 0;
  state.charIndex = 0;
  state.isPlaying = true;
  state.replayPath = steps[state.currentStepIndex]?.path ?? steps[0]?.path ?? null;
  state.replayContent = "";
  state.codeLayout = null;
  state.codeLayoutKey = null;
  state.lastPreviewRefresh = 0;
  state.lastTimelineRefresh = 0;

  if (!state.replayAllMode) {
    state.replayPaths = new Set(steps.map((s) => s.path));
  }

  ensureFolderExpanded(state.replayPath);
  if (state.replayPath && usesLivePreview(state.replayPath)) {
    preview.beginLiveBuild();
    if (isWebFile(state.replayPath) || WEB.svg.test(state.replayPath)) {
      preview.setFile(state.replayPath, "");
    }
  }
  updateReplayUI();
  renderTimeline();
  onStepChange("", state.replayPath);
  runTypingLoop();
}

async function replayFile(path) {
  if (!state.parsed || !state.repoInfo) return;

  clearError();
  clearTimers();
  state.isPlaying = false;
  clearReplayAllSession();
  state.raceMode = null;
  state.parallelWeb = null;
  state.selectedPath = path;
  ensureFolderExpanded(path);

  try {
    const content = await ensureFileContent(path);
    state.webPreviewPaths = null;
    rememberSession({ kind: "file", path });

    if (isWebFile(path)) {
      await setupWebPreviewContext(path);
      const htmlPath = WEB.html.test(path)
        ? path
        : [...(state.webPreviewPaths ?? [])].find((p) => WEB.html.test(p));
      if (htmlPath) {
        await ensurePageBundleLoaded(htmlPath);
        state.webPreviewPaths = collectPreviewSourcePaths(htmlPath);
      }
      const targets = buildWebTargets(path);
      if (targets) {
        startParallelWebReplay(targets);
        return;
      }
    }

    if (isPreviewableMedia(path) && !WEB.svg.test(path)) {
      await selectFile(path);
      return;
    }

    startFileReplay([makeFileStep(0, path, content)]);
  } catch (err) {
    handleApiError(err, "Failed to replay file");
  }
}

function shouldSkipInReplayAll(path) {
  const kind = getPreviewMediaKind(path);
  return kind === "image" || kind === "video" || kind === "audio";
}

async function replayAllFiles() {
  if (!state.parsed || !state.repoInfo) return;

  const paths = uniquePaths(
    collectFilePaths(state.fileTree).filter((p) => !shouldSkipInReplayAll(p))
  );
  if (!paths.length) {
    showError("No files to replay");
    return;
  }

  clearError();
  clearTimers();
  state.replayAllMode = true;
  state.raceMode = null;
  state.parallelWeb = null;
  state.replayAllPaths = paths;
  state.replayAllIndex = 0;
  state.replaySteps = [];
  state.replayPaths = new Set();
  state.codeLayout = null;
  state.codeLayoutKey = null;
  els.replayAllBtn.disabled = true;
  rememberSession({ kind: "all" });

  try {
    state.webPreviewPaths = null;
    preview.invalidate();
    await prepareReplayAllStep(0);
    startFileReplay(state.replaySteps);
  } catch (err) {
    handleApiError(err, "Failed to replay files");
  } finally {
    els.replayAllBtn.disabled = false;
  }
}

async function selectFile(path) {
  if (!state.parsed || !state.repoInfo) return;

  state.selectedPath = path;
  state.viewMode = "browse";
  state.isPlaying = false;
  state.parallelWeb = null;
  clearReplayAllSession();
  state.codeLayout = null;
  state.codeLayoutKey = null;
  ensureFolderExpanded(path);
  clearTimers();
  updateReplayUI();

  try {
    const content = await ensureFileContent(path);
    state.fileContent = content;

    if (isWebFile(path)) {
      await setupWebPreviewContext(path);
      const htmlPath = WEB.html.test(path) ? path : getAssetParentHtml(path);
      if (htmlPath) {
        await ensurePageBundleLoaded(htmlPath);
        state.webPreviewPaths = collectPreviewSourcePaths(htmlPath);
      }
      state.codeLayout = null;
      state.codeLayoutKey = null;
      preview.invalidate();
      refreshPreviewForPath(path, content, true);
    } else if (isPreviewPrimary(path)) {
      state.webPreviewPaths = null;
      preview.invalidate();
      refreshPreviewForPath(path, content, true);
    } else {
      state.webPreviewPaths = null;
      preview.clear();
      els.previewFrame.classList.add("hidden-frame");
      els.previewEmpty.classList.remove("hidden");
      els.previewStatus.textContent = "—";
    }
    updateDisplay();
  } catch (err) {
    handleApiError(err, "Failed to load file");
  }
}

function getStepBase(i) {
  const step = state.replaySteps[i];
  if (!step || step.isNewFile) return "";
  return step.content.slice(0, step.content.length - step.charsAdded);
}

function runTypingLoop() {
  clearTimers();
  if (!state.isPlaying) return;

  const step = state.replaySteps[state.currentStepIndex];
  if (!step) return;

  const base = step.isNewFile ? "" : step.content.slice(0, step.content.length - step.charsAdded);
  const toType = step.isNewFile ? step.content : step.content.slice(base.length);

  state.lastFrameTime = performance.now();
  state.charAccumulator = 0;

  const tick = (now) => {
    if (!state.isPlaying) return;
    if (state.progressScrubbing) {
      state.typingFrame = requestAnimationFrame(tick);
      return;
    }

    const currentStep = state.replaySteps[state.currentStepIndex];
    if (!currentStep) return;

    const stepBase = currentStep.isNewFile
      ? ""
      : currentStep.content.slice(0, currentStep.content.length - currentStep.charsAdded);
    const stepToType = currentStep.isNewFile ? currentStep.content : currentStep.content.slice(stepBase.length);

    if (state.charIndex >= stepToType.length) {
      const stepDelay = Math.max(8, Math.round(600 / state.replaySpeed));
      state.stepPauseTimer = setTimeout(async () => {
        if (state.replayAllMode && state.replayAllPaths) {
          await advanceReplayAll();
          return;
        }

        const nextIndex = state.currentStepIndex + 1;

        if (nextIndex < state.replaySteps.length) {
          state.currentStepIndex = nextIndex;
          state.charIndex = 0;
          state.charAccumulator = 0;
          const next = state.replaySteps[nextIndex];
          onStepChange("", next.path);
          runTypingLoop();
        } else {
          state.isPlaying = false;
          state.codeLayout = null;
          updateReplayUI();
          updateDisplay();
        }
      }, stepDelay);
      return;
    }

    const delta = Math.min(now - state.lastFrameTime, 48);
    state.lastFrameTime = now;
    const chars = consumeTypingChars(delta);

    if (chars > 0) {
      state.charIndex = Math.min(stepToType.length, state.charIndex + chars);
      onTypingTick(stepBase + stepToType.slice(0, state.charIndex), currentStep.path);
    }

    state.typingFrame = requestAnimationFrame(tick);
  };

  state.typingFrame = requestAnimationFrame(tick);
}

async function goToStep(index) {
  if (index < 0 || index >= state.replaySteps.length) return;
  clearTimers();
  state.isPlaying = false;
  state.parallelWeb = null;
  state.codeLayout = null;
  state.currentStepIndex = index;
  state.charIndex = 0;
  const step = state.replaySteps[index];

  if (WEB.html.test(step.path)) await setupWebPreviewContext(step.path);
  onStepChange(getStepBase(index), step.path);
  updateReplayUI();
}

function updateHeaderActions() {
  const loaded = Boolean(state.repoInfo);
  els.navTools.classList.toggle("hidden", !loaded);
  els.replayBtn.disabled = !state.lastSession;
}

function rememberSession(session) {
  state.lastSession = session;
  updateHeaderActions();
}

async function replayCurrent() {
  if (!state.lastSession || !state.parsed || !state.repoInfo) return;

  const session = state.lastSession;
  if (session.kind === "file" && session.path) {
    await replayFile(session.path);
  } else if (session.kind === "all") {
    await replayAllFiles();
  } else if (session.kind === "race" && session.raceKind) {
    els.raceKindSelect.value = session.raceKind;
    await startRace();
  }
}

function setStartButton(loading, label = "Load") {
  els.startBtn.disabled = loading;
  els.startBtn.textContent = label;
}

async function loadRepository() {
  const url = els.repoInput.value.trim();
  if (!url) return;

  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    showError("Invalid GitHub URL");
    return;
  }

  clearError();
  setStartButton(true, "Loading...");
  clearTimers();

  state.parsed = parsed;
  state.isPlaying = false;
  state.replaySteps = [];
  state.replayPaths = new Set();
  state.loadedFiles.clear();
  state.codeLayout = null;
  state.webPreviewPaths = null;
  clearReplayAllSession();
  state.parallelWeb = null;
  state.raceMode = null;
  state.lastPreviewHtmlPath = null;
  state.lastSession = null;
  preview.clear();

  try {
    const info = await fetchRepoInfo(parsed.owner, parsed.repo);
    const { tree } = await fetchRepoTree(parsed.owner, parsed.repo, info.defaultBranch);

    state.repoInfo = info;
    state.fileTree = tree;
    loadCollapsedFolders();
    state.selectedPath = null;
    state.fileContent = "";
    state.viewMode = "browse";

    els.repoName.textContent = `${info.owner}/${info.repo}`;
    els.repoInput.value = url;
    setRepoUrl(url);
    equalizeWorkspacePanels(els.workspace);
    updateHeaderActions();
    updateFileTree();
    updateReplayUI();
    updateTokenUI();
    updateDisplay();
  } catch (err) {
    if (isRateLimitError(err)) {
      setPendingRepo(url);
    }
    if (!handleApiError(err, "Failed to load repository") && !state.repoInfo) {
      navigateToWelcome();
    }
  } finally {
    setStartButton(false);
  }
}

function togglePlayPause() {
  state.isPlaying = !state.isPlaying;
  updateReplayUI();
  if (state.isPlaying) {
    if (state.raceMode) runRaceLoop();
    else if (state.parallelWeb) runParallelWebLoop();
    else runTypingLoop();
  } else {
    clearTimers();
    updateDisplay();
  }
}

function isPreviewFullscreen() {
  return document.fullscreenElement === els.previewPanel;
}

function updatePreviewFullscreenButton() {
  const active = isPreviewFullscreen();
  const btn = els.previewFullscreenBtn;
  if (!btn) return;
  btn.setAttribute("aria-pressed", active ? "true" : "false");
  btn.title = active ? "Exit fullscreen" : "Fullscreen";
  btn.setAttribute("aria-label", active ? "Exit fullscreen preview" : "Fullscreen preview");
  btn.querySelector(".icon-enter-fullscreen")?.classList.toggle("hidden", active);
  btn.querySelector(".icon-exit-fullscreen")?.classList.toggle("hidden", !active);
}

async function togglePreviewFullscreen() {
  if (!els.previewPanel) return;
  try {
    if (isPreviewFullscreen()) {
      await document.exitFullscreen();
    } else {
      await els.previewPanel.requestFullscreen();
    }
  } catch {
    showError("Fullscreen is not available in this browser.");
  }
}

els.startBtn.addEventListener("click", loadRepository);
els.replayAllBtn.addEventListener("click", replayAllFiles);
els.raceBtn.addEventListener("click", startRace);
els.replayBtn.addEventListener("click", replayCurrent);
els.tokenSettingsBtn.addEventListener("click", () => {
  navigateToToken({ reason: "voluntary", returnTo: "index.html" });
});
window.addEventListener("gitreplay:token-cleared", () => {
  updateTokenUI();
  showError("Your GitHub token was invalid and has been removed for this tab.");
});
els.repoInput.addEventListener("keydown", (e) => e.key === "Enter" && loadRepository());
els.playPauseBtn.addEventListener("click", togglePlayPause);
els.prevStepBtn.addEventListener("click", () => goToStep(state.currentStepIndex - 1));
els.nextStepBtn.addEventListener("click", () => goToStep(state.currentStepIndex + 1));
els.speedSlider.addEventListener("input", syncSpeedFromSlider);
els.progressSlider.addEventListener("pointerdown", (e) => {
  if (els.progressSlider.disabled) return;
  if (!state.progressScrubbing) beginProgressScrub();
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
});
els.progressSlider.addEventListener("input", syncProgressFromSlider);
els.progressSlider.addEventListener("pointerup", (e) => {
  try {
    e.currentTarget.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  endProgressScrub();
});
els.progressSlider.addEventListener("lostpointercapture", endProgressScrub);
els.progressSlider.addEventListener("keydown", (e) => {
  if (els.progressSlider.disabled) return;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
  if (!state.progressScrubbing) beginProgressScrub();
});
els.progressSlider.addEventListener("keyup", endProgressScrub);
els.previewFullscreenBtn.addEventListener("click", togglePreviewFullscreen);
document.addEventListener("fullscreenchange", syncPreviewFullscreenChrome);

syncSpeedFromSlider();
updateProgressSlider();
updateDisplay();
updateReplayUI();
updateHeaderActions();
bootWorkspace();
initPanelResize(document.getElementById("workspace"));
bindCodeScrollTracking();
